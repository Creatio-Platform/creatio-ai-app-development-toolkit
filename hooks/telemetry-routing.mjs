#!/usr/bin/env node
// PostToolUse hook: the guaranteed floor of product telemetry, plus the routing an agent needs to
// build a real funnel on top of it.
//
// TIERING — the whole point of this file:
//   floor (here, deterministic)  one `workflow_started` per host session, `workflow=unattributed`.
//                                It records that a session touched Creatio through clio, nothing more.
//   funnel (the agent)           every later stage, carrying the real `workflow`.
//
// The floor exists because the funnel is persuasion, not enforcement, and that was measured: with a
// CAADT skill loaded five flows out of five reported correctly, but a skill-less run reported
// nothing in one of two attempts even though it had read the core-rules invariant. Without a floor
// there is no way to tell "few runs happened" from "runs happened and went unreported" — the floor
// is the denominator that makes the funnel's own reliability measurable.
//
// This is the SECOND place the toolkit talks to clio's MCP server; `runtime/scripts/mcp_client.py`
// is the first. That is deliberate and the reasoning — plus the one rule both sides must keep in
// step, the CLIO_CMD single-path rule — is recorded in docs/telemetry-transport-decision.md.
//
// EMIT MECHANISM: clio exposes telemetry only as an MCP tool, so this drives clio's stdio MCP
// server for one call (~1.2s). The floor is once per session; `session_usage` is a series, so it can
// fire once per response — which is why the call is handed off rather than waited for, and why the
// usage path is bounded the same way the floor is. That deliberately costs a process spawn instead of
// writing clio's local event spool directly: the spool shape is clio's private storage format, and a
// copy of it here would ship inside an installed plugin and outlive the release that changed it.
// Going through the tool reuses clio's consent check, field validation and duration inference.
//
// PostToolUse, not PreToolUse: the floor should mean the clio call actually happened, and a hook
// that spawns a process must not sit in front of the tool it is observing.
//
// Never blocks, never fails the originating call. Any error exits 0 with no output.
//
// MODULE MAP — this file is orchestration only; each concern below lives in hooks/telemetry/:
//   identity.mjs             host/agent/plugin-version resolution
//   write-classification.mjs which clio calls are telemetry's own tools, and which are writes
//   state-dir.mjs            the shared state directory and its marker/claim primitives
//   consent.mjs               reading clio's own consent record
//   transcript.mjs            incremental JSONL transcript scanning for model + usage
//   dispatch.mjs               the MCP conversation with clio and its outcome parsing
//   floor-protocol.mjs         the once-per-session floor's retry bookkeeping
//   usage-protocol.mjs         the session_usage series' reported/in-flight bookkeeping
//   reminder.mjs                the routing text handed back to the agent
// All of them are read/claim/dispatch primitives with no orchestration of their own; main(),
// reportSessionUsage() and routeClioCall() below are what sequences them per hook event, and are the
// only functions that decide WHEN something happens rather than merely HOW.
import fs from 'node:fs';
import { HOST } from './telemetry/identity.mjs';
import { TELEMETRY_TOOLS, isWriteCall, writeVerbSubject } from './telemetry/write-classification.mjs';
import { claimOnce, markTouchedClio, releaseClaim, touchedClio } from './telemetry/state-dir.mjs';
import { consentGranted } from './telemetry/consent.mjs';
import { readSessionUsage, transcriptSize } from './telemetry/transcript.mjs';
import { emitEvent } from './telemetry/dispatch.mjs';
import { FLOOR_ATTEMPT_LIMIT, floorClaimSuffix, floorNonce, floorRetryable } from './telemetry/floor-protocol.mjs';
import {
	USAGE_ATTEMPT_LIMIT, claimUsageNonce, countUnconfirmedUsage, noteUsageAttempt,
	rememberPending, resolveAndPromoteUsageState
} from './telemetry/usage-protocol.mjs';
import { reminder } from './telemetry/reminder.mjs';

function readStdin() {
	try {
		return JSON.parse(fs.readFileSync(0, 'utf8'));
	} catch {
		return null;
	}
}

// Hosts do not agree on the payload shape, and the differences are not cosmetic. Cursor's
// `afterMCPExecution` names the session `conversation_id`, and hands `tool_input` over as a STRING
// rather than an object (documented at https://cursor.com/docs/agent/hooks). Read raw, there is no
// `session_id`, so main() returned at its first guard and the Cursor floor — advertised as
// deterministic on every host — never fired at all.
//
// Normalising here rather than at each use keeps every reader below written against one shape.
function normalizePayload(payload) {
	if (!payload || typeof payload !== 'object') {
		return payload;
	}
	const normalized = { ...payload };
	if (!normalized.session_id
		&& typeof normalized.conversation_id === 'string'
		&& normalized.conversation_id.trim()) {
		normalized.session_id = normalized.conversation_id;
	}
	if (typeof normalized.tool_input === 'string') {
		try {
			normalized.tool_input = JSON.parse(normalized.tool_input);
		} catch {
			// Not JSON after all: leave the string in place, `writeVerbSubject` handles both.
		}
	}
	return normalized;
}

function main() {
	const payload = normalizePayload(readStdin());
	const sessionId = payload?.session_id;
	if (!sessionId) {
		return;
	}
	const event = payload?.hook_event_name ?? '';
	if (event === 'Stop') {
		reportSessionUsage(payload, sessionId);
		return;
	}
	if (event === 'UserPromptSubmit') {
		// This event has no matcher support in the host, so it fires on every prompt in every session,
		// most of which have nothing to do with Creatio. A session that has never called clio holds no
		// claim to clear, so the work here is one stat and a return — nothing is created, written, or
		// swept, and no process is spawned on this path at all.
		if (!touchedClio(sessionId)) {
			return;
		}
		// A new user request is plausibly a new run, so the next clio call is allowed to route again.
		// Nothing is emitted or said here: at prompt time there is no way to know the turn will touch
		// Creatio at all, and telemetry routing injected into unrelated work is noise the model learns
		// to skip. Clearing a claim is cheap; a reminder nobody needed is not.
		releaseClaim(sessionId, 'turn');
		return;
	}
	routeClioCall(payload, sessionId);
}

// End of the host session: report what it consumed. This is the ONLY place a true total exists —
// measured, across 52 agent-emitted events not one carried a token counter, because an agent cannot
// see its own running totals. The host's transcript can, and at Stop it is complete.
//
// Emitted as `session_usage`, a measurement rather than a funnel stage: it marks no progress, it
// belongs to the session and not to any one flow, and it must never be counted as a run.
//
// Reported on EVERY Stop, because Stop fires when the agent finishes a RESPONSE — it is per turn, not
// per session. Claiming it once froze the measurement at the end of the first turn: verified on a live
// session, where the recorded total went stale while the session kept running. The counters are running
// totals, so the series is monotonic — real consumption is the MAXIMUM, and the difference between two
// readings is what one request cost. This also survives a session killed rather than closed.
function reportSessionUsage(payload, sessionId) {
	// Scoped to sessions that actually used clio. `Stop` carries no tool name, so it cannot take the
	// `mcp__.*clio.*` matcher its PostToolUse sibling has — without this gate EVERY session on EVERY
	// project would spawn a clio MCP server each turn and report an unrelated session's usage into
	// Creatio product telemetry, once consent had been granted anywhere.
	if (!touchedClio(sessionId)) {
		return;
	}
	// `stop_hook_active` means the host re-entered its own Stop, which would double-report.
	if (payload?.stop_hook_active || !consentGranted()) {
		return;
	}
	// A session with exactly one clio call never makes a SUBSEQUENT clio call, so routeClioCall's own
	// retry loop — which only ever runs from there — never gets a chance to notice an async 'rejected'
	// answer and retry it. Stop is the session's last opportunity: calling the same claim/retry
	// primitive here can only ever WIN a claim no other process already holds (a no-op once the floor
	// is recorded, pending, or already exhausted its FLOOR_ATTEMPT_LIMIT), never emit past the bound
	// routeClioCall itself already respects.
	attemptFloorEmission(sessionId, payload);
	// Stop fires per response, so this runs many times per session. When the transcript has not grown
	// since the last reading there is provably nothing new, so the file is not read or parsed at all —
	// a stat instead of opening it at all. Everything past this point goes through the offset-based
	// reader described at `readSessionUsage`, so a turn that DID grow the transcript parses only the
	// bytes appended since the last reading; this check is what removes even that on a quiet turn.
	const size = transcriptSize(payload);
	// One read of the 'usage' marker for both checks below, instead of lastReported() and
	// inFlightReading() each re-reading and re-parsing it.
	const { reported: previous, inFlight } = resolveAndPromoteUsageState(sessionId);
	if (size !== 0 && size === previous.size) {
		return;
	}
	// A reading is already in flight: the emit is handed off, so a Stop arriving before clio answers
	// would otherwise dispatch a second child over the first one's files. This used to also require
	// `outstanding.size === size`, which made it decorative — the transcript grows on nearly every
	// turn, so the sizes almost never matched and overlapping dispatches were the norm. Waiting is
	// safe because the counters are running TOTALS: the next reading carries everything this one
	// would have, so what is lost is resolution on fast turns, never a number. Once the answer comes
	// back — refused or otherwise — the reading is no longer in flight and the series continues.
	if (inFlight) {
		return;
	}
	// Read once and reused below for the nonce: usageNonce() used to re-read this same marker file a
	// second time to derive the identical count this check just obtained.
	const unconfirmedCount = countUnconfirmedUsage(sessionId);
	if (unconfirmedCount >= USAGE_ATTEMPT_LIMIT) {
		// Every reading so far has gone unconfirmed. Reading the transcript again would cost a full
		// parse and a process spawn to learn the same thing, so the series stops for this session.
		return;
	}
	const usage = readSessionUsage(payload, size);
	// An unchanged or unreadable total is not worth a reading: a row of zeroes is indistinguishable from
	// a session that genuinely spent nothing, and a repeat says nothing in a series that means growth.
	if (!usage.hasData || usage.output_tokens <= previous.output) {
		return;
	}
	// Remembered as PENDING, not as reported: the answer cannot be awaited here, so the reading is
	// promoted to reported only once a later Stop sees clio confirm it. Marking a refused reading as
	// delivered hides the failure behind a series that merely looks sparse, and a persistently
	// refused field would end the series in silence.
	// The nonce ties this dispatch to the pending record, so a later invocation reads the answer to
	// THIS reading rather than to whichever dispatch wrote last. Claimed, not just derived: see
	// claimUsageNonce() for why a plain derivation let two concurrent processes collide.
	const nonce = claimUsageNonce(sessionId, unconfirmedCount);
	if (nonce === null) {
		// Every candidate this Stop tried was already claimed by a concurrent process for this
		// session. Nothing lost: the transcript only grows, so the next Stop reports the same total
		// (or more) under a fresh nonce.
		return;
	}
	if (emitEvent(sessionId, usage, 'session_usage', nonce)) {
		rememberPending(sessionId, previous, usage.output_tokens, size, nonce);
		noteUsageAttempt(sessionId, false);
	}
}

// Claims the floor for this session if it is not already claimed (or already exhausted its
// retries), dispatching the event on a freshly-won claim. Callable from more than one hook event —
// a clio call and Stop both call it — because neither alone is guaranteed to be the LAST chance a
// session gets: a session can end after exactly one clio call, with no later call to retry from.
//
// Each attempt is its own exclusively-created claim (`claimed`, `claimed-1`, `claimed-2`), so two
// callers racing each other (two parallel clio calls, or a clio call racing this session's own Stop)
// never both win the same attempt: releasing and re-claiming was two operations, and two hook
// processes running in parallel — which Claude Code produces routinely by batching tool calls —
// could interleave them so that both ended up holding a claim and both dispatched a floor event. An
// over-counted floor is worse than an under-counted funnel, because every reliability ratio is
// computed against it.
function attemptFloorEmission(sessionId, payload) {
	let attempt = 0;
	let claimed = claimOnce(sessionId, floorClaimSuffix(attempt));
	while (!claimed && attempt + 1 < FLOOR_ATTEMPT_LIMIT) {
		if (!floorRetryable(sessionId, attempt)) {
			return false;
		}
		// Deliberately NOT cleaned up here, unlike the usage path: floorRetryable() re-derives
		// "was this attempt rejected" from THIS OUTCOME FILE on every call — there is no durable
		// record of it anywhere else, since the floor has no equivalent of the usage marker's
		// promoted-total write. Deleting it early would force later calls onto the weaker,
		// GRACE-PERIOD-gated 'none' path instead, which is slower and (measured while writing this)
		// stalls the retry loop entirely once a later attempt's claim file already exists. Left for
		// the weekly sweep — at most FLOOR_ATTEMPT_LIMIT pairs per session, not per dispatch.
		attempt += 1;
		claimed = claimOnce(sessionId, floorClaimSuffix(attempt));
	}
	if (claimed) {
		// Dispatched whether or not the routing reaches the agent: if clio refuses the call (an older
		// clio, a broken install), the agent's own stages are then the only telemetry there is. The
		// outcome is read on a later call rather than awaited here — see dispatch().
		emitEvent(sessionId, readSessionUsage(payload), 'workflow_started', floorNonce(attempt));
	}
	return claimed;
}

// A clio MCP call: the floor event, and the routing the agent needs to build a funnel on top of it.
function routeClioCall(payload, sessionId) {
	const toolName = String(payload?.tool_name ?? '');
	if (!toolName.includes('clio')) {
		return;
	}
	// Checked against the command the executor actually runs, not the tool name. `send-telemetry` is
	// not advertised in `tools/list` — this file says so where it builds the request — so the agent's
	// own telemetry arrives as `clio-run` with `command: "send-telemetry"`, and a name-suffix test
	// never matched it. The consequence was small but backwards: a session whose only clio interaction
	// was its own telemetry marked itself `touched`, spent its routing reminder on a telemetry call,
	// and opened a `session_usage` series. Same class as the `modify-` verb that was missed once
	// before: the verb that matters travels inside the executor's command.
	if (TELEMETRY_TOOLS.some(tool => writeVerbSubject(payload) === tool || toolName.endsWith(tool))) {
		return;
	}
	// Two independent claims, because the floor and the routing answer different questions.
	//
	// The floor is once per host session: a second one would inflate the session count, which is the
	// denominator the floor exists to provide.
	//
	// The routing recurs, because a single reminder per session was measured landing in the wrong
	// place. One run's first clio call was `list-environments` — a read-only inspection that correctly
	// reports nothing — so the session spent its only reminder there, and the mutating work that
	// followed got none. Hence also once on the first WRITE of the session, even if this turn was
	// already reminded.
	//
	// Consent is checked BEFORE the floor is claimed. Claiming first burned the one-shot marker on a
	// call made while consent was still `unknown` — the common bootstrap case — and the floor event,
	// the one this design calls guaranteed, was then permanently lost for that session even after the
	// developer granted consent moments later.
	markTouchedClio(sessionId);
	if (!consentGranted()) {
		// Denied, withdrawn, or still unanswered: emit nothing and say nothing. Prompting from a hook
		// would interrupt the developer's task with a question they did not ask for.
		return;
	}
	const floorClaimed = attemptFloorEmission(sessionId, payload);
	// The floor claim above is independent of the routing reminder below: over-counting the floor
	// is worse than under-counting the funnel, because every reliability ratio is computed against
	// it, so the two are claimed separately rather than as one combined decision.
	const remind = claimOnce(sessionId, 'turn') || (isWriteCall(payload) && claimOnce(sessionId, 'write'));
	if (!floorClaimed && !remind) {
		return;
	}
	const routing = remind ? routingOutput(sessionId) : null;
	if (routing) {
		// fs.writeSync, not process.stdout.write: the latter is buffered and asynchronous on macOS,
		// and `process.exit(0)` below discards pending stdout writes — so the host could receive
		// truncated JSON, which is exactly the "stdout the host could mistake for output" this file
		// promises not to produce. The rest of the file already uses raw descriptors.
		try {
			fs.writeSync(1, routing);
		} catch {
			// A closed stdout is not a reason to fail the tool call.
		}
	}
}

// The floor is already recorded by the time this runs, so a host that cannot carry the routing text
// still gets the guaranteed event — it just falls back to its skills and rules for the rest.
function routingOutput(sessionId) {
	if (HOST === 'claude') {
		return JSON.stringify({
			hookSpecificOutput: {
				hookEventName: 'PostToolUse',
				additionalContext: reminder(sessionId)
			}
		});
	}
	if (HOST === 'codex') {
		return JSON.stringify({ systemMessage: reminder(sessionId) });
	}
	return null;
}

// Belt and braces around the same promise the header makes: this hook never fails the turn it is
// attached to, and never prints anything the host could mistake for output. The catch covers a
// synchronous throw; the two handlers cover anything that could still be in flight, which matters
// because `UserPromptSubmit` and `Stop` fire on every turn whether or not Creatio is involved.
process.on('uncaughtException', () => process.exit(0));
process.on('unhandledRejection', () => process.exit(0));

try {
	main();
} catch {
	// Never fail the tool call this hook is attached to.
}
process.exit(0);

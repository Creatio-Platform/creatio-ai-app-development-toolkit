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
// EMIT MECHANISM: clio exposes telemetry only as an MCP tool, so this drives clio's stdio MCP
// server for one call (~1.2s, once per session). That deliberately costs a process spawn instead of
// writing clio's local event spool directly: the spool shape is clio's private storage format, and a
// copy of it here would ship inside an installed plugin and outlive the release that changed it.
// Going through the tool reuses clio's consent check, field validation and duration inference.
//
// PostToolUse, not PreToolUse: the floor should mean the clio call actually happened, and a hook
// that spawns a process must not sit in front of the tool it is observing.
//
// Never blocks, never fails the originating call. Any error exits 0 with no output.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Which host is running this hook. It changes ONLY how the routing text is handed back; the floor
// event is a side effect and therefore host-agnostic.
//   claude  - hookSpecificOutput.additionalContext
//   codex   - systemMessage (PostToolUse accepts it; note Codex hooks are off until the developer
//             sets [features].codex_hooks = true, which is their decision, not an installer's)
//   cursor  - NOTHING. afterMCPExecution is documented as informational only: it cannot reach the
//             user or the agent, so the floor is all a hook can contribute there. Cursor gets its
//             routing from the always-applied telemetry rule the installer writes instead.
//   other   - silence rather than a guessed shape: stdout a host does not understand is at best
//             ignored and at worst read as a hook failure.
const HOST = (process.env.CAADT_TELEMETRY_HOOK_HOST || 'claude').toLowerCase();
const CLIO = process.env.CAADT_TELEMETRY_CLIO || 'clio';
// The host this hook is wired into IS the coding agent, so defaulting to one host's name would
// report every Codex or Cursor run as Claude Code — a cohort that never ran.
const HOST_AGENT_NAMES = {
	claude: 'Claude Code',
	codex: 'Codex',
	cursor: 'Cursor',
	copilot: 'GitHub Copilot CLI'
};
const CODING_AGENT = process.env.CAADT_TELEMETRY_AGENT || HOST_AGENT_NAMES[HOST] || null;
// Resolved from the installed manifest rather than defaulted to a placeholder: this file ships
// inside the plugin, so the manifest beside it IS the installed version. `unknown` is what the
// routing text below tells the agent never to send, and a hook that sends it while instructing
// otherwise is the instruction's own counter-example. clio accepts the field's absence.
const PLUGIN_VERSION = process.env.CAADT_TELEMETRY_PLUGIN_VERSION || readInstalledPluginVersion();

function readInstalledPluginVersion() {
	// hooks/telemetry-routing.mjs -> <plugin root>/.claude-plugin/plugin.json
	const manifest = path.join(
		path.dirname(path.dirname(fileURLToPath(import.meta.url))),
		'.claude-plugin', 'plugin.json');
	try {
		const version = JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
		return typeof version === 'string' && version.trim() && version !== 'unknown' ? version.trim() : null;
	} catch {
		return null;
	}
}

// The identity fields are named only when they resolved. Interpolating an unresolved value would
// print `plugin_version="null"` into the instruction that exists to stop placeholders being sent.
function identityRoutingLines() {
	const resolved = [
		...(CODING_AGENT ? [`coding_agent="${CODING_AGENT}"`] : []),
		...(PLUGIN_VERSION ? [`plugin_version="${PLUGIN_VERSION}"`] : [])
	];
	if (resolved.length === 0) {
		return [
			'  - send NO coding_agent and NO plugin_version: nothing here resolved them, and a guessed',
			'    value lands real runs in a cohort that never existed. Measured runs on ONE installation',
			'    reported five different versions, four of them invented. clio accepts their absence;'
		];
	}
	return [
		`  - send ${resolved.join(' and ')} VERBATIM, on every stage. Resolved here from the`,
		'    installation itself — do not read it from anywhere else and do not substitute a value you',
		'    inferred. Measured runs on ONE installation reported five different versions, four of them',
		'    invented. Anything not named on this line is sent NOT AT ALL rather than as a placeholder',
		'    such as `unknown`;'
	];
}
const CALL_TIMEOUT_MS = 15_000;

// clio's telemetry surface: reminding a session that is already sending telemetry is circular, and
// emitting a floor event in reaction to a floor event would recurse.
const TELEMETRY_TOOLS = ['get-telemetry-consent', 'send-telemetry', 'withdraw-telemetry-consent'];

// The reserved `workflow` value for the floor. The hook sees a tool name, not a workflow, so it
// cannot know which flow this is; a real-looking value would be a guess presented as data, and
// omitting the field would break the contract's own "always send workflow" rule. `unattributed`
// says exactly what happened and makes floor-only sessions countable.
const FLOOR_WORKFLOW = 'unattributed';

const reminder = sessionId => [
	'This session is working on Creatio through clio, so it reports product telemetry.',
	'That applies to EVERY workflow, not just app creation, and to this session even with no skill loaded.',
	'',
	`A session start is ALREADY recorded for session_id="${sessionId}" (as workflow=${FLOOR_WORKFLOW},`,
	'because a hook cannot know which flow a run is). From here:',
	`  - reuse session_id="${sessionId}" for every telemetry event of this run;`,
	'  - EXCEPT if you have already emitted stages for this run under a different session_id: keep that',
	'    one to the end. Switching mid-run splits one run across two ids, and a measured run did exactly',
	'    that — it left an abandoned start under the first id and a start-plus-completed under this one,',
	'    so the funnel counted the run twice and one copy as never finished;',
	'  - DO emit your own `workflow_started` under your real `workflow` as the first stage of the run.',
	'    That is not a duplicate of the floor above: the unit of a run is the (session_id, workflow)',
	'    pair, so each flow keeps its own start and its own elapsed-time measurements. A stage sent',
	'    without a start of its own is recorded as a build with no beginning, which no funnel can read;',
	'  - send your real `workflow` on each stage you emit from now on:',
	'    app-creation | classic-to-freedom-migration | mobile-page-conversion | branding | app-maintenance',
	'  - one run is one request. If you already reported a run in this session and the developer has',
	'    since asked for something else, that is a NEW run: close the previous one with its terminal',
	'    stage first, then open this one. A measured session let a second request close the first one,',
	'    so a task that actually succeeded was recorded as blocked;',
	'  - send `model` with your own model id, lowercased, on every stage;',
	...identityRoutingLines(),
	'  - send `input_tokens` / `output_tokens` / `cached_input_tokens` as running session totals when',
	'    you can see them, and omit them when you cannot rather than guessing a number.',
	'',
	'Read `get-guidance name=product-telemetry` for the stage names, the payload and the consent flow.',
	'Do not spell a stage from memory and do not invent a per-flow name such as migration_plan_approved:',
	'clio validates event_name against a closed allow-list and rejects anything else.',
	'',
	'The migration, mobile-conversion and branding flows are exempt from Gate P/R. That does NOT exempt',
	'them from telemetry - their emission points are their own gates, listed in',
	'context/product-telemetry.md.',
	'',
	'Then continue the task. Never let telemetry gate, delay, or alter the work.'
].join('\n');

function readStdin() {
	try {
		return JSON.parse(fs.readFileSync(0, 'utf8'));
	} catch {
		return null;
	}
}

// Which model ran, and what the session had consumed by this point. The host does not pass either in
// the hook payload, but it keeps a JSONL transcript whose assistant messages carry `model` and
// `usage` — and the file is named for the session id, so it is reachable even when the payload omits
// `transcript_path`.
//
// Only `output_tokens` accumulates. The other two are per-REQUEST sizes: each assistant turn reports
// the whole prompt it just sent, so the same context is counted again every turn and summing them grows
// quadratically with turn count — it produced a `cached_input_tokens` of 157,881,680 for a single
// session, which is why this is a correctness fix and not a preference. The LATEST reading is the
// meaningful one: it is the size of the context as it now stands.
//
// `hasData` separates "read the transcript, it reported no usage" from "could not read it at all", so
// callers can omit the counters instead of shipping zeros that look like a session that spent nothing.
function readSessionUsage(payload) {
	const transcript = payload?.transcript_path
		|| path.join(os.homedir(), '.claude', 'projects', slugForCwd(payload?.cwd), `${payload?.session_id}.jsonl`);
	const usage = { model: null, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, hasData: false };
	let raw;
	try {
		raw = fs.readFileSync(transcript, 'utf8');
	} catch {
		return usage; // No transcript reachable: send the event without these fields.
	}
	for (const line of raw.split('\n')) {
		if (!line.startsWith('{')) {
			continue;
		}
		let message;
		try {
			message = JSON.parse(line)?.message;
		} catch {
			continue; // A partially flushed final line is normal while a session is live.
		}
		if (!message) {
			continue;
		}
		if (typeof message.model === 'string' && message.model) {
			usage.model = message.model.toLowerCase();
		}
		const consumed = message.usage;
		if (!consumed) {
			continue;
		}
		usage.hasData = true;
		usage.output_tokens += consumed.output_tokens || 0;
		usage.input_tokens = consumed.input_tokens || 0;
		usage.cached_input_tokens =
			(consumed.cache_read_input_tokens || 0) + (consumed.cache_creation_input_tokens || 0);
	}
	return usage;
}

// The host derives a project directory name from the working directory by replacing every path
// separator and drive colon with a dash.
function slugForCwd(cwd) {
	return String(cwd || process.cwd()).replace(/[\\/:]/g, '-');
}

// Mirrors clio's TelemetryStoragePaths so consent can be read without starting clio: spawning a
// server only to be told "denied" would put a second of latency on every session that opted out.
function telemetryHome() {
	if (process.env.CLIO_TELEMETRY_HOME) {
		return process.env.CLIO_TELEMETRY_HOME;
	}
	if (process.env.CLIO_HOME) {
		return path.join(process.env.CLIO_HOME, 'telemetry');
	}
	const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
	return path.join(localAppData, 'creatio', 'clio', 'telemetry');
}

// Only a stored `granted` emits. `unknown` must NOT be answered here: consent is stored per
// installation, so a hook deciding on the developer's behalf would settle the question for every
// future session on the machine — and a fabricated decision is not consent.
function consentGranted() {
	try {
		const raw = fs.readFileSync(path.join(telemetryHome(), 'consent.json'), 'utf8').replace(/^﻿/, '');
		return JSON.parse(raw).telemetry_consent === 'granted';
	} catch {
		return false;
	}
}

function stateDir() {
	const dir = path.join(os.tmpdir(), 'caadt-telemetry-routing');
	fs.mkdirSync(dir, { recursive: true });
	sweepStaleMarkers(dir);
	return dir;
}

// Marker files are per session and nothing removes them when a session ends, so without this they
// accumulate for as long as the machine lives. Cleaning on read costs one directory listing on the
// paths that already touch the directory, and only unlinks what no live session can still claim:
// `claimOnce` relies on exclusive-create, so removing a marker a running session still holds would
// let it emit a second floor event.
const MARKER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sweepStaleMarkers(dir) {
	try {
		const cutoff = Date.now() - MARKER_TTL_MS;
		for (const name of fs.readdirSync(dir)) {
			const file = path.join(dir, name);
			try {
				if (fs.statSync(file).mtimeMs < cutoff) {
					fs.rmSync(file, { force: true });
				}
			} catch {
				// Raced with another hook process; whoever won already handled it.
			}
		}
	} catch {
		// A sweep that cannot run is not a reason to skip telemetry.
	}
}

function markerPath(sessionId, suffix) {
	const safeId = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128) || 'unknown';
	return path.join(stateDir(), `${safeId}.${suffix}`);
}

// Claimed with 'wx' so two hook processes racing on parallel tool calls cannot both act.
function claimOnce(sessionId, suffix) {
	try {
		fs.writeFileSync(markerPath(sessionId, suffix), '', { flag: 'wx' });
		return true;
	} catch {
		return false;
	}
}

// How much output the session had already reported. A turn that spent nothing — the developer typed
// something the agent answered from context, or a Stop the host repeated — would otherwise re-send an
// identical row, which is noise in a series whose whole meaning is that it grows.
function lastReported(sessionId) {
	try {
		const stored = JSON.parse(fs.readFileSync(markerPath(sessionId, 'usage'), 'utf8'));
		return { output: stored.output || 0, size: stored.size || 0 };
	} catch {
		return { output: 0, size: 0 };
	}
}

function rememberReported(sessionId, outputTokens, transcriptSize) {
	try {
		fs.writeFileSync(markerPath(sessionId, 'usage'), JSON.stringify({
			output: outputTokens, size: transcriptSize
		}));
	} catch {
		// A marker we cannot write costs one duplicate reading, never a lost one.
	}
}

// Path the transcript is read from, resolved the same way `readSessionUsage` resolves it.
function transcriptPath(payload) {
	return payload?.transcript_path
		|| path.join(os.homedir(), '.claude', 'projects', slugForCwd(payload?.cwd), `${payload?.session_id}.jsonl`);
}

function transcriptSize(payload) {
	try {
		return fs.statSync(transcriptPath(payload)).size;
	} catch {
		return 0;
	}
}

// Recorded on EVERY clio call, before consent and independently of the floor, because its only job is
// to answer "did this session use clio at all" — which is what scopes the `Stop` handler to Creatio
// work. Kept separate from the floor's one-shot claim so neither can consume the other.
function markTouchedClio(sessionId) {
	try {
		fs.writeFileSync(markerPath(sessionId, 'touched'), '');
	} catch {
		// Unwritable state means Stop stays silent for this session: the conservative direction.
	}
}

function touchedClio(sessionId) {
	try {
		return fs.existsSync(markerPath(sessionId, 'touched'));
	} catch {
		return false;
	}
}

function releaseClaim(sessionId, suffix) {
	try {
		fs.rmSync(markerPath(sessionId, suffix), { force: true });
	} catch {
		// A marker we cannot clear only costs one skipped reminder.
	}
}

// Tools that CHANGE the environment, by verb. A list of names would go stale against a clio release
// that adds tools; the verb is the part of the naming convention that does not move.
//
// `clio-run` is deliberately NOT here: it is the generic executor, used for reads as often as writes,
// so counting it as a write would spend the write reminder on an inspection. `clio-run-destructive`
// is unambiguous and is included.
// Over-inclusion is the safe direction here and the list leans that way deliberately: a verb that is
// not really a write costs one extra reminder per session, while a missing write costs a whole run's
// telemetry. That is not hypothetical — `modify-` was absent from the first version of this list, so
// `modify-entity-schema-column`, the most ordinary write in Creatio, did not count as one.
const WRITE_VERBS = [
	'create-', 'update-', 'modify-', 'delete-', 'remove-', 'add-', 'set-', 'install-', 'uninstall-',
	'deploy-', 'push-', 'sync-', 'link-', 'unlink-', 'upload-', 'generate-', 'compile-', 'build-',
	'apply-', 'enable-', 'disable-', 'clear-', 'restore-', 'start-', 'stop-', 'restart',
	'clio-run-destructive'
];

function bareTool(toolName) {
	return String(toolName ?? '').split('__').pop() ?? '';
}

// The verb to judge is the one that actually runs, and on this server that is usually NOT the tool
// name: clio advertises two executors (`clio-run`, `clio-run-destructive`) plus read-only tools, and
// every mutation travels as the executor's `command` argument. Matching the tool name alone therefore
// classified a schema edit as a read — measured, with `modify-entity-schema-column` arriving inside
// `clio-run` and the write reminder never firing.
function writeVerbSubject(payload) {
	const bare = bareTool(payload?.tool_name);
	if (bare === 'clio-run' || bare === 'clio-run-destructive') {
		// The host passes the executor's own parameters, where `command` sits at the TOP level next to
		// the command's `args` — captured from real payloads: {"command":"get-user-culture","args":{…}}.
		// The nested form is accepted too, because the tool's schema wraps parameters in `args` and both
		// shapes appear in practice; reading only the nested one classified every real write as a read.
		const command = payload?.tool_input?.command ?? payload?.tool_input?.args?.command;
		// A destructive executor with no readable command is still a write: that is what its name says.
		return typeof command === 'string' && command ? command : bare;
	}
	return bare;
}

function isWriteCall(payload) {
	const subject = writeVerbSubject(payload);
	return WRITE_VERBS.some(verb => subject.startsWith(verb));
}

// One batched stdio MCP conversation: initialize, initialized, tools/call. The server is
// line-oriented and processes the messages in order, so the whole exchange fits in a single
// spawnSync without an async client.
function emitEvent(sessionId, usage, eventName) {
	const request = [
		{
			jsonrpc: '2.0',
			id: 1,
			method: 'initialize',
			params: {
				protocolVersion: '2024-11-05',
				capabilities: {},
				clientInfo: { name: 'caadt-telemetry-hook', version: '1' }
			}
		},
		{ jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
		{
			jsonrpc: '2.0',
			id: 2,
			method: 'tools/call',
			params: {
				name: 'clio-run',
				arguments: {
					args: {
						// send-telemetry is not advertised in tools/list, so it goes through the
						// advertised executor rather than being named directly.
						command: 'send-telemetry',
						args: {
							session_id: sessionId,
							event_name: eventName,
							workflow: FLOOR_WORKFLOW,
							// Omitted rather than guessed: clio requires neither, and a placeholder lands a
							// real installation in a cohort that never existed.
							...(CODING_AGENT ? { coding_agent: CODING_AGENT } : {}),
							...(PLUGIN_VERSION ? { plugin_version: PLUGIN_VERSION } : {}),
							// Omitted rather than sent empty when the transcript was unreadable: a zero
							// would be indistinguishable from a session that genuinely spent nothing.
							...(usage.model ? { model: usage.model } : {}),
							// Omitted together when the transcript reported nothing, for the same reason as
							// `model`: a row of zeros is indistinguishable from a session that spent nothing.
							...(usage.hasData ? {
								input_tokens: usage.input_tokens,
								output_tokens: usage.output_tokens,
								cached_input_tokens: usage.cached_input_tokens
							} : {})
						}
					}
				}
			}
		}
	]
		.map(message => JSON.stringify(message))
		.join('\n');

	const result = spawnSync(CLIO, ['mcp-server'], {
		input: `${request}\n`,
		encoding: 'utf8',
		timeout: CALL_TIMEOUT_MS,
		windowsHide: true
	});
	return typeof result.stdout === 'string' && result.stdout.includes('"recorded"');
}

function main() {
	const payload = readStdin();
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
	// Stop fires per response, so this runs many times per session. When the transcript has not grown
	// since the last reading there is provably nothing new, so the file is not read or parsed at all —
	// a stat instead of a full parse of a file that reaches megabytes. (Parsing only the appended tail
	// would save more, but it needs a byte offset that survives truncation and partial lines; the
	// growth check removes the repeated work on quiet turns without that state.)
	const size = transcriptSize(payload);
	const previous = lastReported(sessionId);
	if (size !== 0 && size === previous.size) {
		return;
	}
	const usage = readSessionUsage(payload);
	// An unchanged or unreadable total is not worth a reading: a row of zeroes is indistinguishable from
	// a session that genuinely spent nothing, and a repeat says nothing in a series that means growth.
	if (!usage.hasData || usage.output_tokens <= previous.output) {
		return;
	}
	emitEvent(sessionId, usage, 'session_usage');
	rememberReported(sessionId, usage.output_tokens, size);
}

// A clio MCP call: the floor event, and the routing the agent needs to build a funnel on top of it.
function routeClioCall(payload, sessionId) {
	const toolName = payload?.tool_name ?? '';
	if (!toolName.includes('clio') || TELEMETRY_TOOLS.some(tool => toolName.endsWith(tool))) {
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
	const floorClaimed = claimOnce(sessionId, 'claimed');
	const remind = claimOnce(sessionId, 'turn') || (isWriteCall(payload) && claimOnce(sessionId, 'write'));
	if (!floorClaimed && !remind) {
		return;
	}
	if (floorClaimed) {
		// Emitted whether or not the routing reaches the agent: if clio rejected the call (an older clio,
		// a broken install), the agent's own stages are then the only telemetry there is.
		emitEvent(sessionId, readSessionUsage(payload), 'workflow_started');
	}
	const routing = remind ? routingOutput(sessionId) : null;
	if (routing) {
		process.stdout.write(routing);
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

try {
	main();
} catch {
	// Never fail the tool call this hook is attached to.
}
process.exit(0);

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
import { spawn } from 'node:child_process';
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
// Named once and reused everywhere this classification matters (the safety check right below, and
// the cwd-pinning decision in dispatch()), rather than repeating the same regex at each call site —
// two copies of a security-relevant test can drift if only one is ever updated (e.g. to also treat
// `.`/`..` as path-like).
function looksLikePath(value) {
	return /[\\/]/.test(value);
}
// This hook runs automatically on every matching tool call, so the variable naming the executable is
// a repeated code-execution primitive for anything that can set it before the host launches. It is
// an install-time knob, and validating it costs nothing: a value that LOOKS like a path must resolve
// to a real file, mirroring the `is_file()` guard `runtime/scripts/mcp_client.py` applies to
// `CLIO_CMD`. A bare command name is left to PATH resolution, which is the documented default.
const CLIO_IS_SAFE = (() => {
	if (!looksLikePath(CLIO)) {
		return true;
	}
	try {
		return fs.statSync(CLIO).isFile();
	} catch {
		return false;
	}
})();
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
// clio's own validator for `model`, `workflow` and `variant`: 1-64 chars of lowercase letters,
// digits, '.', '_' or '-'. Restated here because sending a value it refuses costs the event.
const MODEL_TOKEN = /^[a-z0-9._-]{1,64}$/;
// A failed floor emit releases its claim so the next clio call retries, but not without end: an
// installation whose clio refuses every send would otherwise spawn one for every tool call.
const FLOOR_ATTEMPT_LIMIT = 3;
// How long an unanswered dispatch stays 'pending' before it is read as a refusal. Comfortably longer
// than clio's measured start-up (~1.2s for the whole exchange), short enough that a session with a
// broken clio still retries within itself.
const OUTCOME_GRACE_MS = 10_000;
// The JSON-RPC id of the tools/call in the batch below, so the answer is matched to the request
// rather than to whatever else the server happened to print.
const TOOL_CALL_ID = 2;
// How much of the transcript's head is fingerprinted to decide whether a remembered byte offset
// still refers to the same file. Enough to catch a rewrite, small enough to be free.
const PREFIX_SAMPLE_BYTES = 4096;
// Bumped whenever the scan record's shape changes, so a record left by an older version of this file
// is discarded rather than half-understood.
const SCAN_RECORD_VERSION = 1;
// The floor is one event, so FLOOR_ATTEMPT_LIMIT bounds it. `session_usage` is a series and its
// guard is "the transcript grew", which is true on nearly every response — so a clio that never
// confirms a reading (an older clio rejecting the event, a broken binary) would re-read and re-parse
// the whole transcript AND spawn a process on every remaining response of the session. The reading
// itself stays retryable; what is bounded is how many unconfirmed ones a session pays for.
const USAGE_ATTEMPT_LIMIT = 5;

// How many candidate nonces claimUsageNonce() tries before giving up on this Stop. Generous relative
// to the realistic collision window (two hook processes for the same session landing on the exact
// same unconfirmed-count read at the exact same moment), never hit in normal operation.
const USAGE_NONCE_CLAIM_ATTEMPTS = 8;

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
// Read INCREMENTALLY. `Stop` fires per response, and the growth check only skips turns where the file
// did not change at all, so an active session used to re-parse the whole transcript on nearly every
// response: measured on real transcripts from this machine, 23 ms at 5 MB and 97 ms at 35 MB, paid
// again each turn. Only the bytes appended since the last read are parsed now, with the remembered
// offset trusted only while a fingerprint of the file's head still matches — see `fingerprint`.
//
// `hasData` separates "read the transcript, it reported no usage" from "could not read it at all", so
// callers can omit the counters instead of shipping zeros that look like a session that spent nothing.
// Shared by both the resumable-offset and the rewrite/compaction branches below: whichever way the
// scan is restarted, what was already committed for this session carries forward as the baseline the
// new bytes accumulate on top of. Kept as one function so a future change (a new carried field, a
// different MODEL_TOKEN rule) cannot be applied to one branch and silently missed in the other.
function carryForwardBaseline(usage, previous) {
	usage.output_tokens = previous.output_tokens || 0;
	usage.input_tokens = previous.input_tokens || 0;
	usage.cached_input_tokens = previous.cached_input_tokens || 0;
	usage.hasData = previous.hasData === true;
	if (typeof previous.model === 'string' && MODEL_TOKEN.test(previous.model)) {
		usage.model = previous.model;
	}
}

function readSessionUsage(payload, knownSize) {
	const sessionId = payload?.session_id;
	const transcript = transcriptPath(payload);
	const usage = { model: null, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, hasData: false };
	// Some hosts state the model in the payload itself (Cursor does), which is the only place it is
	// available when the transcript is in a shape this reader does not parse. Validated like any other
	// model value, and still overridden by a real value read from a transcript below.
	if (typeof payload?.model === 'string' && MODEL_TOKEN.test(payload.model.toLowerCase())) {
		usage.model = payload.model.toLowerCase();
	}
	// The caller almost always already has this from transcriptSize()'s own stat, taken moments ago
	// to decide whether the transcript grew at all — a second stat of the same path would only ever
	// confirm what that one already found. Only re-stat when no such reading was handed in.
	let size = knownSize;
	if (size === undefined) {
		try {
			size = fs.statSync(transcript).size;
		} catch {
			return usage; // No transcript reachable: send the event without these fields.
		}
	}

	let handle;
	try {
		handle = fs.openSync(transcript, 'r');
	} catch {
		return usage;
	}
	try {
		// Where to start. A transcript only ever grows in normal operation, but "normal" is not a
		// guarantee: compaction rewrites it, and a rewritten file whose size happens to be larger
		// would make a remembered offset point into the middle of different content — silently
		// under-reporting the session's consumption, which is the one number this event carries. So
		// the offset is only trusted when a fingerprint of the file's first bytes still matches.
		const previous = readScan(sessionId);
		// Compared at the SAME prefix length that was hashed last time. Hashing `min(size, 4096)` and
		// comparing the result folded the sample length into the value, so for any transcript under
		// 4 KB — every transcript for the first minutes of a session — the value changed on every
		// append and the offset was never once reused. The whole incremental path was dead code.
		const resumable = previous !== null
			&& fingerprint(handle, size, previous.prefixLength) === previous.prefix
			&& size >= previous.size
			&& previous.offset <= size
			&& startsAtLineBoundary(handle, previous.offset);
		let from = 0;
		if (resumable) {
			from = previous.offset;
			carryForwardBaseline(usage, previous);
		} else if (previous) {
			// The file was REPLACED, not appended to — compaction rewrites a transcript shorter and
			// with a different head. Re-parsing it alone would restart the totals from zero, and the
			// monotonic gate in reportSessionUsage ("only report a total that grew") would then
			// compare the small new total against the large old one and skip every remaining reading
			// of the session. The series would look merely sparse while reporting nothing at all —
			// the exact failure this whole tier exists to prevent. So what was already committed is
			// carried forward as a baseline instead of being dropped.
			carryForwardBaseline(usage, previous);
		}
		const appended = readFrom(handle, from, size);
		// The last line of a live transcript usually has no trailing newline yet — including the turn
		// that just ended, which is the one this reading is about. So the split is between what is
		// COMMITTED and what is merely REPORTED: everything up to the final newline is added to the
		// persisted totals and its bytes are never read again, while the trailing fragment is counted
		// into this reading only. Committing it too would double it on the next Stop; skipping it
		// entirely would make every reading lag a turn behind, which is the opposite of the point.
		const lastBreak = appended.lastIndexOf('\n');
		const complete = lastBreak >= 0 ? appended.slice(0, lastBreak + 1) : '';
		const trailing = appended.slice(complete.length);
		accumulate(usage, complete);
		writeScan(sessionId, {
			v: SCAN_RECORD_VERSION,
			size,
			offset: from + Buffer.byteLength(complete, 'utf8'),
			prefix: fingerprint(handle, size, PREFIX_SAMPLE_BYTES),
			prefixLength: Math.min(size, PREFIX_SAMPLE_BYTES),
			output_tokens: usage.output_tokens,
			input_tokens: usage.input_tokens,
			cached_input_tokens: usage.cached_input_tokens,
			model: usage.model,
			hasData: usage.hasData
		});
		accumulate(usage, trailing);
	} catch {
		// Any failure falls back to reporting what was accumulated so far, never to a throw.
	} finally {
		try {
			fs.closeSync(handle);
		} catch {
			// Nothing to do.
		}
	}
	return usage;
}

// Sums `output_tokens` and takes the LATEST reading of the other two, which is what they mean: each
// assistant turn reports the whole prompt it just sent, so summing those grows quadratically with
// turn count — it produced a `cached_input_tokens` of 157,881,680 for a single session.
function accumulate(usage, text) {
	for (const line of text.split('\n')) {
		if (!line.startsWith('{')) {
			continue;
		}
		let message;
		try {
			message = JSON.parse(line)?.message;
		} catch {
			continue; // A partially flushed line is normal while a session is live.
		}
		if (!message) {
			continue;
		}
		// Validated against the shape clio enforces, not merely lowercased. Claude Code writes
		// synthetic assistant messages carrying `model: "<synthetic>"`, and clio rejects the WHOLE
		// event on a malformed token — so one such message after the last real turn used to cost the
		// floor, the tier this design calls guaranteed, for the entire session. An unusable value is
		// skipped rather than assigned, which keeps the last real model instead of overwriting it.
		if (typeof message.model === 'string' && !MODEL_TOKEN.test(message.model.toLowerCase())) {
			// A line whose model is not a usable token is not a real turn — Claude Code writes these
			// at turn boundaries (interrupt, API error, a no-op turn) with `model: "<synthetic>"` and
			// an all-zero usage block. Skipping only the model and keeping the block set
			// `hasData = true` and overwrote the two LATEST-READING fields with zeros, so a session
			// that had spent hundreds of thousands of tokens reported
			// `input_tokens: 0, cached_input_tokens: 0` and looked like a healthy reading. Measured:
			// two and three such lines in real transcripts on the machine this was written on.
			continue;
		}
		if (typeof message.model === 'string') {
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
}

// Cheap, non-cryptographic, and only ever compared against itself: it answers "are these the same
// first bytes as last time", not "what are they".
function fingerprint(handle, size, length) {
	// `length ?? PREFIX_SAMPLE_BYTES`, not `length || …`: a transcript that was genuinely 0 bytes at
	// the last scan has a legitimate `prefixLength: 0`, and `||` would treat that as "absent" and
	// substitute 4096 — hashing up to 4 KB of the CURRENT file against a prefix taken from an empty
	// sample, which always fails the resume check and forces a full re-parse.
	const sample = readFrom(handle, 0, Math.min(size, length ?? PREFIX_SAMPLE_BYTES));
	let hash = 5381;
	for (let index = 0; index < sample.length; index += 1) {
		hash = Math.imul(hash, 33) ^ sample.codePointAt(index);
	}
	// Just the hash. An earlier version returned `${sample.length}:${hash}`, which folded the sample
	// length in — and since the sample IS the whole file until it reaches 4 KB, the value changed on
	// every append and no offset was ever reused. The caller passes the length it hashed last time,
	// so what is compared is the content of the same prefix: an append leaves it alone, a rewrite
	// does not.
	return String(hash);
}

// An offset is only meaningful at a line boundary, and by construction it always is: it is either 0
// or one past a newline. Verified rather than assumed, because a rewrite that preserves the hashed
// head and grows past the old size passes every other check — and a mid-line offset silently
// mis-parses the rest of the session.
function startsAtLineBoundary(handle, offset) {
	if (offset === 0) {
		return true;
	}
	try {
		return readFrom(handle, offset - 1, offset) === '\n';
	} catch {
		return false;
	}
}

function readFrom(handle, from, to) {
	const length = Math.max(0, to - from);
	if (length === 0) {
		return '';
	}
	const buffer = Buffer.allocUnsafe(length);
	const read = fs.readSync(handle, buffer, 0, length, from);
	return buffer.subarray(0, read).toString('utf8');
}

function readScan(sessionId) {
	if (!sessionId) {
		return null;
	}
	let record;
	try {
		record = JSON.parse(fs.readFileSync(markerPath(sessionId, 'scan'), 'utf8'));
	} catch {
		return null;
	}
	// Validated, not trusted. Markers survive seven days, so a record written by an older version of
	// this file will be read by a newer one: an unrecognised version, or a counter that arrives as a
	// string, would flow straight into `+=` and be emitted as data. Rejecting a record costs one full
	// re-parse, which is the same cost as having no record at all.
	if (!record || record.v !== SCAN_RECORD_VERSION) {
		return null;
	}
	const numbers = [record.size, record.offset, record.prefixLength,
		record.output_tokens, record.input_tokens, record.cached_input_tokens];
	if (!numbers.every(value => Number.isInteger(value) && value >= 0)) {
		return null;
	}
	return record;
}

function writeScan(sessionId, scan) {
	if (!sessionId || !ensureStateDir()) {
		return;
	}
	try {
		fs.writeFileSync(markerPath(sessionId, 'scan'), JSON.stringify(scan), { mode: 0o600 });
	} catch {
		// Without the scan state the next read is a full parse: slower, never wrong.
	}
}

// The host derives a project directory name from the working directory by replacing every path
// separator and drive colon with a dash.
function slugForCwd(cwd) {
	// Measured against the real directories under ~/.claude/projects on the machine this was written
	// on: a cwd of `C:\Users\y.lypnytskyi\improve analytics` lives in
	// `C--Users-y-lypnytskyi-improve-analytics`. Replacing only separators left the dot in a username
	// and the space in a folder name, producing a path that does not exist — so the fallback silently
	// found no transcript, which is the only situation the fallback exists for.
	return String(cwd || process.cwd()).replace(/[^A-Za-z0-9]/g, '-');
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

let sweptThisProcess = false;

// POSIX-only: process.getuid does not exist on Windows, where the per-user temp directory's ACL is
// the only backstop (see the comment at stateDir()'s mkdirSync call). lstat, not stat, so a symlink
// planted at this path is caught rather than followed and reported as whatever it points to.
function assertStateDirIsOurs(dir) {
	if (typeof process.getuid !== 'function') {
		return;
	}
	const info = fs.lstatSync(dir);
	if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700) {
		throw new Error(`refusing to use telemetry state directory not owned/secured by this user: ${dir}`);
	}
}

// The path alone, created by nobody. `UserPromptSubmit` and `Stop` have no matcher support in the
// host — they fire on EVERY prompt and every response, including in sessions that never touch
// Creatio — so the read paths those events take must not create a directory or sweep one.
function stateDirPath() {
	return path.join(os.tmpdir(), 'caadt-telemetry-routing');
}

function stateDir() {
	const dir = stateDirPath();
	// 0o700: these files carry session ids and the usage payload, and they live in a shared temp
	// directory whose paths are predictable. On a multi-user host the default mode would let another
	// local user read them, or pre-plant a symlink where a marker is about to be written. The mode is
	// advisory on Windows, where the ACL of the per-user temp directory is what actually applies.
	fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
	// `recursive: true` is a silent no-op on a directory that already exists: it neither applies the
	// requested mode nor checks who owns it. On a multi-user host that gap would let another local
	// account pre-create — or symlink — this predictable path before the legitimate user's first hook
	// invocation ever runs, landing every marker this file writes (including the ones just hardened
	// to 0o600) somewhere an attacker controls. Failing closed here, like every other unsafe condition
	// in this file, rather than trusting a directory this process did not just create.
	assertStateDirIsOurs(dir);
	// Every claim, read and release resolves a path through here, so an unconditional sweep ran a
	// full directory listing plus a stat per file SEVERAL times per hook invocation, and the cost
	// grew with every stale marker any session on the machine had ever left. Housekeeping does not
	// need that cadence: once per process, and at most once a day across processes.
	if (!sweptThisProcess) {
		sweptThisProcess = true;
		if (sweepIsDue(dir)) {
			sweepStaleMarkers(dir);
		}
	}
	return dir;
}

// A stamp file rather than an in-memory guard, because each hook invocation is its own process:
// without it "once per process" still means once per tool call. A stamp that cannot be written or
// read leaves the sweep due, so the failure mode is the old cost, never an unbounded directory.
function sweepIsDue(dir) {
	const stamp = path.join(dir, '.swept');
	try {
		if (Date.now() - fs.statSync(stamp).mtimeMs < SWEEP_INTERVAL_MS) {
			return false;
		}
	} catch {
		// Never swept, or the stamp is unreadable: due.
	}
	try {
		fs.writeFileSync(stamp, '');
	} catch {
		// Cannot record the sweep; running it anyway is correct, it just will not be rate-limited.
	}
	return true;
}

// Marker files are per session and nothing removes them when a session ends, so without this they
// accumulate for as long as the machine lives. Cleaning on read costs one directory listing on the
// paths that already touch the directory, and only unlinks what no live session can still claim:
// `claimOnce` relies on exclusive-create, so removing a marker a running session still holds would
// let it emit a second floor event.
const MARKER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function sweepStaleMarkers(dir) {
	try {
		const cutoff = Date.now() - MARKER_TTL_MS;
		for (const name of fs.readdirSync(dir)) {
			if (name === '.swept') {
				continue; // The sweep's own rate-limit stamp, not a session marker.
			}
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

// Shared sanitizer for turning a session_id into a filesystem-safe path component: session_id is
// attacker-adjacent input (it rides in on the payload), so every place that builds a path from it —
// markers here and the transcript path below — must strip it down first, never interpolate it raw.
function sanitizeSessionId(sessionId) {
	return String(sessionId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128) || 'unknown';
}

function markerPath(sessionId, suffix) {
	const safeId = sanitizeSessionId(sessionId);
	return path.join(stateDirPath(), `${safeId}.${suffix}`);
}

// Removes one dispatch's request/outcome file pair once its outcome is no longer needed — resolved
// (recorded, unknown, or a promoted/abandoned refusal) rather than still pending. Best-effort: a
// failed unlink costs nothing but leaving the pair for the once-a-week sweep, never a lost reading, so
// it is never allowed to throw.
function removeDispatchFiles(sessionId, kind, nonce) {
	for (const suffix of ['request', 'outcome']) {
		try {
			fs.rmSync(markerPath(sessionId, `${kind}-${nonce}-${suffix}`), { force: true });
		} catch {
			// Left for sweepStaleMarkers; not a correctness problem, only a tidiness one.
		}
	}
}

// Called only where something is about to be WRITTEN, so a read of a marker that does not exist
// costs one failed stat instead of a directory creation plus a sweep.
function ensureStateDir() {
	try {
		stateDir();
		return true;
	} catch {
		return false;
	}
}

// Claimed with 'wx' so two hook processes racing on parallel tool calls cannot both act.
function claimOnce(sessionId, suffix) {
	if (!ensureStateDir()) {
		return false;
	}
	try {
		fs.writeFileSync(markerPath(sessionId, suffix), '', { flag: 'wx', mode: 0o600 });
		return true;
	} catch {
		return false;
	}
}

// How much output the session had already reported. A turn that spent nothing — the developer typed
// something the agent answered from context, or a Stop the host repeated — would otherwise re-send an
// identical row, which is noise in a series whose whole meaning is that it grows.
//
// A reading dispatched but not yet confirmed is held as `pending` and only becomes the reported
// figure once clio says it stored it. Anything else — refused, or an answer still not written — leaves
// the older confirmed figure in place, so the reading is sent again.
// One read+parse of the 'usage' marker, and — if a reading is pending — one readOutcome call, per
// Stop. lastReported() and inFlightReading() used to do this independently (each its own read/parse
// pass over the same file), and rememberPending() read it a third time; Stop fires on every assistant
// response for the life of a session, so tripling that cost bought nothing. Also performs the
// promotion side effect lastReported() used to: once an outcome resolves, the pending record is
// cleared from the marker either way (promoted into `reported` on success, simply dropped on refusal).
function resolveAndPromoteUsageState(sessionId) {
	let stored;
	try {
		stored = JSON.parse(fs.readFileSync(markerPath(sessionId, 'usage'), 'utf8'));
	} catch {
		return { reported: { output: 0, size: 0 }, inFlight: null };
	}
	let reported = { output: stored.output || 0, size: stored.size || 0 };
	let inFlight = null;
	if (stored.pending) {
		const outcome = readOutcome(sessionId, 'usage', stored.pending.nonce);
		if (outcome === 'pending') {
			inFlight = { output: stored.pending.output || 0, size: stored.pending.size || 0 };
		} else {
			if (outcome === 'recorded' || outcome === 'unknown') {
				// `unknown` counts as delivered here, unlike on the floor path. A duplicate reading in
				// a series whose meaning is its maximum costs nothing; re-sending forever because an
				// answer was merely unfamiliar would end the series at the attempt limit, which costs
				// the data.
				reported = { output: stored.pending.output || 0, size: stored.pending.size || 0 };
				noteUsageAttempt(sessionId, true);
			}
			writeUsageMarker(sessionId, reported, null);
			// This nonce's request/outcome pair is done: promoted above, or abandoned as a refusal
			// old enough that `outcome` is no longer 'pending'. Without this, the per-dispatch files
			// this design switched to (up to USAGE_ATTEMPT_LIMIT per session, every session that ever
			// touches clio) would only ever be reclaimed by the once-a-week sweep.
			removeDispatchFiles(sessionId, 'usage', stored.pending.nonce);
		}
	}
	return { reported, inFlight };
}

function lastReported(sessionId) {
	return resolveAndPromoteUsageState(sessionId).reported;
}

// How many readings this session has dispatched without clio confirming any of them. Reset on the
// first confirmation, so a session that reports normally is never bounded — only one that is failing.
// Monotonic per session, so two dispatches never share a filename. Derived from the attempt counter
// rather than from a clock, because the clock is not available to this file's tests deterministically
// and the counter already exists.
function usageNonce(unconfirmedCount) {
	return `u${unconfirmedCount}`;
}

// countUnconfirmedUsage() is a plain read: two hook processes for the same session racing on the same
// Stop can read the identical count and, before this fix, would derive the identical nonce and collide
// on request/outcome files opened with plain 'w' — the exact truncation class the per-dispatch-nonce
// redesign existed to remove, just reappearing on the usage path. Claiming the nonce with the same
// 'wx' exclusive-create claimOnce() already uses for the floor makes only the winning process able to
// use a given count; a loser tries the next candidate instead of colliding. Returns null if every
// candidate in range is already claimed — the caller skips this Stop's dispatch rather than risk one.
function claimUsageNonce(sessionId, baseCount) {
	for (let count = baseCount; count < baseCount + USAGE_NONCE_CLAIM_ATTEMPTS; count += 1) {
		const nonce = usageNonce(count);
		if (claimOnce(sessionId, `usage-claim-${nonce}`)) {
			return nonce;
		}
	}
	return null;
}

function countUnconfirmedUsage(sessionId) {
	try {
		return Number.parseInt(fs.readFileSync(markerPath(sessionId, 'usage-attempts'), 'utf8'), 10) || 0;
	} catch {
		return 0;
	}
}

function noteUsageAttempt(sessionId, confirmed) {
	ensureStateDir();
	try {
		if (confirmed) {
			fs.rmSync(markerPath(sessionId, 'usage-attempts'), { force: true });
			return;
		}
		fs.writeFileSync(markerPath(sessionId, 'usage-attempts'),
			String(countUnconfirmedUsage(sessionId) + 1), { mode: 0o600 });
	} catch {
		// Cannot count: leave the bound to the transcript-size guard rather than stopping the series.
	}
}

// The reading already dispatched and not yet answered, if any. `null` once clio has answered either
// way, so a refusal reopens the reading rather than suppressing it forever.
function inFlightReading(sessionId) {
	return resolveAndPromoteUsageState(sessionId).inFlight;
}

function writeUsageMarker(sessionId, reported, pending) {
	ensureStateDir();
	try {
		fs.writeFileSync(markerPath(sessionId, 'usage'), JSON.stringify({
			output: reported.output, size: reported.size, ...(pending ? { pending } : {})
		}), { mode: 0o600 });
	} catch {
		// A marker we cannot write costs one duplicate reading, never a lost one.
	}
}

function rememberPending(sessionId, reported, outputTokens, transcriptSize, nonce) {
	// `reported` is passed in rather than re-read: the caller already resolved it this Stop (via
	// resolveAndPromoteUsageState), and nothing between that read and this write touches the 'usage' marker —
	// dispatch only writes the nonce-keyed request/outcome files. The dispatch just truncated this
	// kind's outcome file, so the reading is unconfirmed by construction; a later Stop promotes it
	// once clio's answer is there.
	writeUsageMarker(sessionId, reported, { output: outputTokens, size: transcriptSize, nonce });
}

// Path the transcript is read from, resolved the same way `readSessionUsage` resolves it.
function transcriptPath(payload) {
	return payload?.transcript_path
		|| path.join(os.homedir(), '.claude', 'projects', slugForCwd(payload?.cwd), `${sanitizeSessionId(payload?.session_id)}.jsonl`);
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
	// This is the FIRST write of a session, so it is the one that has to create the directory:
	// `markerPath` deliberately resolves without side effects now, and without this the marker
	// silently failed to appear on a fresh machine — leaving Stop silent for the whole session.
	ensureStateDir();
	try {
		fs.writeFileSync(markerPath(sessionId, 'touched'), '', { mode: 0o600 });
	} catch {
		// Unwritable state means Stop stays silent for this session: the conservative direction.
	}
}

// Whether this session has ever called clio. One stat and no writes, which is what keeps the
// always-firing events out of the filesystem in sessions that have nothing to do with Creatio.
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

// Whether the floor may be attempted again after attempt `n`. Read-only by design: it asks what clio
// said about that attempt's own dispatch, and never mutates a claim, so two processes asking at the
// same time cannot between them produce two dispatches.
//
// `rejected` is retryable — a refused send stored nothing. `none` is retryable only once the claim has
// aged past the grace period, which covers the process dying between claiming and dispatching: the
// claim exists, no answer ever will, and without this the guaranteed event is lost for the session.
// `recorded`, `unknown` and `pending` are all NOT retryable: the first two mean an event may well be
// stored, and retrying on either duplicates it.
function floorRetryable(sessionId, attempt) {
	const outcome = readOutcome(sessionId, 'floor', floorNonce(attempt));
	if (outcome === 'rejected') {
		return true;
	}
	if (outcome !== 'none') {
		return false;
	}
	try {
		const claimed = fs.statSync(markerPath(sessionId, floorClaimSuffix(attempt))).mtimeMs;
		return Date.now() - claimed >= OUTCOME_GRACE_MS;
	} catch {
		return false;
	}
}

function floorClaimSuffix(attempt) {
	return attempt === 0 ? 'claimed' : `claimed-${attempt}`;
}

function floorNonce(attempt) {
	return `a${attempt}`;
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
// Stands in for an executor call whose command could not be read. Not a verb, so it can never be
// confused with one, and handled explicitly by isWriteCall.
const UNRESOLVED_COMMAND = 'clio-run:command-unreadable';

const WRITE_VERBS = [
	'create-', 'update-', 'modify-', 'delete-', 'remove-', 'add-', 'set-', 'install-', 'uninstall-',
	'deploy-', 'push-', 'sync-', 'link-', 'unlink-', 'upload-', 'generate-', 'compile-', 'build-',
	'apply-', 'enable-', 'disable-', 'clear-', 'restore-', 'start-', 'stop-', 'restart',
	'clio-run-destructive'
];

function bareTool(toolName) {
	// String() rather than a cast: a host that sends a non-string tool name would otherwise throw
	// inside `includes`, and every throw on this path is swallowed — so the floor would go missing
	// for that call and nothing anywhere would say why.
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
		if (typeof command === 'string' && command) {
			return command;
		}
		// An executor whose command cannot be read is treated as a WRITE. `clio-run` alone is
		// read/write-ambiguous, and the two ways of being wrong are not equal: guessing read loses the
		// reminder on a real mutation, which is the case this mechanism exists for, while guessing
		// write costs at most one extra reminder in a turn that is already bounded to one.
		return UNRESOLVED_COMMAND;
	}
	return bare;
}

function isWriteCall(payload) {
	const subject = writeVerbSubject(payload);
	return subject === UNRESOLVED_COMMAND || WRITE_VERBS.some(verb => subject.startsWith(verb));
}

// One batched stdio MCP conversation: initialize, initialized, tools/call. The server is
// line-oriented and processes the messages in order, so the whole exchange is a single write and
// needs no async client - which is what lets the call be handed off and left to finish on its own.
function emitEvent(sessionId, usage, eventName, nonce) {
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
			id: TOOL_CALL_ID,
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

	return dispatch(sessionId, eventName === 'session_usage' ? 'usage' : 'floor', nonce, request);
}

// Fire-and-forget, deliberately. This runs inside a PostToolUse hook, so anything awaited here is
// time the developer's own tool call spends waiting: the previous spawnSync blocked the call it was
// observing for as long as clio took, up to CALL_TIMEOUT_MS, which contradicted the invariant this
// toolkit states everywhere else — telemetry must never gate or delay the task. A slow spawn (an
// exe being virus-scanned) or a hung clio made every matching tool call inherit the stall.
//
// The request goes through a FILE rather than a pipe: writing to a detached child's stdin and then
// letting this process exit can drop the buffered bytes, which would lose the event silently. clio's
// answer is redirected to a second file, so the outcome survives this process and the NEXT hook
// invocation can act on it — that is what keeps the retry and the usage gating working without
// waiting here for either.
function dispatch(sessionId, kind, nonce, request) {
	if (!CLIO_IS_SAFE || !ensureStateDir()) {
		return false;
	}
	let stdin;
	let stdout;
	try {
		// One pair of files PER DISPATCH, keyed by a nonce the caller remembers alongside what it is
		// waiting for. A single pair per kind meant a second dispatch truncated the request file a
		// still-running child was reading as its stdin, and truncated the outcome file it was writing
		// to — so one child's answer could be read as the other's, and a reading clio had accepted
		// was promoted or discarded at random. The children are detached and never awaited, so
		// overlap is normal, not exceptional: clio takes ~1.2s and a turn can end sooner than that.
		const requestFile = markerPath(sessionId, `${kind}-${nonce}-request`);
		fs.writeFileSync(requestFile, `${request}\n`, { mode: 0o600 });
		stdin = fs.openSync(requestFile, 'r');
		// Same 0o600 as the request file above: this marker carries the session id and, once clio
		// answers, the outcome of a usage/floor payload — the confidentiality intent stateDir()'s
		// 0o700 states is undercut if the file inside it defaults to the umask-derived ~0o666.
		stdout = fs.openSync(markerPath(sessionId, `${kind}-${nonce}-outcome`), 'w', 0o600);
		const child = spawn(CLIO, ['mcp-server'], {
			detached: true,
			stdio: [stdin, stdout, 'ignore'],
			// The bare default `clio` never reaches CLIO_IS_SAFE's file check — it is left to PATH
			// resolution, and on Windows that resolution consults the current directory and PATHEXT
			// (.bat/.cmd/.com) before PATH is exhausted, and Node does not honor
			// NoDefaultCurrentDirectoryInExePath (nodejs/node#46264). An untrusted/cloned repo used as
			// cwd could therefore supply its own `clio.bat` and have it run in place of the real tool.
			// Pinning cwd to the fixed, non-project state directory closes that off. A
			// `CAADT_TELEMETRY_CLIO` given as a path (how the suite substitutes a stub) already went
			// through CLIO_IS_SAFE's statSync against the real working directory, so it is left
			// resolving against that same directory here instead of being pinned.
			cwd: looksLikePath(CLIO) ? undefined : stateDirPath(),
			windowsHide: true
		});
		// An 'error' event with no listener THROWS. A missing or unrunnable binary emits one, and
		// while the synchronous `process.exit(0)` below normally wins the race, a guarantee that
		// depends on exit timing is not a guarantee. One no-op listener removes the dependency.
		child.on('error', () => {});
		child.unref();
		return true;
	} catch {
		return false; // Could not even start: treated exactly like a rejection.
	} finally {
		for (const handle of [stdin, stdout]) {
			try {
				if (handle !== undefined) {
					fs.closeSync(handle);
				}
			} catch {
				// The child holds its own duplicate of the descriptor.
			}
		}
	}
}

// Reads clio's answer as the JSON-RPC response it is, rather than searching the raw bytes for a
// substring: an error whose prose happens to contain `"recorded"` — "already recorded for this
// session", a schema message naming a `recorded` field — would otherwise be read as success, and this
// outcome decides whether the floor claim is kept forever or released for retry. A false success
// there silently drops the one event this file exists to guarantee.
//
// Returns true/false when the response says something definite, and null when it cannot be parsed at
// all, so the caller can fall back to the older check rather than treat an unrecognised shape as a
// refusal.
function parseRecorded(answer) {
	let seenResponse = false;
	for (const line of answer.split('\n')) {
		if (!line.startsWith('{')) {
			continue;
		}
		let message;
		try {
			message = JSON.parse(line);
		} catch {
			continue;
		}
		if (message?.id !== TOOL_CALL_ID) {
			continue;
		}
		seenResponse = true;
		if (message.error) {
			return false;
		}
		const status = telemetryStatus(message.result);
		if (status !== null) {
			return status === 'recorded';
		}
	}
	// A response arrived but carried no status and no error this code understands. Not something to
	// call success on its own, and not something to call a refusal either: null sends the caller to
	// the substring fallback, which is what shipped before, so an unrecognised shape can never make
	// the floor worse than it already was.
	return null;
}

// clio returns the tool's result either as `structuredContent` or, for the long-tail default, as a
// JSON document inside a text content block. Both are read, because which one appears is clio's
// choice and not part of any contract this hook can rely on.
function telemetryStatus(result) {
	if (!result || typeof result !== 'object') {
		return null;
	}
	const structured = result.structuredContent;
	if (structured && typeof structured.status === 'string') {
		return structured.status;
	}
	for (const block of Array.isArray(result.content) ? result.content : []) {
		if (typeof block?.text !== 'string') {
			continue;
		}
		try {
			const payload = JSON.parse(block.text);
			if (typeof payload?.status === 'string') {
				return payload.status;
			}
		} catch {
			// Not a JSON block: prose for an older client, which says nothing machine-readable.
		}
	}
	return null;
}

// Whether the answer is a whole line rather than one being written right now. A half-written line
// must stay `pending`, because calling it definite is what turned a live write into a false refusal.
function looksComplete(answer) {
	for (const line of answer.split('\n')) {
		if (!line.startsWith('{')) {
			continue;
		}
		try {
			JSON.parse(line);
			return true;
		} catch {
			// Keep looking: an earlier line may be complete even while the last one is not.
		}
	}
	return false;
}

// What clio said about the PREVIOUS dispatch of this kind, read on a later invocation.
//   'recorded'  clio stored the event.
//   'rejected'  clio answered something else, or the spawn never produced an answer.
//   'pending'   the answer has not landed yet — the child may still be running.
//   'none'      nothing was ever dispatched.
// Anything short of 'recorded' is retried, so an answer that arrives late costs a duplicate reading
// rather than a lost one, which is the right way round for a series whose meaning is that it grows.
function readOutcome(sessionId, kind, nonce) {
	const file = markerPath(sessionId, `${kind}-${nonce}-outcome`);
	let stat;
	let answer = '';
	try {
		stat = fs.statSync(file);
		answer = fs.readFileSync(file, 'utf8');
	} catch {
		return 'none';
	}
	const parsed = parseRecorded(answer);
	if (parsed !== null) {
		return parsed ? 'recorded' : 'rejected';
	}
	if (looksComplete(answer)) {
		// Only a complete line reaches the substring fallback: a half-written line can contain the
		// literal bytes "recorded" inside a field this code does not parse as status (e.g. an
		// allowed-values list), and calling that terminal before the write finishes is the false
		// success this ordering exists to prevent.
		if (answer.includes('"recorded"')) {
			// Last resort for a shape this code does not recognise: the check that shipped before. A
			// structured status or an error object always wins over it, which is what removes the false
			// success on a rejection whose prose happens to contain the word.
			return 'recorded';
		}
		// An answer arrived, it parses as a complete JSON-RPC line, and it states neither a status
		// this code reads nor an error. That is NOT a refusal: inside a JSON-encoded text block the
		// bytes are \"recorded\", which the substring check above cannot see, so a recorded event
		// whose shape is merely unfamiliar would otherwise be retried — up to the attempt limit,
		// emitting the floor two more times and corrupting the denominator it exists to be.
		return 'unknown';
	}
	// Nothing definite. Either the child has not answered yet, it is answering RIGHT NOW and this is
	// half a line, or it never ran at all — a detached spawn reports neither exit code nor error
	// here, so a missing binary looks exactly like a slow one. Only time separates them: calling a
	// half-written answer a refusal cost a duplicate reading under load, and calling a permanently
	// absent one 'pending' would leave the floor waiting on an answer that is never coming.
	return Date.now() - stat.mtimeMs < OUTCOME_GRACE_MS ? 'pending' : 'rejected';
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
	// Each attempt is its own exclusively-created claim (`claimed`, `claimed-1`, `claimed-2`), so a
	// retry never deletes a claim another process may have just taken. Releasing and re-claiming was
	// two operations: two hook processes running in parallel — which Claude Code produces routinely by
	// batching tool calls — could interleave them so that both ended up holding a claim and both
	// dispatched a floor event. An over-counted floor is worse than an under-counted funnel, because
	// every reliability ratio is computed against it.
	let attempt = 0;
	let floorClaimed = claimOnce(sessionId, floorClaimSuffix(attempt));
	while (!floorClaimed && attempt + 1 < FLOOR_ATTEMPT_LIMIT) {
		if (!floorRetryable(sessionId, attempt)) {
			break;
		}
		// Deliberately NOT cleaned up here, unlike the usage path: floorRetryable() re-derives
		// "was this attempt rejected" from THIS OUTCOME FILE on every call — there is no durable
		// record of it anywhere else, since the floor has no equivalent of the usage marker's
		// promoted-total write. Deleting it early would force later calls onto the weaker,
		// GRACE-PERIOD-gated 'none' path instead, which is slower and (measured while writing this)
		// stalls the retry loop entirely once a later attempt's claim file already exists. Left for
		// the weekly sweep — at most FLOOR_ATTEMPT_LIMIT pairs per session, not per dispatch.
		attempt += 1;
		floorClaimed = claimOnce(sessionId, floorClaimSuffix(attempt));
	}
	const remind = claimOnce(sessionId, 'turn') || (isWriteCall(payload) && claimOnce(sessionId, 'write'));
	if (!floorClaimed && !remind) {
		return;
	}
	if (floorClaimed) {
		// Dispatched whether or not the routing reaches the agent: if clio refuses the call (an older
		// clio, a broken install), the agent's own stages are then the only telemetry there is. The
		// outcome is read on a later call rather than awaited here — see dispatch().
		emitEvent(sessionId, readSessionUsage(payload), 'workflow_started', floorNonce(attempt));
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

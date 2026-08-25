// The MCP conversation itself: building the request, handing it off to a detached clio process, and
// reading back what it answered. Split out because this is the one place that spawns anything, and
// every protocol module above it (floor, usage) only needs its two narrow entry points — emitEvent
// and readOutcome — never the spawn machinery itself.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { CLIO, CLIO_IS_SAFE, CODING_AGENT, PLUGIN_VERSION, looksLikePath } from './identity.mjs';
import { ensureStateDir, markerPath, stateDirPath } from './state-dir.mjs';

// The JSON-RPC id of the tools/call in the batch below, so the answer is matched to the request
// rather than to whatever else the server happened to print.
const TOOL_CALL_ID = 2;
// How long an unanswered dispatch stays 'pending' before it is read as a refusal. Comfortably longer
// than clio's measured start-up (~1.2s for the whole exchange), short enough that a session with a
// broken clio still retries within itself.
export const OUTCOME_GRACE_MS = 10_000;

// The reserved `workflow` value for the floor. The hook sees a tool name, not a workflow, so it
// cannot know which flow this is; a real-looking value would be a guess presented as data, and
// omitting the field would break the contract's own "always send workflow" rule. `unattributed`
// says exactly what happened and makes floor-only sessions countable.
export const FLOOR_WORKFLOW = 'unattributed';

// One batched stdio MCP conversation: initialize, initialized, tools/call. The server is
// line-oriented and processes the messages in order, so the whole exchange is a single write and
// needs no async client - which is what lets the call be handed off and left to finish on its own.
export function emitEvent(sessionId, usage, eventName, nonce) {
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
export function readOutcome(sessionId, kind, nonce) {
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

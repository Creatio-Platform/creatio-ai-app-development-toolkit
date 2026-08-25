// Reading the host's JSONL transcript incrementally to recover which model ran and what the session
// had consumed. Split out because this is the largest single responsibility in the original file and
// the least entangled with the others: it only ever reads (never claims or dispatches), through the
// scan-record marker file it owns exclusively (`{session}.scan`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureStateDir, markerPath, sanitizeSessionId } from './state-dir.mjs';

// clio's own validator for `model`, `workflow` and `variant`: 1-64 chars of lowercase letters,
// digits, '.', '_' or '-'. Restated here because sending a value it refuses costs the event.
export const MODEL_TOKEN = /^[a-z0-9._-]{1,64}$/;
// How much of the transcript's head is fingerprinted to decide whether a remembered byte offset
// still refers to the same file. Enough to catch a rewrite, small enough to be free.
const PREFIX_SAMPLE_BYTES = 4096;
// Bumped whenever the scan record's shape changes, so a record left by an older version of this file
// is discarded rather than half-understood.
const SCAN_RECORD_VERSION = 1;

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
export function readSessionUsage(payload, knownSize) {
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
	if (record?.v !== SCAN_RECORD_VERSION) {
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

// Path the transcript is read from, resolved the same way `readSessionUsage` resolves it.
export function transcriptPath(payload) {
	return payload?.transcript_path
		|| path.join(os.homedir(), '.claude', 'projects', slugForCwd(payload?.cwd), `${sanitizeSessionId(payload?.session_id)}.jsonl`);
}

export function transcriptSize(payload) {
	try {
		return fs.statSync(transcriptPath(payload)).size;
	} catch {
		return 0;
	}
}

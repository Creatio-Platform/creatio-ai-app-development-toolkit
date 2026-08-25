// The `session_usage` series' bookkeeping: what has been confirmed reported, what is in flight, and
// the nonce-claim dance that keeps two concurrent hook processes for the same session from colliding
// on the same dispatch files. Split out from the floor protocol for the same reason floor-protocol.mjs
// is separate — the two series are independent state machines that only share the underlying claim
// and outcome primitives.
import fs from 'node:fs';
import { claimOnce, ensureStateDir, markerPath, removeDispatchFiles } from './state-dir.mjs';
import { readOutcome } from './dispatch.mjs';

// The floor is one event, so FLOOR_ATTEMPT_LIMIT bounds it. `session_usage` is a series and its
// guard is "the transcript grew", which is true on nearly every response — so a clio that never
// confirms a reading (an older clio rejecting the event, a broken binary) would re-read and re-parse
// the whole transcript AND spawn a process on every remaining response of the session. The reading
// itself stays retryable; what is bounded is how many unconfirmed ones a session pays for.
export const USAGE_ATTEMPT_LIMIT = 5;

// How many candidate nonces claimUsageNonce() tries before giving up on this Stop. Generous relative
// to the realistic collision window (two hook processes for the same session landing on the exact
// same unconfirmed-count read at the exact same moment), never hit in normal operation.
export const USAGE_NONCE_CLAIM_ATTEMPTS = 8;

// One read+parse of the 'usage' marker, and — if a reading is pending — one readOutcome call, per
// Stop. lastReported() and inFlightReading() used to do this independently (each its own read/parse
// pass over the same file), and rememberPending() read it a third time; Stop fires on every assistant
// response for the life of a session, so tripling that cost bought nothing. Also performs the
// promotion side effect lastReported() used to: once an outcome resolves, the pending record is
// cleared from the marker either way (promoted into `reported` on success, simply dropped on refusal).
export function resolveAndPromoteUsageState(sessionId) {
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

export function lastReported(sessionId) {
	return resolveAndPromoteUsageState(sessionId).reported;
}

// The reading already dispatched and not yet answered, if any. `null` once clio has answered either
// way, so a refusal reopens the reading rather than suppressing it forever.
export function inFlightReading(sessionId) {
	return resolveAndPromoteUsageState(sessionId).inFlight;
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
export function claimUsageNonce(sessionId, baseCount) {
	for (let count = baseCount; count < baseCount + USAGE_NONCE_CLAIM_ATTEMPTS; count += 1) {
		const nonce = usageNonce(count);
		if (claimOnce(sessionId, `usage-claim-${nonce}`)) {
			return nonce;
		}
	}
	return null;
}

export function countUnconfirmedUsage(sessionId) {
	try {
		return Number.parseInt(fs.readFileSync(markerPath(sessionId, 'usage-attempts'), 'utf8'), 10) || 0;
	} catch {
		return 0;
	}
}

export function noteUsageAttempt(sessionId, confirmed) {
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

export function writeUsageMarker(sessionId, reported, pending) {
	ensureStateDir();
	try {
		fs.writeFileSync(markerPath(sessionId, 'usage'), JSON.stringify({
			output: reported.output, size: reported.size, ...(pending ? { pending } : {})
		}), { mode: 0o600 });
	} catch {
		// A marker we cannot write costs one duplicate reading, never a lost one.
	}
}

export function rememberPending(sessionId, reported, outputTokens, transcriptSize, nonce) {
	// `reported` is passed in rather than re-read: the caller already resolved it this Stop (via
	// resolveAndPromoteUsageState), and nothing between that read and this write touches the 'usage' marker —
	// dispatch only writes the nonce-keyed request/outcome files. The dispatch just truncated this
	// kind's outcome file, so the reading is unconfirmed by construction; a later Stop promotes it
	// once clio's answer is there.
	writeUsageMarker(sessionId, reported, { output: outputTokens, size: transcriptSize, nonce });
}

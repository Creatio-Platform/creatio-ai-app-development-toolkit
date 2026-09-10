// The floor's retry bookkeeping: how many attempts it gets, which claim/nonce belongs to which
// attempt, and whether a given attempt may be retried. Split out from the usage protocol because the
// two series mean different things (once per session vs. a per-turn series) and do not share state,
// only the same claim/outcome primitives underneath.
import fs from 'node:fs';
import { claimOnce, markerPath, sanitizeSessionId } from './state-dir.mjs';
import { readOutcome, readRejectionCode, OUTCOME_GRACE_MS } from './dispatch.mjs';

// A failed floor emit releases its claim so the next clio call retries, but not without end: an
// installation whose clio refuses every send would otherwise spawn one for every tool call.
export const FLOOR_ATTEMPT_LIMIT = 3;

export function floorClaimSuffix(attempt) {
	return attempt === 0 ? 'claimed' : `claimed-${attempt}`;
}

export function floorNonce(attempt) {
	return `a${attempt}`;
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
export function floorRetryable(sessionId, attempt) {
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

// Whether the LAST attempt this session gets was answered with a definite refusal, as opposed to
// still pending or answered some other way — the caller only reaches here once every attempt slot up
// to FLOOR_ATTEMPT_LIMIT is used, and a still-pending final attempt is not exhaustion, just a slow
// clio the retry loop has no more turns left to wait on.
export function floorPersistentlyRejected(sessionId, lastAttempt) {
	return readOutcome(sessionId, 'floor', floorNonce(lastAttempt)) === 'rejected';
}

// The one rejection code that means the pairing itself is wrong rather than one send: the connected
// clio predates the flow-agnostic stage vocabulary and will refuse every stage this toolkit build
// sends, for the whole session, on every session, until clio is upgraded.
export const VOCABULARY_UNKNOWN_CODE = 'unknown-event-name';

// A one-time local signal for the case raised in review of PR #96: a clio that rejects
// `workflow_started` on every attempt leaves the session with zero telemetry and, before this, zero
// indication anything was ever tried, so a maintainer would only learn a whole install's floor was
// dead from the metrics it never sent. Two things about the line. It carries clio's own rejection code
// for the last attempt, because a generic "refused" could not tell a deploy that shipped ahead of the
// clio it needs from a transient refusal for a bad field, and those need opposite responses. And
// `unknown-event-name` gets its own sentence naming the cause and the fix, since that code is the
// degradation path of this whole design: nothing gates on clio's version up front, the floor tries,
// clio answers, and this is where the answer becomes legible. `claimOnce` makes the write idempotent
// per session, so routeClioCall and Stop both calling attemptFloorEmission after retries are exhausted
// log once, not once per remaining hook invocation.
export function noteFloorExhausted(sessionId, lastAttempt = FLOOR_ATTEMPT_LIMIT - 1) {
	if (!claimOnce(sessionId, 'floor-exhausted')) {
		return;
	}
	const code = readRejectionCode(sessionId, 'floor', floorNonce(lastAttempt));
	const reason = code === null ? 'carried no error code' : `was '${code}'`;
	try {
		let text = 'caadt telemetry: workflow_started was rejected on every attempt for session '
			+ `${sanitizeSessionId(sessionId)}; clio's last answer ${reason} (see `
			+ 'docs/telemetry-transport-decision.md, "The floor\'s exactly-once contract")\n';
		if (code === VOCABULARY_UNKNOWN_CODE) {
			text += `caadt telemetry: '${VOCABULARY_UNKNOWN_CODE}' means the connected clio predates the `
				+ 'flow-agnostic telemetry vocabulary (ENG-92551) and will reject every stage this toolkit '
				+ 'sends; upgrade clio, nothing is recorded until then\n';
		}
		process.stderr.write(text);
	} catch {
		// A diagnostic that cannot be written is not a reason to fail the hook.
	}
}

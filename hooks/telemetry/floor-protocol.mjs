// The floor's retry bookkeeping: how many attempts it gets, which claim/nonce belongs to which
// attempt, and whether a given attempt may be retried. Split out from the usage protocol because the
// two series mean different things (once per session vs. a per-turn series) and do not share state,
// only the same claim/outcome primitives underneath.
import fs from 'node:fs';
import { markerPath } from './state-dir.mjs';
import { readOutcome, OUTCOME_GRACE_MS } from './dispatch.mjs';

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

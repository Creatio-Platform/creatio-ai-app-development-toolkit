// The floor's retry bookkeeping: how many attempts it gets, which claim/nonce belongs to which
// attempt, and whether a given attempt may be retried. Split out from the usage protocol because the
// two series mean different things (once per session vs. a per-turn series) and do not share state,
// only the same claim/outcome primitives underneath.
import fs from 'node:fs';
import { claimOnce, markerPath, sanitizeSessionId } from './state-dir.mjs';
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

// Whether the LAST attempt this session gets was answered with a definite refusal, as opposed to
// still pending or answered some other way — the caller only reaches here once every attempt slot up
// to FLOOR_ATTEMPT_LIMIT is used, and a still-pending final attempt is not exhaustion, just a slow
// clio the retry loop has no more turns left to wait on.
export function floorPersistentlyRejected(sessionId, lastAttempt) {
	return readOutcome(sessionId, 'floor', floorNonce(lastAttempt)) === 'rejected';
}

// A one-time local signal for the case raised again in review of PR #96: a clio that rejects
// `workflow_started` on every attempt (an unreleased vocabulary, an `unknown-event-name` answer)
// leaves the session with zero telemetry and, before this, zero indication anything was ever tried —
// a maintainer would only learn a whole install's floor was dead from the metrics it never sent.
// `claimOnce` makes the write itself idempotent per session, so routeClioCall and Stop both calling
// attemptFloorEmission after retries are exhausted logs once, not once per remaining hook invocation.
export function noteFloorExhausted(sessionId) {
	if (!claimOnce(sessionId, 'floor-exhausted')) {
		return;
	}
	try {
		process.stderr.write(
			'caadt telemetry: workflow_started was rejected on every attempt for session '
			+ `${sanitizeSessionId(sessionId)} — clio is refusing the floor event (see `
			+ 'docs/telemetry-transport-decision.md, "The floor\'s exactly-once contract")\n'
		);
	} catch {
		// A diagnostic that cannot be written is not a reason to fail the hook.
	}
}

// The shared state directory and the marker-file primitives every claim/dispatch/scan record is
// built on: where it lives, that it is ours, the once-a-week sweep, and exclusive-create claims.
// Split out because every other module (transcript scanning, floor/usage protocol, dispatch) resolves
// paths and claims through here, but none of them need to know how the directory itself is secured.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let sweptThisProcess = false;

// lstat, not stat, so a symlink planted at this path is caught rather than followed and reported as
// whatever it points to — this is the check that matters on EVERY OS, including Windows, where
// `process.getuid` does not exist: a pre-planted symlink under the user's profile is exploitable
// there exactly as it is on POSIX, and CI runs windows-latest, so this cannot be POSIX-only.
//
// The uid/mode ownership check below it IS POSIX-only (process.getuid is unavailable on Windows), and
// on Windows the per-user temp directory's ACL is the only backstop for that narrower half — but the
// symlink rejection above does not depend on it and must not be skipped just because the ownership
// half cannot run.
function assertStateDirIsOurs(dir) {
	const info = fs.lstatSync(dir);
	if (info.isSymbolicLink()) {
		throw new Error(`refusing to use telemetry state directory that is a symlink: ${dir}`);
	}
	if (typeof process.getuid !== 'function') {
		return;
	}
	if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o700) {
		throw new Error(`refusing to use telemetry state directory not owned/secured by this user: ${dir}`);
	}
}

// The path alone, created by nobody. `UserPromptSubmit` and `Stop` have no matcher support in the
// host — they fire on EVERY prompt and every response, including in sessions that never touch
// Creatio — so the read paths those events take must not create a directory or sweep one.
export function stateDirPath() {
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

// How long the sweep's own rate-limit stamp is trusted, and how long a marker survives before the
// sweep may remove it.
const MARKER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

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
// markers here and the transcript path in transcript.mjs — must strip it down first, never
// interpolate it raw.
export function sanitizeSessionId(sessionId) {
	return String(sessionId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128) || 'unknown';
}

export function markerPath(sessionId, suffix) {
	const safeId = sanitizeSessionId(sessionId);
	return path.join(stateDirPath(), `${safeId}.${suffix}`);
}

// Removes one dispatch's request/outcome file pair once its outcome is no longer needed — resolved
// (recorded, unknown, or a promoted/abandoned refusal) rather than still pending. Best-effort: a
// failed unlink costs nothing but leaving the pair for the once-a-week sweep, never a lost reading, so
// it is never allowed to throw.
export function removeDispatchFiles(sessionId, kind, nonce) {
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
export function ensureStateDir() {
	try {
		stateDir();
		return true;
	} catch {
		return false;
	}
}

// Claimed with 'wx' so two hook processes racing on parallel tool calls cannot both act.
export function claimOnce(sessionId, suffix) {
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

export function releaseClaim(sessionId, suffix) {
	try {
		fs.rmSync(markerPath(sessionId, suffix), { force: true });
	} catch {
		// A marker we cannot clear only costs one skipped reminder.
	}
}

// Recorded on EVERY clio call, before consent and independently of the floor, because its only job is
// to answer "did this session use clio at all" — which is what scopes the `Stop` handler to Creatio
// work. Kept separate from the floor's one-shot claim so neither can consume the other.
export function markTouchedClio(sessionId) {
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
export function touchedClio(sessionId) {
	try {
		return fs.existsSync(markerPath(sessionId, 'touched'));
	} catch {
		return false;
	}
}

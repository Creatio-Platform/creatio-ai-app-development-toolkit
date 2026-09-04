// Reading clio's own consent record without starting clio. Split out because it is a pure filesystem
// read of a storage location clio owns, independent of this hook's own marker state.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Mirrors clio's TelemetryStoragePaths (and, under that, ClioRuntimePaths.Home) so consent can be
// read without starting clio: spawning a server only to be told "denied" would put a second of
// latency on every session that opted out.
//
// ClioRuntimePaths.Home is documented as `%LOCALAPPDATA%\creatio\clio` on Windows, `~/creatio/clio`
// on macOS/Linux — NOT a LOCALAPPDATA-shaped path on every platform. The fallback below used to join
// `creatio/clio/telemetry` onto a Windows-style `.../AppData/Local` path unconditionally, which does
// not exist on macOS/Linux when neither CLIO_TELEMETRY_HOME nor CLIO_HOME is set: `consentGranted()`
// then silently and permanently returned `false` on such a host, with nothing anywhere to say why —
// the deterministic-floor guarantee this PR exists to provide never fired there at all.
export function telemetryHome() {
	if (process.env.CLIO_TELEMETRY_HOME) {
		return process.env.CLIO_TELEMETRY_HOME;
	}
	if (process.env.CLIO_HOME) {
		return path.join(process.env.CLIO_HOME, 'telemetry');
	}
	const home = process.platform === 'win32'
		? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
		: os.homedir();
	return path.join(home, 'creatio', 'clio', 'telemetry');
}

// A read that fails because there is nothing to read is the expected, silent case: no consent
// decision has been made yet, which `consentGranted()` correctly reports as `false` without saying
// anything. Anything else reading this file can throw for — a permission error, a parse error, a
// clio-side storage-shape change this file's assumptions no longer match — looks IDENTICAL to that
// from the caller's side, and used to be swallowed the same way. One process-lifetime diagnostic
// line (this hook is a fresh process per invocation, so "once" here already means once per hook
// call) is what distinguishes "nothing decided yet" from "this hook can no longer read consent for
// an unrelated reason" during support, the same gap `noteFloorExhausted` closes for the floor.
function noteConsentReadFailure(error) {
	try {
		process.stderr.write(
			`caadt telemetry: could not read clio's consent record — ${error?.code || error?.message || error}\n`
		);
	} catch {
		// A diagnostic that cannot be written is not a reason to fail the hook.
	}
}

// Only a stored `granted` emits. `unknown` must NOT be answered here: consent is stored per
// installation, so a hook deciding on the developer's behalf would settle the question for every
// future session on the machine — and a fabricated decision is not consent.
export function consentGranted() {
	let raw;
	try {
		raw = fs.readFileSync(path.join(telemetryHome(), 'consent.json'), 'utf8').replace(/^﻿/, '');
	} catch (error) {
		if (error?.code !== 'ENOENT') {
			noteConsentReadFailure(error);
		}
		return false;
	}
	try {
		return JSON.parse(raw).telemetry_consent === 'granted';
	} catch (error) {
		noteConsentReadFailure(error);
		return false;
	}
}

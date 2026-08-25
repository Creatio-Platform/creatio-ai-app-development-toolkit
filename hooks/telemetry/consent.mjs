// Reading clio's own consent record without starting clio. Split out because it is a pure filesystem
// read of a storage location clio owns, independent of this hook's own marker state.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
export function consentGranted() {
	try {
		const raw = fs.readFileSync(path.join(telemetryHome(), 'consent.json'), 'utf8').replace(/^﻿/, '');
		return JSON.parse(raw).telemetry_consent === 'granted';
	} catch {
		return false;
	}
}

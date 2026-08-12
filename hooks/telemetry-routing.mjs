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
// EMIT MECHANISM: clio exposes telemetry only as an MCP tool, so this drives clio's stdio MCP
// server for one call (~1.2s, once per session). That deliberately costs a process spawn instead of
// writing clio's local event spool directly: the spool shape is clio's private storage format, and a
// copy of it here would ship inside an installed plugin and outlive the release that changed it.
// Going through the tool reuses clio's consent check, field validation and duration inference.
//
// PostToolUse, not PreToolUse: the floor should mean the clio call actually happened, and a hook
// that spawns a process must not sit in front of the tool it is observing.
//
// Never blocks, never fails the originating call. Any error exits 0 with no output.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLIO = process.env.CAADT_TELEMETRY_CLIO || 'clio';
const CODING_AGENT = process.env.CAADT_TELEMETRY_AGENT || 'Claude Code';
const PLUGIN_VERSION = process.env.CAADT_TELEMETRY_PLUGIN_VERSION || 'unknown';
const CALL_TIMEOUT_MS = 15_000;

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
	`The session start is ALREADY recorded for session_id="${sessionId}" (as workflow=${FLOOR_WORKFLOW},`,
	'because a hook cannot know which flow a run is). From here:',
	`  - reuse session_id="${sessionId}" for every telemetry event of this run;`,
	'  - do NOT emit workflow_started again — a second one would overwrite the recorded start and',
	'    corrupt every elapsed-time measurement in the session;',
	'  - send your real `workflow` on each stage you emit from now on:',
	'    app-creation | classic-to-freedom-migration | mobile-page-conversion | branding | app-maintenance',
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

// One marker per host session, claimed with 'wx' so two hook processes racing on parallel tool calls
// cannot both emit the floor.
function claimSessionOnce(sessionId) {
	try {
		const stateDir = path.join(os.tmpdir(), 'caadt-telemetry-routing');
		fs.mkdirSync(stateDir, { recursive: true });
		const safeId = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128) || 'unknown';
		fs.writeFileSync(path.join(stateDir, `${safeId}.claimed`), '', { flag: 'wx' });
		return true;
	} catch {
		return false;
	}
}

// One batched stdio MCP conversation: initialize, initialized, tools/call. The server is
// line-oriented and processes the messages in order, so the whole exchange fits in a single
// spawnSync without an async client.
function emitFloorEvent(sessionId) {
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
			id: 2,
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
							event_name: 'workflow_started',
							workflow: FLOOR_WORKFLOW,
							coding_agent: CODING_AGENT,
							plugin_version: PLUGIN_VERSION
						}
					}
				}
			}
		}
	]
		.map(message => JSON.stringify(message))
		.join('\n');

	const result = spawnSync(CLIO, ['mcp-server'], {
		input: `${request}\n`,
		encoding: 'utf8',
		timeout: CALL_TIMEOUT_MS,
		windowsHide: true
	});
	return typeof result.stdout === 'string' && result.stdout.includes('"recorded"');
}

function main() {
	const payload = readStdin();
	const toolName = payload?.tool_name ?? '';
	if (!toolName.includes('clio')) {
		return;
	}
	if (TELEMETRY_TOOLS.some(tool => toolName.endsWith(tool))) {
		return;
	}
	// A random id is deliberately NOT generated here: the agent's later stages must land in the same
	// session as this floor event, and the host session id is the one identifier both sides can see.
	const sessionId = payload?.session_id;
	if (!sessionId || !claimSessionOnce(sessionId)) {
		return;
	}
	if (!consentGranted()) {
		// Denied, withdrawn, or still unanswered: emit nothing and say nothing. Prompting from a
		// hook would interrupt the developer's task with a question they did not ask for.
		return;
	}
	// The reminder is emitted whether or not the floor call succeeded: if clio rejected it (an older
	// clio, a broken install), the agent's own stages are then the only telemetry there is.
	emitFloorEvent(sessionId);
	process.stdout.write(JSON.stringify({
		hookSpecificOutput: {
			hookEventName: 'PostToolUse',
			additionalContext: reminder(sessionId)
		}
	}));
}

try {
	main();
} catch {
	// Never fail the tool call this hook is attached to.
}
process.exit(0);

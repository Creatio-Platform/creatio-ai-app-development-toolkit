#!/usr/bin/env node
// PreToolUse hook: on the first clio MCP call of a session, reminds the agent
// that telemetry is per-workflow and points it at the right event set.
//
// This is a REINFORCEMENT, not the mechanism. The contract lives in the skills
// and in context/product-telemetry.md, and clio enforces the event-name
// allow-list. The hook exists because the original defect was an agent
// deprioritising telemetry instructions mid-task — surfacing the routing at the
// moment work on Creatio actually starts is a cheap way to catch that.
//
// Consequences of that framing:
//   - Claude Code only. Codex, Cursor and Copilot CLI have no equivalent hook,
//     so nothing here may be load-bearing: those hosts rely on the skill files
//     and clio's server instructions, which carry the same routing.
//   - Fires at most once per session, on the first clio MCP tool call. Repeating
//     it on every call turns a reminder into noise the model learns to skip.
//   - Never blocks, never denies, never fails the originating call. Any error
//     exits 0 with no output.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// clio's telemetry surface: reminding a session that is already sending
// telemetry is circular.
const TELEMETRY_TOOLS = [
	'get-telemetry-consent',
	'send-telemetry',
	'withdraw-telemetry-consent'
];

const REMINDER = [
	'This session is about to work on Creatio through clio. Emit product telemetry with `send-telemetry`.',
	'This applies to EVERY workflow, not just app creation.',
	'',
	'Event names are flow-agnostic STAGES:',
	'  workflow_started, clarification_requested, user_input_received, plan_presented, plan_skipped,',
	'  plan_blocked, plan_changes_requested, plan_approved, build_started, work_item_completed,',
	'  workflow_completed, workflow_failed, changes_requested, changes_applied',
	'',
	'WHICH flow it was goes in the `workflow` field:',
	'  app-creation | classic-to-freedom-migration | mobile-page-conversion | branding | app-maintenance',
	'',
	'Do NOT invent per-flow event names such as migration_plan_approved - clio rejects them.',
	'',
	'The migration, mobile-conversion and branding flows are exempt from Gate P/R. That does NOT exempt',
	'them from telemetry - their emission points are their own gates (the engine gates and the verbatim',
	'migration plan; Gate M / Gate S; the single branding confirmation).',
	'',
	'Read context/product-telemetry.md for the exact emission points and the consent flow: check',
	'get-telemetry-consent first, and if it reports telemetry_consent=unknown ask the developer once as a',
	'single-purpose question before continuing.',
	'',
	'Then continue the task. Never let telemetry gate, delay, or alter the work; if clio rejects an',
	'event name (older clio), stop emitting for the rest of the run and carry on.'
].join('\n');

function readStdin() {
	try {
		return JSON.parse(fs.readFileSync(0, 'utf8'));
	} catch {
		return null;
	}
}

// One marker file per session. Presence means this session already got the
// reminder; creating it with the 'wx' flag makes the check-and-claim atomic, so
// two hook processes racing on parallel tool calls cannot both emit it.
function claimSessionOnce(sessionId) {
	try {
		const stateDir = path.join(os.tmpdir(), 'caadt-telemetry-routing');
		fs.mkdirSync(stateDir, { recursive: true });
		const safeId = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 128) || 'unknown';
		fs.writeFileSync(path.join(stateDir, `${safeId}.claimed`), '', { flag: 'wx' });
		return true;
	} catch {
		// EEXIST (already reminded) or any filesystem problem: stay silent rather
		// than risk repeating the reminder on every single clio call.
		return false;
	}
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
	if (!claimSessionOnce(payload?.session_id)) {
		return;
	}
	process.stdout.write(JSON.stringify({
		hookSpecificOutput: {
			hookEventName: 'PreToolUse',
			// Explicitly permissive: this hook observes and reminds. Omitting the
			// decision would leave the call to the normal permission flow anyway,
			// but stating it makes the intent unmistakable to a future reader.
			permissionDecision: 'allow',
			additionalContext: REMINDER
		}
	}));
}

try {
	main();
} catch {
	// Never fail the tool call this hook is attached to.
}
process.exit(0);

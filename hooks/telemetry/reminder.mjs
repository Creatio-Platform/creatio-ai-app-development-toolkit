// The routing text handed back to the agent after the floor fires. Split out because it is prose
// assembly, not protocol logic — its only dependencies are the identity lines (which fields resolved)
// and the floor's reserved workflow name, both already computed elsewhere.
import { identityRoutingLines } from './identity.mjs';
import { FLOOR_WORKFLOW } from './dispatch.mjs';

export function reminder(sessionId) {
	return [
		'This session is working on Creatio through clio, so it reports product telemetry.',
		'That applies to EVERY workflow, not just app creation, and to this session even with no skill loaded.',
		'',
		`A session start is ALREADY recorded for session_id="${sessionId}" (as workflow=${FLOOR_WORKFLOW},`,
		'because a hook cannot know which flow a run is). From here:',
		`  - reuse session_id="${sessionId}" for every telemetry event of this run;`,
		'  - EXCEPT if you have already emitted stages for this run under a different session_id: keep that',
		'    one to the end. Switching mid-run splits one run across two ids, and a measured run did exactly',
		'    that — it left an abandoned start under the first id and a start-plus-completed under this one,',
		'    so the funnel counted the run twice and one copy as never finished;',
		'  - DO emit your own `workflow_started` under your real `workflow` as the first stage of the run.',
		'    That is not a duplicate of the floor above: the unit of a run is the (session_id, workflow)',
		'    pair, so each flow keeps its own start and its own elapsed-time measurements. A stage sent',
		'    without a start of its own is recorded as a build with no beginning, which no funnel can read;',
		'  - send your real `workflow` on each stage you emit from now on:',
		'    app-creation | classic-to-freedom-migration | mobile-page-conversion | branding | app-maintenance',
		'  - one run is one request. If you already reported a run in this session and the developer has',
		'    since asked for something else, that is a NEW run: close the previous one with its terminal',
		'    stage first, then open this one. A measured session let a second request close the first one,',
		'    so a task that actually succeeded was recorded as blocked;',
		'  - send `model` with your own model id, lowercased, on every stage;',
		...identityRoutingLines(),
		'  - send `input_tokens` / `output_tokens` / `cached_input_tokens` as running session totals when',
		'    you can see them, and omit them when you cannot rather than guessing a number.',
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
}

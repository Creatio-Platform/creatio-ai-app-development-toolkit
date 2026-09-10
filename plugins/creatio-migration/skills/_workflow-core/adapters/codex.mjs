// adapters/codex.mjs — the Codex host.
//
// Codex has no Workflow runtime: it cannot evaluate a `.workflow.js` with
// `agent()`/`parallel()` injected. What it DOES have is a filesystem, Node.js and
// the same MCP tools, which is everything the work-item protocol needs — so this
// adapter drives the run through the CLI's `next` / `submit` loop rather than
// through an inline agent call.
//
// The loop Codex runs:
//   1. `migration-workflow next <run.json>` → the pending work item(s): phase,
//      role, prompt (or prompt file), input files, response schema, access level.
//   2. Perform each item. With collaboration agents, one per item — that is what
//      keeps the roles independent. Without them, see the capability note below.
//   3. `migration-workflow submit <run.json> <item-id> <result.json>` per item.
//   4. Back to 1 until `status: done`.
//
// The decisions — how many Describe items, which scope in which batch, what
// counts as covered, whether the run is complete — are NEVER Codex's. They are
// the core's, computed from the recorded outcomes, which is what makes the
// verdict comparable with a Claude Code run over the same input.

import { declareHost } from '../capabilities.mjs'

// CAPABILITIES ARE DECLARED, NOT ASSUMED. The defaults below describe a Codex
// session that can run independent collaboration agents; a session that cannot
// must say so, and the core will then STOP on the phases whose guarantee does not
// survive it (the Critique pass, the verifier/judge split) instead of running
// them from the same context and reporting the same green verdict.
//
// `parallelism: 1` is the honest default: work items are performed one at a time
// through the submit loop unless the caller says otherwise. That is a REPORTED
// reduction — the driver logs it — and it costs wall-clock, not coverage.
export function codexHost({ parallelism = 1, independentRoles = true, subAgents = true, humanApproval = true, notes = '' } = {}) {
  return declareHost({
    id: 'codex',
    parallelism,
    subAgents,
    // Codex validates a JSON answer against the item's `responseSchema` before
    // submitting it — the CLI re-checks the required keys, so a hand-written
    // result cannot enter the journal in a shape the core will misread.
    structuredOutput: true,
    // The run journal is a file on disk. That is the whole resume story: kill the
    // session, run `next` again, and the core replays to exactly where it was.
    persistentState: true,
    // A person is in the loop between `next` and `submit` by construction, so the
    // approval gates can genuinely be answered here.
    humanApproval,
    independentRoles,
    notes: notes || 'Codex session driving the work-item protocol through the migration-workflow CLI',
  })
}

// A single-agent host that wants to run anyway. Kept as an explicit constructor
// rather than a flag so the loss is written down where it is chosen: with
// `independentRoles: false` the core REFUSES the phases that depend on an
// independent context instead of letting one agent check its own work.
export function codexSingleAgentHost(notes = '') {
  return codexHost({ parallelism: 1, independentRoles: false, subAgents: false, notes: notes || 'Codex session with no sub-agents — role-independent phases will stop explicitly' })
}

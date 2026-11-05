// adapters/generic-cli.mjs — any host with a filesystem and Node.js.
//
// The lowest common denominator, and the one an unknown coding agent integrates
// through: no assumption of sub-agents, no assumption of parallelism, no
// assumption that a role can be isolated. Everything the run needs is declared,
// so the core stops on what this host cannot honour rather than silently
// producing a weaker result under the same verdict.
//
// Use `genericHost({ ... })` to declare what the integrating host actually has.
// The defaults are the safe floor, which means the role-independent phases stop —
// that is the intended answer for a host that has not said it can isolate them.

import { declareHost } from '../capabilities.mjs'

export function genericHost({ id = 'generic-cli', parallelism = 1, subAgents = false, structuredOutput = true, persistentState = true, humanApproval = true, independentRoles = false, notes = '' } = {}) {
  return declareHost({ id, parallelism, subAgents, structuredOutput, persistentState, humanApproval, independentRoles, notes: notes || 'generic host driving the work-item protocol through the migration-workflow CLI' })
}

// What a `stopped: capability` run should tell its operator. The message names
// the missing guarantee AND what would provide it, because "run it somewhere
// else" is not actionable on its own.
export const CAPABILITY_REMEDY = {
  subAgents: 'the phase must run in a context that is not the caller\'s. Provide sub-agents (Claude Code `agent()`, Codex collaboration agents) or run this phase on a host that has them.',
  structuredOutput: 'the phase\'s answer is computed on, not read. Provide JSON-schema-validated output, or submit a result that satisfies the item\'s `responseSchema` by hand.',
  independentRoles: 'builder / verifier / judge must be mutually blind contexts. One agent checking its own work produces the same verdict with none of the evidence, so the run stops instead.',
  humanApproval: 'the gate needs a person to answer. Record the approval as data (the exact plan version) before resuming.',
  persistentState: 'the run journal must survive the process for a resume to be possible.',
}

export function explainMissing(missing) {
  return (missing || []).map((m) => `- \`${m}\`: ${CAPABILITY_REMEDY[m] || 'not available on this host.'}`).join('\n')
}

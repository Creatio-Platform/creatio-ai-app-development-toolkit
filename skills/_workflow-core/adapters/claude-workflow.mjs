// adapters/claude-workflow.mjs — the Claude Code host, as a thin mapping.
//
// The Claude Workflow runtime injects `args`, `log`, `phase`, `agent` and
// `parallel` into a workflow script and nothing else — no `import`, no
// filesystem, no timers. So this adapter is written to take those functions as
// PARAMETERS rather than reach for them as globals: that is what lets it be
// inlined into the generated `.workflow.js` (where they are globals) and still be
// unit-tested here with fakes.
//
// Nothing about the migration's decisions lives here. This file maps a work item
// to an `agent()` call and an outcome back to the protocol's three states — and
// that is deliberately all it does, so a second host cannot end up with a
// different rule for what "the phase died" means.

import { declareHost } from '../capabilities.mjs'
import { OUTCOME } from '../work-item.mjs'
import { drive } from '../driver.mjs'

// The Claude Workflow contract, stated as capabilities:
//  - sub-agents and independent roles: `agent()` spawns a fresh context, so a
//    verifier genuinely cannot see the builder's reasoning;
//  - structured output: the `schema` option forces + validates it;
//  - parallelism: `parallel()`, capped by the host at min(16, cpus-2). 8 is
//    declared because the workflows' own fan-out cap is 8 and the number only
//    has to be a truthful lower bound of what the host will run at once;
//  - persistent state: the runtime's own resume (`resumeFromRunId`) — the run
//    journal is written by the CLI adapter, not needed here;
//  - human approval: the workflow cannot block on a person mid-run, so the
//    approval gates are enforced as data (a recorded approval of an exact plan
//    version), never as an interactive prompt.
export const CLAUDE_HOST = declareHost({
  id: 'claude-workflow',
  parallelism: 8,
  subAgents: true,
  structuredOutput: true,
  persistentState: true,
  humanApproval: false,
  independentRoles: true,
  notes: 'Claude Code Workflow runtime (agent/parallel/phase/log injected as globals)',
})

// ROLE → `agentType`. A role names the CONTRACT the item must be performed
// under; on this host every role runs as `general-purpose` and the skill-bound
// ones say so in their prompt (the prompt invokes the Skill tool), which is
// exactly what the hand-written workflows did. Kept as a table so a host that
// CAN bind a role to a dedicated agent type has one place to say so.
export const AGENT_TYPE_FOR_ROLE = {
  'general-purpose': 'general-purpose',
  'classic-ui-expert': 'general-purpose',
  builder: 'general-purpose',
  verifier: 'general-purpose',
  judge: 'general-purpose',
}

export function agentOptionsFor(item) {
  return {
    agentType: AGENT_TYPE_FOR_ROLE[item.role] || 'general-purpose',
    schema: item.responseSchema || undefined,
    phase: item.phase,
    label: item.label,
  }
}

// One work item → one `agent()` call. The three outcomes are read exactly as the
// host contract defines them: a NULLISH resolution is terminal death (the host
// has already exhausted its own retries), a rejection is an ERROR.
export function makeExecute(agent) {
  return async (item) => {
    try {
      const value = await agent(item.prompt, agentOptionsFor(item))
      return value === null || value === undefined ? { outcome: OUTCOME.DEATH } : { outcome: OUTCOME.VALUE, value }
    } catch (e) {
      return { outcome: OUTCOME.ERROR, error: e }
    }
  }
}

// The host's own batch primitive. `parallel()` caps concurrency and draws the
// progress tree, so a batch goes through it rather than through a bare
// `Promise.all` the runtime knows nothing about.
// The negotiated WIDTH is honoured, not discarded. The driver passes
// `min(host.parallelism, itemCount)` as the third argument, and handing the whole
// batch to one `parallel()` call ignored it: the runtime's own ceiling
// (`min(16, cpus - 2)`) applied instead, so a caller-supplied `maxDescribeAgents: 20`
// fanned out up to 16 concurrent stand-reading agents against a live stand, and
// `resolveStep` logged "in waves of W — a reported reduction in parallelism" for a
// reduction that never happened. The generic-CLI path already sliced into waves, so
// the two disagreed on the one property this module exists to guarantee. It was safe
// only by coincidence: DEFAULT_MAX_DESCRIBE is 8, the same as the declared
// parallelism, so width === itemCount for the default input.
export function makeRunBatch(parallel) {
  return async (items, execute, width) => {
    const w = Math.max(1, Number.isFinite(width) ? width : items.length)
    if (w >= items.length) return parallel(items.map((item) => () => execute(item)))
    const out = []
    // One await boundary per wave. The host keeps its progress tree and its own
    // concurrency accounting inside each wave; what changes is that the negotiated
    // budget now binds across them.
    for (let i = 0; i < items.length; i += w) {
      out.push(...(await parallel(items.slice(i, i + w).map((item) => () => execute(item)))))
    }
    return out
  }
}

export function driveOnClaude({ core, run, io, agent, parallel, requires }) {
  return drive({
    core,
    run,
    host: CLAUDE_HOST,
    io,
    requires,
    execute: makeExecute(agent),
    runBatch: parallel ? makeRunBatch(parallel) : undefined,
  })
}

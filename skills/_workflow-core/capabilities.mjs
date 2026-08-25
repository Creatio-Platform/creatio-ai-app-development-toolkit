// _workflow-core/capabilities.mjs — what a host can do, and what it may NOT
// quietly do without.
//
// The migration workflows carry guarantees that are not decorative: a verifier
// that is a separate context from the builder, a judge that is a third one, a
// human approval gate before the first stand write, structured output the
// arithmetic can be computed on. A host that cannot provide one of those must
// STOP and say so — the failure this file exists to prevent is a single-agent
// host running the sequence anyway and reporting the same green verdict a
// three-role run would have produced.
//
// The distinction that matters:
//   DEGRADABLE   — the guarantee survives a reduced form, and the reduction is
//                  reported. `parallelism` is the only one: running a batch in
//                  waves (or one at a time) changes wall-clock, not the result.
//   REQUIRED     — the guarantee does not survive its absence. Missing ⇒ stop.

export const CAPABILITIES = [
  'subAgents',        // the host can run a work item in a context that is not the caller's
  'parallelism',      // >1 work item at a time (DEGRADABLE — waves are a valid answer)
  'structuredOutput', // the host can force + validate a JSON-schema answer
  'persistentState',  // the run journal survives the process (resume)
  'humanApproval',    // the host can put a question to a human and wait
  'independentRoles', // builder / verifier / judge can be mutually blind contexts
]

// `parallelism` is a NUMBER on a declaration (how many at once) and a capability
// name in a requirement; 1 means "sequential only", which is degradation, not
// absence.
export function declareHost({ id, parallelism = 1, subAgents = false, structuredOutput = false, persistentState = false, humanApproval = false, independentRoles = false, notes = '' }) {
  if (!id || typeof id !== 'string') throw new Error('a host adapter must declare a stable `id` — every run records which adapter executed it')
  return { id, parallelism: Math.max(1, Number(parallelism) || 1), subAgents: !!subAgents, structuredOutput: !!structuredOutput, persistentState: !!persistentState, humanApproval: !!humanApproval, independentRoles: !!independentRoles, notes }
}

const DEGRADABLE = new Set(['parallelism'])

// Does this host satisfy what the step asks for? Returns the verdict plus the
// reduction the host will apply, so the caller can LOG the reduction rather than
// discovering it in the wall-clock.
export function negotiateStep(host, stepRequires, itemCount) {
  const asked = new Set(stepRequires || [])
  const missing = []
  for (const cap of asked) {
    if (DEGRADABLE.has(cap)) continue
    if (!hostHas(host, cap)) missing.push(cap)
  }
  const width = Math.min(host.parallelism, Math.max(1, itemCount))
  return {
    ok: missing.length === 0,
    missing,
    // The wave plan. `width === itemCount` is no reduction at all; anything
    // smaller is the reported degradation.
    width,
    reduced: itemCount > 1 && width < itemCount,
  }
}

function hostHas(host, cap) {
  if (cap === 'parallelism') return host.parallelism > 1
  return !!host[cap]
}

// The run-level check, done ONCE before any work: a host missing something the
// whole workflow depends on must not get as far as spending an agent.
export function negotiateRun(host, workflowRequires) {
  const missing = (workflowRequires || []).filter((c) => !DEGRADABLE.has(c) && !hostHas(host, c))
  return { ok: missing.length === 0, missing, host: host.id }
}

// The explicit stop. Deliberately a distinct error class so an adapter can tell
// "this host cannot run this workflow" from "the run failed" — the first is a
// configuration answer, the second is a defect.
export class CapabilityError extends Error {
  constructor(missing, where) {
    const needed = where ? ` (needed by ${where})` : ''
    super(`host lacks required capability/capabilities: ${(missing || []).join(', ')}${needed}. This is an explicit stop: the guarantee does not survive its absence, so the run does NOT continue in a degraded form.`)
    this.name = 'CapabilityError'
    this.missing = [...(missing || [])]
    this.where = where || null
  }
}

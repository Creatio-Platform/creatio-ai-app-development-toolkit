// _workflow-core/stage-gate.mjs — the ONE rule for entering a phase.
//
// A migration workflow is a chain of phases, and every link in it has the same
// failure mode: the phase before produced nothing, and the phase after runs
// anyway on empty input. It does not crash — it computes a perfectly formed
// answer over nothing and reports it as a result. Measured on the analysis core
// before the guards existed: a dead Context reduced to an empty scope census and
// the run reported a COMPLETE zero-row analysis for a digest that was full.
//
// Two guarded transitions already existed and set the shape this file
// generalises: `context-failed` in behaviour-analysis/core.mjs and
// `verifier-failed` in build-executor/core.mjs both return a named `stopped`, a
// `reason` a person can act on, and a `next` line. `stageGate` factors that shape
// into one decision so the remaining transitions cannot each invent their own.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO.
//   · It does not log, and it does not record. The cores own their `io` and their
//     return shapes, and a helper that logged would put half a phase's reporting
//     in a module that has no `io` — while the two hosts must see the identical
//     DECISION. So the gate answers one question (stop or continue) and the
//     caller does the telling.
//   · It does not retry and it does not re-dispatch. A gate stops; deciding to
//     try again is a policy this task deliberately leaves out.
//   · It has no clock, no randomness, no filesystem and no `import.meta`. Like
//     every module under `_workflow-core/`, it is inlined verbatim into the
//     generated `.workflow.js` (where `import.meta` is a parse error) and it must
//     replay identically on a resumed run.

// WHY A STOP CANNOT SIMPLY SAY "RESUME". A journal records the three outcomes,
// DEATH included, and `advance()` replays whatever is recorded — so resuming a
// run that stopped here replays the same deaths and stops in the same place. The
// honest instruction is therefore "fix the host, then start a fresh run", and the
// resume commands are named so an operator who reaches for one is told why it
// will not help. Both hosts are named because the same core runs on both.
export const RESUME_CLAUSE =
  'Nothing after this phase ran, and nothing it would have written exists. Fix what killed the agents (host quota, an expired token, a role the host cannot bind), then start a FRESH run — resuming this one (`node cli.mjs resume <run.json>` on the CLI host, `resumeFromRunId` on the Claude Workflow host) replays the recorded deaths and stops here again.'

// THE FIVE KEYS EVERY GATE STOP CARRIES, composed in one place so the three stop
// families this file serves (`<phase>-produced-nothing`, `nothing-built`,
// `app-unit-incomplete`) cannot drift into reporting different things. A caller
// reading `agentsExpected` / `agentsReturned` learns the shape of the failure —
// "all four died" and "the round dispatched none" are different repairs — and it
// learns it from the stop rather than from the log.
//
// `resumeClause` IS A SWITCH, and it used to be a constant (PR #171 review). The
// clause above narrates a HOST FAILURE — "nothing it would have written exists" —
// which is true of every family this file composes except one. `app-unit-incomplete`
// also fires on the package-MISMATCH leg, where the app builder ANSWERED, created an
// application and a package on a live stand, and the core ran
// `persistPending('stopping on an incomplete app unit')` immediately before composing
// the stop precisely so that state would survive. Appending the clause there produced
// one `next` holding two mutually exclusive instructions — go and see what the unit
// created on the stand, and nothing it would have written exists — and an operator who
// followed the second discards recoverable state the code deliberately wrote down. So
// the composer no longer hardcodes one failure narrative for every family: the clause
// rides BY DEFAULT (every `<phase>-produced-nothing` stop, and `nothing-built`, really
// are "no agent answered"), and a site whose family owns a truer recovery sentence
// passes `resumeClause: false` and keeps the one it already writes.
export function gateStop({ stopped, reason, next = '', agentsExpected = 0, agentsReturned = 0, resumeClause = true }) {
  if (!stopped) throw new Error('a gate stop must name its `stopped` code')
  // Named rather than nested in the return (Sonar S3358): `resumeClause ? (next ? … : …) : next` reads as one
  // decision and is two.
  const withClause = next ? `${next} ${RESUME_CLAUSE}` : RESUME_CLAUSE
  return {
    stopped,
    reason,
    next: resumeClause ? withClause : next,
    agentsExpected,
    agentsReturned,
  }
}

// A result is anything that is not the protocol's null hole. Counted HERE rather
// than trusted from a caller's already-filtered array, so a core that passes the
// raw batch (holes included) and a core that passes its filtered copy get the
// same answer.
export function countReturned(results) {
  if (!Array.isArray(results)) return results === null || results === undefined ? 0 : 1
  let n = 0
  for (const r of results) if (r !== null && r !== undefined) n += 1
  return n
}

// THE DECISION. `null` means "carry on"; an object means "stop, and here is why".
//
//   expected === 0                → null. A phase that dispatched nothing is not a
//                                   failed phase — a plan with no ⚠ Confirm items
//                                   has nothing to preflight, and stopping there
//                                   would refuse every healthy run of a simple
//                                   surface.
//   returned  >  0                → null. A PARTIAL phase carries on: some of its
//                                   work landed, and what to do about the rest is
//                                   the caller's arithmetic (the analysis core
//                                   routes the dead batch's rows to its repair
//                                   round), not this gate's.
//   emptyIsLegit() === true       → null. The one escape hatch, for a caller that
//                                   knows an empty answer is a real answer here.
//   otherwise                     → the stop.
//
// `emptyIsLegit` is called ONLY on the branch that would otherwise stop, so a
// caller may make it as expensive as it likes without paying for it every phase.
export function stageGate({ phase, expected = 0, results = [], emptyIsLegit = null, label = '', what = '', fix = '' }) {
  if (!phase) throw new Error('a stage gate must name the `phase` it guards')
  const returned = countReturned(results)
  if (expected <= 0 || returned > 0) return null
  const legit = typeof emptyIsLegit === 'function' ? emptyIsLegit() : !!emptyIsLegit
  if (legit) return null
  const name = label || phase
  const consequence = what ? ` — ${what}` : ''
  return gateStop({
    stopped: `${phase}-produced-nothing`,
    reason: `all ${expected} ${name} agent(s) returned nothing${consequence}. That is a FAILED phase, not an empty one: the phase after it would have run on no input at all and reported an answer it never computed.`,
    next: fix,
    agentsExpected: expected,
    agentsReturned: returned,
  })
}

// ---------------------------------------------------------------------------
// PHASE OUTCOMES — what each phase actually did, on every return.
//
// A stop names the phase that killed the run. `phaseOutcomes` is the other half:
// a run that FINISHED can still have limped, and until now the only trace of a
// degraded phase was a log line nobody keeps. Four states, and the difference
// between them is what an operator acts on:
//   ok       — every agent the phase dispatched answered.
//   partial  — some answered; the rest are accounted for by the caller.
//   none     — the phase dispatched agents and every one of them died.
//   skipped  — the phase was deliberately not entered (nothing to do, or an
//              earlier gate closed it).
//
// THE SHIPPED SHAPE SUPERSEDES THE TICKET'S DESIGN SECTION, recorded here so the
// next consumer is not written against the wrong one (PR #171 review, finding 1).
// ENG-96778's Design section specified `phaseOutcomes: [{ phase, expected,
// returned, outcome }]` — an ARRAY, with the state under `outcome`. What ships is
// an OBJECT keyed by phase, in insertion order, whose entries carry `state`,
// `agentsExpected` and `agentsReturned`, plus an `occurrences` array on any phase
// entered more than once. The keyed form is what a reader actually asks of it
// ("what did Judge do?") without scanning, and `occurrences` has no place in the
// specified array at all — a phase entered twice would have been two rows with
// nothing saying which came first. Same information, ordered the same way; a
// consumer written against the design section (including the follow-up
// `run-status.md` task the ticket names) must read `entry.state` and iterate
// `Object.entries(...)`, not `entry.outcome` over an array.
// ---------------------------------------------------------------------------
export function outcomeState(expected, returned) {
  if (expected <= 0) return 'skipped'
  if (returned <= 0) return 'none'
  return returned < expected ? 'partial' : 'ok'
}

// HOW BAD IS THIS STATE? Needed because a phase is recorded once per ENTRY into
// it and several phases are entered more than once in a single run — the build
// core records `Judge` from the post-preflight site AND from every round tail,
// and `Build`, `Verify` and `Reconcile` once per round. The rank orders the four
// states by how much operator attention they deserve, so the recorder can keep
// the WORST occurrence as the phase's headline instead of the last one.
// `skipped` sits BELOW `ok` deliberately: a phase deliberately not entered on one
// round is not a degradation of a round where it answered.
export const OUTCOME_RANK = { skipped: 0, ok: 1, partial: 2, none: 3 }

// The worse of two occurrences, LAST winning a tie — so a healthy multi-round run
// still reports its most recent round, exactly as it did before this became
// degrade-sticky, while any degradation earlier in the run survives to the report.
export function worseOutcome(a, b) {
  if (!a) return b
  if (!b) return a
  return (OUTCOME_RANK[b.state] ?? 0) >= (OUTCOME_RANK[a.state] ?? 0) ? b : a
}

// A tiny ordered recorder. Insertion order is kept explicitly rather than left to
// object key order, because a phase re-entered on a later round must not jump to
// the end of the report — a reader compares two runs' outcomes by eye.
//
// DEGRADE-STICKY, and why it is not merely nicer (ENG-96778 review, F1). `set`
// used to overwrite `byPhase[phase]`, so the LAST entry into a phase was the only
// one the report kept. Measured on this PR's own AC 13 golden: the post-preflight
// Judge died, round 1's Judge answered, and the run reported
// `Judge: { state: 'ok', agentsReturned: 1 }` — the report said every Judge
// answered, on the exact run this feature exists to make legible, and both
// SKILL.md files tell the operator `phaseOutcomes` is where a limp shows. The same
// erasure applied to `Build`, `Verify` and `Reconcile`: any degraded early round
// was wiped by a later healthy one.
//
// So the headline entry is now the WORST occurrence, and a phase entered more than
// once also carries `occurrences` — every entry, in order, with the discriminator
// the caller passed (`where`, `round`). A phase entered ONCE is byte-identical to
// what it was before: no `occurrences` key on a report that has nothing to say
// with it.
export function makePhaseOutcomes() {
  const byPhase = {}
  const seen = {}
  const order = []
  const set = (phase, entry) => {
    if (!order.includes(phase)) { order.push(phase); seen[phase] = [] }
    seen[phase].push(entry)
    byPhase[phase] = worseOutcome(byPhase[phase], entry)
    return byPhase[phase]
  }
  return {
    // The common case: the phase dispatched `expected` agents and `results` came
    // back. The state is arithmetic over the two, never an agent's own word.
    record(phase, expected, results, extra = {}) {
      const returned = countReturned(results)
      return set(phase, { state: outcomeState(expected, returned), agentsExpected: expected, agentsReturned: returned, ...extra })
    },
    // A phase whose state the caller decides itself (the build core's Reconcile
    // retries, a repair round that is reported as its own thing).
    note(phase, state, extra = {}) {
      return set(phase, { state, ...extra })
    },
    skipped(phase, why = '') {
      return set(phase, why ? { state: 'skipped', why } : { state: 'skipped' })
    },
    // A COPY, in insertion order — the occurrence list copied element by element
    // too. Returned into a result object, so a caller mutating it must not reach
    // back into the run's own bookkeeping.
    snapshot() {
      const out = {}
      for (const p of order) {
        out[p] = { ...byPhase[p] }
        if (seen[p].length > 1) out[p].occurrences = seen[p].map((e) => ({ ...e }))
      }
      return out
    },
  }
}

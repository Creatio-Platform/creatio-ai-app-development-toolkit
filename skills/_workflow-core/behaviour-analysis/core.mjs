// behaviour-analysis/core.mjs — step 5.1 of a Classic→Freedom migration, as a
// HOST-NEUTRAL state machine.
//
// The run is a generator. It YIELDS work steps (see ../work-item.mjs) and
// receives their outcomes back; everything between two yields is arithmetic over
// what the previous phase returned. There is no `agent()`, no `parallel()`, no
// `phase()` and no `args` here — a Claude Workflow, a Codex adapter and the
// plain CLI all drive the identical sequence, which is what makes the coverage
// verdict comparable across hosts.
//
// Inputs:
//   { manifest, digest, environment, outDir,   // REQUIRED
//     sectionSchema?, totals?, rowsPerAgent?, maxDescribeAgents? }
//
// WHY THE SHAPE IS THIS WAY. The core has no filesystem access of its own (a
// Claude workflow script has none, and giving the core one would make its
// decisions untestable), so it cannot read the digest. The Context work item
// reads it and returns the row INVENTORY as structured output; every later
// decision — how many Describe items, which scope goes in which batch, whether
// coverage is complete — is then plain arithmetic here rather than a judgement an
// agent narrates. That is the whole point: an agent saying "I described
// everything" is not evidence, and that is exactly how a real run left the child
// pages at 0-of-8 described while the plan showed nothing wrong.

import { step, ACCESS } from '../work-item.mjs'
import { stageGate, makePhaseOutcomes } from '../stage-gate.mjs'
import { CONTEXT_SCHEMA, DESCRIBE_SCHEMA, CRITIQUE_SCHEMA, MERGE_SCHEMA } from './schemas.mjs'
import { rules, contextPrompt, describePrompt, repairNote, critiquePrompt, mergePrompt } from './prompts.mjs'
import {
  normalizeScopes, planBatches, packBatches, repairKeys, isComplete, wiringOnlyMixinKeys, coveredKeys, entriesOf,
  declaredNothingToDo, isCritiqueShape, critiqueDeathLine, retryOnDeath, itemId, partFile,
  validateReportedTrigger, digestKeyOf, attachOverrideOnly, overrideEntries,
  DEFAULT_ROWS_PER_AGENT, DEFAULT_MAX_DESCRIBE,
} from './helpers.mjs'

export const WORKFLOW = 'creatio-classic-behaviour-analysis'

// What a host must be able to do before the run starts. `parallelism` is
// deliberately NOT here: a host that runs the Describe batch one item at a time
// gets the same coverage, only slower, and the driver reports the reduction.
export const WORKFLOW_REQUIRES = ['subAgents', 'structuredOutput']

export const REQUIRED_INPUTS = ['manifest', 'digest', 'environment', 'outDir']

// A bare string is taken as `manifest` so a caller can pass just that; every
// other required input then has to come from the object form, and the run fails
// loudly rather than guessing a path.
export function normalizeInput(a) {
  if (typeof a === 'string') {
    const s = a.trim()
    if (!s) return {}
    if (s.startsWith('{')) {
      try {
        const parsed = JSON.parse(s)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
      } catch {
        /* not JSON — treat as a manifest path below */
      }
    }
    return { manifest: s }
  }
  return a || {}
}

export function assertInput(input) {
  const missing = REQUIRED_INPUTS.filter((k) => !input[k])
  if (missing.length) {
    throw new Error(
      `classic-behaviour-analysis: missing required args: ${missing.join(', ')}. ` +
        'Run `node engine/migrate.mjs <manifest> --stubs --out <file>` first, then pass ' +
        '{ manifest, digest, environment, outDir }.',
    )
  }
}

const noop = () => {}

// THE "NOTHING TO DESCRIBE" RETURN. Both exits — the caller's declared `totals` and the post-Context count — say
// the same thing about the same surface, so they compose it in one place: an empty worklist is DONE, not
// incomplete, and the two must never drift into disagreeing about that.
const NOTHING_TO_DESCRIBE = 'the row digest carries no imperative rows (no methods, no message/mixin members) — step 5.1 does not apply'
// `ledgerMembers` is a fact the CALLER supplied (the engine's own member ledger for the surface it mapped), not
// something this run computes — so a skip must pass it THROUGH. It used to be hard-coded `null`, which read as
// "the ledger is unknown" on a run that had been told the number, and the worked path (see `ledger` below) then
// reported a figure the skip path erased. The skip itself is unchanged: an all-zero surface still skips.
const ledgerOf = (totals) => (typeof totals?.ledgerMembers === 'number' ? totals.ledgerMembers : null)
function skippedReturn(surface, totals, extra = {}) {
  return {
    surface,
    skipped: true,
    reason: NOTHING_TO_DESCRIBE,
    coverage: { described: 0, digestRows: 0, total: 0, ledgerMembers: ledgerOf(totals), complete: true, uncovered: [], wiringOnly: [] },
    describeAgents: 0,
    ...extra,
  }
}

// WHAT THE CALLER IS TOLD ABOUT THE ADVERSARIAL PASS, and the two log lines that go with it. Narrowed from the
// retry loop's `ran` through `isCritiqueShape`, because the two questions are not the same one: a non-nullish value
// that is not a critique stops the loop legitimately, and reporting it as a pass that RAN claims
// `conflicts`/`settledElsewhere` were verified empty for a pass that checked nothing. The two failures also get
// DIFFERENT lines — "returned something unusable" and "the host never answered" need different repairs.
function reportCritique(critique, critiqueReturned, log) {
  const ran = critiqueReturned && isCritiqueShape(critique)
  if (critiqueReturned && !ran) {
    const returned = Array.isArray(critique) ? 'an array' : `a ${typeof critique}`
    log(`⚠ the Critique agent returned ${returned} without the uncovered/conflicts/settledElsewhere arrays its schema requires — treating the pass as dead`)
  }
  if (!ran) log('⚠ Critique never ran — conflicts / settledElsewhere are UNCHECKED, and coverage.complete is arithmetic-only (no adversarial pass checked that cited cards actually describe their rows)')
  return ran
}

// REPORTED TRIGGERS, VALIDATED BEFORE THEY TRAVEL. A trigger this run reports is a DESCRIPTION of an origin the
// engine could not trace, and the engine fills the row's empty trigger cell from it — so an unusable one does not
// stay harmless: it renders as `<kind> (from <x>) — reported` and clears the row out of the plan header's "no
// trigger yet" count. Measured: the Applicants index carried `"init": {"trigger":"internal","from":"init"}` and
// the header went from "8 row(s) have no trigger yet" to "0 … 8 answered by the behaviour run".
//
// A rejected trigger is STRIPPED from the entry (so nothing downstream can read it) while the ENTRY stays — its
// card may be perfectly good. The row goes back through the repair round, because the trigger is what was asked
// for and is still missing.
// The BARE tail of a possibly schema-qualified key: `HRApplicantPage::init` -> `init`. An index key carries the
// scope when two pages of one surface declare the same method name, and the engine's own leg
// (`applyBehaviourIndex` in migrate.mjs) validates against the BARE `h.sourceMethod` — so a `from` naming the row
// itself was caught there and NOT here, where the full key was compared. Measured shape:
// `{trigger:'internal', from:'init', methodName:'HRApplicantPage::init'}` passed this run, so no repair round ran
// and `coverage.complete` went true on the exact self-referential trigger the validator exists to reject.
const bareTail = (key) => String(key).split('::').pop()

// Both readings of the key, because either one naming the row itself is the same defect. The mirrored
// `validateReportedTrigger` is NOT changed for this — it is compared byte-for-byte against the engine's copy, and
// the divergence was in the caller's argument, not in the rule.
function rejectionFor(entry) {
  return validateReportedTrigger({ trigger: entry.trigger, from: entry.from, methodName: entry.key })
    || validateReportedTrigger({ trigger: entry.trigger, from: entry.from, methodName: bareTail(entry.key) })
}

function rejectTriggers(results, allKeys, log) {
  const rejected = []
  for (const entry of entriesOf(results)) {
    const why = rejectionFor(entry)
    if (!why) continue
    rejected.push({ key: entry.key, digestKey: digestKeyOf(entry.key, allKeys), trigger: entry.trigger ?? null, from: entry.from ?? null, why })
    delete entry.trigger
    delete entry.from
    log(`⚠ rejected the reported trigger on '${entry.key}': ${why} — the row stays UNRESOLVED and goes back through the repair round`)
  }
  return rejected
}

// Rows whose reported trigger was rejected are UNCOVERED for this run's purposes even when their card is fine —
// the trigger is what step 5.1 was asked for. Applied at every site that recomputes `uncoveredKeys`, including
// after the repair round: the plain recompute reads `covered` alone, and a row that came back a SECOND time with
// a still-invalid trigger HAS a card, so it would be dropped and `complete` would go true on the row that was
// never answered.
//
// A rejection is CURRENT, not historical: only invalid triggers are stripped from the entries, so an entry still
// carrying a trigger is one that passed. A row whose repair round came back with a valid trigger therefore closes
// — a rejection is a repairable state, and a sticky union would leave the run permanently incomplete on a row
// that got its answer one round later.
function withRejectedTriggers(uncovered, rejected, allKeys, results) {
  const answered = new Set(entriesOf(results).filter((e) => e.trigger).map((e) => digestKeyOf(e.key, allKeys)))
  const keys = rejected.map((r) => r.digestKey).filter((k) => k && allKeys.has(k) && !answered.has(k))
  return [...new Set([...uncovered, ...keys])]
}

// Small pure helpers hoisted OUT of `run` (Sonar S3776): each ternary inside `run` — and doubly so inside one of
// its nested item builders — counted against the generator's cognitive complexity while saying nothing about the
// orchestration the function is actually about. Named here, `run` reads as the phase sequence it is.
const positiveOr = (v, fallback) => (Number(v) > 0 ? Number(v) : fallback)
const roundKind = (repair) => (repair ? 'repair' : 'describe')
const critiqueIdSuffix = (attempt) => (attempt > 1 ? `retry${attempt}` : '')
const critiqueLabel = (attempt) => (attempt > 1 ? 'critique:coverage-retry' : 'critique:coverage')
// AC 7's two ternaries, hoisted for the same reason as the four above (PR #171 review — Sonar S3776 measured
// `run` at 22 against the 15 allowed, and the gates this task added are the whole of the difference).
const okOrNone = (ran) => (ran ? 'ok' : 'none')
const answeredCount = (v) => (v ? 1 : 0)

// THE FOUR PHASES IN THE ORDER THEY RUN, and the one call an early exit makes to say the rest never happened.
// A path that ends early says so in ONE call rather than listing the remaining phases at each exit — which is how
// a return loses its report by forgetting one of them. Module level (PR #171 review): the order is a fact about
// this workflow, not about any single run.
const PHASE_ORDER = ['Context', 'Describe', 'Critique', 'Merge']
function skipPhasesFrom(outcomes, first, why) {
  for (const p of PHASE_ORDER.slice(PHASE_ORDER.indexOf(first))) outcomes.skipped(p, why)
}

// THE DESCRIBE STOP'S WHOLE RETURN, hoisted out of `run` (PR #171 review, m-dymytrova) exactly as the build core
// hoists `buildRoundEndedEarly` out of `oneRound`: `run` reads as the phase sequence it is, and the payload of a
// stop lives beside the stop. Nothing here decides anything — every value is settled by the caller.
function describeStopReturn({ surface, describeStop, allKeys, totals, scopes, describeAgents, ctx, phaseOutcomes }) {
  return {
    surface,
    skipped: false,
    ...describeStop,
    coverage: { described: 0, digestRows: allKeys.size, total: allKeys.size, ledgerMembers: ledgerOf(totals), complete: false, uncovered: [...allKeys], wiringOnly: [] },
    scopes: scopes.map((s) => ({ role: s.role, schema: s.schema, rows: s.rows })),
    describeAgents,
    conflicts: [], settledElsewhere: [], gaps: [],
    refusals: ctx.refusals || [],
    censusNote: ctx.censusNote || null,
    phaseOutcomes,
  }
}

// AC 6 — A PARTIAL DESCRIBE CARRIES ON, and says which batches did not. The rows a dead batch owned already reach
// the repair round for free: they carry no card, so the coverage arithmetic puts them in `uncoveredKeys` and
// `repairKeys` picks them up. What was missing is the SENTENCE — a batch that never answered and a batch that
// answered without covering its rows produce the identical number, and only one of them is a host failure.
function reportDeadBatches(log, batches, describeReturned) {
  const deadBatches = batches.filter((b, i) => !describeReturned[i])
  if (!deadBatches.length) return
  log(`⚠ ${deadBatches.length} of ${batches.length} Describe batch(es) returned NOTHING — Describe is PARTIAL. The rows owned by ${deadBatches.map((b) => b.scopes.map((s) => s.label).join('+')).join(' | ')} carry no card and go into the repair round; they are unattempted, not unanswerable.`)
}

// TRANSITION 4 — A REPAIR ROUND THAT PRODUCED NOTHING IS NOT A ROUND THAT FOUND NOTHING. Recorded rather than
// stopped: the run still has round 1's cards and its Merge deliverable is still worth writing. But the rows it was
// given come back uncovered either way, and reporting them as "the agents could not describe these" is a verdict
// about the SURFACE that this round did not earn — no agent looked at them. `repair-produced-nothing` is the
// difference, and it is the reason a re-run is worth the operator's time.
function recordRepairOutcome(outcomes, log, { repairBatches, repairReturned, repaired, toRepair }) {
  if (repaired.length) {
    outcomes.record('Repair', repairBatches.length, repairReturned)
    return
  }
  outcomes.note('Repair', 'none', { agentsExpected: repairBatches.length, agentsReturned: 0, stopped: 'repair-produced-nothing' })
  log(`⚠ repair-produced-nothing: all ${repairBatches.length} repair agent(s) returned nothing, so the ${toRepair.length} row(s) this round was given are UNATTEMPTED — they stay uncovered below, but nothing looked at them, so they are not rows the agents could not describe`)
}

export function* run(rawInput, io = {}) {
  const log = io.log || noop
  const phase = io.phase || noop

  // ENG-96778 — WHAT EACH PHASE ACTUALLY DID, reported on EVERY exit path below. A `stopped` code names the phase
  // that ENDED the run; this names the ones that limped and did not. Both are needed: a run can finish, report a
  // coverage number and have had its adversarial pass die, and the only record of that used to be a log line the
  // caller never sees.
  const outcomes = makePhaseOutcomes()
  // …and the one call an early exit makes to say the phases after it never ran — see `skipPhasesFrom`.
  const skipFrom = (first, why) => skipPhasesFrom(outcomes, first, why)

  const input = normalizeInput(rawInput)
  assertInput(input)

  const SURFACE = input.sectionSchema || '(surface not named)'
  const ROWS_PER_AGENT = positiveOr(input.rowsPerAgent, DEFAULT_ROWS_PER_AGENT)
  const MAX_DESCRIBE = positiveOr(input.maxDescribeAgents, DEFAULT_MAX_DESCRIBE)

  // A surface with NO imperative rows is the common case, not an edge case: a section built in the wizard often
  // carries `methods: {}`, no `messages` and no `mixins` at all — measured on a real custom section, where the
  // digest reported 0 stubs across all five scopes. Step 5.1 does not apply there, and the caller can say so before
  // any work item runs by passing the digest's `totals`. Without this the run would spend a Context agent and then
  // report `complete: false` on a surface that had nothing to describe — an empty worklist is DONE, not incomplete.
  // The same check runs again after Context for a caller that did not pass `totals`.
  if (declaredNothingToDo(input.totals)) {
    log(`digest reports no imperative rows on ${SURFACE} — step 5.1 does not apply, nothing to describe`)
    skipFrom('Context', NOTHING_TO_DESCRIBE)
    return skippedReturn(SURFACE, input.totals, { phaseOutcomes: outcomes.snapshot() })
  }

  const RULES = rules({ surface: SURFACE, environment: input.environment, outDir: input.outDir, digest: input.digest, manifest: input.manifest })
  const sharedCoreDefault = `${input.outDir}/customizations-shared-core.md`

  phase('Context')
  const [ctx] = yield step({
    items: [{
      id: itemId('context', 'census-shared-core'),
      phase: 'Context',
      role: 'general-purpose',
      prompt: contextPrompt(RULES, sharedCoreDefault),
      inputFiles: [input.digest, input.manifest],
      responseSchema: CONTEXT_SCHEMA,
      access: ACCESS.STAND_READ_ONLY,
      label: 'context:census+shared-core',
    }],
    requires: ['subAgents', 'structuredOutput'],
    note: 'census + shared core (base chain, mixins, message register) + the row inventory',
  })

  // A Context item that returned NOTHING is an orchestration failure, not a surface with nothing on it. Both used
  // to reduce to an empty `scopes` array and take the "empty worklist is DONE" exit below, reporting a complete
  // zero-row analysis for a digest that may be full — the one outcome this workflow exists to make impossible.
  outcomes.record('Context', 1, [ctx])
  if (!ctx) {
    log('the Context phase returned nothing — the scope census and the shared-core reading are missing, so this run cannot say what there was to describe')
    skipFrom('Describe', 'the Context phase returned nothing, so there is no inventory to describe')
    return {
      surface: SURFACE,
      skipped: false,
      stopped: 'context-failed',
      reason: 'the Context phase returned no result, so the scope inventory is unknown — this is a failed run, NOT a surface with no imperative rows. Re-run; nothing was written.',
      coverage: { described: 0, digestRows: null, total: null, ledgerMembers: null, complete: false, uncovered: [], wiringOnly: [] },
      conflicts: [], settledElsewhere: [], gaps: [], refusals: [],
      phaseOutcomes: outcomes.snapshot(),
    }
  }

  const scopes = normalizeScopes(ctx.scopes)
  const worked = scopes.filter((s) => s.rows > 0)
  const empty = scopes.filter((s) => s.rows === 0)
  const totalRows = worked.reduce((n, s) => n + s.rows, 0)

  // Same verdict as the pre-Context check above, for a caller that did not pass `totals`: an empty worklist is
  // DONE. Reached only when Context has already run, so its census and shared-core reading are still reported back.
  if (!worked.length) {
    log(`no imperative rows on ${SURFACE} — step 5.1 does not apply, nothing to describe`)
    skipFrom('Describe', NOTHING_TO_DESCRIBE)
    return skippedReturn(SURFACE, input.totals, {
      scopes: scopes.map((s) => ({ role: s.role, schema: s.schema, rows: 0 })),
      censusNote: ctx.censusNote || null,
      refusals: ctx.refusals || [],
      phaseOutcomes: outcomes.snapshot(),
    })
  }

  // --- Size-adaptive fan-out, decided here from the inventory -----------------
  const plan = planBatches(worked, totalRows, ROWS_PER_AGENT, MAX_DESCRIBE)
  const batches = plan.batches
  if (plan.note) log(plan.note)
  if (plan.capped) log(plan.capped)

  // A ZERO-ROW SCOPE STILL GETS DESCRIBED. It used to be filtered out with a log
  // line saying it "gets no agent"; the Applicants run then missed a replacing
  // layer whose `rowSelected` override changes visible behaviour (see
  // `attachOverrideOnly`). The scopes are appended to the batches as
  // `overrideOnly`, which adds no keys to `allKeys` — every coverage number below
  // is arithmetically unchanged, and what comes back is reported as its own
  // section rather than as coverage.
  const overrideOnly = attachOverrideOnly(batches, empty)
  if (overrideOnly.length) log(`${overrideOnly.length} scope(s) carry no digest rows and are attached as OVERRIDE-ONLY scopes (replacing layers only, reported outside the coverage count): ${overrideOnly.map((s) => s.label).join(', ')}`)

  const sharedCardList = (ctx.sharedCore?.cards || []).map((c) => `${c.id} — ${c.title}`).join('\n') || '(none returned)'
  const sharedCorePath = ctx.sharedCore?.path || sharedCoreDefault

  const describeItem = (batch, i, { repair = false, roundNote = '' } = {}) => ({
    id: itemId(roundKind(repair), i + 1, batch.scopes.map((s) => s.label).join('+')),
    phase: 'Describe',
    // The analysis contract itself — the member ledger, counted zeros, refusals
    // and acceptance criteria a card must close with — is the `classic-ui-expert`
    // skill, so the ROLE names it. A host without that skill installed cannot
    // satisfy the item, and naming the role is what lets it say so.
    role: 'classic-ui-expert',
    prompt: describePrompt({
      RULES,
      batch,
      sharedCardList,
      sharedCorePath,
      partPath: partFile(input.outDir, batch.scopes[0].label),
      roundNote,
    }),
    inputFiles: [input.digest, sharedCorePath],
    responseSchema: DESCRIBE_SCHEMA,
    access: ACCESS.STAND_READ_ONLY,
    label: `${roundKind(repair)}:${batch.scopes.map((s) => s.label).join('+').slice(0, 40)}`,
  })

  // FOLLOW-UP, NOT DONE HERE: running Context and Describe in parallel would cut the wall clock further, and it is
  // not attemptable as the phases stand — every Describe item consumes `ctx.sharedCore.path` and `sharedCardList`,
  // which only exist once Context has returned. Overlapping them would mean either handing Describe a path to a
  // file not yet written or letting each scope re-read the shared core, which is the duplicate-carding failure the
  // Context phase exists to prevent. Revisit only with a shared-core contract that does not depend on the file.
  // MOVED ABOVE THE DISPATCH (ENG-96778): pure arithmetic over `worked`, and the Describe gate below has to be
  // able to report how many rows the run was holding when the phase died. Nothing about it depends on the answer.
  const allKeys = new Set(worked.flatMap((s) => [...s.methodKeys, ...s.memberKeys]))

  phase('Describe')
  // THE RAW BATCH, holes included. `.filter(Boolean)` is still what the coverage arithmetic reads, but the batch
  // BEFORE it is the only thing that knows WHICH items died — and both the gate below and AC 6's partial report
  // are questions about that, not about the surviving cards.
  const describeReturned = yield step({
    items: batches.map((b, i) => describeItem(b, i)),
    parallel: true,
    requires: ['subAgents', 'structuredOutput', 'parallelism'],
    note: 'one item per scope batch — count decided from the inventory, not fixed',
  })
  let described = describeReturned.filter(Boolean)
  outcomes.record('Describe', batches.length, describeReturned)

  // TRANSITION 2 — DESCRIBE → CRITIQUE. Every Describe agent died, so not one card exists: Critique would have
  // adversarially checked nothing and reported `uncovered: []` for it, and Merge would have written a report over
  // an empty card set. Both would have looked like phases that ran. This is the same class of failure the Context
  // guard above exists for, one phase further down.
  const describeStop = stageGate({
    phase: 'describe', expected: batches.length, results: describeReturned, label: 'Describe',
    what: `not one card was written for the ${allKeys.size} row(s) on ${SURFACE}, so the Critique pass has nothing to check and the Merge phase nothing to merge`,
    fix: 'No card, no report and no index were produced.',
  })
  if (describeStop) {
    log(`the Describe phase returned nothing from any of its ${batches.length} agent(s) — stopping rather than letting Critique and Merge run over an empty card set`)
    skipFrom('Critique', 'Describe produced nothing, so there was nothing to check and nothing to merge')
    return describeStopReturn({ surface: SURFACE, describeStop, allKeys, totals: input.totals, scopes,
      describeAgents: batches.length, ctx, phaseOutcomes: outcomes.snapshot() })
  }
  // AC 6 — the partial Describe carries on and says which batches did not; see `reportDeadBatches`.
  reportDeadBatches(log, batches, describeReturned)

  // --- Coverage is COMPUTED, never asserted ----------------------------------
  const rejectedTriggers = rejectTriggers(described, allKeys, log)
  let covered = coveredKeys(described, allKeys)
  let uncoveredKeys = withRejectedTriggers([...allKeys].filter((k) => !covered.has(k)), rejectedTriggers, allKeys, described)
  // The computed floor under the two-card rule (mixin only — see `wiringOnlyMixinKeys` for why the other
  // body-elsewhere kinds cannot be judged from the inventory, and which one the engine backstops instead).
  let wiringOnly = wiringOnlyMixinKeys(entriesOf(described), allKeys)
  log(`coverage after round 1: ${covered.size}/${allKeys.size} row(s) carry a card · ${uncoveredKeys.length} uncovered · ${wiringOnly.length} mixin row(s) missing the body card`)

  phase('Critique')

  // Retried like a describe scope: a dead Critique otherwise ends the run with no contradiction check and nothing
  // machine-readable saying so. Both failure shapes reach the notifier — a nullish outcome (terminal death per the
  // work-item contract) and a REJECTION, which the driver throws back in here so this `catch` fires. Folding the
  // two into one line left a dead pass reporting THAT it died and never WHY.
  //
  // NO DELAY BETWEEN ATTEMPTS, and not by choice: the core may not use a timer (a Claude workflow script is given
  // none, and a resumed run must replay identically), so there is nothing to await between attempts. What the retry
  // is worth depends on the failure shape — on a nullish outcome the host has already exhausted its own retries, so
  // attempt 2 is a real second chance; on a rejection it may fire against a host that just said it was overloaded
  // and buy nothing. Accepted, because the alternative is no retry at all.
  const critiqueStep = (attempt) => step({
    items: [{
      id: itemId('critique', 'coverage', critiqueIdSuffix(attempt)),
      phase: 'Critique',
      role: 'general-purpose',
      prompt: critiquePrompt({
        RULES,
        allKeys: [...allKeys],
        described,
        uncoveredKeys,
        wiringOnly,
        rejectedTriggers,
        sharedCardList,
        messageRegister: ctx.sharedCore?.messageRegister || [],
      }),
      inputFiles: described.map((r) => r.reportPart).filter(Boolean),
      responseSchema: CRITIQUE_SCHEMA,
      access: ACCESS.STAND_READ_ONLY,
      label: critiqueLabel(attempt),
    }],
    // The adversarial pass is only worth anything from a context that did not
    // write the cards it is checking. A host that cannot give it one is STOPPED
    // rather than allowed to self-review — see capabilities.mjs.
    requires: ['subAgents', 'structuredOutput', 'independentRoles'],
    note: 'which rows carry no card, which cards conflict, which refusal a sibling settles',
  })

  // Retried like a describe scope: a dead Critique otherwise ends the run with no contradiction check and nothing
  // machine-readable saying so. The loop is `retryOnDeath` in helpers.mjs — a delegating generator, so the suite
  // EXECUTES the retry instead of regex-matching its shape here. Both failure shapes (a nullish outcome and a
  // REJECTING host, which the driver throws back in) end an attempt and reach the notifier, so neither can throw
  // past the loud log below.
  const { result: critique, ran: critiqueReturned } = yield* retryOnDeath(
    critiqueStep,
    (attempt, error, willRetry) => log(critiqueDeathLine(attempt, error, willRetry)),
  )

  // What the caller is told is STRONGER than what stopped the retry loop: `critiqueRan: true` sells
  // `conflicts`/`settledElsewhere` as verified-empty, so a non-nullish value that is not a critique satisfies the
  // first question and not the second.
  const critiqueRan = reportCritique(critique, critiqueReturned, log)
  // AC 7 — recorded, NOT stopped. A dead Critique costs the run its contradiction check and nothing else: the
  // cards exist, the coverage arithmetic stands and Merge still has something to merge. `critiqueRan` already told
  // the caller; this tells it apart from the OTHER failure — a host that answered with an unusable shape returned
  // something (`agentsReturned: 1`) and still did not run the pass.
  outcomes.note('Critique', okOrNone(critiqueRan), { agentsExpected: 1, agentsReturned: answeredCount(critiqueReturned), critiqueRan })

  // --- One repair round, and only when there is something to repair ----------
  // Scoped to the SCOPES that own the uncovered rows — never to a bare row list, which is the per-row split the
  // analysis contract forbids.
  const critiqueUncovered = (critique?.uncovered || []).map((u) => u.key).filter((k) => allKeys.has(k))
  const toRepair = repairKeys(uncoveredKeys, critiqueUncovered, wiringOnly)
  if (toRepair.length) {
    const owners = worked.filter((s) => [...s.methodKeys, ...s.memberKeys].some((k) => toRepair.includes(k)))
    log(`repair round: ${toRepair.length} uncovered row(s) across ${owners.length} scope(s)`)
    // `packBatches`, not `planBatches`: the repair round has no "one agent for a
    // small surface" shortcut to apply — it is already scoped to the owners of
    // the uncovered rows, and the cap is one lower so the round always has room.
    const repairBatches = packBatches(owners, ROWS_PER_AGENT, Math.max(1, MAX_DESCRIBE - 1))
    const repairReturned = yield step({
      items: repairBatches.map((b, i) => describeItem(b, i, { repair: true, roundNote: repairNote(toRepair, b, critique?.notes) })),
      parallel: true,
      requires: ['subAgents', 'structuredOutput', 'parallelism'],
      note: 'repair round: the rows the arithmetic says are not described yet',
    })
    const repaired = repairReturned.filter(Boolean)
    // TRANSITION 4 — a repair round that produced nothing is not a round that found nothing; see
    // `recordRepairOutcome` for why the two are reported differently.
    recordRepairOutcome(outcomes, log, { repairBatches, repairReturned, repaired, toRepair })
    described = [...described, ...repaired]
    rejectedTriggers.push(...rejectTriggers(repaired, allKeys, log))
    covered = coveredKeys(described, allKeys)
    uncoveredKeys = [...allKeys].filter((k) => !covered.has(k))
    wiringOnly = wiringOnlyMixinKeys(entriesOf(described), allKeys)
    // Re-unioned, not carried: the line above recomputes from `covered` alone, and a row that came back a SECOND
    // time with a still-invalid trigger has a card — so without this the repair recompute drops it silently.
    uncoveredKeys = withRejectedTriggers(uncoveredKeys, rejectedTriggers, allKeys, described)
    log(`coverage after repair: ${covered.size}/${allKeys.size} · ${uncoveredKeys.length} still uncovered · ${wiringOnly.length} mixin row(s) still missing the body card`)
  }

  // The override-only scopes' answers, separated by KEY KIND before the Merge phase sees them. They carry
  // `<schema>::override:<method>` keys, which resolve to no digest key at all, so they were already invisible to
  // every coverage number above — this only makes them visible to the report.
  const overrideFindings = overrideEntries(described)
  if (overrideFindings.length) log(`${overrideFindings.length} override finding(s) from the override-only scope(s) — reported as their own report section, NOT as coverage of any digest row`)

  phase('Merge')
  const [merged] = yield step({
    items: [{
      id: itemId('merge', 'report-index'),
      phase: 'Merge',
      role: 'general-purpose',
      prompt: mergePrompt({
        RULES,
        sharedCorePath,
        described,
        critique,
        covered: covered.size,
        total: allKeys.size,
        uncoveredKeys,
        wiringOnly,
        rejectedTriggers,
        overrideFindings,
        outDir: input.outDir,
        censusNote: ctx.censusNote,
      }),
      inputFiles: [sharedCorePath, ...described.map((r) => r.reportPart).filter(Boolean)],
      responseSchema: MERGE_SCHEMA,
      access: ACCESS.STAND_READ_ONLY,
      label: 'merge:report+index',
    }],
    requires: ['subAgents', 'structuredOutput'],
    note: 'dedupe the cards, emit customizations.md + behaviour-index.json',
  })

  outcomes.record('Merge', 1, [merged])
  // TRANSITION 5 — MERGE PRODUCED NOTHING. `complete: false` already said the run had no deliverable, and that is
  // exactly the problem: an INCOMPLETE surface and a surface that was fully described but never written out are
  // the same boolean and opposite repairs. The first needs another describe round; the second needs the merge
  // re-run over cards that are already on disk. The stop rides on the FULL return below rather than replacing it —
  // the coverage numbers are real and a caller that loses them re-derives nothing.
  const mergeStop = stageGate({
    phase: 'merge', expected: 1, results: [merged], label: 'Merge',
    what: 'no report and no index were written, so this run produced no deliverable — the coverage numbers it returns are real, but nothing on disk carries them',
    fix: `The cards the Describe round wrote are already in ${input.outDir}, so a fresh run re-merges them instead of re-describing the surface.`,
  })

  // The verdict is arithmetic, not an agent's closing sentence — see `isComplete`. Computed HERE, after the repair
  // round, so it reads the repaired counts. Coverage alone is not completion: the report and the index are the
  // DELIVERABLES, and a Merge item that returned nothing wrote neither.
  const mergeOk = !!(merged?.reportPath && merged?.indexPath)
  if (!mergeOk) log('the Merge phase returned no report/index — the coverage numbers stand, but this run has no deliverable and is NOT complete')
  const complete = mergeOk && isComplete(allKeys.size, uncoveredKeys, wiringOnly)
  const wiringNote = wiringOnly.length ? ` · ${wiringOnly.length} mixin row(s) still missing the body card` : ''
  const verdictLine = complete
    ? `complete: ${covered.size}/${allKeys.size} rows described`
    : `INCOMPLETE: ${uncoveredKeys.length} of ${allKeys.size} rows still carry no card${wiringNote}`
  log(verdictLine)
  // THE TWO NUMBERS, SIDE BY SIDE — and the sentence that says why they differ. The verdict above counts DIGEST
  // rows; the engine's ledger for the scope it mapped is a larger population, and a plan header that printed one
  // of them as "N of M" read as a surface census it never was.
  const ledger = ledgerOf(input.totals)
  log(`${covered.size}/${allKeys.size} digest row(s) described · ${ledger === null ? 'unknown' : ledger} member(s) in the engine's ledger for the scope it mapped — the digest is the WORKLIST, not a surface census`)
  if (rejectedTriggers.length) log(`${rejectedTriggers.length} reported trigger(s) were REJECTED and are not carried into the index: ${rejectedTriggers.map((r) => r.key).join(', ')}`)

  return {
    surface: SURFACE,
    reportPath: merged?.reportPath || `${input.outDir}/customizations.md`,
    indexPath: merged?.indexPath || `${input.outDir}/behaviour-index.json`,
    // THE DIGEST IS A WORKLIST, NOT A SURFACE CENSUS. `digestRows` counts the rows this run was handed;
    // `ledgerMembers` is the engine's own member ledger for the scope it mapped (`result.coverage.total`,
    // travelling in `totals`), which is a LARGER population — measured on the Applicants run: 10 digest method
    // names against 11 definitions, 2 virtual attributes of 5, 3 members of 88. `total` is kept as an alias of
    // `digestRows` for one release, because the parity golden and SKILL.md still read it.
    coverage: {
      described: covered.size,
      digestRows: allKeys.size,
      total: allKeys.size,
      ledgerMembers: ledgerOf(input.totals),
      complete, uncovered: uncoveredKeys, wiringOnly,
    },
    rejectedTriggers,
    // Replacing-layer overrides found in scopes the digest gave 0 rows. NOT coverage of anything: their keys
    // (`<schema>::override:<method>`) match no digest key, so they are reported beside the count, never inside it.
    overrideFindings,
    scopes: scopes.map((s) => ({ role: s.role, schema: s.schema, rows: s.rows })),
    describeAgents: batches.length,
    cardCount: merged?.cardCount ?? null,
    droppedDuplicates: merged?.droppedDuplicates || [],
    // false = the adversarial pass died even after the retry: conflicts and settledElsewhere below are
    // unchecked (not verified-empty), and coverage.complete is arithmetic-only — no pass verified that
    // cited cards actually describe their rows.
    critiqueRan,
    conflicts: critique?.conflicts || [],
    settledElsewhere: critique?.settledElsewhere || [],
    gaps: described.flatMap((r) => r.gaps || []),
    refusals: [...(ctx.refusals || []), ...described.flatMap((r) => r.refusals || [])],
    censusNote: ctx.censusNote || null,
    // What the caller does next: merge indexPath into the manifest as `behaviourIndex` and re-run `--plan --out`.
    // The plan's own worklist headers then report the same coverage from the engine's side.
    next: 'merge indexPath into manifest.behaviourIndex, then re-run `node engine/migrate.mjs <manifest> --plan --out <plan-file>`',
    // ENG-96778 — WHAT EACH PHASE DID, on the healthy return as well as on every stop above. A run can be
    // `complete` and still have limped (a Describe batch that died and was repaired, a Critique that never ran),
    // and until now the only trace of that was a log line.
    phaseOutcomes: outcomes.snapshot(),
    // …AND THE MERGE STOP, spread LAST on purpose. `stopped`, `reason` and `next` are the gate's when it fired: a
    // `next` telling the caller to merge an index that was never written is worse than no `next` at all. `complete`
    // is already false on that path through `mergeOk`, so nothing here re-decides the verdict.
    // `...mergeStop` and not `...(mergeStop || {})` (PR #171 review, Sonar S7744): spreading `null` in an object
    // literal is already a no-op, so the guard only made the null case look like a case.
    ...mergeStop,
  }
}

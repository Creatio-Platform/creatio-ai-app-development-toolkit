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
import { CONTEXT_SCHEMA, DESCRIBE_SCHEMA, CRITIQUE_SCHEMA, MERGE_SCHEMA } from './schemas.mjs'
import { rules, contextPrompt, describePrompt, repairNote, critiquePrompt, mergePrompt } from './prompts.mjs'
import {
  normalizeScopes, planBatches, packBatches, repairKeys, isComplete, wiringOnlyMixinKeys, coveredKeys, entriesOf,
  keyCollapse, declaredNothingToDo, isCritiqueShape, critiqueDeathLine, retryOnDeath, stepOutcome, failureCause, itemId, partFile,
  censusShortfall, mergeDeathLine, ambiguousEntryKeys, digestKeyOf,
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
function skippedReturn(surface, extra = {}) {
  return {
    surface,
    skipped: true,
    reason: NOTHING_TO_DESCRIBE,
    coverage: { described: 0, total: 0, complete: true, uncovered: [], wiringOnly: [] },
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

// The three blocks below were lifted OUT of `run()` unchanged — same log strings, same returned object, same
// order — because `run()` sits at the cognitive-complexity line and every future phase adds to it. Each is pure
// (`log` in, a value out), so the parity suite still compares the identical bytes it compared before.

// A Context item that returned nothing and a Context item that REJECTED are the same root cause with two
// caller-visible results, and they need different repairs. The nullish case keeps its EXACT baseline wording,
// log line and `reason` — `run-workflow-parity` compares the return value against the pre-migration script byte
// for byte, and a rewording would read as a behaviour change where there is none. A rejection is the case that
// had no verdict at all, so that is the one that gains the cause.
function contextFailedReturn(contextOutcome, surface, log) {
  const cause = failureCause(contextOutcome.error, !!contextOutcome.error)
  log(cause
    ? `the Context agent rejected — ${cause} — the scope census and the shared-core reading are missing, so this run cannot say what there was to describe`
    : 'the Context agent returned nothing — the scope census and the shared-core reading are missing, so this run cannot say what there was to describe')
  return {
    surface,
    skipped: false,
    stopped: 'context-failed',
    reason: cause
      ? `the Context phase rejected (${cause}), so the scope inventory is unknown — this is a failed run, NOT a surface with no imperative rows. Re-run; nothing was written.`
      : 'the Context phase returned no result, so the scope inventory is unknown — this is a failed run, NOT a surface with no imperative rows. Re-run; nothing was written.',
    coverage: { described: 0, total: null, complete: false, uncovered: [], wiringOnly: [] },
    conflicts: [], settledElsewhere: [], gaps: [], refusals: [],
  }
}

// A CONTEXT THAT CAME BACK SHORT is a failed run, not a small surface. The digest declares how many scopes it
// carries; when the inventory names fewer, every count after this point is taken over the scopes that arrived and
// presented as the whole surface — the fan-out plans for them, the coverage denominator counts them, and the
// verdict reports `complete` over a fraction. Measured: a run that described 1 of 18 scopes and logged
// `complete: 547/547`.
//
// STOPPED, not degraded. The scopes that did arrive could be described, but the deliverable would carry a
// provenance header claiming a surface it never read, and the plan folds that index back in as if it were whole.
// A named stop costs the operator one re-run with a split handoff; a partial report that reads as complete costs
// whatever is built on it. `censusNote` is carried out verbatim because it is where the agent says WHY — on the
// measured run it named the file holding the other 17 scopes.
function censusShortfallReturn(shortfall, ctx, surface, log) {
  const { declared, returned, missing } = shortfall
  log(`the Context agent returned ${returned} of the ${declared} scope(s) the digest declares — ${missing} missing, so any coverage count here would be taken over part of the surface and reported as all of it`)
  if (ctx.censusNote) log(`censusNote: ${ctx.censusNote}`)
  return {
    surface,
    skipped: false,
    stopped: 'census-short',
    reason: `the Context phase returned ${returned} of ${declared} declared scope(s). This is a failed run, NOT a surface with fewer rows than the digest says: the missing ${missing} scope(s) would be counted as described. TWO causes, in this order: (1) the digest is STALE — regenerate it with \`node engine/migrate.mjs <manifest> --stubs --out <file>\` on this version, because a digest written before scope de-duplication counts one page several times and its \`totals.scopes\` is higher than the surface has; (2) the inventory did not fit one structured answer — see \`censusNote\`, then split the surface and hand the parts to separate runs. Nothing was written.`,
    coverage: { described: 0, total: null, complete: false, uncovered: [], wiringOnly: [] },
    scopes: (ctx.scopes || []).map((s) => ({ role: s.role, schema: s.schema ?? null })),
    censusNote: ctx.censusNote || null,
    conflicts: [], settledElsewhere: [], gaps: [], refusals: ctx.refusals || [],
  }
}

// KEY COLLAPSE: two scopes that both omit `schema` share the bare key form, so their rows land on ONE coverage
// row and the denominator silently shrinks below the surface. `qualifyKey` keeps the bare form on purpose - the
// engine's `stubScope` writes a deliberate null and the two sides have to match - and the engine defends the
// invariant by spending the `"Section"` literal in `sectionStubScopes` so a second null-schema scope cannot
// happen there. Nothing checked it HERE, on the consumer side, and `SCOPE.required` does not list `schema`, so a
// schema-validating host permits the omission. `censusShortfall` cannot see it either: the collapse changes no
// scope COUNT, so the run passes the census gate and reports `complete` over a fraction of the surface - the
// exact failure ENG-96529 defect 2 exists to close. The check is arithmetic, which is the standard this module
// sets for itself: rows dispatched must equal rows counted.
function keyCollapseReturn(collapse, ctx, surface, log) {
  const { totalRows, keyCount, duplicated } = collapse
  log(`${totalRows} row(s) would be dispatched but only ${keyCount} coverage row(s) exist - ${duplicated.length} key(s) are claimed by more than one scope: ${duplicated.join(', ')}`)
  return {
    surface,
    skipped: false,
    stopped: 'key-collapse',
    reason: `${totalRows} row(s) across the inventory collapse into ${keyCount} coverage key(s), so one agent describing one row would mark another scope's row described and the run would report \`complete\` over a smaller denominator than the surface has. Key(s) claimed by more than one scope: ${duplicated.join(', ')}. CAUSE: more than one scope was returned WITHOUT a \`schema\`, and a schema-less scope keeps the bare key form so it can match the engine's own stub scope. FIX: give every scope but at most one a \`schema\` in the Context answer (the engine does this with a deterministic literal - see \`sectionStubScopes\` in engine/migrate.mjs), then re-run. Nothing was written.`,
    coverage: { described: 0, total: keyCount, complete: false, uncovered: [], wiringOnly: [] },
    scopes: (ctx.scopes || []).map((s) => ({ role: s.role, schema: s.schema ?? null })),
    censusNote: ctx.censusNote || null,
    conflicts: [], settledElsewhere: [], gaps: [], refusals: ctx.refusals || [],
  }
}

// Coverage alone is not completion: the report and the index are the DELIVERABLES, and a Merge item that returned
// nothing wrote neither. Returns `mergeOk` so the caller keeps computing the verdict from it.
function reportMerge(merged, mergeOutcome, log) {
  const mergeOk = !!(merged?.reportPath && merged?.indexPath)
  if (!mergeOk) {
    const mergeCause = failureCause(mergeOutcome.error, !!mergeOutcome.error)
    const cause = mergeCause ? ` — ${mergeCause}` : ''
    log(`the Merge phase returned no report/index${cause} — the coverage numbers stand, but this run has no deliverable and is NOT complete`)
  }
  return mergeOk
}

// The closing line, arithmetic only — see `isComplete` for why the verdict is never an agent's closing sentence.
function verdictLine({ complete, covered, total, uncoveredKeys, wiringOnly }) {
  const wiringNote = wiringOnly.length ? ` · ${wiringOnly.length} mixin row(s) still missing the body card` : ''
  return complete
    ? `complete: ${covered}/${total} rows described`
    : `INCOMPLETE: ${uncoveredKeys.length} of ${total} rows still carry no card${wiringNote}`
}

export function* run(rawInput, io = {}) {
  const log = io.log || noop
  const phase = io.phase || noop

  const input = normalizeInput(rawInput)
  assertInput(input)

  const SURFACE = input.sectionSchema || '(surface not named)'
  const ROWS_PER_AGENT = Number(input.rowsPerAgent) > 0 ? Number(input.rowsPerAgent) : DEFAULT_ROWS_PER_AGENT
  const MAX_DESCRIBE = Number(input.maxDescribeAgents) > 0 ? Number(input.maxDescribeAgents) : DEFAULT_MAX_DESCRIBE

  // A surface with NO imperative rows is the common case, not an edge case: a section built in the wizard often
  // carries `methods: {}`, no `messages` and no `mixins` at all — measured on a real custom section, where the
  // digest reported 0 stubs across all five scopes. Step 5.1 does not apply there, and the caller can say so before
  // any work item runs by passing the digest's `totals`. Without this the run would spend a Context agent and then
  // report `complete: false` on a surface that had nothing to describe — an empty worklist is DONE, not incomplete.
  // The same check runs again after Context for a caller that did not pass `totals`.
  if (declaredNothingToDo(input.totals)) {
    log(`digest reports no imperative rows on ${SURFACE} — step 5.1 does not apply, nothing to describe`)
    return skippedReturn(SURFACE)
  }

  const RULES = rules({ surface: SURFACE, environment: input.environment, outDir: input.outDir, digest: input.digest, manifest: input.manifest })
  const sharedCoreDefault = `${input.outDir}/customizations-shared-core.md`

  phase('Context')
  // Through `stepOutcome`, because the driver has TWO ways to report a failed Context and only one of
  // them used to reach the structured verdict below. A nullish outcome (terminal death) arrives as
  // `value: null`; a REJECTION is thrown back in here by `sendFor`, and with no catch it propagated
  // straight out of `run()` as a raw exception — same root cause, two caller-visible results: a
  // documented verdict object, or a stack trace with no coverage numbers at all.
  const contextOutcome = yield* stepOutcome(step({
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
  }))
  const ctx = contextOutcome.value

  // A Context item that returned NOTHING is an orchestration failure, not a surface with nothing on it. Both used
  // to reduce to an empty `scopes` array and take the "empty worklist is DONE" exit below, reporting a complete
  // zero-row analysis for a digest that may be full — the one outcome this workflow exists to make impossible.
  if (!ctx) return contextFailedReturn(contextOutcome, SURFACE, log)

  const scopes = normalizeScopes(ctx.scopes)

  // Before any count is taken over them: did the census cover the whole surface? See `censusShortfallReturn`.
  const shortfall = censusShortfall(input.totals, scopes)
  if (shortfall) return censusShortfallReturn(shortfall, ctx, SURFACE, log)

  const worked = scopes.filter((s) => s.rows > 0)
  const empty = scopes.filter((s) => s.rows === 0)
  const totalRows = worked.reduce((n, s) => n + s.rows, 0)
  if (empty.length) log(`${empty.length} scope(s) carry no rows and get no agent: ${empty.map((s) => s.label).join(', ')}`)

  // Same verdict as the pre-Context check above, for a caller that did not pass `totals`: an empty worklist is
  // DONE. Reached only when Context has already run, so its census and shared-core reading are still reported back.
  if (!worked.length) {
    log(`no imperative rows on ${SURFACE} — step 5.1 does not apply, nothing to describe`)
    return skippedReturn(SURFACE, {
      scopes: scopes.map((s) => ({ role: s.role, schema: s.schema, rows: 0 })),
      censusNote: ctx.censusNote || null,
      refusals: ctx.refusals || [],
    })
  }

  // Rows dispatched vs rows countable: see `keyCollapseReturn`. Checked BEFORE any agent is dispatched, because
  // the cost of the collapse is paid in the coverage arithmetic that runs after them.
  const collapse = keyCollapse(worked)
  if (collapse) return keyCollapseReturn(collapse, ctx, SURFACE, log)

  // --- Size-adaptive fan-out, decided here from the inventory -----------------
  const plan = planBatches(worked, totalRows, ROWS_PER_AGENT, MAX_DESCRIBE)
  const batches = plan.batches
  if (plan.note) log(plan.note)
  if (plan.capped) log(plan.capped)

  const sharedCardList = (ctx.sharedCore?.cards || []).map((c) => `${c.id} — ${c.title}`).join('\n') || '(none returned)'
  const sharedCorePath = ctx.sharedCore?.path || sharedCoreDefault

  // The part file each dispatched item was ASKED for, by item id. Read back by `acceptParts` below.
  const askedPart = new Map()

  // PR #147 review — an answer whose `reportPart` is not the path the item was handed is NAMED, not waved through.
  // The core used to accept whatever path came back, so an agent writing round 1's file from the repair round left
  // no trace at all; this line is what makes a recurrence, or any other path drift, visible in the run log.
  //
  // Deliberately a WARNING, not a rejection: the returned path is the one Merge folds in (`inputFiles`), so the
  // cards are still merged and the coverage arithmetic still describes what the report contains. Dropping the
  // answer would discard real analysis over a path string, which is a worse failure than reporting the mismatch.
  // PR #147 review — the parts to READ, deduplicated. `described` is round 1 plus the repair round, so a part
  // path returned by an item in each round listed the same file twice; the round marker in `partFile` stops that
  // arising from the rounds, and this stops it arising at all. A duplicate input file is never useful — it either
  // reads the same cards twice or hides that two items claimed one file.
  const partsToRead = () => [...new Set(described.map((r) => r.reportPart).filter(Boolean))]

  const acceptParts = (items, results) => results.map((r, i) => {
    const want = askedPart.get(items[i]?.id)
    if (r && want && r.reportPart !== want) {
      log(`⚠ \`${items[i].id}\` wrote \`${r.reportPart}\` but was asked for \`${want}\` — its cards are merged from the path it returned, and the two must not drift: a part file shared by two items loses one of them`)
    }
    return r
  }).filter(Boolean)

  // The ROUND is threaded into both the part path and the card id namespace: a repair round handed round 1's file
  // and round 1's `C01…` numbering overwrote the first pass's cards and collided with its ids, while `coveredKeys`
  // still counted round 1's rows as described. See `partFile` for why the round, and not the batch index, is the
  // axis that collided.
  const describeItem = (batch, i, { repair = false, roundNote = '' } = {}) => {
    const round = repair ? 2 : 1
    const id = itemId(repair ? 'repair' : 'describe', i + 1, batch.scopes.map((s) => s.label).join('+'))
    const partPath = partFile(input.outDir, batch.scopes[0].label, round)
    askedPart.set(id, partPath)
    return {
      id,
      phase: 'Describe',
      // The analysis contract itself — the member ledger, counted zeros, refusals
      // and acceptance criteria a card must close with — is the `classic-ui-expert`
      // skill, so the ROLE names it. A host without that skill installed cannot
      // satisfy the item, and naming the role is what lets it say so.
      role: 'classic-ui-expert',
      prompt: describePrompt({ RULES, batch, sharedCardList, sharedCorePath, partPath, round, roundNote }),
      inputFiles: [input.digest, sharedCorePath],
      responseSchema: DESCRIBE_SCHEMA,
      access: ACCESS.STAND_READ_ONLY,
      label: `${repair ? 'repair' : 'describe'}:${batch.scopes.map((s) => s.label).join('+').slice(0, 40)}`,
    }
  }

  phase('Describe')
  const describeItems = batches.map((b, i) => describeItem(b, i))
  let described = acceptParts(describeItems, yield step({
    items: describeItems,
    parallel: true,
    requires: ['subAgents', 'structuredOutput', 'parallelism'],
    note: 'one item per scope batch — count decided from the inventory, not fixed',
  }))

  // --- Coverage is COMPUTED, never asserted ----------------------------------
  const allKeys = new Set(worked.flatMap((s) => [...s.methodKeys, ...s.memberKeys]))
  let covered = coveredKeys(described, allKeys)
  let uncoveredKeys = [...allKeys].filter((k) => !covered.has(k))
  // The computed floor under the two-card rule (mixin only — see `wiringOnlyMixinKeys` for why the other
  // body-elsewhere kinds cannot be judged from the inventory, and which one the engine backstops instead).
  let wiringOnly = wiringOnlyMixinKeys(entriesOf(described), allKeys)
  log(`coverage after round 1: ${covered.size}/${allKeys.size} row(s) carry a card · ${uncoveredKeys.length} uncovered · ${wiringOnly.length} mixin row(s) missing the body card`)
  // Said out loud, because the coverage numbers cannot say it: an answer keyed with a bare name two scopes both
  // declare is evidence about neither body, so it drops out of `covered` and its rows read exactly like rows
  // nobody answered. The repair those two need is opposite — re-key the answer, versus describe the row — and
  // without this line the repair round dispatches for work that was already done and may come back keyed the
  // same way.
  const ambiguous = ambiguousEntryKeys(entriesOf(described), allKeys)
  if (ambiguous.length) {
    log(`⚠ ${ambiguous.length} answer(s) name a method more than one scope declares and give no scope, so they describe neither row: ${ambiguous.join(', ')} — the repair round asks for these again, keyed \`<schema>::<method>\` as the inventory lists them`)
  }

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
      id: itemId('critique', 'coverage', attempt > 1 ? `retry${attempt}` : ''),
      phase: 'Critique',
      role: 'general-purpose',
      prompt: critiquePrompt({
        RULES,
        allKeys: [...allKeys],
        described,
        uncoveredKeys,
        wiringOnly,
        sharedCardList,
        messageRegister: ctx.sharedCore?.messageRegister || [],
      }),
      inputFiles: partsToRead(),
      responseSchema: CRITIQUE_SCHEMA,
      access: ACCESS.STAND_READ_ONLY,
      label: attempt > 1 ? 'critique:coverage-retry' : 'critique:coverage',
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

  // --- One repair round, and only when there is something to repair ----------
  // Scoped to the SCOPES that own the uncovered rows — never to a bare row list, which is the per-row split the
  // analysis contract forbids.
  // PR #147 review — resolved through `digestKeyOf`, the same normaliser `coveredKeys` and
  // `wiringOnlyMixinKeys` use, NOT a strict `allKeys.has`. ENG-96529 made `normalizeScopes` requalify every scope
  // key, so bare method keys no longer exist in `allKeys`; the Critique is an analysis agent and may legitimately
  // answer with either form. Under the strict test a Critique answering `onSaved` was DROPPED, and the dropped
  // rows are the dangerous ones: rows the arithmetic already counts as covered because they carry a card, which
  // the adversarial pass judged undescribed. They never reached `repairKeys`, no repair item was dispatched, and
  // the run still reported `complete: true` — the same silent coverage hole ENG-96529 exists to close.
  const critiqueUncoveredRaw = (critique?.uncovered || []).map((u) => u?.key).filter((k) => typeof k === 'string')
  const critiqueUncovered = critiqueUncoveredRaw.map((k) => digestKeyOf(k, allKeys)).filter(Boolean)
  // Named, not dropped — the way `ambiguousEntryKeys` already reports a Describe answer that cannot be
  // attributed to one row. A critique key that resolves to nothing is either ambiguous across schemas or names no
  // inventory row at all; either way it is an adversarial finding this run is about to lose, so it is said out
  // loud rather than swallowed by the filter.
  const critiqueUnattributable = [...new Set(critiqueUncoveredRaw
    .filter((k) => digestKeyOf(k, allKeys) === null))]
  if (critiqueUnattributable.length) {
    log(`⚠ ${critiqueUnattributable.length} critique key(s) cannot be attributed to one inventory row, so they cannot route into the repair round: ${critiqueUnattributable.join(', ')} — re-key them \`<schema>::<method>\` as the inventory lists them`)
  }
  const toRepair = repairKeys(uncoveredKeys, critiqueUncovered, wiringOnly)
  if (toRepair.length) {
    const owners = worked.filter((s) => [...s.methodKeys, ...s.memberKeys].some((k) => toRepair.includes(k)))
    log(`repair round: ${toRepair.length} uncovered row(s) across ${owners.length} scope(s)`)
    // `packBatches`, not `planBatches`: the repair round has no "one agent for a
    // small surface" shortcut to apply — it is already scoped to the owners of
    // the uncovered rows, and the cap is one lower so the round always has room.
    const repairBatches = packBatches(owners, ROWS_PER_AGENT, Math.max(1, MAX_DESCRIBE - 1))
    const repairItems = repairBatches.map((b, i) => describeItem(b, i, { repair: true, roundNote: repairNote(toRepair, b, critique?.notes) }))
    const repaired = acceptParts(repairItems, yield step({
      items: repairItems,
      parallel: true,
      requires: ['subAgents', 'structuredOutput', 'parallelism'],
      note: 'repair round: the rows the arithmetic says are not described yet',
    }))
    described = [...described, ...repaired]
    covered = coveredKeys(described, allKeys)
    uncoveredKeys = [...allKeys].filter((k) => !covered.has(k))
    wiringOnly = wiringOnlyMixinKeys(entriesOf(described), allKeys)
    log(`coverage after repair: ${covered.size}/${allKeys.size} · ${uncoveredKeys.length} still uncovered · ${wiringOnly.length} mixin row(s) still missing the body card`)
  }

  phase('Merge')
  // Same gap as the Context yield: a rejecting Merge threw out of `run()` and discarded the deliberate
  // `mergeOk === false` handling immediately below it, which is what tells the caller the coverage
  // numbers stand but there is no deliverable.
  //
  // RETRIED, like Critique, and for a stronger reason. Merge is the ONLY phase whose death costs the run its
  // deliverable: coverage can be complete and the report still not exist, which is the one outcome an operator
  // cannot work around without redoing the analysis. Describe already has a recovery path — a dead item's rows
  // fall into `uncoveredKeys` and the repair round re-describes them, scoped to the owning scopes — and Merge has
  // none. Measured: three consecutive runs died here, all with full coverage, all with no file.
  //
  // Same no-delay caveat as `retryOnDeath`'s: the core may not use a timer, so attempt 2 fires immediately. On a
  // terminal death the host has already exhausted its own retries and this is a real second chance; on a rejection
  // from an overloaded host it may buy nothing. Accepted — the alternative is what happened, which is no retry.
  let mergeError = null
  const mergeStep = (attempt) => step({
      items: [{
        id: itemId('merge', 'report-index', attempt > 1 ? `retry${attempt}` : ''),
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
          outDir: input.outDir,
          censusNote: ctx.censusNote,
        }),
        inputFiles: [sharedCorePath, ...partsToRead()],
        responseSchema: MERGE_SCHEMA,
        access: ACCESS.STAND_READ_ONLY,
        label: attempt > 1 ? 'merge:report+index-retry' : 'merge:report+index',
      }],
      requires: ['subAgents', 'structuredOutput'],
      note: 'dedupe the cards, emit customizations.md + behaviour-index.json',
    })
  const { result: merged } = yield* retryOnDeath(mergeStep, (attempt, error, willRetry) => {
    // Kept for `reportMerge`, which names the CAUSE in the caller-visible line. The last attempt's error is the
    // one that ended the phase; an earlier one is already logged in full by the line below.
    mergeError = error
    log(mergeDeathLine(attempt, error, willRetry))
  })

  // The verdict is arithmetic, not an agent's closing sentence — see `isComplete`. Computed HERE, after the repair
  // round, so it reads the repaired counts. Coverage alone is not completion: the report and the index are the
  // DELIVERABLES, and a Merge item that returned nothing wrote neither.
  const mergeOk = reportMerge(merged, { error: mergeError }, log)
  const complete = mergeOk && isComplete(allKeys.size, uncoveredKeys, wiringOnly)
  log(verdictLine({ complete, covered: covered.size, total: allKeys.size, uncoveredKeys, wiringOnly }))

  return {
    surface: SURFACE,
    reportPath: merged?.reportPath || `${input.outDir}/customizations.md`,
    indexPath: merged?.indexPath || `${input.outDir}/behaviour-index.json`,
    coverage: { described: covered.size, total: allKeys.size, complete, uncovered: uncoveredKeys, wiringOnly },
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
    //
    // PR #147 review — CONDITIONAL on `mergeOk`. `reportPath`/`indexPath` above fall back to their default names so
    // a caller that checks `complete` still learns where the deliverable would have gone; `next` was unconditional,
    // so a run whose Merge died twice told the operator to fold an index file that was never written.
    next: mergeOk
      ? 'merge indexPath into manifest.behaviourIndex, then re-run `node engine/migrate.mjs <manifest> --plan --out <plan-file>`'
      : 'NOTHING to fold in: the Merge phase died and wrote neither indexPath nor reportPath. Re-run this analysis — the coverage numbers above stand, but there is no deliverable.',
  }
}

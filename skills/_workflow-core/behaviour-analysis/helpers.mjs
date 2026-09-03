// behaviour-analysis/helpers.mjs — the run's DECISIONS, as plain functions.
//
// Everything here is self-contained: it closes over no run state and reaches for
// no host API. How many Describe agents run, which scope goes in which batch,
// which rows count as covered, whether the run is complete — all of it is
// arithmetic over the digest inventory, never a judgement an agent narrates.
// That is the whole point of the phase split: an agent saying "I described
// everything" is not evidence, and that is exactly how a real run left the child
// pages at 0-of-8 described while the plan showed nothing wrong.
//
// These functions used to live inside `---8<---` sentinels in the Claude
// workflow script, sliced out by the test suite because the script cannot be
// imported. They are a real module now; the generated Claude script inlines them
// between the same sentinels, so the slice-based checks still see them in the
// shipped artifact.

// Greedy packing, largest scope first. A scope is never SPLIT: the analysis
// contract's completeness proof is a per-scope member ledger, so half a scope
// cannot prove anything. Oversized single scopes therefore stay whole and get an
// agent to themselves — the batch target bounds the SMALL ones, not the big one.
export function packBatches(list, target, cap) {
  const sorted = [...list].sort((a, b) => b.rows - a.rows)
  const batches = []
  for (const s of sorted) {
    const fit = batches.find((b) => b.rows + s.rows <= target)
    if (fit) { fit.scopes.push(s); fit.rows += s.rows } else batches.push({ scopes: [s], rows: s.rows })
  }
  // Over the cap: MERGE the smallest batches instead of dropping any scope.
  while (batches.length > cap) {
    batches.sort((a, b) => a.rows - b.rows)
    const a = batches.shift(), b = batches.shift()
    batches.push({ scopes: [...a.scopes, ...b.scopes], rows: a.rows + b.rows })
  }
  return batches.sort((a, b) => b.rows - a.rows)
}

// AN ENTRY KEY → THE DIGEST KEY IT ANSWERS. Digest member keys carry their scope
// (`<schema>::<kind>:<name>`) because two pages of one surface may declare the
// same member, while an analysis agent may legitimately answer with either form.
// Normalising in ONE place is what keeps the coverage count and the wiring-only
// leg reading the same row: an exact key wins, otherwise the UNIQUE digest key
// ending in `::<entry key>` does. Ambiguous — two scopes, same suffix, no scope
// given — resolves to nothing, because an answer that cannot be attributed to
// one row is not coverage of either.
export function digestKeyOf(entryKey, keys) {
  if (keys.has(entryKey)) return entryKey
  const suffix = `::${entryKey}`
  const hits = [...keys].filter((k) => k.endsWith(suffix))
  return hits.length === 1 ? hits[0] : null
}

// The computed floor under the two-card rule, MIXIN ONLY — and deliberately so. A `mixin:` row's body is another
// schema by construction and the Context phase cards every mixin body, so an entry naming a wiring card with no
// `bodyCard` is measurably incomplete. The other body-elsewhere kinds cannot be judged from the inventory: a
// `message:` counterpart may sit on this same surface under the same card, one aggregated `module-dep` key hides
// many bodies, and `externalRef` is not marked in the inventory at all (the engine flags THAT leg from the digest
// instead, as an advisory `wiringOnly` plan banner). Keys outside `allKeys` are ignored — an entry for a row this
// run does not own is the unmatched-key problem, reported elsewhere.
//
// This is the BLOCKING leg — it counts against `coverage.complete` and feeds the repair round. The engine's
// `wiringOnlyKeys` (engine/migrate.mjs) is the ADVISORY leg: wider membership (`mixin:` + `externalRef`), banner
// only. Separate functions because the engine is a different program; edit one, look at the other.
export function wiringOnlyMixinKeys(entries, allKeys) {
  // A card NAMES something or it is absent. `""` is schema-valid (`INDEX_ENTRY` sets no `minLength`) and is what
  // a merge agent emits for "nowhere to put one"; read the same way by the engine's `cardRef`, so one entry
  // cannot clear the blocking leg while the advisory leg still counts it (or the reverse).
  const named = (v) => typeof v === 'string' && v.trim().length > 0
  // Resolved to the DIGEST key first, then tested for the mixin kind. Digest member keys carry their scope
  // (`<schema>::mixin:X`), so `startsWith('mixin:')` matched nothing and `allKeys.has(e.key)` rejected the bare
  // form an agent may legitimately answer with — this leg counts against `coverage.complete`, so it silently
  // stopped blocking. The kind is read off the resolved key, which carries it in both forms.
  const resolved = (entries || []).map((e) => ({ e, k: e?.key ? digestKeyOf(e.key, allKeys) : null }))
    .filter((r) => r.k && /(^|::)mixin:/.test(r.k))
  const hasBody = new Set(resolved.filter((r) => named(r.e.bodyCard)).map((r) => r.k))
  return [...new Set(resolved.filter((r) => named(r.e.card) && !hasBody.has(r.k)).map((r) => r.k))]
}

// The repair round's target set: every row the arithmetic says is not described YET — uncovered by this run's own
// count, called uncovered by the critique, or naming only a wiring card. Deduplicated, so a row that two of the
// three name is described once rather than dispatched twice to the same scope.
export function repairKeys(uncovered, critiqueUncovered, wiringOnly) {
  return [...new Set([...(uncovered || []), ...(critiqueUncovered || []), ...(wiringOnly || [])])]
}

// The run's verdict, as arithmetic rather than an agent's closing sentence. A mixin row naming only its wiring
// card counts AGAINST completeness: the row looks covered while the criteria that gate it sit in a card never
// named. Zero keys is NOT complete — an empty digest returns through the skip path, so reaching the verdict with
// no keys means the count never ran, and that must not read as a clean run.
export function isComplete(totalKeys, uncovered, wiringOnly) {
  return totalKeys > 0 && (uncovered || []).length === 0 && (wiringOnly || []).length === 0
}

// A BLANK `card` is not coverage. The schema requires the field but sets no minLength, so `{ key, card: "" }`
// validates — and the engine's own `cardRef` reads an empty card as absent, so the row would render with no card
// while this arithmetic called it described.
export const hasCard = (e) => typeof e.card === 'string' && e.card.trim() !== ''

export const entriesOf = (rs) => (rs || []).flatMap((r) => r?.indexEntries || [])

export function coveredKeys(rs, allKeys) {
  return new Set(entriesOf(rs).filter(hasCard).map((e) => digestKeyOf(e.key, allKeys)).filter(Boolean))
}

// ONE retry, fixed. There is a single caller, and the retry label plus
// `critiqueDeathLine`'s "retrying once" both describe exactly two attempts; a
// configurable count would let those drift apart on its first use.
export const RETRY_ATTEMPTS = 2

// A phase that DIED, retried — and living HERE, as a delegating generator, precisely so the suite can EXECUTE it.
// This loop used to sit inline at the Critique call site, where the only reachable test was a regex over the
// workflow's own source: it proved the loop's SHAPE was present and nothing about whether a second attempt ever
// fires. A condition that silently never allowed one would have passed every check while the retry was a no-op in
// production — on the one path whose whole purpose is that a dead pass stops being silent.
//
// `makeStep(attempt)` returns the work STEP to yield, so the helper stays host-neutral: it never touches an agent
// API, it only asks the driver for one more attempt. `onFailure(attempt, error, willRetry)` carries the CAUSE —
// two different failures end an attempt (a nullish outcome, which is terminal death per the work-item contract,
// and a REJECTION the driver throws back in) and folding them into one generic line left a dead pass reporting
// THAT it died and never WHY.
//
// NO DELAY BETWEEN ATTEMPTS, and not by choice: the core may not use a timer (a Claude workflow script is given
// none, and a resumed run must replay identically), so there is nothing to await between attempts.
//
// Returns `{ result, ran }`, not the bare value. `ran` is what this loop KNOWS — an attempt handed back something.
// A caller re-deriving it as `!!result` reads any falsy-but-PRESENT value as "the phase never ran" and marks a real
// answer UNCHECKED downstream (PR#88 review). Death is a NULLISH outcome; `0`, `''` and `false` are results.
// One yield, both failure shapes, no try/catch at the call site. A nullish outcome comes back as
// `value: null`; a REJECTION is thrown into the generator by the driver's `sendFor`, and an
// unwrapped yield let it propagate out of `run()` as a raw exception — past the structured verdict
// the core had already written for the very same failure. Delegated (`yield*`) so the step still
// reaches the driver unchanged, and so the two call sites that need it stay single expressions
// rather than growing a try/catch each.
export function* stepOutcome(step) {
  try {
    const [value] = yield step
    return { value: value ?? null, error: null }
  } catch (error) {
    return { value: null, error }
  }
}

// How a failed phase names its own cause, in one place: an Error carries `name: message`, and a
// nullish outcome is terminal death per the work-item contract. `null` when nothing failed.
export function failureCause(error, failed) {
  if (!failed) return null
  return error
    ? `${error.name || 'Error'}: ${error.message || String(error)}`
    : 'returned nothing (terminal death per the work-item contract)'
}

export function* retryOnDeath(makeStep, onFailure) {
  let outcome = { result: null, ran: false }
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS && !outcome.ran; attempt++) {
    let error = null
    try {
      const [value] = yield makeStep(attempt)
      if (value !== null && value !== undefined) outcome = { result: value, ran: true }
    } catch (e) {
      error = e || new Error('rejected with no reason given')
    }
    if (!outcome.ran && onFailure) onFailure(attempt, error, attempt < RETRY_ATTEMPTS)
  }
  return outcome
}

// The line a dead attempt logs. It carries the CAUSE: two different failures end
// an attempt — a null return (terminal death, per the work-item contract) and a
// rejection (host refused, schema threw, prompt malformed) — and folding them
// into one generic line left a dead pass reporting THAT it died and never WHY.
export function critiqueDeathLine(attempt, error, willRetry) {
  const cause = error
    ? `${error.name || 'Error'}: ${error.message || String(error)}`
    : 'returned nothing (terminal death per the work-item contract)'
  return `critique agent died on attempt ${attempt} — ${cause}${willRetry ? ' — retrying once' : ''}`
}

// The line a dead MERGE attempt logs. Same two failure shapes as Critique, different stakes: Critique dying
// leaves the run without an adversarial pass, Merge dying leaves it without a deliverable at all — the report and
// the index are the only things step 5.1 produces. Measured: three consecutive runs (one fresh, two resumes)
// where Merge was the last thing to die and every one of them returned full coverage and no file.
export function mergeDeathLine(attempt, error, willRetry) {
  const cause = failureCause(error, true)
  return `merge agent died on attempt ${attempt} — ${cause}${willRetry ? ' — retrying once' : ''}`
}

// What the caller is TOLD is stronger than what stopped the retry loop.
// `critiqueRan: true` sells `conflicts`/`settledElsewhere` as verified-empty, so
// a non-nullish value that is not a critique satisfies the first question and
// not the second, and would report "no conflicts found" for a pass that checked
// nothing. The three fields are exactly the ones the return object reads; a
// PARTIAL object is dead by this test, because the only thing lost is a claim
// that the missing field was verified — which is the claim there is no evidence
// for.
export function isCritiqueShape(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && ['uncovered', 'conflicts', 'settledElsewhere'].every((k) => Array.isArray(value[k]))
}

// BOTH counts must be present AND zero. `!totals.members` was true for a digest that never carried the field, so
// a surface with zero method stubs and real message/mixin members took the "nothing to describe" exit — the engine
// now sums `members`, and requiring the NUMBER here means an older digest without it falls through to Context
// (which computes the census itself) instead of silently skipping the analysis.
export const zeroCount = (v) => typeof v === 'number' && v === 0
export function declaredNothingToDo(totals) {
  const declaredTotals = totals && typeof totals === 'object' ? totals : null
  return !!declaredTotals && zeroCount(declaredTotals.stubs) && zeroCount(declaredTotals.members)
}

// A row key QUALIFIED with the scope that owns it. Member keys already arrive scoped from the engine
// (`<schema>::<kind>:<name>`); method keys do not, and `CONTEXT_SCHEMA` accepts either form, so an agent
// returning the bare name is answering within its schema.
//
// WHY THIS IS NOT COSMETIC. `allKeys` is a Set. On a real section eight scopes declared `onSaved` six times and
// `init`, `save`, `destroy`, `publishMosaicsSum` and five more twice each — 24 rows collapsing to 10 keys, so the
// coverage denominator read 399 for 413 real rows and ONE agent describing ONE `onSaved` marked the other five
// described. The rows were never dispatched and nothing in the arithmetic could see it.
//
// A scope with NO schema keeps the bare form: the record page's schema name is not something the engine knows
// (see `stubScope` in engine/migrate.mjs — the null there is deliberate), and that scope owns the bare key form
// on the engine side too, so inventing a label here would stop the two sides matching.
export const qualifyKey = (schema, key) =>
  schema && typeof key === 'string' && key !== '' && !key.includes('::') ? `${schema}::${key}` : key

// The scope inventory, normalised once: row counts, the qualified key forms, and the label every later
// decision (batch packing, prompts, logs) keys on. Qualifying HERE — rather than at each reader — is what keeps
// the prompt an agent is handed, the coverage denominator, the repair round's owner lookup and `digestKeyOf`'s
// suffix resolution all reading the same spelling of the same row.
export function normalizeScopes(rawScopes) {
  return (rawScopes || []).map((s) => ({
    ...s,
    methodKeys: (s.methodKeys || []).map((k) => qualifyKey(s.schema, k)),
    memberKeys: (s.memberKeys || []).map((k) => qualifyKey(s.schema, k)),
    rows: (s.methodKeys || []).length + (s.memberKeys || []).length,
    label: s.schema || s.role,
  }))
}

// DID CONTEXT REPORT THE WHOLE SURFACE? The digest states how many scopes it carries; the Context agent returns
// the inventory. When it returns FEWER, every later number in this run is computed over a fraction of the surface
// and reports itself as whole — measured once at 547/547 "complete" on 1 of 18 scopes, after 1h51m and 9.3M
// weighted tokens, because the agent could not fit 18 scopes' keys in one structured answer and said so in
// `censusNote` (a field nothing reads). The count is the only part of that a machine can check, so it is checked.
//
// Only a SHORTFALL is a finding. More scopes than declared means the census found something the digest missed —
// the Context prompt asks for exactly that, and it is reported through `refusals`, not stopped here.
export function censusShortfall(totals, scopes) {
  const declared = totals && typeof totals === 'object' ? totals.scopes : null
  if (typeof declared !== 'number' || !Number.isFinite(declared) || declared <= 0) return null
  const returned = (scopes || []).length
  return returned < declared ? { declared, returned, missing: declared - returned } : null
}

// Batch sizing. THEORETICAL DEFAULTS — no measured profile exists yet: the only
// observed run (a product section: 63 rows on the record page, 16 on the mini
// page) took ~47 minutes and ~105 tool calls for the whole surface in ONE agent,
// which is the upper end of comfortable, so ~40 rows is taken as a working
// target and one agent is kept for anything smaller. These are the two numbers
// to revisit once several real custom sections have been profiled.
export const DEFAULT_ROWS_PER_AGENT = 40
// Cap the fan-out. Kept well under a host's concurrency ceiling so Context,
// Critique and Merge always have room, and enforced by MERGING batches rather
// than dropping scopes — a dropped scope is a silent coverage hole, the one
// failure this workflow exists to prevent.
export const DEFAULT_MAX_DESCRIBE = 8

export function planBatches(worked, totalRows, rowsPerAgent, maxDescribe) {
  if (totalRows === 0) return { batches: [], note: null }
  if (totalRows <= rowsPerAgent) {
    // Small surface: one agent over everything. This is the whole-surface run the
    // analysis skill was written for, and it is the DEFAULT rather than a special
    // case — a fan-out is only worth its coordination cost above the threshold.
    return { batches: [{ scopes: worked, rows: totalRows }], note: `${totalRows} row(s) total — under the ${rowsPerAgent}-row target, so ONE describe agent over the whole surface` }
  }
  const batches = packBatches(worked, rowsPerAgent, maxDescribe)
  return {
    batches,
    note: `${totalRows} row(s) across ${worked.length} scope(s) → ${batches.length} describe agent(s) (target ${rowsPerAgent}/agent, cap ${maxDescribe})`,
    capped: batches.length === maxDescribe ? `fan-out hit the cap of ${maxDescribe}: the smallest batches were MERGED, no scope was dropped` : null,
  }
}

// A stable, deterministic work-item id. The journal replays by id, so the id may
// not carry anything that varies between two runs of the same core over the same
// input — no counters that depend on wall-clock, no random suffix.
export function itemId(phase, ...parts) {
  const tail = parts.filter((p) => p !== null && p !== undefined && p !== '').map((p) => String(p).replace(/[^A-Za-z0-9_.:@+-]+/g, '-')).join('.')
  return tail ? `${phase.toLowerCase()}.${tail}` : phase.toLowerCase()
}

// The file a Describe agent writes its part to. Kept beside the batch logic
// because the prompt and the Merge phase must name the SAME path.
export const partFile = (outDir, label) => `${outDir}/customizations-part-${String(label).replace(/[^A-Za-z0-9_-]/g, '-')}.md`

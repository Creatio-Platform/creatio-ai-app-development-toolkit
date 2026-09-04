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

// `behaviourEstablished: false` — an entry that SAYS SO. An analysis agent that wrote a card and then admitted
// in it that the behaviour could not be established was still counted as coverage: the Applicants run reported
// "10 of 10 carry a behaviour card" while the card for `init` said the behaviour was NOT established. So the
// admission is now a FIELD, and an entry carrying it is not coverage on either leg — this is the one place the
// exclusion is applied, so `coveredKeys` and `wiringOnlyMixinKeys` cannot disagree about the same entry. Absent
// or `true` means established, so an index written before the field existed is unaffected.
export const behaviourEstablished = (e) => !e || e.behaviourEstablished !== false

export const entriesOf = (rs) => (rs || []).flatMap((r) => r?.indexEntries || []).filter(behaviourEstablished)

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

// The scope inventory, normalised once: row counts and the label every later
// decision (batch packing, prompts, logs) keys on.
export function normalizeScopes(rawScopes) {
  return (rawScopes || []).map((s) => ({
    ...s,
    methodKeys: s.methodKeys || [],
    memberKeys: s.memberKeys || [],
    rows: (s.methodKeys || []).length + (s.memberKeys || []).length,
    label: s.schema || s.role,
  }))
}

// Batch sizing. MEASURED, and lowered because the first default never fanned out
// at all. The Applicants run: 13 rows across 2 scopes → 1 describe agent, 76.8
// minutes, 993k tokens, every phase sequential inside that one agent. 13 rows is
// well under the old 40-row target, so the small-surface shortcut below took the
// whole surface — the fan-out this workflow was built for had never once fired on
// a real custom section. 12 puts a 13-row / 2-scope surface over the target, which
// is the smallest surface that must still fan out.
export const DEFAULT_ROWS_PER_AGENT = 12
// Cap the fan-out. Kept well under a host's concurrency ceiling so Context,
// Critique and Merge always have room, and enforced by MERGING batches rather
// than dropping scopes — a dropped scope is a silent coverage hole, the one
// failure this workflow exists to prevent.
export const DEFAULT_MAX_DESCRIBE = 8

// The two reasons ONE agent takes the whole surface, as two distinguishable
// lines. They are not the same fact: a small surface is under the target, while a
// single oversized scope is over it and gets one agent only because a scope is
// never SPLIT. One shared string claiming "under the N-row target" was wrong on
// the second case, and that is the line an operator reads when asking why a
// 40-row run never fanned out.
function shortcutNote(worked, totalRows, rowsPerAgent) {
  return totalRows <= rowsPerAgent
    ? `${totalRows} row(s) total — under the ${rowsPerAgent}-row target, so ONE describe agent over the whole surface`
    : `${totalRows} row(s) in a SINGLE scope (${worked[0]?.label}) — over the ${rowsPerAgent}-row target, but a scope is never split, so ONE describe agent`
}

export function planBatches(worked, totalRows, rowsPerAgent, maxDescribe) {
  if (totalRows === 0) return { batches: [], note: null }
  // ONE agent on exactly two conditions. `worked.length === 1` is a documented
  // fast path rather than a behaviour change — `packBatches` never splits a
  // scope, so a lone scope would come back as one batch anyway; stating it here
  // is what lets the note say WHY. Everything multi-scope goes through the
  // packing, which is the leg the Applicants run never reached.
  if (worked.length === 1 || totalRows <= rowsPerAgent) {
    return { batches: [{ scopes: worked, rows: totalRows }], note: shortcutNote(worked, totalRows, rowsPerAgent) }
  }
  const batches = packBatches(worked, rowsPerAgent, maxDescribe)
  return {
    batches,
    note: `${totalRows} row(s) across ${worked.length} scope(s) → ${batches.length} describe agent(s) (target ${rowsPerAgent}/agent, cap ${maxDescribe}) — a multi-scope surface goes through the packing, never the one-agent shortcut`,
    capped: batches.length === maxDescribe ? `fan-out hit the cap of ${maxDescribe}: the smallest batches were MERGED, no scope was dropped` : null,
  }
}

// A ZERO-ROW SCOPE IS STILL DESCRIBED — as an OVERRIDE-ONLY scope.
//
// The digest lists a scope with 0 stubs and 0 members when the engine could map
// every row it found; that is NOT the same as the scope changing nothing.
// Measured on the Applicants run: scope "section" had stubs 0 / members 0 and was
// skipped with "gets no agent", while card `shared/C03` proved a replacing layer
// in that scope's parent chain changes visible behaviour — a `rowSelected`
// override with no `callParent`, giving a 750 ms delay and a mini-card that does
// not close. Nobody was asked to look, so nobody found it.
//
// The scopes are ATTACHED to the existing batches rather than given batches of
// their own: they add no keys to `allKeys`, so every coverage number is unchanged,
// and the agent that already reads the surface is the cheapest place to put the
// question. APPENDED, never unshifted — `batch.scopes[0].label` names the part
// file and the work-item id, and both must stay a worked scope. Round-robin over
// the array order (never a Set) so two runs of the same input attach identically.
// WITH NO BATCHES THIS THROWS rather than returning the scopes unattached. `core.mjs` guards the case: its
// `if (!worked.length)` exit returns before `planBatches`, so `batches` is non-empty at every real call site. The
// old silent `return attached` could therefore only be reached by a future caller that dropped that guard — and it
// returned scopes that LOOK attached (the caller logs "N scope(s) ... attached as OVERRIDE-ONLY") while no agent
// was ever asked to describe them. That is precisely the failure this function was written to fix, reintroduced
// silently. Zero scopes with zero batches stays quiet: there is nothing to attach and nothing was lost.
export function attachOverrideOnly(batches, empty) {
  const attached = (empty || []).map((s) => ({ ...s, overrideOnly: true }))
  if (!attached.length) return attached
  if (!batches.length) {
    throw new Error(`attachOverrideOnly: ${attached.length} override-only scope(s) (${attached.map((s) => s.label).join(', ')}) but NO batches to attach them to - they would be reported as attached while no Describe agent was asked to look at them. The caller must exit on an empty worked-scope inventory (core.mjs's !worked.length guard) before reaching here.`)
  }
  attached.forEach((s, i) => batches[i % batches.length].scopes.push(s))
  return attached
}

// THE KEY AN OVERRIDE CARD CARRIES, and why it is schema-qualified. `digestKeyOf`
// resolves a BARE key by unique suffix match, so an override card keyed
// `rowSelected` would resolve to the digest key `MainPage::rowSelected` and be
// counted as real coverage of a row nobody described. Qualifying with the scope
// AND the `override:` kind puts the key outside every digest key by construction.
// USED by `prompts.mjs`'s `overrideOnlyBlock` to spell the key shape it instructs the agent to write. The prompt
// used to re-type the literal, so the machine constant that RECOGNISES the key (`OVERRIDE_KEY_RX` below, and every
// reader of it) and the prompt that ASKS for it were two hand-kept copies of one format. The generator inlines
// `helpers.mjs` before `prompts.mjs` into one scope, and `overrideOnlyBlock` reads it at CALL time (not at module
// evaluation), so the un-hoisted `const` is initialized by then.
export const overrideKey = (schema, method) => `${schema}::override:${method}`

// The override findings, picked back out of what the describe agents returned.
// They travel in `indexEntries` (no schema change: `INDEX_ENTRY` already carries
// key + card + ac) and are separated HERE by their key kind, so the coverage
// arithmetic never sees them and the merge can render them as their own section.
// Deliberately NOT filtered through `behaviourEstablished`: an override the agent
// could not fully establish is still a finding worth printing, and it counts
// towards nothing.
// SCHEMA-QUALIFIED, not the bare `override:<method>` form. `overrideKey` and `prompts.mjs`'s `overrideOnlyBlock`
// both mandate `<schema>::override:<method>` verbatim, and the qualification is the whole reason the key is safe:
// a bare `override:rowSelected` carries no scope, so nothing downstream can say WHICH replacing layer it came
// from, and the engine's mirror leg (`unmatchedIndexKeys` in engine/migrate.mjs) filters on the same form. The
// old `(^|::)` alternative accepted a key no producer is allowed to write.
const OVERRIDE_KEY_RX = /^[^:]+::override:/
export function overrideEntries(results) {
  return (results || []).flatMap((r) => r?.indexEntries || []).filter((e) => e?.key && OVERRIDE_KEY_RX.test(e.key))
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

// A REPORTED TRIGGER'S VOCABULARY — the only `trigger` values a behaviour run may hand back, and the shape `from`
// must have for the three that name a declaration. WHY A CLOSED LIST: `INDEX_ENTRY` typed `trigger` as a bare
// string, so `{"init": {"trigger":"internal","from":"init"}}` was accepted verbatim, rendered as
// `internal (from init) — reported` and cleared the row out of the plan header's "no trigger yet" count. A row
// pointing at ITSELF as its own origin answers nothing; the header went from "8 row(s) have no trigger yet" to
// "0 … 8 answered by the behaviour run" on exactly that. Measured on the Applicants run.
export const REPORTED_TRIGGERS = ['attribute', 'detail', 'entity-filter', 'message', 'lifecycle', 'internal', 'external']

// The `from` shape the three DECLARATION-backed kinds require: `attributes.<name>` / `details.<key>` and any
// deeper path under them. A kind that claims a declaration must name one that can be looked up in the schema.
const DECLARATION_PATH_RX = /^(attributes|details)\.[A-Za-z0-9_$]+(\.[A-Za-z0-9_$]+)*$/
const DECLARATION_KINDS = new Set(['attribute', 'detail', 'entity-filter'])

// Returns `null` when the reported trigger is usable, otherwise the REASON, as one short string. The reason text
// is part of the contract: the engine carries its own mirrored copy of this function (`validateReportedTrigger`
// in engine/migrate.mjs, beside `describedInOf`), and run-workflow-core.mjs checks the two on BOTH axes — a
// table-driven parity test comparing the returned reason strings row by row, and a NORMALISED SOURCE-TEXT
// comparison of the two function bodies (quote style, semicolons, line comments and whitespace normalised away,
// everything else required to match). The table alone left a branch no row reached free to diverge; the text
// comparison is what makes "byte-for-byte apart from house style" a checked claim rather than a promise. So the
// two rejections cannot diverge into "the workflow dropped it, the engine filled it".
// EDIT ONE, LOOK AT THE OTHER — the workflow script is evaluated as a function body and may not `import`, which
// is why there are two copies at all (same reason `wiringOnlyMixinKeys` and `wiringOnlyKeys` are separate).
export function validateReportedTrigger({ trigger, from, methodName } = {}) {
  const declaredFrom = typeof from === 'string' ? from.trim() : ''
  if (trigger === null || trigger === undefined || trigger === '') {
    // A `from` WITHOUT a `trigger` is not "no trigger reported" — it is half an answer, and the half that is
    // missing is the only part the engine renders as a kind. The engine's `applyBehaviourIndex` recorded
    // `{kind:"reported", reportedKind:null}` for it and the row counted as RESOLVED, so an entry naming an origin
    // and never saying what kind of origin it is cleared the plan header's "no trigger yet" count on nothing.
    if (!declaredFrom) return null   // neither half reported: nothing to validate
    return `\`from\` names '${declaredFrom}' but no \`trigger\` says what kind of origin that is — half an answer resolves nothing`
  }
  if (typeof trigger !== 'string' || !REPORTED_TRIGGERS.includes(trigger)) {
    return `trigger '${String(trigger)}' is not one of ${REPORTED_TRIGGERS.join(', ')}`
  }
  const origin = declaredFrom
  if (!origin) return `trigger '${trigger}' names no \`from\` — a reported trigger without its origin answers nothing`
  if (methodName && origin === methodName) return `\`from\` is the row itself ('${origin}') — a row cannot be its own origin`
  if (DECLARATION_KINDS.has(trigger) && !DECLARATION_PATH_RX.test(origin)) {
    return `trigger '${trigger}' must name a declaration as \`attributes.<name>\` or \`details.<key>\`, not '${origin}'`
  }
  return null
}

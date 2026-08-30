// _workflow-core/build-executor/gate.mjs — the deterministic "spend nothing you don't have to" decisions.
//
// PURE functions over the engine's own numbers and the strings the run already holds. No I/O, no agent,
// no run closure — every input is a parameter, so the whole file is unit-testable without a stand or an
// AI runtime, exactly like the pure decision helpers in `helpers.mjs`.
//
// WHY A SEPARATE FILE. `helpers.mjs` already owns the round budget (`parkedKeys`, `DEFAULT_MAX_ROUNDS`),
// the in-context self-check park (`inContextParkableKeys`), the fetch-plan scoping (`verifyFetchPlan`) and
// the package/approval/surface gates. What it does NOT answer are the three decisions that turned one
// Applicant section into 42 agents across 6 runs (ENG-94859):
//   1. Is a blocker the BUILDER'S to fix (retry) or the SOURCE'S (park once, never re-attempt)?
//   2. Is the requested verification surface REACHABLE, or must it downgrade so the unit can still close?
//   3. Has the stand CHANGED since the last verdict, or may this run REUSE it instead of re-Reconciling?
// Each is a question the current run answers by spawning another agent or by looping a whole round.
//
// The measured failure this file closes: the Applicant `list` unit carried the SAME blocker in every one
// of the six runs — "Live render check on surface automatic:3 could not be performed … `#Section/Applicant`
// errors at runtime with Script error" — and was re-attempted each time, because a `blocked` item is not a
// `park` and nothing told the run that a runtime error in the CLASSIC source cannot be built out of.

// ---------------------------------------------------------------------------
// 1. SOURCE-CAUSED vs BUILDER-CAUSED BLOCKER
// ---------------------------------------------------------------------------
// A blocker the builder INTRODUCED (a schema it just wrote is wrong, a component it placed is absent) is
// worth a retry — the next build round can fix it. A blocker in the SOURCE the migration reads FROM — the
// Classic page throws at runtime, a dependency is not installed, the render surface cannot load the
// original page at all — CANNOT be fixed by rebuilding the Freedom page, so retrying it spends a whole
// round (Reconcile + Build + Verify + Judge) to re-learn a dead end.
//
// The classification reads ONLY the blocker's own `what`/`why` text — never a new stand read. It is
// deliberately CONSERVATIVE: a blocker is `source` ONLY when its text matches a known source-failure SHAPE
// (a runtime error in the original, a render that could not be performed, a missing dependency). Everything
// else is `unknown`, and the caller treats `unknown` as retryable — the safe default, because a
// wrongly-parked builder bug is a silently-dropped deliverable, while a wrongly-retried source bug costs at
// most the rounds the budget already caps.
//
// WHY NOT "present at baseline ⇒ source". An earlier draft also classified any blocker carried in from the
// queue file (present before this run built) as source. That is WRONG across runs: a resumed run legitimately
// RE-ATTEMPTS a builder blocker the previous run's builder left behind — a fresh builder may well add the
// field the last one missed — so a queue-carried builder blocker must stay retryable, not park. Only the
// failure SHAPE in the text decides; baseline presence changes nothing.
const SOURCE_PATTERNS = [
  /errors?\s+at\s+runtime/i,
  /script\s+error/i,
  /could\s+not\s+be\s+performed/i,
  /render\s+check\b[^.]*\b(could\s+not|cannot|failed)/i,
  /dependency\b[^.]*\b(missing|not\s+installed|absent)/i,
  /does\s+not\s+(compile|load)/i,
  /fails?\s+to\s+(compile|load|render)/i,
]

// The key a blocker names, whichever field carries it (the round loop uses `unit`, some records use `key`).
export function blockerKey(b) {
  return (b && (b.unit ?? b.key)) || null
}

// One blocker → { class, reason }. `class` is 'source' | 'unknown' (a non-source blocker is retryable, so it
// needs no separate 'builder' label to act on — the caller retries everything that is not 'source').
export function classifyBlocker(blocker) {
  const text = `${blocker?.what || ''} ${blocker?.why || ''}`.trim()
  if (text && SOURCE_PATTERNS.some((re) => re.test(text))) {
    return { class: 'source', reason: 'blocker text matches a source-failure shape (runtime/render/dependency failure a rebuild cannot change)' }
  }
  if (!text) return { class: 'unknown', reason: 'blocker carries no `what`/`why` text to classify on' }
  return { class: 'unknown', reason: 'no source-failure signal — treated as retryable (the safe default)' }
}

// The blockers that should PARK NOW instead of being re-attempted next round/run — the source-caused ones.
// Returns park RECORDS shaped like the run's other parks ({ key, kind, rounds, parkedWhy, shortRows }), so
// the round loop can push them straight onto `parked` with no reshaping. `rounds: 0` records the truth: the
// unit was never given a build round, because a build round could not have helped.
export function sourceBlockerParks(blocked) {
  const out = []
  for (const b of blocked || []) {
    const key = blockerKey(b)
    if (!key) continue
    const { class: cls, reason } = classifyBlocker(b)
    if (cls !== 'source') continue
    out.push({
      key,
      kind: 'page',
      rounds: 0,
      parkedWhy: sourceParkWhy(b, reason),
      shortRows: [],
    })
  }
  return out
}

// WHY a source blocker parked — names the source failure and states plainly that rebuilding cannot fix it,
// so an operator reading the parked list sees a diagnosis, not just "gave up". Never blank.
export function sourceParkWhy(blocker, reason) {
  const what = String(blocker?.what || '').trim()
  const why = String(blocker?.why || '').trim()
  const detail = [what, why].filter(Boolean).join(' — ')
  const head = 'parked without a build attempt: the blocker is in the SOURCE this migration reads from, not in the built page, so no build round can close it'
  return detail ? `${head}. ${detail}` : `${head} (${reason})`
}

// ---------------------------------------------------------------------------
// 2. VERIFICATION-SURFACE DOWNGRADE
// ---------------------------------------------------------------------------
// The migration skill resolves ONE verification surface for the section before the first write
// (`buildVerificationSurface` in helpers.mjs): `automatic:3` (real Chrome render), `automatic:2` (headless
// Playwright), or `manual` (`--verify` structure only). When the requested surface's RENDER cannot be
// performed for a unit — because the ORIGINAL page it must render throws at runtime — the unit would stay
// `unverified` forever and the gate would never go green, manufacturing repair rounds against an impossible
// check. This downgrades to the next surface that CAN answer, so the unit closes on what IS checkable
// (structure via `--verify`) and the run RECORDS that the render tier was not reached — it never silently
// claims a render it could not do.
const SURFACE_ORDER = ['automatic:3', 'automatic:2', 'manual']

// `renderReachable` is the deterministic fact from actually trying to load the page (a browser load that
// threw, a Playwright launch that could not open it). `null`/undefined means "not attempted" → no change.
export function downgradeSurface(requested, { renderReachable } = {}) {
  if (renderReachable !== false) return { surface: requested, downgraded: false, note: null }
  const idx = SURFACE_ORDER.indexOf(requested)
  // A requested surface that is already the lowest (`manual`), or one this table does not know, cannot
  // downgrade further — structure is all there is, and that is not a failure, it is the floor.
  if (idx < 0 || idx >= SURFACE_ORDER.length - 1) {
    return { surface: 'manual', downgraded: requested !== 'manual', note: requested !== 'manual' ? `render unreachable and no automatic surface below ${requested}; verified on structure (\`--verify\`) alone` : null }
  }
  const next = SURFACE_ORDER[idx + 1]
  return {
    surface: next,
    downgraded: true,
    note: `render on ${requested} could not be performed (the source page does not load); downgraded to ${next} — structure verified, render tier not reached`,
  }
}

// ---------------------------------------------------------------------------
// 3. REUSE THE LAST VERDICT INSTEAD OF RE-RECONCILING
// ---------------------------------------------------------------------------
// A fresh run's FIRST agent is the baseline Reconcile — `--units` + a get-page sweep + `--verify`. When
// nothing on the stand has changed since the LAST run persisted its verdict, that whole agent re-learns a
// state already on file. The fingerprint is the two facts that decide whether the persisted verdict still
// describes the stand: the engine's `planVersion` (a hash over the manifest — a changed plan ⇒ a new
// string) and the `standWrites` record (every create/update this migration made — a build round bumps it).
// Equal fingerprints ⇒ neither the plan nor the stand moved ⇒ the persisted verdict may be reused and the
// baseline Reconcile SKIPPED. This never trades away correctness: a stand changed by ANOTHER actor without
// a `standWrites` bump is the one case it cannot see, so the reuse is gated to the FIRST baseline only and
// any build round still re-verifies on the stand as it is.
export function standFingerprint({ planVersion = null, standWrites = null } = {}) {
  return stableStringify({ planVersion: planVersion ?? null, standWrites: standWrites ?? null })
}

// Reuse iff we HAVE a persisted verdict and both fingerprints exist and match. A missing persisted verdict,
// a missing fingerprint on either side, or any difference ⇒ do not reuse (run the baseline Reconcile).
export function canReuseReconcile({ persistedVerdict, prevFingerprint, curFingerprint } = {}) {
  if (!persistedVerdict) return false
  if (!prevFingerprint || !curFingerprint) return false
  return prevFingerprint === curFingerprint
}

// ---------------------------------------------------------------------------
// 4. STALL GUARD — did the last round actually move anything?
// ---------------------------------------------------------------------------
// A round that closed nothing — the same count of open deliverables before and after — has shown the loop
// is not converging on this unit. `parkedKeys` already caps total rounds; this is the earlier, cheaper
// signal: two consecutive zero-progress rounds means the next round will spend the full scaffold to reach
// the same place. Returns true when progress was made (open count strictly dropped). Pure over two counts,
// so the caller decides what to do with a stall (park, or stop and report).
export function progressed(prevOpen, curOpen) {
  if (!Number.isFinite(prevOpen) || !Number.isFinite(curOpen)) return true // unknown ⇒ do not accuse a stall
  return curOpen < prevOpen
}

// Total open deliverables across a verify verdict — the number the stall guard watches. Sums each page's
// `missing` + `unverified`; a verdict with none is zero (complete).
export function openDeliverableCount(verify) {
  const pages = verify?.pages || {}
  let n = 0
  for (const key of Object.keys(pages)) {
    const p = pages[key] || {}
    if (Number.isFinite(p.missing)) n += p.missing
    if (Number.isFinite(p.unverified)) n += p.unverified
  }
  return n
}

// ---------------------------------------------------------------------------
// Stable JSON — key order must not change the fingerprint (an object's keys can be enumerated in any order
// across the two runs being compared). Recurses through plain objects and arrays; primitives pass through.
// ---------------------------------------------------------------------------
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

// _workflow-core/build-executor/gate.mjs — deterministic "spend nothing you don't have to" decisions.
//
// PURE functions over the strings the run already holds. No I/O, no agent, no run closure — every input is a
// parameter, so the whole file is unit-testable without a stand or an AI runtime, exactly like the pure
// decision helpers in `helpers.mjs`.
//
// SCOPE. This file owns ONE decision `helpers.mjs` does not: is a blocker the BUILDER'S to fix (retry) or
// the SOURCE'S (park once, never re-attempt)? That is the decision behind the measured Applicant failure
// (ENG-94859): the `list` unit carried the SAME blocker in every one of six runs — "Live render check on
// surface automatic:3 could not be performed … `#Section/Applicant` errors at runtime with Script error" —
// and was re-attempted each time, because a `blocked` item is not a `park` and nothing told the run that a
// runtime error in the CLASSIC source cannot be built out of.
//
// Two decisions that were prototyped here and then deliberately NOT shipped, recorded so the next reader does
// not re-derive them from scratch:
//   · VERIFICATION-SURFACE DOWNGRADE belongs in the migration skill's pre-write surface preflight (ENG-95855),
//     which is the layer that RESOLVES the surface. The build-executor core has no render-reachability signal
//     of its own, so a downgrade wired here would key off an input nobody sets — dead code. Resolve the right
//     tier upstream instead.
//   · RECONCILE-REUSE (skip the baseline Reconcile when the stand is unchanged) cannot pay off in the Claude
//     Workflow sandbox: computing the fingerprint (plan version + stand writes) itself needs the agent that
//     reads `--units` and the queue file, so there is no cheaper pre-check to gate the skip on.

// ---------------------------------------------------------------------------
// SOURCE-CAUSED vs RETRYABLE BLOCKER
// ---------------------------------------------------------------------------
// A blocker the builder INTRODUCED (a schema it just wrote is wrong, a component it placed is absent) is
// worth a retry — the next build round can fix it. A blocker in the SOURCE the migration reads FROM — the
// Classic page throws at runtime, a dependency is not installed, the render surface cannot load the original
// at all — CANNOT be fixed by rebuilding the Freedom page, so retrying it spends a whole round (Reconcile +
// Build + Verify + Judge) to re-learn a dead end.
//
// Classification reads ONLY the blocker's own `what`/`why` text for a source-failure SHAPE — never a new
// stand read, and NEVER baseline presence: a resumed run legitimately RE-ATTEMPTS a builder blocker the
// previous run left behind (a fresh builder may add the field the last one missed), so a queue-carried
// builder blocker must stay retryable, not park. It is deliberately CONSERVATIVE — anything without a
// source-failure shape is `unknown`, and the caller retries `unknown`, because a wrongly-parked builder bug
// is a silently-dropped deliverable while a wrongly-retried source bug costs at most the rounds the budget
// already caps.
//
// SUBJECT, NOT ONLY MODE (PR #157 review, Major on `gate.mjs:46`). Two of the original patterns —
// `does not compile` and `fails to compile/load/render` — describe the BUILT artifact at least as naturally as
// the Classic source ("the schema I just wrote does not compile", "the page fails to render after the merge"),
// and `blockedItems` is a general-purpose channel that carries build-agent blockers, the partial-app-unit
// blocker, the guidelines close row, resolutions blockers and judge page defects. A misclassified builder
// defect parks TERMINALLY (`rounds: 0`), is re-parked on every resumed run, and tells the operator the blocker
// is in the source — a false diagnosis on the one class a build round would have fixed. So those two generic
// failure verbs now need a SOURCE SUBJECT in the same text; the patterns that already name the source surface
// (a runtime error, a `Script error`, a render check that could not be performed, a missing dependency) stand
// on their own, exactly as before.
const SOURCE_PATTERNS = [
  /errors?\s+at\s+runtime/i,
  /script\s+error/i,
  /could\s+not\s+be\s+performed/i,
  /render\s+check\b[^.]*\b(could\s+not|cannot|failed)/i,
  /dependency\b[^.]*\b(missing|not\s+installed|absent)/i,
]

// The generic failure verbs. On their own they say nothing about WHICH artifact failed, so each one is paired
// with a subject test below and never matched alone.
const FAILURE_MODE_PATTERNS = [
  /does\s+not\s+(compile|load)/i,
  /fails?\s+to\s+(compile|load|render)/i,
]

// A SOURCE SUBJECT — the text names the Classic/source side rather than the page this run is building.
// `#Section/<Name>` is the render-surface identifier the migration skill publishes for a Classic surface, and
// the four words are the ones the run's own prompts use for it. Deliberately NOT `schema`: "the schema I just
// wrote" is the builder's own artifact, so `schema` would re-admit the very case this split exists to exclude.
const SOURCE_SUBJECT = /(\bclassic\b|\bsource\b|\boriginal\b|\blegacy\b|#Section\/)/i

// The key a blocker names, whichever field carries it (the round loop uses `unit`, some records use `key`).
export function blockerKey(b) {
  return (b && (b.unit ?? b.key)) || null
}

// One blocker → { class, reason }. `class` is 'source' | 'unknown' (a non-source blocker is retryable, so it
// needs no separate 'builder' label to act on — the caller retries everything that is not 'source').
export function classifyBlocker(blocker) {
  const text = `${blocker?.what || ''} ${blocker?.why || ''}`.trim()
  if (!text) return { class: 'unknown', reason: 'blocker carries no `what`/`why` text to classify on' }
  if (SOURCE_PATTERNS.some((re) => re.test(text))) {
    return { class: 'source', reason: 'blocker text matches a source-failure shape (runtime/render/dependency failure a rebuild cannot change)' }
  }
  // A generic failure verb counts ONLY when the same text also names the source side. Without that subject the
  // sentence describes the built page just as well, and the safe reading of an ambiguous blocker is `unknown`.
  if (FAILURE_MODE_PATTERNS.some((re) => re.test(text))) {
    if (SOURCE_SUBJECT.test(text)) {
      return { class: 'source', reason: 'blocker text names the Classic/source side failing to compile, load or render — a rebuild of the Freedom page cannot change it' }
    }
    return { class: 'unknown', reason: 'a compile/load/render failure whose SUBJECT is not named as the Classic source — it describes the built page just as well, so it stays retryable' }
  }
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

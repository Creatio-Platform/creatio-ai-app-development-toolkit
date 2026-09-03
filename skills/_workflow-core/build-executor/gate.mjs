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

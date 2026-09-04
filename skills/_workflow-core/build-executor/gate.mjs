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
// Build + Verify + Judge) to re-learn a dead end. Which of the two a text describes is decided by its SUBJECT,
// not by its failure verb — see "SUBJECT, NOT ONLY MODE" below for the full rule and for why only two patterns
// are read as source on their own.
//
// Classification reads the blocker's own `what`/`why` text for a source-failure SHAPE, plus — as a PARAMETER, not
// as a lookup — the `#Section/...` route(s) the run recorded for the section it built (see "THE RUN'S OWN ROUTE IS
// NOT A SOURCE SUBJECT" below). Never a new stand read, and NEVER baseline presence: a resumed run legitimately RE-ATTEMPTS a builder blocker the
// previous run left behind (a fresh builder may add the field the last one missed), so a queue-carried
// builder blocker must stay retryable, not park. It is deliberately CONSERVATIVE — anything without a
// source-failure shape is `unknown`, and the caller retries `unknown`, because a wrongly-parked builder bug
// is a silently-dropped deliverable while a wrongly-retried source bug costs at most the rounds the budget
// already caps.
//
// SUBJECT, NOT ONLY MODE (PR #157 review, Major on `gate.mjs:46`, extended by the follow-up review). A blocker's
// text reaches this classifier through `blockedItems`, which is a GENERAL-PURPOSE channel: build-agent blockers, the
// partial-app-unit blocker, the guidelines close row, resolutions blockers and judge page defects all land in it. A
// misclassified builder defect parks TERMINALLY (`rounds: 0`), is re-parked on every resumed run, and tells the
// operator the blocker is in the source — a false diagnosis on the one class a build round would have fixed.
//
// So a failure MODE alone is not a source verdict. Five patterns describe a failure without saying WHOSE artifact
// failed, and each of the five is at least as natural about the page THIS run just built:
//   · `does not compile` / `fails to compile|load|render` — "the schema I just wrote does not compile";
//   · `errors at runtime` — "the page errors at runtime", where "the page" is the BUILT page;
//   · `could not be performed` / `render check … could not be…` — and this one is the sharpest: the per-page recipe
//     and `reachKindBlock` both tell the build agent to report an unreachable VERIFICATION SURFACE in `blocked`
//     (`what` naming the surface as unachievable), and "the render check could not be performed" is the free-text
//     form an agent actually writes for it. That is a blocker about the run's OWN check of its OWN page — parking it
//     terminally with "the blocker is in the SOURCE" is a wrong diagnosis on a unit a re-check would have closed.
// All five therefore now require a SOURCE SUBJECT in the same text.
//
// WHAT STILL STANDS ALONE is only what names the source side by itself, and there are two such patterns.
//   · `Script error for "<Name>"` — the CLASSIC runtime's own wording, which quotes the schema it failed inside.
//     Deliberately NOT a bare `Script error`: `references/03-failure-and-park-policy.md` (ENG-96147) calls that
//     text "ambiguous by construction", because a URL composed for the BUILT section — a `#Section/<code>` guess
//     missing the real `_ListPage` suffix — produces exactly it, and one real run reported a working page as
//     broken on that basis. The measured Applicant blocker carries the quoted form, so this narrowing costs the
//     ENG-94859 case nothing.
//   · an uninstalled dependency — a package the migration reads FROM being absent, which no rebuild installs.
//
// THE RUN'S OWN ROUTE IS NOT A SOURCE SUBJECT (ENG-96147, PR #157 follow-up). `#Section/` is read as a source
// subject because it is the render-surface identifier the migration publishes for a CLASSIC surface — but the run
// also composes exactly that prefix for the section IT BUILT, from the schema name a `sectionRegistered` reach unit
// reported, and records the result in `standWrites.sectionRoute.route`. A blocker quoting that string is a report
// about the built page, so classifying it `source` would park the builder's own defect terminally under the
// diagnosis "the blocker is in the SOURCE" — the exact wrong verdict this whole split exists to prevent. So the
// `#Section/` subject match is now conditional: a reference the run RECORDED AS ITS OWN does not satisfy it, and a
// failure-mode entry whose only subject is that reference falls through to `unknown` (retried), never to `source`.
// The routes are a PARAMETER (`ownRoutes`), so the function stays pure and the caller passes what the state file
// holds — no route argument at all keeps the pre-existing behaviour, which is what every non-route call site wants.
//
// EXACT MATCH ONLY, and that limit is deliberate. Only a reference EQUAL to a recorded route is exempted, compared
// on the code after the `#Section/` prefix, case-insensitively. A `#Section/<guess>` that merely resembles the
// record — the literal ST_2 incident, where an agent composed `#Section/UsrApplicants` for a page that actually
// opens at `#Section/UsrApplicants_ListPage` — still reads as a source subject, because no prefix or fuzzy rule can
// tell that guess apart from a genuine Classic identifier: a Classic surface is routinely a PREFIX of the Freedom
// route built from it (`#Section/Applicant` vs `#Section/UsrApplicant_ListPage`), so a prefix rule would swallow the
// measured ENG-94859 blocker itself. And a text naming a DIFFERENT `#Section/<code>` alongside the run's own still
// classifies `source` on the other reference — the exemption is per reference, not per text.
//
// This keeps the header's CONSERVATIVE promise true rather than weakening it: fewer texts park, and everything else
// stays retryable. The cost the split must not reintroduce is the ENG-94859 one — a GENUINE source blocker must
// still park — and it does, because the measured blocker quotes both `#Section/Applicant` and
// `Script error for "Applicant..."` in its own text, as does every realistic Classic-source phrasing the goldens
// pin.
const SOURCE_PATTERNS = [
  /script\s+error\s+for\s+["'`]/i,
  /dependency\b[^.]*\b(missing|not\s+installed|absent)/i,
]

// The failure MODES. On their own they say nothing about WHICH artifact failed — the Classic source or the page this
// run just built — so each is paired with the subject test below and never matched alone.
const FAILURE_MODE_PATTERNS = [
  /does\s+not\s+(compile|load)/i,
  /fails?\s+to\s+(compile|load|render)/i,
  /errors?\s+at\s+runtime/i,
  /could\s+not\s+be\s+performed/i,
  /render\s+check\b[^.]*\b(could\s+not|cannot|failed)/i,
]

// A SOURCE SUBJECT, in two halves. The WORDS stand on their own: they are the ones the run's own prompts use for
// the side being migrated FROM. Deliberately NOT `schema` and NOT `page`: "the schema I just wrote" and "the page
// errors at runtime" are the builder's own artifact, so either word would re-admit the very case this split exists
// to exclude.
const SOURCE_SUBJECT_WORDS = /(\bclassic\b|\bsource\b|\boriginal\b|\blegacy\b)/i
// The RENDER-SURFACE REFERENCE is the conditional half — see "THE RUN'S OWN ROUTE IS NOT A SOURCE SUBJECT" above.
// Every `#Section/<code>` in the text is extracted and tested against the routes the run recorded for the section it
// built; a reference that is not one of those names the source side, a reference that is one of those does not. The
// character class is negated rather than greedy so the code stops at the delimiter an agent actually writes around
// it (a backtick, a quote, a bracket, a comma, a semicolon, a trailing colon, a query mark, whitespace) and so the
// match cannot backtrack. The colon matters in practice: "opening #Section/Usr..._ListPage: errors at runtime" is
// ordinary agent phrasing, and folding the colon into the code would make the run's own route stop matching itself.
const SECTION_REF = /#Section\/([^\s`'"()[\],;:?]+)/gi
// The NON-GLOBAL twin of `SECTION_REF` — the same pattern, so it is true exactly when a reference was extractable,
// which is what the reason string it guards claims. A bare `#Section/` with nothing after it (the "no published
// route was available" report `03-failure-and-park-policy.md` asks agents to write) yields no reference and must not
// be described as one the run recorded. Non-global on purpose: a `/g` regex carries `lastIndex` between `.test()`
// calls, which would make the answer depend on call order.
const SECTION_REF_PRESENT = /#Section\/[^\s`'"()[\],;:?]+/i

// The `#Section/<code>` codes the run recorded as ITS OWN, normalised for comparison: the `#Section/` prefix
// stripped (callers hold whole routes, e.g. `standWrites.sectionRoute.route`), lower-cased, blanks dropped. Accepts
// route strings or the `{ route, schemaName }` records the state file stores, and a single value as well as a list,
// so no caller has to reshape its state before asking.
// One entry → the route string it carries. Its own function rather than an inline conditional chain: the two
// accepted shapes are a plain route string and the `{ route, schemaName }` record the state file stores.
function routeStringOf(entry) {
  if (typeof entry === 'string') return entry
  if (typeof entry?.route === 'string') return entry.route
  return ''
}

function ownRouteCodes(ownRoutes) {
  const codes = new Set()
  for (const entry of Array.isArray(ownRoutes) ? ownRoutes : [ownRoutes]) {
    const code = routeStringOf(entry).trim().replace(/^#Section\//i, '').trim().toLowerCase()
    if (code) codes.add(code)
  }
  return codes
}

// Does this text name the Classic/SOURCE side? A subject word does it outright; otherwise it takes one
// `#Section/<code>` reference that is NOT among the run's own recorded routes. Per reference, not per text: a
// genuine Classic surface quoted next to the run's own route still answers `true`.
function namesSourceSubject(text, ownRoutes) {
  if (SOURCE_SUBJECT_WORDS.test(text)) return true
  const own = ownRouteCodes(ownRoutes)
  for (const m of text.matchAll(SECTION_REF)) {
    if (!own.has(m[1].toLowerCase())) return true
  }
  return false
}

// The key a blocker names, whichever field carries it (the round loop uses `unit`, some records use `key`).
export function blockerKey(b) {
  return (b && (b.unit ?? b.key)) || null
}

// One blocker → { class, reason }. `class` is 'source' | 'unknown' (a non-source blocker is retryable, so it
// needs no separate 'builder' label to act on — the caller retries everything that is not 'source').
// `ownRoutes` — the `#Section/...` route(s) the run recorded for the section IT BUILT (route strings or
// `{ route }` records, one or many). Passing none keeps the classifier's pre-route behaviour exactly.
export function classifyBlocker(blocker, ownRoutes = []) {
  const text = `${blocker?.what || ''} ${blocker?.why || ''}`.trim()
  if (!text) return { class: 'unknown', reason: 'blocker carries no `what`/`why` text to classify on' }
  if (SOURCE_PATTERNS.some((re) => re.test(text))) {
    return { class: 'source', reason: 'blocker text names the source side on its own — the Classic runtime\'s own `Script error for "<schema>"`, or a dependency the migration reads from that is not installed; neither changes when the Freedom page is rebuilt' }
  }
  // A failure MODE counts ONLY when the same text also names the source side. Without that subject the sentence
  // describes the built page (or this run's own render check of it) just as well, and the safe reading of an
  // ambiguous blocker is `unknown`.
  if (FAILURE_MODE_PATTERNS.some((re) => re.test(text))) {
    if (namesSourceSubject(text, ownRoutes)) {
      return { class: 'source', reason: 'blocker text names the Classic/source side failing to compile, load, render or run — a rebuild of the Freedom page cannot change it' }
    }
    // Separate verdict, separate sentence: the operator reading a retried unit should see WHICH ambiguity kept it
    // retryable. This one is not an unnamed subject — the subject is named and it is the run's OWN section.
    if (SECTION_REF_PRESENT.test(text)) {
      return { class: 'unknown', reason: 'a compile/load/render/runtime failure whose only source-looking subject is a `#Section/` route THIS RUN recorded for the section it built — that is a report about the built page, so it stays retryable (ENG-96147)' }
    }
    return { class: 'unknown', reason: 'a compile/load/render/runtime failure whose SUBJECT is not named as the Classic source — it describes the page this run built, or this run\'s own check of it, just as well, so it stays retryable' }
  }
  return { class: 'unknown', reason: 'no source-failure signal — treated as retryable (the safe default)' }
}

// The blockers that should PARK NOW instead of being re-attempted next round/run — the source-caused ones.
// Returns park RECORDS shaped like the run's other parks ({ key, kind, rounds, parkedWhy, shortRows }), so
// the round loop can push them straight onto `parked` with no reshaping. `rounds: 0` records the truth: the
// unit was never given a build round, because a build round could not have helped.
// `ownRoutes` is passed straight through to `classifyBlocker` — see its comment.
export function sourceBlockerParks(blocked, ownRoutes = []) {
  const out = []
  for (const b of blocked || []) {
    const key = blockerKey(b)
    if (!key) continue
    const { class: cls, reason } = classifyBlocker(b, ownRoutes)
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

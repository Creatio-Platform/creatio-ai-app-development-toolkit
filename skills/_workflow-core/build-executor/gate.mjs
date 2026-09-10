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

// A SOURCE SUBJECT. PR #157 review (round 2, Blocker on gate.mjs:114) — THE WORDS HAD TO QUALIFY AN ARTEFACT.
// `\bsource\b` standing on its own is not a subject test at all: "data source" is core Freedom-page vocabulary and
// this run's OWN prompts use it verbatim three times ("the data source named by `primaryDataSourceName`"), so an
// everyday builder blocker —
//     the page fails to render — its primary data source is not bound
// — matched `fails to render` here and `source` there, and `sourceBlockerParks` emitted a TERMINAL park with
// `rounds: 0` and the diagnosis "the blocker is in the SOURCE this migration reads from". The queue file carries the
// park, so it was re-parked on every resumed run: a silently dropped deliverable plus a false diagnosis, on the one
// class of blocker a build round would have fixed. This module's own header names that as the worst outcome it has.
//
// So: `classic` still stands alone — nothing in a Freedom page is called that — while the three GENERIC words must
// qualify a source NOUN. `data source` / `dataSource` is excised from the text before the test as well, belt and
// braces: the noun requirement already refuses it, and an explicit exclusion is what stops a future noun being
// added to the list and quietly re-admitting it.
// Deliberately NOT `page` or `schema` as bare words: "the schema I just wrote" and "the page errors at runtime" are
// the builder's own artefact, so either would re-admit the very case this split exists to exclude — they are
// admitted only after `source` / `original` / `legacy`.
// TWO STRENGTHS OF WORD, because they do not deserve the same standing against the reference evidence below.
// `classic` is UNAMBIGUOUS: nothing in a Freedom page is called that, so a text using it is talking about the side
// being migrated from even when the only route it quotes is the run's own (ENG-96147 pins exactly that — "the
// Classic original at `#Section/<own route>` fails to render" is a source blocker).
const CLASSIC_WORD = /\bclassic\b/i
// The GENERIC words are ambiguous, which is the whole finding, so they must qualify a source NOUN — and they lose
// to the reference evidence. `source` on its own was the defect: "data source" is core Freedom vocabulary.
const SOURCE_NOUN_PHRASE = /\b(?:source|original|legacy)\s+(?:page|schema|section|module|form|surface|record)\b/i
// Freedom's own "data source" vocabulary, removed before either word test rather than special-cased inside them.
const DATA_SOURCE_RX = /\bdata\s+source\b|\bdataSource\b/gi
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

// Does this text name the Classic/SOURCE side?
//
// PR #157 review (round 2) — THE REFERENCE EVIDENCE IS READ BEFORE THE GENERIC WORDS, and that ordering is the fix.
// The word test used to run before the `ownRoutes` exemption, so the exemption `263d9711` added could never apply to
// a text containing a generic subject word — which is EVERY text that says "data source". A `#Section/` reference is
// POSITIVE evidence about which side is being described; a generic word is a weaker signal. So, in order:
//   1. `classic` decides outright. It outranks the exemption on purpose — see `CLASSIC_WORD`.
//   2. a reference that is NOT one the run recorded names the source side. Per reference, not per text: a genuine
//      Classic surface quoted next to the run's own route still answers `true`.
//   3. otherwise, if the text carries a reference at all, every one of them is the run's OWN route — the text is a
//      report about the page this run built, and it is NOT a source subject however it is phrased.
//   4. only a text with no reference at all falls through to the generic noun-phrase test.
// Step 3 is the case the third reviewer executed as the sharpest: "opening #Section/Usr..._ListPage errors at
// runtime / the data source is not bound" quotes the run's own recorded route and used to park terminally, because
// the word test at step 4 ran first and `source` matched.
function namesSourceSubject(text, ownRoutes) {
  const clean = text.replace(DATA_SOURCE_RX, ' ')
  if (CLASSIC_WORD.test(clean)) return true
  const own = ownRouteCodes(ownRoutes)
  let sawRef = false
  for (const m of text.matchAll(SECTION_REF)) {
    sawRef = true
    if (!own.has(m[1].toLowerCase())) return true
  }
  if (sawRef) return false
  return SOURCE_NOUN_PHRASE.test(clean)
}

// The key a blocker names, whichever field carries it (the round loop uses `unit`, some records use `key`).
export function blockerKey(b) {
  return (b && (b.unit ?? b.key)) || null
}

// One blocker → { class, reason }. `class` is 'source' | 'environment' | 'unknown' (a non-source, non-environment
// blocker is retryable, so it needs no separate 'builder' label to act on — the caller retries everything that is
// neither 'source' nor 'environment'; 'environment' halts the round, see the ENVIRONMENT FAULT section).
// `ownRoutes` — the `#Section/...` route(s) the run recorded for the section IT BUILT (route strings or
// `{ route }` records, one or many). Passing none keeps the classifier's pre-route behaviour exactly.
// THE PRODUCER'S OWN ANSWER. PR #157 review (round 2) — the root issue is upstream of every regex above: the most
// consequential unit-level verdict this run makes (park terminally, never attempt a build round) was re-derived
// downstream from free prose, while `schemas.mjs` already declares the producer-side channel for it. Within one
// review cycle five failure-mode patterns had to be demoted to require a co-occurring subject, `Script error` had to
// be narrowed to its quoted form, `263d9711` added the `ownRoutes` exemption and this round re-ordered it — each a
// repair to a false SOURCE positive. So the agent that HIT the blocker is asked which artefact failed, and its
// answer is preferred; the patterns become the legacy fallback for a blocker that does not carry one.
// OPTIONAL, exactly like `verifierOnly` / `emitted`, and it costs no schema bytes: the `blocked` items are already
// a loose `additionalProperties: { maxLength: RECONCILE_TEXT_CAP }` object on both the build-answer schema and
// `RECONCILE_SHAPE`, so `RECONCILE_SCHEMA` stays at its size (it has ~35 bytes of headroom under the 4096-byte
// serialized-schema ceiling, and ENG-95468 already had to trim it once to fit).
// A value outside the declared words is IGNORED rather than read as a further state — the same rule the prose test
// keeps: what is not positively source stays retryable. `subject: 'builder'` can never be parked as source, however
// the blocker is phrased, which closes both false-park holes this header admits to.
// ENG-96778 (PR #171 scope expansion) — `'environment'` is the THIRD word: the stand itself did not answer. See
// "ENVIRONMENT FAULT" below for what it does and why neither of the other two could express it.
const DECLARED_SUBJECTS = new Set(['source', 'builder', 'environment'])
function declaredSubject(blocker) {
  const v = typeof blocker?.subject === 'string' ? blocker.subject.trim().toLowerCase() : ''
  return DECLARED_SUBJECTS.has(v) ? v : null
}

// ---------------------------------------------------------------------------
// ENVIRONMENT FAULT — the stand itself did not answer (ENG-96778, PR #171 scope expansion)
// ---------------------------------------------------------------------------
// The third class, and the one neither of the other two can express. A measured run (migration `UsrAwesome`,
// session ce23724f) had its stand killed mid-Build: the app unit's builder returned a STRUCTURED blocker naming the
// outage, and because a structured answer is a valid answer every later unit — `list`, `main`, `reach` — was still
// dispatched, each spending 2–3 minutes rediscovering that the port refused connections, and Verify, Judge and the
// round-tail Reconcile all ran against a dead stand. Nothing in the core read a blocker's CONTENT before the round
// tail, and there the only classifier was this file's source-vs-builder split, under which "connection refused" is
// `unknown` → retryable → burns `MAX_ROUNDS`.
// So a blocker can now name the ENVIRONMENT as the failing party — declared through `subject: 'environment'`, or
// inferred from a deliberately tight, corpus-checked pattern set — and the core stops the round on the first one
// (`environmentFaultRow` below is what it reads). TWO TIERS, because they deserve different standing against a
// declared subject:
//   · Tier A — a stand-alone SOCKET / DNS token (`ECONNREFUSED`, "connection refused", "actively refusing",
//     `getaddrinfo`, "nodename nor servname"). Nothing an agent writes about a page produces these; they are the
//     transport's own words for "nobody is listening". Tier A OVERRIDES a declared `'source'` — a socket error
//     contradicts "the Classic artefact failed", and a wrong `'source'` is a TERMINAL park (the incident's `list`
//     row, declared `source`, would park terminally on the next run of that folder) — but NOT a declared
//     `'builder'`: `ECONNREFUSED 127.0.0.1:9222` is a builder's own headless-Chrome check failing, and the agent
//     that said so knows better than a regex.
//   · Tier B — a STAND NOUN next to a DOWN verb ("the stand went down", "Environment unreachable", "cannot reach the
//     instance"). Read only on rows with NO declared subject: the words are ordinary English, and an agent that
//     declared the artefact has already answered the question.
// DELIBERATELY EXCLUDED, each with a shipped counter-example: bare `unreachable` ("verification surface unreachable"
// is the run's own render check; "a section in no workplace is unreachable from the menu"; "built pages stay
// unreachable"), bare `timed out` ("get-page timed out after 120s" is a TRANSPORT fault the policy tells agents to
// switch transport on — `03-failure-and-park-policy.md`, `context.mjs`), bare `environment fault`, and the nouns
// `host`, `surface`, `section`, `page`, `menu`, `workplace`. "Environment version could not be probed" stays
// `unknown` too — a probe that could not run is not a stand that is down.
const ENVIRONMENT_SOCKET_PATTERNS = [
  /\bECONN(?:REFUSED|RESET|ABORTED)\b/,
  /\bE(?:TIMEDOUT|NOTFOUND|HOSTUNREACH|NETUNREACH|AI_AGAIN)\b/,
  /\bconnection\s+(?:was\s+|is\s+|being\s+)?refused\b/i,
  /\bactively\s+refus(?:ed|es|ing)\b/i,
  /\brefus(?:ed|es|ing)\s+(?:all\s+)?connections?\b/i,
  /\bgetaddrinfo\b/i,
  /\bnodename\s+nor\s+servname\b/i,
]
// The stand NOUN and the DOWN state as source strings, so the four phrasings below are built from ONE noun list — a
// noun added to one phrasing and forgotten in another is how a class like this drifts.
const STAND_NOUN = String.raw`(?:stand|environment|instance|site|server|application\s+server)`
const DOWN_STATE = String.raw`(?:down|unreachable|offline|not\s+reachable|not\s+responding)`
const ENVIRONMENT_STAND_PATTERNS = [
  // "the stand dev-local (port 40010) went down", "the environment is still not responding" — the noun, at most
  // four plain words later a state verb, then the down state. Bounded on purpose: a sentence that leaves the stand
  // and goes on about a page ("the stand is fine, but the page … is not responding") runs past the window.
  new RegExp(String.raw`\b${STAND_NOUN}\b(?:\s+[^\s.,;:]+){0,4}?\s+(?:is|was|went|remains?|stays?|still|now)\s+(?:still\s+|now\s+)?${DOWN_STATE}\b`, 'i'),
  // "Environment unreachable — dev-local", "stand down", "the instance is offline".
  new RegExp(String.raw`\b${STAND_NOUN}\s+(?:is\s+)?(?:unreachable|down|offline)\b`, 'i'),
  // "an unreachable environment", "the dead stand".
  new RegExp(String.raw`\b(?:unreachable|dead|offline)\s+${STAND_NOUN}\b`, 'i'),
  // "cannot connect to the stand", "cannot reach the dev-local instance".
  new RegExp(String.raw`\bcannot\s+(?:connect|reach)\b(?:\s+[^\s.,;:]+){0,4}?\s+${STAND_NOUN}\b`, 'i'),
  /\bcannot\s+connect\s+to\s+the\s+application\b/i,
]
// The environment verdict, or `null` when this blocker is not one — its own function so `classifyBlocker` stays
// under the complexity ceiling and the precedence rules above read in one place, in order:
//   declared `environment` → environment · declared `builder` → not this class · Tier A → environment (over a
//   declared `source` too) · any other declared subject → not this class · Tier B → environment · else `null`.
function environmentClass(text, declared) {
  if (declared === 'environment') {
    return { class: 'environment', reason: 'the agent that hit this blocker DECLARED the stand itself did not answer (`subject: "environment"`) — nobody\'s artefact failed, so the run stops the round and asks the operator to restore the stand before anything else is dispatched at it' }
  }
  if (declared === 'builder') return null
  if (ENVIRONMENT_SOCKET_PATTERNS.some((re) => re.test(text))) {
    return { class: 'environment', reason: declared === 'source'
      ? 'blocker text carries the transport\'s own socket/DNS error, which contradicts the declared `subject: "source"` — a stand that refuses connections is not a Classic artefact failing, and reading it as `source` would park the unit TERMINALLY on an outage'
      : 'blocker text carries the transport\'s own socket/DNS error (connection refused, ECONNREFUSED, getaddrinfo) — the stand itself did not answer, so no rebuild and no retry against it can help until it is restored' }
  }
  if (declared) return null
  if (ENVIRONMENT_STAND_PATTERNS.some((re) => re.test(text))) {
    return { class: 'environment', reason: 'blocker text says the stand/environment/instance itself is down or unreachable — an environment fault, not a page defect; the run stops the round and asks the operator to restore it' }
  }
  return null
}

// The FIRST blocker in a list that names the environment as the failing party, or `null`. This is the read the
// core makes at the two sites where an agent can actually declare a blocker — the fresh `res.blocked` of a build
// answer, and the Preflight `unresolved[]` fold — so the round halts on the first sighting instead of dispatching
// every remaining unit at a stand that is not there. Deliberately NOT run over the carried `blockedItems`: those
// rows are the folder's history, and the folder's memory of an outage is `roundState.environmentFault`, not a row.
export function environmentFaultRow(blocked, ownRoutes = []) {
  for (const b of blocked || []) {
    if (b && classifyBlocker(b, ownRoutes).class === 'environment') return b
  }
  return null
}

export function classifyBlocker(blocker, ownRoutes = []) {
  const text = `${blocker?.what || ''} ${blocker?.why || ''}`.trim()
  const declared = declaredSubject(blocker)
  const environment = environmentClass(text, declared)
  if (environment) return environment
  if (declared === 'builder') {
    return { class: 'unknown', reason: 'the agent that hit this blocker DECLARED the failing artefact is the page it just wrote (`subject: "builder"`), so it stays retryable — a declared subject outranks the prose patterns' }
  }
  if (declared === 'source') {
    return { class: 'source', reason: 'the agent that hit this blocker DECLARED the failing artefact is the Classic source this migration reads from (`subject: "source"`) — a rebuild of the Freedom page cannot change it' }
  }
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

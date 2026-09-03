// build-executor/schemas.mjs — the response contracts of the build run.
//
// ENG-95503 — the answers channel's design literals come from `helpers.mjs`: one declaration, read by the
// record-time cap AND by the bounds below. The generator drops this import (helpers is inlined ahead of this
// module); the module path, which Codex and the CLI use, needs it.
// ENG-95503 / PR #128 review -- THE THREE THINGS A VERIFIER CAN SAY ABOUT AN ANSWER'S EFFECT, as literals rather
// than a boolean plus a convention. `SHOWS_UNKNOWN` is the one this review added: "I read the page and it cannot
// tell me" is not "the builder lied", and collapsing the two made a FALSE contradiction the expected outcome for
// every answer whose effect is not in the page body. Literals because a live verifier echoes them back, so a copy
// re-typed in a test would pass while the run compared against something else.
// DECLARED ABOVE EVERY SCHEMA, deliberately: `VERIFIER_SCHEMA` builds its `shows` enum from these, and a `const`
// read before its own declaration is a temporal-dead-zone THROW at module load -- the same class of defect the
// prologue-execution tests exist for, and it takes the run out before its first agent.
export const SHOWS_YES = 'yes'
export const SHOWS_NO = 'no'
export const SHOWS_UNKNOWN = 'unknown'
// WHERE AN UNCONSUMED ENTRY CAME FROM. A dispatch-sourced row is the builder's own account of its own work and is
// replaced whenever that unit builds again; a verifier-sourced row is the INDEPENDENT read that disbelieves such an
// account, so a later dispatch must not be able to erase it. One literal, because the clear-scope and the tag have
// to match and two copies of that rule drift.
export const UNCONSUMED_FROM_VERIFIER = 'verifier'
// The other half of the same two-value vocabulary, as a literal rather than a string typed at each site
// (PR #128 review, round 9). The clear below keys on it EXACTLY, so a re-typed copy is a silent reclassification.
export const UNCONSUMED_FROM_DISPATCH = 'dispatch'

// A DESIGN LITERAL, declared here with `MAX_ROUNDS` and the `shows` vocabulary rather than beside
// `capCarryText` in the pure block: `RECONCILE_SCHEMA` below reads it for its `maxLength` bounds and is
// evaluated at module load, so a `const` in the block would be in its temporal dead zone. One literal,
// read by the record-time cap AND by the schema that rejects an oversized value a writer sends back.
export const CARRY_TEXT_CAP = 400
//
// Structured output everywhere a later phase or the core COMPUTES on the answer; prose only in fields a human
// reads. A host without structured output cannot run this workflow at all, which is why `structuredOutput` is a
// REQUIRED capability rather than a degradable one.

// THE INNER SHAPE OF THIS RUN'S FIRST ANSWER LIVES IN `RECONCILE_SHAPE`, at the BOTTOM OF THIS FILE — beside the
// schema it completes. `helpers.mjs` hosts only the checker that walks it (`reconcileShapeErrors`).
//
// SIZE: WHAT THESE KEYWORDS DO AND WHAT THEY CANNOT DO. Every array property below carries `maxItems`, and every
// array-of-object carries `additionalProperties: { maxLength }` so each string inside an item is bounded too
// (`maxLength` is defined only for strings, so the booleans and integers in those items are untouched). Both are
// HOST-enforced, before the answer is serialized, which is why they live here and not in the shape table.
//
// They REDUCE the mode-B class; they do not CLOSE it, and this comment previously overclaimed that they did.
// `maxItems` bounds the count and `maxLength` bounds one string, but nothing here bounds their PRODUCT: 400 items
// of 400-character strings is schema-valid and about half a megabyte, against a ~20 KB tool-input limit. No value
// of those two keywords both fits a real plan and fits the cap — 11 arrays inside 15 KB works out to roughly one
// item each. So there are two more layers, deliberately:
//   · `reconcileShapeErrors` checks the answer's TOTAL serialized size and names the largest fields (detection —
//     it cannot see an answer that was already truncated at the transport, only one approaching the cliff);
//   · the real close is keeping the bulk OFF the answer entirely, the way `verify` now carries counts and leaves
//     the rows in `verify-summary.json` — tracked separately, not done here.
// Note that size was never bounded on this schema before: the pre-shrink version had no `maxItems` and no
// `maxLength` at all, so the exposure predates the shrink; what the shrink removed was per-item TYPES, which
// `RECONCILE_SHAPE` now carries.
//
// THE HOST'S RULE: an agent whose serialized output schema exceeds 4096 bytes is refused before the model runs, in
// `auto`-permission sessions. Every schema in this file stays under that, and `RECONCILE_SCHEMA` under 3500 —
// it is the run's first agent, so its refusal costs the whole run.
//
// Nested objects are therefore declared as a bare `object` / `array of object`. Every property and the `required`
// list stay: the core computes on all of them. What the schema does not describe, `reconcileShapeErrors` checks
// when the answer arrives — the same fields, required lists and types. A fault spends an attempt and the retry is
// told which fields were short; a run whose last attempt is still short stops rather than computing on a hole.
//
// An agent reproduces the fields it is told about and drops the rest, so a field named in `RECONCILE_SHAPE` must
// also be named in `reconcilePrompt`; the two are one contract in two halves.

// The two size caps every loosened Reconcile property shares: one bound on any list's COUNT, one on any free
// string an array-of-object item carries. Named once so a future re-budgeting (they exist to keep the answer
// under the host's tool-input cap; ENG-96071 owns tightening them) is one edit, not twenty.
const RECONCILE_LIST_CAP = 400
const RECONCILE_TEXT_CAP = 400

export const RECONCILE_SCHEMA = {
  type: 'object',
  required: ['approval', 'planVersion', 'unitKeys', 'buildOrder', 'reachabilityState', 'verify', 'planGaps', 'roundOf',
    // Both package facts are REQUIRED. A schema-valid result that simply omitted `packageState` left it `undefined`,
    // which was neither 'unknown' (so nothing stopped) nor 'exists' (so an app unit was scheduled) — i.e. `create-app`
    // against what may be a live application, on a run that never established whether the package was there.
    // `evidenceIds` is REQUIRED for the same reason: the UI-guidelines close row keys off it, and a result that
    // omitted it left the row inert — the gate silently off on the run that needs it. `evidenceFiled` and
    // `evidenceRejected` are required because the close row's overwrite guard reads them: absent, it cannot tell
    // an unfiled id from an earned one, and it then fails closed on every honest `ran: false`.
    // `preflightItems` is REQUIRED (PR #128 review, N1): the two reconciles filter `unconsumed` against
    // `owedResolutionPairs(state.preflightItems, …)`, and the routing helper on an `undefined` list returns `[]`
    // rather than throwing — so an OMITTED list yields an empty owed set and silently ERASES every unconsumed
    // answer, which then reports `complete: true` over a lost answer. `resolutionsReopened`/`resolutionsPending`
    // are REQUIRED (N2) so a dropped repair-grant set cannot silently re-grant a spent round.
    // `unconsumedResolutions` is REQUIRED (round 17) — the one field whose omission is DESTRUCTIVE rather than
    // merely lossy, because its carry block is the one written EVEN WHEN EMPTY: an omitted key seeds `[]` and the
    // next close persists that `[]` OVER the stored rows.
    'targetPackage', 'packageState', 'evidenceIds', 'evidenceFiled', 'evidenceRejected',
    // The empty-prefix flag is REQUIRED so it can never be silently dropped: `{ schemaNamePrefix: null }` alone is
    // also the legal "could not read it" answer, so an answer missing the flag must be a refused answer (host- and
    // CLI-enforced), never an empty prefix quietly decoding as unreadable and switching the identity gate off.
    'schemaNamePrefixEmpty',
    'preflightItems', 'resolutionsReopened', 'resolutionsPending', 'unconsumedResolutions'],
  properties: {
    // The APPROVAL PRECONDITION, as data. Prose in a prompt preamble is advisory; this is what
    // the script hard-stops on, and it stops on a VERSION MISMATCH too — an approval of plan v2
    // does not authorise building v3.
    // `{ found, version, date, who, recordedIn, quote }` — `found` required; `quote` is the entry VERBATIM, so the
    // caller can check the script's arithmetic rather than take its word.
    approval: { type: 'object' },
    // VERBATIM from `--units.planVersion` — the engine's own deterministic hash over the manifest inputs that
    // define the plan. NOT read out of `plan.md`, and never composed: `plan.md` is ENGINE-WRITTEN and presented
    // verbatim, so it carries whatever `--plan` printed and nothing an agent could add would survive a re-run.
    planVersion: { type: 'string' },
    unitKeys: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'string' } },        // `--units.pages[].key`, verbatim
    buildOrder: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'string' } },      // `--units.buildOrder`, verbatim (post-order)
    // THE TARGET PACKAGE, and whether it EXISTS. Nothing in the run used to ask, and the omission cost a whole
    // run: on a migration into a NEW application every page unit is unbuildable until the package exists, and
    // `create-app` — the only way to obtain it — also mints the starter pages that are `main`'s deliverable, which
    // a child-page builder must not create. Leaf-first puts every child BEFORE `main`, so each one correctly
    // refused and reported blocked, three rounds each, and the run wrote nothing at all. Measured: 12 agents,
    // 1.9M tokens, `built.json.pages` empty. So the state is now DATA the script schedules on.
    targetPackage: { type: ['string', 'null'] },   // `--units.pages[].targetPackage` for `main`, VERBATIM
    // 'exists' — confirmed present on the stand · 'absent' — confirmed not there · 'unknown' — could not tell.
    // Three states, not a boolean: 'unknown' must not read as "go ahead and create it" (a second `create-app`
    // over an existing app is not a no-op) nor as "it is there" (which puts every unit back in the loop that
    // wasted the run). It stops the run and says which check was inconclusive.
    packageState: { type: 'string', enum: ['exists', 'absent', 'unknown'] },
    // ENG-95850 (A2) — THE ONE STAND WRITE THIS RUN'S OWN STATE FILE CARRIES ACROSS ROUTES AND SESSIONS: the
    // application/package the app unit created, read off `build-queue.json`.`standWrites.packageCreated`. It is what
    // lets the `new-app` placement stop tell a package SOMEONE ELSE owns (a plan-vs-stand mismatch, still a stop) from
    // the package THIS migration created (a resume, which continues). `null`/absent on a folder written before the
    // field, which keeps the old behaviour exactly — a stop — so absence is never read as ownership.
    // NOT REQUIRED, deliberately: an agent that cannot read the file must be able to say nothing rather than guess,
    // and the safe side of "nothing" here is the stop.
    // `{ package, appUnitComplete, planVersion, sectionPage }`, the first two required WHEN THE OBJECT IS PRESENT.
    // `null` is a first-class answer: an agent that cannot read the file says nothing rather than guessing.
    packageCreatedByRun: { type: ['object', 'null'] },
    // ENG-95850 (B4/C3) — the orphans an EARLIER run or the other route recorded, read off
    // `build-queue.json`.`standWrites.orphanedPages`. Required for the record to do the job it exists for: the
    // incident it comes from was a LATER diagnosis reading a dead page, so a list this run writes but never reads
    // back is write-only and helps nobody. Merged as a UNION with what this process records (an orphan a previous
    // session found is still an orphan), never overwritten by it.
    // Each entry `{ schema, orphanedBy, at }`, `schema` required.
    orphanedPagesOnFile: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'object', additionalProperties: { maxLength: RECONCILE_TEXT_CAP } } },
    // The object the MIGRATION is about — `--units.pages[]` for `main`, its `entity`. The app unit binds the
    // section it creates to THIS, and the gate compares every built page against the same string.
    mainEntity: { type: ['string', 'null'] },
    // WHERE THE SECTION IS REGISTERED, as the approved plan decided it — `--units.sectionHost`, verbatim.
    // NOT required: a plan written before placement was gated publishes none, and `null` must keep this run
    // behaving exactly as it did then. What it changes when present: `new-app` over an EXISTING package is a
    // stop (create-app cannot mint a package that is already there), and `pages-only-no-menu` means no section
    // is registered at all — an executor that "helpfully" registers one has built what the plan dropped.
    sectionHost: { type: ['string', 'null'], enum: ['existing-app', 'new-app', 'pages-only-no-menu', null] },
    // The application the section belongs in — `--units.applicationCode`, verbatim. `null` under `new-app`
    // (it does not exist yet) and `pages-only-no-menu` (nothing is registered). It exists so the unit doing the
    // registration READS the approved app: in the run this field comes from, the agent had none in front of it,
    // resolved one off the stand by name, and registered against an app that could not host a section at all.
    applicationCode: { type: ['string', 'null'] },
    // The union of `--units.pages[].componentTypes` — every `crt.*` type this plan's gate will look for. The Refs
    // step caches each one's documentation once, instead of every fresh-context builder fetching the same six.
    componentTypes: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'string' } },
    // ENG-95468 — the Reconcile agent's read-only `get-component-info` result for each `componentTypes` entry,
    // resolved against the TARGET stand: `{ type, resolved, note }`. This is what the pre-build component gate
    // (`componentTypeMismatches`) stops on — a type reported `resolved: false` is a plan assertion untrue of the
    // stand (a fabricated name, or a composite/component whose package/feature is not installed here). OPTIONAL:
    // an agent/plan that does not report it produces no component gate (absence is never read as a failure), so a
    // run that predates this field behaves exactly as it did before.
    // ENG-95683 DELIVERED the by-kind branch this comment used to defer: a `resolved: false` type carrying a
    // well-formed gated composite (`kind: 'composite'` + an `id` of gate-name shape) makes the stop say 'install
    // `id` (+enable `feature`) and re-run the BUILD' instead of the generic re-plan text. What is STILL open is
    // narrower: nothing here confirms the `id` is the RIGHT package for the type — that needs the engine's
    // `gateForComponentType` table, unreachable from a module inlined into the workflow script (see `helpers.mjs`
    // `gatedComposite`). Absent or malformed ⇒ the generic clause stands, so an older plan behaves as it did.
    // One `{ type, resolved, note }` per entry, `type`/`resolved` required, plus ENG-95683's OPTIONAL typed gate on a
    // gated composite: `kind` ('composite'), the gating package `id`, and the gating `feature` when there is one.
    // Those three are NOT re-declared as `properties` here and that is deliberate (ENG-95930, mode A): the expanded
    // per-property form serializes over the host's 4096-byte classifier cap, which is what refused the schema before
    // the model ever ran. `additionalProperties: { maxLength: RECONCILE_TEXT_CAP }` carries them — a string cap does not constrain
    // the boolean `resolved` — and `RECONCILE_SHAPE.componentResolution` below enforces the insides on arrival.
    componentResolution: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'object', additionalProperties: { maxLength: RECONCILE_TEXT_CAP } } },
    // `--units.templateNames`, VERBATIM — the deduped page TEMPLATE schema names this plan asserts (ENG-95468).
    // The plan's own published set, so it plays exactly the role `componentTypes` plays for components: only a name
    // the PLAN named may gate, and a resolution naming something else cannot manufacture a stop no re-plan can act on.
    templateNames: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'string' } },
    // ENG-95468 — the Reconcile agent's read-only resolution of each `templateNames` entry against the TARGET stand:
    // `{ name, resolved, note }`. Same shape, same rules and the same absence rule as `componentResolution`: only an
    // explicit `resolved: false` gates, an unreported name is not a failure, and a plan predating the field behaves
    // exactly as it did before. This is the axis the third Applicant run failed on — the plan named
    // `ListPageV2FreedomTemplate`, the page was built on `ListPageV3Template`, and nothing in between asked the stand.
    // One `{ name, resolved, note }` per entry, `name`/`resolved` required.
    templateResolution: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'object', additionalProperties: { maxLength: RECONCILE_TEXT_CAP } } },
    // The environment's `SchemaNamePrefix`, read off the stand (ENG-95468). Load-bearing for the app/package
    // identity check: clio derives a new app's package as `SchemaNamePrefix + code`, so this is the ONLY thing that
    // makes "the plan's target package is producible here, and by exactly this code" decidable BEFORE `create-app`
    // writes. THE EMPTY STRING IS A REAL VALUE and is NOT the same as absence — a stand with no prefix is exactly
    // the case the third Applicant run hit (package == app code) — so `''` gates and `null`/absent does not.
    schemaNamePrefix: { type: ['string', 'null'] },
    // The EMPTY prefix's wire form: `{ schemaNamePrefix: null, schemaNamePrefixEmpty: true }`. A bare `""` value is
    // the token observed dropped from large submissions of this answer (which then fail to parse at the host), so
    // the empty answer travels as this boolean and `reconcileAgent` decodes the pair back to `''` on acceptance —
    // every consumer still reads the string contract above. `""` itself remains legal for compatibility. REQUIRED
    // on every answer (`false` when the prefix is non-empty or unreadable): a flag that must always be present
    // cannot be dropped without the whole answer being refused and retried.
    schemaNamePrefixEmpty: { type: 'boolean' },
    // The FREEDOM schema each page key resolves to — the one thing `--units` cannot publish (its
    // `pages[].schema` is the CLASSIC source, and it is `null` for `main` and for an unfolded child).
    // Without it nothing can `get-page` the page a key names, so the queue file is where a builder's
    // answer is kept: this is read from `units[<key>].schemaName` there, and it is what makes a build
    // started in an earlier session verifiable in this one.
    pageSchemas: { type: 'object', additionalProperties: { type: ['string', 'null'] } },
    // The parent edge `--units` does NOT publish. Supplied when the plan's nested Child page
    // mappings make it derivable; `null` per key when it is not. Without it the park arithmetic
    // below degrades to an APPROXIMATION and says so in the return.
    parents: { type: 'object', additionalProperties: { type: ['string', 'null'] } },
    // Each `{ key, appliesWhen, pages, what, miss }`, `key`/`appliesWhen` required: the run schedules on
    // `appliesWhen`, so a missing or non-boolean one is a rejected answer, never a default.
    reachability: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'object', additionalProperties: { maxLength: RECONCILE_TEXT_CAP } } },
    // What the built file currently records for each reachability key: 'true' | 'false' | 'unset'.
    // Strings, not booleans, because the tri-state is the whole point (absent ≠ false).
    reachabilityState: { type: 'object', additionalProperties: { type: 'string' } },
    // ENG-95930 (mode A) — `preflightItems` takes the compacted form like every other object array on this
    // contract: the expanded per-property declaration is what pushed this schema past the host's 4096-byte
    // classifier cap. Its insides are enforced by `RECONCILE_SHAPE.preflightItems` on arrival instead.
    preflightItems: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'object', additionalProperties: { maxLength: RECONCILE_TEXT_CAP } } },
    // The two answer-channel repair-grant sets, read back off the queue file (PR #128 review, N2). Persisted
    // directly rather than derived from `unconsumedResolutions`, because the `!res` path files an unconsumed row
    // WITHOUT spending the grant, so the derivation mis-marked exactly those units and denied them their repair.
    // `resolutionsReopened` is per `(unit, id)` and therefore an OBJECT array: the grant is per ANSWER, because the
    // "a second round is a loop" bound is about the question, not the page. `resolutionsPending` stays a UNIT-key
    // array — it feeds `reopenKeys()`, and what a round re-opens is a unit.
    // COMPACTED for the ENG-95930 reason above; `RECONCILE_SHAPE` carries the required keys and the types.
    resolutionsReopened: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'object', additionalProperties: { maxLength: RECONCILE_TEXT_CAP } } },
    resolutionsPending: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'string' } },
    // ANSWERS THAT MATCHED NO QUESTION, and questions answered TWICE through the two key forms. Carried because the
    // engine's stderr warnings are emitted inside this subagent and reach nobody, and either silence loses an answer
    // the operator believes is applied.
    // IDENTIFIERS ONLY — no `answer` text. An agent retypes every field of this into a tool call each round, and the
    // text is already in the operator's own file; naming which answer missed is the whole job.
    // Both carry `{ id, kind, item }` per entry — identifiers only, no `answer` text.
    resolutionsUnmatched: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'object', additionalProperties: { maxLength: RECONCILE_TEXT_CAP } } },
    resolutionsConflicts: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'object', additionalProperties: { maxLength: RECONCILE_TEXT_CAP } } },
    evidenceIds: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'string' } },
    // Evidence ids with a filed record in `built.json` and NO `judge` entry — including records filed
    // in an earlier session or by the preflight phase. An unjudged record keeps its page open, and the
    // judge is only ever handed ids, so a record nobody names is a page that can never close.
    unjudgedEvidenceIds: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'string' } },
    // WHAT IS ALREADY ANSWERED, so Preflight does not re-derive it. `--units.preflight` is the plan's list of open
    // questions and says nothing about which have been resolved; without these two a resumed run re-ran the whole
    // fan-out over records that were already on file, and the merge would overwrite each one with the second
    // answer. Both are read off the built file, and both may be empty on a first run.
    evidenceFiled: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'string' } },     // ids whose `evidence[id]` is a RECORD object
    evidenceRejected: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'string' } },  // ids the judge ruled `convincing: false`
    // Keys whose `pages` entry already exists in `built.json` — a recorded object, or `false` for "checked,
    // genuinely not built". Absent or empty fetches every key. This is a REPORT, not a verified fact, and the only
    // thing that makes an over-report survivable is Reconcile's own all-keys sweep running every round regardless of
    // what Verify skipped: a wrongly-skipped page is re-read there, and its unit stays open until it is.
    pagesRecorded: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'string' } },
    // Parks already recorded in the queue file, WITH the reason each was parked for. A park is
    // terminal for the run that made it; a resumed run must not re-dispatch a full stand-writing
    // round for a unit its predecessor already gave up on and asked the user about.
    // Each `{ key, parkedWhy, rounds }`, `key` required.
    parkedUnits: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'object', additionalProperties: { maxLength: RECONCILE_TEXT_CAP } } },
    // Plan deviations, blockers and builder-vs-stand disagreements already in the queue file from an
    // earlier session. They seed this run's lists so a kill does not erase what a previous one recorded.
    // Each `{ unit, deviation, why, applied }`, `deviation`/`why` required.
    proposals: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'object', additionalProperties: { maxLength: RECONCILE_TEXT_CAP } } },
    // Each `{ unit, what, why }`, `what`/`why` required.
    blocked: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'object', additionalProperties: { maxLength: RECONCILE_TEXT_CAP } } },
    // Each `{ unit, claim, found, round }`, `unit`/`claim`/`found` required.
    discrepancies: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'object', additionalProperties: { maxLength: RECONCILE_TEXT_CAP } } },
    // ENG-95503 / PR #128 review — ANSWERS AN EARLIER SESSION SAW REACH A BUILDER AND PRODUCE NOTHING. Read back
    // for the same reason `blocked` and `discrepancies` are, and it matters MORE than either: a well-formed decline
    // is the one outcome that leaves no row in either of those, so without this the record died with its process and
    // a resumed run reported `complete: true` over a dropped answer.
    // Each `{ unit, id, kind, answer, why, source }`, `unit`/`id`/`source` required — enforced by
    // `RECONCILE_SHAPE.unconsumedResolutions`. `source` is typed but no longer ENUM-constrained here — see the note
    // on that entry for why, and for what enforces it instead. `item` and `how` are deliberately NOT part of this
    // contract: nothing in the
    // run decides on them (`item` is recoverable from `id`, and a refuted builder's `how` is preserved in its
    // `discrepancies` row), so they stay in the queue file rather than being transcribed back through an agent.
    unconsumedResolutions: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'object', additionalProperties: { maxLength: RECONCILE_TEXT_CAP } } },
    // Queue drift. A key in the queue and not in `--units` means the plan was regenerated under
    // the run; trusting it silently builds a page nothing gates.
    staleQueueKeys: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'string' } },
    newKeys: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'string' } },
    // ENG-95930 (mode B) — the COUNTS-ONLY `--verify-summary`, copied verbatim: `{ complete, missing, unverified,
    // pages["<key>"] = { complete, buildComplete, builderOpen, missing, unverified } }`, NO `openRows`. The FILE
    // also carries its own `planGaps`; this channel deliberately does NOT transcribe it (ENG-95857 — the
    // plan-level verdict has ONE home, `--units.planGaps` below, and this channel is the BUILD verdict), which is
    // why `RECONCILE_SHAPE.verify` names no `planGaps` either and the step-4 prompt says so in as many words.
    // The reconcile agent COPIES that file: it does not read the Markdown table, does not re-derive a
    // number, and does not transcribe per-row prose — that prose was ~21 KB on a fresh stand and truncated this,
    // the run's FIRST agent's, structured answer at the host's tool-input cap. Each build agent reads its OWN page's
    // open rows from its own scoped `--verify --page` gate instead. `RECONCILE_SHAPE.verify` REQUIRES `buildComplete`
    // per page — the `missing`-only axis the park/close arithmetic reads, not interchangeable with the combined
    // `complete`, which folds in unfiled evidence a builder cannot clear.
    verify: { type: 'object' },
    exitCode: { type: 'integer' },
    // D12 — the PLAN-level legs of exit 2: `--units.planGaps` copied VERBATIM (ENG-95857), all FOUR checks the
    // engine performs. A machine verdict, NOT a set an agent assembled from stderr lines it retyped. Empty means
    // the only problem (if any) is `VERIFY INCOMPLETE`, which IS repairable on-stand.
    planGaps: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'string' } },
    roundOf: { type: 'object', additionalProperties: { type: 'integer' } },
    continuationOf: { type: 'object', additionalProperties: { type: 'integer' } },
    verifyTablePath: { type: 'string' },
    notes: { type: 'string' },
  },
}

// THE SHAPE OF THE RECONCILE ANSWER.
//
// `RECONCILE_SCHEMA` declares the properties but not their insides: the host refuses a serialized schema over 4096
// bytes, so the nested objects are `object` / `array of object` there and their contract lives here — checked when
// the answer arrives rather than before it is produced.
//
// WHAT BELONGS HERE: exactly what the schema stopped enforcing. Nothing stricter — a requirement invented here
// rejects answers the schema accepted, which is a behaviour change, not a check. Nothing looser either:
// `verify.pages[*].buildComplete` is REQUIRED because an agent reproduces the fields it is told about and drops the
// rest, and its absence sends `derivedBuildComplete` to the combined `complete`, which folds in evidence a builder
// cannot clear — every page then reads not-build-complete and honest self-reports flag as mismatches.
//
// `kind`: `array` (of objects) · `object` · `object-or-null`. `required` are the keys that must be PRESENT;
// `types` are checked only when the key is present; `nested` recurses into one named sub-value; `map` recurses into
// every value of an `additionalProperties`-style map.
export const RECONCILE_SHAPE = {
  approval: { kind: 'object', required: ['found'],
    types: { found: 'boolean', version: 'string', date: 'string', who: 'string', recordedIn: 'string', quote: 'string' } },
  packageCreatedByRun: { kind: 'object-or-null', required: ['package', 'appUnitComplete'],
    types: { package: 'string', appUnitComplete: 'boolean', planVersion: 'string-or-null', sectionPage: 'string-or-null' } },
  orphanedPagesOnFile: { kind: 'array', required: ['schema'],
    types: { schema: 'string', orphanedBy: 'string-or-null', at: 'string-or-null' } },
  // ENG-95683 — `kind`/`id`/`feature` are the OPTIONAL typed gate on a `resolved: false` composite; the by-kind
  // stop (`helpers.mjs` `GATE_COMPOSITE`) reads them. Declared here rather than in `RECONCILE_SCHEMA` for the mode-A
  // reason given above; absent/malformed still falls back to the generic re-plan clause.
  componentResolution: { kind: 'array', required: ['type', 'resolved'],
    types: { type: 'string', resolved: 'boolean', note: 'string', kind: 'string', id: 'string', feature: 'string' } },
  templateResolution: { kind: 'array', required: ['name', 'resolved'],
    types: { name: 'string', resolved: 'boolean', note: 'string' } },
  // `what`/`miss` are string-or-null because that is what `--units` PUBLISHES: a non-applicable key
  // (`appliesWhen: false`) carries `what: null, miss: null`, the prompt orders a verbatim copy, and a string-only
  // rule rejected that copy on the FIRST attempt of every Reconcile. Applicable rows always carry real strings.
  reachability: { kind: 'array', required: ['key', 'appliesWhen'],
    types: { key: 'string', appliesWhen: 'boolean', pages: 'string[]', what: 'string-or-null', miss: 'string-or-null' } },
  // `resolution: null` is a LEGAL answer and is checked as such — the engine publishes it on every unanswered item.
  preflightItems: { kind: 'array', required: ['id', 'pageKey'],
    types: { id: 'string', pageKey: 'string', kind: 'string', item: 'string', requires: 'string[]' },
    nested: { resolution: { kind: 'object-or-null', required: ['answer'],
      types: { answer: 'string', decidedBy: 'string', date: 'string' } } } },
  // No required keys, matching the old schema exactly: these two were declared with properties and no `required`.
  resolutionsUnmatched: { kind: 'array', required: [], types: { id: 'string', kind: 'string', item: 'string' } },
  resolutionsConflicts: { kind: 'array', required: [], types: { id: 'string', kind: 'string', item: 'string' } },
  parkedUnits: { kind: 'array', required: ['key'], types: { key: 'string', parkedWhy: 'string', rounds: 'integer' } },
  proposals: { kind: 'array', required: ['deviation', 'why'],
    types: { unit: 'string', deviation: 'string', why: 'string', applied: 'boolean' } },
  blocked: { kind: 'array', required: ['what', 'why'], types: { unit: 'string', what: 'string', why: 'string' } },
  discrepancies: { kind: 'array', required: ['unit', 'claim', 'found'],
    types: { unit: 'string', claim: 'string', found: 'string', round: 'integer' } },
  // ENG-95503 — the answers channel's three round-trip fields. Their insides moved here with everyone else's when
  // ENG-95930 compacted the schema; the required keys and types are unchanged.
  // WHAT THIS TABLE CANNOT CARRY, stated rather than lost: `source` used to be a JSON Schema `enum` of the two
  // tags, because it decides whether a row survives the next dispatch — as a free string, a transcription slip made
  // a verifier-confirmed contradiction read as dispatch-sourced. The compacted form cannot express a per-property
  // enum (`additionalProperties` applies one rule to every key), and this table's vocabulary is CLOSED to
  // `kind`/`required`/`types`/`nested`/`map` — an invented `enums` key would be silently ignored, which is worse
  // than no check because it reads as one. The constraint is instead enforced by FAIL-CLOSED behaviour at the
  // reconcile: only the literal `UNCONSUMED_FROM_VERIFIER` opens the reasoned-`unknown` release, so a garbled tag
  // means the row is RETAINED, never released on a claim nobody confirmed. Widening `SHAPE_TYPES` to carry enums is
  // the real fix and is bigger than this merge.
  // `item`/`how` are absent by design — see `RECONCILE_SCHEMA` above.
  unconsumedResolutions: { kind: 'array', required: ['unit', 'id', 'source'],
    types: { unit: 'string', id: 'string', kind: 'string', answer: 'string', why: 'string', source: 'string' } },
  resolutionsReopened: { kind: 'array', required: ['unit', 'id'], types: { unit: 'string', id: 'string' } },
  // ENG-95930 (mode B) — COUNTS-ONLY. The central verify Reconcile carries used to nest each page's full `openRows`
  // prose (`deliverable`/`status`/`evidence` for every open row); on a fresh stand nothing is complete, so that was
  // ~21 KB the run's FIRST agent had to transcribe into ONE structured answer, which truncated at the host's ~20 KB
  // tool-input cap and failed the run before it built anything. The rows no longer cross this boundary at all: each
  // build agent reads its OWN page's open rows from its own scoped `--verify --page` gate, in its own context. Per
  // page only the counts and the two axes remain; `buildComplete` stays REQUIRED (the `missing`-only axis the park/
  // close arithmetic reads — an answer missing it is rejected, never silently sent to the combined `complete`).
  verify: { kind: 'object', required: ['complete', 'missing', 'unverified', 'pages'],
    // No top-level `builderOpen`: `verifySummary` (like `verifyDigest`) publishes it PER PAGE only, so a `types`
    // entry for it here could never fire and would describe a field this channel does not carry (ENG-95930 review).
    types: { complete: 'boolean', missing: 'integer', unverified: 'integer' },
    map: { pages: { required: ['complete', 'buildComplete'],
      types: { complete: 'boolean', buildComplete: 'boolean', builderOpen: 'integer', missing: 'integer', unverified: 'integer' } } } },
}

export const PREFLIGHT_SCHEMA = {
  type: 'object',
  required: ['resolved'],
  properties: {
    resolved: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'answer'],
        properties: {
          id: { type: 'string' },
          answer: { type: 'string' },
          referencePage: { type: 'string' },
          components: { type: 'array', items: { type: 'string' } },
          filedAsFalse: { type: 'boolean' },   // checked, and the deliverable is genuinely not applicable
        },
      },
    },
    unresolved: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'why'],
        properties: { id: { type: 'string' }, why: { type: 'string' }, settlingQuery: { type: 'string' } },
      },
    },
  },
}

export const BUILD_PROPERTIES = {
  unit: { type: 'string' },
  // The FREEDOM schema this unit's page now resolves to — what a later `get-page` must be given.
  // MANDATORY for a PAGE unit, and `BUILD_SCHEMA_PAGE` below enforces it: nothing else in the run knows
  // it, `--units` cannot publish it, and without it the verifier has no page to fetch and the unit can
  // never close. Every document called it mandatory while the one schema left it optional, so a builder
  // could return a structurally VALID answer that made its own unit permanently unverifiable.
  schemaName: { type: 'string' },
  packageName: { type: 'string' },
  template: { type: 'string' },
  // A CLAIM, not evidence — the read-only verifier files what the stand actually returns, and
  // the script logs any disagreement rather than smoothing it over.
  claimedBuilt: { type: 'array', items: { type: 'string' } },
  reboundFrom: { type: 'string' },
  // ENG-95850 (B2) — WHAT THE `sectionRegistered` UNIT COUNTED. A workplace registration only ADDS, so the unit's
  // own report has to carry the NUMBER of bindings, not the fact that it registered one: on a real run the section
  // ended up in two workplaces and looked right in the one that was opened. The count travels to the verifier, which
  // writes it into `built.reachability.sectionRegistered` and lets the gate close the row at exactly one. Reporting
  // is the whole job — the unit never unbinds, because removing a workplace binding is a stand deletion.
  workplaceBindings: {
    type: 'object',
    required: ['count'],
    properties: {
      count: { type: 'integer' },
      names: { type: 'array', items: { type: 'string' } },
    },
  },
  // The UI-guidelines pass, as the record the verifier files from. REQUIRED on a page unit: an absent answer
  // is not a valid outcome, `ran: false` with `notRunWhy` is. `evidenceId` is COPIED from this unit's published
  // ids, never composed — an invented id matches no row. `componentsDiffed` is the prop-diffed set, which is
  // NOT `claimedBuilt`.
  guidelines: {
    type: 'object',
    required: ['evidenceId', 'ran'],
    properties: {
      evidenceId: { type: 'string' },
      ran: { type: 'boolean' },
      referencePage: { type: 'string' },
      componentsDiffed: { type: 'array', items: { type: 'string' } },
      // ENG-95471 — the diff came back EMPTY because the page already matched the guideline, a legitimate
      // outcome the diff-list alone cannot express. `noChangesNeeded` names that outcome explicitly so it is
      // never mistaken for an unanswered field, and `noChangesReason` carries what was compared to reach it.
      noChangesNeeded: { type: 'boolean' },
      noChangesReason: { type: 'string' },
      notRunWhy: { type: 'string' },
    },
  },
  // Not a failure and not a repair. The builder reached a safe boundary and asks the orchestrator to verify what
  // changed, persist the state, and dispatch the same unit again in fresh context if it still has open rows.
  continuationRequested: { type: 'boolean' },
  continuationReason: { type: 'string' },
  safeContinuationPoint: { type: 'string' },
  // THE IN-CONTEXT COMPLETENESS GATE'S RESULT (ENG-95469). The builder runs the scoped single-unit `--verify` over
  // its OWN page before reporting the unit complete, gets one bounded fix if short, re-checks, and files the outcome
  // here. `ran: false` with `notRunWhy` is a valid outcome (a page the builder genuinely could not get-page);
  // `stillShortRows` is the scoped verdict's `openRows` AFTER the one fix — what the run composes the park reason
  // from when a unit is still short. `buildComplete`/`complete`/`missing`/`unverified` are copied VERBATIM from the
  // engine's single-unit verdict file, never a self-graded claim: the number is the engine's arithmetic, transcribed.
  // ENG-95901 — `buildComplete` (the `missing`-only axis) is what the in-context gate's own exit code and this
  // schema's PARK decision read; `complete` (kept for logging/back-compat) still folds in `unverified`, which the
  // builder can never legitimately clear itself.
  selfCheck: {
    type: 'object',
    required: ['ran'],
    properties: {
      ran: { type: 'boolean' },
      buildComplete: { type: 'boolean' },
      complete: { type: 'boolean' },
      missing: { type: 'integer' },
      unverified: { type: 'integer' },
      builderOpen: { type: 'integer' },
      fixAttempted: { type: 'boolean' },
      // ENG-95930 (mode B) — the in-context PARK SUMMARY is the only place a build agent returns any open-row text, and
      // it is HARD-CAPPED here in the schema, not merely asked for in the prompt: at most 3 rows, each descriptive
      // field ≤80 chars. So even a page with hundreds of open rows is byte-bounded on the agent's answer and no single
      // unit can re-create mode B. `remainingRowCount` (= this unit's total open rows − the rows returned here) is the
      // unconditionally-bounded fact — an integer needs no length keyword — so an operator still sees the true scale
      // even where the host does not enforce `maxItems`/`maxLength`. The full rows stay in `self-verdict-N.json` on disk.
      stillShortRows: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          required: ['deliverable', 'status', 'evidence'],
          // `outcome`/`owner` ride along so the tail cross-check can tell a builder-owned shortfall from a row the
          // builder was never allowed to close, without re-deriving what the engine already decided. They carry the
          // SAME `maxLength` as the other three: a cap on three of five string fields leaves the same overflow open
          // through the other two, and these are short enum-ish words in practice, so the bound costs nothing.
          properties: { deliverable: { type: 'string', maxLength: 80 }, status: { type: 'string', maxLength: 80 }, evidence: { type: 'string', maxLength: 80 },
            outcome: { type: 'string', maxLength: 80 }, owner: { type: 'string', maxLength: 80 } },
        },
      },
      remainingRowCount: { type: 'integer', minimum: 0 },
      notRunWhy: { type: 'string' },
    },
  },
  blocked: {
    type: 'array',
    items: {
      type: 'object',
      required: ['what', 'why'],
      properties: { what: { type: 'string' }, why: { type: 'string' } },
    },
  },
  // A plan deviation is RETURNED, never applied. The plan is still built as written.
  proposals: {
    type: 'array',
    items: {
      type: 'object',
      required: ['deviation', 'why'],
      properties: { deviation: { type: 'string' }, why: { type: 'string' } },
    },
  },
  // ENG-95503 — WHAT THE BUILDER DID WITH EACH ANSWER IT WAS HANDED. One row per ⚠ Confirm id this unit's prompt
  // carried, and the script checks the SET of ids against what `resolutionsForUnit` routed here — never the wording,
  // which it cannot judge. Delivery already worked (the answer reaches the prompt verbatim); a real run still lost a
  // fully-specified `entity-filter` answer because nothing asked the builder what became of it. `applied: false` is a
  // LEGAL outcome and needs `why`; what is not legal is silence, indistinguishable from an answer never read.
  // NOT evidence, and not a substitute for one: this says what the builder DID, the verifier still reads the page.
  resolutionsApplied: {
    type: 'array',
    items: {
      type: 'object',
      required: ['id', 'applied'],
      properties: {
        id: { type: 'string' },        // COPIED from the question handed to you, never composed
        applied: { type: 'boolean' },
        how: { type: 'string' },       // what you built because of it — the components / columns / filter you added
        why: { type: 'string' },       // REQUIRED when `applied` is false: why the answer could not be built
      },
    },
  },
  // WHAT A HUMAN SHOULD EXERCISE on this page, asked for only at a checkpoint. Sourced from the behaviour
  // card's ACCEPTANCE CRITERIA for each imperative row the builder ported — including the negative ones, which
  // are the half a quick look never covers. This is what turns "open it and see if it works" into a scripted
  // check, and it is the only check the `Form — Logic` rows get at all, since they carry no verification key.
  checkFirst: {
    type: 'array',
    items: {
      type: 'object',
      required: ['what', 'how'],
      properties: {
        what: { type: 'string' },   // the behaviour, in the card's terms
        how: { type: 'string' },    // the steps on the page that exercise it, expected result included
        row: { type: 'string' },    // the plan row / Classic member it came from
      },
    },
  },
}
// TWO build schemas over the same properties, because the two unit kinds have different obligations. A PAGE unit
// must come back with `schemaName` — that is the one fact only the builder holds, and the whole rest of the run
// (verify, judge, resume in a later session) is unreachable without it. A REACHABILITY unit is a configuration
// record with no page body, so demanding a schema name there would reject a correct answer.
export const BUILD_SCHEMA_PAGE = { type: 'object', required: ['unit', 'claimedBuilt', 'schemaName', 'guidelines', 'selfCheck'], properties: BUILD_PROPERTIES }
// The same page obligations MINUS `guidelines`, for a published page key that carries no quality-gates row (an
// unfolded or a reuse child). `schemaName` is still required: the page still has to be verifiable. `selfCheck` is
// required too: the guidelines exemption is about the missing quality-gates id, NOT about the in-context gate —
// `inContextGateBlock` fires for EVERY `unit.kind === 'page'` regardless of schema kind, and these units still have
// a real, checkable page body, so omitting `selfCheck` here would reopen the "closes on silence" hole for this class.
export const BUILD_SCHEMA_PAGE_NO_GUIDELINES = { type: 'object', required: ['unit', 'claimedBuilt', 'schemaName', 'selfCheck'], properties: BUILD_PROPERTIES }
export const BUILD_SCHEMA_REACH = { type: 'object', required: ['unit', 'claimedBuilt'], properties: BUILD_PROPERTIES }
// The APP unit must come back with the package it actually produced — the one fact the rest of the run schedules
// on. `packageName` is REQUIRED and is compared against the plan's target by the script, not by the agent: clio
// derives the package from `code` via the environment's `SchemaNamePrefix`, so "I created the app" is not the same
// claim as "the package the plan targets now exists".
export const BUILD_SCHEMA_APP = {
  type: 'object',
  required: ['unit', 'packageName'],
  properties: {
    ...BUILD_PROPERTIES,
    packageName: { type: 'string' },       // what the stand actually has now, read back — never the code that was passed
    appName: { type: 'string' },
    starterFormPage: { type: 'string' },   // `main`'s deliverable, created as a side effect of `create-app`
    starterListPage: { type: 'string' },
  },
}
// Keyed by what `buildSchemaKind` returns, so the dispatch site holds a lookup rather than a chain of ternaries.
export const BUILD_SCHEMAS = { app: BUILD_SCHEMA_APP, page: BUILD_SCHEMA_PAGE, 'page-no-guidelines': BUILD_SCHEMA_PAGE_NO_GUIDELINES, reach: BUILD_SCHEMA_REACH }

export const REFS_SCHEMA = {
  type: 'object',
  required: ['written'],
  properties: {
    written: { type: 'boolean' },
    files: { type: 'array', items: { type: 'string' } },
    // The page keys that ACTUALLY have a slice file. Not every published key does: a reused or unresolved child was
    // never folded, so it has no design spec of its own and the engine refuses to render one. The build prompt only
    // claims a slice for the keys in here — telling a unit its slice is ready when the file does not exist, while
    // forbidding the fallback, would leave it with no spec at all.
    slices: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}
export const VERIFIER_SCHEMA = {
  type: 'object',
  required: ['pagesWritten', 'builtFile'],
  properties: {
    builtFile: { type: 'string' },
    queueWritten: { type: 'boolean' },
    pagesWritten: { type: 'array', items: { type: 'string' } },      // keys given a `pages` entry this round
    pagesRecordedFalse: { type: 'array', items: { type: 'string' } },// keys deliberately recorded absent
    // Keys this phase could NOT fetch because no Freedom schema is known for them. An explicit
    // "cannot verify, unknown schema" — never an omission that reads like "nobody got round to it".
    unknownSchema: { type: 'array', items: { type: 'string' } },
    // Schemas this phase CONFIRMED on the stand, key → schema name. They are persisted to the queue
    // file, so a schema learned here survives the session that learned it.
    schemasConfirmed: { type: 'object', additionalProperties: { type: 'string' } },
    reachabilityWritten: { type: 'object', additionalProperties: { type: 'string' } },
    evidenceWritten: { type: 'array', items: { type: 'string' } },   // evidence ids filed
    // ENG-95503 — WHETHER THE PAGE SHOWS WHAT EACH OPERATOR ANSWER ASKED FOR. An OBSERVATION, not a verdict: the run
    // compares it against the builder's own `applied` claim and records where the two disagree. Not required IN THIS
    // STATIC BASE — a round with no answered items has nothing to report, and a verifier that could not fetch a page
    // must not be forced to invent a row about it; an absent row reads as unconfirmed, which is what it is.
    // IT IS REQUIRED ON A ROUND THAT HANDED OUT ANSWERS, and the obligation is ADDED rather than declared here:
    // `verifierSchemaWithChecks(VERIFIER_SCHEMA, resolutionClaimCount(claims))` (helpers.mjs) appends it to
    // `required` for exactly those dispatches. That is what `references/02-queue-and-built-files.md` describes when
    // it says the verifier returns `resolutionChecks` for the answers it was handed — the doc and this comment are
    // about the two halves of one conditional, not in conflict.
    resolutionChecks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['unit', 'id', 'shows'],
        // THREE STATES, NOT TWO (PR #128 review). `shows` was a BOOLEAN and the verifier was told that an effect it
        // could not determine was `false`, while every `false` was read as "the builder lied". So an honest builder
        // plus an honest "I cannot tell from here" produced a contradiction that is not one -- and this ticket's own
        // new `lookup-value` id is the systematic case, because its effect lands in `BusinessRule_*` schemas that are
        // invisible to `viewConfig`. `unknown` is that state, and it reads exactly like an absent row.
        // `found` is CAPPED like every other agent-authored free-text field that can ride into another agent's
        // prompt (`unconsumedResolutions.item/answer/why/how` above). `reconcileUnconsumed`/`resolutionContradictions`
        // already run it through `capCarryText` at record time, but that binds only what this process records --
        // the SCHEMA is what bounds the verifier's own output before any of that runs. An uncapped declaration
        // here is the same gap earlier rounds closed on the sibling fields, left open on the one that carries a
        // page-read description into the repair prompt.
        properties: { unit: { type: 'string' }, id: { type: 'string' },
          shows: { type: 'string', enum: [SHOWS_YES, SHOWS_NO, SHOWS_UNKNOWN] },
          found: { type: 'string', maxLength: CARRY_TEXT_CAP } },
      },
    },
    // Where the builder's claim and the stand disagree. Kept, not reconciled.
    discrepancies: {
      type: 'array',
      items: {
        type: 'object',
        required: ['unit', 'claim', 'found'],
        properties: { unit: { type: 'string' }, claim: { type: 'string' }, found: { type: 'string' } },
      },
    },
    notes: { type: 'string' },
  },
}

export const JUDGE_SCHEMA = {
  type: 'object',
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'convincing', 'why'],
        properties: { id: { type: 'string' }, convincing: { type: 'boolean' }, why: { type: 'string' } },
      },
    },
    // Preflight evidence ids this agent MERGED into the built file. Judging is not filing: without this the workflow
    // has no signal that the transcription happened, and a valid-looking verdict list would settle records nobody wrote.
    evidenceWritten: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
}

// The fallback persistence pass. Normal successful rounds write the same carry through Verify/Reconcile, so this
// agent is only a recovery writer for stops where the combined phase did not confirm the queue update.
export const PERSIST_SCHEMA = {
  type: 'object',
  required: ['written'],
  properties: {
    written: { type: 'boolean' },
    parkedKeys: { type: 'array', items: { type: 'string' } },
    evidenceWritten: { type: 'array', items: { type: 'string' } },   // preflight evidence ids merged into the built file
    // ENG-95503 / PR #128 review -- the ids actually persisted for `unconsumedResolutions`. Reported for the same
    // reason `evidenceWritten` is: this list is the ONLY record of a well-formed `applied: false`, and a write
    // nobody confirmed is exactly how it went missing across a resume.
    // PR #128 review (round 16) -- `{unit, id}` PAIRS, not bare ids. The pair is the identity of an unconsumed
    // answer everywhere else in this channel (`pairKey`, `hasUnconsumedPair`, `resolutionsReopened`), and for a
    // reason: `resolutionOwner` routes a `list-*` answer to the list unit when one is published and to `main`
    // when none is, so ONE id can sit in the carry under TWO units across rounds. Reported as bare ids, a writer
    // confirming one unit's row silenced the warning for the other unit's row as well -- the silent loss this
    // channel exists to close, in the one check that was id-only.
    unconsumedWritten: { type: 'array', items: { type: 'object', required: ['unit', 'id'],
      properties: { unit: { type: 'string' }, id: { type: 'string' } } } },
    notes: { type: 'string' },
  },
}

// ENG-95884 — `packageCreatedByRun` is deliberately NOT required on RECONCILE_SCHEMA (ENG-95850: "an agent that
// cannot read the file must be able to say nothing rather than guess"), so a Reconcile call that silently dropped
// the field and a queue file that genuinely holds no `standWrites.packageCreated` record were indistinguishable —
// both paid the SAME stop. Before either package-ownership stop is trusted with no record in hand, this ONE
// single-purpose read confirms it — cheap, and bounded the same way Reconcile's own retry is.
export const PACKAGE_RECORD_SCHEMA = {
  type: 'object',
  required: ['read', 'packageCreated'],
  properties: {
    read: { type: 'boolean' },   // true iff the file was actually opened and inspected — false only on a real I/O/parse failure
    packageCreated: {
      type: ['object', 'null'],
      required: ['package', 'appUnitComplete'],
      properties: {
        package: { type: 'string' },
        appUnitComplete: { type: 'boolean' },
        planVersion: { type: ['string', 'null'] },
        sectionPage: { type: ['string', 'null'] },
      },
    },
  },
}

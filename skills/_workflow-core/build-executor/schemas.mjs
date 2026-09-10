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
// `auto`-permission sessions. Every schema in this file stays under that, and `RECONCILE_SCHEMA` at 4061 bytes —
// it is the run's first agent, so its refusal costs the whole run. ENG-95468 (PR #159, RC-4) added `componentTypes`
// to `required` and made room for it by dropping `sectionRouteByRun`'s superfluous per-string `maxLength` (the
// answer's total size is bounded by `reconcileShapeErrors`, and that object's four short fields are shape-checked).
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
// EXPORTED (PR #157 review, Blocker 3): `core.mjs` caps the judge's `pageDefect.what` and its evidence id to the
// same bound before either reaches a build prompt. `JUDGE_SCHEMA` caps `what` and not the id, and a second literal
// would be a second number to keep in step.
export const RECONCILE_TEXT_CAP = 400

export const RECONCILE_SCHEMA = {
  type: 'object',
  // Three things, and only things nothing else can produce: the copied state line, the approval (free text), and
  // the stand facts. Everything the engine computed travels inside `summary` and is NOT a field here — a second
  // field for a value the line already carries is a second answer to one question.
  required: ['summary', 'approval', 'packageState'],
  properties: {
    // THE RUN STATE, VERBATIM: the one JSON line the state command printed. Copied, not composed — so the failure
    // mode is a line that does not parse, not a field quietly short of its contents.
    summary: { type: 'string' },
    // The APPROVAL PRECONDITION, as data. It lives in free-text decisions.md, so no command can read it
    // deterministically and it stays reported. The script hard-stops on it, version mismatch included: an approval
    // of plan v2 does not authorise building v3.
    approval: {
      type: 'object',
      required: ['found'],
      properties: {
        found: { type: 'boolean' },
        version: { type: 'string' },
        date: { type: 'string' },
        who: { type: 'string' },
        recordedIn: { type: 'string' },
        quote: { type: 'string' },   // the entry verbatim, so the caller can check the script's arithmetic
      },
    },
    // Three states, not a boolean: 'unknown' must not read as "go ahead and create it" (a second `create-app` over
    // an existing app is not a no-op) nor as "it is there" (which leaves every unit unbuildable). It stops the run
    // and says which check was inconclusive.
    packageState: { type: 'string', enum: ['exists', 'absent', 'unknown'] },
    // Read-only `get-component-info` per published component type, resolved against the TARGET stand.
    // `resolvedFrom` separates an answer about THIS stand from one the tool gave off its bundled catalog; a catalog
    // answer stops the round instead of passing as a confirmation. `kind`/`id`/`feature` carry a gated composite's
    // required package, and only when the tool named one.
    componentResolution: {
      type: 'array',
      maxItems: RECONCILE_LIST_CAP,
      items: {
        type: 'object',
        required: ['type', 'resolved', 'resolvedFrom'],
        properties: {
          type: { type: 'string' },
          resolved: { type: 'boolean' },
          resolvedFrom: { type: 'string' },
          note: { type: 'string' },
          kind: { type: 'string' },
          id: { type: 'string' },
          feature: { type: 'string' },
        },
      },
    },
    // One entry per published template name. An entry is present only when the stand ANSWERED: a name whose read
    // failed is omitted and reported un-swept, because a `false` nobody can stand behind stops a correct plan.
    templateResolution: {
      type: 'array',
      maxItems: RECONCILE_LIST_CAP,
      items: {
        type: 'object',
        required: ['name', 'resolved'],
        properties: {
          name: { type: 'string' },
          resolved: { type: 'boolean' },
          note: { type: 'string' },
        },
      },
    },
    // The stand's own `SchemaNamePrefix`. The EMPTY prefix is a real answer and travels as
    // { schemaNamePrefix: null, schemaNamePrefixEmpty: true } — a bare empty string is the value that gets dropped
    // in transit and then decodes as unreadable. The flag is required on every answer for that reason.
    schemaNamePrefix: { type: ['string', 'null'] },
    schemaNamePrefixEmpty: { type: 'boolean' },
    exitCode: { type: 'number' },
    verifyTablePath: { type: 'string' },
    notes: { type: 'array', maxItems: RECONCILE_LIST_CAP, items: { type: 'string', maxLength: RECONCILE_TEXT_CAP } },
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
  componentResolution: { kind: 'array', required: ['type', 'resolved', 'resolvedFrom'],
    types: { type: 'string', resolved: 'boolean', resolvedFrom: 'string', note: 'string', kind: 'string', id: 'string', feature: 'string' } },
  templateResolution: { kind: 'array', required: ['name', 'resolved'],
    types: { name: 'string', resolved: 'boolean', note: 'string' } },
}

// The state line's own top-level fields. `stateFromAnswer` checks for them and nothing deeper: the line came from
// one command that computes it, so a line that parses and carries these keys is the state — there is no partial
// transcription left to police. A key added to `reconcileState` in the engine is added here.
export const RECONCILE_STATE_KEYS = ['planVersion', 'planGaps', 'unitKeys', 'buildOrder', 'verify', 'roundOf', 'targetPackage']

// The engine prints this line before the state; the engine holds its own copy and run-infra pins the two equal.
export const RECONCILE_STATE_MARKER = '--- RECONCILE STATE (one line follows; copy it verbatim) ---'

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
  // PR #157 review (round 2, Minor 5) — D7'S SETTLE WINDOW, ANSWERED AS A BOOLEAN. The rule asks an agent to
  // write "unconfirmed after N attempts" into `notes`, and re-deriving a decision from prose is the shape the
  // round-2 gate.mjs Blocker is about — so the run reads a typed field instead and the folder remembers the
  // unit, which stops the ~2-minute reload-and-wait being re-spent on every later round up to MAX_ROUNDS.
  // Optional: a unit whose reads settled says nothing, which is the ordinary case.
  unsettled: { type: 'boolean' },
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
  // ENG-96147 — THE SECTION'S OWN LIST-PAGE SCHEMA NAME, copied VERBATIM from `create-app-section`'s response —
  // never retyped from the section's code/caption, never reconstructed with a guessed `_ListPage` suffix. This is
  // the ONE fact `recordSectionRoute()` turns into `standWrites.sectionRoute`; the script — not the builder —
  // assembles the `#Section/...` prefix from it, so no two writers can independently invent a different one. A
  // guessed route produced exactly this incident: `Script error` on a wrong URL, misread as a real page defect,
  // recovered with a database flush and a compile on a shared stand.
  sectionRoute: {
    type: 'object',
    required: ['schemaName'],
    properties: {
      schemaName: { type: 'string' },
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
  // check, and it is the only check the `Form — Custom methods` rows get at all, since they carry no verification key.
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
    // ENG-96458 D6 — EVERYTHING THIS CALL MINTED, removed or not: `{ stubSection, stubEntity, starterPages[],
    // details[], removed[], couldNotRemove[{what, why}] }`. It is the record that tells the run's OWN debris from a
    // page somebody else owns, and that difference is what decides whether anything may be deleted: a later unit
    // removes what is on this list and touches nothing that is not. Nested shapes stay loose here for the same
    // reason every other nested object does — the serialized schema has a 4096-byte ceiling.
    appScaffold: { type: 'object' },
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
        // ENG-96458 D5 — `convincing` and `pageDefect` are TWO axes, not one. A judge that reads the built page to
        // rule on a record often finds a REAL gap in the page while doing it, and with one axis its only exit was
        // `convincing: false` — an evidence-formatting rejection. Measured: the judge wrote that the built grid
        // "has no selectionState, _selectionOptions, bulkActions or layoutConfig" — an actual parity defect it had
        // discovered — and filed it as "the diff was column-scoped", so the run spent two rounds re-writing a
        // record and never once built the missing props. `pageDefect` is `{ unit, what }`: the unit whose page
        // carries the gap and what is missing, in the judge's own words. It opens a build row.
        properties: { id: { type: 'string' }, convincing: { type: 'boolean' }, why: { type: 'string' },
          pageDefect: { type: 'object', additionalProperties: { maxLength: RECONCILE_TEXT_CAP } } },
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
    // ENG-96204 — the run-status document (`run-status.md`) is on disk. A SEPARATE answer from `written`, because
    // it is a separate file: a queue write that confirmed says nothing about the status document, and a stop whose
    // status never landed leaves an operator with a queue file and no explanation of it. Asked for only when this
    // step was handed a status to write, and its absence is a logged warning rather than a stop — the same status
    // is in the run's return either way.
    statusWritten: { type: 'boolean' },
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

// build-executor/schemas.mjs — the response contracts of the build run.
//
// ENG-95503 — the answers channel's design literals come from `helpers.mjs`: one declaration, read by the
// record-time cap AND by the bounds below. The generator drops this import (helpers is inlined ahead of this
// module); the module path, which Codex and the CLI use, needs it.
import { CARRY_TEXT_CAP, SHOWS_YES, SHOWS_NO, SHOWS_UNKNOWN, UNCONSUMED_FROM_VERIFIER, UNCONSUMED_FROM_DISPATCH } from './helpers.mjs'
//
// Structured output everywhere a later phase or the core COMPUTES on the answer; prose only in fields a human
// reads. A host without structured output cannot run this workflow at all, which is why `structuredOutput` is a
// REQUIRED capability rather than a degradable one.

// Mirrors the `--verify-json` FILE, field for field, plus the CLI's exit code and the PLAN-level
// stderr lines. Nothing else is allowed to reach the verdict — the reconcile agent copies that file,
// so this schema is a transport check, not a place where an agent's reading of a table gets in.
// ENG-95901 — `buildComplete` MUST be declared here, field for field with the engine's `verifyTally`/
// `verifyDigest` output: a structured-output schema constrains what an LLM transcribing the file will
// reproduce, so an UNDECLARED field is silently dropped on this agent-mediated path even though the engine
// genuinely writes it. Losing it here would make `state.verify[key].buildComplete` read `undefined` for
// every page in the live run — defeating `selfCheckMismatches`'s `verifierBuildComplete` (which would then
// read every page as "not build-complete" and false-flag an honest `buildComplete:true` self-report as
// `reported-complete-but-verifier-open`) — the exact regression this ticket exists to fix, reappearing
// specifically on the schema-constrained path that none of the hand-built-fixture tests below exercise.
export const VERIFY_RESULT = {
  type: 'object',
  required: ['complete', 'missing', 'unverified', 'pages'],
  properties: {
    complete: { type: 'boolean' },
    missing: { type: 'integer' },
    unverified: { type: 'integer' },
    // ENG-95901 (PR review) — the count that MATCHES `buildComplete`: how many open rows the builder owns. Declared
    // for the same reason `buildComplete` is: an undeclared field is silently dropped on the agent-mediated path.
    builderOpen: { type: 'integer' },
    planGaps: { type: 'array', items: { type: 'string' } }, // D12: non-empty ⇒ the PLAN is short, not the build
    pages: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        // `buildComplete` is REQUIRED, not merely typed: a DECLARED-but-optional property does not force an LLM to
        // populate it — only `required` does. Without this, the agent-mediated Reconcile path could still legally
        // transcribe a page as `{complete:false, unverified:3}` with `buildComplete` omitted, and `derivedBuildComplete`
        // would fall back to the combined `complete`, silently reintroducing the exact conflation this ticket fixes.
        required: ['complete', 'buildComplete'],
        properties: {
          complete: { type: 'boolean' },
          buildComplete: { type: 'boolean' },
          builderOpen: { type: 'integer' },
          missing: { type: 'integer' },
          unverified: { type: 'integer' },
          // Every row that is not ✅, as the engine emitted it: the same Deliverable / Status /
          // Evidence text the table shows. These are what the next build round is handed.
          openRows: {
            type: 'array',
            items: {
              type: 'object',
              required: ['deliverable', 'status', 'evidence'],
              properties: {
                n: { type: 'integer' },
                deliverable: { type: 'string' },
                status: { type: 'string' },
                evidence: { type: 'string' },
                outcome: { type: 'string' },
                // ENG-95901 (PR review) — WHOSE work closes the row: "builder" or "verifier". This, not the
                // `missing`/`unverified` label, is what `buildComplete` is keyed on and what the one bounded
                // in-context fix is allowed to act on.
                owner: { type: 'string' },
                id: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
}

export const PREFLIGHT_ITEM = {
  type: 'object',
  required: ['id', 'pageKey'],
  properties: {
    id: { type: 'string' },        // EXACTLY as `--units` published it
    pageKey: { type: 'string' },
    kind: { type: 'string' },
    item: { type: 'string' },
    requires: { type: 'array', items: { type: 'string' } },
    // THE OPERATOR'S ANSWER, as `--units.preflight[].resolution` published it. `null` is LEGAL and EXPECTED — the
    // engine publishes it on every unanswered item, and an object-only schema would force the agent to omit the
    // field instead, which cannot be told apart from an engine that publishes no answers at all.
    // An INPUT: Preflight files the record FROM it and the judge still rules on that record; it closes no row.
    resolution: {
      type: ['object', 'null'],
      required: ['answer'],
      properties: { answer: { type: 'string' }, decidedBy: { type: 'string' }, date: { type: 'string' } },
    },
  },
}

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
    // `preflightItems` is REQUIRED (PR #128 review, N1) with the same rationale: the two reconciles filter `unconsumed`
    // against `owedResolutionPairs(state.preflightItems, …)`, and the routing helper on an `undefined` list returns `[]`
    // rather than throwing — so an OMITTED list yields an empty owed set and silently ERASES every unconsumed answer,
    // which then reports `complete: true` over a lost answer. A required field turns the omission into a schema failure
    // the tool layer retries instead. `resolutionsReopened` and `resolutionsPending` are REQUIRED (N2) so a dropped
    // repair-grant set cannot silently re-grant a spent round.
    'targetPackage', 'packageState', 'evidenceIds', 'evidenceFiled', 'evidenceRejected',
    'preflightItems', 'resolutionsReopened', 'resolutionsPending'],
  properties: {
    // The APPROVAL PRECONDITION, as data. Prose in a prompt preamble is advisory; this is what
    // the script hard-stops on, and it stops on a VERSION MISMATCH too — an approval of plan v2
    // does not authorise building v3.
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
    // VERBATIM from `--units.planVersion` — the engine's own deterministic hash over the manifest inputs that
    // define the plan. NOT read out of `plan.md`, and never composed: `plan.md` is ENGINE-WRITTEN and presented
    // verbatim, so it carries whatever `--plan` printed and nothing an agent could add would survive a re-run.
    planVersion: { type: 'string' },
    unitKeys: { type: 'array', items: { type: 'string' } },        // `--units.pages[].key`, verbatim
    buildOrder: { type: 'array', items: { type: 'string' } },      // `--units.buildOrder`, verbatim (post-order)
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
    packageCreatedByRun: {
      type: ['object', 'null'],
      required: ['package', 'appUnitComplete'],
      properties: {
        package: { type: 'string' },
        appUnitComplete: { type: 'boolean' },
        planVersion: { type: ['string', 'null'] },
        sectionPage: { type: ['string', 'null'] },
      },
    },
    // ENG-95850 (B4/C3) — the orphans an EARLIER run or the other route recorded, read off
    // `build-queue.json`.`standWrites.orphanedPages`. Required for the record to do the job it exists for: the
    // incident it comes from was a LATER diagnosis reading a dead page, so a list this run writes but never reads
    // back is write-only and helps nobody. Merged as a UNION with what this process records (an orphan a previous
    // session found is still an orphan), never overwritten by it.
    orphanedPagesOnFile: {
      type: 'array',
      items: {
        type: 'object',
        required: ['schema'],
        properties: {
          schema: { type: 'string' },
          orphanedBy: { type: ['string', 'null'] },
          at: { type: ['string', 'null'] },
        },
      },
    },
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
    componentTypes: { type: 'array', items: { type: 'string' } },
    // ENG-95468 — the Reconcile agent's read-only `get-component-info` result for each `componentTypes` entry,
    // resolved against the TARGET stand: `{ type, resolved, note }`. This is what the pre-build component gate
    // (`componentTypeMismatches`) stops on — a type reported `resolved: false` is a plan assertion untrue of the
    // stand (a fabricated name, or a composite/component whose package/feature is not installed here). OPTIONAL:
    // an agent/plan that does not report it produces no component gate (absence is never read as a failure), so a
    // run that predates this field behaves exactly as it did before.
    // DEFERRED (ENG-95468 Scope, tracked as a follow-up — see the PR body): resolution is NOT yet checked BY KIND
    // (`component` / `composite` / `compositeOnly`) and the mapper's `FEATURE_CATALOG` does not yet carry a typed
    // `{ kind, id }` intent. Until it does, the stop cannot branch its guidance by cause (a type that is not a
    // component type at all vs a real component whose package/feature is un-installed), and the correct-target
    // half of the message depends on the free-text `note` the agent put here — its quality is agent-dependent by
    // design for now, not an engine-published fact.
    componentResolution: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'resolved'],
        properties: {
          type: { type: 'string' },
          resolved: { type: 'boolean' },
          note: { type: 'string' },
        },
      },
    },
    // `--units.templateNames`, VERBATIM — the deduped page TEMPLATE schema names this plan asserts (ENG-95468).
    // The plan's own published set, so it plays exactly the role `componentTypes` plays for components: only a name
    // the PLAN named may gate, and a resolution naming something else cannot manufacture a stop no re-plan can act on.
    templateNames: { type: 'array', items: { type: 'string' } },
    // ENG-95468 — the Reconcile agent's read-only resolution of each `templateNames` entry against the TARGET stand:
    // `{ name, resolved, note }`. Same shape, same rules and the same absence rule as `componentResolution`: only an
    // explicit `resolved: false` gates, an unreported name is not a failure, and a plan predating the field behaves
    // exactly as it did before. This is the axis the third Applicant run failed on — the plan named
    // `ListPageV2FreedomTemplate`, the page was built on `ListPageV3Template`, and nothing in between asked the stand.
    templateResolution: {
      type: 'array',
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
    // The environment's `SchemaNamePrefix`, read off the stand (ENG-95468). Load-bearing for the app/package
    // identity check: clio derives a new app's package as `SchemaNamePrefix + code`, so this is the ONLY thing that
    // makes "the plan's target package is producible here, and by exactly this code" decidable BEFORE `create-app`
    // writes. THE EMPTY STRING IS A REAL VALUE and is NOT the same as absence — a stand with no prefix is exactly
    // the case the third Applicant run hit (package == app code) — so `''` gates and `null`/absent does not.
    schemaNamePrefix: { type: ['string', 'null'] },
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
    reachability: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'appliesWhen'],
        properties: {
          key: { type: 'string' },
          appliesWhen: { type: 'boolean' },
          pages: { type: 'array', items: { type: 'string' } },
          what: { type: 'string' },
          miss: { type: 'string' },
        },
      },
    },
    // What the built file currently records for each reachability key: 'true' | 'false' | 'unset'.
    // Strings, not booleans, because the tri-state is the whole point (absent ≠ false).
    reachabilityState: { type: 'object', additionalProperties: { type: 'string' } },
    preflightItems: { type: 'array', items: PREFLIGHT_ITEM },
    // The two answer-channel repair-grant sets, read back off the queue file (PR #128 review, N2). Persisted
    // directly rather than derived from `unconsumedResolutions`, because the `!res` path files an unconsumed row
    // WITHOUT spending the grant, so the derivation mis-marked exactly those units and denied them their repair.
    // `resolutionsReopened` is per `(unit, id)` (round 7) and therefore an OBJECT array: the grant is per ANSWER,
    // because the "a second round is a loop" bound is about the question, not the page. `resolutionsPending` stays
    // a UNIT-key array — it feeds `reopenKeys()`, and what a round re-opens is a unit.
    resolutionsReopened: { type: 'array', items: { type: 'object', required: ['unit', 'id'],
      properties: { unit: { type: 'string' }, id: { type: 'string' } } } },
    resolutionsPending: { type: 'array', items: { type: 'string' } },
    // ANSWERS THAT MATCHED NO QUESTION, and questions answered TWICE through the two key forms. Carried because the
    // engine's stderr warnings are emitted inside this subagent and reach nobody, and either silence loses an answer
    // the operator believes is applied.
    // IDENTIFIERS ONLY — no `answer` text. An agent retypes every field of this into a tool call each round, and the
    // text is already in the operator's own file; naming which answer missed is the whole job.
    resolutionsUnmatched: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string' }, item: { type: 'string' } } },
    },
    resolutionsConflicts: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string' }, item: { type: 'string' } } },
    },
    evidenceIds: { type: 'array', items: { type: 'string' } },
    // Evidence ids with a filed record in `built.json` and NO `judge` entry — including records filed
    // in an earlier session or by the preflight phase. An unjudged record keeps its page open, and the
    // judge is only ever handed ids, so a record nobody names is a page that can never close.
    unjudgedEvidenceIds: { type: 'array', items: { type: 'string' } },
    // WHAT IS ALREADY ANSWERED, so Preflight does not re-derive it. `--units.preflight` is the plan's list of open
    // questions and says nothing about which have been resolved; without these two a resumed run re-ran the whole
    // fan-out over records that were already on file, and the merge would overwrite each one with the second
    // answer. Both are read off the built file, and both may be empty on a first run.
    evidenceFiled: { type: 'array', items: { type: 'string' } },     // ids whose `evidence[id]` is a RECORD object
    evidenceRejected: { type: 'array', items: { type: 'string' } },  // ids the judge ruled `convincing: false`
    // Keys whose `pages` entry already exists in `built.json` — a recorded object, or `false` for "checked,
    // genuinely not built". Absent or empty fetches every key. This is a REPORT, not a verified fact, and the only
    // thing that makes an over-report survivable is Reconcile's own all-keys sweep running every round regardless of
    // what Verify skipped: a wrongly-skipped page is re-read there, and its unit stays open until it is.
    pagesRecorded: { type: 'array', items: { type: 'string' } },
    // Parks already recorded in the queue file, WITH the reason each was parked for. A park is
    // terminal for the run that made it; a resumed run must not re-dispatch a full stand-writing
    // round for a unit its predecessor already gave up on and asked the user about.
    parkedUnits: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key'],
        properties: { key: { type: 'string' }, parkedWhy: { type: 'string' }, rounds: { type: 'integer' } },
      },
    },
    // Plan deviations, blockers and builder-vs-stand disagreements already in the queue file from an
    // earlier session. They seed this run's lists so a kill does not erase what a previous one recorded.
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        required: ['deviation', 'why'],
        properties: { unit: { type: 'string' }, deviation: { type: 'string' }, why: { type: 'string' }, applied: { type: 'boolean' } },
      },
    },
    blocked: {
      type: 'array',
      items: {
        type: 'object',
        required: ['what', 'why'],
        properties: { unit: { type: 'string' }, what: { type: 'string' }, why: { type: 'string' } },
      },
    },
    discrepancies: {
      type: 'array',
      items: {
        type: 'object',
        required: ['unit', 'claim', 'found'],
        properties: { unit: { type: 'string' }, claim: { type: 'string' }, found: { type: 'string' }, round: { type: 'integer' } },
      },
    },
    // ENG-95503 / PR #128 review -- ANSWERS AN EARLIER SESSION SAW REACH A BUILDER AND PRODUCE NOTHING. Read back
    // for the same reason `blocked` and `discrepancies` are, and it matters MORE than either: a well-formed decline
    // is the one outcome that leaves no row in either of those, so without this the record died with its process and
    // a resumed run reported `complete: true` over a dropped answer.
    unconsumedResolutions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['unit', 'id', 'source'],
        // `maxLength` on every free-text field (round 7): the run caps these at record time, so a value arriving
        // longer than the cap did not come from a compliant writer, and accepting it silently is how an oversized
        // row re-enters every later prompt. A schema failure is retried by the tool layer instead.
        properties: { unit: { type: 'string' }, id: { type: 'string' }, kind: { type: 'string' },
          item: { type: 'string', maxLength: CARRY_TEXT_CAP }, answer: { type: 'string', maxLength: CARRY_TEXT_CAP },
          why: { type: 'string', maxLength: CARRY_TEXT_CAP }, how: { type: 'string', maxLength: CARRY_TEXT_CAP },
          // `source` DECIDES WHETHER A ROW SURVIVES THE NEXT DISPATCH (round 9), so it is REQUIRED and CONSTRAINED.
          // As a free `string`, an ordinary transcription slip that dropped or misspelled it made a
          // verifier-confirmed contradiction read as dispatch-sourced, and the next untrusted `applied: true`
          // erased the independent record that exists to disbelieve it — the RC-2 defect arriving through the
          // schema instead of through the code.
          source: { type: 'string', enum: [UNCONSUMED_FROM_VERIFIER, UNCONSUMED_FROM_DISPATCH] } },
      },
    },
    // Queue drift. A key in the queue and not in `--units` means the plan was regenerated under
    // the run; trusting it silently builds a page nothing gates.
    staleQueueKeys: { type: 'array', items: { type: 'string' } },
    newKeys: { type: 'array', items: { type: 'string' } },
    verify: VERIFY_RESULT,
    exitCode: { type: 'integer' },
    // D12 — the PLAN-level legs of exit 2, each named by its own stderr line. Empty means the only
    // problem (if any) is `VERIFY INCOMPLETE`, which IS repairable on-stand.
    planGaps: { type: 'array', items: { type: 'string' } },
    roundOf: { type: 'object', additionalProperties: { type: 'integer' } },
    continuationOf: { type: 'object', additionalProperties: { type: 'integer' } },
    verifyTablePath: { type: 'string' },
    notes: { type: 'string' },
  },
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
      stillShortRows: {
        type: 'array',
        items: {
          type: 'object',
          required: ['deliverable', 'status', 'evidence'],
          // `outcome`/`owner` ride along so the tail cross-check can tell a builder-owned shortfall from a row the
          // builder was never allowed to close, without re-deriving what the engine already decided.
          properties: { deliverable: { type: 'string' }, status: { type: 'string' }, evidence: { type: 'string' },
            outcome: { type: 'string' }, owner: { type: 'string' } },
        },
      },
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
    // compares it against the builder's own `applied` claim and records where the two disagree. Not required — a
    // round with no answered items has nothing to report, and a verifier that could not fetch a page must not be
    // forced to invent a row about it; an absent row reads as unconfirmed, which is what it is.
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
        properties: { unit: { type: 'string' }, id: { type: 'string' },
          shows: { type: 'string', enum: [SHOWS_YES, SHOWS_NO, SHOWS_UNKNOWN] }, found: { type: 'string' } },
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
    unconsumedWritten: { type: 'array', items: { type: 'string' } },
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

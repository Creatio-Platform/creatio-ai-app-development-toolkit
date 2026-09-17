# Freedom UI Web → Mobile Page Conversion (conversion playbook)

The authoritative **process** playbook for the `creatio-mobile-page-conversion` skill: converting an existing
**Freedom UI web page** into a **Freedom UI mobile page** for the Creatio Mobile app. This is a targeted, implementation-ready
change: it does **not** require a full BA-style Business Plan (Gate R). It DOES require a blocking
approval gate — **Gate M** — between analysis and any write to Creatio: present a plain-language
**conversion plan** (what will be transferred, what will be adapted, what is unsupported), after
which the developer either **reviews/adjusts the details** or **approves**. Nothing is persisted
until the developer approves *after* seeing the plan.

**Layering — where each rule lives.** This playbook owns the PROCESS: the flow, the gates, environment
resolution, the plan/report format, and section registration. The body-building MECHANICS — how to turn
`guide.viewConfigDiff` and the guide's data-section diffs into a mobile page body (per-operation rules,
`values` paste-verbatim, adaptive/tab/normalization behavior, the paste-don't-rebuild data-section
rules) — are owned by the clio `freedom-page-web-to-mobile-conversion` guidance article (the ENGINE
layer), which stays in lockstep with the converter. Load that article once (Load order step 2) and
follow it for mechanics; this playbook does NOT restate them. If a mechanic and this playbook ever
disagree, the guidance article wins.

## When to use

The developer wants to make an existing Freedom UI web page available in the Creatio Mobile app
without re-creating it by hand in the Mobile Designer.

## Scope and precondition

- **Freedom UI only.** This handles Freedom UI WEB → Freedom UI MOBILE.
- It does **not** convert Classic UI pages. If the source is Classic UI, do not attempt mobile
  conversion: explain that the page must first be converted to a Freedom UI web page (a separate
  classic-web → freedom-web converter), and only then converted to mobile.
- The conversion is **model-driven and advisory-first**: a tool returns a deterministic guide; YOU
  build the mobile page body and persist it only after **Gate M**. Never silently drop content — be
  transparent about what maps directly, what is adapted, and what is unsupported.

## Executable contract

Resolve exact tool names / parameters through `get-tool-contract` (do not hardcode payloads).
The tools used in this flow:

- `get-mobile-page-conversion-guide` — **advisory only**: detects the source page type and returns a
  conversion guide. It builds NO body and writes NOTHING to Creatio or disk. It also surfaces
  `guide.requestConversions.missingTargetPages` (deduplicated `web-page` targets, each with `references[]`)
  and `guide.requestConversions.unresolvedTargetRequests` (per-request detail, including
  `entity-default-mobile-page` candidates with a `resolvedCandidateSchemaName`) — the data behind the
  "Missing target pages" plan/report items and the one-level-deep sequential-conversion offer in step 8a. A
  `web-page` target verified `missing` also gets its binding REMOVED (`bindingRemoved: true`), with the
  removed shape preserved on `originalBinding` for the repoint sub-step in 8a — see the "Requests (actions)"
  report bullet. **The tool reports candidate NAMES only and never classifies them** (no fixed read
  ceiling, no `resolvedSourceType` / `recommendedAction` field on the wire at all). There is no
  `existingMobileEquivalentSchemaName` field either — the guide never searched for an existing mobile
  equivalent, shipped or otherwise. YOU classify every distinct candidate yourself, including that search,
  before building the plan — see step 3a.
- `get-page`, `list-pages`, `find-entity-schema` — used in step 3a to classify each missing-target candidate
  (existence, source type, and whether an existing mobile equivalent already covers the same object) before
  the plan is built. Read-only, not gated.
- `list-page-templates` (schema-type `mobile`), `create-page`, `update-page`, `validate-page` — persistence.
  Thread `create-page`'s returned `schemaUId` into `update-page` as `target-schema-uid` (see step 7) so the
  body lands in the created schema instead of a replacing schema in the design package.
- `create-page-business-rule` — recreate the converted page-level business rules
  (`guide.pageBusinessRules.convertedRules[].rule`) on the mobile page. Only after Gate M.
- `get-component-info` (schema-type `mobile`) — full mobile component contract when the guide's
  inline `mobileContracts` entry is not enough.
- `odata-read` — read-only lookups of the current section/workplace state (`SysModule`, `SysWorkplace`,
  `SysModuleInWorkplace`). Use it WHILE building the plan (steps 4–5, before Gate M/S) to enumerate the
  real workplace options for the developer and avoid proposing a generic choice or creating a duplicate
  `SysWorkplace` later. It is read-only and is NOT gated. (`get-mobile-page-conversion-guide` already
  probes this state into `guide.sectionRegistration`; use `odata-read` for anything it did not cover.)
- `odata-update` / `odata-create` — section/workplace registration WRITES (set
  `SysModule.MobileSectionSchemaUId`; add `SysModuleInWorkplace`; create `SysWorkplace`). Only after Gate S.
- `create-related-page-addon` — for FORM pages: registers the converted mobile form page as the entity's
  default mobile edit page (`schema-type=mobile` with a single `is-default` page → `MobileRelatedPage`
  add-on). The same tool configures the WEB `RelatedPage` add-on (its default, `schema-type=web`). Only after Gate S.

Read `get-guidance` with name `freedom-page-web-to-mobile-conversion` before acting on the guide. This
is the SAME one-time load the SKILL Load order and Flow step 1 name — its content does not change
between calls, so load it once per run and reuse it; do not re-issue the `get-guidance` call in later
steps.

## Flow

This flow follows the steps below. Steps 1–6 are analysis and approval and write
NOTHING to Creatio. Persistence happens only after **Gate M** (step 6).

1. **Select the source page and resolve the environment.** Identify the Web page the developer wants
   in the Creatio Mobile app and the target **registered environment name** (Runbook 01 rules:
   registered environment name, never a raw URL). If not already loaded (SKILL Load order step 2), read
   `get-guidance freedom-page-web-to-mobile-conversion` ONCE here and reuse it for the rest of the run.
2. **Analyze the source page:** run `get-mobile-page-conversion-guide` with the source `schema-name`.
   It reads the page and returns the conversion guide. It writes nothing.
3. **Determine the source page type** from the returned `sourceType`:
   - **Classic UI / not `freedom-web`:** conversion STOPS here. Offer the developer a separate
     Classic UI → Freedom UI migration first (a dedicated classic-web → freedom-web converter — not
     part of this stage). Do NOT create, update, or validate anything in Creatio.
   - **Freedom UI (`freedom-web`):** continue — the guide already analyzed components, layout,
     fields, actions, and (detected) business rules.
3a. **Classify each missing-target candidate yourself, before building the plan.** The guide reports
   candidate NAMES only — there is no `resolvedSourceType` / `recommendedAction` field on the wire at all
   for `missingTargetPages[]` / `unresolvedTargetRequests[]` (it does not read the environment for
   this — no fixed read ceiling). There is no `existingMobileEquivalentSchemaName` field either — the
   equivalent search below is something YOU perform, not something the guide ever did. Skip this step entirely
   when both lists are empty. Otherwise, for every DISTINCT candidate name (dedupe `target` /
   `resolvedCandidateSchemaName` first — same grouping the "Missing target pages" plan section requires — AND
   ACROSS the two sources: a `web-page` row's `target` and an `entity-default-mobile-page` row's
   `resolvedCandidateSchemaName` that name the SAME schema are ONE candidate, not two, even though they came
   from different lists):
   - **`entity-default-mobile-page` candidate with NO `resolvedCandidateSchemaName` at all:** clio could not
     find the object's default WEB edit page either (both the mobile and the web `RelatedPage` add-ons came
     back empty) — but the OBJECT name (`target`) is still known. **Do not jump straight to
     `manual-candidate-not-found`.** Run the "Existing mobile equivalent" search below keyed on the OBJECT
     name directly (skip the `get-page`-on-a-page-name step — `target` here is an object name, not a page
     schema name, so there is nothing to read yet). A confirmed mobile match → `redirect-to-existing-mobile`.
     Nothing found → `manual-candidate-not-found` — an empty add-on is a fact about the add-on, not proof no
     mobile page exists anywhere for the object, so the equivalent search must run before giving up on it.
   - **Existence + source type** (every other candidate — a `web-page` `target`, or an
     `entity-default-mobile-page` candidate whose `resolvedCandidateSchemaName` IS set): call `get-page` with
     that `schema-name`. A schema-not-found error means no web page exists at all — classify
     `no-web-page-exists` (nothing to offer converting). Otherwise read the response `sourceType`:
     `freedom-web` → `convert-directly`; `mobile` → `skip-already-mobile`; anything else (Classic UI,
     unrecognized) → `convert-classic-first`. Any other read failure (transport, auth, unreadable body) →
     `manual-candidate-not-found` — never guess.
   - **Existing mobile equivalent** — runs for a candidate you are about to classify `convert-directly` /
     `convert-classic-first`, AND (per the first bullet above) directly by object name for an
     `entity-default-mobile-page` candidate with no `resolvedCandidateSchemaName` at all. `skip-already-mobile`
     / `no-web-page-exists` never reach this check — they have nothing to redirect. Use `find-entity-schema` /
     `list-pages` to check whether the object already has a mobile page under a different name — look at its
     actual mobile pages rather than guessing one fixed naming pattern. Confirm any match's `sourceType` is
     exactly `mobile` via `get-page`: **a same-named/suffix-matched CLASSIC UI schema counts as NO existing
     mobile equivalent**, not a match — the Creatio Mobile app cannot open a Classic UI page any more than it
     can open a web one. A confirmed mobile match sets/overrides the classification to
     `redirect-to-existing-mobile`; carry its schema name forward.
   - **One read per distinct name.** Two rows sharing the same `resolvedCandidateSchemaName` (or `target`)
     resolve to ONE classification, reused for both.
4. **Generate the conversion plan.** From the guide, produce a SHORT, plain-language plan — NOT
   technical detail. Lead with the Beta-release notice (see "Conversion plan" below) — verbatim at the
   very top. Then state: what will be transferred, what will be adapted (e.g. *"grid → mobile
   list"*, *"checkbox → toggle"*), what is unsupported / will be dropped, what needs a decision, the
   recommended mobile template, and the section/workplace registration intent. For each unsupported /
   manual-decision item use this message shape: *"Component X is not supported in Freedom UI Mobile
   Designer. Recommended action: replace it with Y, or configure this part manually."* Keep
   decisions at the level of *what to do* (replace with Y / do manually / skip) — do NOT resolve
   `crt.List` `itemLayout` columns, `mobileContracts`, or `get-component-info` here; that happens
   only after approval (step 7).
5. **Present the conversion plan (preview/summary)** — the plain-language plan (see "Conversion plan"
   below). No JSON, no page body, no per-property detail. Read-only; nothing is persisted yet.
6. **Gate M — Mobile Conversion Approval (HARD STOP).** After the plan, offer the developer two
   choices — **View details / Adjust** or **Approve** (see the gate rules below). Do NOT run
   `create-page`, `update-page`, `validate-page`, or `create-page-business-rule` until the developer
   approves.
7. **Create or update the Freedom UI Mobile page** (only after Gate M):
   - **Before building the body:** first call clio `get-guidance mobile-page-modification` — the
     platform-mandated mobile authoring guidance (mobile component registry, body constraints, Scaffold
     inheritance rules); `../../context/essentials.md` requires it before editing ANY mobile page body.
     Then **invoke the `creatio-ui-guidelines` skill** (per the skill Load order) and apply its
     mobile-relevant rules (component choice, lookups, fields, captions, tooltips, accessibility); run its
     review checklist before step 8. The `values` paste is mechanical, but `create-page`/`update-page`
     still author a Freedom UI page body, so both the `mobile-page-modification` guidance and the UI/UX
     checklist apply.
   - Create the page from the confirmed `recommendedMobileTemplate` (confirm via `list-page-templates`
     schema-type `mobile`) with `create-page`, unless it already exists. Naming convention:
     `<Entity>_MobileFormPage` / `<Entity>_MobileListPage` (no prefix in the plan — clio applies the
     environment SchemaNamePrefix). The mobile template provides the Scaffold root — never add a
     second Scaffold.
   - **Capture the `schemaUId` from the `create-page` result and pass it as `target-schema-uid` on EVERY
     subsequent `update-page` call** (body, `resources`, adaptive diffs — and re-use it for `get-page`).
     This is REQUIRED: without it, when the chosen package is not the app's design package, `update-page`
     resolves the design package and writes the body as a REPLACING schema there — leaving the just-created
     mobile schema EMPTY. The Creatio Mobile app loads that empty schema and crashes, and you end up with two
     same-named schemas. `create-page` returns `willCreateReplacingInDesignPackage: true` + `designPackageUId`
     when this split would happen — but pass `target-schema-uid` unconditionally so the body always lands in
     the one schema `create-page` made. (If the page already exists, get its UId via `list-pages`/`get-page`
     and pass it the same way.)
   - **Build the mobile body from `guide.viewConfigDiff`** — it IS the mobile page's `viewConfigDiff`,
     already in the applier's shape: apply the operations IN ORDER, `merge` and `insert` and no others.
     An element that did NOT convert is not in it at all; it is in `guide.droppedElements` with a coded
     reason, to report and never to apply. Do NOT re-derive placement from
     `containerMap` + `componentSuggestions`. **The MECHANICS of every operation are owned by the
     `freedom-page-web-to-mobile-conversion` guidance article (Load order step 2) — follow it field-by-field
     and do NOT restate those rules here.** In brief, so you know what to expect: paste
     `viewConfigDiff[].values` VERBATIM — the value binding is already in there under `control`, so there
     is nothing to add — and register `guide.resourceStrings`
     in one `update-page resources` call; and paste `guide.modelConfigDiff` / `guide.viewModelConfigDiff`
     VERBATIM (paste, don't rebuild — never source data-section attributes from a pre-existing body). The
     list-row, tabbed-page ordering, adaptive-layout, tab-body/Area, normalization, and data-section-diff
     details all live in the article. Persist the body and data sections with `update-page` (always with
     `target-schema-uid=<create-page schemaUId>`, per the create-page step).
   - Run `validate-page` and resolve findings before treating the page as done (undeclared bindings, a
     lookup-path attribute missing its `type`, a field missing its caption `label`). It is the backstop
     that blocks the save when a required property was dropped — the article details what it enforces.
   - **Adaptive layout** — when `guide.adaptiveLayout` is present, state it at the gate as what the
     conversion DID (see "Conversion plan"). Both the container columns and each child's placement are
     ALREADY in the `values` you pasted — there is NO separate diff to apply, and no mechanism to decline
     it: a different layout is an edit to those `values` before pasting. `guide.adaptiveLayout` is a
     readable index of them; the article owns the field's shape.
7b. **Register the mobile page** — only after **Gate S** (see below). The bullets below are independently
   conditional, NOT all gated on one flag: the section + workplace bullets apply only when
   `sectionRegistration.sourcePageIsSection` is true (a form/edit page is NOT a section — skip those two
   for it), and the default-mobile-edit-page bullet applies only when `sectionRegistration.isFormPage` is
   true. Skip 7b entirely only when the user declined or none of these conditions holds. Use the
   `guide.sectionRegistration` facts and `registrationActions`:
   - **Make the section mobile** (only when `sourcePageIsSection` is true): `odata-update` `SysModule` id = `sectionRegistration.sysModuleId`,
     data `{ "MobileSectionSchemaUId": "<new mobile list page schema UId>" }`, `confirm=true`. Get the
     new page's schema UId from the `create-page` result / `get-page`.
   - **Workplace (user's choice):** add the section to the chosen workplace with `odata-create`
     `SysModuleInWorkplace` `{ SysModuleId, SysWorkplaceId, Position }`; to create a new mobile
     workplace first `odata-create` `SysWorkplace` `{ Name, SysApplicationClientTypeId: <Mobile>, Position }`.
   - **Default mobile EDIT page** (only when `isFormPage` is true — independent of `sourcePageIsSection`): register the converted mobile form page as the object's
     default mobile card with `create-related-page-addon` (`environment-name`, `package-name`,
     `entity-schema-name`, `schema-type=mobile`, and `pages` = a single entry
     `{ page-schema-name, is-default: true }`). It writes the `MobileRelatedPage` add-on into the package
     (must be editable) and REPLACES the object's mobile related-page configuration with that default page.
7c. **Recreate page-level business rules** — only after Gate M, and only if
   `guide.pageBusinessRules.convertedRules` is non-empty. The guide already applied the conversion logic
   (how page rules convert is owned by the guidance article). For each `convertedRules[]` entry, pass its
   `rule` VERBATIM to `create-page-business-rule` (`environment-name`, `package-name`,
   `page-schema-name = <the new mobile page>`, `rule`). Report any `droppedRules[]` to the developer with
   their coded reason (not transferred). Every `reason` the guide returns — on a dropped element, a
   request binding, a business rule or a skipped normalization — is a LIST of `{code, params?}`, never a
   sentence: branch on `code` and get the wording from `get-guidance name=freedom-page-mobile-reason-codes`.
   Object-/entity-level business rules are shared across web and mobile — do NOT touch them.
8. **Deliver the conversion report** (see below) — as ONE complete message, only once 7b and 7c are
   fully resolved (Gate S answered — approved, declined, or skipped — and business rules recreated or
   reported). Do NOT send a partial report before Gate S resolves and a separate summary afterward: the
   report's "Section registration outcome" and "Missing pages" bullets need the Gate S answer and the
   deduplicated missing-pages list to already be in hand, so gather them first, then deliver the report once.
8a. **Offer sequential conversion of the missing target pages — one level only.** Only when the CURRENT
   page is the original page the developer asked to convert (not itself a step-8a follow-up) and its
   step 8 report's "Missing pages" list is non-empty. Ask the developer once, **after** the complete
   step 8 report (a separate question, never bundled into the same prompt as the Gate S question from
   step 7b), whether to convert them now. If they decline or give no answer, stop here — do not re-offer
   later in the same run.
   - **A follow-up page never gets its own step 8a.** A page converted through this step runs the full
     flow from step 1 through its own step 8 report, but that report's own "Missing pages" list is
     reported ONLY — never offered for further sequential conversion, no matter how many candidates it
     names. This caps the offer at one level of depth: it can only fire for gaps the ORIGINAL page named,
     never for gaps a follow-up page introduces. If the developer wants a follow-up's own missing pages
     converted too, that is a new, separate conversion request — say so in the follow-up's step 8 report
     instead of prompting again.
   - **Route by the classification from step 3a first:** offer `convert-directly` candidates for this same
     flow; for `convert-classic-first` candidates, point the developer at the separate classic-web →
     freedom-web converter instead of silently skipping them (this flow still does not perform that
     migration); skip `skip-already-mobile` and `no-web-page-exists` entries entirely (nothing to offer);
     for `redirect-to-existing-mobile`, tell the developer the object already has a mobile page under a
     different name and offer repointing the binding to it instead of converting a new one (mechanics: the
     "Repoint the referencing page(s)" sub-step below); for
     `manual-candidate-not-found` (step 3a already tried the equivalent search by object name too, when there
     was no `resolvedCandidateSchemaName` to begin with — this is a genuine dead end), tell the developer no
     candidate could be resolved automatically and ask them to supply one or decline it.
   - **Offer the DEDUPLICATED report rows, not raw `unresolvedTargetRequests`.** The "Missing target pages"
     report list already collapsed every `entity-default-mobile-page` row sharing the same
     `resolvedCandidateSchemaName` (or `target`, when unresolved) into one candidate — offer from that
     list. If you ever build the offer directly from `unresolvedTargetRequests` instead of the report,
     group it the same way first: two buttons creating the same missing object must produce exactly ONE
     offer, never two.
   - **Strictly one page at a time.** On acceptance, take candidates one by one. Each one runs the
     **full flow from step 1** (its resolved page name as the new source, re-resolving the environment if
     it differs) through **Gate M**, the build, **Gate S** (if applicable), and its own step 8 report —
     completed or explicitly declined — **before the next candidate starts.** Never batch, parallelize, or
     pre-approve more than one missing-page conversion at once; Gate M stays "scoped to a single page"
     (see below) for every one of these, exactly as for the original page.
   - **Repoint the referencing page(s) once a `web-page` target resolves.** This applies ONLY to a
     `web-page` candidate whose binding was actually removed (`bindingRemoved: true` on the finding) —
     `convert-directly` once its own step 8 report lands, or `redirect-to-existing-mobile` as soon as the
     developer accepts it (no new page build needed there). An `entity-default-mobile-page` candidate needs
     NO repoint: its request is scoped by `entityName`, not a page name, so registering the object's default
     mobile page via `create-related-page-addon` (step 7b) makes the existing binding work again on its own.
     For a `web-page` target, for EVERY entry in its `missingTargetPages[].references[]` (each carries its
     own `originalBinding` — do not mix one reference's binding into another's repoint, even when several
     reference the same target): `get-page` the page that carries `elementName` (with its `target-schema-uid`
     for `update-page`, same rule as step 7), clone that reference's `originalBinding`, replace only its
     `params.schemaName` with the RESOLVED mobile schema name (from `create-page`'s result for a fresh
     conversion, or from the confirmed match for `redirect-to-existing-mobile` — never a guessed naming
     pattern), set it back onto the element's `binding` property, then `update-page` and `validate-page`.
     This is itself a write to an ALREADY-converted page and needs no separate Gate M — the developer already
     approved it by accepting this candidate — but report the outcome, per reference, in that page's own
     step 8 report (see the "Missing pages" report bullet below). **Known limit:** `references[]` only
     covers elements on the page the CURRENT guide call analyzed; if an EARLIER page in this same session
     also named this exact target, its own binding needs the same repoint too — track every removed
     `web-page` binding (page, `elementName`, `binding`, target) you have seen so far in this session, not
     just the current page's list, so a target resolving late still reaches every page that named it.
   - **Session-level dedup.** If a later candidate (from this page or an earlier follow-up) names a target
     already converted, queued, or declined earlier in this same working session, do not offer it again —
     reference the earlier outcome instead of repeating the offer.
   - **Telemetry:** each accepted follow-up page still emits its own `work_item_completed` `variant=page`
     (and `variant=section` if it also passes its own Gate S) — the same as the first page. The whole
     chain (the original page plus every accepted follow-up) stays inside the ONE
     `workflow_started`/`workflow_completed` pair opened for this run; see `SKILL.md`'s telemetry table.
9. **Hand off.** Tell the developer to open the result in **Freedom UI Mobile Designer** for review
   and manual refinement. (If step 8a converted follow-up pages, this covers all of them, not just the
   original page.)

### Gate M — Mobile Conversion Approval (HARD STOP)

Persistence to Creatio (`create-page`, `update-page`, `validate-page`, `create-page-business-rule`)
is FORBIDDEN until this gate passes. Gate M is analogous to Gate R, scoped to a single page.

- **Two choices after the plan.** Once the plain-language plan (step 5) is shown, offer exactly two
  actions:
  - **View details / Adjust** — drill into the specifics on request (the full component mapping, the
    proposed `crt.List` columns, `mobileContracts`) and/or change a decision (template, column set,
    how an unsupported item is handled, target name/package, workplace). Any adjustment regenerates
    the plan and re-presents it. **Nothing is persisted; the gate is NOT passed.**
  - **Approve** — an explicit go-ahead given as a separate response AFTER the plan. Only this passes
    the gate.
- **Always mandatory.** The gate applies on every run, even when the source task looks complete and
  already contains decisions for every open item.
- **The initial task message is NOT a confirmation.** A Jira description or the user's first message
  (e.g. *"convert Leads_ListPage to mobile, no form page, as a section"*) states the *request*, not
  approval of the plan. Confirmation (canonical step 6) is ONLY a separate user response given AFTER
  the preview/summary (step 5) has been shown. Answers to the open questions in step 4 are input to
  the plan, NOT gate approval.
- **No skipping in autonomous / headless mode.** If you cannot get an interactive answer, you must
  still produce the preview/summary, ask for confirmation (`AskUserQuestion` or in text), and END THE
  TURN without persisting anything. Never self-approve.
- **Applies per page, including step 8a follow-ups.** Converting a missing target page (step 8a) is a
  new run of this same flow, not an extension of the page that just finished — it gets its own plan and
  its own Gate M. A developer accepting the sequential-conversion OFFER is not pre-approving any
  individual page's plan; never treat that acceptance as Gate M for the pages that follow.

### Gate S — Section Registration Approval (HARD STOP)

Registering the converted page as a mobile section is a SEPARATE, opt-in decision the developer must
make. Section/workplace writes (`odata-update` on `SysModule`, `odata-create` on `SysModuleInWorkplace`
/ `SysWorkplace`) are FORBIDDEN until this gate passes. The same rules as Gate M apply:

- **The decision to register the section is always the user's.** Never register a section just because
  the source request mentioned "as a section" — that is the request, not approval of the registration plan.
- **Confirmation comes after the preview.** Present the section-registration intent from the
  conversion plan (is it a section? which workplace — existing mobile one, a new one, or skip?) and
  wait for an explicit answer.
- **No skipping in autonomous / headless mode.** Show the registration plan, ask, and END THE TURN
  without any `odata-*` write if you cannot get an answer.
- Section registration runs in step 7b, AFTER the mobile page exists (its schema UId is required).
- **Resolve this gate BEFORE step 8.** Ask and resolve Gate S as its own interaction, before the step 8
  conversion report and before the step 8a follow-up-page offer — never bundle the Gate S question with
  the step 8a offer in one prompt, and never deliver the step 8 report while Gate S is still unanswered.
  The report's "Section registration outcome" line must already state the final answer (registered /
  declined / skipped), not "pending."

### Conversion plan (what step 5 must show)

Show a SHORT, plain-language plan — no JSON, no page body, no per-property detail. Cover:

- **Beta-release notice (show FIRST, verbatim)** — print this notice at the very top of the plan,
  before anything else, exactly as written (do not paraphrase or drop it). Print it as a PLAIN
  paragraph: no blockquote, no leading `>` — terminals whose font lacks the quote bar draw it as a
  missing-glyph box on every wrapped line of the notice. It is temporary and names the feature it
  applies to — converting a **web Freedom UI page** into a **mobile Freedom UI page**:

  ⚠️ You are using the **web-Freedom-page → mobile-Freedom-page conversion** in **Beta mode**: some functionality may be limited or subject to change, and the Converter currently supports the **Mobile canvas** only — Tablet support is on the roadmap and will be available in a future release.

  (The separate "enabling this feature activates Beta mode" heads-up is shown by clio at the moment the
  `mobile-page-converter` feature is enabled, not here.)
- **Target** — the registered environment, the target page name (**with the environment
  `SchemaNamePrefix`**), the recommended mobile template, and the target package (propose one; the
  developer makes the final choice).
- **What will be transferred** (`directMapping`) — by name or group, in plain words.
- **What will be adapted** (`withAdaptation` / `alternativeAvailable`) — e.g. *"grid → mobile list"*,
  *"checkbox → toggle"*.
- **What is NOT supported / will be dropped** — e.g. Dashboards, Summaries, bulk actions. State it
  explicitly (this bucket takes the step-4 message shape).
- **Needs a decision** (`requiresManualDecision`) — the items awaiting the developer's call.
- **Missing target pages** — from `guide.requestConversions.missingTargetPages` (deduplicated `web-page`
  targets) plus the verified-`missing` `entity-default-mobile-page` entries in `unresolvedTargetRequests`
  (skip `unknown` ones here — they are reported, not queued). **Deduplicate the `entity-default-mobile-page`
  entries yourself before listing them.** Unlike `missingTargetPages`, clio does NOT deduplicate this kind:
  it emits one `unresolvedTargetRequests` row per BUTTON, so two buttons creating the same missing object
  produce two rows sharing the same `resolvedCandidateSchemaName` (or the same `target` object name when
  none resolved). Group those rows — by `resolvedCandidateSchemaName` when it is set, otherwise by
  `target` — and combine every `elementName` that referenced the group into one candidate row, the same
  shape `references[]` already gives you for a `web-page` target. **Then merge ACROSS the two sources**:
  clio never checks whether a `web-page` target's schema name coincides with an `entity-default-mobile-page`
  candidate's `resolvedCandidateSchemaName` — if it does (a direct `crt.OpenPageRequest` on a page that also
  happens to be some object's default mobile edit page), they name the SAME missing page and must become
  ONE row with the combined `references[]`, not two rows offering the same conversion twice. List every
  remaining DISTINCT candidate the guide could not find while analyzing this source page's action bindings.
  For each: the target name
  (the resolved web edit page, `resolvedCandidateSchemaName`, for an `entity-default-mobile-page` target —
  or the raw object name when no candidate could be resolved), which buttons/requests reference it
  (`references[]`, or your combined `elementName`s for the entity case), and the recommended next step from
  YOUR OWN classification (step 3a — there is no `recommendedAction` field on the wire; the guide never
  classifies a candidate):
  `convert-directly` (already Freedom UI web, ready for this same flow), `convert-classic-first` (Classic UI
  or unrecognized source — needs a classic→freedom migration first), `skip-already-mobile` (already has a
  mobile page under this same name — nothing to propose), `redirect-to-existing-mobile` (an object's mobile
  page already exists under a DIFFERENT name — name it and offer repointing instead of converting a new
  page), `no-web-page-exists` (confirmed absent — nothing to offer), or `manual-candidate-not-found` (the
  read failed or no candidate resolved — flag it for the developer's own decision). This is informational
  here — do NOT propose converting anything yet; the sequential conversion OFFER happens after the report,
  in step 8a.
- **Section registration intent** (from `guide.sectionRegistration`) — whether the page is a section
  and whether it would be made available in mobile, and in which workplace (existing mobile one, a new
  one, or skip); for a FORM page, whether to register it as the entity's default mobile edit page
  (via `create-related-page-addon` with `schema-type=mobile`). The actual decisions are taken at **Gate S**. If
  `sectionRegistration.probeOk` is false, say the environment could not be queried and registration
  must be verified manually.
- **Adaptive layout (per-screen)** — when `guide.adaptiveLayout` is present, state it in plain words:
  *"the fields in `<container>` will stack in one column on a phone and show 2 columns on a tablet."* State it
  as what the conversion DID, not as something to accept or decline: both the container columns and each
  child's placement are already in the pasted `values`, there is nothing separate to apply, and there is no
  mechanism to honour a refusal. A different layout is an edit to those `values` before pasting.
- **Other guide-surfaced facts to state** — if the guide reports a converted-tab body structure
  (`guide.tabAreaLayers`) or normalized properties (`guide.normalizations`), state each as ONE aggregated
  plain-language line. Per the guidance article these are FACTS to report at the gate, not decisions — never
  offer to skip them. Omit when the field is absent.
- **Manual follow-ups** — page-level business rules are converted in `guide.pageBusinessRules` and
  re-created in step 7c; `droppedRules` (no surviving action) remain manual. Requests: supported ones are baked
  into `values` (`guide.requestConversions`); a `crt.Button` whose request the mobile app does not support is
  DROPPED (a `guide.droppedElements` entry) while any OTHER component type survives and only loses or keeps
  its binding — list both, they are different reports. Plus mobile manifest /
  wizard registration. (The default mobile edit page is now automated via `create-related-page-addon` with `schema-type=mobile`.)

Keep it skimmable. **On request (View details / Adjust)** — only if the developer asks to see more or
to change something — surface the technical detail: the full component mapping table, the proposed
`crt.List` columns for the `itemLayout`, and the relevant `mobileContracts` (or `get-component-info`,
schema-type `mobile`). Do NOT dump these in the default plan.

### Conversion report (step 8)

After `validate-page`, and after Gate S has an answer and 7c has run, deliver ONE report (not a partial
one followed by a later summary):

- **Created/updated:** the mobile page schema, the package, and the environment.
- **Actually transferred / adapted / dropped:** the real outcome per component (not just the plan).
- **Data sections:** `modelConfig` applied verbatim (every attribute kept all of its declared properties)
  and `viewModelConfig` applied (attributes of dropped components removed); note any custom converter
  flagged for manual review.
- **Section registration outcome:** whether `SysModule.MobileSectionSchemaUId` was set (and on which
  section), which workplace the section was added to (or a new one created), whether the default mobile
  edit page was registered (`MobileRelatedPage` via `create-related-page-addon`) for a form page, or
  that registration was skipped/declined.
- **Page-level business rules:** which `convertedRules` were recreated on the mobile page
  (`create-page-business-rule`) and which `droppedRules` did not convert.
- **Requests (actions):** from `guide.requestConversions`, which has FOUR collections and you need all of
  them — `convertedRequests` (carried, remapped where the mobile name differs), `droppedRequests` (a binding
  lost, INCLUDING on a component that stayed on the page), `flaggedRequests` (an unknown request kept for
  you to verify) and `unresolvedTargetRequests` (the action's navigation target could not be confirmed —
  read `state` AND `bindingRemoved` together, they answer different questions). `bindingRemoved: true`
  happens ONLY for a `web-page` target (`crt.OpenPageRequest`) verified `missing`: the binding is already
  gone from `viewConfigDiff[].values` and duplicated in `droppedRequests` under `drop-request-target-missing`
  — do NOT re-add it as-is, it would fail every time (an empty `schemaName` still shows a settings-error
  dialog). The finding's `originalBinding` keeps the removed `{ request, params }` VERBATIM (every param,
  not just `schemaName`) for the repoint step below. Every other combination (`entity-default-mobile-page`
  of any state, or `unknown`) keeps `bindingRemoved: false` and the binding untouched — an add-on read or an
  unreachable environment is never proof enough to strip a working action. A
  `crt.Button` whose request is unsupported was **dropped entirely** (a `guide.droppedElements` entry whose
  coded reason names the request) — list those removed action components for the developer.
- **Missing pages:** the same deduplicated list from the plan (`missingTargetPages` + verified-`missing`
  `entity-default-mobile-page` targets), each with the next step from YOUR OWN step 3a classification (there
  is no wire `recommendedAction` to copy from). On the ORIGINAL page's report,
  state whether the developer accepted the step 8a offer to convert them, and for each accepted target:
  queued / converted (its own report lands when its turn finishes) / declined / still open (the session
  ended before its turn). If the offer was declined entirely, say so once and skip the per-page detail.
  For every **`web-page` target that resolved** (converted now, or matched to an existing mobile page under
  `redirect-to-existing-mobile`), also state the **repoint outcome** — see step 8a's repoint sub-step: which
  `elementName`s got their action restored, and any that could not be (report the failure, never leave it
  silent). An `entity-default-mobile-page` target needs no repoint report line: registering its default
  mobile page is the whole fix, nothing on the source page changes.
  On a **follow-up page's own report** (converted via step 8a), list this same list but say it is
  reported only, not offered — no step 8a runs for a follow-up's own missing pages (see step 8a above);
  tell the developer they can ask for those to be converted as a separate, new request.
- **Adaptive layout:** from `guide.adaptiveLayout` — which containers got a per-screen layout (stack on
  phone, N columns on tablet). Both sides were already applied via the pasted `values`; it is a report,
  not a decision.
- **Converted-tab body / normalized properties:** if the guide reported `guide.tabAreaLayers` or
  `guide.normalizations`, state each as one aggregated line (what standard was applied where).
- **Remaining manual steps:** dropped business rules, dropped action components (a `crt.Button` whose
  request the mobile app does not support is removed from the page entirely — a `droppedElements` entry,
  not a "flagged" component that stayed on the page), mobile manifest / wizard registration, and any
  `requiresManualDecision` items still open.
- **Hand off** to Freedom UI Mobile Designer (step 9) for final layout review and manual refinement.

## Mobile constraints (carry into every step)

These are the invariants to keep in mind across the flow. The full body-building MECHANICS behind them
live in the `freedom-page-web-to-mobile-conversion` guidance article — do not restate them here.

- Mobile body is plain JSON: `viewConfigDiff` / `viewModelConfigDiff` / `modelConfigDiff` only — no
  `handlers`, no `validators`, no custom `converters`. Page `handlers` (web-only AMD) are NEVER transferred.
- **Page-level business rules ARE converted** in `guide.pageBusinessRules`; recreate each
  `convertedRules[].rule` verbatim with `create-page-business-rule` on the mobile page (step 7c).
  **Object-/entity-level business rules are shared** across web and mobile — do NOT touch them.
- **Requests, adaptive layout, tab bodies, and normalized properties are handled by the converter** and
  already in `guide.viewConfigDiff[].values`; the advisory summaries live on the guide
  (`guide.requestConversions`, `guide.adaptiveLayout`, `guide.tabAreaLayers`, `guide.normalizations`).
  Present them at the gate as FACTS (see "Conversion plan") — every one is already in the `values`, so none
  of them is a proposal to accept or decline; the article owns how they apply.
- One data source per page. If the web page used several (see `guide.dataSources`), keep only the primary one.
- Apply the data sections by pasting `guide.modelConfigDiff` / `guide.viewModelConfigDiff` verbatim — never
  reconstruct attributes by hand and never source them from a pre-existing body (the article explains why).
- Mobile layout is a simplified vertical flow; complex desktop layout may need manual adaptation.

## Limitations (be transparent)

No guarantee of pixel-perfect or behavior-perfect migration. The guarantee is a deterministic
guide: recommended template, container correspondence, classified components, and mobile contracts.
The result is a starting point the developer finishes in Freedom UI Mobile Designer.

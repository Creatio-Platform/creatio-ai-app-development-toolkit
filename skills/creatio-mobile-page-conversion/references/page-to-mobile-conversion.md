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
  `guide.requestConversions.missingTargetPages` (deduplicated across BOTH `web-page` and
  `entity-default-mobile-page` targets, each with `references[]`) — the data behind the "Missing target
  pages" plan/report items and the one-level-deep sequential-conversion offer in step 8a — and
  `guide.existingMobilePages` (any mobile page(s) already covering the entity/page being converted), the
  data behind the reuse-vs-convert check in step 2a. A `web-page` target verified `missing` KEEPS its
  binding on the element (`bindingRemoved: true` here means only "the target param was blanked", never
  "the binding is gone") — the request still converts, only its target param (`params.schemaName` for
  `crt.OpenPageRequest`, the only `web-page`-kind request today) is cleared to `""`. There
  is no `originalBinding` field: the repoint sub-step in 8a patches the target param on the existing
  binding in place — see the "Requests (actions)" report bullet.
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
2a. **Check for an existing mobile equivalent.** Several signals, none alone complete — run all that
   apply before concluding "no equivalent exists":
   - **Registration (`guide.existingMobilePages`).** If the entity/page being converted already has a
     mobile page REGISTERED to it (an entity's default mobile edit page, or a section's mobile
     binding), it is reported here. This check runs the same way every time this flow is entered,
     including on every step 8a follow-up re-entry — it is a fact the guide reports, not a search you
     perform by hand. It is registration-based and CANNOT see an orphaned mobile page — one converted
     earlier that was never wired to anything (no button binding, no entity-default-mobile-page
     registration, no section binding).
   - **Entity content match — the primary signal for an orphan.** Resolve the source page's primary
     entity (`guide.modelConfig.dataSources[guide.modelConfig.primaryDataSourceName].config.entitySchemaName`).
     Then find every mobile page bound to that SAME entity, regardless of name: `list-pages` scoped to
     the known mobile/target packages, filtered client-side to a `parentSchemaName` from the mobile
     template family (`BaseMobilePageTemplate`, `MobilePageWithTabsFreedomTemplate`,
     `BaseMobileListTemplate`), then `get-page` each candidate and read its own
     `modelConfigDiff` → `dataSources[...].config.entitySchemaName`. Any match is a real candidate,
     independent of what the page is named. This is the ONLY signal that reliably catches an orphaned
     page the developer gave an arbitrary custom name (e.g. a mobile page named `Apple`): a
     name-pattern search can never find it, because there is no lexical relationship to search for.
   - **Name-pattern search is a cheap FIRST pass, never proof of absence.** A `list-pages`
     `search-pattern` built from the source schema name (e.g. `*<SourceName>*`) is fast and catches the
     common same-convention case, but an empty result proves nothing — it only means nothing matched
     that one guessed pattern. Never conclude "no existing mobile equivalent" from this alone; the
     entity content match above is the check that must come up empty too before you stop looking.
   - **Disambiguate when the entity match returns MULTIPLE candidates.** A record's own default mobile
     page and any number of auxiliary/mini pages (e.g. an action page like "escalate" or "reclassify")
     can all share the SAME primary entity — entity alone does not tell them apart. When more than one
     candidate shares the entity, narrow by name correlation to the specific SOURCE page (not just the
     entity) and by comparing the field/attribute set — read each candidate's `viewModelConfigDiff`
     attribute paths against the source page's own fields for that specific mini-page. If it is still
     ambiguous, list the candidates and ask the developer to confirm which one (if any) corresponds —
     never guess.
   - **A `web-page` (`crt.OpenPageRequest`) target reported `state: "missing"` is NOT a search result.**
     `requestConversions.unresolvedTargetRequests` / `missingTargetPages` marks EVERY `web-page` target
     `missing` unconditionally — a web page schema can never be opened by `crt.OpenPageRequest` on
     mobile, so the guide flags this structurally without ever checking whether a converted mobile
     counterpart already exists elsewhere. Do not read a `web-page` "missing" flag as "no mobile
     equivalent was found" — it means only that THIS specific binding is broken as authored. Whether an
     equivalent already exists is answered only by running this same step 2a (registration + entity
     content match) against the TARGET page itself, exactly as step 8a re-enters the flow at step 2a
     for it.
   Treat a genuine match from any of the above exactly like a `guide.existingMobilePages` hit — ask the
   developer before Gate M whether to reuse it or convert again. Skipping this risks silently creating a
   duplicate mobile page next to one that already exists — this has been confirmed to happen in
   practice: an audited environment held two independently-converted duplicates for the same mini-page,
   one saved under `guide.suggestedTargetSchemaName`'s `<SourceName>_Mobile` pattern and one under this
   playbook's own `<Entity>_MobileFormPage` convention (see the naming note in step 7).
   If every signal above comes up empty, continue.
3. **Determine the source page type** from the returned `sourceType`:
   - **Classic UI / not `freedom-web`:** conversion STOPS here. Offer the developer a separate
     Classic UI → Freedom UI migration first (a dedicated classic-web → freedom-web converter — not
     part of this stage). Do NOT create, update, or validate anything in Creatio.
   - **Freedom UI (`freedom-web`):** continue — the guide already analyzed components, layout,
     fields, actions, and (detected) business rules.
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
     **Naming-convention conflict to watch for:** `guide.suggestedTargetSchemaName` defaults to
     `<SourceSchemaName>_Mobile` (derived from the WEB page's own name), which does NOT match this
     playbook's `<Entity>_MobileFormPage` convention. Confirmed on a live environment: the same source
     mini-page had been converted twice, once under each pattern, producing two duplicate mobile
     schemas with byte-identical bodies. Do not treat `guide.suggestedTargetSchemaName` as the name to
     create under without first running step 2a's full check (including under BOTH naming patterns) —
     a name search alone is exactly what missed one of the two duplicates in that case.
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
   - **Take each accepted candidate one at a time, re-entering the full flow at step 2.** If the
     candidate has a resolved page name (a `web-page` target, or an `entity-default-mobile-page` target
     with a `resolvedCandidateSchemaName`), run it as the new source through step 2 onward: step 3's
     `sourceType` check stops it there if it turns out to be Classic UI, and step 2a's existing-mobile
     check offers reuse-vs-convert if an equivalent already exists — neither needs pre-classifying here.
     If the candidate has NO resolved page name at all (only an object/entity `target`), there is nothing
     to re-enter the flow with: tell the developer no candidate could be found automatically and ask them
     to supply a page name or decline it — do not re-offer it later in this run.
   - **Offer from the deduplicated `missingTargetPages` list**, which clio already dedupes across both
     `web-page` and `entity-default-mobile-page` targets — no additional grouping needed on this side.
   - **Strictly one page at a time.** On acceptance, take candidates one by one. Each one runs the
     **full flow from step 1** (its resolved page name as the new source, re-resolving the environment if
     it differs) through **Gate M**, the build, **Gate S** (if applicable), and its own step 8 report —
     completed or explicitly declined — **before the next candidate starts.** Never batch, parallelize, or
     pre-approve more than one missing-page conversion at once; Gate M stays "scoped to a single page"
     (see below) for every one of these, exactly as for the original page.
   - **Repoint the referencing page(s) once a `web-page` target resolves.** This applies ONLY to a
     `web-page` candidate whose target param was actually blanked (`bindingRemoved: true` on the finding —
     the name is historical; the binding itself was never removed) — once its own step 8 report lands for
     a freshly-converted page, or as soon as the developer accepts "reuse the existing page" from step 2a
     (no new page build needed there). An `entity-default-mobile-page` candidate needs NO repoint: its
     request is scoped by `entityName`, not a page name, so registering the object's default mobile page
     via `create-related-page-addon` (step 7b) makes the existing binding work again on its own.
     For a `web-page` target, for EVERY entry in its `missingTargetPages[].references[]` (each carries its
     own `elementName`/`binding` — do not mix one reference's element into another's repoint, even when
     several reference the same target): `get-page` the page that carries `elementName` (with its
     `target-schema-uid` for `update-page`, same rule as step 7), locate that element's existing `binding`
     property (its `request` and every other `params` entry are already correct — the conversion never
     touched them), and set ONLY its target param to the RESOLVED mobile schema name (from `create-page`'s
     result for a fresh conversion, or from the reused page confirmed at step 2a — never a guessed naming
     pattern). That param is `params.schemaName` today, since `crt.OpenPageRequest` is the only
     `web-page`-kind request and declares no `paramMap` rename for it; if a future conversion rule adds
     another `web-page`-kind request, or a `paramMap` entry for `schemaName`, resolve the actual target
     param from that rule instead of assuming `schemaName`. This is a point patch of one param on the
     binding already sitting there, not a clone-and-swap of a saved snapshot — there is no `originalBinding`
     field to clone. Then `update-page` and `validate-page`.
     This is itself a write to an ALREADY-converted page and needs no separate Gate M — the developer already
     approved it by accepting this candidate — but report the outcome, per reference, in that page's own
     step 8 report (see the "Missing pages" report bullet below). **Known limit:** `references[]` only
     covers elements on the page the CURRENT guide call analyzed; if an EARLIER page in this same session
     also named this exact target, its own binding needs the same repoint too — track every blanked
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
- **Missing target pages** — from `guide.requestConversions.missingTargetPages`: clio deduplicates this
  list itself across BOTH `web-page` and `entity-default-mobile-page` targets, so list it as reported, one
  row per distinct target with the buttons/requests that reference it (`references[]`). This is
  informational only — do NOT propose converting anything yet, and do NOT classify or group the rows
  yourself; the sequential conversion OFFER happens after the report, in step 8a, and any Classic-UI /
  already-mobile / existing-equivalent handling happens when that offer is accepted (step 2a, step 3).
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
- **Requests (actions):** from `guide.requestConversions`, which has FIVE collections and you need all of
  them — `convertedRequests` (carried, remapped where the mobile name differs), `droppedRequests` (a binding
  lost — an unsupported request type — OR a `web-page` target's param blanked while the binding itself
  stays; read `unresolvedTargetRequests` to tell which), `flaggedRequests` (an unknown request kept for
  you to verify), `unresolvedTargetRequests` (the action's navigation target could not be confirmed —
  read `state` AND `bindingRemoved` together, they answer different questions) and `missingTargetPages`
  (the fifth — see the "Missing pages" bullet below). `bindingRemoved: true`
  happens ONLY for a `web-page` target (`crt.OpenPageRequest`) verified `missing`: the request still
  converts and the binding stays in `viewConfigDiff[].values` — only its target param (`schemaName` for
  `crt.OpenPageRequest` today; derived from the conversion rule's `targetParam`/`paramMap`, never assumed
  to stay `schemaName` if another `web-page`-kind request is added later) is cleared to
  `""` — and the finding is ALSO duplicated in `droppedRequests` under `drop-request-target-missing`. Do
  NOT treat the blanked binding as usable as-is, it fails every time (an empty target param still shows a
  settings-error dialog); there is no `originalBinding` snapshot to restore from — the repoint step below
  patches that same target param on the SAME binding once the target resolves. Every other combination
  (`entity-default-mobile-page` of any state, or `unknown`) keeps `bindingRemoved: false` and the binding
  untouched — an add-on read or an unreachable environment is never proof enough to touch a working
  action. A `crt.Button` whose request is unsupported was **dropped entirely** (a `guide.droppedElements`
  entry whose coded reason names the request) — list those removed action components for the developer.
- **Missing pages:** the same deduplicated `missingTargetPages` list from the plan. On the ORIGINAL page's
  report, state whether the developer accepted the step 8a offer to convert them, and for each accepted
  target: queued / converted (its own report lands when its turn finishes) / declined / still open (the
  session ended before its turn). If the offer was declined entirely, say so once and skip the per-page
  detail.
  For every **`web-page` target that resolved** (converted now, or reused via the step 2a existing-mobile
  check), also state the **repoint outcome** — see step 8a's repoint sub-step: which
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

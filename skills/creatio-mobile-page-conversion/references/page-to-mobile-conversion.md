# Web / legacy Mobile-wizard → Freedom UI Mobile Page Conversion (conversion playbook)

The authoritative **process** playbook for the `creatio-mobile-page-conversion` skill: converting an existing
**Freedom UI web page** — or a **classic Mobile application wizard list page** (a legacy
`Mobile<Entity>GridPageSettings<Workplace>` settings schema) — into a **Freedom UI mobile page** for the Creatio
Mobile app. One tool, one flow, one set of gates for both source types; the tool dispatches on the source type it
detects and the plan/report WORDING branches, nothing else. This is a targeted, implementation-ready
change: it does **not** require a full BA-style Business Plan (Gate R). It DOES require a blocking
approval gate — **Gate M** — between analysis and any write to Creatio: present a plain-language
**conversion plan** (what will be transferred, what will be adapted, what is unsupported), after
which the developer either **reviews/adjusts the details** or **approves**. Nothing is persisted
until the developer approves *after* seeing the plan.

**Layering — where each rule lives.** This playbook owns the PROCESS: the flow, the gates, environment
resolution, the plan/report format, and section registration. The body-building MECHANICS — how to turn
`guide.elementMap` and the guide's data-section diffs into a mobile page body (per-operation rules,
`mobileValues` paste-verbatim, adaptive/tab/normalization behavior, the paste-don't-rebuild data-section
rules) — are owned by the clio `freedom-page-web-to-mobile-conversion` guidance article (the ENGINE
layer), which stays in lockstep with the converter. Load that article once (Load order step 2) and
follow it for mechanics; this playbook does NOT restate them. If a mechanic and this playbook ever
disagree, the guidance article wins.

**Legacy wizard source — where its mechanics live.** For `sourceType: legacy-mobile-grid-page` the ENGINE is the
converter inside clio (a C# port of the mobile runtime's own settings converter). Its rules arrive ON the guide as
`guide.constraints` + `guide.nextSteps`, composed for this conversion, and the per-element facts arrive in
`guide.legacySource`. Follow them the way you follow the article for a web source. The article's web-specific
mechanics (multi-entry elementMap, adaptive layout, tab layers, normalizations, page business rules, requests)
do not apply — a legacy guide carries none of those fields, and its `resourceStrings` holds only the page title; the article's GATES, DATA SECTIONS
(paste, don't rebuild), list-row merge-by-name rule and HARD MOBILE RULES do apply.

## When to use

The developer wants to make an existing page available in the Creatio Mobile app as a Freedom UI mobile page
without re-creating it by hand in the Mobile Designer — either a Freedom UI web page, or a classic mobile
list page created with the Mobile application wizard (whose settings schema the Freedom UI Mobile designer
cannot open).

## Scope and precondition

- **Two supported source types, one tool.** `get-mobile-page-conversion-guide` detects the source and reports
  BOTH `sourceType` and `conversionMechanism` on every response (success or failure). Always echo both to the
  developer, so a wrong dispatch is visible rather than silent. Branch on them as follows:

  | `sourceType` | `conversionMechanism` | What you do |
  |---|---|---|
  | `freedom-web` | `freedom-web-analysis` | The Freedom UI web path — the flow below as it has always run. |
  | `legacy-mobile-grid-page` | `legacy-mobile-settings-converter` | The legacy wizard LIST path — the same flow, with the legacy variants of the plan, body build, verification and report called out below. |
  | `legacy-mobile-record-page` | — (`success: false`) | STOP. A wizard RECORD page is detected but not yet converted (ENG-95731). Relay the tool's message verbatim; nothing is written. |
  | `legacy-mobile-grid-page` with `success: false` | `legacy-mobile-settings-converter` | STOP. The settings carry a custom `viewConfig` (even the classic designer cannot open such a page), or the body could not be read/merged. Relay the tool's message verbatim; nothing is written. |
  | `mobile`, `unknown`, anything else | — | STOP with the existing wording: already mobile, or a Classic UI page that must first become a Freedom UI web page (separate classic-web → freedom-web converter). |

- **Freedom UI web source:** handled as before. Classic UI web pages are **not** converted here.
- **Legacy wizard source:** only a `GridPageSettings` (list) schema is converted, and only what the classic
  wizard itself writes (the title / subtitle / group column buckets). Freedom UI override sections embedded in
  the settings (`viewConfigDiff` / `viewModelConfigDiff` / `modelConfigDiff` / `diffV2`) are RECOGNISED and
  REPORTED, never converted (ENG-95733). A `RecordPageSettings` schema is detected and refused (ENG-95731).
- The conversion is **model-driven and advisory-first**: a tool returns a deterministic guide; YOU
  build the mobile page body and persist it only after **Gate M**. Never silently drop content — be
  transparent about what maps directly, what is adapted, and what is unsupported.
- **A failed guide is a failed run.** `success: false` from the tool ends the run in a clearly failed state
  with nothing written. Never report success with missing pieces and never work around the verdict.

## Executable contract

Resolve exact tool names / parameters through `get-tool-contract` (do not hardcode payloads).
The tools used in this flow:

- `get-mobile-page-conversion-guide` — **advisory only**: detects the source page type, dispatches to the
  matching mechanism and returns a conversion guide with `sourceType` + `conversionMechanism`. It builds NO body
  and writes NOTHING to Creatio or disk. For a legacy wizard source it also reads and merges every package
  layer of the settings schema INTERNALLY and returns facts only (`guide.legacySource`: entity, workplace,
  `classification`, contributing `layers`, `titleColumn`, `bodyColumns`, `columnPropertyCoverage`, `decisions`,
  `notes`) — the raw settings bodies never enter the conversation. A `success: false` response for a
  custom-viewConfig source or a RECORD page is a clean verdict: relay its message and stop.
- `list-page-templates` (schema-type `mobile`), `create-page`, `update-page`, `validate-page` — persistence.
  Thread `create-page`'s returned `schemaUId` into `update-page` as `target-schema-uid` (see step 7) so the
  body lands in the created schema instead of a replacing schema in the design package.
- `create-page-business-rule` — recreate the converted page-level business rules
  (`guide.pageBusinessRules.convertedRules[].rule`) on the mobile page. Only after Gate M.
- `get-component-info` (schema-type `mobile`) — full mobile component contract when the guide's
  inline `mobileContracts` entry is not enough. (Not needed for a legacy wizard source — its body is a verbatim
  paste, nothing is authored.)
- `get-page` — on the NEW mobile page only, for the independent read-back in step 7a. Never on a legacy source
  settings schema (see the skill's "Source body isolation" rule).
- `odata-read` — read-only lookups of the current section/workplace state (`SysModule`, `SysWorkplace`,
  `SysModuleInWorkplace`). Use it WHILE building the plan (steps 4–5, before Gate M/S) to enumerate the
  real workplace options for the developer and avoid proposing a generic choice or creating a duplicate
  `SysWorkplace` later. It is read-only and is NOT gated. (`get-mobile-page-conversion-guide` already
  probes this state into `guide.sectionRegistration`; use `odata-read` for anything it did not cover.)
  **Legacy wizard source — picking the page (step 1):** the classic mobile workplaces and their sections are
  visible from schema NAMES alone, so list them with `odata-read` on `SysSchema` selecting `Name` only (NEVER
  `Body`): a mobile workplace is a `MobileApplicationManifest<WorkplaceCode>` schema (e.g.
  `MobileApplicationManifestDefaultWorkplace`), and its list pages are the `Mobile<Entity>GridPageSettings<WorkplaceCode>`
  schemas sharing that suffix (`MobileActivityGridPageSettingsDefaultWorkplace`; a customer-made one may carry the
  environment prefix, e.g. `UsrMobileOrderGridPageSettingsDefaultWorkplace`). The workplace code is the manifest's
  suffix, NOT a `SysWorkplace` name. Show the developer the workplaces, then the sections (entity + workplace),
  and let them pick ONE; pass that schema name to `get-mobile-page-conversion-guide` — that call is what confirms
  the schema is really a GridPage settings schema. Never read the manifest or settings bodies to do this.
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

1. **Select the source page and resolve the environment.** Identify the page the developer wants
   in the Creatio Mobile app and the target **registered environment name** (Runbook 01 rules:
   registered environment name, never a raw URL). If not already loaded (SKILL Load order step 2), read
   `get-guidance freedom-page-web-to-mobile-conversion` ONCE here and reuse it for the rest of the run.
   - **Web page:** the developer names the Freedom UI web page schema (or you find it via `list-pages`).
   - **Legacy wizard page:** if the developer already has the settings schema name
     (`Mobile<Entity>GridPageSettings<WorkplaceCode>`), use it. Otherwise let them pick: list the classic
     mobile workplaces and the sections in each from `SysSchema` NAMES via `odata-read` (see the `odata-read`
     contract bullet — manifests `MobileApplicationManifest<Code>` → settings schemas with the same `<Code>`
     suffix), present "workplace → sections (entity)" in plain words, and let the developer choose ONE page.
     Never read a manifest or settings body for this. (A customer-made schema carrying the environment prefix,
     e.g. `UsrMobileOrderGridPageSettings…`, may come back from the tool as an unsupported source type on the
     current clio build — report that verbatim as a converter limitation; do not rename or copy the schema.)
2. **Analyze the source page:** run `get-mobile-page-conversion-guide` with the source `schema-name`.
   It reads the page and returns the conversion guide. It writes nothing.
3. **Determine the source page type** from the returned `sourceType` + `conversionMechanism` (dispatch table
   in "Scope and precondition"). Tell the developer which source type was detected and which mechanism ran.
   - **Freedom UI (`freedom-web`, `freedom-web-analysis`):** continue — the guide already analyzed
     components, layout, fields, actions, and (detected) business rules.
   - **Legacy wizard LIST page (`legacy-mobile-grid-page`, `legacy-mobile-settings-converter`, `success: true`):**
     continue on the legacy path. Also read and state `guide.legacySource.classification`:
     `plain` — only wizard buckets; `freedom-ui-overrides` — the settings ALSO carry Freedom UI override
     sections (`legacySource.overrideSections[]`: section name + operation count); say they were recognised and
     are NOT converted (ENG-95733) and never merge them by hand. (`custom-viewconfig` never reaches you as a
     success — see next bullet.)
   - **`success: false`** (a `legacy-mobile-record-page`, a custom-viewConfig settings schema, an unreadable or
     mistyped body): conversion STOPS here. Relay the tool's `error` verbatim — it names the schema and the
     reason — and end in a failed state. Do NOT create, update, or validate anything in Creatio.
   - **Anything else (Classic UI, already `mobile`, `unknown`):** conversion STOPS here. Offer the developer
     a separate Classic UI → Freedom UI migration first (a dedicated classic-web → freedom-web converter —
     not part of this stage). Do NOT create, update, or validate anything in Creatio.
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
   **Legacy wizard source:** build the plan from `guide.legacySource` (see "Conversion plan — legacy wizard
   source" below). It is all facts and open decisions — there is no component classification to run and
   nothing for you to synthesise; the body is fully computed by the tool.
5. **Present the conversion plan (preview/summary)** — the plain-language plan (see "Conversion plan"
   below). No JSON, no page body, no per-property detail. Read-only; nothing is persisted yet.
6. **Gate M — Mobile Conversion Approval (HARD STOP).** After the plan, offer the developer two
   choices — **View details / Adjust** or **Approve** (see the gate rules below). Do NOT run
   `create-page`, `update-page`, `validate-page`, or `create-page-business-rule` until the developer
   approves.
   **Corrections and re-runs.** When the developer supplies business context, corrections or answers to the
   open decisions, record them in a SEPARATE **Corrections** list under the plan — never edit the generated
   plan text itself. Re-run `get-mobile-page-conversion-guide` with the same arguments (it is deterministic, so
   the guide comes back identical), regenerate the plan, re-apply every recorded correction and every answer
   already given, and re-present. Answers survive the re-run; the developer never answers the same question
   twice. The gate is still NOT passed until an explicit Approve.
7. **Create or update the Freedom UI Mobile page** (only after Gate M):
   - **Before building the body:** first call clio `get-guidance mobile-page-modification` — the
     platform-mandated mobile authoring guidance (mobile component registry, body constraints, Scaffold
     inheritance rules); `../../context/essentials.md` requires it before editing ANY mobile page body.
     Then **invoke the `creatio-ui-guidelines` skill** (per the skill Load order) and apply its
     mobile-relevant rules (component choice, lookups, fields, captions, tooltips, accessibility); run its
     review checklist before step 8. The `mobileValues` paste is mechanical, but `create-page`/`update-page`
     still author a Freedom UI page body, so both the `mobile-page-modification` guidance and the UI/UX
     checklist apply.
   - Create the page from the confirmed `recommendedMobileTemplate` (confirm via `list-page-templates`
     schema-type `mobile`) with `create-page`, unless it already exists. Naming convention:
     `<Entity>_MobileFormPage` / `<Entity>_MobileListPage` (no prefix in the plan — clio applies the
     environment SchemaNamePrefix). The mobile template provides the Scaffold root — never add a
     second Scaffold.
     **Legacy wizard source:** `schema-name = guide.suggestedTargetSchemaName` (the tool ALREADY applied the
     environment prefix — do not add another), template = `guide.recommendedMobileTemplate`
     (`BaseMobileListTemplate`), `entity-schema-name = guide.legacySource.entitySchemaName` — the mobile page
     binds to the SAME object the wizard page was bound to. **Idempotency:** if that schema already exists
     (`list-pages`), do NOT create a duplicate — take its UId and `update-page` it (mode replace) with the
     same verbatim body; running the conversion twice yields the same page and never a second schema.
   - **Capture the `schemaUId` from the `create-page` result and pass it as `target-schema-uid` on EVERY
     subsequent `update-page` call** (body, `resources`, adaptive diffs — and re-use it for `get-page`).
     This is REQUIRED: without it, when the chosen package is not the app's design package, `update-page`
     resolves the design package and writes the body as a REPLACING schema there — leaving the just-created
     mobile schema EMPTY. The Creatio Mobile app loads that empty schema and crashes, and you end up with two
     same-named schemas. `create-page` returns `willCreateReplacingInDesignPackage: true` + `designPackageUId`
     when this split would happen — but pass `target-schema-uid` unconditionally so the body always lands in
     the one schema `create-page` made. (If the page already exists, get its UId via `list-pages`/`get-page`
     and pass it the same way.)
   - **Build the mobile body by iterating `guide.elementMap`** (plain JSON: `viewConfigDiff` /
     `viewModelConfigDiff` / `modelConfigDiff`) — one entry per source element with an explicit
     `operation` (`merge` / `insert` / `drop` / `relocate-children`). Do NOT re-derive placement from
     `containerMap` + `componentSuggestions`. **The MECHANICS of every operation are owned by the
     `freedom-page-web-to-mobile-conversion` guidance article (Load order step 2) — follow it field-by-field
     and do NOT restate those rules here.** In brief, so you know what to expect: paste
     `elementMap[].mobileValues` VERBATIM and add only the value binding; register `guide.resourceStrings`
     in one `update-page resources` call; and paste `guide.modelConfigDiff` / `guide.viewModelConfigDiff`
     VERBATIM (paste, don't rebuild — never source data-section attributes from a pre-existing body). The
     list-row, tabbed-page ordering, adaptive-layout, tab-body/Area, normalization, and data-section-diff
     details all live in the article. Persist the body and data sections with `update-page` (always with
     `target-schema-uid=<create-page schemaUId>`, per the create-page step).
   - **Legacy wizard source — the body is a PASTE, not a build.** The conversion is deterministic and the guide
     carries the complete page body; nothing is left for you to synthesise, infer or fill in. If the written
     page differs from what the guide returned, that is a defect.
     - `viewConfigDiff` = exactly the operations the guide's `elementMap` prescribes, in guide order, each as
       `{ "operation": <entry.operation>, "name": <entry.mobileName>, "values": <entry.mobileValues> }` with
       `mobileValues` pasted VERBATIM. Expect only `merge` operations onto elements the template already
       provides — the `ListItem` row (title / body) and the header's `FolderTreeActions` (`rootSchemaName` =
       the entity, so folder filtering resolves) — and treat whatever the guide returns as the whole list. Do NOT add, drop, rename or reorder anything: no second
       `Scaffold` / `List` / `ListItem` / `QuickFilterGroup`, no attribute renames, no extra properties, no merge
       the guide did not return.
     - `viewModelConfigDiff` / `modelConfigDiff` = `guide.viewModelConfigDiff` / `guide.modelConfigDiff` pasted
       VERBATIM (keep `PDS_Id`, keep every dotted column's `ForwardReference` type).
     - **Page title:** the mobile list template titles the page with the `DefaultPageTitle` localizable string
       (template value "Page title"). The guide overrides it with the caption of the classic page in
       `guide.resourceStrings` (`DefaultPageTitle` = the source schema's caption — what users saw as the section
       name). Register `guide.resourceStrings` with ONE `update-page resources` call, verbatim (same rule as
       the web path); do not invent the caption yourself and do not register a `#ResourceString(...)#` token as
       the value. Expect exactly this one string for a legacy source — the row itself carries no captions.
     - Nothing else: no business rules (7c), no adaptive / tab-layer / normalization handling — a legacy guide
       carries none of them.
     - The ONLY permitted edit is the one the guide's own `constraints` prescribe for an open decision (e.g. no
       title column: add `"title": "$PDS_<Column>"` to the `ListItem` values and the matching `PDS_<Column>`
       attribute to both diffs) — and only after the developer decided at Gate M.
     - `creatio-ui-guidelines` still runs (Load order step 4) but is report-only here: findings go into the
       report / designer hand-off, never into the body.
   - Run `validate-page` and resolve findings before treating the page as done (undeclared bindings, a
     lookup-path attribute missing its `type`, a field missing its caption `label`). It is the backstop
     that blocks the save when a required property was dropped — the article details what it enforces. For a
     legacy wizard source resolve findings only by asking the developer, never by silently editing the pasted
     values. Then read the page back — step 7a.
   - **Adaptive layout** — when `guide.adaptiveLayout` is present, present it to the user as a PROPOSAL
     (see "Conversion plan"); they may adjust column counts / placement or decline. Both the container
     columns and each child's placement are ALREADY baked into the `mobileValues` you pasted — there is NO
     separate diff to apply. `guide.adaptiveLayout` is advisory (for presenting the proposal); the article
     owns the field's shape.
7a. **Verify independently (never trust the write).** Run `validate-page`, then `get-page` on the NEW mobile
   page (by its `schemaUId`) and compare what was persisted with what the guide prescribed:
   - **Web source:** every `elementMap` insert/merge landed under its `parentName`; the data-section diffs are
     present; `resourceStrings` were registered.
   - **Legacy wizard source:** every `elementMap` merge landed on its template element (`ListItem.title` =
     `legacySource.titleColumn.attribute` binding, `ListItem.body[]` = `legacySource.bodyColumns[]` in the same
     order, `FolderTreeActions.rootSchemaName` = the entity when the guide returned it); every `PDS_*` attribute
     and every data-source attribute path/type from the guide's diffs is present and unchanged; the page's
     `DefaultPageTitle` resource equals `guide.resourceStrings.DefaultPageTitle` (not the template's "Page title").
   Any mismatch, any validate error left unresolved, or any write that did not land ends the run in a **clearly
   failed state**: say exactly what differs and what was written; never report success with missing pieces.
7b. **Register the mobile page** — only after **Gate S** (see below). The bullets below are independently
   conditional, NOT all gated on one flag: the section + workplace bullets apply only when
   `sectionRegistration.sourcePageIsSection` is true (a form/edit page is NOT a section — skip those two
   for it), and the default-mobile-edit-page bullet applies only when `sectionRegistration.isFormPage` is
   true. Skip 7b entirely only when the user declined or none of these conditions holds. Use the
   `guide.sectionRegistration` facts and `registrationActions`:
   For a legacy wizard source the probe ran BY ENTITY (`sectionRegistration.entitySchemaName`) because the
   settings schema is not itself a SysModule page; when `sectionRegistration.note` names several sections for
   that entity, ask the developer which one before Gate S. `isFormPage` is always false for it.
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
   `guide.pageBusinessRules.convertedRules` is non-empty (never for a legacy wizard source — the guide has no
   `pageBusinessRules`; the classic wizard records no page rules). The guide already applied the conversion logic
   (how page rules convert is owned by the guidance article). For each `convertedRules[]` entry, pass its
   `rule` VERBATIM to `create-page-business-rule` (`environment-name`, `package-name`,
   `page-schema-name = <the new mobile page>`, `rule`). Report any `droppedRules[]` to the developer with
   their reason (not transferred). Object-/entity-level business rules are shared across web and mobile — do NOT touch them.
8. **Deliver the conversion report** (see below).
9. **Hand off.** Tell the developer to open the result in **Freedom UI Mobile Designer** for review
   and manual refinement.

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

### Conversion plan (what step 5 must show)

Show a SHORT, plain-language plan — no JSON, no page body, no per-property detail. Cover:

- **Beta-release notice (show FIRST, verbatim)** — print this notice at the very top of the plan,
  before anything else, exactly as written (do not paraphrase or drop it). Print it as a PLAIN
  paragraph: no blockquote, no leading `>` — terminals whose font lacks the quote bar draw it as a
  missing-glyph box on every wrapped line of the notice. It is temporary and names the feature it
  applies to — converting a **web Freedom UI page** into a **mobile Freedom UI page**:

  ⚠️ You are using the **web-Freedom-page → mobile-Freedom-page conversion** in **Beta mode**: some functionality may be limited or subject to change, and the Converter currently supports the **Mobile canvas** only — Tablet support is on the roadmap and will be available in a future release.

  For a **legacy wizard source** print this variant instead (same rules: first, verbatim, plain paragraph):

  ⚠️ You are using the **classic Mobile-wizard list page → mobile-Freedom-page conversion** in **Beta mode**: some functionality may be limited or subject to change, and the Converter currently supports the **Mobile canvas** only — Tablet support is on the roadmap and will be available in a future release.

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
- **Section registration intent** (from `guide.sectionRegistration`) — whether the page is a section
  and whether it would be made available in mobile, and in which workplace (existing mobile one, a new
  one, or skip); for a FORM page, whether to register it as the entity's default mobile edit page
  (via `create-related-page-addon` with `schema-type=mobile`). The actual decisions are taken at **Gate S**. If
  `sectionRegistration.probeOk` is false, say the environment could not be queried and registration
  must be verified manually.
- **Adaptive layout (per-screen)** — when `guide.adaptiveLayout` is present, state it in plain words:
  *"the fields in `<container>` will stack in one column on a phone and show 2 columns on a tablet."* This
  is a PROPOSAL — the developer can adjust the column counts / placement or decline it. (Both the container
  columns and the child placement are already baked into the pasted `mobileValues`; nothing separate to apply.)
- **Other guide-surfaced facts to state** — if the guide reports a converted-tab body structure
  (`guide.tabAreaLayers`) or normalized properties (`guide.normalizations`), state each as ONE aggregated
  plain-language line. Per the guidance article these are FACTS to report at the gate, not decisions — never
  offer to skip them. Omit when the field is absent.
- **Manual follow-ups** — page-level business rules are converted in `guide.pageBusinessRules` and
  re-created in step 7c; `droppedRules` (no surviving action) remain manual. Requests: supported ones are baked
  into `mobileValues` (`guide.requestConversions`); components whose request the mobile app does not support are
  DROPPED (elementMap `drop`) — list the removed action components. Plus mobile manifest /
  wizard registration. (The default mobile edit page is now automated via `create-related-page-addon` with `schema-type=mobile`.)

Keep it skimmable. **On request (View details / Adjust)** — only if the developer asks to see more or
to change something — surface the technical detail: the full component mapping table, the proposed
`crt.List` columns for the `itemLayout`, and the relevant `mobileContracts` (or `get-component-info`,
schema-type `mobile`). Do NOT dump these in the default plan.

### Conversion plan — legacy wizard source (what step 5 must show instead)

Same rules — SHORT, plain language, no JSON, no page body, no raw metadata — built from `guide.legacySource`,
`guide.sectionRegistration` and the response envelope. Cover, in this order:

- **Beta-release notice** — the legacy variant above, first and verbatim.
- **What was detected** — `sourceType` + `conversionMechanism` (one line), the source schema, the entity it is
  bound to (`legacySource.entitySchemaName`), the workplace (`legacySource.workplace`), and the
  **classification** (`plain`, or `freedom-ui-overrides` with the override sections named and marked "recognised,
  not converted — ENG-95733").
- **Which page will be created** — `guide.suggestedTargetSchemaName` from `BaseMobileListTemplate`, bound to the
  same object, titled with the classic page's caption (`guide.resourceStrings.DefaultPageTitle`), in the proposed
  package (the developer makes the final package choice). If it already exists, say
  it will be updated in place, not duplicated.
- **What transfers unchanged** — the title column (`titleColumn.columnName`, caption) → list item title; the
  body rows (`bodyColumns[]` in wizard order — bucket and row) → list item body; sorting, search, folder
  filtering and quick filters → provided by the mobile list template.
- **What is adapted and how** — from `columnPropertyCoverage` `informational` rows and `legacySource.notes`:
  captions are not rendered on list rows (the value is shown; the caption stays on the entity), a dotted column
  resolves through a `ForwardReference` attribute, a lookup shows its display value, a column present in two
  buckets is declared once, extra title columns moved into the body (the tool says which).
- **What cannot be transferred and why** — every `columnPropertyCoverage` row with `status: dropped` (view types
  such as phone / email / url / map / preview, formats) with the tool's note, and every `decisions` entry that
  says a settings property was dropped. Use the step-4 message shape.
- **What requires a decision** — the remaining `legacySource.decisions` (e.g. no title column, which of several
  title columns).
- **Where it came from** — the contributing package layers (`legacySource.layers[]`: schema, package, operation
  count) as one line; if a note says a layer was NOT part of the resolved hierarchy, surface it.
- **Size of the remaining manual work** — one line: the count of dropped properties and open decisions, plus
  "final look in the Freedom UI Mobile designer".
- **Section registration intent** — from `sectionRegistration` (probed by entity): whether a section for this
  entity was found, whether it is already mobile-registered, the workplace options; if `note` names several
  sections, list them for the developer to choose at Gate S. No default-edit-page bullet (`isFormPage` is false).
- **Corrections** — the separate list of corrections / business context the developer supplied so far (empty on
  the first run), carried unchanged across re-runs.

**On request (View details / Adjust)** — and only then — show the `columnPropertyCoverage` table in full and the
per-column mapping (`bucket`, `row`, `columnName`, `attribute`, `target`). Still no page body.

### Conversion report (step 8)

After `validate-page`, deliver a report:

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
- **Requests (actions):** from `guide.requestConversions` — which event-binding requests were carried
  (`convertedRequests`, remapped where the mobile name differs). Components whose request the mobile app does
  NOT support were **dropped entirely** (their `elementMap` entry is `drop`, reason names the request) — list
  those removed action components for the developer.
- **Adaptive layout:** from `guide.adaptiveLayout` — which containers got a per-screen layout (stack on
  phone, N columns on tablet), and whether the developer adjusted or declined it (both sides were applied
  via the pasted `mobileValues` — nothing separate).
- **Converted-tab body / normalized properties:** if the guide reported `guide.tabAreaLayers` or
  `guide.normalizations`, state each as one aggregated line (what standard was applied where).
- **Remaining manual steps:** dropped business rules, dropped action components (a component whose
  request the mobile app does not support is removed from the page entirely — elementMap `drop`, not a
  "flagged" component that stayed on the page), mobile manifest / wizard registration, and any
  `requiresManualDecision` items still open.
- **Hand off** to Freedom UI Mobile Designer (step 9) for final layout review and manual refinement.

**Legacy wizard source — report variant.** Same shape, with these specifics:

- **Detected:** `sourceType` + `conversionMechanism`, classification, source schema and entity.
- **Created/updated:** the mobile page schema (UId), package, environment; whether it was created or updated in place.
- **Per-element outcome table** — one row per wizard column and per column property: element (column path /
  property), outcome (`transferred` / `adapted` / `dropped` / `needs decision`), source (bucket + row, or the
  package layer), and the reason (the tool's note). Build it from `legacySource.titleColumn`, `bodyColumns`,
  `columnPropertyCoverage`, `decisions`, `notes` — the ACTUAL outcome, not the plan.
- **Coverage table** — the supported vs unsupported column properties (`columnPropertyCoverage`, all statuses).
- **Freedom UI overrides** — if `classification` is `freedom-ui-overrides`: the sections left untouched (ENG-95733).
- **Data sections:** `viewModelConfigDiff` / `modelConfigDiff` pasted verbatim (every `PDS_*` attribute, every
  `ForwardReference` kept).
- **Page title:** `DefaultPageTitle` overridden with the classic page caption (from `guide.resourceStrings`).
- **Independent verification (7a):** validate result and the read-back comparison — what was checked and that
  it matched; a mismatch means the run is reported as FAILED here, not as done.
- **Section registration outcome** — as for a web source (section found by entity; workplace chosen or skipped).
- **Classic schemas left untouched** — state it explicitly: nothing was written to the settings schema or its
  package layers, and re-running produces the same page.
- **Remaining manual steps:** dropped view types / formats to re-create by hand if wanted, open decisions, the
  designer look-over.

## Mobile constraints (carry into every step)

These are the invariants to keep in mind across the flow. The full body-building MECHANICS behind them
live in the `freedom-page-web-to-mobile-conversion` guidance article — do not restate them here.

- Mobile body is plain JSON: `viewConfigDiff` / `viewModelConfigDiff` / `modelConfigDiff` only — no
  `handlers`, no `validators`, no custom `converters`. Page `handlers` (web-only AMD) are NEVER transferred.
- **Page-level business rules ARE converted** in `guide.pageBusinessRules`; recreate each
  `convertedRules[].rule` verbatim with `create-page-business-rule` on the mobile page (step 7c).
  **Object-/entity-level business rules are shared** across web and mobile — do NOT touch them.
- **Requests, adaptive layout, tab bodies, and normalized properties are handled by the converter** and
  baked into `guide.elementMap` / `mobileValues`; the advisory summaries live on the guide
  (`guide.requestConversions`, `guide.adaptiveLayout`, `guide.tabAreaLayers`, `guide.normalizations`).
  Present the proposals/facts at the gate (see "Conversion plan"); the article owns how they apply.
- One data source per page. If the web page used several (see `guide.dataSources`), keep only the primary one.
- Apply the data sections by pasting `guide.modelConfigDiff` / `guide.viewModelConfigDiff` verbatim — never
  reconstruct attributes by hand and never source them from a pre-existing body (the article explains why).
- Mobile layout is a simplified vertical flow; complex desktop layout may need manual adaptation.
- **Legacy wizard source:** the body is exactly the operations the guide returned — no more, no less; the
  mobile list template already provides the Scaffold, header (search, sort, folder tree, quick filters), list
  and row; the source settings schema and its package layers are never read into the conversation and never
  written to; the conversion is deterministic and idempotent.

## Limitations (be transparent)

No guarantee of pixel-perfect or behavior-perfect migration. The guarantee is a deterministic
guide: recommended template, container correspondence, classified components, and mobile contracts.
The result is a starting point the developer finishes in Freedom UI Mobile Designer.

For a legacy wizard source the guarantee is stronger on the body (it is computed, not advisory) but narrower in
scope: only the wizard's column buckets convert. Column view types and formats the wizard recorded (phone, email,
url, map, preview, …) are not carried and are listed as dropped; captions are not rendered on list rows; Freedom
UI override sections embedded in the settings are recognised but deferred to ENG-95733; a wizard RECORD page is
deferred to ENG-95731.

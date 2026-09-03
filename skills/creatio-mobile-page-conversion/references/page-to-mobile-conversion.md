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
`guide.elementMap` and the guide's data-section diffs into a mobile page body (per-operation rules,
`mobileValues` paste-verbatim, adaptive/tab/normalization behavior, the paste-don't-rebuild data-section
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
  conversion guide. It builds NO body and writes NOTHING to Creatio or disk.
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
     review checklist before step 8. The `mobileValues` paste is mechanical, but `create-page`/`update-page`
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
   - Run `validate-page` and resolve findings before treating the page as done (undeclared bindings, a
     lookup-path attribute missing its `type`, a field missing its caption `label`). It is the backstop
     that blocks the save when a required property was dropped — the article details what it enforces.
   - **Adaptive layout** — when `guide.adaptiveLayout` is present, present it to the user as a PROPOSAL
     (see "Conversion plan"); they may adjust column counts / placement or decline. Both the container
     columns and each child's placement are ALREADY baked into the `mobileValues` you pasted — there is NO
     separate diff to apply. `guide.adaptiveLayout` is advisory (for presenting the proposal); the article
     owns the field's shape.
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

## Limitations (be transparent)

No guarantee of pixel-perfect or behavior-perfect migration. The guarantee is a deterministic
guide: recommended template, container correspondence, classified components, and mobile contracts.
The result is a starting point the developer finishes in Freedom UI Mobile Designer.

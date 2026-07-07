# Freedom UI Web → Mobile Page Conversion (conversion playbook)

The authoritative playbook for the `creatio-mobile-page-conversion` skill: converting an existing
**Freedom UI web page** into a **Freedom UI mobile page** for the Creatio Mobile app (ENG-89620). This is a targeted, implementation-ready
change: it does **not** require a full BA-style Business Plan (Gate R). It DOES require a blocking
approval gate — **Gate M** — between analysis and any write to Creatio: present a plain-language
**conversion plan** (what will be transferred, what will be adapted, what is unsupported), after
which the developer either **reviews/adjusts the details** or **approves**. Nothing is persisted
until the developer approves *after* seeing the plan.

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
- `create-page-business-rule` — recreate the converted page-level business rules
  (`guide.pageBusinessRules.convertedRules[].rule`) on the mobile page. Only after Gate M.
- `get-component-info` (schema-type `mobile`) — full mobile component contract when the guide's
  inline `mobileContracts` entry is not enough.
- `odata-read` / `odata-update` / `odata-create` — section/workplace registration writes (set
  `SysModule.MobileSectionSchemaUId`; add `SysModuleInWorkplace`; create `SysWorkplace`). Only after Gate S.
- `register-related-page` — for FORM pages: registers the converted mobile form page as the entity's
  default mobile edit page (`schema-type=mobile`, `is-default=true` → `MobileRelatedPage` add-on; also
  supports `schema-type=web` and `is-default=false`). Only after Gate S.

Read `get-guidance` with name `freedom-page-web-to-mobile-conversion` before acting on the guide.

## Flow

This flow follows the canonical Expected User Flow. Steps 1–6 are analysis and approval and write
NOTHING to Creatio. Persistence happens only after **Gate M** (step 6).

1. **Select the source page and resolve the environment.** Identify the Web page the developer wants
   in the Creatio Mobile app and the target **registered environment name** (Runbook 01 rules:
   registered environment name, never a raw URL). Read `get-guidance freedom-page-web-to-mobile-conversion`.
2. **Analyze the source page:** run `get-mobile-page-conversion-guide` with the source `schema-name`.
   It reads the page and returns the conversion guide. It writes nothing.
3. **Determine the source page type** from the returned `sourceType`:
   - **Classic UI / not `freedom-web`:** conversion STOPS here. Offer the developer a separate
     Classic UI → Freedom UI migration first (a dedicated classic-web → freedom-web converter — not
     part of this stage). Do NOT create, update, or validate anything in Creatio.
   - **Freedom UI (`freedom-web`):** continue — the guide already analyzed components, layout,
     fields, actions, and (detected) business rules.
4. **Generate the conversion plan.** From the guide, produce a SHORT, plain-language plan — NOT
   technical detail. State: what will be transferred, what will be adapted (e.g. *"grid → mobile
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
   - Create the page from the confirmed `recommendedMobileTemplate` (confirm via `list-page-templates`
     schema-type `mobile`) with `create-page`, unless it already exists. Naming convention:
     `<Entity>_MobileFormPage` / `<Entity>_MobileListPage` (no prefix in the plan — clio applies the
     environment SchemaNamePrefix). The mobile template provides the Scaffold root — never add a
     second Scaffold.
   - Build the mobile body yourself (plain JSON: `viewConfigDiff` / `viewModelConfigDiff` /
     `modelConfigDiff`) by iterating `guide.elementMap` — one entry per source element with an explicit
     `operation`. Do NOT re-derive placement from `containerMap` + `componentSuggestions`:
     - `merge` → reuse the template element `mobileName`; do NOT insert it (the template already has it).
       If the mobile list template already provides the `List`/`ListItem` elements, configure them by
       merge-by-name (the row goes on the `ListItem` element: `title`/`body`) — NEVER insert a second
       `crt.List` and NEVER put `itemLayout` inside a merge of the parent `List` (silent no-op; `ListItem`
       is a separate named element).
     - `insert` → add `mobileType` under `parentName`/`propertyName`. **Start from
       `elementMap[].mobileValues`: paste it as the component's `values` verbatim** — it already carries the
       `type` and every source property the mobile component supports; never drop any of them. It also already
       carries the **converted event-binding requests** (a button's `clicked`, a field's `valueChange`/`updated`):
       supported requests are kept/remapped. A component whose request the mobile app does NOT support was
       already DROPPED (its elementMap entry is `drop`, not `insert`), so it is not among the components you
       build — do NOT hand-edit these bindings; paste `mobileValues` as-is. Then add ONLY
       what `mobileValues` deliberately leaves out: the value binding (`control`, or `value` for lookups —
       type-specific), and for a structural mapping (grid → `crt.List` + `crt.ListItem`) the row layout — add a
       `crt.ListItem` into the `crt.List` `itemLayout` (title = first column, body = the rest), per the
       `componentSuggestions` note and the `mobileContracts` example. The `mobileValues` carry every localized
       string verbatim as `#ResourceString(key)#` tokens — a top-level caption AND nested ones (e.g.
       `config.title`, `text.template`). Register them ALL: pass `guide.resourceStrings` (a `{ key: en-US text }`
       map covering the whole converted body) to `update-page resources` in one call — never register a
       `#ResourceString(...)#` token as the value, and do not hand-pick keys. A token whose key is not
       registered renders blank. Consult `mobileContracts` / `get-component-info` only for those not-prebuilt parts. `validate-page` is
       the backstop — it rejects an insert that drops a required property (e.g. a field's caption, or a
       lookup-path attribute's type) and `update-page` refuses to save.
     - `relocate-children` → do not recreate this container; its children are placed in `parentName`
       (each child entry already carries that `parentName`).
     - `drop` → skip it; tell the user what was dropped and why. (Empty containers are still inserted —
       the user can delete them.)
   - **Data sections — paste the prebuilt diffs, do NOT rebuild by hand.** Both metadata sections have
     identical structural support on mobile, and the guide hands them to you ready to paste:
     - Paste `guide.modelConfigDiff` VERBATIM as the page's `modelConfigDiff`, and `guide.viewModelConfigDiff`
       as the page's `viewModelConfigDiff`. Each is a single root merge carrying the full config (every
       attribute's `type` and `path` intact). `guide.modelConfig` / `guide.viewModelConfig` are the same data
       in full-object form, for reference only.
     - **HARD RULE:** NEVER source the data-source section (`modelConfigDiff`) from a pre-existing or
       reference mobile body — that is exactly how an attribute's `type` (e.g. `ForwardReference` on a
       related/lookup column) gets dropped, making the binding unresolvable in Mobile Designer (`Item with the
       path … not found`). If the target page already exists, discard its data-source section and rebuild it
       from `guide.modelConfigDiff`. Related/lookup columns keep their `type`; own columns resolve
       automatically and are not declared. Reference only OOTB mobile converters (definitive list forthcoming —
       flag any custom converter for manual review).
     Apply with `update-page`.
   - Run `validate-page` and resolve findings before treating the page as done. Property fidelity is owned by
     the prebuilt `elementMap[].mobileValues` (paste them verbatim and you keep every mobile-supported
     property); `validate-page` is the backstop — it flags (as errors that `update-page` blocks) an insert
     that dropped a required property: a lookup-path data-source attribute missing its `type`, or a field
     missing its caption (`label`), in addition to undeclared-binding checks.
   - **Adaptive layout** — when `guide.adaptiveLayout` is present, present the proposal to the user (see
     "Conversion plan"). The child placement is already inside the pasted `mobileValues`
     (`layoutConfig.adaptive`); once the user approves (they may adjust column counts / placement or
     decline), apply each `guide.adaptiveLayout[].adaptiveDiff` (a `merge` by container name that sets the
     container's per-breakpoint columns) via `update-page`. Apply BOTH sides — applying only one leaves
     fields pinned to their old cells. The runtime reflows by `row`/`column` (one item per cell).
7b. **Register the mobile section** — only after **Gate S** (see below); skip entirely if the user
   declined or `sectionRegistration.sourcePageIsSection` is false. Use the `guide.sectionRegistration`
   facts and `registrationActions`:
   - **Make the section mobile:** `odata-update` `SysModule` id = `sectionRegistration.sysModuleId`,
     data `{ "MobileSectionSchemaUId": "<new mobile list page schema UId>" }`, `confirm=true`. Get the
     new page's schema UId from the `create-page` result / `get-page`.
   - **Workplace (user's choice):** add the section to the chosen workplace with `odata-create`
     `SysModuleInWorkplace` `{ SysModuleId, SysWorkplaceId, Position }`; to create a new mobile
     workplace first `odata-create` `SysWorkplace` `{ Name, SysApplicationClientTypeId: <Mobile>, Position }`.
   - **Default mobile EDIT page (form pages):** register the converted mobile form page as the object's
     default mobile card with `register-related-page` (`environment-name`, `package-name`,
     `entity-schema-name`, `page-schema-name`, `schema-type=mobile`, `is-default=true`). It writes the
     `MobileRelatedPage` add-on into the page's package (must be editable). Idempotent — re-running
     points the default at the given page.
7c. **Recreate page-level business rules** — only after Gate M, and only if
   `guide.pageBusinessRules.convertedRules` is non-empty. The guide already applied the conversion
   logic (condition kept verbatim; page rules carry only element actions — hide / show / make-editable /
   read-only / required / optional — and an action survives only for the referenced elements whose
   component converts, with element names remapped web→mobile; a rule whose every action drops is in
   `droppedRules`). For each `convertedRules[]` entry, pass its `rule` VERBATIM to
   `create-page-business-rule` (`environment-name`, `package-name`,
   `page-schema-name = <the new mobile page>`, `rule`). Report any `droppedRules[]` to the developer
   (not transferred). Object-/entity-level business rules are shared across web and mobile — do NOT touch them.
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

- **Target** — the registered environment, the target page name (**with the environment
  `SchemaNamePrefix`**), the recommended mobile template, and the target package (propose one; the
  developer makes the final choice).
- **What will be transferred** (`directMapping`) — by name or group, in plain words.
- **What will be adapted** (`withAdaptation` / `alternativeAvailable`) — e.g. *"grid → mobile list"*,
  *"checkbox → toggle"*.
- **What is NOT supported / will be dropped** — e.g. Dashboards, Summaries, bulk actions. State it
  explicitly.
- **Needs a decision** (`requiresManualDecision`) — the items awaiting the developer's call.
- **Section registration intent** (from `guide.sectionRegistration`) — whether the page is a section
  and whether it would be made available in mobile, and in which workplace (existing mobile one, a new
  one, or skip); for a FORM page, whether to register it as the entity's default mobile edit page
  (via `register-related-page`). The actual decisions are taken at **Gate S**. If
  `sectionRegistration.probeOk` is false, say the environment could not be queried and registration
  must be verified manually.
- **Adaptive layout (per-screen)** — when `guide.adaptiveLayout` is present, state it in plain words:
  *"the fields in `<container>` will stack in one column on a phone and show 2 columns on a tablet."* This
  is a PROPOSAL — the developer can adjust the column counts / placement or decline it. (The child
  placement is already baked into `mobileValues`; the container side is `guide.adaptiveLayout[].adaptiveDiff`,
  applied in step 5b after approval.)
- **Manual follow-ups** — page-level business rules are converted in `guide.pageBusinessRules` and
  re-created in step 7c; `droppedRules` (no surviving action) remain manual. Requests: supported ones are baked
  into `mobileValues` (`guide.requestConversions`); components whose request the mobile app does not support are
  DROPPED (elementMap `drop`) — list the removed action components. Plus mobile manifest /
  wizard registration. (The default mobile edit page is now automated via `register-related-page`.)

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
  edit page was registered (`MobileRelatedPage` via `register-related-page`) for a form page, or
  that registration was skipped/declined.
- **Page-level business rules:** which `convertedRules` were recreated on the mobile page
  (`create-page-business-rule`) and which `droppedRules` did not convert.
- **Requests (actions):** from `guide.requestConversions` — which event-binding requests were carried
  (`convertedRequests`, remapped where the mobile name differs). Components whose request the mobile app does
  NOT support were **dropped entirely** (their `elementMap` entry is `drop`, reason names the request) — list
  those removed action components for the developer.
- **Adaptive layout:** from `guide.adaptiveLayout` — which containers got a per-screen layout (stack on
  phone, N columns on tablet), whether the developer adjusted or declined it, and that the child placement
  was applied via `mobileValues` and the container columns via each `adaptiveLayout[].adaptiveDiff`.
- **Remaining manual steps:** dropped business rules, flagged/dropped requests, mobile manifest / wizard
  registration, and any `requiresManualDecision` items still open.
- **Hand off** to Freedom UI Mobile Designer (step 9) for final layout review and manual refinement.

## Mobile constraints (carry into every step)

- Mobile body is plain JSON: `viewConfigDiff` / `viewModelConfigDiff` / `modelConfigDiff` only.
- No `handlers`, no `validators`, no custom `converters` in the mobile body.
- **Page-level business rules ARE converted** in `guide.pageBusinessRules` (condition kept; only the
  surviving hide/show/make-* actions — set-values / apply-filter / apply-static-filter do not exist at
  page level). Recreate each `convertedRules[].rule` verbatim with `create-page-business-rule` on the
  mobile page (step 7c). **Object-/entity-level business rules are shared** across web and mobile — do NOT touch them.
- **Requests (actions) ARE handled** for you: a supported request is kept/remapped in `elementMap[].mobileValues`;
  a component whose request the Creatio Mobile app does NOT support (and that does not remap to a supported one)
  is **DROPPED entirely** — its `elementMap` entry is `drop` (reason names the request), never `insert`. A
  component with a dead action is not shipped. `guide.requestConversions` is the advisory summary of the kept
  ones. Page `handlers` (web-only AMD) are NEVER transferred.
- **Adaptive layout is a PROPOSAL and two-sided.** When `guide.adaptiveLayout` is present, the per-screen
  field placement is already baked into `elementMap[].mobileValues.layoutConfig.adaptive` (child side); apply
  each `guide.adaptiveLayout[].adaptiveDiff` for the container columns (container side) — both are needed. The
  runtime reflows children by `row`/`column` (one item per cell; `colSpan`/`rowSpan` are serialized as 1 for
  designer parity but not honored per-item). Let the user adjust or decline it at the gate.
- One data source per page. If the web page used several (see `guide.dataSources`), keep only the
  primary one.
- Apply the data sections by pasting `guide.modelConfigDiff` / `guide.viewModelConfigDiff` verbatim — never
  reconstruct attributes by hand and never source them from a pre-existing body. Keep every attribute with
  all of its declared properties (related/lookup columns MUST keep their `type`), or the binding is
  unresolvable in Mobile Designer. `validate-page` flags a missing `type` on a dotted-path attribute and
  `update-page` blocks the save.
- Mobile layout is a simplified vertical flow; complex desktop layout may need manual adaptation.

## Limitations (be transparent)

No guarantee of pixel-perfect or behavior-perfect migration. The guarantee is a deterministic
guide: recommended template, container correspondence, classified components, and mobile contracts.
The result is a starting point the developer finishes in Freedom UI Mobile Designer.

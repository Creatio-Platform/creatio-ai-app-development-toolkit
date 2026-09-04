# Classic To Freedom Mapping

Use this reference when classifying Classic UI artifacts during migration planning.

## Classification Categories

| Category | Use When | Freedom Target |
| --- | --- | --- |
| Direct Freedom analog | The Classic element is a standard layout or data-bound control. | Freedom UI view item, data source, section list, form field, tab, expansion panel, grid, button, or action. |
| Configurable business rule | The behavior controls visibility, editability, required state, simple value setting, or dependent lookup filtering. | Page or entity business rule. |
| Handler, converter, or validator | The behavior needs request interception, async logic, custom formatting, non-trivial validation, or calculated UI state. | Freedom UI handler, converter, validator, or helper module. |
| Backend/service dependency | The behavior depends on process execution, web service calls, C# logic, SQL, integrations, or permission checks. | Reused or adapted backend schema/service plus Freedom UI caller. |
| Unsupported/manual decision | The behavior has no reliable Freedom equivalent or changes UX/product behavior. | Explicit product or architecture decision before implementation. |

## Package Placement Mapping

Decide package placement before page/template mapping. Do not assume a Classic section can be migrated into its original package.

| Package/Ownership Situation | Migration Placement | Notes |
| --- | --- | --- |
| Classic owning package is editable, source-owned, and matches the target app ownership | Same package | Preferred only when ownership and runtime editability are both clear. |
| Classic owning package is locked, installed, or vendor/base-owned, but Creatio can create replacing schemas in the design package | Replacing/extension package | Use for page replacements or additive Freedom artifacts that should not mutate the locked source package. |
| Classic owning package is read-only, unsafe to mutate, or user wants isolation | New package/app | Default safe option when ownership is uncertain or migration should be parallel. |
| Existing Freedom page for the same entity already exists in an editable app/package | Update existing Freedom package/page | Avoid duplicate sections/pages unless there is a documented reason. |
| Package lock/editability cannot be verified and implementation would touch shared/base assets | Manual decision or blocked | Planning can continue, but implementation must wait for package ownership confirmation. |

Evidence to collect:

- package name, UId, maintainer, install type or lock/read-only indicators
- installed app ownership and section ownership
- existing replacing schemas or Freedom pages for the same entity
- explicit user package strategy, if provided

## Section Host Mapping

A writable package answers *where pages go*. It does not answer *whether the section can be
registered in the menu* — those are two different questions, and conflating them is how a run builds
every page and only then finds that `create-app-section` cannot run.

**`create-app-section` takes no package parameter.** It writes to the application's **primary**
package. Everything below follows from that one fact.

| Application situation | Section host | Notes |
| --- | --- | --- |
| App's primary package IS the target package, and it is editable | `existing-app` | The only situation where the section lands where the plan says it will. |
| App has a primary package, but it is NOT the target package | `new-app`, or fix composition on-stand first | Registering anyway writes the section into a package the migration does not own. |
| App's primary package is locked (vendor/installed) | `new-app` | Design-time writes into it are refused; unlocking a vendor package is not a migration decision. |
| App has **no** primary package at all | `new-app` | Typical of an app created by *installing* a package: the wrapper carries a primary package only when the package shipped an app descriptor. `get-app-info` fails with *"Primary package not found in response."* — that error IS the evidence, not a tool defect. |
| No app owns the entity's package | `new-app` | `create-app` gives the new app its own editable primary package. |
| User accepts URL/page-binding reachability only | `pages-only-no-menu` | Legitimate, but it must be an approved decision recorded in `decisions.md` — never a silent fallback after a failed registration. |

Record the answers in `manifest.placement` (see SKILL.md step 3.1); `migrate.mjs --plan` refuses to
present a plan until they are resolved.

**Never repair an app's package composition unasked.** Linking a package to an application or
flipping its primary flag changes which package owns the app's identity and where the Section Wizard
writes every future schema. Surface it as a decision; the user picks the host mode.

## Layout Mapping

Start with the page template, then map child controls. Do not choose a Freedom form template only from the entity name or section caption.

## Template Mapping

| Classic Template/Parent Pattern | Freedom UI Analog | Notes |
| --- | --- | --- |
| `BaseSectionV2` section grid | `ListPageV3Template` or an existing Freedom list page for the same entity. | Preserve folders, import/export, tags, summaries, actions, and grid columns where applicable. |
| `BaseModulePageV2` edit page with tabs/details/files/notes | `PageWithTabsFreedomTemplate` or an existing form page. | Default choice for Classic cards with tabbed detail areas. |
| Classic card with important side/profile area and right panel behavior | `PageWithRightAreaAndTabsFreedomTemplate` or existing right-area form page. | Use when the side/right area is functional, not merely decorative. |
| Classic card organized around top header/status/stage region — **elements in the Header container** (not just the title) | `PageWithTopAreaAndTabsFreedomTemplate` (Tabbed page with area on top). | Use when the Classic `Header` container holds fields/controls. Place those header elements in **`TopAreaProfileContainer`** (the template's top `crt.GridContainer` under `MainContainer`), not the narrow left profile. |
| Card whose object HAS a DCM case (needs a case-stage progress bar) | **`PageWithTabsAndProgressBarTemplate`** — it SHIPS the progress bar in the right place. | **Prefer this over hand-adding `crt.EntityStageProgressBar`.** Pick it at plan time when the DCM check finds a case; after `create-page` the new page is bound to the template's demo object, so **re-bind it to your entity** (set the page's entity/data source to the target object). Hand-adding the bar into `MainContainer` is the FALLBACK for when you are already on a no-bar template or the page already exists. |
| Detail / child edit page with **MANY columns — `>= 15` inputs, OR it has tabs / related lists** (a wide record), or a simple edit page without tabs/details | `PageWithAreaFreedomTemplate` (Grid page), or `BlankPageTemplate` if no standard form region is needed. | A wide detail/child form → the full-width Grid page. Prefer a standard form template unless the Classic page is truly custom. |
| Mini page, **or a detail / child edit page with FEW inputs — `< 15` inputs AND flat** (no tabs / related lists) | `BaseMiniPageTemplate` (Mini page), modal, side panel, or a manual UX decision. | Few-input child forms are better opened as a quick-add / mini card than a full record page. Record whether mini-page behavior is create/edit/preview/quick action. |
| Classic detail based on `BaseGridDetailV2` or configuration grid | Freedom related list/detail data source with `crt.DataGrid`, existing detail component, or custom handler-backed list. | Preserve add/edit/delete restrictions, inline edit behavior, filters, and parent-column binding. |
| Custom Classic module or heavily customized parent schema | Existing Freedom page pattern, `BlankPageTemplate`, or manual decision. | Do not force-fit if the parent template provides behavior that has no Freedom equivalent. |

For each Classic page/detail, record:

- parent schema chain and inherited template behavior
- structural slots used: header, side area, content area, tabs, details, files, feed, action menu, modal area
- candidate Freedom templates considered
- selected Freedom template or existing page
- reason for selection and rejected alternatives

## Control Mapping

| Classic UI Pattern | Freedom UI Analog |
| --- | --- |
| `diff` insert/merge/move/remove operations | `viewConfigDiff` items with stable names and explicit parent placement. |
| Field group or container | `crt.FlexContainer`, `crt.GridContainer`, expansion panel, or form section depending on existing page patterns. |
| Tabs | `crt.TabContainer` and tab items. |
| Details | Freedom detail/list component or related data source section. |
| Section grid | Freedom list page or list component bound to the target data source. |
| Actions menu | Freedom actions, buttons, or handler-backed commands. |
| Mini page | Freedom mini page, modal, side panel, or explicit UX decision if the Classic interaction has no direct analog. |

## Standard features, widgets & actions

The single source of truth for the components agents most often mis-map. When you ran the engine, every
`standardFeatures` entry carries a `uiShape`, widgets arrive under `widgets`, and process launches under
`cardActions` / `needsDecision` (`process-launch`) — the generated design spec already renders each in the
right shape. Honor that shape; do not invent a generic Expanded-list.

> **Keep this in sync with the engine.** These rows encode the same standard-feature / widget knowledge as the
> shared mapping table `../engine/mapping-table.mjs` (the FEATURE, WIDGET, PROFILE_CARD and CARD_ACTION rows —
> the four hand catalogs that used to live in `mapper.mjs` were absorbed into it). The engine is what actually
> emits `standardFeatures` / `widgets` / `cardActions` at runtime; this table is the human-readable guidance and
> the hand-mapping fallback when Node is unavailable. When you add, rename, or reclassify a feature/widget,
> change **both in the same commit** — they must not drift.
>
> Two halves of that rule are now CHECKED rather than trusted (`engine-tests/classic-to-freedom/run-infra.mjs`):
> every `crt.*` type named anywhere in this file must exist in the vendored component registry index, and every
> feature/widget the table carries must be named in this section. What stays hand-curated is everything a
> registry cannot answer: the build recipes, the on-stand checks, and the **Do NOT** column.

| Classic thing | Engine signal | Freedom target | Do NOT |
| --- | --- | --- | --- |
| Approvals / Visa | `standardFeatures` `uiShape: "component"` — recognised by **either half** of a two-part signal (ENG-96571): a detail schema matching `*VisaDetail` **or** `*VisaDetailV2` (both rows resolve to the Approvals feature; the longest-suffix rule keeps `VisaDetailV2` winning where a name could satisfy both), **or** a `RecordVisaId` attribute on the page with no matching detail schema at all — a real Applicant page carried Classic `VisaDetailV2` **plus** a `RecordVisaId` attribute, and only the detail half was recognised before this fix, so the Approvals component was silently dropped from the built page. The attribute half is `APPROVALS_SIGNAL` in `../engine/mapping-table.mjs`, imported by the mapper's signal collection and the plan-time coverage gate. | **TWO components — add BOTH, and `--verify` now gates BOTH (ENG-95859):** the approval **module/widget** (`crt.Approval`) as a **separate container ABOVE the profile island**, and the approval **list** (`crt.ApprovalList`, native — brings its own approve/reject actions, needs no child edit page). Before ENG-95859 only `crt.ApprovalList` was machine-checked, so a build that added just the list read the same as one that added both — see the build recipe below. **A page carrying the signal (either half) with no Approvals feature in the plan must fail the plan-time coverage gate** — silently skipping the whole feature is the ENG-96571 defect this row exists to close. | rebuild as a plain list/DataGrid; **add only the list and stop** (the module above the island is missing — this now reads ❌ MISSING under `--verify`, not a proposal to raise). A Visa's records live in a `*Visa` entity (e.g. `ApplicantVisa`) with an FK to the master — that is *how Creatio stores Approvals*, NOT a reason to reclassify it as "a related list over ApplicantVisa". Recognising only the `V2`-suffixed detail and ignoring a plain `*VisaDetail` or a `RecordVisaId` attribute (the ENG-96571 gap). |
| Attachments / Feed | `standardFeatures` `uiShape: "component"` | the native Attachments / Feed component | rebuild as a generic list. |
| Activities / Emails | `standardFeatures` `uiShape: "list"` | a **filtered related list** — a DataGrid of the child records (Activity/Task, Email) filtered to the master. This IS their native form, not a downgrade. | turn them into a `crt.Timeline` or an email-client component. |
| Means of communication (`ContactCommunication` — "Средства связи контакта") | `standardFeatures` `uiShape: "component"` (inferred by the `ContactCommunication` entity) | the native **Communication-options component** (`crt.CommunicationOptions`, the compositeOnly component the "Communication options" composite assembles — NOT `crt.ContactCommunication`, which is the ENTITY name; `get-component-info` for its contract — it requires the `CrtCustomer360App` package AND the `CommonCommunicationsBehavior` feature). | rebuild it as a plain Expanded-list / DataGrid over `ContactCommunication` (loses the typed add-communication UI, type icons). If the component/package is unavailable on the stand, RAISE it as a decision (add the dependency / confirm) — do NOT silently fall back to a grid. |
| Timeline | `widgets` (only when the classic page has an actual Timeline) | `crt.Timeline` | invent a Timeline for Activities/Emails — those are lists (row above). |
| Action Dashboard = **Case progress bar** + **Next steps** (two components) | `widgets` (`Case progress bar` / `Next steps`) | **The default Freedom form template ships NEITHER — you must ADD them** when the object has a configured DCM case: the **progress bar** on the page top, and **Next steps** as a **NEW tab in the tab container, next to the Feed tab**. Both **auto-populate from the object's case** — do not hand-author stages/steps. **Check on-stand whether the object has a DCM case:** DCM cases are `SysSchema` records with **`ManagerName = 'DcmSchemaManager'`** (the case-schema manager) — query `SysSchema` filtered by `ManagerName eq 'DcmSchemaManager'` and find the case for your entity (match via the case caption/metadata and the object's own `Stage`/case-stage column; a DCM-driven object carries one). Some cases have an active + previous version sharing one caption (e.g. `Recruiting_v11` active, `Recruiting_v1` previous) — take the active one. **A hit ⇒ add both components; no hit ⇒ nothing to add.** ⚠ Do NOT filter by `ManagerName = 'CaseSchemaManager'` — that name is wrong, returns 0 rows, and reads as a false "no case". | treat them as template-provided / "nothing to migrate", or hand-author stage/step lists per page. Conclude "no case" from a query that returned 0 without confirming the filter used `DcmSchemaManager` (not `CaseSchemaManager`). |
| Duplicates (side widget) | `widgets` (`Duplicates`) | the Freedom duplicates widget — surface it only when the classic page actually carried the `DuplicatesWidgetContainer` **with** its own layer evidence (an inherited-but-empty base container is chrome). No registry component is published under a duplicates name, so resolve the exact target on-stand (`get-component-info`, search "duplicate") before building. | assume the target is NOT `crt.Duplicates` — nothing in the component registry is named that; and do not migrate the widget from an inherited base container with no evidence the classic page used it. |
| Recommendations (side widget) | `chromeWidgets` (hidden by default) | inherited base-template container (`BasePageV2`), **empty by default**, filled at runtime by `RecommendationModuleUtilities` (the **Next-Best-Offer / product recommendations**, `RecommendedProduct`). The engine classifies it as base **chrome and HIDES it from the plan** (kept in `chromeWidgets`). Surface it manually ONLY if the live page actually renders recommendations (NBO rules configured for the entity) → then wire the Freedom product-selection / recommendations component. | treat it as page content just because it is in the schema — it's always present but usually empty. |
| **Embedded profile card** — a compact card of a LINKED record dropped into the page by `modules` config (a "requester" block on a request page; `AccountProfile` on `ContactPageV2`) | `profileCards[]` + a `profile-card` ⚠ item | the native Freedom **compact profile** in the **side profile**, keyed by the PROFILED entity: Contact → `crt.ContactCompactProfile`, Account → `crt.AccountCompactProfile`, user → `crt.UserCompactProfile` (the first two need the `CrtCustomer360App` package). Wire it with `referenceColumn: "$<masterColumnName>"` + `readonly: true`. No native component for that entity ⇒ rebuild the card as its own read-only-fields island. Full recipe below. | treat it as an "unknown embedded module" and drop the card (that is exactly the gap this rule closes); mistake the **actions/DCM dashboard** module for a profile card (it carries `masterColumnName` too, but nested under `dashboardConfig`); assume the native card shows everything the classic one did — it does **not** render Phone/Email/JobTitle-style columns, which must be added beside it. |
| Ordinary related lists | `details[]` | a Freedom related list bound to the child data source | confuse them with the standard features above. |
| Run process (record page) | `needsDecision` `process-launch` / `cardActions` | a Freedom "Run process" card action — **only if a process is connected to the section**. Check `ProcessInModules` filtered by the section's `SysModule` (`SysModule/Id eq <id>`) — that is what fills the menu (Section Wizard → Business Processes); resolve each row's `SysSchemaUId` via `VwSysProcess` by `Id` for the name. None connected ⇒ **drop the button**; if some are, name each in the plan. | fabricate a process name, or migrate the button when nothing is connected. The base `ProcessButton` names none; only a literal `executeProcess`/`RunProcessRequest` name in a method is captured directly. `SysProcessEntity`/`VwSysProcessEntity` ("Object in process") are runtime process↔record instances — NOT the section config. |
| Print (record page) | `cardActions` (Print) | a Freedom print action — **only if printables/reports exist** for the section. Check `SysModuleReport` filtered by the section's `SysModule` (`SysModule/Id eq <id>`) + `ShowInSection eq true` (section Print menu) / `ShowInCard eq true` (record card); read each `Caption`/`Type`/`SysReportSchemaUId`\|`FileName`. None ⇒ **drop the button**. | migrate the Print button when the section has no printables (it would be a dead button). |
| Standard page chrome — View options, Tag, Reload, Save/Close/Discard | `cardActions` / base buttons | native Freedom capabilities: **ViewOptions is not migrated**; **Tag is provided by the default template**; Save/Close/Discard/Reload are standard page chrome. | present them as bespoke actions to build. |
| Section actions / add-record mini page / list columns | manifest `section` → the spec's `### List page` block | Freedom list-page actions / a mini page / confirmed list columns | treat these as record-page concerns — they are a *separate* list-page surface the record-page migration does not cover. |

Keep an engine-matched standard feature AS its shape unless you confirm on-stand it genuinely does not use
that feature's infrastructure. Build the native component up front — never build a generic list first and
"switch" it later.

### Verify-side role/analog acceptance (the interim hand table)

A migration builds the **native Freedom component**, not a literal of the Classic name — so when a plan row
expects a Classic-derived component type, `--verify` (`migrate.mjs`, `resolveComponentVk`) must accept the
Freedom **analog** that a correct build actually produces, or a built page reads ❌ MISSING against its own
plan. The accepted pairs are a small **curated hand table** (`COMPONENT_ANALOGS` in
`../engine/designspec.mjs`), sourced from the rows above; `--units` publishes the analog alongside the
planned type (`pages[].componentTypes`) so the executor fetches the right component's documentation, and
`--verify` matches either one.

| Planned (Classic-derived) type | Accepted Freedom analog | Source row |
| --- | --- | --- |
| `crt.ContactCommunication` (the `ContactCommunication` entity name with a `crt.` prefix — never a real component) | `crt.CommunicationOptions` (the native Communication-options component) | *Means of communication*, above |

> **Interim, and deliberately so.** This table is the **hand-maintained** role/analog source until the
> ENG-95543 component registry lands; at that point `resolveComponentVk` / `componentTypesOf` repoint to the
> registry (same expected set, one call site) and this table is retired. Until then, keep it in sync with the
> rows above **in the same commit** — the engine constant and this table must not drift. Match STRICTLY against
> a curated pair; a Freedom analog is never inferred from a name family, so a wrong component cannot falsely
> satisfy a planned row.

### Build recipes for the components agents get wrong (verified on-stand)

**Approvals = TWO components, not one.** `get-component-info` for the approval feature returns **two** parts and
the page needs **both**: (1) the approval **module/widget** — add it as its **own separate container ABOVE the
profile island** (top of the left/side area), and (2) the approval **list** (`crt.ApprovalList`, which brings its
own approve/reject actions). Agents typically add only the list — that is incomplete; the module above the island
is what shows the current approval state/actions. Read `get-component-info` for the exact component types + their
required config before building, and add both.

**Recognising the page carries Approvals at all is a two-part signal (ENG-96571).** Either half is sufficient:
a detail schema ending in `VisaDetail` or `VisaDetailV2` (`resolveFeatureRow` in `../engine/mapping-table.mjs`,
longest suffix wins), **or** a `RecordVisaId` attribute on the page — the attribute can be present with no
matching detail schema at all, which is exactly the case a QA colleague found on a built Applicants section
(Classic page had `VisaDetailV2` **and** `RecordVisaId`; the Freedom page came out with no `crt.ApprovalList`
because only the detail half was checked). `APPROVALS_SIGNAL` in `../engine/mapping-table.mjs` is the single
source for the attribute half (`attributeNames: ["RecordVisaId"]`, `detailPattern: /Visa ?Detail/i`,
`target: "crt.ApprovalList"`, `moduleComponentType: "crt.Approval"`) — the mapper's signal collection and the
plan-time coverage gate both import it, so a page that carries the signal (by either half) but ends up with no
Approvals feature in the plan must fail the coverage gate rather than silently ship without Approvals.

**Resolve the conditional checks BEFORE building — do not defer.** DCM case, connected processes,
printables, and the on-save duplicate check are marked "⚠ ADD only if present" precisely because the schema
alone doesn't say. Run each query at plan time and act on the result; never build "faithful to the classic
body" while a `⚠` on-stand check is still pending — the classic body having no dashboard/button does NOT mean
the section has no case/process.

**On-save duplicate check → does this entity have one, and will it survive?** (ENG-94274) Two separate facts,
because they fail differently.

1. **Is there a rule?** `odata-read DuplicatesRule` (a `BaseLookup` in `CrtDeduplication`); select
   `Name`, `IsActive`, `UseAtSave`, `ProcedureName`. The rows that matter are the ones whose `Object` is your
   entity with **`IsActive` AND `UseAtSave` both true** — `UseAtSave` is the "Use this rule on save" checkbox.
   None ⇒ nothing to lose, record `present: false` and move on. List the matching rule names under **`names`**
   — the CANONICAL key for this signal, and an **array** even for a single rule (`"names": ["Contact
   duplicates. Contact name"]`; a bare string is tolerated but lists nothing). `items` is accepted only because
   the sibling signals use it; no other alias is read.
2. **Can the Freedom flow run on the target stand?** `get-sys-setting DeduplicationWebApiUrl` must be
   non-empty AND the features `ESDeduplication` + `BulkESDeduplication` must be enabled (read
   `AdminUnitFeatureState` via `execute-esq`, columns `Feature.Code` / `FeatureState` — **no state row means
   OFF**). Record the answer as `signals.deduplication.serviceConfigured` (a **boolean**). This one is
   **required whenever `present: true`** — the `--plan` gate treats a rule with no recorded service answer as
   unresolved and exits non-zero, because that is the half-answer that would otherwise ship an approvable plan
   whose own text says the key question is unanswered. With `present: false` it is not needed.

Why both: **Classic has two paths, Freedom has one.** The Classic hook is an `asyncValidate` override in
`CrtDeduplication.BaseEntityPage` that branches on
`if (this.getIsFeatureEnabled("ESDeduplication") && !this.isNewMode())`; with that feature off it falls back to
the rule's own SQL procedure (e.g. `tsp_FindContactDuplicateByName`), so Classic keeps working with no service
at all. The Freedom side is the platform's `crt.ValidateDuplicatesOnSaveHandler` (registered on
`crt.SaveDataRequest`, scoped to `BasePageTemplate` / `BaseMiniPageTemplate`, so entity-generic) plus the
`DuplicateNotificationPage` dialog — and it goes through the deduplication service. Measured 2026-08-21 on a
stand newer than 8.3.4: Classic posted `DeduplicationService/FindDuplicatesOnSave` and showed its duplicates
screen, while the Freedom form page issued only `InsertQuery` and saved the duplicate silently, with
`DeduplicationWebApiUrl` empty and the ES features off.

So a rule **with** the service configured ⇒ verify the dialog on the built page. A rule **without** it ⇒ the
check stops at migration, silently; that is a decision for the operator (configure the service, keep the
Classic page for this entity, install the `Deduplication Freedom UI enhancements` marketplace app, or accept
the loss). Never write this up as "Freedom cannot check duplicates" — it can, and the wording must stay true
the day the service is turned on. Note the rules themselves live on the ENTITY, not the page, so they survive
the page migration untouched — only the check is at risk.

**Scope of the answer: one entity.** The recorded answer describes the entity of the page it was resolved for,
so the engine carries it to every fold of the SAME entity — each per-type form of a typed entity and the
add-record mini page each get their own row. A **child edit page** is a different entity: it gets a
child-scoped row telling you to run step 1 for THAT entity, never the parent's verdict (the same convention as
the section-level Print / Run-process notes). Record the child's own answer as `signals.deduplication` **on that
child's bundle** and the instruction is replaced by the real verdict for its entity — an operator who runs the
query must have a way to close the row, and `present: false` there closes it with no row at all.

**DCM case → does the object have one?** `SysSchema` WHERE `ManagerName = 'DcmSchemaManager'` (the case-schema
manager). Match the case to the entity by its caption + the object's own stage column (`Stage`); active +
previous versions can share a caption (`Recruiting_v11` active, `Recruiting_v1`) — take the active one. A hit
⇒ the object IS case-driven, add BOTH components below, EVEN IF the classic page tracked stage only via a
`Stage` lookup + a history detail. ⚠ Do NOT filter by `ManagerName = 'CaseSchemaManager'` — wrong name,
0 rows, false "no case" (this is exactly the miss that dropped the stage bar on a real Applicant migration).

**Case-stage progress bar** — when the DCM check finds a case, the BEST route is to build the form page from
**`PageWithTabsAndProgressBarTemplate`** (it ships the progress bar already placed) instead of hand-adding the
widget — decide this at plan time (`planMeta.formTemplate`). After `create-page`, that new page is bound to the
template's demo object, so **re-bind it to your entity** (point the page's entity / data source at the target
object) before building the rest. FALLBACK (already on a no-bar template, or the page exists): hand-add
`crt.EntityStageProgressBar` (`entityName`, `recordId: $Id`, `value: $PDS_<stage>`, `saveOnChange: true`) in
**`MainContainer`** (the content container BELOW the header) at the **top of the content** (first child, above
the tabs) — NOT in `MainHeader`, and NOT as a bare child of `Main`. If it hangs in a loading spinner, wire the
page-level DCM handlers (`crt.EntityStageProgressBarLoadDataRequest`, `stageChanged`, `setAllowedStages`).

**Next steps** — a **tab in the card toggle panel, beside the Feed and Attachments tabs**, built EXACTLY like
them (read a working page such as an Account page for the reference shape): the tab `caption` via
`#ResourceString(<Key>)#` **not** `$Resources.Strings.*` (the toggle-panel caption won't render otherwise); set
the tab `icon` to **`flag-icon`** (+ `iconPosition`) — do not guess an icon name (an invented `next-steps-icon`
renders empty); put the header — a `crt.Label` "Next steps" (headline-3) + a `crt.Button` "+" (menu: Create task
/ Create email) — in the tab's **`tools`** slot, and the `crt.NextSteps` widget in `items` (a GridContainer).
Header in `items` instead of `tools` = a tab you can't drop into and a hidden caption. Each step renders as
icon + title + button (the widget's own item shape — do not hand-author steps).

**Run process (record vs list) — read the BINDING, then place on the surface(s) it is connected to.**
`ProcessInModules` filtered by the section's `SysModule/Id` says which module(s) a process is bound to. A
process can be connected to the section's **list/registry** module, to the **record card/edit-page** module,
or to **BOTH** — do not assume list-only or form-only; place it on **each** surface it is bound to (checking
list-only, as the Applicant test did, is correct *only* when the binding is list-only). Never a standalone
button; always a **menu item in the template's existing `Actions` button**, one Actions button per page, label
= the process **display Caption** (from `VwSysProcess`), never the technical code. Launch via
`crt.RunBusinessProcessRequest`, passing the record Id into the record parameter from the process signature
(e.g. `Applicant1`):

- **List page** → the list's `Actions` button (`ActionButton` in ListPageV3), `processRunType: ForTheSelectedRecords`, `dataSourceName: PDS` (runs for the selected row(s)).
- **Form / record page** → the form page's OWN `Actions` button in the header action area (the header action-buttons container the template provides, e.g. `ActionButtonsContainer` in `PageWithTabsFreedomTemplate` — mirror the list-page Actions pattern, do NOT invent a new button and do NOT drop a bare button in the content). **Place it at the END of that container, next to the `CloseButton`** (last position — the standard spot for record actions), not first/mid-container. Run for the CURRENT record: pass `$Id` (`processRunType` = the current record, not `ForTheSelectedRecords`). If the template exposes no Actions menu on the form, that gap is a manual decision to raise, not a reason to place a loose button.

None connected on a surface ⇒ nothing on that surface. None connected anywhere ⇒ drop the button entirely.

### Embedded profile cards (linked-record blocks) → the Freedom side profile

A Classic page can embed a **compact card of a linked record**: a request page shows a "requester" block with
the person's name and contacts, `ContactPageV2` shows the contact's account, `AccountPageV2` shows its primary
contact. It is a page-within-a-page — and it is **not custom code**: a small declarative profile schema plus
three config properties. The engine recognises it and emits `changeSet.profileCards`; this section is the
manual recipe (and the fallback for the cases the rule does not cover).

**Recognise it — the Classic side.** In the page's `modules` block, a module whose `config` carries
`parameters.viewModelConfig.masterColumnName`:

```js
modules: /**SCHEMA_MODULES*/{
    "RequesterProfile": {
        "config": {
            "schemaName": "RequesterProfilePage",       // the embedded profile schema
            "parameters": { "viewModelConfig": {
                "masterColumnName": "Requester",        // lookup ON THIS page whose value IS the profiled record
                "profileColumnName": "Contact"          // column on the PROFILED entity pointing back at the master
                // … display flags (IsPhoneVisible, …)
            } }
        }
    }
}
```

plus its host item in the `diff` — `{ name: "RequesterProfile", parentName: "LeftModulesContainer", values: { itemType: Terrasoft.ViewItemType.MODULE } }`.
That host item is what an un-taught converter reports as an unknown embedded module.

Read the two wiring properties correctly (verified against `BaseProfileSchema`, not inferred):

- `masterColumnName` — the lookup **on the master page**; its value **is the profiled record's Id**
  (`BaseProfileSchema.loadEntity` loads the profile entity from it). This is the one binding the card needs.
- `profileColumnName` — a column on the **profiled** entity pointing back at the master. It is used **only**
  when the classic blank slate CREATED a new linked record (to pre-fill the back-reference), never for display.
- The **profiled entity** is the profile schema's own `entitySchemaName` (`RequesterProfilePage` → `Contact`) —
  read it from the schema body, or from the master lookup's referenced schema. Do not guess it from the name.

**The Freedom side.** Native compact-profile components live in the side profile and take the master lookup as
`referenceColumn` (a GUID attribute, not a display value):

| Profiled entity | Freedom component | Package |
| --- | --- | --- |
| `Contact` | `crt.ContactCompactProfile` | `CrtCustomer360App` |
| `Account` | `crt.AccountCompactProfile` | `CrtCustomer360App` |
| `SysAdminUnit` / user | `crt.UserCompactProfile` | — |
| anything else | *no native card* → read-only-fields island (steps below) | — |

**Ordered manual steps.**

1. **Read the classic card.** From the `modules` config take `schemaName`, `masterColumnName`,
   `profileColumnName` and the display flags; fetch the profile schema
   (`get-client-unit-schema --schema-name <ProfileSchema>`) and list its `bindTo` columns — those are the values
   the card actually displayed. Do this first: everything below depends on it (and the engine's structure gate
   blocks the plan until that body is in `manifest.profileSchemas`, or the entry is recorded as `false` once you
   have verified there is no separate profile schema to read — the same verified-none vs never-checked
   distinction as `editPage: false` / `addRecordMiniPage: false`).
2. **Pick the target** from the table above, using the profile schema's `entitySchemaName`.
3. **Confirm the package** on the target environment (`list-packages`) and add it as a dependency of the page's
   package. Without `CrtCustomer360App` the Contact/Account cards do not render at all.
4. **Insert the component into the side profile** (`SideAreaProfileFieldFlexContainer` / the template's
   side-profile container), read-only, with `referenceColumn` pointing at a view-model attribute over the master
   lookup. This is the shape the OOTB `Opportunities_FormPage` uses for its account/contact cards — copied from
   it, not invented:

   ```jsonc
   // viewModelConfigDiff — the attribute that carries the profiled record's Id
   { "operation": "merge", "path": ["attributes"], "values": {
       "RequesterRef": { "modelConfig": { "path": "PDS.Requester" } }
   } }

   // viewConfigDiff
   {
     "operation": "insert",
     "name": "RequesterCompactProfile",
     "parentName": "SideAreaProfileFieldFlexContainer",
     "propertyName": "items",
     "index": 0,
     "values": {
       "type": "crt.ContactCompactProfile",
       "referenceColumn": "$RequesterRef",  // attribute over the MASTER lookup — the profiled record's Id
       "readonly": true,                    // embedded on a related-entity page: a view of another record
       "layoutConfig": {}
     }
   }
   ```

   `referenceColumn` must resolve to a **GUID**, never a `{ value, displayValue }` lookup object or a display
   value — a card wired to a display value renders empty.

5. **Add back the values the native card does not render.** It covers photo + name (+ country/city/time zone,
   birth date). Classic cards routinely also showed Phone, Email, JobTitle, Web, Industry — for each such
   column add a **read-only field over a lookup-path data-source attribute** beside the card. The shape
   (verified on-stand — this is exactly how the OOTB `Chats_FormPage` reads `Channel.Provider`):

   ```jsonc
   // modelConfigDiff
   { "operation": "merge", "path": ["dataSources", "PDS", "config", "attributes"], "values": {
       "RequesterMobilePhone": { "path": "Requester.MobilePhone", "type": "ForwardReference" }
   } }
   ```

   `type: "ForwardReference"` is required for a path that traverses a lookup — without it the attribute does
   not resolve. Dropping these values is the usual fidelity loss. (For a value that is NOT a column of the
   profiled entity at all, use the companion-field pattern below — a view-model attribute filled by the
   lookup's on-change handler.)
6. **Reproduce the create-from-blank-slate flow only if needed.** The classic card offered Add/Find when the
   lookup was empty; Find is the lookup's own select. Only if the page must also CREATE the linked record, wire
   that and pre-fill `profileColumnName` with the master record.
7. **Keep the record link.** The classic header was a hyperlink opening the profiled record — confirm the
   Freedom card (or an adjacent field) still gets the user there.

**No native component for the profiled entity** (a custom entity): rebuild the card as its **own
`crt.GridContainer` island** in `SideAreaProfileContainer` (single-column, styled like the island the template
already provides — see *Profile islands* below) holding one **read-only** field per displayed column, each over
a `{ path: "<masterColumn>.<column>", type: "ForwardReference" }` PDS attribute as in step 5, plus the record
link. Never drop the card, and never flatten its fields into the master record's own group.

**A POLYMORPHIC client profile maps to TWO cards.** When the profile schema declares **no**
`entitySchemaName` (it profiles an Account *or* a Contact depending on the record — `ClientProfileSchema`,
`BaseMultipleProfileSchema`, as `OpportunityPageV2` · `"ClientProfile"` · `masterColumnName: "Client"` does),
there is no single Freedom counterpart: build **both** native cards, each over its own lookup and shown
conditionally. The OOTB `Opportunities_FormPage` does exactly that — `crt.AccountCompactProfile` over
`PDS.Account` plus `crt.ContactCompactProfile` over `PDS.Contact`, both `readonly: true`. The engine reports
this card with an unresolved profiled entity, which is the signal to check for this case before falling back to
hand-built fields.

**Example pairs (OOTB, all three verified on-stand).**

| Classic | Freedom |
| --- | --- |
| `ContactPageV2` · `"AccountProfile"` → `AccountProfileSchema`, `masterColumnName: "Account"` (no `profileColumnName`); card showed Type, Owner, Web, Phone, AccountCategory, Industry | `crt.AccountCompactProfile` in the side profile, `readonly: true`, `referenceColumn` over `PDS.Account` + read-only `Account.Web` / `Account.Phone` / `Account.Industry` … fields beside it |
| `AccountPageV2` · `"ContactProfile"` → `ContactProfileSchema`, `masterColumnName: "PrimaryContact"`, `profileColumnName: "Account"`; card showed JobTitle, MobilePhone, Phone, Email | `crt.ContactCompactProfile`, `readonly: true`, `referenceColumn` over `PDS.PrimaryContact` + read-only `PrimaryContact.JobTitle` / `.MobilePhone` / `.Phone` / `.Email` fields beside it |
| `OpportunityPageV2` · `"ClientProfile"` → `ClientProfileSchema` (no `entitySchemaName` — polymorphic), `masterColumnName: "Client"` | **both** cards on `Opportunities_FormPage`: `crt.AccountCompactProfile` over `PDS.Account` and `crt.ContactCompactProfile` over `PDS.Contact`, each `readonly: true` — plus the denormalized companion fields (`AccountWeb`, `AccountIndustry`, `ContactJobTitle`, …) |

**Profile islands — build EVERY one the plan shows; do not collapse "for simplicity".** When the classic
left area groups fields into more than one island, the plan lists them — each as a `Side profile › <island>`
region and in the `[profile-island]` confirm item (e.g. `ContactContainer` + `InternalRequestContainer`).
Build **each island as its own `crt.GridContainer` under `SideAreaProfileContainer`** (single-column grid),
preserving the split. **Any island container you ADD must match the styling of the one the template already
provides** — copy its `color`/`backgroundColor`, `padding`, `borderRadius` (and other card settings) from the
template's profile island so the added container looks identical, not a bare/differently-styled box. Merging
several islands into one container is a **silent plan deviation** — if a single card is genuinely better,
propose it, don't apply it unannounced. (A single island stays flat, no wrapper — that is the one case with no
separate container.)

**Auto-filled companion fields — build them read-only, don't drop them (this is what leaves a lone-field
island).** A field in the plan whose column is NOT on the entity is usually **auto-filled from a selected
lookup**: e.g. the InternalRequest island has `Request` (a lookup) plus `Department` and `Job title` that are
loaded from the chosen Request by an `onInternalRequestChange` / `setInternalRequestInfo` handler — they are
NOT `Applicant` columns. Build each such companion as a **read-only field bound to a VIEW-MODEL attribute**
(not a data-source column), and wire the lookup's on-change handler to load its value from the selected record
(and clear on deselect). Do NOT drop a planned field just because it has no real entity column — dropping the
companions is exactly what collapses the island to a single lookup. If an island/group ends up with **one
field**, treat it as a red flag (ui-guidelines flags the lone-field anti-pattern) and recover its
auto-filled/companion fields before shipping.

## Data And Binding Mapping

| Classic UI Pattern | Freedom UI Analog |
| --- | --- |
| Entity schema column field | Data-source-bound view model attribute and field control. |
| Virtual attribute | View model attribute, converter, handler-loaded value, or backend-calculated field. |
| Lookup list config/filter | Lookup attribute and business rule/filter handler. |
| Default value in `methods` | Entity business rule, page handler, or backend default depending on scope. |
| Localizable strings | Freedom UI resources only for custom captions/messages that are not auto-provided by data-source attributes. |

## Business Logic Mapping

| Classic UI Pattern | Preferred Freedom Target |
| --- | --- |
| `businessRules` visibility/editability/required | Page or entity business rule. |
| Simple dependent lookup | Entity business rule with `apply-filter` when supported. |
| `onEntityInitialized`, `init`, `onSaved`, `save` overrides | Freedom request handlers for equivalent lifecycle requests. |
| Button click methods | Freedom button bound to a request handler. |
| Sandbox messages | Handler-mediated communication, shared service, or explicit event replacement design. |
| Process launch | Freedom handler calling the existing process/service. |
| Service call | Freedom handler using the approved service/client pattern. |
| Permission-driven UI | Backend permission check plus Freedom handler/rule state; do not rely only on hidden controls. |
| Complex validation | Freedom validator or backend validation, depending on whether it must block persistence globally. |

## Planning Rules

- Prefer declarative Freedom configuration over custom JavaScript when behavior is equivalent.
- Preserve business behavior before preserving pixel-level Classic layout.
- Mark every Classic method that affects user-visible behavior as mapped, intentionally dropped, or blocked.
- Treat security, permission, and data-integrity logic as migration-critical.
- Treat unsupported Classic UX patterns as product decisions, not implementation details.

## Classic layout & business rules: read ALL package schemas, not just the top one

> **Preferred: run the bundled deterministic engine (`engine/migrate.mjs`, see SKILL.md step 4) instead of merging schemas by hand.** It implements exactly the procedure below — enumerate the chain and merge `diff` / `details` / `businessRules` across schemas with provenance and symbolic-enum-safe rule decoding — deterministically and instantly, and emits the Freedom ChangeSet + `needsDecision[]`. The manual procedure here is the reference for what the engine does and the fallback when Node is unavailable.

`get-client-unit-schema` (and any single-schema read) returns only the OWN body of the
top-most replacing schema for that name. For a base-product Classic page that top schema is
frequently a thin override whose `diff`, `details`, and `businessRules` blocks are EMPTY
(`/**SCHEMA_DIFF*/[]`, `/**SCHEMA_BUSINESS_RULES*/{}`). The real layout, details, and
business rules live in ANCESTOR package schemas.

Hard rule: an empty `diff` / `businessRules` / `details` in one schema is NOT evidence that
the page has none. NEVER state "the Classic page has no business rules / no layout / no
details" based on a single schema's body. Doing so is a discovery defect, not a finding.

Correct discovery procedure for every Classic page/section/detail:
1. Enumerate ALL replacing schemas for the name across packages (e.g. `list-pages` /
   `list-entity-client-schemas` by schema-name) and record the full package chain,
   base → top.
2. Read each schema's own body. If the read tool only resolves the top schema, obtain the
   lower schemas by:
   - pulling package source with `download-configuration-by-environment` and grepping
     `businessRules` / `SCHEMA_DIFF` across every `*PageV2` / `*SectionV2` body, or
   - reading the schema directly in the Client Unit Schema designer.
3. Merge `diff`, `details`, and `businessRules` across schemas to reconstruct the effective
   Classic page. Attribute each item to the schema it came from.
4. In the plan's discovery-evidence table, add a "schema coverage" row: list which schemas
   were actually read and which were not. Mark any business rule / field / detail as
   CONFIRMED only when its source schema body was read; otherwise mark it INFERRED and list
   it as a missing-source risk.

## Distinguish declarative business rules from imperative logic — they map differently

When reading a Classic page body, classify behavior by WHERE it is defined, because the
Freedom target differs:

- Declarative `businessRules` block → migrate with `create-page-business-rules` /
  `create-entity-business-rules`.
  - `ruleType: 0` = BINDPARAMETER, with `property`: 0=Visible, 1=Enabled, 2=Required,
    3=Readonly; `conditions[]` hold `leftExpression` (attribute + attributePath) /
    `comparisonType` / `rightExpression` (constant or attribute). Example:
    `Parent` required when `Type.IsSlave == true`.
  - `ruleType: 1` = FILTRATION, filters a lookup by `baseAttributePatch` + `comparisonType`
    + `value`. Example: filter `Owner` by `Account`.
- Imperative logic in `attributes` (`lookupListConfig.filters`, `dependencies`) and
  `methods` (ESQ queries, `on*Changed`, `onEntityInitialized`, save overrides) → migrate as
  Freedom handlers (`crt.HandlerChainService`), converters, or virtual attributes, NOT as
  business rules.
  - `lookupListConfig.filters` is the IMPERATIVE twin of a FILTRATION rule: the same
    user-visible behaviour ("this lookup is filtered"), but it needs a filter handler, not
    `create-entity-business-rules`. Reporting the page as "no lookup filters" because the
    `businessRules` block has none is the error this distinction exists to prevent.
  - `dependencies: [{ columns, methodName }]` names the TRIGGER of a method directly — use it
    instead of reading intent out of the method's name.
  - An attribute with NO entity column behind it is page UI state (an editability/mode flag, a
    collection backing a menu). No field insert carries it, so it must be created as a Freedom
    view-model attribute with its default, and whatever read it re-wired.
- `messages` (the sandbox contract, with `mode`/`direction`) and `mixins` are members too:
  a message's counterpart lives in ANOTHER schema, and a mixin's members are defined outside the
  page body entirely. Neither is visible in the page's own `diff`/`methods`, and neither may be
  reported as absent — resolve the counterpart, then choose the Freedom shape (handler-mediated
  request / shared service / ported behaviour).
- A method written as `name: SomeModule.Method` has no body in this schema at all. The behaviour
  to port lives in that `define()` dependency; read it there.

The engine enforces all of the above through its `coverage` gate (the member ledger): every
`diff` op, method, attribute, message, mixin, `define()` dependency and details entry is either
mapped, on a `⚠` worklist, recorded as base-template context, or the plan is blocked.

Report the two categories separately in the Business Logic Analysis section so declarative
rules are not silently converted into custom handlers (or vice versa).

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
| Classic owning package is editable, source-owned, present in the repo, and matches the target app ownership | Same package | Preferred only when repository ownership and runtime editability are both clear. |
| Classic owning package is locked, installed, or vendor/base-owned, but Creatio can create replacing schemas in the design package | Replacing/extension package | Use for page replacements or additive Freedom artifacts that should not mutate the locked source package. |
| Classic owning package is read-only, missing locally, unsafe to mutate, or user wants isolation | New package/app | Default safe option when ownership is uncertain or migration should be parallel. |
| Existing Freedom page for the same entity already exists in an editable app/package | Update existing Freedom package/page | Avoid duplicate sections/pages unless there is a documented reason. |
| Package lock/editability cannot be verified and implementation would touch shared/base assets | Manual decision or blocked | Planning can continue, but implementation must wait for package ownership confirmation. |

Evidence to collect:

- package name, UId, maintainer, install type or lock/read-only indicators
- installed app ownership and section ownership
- local repository package descriptor/project presence
- existing replacing schemas or Freedom pages for the same entity
- explicit user package strategy, if provided

## Layout Mapping

Start with the page template, then map child controls. Do not choose a Freedom form template only from the entity name or section caption.

## Template Mapping

| Classic Template/Parent Pattern | Freedom UI Analog | Notes |
| --- | --- | --- |
| `BaseSectionV2` section grid | `ListPageV3Template` or an existing Freedom list page for the same entity. | Preserve folders, import/export, tags, summaries, actions, and grid columns where applicable. |
| `BaseModulePageV2` edit page with tabs/details/files/notes | `PageWithTabsFreedomTemplate` or an existing form page. | Default choice for Classic cards with tabbed detail areas. |
| Classic card with important side/profile area and right panel behavior | `PageWithRightAreaAndTabsFreedomTemplate` or existing right-area form page. | Use when the side/right area is functional, not merely decorative. |
| Classic card organized around top header/status/stage region | `PageWithTopAreaAndTabsFreedomTemplate` or template with top area. | Use when top-area fields or process/status controls are central to the workflow. |
| Simple edit page without tabs or details | `PageWithAreaFreedomTemplate` or `BlankPageTemplate` if no standard form region is needed. | Prefer a standard form template unless the Classic page is truly custom. |
| Mini page | `BaseMiniPageTemplate`, modal, side panel, or a manual UX decision. | Record whether mini-page behavior is create/edit/preview/quick action. |
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

> **Keep this in sync with the engine.** These rows encode the same standard-feature / widget knowledge as
> `../engine/mapper.mjs` (`FEATURE_CATALOG`, `WIDGET_BY_MODULE`, `WIDGET_BY_CONTAINER`) — the engine is what
> actually emits `standardFeatures` / `widgets` / `cardActions` at runtime; this table is the human-readable
> guidance and the hand-mapping fallback when Node is unavailable. When you add, rename, or reclassify a
> feature/widget, change **both in the same commit** — they must not drift.

| Classic thing | Engine signal | Freedom target | Do NOT |
| --- | --- | --- | --- |
| Approvals / Visa | `standardFeatures` `uiShape: "component"` | **TWO components (both from `get-component-info`) — add BOTH:** the approval **module/widget** as a **separate container ABOVE the profile island**, and the approval **list** (`crt.ApprovalList`, native — brings its own approve/reject actions, needs no child edit page). See the build recipe below. | rebuild as a plain list/DataGrid; **add only the list and stop** (the module above the island is missing). A Visa's records live in a `*Visa` entity (e.g. `ApplicantVisa`) with an FK to the master — that is *how Creatio stores Approvals*, NOT a reason to reclassify it as "a related list over ApplicantVisa". |
| Attachments / Feed | `standardFeatures` `uiShape: "component"` | the native Attachments / Feed component | rebuild as a generic list. |
| Activities / Emails | `standardFeatures` `uiShape: "list"` | a **filtered related list** — a DataGrid of the child records (Activity/Task, Email) filtered to the master. This IS their native form, not a downgrade. | turn them into a `crt.Timeline` or an email-client component. |
| Means of communication (`ContactCommunication` — "Средства связи контакта") | `standardFeatures` `uiShape: "component"` (inferred by the `ContactCommunication` entity) | the native **Communication-options component** (`crt.ContactCommunication`; `get-component-info` for its contract — it may require the `CrtCustomer360App` package). | rebuild it as a plain Expanded-list / DataGrid over `ContactCommunication` (loses the typed add-communication UI, type icons). If the component/package is unavailable on the stand, RAISE it as a decision (add the dependency / confirm) — do NOT silently fall back to a grid. |
| Timeline | `widgets` (only when the classic page has an actual Timeline) | `crt.Timeline` | invent a Timeline for Activities/Emails — those are lists (row above). |
| Action Dashboard = **Case progress bar** + **Next steps** (two components) | `widgets` (`Case progress bar` / `Next steps`) | **The default Freedom form template ships NEITHER — you must ADD them** when the object has a configured DCM case: the **progress bar** on the page top, and **Next steps** as a **NEW tab in the tab container, next to the Feed tab**. Both **auto-populate from the object's case** — do not hand-author stages/steps. **Check on-stand whether the object has a DCM case:** DCM cases are `SysSchema` records with **`ManagerName = 'DcmSchemaManager'`** (the case-schema manager) — query `SysSchema` filtered by `ManagerName eq 'DcmSchemaManager'` and find the case for your entity (match via the case caption/metadata and the object's own `Stage`/case-stage column; a DCM-driven object carries one). Some cases have an active + previous version sharing one caption (e.g. `Recruiting_v11` active, `Recruiting_v1` previous) — take the active one. **A hit ⇒ add both components; no hit ⇒ nothing to add.** ⚠ Do NOT filter by `ManagerName = 'CaseSchemaManager'` — that name is wrong, returns 0 rows, and reads as a false "no case". | treat them as template-provided / "nothing to migrate", or hand-author stage/step lists per page. Conclude "no case" from a query that returned 0 without confirming the filter used `DcmSchemaManager` (not `CaseSchemaManager`). |
| Recommendations (side widget) | `chromeWidgets` (hidden by default) | inherited base-template container (`BasePageV2`), **empty by default**, filled at runtime by `RecommendationModuleUtilities` (the **Next-Best-Offer / product recommendations**, `RecommendedProduct`). The engine classifies it as base **chrome and HIDES it from the plan** (kept in `chromeWidgets`). Surface it manually ONLY if the live page actually renders recommendations (NBO rules configured for the entity) → then wire the Freedom product-selection / recommendations component. | treat it as page content just because it is in the schema — it's always present but usually empty. |
| Ordinary related lists | `details[]` | a Freedom related list bound to the child data source | confuse them with the standard features above. |
| Run process (record page) | `needsDecision` `process-launch` / `cardActions` | a Freedom "Run process" card action — **only if a process is connected to the section**. Check `ProcessInModules` filtered by the section's `SysModule` (`SysModule/Id eq <id>`) — that is what fills the menu (Section Wizard → Business Processes); resolve each row's `SysSchemaUId` via `VwSysProcess` by `Id` for the name. None connected ⇒ **drop the button**; if some are, name each in the plan. | fabricate a process name, or migrate the button when nothing is connected. The base `ProcessButton` names none; only a literal `executeProcess`/`RunProcessRequest` name in a method is captured directly. `SysProcessEntity`/`VwSysProcessEntity` ("Object in process") are runtime process↔record instances — NOT the section config. |
| Print (record page) | `cardActions` (Print) | a Freedom print action — **only if printables/reports exist** for the section. Check `SysModuleReport` filtered by the section's `SysModule` (`SysModule/Id eq <id>`) + `ShowInSection eq true` (section Print menu) / `ShowInCard eq true` (record card); read each `Caption`/`Type`/`SysReportSchemaUId`\|`FileName`. None ⇒ **drop the button**. | migrate the Print button when the section has no printables (it would be a dead button). |
| Standard page chrome — View options, Tag, Reload, Save/Close/Discard | `cardActions` / base buttons | native Freedom capabilities: **ViewOptions is not migrated**; **Tag is provided by the default template**; Save/Close/Discard/Reload are standard page chrome. | present them as bespoke actions to build. |
| Section actions / add-record mini page / list columns | manifest `section` → the spec's `### List page` block | Freedom list-page actions / a mini page / confirmed list columns | treat these as record-page concerns — they are a *separate* list-page surface the record-page migration does not cover. |

Keep an engine-matched standard feature AS its shape unless you confirm on-stand it genuinely does not use
that feature's infrastructure. Build the native component up front — never build a generic list first and
"switch" it later.

### Build recipes for the components agents get wrong (verified on-stand)

**Approvals = TWO components, not one.** `get-component-info` for the approval feature returns **two** parts and
the page needs **both**: (1) the approval **module/widget** — add it as its **own separate container ABOVE the
profile island** (top of the left/side area), and (2) the approval **list** (`crt.ApprovalList`, which brings its
own approve/reject actions). Agents typically add only the list — that is incomplete; the module above the island
is what shows the current approval state/actions. Read `get-component-info` for the exact component types + their
required config before building, and add both.

**Resolve the conditional checks BEFORE building — do not defer.** DCM case, connected processes, and
printables are marked "⚠ ADD only if present" precisely because the schema alone doesn't say. Run each query
at plan time and act on the result; never build "faithful to the classic body" while a `⚠` on-stand check is
still pending — the classic body having no dashboard/button does NOT mean the section has no case/process.

**DCM case → does the object have one?** `SysSchema` WHERE `ManagerName = 'DcmSchemaManager'` (the case-schema
manager). Match the case to the entity by its caption + the object's own stage column (`Stage`); active +
previous versions can share a caption (`Recruiting_v11` active, `Recruiting_v1`) — take the active one. A hit
⇒ the object IS case-driven, add BOTH components below, EVEN IF the classic page tracked stage only via a
`Stage` lookup + a history detail. ⚠ Do NOT filter by `ManagerName = 'CaseSchemaManager'` — wrong name,
0 rows, false "no case" (this is exactly the miss that dropped the stage bar on a real Applicant migration).

**Case-stage progress bar** — `crt.EntityStageProgressBar` (`entityName`, `recordId: $Id`, `value: $PDS_<stage>`,
`saveOnChange: true`). Place it in **`MainContainer`** (the content container BELOW the header) at the **top of
the content** (first child, above the tabs) — NOT in `MainHeader`, and NOT as a bare child of `Main`. If it hangs
in a loading spinner, wire the page-level DCM handlers (`crt.EntityStageProgressBarLoadDataRequest`,
`stageChanged`, `setAllowedStages`).

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
| Service call | Freedom handler using the approved service/client pattern from the repository. |
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

Report the two categories separately in the Business Logic Analysis section so declarative
rules are not silently converted into custom handlers (or vice versa).

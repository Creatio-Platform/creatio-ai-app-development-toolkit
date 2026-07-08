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

## Classic layout & business rules: read ALL package layers, not just the top one

`get-client-unit-schema` (and any single-schema read) returns only the OWN body of the
top-most replacing schema for that name. For a base-product Classic page that top layer is
frequently a thin override whose `diff`, `details`, and `businessRules` blocks are EMPTY
(`/**SCHEMA_DIFF*/[]`, `/**SCHEMA_BUSINESS_RULES*/{}`). The real layout, details, and
business rules live in ANCESTOR package layers.

Hard rule: an empty `diff` / `businessRules` / `details` in one layer is NOT evidence that
the page has none. NEVER state "the Classic page has no business rules / no layout / no
details" based on a single layer's body. Doing so is a discovery defect, not a finding.

Correct discovery procedure for every Classic page/section/detail:
1. Enumerate ALL replacing schemas for the name across packages (e.g. `list-pages` /
   `list-client-unit-schemas` by schema-name) and record the full package chain,
   base → top.
2. Read each layer's own body. If the read tool only resolves the top layer, obtain the
   lower layers by:
   - pulling package source with `download-configuration-by-environment` and grepping
     `businessRules` / `SCHEMA_DIFF` across every `*PageV2` / `*SectionV2` body, or
   - reading the layer directly in the Client Unit Schema designer.
3. Merge `diff`, `details`, and `businessRules` across layers to reconstruct the effective
   Classic page. Attribute each item to the layer it came from.
4. In the plan's discovery-evidence table, add a "layer coverage" row: list which layers
   were actually read and which were not. Mark any business rule / field / detail as
   CONFIRMED only when its source layer body was read; otherwise mark it INFERRED and list
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

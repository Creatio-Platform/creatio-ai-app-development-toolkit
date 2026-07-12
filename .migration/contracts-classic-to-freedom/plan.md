# Contracts Classic → Freedom UI — Migration Plan

Status: **DRAFT — awaiting approval** · Scope: single section (`ContractSectionV2`) · Parity target: **FULL** · Strategy: **enhance the existing Freedom section (no duplicate)**

## 1. Input And Resolved Target

- **Original input:** `http://ts1-core-dev04:88/workenu.workbuild.103_15688915_0726/0/Shell/#SectionModuleV2/ContractSectionV2`
- **Resolved environment:** `workbuild103_15688915_0726` (host `ts1-core-dev04:88`, product = internal work build 103; SalesEnterprise/ServiceEnterprise/StudioEnterprise installed)
- **Resolved section:** Contracts (Classic `ContractSectionV2`), entity `Contract`
- **Entity schema:** `Contract` (50 columns; primary display column `Number`)
- **Classic schemas (resolved via MCP):**
  - Section: `ContractSectionV2` — top layer in `WorkContractsProcess` (empty passthrough); base in `CoreContracts` (parent `BaseSectionV2`); override in `WorkSalesBase`
  - Edit page: `ContractPageV2` — base in `CoreContracts` (parent `BaseModulePageV2`); overrides in `WorkSalesBase`, `WorkOverride`, `ContractInOrder`, `ContractInInvoice`, `WorkCompliance` (top override with the banking-details automation)
  - Details: `ContractDetailV2`, `ContractProductDetailV2`, `SpecInContractDetail`, `ContractVisaInOrderDetail`, banking-details detail
- **Classic parent templates:** `BaseSectionV2` (section), `BaseModulePageV2` (edit page)
- **Freedom template analog:** existing `PageWithTabsFreedomTemplate` (form) + `ListPageV3Template` (list) — reused, not re-selected
- **Existing Freedom UI schemas (the migration target):**
  - `Contracts_FormPage` — package `CrtOrderContractMgmtApp` (Creatio, LOCKED)
  - `Contracts_ListPage` — package `CrtContract` (Creatio, LOCKED)
  - `ContractsAnalyticsDashboard` — package `CrtContract`
  - App: **Order and Contract Management** (`CrtOrderContractMgmtApp` v1.12.1)
- **Package/application ownership:** all product Contract packages are Creatio/Terrasoft-maintained (locked). Editable customer package present: **`CrtOrderContractMgmtApp_8c66nu1`** (maintainer = Customer).
- **Package placement decision:** put all changes as **replacing schemas in `CrtOrderContractMgmtApp_8c66nu1`** (replacing `Contracts_FormPage`, and a replacing/handler module for the banking automation). Do not mutate any locked Creatio package. Do not create a new Contracts section — one entity, one Freedom section.

## 2. Discovery Evidence And Missing-Source Risks

| Source | Status | Evidence | Risk |
| --- | --- | --- | --- |
| Creatio runtime metadata | Partial | `list-pages`, `list-packages`, `list-apps`, `get-client-unit-schema`, `get-page` bundle.json all read successfully | MCP resolves only the **top** replacing schema body; base-package Classic layout (tabs, grid columns, base business rules) not extractable per-layer |
| Local repository | Missing | This worktree is the harness repo, not the Creatio package source | Exact base `ContractPageV2`/`ContractSectionV2` `diff` unconfirmed — mitigated by using the full entity model + current Freedom form as the parity baseline |
| Existing Freedom UI artifacts | Found | `Contracts_FormPage`, `Contracts_ListPage`, `ContractsAnalyticsDashboard` bundle.json parsed | — |
| Package ownership/editability | Partial | `CrtOrderContractMgmtApp_8c66nu1` = Customer (editable); product packages = locked | Must confirm `_8c66nu1` is the correct design package for the app and is unlocked before writing |
| Tests/validation assets | Not found | none discovered | E2E/unit coverage must be authored during implementation |

**Missing-source risks (carried into plan):**
1. Base Classic tab arrangement & base-package business rules are inferred, not quoted. Before implementing, confirm from package source (file system / git) so no base field/rule is silently dropped.
2. Whether the Classic banking automation exists at entity level (entity business rules) vs page-only. If entity-level, Freedom inherits it and re-implementation may be unnecessary.
3. `CurrencyRate` is a **required** entity column with **no field** on the current Freedom form — verify how the current Freedom page satisfies it (auto-default) before adding.

## 3. Classic UI Inventory

- **Section schema:** `ContractSectionV2` (`WorkContractsProcess` top / `CoreContracts` base / `WorkSalesBase` override)
- **Edit page schemas:** `ContractPageV2` (`CoreContracts` base + `WorkSalesBase`/`WorkOverride`/`ContractInOrder`/`ContractInInvoice`/`WorkCompliance` overrides)
- **Details:** Products (`ProductInContract`), Visas/Approval (`ContractVisa`), Documents (`Document`), Invoices (`Invoice`), Files (`ContractFile`), subordinate contracts (`Contract` self by `Parent`)
- **Mini pages:** `ProductInContract_MiniPage`, `ConnectProductsToContract_MiniPage`
- **Mixins/utilities:** `ContractAmendmentMixin`, `OrderContractMixin`, `WorkContractPrintReportUtilities`
- **Backend schemas/services/processes:** contract approval/visa process (`ContractVisaRoutePage`), print reports (`Printable`/`SysModuleReport`); banking automation via `AccountBillingInfo` EntitySchemaQuery
- **Confirmed custom page logic (top override `WorkCompliance`):** `onEntityInitialized`→`setLegalEntity`; `onAccountChanged`; `setCustomerBillingInfoFromAccount` (ESQ on `AccountBillingInfo`); `onCustomerBillingInfoChanged`; `getBillingInfoFilters`; `setLegalEntity` (virtual `LegalEntity`)

## 4. Package Placement Analysis

| Package/App | Owns | Editable/Locked | Evidence | Placement | Reason |
| --- | --- | --- | --- | --- | --- |
| `CrtOrderContractMgmtApp` | Freedom `Contracts_FormPage` | Locked (Creatio) | list-packages maintainer=Creatio | — | Cannot edit in place |
| `CrtContract` | Freedom `Contracts_ListPage` | Locked (Creatio) | maintainer=Creatio | — | Cannot edit in place |
| `CrtOrderContractMgmtApp_8c66nu1` | Customer customizations of the app | **Editable** | maintainer=Customer | **Replacing package** | Correct home for replacing `Contracts_FormPage` + handler module |
| `Contract` entity | Data model | Locked (Creatio) | — | Reuse | All target columns already exist on the entity; no schema change needed |

Same-package edit is not safe (locked). New section is rejected (duplicate). → **Replacing schema in `CrtOrderContractMgmtApp_8c66nu1`.**

## 5. Classic Template Structure And Freedom Analog

| Classic Page | Parent Chain | Structural Slots | Freedom Candidates | Selected Analog | Reason |
| --- | --- | --- | --- | --- | --- |
| `ContractPageV2` | `BaseModulePageV2` | header, side profile, tabs, details, files, feed, actions | existing `Contracts_FormPage` (PageWithTabsFreedomTemplate); new tabs/right-area page | **Update existing `Contracts_FormPage`** | Freedom counterpart already exists at ~70% parity; skill mandates update-not-duplicate |
| `ContractSectionV2` | `BaseSectionV2` | grid, filters, folders, actions | existing `Contracts_ListPage` (ListPageV3Template) | **Keep existing `Contracts_ListPage`** | Already at parity with standard grid; no gap identified |

## 6. Layout Analysis (target Freedom form after full-parity enhancement)

Current Freedom tabs: **General information · Contract details · Approvals · Documents · Feed · Attachments** + side profile (Number, Type, Owner, StartDate, EndDate, Order), ProgressBar, Approval widget, Amount metric.

Full-parity additions (grouped for placement):

| Group | Classic fields to add | Freedom target |
| --- | --- | --- |
| Dates/terms | `FixedEndDate`, `ContractLength` | General information (near dates) |
| Amounts (tax breakdown) | `AmountWithoutTax`, `TaxAmount`, `PrimaryAmount`, `PaymentAmount`, `CurrencyRate` (required) | New field group "Amounts" on General information |
| Address/party | `CompanyAddress`, `ContractParty`, `ContractRecipient`, `ContractRecipientAddress` | New field group "Parties & delivery" |
| Delivery | `DeliveryType`, `ContractReturnDate`, `isCancellable` | Same "Parties & delivery" group |
| Enterprise revenue | `ACV`, `TCV`, `DR`, `RecognizedRevenue`, `DwPaymentTerms`, `DwActualSigningDate` | New tab or group "Revenue" (Enterprise) |
| People | `SalesAssistantContact` | General information |
| Notes | `Notes` | New "Notes" tab (crt.Input multiline / rich text) |

## 7. Business Logic Analysis

### 7a. Declarative business rules (CONFIRMED from designer — `ContractPageV2` `businessRules` block)

MCP `get-client-unit-schema` returned only the `WorkCompliance` thin layer (empty `businessRules`). The designer view of the layer that carries rules shows a populated `businessRules` block with two rules:

| Rule (attr) | uId | ruleType | Config | Meaning | Freedom Target |
| --- | --- | --- | --- | --- | --- |
| `Owner` | 16112a5c-37f2-4814-b36f-e78afbcdeaa1 | 1 = FILTRATION | baseAttributePatch `Account`, EQUAL, value `7a6f2144-a972-423b-8cc4-08a68a48ddba` (dataValueType 10 Lookup) | Filters the `Owner` lookup by Account (exact constant semantics to confirm) | Lookup filter business rule / attribute `filters` |
| `Parent` | 7555cc59-2919-4fc4-9a9d-c72ca3323728 | 0 = BINDPARAMETER, property 2 = REQUIRED | condition `Type.IsSlave == true` (Boolean) | `Parent` becomes **required** when contract `Type.IsSlave` = true | `create-page-business-rules` conditional REQUIRED |

Layout moves in the same layer's `diff`: `Type`, `Number`, `Amount`, `ContractParty` → `Header`; `Printable` → `group_gridLayout`.

> Still to retrieve: `businessRules` from the other layers (`CoreContracts`, `WorkSalesBase`, `WorkOverride`, `ContractInOrder`, `ContractInInvoice`) — MCP does not return them per-layer; read each layer's body directly (designer / `download-configuration`) for the complete rule set.

### 7b. Imperative logic (CONFIRMED from `WorkCompliance` body — code, NOT declarative rules)

| Classic Logic | Trigger | Effect | Freedom Target | Risk |
| --- | --- | --- | --- | --- |
| `setCustomerBillingInfoFromAccount` (ESQ on `AccountBillingInfo`) | Account changed | Auto-fill `CustomerBillingInfo` when Account has exactly one billing info | Handler (`crt.HandlerChainService`) on `Account` attribute change in replacing schema | Requires ESQ/model query in Freedom handler |
| `getBillingInfoFilters` (attribute `lookupListConfig.filters`) | `CustomerBillingInfo` lookup open | Filter billing info to selected Account | Lookup filter (business rule / attribute `filters`) | Declarative if possible; else handler |
| `onCustomerBillingInfoChanged` (attribute dependency) | `CustomerBillingInfo` changed | Sync `Account` back from billing info | Handler | Two-way sync loop guard needed |
| `setLegalEntity` | init / billing info changed | Derive virtual `LegalEntity` | Handler + virtual attribute | Virtual column not persisted |
| `CurrencyRate` required | save | Must have a rate | Verify existing default; add field + required rule if not auto | Required column currently fieldless |

## 8. Freedom UI Mapping

| Classic Artifact / Behavior | Classification | Freedom Implementation | Status |
| --- | --- | --- | --- |
| All missing scalar/lookup fields (§6) | Direct analog | Field diff items on replacing `Contracts_FormPage` bound to existing `Contract` columns | Planned |
| `CurrencyRate` required | Business rule | Required + default rule | Planned (verify first) |
| Billing-info lookup filter | Business rule / filter | Lookup `filters` by Account | Planned |
| Account↔billing auto-fill & sync | Handler | `crt.HandlerChainService` handlers in replacing schema | Planned |
| Virtual `LegalEntity` | Handler + attribute | Virtual attribute + derivation handler | Planned |
| Products/Approvals/Documents/Invoices/Attachments/Feed | Direct analog | Already present | Done (verify) |
| Print / Send-for-approval | Backend dependency | Existing process buttons | Done (verify) |
| Base Classic tabs/rules | Manual decision | Confirm from source before drop | Blocked on source |

## 9. Ordered Implementation Plan (for the post-approval phase)

1. **Confirm package** `CrtOrderContractMgmtApp_8c66nu1` is unlocked and belongs to the app; read `page-modification` + `business-rules` + `page-schema-handlers` guides.
2. **Confirm base Classic layout & entity-level rules** from package source to finalize the exact field/rule list (closes missing-source risk 1–2).
3. **Verify `CurrencyRate`** handling on the current Freedom form.
4. `get-page Contracts_FormPage` → create replacing schema in `_8c66nu1` (`create-page`/`update-page` on the replacing body).
5. **Add fields** (§6) as diff items grouped into the new field groups/tabs; `validate-page` before save.
6. **Add business rules** (`create-page-business-rules`): billing-info filter, `CurrencyRate` required/default.
7. **Add handlers** (replacing schema body): billing auto-fill/sync, `LegalEntity` derivation.
8. Reuse backend (approval process, print report) — no change expected.
9. Localization: EN captions for all new fields/groups/tabs (respect profile culture).
10. **Validate** (§10).
11. Switch-over (retire Classic section) — only if separately approved.

Each step lists target schema, tool op, and validation signal at execution time in `worklog.md`.

## 10. Validation Plan

- **Page schema validation:** `validate-page` on the replacing `Contracts_FormPage` before every save.
- **Build/package validation:** none unless a C# handler helper is added (JS handlers need no compile).
- **Unit tests:** if any C# helper is introduced.
- **Integration/browser checks:** open the Freedom Contracts form on `workbuild103_15688915_0726`, create/edit a contract, exercise Account→billing auto-fill.
- **E2E scenarios:** create contract, fill amounts+currency rate, add product, send for approval, print.
- **Manual checks:** field-by-field parity against the Classic page; verify no base element regressed.

## 11. Blockers And Decisions Needed

| Item | Why It Matters | Required Decision |
| --- | --- | --- |
| `CrtOrderContractMgmtApp_8c66nu1` is the correct editable design package | Wrong package = failed/locked write | Confirm before step 4 |
| Base Classic layout not extractable via MCP | Risk of dropping base fields/rules at full-parity | Approve source-confirmation step, or accept entity-model-based parity baseline |
| `CurrencyRate` fieldless but required | May already be auto-satisfied | Verify at step 3 before adding a field |
| Switch-over (retire Classic) | Out of default scope | Separate explicit approval |

## Approval Gate

**Implementation stops here.** No Freedom artifacts will be created or edited until this plan is explicitly approved.

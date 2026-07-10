# Contracts Classic → Freedom — Worklog

## 2026-07-08 — Discovery & planning (audit-only, no implementation)

- Resolved environment `workbuild103_15688915_0726` from URL host `ts1-core-dev04:88`.
- Read core-rules + routing guidance.
- Classic `ContractSectionV2` top layer = `WorkContractsProcess` (empty passthrough, 214 bytes); base in `CoreContracts`, override in `WorkSalesBase`.
- Classic `ContractPageV2` top override resolves to `WorkCompliance` (banking-details automation confirmed: `setCustomerBillingInfoFromAccount` ESQ, `getBillingInfoFilters`, Account↔billing sync, virtual `LegalEntity`).
- **Existing Freedom counterpart found:** `Contracts_FormPage` (`CrtOrderContractMgmtApp`, locked) + `Contracts_ListPage` (`CrtContract`, locked) + `ContractsAnalyticsDashboard`. App = "Order and Contract Management" v1.12.1.
- Editable customer package identified: `CrtOrderContractMgmtApp_8c66nu1` (maintainer Customer).
- Freedom form ~70% parity; full field list, details, and gap table captured in `plan.md` §6–§8.
- Contract entity = 50 columns; all parity-target columns already exist on the entity (no schema change needed).
- **User decisions:** strategy = audit + plan only (no implementation now); parity scope = FULL.
- Wrote `plan.md` (DRAFT, awaiting approval). Enhance-existing strategy, replacing schema in `_8c66nu1`.

### Missing-source risks logged
1. Base-package Classic layout (tabs, grid columns, base rules) not extractable per-layer via MCP.
2. Banking automation may exist at entity level (would make page re-impl unnecessary).
3. `CurrencyRate` required but fieldless on current Freedom form — verify before adding.

### Next (only after approval)
Confirm `_8c66nu1` + base source → replacing `Contracts_FormPage` → fields → rules → handlers → validate.

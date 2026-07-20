# Fixtures — golden Classic schema bodies

Deterministic golden inputs for the offline merge-engine and mapper tests (no stand). Each file is the
own body of a single layer (`define(...)`), not merged.

Provenance (important):

- `supportunitemployee/` — **synthetic**, hand-written. Compact bodies for `SupportUnitEmployeePage`
  (entity `SupportUnit`): base `SupportCalendar_base.js` (8 profile fields, 3 tabs, 3 details, 4 rules,
  a method, two base-tab merges) + override `SupportService.js` (one analytics widget module). This
  directory used to hold verbatim stand exports with module dumps / `recordId`s; those were replaced
  with synthetic bodies.
- `contract/` — **real client-schema layers** of the `ContractPageV2` page (entity `Contract`) from the
  Creatio product: these are Creatio's own configuration metadata, taken from **this same public,
  MIT-licensed toolkit repo**, and include **real method bodies** (`getActions`, `onEntityInitialized`,
  `getUpdateDetailOnSavedConfig`, etc. — e.g. `CoreContracts.js` is ~902 lines). 9 layers in true
  dependency order (F1) — the most valuable merge golden (typed rules, tombstones, orphan groups). This
  is PAGE metadata for a standard object (client-schema), **not** record/customer data. Two layers were
  deliberately sanitized to remove Sonar duplication: `WorkSalesBase.js` → an empty, non-asserted layer;
  `WorkContractsProcess.js` → trimmed to ~6 asserted ops. The remaining layers (notably `CoreContracts.js`)
  are **intentionally kept with real bodies** — that fidelity is exactly what this golden is meant to guard.
- The base seed `_base/BaseModulePageV2_skeleton.js` is a synthetic minimal parent-template skeleton.

`employeescore/` was removed — no runner loaded it.

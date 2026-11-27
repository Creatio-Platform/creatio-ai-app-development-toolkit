# Fixtures — golden Classic schema bodies

Deterministic golden inputs for the offline merge-engine and mapper tests (no stand). Each file is the
own body of a single layer (`define(...)`), not merged.

Provenance (important):

- `supportunitemployee/` — **synthetic**, hand-written. Compact bodies for `SupportUnitEmployeePage`
  (entity `SupportUnit`): base `SupportCalendar_base.js` (8 profile fields, 3 tabs, 3 details, 4 rules,
  a method, two base-tab merges) + override `SupportService.js` (one analytics widget module). This
  directory holds synthetic bodies rather than verbatim stand exports with module dumps / `recordId`s.
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
- `tasks-aggregate-rows/` — a task folder (its build task only) in the one-row coverage format (`Fields — N expected`,
  `Related lists — N expected`) with a `built` cell on the main page's Fields row and a `wont-do (D3)` cell on its
  Related lists row. `run-tasks.mjs` copies it and never edits it in place.
- `object-wide-retest/` — **synthetic**, reduced from a customer retest with every name replaced (`DemoSub`,
  `DemoLine`, placeholder rule names): a parent page whose related list opens a child rebuilt from its Classic edit
  page, which filters two lookups. `built.json` is the object's rules as read back — the two the plan lists and three
  a builder added on its own — and `decisions.md` holds the two answers the run recorded. `run-tasks.mjs` asserts the
  mixed-navigation question, the unplanned-rule flag and the result report's Object-wide changes section.

- `client-modules-v2/` — **real built Freedom code** from a migration benchmark run of the synthetic Classic
  test package `MbContract` (no customer data): the three client modules the pages call into and the delivery-note
  page's `handlers` section. It is kept as built, defects included — a Post handler that ends the chain, totals and
  counts paged in the browser, bulk actions and numbering that only log a failure, a dropped recalculation result —
  and `run-mapper-quality.mjs` asserts that the code-quality lint finds each one at its line. Do not tidy it.
- `client-modules-v3/` — **real built Freedom code** from the next benchmark run of the same `MbContract` package
  (no customer data): the record and list pages' `handlers` sections, whose `crt.UpdateRecordRequest` handlers return
  before calling `next` when a record opens its own page, and the return-note client module as saved before the
  gate's repair round (a bare numeric `comparisonType`). `run-mapper-quality.mjs` asserts the chain is kept and the
  module's finding is found at its line. Do not tidy it.
- `module-lint-v2/` — **synthetic** client modules, reduced to what the code-quality rules read: log-only and
  comment-only catches, a bare numeric `comparisonType`, and a shared module that only another module imports.
  Names and record ids are placeholders; `run-mapper-quality.mjs` asserts the findings.
- `module-lint-v3/` — the client modules of a benchmark run, renamed (`Demo` names, placeholder record ids) and
  otherwise unchanged: every page has its own module and one shared module, yet functions and runs of statements
  repeat across modules with other values, and named constants are declared in several modules.
  `run-mapper-quality.mjs` asserts the near-copy and shared-constant findings.
- `mbcontract-v3-browser/` — **real task notes** from a migration benchmark run of the synthetic `MbContract` test
  package (no customer data): every page-writing task of the run, in queue order, with its status, its `order` and its last
  `Browser checks:` line, and `unsaved: true` on the tasks whose notes say they saved no page. Generated from the
  run's `build-tasks/`; `run-tasks.mjs` asserts the run's browser verdict from it, with and without `Page saved: no`.

`employeescore/` was removed — no runner loaded it.

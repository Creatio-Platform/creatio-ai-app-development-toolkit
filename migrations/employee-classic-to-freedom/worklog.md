# Worklog — Employee Classic → Freedom UI

Environment: `creatio_pg_local`. Scope: single section. Status: **AWAITING APPROVAL** (no build performed).

## 2026-08-12 — discovery, reconstruction, plan

- Read the skill contract; read clio `get-guidance core-rules` + `routing`; telemetry consent already `granted`.
  Emitted `workflow_started` (`variant=single-section`), `plan_blocked` (`variant=engine-gate`, one blocked run),
  `plan_presented`.
- Resolved environment `creatio_pg_local` from `list-environments` (dev mode on, maintainer `Customer`).
- **Target discovery** (no section name was given): enumerated Classic client-unit section schemas via
  `odata-read SysSchema` (`ManagerName='ClientUnitSchemaManager'`, `Name endswith 'SectionV2' | 'Section'`) — 118
  rows. Cross-checked each candidate against `SysModule` (navigability) and `list-entity-client-schemas`
  (Freedom counterpart).
  - **Rejected `Release`** (first pick: `ReleaseSection`/`ReleasePage`, package `Release`, classic-only, 8 details).
    Its bundle folded cleanly, but there is **no `SysModule` row for `Release`** (nor `Change`, `Problem`,
    `ConfItem`) — the ITSM sections are not registered in navigation on this stand, so 2 of the 3 required on-stand
    signal checks (`ProcessInModules`, `SysModuleReport`) could not be grounded on a module Id and the section is
    not reachable in the UI. A failed check is not a "none", so the target was changed rather than guessed.
  - **Rejected `ServicePact` and `ServiceItem`** — both already have Freedom sections
    (`ServiceAgreements_ListPage`/`_FormPage`, `Services_ListPage`/`_FormPage`), i.e. reconcile scope, not a
    Classic-only migration.
  - **Selected `Employee`** — Classic-only (`EmployeeSection`, `EmployeePage`, `EmployeeMiniPage`, all `CrtUIv2`),
    registered and navigable (`SysModule` `ebf36756-7ee8-4a65-9b44-d8115c089d62`, Code `Employee`,
    Caption "Employees"), no Freedom counterpart, moderate size, exercises the mini-page path.
- **Reconstruction** (`get-classic-page-sources` → scratch dir outside the repo):
  `EmployeePage` — 1 own layer, 16-body parent-template seed, 62 resources, 19 columns, 8 details, section folded.
- Resolved every structure-gate item rather than deferring:
  - `profileSchemas.EmployeeProfileSchema` — fetched (`get-client-unit-schema`, `CrtUIv2`, 2502 chars).
  - Child pages, each verified with `list-entity-client-schemas` **by the child entity** and folded as its own
    bundle: `EmployeeCareerPage`, `ContactAddressPageV2`, `ContactAnniversaryPageV2`,
    `ContactCareerPageInContactV2`, `SysUserInRoleInUserPageV2`. All five have real Classic `*Page` schemas →
    all mapped (Contract rule 4; no self-declared "out of scope").
    Note: `childPageSchemas` keys must match the engine's lookup order (`editPage` → `entity` → `entity+"Page"`);
    keying by the page schema name (e.g. `ContactAddressPageV2`) silently fails to bind — key by the **entity**.
  - `addRecordMiniPage` — `EmployeeMiniPage`, folded via `miniPageSchemas` (see plan Adjustment 3 re: empty
    `MiniPageModes`).
  - `signals` — all three checked on-stand, all `present: false` (verified none): DCM (5 `DcmSchemaManager`
    schemas exist, none for `Employee`), `ProcessInModules` by `SysModule/Id` → 0 rows, `SysModuleReport` by the
    same module → 0 rows.
- **Package placement:** owning package `CrtUIv2` v7.8.0, maintainer `Creatio` → vendor/base, not editable ⇒ new
  app/package `UsrEmployeeFreedom`. Workplace placement is an open question for the developer.
- **Templates:** confirmed live names with `list-page-templates`. Form → `PageWithTabsFreedomTemplate` (no DCM
  case, no wide populated Classic Header); list → `ListPageV3Template`; small child forms → `BaseMiniPageTemplate`
  per the engine's own recommendations.
- **Engine runs:** run 1 ⛔ STRUCTURE INCOMPLETE (profile card, 5 children, mini page) → resolved → run 2
  `--plan --out plan.md` **exit 0, both gates green** (`gate.blocked: false`, `structure.complete: true`),
  2 advisory parse diagnostics.
- Presented `plan.md` verbatim at the approval gate and **STOPPED**. No Freedom artifact created, no
  `create-page`/`update-page`, no compile, no restart, no commit/push. Only `creatio_pg_local` touched, reads only.

### TODO / BLOCKED
- **BLOCKED (needs developer decision):** the form page, the mini page and 3 of 5 child pages generated with an
  **empty Layout table / `0 fields`**. Root cause identified: the engine treats a Classic diff item as a field only
  when it carries an explicit `bindTo` (`engine.mjs`, `eff.fields = alive.filter(i => i.bindTo)`), but these pages
  bind columns implicitly by item name. Not an input gap (full chain + seed + `entityColumns` + `columnTitles`
  supplied, gates green) and not hand-fixable in the generated tables (Contract rule 2). See plan Adjustment 1 —
  either patch the engine's field detection and re-run `--plan`, or accept the columns as the
  `[unmapped-component]` worklist.
- TODO on approval: build order is leaf-first (child forms → details → parent), then re-bind the object's form page
  to the new schema (replacing the scaffolded default), wire the mini page to `+ New`, rebuild the list page's
  quick filters / section actions, invoke `creatio-ui-guidelines` **before** authoring each page body, and close
  with `migrate.mjs --verify --built <built-file>` (including the `miniPageWired` / `sectionRegistered` evidence
  booleans).
- Cleanup pending: delete the scratch input dir once the migration reaches VALIDATED.

---
name: rca-env-readonly-query
description: Run supporting read-only queries against the connected Creatio environment to enrich a Root-Cause Analysis — read the CompilationHistory rows linked to a ConfActivityLog record, read any record by Id, check schema flags (IsChanged / IsLocked), resolve lookups, read feature and system-setting state, and corroborate an installation (delivery) incident — packages and their dependencies, schema state on the target, binding and localized-resource state, and whether a record named in a foreign-key error actually exists. Use alongside rca-cal-read whenever an investigation needs evidence beyond the main activity-log record.
required_tools: [creatio_describe_object, creatio_search_objects, creatio_list_records, creatio_get_record]
supported_modes: [Builder, SDK]
---

# rca-env-readonly-query — supporting read-only checks

Secondary evidence gathering for an RCA. All access is **read-only** (`creatio_describe_object`, `creatio_search_objects`, `creatio_list_records`, `creatio_get_record`). Never write — see the read-only rules (`rca-safety-and-access`; on the AI Platform, the system prompt).

## Step 0 — confirm the schema only when needed

The schemas in this skill's reference files are the **expected shape** — you do **not** need to
`creatio_describe_object` every run. Describe only when a query **errors** or you're unsure of a
column/caption (especially the `CompilationHistory` foreign-key column — see
`./references/compilation-reads.md`), then adapt. Describe returns structural metadata (`columnCode`, `columnType`, `refersToObjectCode`,
`required`) — enough for RCA.

### Finding an object's code

When you are unsure of an object's exact code, or know only what it holds, call `creatio_search_objects`
with the code you guess, its caption or a few English words — `{ "query": "configuration activity log" }`.
It answers the best match as `objectCode` and the ranked runners-up as `candidates`; a whole-code match
ranks first, a whole-caption match next. Unless the query was the exact code, confirm the match with
`creatio_describe_object` before you read it: the best match of a description is a guess, and the intended
object can sit lower in `candidates`. `{ "found": false }` means nothing matched — try other words, not a
conclusion that the object is missing.

Where `creatio_search_objects` itself fails (the object search service is not available on every site),
list matching object names instead:

```json
{ "objectCode": "VwSysSchemaInWorkspace", "columns": ["Name","Caption"], "filters": { "all": [ { "field": "ManagerName", "op": "eq", "value": "EntitySchemaManager" }, { "field": "Name", "op": "contains", "value": "<part of the code>" } ] }, "orderBy": "Name asc", "limit": 50 }
```

To check one code you already have, `creatio_describe_object` alone is enough: an unknown object answers
`INVALID_ENTITY: unknown object '<code>'`.

### Lookup naming rule — bare, no `Id` suffix

Every lookup column in those schemas is exposed by its **bare** name (`SysPackage`, `Feature`,
`Parent`, `SysAdminUnit`, `SysSettings`, `DependOnPackage`, …). The scalar FK aliases with the `Id`
suffix (`SysPackageId`, `FeatureId`, `ParentId`, `SysAdminUnitId`, `SysSettingsId`,
`DependOnPackageId`, …) come through as raw GUID cells when projected in `columns`, but they **cannot
carry a dotted-navigation filter** — `SysPackageId.Name` returns `INVALID_FIELD`. Always filter
through the **bare** lookup name (`SysPackage.Name`, `Feature.Code`), and when in doubt confirm by
reading the error's `Valid options include: …` list — it lists the bare names.

## Where each read lives — open the file before you run its reads

The reads themselves are in five files under `./references/`, one per kind of question. Other skills and the
knowledge base name a read by its **heading** — find that heading in the list below and open the file it is
in. **Read that file whole (on the AI Platform: with `read_skill_file`) before you run any read from it**: the columns, the
filters, and what an empty result does and does not prove are there, not here. A read run from memory of
its heading is run without them.

- **`./references/compilation-reads.md`** — what a compilation reported, project by project, and whether the
  build is broken now; also for a compilation that ran inside a delivery.
  Headings: "CompilationHistory — details of a compilation"; "Follow-up turns — confirm the run is still the
  latest before reusing its rows"; "Build state checks (verified via `creatio_describe_object`, not
  assumed)"; "`VwCompilationErrors` — current, run-independent compilation-error state";
  "`SysPackageReferenceAssembly` — is a reference assembly published?"; "`PackageCompilationState` — is a
  specific package flagged as needing compilation?"; "Post-install build state".
- **`./references/package-and-schema-reads.md`** — a package's composition, its dependencies and a
  dependency cycle; a schema's name, lock, change flag and last error, on any environment and on the
  target of a delivery.
  Headings: "Package & schema state checks (verified via `creatio_describe_object`, not assumed)"; "Package
  composition & leftovers — `SysPackage` / `SysPackageDependency` / `SysInstalledApp`"; "Schema checks —
  `SysSchema` (name/case/lock/last-error)"; "`QuickAddMenuItem` — orphaned reference by UId (unconfirmed
  link — verify before trusting)"; "Delivery reads — packages, dependencies and schemas on the target";
  "Packages and their dependencies"; "Walking the dependency graph — finding a cycle"; "Schema state on
  the target".
- **`./references/delivery-reads.md`** — an installation's record tree and attachments, whether a record
  named in an error exists, section bindings, and the state of data bindings on the target — including
  which bindings hold a schema a delivery tried to remove.
  Headings: "Delivery reads — packages, schemas, bindings and attachments"; "The delivery record and its
  children"; "Attachments of a log record"; "Does the record named in an error actually exist?"; "Section
  bindings — `SysModule` / `SysModuleEntity` / `SysModuleInWorkplace` / `SysWorkplace`"; "Binding state on
  the target — `SysPackageSchemaData`"; "Binding column settings — `SysPackageSchemaDataColumn`".
- **`./references/localization-reads.md`** — localized values on the target, the localization changes a
  delivery made, change-log state, and cultures.
  Headings: "Localization and change-log reads"; "Localized resources — `SysLocalizableValue`";
  "Localization changes attributed to a log record — `LocalizationChangeLog`"; "Change-log state —
  `VwLogObjects` (semantics unproven — read the caveat)"; "Cultures — `SysCulture`".
- **`./references/feature-and-setting-reads.md`** — a feature's state for a user or an admin unit, finding
  candidate features and settings from a symptom, and a system setting's value.
  Headings: "Feature & system-setting state checks"; "Features — `AppFeature` (primary read; the only read
  that covers every provider)"; "Discovery probe — finding candidates when no code is known"; "Features —
  `Feature` + `AdminUnitFeatureState` (database-backed features only)"; "System settings —
  `SysSettings` (definition) + `SysSettingsValue` (values)".

One investigation often needs two of these — a delivery whose build failed needs `delivery-reads.md` and
`compilation-reads.md`. Open each one the first time you need a read from it.

## Read any record by Id

`creatio_get_record` with `{ "objectCode": "<Object>", "ids": ["<guid>"], "columns": [ ... ] }`. Use this to
dereference an `ElementUId`, inspect a schema/package row, or check whether a referenced record exists
(orphan check → empty result).

## Lookups

Every lookup cell returned by `creatio_list_records` / `creatio_get_record` already carries the
display caption alongside the Id — `Owner: { value: "<guid>", displayValue: "Andrew Baker" }`. So a
caption is available in the same call, no separate lookup read needed. If you do need the full lookup
table (e.g. to enumerate every `Operation`), read `ConfOperation` / `ConfActivityStatus` /
`ConfElementType` with `columns: ["Id","Name"]`.

## Guardrails

- Read-only only. If a needed check would require a write, stop and report it as a manual step for a human, per the read-only rules.
- Record the object, filter, and record Id used for each piece of evidence so conclusions are reproducible.

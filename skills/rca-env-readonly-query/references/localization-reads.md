# rca-env-readonly-query — localization reads

Part of `rca-env-readonly-query`: the reads that answer what a localized value is on the target, which
localization changes a delivery made, what the change log records, and which cultures exist. The skill's
`SKILL.md` holds what applies to every read here: read-only access, when to describe an object first, and
the lookup naming rule (filter through the bare lookup name, never the `Id` alias).

## Localization and change-log reads

### Localized resources — `SysLocalizableValue`

Verified columns (confirmed via `creatio_describe_object` on a live environment): `Key`, `Value`,
`SysSchema` (Lookup → `SysSchema`, bare), `SysCulture` (Lookup → `SysCulture`, bare), `SysPackage`
(Lookup), `ResourceManager`, `ResourceType`, `IsChanged`, `ImageData` (**Binary** — never read back as
content), plus audit columns.

Localized resources are readable **per schema and per culture**, so "this schema has no resources for that
culture" is a direct read. Filter on both lookups by dotted navigation and ask for the total — verified
live: `SysSchema.Name eq 'LeadPageV2'` plus `SysCulture.Name eq 'ru-RU'` returned 691 rows out of 79 662
for that culture.

> **Filter by the schema's `Name`, which is its *code*, not the caption the row displays.** The same
> verified read matches `LeadPageV2` and comes back showing `Lead edit page`. Filtering on the caption
> returns zero rows **silently**. When an error identifies the schema only by a GUID, resolve it through
> `SysSchema` by `UId` first and filter on the code you get back.

What the read does and does not prove: it establishes what is present **now**. It cannot establish that
something removed the resources — there is no before-and-after here — so keep those two claims apart when
reporting.

### Localization changes attributed to a log record — `LocalizationChangeLog`

Verified columns (confirmed via `creatio_describe_object` on a live environment): `Key`, `OldValue`,
`NewValue`, `ConfActivityLog` (**a plain `Guid` column, not a lookup** — filter on it directly, the same
shape as `CompilationHistory.ConfActivityLog`), plus audit columns.

**This is the only before-and-after evidence in this area.** Each row records one localized value changing
during a logged configuration operation, and links it to the record that caused it. Filter by
`{ field: 'ConfActivityLog', op: 'eq', value: '<logId>' }` to get everything one operation changed, and
report `Key` with both values. Verified live: 291 rows on the reference environment, populated by real
operations.

> **What was observed, and what was not.** Every sampled row had `OldValue: null` with `NewValue` filled —
> values being *added*. A value being *removed* should therefore appear as `OldValue` filled with
> `NewValue` null, but **no such row was observed**, so that reading follows from the column names rather
> than from evidence. Say which shape you actually found rather than asserting the mirror case.

Two neighbouring entities, both described live and both of limited use so far:

- ****`BACKEND_ERROR` on a projection can mean the database is missing a column the schema declares — and
its message will suggest something else.** Verified live by dropping a table column while leaving the
entity schema intact: projecting that column returns
`BACKEND_ERROR: the read failed on object 'X' — the read stated no filters; a heavy object can reject a
broad scan it answers narrowed. Retry with filters, or probe presence first with returnRows: false`. The
advice is wrong for this cause: a narrow filter fails identically, and `returnRows: false` succeeds only
because the count path does not project the column. **Isolate it with two reads** — the same object
*without* the column (succeeds) and *with* it (fails). Distinguish from `INVALID_FIELD`, which is the tool
rejecting a projection against metadata before any query runs.

**`SysLocalizableValue` stores one row per key *per package*, so rows greatly outnumber keys.** Verified
live: `LeadPageV2` × `en-US` is **809 rows / 141 distinct keys** (one key appears 11 times), `ru-RU` is
**691 rows / 127 keys**; the schema is extended by 12 packages and `(Key, SysPackageId)` is the unique
pair — `ResourceType` does not separate the duplicates. Consequences: a count of rows is not a count of
translated elements; comparing row counts across cultures measures package coverage rather than
translation coverage; and since the read tool has no DISTINCT, a key-set comparison means paging the rows
and reducing them yourself. State which of the two any number you report is.

`SysDataLocalizableValue`** — the localization of *bound data* rather than of schemas. Verified
  columns: `SysPackage`, `SysCulture` (**required**), `Value` (**required**), `RecordId`, `ColumnName`,
  `DataSchemaName`, `ColumnUId`, `DataSchemaUId` — i.e. one localized value per record, per column, per
  culture, which would answer "what is this bound record's caption in that culture". **It was empty (0
  rows) on the reference environment**, so the columns are confirmed but the behaviour is not.
- **`SysPackageDataLcz`** — verified columns: `SysPackageSchemaData` (Lookup), `SysCulture` (Lookup),
  `Data` (**Binary**). Because the payload is binary, only *presence* is readable: whether a given binding
  carries localized data for a culture at all. Never read `Data` back as content.

### Change-log state — `VwLogObjects` (semantics unproven — read the caveat)

Verified columns: `Caption`, `UId`, `SysWorkspace` (Lookup), plus audit columns. Readable, and small:
five rows on the reference environment (`CSP default sources`, `Segments`, `Query handle rule`,
`Entity delete event log config`, `Trusted source of content`).

Use it to corroborate a claim that change-log/auditing is involved for a named object — scan by `Caption`.

> **Two cautions, both verified.** Whether this view means "logging is **enabled**" or "logging is
> **available**" was **not established**, so report its contents as corroboration and never as a confirmed
> configuration state. And the per-entity `Sys<Entity>Log` tables are **not exposed as objects at all** — a
> `creatio_describe_object` on one answers `INVALID_ENTITY: unknown object` regardless of whether logging is
> on, so that probe distinguishes nothing. Do not use it. `ChangeLogEntity` (columns `Name`, `Operation`)
> exists as a separate entity and was **empty** on that environment.

### Cultures — `SysCulture`

Verified columns (confirmed via `creatio_describe_object` on a live environment): `Name`, `Description`,
`Active`, `Index`, `Default`, `Language` (Lookup → `SysLanguage`, **required**), `Image`, plus the audit
columns.

Use it when an error names a culture, or a foreign key points at `SysCulture`: read filtered by `Name`
(e.g. `ru-RU`). An **empty result confirms the culture is absent on this environment** — verified live, an
absent culture returns `totalCount: 0` with no error — and that is the evidence behind a whole family of
data-install failures. Report `Active` and `Default` alongside: a present-but-inactive culture is a
different situation from a missing one. The culture set is usually small (the reference environment carried
two: `en-US` as `Default`, and `ru-RU`), so reading the whole table is cheap when you need the list.

# rca-env-readonly-query — delivery reads

Part of `rca-env-readonly-query`: the reads that corroborate an installation — its record tree and
attachments, whether a record named in an error exists, section bindings, and the state of data bindings
on the target. The skill's `SKILL.md` holds what applies to every read here: read-only access, when to
describe an object first, and the lookup naming rule (filter through the bare lookup name, never the `Id`
alias).

## Delivery reads — packages, schemas, bindings and attachments

Reads that corroborate an incident around a **package or application installation**. Their job is to turn
an exception text into a named fact about the environment in front of you: which record is missing, which
schema is blocked, which package is absent. As everywhere else in this skill, this section answers *what to
read and what it proves* — the caller decides when to run it.

### The delivery record and its children

Same entity and columns as `rca-cal-read`; nothing new to verify here.

- **The delivery itself:** `ConfActivityLog` filtered by its operation, **any status**,
  `orderBy 'CreatedOn desc'`, narrow columns.
- **Its children:** `Parent.Id eq <parentId>`, `orderBy 'CreatedOn asc'`. Expect a **flat and large**
  tree — one real application install had **1 037 children and no grandchildren** — so page through it
  (`limit` caps at 200) and aggregate by `Operation` instead of listing rows.
- **Children carry no `Status`.** On that same install **all 1 037 child rows had `Status: null`**; the
  result was recorded on the parent only. A child row therefore says *what was attempted*, never whether
  it succeeded: do not filter children by `Status`, and do not read "no failing child" as success.

> **Resolve the operation caption before filtering on it — never hardcode one.** Captions for delivery
> operations differ between product versions, and a caption this environment spells differently returns
> **zero rows silently** — that is not an error, and it reads exactly like "no delivery was ever recorded".
> Read `ConfOperation` (`columns: ['Id','Name']`) and match what is actually there, or filter by the
> operation `Id` when the caller supplies one. As an illustration of the spread, one environment returned
> `Install application or package` (`53c58a15-c7d9-4cf4-b3ae-54160d7efb82`), `Install data`,
> `Install SQL Scripts` and `Install package from repository`, while another spelled the first of those
> `Install application`. The caller owns which captions matter for its case; this skill owns the rule that
> they are resolved, not assumed.

### Attachments of a log record

Listing attachments (`SysFile`), deciding from `Operation` × `Element Type` whether any are expected at
all, and fetching content are **`rca-cal-file-read`'s** job. Use that skill rather than reimplementing either
half here.

### Does the record named in an error actually exist?

The most reusable probe in this area. A foreign-key violation names a table and an Id; the claim "that
record is missing **here**" is directly confirmable — `creatio_get_record` (or `creatio_list_records`
filtered by `Id`) on the object from the constraint, with the Id taken from the failing statement. An
**empty result confirms the absence**, and that is the evidence — not the constraint name. Verified live:
`creatio_get_record` for an Id that does not exist returns `records: []` **with no error**, so the empty
answer is a clean result and not a failed read. A hit means the record exists and the cause lies elsewhere;
say so instead of repeating the error text. Use `creatio_describe_object` on the named object when the table
name does not obviously map to an object code.

**Before declaring a question about the target's data unanswerable, count the rows.** "These reads
cannot express it" and "the answer is out of reach" are different claims, and conflating them costs a
diagnosis that was one call away: there is no aggregate read and rows cannot be ordered by a computed
value, but a table small enough to enumerate can simply be listed and inspected. One cheap call settles
which case you are in — the object with `returnRows: false` and the total requested. Above that size the
honest limit stands; below it, read the values and name the offending row.

### Section bindings — `SysModule` / `SysModuleEntity` / `SysModuleInWorkplace` / `SysWorkplace`

A section is not one record: it is a set of linked rows, and a delivery that carries only part of the set
leaves the section invisible. Verified columns (confirmed via `creatio_describe_object` on a live
environment):

| Object | Verified columns | Notes |
|---|---|---|
| `SysModuleEntity` | `SysEntitySchemaUId`, `TypeColumnUId`, audit | 384 rows on the reference environment. `SysEntitySchemaUId` is the entry point — it ties the row to the section's entity schema |
| `SysModule` | `SectionSchemaUId`, `SysPageSchemaUId`, `SectionModuleSchemaUId`, `CardSchemaUId`, `CardModuleUId`, `MobileSectionSchemaUId`, `HelpContextId` | display column is **`Caption`**, not `Name` — this object has no `Name`. The column list here was read under a name filter, so treat it as the schema-UId subset rather than the whole object |
| `SysModuleInWorkplace` | `SysModule` (Lookup → `SysModule`, **required**), `SysWorkplace` (Lookup → `SysWorkplace`, **required**), `Position`, audit | the link row; filter through the bare lookups |
| `SysWorkplace` | `Name` (**required**), `Position`, `IsPersonal`, `Type` (Lookup → `SysWorkplaceType`), `SysApplicationClientType`, `HomePageUId`, `LoaderId`, `UseOnlyShell` | |

**How to reach the set from an incident that names one record.** A foreign-key error names a single Id, so
navigate rather than guess: resolve the section's entity schema (`SysSchema` by `Name`) and read
`SysModuleEntity` by `SysEntitySchemaUId`; read `SysModule` by the schema `UId`s it stores; then
`SysModuleInWorkplace` filtered on `SysModule` to reach the workplace. **A row that is absent cannot be
found by following a link to it** — so report what you confirmed, what you observed, and what remains not
established, rather than presenting the set as complete.

### Binding state on the target — `SysPackageSchemaData`

Verified columns (confirmed via `creatio_describe_object` on a live environment): `Name`, `UId`,
`SysSchema` (Lookup → `SysSchema`, bare), `SysPackage` (Lookup → `SysPackage`, bare), `IsChanged`,
`IsLocked`, `NeedInstall`, `LastError`, `InstallType`, plus `Data` / `FilterData` (**Binary** — never read
these back as content) and the audit columns.

The binding-level counterpart of `SysSchema`'s flags. When data or a binding failed to install, read it
filtered by `Name` or `SysPackage.Name` and report `IsChanged` / `IsLocked` (the target's copy is
protected against overwrite) and `LastError` (a stored message for that binding, independent of any log).
Report the values; the reset scripts are a manual step for a human.

**`NeedInstall` and `LastError` are one pair, written together, and they describe the *last attempt* — not
history.** *Read from the installer implementation, not from a live environment.* A binding's data install
ends in one of two writes, both in the same statement: on success `NeedInstall = false` with
`LastError = null`; on failure `NeedInstall = true` with `LastError` set to the exception's message. So the
pair is the platform's own verdict on that binding — and the Configuration UI's tooltip on a failed binding
is literally these two columns. It is a **second evidence source beside the installer log**, and the only
one left when the log was never kept.

Four things it will not tell you, each inviting a confident wrong sentence:

- **An empty `LastError` does not mean the binding never failed.** A later successful install of the same
  binding clears both columns. This is current state, not a record of what happened.
- **A non-empty `LastError` is not necessarily about the delivery you are investigating.** The write
  happens only for bindings the delivery actually carried; one it did not touch keeps whatever an earlier
  delivery left behind. Tie the message to a delivery — through that delivery's children or its log —
  before attributing it.
- **The same message on several bindings usually means one failure, not several.** When an exception
  escapes the batch, the installer writes that single message onto **every** binding in it. Report them as
  one group with one cause; find the binding that actually failed from the log.
- **The text is truncated to the column's limit.** A message that stops mid-sentence was cut, not
  malformed — do not read the missing tail as evidence of anything.

And it stores the exception's **message only, with no stack**. So `LastError` can say what the database
refused and never where in the installer it happened; that still comes from the log.

**Per-column settings live on `SysPackageSchemaDataColumn`, and reading them has two traps.** Verified
live: projecting the bare `SysPackageSchemaData` lookup there returns `displayValue: ""`, so it cannot name
the binding — project `SysPackageSchemaData.Name` instead, and add the **two-hop**
`SysPackageSchemaData.SysPackage.Name` to get the owning package in the same call rather than resolving
parents in a second read. Dotted **filters** on these paths work and `totalCount` honours them. And because a binding name is not unique, a name-only filter can return
several rows for one column carrying **opposite** settings: resolve the parent `Id` and its `SysPackage`
first, then report per package.

**Duplicate bindings are confirmed by the same read, and the packages tell you which duplicate it is.**
Filtered by `Name`, this entity legitimately returns **several rows with distinct `UId`** — verified live
on a reference environment, where a name repeating across packages is **routine**, not exceptional, and one
name can appear in more than a dozen of them. So a repeated name is the normal shape, not a finding. Report
`UId` and `SysPackage` per row: rows in **different** packages mean the records are already bound elsewhere,
rows in the **same** package mean the package carries a genuine duplicate. Identify a row by `Id` when
recommending anything, precisely because the name is not unique.

**Resolve the package before you call anything a duplicate.** The same-package duplicate is the rare shape
— a full sweep of a reference environment found none at all — so several rows for one name are, until the
packages are read, evidence of nothing but a shared name.

**Filtered by `SysSchema`, this read answers a different question: what is blocking a schema's removal.**
A delivery that removes or replaces an old schema can fail on
`23503: update or delete on table "SysSchema" violates foreign key constraint "…" on table
"SysPackageSchemaData"` — and the constraint name explains nothing. `SysPackageSchemaData` filtered by
`SysSchema` (the schema being removed) **lists the bindings that hold it**, with `Name`,
`SysPackage.Name`, `IsChanged` and `LastError`; that list is the diagnosis. State one limit with it: an
active process instance also holds a schema and is **not** part of this read, so the result is what you
could see holding it, not necessarily everything.

### Binding column settings — `SysPackageSchemaDataColumn`

Verified columns (confirmed via `creatio_describe_object` on a live environment): `SysPackageSchemaData`
(Lookup → `SysPackageSchemaData`, bare), `ColumnName`, `IsForceUpdate`, `IsKey`,
`PackageSchemaColumnUId`, `DataValueTypeUId`, plus the audit columns.

The per-column settings of a data binding — what the UI shows on a binding's *Columns* tab — are readable
here, which makes "the column was not force-updated" a confirmable fact rather than an inference. Read it
filtered by `ColumnName` (e.g. `TypeColumnValue`) and report `IsForceUpdate` alongside the
`SysPackageSchemaData` display value of each row; filtering on the column name keeps it to one read, and
the binding comes back on the row. `IsForceUpdate = false` means the installer leaves the target's existing
value in place — a delivery that reports success and changes nothing for that column.

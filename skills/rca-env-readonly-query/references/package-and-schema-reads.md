# rca-env-readonly-query — package and schema reads

Part of `rca-env-readonly-query`: the reads that answer what a package holds and depends on, whether the
dependencies form a cycle, and what state a schema is in — on any environment and on the target of a
delivery. The skill's `SKILL.md` holds what applies to every read here: read-only access, when to describe
an object first, and the lookup naming rule (filter through the bare lookup name, never the `Id` alias).

## Package & schema state checks (verified via `creatio_describe_object`, not assumed)

These entity sets extend the read toolkit beyond `CompilationHistory` — general checks on package
composition, publication flags, and schema state that come up whenever an investigation needs more than
the build's own error text. Their field-level schema was **confirmed via `creatio_describe_object` on a
live environment** (not guessed) — trust the column names below without re-describing. Verification also
**overturned two initial assumptions** about what a couple of these entities could confirm — see the
correction callouts below where relevant.

### Package composition & leftovers — `SysPackage` / `SysPackageDependency` / `SysInstalledApp`

Verified columns: `SysPackage` — `Name`, `UId`, `IsChanged`, `IsLocked`, `Version`, `Type`
(`0`=General, `1`=Assembly). `SysPackageDependency` — `SysPackage` and `DependOnPackage` (both Lookup
→ `SysPackage`, both bare names — no `Id` suffix; the scalar FK aliases `SysPackageId`/
`DependOnPackageId` project but are not filterable via dotted navigation), `DependOnPackageVersion`.
`SysInstalledApp` — `Name`, `Code`, `Version`, `SysInstalledAppStatusId`.

**Find a delivered application by its install record's `Element`, not by `ApplicationCode`.** On an
`Install application` record, `Element` holds the application's code — the value of
`SysInstalledApp.Code` — while `ApplicationCode` can hold its name. `[observed]` On an application whose
name and code differed, `ApplicationCode` carried the name and `Element` the code, and a lookup of
`SysInstalledApp.Code` by `ApplicationCode` returned nothing although the application was registered —
which reads as "the application was not registered" and is wrong.

Use this when errors reference schemas of a package the user says was removed, or a console message
reports a package "not found in topology" — leftover dependent references are a common cause. Read
`SysPackage` filtered by the package name from the error text — an empty result corroborates "the package
is gone"; then read `SysPackageDependency` filtered by `DependOnPackage.Name eq '<deleted package>'`
(dotted navigation through the bare lookup) for rows still pointing at it; check `SysInstalledApp` only
if the error suggests the package shipped as part of an application.

### Schema checks — `SysSchema` (name/case/lock/last-error)

Verified columns: `Name`, `UId`, `Caption`, `Parent` (Lookup → `SysSchema`, bare — no `Id` suffix),
`ExtendParent` (Boolean — always ask for it, see below), `SysPackage` (Lookup → `SysPackage`, bare),
`IsChanged`, `IsLocked`, `LastError` (LongText, caption
"Last error message text"), `StructureModifiedOn`, `ManagerName` (the schema kind, e.g. entity/
client-unit schema). Scalar FK aliases `ParentId`/`SysPackageId` project but are not filterable via
dotted navigation — filter through the bare lookup name (`Parent.Name`, `SysPackage.Name`).

Use this for name-collision or case-sensitivity problems — a custom object colliding with a base type
name, or two schemas whose names differ only by letter case: read `SysSchema` filtered/ordered by `Name`
and compare case-insensitively to spot a collision or a case-only duplicate. Also useful whenever you're
narrowing a cascade of errors to their root schema: `LastError` can hold a stored error message for a named
schema independent of any specific `CompilationHistory` row — a quick bonus check. `IsChanged`/`IsLocked`
back general locally-modified/locked-schema hypotheses. Report flag/name values as evidence; never rename
or unlock anything — that is a manual step.

**Always ask for `ExtendParent`, and read it whenever two rows share a `Name`.** A row with
`ExtendParent = true` is a **replacing** schema: it does not create a new object, it modifies the one its
`Parent` points at, and its `MetaData` is stored as a **diff** against that parent — text that begins with
`=`, not JSON. So two rows under one `Name` are not automatically a duplicate or a collision — **when the
flagged row's `Parent` is the other row**, that shape is ordinary inheritance, and reporting it as a clash
destroys a legitimate customization. Check that linkage before clearing the pair: an empty `Parent`, or one
naming a schema no row answers, is not inheritance working and must stay a finding. It is, however,
**order-dependent**: a diff is valid only when applied *after* its base, and nothing orders two packages
except a declared dependency. So whenever you find such a pair, read **`SysPackageDependency`** for the two
packages that hold them — dotted navigation, `SysPackage.Name` and `DependOnPackage.Name`, because a bare
filter on either returns nothing. **Read the direction, not just the count:** the edge that orders them runs
**from the package holding the replacing row to the package holding the base**, so zero rows and a
reversed edge are the same finding — there is no defined install order, whatever the failure looked like.

> **Correction from live verification:** `SysSchemaProperty` (columns: `Name`, `Value`, `SysSchemaId`) is
> **not** a per-column/DB-structure list — it is a generic name/value property bag on a schema, unrelated
> to an entity's database columns. It is **not** a reliable way to confirm whether a specific column exists
> on an object. For an "invalid column name" error where the column visibly exists in the object designer,
> the correct on-platform check is `creatio_describe_object` on the **named object's own entity set**
> (if it is exposed) — if the column from the error appears in its properties, that reflects the
> compiled/designer-visible metadata, which is exactly the symptom's premise ("the field is right there in
> the object designer").

A stronger check than `creatio_describe_object` alone, when it's available: attempt an actual
`creatio_list_records`/`creatio_get_record` read on the named entity set with the disputed column named
explicitly in `columns`. Metadata (`creatio_describe_object`) only tells you the platform *believes* the
column exists; a live read either succeeds (proving the DB column is really there) or surfaces the
underlying SQL error text (e.g. `Invalid column name '<X>'`), which is direct, current, first-hand proof of
a metadata/DB desync rather than corroboration by inference. Prefer this over describe-only whenever the
entity set is safely readable (small/no side effects from a filtered, low-`limit` read) — it turns a "the
schema says it should be there" case into a confirmed live reproduction.

### `QuickAddMenuItem` — orphaned reference by UId (unconfirmed link — verify before trusting)

Verified columns: `Name`, `SysModuleEdit` (Lookup), `QuickAddMenuSettings` (Lookup, required), `Position`,
`Description`, `ModuleUId` (Guid).

> **Correction from live verification:** don't assume this schema can confirm a stale
> `EntitySchemaColumn` reference from a `ConfigurationSectionHelper.GetQuickAddConfig` exception — there is
> no field here that obviously links to that UId (`ModuleUId` most likely identifies a module/section, not
> a column). Treat any on-platform check here as best-effort: search `QuickAddMenuItem`/
> `QuickAddMenuSettings` for the UId as a text scan if you want to try, but don't present it as confirmed
> corroboration if nothing matches — the matching domain-file recommendation for this symptom stands on its
> own either way, recognized by signature but only partially verifiable from this platform.

## Delivery reads — packages, dependencies and schemas on the target

### Packages and their dependencies

Reuse **"Package composition & leftovers — `SysPackage` / `SysPackageDependency` / `SysInstalledApp`"**
above; those columns are verified. Read `SysPackage` by name to establish whether a package named in an
error is present at all; `SysPackageDependency` (dotted navigation through the bare lookups —
`SysPackage.Name`, `DependOnPackage.Name`) for the dependency graph actually stored on this environment;
`SysInstalledApp` when the package shipped as part of an application. Name the package that is absent —
"check your dependencies" is not evidence.

**The same read answers "are there two of them?"** — `SysPackage` filtered by `Name` returning **more than
one row** is itself the finding, and it matters because package deletion resolves by name rather than by
`Id`: with a duplicate present, removing "the extra one" removes the wrong package or fails. Report **both
`Id`s** with `InstallType`, `Maintainer` and `CreatedOn`, and read `SysPackageDependency` for each so the
answer says what either duplicate carries. Do not collapse the pair into one name.

> **`SysPackage.IsLocked`'s polarity is not established — report it, do not interpret it.** Read live on a
> connected environment: of **466** packages exactly one had `IsLocked = true`, and it was
> `Custom` (`IsChanged: true`, `InstallType: 0`, `Maintainer: "Customer"`) — the package that is *editable*
> there. Every package installed from a delivery (`InstallType: 1`) was `IsLocked = false`. That is the
> inverse of what "locked" means in support material, where a locked package is the read-only one that can
> be installed onto. Until the polarity is confirmed, quote `IsChanged` / `IsLocked` / `InstallType` /
> `Maintainer` as the values you read and let the caller's own evidence carry the verdict; a lock claim
> derived from this boolean alone can be exactly backwards. `SysRepository` + `RepositoryRevisionNumber`
> are the repository-bound signal for a package under version control, but they were `null` on all 466
> rows there, so that reading is unverified too.
>
> **Do not carry this caution over to `SysSchema.IsLocked` — it is a different column on a different
> entity, and its meaning is not in doubt.** A schema is protected from being overwritten by a delivery
> when `IsLocked` **and** `IsChanged` are both true; one without the other is not protection. The
> uncertainty above is about the **package** flag only. Keep the two apart in a report: naming the schema
> flags is evidence, quoting the package flag is a raw reading.

### Walking the dependency graph — finding a cycle

Same entity as above; this subsection is the **walk**, for the question "which packages form the cycle".

1. **Resolve the starting package** when the exception gave you an Id rather than a name: `SysPackage`
   filtered by `UId eq '<guid>'`, `columns: ['Id','Name','UId']` (verified live).
2. **Follow the chain from that package — do not enumerate the graph.** Measured on one real
   configuration: **557 edges in total, and a single hub package with 84 outgoing edges** while most have
   one to three. Reading all of that to "look for a cycle" is not a procedure anyone executes reliably.
   Instead, walk it:
   - read the starting package's edges — `SysPackageDependency` filtered by
     `SysPackage.Name eq '<name>'`, `columns: ['SysPackage','DependOnPackage']`, `compact: true` (a
     typical package returns a handful of rows);
   - repeat for each `DependOnPackage`, keeping the path and a visited set — one narrow read per hop is
     cheaper and far more reliable than scanning a 200-row page;
   - stop at the first name **already on the current path**: that repeat closes the cycle;
   - stop a branch when it runs out of edges, and bound the depth you will walk (a dozen hops is
     generous) rather than exploring forever.
3. **Report the cycle as an ordered path** — `A → B → C → A`. "There is a circular dependency" is not a
   finding. When you stopped on a depth or breadth bound instead of on a repeat, **say you did not
   establish a cycle** rather than implying the graph is clean.
4. **Corroborate a suspected stale descriptor.** With file-system development a package's descriptor can
   be out of date and produce a cycle that is not really there. Read `SysPackage` for the packages on the
   path, projecting `Name`, `UId`, `Version`, `IsChanged`, `IsLocked`, and report those alongside the path
   so the reader can judge whether the graph reflects reality. Whether the descriptor file on disk is
   current is **not** readable from here — say so rather than implying it was checked.

Never break an edge yourself: which dependency to drop is the package owner's decision, and this skill
writes nothing.

### Schema state on the target

Reuse **"Schema checks — `SysSchema` (name/case/lock/last-error)"** above; those columns are verified.

- `IsChanged` / `IsLocked` for the schemas named in an error — **list the concrete elements** rather than
  restating the platform's refusal.
- `Parent` resolves a missing parent schema (the same-table foreign-key case).
- `SysPackage.Name` shows which package the target believes owns the element — this is how a "moved
  between packages" claim is confirmed.
- **A name collision is confirmed, not inferred:** read `SysSchema` filtered by `Name`; same `Name` with a
  **different `UId`** and `SysPackage` naming the package that already holds it *is* the collision.
  Verified live this way: `PaymentMethod`, `UId 5da543c5-…`, `SysPackage "PRMBase"` against an incoming
  `UId 8ef4104a-…`.

- **When the error hands you a `UId`, filter on it rather than on the name.** `Object with UId … already
  added to manager` names the element exactly: `SysSchema` filtered by that `UId` returns the row that
  answers, and its `SysPackage.Name` says which package the target believes holds it. A hit in `Custom`
  while the delivery carries the same element in another package is a leftover copy, not a coincidence —
  the UId makes that exact instead of inferred. A `Name` filter is the fallback for signatures that quote
  only a name.
- A collision can also cross **schema managers**, so do not narrow to one: a web service is
  `ManagerName = 'ServiceSchemaManager'` (read live; that manager holds e.g. `CreatioMarketplaceApi` in
  `CrtBase`), an entity schema is `EntitySchemaManager`. Two rows sharing a `Name` under *different*
  `ManagerName` is the conflict behind a web service that silently fails to install. "No other object with
  this name in my section" is not a sufficient check.

Never rename, unlock or reset anything — those are manual steps for a human.

- A collision can also cross **schema managers**, so do not narrow to one: a web service is
  `ManagerName = 'ServiceSchemaManager'` (read live; that manager holds e.g. `CreatioMarketplaceApi` in
  `CrtBase`), an entity schema is `EntitySchemaManager`. Two rows sharing a `Name` under *different*
  `ManagerName` is the conflict behind a web service that silently fails to install. "No other object with
  this name in my section" is not a sufficient check.

Never rename, unlock or reset anything — those are manual steps for a human.

Never rename, unlock or reset anything — those are manual steps for a human.

**`SysSchema.Name` is not unique, and two of its timestamps are traps.** Verified live:

- **A schema name returns one row per package that extends it** — the inheritance chain. `Contact` and
  `Lead` between them account for dozens of rows; a filter on five common names returned **47**. So project
  `SysPackage` alongside `Name` and expect several rows: *absent* still means the schema is nowhere on the
  environment, but a *hit* does not tell you which package's copy you are looking at until you read the
  package. Base objects that nothing extends do return a single row.
- **`StructureModifiedOn` is global, not per-object.** Every schema row carries the *same* value — the last
  database-structure update for the environment. It cannot date a change to one object.
- **`MetaDataModifiedOn` is unusable**: `null` or the sentinel `1970-02-17T02:00:00` on real rows.

Neither timestamp moved, and `IsChanged` stayed `false`, when Change Log was switched on for four objects —
so schema-level edits made through System Designer are not necessarily visible in these columns at all.

# Installation — data & bindings reference

**Not a case file, and not part of the spine's §5.1 search.** `installation-catalog-data-bindings.md` holds
the eleven signature-matched cases; this file holds the two things several of them need and none of them
owns: how the installer treats a binding's **installation type**, and how to decode a **package-validator**
message when the incident arrives without a delivery.

Opened **on demand, from an entry that points here** — never swept, never read "just in case". Both blocks
are *read from the installer and validator implementation*, not verified against a live environment; the
log lines and messages quoted are the product's own, taken from its resources.

---

## A. The binding's installation type

*Read from the installer's own branch on the type, not from a live environment; the log lines quoted below
are the messages the product emits, taken from its resources.*

`SysPackageSchemaData.InstallType` is an **integer**, and the installer switches on it **before** it looks
at any column setting. Read it whenever a delivery reported success and the data did not change: it answers
"was this binding meant to install here at all?", which no column-level read can.

**Read it *second* when the symptom is a malformed row rather than an unchanged one.** A row that arrived
with an empty column is answered by the binding's **column set** — not by its type, which can read
perfectly normal while the value was never sent. IB7's read 4 owns that order: column set, then type. This
section answers *was it applied*; that one answers *was it ever sent*. Reaching for this read instead of
that one is a measured failure mode, not a hypothetical.

| Value | Name in the product | What the installer does | `IsForceUpdate` consulted? |
|---|---|---|---|
| **0** | `Install` | inserts rows that are absent; on a row that already exists, overwrites **only** the columns carrying the flag | **yes**, on an existing row |
| **2** | `Update` | the same shape as `Install` — they diverge only in how the flag gate is computed for a *localized* row | **yes**, except when inserting |
| **1** | `FirstInstall` | **skips the whole binding unless the package is new on this environment**; when it does run, writes every column | no |
| **3** | `InstallIfNotExists` | **skips the whole binding if that binding already exists in the target package** — the gate is the binding's existence, not the row's; when it does run, writes every column | no |

**Report the value, not the caption.** The captions differ between builds: value 1 reads *"Initial
installation"* in the platform's own resources and *"Initial package installation"* in the newer designer;
value 3 reads *"Install only new records"* against *"Initial data installation"*. Two of the four. A finding
that names only the caption cannot be checked by someone whose environment spells it differently.

**`InstallType` is two unrelated enums on two tables.** On `SysPackage` the values are `SourceControl` (0)
and `Repository` (1) — package provenance. On `SysPackageSchemaData` they are the four above. So `1` means
*Repository* on one table and *FirstInstall* on the other: carrying one table's reading over to the other
does not produce vagueness, it produces a confident wrong sentence. Name the table you read it from.

**"The delivery succeeded and nothing changed" has four readable causes, and the flag is only one.**

1. **`IsForceUpdate = false`** on a column of a row that already exists — IB4's mechanic, and the only one
   the flag fixes.
2. **`InstallType = FirstInstall`** where the package is not new here. Emitted **as a success**:
   `<binding> Skipped, InstallType = FirstInstall`.
3. **`InstallType = InstallIfNotExists`** where the binding already exists in the target package. Emitted as
   a **warning**, not an error: `The bound data '<name>' [<UId>] (package '<name>' [<UId>]) was updated in
   package, but data install will be skipped and installation type set up as 'InstallIfNotExists'.`
4. **The binding's data file is empty** — the installer returns before it branches on the type, and emits
   nothing at all.

**For 2, 3 and 4 enabling Force Update changes nothing**, because the flag is consulted only on the
`Install` and `Update` paths. Recommending it there is the trap IB7's read 4 names: advice that sounds
expert and cannot work. Establish the type first, then talk about columns.

**A fifth cause exists and is not readable from the target.** A delivery can be run with the option that
installs only new bindings and localizations, which skips every pre-existing binding of a non-localizable
object — nothing on the environment records that the option was used. So when all four reads above come
back clean, say the cause is **not established here** and ask how the delivery was run; do not present the
four as exhaustive.
---

## B. Pre-install evidence — the package validator

**A second way these cases arrive — a validation message, with no delivery at all.** Everything below
assumes a delivery ran. Several of these mechanisms are also caught *before* one, by the platform's own
package validator: on Configuration Validation, on moving elements between packages, and on changing a
package's dependencies. **That evidence is not readable** — the validator raises its findings as an
exception where the operation was invoked, so it reaches you only as text the requester pastes, formatted
`[<element type>] [<element name>]: <message>`, one line per finding. *Read from the validator
implementation, not from a live environment.*

| Validator message | Severity | What it means, and which entry it belongs to |
|---|---|---|
| `Key is not specified in the data structure` | blocking | the binding has no key column at all, so nothing can be matched against a target row |
| `Data structure does not allow the use of composite key that includes primary column` | blocking | the key mixes `Id` with other columns |
| `Id not specified in data object` | blocking | a row in the payload carries no identifier — same family as **IB11**: the payload itself is malformed |
| `Key columns "…" contain duplicate records "…"` | blocking | two payload rows collide on the key — **IB3's** collision, caught before the install instead of as `23505` |
| `The record with Id "…" is already bound in the data "…" of package "…" for schema "…"` | blocking **inside one package**, advisory across packages | **IB5's** mechanic — but see the caution below before using the split |
| `Item with name "…" already exists` | blocking | **IB6's** two-bindings-one-name, caught before the install |
| `Schema with Id "…" not found` / `Column with Id "…" in schema "…" not found` | blocking | the binding references a schema or column the configuration no longer has |
| `Bound schema … is not accessible for data …` | blocking | the bound object is not reachable through this package's dependencies |
| `Data is not bound for connected object "…" by column "…". Value: "…"` | blocking | **IB1's** missing reference, named **on the source** — and it carries the value, which the runtime error cannot always give |
| `The data bind is performed by the "Id" column` | advisory | bound by `Id` rather than by a business key |
| `The column "…" is "Required"` | advisory | a required column sits in the binding without Force Update |

**The advisory ones are collected and then discarded.** Both paths that surface these findings filter to
errors before composing the message, so a warning never reaches the requester this way. Two consequences,
and the second is the one that misleads: the absence of a warning is **not** evidence of anything, and
"validation passed, so your cross-package duplicate is fine" is a false inference — validation was never
going to mention it.

**Do not use the severity split to contradict a refused save.** The validator grades a duplicate in
*another* package as advisory; IB5's own evidence is a requester who could not save at all. Those are two
different code paths, so both can be true. The split explains why validation stayed silent; it does not
license telling someone the block they hit was not real.

**The one readable thing in this area.** Whether a dependency change validates bound data at all is gated
by the feature **`EnableValidateConfWhenPkgDependenciesChanged`** (declared enabled by default). With it
off, the dependency-change path skips schema-data validation entirely, so a duplicate that would otherwise
block the change passes unnoticed. Feature state **is** readable — see `rca-env-readonly-query` — and reading
it is what separates "validation would have caught this" from an assumption. This is the readable half of
IB6's second symptom, the dependency change that reverts itself.

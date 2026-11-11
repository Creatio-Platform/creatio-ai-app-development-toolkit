# Installation — schema conflicts reference (how the delivery decides, and how to prove it)

**Not a case file, and not part of the spine's §5.1 search.** `installation-catalog-conflicts.md` holds the
signature-matched cases; this file holds the **behaviour underneath them** — what a delivery does with each
element it meets, which state on the environment drives that decision, and **which read proves it**.

Opened **on demand, from an entry that points here** — never swept, never read "just in case". Read it when
an entry's verification needs to know *why* the delivery did what it did, when a recommendation would change
a flag, or when the log and the outcome disagree.

**Every statement here is a statement about product behaviour, and every one comes with the read that
confirms it on a live environment.** That is the contract of this file: nothing below may be reported to a
requester on this file's authority alone — report what you read, using this file to know *what* to read.

Two tags separate what is settled from what is not, and they are not decoration:

- **`[observed]`** — reproduced on a connected environment,
  with the read named. Commit to it, and name what your own read returned.
- **`[unverified here]`** — known behaviour that has **not** been reproduced on an environment we can read,
  usually because the deciding state is not reachable from one. Say so plainly, and say what would settle it.
  Never upgrade one of these to a finding because it fits.

**What this file changes in how the catalog is used:**

1. The protection rule is a **conjunction of two columns** on the element, and it is **not the whole
   story** — two conditions override it entirely (§B, §C).
2. "The element is not in the incoming package" does **not** mean the delivery leaves it alone. It means the
   delivery tries to **delete** it (§C). That is the mechanic behind the whole "I reset the flags and now it
   fails differently" family, and resetting the flags is what *enables* the delete.
3. Because of (2), **one message covers several situations**: the same wording is reached from two different
   directions, and the same situation changes its wording as soon as a flag changes. That is why the
   catalog's **§0 inventory pass** runs *before* any signature is matched, and why the activity-log chain is
   an index into that inventory rather than evidence in its own right.

---

## A. The five outcomes an element can have in a delivery

Every schema, binding, SQL script and reference assembly the delivery meets ends in exactly one of five
outcomes. The decision is taken for the whole delivery **before** anything is written, and it is taken per
element — so one delivery routinely mixes all five.

| Outcome | Reached when | What you see afterwards |
|---|---|---|
| **Untouched** | the incoming element and the target's copy are identical | nothing at all — no log line, no activity-log row |
| **Created** | the element's `UId` is not on the target | the element appears; a `Create` row in the activity log |
| **Overwritten** | content differs **and** the target's copy is not protected | the element changes; an `Update` row |
| **Refused** | content differs **and** the target's copy **is** protected | `…because the element has been modified locally`, logged as a **warning**; the delivery's result turns to Error and it carries on; an `Update` row is still written |
| **Deleted** | the element is on the **target** and **absent from the incoming package**, and nothing protects it | a delete is attempted — and can itself fail (§C) |

**Two of these come from opposite directions, and that is the whole trap.** *Created / Overwritten / Refused*
are decided by walking the **incoming** package. *Deleted* is decided by walking the **target's** own
content and asking what the archive failed to carry. A protected element reached from the second direction
is *Refused* too — same sentence, entirely different situation, opposite fix.

## B. The protection rule: two columns, and only together

An element's copy on the target is protected from a delivery when **both** of these are true:

| Table | Columns that must both be `true` |
|---|---|
| a schema | `SysSchema.IsLocked` **and** `SysSchema.IsChanged` |
| a binding | `SysPackageSchemaData.IsLocked` **and** `SysPackageSchemaData.IsChanged` |
| a SQL script | `SysPackageSqlScript.IsLocked` **and** `SysPackageSqlScript.IsChanged` |
| a reference assembly | `SysPackageReferenceAssembly.IsLocked` **and** `SysPackageReferenceAssembly.IsChanged` |

**One flag alone is not protection.** `IsChanged = true, IsLocked = false` is overwritten silently, and so is
`IsLocked = true, IsChanged = false`. A read that returns only one of the two rules the locking entries
**out**, not in. `[observed]` — read on `SysSchema` per element; the same read answers overwrite, refusal and
deletion, because all three consult the same pair.

**The same pair gates deletion**, which is why §C matters: an unprotected element absent from the archive is
deleted, and a protected one is refused instead.

**And the pair is overridden by two conditions** — see §C's table, read top to bottom. A protected element
that was deleted anyway is not a contradiction; it means one of those two applied. **`[observed]`**: an
element carrying both flags was deleted, and the installation log carried no "modified locally" line
anywhere.

> **A caution about the source side, which no read on the target can answer.** The flags on the copy *inside
> the archive* also take part: an element exported while it was changed-but-unlocked on the source is **not
> applied** to the target, with no error of any kind — the delivery reports success and the target keeps its
> version. That is a distinct cause of "installed, nothing changed", and the state that decides it travelled
> inside the package. `[unverified here]` — it needs the source environment, or the archive, to confirm; from
> one connected environment, name it as a possibility and do not assert it.

## C. An element the archive does not carry is deleted, not skipped

For an element that exists on the target and **not** in the incoming package — **read this table top to
bottom and stop at the first row that applies.** The first two rows override the flags entirely.

| Condition | Outcome | What the requester sees |
|---|---|---|
| the **whole package** is absent from the archive | **Deleted, unconditionally** — protection is not consulted at all | every element of that package goes, flags or no flags |
| the feature `OverwriteTargetStorageChanges` is **on** | **Deleted** — protection is bypassed for the whole delivery | the same, and **no** refusal warning can appear anywhere in the log |
| the element is protected (§B) | **Refused** | `…because the element has been modified locally` |
| anything else | **Deleted** | a delete is attempted — and may itself fail |

Row two is `[observed]` (below). Row one is `[unverified here]` — it did not fire in the case we
watched, because the package *was* in the archive; treat it as a possibility to rule out by checking whether
the package itself is named in the `with packages` list of the record's `Description`. Only a
**populated** list proves presence or absence. An empty `packages ""` is the dependency pre-flight
refusal: it composed nothing and has no child rows, so nothing was deleted and this row cannot apply. A
`Package "X" loaded` line alone does not prove presence either: the log also names the environment's
inactive packages that way, and the delivery did not carry them (`installation.md` §2.5).

**This is one situation in two costumes, and the flags choose the costume.** Clearing `IsChanged` /
`IsLocked` to "resolve the conflict" does not make the delivery carry the element; it removes the protection
standing between that element and a delete. **Before recommending a flag reset, establish that the element is
in the incoming package** — otherwise the recommendation converts a refusal into a deletion.

### How to prove the element was not in the archive

The `.zip` cannot be read from a connected environment — the attachment reader is text-only and backup
archives are skipped. What the delivery carried is reconstructed instead, and there are two tests.

1. **The timeline test, and it is the one that always answers.** An element whose `CreatedOn` on the target
   is **later** than the export moment cannot be in that archive. The export moment sits in the archive's own
   file name — `<Package>_<yyyy-MM-dd>_<HH.mm.ss>.zip`, echoed in the installation log's `Loading file:`
   line. An identical `Loading file:` line across two attempts proves the **same** archive was re-installed,
   which is often the whole finding when a second attempt "fails differently".
   **Mind the two clocks** (the spine's §2.3 owns the rule): the log's stamps and the activity log's are not
   the same clock, so convert before comparing. `[observed]` — an archive named `…_15.30.54.zip` against a
   schema created at `12:32:59` in the activity log was a **+3 h** offset and a **two-minute** gap: the
   element post-dated the export by two minutes, not by three hours in either direction. Getting this
   backwards inverts the diagnosis, so state the offset you used.
2. **The child-row test, as corroboration — and mind what a *failed* delete leaves behind.** The activity-log
   row for an element is written **after** its operation succeeds, and element artefacts are kept only for
   `Create` and `Update`. So an element the log names that has **no child row of any kind** under this
   delivery was either deleted-and-blocked or never touched — the timeline test says which. `[observed]` — a
   failed delivery whose only activity-log records were its own two installation rows, with the failing
   element named in the installation log and absent from the activity log entirely. **Absence here is never
   evidence that nothing was attempted.**

### What blocks the delete, and how it is reported

Two different things, reported by two different mechanisms, and both can appear in one log. `[observed]`
together, in one delivery.

1. **A pre-check, before the delivery composes anything.** It looks for an **inherited or replacing schema in
   another package** — a child element whose parent is the element being removed, across a package boundary.
   Verbatim, and both lines come from **one** check, so seeing them together is one finding, not two:

   ```
   Cannot delete the package <A> because the package <B> depends on it.
   To proceed, remove the dependency in the properties of <B>, then try again.

   Unable to delete item "<X>" of package "<A>". It has dependent item "<X>" in package "<B>"
   ```

2. **The database, during the delete.** The parent/child link between schemas is a foreign key, and it
   rejects the statement. Reported per element, as a pair of lines:

   ```
   Error occured while performing operation on "<X>" item, UId = <uid>.
   … 23503: update or delete on table "SysSchema" violates foreign key constraint "FK…" on table "SysSchema"
   ```

   This is caught per element, so the delivery **continues** through every remaining stage and finishes "with
   errors".

**The consequence for the report:** the dependent element named in these messages is doing its job. A
replacing schema in a dependent package is a normal, supported configuration — see §F. Recommending that it
be renamed or deleted to "fix the duplicate" is wrong, and it destroys a legitimate customization.

## D. Two settings change the behaviour wholesale — check them before diagnosing

**`OverwriteTargetStorageChanges` — a feature, and readable.** When it is on, protection is bypassed for the
whole delivery: every incoming element overwrites, and every target element missing from the archive is
deleted. An environment with it enabled **cannot produce the "modified locally" refusal at all** — so if the
requester reports one, it is off; and if they report elements vanishing after a delivery, check it first.

*How to read it:* `Feature` filtered by `Code`, then `AdminUnitFeatureState` for the per-unit override —
`Feature.DefaultState` on its own is **not** the answer. `[observed]` — a stand where `DefaultState = 0` yet
`AdminUnitFeatureState.FeatureState = 1` for *All employees*, and the delivery behaved as "on".

**`Feature-AllowPackageElementsMove` — an application setting, and *not* readable from here.** It decides
whether a protected element is **refused loudly or left alone in silence** — the difference between the two
locking entries in the catalog. Two things about it matter more than its value:

- It is a key in the **application's own configuration**, read once at startup, defaulting to **on**. It is
  **not** a row in the Features table. A same-named record in the feature UI is a different thing, and
  toggling it changes nothing here — which is exactly why an earlier experiment toggled that record, saw no
  difference, and concluded the setting was irrelevant.
- `[unverified here]` and unverifiable from one connected environment. Report the shape you observed — a
  refusal in the log, or silence — and say the setting behind it lives in the application configuration,
  which this investigation cannot read. Do not tell a requester why they got one shape rather than the other.

**A third gate, worth knowing exists.** The duplicate-name check at install time is itself switchable; with
it off, a duplicate name installs with no message at all. `[unverified here]` — the switch has not been
observed in either state on a readable environment, so treat "no duplicate-name error in the log" as weak
evidence, never as proof that there is no duplicate.

## E. Elements are matched by `UId`, never by name

The delivery pairs an incoming element with the target's copy by `UId` alone. Three consequences worth
carrying into an answer, all confirmable with one read each:

- **Same name, different `UId` = two unrelated elements.** The delivery will not recognize one as the other,
  and will happily create the second while trying to delete the first. *Prove it:* `SysSchema` by `Name`,
  comparing the `UId`s.
- **A moved element is recognized as a move, not a collision** — when the incoming element's `UId` is found
  on the target in a *different* package, it is simply applied there. That is why installing the package it
  moved **from** first is the fix for that variant, and why no flag reset is needed for it. *Prove it:* a
  `Move element` record in the configuration log whose element `UId` equals the one in the error.
- **Any `UId` quoted in an error is the one exact search key you have.** Read `SysSchema` by that `UId`
  before reading by name.

## F. Duplicate schema names: what is actually forbidden

Two schemas may share a `Name` legitimately. What the product forbids is **two independent base schemas**
with the same name and the same manager in the configuration. A **replacing** schema is exempt on both sides
of the comparison — it is *supposed* to carry its parent's name.

So a pair of `SysSchema` rows with the same `Name`, different `UId`s, in different packages, where one has
`ExtendParent = true` and a `ParentId` pointing at the other, is **inheritance working** — not a duplicate,
and not an incident.

`[observed]` and not marginally: on a connected environment **449** entity schemas carried
`ExtendParent = true`, among them two rows named `Activity`, in different packages, sharing one `ParentId`.
An entry that called same-name pairs a defect would fire on the product's own base configuration.

*How to prove it, per pair:* `SysSchema` by `Name` → `UId`, `SysPackage.Name`, `ManagerName`, **`ExtendParent`
and `ParentId`** in the same call. `[observed]` — both columns are directly readable; `ParentId` resolves as a
lookup back to `SysSchema`. When the rows are not to hand, the activity log carries the same fact per entry as
**`ConfActivityLog.IsReplacedSchema`** `[observed]` — a readable column.

`ManagerName` is part of the identity, so the same name under two different managers (an object and a web
service, say) is a different collision, and the catalog's web-service entry owns it.

**Two real wordings, and one that does not exist.** The configuration-wide message is
`"<Name>" configuration schema already exists in the following package(s): "…", "…"`; the package-scoped one
is `Item with name "<Name>" already exists in this package.` The hybrid
`Item with name "…" already exists in the following package(s): …` is **not** a product message — a literal
search returns zero, which reads as "no collision here" and is exactly how this gets ruled out wrongly.

## G. What the installation log says versus what happened

Four mismatches, all of them load-bearing.

1. **A deleted schema is logged as saved.** A delete and a write emit the *same* line,
   `Schema "<X>" saved in package "<Y>"` — there is no "deleted" wording in the installer's vocabulary. **A
   `Schema "X" saved` line is not evidence that X was written.** Tell a write from a delete by the activity
   log's operation (§H), not by this line.
2. **A refused element is a *warning*, not an error line.** The refusal is logged at warning level while the
   delivery's overall result is separately set to Error. A log filtered to `ERROR` loses it entirely.
3. **Per-element failures do not stop the delivery.** The failure is recorded against the element and the run
   continues through every remaining stage — package save, dependencies, database structure, data, install
   scripts, build. `[observed]` — a delivery that failed on one element still reported `Configuration build
   finished`. "The delivery finished all its stages" and "the element was applied" are independent facts.
4. **`Actions skipped for schema "X" from package "Y" in N sec`** reports that the schema needed no
   *database-structure* actions. It appears in ordinary successful installs and says nothing about whether
   the schema was written.

The lines this family actually matches on, verbatim:

| What happened | The line |
|---|---|
| an element was refused | `Unable to install <Type> "<X>" into package "<P>", because the element has been modified locally. Resolve the conflict and mark the element as unchanged.` |
| an element was written **or deleted** | `Schema "<X>" saved in package "<P>"` |
| an element's operation failed | `Error occured while performing operation on "<X>" item, UId = <uid>.` |
| a schema needed no structure work | `Actions skipped for schema "<X>" from package "<P>" in <N> sec` |
| the archive being installed | `Loading file: <Package>_<yyyy-MM-dd>_<HH.mm.ss>.zip 100%` |
| element decisions are being taken | `Composing packages` |
| a package was written | `Files saved in package "<P>"` · `Package "<P>" saved` |
| a delete was blocked by a dependent package | `Cannot delete the package <A> because the package <B> depends on it. …` |
| a delete was blocked by a dependent element | `Unable to delete item "<X>" of package "<A>". It has dependent item "<X>" in package "<B>"` |
| a zip clashed with a repository-bound package | `Unable to install zip package while SVN package with the same UId exists.` |
| a name collides configuration-wide | `"<X>" configuration schema already exists in the following package(s): "…"` |
| a name collides inside one package | `Item with name "<X>" already exists in this package.` |
| a `UId` is already held | `Object with UId <uid> already added to manager.` |
| a column name collides | `Property conflict in '<X>': property '<C>' already exists. Rename one of the conflicting columns and republish affected schemas.` |

The `<Type>` token in the refusal line is the element kind — `Schema`, `SchemaData`, `SqlScript`,
`Assembly` — which is why the same sentence appears for a binding.

## H. What the activity log records, and what it does not prove

Per element, within a delivery:

| Outcome (§A) | Operation recorded |
|---|---|
| Created | `Create` |
| Overwritten **or Refused** | `Update` |
| Deleted (successfully) | `Delete` |
| Untouched | nothing |

Three readings follow, and they are the reason to prefer the log's operation over the installer's prose:

- **A `Delete` row on an element during an installation is §C made visible.** It says the delivery concluded
  the element was not in the incoming package. That is a finding, not a side effect.
- **An `Update` row does not prove the element was applied** — a refused element records `Update` too. Pair
  it with the presence or absence of the refusal warning in the installation log before saying anything
  changed. `[unverified here]` — no refused element has been observed on a readable environment, so confirm
  the pairing rather than asserting it.
- **A blocked delete records nothing**, because the row is written after the operation succeeds. `[observed]`
  — see §C's child-row test.

Element artefacts (`metadata.json`, `readable.metadata.json`, sources, `data*.json`) are kept only for
`Create` and `Update`, so a `Delete` row has no artefact to read — do not plan a comparison around one.

## I. The tables that carry the flags

When the recommendation is "mark the element as unchanged", the complete set the product itself clears for a
package, in one transaction, is:

`SysSchema` · `SysPackageSchemaData` · `SysPackageSqlScript` · `SysPackageReferenceAssembly` · `SysPackage` ·
`SysPackageResourceChecksum` · `SysLocalizableValue`

`IsLocked` is a separate family of updates over the same tables, driven by the lock/unlock operations.

Use this list to make a hand-over script **complete**, not longer: name the tables that actually hold the
element in question. And keep the catalog's rule — **these are quoted for a human to review and run; this
agent does not run them and does not offer to.** Per §C, check that the element is in the incoming package
before quoting any of them at all.

## J. How to prove each of these on the environment

This file is only usable to the extent its statements are checkable. One read per question, all of them
read-only.

| Question | Read |
|---|---|
| is this element protected? | `SysSchema` by `UId` → `IsLocked`, `IsChanged` — both, and report both |
| is protection being bypassed? | `Feature` by `Code` = `OverwriteTargetStorageChanges`, then `AdminUnitFeatureState` for the override |
| was the element in the archive? | the installation log's `Loading file:` line versus the element's `CreatedOn`, clocks converted (§C) |
| was the element touched at all? | `ConfActivityLog` children of the delivery, filtered to this element — and remember a blocked delete leaves none |
| is this same-name pair a defect? | `SysSchema` by `Name` → `ExtendParent`, `ParentId`, `UId`, `SysPackage.Name` |
| what blocked the delete? | the installation log's two delete messages, then `SysSchema` by `ParentId` and `SysPackageDependency` for the named packages |
| is the package developed here or delivered here? | `SysPackage` → `InstallType`, `Maintainer`, `CreatedOn`, and whether the application has a delivery record as its parent |
| which bindings hold this schema? | `SysPackageSchemaData` by `SysSchema` → `Name`, `SysPackage.Name`, `IsChanged`, `LastError` |

**If a question here cannot be answered from the environment in front of you, that is the answer** — say
which side you read, what it returned, and what stayed out of reach. An unverifiable statement repeated from
this file is not evidence.

# Domain: Installation — schema conflicts, locking & drift (case catalog)

Open this file **only from `installation.md` §5**, after that spine has established the stage the
delivery reached and its outcome — never before, and never as a way to look for something recognizable in
the error text first. The stages that route here are the **schema-install stage**, the **DB-structure
stage**, and the half of the shared **SQL-scripts stage** where the object the script needs exists but the
target's structure or data does not match what it assumes (the spine sets that discriminator; follow it).

Recognizing an entry below is not evidence that it is the blocking cause. An installer log carries earlier
non-fatal noise and keeps going after a fatal error, so the signature you match must be one the spine
already isolated.

**Not what you're looking for?**

- **A delivery that applied nothing at all** — the log stops at `Composing packages`, the record has
  **zero child rows**, and no `Schema "…" saved`, no `Installing data` and no build markers appear
  anywhere → `installation-catalog-dependencies.md`. The package's content did not differ from
  what the target already holds, so there was nothing to apply. That is the sibling half of "install
  succeeded, nothing changed" (spine §4), and it is told apart from **IC2** by an **absence of stage
  markers**, not by any line about skipping. The symptom the user reports is identical and the fixes are
  opposite, so read the evidence before choosing.

  > **Do not look for `Skipped actions for schema "…"`.** That wording circulates in write-ups
  > and **exists nowhere in the product** — a literal search returns zero, which reads as "there
  > was no skip" and is exactly how the wrong branch gets taken. The real line is
  > `Actions skipped for schema "X" from package "Y" in N sec`, it reports that the schema needed no
  > database-structure actions, and it appears in ordinary **successful** deliveries — verified live on
  > base schemas `Contact` and `Account` inside a clean install. Matching on
  > it would fire on healthy installs.
- A foreign key raised on a record **delivered with the package** (an image, a lookup value, a culture) →
  `installation-catalog-data-bindings.md` / `installation-catalog-localization.md`. This
  file owns the target's *own* structure and business data.
- A missing package, parent schema or install-order problem →
  `installation-catalog-dependencies.md`.
- "Do I need to roll back?" → the spine's restore gate (§6). Several entries here end in a failed,
  partly-applied delivery; none of them answers the restore question, and none should restate it.

Real cases, by mechanism: locking and local edits, name/UId
collisions, target DB structure and data, deleting referenced schemas, and environment drift.

**`installation-catalog-conflicts-reference.md` holds the mechanism underneath these entries**, read
from the product sources: which pair of columns actually protects an element, what the installer does with an
element the archive does not carry, the two settings that switch the whole behavior, and which log lines mean
something other than what they say. It is **not** part of the §5.1 search — open it from an entry that points
there, when a verification needs to know *why* the platform did what it did, or when a recommendation would
change a flag. **Before recommending any `IsChanged` / `IsLocked` reset, read its §C** — on an element the
incoming package does not carry, that reset does not unblock the delivery, it authorizes a deletion.

**What the ids are.** `IC*` is the entry's position in this file — `I` for installation, `C` for
conflicts — and the sibling catalogs number their own entries the same way: `IB*` for data bindings, `IL*`
for localization, `ID*` for dependencies and install order. They are numbered by mechanism, in the order
the sections below run.

Every entry is tagged by **evidence tier**:

- **`[Tier A]`** — the diagnosis is fully confirmable from a platform read; commit to it, and name the
  concrete element the read returned.
- **`[Tier B]`** — recognized by signature with partial corroboration on the platform; say plainly what
  is confirmed and what is not.
- **`[Tier C]`** — the deciding evidence is not reachable from one connected environment (the target's own
  data volumes, or the *other* environment). Recognize the signature, give the known fix, and say clearly
  that this part could not be verified from here.

**Never name an internal case id, a tier, or this file to the user** — `IC7`, "Tier B" and
"the conflicts catalog" mean nothing to a requester and make a diagnosis read as a lookup rather than an
investigation. They are how *we* refer to the work; the answer names the mechanism, the evidence and the
fix. See `rca-diagnosis-report`'s scrubbing rules, which apply from the moment an entry is matched — including
in any progress narration the requester can see, which is where this leaks in practice.

**Three rules that apply to every entry in this file.**

**The inventory comes before the signature.** In this family one message covers several different
situations, so a matched signature is a shortlist, never a diagnosis. §0 below is the pass that separates
them, and it is mandatory — no entry here may be reported from the log text alone.

**The reset scripts are handed over, never run.** Half of this family is fixed by clearing `IsChanged` /
`IsLocked` or by cleaning up data. Those are manual steps for a human, quoted so they can be reviewed
before anyone executes them. This agent does not run them and does not offer to.

**One connected environment cannot diff two environments.** Most of these cases arise *because* two
environments disagree, and the agent sees one of them. Confirm the side you can read, say which side that
was, ask the human for the other, and lower confidence. Never report a difference that was not observed.

Case ids (`IC*`) are internal — they never appear in a report. See `rca-diagnosis-report`'s scrubbing rules,
which apply from the moment an entry here is matched.

## 0. The inventory pass — run it before matching any entry below

**One message in this family covers several unrelated situations.** `…because the element has been modified
locally` is raised both for an element the archive *does* carry and for one it does **not** — the composer
reaches the same wording from two different passes (reference §A, §C). The same holds the other way: the same
underlying situation produces a different message once a flag changes, so two consecutive attempts on the
**same archive** can read as two different incidents. Matching the log text first, and reading the rest as
confirmation, is how the wrong one gets reported — with a recommendation that makes the next attempt worse.

So the order is fixed: **build the inventory, then match.** Three reads, in this order, and none of them is
the activity-log tree.

**0.1 — What the delivery actually carried.** Before anything else, know the contents of the archive and of
the files that came with it. This is the schema-side twin of the spine's §2.4a — that section reads a
binding's delivered rows off the child entry; this one reads a schema's delivered artefacts off the same
place. Reachable, and worth naming as evidence:

- **The installation log, read whole** (`install_<yyyyMMdd>_<HHmmss>.txt` via `rca-cal-file-read`). Its
  `Loading file:` line names the archive, with the export moment inside the file name — and an identical
  line across two attempts proves the **same** archive was re-installed, which is a finding on its own. The
  per-element lines that follow are the delivery's own inventory of what it touched.
- **The per-element artefacts attached to the delivery's child entries** — `metadata.json`,
  `readable.metadata.json`, `descriptor.json`, the `.cs` / `.js` source, `data*.json` / `localization.json`.
  This is the closest readable thing to "the contents of the archive", and it is per element rather than
  per package.
- **A gap that is itself evidence — but read it with the reference's §C, not on its own.** Artefacts are
  collected only for `Create` and `Update`, and the child row is written only **after** the operation
  succeeds, so an element the log names that has **no child row of any kind** under this delivery was
  either deleted-and-blocked or never touched. Observed live on a failed delivery whose only records were
  its own two install rows. The **timeline** — the element's `CreatedOn` against the export moment in the
  archive's file name, with the two clocks converted — is what tells the two apart, and it is the test that
  always answers.
- **What stays out of reach, and must be said so:** the `.zip` itself is not readable from here — the
  content tool is text-only and backup archives are skipped by default. Report the inventory you built and
  name it as reconstructed from the delivery's own records, not read out of the package.

**0.2 — Every schema named, read one by one.** Not "the schema in the error" — **all** of them: every element
the log mentions, plus every `SysSchema` row sharing a `Name` or a `UId` with one of them. Per row read
`UId`, `Name`, `ManagerName`, `SysPackage.Name`, `ExtendParent`, `ParentId`, `IsChanged`, `IsLocked`,
`Checksum`, `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy`. Read **by `UId` and by `Name` separately** —
the installer matches on `UId` only (reference §E), so a name search and a UId search answer different
questions and a case can turn on the difference between them. The two flags decide the outcome only as a
**conjunction** (reference §B); `ExtendParent` + `ParentId` decide whether a same-name pair is a defect or
ordinary inheritance (reference §F).

**0.3 — The tables behind the elements, not just `SysSchema`.** An element lives across several tables and a
conflict can sit in any of them: `SysPackage` (name, `UId`, `InstallType`, `Maintainer`, flags),
`SysPackageDependency` and `SysPackageHierarchy` (what depends on what — this is where a delete gets
blocked), `SysPackageSchemaData` (bindings, with their own `IsChanged` / `IsLocked` / `LastError`),
`SysPackageResourceChecksum` and `SysLocalizableValue` (resources and captions), `SysSchemaSource`. The full
flag-bearing set is in the reference's §I. Read the ones the elements from 0.2 actually touch, and say which
you read.

**And read one feature before you conclude anything from the flags:** `OverwriteTargetStorageChanges`
(`Feature` by `Code`, then `AdminUnitFeatureState` for the per-unit override — `DefaultState` alone is not
the answer). When it is on, protection is bypassed wholesale and a fully protected element is deleted with no
conflict warning anywhere — so the §B conjunction stops predicting the outcome. Verified live: a stand with
`FeatureState = 1` for *All employees* deleted an element carrying both flags. A locking entry reported
without this read can be confidently wrong.

**What the activity log is for here.** It is the **index** that points at the files and the elements — use it
to find the delivery's child rows, their operations and their attachments. It is not the diagnosis, and
walking the whole parent-child chain first costs the investigation its ordering: the chain looks the same for
cases that need opposite fixes. Read it narrowly, in service of 0.1–0.3, and let the element state decide.

**When the inventory contradicts the signature, the inventory wins.** Say what you read, name the elements,
and pick the entry the state supports — not the one the message resembles.

## 1. Locking and local edits

**IC1 — "Element has been modified locally": the target's copy is protected** `[Tier A]`
- *Signature:* `Unable to install Schema "…" into package "…", because the element has been modified
  locally. Resolve the conflict and mark the element as unchanged.` The same wording appears with
  `SchemaData` for a binding. The delivery reports the failure per element and carries on, so several of
  these can sit in one log. In Configuration such elements are marked with an asterisk.
- *Verify:* `SysSchema` filtered by `Name` → `IsChanged`, `IsLocked`, `SysPackage.Name`; for a binding,
  `SysPackageSchemaData` filtered by `Name` → the same flags plus `LastError` (see `rca-env-readonly-query`).
  **List the concrete elements** instead of restating the platform's refusal. The same read separates the
  two causes: if `SysPackage.Name` on the target matches the package named in the log, the element was
  edited here; if it names a **different** package, the element was moved between packages on the source
  and the target still holds it in the old one.
- *Recommendation:* **first establish that the incoming package actually carries this element** — if it does
  not, the flag reset does not unblock the delivery, it authorizes the installer to delete the element, and
  the next attempt fails on something else entirely. The reference's §C owns that check and the timeline read
  that answers it without the archive. **The refusal line is not that evidence.** The installer writes the
  same `…because the element has been modified locally` for a protected element the incoming package does
  **not** carry — the refusal row of the reference's §C table — so a log that names the element proves only
  that the element is protected, not that the delivery brought a version of it. What does count: the
  timeline test in the reference's §C, which can prove the element is **not** in the archive; and, as
  corroboration that it **is**, delivered code from the same package calling a member the target's copy
  lacks (the source had a version with that member), or the element having reached the target with an
  earlier version of the same package. Say in the report which of these established it. If none did, the
  first step of the recommendation is to confirm on the source that the package contains the element, and
  the reset comes after it. Once the element is known to be in the package: for local edits —
  reset the flags and reinstall, as manual steps for a human:
  `UPDATE SysSchema SET IsChanged = 0, IsLocked = 0` for the named schemas,
  `UPDATE SysPackageSchemaData SET IsChanged = 0, IsLocked = 0` for the named bindings, and
  `SysPackageResourceChecksum.IsChanged = 0`. Put them in the report as statements, with the element names
  filled in — "remove the protection" or "mark it unchanged" names no action by itself. For an element moved
  between packages — install the package it was moved **from** first, so the move is registered on the
  target, then the main package; no flag reset is needed for that variant. The rule that prevents both:
  elements are never edited on a target environment.
- *Why this one shouts and **IC2** stays silent.* The two are the same protection — the target's copy is not
  overwritten — and they differ on **one application setting**, `Feature-AllowPackageElementsMove`. With it
  on, a protected element is refused loudly and the warning is emitted; with it off, the element is left
  alone in silence. It is a key in the **application's own configuration**, read at startup and defaulting
  to on — **not** a row in the Features table, which is why the earlier experiment toggled a same-named
  feature record and correctly observed no difference. Reference §D. Two things follow for a report: the
  deciding value is **not readable from a connected environment**, so report the shape you observed and say
  the setting behind it lives in the application configuration; and the pair still shares one verification —
  the `IsLocked` **and** `IsChanged` conjunction below.
- *Seen from the App Hub:* a platform or application update refused because a **base** product schema was
  modified directly is this same case applied to a product element. Two things belong in that answer:
  the customization has to move into an inherited or replacing schema in a custom package rather than an
  edit of the base one, and `ModifiedOn` equal to the installation time on every updated schema is
  expected behavior after a delivery, not data corruption.

**IC2 — The install reports success and the old version keeps running** `[Tier A]`
- *Signature:* no error anywhere — "we install from dev to pre, install is successful, we compiled and
  cleared the cache, and pre still runs the old page version". SQL views and pages stay on their previous
  version while the log claims the packages were saved.
- *Verify:* **start on the target's own state — that is where the whole diagnosis lives.** Read `SysSchema`
  by `Name` → `IsChanged`, `IsLocked`, `SysPackage.Name`, and **name the elements you find**. The condition
  is a **conjunction**: the target's copy is protected when `IsLocked` **and** `IsChanged` are both true.
  One flag alone is not protection — a schema with `IsChanged = true` and `IsLocked = false` will simply be
  overwritten by the delivery, so if that is what you read, this entry is not your incident.

  When the user names no element, this read is still the first move, not a blocked one: list the schemas
  on the environment carrying both flags and report them. That list is the shortlist of everything a
  delivery would refuse to overwrite here, and it is one call.

  **Do not go looking for a line in the log — there is none, and hunting for one is the trap.** The
  composer declines the element silently; it writes no per-element line when it refuses. A clean log is
  the expected reading here, not a reason to doubt the diagnosis or to look elsewhere. Rule the sibling
  out by **absence of stage markers and a zero child count** (see *Not what you're looking for?*), never
  by a line about skipping.
  Package-level state is corroboration: `SysPackage` by `Name` → `IsChanged`, `IsLocked`, `InstallType`,
  `Maintainer`. **Report those as the raw values you read.** Do not derive a lock verdict from `IsLocked`
  alone — its polarity is not established, and on the environment where this was checked the only
  `IsLocked = true` row was the package that is editable there, which is the opposite of what the word
  suggests.
  **To show *what* differs — not merely that something does — read the artefacts of both records.** The
  element's `Create`/`Update` entry from the delivery and the separate `Update` entry **with no parent**
  (the local edit) each carry their own `metadata.json` and source file, both reachable through
  `rca-cal-file-read`. Read live this way: the delivered page carried two buttons and the target's protected
  copy carried one — which is precisely the "old version" the user is looking at.
- *Recommendation:* manual, for a human — lock the package and its schemas on the target, reset
  `IsChanged`, reinstall. On cloud the lock goes through a support request. The standing rule is the real
  answer: development happens on the source environment, and target environments hold locked packages
  only; otherwise this recurs on every delivery.

**IC3 — `SVN package with the same UId exists`** `[Tier B]`
- *Signature:* `System.ApplicationException: Unable to install zip package while SVN package with the same
  UId exists`. The word *SVN* is usually what the requester asks about, not the failure itself.
- *Verify:* `SysPackage` filtered by the `UId` from the message (or by `Name`) → the target already holds
  that package. Report `InstallType`, `SysRepository`, `RepositoryRevisionNumber`, `IsLocked` and
  `Maintainer` as read. A non-null `SysRepository` with a revision number **would be** the repository-bound
  copy the message refers to — but that state has never been observed: on the environment used to verify
  this file all 466 packages had `SysRepository = null` **and the `SysRepository` lookup itself was empty**,
  so the mechanism is unconfirmed rather than merely unverified here. What *was* read there is a weaker
  signal worth reporting instead: a locally created package carries `InstallType: 0` and
  `Maintainer: "Customer"`, while everything that arrived through a delivery carries `InstallType: 1`. Say
  the package is present, quote what you read, and do not assert the mechanism beyond it.
  **The stage is not established either.** The likeliest row is the spine's "did it start at all?", but it
  has never been observed for this signature. Hand the requester a check they can run rather than a claim:
  if the configuration log holds **no** delivery record with an `install_*.txt` attachment for the attempt,
  the delivery never started and there is nothing to restore; if such a record does exist, the installation
  did start and the restore answer is a different one.
- *Recommendation:* a package cannot be installed onto the environment where it was created, or where it
  is open for development. Install it only where it is not under development there; to update the source
  environment, move changes through version control rather than installing the zip onto itself. **Answer
  the SVN question directly**, because it is the one asked: *SVN* is the platform's legacy name for the
  package lock mechanism — the configuration operation lookup still spells its operations `Lock package in
  SVN` and `Unlock package in SVN` — and its appearance here does not mean this environment uses SVN.

**IC4 — `Object with UId … already added to manager`** `[Tier A]`
- *Signature:* `Object with UId … already added to manager`, typically after elements were first created
  in `Custom` and later moved into a dedicated package on the source, while the target kept the originals.
- *Verify:* `SysSchema` filtered by the **`UId` from the message** → the row that answers it, with
  `SysPackage.Name` and `ManagerName`. A hit sitting in `Custom` while the delivery carries the same
  element in another package **is** the duplicate. Name the element and the package holding it; the UId in
  the message makes this exact rather than inferred.
- *Recommendation:* manual — delete the old copies of those elements from `Custom` on the target, then
  reinstall. Say that they should be backed up first: deleting a configuration element is not something
  this agent can undo, or verify the reversal of.

## 2. Name and UId collisions across packages

**IC5 — An element with the same name already exists in another package** `[Tier A]`
- *Signature:* one detector, two **real** wordings — match both.
  `Terrasoft.Common.InvalidNameException: "<Name>" configuration schema already exists in the following
  package(s): "…", "…"` (configuration-wide) and `Item with name "<Name>" already exists in this package.`
  (package-scoped, a different resource and a different check). The
  column-level sibling reads `Property conflict in '…': property '…' already exists. Rename one of the
  conflicting columns and republish affected schemas`. This surfaces most often during a **platform
  update**, when the product begins shipping a name a custom package already uses.

  > **Do not search for `Item with name "…" already exists in the following package(s): …`.** That hybrid
  > **exists nowhere in the product** — a literal search returns zero, which reads as "no collision here"
  > and is exactly how this entry gets ruled out wrongly. Both real strings, with their resource keys, are
  > in the reference's §G table.
  **A third wording is the one the requester usually quotes, and it names the consequence, not the cause:**
  the delivery record's own `Description` can read `finished with unexpected error: "Schema with unique
  identifier "…" not found"`. Read live on a failed install whose actual cause was this collision. Match
  it, then go to the installer log for the `InvalidNameException` — taking the `Description` at face value
  sends the investigation hunting a missing schema that is not missing.
- *Verify:* `SysSchema` filtered by `Name` → the same `Name` carrying a **different `UId`**, with
  `SysPackage.Name` naming the package that already holds it. That is the collision, confirmed on the
  target rather than read out of the exception. Observed live this way: `PaymentMethod`, `UId
  5da543c5-…`, package `PRMBase`, against an incoming `UId 8ef4104a-…`.
  **Read `ExtendParent` and `ParentId` on both rows in the same call. The pair is ruled out as a
  *duplicate* only when one row carries `ExtendParent` and its `ParentId` names the other — and ruled out
  as a duplicate is not ruled out of the investigation: a correctly linked pair stays in scope until the
  ordering check below has run.**
  A replacing ("Replaced object") schema *is supposed to* share its parent's name — the product's own
  duplicate detector exempts `ExtendParent` on both sides (reference §F), so a same-name pair where one row
  has `ExtendParent = 1` and a `ParentId` pointing at the other is inheritance working, not an incident.
  Reporting it as a duplicate, and recommending a rename or a delete, destroys a legitimate customization.

  **And say what it *is*, not only what it is not.** A replacing schema is stored as a **diff** against its
  parent — its metadata begins with `=` and is not JSON — so it is valid only when applied **after** the
  base. Nothing orders two packages except a declared dependency, so read `SysPackageDependency` for the
  package holding the replacing row and the one holding the base (dotted navigation, `SysPackage.Name` /
  `DependOnPackage.Name`) — and read the **direction**. What orders them is an edge **from the package
  holding the replacing row to the package holding the base**; **zero rows, or an edge pointing the other
  way, are the same root cause** — with no edge in the direction that matters the installer has no order to
  apply, and the diff can be handed to the slot that must hold full JSON. A reversed edge returns a row, so
  counting rows instead of reading their direction clears the hypothesis that is in fact the answer. That
  surfaces at **source generation** as `Unexpected character encountered while parsing value: =`, naming
  the **base** copy — the intact one. Report the missing dependency, not a broken schema.
  The activity log carries the same fact as `ConfActivityLog.IsReplacedSchema` when the rows are not to hand.
  When the collision looks like a moved element, the configuration log proves it: a `Move element` record
  whose `ElementUId` equals the **incoming** `UId` from the error turns "there is a duplicate" into "here
  is how it got here". Read live this way — the move, the package delete/create that followed it, and the
  failed delivery formed a single six-minute chain, all under one account.
- *Recommendation:* manual — rename the conflicting element in the custom package, or delete the duplicate
  after backing it up, then reinstall or retry the update. Renaming carries the cost in **IC8**: a
  delivered element has to be renamed consistently on every environment, not only on the one in front of
  you. If the environments have diverged structurally rather than clashing on one name, refreshing the
  target from a copy of the source is a human decision — present it with its cost, do not recommend it as
  a routine step.

  **If the pair turned out to be a replacing schema whose packages are not ordered — no dependency row at
  all, or one pointing from the base to the replacing package — the fix is a different one.** On the
  **source**, the package holding the replacing copy must depend on the package holding the base, and a
  wrongly directed edge is removed rather than added to. Raise the application versions, re-export and
  reinstall, then confirm the log carries no
  `Error occurred while generating schema source code` line. To unblock the target now, both copies are
  already in `SysSchema`, so *Generate source code* + *Compile all* clears it, with no uninstall. Do
  **not** repair or regenerate the metadata — nothing is corrupt.

**IC6 — Two packages with the same name in the configuration** `[Tier A]`
- *Signature:* the install itself reports success. The damage shows afterwards: package deletion resolves
  by **name**, not by `Id`, so removing "the extra one" removes the wrong package or fails outright.
- *Verify:* `SysPackage` filtered by `Name` → more than one row. Report **both `Id`s** with `InstallType`,
  `Maintainer` and `CreatedOn` — that list is the diagnosis. Before recommending anything, read
  `SysPackageDependency` for both (dotted navigation: `SysPackage.Name`, `DependOnPackage.Name`) so the
  answer can say what each duplicate actually carries.
- *Recommendation:* manual, and destructive — the extra package is removed **by its specific `Id`**, never
  by name, and only after its schema dependencies have been checked; on cloud, through support. Name the
  cost plainly: deleting the wrong row of a duplicate pair takes the working configuration with it. The
  rule that prevents it: a package name is unique and its `UId` is preserved on transfer, and composition
  changes are made on the source and delivered.
- *Seen from the App Hub:* "on QA we can't add the same packages to the app that we added on dev — they
  just aren't in the list" is answered from here. A package missing from the picker already belongs to an
  application, or is not editable on that environment; and adding an application's dependencies by hand on
  each environment is exactly what produces these duplicates. When an application is delivered from the
  source, its dependencies travel with it.

**IC7 — A web service is skipped because its name collides with an object** `[Tier A]`
- *Signature:* the delivered web service is simply absent on the target, and the log mentions a name
  conflict with an object — e.g. `web service '…' skipped/failed because of a name conflict with object
  '…'`. The user usually reports the absence, not the conflict.
- *Verify:* `SysSchema` filtered by `Name` **without narrowing to one manager** — the collision is *across*
  managers. A web service is `ManagerName = 'ServiceSchemaManager'`; an entity schema is
  `EntitySchemaManager`. Two rows with the same `Name` under different `ManagerName` is the conflict; name
  both, with their packages. `ServiceSchemaManager` was read live on a connected environment (it holds,
  among others, `CreatioMarketplaceApi` in `CrtBase`).
- *Recommendation:* manual — rename the web service or the conflicting object so the name is unique across
  the whole configuration, re-export from the source and reinstall. The generalizable part: names must be
  unique across managers, not only within one, so "there is no other object with this name in my section"
  is not a safe check.

## 3. Target database structure and data

**IC8 — An object was renamed on one environment only** `[Tier B]`
- *Signature:* `Cannot find the object "dbo…." because it does not exist or you do not have permissions`,
  `42704: constraint "…" for table "…" does not exist`, `42P01: relation "…" does not exist`. A telling
  detail: both the delivery **and** the rollback of the previous package version can
  fail, and the designer shows one name while the database carries another.
  **Say plainly that the permissions half of that first message is a red herring.** `or you do not have
  permissions` is the database engine's generic wording for "this name resolved to nothing"; a requester
  who reads it will otherwise go auditing access rights instead of names, and the message invites exactly
  that.
- *Verify:* `creatio_describe_object` on the object named in the error, plus `SysSchema` filtered by
  `Name` for **both** the old and the new name — establishing which of the two this environment knows.
  Tier B: that confirms the configuration side. Whether the database catalog still carries the other name
  is not readable from here, and it is frequently the half that decides the fix — say so.
- *Recommendation:* manual — align the name across all environments so the designer and the database
  agree. The preventive rule is stronger than the fix: objects that travel between environments in
  packages are not renamed. In the hard case the correction is a full rollback of the environment to its
  pre-install state plus a fix on the source by the package's developers — a human decision whose cost is
  the whole delivery.
- *The failed rollback is the same defect, not a second incident* — the previous package version expects a
  name this environment no longer has. That bears on the restore answer rather than on the diagnosis: the
  rollback has already demonstrated that it fails, so running another one blind, before the names are
  aligned, can leave a worse state than the one it was meant to repair. Carry that into the spine's restore
  gate, which still owns the question itself.

**IC9 — A column's type or length was narrowed and the existing data does not fit** `[Tier A on a table small enough to enumerate, otherwise Tier C]`
- *Signature:* `It is not possible to change type of column … of object … The length of existing string
  data exceeds the size of the column type and data can be truncated`. The activity-log record for the
  failing structure update carries none of that — verified live, its entire description was
  `Failed to update structure for following schemas: "…"`. The reason lives elsewhere; read it.
- *Verify:* two reads, answering two different questions. Keep them apart.
  **The refusal is confirmable and precise.** `SysSchema` filtered by the schema's `Name` → `LastError`
  holds the message verbatim, naming the object **and the column** — verified live, where the log record
  itself named neither.
  Quote that, not the log's generic wording. Do not expect `creatio_describe_object` to supply the
  column's size — it returns the type code alone (verified: `columnType: "27"`, no length).
  **Whether the blocking data is reachable depends on the table's size, so count before concluding.** One
  cheap read — the object with `returnRows: false` and the total requested — decides which answer you owe:
  - *small enough to enumerate:* read the column's values and **name the row that blocks the narrowing**,
    with its `Id` and the offending length. That is a confirmed diagnosis, and it is the better answer.
    Verified this way on a live environment: one row, a 250-character value.
  - *too large for that:* the longest value cannot be found through paged reads — there is no aggregate
    read, and rows cannot be ordered by the length of a string value. Say that the blocking rows were not
    identified from here, and do not imply otherwise.
  Either way, **the new declared length is not readable from the target at all** — it arrives inside the
  package. A full "it was N, it is becoming M" can only be stated from the source environment.
- *Recommendation:* manual — bring the data in line before delivering (trim or migrate the values that
  exceed the new size), or do not narrow the column's type or length at all, which is the durable answer.
  When you did name the blocking rows, say what the fix costs: trimming a value discards the excess, it
  does not convert it. After a failed installation, the restore question goes to the spine's gate.
- *The line not to cross, in both directions.* Matching this signature establishes that the platform
  blocked a narrowing; it does not by itself establish which rows blocked it, and phrasing an answer as
  though the data had been examined when it was not is wrong even when the recommendation happens to be
  right. The inverse error is just as real: refusing to look at a table of five rows, and calling the
  question unanswerable, throws away a diagnosis that was one read away.

**IC10 — A lookup column's data source was changed** `[Tier B, or A on a table small enough to enumerate]`
- *Signature:* `Error when saving schema database structure: … The ALTER TABLE statement conflicted with
  the FOREIGN KEY (SAME TABLE) constraint "FK…"`, after the column was repointed from one object to
  another on the source (e.g. it referenced `Contact` and now references `Account`).
- *Verify:* `creatio_describe_object` on the object → the `refersToObjectCode` of that column, i.e. what
  it points at **now** on this environment. A set difference is not expressible through these reads, so
  count the rows first, exactly as in **IC9**: on a table small enough to enumerate, read the column and
  **name the values that have no counterpart** in the newly referenced object; on a large one the mismatch
  is named, not counted, and say that it is the table's size that put those rows out of reach.
- *Recommendation:* manual — clear or migrate the values that have no match in the new referenced object,
  then reinstall. Hand the statement over for a human to review and run, e.g.
  `UPDATE <table> SET <column> = NULL WHERE <column> NOT IN (SELECT Id FROM <new referenced table>)`, and
  say what it costs: those links are discarded, not converted. **And say that the fix does not travel:**
  repointing a lookup migrates no data anywhere, so the same cleanup falls due on every environment the
  package reaches, production included. The durable alternative is often cheaper than the cleanup — leave
  the existing column alone, add a new one pointing at the new object, and retire the old one.

**IC11 — A foreign key on business data blocks an `ALTER TABLE`** `[Tier A when the statement names an Id, otherwise Tier C]`
- *Signature:* `The ALTER TABLE statement conflicted with the FOREIGN KEY constraint` on business tables
  (for example `ContactCommunication` → `Contact`), while the package itself is sound and the
  requester says they never touched that column. The target's data integrity was already broken before
  this delivery.
- *Verify:* when the failing statement names an `Id`, read that record on the object behind the constraint
  — an **empty result confirms the absence**, and the absence is the evidence, not the constraint name
  (see `rca-env-readonly-query`). That is Tier A, and it names the missing record. When no Id appears in the
  statement, the orphan set needs a left-join scan these reads cannot express, so count the rows first as
  in **IC9**. Business tables in this case (for example `ContactCommunication` → `Contact`)
  are normally far past what a paged read can enumerate, so Tier C stands here in practice — but say that
  it is the **table's size** that puts the rows out of reach, not the shape of the question, so nobody
  carries this refusal over to a table of five rows. Report that the platform is reporting an integrity
  break, and that locating the rows needs a database-side query a human runs.
- *Recommendation:* manual — find the orphaned rows, clean them up or restore the missing parent records,
  then retry the delivery. Two rows can need opposite fixes at opposite costs: a parent deleted by mistake
  is better **restored**, because that keeps the child records meaningful, while a value that was never a
  real reference is **deleted** — so do not clean up in bulk without reading the list first.
- *Open by answering "but we never touched that column".* It is the requester's own sentence in this case,
  it is correct, and it does not contradict the diagnosis: the data was already broken, and the
  installation is the **detector, not the culprit**. Leading with that is what makes the rest land.
- *Boundary:* a foreign key raised on a record **delivered with the package** is the bindings catalog's
  case, not this one. This entry is the target's own business data, which the delivery merely walked into.

## 4. Deleting schemas that are still referenced

**Ask first why a *delivery* is deleting anything at all.** It is not a separate operation the requester
performed — the installer marks for deletion every element that exists on the target and is **absent from the
incoming package**, provided the target's copy is not protected (reference §A–§C). So a deletion failure
inside an installation is usually a symptom of a **stale or wrong archive**, and the answer that fixes it is
re-exporting from the source, not clearing whatever is blocking the delete. Two blockers report differently
and both belong to this section: `SysPackageSchemaData` bindings (IC12 below) and an inherited or replacing
schema in another package, which the installer names before composing as `Unable to delete item "…" of
package "…". It has dependent item "…" in package "…"`, alongside `Cannot delete the package … because the
package … depends on it.` — one check, two sentences — and which the database then rejects on the
`SysSchema.ParentId` foreign key as `Error occured while performing operation on "…" item, UId = …` plus a
`REFERENCE constraint` violation. That dependent element is behaving correctly; see IC5's verification before
proposing anything be renamed or removed.

**IC12 — A schema cannot be deleted because bindings still reference it** `[Tier A]`
- *Signature:* `23503: update or delete on table "SysSchema" violates foreign key constraint "FK…" on
  table "SysPackageSchemaData"` — the delivery is trying to remove or replace an old schema, usually a
  process.
- *Verify:* `SysPackageSchemaData` filtered by `SysSchema` (the schema being removed) → **list the
  bindings that hold it**, with `Name`, `SysPackage.Name`, `IsChanged` and `LastError`. Naming them is the
  diagnosis; the constraint name is not. One caveat to state rather than imply: an active process instance
  also holds a schema, and that is not part of this read — so the binding list is what blocks it *that you
  could see*, not necessarily everything.
- *Recommendation:* manual — review the listed bindings and either update them for the new structure or
  delete the obsolete ones; for a process, complete or cancel its running instances first. Then reinstall.

**IC13 — The delivered schema behaves like an older version** `[Tier B]`
- *Signature:* no error at all. After the transfer the element's logic matches an earlier version even
  though the package carries the new code — stale metadata won over the delivered source.
- *Verify:* read the element's artefacts from its `Create` / `Update` activity-log entry through
  `rca-cal-file-read` — `metadata.json`, `readable.metadata.json` and the `.cs` / `.js` file — and compare
  what the target holds against what the requester says was delivered. Tier B: this shows what is on the
  target. Which version is canonical needs the source environment, which one connected environment cannot
  show; say which side you read.
- *Recommendation:* manual — regenerate source code on the target first, since that clears the common
  case. If the element still behaves as the old version, re-save or publish it on the source, re-export
  and reinstall the package. If neither settles it, the metadata on the source is itself suspect, and that
  is a question for the package's developers.

## 5. Environments that have drifted apart

**IC14 — Changes were made directly on the target and the environments no longer match** `[Tier C]`
- *Signature:* deliveries fail on objects or `UId`s "nobody remembers creating"; errors reference `UId`s
  that exist on neither the source nor the pre-change backup; business rules disappear and pages come back
  replaced. The requester's own question is usually "could someone have changed things on prod directly?"
- *Verify:* **half of this is not readable from here, and that has to be said rather than implied.**
  Confirmable: take each `UId` or name from the error and read `SysSchema` on this environment — report
  which of them exist here, in which packages, with `CreatedOn`, `CreatedBy`, `ModifiedOn` and
  `ModifiedBy` where those carry values. Not confirmable: any comparison against the other environment.
  One connected environment cannot diff a source against a target. So confirm this side, state exactly
  which side you read, ask the human for the other (the same reads run there, or an export), and lower
  confidence accordingly. **Never report a difference that was not observed** — "these elements exist here
  and I could not check the source" is a correct answer; "the two environments differ in these elements"
  is not, unless both were read.
- *Recommendation:* manual, and a decision rather than a recipe — once the difference is actually known,
  the environments are aligned either by removing what was changed directly on the target, or by treating
  the target as canonical and carrying those changes back to the source. Which side is canonical is the
  customer's call and the two paths cost very differently, so present both instead of picking one. The
  rule that prevents recurrence: all changes on the source, tested there, delivered by packages; a target
  environment is never customized directly.
- *Answer the question actually asked.* "Did someone change prod directly?" is partly answerable without
  the other environment. The **structural** test is the stronger one and comes first: an application that
  arrived by installation has a delivery record as its **parent**, while one created here has **no parent
  record at all**, and its package's install type and maintainer say the same thing independently. Count
  how many of each the environment holds — that number is the answer to "is this routine here or an
  exception". Authorship (`CreatedBy`, `ModifiedBy`, `ModifiedOn`) is corroboration, and weaker than it
  looks: on most environments every record carries the same administrative account, so it names a
  **login, not a person** — if that login is shared, the log does not identify who was at the keyboard.
  If both readings are empty or inconclusive, say so, which is different from "no".
- *Rule the innocent explanation out before you offer the accusatory one.* "Objects nobody remembers
  creating" has a second cause that involves nobody touching the target at all: **an application install
  pulls in its dependency packages**, and the elements they carry are genuinely unfamiliar to a team that
  only ever reviewed its own package. Observed live — installing one user package brought two further
  product packages with it. The two are told apart by the same read as above: elements that arrived with a
  delivery have one as their parent. Check that first. It is the cheaper answer, it is more often the
  right one, and the cost of getting the order wrong is an accusation that someone edited production.

## Boundaries (this file's coverage)

**Covered:** the 14 cases above — locking and local edits (`IC1`–`IC4`), name/UId collisions
(`IC5`–`IC7`), target DB structure and data (`IC8`–`IC11`), deleting referenced schemas (`IC12`–`IC13`),
environment drift (`IC14`). Two App Hub symptom variants are answered from here — a blocked update caused
by a modified base schema from `IC1`, and packages invisible in the add-to-application picker from `IC6` —
and the App Hub domain cross-references this file rather than restating them.

**Entities behind these entries were verified live via `creatio_describe_object` / read on a connected
environment**, not assumed: `SysSchema`, `SysPackage`, `SysPackageSchemaData`,
`SysPackageDependency`, `ConfOperation`, `ConfActivityLog`. Two findings from that pass are written into
the entries above rather than left as assumptions: `ManagerName = 'ServiceSchemaManager'` identifies a web
service (`IC7`), and **`SysPackage.IsLocked`'s polarity is not established** — of 466 packages the only
`IsLocked = true` row was the one editable on that environment, i.e. the inverse of what "locked" means in
the support material — so `IC2` and `IC3` report that flag as a raw value and never diagnose lock state
from it alone. That open question belongs to `rca-env-readonly-query`'s package reads, not to this file.

**A second pass established the delivery's own decision rules** in
`installation-catalog-conflicts-reference.md`, and replayed them against a failed delivery on a
connected environment. Three findings change entries here rather than sitting in the reference: the
protection rule is the `IsLocked` **and** `IsChanged` conjunction, and it is **overridden** by the
`OverwriteTargetStorageChanges` feature — read live as enabled on a stand where a fully protected element was
deleted anyway; `IC1`/`IC2` split on the application setting `Feature-AllowPackageElementsMove`, which is not
readable from a connected environment; and an element the archive does not carry is marked for **deletion**,
not skipped — which is why every flag-reset recommendation in this file is now gated on establishing that the
package carries the element. The reference tags each statement `[observed]` or `[unverified here]`, and an
`[unverified here]` statement is never reported as a finding on that file's authority.

**§0 is the procedural consequence of all three, and it outranks the entries.** Because one message in this
family spans several situations, an entry below is reached *through* the inventory — delivered files, then
every schema named, then the tables those elements live in — and not from the log text. The activity-log tree
is the index into that inventory, never the diagnosis. An answer that cites a signature without naming the
elements and the state it read has not been verified, whichever entry it quotes.

**Tier B and C entries are intentionally partial.** They recognize the signature and give the known fix,
and they say plainly where the evidence is out of reach — the target's data volumes **above the size a
paged read can enumerate** (`IC9`, `IC10`, `IC11` without an Id, each of which reaches a confirmed answer
on a table small enough to count first), the database catalog (`IC8`), or the other environment (`IC13`,
`IC14`). That is the design, not a gap: an answer that reads as confirmed when it was not is worse than
one that names its own limit — and so is a refusal to read a table that could have been read.

**Not here:**
- A delivery that applied nothing because the package's content did not differ from the target's, missing
  packages, parent schemas and install order — `installation-catalog-dependencies.md`.
- Foreign keys and duplicates on records **delivered with the package**, and culture/localized-resource
  failures — `installation-catalog-data-bindings.md` and
  `installation-catalog-localization.md`.
- Whether to restore or roll back — the spine's restore gate (§6), which applies to every failed delivery
  and is deliberately not repeated per entry.
- The validation, backup and static-content stages, and the wider infrastructure family (disk,
  permissions, timeouts, web farm, cloud delivery preparation) — a separate catalog, not yet built.
- Not covered at all:
  package and application **uninstallation / deactivation**, clio's own failures (`push-pkg`, `restore`,
  `compile`), hotfix mode and file-system development, Oracle specifics, Marketplace-app specifics, and
  CI/CD delivery automation. Recognize that these are not covered rather than stretching an entry here to
  reach them.
- Left out on purpose: the `IU_Name_Manager_Package` duplicate-key failure
  (fixed in 8.2.1), legacy 7.x migration problems, and one-off SVN-mode failures — SVN mode is
  practically unused on 8.x, which is why `IC3` treats the word as vocabulary rather than as a
  configuration to investigate.

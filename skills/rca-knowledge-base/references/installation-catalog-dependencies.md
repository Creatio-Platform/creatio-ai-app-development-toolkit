# Domain: Installation — dependencies & install order catalog (reference)

Open this file **only from `installation.md`**, after the spine has established the failing
stage (§3) and the outcome (§4) — never as a way to look for something recognizable before that
partition is done. Recognizing an entry below is not evidence that it is the cause; it only tells you
what an already-established signature means and how to fix it.

This is the family where **something the delivery needed was not in the box**: the package references
another package, a parent schema, a database object, a subprocess, a dll or a whole product bundle that
the target environment does not have — or the installer decided the target's copy is not older and left
it alone. The error text names a constraint, a null, or nothing at all; **it never names the missing
thing.** Naming it is this file's job.

11 real-world cases. Every entry is tagged by **evidence tier**:

- **`[Tier A]`** — fully diagnosable from a platform read; commit to the diagnosis.
- **`[Tier B]`** — recognized by signature with partial on-platform corroboration; say plainly what is
  confirmed and what is not. Also where a case needs a fact a platform read cannot give (a second
  environment, a raw DB table with no object behind it).
- **`[Tier C]`** — the evidence lives off-platform (licensing, the file system, the source environment);
  recognize the signature, give the known fix, and say clearly it cannot be verified from here.

No entry here requires a write. Every fix is a manual step for a human.

> **The signatures below are the product's own resource strings, word for word** — a paraphrase (reversed
> word order, different vocabulary) never matches a literal search, and fails silently with no error at
> all, so match **ID1**, **ID10** and **ID11** exactly as written. Being a real product string is
> not the same as being the string this incident produces: **ID1**'s was verified in the source and then
> **not** observed on any route reachable here, which its entry says outright. Checked-against-source and
> observed-live are two different claims — keep them apart. What could not be checked this way is the text
> PostgreSQL, MSSQL and the .NET runtime write themselves (ID4, ID7's engine half, ID9) — those are matched
> as engine/runtime text. **ID5 is not on that list:** reproduced live, it raises the product's own
> `ItemNotFoundException` rather than any database message, and a database wording for it is unreachable
> on this build. Where a message exists in two channel variants, web
> installer and WorkspaceConsole, both are given.

**Never name an internal case id, a tier, or this file to the user** — see `rca-diagnosis-report`'s
scrubbing rules, which apply from the moment you match an entry.

---

## 1. Which stages and signatures route here

From the spine's stage table:

- **Load & compose** (`Loading packages from archive`, `Package "X" loaded` / `Inactive package "X"
  loaded`, `Preparing packages for installation`, `Composing packages`) — this file owns the stage. A
  loaded package that has no `SysPackage` row is not a missing dependency until the spine's §2.5 has ruled
  out an inactive package of the environment.
- **SQL scripts** — shared with the conflicts catalog. The spine's discriminator: the object the script
  needs **was supposed to arrive with another package** → here. The object exists but the target's
  structure or data does not match what the script assumes → `installation-catalog-conflicts.md`.
- **Source generation** — shared. Generation failed because **a schema from another package is missing**
  → here. Missing data a column default reads → `installation-catalog-data-bindings.md`. Missing
  localized resource → `installation-catalog-localization.md`.
- **Schema install** — shared with the conflicts catalog, and the discriminator is one word. The element
  the installer names is **present but blocked** (locally modified, locked, or clashing by name/`UId`)
  → `installation-catalog-conflicts.md`. Something the incoming schema **needs is absent** — most often
  its parent schema, in a package that did not travel → here (**ID4**, **ID5**). *Blocked* is a conflict;
  *missing* is a dependency.

From the spine's outcome table:

- **"Completed, but the delivered changes were not applied"** — the spine's §4 names **four** causes for
  this one symptom, and only one is this file's: **zero child rows on a delivery reporting success**, with
  the log stopping at `Composing packages` → **ID10** here. The other three route away —
  `IsChanged`/`IsLocked` on the element → the conflicts catalog; `IsForceUpdate = false` on a binding
  column → the data-bindings catalog; resources missing for a culture → the localization catalog. **Read
  the evidence before choosing**: these are siblings with the same symptom and fixes that point at
  different environments (§6 below).

**Signatures that are NOT this file's, named here so they are turned away rather than half-answered:**

- `Unable to install Schema/SchemaData "…" into package "…", because the element has been modified
  locally. Resolve the conflict and mark the element as unchanged.` → `installation-catalog-conflicts.md`.
  The installer **named** the blocked element and said why; nothing in this file explains it, and its fix
  (reset the flags on the target) is the opposite of anything recommended here.
- `"…" configuration schema already exists in the following package(s): "…", "…"` (also worded
  `Item with name "…" already exists in the following package(s)`) → `installation-catalog-conflicts.md`.
  A name/UId clash between packages is not a missing dependency. Do not confuse it with **ID6**, whose
  message is `There are more then one schema with name '…' **in package** '…'` — same *word*
  "exists/more than one", different mechanism and different owner.

**Four of these cases have no failing stage, and they still belong here.** The spine's §5 routes by the
**pasted signature** when §3 yields no stage and §4 no outcome — which is the normal situation for:

- **A refusal before the delivery starts** — App Hub lists missing dependency packages under
  `Can't retrieve required dependencies` and will not continue, or the app needs a product bundle the site
  does not have (**ID2**, **ID3**). Nothing was installed: there is no log, no record, and the spine's
  restore gate answers itself — nothing to restore, which is the most reassuring thing you can tell the
  user and the easiest to forget to say. Its absence is the expected state, not a gap in the evidence.
  > **Search for the record once anyway, because the same wording arrives with one on the other route.**
  > A command-line push produces this exact refusal *and* a record plus an installer log — that is
  > **ID1**, and skipping the search on the strength of the wording alone would throw away the only
  > evidence that a delivery ran at all. One search settles which entry you are in; what you must not do
  > is keep hunting after it comes back empty, or read that emptiness as the wrong environment.
- **A runtime failure after a delivery that reported success** — a process or the application itself
  fails because the transfer was incomplete (**ID8**, **ID9**). No stage failed; the delivery was simply
  missing a piece, and the gap only showed when something ran.

**Say which of the spine's three routes you took** — established stage, §4 outcome evidence, or pasted
signature — because it changes what the report may claim. A signature-routed answer describes a
mechanism you recognized; it does not assert a stage you did not establish.

## 2. Package-level dependencies — the target does not have the package

**ID1 — A dependency package is missing on the target, and the delivery was recorded** `[Tier A]`
- *Signature:* a delivery that **started and failed on a missing dependency, leaving a record and a log**.
  Users report it as "it says another package is missing, although everything works on dev".
  **Route by the presence of the record, not by the wording** — the wording is the same as ID2's:

  | | ID1 | ID2 |
  |---|---|---|
  | `ConfActivityLog` record | **exists**, `Error`, zero child rows, under a second | **none** |
  | installer log attachment | **exists** | **none** |
  | the refusal's wording | *"…dependencies are missing and cannot be retrieved automatically…"* | the same |

  Measured shape of the record (a command-line delivery of a package archive whose one dependency was
  absent):
  - `Description` opens `Installation of application "<archive file name>" with packages ""
    finished with unexpected error:` — **the empty `packages ""` is part of the signature**: nothing was
    composed. It then carries the refusal verbatim, ending
    `type: Package, name: <missing package>, required Version: -, installed Version: -`.
  - `Element` = the delivered package's name, `ApplicationCode` = the application's code,
    `PackageName` **empty**, `DurationInSeconds` under 1, **zero child rows**.
  - the installer log stops at
    `The request to the Application Installer Service failed due to: Dependency analysis failed:
    BadRequest Bad Request` / `At least one of 'file', 'appId', or 'appData' must be provided.`,
    followed by empty `ResponseException:` and `ResponseExceptionStackTrace:` labels.

  > **The verdict is in the record's `Description`, not in the installer log.** On this failure the log
  > ends *before* the decisive message — it never names the missing package. A run that reads only the log
  > and reports "the log does not say which package" has missed the evidence; a run that reads only the
  > `Description` has skipped the proof that no stage ran. Read both, and say which one each fact came
  > from. The empty `ResponseException:` / `ResponseExceptionStackTrace:` labels are **the writer's normal
  > ending here, not a truncated file** — measured: the attachment's `SysFile.Size` matches the text in
  > full.
  >
  > **The `BadRequest` / `At least one of 'file', 'appId', or 'appData' must be provided` line is not the
  > root cause.** It is the dependency-analysis call to the installer service being rejected, which is why
  > nothing could be *auto-retrieved*; the delivery would have been refused anyway, because a custom
  > package that exists only on the source is not in the application catalog. Report it as an observation
  > about the route, and do not claim it produced the refusal unless you can show that it did.

  > **`Dependent package "<name>" not found` (and `… not found for source package "<name>"`) is a real
  > product string but was NOT observed on any route available here.** It belongs to a later
  > dependency-**saving** step, which the dependency pre-flight normally prevents a delivery from
  > reaching. Measured: a command-line delivery runs the **same** dependency validation as App Hub and
  > produced ID2's wording, not this one — so the earlier claim that the package-level routes "skip
  > the pre-flight" is **false**. If a user does paste this string, treat it as ID1 with a stage further
  > in, and record it: it is the one shape of this
  > entry nobody here has seen.
- *Verify:* read `SysPackage` filtered by `Name eq '<the package from the message>'` — an **empty result
  confirms the absence**, and that is the evidence, not the message text. Then read
  `SysPackageDependency` (dotted navigation through the bare lookups — `SysPackage.Name`,
  `DependOnPackage.Name`) to state the dependency graph the target actually holds, and
  `SysInstalledApp` when the package shipped as part of an application. **Name the package that is
  absent**; "check your dependencies" is not a diagnosis.
- *Recommendation:* install the missing dependency package on the target first, then reinstall the main
  package. If the dependency links were lost because a previous installation's errors were ignored,
  re-save the dependencies on the source and re-export. Both are manual steps.

**ID2 — App Hub refuses the delivery: it cannot auto-resolve the missing dependencies** `[Tier B]`
- *Signature:* App Hub **refuses before installing anything**, under the heading
  **`Can't retrieve required dependencies`**, with a table of what is missing —
  `Name` / `Type` / `Required version` / `Installed version` / `Licensing`, and an absent package shows
  `-` in the installed column. The body is one of four wordings, by what was uploaded and how many:
  - `The application "<name>" cannot be installed in this environment. Some required dependencies are
    missing and cannot be retrieved automatically from the application catalog. To install the
    application, manually install the required applications or packages listed below and try again.`
  - `The package "<name>" cannot be installed in this environment. …manually install the required
    packages listed below…`
  - the plural variants, `Some applications in the installation file cannot be installed…` and
    `Some packages in the installation file cannot be installed…`

  **There is no installer log and no `ConfActivityLog` record** — the refusal happens before the site is
  touched, so the spine's §2 protocol has nothing to find. Route by the pasted signature. Frequently
  accompanied by "the original site is already gone".
  > **The missing record is this entry's signature — do not read it as "I am connected to the wrong
  > environment".** The spine warns, correctly and at length, that support is often pointed at a
  > stand that is not the one that failed, and that an empty delivery search is the sign of it.
  > **Here the same emptiness means the opposite**, and the two readings are indistinguishable from
  > the record search alone. Measured on a blind run of exactly this incident: the agent searched
  > for a delivery, found only unrelated installs, and concluded *"it is not your test stand"* —
  > while it was connected to the very environment that had refused the install minutes earlier.
  > What you may say is that you **cannot tell which environment this is from a record that was
  > never written**; what you may not do is assert the wrong-stand reading as a fact. Resolve it by
  > asking for the **package name from the dialog** and reading `SysPackage` for it — that is the
  > one read that tells the two apart. **What separates this from ID1 is the missing record, not the
  > wording.** The pre-flight is *not* an App Hub feature: a command-line delivery runs the same
  > validation and produces this exact wording — measured, not assumed. The difference is where the
  > delivery is rejected relative to activity logging. App Hub refuses in the UI, before the
  > installer service is called, so **nothing is written**. A command-line push reaches the service,
  > which logs the activity first and *then* refuses, so it leaves a record and an installer log —
  > that is **ID1**. Same missing dependency, same message, two entries, and the record is the
  > discriminator.
- *Verify:* read `SysPackage` filtered by the names the dialog listed and report **which are genuinely
  absent here** — that part is fully confirmable, and an empty result per name is the evidence. Then read
  `SysPackageDependency` for what the target does hold, so the user sees the graph rather than a bare
  refusal. What is **not** confirmable from this environment: whether the custom packages still exist
  anywhere (a backup, another environment), and whether the source instance is really gone. Say which
  half you established.
  > The dialog already prints `Installed version: -` for what is absent, so quoting the dialog is not a
  > substitute for the read — the read is what makes it a fact about *this* environment. Say which of the
  > two you are citing.
- *Recommendation:* base `Crt*`/product packages come with the matching product bundle and version —
  align the bundle and version with the source environment. Custom packages must be exported from the
  source or restored from a backup. If the source is gone: restore the custom packages from a backup,
  install into an environment that already has them, inspect the archive with clio without installing,
  or rework the package to drop the references (development effort). All of these are decisions for a
  human; state the options and their cost rather than picking one.

**ID3 — The app requires a product bundle the site does not have** `[Tier C]`
- *Signature:* a Marketplace or partner app fails with errors about missing schemas/objects, or the
  download is blocked for lack of dependencies, on a site whose product does not include what the app
  needs (e.g. the app needs Marketing or Financial Services CRM on a studio/sales site). **This is also
  the answer for the App Hub-side report of the same problem** — an app that "won't install on our Sales
  site".
- *Verify:* you can list which of the named schemas are absent from this environment. **What the site is
  licensed for is not readable from here** — say so plainly instead of inferring the bundle from the
  schemas you can see.
- *Recommendation:* check the app's product requirements on its Marketplace page; the site needs a
  licence/bundle that includes the required product. Options: acquire the bundle, extend the site's
  bundle through a separate support request, or use a matching demo environment. Do **not** recommend
  forcing the installation on an unsupported bundle. This is a licensing question — route it, do not
  present it as a configuration defect.

## 3. Schema-level dependencies — the schema's parent or sibling did not travel

**ID4 — A schema deleted on the source is still referenced on the target** `[Tier A]`
- *Signature:* `23503: update or delete on table "SysSchema" violates foreign key constraint
  "FK…" on table "SysSchema"` — a self-referencing foreign key on `SysSchema`, raised while the delivery
  applies schemas. Typically after a page or object was deleted on dev.

  **Measured shape**, reproduced live on PostgreSQL:
  - The error marker is the **generic, one-`r`** form:
    `Error occured while performing operation on "<schema>" item, UId = <uid>`, and the stack runs
    `PackageDBStorage.SaveDeletedPackageSchemas` → `DeletePackageSchema` →
    `DeletePackageSchemaConnections`. That call chain is what tells you a **deletion** was attempted, and
    it is the only place the word appears — no marker announces one.
  - **The log names the victim, not the culprit.** The item in the error line is the schema being
    **deleted**; the schema whose reference blocks it is never named, because PostgreSQL's `DETAIL` line
    is redacted (`Detail redacted as it may contain sensitive data`). Quoting the log therefore gets the
    diagnosis exactly backwards. The blocker is only findable by reading the environment.
  - **The failure is not fatal.** After the error the run continued through the package commit and the
    whole configuration build, ending `Configuration build finished` and then the banner
    `When application installed, an error(s) occured`. Record `Status = Error`, and the `Description` is
    the generic *"…did not complete successfully. For more details, check the log file in the
    attachments."* — no diagnosis in it, unlike **ID1**.
  - **The deleted schema survives.** It was still in `SysSchema` afterwards, unprotected (`IsChanged`
    and `IsLocked` both false) — the delete was attempted and rejected, not skipped.
  - **The record carried exactly one child row, and it named the blocking schema and its package** —
    a `Generation of runtime metadata of entity schema` operation on that schema, status `Success`.
    It is there because the blocker is a schema **descending from the one being
    deleted**, so touching the parent regenerates it; that is why it points at the culprit, and why the
    pointer is worth reading first. It is still one observation, not a guarantee — confirm with the
    `SysSchema` read below before naming anything.
  - **Two attachments, not one.** `install_*.txt` **and** a `backup_*.zip` holding the previous version of
    the replaced package. Read `SysFile` for **all** rows on the record: stopping at the first one hides
    the rollback artefact and weakens the restore answer. This matches the spine's table exactly — the
    archive appears because this delivery *replaced* an existing package, whereas **ID1** (refused) and
    **ID7** (fresh install) carry the log alone.
- *Verify:* read `SysSchema` filtered by `Parent.Name eq '<the schema being deleted>'` (bare lookup,
  dotted navigation) to list the schemas on the target that **still point at it** — those are what block
  the delete, and naming them is the diagnosis. **Project each one's `SysPackage` as well**: the whole
  point is that the referencing schema lives in a package the delivery does not carry, and the user needs
  that package's name to act. Verified live — the read returns the blocker with its package, which is why
  this entry is Tier A. **The constraint name in the message is database-generated; treat it as a shape to
  recognize, not a value to match on.** What you cannot do from one connected environment is confirm what
  the source looks like — this needs the human for the other side; lower the confidence accordingly.
- *Recommendation:* align the dependency chain: deliver the updated child schemas first, so they no
  longer reference the old parent, and only then delete the parent. Alternatively include the new parent
  schema in the same delivery, ordered before the delete. State the order explicitly — that order **is**
  the fix.

**ID5 — The package contains a schema whose parent is missing on the target** `[Tier A]`
- *Signature:* `Parent schema named "<name>" and unique identifier "<uid>" not found` — a
  `Terrasoft.Common.ItemNotFoundException` raised while the delivery saves the schema's parent link.
  **The message names the missing parent and its `UId` outright** — reproduced live.

  > **Read it from the record's `Description`, because the installer log does not contain it.** Measured:
  > the attachment is barely a kilobyte, stops at `Package "<name>" saved`, and holds **no**
  > `ItemNotFoundException`, **no** `Parent schema named` and **not even** an `Error occured` marker. The
  > exception with its stack trace is
  > what the installer **UI or console** prints at the moment of failure and is persisted nowhere you can
  > reach. So: the `Description` carries the message without the stack, the log carries neither, and a
  > user's paste may carry both. **A run that reads only the log finds an installation that appears to
  > have simply stopped** — this is the spine's §2.5 "the log stops, the cause is only in the
  > `Description`" shape, and this entry is its third measured instance.

  > **"The log does not say what's wrong" is false on this build, and so is the foreign-key wording
  > sometimes quoted for this case.** The delivery resolves the parent **by `UId` before it writes
  > anything**, and fails there, so the database constraint never comes into play on this path: what you
  > get is a not-found on the parent, not an FK violation. The read that settles it: `SysSchema`
  > filtered by the `UId` the message names returns **no row** on the target. A reported
  > `The UPDATE statement conflicted with the FOREIGN KEY SAME TABLE constraint "FK…" … table
  > "dbo.SysSchema", column 'Id'` is kept below as a **second shape, never observed here** — it would
  > need a build without that pre-check. Match it if a user pastes it; do not expect it.

  **Measured shape**, reproduced live on PostgreSQL: `Status = Error`, a couple of seconds, an installer
  log of barely a kilobyte and **no `backup_*.zip`** — there was nothing to replace. **Two child rows**,
  `Create` / `Object` on the delivered schema and `Create` / `Package` on the package, **both carrying
  no status at all**: on this
  outcome the status lives on the parent row only, so an empty child status is not a gap.

  The outcome is **failed and rolled back** — the `Description` opens with the spine's banner, *"No
  configuration changes from this operation were saved. The configuration elements listed in its child
  records are not present in the system."* Confirmed by reading: the package, both schemas and the
  `SysInstalledApp` row are all absent afterwards, and `VwCompilationErrors` is empty. The log still
  carries `Schema "<child>" saved in package "<package>"` — one more reminder that a `saved` line proves
  nothing about persistence.

  > **`ItemNotFoundException` is also ID8's exception type, and the two are not the same incident.**
  > Here it is thrown **during an install**, names a *parent schema*, and the delivery fails. In **ID8**
  > it is thrown **at runtime**, after a delivery that succeeded, and names a *process*. Route on when it
  > was thrown and what it names, never on the type.
- *Verify:* **the message already names the parent and its `UId`, so this is a confirmation, not a
  hunt.** Read `SysSchema` filtered by that `UId` — an empty result confirms the absence — and then read
  `SysPackage` for the package that should own it, to say whether the package is missing too. **Name the
  parent schema and the package it belongs to.**
  > **Fall back to the hunt only when the message is missing** — an older build, or a pasted excerpt that
  > cuts the exception. Then read `SysSchema` for the schemas the package is installing, project `Parent`
  > (bare lookup), `SysPackage` and `UId`, and find the one whose `Parent` cannot be resolved here.
  > **Identify schemas by `UId` here, not by `Name`.** A replacing schema carries the same `Name` as the
  > schema it replaces — verified live, five rows named `Contact` across five packages — so a
  > name-based lookup in an inheritance chain is ambiguous and can point at the wrong row. The `UId` is
  > what the installer works with, and it is what the FK violation is about.
  > **The extended log does carry `ParentSchemaName` and `ParentSchemaUId` — this entry said otherwise
  > and was wrong.** The delivery writes them to `PackagesLog` when it cannot resolve a parent,
  > alongside `SchemaName`, `SchemaUId`, `SchemaId`, `ParentSchemaId` and `SchemaManager`, and it has a
  > dedicated extended-log entry for exactly this condition.
  > That log is **not** among the reads this agent can make — say it
  > exists and is worth a human's look, rather than promising to fetch it.
- *Recommendation:* transfer the package containing the parent schema **together with** the main package
  and reinstall — or install it first, in that order. Say which package goes first. Because the delivery
  rolled back, there is nothing to undo first: the retry starts from a clean target.

**ID6 — A schema the package references lives in another package that did not travel** `[Tier A]`
- *Signature:* the source-generation stage fails. Two shapes:
  `There are more then one schema with name '<name>' and manager name '<manager>'`, or
  `There are more then one schema with name '<name>' in package '<package>'` — **the misspelling
  "more then" is the product's own, match it as written**. Alternatively a null-reference during
  generation (`Value cannot be null`) when a business-process element has no value.
  > A WorkspaceConsole-driven delivery reports the surrounding failure as
  > `Error when generating schema source code: <name> in package <package>. UId <uid>: <error>` — a
  > different wording from the same condition. Match either channel, or say which one you saw.
  A third shape names a **lookup column**:
  `Error occurred while generating schema source code "<object>" in package "<package>". UId <uid>: No
  lookup reference specified for column "<column>".` — with the same text in the object's
  `SysSchema.LastError`. The object the column points at is not on this environment. `[observed]` On that
  delivery the error **stopped the delivery**: the log ends on it right after `Updating tables structure in
  database`, with no data install, no application registration and no compilation after it (no
  `Compilation` child, no `SysInstalledApp` row for the application) — while the package and its schemas
  were already saved.
- *Verify:* read `SysSchema` filtered by `Name eq '<name>'`, projecting `Parent`, `SysPackage`,
  `ManagerName` and `UId`.
  > **Several rows with the same `Name` is the NORMAL case, not the finding.** A replacing schema carries
  > the **same `Name` as the schema it replaces** — verified live: `Name eq 'Contact'` returns five
  > `EntitySchemaManager` rows, in five different packages, each with its own `UId` and all pointing at
  > the same `Parent`. Reading "more than one row" as the duplication would fire on almost every base
  > schema.
  > The anomaly the message actually reports is narrower, and the message text says which: **two schemas
  > with the same `Name` inside the *same* `SysPackage`**, or with the same `Name` **and** the same
  > `ManagerName`. Group the rows by `SysPackage` (or by `ManagerName`) and look for a bucket holding
  > more than one — that, not the row count, is the finding. Report the `UId`s, since the names are
  > identical by design.

  For the null-reference shape, the offending element lives on the source; say plainly that it is not
  readable from here.

  For the lookup shape, three reads: `creatio_describe_object` on the object — the column is there but
  names no referenced object on this environment; `SysSchema` filtered on the referenced object's name, or
  `contains` on its stem when the log does not name it — no row; and `SysPackageDependency` filtered by
  `SysPackage.Name eq '<package>'` — the package does not declare the package that owns the referenced
  object, which is why the delivery was not refused for a missing dependency. From here "the object did
  not travel" and "the column is broken on the source" look the same; the source settles it, so name the
  first as the likely reading and the source as the place to confirm it.
- *Recommendation:* every schema the package references must either exist on the target or be part of the
  delivery — transfer the package that owns it. For the duplication, resolve which package should own the
  schema and remove the other copy on the source, then re-export. For the business-process null, find the
  element without a value on the source, fix it, re-export.

  For the lookup shape the unblock is a **delivery order, not an edit**: install the package that owns the
  referenced object on the target first, then repeat this delivery. Do not point the column elsewhere,
  delete it, or create the referenced object by hand on the target — the spine's §8 says why an edit of a
  delivered element is not an unblock. The proper fix is on the source: declare the dependency on the
  owning package and deliver the two together, or move the referenced object into the delivered package.
  And say that the next compilation will most likely fail until then — the spine's §3 note on deliveries
  with no compilation stage.
  **Standing rule for this whole family:** never transfer packages from a higher platform version to a
  lower one — align environment versions first.

## 4. A database object the package's SQL script needs

**ID7 — A SQL script fails on a table or column that does not exist yet** `[Tier B]`
- *Signature:* `Error occurred while installing SQL script "<name>" in package "<package>". UId <uid>:`
  followed by the engine's own text — `42P01: relation "<name>" does not exist` (PostgreSQL) or
  `Cannot find the object "dbo.<name>"` (MSSQL). Users report "the script runs fine on dev".
  > Note the spelling: this message uses **`occurred`** with two `r`. The installer's *generic*
  > per-element error is spelled `Error occured` with one — they are different messages, so match the
  > one you actually need. A WorkspaceConsole delivery words this as
  > `Error when installing SQL script: <name> in package <package>. UId <uid>:`.
  > This entry covers the case where the object **was supposed to arrive with another package**. If the
  > object exists but its structure or data does not match what the script assumes, that is
  > `installation-catalog-conflicts.md`.

  **Measured shape**, reproduced live on PostgreSQL:
  - **The failure is not fatal, and the log's last line looks like success.** After the error the
    installer ran on through `Installing data`, the application registration and the build, ending on
    `Configuration build finished`. The record's `Status` is `Error` and its `Description` says
    *"…did not complete successfully"* — **that status is the only place the failure surfaces at the end
    of the run.** Establish the stage from the error markers, never from the tail of the file.
  - **Both error markers fire, 32 ms apart, on the same `UId`.** The correctly spelled one carries the
    diagnosis (script name, package, SQL state); the generic `Error occured while performing operation
    on "<item>" item` only repeats the item. Quote the specific one.
  - `SQL script "<name>" saved in package "<package>"` appears **before** `Installing SQL scripts` — the
    script was stored into the package, then execution was attempted. A `saved` line is not evidence the
    script ran.
  - The record carries **child rows** and its `Description` names the package —
    `with packages "<name>"`, populated. Contrast **ID1**, whose refusal has **zero children** and
    `with packages ""` empty: that pair of fields separates a delivery that got under way from one
    rejected at the gate, before you open the log at all.
  - The package and the application **land anyway**: `SysPackage` and `SysInstalledApp` both hold rows
    afterwards, and the build is clean. So "nothing was installed" is the wrong thing to say here — what
    did not happen is the script's *effect*.
- *Verify:* take the object name from the engine's text. If it maps to a Creatio object, confirm its
  absence with `creatio_describe_object` on it, or a filtered low-`limit` `creatio_list_records`.
  **A name the environment does not know comes back as `INVALID_ENTITY: unknown object '<name>'`**
  (verified live) — that error *is* the confirmation, so report it as a finding rather than as a failed
  read. Any other error shape means something else went wrong; do not read it as absence. Then read
  `SysPackage` for the package that should create the object. **A raw table or column with no Creatio
  object behind it cannot be checked this way** — say so rather than presenting an inference as a check.
- *Recommendation:* install the package that creates the missing table or column **before** the package
  carrying the script, or make the script defensive (an existence check) and re-export. Verify the
  package dependencies so the order is enforced rather than remembered. Name the order.

## 5. Runtime consequences of an incomplete transfer

These two surface **after** a delivery that reported success. No stage failed; the delivery was simply
incomplete, and the gap only shows when something runs.

**ID8 — A business process fails at runtime because its subprocess did not travel** `[Tier A]`
- *Signature:* at runtime, after the delivery: `Terrasoft.Common.ItemNotFoundException` naming a process
  and an Id that cannot be found.
  > `ItemNotFoundException` is a **generic** exception whose message is supplied by whatever raised it,
  > so the exact wording varies by caller and product version. Match on the exception type plus the fact
  > that it names a process/Id, not on a fixed sentence.
- *Verify:* read `SysSchema` for the named process — by `Name`, or by `UId` when the exception carries a
  UId — projecting `SysPackage`. An empty result confirms the subprocess is absent from this
  environment, which is the diagnosis. When the exception carries a record Id rather than a schema
  identifier, say which of the two you had.
- *Recommendation:* include every subprocess the process calls in the delivery and reinstall the package.
  A process's callees are part of its dependency set — list them on the source before exporting.

**ID9 — A package built against .NET Framework installed on a .NET Core environment** `[Tier C]`
- *Signature:* after the delivery the application does not start;
  `System.IO.FileNotFoundException: Could not load file or assembly 'System.ServiceModel, Version=4.0.0.0…'`
  or a similar Framework-only assembly.
- *Verify:* read `SysPackage` to confirm the package is installed and `SysPackageReferenceAssembly` for
  the assemblies it declares. **What is physically present in `Files/Bin`, and which runtime this host
  actually is, are off-platform** — you cannot confirm either from here. Present the assembly name from
  the exception as the lead and say what needs checking on the server.
- *Recommendation:* use assemblies compatible with .NET Core (netstandard) in the package, or deploy on
  .NET Framework. Remove the incompatible dependency and recompile. When migrating between platforms,
  every dll in `Files/Bin` needs review. This is a development fix in the package's own code — route it
  to that package's developer; it is not a configuration problem on the target.

## 6. The silent skip — success that changed nothing

**ID10 — The delivery composed itself, found nothing to apply, and reported success** `[Tier A]` — on the
child-count read; **provisional as a root cause until reproduced**, see the closing caveat
- *Signature:* no error anywhere. The installation record reports success, the log carries no failure,
  and the target still runs the old version. Users arrive saying "the package installed successfully but
  the changes are not on prod — the changes are definitely in the package, we checked".
  > **Do not match this on a log line about skipping.** `Actions skipped for schema "<name>" from
  > package "<package>" in <n> sec` reports that an entity schema needed **no database-structure
  > actions** — routine, and present in ordinary successful deliveries. And the paraphrase
  > `Skipped actions for schema "…"`, which circulates in write-ups, **exists nowhere in the
  > product**: a literal search returns zero matches, which reads as "no skip in the log". Neither string
  > is this case's evidence. See the spine's §2.5.
- *Verify:* the evidence is an **absence**, and the cheapest form of it is one read.
  1. **Count the delivery's child rows** — `ConfActivityLog` filtered by `Parent.Id`, with
     `includeTotalCount` and `returnRows: false`. **Zero children on a delivery that reports success is
     the finding**: a delivery that applied anything has children (verified: 56 on a small install,
     1 037 on a large one). This single number is the discriminator; reach for it before reading the log.
  2. **Corroborate with the log's shape.** It stops at `Composing packages`, and there is no
     `Schema "…" saved in package "…"`, no `Installing data` and no build marker anywhere in it. Verified
     on a real reinstall of an unchanged package over itself: the run took half as long as the normal
     one and emitted none of the stage markers.
     > **`Schema "…" saved in package "…"` is not proof that the schema was applied — and the sibling case
     > below produces it.** The line is emitted by a package storage writing the schema into the package
     > (`OnSchemaSaved` is called from both the file-system and the database storage), a few seconds after
     > `Composing packages` — i.e. *before* the decision that may still skip the element. Verified live: a
     > delivery emitted a `Schema "…" saved in package "…"` line for the schema, reported
     > success, and `SysSchema.ModifiedOn` for that schema was still **80 minutes older than the
     > install**. So its presence rules **nothing** out; only step 3 decides. This is the spine's
     > "a `saved` line does not prove anything persisted" rule, and it is easy to fall for even when you
     > know it.
  3. **Rule out the three sibling causes of the same symptom** — §4 of the spine lists four, and only one
     is this file's. Each is a direct read, and reporting this case without them is guessing:
     - `SysSchema` → `IsChanged` / `IsLocked` for the element, plus `ModifiedOn`, and whether its package
       is unlocked here. Either flag set → `installation-catalog-conflicts.md`. **Verified experimentally:**
       a delivery whose archive really carried a changed schema left it untouched on a target where
       `IsChanged = true` / `IsLocked = true` and the package was unlocked — success, no error, no skip
       line, and **`ModifiedOn` still predating the delivery**. That is the conflicts family, not this
       entry, and it reproduces reliably.
       > **Read `ModifiedOn` for one claim only: *the install did not write this row*.** A delivery does
       > stamp it, so a value older than the delivery is sound evidence that this element was not touched.
       > It is **not** a reliable timestamp of the local edit: measured on another stand, the column did
       > not advance on designer saves at all, while the activity log recorded three edits hours later.
       > Not re-measured here. So lead with `IsChanged` / `IsLocked`, use `ModifiedOn` to say what the
       > install did rather than when the user edited, and if it does track saves on your stand, record
       > the difference — a column that behaves differently per environment cannot carry a diagnosis.
     - `SysPackageSchemaDataColumn` → `IsForceUpdate = false` on a binding column whose value did not
       change → `installation-catalog-data-bindings.md`.
     - `SysLocalizableValue` / `LocalizationChangeLog` → resources missing for a culture the target uses
       → `installation-catalog-localization.md`.

     Report the values you actually read. If more than one applies, report all of them and say which
     accounts for the elements the user cares about.
- *Recommendation:* the delivery carried nothing the target did not already have, so re-running it
  unchanged will do exactly the same thing again. On the **source**, make a change that really alters the
  element's content and save/publish it — an empty save can leave it byte-identical, and the comparison is
  on content, not on a timestamp. Then re-export, reinstall, and run a full compilation.
  **Say why the export was empty**, because that is what stops the repeat: the change was not in the
  package that was exported (a stale export, the element sitting in a different package, or a save that
  did not alter the stored content). That is a source-side answer, and it is what distinguishes this case
  from its siblings, whose fixes are all on the target.
  > **This is sometimes attributed to "the schema was touched directly on the target".** That
  > attribution describes the **conflicts** mechanism, not this one: an element edited on the target
  > carries `IsChanged`, and step 3 routes it away from here. Do not repeat it as this case's root cause.
  >
  > **This entry has never been reproduced, and the attempt is what confirmed the boundary.** Three tries
  > on a live stand produced the conflicts case every time — a changed archive, a target element carrying
  > `IsChanged` / `IsLocked`, silent success. A delivery skipped with the target's flags **clean** has not
  > been observed, so treat a match here as provisional and lean on step 3: if the flags are set, this is
  > not the entry, however well the user's wording fits.

## 7. Cycles in the package hierarchy

**ID11 — A cyclic package dependency stalls or fails the delivery** `[Tier A]`
- *Signature:* `Packages hierarchy has circular dependencies. Package Id: <uid>` — **the product's word
  is "circular", not "cyclic"**, so match it as written. Raised as
  `InvalidPackageDependencyException`, whose own message reads `Package "<name>" contains invalid
  dependency: <detail>`. The same condition also surfaces as an installation that **hangs for hours**,
  with `Execution Timeout Expired` on the stored procedure
  `tsp_GetSysSchemaParentsInPackageHierarchyByPackage` (confirmed on both PostgreSQL and MSSQL).
  > **The timeout is the consequence; the cycle is the cause.** Report the cycle. Do not hand this to an
  > infrastructure explanation because a timeout is visible.
- *Verify:* resolve the package from the `Package Id` in the message (`SysPackage` by `UId`), then read
  `SysPackageDependency` and walk the chain from it — see `rca-env-readonly-query`'s "Walking the dependency
  graph — finding a cycle"
  recipe. **Name the packages in the cycle, in order.** With file-system development, also report the
  package's `ModifiedOnUtc`/descriptor state, since a stale descriptor can produce a phantom cycle.
- *Recommendation:* break the cycle — one of the dependency edges you named has to go, and which one is
  the owner's decision, not yours. Then actualize the package hierarchy and retry the delivery. If the
  hung delivery left the environment in a partial state, the question of restoring it is the **spine's
  restore gate** — answer it there rather than repeating it here.

---

## Boundaries (current scope)

**Covered:** the 11 cases above — package-level dependencies (ID1–ID3), schema-level dependencies
(ID4–ID6), a database object a script needs (ID7), runtime consequences of an incomplete transfer
(ID8–ID9), the silent skip (ID10), cycles (ID11). Plus the App Hub-side report of a missing product
bundle, which is answered from ID3.

**Explicitly out of scope, and where it goes instead.** "Install succeeded, nothing changed" is one
symptom with four causes; ID10 owns exactly one of them, and the spine's §4 evidence table decides:

| Evidence | Owner |
|---|---|
| zero child rows, log stops at `Composing packages` | **ID10, here** |
| `IsChanged` / `IsLocked` on the element, or its package unlocked on the target — **the reproducible one**, and it emits a `Schema "…" saved` line while changing nothing | `installation-catalog-conflicts.md` |
| `IsForceUpdate = false` on a binding column | `installation-catalog-data-bindings.md` |
| resources missing for a culture the target uses | `installation-catalog-localization.md` |

Also out of scope:
- A SQL script failing because the object exists but its structure or data differs from what the script
  assumes → `installation-catalog-conflicts.md`. A *repeated* install failing on a column the object
  visibly has → `installation-catalog-data-bindings.md` §5.
- Source generation failing on missing **data** or a missing **localized resource** →
  `installation-catalog-data-bindings.md` / `installation-catalog-localization.md`.
- Whether to restore after a failed delivery → the spine's restore gate. Never answered here.

**Known gaps in this file:**
- **ID1's `Dependent package "…" not found` has never been observed here.** Verified as a product string,
  then not produced by any reachable route: the dependency pre-flight refuses first, on both App Hub and
  the command-line route. ID1's *measured* shape is the refusal-with-a-record described in its entry. A
  dependency-**saving** failure with that message remains unreproduced.
- **ID5's identifiers live in the extended log** — `ParentSchemaName` and `ParentSchemaUId` are written
  there whenever a parent cannot be resolved, and that log is outside this agent's reads: say it exists,
  do not promise to fetch it.
- **ID8's exception wording is not fixed** — `ItemNotFoundException` carries a caller-supplied message, so
  the quoted sentence varies by caller and product version. Match the type plus what it names.
- Signatures whose text belongs to PostgreSQL, MSSQL or the .NET runtime (ID4, ID7's engine half, ID9)
  could not be verified against the product's own resources; they are matched as engine/runtime text.
  **ID5 is no longer one of them** — its real signature is a product string.
- **ID2, ID3, ID8 and ID9 have no failing stage** — a refusal before the delivery starts, or a runtime
  consequence after one that succeeded. This is not a gap in routing: the spine's §5 routes them by
  **pasted signature**, which is how the catalogs are organised anyway. It *is* a limit on what the
  report can claim — say which of the three routes you took.

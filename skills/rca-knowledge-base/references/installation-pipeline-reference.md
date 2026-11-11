# Installation — delivery pipeline reference (what a delivery actually does, and how to prove it)

**Not a case file, and not part of the spine's §5.1 search.** The catalogs hold signature-matched cases;
this file holds the **mechanism underneath all of them** — the order in which a delivery does its work,
what it commits before it fails, what it remembers about a failure, and **which read proves each of those
on a live environment**.

Opened **on demand**, from the spine or from a catalog entry that points here — never swept. Read it when
an entry's verification needs to know *why* the delivery reached the state it did, when the restore gate
needs to know what is already permanent, or when the log and the outcome disagree.

**Nothing below may be reported to a requester on this file's authority alone.** Report what you read,
using this file to know *what* to read.

Verification tags, per statement:

- **`[observed]`** — reproduced on a connected environment, with the read named.
- **`[unverified here]`** — product behaviour derived from how the platform is built, **not** reproduced on
  an environment we can read. Say so plainly; say what would settle it; never upgrade one to a finding
  because it fits.

> **Read this before quoting anything here.** This file was written from the platform's own behaviour, not
> from a reproduction run, so **every statement in it starts as `[unverified here]`** unless it carries an
> `[observed]` tag added by a later verification. That is not a formality: the mechanism explains what to
> look for, and the environment — not this file — decides what happened.

---

## 1. Four delivery channels, one installer

A package or application reaches an environment through one of five routes:

| Route | What the user did |
|---|---|
| **App Hub / Marketplace** | installed an application from the catalog or from a file, in the app management UI |
| **"Install from file"** | uploaded a package archive in the configuration section |
| **WorkspaceConsole** | ran the command-line utility against the site — see `installation-workspaceconsole-reference.md` |
| **Command-line client against a running site** | drove the site over its web API from a script, a CI/CD step or by hand — see `installation-clio-reference.md` |
| **File-system install** | the site picked up an archive placed for it, skipping the advanced dependency check |

**They converge.** All of them end in the same package save: the same composition of incoming content against
what the environment holds, the same per-element decisions, the same database writes, the same stage order
(§3). `[unverified here]`

Three consequences that matter for an RCA:

1. **The channel does not change the error text.** A signature from a command-line push and the same
   signature from the App Hub mean the same thing. Do not treat "but we installed it via WorkspaceConsole"
   as a different diagnosis.
2. **The channel changes *where* a refusal happens, and therefore whether there is anything to read.**
   A pre-flight refusal in the App Hub UI happens before the installer is called — no activity-log record,
   no installer log. The same refusal on a command-line push reaches the installer, which logs the activity
   first and then refuses — a record *and* a log. The spine's §2.1a owns this split; the mechanism behind it
   is here.
3. **The archive that installs is not always the archive that was uploaded.** When the pre-install
   dependency analysis produces a corrected bundle, the working directories are wiped and the corrected
   content is extracted in place of the original. A delivery can therefore contain packages the user never
   put in the file they uploaded. `[unverified here]` — *verify:* the installer log's `Package "X" loaded`
   lines are the authority on what was actually installed, not the user's description of the archive.

---

## 2. Working directories and the archive

The delivery unpacks into working directories under the application's temporary storage — a download area
for the uploaded archive, an unpack area for the package content, a temp repository, and the log directory
holding `install.log`. `[unverified here]`

**Leftovers from a previous operation block the next one.** Content still held in the working directories
when a delivery starts aborts it, and the error names the entries that are held (up to ten of them). A
plain file in the root of the unpack area is tolerated with a warning; anything else is fatal. This is the
mechanism behind *"the installation dies immediately with a directory/content error"* — the delivery never
started, and the environment, not the package, is at fault. `[unverified here]` — *verify:* the installer
log stops before `Preparing packages for installation`, and the activity-log record has no child rows.

**Archive rules the delivery enforces before anything else:**

- **a folder inside the archive is rejected** — `Zip must not contain nested folders`. An archive that was
  re-zipped from an extracted folder, or an archive containing another archive, lands here;
- the archive **name** is validated: no path separators, no invalid characters, and it must end in `.zip`;
- **more than one application descriptor** in a package is its own refusal.

A single-package archive and a multi-package archive are detected and handled differently, so the same
content delivered the two ways is not the same delivery. `[unverified here]`

---

## 3. The stage order, and the marker lines that prove it

This is the log spine of every delivery. Order is execution order; the quoted text is what the installer
log actually writes, and matching on it is how the stage is established.

| # | Stage | Markers |
|---|---|---|
| 1 | Upload | `Loading file: {0} {1}%` |
| 2 | Backup | `Configuration backup started.` → `Configuration backup successfully created.` |
| 3 | Validation | `Packages validation started` → `Packages have been validated` |
| 4 | Extraction | `Preparing packages for installation` |
| 5 | Install begins | `Starting package installation` |
| 6 | Load & compose | `Loading packages from archive`, `Package "X" loaded`, then `Loading packages from database` **or** `Skipped - Loading packages from database (new application)`, then `Composing packages` |
| 7 | Metadata save | `Package "X" saved`, `Schema "X" saved in package "Y"`, `SQL script … saved`, `Schema data … saved`, `Files saved in package "X"` |
| 8 | Hierarchy | `Package hierarchy actualization is started` / `… completed. Affected records: N` |
| 9 | Install scripts | `Executing install scripts` |
| 10 | SQL scripts | `Installing SQL scripts` |
| 11 | DB structure | `Updating tables structure in database`, `Actions added for schema "X" from package "Y" in N sec`, `Structure saved: X from package Y` |
| 12 | Data bindings | `Installing data`, `Data "X" from package "Y" installed`, `Lookup values "X" … installed` |
| 13 | Compilation | `Compiling configuration dll`, `Errors and (or) warnings occurred while compiling configuration dll` |
| 14 | Static content | `Configuration build started` → `Configuration build finished`, `Meta info file updated` |
| 15 | End | `Package installation finished` |

**Two refinements the stage table alone hides**, both of which change a diagnosis:

- **Install scripts and SQL scripts run twice, around the metadata save.** A "before" pass executes ahead of
  stage 7 and an "after" pass follows stage 11. So `Executing install scripts` appearing *before* any
  `Package "X" saved` line is not the log being out of order — it is the before-pass, and a failure there
  means nothing of the package was written yet. `[unverified here]`
- **The database-structure stage works from what the package changed, not from what the database looks
  like.** A repeat delivery of an already-installed, unchanged version does not reconcile the schema: drift
  introduced directly in the database is neither detected nor repaired. `[observed]` — on PostgreSQL, a
  column the package's own schema defines was renamed away and the same version delivered again; the column
  did not come back and the delivery reported success. Two consequences for a diagnosis: **"reinstall the
  package" is not a remedy for a table that no longer matches its schema**, and **a delivery that succeeded
  is not evidence that the schema matches — nor that the database user holds the rights the stage would
  have needed**, because a stage that does no work meets no permission.
- **Source regeneration precedes the DB structure update, and may run in the background.** The delivery can
  start regenerating sources and continue with other work, joining the task later. A source-generation error
  can therefore surface far from where it was raised. `[unverified here]`

**Every activity-log record the finalization step reaches gets the log attached**, as
`install_<timestamp>.txt`, by the same step that writes the terminal status, the duration and the
description. State the scope of that guarantee carefully, because two cases sit outside it and a missing
attachment is read as a mismatched log if they are forgotten: **a delivery that failed before the record
was written leaves a log on disk and no record at all**, and **a process that died outright never reached
the finalization step**, so it leaves the record without a terminal status *and* without the attachment.
So: within a finalized record, log and record go together; outside one, their absence says which of the two
happened, not that the log belongs elsewhere. `[unverified here]` — *verify:* read `ConfActivityLog` for `StatusId`,
`DurationInSeconds` and the attachment list.

---

## 4. What is permanent when a delivery fails — the fact the restore gate rests on

**A delivery is not atomic.** A transaction, when one is used at all, covers only the **metadata save**
(stage 7) and its dependency bookkeeping. It does **not** cover:

- the before-pass install scripts and SQL scripts,
- the database structure update (stage 11),
- the after-pass SQL scripts,
- the data bindings (stage 12),
- compilation (13) and static content (14).

Whether the metadata save runs in a transaction at all is conditional on the environment's asynchronous
installation and resource-installation modes, so **do not assume it was one.** And the rollback path is
narrow: it exists for schema-level item errors, and only when the environment enables it. `[unverified here]`

**What this means in a report.** "The installation failed" never means "nothing changed". Columns can have
been added, scripts executed and data written before the failure, and they stay. Say what the log shows was
reached, not what the outcome word implies.

*Verify, in this order:*

- `ConfActivityLog` children — every element the delivery wrote has a row; their absence is as informative
  as their presence;
- `SysPackage` for the packages named in the log — present means the metadata save committed;
- the retry markers in §5, which say which parts failed and were remembered.

---

## 5. The environment remembers what failed — the best evidence this domain has

Failures at the element level are not only logged, they are **written back onto the element**:

| What failed | Where the environment records it |
|---|---|
| a data binding | `SysPackageSchemaData` — `NeedInstall` set true, and `LastError` holding the message (truncated) |
| a SQL script | `SysPackageSqlScript` — `NeedInstall` set true, and `LastError` |
| a schema | `SysSchema.LastError` |

`[observed]` — all three columns read by name on a connected environment and returning values. *Verify:*
read them filtered by the package from the log. This is the one place where a **failed delivery is still
readable after the log is gone**, and where a re-install's behaviour is explained: the marked elements are
what a subsequent delivery retries.

A row still carrying `NeedInstall` **after** a delivery that reported success means that delivery did not
retry it — worth saying outright, because it is invisible in the log.

---

## 6. Backup and restore

**The backup is a separate step that runs before the install**, not part of it. It stores, per package the
delivery is about to change, an archive of the package's **current** content, plus the metadata needed to
undo the delivery: which packages are new (and therefore have to be *removed* on restore), which
applications and dependency edges existed, which packages were inactive. It lands in the site's
configuration backup directory (`conf\backup`) and is attached to the activity-log record as
`backup_<timestamp>.zip`. `[unverified here]`

**Two system settings decide whether the attachment exists at all** — `SaveBackupDisabled` turns backup
saving off, and `SaveBackupMaxSizeMb` caps its size. `[observed]` — both read by code on a connected
environment, returning `false` and `200` there, so the cap is **200 MB by default**. **Over the cap, the
backup is silently not attached.** So *"there is no backup attachment"* has three different meanings — backup disabled, backup too
large, or the delivery created packages rather than replacing any — and they are told apart by reading the
settings, not by guessing. *Verify:* read the two settings by code through the system-settings read, and
compare with the record's attachment list.

**Restore is not an undo — it is another install of the old content.** It re-adds the backed-up packages,
re-deactivates what was inactive, **removes the packages the delivery created**, drops the application
records and dependency edges for those applications, and then runs a normal save. Two consequences:

1. **Restored applications come back with a new identifier.** Dependency edges are re-resolved by
   application *code*, not by Id. Anything that stored the old Id does not follow. `[unverified here]`
2. **A restore can be refused.** If the backup contains SQL scripts that are not marked backward-compatible,
   the restore stops rather than run them, unless that check is explicitly overridden. This is the answer to
   *"we tried to roll back and it would not let us"*. `[unverified here]`

**The restore writes its own activity-log record**, with its own log attached — so a restore is findable the
same way a delivery is, and an environment that was rolled back says so in the log rather than in anyone's
memory. *Verify:* search `ConfActivityLog` for the restore operation around the delivery's timestamp before
recommending a rollback the customer may already have performed.

---

## 7. An interrupted delivery

Nothing resumes it. What survives is decided by where it stopped (§4), and the environment is left in one of
three readable states: `[unverified here]`

- **terminal status written, errors listed** — the delivery failed and finalized normally;
- **no terminal status at all** — the process died; nothing finalized, and the log attachment may be missing
  or truncated;
- **the application row left marked as an unsuccessful installation** — this one is *actionable*: the next
  delivery of the same application detects it and **uninstalls the broken application first**, which is why
  a second attempt sometimes removes things the first attempt installed. Say this before recommending
  "just install it again".

*Verify:* read the application's installation status alongside `ConfActivityLog`; the two together
distinguish the three states.

---

## 8. Timeouts — which one actually fired

Three different limits, and the signatures do not name which:

- **The client's request limit is one hour**, for validation, backup and the install call alike. A browser
  that gave up says nothing about whether the server kept going — and it usually did. *"The install timed
  out in the UI"* is therefore not an outcome; read the record. `[unverified here]`
- **The upload is chunked, and a failed chunk fails the whole upload** — there is no chunk retry. A flaky
  connection produces an upload failure with no installer log, because nothing was installed.
- **Database commands run under a single command timeout** — an environment-wide default measured in
  hundreds of seconds, overridable per environment. **There is no install-specific database timeout.**
  So a cancelled statement on a long structural change (stage 11) is the ordinary command timeout hitting a
  slow operation, not an installation setting anyone can tune per delivery.
  > **It is an application configuration setting on the server, not a `SysSettings` record** `[observed]` —
  > a `SysSettings` read by its code on a connected environment returns no row. **There is no read that
  > gives you its value**, so a report may state the mechanism but never the number. The command-line
  > delivery channel takes it as an argument instead, which is the one place it is visible without server
  > access. *Recommendation:* a maintenance window, or raising the setting on the server — both manual
  > steps for a human, and both organizational as much as technical.

---

## 9. Web farm — why one node knows and another does not

During the save, the node performing it marks **itself** not-ready, and marks itself ready again afterwards
— unless a restart is required, in which case it announces a workspace change instead. Other nodes learn
about a delivery through a **notification channel**: a node that receives a workspace-change notification
published by a *different* node reloads locally. A second channel carries settings changes. Rights caches
are expired at the end of the save. `[unverified here]`

Two things follow, and both are common reports:

- **Until a node processes the notification, it serves the previous configuration.** "One user sees the new
  version and another does not" is this, not a cache the user can clear.
- **A restart is required when the delivery changed a package that carries its own assembly**, and the
  install response says so. If nobody restarted, the environment is in a legitimate, documented
  intermediate state — not a failed delivery.

**None of this is verifiable from a single connected environment**, which is the honest tier for the whole
section: you can read that the delivery succeeded here; you cannot read what the other nodes did. Say that
rather than inferring it.

---

## 10. What must be regenerated before the UI reflects a delivery

Four artefacts, produced in this order, and a delivery can stop after any of them: `[unverified here]`

1. **Schema sources** — regenerated from the stored metadata;
2. **the configuration assembly** — compiled from those sources;
3. **client static content**, written into the site's configuration runtime directory, together with a
   meta-information file holding a **configuration hash**;
4. **OData entity artefacts**, built in the background or at the next start.

**The configuration hash is the browser's cache key.** Clients move to new content only when it changes, so:

> **A hash that does not change across several deliveries means static content generation is failing.**

That single check — compare the hash before and after — separates *"the delivery did not apply"* from
*"the delivery applied and the browser is still serving the old bundle"*. `[unverified here]`

Add the restart condition from §9: when the delivery changed an assembly-carrying package, even correct
content is not served until the application restarts.

---

## 11. Rights

The delivery is gated by operation permissions — managing the solution, and installing an application.
A refusal at upload time surfaces to the user as an insufficient-rights message and produces **no installer
log**, because nothing was installed. Individual phases have their own checks: installing SQL scripts,
installing bound data, and executing install scripts are each permitted separately, so a delivery can be
allowed to start and still be refused part-way. `[unverified here]` — *verify:* the log's last successful
stage marker tells you which phase was refused; the permission itself is an administration question for a
human, not a read this agent performs.

---

## Boundaries

- This file explains **mechanism**; it matches no signature and diagnoses no incident. Route from the spine,
  match in a catalog, and come here when the verification needs to know why.
- It owns the **run**. The other mechanism files own the rest of the domain, and none of them restates
  another: `installation-artefacts-reference.md` — what the delivery installs, per artefact class, and what
  each leaves behind; `installation-applications-reference.md` — applications, packages, dependency
  resolution and the refusals before anything is touched; `installation-workspaceconsole-reference.md` —
  the command-line channel; `installation-catalog-conflicts-reference.md` — the per-element decision;
  `installation-catalog-data-bindings-reference.md` — the binding's installation type.
- Everything here is `[unverified here]` unless it says otherwise. A statement from this
  file that has not been confirmed by a read on the environment under investigation goes into a report as
  *how the platform works*, never as *what happened here*.

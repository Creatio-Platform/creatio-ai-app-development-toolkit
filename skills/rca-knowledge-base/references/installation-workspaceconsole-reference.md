# Installation — WorkspaceConsole reference (the command-line delivery channel, and its own failure modes)

**Not a case file, and not part of the spine's §5.1 search.** This file holds the behaviour of the
**command-line utility** a delivery can run through — what it is, what it does *not* do unless told to,
what its log looks like, and why "it finished with no error" is not the same as "it worked".

Opened **on demand**, whenever the incident says the delivery went through WorkspaceConsole (WSC): a CI/CD
delivery action, a deployment script, a support engineer running it by hand, or a log file named after a
console operation rather than `install.log`. The pipeline itself — stages, transactionality, backup —
is `installation-pipeline-reference.md`; **this file is only what the utility adds on top.**

Verification tags per statement, as elsewhere: **`[observed]`** (reproduced on a connected environment,
read named) and **`[unverified here]`** (product behaviour, not reproduced here). **Everything below starts
as `[unverified here]`** — and most of it stays there, because WSC runs on a machine this agent cannot read.
That is the honest tier for the whole file, and it must be stated in the report rather than glossed.

---

## 1. What WSC is, and why that explains most of its failures

WSC is **a second instance of the platform, running out of process**. It is not a client that calls the
site's services: it loads the same application core, opens the same database with the same connection
settings, and performs configuration work directly — installing packages, saving schemas, updating database
structure, compiling the configuration, generating client static content.

Four consequences that produce most of the reports:

1. **It needs the site's own configuration to find the database.** It reads it from the deployed site
   directory it is pointed at. Point it wrong and it fails before doing anything; point it at a *different*
   site and it silently delivers to that one.
2. **It does its work on the machine it runs on.** Locks, disk, permissions and antivirus on *that* machine
   decide whether it succeeds — none of which is readable from the site.
3. **It knows nothing about the other nodes of a farm**, and it does not restart anything.
4. **It performs one operation per run.** There is no orchestrator inside it; the *sequence* is the caller's
   responsibility (§4), and a caller that skips a step produces a half-delivered environment that reports
   success.

---

## 2. Operation families

Run as `-operation=<name>`; the utility's own `-help` prints the authoritative list for the build in hand.
Grouped by what they touch:

| Family | Operations, by what they do |
|---|---|
| **Install** | `InstallFromRepository` / `InstallPackages` / `UpdateConfiguration` (packages from a directory), `InstallZipPackage` (one archive), `InstallApp` / `UninstallApp` / `ExportApp` (application level), `InstallPackagesFromWorkingCopy`, `InstallBundlePackages`, `UpdatePackages`, `DeletePackages`, `InstallPackageData` |
| **Dry run** | `PrevalidateInstallFromRepository` — composes and validates, **writes nothing** |
| **Catch-up** | `InstallRequiredData`, `InstallRequiredSqlScripts`, `UpdateRequiredSchemasDBStructure`, `GenerateRequiredSourceCode` — install only what is still marked as not installed (the retry markers in the pipeline reference's §5) |
| **Build** | `BuildWorkspace` / `RebuildWorkspace`, `Build` / `Rebuild` / `BuildPackage`, `RegenerateSchemaSources`, `UpdateWorkspaceSolution`, **`BuildConfiguration`** |
| **DB structure** | `CreateSystemDBStructure`, `UpdateSystemDBStructure`, `SaveEntitySchemasStructureInDB`, `UpdatePackageHierarchy`, `ActualizeCustomPackageDependencies` |
| **Content transfer** | `LoadPackagesToFileSystem` / `LoadPackagesToDB`, `SaveDBContent`, `LoadWorkspaceContent`, `DownloadPackages`, `CompressPackages`, `ValidateContent` |
| **Environment** | `BackupConfiguration`, `RestoreConfiguration`, `CreateWorkspace`, `SetSysSetting`, `ChangeFeatureState`, `InstallCoreSystemSettings`, `ExecuteScript`, `ExecuteProcess` |

**`BuildConfiguration` is not a compile.** It generates **client static content**, which is a different
artefact from the configuration assembly. Confusing the two is the single commonest mistake in a WSC
incident: a run that compiled successfully has still produced nothing the browser will load.

---

## 3. The four paths that get confused

| Argument | What it must point at | What goes wrong |
|---|---|---|
| `webApplicationPath` | the **deployed site** directory | the utility reads the site's configuration from here to find the database. Absent or wrong file → it stops immediately naming the path it looked for. Pointed at another site → the delivery lands there |
| `configurationPath` | the configuration project folder that owns the packages | sources are generated and compiled against the wrong tree |
| `confRuntimeParentDirectory` | the **parent of `conf`** | generated runtime content and configuration backups land here. **Hard-required for the whole install family** — missing, the run stops with a parameter error before anything happens. Wrong, the run *succeeds* while writing content the site never reads (see §8) |
| `destinationPath` | per-operation: unpack root for an install, output directory for a content build | for an install its contents are **deleted at the end of the run** (§7) |

Two more worth knowing: `sourcePath` (the archive, directory of archives, or repository address — an empty
one ends the run with a "no files found" warning rather than an error), and `workingCopyPath`, which the
bundle operations **wipe** — never a real source tree.

**A misspelled argument name is not an error.** Unknown names are accepted and ignored, so the default
applies silently. `-skipConstraint` instead of `-skipConstraints` changes nothing and reports nothing —
which is why the run header (§5) that echoes the parameters actually supplied is the only reliable record
of what the run was asked to do.

---

## 4. The mandatory sequence — state it once, as a rule

WSC performs one operation per run, and **an install alone is not a delivery.** The rule, for any route
that changes schemas — an install, a source regeneration, a package load from disk or database:

> **install → update the workspace solution → compile → `BuildConfiguration`.**

Skip the last step and the configuration is correct while the browser still serves the previous bundle.
Skip the compile and the environment holds new metadata against an old assembly.

Inside a single install run the order is fixed and is the pipeline's, with two additions worth stating:

- **the database structure update happens before the compile**, not after. So a run that failed at the
  compile has already committed the structural changes;
- **the compile happens only if source regeneration was enabled** for that run (§5 of this file). Turned
  off, the install reports success and no compilation was ever attempted.

Two further gates:

- **Bootstrapping an empty database** has its own order — create the system structure, install core system
  settings, create the workspace, install the system package — and these are precisely the operations that
  do not require an existing configured database. Anything else run first fails for the wrong-looking reason.
- **The configuration version gate.** Outside the install and regeneration family, every operation refuses
  to run when the binaries' version and the environment's `ConfigurationVersion` setting disagree. After an
  upgrade, an install (or an explicit version update) must come first, or nothing else will run at all.
  *Verify:* read the `ConfigurationVersion` system setting by code.

---

## 5. The run's own log

**The file.** `log_<Operation>_<timestamp>.txt`, in the directory given by `-logPath`, one per run,
timestamped with the moment the process started. **Without `-logPath`, the detailed writer is silent** — the
per-schema lines, the stack traces and the compiler error blocks are simply not written anywhere. A WSC
incident that arrives with a thin log usually arrives without that argument, and the first recommendation is
to re-run with it.

**The header** is the most useful part and the part people skip. It prints the start time, the architecture,
**every parameter actually supplied** (passwords redacted), the assembly version and the configuration
version. That answers, without asking anyone, which site, which operation and which switches the run used.

**Markers**, in the order a delivery run writes them:
`Installing package from repository '{0}' to workspace '{1}'` → `Packages loaded: …` → `Packages composed: …`
→ `Updating structure of system tables in database` → `Installing data` → `Installing Sql scripts` →
`Saving structure: {0} in package {1}` / `Structure saved: {0} in {1} sec` →
`Compiling and saving in '{0}' workspace database` → `Compilation started` / `Compilation finished in …` →
`Configuration build started`. Compiler failures appear as
`Errors and(or) warnings occurred when compiling '{0}' workspace:` followed by
`{file}({line},{col}) error {number}: {text}` — the same codes the compilation domain's catalog matches, so
hand the signature there rather than diagnosing it here.

**The end of the run** prints `List of errors occured during utility execution:` and a numbered list.
**Read that block. It is not always reflected in the exit code** (§6).

---

## 6. Exit codes — and why `0` does not mean success

| Code | Meaning |
|---|---|
| `0` | success — **or nothing ran at all** |
| `-1` | general error or unhandled failure |
| `-2` | data (binding) errors, unless the run was told to treat them as warnings |
| `-3` | SQL script errors |
| `5` | **the input artefact is bad** — a corrupt or truncated package archive, or a malformed package descriptor |

Two traps, both of which produce a green CI build over a broken environment:

1. **A failure that was caught and logged does not always reach the exit code.** The error list at the end
   of the log is the authority, not the code.
2. **The silent no-op.** With "continue if error" enabled and a site path that does not exist, the utility
   initializes nothing, prints `Action "{operation}" skipped` and **returns `0`**. The only evidence that a
   delivery never happened is that one line — and the absence of any activity-log record on the target.

`5` is worth separating out in a report: it says the *package* is damaged, not the environment — which is a
different owner and a different fix (re-export or re-download the artefact).

---

## 7. Failure modes that belong to the utility, not to the delivery

- **The run never returns.** Without `-autoExit=true` the utility waits for a keypress after finishing. A
  script or CI agent then hangs forever on a delivery that already completed. This is the commonest
  "WorkspaceConsole froze" report and it is not a failure at all.
- **The temp folder delete replaces the real result.** An install unpacks into a randomly named subfolder of
  `destinationPath` and deletes that tree at the end of the run. If anything holds a handle in it —
  antivirus, an indexer, an open Explorer window, a second WSC run — the delete throws **after the install
  already succeeded**, and that exception is what the caller sees. The fingerprint is **leftover
  short random-named folders under `destinationPath`**. Diagnose by the log's last stage marker, not by the
  final exception.
- **A non-empty package-store directory.** A materialization step refuses to clone into a directory that is
  not empty, and it does not recover a partially completed previous attempt — the directory has to be
  emptied by hand.
- **Two runs against the same store.** The store is guarded by an exclusive lock file; the second run fails
  on the lock rather than with a message about concurrency. **No parallel deliveries** is an organizational
  answer, and should be given as one.
- **Link creation on Windows.** Packages are materialized as directory junctions; a real folder already
  sitting in their place is refused outright, and creating links needs the corresponding privilege. Failures
  here read as file-system errors, not as delivery errors.
- **Several workspaces in one run.** When more than one workspace is named, **only the first gets a full
  install**; the rest are downgraded to sources only — no data, no SQL scripts, no structure, no compile.
  A delivery that "worked on one workspace and not the other" is this, by design.
- **The old-UI compile retry** copies binaries into the deployed site's folders before recompiling — a run
  that mutates the site beyond the packages it delivered. Worth naming when the environment changed in ways
  the package does not explain.
- **The connection.** When the database cannot be reached, older builds surfaced only a generic login error;
  the detail lives in the inner exception chain that a run with `-logPath` prints. A generic login message
  with no detail means the log path was missing, not that there is no detail.
- **The scheduler.** A site whose configuration declares an active scheduler with an unreachable connection
  stops the run on scheduler wiring, with nothing to do with the packages being delivered.

---

## 8. Switches that silently turn off half the delivery

Each defaults to on; each turned off produces a run that reports success and delivers less than the caller
assumes. This table is the checklist for *"the install succeeded but nothing changed"*:

| Switch off | What did not happen |
|---|---|
| `regenerateSchemaSources=false` | **no compilation at all** — sources were not regenerated, so the build step is skipped entirely |
| `updateDBStructure=false` | tables were not altered — new columns are missing at runtime |
| `installPackageData=false` | bound data and lookups were not installed — the configuration is there, the content is empty |
| `installPackageSqlScript=false` | scripts skipped; the catch-up operation can apply them later |
| `generateStaticContent=false` | changed schemas were only **marked pending**; nothing was generated (§9) |
| `useStaticFileContent=false` | no static content is produced at all for this run |

And three that change what a failure means rather than what happens: `continueIfError` (errors are logged and
the run proceeds — and it is half of the silent no-op in §6), `skipConstraints` (foreign keys are not
created, so data that would have been rejected is accepted), and `treatDataErrorsAsWarnings` (binding
failures no longer set the exit code). `clearWorkspace` is destructive and wipes the workspace's package
storage before installing.

`dbCommandTimeout` is the one lever for a structural change that is being cancelled on a large table — the
same environment-wide command timeout the pipeline reference's §8 describes.

---

## 9. "We installed through WSC and the pages still show the old version"

The single most common WSC report, and it has **four distinguishable causes** — all of them readable from
the run's own log and the site's configuration runtime directory, none of them a browser cache:

1. **Static content was disabled for the run** (`useStaticFileContent=false`). Nothing was generated; the
   site serves whatever was already there. The log says the configuration hash was published anyway.
2. **Content was only marked pending** (`generateStaticContent=false`). The run deliberately left the
   generation to the web application, which does it at its next start — **and withholds the configuration
   hash until then.** This is intended behaviour, not a defect: the UI updates after the application
   restarts.
3. **`confRuntimeParentDirectory` pointed elsewhere.** Content was generated correctly, into a `conf` folder
   the site does not read. The site's own meta-information never changed, so the hash never changed, so no
   browser refetches.
4. **A farm with no node generating content.** The log says so in those words, and points at the farm's
   design-node configuration. A related line — the content watcher not being initialized on a node — appears
   in that node's startup log when the meta-information file does not yet exist.

**The one check that separates all four from a browser problem** is the configuration hash in the site's
meta-information file, before and after: unchanged across several builds means content generation is not
completing. The recovery for cases 1–3 is a full content build — `BuildConfiguration` with force, static
content and file content all enabled, pointed at the site — as a **manual step for a human**.

One related detail: loading workspace content deliberately touches the site's configuration file to trigger
a recycle. **No other operation does**, which is why a running site keeps stale in-memory state after most
WSC runs until it is restarted.

---

## 10. What can be confirmed from a connected environment — and what cannot

**Confirmable here:** that the delivery reached the environment at all (activity-log record and its
children), which packages and schemas exist afterwards, the retry markers that say what failed, the
`ConfigurationVersion` and timeout settings, and whether a restore was performed.

**Not confirmable here, ever:** the run's arguments, its exit code, its log file, the state of the machine it
ran on — disk, locks, permissions, antivirus — and what the other farm nodes did. **Ask for the run's log
file; do not infer it.** A WSC diagnosis that names a switch nobody read is a guess wearing a diagnosis's
clothes.

**And the question the user is usually really asking — "did the delivery reach the site at all?"** — is
answered by the activity-log record, not by the utility. A pipeline that failed **before** the console
invocation line ever ran did not touch the environment; one that failed after it did. State which, because
it decides whether anyone needs to restore anything.

---

## Boundaries

- Mechanism only. This file matches no signature and diagnoses no incident; route from the spine, match in a
  catalog, come here for why.
- Compiler error codes from a WSC build are the **compilation domain's**, matched in its catalog. WSC's part
  ends at handing the signature over.
- Stages, transactionality, backup and restore are the pipeline's —
  `installation-pipeline-reference.md`. Only what the utility adds lives here.

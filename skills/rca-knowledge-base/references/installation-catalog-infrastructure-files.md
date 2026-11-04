# Domain: Installation — infrastructure & environment catalog (files, archive, static content, console)

Open this file **only from `installation.md`**, or from
`installation-catalog-infrastructure.md` when its signature did not match. This is the **second half of one
family** — the same tier discipline, the same routing rule, the same question underneath. Its §0 and §1 apply
here in full and are not repeated: **read them before matching anything below.**

Where the first half is the environment's *runtime* — database, concurrency, transport, farm — this half is
everything that is **a file**: the directories a delivery works in, the files it cannot replace, the disk it
writes to, the archive it was handed, the generated content the browser loads, and the command-line utility
that produces all of these from outside the site.

**13 cases (`IE14`–`IE26`).** Case ids continue the first half's numbering; the two files are one catalog.

**This half is even more heavily Tier C than the first.** Directories, locks, permissions and disk are facts
about a machine, and the agent has no read that reaches them. Say what was recognized, say what the platform
confirmed, and name what only someone with access to the server can settle.

---

## 1. Temporary and backup directories

The delivery unpacks into working directories and takes a backup before it starts. Both are ordinary
file-system operations, and both fail **before the installation proper** — so the whole family below shares
one confirmation: **the log stops early and the activity-log record has no child rows.**

**IE14 — Leftovers from a previous delivery block this one** `[Tier B]`
- *Signature:* two wordings, and **the newer one is far more useful — keep both**:
  - `System.IO.IOException: The directory is not empty`, raised immediately;
  - `System.IO.IOException: Content left from a previous operation cannot be removed from the package
    working directory because it is used by another process: <items>. Release the listed items and repeat
    the operation.` `[observed]` — reproduced live; **it names the held items**, so the recommendation can
    quote the exact paths instead of telling someone to go looking.

  The user's question is usually the right one: *"is that on our side or yours?"*
- *Mechanism:* content still held in the working directories when a delivery starts aborts it. A previous
  delivery that was killed, or a file another process still owns, leaves it behind.
- *The stage is the backup, not "before the install"* `[observed]`. The archive is extracted **inside** the
  configuration-backup step, so that is where a working-directory problem surfaces: the log reaches
  `Configuration backup started.` and stops there. The record's own `Description` then carries the verdict
  outright — *"Backup of the configuration before installing "<app>" finished with error. The configuration
  was not changed."* — which is worth quoting beside the log, not instead of it.
- *Verify:* confirm the log ends at the backup marker with **no** `Preparing packages for installation` and
  no `Composing packages`, and that the record carries **no children** — that pair is the evidence it never
  began, and both halves are fully readable. Run the spine's §2.4c inventory as well: it is what lets you
  say the environment is unchanged rather than merely undamaged. **The directory itself, and which process
  holds the items, are not readable from here.**
- *Recommendation:* clear the platform's temporary installation directory — the path is the one configured
  for temporary files, in its package-installation subfolder — then reinstall. **On cloud this is a support
  request**, not something the customer can do; say so rather than giving an instruction they cannot follow.
  Answer their question directly while you are there: **this is on the environment's side, and the package is
  not implicated.**

**IE15 — The backup step cannot create its folder** `[Tier C]`
- *Signature:* `System.IO.IOException: Cannot create "backup" because a file or directory with the same name
  already exists`, at the backup step — before installation.
- *Mechanism:* the step creates a `backup` directory inside the site's configuration runtime directory. An
  existing **directory** of that name is simply used; the failure means a **file** has taken the name. Say
  that, because it decides the fix: something has to be **deleted**, and it is not a directory.
  > **Do not confuse this with IE14 — they fail at the same stage and read almost the same.** The
  > discriminator is one word in the message, and the two fixes are unrelated: content that *cannot be
  > removed because another process holds it* is a **lock**, and the answer is to release the holder;
  > a name that *cannot be created because it is taken* is a **collision**, and the answer is to delete the
  > file. Recommending the wrong one changes nothing on the environment.
- *Verify:* the log's position is confirmable here; the directory is not. **Mind what "stopped at the
  backup" actually looks like** `[observed]`: the backup step **reads the archive first**, so the log shows
  `Configuration backup started.`, then `Loading packages from archive` and a `Package "X" loaded` line per
  package, and *then* the exception. Those loading lines do **not** mean the installation began. The
  discriminating absences are **`Preparing packages for installation` and `Composing packages`** — together
  with zero child rows, that is the evidence nothing was applied.
- *Recommendation:* **delete** the item that took the name — not rename it inside the same directory — and
  retry; on cloud, via support. An existing backup *directory* is not a problem and is left alone. Note in
  the report that **no backup exists for this attempt**, and carry it forward: until this step succeeds,
  every further attempt fails identically **and no backup is taken before installation**, which is what
  would make the next successful install unrollbackable.

---

## 2. Files the delivery cannot replace

Three entries, one mechanism: **another process owns the file.** None is diagnosable from here, and all
three are worth recognizing precisely because the message sounds like a platform defect.

**IE16 — A generated content file is locked** `[Tier C]`
- *Signature:* `System.IO.IOException: The process cannot access the file '…_FileContentDescriptors.js'`
  — or another file under the site's generated content directory — `because it is being used by another
  process`. The user sees it as one page refusing to open after the delivery.
- *Mechanism:* static content generation could not rewrite a file. The lock is usually transient and held at
  the operating-system level — an antivirus, an indexer, a backup agent.
- **The record does not carry this diagnosis — the log does** `[observed]`. Generation failures are
  collected and rethrown together, so the record's `Description` reads
  *"…finished with unexpected error: "One or more errors occurred.""* — a wrapper with no cause in it —
  while the `IOException` naming the file sits in the log, after the marker `File content generation
  started`. **Answering from the record alone produces a report that says nothing.**
- **This delivery applied itself** `[observed]`. Content generation is the last stage, so the packages,
  database structure, data and application registration all landed. Say so explicitly — the two
  neighbouring cases in this file fail *before* the install, and carrying their "nothing happened" across
  is the likeliest error here. The child rows are the evidence: here there are some.
- *Verify:* the log names the file; quote it. Confirm from the record whether the delivery otherwise
  completed. **Nothing about the lock is readable from here.**
- *Recommendation:* regenerate the static content in full (a configuration build), then reload the page
  without cache. If it recurs rather than passing, someone with server access has to identify what holds the
  file; on cloud, a support request. See **IE23** for the mechanism of static content, and use its hash check
  to prove whether generation completed.
  > **Check whether it already recurred, and let that decide the advice.** A second delivery with the same
  > failure means the lock is not transient, and the useful recommendation is the server-side step rather
  > than another install — reinstalling does not change the cause and stops at the same point.
  > **And do not reach for the backup.** A delivery that applied usually left one, but restoring it would
  > **remove the version that was just delivered** — the fix here is a build, not a rollback. A restore is
  > right only if the delivery is being abandoned altogether.

**IE17 — A package library is in use** `[Tier C]`
- *Signature:* `System.UnauthorizedAccessException`, naming the site's package binaries directory or a
  specific library, `is denied`. Characteristically **intermittent** — "a retry sometimes works", which is
  itself part of the signature.
- *Mechanism:* a custom service, a debugger, or the application itself holds the library the delivery needs
  to replace.
- *Verify:* the log's stage tells you the delivery reached the point of writing files; the record tells you
  what else completed. **The holder of the file is not readable from here.**
- *Recommendation:* restart the site or its application pool before retrying, which releases the library;
  then find and stop whatever custom process holds it for the duration of the delivery window. Server-side
  work for a human.

**IE18 — The application's account lacks rights on its own directories** `[Tier C]`
- *Signature — two wordings for one refusal* `[observed]`, both at the **backup** step of an on-site
  installation:
  - `System.IO.UnauthorizedAccessException: Access to the path 'backup' is denied` — the direct form,
    with the stack running through the directory **replace** and the delete inside it;
  - `System.IO.DirectoryNotFoundException: Could not find a part of the path '…gz'` — the misleading form.
    **The path looks wrong; the rights are wrong.**

  Treat them as one entry. A run that only knows the second will not recognize the first, and the first is
  what a permissions failure actually produces.
- *Mechanism:* the step does not create the backup directory — it **replaces** it, which means deleting the
  existing one first, and that delete is what the operating system refuses. The account the web application
  runs under lacks the rights it needs on the directories the delivery uses: the configuration runtime
  directory that holds the backup folder, the temporary directory, the package-installation path.
  > **This is why a step that worked yesterday can stop working today.** The rights are not necessarily
  > missing from the deployment: something may have re-created the folder, or left a file inside it, under
  > a different owner or with an ACL that does not match its parent. Both readings lead to the same
  > server-side check, and saying which one you cannot distinguish is part of the answer.
- *Compare it with a previous run before calling it a standing condition* `[observed]`. A successful
  delivery of the same application a day earlier establishes that the environment was fine and the problem
  is recent — which changes the recommendation from "the deployment was done wrong" to "something changed
  on that directory". One read, and it reframes the whole answer.
- *Verify:* the failure's position (backup, before install) and the absence of children are confirmable.
  **File-system rights are not readable from here.**
- *Recommendation:* grant the application pool's account full rights on the application directories —
  configuration, temporary and package-installation paths — and verify the deployment followed the official
  procedure, because this usually indicates it did not. Administrative work on the server.

---

## 3. Disk

**IE19 — The server ran out of disk space** `[Tier C]`
- *Signature — one cause, two messages, and which one you get depends on where the space ran out*
  `[observed]`:
  - **the honest one** — `There is not enough space on the disk.`, raised in the dialog while a file is
    being uploaded or unpacked. The product says exactly what happened;
  - **the misleading one** — `Not found. Http error 404. The requested resource is not found`, **while the
    site is alive and responding**. Here the mismatch *is* the signature: a `404` that contradicts the
    user's own experience of a working site.

  Treat them as the same entry caught at different points. A run that recognizes only the second will not
  recognize the first as this case at all — and the first is the one a fixture produces.
- *Mechanism:* a delivery from a file needs the space **several times over** — the uploaded archive in the
  temporary area, the unpacked package tree, and, on-site, the pre-install backup. Whichever of those
  volumes is full stops the run, and it stops it **before any package is read**, so nothing in the
  application or the archive is implicated and there is no meaningful installer log to read. With no space
  to write, the failure surfaces wherever the write happened to be — which is how it can arrive wearing a
  routing error's clothes. **Following that one literally wastes the whole investigation.**
- *Verify:* nothing here confirms which volume is full or by how much. On the honest wording you may state
  the cause — **the product said it**, and that is a quotation, not an inference; on the `404` wording you
  may only say it is the known presentation of exhausted space and cannot be checked from this connection.
  Keep those two claims apart. If a delivery record exists, report how far it got; often there is none,
  because the run died at upload.
- *Recommendation:* check free space on the server in **three** places, not just the system volume: the
  application directory, the temporary directory, and the volume holding the package-installation path.
  Free it — stale `conf\backup` folders, previous package archives in the temporary area, logs — and retry
  from the file. **Nothing needs changing in the application or the package**, and saying so plainly is
  part of the answer. One look for whoever has server access; on cloud, a support request.

---

## 4. The archive and the package file

**IE20 — The archive was renamed** `[Tier C]`
- *Signature:* `Terrasoft.Common.InvalidNameException: Object code "… (1)" is not valid` ·
  `The name must start with a letter or digit` ·
  `System.IO.DirectoryNotFoundException: Could not find a part of the path '…\Temp\<old name>\…metadata.json'`.
  The story is almost always the same: *"the browser renamed it to `package (1).zip` when we downloaded it
  twice."*
- *Mechanism:* **a single package file's name must equal the package name inside it.** Rename it and the
  descriptor no longer matches. A zip holding **several** packages is a different thing and may be renamed
  freely — the individual package files inside it may not. That distinction is the whole entry.
- *Verify:* the name in the message is the evidence; quote it. If the intended package name is known, check
  whether such a package exists here already — useful context, not proof.
- *Recommendation:* re-download or re-export the file under its original name — no duplicate suffix, no
  spaces, no brackets, no leading special characters — and install that. Never rename a single package file
  to fix anything.

**IE21 — An archive inside an archive** `[Tier C]`
- *Signature:* `Npgsql.PostgresException (0x80004005): 42601: syntax error at or near ")"`, raised at the
  very start of the delivery. Also reachable as `Zip must not contain nested folders`.
- *Mechanism:* an archive counts as **one package** when it carries no package files inside it — which is
  exactly what a nested archive looks like at the top level. Its bytes are then taken as the package body
  and handed on, so the failure surfaces far downstream as a **database syntax error** that names nothing
  relevant and sends everyone to look at SQL scripts.
  > **Whether the message is honest depends on one irrelevant detail.** The same mistake reports
  > `Zip must not contain nested folders` — clear and correct — when the archive happens to contain a
  > **folder**, and `42601` when it does not. Do not treat the clear wording and the database error as
  > different problems; they are the same one, caught at different points.
- *Verify:* the position is the tell — a syntax error before any `Package "X" loaded` line means nothing was
  ever read as a package. The archive's structure is not readable from here; **ask what the file contains.**
- *Recommendation:* unpack the outer archive and install the inner package file. State plainly that the
  database error is a symptom of the archive's shape, or the next person repeats the investigation.

**IE22 — The package is damaged or incomplete** `[Tier C]`
- *Signature:* a missing package descriptor · `Unexpected end when deserializing object` · a build that
  fails immediately after the delivery. In the worst shape the site does not come back up.
  > **Two different failures wear this signature, and only one is about a package.** A damaged **package**
  > fails on its way in and installs nothing. A damaged **configuration meta-information file on the site**
  > fails a build with the same deserialization wording and is what actually takes the site down —
  > it is an artefact of the environment, unrelated to whatever was being delivered. Establish which one
  > you have before recommending anything: the fix for the first is a new archive, for the second it is
  > removing the broken artefact and rebuilding, and neither helps the other.
- *Mechanism:* part of the content never made it into the archive — an interrupted download, a failed export,
  or an export taken from an environment that was itself broken. A command-line delivery has its own signal
  for this: an exit code reserved for a damaged input artefact (see
  `installation-workspaceconsole-reference.md`). **That code says the package is at fault, not the
  environment** — a rare, valuable distinction in this family.
- *Verify:* what the delivery managed to write is readable — packages, schemas, the record's children. The
  archive's integrity is not.
- *Recommendation:* re-export or re-download the package and verify it is complete before retrying. If the
  environment was left broken, the spine's restore gate applies — restore the configuration, and remove
  damaged generated artefacts before a full rebuild. Check whether the **source** environment had errors when
  the package was exported; an export taken from a broken configuration stays broken however often it is
  installed.

---

## 5. Static content — the delivery applied, the browser did not

**IE23 — Changes are in the configuration but the pages are old** `[Tier B]`
- *Signature:* **no error at all.** The elements are visibly present in the configuration; the interface
  serves the previous version; the user has already cleared the cache, and says so.
- *Mechanism:* the configuration and the client content are two different artefacts. A delivery that
  produced the first does not necessarily produce the second — and after a command-line delivery it
  routinely does not, **by design**. The full mechanism, including the four distinguishable causes and the
  hash that the browser uses as its cache key, is
  `installation-workspaceconsole-reference.md` §9 and `installation-pipeline-reference.md` §10. **Read one of
  them before answering** — the four causes have different fixes.
- *Verify:* the record shows the delivery succeeded; the log shows whether a configuration build ran at all.
  The decisive check — whether the configuration hash changed — is **a file on the site**, so it is a
  question for whoever has access, not a read this agent performs. Say which half you established.
- *Recommendation:* run a full configuration build (static content generation) and reload without cache.
  **Say that this is expected behaviour rather than a fault** — the user has spent time hunting a bug that is
  a missing step, and being told so plainly is the answer they need. For the command-line channel, state it
  as the standing rule, not as a tip for this incident: **after installing from a repository, always run a
  configuration build.**

**IE24 — Pages break after a package was deleted** `[Tier B]`
- *Signature:* client-side errors when opening pages or the section wizard, after a package or a
  configuration element was removed. The generated content still references schemas that no longer exist.
- *Mechanism:* the same asymmetry as **IE23**, in the opposite direction: removal changes the configuration
  and leaves stale generated content behind.
- *Verify:* confirm from `SysPackage` and the configuration that the elements are genuinely gone, and from
  the record when the deletion happened. The generated content is on the site and is not readable here.
- *Recommendation:* regenerate the static content in full, then verify the pages in a private browser window
  so the check is not confounded by a cache. If the deletion itself was the mistake, that is the spine's
  restore gate, not this entry.

---

## 6. WorkspaceConsole

**The standing rule, stated once for the whole family — not as a tip on any single case:**

> **After installing from a repository with the command-line utility, a configuration build is a mandatory
> step of the delivery, not an optional follow-up.** A delivery that stops at the install has not finished.
> The same applies to updating the workspace solution and compiling: the sequence is install → update
> solution → compile → configuration build.

`installation-workspaceconsole-reference.md` owns the mechanism — the operations, the paths, the switches
that silently deliver half a package, the log and the exit codes. **Its §6 is required reading before
answering any console incident**, because the utility's exit code `0` does not mean the delivery happened.
**IE23** above is the third console case of this family.

**IE25 — A path or directory name the utility rejects** `[Tier C]`
- *Signature:* `Error: Object name "7.15.3" is not valid` — a version-shaped folder name, or any name
  carrying dots or special characters, in the path passed to the utility.
- *Mechanism:* names in the delivery path are validated as object names; dots and special characters are not
  permitted. The failure has nothing to do with the package's contents.
- *Verify:* nothing on the environment corroborates this — the path exists only on the machine that ran the
  utility. **Ask for the command line that was used**; it is the entire evidence, and the run's log header
  prints it.
- *Recommendation:* rename the directories passed to the utility so they carry no dots or special characters,
  and re-run. A local change on the delivering machine.

**IE26 — The console cannot connect, or cannot find the package** `[Tier C]`
- *Signature:* one of three, often in sequence as someone sets the utility up:
  `Error: System login error. Error has been recorded in system log of the server` ·
  `Item *.gz of type Package not found` · a run that times out on a long operation.
- *Mechanism:* three different causes, and the entry exists to separate them.
  - **The login error is a connection problem, not a credentials problem.** The utility takes its database
    configuration from the site it is pointed at; when that is wrong or missing, this generic message is all
    it prints. The detail lives in the run's log — **and is written only when the log path was supplied.**
  - **`Item … not found`** means an archive *file name* was passed where the **package name** was expected.
    The two are different things, and the message does not say so.
  - **A timeout** is the utility's own connection timeout being too small for a long delivery.
- *Verify:* nothing here is readable on the environment. **Ask for the run's log file**, and for the command
  line; the log's header prints every argument the run actually received, with the password redacted. A
  console diagnosis given without that log is a guess.
- *Recommendation:* point the utility at the deployed site so it reads the site's own configuration, or fix
  its connection configuration; pass the **package name**, not the archive file name; raise the connection
  timeout for long operations; and re-run **with a log path supplied**, without which the detailed errors are
  not written anywhere. Then apply the standing rule above. All manual steps on the delivering machine.

---

## Boundaries

- **13 of the family's 26 cases live here**; the other 13, and the family's §0 tier rule and §1 routing, are
  in `installation-catalog-infrastructure.md`. Do not answer from this file without them.
- Mechanism is not restated here. The run is `installation-pipeline-reference.md`; the artefact classes are
  `installation-artefacts-reference.md`; the console is
  `installation-workspaceconsole-reference.md`.
- **No entry here requires a write.** Most fixes need access this agent does not have — a server, a support
  request, or the machine that ran the delivery. Name the owner as part of the recommendation.

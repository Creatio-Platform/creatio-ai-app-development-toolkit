# Domain: Installation — infrastructure & environment catalog (environment and platform runtime)

Open this file **only from `installation.md`**. Unlike the other catalogs of this family it is
**not owned by a single stage** — an environment failure interrupts whichever stage happened to be running,
so the spine may route here from any of them, and from no stage at all.

This is the family where **the package is fine and the environment refused**: a connection dropped mid-
structural-change, a second delivery was already running, a proxy cut the upload, the other node of the farm
never learned about the delivery, a role that nobody deleted went missing. **The signatures are wildly
different and almost none of them mean what they say.**

The question the user is actually asking is rarely "what does this error mean". It is:

> **"Is this on our side or yours, and did the delivery even touch the site?"**

Answer that first. It decides who owns the problem and whether anyone needs to restore anything.

**This file holds `IE1`–`IE13` and `IE27`.** The
file-system half of the family — temp and backup directories, locked files, permissions, disk, the archive,
static content and WorkspaceConsole — is `installation-catalog-infrastructure-files.md` (`IE14`–`IE26`).
Neither is a superset of the other; if the signature is not here, try there before reporting from the spine.

---

## 0. The tier rule for this family — read before matching anything

Every entry is tagged, as elsewhere: **`[Tier A]`** fully diagnosable from a platform read; **`[Tier B]`**
recognized by signature with partial corroboration; **`[Tier C]`** the evidence lives off-platform.

**This family is mostly Tier C, and that is not a weakness to write around.** The agent cannot read: free
disk space, file locks, OS or web-server permissions, proxy and load-balancer behaviour, the state of the
other farm nodes, the network path, or anything about the machine a command-line delivery ran on.

So the shape of an honest answer here is three sentences, in this order:

1. **what was recognized** — the signature, and the mechanism behind it;
2. **what was confirmed on this environment** — naming the read and what it returned;
3. **what could not be read from here at all**, said plainly, with who can settle it.

**A signature match is not a diagnosis.** Saying "the disk is full" because a `404` appeared is exactly the
failure this file exists to prevent — the agent cannot see the disk. Say that the signature is the known
shape of a full disk, that it cannot be verified from here, and that infrastructure can confirm it in one
look.

**Never name an internal case id, a tier, or this file to the user** — `rca-diagnosis-report`'s scrubbing rules
apply from the moment an entry is matched.

**Several answers here are organizational, not technical** — a maintenance window, a rule against parallel
deliveries, a support request on cloud. State them as such. A "recommendation" the user cannot execute
themselves is worse than an honest escalation.

**Run the spine's §2.4c inventory before answering anything in this family.** Because the environment is
mostly unreadable here, *what is installed on it* is one of the few Tier A facts available — and in this
family it is often the whole answer rather than background: it is what says the delivery succeeded despite
a transport error (**IE7**, **IE8**), that the site was never touched (**IE11**), that a missing object was
not removed by the package (**IE12**), and whether a retry would uninstall first. **No recommendation to
retry or to restore is safe without it.**

---

## 1. Routing into, and out of, this file

**In.** Any stage, plus the two routes the spine names when there is no stage: the outcome table, and a
pasted signature with no record at all. An environment failure can also produce **no log line of its own** —
several entries below are recognized by what is *missing*.

> **An empty log is a route into this file, not a reason to stop.** More of this family leaves no trace
> than leaves one, so "there is no record" **shortens the list instead of ending the search**. Sweep these
> entries by the pasted signature before concluding anything:
>
> | Refused by | Entry | What exists instead of a record |
> |---|---|---|
> | a proxy or load balancer, before the platform | **IE9** | the browser's network view; no upload entry in the site's request log |
> | the delivery pipeline, before the install ran | **IE11** | the pipeline's own output; the site was never touched |
> | the database being unreachable | **IE27** | an installer log on disk, and **no record** — the platform had nowhere to write one |
> | the application-management UI's own pre-flight | **IE20**, **IE22** | only the dialog text `[observed]` — a damaged archive or a name that does not match the descriptor is refused **before upload**, so nothing reaches the installer |
> | a full disk, presenting as an unrelated status | **IE19** | whatever the user saw; usually nothing on the platform |
>
> **The last row of that table is measured, and it changes how two entries are used** `[observed]`: the
> same damaged archive that produces installer-level errors through the command line is stopped in the UI
> with a different message and no record at all. **The channel decides which evidence exists** — so
> establish the channel before deciding that evidence is missing.

**Out — the four signatures that look like this family and are not.** Turn them away rather than
half-answering:

- **A timeout *and* a foreign-key error in the same delivery.** A cancelled statement is present in both
  families, so the timeout is not the discriminator. If the log also carries `23503` — or any constraint
  violation naming a record — the delivery failed on **data**, and it is
  `installation-catalog-data-bindings.md`. The timeout is noise from the same slow stage. **Do not let a
  timeout swallow a binding failure**; this is the one confusion this file is most likely to cause.
- **`Unable to install … because the element has been modified locally`** → `installation-catalog-conflicts.md`.
  The installer named the blocked element; nothing here explains it.
- **A missing package, parent schema or product bundle** → `installation-catalog-dependencies.md`, even
  when the *symptom* was a hang or a refusal that felt infrastructural.
- **Compiler error codes** from the build that followed the delivery → the spine's §5.2 gate, then the
  compilation domain. A build that fails after a successful install is not an environment failure.

**The mechanism behind every entry here lives in the reference files**, and this catalog does not restate it:
`installation-pipeline-reference.md` for the run, its timeouts and the farm;
`installation-applications-reference.md` for the pre-install refusals;
`installation-workspaceconsole-reference.md` for the command-line channel.

---

## 2. Database, locks and timeouts

**IE1 — A statement was cancelled during the delivery** `[Tier B]`
- *Signature:* one of `System.OperationCanceledException: Query was cancelled` ·
  `57014: canceling statement due to user request` · `Execution Timeout Expired` ·
  `25P02: current transaction is aborted` · `40P01: deadlock detected` ·
  `Npgsql.NpgsqlException: Exception while reading from stream`. Typically raised while the delivery is
  updating table structure. **Almost always accompanied by "the very same package installed fine
  yesterday"** — which is true, and is the point: the package did not change, the environment's load did.
- *Mechanism:* structural change runs under the environment's **single database command timeout**; there is
  no per-delivery limit. A long change on a large table, a backup window, a lock held by a scheduled job or
  an integration — any of these reaches that limit without the package being at fault.
- *Verify:* read `ConfActivityLog` for how far the delivery got, and its children for what was already
  written. Check whether **another delivery or build overlapped** — that is a read, and it turns a guess
  into evidence (see **IE5**). **What is not readable from here:** database load, the backup schedule,
  which session held the lock — **and the timeout value itself.**
  > **The command timeout is not a system setting, and looking for one wastes a read and invites a wrong
  > statement.** `[observed]` — a `SysSettings` read by its code on a connected environment returns
  > no row. It is an **application configuration setting on the server**, so its value is
  > readable only by someone with access to the site's files. Say the mechanism and say the value is
  > unknown from here; do not report "the timeout is at its default" as a finding.
- *Recommendation:* deliver outside backup and peak windows, with concurrent jobs and integrations stopped
  for the window; raise the command timeout if the statement is legitimately long. **A retry without a
  restore is acceptable** when the interrupted step is idempotent — but read the spine's restore gate first,
  because the structural change already committed. If the structure update itself failed, it is finished
  manually: update the database structure for the affected objects, regenerate their sources, compile. All
  manual steps for a human; the scheduling half is organizational.

**IE2 — The database ran out of connections during the delivery** `[Tier C]`
- *Signature:* `53300: sorry, too many clients already`, on a .NET Core environment.
- *Mechanism:* the platform installs applications with internal parallelism; each worker takes its own
  connection. The ceiling is reached by the delivery itself, which is why the environment looks healthy
  before and after.
- *Verify:* confirm from the log that the failure fell inside the delivery. **The connection limit and the
  pool's state are not readable from here** — say so rather than inferring from the message.
- *Recommendation:* raise the database's connection limit, and/or reduce installation parallelism; retry.
  Both are administrative changes for a human, and on cloud a support request.

**IE3 — An exclusive table lock could not be acquired** `[Tier C]`
- *Signature:* `ORA-00054: resource busy and acquire with NOWAIT specified or timeout expired`.
- *Verify:* the log's stage says which object was being changed; name it. **Who held the lock is not
  readable from here.**
- *Recommendation:* deliver in a maintenance window with other access to the database excluded — other
  application copies, development tools, integrations. The session holding the lock has to be found and
  ended by a database administrator, and the engine's own lock-timeout setting can make the next attempt
  wait rather than fail. Organizational plus DBA work; not a package fix.

**IE4 — The database user lacks rights on a specific table** `[Tier C]`
- *Signature:* `permission denied for table <name>` — frequently a leftover `*Bak` table created outside the
  application user's grants.
- **The stage decides which of two causes it is, and they have different fixes.** The message is identical
  either way, so the stage is the only discriminator available:

  | Stage the delivery failed at | What it was doing | The cause | The fix |
  |---|---|---|---|
  | **data / bindings** | writing rows | the **grants** are missing | grant the rights |
  | **database structure** | altering the table | the **ownership** is wrong | change the table's owner |

  > **Why granting rights can change nothing.** Table privileges and table ownership are separate things.
  > On PostgreSQL a structural change is permitted by **ownership**, and ownership is not a privilege that
  > can be granted — so granting the application's user every right on a table it does not own leaves the
  > next attempt failing identically, while the recommendation reads as sound.
- *Verify:* the table named in the message is the whole signature; quote it. Whether it is a leftover or a
  genuine part of the schema is often answerable from the environment — check whether an object of that name
  exists in the configuration. Then read the **stage** off the log and use the table above.
  **Neither the grants nor the ownership are readable from here** — which is why naming the stage matters:
  it tells the DBA which of the two to look at first.
  > **"The same package installed fine yesterday" is not evidence that the rights are intact** `[observed]`.
  > A repeat delivery of an already-installed, unchanged version does no work on that table at all —
  > measured live, three deliveries completed against a table the application's user could neither read nor
  > alter, the third with a column the package's own schema defines missing from it. A stage that does no
  > work meets no permission. See the pipeline reference, §3.
- *Recommendation:* lead with what the stage implies. On a data-stage failure, grant the application's
  database user the missing rights. On a structure-stage failure, have the DBA check **who owns the table**
  — a leftover created by another account is the usual story, and it is the same story the `*Bak` name
  hints at. Either way the third option stands: if the table is an orphan nobody owns up to, drop it after
  someone confirms it is unused. A DBA decision; present the options and the evidence for each rather than
  choosing.

**IE27 — The application cannot open its database at all** `[Tier B]`
- *Signature:* the delivery dies at **validation**, with the engine refusing the connection rather than a
  statement:
  `System.Data.SqlClient.SqlException (0x80131904): Cannot open database "<db>" requested by the login.
  The login failed.` · `Login failed for user '<service account>'.` · `Error Number:4060,State:1,Class:11`.
  The PostgreSQL forms are the authentication and missing-database failures (`28P01`, `3D000`). The account
  named is the one the **application pool** runs under, not a person.
- *Mechanism:* this is not a slow or blocked statement (**IE1**–**IE3**) and not a missing grant on one
  table (**IE4**). The application cannot reach the database **at all**, so the delivery stops at the first
  step that needs it — package validation, before anything is installed.
- **Its defining consequence: there is no activity-log record, and that is not a gap** `[observed]`. The
  platform writes its records *into the database it cannot open*, so it has nowhere to log. The installer
  log is written to the file system, survives, and — because that file is a rolling one — **may later be
  attached to a different delivery's record**. See the spine's §2.1b: an attachment whose timestamps do not
  match its record is the signal.
- *Verify:* say that the delivery **never reached a state-changing stage** — the log stops at
  `Packages validation started` and no record exists. Then use the reads you are already making as evidence
  in their own right: **if your own queries answer, the database is reachable now**, which separates a
  transient outage from an ongoing one. What is **not** readable: the state of the service account, its
  rights on that database, and whether the outage has recurred.
- *Recommendation:* for the server administrator and the DBA — establish whether the account's credentials
  or rights on that database were lost, or whether the database was briefly unavailable (taken offline,
  failed over, restarted). Quote the account name and the error number; they are the whole ticket.
  **Before any retry, confirm the login works**, or the next attempt dies at the same step and leaves the
  same silence behind it. Nothing here is fixable from the platform.

---

## 3. Concurrency and downtime

**IE5 — A second operation started while one was still running** `[Tier B]`
- *Signature:* `System.InvalidOperationException: Cannot run compilation because another compilation is in
  progress`. Also reported as two deliveries launched back to back, the second failing.
- *Mechanism:* the platform **does not block** parallel configuration operations. Nothing prevents a
  delivery from starting during a build, or a build from starting during a delivery; they destabilize each
  other, and the failure lands on whichever lost.
- *Verify:* this is the entry where the platform corroborates well. Read `ConfActivityLog` around the
  failure's timestamp and **find the overlapping operation** — its own record, its stage, its status. An
  overlap found in the log is evidence; "probably someone else was installing" is not.
- *Recommendation:* run deliveries and builds **strictly sequentially**, confirming the previous operation
  finished before starting the next. On cloud, a site left in a maintenance state means a previous operation
  is still running and the next must wait. This is an operating rule for the team, not a setting anyone can
  turn on.

**IE6 — The site became unavailable right after the delivery** `[Tier C]`
- *Signature:* `502 Bad Gateway` or `503` after an installation, the site slow or hanging while it
  recompiles. The user's question is usually *"can we install with no downtime?"*
- *Mechanism:* a package whose elements require compilation makes the application rebuild and restart.
  **Zero downtime is not achievable for such packages** — this is the platform's behaviour, not a
  misconfiguration, and on a farm the other nodes are affected too.
- *Verify:* confirm from the log that a build followed the delivery, and from `ConfActivityLog` that the
  delivery itself completed. **The web server's own errors are not readable from here.**
- *Recommendation:* schedule deliveries in a maintenance window; after installing, wait for the build to
  finish and start nothing else until it does. For large or batched deliveries on cloud, support can install
  in a service window. Say plainly that the downtime is expected, rather than implying something went wrong.

---

## 4. Transport and session — the delivery the browser lost

The three entries here share one mechanism and one consequence: **the browser stopped hearing about a
delivery that the server was still performing.** Never report any of them as a failed installation before
reading the record.

**IE7 — The install call returned no response at all** `[Tier B]`
- *Signature:* `Http failure response for …/AppInstallerService.svc/InstallAppFromFile: 0 Unknown Error`,
  sometimes a `502` pop-up, sometimes the same on export.
- *Mechanism:* the connection between browser and server broke — a proxy, an antivirus, an extension, an
  application-pool restart, or a long request. **The delivery frequently completed on the server.**
- *Verify:* the decisive read. Look for the delivery's `ConfActivityLog` record, its status, and whether the
  packages are in `SysPackage` and the application in `SysInstalledApp`. If they are, the answer is *"the
  installation succeeded; the response did not arrive"* — which is a completely different conversation.
  Also check the environment's compilation-necessity-detection feature state, which has been implicated.
  **The network path, proxy and antivirus are not readable from here.**
- *Recommendation:* verify the result before retrying — **a blind retry of a delivery that succeeded is the
  real risk here**. If it recurs, retry from a clean browser profile and inspect the request at the network
  level; check the feature named above. Note for the report: the application-management UI may show the logs
  of a *previous* delivery, so confirm the log you are reading is this one's.

**IE8 — The session expired during a long delivery** `[Tier B]`
- *Signature:* the operation is marked failed and, instead of the installation log, an **empty
  `undefined.html`** downloads.
- *Mechanism:* the same as **IE7** at the session layer. The installation runs on the server and does not
  depend on the browser staying alive.
- *Verify:* read the record and the attached log on the server side — that is the real status. The empty
  download proves only that the client could not fetch the log.
- *Recommendation:* raise the session timeout for delivery windows and keep the tab active; check the
  server-side status before repeating anything.

**IE9 — The upload was rejected before it reached the platform** `[Tier C]`
- *Signature:* `413 Request Entity Too Large` from the front-end web server in the browser's network view;
  the page then reloads by itself. **No upload entry appears in the site's request log** — the request never
  arrived.
- *Mechanism:* a proxy or load balancer in front of the site caps the request body below the size of the
  upload chunk. **The platform's own maximum-file-size system setting never applies**, because the request is
  refused before .NET sees it. This is why raising that setting changes nothing, and why the user's
  reasonable first experiment fails.
- *Verify:* the absence of an upload entry in the request log, and the absence of any `ConfActivityLog`
  record, is the evidence that nothing reached the site. Read the maximum-file-size setting by code so the
  report can state that it is not the constraint. **The proxy's configuration is not readable from here.**
- *Recommendation:* raise the body-size limit on the front-end web server — and on every additional proxy,
  load balancer or ingress in the path — to at least the platform's configured maximum, then retry. An
  infrastructure change for whoever owns that layer.

---

## 5. Web farm

**IE10 — Nodes disagree after a delivery** `[Tier C]`
- *Signature:* usually **no error at all**. Behaviour differs depending on which node serves the request;
  processes fail intermittently after a delivery that reported success.
- *Mechanism:* the delivery is performed by one node. Others learn of it through a notification and reload;
  until they do, they serve the previous configuration. Nothing in the delivery restarts them.
- *Verify:* confirm here that the delivery succeeded and what it changed. **State explicitly that the state
  of the other nodes is not readable from this connection** — this is the entry where an agent is most
  tempted to generalize from one node to a cluster.
- *Recommendation:* deliver to a farm by the documented procedure, in a maintenance window: leave one node
  serving, stop the rest, clear the generated configuration and runtime content directories on the stopped
  nodes, install on the active node, copy those directories across, start the nodes. When a package is being
  deactivated, the inactive-package directory travels too. A documented operational procedure — quote it as
  such, and do not improvise a shorter version.

---

## 6. Cloud delivery preparation — did the delivery reach the site at all?

**IE11 — The delivery pipeline failed before the installation started** `[Tier C]`
- *Signature:* `Directory "/UpdatePkg/%site%/Pkg" does not exist` ·
  `In the directory '…UpdatePkg…Pkg' was not found at least 1 *.gz file` ·
  `Cannot bind argument to parameter 'LinuxLocalDir' because it is an empty string`.
- *Mechanism:* two different causes wearing one label. The first two mean the preparation steps that place
  the package on the delivery share were not completed. The third means the environment's scheduled database
  backup was running and collided with the action's own backup step.
- **The rule this entry exists for:**
  > **A pipeline failure before the line `Running WorkspaceConsole InstallFromRepository` means the site was
  > not affected.** Nothing was installed, nothing needs restoring, and the whole conversation moves to the
  > pipeline.
  Say this explicitly. It is the single most useful sentence in this family, and it is the direct answer to
  *"did the delivery even touch the site?"*
- *Verify:* the absence of any `ConfActivityLog` delivery record at that time **confirms the site was not
  touched** — and here that absence means exactly what it says, unlike the spine's warning about being
  connected to the wrong environment. Corroborate by finding the environment's other deliveries: if the
  connection is right, earlier ones are visible.
- *Recommendation:* missing directory or package — re-run the preparation steps and confirm the package file
  reached the share. Backup collision — wait for the scheduled backup to finish, then re-run the action.
  Both belong to whoever owns the pipeline, not to the site.

---

## 7. Side effects attributed to the delivery

**IE12 — Something disappeared after the delivery** `[Tier A]`
- *Signature:* **no error anywhere.** A functional role, its permissions, or a package is gone, and the
  delivery is blamed because it is the most recent thing that happened.
- *Mechanism:* two different truths hide under this report, and the evidence separates them.
  - **The delivery did not do it.** Roles and permissions are not carried by packages in the ordinary way,
    and an installation log that contains no deletion of the object points at a removal made by hand or
    directly in the database.
    > **One qualifier, and it decides whether that clearing is sound.** A package can carry an install
    > **SQL script**, and a script can delete rows no package artefact would. The log records only that a
    > script **ran**, by name — **its text is not attached and is not readable from here**. So silence in
    > the log clears the package outright only when the delivery executed **no** scripts. If it executed
    > any, name them and say that one check remains and who can make it: an unqualified "the package is
    > innocent" is as unfounded as the accusation it replaces.
  - **The delivery did do it, legitimately** — if the application's *previous* installation had failed. A
    repeat installation of a failed application **uninstalls it first**, taking with it anything attached to
    that application on this environment, including packages generated here.
- *Verify:* this is the rare Tier A entry in the family. Read `SysAdminUnit` for the role — present or
  absent is a fact, not an inference. Read the installation log for any deletion of it, **and for the
  SQL-scripts markers** — `Installing SQL scripts`, `SQL script "X" from package "Y" installed` — which
  settle whether the qualifier above applies and give the script names to hand over; read
  `ConfActivityLog` for **both** attempts and the application's installation status. The combination
  "previous attempt failed" plus "this attempt uninstalled first" is the confirmation of the second reading.
- *Recommendation:* if the delivery is cleared — scripts accounted for — say so **without hedging**: an
  unfounded accusation against a package costs a developer days. Restore the role and its assignments from a backup (on cloud, a support
  request). If the second reading holds, explain the recovery behaviour before anyone installs again, because
  the same thing will happen.

---

## 8. Closed infrastructure

**IE13 — The delivery tries to reach an external service and cannot** `[Tier B]`
- *Signature:* failed or hanging requests to the application installation service during an install; from
  the marketplace path, `Unable to retrieve app files from the Marketplace.` Typical of on-site environments
  without outbound access.
- *Mechanism:* the pre-install dependency analysis is performed by an external service. With no route to it,
  the delivery fails at that step — **before anything is installed**.
- *Verify:* read the feature state for automatic dependency installation, and the system setting holding the
  service address; both are readable and both belong in the report. The absence of a delivery record
  confirms nothing was installed. **Whether the network permits the call is not readable from here.**
- *Recommendation:* preferred — allow outbound access to that address, because the analysis genuinely
  improves dependency resolution. If the network policy forbids it, disable automatic dependency
  installation and install the application together with its dependencies from archives by hand. A network
  decision for a human; present the trade-off rather than defaulting to switching the feature off.

---

## Boundaries

- **13 of the family's 26 cases live here**; the other 13 are in
  `installation-catalog-infrastructure-files.md`. A signature that matches neither is not this family's.
- This file diagnoses **environment** failures. It never concludes that a package is defective — when the
  evidence points that way, the incident belongs to another catalog.
- **No entry here requires a write.** Every fix is a manual step for a human, and several are organizational
  or belong to infrastructure, support or a DBA. Say which, and to whom.

# Installation — generic signature fallback & delivery consultation reference

Two halves in one file, reached by **two different routes**, and neither of them is a case catalog. Keep
them apart: they answer different questions and their answers have different shapes.

| Half | Opened from | Answers |
|---|---|---|
| **§1 — generic signature fallback** | `installation.md` §5.1, **step 4 only**: the stage is established (or honestly unestablished), every catalog has been tried, and no entry's signature matched | what the error *class* means, what would identify a specific case, and how to say that none did |
| **§2 — delivery consultation** | `installation.md` §1a: there is **no incident** — someone is planning a delivery, or arguing with one that behaved as designed | the platform's actual rule and the supported procedure, with no evidence loop |

**The entry conditions live in the spine, not here** — by the time you are reading this file you have
already passed them, so nothing in it can hold you back. §1 in particular is the file the agent reaches
for too early: it is cheap, it always "fits", and reading it before the catalogs turns a curated
diagnosis into a lookup table. If you arrived here without having opened a catalog, go back.

**Not to be confused with the mechanism companions.**
`installation-catalog-data-bindings-reference.md` and
`installation-catalog-conflicts-reference.md` are opened *from their own catalog*, by an entry
that points at them, and they carry that mechanism's depth. This file is opened from the **spine** and carries
neither mechanism nor cases.

Case ids here are `IR1`–`IR12`. They are scratch vocabulary, like every other case id in this domain:
never write one in an answer.

---

## 1. Generic signature fallback — no specific case matched

Use this only as described above. Each row tells you three things, and the third is the one that keeps
the answer honest: **what the class means**, **what it does not tell you**, and **what evidence would
identify a specific case**.

### 1a. Database error classes

The two dialect columns are the same failure spoken by two engines — `installation.md` §2.2a
uses that pairing to establish *which* environment an incident happened on, and it applies here too.

| PostgreSQL | MSSQL / Oracle | What the class means | What it does **not** tell you | What would identify a specific case |
|---|---|---|---|---|
| `23503` — violates foreign key constraint | `547` — the statement conflicted with the `FOREIGN KEY` constraint (`FOREIGN KEY SAME TABLE` when the table references itself) | a record the write refers to is **not on the target** at the moment of the write | *which* record, and whether it was supposed to arrive with this delivery or an earlier one | the constraint's table plus the key value — PostgreSQL prints it on the `DETAIL` line, MSSQL names the table and column. Read that record by Id: an empty result **is** the confirmation. A self-referencing constraint on the schema table is a missing **parent schema**, not a missing lookup record |
| `23505` — duplicate key value violates unique constraint | `2627` / `2601` — violation of `UNIQUE KEY` / duplicate key row | the target **already holds** a row with that key | whether the existing row is the same record under a different Id, or a genuinely different one | the index name and the key value, then the row that already occupies it — same `Id` is a re-delivery, a different `Id` is a collision |
| `42P01` — relation "…" does not exist | `208` — invalid object name | the table or view the statement uses **does not exist at that point of the delivery** | whether it never existed or simply has not been created yet — the stage decides that | the stage (the spine's §3): before the DB-structure stage the object may legitimately not exist yet; after it, the object is genuinely absent. A view named here is usually the package's own SQL script running out of order (see **IR9**) |
| `42703` — column "…" does not exist | `207` — invalid column name | the statement uses a column the target's table does not have | whether the column is missing because the structure update was skipped, or because it was never delivered | read the object's current structure; a **repeated** install failing on a column the object visibly has is the skipped-structure-update reading, which `installation-catalog-data-bindings.md` owns |
| `57014` — canceling statement due to statement timeout / user request | `Execution Timeout Expired` (`-2`) | the statement was **cancelled**, almost always on a time limit | anything about correctness — a cancelled statement is not a wrong one, and the same delivery often succeeds on a quieter environment | what else was running, and what the statement was doing: a structure update on a large table, a concurrent load. This is environment capacity, not package content — which is the clearest signal that the fix is not a package change |
| `40P01` — deadlock detected | `1205` — chosen as the deadlock victim | two sessions blocked each other and one was killed | which session mattered — the victim is picked by the engine, not by importance | whether something else ran at the same time: another delivery, a compilation, a heavy integration. Deliveries are not safe to run in parallel, and establishing that is the first step |
| `53300` — too many connections | *(engine-level refusal)* | the database refused a **new connection**; the delivery never got as far as doing anything wrong | anything at all about the package | connection pressure on the environment at that moment. Nothing in the package or its bindings changes this outcome |
| — | `ORA-00054` — resource busy and acquire with `NOWAIT` specified | a structure change could not take its lock because **another session holds the object** | which session — the message names the object, not the holder | what else was touching that object: an open transaction, a long-running report, another delivery. Same family as the deadlock and the timeout: a concurrency answer, not a content answer |

### 1b. File-system and IO signatures

These arrive as .NET exception names in an installer log or a server log. They share one property worth
saying out loud in the answer: **the evidence that would settle them lives on the server's file system,
which is not readable from here.**

| Signature | What the class means | What would identify a specific case |
|---|---|---|
| `System.IO.FileNotFoundException` | a file the operation expected is not where it looked — most often the uploaded archive or a generated artefact | *which* file, and which stage asked for it. An archive missing at the very start of an App Hub install is frequently **not** an installation fault at all: `feature-flags-and-settings.md` carries a case where a feature gates the upload sequencing and the symptom is exactly this exception |
| `System.IO.DirectoryNotFoundException` | a directory on the path does not exist — a working/temp path, or a package folder | the path in the message, and whether the site runs on more than one node |
| `System.IO.IOException` — the process cannot access the file … because it is being used by another process | something holds the file: another delivery, an antivirus scan, a build | whether a second operation was running. Same concurrency family as the lock and deadlock rows above |
| `System.UnauthorizedAccessException` | the account the site runs under lacks rights on that path | the path and the account — both off-platform |
| `System.IO.PathTooLongException` | the composed path exceeded the file system's limit, usually deep inside a temp/working directory | the path in the message; the fix is environment configuration, not package content |

### 1c. How to answer when nothing matched

Three rules, and the first one is the whole point of this section.

1. **Say plainly that no specific case matched.** Not "this looks like a typical missing-record error" —
   *"none of the catalogued cases matches this signature"*, followed by what the class does mean. A
   reader who knows the answer is generic can weigh it; a reader who believes they were handed a
   case-verified diagnosis cannot.
2. **Do not force the incident into the nearest-looking case.** A dependencies answer to an unmatched
   conflict is worse than no answer, and the spine's §5.1 already forbids reporting from a catalog whose
   *Verify* did not confirm. Reaching this section means that discipline held — do not spend it here.
3. **Hand back the next evidence, not a recommendation you cannot support.** Name the read that would
   identify the case (the last column), say what it would prove, and keep the fix at the level the
   evidence supports: re-running the delivery, splitting it, or asking for the piece of evidence nobody
   here can read. State the confidence for what it is — a class-level answer.

The rest of the report is unchanged: the spine's §8 still owns the shape, the stage and the outcome are
still stated, and §6's restore question is still answered explicitly.

---

## 2. Delivery consultation — questions that are not incidents

Nothing here is a failure to root-cause. These are the recurring questions about **how delivery works**,
and about half of them are platform rules nobody can guess — which is exactly why the answer has to be
the rule, including the unwelcome ones, rather than a hedge.

**The shape of these answers is set in `installation.md` §1a**: the rule first, the supported
procedure as manual steps, and a plain statement that the answer comes from documented platform
behaviour rather than from a read of the environment. No evidence table, no root cause, no restore gate.
Where an entry names a read, it is **corroboration of this environment's own state — something to offer,
not to take unasked**: label it for what it is, and never let it grow into an investigation nobody asked
for. "This environment" means the
one the agent is connected to, which is not necessarily the one the user is asking about: offer a read on
that condition, as `installation.md` §1a spells out.

**No `ConfActivityLog` read belongs to an answer from this half.** Nobody reported a failure, so the
activity log holds nothing about the question — and whatever delivery it does hold belongs to a question
nobody asked. Looking anyway costs a round-trip and reads, to the user, as the agent not having
understood them. That holds even for **IR7**, where the user asks about a specific run they lost sight
of: the rule answers it completely, and there is nothing to read.

Every procedure below is a **manual step for a human**. That includes every line of SQL: this agent does
not execute scripts, and does not offer to.

### IR1 — "We need to move only part of a package"

*The most frequent question in this file.*

- *The supported way, first:* on the **source** environment create a package carrying the dependencies
  the elements need, move the wanted elements into it with **'Move to another package'**, then export and
  install that package. That delivers one page and two processes without carrying the rest.
- *The rule:* **partial installation does not exist.** A package installs as a whole — there is no
  "install these three elements out of it". Say this plainly; it is the part users keep looking for a way
  around.
- *A package is identified by `Name` + `UId` from its descriptor*, not by the target's record Id: if a
  package with that identity is already on the target it is **updated in place**, otherwise it is
  installed as new. So never rename a package or regenerate its `UId` between environments — that turns
  an update into a second, parallel package.
- *Corroborating read (optional):* `SysPackage` filtered by `Name`, projecting `Name`, `UId`,
  `Maintainer`, `Version` — it answers "does this environment already hold that package, and under which
  `UId`", for the connected environment only; it says nothing about a target the agent is not connected
  to. `[observed]` — the projection is confirmed on a live environment; `rca-env-readonly-query`'s
  "Packages and their dependencies" owns it, including the duplicate-name reading.
- *The misreading to head off:* "we will install everything and delete the extra elements on production
  afterwards." Deleted elements return with the next delivery of the same package, and deleting on the
  target is exactly the drift `installation-catalog-conflicts.md` exists for.

### IR2 — "Do I just export and install the updated package again?"

- *The rule:* yes — export from dev, install onto the target, repeat for every change. The same `Name` +
  `UId` means the package is updated in place (**IR1**), so there is nothing to uninstall first.
- *Procedure:* develop and test on dev → export → install on pre-production → verify there → install on
  production. Keep changes on one environment: editing the same elements on the target while deliveries
  arrive from dev is how a package stops installing cleanly.
- *If they have already edited the target:* that is no longer a consultation. A locally modified element
  blocks the incoming one, and `installation-catalog-conflicts.md` owns it. Which elements are
  locally changed is readable only per element (`rca-env-readonly-query`, "Schema state on the target") — do not
  assert it about their environment in general.
- `[unverified here]` for the flow itself — it is documented platform behaviour, not something reproduced
  on a connected environment. What corroborates the in-place part is **IR1**'s identity read: the same
  `Name` + `UId` already on the target — available only when the target is the environment this agent is
  connected to.

### IR3 — "Do packages inside one archive need to be ordered by hand?"

- *The rule:* no. The installer reads each package's declared dependencies and installs in dependency
  order — packages with none first, dependents after. Ordering the archive does nothing.
- *The exception that does stop it:* a **cyclic** dependency. The installation halts, and the cycle has
  to be broken by removing a dependency — a decision for the package's owner, never for this agent.
- *Corroborating read:* the dependency graph **stored on this environment**, via `rca-env-readonly-query`'s
  "Walking the dependency graph — finding a cycle". Report a cycle as an ordered path (`A → B → C → A`);
  "there is a circular dependency" is not an answer. `[observed]` for the walk, which was measured on a
  real configuration.
- *One caveat for file-system development:* a package's declared dependencies can be stale relative to
  what is on disk, so a cycle read from the environment may not be the cycle the delivery hit. Say which
  one you read.

### IR4 — "Why is this package read-only, and where did a package with a random name come from?"

Two symptoms, one mechanism: the environment decides **whose** packages may be edited here.

- *The rule:* a package is editable only when its maintainer matches this environment's own maintainer
  value. A package delivered by a vendor — or by another customer's environment — carries a different
  maintainer and is shown read-only: the "grey" package. By design, and not corruption.
- *What to offer, if they want to see it on their own environment `[observed]`:* the system setting
  whose **code** is `Maintainer` (its display name is **Publisher**) holds the environment's value, and
  `SysPackage.Maintainer` holds each package's. On the reference environment the setting read `Customer`,
  locally made packages read `Customer`, and product packages carried the vendor's name — that
  comparison, and nothing else, is the claim.
- *Do not use `SysPackage.IsLocked` for this.* Its polarity is not established: on the reference
  environment the one package with `IsLocked = true` was the package that is editable there, while every
  delivered package read `false`. `rca-env-readonly-query` carries the full caution — quote those flags as
  read values, never as a verdict. (`SysSchema.IsLocked` is a different column with a settled meaning;
  keep the two apart.)
- *Where the randomly named packages come from:* when a designer change has nowhere to go — the
  application has no unlocked package whose maintainer matches this environment — the platform creates
  one and saves the change into it. The names look random because the suffix is generated; both
  `App_<suffix>` and `<PackageName>_<suffix>` shapes occur. `[observed]` in a real delivery log, whose
  package list carried several of each shape. Standard behaviour, not damage — but it does mean
  customizations are landing somewhere nobody chose.
- **Do not look the quoted name up.** A name like `App_8rcxi7x` in the question is the shape, not a key:
  the suffix is generated on the environment where the change was saved, so it is not on any other, and
  a hit on this one would add nothing the rule does not already say. Recognising the shape *is* the
  answer.
- *Procedure:* create (or unlock) a package whose maintainer matches this environment's setting value;
  set it as the application's **current** package through the *Package in installed application* lookup;
  make the changes there. Never edit a vendor's package. If the **developer shown on the application** is
  wrong, that is a separate field on the installed-application record and is corrected in its lookup.
- *Where the procedure's lookup lives `[observed]`:* `SysPackageInInstalledApp` links `SysPackage` to
  `SysInstalledApp` and carries the `Primary` and `Current` flags — that is the lookup the procedure
  means. The developer shown on an application is `SysInstalledApp.Maintainer`. Offer to read them for a
  named application only on the connected environment's terms (the spine's §1a).
- *Cross-reference:* this entry **owns** the Publisher/Maintainer rule and the auto-generated packages
  for the whole knowledge base. App-Hub-shaped questions that land on
  `feature-flags-and-settings.md` point here instead of restating it.

### IR5 — "We bound the role table to the package and the install fails"

- *The rule:* **do not bind the role tables to a package.** Role records are validated against the role
  hierarchy as they are inserted, and a role arriving without a valid parent on the target is refused.
  The signatures that come with it are `Cannot add root administering unit. Invalid unit type specified`,
  the `InvalidRootType` exception name, and — as a downstream effect of the refused insert — a rollback
  message complaining that there is no corresponding transaction start.
- *Corroborating read `[observed]`:* `SysAdminUnit` projecting `Name`, `ParentRole` and
  `SysAdminUnitTypeValue` shows the hierarchy the platform validates against: organizational and
  functional roles sit under a parent, and the rows with no parent are service units rather than roles. A
  role landing with an empty parent is exactly the state the platform rejects.
- *Procedure — manual, and a human runs every step:*
  1. On the source, generate `INSERT` statements for the roles and rights that must travel: the role
     records themselves, user-to-role and functional-role-to-organizational-role membership, the granted
     rights, and the object / record / column permission rows. Add the workplace membership tables when
     workplaces travel too. `[observed]` that these objects exist and are readable here — `SysAdminUnit`,
     `SysUserInRole`, `SysFuncRoleInOrgRole`, `SysAdminUnitGrantedRight`,
     `SysEntitySchemaOperationRight`.
  2. Attach the script to the package's SQL-scripts tab, or run it separately on the target.
  3. Never create a role with an empty parent — every role goes under a valid parent node.
  4. Rehearse on pre-production, with a backup, before production.
- *When they quote the failure too:* "we bound it and the install fails with `Invalid root type`" is not a
  reason to open the installer log. They have named the cause and quoted its documented signature, so
  this entry is the diagnosis (the spine's §1a, the exception for a failure the user has already
  explained). Answer from it; the closing offer covers a failure that turns out to be something else.
- *The boundary:* this agent reads. It does not run scripts, does not compose one against a live
  environment on its own authority, and does not offer to execute one.

### IR6 — "How do we move email templates so that macros and images survive?"

- *The rule:* the template travels as bound data, and so must everything it points at. Bind the template
  records (including their localized rows), the content blocks, and the **image records** both of them
  reference.
- *Corroborating read `[observed]`:* the template's preview image and the content block's image are both
  lookups onto the image storage object — `EmailTemplate.PreviewImage` and `ContentUserBlock.Image`, each
  referring to `SysImage`. That is why an unbound image surfaces as a foreign-key error at the data
  stage, naming the image table.
- *Procedure:* actualize the bindings before export, and rehearse the install on a test environment — the
  failure mode stays invisible until the data stage runs.
- *Cross-reference:* once this **has** failed it is an incident, not a consultation: a foreign key at the
  data stage belongs to `installation-catalog-data-bindings.md`, which owns the read that names the
  missing record. Do not answer that from here.

### IR7 — "My internet dropped during the install or compilation — did it crash?"

- *The answer:* **no.** Installation, compilation and source generation run **on the server**; the browser
  only displays their progress. A dropped connection, a closed tab or a vanished progress bar does not stop
  or reset them.
- *One thing worth adding:* do not start it again — a parallel run of the same operation is harmful.
- ***That is the whole answer.*** No procedure, no read, and no "go and check its status". The
  configuration activity log is not a progress monitor: its section does not open while a compilation is
  running, and a compilation's record has no running state — it is written as `Success` when the build
  starts and changes to `Error` only if the build fails. Sending the user there to "see whether it is still
  running" describes a view that does not exist. `[unverified here]` for that status behaviour — not
  reproduced from a read; watching one compilation's record from start to finish would settle it.
- `[unverified here]` as a causal claim — nothing readable from here proves where the work executes; this
  is documented platform behaviour, and the answer says so.

### IR8 — "The log says `Modified` for our schema, but production runs the old version"

- *The rule, and it generalizes:* **`Added` / `Modified` / `Not changed` lines are the installer
  comparing the incoming packages against the target — a plan, not an outcome.** The writing happens
  afterwards, and whether it succeeded is at the *end* of the log.
- *What the block looks like `[observed]` in a real delivery log:* it opens with the installer matching
  source against receiver, followed by the composed package list and a `Not changed packages:` line, and
  then one line per element in the shape `Modified - schema '<Name>' in package '<Package>'` (also
  `Modified - package '…'`, `Modified - data schema '…' in package '…'`, `Modified - files in package
  '…'`). In that same log the delivery then failed with a foreign-key error while schemas were being
  saved, and the elements listed as `Modified` were **not** applied — which is precisely the situation
  the user is describing.
- *Position is the discriminator, not vocabulary* — knowledge for **your** reading of the log; it goes
  into the answer only if the user asks how to tell the plan from the fact. The same `Added -` / `Modified -` wording appears
  again later, after each `Package "…" saved`, for a package's dependencies, resources and caption
  localizations — those belong to the package-commit stage (the spine's §3). The comparison block is the
  one that sits **before** the first write marker. Quoting style differs between delivery mechanisms too
  (double quotes in an Application Hub log, single quotes in a repository / console log), so never decide
  anything from the quotes.
- *The answer has three parts, and the third is the one that gets lost:*
  1. `Modified` in that section is the package comparison result — a plan; the installation itself happens
     later.
  2. Read the summary and the errors at the **end** of the log.
  3. If the schema was not applied, look for the cause in three places, and name them:
     - the schema's **`IsChanged` / `IsLocked`** on the target — a local edit or a lock keeps the incoming
       version out (`installation-catalog-conflicts.md` owns that case);
     - the schema's **modification time** against the time of the install — if it did not move, the install
       never wrote the schema. Support material calls this `ModifiedOnUtc`; the column readable on the
       environment is **`SysSchema.ModifiedOn`** (`MetaDataModifiedOn` sits next to it) `[observed]` — there is
       no `ModifiedOnUtc` column to read, so do not quote that name as one;
     - the **errors further down the log**, after the comparison block.
  "Changed locally or locked" is not a substitute for naming the flags: the flags and the timestamp are what
  the user can actually check. If the log ends cleanly and the schema still did not arrive, this stops being
  a consultation: it is the spine's "completed, but the delivered changes were not applied" outcome, whose
  usual causes are those flags (`installation-catalog-conflicts.md`) and a binding that was never
  going to install here (`installation-catalog-data-bindings.md`).
- *The sentence to avoid:* "the logs are lying". They are not — they are answering a different question
  than the reader assumed.

### IR9 — "We are moving a database view and it is not recognized as a view"

- *The rule:* two different things have to travel, and only one of them is a schema. The **wrapper
  object** — the view object schema the platform reads through — travels in the package like any schema;
  the **database view itself** does not. It is created by the package's own SQL script.
- *Corroborating read `[observed]`:* view wrapper schemas are ordinary schema records owned by a package
  — the reference environment holds well over a hundred of them, each with its own package. So "the
  schema arrived" and "the view exists in the database" are two separate facts, and the message the user
  quotes is the second one failing.
- *This entry's own signatures:* `"<Name>" is not recognized as a view`, and `42P01: relation "…" does
  not exist` (MSSQL: `Invalid object name`) raised **inside the view's SQL script**. They are the
  documented result of delivering a view, so a user who says they are moving a view and quotes one of them
  has explained the failure: answer from this entry (the spine's §1a, the exception for a failure the user
  has already explained) — no record to fetch, no log to read. `[unverified here]` for the exact wording of
  the first message: it comes from support material and has not been reproduced from a read.
- *Procedure:* deliver the view as a SQL script inside the package (`CREATE OR REPLACE VIEW`, or the
  target engine's equivalent), keep the wrapper object's name identical to the database view's, and make
  sure everything the view selects from is created **earlier** — script order inside the package, and
  package order across the delivery.
- *The error text says which step was missed:*
  - **"not recognized as a view"** — the wrapper arrived, but no database object carries its name: the
    package has no script creating the view, or the script names it differently from the wrapper;
  - **`42P01` / `Invalid object name` naming another object** inside the view's script — something the view
    selects from was not created yet: the script runs before the one that creates its base object, or that
    object's package installs later.
- *When it is not this entry's case:* the same codes naming an object that has nothing to do with the view
  are an ordinary SQL-script failure — an incident. Route it through the spine, which sends a missing
  prerequisite to `installation-catalog-dependencies.md` and a target-structure mismatch to
  `installation-catalog-conflicts.md`.

### IR10 — "We cannot upload our 400 MB package"

- *The rule:* the Application Hub refuses packages above **300 MB**. It is a limitation of the system —
  on cloud an intentional one — and it is not raised on request. `[observed]`: 300 is the value the
  reference environment's configuration holds.
- *Say it as a system limitation, and name no setting.* The user cannot change the limit, so naming the
  configuration it lives in only reads as an invitation to change it — the answer then contradicts itself.
  Nothing on the environment needs reading for this answer either.
- *Procedure:* split the package into smaller packages and install them in dependency order (**IR3**
  covers the ordering, **IR1** covers moving elements between packages). Where a split is genuinely
  impossible, a scheduled installation arranged with support is the remaining route. To find what makes
  the archive heavy, unpack it and look — it is usually accumulated binaries or bound data rather than
  schemas.

### IR11 — "If we bind the system settings to a package on production, are their values protected?"

- *The rule:* **no.** A binding is not a lock. Setting values live in the database, and the last delivery
  carrying a binding for that setting writes it, whichever package the binding sits in. Binding the
  setting on the target changes nothing about what an incoming package may overwrite.
- *Procedure:* bind the setting's **definition** when it has to travel; never bind environment-specific
  **values** — production URLs, credentials, endpoints — into a package that moves between environments.
  Configure those directly on production after the delivery, and keep dev/test values on dev/test.
- *Corroborating read:* the setting's current value — the *All employees* row of `SysSettingsValue` — and
  its per-user / per-role rows (`rca-env-readonly-query`, "System settings"). That answers "what is
  it right now", which is usually the real question underneath.
- *Cross-reference:* when a value **has** been overwritten by a delivery, that is
  `installation-catalog-data-bindings.md`'s business — it owns the reads that show which binding
  carried it.
- `[unverified here]` as a causal claim: a binding overwriting a target's value was not reproduced on a
  connected environment. What would settle it is a delivery carrying a binding for a setting the target
  also binds, read before and after — which is a test, not a diagnosis, and belongs on a stand rather
  than in an answer.

### IR12 — "Can we move the Custom package to another environment?"

- *The rule, with its version:* since **8.3.2.4199** the Custom package transfers like any other package.
  Below that build, treat it as non-transferable. Answer with the version rather than a flat yes or no: a
  flat "yes" is wrong on an older environment, a flat "no" is wrong on a current one.
- *The build is not readable from here `[observed]`:* no system setting carries it and no readable object
  exposes it — the reads that would have answered it come back empty or unknown. Ask the user for the
  version the product shows, and say why you are asking.
- *The recommendation holds either way:* keep new work in dedicated packages, and move existing content
  out of Custom gradually with **'Move to another package'**. Custom being transferable removes an
  obstacle; it does not make one package for everything a good arrangement.

---

## 3. Three rules worth stating on their own

Each is the general form of an entry above. They recur far outside the question that raised them, so
state the rule whenever it applies — not only when someone asks the original question.

- **A comparison line is a plan, not a fact.** Anything the installer prints while comparing packages
  describes what it *intends* to do; the outcome is at the end of the log (**IR8**).
- **Delivery work runs on the server.** Installation, compilation and source generation do not depend on
  the browser that started them, so a lost tab is not a failed operation — and restarting "to be sure" is
  the one action that can turn a healthy run into a broken one (**IR7**).
- **Binding does not protect.** Putting something in a package controls what *travels*; it never controls
  what may overwrite it on arrival (**IR11**).

---

## Boundaries (this file's coverage)

**Covered:** the generic database and file-system signature classes (§1), used as a fallback once the
catalogs have been searched; the twelve delivery consultation topics (§2, `IR1`–`IR12`) — the **`Consultation`** category; and the three rules in §3.

**Not here:** every signature-matched case. Those live in the four catalogs, and the spine's §5.1 sends
you to them first; the generic table is not a shortcut past them.

**Not covered anywhere yet:** the infrastructure and environment family (disk, permissions, timeouts, web
farm, cloud delivery preparation) and WorkspaceConsole's own failures. §1's rows will often be the best
available answer for those — say so explicitly rather than letting the answer imply that a catalog stood
behind it.

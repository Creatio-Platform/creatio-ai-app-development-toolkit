# Domain: Installation (spine)

How to analyze a Creatio **package / application installation** — a "delivery" — that failed, applied
only part of itself, or reported success while changing nothing.

This file is the **spine**. It owns the evidence protocol, the stage and outcome classification, the route
into the per-mechanism catalogs, and the restore gate. It owns **no error signatures**: those live in the
catalogs, and each catalog is opened only from §5, after a stage has been established.

| Catalog | Covers | Case ids |
|---|---|---|
| `installation-catalog-data-bindings.md` | data / binding failures at the data stage | `IB*` |
| `installation-catalog-localization.md` | culture and localized-resource failures | `IL*` |
| `installation-catalog-dependencies.md` | missing packages, parent schemas, install order | `ID*` |
| `installation-catalog-conflicts.md` | locking, local edits, name/UId clashes, target DB structure, drift | `IC*` |
| `installation-catalog-infrastructure.md` | **the environment refused** — database, locks, concurrency, downtime, transport, farm, cloud preparation, side effects, closed infrastructure | `IE1`–`IE13`, `IE27` |
| `installation-catalog-infrastructure-files.md` | the same family's second half — directories, locked files, permissions, disk, the archive, static content, WorkspaceConsole | `IE14`–`IE26` |

**One more file, and it is not a catalog:** `installation-catalog-reference.md` is opened from
this file by **two routes that have nothing to do with each other** — §5.1's step 4, once every catalog
above has been tried and nothing matched, and §1a, when there is no incident to investigate at all. It
holds no signature-matched cases and never takes part in the §5.1 search.

> **The infrastructure pair is one catalog in two files, and it is the one family no stage owns.** An
> environment failure interrupts whichever stage was running, so it is reachable from **any** of them — and
> from none, when the delivery never produced a stage at all. Its tier rule and its routing table live in
> the first file's §0 and §1; the second file does not repeat them and must not be answered from alone.

**Beside the catalogs sit the mechanism files. They hold no signatures at all** — they explain how a
delivery behaves, so a verification can prove what happened instead of guessing. Between them they cover the
whole domain, and none of them restates another:

| Mechanism file | Owns |
|---|---|
| `installation-pipeline-reference.md` | **the run** — channels, working directories, the stage order and its markers, what is committed when it fails, the retry markers left on the environment, backup & restore, timeouts, the farm, and what must be regenerated before the UI changes |
| `installation-artefacts-reference.md` | **what is installed** — schemas and sources, SQL scripts, database structure, bound data, resources, install scripts, files and assemblies: the order each obeys, the lines it writes, and the read that proves its state |
| `installation-applications-reference.md` | **the layer above packages** — applications and their records, pre-install dependency resolution and its refusals, optional and plugin packages, deletion rules, install status and the uninstall-then-install recovery, editability, the three version gates |
| `installation-workspaceconsole-reference.md` | **the command-line channel** — its own log and exit codes, the switches that silently deliver half a package, and the four reasons a console-driven delivery leaves the UI on the previous version |
| `installation-clio-reference.md` | **the API-driven command-line channel** — which of its operations the environment records, what it leaves undone unless told, and why a client-side error is not evidence the delivery failed |
| `installation-catalog-conflicts-reference.md` | **the per-element decision** — the five outcomes, the protection flags, matching by `UId` |
| `installation-catalog-data-bindings-reference.md` | **the binding's installation type**, and what the pre-install validator reports |

All of them are opened **on demand, never swept**: read one when a verification needs to know *why* the
delivery behaved as it did, not to look for something recognizable. **None may be reported from on its own
authority** — they tell you what to read; the environment tells you what happened.

> **One stage routes outside this family: compilation.** A delivery whose build failed is diagnosed with
> the compilation domain's own material — `compilation.md` for the mechanics and
> `compilation-catalog-cases.md` for the signature — inside this file's framing. **§5.2** owns
> that hand-off, and the question that has to be answered before any cause is named: did the delivery
> break the build, or find it already broken?

Pattern: **signature → evidence (the installation log) → stage → outcome → catalog → restore gate → report.**

> **Why evidence comes before classification here** — `compilation.md` classifies the outcome
> first and gathers evidence second, because a compilation's outcome is readable off one structured
> detail table. An installation's is not: the same "finished with errors" record can mean a blocked
> validation, a half-applied structure update, or a clean install whose changes were silently skipped —
> and only the installation log separates them. Do not reorder these sections to match the compilation
> domain; the order is the point.

---

## 1. Signature — does this domain apply?

Open this file when the incident is a **delivery**: a package or application was installed, updated,
reinstalled or uninstalled — through Application Hub, a zip upload, WorkspaceConsole, clio or a CI/CD
action — and something went wrong during or after it.

**The discriminator is the operation that was running, not the shape of the error text.** An error raised
**during an installation** belongs here even when it reads like a compiler or database error:

- `CS0246` / `CS0103` / `CS0234` raised while a package was installing is the **compilation stage of an
  installation**, not a compilation incident;
- `23503` / `23505` / `42P01` / `ALTER TABLE … conflicted` raised while a package was installing is a
  stage of an installation, not a standalone database problem.

Signals that the operation was an installation: a `ConfActivityLog` record whose `Operation` is one of
the delivery operations (see the caption note in §2.1 — **the exact captions differ between versions**,
and `Install data` / `Install SQL Scripts` are the ones that show up on every stand); an
`install_<yyyyMMdd_HHmmss>.txt` attachment; a `Compilation` record whose `Parent` is one of those
operations; or the user simply saying they were delivering something ("we moved a package to prod",
"the app import failed", "the TeamCity delivery action failed").

**Boundary with `compilation.md` — one-way, and this direction only.** When a compilation ran
**as a stage of an installation**, this file owns the incident: it reuses the compilation domain's
mechanics for reading `CompilationHistory.ErrorsWarnings` (the `IsWarning` partition, the outcome
vocabulary) but reports inside the installation narrative, because the fix is almost never "correct this
line" — it is "the delivery was incomplete". A compilation that ran **on its own** (no install parent,
someone pressed Compile) is not this domain: route to `compilation.md` and do not carry install
framing into it. When the compile *did* run under a delivery, **§5.2** is where this file hands over —
after the gate there, not before it.

**A pasted log excerpt with no record is first-class evidence.** Many deliveries fail before the platform
records anything (a rejected upload, a CI/CD action that never reached the site), and some environments
are simply not reachable from here. Match what the user gave you and say plainly which parts of §2 you
could not run.

**The commonest of those is an Application Hub upload refused at validation** — the archive never reaches
the installer, so nothing is recorded and the user still calls it a failed installation. **§2.1a** covers
it: what to ask the user for, what the platform can still tell you, and which settings make a healthy
archive look broken.

**And some delivery questions are not incidents at all** — a move being planned, or a delivery that did
exactly what it was designed to do. They arrive here too, and they take a different route through this
file: **§1a**, immediately below.

### 1a. Not an incident — a delivery question

Some of the delivery traffic that reaches this file has **nothing broken in it**. Someone is planning a
move and wants to know how ("we need only part of a package on production"), or a delivery behaved exactly
as designed and they are arguing with the design ("binding the settings did not protect them"). These are
questions about the platform's rules, and the rules are the answer.

**The test, and it is one question: is there something to investigate?**

- The message names a failure, an error, a record, or a symptom that appeared after a delivery → this is
  an incident. Continue with §2 and ignore the rest of this section.
- The message asks how delivery works, whether something is supported, or why the platform did the
  documented thing → **go straight to `installation-catalog-reference.md` §2**, which holds the
  twelve consultation topics.
- **The exception to the first bullet: a failure the user has already explained.** The message says what
  they did *and* quotes the error a consultation entry lists as the documented result of exactly that —
  "we bound `SysAdminUnit` to the package — install fails with `Invalid root type`". Then the entry is
  the whole diagnosis: the cause is stated, the signature confirms it, and nothing on an environment would
  add to either — while the environment it failed on may not be the one you are connected to. Answer from
  the entry, and let item 5's closing offer cover the case where the failure turns out to be something
  else. Keep this narrow: the user must name the cause, and the quoted error must be the entry's own
  signature for it; an error on its own, or one the entry does not list, is an incident.
- **A second exception: the question is what a log line means.** "The log says `Modified` for our schema,
  but prod runs the old version — are the logs lying?" names a symptom, but what it asks is the meaning of
  the line the user quotes as proof of an install, and the consultation entry for that line answers it
  completely: the rule, the end of the log, and the three places to look when the schema did not arrive.
  Answer from the entry — nothing on an environment tells the user what their log line means — and let
  item 5's closing offer cover the incident that may sit behind it.

**When the message reads both ways, answer the rule and offer the investigation.** Ambiguity is common
("we need to move part of a package — it didn't work out for us") and the two mistakes do not cost the
same. Answering a consultation with an investigation spends reads on a delivery nobody asked about and
reads, to the user, as not having understood them; answering an incident with the rule costs one turn,
which the user closes by naming what failed. So default to this section's shape, and **close with one
line offering the other route** — item 5 of the answer's shape below gives that line and the condition
it must carry. That line is the recovery, and it costs nothing.

**Ask a question only when the two readings would produce materially different answers**, and the offer
line cannot carry it — a message holding both a rule question and a failure, where answering only the
rule would leave the failure unexamined. Then ask one question ("has this already failed, or are you
planning the move?") and nothing else. **Never settle the ambiguity by querying the environment**:
looking for a recent failed delivery to decide what the user meant is exactly the round-trip this route
exists to avoid, and the delivery it finds is as likely to be someone else's as theirs.

**What you skip, deliberately:** the evidence protocol (§2), the stage (§3), the outcome (§4), the
catalog search (§5) and the restore gate (§6). There is no record to find, no log to read and no stage to
establish, so running them produces the *appearance* of rigour over a question that never needed it — and
a fruitless hunt for a record reads to the user as "the agent could not find my problem".

**When the topics answer the question only in part, or not at all, the documentation completes it.** The twelve
topics cover delivery *rules*. They do not hold the installation procedure for every application, add-in
or component the product ships, and a question like "what are the steps to install X" is often about
exactly such a thing — sometimes one that is not installed into Creatio at all (a desktop add-in such as
the plug-in for Microsoft Word is set up on the user's computer). Check whether any topic **names the
thing asked about** — a component the product ships. A name the user gives for **their own** package, schema or setting is not that thing — it is an
example of a kind, and the topic that covers the kind answers it. Then check the question part by
part — supported or not, the steps, the requirements, what to do if it hangs. If a topic answers every
part, answer from it. If it answers some, answer those and open `rca-academy-lookup` for the rest, and give the user
both, each with its source. If none does, do not assemble the procedure yourself: open `rca-academy-lookup`. On this route
its gate is already met — the route reads no log by design, and the consultation topics were read
without one fitting. A procedure written from general knowledge and labelled "documented platform
behaviour" is the worst answer this route can give: it carries the label that tells the user to trust it.

**The answer's shape — and it is not the incident report.** `rca-diagnosis-report`'s Summary/Recommendation
discipline still applies to how you write, but the report's sections do not: there is **no evidence
table, no root cause, no consequences, no restore answer and no confidence tier**, because a consultation
answer has none of those things and inventing them is the failure mode this section exists to prevent.
Answer in this order instead:

1. **The rule**, first and plainly — including when it is the unwelcome one ("partial transfer does not
   exist", "no, a binding does not protect a value"). Lead with the supported alternative where there is
   one; a refusal that arrives before the alternative reads as a dead end.
2. **The supported procedure**, as numbered **manual steps for a human**. Never a workaround when a
   supported route exists, and never a step this agent would perform itself. The steps come from the
   entry, or — when no entry has them — from `rca-academy-lookup`, tagged as documentation; never from general
   knowledge.
3. **A version, when the rule has one.** "Yes since <version>" is an answer; a flat yes is wrong on an
   older environment.
4. **Where the answer comes from** — one sentence saying it is documented platform behaviour rather than
   a read of this environment. That sentence is what keeps a consultation answer honest.
5. **The closing offer, and its condition in the same sentence.** Whenever the answer ends by offering to
   look at a specific run — always, when the message reads both ways — the offer is **conditional on the
   connection**: this agent reads only the environment it is connected to, and the user's environment
   may not be that one. Shape, in the user's language: *"If it has already failed, paste the installer
   log and I'll work out that specific run. If that install ran on the environment I'm connected to, the
   log record number is enough."* The log comes first because it is evidence from any environment; the
   record number is never offered without that condition, and neither is a check of an environment the
   user named ("testing", "prod").

**Default: no read — offer one instead.** A consultation is answered from the rule, and the rule is the
same on every environment. Where seeing the user's own state would help — which packages exist, what the
maintainer value is, what a setting holds — the reference file's entry names the read: **offer it** (with
the condition below) and take it only when the user accepts, or when the question is explicitly about the
environment you are connected to. Then label the result as the state of *that* environment, and keep it to
one or two reads; a consultation that has run six is an investigation nobody asked for.

**A name in the question is an example, not a lookup key.** "Where did a package like `App_8rcxi7x` come
from?" asks about a *kind* of package. Searching for that name answers nothing: it lives on the user's
environment, which may not be yours; not finding it proves nothing; and finding it would add nothing the
rule does not already say. The same holds for a schema, a setting or a role quoted to illustrate a
question. Answer the shape.

**You read one environment: the one this agent is connected to.** The environment a user names — "our
testing", "prod", "dev" — is frequently a different one, and nothing in a consultation tells you which. So
an offer to check anything carries that condition in the same sentence: *"if testing is the environment
I'm connected to, I can check whether it already holds this package and under which `UId`"* — never *"I
can look at your testing"*, which promises a read that may not be possible. If an earlier read in this
conversation already showed which environment you are on, name it; do not spend a read only to find out.
The same condition governs a read you take: it is evidence about the connected environment, and the
answer says so rather than letting it stand for the one the user meant.

**The boundary works in both directions.** If a consultation turns out to have a failure inside it — they
mention the install errored, or the record shows it did — stop consulting, say so, and run §2 onward. And
if an incident you *did* investigate turns out to be expected behaviour, keep the report you owe for the
evidence you actually gathered, and let the rule be the explanation: an investigated incident does not
lose its evidence section just because the answer is "this is how it works".

## 2. Evidence protocol — the installation log is the source of truth

Every catalog under this spine depends on this section producing comparable evidence, so run it in this
order and cite what you read.

### 2.1 Locate the installation record

`rca-cal-read`, filtered by the **operation only**, any status:

```
objectCode: 'ConfActivityLog'
filters: { all: [ { field: 'Operation.Name', in: ['Install application or package','Install application','Install package from repository'] } ] }
orderBy: 'CreatedOn desc'
limit: 5
columns: ['Id','Number','Status','CreatedOn','CreatedBy','Parent','Element','PackageName','ApplicationCode','DurationInSeconds']
```

> **The operation captions differ between versions — filter on a set, never on one string.** Verified live:
> one environment spells the parent operation **`Install application or package`**, another **`Install
> application`**. `Install application or package`, `Install package from repository`, `Install data` and
> `Install SQL Scripts` were all read live from `ConfOperation`; `Install application` is kept for the
> version that spells it that way. Captions that no environment here has — an `Install package (zip)` or
> an `Uninstall*` operation — are deliberately **not** in the set: carrying a caption that matches nothing
> only makes an empty result harder to interpret. A caption this environment spells differently returns **zero rows silently** — it is not
> an error. So when this query comes back empty, read the lookup before concluding no delivery happened:
> `creatio_list_records` on `ConfOperation`, `columns: ['Id','Name']`, and match what is actually there.
>
> **And an empty result still does not mean no delivery happened.** Verified live: a product update ran on
> the reference environment producing **56 localization operations and 291 changed values** with **no
> parent row at all** — invisible to this query under any caption. Another environment carried 76 000
> `ConfActivityLog` rows, 5 004 of them `Install data`, with no install record and no attachments. Both
> delivery routes that *do* create a record — the application UI and `clio push-app` — always attach an
> installer log, so "a record without a log" does not occur; what occurs is **a delivery without a
> record**.
>
> When the caption query is empty, look for the delivery's **footprint** instead: a cluster of
> `Install data`, `Generation of runtime metadata of entity schema`, `Generate source code`,
> `Update database structure` or localization `Update` rows inside one time window. That cluster is the
> delivery. Report it as one — with its window and its operation counts — and say plainly that no parent
> record exists, so there is no installer log and no stage sequence to read.
>
> **An uninstall is logged as `Delete`; there is no "Uninstall" operation.** Verified live by removing an
> application and reading what appeared: the row is `Operation.Name = 'Delete'` with
> **`Type.Name = 'Application'`**, `Element` and `ApplicationCode` naming the app, ~45 s, 19 children, and
> **no attachment at all** — an uninstall leaves no `install_*.txt`.
>
> `Delete` on its own is far too broad to add to the set — it is one of the commonest operations there is
> (over a thousand rows in three days, mostly per-element). **The discriminator is the element type**, so
> an uninstall incident gets its own query rather than a wider caption list:
>
> ```
> filters: { all: [ { field: 'Operation.Name', op: 'eq', value: 'Delete' },
>                   { field: 'Type.Name',      op: 'eq', value: 'Application' } ] }
> ```
>
> `Type` is a lookup to `ConfElementType`. Because the uninstall carries no log file, everything you can
> say about it comes from the record and its children — there is no marker sequence to read.

Do **not** add `Status = Error`. The newest row's status is part of the answer, and a delivery that
"finished with errors" is frequently reported as `Success` at the top level while a child row carries the
failure — pre-filtering to `Error` hands you an older delivery, or nothing. When the user names a record
(Id / Number / link), read that one instead and skip the search.

**The newest delivery here is a candidate, not the incident.** Before adopting a row as the user's
delivery, match it to what they described: the application or package they named against `Element`,
`PackageName` and `ApplicationCode`, and — when they quoted one — the error against what the record and
its log actually say. A row that names a different application is someone else's delivery, whatever its
status and however recent: say that no delivery matching theirs is recorded here, and continue with
§5.1's paragraph on an incident that is not on the environment you are connected to. Never carry an
unmatched row into the report as "the latest relevant install". Measured: a run did exactly that — took
the newest failed install of an unrelated application, built an evidence section and a restore answer
around it, and reported it as the user's incident at "Likely" confidence, when nothing it read connected
the two. When the user named nothing to match on, say which row you took and that it is the newest, not a
confirmed match — and lower the confidence accordingly.

### 2.1a No record at all? The delivery may have been refused before it started

**Application Hub uploads the archive and validates it before any installation begins**, and a refusal at
that point writes **nothing** — no `ConfActivityLog` record, no `install_*.txt`, no child rows. §2.1's
search comes back empty and stays empty however you widen it. That emptiness is a **finding**, not a gap,
and it is the single most likely reason a user reports "the installation failed" while the platform has no
trace of it.

**The user's words will almost never say so.** They experienced an upload, a spinner and a red dialog, and
they report it as a failed installation. Nothing in that description distinguishes "refused before it
started" from "started and broke". Do not infer that a delivery ran just because the user says it did —
establish it from the record, and when there is none, consider this first.

> **Run the §2.1 search anyway, once.** The absence only becomes evidence after you have looked for the
> presence. What you must not do is keep widening the search, or read the empty result as "you are
> connected to the wrong environment" — that reading is also available and the two are indistinguishable
> from the search alone. Say which one you can and cannot rule out.

**The dialog is the only place the diagnosis exists — ask for it verbatim.** Nothing about this refusal is
recoverable from the platform afterwards: the detail lives in the browser, is gone when the user closes
it, and it is unusually rich. Ask the user to copy the whole modal as text, not to summarise it and not to
screenshot it, because the table is where the answer is. It carries:

> **Ask only once the empty search has earned it — this is not the opening move on every delivery
> incident.** Most installation failures run for a while and then break, and everything you need is in the
> installer log; asking that user to go and find a dialog is useless, and it reads as though you did not
> look. The gate is the evidence, not the wording: **§2.1 returned no record**. If a record exists, §2.2
> onwards is your route and the dialog is irrelevant.

- a **heading** naming the class of refusal;
- a **message** naming the application by code and stating whether the missing pieces could be retrieved
  automatically;
- a **table** — `Name`, `Type` (`Package` or `Application`), `Required version`, `Installed version`,
  `Licensing` — one row per blocking item. A `-` in `Installed version` means the item is absent here
  rather than present at the wrong version, and that distinction changes the fix.

**What the paste buys is a platform read, and that is why it is worth asking for.** Those names are the
one thing the environment can be questioned about: take each package or application from the table and
read it here, then report **which are genuinely absent and which are present at another version**. That
turns the user's account of a dialog into a fact about their environment, and it is the difference between
repeating their screen back to them and diagnosing it. Without the names there is nothing to read, which
is the whole reason the ask comes first.

#### Check the environment is configured to do that check at all

The analysis depends on a small amount of configuration, and when it is wrong a perfectly good archive
is refused. **These are readable with the allowed reads** — `SysSettings` + `SysSettingsValue` for the settings and
feature state per `rca-env-readonly-query` — so check them before you conclude anything about the archive,
and report whatever is off as a finding in its own right:

| What | Kind | Expected |
|---|---|---|
| `AppInstallerServiceApiUrl` | system setting | **set to a URL.** Empty means the environment cannot ask the installer service anything, so no dependency analysis happens |
| `UseAutoInstallDependencies` | feature | **on.** Off means missing dependencies are never resolved or pulled in automatically — a delivery that would have been completed for the user is simply refused |
| `UseApplicationDependencies` | feature | **on.** Off disables application-level dependency handling |
| `ConfigurationVersion` | system setting | the environment's platform version, which is what every version-compatibility verdict is measured against |

> **Say what you found either way.** If all four are right, that is worth one line — it rules out a
> whole class of cause and tells the user the refusal is about the archive, not their environment. If
> one is wrong, that **is** the finding, and it is an administrator's fix rather than a redelivery.

> The environment reaches that service over the network, so connectivity, a proxy or a timeout can
> produce a refusal that has nothing to do with the archive's contents. You cannot test that from here —
> name it as something for a human to check when the settings are right and the refusal still makes no
> sense.

#### What the answer should say

Nothing here was installed, so the restore gate answers itself — say it explicitly. Then name the blocking
items and what each one is, and give the fix the dialog's own columns point at: an item with no installed
version has to be **delivered first**, one installed at a different version has to be **aligned**. Say the
one thing you could not do — confirm what the source environment holds. And if the user has not pasted the
dialog yet, asking for it **is** the next step, worth saying why: the platform kept no copy of it.

### 2.1b A log with an error, but no record — the mirror image of §2.1a

§2.1a is the case with **neither** a record nor a log. This one is different and is diagnosed differently:
the user has an installer log, it plainly contains a failure, and §2.1's search finds no record for it.
**Do not conclude the record is missing until you have ruled these out, in this order** — they are ranked
by how often each turns out to be the answer.

**1. The two clocks.** The log's timestamps are the **server's local time**; the record's `CreatedOn` is
the other clock, and the offset is frequently hours. `[observed]` — measured at exactly +3 h on one
environment, where a log line at `14:47:30` belonged to a record stamped `11:47:30`. **A search filtered by
a time taken from the log therefore finds nothing.** Search without a time filter, ordered by `CreatedOn`
descending, and reconcile afterwards (§2.3 owns the reconciliation).

**2. The log is not this attempt's — in either direction.** The installer log is **one rolling file**: a new
upload session renames the previous one aside, and what the UI hands back is the current file. So a log
showing an error can belong to an **earlier** operation — the application-management UI is known to present
a previous delivery's log — **or to a later one**. `[observed]` — a record stamped `14:03` carried an
attachment written at `15:47`, an hour and three quarters afterwards, belonging to an attempt that left no
record of its own. *Settle it:* compare the log's timestamps against **this** record's `CreatedOn` plus its
`DurationInSeconds` (§2.3), and expect the mismatch to fall on either side.
> **A log from another attempt is a second incident, not just a matching problem — treat it as one.**
> The attached log may describe a failure that is **worse** than the one the record is about, and the
> record-anchored route buries it: the recorded delivery becomes "the" root cause while the other is
> mentioned in passing. Measured on a real run: the record held a dependency failure, the attachment held
> the environment refusing a database connection, and the second was reported as a footnote. Say plainly
> that there are **two** incidents, which one the requester is asking about, and what each needs.
> **Do not identify a log by the shape of its file name** `[observed]`. Attachment names are not uniform:
> the same environment produced `install_<yyyyMMdd_HHmmss>.txt` on one delivery and `install (47).log` on
> another, so a name carrying no timestamp says nothing about which run it belongs to. Match on the
> contents and the clock, not the name.

**3. The activity log was cleared.** The log file lives on the server's file system and survives; the
records are rows and do not. Clearing is itself a logged operation, so *settle it* by searching
`ConfActivityLog` for a clear-the-log operation around the time in question — it logs itself.

**4. The failure happened before any record is created.** Two shapes, and they differ in whether a log
survives:

- **Refused at upload** — a proxy size limit, a failed chunk. The installer is never reached, so there is
  no record *and* no installer log.
- **The platform could not write one** `[observed]`. A delivery that fails because the application cannot
  open its database dies at validation, and the records live **in that same database** — so the log is
  written to the file system and the record never exists. This is a real failure with a real log and a
  genuinely absent record, and it is the shape most easily mistaken for "the record is missing".
  The signature is the engine refusing the connection rather than a statement — see the infrastructure
  catalog's entry for it, which owns the mechanism and the recommendation.

**5. The filter, not the record, is missing.** Operation captions differ between versions (§2.1), and a
`Status = Error` filter hides deliveries that report `Success` at the top while a child row carries the
failure. Re-run the search without status filtering before believing the absence.

**6. It is not this environment.** The log came from one stand and the connection points at another. The
commonest of all in support, and the one this file warns about repeatedly.

**What to say in the report.** Name which of the six you ruled out and how. "No record exists" is a claim
about the environment; "no record matched the search I ran" is a claim about the search, and only the first
one is worth reporting — after the other five are eliminated.

### 2.2 Fetch the installation log

Use `rca-cal-file-read`. Its allowlist is already authoritative here: the `install_<yyyyMMdd_HHmmss>.txt`
(and the `backup_*.zip`, which is **never** fetched) hangs on the **parent** row of the delivery
operation (§2.1's caption set). A `Compilation` record has no files of its own; if its `Parent` is an
install operation, the log is on that parent.

The **child** rows carry the per-element artefacts instead — for a `Data` element, the binding's delivered
rows. That is a separate read with its own section (**§2.4a**), and on a data-stage failure it is often
where the answer is. The sentence above answers "where is the log"; it is not a reason to stop at the
parent.

**Read discipline for an installer log — it depends on the size, and the two rules do not conflict.**
A **small** log (single-digit KB, a few dozen lines) is read **whole, in one unfiltered call**: filtering it
costs a round-trip and hides the surrounding lines that do the bracketing. That is `rca-cal-file-read`'s general
rule (whole at or under 800 KB) and it stands. Verified live: a 2 878-byte log read whole gave the error,
its stack and the full stage sequence in one call.

**Filter first only when the log is large enough that a whole read is wasteful or unsafe** — a real
app-install log runs to ~120 KB and 1 100+ lines, and there the two filtered calls below beat reading it
all:

1. `filterLinesWithText: "Error occured"` — the error marker, misspelled with a single `c`. It is the
   reliable key because it is emitted for **every** failing element, whatever its type. The correctly
   spelled `Error occurred` is a **different message**, not an absent one — it belongs to the data-install
   and SQL-script stages and matches its own lines there; the marker table in §2.5 gives both. Search for the
   misspelled form because it catches everything, **not** because the correct one matches nothing: on a
   data-stage incident that second claim is false, and repeating it to the requester sends them looking
   with the wrong key.

   > **A failed build writes neither form — add a third key before concluding the log is clean.** The
   > compiler's own diagnostics arrive under their own marker, `Errors and (or) warnings occurred while
   > compiling configuration dll`, followed by one raw `… error CS####: …` line per diagnostic, and the
   > run then carries on into the configuration build. Verified live on a delivery whose record was in
   > `Error` and whose only failing child was a `Compilation`: **both** `Error occured` and
   > `Error occurred` returned zero matches, while the log carried the compiler's own error line. So
   > whenever those two come back empty and the record is in `Error`, grep
   > `filterLinesWithRegex: "while compiling configuration dll|error CS[0-9]+"` before reporting that the
   > log shows nothing — and see §5.2, which owns what to do with a hit.
2. One stage-marker read — §2.5's vocabulary as a single `filterLinesWithRegex`. This is what brackets the
   failure and gives §3 its answer.
3. Only when those two do not establish the stage: read the file whole (within `rca-cal-file-read`'s size
   rule), or page around the error hits for the exception and its stack.

Any conclusion from a partial read must state its coverage — the tool returns `matchedLines` /
`returnedLines` in its front matter, so quote those rather than asserting completeness.

**Do not read the tail expecting a verdict.** Verified live on a failed install: the log's last line is an
ordinary `Package "…" saved`. There is no closing summary and no failure banner, because **the installer
does not stop at the first error** — in that run the fatal `InvalidNameException` sat at line **183 of
1 136**, and roughly 950 further lines of successful saves followed it. `tailLines` is the right tool for a
**hung or truncated** install, where the question is "where did it stop"; it is the wrong tool for finding
out whether an install failed at all.

### 2.2a The error's SQL dialect tells you which environment you are looking at

A cheap, independent check that costs no read. Database errors quoted in a delivery incident carry their
**DBMS dialect**, and the connected environment has one too — if they disagree, the incident did not happen
where you are connected, whatever else the evidence suggests.

| Same failure | MSSQL | PostgreSQL |
|---|---|---|
| column missing from the table | `Invalid column name 'UsrTaxNumber'` | `42703: column "usrtaxnumber" does not exist` |
| foreign key violated | `The … statement conflicted with the FOREIGN KEY constraint "FK…"` | `23503: insert or update on table "…" violates foreign key constraint …` |
| unique constraint violated | `Violation of UNIQUE KEY constraint` | `23505: duplicate key value violates unique constraint "…"` |

To establish the connected environment's own dialect, use what a delivery already leaves behind: SQL-script
names in an installer log are suffixed per platform (`…_PostgreSql`, `…_MSSql`), and the reference stand
identified itself that way. Note the mismatch when there is one, and say what it implies: reads here
describe a **different** environment, so they can disprove your hypothesis locally but cannot confirm the
incident. Do not treat a dialect mismatch as a reason to doubt the reporter — it locates the incident, it
does not contradict it.

### 2.3 Match the log to the record — and mind the two clocks

**Confirm the log belongs to the record you are investigating.** The installer log attached to, or
displayed for, a delivery can be the log of a **previous** delivery — Application Hub is known to show
stale logs, and a retried install leaves several `install_*.txt` files behind. A confident diagnosis built
on the previous delivery's log is the single easiest way to be wrong in this domain.

Match on the **file**, never on the log's contents, because the two are stamped by different clocks:

- **The filename and `SysFile.CreatedOn` share the record's clock — and stamp the install's *end*, not its
  start.** Verified live: record `CreatedOn` `12:31:12` plus `DurationInSeconds` `143.664` gives
  `12:33:35.7`, and the file is `install_20260908_123336.txt` created `12:33:36`. So the test is
  `CreatedOn <= file stamp ~= CreatedOn + DurationInSeconds`, not equality — and a file stamped *after* the
  record is the expected case, not a mismatch.
- **The timestamps inside the log are the server's local time.** In that same run the log's first line
  reads `2026-09-08 15:30:21` against a `CreatedOn` of `12:31:12` — a +3 h offset, and *earlier* than the
  record besides, because package validation starts before the record is written. Comparing an in-log
  timestamp against `CreatedOn` therefore makes the **correct** log look like the wrong one. Use in-log
  timestamps only to order events *within* the log.

**The two clocks do not stop at matching — they reach the report, so label them there.** A diagnosis that
gives the delivery's time from the record and the failing line's time from the log has quoted two clocks
in two sentences; on a stand with an offset those read as a contradiction, and the reader has no way to
know one of them is server local time. So: answer **"when did this happen"** from the **record's** clock,
and when you quote a log line, either leave its timestamp out or say it is the server's local time and
give the offset. **Never put the two bare numbers in one report.** The offset is not a guess — it is
measurable from evidence you already hold, the log's first line against the record's `CreatedOn`, so
state it rather than hedging around it. When you could not measure it, say the log's times are on the
server's clock and that you did not establish the offset; that is still more use than an unexplained
three-hour gap.

### 2.4 Walk the children

`rca-cal-read`'s parent-child pattern — `Parent.Id eq <parentId>`. The tree is **flat and large**: verified
live, one failed application install had **1 037 children and no grandchildren**.

**When the log is available, one bounded read — not a walk.** `includeTotalCount: true`, `compact: true`,
`columns: ['Number','Operation','Status','Element']`, a small `limit`: what you need is the operation mix
and the total, and the verified run established both from a single call. **Page the whole tree only when
there is no log** and the tree is your only stage evidence (§3) — then aggregate by `Operation`, and never
list the rows at the user.

What the children do and do not carry:

- **They do carry which stages ran and which elements were touched.** Each child's `Operation` (`Create`,
  `Install SQL Scripts`, `Install data`, …) plus `Element` names the work, and the set of operations
  present is a read on how far the delivery got (§3).
- **They usually do not carry where it failed — but when one does, it is the cheapest read there is.**
  Verified live: on that install **all 1 037 child rows had an empty `Status`**, and the failure was
  recorded on the **parent** only. So an empty child status proves nothing, and "no failing child was
  found" is never evidence that nothing failed. The failing element's name normally comes from the **log**
  (§2.2).

  The inverse does not hold, and a second live read on a different environment settles it. Counting
  `ConfActivityLog` with `Status.Name eq 'Error'` **and** `Parent.Id ne null` returned exactly one row
  — and that row named both the stage and the element. Its `Operation` was the database-structure
  update, its `Status` was `Error`, its `Parent` was the failed delivery, and its `Element` was the object
  whose column the delivery could not alter — i.e. everything §3 would otherwise take a log read to
  establish.

  So: **do not filter the delivery *search* on `Error`** (§2.1 owns that rule, for its own reason), but do
  glance at the children's statuses once you have the parent. A child in `Error` hands you §3's answer in
  one call; their absence tells you nothing and you fall back to the log.

### 2.4a The delivered payload — the binding's own rows, on the child row

**A data-stage failure has a second source of evidence, and for one whole class of failure it is the
only one.** The installer log gives the exception; the binding's **delivered rows** give the values it
choked on. They hang on the **child** activity-log row, not the parent, as readable JSON.

**Read them whenever a data-stage failure's stack goes through `JsonDataReader`.** *At that stage* the
frame means the installer failed while *parsing the delivered file* — before any insert, so nothing was
written and **no read of the target can explain it**. The error names the artefact; go and open it. Other
data-stage failures make the payload useful; this one makes it necessary.

**The frame alone establishes none of that — establish the stage first.** `JsonDataReader` also appears at
**source generation**, where every sentence above is false: nothing arrived malformed, there is no payload
to open, and the target explains it completely. Classify the stage (§3) and route from there (§5.1) — do
not let this section's data-stage reasoning settle a failure that is not at the data stage.

Three reads:

1. **Find the child** — `ConfActivityLog` filtered by `Parent.Id` **and** `Type.Name eq 'Data'`. The
   `Create` / `Update` row is the one with files; an `Install data` row for the same element is the
   execution record and carries none.
2. **List its attachments** — `SysFile` with `RecordSchemaName eq 'ConfActivityLog'` and `RecordId` =
   **that child's Id**. Expect `data.json`, `descriptor.json`, a `filter.json` when the binding has a
   filter, and the localization — one `data.<culture>.json` per culture, or one `localization.json` that
   holds the active cultures' files (`rca-cal-file-read`'s `references/sysfile-model.md`).
   Filtering `SysFile` on the **parent** Id returns the installer log and nothing else; that is the read
   made by reflex, and it is why the payload goes unopened.
3. **Read `descriptor.json`, then `data.json`.** The descriptor carries the binding's `UId`, and the log's
   error line quotes that same `UId` — so the file is tied to the failure exactly, without matching on
   names. `data.json` is then `PackageData[].Row[]`, each cell `{ SchemaColumnUId, Value, DisplayValue }`.
   These files are small; read them whole, and if you do page one, say what you covered.

**Name the cell, never the category.** With the file open, a report can say which cell holds the offending
value and what is wrong with it. Without it, the same report says "one of the GUID columns holds something
that is not a GUID" — true, useless, and it hands the reader the search you were meant to finish. A
binding's `data.json` holds a handful of cells; naming the right one costs one read.

**`DisplayValue` is the label the record carried on the source** — quote it beside the `Value`. It is what
a human recognises, and where the referenced record is missing here it is the only place that name exists
at all, because there is no row on the target to read it from.

**To name a column, read `descriptor.json` — it already carries the answer.** Its `Columns[]` list pairs
each `ColumnUId` with a `ColumnName`, plus `IsKey` and `IsForceUpdate`, so the decode costs nothing beyond
the file you opened anyway. It also gives you the **declared** UId for every column, which is the reference
to compare a `data.json` cell against — that comparison is how a corrupted identifier is caught, since the
two differ only in the file, never in the descriptor. `SysPackageSchemaDataColumn` (matching
`PackageSchemaColumnUId`, filtered by `SysPackageSchemaData.Id`) answers the same question from the
platform and is the fallback when the descriptor is not there.

**On an older build the files may not be there at all, and that is not an answer either.** Current versions
write them for every element; verified on two stands, one did exactly that while an older one held **seven**
`ConfActivityLog` attachments in total and no `data*.json`, though it still created the same `Create` ×
`Data` child rows. So an empty `SysFile` result means *this stand does not write them* — never that the
binding shipped nothing. Say which of the two you established, and fall back to `SysPackageSchemaData` /
`SysPackageSchemaDataColumn` for what the binding covers.

### 2.4b What happened to this application *before* this delivery

A delivery is rarely the first thing that happened to an application on that environment. The commonest
predecessor is an **uninstall**, and the state the failing install found was left behind by it. So once the
record is located, look back: was the same application removed shortly before?

`ConfActivityLog` records an uninstall the same way it records an install — a parent row with children
hanging off it (§2.1 gives the query: `Operation.Name = 'Delete'` with `Type.Name = 'Application'`). The
same application may have been installed and removed many times; **the one that matters is the uninstall
immediately preceding the delivery you were asked about**, so order by `CreatedOn` and take the one that
sits between the previous install and this one.

**If you find one, read its children before you say anything about it.** This is the rule, and it exists
because the opposite is easy and wrong:

> **Measured failure mode.** An agent found an earlier uninstall, saw that the current install fails on a
> particular schema, and concluded the schema "must have been present during the earlier successful
> install". It had not opened the uninstall's children. In fact that schema appears nowhere in them — it
> was never on the environment, so the uninstall had nothing to remove. The conclusion was built on an
> operation the agent had seen the existence of and not the contents of.

So, concretely:

- **Search the uninstall's children for the elements your incident names.** Same bounded read as §2.4,
  filtered or scanned for those `Element` values.
- **Present** — the uninstall did touch it, and what it did to it is part of your timeline.
- **Absent** — that is **not** evidence the element survived. It is equally consistent with the element
  never having been there. Both readings stay open until a current-state read settles it, and the
  honest sentence is that the uninstall did not record any operation on it.
- **No uninstall found** — say so plainly rather than leaving it unstated; "nothing was removed
  beforehand" is a useful fact in its own right, and it is only a fact once you have looked.

**Never describe what an earlier operation did without having read it.** Its existence, its status and its
element count are all visible in one row, and that row is exactly enough to build a confident, wrong
narrative from. An operation you have only counted is not evidence about any element inside it.

### 2.4c The environment's current state — what is installed here *now*

The log says what the delivery **attempted**. §2.4b says what happened **before** it. Neither says what the
environment **holds at this moment** — and that is a separate read, because the two routinely disagree:
a delivery that reported failure can have left its packages in place, and a delivery that reported success
can have changed nothing.

**Run this pass on every installation incident**, not only when the symptom sounds like it. It is cheap,
it is Tier A — the reads either return rows or they do not — and it is what several later steps depend on.

| Read | What it settles |
|---|---|
| `SysInstalledApp` — code, name, version, installation status | whether the application is here at all, at which version, and whether its last installation is recorded as **unsuccessful** |
| `SysPackageInInstalledApp` | which packages this application actually owns on this environment |
| `SysPackage` — name, version, maintainer | whether the delivered packages landed, and at which version |
| `SysPackageDependency` / `SysAppDependency` | the dependency graphs the target really holds — the two can disagree with each other |
| `SysPackageSchemaData` / `SysPackageSqlScript` — `NeedInstall`, `LastError` | what is still outstanding from *any* past delivery, including ones whose log is long gone |

**The five questions it answers, and where each one lands:**

1. **Did the delivery reach the environment at all?** A transport or session error says nothing about the
   server; the packages either exist here or they do not. This is the read that turns *"did it fail?"* into
   an answer.
2. **Is the application marked as unsuccessfully installed?** If it is, the **next** delivery of it will
   uninstall it first — a full replacement, not an incremental retry. Establish this **before**
   recommending "install it again", because that recommendation can destroy work.
3. **Which packages exist here that the delivery did not carry?** Packages generated on this environment
   belong to nobody's archive and are exactly what an uninstall-then-install removes. Name them.
4. **Is a named dependency genuinely absent?** An empty result for a package name **is** the evidence —
   far stronger than quoting the refusal back at the user.
5. **Which version is here versus what was delivered?** An older archive is refused or silently skipped,
   so "we reinstalled and nothing happened" is often correct behaviour rather than a failure.

> **One honest limit, and it is easy to get wrong.** This pass is a snapshot of **now**, not of the moment
> the delivery ran. Anything that happened afterwards — another delivery, a manual change, a restore — is
> already folded into what you are reading. So state it as the current state, and reconstruct *what the
> delivery found* from §2.4b and the log instead. Presenting today's inventory as the state the delivery
> met is a confident error that no later read corrects.

**Do not skip this before a restore recommendation.** The restore gate (§6) asks what needs undoing; the
inventory is what says whether anything was applied in the first place.

### 2.5 Reading rules for the log

**Marker vocabulary, read live off a real app-install log.** These are the lines that mark progress; §3
maps them to stages. Treat the list as verified-but-not-exhaustive: another install path or version can add
lines, and the markers absent from it were simply never reached by the run it came from.

| Marker (verbatim) | Means |
|---|---|
| `Packages validation started` / `Packages have been validated` | validation ran and passed |
| `Configuration backup started.` / `Configuration backup successfully created.` | the pre-install backup step |
| `Loading packages from archive` / `Package "X" loaded` | packages read for the installation — the archive's own **and the environment's inactive packages**, so not a list of what the delivery carried (see below) |
| `Inactive package "X" loaded` | an inactive package of the environment loaded alongside the archive — not part of the delivery (see below) |
| `Application install from marketplace started. Application name: … Code: …` | the app-level install began |
| `Preparing packages for installation` / `Starting package installation` / `Composing packages` | dependency resolution and ordering |
| `The request to the Application Installer Service failed due to: Dependency analysis failed: …` | the dependency **pre-flight** rejected the delivery — see the note below |
| `Skipped - Loading packages from database (new application)` | nothing to merge — the app is new here |
| `Installing SQL scripts` / `SQL script "X" from package "X" installed` | scripts **executed** |
| `Schema "X" saved in package "X"` | the schema was written **into the package** — not proof that it is now in the configuration, and not proof that it survived at all |
| `Actions added for schema "X" from package "A, B"` | the object is assembled from **more than one package** — the names are its layers |
| `Schema data "X" saved in package "X"` | a data binding was applied |
| `Files saved in package "X"` / `SQL script "X" saved in package "X"` / `Package "X" saved` | the per-package commit |
| `Compiling configuration dll` | the workspace build began — the compilation stage |
| `Errors and (or) warnings occurred while compiling configuration dll` | **the build's own error marker** — the only one a failed build writes, and it is neither of the two `Error occur*` forms |
| `<path>(<line>,<column>) error CS####: <text>` | the compiler's raw diagnostic, one line per error, immediately after the marker above |
| `Configuration build started` … `Configuration build finished` | the configuration build that follows the compile — **it runs and finishes even when the compile failed** |
| `Error occured while performing operation on "X" item, UId = …` + exception + stack | **the error marker** |
| `When application installed, an error(s) occured` | the terminal banner of a delivery that **ran to the end with errors** — one `r` again, and it is the last line of the file |

**`from package "A, B"` on one schema is a layering signal, and it decides more than it looks.** An object
assembled from two packages only works if the packages are ordered, and nothing orders them except a
declared dependency. So before concluding anything about that schema's metadata, read
`SysPackageDependency` for the packages named on that line (dotted navigation: `SysPackage.Name`,
`DependOnPackage.Name` — a bare filter on either returns nothing). **Zero rows means the layer order was
undefined**, which is a cause in its own right and reaches you wearing another stage's error.

**`Package "X" loaded` does not mean the delivery carried X — the installer also loads the environment's
inactive packages.** An *inactive* package is one the environment holds but has not activated: a package
with **smart activation** whose dependencies are not all present — it is kept aside, outside the
configuration, and activates on its own once the missing ones arrive — or a bundle **plugin package** that
joins two applications and waits for the second. Every installation loads these next to the archive's own
packages, so that it can check whether the delivery completes their dependencies. They therefore appear in
each load group of the log — the pre-install backup, a group that lists **only** them, and the installation
itself — and, when nothing activates them, **nowhere else**: no `Schema "…" saved in package "X"`, no
`Package "X" saved`, no `Data "…" from package "X" installed`. `[observed]` on an application install of
two packages: the record's `Description` named those two (`…was installed with packages: "<package>"`),
while the log's three load groups carried two more names, which then never appeared again.
Both were `Inactive` in `SysPluginPackage`, both had a row in `SysInactivePackage`, and `SysPackage`
returned nothing for either.

Newer versions label these lines `Inactive package "X" loaded`, and on such a log the label settles the
question. `[unverified here]` — no connected environment has written it yet; a log that carries it settles
that. On an older log the line is the plain `Package "X" loaded` and looks exactly like the delivery's own,
so never tell the two apart by the wording alone:

- **The delivery's package list is the record's `Description` — when it carries one.** It comes in three
  shapes: `Application "<app>" was installed with packages: "A, B".` on a run that got through — one such
  line per application in the archive, so take them all; `Installation of application "<archive>" with
  packages "A" finished with …` on a run that failed after composing; and `with packages ""`, **empty**,
  on the dependency pre-flight refusal described below, where nothing was composed. Only a **populated**
  list is the scope — for the report, for §5.2's comparison, and for any "did the delivery carry this
  package" question. On an empty one, `Element` names what was delivered — the package or the
  application, not necessarily every package it held — and the rest of the scope is **not established**:
  say so, and never read the empty list as an empty archive. The loaded lines are not a fallback in
  either case.
- **A loaded name missing from a populated list is checked, not assumed:** `SysPluginPackage` by `Name`
  (`SysPluginPackageStatus.Name` = `Inactive`) and `SysInactivePackage` by `Name` — read both, a name may
  sit in either or in both. A hit means the package is inactive here: leave it out of the delivery's scope
  and out of the list of delivered packages. **Its absence from `SysPackage` is what inactive means** — it
  is not a failed install, and not a missing dependency.
- **Do not report it at all** unless the user quoted one of these lines or asked about the package; then say
  in one sentence that it is an inactive package of the environment that every installation loads and that
  this one did not install.
- **The one exception is a package this delivery activated** — its missing dependency arrived with the
  archive. It is still inactive when it is loaded, so it carries the same line or label, but it then gets
  its own schema and package-commit lines (`Schema "…" saved in package "X"`, `Package "X" saved`),
  afterwards has a `SysPackage` row, and reads `Active` in `SysPluginPackage`. That package **is** part of
  what the delivery changed, though it did not come from the archive: keep it in scope and say it was
  activated, not delivered. `[unverified here]` — an installation that completes an inactive package's
  dependencies, followed by the three reads above, would settle it.

**`SQL script "X" from package "X" installed` and `SQL script "X" saved in package "X"` are different
events.** The first is execution, during the SQL-scripts stage; the second is the script being stored into
its package during the per-package commit. Reading the second as "the script ran" puts the failure on the
wrong stage.

> **Do not use their order in the file to tell them apart — measured, the commit came FIRST.** On a
> new-application install whose script then failed:
> `…,393 SQL script "<script>" saved in package "<package>"`, and only
> `…,981 Installing SQL scripts` afterwards. So "saved" appearing **before** any execution marker
> is normal, and a `saved` line with no `installed` line following it means the script was **stored but
> never ran successfully**. Match the wording, never the position.

**`Schema "X" saved in package "X"` is emitted for schemas the same operation is DELETING.** Measured on
an application install whose new version of the package no longer contained them:

```
…:14,239 Schema "<schema A>" saved in package "<package>"
…:14,259 Schema "<schema B>" saved in package "<package>"
…
…:17,014 Application installed successfully
```

Afterwards `SysSchema` held **neither**, and the package held zero schemas. The line reports the merged
package's element set being written; it says nothing about the fate of any one element. Reading it as "the
schema was applied" inverts the truth in the worst available direction — it names as applied exactly what
was destroyed. This is the stronger form of the rule §4 already carries for a rolled-back delivery: there
the `saved` lines persisted nothing, here they persisted a **deletion**, and the run reported success.

Four more lines mean something other than what they look like. They cost a wrong diagnosis, and they belong
here rather than in a catalog, because every catalog hits them:

- **There are two error markers, and only one of them is misspelled.** Verified across three installer
  logs:

  | Marker | Spelling | Emitted for |
  |---|---|---|
  | `Error occured while performing operation on "X" item, UId = …` | **one `c`** | every failing element, whatever its type |
  | `Error occurred while installing data "X" in package "Y". UId …` | **correct** | the data-install stage only |

  A failing data item emits **both**, one after the other — a log with 17 failing items carried 17 of each.
  A failure at schema install emitted only the first. So the misspelled form is the reliable grep key
  because it catches every failure, but **"the correct spelling matches nothing" is false** — it matches
  the data-stage message, which is the one that names the package. Search for both; the pair also tells you
  which stage you are in before you look at the surrounding markers.

  > **The pair is not data-stage-only — a failing SQL script emits both too.** Measured on a script that
  > referenced a missing table, 32 ms apart and naming the same `UId`:
  >
  > ```
  > …,981 Error occurred while installing SQL script "<script>" in package "<package>". UId <uid>: 42P01: relation "<table>" does not exist
  > …,013 Error occured while performing operation on "<script>" item, UId = <uid>
  > ```
  >
  > The **first** carries the diagnosis — script name, package and the engine's own error. The second only
  > repeats the item. So on this stage the correctly spelled form is the one worth reading, and reporting
  > the generic line instead throws away the package name and the SQL state. Search for both, quote the
  > specific one.

  A clean install contains neither: the successful reference log has **zero** matches for either form.
  **So does a delivery that failed at the compilation stage** — verified live, and it is why "neither grep
  matched" can never be reported as "the delivery hit no error". Check the record's `Status` and its
  children first; when the record is in `Error` and both greps are empty, the build marker in the table
  above is the next key to try (§2.2).

- **A failure at the package-commit stage writes NO error line at all — the log simply stops.**
  Reproduced live by blocking the commit's caption-localization write with a database constraint. The log
  ended mid-stage:

  ```
  … Files saved in package "<package>"
  … Package "<package>" saved
  … Added - dependencies of package "<package>"
  … Added - resources in package "<package>"      ← last line of the file
  ```

  No exception, no stack, **no `Error occured` and no `Error occurred`** — both greps return zero on a log
  whose delivery failed. The record's `Status` is `Error` and the cause appears **only in its
  `Description`**: `finished with unexpected error: "23514: new row for relation "SysSchemaLcz" violates
  check constraint …"`.

  Two rules bend here, and only here:
  - **"The installer does not stop at the first error" is about the schema and data stages.** A
    commit-stage failure is **fatal**: nothing after it runs, and the delivery never reaches DB structure,
    data install or compilation.
  - **The stage is established by where the log *ends*, not by bracketing an error.** The last marker
    present is the last step that succeeded; the step that failed is the **next one in the sequence** (§3).
    In the reproduction, `Added - resources in package` was last, so the failure was in
    `Added - schema caption localizations`.

  So a short log that stops inside a stage, with a record in `Error` and no error marker anywhere, is not
  a truncated download — it is this shape. Read the `Description` (§2.2) for the cause.

- **The same shape occurs at the very start of the sequence, when the dependency pre-flight refuses.**
  Measured on a command-line push of a package whose one dependency was absent from the target: a record
  in `Error`, **zero child rows**, `DurationInSeconds` under 1, and a log of a few hundred bytes ending

  ```
  … Starting package installation
  … The request to the Application Installer Service failed due to: Dependency analysis failed: BadRequest Bad Request
  At least one of 'file', 'appId', or 'appData' must be provided.
  ResponseException:
  ResponseExceptionStackTrace:
  ```

  The log **never names the missing package** — the refusal, with the package name, is in the record's
  `Description` only, which opens `Installation of application "<archive>" with packages "" finished with
  unexpected error:` (the empty `packages ""` is itself evidence that nothing was composed). Route to
  `installation-catalog-dependencies.md`.

  > **Those two trailing empty labels are the writer's normal ending, not a truncated file.** They are
  > emitted as a pair whether or not there is an exception to put after them, so a log finishing on
  > `ResponseExceptionStackTrace:` with nothing following it is complete. Confirm it rather than assume
  > either way: compare the text you read against the attachment's `SysFile.Size` — measured, they
  > matched. Do not tell a user their log was cut off by a restart on the strength of how it looks.

- **`Error occured` is the grep key, misspelling included** — one `c`, because that form is emitted for
  every failing element whatever its type. It is **not** the only form: the correctly spelled
  `Error occurred` is a separate message belonging to the data-install and SQL-script stages, and on those
  stages it is the line worth reading, since it carries the element, the package and the engine's own
  error while the misspelled one only repeats the item. Search for both; quote the specific one.
- **`Modified - schema '<Name>' in package '<Package>'` is a plan, not a fact.** That block is the
  package-comparison result, computed before anything is applied, and its presence is not evidence that
  the schema was installed. The actual application happens later; read the summary and the errors at the
  end. **The separator is a hyphen and the wording is the product's** — an earlier draft of this file
  carried an em dash, which no literal search would ever match. Quoting varies by delivery mechanism
  (single quotes in a repository/console log, double quotes in an Application Hub one), so match on the
  hyphen and the words, never on the quotes. `installation-catalog-reference.md`'s consultation
  half carries the rest of the block — the lines that introduce it, the vocabulary it shares with the
  package-commit stage, and what to tell a user who read it as proof of an install.
- **`Actions skipped for schema "…" from package "…" in N sec` is not evidence that your changes were
  skipped.** It is emitted during the **source-generation** stage — which is where §3 lists it — and what
  it reports is that this entity schema needed **no database-structure actions**. Mind the difference: the
  stage is source generation, the subject is structure actions. A routine outcome that appears in ordinary
  successful deliveries (verified: twice inside a clean new-application install). Reading it as "the
  installer left the target's copy alone" inverts its meaning, and matching on it would fire on healthy
  installs. The evidence for a delivery that applied nothing is in
  §4, and it is an **absence** — no stage markers and a child count of zero — not a line about skipping.
  > **A paraphrase of this line circulates in write-ups: `Skipped actions for schema "…"`.**
  > The word order is reversed, and that string **exists nowhere in the product**, so a literal search for
  > it returns zero matches — which reads as "there was no skip in the log" and is how the wrong
  > conclusion gets drawn twice. Search the real wording, and only for what it really reports.
- **The log's own success verdict is not the outcome.** An installation can report success and have
  applied nothing (§4). Classify the outcome from what the stages show, not from the final banner.
  > **And a log that ENDS on a success marker can still be a failed delivery.** Measured: a SQL-scripts
  > failure is **not fatal** — after the error the installer went on through `Installing data`, the
  > application registration and the build, and the file's last line is
  > `Configuration build finished`. The record's `Status` was `Error` and its `Description` read
  > *"…did not complete successfully"*, while the tail of the log looked like a clean run. So reading only
  > the end of the file inverts the verdict here. Establish the failing stage from the **error markers**
  > and read the record's status; the last line tells you only how far the run got.
  >
  > This is the mirror image of the package-commit shape above, and the two together define the rule:
  > **where the log stops is evidence only when it stops abnormally.** A log that reaches the build
  > markers ran to the end, whatever failed on the way.
  >
  > **Measured a second time on a compilation failure, which is the sharper form of the same trap.** The
  > compile failed, the installer continued, and the file's last line is again `Configuration build
  > finished` — so the tail reads as a clean run *and* the two `Error occur*` greps are empty, while the
  > record is in `Error` with a failing `Compilation` child. Here the only error text in the whole file is
  > the compiler's own line.

## 3. Stage classification — on which stage did it fail?

An installation is a fixed sequence. Establish **how far it got**, then let the stage decide which catalog
you open. This is the core of the spine.

**Route by stage *name*, never by an index.** The order below was already corrected once against a real
log, and it will be corrected again; names survive that, numbers do not. A catalog names the stage it owns
("the schema-install stage"), never "stage 3".

**The sequence is monotonic — the stages above the one you name did run.** That is what makes routing
from the stage sound. But **how you derive the failing stage depends on the outcome (§4), and the two
cases are opposite**:

- **The delivery stopped** → the failing stage is the **furthest stage whose markers appear**. Nothing
  after it ran.
- **The delivery ran on to the end** — verified live as the usual shape of a failed application install,
  whether or not anything persisted (§4 decides that separately, and it is not readable from the log) →
  the last marker is a `Package "…" saved`, so "furthest stage reached" would answer **package commit**
  every single time, and be wrong every single time. Here the
  failing stage is the one whose markers **bracket the error**: the last stage marker *before* the
  `Error occured` line and the first one *after* it. On the reference incident those are
  `Schema "LoanTimelineEntity" saved in package …` (line 182) and `Schema "PaymentSchedule" saved in
  package …` (line 190) — both schema-install markers, so the stage is **schema install**, which is the
  recorded answer.

Either way, classify from the **markers**, not from the first recognizable error line: installer logs
carry earlier, non-fatal noise, and a `CS####` or SQL error you spot is frequently neither the first
failure nor the last.

| Stage | What it does | Verified log marker | Owning catalog |
|---|---|---|---|
| **Did it start at all?** | upload / CI-CD preparation, before the site is touched | *nothing in the log, or no log at all* | this file (§6) |
| Validation | archive structure, package identity, size limits | `Packages validation started` → `Packages have been validated` | none owns it — search per §5.1 |
| Backup | the installer's own pre-install configuration backup | `Configuration backup started.` → `Configuration backup successfully created.` | none owns it — search per §5.1 |
| Load & compose | read packages from the archive, resolve dependencies and order | `Loading packages from archive`, `Package "X" loaded` (also `Inactive package "X" loaded` — the environment's inactive packages, not the delivery's; §2.5), `Preparing packages for installation`, `Composing packages` | `installation-catalog-dependencies.md` |
| SQL scripts | execute the packages' scripts | `Installing SQL scripts`, `SQL script "X" from package "X" installed` | see the discriminator below |
| Schema install | apply schemas into packages | `Schema "X" saved in package "X"` | `installation-catalog-conflicts.md` **and** `installation-catalog-dependencies.md` — see the discriminator below |
| Package commit | store files and scripts, close each package | `Files saved in package "X"`, `SQL script "X" saved in package "X"`, `Package "X" saved`, then `Added - dependencies / resources / schema caption localizations in package "X"` (`Modified - …` when the package already existed) | none owns it — search per §5.1; see the note below, a failure here is fatal and silent |
| Package hierarchy | recompute the package tree | `Package hierarchy actualization is started` → `… is completed. Affected records: N` → `Package hierarchy updated` | none owns it — search per §5.1 |
| DB structure | create/alter tables and columns | `Updating tables structure in database` | `installation-catalog-conflicts.md` **and** `installation-catalog-data-bindings.md` §5 — a repeated install that skipped the structure update, and Change Log on the modified object, are data-binding cases that surface here |
| Source generation | generate schema source code | `Schema source code "X" from package Y generated`; `Actions skipped for schema "X" from package "Y" in N sec` when it is skipped; then `Updating modified schemas` → `Updated modified schemas` | see the discriminator below |
| **Data install** | apply the bindings' records to the target | `Installing data` → `Data "X" from package "Y" installed` | `installation-catalog-data-bindings.md` / `installation-catalog-localization.md` |
| Install scripts | run each package's default install scripts | `Executing default install scripts` → `Default install script "X" executed for package "Y"` | none owns it — search per §5.1 |
| Application registration | record the application | `Saving application info to the system (code: X)...` → `Saved new application X` | none owns it — search per §5.1 |
| Compilation | build the workspace assembly | `Compiling configuration dll` opens it. On failure: `Errors and (or) warnings occurred while compiling configuration dll` and one raw `… error CS####: …` line per diagnostic. Then, **whatever the compile did**, `Configuration build started` … `Configuration build finished`, with `Current schemas info loaded`, `New schemas info loaded`, `Configuration state loaded`, `Configuration server content generation started/generated`, `Schema JS module descriptors updated` between them | **§5.2 of this file** (the gate and the framing) → `compilation.md` (mechanics) + `compilation-catalog-cases.md` (signature) |
| Static content | regenerate client content | `File content generation started` → `File content descriptors obtained/generated` → `File content bootstraps generated`. **When the site has static content disabled** the stage is replaced by a single notice: `Static content is marked as pending generation, but static file content is disabled on this site…` | none owns it — search per §5.1 |

> **`Schema data "X" saved in package "X"` is not the data-install stage.** It belongs to the package
> commit — the binding being written *into* the package — and it happens **six seconds earlier** in the
> verified sequence than `Installing data`, which is where the records actually reach the target. Verified
> on a successful install: `Schema data … saved` at `09:02:35`, `Installing data` at `09:02:41`, with the
> DB-structure and source-generation stages in between. A failure at data install therefore brackets
> against `Installing data` / `Data "…" installed`, **not** against the `saved` lines — bracketing on the
> latter names the wrong stage. This is the same trap as the SQL-script pair below, and it was found by
> reading a successful delivery end to end.
>
> **The order above is now verified against a complete successful install** (93 lines, 28.6 s), not
> inferred: validation → backup → load & compose → schema install → package commit → package hierarchy →
> DB structure → source generation → **data install** → install scripts → application registration →
> compilation → static content. Note that data install comes **after** source generation — which is
> exactly why a column default that reads a system setting cannot find it during generation.
>
> **A delivery can have no compilation stage at all, and that is a property of the archive — not a fault.**
> Verified live on two deliveries of the same application, where one compiled and the other did not. A
> package that was **built on the source before it was exported** travels with its compiled assembly —
> `Files\Bin\<package>.dll` and the build output under `Files\obj\` — and the installer then has nothing
> to build: no `Compiling configuration dll`, no `Compilation` child, and `PackageCompilationState` for
> that package still reads `NeedCompile = false` afterwards. A package exported **without** a built
> assembly is compiled on the target, and that is where an install-time build failure appears at all.
>
> **The consequence is the dangerous half.** The absence of a compilation stage is not evidence that the
> build is healthy: the sources the delivery wrote can diverge from the assembly it brought, and nothing
> reports it until somebody runs a full compilation by hand — possibly days later, with no delivery in
> sight. So when a delivery touched source-code schemas and produced **no** compilation stage, say that
> plainly and read the current build state (`VwCompilationErrors`) instead of concluding the build is
> fine. The archive itself cannot be read from a connected environment, so name the prebuilt assembly as
> the reading the evidence supports — the missing marker plus `NeedCompile` — not as a fact you opened.
>
> **A delivery that stopped before its compilation stage has the same blind spot, for another reason.**
> When the delivery stops earlier — at the database structure, or on a source-generation error — but has
> already saved its schemas, the last compilation and an empty `VwCompilationErrors` describe the build
> **before** those schemas existed; they say nothing about the next one. When a saved source-code schema
> uses something the delivery did not finish — typically an object whose source generation failed, which
> that object's `SysSchema.LastError` shows — say that the next full compilation will most likely fail on
> it, and that nothing that compiles (a full compilation, another delivery) should run until the fix is
> in. Do not report the build as healthy. `[observed]` on a delivery that stopped on a source-generation
> error: the object's `LastError` held that error, a delivered source-code schema that uses the object
> was saved, no compilation followed, and `VwCompilationErrors` was empty. `[unverified here]` that the
> next compilation then fails — what would settle it is a full compilation after such a delivery; until
> then report it as the likely outcome, not as a finding.

> **Stages are conditional.** The successful reference install contains no `Installing SQL scripts` at all
> (the application ships none), and the static-content stage was replaced by the disabled notice. An absent
> marker means "this delivery had nothing to do here" at least as often as it means "it never got this
> far" — use the stages that *are* present to bracket, never the absence of one.

> **Two things about this order, both verified and both counter-intuitive.** **SQL scripts execute *before*
> schemas are applied** — measured in one log at `15:31:31` for `Installing SQL scripts` against `15:31:41`
> for the first `Schema … saved`; an earlier draft of this file had them the other way round. And the four
> stages at the bottom carry **no verified marker yet**: the run this vocabulary came from failed during
> schema install and never reached them, so their order rests on domain material rather than on a log
> anyone here has read. Say so when you route to one of them, and add the marker to this table the first
> time you see it.

**Corroborating reads, by stage.** `rca-env-readonly-query` is a **general** skill: it knows which tables to
read and what a read proves, and it knows nothing about this file or about stages. The mapping is therefore
this file's job, not its:

| Stage | Section of `rca-env-readonly-query` that corroborates it |
|---|---|
| Load & compose | "Packages and their dependencies" — is the named package present, and what dependency graph is actually stored |
| SQL scripts | "Does the record named in an error actually exist?" — the table or object the script expected |
| Schema install | "Schema state on the target" — `IsChanged` / `IsLocked`, a missing `Parent`, and a name collision as same `Name` + different `UId` |
| Data | "Binding state on the target — `SysPackageSchemaData`", "Binding column settings — `SysPackageSchemaDataColumn`", "Cultures — `SysCulture`", "Localized resources — `SysLocalizableValue`", "Localization changes attributed to a log record — `LocalizationChangeLog`", and "Section bindings" for a section that did not appear |
| Source generation | "System settings" for a setting the generation needs, and "Localized resources — `SysLocalizableValue`" for a resource missing in one culture |
| DB structure | "Schema state on the target", plus `creatio_describe_object` / a live read of the named object; "Change-log state — `VwLogObjects`" when the error names a `Sys*Log` table |
| Compilation | "Post-install build state" — `CompilationHistory` for the record, `VwCompilationErrors` for current state |

**"Did it start at all?" is a distinct answer, not a degenerate case.** A delivery that never reached the site leaves the
environment untouched — that changes the entire recommendation, and it is the first input to the restore
gate. A CI/CD action that failed before its install step ran is the standard example.

**Shared stages — the discriminator is set here, and catalogs follow it without overriding:**

- **SQL scripts:** the script failed because the object it needs **was supposed to arrive with another
  package** → `installation-catalog-dependencies.md`. The object exists but the target's structure or data
  does not match what the script assumes → `installation-catalog-conflicts.md`. A *repeated* install
  failing on a column the object visibly has is a third reading — the structure update was skipped on the
  second attempt — and lives in `installation-catalog-data-bindings.md` §5.
- **Schema install:** the element the installer names **is present on the target but blocked** — locally
  modified, locked, or clashing by name/`UId` with a schema in another package →
  `installation-catalog-conflicts.md`. Something the incoming schema **needs is absent** — most often its
  **parent schema**, which lives in a package that did not travel, surfacing as a self-referencing
  foreign-key violation on `SysSchema` (`FOREIGN KEY SAME TABLE` on MSSQL, `23503` on PostgreSQL) →
  `installation-catalog-dependencies.md`. In short: *blocked* is a conflict, *missing* is a dependency.
- **Source generation:** generation failed because **data it needs does not exist yet** (a system setting a
  column default reads) → `installation-catalog-data-bindings.md`. It failed because **a schema from another package is
  missing** → `installation-catalog-dependencies.md`. It failed because a **localized resource is missing
  for a culture** → `installation-catalog-localization.md`.
- **Data** — the stage's table row names two catalogs, and §5 requires opening exactly one: the failing
  element or error names a **culture or a localized resource** → `installation-catalog-localization.md`; any other binding or
  record failure → `installation-catalog-data-bindings.md`.
- **Compilation** — there is no discriminator to apply and no installation catalog to choose between: the
  stage always routes to **§5.2**, which runs its gate and then hands the signature to the compilation
  domain. What the gate decides is not *which* file to open — it is whether the delivery is the cause at
  all. Two traps put a delivery on this stage that does not belong here: `Configuration build finished` in
  the log is not evidence the compile succeeded (§2.5), and a build failure at this stage is frequently
  the **consequence** of an earlier stage — a schema whose parent did not travel, a library that was not
  delivered — in which case the compiler error is the symptom and the earlier stage owns the cause.

**No log file? The record tree still shows how far it got.** A delivery performed by a deployment tool
(clio, WorkspaceConsole, a product deploy) frequently leaves **no attachment at all** — verified live on an
environment with 76 000 activity-log rows and *zero* `SysFile` attachments — while still writing child rows
whose own `Operation` names the stage: **`Install SQL Scripts`** is the SQL-scripts stage, **`Create`** /
**`Update`** on schema types is schema install, **`Install data`** is the data stage, and
**`Update database structure`**, **`Generate source code`**, **`Compilation`**, **`Generate static
content`** are the four at the bottom of the table. Page the children (§2.4), aggregate by `Operation`,
and read the stage off the **last stage that produced rows**.

**The tree gives you "furthest reached" and nothing else.** It cannot bracket an error the way the log
can, because the rows carry no status and no error text, so a delivery that ran on past its failure looks
identical to one that succeeded. When the tree is your only evidence, report the stage as *the furthest
stage that produced rows* — in those words — and say the failing stage could not be established.

**Do not expect the tree to tell you where it broke** — the child rows carry no status (§2.4). This reading
gives you *how far*, never *why*, and it cannot separate "the stage completed" from "the stage ran and
failed". Say which of the two evidence sources you had, and never present a tree-derived stage as if it
came from the installer log.

**If neither is available, say so.** When there is no log **and** no child rows that name a stage — or the
markers do not identify one — report the stage as **not established**, name what you did read, and answer
only as far as that evidence carries, with lowered confidence. Do not infer a stage from the error text's
shape; that is precisely the guess this section exists to prevent.

## 4. Outcome classification — state exactly one, and never round up

| Outcome | Condition |
|---|---|
| **Failed at the *named* stage** | a blocking error stopped the delivery there — name the stage (§3), never an index |
| **Failed and rolled back** | the log records work through to its last line, and **none of it persisted**: the packages, schemas and applications it reports as saved are not in the configuration |
| **Completed with errors** | the delivery ran to the end and **part of it persisted** while other elements failed — a genuinely partial state, and the most dangerous one |
| **Completed, but the delivered changes were not applied** | the log reports success and the environment still runs the old version |
| **Completed, and it removed elements** | the log reports success, and elements the target held before are **gone** — the delivered package no longer contains them |
| **Clean success** | every stage completed, nothing skipped |

> **A build failure is "completed with errors", and it is the least intuitive instance of that row.**
> Verified live on a delivery that failed at the compilation stage: every earlier stage had applied —
> the schemas were in the configuration, the bindings were installed, the application was registered
> (`SysInstalledApp` held its row) — and the environment was left with a configuration that does not
> build. So the delivered content **is** on the environment; what is missing is a working build. Do not
> report it as "the installation did not go through", and do not reach for the restore gate on the
> strength of the word `Error` alone — §6 decides that, and here the delivered elements are exactly what
> a restore would take away.

**One outcome — and the rest of the report has to agree with it.** The commonest way to break this rule
is not picking the wrong row; it is naming a stage at the top of the report and then describing a partial
state further down. *Failed at the named stage* and *Completed with errors* are different rows and they
answer the reader's real question differently: the first says the delivery stopped there, the second says
it did not stop and part of it is live right now. One test settles which you have, and run it before you
write anything: **did the log carry on past the failing element into later stages?** If it did, the
outcome is *Completed with errors* however blocking that one error looked — name the failing stage
**inside** that outcome, not instead of it. A report whose summary says the delivery failed at a stage
while its consequences say part of it persisted is making two claims at once, and the reader will act on
whichever one they read first.

**A delivery deletes what its packages no longer contain — including elements created on the target — and
says nothing about it.** Measured: a package delivered carrying one schema; a second schema then created
on the target **inside that same package**; then a second delivery whose package carried no schemas at
all. Both schemas were removed, the run reported `Application installed successfully`, and the package was
left holding none. Nothing in the log names a deletion; the only trace is the environment itself.

This is the mirror image of *completed, but the delivered changes were not applied*, and the evidence has
the same shape — **read the environment, not the log.** When a user reports that something they had is
missing after an upgrade, this is the first thing to check, and it is the reading that the `saved` lines in
§2.5 will actively argue against. The nearest family is `installation-catalog-conflicts.md`;
until that catalog covers it, report the outcome and the evidence and say the sub-domain is not yet
covered.

> **Read in the source, not measured:** the composer marks a target element that is absent from the
> incoming package as `Deleted` unless the element is **protected** — `IsLocked && IsChanged`
> (`DescriptorComparerBase.IsItemDeleted` is `!IsProtected`) — and a protected one is marked `Conflicted`
> instead. The deletion half of that is what the reproduction above measured. The survival half is **not**:
> nobody here has watched a protected element survive a delivery that dropped it. Do not promise a
> customer that locking protects their addition until someone has.

**Read the record's `Description` before the log — they carry different errors.** Verified on the
reference incident: the installer log's only error is
`InvalidNameException: "PaymentMethod" configuration schema already exists …`, while the record's
`Description` reports something else entirely —
`finished with unexpected error: "Parent schema named "BankAccount" and unique identifier "…" not found"`.
Neither is a copy of the other: the log holds the first failure encountered, the `Description` the terminal
one the platform surfaced. Reading only one of them gives you half the incident, and the relationship
between the two may not be derivable — say so rather than assuming one caused the other.

The `Description` may also carry an explicit outcome banner — on that record,
`No configuration changes from this operation were saved. The configuration elements listed in its child
records are not present in the system.` **That is the platform's claim, not proof** (an operation's own
report is never evidence of its effect), but it is the cheapest pointer there is: read it first, then
confirm with the four reads below rather than instead of them.

> **The log cannot tell these apart, and the difference decides the whole answer.** Verified live on the
> reference incident: the installer logged `Schema "PaymentSchedule" saved in package
> "CrtFinservAccMgmtObjMdl"` and hundreds of similar lines, then ran to its ordinary last line — yet
> afterwards `SysPackage` held **no** Finserv package, `SysSchema` held **none** of the schemas the log
> said it had saved, and `SysInstalledApp` listed none of the five applications. The delivery had rolled
> back; the environment was in its pre-install state.
>
> So **a `saved` line in the log is not evidence that anything persisted.** Never classify between "rolled
> back" and "partial" from the log — read the platform:
> - the packages by name (`SysPackage`) — absent means nothing landed;
> - two or three schemas the log claims to have saved (`SysSchema` by `Name`, **always including
>   `ExtendParent` and `Parent`**) — absent means the same, and this is the sharpest single check because
>   the log is explicit about them;
> - the applications (`SysInstalledApp`);
> - current build state (`VwCompilationErrors`).
>
> Four cheap reads, and they agree or they don't. "Rolled back" is the **better** news of the two and
> changes the recommendation completely (nothing to restore, nothing half-applied to clean up) — so
> getting it wrong in the pessimistic direction is not the safe default, it is just wrong.

**Whenever you read `SysSchema`, ask for `ExtendParent` and `Parent` — and act on what comes back.** A row
with `ExtendParent = true` is a **replacing** schema: it does not add an object, it modifies the one
`Parent` names, and its metadata is a **diff** against that parent rather than a document of its own. Two
rows under one `Name` are ordinary inheritance rather than a duplicate **only when the flagged row's
`Parent` is the other row** — a `Parent` that is empty, or that names a schema which is not there, leaves
the pair unexplained, and an unexplained pair stays a finding. It is also **order-dependent** — a diff only applies after its base, and nothing orders two packages except a
declared dependency. So when the pair spans two packages, read `SysPackageDependency` for both (dotted
navigation: `SysPackage.Name`, `DependOnPackage.Name`) — and read the **direction**, not just the count.
What orders them is an edge **from the package holding the replacing row to the package holding the base**;
**zero rows, or an edge pointing the other way, both mean there is no defined install order**, which is a
finding in its own right and a likely cause of whatever the delivery reported.

**The same rule governs every other operation you read on the way, not just the delivery.** A
`ConfActivityLog` row's `Operation` and `Status` are evidence that something was *attempted and
self-reported* — never evidence of what it *did* to the environment. The trap is that the operation's name
describes an effect, so the row reads like a result.

Verified live: a `Clear configuration activity log` row with `Status = Success` invited the conclusion that
earlier install history had been erased. One read falsified it — the same `ConfActivityLog` still held
**32 665 rows spanning three months**, including records older than the clear, and exactly **one** install
operation among them. Nothing observable had been removed; there had only ever been one delivery.

So whenever a conclusion depends on what an operation *did* — a clear, a restore, an earlier install, a
compilation — **name the read that shows the effect**. If no allowed read can show it, report the operation
as a claim and its effect as **not established**. `rca-cal-read`'s guardrails carry this as the general rule
for any domain.

The "changes were not applied" outcome is a first-class result, not a footnote — it is the shape of a
large family of real incidents ("install is successful, we compiled and cleared the cache, and pre still
runs the old page").

> **It has a verified log signature, and everything on the surface says success.** Reproduced live by
> installing an unchanged application package over itself. The record reports `Success`, its `Description`
> reads *"Application "NewTestApp1" **was installed** with packages…"*, and **nothing was applied**:
>
> | | a delivery that did the work | the no-op |
> |---|---|---|
> | log length | 93 lines | **22 lines** |
> | children | **56** | **0** |
> | last marker | `Configuration build finished` | **`Composing packages`** — the log simply stops |
> | schema / data / structure / build markers | all present | **none** |
> | duration | 28.6 s | 14.0 s |
>
> **The cheapest discriminator is the child count**, and it is one read: a delivery that applied anything
> has children (56 here, 1 037 on a large one); this one has **zero** while claiming success. The second
> is where the log stops — a log ending at `Composing packages`, with no `Schema "…" saved` anywhere, is a
> delivery that decided it had nothing to do.
>
> This is the mirror of the `saved`-line rule above: *a `saved` line does not prove anything persisted*,
> and equally *the absence of the stage markers in a `Success` delivery is evidence that nothing was
> applied*. Neither the status nor the `Description` will tell you — both say installed.
>
> What was verified is that an **unchanged** package re-installed over itself produces this. Whether a
> *changed* package whose version was not raised produces the same shape is the mechanic
> `installation-catalog-data-bindings.md` §5 describes, and it remains untested.
**Its causes are told apart by evidence, not by the symptom.** The causes below are the ones observed so
far — the list is open, not exhaustive:

| Evidence | Cause | Route |
|---|---|---|
| **zero child rows** on a delivery reporting success, and a log that stops at `Composing packages` with no `Schema "…" saved`, no `Installing data` and no build markers anywhere | the package's content is not different from what the target already holds, so the installer composed the delivery and found nothing to apply | `installation-catalog-dependencies.md` |
| `IsChanged` / `IsLocked` on the schema, read from `SysSchema` | the element was edited directly on the target, or its package is unlocked there | `installation-catalog-conflicts.md` |
| `IsForceUpdate = false` on a binding column (`SysPackageSchemaDataColumn`) | the installer left the target's existing value in place for that column | `installation-catalog-data-bindings.md` |
| localized resources absent for a culture the target uses (`SysLocalizableValue`), or a removal row in `LocalizationChangeLog` | the delivery did not carry resources for that culture | `installation-catalog-localization.md` |

**Read the evidence before choosing.** These are siblings with the same symptom and different fixes;
picking by intuition means picking at random. Report the flags or rows you actually read, not the ones the
symptom suggests. If several are present, report all of them and say which accounts for the elements the
user cares about.

## 5. Routing — open at least one catalog, after §3 and §4

Route from the **established stage**, then follow that catalog's own verify steps and tier discipline
instead of improvising here. Each catalog is opened on demand and read in full; none of them is read
"just in case" before a stage is established.

> **The compilation stage is the one route that does not end in a catalog of this family.** It ends in
> **§5.2** and then in the compilation domain's own files. Everything below about searching, forcing and
> iterating applies to the catalogs named at the top of this file; it does not ask you to search them
> for a build failure whose stage is already established.

> **An investigation that opens no catalog has not searched.** §2's evidence and §3/§4's classification
> tell you *where* the delivery broke; they do not tell you *what* broke it. The mechanism, the read that
> confirms it and the fix all live in the catalogs, so **finishing this section without opening one is
> never a complete answer** — measured live: a run classified the incident correctly, stopped at this
> file, and produced a confident diagnosis that was wrong, then reached the right one immediately once a
> catalog was opened. Ending on the spine is still a legitimate outcome, but only **after** the search
> below, never instead of it.

### 5.1 The search order

You may open more than one catalog. Work through them **one at a time, in this order**, and stop at the
first whose *Verify* step confirms:

0. **If the established stage is compilation, stop here and go to §5.2.** The order below is not searched
   for it: the stage names no catalog of this family, and the delivery gate plus the compilation domain
   are the whole route. Come back to this order only if §5.2's gate shows the build failure is a
   consequence of an earlier stage, which then has its own row in §3.
1. **Start with what the evidence already chose.** If §3's stage table names a catalog for the established
   stage, start there — that is the one pick this file's own evidence supports. If it names two, take
   whichever comes first in the standing order below. If the stage names none, start at the head of that
   order.
2. **Then the rest, in the standing order:**
   `installation-catalog-data-bindings.md` → `installation-catalog-dependencies.md` →
   `installation-catalog-conflicts.md` → `installation-catalog-localization.md` →
   `installation-catalog-infrastructure.md` → `installation-catalog-infrastructure-files.md`

   **Two exceptions to that order, both about the infrastructure pair.** It comes last because it is the
   family that explains a delivery *no package defect accounts for* — reaching for it early produces a
   comfortable "it was the environment" that closes the wrong incident. But **start there instead when the
   evidence is an environment signature rather than a delivery one**: a cancelled statement, a locked file
   or directory, a transport error with no server-side failure, a proxy refusal with no record at all, or a
   pipeline that failed before the install ran. And **its two files are searched as one** — a signature
   absent from the first is looked for in the second before the family is eliminated.
3. **A catalog that is not in the repository is skipped, not a stop.** The sub-domains land one at a time;
   an absent file means "nothing here owns this", so move to the next. Note which one was missing and say
   so in the report — it is the difference between a curated answer and one improvised on the spine.
4. **When all of them are exhausted**, three things remain — in this order, and each only because the one
   before it came back empty:

   **4a. The generic signature fallback.** Open `installation-catalog-reference.md` §1 and report
   from this file plus that section: the stage, the outcome, the evidence, what the error *class* means,
   what evidence would identify a specific case, and plainly that **no catalog entry matched**.

   **4b. Then ask whether this is an incident at all.** The same file's §2 holds the **delivery
   consultation** entries, and a symptom that produced no error, matched no case and fits no signature
   class is frequently not a fault: it is the platform behaving as designed, and the answer is the rule
   plus the supported procedure. Read §2 before going any further outward — *"nothing is wrong, and here
   is why it works that way"* is a complete answer, and it is one this knowledge base already contains.
   > It is reached from the spine's §1a as its own route, for a question that never looked like an
   > incident. Arriving here instead means the incident framing has run out of evidence — so re-read the
   > symptom as a question about intended behaviour before concluding that nothing explains it.

   **4c. Only then, outside the repository.** With no relevant record, no catalog match, no signature
   class and no consultation entry that fits, the `rca-academy-lookup` skill checks Creatio's public
   documentation — the single point in an investigation where anything outside the environment is
   consulted, and only with all of the above actually done. Whatever it returns is documentation about
   the product, tagged as such, never evidence about this environment, and the report says outright that
   the search left the environment and why. Where that capability is unavailable on the host, say so
   rather than answering from recollection.

   Then report. **That is the terminal state** — the same answer this section used to allow at the start,
   now available only at the end, and now with something to say instead of a shrug.

   **`installation-catalog-reference.md` is reachable from here and nowhere else in the search.** It is
   cheap to read and it always seems to fit, which is exactly why opening it before step 4 is a search
   that stopped early wearing the costume of one that finished. It carries no signatures of its own: a
   class-level answer from it is never a case, and the report says so in those words.

**Moving on requires a broken Verify, not a feeling.** The two behaviours below look similar and are
opposites:

| | |
|---|---|
| **Forcing — forbidden** | answering from a catalog whose *Verify* you did not run, or ran and did not confirm. A bindings answer to a dependencies failure is worse than no answer |
| **Iterating — required** | moving to the next catalog **because a *Verify* read came back contradicting the entry**, or because no entry's signature matches what you actually gathered |

So: match a signature, **run its *Verify***, and let the read decide. A catalog is eliminated by evidence,
never by impression — and an entry you never verified cannot be reported either as the cause or as ruled
out.

**Some incidents have no stage at all, and they still route.** A delivery that reported success, a symptom
noticed days later, a refusal on the *source* environment before anything was delivered — none of these
produces an installer-log error, so §3 yields no stage and there is nothing to route *from*. That is not
"not covered": route from **§4's outcome and its evidence table** instead, which is why that table names a
catalog per row. Concretely:

- the delivery reported success and the environment did not change → §4's "changes were not applied" row
  set, by whichever evidence you actually read;
- the site stopped serving, or a section/page behaves wrongly, **after** a delivery → the mechanism decides:
  a system setting or a binding → `installation-catalog-data-bindings.md`; a caption or culture →
  `installation-catalog-localization.md`;
- a binding or a package was **refused on the source** while preparing the delivery → the same bindings
  catalog; nothing was installed, so there is no log and no stage to look for.

> **A symptom with no error needs the log narrowed before it can be read — `rca-cal-read` owns the gates.**
> An environment in use accumulates deliveries, builds and per-element rows from work that has nothing to
> do with what was reported, and with no error to anchor on, **the loudest candidate is simply the most
> recent one**. That is how an unrelated delivery gets reported as the cause. Run that skill's relevance
> gates — anchor, window from the last known good, element overlap, mechanism plausibility, whether the
> record changed anything at all — before deciding which delivery you are even investigating, and say in
> the report how many records were set aside and on which gate. One of those gates reverses here and is
> worth knowing: a delivery that **applied nothing** is not a cause of new breakage, but it is the leading
> explanation when the complaint is that an expected change is missing.

**And the commonest case of all: the incident is not on the environment you are connected to.** Support
is routinely connected to a stand that is not the one that failed — no matching record, no installer log,
nothing. Then §3 yields no stage *and* §4 yields no outcome, and there is nothing to route from by either
of the routes above. **Do not fall back to analysing whatever delivery does exist here.** That is a
different incident, and answering it is answering a question nobody asked.

Route by the **pasted signature** instead — §1 already makes it first-class evidence, and the catalogs are
organised by signature. Then use the connected environment for what it can still do: the signature usually
*names* something — a schema, a `UId`, a setting code, a culture, a binding — and those objects often exist
here too, because base configuration is shared between stands. Read them, and label the result for what it
is: **evidence about this environment, not about the target.** A read here can disprove a hypothesis
locally, corroborate a mechanism, or show the state the target *should* have had; it cannot confirm the
incident. Say which of those you are doing.

Say which of the three you routed by — the established stage, the outcome evidence, or the pasted
signature — because it changes what the report can claim.

**A stage may point at more than one catalog, and that is not a defect.** The catalogs are organised by
**mechanism**, while stages describe *where a
failure surfaced*. The two axes do not coincide: a data-binding case can surface at the DB-structure stage,
and the stage table names every catalog that owns cases there. When a stage lists two, open the one whose
signatures match what you actually read first; if neither matches, that is not the end of the search —
continue with §5.1's order rather than forcing the incident into the nearer file.

**If the catalog for the established stage is not in the repository**, that is step 3 of the search order:
skip it and continue with the next catalog. It is no longer a reason to stop — but it **is** a reason to
say so in the report, because it changes what the answer rests on.

> **Say it even when you solved the incident anyway — this is the half that gets skipped.** Measured on
> two independent blind runs of the same incident: routing landed on a catalog that is not in the repo,
> both runs reached the correct root cause from this file alone, and **neither said the sub-domain was
> uncovered.** Their "Confidence & gaps" sections listed real unknowns and not this one. The omission
> costs nothing in that answer and a great deal in the next: the reader cannot tell a curated,
> case-verified diagnosis from one improvised on the spine, and nobody learns that the catalog is still
> missing. So when a catalog you would have routed to is absent, **one sentence in the report, not only in
> your reasoning**: name the catalog that would have owned it, and — if the search ended without a match —
> say the answer rests on the spine's evidence protocol instead. Being right is not a reason to drop it.

### 5.2 The compilation stage — run the gate, then hand over

The delivery reached the build and the build failed. Reading a build is the compilation domain's business
and the signatures live in its catalog; what this section owns is the one question neither file can
answer, because it is a question about the **delivery**:

> **Did this delivery break the build, or did it run a build that was already broken?**

Both shapes occur. The first is the common one. The second is the one that produces a confident wrong
answer: a delivery that merely triggered a build which then failed on problems that were already on the
environment gets reported as the cause of them, the package goes back to a developer who cannot reproduce
anything, and the environment stays broken exactly as it was. **"The build failed right after the install"
is the observation, never the verdict** — and the two are indistinguishable until the reads below are run.
So run them every time, including when the delivered package is obviously custom and obviously suspect.

**Locate the build record first.** The compilation is a **child** of the delivery: filter
`ConfActivityLog` on `Parent.Id` = the delivery record and `Operation.Name = Compilation`. Verified live:
on a delivery that failed this way it was the **only** child in `Error` — the rest of the tree carried an
empty `Status` (§2.4) — so a single child read gives you both the stage and the record to work from. Its
`DurationInSeconds` can read `0` on that row while the build plainly took minutes; when you need the
duration, take `ModifiedOn` − `CreatedOn`, which on the verified run gave the real span.

#### The five reads

1. **What did this build actually compile?** The `Compilation` child's own `Description` names, in the
   form `Compilation type: …`, the packages that **triggered** the build — `Compilation of packages:
   <package>` for an install. **That list is the trigger, not always the scope.** Every ordinary package
   compiles into **one shared project**, so a build triggered by any of them compiles the sources of all
   of them, as they are saved on the environment at that moment; only a package compiled into a separate
   assembly has a project of its own, and only that project is bounded by the list.
   `CompilationHistory.ProjectName` (read 2) says which one ran: the shared configuration project
   (`Terrasoft.Configuration.Dev.csproj` on the environments observed) or `<Package>.csproj` for a
   separate assembly. `[observed]` — a delivery of one ordinary package logged `Compilation of packages:
   <that package>`, and its build failed in the shared project, in a source file of another package the
   delivery did not carry. **Read this first, because it bounds every conclusion that follows:** a
   separate-assembly build cannot see a problem anywhere else in the configuration, so its clean projects
   are not evidence that the rest of the environment builds, and a pre-existing failure missing from it is
   not a failure that does not exist; a shared-project build did compile every ordinary package, so a
   failure saved in any of them surfaces in it. The same `Description` carries the status and the full
   diagnostic list, which makes it a cheap cross-check on read 2.
2. **Who owns each failing project?** Read `CompilationHistory` for that child (see `rca-env-readonly-query`):
   every row with `Result = false`, and from each row's `ErrorsWarnings` the entries with
   `IsWarning = false` — `FileName`, `ErrorNumber`, `ErrorText`, `Line`. **Attribute each entry to a
   package by its `FileName`, not by `ProjectName`:** a source file is named `<Schema>.<Package>.cs`, so
   `UsrHelper.UsrTools.cs` belongs to `UsrTools`. `ProjectName` names a package only for a
   separate-assembly project (`<Package>.csproj`); the shared project of read 1 belongs to no single
   package. Now compare that set with **the packages this delivery carried**: the parent record's
   `Description` lists every package of the archive by name. Use it, not the log's `Package "X" loaded`
   lines — those also name the environment's inactive packages, which the delivery did not carry (§2.5).
   A failing file of a package the delivery **did not** carry points to a build that was
   already broken — but it is a pointer, not the verdict: such a file also fails when the delivery changed
   something it uses, and read 3 together with the scope pass tells the two apart. A failing file of a
   package it **did** carry is not yet proof of the opposite either — read 3 decides that.
   **When a failing file belongs to a package the delivery did not carry, run these two reads before you
   choose a verdict — both, every time:**
   - **When did that file last change?** The failing schema's own `Create` / `Update` records in
     `ConfActivityLog` (filter `Element` on the schema name, newest first), or its `SysSchema.ModifiedOn`
     when the schema was created on this environment — for an element that arrived by a delivery,
     `ModifiedOn` travels from the source, so use the activity-log records. Compare that time with read 3's
     clean build: **before** it means the file compiled clean with everything it used at that moment;
     **after** it, with no build in between, means the file was broken before the delivery and never
     compiled.
   - **Did this delivery touch anything the error names?** Take every identifier in `ErrorText` — the type,
     the member — and look for it among the delivery's children (`Element`): an `Update` of the named type
     is the delivery changing what the file uses.

   The verdict then follows from the pair, not from judgement. Changed **before** the clean build **and**
   the delivery touched a named element → **the delivery broke the build**; the scope pass's "without the
   member" row gives the mechanism. Changed **after** the clean build **and** the delivery touched nothing
   it names → **the build was already broken and the delivery only ran it**. Any other combination: say
   which read contradicts which, and do not round it up to either verdict.
   **When the failing `FileName` names a schema the delivery created, its source is readable** — the
   element's own artefacts hang on the `Create` child row for that schema, and `rca-cal-file-read` opens them.
   Verified live: on a delivery whose build failed on a syntax error, the delivered source file was a
   few hundred bytes and carried the defective line itself. That turns "the package is at fault" into the
   line the developer has to change, which is the difference between a diagnosis they can act on and one
   they have to reproduce first. Do it whenever the file is small enough to read whole.
3. **What did the build look like before the delivery?** `ConfActivityLog`, `Operation = Compilation`,
   **any status** (a `Status` filter here hides exactly the evidence you want), `CreatedOn` earlier than
   the delivery's start, newest first, small `limit`. If such a record exists, read its own
   `CompilationHistory` and compare the two failure sets **by project, file, error code and line** — not
   by count, and not by "it was failing then too". Two failures of the same project are not the same
   failure.
4. **If there is no earlier build, that is not "the build was fine".** It is "unknown", and the difference
   is the whole gate. `ConfActivityLog` is not a permanent archive: a `Clear configuration activity log`
   operation wipes it, and environments run retention. Verified live: on the reference environment the
   **oldest row in the entire log was itself a `Clear configuration activity log`, minutes before the
   delivery** — so "no earlier compilation exists" there meant the history had been erased, not that
   nothing had ever failed. Read the oldest row and look for that operation before you read absence as
   health. And mind what §4 already says about any operation: a `Clear …` row in `Success` is a claim
   about an attempt, so what it removed is established by what you can still read, not by the row itself.
5. **What is broken right now?** `VwCompilationErrors` — a global, run-independent snapshot with no link
   to any record, so it answers "is the environment broken now" where `CompilationHistory` answers "what
   did that run produce". Compare it with read 2's set:
   - **the same set** → the current break is exactly what this delivery's build reported (verified live on
     the reference incident);
   - **a superset** → something is failing **outside** this build's scope, which read 1 may well have
     excluded — pursue it, because that is the shape flow B takes when the build was package-scoped;
   - **empty, and a later compilation succeeded** → the environment builds now; the failure is historical,
     and `rca-root-cause-vs-consequence`'s currency rules apply before anything is reported as live;
   - **empty, while this delivery's failed build is still the latest compilation** → the view does not
     reflect that build, and it settles nothing either way. `[observed]` — after a delivery whose build
     failed, `VwCompilationErrors` returned no rows while `CompilationHistory` held the failure and no
     compilation had run since; on another environment the same shape of incident left its one row in the
     view. So report both reads side by side, take the latest compilation's own result as the build state,
     and say the view did not confirm it. Never read this empty result as "the environment builds now", and
     never leave it out of the report because it does not fit.

#### The scope pass — what the delivery did, and whether the build's error names any of it

The five reads settle **whether** this delivery is implicated. They do not explain **how**, and on this
stage the explanation is rarely in the compiler's own words. The build is a **child of the delivery**: it
compiled a configuration that the same delivery had been rewriting, element by element, for the minutes
before it ran. The error therefore has to be read against that work — the elements, their content, and
what actually happened to each — and not on its own. **This is the pass that separates a coding mistake
from a delivery that did not fully land, and the two produce opposite recommendations.**

> **"The compilation was the only error in the whole install" is the shape this pass exists for, not a
> reason to skip it.** A stage that reported no error can still have applied **nothing** for a given
> element: a data binding whose installation type only applies it on a first install, an element whose
> actions were skipped, a copy that was not newer than the target's. None of those writes an error line.
> All of them leave the configuration referring to something that is not there — and the build is where
> that surfaces, as a diagnostic that looks exactly like someone's mistake in the delivered code.

**Three steps.**

1. **Inventory what the delivery touched.** The children carry it: each row's `Operation`, `Type`,
   `Element` and `PackageName` names one piece of work (§2.4). Keep it bounded — an aggregate by
   `Operation` and `Type` tells you which kinds of element are in play at all (are there `Data` children?
   SQL scripts? schemas from more than one package?), which is usually enough before step 2. Page the
   whole tree only when the identifiers from step 2 need to be looked up in it.
2. **Extract every identifier the diagnostics name — not just the file.** `ErrorText` is not only a
   message: it names a type, a member, a setting code, a column, a lookup value, a culture, a resource
   key. Those names are the join between the build and the delivery, and the file name alone is the one
   thing that never explains anything on its own.
3. **For each identifier, ask two questions in this order, and answer both with a read:**
   - **Did this delivery carry it?** Filter the children by that `Element` (and `Type`). Where the element
     is data, open its **delivered payload** (§2.4a): `data.json` holds, cell by cell, the value the
     delivery *intended* to apply, with the label it carried on the source.
   - **Is it on the target now?** Read the thing itself — the setting, the record, the schema, the column.

**Five outcomes, and they do not share a fix:**

| The two questions return | What it means | Where it goes |
|---|---|---|
| carried **and** present, and it still has what the error names | the delivery applied it; this identifier is not the story — keep reading the diagnostics | back to step 2 |
| carried **and** present, but **without the member the error names** — a column, a method, a property the failing code uses | the delivery removed it: the delivered version of the element no longer has that member, and code elsewhere still depends on it | **this is the cause**, even when the failing file belongs to a package the delivery did not carry. Establish that the member existed before the delivery: the failing file compiled clean in read 3's build and its schema has not changed since (no `Update` of it after that build) — a clean build of code that uses the member is the proof. Read the element as it is now (`describe_object` for an object) to confirm the member is gone. Two addressees: the package that removed the member (was the removal intended?) and the package that still uses it. `[observed]` — a delivery that removed an object's column failed its build in a file of an undelivered package that read the column; the file had compiled clean minutes before the delivery, and the delivery's own records carried no earlier metadata of the object, so that clean build was the evidence the column had existed |
| **carried but not present** | the delivery brought it and the environment did not take it — a silent skip, not a coding mistake | **this is the cause.** The mechanism belongs to the stage that skipped it: a binding's installation type or its column settings → `installation-catalog-data-bindings.md`; a copy not newer than the target's, or a package that did not travel → `installation-catalog-dependencies.md`; an element blocked because it is locked or locally modified → `installation-catalog-conflicts.md`. Re-enter §5.1's order with **that** stage |
| not carried, and the delivered code plainly expects it | the archive is incomplete | `installation-catalog-dependencies.md` |
| not carried, and nothing suggests it should have been | the delivered code refers to something that does not exist here | the code itself — the compilation catalog entry decides which shape |

**The second row is the one to slow down for, because its report is the inverse of the obvious one.** The
obvious report reads the diagnostic literally: the delivered code references something that is not there,
so the code is wrong — send the package back. The correct one is that the delivery carried **both** the
code and the thing it needs, the thing was not applied for a reason the delivery itself states, and the
fix is to make it apply. Getting this backwards returns a sound package to its developer, who cannot
reproduce anything, and leaves the environment broken in the same way. `rca-root-cause-vs-consequence` is the
skill for holding that line: the compiler diagnostic is the loudest event, and it is downstream of the
element that quietly did not land.

**Name the cell, not the category.** With the payload open, the report can say which value the delivery
intended and what the target holds instead — that pair *is* the finding. Without it the same report says
"some data did not arrive", which is the search the reader was expecting you to finish.

#### State exactly one verdict

| Verdict | Evidence that establishes it | What it changes |
|---|---|---|
| **The delivery broke the build** | every failing file belongs to a package this delivery carried, **and** either read 3 shows a clean build before it (or a failure set without these entries), **or** the failing package was **not on this environment at all** before the delivery; **or** a failing file belongs to a package the delivery did **not** carry, but it compiled clean in read 3's build, its schema has not changed since, and its error names something this delivery changed — the scope pass's "without the member" row | the cause is in the delivered package — the catalog entry decides which mechanism, and most of them are fixed on the **source** environment and re-exported, not on the target |
| **The build was already broken; the delivery only ran it** | no failing file belongs to a package this delivery carried, its error names nothing this delivery changed, **and** either the failing entries are present in read 3's earlier failure set, **or** the failing file's schema was saved after read 3's clean build and nothing compiled it until the delivery did — a failure that existed before the delivery but had never been built, so the last build looked clean. `[observed]` — code saved without publishing, then an unrelated delivery whose build failed on it | the delivery is **not** the cause. Say so plainly, name the pre-existing failure, and say that re-installing or rolling back the package will not fix it — the earlier breakage is fixed first, and only then does a rebuild say anything about the delivery |
| **Both — the delivery added to a build that was already failing** | read 2's set holds **both** kinds of entries — some that establish the second row and some that establish the first | the report carries **two lists with two addressees** and an order: the pre-existing failures go to whoever owns them, the delivered ones go back to the package, and neither list is allowed to hide inside the other |
| **Not established** | read 3 has nothing to compare against, and read 4 shows the history was cleared, aged out, or never held a build | say it in those words. Give what read 2's attribution does support ("every failing project belongs to the delivered package" is a real finding on its own), and state that whether the environment built cleanly beforehand **cannot be read here** — the requester may simply know, and asking is cheaper than guessing |

> **The second branch of the first row is the one that rescues a cleared history.** A package that
> *arrived* with this delivery cannot have been failing before it, so when the failing project belongs to
> one, read 3 has nothing left to decide and its absence stops mattering. Establish it, don't assume it:
> `SysPackage` (and `SysSchema` for the failing file's schema) carries a `CreatedOn` inside the delivery
> window — and mind that their `ModifiedOn` travels from the source and can pre-date it, so `CreatedOn` is
> the column that answers this. The installer log says the same thing in one line when the application is
> new here: `Skipped - Loading packages from database (new application)`. Verified live on a delivery
> whose build failed: the package, its schemas and the application were all created by that delivery, and
> the log carried that marker.

**Do not round the last row up to the first.** A delivery that carried the only failing project is
*consistent* with having broken the build, and that is worth saying — but when neither read 3 **nor** the
"it was not here before" check settles it, the verdict stays a strong indication, not a confirmed cause,
and the report says which of the two it is.

> **Coverage, stated honestly:** three shapes have been reproduced and read live end to end — the delivery
> broke the build in its own package; the delivery broke it by removing a member that an undelivered
> package still used; and the build was already broken by code saved after the last clean build and never
> compiled. The shape where the earlier build itself recorded the failure, and the "both" shape, were
> **not reproduced here** — the reads above are the ones the platform supports for them, not a recording
> of a run. Treat what reads 3 and 5 return as the evidence, and never present a "was already broken"
> verdict with more confidence than the reads you actually ran.

#### Then hand over

With the verdict in hand, take the diagnostics to `compilation.md` for the outcome vocabulary and
the `IsWarning` partition, then to `compilation-catalog-cases.md` for the signature — several of
its entries carry a **delivery variant** that is only correct in this context, and picking the stand-alone
reading of the same error code is how a target-side fix gets recommended for a source-side cause. Report
under **this** file's framing (§8): the delivery, the stage, the verdict above, then the mechanism.

**Do not hand over before the scope pass.** The catalog reads a signature and gives you a code-level
answer; on this stage that answer is only right once the scope pass has shown the delivered code is
actually the thing at fault. A build failure is routinely the *consequence* of an earlier stage of the
same delivery, and the pass above is how that is established rather than assumed.

## 6. Restore gate — "do I need to roll back?"

Every failed delivery raises this question, so it lives in the spine and applies to all catalogs. The
reflex answer is wrong often enough to be dangerous in both directions: an unnecessary restore throws
away work, and a skipped one leaves an environment failing in ways nobody connects to yesterday's
install.

Answer it in this order:

1. **Did the installation start?** (§3, the "did it start at all?" row.) If it failed before touching the
   site, there is nothing to restore. Say that explicitly — it is the most reassuring finding in this
   domain and the easiest to miss.
2. **Did it reach a stage that mutates state?** Everything from the SQL-scripts stage onward changes the
   configuration or the database; validation and backup do not.
   **The backup marker is a claim; the attachment is the evidence — and it is readable.** Six deliveries
   compared on one environment:

   | Delivery | Attachments |
   |---|---|
   | failed / rolled back | `install_*.txt` only |
   | **fresh** install of a new application | `install_*.txt` only |
   | re-install that changed nothing | `install_*.txt` only |
   | **install that replaced existing packages** | **`backup_*.zip` + `install_*.txt`** |

   So the archive appears when there was something to replace and the delivery did the work — **not**
   according to the delivery route: an App Hub install and a `clio push-app` both attached one under those
   conditions. Verified content: a real ZIP holding the **previous version of the replaced packages**
   (one `<package>.gz` per replaced package), so it is a package-level rollback artefact, not a
   whole-configuration snapshot.

   **So read `SysFile` for the record rather than trusting the log line.** A `backup_*.zip` present is a
   restorable artefact you can name and size. Its absence is not proof that nothing exists on the server —
   but on this evidence it usually means there was nothing to replace, which is itself the answer to "do I
   need to roll back". Either way `Configuration backup successfully created.` appears in the log in both
   cases, including installs that attached nothing, so the marker alone never settles it.
3. **Is the environment broken *now*, or did the delivery merely not apply?** These need different
   answers, and the check must stay inside the allowed reads: connectivity and identity via
   `creatio_get_current_user`, current build state via `VwCompilationErrors` (see `rca-env-readonly-query`).
   **"Is the site serving" and "is the workspace assembly initialized" are not answerable with the allowed
   tools** — they need an HTTP probe of the site or a server-side check. Do not reach for a tool outside the allowed list of the read-only rules (`rca-safety-and-access`; on the AI Platform, the system prompt) to get them: ask the human, and say which half of the picture you
   could read and which you could not.
3a. **Read whether the delivered elements are on the environment now — this step is three queries, not a
   judgement.** The log says what the installer attempted; only the environment says what survived, and
   the gate is a question about the environment. So before you write the restore answer, run these,
   filtered by the package name and application code the record already gave you (§2.1):

   ```
   SysPackage       Name eq '<package>'              -> Id, Name, InstallType, Maintainer
   SysSchema        Name startswith '<prefix>'       -> Id, Name, SysPackage.Name, IsChanged, IsLocked
   SysInstalledApp  Code eq '<application code>'     -> Id, Name, Code, Version
   ```

   **Zero rows from all three is a finding, not an empty result**: the delivery is no longer on this
   environment — most often because somebody uninstalled it afterwards, which a later `Delete` record for
   the same application will confirm — and the restore answer is then "nothing to restore", however
   alarming the log read. Rows present mean the partial state is live, and the reader needs to know which
   parts: name the packages and schemas you found and which of them the failing stage never reached.

   Whatever the three queries return, **the restore answer quotes them**. "An administrator should assess
   the partial state" is not an answer to this step — it is this step left undone, handed to someone who
   will have to run the same three queries themselves.
4. **Collect the evidence before recommending anything.** The installation log and the build/static-content
   log (plus the CI/CD job log, when the delivery came through one) — a retry or one targeted fix is often
   enough, and a rollback started before reading them destroys the evidence for the next attempt.
5. **Warn when a rollback itself is at risk.** Restoring a configuration that already had compilation
   errors *before* the install can fail partway, leaving a worse state than the one it was meant to
   repair. If step 3 shows pre-existing errors, say so as part of the recommendation.
6. **A rollback does not necessarily undo what the SQL scripts already did.** If the delivery reached the
   SQL-scripts stage, name the scripts the log reports as executed, and say plainly that a configuration
   rollback covers configuration — a script that dropped, disabled or altered something in the database
   may still be in effect, and **no allowed read can confirm the database's state**. Verified on the
   reference incident: `Disable_trigger_TRSysAdminUnitRoot_PostgreSql` ran at `15:31:31,647` and the
   delivery then rolled back, leaving a question only a DBA can answer. Hand it over as one — before a
   retry, not after.
7. **The agent never performs it.** Restore configuration, a backup restore, an uninstall — all are
   manual steps for a human, presented with their cost.

**The gate closes with a statement about this environment, not with a referral.** Its output is a
sentence naming what persisted, what did not, and whether a restorable artefact exists. "A rollback
decision is needed" and "have an administrator assess the partial changes" are not answers to the gate —
they are the gate's own question handed back, and they leave the reader exactly where they started.
Deferring to a human is right for the **action** (step 7) and for what no allowed read can settle (steps
3 and 6). It is never right for the **state**, because the state is readable: whether the delivered
elements are on the environment now, whether a `backup_*.zip` is attached, and whether the failure is
still the latest event of its kind are all answerable with the reads this domain already uses. So say
what you read first, then name what only a human can decide, and say why it needs them. An answer that
skips straight to the hand-off is indistinguishable, to the person reading it, from not having looked.

This gate feeds `rca-root-cause-vs-consequence`'s **Unblock now (temporary)** / **Proper fix** pair. In this
domain the reversal is usually "restore the configuration" or "uninstall the app", and its cost is the
whole delivery — name it. **The compilation stage is the exception:** there the delivered elements are what
a restore would take away (§4), so reversing the delivery is not the unblock; the unblock is the smallest
change on the target that makes the blocking reference resolve (§8). And the standing rule from that skill
applies unchanged: **a delivery that is no longer blocking anything gets no unblock branch at all.**

## 7. Currency & follow-up turns

The environment is shared and it changes between turns; deliveries are the loudest example. From the
user's second message onward, the **first** action is a narrow re-check: the latest delivery operation
(the §2.1 caption set), **any** status, narrow columns, `orderBy CreatedOn desc` —
compared against the record you examined earlier. Report newer runs before answering, per the follow-up-turn rule (`rca-orchestration`; on the AI Platform, the system prompt) and `rca-diagnosis-report` item 0.

Two facts specific to this domain expire at the turn boundary and are worth re-reading rather than
recalling:

- **A reinstall of an application that previously failed performs a full uninstall + reinstall of its
  packages.** That is recovery behavior, not damage — but it means the state you described last turn may
  have been rebuilt from scratch since.
- **"Another operation is in progress"** is live state. An installation or compilation running right now
  blocks the next one, and it will not be running by the time the user reads your answer.

## 8. Report

Hand to `rca-diagnosis-report`, leading with the two classifications:

1. **The outcome and the stage, stated precisely** — "the delivery failed at the data stage", "the
   delivery completed, but the changes were not applied". Never "the installation failed" alone: which
   stage it reached is what tells the user whether schemas, the database structure, or only data were
   affected.
2. **Root cause** — the named missing record, package, parent schema or blocked element, from the
   catalog's verify step.
   **On the compilation stage, §5.2's verdict comes first, in the user's own words** — the delivery broke
   the build, the build was already broken and the delivery only ran it, both, or it could not be
   established — because it decides who the recommendation is addressed to. A report that names a
   compiler error without saying which of the four it is has skipped the only question that separates a
   package defect from an environment that was already failing. When the verdict is "both", the two
   failure lists stay separate and each keeps its own addressee; when it is "not established", say what
   could not be read and why. Carry read 5 into the report too — what the current build-state read
   returned, **including an empty result that contradicts the failed build**; without it the report cannot
   say whether the break is live.
   **When the scope pass returned *carried but not present*, say that the delivered code is consistent** —
   it expects the version of the element that did not land — and address the fix to that element: the
   recommendation is about making it land, not about changing the delivered code. Advice to "align the
   contract" or to edit the calling code on the source turns a delivery that did not fully land back into a
   coding mistake, which is the naive diagnosis the scope pass exists to prevent.
3. **Evidence** — record `Id`/`Number` and operation/status; the `install_*.txt` `fileId` and `fileName`
   plus the verbatim lines you relied on; the child rows that named the element; the platform reads that
   corroborated it. Quote log lines exactly.
4. **Consequences** — briefly, so the reader is not misled by the noise further down the log.
   When the delivery stopped before its compilation stage but had already saved source-code schemas, the
   next build is one of the consequences: say what it will most likely fail on, and that nothing should
   compile until the fix is in (§3, the note on deliveries with no compilation stage).
5. **Restore answer** (§6) — explicitly, even when the answer is "nothing needs restoring".
   **On the compilation stage the default answer is no, and it comes with its reason:** the delivered
   elements are on the environment, and a restore takes them away together with the one that failed (§4).
   A restore becomes the answer only when the requester is abandoning this delivery — and it is never the
   "Unblock now" branch.
6. **Recommendation** — the delivery order or fix, as manual steps for a human, with the
   **Unblock now / Proper fix** pair only when a real reversal exists. On the compilation stage the unblock
   is the smallest change on the target that makes the blocking reference resolve, not a reversal of the
   delivery (`rca-root-cause-vs-consequence`, "Quick unblock").
   **A reinstall is not a step of that fix.** The delivered elements are already on the environment, so
   once the blocking reference resolves, a full compile finishes the job; recommend a reinstall only for a
   reason the evidence names, never "to complete the delivery". `[unverified here]` An application left in
   `Unsuccessful installation` is uninstalled before a repeat install of the same code starts, so such a
   reinstall first takes the delivered application away. What would settle it: a later install record for
   that application code whose children begin with its uninstall. Until then it is a caution for the
   recommendation, not a finding to report.
   **The unblock supplies what the delivery was missing; it never edits on the target an element the
   delivery brought.** When the delivery failed because something it needs did not travel — a package,
   the object a column points at, a parent schema — the unblock is to install that missing piece first
   and repeat the delivery. Pointing a delivered column elsewhere, deleting it, or recreating the missing
   object by hand is not a stopgap: the edited element becomes locally modified, so the next delivery of
   it is refused or overwrites the edit, and an object created by hand gets its own identifier, which
   clashes with the real one when that finally arrives — both are cases of
   `installation-catalog-conflicts.md`. On the compilation stage the change on the target is to code
   **the delivery did not bring**, which is why it is allowed there.
7. **Confidence & gaps** — in particular, whether the log was available, whether it matched the record,
   and what a single connected environment cannot show.

**When §2.1 found no record at all, the most useful sentence in the report is a request.** That case only —
a delivery with a record has its detail in the installer log, and asking such a user for anything from their
screen is wrong. But a delivery refused before it started leaves no record and no log (§2.1a), so an answer
that only reports "I found no installation record" hands the user nothing they can act on, and it reads like
a failure to look. Ask for the evidence that does exist and say where it is: **the full text of the refusal
dialog, copied as text** rather than screenshotted or summarised, because its table is the part that carries
the answer and the platform keeps no copy of it once the window is closed. Put that ask in the
**Recommendation**, as the next step, not buried in the gaps section — it is a step only the user can take.

Three things this domain must never do in a report. **Describe an earlier operation it did not open** —
an uninstall's existence, status and child count are visible in one row, and that row is exactly enough to
build a confident wrong narrative from (§2.4b). **Claim a difference between two environments it did
not observe** — one connected environment cannot diff dev against prod, so confirm this side, ask the
human for the other, and lower confidence; and **name any internal case id** (`IB*`, `IL*`, `IC*`, `ID*`,
`IR*`) or any other internal reference — see `rca-diagnosis-report`'s scrubbing rules, which apply from the
moment you match a catalog entry — including the compilation domain's own `C*` ids, which become
reachable from here through §5.2.

---

## Boundaries (current scope)

**Covered by this file:** the spine — §1 routing signature, §1a the non-incident route, §2 evidence
protocol, §3 stage classification, §4 outcome classification, §5 routing, §6 restore gate, §7 currency,
§8 report format.

**Covered by catalogs:** whichever of the catalog files in the table at the top of this file exist. Check the
table; a catalog that is not there yet is not covered, and §5 says what to do about that.

**Covered by `installation-catalog-reference.md`:** delivery-process consultation questions
(§1a's route), and — only after the §5.1 search has come back empty — what an unmatched error *class*
means and what would identify a specific case.

**Covered by the compilation domain, under this file's framing:** the **compilation stage** — §5.2 owns
the delivery gate and the hand-off, `compilation.md` the mechanics, and
`compilation-catalog-cases.md` the signatures, several of which carry a delivery variant. This is
no longer an uncovered stage, and reporting it as one is a gap in the search, not an honest boundary.

**Not covered here:**
- The validation/upload and static-content stages, plus the wider infrastructure family
  (disk, permissions, timeouts, web farm, cloud delivery preparation) — a separate catalog, not yet built.
  An error on one of those stages still gets an answer: §5.1's step 4 hands it the generic signature
  table, which is a class-level answer and says so.
- WorkspaceConsole's own failures — a separate domain.
- Anything outside a delivery — route via `references/NAVIGATION.md`.

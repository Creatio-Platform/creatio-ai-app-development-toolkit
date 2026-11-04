# Installation — artefacts reference (what a delivery installs, in what order, and what each leaves behind)

**Not a case file, and not part of the spine's §5.1 search.** `installation-pipeline-reference.md` owns the
**run** — its stages, its transaction, its log. This file owns **the artefact classes the run installs**:
schemas and their sources, SQL scripts, database structure, bound data, resources, install scripts, files
and reference assemblies. Per class: the ordering rule it obeys, the log lines it writes, the failure it can
raise, and **the read that proves what happened to it.**

Opened **on demand**, from the spine or from a catalog entry — never swept. Read it when a stage is
established and the question is *what that stage was actually doing to which artefact*.

Two files own things this one deliberately does not restate:

- **the per-element decision** — whether an incoming element is applied, skipped, deleted or refused —
  belongs to `installation-catalog-conflicts-reference.md`;
- **the binding's installation type** and what the pre-install validator reports about it belong to
  `installation-catalog-data-bindings-reference.md`.

This file assumes that decision has been taken and describes **what the delivery then does**.

Tags per statement: **`[observed]`** (reproduced on a connected environment, read named) and
**`[unverified here]`** (product behaviour, not reproduced here). **Everything below is
`[unverified here]`** unless it says otherwise. Nothing here may be reported on this
file's authority alone.

---

## 1. The seven artefact classes, and the order they are installed in

One delivery touches up to seven kinds of thing. They are **not** installed in the order a person would
guess, and the order is what makes half of this domain's failures explicable:

| Order | Artefact class | Written into |
|---|---|---|
| 1 | **Install scripts — before pass** | nothing of its own; it runs code against the environment |
| 2 | **SQL scripts — before-package pass** | the database, directly |
| 3 | **Package descriptors, schemas, schema-data descriptors, files, reference assemblies** | the configuration metadata tables |
| 4 | **Resources and caption localization** | the localization tables |
| 5 | **Schema sources** | generated source, on disk |
| 6 | **Database structure** | the database, as structural change |
| 7 | **SQL scripts — after passes**, **bound data**, **install scripts — after pass**, **package localizable data** | the database, directly |

**Three consequences worth stating in a report:**

1. **Sources are generated before the structure is updated.** A source that reads a column the structure
   step is about to add fails — and fails *first*, so the log blames generation for a structural cause.
2. **Bound data is installed after the structure and after the sources.** Anything that needs a data row to
   exist at generation time — a column default reading a setting, for instance — cannot get it from the same
   delivery. This is a **sequencing limitation, not a defect**, and it is the mechanism behind a whole family
   of "works on the second install" reports. `[unverified here]`
3. **A delivery reporting success can still have written nothing of class 6 or 7** if the switches were off
   (the console channel's own reference covers those), or if the environment refused part-way.

---

## 2. Schemas and generated sources

**What the delivery writes:** the schema metadata, its properties, and — separately — the generated source
for every schema that changed, plus the dependants that have to follow it.

**Log lines:** `Schema "X" saved in package "Y"` at the metadata stage,
`Schema source code "X" from package Y generated` at the generation stage.

**Before generation, the environment's schema managers are refreshed** — fully, partially, or by clearing
the cache, depending on how the environment is configured. A delivery that installs into a running site is
therefore mutating state other requests are reading; this is why a generation failure is sometimes
accompanied by unrelated runtime errors in the same minutes, and why those errors are **consequences, not
evidence**. `[unverified here]`

**Generation may run in the background** while the delivery continues, and is joined later. So:

> A source-generation error can be logged **after** lines belonging to a later stage. Do not read log order
> as causal order for this one class.

**What it leaves behind:** `SysSchema.LastError` on a schema whose install errored. *Verify:* read
`SysSchema` filtered by the package, and report `LastError` verbatim rather than the log's summary line.

**Forward type declarations are regenerated unconditionally on an install**, to prevent a stale set
surviving a package that changed shape. A build failure that names a type which "should exist" and does, on
a *previous* delivery's terms, is worth checking against this. `[unverified here]`

---

## 3. SQL scripts

The most order-sensitive class, and the one whose failures read as database errors rather than delivery
errors.

**Three passes, not one:** before the package save, after the database structure update, and after the bound
data. A script's pass is a property of the script, declared when it was authored — so *when* a script runs
is not something the environment or the installer decides. **The pass explains the error**: a script that
fails in the before pass ran against the structure as it was *before* the delivery.

**Log line:** `Installing SQL scripts`, then per-script save lines at the metadata stage.

**What the delivery checks before running one:** that a connected script it depends on exists, that a
script exists for the database engine in use, that its declared install type and engine type are
consistent, that its text is not empty, and that its name uses Latin characters only. Each of those has its
own refusal, and each names the script. `[unverified here]`

**Backward compatibility is a gate, not a warning.** Scripts can be marked as not backward-compatible, and
that mark is what a **restore** later refuses on (the pipeline reference's §6). The delivery path itself is
routinely run with that check suppressed — which is precisely why the restore is the step that discovers
the problem, long after the delivery that introduced it. State this when recommending a rollback.

**When a script fails, the log gets the database's message *and the script's own text appended*.** That is
the single most useful artefact in this class: the failing statement is in the installer log, not only in
the database's error. Quote it.

**What it leaves behind:** `SysPackageSqlScript` — `NeedInstall` set, and `LastError` holding the message.
*Verify:* read those two columns filtered by the package. A script still marked after a later successful
delivery was **not** retried by it.

---

## 4. Database structure

**What it does:** turns the schema metadata into tables and columns — base schemas first, then the schemas
that extend them.

**Log lines:** `Updating tables structure in database`, then per schema
`Actions added for schema "X" from package "Y" in N sec` or `Actions skipped …`, and
`Structure saved: X from package Y`. **`Actions skipped` is not an error** — it means the delivery decided
this schema's structure needed nothing. Read it as evidence, not as a miss.

**Three switches change what this stage does**, and all three are deliberate choices of whoever ran the
delivery: whether constraints are created, whether validation actions are executed, and whether they are
skipped. **Skipping constraints means foreign keys are not created** — data that would have been rejected is
accepted, and the problem surfaces later as integrity failures nobody can trace to a delivery. Say so when
the evidence shows it was used. `[unverified here]`

**This is the stage that times out.** Structural change on a large table runs under the environment's single
database command timeout (pipeline reference §8) — there is no per-delivery limit. A cancelled statement
here is almost never a package defect.

**What it leaves behind:** committed structure. **Not covered by any transaction** — see the pipeline
reference's §4. A delivery that failed after this stage has already altered the database.

---

## 5. Bound data

**What it does:** writes the rows the package carries into the target's tables, in dependency order — or in
parallel, when the environment is configured for it.

**Log lines:** `Installing data`, then `Data "X" from package "Y" installed` and
`Lookup values "X" … installed`.

**One exclusion is worth knowing**, because it produces a "nothing happened" report that is correct
behaviour: **data that merely moved from one package to another is not reinstalled.** The delivery
recognizes it as the same data under new ownership and leaves the rows alone. `[unverified here]` —
*verify:* the descriptor exists on the target under the new package while no `Data … installed` line
appears for it.

**What it leaves behind:** `SysPackageSchemaData` — `NeedInstall` set and `LastError` holding the message,
truncated to the column's size. **The truncation matters:** the log holds the full message, the column holds
the beginning of it. Quote the log; use the column to prove the failure is still outstanding.

Everything about *why* a particular binding was or was not applied — its installation type, its
force-update semantics, what the validator said about it before the install — is
`installation-catalog-data-bindings-reference.md`, not this file.

---

## 6. Resources and localization

**Two distinct things**, and conflating them mis-routes a diagnosis:

- **schema resources** — the localizable strings each schema carries;
- **caption localization** — the schema's own captions, resolved per culture.

Both are saved as part of the delivery, and the environment decides whether they are saved **inside the
metadata transaction or after it**. The common configuration puts them **outside**. `[unverified here]`

**Why that matters for a report:** when resources are installed outside the transaction, a metadata rollback
does **not** take the resources with it. The environment can end up holding resources for elements whose
metadata was rolled back — a shape that looks like corruption and is in fact the documented consequence of
that setting. Say which configuration the environment uses before calling anything corrupt.

Localized data carried by a package is installed in the last group, after the install scripts, when the
environment has that behaviour enabled at all.

Culture-level mechanics — what happens when a package carries a culture the target does not have, and what
a delivery does to resources for cultures it does not carry — belong to
`installation-catalog-localization.md`.

---

## 7. Install scripts

Code the package runs against the environment, in up to four positions: **before the install**, **after any
package**, **after the install**, and a **default** set when the package declares none.

**Log lines:** `Executing install scripts`, `Install script "X" from package "Y" executed`, and
`Executing default install scripts`.

**Two things to say plainly when one of these fails:**

1. **They are not covered by the transaction** in either direction. A before-pass script has already run
   when the metadata save is rolled back; an after-pass script runs against a database the delivery has
   already changed.
2. **Executing them is a separate permission.** A delivery can be allowed to start and refused at this step
   (pipeline reference §11). The log's last successful marker is what tells the two apart.

---

## 8. Files and reference assemblies

Packages carry file content and compiled libraries. They are written at the metadata stage —
`Files saved in package "X"`, and per-assembly save lines — and land on disk in the site's own directories.

**The failure mode is ownership of the file, not the package.** A library already loaded by the running
application, or held by another process, cannot be replaced; the delivery reports a file-system error naming
the path. Nothing about this is readable from a platform query: it is a fact about the machine. Say that
rather than inferring from the package. `[unverified here]`

Their downstream effect **is** readable: an assembly-carrying package that changed is what makes an
application restart necessary (pipeline reference §9).

---

## 9. The package itself, and the hierarchy

Beyond its contents, every delivery writes the **package descriptor** — `Package "X" saved` — and then
actualizes the **package hierarchy**: `Package hierarchy actualization is started`, and
`… completed. Affected records: N`.

**That count is evidence.** A hierarchy actualization affecting zero records on a delivery that claims to
have added a dependency means the dependency did not land. *Verify:* read `SysPackage` for the packages in
the log, and `SysPackageDependency` for the edges the delivery should have created.

**A cyclic dependency is refused**, and the refusal names the sequence. A delivery that appears to hang
while resolving a large hierarchy is a different problem with the same look — the pipeline reference's §8
covers which timeout is actually firing.

---

## 10. What to read, per class, in one place

| Class | The read that proves its state |
|---|---|
| schemas | `SysSchema` — the element, and `LastError` |
| sources | no direct read; the log's generation lines, and the compile result |
| SQL scripts | `SysPackageSqlScript` — `NeedInstall`, `LastError` |
| structure | the environment's actual columns; the log's `Structure saved` / `Actions skipped` lines |
| bound data | `SysPackageSchemaData` — `NeedInstall`, `LastError`; and the rows themselves |
| resources | the localized values per culture |
| install scripts | the log only — nothing is marked afterwards |
| files / assemblies | the log only; the file system is not readable from here |
| package & hierarchy | `SysPackage`, `SysPackageDependency` |

**The two columns in the middle of that table are the domain's best evidence.** They outlive the log, they
say what is still outstanding rather than what once failed, and they are readable on any environment
regardless of which channel delivered.

---

## Boundaries

- Mechanism only — no signature is matched here and no incident is diagnosed from this file.
- The per-element decision is `installation-catalog-conflicts-reference.md`; the binding's type and the
  pre-install validator are `installation-catalog-data-bindings-reference.md`; the run itself is
  `installation-pipeline-reference.md`; applications, packages and dependency resolution are
  `installation-applications-reference.md`.
- Compiler errors from the build that follows a delivery are the compilation domain's.

# Installation — applications & dependencies reference (the layer above packages)

**Not a case file, and not part of the spine's §5.1 search.** A delivery installs **packages**; a user
installs an **application**. This file owns the layer between those two words — how an application is
recorded, how dependencies are resolved before anything is installed, what the environment refuses and why,
and what happens on a second attempt after a failed one.

Opened **on demand**, from the spine or a catalog entry. Read it when the incident is about an
*application* rather than an element: a refusal before the install, a dependency the target does not have,
an application that will not delete, a version that will not go backwards, or a second install that removed
things the first one created.

Tags per statement: **`[observed]`** (reproduced on a connected environment, read named) and
**`[unverified here]`** (product behaviour, not reproduced here). **Everything below starts as
`[unverified here]`.** Nothing here may be reported on this file's authority alone.

---

## 1. Applications and packages are different objects

An application is a **named grouping with its own identity, version and dependency graph**; packages are
what actually carry configuration. One application owns several packages; a package can be linked to an
application only once.

**The tables that record it:**

| Table | What it holds |
|---|---|
| `SysInstalledApp` | the application on this environment — its code, name, version, and installation status |
| `SysPackageInInstalledApp` | which packages belong to which application |
| `SysAppDependency` | the edges between applications |
| `SysPackage`, `SysPackageDependency` | the packages themselves and the edges between them |

**Two graphs exist in parallel** — between applications and between packages — and they can disagree.
An incident phrased as "the dependency is there" is often true of one graph and false of the other. *Verify:*
read both, and say which one you are quoting.

**The application's own record is rebuilt from the archive's descriptor** during the delivery, which is how
an application acquires its name, version and dependency edges on the target. A descriptor that is
malformed, or carries more than one application definition in a package, is refused before anything is
installed. `[unverified here]`

> **A trap in the activity log, worth knowing before you quote it.** On the delivery's record the field
> that reads like a name carries the application **code**, and the field that reads like a code carries the
> **name**. Quoting them the way they are labelled produces a report that names the wrong thing. Read both,
> and sanity-check against `SysInstalledApp`.

---

## 2. The pre-install dependency analysis — the refusal that happens before anything is touched

Before installing, the platform analyses what the archive needs against what the environment has. When the
analysis objects, **the delivery is refused with nothing written**. The objections are a closed set, and
naming the right one is most of the diagnosis:

| Objection | What it means |
|---|---|
| **required platform version** | the application needs a newer platform than this environment runs |
| **missing dependencies** | something the application depends on is absent and cannot be obtained |
| **dependency version conflict** | present, but at a version the application cannot accept |
| **bundle dependency version conflict** | the same, inside a multi-application archive |
| **dependent apps required version conflict** | applications *already installed here* require a version this delivery would break |
| **downgrade version conflict** / **skipped because it would downgrade** | the archive is older than what is installed |
| **compilation errors** | the environment's configuration does not currently build |

The last two deserve emphasis in a report:

- **A downgrade is refused, or silently skipped, by design.** "We reinstalled the previous version and
  nothing happened" is this, not a failed delivery.
- **A pre-existing build failure blocks a delivery that has nothing to do with it.** The user experiences it
  as the package being rejected; the cause is the environment's prior state. This is the same distinction
  the spine's compilation gate makes, arriving one step earlier.

**Where this refusal is reported changes what evidence exists.** Refused in the application-management UI,
before the installer is called: no activity-log record and no installer log. Refused by a command-line
push, which reaches the installer: a record *and* a log. The spine's §2.1a owns that split; here is the
mechanism behind it.

**The analysis can also rewrite the delivery.** When it can resolve the gap itself, it produces a corrected
bundle, the working directories are replaced, and **that** is what installs. So the packages that arrive can
differ from the archive the user uploaded — the log's load lines are the authority, not the file name.

**On a closed network the analysis cannot run at all.** The environment reaches an external installation
service for it; with no route, the delivery fails or hangs at this step. The documented alternative is to
disable automatic dependency resolution and install dependencies by hand — an **infrastructure decision for
a human**, not a configuration fix this agent performs.

---

## 3. The package validator — what it refuses, and what it does not check

Separately from the application-level analysis, the package content is validated. Its refusals name the
package:

- **a dependency cycle**, with the sequence printed;
- **an invalid dependency** declared in a package's descriptor;
- **a package that already exists here under a different identity** — same name, different `UId`. This is
  the one to watch: two packages can share a name and be different objects, and several later behaviours
  (notably deletion, §5) work by **name**.

**What is not validated by default is as important as what is.** A delivery routinely runs with schema
validation, hierarchy validation, binding validation and script validation **off** — they are opt-in. So:

> "It installed, therefore the package is valid" is not an inference the evidence supports.

*Verify:* the presence of `Packages validation started` / `Packages have been validated` in the installer
log tells you a validation pass ran at all; its absence means the delivery went straight to installing.

---

## 4. Optional and plugin packages

An application can carry packages that are **not** installed unconditionally: optional content, and plugin
packages that only apply when their counterpart application is present. Before the install, the delivery
decides which of them apply to this environment, and **excludes the rest**.

Two consequences that are routinely reported as bugs:

1. **A package in the archive that is not in the environment afterwards may have been excluded, not failed.**
   There is no error for it. *Verify:* `Package "X" loaded` lines list what was actually taken from the
   archive; `SysPackage` says what exists now.
2. **A package can be deactivated rather than removed.** Deactivated packages are tracked, restored by a
   later restore, and are invisible to anyone reading only the active configuration.

---

## 5. Deleting and deactivating — what the environment refuses

A delivery may remove packages as well as add them. The refusals are explicit, and each names the obstacle:

- **the package contains locked items** — deletion is blocked;
- **another package or application depends on it** — deletion is blocked, and the dependant is named;
- **it is the current package** — the delivery refuses to delete the package it is installing into.

**Deletion works by name.** With two same-named packages in the configuration (§3), this is the mechanism
behind "we deleted one and the other disappeared" — and it is a product behaviour to state plainly, not an
accusation about what someone clicked.

*Verify:* `SysPackage` and `SysPackageDependency` for the named package and its dependants;
`SysPackageInInstalledApp` for which application claims it.

---

## 6. Install status, and what a second attempt does

The application's record carries the outcome of its installation. **A failed one is remembered**, and it
changes the next delivery's behaviour:

> When an application whose previous installation failed is installed again, the platform **uninstalls it
> first** and then installs it — a full replacement, not an incremental retry.

This is intended recovery behaviour, and it is the mechanism behind the most alarming report in this
domain: *"the second install removed things the first one had created."* Anything generated on the target
and attached to that application — including packages created there rather than delivered — goes with the
uninstall. `[unverified here]`

**Say this before recommending "just install it again."** It is the one recommendation in this domain that
can destroy work, and the customer cannot be expected to know it.

*Verify:* read the application's installation status in `SysInstalledApp`, together with the activity-log
records for the two attempts. Two records where the first is an error and the second reports an uninstall
step is the confirmation.

**After the install, the platform verifies the packages actually arrived.** A delivery whose metadata
transaction was rolled back is caught here rather than reported as success — which is why an application
can end in the failed state while the log's element lines all look healthy.

---

## 7. Editability, ownership and where changes land

Packages carry a **maintainer**. Packages whose maintainer is not this environment's are **read-only** —
visible, installed, not editable. A system setting governs whether an application delivered from an archive
may be edited by its own maintainer here; with it off, a delivered application is locked to its recipient.

**Two effects the user experiences as defects:**

1. **Changes made in a designer land in a package the user did not choose.** The platform picks a target
   package by position in the hierarchy, not by expectation. An "our changes went missing" report is often
   this.
2. **An application with no unlocked package accumulates auto-generated ones** to hold designer changes.
   Those packages exist only on that environment — and §6's uninstall-then-install takes them with it.

*Verify:* `SysPackage` for maintainer and lock state; the relevant system setting through the settings read.
Whether a maintainer *should* be changed is a decision for a human, and the change is a manual step.

---

## 8. Versions — the three gates

Three different version checks can each refuse a delivery, and they produce different messages:

| Gate | What it compares |
|---|---|
| **platform version** | what the application declares it needs against what the environment runs |
| **application version** | the archive against the installed copy — older is refused or skipped (§2) |
| **configuration version** | the environment's own recorded version against its binaries — see the console reference's §4 |

**The third is not about the package at all.** It blocks operations after an upgrade until an install or an
explicit version update reconciles the two, and it produces refusals that look like delivery problems.
*Verify:* read the `ConfigurationVersion` system setting and compare with what the environment reports.

---

## 9. What this layer records for an RCA

| Question | The read |
|---|---|
| does this application exist here, and in what state? | `SysInstalledApp` — code, version, installation status |
| which packages does it own? | `SysPackageInInstalledApp` |
| what does it depend on, at application level? | `SysAppDependency` |
| what does it depend on, at package level? | `SysPackageDependency` |
| is a named dependency genuinely absent? | `SysPackage` filtered by name — an empty result **is** the evidence |
| was it delivered, and when? | `ConfActivityLog`, with the caveat in §1 about the two swapped fields |

**Name what is missing.** A refusal lists what it wanted; the environment says which of those are truly
absent *here*. Reporting the list from the dialog is quoting the user back at themselves; reporting the read
is a diagnosis.

**These reads are the spine's §2.4c inventory pass**, which runs on *every* installation incident rather
than only when the symptom sounds application-shaped. This file explains what each row means; the spine
says when to gather them and warns about the one thing the pass cannot do — it is a snapshot of the
environment **now**, not of the state the delivery found.

---

## Boundaries

- Mechanism only — no signature is matched here and no incident is diagnosed from this file.
- The run is `installation-pipeline-reference.md`; the artefact classes are
  `installation-artefacts-reference.md`; the per-element decision is
  `installation-catalog-conflicts-reference.md`; binding types are
  `installation-catalog-data-bindings-reference.md`; the command-line channel is
  `installation-workspaceconsole-reference.md`.
- Licensing and product bundles are adjacent to this layer and are **not** readable from a connected
  environment — route them, do not diagnose them.

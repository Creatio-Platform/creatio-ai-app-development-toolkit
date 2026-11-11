---
name: rca-knowledge-base
description: The RCA knowledge base — the domain knowledge of the Root-Cause Analysis agent. references/NAVIGATION.md classifies an incident and routes it; each references/<domain>.md is the playbook for one domain. Opened by the investigation loop at its classify step and read WHOLE, on demand — deterministic navigation, not retrieval. Reference material, never the starting point of an investigation on its own.
user-invocable: false
supported_modes: [Builder, SDK]
---

# rca-knowledge-base — classify, then follow the domain playbook

This one skill carries the whole RCA knowledge base as on-demand reference files, so navigation is
**deterministic** (read the right file in full, in order). It is **not** per-domain:
`./references/NAVIGATION.md` is the single general cross-domain router, and each domain is one file under
`./references/` (e.g. `./references/compilation.md`). New domains are **new files here**, never new skills.

## How to use (every investigation)

1. **Read `./references/NAVIGATION.md` in full.** Use its routing table to classify the incident from the
   `ConfActivityLog` record's **Operation** / **Status** (or from the user's symptom).
2. **Open the matching domain file in `./references/` and read it in full**, then follow it top to bottom.
   Today `./references/compilation.md`, `./references/feature-flags-and-settings.md` and
   `./references/installation.md` exist.
3. **Where a domain ships as a spine plus catalogs, read the spine first and open a catalog only from
   the spine.** Both `installation.md` and `compilation.md` work this way. The spine owns the
   classification that decides *which* catalog applies — and whether one applies at all. Opening a
   catalog first inverts the loop: you arrive holding a signature you already recognized and then look
   for evidence to support it, which is how a confident wrong answer is built. The catalogs say this in
   their own headers, but that guard is unreachable by construction — reading the header means the file
   is already open. So: the spine first, then the catalogs — one at a time, in the order the spine gives,
   stopping at the first whose *Verify* confirms.
4. **Open a catalog before running the reads it prescribes, not before writing the report.** A catalog
   entry is not a list of conclusions — it carries the read discipline (which of two tables a constraint
   means, what to bound a query with, that a probe code goes one per call, what an empty result does and
   does not prove). Reads made before it is loaded are made without it.
5. **A delivery question with nothing broken in it does not run the loop** — and neither does a failure
   the user has already explained (what they did, plus the error the consultation entry documents for
   exactly that). `installation.md` §1a owns
   that route: it skips the evidence protocol, the stage, the outcome, the catalog search and the restore
   gate, and answers from `installation-catalog-reference.md`'s consultation half — the rule, then the
   supported procedure as manual steps, then one sentence saying the answer is documented platform
   behaviour rather than a read of this environment. Do not dress such an answer up as an investigation.
   It reads nothing by default: reads are offered, not taken, and a name quoted as an example (a package
   like `App_8rcxi7x`) is never looked up. An offer to look at a specific run names its condition: the
   installer log works from any environment, the log record number only if that install ran on the
   environment this agent is connected to.
6. If the incident classifies to a domain with **no file yet**, say the domain is not yet covered and hand
   back the evidence gathered — do **not** improvise a diagnosis. An `installation.md` stage whose catalog
   has not landed yet is the one exception: the spine reports the stage and the evidence, and that is a
   **covered** outcome.

Always read these files **whole** (not summarized, not partially) — the domain files are ordered procedures
and every step matters (e.g. the compilation domain's mandatory warnings gate). Do not skip steps.

## What lives here

```
references/
├── NAVIGATION.md                        the single, general cross-domain classifier/router
├── compilation.md                       the compilation domain playbook (spine)
├── compilation-catalog-cases.md         compilation: cases matched by error signature, including a
│                                        build that failed during a delivery
├── compilation-catalog-reference.md     compilation: generic CS#### fallback + advisory topics
├── feature-flags-and-settings.md        the feature flags & system settings domain playbook (scoped)
├── installation.md                      the installation (delivery) domain spine — stages, outcomes,
│                                        the installation-log evidence protocol, the restore gate
│
│   installation catalogs — opened from the spine's search order, one at a time
├── installation-catalog-data-bindings.md  data/binding failures at the data stage
├── installation-catalog-localization.md   culture & localized-resource failures
├── installation-catalog-dependencies.md   missing packages, parent schemas, install order
├── installation-catalog-conflicts.md      locking, local edits, name/UId clashes, target DB structure,
│                                        drift
├── installation-catalog-infrastructure.md        the environment refused — one family in two files,
├── installation-catalog-infrastructure-files.md  reachable from any stage; searched as one
│
│   installation mechanism files — no signatures; opened from an entry or the spine, never swept
├── installation-pipeline-reference.md            the run: channels, stage order and markers, what is
│                                                 committed on failure, retry markers, backups
├── installation-artefacts-reference.md           what is installed, per artefact class
├── installation-applications-reference.md        applications, packages, dependency resolution
├── installation-workspaceconsole-reference.md    the command-line channel against a stopped site
├── installation-clio-reference.md                the API-driven command-line channel
├── installation-catalog-data-bindings-reference.md  binding installation types and validator messages
├── installation-catalog-conflicts-reference.md      how a delivery decides what to do with each
│                                                    element it meets, and the read that proves it
│
└── installation-catalog-reference.md      NOT a catalog — the generic signature fallback (only after
                                           every catalog) + the delivery consultation topics, reached
                                           from the spine's §1a
```

> `installation.md` is a **spine**: all of its catalogs are installed here, and its table names the one
> that owns an incident so a report can say which. Should the search order reach a catalog that is not in
> `./references/`, that is a **covered** outcome, not a dead end: the spine's §5 says what to report
> instead. `installation-catalog-reference.md` is not part of that search — the spine opens it in two
> cases only: after every catalog has been tried without a match, and for a delivery question that is not
> an incident.

> The files live **flat** under `./references/`, with no sub-folders: every cross-reference between them is
> a bare file name, and the platform's skill editor cannot create sub-folders anyway. That is purely
> organizational — navigation is unchanged.

The general RCA skills (`rca-cal-read`, `rca-env-readonly-query`, `rca-cal-file-read`,
`rca-root-cause-vs-consequence`, `rca-diagnosis-report`) provide the *how to investigate*; this knowledge
base provides the *what an incident means and how to fix it*.

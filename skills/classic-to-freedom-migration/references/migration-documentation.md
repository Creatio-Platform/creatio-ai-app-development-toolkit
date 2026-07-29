# Migration Documentation Standard

A large Classic-to-Freedom migration cannot be tracked from memory. This standard defines a small set of living documents so that:

- the agent never loses state between sessions and never silently skips an artifact,
- the person directing the agent can see scope, progress, decisions, and risks at any time,
- everything is persisted in the repo/workspace and updated as work proceeds.

Match the user's language inside the documents.

> **⚠ Data-sensitivity — redact before committing.** The generated `plan.md` (and the design spec inside it)
> can embed REAL customer content: field/tab captions and business-rule VALUES resolved from
> `manifest.resources` / `columnTitles`, plus stand schema/package names. Treat the doc set as potentially
> sensitive — keep the migration-project repo private, or redact captions/values before committing to a
> shared/public repo or pasting into an issue. (The stand-sourced INPUTS — manifest + fetched bodies — are
> written to a temp dir OUTSIDE the repo and deleted when the migration completes, so they are never in git;
> this warning is about the OUTPUT doc set, which IS meant to be versioned.)

## Scale The Document Set To The Scope

| Scope | Required documents |
| --- | --- |
| Single section / page / detail / mini page | `plan.md` and `worklog.md`. (Status is tracked in `worklog.md` / the Plan-vs-Done table — never inside `plan.md`, which is frozen after approval.) |
| Whole package / application | Full set: `README.md`, `discovery.md`, `plan.md`, `roadmap.md`, `decisions.md`, `worklog.md`. |

Never skip `worklog.md`: it is the persisted memory of what actually happened.

For single-section, this is deliberately light: **`plan.md` is engine-WRITTEN** (`migrate.mjs --plan --out plan.md`, its values supplied via `manifest.planMeta`), so the only hand-maintained document is `worklog.md`. Do not add `README.md`/`discovery.md`/`roadmap.md`/`decisions.md` for a single section — those are the whole-package set.

## Location And Naming

Create one folder per migration project and keep it versioned in the repo/workspace:

```
migrations/<app-or-section-slug>/
  README.md       # dashboard and single entry point (status rollup)
  discovery.md    # inventory and dependency graph (facts)
  plan.md         # approval-gated migration plan (frozen after approval)
  roadmap.md      # living execution tracker (status of every task)
  decisions.md    # decision and approval log (append-only)
  worklog.md      # session log and runtime read-back evidence (append-only)
```

Use a stable slug, for example `gdpr-for-creatio`. Do not rename the folder mid-project.

## Document Responsibilities

Each document has one job. Do not duplicate the same fact in two documents; link instead.

### README.md — dashboard and entry point
The control panel. Anyone opening the folder reads this first.
- scope, environment, target package/application, start date, last-updated date
- overall progress as counts by status (for example `12 tasks: 3 VALIDATED, 4 DONE, 2 WIP, 2 TODO, 1 BLOCKED`)
- per-section status summary with links into `roadmap.md`
- current blockers (rollup from `decisions.md` / `roadmap.md`)
- "Next actions" (the immediate queue)
- links to all other documents

### discovery.md — the facts
Read-only findings from runtime discovery.
- package/application inventory: sections, pages, details, mini pages, entities, owning app, maintainer, lock/editability
- classification of every Classic schema: **own section/page** vs **replacing/extension schema**
- dependency graph: which pages depend on which entities, details, and backend schemas
- missing-source gaps recorded as risks
Separate confirmed facts from inferences.

### plan.md — the approval-gated plan
Holds the **verbatim `node engine/migrate.mjs <manifest> --plan` output** (SKILL.md Contract rule 2) — **written directly by `--out`**, its Overview/Main-scope values supplied via `manifest.planMeta`, plus the discovery provenance behind it. `references/migration-plan-template.md` is the *contents reference / Node-unavailable fallback*, not a second hand-filled plan.
- This is the contract the user approves.
- **Frozen after approval.** Do not edit it to reflect progress.
- Any scope or strategy change requires a new entry in `decisions.md`, explicit re-approval, and a version bump in `plan.md` (for example `v2`), recording what changed and why.

### roadmap.md — the living tracker
The single source of truth for "what is done". Updated continuously.
- one task row per migratable artifact, with a stable ID, kind, Freedom target, dependencies, status, and evidence link
- ordered by dependency (entities/data sources first, then own sections, then replacing/extension deltas, then backend/process/permission logic)
- a Definition of Done reference per task so nothing is marked complete prematurely
The README dashboard is a rollup of this file; if they disagree, `roadmap.md` wins and the README must be refreshed.

### decisions.md — decision and approval log
Append-only. Every entry has a date.
- plan approval, switch-over approval, package-placement decision, template choices that were not obvious, dropped artifacts with reason, and any re-approval after a scope change
- one row/section per decision: date, decision, rationale, who approved, affected tasks

### worklog.md — session log and evidence
Append-only, chronological. One entry per working session.
- date, scope of the session, actions taken, tools/operations used
- runtime read-back evidence (see Definition Of Done)
- which roadmap tasks changed status
- open issues carried to the next session

## Status Vocabulary

Use exactly these statuses everywhere:

| Status | Meaning |
| --- | --- |
| `TODO` | Identified, not started. |
| `WIP` | In progress this session. |
| `BLOCKED` | Waiting on a decision or dependency. Must link to a `decisions.md` entry or a blocking task ID. |
| `DONE` | Implemented, but not yet validated against runtime. |
| `VALIDATED` | Implemented and validated with recorded evidence (see Definition Of Done). |
| `DROPPED` | Intentionally not migrated. Must record the reason. |

## Task Identifiers

Give every artifact a stable ID so the agent and the user reference the same thing:

- `<SECTION>-SEC` for an own section list page (for example `GDPR-SEC`)
- `<SECTION>-FORM` for an own form page (for example `GDPR-FORM`)
- `<SECTION>-DET-<n>` for a detail
- `<ENTITY>-EXT` for a replacing/extension delta on a base section (for example `CONTACT-EXT`)
- `<ENTITY>-DS` for an entity/data-source prerequisite
- `BACKEND-<n>` for backend/process/permission work

IDs never change once assigned, even if the task is split or dropped.

## Definition Of Done

A task may only move to `VALIDATED` after runtime read-back is recorded in `worklog.md`:

- schema UId and package name confirmed (artifact landed in the intended design package)
- `SCHEMA_DEPS` correct after any append/merge
- new view components present in the merged bundle
- handlers / converters / validators present as planned
- localizable resources present
- page schema validation passed
- no route/section-code collision introduced (Classic route still resolves where intended; no duplicate Freedom section)

If any item cannot be verified, the task stays `DONE` and the gap is logged as a risk.

## Update Discipline (Cardinal Rules)

1. Create the document set during the planning step, before the approval gate.
2. At the start of every session, read `README.md` and `roadmap.md` to recover state. Do not rely on memory.
3. After every meaningful action, update `roadmap.md` status and append to `worklog.md` with evidence. Refresh the README dashboard counts.
4. `plan.md` is frozen after approval. Scope/strategy changes go through `decisions.md` + re-approval + a `plan.md` version bump.
5. `roadmap.md` is the single source of truth for status; the README is a rollup of it.
6. Never mark `VALIDATED` without the Definition Of Done evidence.
7. Record every approval and every non-obvious decision in `decisions.md` with a date.
8. Before any create operation, check existing Freedom artifacts and the roadmap to avoid duplicates.

## Templates

### README.md
```markdown
# Migration: <app/section name>

- Scope: single-section | whole-package
- Environment: <name> (<uri>)
- Target package/application: <package> / <app code>
- Started: <date> · Last updated: <date>

## Progress
<N> tasks — <a> VALIDATED · <b> DONE · <c> WIP · <d> TODO · <e> BLOCKED · <f> DROPPED

## Sections
| Section | Tasks | Status | Notes |
| --- | --- | --- | --- |
| <section> | <ids> | <rollup> | |

## Blockers
| Item | Blocking | Decision needed |
| --- | --- | --- |

## Next actions
1. <next task ID and short description>

## Documents
- [Discovery](discovery.md) · [Plan](plan.md) · [Roadmap](roadmap.md) · [Decisions](decisions.md) · [Worklog](worklog.md)
```

### roadmap.md
```markdown
# Roadmap

Ordered by dependency. Status vocabulary: TODO / WIP / BLOCKED / DONE / VALIDATED / DROPPED.

| ID | Artifact | Kind | Freedom target | Depends on | Status | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| GDPR-DS | BpmGDPR entity/data source | entity | data source | - | TODO | |
| GDPR-SEC | GDPR section | own section | ListPageV3Template | GDPR-DS | TODO | |
| GDPR-FORM | GDPR card | own page | PageWithTabsFreedomTemplate | GDPR-DS | TODO | |
| CONTACT-EXT | Contact GDPR fields | extension | delta on Contacts_FormPage | GDPR-DS | TODO | |
```

### decisions.md
```markdown
# Decisions And Approvals

## <date> — <decision title>
- Decision: <what was decided>
- Rationale: <why>
- Approved by: <user>
- Affects: <task IDs>
```

### worklog.md
```markdown
# Worklog

## <date> — <session summary>
- Scope: <what this session covered>
- Actions: <operations/tools used>
- Read-back evidence: <schema UId, package, SCHEMA_DEPS, handlers, resources, validation>
- Roadmap changes: <ID: old -> new status>
- Open issues: <carried forward>
```

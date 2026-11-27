# Migration Plan — Contents Reference

> **You do not hand-fill this template on the normal path.** The plan the user approves is the
> **engine-written output of `node engine/migrate.mjs <manifest> --plan --out plan.md`** (SKILL.md Contract
> rule 2) — you supply the Overview/Main-scope values via `manifest.planMeta`, the engine writes the file,
> and you present it verbatim (never hand-type the `<FILL: …>` placeholders). This document exists for
> two reasons only:
>
> 1. **Reference** — so you (and the reader) know *what a complete plan covers*. Every section below is
>    already produced, in a page-centric shape, by `--plan` (Overview + Main scope + per-page
>    `Layout`/`Business rules`/`⚠ Custom methods`/`⚠ Other declared logic`/`⚠ Confirm` + `Child page mappings`). Do not build a second, template-shaped plan
>    alongside it.
> 2. **Hand-authoring fallback** — when Node is genuinely unavailable and the engine cannot run, author
>    the plan by hand using the structure below, filling each section from the merged schema chain.
>
> Match the user's language.

## 1. Input And Resolved Target

- Original input:
- Run diagnostics (skill build, clio, stand — the `diagnostics.mjs` block):
- Resolved environment:
- Resolved section:
- Entity schema:
- Classic schemas:
- Classic parent templates:
- Freedom template analog:
- Existing Freedom UI schemas:
- Package/application ownership:
- Package placement decision:

## 2. Discovery Evidence And Missing-Source Risks

Record the evidence used and any gaps.

| Source | Status | Evidence | Risk |
| --- | --- | --- | --- |
| Creatio runtime metadata | Available / Missing / Partial |  |  |
| Existing Freedom UI artifacts | Found / Not found / Partial |  |  |
| Package ownership/editability | Editable / Locked / Unknown / Partial |  |  |
| Classic schema coverage | All schemas read / Partial / Top-only | list schemas read (base→top) | items from unread schemas are INFERRED |
| Tests or validation assets | Found / Not found / Partial |  |  |

## 3. Classic UI Inventory

List the discovered Classic artifacts:

- Section schema:
- Edit page schemas:
- Details:
- Mini pages:
- Mixins/utilities:
- Backend schemas/services/processes:
- Data bindings/resources:

## 4. Package Placement Analysis

Decide whether the migration can be done in the same package before planning page changes.

| Package/App | Owns | Editable/Locked Status | Evidence | Migration Placement | Reason |
| --- | --- | --- | --- | --- | --- |
|  | Classic section / Classic page / Freedom page / Entity | Editable / Locked / Unknown |  | Same package / Replacing package / New package / Existing Freedom package / Blocked |  |

If the same package is not safe, name the target new/replacing package and explain why.

### Project conventions

The team's request namespace, helper modules and constants modules, with the evidence that decided them and
a table mapping every record id the plan uses to its constants path. Detected and recorded per
`./references/project-conventions.md`; approved with the plan.

## 5. Classic Template Structure And Freedom Analog

Analyze page structure before individual controls.

| Classic Page/Detail | Parent Template Chain | Structural Slots Used | Freedom Candidates Considered | Selected Freedom Analog | Reason |
| --- | --- | --- | --- | --- | --- |
|  |  | Header / side area / tabs / details / files / feed / actions / modal |  |  |  |

Record rejected candidates when the choice is not obvious.

## 6. Layout Analysis

Summarize the Classic layout and the Freedom target layout.

| Classic Item | Current Purpose | Freedom Target | Notes |
| --- | --- | --- | --- |
|  |  |  |  |

## 7. Business Logic Analysis

Summarize all page-level behavior.

| Classic Logic | Trigger | Effect | Freedom Target | Risk |
| --- | --- | --- | --- | --- |
|  |  |  |  |  |

## 8. Freedom UI Mapping

Classify every migrated item.

| Classic Artifact Or Behavior | Classification | Freedom Implementation | Status |
| --- | --- | --- | --- |
|  | Direct analog / Business rule / Handler-converter-validator / Backend dependency / Manual decision |  | Planned / Blocked / Dropped with reason |

## 9. Ordered Implementation Plan

Use dependency order, not file order.

1. Prepare package/app/page ownership.
2. Apply the approved package placement decision: same package, replacing package, existing Freedom package, or new package/app.
3. Select or create the Freedom UI page from the approved template analog.
4. Create or update the parallel Freedom UI page.
5. Migrate layout and data bindings.
6. Add business rules.
7. Add handlers, converters, validators, or helper modules.
8. Reuse or adapt backend dependencies.
9. Add localization/resources.
10. Validate and fix.
11. Prepare switch-over tasks only if separately approved.

For each step, include the target files/schemas, expected tool operations, and validation signal.

## 10. Validation Plan

- Page schema validation:
- Build/package validation:
- Unit tests:
- Integration/browser checks:
- E2E scenarios:
- Manual checks:

## 11. Blockers And Decisions Needed

List only decisions or blockers that affect implementation.

| Item | Why It Matters | Required Decision |
| --- | --- | --- |
|  |  |  |

## Questions before approval

The build stops on every question the plan left open and waits for a person, and what it built
without the answer is reworked. So while you read the pages, the behaviour cards (step 5.1) and the
packages, write each question the build will need into `manifest.planQuestions`, as
`{ "id", "kind", "question", "pages" }` — the question in product terms, the page keys it concerns:

- **`behaviour`** — a choice on a page the Classic code does not settle: two places behave
  differently (the page locks a field, its list lets a right holder edit it), nothing opens a page the
  migration builds, a parameter Classic let the user change, a rule Freedom cannot apply per row of an
  editable list. A behaviour card that describes two behaviours the Freedom page cannot both keep, or a
  right or status the behaviour depends on, is one.
- **`outside-package`** — a change the build would make outside `manifest.targetPackage`: a column,
  a lookup setting or a schema defined in another package, a system setting.
- **`object-wide`** — a change that affects every page of an object: a column setting, an object rule.
- **`data-on-open`** — the engine raises it itself, as `data-on-open:<pageKey>`, for each page under
  **Pages that write data when opened**; answer it by that id with `{ "id", "answer" }`.

The plan lists them under `### Questions before approval`; an open one keeps `--plan` and `--tasks` at
exit 2. Ask them with the plan's other decisions (SKILL.md step 6), the independent ones batched;
record each answer in `decisions.md` as the user's `Kind: answer`, put its `D<N>` as the question's
`answer`, and re-run `--plan --out`. The plan version reads the questions, not their answers, so
recording an answer does not move it. A question the build still has to ask after the approval is
recorded with a `Plan question:` line (`./migration-documentation.md` → *Directives and answers*).

## Approval Gate

Implementation must stop here until the user explicitly approves this plan.

# Migration Plan — Contents Reference

> **You do not hand-fill this template on the normal path.** The plan the user approves is the
> **engine-written output of `node engine/migrate.mjs <manifest> --plan --out plan.md`** (SKILL.md Contract
> rule 2) — you supply the Overview/Main-scope values via `manifest.planMeta`, the engine writes the file,
> and you present it verbatim (never hand-type the `<FILL: …>` placeholders). This document exists for
> two reasons only:
>
> 1. **Reference** — so you (and the reader) know *what a complete plan covers*. Every section below is
>    already produced, in a page-centric shape, by `--plan` (Overview + Main scope + per-page
>    `Layout`/`Logic`/`⚠ Confirm` + `Child page mappings`). Do not build a second, template-shaped plan
>    alongside it.
> 2. **Hand-authoring fallback** — when Node is genuinely unavailable and the engine cannot run, author
>    the plan by hand using the structure below, filling each section from the merged schema chain.
>
> Match the user's language.

## 1. Input And Resolved Target

- Original input:
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
| Local repository | Available / Missing / Partial |  |  |
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

## Approval Gate

Implementation must stop here until the user explicitly approves this plan.

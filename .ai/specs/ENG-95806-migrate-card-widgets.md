# ENG-95806 — CAADT: migrate card widgets

> Jira: https://creatio.atlassian.net/browse/ENG-95806 · Parent: ENG-96392 "(RFMT) Pages" · Component: pixel ninjas

## Summary

Classic Creatio record pages can embed small "card widgets" — record-scoped indicators (e.g. three KPI charts on a Campaign page) stored in `SysWidgetDashboard`. When the `classic-to-freedom-migration` skill converts such a page to Freedom UI, it currently cannot convert these widgets: it just tells the operator "propose the closest component and confirm." This task turns that vague hand-off into a mechanical step. The migration engine recognizes each card widget and carries the exact coordinates needed to convert it (`recordId` + `widgetKey`), and the skill obtains a ready Freedom element from the migrator's `ConvertCardWidgetsProcess` and places it — instead of anyone hand-building a chart. The result: card widgets migrate deterministically, grouped efficiently by record, with failures staying visibly blocked rather than silently substituted.

## Goal

Convert each `CardWidgetModule` on a classic page from a vague `{kind:"component"}` "propose something" decision into an actionable `{kind:"card-widget"}` decision that carries `widgetKey`, `recordId`, and target `region` — so the agent converts via one `ConvertCardWidgetsProcess` call per distinct `recordId` and places the returned config, with no hand-building and no duplicate worklist entries.

## Approach

**Chosen: Approach B** — fold `card-widget` recognition into the existing `mapWidgets` phase. Fallback: standalone `mapCardWidgets` phase (Approach A) if the coupling with the chrome-gating logic proves problematic — same outputs, same tests.

### Engine (offline, deterministic)

- **Carry coordinates** — `engine.mjs:674` `normalizeModules()` currently keeps only boolean values off `viewModelConfig`, dropping `widgetKey`/`recordId`. Add `widgetKey: strOrNull(vmc.widgetKey)` and `recordId: strOrNull(vmc.recordId)` to the projection. Two fields; no behavioural change for other module kinds.
- **Recognition in `mapWidgets` (`mapper.mjs:1385`)** — add a `CardWidgetModule` branch that fires when **both** `recordId` and `widgetKey` are present, bypassing the `WIDGET_BY_*` catalog, the `seenWidget` dedup, and the base-chrome evidence gating. It emits:
  - `changeSet.cardWidgets[]`: `{ key, widgetKey, recordId, region, fromTemplate }`, where `region` comes from `resolveOwner()` against the page-derived `profileAnchors`;
  - one `needsDecision` per widget with `kind:"card-widget"` naming the concrete action (call `ConvertCardWidgetsProcess` with `recordId` + `widgetKey`, place the returned element in `region`) — **not** "propose the closest component";
  - `accountedFor` entries for **both** the module key **and** the host diff-item name (the `mapUnmappedDrop` double-report trap `mapProfileCards` already handles).
- **Approach B plumbing** — pass `index` + `profileAnchors` into `mapWidgets` (signature change), and add a `card-widget` guard to `mapRemainingLogic:1019` (`isCardWidgetModule(c)`, mirroring `!isProfileCardModule(c)`) so a converted widget does not also surface as a generic `component`.
- A widget missing either coordinate keeps the old generic `component` decision — no silent drop.
- **Printer** — `engine/designspec.mjs`: design-spec Layout row per widget (`Region · <widgetKey> · Card widget · from SysWidgetDashboard`); a ⚠ Confirm entry for the conversion call; checklist/verify row per widget with `vk: {type:"onstand", evidence:"cardWidget:<widgetKey>"}`.

### Agent-side docs (written against the ASSUMED contract — each contract detail flagged "verify against released migrator")

- **`SKILL.md` step 7** — add to the subtask order: group card widgets by `recordId`; per group call `ConvertCardWidgetsProcess` (`SysWidgetDashboardId`, `WidgetKeys`, result-parameters `["ConversionResult"]`); per returned widget, `Failed`→TODO/BLOCKED with the reason (never hand-build a substitute), `Success/Partial`→merge `freedomElementConfig`; placement is the agent's decision per `creatio-ui-guidelines`; record the evidence flag per widget in `built.json`.
- **`references/classic-to-freedom-mapping.md`** — add the real recipe (classic declaration shape, `recordId`/`widgetKey` semantics, grouping, process call + result contract, placement rules, `Failed`-means-blocked), preserving the `SysWidgetDashboard` vs `SysDashboard` store distinction.

### Tests — `engine-tests/classic-to-freedom/`

Update `fixtures/supportunitemployee/SupportService.js` (add a `recordId` so its widget is a positive `card-widget` case) and change `run-mapper.mjs:74` from `component` to `card-widget`, asserting `widgetKey`/`recordId` carry through. Add cases: two widgets sharing one `recordId` → one group; a `CardWidgetModule` missing a coordinate → generic `component` fallback; `accountedFor` prevents a duplicate `unmapped-component`.

## Out of Scope

- The migrator `ConvertCardWidgetsProcess` implementation and its exact released contract (assumed available; contract details flagged to verify).
- The clio `run-process` MCP tool implementation (sibling subtask).
- Section-dashboard (`SysDashboard`) behaviour and all other `mapWidgets`/mapper phases — unchanged.
- Auto-installing the migrator prerequisite (separate subtask).

## Acceptance Criteria

1. Each `CardWidgetModule` with both coordinates produces exactly one `card-widget` decision carrying `widgetKey`, `recordId`, and target `region` — and no duplicate `unmapped-component` or generic `component` entry.
2. The plan and design spec show the widgets by region; the checklist has one row per widget.
3. The `SKILL.md` recipe and mapping reference instruct: one `ConvertCardWidgetsProcess` call per distinct `recordId` (all `widgetKeys` batched), place the returned config, hand-build nothing; each assumed contract detail marked "verify against released migrator".
4. A `Failed` conversion leaves the widget `TODO/BLOCKED` with the migrator's reason — never replaced by a hand-built substitute (stated explicitly in the recipe).
5. A `CardWidgetModule` missing `recordId` or `widgetKey` degrades to the old generic `component` decision rather than disappearing.
6. Section-dashboard behaviour and every other mapper phase are unchanged (asserted positively by existing golden tests staying green).
7. Golden tests (items 1–3, 6) pass offline; the TestEnv E2E is run best-effort and its outcome reported.

## Affected Components

- **Engine — `engine/engine.mjs`**: `normalizeModules()` projection (+2 fields).
- **Engine — `engine/mapper.mjs`**: `mapWidgets` card-widget branch + signature; `mapRemainingLogic` `isCardWidgetModule` guard; new `isCardWidgetModule()` helper; `mapToFreedom` wiring of `cardWidgets` into the ChangeSet.
- **Engine — `engine/designspec.mjs`**: Layout / ⚠ Confirm / checklist-verify rows.
- **Docs — `skills/classic-to-freedom-migration/SKILL.md`**: step 7 recipe.
- **Docs — `references/classic-to-freedom-mapping.md`**: card-widget recipe section.
- **Tests — `engine-tests/classic-to-freedom/`**: fixture `SupportService.js` + `run-mapper.mjs` expectations and new cases.

## Verification Strategy

- **Offline (hard gate):** the `engine-tests/classic-to-freedom` golden suite (`run-mapper.mjs`, `run.mjs`) green — card-widget emission, coordinate carry-through, grouping, fallback, no duplicate `unmapped-component`, all other phases unchanged.
- **On-stand (best-effort, TestEnv):** run the skill against a classic page carrying card widgets (e.g. `CampaignPage`, three indicators / one `recordId`); confirm the plan lists all widgets by region, a single batched `ConvertCardWidgetsProcess` call, placed elements, `--verify` green rows, record-scoped data across two records, and a forced `Failed` staying blocked with no substitute. Reported, not gating.

## Risks and Assumptions

- **Assumption:** `ConvertCardWidgetsProcess` is implemented; its output contract (`ConversionResult`, per-widget `status` in {Success, Partial, Failed}, `freedomElementConfig` with view/viewModel/model diffs, `reason`) is the author's best guess — written against but flagged to verify.
- **Assumption:** clio `run-process` (launch process, return output params) lands separately; the recipe consumes it as specified.
- **Risk (Approach B):** co-locating record-scoped card logic with `mapWidgets`' chrome-gating machinery risks accidental coupling (`seenWidget`, `classicEvidence`). Mitigated by an isolated branch that bypasses that machinery; fallback is extraction to a standalone phase (Approach A).
- **Risk:** region resolution depends on passing page-derived `profileAnchors` into `mapWidgets`; using the static default would under-resolve regions.
- **Risk:** best-effort E2E may not run if TestEnv lacks a suitable classic card-widget page or the released migrator/`run-process` — reported as a gap, not a failure.

## Notes from grounding (verified against the repo @ main)

- `engine.mjs:674` `normalizeModules()` confirmed to keep only booleans (`displayFlags`) — `widgetKey`/`recordId` are dropped today.
- `mapper.mjs`: `CardWidgetModule` currently falls through to `mapRemainingLogic` (~:1022) → generic `component`. `mapProfileCards` (:1344) is the mirror pattern; `resolveOwner` (:39); existing `mapWidgets` (:1385).
- `run-mapper.mjs:74` asserts `kind === "component"` today.
- The existing fixture has `widgetKey` but NO `recordId` — needs a `recordId` added to become a positive `card-widget` case; the "no-coordinates fallback" becomes a separate fixture.
- The reference boundary note item 5 cites is a net-new addition (no verbatim match in `classic-to-freedom-mapping.md`).
- Environment for best-effort E2E: clio `TestEnv`.

## References

- Jira issue: https://creatio.atlassian.net/browse/ENG-95806
- Parent: ENG-96392 "(RFMT) Pages"
- Code: `skills/classic-to-freedom-migration/engine/{engine.mjs:674, mapper.mjs:1385/1019/1344/39, designspec.mjs}`, `SKILL.md` step 7, `references/classic-to-freedom-mapping.md`, `engine-tests/classic-to-freedom/`
- Env: clio `TestEnv`

---
Refined with REFINE agent — 2026-09-02. DoD: offline core (items 1–3, 6) + docs (4–5); E2E best-effort on TestEnv.

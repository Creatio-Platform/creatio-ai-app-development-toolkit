# Design note — two reconcile modes for customized OOTB sections

**Jira:** ENG-99192 · **Branch:** `ENG-99192-reconcile-modes-customized-oob-sections` (base `claude/migration-orchestrated-todo-build`) · **Worktree:** `caadt-toolkit-eng99192`
**Problem origin:** Anthony Sylvan Opportunity reconcile — the "already native → skip" logic is location-blind: it checks a base element *exists* on the Freedom page, not *where*. Owner/Contact/Created on were skipped as "native" but actually live in `OverviewFieldsContainer`, not the Classic side-profile island — so the Classic composition was silently not reproduced.

## The change

Give an existing-Freedom **reconcile** two explicit **build-time modes**. The developer picks the mode **at the start of implementation (before `--tasks`)** — NOT at plan time. `--plan` / `--spec` stay **mode-agnostic**. The choice is recorded in `decisions.md` and passed in every build sub-agent brief.

**Governing principle (both modes):** the plan is the complete authority for FIELDS and DETAILS — each field + its status (readonly / required / visible) is described in the plan (the effective Classic layout). *Not described in the plan → not on the page.*

### Mode 1 — Overlay (current behavior)
- Base = the existing Freedom page layout.
- Add the plan's client-delta fields/details into suitable existing containers.
- Base positions and base "extra" fields are kept.
- The location-blind "skip if native" behavior is acceptable here (Freedom's layout is the baseline).

### Mode 2 — Reproduce Classic layout
- The page's **fields and details** = exactly the plan's effective-Classic set, placed at their **Classic positions** (island / tab / group / order / column).
- Mechanism: `move` / `remove` / `insert` in the **section page's replacing schema** (client package). **No template change, no new page.** The base template and base package are untouched.
- Base Freedom **fields/details that ARE in the plan** → **moved** to the Classic position; field status (readonly/required/visible) follows **Classic** where it differs.
- Base Freedom **fields/details NOT in the plan** → **`remove`** the layout element (this removes only the on-page control, NOT the entity column or its data).
- Freedom-only **non-field value-add components with no Classic analog** (charts, DCM progress bar, Account/Contact compact profile cards, Next steps, …) → **kept as-is**.
- **Standard Freedom components** (Feed, Attachments, Connected to, Timeline) present on the page → **kept as-is** and their Classic counterparts are NOT migrated (decision 8). These DO have a Classic analog (ESN/Feed tab, files detail, connections detail, Timeline tab) but the platform owns the Freedom component, so the reconcile keeps it rather than reproducing the counterpart.
- **Conflict** = a Classic field/detail wants a slot occupied by a kept Freedom-only element → keep the Freedom element, place the field/detail in the nearest suitable container, **record as a decision**.
- **Logic** (handlers, business rules, auto-fills) → ported as in a normal migration (mode-independent).

## Decisions log (from Katya, this session)
1. Mode = explicit developer choice, at **start of implementation**, not at plan start. Plan unaffected.
2. Placement source of truth in Mode 2 = the **effective merged Classic layout** (tab/group/order/columns 1:1; pixel gaps ignored).
3. Mechanism = the **section page's replacing schema** (move/remove/insert), NOT the template.
4. Keep Freedom-only value-add elements with **no Classic analog** (charts, DCM, compact cards, Next steps); Mode 2 transfers only **field + detail structure** (+ logic). (Feed is NOT one of these — it has a Classic analog; see decision 8.)
5. (=3) Same OOTB page, no template swap, no new page.
6. Field status conflict → **Classic wins**; plan describes the field and its status; not-described = not present.
7. Removing a base field not in the plan = **`remove` the layout element only** (column/data stay) → safe.
8. **Standard Freedom components (Feed, Attachments, Connected to, Timeline) are kept as-is in BOTH modes, and their Classic counterparts are NOT migrated.** These four have Classic analogs (ESNTab, FileDetailV2, EntityConnectionsDetailV2, TimelineTab), but the Freedom page ships the platform component, so the reconcile keeps it and the counterpart row closes `n-a — standard Freedom component kept`. Only when the component is ABSENT on the Freedom page is the Classic element migrated. The component's contents stay with it (a field it already renders is not inserted twice). Engine: Feed / Attachments / Timeline are recognized as real Freedom components (`uiShape: "component"` in `mapping-table.mjs`, each with a registry component type), so `--verify` checks the kept component is present rather than demanding a related list. "Connected to" has NO single Freedom component — it is a group of connection lookups — so it stays a Classic detail and the keep is a purely build-time disposition: the sub-agent sees "Connected to" on the Freedom page and closes the row `n-a — standard Freedom component kept`, which `--verify --tasks` reads back through the decided rows (the engine does not read the base Freedom page).

## Implementation perimeter (to detail next)
- `engine/tasks.mjs` — Mode 2 generates extra **move/remove** tasks (relocate base fields/details to Classic positions; remove base layout elements not in the plan). Mode is a `--tasks` input.
- `engine/migrate.mjs` / `engine/designspec.mjs` — ensure the `--spec` Layout carries the **full Classic position** (tab/group/order/column) + status, so Mode 2 has the placement data (spec ENRICHMENT, not a plan-semantics change).
- `references/existing-freedom-reconcile.md` — document both modes + the location-aware rule + the conflict rule.
- `references/build-task-execution.md` — the build sub-agent's per-mode placement procedure.
- `SKILL.md` — the mode-selection gate at the start of step 7.
- Design QA — flag Classic-region ↔ Freedom-region mismatches (Mode 2).

## Open / to confirm during implementation
- Exact `--tasks` flag/shape for the mode (e.g. `--reconcile-mode overlay|classic-layout`).
- How the spec encodes full Classic position without changing plan semantics.
- Golden/test coverage for both modes.

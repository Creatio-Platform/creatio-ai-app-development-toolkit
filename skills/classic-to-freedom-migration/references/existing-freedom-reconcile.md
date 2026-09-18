# Porting Classic Customizations onto an Existing Freedom Section (Reconcile)

Use this when a Classic section is being migrated but a **Freedom UI section/page for the same entity
already exists** (shipped out of the box, or built earlier), and the client's real value is the
**customizations they added on top of the Classic section in their own packages** — added fields, details,
rules, buttons, and elements they hid or removed. The job is not to build a new page; it is to make
the existing Freedom section carry the client's Classic customization intent, and to reconcile
anything on Freedom that does not belong.

Do not create a duplicate Freedom section. One entity → one Freedom section.

## Two build-time reconcile modes (ENG-99192)

A reconcile has TWO modes, and they produce different pages from the SAME plan. The developer picks one
at the **start of implementation** — `migrate.mjs … --tasks <dir> --reconcile-mode <overlay|classic-layout>`
on the first cut, **not** at plan time. The choice is frozen in the task folder, read back on every
re-slice (you need not re-pass it), and stamped as **`reconcileMode:`** in each task's front matter and
in the index headline — so the ONE sub-agent handed a task knows which placement rule to apply. The mode
changes **how** you place elements, never the plan: `--plan` / `--spec` are byte-identical for both, and
`--reconcile-mode` is rejected on `--plan`/`--spec` and on a rebuild (no `planMeta.freedomExists`).

- **`overlay` (default)** — keep the existing Freedom layout; add the client's Classic delta into it.
  Base positions and base "extra" elements stay. This is **Mode 1** below (Steps 1–5).
- **`classic-layout`** — re-lay the Freedom page so its FIELDS and DETAILS sit exactly where they were
  in Classic. This is **Mode 2** below.

**Governing principle (BOTH modes):** the plan is the complete authority for fields and details — each
field, its status (read-only / hidden), and its exact Freedom-grid cell (the Layout table's **`Position`**
column, `r{row} · c{column} · w{colSpan}`) are in the plan. *Not described in the plan → not on the page.*

## The mental model

```
target Freedom section  =  base Freedom section  +  the client's Classic customization delta
```

You have two inputs and one output:
- **A — the client's Classic delta:** what the client actually changed on the Classic section in
  their own (editable/custom) packages, on top of the base platform.
- **B — the current Freedom section:** what the existing Freedom page has right now.
- **Output:** the Freedom section reconciled so it reflects A — missing customizations added, and
  elements that contradict A removed (Mode 1), or the field/detail structure re-laid to match Classic
  exactly (Mode 2).

## Step 1 — Isolate the client's Classic delta (input A) — BOTH modes

- Identify the client's **editable/custom packages**; exclude base/vendor/locked packages unless the
  client owns them. Only changes the client authored count as the delta.
- Read the client's replacing schema(s) for the Classic section/page/detail and extract the `diff`
  operations, classified by intent:
  - **added** — `insert` of fields, groups, tabs, details, buttons, actions.
  - **modified** — `merge` changing caption, order/index, required/visible/read-only, lookup or
    filter, default value.
  - **removed / hidden / moved** — `remove`, `move`, or a `merge` that hides a base element.
- Also capture entity-level additions (custom columns) and any business rules / methods the client
  added.

## Step 2 — Read the current Freedom section (input B) — BOTH modes

- `get-page` the existing Freedom page and read `bundle.json` (the merged view) for its fields,
  containers, tabs, details, business rules, and handlers.
- Map each Freedom element to its entity column / concept so it can be compared with the plan
  by meaning, not by control name — and note **where** each already sits (its container), because a
  base element being "present" is not the same as being present in the RIGHT place (Mode 2).

## Mode 1 — Overlay (default)

### Step 3 — Build the reconciliation diff

| In the client's Classic delta | On Freedom now | Action on Freedom |
| --- | --- | --- |
| Added by client | absent | **ADD** |
| Added by client | present but differs | **MODIFY** to match the client's setup |
| Added by client | present and matches | keep (no-op) |
| Removed / hidden by client | present | **REMOVE / HIDE** |
| Not in the delta (base-only element) | present | **KEEP** — do not remove; flag if intent is unclear |
| Not in the delta | absent | ignore |

### Step 4 — Apply to the existing Freedom page

- Additions and modifications: apply as Freedom deltas on the existing page (view diff items with
  stable names, business rules, handlers, related lists) per `references/classic-to-freedom-mapping.md`.
- Custom entity columns the client added: make sure they exist on the entity/data source before
  binding any field to them.
- Removals: remove or hide only the elements that map to a client removal/hide in Classic. Prefer
  **hide** over hard delete when the element holds data or is referenced elsewhere. `validate-page`
  before saving.

## Mode 2 — Reproduce Classic layout

The page's **fields and details** end up exactly the plan's set, each at its **Classic position**;
Freedom-only value-add stays. Steps 1–2 above are unchanged; then:

### Step 3 (M2) — Place every field/detail at its plan `Position`

Read the plan's Layout table — its `Region` (tab / group / island) and `Position` (`r{row} · c{column}
· w{colSpan}`, the converted Freedom-grid cell) are the placement target. For each field/detail:

- **in the plan, absent on Freedom** → **insert** it at its `Region` + `Position`, with the plan's
  status (read-only / hidden).
- **in the plan, present on Freedom but in a DIFFERENT place** → **`move`** it (or `remove` + re-`insert`)
  to the plan's `Region` + `Position`. This is the case a location-blind reconcile misses: a base field
  the plan puts in the side island but the base page renders in the Overview content is MOVED, not
  skipped as "already native".
- **in the plan, present and already correct** → keep (no-op).
- **a base LAYOUT element NOT in the plan** → **`remove`** it. This removes only the on-page control,
  **NOT** the entity column or its data — so it is safe. ("Not described → not on the page.")
- **a Freedom-only NON-field value-add component with no Classic analog** (charts, DCM progress bar,
  Account/Contact compact profile cards, Feed, Next steps, …) → **KEEP as-is.** Mode 2 transfers the
  field/detail structure, not these widgets.
- field STATUS where Classic and Freedom differ → **Classic wins** (the plan's `Rule` cell).

### Step 4 (M2) — Conflicts

A Classic field/detail whose `Position` is held by a KEPT Freedom-only element → keep the Freedom
element, place the field/detail in the nearest suitable container, and record the call in `decisions.md`.
Never drop the field/detail, and never remove the value-add element to make room.

### Step 5 (M2) — Logic

Handlers, business rules, and auto-fills are ported **exactly as in a normal migration** — mode-independent.

## Step 5 — Verify the reconciliation

- Re-read the Freedom page and confirm, per mode:
  - **Mode 1:** every client-added element is present and configured as the client had it; every
    client-removed element is gone (or hidden); no base/standard element was removed without a matching
    Classic removal.
  - **Mode 2:** every plan field/detail is present at its `Position` with its status; every base layout
    element NOT in the plan is gone; every kept Freedom-only value-add component is still present.
- Record each removal with its evidence in `worklog.md`. List any ambiguous removal as a manual
  decision in `decisions.md` rather than acting on it silently.

## Safety rules (mode-aware)

- **Mode 1 — absence in the delta is not intent to remove.** Never delete a base/standard Freedom element
  just because the client did not add it in Classic; prefer **hide** to delete for anything carrying
  data or referenced by other logic.
- **Mode 2 — the plan IS the field/detail set.** A base layout element not in the plan is **removed**
  (the on-page control only, never the entity column or its data); a Freedom-only value-add component is
  always **kept**; a removal you cannot tie to the plan is a decision, not a silent act.
- **Both — no duplicates.** Always target the existing Freedom section; never fork a second section for
  the same entity. `validate-page` before saving. Every removal must trace to evidence (a Classic delta
  op in Mode 1, the plan's field/detail set in Mode 2); if you cannot show it, treat it as a manual
  decision.

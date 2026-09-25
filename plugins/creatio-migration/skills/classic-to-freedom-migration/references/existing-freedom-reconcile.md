# Porting Classic Customizations onto an Existing Freedom Section (Reconcile)

Use this when a Classic section is being migrated but a **Freedom UI section/page for the same entity
already exists** (shipped out of the box, or built earlier), and the client's real value is the
**customizations they added on top of the Classic section in their own packages** — added fields, details,
rules, buttons, and elements they hid or removed. The job is not to build a new page; it is to make
the existing Freedom section carry the client's Classic customization intent, and to reconcile
anything on Freedom that does not belong.

Do not create a duplicate Freedom section. One entity → one Freedom section.

## The mental model

```
target Freedom section  =  base Freedom section  +  the client's Classic customization delta
```

You have two inputs and one output:
- **A — the client's Classic delta:** what the client actually changed on the Classic section in
  their own (editable/custom) packages, on top of the base platform.
- **B — the current Freedom section:** what the existing Freedom page has right now.
- **Output:** the Freedom section reconciled so it reflects A — missing customizations added, and
  elements that contradict A removed.

## Step 1 — Isolate the client's Classic delta (input A)

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
- Keep the delta separate from base behavior: shared base layout is already represented by the
  existing Freedom page, so it is not part of the work.

## Step 2 — Read the current Freedom section (input B)

- `get-page` the existing Freedom page and read `bundle.json` (the merged view) for its fields,
  containers, tabs, details, business rules, and handlers.
- Map each Freedom element to its entity column / concept so it can be compared with the Classic
  delta by meaning, not by control name.

## Step 3 — Build the reconciliation diff

Classify every item on both sides:

| In the client's Classic delta | On Freedom now | Action on Freedom |
| --- | --- | --- |
| Added by client | absent | **ADD** |
| Added by client | present but differs | **MODIFY** to match the client's setup |
| Added by client | present and matches | keep (no-op) |
| Removed / hidden by client | present | **REMOVE / HIDE** |
| Not in the delta (base-only element) | present | **KEEP** — do not remove; flag if intent is unclear |
| Not in the delta | absent | ignore |

## Step 4 — Apply to the existing Freedom page

- Additions and modifications: apply as Freedom deltas on the existing page (view diff items with
  stable names, business rules, handlers, related lists) per `references/classic-to-freedom-mapping.md`.
- Custom entity columns the client added: make sure they exist on the entity/data source before
  binding any field to them.
- Removals: remove or hide only the elements that map to a client removal/hide in Classic. Prefer
  **hide** over hard delete when the element holds data or is referenced elsewhere. `validate-page`
  before saving.

## Step 5 — Verify the reconciliation (both directions)

- Re-read the Freedom page and confirm:
  - every client-added element from input A is now present and configured as the client had it,
  - every client-removed element is gone (or hidden) on Freedom,
  - no base/standard Freedom element was removed without a matching Classic removal.
- Record each removal with its Classic evidence in `worklog.md`. List any ambiguous removal as a
  manual decision in `decisions.md` rather than acting on it silently.

## Safety rules

- **Absence in the delta is not intent to remove.** Never delete a base/standard Freedom element just
  because the client did not add it in Classic. Remove only when the client actively removed or hid
  the analogous element in Classic — otherwise keep it, and confirm with the user if unsure.
- **Prefer hide to delete** for anything carrying data or referenced by other logic.
- **No duplicates.** Always target the existing Freedom section; never fork a second section for the
  same entity.
- **Evidence before removal.** Every removal must trace to a specific Classic delta operation; if you
  cannot show that evidence, treat it as a manual decision.

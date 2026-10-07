# Porting Classic Customizations onto an Existing Freedom Section (Reconcile)

Use this when a Classic section is being migrated but a **Freedom UI section/page for the same entity
already exists** (shipped out of the box, or built earlier), and the client's real value is the
**customizations they added on top of the Classic section in their own packages** — added fields, details,
rules, buttons, and elements they hid or removed. The job is not to build a new page; it is to make
the existing Freedom section carry the client's Classic customization intent, and to reconcile
anything on Freedom that does not belong.

One entity → one Freedom section is the default. A second, parallel section is built only when the
user picks it (see *Choosing the path*); that is a Rebuild from the full Classic page, and the
reconcile steps below do not apply to it.

## Choosing the path — ask once, before the plan

Trigger: `list-entity-client-schemas` for the target entity returns a `freedom` section or edit page,
or `list-pages` finds a Freedom form page over the entity. Do not choose for the user and do not skip
the question: the two answers build different things. Collect these facts first, read-only, and
record them in `discovery.md`:

- **What exists:** a section in the menu (list page + form page), a form page only, or several form
  pages for different record types — name every page schema.
- **Where each page lives:** its package (`get-page`) and whether that package is editable
  (`list-packages`, `SysPackage.InstallType`).
- **Client extensions:** whether an editable client package already carries replacing schemas of these
  pages.

Then ask ONE `AskUserQuestion` with exactly these two options, each saying what it builds:

| Option | What gets built | Result for users |
| --- | --- | --- |
| **1. Extend the existing section** (default) | The Classic customizations go as extensions of the existing Freedom pages into a **new package** that depends on the package of each base page. `placement.sectionHost = { "mode": "existing-section", "listPage": "<list page>", "formPage": "<form page>" }`, `planMeta.freedomExists: true`; no `planMeta.formTemplate` — each existing page keeps its own template; the steps below. | One section; the menu does not change; product updates to the base pages keep arriving. |
| **2. Parallel section** | A new app and section over the same object, built from the full Classic page. `sectionHost.mode = new-app`, `planMeta.freedomExists: true`, `planMeta.parallelSection: true` — the engine then calls the pages Rebuild and leaves the existing section alone. Without `parallelSection` a `new-app` plan reconciles the existing form page instead. | Two sections for one object; users must be told which one to use. |

Not offered: rebuilding and replacing the standard page, and analysis only. Option 2 is never
recommended and never chosen without this question.

When only a form page exists (no section in the menu), option 1 extends that form page and the section
is still decided by the `sectionHost.mode` table (`existing-app` / `new-app` / `pages-only-no-menu`):
`existing-section` needs both an existing list page and form page, and the plan is refused without
the two names. When several form pages exist for different record types, `existing-section` is refused —
it names one form page. Record that in `decisions.md` and settle with the user how each typed form page
is reconciled.

Record the answer in `decisions.md`, then the follow-ups for that option.

**Option 1 — the package.** Create a new package that depends on the package of each base page,
with clio's `create-package` through `clio-run`. Take its arguments and its result fields from
`get-tool-contract`, not from this file: `tool-not-found` means the installed clio has no such tool —
stop and report it as a blocker, and do not create the package another way. Use the package name the
tool returns (the stand can prefix it) as `manifest.targetPackage`. A result saying the package was
created but a later step (its dependencies, its read-back) failed is a blocker too: settle it before
any page write. Save each page with `update-page` passing `target-package-uid` of that package, so
the replacing schema lands there and not in the base page's package. `sync-pages` has no package
target: never save these pages with it, since clio would pick the design package itself and can
write the replacing schema into the base page's package. Take the argument from `get-tool-contract`.

**Option 1 — an existing client package.** An editable client package that already extends these
pages is offered as an alternative to the new package, in its own `AskUserQuestion`, saying that
earlier work there can be overwritten: the agent cannot see which earlier changes the new ones
replace. Use it only after the user explicitly agrees; never by default.

**Option 2 — the new app.** Ask for the app name and workplace, and which page opens the object's
records outside the new section (default: the existing page stays the object's default, so the
existing section and its default page binding are not changed). The page binding is per object, not
per section, so a binding change made for the new section also changes what the existing section
opens — say so in the question. Then build it as `new-app` per `./references/build-scaffolding.md`.

**Placement on a reconcile: the section is already registered.** Because the Freedom section already exists in the
app menu, set `manifest.placement.sectionHost.mode = "existing-section"` — reconcile the pages and register nothing
(the menu entry and its workplace bindings already exist and are left untouched). Unlike `pages-only-no-menu`, this
keeps the **list page a real deliverable** (its section-level client delta — a list row-action, a quick filter — is
reconciled, not dropped); unlike `existing-app` it needs no owning app, because nothing is registered.

## Two build-time reconcile modes

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

## Standard Freedom components — keep them, do NOT migrate their Classic counterpart (BOTH modes)

Some Classic details/tabs have a **standard Freedom component** the Freedom page already ships. These
are NOT client customizations and NOT plain related lists — the platform owns them:

| Standard Freedom component | Classic counterpart (do NOT migrate) |
| --- | --- |
| **Feed** (`crt.Feed` + its tab/panel) | ESN / Feed tab (`ESNTab`, the `ESNFeedContainer`) |
| **Attachments** (`crt.FileList` + its expansion panel / toolbar) | files detail (`FileDetailV2`, "Attachments and notes") |
| **Connected to** (the connection group the Freedom page ships) | connections detail (`EntityConnectionsDetailV2`, «Связи объекта» / "Connected to") |
| **Timeline** (`crt.Timeline` + its tab/panel) | Timeline tab (`TimelineTab`) |

The rule, **in both `overlay` and `classic-layout`**:

- **Present on the existing Freedom page → KEEP it as-is.** Same container, tab, position, order and
  settings. Do NOT move, re-insert, reorder, restyle or remove it. `classic-layout` does NOT re-lay it
  to its Classic slot — it is a standard component, not a plan field/detail.
- **Its Classic counterpart is NOT migrated.** No insert, no related list, no tab and no tab-order
  entry taken from the Classic element. Close the plan/task row for it with `--decide <rowKey> --wont-do`
  (reason: `standard Freedom component kept — counterpart not migrated`) — the engine records the
  decision and `--verify --tasks` reads it back. Nothing is rebuilt beside the kept component.
- **Absent on the Freedom page → migrate the Classic element as usual**, placed per the mode.
- **Contents stay with the component.** A plan field the kept component already renders (e.g. Account /
  Contact inside Connected to) is NOT inserted a second time elsewhere; it becomes a `decisions.md`
  item ONLY when the client's Classic delta explicitly moved that field somewhere else (e.g. into the
  header).
- **Ordinary fields that shared the Classic tab are still migrated** per the mode — e.g. the Notes
  field on the Classic "Attachments and notes" tab. Only the standard component itself is left to the
  Freedom page.

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
- **a loose base FIELD control NOT in the plan**, sitting in a region the plan manages (Overview, the side
  profile, a plan group) → **`remove`** it. This removes only the on-page control, **NOT** the entity column
  or its data — so it is safe. ("Not described → not on the page.") This is the ONLY automatic removal.
- **a native Freedom TAB and everything inside it** (Products, Opportunity Insights, History, …) → **KEEP
  as-is.** A native tab is standard functionality the user relied on in Classic — often a REIMAGINED analog
  of a Classic tab, so its name will NOT match (Classic "Tactic & competitors" → Freedom "Opportunity
  Insights"). `classic-layout` never auto-removes a native tab or its fields. Removing one is a deliberate
  user decision only (`--decide <rowKey> --wont-do`), never an automatic strip — see the confirmation step below.
- **a Freedom-only NON-field value-add component with no Classic analog** (charts, DCM progress bar,
  Account/Contact compact profile cards, Next steps, …) → **KEEP as-is.** Mode 2 transfers the
  field/detail structure, not these widgets.
- **a standard Freedom component (Feed, Attachments, Connected to, Timeline)** → **KEEP as-is** and do
  NOT migrate its Classic counterpart — see "Standard Freedom components" above. The rule is the same in
  both modes; `classic-layout` does NOT re-lay it to a Classic slot.
- field STATUS where Classic and Freedom differ → **Classic wins** (the plan's `Rule` cell).

**Native tabs — enumerate and confirm (do NOT guess).** Because a native Freedom tab can be a reimagined
analog of a Classic tab (the names do not match), you cannot tell on your own which tabs correspond to what
the client had. So in `classic-layout`: `get-page` the Freedom page, **list EVERY native tab it ships**, keep
them all by default, and **present the full list to the user** for confirmation — remove a tab ONLY if the
user explicitly decides to (`--decide <rowKey> --wont-do`), and record that in `decisions.md`. A plan field
or detail that belongs inside a native tab stays in that tab (the tab is its `Region`); it is not pulled out
to Overview, and it is not inserted a second time if the tab already renders it.

### Step 4 (M2) — Conflicts

A Classic field/detail whose `Position` is held by a KEPT Freedom-only element → keep the Freedom
element, place the field/detail in the nearest suitable container, and record the call in `decisions.md`.
Never drop the field/detail, and never remove the value-add element to make room.

### Step 5 (M2) — Logic

Handlers, business rules, and auto-fills are ported **exactly as in a normal migration** — mode-independent.

## Step 6 — Verify the reconciliation (BOTH modes)

- Re-read the Freedom page and confirm, per mode:
  - **Mode 1:** every client-added element is present and configured as the client had it; every
    client-removed element is gone (or hidden); no base/standard element was removed without a matching
    Classic removal.
  - **Mode 2:** every plan field/detail is present at its `Position` with its status; every base layout
    element NOT in the plan is gone; every kept Freedom-only value-add component is still present. The FIELD
    part of this is machine-checked: `migrate.mjs --verify --built <file> --tasks <dir>` (the folder carries
    the frozen `classic-layout` mode) flags any FIELD control on the built page that is not in the plan as
    **❌ EXTRA** and blocks completion — so a field removal has to actually happen, it cannot be merely
    asserted. Detail/related-list and value-add placement are NOT covered by that gate — the UI-guidelines
    region-parity review confirms them.
- Record each removal with its evidence in `worklog.md`. List any ambiguous removal as a manual
  decision in `decisions.md` rather than acting on it silently.

## Safety rules (mode-aware)

- **Mode 1 — absence in the delta is not intent to remove.** Never delete a base/standard Freedom element
  just because the client did not add it in Classic; prefer **hide** to delete for anything carrying
  data or referenced by other logic.
- **Mode 2 — the plan IS the field/detail set, inside the regions it manages.** A loose base FIELD control
  not in the plan, in a region the plan manages (Overview / side profile / a plan group), is **removed**
  (the on-page control only, never the entity column or its data). A Freedom-only value-add component, and
  **every native Freedom TAB with its content**, are always **kept** — never auto-removed. A removal you
  cannot tie to the plan is a decision, not a silent act.
- **Both — keep native Freedom tabs; confirm them with the user.** Native tabs (Products, Opportunity
  Insights, History, …) are standard functionality users relied on; a Freedom tab may be a reimagined analog
  of a Classic tab with a different name, so enumerate EVERY native tab from `get-page`, keep them all, and
  put the list to the user. Remove a tab only on an explicit `--decide <rowKey> --wont-do`.
- **Both — keep the standard Freedom components.** Feed, Attachments, Connected to and Timeline the page
  already ships are kept as-is, and their Classic counterparts (`ESNTab` / `FileDetailV2` /
  `EntityConnectionsDetailV2` / `TimelineTab`) are NOT migrated; close that row with `--decide <rowKey>
  --wont-do` (reason: `standard Freedom component kept — counterpart not migrated`). Only when the
  component is ABSENT on the Freedom page is the Classic element migrated.
- **Both — no duplicates by default.** Target the existing Freedom section. A second section for the same
  entity is built only when the user chose it in *Choosing the path* — never recommended, never decided by the
  agent. `validate-page` before saving. Every removal must trace to evidence (a Classic delta op in Mode 1, the
  plan's field/detail set in Mode 2); if you cannot show it, treat it as a manual decision.

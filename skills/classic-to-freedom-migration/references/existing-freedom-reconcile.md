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

**Option 1 — the package.** Create it with `create-package` through `clio-run` (args
`environment-name`, `package-name`, `dependencies` = the package of each base page) and use the
returned `package-name` — it carries the stand's prefix — as `manifest.targetPackage`. Resolve the
contract with `get-tool-contract` first: `tool-not-found` means the installed clio has no such tool;
stop and report it as a blocker, and do not create the package another way. `package-created: true`
with `success: false` means the package exists but a later step failed — the dependencies were not
applied, or the read-back failed; fix that before any page write. Save each page with `update-page` /
`sync-pages` passing `target-package-uid` of that package, so the replacing schema lands there and
not in the base page's package.

**Option 1 — an existing client package.** An editable client package that already extends these
pages is offered as an alternative to the new package, in its own `AskUserQuestion`, saying that
earlier work there can be overwritten: the agent cannot see which earlier changes the new ones
replace. Use it only after the user explicitly agrees; never by default.

**Option 2 — the new app.** Ask for the app name and workplace, and which page opens the object's
records outside the new section (default: the existing page stays the object's default, so the
existing section and its default page binding are not changed). The page binding is per object, not
per section, so a binding change made for the new section also changes what the existing section
opens — say so in the question. Then build it as `new-app` per `./references/build-scaffolding.md`.

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
- **No duplicates by default.** Target the existing Freedom section. A second section for the same
  entity is built only when the user chose it in *Choosing the path* — never recommended, never
  decided by the agent.
- **Evidence before removal.** Every removal must trace to a specific Classic delta operation; if you
  cannot show that evidence, treat it as a manual decision.

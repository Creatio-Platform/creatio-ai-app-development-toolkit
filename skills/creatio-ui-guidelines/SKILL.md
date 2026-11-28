---
name: creatio-ui-guidelines
description: 'Creatio Freedom UI page design, layout, and review guidance. Apply proactively whenever creating, editing, or reviewing Creatio Freedom UI pages or their parts, building pages via clio MCP (create-app, create-app-section, create-page, update-page, sync-pages), choosing a page template, comparing a built page with a native one, or auditing layout, components, lookups, accessibility, and copy (captions, error messages, empty states). Keywords: Creatio, Freedom UI, record page, form page, list page, detail, expanded list, expansion panel, datagrid, lookup, field group, tab, profile island, mini page, dialog, section, stepper, wizard, dashboard, home page, page layout, UI review, UX audit.'
---

# Creatio UI guidelines

Use this skill to create or review Creatio Freedom UI pages that look native, are easy for end users, and meet accessibility expectations.

**Design for the person who uses the page.** Before placing anything, state the page's one question and walk through how a real user fills the page in and works with it: the order they enter data, what they look at most, what would slow them down. A page is done when it is easy to complete and use, not when every field exists.

**Judge the rendered page, not the schema.** Empty or unbalanced islands, missing group headers, cut values and spacing defects are invisible in the schema. Review and finish every page on its rendered form, compared with a native Creatio page on the same template.

**The native look wins.** When a general-purpose design skill (frontend-design, ui-ux-pro-max, taste and the like) is loaded too, this skill wins for Freedom UI pages: the base Creatio look over a distinctive one.

## Product telemetry — this skill has no workflow of its own

This is an **overlay**: it supplies naming/design rules to whichever flow is running, and it never owns a
run. Do **not** emit a separate telemetry session for it — the enclosing flow (app creation, migration,
mobile conversion, branding) already reports its own stages, and a second session would double-count.

The one exception is running **standalone**: if the developer invoked this skill directly and no other
CAADT flow is active, yet the run goes on to change the environment, that run is a targeted edit — emit
the `app-maintenance` stages from `../../context/product-telemetry.md` (`workflow_started`,
`plan_skipped`, `work_item_completed`, `workflow_completed` / `workflow_failed`) so the change is not
invisible. Telemetry is non-blocking and never gates the review or the edit.

## When rules collide

Apply the first that decides:

1. **The user's decision in this task**, taken through *The consistency guard* in `./references/design-judgement.md` (state the conflict, offer the options, record the choice).
2. **What native Creatio renders on the same template** — for looks only (border, radius, spacing, colour role), measured, not remembered.
3. **The component or template contract** — what `get-component-info` and `list-page-templates` return for the target environment.
4. **The layout and behaviour rules of this skill** — a native page that breaks one (an unbalanced column, a field cut by an ellipsis) does not overrule it.
5. **Judgement** — `./references/design-judgement.md` and `./references/visual-judgement.md`.

Every rule has one of three strengths, stated in its home section when it is not obvious:

- **pass/fail** — checkable with a tool or a measurement; a miss is a defect.
- **default** — do it unless the plan names the reason not to.
- **heuristic** — a signal for judgement; name your reasoning in the plan.

## Where to read — by task

**Read a reference by section, never whole.** List its headings with their line numbers (`grep -n '^#'`), then read that one section's lines (the file-reading tool's offset and limit, or `sed -n '<from>,<to>p'`). A read with no offset or limit, a full-file shell `cat`, and a series of ranged passes that walks the whole file each cost a full read of `page-layout-and-controls.md`, and a truncated `cat` also hides the part it cut off.

Look up `./references/page-layout-and-controls.md` by section: list its headings, then read the section for the element you are placing — start with *Choosing the component*, and resolve every component name through `get-component-info`, never from memory. For contrast, colour, charts, tabs or custom components, look up `./references/accessibility-and-colors.md` by section: list its headings, then read the section for the element you are placing. For an audit, read `./references/review-checklists.md` whole only for a full audit; for one check, look up its section by heading.

| Task | Read, in this order |
|---|---|
| Any new page | `design-judgement.md` *Before choosing a template*, *Which page shape* → the page's pattern in `page-patterns.md` → `page-layout-and-controls.md` *Choosing the page template* |
| Record page | `page-patterns.md` *Record page* → `page-layout-and-controls.md` *Page composition*, *Field-driven companions*, *Buttons and actions*, *Grouping and page flow*, *Fields* |
| Section list or worklist | `design-judgement.md` *Filter, search or both* → `page-patterns.md` *Section list page* or *Worklist* → `page-layout-and-controls.md` *List (section) page layout* |
| Related list on a record page | `page-layout-and-controls.md` *Related lists*, *List columns*; read-only lists: *Read-only detail*; then `get-guidance name=related-list` |
| Mini page, modal, add or edit form | `page-layout-and-controls.md` *Adding and editing data*, *Dialogs and modals* → `ux-writing.md` §3 |
| Step-by-step page | `page-patterns.md` *Step-by-step page* → `page-layout-and-controls.md` *Step-by-step page (stepper)* |
| Record connections | `page-layout-and-controls.md` *Record connections* (needs the `UseConnectionsComponent` feature — check it and tell the user when it is off or unknown) |
| Charts and metrics | `design-judgement.md` *Which chart* → `page-layout-and-controls.md` *Analytics and metric widgets* → clio `get-guidance name=dashboard-and-home-page-layout` and `name=widget-color-and-icon` |
| Dashboard or home page | `page-patterns.md` *Overview, dashboard and home page* → clio `get-guidance name=dashboard-and-home-page-layout` |
| Captions, messages, errors, empty states | `ux-writing.md`, the section for the text |
| Checking the built page | `visual-check.md` (the minimum check) → `review-checklists.md` *Self-critique before delivering* |
| Audit or review | `review-checklists.md` whole → `accessibility-and-colors.md` *Verifying accessibility on the rendered page* → `visual-check.md` |

A page built or reviewed without the matching sections is unfinished work, even if it happens to look right.

## Core rules

Each line is the rule and its check; the full rule, reasons and exceptions live in the named section of `./references/page-layout-and-controls.md` unless another file is named.

- **Components come from the catalog, composites from their whole recipe.** Resolve every `crt.*` type with `get-component-info`; for a Designer combination (Expanded list, Attachments, Approvals…) fetch `get-component-info composite='<caption>'`, build every part it names, and name the recipe and its parts in your evidence. *Choosing the component*.
- **Choose the template before `create-page`.** The template cannot be changed afterwards; a record with ordered stages needs a template with the progress bar. Resolve names with `list-page-templates`. *Choosing the page template*.
- **Keep the base Creatio look.** Copy styles from this page or, for a new page, from a shipped page on the same template; never restyle components across a form. Custom CSS (`styles`, `classes`, raw-CSS `extraStyles`) only after native inputs are exhausted, with an upgrade-risk warning and the user's confirmation. *Match existing styles*, *Custom CSS*.
- **Grid mechanics.** Read the container's column count before placing fields; stack ExpansionPanels full width, never side by side. *Layout coordinates and container nesting*, *Containers for grouping inputs*.
- **No empty layout gaps.** Inside each container, number rows 1, 2, 3… with no skipped row, counting the rows its existing children — the template's included — already take; only a container you create starts at row 1. *Layout coordinates and container nesting*.
- **An insert's `index` counts the children the parent already has — the parent template's included**, not only the inserts you emit. Read the parent's node in the `get-page` bundle before you set it; in a grid container the order in `items` follows `layoutConfig` row, then column. Worked example and several inserts into one parent: *Layout coordinates and container nesting* in `./references/page-layout-and-controls.md`.
- **A balanced, aligned record page.** The left column reaches the length of the right content, filled only with blocks that pass the subtract check; a component placed among fields lines up with them on both axes (within 2px on the rendered page). *Balance the page*, *Component alignment*.
- **Fields.** Required fields are the real minimum and sit on the first screen (default); few-value lookups are simple lookups (dropdowns); status-like lookups get colored chips by meaning (scale: *Freedom UI color guidance* in `./references/accessibility-and-colors.md`; how to set them: clio `get-guidance name=lookup-colors`); non-obvious and read-only fields get a placeholder or tooltip as localizable strings. *Required fields*, *Lookups and status chips*, *Field guidance*.
- **Every field on a mini page or a modal sets `labelPosition: "above"` explicitly.** *Label position*.
- **Lists.** Every related list is editable inline (`features.editable` with `enable: true` and `itemsCreation: true` on its `crt.DataGrid`) and also gets a mini page and a full page; only a tiny list goes without pages, and inline is off only when the user asks. Columns show whole values and fill the list's width. On a list page, filters go before `SearchFilter`. *Related lists*, *List columns*, *Filters and search*.
- **Field companions and analytics.** A deadline the user acts on soon gets a timer with a caption and explicit colours; a business Contact or Account gets its profile island; an amount gets a metric or chart only when it answers the page's question — in its own island or beside the data it sums, every compared series present. *Field-driven companions*, *Charts and metric tiles*.
- **The header shows one or two frequent actions; the rest go into one actions menu.** *Header actions*.
- **Accessibility basics on every page.** Text contrast ≥ 4.5:1 (large text ≥ 3:1), every component has a real accessible name, colour is never the only signal. `./references/accessibility-and-colors.md`.
- **Check the rendered page before calling it done.** Run the minimum check in `./references/visual-check.md` against a native page on the same template, then answer *Self-critique before delivering* in `./references/review-checklists.md` in writing; fix what is weak and check again.

## Page creation workflow

1. **Scenario**: the page's one question, its users, primary and secondary tasks, and whether it is a monitor, a worklist or a report (`./references/design-judgement.md`).
2. **Pattern and template**: the page's pattern in `./references/page-patterns.md` and its template from `list-page-templates`; for a complex page, two structurally different options chosen on written criteria.
3. **Structure**: header, primary display field, required fields, tabs, groups, islands, related lists, companions and metrics — the biggest block answers the page's question.
4. **Actions**: header actions by frequency, menu and row actions, confirmations, progress and undo.
5. **Fields and copy**: order, labels, placeholders, tooltips, defaults, required marks, lookups (`./references/ux-writing.md`).
6. **Build, then check**: the minimum render check and the written self-critique; fix and check again.

## What to deliver

| Output | Template or section | Required |
|---|---|---|
| Page design proposal | `./assets/templates/page-design.md` | when you design a page before building it |
| Built page | your plan's record per list and companion, plus the render check report (`./references/visual-check.md`) and the self-critique answers | after every built page |
| Audit | `./assets/templates/audit.md`, following *Audit output template*, *Citing the source of a finding* and *Severity model* in `./references/review-checklists.md` | for every audit |
| Verdict file | `./assets/templates/verdict.md`, per *Verdict file* in `./references/review-checklists.md` | for a full audit or acceptance run |
| Pixel review | `./assets/templates/pixel-review.md` | on request |

---
name: creatio-ui-guidelines
description: 'Creatio Freedom UI page design, layout, and review guidance. Apply proactively whenever creating, editing, or reviewing Creatio Freedom UI pages or their parts, building pages via clio MCP (create-app, create-app-section, create-page, update-page, sync-pages), or auditing layout, components, lookups, accessibility, and copy. Keep layouts native, gap-free, and accessible (WCAG/contrast). Keywords: Creatio, Freedom UI, record page, form page, list page, detail, expanded list, expansion panel, datagrid, lookup, field group, tab, profile island, mini page, dialog, section, page layout, UI review, UX audit.'
---

# Creatio UI guidelines

Design or review Creatio Freedom UI pages that look native, are understandable for end users, and meet accessibility expectations.

**This file is a router, not the rulebook.** The rules an agent gets wrong — exact component names, the concept→component map, grid/column math, gap rules, lookup mode, contrast values — live in the references. Do not build or audit from this summary or from memory. Run the loop below, and open the matching reference at each pass.

## Two principles that govern everything

- **Design as a UI/UX expert, not as a data-model dump.** Before composing or editing a page, walk through how a real user fills it in and uses it: the order they enter data, what they look at most, what would confuse or slow them. Make deliberate choices justified by UX heuristics — clarity, recognition over recall, error prevention, consistency, progressive disclosure, minimal effort. A page is done not when the fields exist, but when it is genuinely easy and pleasant to complete.
- **Judge the rendered page, not the schema.** When reviewing, base findings on the actual RENDERED page (screenshot + live accessibility tree) and walk the fill scenario first, then reconcile with the schema. Many defects are visual-only and invisible in the schema or a11y tree: empty/unbalanced islands, group headers that don't render, weak placeholders, spacing problems. "Looks fine in the schema" is not evidence the page is fine.

## Product telemetry — this skill has no workflow of its own

This is an **overlay**: it supplies design rules to whichever flow is running and never owns a run. Do **not** emit a separate telemetry session for it — the enclosing flow (app creation, migration, mobile conversion, branding) already reports its own stages, and a second session would double-count.

The one exception is running **standalone**: if the developer invoked this skill directly, no other CAADT flow is active, and the run goes on to change the environment, emit the `app-maintenance` stages from `../../context/product-telemetry.md` (`workflow_started`, `plan_skipped`, `work_item_completed`, `workflow_completed` / `workflow_failed`). Telemetry is non-blocking and never gates the review or the edit.

## References — read the matching one BEFORE you act (required, not optional)

Open the matching reference and follow it before producing a design, an edit, or an audit. Skipping it is the main cause of the recurring defects (selection-window lookups, layout gaps, bare fields, non-native details). Reading it is part of finishing the work — a page built or reviewed without it is incomplete even if it happens to look right.

| Task | Read first |
|---|---|
| Create, edit, lay out, or review a page — fields, groups, tabs, islands, details, lookups, buttons, `layoutConfig`, composition | **`./references/page-layout-and-controls.md`** — the canonical rule set. Start with its "Choosing the component (source of truth)": resolve every `crt.*` name via `get-component-info`, never from memory. |
| Accessibility, contrast, color, charts, custom components | **`./references/accessibility-and-colors.md`** |
| Produce an audit, review, or acceptance checklist | **`./references/review-checklists.md`** — start with its **Critical gate**, then the grouped checklist and output templates. |

When a task spans several, read each. **Read a large reference in bounded slices** (the file tool's offset/limit), never as one full-file shell `cat` — `page-layout-and-controls.md` is long enough that a truncated `cat` has silently cost a full read before.

## The loop — the passes to build or assess a page

Run these passes in order. Each names what to decide and where its rules live. Every rule the passes touch is stated **once**, in the reference named — this file does not restate them.

1. **Scenario & goal.** State the primary users, primary task, secondary tasks, entry points, and completion signal; and whether the page is for create, view, edit, approval, or analytics. Clarify only when the task cannot proceed without it — prefer best-effort recommendations over blocking. Reuse an analogous Creatio pattern before inventing one.
2. **Structure & islands.** Choose the **page template before `create-page`** (a staged/DCM record needs the progress-bar template — it cannot be swapped later). Lay out header, profile island(s), metrics, related profiles, tabs; keep the left and right columns balanced; group fields into real blocks. → *Page composition*, *Grouping and page flow*, *Choosing the page template*.
3. **Fields & field-driven companions.** Order fields by fill flow; require the real minimum only; make few-value lookups dropdowns (`simple-lookup`), not selection windows; add helpful tooltips/placeholders, not bare fields. Then place the **obligatory companions**: an amount → analytics on its value; a deadline → a timer; a business-relationship Contact/Account → a read-only profile island. → *Fields*, *Field-driven companions*.
4. **Actions.** Place buttons in the right container (header vs beside-the-result vs island footer); one primary per context; confirm destructive actions; warn/async on long-running ones. → *Buttons and actions*, *Long-running and destructive actions*.
5. **Accessibility.** Contrast (≥4.5:1 / ≥3:1), filled accessible names, keyboard reach, color never the only signal — checked on every page, not only in a dedicated audit. → `./references/accessibility-and-colors.md`.
6. **Run the checklist.** Before calling the work done, run `./references/review-checklists.md` — the **Critical gate first**, then the grouped items. Always include the checklist output in a design or audit.

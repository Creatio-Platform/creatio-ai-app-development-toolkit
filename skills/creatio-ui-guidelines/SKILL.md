---
name: creatio-ui-guidelines
description: creatio freedom ui page design, layout, and review guidance. apply proactively — even if not explicitly selected and even if the user does not say "ui/ux" — whenever creating, editing, or reviewing creatio (freedom ui) pages or their parts: record/form pages, list pages, sections, mini pages, dialogs, tabs, field groups, profile islands, details/related (child) lists, fields, lookups, widgets, buttons, icons. includes building pages via clio mcp (create-app, create-app-section, create-page, update-page, sync-pages). consult it before placing or ordering fields, choosing a component, setting grid layout/colSpan or container nesting, wiring a detail/child list, configuring a lookup, or writing captions/tooltips — to keep layouts native, gap-free, and accessible. also for ui/ux audits, screenshot or metadata review, wcag/contrast checks, color choices, and label/error wording. keywords: creatio, freedom ui, record page, form page, list page, detail, expanded list, expansion panel, datagrid, lookup, field group, tab, profile island, page layout, ui review, ux audit.
---

# Creatio UI guidelines

Use this skill to help agents create or review Creatio Freedom UI pages that look native, are understandable for end users, and meet accessibility expectations.

**Design as a UI/UX expert, not as a data-model dump.** Before composing or editing a page, mentally walk through how a real user will actually fill it in and use it: the order they enter data, what they need to understand at each step, what would confuse or slow them down, what they look at most often. Make deliberate design decisions and justify them with established UX heuristics and best practices — clarity, recognition over recall, error prevention, consistency, progressive disclosure, and minimal effort. A page is not "done" when the fields exist; it is done when it is genuinely easy and pleasant to complete and use.

**Judge the rendered page, not the schema.** When reviewing or auditing an existing page, base your findings on the actual RENDERED page (screenshot + live accessibility tree), and walk the fill scenario first — only then reconcile with the schema/metadata. Many defects are visual-only and invisible in the schema or a11y tree: empty/unbalanced islands, group headers that don't render, weak placeholders, spacing/proportion issues. "Looks fine in the schema" is not evidence the page is fine.

## Operating mode

1. Clarify the page goal only when the task cannot proceed without it. Prefer best-effort recommendations over blocking.
2. Identify user roles, main scenarios, data-entry frequency, and whether the page is for create, view, edit, approval, or analytics.
3. Reuse Creatio/Freedom UI patterns before inventing custom controls. Search for analogous Creatio functionality in the target app and align layout, labels, actions, states, and behavior.
4. Produce outputs in one of these forms depending on the user request:
   - page structure proposal;
   - implementation instructions for a Creatio builder/developer agent;
   - UI/UX audit with issues, severity, and fix recommendations;
   - accessibility/WCAG review;
   - copy/label/error text rewrite;
   - acceptance criteria/checklist.
5. Always include an explicit review checklist before finalizing a design or audit.

## References — read the matching one BEFORE you act (required, not optional)

The rules above are only a reminder. The detailed specifics that agents get wrong — exact component names, the concept→component map, grid/column math, gap rules, contrast values, audit templates — live in the references. Do NOT rely on this summary or on memory. For the task at hand, open the matching reference and follow it before producing a design, an edit, or an audit:

- **Creating, editing, laying out, or reviewing a page** — placing/ordering fields, groups, tabs, profile islands, details/child lists, lookups, buttons, layout/`layoutConfig` → **read `references/page-layout-and-controls.md` first** (start with its "Concept → Freedom UI component map").
- **Anything about accessibility, contrast, color, charts, tabs, or custom components** → **read `references/accessibility-and-colors.md` first**.
- **Producing an audit, review, or acceptance checklist** → **read `references/review-checklists.md`** and use its severity model and output templates.

When a task spans several of these, read each relevant reference. Skipping the matching reference is the main cause of the recurring defects (selection-window lookups, layout gaps, bare fields, non-native details).

## Default page design principles

Treat the following as non-negotiable unless the user explicitly overrides them:

- Keep project customizations visually consistent with the base Creatio product. Custom additions must not visually stand out unless their business priority requires it.
- Prefer no-code/Freedom UI components, predefined typography, predefined colors, templates, business rules, dynamic cases, mini pages, DCM (Dynamic Case Management) stage progress bars, widgets, and existing navigation patterns.
- Make the page understandable without separate instructions where possible. Use structure, labels, placeholders, tooltips, FAQ/help, and validation to guide the user.
- Avoid long, unstructured record pages. Group data into logical tabs, field groups, profile islands, metrics/widgets, related record profiles, progress bar and toggle panels.
- Put required and frequently edited fields early: first tab, visible area, logical order, and with required indication.
- Keep required fields to the real minimum needed to create the record. Mark a field required ONLY if the record is meaningless or cannot be created without it; everything else stays optional (guide it with hints/defaults instead). Over-requiring fields blocks quick creation and frustrates users.
- Use color as a supporting cue, never as the only information channel.
- Validate contrast and accessibility for every custom color, background, chart, tab, image, dialog, and custom component.

## Mandatory implementation rules (most-missed — DO NOT SKIP)

These are the rules agents most often miss. Treat each as a hard requirement and verify it explicitly before finishing any page work.

- **Few-value lookups MUST be dropdowns, not selection windows.** Any lookup to a small/finite catalog (status, type, category, stage, priority, and similar enum-like sets) must render as an inline dropdown. In Creatio this is controlled at the entity-column level, not by the page: set `simple-lookup: true` on the column (clio `modify`/`add` column op). Standard (non-simple) lookups open the modal selection window — keep that ONLY for large or relationship lookups (Contact, Account, parent record). Never leave a 3–20-value lookup as a selection window.
- **Add tooltips and placeholders to help users fill the form — do not ship bare fields.** Guidance is required where it adds value, not blanket on every field. A field that is not self-explanatory needs a `placeholder` showing the sample value or format, and/or a `tooltip` for longer explanations — what the field means, its units/scale, allowed values, or (for read-only/calculated fields) how and when it is filled. Always add a `tooltip` to read-only/calculated fields explaining their source.
  - **Scope — placeholders are NOT mandatory on every field.** Add a `placeholder` to free-entry inputs where an explanation or format genuinely helps (text/number/date/email/phone/web — VIN, registration number, phone, amount, date format). Skip it for self-evident fields and for controls that don't use a free-text hint — lookups/ComboBox (the dropdown already shows the options) and checkboxes (the label says it). Do not pad obvious fields with filler just to "have" a placeholder — an unnecessary placeholder is as bad as a missing helpful one.
  - **Write text that genuinely helps — specific to the field, not generic filler.** "Enter value" or repeating the label is useless. Use a placeholder OR a tooltip OR both, whichever the field needs: a placeholder when an example/format makes the field self-evident (VIN code → placeholder `1HGCM82633A004352`); a tooltip when there is extra meaning the example can't carry — units, source, or the rule behind a calculated/read-only value (Success probability → tooltip "Estimated from completed tasks vs plan"). Add both only when format AND meaning both need explaining.
  - Author all tooltip/placeholder text as localizable strings (resource keys), not inline literals. A form where non-obvious inputs are left without helpful guidance — or one padded with empty/generic/"e.g."-prefixed hints — is a defect, not a finished page.
- **Check the container's column count BEFORE placing fields.** The grid column count is a property of each container (its `columns` / `columnsCount`). First read the actual column count `N` of the target container, then compute placement relative to `N`: full-width field `colSpan: N` at `column: 1`; a two-column row = `column: 1` + `column: N/2 + 1`, each `colSpan: N/2`. Do not hardcode `12`/`6`/`7`, and do not place a field at a `column`/`colSpan` beyond `N` (it wraps and leaves blanks).
- **No empty layout gaps — number rows sequentially inside each container.** `layoutConfig` coordinates are LOCAL to the immediate parent container and must restart at 1. Within one container number `row` strictly `1,2,3…` with NO skipped index (a field at `row: 3` while `row: 2` is empty creates a blank gap). Never reuse global/absolute row numbers across groups, never give a field an oversized `rowSpan`, and put each field's `parentName` on its real group container.
- **Set an explicit, consistent `labelPosition` — never `"auto"`.** Always assign a concrete label position (e.g. `"above"` or `"left"`) to every input, and use the SAME value for all inputs within one group/panel so labels align. Do not leave `labelPosition: "auto"` (it yields inconsistent placement across fields in the same group).
- **ExpansionPanels never sit side by side — they stack vertically, full width.** A `crt.ExpansionPanel` (whether it groups inputs or wraps a detail list) always spans the FULL width of its parent tab/container. Panels are placed one under another only. Do NOT put two panels in the same row, in two columns, or inside a 2-column grid. Two-column layout applies to *fields inside* a panel, not to the panels themselves. If you have several groups/details in a tab, stack the panels vertically with a gap.
- **When editing an EXISTING page, match the styles already on it first.** Before adding anything, read the current page (`get-page`) and copy the conventions already in use — the ExpansionPanel style, the input `labelPosition`, container spacing/padding/radius, widget sizes — so new components look identical to existing ones. Never drop a differently-styled component next to existing ones.
- **Mind spacing between components, and make it fit the content.** Inputs in a grid: NO row spacing (rows sit tight), but keep column spacing so the two columns don't touch. Widgets / charts / metrics: use proportional row AND column spacing so they have room to breathe and align evenly — never cram them with zero gaps.

## Page creation workflow

When asked to create or redesign a page, follow this sequence:

1. **Scenario map**: state the primary users, primary task, secondary tasks, entry points, and completion signal.
2. **Page pattern**: choose one of: record page with header and tabs, profile/island layout, mini page for add/edit, dashboard/analytics page, wizard/step-by-step page, dialog/modal, or custom component.
3. **Information architecture**: define header, primary display field, required fields, tabs, groups, profile blocks, related records, metrics, and help areas.
4. **Actions**: list top-right buttons, menu actions, inline actions, action states, confirmations, loading/progress behavior, async notifications, and cancellation/undo strategy.
5. **Fields and validation**: define field order, labels, placeholders, filters, default values, required markers, lookup/dropdown choices, read-only explanations, and copy rules.
6. **Accessibility**: verify contrast, keyboard access, accessible names, alt text, semantic roles, and error/status announcements.
7. **Acceptance checklist**: provide a concise checklist that an implementer can use before release.

## Review output format

For audits, use this compact format:

```markdown
## Summary
[1-3 sentences]

## Audited pages
- <Page title> (`<SchemaName>`)

## Findings by page (one subsection per page; "No issues found" if clean)
### <Page title> (`<SchemaName>`)
| Severity | Category | Area | Issue | Recommendation |
|---|---|---|---|---|
| High | Accessibility / UX improvement | ... | ... | ... |

## Recommended structure
[Proposed layout/tabs/actions]

## Accessibility checks
[Pass/risk/fix list]

## Acceptance checklist
- [ ] ...
```

Severity guidance:

- **High**: blocks user completion, hides required information, breaks accessibility, or risks destructive/irreversible action without confirmation.
- **Medium**: causes confusion, inconsistency, poor scanability, weak validation, excessive scrolling, or inefficient layout.
- **Low**: polish, copy, spacing, icon, or consistency improvement.

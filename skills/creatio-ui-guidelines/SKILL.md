---
name: creatio-ui-guidelines
description: 'Creatio Freedom UI page design, layout, and review guidance. Apply proactively whenever creating, editing, or reviewing Creatio Freedom UI pages or their parts, building pages via clio MCP (create-app, create-app-section, create-page, update-page, sync-pages), or auditing layout, components, lookups, accessibility, and copy. Keep layouts native, gap-free, and accessible (WCAG/contrast). Keywords: Creatio, Freedom UI, record page, form page, list page, detail, expanded list, expansion panel, datagrid, lookup, field group, tab, profile island, mini page, dialog, section, page layout, UI review, UX audit.'
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

- **Creating, editing, laying out, or reviewing a page** — placing/ordering fields, groups, tabs, profile islands, details/child lists, lookups, buttons, layout/`layoutConfig` → **read `./references/page-layout-and-controls.md` first** (start with its "Choosing the component (source of truth)" — resolve component names via `get-component-info`, never from memory).
- **Anything about accessibility, contrast, color, charts, tabs, or custom components** → **read `./references/accessibility-and-colors.md` first**.
- **Producing an audit, review, or acceptance checklist** → **read `./references/review-checklists.md`** and use its severity model and output templates.

When a task spans several of these, read each relevant reference. Skipping the matching reference is the main cause of the recurring defects (selection-window lookups, layout gaps, bare fields, non-native details). **Reading the matching reference is itself part of finishing the work, not a courtesy step** — a page built or reviewed without it is incomplete even if it happens to look right, exactly like any other gated deliverable this skill's caller checks for.

**Read a large reference in bounded slices (e.g. the file-reading tool's own offset/limit), never as one full-file shell `cat`.** `page-layout-and-controls.md` is long enough that a truncated `cat` (persisted-output path) has silently cost a full read before — read it in a few ranged passes (or by section) instead of assuming one command returns the whole file.

## Default page design principles

Treat the following as non-negotiable unless the user explicitly overrides them:

- **Keep project customizations visually consistent with the base Creatio product — custom additions must not visually stand out.** Use the default component appearance, typography, colors, spacing, and borders of standard Creatio. A customization that makes the page look different from the base product (even if it seems "nicer" in isolation) is a defect, not an improvement. Deviate only when a real business priority requires it — and then as a deliberate, scoped decision, never as a side effect of another change.
- Prefer no-code/Freedom UI components, predefined typography, predefined colors, templates, business rules, dynamic cases, mini pages, DCM (Dynamic Case Management) stage progress bars, widgets, and existing navigation patterns.
- Make the page understandable without separate instructions where possible. Use structure, labels, placeholders, tooltips, FAQ/help, and validation to guide the user.
- Avoid long, unstructured record pages. Group data into logical tabs, field groups, profile islands, metrics/widgets, related record profiles, progress bar and toggle panels.
- Put required and frequently edited fields early: first tab, visible area, logical order, and with required indication.
- Keep required fields to the real minimum needed to create the record. Mark a field required ONLY if the record is meaningless or cannot be created without it; everything else stays optional (guide it with hints/defaults instead). Over-requiring fields blocks quick creation and frustrates users.
- Use color as a supporting cue, never as the only information channel.
- Validate contrast and accessibility for every custom color, background, chart, tab, image, dialog, and custom component.

## Mandatory implementation rules (most-missed — DO NOT SKIP)

These are the rules agents most often miss. Treat each as a hard requirement and verify it explicitly before finishing any page work.

- **A pre-built combination is a COMPOSITE, not a single type — never hand-build one from raw component types.** "Expanded list", "Attachments", "Next steps", "Communication options", "Approval list", and similar Designer-listed combinations assemble SEVERAL components together (e.g. Approvals = a module/widget above the profile island PLUS the approval list — two components, not one). Get the assembly recipe with `get-component-info composite='<caption>'` and build EVERY part it names — never insert only the part you recognize and treat the rest as optional. This rule was measured to reach the model and still get applied to only some of a plan's composites (not all) — if a spec enumerates a composite's parts, every part is its own required deliverable, not a single row that closes on partial work.
  - **Record which recipe you fetched for every `compositeOnly` type you insert.** When `get-component-info` reports a type as `compositeOnly`, name — in your worklog/evidence, not only in your own reasoning — the exact `composite='<caption>'` recipe you fetched for it and every part that recipe named. A `compositeOnly` type with no recipe named in your evidence is not a machine-blocked stop today (there is no automated gate for this outside the Approvals module/list pair, which IS machine-checked — see the migration engine's `Quality gates` row), but it is a reviewable claim: a reviewer or a later run can compare what you recorded against the recipe and catch a partial build the same way this rule's own measurement did.
- **Contrast and accessible-name basics are checked on every page, not only during a dedicated audit.** Standard/small text ≥ 4.5:1 contrast, large text ≥ 3:1 (custom tabs/areas/charts/backgrounds included); every component's accessible name (`Title`/`aria-label`/tooltip/alt) is filled with a real, meaningful value, never left empty or at a placeholder default. These are pass/fail checks, not a "nice to have" reserved for `references/accessibility-and-colors.md` — apply them while building, then use that reference for anything beyond this baseline (charts, custom components, the full WCAG criteria list).
- **A dense or overloaded layout is a required fix, or a decision to raise — never "refine if desired."** Reread the rendered page against *Default page design principles* above (balance, spacing, grouping) before calling a page done; a layout that only "technically" places every field is not finished work.
- **Few-value lookups MUST be dropdowns, not selection windows.** Any lookup to a small/finite catalog (status, type, category, stage, priority, and similar enum-like sets) must render as an inline dropdown. In Creatio this is controlled at the entity-column level, not by the page: set `simple-lookup: true` on the column (clio `modify`/`add` column op). Standard (non-simple) lookups open the modal selection window — keep that ONLY for large or relationship lookups (Contact, Account, parent record). Never leave a 3–20-value lookup as a selection window.
- **Add tooltips and placeholders to help users fill the form — do not ship bare fields.** Guidance is required where it adds value, not blanket on every field. A field that is not self-explanatory needs a `placeholder` showing the sample value or format, and/or a `tooltip` for longer explanations — what the field means, its units/scale, allowed values, or (for read-only/calculated fields) how and when it is filled. Always add a `tooltip` to read-only/calculated fields explaining their source.
  - **Scope — placeholders are NOT mandatory on every field.** Add a `placeholder` to free-entry inputs where an explanation or format genuinely helps (text/number/date/email/phone/web — e.g. a code, phone, amount, or date format). Skip it for self-evident fields and for controls that don't use a free-text hint — lookups/ComboBox (the dropdown already shows the options) and checkboxes (the label says it). Do not pad obvious fields with filler just to "have" a placeholder — an unnecessary placeholder is as bad as a missing helpful one.
  - **Write text that genuinely helps — specific to the field, not generic filler.** "Enter value" or repeating the label is useless. Use a placeholder OR a tooltip OR both, whichever the field needs: a placeholder when an example/format makes the field self-evident (a formatted field → show the format, e.g. a date as `dd.mm.yyyy`); a tooltip when there is extra meaning the example can't carry — units, source, or the rule behind a calculated/read-only value (a computed score → explain how it is derived). Add both only when format AND meaning both need explaining.
  - Author all tooltip/placeholder text as localizable strings (resource keys), not inline literals. A form where non-obvious inputs are left without helpful guidance — or one padded with empty/generic/"e.g."-prefixed hints — is a defect, not a finished page.
- **Check the container's column count BEFORE placing fields.** The grid column count is a property of each container (its `columns` / `columnsCount`). First read the actual column count `N` of the target container, then compute placement relative to `N`: full-width field `colSpan: N` at `column: 1`; a two-column row = `column: 1` + `column: N/2 + 1`, each `colSpan: N/2`. Do not hardcode `12`/`6`/`7`, and do not place a field at a `column`/`colSpan` beyond `N` (it wraps and leaves blanks).
- **No empty layout gaps — number rows sequentially inside each container.** `layoutConfig` coordinates are LOCAL to the immediate parent container and must restart at 1. Within one container number `row` strictly `1,2,3…` with NO skipped index (a field at `row: 3` while `row: 2` is empty creates a blank gap). Never reuse global/absolute row numbers across groups, never give a field an oversized `rowSpan`, and put each field's `parentName` on its real group container.
- **Use a consistent `labelPosition` across a group — but never restyle a component to achieve it.** Use the SAME label position for all inputs within one group/panel so labels align; prefer a concrete value (`"above"`/`"left"`). However, **do NOT change a component's `appearance` (e.g. `crt.Input` `legacy`→`outline`) just to make a chosen label position render cleanly** — keeping the base Creatio look wins over the label position. If an explicit position would require an appearance change, keep the default appearance (`"auto"` is acceptable when it already renders consistently).
- **Never restyle components to fix a minor nuance — no scope creep.** Do not change a component's default `appearance`/style across the form (e.g. switch every `crt.Input` to `appearance: "outline"`, or change fonts/borders/colors) to work around a small issue or to satisfy another rule. That makes the whole form deviate from base Creatio — a bigger problem than the nuance it fixes. Keep platform defaults; fix only the specific field if truly needed; if a real styling change is warranted, treat it as a deliberate, scoped decision (and confirm it), not a global repaint.
- **Custom CSS is a LAST RESORT — native inputs first, then warn and confirm before applying it.** A visual-styling requirement (color, background, font/typeface, text size, spacing/padding/margin, border, width/height, alignment) is CUSTOM CSS the moment you express it as a `styles` object, a `classes`/CSS class, OR a component `extraStyles` hook (e.g. `extraStyles.toggle`, `extraStyles.label`) carrying raw CSS values such as `color`, `fill`, or `font-family` — all three carriers count equally; `extraStyles` is NOT "native" just because it is a component input. Custom CSS is not covered by the platform-upgrade compatibility guarantees that native component inputs have, so it can break or conflict on a future Creatio upgrade. The Freedom UI font is Montserrat and colors/typography come from theme tokens, so changing a font-family or hard-coding a color is custom CSS, never a native default. Mandatory order: **(1)** exhaust the component's NATIVE inputs first (resolve them with `get-component-info`; if a native property achieves the look, use it and do not mention CSS); **(2)** only if no native input can do it, tell the user plainly that no native solution exists, warn that custom CSS may break on a future platform upgrade, and ask for explicit confirmation before writing any `styles`/`classes`/`extraStyles`; **(3)** if the user declines, do not apply CSS — offer the closest native alternative or state the exact look is not achievable natively. Even a "don't ask / just apply" instruction waives the question, NOT the one-line upgrade-risk warning: never apply custom CSS silently.
- **ExpansionPanels never sit side by side — they stack vertically, full width.** A `crt.ExpansionPanel` (whether it groups inputs or wraps a detail list) always spans the FULL width of its parent tab/container. Panels are placed one under another only. Do NOT put two panels in the same row, in two columns, or inside a 2-column grid. Two-column layout applies to *fields inside* a panel, not to the panels themselves. If you have several groups/details in a tab, stack the panels vertically with a gap.
- **Match existing styles — from this page, or from a shipped reference page when this one is new.** Before adding anything, read the current page (`get-page`) and copy the conventions already in use — the ExpansionPanel style (spacing, padding, `borderRadius`, header/collapsed state), the input `labelPosition`, container spacing/padding/radius, widget sizes — so new components look identical to existing ones. Never drop a differently-styled component next to existing ones. **When the page is NEW / empty (e.g. a freshly created migration form page) so there is nothing on it to match, copy those same styles from a shipped reference page on the SAME template** (`get-page` a real Freedom page that already has ExpansionPanels / profile islands) — an ExpansionPanel or added container must look like Creatio's, not a bare default box.
- **Mind spacing between components, and make it fit the content.** Inputs in a grid: NO row spacing (rows sit tight), but keep column spacing so the two columns don't touch. Widgets / charts / metrics: use proportional row AND column spacing so they have room to breathe and align evenly — never cram them with zero gaps.
- **Keep the left and right areas proportional — the left column must not be half-empty.** The page must read as two balanced columns of comparable length, not a long content area beside a short left column. Filling the left island with just one or two fields is NOT enough when the right area is long: add a second (and if needed a third) left island with the same settings as the first and distribute key stable fields (and small metrics) into them until the left column reaches the length of the right — at least to the end of the page's content. Verify this against the RENDERED page height, not the schema. See *Page composition → Balance the page* in `./references/page-layout-and-controls.md`.

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

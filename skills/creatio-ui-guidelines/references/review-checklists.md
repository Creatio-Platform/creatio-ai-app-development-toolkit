# Review checklists and output templates

Use this reference for audits, acceptance criteria, and final checks.

## Quick audit checklist

### Audit the rendered page, not the schema (do this FIRST)

- [ ] The review is based on the **rendered page** (screenshot + live accessibility tree / DOM), not only the schema, metadata, or `layoutConfig`. Open the actual page and look at it.
- [ ] You walked the user's **fill scenario** on the render before reconciling with the schema — not the reverse.
- Why: many defects are **visual-only** and do NOT appear in the schema or the a11y tree — empty/short or unbalanced left island, group headings that don't actually render, placeholder quality (e.g. junk like "Phone 123"), spacing/proportion problems. "Looks fine in the schema" is not evidence the page is fine.
- [ ] No finding was silently dropped because it looked "intentional" or "temporary" (e.g. a placeholder added for a demo) — flag it explicitly instead of omitting it.

### Think like a user (UX sanity — do this first)

Answer these from the user's perspective before the detailed checks:

- [ ] Does the field/section order match how the user actually fills the page (top-down, required first, dependencies before dependents)?
- [ ] Is the information the user needs most often the most prominent (top, profile island, first tab)?
- [ ] Does anything force recall or extra effort the design could remove (re-typing, hunting for a field, unexplained values)?
- [ ] Are mistakes prevented up front (clear hints, sensible defaults, constrained inputs) rather than only caught after save?

### Scenario and consistency

- [ ] Main user role and task are clear.
- [ ] The page follows an analogous Creatio/Freedom UI pattern where one exists.
- [ ] Custom functionality does not visually conflict with base Creatio styling.
- [ ] The interface can be understood by a new user without project-team explanation.

### Navigation and object setup

- [ ] Section has a unique icon that works in collapsed navigation.
- [ ] Icon style matches Freedom UI: filled, rounded, `#0D2E4E`, SVG where possible.
- [ ] Primary display column exists, is text, required, auto-filled, and ideally unique.
- [ ] Primary display value is useful in page title, lookup, register, and record links.

### Layout and structure

- [ ] Ready templates are reused where possible.
- [ ] Header is not overloaded.
- [ ] Important fields fit in the header/profile area.
- [ ] Long pages are split into tabs, groups, islands, or wizard steps.
- [ ] Field groups have clear names and no unnecessary one-field duplicate-title groups.
- [ ] No container (group / tab / profile island) holds a single lone field; each holds a logically related set (≥2–3 fields).
- [ ] Fields are grouped by business meaning; related fields are adjacent.
- [ ] The main-information block (profile island + general tab) carries the record's core descriptive attributes (who/what/when/status), not just Name.
- [ ] Required/frequently edited fields are on the first tab and visible without long scrolling.
- [ ] Empty space is not created by an oversized side island with too little content.
- [ ] Left/profile column is filled — for objects with many columns a second left island (same settings) is added so the left side isn't near-empty.
- [ ] New islands use the standard settings (white color, column spacing Large, row spacing None, border radius Medium, padding T/B Medium · L/R Large); plain inner input grids use transparent color, column spacing Large, row spacing None, border radius None, padding None — not designer defaults.
- [ ] One-column/two-column mixes do not break reading flow.
- [ ] Container column count was checked first (not assumed 12); `column`/`colSpan` are within that count (two-column = column 1 + column N/2+1, each colSpan N/2).
- [ ] No empty layout gaps: within each container `layoutConfig.row` runs 1..N with no skipped indices, no oversized `rowSpan`, and group containers use `rows: "auto"`.
- [ ] Every field's `parentName` is its intended group container (nesting is correct; coordinates are container-local, not global).
- [ ] ExpansionPanels are full width and stacked vertically — none placed side by side, in two columns, or with a partial `colSpan`.
- [ ] Analytic widgets are at the top (top of profile island or first in the tab; a dedicated Analytics tab if many); the profile island holds only small (XS/S) metrics, with icons, not large charts.
- [ ] Section (list) page: custom filters in `LeftFilterContainer`/`RightFilterContainer`, extra actions in `ActionButtonsContainer`, analytics/dashboards in the Dashboard component (or `DashboardsTabContainer`) — nothing dropped loose on the page.
- [ ] When editing an existing page, new components match the styles already there (panel style, `labelPosition`, spacing/padding/radius, widget size, column count).
- [ ] Spacing fits the content: inputs have no row spacing but do have column spacing; widgets/charts/metrics use proportional row + column spacing; gaps between siblings look even.

### Fields and data entry

- [ ] Fields are ordered in the sequence users fill or read them.
- [ ] Standard record fields use two columns where appropriate.
- [ ] Labels are short, clear, and in Sentence case.
- [ ] Abbreviations, units, codes, and formats are explained in tooltip/placeholder/help.
- [ ] Lookup fields are filtered to relevant values.
- [ ] Small enum-like lookups (status, type, category, ~<20 rows) are simple lookups → render as dropdowns (`simple-lookup: true`); large/related lookups (Contact, Account, parent) use the selection window.
- [ ] Date-only business fields are not rendered with a time picker.
- [ ] Read-only fields explain why/how/when they are filled (tooltip) and show units/scale (placeholder).
- [ ] Non-obvious fields have a placeholder (example/format hint) and/or a tooltip (meaning, units, allowed values); the form is not a wall of bare inputs.
- [ ] Tooltip/placeholder text is authored as localizable resource strings, not inline literals.
- [ ] Every input has an explicit `labelPosition` (not `"auto"`), and it is the same for all inputs within a group/panel.
- [ ] Required fields are marked.
- [ ] Only the real minimum is required — fields are mandatory only when the record cannot be created without them; the rest stay optional.
- [ ] Default values, validation, and auto-substitution are configured where helpful.
- [ ] Checkboxes/logical fields are placed after related fields.
- [ ] Status/stage/order uses DCM/progress bar where appropriate.

### Buttons, actions, and dialogs

- [ ] Page-level buttons are in the upper-right area.
- [ ] General/page-level actions are in `ActionButtonsContainer`; context-specific actions (fill/compute a field) sit next to the component that shows the result.
- [ ] Buttons are inside a `crt.FlexContainer` (not dropped on a grid); a button next to an input shares one flex with that input.
- [ ] There is no more than one Primary button per context.
- [ ] Rare actions are moved into a menu.
- [ ] Buttons, menu items, and multiple filters have fitting, distinct icons where they aid recognition (consistent icon style), not a row of identical/icon-less items.
- [ ] Buttons have consistent height and alignment.
- [ ] Buttons are visible/active only when applicable.
- [ ] Destructive or irreversible actions require confirmation, undo, or cancellation.
- [ ] Long-running actions show warning and progress/status.
- [ ] Operations over 30 seconds or unknown duration are asynchronous with notification.
- [ ] Dialogs follow Creatio/mini-page styling and place instructions before controls.
- [ ] Dialog button labels are consistent and result-oriented.

### Copy and content

- [ ] Labels and headings use Sentence case, not Title Case/all caps.
- [ ] Button labels are short and describe the result.
- [ ] Error messages explain what the user can do next.
- [ ] Admin technical details are not exposed to regular users unless necessary.
- [ ] User-facing text is in one language or intentionally localized.

### Typography and visual style

- [ ] Montserrat and predefined Freedom UI typography are used.
- [ ] Font sizes/styles are minimized and based on Headline 1-4, Body, Caption.
- [ ] Colors are minimized and based on predefined palette.
- [ ] Color is not the only indication of status or meaning.
- [ ] Custom global styles/themes have a clear business reason.
- [ ] Components keep the default Creatio appearance — no global restyle (e.g. `crt.Input` switched to `appearance: "outline"`, custom borders/fonts) that makes the form look different from the base product; no restyle done just to satisfy another rule (e.g. label position).

### Accessibility

- [ ] **`references/accessibility-and-colors.md` was actually opened and applied (not skipped, not from memory).** Accessibility is a required dimension of every page/review, not an optional final step — run these checks for every design and audit.
- [ ] Standard/small text contrast is at least 4.5:1.
- [ ] Large text contrast is at least 3:1.
- [ ] Custom tab, Area, chart, glass, and wallpaper combinations are contrast-checked.
- [ ] All interactive elements are reachable and usable by keyboard.
- [ ] Icon-only actions have tooltips/accessibility names.
- [ ] Informative images have alt text; decorative images are ignored by screen readers.
- [ ] Charts/diagrams have text alternative or data table where needed.
- [ ] Each component's accessibility parameters (accessible name/`aria-label`, label/caption, tooltip, alt) are present AND filled in — not empty or left at default.
- [ ] Status changes/no-result messages are announced when relevant.

## Audit output template

```markdown
## Summary
[Brief overall assessment]

## Audited pages
- <Page title> (`<SchemaName>`, <form/list/mini/dialog>)
- <Page title> (`<SchemaName>`, …)

## Findings by page
Report findings separately for each audited page. One subsection per page; if a page has no issues, say "No issues found."

### <Page title> (`<SchemaName>`)
| Severity | Category | Area | Issue | Recommendation |
|---|---|---|---|---|
| High | UX improvement | Required fields | Required fields are below the fold | Move required fields to the first tab and visible area |
| Medium | Accessibility | Contrast | Status text relies on color only | Add an icon/label and meet 4.5:1 contrast |

### <Page title> (`<SchemaName>`)
| Severity | Category | Area | Issue | Recommendation |
|---|---|---|---|---|
| … | … | … | … | … |

**Category** is one of: **Accessibility** (WCAG/contrast/keyboard/alt/announcements) or **UX improvement** (layout, grouping, copy, components, flow).

## Cross-page notes
[Issues that span multiple pages — e.g. inconsistent styles, naming, or spacing across the audited set. Omit if none.]

## Accessibility notes
- Contrast: ...
- Keyboard: ...
- Text alternatives: ...

## Acceptance checklist
- [ ] ...
```

## Page design output template

```markdown
## Page goal
[User role, task, completion signal]

## Recommended Freedom UI pattern
[Record page / mini page / wizard / dashboard / dialog]

## Layout
- Header: ...
- Left/profile island: ...
- Main content: ...
- Tabs/groups: ...
- Widgets/metrics: ...

## Fields
| Group | Field | Behavior |
|---|---|---|
| Basic information | Name | Required, primary display, auto-filled where possible |

## Actions
| Action | Placement | Style | State/confirmation |
|---|---|---|---|

## Copy rules
[Labels, placeholders, tooltip examples]

## Accessibility and validation
[Contrast, alt text, errors, statuses]

## Acceptance checklist
- [ ] ...
```

## Severity model

- **High**: The issue can prevent task completion, make required information inaccessible, create a WCAG failure, trigger an irreversible action without protection, or cause serious misunderstanding of record state.
- **Medium**: The issue slows users, creates ambiguity, adds unnecessary scrolling, causes inconsistent behavior, weakens validation, or makes the page hard to scan.
- **Low**: The issue is mostly visual polish, copy refinement, minor spacing, icon consistency, or optional improvement.

## Common recommendation snippets

- “Move this action into the actions menu because it is rare and competes with the primary action.”
- “Use a mini page for creation because the user only needs the required starter fields; move later-process fields to the record page.”
- “Split the header into a concise title/status area and move secondary fields into tab groups.”
- “Replace this status field with DCM/progress bar to show ordered process state.”
- “Add a tooltip explaining the source and editability of this read-only field.”
- “Use dropdown instead of lookup because the value set is small.”
- “Do not rely on color alone; add label/icon/status text.”
- “Validate this custom tab/background pair against 4.5:1 contrast before release.”

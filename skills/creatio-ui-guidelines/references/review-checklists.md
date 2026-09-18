# Review checklists and output templates

Use this reference for audits, acceptance criteria, and final checks. It is the fast operating index — each item is one line and points to the section that owns the rule (`→ page-layout: …` = `page-layout-and-controls.md`; `→ accessibility: …` = `accessibility-and-colors.md`). Open that section when you need the full rule; do not re-derive it here.

Run the **Critical gate first**. If any gate item fails, the page is not shippable — fix it or raise it explicitly before anything else. Then run the grouped checklist for the rest.

## Critical gate — never ship if any of these fails

- [ ] **Rendered page reviewed, not just the schema** — you opened the actual page and walked the user's fill scenario before reconciling with metadata. (See *Audit the rendered page, not the schema* below.)
- [ ] **Page created from the template its composition needs** — a staged/DCM record uses the progress-bar template (decided before `create-page`, not a bar hand-placed into a default form page). → page-layout: Choosing the page template
- [ ] **Few-value lookups are dropdowns, not selection windows** — small enum-like catalogs (status/type/category/stage/priority) are `simple-lookup: true`. → page-layout: Fields
- [ ] **Composites are built in full** — every part a `composite='<caption>'` recipe names is built, not only the part you recognized. → page-layout: Choosing the component
- [ ] **Related lists use the "Expanded list" composite and have a working add** — never a hand-built substitute, never an add button wired to an unregistered page. → page-layout: Grouping and page flow
- [ ] **Content sits in real white card islands** — no fields/widgets dropped into bare, chrome-less containers on the page background. → page-layout: New island / card container
- [ ] **No empty layout gaps** — within each container `layoutConfig.row` runs 1..N with no skips and every `column`/`colSpan` is within the container's own column count. → page-layout: Layout coordinates and container nesting
- [ ] **Left and right columns are balanced** — the left/profile column is filled to at least the end of the content, not a couple of fields beside a long content area. → page-layout: Page composition
- [ ] **Field-driven companions are present where required** — amount → analytics on its value; deadline → a timer; business-relationship Contact/Account → a read-only profile island. → page-layout: Field-driven companions
- [ ] **Contrast passes** — standard/small text ≥ 4.5:1, large text ≥ 3:1. → accessibility: Contrast rules
- [ ] **Accessible names are filled** — every accessible name / `Title` (icon-only included) has a real, meaningful value, never empty or a default. → accessibility: WCAG principles to apply
- [ ] **Destructive or irreversible actions are protected** — confirm, undo, or cancel before execution. → page-layout: Long-running and destructive actions
- [ ] **No silent custom CSS and no global restyle** — native inputs first; custom CSS only after a one-line upgrade-risk warning and confirmation; components keep the base Creatio appearance. → page-layout: Typography

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
- [ ] The page follows an analogous Creatio/Freedom UI pattern where one exists. → page-layout: General product fit
- [ ] Custom functionality does not visually conflict with base Creatio styling. → page-layout: General product fit
- [ ] The interface can be understood by a new user without project-team explanation.

### Navigation and object setup

- [ ] Section has a unique icon that works in collapsed navigation.
- [ ] Icon style matches Freedom UI: filled, rounded, `#0D2E4E`, SVG where possible.
- [ ] Primary display column exists, is text, required, auto-filled, and ideally unique.
- [ ] Primary display value is useful in page title, lookup, register, and record links.

### Layout and structure

- [ ] Ready templates are reused where possible. → page-layout: Page composition
- [ ] The page was created from the template its composition needs (resolved via `list-page-templates`) — a staged/DCM record uses the progress-bar template, not the default form page with a bar hand-placed into it. → page-layout: Choosing the page template
- [ ] Header is not overloaded. → page-layout: Page composition
- [ ] Important fields fit in the header/profile area. → page-layout: Page composition
- [ ] Long pages are split into tabs, groups, islands, or wizard steps; tabs/key navigation are not pushed far below the fold. → page-layout: Page composition
- [ ] Field groups have clear names and no unnecessary one-field duplicate-title groups. → page-layout: Grouping and page flow
- [ ] No container (group / tab / profile island) holds a single lone data-entry field, and thin 1–2-field groups are avoided; each holds a logically related block (≥3–4 fields as a rule of thumb) — merge or fill stubs rather than scatter tiny groups. → page-layout: Grouping and page flow
- [ ] Fields are grouped by business meaning; related fields are adjacent. → page-layout: Grouping and page flow
- [ ] The main-information block (profile island + general tab) carries the record's core descriptive attributes (who/what/when/status), not just Name. → page-layout: Grouping and page flow
- [ ] Every related (1:M child) business object surfaced as a `Related list <name>` in §6 of the plan is present as a related list on the parent record page (not omitted for "simple" apps); lookups are NOT related lists. → page-layout: Grouping and page flow
- [ ] Each related list has a **working** add affordance. Default: a quick-add **mini page** wired to "+ Add" plus the full record page for editing; **inline / editable-grid add** only for simple line-item lists or when explicitly requested. For a section-less child the add/edit pages are registered so "+ Add" resolves. No related list is read-only, and no add button is wired to an unregistered page. → page-layout: Grouping and page flow
- [ ] **Every related list uses the "Expanded list" composite as its required skeleton.** Resolve the current assembly with `get-component-info composite='Expanded list'` and the data binding and action requirements with `get-guidance name=related-list`; verify the resulting list against both contracts, including working toolbar actions and data wiring. An **inline / editable-grid list uses the same composite**, with inline editing configured on its DataGrid according to the current `get-component-info` contract and related-list guidance; it is not a separate composite or a hand-built substitute. Apply the inline-add scope from the preceding item. → page-layout: Grouping and page flow
- [ ] The Expanded list host follows the current component defaults resolved through `get-component-info`, including its `fullWidthHeader` setting; do not copy defaults from an older recipe. Override the header layout only when a specific page composition requires it, and verify that the title and toolbar fit the rendered panel. → page-layout: Grouping and page flow
- [ ] Required/frequently edited fields are on the first tab and visible without long scrolling. → page-layout: Adding and editing data
- [ ] Empty space is not created by an oversized side island with too little content. → page-layout: Page composition
- [ ] Left/profile column is filled — for objects with many columns a second left island (same settings) is added so the left side isn't near-empty; the left column is proportional in length to the right (filled to at least the end of the content), not a couple of fields beside a long content area. → page-layout: Page composition
- [ ] Page content actually reads as proper **islands (white cards with rounded corners and padding)**, not fields/widgets dropped into bare structural containers. Every group of fields, every profile/metric block, and every related list sits inside a real card island (or an `ExpansionPanel` styled to match) — a transparent/chrome-less container holding content directly on the page background is a defect. Judge this on the RENDERED page, not the schema: a group that looks like loose fields on grey with no card edge fails even if the schema "has containers". → page-layout: New island / card container
- [ ] New islands use the standard settings (white color, column spacing Large, row spacing None, border radius Medium, padding T/B Medium · L/R Large); plain inner input grids use transparent color, column spacing Large, row spacing None, border radius None, padding None — not designer defaults. → page-layout: New island / card container
- [ ] One-column/two-column mixes do not break reading flow. → page-layout: Page composition
- [ ] Container column count was checked first (not assumed 12); `column`/`colSpan` are within that count (two-column = column 1 + column N/2+1, each colSpan N/2). → page-layout: Layout coordinates and container nesting
- [ ] No empty layout gaps: within each container `layoutConfig.row` runs 1..N with no skipped indices, no oversized `rowSpan`, and group containers use `rows: "auto"`. → page-layout: Layout coordinates and container nesting
- [ ] Every field's `parentName` is its intended group container (nesting is correct; coordinates are container-local, not global). → page-layout: Layout coordinates and container nesting
- [ ] ExpansionPanels are full width and stacked vertically — none placed side by side, in two columns, or with a partial `colSpan`. → page-layout: Grouping and page flow
- [ ] Read-only details have inline editing turned off on the List (not just the add button hidden), so existing rows can't be edited in place. → page-layout: Grouping and page flow
- [ ] Analytic widgets are at the top (top of profile island or first in the tab; a dedicated Analytics tab if many); the profile island holds only small (XS/S) metrics, with icons, not large charts. → page-layout: Analytics and metric widgets
- [ ] Section (list) page: custom filters in `LeftFilterContainer`/`RightFilterContainer`, extra actions in `ActionButtonsContainer`, analytics/dashboards in the Dashboard component (or `DashboardsTabContainer`) — nothing dropped loose on the page. → page-layout: List (section) page layout
- [ ] **Style parity — verified with tools, not eyeballed.** For EVERY component you added: open a shipped reference page on the same template, run `get-component-info` on that component type, and diff the concrete props against the native one — container `color`/`padding`/`borderRadius`/`gap`, panel `toggleType`, `caption` (never a raw `title`), `labelPosition`, widget size, column count. A screenshot/metadata glance is NOT this check. New/empty page → copy these conventions from a shipped page on the same template. (`toggleType`, `title`-instead-of-`caption`, and island card settings are the props runs most often get wrong here.) → page-layout: Page composition
- [ ] Spacing fits the content: inputs have no row spacing but do have column spacing; widgets/charts/metrics use proportional row + column spacing; gaps between siblings look even. → page-layout: New island / card container
- [ ] Reference context or tools (customer summary, connected accounts) use a closable contextual side panel, not inline in the page body or a blocking modal. → page-layout: Page composition
- [ ] Long-form content pages use a full-width reading column + meta/byline row, not the field grid or side islands. → page-layout: Page composition

### Fields and data entry

- [ ] Fields are ordered in the sequence users fill or read them. → page-layout: Fields
- [ ] Standard record fields use two columns where appropriate. → page-layout: Fields
- [ ] Labels are short, clear, and in Sentence case. → page-layout: Text, labels, and messages
- [ ] Abbreviations, units, codes, and formats are explained in tooltip/placeholder/help. → page-layout: Fields
- [ ] Lookup fields are filtered to relevant values. → page-layout: Fields
- [ ] Small enum-like lookups (status, type, category, ~<20 rows) are simple lookups → render as dropdowns (`simple-lookup: true`); large/related lookups (Contact, Account, parent) use the selection window. → page-layout: Fields
- [ ] Date-only business fields are not rendered with a time picker. → page-layout: Default Freedom UI behaviors
- [ ] Read-only fields explain why/how/when they are filled (tooltip) and show units/scale (placeholder). → page-layout: Fields
- [ ] Non-obvious fields have a placeholder (example/format hint) and/or a tooltip (meaning, units, allowed values); the form is not a wall of bare inputs. → page-layout: Fields
- [ ] Tooltip/placeholder text is authored as localizable resource strings, not inline literals. → page-layout: Fields
- [ ] Inputs in a group/panel use a consistent `labelPosition` — prefer an explicit value (`above`/`left`); `"auto"` is acceptable when it already renders consistently (do not restyle a component's appearance just to force an explicit position). → page-layout: Fields
- [ ] Required fields are marked. → page-layout: Fields
- [ ] Only the real minimum is required — fields are mandatory only when the record cannot be created without them; the rest stay optional. → page-layout: Fields
- [ ] Default values, validation, and auto-substitution are configured where helpful. → page-layout: Adding and editing data
- [ ] Checkboxes/logical fields are placed after related fields. → page-layout: Fields
- [ ] Status/stage/order uses DCM/progress bar where appropriate. → page-layout: Fields
- [ ] Field guidance uses the right channel — placeholder (format) / tooltip (on-demand) / permanent description line (must-see) — not all three at once. → page-layout: Fields
- [ ] Empty optional fields show an actionable "Add …" placeholder, not a blank. → page-layout: Fields
- [ ] Toggles are used for settings/modes, checkboxes for plain record booleans. → page-layout: Button vs menu action vs checkbox
- [ ] Meaningful 2–3-way choices use selectable cards (icon + title + one-line consequence); ordinary value picks stay dropdowns. → page-layout: Button vs menu action vs checkbox
- [ ] Sliders are used for by-feel bounded numerics; values that must be exact keep a numeric input. → page-layout: Fields
- [ ] The primary display name is auto-composed from key fields where derivable, and kept editable. → page-layout: Fields
- [ ] Every money/quantity field the user reasons about (typed or calculated — amount, total, price, hours, …) has useful analytics on its value nearby — rollup, comparison, or trend as an XS/S island metric or an Analytics-tab chart — not a bare number and not a widget repeating the field. (A bare line-item quantity the user does not reason about — e.g. a qty on a mini page — is out of scope.) → page-layout: Field-driven companions
- [ ] Every deadline/due-date/SLA field has a timer beside it showing time left/overdue, in the same block, with the date itself still visible (not hidden or replaced by the timer; a read-only/calculated SLA date is fine) — or, where the target version's catalog has no timer component, the closest native alternative was offered instead of a hand-built process-maintained countdown. → page-layout: Field-driven companions
- [ ] Every business-relationship Contact/Account lookup (responsible, primary contact, customer, supplier, owner — someone the user needs to reach) has a read-only related-record profile island — identity plus communication options, captioned for the relationship, visible only when the lookup is filled; multiple profiles stack vertically. Pure audit lookups (Created by / Modified by) are out of scope. → page-layout: Field-driven companions

### Buttons, actions, and dialogs

- [ ] Page-level buttons are in the upper-right area. → page-layout: Buttons and actions
- [ ] General/page-level actions are in `ActionButtonsContainer`; context-specific actions (fill/compute a field) sit next to the component that shows the result. → page-layout: Buttons and actions
- [ ] Buttons are inside a `crt.FlexContainer` (not dropped on a grid); a button next to an input shares one flex with that input. → page-layout: Buttons and actions
- [ ] There is no more than one Primary button per context. → page-layout: Buttons and actions
- [ ] Rare actions are moved into a menu. → page-layout: Buttons and actions
- [ ] Buttons, menu items, and multiple filters have fitting, distinct icons where they aid recognition (consistent icon style), not a row of identical/icon-less items. → page-layout: Buttons and actions
- [ ] Buttons have consistent height and alignment. → page-layout: Buttons and actions
- [ ] Buttons are visible/active only when applicable. → page-layout: Buttons and actions
- [ ] Destructive or irreversible actions require confirmation, undo, or cancellation. → page-layout: Long-running and destructive actions
- [ ] Long-running actions show warning and progress/status. → page-layout: Long-running and destructive actions
- [ ] Operations over 30 seconds or unknown duration are asynchronous with notification. → page-layout: Long-running and destructive actions
- [ ] Dialogs follow Creatio/mini-page styling and place instructions before controls. → page-layout: Dialogs and modals
- [ ] Dialog button labels are consistent and result-oriented. → page-layout: Dialogs and modals
- [ ] Modal/dialog field labels use `labelPosition: "above"` (a `left` side position is acceptable only on a wide L/XL modal, never on S/M). → page-layout: Dialogs and modals
- [ ] Text-heavy dialogs are structured, not a wall of text — real heading levels (not faked bold), consistent fonts, blocks separated by spacing, nothing crammed against the right margin. → page-layout: Dialogs and modals
- [ ] Long or conditional explanations are moved into an `i` tooltip next to the control (with an instruction link where relevant), not kept inline. → page-layout: Dialogs and modals
- [ ] Record-level actions acting on a profile/summary island's record sit in that island's footer (flex), not the page header. → page-layout: Buttons and actions
- [ ] Primary actions with close variants use a split button; it still counts as the single primary per context. → page-layout: Buttons and actions
- [ ] Report printing uses the dedicated Print button (auto-builds its reports menu), not a custom button/menu. → page-layout: Buttons and actions
- [ ] A semantic-green primary is used only for launch/activate actions, with the meaning in the label; no ad-hoc button colors. → page-layout: Buttons and actions
- [ ] An operation needing a focused set of parameters gathers them in a modal (only the needed fields, required marked, instructions above) — not a full page. → page-layout: Dialogs and modals

### Copy and content

- [ ] Labels and headings use Sentence case, not Title Case/all caps. → page-layout: Text, labels, and messages
- [ ] Button labels are short and describe the result. → page-layout: Text, labels, and messages
- [ ] Error messages explain what the user can do next. → page-layout: Text, labels, and messages
- [ ] Admin technical details are not exposed to regular users unless necessary. → page-layout: Text, labels, and messages
- [ ] User-facing text is in one language or intentionally localized. → accessibility: Localization, links & status
- [ ] Non-obvious sections/tabs have a one-line localizable intro under the heading (skipped where self-explanatory). → page-layout: Text, labels, and messages

### Typography and visual style

- [ ] Montserrat and predefined Freedom UI typography are used. → page-layout: Typography
- [ ] Font sizes/styles are minimized and based on Headline 1-4, Body, Caption. → page-layout: Typography
- [ ] Colors are minimized and based on predefined palette. → page-layout: Typography
- [ ] Color is not the only indication of status or meaning. → accessibility: Freedom UI color guidance
- [ ] Status colors follow one semantic scale (green = on-track/ready/done, amber = draft/paused, red = stopped/overdue/lost, gray = inactive); same state = same color everywhere, always paired with a text label and adequate contrast. → accessibility: Freedom UI color guidance
- [ ] Custom global styles/themes have a clear business reason. → page-layout: Typography
- [ ] Components keep the default Creatio appearance — no global restyle (e.g. `crt.Input` switched to `appearance: "outline"`, custom borders/fonts) that makes the form look different from the base product; no restyle done just to satisfy another rule (e.g. label position). → page-layout: Typography

### Accessibility

- [ ] **`references/accessibility-and-colors.md` was actually opened and applied (not skipped, not from memory).** Accessibility is a required dimension of every page/review, not an optional final step — run these checks for every design and audit. → accessibility: WCAG principles to apply
- [ ] Standard/small text contrast is at least 4.5:1. → accessibility: Contrast rules
- [ ] Large text contrast is at least 3:1. → accessibility: Contrast rules
- [ ] Custom tab, Area, chart, glass, and wallpaper combinations are contrast-checked. → accessibility: Contrast rules
- [ ] All interactive elements are reachable and usable by keyboard. → accessibility: WCAG principles to apply
- [ ] Icon-only actions have tooltips/accessibility names. → accessibility: Images, icons, and non-text content
- [ ] Informative images have alt text; decorative images are ignored by screen readers. → accessibility: Images, icons, and non-text content
- [ ] Charts/diagrams have text alternative or data table where needed. → accessibility: Images, icons, and non-text content
- [ ] Each component's accessibility parameters (accessible name/`aria-label`, label/caption, tooltip, alt) are present AND filled in — not empty or left at default. → accessibility: WCAG principles to apply
- [ ] Status changes/no-result messages are announced when relevant; key actions (e.g. Save) give a meaningful status message (SC 4.1.3). → accessibility: Localization, links & status
- [ ] Every element has a meaningful `Title` (incl. icon-only / visually-hidden), not "Button 1" (SC 4.1.2). → accessibility: Inputs, forms & validation
- [ ] Input errors are identified with correction hints; required fields marked at entry; critical/irreversible actions have confirm or Undo (SC 3.3.1/3.3.3/3.3.4). → accessibility: Inputs, forms & validation
- [ ] No redundant entry — known/linked values (lookups, defaults, process-step data) are pre-populated, not re-asked (SC 3.3.7). → accessibility: Inputs, forms & validation
- [ ] Interactive targets are ≥24×24 px or spaced apart (container gap ≥8 px) (SC 2.5.8). → accessibility: Element size & appearance
- [ ] The same function is identified consistently across pages — same icon/label/tooltip/position (SC 3.2.4). → accessibility: Element size & appearance
- [ ] `PageTitle` is kept; exactly one H1 per page/modal with logical heading order (SC 2.4.2, 1.3.1). → accessibility: Page structure
- [ ] Shell (`BaseShell`/`MainShell`) is not altered, so bypass/skip-link behavior is preserved; customizations stay in the content area (SC 2.4.1). → accessibility: Page structure
- [ ] Navigation and inline-help placement are consistent across pages (SC 3.2.3, 3.2.6). → accessibility: Page structure
- [ ] Link text is descriptive in context — no bare "Click here" (SC 2.4.4). → accessibility: Localization, links & status
- [ ] All elements are localized to every enabled language; no unintended language mix (SC 3.1.1/3.1.2). → accessibility: Localization, links & status

## What this skill can produce

Depending on the request, deliver one of these forms (use the matching template below where one exists):

- a page structure proposal;
- implementation instructions for a Creatio builder/developer agent;
- a UI/UX audit with issues, severity, and fix recommendations;
- an accessibility / WCAG review;
- a copy / label / error-text rewrite;
- acceptance criteria / a checklist.

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

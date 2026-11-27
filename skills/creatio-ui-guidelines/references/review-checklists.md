# Review checklists and output templates

Use this reference for audits, acceptance criteria, and final checks.

## Quick audit checklist

### Audit the rendered page, not the schema (do this FIRST)

- [ ] The review is based on the **rendered page** (screenshot + live accessibility tree / DOM), not only the schema, metadata, or `layoutConfig`. Open the actual page and look at it.
- [ ] You walked the user's **fill scenario** on the render before reconciling with the schema — not the reverse.
- Why: many defects are **visual-only** and do NOT appear in the schema or the a11y tree — empty/short or unbalanced left island, group headings that don't actually render, placeholder quality (e.g. junk like "Phone 123"), spacing/proportion problems. "Looks fine in the schema" is not evidence the page is fine.
- [ ] No finding was silently dropped because it looked "intentional" or "temporary" (e.g. a placeholder added for a demo) — flag it explicitly instead of omitting it.
- [ ] The rendered page was measured against a native page on the same template, not only looked at: style census, zoomed crops, overflow, and (where the components are comparable) a difference overlay, per `visual-check.md`; what was not run is named in the report.

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
- [ ] The page was created from the template its composition needs (resolved via `list-page-templates`) — a staged/DCM record uses the progress-bar template, not the default form page with a bar hand-placed into it.
- [ ] Header is not overloaded.
- [ ] Important fields fit in the header/profile area.
- [ ] Long pages are split into tabs, groups, islands, or wizard steps; tabs/key navigation are not pushed far below the fold.
- [ ] Field groups have clear names and no unnecessary one-field duplicate-title groups.
- [ ] No container (group / tab / profile island) holds a single lone data-entry field, and thin 1–2-field groups are avoided; each holds a logically related block (≥3–4 fields as a rule of thumb) — merge or fill stubs rather than scatter tiny groups.
- [ ] Fields are grouped by business meaning; related fields are adjacent.
- [ ] The main-information block (profile island + general tab) carries the record's core descriptive attributes (who/what/when/status), not just Name.
- [ ] Every related (1:M child) business object surfaced as a `Related list <name>` in §6 of the plan is present as a related list on the parent record page (not omitted for "simple" apps); lookups are NOT related lists.
- [ ] Each related list has a **working** add affordance, in two layers by default: **inline adding and editing** on (`features.editable` with `enable: true` and `itemsCreation: true` set explicitly on its `crt.DataGrid`) **and** a quick-add **mini page** wired to "+ Add" plus a full page for editing (or a mini page alone when it holds the whole record). Only a tiny list (a few short columns) skips the pages; inline is off only when the user named that restriction. For a section-less child the add/edit pages are registered so "+ Add" resolves. No related list is read-only by accident, and no add button is wired to an unregistered page.
- [ ] **Every related list uses the "Expanded list" composite as its required skeleton.** Resolve the current assembly with `get-component-info composite='Expanded list'` and the data binding and action requirements with `get-guidance name=related-list`; verify the resulting list against both contracts, including working toolbar actions and data wiring. Inline adding and editing is configured on the composite's own DataGrid according to the current `get-component-info` contract and related-list guidance — not a separate composite or a hand-built substitute. Apply the add/edit layers from the preceding item.
- [ ] The Expanded list host follows the current component defaults resolved through `get-component-info`, including its `fullWidthHeader` setting; do not copy defaults from an older recipe. Override the header layout only when a specific page composition requires it, and verify that the title and toolbar fit the rendered panel.
- [ ] Required/frequently edited fields are on the first tab and visible without long scrolling.
- [ ] Empty space is not created by an oversized side island with too little content.
- [ ] Left/profile column is filled — for objects with many columns a second left island (same settings) is added so the left side isn't near-empty; the left column is proportional in length to the right (filled to at least the end of the content), not a couple of fields beside a long content area.
- [ ] Page content actually reads as proper **islands (white cards with rounded corners and padding)**, not fields/widgets dropped into bare structural containers. Every group of fields, every profile/metric block, and every related list sits inside a real card island (or an `ExpansionPanel` styled to match) — a transparent/chrome-less container holding content directly on the page background is a defect. Judge this on the RENDERED page, not the schema: a group that looks like loose fields on grey with no card edge fails even if the schema "has containers".
- [ ] New islands use the standard settings (white color, column spacing Large, row spacing None, border radius Medium, padding T/B Medium · L/R Large); plain inner input grids use transparent color, column spacing Large, row spacing None, border radius None, padding None — not designer defaults.
- [ ] Step-by-step page follows *Step-by-step page (stepper)* in `./page-layout-and-controls.md`: the indicator and the stepper sit in separate islands, the indicator on top, unless the user asked for another placement; one indicator and one set of navigation buttons serve every step; each step header says what to do on the step and keeps the Designer typography.
- [ ] One-column/two-column mixes do not break reading flow.
- [ ] Container column count was checked first (not assumed 12); `column`/`colSpan` are within that count (two-column = column 1 + column N/2+1, each colSpan N/2).
- [ ] No empty layout gaps: within each container `layoutConfig.row` runs 1..N with no skipped indices, no oversized `rowSpan`, and group containers use `rows: "auto"`.
- [ ] Every field's `parentName` is its intended group container (nesting is correct; coordinates are container-local, not global).
- [ ] Every insert's `index` counts the parent's existing children, the parent template's included, as the parent's node in the `get-page` bundle shows them; in a grid container the order in `items` follows `layoutConfig` row, then column.
- [ ] ExpansionPanels are full width and stacked vertically — none placed side by side, in two columns, or with a partial `colSpan`.
- [ ] Read-only details take all three steps: the add button hidden, inline editing turned off on the List (so existing rows can't be edited in place), and the row Copy and Delete actions absent — while records still open from the list on click. On a `crt.DataGrid` that means `rowToolbarItems` holds only Open (one `crt.MenuItem` with a localized caption and icon `edit-row-action`, firing `crt.UpdateRecordRequest`), not `[]` and not `features.rows.toolbar: false`, both of which drop Open too.
- [ ] Analytic widgets are at the top (top of the profile column, or first in the tab that holds their data); the profile column holds only compact metrics with icons, in their own island — not mixed into an island of fields — and no large charts.
- [ ] Charts sit beside the data they sum up; a dedicated Analytics tab exists only for analytics spanning several areas and holds enough compact charts to fill a screen. Chart rows follow clio's `dashboard-and-home-page-layout`: at most two ordinary or three compact charts per row, one height per row, a long trend last at full width — several charts visible without scrolling, not two half-screen ones.
- [ ] Every chart answers a question named in the plan; a comparison chart shows every series it names, each with data on the rendered page; chart type fits the data (shares → doughnut, categories → bars, time → line).
- [ ] A metric that signals a problem (overdue, failed, over the limit) uses the negative or attention color from clio's `widget-color-and-icon`; neutral metrics stay neutral; no banned low-contrast colors; the meaning is in the title too.
- [ ] A timer, badge or button placed among fields aligns with them on both axes: its left edge with the field values, its text on the same line as the fields of its row — measured on the rendered page, not pushed up against the field above.
- [ ] Every list (section list and each related list) fits its data: nothing cut by an ellipsis on the demo data (money shows the full amount), the columns fill the list's width with no empty right part, short values in narrow columns, height following the rows.
- [ ] Section (list) page: custom filters in the filter row (`LeftFilterContainerInner`) before `SearchFilter` — nothing after the search, no filters in `RightFilterContainer`; extra actions in `ActionButtonsContainer`, analytics/dashboards in the Dashboard component (or `DashboardsTabContainer`) — nothing dropped loose on the page.
- [ ] **Style parity — verified with tools, not eyeballed.** For EVERY component you added: open a shipped reference page on the same template, run `get-component-info` on that component type, and diff the concrete props against the native one — container `color`/`padding`/`borderRadius`/`gap`, panel `toggleType`, `caption` (never a raw `title`), `labelPosition`, widget size, column count. A screenshot/metadata glance is NOT this check. New/empty page → copy these conventions from a shipped page on the same template. (`toggleType`, `title`-instead-of-`caption`, and island card settings are the props runs most often get wrong here.)
- [ ] Spacing fits the content: inputs have no row spacing but do have column spacing; widgets/charts/metrics use proportional row + column spacing; gaps between siblings look even.
- [ ] Reference context or tools (customer summary, connected accounts) use a closable contextual side panel, not inline in the page body or a blocking modal.
- [ ] Long-form content pages use a full-width reading column + meta/byline row, not the field grid or side islands.

### Fields and data entry

- [ ] Fields are ordered in the sequence users fill or read them.
- [ ] Standard record fields use two columns where appropriate.
- [ ] Labels are short, clear, and in Sentence case.
- [ ] Abbreviations, units, codes, and formats are explained in tooltip/placeholder/help.
- [ ] Lookup fields are filtered to relevant values.
- [ ] The record's connections are one `crt.Connections` element, not a separate `crt.ComboBox` per connection, and no column is shown by both.
- [ ] Small enum-like lookups (status, type, category, ~<20 rows) are simple lookups → render as dropdowns (`simple-lookup: true`); large/related lookups (Contact, Account, parent) use the selection window.
- [ ] Status-like lookups (status, stage, priority, health, risk, result) show colored chips on the record page and in lists — colors by meaning (good green, attention amber, problem red, draft neutral), one meaning per color across the app, never by palette order, text kept in the chip; set up per clio's `lookup-colors`; lookups without a state stay plain.
- [ ] Checkbox captions name the state (*Critical project*, *Overdue*), not a code-style question (*Is critical*); tab captions name their content, no *Details*, *Other* or *Money*.
- [ ] Date-only business fields are not rendered with a time picker.
- [ ] Read-only fields explain why/how/when they are filled (tooltip) and show units/scale (placeholder).
- [ ] Non-obvious fields have a placeholder (example/format hint) and/or a tooltip (meaning, units, allowed values); the form is not a wall of bare inputs.
- [ ] Tooltip/placeholder text is authored as localizable resource strings, not inline literals.
- [ ] Inputs in a group/panel use a consistent `labelPosition` — prefer an explicit value (`above`/`left`); `"auto"` is acceptable when it already renders consistently (do not restyle a component's appearance just to force an explicit position).
- [ ] Required fields are marked and sit on the first screen (header or top island, left profile column, first tab), not on a second or later tab — or the plan names why one lives elsewhere.
- [ ] Only the real minimum is required — fields are mandatory only when the record cannot be created without them; the rest stay optional.
- [ ] Default values, validation, and auto-substitution are configured where helpful.
- [ ] Checkboxes/logical fields are placed after related fields.
- [ ] Status/stage/order uses DCM/progress bar where appropriate.
- [ ] Field guidance uses the right channel — placeholder (format) / tooltip (on-demand) / permanent description line (must-see) — not all three at once.
- [ ] Empty optional fields show an actionable "Add …" placeholder, not a blank.
- [ ] Toggles are used for settings/modes, checkboxes for plain record booleans.
- [ ] Meaningful 2–3-way choices use selectable cards (icon + title + one-line consequence); ordinary value picks stay dropdowns.
- [ ] Sliders are used for by-feel bounded numerics; values that must be exact keep a numeric input.
- [ ] The primary display name is auto-composed from key fields where derivable, and kept editable.
- [ ] Every money/quantity field has analytics where the page asks a question about it — total against the limit, paid against remaining, plan against actual, a rollup across related records — as a compact metric in its own profile-column island or a chart on the tab that holds the data, and the plan names that question. A page that asks no question about the amount (e.g. a line amount on an add mini page) keeps the field alone; a widget repeating the field's own value is never analytics.
- [ ] Every deadline/due-date/SLA field the user acts on within the page's working horizon (not a far planned end months away) has a timer beside it showing time left/overdue — with a visible caption, `positiveTextColor` green, `negativeTextColor` red and an *Overdue* text set explicitly — in the same block, with the date itself still visible (not hidden or replaced by the timer; a read-only/calculated SLA date is fine) — or, where the target version's catalog has no timer component, the closest native alternative was offered instead of a hand-built process-maintained countdown.
- [ ] Every business-relationship Contact/Account lookup (responsible, primary contact, customer, supplier, owner — someone the user needs to reach) has a read-only related-record profile island — identity plus communication options, captioned for the relationship, visible only when the lookup is filled; multiple profiles stack vertically. Pure audit lookups (Created by / Modified by) are out of scope.

### Buttons, actions, and dialogs

- [ ] Page-level buttons are in the upper-right area.
- [ ] General/page-level actions are in `ActionButtonsContainer`; context-specific actions (fill/compute a field) sit next to the component that shows the result.
- [ ] Buttons are inside a `crt.FlexContainer` (not dropped on a grid); a button next to an input shares one flex with that input.
- [ ] There is no more than one Primary button per context.
- [ ] The header keeps at most two frequent actions as buttons, judged from the business scenario; occasional ones are under one actions menu; three or more header buttons have a reason in the plan.
- [ ] A mini page is captioned with its object (not *New record*), carries the fields that define the record, suggests no duplicate number or code, and uses two columns only for short paired fields (long text full width).
- [ ] Buttons, menu items, and multiple filters have fitting, distinct icons where they aid recognition (consistent icon style), not a row of identical/icon-less items.
- [ ] Buttons have consistent height and alignment.
- [ ] Buttons are visible/active only when applicable.
- [ ] Destructive or irreversible actions require confirmation, undo, or cancellation.
- [ ] Long-running actions show warning and progress/status.
- [ ] Operations over 30 seconds or unknown duration are asynchronous with notification.
- [ ] Dialogs follow Creatio/mini-page styling and place instructions before controls.
- [ ] Dialog button labels are consistent and result-oriented.
- [ ] Every field on a mini page or modal sets `labelPosition` explicitly (the default `auto` can put the label beside the input): `above` on S/M, `left` allowed only on a wide L/XL page and then on every field of the dialog; the component's default appearance kept.
- [ ] Text-heavy dialogs are structured, not a wall of text — real heading levels (not faked bold), consistent fonts, blocks separated by spacing, nothing crammed against the right margin.
- [ ] Long or conditional explanations are moved into an `i` tooltip next to the control (with an instruction link where relevant), not kept inline.
- [ ] Record-level actions acting on a profile/summary island's record sit in that island's footer (flex), not the page header.
- [ ] Primary actions with close variants use a split button; it still counts as the single primary per context.
- [ ] Report printing uses the dedicated Print button (auto-builds its reports menu), not a custom button/menu.
- [ ] A semantic-green primary is used only for launch/activate actions, with the meaning in the label; no ad-hoc button colors.
- [ ] An operation needing a focused set of parameters gathers them in a modal (only the needed fields, required marked, instructions above) — not a full page.

### Copy and content

- [ ] Labels and headings use Sentence case, not Title Case/all caps.
- [ ] Button labels are short and describe the result.
- [ ] Error messages explain what the user can do next.
- [ ] Admin technical details are not exposed to regular users unless necessary.
- [ ] User-facing text is in one language or intentionally localized.
- [ ] Non-obvious sections/tabs have a one-line localizable intro under the heading (skipped where self-explanatory).

### Typography and visual style

- [ ] Montserrat and predefined Freedom UI typography are used.
- [ ] Font sizes/styles are minimized and based on Headline 1-4, Body, Caption.
- [ ] Colors are minimized and based on predefined palette.
- [ ] Color is not the only indication of status or meaning.
- [ ] Status colors follow one semantic scale (green = on-track/ready/done, amber = draft/paused, red = stopped/overdue/lost, gray = inactive); same state = same color everywhere, always paired with a text label and adequate contrast.
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
- [ ] Status changes/no-result messages are announced when relevant; key actions (e.g. Save) give a meaningful status message (SC 4.1.3).
- [ ] Every element has a meaningful `Title` (incl. icon-only / visually-hidden), not "Button 1" (SC 4.1.2).
- [ ] Input errors are identified with correction hints; required fields marked at entry; critical/irreversible actions have confirm or Undo (SC 3.3.1/3.3.3/3.3.4).
- [ ] No redundant entry — known/linked values (lookups, defaults, process-step data) are pre-populated, not re-asked (SC 3.3.7).
- [ ] Interactive targets are ≥24×24 px or spaced apart (container gap ≥8 px) (SC 2.5.8).
- [ ] The same function is identified consistently across pages — same icon/label/tooltip/position (SC 3.2.4).
- [ ] `PageTitle` is kept; exactly one H1 per page/modal with logical heading order (SC 2.4.2, 1.3.1).
- [ ] Shell (`BaseShell`/`MainShell`) is not altered, so bypass/skip-link behavior is preserved; customizations stay in the content area (SC 2.4.1).
- [ ] Navigation and inline-help placement are consistent across pages (SC 3.2.3, 3.2.6).
- [ ] Link text is descriptive in context — no bare "Click here" (SC 2.4.4).
- [ ] All elements are localized to every enabled language; no unintended language mix (SC 3.1.1/3.1.2).

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

## Citing the source of a finding

The **Category** column of the audit table stays **Accessibility** or **UX improvement**. Each finding also names where its rule comes from, in parentheses at the end of the Issue cell, so a reader can check it without trusting the auditor:

- **a Nielsen heuristic** — H1 visibility of system status · H2 match between the system and the real world · H3 user control and freedom · H4 consistency and standards · H5 error prevention · H6 recognition rather than recall · H7 flexibility and efficiency of use · H8 aesthetic and minimalist design · H9 help users recognize, diagnose and recover from errors · H10 help and documentation;
- **a WCAG success criterion** — by number, e.g. `SC 1.4.3`, `SC 2.5.8` (see `accessibility-and-colors.md`);
- **a rule of this skill** — by its title, e.g. `rule: Few-value lookups MUST be dropdowns` or `visual-check: style census`.

Example: `| Medium | UX improvement | Lookups | Status opens a selection window for six values (H7; rule: Few-value lookups MUST be dropdowns) | Set simple-lookup on the column |`. A finding that cannot name any source is an opinion: keep it only if you can say which user task it slows, and mark it as such.

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

## Self-critique before delivering

Answer these twelve questions **in writing** before anyone else sees the page — "yes, probably" is how a weak page survives. Look at the rendered page, not the schema.

1. **Is the most important information immediately recognisable?** Squint at the page: is what survives the answer to the page's question?
2. **Is the space used deliberately?** No region is stretched to fill or left holed; you can say what each region is for. On a record page the left and right columns stay balanced (*Default page design principles* in `SKILL.md`): an empty stretch of the left column is not a deliberate region.
3. **Is the density right for the task?** Scanned (a list) → dense; read (a record) → comfortable; filled in (a mini page, a step) → generous.
4. **Does the layout follow the user's priorities, or the data model's?** Would the person who uses this page recognise their own order of importance?
5. **Is any block too large or too small** for how much it matters?
6. **Are related things grouped by the native containers** — islands, field groups, expansion panels — rather than by extra borders or colour?
7. **Is the primary action unmistakable**, with only one competing for that role in its context?
8. **Is the hierarchy strong without being noisy?** Could you promote one thing by demoting others instead of adding emphasis?
9. **Is colour used consistently and semantically**, on data and status rather than on chrome?
10. **Are the labels and messages specific?** Any *Submit*, *Manage*, *Process*, *OK*, *An error occurred*?
11. **Does it support the real workflow at real data volume** — thousands of rows in a list, long names, empty optional fields — not a dozen clean demo records?
12. **Does it look deliberate rather than assembled?** Could you explain why each block is the size it is and sits where it does?

**If two or more answers are weak, revise before delivering** — not note them for later. A known weakness shipped is a decision to ship it; if you keep one, name it in the report under *What was not verified* or as an open item.

## Quality rubric

Use the rubric to find **which** dimension is weak, not to produce a total. Score each dimension 1–5 quickly, then write **one line for every dimension scoring 3 or below**, saying what specifically is wrong. That list is the revision plan; a score with no line attached is not a finding.

| Dimension | 1 — broken | 3 — acceptable | 5 — excellent |
|---|---|---|---|
| **Purpose** | no discernible question answered | a purpose can be inferred | one question, answered by the most prominent block |
| **Hierarchy** | everything the same weight | a title leads, the rest is flat | one focal point, clear second and third tiers |
| **Composition** | arbitrary placement, holes, orphans, unbalanced columns | consistent grid, uniform spans | spans follow importance within the container's column count; edges line up; columns balanced |
| **Density** | consumer-airy or packed beyond reading | consistent, unexamined | matched to the task and defensible |
| **Grouping** | fragmented into many thin groups, or one undifferentiated wall | groups exist but split related fields | native containers carry the grouping; each group is a logical block |
| **Colour** | decorative, inconsistent, custom | semantic but overused | on data and status only; one role per hue; theme colours only |
| **Typography** | many sizes, custom fonts, weak contrast | the Freedom UI scale, inconsistently used | the Freedom UI scale only; values lead and labels recede |
| **States** | missing empty, error, read-only or loading states | present, not all considered | every state that applies is handled: empty, loading, error, read-only, disabled, no rights |
| **Writing** | *Submit* / *Manage* / "An error occurred" | clear, inconsistent terminology | specific business terms; errors say what to do next |
| **Patterns** | invented shape or hand-built composite | right page kind, mishandled | right page kind and template, native components and composites, known traps avoided |
| **Accessibility** | fails AA visibly | the components' built-in basics only | AA in full, verified by keyboard and zoom |
| **Realism** | demo data, demo volume | plausible data | real volume, totals that add up, empty and error states seen |

## Verdict file

A checklist run that lives only in the chat did not happen. Every audit or acceptance run writes one verdict file. The format comes from design-spec-framework (github.com/denysosadchyi/design-spec-framework, MIT).

**Where it lives:** the task's working directory, never this skill. The skill carries the format; the run carries the verdict.

```md
# <page or app> · review verdict

Checked: <date> · Checklist: creatio-ui-guidelines `review-checklists.md` (<toolkit version>)
Result: **fail** — <n> pass · <n> fail · <n> human · <n> of <n> items

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 33 | Page content reads as proper islands | human | zoom `SideAreaProfileContainer` and the first tab's groups; each must read as a card on the page background |
| 45 | Style parity, verified with tools | pass | `__vcCensus('ours')` → `0 only in ours (+), 0 only in the reference (-)` |
| 55 | Small enum-like lookups are simple lookups | fail | `UsrStatus` column has no `simple-lookup`; the field opens a selection window |

## Open
- 55: set `simple-lookup: true` on the `UsrStatus` entity column, re-open the page
```

| Verdict | Meaning |
|---|---|
| **pass** | verified, with evidence: a `get-page` node and property, a tool's real output, a measured number, a census or overflow line |
| **fail** | verified absent or wrong, with the same kind of evidence |
| **human** | confirmable only by eye on the rendered page — say exactly what to look at |

- **Evidence is a path or an output, not a claim.** "Styles match" is not evidence; the census line is. Paste a tool's real output, never a paraphrase of it.
- **A stub is `fail`, partial is `fail`** — with the remainder named. Never mark an item pass because it is "essentially done".
- **The overall result is `pass` only when every item passes and every `human` item was confirmed by a person in the same session.** A green list is evidence, not permission.
- **Every item gets a row, in checklist order, carrying its ordinal**, the unresolved ones too. The ordinal counts the `- [ ]` lines of *Quick audit checklist* straight through its headings, starting at 1. Ordinals hold for the version of this file the run read, so the header names the toolkit version; compare verdicts by item text across versions.
- **Open** lists one line per failure, each naming what closes it.
- **Finding and fixing stay in separate passes.** Write the verdict file before editing anything. If a failure is trivially fixable, name the fix; apply it in the next pass, because a reviewer who is also repairing stops reading.

## Pixel review format

A pixel review says what came back from a build compared with what was meant — here, the page under review against the native reference (see `visual-check.md`). Use it for visual findings instead of a comment thread.

- **Every finding is a numbered issue with a stable id** — `<PAGE>-01`, `<PAGE>-02` … The ids survive into the next check, so "`<PAGE>-07` is fixed" can be verified.
- **Every issue is a pair of crops, labelled** — *Now — build* beside *Should be — native*, the same region at the same scale (zoomed crops, not a full screenshot with an arrow).
- **Where the defect is a number, the number is in the label** — measured, not estimated: *Now — build (island padding wider than native)* with the two measured values in the label. A two-pixel difference is invisible in a picture and unarguable in a label.
- **Every issue ends in a `Done when:` line** — an observable end state in the product's own vocabulary, naming native components and properties rather than describing appearance: *Done when: the related list sits in the native Expanded list composite and its panel shows the native header row.* For accessibility, cite the criterion: *Done when: Tab reaches every row action and the focused one shows the focus ring (WCAG 2.4.7).*
- **Colour findings name roles and relationships, never hex values** — *"the status chip uses the same role colour as the status in the list"*, *"the custom header background is not a theme colour"*. A relationship stays true after a theme change; a hex does not.
- **Priority lives in the issue** — nice-to-have issues say *optional* so nobody has to ask which matter.
- **A gap in the platform is annotated where it bites** — where no native component or input achieves the look, say so on the issue (*no native input; custom CSS needs confirmation*), following the custom-CSS rule in `SKILL.md`.

Write the `Done when:` line first, for your own decisions too: if you cannot state an observable outcome for a decision, it is not specific enough to build.

## Report a delivered design

When delivering a page design or a built page, state these four things — they are what a reviewer needs and what most handovers omit:

1. **The page's question**, and who it is for.
2. **The layout decision and why** — including the alternative you rejected and the criterion it lost on (e.g. "progress-bar template rejected: the record has no ordered stages").
3. **What you assumed** where you could not ask.
4. **What you did not verify** — "keyboard pass done, not tested with a screen reader; checked at one window width with panels closed" is useful; "accessible" with no method is not.

A design delivered with its reasoning can be argued with productively; one delivered as a finished artefact can only be accepted or rejected.

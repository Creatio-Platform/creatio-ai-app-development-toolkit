# Review checklists and audit output

Use this reference for audits, acceptance criteria and the final check of a built page: the checks, the audit format, the severity model and the verdict file. The rules themselves live where each item points.

## Quick audit checklist

Each item is a yes/no check, then its ID, how it is checked and where its rule lives; an item without a pointer is its own home. A "no" is a finding. IDs are stable: a new item takes the next free number in its section, and a removed ID is not reused.

- **`[tool]`**: decided from the `get-page` bundle, the entity schema or another tool's output.
- **`[render]`**: needs the rendered page: a screenshot, the DOM or accessibility tree, a measurement (`visual-check.md`).
- **`[judgement]`**: needs reasoning about the user's task.

### Audit the rendered page, not the schema

Many defects show only on the render (an under-filled column, a heading that does not render, a junk placeholder), so a clean schema proves nothing.

- [ ] The review rests on the rendered page (screenshot, live DOM or accessibility tree), not only on the schema. **R-01** `[render]` (*Measure, do not eyeball* in `visual-check.md`)
- [ ] The user's fill scenario was walked on the render before the schema was read. **R-02** `[render]`
- [ ] No finding was dropped for looking intentional or temporary, such as a demo placeholder. **R-03** `[judgement]`
- [ ] The render was measured against a native page on the same template, and skipped measurements are named. **R-04** `[render]` (*Choose the native reference* in `visual-check.md`)

### Think like a user

- [ ] Field and section order follows how the user fills the page: required first, dependencies before dependents. **U-01** `[judgement]` (*Sort fields into critical, secondary and contextual* in `design-judgement.md`)
- [ ] What the user needs on most visits is the most prominent: header, profile island, first tab. **U-02** `[judgement]` (*Where information goes* in `design-judgement.md`)
- [ ] Nothing forces recall or avoidable effort: re-typing, hunting for a field, unexplained values. **U-03** `[judgement]`
- [ ] Mistakes are prevented up front (hints, defaults, validation, constrained inputs), not only caught after save. **U-04** `[judgement]` (*4. Errors: prevention, then recovery* in `ux-writing.md`)

### Scenario and consistency

- [ ] The main user role and task are clear, and the page answers one named question. **S-01** `[judgement]` (*State the page's one question* in `design-judgement.md`)
- [ ] The page follows the analogous Creatio pattern where one exists. **S-02** `[judgement]` (*Before you pick a pattern* in `page-patterns.md`)
- [ ] A new user understands the page without explanation from the project team. **S-03** `[judgement]`

### Navigation and object setup

- [ ] The section has a unique icon that stays recognisable in collapsed navigation. **N-01** `[render]`
- [ ] The section icon is filled, rounded, dark blue from the base palette, SVG where possible. **N-02** `[render]` (*Freedom UI color guidance* in `accessibility-and-colors.md`)
- [ ] The primary display column is text, required, unique where possible, and auto-composed from key fields when derivable, still editable. **N-03** `[tool]` (*Special field controls* in `page-layout-and-controls.md`)
- [ ] The primary display value reads well in the page title, lookups, lists and record links. **N-04** `[judgement]`

### Layout and structure

- [ ] The page uses the template its composition needs (`list-page-templates`); ordered stages use the progress-bar template, not a hand-placed bar. **L-01** `[tool]` (*Choosing the page template (before you create the page)* in `page-layout-and-controls.md`)
- [ ] The header is not overloaded with fields or buttons. **L-02** `[render]` (*Island structure* in `page-layout-and-controls.md`)
- [ ] A page longer than about two screens is split into tabs, groups or steps; the tab row starts on the first screen. **L-03** `[render]` (*Island structure* in `page-layout-and-controls.md`)
- [ ] Every field group has a clear name and a logically related block: no lone-field container, no group titled like its only field. **L-04** `[render]` (*Field groups* in `page-layout-and-controls.md`)
- [ ] Fields are grouped by business meaning, related fields side by side. **L-05** `[judgement]` (*Field groups* in `page-layout-and-controls.md`)
- [ ] The profile island and first tab carry the record's who, what, when and status, not just Name. **L-06** `[judgement]` (*Grouping and page flow* in `page-layout-and-controls.md`)
- [ ] Every 1:M child object in the plan is a related list on the parent page; lookups are not related lists. **L-07** `[tool]` (*Related lists* in `page-layout-and-controls.md`)
- [ ] Each related list has inline adding and editing on, and + Add opens a registered page; exceptions are named in the plan. **L-08** `[tool]` (*Related lists* in `page-layout-and-controls.md`)
- [ ] Every related list is the Expanded list composite, matching `get-component-info composite='Expanded list'` and `get-guidance name=related-list`. **L-09** `[tool]` (*Related lists* in `page-layout-and-controls.md`)
- [ ] The Expanded list host keeps the current `get-component-info` defaults (`fullWidthHeader` included); its title and toolbar fit the panel. **L-10** `[render]` (*Related lists* in `page-layout-and-controls.md`)
- [ ] Left and right columns are balanced: no oversized side island with little content, no near-empty left column. **L-11** `[render]` (*Balance the page* in `page-layout-and-controls.md`)
- [ ] Every field group, profile block and related list sits in a card island (white, rounded, padded), never on bare background. **L-12** `[render]` (*New island / card container — standard settings* in `page-layout-and-controls.md`)
- [ ] A stepper page has indicator and stepper in separate islands, indicator on top, one navigation button set, an instruction header per step. **L-13** `[render]` (*Step-by-step page (stepper)* in `page-layout-and-controls.md`)
- [ ] Standard record fields use two columns; one- and two-column mixes keep the reading flow. **L-14** `[render]` (*Field layout and order* in `page-layout-and-controls.md`)
- [ ] Each container's column count was read, not assumed to be 12; every `column` and `colSpan` fits it. **L-15** `[tool]` (*Layout coordinates and container nesting (avoiding gaps)* in `page-layout-and-controls.md`)
- [ ] No layout gaps: no skipped row indices, no oversized `rowSpan`; group containers use `rows: "auto"`. **L-16** `[tool]` (*Layout coordinates and container nesting (avoiding gaps)* in `page-layout-and-controls.md`)
- [ ] Every field's `parentName` is its intended group, with coordinates local to that container. **L-17** `[tool]` (*Layout coordinates and container nesting (avoiding gaps)* in `page-layout-and-controls.md`)
- [ ] Every insert's `index` counts the parent's existing children, the parent template's included, as the parent's node in the `get-page` bundle shows them; in a grid container the order in `items` follows `layoutConfig` row, then column. **L-18** `[tool]` (*Layout coordinates and container nesting (avoiding gaps)* in `page-layout-and-controls.md`)
- [ ] Expansion panels are full width and stacked vertically, never side by side or with a partial `colSpan`. **L-19** `[tool]` (*Flex vs Grid* in `page-layout-and-controls.md`)
- [ ] Read-only details take all three steps: no add button, inline editing off, no row Copy or Delete; records still open on click. `rowToolbarItems` holds only Open (`crt.MenuItem`, localized caption, `edit-row-action`, `crt.UpdateRecordRequest`), never `[]` or `features.rows.toolbar: false`. **L-20** `[tool]` (*Read-only detail* in `page-layout-and-controls.md`)
- [ ] Analytic widgets come first where they sit; the profile column holds only compact metrics with icons, in their own island. **L-21** `[render]` (*Charts and metric tiles* in `page-layout-and-controls.md`)
- [ ] Charts sit beside the data they sum up (an Analytics tab only for cross-area analytics); rows follow `get-guidance name=dashboard-and-home-page-layout`. **L-22** `[render]` (*Charts and metric tiles* in `page-layout-and-controls.md`)
- [ ] Every chart answers a question named in the plan, shows every series it names with data, and fits its data's type. **L-23** `[render]` (*Charts and metric tiles* in `page-layout-and-controls.md`; *Which chart* in `design-judgement.md`)
- [ ] A problem metric (overdue, failed) takes the negative or attention colour from clio's `widget-color-and-icon`; neutral metrics stay neutral. **L-24** `[tool]` (*Charts and metric tiles* in `page-layout-and-controls.md`)
- [ ] A timer, badge or button among fields aligns with them on both axes. **L-25** `[render]` (*Component alignment* in `page-layout-and-controls.md`)
- [ ] Every list fits its demo data: no value cut by an ellipsis, no empty right part, height following the rows. **L-26** `[render]` (*List columns* in `page-layout-and-controls.md`)
- [ ] On a list page, custom filters sit before `SearchFilter` in `LeftFilterContainerInner`, actions in `ActionButtonsContainer`, analytics in the Dashboard component. **L-27** `[tool]` (*Filters and search* in `page-layout-and-controls.md`)
- [ ] **Style parity:** each added component's props (colour, padding, radius, gap, `toggleType`, `caption`, `labelPosition`, columns) match a shipped same-template page, diffed via `get-component-info`. **L-28** `[tool]` (*Match existing styles* in `page-layout-and-controls.md`)
- [ ] Spacing fits the content: inputs have column but no row spacing, widgets proportional spacing, sibling gaps even. **L-29** `[render]` (*New island / card container — standard settings* in `page-layout-and-controls.md`)
- [ ] Reference context (customer summary, connected accounts) opens in a closable contextual side panel, not inline or in a modal. **L-30** `[judgement]` (*Contextual side panel* in `page-layout-and-controls.md`)
- [ ] A long-form content page uses a full-width reading column with a meta row, not the field grid. **L-31** `[render]` (*Article page* in `page-layout-and-controls.md`)

### Fields and data entry

- [ ] Non-obvious fields (abbreviations, units, codes, formats) have a placeholder or tooltip; the form is no wall of bare inputs. **F-01** `[render]` (*Field guidance* in `page-layout-and-controls.md`)
- [ ] Lookup fields are filtered to relevant values. **F-02** `[tool]` (*Lookups and status chips* in `page-layout-and-controls.md`)
- [ ] The record's connections are one `crt.Connections`, not a ComboBox per link, and no column shows in both. **F-03** `[tool]` (*Record connections* in `page-layout-and-controls.md`)
- [ ] Small fixed catalogs (status, type, category) are simple lookups (dropdowns); Contact, Account and parent keep the selection window. **F-04** `[tool]` (*Lookups and status chips* in `page-layout-and-controls.md`)
- [ ] Status-like lookups show chips on the page and in lists, coloured by meaning on one app-wide scale, text kept. **F-05** `[render]` (*Lookups and status chips* in `page-layout-and-controls.md`; scale: *Freedom UI color guidance* in `accessibility-and-colors.md`)
- [ ] Date-only business fields have no time picker. **F-06** `[tool]` (*Special field controls* in `page-layout-and-controls.md`)
- [ ] Read-only fields have a tooltip saying why and how they are filled, and show units or scale. **F-07** `[tool]` (*Field guidance* in `page-layout-and-controls.md`)
- [ ] Inputs in one group share one `labelPosition`, explicit where possible, without restyling components to force it. **F-08** `[tool]` (*Label position* in `page-layout-and-controls.md`)
- [ ] Required fields are marked and on the first screen (header, top island, profile column, first tab), or the plan says why not. **F-09** `[render]` (*Required fields* in `page-layout-and-controls.md`)
- [ ] Only fields the record cannot be created without are required. **F-10** `[judgement]` (*Required fields* in `page-layout-and-controls.md`)
- [ ] Checkboxes and logical fields follow the fields they relate to. **F-11** `[tool]` (*Field layout and order* in `page-layout-and-controls.md`)
- [ ] Each field's guidance uses one fitting channel: placeholder for format, tooltip on demand, description line for must-see. **F-12** `[tool]` (*Field guidance* in `page-layout-and-controls.md`)
- [ ] An optional field that usually stays empty on a saved record shows an actionable "Add …" placeholder. **F-13** `[render]` (*Field guidance* in `page-layout-and-controls.md`)
- [ ] Toggles serve settings and modes; checkboxes serve plain record booleans. **F-14** `[tool]` (*Button vs menu action vs checkbox* in `page-layout-and-controls.md`)
- [ ] A consequential two- or three-way choice uses selectable cards; ordinary value picks stay dropdowns. **F-15** `[judgement]` (*Button vs menu action vs checkbox* in `page-layout-and-controls.md`)
- [ ] A bounded numeric set by feel uses a slider; an exact value keeps a numeric input. **F-16** `[judgement]` (*Special field controls* in `page-layout-and-controls.md`)
- [ ] Every amount the page asks a question about has analytics named in the plan, not a repeat of its own value. **F-17** `[judgement]` (*Field-driven companions* in `page-layout-and-controls.md`)
- [ ] Every deadline acted on within the page's working horizon has a captioned, coloured timer beside it, *Overdue* text set, date visible. **F-18** `[tool]` (*Field-driven companions* in `page-layout-and-controls.md`)
- [ ] Every business-relationship Contact or Account lookup has a read-only profile island, captioned for the relationship, shown when filled. **F-19** `[tool]` (*Field-driven companions* in `page-layout-and-controls.md`)

### Buttons, actions, and dialogs

- [ ] Page-level actions sit in `ActionButtonsContainer` top right; a context action sits beside the component showing its result. **B-01** `[tool]` (*Button placement* in `page-layout-and-controls.md`)
- [ ] Buttons sit in a `crt.FlexContainer`, not on a grid; a button beside an input shares its flex. **B-02** `[tool]` (*Button placement* in `page-layout-and-controls.md`)
- [ ] Each context has at most one Primary button; a split button counts as that one. **B-03** `[tool]` (*Button styles* in `page-layout-and-controls.md`)
- [ ] The header shows at most two frequent actions as buttons, the rest in one actions menu, or the plan says why. **B-04** `[judgement]` (*Header actions* in `page-layout-and-controls.md`)
- [ ] A mini page is captioned with its object, holds the defining fields, suggests no duplicate number, and pairs only short fields. **B-05** `[tool]` (*Mini pages* in `page-layout-and-controls.md`)
- [ ] Buttons, menu items and multiple filters have distinct, consistent icons where icons aid recognition. **B-06** `[render]` (*Icons* in `page-layout-and-controls.md`)
- [ ] Buttons share one height and alignment. **B-07** `[render]` (*Button placement* in `page-layout-and-controls.md`)
- [ ] Buttons are visible or active only when their action applies. **B-08** `[render]` (*Button placement* in `page-layout-and-controls.md`)
- [ ] Destructive or irreversible actions ask for confirmation, offer undo, or can be cancelled (SC 3.3.4). **B-09** `[render]` (*Confirm, undo or neither* in `design-judgement.md`)
- [ ] Long-running actions warn and show progress; over 30 seconds or of unknown duration they run asynchronously and notify. **B-10** `[judgement]` (*Long-running and destructive actions* in `page-layout-and-controls.md`)
- [ ] Dialogs follow Creatio mini-page styling and place instructions before controls. **B-11** `[render]` (*Dialogs and modals* in `page-layout-and-controls.md`)
- [ ] Every field on a mini page or modal sets `labelPosition`: `above` on S/M; `left` only on L/XL, then on every field. **B-12** `[tool]` (*Label position* in `page-layout-and-controls.md`)
- [ ] A text-heavy dialog uses real heading levels, consistent fonts and spaced blocks, not a wall of text. **B-13** `[render]` (*Text-heavy modals* in `page-layout-and-controls.md`)
- [ ] Long or conditional explanations sit in an `i` tooltip next to the control, not inline. **B-14** `[render]` (*Text-heavy modals* in `page-layout-and-controls.md`)
- [ ] Actions on a profile island's record sit in that island below its fields, not in the header. **B-15** `[tool]` (*Button placement* in `page-layout-and-controls.md`)
- [ ] Report printing uses the platform's Print button, not a custom button or menu. **B-16** `[tool]` (*Button styles* in `page-layout-and-controls.md`)
- [ ] A green primary appears only on a launch or activate action, meaning in its label; no ad-hoc button colours. **B-17** `[tool]` (*Button styles* in `page-layout-and-controls.md`)
- [ ] A focused set of operation parameters is gathered in a modal (needed fields, required marked, instructions above), not a page. **B-18** `[judgement]` (*Dialogs and modals* in `page-layout-and-controls.md`)

### Copy and content

- [ ] Labels and headings are short, clear and in Sentence case, not Title Case or all caps. **C-01** `[tool]` (*11. Style basics* in `ux-writing.md`)
- [ ] Button and dialog button labels are short, consistent and name the result. **C-02** `[tool]` (*1. Buttons and actions* in `ux-writing.md`)
- [ ] Checkbox captions name the state (*Overdue*), not a question (*Is overdue*); tab captions name their content, never *Details* or *Other*. **C-03** `[tool]` (*3. Field labels and helper text* in `ux-writing.md`)
- [ ] Error messages say what the user can do next. **C-04** `[render]` (*4. Errors: prevention, then recovery* in `ux-writing.md`)
- [ ] Regular users see no admin technical details unless they need them. **C-05** `[judgement]`
- [ ] All user-facing text is localized to every enabled language, with no unintended language mix (SC 3.1.1, 3.1.2). **C-06** `[render]` (*10. Writing for localisation* in `ux-writing.md`)
- [ ] Tooltip, placeholder and description texts are localizable resource strings, not inline literals. **C-07** `[tool]` (*Field guidance* in `page-layout-and-controls.md`)
- [ ] A non-obvious section or tab has a one-line localizable intro under its heading. **C-08** `[judgement]` (*Text, labels, and messages* in `page-layout-and-controls.md`)

### Typography and visual style

- [ ] Text uses Montserrat and only the Freedom UI scale: Headline 1–4, Body, Caption. **T-01** `[render]` (*Typography and visual style* in `page-layout-and-controls.md`)
- [ ] Colours are few and come from the predefined palette. **T-02** `[render]` (*Freedom UI color guidance* in `accessibility-and-colors.md`)
- [ ] Components keep the default Creatio appearance: no global restyle, and no restyle made only to satisfy another rule. **T-03** `[tool]` (*Native appearance* in `page-layout-and-controls.md`)
- [ ] Any custom CSS, global style or theme has a business reason and the user's confirmation. **T-04** `[judgement]` (*Custom CSS* in `page-layout-and-controls.md`)

### Accessibility

Accessibility is part of every design and audit, not an optional last step.

- [ ] `accessibility-and-colors.md` was opened and applied in this run, not recalled from memory. **A-01** `[judgement]`
- [ ] Text contrast is at least 4.5:1, or 3:1 for large text (SC 1.4.3). **A-02** `[render]` (*Contrast rules* in `accessibility-and-colors.md`)
- [ ] Custom tab, Area, chart, glass and wallpaper colour pairs were contrast-checked. **A-03** `[render]` (*Contrast rules* in `accessibility-and-colors.md`)
- [ ] Colour is never the only carrier of a status or meaning (SC 1.4.1). **A-04** `[render]` (*Freedom UI color guidance* in `accessibility-and-colors.md`)
- [ ] Every interactive element is reachable and usable by keyboard. **A-05** `[render]` (*Screen-level decisions: order, focus, and keyboard* in `accessibility-and-colors.md`)
- [ ] Every component's accessibility parameters (title, caption, `aria-label`, tooltip) hold meaningful text, icon-only actions included, never "Button 1" (SC 4.1.2). **A-06** `[tool]` (*Element size & appearance* in `accessibility-and-colors.md`)
- [ ] Informative images have alt text; decorative images are hidden from screen readers. **A-07** `[tool]` (*Images, icons, and non-text content* in `accessibility-and-colors.md`)
- [ ] Charts and diagrams have a text alternative or data table where needed. **A-08** `[judgement]` (*Images, icons, and non-text content* in `accessibility-and-colors.md`)
- [ ] Status changes and no-result messages are announced; key actions such as Save give a status message (SC 4.1.3). **A-09** `[render]` (*Localization, links & status* in `accessibility-and-colors.md`)
- [ ] Input errors are identified with a correction hint; required fields are marked at entry (SC 3.3.1, 3.3.3). **A-10** `[render]` (*Inputs, forms & validation* in `accessibility-and-colors.md`)
- [ ] Known or linked values are pre-filled, not asked for again (SC 3.3.7). **A-11** `[judgement]` (*Inputs, forms & validation* in `accessibility-and-colors.md`)
- [ ] Interactive targets are at least 24×24 px or spaced by a gap of 8 px or more (SC 2.5.8). **A-12** `[render]` (*Element size & appearance* in `accessibility-and-colors.md`)
- [ ] Navigation, inline help and repeated functions keep one icon, label and position across pages (SC 3.2.3, 3.2.4, 3.2.6). **A-13** `[render]` (*Understandable* in `accessibility-and-colors.md`)
- [ ] `PageTitle` is kept; each page or modal has exactly one H1 and a logical heading order (SC 2.4.2, 1.3.1). **A-14** `[tool]` (*Page structure* in `accessibility-and-colors.md`)
- [ ] The shell (`BaseShell`, `MainShell`) is unchanged, so skip links work (SC 2.4.1). **A-15** `[tool]` (*Page structure* in `accessibility-and-colors.md`)
- [ ] Link text is descriptive in context, never a bare "Click here" (SC 2.4.4). **A-16** `[render]` (*Localization, links & status* in `accessibility-and-colors.md`)

## Audit output template

Write the audit in the shape of `../assets/templates/audit.md`:

- **One subsection per audited page**; a page with no issues says "No issues found."
- **Category** is **Accessibility** (WCAG, contrast, keyboard, alt text, announcements) or **UX improvement** (layout, grouping, copy, components, flow); the rule behind each finding goes in its Issue cell (*Citing the source of a finding*), its level follows *Severity model*.
- **Accessibility notes** says what was verified, by which method, and what was not (*Verifying accessibility on the rendered page* in `accessibility-and-colors.md`).
- *Recommended structure* and *Cross-page notes* are omitted when empty.
- A full audit or acceptance run also writes a verdict file (*Verdict file*).

## Citing the source of a finding

Each finding names its rule's source in parentheses at the end of the Issue cell, so a reader can check it without trusting the auditor:

- **a Nielsen heuristic**: H1 visibility of system status · H2 match between the system and the real world · H3 user control and freedom · H4 consistency and standards · H5 error prevention · H6 recognition rather than recall · H7 flexibility and efficiency of use · H8 aesthetic and minimalist design · H9 help users recognize, diagnose and recover from errors · H10 help and documentation;
- **a WCAG success criterion**, by number: `SC 1.4.3`, `SC 2.5.8`;
- **a rule of this skill**, by checklist ID or section title: `F-04`, `visual-check: style census`.

Example: `| Medium | UX improvement | Lookups | Status opens a selection window for six values (H7; F-04) | Set simple-lookup on the column |`. A finding that names no source is an opinion: keep it only if you can say which user task it slows, and mark it as such.

## Severity model

- **High**: the issue can prevent task completion, make required information inaccessible, create a WCAG failure, trigger an irreversible action without protection, or cause serious misunderstanding of record state.
- **Medium**: the issue slows users, creates ambiguity, adds unnecessary scrolling, causes inconsistent behavior, weakens validation, or makes the page hard to scan.
- **Low**: the issue is mostly visual polish, copy refinement, minor spacing, icon consistency, or an optional improvement.

## Page design output template

Before building a page, write the proposal in the shape of `../assets/templates/page-design.md`; its acceptance checklist cites item IDs from *Quick audit checklist*.

## Self-critique before delivering

Answer these twelve questions **in writing** before anyone else sees the page, looking at the rendered page; "yes, probably" is how a weak page survives.

1. **Is the most important information immediately recognisable?** Squint: is what survives the answer to the page's question?
2. **Is the space used deliberately?** No region is stretched to fill or left holed, and the columns are balanced (*Balance the page* in `page-layout-and-controls.md`).
3. **Is the density right for the task?** (*How dense* in `design-judgement.md`)
4. **Does the layout follow the user's priorities, or the data model's?**
5. **Is any block too large or too small** for how much it matters?
6. **Are related things grouped by the native containers** (islands, field groups, expansion panels) rather than by extra borders or colour?
7. **Is the primary action unmistakable**, the only one competing for that role in its context?
8. **Is the hierarchy strong without being noisy?** Could you promote one thing by demoting others instead of adding emphasis?
9. **Is colour used consistently and semantically**, on data and status rather than on chrome?
10. **Are the labels and messages specific?** Any *Submit*, *Manage*, *Process*, *OK*, *An error occurred*?
11. **Does it hold at real data volume**: thousands of rows, long names, empty optional fields?
12. **Does it look deliberate rather than assembled?** Could you explain why each block has its size and place?

**If two or more answers are weak, revise before delivering.** A weakness you keep is a decision: name it in the report under *What was not verified* or as an open item.

## Quality rubric

Use the rubric to find **which** dimension is weak, not to produce a total. Score each dimension 1–5, then write **one line for every dimension scoring 3 or below**, saying what specifically is wrong. That list is the revision plan; a score with no line is not a finding.

| Dimension | 1 — broken | 3 — acceptable | 5 — excellent |
|---|---|---|---|
| **Purpose** | no discernible question answered | a purpose can be inferred | one question, answered by the most prominent block |
| **Hierarchy** | everything the same weight | a title leads, the rest is flat | one focal point, clear second and third tiers |
| **Composition** | arbitrary placement, holes, orphans, unbalanced columns | consistent grid, uniform spans | spans follow importance within the container's column count; edges line up; columns balanced |
| **Density** | consumer-airy or packed beyond reading | consistent, unexamined | matched to the task and defensible |
| **Grouping** | many thin groups, or one undifferentiated wall | groups exist but split related fields | native containers carry the grouping; each group is a logical block |
| **Colour** | decorative, inconsistent, custom | semantic but overused | on data and status only; one role per hue; theme colours only |
| **Typography** | many sizes, custom fonts, weak contrast | the Freedom UI scale, inconsistently used | the Freedom UI scale only; values lead and labels recede |
| **States** | missing empty, error, read-only or loading states | present, not all considered | every applicable state handled: empty, loading, error, read-only, disabled, no rights |
| **Writing** | *Submit* / *Manage* / "An error occurred" | clear, inconsistent terminology | specific business terms; errors say what to do next |
| **Patterns** | invented shape or hand-built composite | right page kind, mishandled | right page kind and template, native components and composites |
| **Accessibility** | fails AA visibly | the components' built-in basics only | AA in full, verified by keyboard and zoom |
| **Realism** | demo data, demo volume | plausible data | real volume, totals that add up, empty and error states seen |

## Verdict file

A checklist run that lives only in the chat did not happen. **Every full audit or acceptance run writes one verdict file** in the shape of `../assets/templates/verdict.md`, in the task's working directory, never in this skill. A single check or a quick look reports findings without one.

| Verdict | Meaning |
|---|---|
| **pass** | verified, with evidence: a `get-page` node and property, a tool's real output, a measured number, a census or overflow line |
| **fail** | verified absent or wrong, with the same kind of evidence |
| **human** | confirmable only by eye on the rendered page; say exactly what to look at |
| **not applicable** | the page has nothing the item checks (no stepper, no list page) |

- **Every item appears once, by ID.** A row is required for every `fail`, every `human` and every `[judgement]` item, with its reason. Passes go in one line, `Passed: <IDs>`; items that do not apply in `Not applicable: <IDs>`. A pass may get a row when its evidence is worth keeping, such as the census line behind L-28 *Style parity*.
- **The tag bounds the verdict.** A `[tool]` item passes or fails on tool output; a `[render]` item on a measurement, or is `human` when only an eye can settle it.
- **Evidence is a path or an output, not a claim.** "Styles match" is not evidence; the census line is. Paste real output, never a paraphrase.
- **A stub or a partial result is `fail`**, with the remainder named.
- **The result is `pass` only when no item fails and a person confirmed every `human` item in the same session.**
- **The header names the toolkit version**; IDs are stable, so verdicts compare by ID across versions.
- **Open** lists one line per failure, naming what closes it.
- **Finding and fixing are separate passes.** Write the verdict file before editing anything; name a trivial fix and apply it in the next pass, because a reviewer who is also repairing stops reading.

## Pixel review format

A pixel review reports visual findings as the page under review against its native reference (`visual-check.md`), in the shape of `../assets/templates/pixel-review.md`, instead of a comment thread.

- **Every finding has a stable id**, `<PAGE>-01`, `<PAGE>-02` …, so "`<PAGE>-07` is fixed" can be verified in the next check.
- **Every finding is a labelled pair of crops**, *Now — build* beside *Should be — native*: the same region at the same scale.
- **Where the defect is a number, the measured numbers are in the labels**; two pixels are invisible in a picture and unarguable in a label.
- **Every finding ends in a `Done when:` line**: an observable end state naming native components and properties, not appearance. For accessibility, cite the criterion: *Done when: Tab reaches every row action and the focused one shows the focus ring (WCAG 2.4.7).*
- **Colour findings name roles and relationships, never hex values**; a relationship survives a theme change.
- **Nice-to-have findings say *optional*.**
- **A platform gap is noted on the finding** where no native component achieves the look (*Custom CSS* in `page-layout-and-controls.md`).

Write the `Done when:` line first, for your own decisions too: a decision without an observable outcome is not specific enough to build.

## Report a delivered design

When delivering a page design or a built page, state:

1. **The page's question**, and who it is for.
2. **The layout decision and why**, with the rejected alternative and the criterion it lost on ("progress-bar template rejected: the record has no ordered stages").
3. **What you assumed** where you could not ask.
4. **What you did not verify**: "keyboard pass done, no screen reader; one window width, panels closed" is useful; "accessible" with no method is not.

A design delivered with its reasoning can be argued with; one delivered as a finished artefact can only be accepted or rejected.

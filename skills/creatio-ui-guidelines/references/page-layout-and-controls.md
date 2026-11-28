# Page layout and control guidelines

Use this reference to build or review a Creatio Freedom UI page: which component, where it goes, how it is configured. Each rule has one home here; other files point to it by section name. List the headings with their line numbers and read the section you need.

Where a rule's strength is not obvious, its lead sentence names it: **pass/fail** (a tool or a measurement decides; a miss is a defect), **default** (do it unless the plan names a reason not to), **heuristic** (a signal for judgement; name the reasoning in the plan). `SKILL.md`, *When rules collide*, defines the levels.

## Contents

- Choosing the component (source of truth)
- General product fit
- Text, labels, and messages
- Page composition: Choosing the page template · Match existing styles · Island structure · Balance the page · Component alignment · Contextual side panel · Article page
- Analytics and metric widgets: Charts and metric tiles
- Field-driven companions: amount → analytics · deadline → timer · Contact or Account → profile island
- Buttons and actions: Button placement · Header actions · Button styles · Icons · Button vs menu action vs checkbox
- Long-running and destructive actions
- Typography and visual style: Native appearance · Custom CSS · Contrast and accessible names
- Adding and editing data: Mini pages · Required fields · Label position
- Grouping and page flow: Field groups · Related lists · Read-only detail · Containers for grouping inputs · Flex vs Grid · New island / card container — standard settings · Layout coordinates and container nesting
- Step-by-step page (stepper)
- Record connections
- Fields: Field layout and order · Lookups and status chips · Field guidance · Special field controls
- List (section) page layout: Filters and search · List columns
- Dialogs and modals: Text-heavy modals
- Default Freedom UI behaviors that silently violate the guidelines

## Choosing the component (source of truth)

This reference names components by UX concept: profile island, field group, detail list, lookup, metric widget. Concrete `crt.*` names drift between versions, and a wrong or renamed type fails to render, so resolve every concept with `get-component-info` against the target environment, never from memory (pass/fail: the type exists in the target catalog).

- **Browse**: list mode returns every type with a description; detail mode adds `whenToUse` / `whenNotToUse` / `synonyms` / `useCases` to choose between similar components.
- **Find** by concept: `search='tab' | 'lookup' | 'chart' | 'profile' | 'list'`.
- **Scope** to the target version with `environment-name`. When the version cannot be resolved (`requiresVersionConfirmation`), tell the user and confirm before building.

**A pre-built combination is a composite: build every part its recipe names (pass/fail).** Designer-listed combinations (Expanded list, Attachments, Next steps, Communication options, Approval list) assemble several components; Approvals, for one, is a module above the profile island plus the approval list. Get the recipe with `get-component-info composite='<caption>'` and build each part. Never hand-build a composite from raw types or insert only the part you recognize. When a plan lists a composite's parts, each part is its own deliverable.

**Record the recipe of every `compositeOnly` type you insert.** When `get-component-info` reports a type as `compositeOnly`, write in your worklog or evidence, not only in your reasoning, the `composite='<caption>'` recipe you fetched and every part it named, so a reviewer can compare the build with the recipe and catch a partial composite.

## General product fit

- New apps and custom pages align with the overall solution and Creatio's visual language (*Native appearance*).
- Prefer ready templates and native building blocks: no-code components, predefined typography and colors, business rules, dynamic cases, mini pages, the DCM stage progress bar, widgets, existing navigation patterns. Build custom UI only when no standard pattern solves the use case.
- Before creating a new pattern, find an analogous base Creatio implementation and mimic its interaction model, placement, labels, state behavior and visual weight.
- Design for the actual role and process frequency: actions used on most visits, and critical ones, go in fast access; rare ones go into menus or later sections.
- Make the page understandable without separate instructions, through structure, labels, placeholders and tooltips (*Field guidance*), help and validation.
- Reveal content progressively with business rules and dynamic loading instead of showing every field at once.

## Text, labels, and messages

- Use **Sentence case** for labels and headings: only the first word is capitalized unless grammar or a proper noun requires otherwise. No Title Case or all-caps headings.
- Keep button labels short and result-oriented: "Send for approval", not "Click here". Use typical wording from existing Creatio interfaces.
- No period after the final sentence of short helper text or button and dialog copy unless the local style guide requires it.
- Error messages for admins and regular users can differ; for regular users, say what happened and how they can solve it themselves.
- Validate text with a quick usability check: a new user, with no help from the project team, understands what to do.
- **Introduce a non-obvious section or tab with one short helper line under its heading.** Non-obvious: the title alone does not tell a new user what the area does (a rules area, a conditions list, a configuration step). One sentence in muted body text, before the controls, saying what it does and how it is used, as a localizable string.

Word choices: `ux-writing.md`.

## Page composition

- Use ready page templates; they carry standard spacing and alignment. Keep the spacing around headers and the gaps between containers consistent.
- Put controls in proper containers, not loose on a grid where alignment breaks (buttons: *Button placement*).
- **A dense or overloaded layout is a fix or a question for the user, never an optional refinement.** Before calling a page done, reread the rendered page against *Balance the page*, the spacing in *New island / card container — standard settings* and *Field groups*. How dense the page should be: `design-judgement.md`, *How dense*.

### Choosing the page template (before you create the page)

The template decides which slots exist and where. It is fixed at `create-page` and cannot be swapped afterwards; changing it means a new page and a re-authored body. So derive the template from the intended composition before `create-page` (pass/fail).

- **Choose from `list-page-templates` on the target environment.** Template names are version- and environment-specific; do not author one from memory or assume the default form page.
- **A record with stages needs the template that ships the stage progress bar (DCM).** Create it from that template so the bar sits in its native slot; hand-placing a bar into a default page rebuilds a template slot and drifts from the native look. On a recent build it is `PageWithTabsAndProgressBarTemplate` ("Tabbed Page with Progress Bar"); look up the exact name on the stand, and confirm with the developer when several look similar.
- The template also decides header above tabs vs a side profile (*Balance the page*), record vs list vs dashboard page, and the mini-page template for quick add.
- **Scaffolded pages are fixed to their template too.** `create-app-section` and `create-app` generate list and form pages on a default template. When the record needs another one, decide it at planning time: create the record page with `create-page` on the right template and register it as the section's page, or recreate the scaffolded page on it.
- If the page already exists on the wrong template, say so and offer the recreate path with its cost (new page, body re-authored, add and edit registrations updated) instead of silently patching it.

### Match existing styles

- **Match what is already there: this page, or a shipped page on the same template when this one is new (default).** Read the current page (`get-page`) and reuse its conventions for every new element: the ExpansionPanel style (spacing, padding, `borderRadius`, header and collapsed state), input `labelPosition`, container spacing, padding and radius, widget sizes, column count. A differently styled component next to existing ones is a defect.
- **When the page is new or empty**, `get-page` a shipped Freedom page on the same template that has expansion panels and profile islands and copy its conventions, so an added container carries the platform's spacing, padding, `borderRadius` and color, not a bare default.
- **Compare the rendered page with a native page on the same template before calling it done**: `visual-check.md`.

### Island structure

- On a complex record page, prefer islands: record header; profile island for key stable data; metrics, widgets and charts; related record profiles; progress bar; tabs and toggle panels for secondary information.
- **Avoid long, unstructured record pages.** When reaching an area takes more than about two screens of scrolling, split the information into tabs and groups so the user reaches it in one click.
- Avoid mixing one-column and two-column fields in one group unless it improves reading flow.

### Balance the page

**The left and right areas are proportional in length (default, checked on the rendered page).** Test with the first tab open: the left column ends roughly level with the bottom of the right area's content; it fails when it ends above the right area's middle. Judge the rendered height, not the schema.

- **Fill the left column with more islands, not one or two extra fields.** The record template ships one left island. When the right area is long, add a second (and if needed a third) left island below it with the same settings (*New island / card container — standard settings*) and distribute key stable fields into them until the test passes.
- **Fill it only with what the user needs on this page:** key stable fields, a related-record profile, a metric that answers the page's question. Every block passes the subtract check: remove it; is anything lost? Decorative widgets, a metric that repeats a field and placeholder groups fail it.
- **Small single-value status islands may stack in the left column**: one metric or status per island, with an icon and, where relevant, a state badge, rather than one island of unlabeled numbers.
- **Collapse the side when there is little to show.** When the object has only one or two key fields, or nothing passes the subtract check, the template is wrong, not the column: move the fields into a group or use a template without a side profile (resolved with `list-page-templates`).

### Component alignment

**A component among fields aligns with them on both axes (pass/fail, measured).** A timer, badge, button or read-only value in a field group takes a field's anatomy: caption in the label column, value in the value column. Its left edge lines up with the field values (or with the labels, when its caption sits in the label column), never starting under a label. It takes a whole grid row, its text on the same line as the fields' text in that row; a component shorter than a field row does not ride up against the field above or leave a gap below. Measure on the rendered page: text top and left edge within 2px of the neighbouring fields.

### Contextual side panel

**Reference information or tools that accompany a record go in a contextual side panel, not in the page body or a modal (default).** Use a right-docked panel the user opens from the header and can close (a customer summary while handling a case). Reuse the platform's ready panels (attachments, communication) instead of rebuilding them.

### Article page

**A content page uses a full-width reading column, not the record field grid (default).** Long-form text (knowledge-base article, note, digest) is one full-width rich-text column with a short meta row above it (type, last updated, author), in the predefined typography presets; no side profile islands.

## Analytics and metric widgets

- Widgets: a single metric or count (`crt.IndicatorWidget`), a value on a scale (`crt.GaugeWidget`), charts (`crt.ChartWidget`), an embedded list (`crt.ListWidget`); confirm each with `get-component-info`.
- **Place widgets where they are seen first:** at the top of the `SideAreaProfileContainer` (or its template analog), or first in the tab that holds their data.
- **A widget gets its own island (default).** A gauge or a block of tiles does not share an island with input fields; a field joins it only when it explains that metric and the plan says so.
- **Metric color follows meaning.** A metric that signals a problem (overdue, failed, over the limit) takes the negative or attention color when its value needs action; neutral counts stay neutral. Colors, banned low-contrast colors and icons come from clio's `widget-color-and-icon` guide (`get-guidance`); the title carries the meaning too.
- **A small summary widget may be the first cell of the content field grid**: `column: 1` of the first field band, size XS or S, with the fields in the remaining columns and their `colSpan` math kept correct.

### Charts and metric tiles

- **Every chart answers a question named in the plan and shows all the data it compares (pass/fail on the rendered page).** A comparison chart (budget against actual) carries every series it names, each with data. A chart that answers no question is removed. Chart type: `design-judgement.md`, *Which chart*.
- **A chart goes beside the data it sums up (default):** at the top of the tab that holds its records, not on a separate tab. A dedicated Analytics tab is only for analytics spanning several areas of the record, and holds enough charts to fill a screen; with fewer than three such charts, place them on their data tabs.
- **Sizes and arrangement come from clio:** `get-guidance name=dashboard-and-home-page-layout` owns the chart and tile sizes, how many per row and the order of metrics and charts, and applies to a record page's chart area too. Check the rendered tab: the charts read as compact cards, several visible without scrolling.
- **The side profile column holds only small metrics**: XS or S tiles with an icon, or one tile across the island for a long value. Large charts go in the content area.

## Field-driven companions

Some fields imply a component beside them. A deadline's timer and a business contact's profile are part of "the field is done" (default): without them the user does date math or navigation the page should do. An amount's analytics depends on the page's question (heuristic). Resolve each with `get-component-info` (`search='indicator' | 'gauge' | 'chart' | 'timer' | 'profile'`, `composite=` for ready combinations).

### An amount field gets analytics when the page asks a question about it

- **Applies to** any money or quantity field (total, amount, price, cost, budget, revenue, hours, quantity), entered or calculated, on a record or section page.
- **First name the question** the user brings to the page about the value: within the limit? how much paid and how much remains? plan vs actual? Add a metric only to answer such a question, and name it in the plan. With no such question (a line amount on an add mini page, a price the user only reads), the field stays alone.
- **The metric says something the field does not:** a rollup across child records, paid vs remaining, plan vs actual, an average per unit or period, a share of a larger total, a count with its sum for a related list.
- **Placement:** *Charts and metric tiles*. A calculated amount also gets the read-only tooltip (*Field guidance*). An amount that belongs to a set of records also gets its aggregate on the section page's Dashboard component, where users compare records.
- Anti-patterns: a page that exists to judge an amount (a budget, an invoice against its limit) with no rollup, comparison or trend; a metric repeating the field's value; a metric on a page that asks no question about the amount; a wall of icon-less amount widgets at zero spacing.

### A deadline field gets a timer beside it

- **Applies to** a point in time the user must act before within the page's working horizon: due date, expiry, valid-until, SLA response or solution time, next inspection, expected close date. A far date months away (a project's planned end) is not one: show it as a metric (*Days until planned end*) when the page's question needs it, or leave it alone.
- **Add a timer next to the date**, in the same island or group on its own row under it, aligned per *Component alignment*, bound to the date column, so the user reads time left or overdue at a glance. Keep the date visible: the timer complements it.
- **The timer says what it counts and shows its state in color:** a visible caption (*Time to inspection*), `positiveTextColor` green while there is time, `negativeTextColor` red when overdue, and a `negativeTextValue` such as *Overdue*, so the state does not rest on color alone. Check that the caption renders. Creatio's case and SLA pages are the reference for placement, format and copy. If the target catalog has no timer (`get-component-info search='timer'`), say so and offer the closest native alternative, not a countdown field maintained by a process.
- Where the deadline drives state (at risk, overdue), show it through the record's existing status or stage indicator, never color alone (`accessibility-and-colors.md`).
- Anti-patterns: a bare `Due date` on a page whose purpose is to act before it; a "Days left" field kept current by a scheduled process; a timer without its date, or on another tab.

### A Contact or Account field gets that record's profile island

- **Applies to** Contact, Account and comparable lookups that name a business relationship (responsible, primary contact, customer, supplier, owner): someone the user needs to reach. Audit lookups (Created by, Modified by) are out of scope.
- **Add a related-record profile island**: the linked record's name (with photo where available), job title, company, phone, email and the platform's communication options, read-only, in its own island in the side column, captioned for the relationship (`Primary contact`, `Customer`). Get the assembly from `get-component-info` (`search='profile'`, `composite=` for communication options).
- **Keep the lookup field** in the form. The island is its read-only expanded view, not a second place to edit it and not editable copies of the related record's fields.
- **Bind the island's visibility to the lookup**, so an unfilled record shows no blank profile.
- Two related profiles stack vertically as two standard islands, never side by side; they are the natural way to fill the left column (*Balance the page*).
- Anti-patterns: a Contact lookup and nothing else; `Email` and `Phone` re-added as editable fields; a "related" profile built from the current record's own fields.

## Buttons and actions

### Button placement

- **Page-level actions** (save, refresh, run a process) go in the header's `ActionButtonsContainer`, top right; how many: *Header actions*.
- **Context-specific actions** (fill a field, run a calculation) go next to the component that shows their result, so cause and effect connect.
- **Actions on the record a profile island represents** (Escalate, Assign to me) go inside that island below its fields, in a `crt.FlexContainer`: one or two there, the rest in a menu.
- **Wrap buttons in a `crt.FlexContainer`, not directly on a grid.** Flex adapts to label length and translation and keeps heights aligned. A button beside an input ("Calculate" beside a value) shares one flex with it.
- **A button is visible and active only when it can be used**, by record state and user rights; state-dependent actions that no longer apply are hidden ("Send for approval" once under approval).

### Header actions

**The header keeps one or two frequent actions as buttons; the rest go into one actions menu (default).** An action used on most visits stays a button; an occasional one goes under one menu button such as *Actions*. Three or more separate header buttons need a reason named in the plan.

### Button styles

- **One Primary button per context**, for the main action or the active dialog action. It may be green instead of the default blue for a step that starts or activates a process; the label still carries the meaning (`Start`, `Activate`), and no other ad hoc button colors appear. Save and Apply stay the default primary.
- At most one **Secondary** button for positive confirmation per context; **Plain** buttons freely for neutral actions.
- **A primary action with close variants is a split button** (Save / Save and new / Save and close); it counts as the single primary.
- **Reports print through the platform's Print button**, whose dropdown follows the reports registered for the object; a hand-built report button drifts out of date. Resolve it via `get-component-info`.

### Icons

- An icon matches the action unambiguously; every icon button has a tooltip and accessible text.
- **A set of related actions or menu items gets distinct, fitting icons** from the Freedom UI library, in one style, so items are told apart at a glance. Quick filters: *Filters and search*.

### Button vs menu action vs checkbox

- A visible button for actions used on most visits that change data or start a process; a menu action for rare ones; a checkbox for state data that runs no process.
- **A toggle sets a mode that takes effect as configuration** (Use contact's timezone); a checkbox records a plain boolean with the record's data. Do not swap one for the other to restyle.
- **A consequential either/or choice is selectable cards, not a dropdown.** When two or three options change what happens next (send now, schedule, smart-send), show cards with an icon, a short title and a one-line consequence, one selection. An ordinary value pick stays a dropdown.

## Long-running and destructive actions

- Warn the user before launching an action that can take long.
- Show execution status with a loading mask, a snack-bar, a countdown or a progress area.
- Over 30 seconds or of unknown duration: run asynchronously and notify the user on completion.
- If an operation can affect system performance, recommend scheduling it outside business hours.
- For long-running external updates, show when the data was last updated.
- A destructive, irreversible or high-impact action is cancellable, undoable or confirmed. Which one: `design-judgement.md`, *Confirm, undo or neither*; wording: `ux-writing.md`.

## Typography and visual style

- The Freedom UI font is Montserrat. Use predefined typography and colors, and few font styles and colors: Headline 1–4 for headings, Body for text, Caption for supporting text.
- Color supports information and is never its only channel: text, an icon or a status goes with it.
- Before requesting a global font, theme or style override, ask why it is needed and how it affects consistency.

### Native appearance

- **Custom additions do not stand out from the base product (default).** Keep the default component appearance, typography, colors, spacing and borders. A customization that makes the page look different from base Creatio, even "nicer", is a defect. Deviate only for a business priority, as a deliberate, scoped and confirmed decision.
- **Do not restyle components to fix a small nuance or satisfy another rule.** Switching every `crt.Input` to `appearance: "outline"`, or changing fonts, borders or colors across a form to work around one issue, makes the whole form deviate. Fix only the specific field when truly needed.

### Custom CSS

**Custom CSS is a last resort: native inputs first, then warn and confirm (pass/fail).** A visual requirement (color, background, font, text size, spacing, border, size, alignment) is custom CSS once expressed as a `styles` object, a `classes` CSS class, or an `extraStyles` hook (`extraStyles.toggle`, `extraStyles.label`) carrying raw values such as `color`, `fill` or `font-family`; the three count equally, and `extraStyles` is not native because it is a component input. A changed font-family or a hard-coded color is never a native default, since both come from theme tokens. Custom CSS is outside Creatio's upgrade-compatibility guarantees and can break on a future upgrade. The order:

1. Exhaust the component's native inputs (`get-component-info`). If one achieves the look, use it and do not mention CSS.
2. Otherwise tell the user no native option exists, warn about the upgrade risk, and get explicit confirmation before writing `styles`, `classes` or `extraStyles`.
3. If the user declines, apply none: offer the nearest native alternative or say the look is not achievable natively.

"Just apply, don't ask" waives the question, not the one-line upgrade-risk warning.

### Contrast and accessible names

**Checked on every page you build, not only in an audit (pass/fail).** Standard and small text has at least 4.5:1 contrast, large text 3:1, custom tabs, areas, charts, backgrounds, images, dialogs and components included. Every component's accessible name (title, `aria-label`, tooltip, alt text) carries a real value, never empty or a placeholder default. Beyond this baseline: `accessibility-and-colors.md`.

## Adding and editing data

- Prefer a mini page for creating or editing when the task is focused, role-specific or step-limited.
- Order fields by how users fill them in (*Field layout and order*). Use validation, input and lookup filtering, defaults and auto-substitution; configure the fields copied with a record.
- Do not overload create flows with information needed only later.

### Mini pages

- **A mini page names what it creates and carries the fields that define the record.** Caption it with the object (*New <object>*), not *New record*; put on it the required fields and the few that make the record meaningful at creation.
- **Values filled in for the user are valid**: a suggested number, code or date does not duplicate an existing record or contradict its state. Use the platform's sequence or leave the field to the user.
- **Columns follow the values.** One column by default; two when the fields are short and pair by meaning (a number beside its date); long text takes the full width. Labels: *Label position*.

### Required fields

- **Require the real minimum only (default).** A field is required only when the record cannot be created or is meaningless without it. Extra required fields block quick creation and invite junk; guide recommended fields with defaults, placeholders or business rules instead.
- **Required fields are on the first screen (default):** the header or top island, the left profile column or the first tab, in logical order, with the platform's required mark. On a later tab the user meets the field only when saving fails; when one must live there, name the reason in the plan. Fields edited on most visits go early too.

### Label position

- **Inputs in one group share one label position, and no component is restyled to get it.** Prefer a concrete value (`"above"` or `"left"`). Never change a component's `appearance` (`crt.Input` `legacy` to `outline`) to make a position render: the base look wins. If an explicit position needs that, keep the default appearance; `"auto"` is acceptable on a record page when it renders consistently.
- **Every field on a mini page or a modal sets `labelPosition: "above"` explicitly (pass/fail).** A `left` label column squeezes the input at that width, and the default `auto` switches between `left` and `above` by container width, so a field without the property can render its label beside the input. The one exception is a wide page, size L or XL, where `left` may be set if it reads cleanly; on S and M it is `above`. One position across the dialog. Shipped mini pages write `above` on each field with the default appearance; do not switch to `outline` to make it render.

## Grouping and page flow

- Use field groups to divide information, nested at most two levels; tabs and groups for large datasets.
- Put related fields next to each other (same group, adjacent rows), so the two columns read as pairs.
- A process with clear steps gets a stepper (*Step-by-step page (stepper)*) or business rules that reveal later fields as earlier ones are filled.

### Field groups

- **A group is a meaningful block (heuristic, except the single-field case).** A group, tab or island holds a coherent block of related fields; three or four fields is a signal to check against the page's question, not a quota (`design-judgement.md`, *Design principles*, "Rules are not counts"). A group with one data-entry field is a defect: merge it or add the fields of its block. A two-field group is a warning sign: combine it with a related group or pull in the rest of the block. Never split one business block into tiny groups.
- **Fill out the main information block.** The profile island plus the first tab carry the core attributes a user expects for the record type: owner, type or status, key dates, not `Name` alone.

### Related lists

**Every 1:M child object of this record gets a related list on the record page, with a working add flow (default).** Do not omit a list because the app is simple. A list whose records cannot be created, or whose "+ Add" opens a page not registered for the object, is a defect (pass/fail). The default is two layers together:

- **Inline adding and editing, always on.** Set `features.editable` with `enable: true` and `itemsCreation: true` on the list's `crt.DataGrid` (shape from `get-component-info component-type='crt.DataGrid'`), so the user adds and edits rows in place with the master link pre-set. A grid without it renders read-only rows. Turn inline off only when the user names that restriction, and then follow *Read-only detail*.
- **Plus pages.** Wire "+ Add" to a mini page with the starter fields and register the full page for opening and editing, or a mini page alone when it holds the whole record. A child with no section of its own gets both registered for its object (mini page as add page, full page as default and edit page).
- **Only a tiny list skips the pages (heuristic):** rows of about three short values or fewer (a tag, a date, an amount) and no long text. Line items with more columns get both layers.

Record the choice for each list in the plan. Lookups are not related lists. Build the list through clio: `get-guidance related-list`, the "Expanded list" composite (`get-component-info composite='Expanded list'`), and `get-guidance related-page-binding` for the pages.

### Read-only detail

- **A read-only detail must be read-only on its rows too, not just have its add button hidden.** Making a detail (child list) non-editable takes THREE changes: (1) hide/remove the add (`+`) button; (2) clear the inline-editing flag on the List component itself; (3) remove the row **Copy** and **Delete** actions from the List's rows, while **keeping records opening from the list** (open-on-click) so users can still view them. Hiding only the add button still leaves existing rows editable in place (and often a new-row affordance), and a row that still offers Copy or Delete still creates and destroys records, so the detail is not actually read-only. Removing Copy/Delete is not a reason to stop rows opening: a read-only list is for looking records up. On a `crt.DataGrid` the recipe is: `features.editable` set to `{ enable: false, itemsCreation: false }`, and `rowToolbarItems` set to exactly one `crt.MenuItem` that mirrors the platform's own Open item: a localized `caption` (a page resource string such as `#ResourceString(<List>_OpenMenuItem_caption)#`, never a hard-coded English `"Open"` literal), `icon: "edit-row-action"`, and `clicked` set to `{ request: "crt.UpdateRecordRequest", params: { itemsAttributeName: "<Items>", recordId: "$<Items>.<DS>_Id" }, useRelativeContext: true }` (`<Items>` is the list's items attribute, `<DS>` its data source). Keep the platform item's two guards as well: it is hidden when the list's entity has no edit page, and disabled while the parent record is still in create mode (not saved yet) — so leave the item out for an entity with no edit page, and bind its `disabled` to the page's create-mode state. The platform adds its default row actions (Open, Copy, Delete) only while `rowToolbarItems` is unset, and any value you give replaces all three — so `rowToolbarItems: []` or `features.rows.toolbar: false` leaves the rows with no Open at all, and leaving it unset keeps Copy and Delete. Before building, confirm the shape on the target version with `get-component-info` for the list component, or copy it from an out-of-the-box page whose list rows offer Open alone.

### Containers for grouping inputs

- **Input groups go in a `crt.ExpansionPanel` or a profile island.** An ExpansionPanel is a titled, collapsible field group (it also wraps a list to form a detail); a profile island (`SideAreaProfileContainer`) holds key stable data. Inside either, lay fields out with a `crt.GridContainer` or `crt.FlexContainer` (*Flex vs Grid*). Prefer a panel over a bare grid when a group needs a title or should collapse.
- **Expansion panels stack vertically at full width (pass/fail).** A panel spans the full width of its tab or container, one under another with a gap; never two in one row or in a two-column grid. Two columns apply to the fields inside a panel.

### Flex vs Grid

**Choose by whether the content changes at runtime (default).** A `crt.GridContainer` pins items to fixed `row` / `column` coordinates, so a hidden field or a collapsing panel leaves its slot empty. A `crt.FlexContainer` has no fixed slots; siblings close the gap.

- A group with a field that a business rule can hide or show goes in a flex.
- Collapsible panels, and whatever follows them, stack in a flex.
- Buttons go in a flex because they resize to their label (*Button placement*).
- A grid is for static layouts whose visible items do not change at runtime.

### New island / card container — standard settings

A new island (a `crt.GridContainer` or card-style group) takes these settings, not the Designer defaults. They are the expected native values; when a shipped page on the same template measures otherwise, the measurement wins (*When rules collide* in `SKILL.md`; how to measure: `visual-check.md`).

- **Column spacing:** Large
- **Row spacing:** None
- **Border radius:** Medium
- **Spacing (padding):** Top = Medium, Bottom = Medium, Left = Large, Right = Large
- **Color:** White (the card background)

Resolve the property keys and enums with `get-component-info crt.GridContainer`. "Column spacing" and "Row spacing" are the `gap.columnGap` / `gap.rowGap` object (there are no `columnSpacing` / `rowSpacing` properties); the card look is `color`, `borderRadius` and the per-side `padding` object.

**Plain grid for inputs (not an island).** A bare `crt.GridContainer` that only lays out inputs inside an island, panel or tab has no card chrome:

- **Column spacing:** Large
- **Row spacing:** None
- **Border radius:** None
- **Spacing (padding):** None on all sides
- **Color:** Transparent (the parent shows through)

**Spacing fits the content.** Inputs: no row spacing, column spacing kept so the columns do not touch. Widgets, charts and metrics: proportional row and column spacing, consistent with each other and with the widgets' size, never zero. On the rendered page, gaps between siblings look even.

### Layout coordinates and container nesting (avoiding gaps)

- **Read the container's column count `N` before placing fields (pass/fail).** It is a property of each container (`columns` / `columnsCount`). Full width is `colSpan: N` at `column: 1`; a two-column row is `column: 1` and `column: N/2 + 1`, each `colSpan: N/2`. Do not hardcode `12`, `6` or `7`.
- **Why a gap appears:** `layoutConfig` is relative to the immediate parent container, and rows/columns restart at `1` in each nested container; in a container that already has children (a template container) those children keep the rows they declare, and a new child takes the row its place in the layout needs — a free row between them (row 2 between template children at rows 1 and 3) or the next row after them. A field at `row: 3` while `row: 2` is empty reserves a blank row → vertical gap; a `column`/`colSpan` beyond the container's column count wraps to a new row and leaves a blank half.
- **Rows are numbered per container**, never with global numbers reused across groups.
- **Let containers size to content:** `rows: "auto"` with `gap`; no fixed `rows` count or oversized `rowSpan`. One titled group is one container; stack groups with `gap`, not empty rows.
- **An insert's `index` counts the parent's existing children, the template's included:** read them from the parent's node in the `get-page` bundle (`bundle.viewConfig`; `childCount` in `bundle.containers` gives the count). Example: on `PageWithAreaFreedomTemplate`, `CardContentWrapper` already holds the template's `TopAreaProfileContainer` at `row: 1`, so an island inserted into it at `row: 2` gets `index: 1` — `index: 0` would put it ahead of the profile container in `items`. In a grid container the order in `items` follows `layoutConfig` row, then column; the grid still renders by `layoutConfig`, so a wrong `index` does not show on the page, but the Designer and every later insert that relies on the order see the mismatch. The diff mechanics themselves (`operation`, `parentName`, `propertyName`) are owned by clio's `page-modification-components` guide.
- **Several inserts into one parent in one diff:** each insert's `index` is its position, by `layoutConfig` row then column, among the template's children and the other inserts of the diff that land before it in that order — not necessarily the end of `items`. Example: template children at rows 1 and 3 and a new element at row 2 give it `index: 1`, not 2.
- **Sanity-check before saving (pass/fail):** in each container, `row` runs 1..N with no skips, every `column` / `colSpan` is within the column count, every field's `parentName` is its real group container, and `items` order matches row, then column.

## Step-by-step page (stepper)

By default the indicator sits in its own island on top and the stepper in a separate island below. A record's stage bar is not a stepper: `page-patterns.md`, *Stage bar is not a stepper*.

- **Applies to** a page that leads the user through the ordered stages of one task (a configurator, an onboarding, a multi-stage request). A record's ordered process state is the DCM progress bar (*Choosing the page template (before you create the page)*); areas the user switches freely are tabs.
- **A stepper is several components, each placed once.** `crt.Stepper` holds the steps (`crt.StepperItem`) and shows one at a time; a separate `crt.StepperIndicator`, linked by `for`, shows and switches the steps; one set of Previous, Next and Finish buttons serves all steps. Take the property contract (`activeStep`, `linear`, the generated `<StepperName>_*` attributes, the navigation buttons) from `get-component-info`. Always place an indicator; never copy it or the buttons into each step.
- **By default the indicator is alone in a full-width standard island directly under the page header**, horizontal, above all step content; it adapts to its width by itself. `titlePosition: "below"` keeps the row light. On the user's request it can sit in any container outside the steps, such as a side column (`orientation: "vertical"`); when indicator and stepper should read as one component, both go in one container, indicator first.
- **By default the stepper is in a second full-width standard island below**, with the page's usual gap between islands; step content uses plain inner grids (*New island / card container — standard settings*). Step content, header and footer get no padding of their own.
- **The indicator island is only as tall as the indicator.** Put both islands in a flex column (`crt.FlexContainer`, `direction: "column"`). In a grid whose rows share the height equally, the indicator island grows to the stepper's height; there, read the row sizing in `get-page` and size the indicator row to its content.
- **The frame stays the same on every step.** Only the step content changes; a block several steps share keeps its position and width. The stepper island fills the page area's height, so a short step does not end halfway down an empty page.
- **The step header says what to do on this step.** The step's `tools` slot is its header ("Step N of M:" and a title from the Designer). Under the title, add one or two short sentences, each a `crt.Label` in `tools` with its own localizable string: what to do, as an action, and what happens next when not obvious. Write for the specific step, never "Fill in the fields".
- **Header typography stays standard.** Counter and title in one row (`crt.FlexContainer`, `direction: "row"`, `alignItems: "baseline"`), both `labelType: "headline-3"`, the counter in `var(--crt-color-text-muted)`, the title in `var(--crt-color-text-heading)`; a description line is `labelType: "caption"` in `var(--crt-color-text-muted)`. Size only through `labelType`, color only through these variables; never `labelFontSize` / `labelLineHeight` / `labelStyle` or a hex color. The page header and the indicator keep their own look.
- **Navigation buttons are placed once, by default in the stepper's `footer`**: Previous at the start, Next and Finish at the end, bound to the generated navigation attributes per the `get-component-info` recipe, with the recipe's colors (the one-primary rule is for page actions). The footer also keeps keyboard focus on a step change. On the user's request they go in the page header zone or elsewhere, still one set.
- **Step captions are short Sentence case nouns** ("Product selection"), as localizable strings; the indicator and screen readers use them.

## Record connections

**Record connections are one `crt.Connections` element, not a ComboBox per link (pass/fail).**

- **Applies to** a request to show or add the record's connections: the Classic **Connected to** block, or links to other records (Contact, Account, Opportunity, Case) shown together where only the filled ones need room.
- **Place one `crt.Connections`.** First read `get-guidance name=page-modification-field-contract` (*CONNECTIONS ARE NOT INSERTED FIELDS*), then `get-component-info search='connections'` for the page contract. By default it goes in a `crt.ExpansionPanel` titled "Connections" in the side column, with no `caption` of its own. Declare no ComboBox, attribute, datasource or child element per connection: the platform generates a field per connection at page load.
- **Which connections exist is a property of the object**, its Connections list in the Object designer (`get-guidance name=process-activity-connections`). To add, remove or reorder one, change the object (`get-entity-connections`, then `update-entity-connections`; semantics from `get-tool-contract`). If clio does not list these tools, tell the user to change the list in the Object designer; never fall back to page fields. The page changes only per-connection display settings, in the element's `connections` property, with the entry shape from `get-component-info`.
- **It renders only with the `UseConnectionsComponent` feature on** (off by default). A `get-entity-connections` warning naming the feature means off: tell the user the block stays invisible until it is on, and do not turn it on without their consent or fall back to ComboBoxes. Without `get-entity-connections` in clio the state is unknown, not on: place the element and say so.
- **A `crt.ComboBox` stays only for a lookup that is not a connection** and belongs to the form's own flow (Owner, Stage, Type, or a filtered list). A column shown by `crt.Connections` gets no second ComboBox; both would bind the same attribute.
- Anti-patterns: a column of empty unrelated lookups where a Connections block would show only the filled ones; inserting a field into `crt.Connections` `items`; adding on the page a connection the object does not list.

## Fields

### Field layout and order

- Prefer a two-column layout for standard record fields.
- Keep labels concise; explanations go in a placeholder or tooltip (*Field guidance*).
- Order fields by task flow and requiredness (*Required fields*).
- Put checkboxes after the related inputs, usually at the bottom of a group or island.
- Information read faster visually than as fields goes into widgets (*Analytics and metric widgets*).

### Lookups and status chips

- **A lookup to a small fixed catalog is a simple lookup, a dropdown (pass/fail).** Small fixed catalog: values that admins maintain and users only pick, up to about 20 (two included): status, type, category, stage, priority. This is set on the entity column, not the page: set `IsSimpleLookup` (clio `simple-lookup: true` on a `modify` or `add` column operation). Lookups to records users create, or catalogs that grow past about 20 values (Contact, Account, a parent record), keep the selection window. The page binds `crt.ComboBox` either way.
- **Filter lookups to relevant values** (only responsible colleagues), with a hint when the user could miss the filter.
- **A status-like lookup gets colored chips (default).** When a small-catalog lookup's values carry a state or a level the user scans for (status, stage, priority, health, risk, result), color its values without being asked; the form field and every list then show colored chips with no page change. Color follows meaning, one meaning per color across the app, from the scale in `accessibility-and-colors.md`, *Freedom UI color guidance*, never palette order: *Red* health in a green chip is a defect. The chip keeps its text; check its contrast on the rendered page. Lookups without state (country, product line) stay plain. How to write the colors is owned by clio: `get-guidance name=lookup-colors`, with the colors from the scale. Afterwards, confirm the chips render on the page and in a list.

### Field guidance

- **A field that is not self-explanatory gets guidance (default).** Test: a new user could not fill it correctly from the label alone, because it has a format, a unit or scale, limited allowed values, or a source. Non-obvious inputs without guidance are a defect, and so are empty, generic or "e.g."-prefixed hints.
- **Placeholders go on free-entry inputs whose format or sample helps** (text, number, date, email, phone, web). Skip them on self-evident fields, lookups and checkboxes; an unneeded placeholder is as bad as a missing one. A date with a picker usually needs none, and a date hint follows the user's culture.
- **The channel follows when the user needs it:** placeholder for format or sample; tooltip (`i` icon) for meaning the sample cannot carry (units, source, the rule behind a calculated value); a muted one-line description under the field only for guidance needed on every visit. Two channels only when format and meaning both need it, never three.
- **The text is specific and localizable.** "Enter value" or a repeat of the label helps nobody. Every placeholder, tooltip and description is a resource string. Wording: `ux-writing.md`, *3. Field labels and helper text*.
- **A read-only or calculated field gets a tooltip** saying why it is read-only and how and when it is filled.
- **An empty optional field reads as an invitation.** The one exception to "a placeholder shows a format or sample", lookups included: an optional field that usually stays empty on a saved record gets a call-to-action placeholder (`Add revenue`, `Add primary contact`). A list's empty state (`No data`) is the component's own.

### Special field controls

- **Ordered process state uses the DCM stage progress bar** (`crt.EntityStageProgressBar`), not a status combo box; template: *Choosing the page template (before you create the page)*.
- **A date without a time of day uses a date-only column.**
- **A bounded number the user sets by feel uses a slider** with the range endpoints (a confidence level 0–100); values typed exactly keep a numeric input.
- **The primary display name is composed from key fields** where a readable title can be derived (`<Need> / <Contact>, <Account>`), by a calculated value or business rule, kept editable, with its source in a tooltip.

## List (section) page layout

A section page has its own container slots; put things in the right one.

- **Additional list actions** go in `ActionButtonsContainer` (top right).
- **Analytics and dashboards** go into the Dashboard component (`crt.Dashboards`), or `DashboardsTabContainer` when you are unsure how to configure it; never into the grid or filter areas.

### Filters and search

- **Additional filters go into the filter row before the search (pass/fail).** The row is `LeftFilterContainerInner` (inside `LeftFilterContainer`): folder actions, the filter menu, the quick filters, `SearchFilter` last. Insert ahead of `SearchFilter`, reading the row's children in the `get-page` bundle to set the `index`; anything after the search field jumps while the user searches. `RightFilterContainer` holds the list's own tools (summaries, refresh, view switch), not filters; no filter goes inline in the grid.
- **Each quick filter has its own icon (pass/fail)**, distinct and fitting its meaning; filters sharing an icon cannot be told apart.

### List columns

Applies to the section list and every related list. Check the rendered list with demo data (pass/fail).

- **Nothing is cut.** No value or header ends in an ellipsis; money shows the whole amount with its currency. Widen the column or shorten the caption (*Overdue*, not *Is overdue*).
- **The columns fill the list's width**; columns stopping at half the width are a defect. Spare width goes to names, descriptions, accounts.
- **Width follows the content.** Dates, checkboxes, counts and short codes take narrow columns.
- **Height follows the rows.** A related list grows until its rows fit without an inner scroll, with no fixed height leaving a blank band below a short list.

## Dialogs and modals

- Dialogs follow the styling of Creatio mini pages: predictable title, button placement and hierarchy.
- **A focused set of action parameters is collected in a modal, not a full page.** When an operation needs a few self-contained inputs (closing an opportunity with a loss reason), ask for exactly those: required ones marked, instructions above the inputs, one primary confirm action.
- Labels: *Label position*. Explanatory text comes before the fields and buttons that depend on it.
- Use consistent action labels ("Save", "Cancel", domain result verbs) and Plain style for neutral close and cancel.
- Dialog errors say what the user can do next, without admin-only technical text.

### Text-heavy modals

Lots of copy gets typography, spacing and hierarchy, not a wall of text.

- **The shell comes from the template**: title, close icon, actions row and outer padding are not restyled. Configure only the content area.
- **Typography through the `labelType` preset**, never `labelFontSize` / `labelLineHeight` / `labelStyle`, which fight the preset and break theme switching. A subheading you add: `labelType: "headline-3"` (≈ 18/24). Explanatory copy: `labelType: "body"` (≈ 13/20), muted through the `labelColor` theme token (design reference `#757575`, never hardcoded). Hints: `labelType: "caption"` (≈ 12/16), muted. Weight: `labelThickness`.
- **Spacing through `gap` and `padding` `SizeEnum` keywords** (`none`, `small`, `medium`, `large`), not pixels. A control and its description share a column flex with a small gap (≈ 8px); blocks are separated by `medium` or `large` (≈ 16px). The pixel figures are intent to compare against, not values to write. No paragraph runs into the next block without a gap; everything aligns to one left edge.
- **Long or conditional explanations go into a tooltip beside the control**, with a link to the instruction when there is one; visible copy stays one short line.
- If the content cannot be reduced, a full page may fit better than a modal.

## Default Freedom UI behaviors that silently violate the guidelines

Platform defaults that look fine in the Designer and break a rule at runtime:

- A small-catalog lookup opens a selection window → *Lookups and status chips*.
- A `Date` field shows a time → *Special field controls*.
- Multi-word captions come out Title Case → *Text, labels, and messages*.
- Non-obvious and read-only fields ship without a tooltip or placeholder → *Field guidance*.
- Ordered status defaults to a combo box → *Special field controls*.
- A new side island holds only `Name` → *Field groups*.
- A detail's add button is hidden but rows still edit inline → *Read-only detail*.
- A `crt.DataGrid` without `features.editable` renders read-only rows → *Related lists*.
- List columns keep default widths, cutting values while the right part stays empty → *List columns*.
- A mini page from "+ Add" keeps the caption *New record* → *Mini pages*.
- A mini page or modal field left at `labelPosition: "auto"` renders its label beside the input → *Label position*.

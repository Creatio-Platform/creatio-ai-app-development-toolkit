# Page layout and control guidelines

Use these rules for Creatio Freedom UI page creation and UI/UX review.

## Concept → Freedom UI component map

Conceptual UX terms used in this guide map to concrete runtime component types. When a rule says to use one of these, insert the listed `crt.*` component (always confirm availability/exact name with `get-component-info` against the target environment):

| Concept / UX term | Component type(s) |
|---|---|
| Profile island (side, key stable data) | `SideAreaProfileContainer` (the container); fields laid out via `crt.GridContainer` |
| Field group / collapsible group | `crt.ExpansionPanel` (titled, collapsible) → fields in `crt.GridContainer`/`crt.FlexContainer` |
| Tab / tab set | `crt.TabPanel` → `crt.TabContainer` (one per tab) |
| Detail / related (child) list / "Expanded list" | `crt.ExpansionPanel` + `crt.DataGrid` (or `crt.List`) |
| List / grid of records | `crt.DataGrid` (also `crt.List`, `crt.MultiList`, `crt.ListWidget`, `crt.FilterableList`) |
| DCM / status / stage / progress bar | `crt.EntityStageProgressBar` |
| Metric / indicator | `crt.IndicatorWidget` (single value) · `crt.GaugeWidget` (scaled value) · `crt.ChartWidget` (charts) |
| Actions dashboard | `crt.ActionDashboard` |
| Toggle panels | `crt.ToggleContainer` → `crt.ToggleContainerItem` |
| Layout containers | `crt.GridContainer` (N-column grid) · `crt.FlexContainer` (flex row/column) |
| Lookup field | `crt.ComboBox` (dropdown vs selection window is set on the column via `simple-lookup`, not here) |
| Multi-value lookup | `crt.MultiSelect` |
| Text / number / date / boolean field | `crt.Input` · `crt.NumberInput` · `crt.DateTimePicker` · `crt.Checkbox` |
| Email / phone / web field | `crt.EmailInput` · `crt.PhoneInput` · `crt.WebInput` |
| Button / action | `crt.Button`; grouped actions via `crt.Menu` + `crt.MenuItem` |
| Empty-state placeholder | `crt.Placeholder` |
| Attachments / files | `crt.FileList` (+ `crt.FileInput`) |
| Feed | `crt.Feed` |

## Quick index

Jump to the section you need:

- **Component names** → "Concept → Freedom UI component map" (above).
- **Record/form page** → General product fit · Text, labels, and messages · Page composition · Analytics and metric widgets · Buttons and actions · Grouping and page flow (incl. *Layout coordinates and container nesting*) · Fields.
- **List/section page** → List (section) page layout.
- **Dialogs** → Dialogs and modals.
- **Review** → Common anti-patterns · Default Freedom UI behaviors that silently violate the guidelines.

## General product fit

- New apps and custom pages must align with the overall project solution and Creatio visual language.
- Prefer ready page templates and built-in Freedom UI components. Avoid custom UI unless a standard pattern cannot solve the use case.
- Before creating a new pattern, find an analogous base Creatio implementation and mimic its interaction model, placement, labels, state behavior, and visual weight.
- Design for the actual role and process frequency. Put frequent and critical actions in fast access; move rare actions into menus or later sections.
- Use no-code business rules and dynamic loading to progressively reveal content instead of showing every field at once.

## Text, labels, and messages

- Use **Sentence case** for Creatio labels and headings: only the first word starts with a capital letter unless grammar or a proper noun requires otherwise.
- Avoid Title Case and all-caps headings for fields, groups, details, and dialogs.
- Keep button labels short and result-oriented, for example “Send for approval,” not “Click here.”
- Use typical wording from existing Creatio interfaces when possible.
- Do not put a period after the final sentence in short UI helper text or button/dialog copy unless the local style guide requires it.
- Error messages for admins and regular users can differ. For regular users, explain what happened and how they can solve it themselves.
- Validate text with a quick usability check: a new user, with no help from the project team, should understand what to do.

## Page composition

- Use ready page templates where possible; they already include standard spacing and alignment.
- **Editing an existing page: match what's already there.** Read the current page (`get-page`) and reuse its established conventions for any new element — ExpansionPanel style, input `labelPosition`, container spacing/padding/radius, widget sizes, column count. New components must look like they were part of the original design, not a different hand.
- Preserve left/right spacing around headers and consistent gaps between containers.
- Put controls in proper containers, not directly onto a grid when alignment will break. For button groups, use flex layout and align heights.
- Prefer a clear “island” structure on complex record pages:
  - record header;
  - profile island for key stable data;
  - metrics/widgets/indicators/charts;
  - related record profiles;
  - progress bar;
  - tabs and toggle panels for secondary information.
- Avoid pages that require long scrolling. Split information into tabs and groups so the user can jump to the needed area in one click.
- Do not waste large side-profile space for only one or two fields. Move such fields into a group or choose a template with a header above tabs.
- **Fill the left/profile column — don't leave it near-empty.** The record-page template ships with a single left island. If the object has many columns, the left side will look empty next to the content area — add a **second left island** below the first, with the **same settings as the existing one** (see *New island / card container — standard settings*), and distribute key stable fields (and/or small metrics) into it so the left column is balanced, not sparse.
- Avoid mixing one-column and two-column fields inside the same group unless it intentionally improves reading flow.

## Analytics and metric widgets

- A page can host analytic widgets — `crt.IndicatorWidget` (single metric/count), `crt.GaugeWidget` (value on a scale), `crt.ChartWidget` (charts), `crt.ListWidget` (embedded list).
- **Place widgets at the top, where they are seen first:** at the top of the **`SideAreaProfileContainer`** (or its template analog), or as the **first elements of the relevant tab**.
- **If there is a lot of analytics, create a dedicated "Analytics" tab** instead of crowding the main/general tab.
- **In `SideAreaProfileContainer` keep only metrics, and keep them small** — widget size **XS or S**. For small metrics, add an **icon** to aid quick visual recognition. Do not put large charts in the side island; place those in the content area or the Analytics tab.

## Buttons and actions

- Place page-level buttons in the upper-right page area.
- **Where to put a button (Creatio):**
  - **General / page-level actions** (apply to the whole record — e.g. save, refresh, run a process) go in the page header's **`ActionButtonsContainer`** (top-right).
  - **Context-specific actions** that act on one place — fill a field, run a calculation, generate a value — go **next to the component that shows their result**, not in the header. Put the button beside that field/widget so the cause and effect are visually connected.
- **Wrap buttons in a `crt.FlexContainer`, do not drop them directly on a grid.** Flex adapts to label length and localization (translated captions change width) and keeps button heights/alignment consistent. When a button sits next to an input (e.g. a value field + a "Calculate" button), put **both the input and the button in the same `crt.FlexContainer`** so they align and reflow together.
- Use no more than one **Primary** button in the current context. It is for the main navigation/action or active dialog action.
- Use no more than one **Secondary** button for positive confirmation in the same context.
- Use **Plain** buttons freely for secondary or neutral actions.
- If there are many rare actions, use a button with menu or an actions menu instead of a row of many buttons.
- Buttons in one group must have consistent height and alignment.
- Use an unambiguous icon that matches the action. Add tooltip/accessibility text for icon buttons.
- **Add icons where they aid recognition** — on buttons and menu items, and especially for a set of related actions or several filters: pick distinct, fitting icons (from the Freedom UI icon library) so the UI is scannable and varied, not a row of identical or icon-less items. Keep icon style consistent across the page.
- A button must be visible and active only when it can be used. Hide or disable it based on record state and user rights.
- For state-dependent workflow actions, remove actions that no longer apply, for example hide “Send for approval” once the record is already under approval.

### Button vs menu action vs checkbox

- Use a visible button for frequent actions that materially affect functionality or start a meaningful process.
- Use a menu action for rare actions that affect functionality.
- Use a logical field/checkbox for state data that does not itself execute a process.


## Long-running and destructive actions

- Warn the user before launching an action that can take a long time.
- Show execution status using a loading mask, snack-bar message, countdown, or progress/status area.
- If an operation takes more than 30 seconds or duration is unknown, prefer asynchronous execution and notify the user after completion.
- If an operation can affect system performance, recommend scheduling it outside business hours.
- For long-running external updates, show when data was last updated.
- Any destructive, irreversible, or high-impact action must be cancellable, undoable, or confirmed before execution.

## Typography and visual style

- Freedom UI font is Montserrat. Use predefined typography and colors instead of custom styles.
- Minimize the number of font styles and colors.
- Reuse template styles: Headline 1-4 for headings, Body for regular text, Caption for supporting text.
- Treat color as information coding only with text/icon/status support.
- Before requesting global font, theme, or style overrides, ask why the change is needed and how it affects system perception and consistency.

## Adding and editing data

- Prefer a mini page for creating or editing data when the task is focused, role-specific, or step-limited.
- For larger forms, put required fields on the first tab and visible screen area.
- Use logical field order based on how users fill in data.
- Use validation, input filtering, lookup filtering, default values, and auto-substitution.
- Configure fields used when copying records.
- Use placeholders for examples/format and tooltips for longer instructions (full placeholder/tooltip rules are in SKILL.md's mandatory rules).
- Do not overload create flows with information needed only later during record processing.

## Grouping and page flow

- Use field groups to divide information. Keep nesting shallow: at most 2 levels.
- Use tabs and groups for large datasets.
- **Group fields by business meaning, and never leave a single lone field as its own group, tab, or profile island.** A container (group / tab / island) should hold a logically coherent *set* of related fields — as a rule of thumb at least 2–3. If a container ends up with one field, either merge it into the related block or add the other fields that belong to that block.
- **Fill out the "main information" block.** The record's primary block (profile island + the first/general tab) must carry the core descriptive attributes a user expects for that record type, not just the `Name` — the identifying who/what/when (owner/responsible, type/status, key dates), grouped together. A near-empty main block (e.g. only `Name` in the island while everything else sits elsewhere) is an anti-pattern: move the key stable fields up into it.
- Put logically related fields next to each other (same group, adjacent rows) so the two-column layout reads as coherent pairs, not random placement.
- If the process has clear steps, show them explicitly or use a wizard to guide the user through it — don't expose the whole data model at once; reveal later fields with business rules as earlier input is filled (progressive disclosure).
- **Implementation — containers for grouping inputs (Creatio):** field groups of inputs are placed either in a **`crt.ExpansionPanel`** (a named, collapsible field group — the standard way to title and fold a set of related fields) or in a **profile island** (the side `SideAreaProfileContainer`, for key stable data). Inside either, lay the fields out with a `crt.GridContainer` (an N-column grid via `layoutConfig`, where N is the container's own column; full-width field `colSpan: N`, half-width `colSpan: N/2`) or a `crt.FlexContainer`. Note `crt.ExpansionPanel` serves double duty: it wraps a **list** to form a detail (related child-records list) *and* wraps **inputs** to form a collapsible field group — pick the children accordingly. Prefer an ExpansionPanel over a bare grid when a group of fields needs a visible title or should be collapsible.

### New island / card container — standard settings

When you add a **new island** (a `crt.GridContainer`/card-style group), apply these standard appearance settings so it matches the native look — do not leave designer defaults:

- **Column spacing:** Large
- **Row spacing:** None
- **Border radius:** Medium
- **Spacing (padding):** Top = Medium, Bottom = Medium, Left = Large, Right = Large
- **Color:** White (the card background that makes the island read as a card).

In the page body these map to container properties (confirm exact keys against an existing island via `get-page`), e.g.:

```jsonc
{
  "type": "crt.GridContainer",
  "color": "white",
  "columnSpacing": "large",
  "rowSpacing": "none",
  "borderRadius": "medium",
  "padding": { "top": "medium", "bottom": "medium", "left": "large", "right": "large" },
  "items": []
}
```

**Plain grid for inputs (NOT an island) — different settings.** When you add a bare `crt.GridContainer` only to lay out inputs *inside* an existing island/panel/tab (no card chrome of its own), use:

- **Column spacing:** Large
- **Row spacing:** None
- **Border radius:** None
- **Spacing (padding):** Top = None, Bottom = None, Left = None, Right = None
- **Color:** Transparent (it must not paint its own background — the parent island/tab shows through).

```jsonc
{
  "type": "crt.GridContainer",
  "color": "transparent",
  "columnSpacing": "large",
  "rowSpacing": "none",
  "borderRadius": "none",
  "padding": { "top": "none", "bottom": "none", "left": "none", "right": "none" },
  "items": []
}
```

Rule of thumb: the **island/card** carries the white background, radius and padding (Medium / L-R Large); an **inner layout grid** is transparent with no radius and no padding (it just arranges fields).

**Spacing must fit what the container holds:**
- **Inputs:** **no row spacing** (rows sit tight) but **keep column spacing** so the two columns don't stick together. (column spacing Large, row spacing None.)
- **Widgets / charts / metrics:** use **proportional row AND column spacing** so they have room to breathe and align evenly — don't cram them with zero gaps. Keep the row and column gaps consistent with each other and with the widgets' size.
- Eyeball the result: gaps between sibling components should look even and intentional, not random.

### Layout coordinates and container nesting (avoiding gaps)

Mechanics behind the layout rules in `SKILL.md` — read this when a page shows empty gaps or drifting fields:

- **Why a gap appears:** `layoutConfig` is relative to the immediate parent container, and rows/columns restart at `1` in each nested container. A field at `row: 3` while `row: 2` is empty reserves a blank row → vertical gap; a `column`/`colSpan` beyond the container's column count wraps to a new row and leaves a blank half.
- **Let containers size to content:** use `rows: "auto"` + `gap`; never a fixed `rows` count or an oversized `rowSpan`. One titled group = one container — stack groups with `gap`, not with empty rows.
- **Sanity-check before saving:** in each container, `row` numbers run 1..N with no skips, every `column`/`colSpan` is within that container's column count, and every field's `parentName` is its real group container.

## Fields

- Prefer two-column field layout for standard record fields.
- Use concise, clear field labels. Move explanatory text to placeholder or tooltip.
- Use dropdown lists for lookups with a small number of values.
  - **Implementation (Creatio):** dropdown-vs-selection-window is controlled at the entity-column level, not by the page component. A **simple lookup** column renders as an inline dropdown; a **standard lookup** column renders the modal selection window. Set the column's `IsSimpleLookup` flag (clio `simple-lookup: true` on a `modify`/`add` column operation) for small enum-like catalogs (status, type, category, stage, priority — typically under ~20 rows). Keep standard lookups (selection window) only for large or relationship lookups such as Contact, Account, or a parent record. The page still binds the field as `crt.ComboBox` either way — do not try to fix this with a page-body property.
- Put checkboxes/logical fields after related input fields, usually at the bottom of a group or island.
- Filter lookup fields to relevant values, for example only responsible colleagues, and add a hint about the filter if needed.
- For read-only fields, add a tooltip explaining why the field is read-only and how/when it is filled or calculated.
- Order fields by task flow and requiredness. Required fields must be marked and visible early.
- **Require the real minimum only.** Mark a field required only when the record cannot be created or is meaningless without it (the genuine "minimum to create"). Do not make many fields required — extra mandatory fields block fast creation and push users to enter junk. Keep recommended-but-optional fields optional and guide them with defaults, placeholders, or business rules instead.
- Use a DCM (Dynamic Case Management) stage progress bar — component `crt.EntityStageProgressBar` — for statuses, stages, and ordered process state instead of a loose status combo box. ("DCM" / "progress bar" both refer to this stepped stage indicator.)
- For information easier scanned visually than read as fields, use widgets (see *Analytics and metric widgets*).

## List (section) page layout

The sections above describe the record/form page. A **section (list) page** uses its own container slots — put things in the right one instead of dropping them loose on the page:

- **Additional / custom filters** go in **`LeftFilterContainer`** or **`RightFilterContainer`** (the filter zones beside the standard search/quick filter), not inline in the grid area.
- **Additional list actions / buttons** go in **`ActionButtonsContainer`** (top-right), same as on the record page.
- **Analytics, metrics, and dashboards** go into the **Dashboard component (`crt.Dashboards`)**. If you are not sure how to configure the Dashboard component, place them in **`DashboardsTabContainer`** (the list page's analytics/dashboards tab container) instead — do not scatter widgets into the grid or filter areas.

## Dialogs and modals

- Dialogs should follow the same styling as Creatio mini pages where possible: predictable title placement, button placement, and visual hierarchy.
- Put explanatory text before the fields/buttons that depend on it. Users read from top to bottom.
- Use consistent action labels such as “Save,” “Cancel,” or domain-specific result verbs.
- Use Plain style for neutral close/cancel actions when appropriate.
- Dialog errors must explain what the user can do next; avoid admin-only technical text for regular users.

## Common anti-patterns to flag in reviews

- Missing section icon.
- Primary display column not configured.
- Required fields placed low on the page or hidden in later tabs.
- Header overloaded with many fields.
- Fields not grouped or grouped inconsistently.
- A single lone field as its own group, tab, or profile island (instead of merging it or adding the related fields of that block).
- Two `crt.ExpansionPanel`s placed side by side / in two columns (panels are full width and stack vertically only).
- Left profile/island too long or too empty.
- Important data does not fit in profile island or header.
- Different languages mixed in one page.
- Abbreviations without tooltips, for example cryptic “F №” or “Op №.”
- Units/formats not explained, for example retention term without days/months/years.
- Multiple blue/primary buttons competing for attention.
- Buttons not aligned with fields or each other.
- Buttons placed in a long row instead of a menu.
- Custom controls that look unlike analogous Creatio functionality.
- Checkboxes placed before relevant fields or in visually dominant areas.
- Too many fonts, custom colors, or high-contrast text used as decoration.
- Long pages with tabs far below the fold.
- Empty space under an island while header or central area is overloaded.
- Dialogs with inconsistent button labels, unclear problem explanation, or text placed below buttons.

## Default Freedom UI behaviors that silently violate the guidelines

Platform defaults that look fine in the designer but break the rules above at runtime. Quick scan list — full guidance is in the topical sections referenced:

- Few-value lookup opens a selection window → make it a simple lookup (dropdown). [Fields]
- `Date` field shows a time component → use a date-only column. [Fields / data entry]
- Multi-word captions come out Title Case → set Sentence case. [Text, labels, and messages]
- Read-only/calculated and other non-obvious fields ship with no tooltip/placeholder → add guidance. [Fields]
- Ordered status defaults to a combo box → use a DCM stage progress bar (`crt.EntityStageProgressBar`). [Fields]
- New side island holds only `Name` → add the key stable fields. [Grouping and page flow]

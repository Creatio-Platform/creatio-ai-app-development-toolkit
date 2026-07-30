# Page layout and control guidelines

Use these rules for Creatio Freedom UI page creation and UI/UX review.

## Choosing the component (source of truth)

This guide refers to components by conceptual UX terms (profile island, field group, detail list, lookup, metric widget, …). Do NOT author the concrete `crt.*` names from memory or from a static list — they drift between versions and a wrong/renamed type fails to render at runtime. Resolve every concept → component with `get-component-info` against the target environment, which is authoritative and version-scoped:

- **Browse** the full catalog: `get-component-info` (list mode) — returns every component type with a description and, in detail mode, `whenToUse` / `whenNotToUse` / `synonyms` / `useCases` to choose between visually similar components.
- **Find** by concept/keyword: `search='tab' | 'lookup' | 'chart' | 'profile' | 'list' …`.
- **Pre-built combinations** — e.g. "Expanded list" (detail/related child list), "Attachments", "Next steps", "Communication options", "Approval list" — are **composites**, not single types. Get the assembly recipe with `composite='<caption>'` and never hand-build a composite from raw component types.

Scope the catalog to the target platform version by passing `environment-name`; if the version cannot be resolved (`requiresVersionConfirmation`), tell the user the version is unknown and confirm before building.

## Quick index

Jump to the section you need:

- **Component names** → "Choosing the component (source of truth)" (above) — resolve via `get-component-info`.
- **Record/form page** → General product fit · Text, labels, and messages · Page composition · Analytics and metric widgets · Buttons and actions · Grouping and page flow (incl. *Layout coordinates and container nesting*) · Fields.
- **List/section page** → List (section) page layout.
- **Dialogs** → Dialogs and modals.
- **Review** → Default Freedom UI behaviors that silently violate the guidelines (below). The full audit checklist (anti-patterns folded in) lives in `./review-checklists.md`.

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
- **Introduce a non-obvious section or tab with one short helper line under its heading.** Where a section's purpose isn't clear from its title (a rules area, a conditions list, a config step), add one sentence beneath the heading saying what it does and how it's used, in muted body text, before the controls. One line, authored as a localizable string. Skip it on self-explanatory sections.

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
- **Balance the page — the left and right areas must be proportional in length.** The whole page should read as two columns of comparable height, not a tall content area beside a short, half-empty left column. The left/profile column must be filled down to **at least the end of the page's content** (roughly level with the bottom of the right area), not stop a couple of fields in.
- **Fill the left/profile column — don't leave it near-empty, and don't stop at "a field or two".** The record-page template ships with a single left island. If the object has many columns, the left side will look empty next to the content area — add a **second (and, if needed, third) left island** below the first, with the **same settings as the existing one** (see *New island / card container — standard settings*), and distribute key stable fields (and/or small metrics) into them so the left column reaches the length of the right. **Adding just one or two fields to the left island is NOT enough** when the right area is long: keep grouping related stable attributes into left islands until the left column is genuinely proportional to the right, not merely "no longer blank". Judge this against the *rendered* page height, not the schema — an island that looks fine in the designer can still leave the left column short at runtime.
- **The left column can be a stack of compact single-value status islands.** When a record's key state is a few independent indicators (lifecycle mode, matching count, last refresh, usage), use several small islands — each one metric/status with a supporting icon and, where relevant, a state badge — stacked vertically, rather than one island crammed with unlabeled numbers. One idea per island.
- Avoid mixing one-column and two-column fields inside the same group unless it intentionally improves reading flow.
- **Reference information or tools that accompany a record or page belong in a contextual side panel, not the page body or a modal.** When a page needs supporting context or controls alongside its main content (e.g. a customer summary while handling a case, or managing connected accounts beside a dashboard), use a right-docked panel the user opens from the header and can close — not extra fields inline, not a blocking modal. Reuse the platform's ready panels (attachments, communication) where they exist instead of rebuilding them.
- **A content/article page uses a full-width reading column, not the record field grid.** For long-form textual content (knowledge-base article, note, digest), lay the body out as one full-width rich-text column with a short meta/byline row above it (type, last updated, author) — not the two-column field grid and not side profile islands, which are for structured data entry. Keep a comfortable reading measure and use the predefined typography presets.

## Analytics and metric widgets

- A page can host analytic widgets — `crt.IndicatorWidget` (single metric/count), `crt.GaugeWidget` (value on a scale), `crt.ChartWidget` (charts), `crt.ListWidget` (embedded list).
- **Place widgets at the top, where they are seen first:** at the top of the **`SideAreaProfileContainer`** (or its template analog), or as the **first elements of the relevant tab**.
- **If there is a lot of analytics, create a dedicated "Analytics" tab** instead of crowding the main/general tab.
- **In `SideAreaProfileContainer` keep only metrics, and keep them small** — widget size **XS or S**. For small metrics, add an **icon** to aid quick visual recognition. Do not put large charts in the side island; place those in the content area or the Analytics tab.
- **A compact summary/relations widget may sit inline as the first cell of the content field grid.** On an information tab you can place a small widget (e.g. a related-records counter) at `column: 1` of the first field band and let the fields flow into the remaining columns beside it, instead of giving it its own full-width row. Keep it XS/S so it reads as one grid cell, and keep the remaining columns' `colSpan` math correct.

## Buttons and actions

- Place page-level buttons in the upper-right page area.
- **Where to put a button (Creatio):**
  - **General / page-level actions** (apply to the whole record — e.g. save, refresh, run a process) go in the page header's **`ActionButtonsContainer`** (top-right).
  - **Context-specific actions** that act on one place — fill a field, run a calculation, generate a value — go **next to the component that shows their result**, not in the header. Put the button beside that field/widget so the cause and effect are visually connected.
  - **Actions that operate on the record a profile/summary island represents** (e.g. Escalate, Assign to me on a case profile) go **inside that island, below its fields**, in a `crt.FlexContainer` — not in the page header — so a state-changing action sits next to the state it reads. Keep to a couple; move the rest into a menu.
- **Wrap buttons in a `crt.FlexContainer`, do not drop them directly on a grid.** Flex adapts to label length and localization (translated captions change width) and keeps button heights/alignment consistent. When a button sits next to an input (e.g. a value field + a "Calculate" button), put **both the input and the button in the same `crt.FlexContainer`** so they align and reflow together.
- Use no more than one **Primary** button in the current context. It is for the main navigation/action or active dialog action.
- **The single primary may be semantically colored for a launch/activate step.** Blue is the default primary. A launch/activate/positive-commit action that starts a process (e.g. Start a bulk send, Activate) may use a green primary to signal "go". This is still one primary per context, not a second one; the meaning must be carried by the label (`Start`), never by color alone; and no other button colors are introduced ad hoc. Ordinary Save/Apply stays the default primary.
- Use no more than one **Secondary** button for positive confirmation in the same context.
- Use **Plain** buttons freely for secondary or neutral actions.
- If there are many rare actions, use a button with menu or an actions menu instead of a row of many buttons.
- **Use a split button for one primary action that has close variants.** When an action has a main form plus a few variants (Save / Save and new / Save and close), use a split button — the primary action on the button, its variants in the attached dropdown — instead of separate buttons or a plain menu. It still counts as the single primary for the context.
- **To print reports, add the dedicated Print button — don't hand-build a report button or menu.** Creatio's standard **Print** action builds its own dropdown from the reports/printables registered for the page's object and keeps that menu in sync as reports are added. Add that button rather than a custom button or a hand-assembled report list, which would duplicate the platform behavior and drift out of date. Resolve it via `get-component-info` (it is a built-in action, not a plain button).
- Buttons in one group must have consistent height and alignment.
- Use an unambiguous icon that matches the action. Add tooltip/accessibility text for icon buttons.
- **Add icons where they aid recognition** — on buttons and menu items, and especially for a set of related actions or several filters: pick distinct, fitting icons (from the Freedom UI icon library) so the UI is scannable and varied, not a row of identical or icon-less items. Keep icon style consistent across the page.
- **Quick filters on the same page MUST each have a different icon.** When a page shows several quick filters, every filter needs its own distinct, meaning-fitting icon — never repeat the same icon across two filters and never leave several filters sharing one generic icon. Identical icons make the filters indistinguishable and defeat the purpose of the icon; pick a unique icon per filter (consistent in style with the rest of the page).
- A button must be visible and active only when it can be used. Hide or disable it based on record state and user rights.
- For state-dependent workflow actions, remove actions that no longer apply, for example hide “Send for approval” once the record is already under approval.

### Button vs menu action vs checkbox

- Use a visible button for frequent actions that materially affect functionality or start a meaningful process.
- Use a menu action for rare actions that affect functionality.
- Use a logical field/checkbox for state data that does not itself execute a process.
- **Toggle switch vs checkbox.** Use a toggle for a setting/mode that takes effect as configuration (e.g. Commit to forecast, Use contact's timezone, Throttling) — an on/off state the user is tuning. Use a checkbox for a plain boolean attribute captured with the record's other data. Resolve the concrete component via `get-component-info`; don't swap one for the other to restyle.
- **Offer a meaningful either/or choice as selectable cards, not a bare dropdown.** When the user must pick between 2–3 consequential options (e.g. send manually vs via campaign flow; send now vs schedule vs smart-send), render them as selectable cards — icon, short title, one-line consequence — with a single selection. Reserve this for choices that change what happens next; an ordinary value pick stays a dropdown. Resolve the component with `get-component-info`.


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
- **Group fields into meaningful blocks — a group of just 1–2 fields is a poor grouping, not only a single lone field.** A container (group / tab / island) should hold a logically coherent *block* of related fields — as a rule of thumb at least 3–4, not one or two. A group with a single field is always wrong (merge it or add the fields that belong to that block); a group with only two fields is a warning sign — combine it with a related group or pull in the other attributes of that business block so it reads as a real block, not a stub. Sparse 1–2-field groups make the page look thin and unbalanced; grouping fields into fuller blocks is also what keeps the page proportional (see *Balance the page* above). Never split what is one business block into several tiny groups just to "have groups".
- **Fill out the "main information" block.** The record's primary block (profile island + the first/general tab) must carry the core descriptive attributes a user expects for that record type, not just the `Name` — the identifying who/what/when (owner/responsible, type/status, key dates), grouped together. A near-empty main block (e.g. only `Name` in the island while everything else sits elsewhere) is an anti-pattern: move the key stable fields up into it.
- Put logically related fields next to each other (same group, adjacent rows) so the two-column layout reads as coherent pairs, not random placement.
- If the process has clear steps, show them explicitly or use a wizard to guide the user through it — don't expose the whole data model at once; reveal later fields with business rules as earlier input is filled (progressive disclosure).
- **Implementation — containers for grouping inputs (Creatio):** field groups of inputs are placed either in a **`crt.ExpansionPanel`** (a named, collapsible field group — the standard way to title and fold a set of related fields) or in a **profile island** (the side `SideAreaProfileContainer`, for key stable data). Inside either, lay the fields out with a `crt.GridContainer` (an N-column grid via `layoutConfig`, where N is the container's own column; full-width field `colSpan: N`, half-width `colSpan: N/2`) or a `crt.FlexContainer`. Note `crt.ExpansionPanel` serves double duty: it wraps a **list** to form a detail (related child-records list) *and* wraps **inputs** to form a collapsible field group — pick the children accordingly. Prefer an ExpansionPanel over a bare grid when a group of fields needs a visible title or should be collapsible.
- **Choose Flex vs Grid by whether the content changes at runtime.** A `crt.GridContainer` pins each item to fixed `row`/`column` coordinates, so when an item is **hidden** (a field toggled off by a business rule) or **shrinks** (a `crt.ExpansionPanel` collapsing), its slot stays reserved → an empty gap. A `crt.FlexContainer` has no fixed slots: siblings pull up/together to fill the freed space, so the layout adapts. Therefore:
  - If any field in a group can be **conditionally hidden/shown** (business rule), place that group's fields in a **flex**, so hiding a field leaves no empty slot.
  - Stack **collapsible panels** (`crt.ExpansionPanel`) and whatever follows them in a **flex**, so the page reflows and lower components pull up when a panel collapses.
  - This is also why buttons go in a flex (they resize to their label) — see *Buttons and actions*.
  - Use a **grid** only for **static, always-present** field layouts where the set of visible items and their coordinates don't change at runtime.
- **A read-only detail must have inline editing turned OFF on its List, not just its add button hidden.** Making a detail (child list) non-editable takes TWO changes: hide/remove the add (`+`) button AND clear the inline-editing flag on the List component itself. Hiding only the add button still leaves existing rows editable in place (and often a new-row affordance), so the detail is not actually read-only. Turn the List's inline-edit setting off as well; resolve the exact property via `get-component-info` for the list/detail component.

### New island / card container — standard settings

When you add a **new island** (a `crt.GridContainer`/card-style group), apply these standard appearance settings so it matches the native look — do not leave designer defaults:

- **Column spacing:** Large
- **Row spacing:** None
- **Border radius:** Medium
- **Spacing (padding):** Top = Medium, Bottom = Medium, Left = Large, Right = Large
- **Color:** White (the card background that makes the island read as a card).

Resolve the real container property keys, value enums, and defaults from `get-component-info crt.GridContainer` — do not author them from memory. Note the Designer "Column spacing"/"Row spacing" settings are the per-axis `gap.columnGap`/`gap.rowGap` object (there are no `columnSpacing`/`rowSpacing` properties); the card look is `color`, `borderRadius`, and the per-side `padding` object.

**Plain grid for inputs (NOT an island) — different settings.** When you add a bare `crt.GridContainer` only to lay out inputs *inside* an existing island/panel/tab (no card chrome of its own), use:

- **Column spacing:** Large
- **Row spacing:** None
- **Border radius:** None
- **Spacing (padding):** Top = None, Bottom = None, Left = None, Right = None
- **Color:** Transparent (it must not paint its own background — the parent island/tab shows through).

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
- **Pick the guidance channel deliberately: placeholder, tooltip, or an always-visible description line.** Besides placeholder (example/format inside the input) and tooltip (on-demand detail behind an `i` icon), a field may carry a permanent one-line description in muted caption text under it. Use the description line only for standing guidance the user must see every time (e.g. a sending-domain caveat); a tooltip when it's needed only sometimes; a placeholder for format. Don't stack all three on one field; author every variant as a localizable string.
- **An empty optional field should read as an actionable invitation, not a blank.** For fields left empty on a saved record, phrase the placeholder as a call to action naming what to add (e.g. `Add revenue`, `Add primary contact`) so the empty state guides the user. This is the authored placeholder only — a list/detail's empty state (`No data`) is rendered by the component.
- Order fields by task flow and requiredness. Required fields must be marked and visible early.
- **Require the real minimum only.** Mark a field required only when the record cannot be created or is meaningless without it (the genuine "minimum to create"). Do not make many fields required — extra mandatory fields block fast creation and push users to enter junk. Keep recommended-but-optional fields optional and guide them with defaults, placeholders, or business rules instead.
- Use a DCM (Dynamic Case Management) stage progress bar — component `crt.EntityStageProgressBar` — for statuses, stages, and ordered process state instead of a loose status combo box. ("DCM" / "progress bar" both refer to this stepped stage indicator.)
- For information easier scanned visually than read as fields, use widgets (see *Analytics and metric widgets*).
- **Use a slider for a bounded numeric the user sets by feel.** For a value on a known scale the user estimates rather than types precisely (e.g. Confidence level 0–100), use a slider showing the range endpoints; keep an exact-entry numeric input for values that must be typed. Resolve the component via `get-component-info`.
- **Auto-compose the primary display name from the record's key fields.** Where a readable title can be derived (e.g. `<Need> / <Contact>, <Account>` for an opportunity), fill the primary display field automatically from those fields (calculated value / business rule) so the user isn't asked to hand-write it, and keep it editable. State the source in a tooltip per the read-only/derived-field rule.

## List (section) page layout

The sections above describe the record/form page. A **section (list) page** uses its own container slots — put things in the right one instead of dropping them loose on the page:

- **Additional / custom filters** go in **`LeftFilterContainer`** or **`RightFilterContainer`** (the filter zones beside the standard search/quick filter), not inline in the grid area.
- **Additional list actions / buttons** go in **`ActionButtonsContainer`** (top-right), same as on the record page.
- **Analytics, metrics, and dashboards** go into the **Dashboard component (`crt.Dashboards`)**. If you are not sure how to configure the Dashboard component, place them in **`DashboardsTabContainer`** (the list page's analytics/dashboards tab container) instead — do not scatter widgets into the grid or filter areas.

## Dialogs and modals

- Dialogs should follow the same styling as Creatio mini pages where possible: predictable title placement, button placement, and visual hierarchy.
- **Collect a focused set of action parameters in a modal, not a full page.** When an operation needs the user to supply a small, self-contained set of inputs before it runs — configuring a test send, closing an opportunity (loss reason + details), qualifying a lead into the next stage — gather them in a modal dialog asking for exactly those fields and no more: required ones marked, the explanation/instructions above the inputs, one primary confirm action. Don't route the user to the full edit page for a handful of parameters, and don't ask for data the operation doesn't need.
- **Field labels on modals must use `labelPosition: "above"`.** On a modal/dialog page, every field label sits above its input — the narrow modal width leaves no room for a `left` label column, which would squeeze the input and break alignment. The ONLY exception is a genuinely wide modal — page size **L or XL** — where a `left` label position may be acceptable if it reads cleanly; on S/M modals always use `above`. Keep the position consistent across the whole dialog (don't mix `above` and `left`).
- Put explanatory text before the fields/buttons that depend on it. Users read from top to bottom.
- **Text-heavy modals must be structured, not a wall of text.** When a dialog carries a lot of explanatory copy, lay it out with clear typography, spacing, and hierarchy instead of dumping dense paragraphs:
  - **The modal shell is template-provided — don't hand-build or restyle it.** The dialog title, the close (`×`) icon, the actions/buttons row, and the outer dialog padding come from the modal template. Do not set their typography, spacing, or button styles by hand — configure only the **content area** (your fields, their descriptions, tooltips). Match whatever the template already renders.
  - **Typography — set it with the label's `labelType` preset, never hardcoded px.** `crt.Label` typography is a preset (`labelType`); do NOT set `labelFontSize`/`labelLineHeight`/`labelStyle` by hand — raw values fight the preset and break theme switching (a documented pitfall). Map each role to a preset and keep it consistent:
    - Section subheading you add yourself → a heading preset, e.g. `labelType: "headline-3"` (design reference ≈ 18/24) — never fake a heading with bold body text or an odd custom size.
    - Explanatory / description copy → `labelType: "body"` (≈ 13/20) in a **muted/secondary** text color via the `labelColor` **theme token** (design reference `#757575`; do not hardcode the hex), so the description reads as subordinate to its control.
    - Secondary hints → `labelType: "caption"` (≈ 12/16), also muted.
    - Set weight with `labelThickness`, not custom CSS. (Button-label typography is intentionally not specified — it belongs to the template.)
  - **Spacing — use the container's `gap`/`padding` SizeEnum keywords, not raw pixels.** Lay the content out in `crt.FlexContainer`/`crt.GridContainer` and set spacing through `gap` (grid: the `{ columnGap, rowGap }` object; flex: a single keyword) and per-side `padding` — always **`SizeEnum` keywords** (`none`/`small`/`medium`/`large`/…) so they track theme tokens rather than drifting from them. Concretely:
    - Keep each control together with its own description in a **column** flex with a **small** gap, so the description sits tight under its control (design reference ≈ 8px).
    - Separate one control-block from the next with a **larger** gap — e.g. `medium`/`large` (design reference ≈ 16px) — so blocks read as distinct.
    - The pixel figures are the **design intent to eyeball against**, not values to hardcode — the actual property value is the `SizeEnum` keyword.
    - Never let a paragraph run straight into the next block/heading with no separating gap (the bad example crams the helper paragraph into the "Diagnostics & maintenance" section). Align everything to one left edge; don't push actions/links to a cramped right margin misaligned with the text.
  - **Move long or conditional explanations into a tooltip, not inline.** A long "why is this disabled / why can't I do this" message, or extra detail a user needs only sometimes, belongs in a **tooltip (`i` icon) next to the control** — with a link to the instruction if relevant — not as a permanent inline block of text. Keep the always-visible copy short; let the tooltip carry the depth. (See the good "Calendar settings" example: the unavailable option explains itself via an `i` tooltip with an instruction link, while the visible description stays one short line.)
  - If the content is genuinely large and cannot be reduced, reconsider whether a modal is the right container at all — a full page may fit better than an overflowing dialog.
- Use consistent action labels such as “Save,” “Cancel,” or domain-specific result verbs.
- Use Plain style for neutral close/cancel actions when appropriate.
- Dialog errors must explain what the user can do next; avoid admin-only technical text for regular users.

## Default Freedom UI behaviors that silently violate the guidelines

Platform defaults that look fine in the designer but break the rules above at runtime. Quick scan list — full guidance is in the topical sections referenced:

- Few-value lookup opens a selection window → make it a simple lookup (dropdown). [Fields]
- `Date` field shows a time component → use a date-only column. [Fields / data entry]
- Multi-word captions come out Title Case → set Sentence case. [Text, labels, and messages]
- Read-only/calculated and other non-obvious fields ship with no tooltip/placeholder → add guidance. [Fields]
- Ordered status defaults to a combo box → use a DCM stage progress bar (`crt.EntityStageProgressBar`). [Fields]
- New side island holds only `Name` → add the key stable fields. [Grouping and page flow]
- Detail's add button hidden but rows still edit inline → also turn off inline editing on the List. [Grouping and page flow]

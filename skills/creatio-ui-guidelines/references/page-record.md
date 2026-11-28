# Record page

Use this reference for what goes where on a record page: template, islands, balance, groups and the companions some fields need. Read it whole when you build or review a record page; components and grid mechanics are in `layout-mechanics.md`, single elements in the `block-*.md` files. Where a rule's strength is not obvious, its lead sentence names it: **pass/fail**, **default** or **heuristic** (`SKILL.md`, *When rules collide*).

## Page composition

- Use ready page templates; they carry standard spacing and alignment. Keep the spacing around headers and the gaps between containers consistent.
- Put controls in proper containers, not loose on a grid where alignment breaks (buttons: *Button placement* in `block-actions.md`).
- **A dense or overloaded layout is a fix or a question for the user, never an optional refinement.** Before calling a page done, reread the rendered page against *Balance the page*, the spacing in *New island / card container — standard settings* in `layout-mechanics.md` and *Field groups*. How dense the page should be: `design-judgement.md`, *How dense*.

### Choosing the page template (before you create the page)

The template decides which slots exist and where. It is fixed at `create-page` and cannot be swapped afterwards; changing it means a new page and a re-authored body. So derive the template from the intended composition before `create-page` (pass/fail).

- **Choose from `list-page-templates` on the target environment.** Template names are version- and environment-specific; do not author one from memory or assume the default form page.
- **A record with stages needs the template that ships the stage progress bar (DCM).** Create it from that template so the bar sits in its native slot; hand-placing a bar into a default page rebuilds a template slot and drifts from the native look. On a recent build it is `PageWithTabsAndProgressBarTemplate` ("Tabbed Page with Progress Bar"); look up the exact name on the stand, and confirm with the developer when several look similar.
- The template also decides header above tabs vs a side profile (*Balance the page*), record vs list vs dashboard page, and the mini-page template for quick add.
- **Scaffolded pages are fixed to their template too.** `create-app-section` and `create-app` generate list and form pages on a default template. When the record needs another one, decide it at planning time: create the record page with `create-page` on the right template and register it as the section's page, or recreate the scaffolded page on it.
- If the page already exists on the wrong template, say so and offer the recreate path with its cost (new page, body re-authored, add and edit registrations updated) instead of silently patching it.

### Island structure

- On a complex record page, prefer islands: record header; profile island for key stable data; metrics, widgets and charts; related record profiles; progress bar; tabs and toggle panels for secondary information.
- **Avoid long, unstructured record pages.** When reaching an area takes more than about two screens of scrolling, split the information into tabs and groups so the user reaches it in one click.
- Avoid mixing one-column and two-column fields in one group unless it improves reading flow.

### Balance the page

**The left and right areas are proportional in length (default, checked on the rendered page).** Test with the first tab open: the left column ends roughly level with the bottom of the right area's content; it fails when it ends above the right area's middle. Judge the rendered height, not the schema.

- **Fill the left column with more islands, not one or two extra fields.** The record template ships one left island. When the right area is long, add a second (and if needed a third) left island below it with the same settings (*New island / card container — standard settings* in `layout-mechanics.md`) and distribute key stable fields into them until the test passes.
- **Fill it only with what the user needs on this page:** key stable fields, a related-record profile, a metric that answers the page's question. Every block passes the subtract check: remove it; is anything lost? Decorative widgets, a metric that repeats a field and placeholder groups fail it.
- **Small single-value status islands may stack in the left column**: one metric or status per island, with an icon and, where relevant, a state badge, rather than one island of unlabeled numbers.
- **Collapse the side when there is little to show.** When the object has only one or two key fields, or nothing passes the subtract check, the template is wrong, not the column: move the fields into a group or use a template without a side profile (resolved with `list-page-templates`).

### Contextual side panel

**Reference information or tools that accompany a record go in a contextual side panel, not in the page body or a modal (default).** Use a right-docked panel the user opens from the header and can close (a customer summary while handling a case). Reuse the platform's ready panels (attachments, communication) instead of rebuilding them.

### Article page

**A content page uses a full-width reading column, not the record field grid (default).** Long-form text (knowledge-base article, note, digest) is one full-width rich-text column with a short meta row above it (type, last updated, author), in the predefined typography presets; no side profile islands.

## Grouping and page flow

- Use field groups to divide information, nested at most two levels; tabs and groups for large datasets.
- Put related fields next to each other (same group, adjacent rows), so the two columns read as pairs.
- A process with clear steps gets a stepper (*Step-by-step page (stepper)* in `page-step-by-step.md`) or business rules that reveal later fields as earlier ones are filled.

### Field groups

- **A group is a meaningful block (heuristic, except the single-field case).** A group, tab or island holds a coherent block of related fields; three or four fields is a signal to check against the page's question, not a quota (`design-judgement.md`, *Design principles*, "Rules are not counts"). A group with one data-entry field is a defect: merge it or add the fields of its block. A two-field group is a warning sign: combine it with a related group or pull in the rest of the block. Never split one business block into tiny groups.
- **Fill out the main information block.** The profile island plus the first tab carry the core attributes a user expects for the record type: owner, type or status, key dates, not `Name` alone.

## Field-driven companions

Some fields imply a component beside them. A deadline's timer and a business contact's profile are part of "the field is done" (default): without them the user does date math or navigation the page should do. An amount's analytics depends on the page's question (heuristic). Resolve each with `get-component-info` (`search='indicator' | 'gauge' | 'chart' | 'timer' | 'profile'`, `composite=` for ready combinations).

### An amount field gets analytics when the page asks a question about it

- **Applies to** any money or quantity field (total, amount, price, cost, budget, revenue, hours, quantity), entered or calculated, on a record or section page.
- **First name the question** the user brings to the page about the value: within the limit? how much paid and how much remains? plan vs actual? Add a metric only to answer such a question, and name it in the plan. With no such question (a line amount on an add mini page, a price the user only reads), the field stays alone.
- **The metric says something the field does not:** a rollup across child records, paid vs remaining, plan vs actual, an average per unit or period, a share of a larger total, a count with its sum for a related list.
- **Placement:** *Charts and metric tiles* in `block-widgets.md`. A calculated amount also gets the read-only tooltip (*Field guidance* in `block-fields.md`). An amount that belongs to a set of records also gets its aggregate on the section page's Dashboard component, where users compare records.
- Anti-patterns: a page that exists to judge an amount (a budget, an invoice against its limit) with no rollup, comparison or trend; a metric repeating the field's value; a metric on a page that asks no question about the amount; a wall of icon-less amount widgets at zero spacing.

### A deadline field gets a timer beside it

- **Applies to** a point in time the user must act before within the page's working horizon: due date, expiry, valid-until, SLA response or solution time, next inspection, expected close date. A far date months away (a project's planned end) is not one: show it as a metric (*Days until planned end*) when the page's question needs it, or leave it alone.
- **Add a timer next to the date**, in the same island or group on its own row under it, aligned per *Component alignment* in `layout-mechanics.md`, bound to the date column, so the user reads time left or overdue at a glance. Keep the date visible: the timer complements it.
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

## Traps

- A new side island holds only `Name` → *Field groups*.

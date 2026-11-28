# Design judgement

Use this reference to decide what a Freedom UI page is for, what goes on it first, how dense it is, and which Creatio page kind, template and container carry each part — before `list-page-templates`, `create-page` or `update-page` — and what to do when a request conflicts with a written rule. The other references say how to place a component correctly; this one says which, where and why. Every answer maps to a real Creatio construct (`get-component-info`, `list-page-templates`); where a pattern has no Creatio equivalent, this file says so — never invent a component to fill the gap.

## Contents

- Where this reference sits
- Before choosing a template
- Design principles
- Two options for a complex page
- Decision trees
  - Which page shape
  - Where information goes
  - Which container
  - How dense
  - Table, list or cards
  - Which chart
  - Colour or not
  - Confirm, undo or neither
  - Tabs, sections or separate pages
  - Filter, search or both
- The consistency guard

## Where this reference sits

- **Design the real page, not a mock.** Its parts are the components `get-component-info` returns for the target environment, on a template `list-page-templates` returns.
- **Write no numbers into design decisions** — no hex, pixel or type sizes. Colour and typography come from the theme and the components' native inputs, spacing from the template and *New island / card container — standard settings* in `page-layout-and-controls.md`; custom CSS follows *Custom CSS* there. Only WCAG minimums (*Contrast rules* in `accessibility-and-colors.md`) and facts measured on native Creatio, stated as observations, are allowed.
- **A decision the target version cannot express is written down, not approximated.** A worklist's sort order may have no native setting: state it in the handoff or audit as not implemented, never stand in a component that means something else.

## Before choosing a template

The template is fixed at `create-page` (*Choosing the page template (before you create the page)* in `page-layout-and-controls.md`), so answer these questions first; if you cannot, you are not ready to pick one.

### State the page's one question

Write it in one sentence before choosing anything: "Which cases are about to breach their SLA." "Is this purchase request safe to approve." A page that answers nothing in particular shows everything with equal weight, and correct components do not fix that. If the page is reference material that supports no decision, say so; that is a valid answer, and it changes the layout.

### Who uses it, how often, at what data volume

- **Who** is a role with a job (a service team lead, an accounts payable clerk), never "the user". Two roles can need opposite pages from the same data: a manager checking the quarter reads a shape in neutral metrics; a rep looking for who to call today needs the items behind target coloured and sorted by urgency.
- **What they came to do**: decide something, work a queue down, or check that nothing is wrong — three different pages from one object.
- **How often.** Several times a day: density helps and every extra click is paid hundreds of times. Weekly: the layout is relearnable at a glance. Rarely: guide explicitly — helper lines, placeholders, a stepper a daily user would find patronising.
- **How much data** a list or related list will really hold, not the demo data. A handful shows as fields or a short related list; tens need sorting; hundreds and more need search, quick filters, folders and a starting view that is not all records (*Table, list or cards* and *Filter, search or both* below).

### Sort fields into critical, secondary and contextual

Rank every field before laying anything out; if everything is critical, nothing is.

- **Critical** fields are needed to answer the page's question. They go where the eye lands first: the header, the profile island, the first fields of the first tab. A critical bucket past a handful means the page is probably doing two jobs; split the jobs before splitting the fields.
- **Secondary** fields are needed often but not to decide: on the surface and quieter, in the first tab's groups below the critical block.
- **Contextual** fields are needed occasionally, by some people: behind one gesture — a collapsed expansion panel, a later tab, a tooltip, or the related record's own page.

Group by task, not by data model: fields read in the same moment share a group, a value sits with the action it provokes, things compared sit side by side (*Field groups* in `page-layout-and-controls.md`). A case page grouped *Case · Contact · Account · SLA · Activities* mirrors the schema; the same fields grouped *What happened · Who is affected and what they are entitled to · What we have done · What happens next* serve the person resolving it.

### Name the kind: monitor, worklist or report

Not a page kind: it tells you which page kind to pick and how to fill it.

| | Monitor | Worklist | Report |
|---|---|---|---|
| Opened | All day | While there is work | Once, then discussed |
| The user wants | To know nothing is wrong | The next thing to do | To understand why |
| Colour goes | Only on news; often nowhere | On the item to work | On the comparison |
| A good day looks like | Nothing stands out | A short list | A clear shape |
| Usual Creatio form | Dashboard page or component, home page | Section list page with a starting view and default sort; a list widget | Analytics tab or dashboard; a printable report |

The kind also changes a record page: one opened from a worklist needs its next action and deadline (with the timer from *Field-driven companions* in `page-layout-and-controls.md`) above everything else; one opened to monitor needs its state readable without scrolling.

### When you cannot ask

Ask when someone can answer. When nobody can, write the assumption in the proposal or the handoff ("built for a service lead checking the queue twice a day, around two hundred open cases"), design for the realistic middle, and name what changes if it is wrong. An assumption written down is a decision; one left implicit is a defect waiting to be found.

## Design principles

These principles decide the content and emphasis of a page. They never license restyling it: the look of base Creatio stays as it is (*Match existing styles* in `page-layout-and-controls.md`).

- **The biggest block answers the question** — on a record page usually the profile island, the stage progress bar and the first tab's critical group; on a dashboard, the largest widget. If the largest block is decoration and the answer is a number in a corner, the hierarchy is wrong however correct the components are.
- **Density is a decision.** Creatio users trade whitespace for information willingly, but filling space is not a goal either: decide from the task (*How dense* below). Whatever fills a region passes the subtract check — remove it; is anything lost? A side column padded with decorative widgets to look level fails it (*Balance the page* in `page-layout-and-controls.md`).
- **Colour is meaning.** Keep the page mostly neutral and spend colour on the data — the stage progress bar, the one metric that needs action, status labels, chart series — not on chrome (*Colour or not* below).
- **Words are design.** A *Submit* button or a group titled *Other* is a defect like a misaligned column (`ux-writing.md`; *Field guidance* in `page-layout-and-controls.md`).
- **Deliberate beats consistent.** Six identical metric widgets in a row are consistent and say nothing; give the block that answers the question the weight and let the rest recede — emphasis within the platform's look, never a departure from it.
- **Rules are not counts.** A rule shaped like a count breaks on the next page, because what varied was never the quantity but what the page was for: "one filled tile in four" fails on a page where nothing needs action today. Count to learn the vocabulary; ask what the page is for to learn the grammar. A page has as many tabs, metrics or columns as its task needs, sometimes none. Phrase a rule as the question it protects: "is the left column level with the right?" survives every page, "put three islands on the left" does not; an amount gets analytics only when they answer the page's question (*Field-driven companions* in `page-layout-and-controls.md`). Rules of thumb such as group sizes are signals to check against the page's question, not quotas to fill.

## Two options for a complex page

When a page is complex — several roles, a staged lifecycle, many columns, more than one plausible template, or both data entry and monitoring — sketch two structurally different options before building, then choose one on criteria you write down.

- **Structurally different** means a different template or a different distribution: side profile with tabs against header above tabs with the stage progress bar; tabs by task against one tab of stacked expansion panels. Two colour or spacing variants are not two options.
- **Describe each option in Creatio terms** — template, header, profile column, tabs and panels, actions — and do not build both: the template is fixed at `create-page`.
- **Choose on written criteria**: which puts the answer first; which survives the real data volume and the longest realistic record; which degrades better when fields are empty; which matches the analogous base Creatio page; what each costs to change later. A layout chosen without written criteria cannot be defended or revisited.
- **With the user present, let them choose.** With nobody to ask, choose, and record the criteria, the rejected option and what would make it right in the handoff.

## Decision trees

Each tree is a quick call, and each answer maps to a Creatio construct. The component and placement rules live in the section named next to the answer — in `page-layout-and-controls.md` unless another file is named; this file does not repeat them.

### Which page shape

```
Is the person acting on MANY records of one type?
├─ yes → a queue to work DOWN in priority order?
│         ├─ yes → WORKLIST
│         └─ no  → LIST
└─ no  → is it ONE record, in depth?
          ├─ yes → moving record to record, staying oriented in the set?
          │         ├─ yes → MASTER–DETAIL
          │         └─ no  → RECORD
          └─ no  → checking the state of an area at a glance?
                    ├─ yes → DASHBOARD
                    └─ no  → sequential, rare, order-dependent task?
                              ├─ yes → STEP-BY-STEP
                              └─ no  → WORKSPACE
```

| Shape | Creatio page kind and template | Read |
|---|---|---|
| Worklist | Section list page starting on a "mine" or "open" folder or quick filter, sorted by urgency (*Worklist* in `page-patterns.md`) | *List (section) page layout* |
| List | Section list page | *List (section) page layout* |
| Record | Record (form) page on the template its composition needs | *Choosing the page template (before you create the page)*, *Page composition* |
| Master–detail | No native split page; say so and use a list page that opens record pages, or a record page with related lists | *Related lists* |
| Dashboard | Dashboard page, the section's Dashboard component, or a home or landing page | *Analytics and metric widgets*, *List (section) page layout* |
| Step-by-step | Step-by-step page with a stepper, never the stage progress bar (*Stage bar is not a stepper* in `page-patterns.md`) | *Step-by-step page (stepper)* |
| Workspace | No native multi-pane page; say so and use a record page with a contextual side panel opened from the header | *Page composition* |
| Quick add or edit | Mini page | *Adding and editing data* |

Sanity check: name the decision a dashboard supports; if people always click the same thing on it, build that thing instead.

### Where information goes

```
How often does this person need it on a NORMAL visit?
├─ every time   → header, profile island, or first group of the first tab
├─ most visits  → on the surface, quieter: a group lower in the first tab
├─ some visits  → one gesture away: a collapsed expansion panel, a contextual side panel, a tooltip
├─ rarely       → a later tab, or the related record's own page
└─ never        → ask why it is on the page; leave it off (it stays on the object)
```

Decide by frequency, not importance: importance is an argument, frequency is a fact. A panel opened on every visit was never secondary, so surface it; forty fields laid flat across a tab is not transparency, it is unsorted. Required fields go early and visible whatever this tree says (*Required fields* in `page-layout-and-controls.md`).

### Which container

```
Must it be finished before anything else can continue?
├─ yes → a small set of parameters for ONE operation?
│         ├─ yes → DIALOG (modal)
│         └─ no  → creating or editing a record with its starter fields?
│                   ├─ yes → MINI PAGE
│                   └─ no  → it is a PAGE (a form that needs its own groups is not a modal)
└─ no  → consulted WHILE working on the main content?
          ├─ yes → CONTEXTUAL SIDE PANEL (opened from the header, closable)
          └─ no  → what is it?
                    ├─ key stable identity or state of this record → PROFILE ISLAND (side column)
                    ├─ another record the user must reach          → RELATED-RECORD PROFILE ISLAND
                    ├─ metrics about this record                   → small widgets at the top of the profile island or first in the tab
                    ├─ related fields read or filled together      → FIELD GROUP in an EXPANSION PANEL (collapsed if only some visits)
                    ├─ a peer set consulted one at a time          → TAB
                    └─ a short explanation tied to one control     → TOOLTIP (Freedom UI has no general popover; do not build one)
```

Read, in `page-layout-and-controls.md`: dialog → *Dialogs and modals*; mini page → *Adding and editing data*; side panel, profile and extra left islands → *Page composition* and *New island / card container — standard settings*; related profile → *Field-driven companions*; widgets → *Analytics and metric widgets*; expansion panel and tab → *Grouping and page flow*; tooltip → *Field guidance*.

A dialog must earn blocking the page. An island is a card holding identity, metrics or a related profile; an expansion panel is a titled, collapsible, full-width group inside a tab.

### How dense

```
What is the person doing with this?
├─ scanning for anomalies (a monitor, a status list) → DENSE: more rows and columns visible beats comfort
├─ reading and understanding (a record, a report)    → COMFORTABLE: readable groups, related fields paired
└─ filling it in (a form, a mini page, a step)       → GENEROUS: errors are expensive, and crowding causes them
```

In Creatio density is set through structure, not spacing: which columns a list shows, how many fields sit on the surface or behind a panel, the container's column count, how much one step holds. Spacing comes from the template and the standard island settings, never from custom values; use a list's native density option where it has one, and do not build one where it has not. Long text goes in the reading column of *Page composition*, not across a wide grid.

### Table, list or cards

```
Do people COMPARE records across the same attributes?
├─ yes → LIST with columns (a section list or a related list). Cards cannot be compared column by column
└─ no  → is each record visual (a person with a photo, an image, a product)?
          ├─ yes → a card or tile view, only if the target catalog offers one natively; otherwise a list
          └─ no  → how many?
                    ├─ a handful → fields or a short related list without filters
                    └─ more      → LIST anyway
```

A grid of islands each holding one text-only record is a list chopped into pieces. For related lists, use the Expanded list composite (*Related lists* in `page-layout-and-controls.md`).

### Which chart

```
What is the question?
├─ "how has this changed over time?"  → LINE
├─ "how do these compare right now?"  → BAR (horizontal when the labels are long)
├─ "what is this made of?"            → two or three parts that sum to a meaningful whole?
│                                        ├─ yes → DOUGHNUT
│                                        └─ no  → STACKED BAR, or a list
├─ "where does it drop off?"          → PIPELINE / FUNNEL widget
├─ "is there a relationship?"         → SCATTER, only if the target catalog has it; otherwise a list
└─ "what is the single number?"       → an INDICATOR widget, not a chart
```

Resolve the chart, indicator, gauge, list and pipeline widgets with `get-component-info` (`search='chart' | 'indicator' | 'gauge' | 'pipeline'`). Size and place them per *Charts and metric tiles* in `page-layout-and-controls.md`. Series colours: *Recommended multi-series chart order* in `accessibility-and-colors.md`. Before adding any chart, ask whether a list widget would answer better — it is readable, sortable and accessible by default.

### Colour or not

```
Does the colour answer a question the reader is asking?
├─ "what state is this in?"       → yes: the stage progress bar or the status colour scale, always with words
├─ "can I interact with it?"      → yes: the native button and link styles, nothing custom
├─ "is this the problem?"         → yes, but only if it can be acted on NOW
├─ "which series is this?"        → yes: a chart series colour, plus a label or legend
└─ none of these                  → NO. Leave it neutral
```

Then two checks. Would it still be coloured tomorrow? A signal that never changes is wallpaper. Is the colour on the data, not on tabs, areas or headers? Status colours follow the scale in *Freedom UI color guidance*; tab and area colours need *Tab and title colors* and *Area backgrounds* (all in `accessibility-and-colors.md`); the primary button follows *Buttons and actions* in `page-layout-and-controls.md`.

### Confirm, undo or neither

```
Is it reversible?
├─ yes → NEITHER. Just do it (offer undo where the platform has one and redoing is tedious)
└─ no  → bulk, expensive, or visible outside (money, email, an external system)?
          ├─ yes → CONFIRM, stating the count and that it cannot be undone
          └─ no  → a lightweight confirmation dialog whose buttons name both outcomes
```

A confirmation on a reversible action is a tax people learn to click through — and then they click through the one that mattered. A field the user can edit back is reversible; a sent email, a started bulk process, a deleted record or a call to an external system is not. Do not build a custom undo. Rules: *Long-running and destructive actions* and *Dialogs and modals* in `page-layout-and-controls.md`; the dialog's wording: *Confirmations and destructive actions* in `ux-writing.md`.

### Tabs, sections or separate pages

```
Is the content consulted ONE SET AT A TIME, not compared across?
├─ no  → SECTIONS on one tab: stacked expansion panels
│         (things genuinely compared go side by side as fields in one group, never as side-by-side panels)
└─ yes → how many sets, and are they peers?
          ├─ two or more peers of the same record → TABS
          ├─ one is used almost every visit       → show it; the rest goes in a collapsed panel or a later tab
          └─ different objects entirely          → SEPARATE PAGES: the child's own record page,
                                                    reached from a related list
```

Do not nest a tab strip inside a tab on a page you build; use expansion panels inside the tab (a nested strip that ships with the product is not a finding). A tab that is empty on most records is a candidate for removal, not for an empty state. Panel stacking and tab placement: *Grouping and page flow* in `page-layout-and-controls.md`.

### Filter, search or both

```
How many records, and do people arrive knowing which one they want?
├─ few                        → neither
├─ tens, browsing             → QUICK FILTERS where rows differ in a way people act on
├─ any size, knows the record → SEARCH (the list page's native search)
└─ hundreds and more          → BOTH, plus sorting, folders, and a starting view that is not all records
```

Placement of custom and quick filters: *Filters and search* in `page-layout-and-controls.md`. Use only the platform's own filter behaviour; do not build a separate apply-filter mechanism.

## The consistency guard

Before changing anything, check the request against what is written. "Written" means this skill's rules (SKILL.md and its references), the conventions already on the target page (`get-page`), the base product as it renders natively, and rulings the user already made in this task. When the rendered native product and a written rule disagree, report both and say which governs this page (*When rules collide* in `SKILL.md`) — do not quote a document at someone when the product does something else.

**If the request contradicts nothing written, just do it** — no gate, no ceremony. Most requests are this.

**If it contradicts a written rule, stop.** Do not apply or refuse it silently, and never soften it into something that technically fits. Report in this shape:

1. **What it contradicts** — the rule quoted verbatim, with its location: file and section, page schema and element, or the user's earlier ruling in their own words.
2. **Why the rule exists** — the reasoning in the rule, the native page it was observed on, the earlier ruling. If it gives no reason, say so; an unsourced rule is weaker, and the user should know which kind they are overruling.
3. **The options**, stated plainly and left open:
   - **Change the rule.** For a convention of this app, the change applies everywhere it holds — list the pages and elements it touches (`get-page`) before agreeing. For a rule of this skill, note the change in the handoff for the skill's owners and follow the user's ruling on this page.
   - **One-off exception.** Apply it on this page only and record it with its reason in the worklog and the handoff or audit, so the next check reads it as a known exception, not a new defect.
   - **Withdraw.** Drop it; if it was a considered call, note it so the idea is not argued again from zero.

Then wait for the user's choice — choosing for them is the failure this guard exists for, and "do both" is not an option. When the same exception comes up a second time, say so and recommend changing the rule: either the rule is wrong, or the exception is a pattern nobody has written down.

Rules with their own confirmation flow keep it: custom CSS and restyling follow the warn-and-confirm sequence in *Custom CSS* (`page-layout-and-controls.md`); the template's irreversibility follows *Choosing the page template (before you create the page)*.

Credit: the consistency guard is adapted from design-spec-framework (github.com/denysosadchyi/design-spec-framework, MIT).

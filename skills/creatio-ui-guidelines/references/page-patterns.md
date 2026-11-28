# Page patterns

Use this reference once the kind of page is known, to build or judge it as that pattern: what question it answers, when to use it and when not, how it is built from Creatio pages, templates and components, and the traps that make a correct-looking page fail its user. Choosing the kind is in `design-judgement.md`; what goes where on a page kind in the `page-*.md` files, single elements in the `block-*.md` files and grid mechanics in `layout-mechanics.md`; native look and colour in `visual-judgement.md`; wording in `ux-writing.md` — this file links to them by section title instead of restating them. Resolve every component with `get-component-info`, every template with `list-page-templates`, and judge the result on the rendered page.

## Contents

- Before you pick a pattern
- Section list page (list report)
- Record page
- Overview, dashboard and home page
- Chart over evidence (flow dashboard)
- Worklist
- Master–detail
- Step-by-step page (wizard)
- Stage bar is not a stepper
- Workspace and multi-pane screens
- Lists and tables
- Filters, search, folders and quick filters
- Bulk operations and selection
- Forms and data entry
- Tabs
- Panels, dialogs and mini pages
- Feed and timeline
- Composing a message
- AI agents and approvals
- Settings and administration
- Patterns with no Creatio page equivalent

## Before you pick a pattern

- **Know the page's one question, its user and the kind of screen first** (*Before choosing a template* in `design-judgement.md`); the pattern follows from them (*Which page shape*). The template is fixed at `create-page`, so decide the pattern before creating the page.
- **Judge the result with questions, not counts** (*Design principles* in `design-judgement.md`): run *The five checks* in `visual-judgement.md` on the rendered page.
- **Where a pattern has no Creatio equivalent, say so** in the proposal or audit and use the nearest native shape; never invent a component to fake it (see *Patterns with no Creatio page equivalent*).

## Section list page (list report)

- **Answers:** which of many records of one object need my attention, and lets me act on them.
- **Use when** people find, compare and act on many records of one object. **Not when** one record is needed in depth (record page) or the content mixes object types (a feed).
- **Structure in Creatio:** the section's list page — title and the New action, a toolbar (folders, filters, search; summaries, view switch and list actions on the right), and one list filling the work area; slots: *List (section) page layout* in `page-list.md`. A shipped section page is a plain list or a section home of titled groups (*Overview, dashboard and home page*), never content tabs; the view switch moves between the list and its dashboards.
- **Traps:**
  - No useful starting view on a list of hundreds or more — set a default folder, quick filter or "Show closed" off.
  - Every column the object has (see *Lists and tables*).
  - Sorted by creation date or code when users scan by something else.
  - Metrics above the list that nobody acts on: a count above a list is a subset the user opens; a KPI belongs on the dashboard.

## Record page

- **Answers:** everything about one record its user needs now — identity, state, and the next decision.
- **Use when** one record is worked in depth with its related records. **Not when** the task is changing many records (list page with bulk actions) or finding an unknown record (list page with search).
- **Structure in Creatio:** a form page on the template its composition needs — side profile column, header above tabs, or the progress-bar template for a staged record. Composition and island settings: *Page composition* and *Grouping and page flow* in `page-record.md`; the native shapes and island look: *What native Creatio looks like* in `visual-judgement.md`.
- **The header carries the decision.** If the page exists to make a decision (Approve, Escalate), that decision is its most prominent control (*Header actions* in `block-actions.md`).
- **State is in the first screenful** — stage, overdue, at risk, approved — via the stage progress bar or a status in the profile island, never in a later tab.
- **Columns balance and fields get their companions:** *Balance the page* and *Field-driven companions* in `page-record.md`.
- **Traps:** fields in schema order instead of fill order; a tab strip with one meaningful tab; borders, shadows or backgrounds drawn on islands to separate them; two tabs showing the same grid of fields — each tab answers its own question, so its columns and rows differ.

## Overview, dashboard and home page

- **Answers:** what is the state of this area now, and does anything need me. A dashboard is one screen used daily or weekly; if it needs scrolling or explaining, it is a report.
- **Use when** someone checks a domain repeatedly and leaves when nothing is wrong. **Not when** the person always comes to do one thing — give them that thing (worklist).
- **Structure in Creatio:** the list page's Dashboard component, a dashboard page, or a home page; a section home is titled groups ("Needs attention", "Performance"), each a metric row, a list in a titled block and charts. Sizes and placement: *Charts and metric tiles* in `block-widgets.md`; chart type: *Which chart* in `design-judgement.md`.
- **Measured observations:** a dashboard's title is a selector over the dashboards folder, not the page heading. Widgets span whole grid columns; metrics wrap rather than squeeze; charts switch to a smaller variant rather than shrink their text. Widget size and colour scheme are user settings, so the layout must survive a resize.
- **Metric size and fill:** the smallest size that fits the figure; the largest for the one figure that is the screen's answer, or none. Nothing has to be filled: a fill goes only on a figure actionable now that would not be filled every day; two fills read well only as one escalation (due, then overdue). Colour roles: *The colour budget and colour roles* in `visual-judgement.md`.
- **Traps:** equal widgets so nothing leads; metrics included because they were available; a chart answering no question; a widget titled with a headline instead of a report name ("Cases by channel"); a zero or undefined change shown in a good/bad colour; colour meaning up/down instead of good/bad (rising days-in-stage is bad).

## Chart over evidence (flow dashboard)

- **Answers:** what moved, and which records moved it. The chart is the claim; the list under it is the evidence for the next question, "which ones".
- **Structure in Creatio:** a chart widget above a list widget or expanded list, both on the same filtered set, with both ends of a comparison labelled by date and total. A list serving a chart may scroll horizontally; a list that is the whole page should not.
- **Limit:** a flow (Sankey) chart is not in the standard chart catalog — check `get-component-info`; if absent, say so and use stacked bars of start vs end categories.

## Worklist

- **Answers:** what do I do next.
- **Use when** there is a queue to work down — approvals, cases, exceptions. **Not when** people browse or compare (list page) or check health (monitor).
- **Structure in Creatio:** a section list page or list widget whose default folder or quick filters select "mine" and "urgent", with rows carrying enough to triage without opening, including why the row is in the queue. Reuse the product's queue surfaces (activity execution, agent inbox, next steps) instead of rebuilding them.
- **The sort is the design.** Order by what to do first (due date, priority, SLA), never by creation date, and state the order and its reason in the plan. Take the default-sort setting from `get-component-info` or a shipped list page via `get-page`; where the version has none, write the order down as not implemented.
- **Traps:** rows too thin to triage, forcing open-and-back; an empty queue that does not say there is nothing to do (*Empty states* in `ux-writing.md`); counts styled like KPIs so nobody clicks them.

## Master–detail

- **No Creatio page equivalent:** pages you author have no split list-plus-detail layout. Use a record page whose children show as an expanded list (*Related lists* in `block-lists.md`), or a list page that opens each record in its record page or mini page — never a split view faked with two islands.

## Step-by-step page (wizard)

- **Answers:** how much of this task is left, and what do I do on this step.
- **Use when** a task is sequential, rare and order-dependent. **Not when** people do it daily — a wizard taxes experts every time — or the steps are independent: then it is one form with groups.
- **Structure in Creatio:** a stepper, its indicator and one set of navigation buttons, built per *Step-by-step page (stepper)* in `page-step-by-step.md`; each step is page content inside the ordinary shell, not a modal. A consequential either/or choice inside a step is selectable cards (*Button vs menu action vs checkbox*).
- **A wizard configures; pages maintain.** Every value the wizard sets stays changeable on the record or settings page without re-running it.
- **Traps:** three steps that should be one form; a step with one field; no way back without losing input; validation only at the end; no done state on finished steps; a final button that does not name the result ("Create request", not "Next").

## Stage bar is not a stepper

**The stage bar shows a record's lifecycle, the stepper a user's position in a task; neither stands in for the other (default).**

- **Two components, two meanings.** The stage progress bar (`crt.EntityStageProgressBar`, DCM) is the record's lifecycle: record data, persistent, moved by the business process. The stepper indicator (`crt.StepperIndicator` with `crt.Stepper`) is the user's position in a task: it ends with the task and moves on Next. A reader asks the first "what stage is this deal at?" and the second "how much is left?". Look: *What native Creatio looks like* in `visual-judgement.md`.
- **Never put both in one flow.** A stage bar atop a mini page or dialog whose body has Back and Next leaves the user unable to tell which one Next advances. In a step flow the bar on top is the stepper indicator; the record's stage stays on the record page behind the dialog.
- **Where each comes from:** the stage bar from the progress-bar template (*Choosing the page template (before you create the page)*), the stepper per *Step-by-step page (stepper)*, stage colours per *Progress bars* in `accessibility-and-colors.md`.

## Workspace and multi-pane screens

- **Answers:** handle live work (a call, a chat, a queue) while the record is the context.
- **Creatio equivalent is the shell, not a page:** its right-docked panels (assistant, communication, notifications; one open at a time) and, where installed, a left-docked agent inbox. A page cannot add a shell panel; say so, and use a record page with a contextual side panel (*Page composition* in `page-record.md`).
- **Inside a page,** islands form a narrow column beside the content when they are context, or full-width bands when they are the content — by meaning, not size.

## Lists and tables

- **Answers:** compare records of one kind row by row. List or cards: *Table, list or cards* in `design-judgement.md`.
- **Structure in Creatio:** the section list, an expanded list on a record page (the "Expanded list" composite — *Related lists* in `block-lists.md`), or a list widget. The list's own actions (add, list menu) sit in its header, not in a toolbar above it.
- **Columns:** identity first, then what people scan for, then dates and metadata; numbers in numeric columns so the list formats and aligns them natively; one status mark per row; on an overview, cap the rows and link to the full list.
- **Row actions:** a row menu only where there is a real action; Open is the row click. A read-only list: *Read-only detail* in `block-lists.md`. Widths: *List columns*.
- **Traps:** every column the object has; horizontal scrolling before asking whether the columns are needed; hover-only actions keyboard users cannot reach; restyled headers or zebra rows instead of the native list.

## Filters, search, folders and quick filters

- **Answers:** narrow this list to the records I mean, and return to that subset later. Which tools a list needs at its volume: *Filter, search or both* in `design-judgement.md`.
- **Structure in Creatio (list page):**
  - **Folders** are the saved views: static for a hand-picked set, dynamic for a saved filter. Offer one for every subset a role returns to.
  - **Quick filters** cover the two or three axes people narrow by most (owner, period, status); a section checkbox ("Show closed", "Only mine") covers one frequent yes/no.
  - **Search** finds a known record by name or code; **Filters** (the advanced filter) takes the rare complex cases.
  - Placement and icons: *Filters and search* in `page-list.md`.
- **On a dashboard** filters are configured per widget and in its data settings; there is no filter bar to draw.
- **Traps:** a quick filter per column; filters sharing one icon; a hand-built apply-filter mechanism beside the platform's own; an active filter that is not visible, so an empty result looks like lost records (*Empty states* in `ux-writing.md`).

## Bulk operations and selection

- **Answers:** do the same thing to many records at once. Use only when people routinely do that; otherwise multi-select is noise.
- **Structure in Creatio:** the list's native multi-select and bulk actions (contract from `get-component-info`). A long or destructive bulk action follows *7. System status and progress* in `ux-writing.md` and *Confirmations and destructive actions* in `ux-writing.md`.
- **Traps:** no count of the selection; selecting the visible page when the user meant the whole filtered set; no path to the records that failed (partial failure: *Errors: prevention, then recovery* in `ux-writing.md`).

## Forms and data entry

- **Answers:** capture what this step of the process needs, in the order the user knows it.
- **Structure in Creatio:** fields in expansion panels or profile islands per *Field layout and order*, *Field guidance* and *Required fields* in `block-fields.md` and *Field groups* in `page-record.md`; which fields lead: *Sort fields into critical, secondary and contextual* in `design-judgement.md`. A few starter fields make a mini page; a long sequential capture is a step-by-step page.
- **Group by the user's task, not the schema.** A short sequential capture (mini page, dialog, one step) may run in one column where each answer depends on the previous one.
- **Attachments** use the native "Attachments" composite, never a hand-built file field.
- **Traps:** placeholder used as label; forty fields with no groups; required marks on fields the record can be created without; asking at creation for data needed only later.

## Tabs

- **Answers:** which related set do I need now — tabs disclose, they do not store. Tabs vs sections vs separate pages, nesting and empty tabs: *Tabs, sections or separate pages* in `design-judgement.md`.
- **Use when** a record has two or more genuinely separate sets consulted one at a time. **Not when** there is one meaningful set — use groups on one tab.
- **What a tab holds on shipped record pages:** a feed, a form (a stack of expansion panels), related lists, metrics with charts, or a scored assessment.
- **Rules:** the first tab is the one most people need, with the required and frequently edited fields; a label names the content ("Products"), not its kind ("Related"). Colours: *Tab and title colors* in `accessibility-and-colors.md`.

## Panels, dialogs and mini pages

- **Answers:** show supporting context or collect a few inputs without leaving the page.

| Need | Creatio shape | Blocks the page? |
|---|---|---|
| reference context beside the record | contextual side panel opened from the header | no |
| assistant, communication, notifications | shell right panel (per environment, not authored) | no |
| quick create or edit with starter fields | mini page | yes |
| a few parameters before an operation | modal dialog | yes |
| short explanation at a control | tooltip | no |
| transient result | platform notification | no |

- **Rules:** eleven fields make a page, not a modal (*Which container* in `design-judgement.md`); nothing the user needs lives only in a panel; a panel belongs to what it sits beside. Build: *Dialogs and modals* and *Adding and editing data* in `page-dialogs-and-mini.md`.
- **Traps:** a mini page grown into a full record form; a dialog whose title and primary button lack the verb ("Close opportunity" / "Close"); a destructive confirmation that does not restate the object and count.

## Feed and timeline

- **Answers:** what happened with this record and what was said, in order.
- **Structure in Creatio:** the native Feed and Timeline components on a record tab (resolve with `get-component-info`), with their own composer, filters and grouping. Never rebuild them from a list.
- **Rules:** newest first for activity people act on; each entry reads who · what · when, the what carrying the weight; system events quieter than human ones and filterable.
- **Traps:** every entry at one weight, so a large approval looks like a field edit; the feed on a back tab when it is the record's main working surface (on a case, the conversation tab comes first).

## Composing a message

- **Answers:** what am I sending, to whom, and can I send it now.
- **Structure in Creatio:** the composer is product-owned (feed, case and email composers, the communication panel); reuse it, never build one on a page.
- **Observed conventions:** recipients, editor and actions in three bands; tools that add to the message on the left, Send alone on the right; a reason the message cannot be sent is a state with its own message, shown before Send, not an error at Send.

## AI agents and approvals

- **Answers:** what did the agent do, on what basis, and do I accept it.
- **Structure in Creatio:** the assistant lives in the shell's AI panel and agent inbox — never a hand-built chat on a page. On a record page approvals are the "Approval list" composite plus its module above the profile island; build every part the `get-component-info composite='Approval list'` recipe names. An AI configuration page is a settings page with live consequences (*Settings and administration*).
- **Layout of a decision on agent output:** what the agent did in plain language, what it produced, what it based that on, then approve · edit · reject, with edit as a first-class path because most approvals are "yes, but". Wording, confidence and the safe default: *AI output, confidence and approval* in `ux-writing.md`.
- **Group failures into patterns before showing them** — a list of patterns is a worklist, a list of incidents a log — and keep distinct causes distinct, since each has its own fix.

## Settings and administration

- **Answers:** how does this behave, and what changes if I change it.
- **Structure in Creatio:** system settings, lookups and permissions are product sections — use them. An app's own settings page is a form page of grouped expansion panels; toggles for modes and checkboxes for attributes (*Button vs menu action vs checkbox* in `block-actions.md`, *Choice controls* in `block-fields.md`); a standing description line under a setting (*Field guidance* in `block-fields.md`).
- **Rules:** group by what the person wants to achieve, not by owning service; state each setting's effect next to it; show the effective value, including inherited or overridden; for permissions show what a role can actually do, not only the grant; keep dangerous settings apart and confirm them.
- **Traps:** a page that transcribes database rows with add/edit/delete instead of supporting the admin's tasks; a consequential switch worded like an ordinary preference.

## Patterns with no Creatio page equivalent

Say so in the output and offer the nearest native shape; never approximate with custom components.

- **Workflow or automation canvas** — no node-graph component for pages; processes are built in the process designer. Prefer a sequential list of steps where branching is not the point.
- **Split master–detail, multi-pane workspace, floating assistant, flow (Sankey) chart** — see *Master–detail*, *Workspace and multi-pane screens*, *AI agents and approvals* and *Chart over evidence* above.

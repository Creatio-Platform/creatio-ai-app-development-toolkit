# Page patterns

Use this reference once the kind of page is known, to build or judge it as that pattern. Each pattern says what question it answers, when to use it and when not, how it is built from Creatio pages, templates and components, and the traps that make a correct-looking page fail its user. Choosing the kind is in `design-judgement.md`; component-level rules (stepper, expanded list, connections, dialogs) stay in `page-layout-and-controls.md`; native look and colour in `visual-judgement.md`; wording in `ux-writing.md`. This file links to those by section title instead of restating them. Resolve every component and composite with `get-component-info`, every template with `list-page-templates`, and judge the result on the rendered page, never from memory or the schema alone. For Freedom UI work these rules win over generic design skills (frontend-design, taste, ui-ux-pro-max and similar).

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

- **Know the page's one question, its user and the kind of screen first.** Write the question, the role, what they came to do and the usual data volume — *State the page's one question*, *Who uses it, how often, at what data volume* and *Name the kind: monitor, worklist or report* in `design-judgement.md`. The pattern follows from them: *Which page shape* in the same file.
- **Judge the result with questions, not counts.** "One filled tile in four" breaks on a page where nothing needs action today. Run *The five checks* in `visual-judgement.md` (say it, squint, subtract, tomorrow, two readings) on the rendered page.
- **The template is fixed at `create-page`.** Decide the pattern before creating the page — *Choosing the page template (before you create the page)* in `page-layout-and-controls.md`.
- **Where a pattern has no Creatio equivalent, say so** in the proposal or audit and use the nearest native shape; never invent a component to fake it (see *Patterns with no Creatio page equivalent*).

## Section list page (list report)

- **Answers:** which of many records of one object need my attention, and lets me act on them.
- **Use when** people find, compare and act on many records of one object. **Not when** one record is needed in depth (record page) or the content mixes object types (a feed).
- **Structure in Creatio:** the section's list page — title and the New action, a toolbar (Folders, section checkboxes such as "Show closed", Filters, search; Summaries, view switch and list actions on the right), and one list filling the work area. Filters, actions and analytics go into the template's slots: *List (section) page layout* in `page-layout-and-controls.md`.
- **Measured shapes:** a shipped section page is either a plain list with columns sized to fill, or a section home of titled groups (see *Overview, dashboard and home page*). It has no content tabs; the switch between the list and its dashboards is the view switch.
- **Traps:**
  - No useful starting view on a list of hundreds or more — set a default folder, quick filter or "Show closed" off.
  - Every column the object has (see *Lists and tables*).
  - Sorted by creation date or code when users scan by something else.
  - Metrics above the list that nobody acts on: a count above a list is a subset the user opens; a KPI belongs on the dashboard.

## Record page

- **Answers:** everything about one record its user needs now — identity, state, and the next decision.
- **Use when** one record is worked in depth with its related records. **Not when** the task is changing many records (list page with bulk actions) or finding an unknown record (list page with search).
- **Structure in Creatio:** a form page on the template its composition needs — side profile column, header above tabs, or the progress-bar template for a staged record. Composition and island settings: *Page composition* and *Grouping and page flow* in `page-layout-and-controls.md`; the native shapes and island look: *What native Creatio looks like* in `visual-judgement.md`.
- **The header carries the decision.** Main actions are buttons at the right of the title row — one primary, the rest quiet, rare ones in a menu — never text links or only an overflow menu. If the page exists to make a decision (Approve, Escalate), that decision is its most prominent control. Placement: *Buttons and actions* in `page-layout-and-controls.md`.
- **State is in the first screenful** — stage, overdue, at risk, approved — via the stage progress bar or a status in the profile island, never in a later tab.
- **Balance the columns (rule of this skill).** The left column must not be half-empty next to a long content area. Fill it with fields and blocks the user needs — key stable fields, related-record profiles, small metrics that answer the page's question. If the object has nothing to fill it with, the page needs a different template (header above tabs, no side profile). Whatever fills it passes the subtract check: no decorative widgets, no metric repeating a field, no placeholder groups. This overrides the generic "an empty region may be deliberate" for the record page's columns. Mechanics: *Balance the page* under *Page composition*.
- **An amount or quantity field gets analytics only when it answers the page's question** (a rollup, paid vs remaining, plan vs actual) — never a tile repeating the field's own value. See *An amount field gets analytics when the page asks a question about it* in `page-layout-and-controls.md`.
- **Traps:** fields in schema order instead of fill order; a tab strip with one meaningful tab; borders, shadows or backgrounds drawn on islands to separate them; two tabs showing the same grid of fields — each tab answers its own question, so its columns and rows differ.

## Overview, dashboard and home page

- **Answers:** what is the state of this area now, and does anything need me. A dashboard is one screen used daily or weekly; if it needs scrolling or explaining, it is a report.
- **Use when** someone checks a domain repeatedly and leaves when nothing is wrong. **Not when** the person always comes to do one thing — give them that thing (worklist). Name the decision a requested dashboard supports before building it.
- **Structure in Creatio:** the list page's Dashboard component, a dashboard page, or a home page; analytics on a record page per *Analytics and metric widgets* in `page-layout-and-controls.md`. A section home is titled groups ("Needs attention", "Performance"), each a metric row, a list in a titled block and charts. Chart choice: *Which chart* in `design-judgement.md`.
- **Measured observations:** a dashboard's title is a selector over the dashboards folder (star, name, caret), not the page heading — a section or home page keeps the page heading. Widgets span whole grid columns; metrics stretch to their column and wrap rather than squeeze; charts switch to a smaller variant rather than shrink their text. Widget size and colour scheme are user-changeable settings, so the layout must survive a resize.
- **Metric size:** pick the smallest size that fits the figure; the largest is for the one figure that is the screen's answer — one per screen, or none. Four peer metrics at the largest size is how a correct page starts to look like a template: nothing leads.
- **Metric fill:** nothing has to be filled. A fill claims attention, so use it only on a figure actionable now that would not be filled every day; two fills read well only as one escalation (due, then overdue). Colour roles: *The colour budget and colour roles* in `visual-judgement.md`.
- **Traps:** equal widgets so nothing leads; metrics included because they were available; a chart answering no question; a widget titled with a headline instead of a report name ("Cases by channel"); a zero or undefined change shown in a good/bad colour; colour meaning up/down instead of good/bad (rising days-in-stage is bad).

## Chart over evidence (flow dashboard)

- **Answers:** what moved, and which records moved it. The chart is the claim; the list under it is the evidence, because the next question after "pipeline fell" is "which ones".
- **Structure in Creatio:** a chart widget above a list widget or expanded list, both on the same filtered set, with both ends of a comparison labelled by date and total. A list serving a chart may scroll horizontally; a list that is the whole page should not.
- **Limit:** a flow (Sankey) chart is not in the standard chart catalog — check `get-component-info`; if absent, say so and use the nearest native chart (stacked bars of start vs end categories).

## Worklist

- **Answers:** what do I do next.
- **Use when** there is a queue to work down — approvals, cases, exceptions. **Not when** people browse or compare (list page) or check health (monitor).
- **Structure in Creatio:** a section list page or list widget whose default folder or quick filters select "mine" and "urgent", with a few counts the user opens, and rows carrying enough to triage without opening — including why the row is in the queue. Reuse the product's queue surfaces (activity execution, agent inbox, next steps) instead of rebuilding them.
- **The sort is the design.** Order by what to do first (due date, priority, SLA), never by creation date. Set the default sort where the target version offers a setting — take its shape from `get-component-info` or a shipped list page via `get-page`, not from memory; where it offers none, write the order down as not implemented. State the order and its reason in the plan.
- **Traps:** rows too thin to triage, forcing open-and-back; an empty queue that does not say there is nothing to do (*Empty states* in `ux-writing.md`); counts styled like KPIs so nobody clicks them.

## Master–detail

- **No Creatio page equivalent:** pages you author have no split list-plus-detail layout. Use a record page whose children show as an expanded list (*Grouping and page flow* in `page-layout-and-controls.md`), or a list page that opens each record in its record page or mini page. Do not fake a split view with two islands.

## Step-by-step page (wizard)

- **Answers:** how much of this task is left, and what do I do on this step.
- **Use when** a task is sequential, rare and order-dependent. **Not when** people do it daily — a wizard taxes experts every time — or the steps are independent: then it is one form with groups filled in any order.
- **Structure in Creatio:** a stepper, its indicator and one set of navigation buttons, built per *Step-by-step page (stepper)* in `page-layout-and-controls.md`. A consequential either/or choice inside a step is selectable cards — see *Button vs menu action vs checkbox*.
- **Measured observation:** in shipped step-by-step flows each step is a whole page inside the ordinary shell, not a modal, and Back and Next are the last row of the step content.
- **A wizard configures; pages maintain.** Every value the wizard sets stays changeable on the record or settings page without re-running it.
- **Traps:** three steps that should be one form; a step with one field; no way back without losing input; validation only at the end; no done state on finished steps; a final button that does not name the result ("Create request", not "Next").

## Stage bar is not a stepper

- **Two components, two meanings.** The stage progress bar (`crt.EntityStageProgressBar`, DCM) is the record's lifecycle: record data, persistent, moved by the business process. The stepper indicator is the user's position in a task: it ends with the task and moves on Next. A reader asks the first "what stage is this deal at?" and the second "how much is left?". Look: *What native Creatio looks like* in `visual-judgement.md`.
- **Never put both in one flow.** A stage bar atop a mini page or dialog whose body has Back and Next leaves the user unable to tell which one Next advances. In a step flow the bar on top is the stepper indicator; the record's stage stays on the record page behind the dialog.
- **Where each comes from:** the stage bar from the progress-bar template (*Choosing the page template (before you create the page)*), the stepper per *Step-by-step page (stepper)*, stage colours per *Progress bars* in `accessibility-and-colors.md`.

## Workspace and multi-pane screens

- **Answers:** handle live work (a call, a chat, a queue) while the record is the context.
- **Creatio equivalent is the shell, not a page.** The shell's right-docked panels (assistant, communication, notifications; configured per environment, one open at a time) and, where installed, a left-docked agent inbox. A page cannot add a shell panel; its nearest shape is a record page with a contextual side panel — see *Page composition* in `page-layout-and-controls.md`. Say so in the output.
- **Inside a page,** islands form a narrow column beside the content when they are context the reader consults, or full-width bands when they are the content. Choose by meaning, not size.

## Lists and tables

- **Answers:** compare records of one kind row by row. List or cards: *Table, list or cards* in `design-judgement.md`.
- **Structure in Creatio:** the section list, an expanded list on a record page (the "Expanded list" composite — *Grouping and page flow* in `page-layout-and-controls.md`), or a list widget. The list's own actions (add, list menu) sit in its header, not in a toolbar above it.
- **Columns:** identity first, then what people scan for, then dates and metadata; numbers in numeric columns so the list formats and aligns them natively; one status mark per row; on an overview, cap the rows and link to the full list.
- **Row actions:** a row menu only where there is a real action; Open is the row click. A read-only list removes Copy and Delete but keeps Open — see the read-only detail rule in *Grouping and page flow*.
- **Traps:** every column the object has; horizontal scrolling before asking whether the columns are needed; hover-only actions keyboard users cannot reach; restyled headers or zebra rows instead of the native list.

## Filters, search, folders and quick filters

- **Answers:** narrow this list to the records I mean, and return to that subset later. Which tools a list needs at its volume: *Filter, search or both* in `design-judgement.md`.
- **Structure in Creatio (list page):**
  - **Folders** are the saved views: static for a hand-picked set, dynamic for a saved filter. Offer one for every subset a role returns to.
  - **Quick filters** cover the two or three axes people narrow by most (owner, period, status), each with a distinct icon (*Buttons and actions* in `page-layout-and-controls.md`); a section checkbox ("Show closed", "Only mine") covers one frequent yes/no.
  - **Search** finds a known record by name or code; **Filters** (the advanced filter, read as a sentence of conditions) takes the rare complex cases.
  - Placement: *List (section) page layout* in `page-layout-and-controls.md`.
- **On a dashboard** filters are configured per widget and in its data settings; there is no filter bar to draw.
- **Traps:** a quick filter per column; filters sharing one icon; a hand-built apply-filter mechanism beside the platform's own; an active filter that is not visible, so an empty result looks like lost records.

## Bulk operations and selection

- **Answers:** do the same thing to many records at once. Use only when people routinely do that; otherwise multi-select is noise.
- **Structure in Creatio:** the list's native multi-select and bulk actions (contract from `get-component-info`). A long or destructive bulk action follows *Long-running and destructive actions* in `page-layout-and-controls.md` and *Confirmations and destructive actions* in `ux-writing.md`: warn, run asynchronously, notify, confirm with the count.
- **Traps:** no count of the selection; selecting the visible page when the user meant the whole filtered set; no partial-failure path — 12 of 240 failed and no way to reach the twelve.

## Forms and data entry

- **Answers:** capture what this step of the process needs, in the order the user knows it.
- **Structure in Creatio:** fields in expansion panels or profile islands per *Fields*, *Adding and editing data* and *Grouping and page flow* in `page-layout-and-controls.md`; placeholders, tooltips and required marks per the mandatory rules in `SKILL.md`; which fields lead: *Sort fields into critical, secondary and contextual* in `design-judgement.md`. A few starter fields make a mini page; a long sequential capture is a step-by-step page.
- **Group by the user's task, not the schema**, related fields side by side. A record page uses the two-column layout of *Fields*; a short sequential capture (mini page, dialog, one step) may run in one column where each answer depends on the previous one.
- **Attachments** use the native "Attachments" composite, never a hand-built file field.
- **Traps:** placeholder used as label; forty fields with no groups; required marks on fields the record can be created without; asking at creation for data needed only later.

## Tabs

- **Answers:** which related set do I need now — tabs disclose, they do not store. Tabs vs sections vs separate pages: *Tabs, sections or separate pages* in `design-judgement.md`.
- **Use when** a record has two or more genuinely separate sets consulted one at a time. **Not when** there is one meaningful set — use groups on one tab.
- **What a tab holds on shipped record pages:** a feed, a form (a stack of expansion panels), related lists, metrics with charts, or a scored assessment.
- **Rules:** the first tab is the one most people need, with the required and frequently edited fields; a label names the content ("Products"), not its kind ("Related"); a tab empty on most records is a candidate for removal; do not nest a tab strip inside a tab on a page you build — use expansion panels inside the tab (a nested strip shipped by the product is not a finding); a section list page has no content tabs. Colours: *Tab and title colors* in `accessibility-and-colors.md`.

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

- **Rules:** a modal must earn blocking the page — eleven fields make a page, not a modal; nothing the user needs lives only in a panel; a panel belongs to what it sits beside. See *Dialogs and modals*, *Adding and editing data* and *Page composition* in `page-layout-and-controls.md`.
- **Traps:** a mini page grown into a full record form; a dialog whose title and primary button lack the verb ("Close opportunity" / "Close"); a destructive confirmation that does not restate the object and count.

## Feed and timeline

- **Answers:** what happened with this record and what was said, in order.
- **Structure in Creatio:** the native Feed and Timeline components on a record tab (resolve with `get-component-info`), with their own composer, filters (period, channel, hide system messages) and month grouping. Never rebuild them from a list.
- **Rules:** newest first for activity people act on; each entry reads who · what · when, the what carrying the weight; system events quieter than human ones and filterable.
- **Traps:** every entry at one weight, so a large approval looks like a field edit; the feed on a back tab when it is the record's main working surface (on a case, the conversation tab comes first).

## Composing a message

- **Answers:** what am I sending, to whom, and can I send it now.
- **Structure in Creatio:** the composer is product-owned (feed, case and email composers, the communication panel); reuse it, never build one on a page.
- **Observed conventions:** recipients, editor and actions in three bands; tools that add to the message on the left, Send alone on the right; a template picker shows its count ("2 of 12 approved templates") and keeps placeholders visible; every refusal (window closed, no approved templates) is a state with its own message, not an error at Send.

## AI agents and approvals

- **Answers:** what did the agent do, on what basis, and do I accept it.
- **Structure in Creatio:** the assistant lives in the shell's AI panel and agent inbox — never a hand-built chat on a page. On a record page approvals are the "Approval list" composite plus its module above the profile island; build every part the recipe names (composite rule in `SKILL.md`). An AI configuration page is a settings page with live consequences (*Settings and administration*).
- **Layout of a decision on agent output:** what the agent did in plain language, what it produced, what it based that on, then approve · edit · reject, with edit as a first-class path because most approvals are "yes, but". Wording, confidence and the safe default: *AI output, confidence and approval* in `ux-writing.md`.
- **Group failures into patterns before showing them** — a list of patterns is a worklist, a list of incidents a log — and keep distinct causes distinct ("no article found" vs "article lacks this topic"), since each has its own fix.

## Settings and administration

- **Answers:** how does this behave, and what changes if I change it.
- **Structure in Creatio:** system settings, lookups and permissions are product sections — use them. An app's own settings page is a form page of grouped expansion panels; toggles for modes and checkboxes for attributes (*Button vs menu action vs checkbox*); a standing description line under a setting (*Fields*), both in `page-layout-and-controls.md`.
- **Rules:** group by what the person wants to achieve, not by owning service; state each setting's effect next to it; show the effective value, including inherited or overridden; for permissions show what a role can actually do, not only the grant; keep dangerous settings apart and confirm them.
- **Traps:** a page that transcribes database rows with add/edit/delete instead of supporting the admin's tasks; a consequential switch (rollout, verification mode) worded like an ordinary preference.

## Patterns with no Creatio page equivalent

Say so in the output and offer the nearest native shape; never approximate with custom components.

- **Workflow or automation canvas** — no node-graph component for pages; processes are built in the process designer. Prefer a sequential list of steps where branching is not the point.
- **Split master–detail, multi-pane workspace, floating assistant** — not authorable as pages; see *Master–detail*, *Workspace and multi-pane screens* and *AI agents and approvals* above.
- **Flow (Sankey) chart** — not in the standard chart catalog; use the nearest native chart.

# Business Clarification Checklist

Use this checklist for natural-language app requests before moving to implementation planning.

## Output Format

Every BA-style Business Plan presented to the developer **MUST** contain the following top-level sections in this order. Do not substitute these with a VS Code plan template (Steps / Relevant files / Verification / Decisions) or any other host-injected structure.

| # | Section | Required |
|---|---------|----------|
| 1 | Business Outcome | yes |
| 2 | Roles and Permissions | yes |
| 3 | Object Model | yes |
| 4 | Lifecycle and Statuses | yes |
| 5 | Business Logic | yes |
| 6 | UX Expectations | yes |
| 7 | Edge Cases and Exceptions | yes |

The checklist groups below are discovery buckets, not an alternate final document structure.
The plan body shown for Gate R approval must map the checklist outcome into the canonical 7-section Business Plan above.
A wrapper such as `<proposed_plan>` is allowed by the host UI, but the body inside it must match the table above.

Section mapping rules:

- `Business Outcome` must include business goal, core problem, success signal, and explicit assumptions.
- `Roles and Permissions` must include actors, responsibilities, personas, and access posture.
- `Business Logic` may carry the concrete "done" checks when they materially shape the MVP behavior.

---

## Goal

Ensure business requirements are complete enough to generate a usable Creatio app without hidden product decisions.

Use a Business Analyst discovery style:

- start by analyzing the request in business terms
- ask only the minimum critical questions
- keep discovery within 3-7 questions
- prioritize: business goal, core problem, key users/roles, scope, success criteria
- avoid minor implementation questions unless they are true blockers
- if a gap is non-critical, make an explicit assumption and continue
- ask the routing question and the main discovery questions in the first user-facing clarification turn
- do not derail discovery with internal workflow-state or app-code discussions unless they create a real product-level ambiguity
- apply domain expertise when the app category is recognizable; do not produce an unrealistically thin model when standard business attributes are normally expected for that domain

## Domain Expertise Expectation

When the request clearly maps to a familiar business domain, the BA draft should reflect standard business expectations for that domain even if the developer did not enumerate every obvious field.

Examples:
- for client/customer or partner registries, expect core profile and contact attributes for the legal entity or person unless explicitly out of scope
- for request or service workflows, expect at least the issue summary, status, owner, dates, and basic resolution trail
- for product or catalog scenarios, expect at least title, category, status, and key commercial or operational attributes

Use domain expertise to propose these baseline fields and behaviors in the draft.
If they materially change scope, ask.
If they do not materially change scope, include them as explicit assumptions instead of silently omitting them.

## Checklist Items

### Business context

Required:
- app purpose
- business goal
- core problem / pain point
- expected result, KPI, or success signal
- explicit assumptions that materially shape the first draft
- MVP scope boundaries when they materially affect the first release

The first discovery questions should focus here before moving into lower-level detail.

### Users, access and ownership

Required:
- who uses the app
- who can create/update/close records
- who owns key approvals or responsibilities
- whether record ownership or confidentiality rules are required

If restrictions are not essential, explicitly state:
- `No specific access restrictions are required by default.`

Do not suggest optional restrictions without a business reason.

### Core process and business logic

Required:
- current operational pain points
- visibility, coordination, manual work, or system gaps the app should address
- why the current process is insufficient
- lifecycle stages/statuses
- transition expectations when restrictions matter
- required fields
- defaults
- validation expectations
- restrictions and edge constraints
- minimum fields required to create the main record
- duplicate handling posture
- archive/close posture
- ownership/editing posture
- operational metrics
- usage or participation metrics when relevant
- business impact metrics or KPI signals when relevant
- a simple business funnel when the process naturally supports one

If full metric detail is missing, define a practical draft set and mark it as an assumption.

### Data model

Required:
- main objects
- whether the app has one primary record type or several distinct business objects
- lookup objects for enum-like fields
- key relationships
- record title / primary display field for each object and lookup
- standard profile, contact, classification, or operational attributes that a domain expert would normally expect for the core business objects

Resolve these ambiguities explicitly when they appear in the request:
- if multiple counterparty categories are mentioned, clarify whether they belong in one universal registry with a type lookup or in separate main business objects
- if a secondary object is proposed, state why it is a distinct business object instead of additional fields on the section object
- if contact-like records are present, state whether they are subordinate to one parent record or may exist independently

The visible BA draft **must** render each object in the object model section as a markdown table with columns: `Title`, `Code`, `Description`, `Data type`, `Required`, `Default`. Lookup seed rows must also be rendered as a table. Do not use bullet lists to describe object fields or seed rows.

### UX assumptions

Default unless critical:
- list page columns
- form page field groups/layout notes
- which field is shown as the record title in lists and forms
- sorting/filtering expectations if important

If the developer omits exact page fields or gives only a partial list, resolve deterministic defaults before handoff:
- FormPage: keep `Name` as the record title/header when present and include all approved non-inherited business fields from the section object. Required business fields must always be included.
- ListPage: include `Name`, include every required non-inherited business field, then append short operational fields in this priority order until the default grid remains compact: status/lifecycle, priority/severity, type/category, due/start/end date, owner/assignee, code/number, amount.
- Keep default ListPage selection compact by capping auto-selected columns at 6 total visible columns unless required business fields exceed that number.
- Exclude inherited audit/system fields from default ListPage columns unless explicitly requested.
- Exclude long/rich/blob fields from default ListPage columns unless explicitly requested or required.

The BA draft must surface these defaults in the `UX Expectations` section:
- list columns
- default sorting
- list filters
- form groups

The visible BA draft should render the UX section as a short bullet list, not as a table.

### Assumptions used for the draft requirements

Default unless critical:
- required fields
- defaults
- validation expectations
- restrictions and edge constraints
- minimum fields required to create the main record
- duplicate handling posture
- archive/close posture
- ownership/editing posture

If a requirement changes compliance, ownership, or acceptance outcome, treat it as required clarification instead of a default.
When an assumption remains in the final draft, render it inside `Business Outcome` rather than as a standalone top-level section.

## Business Logic Quality Bar

The business logic section is incomplete if it only restates the workflow.

It must explicitly define:
- what is the minimum record needed to start work
- what statuses or lifecycle states matter operationally
- what is considered inactive, archived, overdue, duplicate, or unresolved when relevant
- what the team must see or control in day-to-day work
- which supporting records are required to make the process operationally usable

### Conditional Page Logic (Business Rules)

At planning time, actively work out the page's *conditional behavior*, not just its static fields. For each form/record page, think through which fields and controls change based on the data on the record, and capture that logic in the Business Plan so it can be implemented as Creatio business rules.

For every business rule, describe it as **action + target + condition**:
- **show / hide** a field, group, or tab when a condition is met (e.g. hide `Reason` unless `Status = Rejected`)
- **required / optional** — make a field mandatory only under a condition (e.g. `Close date` required when `Status = Done`)
- **lock / editable (read-only)** — disable or enable a field under a condition (e.g. lock `Amount` once `Status = Approved`)
- **set value / default** — auto-fill a field with a value when a condition is met (e.g. set `Owner = current user` on create, set `Completed on = today` when `Status = Done`)

Do not leave this logic implicit. If the requirements imply that a field only matters in some states, that a value should be auto-populated, or that something must be protected after a transition, state the rule explicitly with its trigger condition. Where the lifecycle has distinct statuses, walk each status and note which fields become required, hidden, locked, or auto-set in that state.

Prefer expressing these as deterministic business rules. Flag any condition that needs custom client-side code (custom validators/handlers/converters) as a separate, non-business-rule item, since it falls outside the standard conditional-rule path.

**No duplication between prose and the conditional rules block.** Each conditional rule belongs in exactly one place. If a behavior is captured as a conditional rule (action + target + condition), do not also restate it in the main `Business Logic` prose, and vice versa. The prose covers non-conditional business logic (minimum-to-create, duplicate handling, archive/close posture, ownership/editing posture, derived/aggregated values, cross-field validation that is not a UI rule); the conditional rules block covers the show/hide, required, lock, and set-value rules. Before finalizing the section, scan for any statement that appears both as prose and as a conditional rule and remove the prose copy.

## Pre-analysis Pass

Before presenting the BA draft to the developer, run a pre-analysis pass across all draft sections and assumptions.

The pre-analysis must check for:
- contradictions between business context, process, data model, UX assumptions, and assumptions
- business logic that is not reflected in the data model or cannot be supported by the described UX
- required fields in business logic that are not marked as required in the data model
- defaults that do not identify an explicit business default or explicit absence of default
- sorting, filtering, analytics, or ownership expectations that do not map to explicit fields or business objects
- lookup usage that is inconsistent across objects or too broad for the stated business scope
- supporting objects whose required parent links or cross-field constraints are not explicitly captured
- assumptions that contradict confirmed answers
- visible BA draft formatting that violates the fixed document contract
- markdown tables outside the object model section
- checklist-source language leaking into the visible BA draft
- recognizable business concepts that may map to existing schemas but are not noted in the Technical Implementation Handoff

If pre-analysis finds a material issue:
- ask a targeted follow-up question when the issue changes business intent or acceptance
- otherwise resolve it as an explicit assumption before showing the draft
- when a business concept is recognizable and could plausibly map to an existing platform or custom schema, note it in the Technical Implementation Handoff "Reuse Discovery Signals" block

Do not present the BA draft while known cross-section contradictions or missing carriers still exist.

## Completion Criteria

Set `businessChecklistComplete=true` only when:
- all required checklist items are answered, and
- optional/defaulted items are either answered or documented in assumptions and explicitly accepted by the developer.
- the pre-analysis pass has been completed without unresolved cross-section contradictions

For each checklist group, persist:
- `source: "confirmed"` when the developer answered it directly
- `source: "assumed"` when the agent had to resolve a gap
- `assumption: "<text>"` when `source="assumed"`

Do not mark a checklist group complete without `source`.
If a group is assumed, the same assumption text must be listed in the top-level `assumptions` array before approval is written, even though the visible BA draft now folds assumptions into `Business Outcome`.

If not complete, continue clarification and do not proceed to implementation planning.

## Clarification Strategy

- Ask questions in themed batches, not all at once.
- Prefer 3-5 decision-driving questions for the initial discovery pass.
- Keep the full discovery within 3-7 questions unless the request is unusually ambiguous.
- Keep each question tied to one checklist gap.
- If answer is ambiguous, rephrase and request concrete values.
- Prefer business language; avoid technical implementation details unless required as blockers.
- Prefer option-based prompts over open-ended questions whenever deterministic defaults are possible.
- when the request contains category, lifecycle, or secondary-object ambiguity, resolve it explicitly before finalizing the BA draft

## Technical Minimalism Boundary

Technical questions are allowed only for:
- execution blockers (URL, access, credentials)

Runtime inputs such as URL and credentials are execution blockers after Gate R approval and may remain deferred until then.

All other technical values should use deterministic defaults and be documented later in plan artifacts.

## Display Field Defaulting

- For canonical main-entity rules, lookup display semantics, and title-field assumptions, follow the current `clio` MCP app-modeling guidance instead of restating those mechanics here.
- In the BA draft, describe the record title in business language and request a separate title-like field only when the business needs a field that is distinct from the record name.

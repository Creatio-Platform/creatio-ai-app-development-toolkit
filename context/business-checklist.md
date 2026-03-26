# Business Clarification Checklist

Use this checklist for natural-language app requests before moving to implementation planning.

## Output Format

Every BA-style Business Plan presented to the developer **MUST** contain the following top-level sections in this order. Do not substitute these with a VS Code plan template (Steps / Relevant files / Verification / Decisions) or any other host-injected structure.

| # | Section | Required |
|---|---------|----------|
| 1 | Business context | yes |
| 2 | Users, access and ownership | yes |
| 3 | Core process and business logic | yes |
| 4 | Data model | yes |
| 5 | UX assumptions | yes |
| 6 | Assumptions used for the draft requirements | yes |

Sections 1–5 and the assumptions block may never be omitted. Edge cases, acceptance criteria, and analytics should be resolved inside sections 1–5 or captured explicitly in assumptions when they do not materially change the business intent.

The plan body shown for Gate R approval must follow this structure exactly. A wrapper such as `<proposed_plan>` is allowed by the host UI, but the body inside it must match the table above.

---

## Goal

Ensure business requirements are complete enough to generate a usable Creatio composable app without hidden product decisions.

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
- for case, request, or service workflows, expect at least the issue summary, status, owner, dates, and basic resolution trail
- for product or catalog scenarios, expect at least title, category, status, and key commercial or operational attributes

Use domain expertise to propose these baseline fields and behaviors in the draft.
If they materially change scope, ask.
If they do not materially change scope, include them as explicit assumptions instead of silently omitting them.

## Checklist Items

## 1. Business context

Required:
- app purpose
- business goal
- core problem / pain point
- expected result, KPI, or success signal
- MVP scope boundaries when they materially affect the first release

The first discovery questions should focus here before moving into lower-level detail.

## 2. Users, access and ownership

Required:
- who uses the app
- who can create/update/close records
- who owns key approvals or responsibilities
- whether record ownership or confidentiality rules are required

If restrictions are not essential, explicitly state:
- `No specific access restrictions are required by default.`

Do not suggest optional restrictions without a business reason.

## 3. Core process and business logic

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

## 4. Data model

Required:
- main entities
- whether the app has one primary record type or several distinct business objects
- lookup entities for enum-like fields
- key relationships
- record title / primary display field for each entity and lookup
- standard profile, contact, classification, or operational attributes that a domain expert would normally expect for the core business objects

Resolve these ambiguities explicitly when they appear in the request:
- if multiple counterparty categories are mentioned, clarify whether they belong in one universal registry with a type lookup or in separate main business objects
- if a secondary entity is proposed, state why it is a distinct business object instead of additional fields on the main entity
- if contact-like records are present, state whether they are subordinate to one parent record or may exist independently

## 5. UX assumptions

Default unless critical:
- list page columns
- form page field groups/layout notes
- which field is shown as the record title in lists and forms
- sorting/filtering expectations if important

If the developer omits exact page fields or gives only a partial list, resolve deterministic defaults before handoff:
- FormPage: keep `Name` as the record title/header when present and include all approved non-inherited business fields from the main entity. Required business fields must always be included.
- ListPage: include `Name`, include every required non-inherited business field, then append short operational fields in this priority order until the default grid remains compact: status/lifecycle, priority/severity, type/category, due/start/end date, owner/assignee, code/number, amount.
- Keep default ListPage selection compact by capping auto-selected columns at 6 total visible columns unless required business fields exceed that number.
- Exclude inherited audit/system fields from default ListPage columns unless explicitly requested.
- Exclude long/rich/blob fields from default ListPage columns unless explicitly requested or required.

The BA draft must surface these defaults in the `UX assumptions` section:
- default list columns
- default sorting
- default main filters
- form field groups

The visible BA draft should render the UX section as a short bullet list, not as a table.

## Assumptions used for the draft requirements

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

## Business Logic Quality Bar

The business logic section is incomplete if it only restates the workflow.

It must explicitly define:
- what is the minimum record needed to start work
- what statuses or lifecycle states matter operationally
- what is considered inactive, archived, overdue, duplicate, or unresolved when relevant
- what the team must see or control in day-to-day work
- which supporting records are required to make the process operationally usable

## Pre-analysis Pass

Before presenting the BA draft to the developer, run a pre-analysis pass across all draft sections and assumptions.

The pre-analysis must check for:
- contradictions between business context, process, data model, UX assumptions, and assumptions
- business logic that is not reflected in the data model or cannot be supported by the described UX
- required fields in business logic that are not marked as required in the data model
- defaults that do not identify a concrete `schema default`, `ui default`, or explicit absence of default
- sorting, filtering, analytics, or ownership expectations that do not map to explicit fields or business objects
- lookup usage that is inconsistent across entities or too broad for the stated business scope
- supporting entities whose required parent links or cross-field constraints are not explicitly captured
- assumptions that contradict confirmed answers
- visible BA draft formatting that violates the fixed document contract
- markdown tables outside the data model section
- checklist-source language leaking into the visible BA draft

If pre-analysis finds a material issue:
- ask a targeted follow-up question when the issue changes business intent or acceptance
- otherwise resolve it as an explicit assumption before showing the draft

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
If a group is assumed, the same assumption text must be listed in the top-level `assumptions` array before approval is written.

If not complete, continue clarification and do not proceed to implementation planning.

## Clarification Strategy

- Ask questions in themed batches, not all at once.
- Prefer 3-5 decision-driving questions for the initial discovery pass.
- Keep the full discovery within 3-7 questions unless the request is unusually ambiguous.
- Keep each question tied to one checklist gap.
- If answer is ambiguous, rephrase and request concrete values.
- Prefer business language; avoid technical implementation details unless required as blockers.
- Prefer option-based prompts over open-ended questions whenever deterministic defaults are possible.
- when the request contains category, lifecycle, or secondary-entity ambiguity, resolve it explicitly before finalizing the BA draft

## Technical Minimalism Boundary

Technical questions are allowed only for:
- execution blockers (URL, access, credentials)

In `planning-first`, those runtime inputs may remain deferred until implementation is requested.

All other technical values should use deterministic defaults and be documented later in plan artifacts.

## Display Field Defaulting

- For `BaseLookup`, default the display field to inherited `Name`.
- For template-created app section entities, default the record title to `Name` when the schema snapshot already contains it.
- For a new app with one primary record type, default that record type to the template-created section entity whose schema name matches the app code. Do not invent a second entity name for the same records.
- Add a separate title-like column such as `UsrTitle` only when the developer explicitly needs a business field that is different from the record name.

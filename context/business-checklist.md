# Business Clarification Checklist

Use this checklist for natural-language app requests before moving to implementation planning.

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

## Checklist Items

## 1. Business Outcome

Required:
- app purpose
- business goal
- core problem / pain point
- expected result, KPI, or success signal
- MVP scope boundaries when they materially affect the first release

The first discovery questions should focus here before moving into lower-level detail.

## 2. Core Problem

Required:
- current operational pain points
- visibility, coordination, manual work, or system gaps the app should address
- why the current process is insufficient

## 3. Actors and Roles

Required:
- who uses the app
- who can create/update/close records
- who owns key approvals or responsibilities

## 4. Domain Model

Required:
- main entities
- whether the app has one primary record type or several distinct business objects
- lookup entities for enum-like fields
- key relationships
- record title / primary display field for each entity and lookup

## 5. Lifecycle and Statuses

Default unless critical:
- lifecycle stages/statuses
- transition expectations when restrictions matter

If the developer does not define lifecycle detail, propose a practical default and mark it as an assumption.

## 6. Business Rules

Default unless critical:
- required fields
- defaults
- validation rules
- restrictions and edge constraints

If a rule changes compliance, ownership, or acceptance outcome, treat it as required clarification instead of a default.

## 7. UX Expectations

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

## 8. Edge Cases and Exceptions

Ask only if business-critical:
- exceptional flows
- invalid input behavior
- conflict/duplicate handling if relevant

If the omission does not affect compliance or acceptance, capture the default handling as an assumption.

## 9. Acceptance Criteria

Required:
- concrete business-level checks that define "done"

## 10. Personas, Access Restrictions, and Ownership Boundaries

Required:
- the main personas and their business responsibilities
- whether record ownership or confidentiality rules are required

If restrictions are not essential, explicitly state:
- `No specific access restrictions are required by default.`

Do not suggest optional restrictions without a business reason.

## 11. Analytics

Required at least at draft level:
- operational metrics
- usage or participation metrics when relevant
- business impact metrics or KPI signals when relevant
- a simple business funnel when the process naturally supports one

If full metric detail is missing, define a practical draft set and mark it as an assumption.

## Completion Criteria

Set `businessChecklistComplete=true` only when:
- all required checklist items are answered, and
- optional/defaulted items are either answered or documented in assumptions and explicitly accepted by the developer.

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

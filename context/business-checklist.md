# Business Clarification Checklist

Use this checklist for natural-language app requests before moving to implementation planning.

## Goal

Ensure business requirements are complete enough to generate a usable Creatio composable app without hidden product decisions.

## Checklist Items

## 1. Business Outcome

Required:
- app purpose
- expected result/KPI or success signal

## 2. Actors and Roles

Required:
- who uses the app
- who can create/update/close records

## 3. Domain Model

Required:
- main entities
- whether the app has one primary record type or several distinct business objects
- lookup entities for enum-like fields
- key relationships
- record title / primary display field for each entity and lookup

## 4. Lifecycle and Statuses

Required:
- lifecycle stages/statuses
- transition expectations (if any restrictions exist)

## 5. Business Rules

Required:
- required fields
- defaults
- validation rules
- restrictions and edge constraints

## 6. UX Expectations

Required:
- list page columns
- form page field groups/layout notes
- which field is shown as the record title in lists and forms
- sorting/filtering expectations if important

## 7. Edge Cases and Exceptions

Required:
- exceptional flows
- invalid input behavior
- conflict/duplicate handling if relevant

## 8. Acceptance Criteria

Required:
- concrete business-level checks that define “done”

## Completion Criteria

Set `businessChecklistComplete=true` only when:
- all required checklist items are answered, or
- unresolved items are documented in assumptions and explicitly accepted by developer.

If not complete, continue clarification and do not proceed to implementation planning.

## Clarification Strategy

- Ask questions in themed batches, not all at once.
- Keep each question tied to one checklist gap.
- If answer is ambiguous, rephrase and request concrete values.
- Prefer business language; avoid technical implementation details unless required as blockers.

## Technical Minimalism Boundary

Technical questions are allowed only for:
- execution blockers (URL, access, credentials)

All other technical values should use deterministic defaults and be documented later in plan artifacts.

## Display Field Defaulting

- For `BaseLookup`, default the display field to inherited `Name`.
- For template-created app section entities, default the record title to `Name` when the schema snapshot already contains it.
- For a new app with one primary record type, default that record type to the template-created section entity whose schema name matches the app code. Do not invent a second entity name for the same records.
- Add a separate title-like column such as `UsrTitle` only when the developer explicitly needs a business field that is different from the record name.

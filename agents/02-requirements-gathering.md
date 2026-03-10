# Agent 02 — Requirements Gathering

## Role

Analyze developer's natural-language request, run business-first clarification, and produce structured requirements plus normalized request spec.

## ⛔ INTERACTIVE — DO NOT DELEGATE

**MUST** interact directly with developer. Do NOT delegate to sub-agent or background task.

## Input/Output

- **Input:** Natural language app description, `<AppName>`
- **Output:**
  - `output/<AppName>/requirements.md`
  - `output/<AppName>/request-spec.json`
  - `output/<AppName>/workflow-state.json`

## Context

Read:
- `AGENTS.md`
- `context/essentials.md`
- `context/business-checklist.md`

---

## Steps

### 1. Parse Prompt and Show Understanding

From developer's free-form prompt, derive:
- app intent and expected section scope
- candidate entities/lookups/pages
- potential lifecycle/status model

Return a short summary:
- “What I understood”
- “What still needs clarification”

### 2. Run Business Clarification Checklist (MANDATORY)

Use `context/business-checklist.md` as canonical checklist.

Clarification rules:
- Ask in themed batches (not one giant questionnaire).
- Keep focus on business requirements.
- Re-ask ambiguous answers until concrete.
- If developer asks to start implementation before completion, return only missing checklist items and ask only-missing questions.

Mandatory checklist groups:
- business outcome
- actors and roles
- domain model
- lifecycle and statuses
- business rules
- UX expectations (list/form)
- edge cases
- acceptance criteria

Do not proceed until checklist is complete.

### 3. Ask Minimal Technical Questions

Ask only:
- blocker technical inputs (for example: Creatio URL, credentials/access if missing)

Do not ask for MCP/template/icon details if defaults can be resolved deterministically.

### 4. Build `request-spec.json`

Create normalized request spec:

```json
{
  "sourcePrompt": "<original developer prompt>",
  "businessChecklist": {
    "businessOutcome": {"complete": true, "value": "..."},
    "actorsAndRoles": {"complete": true, "value": "..."},
    "domainModel": {"complete": true, "value": "..."},
    "lifecycleAndStatuses": {"complete": true, "value": "..."},
    "businessRules": {"complete": true, "value": "..."},
    "uxExpectations": {"complete": true, "value": "..."},
    "edgeCases": {"complete": true, "value": "..."},
    "acceptanceCriteria": {"complete": true, "value": "..."},
    "complete": true
  },
  "technicalInputs": {
    "creatioUrl": "<url>",
    "credentialsStatus": "provided|missing|existing_env"
  },
  "assumptions": [
    "<explicit assumption 1>",
    "<explicit assumption 2>"
  ]
}
```

Do not use a shortened request spec. Every key shown above is mandatory when `businessChecklist.complete=true`.

### 5. Generate `requirements.md`

Write requirements document in this format:

```markdown
# <AppName> — Requirements

## App Overview

<2-3 sentence description>

## Business Decisions Locked

- Goal/KPI: ...
- Roles: ...
- Lifecycle: ...
- Acceptance criteria: ...

## MCP Application Create Input

- name: <Display Name>
- code: <Usr...>
- templateCode: <AppFreedomUI|...>
- description: <optional>
- clientTypeId: <optional GUID>
- optionalTemplateData:
  - useExistingEntitySchema: <true|false>
  - entitySchemaName: <name or empty>
  - appSectionDescription: <optional>
  - useAIContentGeneration: <true|false>
- icon:
  - iconId: <GUID or `auto`>
  - iconBackground: <hex or `auto`>

## Entities

### <EntityName> (extends BaseEntity)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| UsrName | Text (250) | Yes | — | Display name |
| UsrStatus | Lookup → UsrEntityStatus | Yes | New | Current status |

### <LookupName> (extends BaseLookup)

**Purpose**: <description>

**Seed Data**:
| Name |
|------|
| Value 1 |
| Value 2 |

## Pages

### <EntityName> List Page
Columns: UsrName, UsrStatus, UsrPriority, CreatedOn

### <EntityName> Form Page
- Header: UsrName
- Fields: UsrDescription, UsrStatus, UsrPriority, UsrDueDate
- Layout notes: <notes>

## Relationships

- <EntityName>.UsrStatus → UsrEntityStatus (many-to-one lookup)
- <EntityName>.UsrPriority → UsrEntityPriority (many-to-one lookup)

## Business Rules

- <rule 1>
- <rule 2>

## Assumptions

- <assumption 1>
- <assumption 2>
```

### 6. Natural-Language Approval

Present:
- short “What I understood” summary
- final `requirements.md` content
- explicit “Starting implementation” message after approval

Ask for natural-language approval (no token request).

Examples of valid confirmation:
- “Так, все вірно, запускай”
- “Approved, proceed”

If developer requests changes, update and re-present.
Persist the exact approval text verbatim and use it when writing Gate R state.

### 7. Persist Workflow State (MANDATORY)

After natural-language approval:

1. Persist internal Gate R approval and UX fields with:
```bash
scripts/write-approval-state.sh <AppName> "<approvedBy>" "<approvalText>"
```

2. Write `output/<AppName>/request-spec.json`.
3. Do not create or edit `workflow-state.json` manually.

## Critical Rules

1. Output is business requirements only. No GUID matrices, no generated file content.
2. All entity and field names must start with `Usr`.
3. Do not add inherited columns from `BaseEntity`.
4. Enum-like fields must be separate lookup entities.
5. One package per app (`Usr<AppName>`).
6. `BaseLookup` already has `Name`; do not re-add it.
7. If `useAIContentGeneration=true`, mark as unsupported for this MCP flow and require `false` before implementation.
8. If `useExistingEntitySchema=true`, require non-empty `entitySchemaName`.
9. Do not proceed to Agent 3 unless `businessChecklist.complete=true`.
10. If checklist is incomplete, continue clarification and do not ask additional technical questions beyond blockers.

## Completion Criteria

✅ Developer approved in natural language  
✅ `output/<AppName>/requirements.md` exists  
✅ `output/<AppName>/request-spec.json` exists  
✅ `output/<AppName>/workflow-state.json` exists with:
- `requirementsApproved: true`
- `interactionMode: "nl-business-first"`
- `businessChecklistComplete: true`
- `approvalSource: "natural-language"`
- `approvalText: "<verbatim developer confirmation>"`
✅ Requirements include “Business Decisions Locked” and “Assumptions” sections  

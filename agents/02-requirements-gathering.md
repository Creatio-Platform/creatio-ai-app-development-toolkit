# Agent 02 — Requirements Gathering

## Role

Analyze developer's app description, ask questions, produce structured requirements including MCP `application.create` inputs.

## ⛔ INTERACTIVE — DO NOT DELEGATE

**MUST** interact directly with developer. Do NOT delegate to sub-agent or background task.

## Input/Output

- **Input:** Natural language app description, `<AppName>`
- **Output:** `output/<AppName>/requirements.md`, `output/<AppName>/workflow-state.json`

## Context

Read `AGENTS.md` for Context Files Reference (specifically `context/essentials.md` for platform capabilities and app-create flow).

---

## Steps

### 1. Challenge the Idea

Analyze request, present full feature list and expected section scope:

> "Based on your description, I see:
> - Main entity: X with fields A, B, C
> - Lookups: Status, Priority
> - Pages: List + Form
> - App creation via MCP `application.create`
>
> Does this match your vision?"

Wait for confirmation before proceeding.

### 2. Ask Mandatory Questions

Group logically, do not dump all at once.

Business scope:
- Entities: "What are main objects? (I see: X, Y — anything else?)"
- Fields: "What fields for main entity? Data types?"
- Lookups: "Initial status values? Priority levels? Other dropdowns?"
- Pages: "List view columns? Form page organization?"
- Rules: "Required fields? Defaults? Validation?"

MCP app-create inputs:
- `name`: app display name
- `code`: app code (must start with `Usr`)
- `templateCode`: default `AppFreedomUI` unless developer requests another template
- `description`: optional text
- `clientTypeId`: optional GUID
- `optionalTemplateData`:
  - `useExistingEntitySchema` (bool)
  - `entitySchemaName` (required if `useExistingEntitySchema=true`)
  - `appSectionDescription` (optional)
  - `useAIContentGeneration` (bool, preview mode does not support `true`)
- `iconId` strategy:
  - explicit `iconId` from developer, or
  - auto-selection from `SysAppIcons` during implementation
- `iconBackground` strategy:
  - explicit value from developer, or
  - deterministic palette pick during implementation

### 3. Iterate Until Clear

Keep asking until complete picture.
If vague, ask specifics.

### 4. Generate requirements.md

Write requirements document in this format:

```markdown
# <AppName> — Requirements

## App Overview

<2-3 sentence description>

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
```

### 5. Get Approval

Present full `requirements.md` content to developer and ask for exact token:

`APPROVE_REQUIREMENTS`

- If developer requests changes, update and re-present.
- Do not proceed without explicit token.

### 6. Persist Approval State (MANDATORY)

After receiving `APPROVE_REQUIREMENTS`, create:

`output/<AppName>/workflow-state.json`

Use:
```bash
scripts/write-approval-state.sh <AppName> "<approvedBy>"
```

## Critical Rules

1. Output is business requirements only. No GUID matrices, no generated file content.
2. All entity and field names must start with `Usr`.
3. Do not add inherited columns from `BaseEntity`.
4. Enum-like fields must be separate lookup entities.
5. One package per app (`Usr<AppName>`).
6. `BaseLookup` already has `Name`; do not re-add it.
7. If `useAIContentGeneration=true`, mark it as unsupported for preview mode and require change to `false` before implementation.
8. If `useExistingEntitySchema=true`, require non-empty `entitySchemaName`.

## Completion Criteria

✅ Developer approved with exact token  
✅ `output/<AppName>/requirements.md` exists  
✅ `output/<AppName>/workflow-state.json` exists with `requirementsApproved: true`  
✅ `workflow-state.json.appName` equals `<AppName>`  
✅ `workflow-state.json.requirementsSha256` matches `requirements.md`  
✅ Requirements include MCP app-create input section  
✅ Entities/lookups/pages/rules are defined clearly  

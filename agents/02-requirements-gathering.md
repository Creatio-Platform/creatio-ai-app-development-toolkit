# Agent 02 — Requirements Gathering

## Role

Analyze developer's app description, ask questions, produce structured requirements.

## ⛔ INTERACTIVE — DO NOT DELEGATE

**MUST** interact directly with developer. Do NOT delegate to sub-agent or background task.

## Input/Output

- **Input:** Natural language app description, `<AppName>`
- **Output:** `output/<AppName>/requirements.md`

## Context

Read `AGENTS.md` for Context Files Reference (specifically `context/essentials.md` for platform capabilities).

---

## Steps

### 1. Challenge the Idea

Analyze request, present full feature list:

> "Based on your description, I see:
> - Main entity: X with fields A, B, C
> - Lookups: Status, Priority
> - Pages: List + Form
> 
> Does this match your vision?"

Wait for confirmation before proceeding.

### 2. Ask Mandatory Questions

Group logically, don't dump all at once:

**Entities:** "What are main objects? (I see: X, Y — anything else?)"

**Fields:** "What fields for main entity? Data types?"

**Lookups:** "Initial status values? Priority levels? Other dropdowns?"

**Pages:** "List view columns? Form page organization?"

**Rules:** "Required fields? Defaults? Validation?"

### 3. Iterate Until Clear

Keep asking until complete picture. If vague → ask specifics.

### 4. Generate requirements.md

Write the requirements document in the following format:

```markdown
# <AppName> — Requirements

## App Overview

<2-3 sentence description of the app's purpose>

## Entities

### <EntityName> (extends BaseEntity)

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| UsrName | Text (250) | Yes | — | Display name |
| UsrStatus | Lookup → UsrEntityStatus | Yes | New | Current status |
| ... | ... | ... | ... | ... |

### <LookupName> (extends BaseLookup)

**Purpose**: <what this lookup represents>

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
- Layout notes: <any specific layout preferences>

## Relationships

- <EntityName>.UsrStatus → UsrEntityStatus (many-to-one lookup)
- <EntityName>.UsrPriority → UsrEntityPriority (many-to-one lookup)

## Business Rules

- <rule 1>
- <rule 2>
```

### 5. Get Approval

Present the full `requirements.md` content to the developer and ask:

> Here are the final requirements. Please review:
> [requirements content]
>
> Is everything correct? Any changes needed?

- If the developer requests changes — update and re-present.
- **Do NOT proceed to the next phase without explicit developer approval.**

## Critical Rules

1. **Output is ONLY business requirements** — NO GUIDs, NO technical schema details, NO file paths. Just entities, fields, lookups, seed data, pages, and rules.
2. **All entity and field names must start with `Usr` prefix** (e.g., `UsrTask`, `UsrName`, `UsrStatus`).
3. **Do NOT add inherited columns** — `Id`, `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy` come from `BaseEntity` automatically. Never list them as fields.
4. **Enum-like fields must be separate lookup entities** — extends `BaseLookup`. Do not use hardcoded string enums.
5. **One package per app** — all entities, pages, and lookups go into a single package named `Usr<AppName>`.
6. **BaseLookup entities** already have `Name` column — do not re-add it. Only list `Name` values in the Seed Data section.

## Completion Criteria

✅ Developer has approved the requirements  
✅ `output/<AppName>/requirements.md` exists  
✅ Every entity has clear fields, types, and required/default info  
✅ Every lookup has seed data values  
✅ Pages have defined column/field layouts  

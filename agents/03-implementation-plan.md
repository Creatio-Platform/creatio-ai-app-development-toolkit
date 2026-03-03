# Agent 03 — Implementation Plan Generator

## Role

Transform approved requirements into a technical implementation plan with all GUIDs pre-generated.

## Input/Output

- Input: `output/<AppName>/requirements.md`, `output/<AppName>/workflow-state.json`
- Output: `output/<AppName>/plan.md`

## Context

Read:
- `context/schema-reference.md`
- `context/essentials.md`
- `context/data-bindings-reference.md`

## Steps

### 0. Check Gate R (mandatory)

Run:
```bash
scripts/check-approval-gate.sh <AppName>
```

If this fails, stop immediately and report blocker.

### 1. Parse requirements

Extract:
- Package name
- Lookup entities and seed values
- Main entities and columns
- Pages (list/form)
- Business rules affecting required/default fields

### 2. Generate GUID set

Generate unique lowercase GUIDs for:
- Package UId
- Entity UIds
- Entity column UIds
- Page UIds
- Addon UIds
- Data-binding descriptor UIds
- Data-binding record Ids
- Grid column ids in list page JS
- Seed data record Ids

### 3. Define generation order

Use this strict order:
1. Lookup entities (BaseLookup)
2. Main entities (BaseEntity)
3. List pages
4. Form pages
5. Addons
6. Data bindings (SysModuleEntity, SysModule)
7. Seed data

### 4. Build plan sections

Create `plan.md` with these sections:
- Package
- Generation Order
- Entities
- Pages
- Addons
- Data Bindings
- Lookup Seed Data

For each entity include:
- Name, UId, parent name and parent UId
- Columns with: name, UId, DVT name, DVT GUID, numeric DVT
- For lookup columns: referenced schema name + UId

For each page include:
- Name, UId
- Parent template + parent UId
- Target entity
- Grid columns (list page) or field layout (form page)

For addons include:
- Addon schema name + UId
- Target entity UId
- Form page UId

For bindings include:
- `SysModuleEntity_<Entity>` record Id + entity UId
- `SysModule_<Entity>` record Id + refs to module entity/form/list page
- Standard values from `context/data-bindings-reference.md`

### 5. Validate plan consistency

Check:
- All GUIDs unique
- All references resolvable
- Lookup entities appear before entities that reference them
- DVT GUIDs come only from `context/schema-reference.md`
- Parent UIds come only from `context/schema-reference.md`

### 6. Save `plan.md`

Write final plan to:
- `output/<AppName>/plan.md`

## Rules

1. Do not add inherited columns.
2. All custom names start with `Usr`.
3. Do not invent parent UIds or DVT GUIDs.
4. Use `ListPageV3Template` for list pages and `PageWithTabsFreedomTemplate` for form pages.
5. Keep plan deterministic and implementation-ready.

## Completion Criteria

- `workflow-state.json` confirms Gate R approval
- `output/<AppName>/plan.md` exists
- Every artifact has a unique GUID
- DVT GUIDs and parent UIds match `context/schema-reference.md`
- Cross-references are consistent across entities/pages/addons/bindings

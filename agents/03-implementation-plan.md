# Agent 03 — Implementation Plan Generator

## Role

Transform approved requirements into technical plan with all GUIDs pre-generated.

## Input/Output

- **Input:** `output/<AppName>/requirements.md`
- **Output:** `output/<AppName>/plan.md`

## Context

Read `AGENTS.md` for Context Files Reference (specifically `context/schema-reference.md` for GUIDs/types, `context/essentials.md` for structure/naming).

---

## Steps

### 1. Generate All GUIDs

Generate unique GUID (lowercase `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`) for:
- Package, entities, columns, pages, addons, bindings, records

### 2. Define Generation Order

Strict dependency order:
1. Lookup entities (BaseLookup)
2. Main entities (BaseEntity)
3. List pages
4. Form pages
5. Addons
6. Data bindings (SysModule, SysModuleEntity)
7. Seed data

### 3. Define Each Entity

For every entity, write the following block:

```
Entity: UsrTaskStatus
UId: a1b2c3d4-e5f6-7890-abcd-ef1234567890
Parent: BaseLookup (11ab4bcb-9b23-4b6d-9c86-520fae925d75)
Columns: (none — BaseLookup provides Name, Description)
```

For entities with columns:

```
Entity: UsrTask
UId: f9e8d7c6-b5a4-3210-fedc-ba0987654321
Parent: BaseEntity (1bab9dcf-17d5-49f8-9536-8e0064f1dce0)
Columns:
  - UsrName: UId=11111111-2222-3333-4444-555555555555, DVT=Text(250) (8b3f29bb-ea14-4ce5-a5c5-293571e9d8b3) [numeric DVT=1]
  - UsrDescription: UId=22222222-3333-4444-5555-666666666666, DVT=Text(500) (8b3f29bb-ea14-4ce5-a5c5-293571e9d8b3) [numeric DVT=1]
  - UsrStatus: UId=33333333-4444-5555-6666-777777777777, DVT=Lookup (b295071f-7ea9-4e62-8d1a-919bf3732ff2) [numeric DVT=10], ReferenceSchema=UsrTaskStatus (a1b2c3d4-e5f6-7890-abcd-ef1234567890)
  - UsrDueDate: UId=44444444-5555-6666-7777-888888888888, DVT=Date (d21e9ef4-c064-4012-b286-fa1a8171da2e) [numeric DVT=8]
```

### 4. Define Each Page

```
ListPage: UsrTask_ListPage
UId: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
Parent: ListPageV3Template (b7b898d0-8b1c-4a64-8310-005c2e523c76)
SchemaType: AngularSchema
DataGrid columns: UsrName, UsrStatus, UsrDueDate
```

```
FormPage: UsrTask_FormPage
UId: bbbbbbbb-cccc-dddd-eeee-ffffffffffff
Parent: PageWithTabsFreedomTemplate (3b2e117f-efac-49a2-a9f5-0f2e4e8f1496)
SchemaType: AngularSchema
Fields:
  Row1: UsrName (Input)
  Row2: UsrDescription (Input, multiline)
  Row3: UsrStatus (ComboBox), UsrPriority (ComboBox)
  Row4: UsrDueDate (DatePicker)
```

### 5. Define Each Addon

```
Addon: UsrTask_FormPage_Addon
UId: cccccccc-dddd-eeee-ffff-aaaaaaaaaaaa
TargetEntity: UsrTask (f9e8d7c6-b5a4-3210-fedc-ba0987654321)
FormPage: UsrTask_FormPage (bbbbbbbb-cccc-dddd-eeee-ffffffffffff)
```

### 6. Define Data Bindings

```
SysModuleEntity:
  Id: dddddddd-eeee-ffff-aaaa-bbbbbbbbbbbb
  SysEntitySchemaUId: f9e8d7c6-b5a4-3210-fedc-ba0987654321 (UsrTask)

SysModule:
  Id: eeeeeeee-ffff-aaaa-bbbb-cccccccccccc
  SysModuleEntityId: dddddddd-eeee-ffff-aaaa-bbbbbbbbbbbb
  CardSchemaUId: bbbbbbbb-cccc-dddd-eeee-ffffffffffff (UsrTask_FormPage)
  SectionSchemaUId: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee (UsrTask_ListPage)

LookupSeed: UsrTaskStatus
  Records:
    - { Id: 11111111-aaaa-bbbb-cccc-dddddddddddd, Name: "New" }
    - { Id: 22222222-aaaa-bbbb-cccc-dddddddddddd, Name: "In Progress" }
    - { Id: 33333333-aaaa-bbbb-cccc-dddddddddddd, Name: "Done" }
```

### 7. Save plan.md

Write the complete plan to `output/<AppName>/plan.md` with all sections above.

## Rules

1. **Every GUID must be unique** across the entire plan. No duplicates anywhere.
2. **Lookups before entities** — generation order matters because entities reference lookups.
3. **DVT GUIDs must come from `context/entity-types.md`** — never invent DataValueType GUIDs.
4. **Parent UIds must come from KNOWN_PARENTS** in `context/entity-types.md` — never invent parent GUIDs.
5. **Do NOT include inherited columns** — `Id`, `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy` come from `BaseEntity`/`BaseLookup` automatically.
6. **Column names must start with `Usr` prefix** — e.g., `UsrName`, `UsrStatus`.
7. **Entity names must start with `Usr` prefix** — e.g., `UsrTask`, `UsrTaskStatus`.
8. **Page names follow pattern** `<EntityName>_ListPage` and `<EntityName>_FormPage`.
9. **Addon names follow pattern** `<EntityName>_FormPage_Addon`.

## Completion Criteria

✅ `output/<AppName>/plan.md` exists  
✅ Every artifact has a unique GUID  
✅ All DVT GUIDs match `context/entity-types.md`  
✅ All parent UIds match KNOWN_PARENTS  
✅ Cross-references are consistent (entity UIds used in pages/addons/bindings match entity definitions)  
✅ Generation order is explicit: lookups → entities → pages → addons → bindings → seed data  

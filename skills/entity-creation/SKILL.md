---
name: entity-creation
description: Generate Creatio entity schema files (descriptor.json, metadata.json, properties.json). Use when implementing entities from plan.md — creates 3 files per entity in Schemas/<EntityName>/ with correct DSL diff format, parent inheritance (BaseEntity/BaseLookup), and all required GUIDs.
compatibility: Requires access to context/schema-reference.md and templates/entity/ directory
metadata:
  version: "2.0"
  category: creatio-schema-generation
---

# Entity Schema File Generator

Generate complete entity schema files for Creatio composable apps. Each entity produces exactly 3 files with proper inheritance and metadata.

## What This Skill Does

Transforms entity definitions from `plan.md` into properly formatted Creatio schema files:
- **descriptor.json** — Schema identity, parent reference, manager
- **metadata.json** — DSL diff format with columns and configuration
- **properties.json** — Property flags

## When to Use

Use this skill when:
- Implementing entities defined in a technical plan
- Creating new BaseEntity or BaseLookup entities
- Need exact Creatio schema format with DSL diff syntax

## Input Expected

From `plan.md`, you need:
- Entity name (e.g., `UsrTodoTask`)
- Entity UId (pre-generated GUID)
- Parent type (`BaseEntity` or `BaseLookup`)
- Parent UId (from KNOWN_PARENTS)
- Package UId
- Caption (display name)
- Columns array (for BaseEntity only — BaseLookup has no custom columns)

Each column needs: `name`, `uid`, `dataValueType`, `dataValueTypeGuid`  
Lookup columns also need: `lookupEntityUId`, `lookupFkColumn`, `lookupDisplayColumn`

## Context to Read First

Before generating, read:
- `context/schema-reference.md` — For KNOWN_PARENTS, KNOWN_DVT, BASE_ENTITY_COLS
- `templates/entity/base-entity/` OR `templates/entity/base-lookup/` — For exact format

The templates are your source of truth for structure. Copy them and replace placeholders.

---

## How It Works

### 1. descriptor.json Format

Use this exact structure:

```json
{
  "Descriptor": {
    "UId": "<entityUId>",
    "Name": "<entityName>",
    "ModifiedOnUtc": "/Date(<timestamp>)/",
    "Parent": {
      "UId": "<parentUId>",
      "Name": "<parentType>"
    },
    "ManagerName": "EntitySchemaManager",
    "Caption": "<caption>",
    "DependsOn": []
  }
}
```

**Key points:**
- `<timestamp>` = current milliseconds since Unix epoch
- `Parent.UId` from KNOWN_PARENTS (BaseEntity: `1bab9dcf-17d5-49f8-9536-8e0064f1dce0`, BaseLookup: `11ab4bcb-9b23-4b6d-9c86-520fae925d75`)
- Never add `ExtendParent` for new entities
- `DependsOn` always `[]` for new entities

### 2. metadata.json — DSL Diff Format

This is critical: metadata.json uses a DSL diff format, **not plain JSON**. Each line starts with an operator:

- `=` (set/unchanged) — Setting a value
- `+` (add) — Adding new content
- `~` (reorder) — Reordering an array

**Start with these lines** (replace placeholders):

```
= MetaData.Schema.UId "<entityUId>"
= MetaData.Schema.A2 "<entityName>"
= MetaData.Schema.A5 "<packageUId>"
= MetaData.Schema.B6 "<packageUId>"
= MetaData.Schema.EG1.UId "<eventsProcessUId>"
= MetaData.Schema.EG1.A2 "Entity_<hash>EventsProcess"
= MetaData.Schema.EG1.A5 "<packageUId>"
+ MetaData.Schema.EG1.B8 "0.0.0.0"
= MetaData.Schema.EG1.BK8 "<processSchemaUId>"
= MetaData.Schema.D8 "<parentUId>"
+ MetaData.Schema.D29 "null"
+ MetaData.Schema.D30 "null"
+ MetaData.Schema.D31 "null"
```

Note: `<hash>` = random 7-char hex (e.g., `a3f2b1c`) for unique events process name.

**Add custom columns** (BaseEntity only):

For each column in your plan:

```
+ MetaData.Schema.D2 {
  "UId": "<columnUId>",
  "A2": "<columnName>",
  "A3": "<entityUId>",
  "A4": "<entityUId>",
  "A5": "<packageUId>",
  "S2": "<dataValueTypeGuid>"
}
```

**For Lookup columns, add these fields inside the same block:**

```json
  "S4": "<lookupEntityUId>",
  "E6": true,
  "E9": true,
  "E17": "<lookupFkColumn>",
  "E18": "<lookupDisplayColumn>"
```

Note: E17 = FK column name (typically `<ColumnName>Id`), E18 = display column (typically `Name`).

**Reorder array** — This lists ALL columns in order (inherited + custom):

```
~ MetaData.Schema.D2 [
  "ae0e45ca-c495-4fe7-a39d-3ab7278e1617",  // Id
  "e80190a5-03b2-4095-90f7-a193a960adee",  // CreatedOn
  "ebf6bb93-8aa6-4a01-900d-c6ea67affe21",  // CreatedBy
  "9928edec-4272-425a-93bb-48743fee4b04",  // ModifiedOn
  "3015559e-cbc6-406a-88af-07f7930be832",  // ModifiedBy
  "3fabd836-6a53-4d8d-9069-6df88d9dae1e",  // ProcessListeners
  "<column1Uid>",
  "<column2Uid>"
]
```

Note: List inherited columns first (UIds from BASE_ENTITY_COLS), then custom columns.

**D20 block** — Copy this **exactly as-is**:

```
= MetaData.Schema.D20.A2 "<entityName>Events"
+ MetaData.Schema.D20.FA1 false
+ MetaData.Schema.D20.FA2 false
+ MetaData.Schema.D20.FA3 false
= MetaData.Schema.D20.FA4 false
= MetaData.Schema.D20.FA5 false
= MetaData.Schema.D20.FA6 false
= MetaData.Schema.D20.FA7 false
+ MetaData.Schema.D20.FA8 false
+ MetaData.Schema.D20.FA9 false
+ MetaData.Schema.D20.FA10 false
= MetaData.Schema.D20.FA11 false
= MetaData.Schema.D20.FA12 false
+ MetaData.Schema.D20.FA16 false
+ MetaData.Schema.D20.FA13 false
+ MetaData.Schema.D20.FA14 false
= MetaData.Schema.D20.FA15 false
+ MetaData.Schema.D20.FA17 false
```

**Critical:** Copy operators (`=` vs `+`) exactly — they configure event handlers.

**Admin rights and E16 flags:**

```
= MetaData.Schema.D36.A3 "<entityUId>"
= MetaData.Schema.D36.BS1 false
+ MetaData.Schema.B7 false
+ MetaData.Schema.D2.["ae0e45ca-c495-4fe7-a39d-3ab7278e1617"].E16 false
+ MetaData.Schema.D2.["e80190a5-03b2-4095-90f7-a193a960adee"].E16 false
+ MetaData.Schema.D2.["ebf6bb93-8aa6-4a01-900d-c6ea67affe21"].E16 false
+ MetaData.Schema.D2.["9928edec-4272-425a-93bb-48743fee4b04"].E16 false
+ MetaData.Schema.D2.["3015559e-cbc6-406a-88af-07f7930be832"].E16 false
+ MetaData.Schema.D2.["3fabd836-6a53-4d8d-9069-6df88d9dae1e"].E16 false
```

Note: E16 flags **only** for inherited BaseEntity columns, **not** custom columns.

**For BaseLookup:** The structure is similar but simpler. No custom columns are added. The reorder array includes 8 UIds (6 from BaseEntity + 2 from BaseLookup: Name and Description). See `templates/entity/base-lookup/metadata.json` for the exact format.

### 3. properties.json

Always use this exact structure (same for both BaseEntity and BaseLookup):

```json
{
  "Properties": {
    "AdministratedByColumns": "False",
    "AdministratedByOperations": "False",
    "AdministratedByRecords": "False",
    "CreatedInVersion": "0.0.0.0",
    "IsSSPAvailable": "False",
    "IsTrackChangesInDB": "False",
    "IsVirtual": "False",
    "UseLiveEditing": "False"
  }
}
```

Note: Standard values for custom entities in composable apps.

---

## Critical Rules

**Never add inherited columns yourself:**
- Id, CreatedOn, CreatedBy, ModifiedOn, ModifiedBy, ProcessListeners come from BaseEntity
- Name, Description come from BaseLookup
- If you add them manually, you'll create duplicates

**BaseLookup entities have NO custom columns:**
- They only inherit Name + Description
- If your plan shows a BaseLookup with custom columns, that's an error — flag it

**All GUIDs must be unique and lowercase:**
- Format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- Never reuse GUIDs across schemas
- Generate new ones for: entityUId, eventsProcessUId, processSchemaUId, each columnUId

**Operators matter in DSL diff:**
- Copy the `=` vs `+` operators exactly from templates
- Don't change them based on "logic" — they're specific to Creatio's merge system

**E16 flags only for inherited columns:**
- Add E16 for the 6 BaseEntity columns (or 8 if BaseLookup)
- Never add E16 for your custom columns

---

## Validation Checklist

Before finalizing files, verify:

- ✅ Entity name starts with `Usr`
- ✅ All column names start with `Usr`
- ✅ All GUIDs are lowercase with dashes
- ✅ No inherited columns in custom column definitions
- ✅ Lookup columns have S4, E6, E17, E18 fields
- ✅ Reorder array lists all inherited UIds + custom column UIds
- ✅ D20 block copied exactly from template
- ✅ E16 flags only for inherited columns

---

## Output

Generate all 3 files directly to: `output/<AppName>/packages/<PackageName>/Schemas/<EntityName>/`

When done, confirm: "Generated entity schema files for `<EntityName>` — ready for the next entity or next skill."

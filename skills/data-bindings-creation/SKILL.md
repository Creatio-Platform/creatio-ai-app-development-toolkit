---
name: data-bindings-creation
description: Generate SysModule and SysModuleEntity records for Creatio application sections. Use when creating navigation/sections in plan.md
compatibility: Requires access to context/bindings-lookup.json
metadata:
  version: "2.0"
  category: creatio-schema-generation
---

# Data Bindings Generator

Generate SysModule and SysModuleEntity configuration records for Creatio composable apps. These records make entities appear in the application workspace as navigable sections.

## What This Skill Does

Transforms section definitions from `plan.md` into SQL INSERT statements for:
- **SysModule**
- **SysModuleEntity**

## When to Use

Use this skill when:
- Creating navigable sections in the application workspace
- Linking entities to list/form pages
- Need exact column UIds for SysModule/SysModuleEntity tables

## Input Expected

From `plan.md`, you need:
- Section name (e.g., "Tasks")
- Section UId (pre-generated GUID)
- Icon (e.g., "star-icon")
- Entity UId
- List page UId
- Form page UId (optional, can be NULL)
- Position in workspace (integer)

## Context to Read First

Before generating, read:
- `context/bindings-lookup.json`

**Critical:** You MUST use the exact column UIds from `bindings-lookup.json`. Don't generate new ones.

---

## How It Works

### 1. Load Column UIds

Read `context/bindings-lookup.json` to get:

```json
{
  "SysModule": {
    "Id": "ae0e45ca-c495-4fe7-a39d-3ab7278e1617",
    "Caption": "...",
    "SectionSchemaUId": "...",
    "SysModuleEntityId": "..."
    // ... more columns
  },
  "SysModuleEntity": {
    "Id": "ae0e45ca-c495-4fe7-a39d-3ab7278e1617",
    "SysEntitySchemaUId": "...",
    "CardSchemaUId": "...",
    "SectionSchemaUId": "..."
    // ... more columns
  }
}
```

Note: These UIds are **not** standard GUIDs. They're specific to Creatio's metamodel. Using wrong UIds will break the workspace.

### 2. Generate SysModule INSERT

Structure:

```sql
INSERT INTO SysModule (
  [<Id_columnUId>],              -- Section UId
  [<Caption_columnUId>],         -- Section name
  [<SectionSchemaUId_columnUId>], -- List page UId
  [<SysModuleEntityId_columnUId>], -- Link to SysModuleEntity record
  [<Image32Id_columnUId>],       -- Icon
  [<SectionIconId_columnUId>],   -- Icon (same value)
  [<Position_columnUId>]         -- Position in workspace
)
VALUES (
  '<sectionUId>',
  '<sectionCaption>',
  '<listPageUId>',
  '<sysModuleEntityUId>',
  '<iconUId>',
  '<iconUId>',
  <position>
);
```

**Replace placeholders:**
- `<Id_columnUId>` → Value from `bindings-lookup.json["SysModule"]["Id"]`
- `<Caption_columnUId>` → Value from `bindings-lookup.json["SysModule"]["Caption"]`
- And so on for all columns

**Icon UIds:** Common icons have known UIds. For custom apps, you can use:
- `star-icon`: Use a standard icon UId (consult context if available)
- Or generate new icon UId (if uploading custom icon)

**Position:** Integer defining order in workspace (e.g., 0, 1, 2...). Lower numbers appear first.

### 3. Generate SysModuleEntity INSERT

Structure:

```sql
INSERT INTO SysModuleEntity (
  [<Id_columnUId>],                -- SysModuleEntity UId
  [<SysEntitySchemaUId_columnUId>], -- Entity UId
  [<CardSchemaUId_columnUId>],     -- Form page UId (or NULL)
  [<SectionSchemaUId_columnUId>],  -- List page UId
  [<TypeColumnUId_columnUId>]      -- Type column (for filtering, or NULL)
)
VALUES (
  '<sysModuleEntityUId>',
  '<entityUId>',
  '<formPageUId>',
  '<listPageUId>',
  NULL
);
```

**Replace placeholders:**
- `<Id_columnUId>` → Value from `bindings-lookup.json["SysModuleEntity"]["Id"]`
- `<SysEntitySchemaUId_columnUId>` → Value from `bindings-lookup.json["SysModuleEntity"]["SysEntitySchemaUId"]`
- And so on

**CardSchemaUId (Form page):**
- If your section has a form page, use its UId
- If it's list-only, use `NULL`

**TypeColumnUId:**
- Usually `NULL` for custom entities
- Only used if entity has a type discriminator column (rare)

---

## Critical Rules

**NEVER generate new column UIds:**
- Column UIds for SysModule/SysModuleEntity are fixed
- Always read from `bindings-lookup.json`
- If a column is missing from the JSON, flag it as an error

**Match GUIDs between tables:**
- `SysModule.SysModuleEntityId` MUST equal `SysModuleEntity.Id`
- `SysModule.SectionSchemaUId` MUST equal list page UId
- `SysModuleEntity.SectionSchemaUId` MUST equal list page UId

**SQL format:**
- Use square brackets for column identifiers: `[<guid>]`
- Use single quotes for string/GUID values: `'<guid>'`
- NULLs are unquoted: `NULL`

**Position values:**
- Must be unique across sections
- Determines display order in workspace
- Lower = higher priority (appears first)

---

## Example Output

```sql
-- SysModule for Tasks section
INSERT INTO SysModule (
  [ae0e45ca-c495-4fe7-a39d-3ab7278e1617], -- Id
  [3e0502c3-c11f-4911-9802-45a82b49eb04], -- Caption
  [bfc4f09c-e832-4266-9dda-89b841a2e19c], -- SectionSchemaUId
  [f3e70c79-d9c2-4c3b-a5b4-c2a6f1e8b3d1], -- SysModuleEntityId
  [e1c2d4b5-a3f6-4e7d-8c9b-1a2b3c4d5e6f], -- Image32Id
  [e1c2d4b5-a3f6-4e7d-8c9b-1a2b3c4d5e6f], -- SectionIconId
  [c4e6f8a2-b1d3-4e5f-9c7a-2b3c4d5e6f7a]  -- Position
)
VALUES (
  '12345678-1234-1234-1234-123456789abc',
  'Tasks',
  '23456789-2345-2345-2345-23456789abcd',
  '34567890-3456-3456-3456-34567890abcd',
  '45678901-4567-4567-4567-45678901abcd',
  '45678901-4567-4567-4567-45678901abcd',
  0
);

-- SysModuleEntity linking entity to pages
INSERT INTO SysModuleEntity (
  [ae0e45ca-c495-4fe7-a39d-3ab7278e1617], -- Id
  [a27bf249-e5f2-4f41-8c7d-3a6b5e4f3c2b], -- SysEntitySchemaUId
  [b38c1d5a-f6e3-4d52-9b8e-4c7a6f5d4e3c], -- CardSchemaUId
  [bfc4f09c-e832-4266-9dda-89b841a2e19c], -- SectionSchemaUId
  [d4a9f2b1-c8e7-4f6d-a5c3-2b1e9f8d7c6b]  -- TypeColumnUId
)
VALUES (
  '34567890-3456-3456-3456-34567890abcd',
  '56789012-5678-5678-5678-56789012abcd',
  '67890123-6789-6789-6789-67890123abcd',
  '23456789-2345-2345-2345-23456789abcd',
  NULL
);
```

---

## Validation Checklist

Before finalizing SQL, verify:

- ✅ All column UIds from `bindings-lookup.json`
- ✅ SysModule.SysModuleEntityId = SysModuleEntity.Id
- ✅ Both records reference same list page UId
- ✅ Position is unique integer
- ✅ Entity UId matches entity schema from plan
- ✅ Form page UId is valid or NULL

---

## Output

Generate SQL file directly to: `output/<AppName>/sql/workspace-bindings.sql`

Append all SysModule/SysModuleEntity pairs to this file (one section pair per entity).

When done, confirm: "Generated data bindings for `<SectionName>` section

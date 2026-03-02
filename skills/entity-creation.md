# Skill: Entity Schema File Generator

## Role

You generate Creatio entity schema files. For each entity you produce exactly **3 files** inside `Schemas/<EntityName>/`:

| File | Purpose |
|------|---------|
| `descriptor.json` | Schema identity, parent, manager |
| `metadata.json` | DSL diff with columns, events, admin rights |
| `properties.json` | Static property flags |

## Input (from plan.md)

| Parameter | Description |
|-----------|-------------|
| `entityName` | PascalCase name starting with `Usr` (e.g., `UsrTodoTask`) |
| `entityUId` | Pre-generated GUID for this entity |
| `parentType` | `BaseEntity` or `BaseLookup` (or another known parent) |
| `parentUId` | GUID of the parent entity |
| `packageUId` | GUID of the containing package |
| `caption` | Human-readable display name |
| `columns` | Array of column definitions (only for BaseEntity children) |

Each column in the array:

| Field | Description |
|-------|-------------|
| `name` | Column name (e.g., `UsrTitle`) |
| `uid` | Pre-generated column GUID |
| `dataValueType` | Type name (e.g., `ShortText`, `Lookup`, `Boolean`) |
| `dataValueTypeGuid` | GUID of the DVT from KNOWN_DVT |
| `lookupEntityUId` | (Lookup only) Schema UId of the referenced entity |
| `lookupEntityName` | (Lookup only) Name of the referenced entity |
| `lookupFkColumn` | (Lookup only) FK column name, e.g., `UsrStatusId` |
| `lookupDisplayColumn` | (Lookup only) Display column, e.g., `Name` |

## Context Files to Read

- `context/entity-types.md` — KNOWN_PARENTS, KNOWN_DVT, BASE_ENTITY_COLS, BaseLookup inherited columns
- `context/schema-types.md` — DSL diff format, field meanings

## Template References

- `templates/entity/base-entity/` — BaseEntity entity (descriptor, metadata, properties)
- `templates/entity/base-lookup/` — BaseLookup entity (descriptor, metadata, properties)

---

## Output File Formats

### 1. descriptor.json

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

**Rules:**
- `<timestamp>` — current epoch milliseconds (e.g., `1700000000000`)
- `Parent.UId` must match KNOWN_PARENTS in `context/entity-types.md`:
  - BaseEntity: `1bab9dcf-17d5-49f8-9536-8e0064f1dce0`
  - BaseLookup: `11ab4bcb-9b23-4b6d-9c86-520fae925d75`
- Do NOT add `ExtendParent` for new entities
- `DependsOn` is always an empty array for new entities

---

### 2. metadata.json — DSL Diff Format

This file uses a **DSL diff format**, NOT plain JSON. Each line has an operator prefix:

| Operator | Meaning |
|----------|---------|
| `=` | Set / unchanged value |
| `+` | Add new value |
| `~` | Reorder array |

#### 2a. BaseEntity Metadata (entity with custom columns)

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
= MetaData.Schema.D8 "1bab9dcf-17d5-49f8-9536-8e0064f1dce0"
+ MetaData.Schema.D29 "null"
+ MetaData.Schema.D30 "null"
+ MetaData.Schema.D31 "null"
```

**Then for each column**, add a `+ MetaData.Schema.D2` block:

**Simple column (non-lookup):**
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

**Lookup column:**
```
+ MetaData.Schema.D2 {
  "UId": "<columnUId>",
  "A2": "<columnName>",
  "A3": "<entityUId>",
  "A4": "<entityUId>",
  "A5": "<packageUId>",
  "S2": "b295071f-7ea9-4e62-8d1a-919bf3732ff2",
  "S4": "<lookupEntityUId>",
  "E6": true,
  "E9": true,
  "E17": "<lookupFkColumn>",
  "E18": "<lookupDisplayColumn>"
}
```

**Column definition field reference:**

| Field | Meaning |
|-------|---------|
| `UId` | Column unique identifier (from plan) |
| `A2` | Column name |
| `A3` | This entity's schema UId |
| `A4` | This entity's schema UId |
| `A5` | Package UId |
| `S2` | DataValueType GUID (from KNOWN_DVT) |
| `S4` | (Lookup only) Referenced entity schema UId |
| `E6` | (Lookup only) Always `true` — is lookup flag |
| `E9` | (Lookup only) Always `true` — visible in forms |
| `E17` | (Lookup only) FK column name (e.g., `UsrStatusId`) |
| `E18` | (Lookup only) Display column of the referenced entity. For BaseLookup targets use `Name`. For BaseEntity targets use the appropriate display column name. |

**Then the reorder block** — lists ALL column UIds (inherited + new) in order:

```
~ MetaData.Schema.D2 [
  "ae0e45ca-c495-4fe7-a39d-3ab7278e1617",
  "e80190a5-03b2-4095-90f7-a193a960adee",
  "ebf6bb93-8aa6-4a01-900d-c6ea67affe21",
  "9928edec-4272-425a-93bb-48743fee4b04",
  "3015559e-cbc6-406a-88af-07f7930be832",
  "3fabd836-6a53-4d8d-9069-6df88d9dae1e",
  "<col1-uid>",
  "<col2-uid>",
  ...
]
```

The 6 inherited BaseEntity column UIds are always listed first, in this exact order:

| Order | Column | UId |
|-------|--------|-----|
| 1 | Id | `ae0e45ca-c495-4fe7-a39d-3ab7278e1617` |
| 2 | CreatedOn | `e80190a5-03b2-4095-90f7-a193a960adee` |
| 3 | CreatedBy | `ebf6bb93-8aa6-4a01-900d-c6ea67affe21` |
| 4 | ModifiedOn | `9928edec-4272-425a-93bb-48743fee4b04` |
| 5 | ModifiedBy | `3015559e-cbc6-406a-88af-07f7930be832` |
| 6 | ProcessListeners | `3fabd836-6a53-4d8d-9069-6df88d9dae1e` |

New column UIds follow after these 6.

**Then event handlers (D20):**

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

⚠️ **Copy this D20 block exactly as-is** — the FA flag order and operators (`=` vs `+`) are specific and must not be changed.

**Then admin rights (D36), live editing (B7), and E16 flags:**

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

E16 flags are added for every **inherited** BaseEntity column. Do NOT add E16 for custom columns.

#### 2b. BaseLookup Metadata (no custom columns)

BaseLookup entities inherit Name + Description columns and have **no custom columns**. The metadata is simpler:

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
= MetaData.Schema.D8 "11ab4bcb-9b23-4b6d-9c86-520fae925d75"
+ MetaData.Schema.D29 "null"
+ MetaData.Schema.D30 "null"
+ MetaData.Schema.D31 "null"
~ MetaData.Schema.D2 [
  "ae0e45ca-c495-4fe7-a39d-3ab7278e1617",
  "e80190a5-03b2-4095-90f7-a193a960adee",
  "ebf6bb93-8aa6-4a01-900d-c6ea67affe21",
  "9928edec-4272-425a-93bb-48743fee4b04",
  "3015559e-cbc6-406a-88af-07f7930be832",
  "3fabd836-6a53-4d8d-9069-6df88d9dae1e",
  "736c30a7-c0ec-4fa9-b034-2552b319b633",
  "9e53fd7c-dde4-4502-a64c-b9e34148108b"
]
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
= MetaData.Schema.D36.A3 "<entityUId>"
= MetaData.Schema.D36.BS1 false
+ MetaData.Schema.B7 false
+ MetaData.Schema.D2.["ae0e45ca-c495-4fe7-a39d-3ab7278e1617"].E16 false
+ MetaData.Schema.D2.["e80190a5-03b2-4095-90f7-a193a960adee"].E16 false
+ MetaData.Schema.D2.["ebf6bb93-8aa6-4a01-900d-c6ea67affe21"].E16 false
+ MetaData.Schema.D2.["9928edec-4272-425a-93bb-48743fee4b04"].E16 false
+ MetaData.Schema.D2.["3015559e-cbc6-406a-88af-07f7930be832"].E16 false
+ MetaData.Schema.D2.["3fabd836-6a53-4d8d-9069-6df88d9dae1e"].E16 false
+ MetaData.Schema.D2.["736c30a7-c0ec-4fa9-b034-2552b319b633"].E16 false
+ MetaData.Schema.D2.["9e53fd7c-dde4-4502-a64c-b9e34148108b"].E16 false
```

**Key differences from BaseEntity metadata:**
- `D8` uses BaseLookup UId: `11ab4bcb-9b23-4b6d-9c86-520fae925d75`
- No `+ MetaData.Schema.D2 {...}` blocks (no custom columns)
- The `~` reorder includes 8 UIds (6 BaseEntity + 2 BaseLookup):
  - `736c30a7-c0ec-4fa9-b034-2552b319b633` (Name)
  - `9e53fd7c-dde4-4502-a64c-b9e34148108b` (Description)
- E16 flags include all 8 inherited column UIds

#### EG1 — Events Process Fields

| Field | Description | Value |
|-------|-------------|-------|
| `EG1.UId` | GUID for the events process | Generate a new GUID |
| `EG1.A2` | Process name | `Entity_<hash>EventsProcess` where `<hash>` is a random hex string |
| `EG1.A5` | Package UId | Same as `A5` |
| `EG1.B8` | Version | Always `"0.0.0.0"` |
| `EG1.BK8` | Process schema GUID | Generate a new GUID |

---

### 3. properties.json

Always the same for all entity types:

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

---

## DataValueType GUID Reference (KNOWN_DVT)

| DataValueType | GUID |
|---------------|------|
| Guid | `23018567-a13c-4320-8687-fd6f9e3699bd` |
| Lookup | `b295071f-7ea9-4e62-8d1a-919bf3732ff2` |
| Boolean | `90b65bf8-0ffc-4141-8779-2420877af907` |
| Integer | `6b6b74e2-820d-490e-a017-2b73d4ccf2b0` |
| Float | `5cc8060d-6d10-4773-89fc-8c12d6f659a6` |
| Money | `ff22e049-4d16-46ee-a529-92d8808932dc` |
| DateTime | `d21e9ef4-c064-4012-b286-fa1a8171da44` |
| Date | `603d4960-a1a2-45e9-b232-206a54421b01` |
| Time | `04cc757b-8f06-482c-8a1a-0c0e171d2410` |
| ShortText | `ddb3a1ee-07e8-4d62-b7a9-d0e618b00fbd` |
| MediumText | `325a73b8-0f47-44a0-8412-7606f78003ac` |
| LongText | `c0f04627-4620-4bc0-84e5-9419dc8516b1` |
| MaxSizeText | `5ca35f10-a101-4c67-a96a-383da6afacfc` |
| LargeText/RichText | `79bccffa-8c8b-4863-b376-a69d2244182b` |
| Image | `fa6e6e49-b996-475e-a77e-73904e4c5a88` |
| ImageLookup | `b039feb0-ee7c-4884-8aa6-d6d45d84316f` |

---

## Critical Rules

1. **BaseLookup entities have NO custom columns** — Name and Description are inherited automatically
2. **Never generate new column UIds** — always use the UIds provided in plan.md
3. **Never add inherited columns** (Id, CreatedOn, CreatedBy, ModifiedOn, ModifiedBy, ProcessListeners) as `+ D2` blocks — they come from the parent
4. **DataValueType GUIDs must come from KNOWN_DVT** (listed above or in `context/entity-types.md`)
5. **Parent UIds must come from KNOWN_PARENTS** in `context/entity-types.md`
6. **The `~` reorder must list ALL column UIds** — inherited first (in exact order), then custom columns in the order they appear
7. **E16 flags are only for inherited columns** — do not add E16 for custom columns
8. **D20 FA flags must be copied exactly** — the operator prefix (`=` vs `+`) and ordering matter
9. **EG1 UId and BK8 must be fresh GUIDs** — generate two new GUIDs for each entity
10. **Entity names must start with `Usr`** prefix (Creatio naming convention)

## Generation Checklist

- [ ] `descriptor.json` has correct Parent UId/Name for the entity type
- [ ] `metadata.json` header: UId, A2, A5, B6, D8 all set correctly
- [ ] `metadata.json` EG1: two fresh GUIDs (UId and BK8), correct A2 pattern
- [ ] `metadata.json` D29/D30/D31 all set to `"null"`
- [ ] `metadata.json` each column has correct `+ D2` block with all required fields
- [ ] `metadata.json` lookup columns include S4, E6, E9, E17, E18
- [ ] `metadata.json` `~` reorder lists all column UIds in correct order
- [ ] `metadata.json` D20 block copied exactly (FA order and operators)
- [ ] `metadata.json` D36 has entity UId and BS1=false
- [ ] `metadata.json` B7=false
- [ ] `metadata.json` E16 flags for every inherited column
- [ ] `properties.json` is the standard 8-property block
- [ ] Files written to `Schemas/<entityName>/`

# Skill: Entity Schema File Generator

## Role

Generate Creatio entity schema files: 3 files in `Schemas/<EntityName>/`:
- `descriptor.json` — identity, parent, manager
- `metadata.json` — DSL diff with columns
- `properties.json` — property flags

**📁 Full examples:** `templates/entity/`

---

## Input (from plan.md)

| Parameter | Description |
|-----------|-------------|
| `entityName` | PascalCase with `Usr` prefix (e.g., `UsrTodoTask`) |
| `entityUId` | Pre-generated GUID |
| `parentType` | `BaseEntity` or `BaseLookup` |
| `parentUId` | Parent GUID from `context/schema-reference.md` |
| `packageUId` | Package GUID |
| `caption` | Display name |
| `columns` | Array of column definitions (BaseEntity only) |

**Column structure:**
- `name`, `uid`, `dataValueType`, `dataValueTypeGuid`
- For Lookup: `lookupEntityUId`, `lookupFkColumn`, `lookupDisplayColumn`

---

## Context Files

Read before generating:
- `context/schema-reference.md` — KNOWN_PARENTS, KNOWN_DVT, BASE_ENTITY_COLS, DSL format
- `templates/entity/base-entity/` — BaseEntity example
- `templates/entity/base-lookup/` — BaseLookup example

---

## Generation Algorithm

### 1. descriptor.json

```json
{
  "Descriptor": {
    "UId": "<entityUId>",
    "Name": "<entityName>",
    "ModifiedOnUtc": "/Date(<timestamp>)/",
    "Parent": {"UId": "<parentUId>", "Name": "<parentType>"},
    "ManagerName": "EntitySchemaManager",
    "Caption": "<caption>",
    "DependsOn": []
  }
}
```

- `<timestamp>` — current milliseconds since epoch
- `Parent.UId` — from KNOWN_PARENTS (BaseEntity: `1bab9dcf...`, BaseLookup: `11ab4bcb...`)
- NO `ExtendParent` for new entities

---

### 2. metadata.json — DSL Diff

**Use templates as base**, replace placeholders:

**For BaseEntity:**
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

**For each custom column:**
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

**For Lookup columns, add:**
```
  "S4": "<lookupEntityUId>",
  "E6": true,
  "E9": true,
  "E17": "<lookupFkColumn>",
  "E18": "<lookupDisplayColumn>"
```

**Reorder array (~ operator):**
```
~ MetaData.Schema.D2 [
  "ae0e45ca-...",  // Id
  "e80190a5-...",  // CreatedOn
  "ebf6bb93-...",  // CreatedBy
  "9928edec-...",  // ModifiedOn
  "3015559e-...",  // ModifiedBy
  "3fabd836-...",  // ProcessListeners
  "<column1Uid>",
  "<column2Uid>"
]
```

**D20 block (copy exactly):**
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

**Admin rights + E16 flags:**
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

**For BaseLookup:** No custom columns, reorder includes Name + Description UIds. See `templates/entity/base-lookup/metadata.json`.

---

### 3. properties.json

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

## Critical Rules

1. **DO NOT add inherited columns** (Id, CreatedOn, CreatedBy, ModifiedOn, ModifiedBy, ProcessListeners)
2. **BaseLookup entities have NO custom columns** (Name + Description inherited)
3. **Generate new GUIDs for:** entityUId, eventsProcessUId, processSchemaUId, each columnUId
4. **Hash in events process name:** random 7-char hex (e.g., `Entity_a3f2b1cEventsProcess`)
5. **Operators matter:** `=` (set), `+` (add), `~` (reorder) — copy exactly from templates
6. **E16 flags:** only for inherited columns, NOT custom columns

---

## Validation

Before output:
- ✅ All GUIDs are lowercase with dashes
- ✅ Entity name starts with `Usr`
- ✅ Column names start with `Usr`
- ✅ No inherited columns in custom columns list
- ✅ Lookup columns have S4, E6, E17, E18 fields
- ✅ Reorder array lists inherited UIds + custom column UIds

---

**📁 When in doubt, reference `templates/entity/` for exact format**

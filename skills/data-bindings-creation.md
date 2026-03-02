# Skill: Data Binding File Generator

## Role

Generate data binding files: 3 files in `Data/<BindingName>/`:
- `descriptor.json` — target table, columns
- `data.json` — data rows
- `filter.json` — empty (`""`)

**📁 Full examples:** `templates/data-bindings/`  
**📁 Column UIds:** `context/bindings-lookup.json`

---

## Input (from plan.md)

### For SysModuleEntity / SysModule:

| Parameter | Description |
|-----------|-------------|
| `entityName` | Main entity (e.g., `UsrTodoTask`) |
| `entityUId` | Entity schema UId |
| `listPageUId` | List page UId |
| `formPageUId` | Form page UId |
| `sysModuleEntityRecordId` | GUID for SysModuleEntity record |
| `sysModuleRecordId` | GUID for SysModule record |
| `sectionCaption` | Section display name |
| `iconColor` | Hex color (e.g., `#7848EE`) |

### For Lookup Seed:

| Parameter | Description |
|-----------|-------------|
| `lookupEntityName` | Lookup entity name |
| `lookupEntityUId` | Lookup schema UId |
| `values` | Array of `{id, name, description}` |

---

## Context Files

Read before generating:
- `context/bindings-lookup.json` — All column UIds
- `context/data-bindings-reference.md` — Binding logic
- `templates/data-bindings/` — Complete examples

---

## Generation Order

1. **SysModuleEntity** — bind entity to system
2. **SysModule** — register section in navigation
3. **Lookup seed** — populate lookup values

---

## Type 1: SysModuleEntity

**Directory:** `Data/SysModuleEntity_<entityName>/`

**descriptor.json:**
- Schema UId: `9c762665-90ad-497b-ac4b-45bb729630a1`
- Columns: Id, SysEntitySchemaUId, TypeColumnUId (get UIds from bindings-lookup.json)

**data.json:**
```json
{
  "PackageData": [
    {
      "Row": [
        {"SchemaColumnUId": "<Id-UId>", "Value": "<sysModuleEntityRecordId>"},
        {"SchemaColumnUId": "<SysEntitySchemaUId-UId>", "Value": "<entityUId>"},
        {"SchemaColumnUId": "<TypeColumnUId-UId>", "Value": "null"}
      ]
    }
  ]
}
```

**filter.json:** `""`

---

## Type 2: SysModule

**Directory:** `Data/SysModule_<entityName>/`

**descriptor.json:**
- Schema UId: `2b2ed767-0b4b-4a7b-9de2-d48e14a2c0c5`
- Columns: Id, Code, Caption, SysModuleEntity, CardSchemaUId, SectionSchemaUId, SectionModuleSchemaUId, CardModuleUId, IconBackground, Type, FolderMode, HasActions, HasRecent, GlobalSearchAvailable, HasAnalytics, IsSystem (get UIds from bindings-lookup.json)

**data.json key values:**
- Id: `<sysModuleRecordId>`
- Code: `<entityName>`
- Caption: `<sectionCaption>`
- SysModuleEntity: `<sysModuleEntityRecordId>`
- CardSchemaUId: `<formPageUId>`
- SectionSchemaUId: `<listPageUId>`
- SectionModuleSchemaUId: `"12244568-6d4f-f201-ed26-ac3913021080"` (standard)
- CardModuleUId: `"c3382be3-6619-9256-2260-93d87cf0d9b5"` (standard)
- IconBackground: `<iconColor>`
- FolderMode: `"b659d704-3955-e011-981f-00155d043204"` (standard)
- Type: `0`
- HasActions, HasRecent, GlobalSearchAvailable, HasAnalytics, IsSystem: `false`

**filter.json:** `""`

---

## Type 3: Lookup Seed Data

**Directory:** `Data/<lookupEntityName>_Lookup/`

**descriptor.json:**
- Schema UId: `<lookupEntityUId>`
- Columns: Id, Name, Description (get UIds from bindings-lookup.json)

**data.json:**
```json
{
  "PackageData": [
    {
      "Row": [
        {"SchemaColumnUId": "<Id-UId>", "Value": "<value1-id>"},
        {"SchemaColumnUId": "<Name-UId>", "Value": "New"},
        {"SchemaColumnUId": "<Description-UId>", "Value": ""}
      ]
    },
    {
      "Row": [
        {"SchemaColumnUId": "<Id-UId>", "Value": "<value2-id>"},
        {"SchemaColumnUId": "<Name-UId>", "Value": "In Progress"},
        {"SchemaColumnUId": "<Description-UId>", "Value": ""}
      ]
    }
  ]
}
```

**filter.json:** `""`

---

## Critical Rules

1. **Use bindings-lookup.json for ALL column UIds** — don't hardcode
2. **Standard values:**
   - SectionModuleSchemaUId: `"12244568-6d4f-f201-ed26-ac3913021080"`
   - CardModuleUId: `"c3382be3-6619-9256-2260-93d87cf0d9b5"`
   - FolderMode: `"b659d704-3955-e011-981f-00155d043204"`
3. **SysModuleEntity record Id** must match SysModule.SysModuleEntity value
4. **Generate new GUIDs** for each binding UId, record Id, lookup value Id
5. **filter.json** is always empty string: `""`

---

## Algorithm

```
For each entity:
  1. Create SysModuleEntity binding
     - Read column UIds from bindings-lookup.json
     - Generate 3 files in Data/SysModuleEntity_<Entity>/
  
  2. Create SysModule binding
     - Read column UIds from bindings-lookup.json
     - Use standard values for SectionModuleSchemaUId, CardModuleUId, FolderMode
     - Generate 3 files in Data/SysModule_<Entity>/
  
For each lookup entity:
  3. Create Lookup seed binding
     - Read Name/Description column UIds from bindings-lookup.json
     - Generate 3 files in Data/<Lookup>_Lookup/
```

---

## Validation

Before output:
- ✅ All GUIDs lowercase with dashes
- ✅ Column UIds match bindings-lookup.json
- ✅ SysModule references correct SysModuleEntity record Id
- ✅ Standard UIds used for SectionModuleSchemaUId, CardModuleUId, FolderMode
- ✅ filter.json is `""`
- ✅ Lookup seed data has unique Id for each value

---

**📁 Use `templates/data-bindings/` for exact column list and format**

# Skill: Data Binding File Generator

## Role

You generate Creatio data binding files that register sections (SysModule, SysModuleEntity) and seed lookup data. For each data binding you produce exactly **3 files** inside `Data/<BindingName>/`:

| File | Purpose |
|------|---------|
| `descriptor.json` | Target table, column definitions |
| `data.json` | Actual data rows |
| `filter.json` | Empty filter (always `""`) |

## Input (from plan.md)

### For SysModuleEntity / SysModule:

| Parameter | Description |
|-----------|-------------|
| `entityName` | Main entity name (e.g., `UsrTodoTask`) |
| `entityUId` | Main entity schema UId |
| `listPageUId` | List page schema UId |
| `formPageUId` | Form page schema UId |
| `sysModuleEntityRecordId` | Pre-generated GUID for the SysModuleEntity record |
| `sysModuleRecordId` | Pre-generated GUID for the SysModule record |
| `sectionCaption` | Display name for the section |
| `iconColor` | Hex color for section icon (e.g., `#7848EE`) |

### For Lookup Seed Data:

| Parameter | Description |
|-----------|-------------|
| `lookupEntityName` | Lookup entity name (e.g., `UsrTodoTaskStatus`) |
| `lookupEntityUId` | Lookup entity schema UId |
| `values` | Array of `{ id, name, description }` for each seed row |

## Context Files to Read

- `context/data-bindings-reference.md` — Column UIds for SysModule, SysModuleEntity, lookup seed format

## Template References

- `templates/data-bindings/sys-module-entity/` — SysModuleEntity binding template
- `templates/data-bindings/sys-module/` — SysModule binding template
- `templates/data-bindings/lookup-seed/` — Lookup seed data template

---

## Data Binding Type 1: SysModuleEntity

Registers an entity in the system so it can be associated with a section.

**Output directory:** `Data/SysModuleEntity_<entityName>/`

### descriptor.json

```json
{
  "Descriptor": {
    "UId": "<binding-guid>",
    "Name": "SysModuleEntity_<entityName>",
    "ModifiedOnUtc": "/Date(<timestamp>)/",
    "InstallType": 0,
    "Schema": {
      "UId": "9c762665-90ad-497b-ac4b-45bb729630a1",
      "Name": "SysModuleEntity"
    },
    "Columns": [
      {"ColumnUId": "ae0e45ca-c495-4fe7-a39d-3ab7278e1617", "IsForceUpdate": false, "IsKey": true, "ColumnName": "Id", "DataTypeValueUId": "23018567-a13c-4320-8687-fd6f9e3699bd"},
      {"ColumnUId": "0c59594b-490a-4b55-a564-5841cfae3c19", "IsForceUpdate": false, "IsKey": false, "ColumnName": "SysEntitySchemaUId", "DataTypeValueUId": "23018567-a13c-4320-8687-fd6f9e3699bd"},
      {"ColumnUId": "3107ef98-a02e-4ea8-809a-67dc3025ef4a", "IsForceUpdate": true, "IsKey": false, "ColumnName": "TypeColumnUId", "DataTypeValueUId": "23018567-a13c-4320-8687-fd6f9e3699bd"}
    ]
  }
}
```

**Fixed values — DO NOT change:**
- `Schema.UId`: `9c762665-90ad-497b-ac4b-45bb729630a1` (SysModuleEntity table)
- `Schema.Name`: `SysModuleEntity`
- Column UIds are from `context/data-bindings-reference.md`:
  - Id: `ae0e45ca-c495-4fe7-a39d-3ab7278e1617`
  - SysEntitySchemaUId: `0c59594b-490a-4b55-a564-5841cfae3c19`
  - TypeColumnUId: `3107ef98-a02e-4ea8-809a-67dc3025ef4a` (IsForceUpdate: true)

### data.json

```json
{
  "PackageData": [
    {
      "Row": [
        {"SchemaColumnUId": "ae0e45ca-c495-4fe7-a39d-3ab7278e1617", "Value": "<sysModuleEntityRecordId>"},
        {"SchemaColumnUId": "0c59594b-490a-4b55-a564-5841cfae3c19", "Value": "<entityUId>"},
        {"SchemaColumnUId": "3107ef98-a02e-4ea8-809a-67dc3025ef4a", "Value": "00000000-0000-0000-0000-000000000000"}
      ]
    }
  ]
}
```

**Key values:**
- `Id` Value = `<sysModuleEntityRecordId>` — this GUID is referenced by the SysModule record
- `SysEntitySchemaUId` Value = `<entityUId>` — the main entity's schema UId
- `TypeColumnUId` Value = `"00000000-0000-0000-0000-000000000000"` — empty GUID for non-polymorphic entities

### filter.json

```
""
```

Always an empty string.

---

## Data Binding Type 2: SysModule

Registers a section in the application navigation.

**Output directory:** `Data/SysModule_<entityName>/`

### descriptor.json

```json
{
  "Descriptor": {
    "UId": "<binding-guid>",
    "Name": "SysModule_<entityName>",
    "ModifiedOnUtc": "/Date(<timestamp>)/",
    "InstallType": 0,
    "Schema": {
      "UId": "2b2ed767-0b4b-4a7b-9de2-d48e14a2c0c5",
      "Name": "SysModule"
    },
    "Columns": [
      {"ColumnUId": "ae0e45ca-c495-4fe7-a39d-3ab7278e1617", "IsForceUpdate": false, "IsKey": true, "ColumnName": "Id", "DataTypeValueUId": "23018567-a13c-4320-8687-fd6f9e3699bd"},
      {"ColumnUId": "e0c474a3-e4bc-457e-bb67-c1ec1b399f60", "IsForceUpdate": false, "IsKey": false, "ColumnName": "Code", "DataTypeValueUId": "ddb3a1ee-07e8-4d62-b7a9-d0e618b00fbd"},
      {"ColumnUId": "3da3c3b2-02fb-4cca-80c3-7946d4e8f565", "IsForceUpdate": false, "IsKey": false, "ColumnName": "Caption", "DataTypeValueUId": "325a73b8-0f47-44a0-8412-7606f78003ac"},
      {"ColumnUId": "3f098e0d-6cbd-4e8f-bc3e-00709f2d8d82", "IsForceUpdate": false, "IsKey": false, "ColumnName": "SysModuleEntity", "DataTypeValueUId": "b295071f-7ea9-4e62-8d1a-919bf3732ff2"},
      {"ColumnUId": "327a0dc4-df63-4f6e-9d33-bc403d284cb6", "IsForceUpdate": false, "IsKey": false, "ColumnName": "CardSchemaUId", "DataTypeValueUId": "23018567-a13c-4320-8687-fd6f9e3699bd"},
      {"ColumnUId": "af5bbb5e-9c78-44b7-8fdd-2bfc4353b4a8", "IsForceUpdate": false, "IsKey": false, "ColumnName": "SectionSchemaUId", "DataTypeValueUId": "23018567-a13c-4320-8687-fd6f9e3699bd"},
      {"ColumnUId": "d57c3c34-e293-4aed-bff6-91dc90408958", "IsForceUpdate": false, "IsKey": false, "ColumnName": "SectionModuleSchemaUId", "DataTypeValueUId": "23018567-a13c-4320-8687-fd6f9e3699bd"},
      {"ColumnUId": "cb4bb1d2-d369-406e-8150-502dd7af2199", "IsForceUpdate": false, "IsKey": false, "ColumnName": "CardModuleUId", "DataTypeValueUId": "23018567-a13c-4320-8687-fd6f9e3699bd"},
      {"ColumnUId": "63f1eb37-455a-4a53-ace2-fa5ef4c3d10f", "IsForceUpdate": false, "IsKey": false, "ColumnName": "Image32", "DataTypeValueUId": "b039feb0-ee7c-4884-8aa6-d6d45d84316f"},
      {"ColumnUId": "48ed5be5-6dcd-44ba-6294-a29c8daef880", "IsForceUpdate": false, "IsKey": false, "ColumnName": "IconBackground", "DataTypeValueUId": "325a73b8-0f47-44a0-8412-7606f78003ac"},
      {"ColumnUId": "1e4741cc-9a6e-446f-9865-5f5910fadd67", "IsForceUpdate": false, "IsKey": false, "ColumnName": "Type", "DataTypeValueUId": "6b6b74e2-820d-490e-a017-2b73d4ccf2b0"},
      {"ColumnUId": "d3afc924-2d21-4c0e-b2f3-9f8c180221f9", "IsForceUpdate": false, "IsKey": false, "ColumnName": "FolderMode", "DataTypeValueUId": "b295071f-7ea9-4e62-8d1a-919bf3732ff2"},
      {"ColumnUId": "a0fd39b2-b680-4515-ac3c-72322db4f1b8", "IsForceUpdate": false, "IsKey": false, "ColumnName": "HasActions", "DataTypeValueUId": "90b65bf8-0ffc-4141-8779-2420877af907"},
      {"ColumnUId": "80769c54-f4f4-43cb-93f8-0824715969a6", "IsForceUpdate": false, "IsKey": false, "ColumnName": "HasRecent", "DataTypeValueUId": "90b65bf8-0ffc-4141-8779-2420877af907"},
      {"ColumnUId": "eea74681-e019-4885-9a1e-e8261f2665ea", "IsForceUpdate": false, "IsKey": false, "ColumnName": "GlobalSearchAvailable", "DataTypeValueUId": "90b65bf8-0ffc-4141-8779-2420877af907"},
      {"ColumnUId": "34dfc288-1b25-4d53-bdf3-16b58a84e276", "IsForceUpdate": false, "IsKey": false, "ColumnName": "HasAnalytics", "DataTypeValueUId": "90b65bf8-0ffc-4141-8779-2420877af907"},
      {"ColumnUId": "dedaabd6-732d-47ac-b229-50a8ee02292c", "IsForceUpdate": false, "IsKey": false, "ColumnName": "IsSystem", "DataTypeValueUId": "90b65bf8-0ffc-4141-8779-2420877af907"}
    ]
  }
}
```

**Fixed values — DO NOT change:**
- `Schema.UId`: `2b2ed767-0b4b-4a7b-9de2-d48e14a2c0c5` (SysModule table)
- `Schema.Name`: `SysModule`
- All Column UIds are from `context/data-bindings-reference.md` — never fabricate them

### data.json

```json
{
  "PackageData": [
    {
      "Row": [
        {"SchemaColumnUId": "ae0e45ca-c495-4fe7-a39d-3ab7278e1617", "Value": "<sysModuleRecordId>"},
        {"SchemaColumnUId": "3f098e0d-6cbd-4e8f-bc3e-00709f2d8d82", "Value": "<sysModuleEntityRecordId>", "DisplayValue": "null"},
        {"SchemaColumnUId": "6d827ba7-a622-47cc-8f11-b40b91c7441a", "Value": ""},
        {"SchemaColumnUId": "ed272316-b65f-41db-a9b4-e53ab939e4d6", "Value": ""},
        {"SchemaColumnUId": "d3afc924-2d21-4c0e-b2f3-9f8c180221f9", "Value": "b659d704-3955-e011-981f-00155d043204", "DisplayValue": "Include record in multiple folders"},
        {"SchemaColumnUId": "eea74681-e019-4885-9a1e-e8261f2665ea", "Value": false},
        {"SchemaColumnUId": "34dfc288-1b25-4d53-bdf3-16b58a84e276", "Value": false},
        {"SchemaColumnUId": "a0fd39b2-b680-4515-ac3c-72322db4f1b8", "Value": false},
        {"SchemaColumnUId": "80769c54-f4f4-43cb-93f8-0824715969a6", "Value": false},
        {"SchemaColumnUId": "e0c474a3-e4bc-457e-bb67-c1ec1b399f60", "Value": "<entityName>"},
        {"SchemaColumnUId": "9a366fd1-19c8-4ba7-9bdd-039f164c08ec", "Value": ""},
        {"SchemaColumnUId": "bd3cf32d-f9b5-471b-a0ca-f541296b979d", "Value": ""},
        {"SchemaColumnUId": "b3fefb7f-2aab-4b16-97aa-6ca3f3bd7ac2", "Value": "null"},
        {"SchemaColumnUId": "327a0dc4-df63-4f6e-9d33-bc403d284cb6", "Value": "<formPageUId>"},
        {"SchemaColumnUId": "d57c3c34-e293-4aed-bff6-91dc90408958", "Value": "12244568-6d4f-f201-ed26-ac3913021080"},
        {"SchemaColumnUId": "af5bbb5e-9c78-44b7-8fdd-2bfc4353b4a8", "Value": "<listPageUId>"},
        {"SchemaColumnUId": "cb4bb1d2-d369-406e-8150-502dd7af2199", "Value": "c3382be3-6619-9256-2260-93d87cf0d9b5"},
        {"SchemaColumnUId": "f3a29fb6-f13d-443e-8360-d4f51e8bcec8", "Value": "null"},
        {"SchemaColumnUId": "63f1eb37-455a-4a53-ace2-fa5ef4c3d10f", "Value": "null", "DisplayValue": ""},
        {"SchemaColumnUId": "380d55b9-487c-429b-9aff-e04101ffc307", "Value": "null", "DisplayValue": ""},
        {"SchemaColumnUId": "e6243d2b-cc8f-4b2d-8646-36bac9fb48e9", "Value": "null", "DisplayValue": "null"},
        {"SchemaColumnUId": "dedaabd6-732d-47ac-b229-50a8ee02292c", "Value": false},
        {"SchemaColumnUId": "1e4741cc-9a6e-446f-9865-5f5910fadd67", "Value": 0},
        {"SchemaColumnUId": "48ed5be5-6dcd-44ba-6294-a29c8daef880", "Value": "<iconColor>"}
      ]
    }
  ]
}
```

**Row field reference — values to set from plan.md:**

| SchemaColumnUId | Column | Value to Set |
|-----------------|--------|-------------|
| `ae0e45ca-...` | Id | `<sysModuleRecordId>` — unique GUID for this SysModule record |
| `3f098e0d-...` | SysModuleEntity | `<sysModuleEntityRecordId>` — GUID of the SysModuleEntity record (cross-reference) |
| `e0c474a3-...` | Code | `<entityName>` — the main entity name |
| `327a0dc4-...` | CardSchemaUId | `<formPageUId>` — form page schema UId |
| `af5bbb5e-...` | SectionSchemaUId | `<listPageUId>` — list page schema UId |
| `48ed5be5-...` | IconBackground | `<iconColor>` — hex color string |

**Standard fixed values (never change these):**

| SchemaColumnUId | Column | Fixed Value |
|-----------------|--------|-------------|
| `d57c3c34-...` | SectionModuleSchemaUId | `12244568-6d4f-f201-ed26-ac3913021080` |
| `cb4bb1d2-...` | CardModuleUId | `c3382be3-6619-9256-2260-93d87cf0d9b5` |
| `d3afc924-...` | FolderMode | `b659d704-3955-e011-981f-00155d043204` |
| `1e4741cc-...` | Type | `0` |
| `eea74681-...` | GlobalSearchAvailable | `false` |
| `34dfc288-...` | HasAnalytics | `false` |
| `a0fd39b2-...` | HasActions | `false` |
| `80769c54-...` | HasRecent | `false` |
| `dedaabd6-...` | IsSystem | `false` |
| `b3fefb7f-...` | SysPageSchemaUId | `"null"` |
| `f3a29fb6-...` | TypeColumnValue | `"null"` |
| `63f1eb37-...` | Image32 | `"null"` (with `DisplayValue: ""`) |
| `380d55b9-...` | Logo | `"null"` (with `DisplayValue: ""`) |
| `e6243d2b-...` | SysModuleVisa | `"null"` (with `DisplayValue: "null"`) |
| `6d827ba7-...` | Image16 | `""` |
| `ed272316-...` | Image20 | `""` |
| `9a366fd1-...` | HelpContextId | `""` |
| `bd3cf32d-...` | Attribute | `""` |

### filter.json

```
""
```

---

## Data Binding Type 3: Lookup Seed Data

Seeds initial values into lookup entities (e.g., Status values).

**Output directory:** `Data/<lookupEntityName>_Lookup/`

### descriptor.json

```json
{
  "Descriptor": {
    "UId": "<binding-guid>",
    "Name": "<lookupEntityName>_Lookup",
    "ModifiedOnUtc": "/Date(<timestamp>)/",
    "InstallType": 0,
    "Schema": {
      "UId": "<lookupEntityUId>",
      "Name": "<lookupEntityName>"
    },
    "Columns": [
      {"ColumnUId": "ae0e45ca-c495-4fe7-a39d-3ab7278e1617", "IsForceUpdate": false, "IsKey": true, "ColumnName": "Id", "DataTypeValueUId": "23018567-a13c-4320-8687-fd6f9e3699bd"},
      {"ColumnUId": "736c30a7-c0ec-4fa9-b034-2552b319b633", "IsForceUpdate": false, "IsKey": false, "ColumnName": "Name", "DataTypeValueUId": "ddb3a1ee-07e8-4d62-b7a9-d0e618b00fbd"},
      {"ColumnUId": "9e53fd7c-dde4-4502-a64c-b9e34148108b", "IsForceUpdate": false, "IsKey": false, "ColumnName": "Description", "DataTypeValueUId": "ddb3a1ee-07e8-4d62-b7a9-d0e618b00fbd"}
    ]
  }
}
```

**Fixed column UIds from BaseLookup:**
- Id: `ae0e45ca-c495-4fe7-a39d-3ab7278e1617`
- Name: `736c30a7-c0ec-4fa9-b034-2552b319b633`
- Description: `9e53fd7c-dde4-4502-a64c-b9e34148108b`

**Variable values:**
- `Schema.UId` = `<lookupEntityUId>` — the lookup entity's schema UId
- `Schema.Name` = `<lookupEntityName>` — the lookup entity's name

### data.json

```json
{
  "PackageData": [
    {
      "Row": [
        {"SchemaColumnUId": "ae0e45ca-c495-4fe7-a39d-3ab7278e1617", "Value": "<row1-id>"},
        {"SchemaColumnUId": "736c30a7-c0ec-4fa9-b034-2552b319b633", "Value": "<row1-name>"},
        {"SchemaColumnUId": "9e53fd7c-dde4-4502-a64c-b9e34148108b", "Value": ""}
      ]
    },
    {
      "Row": [
        {"SchemaColumnUId": "ae0e45ca-c495-4fe7-a39d-3ab7278e1617", "Value": "<row2-id>"},
        {"SchemaColumnUId": "736c30a7-c0ec-4fa9-b034-2552b319b633", "Value": "<row2-name>"},
        {"SchemaColumnUId": "9e53fd7c-dde4-4502-a64c-b9e34148108b", "Value": ""}
      ]
    }
  ]
}
```

**Rules:**
- One `Row` object per seed value
- Each row has exactly 3 columns: Id, Name, Description
- Id is a pre-generated GUID from plan.md
- Name is the display value (e.g., "New", "In Progress", "Done")
- Description is typically empty (`""`)

### filter.json

```
""
```

---

## Cross-References Between SysModule and SysModuleEntity

The SysModule and SysModuleEntity records **must reference each other**:

```
SysModuleEntity record:
  Id = <sysModuleEntityRecordId>          ← GUID-A
  SysEntitySchemaUId = <entityUId>        ← the main entity

SysModule record:
  Id = <sysModuleRecordId>                ← GUID-B
  SysModuleEntity = <sysModuleEntityRecordId>  ← points to GUID-A
  CardSchemaUId = <formPageUId>
  SectionSchemaUId = <listPageUId>
```

Both GUIDs (GUID-A, GUID-B) come from plan.md. They must be consistent across both data bindings.

---

## Seed Data Timing Note

⚠️ **Lookup tables don't exist until after compilation.** On the first `clio push-pkg`, entity schemas are pushed but not yet compiled. Seed data that targets these new entities will fail because the tables don't exist yet.

**Solution:** The deploy agent handles this by:
1. First push → entities are created, seed data for new entities fails (expected)
2. Compile (`clio restart -e <env>` or `clio compile -e <env>`)
3. Second push → seed data succeeds because tables now exist

This is the expected workflow — do not try to work around it.

---

## Critical Rules

1. **Column UIds in descriptors MUST come from `context/data-bindings-reference.md`** — never fabricate column UIds for system tables
2. **BaseLookup Name column UId**: `736c30a7-c0ec-4fa9-b034-2552b319b633` — always use this
3. **BaseLookup Description column UId**: `9e53fd7c-dde4-4502-a64c-b9e34148108b` — always use this
4. **SysModuleEntity TypeColumnUId value** should be `"00000000-0000-0000-0000-000000000000"` (empty GUID) for non-polymorphic entities
5. **SysModuleEntity TypeColumnUId column** has `IsForceUpdate: true` — this is intentional
6. **SysModule SectionModuleSchemaUId** is always `12244568-6d4f-f201-ed26-ac3913021080`
7. **SysModule CardModuleUId** is always `c3382be3-6619-9256-2260-93d87cf0d9b5`
8. **filter.json is always `""`** — an empty string, not `{}` or `null`
9. **SysModule.SysModuleEntity must reference the SysModuleEntity record Id** — not the entity schema UId
10. **Create SysModuleEntity BEFORE SysModule** — SysModule references SysModuleEntity
11. **One SysModuleEntity + one SysModule per main entity** — not per lookup
12. **Lookup seed data uses the lookup entity's own UId** in `Schema.UId`, not the parent BaseLookup UId

## Generation Checklist

### SysModuleEntity
- [ ] `descriptor.json` Schema.UId is `9c762665-90ad-497b-ac4b-45bb729630a1`
- [ ] `descriptor.json` has exactly 3 columns with correct UIds
- [ ] `data.json` Id value matches `sysModuleEntityRecordId` from plan
- [ ] `data.json` SysEntitySchemaUId matches the main entity's schema UId
- [ ] `data.json` TypeColumnUId is `"00000000-0000-0000-0000-000000000000"`
- [ ] `filter.json` is `""`

### SysModule
- [ ] `descriptor.json` Schema.UId is `2b2ed767-0b4b-4a7b-9de2-d48e14a2c0c5`
- [ ] `descriptor.json` has all 17 columns with correct UIds
- [ ] `data.json` Id value matches `sysModuleRecordId` from plan
- [ ] `data.json` SysModuleEntity value matches `sysModuleEntityRecordId` (cross-reference)
- [ ] `data.json` Code is the entity name
- [ ] `data.json` CardSchemaUId is the form page UId
- [ ] `data.json` SectionSchemaUId is the list page UId
- [ ] `data.json` SectionModuleSchemaUId is `12244568-6d4f-f201-ed26-ac3913021080`
- [ ] `data.json` CardModuleUId is `c3382be3-6619-9256-2260-93d87cf0d9b5`
- [ ] `filter.json` is `""`

### Lookup Seed
- [ ] `descriptor.json` Schema.UId is the lookup entity's own UId
- [ ] `descriptor.json` has Id, Name, Description columns with BaseLookup UIds
- [ ] `data.json` has one Row per seed value
- [ ] `data.json` each row has Id, Name, Description
- [ ] `data.json` Id values match plan.md
- [ ] `filter.json` is `""`

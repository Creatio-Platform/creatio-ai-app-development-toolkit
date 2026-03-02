# Data Bindings Reference

Data bindings insert records into system tables to register sections, bind entities, and seed lookup data.

Each data binding lives in `Data/<BindingName>/` with 3 files:
- `descriptor.json` — defines which table and columns
- `data.json` — the actual data rows
- `filter.json` — usually empty (`""`)

## SysModule (Section Registration)

Registers a section in the application navigation.

### SysModule Column UIds

| Column | ColumnUId | DataType | Description |
|--------|-----------|----------|-------------|
| **Id** | `ae0e45ca-c495-4fe7-a39d-3ab7278e1617` | Guid (IsKey) | Record ID |
| **Code** | `e0c474a3-e4bc-457e-bb67-c1ec1b399f60` | ShortText | Section code (entity name) |
| **Caption** | `3da3c3b2-02fb-4cca-80c3-7946d4e8f565` | MediumText | Display name |
| **SysModuleEntity** | `3f098e0d-6cbd-4e8f-bc3e-00709f2d8d82` | Lookup | Link to SysModuleEntity record |
| **CardSchemaUId** | `327a0dc4-df63-4f6e-9d33-bc403d284cb6` | Guid | Form page schema UId |
| **SectionSchemaUId** | `af5bbb5e-9c78-44b7-8fdd-2bfc4353b4a8` | Guid | List page schema UId |
| **SectionModuleSchemaUId** | `d57c3c34-e293-4aed-bff6-91dc90408958` | Guid | Section module UId |
| **CardModuleUId** | `cb4bb1d2-d369-406e-8150-502dd7af2199` | Guid | Card module UId |
| **Image32** | `63f1eb37-455a-4a53-ace2-fa5ef4c3d10f` | ImageLookup | Section icon (32px) |
| **IconBackground** | `48ed5be5-6dcd-44ba-6294-a29c8daef880` | MediumText | Icon background color |
| **Type** | `1e4741cc-9a6e-446f-9865-5f5910fadd67` | Integer | Section type (0 = standard) |
| FolderMode | `d3afc924-2d21-4c0e-b2f3-9f8c180221f9` | Lookup | Folder mode |
| HasActions | `a0fd39b2-b680-4515-ac3c-72322db4f1b8` | Boolean | Has actions menu |
| HasRecent | `80769c54-f4f4-43cb-93f8-0824715969a6` | Boolean | Has recent items |
| HasAnalytics | `34dfc288-1b25-4d53-bdf3-16b58a84e276` | Boolean | Has analytics tab |
| GlobalSearchAvailable | `eea74681-e019-4885-9a1e-e8261f2665ea` | Boolean | Available in global search |
| IsSystem | `dedaabd6-732d-47ac-b229-50a8ee02292c` | Boolean | Is system section |
| Image16 | `6d827ba7-a622-47cc-8f11-b40b91c7441a` | Image | 16px icon |
| Image20 | `ed272316-b65f-41db-a9b4-e53ab939e4d6` | Image | 20px icon |
| SysPageSchemaUId | `b3fefb7f-2aab-4b16-97aa-6ca3f3bd7ac2` | Guid | Page schema |
| HelpContextId | `9a366fd1-19c8-4ba7-9bdd-039f164c08ec` | ShortText | Help context |
| ModuleHeader | `7b904e78-84bf-408c-a7a1-1287e66837d3` | MediumText | Module header |
| Attribute | `bd3cf32d-f9b5-471b-a0ca-f541296b979d` | MediumText | Attribute |
| TypeColumnValue | `f3a29fb6-f13d-443e-8360-d4f51e8bcec8` | Guid | Type column value |
| Logo | `380d55b9-487c-429b-9aff-e04101ffc307` | ImageLookup | Logo image |
| Description | `48b260f5-5aad-608c-73a9-2b835ef697f4` | LongText | Description |
| SysModuleVisa | `e6243d2b-cc8f-4b2d-8646-36bac9fb48e9` | Lookup | Visa settings |

### SysModule descriptor.json Example

```json
{
  "Descriptor": {
    "UId": "<binding-guid>",
    "Name": "SysModule_UsrTodoTask",
    "ModifiedOnUtc": "/Date(1700000000000)/",
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

### SysModule data.json Example

```json
{
  "PackageData": [
    {
      "Row": [
        {"SchemaColumnUId": "ae0e45ca-c495-4fe7-a39d-3ab7278e1617", "Value": "<sys-module-record-guid>"},
        {"SchemaColumnUId": "3f098e0d-6cbd-4e8f-bc3e-00709f2d8d82", "Value": "<sys-module-entity-record-guid>", "DisplayValue": "null"},
        {"SchemaColumnUId": "6d827ba7-a622-47cc-8f11-b40b91c7441a", "Value": ""},
        {"SchemaColumnUId": "ed272316-b65f-41db-a9b4-e53ab939e4d6", "Value": ""},
        {"SchemaColumnUId": "d3afc924-2d21-4c0e-b2f3-9f8c180221f9", "Value": "b659d704-3955-e011-981f-00155d043204", "DisplayValue": "Include record in multiple folders"},
        {"SchemaColumnUId": "eea74681-e019-4885-9a1e-e8261f2665ea", "Value": false},
        {"SchemaColumnUId": "34dfc288-1b25-4d53-bdf3-16b58a84e276", "Value": false},
        {"SchemaColumnUId": "a0fd39b2-b680-4515-ac3c-72322db4f1b8", "Value": false},
        {"SchemaColumnUId": "80769c54-f4f4-43cb-93f8-0824715969a6", "Value": false},
        {"SchemaColumnUId": "e0c474a3-e4bc-457e-bb67-c1ec1b399f60", "Value": "UsrTodoTask"},
        {"SchemaColumnUId": "9a366fd1-19c8-4ba7-9bdd-039f164c08ec", "Value": ""},
        {"SchemaColumnUId": "bd3cf32d-f9b5-471b-a0ca-f541296b979d", "Value": ""},
        {"SchemaColumnUId": "b3fefb7f-2aab-4b16-97aa-6ca3f3bd7ac2", "Value": "null"},
        {"SchemaColumnUId": "327a0dc4-df63-4f6e-9d33-bc403d284cb6", "Value": "<form-page-schema-uid>"},
        {"SchemaColumnUId": "d57c3c34-e293-4aed-bff6-91dc90408958", "Value": "12244568-6d4f-f201-ed26-ac3913021080"},
        {"SchemaColumnUId": "af5bbb5e-9c78-44b7-8fdd-2bfc4353b4a8", "Value": "<list-page-schema-uid>"},
        {"SchemaColumnUId": "cb4bb1d2-d369-406e-8150-502dd7af2199", "Value": "c3382be3-6619-9256-2260-93d87cf0d9b5"},
        {"SchemaColumnUId": "f3a29fb6-f13d-443e-8360-d4f51e8bcec8", "Value": "null"},
        {"SchemaColumnUId": "63f1eb37-455a-4a53-ace2-fa5ef4c3d10f", "Value": "null", "DisplayValue": ""},
        {"SchemaColumnUId": "380d55b9-487c-429b-9aff-e04101ffc307", "Value": "null", "DisplayValue": ""},
        {"SchemaColumnUId": "e6243d2b-cc8f-4b2d-8646-36bac9fb48e9", "Value": "null", "DisplayValue": "null"},
        {"SchemaColumnUId": "dedaabd6-732d-47ac-b229-50a8ee02292c", "Value": false},
        {"SchemaColumnUId": "1e4741cc-9a6e-446f-9865-5f5910fadd67", "Value": 0},
        {"SchemaColumnUId": "48ed5be5-6dcd-44ba-6294-a29c8daef880", "Value": "#7848EE"}
      ]
    }
  ]
}
```

**Key values to set:**
- `Id` — new GUID for this SysModule record
- `Code` — entity name (e.g., `"UsrTodoTask"`)
- `SysModuleEntity` — GUID of the SysModuleEntity record (created separately)
- `CardSchemaUId` — UId of the form page schema
- `SectionSchemaUId` — UId of the list page schema
- `SectionModuleSchemaUId` — `"12244568-6d4f-f201-ed26-ac3913021080"` (standard)
- `CardModuleUId` — `"c3382be3-6619-9256-2260-93d87cf0d9b5"` (standard)
- `IconBackground` — hex color (e.g., `"#7848EE"`)

---

## SysModuleEntity (Entity Binding)

Links an entity schema to a section.

### SysModuleEntity Column UIds

| Column | ColumnUId | Description |
|--------|-----------|-------------|
| **Id** | `ae0e45ca-c495-4fe7-a39d-3ab7278e1617` | Record ID (IsKey) |
| **SysEntitySchemaUId** | `0c59594b-490a-4b55-a564-5841cfae3c19` | The entity schema UId |
| **TypeColumnUId** | `3107ef98-a02e-4ea8-809a-67dc3025ef4a` | Type column UId (for polymorphic entities) |

### SysModuleEntity descriptor.json

```json
{
  "Descriptor": {
    "UId": "<binding-guid>",
    "Name": "SysModuleEntity_UsrTodoTask",
    "ModifiedOnUtc": "/Date(1700000000000)/",
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

### SysModuleEntity data.json

```json
{
  "PackageData": [
    {
      "Row": [
        {"SchemaColumnUId": "ae0e45ca-c495-4fe7-a39d-3ab7278e1617", "Value": "<sys-module-entity-record-guid>"},
        {"SchemaColumnUId": "0c59594b-490a-4b55-a564-5841cfae3c19", "Value": "<main-entity-schema-uid>"},
        {"SchemaColumnUId": "3107ef98-a02e-4ea8-809a-67dc3025ef4a", "Value": "null"}
      ]
    }
  ]
}
```

**Key values:**
- `Id` — new GUID (this is the same GUID referenced by SysModule.SysModuleEntity)
- `SysEntitySchemaUId` — UId of the main entity schema (e.g., UsrTodoTask)
- `TypeColumnUId` — `"null"` unless using polymorphic types

---

## Lookup Seed Data

For seeding lookup values (e.g., Status: New, In Progress, Done).

### Lookup Seed descriptor.json

```json
{
  "Descriptor": {
    "UId": "<binding-guid>",
    "Name": "UsrTodoTaskStatus_Lookup",
    "ModifiedOnUtc": "/Date(1700000000000)/",
    "InstallType": 0,
    "Schema": {
      "UId": "<lookup-entity-schema-uid>",
      "Name": "UsrTodoTaskStatus"
    },
    "Columns": [
      {"ColumnUId": "ae0e45ca-c495-4fe7-a39d-3ab7278e1617", "IsForceUpdate": false, "IsKey": true, "ColumnName": "Id", "DataTypeValueUId": "23018567-a13c-4320-8687-fd6f9e3699bd"},
      {"ColumnUId": "736c30a7-c0ec-4fa9-b034-2552b319b633", "IsForceUpdate": false, "IsKey": false, "ColumnName": "Name", "DataTypeValueUId": "325a73b8-0f47-44a0-8412-7606f78003ac"},
      {"ColumnUId": "9e53fd7c-dde4-4502-a64c-b9e34148108b", "IsForceUpdate": false, "IsKey": false, "ColumnName": "Description", "DataTypeValueUId": "325a73b8-0f47-44a0-8412-7606f78003ac"}
    ]
  }
}
```

**Note:** `Name` and `Description` columns come from BaseLookup parent (UIds `736c30a7-...` and `9e53fd7c-...`).

### Lookup Seed data.json

```json
{
  "PackageData": [
    {
      "Row": [
        {"SchemaColumnUId": "ae0e45ca-c495-4fe7-a39d-3ab7278e1617", "Value": "<new-guid-1>"},
        {"SchemaColumnUId": "736c30a7-c0ec-4fa9-b034-2552b319b633", "Value": "New"},
        {"SchemaColumnUId": "9e53fd7c-dde4-4502-a64c-b9e34148108b", "Value": ""}
      ]
    },
    {
      "Row": [
        {"SchemaColumnUId": "ae0e45ca-c495-4fe7-a39d-3ab7278e1617", "Value": "<new-guid-2>"},
        {"SchemaColumnUId": "736c30a7-c0ec-4fa9-b034-2552b319b633", "Value": "In Progress"},
        {"SchemaColumnUId": "9e53fd7c-dde4-4502-a64c-b9e34148108b", "Value": ""}
      ]
    },
    {
      "Row": [
        {"SchemaColumnUId": "ae0e45ca-c495-4fe7-a39d-3ab7278e1617", "Value": "<new-guid-3>"},
        {"SchemaColumnUId": "736c30a7-c0ec-4fa9-b034-2552b319b633", "Value": "Done"},
        {"SchemaColumnUId": "9e53fd7c-dde4-4502-a64c-b9e34148108b", "Value": ""}
      ]
    }
  ]
}
```

---

## filter.json

Most data bindings use an empty filter:

```json
""
```

---

## Cross-References Between Data Bindings

The `SysModule` and `SysModuleEntity` records must reference each other:

```
SysModuleEntity record:
  Id = <GUID-A>
  SysEntitySchemaUId = <main entity schema UId>

SysModule record:
  Id = <GUID-B>
  SysModuleEntity = <GUID-A>  ← references the SysModuleEntity record
  CardSchemaUId = <form page schema UId>
  SectionSchemaUId = <list page schema UId>
```

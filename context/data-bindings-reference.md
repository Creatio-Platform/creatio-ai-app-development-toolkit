# Data Bindings Reference

Data bindings register sections, connect entities to navigation, and seed lookup values. In the current MCP flow, the primary binding tools are `binding.get_columns` and `binding.create`.

**📁 Stable system column UIds → `context/bindings-lookup.json`**  
**📁 Template examples → `templates/data-bindings/`**

---

## MCP Binding Tools

### `binding.get_columns`

Use this first for deployed schemas when you need column names, UIds, and data value types.

Request:
```json
{
  "schemaName": "SysModule"
}
```

Response shape:
```json
[
  {
    "name": "Id",
    "uId": "11111111-1111-1111-1111-111111111111",
    "dataValueTypeName": "Guid",
    "dataValueTypeUId": "00000000-0000-0000-0000-000000000000",
    "isRequired": true,
    "referenceSchemaName": null
  }
]
```

### `binding.create`

Creates or updates a binding in the DB for any deployed entity schema, stores `descriptor.json`, `data.json`, and `filter.json` payloads in `SysPackageSchemaData`, and installs data immediately. If `outputPath` is supplied, the same files are also written on the server.

Request fields:
- `packageUId` — package GUID that owns the binding
- `schemaName` — target schema such as `SysModule`, `SysModuleEntity`, or a lookup entity
- `bindingName` — output folder name such as `SysModule_UsrTodoTask`
- `rowsJson` — JSON array of rows, each row being an array of `{columnName, value, displayValue?}`
- `columnsJson` — optional explicit descriptor columns `{columnName, isKey?, isForceUpdate?}`
- `installType` — optional descriptor install type, default `0`
- `outputPath` — optional server filesystem destination

Response shape:
```json
{
  "success": true
}
```

Error shape:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "packageUId must be a valid GUID."
  }
}
```

---

## Binding File Structure

Each persisted binding still maps to the same package layout:
- `Data/<BindingName>/descriptor.json`
- `Data/<BindingName>/data.json`
- `Data/<BindingName>/filter.json`

Use `templates/data-bindings/` as reference output, not as the primary generation path. The MCP success payload does not return these file bodies; they are stored in DB and optionally written to `outputPath`.

---

## Common Binding Targets

### SysModule (Section Registration)

Registers a section in navigation.

**Schema UId:** `2b2ed767-0b4b-4a7b-9de2-d48e14a2c0c5`

Key columns:
- `Id`
- `Code`
- `Caption`
- `SysModuleEntity`
- `CardSchemaUId`
- `SectionSchemaUId`
- `IconBackground`
- `Type`
- `FolderMode`

Standard values:
- `SectionModuleSchemaUId`: `"12244568-6d4f-f201-ed26-ac3913021080"`
- `CardModuleUId`: `"c3382be3-6619-9256-2260-93d87cf0d9b5"`
- `FolderMode`: `"b659d704-3955-e011-981f-00155d043204"`

### SysModuleEntity (Entity Binding)

Links an entity to a section.

**Schema UId:** `9c762665-90ad-497b-ac4b-45bb729630a1`

Key columns:
- `Id`
- `SysEntitySchemaUId`
- `TypeColumnUId`

### Lookup Seed Data

Seeds rows for lookup entities such as status lists.

Key columns:
- `Id`
- `Name`
- `Description`

Example `rowsJson`:
```json
[
  [
    {"columnName": "Id", "value": "11111111-0000-0000-0000-000000000001"},
    {"columnName": "Name", "value": "New"},
    {"columnName": "Description", "value": ""}
  ],
  [
    {"columnName": "Id", "value": "22222222-0000-0000-0000-000000000002"},
    {"columnName": "Name", "value": "In Progress"},
    {"columnName": "Description", "value": ""}
  ]
]
```

---

## ID Rules

- Generate a new GUID for each `SysModule` record.
- Generate a new GUID for each `SysModuleEntity` record and reuse it from `SysModule.SysModuleEntity`.
- Generate a new GUID for each lookup seed row.

---

## Practical Guidance

- Prefer `binding.get_columns` for deployed system schemas such as `SysModule` and `SysModuleEntity`.
- Newly created schemas from `entity.create` or `entity.create_lookup` are DB-first and should be discoverable through `binding.get_columns`; raw mode is not supported.
- Treat `packageUId + bindingName` as the binding identity for create/update flow.
- Leave `filter.json` as `""` for standard SysModule, SysModuleEntity, and lookup seed bindings.
- Treat `outputPath` as optional. The primary effect is DB persistence plus immediate install; server-side files are only a side effect.

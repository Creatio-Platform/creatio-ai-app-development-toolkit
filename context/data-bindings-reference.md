# Data Bindings Reference

Data bindings register sections, connect entities to navigation, and seed lookup values. In the current MCP flow, the primary tools are `get-entity-schema-properties`, `get-entity-schema-column-properties`, and `create-data-binding-db`.

**📁 Stable system column UIds → `context/bindings-lookup.json`**  
**📁 Template examples → `templates/data-bindings/`**

---

## MCP Binding & Schema Inspection Tools

### `get-entity-schema-properties`

Returns column names, UIds, and data value types for a deployed entity schema.

Parameters (all kebab-case):
- `environment-name` — registered clio environment name
- `package-name` — package string name (NOT a GUID)
- `schema-name` — entity schema name, e.g. `SysModule`

Response shape:
```json
[
  {
    "name": "Id",
    "uId": "<column-uid>",
    "dataValueTypeName": "Guid",
    "dataValueTypeUId": "00000000-0000-0000-0000-000000000000",
    "isRequired": true,
    "referenceSchemaName": null
  }
]
```

### `get-entity-schema-column-properties`

Returns detailed metadata for a single column.

Parameters (all kebab-case):
- `environment-name` — registered clio environment name
- `package-name` — package string name
- `schema-name` — entity schema name
- `column-name` — column to inspect, e.g. `UsrStatus`

### `create-data-binding-db`

Creates or updates a data binding in the DB, stores payload, and installs data immediately.

Parameters (all kebab-case):
- `environment-name` — registered clio environment name
- `package-name` — package string name
- `schema-name` — target schema such as `SysModule`, `SysModuleEntity`, or a lookup entity

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
    "message": "..."
  }
}
```

### `upsert-data-binding-row-db`

Upserts a single row in an existing data binding.

Parameters (all kebab-case):
- `environment-name` — registered clio environment name
- `package-name` — package string name
- `schema-name` — target schema
- `values` — JSON object of column-name → value pairs, must include `Id`

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

Example seed rows (new format for `create-data-binding-db` and `schema-sync` `seed-rows`):
```json
[
  {"values": {"Id": "<fresh-guid-1>", "Name": "New", "Description": ""}},
  {"values": {"Id": "<fresh-guid-2>", "Name": "In Progress", "Description": ""}}
]
```

---

## ID Rules

- Generate a new GUID for each `SysModule` record.
- Generate a new GUID for each `SysModuleEntity` record and reuse it from `SysModule.SysModuleEntity`.
- Generate a new GUID for each lookup seed row.

---

## Practical Guidance

- Prefer `get-entity-schema-properties` for deployed system schemas such as `SysModule` and `SysModuleEntity`.
- Newly created schemas from `create-entity-schema` or `create-lookup` are DB-first and should be discoverable through `get-entity-schema-properties`; raw mode is not supported.
- Treat `packageUId + bindingName` as the binding identity for create/update flow.
- Leave `filter.json` as `""` for standard SysModule, SysModuleEntity, and lookup seed bindings.
- Treat `outputPath` as optional. The primary effect is DB persistence plus immediate install; server-side files are only a side effect.
- Generate fresh GUID values for lookup seed rows at execution time. Placeholder GUIDs in docs show format only.
- For lookup seed bindings, prefer omitting `columnsJson` so MCP infers `Id`, `Name`, and optional `Description` from `rowsJson`. If `columnsJson` is supplied, include every seeded descriptor column.

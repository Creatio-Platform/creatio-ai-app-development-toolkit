---
name: data-bindings-creation
description: Create or update Creatio data bindings through MCP `get-entity-schema-properties`, `create-data-binding-db`, and `upsert-data-binding-row-db` for SysModule, SysModuleEntity, and lookup seed data.
compatibility: Requires Creatio MCP binding tools plus context/bindings-lookup.json and context/data-bindings-reference.md.
metadata:
  version: "5.0"
  category: creatio-schema-generation
---

# Data Bindings via MCP

Generate package data bindings that register sections and seed lookup values.

## Outputs

- MCP response with `{"success": true}`
- Binding persisted in Creatio DB and data installed immediately

## Source Inputs

From MCP and context:
- `get-entity-schema-properties` for deployed schema metadata (requires `environment-name`, `package-name`, `schema-name`)
- `get-entity-schema-column-properties` for single column metadata (also requires `column-name`)
- current app context with `packageUId` and target schema names
- `context/bindings-lookup.json`
- `context/data-bindings-reference.md`

## Rules

1. MCP usage is the primary generation path. All params use kebab-case.
2. Do not generate or change stable system column UIds; use values from `bindings-lookup.json`.
3. `SysModule.data.json` and `SysModuleEntity.data.json` must reference the same SysModuleEntity record GUID.
4. `SysModule.CardSchemaUId` must match the form page UId in the resolved app context.
5. `SysModule.SectionSchemaUId` must match the list page UId in the resolved app context.
6. Use standard values from `context/data-bindings-reference.md`:
   - `SectionModuleSchemaUId`: `12244568-6d4f-f201-ed26-ac3913021080`
   - `CardModuleUId`: `c3382be3-6619-9256-2260-93d87cf0d9b5`
   - `FolderMode`: `b659d704-3955-e011-981f-00155d043204`
7. `filter.json` for standard bindings is `""`.
8. For lookup seed data, create one row per seed value.
9. `create-data-binding-db` requires `environment-name`, `package-name`, `schema-name`. After `create-entity-schema` or `create-lookup`, use `get-entity-schema-properties` if column discovery is needed.
10. Generate a fresh GUID for every lookup seed row. Do not reuse decorative placeholder GUIDs from docs in executable payloads.
11. For lookup seed bindings via `schema-sync`, prefer inline `seed-rows` format: `[{"values": {"Name": "New"}}, ...]`.
12. `upsert-data-binding-row-db` upserts a single row and requires `environment-name`, `package-name`, `schema-name`, `values`.

## Typical MCP Flow

1. Call `get-entity-schema-properties` for deployed targets such as `SysModule` or `SysModuleEntity`.
2. Build seed rows in `[{"values": {...}}, ...]` format.
3. Call `create-data-binding-db` with `environment-name`, `package-name`, `schema-name`.
4. Validate `{"success": true}`.

## Validation Checklist

- MCP response parses successfully
- `success` is `true`
- Binding and seed data are installed in Creatio
- All references (entity/page/module ids) match the current app context
- Lookup data contains all seed values
- Lookup seed rows use fresh GUID values

## Notes

- `create-data-binding-db` does not return generated file bodies on success; the main result is DB persistence and immediate install.
- Use `templates/data-bindings/` as reference examples, not as the primary generation path.

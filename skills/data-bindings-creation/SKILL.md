---
name: data-bindings-creation
description: Generate Creatio data binding JSON through MCP `binding.get_columns` and `binding.create` for SysModule, SysModuleEntity, and lookup seed data.
compatibility: Requires Creatio MCP binding tools plus context/bindings-lookup.json and context/data-bindings-reference.md.
metadata:
  version: "4.0"
  category: creatio-schema-generation
---

# Data Bindings via MCP

Generate package data bindings that register sections and seed lookup values.

## Outputs

- MCP response with `bindingName` and `files.descriptor|data|filter`
- Optional server-side files when `outputPath` is provided to `binding.create`

## Source Inputs

From MCP and context:
- `binding.get_columns` for deployed schemas
- `entity.create` / `entity.create_lookup` response data for `rawSchemaJson` when schema is not yet deployed
- `context/bindings-lookup.json`
- `context/data-bindings-reference.md`

## Rules

1. MCP usage is the primary generation path.
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
9. Use `rawSchemaJson` when the target schema was created earlier in the same flow and is not yet discoverable through `binding.get_columns`.

## Typical MCP Flow

1. Call `binding.get_columns` for deployed targets such as `SysModule` or `SysModuleEntity`.
2. Build `rowsJson` and optional `columnsJson`.
3. Call `binding.create`.
4. Persist the returned file bodies or write them on the server through `outputPath`.

## Validation Checklist

- MCP response parses successfully
- `files.descriptor`, `files.data`, and `files.filter` are present
- All references (entity/page/module ids) match the current app context
- Lookup data contains all seed values

## Notes

- `outputPath` is optional and writes files on the Creatio server, not into this repository.
- Use `templates/data-bindings/` as reference examples, not as the primary generation path.

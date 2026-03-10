---
name: data-bindings-creation
description: Create or update Creatio data bindings through MCP `binding.get_columns` and `binding.create` for SysModule, SysModuleEntity, and lookup seed data.
compatibility: Requires Creatio MCP binding tools plus context/bindings-lookup.json and context/data-bindings-reference.md.
metadata:
  version: "4.1"
  category: creatio-schema-generation
---

# Data Bindings via MCP

Generate package data bindings that register sections and seed lookup values.

## Outputs

- MCP response with `{"success": true}`
- Binding persisted in Creatio DB and data installed immediately
- Optional server-side files when `outputPath` is provided to `binding.create`

## Source Inputs

From MCP and context:
- `binding.get_columns` for deployed schemas
- current app context with `packageUId` and target schema names
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
9. `binding.create` requires `packageUId` and works only with deployed schema metadata. After `entity.create` or `entity.create_lookup`, use the persisted schema name and `binding.get_columns` if column discovery is needed.

## Typical MCP Flow

1. Call `binding.get_columns` for deployed targets such as `SysModule` or `SysModuleEntity`.
2. Build `rowsJson` and optional `columnsJson`.
3. Call `binding.create` with `packageUId`, `schemaName`, `bindingName`, and `rowsJson`.
4. Validate `{"success": true}` and use `outputPath` only when server-side files are needed.

## Validation Checklist

- MCP response parses successfully
- `success` is `true`
- Binding and seed data are installed in Creatio
- If `outputPath` is used, `descriptor.json`, `data.json`, and `filter.json` are written on the server
- All references (entity/page/module ids) match the current app context
- Lookup data contains all seed values

## Notes

- `outputPath` is optional and writes files on the Creatio server, not into this repository.
- `binding.create` does not return generated file bodies on success; the main result is DB persistence and immediate install.
- Use `templates/data-bindings/` as reference examples, not as the primary generation path.

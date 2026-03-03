---
name: data-bindings-creation
description: Generate Creatio data binding folders for SysModule, SysModuleEntity, and lookup seed data using JSON templates.
compatibility: Requires context/bindings-lookup.json, context/data-bindings-reference.md, templates/data-bindings/
metadata:
  version: "3.0"
  category: creatio-schema-generation
---

# Data Bindings Generator

Generate package data bindings that register sections and seed lookup values.

## Outputs

For each main entity:
- `Data/SysModuleEntity_<EntityName>/descriptor.json`
- `Data/SysModuleEntity_<EntityName>/data.json`
- `Data/SysModuleEntity_<EntityName>/filter.json`
- `Data/SysModule_<EntityName>/descriptor.json`
- `Data/SysModule_<EntityName>/data.json`
- `Data/SysModule_<EntityName>/filter.json`

For each lookup entity:
- `Data/<LookupEntityName>_Lookup/descriptor.json`
- `Data/<LookupEntityName>_Lookup/data.json`
- `Data/<LookupEntityName>_Lookup/filter.json`

## Source Inputs

From `plan.md`:
- Entity/page UIds
- SysModule/SysModuleEntity record GUIDs
- Lookup seed values and record GUIDs
- Section code/caption/icon background

From context and templates:
- `context/bindings-lookup.json`
- `context/data-bindings-reference.md`
- `templates/data-bindings/sys-module/*`
- `templates/data-bindings/sys-module-entity/*`
- `templates/data-bindings/lookup-seed/*`

## Rules

1. Use template JSON files, then replace placeholders.
2. Do not generate or change system column UIds; use values from `bindings-lookup.json` and templates.
3. `SysModule.data.json` and `SysModuleEntity.data.json` must reference the same SysModuleEntity record GUID.
4. `SysModule.CardSchemaUId` must match form page UId from plan.
5. `SysModule.SectionSchemaUId` must match list page UId from plan.
6. Use standard values from `context/data-bindings-reference.md`:
   - `SectionModuleSchemaUId`: `12244568-6d4f-f201-ed26-ac3913021080`
   - `CardModuleUId`: `c3382be3-6619-9256-2260-93d87cf0d9b5`
   - `FolderMode`: `b659d704-3955-e011-981f-00155d043204`
7. `filter.json` for these bindings is `""`.
8. For lookup seed data, create one `Row` per seed value.

## Validation Checklist

- All required data folders exist
- All binding JSON files are valid
- All references (entity/page/module ids) match plan
- Lookup data contains all seed values

## Output Path

`output/<AppName>/packages/<PackageName>/Data/`

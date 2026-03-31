# Data Bindings Reference

Data bindings register sections, connect entities to navigation, and seed lookup values.

Executable MCP contract is authoritative only in `clio MCP` through `tool-contract-get`.
This document defines binding policy, target invariants, and data-shape expectations only.

## Role In The Workflow

Use this reference for:

- section registration policy
- `SysModule` and `SysModuleEntity` invariants
- lookup seed row semantics
- binding identity rules
- stable system IDs sourced from `context/bindings-lookup.json`

Do not use this file as a hand-written tool API reference.

## Stable Inputs

- stable system column UIds live in `context/bindings-lookup.json`
- template examples live under `templates/data-bindings/`
- exact tool names, params, and error codes come from `tool-contract-get`

## Binding Targets

### `SysModule`

Registers a section in navigation.

Key invariants:

- section registration must point to the current section entity
- `CardSchemaUId` must match the current FormPage
- `SectionSchemaUId` must match the current ListPage
- `SysModuleEntity` must point to the matching `SysModuleEntity` row

Standard values that remain repository policy:

- `SectionModuleSchemaUId`: `12244568-6d4f-f201-ed26-ac3913021080`
- `CardModuleUId`: `c3382be3-6619-9256-2260-93d87cf0d9b5`
- `FolderMode`: `b659d704-3955-e011-981f-00155d043204`

### `SysModuleEntity`

Links an entity to a section.

Key invariants:

- create a fresh `SysModuleEntity` row GUID
- reuse that GUID from the matching `SysModule` row
- keep the target entity UId aligned with the current app context

### Lookup Seed Data

Seeds rows for lookup entities such as statuses, priorities, or categories.

Key invariants:

- preserve the lookup `Name` field as the human title; clio auto-generates `Id` when absent
- do not treat seed rows alone as a default-selection implementation
- prefer inline `schema-sync` `seed-rows` when the lookup is already part of the same schema batch; clio automatically materializes the binding descriptor in the package so seed data travels with the package on pull-pkg / push-pkg
- `create-data-binding-db` is not required for standard lookup seeding; use it only for custom filters, cross-package references, or standalone binding artifacts

Required row shape:

```json
[
  {"values": {"Name": "New", "Description": ""}},
  {"values": {"Name": "In Progress", "Description": ""}}
]
```

**Warning:** flat objects such as `{"Name": "New"}` (without the `values` wrapper) are rejected by clio with an error.

## Binding Identity Rules

- treat `package + binding identity` as the persisted binding target
- for standard lookup seed workflows, use the default schema-named binding unless a separate artifact is explicitly required
- do not create parallel bindings for the same lookup only by varying a decorative binding name

## Practical Guidance

- prefer deployed schema inspection only when you need stable IDs or column discovery
- treat DB persistence plus immediate install as the primary effect of binding execution
- treat file materialization as a secondary side effect
- keep `filter.json` empty for standard section registration and lookup seed bindings unless the workflow explicitly requires a custom filter

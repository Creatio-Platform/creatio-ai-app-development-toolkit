# Data Bindings Reference

Data bindings register sections, connect entities to navigation, and seed lookup values.

Executable MCP contract is authoritative only in `clio MCP` through `tool-contract-get`.
This document defines repo-local binding invariants for section/navigation artifacts plus local evidence-oriented guidance.

## Role In The Workflow

Use this reference for:

- section registration policy
- `SysModule` and `SysModuleEntity` invariants
- lookup seed data constraints that affect business behavior
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

- do not treat seed rows alone as a default-selection implementation
- keep seed values aligned with the approved lookup semantics from the current plan
- generate fresh row GUIDs at execution time when the workflow materializes seed rows explicitly

## Practical Guidance

- prefer deployed schema inspection only when you need stable IDs or column discovery
- treat execution evidence and installed artifacts as the source for result verification
- keep `filter.json` empty for standard section registration bindings unless the workflow explicitly requires a custom filter

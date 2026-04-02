---
name: data-bindings-creation
description: Create or update Creatio data bindings and lookup seed data through DB-first MCP flows while preserving binding and section registration invariants.
compatibility: Requires clio MCP binding tools plus `context/bindings-lookup.json` and `context/data-bindings-reference.md`.
metadata:
  version: "6.0"
  category: creatio-schema-generation
---

# Data Bindings

Use this skill when the workflow must register sections, bind entities to navigation, or seed lookup rows.

This skill is not an MCP API reference.
Resolve exact tool names, parameters, aliases, defaults, and response shapes through `tool-contract-get`.

## Primary Flow

Prefer plan-driven or composite flows first:

1. use batched lookup seeding inside `schema-sync` for normal lookup seeding
2. use explicit binding tools only when the approved workflow explicitly needs a distinct binding artifact or post-sync binding step, based on the current `clio` contract

Typical fallback tool families:

- schema inspection tools for deployed metadata
- binding creation tools for section registration or explicit binding artifacts
- row upsert tools for targeted updates to an existing binding

## Outputs

- MCP response with `{"success": true}`
- binding persisted in Creatio DB
- immediate installed state in Creatio
- execution evidence captured in the workflow result document

## Rules

1. MCP usage is mandatory.
2. Keep `context/bindings-lookup.json` as the source for stable system column UIds.
3. `SysModule` and `SysModuleEntity` links must stay internally consistent.
4. `SysModule.CardSchemaUId` must match the form page UId in the current app context.
5. `SysModule.SectionSchemaUId` must match the list page UId in the current app context.
6. `filter.json` stays empty for standard section registration and lookup seed bindings unless a custom filter is explicitly required.
7. Generate fresh GUIDs for lookup seed rows at execution time.
8. Verify binding results through workflow evidence and installed artifacts, not through inferred tool behavior.

## Source Inputs

- `get-entity-schema-properties` for deployed schema metadata when stable IDs or deployed columns are needed
- `get-entity-schema-column-properties` for single-column verification when needed
- current app context with package and page identifiers
- deployed schema metadata for binding targets when needed
- `context/bindings-lookup.json`
- `context/data-bindings-reference.md`
- explicit seed values or section registration intent from the approved plan

## Typical Workflow

1. Inspect deployed schema metadata only when needed for stable IDs or column discovery.
2. Prefer batched lookup seeding through `schema-sync` when the same workflow already creates or updates the lookup.
3. Use explicit binding creation only when the workflow needs `SysModule`, `SysModuleEntity`, or a separate binding artifact.
4. Upsert targeted rows only after the target binding has been established by the current workflow.
5. Verify the result from execution evidence instead of assuming success from planned rows.

## Validation Checklist

- binding targets match the current app context
- lookup seed rows contain all required values
- every generated row GUID is fresh
- any explicit fallback binding step is justified by the approved workflow
- evidence shows the installed result, not only the requested rows

## Notes

- Template files under `templates/data-bindings/` are reference examples only.
- This skill defines repo-local orchestration guidance and artifact invariants, not executable binding semantics.

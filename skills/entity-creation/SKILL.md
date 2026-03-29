---
name: entity-creation
description: Mutate Creatio entity schemas in DB via MCP tools `create-entity-schema`, `create-lookup`, and `update-entity-schema`, then refresh the canonical workflow context via `application-get-info`.
compatibility: Requires running Creatio with MCP endpoint and DB-first entity tools available.
metadata:
  version: "6.0"
  category: creatio-schema-generation
---

# Entity Schema Sync via MCP

Use this skill when approved schema changes must be applied after `application-create`. These tools persist changes in Creatio DB, and this repo treats refreshed application context from `application-get-info` as the canonical post-mutation state.

## What This Skill Does

- `create-entity-schema` creates a new entity schema in DB
- `create-lookup` creates a new `BaseLookup` entity in DB
- `update-entity-schema` applies explicit `operations` mutations to an existing entity
- `application-get-info` refreshes the canonical app context after each successful mutation or schema batch

## Hard Rules

1. MCP usage is mandatory.
2. Manual schema file generation is forbidden.
3. Create new lookup entities before referencing them from other entities.
4. `update-entity-schema` must use explicit `operations` as a native list.
5. Omission never means delete.
6. Follow the current `clio` MCP contract and `docs://mcp/guides/app-modeling` for lookup/display/default semantics instead of restating them locally.
7. When refreshed application context exposes `canonical-main-entity-name`, treat that entity as the default main entity for single-record-type app flows.

## Input Expected

From `plan.md`, for each step:
- target tool name
- `package-name`
- entity or lookup schema name
- title
- parent schema when creating an entity
- `entity-u-id` for updates when available
- `operations` for updates

## Request Shapes

### create-entity-schema

```json
{
  "environment-name": "local",
  "package-name": "UsrTodoList",
  "schema-name": "UsrTodoTask",
  "title": "Todo Task",
  "parent-schema-name": "BaseEntity",
  "columns": [
    {
      "action": "add",
      "column-name": "UsrStatus",
      "type": "Lookup",
      "title": "Status",
      "reference-schema-name": "UsrTodoTaskStatus"
    }
  ]
}
```

### create-lookup

```json
{
  "environment-name": "local",
  "package-name": "UsrTodoList",
  "schema-name": "UsrTodoTaskStatus",
  "title": "Todo Task Status"
}
```

### update-entity-schema

```json
{
  "environment-name": "local",
  "package-name": "UsrTodoList",
  "schema-name": "UsrTodoTask",
  "operations": [
    {
      "action": "add",
      "column-name": "UsrStatus",
      "type": "Lookup",
      "title": "Status",
      "reference-schema-name": "UsrTodoTaskStatus"
    }
  ]
}
```

## Operation Format

Each item in `operations`:

```json
{
  "action": "add",
  "column-name": "UsrStatus",
  "type": "Lookup",
  "title": "Status",
  "reference-schema-name": "UsrTodoTaskStatus"
}
```

Allowed actions:
- `add`
- `modify`
- `remove`

## Canonical Runtime Context

```json
{
  "success": true,
  "package-u-id": "<package-guid>",
  "package-name": "UsrTodoList",
  "canonical-main-entity-name": "UsrTodoList",
  "entities": [
    {
      "uId": "<entity-guid>",
      "name": "UsrTodoTask",
      "caption": "Todo Task",
      "columns": []
    }
  ]
}
```

This flat application context is the primary runtime contract for this repo. After normalization, `mcp-application-result.json` may also contain `editableContext`, but that is a repo-local helper projection rather than the MCP response contract.

## Refresh Policy

After each successful call or approved schema batch:
1. call `application-get-info` for the current app
2. overwrite `output/<AppName>/mcp-application-result.json` with the refreshed flat context
3. normalize it with `scripts/mcp_context_adapter.py normalize`
4. append an entry to `schemaSync`
5. save the file

## Validation Checklist

- `success=true`
- `package-u-id` is non-empty
- `entities` contains the expected schema after refresh
- `canonical-main-entity-name` is used when deciding whether to extend the template-created main entity or create an additional business object
- lookup references point to already existing schemas
- canonical context file was updated

## Failure Policy

- Retry transient MCP failures up to 3 times with 10s delay
- On validation or business-rule errors, stop immediately and surface the returned error
- Do not continue to dependent updates after a failed lookup creation

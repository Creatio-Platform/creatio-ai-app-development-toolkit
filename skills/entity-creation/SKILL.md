---
name: entity-creation
description: Mutate Creatio entity schemas in DB via MCP tools `create-entity-schema`, `create-lookup`, and `update-entity-schema`, then refresh the canonical workflow context via `application-get-info`.
compatibility: Requires running Creatio with MCP endpoint and DB-first entity tools available.
metadata:
  version: "6.0"
  category: creatio-schema-generation
---

# Entity Schema Sync via MCP

Use this skill when approved schema changes must be applied after `application-create`. These tools persist changes in Creatio DB and return the post-save entity snapshot.

## What This Skill Does

- `create-entity-schema` creates a new entity schema in DB and returns the persisted entity snapshot
- `create-lookup` creates a new `BaseLookup` entity in DB and returns the persisted entity snapshot
- `update-entity-schema` applies explicit `operations` mutations to an existing entity and returns the post-save snapshot
- `application-get-info` refreshes the canonical app context after each successful mutation

## Hard Rules

1. MCP usage is mandatory.
2. Manual schema file generation is forbidden.
3. Create new lookup entities before referencing them from other entities.
4. `update-entity-schema` must use explicit `operations` as a native list.
5. Omission never means delete.
6. BaseLookup already provides `Name` and `Description`; `Name` must remain the lookup `PrimaryDisplayColumn`, so never add `Name`, `Description`, or `UsrName` as custom lookup columns.
7. If the current entity snapshot already contains `Name`, never add duplicate `UsrName`; reuse `Name` as the record title.

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

## Expected Response

```json
{
  "success": true,
  "packageUId": "<package-guid>",
  "entity": {
    "uId": "<entity-guid>",
    "name": "UsrTodoTask",
    "caption": "Todo Task",
    "parentSchemaName": "BaseEntity",
    "columns": []
  }
}
```

## Refresh Policy

After each successful call:
1. call `application-get-info` for the current app
2. overwrite `output/<AppName>/mcp-application-result.json` with the refreshed compact context
3. append an entry to `schemaSync`
4. save the file

## Validation Checklist

- `success=true`
- `entity.uId` is non-empty
- `entity.name` matches the requested schema
- lookup references point to already existing schemas
- lookup payloads do not redefine inherited `Name` or `Description`, and no duplicate `UsrName` is introduced when `Name` already exists
- canonical context file was updated

## Failure Policy

- Retry transient MCP failures up to 3 times with 10s delay
- On validation or business-rule errors, stop immediately and surface the returned error
- Do not continue to dependent updates after a failed lookup creation

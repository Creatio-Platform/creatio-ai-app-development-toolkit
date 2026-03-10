---
name: entity-creation
description: Mutate Creatio entity schemas in DB via MCP tools `entity.create`, `entity.create_lookup`, and `entity.update`, then refresh the canonical workflow context via `application.get_info`.
compatibility: Requires running Creatio with MCP endpoint and DB-first entity tools available.
metadata:
  version: "5.0"
  category: creatio-schema-generation
---

# Entity Schema Sync via MCP

Use this skill when approved schema changes must be applied after `application.create`. These tools no longer generate files. They persist changes in Creatio DB and return the post-save entity snapshot.

## What This Skill Does

- `entity.create` — creates a new entity schema in DB and returns `entity { uId, name, caption, parentSchemaName, columns[] }`
- `entity.create_lookup` — creates a new `BaseLookup` entity in DB and returns the same snapshot shape
- `entity.update` — applies explicit `operationsJson` mutations to an existing entity and returns the post-save snapshot plus `appliedOperations`
- requires `application.get_info` refresh after each successful call

## Hard Rules

1. MCP usage is mandatory.
2. Manual schema file generation is forbidden.
3. Create new lookup entities before referencing them from other entities.
4. `entity.update` must use explicit `operationsJson`.
5. Omission never means delete.
6. BaseLookup already provides `Name` and `Description`; `Name` must remain the lookup `PrimaryDisplayColumn`, so never add `Name`, `Description`, or `UsrName` as custom lookup columns.
7. If the current entity snapshot already contains `Name`, never add duplicate `UsrName`; reuse `Name` as the record title.

## Input Expected

From `plan.md`, for each step:
- target tool name
- `packageUId`
- entity name
- caption
- parent schema
- `entityUId` for updates
- `operationsJson` for updates

## Request Shapes

### entity.create

```json
{
  "packageUId": "<package-guid>",
  "name": "UsrTodoTask",
  "caption": "Todo Task",
  "parentSchemaName": "BaseEntity",
  "columnsJson": "[{\"name\":\"UsrTitle\",\"caption\":\"Title\",\"dataValueTypeName\":\"ShortText\",\"isRequired\":true}]"
}
```

### entity.create_lookup

```json
{
  "packageUId": "<package-guid>",
  "name": "UsrTodoTaskStatus",
  "caption": "Todo Task Status"
}
```

### entity.update

```json
{
  "entityUId": "<entity-guid>",
  "packageUId": "<package-guid>",
  "name": "UsrTodoTask",
  "caption": "Todo Task",
  "parentSchemaName": "BaseEntity",
  "operationsJson": "[{\"operation\":\"addColumn\",\"column\":{\"name\":\"UsrStatus\",\"caption\":\"Status\",\"referenceSchemaName\":\"UsrTodoTaskStatus\"}}]"
}
```

## Operation Format

Each item in `operationsJson`:

```json
{
  "operation": "addColumn",
  "column": {
    "name": "UsrStatus",
    "caption": "Status",
    "dataValueTypeName": "Lookup",
    "isRequired": false,
    "referenceSchemaName": "UsrTodoTaskStatus"
  }
}
```

Allowed operations:
- `addColumn`
- `updateColumn`
- `removeColumn`

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
  },
  "appliedOperations": []
}
```

## Refresh Policy

After each successful call:
1. call `application.get_info` for the current app
2. overwrite `output/<AppName>/mcp-application-result.json` with the refreshed compact context
3. append an entry to `schemaSync`
4. save the file

## Validation Checklist

- `success=true`
- `entity.uId` is non-empty
- `entity.name` matches the requested schema
- lookup references point to already existing schemas
- lookup payloads do not redefine inherited `Name`/`Description`, and no duplicate `UsrName` is introduced when `Name` already exists
- canonical context file was updated

## Failure Policy

- Retry transient MCP failures up to 3 times with 10s delay.
- On validation or business-rule errors, stop immediately and surface the returned error.
- Do not continue to dependent updates after a failed lookup creation.

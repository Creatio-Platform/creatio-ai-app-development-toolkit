---
name: application-creation
description: Create or refresh a Creatio application context via MCP short-contract application tools and synchronize approved schema changes via DB-first entity tools.
compatibility: Requires running Creatio MCP endpoint with `application.create`, `application.get_list`, `application.get_info`, `entity.create`, `entity.create_lookup`, `entity.update`, `binding.get_columns`, and `binding.create` available.
metadata:
  version: "2.1"
  category: creatio-schema-generation
---

# Application Creation via MCP

Use MCP `application.create` as the primary DB-first flow for full app creation. Use `application.get_list` and `application.get_info` for existing-app discovery and canonical DB refresh. `output/<AppName>/mcp-application-result.json` must always be overwritten by the latest compact short application context.

## Outputs

- `output/<AppName>/mcp-application-result.json`
- `output/<AppName>/mcp-application-report.md`

## Required Inputs

From `plan.md`:
- resolved `application.create` payload
- ordered schema sync steps, if any

From env:
- `.creatio-env.json` → `mcpUrl`

## MCP Protocol Flow

1. `initialize`
2. extract `Mcp-Session-Id`
3. `tools/list` and verify `application.create`, `application.get_list`, `application.get_info`
4. for new app flow: `tools/call` → `application.create`
5. for existing app flow: `tools/call` → `application.get_list`, then `application.get_info`
6. parse `result.content[0].text` as the short contract
7. initialize `mcp-application-result.json`
8. if needed, execute ordered:
   - `entity.create_lookup`
   - `entity.create`
   - `entity.update`
9. after each successful entity mutation, call `application.get_info` and overwrite `mcp-application-result.json`

Implementation execution is synchronous. Do not background Agent 4, and do not mix repo-maintenance edits with the app-generation run.

## Orchestration Scripts

Run:

```bash
python3 scripts/mcp_context_adapter.py normalize output/<AppName>/mcp-application-result.json
```

This adds `editableContext` with:
- `packages[] { packageUId, name, isPrimary, entities[] }`
- `entities[] { entityUId, name, caption, kind, parentSchemaName?, columns[] }`

When approved edits exist, save the edited package/entity projection and run:

```bash
python3 scripts/mcp_schema_sync.py apply --result output/<AppName>/mcp-application-result.json --edited-context output/<AppName>/editable-context.json --env output/<AppName>/.creatio-env.json
```

The script computes the diff, calls ordered entity tools, and refreshes canonical context through `application.get_info` after each successful mutation.

## Response Handling

`tools/call` response content is text.

Expected contract:
- `success`
- `app { id, code }`
- `packages { <PackageName>: { uId, isPrimary, entities { <EntityName>: { uId, caption, columns { <ColumnName>: { uId?, caption, dataValueTypeName, referenceSchemaName? } } } } } }`
- `error`

Normalize and persist:
- `contractType`
- `success`
- `app`
- `packages`
- `error`
- `schemaSync`
- `editableContext`

Persist the compact context from MCP and set `contractType=short`.

## Schema Sync Rules

- Create new lookup entities first with `entity.create_lookup`.
- Use `entity.create` only for new entities not already created by the application template.
- Use `entity.update` for template-created entities and pass only `operationsJson`.
- Entity-tool success is valid only when the schema is fully materialized, immediately refreshable via `application.get_info`, and not left in a `Database update required` state.
- `entity.update` operations are explicit:
  - `addColumn`
  - `updateColumn`
  - `removeColumn`
- Omission never implies deletion.

## Related Binding Tools

- `binding.get_columns` discovers column names, UIds, and data value types for deployed schemas such as `SysModule` and `SysModuleEntity`.
- `binding.create` generates `descriptor.json`, `data.json`, and `filter.json` for binding records and lookup seed data.
- Use `rawSchemaJson` with `binding.create` when a target schema was created earlier in the same flow and is not yet queryable through `binding.get_columns`.

## Validation Checklist

- response text parses as JSON
- `contractType=short`
- `success` exists
- if `success=true`, `app.id` is non-empty
- if `success=true`, `packages` is non-empty
- if `success=false`, `error.message` is non-empty
- each successful entity tool call is followed by a successful `application.get_info` refresh
- result and report are persisted

## Retry and Failure Policy

- Retry MCP calls up to 3 times with 10s delay for transient failures.
- If required application tools are missing in `tools/list`, stop with blocker.
- If any tool returns `success=false`, stop with blocker and surface `error.message`.
- For plain-text `ERROR:` responses, stop with blocker and persist raw response in report.
- If `application.get_info` fails after a reported entity mutation success because the schema is missing from server metadata, stop with a core MCP materialization blocker.

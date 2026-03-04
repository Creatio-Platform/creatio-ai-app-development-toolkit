# TodoList — Implementation Plan

## App Summary

Generate Todo List application package(s) through MCP `application.create` and materialize preview files to local `output`.

## Resolved MCP Payload

```json
{
  "name": "Todo List",
  "code": "UsrTodoList",
  "templateCode": "AppFreedomUI",
  "iconId": "auto",
  "iconBackground": "auto",
  "description": "Simple task management application",
  "optionalTemplateDataJson": "{\"useExistingEntitySchema\":false,\"entitySchemaName\":\"\",\"appSectionDescription\":\"Manage todo tasks with statuses and priorities\",\"useAIContentGeneration\":false}"
}
```

## Runtime Resolution Strategy

### iconId

1. Query `SysAppIcons` with non-empty `Data`.
2. Select deterministic first row ordered by `Name ASC`, tie-break `CreatedOn ASC`.
3. If no record found, fallback to:
   - `1205b66c-e5f8-4d90-a9db-02c5fe30d367`

### iconBackground

Deterministic pseudo-random by `code` over palette:

- `#1F5F8B`
- `#2D8CFF`
- `#16A085`
- `#27AE60`
- `#F39C12`
- `#E67E22`
- `#C0392B`
- `#8E44AD`

## Expected Output Artifacts

- `output/TodoList/packages/**`
- `output/TodoList/mcp-application-preview.json`
- `output/TodoList/mcp-application-report.md`

## Validation Rules

1. MCP `tools/list` contains `application.create`.
2. `application.create` response is successful and parseable.
3. At least one package is returned.
4. Every package has root `descriptor.json`.
5. Generated JSON files parse successfully.
6. Path traversal and absolute paths are rejected during materialization.

## Blocker Conditions

- MCP endpoint unavailable.
- `application.create` missing in tools list.
- `application.create` returns `ERROR:` text.
- `meta.success=false` in preview payload.
- No packages generated after preview.

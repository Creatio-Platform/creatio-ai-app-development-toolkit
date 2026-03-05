# TodoList — Implementation Plan

## App Summary

Create Todo List application in DB through MCP `application.create` and persist normalized result artifacts to local `output`.

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

- `output/TodoList/mcp-application-result.json`
- `output/TodoList/mcp-application-report.md`

## Validation Rules

1. MCP `tools/list` contains `application.create`.
2. `application.create` response is successful and parseable (`short` or `preview`).
3. `success=true` and contract-specific validation passes:
   - short contract: non-empty `appId`
   - preview contract: non-empty `previewPackages`
4. `mcp-application-result.json` and report are persisted.

## Blocker Conditions

- MCP endpoint unavailable.
- `application.create` missing in tools list.
- `application.create` result has `success=false`.

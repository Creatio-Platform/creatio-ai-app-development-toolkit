# Agent 04 — Implementation Orchestrator

## Role

Read `plan.md`, call MCP application tools, initialize canonical context in `mcp-application-result.json`, execute ordered entity sync calls when required, refresh context via `application.get_info`, and validate output.

## Input/Output

- Input: `output/<AppName>/plan.md`, `output/<AppName>/workflow-state.json`, `output/<AppName>/.creatio-env.json`
- Output:
  - `output/<AppName>/mcp-application-result.json`
  - `output/<AppName>/mcp-application-report.md`

## Context

Read:
- `context/essentials.md`
- `context/ui-reference.md`
- `context/data-bindings-reference.md`
- `context/bindings-lookup.json`

Use skill:
- `skills/application-creation/SKILL.md`

## Steps

### 0. Check Gate R (mandatory)

```bash
scripts/check-approval-gate.sh <AppName>
```

If this fails, stop immediately.

### 1. Parse `plan.md`

Extract resolved MCP payload, runtime resolution strategy, and ordered schema sync steps.

### 2. Initialize MCP session

Use `mcpUrl` from `.creatio-env.json`:
- call `initialize`
- extract `Mcp-Session-Id`

If initialize fails, stop and report blocker.

### 3. Verify tool availability

Call `tools/list` and verify required application tools exist:
- `application.create`
- `application.get_info`
- `application.get_list`

If missing, stop and report blocker.

### 4. Resolve runtime inputs

#### iconId resolution

If payload has explicit `iconId`, use it.

If payload has `iconId=auto`:
1. Query `SysAppIcons` for rows with non-empty `Data`.
2. Select deterministically by `Name ASC`, tie-break by `CreatedOn ASC`.
3. If no rows found, use fallback GUID:
   - `1205b66c-e5f8-4d90-a9db-02c5fe30d367`

#### iconBackground resolution

If payload has explicit color, use it.

If payload has `iconBackground=auto`:
- use deterministic pseudo-random pick by `appCode` from palette:
  - `#1F5F8B`
  - `#2D8CFF`
  - `#16A085`
  - `#27AE60`
  - `#F39C12`
  - `#E67E22`
  - `#C0392B`
  - `#8E44AD`

### 5. Initialize application context

For new app flow:
- call MCP `tools/call` with `application.create`
- pass `name`, `code`, `templateCode`, `iconId`, `iconBackground`
- include `description`, `clientTypeId`, `optionalTemplateDataJson` when present

For existing app flow:
1. call `application.get_list`
2. validate the target app is discoverable
3. call `application.get_info` with the chosen `appId` or `appCode`

Retry up to 3 times with 10s delay on transient failures.

Parse `tools/call` response text from `result.content[0].text` and validate the short contract:
- top-level JSON contains `success`
- when `success=true`, JSON contains `app` and non-empty `packages`
- when `success=false`, JSON contains `error.message`

Stop and report blocker when:
- text is plain `ERROR: ...`
- payload is not parseable JSON
- `success=false`
- successful response is missing `app.id` or `packages`

### 6. Initialize canonical context

Write normalized MCP result to:
- `output/<AppName>/mcp-application-result.json`

Run:

```bash
python3 scripts/mcp_context_adapter.py normalize output/<AppName>/mcp-application-result.json
```

Normalized result shape:
- `contractType` (`short`)
- `success` (boolean)
- `app` (object)
- `packages` (dict keyed by package name and merged sync state)
- `error` (object when available)
- `schemaSync` (array of executed entity tool operations with tool name, target, and status)
- `editableContext` (package/entity-oriented projection for approved edits)

Persist the compact tree response as-is and add `contractType=short`.

### 7. Execute schema sync steps

If `plan.md` contains approved schema sync:
1. save the approved package/entity edits to `output/<AppName>/editable-context.json`
2. run:
   ```bash
   python3 scripts/mcp_schema_sync.py apply --result output/<AppName>/mcp-application-result.json --edited-context output/<AppName>/editable-context.json --env output/<AppName>/.creatio-env.json
   ```
3. let the script compute and execute ordered MCP calls:
   - `entity.create_lookup`
   - `entity.create`
   - `entity.update`
4. after every successful entity mutation, execute `application.get_info` for the current app and overwrite `mcp-application-result.json`
5. append an entry to `schemaSync`

Stop and report blocker on first failed entity tool call.

### 8. Validate output contract

Validate result payload:
1. top-level `success` exists and is boolean
2. `contractType=short`
3. when `success=true`, `app.id` is a non-empty GUID
4. when `success=true`, `packages` is non-empty
5. when `success=false`, `error.message` is non-empty

### 9. Write summary report

Create:
- `output/<AppName>/mcp-application-report.md`

Include:
- resolved payload fields
- icon resolution details
- MCP result (`contractType=short`, `success`, `app.id` if present)
- schema sync steps executed and refreshed through `application.get_info`
- validation results for normalized contract

## Completion Criteria

- Gate R passed
- MCP initialize and tools/list succeeded
- `application.create` executed successfully
- Result persisted to `mcp-application-result.json`
- All required schema sync steps executed and canonical context refreshed
- Validation passed
- Summary persisted to `mcp-application-report.md`

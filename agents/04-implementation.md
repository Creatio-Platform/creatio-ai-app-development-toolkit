# Agent 04 — Implementation Orchestrator

## Role

Read `plan.md`, call MCP `application.create` (DB-first), parse short or legacy preview response, persist normalized result artifacts, and validate output.

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

Extract resolved MCP payload and runtime resolution strategy.

### 2. Initialize MCP session

Use `mcpUrl` from `.creatio-env.json`:
- call `initialize`
- extract `Mcp-Session-Id`

If initialize fails, stop and report blocker.

### 3. Verify tool availability

Call `tools/list` and verify `application.create` exists.

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

### 5. Call `application.create`

Call MCP `tools/call` with:
- `name`
- `code`
- `templateCode`
- `iconId`
- `iconBackground`
- `description` (if present)
- `clientTypeId` (if present)
- `optionalTemplateDataJson` (if present)

Retry up to 3 times with 10s delay on transient failures.

Parse `tools/call` response text from `result.content[0].text` and detect contract:
- `short` contract:
  - top-level JSON contains `success`, `message`, optional `appId`, optional `error`
- `preview` contract:
  - JSON contains `meta.success` and `packages` array

Stop and report blocker when:
- text is plain `ERROR: ...`
- payload is not parseable JSON
- `short` contract has `success=false`
- `preview` contract has `meta.success=false`

### 6. Persist result

Write normalized MCP result to:
- `output/<AppName>/mcp-application-result.json`

Normalized result shape:
- `success` (boolean)
- `message` (string)
- `appId` (GUID when available)
- `error` (object when available)
- `contractType` (`short` or `preview`)
- `previewPackages` (array, only for preview contract)
- `previewMeta` (object, only for preview contract)

### 7. Validate output contract

Validate result payload:
1. top-level `success` exists and is boolean
2. when `contractType=short` and `success=true`, `appId` is non-empty GUID
3. when `contractType=preview` and `success=true`, `previewPackages` is non-empty
4. when `success=false`, `message` is non-empty

### 8. Write summary report

Create:
- `output/<AppName>/mcp-application-report.md`

Include:
- resolved payload fields
- icon resolution details
- MCP result (`contractType`, `success`, `message`, `appId` if present)
- preview package count when contractType is `preview`
- validation results for normalized contract

## Completion Criteria

- Gate R passed
- MCP initialize and tools/list succeeded
- `application.create` executed successfully
- Result persisted to `mcp-application-result.json`
- Validation passed
- Summary persisted to `mcp-application-report.md`

# Agent 04 — Implementation Orchestrator

## Role

Read `plan.md`, call MCP `application.create`, materialize preview files into `output/<AppName>/packages/**`, and validate output.

## Input/Output

- Input: `output/<AppName>/plan.md`, `output/<AppName>/workflow-state.json`, `output/<AppName>/.creatio-env.json`
- Output:
  - `output/<AppName>/packages/**`
  - `output/<AppName>/mcp-application-preview.json`
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

If response contains:
- `ERROR: ...` text, or
- JSON error payload with `success=false`,

stop and report blocker.

### 6. Persist raw preview

Write full raw MCP response to:
- `output/<AppName>/mcp-application-preview.json`

### 7. Materialize packages

Parse `GeneratedApplicationPreview` and write files:
- root: `output/<AppName>/packages/<packageName>/`
- each file from `files[relativePath]`

Encoding rules:
- `utf-8` → write text content as-is
- `base64` → decode and write bytes

Path safety rules:
- reject absolute paths
- reject paths containing `..`
- normalize path separators to `/`

### 8. Validate output

Validate:
1. at least one package directory exists
2. each package has root `descriptor.json`
3. all generated `.json` files parse successfully
4. no unsafe paths were written
5. no empty critical files:
   - `descriptor.json`
   - `metadata.json`
   - `properties.json`
   - `data.json`

### 9. Write summary report

Create:
- `output/<AppName>/mcp-application-report.md`

Include:
- resolved template code
- package count and names
- generated file count
- icon resolution details
- encoding stats (`utf-8` vs `base64`)
- validation results

## Completion Criteria

- Gate R passed
- MCP initialize and tools/list succeeded
- `application.create` executed successfully
- Preview persisted to `mcp-application-preview.json`
- Files materialized under `output/<AppName>/packages/**`
- Validation passed
- Summary persisted to `mcp-application-report.md`
- Packages are ready for `clio push-pkg`

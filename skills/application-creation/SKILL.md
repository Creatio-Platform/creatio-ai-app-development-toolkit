---
name: application-creation
description: Create a full Creatio application via MCP tool application.create and persist normalized result artifacts.
compatibility: Requires running Creatio MCP endpoint with application.create tool available.
metadata:
  version: "1.0"
  category: creatio-schema-generation
---

# Application Creation via MCP

Use MCP `application.create` as the primary DB-first flow for full app creation, with fallback parsing for legacy preview responses.

## Outputs

- `output/<AppName>/mcp-application-result.json`
- `output/<AppName>/mcp-application-report.md`

## Required Inputs

From `plan.md`:
- `name`
- `code`
- `templateCode`
- `iconId` (or runtime `auto` strategy)
- `iconBackground` (or runtime `auto` strategy)
- `description` (optional)
- `clientTypeId` (optional)
- `optionalTemplateDataJson` (optional)

From env:
- `.creatio-env.json` → `mcpUrl`

## MCP Protocol Flow

1. `initialize`:
```bash
curl -s -D- "<mcpUrl>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"agent","version":"1.0"}}}'
```

2. Extract `Mcp-Session-Id` header.

3. `tools/list` and verify `application.create` exists.

4. `tools/call`:
```bash
curl -s "<mcpUrl>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: <session-id>" \
  -d '{
    "jsonrpc":"2.0",
    "id":2,
    "method":"tools/call",
    "params":{
      "name":"application.create",
      "arguments":{
        "name":"<name>",
        "code":"<code>",
        "templateCode":"<templateCode>",
        "iconId":"<iconId>",
        "iconBackground":"<iconBackground>",
        "description":"<description>",
        "clientTypeId":"<clientTypeId>",
        "optionalTemplateDataJson":"<json-string>"
      }
    }
  }'
```

## Response Handling

`tools/call` response content is text.

Expected text payload can be one of:

1. `short` contract:
   - `success` (boolean)
   - `message` (string)
   - `appId` (GUID when success=true)
   - `error` object when success=false

2. `preview` contract:
   - `meta.success` (boolean)
   - `packages` (array)
   - optional `meta.message`, `meta.appId`

Normalize parsed result and persist:
- `success`
- `message`
- `appId`
- `error`
- `contractType` (`short` or `preview`)
- `previewPackages` and `previewMeta` for preview contract

## Validation Checklist

- response text parses as JSON
- `success` field exists
- if `contractType=short` and `success=true`, `appId` is non-empty GUID
- if `contractType=preview` and `success=true`, `previewPackages` is non-empty
- if `success=false`, `message` is non-empty
- result persisted to `mcp-application-result.json`
- summary persisted to `mcp-application-report.md`

## Retry and Failure Policy

- Retry MCP calls up to 3 times with 10s delay for transient failures.
- If `application.create` is missing in `tools/list`, stop with blocker.
- If result has `success=false`, stop with blocker and surface `message`.
- For `ERROR:` plain-text responses, stop with blocker and persist raw response in report.

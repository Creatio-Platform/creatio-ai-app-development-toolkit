---
name: application-creation
description: Generate full Creatio application package previews via MCP tool application.create and materialize files locally.
compatibility: Requires running Creatio MCP endpoint with application.create tool available.
metadata:
  version: "1.0"
  category: creatio-schema-generation
---

# Application Creation via MCP

Use MCP `application.create` as the primary generation flow for a full app package preview.

## Outputs

- `output/<AppName>/packages/**`
- `output/<AppName>/mcp-application-preview.json`
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

Possible cases:
1. Text starts with `ERROR:` → fail.
2. Text is JSON preview payload:
   - parse as `GeneratedApplicationPreview`
   - require `meta.success=true`
   - require non-empty `packages`

## Materialization Rules

For each package in preview:
- create `output/<AppName>/packages/<packageName>/`
- iterate `files` dictionary

For each file:
- if `encoding=utf-8`: write text as UTF-8
- if `encoding=base64`: decode and write bytes
- reject absolute paths
- reject `..` path traversal

## Validation Checklist

- at least one package materialized
- each package has root `descriptor.json`
- generated JSON files parse successfully
- no unsafe path was written
- preview persisted to `mcp-application-preview.json`
- summary persisted to `mcp-application-report.md`

## Retry and Failure Policy

- Retry MCP calls up to 3 times with 10s delay for transient failures.
- If `application.create` is missing in `tools/list`, stop with blocker.
- If icon cannot be resolved and fallback also fails in runtime, stop with blocker.

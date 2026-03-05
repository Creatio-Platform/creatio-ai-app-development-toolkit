---
name: entity-creation
description: Generate and update Creatio entity schema files via MCP tools (entity.create / entity.create_lookup / entity.update). Connects to running Creatio MCP endpoint to produce correct descriptor.json, metadata.json, properties.json with DSL diff format, parent inheritance, and all required GUIDs.
compatibility: Requires running Creatio with MCP endpoint provided by the developer during planning.
metadata:
  version: "4.0"
  category: creatio-schema-generation
---

# Entity Schema File Generator (MCP)

Generate Creatio entity schema files by calling MCP tools on a running Creatio instance. The platform generates correct DSL diff metadata automatically — no manual format construction needed.

## What This Skill Does

Calls MCP tools on a running Creatio instance to generate entity schema files:
- **entity.create** — Creates BaseEntity entities with custom columns
- **entity.create_lookup** — Creates BaseLookup entities (Name + Description only)
- **entity.update** — Regenerates an existing entity with updated columns (same UId)
- **entity.check_name** — Validates entity name uniqueness

Each tool returns JSON with file contents (descriptor, metadata, properties). The agent writes them locally.

## When to Use

Use this skill when:
- Implementing entities defined in plan.md
- Creating new BaseEntity or BaseLookup entities
- Creatio is running with MCP endpoint available

## Prerequisites

1. Creatio running with MCP endpoint provided by the developer during planning
2. Read `.creatio-env.json` for endpoint URL
3. MCP endpoint must respond to `initialize` handshake

## Hard Fail Policy

- MCP usage is mandatory for entity generation.
- Manual generation or manual editing of entity schema files is forbidden.
- If MCP initialize or tool call fails after retries, stop and report blocker.

## Input Expected

From `plan.md`, for each entity:
- Entity name (e.g., `UsrTodoTask`) — must start with `Usr`
- Parent type: `BaseEntity` or `BaseLookup`
- Package UId (GUID of the composable app package)
- Caption (display name)
- Columns array (BaseEntity only):
  - `name` — column name (starts with `Usr`)
  - `caption` — display name
  - `dataValueTypeName` — string name (see DataValueType table below)
  - `isRequired` — boolean (optional, default false)
  - `referenceSchemaName` — for Lookup columns only

---

## How It Works

### Step 1: Initialize MCP Session

```bash
# Get MCP endpoint from .creatio-env.json
MCP_URL="<mcpUrl-from-creatio-env-json>"

# Initialize and capture Mcp-Session-Id header
SESSION_ID=$(curl -s -D- "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"agent","version":"1.0"}}}' \
  | grep -i "mcp-session-id" | cut -d' ' -f2 | tr -d '\r')
```

### Step 2: Check Entity Name (Optional)

Before creating, verify the name is available:

```bash
curl -s "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc":"2.0","id":2,"method":"tools/call",
    "params":{"name":"entity.check_name","arguments":{"name":"UsrTodoTask"}}
  }'
```

Returns `{"name":"UsrTodoTask","isUnique":true}` or `{"name":"UsrTodoTask","isUnique":false}`.

### Step 3a: Create BaseEntity (with columns)

```bash
curl -s "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc":"2.0","id":3,"method":"tools/call",
    "params":{
      "name":"entity.create",
      "arguments":{
        "packageUId":"<package-guid>",
        "name":"UsrTodoTask",
        "caption":"Todo Task",
        "parentSchemaName":"BaseEntity",
        "columnsJson":"[{\"name\":\"UsrTitle\",\"caption\":\"Title\",\"dataValueTypeName\":\"ShortText\",\"isRequired\":true},{\"name\":\"UsrDescription\",\"caption\":\"Description\",\"dataValueTypeName\":\"LongText\"},{\"name\":\"UsrStatus\",\"caption\":\"Status\",\"dataValueTypeName\":\"Lookup\",\"referenceSchemaName\":\"UsrTodoTaskStatus\"}]"
      }
    }
  }'
```

**Response:** JSON with file contents:
```json
{
  "entityName": "UsrTodoTask",
  "files": {
    "descriptor": "{ \"Descriptor\": { \"UId\": \"...\", ... } }",
    "metadata": "= MetaData.Schema.UId \"...\" ...",
    "properties": "{ \"Properties\": { ... } }"
  }
}
```

### Step 3b: Create BaseLookup (no custom columns)

```bash
curl -s "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc":"2.0","id":4,"method":"tools/call",
    "params":{
      "name":"entity.create_lookup",
      "arguments":{
        "packageUId":"<package-guid>",
        "name":"UsrTodoTaskStatus",
        "caption":"Todo Task Status"
      }
    }
  }'
```

**Response:** Same JSON format as `entity.create`.

### Step 4: Write Files Locally

After receiving the response, write files to the output directory:

```bash
OUTPUT_DIR="output/<AppName>/packages/<PkgName>/Schemas/<EntityName>"
mkdir -p "$OUTPUT_DIR"
# Parse response JSON and write each file:
# files.descriptor → descriptor.json
# files.metadata   → metadata.json
# files.properties → properties.json
```

### Step 5: Verify Files

```bash
ls -la output/<AppName>/packages/<PkgName>/Schemas/<EntityName>/
# Expected: descriptor.json, metadata.json, properties.json
```

---

## DataValueType Reference

| Type Name | Description |
|-----------|-------------|
| ShortText | Up to 250 characters |
| MediumText | Up to 500 characters |
| LongText | Up to 2500 characters |
| MaxSizeText | Unlimited length |
| Integer | 32-bit integer |
| Float1 | Decimal (1 digit) |
| Float2 | Decimal (2 digits) |
| Float3 | Decimal (3 digits) |
| Float4 | Decimal (4 digits) |
| Money | Currency (2 digits) |
| DateTime | Date and time |
| Date | Date only |
| Time | Time only |
| Lookup | Reference to another entity |
| Boolean | True/false |
| Guid | UUID |
| Image | Image reference |

---

## MCP Tools Reference

### entity.create
Creates an entity with custom columns. Returns file contents in response.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| packageUId | string | ✅ | Package GUID |
| name | string | ✅ | Entity name (must start with `Usr`) |
| caption | string | ✅ | Display name |
| parentSchemaName | string | ❌ | Parent entity (default: `BaseEntity`) |
| columnsJson | string | ❌ | JSON array of column definitions |
| outputPath | string | ❌ | Server path to write files (omit for remote) |

### entity.create_lookup
Creates a BaseLookup entity (Name + Description columns inherited). Returns file contents in response.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| packageUId | string | ✅ | Package GUID |
| name | string | ✅ | Entity name (must start with `Usr`) |
| caption | string | ✅ | Display name |
| outputPath | string | ❌ | Server path to write files (omit for remote) |

### entity.update
Regenerates an existing entity with updated columns/caption, preserving the same UId. Provide the FULL desired state (all columns) — this is a complete replace. Use when you need to add columns to an entity that was already created (e.g., adding a lookup column referencing an entity created later).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| entityUId | string | ✅ | Existing entity UId (from previous `entity.create` response) |
| packageUId | string | ✅ | Package GUID |
| name | string | ✅ | Entity name (must start with `Usr`) |
| caption | string | ✅ | Display name |
| parentSchemaName | string | ❌ | Parent entity (default: `BaseEntity`) |
| columnsJson | string | ❌ | FULL JSON array of ALL desired columns |
| outputPath | string | ❌ | Server path to write files (omit for remote) |

### entity.check_name
Checks if entity name is unique in the schema manager.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | ✅ | Entity name to check |

### entity.list_parents
Lists available parent schemas with UIds. No parameters required.

### entity.get_schema_info
Gets UId and details of an existing entity schema.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | ✅ | Entity name to look up |

---

## Column Definition Format

Each column in `columnsJson` is a JSON object:

```json
{
  "name": "UsrTitle",                    // Required. Must start with Usr
  "caption": "Title",                    // Required. Display name
  "dataValueTypeName": "ShortText",      // Required. See DataValueType table
  "isRequired": true,                    // Optional. Default: false
  "referenceSchemaName": "UsrStatus"     // Required for Lookup type
}
```

---

## Execution Order

**Always create lookups before entities that reference them:**

```
1. Create lookup entities (BaseLookup) — no dependencies
   entity.create_lookup → UsrTodoTaskStatus
   entity.create_lookup → UsrTodoTaskPriority

2. Create main entities (BaseEntity) — may reference lookups
   entity.create → UsrTodoTask (with UsrStatus → UsrTodoTaskStatus)

3. Update entities if cross-references needed — use entity.update
   entity.update → UsrTodoTask (add UsrRelated → UsrOtherEntity)
```

---

## Critical Rules

1. **Entity names must start with `Usr`** — the MCP tool validates this
2. **Column names must start with `Usr`** — platform convention
3. **BaseLookup entities have NO custom columns** — use `entity.create_lookup`, not `entity.create`
4. **Lookup columns need `referenceSchemaName`** — must point to an existing entity
5. **Create lookups first** — before entities that reference them
6. **Use `dataValueTypeName` (string)** — not numeric IDs (e.g., `"ShortText"` not `1`)
7. **packageUId must match** — use the same package GUID from plan.md for all entities
8. **Write files locally** — parse response JSON and write files to `output/<AppName>/packages/<Pkg>/Schemas/<Entity>/`
9. **Manual fallback is forbidden** — do not generate entity files from templates when MCP is unavailable

---

## Error Handling

If MCP returns an error:
- **"name must start with 'Usr' prefix"** — add Usr prefix to entity name
- **"Parent schema not found"** — parentSchemaName doesn't exist in Creatio
- **Connection refused** — Creatio not running or MCP not enabled
- **Timeout** — Creatio starting up, retry after 10s

Retry each MCP call up to 3 times with 10s delay. If still failing, stop and report blocker.

---

## Validation Checklist

After generating all entities via MCP:

- ✅ All entity directories exist under `Schemas/`
- ✅ Each directory has: `descriptor.json`, `metadata.json`, `properties.json`
- ✅ All `.json` files are valid JSON (parse without errors)
- ✅ Entity names match plan.md
- ✅ Package UIds are consistent across all entities

---

## Output

Files are written by the agent to: `output/<AppName>/packages/<PackageName>/Schemas/<EntityName>/`

When done, confirm: "Generated entity schema via MCP for `<EntityName>` — ready for the next entity or next skill."

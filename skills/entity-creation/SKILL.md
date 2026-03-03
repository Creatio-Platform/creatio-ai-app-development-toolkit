---
name: entity-creation
description: Generate Creatio entity schema files via MCP tools (entity.create / entity.create_lookup). Connects to running Creatio MCP endpoint to produce correct descriptor.json, metadata.json, properties.json with DSL diff format, parent inheritance, and all required GUIDs. Falls back to manual generation if MCP is unavailable.
compatibility: Requires running Creatio with MCP endpoint (http://localhost:5001/mcp) or context/schema-reference.md for manual fallback
metadata:
  version: "3.0"
  category: creatio-schema-generation
---

# Entity Schema File Generator (MCP)

Generate Creatio entity schema files by calling MCP tools on a running Creatio instance. The platform generates correct DSL diff metadata automatically — no manual format construction needed.

## What This Skill Does

Calls MCP tools on a running Creatio instance to generate entity schema files:
- **entity.create** — Creates BaseEntity entities with custom columns
- **entity.create_lookup** — Creates BaseLookup entities (Name + Description only)
- **entity.check_name** — Validates entity name uniqueness

Each entity produces 3 files: `descriptor.json`, `metadata.json`, `properties.json`.

## When to Use

Use this skill when:
- Implementing entities defined in plan.md
- Creating new BaseEntity or BaseLookup entities
- Creatio is running with MCP endpoint available

## Prerequisites

1. Creatio running locally with MCP endpoint at `http://localhost:5001/mcp`
2. Read `.creatio-env.json` for actual endpoint URL if different
3. MCP endpoint must respond to `initialize` handshake

## Input Expected

From `plan.md`, for each entity:
- Entity name (e.g., `UsrTodoTask`) — must start with `Usr`
- Parent type: `BaseEntity` or `BaseLookup`
- Package UId (GUID of the composable app package)
- Caption (display name)
- Columns array (BaseEntity only):
  - `name` — column name (starts with `Usr`)
  - `caption` — display name
  - `dataValueType` — integer (see DataValueType table below)
  - `isRequired` — boolean (optional, default false)
  - `referenceSchemaName` — for Lookup columns only

---

## How It Works

### Step 1: Initialize MCP Session

```bash
# Get MCP endpoint from .creatio-env.json, default: http://localhost:5001/mcp
MCP_URL="http://localhost:5001/mcp"

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
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc":"2.0","id":2,"method":"tools/call",
    "params":{"name":"entity.check_name","arguments":{"name":"UsrTodoTask"}}
  }'
```

Returns `"Name 'UsrTodoTask' is available"` or error if taken.

### Step 3a: Create BaseEntity (with columns)

```bash
curl -s "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc":"2.0","id":3,"method":"tools/call",
    "params":{
      "name":"entity.create",
      "arguments":{
        "outputPath":"/absolute/path/to/output/MyApp/packages/UsrMyApp/Schemas/UsrTodoTask",
        "packageUId":"<package-guid>",
        "name":"UsrTodoTask",
        "caption":"Todo Task",
        "parentSchemaName":"BaseEntity",
        "columnsJson":"[{\"name\":\"UsrTitle\",\"caption\":\"Title\",\"dataValueType\":1,\"isRequired\":true},{\"name\":\"UsrDescription\",\"caption\":\"Description\",\"dataValueType\":1},{\"name\":\"UsrStatus\",\"caption\":\"Status\",\"dataValueType\":10,\"referenceSchemaName\":\"UsrTodoTaskStatus\"}]"
      }
    }
  }'
```

### Step 3b: Create BaseLookup (no custom columns)

```bash
curl -s "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc":"2.0","id":4,"method":"tools/call",
    "params":{
      "name":"entity.create_lookup",
      "arguments":{
        "outputPath":"/absolute/path/to/output/MyApp/packages/UsrMyApp/Schemas/UsrTodoTaskStatus",
        "packageUId":"<package-guid>",
        "name":"UsrTodoTaskStatus",
        "caption":"Todo Task Status"
      }
    }
  }'
```

### Step 4: Verify Files

After each MCP call, verify the files were created:

```bash
ls -la output/MyApp/packages/UsrMyApp/Schemas/UsrTodoTask/
# Expected: descriptor.json, metadata.json, properties.json
```

---

## DataValueType Reference

| Type | ID | Description |
|------|----|-------------|
| ShortText | 1 | Up to 250 characters |
| MediumText | 2 | Up to 500 characters |
| LongText | 3 | Up to 500 characters |
| MaxSizeText | 13 | Unlimited length |
| Integer | 4 | 32-bit integer |
| Float | 5 | Decimal number |
| Money | 6 | Currency amount |
| DateTime | 7 | Date and time |
| Date | 8 | Date only |
| Time | 9 | Time only |
| Lookup | 10 | Reference to another entity |
| Boolean | 12 | True/false |
| Guid | 0 | UUID |

---

## MCP Tools Reference

### entity.create
Creates a BaseEntity entity with custom columns.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| outputPath | string | ✅ | Absolute path for schema files |
| packageUId | string | ✅ | Package GUID |
| name | string | ✅ | Entity name (must start with `Usr`) |
| caption | string | ✅ | Display name |
| parentSchemaName | string | ❌ | Parent entity (default: `BaseEntity`) |
| columnsJson | string | ❌ | JSON array of column definitions |

### entity.create_lookup
Creates a BaseLookup entity (Name + Description columns inherited).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| outputPath | string | ✅ | Absolute path for schema files |
| packageUId | string | ✅ | Package GUID |
| name | string | ✅ | Entity name (must start with `Usr`) |
| caption | string | ✅ | Display name |

### entity.check_name
Checks if entity name is unique in the schema manager.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | ✅ | Entity name to check |

### entity.list_parents
Lists available parent schemas with UIds.

No parameters required.

### entity.list_references
Lists available reference schemas for lookup columns.

No parameters required.

---

## Column Definition Format

Each column in `columnsJson` is a JSON object:

```json
{
  "name": "UsrTitle",           // Required. Must start with Usr
  "caption": "Title",           // Required. Display name
  "dataValueType": 1,           // Required. See DataValueType table
  "isRequired": true,           // Optional. Default: false
  "referenceSchemaName": "UsrStatus"  // Required for Lookup (type 10)
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
```

---

## Critical Rules

1. **Entity names must start with `Usr`** — the MCP tool validates this
2. **Column names must start with `Usr`** — platform convention
3. **BaseLookup entities have NO custom columns** — use `entity.create_lookup`, not `entity.create`
4. **Lookup columns need `referenceSchemaName`** — must point to an existing entity
5. **Create lookups first** — before entities that reference them
6. **outputPath must be absolute** — the MCP server writes files to this exact path
7. **packageUId must match** — use the same package GUID from plan.md for all entities

---

## Error Handling

If MCP returns an error:
- **"Name is already in use"** — entity exists, check plan.md for conflicts
- **"Parent schema not found"** — parentSchemaName doesn't exist in Creatio
- **Connection refused** — Creatio not running or MCP not enabled
- **Timeout** — Creatio starting up, retry after 10s

If MCP endpoint is unavailable, fall back to manual entity generation using templates from `templates/entity/` and format reference from `context/schema-reference.md`.

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

Files are written by the MCP server to: `output/<AppName>/packages/<PackageName>/Schemas/<EntityName>/`

When done, confirm: "Generated entity schema via MCP for `<EntityName>` — ready for the next entity or next skill."

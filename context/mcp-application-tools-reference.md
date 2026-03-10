# MCP Application Tools Reference Guide

## Overview

MCP (Model Context Protocol) application tools provide DB-first integration for Creatio composable app creation and schema management. All tools are accessed through the `/mcp` endpoint via JSON-RPC 2.0 protocol over HTTP.

**Endpoint:** `http://localhost:5001/mcp`

## Authentication

MCP endpoint uses HTTP Basic Authentication:

```bash
-u Supervisor:Supervisor
```

For production environments, use appropriate credentials stored in `.creatio-env.json`.

## Required Headers

```bash
-H "Content-Type: application/json"
-H "Accept: application/json, text/event-stream"
-H "Mcp-Session-Id: $SESSION_ID"  # Required after initialize
```

**Important:** The `Accept` header MUST include both `application/json` and `text/event-stream`. Missing either will result in "Not Acceptable" error.

## Response Format

All responses use Server-Sent Events (SSE) format:

```
event: message
data: {"result":{"content":[{"type":"text","text":"..."}]},"id":1,"jsonrpc":"2.0"}
```

## Parsing Response Pattern

Standard pattern to parse MCP responses:

```bash
curl ... | grep -A 1000 'event: message' | \
  sed 's/^event: message$//' | \
  sed 's/^data: //' | \
  jq -r '.result.content[0].text'
```

For list responses (like tools/list):

```bash
curl ... | grep -A 1000 'event: message' | \
  sed 's/^event: message$//' | \
  sed 's/^data: //' | \
  jq '.result.tools[]'
```

## Workflow Sequence

### 1. Initialize Session

**Purpose:** Obtain Mcp-Session-Id for subsequent requests.

```bash
curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "your-client-name",
        "version": "1.0.0"
      }
    }
  }' -D - 2>&1 | tee /tmp/mcp-init.txt
```

**Extract Session ID:**

```bash
SESSION_ID=$(grep -i 'Mcp-Session-Id:' /tmp/mcp-init.txt | sed 's/.*: //' | tr -d '\r')
```

### 2. List Available Tools

**Purpose:** Verify required tools are available.

```bash
SESSION_ID="..." && curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {}
  }' | grep -A 1000 'event: message' | \
  sed 's/^event: message$//' | \
  sed 's/^data: //' | \
  jq -r '.result.tools[] | select(.name | startswith("application.") or startswith("entity.")) | .name' | sort
```

**Expected Output:**

```
application.create
application.get_info
application.get_list
entity.create
entity.create_lookup
entity.update
binding.create
binding.get_columns
```

### 3. Create Application (application.create)

**Purpose:** Create new Creatio application with initial package and entity.

```bash
SESSION_ID="..." && curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "application.create",
      "arguments": {
        "name": "Events",
        "code": "UsrEvents",
        "templateCode": "AppFreedomUI",
        "iconBackground": "#1F5F8B",
        "description": "A lightweight tool for managing events",
        "optionalTemplateDataJson": "{\"useExistingEntitySchema\":false,\"entitySchemaName\":\"\",\"appSectionDescription\":\"Manage events\",\"useAIContentGeneration\":false}"
      }
    }
  }' 2>&1 | tee /tmp/mcp-app-create-raw.txt
```

**Parse and Save Response:**

```bash
grep 'data: ' /tmp/mcp-app-create-raw.txt | \
  sed 's/^data: //' | \
  jq -r '.result.content[0].text' | \
  jq '.' > /tmp/mcp-app-create-parsed.json
```

**Response Contract (Short):**

```json
{
  "success": true,
  "app": {
    "id": "7030c825-59bd-49c6-8a6b-5ff260687a87",
    "code": "UsrEvents"
  },
  "packages": {
    "UsrEvents": {
      "uId": "cdb130a9-8c77-4e80-ad1b-529cc23a750a",
      "isPrimary": true,
      "entities": {
        "UsrEvents": {
          "uId": "688a3176-2830-45d7-bfbb-18e922600e7b",
          "caption": "Events",
          "columns": {
            "Name": {
              "uId": "9fce872c-24c2-47a8-9805-081de85e33d1",
              "caption": "Name",
              "dataValueTypeName": "MediumText"
            }
          }
        }
      }
    }
  }
}
```

**Initialize Canonical Context File:**

```bash
cat > output/Events/mcp-application-result.json << 'EOF'
{
  "contractType": "short",
  "success": true,
  "app": { ... },
  "packages": { ... },
  "schemaSync": [],
  "editableContext": {}
}
EOF
```

### 4. Get Application Info (application.get_info)

**Purpose:** Refresh application context after schema changes. This is the canonical DB refresh operation.

```bash
SESSION_ID="..." && curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 7,
    "method": "tools/call",
    "params": {
      "name": "application.get_info",
      "arguments": {
        "appCode": "UsrEvents"
      }
    }
  }' 2>&1 | tee /tmp/mcp-get-info-raw.txt
```

**Update Context After Schema Change:**

```bash
grep 'data: ' /tmp/mcp-get-info-raw.txt | \
  sed 's/^data: //' | \
  jq -r '.result.content[0].text' | \
  jq '. + {
    contractType: "short",
    schemaSync: [
      {
        tool: "entity.create_lookup",
        target: "UsrEventStatus",
        status: "success",
        entityUId: "d3d882ab-bec8-4f98-8733-7702900ca093"
      }
    ],
    editableContext: {}
  }' > output/Events/mcp-application-result.json
```

**Critical Pattern:** Always call `application.get_info` after each successful entity mutation (`entity.create_lookup`, `entity.create`, `entity.update`) and overwrite `mcp-application-result.json`.

### 3.1. Extract Package UId for Entity Operations

**CRITICAL:** Entity tools (`entity.create_lookup`, `entity.create`, `entity.update`) require `packageUId` parameter as a GUID string, NOT package name.

**New Flat Format (Recommended):** Since core version 8.3.4.802, MCP tools return simplified flat format with top-level `packageUId` and `packageName` fields.

#### Ultra-Simple Extraction (No jq Required)

Use the helper script `~/scripts/mcp-response-to-env.sh` to convert MCP response to shell variables:

```bash
# Parse and save response
curl ... | grep 'data: ' | sed 's/^data: //' | \
  jq -r '.result.content[0].text' > /tmp/mcp-response.json

# Generate .env file with all UIds
bash ~/scripts/mcp-response-to-env.sh /tmp/mcp-response.json > /tmp/.mcp-env

# Load variables into shell
source /tmp/.mcp-env

# Use variables directly (no jq needed!)
echo "Package UId: $PACKAGE_UID"
echo "Package Name: $PACKAGE_NAME"
echo "Main Entity UId: $MAIN_ENTITY_UID"
echo "Main Entity Name: $MAIN_ENTITY_NAME"
echo "All Entities: $ALL_ENTITY_NAMES"
```

**Generated .env file example:**
```bash
# Auto-generated from MCP response
PACKAGE_UID='597944b2-c71f-4cdb-9510-0216c1e214a6'
PACKAGE_NAME='UsrTodoList'

MAIN_ENTITY_UID='32ccd416-a6c7-4eeb-bae0-46403f18c457'
MAIN_ENTITY_NAME='UsrTodoList'

ALL_ENTITY_UIDS='32ccd416-a6c7-4eeb-bae0-46403f18c457,ed3ea989-abd2-4fef-9e03-d66b62210dd2'
ALL_ENTITY_NAMES='UsrTodoList,UsrTodoPriority,UsrTodoStatus'
```

#### Simple Extraction (jq Only)

For direct jq extraction without helper script:

```bash
# Parse application.create response
grep 'data: ' /tmp/mcp-app-create-raw.txt | \
  sed 's/^data: //' | \
  jq -r '.result.content[0].text' | \
  jq '.' > /tmp/mcp-app-create-parsed.json

# Extract from flat format (simple!)
PACKAGE_UID=$(jq -r '.packageUId' /tmp/mcp-app-create-parsed.json)
PACKAGE_NAME=$(jq -r '.packageName' /tmp/mcp-app-create-parsed.json)
MAIN_ENTITY_UID=$(jq -r '.entities[0].uId' /tmp/mcp-app-create-parsed.json)
MAIN_ENTITY_NAME=$(jq -r '.entities[0].name' /tmp/mcp-app-create-parsed.json)

echo "Package UId: $PACKAGE_UID"
# Output: 597944b2-c71f-4cdb-9510-0216c1e214a6
```

**Response Format Structure:**
```json
{
  "success": true,
  "packageUId": "597944b2-c71f-4cdb-9510-0216c1e214a6",
  "packageName": "UsrTodoList",
  "entities": [
    {
      "uId": "32ccd416-a6c7-4eeb-bae0-46403f18c457",
      "name": "UsrTodoList",
      "caption": "Todo",
      "columns": [
        {"name": "UsrTitle", "caption": "Title", "dataValueType": "ShortText"}
      ]
    }
  ]
}
```

**Use these UIds in all subsequent entity tool calls:**
- `packageUId` → use `$PACKAGE_UID` variable
- `entityUId` → use `$MAIN_ENTITY_UID` variable (for entity.update)

**Never use:**
- ❌ `packageName` as parameter (tools require UId, not name)
- ❌ `entitySchemaUId` (wrong parameter name, should be `entityUId`)
- ❌ `entityName` as parameter for entity.update (wrong, use `name` instead)

### 5. Create Lookup Entity (entity.create_lookup)

**Purpose:** Create lookup (BaseLookup-based) entity in specified package.

**Tool Signature:**
```
entity.create_lookup(
  packageUId: string,    // GUID, NOT packageName!
  name: string,          // Entity schema name (e.g., "UsrEventStatus")
  caption: string,       // Display name
  columnsJson: string    // Optional, default "[]"
)
```

**Example:**

```bash
# Use extracted PACKAGE_UID from application.create
SESSION_ID="..." && curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": 5,
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"entity.create_lookup\",
      \"arguments\": {
        \"packageUId\": \"$PACKAGE_UID\",
        \"name\": \"UsrEventStatus\",
        \"caption\": \"Event Status\",
        \"columnsJson\": \"[]\"
      }
    }
  }" 2>&1 | tee /tmp/mcp-lookup-create-raw.txt
```

**After Success:** Immediately call `application.get_info` to refresh context and verify the entity is fully materialized (not in "Database update required" state).

### 6. Update Entity (entity.update)

**Purpose:** Add columns to existing entity.

**Tool Signature:**
```
entity.update(
  entityUId: string,       // Entity GUID, NOT entitySchemaUId!
  packageUId: string,      // Package GUID, NOT packageName!
  name: string,            // Optional, entity schema name
  caption: string,         // Optional, display name
  parentSchemaName: string,// Optional, parent schema
  operationsJson: string   // JSON array of operations
)
```

**Critical:** `operationsJson` must use `{operation, column}` structure:

```json
[{
  "operation": "addColumn",   // NOT "type"!
  "column": {                 // Nested object!
    "name": "UsrField",
    "caption": "Field",
    "dataValueTypeName": "ShortText",
    "isRequired": true,
    "size": 250
  }
}]
```

**Example:**

```bash
# Use extracted ENTITY_UID and PACKAGE_UID
SESSION_ID="..." && curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": 9,
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"entity.update\",
      \"arguments\": {
        \"entityUId\": \"$ENTITY_UID\",
        \"packageUId\": \"$PACKAGE_UID\",
        \"caption\": \"Events\",
        \"operationsJson\": \"[{\\\"operation\\\":\\\"addColumn\\\",\\\"column\\\":{\\\"name\\\":\\\"UsrDescription\\\",\\\"caption\\\":\\\"Description\\\",\\\"dataValueTypeName\\\":\\\"MaxSizeText\\\",\\\"isRequired\\\":false}},{\\\"operation\\\":\\\"addColumn\\\",\\\"column\\\":{\\\"name\\\":\\\"UsrStartDate\\\",\\\"caption\\\":\\\"Start Date\\\",\\\"dataValueTypeName\\\":\\\"DateTime\\\",\\\"isRequired\\\":true}},{\\\"operation\\\":\\\"addColumn\\\",\\\"column\\\":{\\\"name\\\":\\\"UsrStatus\\\",\\\"caption\\\":\\\"Status\\\",\\\"dataValueTypeName\\\":\\\"Lookup\\\",\\\"referenceSchemaName\\\":\\\"UsrEventStatus\\\",\\\"isRequired\\\":false}}]\"
      }
    }
  }" 2>&1 | tee /tmp/mcp-entity-update-raw.txt
```

**After Success:** Call `application.get_info` and update context.

## Error Handling

### Common Errors

**1. Not Acceptable (Missing Accept header)**

```json
{
  "error": {
    "code": -32000,
    "message": "Not Acceptable: Client must accept both application/json and text/event-stream"
  }
}
```

**Fix:** Include both content types in Accept header:
```bash
-H "Accept: application/json, text/event-stream"
```

**2. Tool Invocation Error**

```json
{
  "result": {
    "content": [{"type": "text", "text": "An error occurred invoking 'entity.create_lookup'."}],
    "isError": true
  }
}
```

**Fix:** Check tool signature with `tools/list` and verify argument names/types.

**Important:** Generic error messages hide actual exceptions. Always check tmux core session logs for detailed error:

```bash
# Attach to core tmux session and check recent logs
tmux attach -t core
# Or capture logs
tmux capture-pane -t core -p -S -1000 | grep -A5 "ArgumentException\|Error\|Exception"
```

Look for patterns like:
- `ArgumentException: missing value for required parameter 'packageUId'` → using wrong parameter name
- `Unsupported operation ''` → wrong JSON structure in operationsJson

**3. Session Expired**

After inactivity, session may expire. Re-initialize with `initialize` method.

## Common Pitfalls

### ❌ Wrong Parameter Names

**Problem:** `ArgumentException: missing value for required parameter 'packageUId'`

**Causes:**
- Using `packageName` instead of `packageUId` (GUID required!)
- Using `entitySchemaUId` instead of `entityUId`
- Using `entityName` instead of `name`
- Using `displayName` instead of `caption`

**Solution:** Always verify parameter names against C# tool signatures in `~/Projects/core/TSBpm/Src/Lib/Terrasoft.Mcp/Tools/`:
- `EntityCreateLookupTool.cs` (line 13-23)
- `EntityCreateTool.cs`
- `EntityUpdateTool.cs` (line 13-26)

**Correct Parameters:**
```json
{
  "packageUId": "597944b2-c71f-4cdb-9510-0216c1e214a6",  // ✅ GUID!
  "name": "UsrEventStatus",                             // ✅ not entityName
  "caption": "Event Status",                            // ✅ not displayName
  "columnsJson": "[]"                                   // ✅
}
```

### ❌ Wrong JSON Structure for Operations

**Problem:** `Unsupported operation ''. Allowed values: addColumn, updateColumn, removeColumn`

**Cause:** Using flat structure instead of nested `{operation, column}`:

```json
// ❌ WRONG
{
  "type": "addColumn",
  "name": "UsrField",
  "caption": "Field",
  "dataValueTypeName": "ShortText"
}

// ✅ CORRECT
{
  "operation": "addColumn",
  "column": {
    "name": "UsrField",
    "caption": "Field",
    "dataValueTypeName": "ShortText"
  }
}
```

**Solution:** Use correct structure from `EntityColumnOperation.cs` model:

```bash
entity.update(
  entityUId: "...",
  packageUId: "...",
  operationsJson: '[{"operation":"addColumn","column":{...}}]'
)
```

### ❌ Missing UId Extraction

**Problem:** Using package/entity names instead of UIds

**Solution:** Extract UIds from `application.create` / `application.get_info` responses using new flat format:

```bash
# Method 1: Ultra-simple with helper script (recommended)
bash ~/scripts/mcp-response-to-env.sh /tmp/mcp-response.json > /tmp/.mcp-env
source /tmp/.mcp-env

# Method 2: Direct jq extraction
PACKAGE_UID=$(jq -r '.packageUId' /tmp/mcp-response.json)
MAIN_ENTITY_UID=$(jq -r '.entities[0].uId' /tmp/mcp-response.json)

# Validate extraction
if [[ -z "$PACKAGE_UID" || "$PACKAGE_UID" == "null" ]]; then
  echo "ERROR: Failed to extract package UId"
  exit 1
fi

echo "Package UId: $PACKAGE_UID"
echo "Entity UId: $MAIN_ENTITY_UID"
```

### ❌ Not Refreshing Context After Mutations

**Problem:** Schema exists in DB but not visible in `application.get_info`

**Cause:** Not calling `application.get_info` after each successful entity mutation

**Solution:** Always refresh context:

```bash
# After entity.create_lookup or entity.update
curl ... application.get_info | ... > output/App/mcp-application-result.json

# Verify entity is present
jq '.packages.UsrApp.entities.UsrNewEntity' output/App/mcp-application-result.json
```

### Validation Checklist

Before proceeding to next step:

1. ✅ Response contains `"success": true` or valid result
2. ✅ For entity tools: schema is visible in `application.get_info` response
3. ✅ Context file `mcp-application-result.json` is updated with latest state
4. ✅ `schemaSync` array contains entry for completed operation

### Retry Strategy

For transient failures:

```bash
for i in {1..3}; do
  # Execute MCP call
  if [[ $? -eq 0 ]]; then
    break
  fi
  sleep 10
done
```

## Complete Workflow Example

```bash
#!/bin/bash

# 1. Initialize session
curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"app-creator","version":"1.0"}}}' \
  -D /tmp/mcp-init-headers.txt > /tmp/mcp-init.txt

SESSION_ID=$(grep -i 'Mcp-Session-Id:' /tmp/mcp-init-headers.txt | sed 's/.*: //' | tr -d '\r')

# 2. Verify tools
curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | \
  grep 'application.create' || { echo "Required tools missing"; exit 1; }

# 3. Create application
curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc":"2.0","id":3,"method":"tools/call",
    "params":{
      "name":"application.create",
      "arguments":{
        "name":"MyApp",
        "code":"UsrMyApp",
        "templateCode":"AppFreedomUI",
        "iconBackground":"#1F5F8B"
      }
    }
  }' | grep 'data: ' | sed 's/^data: //' | \
  jq -r '.result.content[0].text' | \
  jq '. + {contractType:"short",schemaSync:[],editableContext:{}}' > output/MyApp/mcp-application-result.json

# 4. Create lookup
curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d "{
    \"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",
    \"params\":{
      \"name\":\"entity.create_lookup\",
      \"arguments\":{
        \"packageUId\":\"$PACKAGE_UID\",
        \"name\":\"UsrMyStatus\",
        \"caption\":\"My Status\",
        \"columnsJson\":\"[]\"
      }
    }
  }"

# 5. Refresh context
curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc":"2.0","id":5,"method":"tools/call",
    "params":{
      "name":"application.get_info",
      "arguments":{"appCode":"UsrMyApp"}
    }
  }' | grep 'data: ' | sed 's/^data: //' | \
  jq -r '.result.content[0].text' | \
  jq '. + {contractType:"short",schemaSync:[{tool:"entity.create_lookup",target:"UsrMyStatus",status:"success"}],editableContext:{}}' > output/MyApp/mcp-application-result.json
```

## Best Practices

### 1. Always Parse and Validate

```bash
# Parse response
RESPONSE=$(curl ... | grep 'data: ' | sed 's/^data: //' | jq -r '.result.content[0].text')

# Validate
if echo "$RESPONSE" | jq -e '.success == true' > /dev/null; then
  echo "Success"
else
  echo "Error: $(echo "$RESPONSE" | jq -r '.error.message')"
  exit 1
fi
```

### 2. Maintain Context Integrity

After every entity mutation:
1. Call `application.get_info`
2. Overwrite `mcp-application-result.json`
3. Add entry to `schemaSync` array

### 3. Use Temporary Files

```bash
# Save raw response for debugging
curl ... 2>&1 | tee /tmp/mcp-raw-response.txt

# Parse from saved file
grep 'data: ' /tmp/mcp-raw-response.txt | ...
```

### 4. Verify Schema Materialization

After entity tools, verify the schema is NOT in "Database update required" state:

```bash
# Check if entity exists in get_info response
curl ... application.get_info | grep '"UsrMyEntity"'
```

If missing, this is a core MCP blocker - stop and report.

## Integration with Python Helpers

For complex workflows, use Python helper scripts:

```bash
# Normalize MCP result
python3 scripts/mcp_context_adapter.py normalize output/MyApp/mcp-application-result.json

# Apply schema sync from edited context
python3 scripts/mcp_schema_sync.py apply \
  --result output/MyApp/mcp-application-result.json \
  --edited-context output/MyApp/editable-context.json \
  --env output/MyApp/.creatio-env.json
```

## Reference

**Short Contract Structure:**

```json
{
  "contractType": "short",
  "success": true,
  "app": {
    "id": "...",
    "code": "..."
  },
  "packages": {
    "PackageName": {
      "uId": "...",
      "isPrimary": true,
      "entities": {
        "EntityName": {
          "uId": "...",
          "caption": "...",
          "columns": {}
        }
      }
    }
  },
  "schemaSync": [
    {
      "tool": "entity.create_lookup",
      "target": "UsrEventStatus",
      "status": "success",
      "entityUId": "..."
    }
  ],
  "editableContext": {}
}
```

**Data Value Type Names:**

- `MediumText` - string up to 250 chars
- `MaxSizeText` - unlimited text
- `ShortText` - string up to 50 chars
- `DateTime` - date and time
- `Date` - date only
- `Integer` - whole number
- `Float` - decimal number
- `Boolean` - true/false
- `Lookup` - reference to another entity (requires `referenceSchemaName`)

**Template Codes:**

- `AppFreedomUI` - Modern Freedom UI template
- Use this for all new applications

**Icon Backgrounds (Palette):**

- `#1F5F8B` - Deep Blue
- `#2D8CFF` - Bright Blue
- `#16A085` - Teal
- `#27AE60` - Green
- `#F39C12` - Orange
- `#E67E22` - Dark Orange
- `#C0392B` - Red
- `#8E44AD` - Purple

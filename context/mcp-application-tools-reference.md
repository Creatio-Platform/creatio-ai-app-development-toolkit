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

### 5. Create Lookup Entity (entity.create_lookup)

**Purpose:** Create lookup (BaseLookup-based) entity in specified package.

```bash
SESSION_ID="..." && curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 5,
    "method": "tools/call",
    "params": {
      "name": "entity.create_lookup",
      "arguments": {
        "packageName": "UsrEvents",
        "entityName": "UsrEventStatus",
        "displayName": "Event Status",
        "description": "Lookup for event status values"
      }
    }
  }' 2>&1 | tee /tmp/mcp-lookup-create-raw.txt
```

**Note:** Use `packageName` (not `packageUId`) as argument.

**After Success:** Immediately call `application.get_info` to refresh context and verify the entity is fully materialized (not in "Database update required" state).

### 6. Update Entity (entity.update)

**Purpose:** Add columns to existing entity.

First, get the tool signature to understand column format:

```bash
SESSION_ID="..." && curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 8,
    "method": "tools/list",
    "params": {}
  }' | grep -A 1000 'event: message' | \
  sed 's/^event: message$//' | \
  sed 's/^data: //' | \
  jq '.result.tools[] | select(.name == "entity.update")'
```

**Update with Columns:**

```bash
SESSION_ID="..." && curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 9,
    "method": "tools/call",
    "params": {
      "name": "entity.update",
      "arguments": {
        "packageName": "UsrEvents",
        "entityName": "UsrEvents",
        "columnsToAdd": [
          {
            "name": "UsrDescription",
            "displayName": "Description",
            "dataValueTypeName": "MaxSizeText",
            "isRequired": false
          },
          {
            "name": "UsrStartDate",
            "displayName": "Start Date",
            "dataValueTypeName": "DateTime",
            "isRequired": true
          },
          {
            "name": "UsrStatus",
            "displayName": "Status",
            "dataValueTypeName": "Lookup",
            "referenceSchemaName": "UsrEventStatus",
            "isRequired": false
          }
        ]
      }
    }
  }' 2>&1 | tee /tmp/mcp-entity-update-raw.txt
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

**3. Session Expired**

After inactivity, session may expire. Re-initialize with `initialize` method.

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
  -d '{
    "jsonrpc":"2.0","id":4,"method":"tools/call",
    "params":{
      "name":"entity.create_lookup",
      "arguments":{
        "packageName":"UsrMyApp",
        "entityName":"UsrMyStatus",
        "displayName":"My Status"
      }
    }
  }'

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

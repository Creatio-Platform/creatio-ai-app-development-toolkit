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

## Parameter Naming Convention

**CRITICAL:** All MCP entity and schema tools use `schemaName` parameter for entity schema references.

```
✅ Correct:  "schemaName": "UsrTodoList"
❌ Wrong:    "name": "UsrTodoList"
❌ Wrong:    "entityName": "UsrTodoList"
```

**Tools following this convention:**
- `entity.update` — `schemaName` parameter (optional)
- `binding.get_columns` — `schemaName` parameter (required)
- `binding.create` — `schemaName` parameter (required)

**Why this matters:** MCP SDK uses reflection to map JSON argument names to C# method parameters. Parameter names must match **exactly** (case-sensitive). Mismatch causes:
```
ArgumentException: The arguments dictionary is missing a value for the required parameter '<param>'
```

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

### 4.1. List Applications (application.get_list)

**Purpose:** Discover existing Creatio applications for update workflows.

**Tool Signature:**
```
application.get_list()  // No parameters
```

**Use Cases:**
- Discover application IDs before calling `application.get_info`
- List available applications for user selection
- Validate application existence before workflows

**Example:**

```bash
SESSION_ID="..." && curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 4,
    "method": "tools/call",
    "params": {
      "name": "application.get_list",
      "arguments": {}
    }
  }' 2>&1 | grep 'data: ' | sed 's/^data: //' | \
  jq -r '.result.content[0].text'
```

**Response Format:**
```json
{
  "applications": [
    {
      "id": "7030c825-59bd-49c6-8a6b-5ff260687a87",
      "code": "UsrEvents",
      "name": "Events",
      "description": "Event management tool"
    },
    {
      "id": "32ccd416-a6c7-4eeb-bae0-46403f18c457",
      "code": "UsrTodoList",
      "name": "Todo List",
      "description": null
    }
  ]
}
```

**Integration with get_info:**

```bash
# 1. List applications
APP_CODE=$(curl -s http://localhost:5001/mcp ... | \
  jq -r '.applications[] | select(.name=="Events") | .code')

# 2. Get full context
curl -s http://localhost:5001/mcp \
  -d "{\"method\":\"tools/call\",\"params\":{\"name\":\"application.get_info\",\"arguments\":{\"appCode\":\"$APP_CODE\"}}}"
```

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
- ❌ `entityName` as parameter for entity.update (wrong, use `schemaName` instead)

### 5. Create Entity (entity.create)

**Purpose:** Create new BaseEntity-derived (or custom parent) entity schema in Creatio database.

**Tool Signature:**
```
entity.create(
  packageUId: string,              // REQUIRED: Package GUID
  name: string,                    // REQUIRED: Schema name (e.g., "UsrTodoList")
  caption: string,                 // REQUIRED: Display name
  parentSchemaName: string,        // Optional, default "BaseEntity"
  columnsJson: string,             // Optional, default "[]"
  outputPath: string               // Optional, deprecated
)
```

**When to Use:**
- Creating entities that inherit from BaseEntity
- Creating entities with custom parent schemas (e.g., inheriting from BaseFile)
- For **lookup entities**, use `entity.create_lookup` instead (always inherits from BaseLookup)

**columnsJson Format:**

```json
[
  {
    "name": "UsrTitle",
    "caption": "Title",
    "dataValueTypeName": "ShortText",
    "isRequired": true,
    "size": 250
  },
  {
    "name": "UsrDueDate",
    "caption": "Due Date",
    "dataValueTypeName": "Date",
    "isRequired": false
  },
  {
    "name": "UsrStatus",
    "caption": "Status",
    "dataValueTypeName": "Lookup",
    "referenceSchemaName": "UsrTodoStatus",
    "isRequired": true
  }
]
```

**Supported dataValueTypeName Values:**
- `ShortText` (size: 50-250)
- `MediumText` (size: 500-1000)
- `LongText` (size: 2000-5000)
- `MaxSizeText` (size: max, for large content)
- `Integer`
- `Float` (precision: 2-8)
- `Boolean`
- `Date`
- `DateTime`
- `Time`
- `Lookup` (requires `referenceSchemaName`)

**Example:**

```bash
# Use extracted PACKAGE_UID from application.create
SESSION_ID="..." && PACKAGE_UID="597944b2-c71f-4cdb-9510-0216c1e214a6" && \
curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": 5,
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"entity.create\",
      \"arguments\": {
        \"packageUId\": \"$PACKAGE_UID\",
        \"name\": \"UsrTodoList\",
        \"caption\": \"Todo\",
        \"parentSchemaName\": \"BaseEntity\",
        \"columnsJson\": \"[{\\\"name\\\":\\\"UsrTitle\\\",\\\"caption\\\":\\\"Title\\\",\\\"dataValueTypeName\\\":\\\"ShortText\\\",\\\"isRequired\\\":true,\\\"size\\\":250}]\"
      }
    }
  }" 2>&1 | tee /tmp/mcp-entity-create-raw.txt
```

**Parse Response:**

```bash
grep 'data: ' /tmp/mcp-entity-create-raw.txt | \
  sed 's/^data: //' | \
  jq -r '.result.content[0].text' > /tmp/mcp-entity-create.json

# Extract entity UId for subsequent operations
ENTITY_UID=$(jq -r '.entityUId' /tmp/mcp-entity-create.json)
echo "Entity UId: $ENTITY_UID"
```

**Response Format:**
```json
{
  "entityUId": "32ccd416-a6c7-4eeb-bae0-46403f18c457",
  "schemaName": "UsrTodoList",
  "caption": "Todo",
  "parentSchemaName": "BaseEntity",
  "columns": [
    {
      "name": "UsrTitle",
      "uId": "1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d",
      "caption": "Title",
      "dataValueType": "ShortText",
      "size": 250,
      "isRequired": true
    }
  ]
}
```

**After Success:** 
1. Save `entityUId` for subsequent `entity.update` calls
2. Call `application.get_info` to refresh application context
3. Overwrite `mcp-application-result.json` with updated context

**Difference from entity.create_lookup:**
- `entity.create` allows custom `parentSchemaName` (BaseEntity, BaseFile, etc.)
- `entity.create_lookup` hardcodes `parentSchemaName="BaseLookup"` internally

### 6. Create Lookup Entity (entity.create_lookup)

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

**Lookup Display Rule:**
- `BaseLookup` already provides inherited `Name` and `Description`.
- Never send `Name`, `Description`, or `UsrName` in `columnsJson`.
- `Name` must remain the lookup `PrimaryDisplayColumn`; otherwise lookup values will appear blank after selection in UI controls.

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

**After Success:** Immediately call `application.get_info` to refresh context and verify the entity is fully materialized (not in "Database update required" state). Do not report lookup success if the plan or follow-up validation would replace inherited `Name` with a duplicate display column.

### 7. Update Entity (entity.update)

**Purpose:** Add columns to existing entity.

**Tool Signature:**
```
entity.update(
  entityUId: string,       // REQUIRED: Entity GUID from entity.create response
  packageUId: string,      // REQUIRED: Package GUID, NOT packageName!
  schemaName: string,      // Optional, entity schema name (use for clarity)
  caption: string,         // Optional, display name
  parentSchemaName: string,// Optional, parent schema (default: BaseEntity)
  operationsJson: string   // JSON array of operations (default: [])
)
```

**Parameter Notes:**
- `entityUId` — REQUIRED first parameter, must be GUID from previous `entity.create` or `entity.create_lookup` response
- `packageUId` — REQUIRED, must be GUID not package name
- `schemaName` — Optional but recommended for clarity (e.g., "UsrTodoList")
- All other parameters optional with defaults
- Before adding a title field, inspect the current entity snapshot from `application.create` or `application.get_info`. If `Name` already exists, reuse it and do not add `UsrName`.

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

### 8. Get Entity Columns (binding.get_columns)

**Purpose:** Discover column names, UIds, and data types for deployed entities (e.g., Contact, SysModule, SysModuleEntity).

**Tool Signature:**
```
binding.get_columns(
  schemaName: string        // REQUIRED: Entity schema name (e.g., "Contact", "UsrTodoList")
)
```

**Use Cases:**
- Query metadata for system entities (Contact, Account, SysModule, etc.)
- Prepare column mappings for binding.create
- Validate schema deployment status

**Example:**

```bash
SESSION_ID="..." && curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 10,
    "method": "tools/call",
    "params": {
      "name": "binding.get_columns",
      "arguments": {
        "schemaName": "Contact"
      }
    }
  }' 2>&1 | tee /tmp/mcp-get-columns-raw.txt
```

**Response Format:**
```json
[
  {
    "name": "Id",
    "uId": "ae0e45ca-c495-4fe7-a39d-3ab7278e1617",
    "dataValueTypeName": "Guid",
    "dataValueTypeUId": "23018567-a13c-4320-8687-fd6f9e3699bd",
    "isRequired": true,
    "referenceSchemaName": null
  },
  {
    "name": "Name",
    "uId": "a5cca792-47dd-428a-83fb-5c92bdd97ff8",
    "dataValueTypeName": "MediumText",
    "isRequired": true
  }
]
```

### 9. Create Data Binding (binding.create)

**Purpose:** Create or update a binding in the DB for binding records (SysModule/SysModuleEntity) or lookup seed data, then install the data immediately.

**Tool Signature:**
```
binding.create(
  packageUId: string,       // REQUIRED: Package GUID that owns the binding
  schemaName: string,       // REQUIRED: Entity schema name (e.g., "SysModule", "UsrTodoStatus")
  bindingName: string,      // REQUIRED: Binding folder name (e.g., "SysModule_UsrTodoTask")
  rowsJson: string,         // REQUIRED: JSON array of rows with columnName/value pairs
  columnsJson: string,      // Optional: Column definitions with isKey/isForceUpdate flags
  installType: string,      // Optional: Default "0", use "3" for schema admin unit rights
  outputPath: string        // Optional: Filesystem path to write files on server
)
```

**Parameter Details:**

**rowsJson** format:
```json
[
  [
    {"columnName": "Id", "value": "guid-here"},
    {"columnName": "Name", "value": "New"}
  ],
  [
    {"columnName": "Id", "value": "guid-here-2"},
    {"columnName": "Name", "value": "In Progress"}
  ]
]
```

**columnsJson** format (optional):
```json
[
  {"columnName": "Id", "isKey": true},
  {"columnName": "Name", "isKey": false},
  {"columnName": "TypeColumnUId", "isForceUpdate": true}
]
```
**Defaults:** `isKey=true` for "Id" only, `isForceUpdate=false` for all

**Example: Lookup Seed Data**

```bash
SESSION_ID="..." && curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "id": 11,
    "method": "tools/call",
    "params": {
      "name": "binding.create",
      "arguments": {
        "packageUId": "597944b2-c71f-4cdb-9510-0216c1e214a6",
        "schemaName": "UsrTodoStatus",
        "bindingName": "UsrTodoStatus_Lookup",
        "rowsJson": "[[{\"columnName\":\"Id\",\"value\":\"a1b2c3d4-e5f6-4789-a012-3456789abcde\"},{\"columnName\":\"Name\",\"value\":\"New\"}],[{\"columnName\":\"Id\",\"value\":\"b2c3d4e5-f6a7-4890-b123-456789abcdef\"},{\"columnName\":\"Name\",\"value\":\"In Progress\"}]]"
      }
    }
  }' 2>&1 | tee /tmp/mcp-binding-create-raw.txt
```

**Response Format:**
```json
{
  "success": true
}
```

**Important Notes:**
- Use `binding.get_columns` first to discover column UIds for deployed entities
- `binding.create` requires `packageUId`
- Newly created schemas from `entity.create` or `entity.create_lookup` are DB-first and should already be queryable through `binding.get_columns`
- `outputPath` is optional and only writes server-side file copies; success response still stays `{"success": true}`
- Lookup seed data typically needs only `Id` and `Name` columns

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

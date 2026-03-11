# Agent 04 — Implementation Orchestrator

## Role

Read `plan.md`, call MCP application tools, initialize canonical context in `mcp-application-result.json`, execute ordered entity sync calls when required, refresh context via `application.get_info`, and validate output.

Agent 4 runs synchronously. It must write only `output/<AppName>/` artifacts during app generation.

## Input/Output

- Input: `output/<AppName>/plan.md`, `output/<AppName>/workflow-state.json`, `output/<AppName>/.creatio-env.json`
- Output:
  - `output/<AppName>/mcp-application-result.json`
  - `output/<AppName>/mcp-application-report.md`

## Context

Read:
- `context/essentials.md`
- `context/mcp-application-tools-reference.md` — Complete curl examples and patterns
- `context/ui-reference.md`
- `context/data-bindings-reference.md`
- `context/bindings-lookup.json`

## MCP Workflow (Direct curl Execution)

**Reference:** See `context/mcp-application-tools-reference.md` for complete curl examples, response parsing patterns, and error handling.

Use MCP `application.create` as the primary DB-first flow for full app creation. Use `application.get_list` and `application.get_info` for existing-app discovery and canonical DB refresh.

### Quick Start Pattern

```bash
# 1. Initialize and get session ID
curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}' \
  -D /tmp/headers.txt > /tmp/init.txt

SESSION_ID=$(grep -i 'Mcp-Session-Id:' /tmp/headers.txt | sed 's/.*: //' | tr -d '\r')

# 2. Call application.create
curl -s http://localhost:5001/mcp \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"application.create","arguments":{...}}}' \
  | grep 'data: ' | sed 's/^data: //' | jq -r '.result.content[0].text'

# 3. After entity mutations, refresh context
curl -s ... "application.get_info" ... | grep 'data: ' | sed 's/^data: //' | jq -r '.result.content[0].text' \
  | jq '. + {contractType:"short",schemaSync:[...]}' > output/App/mcp-application-result.json
```

**Critical headers:**
- `Accept: application/json, text/event-stream` — Both required
- `Mcp-Session-Id: <session>` — From initialize response header

### MCP Protocol Flow

1. `initialize`
2. extract `Mcp-Session-Id`
3. `tools/list` and verify `application.create`, `application.get_list`, `application.get_info`
4. for new app flow: `tools/call` → `application.create`
5. if `application.create` returns an existing-app collision, stop the create flow, surface the branch, then continue only through documented existing app flow: `tools/call` → `application.get_list`, then `application.get_info`
6. for explicit existing app flow: `tools/call` → `application.get_list`, then `application.get_info`
7. parse `result.content[0].text` as the short contract
8. initialize `mcp-application-result.json`
9. if needed, execute ordered:
   - `entity.create_lookup`
   - `binding.create` (seed data for each lookup with values defined in plan)
   - `entity.create`
   - `entity.update`
10. after each successful entity mutation, call `application.get_info` and overwrite `mcp-application-result.json`

Implementation execution is synchronous. Do not background Agent 4, and do not mix repo-maintenance edits with the app-generation run.

### Response Handling

`tools/call` response content is text.

Expected contract:
- `success`
- flat runtime fields: `packageUId`, `packageName`, `entities[]`
- optional selectors: `app`, `appId`, or `appCode`
- optional `error`

Normalize and persist:
- `contractType`
- `success`
- `app` when available or inferable
- `packageUId`
- `packageName`
- `entities`
- `error`
- `schemaSync`
- `editableContext`

Persist the compact context from MCP and set `contractType=short`.

### Schema Sync Rules

- Create new lookup entities first with `entity.create_lookup`.
- For lookup entities, rely on inherited `Name` as the display value. Do not add `Name` or duplicate title-like columns as custom columns, and treat the lookup as incomplete if the plan does not preserve `Name` as the intended `PrimaryDisplayColumn`.
- After every `entity.create_lookup`, validate the tool response contains inherited `Name` in the persisted schema snapshot. If `Name` is missing, stop with blocker instead of assuming the lookup is usable.
- After creating each lookup entity that has seed values defined in the plan, call `binding.create` to populate it with seed rows before proceeding to the next entity.
- For new-app flows, inspect the entity list returned by `application.create` and treat the template-created section entity as the canonical main entity for the app's primary records.
- Use `entity.create` only for new entities that are genuinely additional business objects and not already represented by the template-created section entity.
- Before `entity.update`, inspect the current schema snapshot from `application.create` or `application.get_info`. If `Name` already exists, reuse `Name` and do not add `UsrName`, `UsrTitle`, or `UsrCaption` unless the requirements explicitly require a separate business field.
- Use `entity.update` for template-created entities and pass only `operationsJson`.
- Entity-tool success is valid only when the schema is fully materialized, immediately refreshable via `application.get_info`, and not left in a `Database update required` state.
- `entity.update` operations are explicit:
  - `addColumn`
  - `updateColumn`
  - `removeColumn`
- Omission never implies deletion.

### Related Binding Tools

- `binding.get_columns` discovers column names, UIds, and data value types for deployed schemas such as `SysModule` and `SysModuleEntity`.
- `binding.create` creates or updates a binding in DB, stores payload, and installs lookup seed data immediately. `outputPath` only writes optional server-side file copies.
- Schemas created earlier in the same flow are DB-first and should be queried through `binding.get_columns`; do not use raw mode.
- For lookup seed bindings, generate a fresh GUID for every row, include `Name`, and include `Description` when it must be persisted with the lookup value.
- If `columnsJson` is supplied to `binding.create`, MCP uses only those descriptor columns. Do not pass partial `columnsJson` for lookup seed bindings.

### Parameter Validation Checklist

Before EVERY entity tool call (`entity.create_lookup`, `entity.create`, `entity.update`), validate:

1. ✅ Using `packageUId` (GUID) extracted from `application.create` response
2. ✅ Using `entityUId` (GUID) extracted from `entity.create` or `application.get_info` response (REQUIRED for `entity.update`)
3. ✅ Using `schemaName` parameter for `entity.update` (optional, can read from DB if empty)
4. ✅ Using `name` parameter for `entity.create`/`entity.create_lookup` (NOT `entityName` or `schemaName`)
5. ✅ Using `caption` parameter (NOT `displayName` or `description`)
6. ✅ Using `operationsJson` with `{operation, column}` structure (NOT flat `{type, name, ...}`)
7. ✅ Using `dataValueTypeName` (NOT `dataValueType`)
8. ✅ For lookup schemas, `columnsJson` does not attempt to add `Name`, `Description`, `UsrName`, `UsrTitle`, or `UsrCaption`
9. ✅ For existing/template-created entities, `operationsJson` does not add `UsrName`, `UsrTitle`, or `UsrCaption` when the refreshed schema already contains `Name`, unless the plan explicitly documents a separate business field

**Before EVERY binding tool call (`binding.create`), validate:**

1. ✅ Using `packageUId` (GUID) extracted from `application.create` response
2. ✅ Using `schemaName` (entity schema name, e.g. "UsrTodoStatus")
3. ✅ Using `bindingName` (NOT `dataName` or `bindingFolder`)
4. ✅ Using `rowsJson` (NOT `dataJson` or `data`)
5. ✅ Each row in `rowsJson` is array of `{columnName, value}` objects
6. ✅ Optional `columnsJson` with `{columnName, isKey?, isForceUpdate?}` structure
7. ✅ Target schema is already materialized in DB and queryable through `binding.get_columns`
8. ✅ Lookup seed rows use fresh GUID values, not decorative placeholders copied from docs
9. ✅ If `columnsJson` is present, it covers every row column that must exist in the descriptor

**Pre-execution validation script:**

```bash
# Before entity.create_lookup or entity.create
if [[ -z "$PACKAGE_UID" || "$PACKAGE_UID" == "null" ]]; then
  echo "ERROR: PACKAGE_UID not set or invalid"
  exit 1
fi

# Before entity.update
if [[ -z "$ENTITY_UID" || "$ENTITY_UID" == "null" ]]; then
  echo "ERROR: ENTITY_UID not set or invalid"
  exit 1
fi
if [[ -z "$PACKAGE_UID" || "$PACKAGE_UID" == "null" ]]; then
  echo "ERROR: PACKAGE_UID not set or invalid"
  exit 1
fi
```

**UId Extraction Pattern (New Flat Format):**

Since core 8.3.4.802, MCP tools return simplified flat format. Use the helper script for zero-dependency extraction:

```bash
# Method 1: Ultra-simple with helper script (recommended)
bash ~/scripts/mcp-response-to-env.sh /tmp/mcp-app-create-parsed.json > /tmp/.mcp-env
source /tmp/.mcp-env

echo "Extracted Package UId: $PACKAGE_UID"
echo "Extracted Package Name: $PACKAGE_NAME"
echo "Extracted Main Entity UId: $MAIN_ENTITY_UID"
echo "Extracted Main Entity Name: $MAIN_ENTITY_NAME"

# Validate extraction succeeded
if [[ -z "$PACKAGE_UID" || "$PACKAGE_UID" == "null" ]]; then
  echo "BLOCKER: Failed to extract package UId from application.create response"
  exit 1
fi
```

**Alternative: Direct jq extraction (simple paths):**

```bash
# Method 2: Direct jq (no helper script)
PACKAGE_UID=$(jq -r '.packageUId' /tmp/mcp-app-create-parsed.json)
PACKAGE_NAME=$(jq -r '.packageName' /tmp/mcp-app-create-parsed.json)
MAIN_ENTITY_UID=$(jq -r '.entities[0].uId' /tmp/mcp-app-create-parsed.json)
MAIN_ENTITY_NAME=$(jq -r '.entities[0].name' /tmp/mcp-app-create-parsed.json)

echo "Extracted Package UId: $PACKAGE_UID"
echo "Extracted Entity UId: $MAIN_ENTITY_UID"
```

**New Response Format Structure:**
```json
{
  "success": true,
  "packageUId": "597944b2-c71f-4cdb-9510-0216c1e214a6",
  "packageName": "UsrTodoList",
  "entities": [
    {"uId": "...", "name": "UsrTodoList", "caption": "Todo", "columns": [...]}
  ]
}
```

**Error Diagnosis from tmux Logs:**

If MCP call returns generic "An error occurred invoking..." message:

```bash
# Check core tmux session logs for actual exception
tmux capture-pane -t core -p -S -1000 | grep -A5 "ArgumentException\|Error\|Exception"
```

Look for diagnostic patterns:
- `ArgumentException: missing value for required parameter 'packageUId'` → using wrong parameter name (e.g., `packageName`)
- `ArgumentException: missing value for required parameter 'entityUId'` → using wrong parameter name (e.g., `entitySchemaUId`)
- `Unsupported operation ''` → wrong JSON structure in `operationsJson` (flat instead of nested)

**Correct Tool Signatures Reference:**

Always verify against C# source files:
- `~/Projects/core/TSBpm/Src/Lib/Terrasoft.Mcp/Tools/EntityCreateLookupTool.cs` (line 13-23)
- `~/Projects/core/TSBpm/Src/Lib/Terrasoft.Mcp/Tools/EntityCreateTool.cs`
- `~/Projects/core/TSBpm/Src/Lib/Terrasoft.Mcp/Tools/EntityUpdateTool.cs` (line 13-26)
- `~/Projects/core/TSBpm/Src/Lib/Terrasoft.Mcp/Models/EntityColumnOperation.cs`

### Validation Checklist

- response text parses as JSON
- `contractType=short`
- `success` exists
- if `success=true`, `packageUId` is non-empty
- if `success=true`, `entities` is non-empty
- if `success=false`, `error.message` is non-empty
- each lookup creation response confirms inherited `Name` exists before seed data is installed
- each successful entity tool call is followed by a successful `application.get_info` refresh
- no duplicate title-like columns are added when the refreshed main entity snapshot already contains `Name`
- no second BaseEntity is created for the same primary record type already covered by the template-created section entity
- result and report are persisted
- final report matches the materialized entity names and implemented artifacts in `mcp-application-result.json`

### Retry and Failure Policy

- Retry MCP calls up to 3 times with 10s delay for transient failures.
- If required application tools are missing in `tools/list`, stop with blocker.
- If any tool returns `success=false`, stop with blocker and surface `error.message`.
- If `application.create` returns an existing-app collision and the plan does not explicitly allow update flow, stop with blocker.
- If the plan tries to create a second BaseEntity for the same primary record type as the template-created section entity, stop with blocker instead of executing `entity.create`.
- For plain-text `ERROR:` responses, stop with blocker and persist raw response in report.
- If `application.get_info` fails after a reported entity mutation success because the schema is missing from server metadata, stop with a core MCP materialization blocker.
- Never synthesize success for `binding.create`; if the response cannot be parsed or does not contain `success=true`, stop with blocker.

## Steps

### 0. Check Gate R (mandatory)

```bash
scripts/check-approval-gate.sh <AppName>
```

If this fails, stop immediately.

### 1. Parse `plan.md`

Extract resolved MCP payload, runtime resolution strategy, and ordered schema sync steps.

### 2. Initialize MCP session

**See:** `context/mcp-application-tools-reference.md` section "Initialize Session"

Use `mcpUrl` from `.creatio-env.json`:

```bash
MCP_URL=$(jq -r '.mcpUrl' output/<AppName>/.creatio-env.json)

curl -s "$MCP_URL" \
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
      "clientInfo": {"name": "app-creator", "version": "1.0.0"}
    }
  }' -D /tmp/mcp-headers.txt > /tmp/mcp-init.txt

SESSION_ID=$(grep -i 'Mcp-Session-Id:' /tmp/mcp-headers.txt | sed 's/.*: //' | tr -d '\r')
```

If initialize fails, stop and report blocker.

### 3. Verify tool availability

**See:** `context/mcp-application-tools-reference.md` section "List Available Tools"

```bash
curl -s "$MCP_URL" \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | grep -A 1000 'event: message' | sed 's/^event: message$//' | sed 's/^data: //' \
  | jq -r '.result.tools[] | select(.name | startswith("application.") or startswith("entity.")) | .name'
```

Verify presence of:
- `application.create`
- `application.get_info`
- `application.get_list`
- `entity.create`
- `entity.create_lookup`
- `entity.update`

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

**See:** `context/mcp-application-tools-reference.md` section "Create Application"

For new app flow:

```bash
curl -s "$MCP_URL" \
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
        "name": "'"$APP_NAME"'",
        "code": "'"$APP_CODE"'",
        "templateCode": "AppFreedomUI",
        "iconBackground": "'"$ICON_COLOR"'",
        "description": "'"$APP_DESCRIPTION"'",
        "optionalTemplateDataJson": "'"$TEMPLATE_DATA"'"
      }
    }
  }' 2>&1 | tee /tmp/mcp-app-create-raw.txt
```

Parse and validate:

```bash
RESPONSE=$(grep 'data: ' /tmp/mcp-app-create-raw.txt | sed 's/^data: //' | jq -r '.result.content[0].text')

# Validate short contract
echo "$RESPONSE" | jq -e '.success == true and .packageUId != null and (.entities | length > 0)' > /dev/null \
  || { echo "Error: $(echo "$RESPONSE" | jq -r '.error.message')"; exit 1; }
```

For existing app flow:
1. call `application.get_list`
2. validate the target app is discoverable
3. call `application.get_info` with the chosen `appId` or `appCode`
4. log the branch explicitly in the report and final status

Retry up to 3 times with 10s delay on transient failures.

Stop and report blocker when:
- text is plain `ERROR: ...`
- payload is not parseable JSON
- `success=false`
- successful response is missing `packageUId` or `entities`

### 6. Initialize canonical context

**See:** `context/mcp-application-tools-reference.md` section "Initialize Canonical Context File"

Write normalized MCP result:

```bash
echo "$RESPONSE" | jq '. + {
  contractType: "short",
  schemaSync: [],
  editableContext: {}
}' > output/<AppName>/mcp-application-result.json
```

Or use Python helper:

```bash
python3 scripts/mcp_context_adapter.py normalize output/<AppName>/mcp-application-result.json
```

Normalized result shape:
- `contractType` (`short`)
- `success` (boolean)
- `app` (object when available or inferable)
- `packageUId` (GUID)
- `packageName` (string)
- `entities` (array)
- `error` (object when available)
- `schemaSync` (array of executed entity tool operations with tool name, target, and status)
- `editableContext` (package/entity-oriented projection for approved edits)

Persist the compact tree response as-is and add `contractType=short`.

### 7. Execute schema sync steps

**See:** `context/mcp-application-tools-reference.md` sections:
- "Create Lookup Entity (entity.create_lookup)"
- "Update Entity (entity.update)"

If `plan.md` contains approved schema sync:

**Option 1: Manual curl execution**

Example for entity.create_lookup:

```bash
curl -s "$MCP_URL" \
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
        \"caption\": \"Event Status\"
      }
    }
  }" 2>&1 | tee /tmp/mcp-lookup-raw.txt
```

Example for entity.update:

```bash
# Extract entity UId from application.get_info response
ENTITY_UID=$(jq -r '.entities[] | select(.name=="UsrEvent") | .uId' /tmp/mcp-app-context.json)

curl -s "$MCP_URL" \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": 6,
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"entity.update\",
      \"arguments\": {
        \"entityUId\": \"$ENTITY_UID\",
        \"packageUId\": \"$PACKAGE_UID\",
        \"schemaName\": \"UsrEvent\",
        \"operationsJson\": \"[{\\\"operation\\\":\\\"addColumn\\\",\\\"column\\\":{\\\"name\\\":\\\"UsrLocation\\\",\\\"caption\\\":\\\"Location\\\",\\\"dataValueTypeName\\\":\\\"MediumText\\\"}}]\"
      }
    }
  }" 2>&1 | tee /tmp/mcp-update-raw.txt
```

Example for binding.create:

```bash
STATUS_NEW_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
STATUS_IN_PROGRESS_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
curl -s "$MCP_URL" \
  -u Supervisor:Supervisor \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"id\": 10,
    \"method\": \"tools/call\",
    \"params\": {
      \"name\": \"binding.create\",
      \"arguments\": {
        \"packageUId\": \"$PACKAGE_UID\",
        \"schemaName\": \"UsrEventStatus\",
        \"bindingName\": \"UsrEventStatus_Lookup\",
        \"rowsJson\": \"[[{\\\"columnName\\\":\\\"Id\\\",\\\"value\\\":\\\"$STATUS_NEW_ID\\\"},{\\\"columnName\\\":\\\"Name\\\",\\\"value\\\":\\\"New\\\"},{\\\"columnName\\\":\\\"Description\\\",\\\"value\\\":\\\"\\\"}],[{\\\"columnName\\\":\\\"Id\\\",\\\"value\\\":\\\"$STATUS_IN_PROGRESS_ID\\\"},{\\\"columnName\\\":\\\"Name\\\",\\\"value\\\":\\\"In Progress\\\"},{\\\"columnName\\\":\\\"Description\\\",\\\"value\\\":\\\"\\\"}]]\"
      }
    }
  }" 2>&1 | tee /tmp/mcp-binding-raw.txt
```

Successful binding response is only `{"success": true}`.

**After EACH successful entity mutation:**

```bash
# Refresh context
curl -s "$MCP_URL" \
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
      "arguments": {"appCode": "UsrEvents"}
    }
  }' | grep 'data: ' | sed 's/^data: //' | jq -r '.result.content[0].text' \
  | jq '. + {
      contractType: "short",
      schemaSync: [...existing..., {tool: "entity.create_lookup", target: "UsrEventStatus", status: "success"}]
    }' > output/<AppName>/mcp-application-result.json
```

**Option 2: Python helper** (for complex workflows):

```bash
python3 scripts/mcp_schema_sync.py apply \
  --result output/<AppName>/mcp-application-result.json \
  --edited-context output/<AppName>/editable-context.json \
  --env output/<AppName>/.creatio-env.json
```

**Critical validation:**
- Created/updated schema MUST be immediately queryable through `application.get_info`
- If schema is missing from server metadata after successful entity tool response, this is a core MCP blocker - stop immediately
- Do NOT proceed if schema is in "Database update required" state

Stop and report blocker on first failed entity tool call.

### 8. Validate output contract

Validate result payload:
1. top-level `success` exists and is boolean
2. `contractType=short`
3. when `success=true`, `packageUId` is a non-empty GUID
4. when `success=true`, `entities` is non-empty
5. when `success=false`, `error.message` is non-empty

### 9. Write summary report

Create:
- `output/<AppName>/mcp-application-report.md`

Include:
- resolved payload fields
- icon resolution details
- MCP result (`contractType=short`, `success`, `packageUId`, `packageName`)
- schema sync steps executed and refreshed through `application.get_info`
- validation results for normalized contract
- whether the run completed via create flow or existing-app update flow

## Completion Criteria

- Gate R passed
- MCP initialize and tools/list succeeded
- `application.create` executed successfully
- Result persisted to `mcp-application-result.json`
- All required schema sync steps executed and canonical context refreshed
- No created or updated schema is left in `Database update required`
- Validation passed
- Summary persisted to `mcp-application-report.md`

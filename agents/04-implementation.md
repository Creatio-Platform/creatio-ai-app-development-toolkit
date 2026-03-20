# Agent 04 — Implementation Orchestrator

## Role

Read `plan.md`, call MCP application tools, initialize canonical context in `mcp-application-result.json`, execute ordered entity sync calls when required, synchronize planned FormPage/ListPage updates, refresh context via `application.get_info`, and validate output.

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
- `context/viewconfig-reference.md`
- `context/handlers-reference.md`
- `context/data-bindings-reference.md`
- `context/bindings-lookup.json`
- `scripts/page_body_tools.py`
- `scripts/page_body_edit.py`
- `scripts/mcp_result_evidence.py`

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
11. if the plan creates or extends the main entity for a new app, execute the planned `page.list` → `page.get` → `page.update(dryRun)` → `page.update` page-sync steps for the generated `FormPage` and `ListPage`
12. re-read synchronized pages with `page.get`, persist page metadata and verification results, and stop with blocker if required fields or resolved grid columns are missing

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
- `operationLog`
- `pageEvidence`
- `acceptanceEvidence`

Persist the compact context from MCP and set `contractType=short`.
Never hand-write `mcp-application-result.json` or `mcp-application-report.md` from shell variables once runtime evidence exists.

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
- If the run creates a new app or extends the main section entity with approved non-inherited business fields, page sync for the generated `FormPage` and `ListPage` is mandatory before success can be reported.
- Treat a missing page-sync section in `plan.md` for such a run as a blocker in the plan, not as a reason to silently skip UI sync.
- `schema default` means the backend/entity schema contract sets the value through `defaultValueSource` and `defaultValue`.
- `ui default` means the page layer sets the value through `crt.CreateRecordRequest.defaultValues` or a handler.
- Lookup seed rows alone do not satisfy a requirement such as `UsrStatus defaults to New`.
- If the plan says `schema default` for a lookup column, use the seeded row GUID in `defaultValue`; never send the display caption.
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
10. ✅ If a column uses `defaultValueSource="Const"` and is a lookup, `defaultValue` is the seeded row GUID
11. ✅ If the requirement is `defaults to X`, the execution branch contains either a `schema default` or `ui default` step before the result is reported as complete

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
- `page.get`
- `page.update`
- `page.list`
- `entity.create`
- `entity.create_lookup`
- `entity.update`

If application tools are missing, stop and report blocker. Schema tools are optional — skip page editing steps if unavailable.

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

### 7b. Execute page customization steps

Read the skill doc: **`skills/page-schema-editing/SKILL.md`**

If `plan.md` contains page customization requirements, or the run creates or extends the main section entity for a new app:

- Stop with blocker if this run requires page sync but `plan.md` does not define explicit `FormPage` and `ListPage` sync steps.

1. Call `page.list` with the app's package name to discover generated pages
2. For each page that needs customization:
   a. Call `page.get(schemaName)` to get the full JS body
   b. Edit the body using the **Page Body Editing Algorithm** below — never use ad-hoc string manipulation
   c. Merge new content with existing section content (do NOT replace existing handlers — append)
   d. If the page must surface newly added entity fields, inspect `SCHEMA_VIEW_CONFIG_DIFF` and `SCHEMA_VIEW_MODEL_CONFIG_DIFF` together
   d1. If the page must change ListPage default sorting, use the canonical `ListPage DataGrid Sorting via page.update` contract from `context/ui-reference.md`
   d2. Read the live DataGrid `items` binding and identify the real collection attribute before changing sorting metadata
   d3. Only implement plain sortable-column order through DataGrid sorting metadata; if the requirement is semantic business order without an explicit sort key or approved runtime logic, stop with blocker instead of improvising
   e. For runtime FormPage field sync, append missing field inserts to `SideAreaProfileContainer` and continue `row` and `index` from the current maximum values
   f. Add matching `SCHEMA_VIEW_MODEL_CONFIG_DIFF` attributes for every inserted field
   g. For datasource-bound lookup fields, add the `crt.ComboBox` insert and the main view-model attribute only; preserve existing live lookup-list bindings or nested actions only when they are already materialized in the page body
   h. Preserve live special cases such as `Name -> PDS.Name`; do not duplicate `Name` if it already exists
   i. If handlers use SDK services, ensure `deps` and `args` include the required import and preserve the live SDK alias style already used by the page body
   j. Call `page.update` with `dryRun: "true"` first to validate
   k. If dry run succeeds, call `page.update` without dryRun to save
   l. Re-read the page with `page.get` and verify the resolved FormPage fields or ListPage columns are actually present
   m. Persist page verification with explicit status buckets: `implemented`, `machineChecked`, `manualCheckPending`
3. Update `mcp-application-result.json` with page metadata:
   ```json
   {
     "packages": {
       "<PackageName>": {
         "pages": {
           "<PageName>": {
             "uId": "...",
             "parentSchemaName": "...",
             "hasHandlers": true,
              "handlerCount": 2,
              "verification": {
                "implemented": true,
                "machineChecked": true,
                "manualChecked": false,
                "requiredFieldsPresent": true,
                "resolvedColumnsPresent": true
              }
            }
          }
        }
      }
    }
   ```
4. Append page customization results to `schemaSync`
5. Stop with blocker if the plan required page sync but the final verification still shows missing fields or columns

**Python helper option:**

```bash
python3 scripts/mcp_page_sync.py build-plan \
  --plan-md output/<AppName>/plan.md \
  --output output/<AppName>/page-sync-plan.json

python3 scripts/mcp_page_sync.py apply \
  --result output/<AppName>/mcp-application-result.json \
  --plan output/<AppName>/page-sync-plan.json \
  --env output/<AppName>/.creatio-env.json \
  --report output/<AppName>/mcp-application-report.md
```

`--plan` may also point directly to `output/<AppName>/plan.md` when that file contains the embedded `page-sync-plan.json` block between `<!-- PAGE_SYNC_PLAN_JSON_START -->` and `<!-- PAGE_SYNC_PLAN_JSON_END -->`.

**FormPage field sync rules:**
- Read the current `SCHEMA_VIEW_CONFIG_DIFF` and `SCHEMA_VIEW_MODEL_CONFIG_DIFF` together before adding fields
- Use the resolved FormPage field set from `plan.md`; if the plan is partial for a new-app main entity, fill the gaps with the default policy before editing the page
- Add an `insert` for every missing resolved FormPage field to `SideAreaProfileContainer`
- Continue `row` and `index` from the current maximum values in `SideAreaProfileContainer`
- Keep `column=1`, `colSpan=1`, and `rowSpan=1` unless the live page already uses a different layout grid
- Add matching `SCHEMA_VIEW_MODEL_CONFIG_DIFF` bindings for every inserted field
- For datasource-bound lookup fields, add only the main ComboBox binding by default
- Do not manually add `*_List`, embeddedModel, nested `value`/`displayValue`, paging, sorting, or `crt.ComboboxSearchTextAction` unless the live page body already contains that materialization and it must be preserved
- Keep `Name` as the record title/header when it already exists and do not duplicate it
- Required non-inherited business fields must never be omitted from the synchronized FormPage
- `crt.ImageInput` binds via `value`; most other field controls bind via `control`
- Match `crt.DateTimePicker.pickerType` to the real field kind and add `crt.NumberInput.format.decimalPrecision` when numeric scale is known
- Treat `crt.PhoneInput`, `crt.EmailInput`, `crt.WebInput`, `crt.ComboBox`, and `crt.ImageInput` as preprocessor-backed controls; avoid manually duplicating generated request wiring such as ComboBox load handlers or ImageInput upload/clear handlers unless the live page body already contains explicit versions
- Stop with blocker if page sync introduces a new FormPage attribute ending with `_List` that was not present in the live page before editing
- `crt.FileInput`, `crt.EncryptedInput`, and `crt.Slider` are supported, but use them only when the approved plan explicitly calls for that UX instead of the default field mapping

**ListPage grid sync rules:**
- Use the resolved ListPage column set from `plan.md`; if the plan is partial for a new-app main entity, fill the gaps with the default policy before editing the page
- Always include `Name`
- Always include every required non-inherited business field
- For optional defaults, append only the highest-priority short operational fields in this order: status/lifecycle, priority/severity, type/category, due/start/end date, owner/assignee, code/number, amount
- Keep auto-selected default ListPage columns compact by capping them at 6 total visible columns unless required business fields exceed that number
- Exclude inherited audit/system fields unless explicitly requested
- Exclude long/rich/blob fields unless explicitly requested or required
- Preserve existing DataGrid columns and order unless the requirements explicitly demand reordering
- Append only the missing resolved columns
- After persistence, verify that every required field and every resolved selected column exists in the live DataGrid

**ListPage sorting rules:**
- Use `context/ui-reference.md` as the canonical source of truth for DataGrid sorting metadata
- Read the live page body and identify the actual DataGrid collection attribute instead of assuming it is always named `Items`
- Keep the collection `modelConfig.path` bound to the live data source such as `PDS` unless the task explicitly changes the data source
- Use entity column names in sort options, not attribute keys
- Treat explicit DataGrid `sorting` and `sortingChange` view properties as secondary to the collection metadata contract
- Stop with blocker if the requirement describes semantic business order without an explicit technical sort key or separate approved runtime logic

**Page Body Editing Algorithm:**

When editing a page body retrieved from `page-get`, always use marker-based section extraction and structured JSON modification. The utility `scripts/page_body_edit.py` implements this algorithm and should be used when available.

1. **Extract** — locate the marker pair `/**MARKER*/.../**MARKER*/` and extract only the content between them
2. **Detect variant** — determine whether the section is `viewModelConfig` (plain object) or `viewModelConfigDiff` (array of merge operations); same for `modelConfig`/`modelConfigDiff`
3. **Parse** — deserialize the section content as JSON with trailing-comma tolerance (strip `,` before `]` and `}`)
4. **Modify** — apply changes to the parsed data structure (append to arrays, merge into objects)
5. **Serialize** — convert back to formatted JSON string with proper indentation
6. **Replace** — substitute the content between markers with the serialized result
7. **Validate** — re-extract and re-parse each modified section to confirm structural integrity

For FormPage field additions, use `scripts/page_body_edit.py add-form-fields` or apply the same algorithm manually:
- Parse `SCHEMA_VIEW_CONFIG_DIFF` as JSON array
- Find max `row` and `index` among existing inserts in `SideAreaProfileContainer`
- Append complete insert objects with incremented row/index
- Detect the viewModelConfig marker variant and add attributes to the correct location

For ListPage column additions, use `scripts/page_body_edit.py add-list-columns` or apply the same algorithm manually:
- Parse `SCHEMA_VIEW_CONFIG_DIFF` as JSON array
- Find the `DataTable` merge operation and its `columns` array
- Append complete column objects to the parsed array
- Detect the viewModelConfigDiff marker and add attributes into the merge operation's `values` object

**Page body editing anti-patterns (MUST NOT):**

- ❌ Never use `body.find("}")` or brace-counting to locate insertion points — nested JS structures make positional brace search unreliable
- ❌ Never insert raw JSON strings into the body without parsing the target section first — splicing text into unparsed JSON causes structural corruption
- ❌ Never assume the viewModelConfig section type — always detect whether it is `viewModelConfig` (object `{}`) or `viewModelConfigDiff` (array `[]` of operations); FormPage typically uses the object variant, ListPage the array variant
- ❌ Never verify edits by substring search alone (e.g., `"UsrStatus" in body`) — a field name can be present in a structurally broken body; always re-parse each edited section as JSON to confirm integrity
- ❌ Never insert content at a position found by counting closing braces from an anchor string — the correct anchor is the marker boundary, not a brace position

**Post-edit structural validation (MUST):**

Before calling `page-update`, validate the edited body:
1. All 8 marker pairs are present (6 required + 1 viewModelConfig variant + 1 modelConfig variant)
2. `SCHEMA_VIEW_CONFIG_DIFF` content parses as a JSON array
3. `SCHEMA_VIEW_MODEL_CONFIG` or `SCHEMA_VIEW_MODEL_CONFIG_DIFF` content parses as valid JSON
4. `SCHEMA_MODEL_CONFIG` or `SCHEMA_MODEL_CONFIG_DIFF` content parses as valid JSON
5. Every `insert` operation in viewConfigDiff has `name`, `values`, `parentName`, `propertyName`, `index`
6. Every field using `control: "$X"` has a matching attribute `X` in viewModelConfig(Diff)
7. For FormPage: insert operations targeting `SideAreaProfileContainer` have monotonically increasing `row` values
8. For ListPage: `DataTable` merge contains all required column codes from the page-sync plan

**Handler generation rules:**
- Map business intents to request types using `handlers-reference.md`
- By default `await next?.handle(request)` to preserve the request chain, but omit it intentionally when canceling or overriding the default flow
- Use `finally` when cleanup must happen even if the main handler logic fails
- Use `request.$context.executeRequest(...)` for programmatic follow-up requests
- Use `request.$context.setValue(...)` and `setAttributePropertyValue(...)` for dynamic attribute state and validation
- `SCHEMA_DEPS` and `SCHEMA_ARGS` are page-body source imports and must still be updated when handler code uses sdk APIs
- Reuse the live SDK import alias (`sdk`, `devkit`, etc.) and prefer `@creatio-devkit/common` for services such as `HttpClientService`, `SysValuesService`, `SysSettingsService`, `RightsService`, `Model.create(...)`, `FilterGroup`, and `ProcessEngineService`
- Use `context/devkit-common-reference.md` as the exhaustive source of truth for available `sdk.*` exports and stay within its documented `public/**` surface
- Prefer handlers, business rules, and attribute-property APIs over `converters` and `validators` unless the live page already uses those object sections explicitly
- Prefix entity column attributes with `PDS_` (e.g., `PDS_UsrName`)
- Lookup attribute values are objects with `.value` (GUID) and `.displayValue` (text)
- Return early (without calling `next`) to cancel save/delete operations

Stop and report blocker on first failed page tool call.

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
- page sync steps executed and verification results for `FormPage` and `ListPage`
- validation results for normalized contract
- whether the run completed via create flow or existing-app update flow
- explicit distinction between `implemented`, `machineChecked`, and `manualCheckPending`
- never claim UI acceptance is verified unless the corresponding evidence exists in `mcp-application-result.json`

## Completion Criteria

- Gate R passed
- MCP initialize and tools/list succeeded
- `application.create` executed successfully
- Result persisted to `mcp-application-result.json`
- All required schema sync steps executed and canonical context refreshed
- No created or updated schema is left in `Database update required`
- Page sync executed and verified for new-app main-entity flows or any run where the plan requires page customization
- Validation passed
- Summary persisted to `mcp-application-report.md`

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
- `context/mcp-application-tools-reference.md` — MCP tool parameters and payload reference
- `context/ui-reference.md`
- `context/viewconfig-reference.md`
- `context/handlers-reference.md`
- `context/data-bindings-reference.md`
- `context/bindings-lookup.json`
- `scripts/mcp_client.py` — Reusable stdio MCP client (use this, not curl)
- `scripts/page_body_tools.py`
- `scripts/page_body_edit.py`
- `scripts/mcp_result_evidence.py`

## MCP Workflow (via scripts/mcp_client.py)

**Primary transport:** clio MCP uses **stdio** (`clio mcp-server`), not HTTP/SSE. Use `scripts/mcp_client.py` for all MCP calls. Do NOT use curl for clio MCP.

### clio Resolution Order

`scripts/mcp_client.py` resolves clio in this priority:

| Scenario | Resolution |
|----------|-----------|
| User provided custom clio path | Set `CLIO_CMD` env var: `CLIO_CMD="dotnet /path/to/clio.dll"` |
| Standard install (most users) | `clio` in PATH — installed via `dotnet tool install clio -g` |
| clio not found | `RuntimeError` with install instructions — stop and ask user to install |

### clio stdio Transport — Critical Constraints

❌ **NEVER** pass `-e` flag to `mcp-server` — it is NOT supported (causes exit code 1)
❌ **NEVER** use shell variable expansion (`$VAR`) in pipes to `mcp-server` — blocked by security scanner
❌ **NEVER** send `notifications/initialized` — clio does not support it
❌ **NEVER** use dot-separated tool names (`application.create`) — clio uses **dashes** (`application-create`)
❌ **NEVER** pass boolean parameters as strings (`'true'`/`'false'`) — use Python `True`/`False`. String booleans cause MCP SDK deserialization failure with generic `"An error occurred invoking..."` error.
✅ **ALWAYS** use `scripts/mcp_client.py` which handles all transport details correctly

### Quick Start Pattern

```bash
# All MCP calls go through the stdio client — same interface for every tool
python3 scripts/mcp_client.py <tool-name> '<args-json>' [timeout]

# Returns JSON: {"success": bool, "data": {...}|null, "raw": "..."}

# Example: create application
python3 scripts/mcp_client.py application-create '{
  "environment-name": "local",
  "name": "My App",
  "code": "UsrMyApp"
}' | python3 -c "import json,sys; r=json.load(sys.stdin); print(r['data'] if r['success'] else r['raw'])"

# Example: after entity mutations, refresh context
python3 scripts/mcp_client.py application-get-info '{
  "environment-name": "local",
  "app-code": "UsrMyApp"
}' | python3 -c "
import json, sys
r = json.load(sys.stdin)
if r['success']:
    json.dump(r['data'], open('output/UsrMyApp/mcp-application-result.json','w'), indent=2)
else:
    print('ERROR:', r['raw'])
"
```

**When creating mcp_client.py calls in bash scripts — always use the two-step pattern:**
```bash
# Step 1: write the script to a file
cat > /tmp/run_mcp.py << 'PYEOF'
import sys
sys.path.insert(0, '/Users/a.kravchuk/Projects/ai-driven-app-creation/scripts')
from mcp_client import call_mcp_tool
result = call_mcp_tool('application-create', {
    'environment-name': 'local',
    'name': 'My App',
    'code': 'UsrMyApp',
})
import json
print(json.dumps(result, indent=2))
PYEOF

# Step 2: run it
python3 /tmp/run_mcp.py
```

### MCP Protocol Flow

All calls use `scripts/mcp_client.py`. Transport details (initialize handshake, stdio framing) are handled internally by the script.

1. verify `application-get-list` responds (confirms clio MCP is reachable)
2. check if target app already exists: `application-get-list` → search by `code`
3. **if app does not exist** → `application-create`; if it returns a collision, surface the branch and switch to update flow
4. **if app exists** → use `application-get-info` directly (skip `application-create`)
5. parse response `data` field as the short contract
6. initialize `mcp-application-result.json`
7. if needed, execute ordered:
   - `create-lookup`
   - `create-data-binding-db` (seed data for each lookup with values defined in plan)
   - `create-entity-schema`
   - `update-entity-schema`
8. after each successful entity mutation, call `application-get-info` and overwrite `mcp-application-result.json`
9. if the plan creates or extends the main entity for a new app, execute the planned `page-list` → `page-get` → `page-update(dryRun)` → `page-update` page-sync steps for the generated `FormPage` and `ListPage`
10. re-read synchronized pages with `page-get`, persist page metadata and verification results, and stop with blocker if required fields or resolved grid columns are missing

Implementation execution is synchronous. Do not background Agent 4, and do not mix repo-maintenance edits with the app-generation run.

### Response Handling

`tools/call` response content is text.

**CRITICAL — Response Validation (before any parsing):**
1. Check `isError` flag first: if `result.isError === true`, the call failed — do NOT attempt to parse `result.content[0].text` as a success payload.
2. On `isError: true`: extract the error message from `result.content[0].text`, log it, and decide: retry with fixed params, or stop with blocker.
3. On empty or missing `result.content[0].text`: treat as error — do NOT call `json.loads("")` or `jq` on empty input.
4. Only parse the text content as JSON after confirming `isError` is absent or `false` and the text is non-empty.

Expected contract (when `isError` is absent or false):
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

- Create new lookup entities first with `create-lookup`.
- For lookup entities, rely on inherited `Name` as the display value. Do not add `Name` or duplicate title-like columns as custom columns, and treat the lookup as incomplete if the plan does not preserve `Name` as the intended `PrimaryDisplayColumn`.
- After every `create-lookup`, validate the tool response contains inherited `Name` in the persisted schema snapshot. If `Name` is missing, stop with blocker instead of assuming the lookup is usable.
- After creating each lookup entity that has seed values defined in the plan, call `create-data-binding-db` to populate it with seed rows before proceeding to the next entity.
- For new-app flows, inspect the entity list returned by `application-create` and treat the template-created section entity as the canonical main entity for the app's primary records.
- Use `entity.create` only for new entities that are genuinely additional business objects and not already represented by the template-created section entity.
- Before `update-entity-schema`, inspect the current schema snapshot from `application-create` or `application-get-info`. If `Name` already exists, reuse `Name` and do not add `UsrName`, `UsrTitle`, or `UsrCaption` unless the requirements explicitly require a separate business field.
- Use `update-entity-schema` for template-created entities and pass only `operations` (native list).
- Entity-tool success is valid only when the schema is fully materialized, immediately refreshable via `application-get-info`, and not left in a `Database update required` state.
- If the run creates a new app or extends the main section entity with approved non-inherited business fields, page sync for the generated `FormPage` and `ListPage` is mandatory before success can be reported.
- Treat a missing page-sync section in `plan.md` for such a run as a blocker in the plan, not as a reason to silently skip UI sync.
- `schema default` means the backend/entity schema contract sets the value through `default-value-source` and `default-value`.
- `ui default` means the page layer sets the value through `crt.CreateRecordRequest.defaultValues` or a handler.
- Lookup seed rows alone do not satisfy a requirement such as `UsrStatus defaults to New`.
- If the plan says `schema default` for a lookup column, use the seeded row GUID in `default-value`; never send the display caption. Preferred GUID resolution: generate UUIDs client-side via `uuid.uuid4()` and pass `Id` in seed row `values` during `create-data-binding-db`, then reuse the same UUID as `default-value`. Alternative: parse created row info from `create-data-binding-db` response log messages.
- `update-entity-schema` operations are explicit:
  - `action: "add"`
  - `action: "update"`
  - `action: "remove"`
- Omission never implies deletion.

### Related Binding Tools

- `binding.get_columns` discovers column names, UIds, and data value types for deployed schemas such as `SysModule` and `SysModuleEntity`.
- `create-data-binding-db` creates or updates a binding in DB, stores payload, and installs lookup seed data immediately.
- Schemas created earlier in the same flow are DB-first and should be queried through `binding.get_columns`; do not use raw mode.
- For lookup seed bindings, the `rows` format is a JSON string of `[{"values": {"Name": "New"}}, ...]` — no `Id` needed unless you require a deterministic GUID.
- When a seed row will be referenced later as a `default-value` for a lookup column, generate the UUID client-side and include `Id` in the row's `values`. This eliminates any need to query the DB for the GUID after seeding:

```python
import uuid, json
new_id = str(uuid.uuid4())
rows = json.dumps([
    {'values': {'Id': new_id, 'Name': 'New'}},
    {'values': {'Name': 'In Progress'}},
    {'values': {'Name': 'Done'}},
])
r = call_mcp_tool('create-data-binding-db', {
    'environment-name': 'local',
    'package-name': 'UsrMyApp',
    'schema-name': 'UsrMyStatus',
    'binding-name': 'UsrMyStatus_Lookup',
    'rows': rows,
})
# Then use `new_id` directly as `default-value` in update-entity-schema:
# 'default-value-source': 'Const', 'default-value': new_id
```
- Never pass partial `columnsJson` for lookup seed bindings.

### Parameter Validation Checklist

Before EVERY `create-lookup` call, validate:

1. ✅ `environment-name` matches registered clio env name
2. ✅ `package-name` is the string package name (NOT a GUID)
3. ✅ `schema-name` is the entity schema name (e.g., "UsrTodoStatus")
4. ✅ `title` is the display name (NOT `caption`)
5. ✅ No `Name`, `Description`, `UsrName`, `UsrTitle`, or `UsrCaption` in columns

Before EVERY `update-entity-schema` call, validate:

1. ✅ `environment-name` matches registered clio env name
2. ✅ `package-name` is the string package name (NOT a GUID)
3. ✅ `schema-name` is the entity schema name
4. ✅ `operations` is a Python **list** (NOT a JSON-encoded string)
5. ✅ Each operation uses `action` (NOT `operation`), `column-name` (NOT `name`), `type` (NOT `dataValueTypeName`), `title` (NOT `caption`), `reference-schema-name` (NOT `referenceSchemaName`)
6. ✅ `required` is a boolean (`True`/`False`), not a string
7. ✅ Schema defaults use `default-value-source` and `default-value` (kebab-case)
8. ✅ For existing/template-created entities, no `UsrName`, `UsrTitle`, or `UsrCaption` when schema already contains `Name`

Before EVERY `create-data-binding-db` call, validate:

1. ✅ `environment-name` matches registered clio env name
2. ✅ `package-name` is the string package name
3. ✅ `schema-name` is the entity schema name
4. ✅ `binding-name` is provided (e.g., "UsrTodoStatus_Lookup")
5. ✅ `rows` is a JSON **string** of `[{"values": {...}}, ...]` format
6. ✅ Lookup seed rows use `{"values": {"Name": "New"}}` — not `[{columnName, value}]` format
7. ✅ Target schema is already materialized in DB

**Pre-execution validation script:**

```bash
# Before create-lookup or update-entity-schema: check package name is set
if [[ -z "$PACKAGE_NAME" ]]; then
  echo "ERROR: PACKAGE_NAME not set"
  exit 1
fi
```

**Package Name Extraction (New Flat Format):**

Since core 8.3.4.802, MCP tools return simplified flat format. Extract `packageName` from `application-create` response:

```bash
PACKAGE_NAME=$(python3 -c "import json; d=json.load(open('/tmp/mcp-app-context.json')); print(d['packageName'])")
echo "Package Name: $PACKAGE_NAME"
```
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
- `Unsupported operation ''` → wrong JSON structure in `operations` (using JSON string instead of native list, or old {operation,column} format)

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
- Never synthesize success for `create-data-binding-db`; if the response cannot be parsed or does not contain `success=true` or `exit-code: 0`, stop with blocker.

## Steps

### 0. Check Gate R (mandatory)

```bash
scripts/check-approval-gate.sh <AppName>
```

If this fails, stop immediately.

### 1. Parse `plan.md`

Extract resolved MCP payload, runtime resolution strategy, and ordered schema sync steps.

### 2. Verify MCP reachability

Read `environment` from `.creatio-env.json`, then verify clio MCP responds:

```bash
ENV_NAME=$(python3 -c "import json; print(json.load(open('output/<AppName>/.creatio-env.json'))['environment'])")
python3 scripts/mcp_client.py application-get-list "{\"environment-name\": \"$ENV_NAME\"}" 30
```

Expected: `{"success": true, ...}`. If `success` is false, stop and report blocker.

### 3. Check if app already exists

```bash
python3 scripts/mcp_client.py application-get-list "{\"environment-name\": \"$ENV_NAME\"}" \
  | python3 -c "
import json, sys
r = json.load(sys.stdin)
apps = r.get('data', {}).get('applications', []) if r['success'] else []
match = next((a for a in apps if a.get('code') == '<AppCode>'), None)
print('exists:', match is not None)
if match:
    print(json.dumps(match, indent=2))
"
```

Use the result to branch: new-app flow (`application-create`) or existing-app flow (`application-get-info`).

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

If payload has `icon-background=auto`:
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

**See:** `context/mcp-application-tools-reference.md` for parameter reference.

For new app flow — use the two-step bash pattern (create script, then run it):

```bash
cat > /tmp/run_app_create.py << 'PYEOF'
import sys, json
sys.path.insert(0, 'scripts')
from mcp_client import call_mcp_tool

r = call_mcp_tool('application-create', {
    'environment-name': 'local',
    'name': 'APP_NAME_PLACEHOLDER',
    'code': 'APP_CODE_PLACEHOLDER',
    'template-code': 'AppFreedomUI',
    'icon-background': 'ICON_COLOR_PLACEHOLDER',
    'description': 'DESCRIPTION_PLACEHOLDER',
    'optional-template-data-json': 'TEMPLATE_DATA_PLACEHOLDER',
})
if not r['success']:
    print('ERROR:', r['raw']); sys.exit(1)
data = r['data']
if not data.get('success') or not data.get('packageUId'):
    print('ERROR: missing packageUId:', json.dumps(data)); sys.exit(1)
json.dump(data, open('/tmp/mcp-app-context.json', 'w'), indent=2)
print('OK packageUId:', data['packageUId'])
PYEOF
python3 /tmp/run_app_create.py
```

For existing app flow:
1. call `application-get-list` and find the app by `code`
2. call `application-get-info` with `app-code`
3. log the branch explicitly in the report and final status

Stop and report blocker when:
- `success=false`
- response missing `packageUId` or `entities`
- plain `ERROR: ...` text

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
- "Create Lookup Entity (create-lookup)"
- "Update Entity (update-entity-schema)"

If `plan.md` contains approved schema sync, use `scripts/mcp_client.py` (two-step pattern):

```bash
# entity.create_lookup → uses create-lookup tool
cat > /tmp/run_create_lookup.py << 'PYEOF'
import sys, json
sys.path.insert(0, 'scripts')
from mcp_client import call_mcp_tool
r = call_mcp_tool('create-lookup', {
    'environment-name': 'local',
    'package-name': 'UsrMyApp',
    'schema-name': 'UsrMyStatus',
    'title': 'My Status',
})
print(json.dumps(r, indent=2))
PYEOF
python3 /tmp/run_create_lookup.py

# entity.update → uses update-entity-schema tool
cat > /tmp/run_update_entity.py << 'PYEOF'
import sys, json
sys.path.insert(0, 'scripts')
from mcp_client import call_mcp_tool
r = call_mcp_tool('update-entity-schema', {
    'environment-name': 'local',
    'package-name': 'UsrMyApp',
    'schema-name': 'UsrMyApp',
    'operations': [
        {
            'action': 'add',
            'column-name': 'UsrStatus',
            'type': 'Lookup',
            'title': 'Status',
            'reference-schema-name': 'UsrMyStatus',
            'required': True,
        }
    ],
})
print(json.dumps(r, indent=2))
PYEOF
python3 /tmp/run_update_entity.py

# binding.create (seed data) → uses create-data-binding-db tool
cat > /tmp/run_binding.py << 'PYEOF'
import sys, json
sys.path.insert(0, 'scripts')
from mcp_client import call_mcp_tool
rows = json.dumps([
    {'values': {'Name': 'New'}},
    {'values': {'Name': 'Done'}},
])
r = call_mcp_tool('create-data-binding-db', {
    'environment-name': 'local',
    'package-name': 'UsrMyApp',
    'schema-name': 'UsrMyStatus',
    'binding-name': 'UsrMyStatus_Lookup',
    'rows': rows,
})
print(json.dumps(r, indent=2))
PYEOF
python3 /tmp/run_binding.py
```

**After EACH successful entity mutation — refresh context:**

```bash
cat > /tmp/run_get_info.py << 'PYEOF'
import sys, json
sys.path.insert(0, 'scripts')
from mcp_client import call_mcp_tool
r = call_mcp_tool('application-get-info', {'environment-name': 'local', 'app-code': 'UsrMyApp'})
if r['success'] and r['data']:
    data = r['data']
    data['contractType'] = 'short'
    data.setdefault('schemaSync', [])
    json.dump(data, open('output/UsrMyApp/mcp-application-result.json', 'w'), indent=2)
    print('OK entities:', len(data.get('entities', [])))
else:
    print('ERROR:', r['raw']); sys.exit(1)
PYEOF
python3 /tmp/run_get_info.py
```

**Or use the Python helper for complex workflows:**

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
   j. Call `page.update` with `dryRun: True` (boolean, not string) first to validate
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

**Page Body Editing — MANDATORY: use `scripts/page_body_edit.py`**

❌ NEVER write custom inline page editing scripts (e.g. `/tmp/edit_pages.py`) — `scripts/page_body_edit.py` already implements the marker-based algorithm.

```bash
# Add fields to FormPage
python3 scripts/page_body_edit.py add-form-fields \
  --input /tmp/FormPage.body.js \
  --fields '[{"name":"UsrStatus","type":"crt.ComboBox","label":"Status"},...]' \
  --output /tmp/FormPage.edited.js

# Add columns to ListPage
python3 scripts/page_body_edit.py add-list-columns \
  --input /tmp/ListPage.body.js \
  --columns '[{"code":"PDS_UsrStatus","caption":"Status","type":"crt.ComboBox"},...]' \
  --output /tmp/ListPage.edited.js

# Validate result
python3 scripts/page_body_edit.py validate --input /tmp/FormPage.edited.js
```

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

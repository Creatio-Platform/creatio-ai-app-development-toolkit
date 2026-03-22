# MCP Application Tools Reference Guide

> **⚠️ Transport Notice:** All MCP calls use **clio stdio transport** via `scripts/mcp_client.py`, not HTTP/SSE.
> The HTTP endpoint examples in this file are **parameter reference only** — do NOT copy curl commands as execution patterns.
> Use `python3 scripts/mcp_client.py <tool-name> '<args-json>'` for all actual calls.
> Tool names use dashes: `application-create`, `create-lookup`, `update-entity-schema` (not dots).

## Overview

MCP (Model Context Protocol) application tools provide DB-first integration for Creatio composable app creation and schema management.

## Authentication

Credentials are stored in `.creatio-env.json` and passed via `environment-name` parameter to all clio MCP tools.

## Parameter Naming Convention

**CRITICAL:** All clio MCP entity and schema tools use **kebab-case** parameter names.

```
✅ Correct (create-lookup):  "schema-name": "UsrTodoList"
❌ Wrong:                    "name": "UsrTodoList"
❌ Wrong:                    "schemaName": "UsrTodoList"
```

**Parameters by tool:**
- `create-lookup` — `package-name`, `schema-name`, `title`
- `update-entity-schema` — `package-name`, `schema-name`, `operations` (list)
- `create-data-binding-db` — `package-name`, `schema-name`, `binding-name`, `rows` (JSON string)
- `page-get` / `page-update` — `schemaName`, `environmentName` (camelCase, page tools are different!)
- `page-update` extra params: `body` (string, required), `dryRun` (boolean `True`/`False`, optional)

**Why this matters:** clio MCP SDK maps JSON argument names to C# parameters. Names must match exactly (case-sensitive). Mismatch causes a silent error:
```
An error occurred invoking 'create-lookup'.
```

**Boolean parameters** (e.g. `dryRun`, `required`, `extendParent`) MUST be native booleans (`True`/`False` in Python), NOT strings (`'true'`/`'false'`). Passing a string causes MCP SDK deserialization failure with the same generic error.

## Response Format

`call_mcp_tool` parses the clio stdio response automatically and returns a dict:

```python
r = call_mcp_tool('application-get-list', {'environment-name': 'local'})
# r['data'] — parsed result dict
# r['raw']  — raw text response
```

## Workflow Sequence

### 1. Initialize Session

`scripts/mcp_client.py` manages the clio stdio process automatically. No explicit initialization step is needed.

```python
from scripts.mcp_client import call_mcp_tool
# Session is established on first call
r = call_mcp_tool('tools/list', {})
```

### 2. List Available Tools

**Purpose:** Verify required tools are available.

```python
r = call_mcp_tool('tools/list', {})
# Or via CLI:
python3 scripts/mcp_client.py tools/list '{}' 30
```


```

**Expected Output:**

```
application-create
application-get-info
application-get-list
create-entity-schema
create-lookup
update-entity-schema
create-data-binding-db
page-list
page-get
page-update
```

### 3. Create Application (application-create)

**Purpose:** Create new Creatio application with initial package and entity.

```python
from mcp_client import call_mcp_tool
r = call_mcp_tool('application-create', {
    'environment-name': 'local',
    'name': 'Events',
    'code': 'UsrEvents',
    'template-code': 'AppFreedomUI',
    'icon-background': '#1F5F8B',
    'description': 'A lightweight tool for managing events',
    'optional-template-data-json': '{"useExistingEntitySchema":false,"entitySchemaName":"","appSectionDescription":"Manage events","useAIContentGeneration":false}',
}, timeout=180)
if not r['success']:
    raise RuntimeError(f"application-create failed: {r['raw']}")
data = r['data']
package_name = data['packageName']
main_entity_name = data['entities'][0]['name']
```

**Required parameters:**
- `environment-name` — registered clio environment name (NOT a URL)
- `name` — display name
- `code` — application code (e.g., "UsrEvents")
- `template-code` — template code: `AppFreedomUI` (NOT `templateCode`)
- `icon-background` — hex color (NOT `iconBackground`)

**Optional parameters:**
- `description`
- `optional-template-data-json` — JSON string (NOT `optionalTemplateDataJson`)
- `icon-id` — GUID or `"auto"`

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

**Canonical main-entity rule:**
- For a new Freedom UI app, `application.create` materializes the initial section entity whose schema name normally matches the app code, for example `code=UsrTodoList` → entity `UsrTodoList`.
- If the app has one primary record type, treat that template-created entity as the canonical main entity and extend it via `update-entity-schema`.
- Use `entity.create` only for additional business objects that are distinct from the template-created section records. Do not create a synonym entity such as `UsrTodoTask` beside `UsrTodoList` for the same records.

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

```python
r = call_mcp_tool('application-get-info', {
    'environment-name': 'local',
    'app-code': 'UsrEvents',
})
```

**Update Context After Schema Change:**

```python
r = call_mcp_tool('application-get-info', {
    'environment-name': 'local',
    'app-code': 'UsrEvents',
})
data = r['data']
data['contractType'] = 'short'
data.setdefault('schemaSync', [])
data['schemaSync'].append({
    'tool': 'create-lookup',
    'target': 'UsrEventStatus',
    'status': 'success',
})
data.setdefault('editableContext', {})
json.dump(data, open('output/Events/mcp-application-result.json', 'w'), indent=2)
```

**Critical Pattern:** Always call `application-get-info` after each successful entity mutation (`create-lookup`, `update-entity-schema`) and overwrite `mcp-application-result.json`.

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

```python
r = call_mcp_tool('application-get-list', {'environment-name': 'local'})
apps = r['data']['applications']
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

```python
r = call_mcp_tool('application-get-list', {'environment-name': 'local'})
app_code = next(a['code'] for a in r['data']['applications'] if a['name'] == 'Events')

r = call_mcp_tool('application-get-info', {'environment-name': 'local', 'app-code': app_code})
```

### 3.1. Extract Package Name for Entity Operations

Entity tools (`create-lookup`, `update-entity-schema`, `create-data-binding-db`) use `package-name` (string), NOT a GUID.

Extract from `application-create` response:

```python
data = r['data']  # from call_mcp_tool('application-create', ...)
package_name = data['packageName']     # e.g., "UsrTodoList"
main_entity_name = data['entities'][0]['name']  # e.g., "UsrTodoList"
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
      "caption": "Todo"
    }
  ]
}
```

### 5. Create Entity (create-entity-schema)

**Purpose:** Create new BaseEntity-derived entity schema in Creatio database. Use only for entities that are NOT lookups.

**Tool name:** `create-entity-schema`

**When to Use:**
- Creating entities that inherit from BaseEntity
- For lookup entities, use `create-lookup` instead (kebab params, inherits from BaseLookup)

**columnsJson supported types:** `ShortText`, `MediumText`, `LongText`, `MaxSizeText`, `Integer`, `Float`, `Boolean`, `Date`, `DateTime`, `Time`, `Lookup` (requires `reference-schema-name`)

**Example:**

```python
r = call_mcp_tool('create-entity-schema', {
    'environment-name': 'local',
    'package-name': 'UsrTodoList',
    'schema-name': 'UsrTodoList',
    'title': 'Todo',
    'columns': [
        {'name': 'UsrDescription', 'type': 'LongText', 'title': 'Description'},
    ],
})
```

**After Success:** Call `application-get-info` to refresh context.

**After Success:** 
1. Call `application-get-info` to refresh application context
2. Overwrite `mcp-application-result.json` with updated context

**Note:** For lookup entities, use `create-lookup` instead — it hardcodes `BaseLookup` as parent and uses simpler parameters.

### 6. Create Lookup Entity (create-lookup)

**Purpose:** Create a BaseLookup-based entity in the specified package.

**Tool name:** `create-lookup`

**Required parameters:**
- `environment-name` — registered clio environment name
- `package-name` — package string name (e.g., "UsrTodoList") — **NOT a GUID**
- `schema-name` — entity schema name (e.g., "UsrTodoStatus") — NOT `name`
- `title` — display name — NOT `caption`

**Lookup Display Rule:**
- `BaseLookup` already provides inherited `Name` and `Description`.
- Never send `Name`, `Description`, `UsrName`, `UsrTitle`, or `UsrCaption` in columns.
- `Name` must remain the lookup `PrimaryDisplayColumn`; otherwise lookup values appear blank in UI controls.

**Lookup Validation Rule:**
- After `create-lookup` succeeds, call `application-get-info` and verify the entity is fully materialized.
- If `Name` is not present in the schema snapshot, stop with blocker.

**Example:**

```python
r = call_mcp_tool('create-lookup', {
    'environment-name': 'local',
    'package-name': 'UsrTodoList',   # ✅ string name, NOT GUID
    'schema-name': 'UsrTodoStatus',  # ✅ NOT 'name'
    'title': 'Todo Status',          # ✅ NOT 'caption'
})
```

**After Success:** Immediately call `application-get-info` to refresh context and verify the entity is fully materialized (not in "Database update required" state).

### 7. Update Entity (update-entity-schema)

**Purpose:** Add, update, or remove columns on an existing entity.

**Tool name:** `update-entity-schema`

**Required parameters:**
- `environment-name` — registered clio environment name
- `package-name` — package string name — **NOT a GUID**, NOT `packageUId`
- `schema-name` — entity schema name

**operations parameter** — Python **list** of operation objects (NOT a JSON string, NOT `operationsJson`):

| Field | Value | Notes |
|-------|-------|-------|
| `action` | `"add"` / `"modify"` / `"remove"` | Required. NOT `"operation"`, NOT `"addColumn"` |
| `column-name` | `"UsrStatus"` | Required. NOT `"name"` |
| `new-name` | `"UsrNewName"` | Optional. For rename operations |
| `type` | `"Lookup"` / `"MediumText"` / `"Date"` / etc. | Required for `add`. NOT `"dataValueTypeName"` |
| `title` | `"Status"` | Optional. NOT `"caption"` |
| `description` | `"Task status"` | Optional. Column description |
| `reference-schema-name` | `"UsrTodoStatus"` | Required for Lookup type. NOT `"referenceSchemaName"` |
| `required` | `True` / `False` | Optional. Python boolean |
| `indexed` | `True` / `False` | Optional. Create DB index |
| `cloneable` | `True` / `False` | Optional. Include when cloning records |
| `track-changes` | `True` / `False` | Optional. Track column value changes |
| `default-value` | `"<guid>"` | Optional. Constant default value. NOT `"defaultValue"` |
| `default-value-source` | `"Const"` / `"None"` | Optional. NOT `"defaultValueSource"` |
| `multiline-text` | `True` / `False` | Optional. Multi-line text flag |
| `localizable-text` | `True` / `False` | Optional. Localizable text flag |
| `accent-insensitive` | `True` / `False` | Optional. Accent-insensitive search flag |
| `masked` | `True` / `False` | Optional. Masked input flag |
| `format-validated` | `True` / `False` | Optional. Format validation flag |
| `use-seconds` | `True` / `False` | Optional. Show seconds for DateTime |
| `simple-lookup` | `True` / `False` | Optional. Simple lookup mode |
| `cascade` | `True` / `False` | Optional. Cascade delete for lookups |
| `do-not-control-integrity` | `True` / `False` | Optional. Skip referential integrity checks |

**Default-capable column example:**

```python
r = call_mcp_tool('update-entity-schema', {
    'environment-name': 'local',
    'package-name': 'UsrTodoList',    # ✅ string name, NOT GUID
    'schema-name': 'UsrTodoList',
    'operations': [                   # ✅ native list, NOT 'operationsJson'
        {
            'action': 'add',                              # ✅ NOT 'operation'/'addColumn'
            'column-name': 'UsrStatus',                   # ✅ NOT 'name'
            'type': 'Lookup',                             # ✅ NOT 'dataValueTypeName'
            'title': 'Status',                            # ✅ NOT 'caption'
            'reference-schema-name': 'UsrTodoStatus',     # ✅ NOT 'referenceSchemaName'
            'required': True,
            'default-value-source': 'Const',
            'default-value': '<seeded-new-guid>',
        },
        {
            'action': 'add',
            'column-name': 'UsrDueDate',
            'type': 'Date',
            'title': 'Due Date',
        },
        {
            'action': 'add',
            'column-name': 'UsrDescription',
            'type': 'MediumText',
            'title': 'Description',
        },
    ],
})
```

**After Success:** Call `application-get-info` and update context.

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
- Prepare column mappings for create-data-binding-db
- Validate schema deployment status

**Example:**

```python
r = call_mcp_tool('binding-get-columns', {
    'environment-name': 'local',
    'schema-name': 'Contact',
})
columns = r['data']
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

### 9. Create Data Binding (create-data-binding-db)

**Purpose:** Seed lookup data or create data bindings in the DB and install them immediately.

**Tool name:** `create-data-binding-db`

**Required parameters:**
- `environment-name` — registered clio environment name
- `package-name` — package string name — **NOT a GUID**
- `schema-name` — entity schema name (e.g., "UsrTodoStatus")
- `binding-name` — binding folder name (e.g., "UsrTodoStatus_Lookup") — NOT `bindingName`
- `rows` — JSON **string** of `[{"values": {"Name": "New"}}, ...]` format — NOT `rowsJson`

**rows format:**
```json
[
  {"values": {"Name": "New"}},
  {"values": {"Name": "In Progress"}},
  {"values": {"Name": "Done"}},
  {"values": {"Name": "Cancelled"}}
]
```

This format is **different** from the old `binding.create` HTTP format. There are no `columnName`/`value` pairs. When a seed row does not include `Id`, the tool auto-generates a GUID server-side.

**Deterministic GUID for schema defaults:** When a seed row will be referenced later as `default-value` for a lookup column, generate UUID client-side and include `Id` in the row's `values`:

```json
[
  {"values": {"Id": "dda4901c-f62a-4ef9-be7e-dc88dc0aad52", "Name": "New"}},
  {"values": {"Name": "In Progress"}},
  {"values": {"Name": "Done"}}
]
```

**Example: Lookup Seed Data**

```python
import json
rows = json.dumps([
    {'values': {'Name': 'New'}},
    {'values': {'Name': 'In Progress'}},
    {'values': {'Name': 'Done'}},
    {'values': {'Name': 'Cancelled'}},
])
r = call_mcp_tool('create-data-binding-db', {
    'environment-name': 'local',
    'package-name': 'UsrTodoList',          # ✅ string name, NOT GUID
    'schema-name': 'UsrTodoStatus',
    'binding-name': 'UsrTodoStatus_Lookup', # ✅ NOT 'bindingName', NOT 'dataName'
    'rows': rows,                           # ✅ JSON string, NOT 'rowsJson'
})
```

**Example: Seed Data with Schema Default**

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
    'package-name': 'UsrTodoList',
    'schema-name': 'UsrTodoStatus',
    'binding-name': 'UsrTodoStatus_Lookup',
    'rows': rows,
})

# Then use `new_id` directly in update-entity-schema:
r2 = call_mcp_tool('update-entity-schema', {
    'environment-name': 'local',
    'package-name': 'UsrTodoList',
    'schema-name': 'UsrTodoList',
    'operations': [{
        'action': 'add',
        'column-name': 'UsrStatus',
        'type': 'Lookup',
        'title': 'Status',
        'reference-schema-name': 'UsrTodoStatus',
        'required': True,
        'default-value-source': 'Const',
        'default-value': new_id,
    }],
})
```

**Response Format:**
```json
{
  "exit-code": 0,
  "execution-log-messages": [
    {"message-type": "Info", "value": "Created row: dda4901c-... (Name=New)"},
    {"message-type": "Info", "value": "Created row: 7b3f22a1-... (Name=In Progress)"},
    {"message-type": "Info", "value": "Created row: a1c99ef3-... (Name=Done)"},
    {"message-type": "Info", "value": "Done"}
  ]
}
```

The response log messages include each created row's `Id` and column values. When deterministic GUIDs were provided via client-side `Id`, the same values appear in the response.

## Error Handling

### Common Errors

**1. Tool Invocation Error**

```json
{
  "result": {
    "content": [{"type": "text", "text": "An error occurred invoking 'create-lookup'."}],
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

**Default Types — Mandatory Policy:**

- `schema default` means the backend/entity schema contract sets the value through `default-value-source` and `default-value` in `update-entity-schema` operations.
- `ui default` means the page layer sets the value through `crt.CreateRecordRequest.defaultValues` or a handler.
- Lookup seed rows alone do not satisfy a requirement such as `UsrStatus defaults to New`. Every `defaults to X` requirement must have an explicit `schema default` or `ui default` implementation step.

## Common Pitfalls

### ❌ Wrong Parameter Names — Entity Tools

**Problem:** `"An error occurred invoking 'create-lookup'"` or `"Package is required."` or `"Schema title is required."`

**Causes and fixes:**

| ❌ Wrong | ✅ Correct | Tool |
|---------|-----------|------|
| `packageUId` (GUID) | `package-name` (string) | `create-lookup`, `update-entity-schema`, `create-data-binding-db` |
| `name` | `schema-name` | `create-lookup` |
| `caption` | `title` | `create-lookup` |
| `operationsJson` (string) | `operations` (list) | `update-entity-schema` |
| `operation: "addColumn"` | `action: "add"` | each operation in `operations` |
| `name: "UsrField"` (in op) | `column-name: "UsrField"` | each operation in `operations` |
| `dataValueTypeName: "Lookup"` | `type: "Lookup"` | each operation in `operations` |
| `caption: "Status"` (in op) | `title: "Status"` | each operation in `operations` |
| `referenceSchemaName` | `reference-schema-name` | each operation in `operations` |
| `isRequired` | `required` (boolean) | each operation in `operations` |
| `defaultValueSource` | `default-value-source` | each operation in `operations` |
| `defaultValue` | `default-value` | each operation in `operations` |
| `rowsJson` | `rows` | `create-data-binding-db` |
| `bindingName` | `binding-name` | `create-data-binding-db` |
| `[[{columnName,value}]]` format | `[{"values":{...}}]` format | `create-data-binding-db` rows |

### ❌ Wrong Parameter Names — Application Tools

**Problem:** `"template-code is required."` or `"icon-background is required."`

**Causes and fixes:**

| ❌ Wrong | ✅ Correct |
|---------|-----------|
| `templateCode` | `template-code` |
| `iconBackground` | `icon-background` |
| `optionalTemplateDataJson` | `optional-template-data-json` |

### ❌ operations Passed as JSON String

**Problem:** `update-entity-schema` silently ignores operations or throws error.

**Cause:** Passing `json.dumps([...])` instead of a native Python list.

```python
# ❌ WRONG
ops = json.dumps([{'action': 'add', ...}])
call_mcp_tool('update-entity-schema', {'operations': ops})  # string!

# ✅ CORRECT
call_mcp_tool('update-entity-schema', {
    'operations': [{'action': 'add', ...}]  # native list
})
```

### ❌ Not Refreshing Context After Mutations

**Problem:** Schema exists in DB but not visible in `application-get-info`

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

```python
import json
import sys
sys.path.insert(0, 'scripts')
from mcp_client import call_mcp_tool

# 1. Create application
r = call_mcp_tool('application-create', {
    'environment-name': 'local',
    'name': 'MyApp',
    'code': 'UsrMyApp',
    'template-code': 'AppFreedomUI',
    'icon-background': '#1F5F8B',
}, timeout=180)
data = r['data']
package_name = data['packageName']
json.dump(data | {'contractType': 'short', 'schemaSync': [], 'editableContext': {}},
          open('output/MyApp/mcp-application-result.json', 'w'), indent=2)

# 2. Create lookup
r2 = call_mcp_tool('create-lookup', {
    'environment-name': 'local',
    'package-name': package_name,
    'schema-name': 'UsrMyStatus',
    'title': 'My Status',
})

# 3. Seed lookup
rows = json.dumps([{'values': {'Name': 'New'}}, {'values': {'Name': 'Done'}}])
r3 = call_mcp_tool('create-data-binding-db', {
    'environment-name': 'local',
    'package-name': package_name,
    'schema-name': 'UsrMyStatus',
    'binding-name': 'UsrMyStatus_Lookup',
    'rows': rows,
})

# 4. Add columns to main entity
r4 = call_mcp_tool('update-entity-schema', {
    'environment-name': 'local',
    'package-name': package_name,
    'schema-name': 'UsrMyApp',
    'operations': [
        {'action': 'add', 'column-name': 'UsrStatus', 'type': 'Lookup',
         'title': 'Status', 'reference-schema-name': 'UsrMyStatus', 'required': True},
    ],
})

# 5. Refresh context
r5 = call_mcp_tool('application-get-info', {'environment-name': 'local', 'app-code': 'UsrMyApp'})
ctx = r5['data']
ctx['contractType'] = 'short'
ctx.setdefault('schemaSync', [])
json.dump(ctx, open('output/MyApp/mcp-application-result.json', 'w'), indent=2)
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

## Page Tools

### 10. List Pages (page-list)

**Purpose:** Discover Freedom UI pages belonging to a package.

**Tool name:** `page-list`

**⚠️ Parameter naming:** Page tools use **camelCase** parameters, unlike entity tools which use kebab-case.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `environmentName` | string | **Yes** | Registered clio environment name |
| `packageName` | string | **Yes** | Package name (e.g., "UsrTodoList") |

**Example:**

```python
r = call_mcp_tool('page-list', {
    'environmentName': 'local',
    'packageName': 'UsrTodoList',
})
# Response: list of page schemas in the package
```

### 11. Get Page (page-get)

**Purpose:** Read the full JavaScript body of a Freedom UI page schema.

**Tool name:** `page-get`

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `environmentName` | string | **Yes** | Registered clio environment name |
| `schemaName` | string | **Yes** | Page schema name (e.g., "UsrTodoList_FormPage") |

**Response (success):**

```json
{
  "success": true,
  "schemaName": "UsrTodoList_FormPage",
  "schemaUId": "eda909b1-...",
  "packageName": "UsrTodoList",
  "parentSchemaName": "BaseModulePage",
  "body": "define(\"UsrTodoList_FormPage\", ..."
}
```

**Example:**

```python
r = call_mcp_tool('page-get', {
    'environmentName': 'local',
    'schemaName': 'UsrTodoList_FormPage',
})
body = r['data']['body']  # Full JS body with markers
```

**Known Issue:** `page-get` may fail with "Error reading JObject from JsonReader" for template-created pages whose bodies haven't been loaded by the designer service. Workaround: read body directly from PostgreSQL `SysSchemaContent` table (ContentType=0, Content column as UTF-8).

### 12. Update Page (page-update)

**Purpose:** Save a modified Freedom UI page body.

**Tool name:** `page-update`

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `environmentName` | string | **Yes** | Registered clio environment name |
| `schemaName` | string | **Yes** | Page schema name |
| `body` | string | **Yes** | Complete JS body with all 8 marker pairs |
| `dryRun` | boolean | No | `True` to validate without saving (Python `True`/`False`, **NOT** string `"true"`) |

**⚠️ Boolean Parameters:** `dryRun` must be Python `True`/`False`. String `"true"`/`"false"` causes MCP SDK deserialization failure.

**Response (success):**

```json
{
  "success": true,
  "schemaName": "UsrTodoList_FormPage",
  "bodyLength": 5236,
  "dryRun": false
}
```

**Workflow — always validate first:**

```python
# Step 1: Dry run to validate markers and structure
r = call_mcp_tool('page-update', {
    'environmentName': 'local',
    'schemaName': 'UsrTodoList_FormPage',
    'body': new_body,
    'dryRun': True,   # ✅ Python boolean, NOT "true"
})
assert r['data']['success'], f"Dry run failed: {r['data'].get('error')}"

# Step 2: Save
r = call_mcp_tool('page-update', {
    'environmentName': 'local',
    'schemaName': 'UsrTodoList_FormPage',
    'body': new_body,
})
```

**Required marker pairs in body (all 8 must be present):**

```
/**SCHEMA_DEPS*/ ... /**SCHEMA_DEPS*/
/**SCHEMA_ARGS*/ ... /**SCHEMA_ARGS*/
/**SCHEMA_VIEW_CONFIG_DIFF*/ ... /**SCHEMA_VIEW_CONFIG_DIFF*/
/**SCHEMA_VIEW_MODEL_CONFIG*/ or /**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/ ... (matching close)
/**SCHEMA_MODEL_CONFIG*/ or /**SCHEMA_MODEL_CONFIG_DIFF*/ ... (matching close)
/**SCHEMA_HANDLERS*/ ... /**SCHEMA_HANDLERS*/
/**SCHEMA_CONVERTERS*/ ... /**SCHEMA_CONVERTERS*/
/**SCHEMA_VALIDATORS*/ ... /**SCHEMA_VALIDATORS*/
```

**Known Issue:** `page-update` save (non-dryRun) may fail with "Error reading JObject" for template-created pages — same root cause as `page-get`. The tool internally calls `GetSchema` to read existing schema before saving, and this call returns empty. Workaround: update page body directly in PostgreSQL `SysSchemaContent` table using psycopg2.

**Direct DB Workaround Example:**

```python
import psycopg2, datetime
conn = psycopg2.connect(dbname='dev', user='postgres', host='localhost', port=5432)
cur = conn.cursor()
now = datetime.datetime.now(datetime.UTC)
cur.execute("""
    UPDATE "SysSchemaContent" sc
    SET "Content" = %s, "ModifiedOn" = %s
    FROM "SysSchema" s
    WHERE s."Id" = sc."SysSchemaId"
      AND s."Name" = %s AND sc."ContentType" = 0
""", (new_body.encode('utf-8'), now, 'UsrTodoList_FormPage'))
cur.execute("""
    UPDATE "SysSchema"
    SET "ClientContentModifiedOn" = %s, "ModifiedOn" = %s
    WHERE "Name" = %s
""", (now, now, 'UsrTodoList_FormPage'))
conn.commit()
```

### Page Tool Parameter Convention

| Tool Category | Parameter Style | Example |
|--------------|----------------|---------|
| Entity tools | kebab-case | `environment-name`, `schema-name`, `package-name` |
| Page tools | camelCase | `environmentName`, `schemaName`, `packageName` |

Mixing these styles causes silent failures or "Error reading JObject" errors.

---

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
      "tool": "create-lookup",
      "target": "UsrEventStatus",
      "status": "success",
      "entityUId": "..."
    }
  ],
  "editableContext": {}
}
```

**Data Value Type Names:**

Primary types:
- `Guid` - globally unique identifier
- `Text` - generic text (defaults to MediumText)
- `Integer` - whole number
- `Boolean` - true/false
- `DateTime` - date and time
- `Lookup` - reference to another entity (requires `reference-schema-name`)

Text variants (with aliases):
- `ShortText` (alias: `Text50`) - up to 50 chars
- `MediumText` (alias: `Text250`) - up to 250 chars
- `LongText` (alias: `Text500`) - up to 500 chars
- `MaxSizeText` (alias: `TextUnlimited`) - unlimited text
- `PhoneNumber` - phone number format
- `WebLink` - URL format
- `Email` - email address format
- `RichText` - rich/HTML text

Date/Time variants:
- `DateTime` - date and time
- `Date` - date only
- `Time` - time only

Numeric variants:
- `Integer` - whole number
- `Float` (alias: `Decimal2`) - decimal with 2 places
- `Decimal0` through `Decimal8` - decimal with 0-8 places
- `Currency0` through `Currency3` - currency with 0-3 decimal places

Both the primary name and alias are accepted (e.g., `ShortText` and `Text50` are equivalent).

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

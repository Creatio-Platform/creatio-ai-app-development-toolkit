# MCP Application Tools Reference Guide

> **⚠️ Transport Notice:** All MCP calls use **clio stdio transport** via `scripts/mcp_client.py`, not HTTP/SSE.
> The HTTP endpoint examples in this file are **parameter reference only** — do NOT copy curl commands as execution patterns.
> Use `python3 scripts/mcp_client.py <tool-name> '<args-json>'` for all actual calls.
> Tool names use dashes: `application-create`, `create-lookup`, `update-entity-schema` (not dots).
> Supported released runtime is `clio` `8.0.2.37+`. `CLIO_CMD` may override the executable path, but it must still resolve to a compatible released version.

## Overview

MCP (Model Context Protocol) application tools provide DB-first integration for Creatio composable app creation and schema management.

## Authentication

Standard ADAC flow stores credentials in `.creatio-env.json` and passes the registered environment via `environment-name`. Some tools also accept explicit `uri` / `login` / `password` connection overrides.

## Parameter Naming Convention

**CRITICAL:** All clio MCP entity and schema tools use **kebab-case** parameter names.

```
✅ Correct (create-lookup):  "schema-name": "UsrTodoList"
❌ Wrong:                    "name": "UsrTodoList"
❌ Wrong:                    "schemaName": "UsrTodoList"
```

**Parameters by tool:**
- `schema-sync` — `environment-name`, `package-name`, `operations` (array of batch operations)
- `page-sync` — `environment-name`, `pages` (array with optional `resources`), `validate` (bool), `verify` (bool)
- `create-lookup` — `package-name`, `schema-name`, `title`
- `update-entity-schema` — `package-name`, `schema-name`, `operations` (list)
- `create-data-binding-db` — `package-name`, `schema-name`, `binding-name`, `rows` (JSON string)
- `component-info` — `component-type` (optional), `search` (optional)
- `page-get` — `schema-name` (required), `environment-name` (optional)
- `page-update` — `schema-name`, `body` (required); `resources` (JSON string, optional), `dry-run` (boolean, optional), `environment-name` (optional)
- `page-list` — `package-name`, `search-pattern`, `limit`, `environment-name` (all optional)
- `application-delete` — `app-name` (required) plus either `environment-name` or explicit `uri` / `login` / `password`

**All parameters use kebab-case.** No exceptions.

**Why this matters:** clio MCP SDK maps JSON argument names to C# parameters. Names must match exactly (case-sensitive). Mismatch causes a silent error:
```
An error occurred invoking 'create-lookup'.
```

**Boolean parameters** (e.g. `dry-run`, `required`, `extend-parent`) MUST be native booleans (`True`/`False` in Python), NOT strings (`'true'`/`'false'`). Passing a string causes MCP SDK deserialization failure with the same generic error.

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
application-delete
schema-sync
page-sync
create-entity-schema
create-lookup
update-entity-schema
create-data-binding-db
component-info
page-list
page-get
page-update
```

> **Preferred tools:** Use `schema-sync` instead of individual `create-lookup` / `create-data-binding-db` / `update-entity-schema` calls. Use `page-sync` instead of sequential `page-update` calls. Individual tools remain available as fallback and for read-only operations (`page-get`, `page-list`).

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
package_name = data['package-name']
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
  "package-u-id": "cdb130a9-8c77-4e80-ad1b-529cc23a750a",
  "package-name": "UsrEvents",
  "entities": [
    {
      "uId": "688a3176-2830-45d7-bfbb-18e922600e7b",
      "name": "UsrEvents",
      "caption": "Events",
      "columns": [
        {
          "name": "Name",
          "caption": "Name",
          "dataValueTypeName": "MediumText"
        }
      ]
    }
  ]
}
```

**Canonical main-entity rule:**
- For a new Freedom UI app, `application-create` materializes the initial section entity whose schema name normally matches the app code, for example `code=UsrTodoList` → entity `UsrTodoList`.
- If the app has one primary record type, treat that template-created entity as the canonical main entity and extend it via `update-entity-schema`.
- Use `create-entity-schema` only for additional business objects that are distinct from the template-created section records. Do not create a synonym entity such as `UsrTodoTask` beside `UsrTodoList` for the same records.

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

### 4. Get Application Info (application-get-info)

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

**Context Refresh Pattern:** Call `application-get-info` once after all entity mutations complete (after `schema-sync` batch or after all individual entity tool calls) and overwrite `mcp-application-result.json`. Per-mutation refresh is no longer required when using `schema-sync`.

### 4.1. List Applications (application-get-list)

**Purpose:** Discover existing Creatio applications for update workflows.

**Tool Signature:**
```
application-get-list({'environment-name': 'local'})
```

**Use Cases:**
- Discover application IDs before calling `application-get-info`
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

**Integration with application-get-info:**

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
package_name = data['package-name']     # e.g., "UsrTodoList"
main_entity_name = data['entities'][0]['name']  # e.g., "UsrTodoList"
```

**Response Format Structure:**
```json
{
  "success": true,
  "package-u-id": "597944b2-c71f-4cdb-9510-0216c1e214a6",
  "package-name": "UsrTodoList",
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

> **Prefer `schema-sync`:** When creating lookups as part of a larger schema workflow, use `schema-sync` to batch all operations (create-lookup + seed + update-entity) into a single MCP call.

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
- After `create-lookup` succeeds, verify the entity is fully materialized.
- If `Name` is not present in the schema snapshot, stop with blocker.
- Context refresh (`application-get-info`) is needed only once after all entity mutations — not after each individual call when using `schema-sync`.

**Example:**

```python
r = call_mcp_tool('create-lookup', {
    'environment-name': 'local',
    'package-name': 'UsrTodoList',   # ✅ string name, NOT GUID
    'schema-name': 'UsrTodoStatus',  # ✅ NOT 'name'
    'title': 'Todo Status',          # ✅ NOT 'caption'
})
```

**After Success:** Refresh context with `application-get-info` once all entity mutations are complete.

### 7. Update Entity (update-entity-schema)

**Purpose:** Add, update, or remove columns on an existing entity.

> **Prefer `schema-sync`:** When updating entities as part of a workflow with lookups and seed data, use `schema-sync` to batch all operations into a single MCP call.

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

**After Success:** Refresh context with `application-get-info` once all entity mutations are complete.

### 8. Schema Inspection Tools

**Purpose:** Discover column names, UIds, and data types for deployed entities (e.g., Contact, SysModule, SysModuleEntity).

#### `get-entity-schema-properties`

**Required parameters (kebab-case):**
- `environment-name` — registered clio environment name
- `package-name` — package string name (NOT a GUID)
- `schema-name` — entity schema name (e.g., `Contact`, `UsrTodoList`)

**Example:**

```python
r = call_mcp_tool('get-entity-schema-properties', {
    'environment-name': 'local',
    'package-name': 'UsrMyApp',
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

#### `get-entity-schema-column-properties`

Returns detailed metadata for a single column.

**Required parameters (kebab-case):**
- `environment-name`, `package-name`, `schema-name` — same as above
- `column-name` — column to inspect, e.g. `UsrStatus`

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

This format is **different** from old HTTP binding formats. There are no `columnName`/`value` pairs. When a seed row does not include `Id`, the tool auto-generates a GUID server-side.

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

## Composite Tools (Preferred)

### 9a. Schema Sync (schema-sync)

**Purpose:** Batch multiple schema operations (create lookups, seed data, create entities, update entities) into a single MCP call. Reduces round-trips, lock acquisitions, and sleep overhead.

**Tool name:** `schema-sync`

**Required parameters:**
- `environment-name` — registered clio environment name
- `package-name` — package string name (e.g., "UsrTodoList") — **NOT a GUID**
- `operations` — ordered array of schema operations

**Operation types:**

| type | Description | Required fields |
|------|-------------|----------------|
| `create-lookup` | Create BaseLookup entity | `schema-name`, `title` |
| `create-entity` | Create entity with custom parent | `schema-name`, `title`, `parent-schema-name` |
| `update-entity` | Add/modify/remove columns | `schema-name`, `update-operations` |

**Operation fields:**

| Field | Type | Used in | Description |
|-------|------|---------|-------------|
| `type` | string | all | `create-lookup`, `create-entity`, or `update-entity` |
| `schema-name` | string | all | Target entity schema name |
| `title` | string | create-* | Display name |
| `parent-schema-name` | string | create-entity | Parent schema (e.g., "BaseEntity") |
| `extend-parent` | bool | create-entity | Create replacement schema |
| `columns` | array | create-* | Initial columns for new entity |
| `update-operations` | array | update-entity | Column mutation operations (same format as `update-entity-schema` `operations`) |
| `seed-rows` | array | create-* | Rows to seed after creating. Each: `{"values": {"Name": "New"}}` |

**Execution behavior:**
- Operations execute in array order within a single lock acquisition
- Stops on first failure (subsequent operations may depend on earlier ones)
- Seed rows for an operation are inserted immediately after that operation succeeds
- Single Thread.Sleep at the end (not per operation)

**Example:**

```python
import uuid, json
new_id = str(uuid.uuid4())
r = call_mcp_tool('schema-sync', {
    'environment-name': 'local',
    'package-name': 'UsrTodoList',
    'operations': [
        {
            'type': 'create-lookup',
            'schema-name': 'UsrTodoStatus',
            'title': 'Todo Status',
            'seed-rows': [
                {'values': {'Id': new_id, 'Name': 'New'}},
                {'values': {'Name': 'In Progress'}},
                {'values': {'Name': 'Done'}},
            ],
        },
        {
            'type': 'update-entity',
            'schema-name': 'UsrTodoList',
            'update-operations': [
                {
                    'action': 'add',
                    'column-name': 'UsrStatus',
                    'type': 'Lookup',
                    'title': 'Status',
                    'reference-schema-name': 'UsrTodoStatus',
                    'required': True,
                    'default-value-source': 'Const',
                    'default-value': new_id,
                },
                {
                    'action': 'add',
                    'column-name': 'UsrDueDate',
                    'type': 'Date',
                    'title': 'Due Date',
                },
            ],
        },
    ],
})
```

**Response:**

```json
{
  "success": true,
  "results": [
    {"operation": "create-lookup", "schema-name": "UsrTodoStatus", "success": true},
    {"operation": "seed-data", "schema-name": "UsrTodoStatus", "success": true},
    {"operation": "update-entity", "schema-name": "UsrTodoList", "success": true}
  ]
}
```

**After Success:** Call `application-get-info` once to refresh full context.

### 9b. Page Sync (page-sync)

**Purpose:** Update multiple Freedom UI page schemas in a single MCP call with built-in validation.

**Tool name:** `page-sync`

**⚠️ Parameter naming:** `page-sync` uses the same **kebab-case** request contract as the individual page tools: `environment-name`, `schema-name`, `search-pattern`, `package-name`, `dry-run`.

**Required parameters:**
- `environment-name` — registered clio environment name
- `pages` — array of page objects to update

**Optional parameters:**
- `validate` — run client-side validation (markers + JS syntax) before saving. Default: `true`
- `verify` — re-read each page after saving to confirm. Default: `false`

**Page object:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `schema-name` | string | Yes | Page schema name (e.g., "UsrTodoList_FormPage") |
| `body` | string | Yes | Full JavaScript page body with all 8 marker pairs |
| `resources` | string | No | JSON object of `#ResourceString(key)#` values, e.g. `'{"UsrDetailsTab_caption": "Details"}'`. Usr-prefixed keys without explicit values are auto-derived from key names. |

**Execution behavior:**
- Validates each page client-side (if `validate: true`) before sending to Creatio
- Saves each page via DesignerService
- If verify is enabled, re-reads each page after save to confirm
- Continues processing remaining pages on failure (unlike `schema-sync` which stops)
- Single lock acquisition and single Thread.Sleep for entire batch

**Workflow:**
1. Read current page raw bodies via individual `page-get` calls (extract from `raw.body`)
2. Edit bodies using `page_body_edit.py`
3. Send all edited pages via `page-sync` in one call

**Example:**

```python
r = call_mcp_tool('page-sync', {
    'environment-name': 'local',
    'pages': [
        {
            'schema-name': 'UsrTodoList_FormPage',
            'body': edited_form_body,
            'resources': '{"UsrDetailsTab_caption": "Details", "UsrFinanceTab_caption": "Finance"}',
        },
        {
            'schema-name': 'UsrTodoList_ListPage',
            'body': edited_list_body,
        },
    ],
    'validate': True,
})
```

**Response:**

```json
{
  "success": true,
  "pages": [
    {
      "schema-name": "UsrTodoList_FormPage",
      "success": true,
      "body-length": 3775,
      "validation": {"markers-ok": true, "js-syntax-ok": true},
      "resources-registered": 2
    },
    {
      "schema-name": "UsrTodoList_ListPage",
      "success": true,
      "body-length": 2181,
      "validation": {"markers-ok": true, "js-syntax-ok": true}
    }
  ]
}
```

**Note:** `page-get` and `page-list` are still used individually for reading pages and discovering page schemas. `page-sync` replaces only the write portion of the page workflow.

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

**Cause:** Not calling `application-get-info` after entity mutations

**Solution:** Refresh context once after all entity mutations complete (after `schema-sync` batch or after all individual entity tool calls):

```python
r = call_mcp_tool('application-get-info', {'environment-name': 'local', 'app-code': 'UsrMyApp'})
ctx = r['data']
ctx['contractType'] = 'short'
json.dump(ctx, open('output/MyApp/mcp-application-result.json', 'w'), indent=2)
```

### Validation Checklist

Before proceeding to next step:

1. ✅ Response contains `"success": true` or valid result
2. ✅ For entity tools: schema is visible in `application-get-info` response
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

### Using composite tools (preferred)

```python
import json, uuid, sys
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
package_name = data['package-name']
json.dump(data | {'contractType': 'short', 'schemaSync': [], 'editableContext': {}},
          open('output/MyApp/mcp-application-result.json', 'w'), indent=2)

# 2. Schema sync — create lookup + seed + extend main entity in ONE call
new_id = str(uuid.uuid4())
r2 = call_mcp_tool('schema-sync', {
    'environment-name': 'local',
    'package-name': package_name,
    'operations': [
        {
            'type': 'create-lookup',
            'schema-name': 'UsrMyStatus',
            'title': 'My Status',
            'seed-rows': [
                {'values': {'Id': new_id, 'Name': 'New'}},
                {'values': {'Name': 'In Progress'}},
                {'values': {'Name': 'Done'}},
            ],
        },
        {
            'type': 'update-entity',
            'schema-name': 'UsrMyApp',
            'update-operations': [
                {'action': 'add', 'column-name': 'UsrStatus', 'type': 'Lookup',
                 'title': 'Status', 'reference-schema-name': 'UsrMyStatus',
                 'required': True, 'default-value-source': 'Const', 'default-value': new_id},
            ],
        },
    ],
})
assert r2['data']['success'], f"schema-sync failed: {r2}"

# 3. Refresh context ONCE after all schema operations
r3 = call_mcp_tool('application-get-info', {'environment-name': 'local', 'app-code': 'UsrMyApp'})
ctx = r3['data']
ctx['contractType'] = 'short'
ctx.setdefault('schemaSync', [])
json.dump(ctx, open('output/MyApp/mcp-application-result.json', 'w'), indent=2)

# 4. Read page raw bodies, edit, then sync via page-sync
form_r = call_mcp_tool('page-get', {'environment-name': 'local', 'schema-name': 'UsrMyApp_FormPage'})
form_body = form_r['data']['raw']['body']
list_r = call_mcp_tool('page-get', {'environment-name': 'local', 'schema-name': 'UsrMyApp_ListPage'})
list_body = list_r['data']['raw']['body']
# ... edit bodies with page_body_edit.py ...
r4 = call_mcp_tool('page-sync', {
    'environment-name': 'local',
    'pages': [
        {'schema-name': 'UsrMyApp_FormPage', 'body': edited_form_body},
        {'schema-name': 'UsrMyApp_ListPage', 'body': edited_list_body},
    ],
    'validate': True,
})
assert r4['data']['success'], f"page-sync failed: {r4}"
```

### Using individual tools (fallback)

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
package_name = data['package-name']
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
RESPONSE=$(python3 scripts/mcp_client.py application-get-info '{"environment-name":"local","app-code":"UsrMyApp"}' | jq -r '.data')

# Validate
if echo "$RESPONSE" | jq -e '.success == true' > /dev/null; then
  echo "Success"
else
  echo "Error: $(echo "$RESPONSE" | jq -r '.error.message')"
  exit 1
fi
```

### 2. Maintain Context Integrity

After entity mutations complete (after `schema-sync` batch or all individual calls):
1. Call `application-get-info`
2. Overwrite `mcp-application-result.json`
3. Add entries to `schemaSync` array

### 3. Use Temporary Files

```bash
# Save raw response for debugging
python3 scripts/mcp_client.py application-get-info '{"environment-name":"local","app-code":"UsrMyApp"}' 2>&1 | tee /tmp/mcp-raw-response.txt

# Parse from saved file
cat /tmp/mcp-raw-response.txt
```

### 4. Verify Schema Materialization

After entity tools, verify the schema is NOT in "Database update required" state:

```bash
# Check if entity exists in get_info response
python3 scripts/mcp_client.py application-get-info '{"environment-name":"local","app-code":"UsrMyApp"}' | grep '"UsrMyEntity"'
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

**⚠️ Parameter naming:** All parameters use kebab-case, consistent with all other clio MCP tools.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `environment-name` | string | **Yes** | Registered clio environment name |
| `package-name` | string | **Yes** | Package name (e.g., "UsrTodoList") |

**Example:**

```python
r = call_mcp_tool('page-list', {
    'environment-name': 'local',
    'package-name': 'UsrTodoList',
})
# Response: list of page schemas in the package
```

### 11a. Inspect Freedom UI Component Type (component-info)

**Purpose:** Read curated metadata for an unfamiliar Freedom UI component type without connecting to Creatio.

**Tool name:** `component-info`

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `component-type` | string | No | Exact component type, e.g. `crt.TabContainer`. Omit it or pass `list` to return the grouped catalog. |
| `search` | string | No | Keyword filter for list mode, e.g. `tab`. |

**Notes:**
- This tool is local and read-only. It does **not** require `environment-name`, `uri`, `login`, or `password`.
- Use it after `page-get` when `bundle.viewConfig` contains an unfamiliar `crt.*` type and you need the property contract before editing.

**Examples:**

```python
r = call_mcp_tool('component-info', {
    'component-type': 'crt.TabContainer',
})
# Response: description, parent types, properties, typical children, example insert payload
```

```python
r = call_mcp_tool('component-info', {
    'search': 'tab',
})
# Response: grouped list of matching component types such as crt.TabPanel and crt.TabContainer
```

### 11. Get Page (page-get)

**Purpose:** Read the merged page bundle (effective layout) and raw schema body of a Freedom UI page.

**Tool name:** `page-get`

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `schema-name` | string | **Yes** | Page schema name (e.g., "UsrTodoList_FormPage") |
| `environment-name` | string | No | Registered clio environment name |
| `uri` | string | No | Explicit URI (connection override) |
| `login` | string | No | Login (connection override) |
| `password` | string | No | Password (connection override) |

**Response (success):**

```json
{
  "success": true,
  "page": {
    "schemaName": "UsrTodoList_FormPage",
    "schemaUId": "eda909b1-...",
    "packageName": "UsrTodoList",
    "packageUId": "e5f6a7b8-...",
    "parentSchemaName": "BaseModulePage"
  },
  "bundle": {
    "name": "UsrTodoList_FormPage",
    "viewConfig": [ "..." ],
    "viewModelConfig": { },
    "modelConfig": { },
    "resources": { },
    "handlers": "[]",
    "converters": "{}",
    "validators": "{}",
    "parameters": [ ]
  },
  "raw": {
    "body": "define(\"UsrTodoList_FormPage\", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, ...)"
  },
  "error": null
}
```

**Response sections:**
- `page` — schema metadata (name, UId, package info, parent)
- `bundle` — merged page bundle from the full inheritance hierarchy (effective layout). **Read-only** — use for understanding the current page structure, not for editing.
- `raw.body` — original raw JavaScript body of the current schema. **Use this for editing** — modify markers and save via `page-update` or `page-sync`.

If `bundle.viewConfig` contains an unfamiliar `crt.*` component type, call `component-info` for that exact type before editing nested items or container-specific properties.

**Roundtrip workflow:**
```
page-get → extract raw.body → modify markers → page-update (or page-sync)
```

**Example:**

```python
r = call_mcp_tool('page-get', {
    'environment-name': 'local',
    'schema-name': 'UsrTodoList_FormPage',
})
body = r['data']['raw']['body']  # Raw JS body with markers — use for editing
bundle = r['data'].get('bundle', {})  # Merged layout — use for reading/understanding
```

**Known Issue:** `page-get` may fail with "Error reading JObject from JsonReader" for template-created pages whose bodies haven't been loaded by the designer service. Workaround: read body directly from PostgreSQL `SysSchemaContent` table (ContentType=0, Content column as UTF-8).

### 12. Update Page (page-update)

**Purpose:** Save a modified Freedom UI page body.

**Tool name:** `page-update`

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `environment-name` | string | No | Registered clio environment name |
| `schema-name` | string | **Yes** | Page schema name |
| `body` | string | **Yes** | Complete JS body with all 8 marker pairs |
| `resources` | string | No | JSON object of `#ResourceString(key)#` caption values, e.g. `'{"UsrDetailsTab_caption": "Details"}'`. Usr-prefixed keys without explicit values are auto-derived. |
| `dry-run` | boolean | No | `True` to validate without saving (Python `True`/`False`, **NOT** string `"true"`) |
| `uri` | string | No | Explicit URI (connection override) |
| `login` | string | No | Login (connection override) |
| `password` | string | No | Password (connection override) |

**⚠️ Boolean Parameters:** `dry-run` must be Python `True`/`False`. String `"true"`/`"false"` causes MCP SDK deserialization failure.

**Response (success):**

```json
{
  "success": true,
  "schemaName": "UsrTodoList_FormPage",
  "bodyLength": 5236,
  "dryRun": false,
  "resourcesRegistered": 2,
  "registeredResourceKeys": ["UsrDetailsTab_caption", "UsrFinanceTab_caption"]
}
```

**Resource auto-registration:** When body contains `#ResourceString(key)#` macros, `page-update` automatically registers missing localizableStrings in the child schema. Behavior:
- **Explicit:** provide `resources` JSON with `{key: value}` pairs
- **Auto-derive:** Usr-prefixed keys get captions derived from name (e.g. `UsrDetailsTab_caption` → "Details Tab")
- **Skipped:** non-Usr keys (parent template resources like `GeneralInfoTab_caption`) are never touched
- PDS-prefixed captions (`#ResourceString(PDS_Name)#`) are data-source resolved — not localizableStrings

**Workflow — always validate first:**

```python
r = call_mcp_tool('page-update', {
    'environment-name': 'local',
    'schema-name': 'UsrTodoList_FormPage',
    'body': new_body,
    'dry-run': True,
})
assert r['data']['success'], f"Dry run failed: {r['data'].get('error')}"

r = call_mcp_tool('page-update', {
    'environment-name': 'local',
    'schema-name': 'UsrTodoList_FormPage',
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

**Known Issue:** `page-update` save (`dry-run` false) may fail with "Error reading JObject" for template-created pages — same root cause as `page-get`. The tool internally calls `GetSchema` to read existing schema before saving, and this call returns empty. Workaround: update page body directly in PostgreSQL `SysSchemaContent` table using psycopg2.

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
| Page tools | kebab-case | `environment-name`, `schema-name`, `package-name`, `search-pattern`, `dry-run` |

Mixing these styles causes silent failures or local ADAC validation failures before the request reaches clio.

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

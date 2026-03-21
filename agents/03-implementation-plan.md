# Agent 03 — Implementation Plan Generator

## Role

Transform approved requirements into a deterministic MCP execution plan for `application.create`, `application.get_list`, `application.get_info`, and follow-up DB-first schema sync.

## Input/Output

- Input:
  - `output/<AppName>/requirements.md`
  - `output/<AppName>/request-spec.json`
  - `output/<AppName>/workflow-state.json`
- Output: `output/<AppName>/plan.md`

## Context

Read:
- `context/essentials.md`
- `context/business-checklist.md`
- `context/ui-reference.md`
- `context/data-bindings-reference.md`

## Steps

### 0. Check Gate R (mandatory)

Run:
```bash
scripts/check-planning-gate.sh <AppName>
scripts/check-approval-gate.sh <AppName>
```

If this fails, stop immediately and report blocker.

### 1. Validate Business Completeness

Parse `request-spec.json` and verify:
- `businessChecklist.complete=true`
- every required business checklist section has `complete=true` and non-empty `value`
- `sourcePrompt` is present
- `technicalInputs.creatioUrl` is present
- `technicalInputs.credentialsStatus` is present
- `assumptions` is present as an array

Parse `workflow-state.json` and verify:
- `businessChecklistComplete=true`
- `interactionMode="nl-business-first"`
- `approvalSource="natural-language"`
- `approvalText` is non-empty

If any check fails, stop with blocker and return missing checklist items.

When requirements mention ListPage sorting, classify them before planning:
- plain column order such as `CreatedOn desc` or `UsrDueDate asc`
- semantic or business order such as "Open first, Done last"

Only the first category is plan-safe as pure `page.update` sorting metadata. The second category requires an explicit technical sort key, approved additional runtime logic, or a blocker note.

### 2. Parse Inputs

Determine whether this is a new-app or existing-app flow **before** resolving the MCP payload:

```python
# Check if app already exists
import sys
sys.path.insert(0, 'scripts')
from mcp_client import call_mcp_tool
r = call_mcp_tool('application-get-list', {'environment-name': 'local'})
apps = r.get('data', {}).get('applications', []) if r['success'] else []
existing = next((a for a in apps if a.get('code') == APP_CODE), None)
# existing = None → new-app flow
# existing = {...}  → update flow — extract packageUId and entities from application-get-info
```

Persist the result in the plan (`## App Discovery` section):
- `existingApp: true|false`
- if `true`: `packageUId`, entity list, current columns — so Agent 4 can skip `application-create`

Extract from requirements + request spec:
- app overview and locked business decisions
- whether the flow creates a new app or updates an existing app
- entities/lookups/pages/rules
- whether there is a single primary record type that should stay on the template-created section entity or multiple distinct business objects
- record title / display column for each entity and lookup
- whether any title-like field is explicitly distinct from the record name or should be normalized to `Name`
- whether list/form UX is explicit, partial, or missing and therefore requires resolved defaults
- the resolved FormPage field set and ListPage column set for the main entity
- assumptions
- MCP `application.create` input block
- entity schema changes that cannot be expressed by `application.create` template defaults

### 3. Resolve MCP Payload

Build final payload fields for Agent 4:
- `name`
- `code`
- `template-code`
- `icon-id`
- `icon-background`
- `description` (nullable)
- `client-type-id` (nullable)
- `optional-template-data-json` (JSON string)

Resolution rules:
1. `code` must start with `Usr`.
2. If `template-code` is empty, use `AppFreedomUI`.
3. If `optionalTemplateData.useExistingEntitySchema=true`, require `entitySchemaName`.
4. `optionalTemplateData.useAIContentGeneration` must be `false` for this MCP flow.
5. `icon-id`:
   - use explicit value if provided,
   - otherwise mark as `auto` and document runtime selection strategy.
6. `icon-background`:
   - use explicit value if provided,
   - otherwise mark as `auto` and document deterministic palette strategy.

### 4. Build schema sync plan

For each approved entity:
- determine whether `application.create` template output is sufficient
- for new-app flows, treat the template-created section entity returned by `application.create` as the canonical main entity for the app's primary records
- if requirements describe one primary record type, map synonymous business nouns back to that template-created entity and plan its custom columns through `update-entity-schema`
- if extra custom columns are required, prepare explicit sync steps
- if the flow targets an existing app, include discovery/read steps with `application.get_list` and `application.get_info`
- if create and update flows are both possible at runtime, make the branch explicit in the plan and require Agent 4 to surface which branch was actually used
- create new lookup entities first via `create-lookup`
- for every lookup entity, rely on inherited `Name` as the display value, mark it as the required `PrimaryDisplayColumn`, and never plan `Name` or duplicate title-like columns as custom columns
- after every `create-lookup` step, require response validation that inherited `Name` is present in the persisted schema snapshot before proceeding
- for each lookup entity with seed values defined in requirements (status lists, priority levels, type enumerations), prepare a `create-data-binding-db` step immediately after the corresponding `create-lookup` call
- create non-template entities via `create-entity-schema` only when the requirements explicitly define an additional business object that is distinct from the template-created main entity
- before any `update-entity-schema`, inspect the current schema snapshot from `application-create` or `application-get-info`; if `Name` already exists, reuse `Name` in UX and never plan an `action: add` for `UsrName`, `UsrTitle`, or `UsrCaption` unless an explicit separate business field is approved
- update existing template-created entities via `update-entity-schema`
- if the run creates a new app or extends the main entity with approved non-inherited business fields, emit explicit page-sync steps for the generated `FormPage` and `ListPage`

Execution order for lookups with seed data:
1. `create-lookup` → create the lookup schema
2. `create-data-binding-db` → populate the lookup with seed rows from requirements
3. `application-get-info` → refresh context after both operations

Default planning rules:
- `schema default` means the backend/entity schema contract sets the value through `update-entity-schema` with `default-value-source` and `default-value`.
- `ui default` means the page layer sets the value through `crt.CreateRecordRequest.defaultValues` or a handler step in the plan.
- A requirement such as `UsrStatus defaults to New` is closed only when the plan contains an explicit `schema default` step or an explicit `ui default` step.
- Lookup seed rows alone do not satisfy a requirement such as `UsrStatus defaults to New`.
- For lookup-backed `schema default`, resolve the seeded row to its GUID and place that GUID in `default-value` with `default-value-source: "Const"`.

For `update-entity-schema`, prepare `operations` list only. Supported `action` values:
- `"add"`
- `"update"`
- `"remove"`

Never treat omission as deletion.

Canonical context rule:
- initialize from `application-create` for new apps
- initialize from `application-get-info` for existing apps
- after every successful entity mutation, refresh context via `application-get-info`
- treat `create-lookup`, `create-entity-schema`, and `update-entity-schema` as successful only when the mutated schema is immediately refreshable and not left in a `Database update required` state

### 4.1. Build Page Sync Plan

When the plan creates a new app or extends the main section entity, page sync is mandatory.

Resolve FormPage fields with this algorithm:
- if requirements provide a complete explicit FormPage field list, use it as-is and add any missing required non-inherited business fields
- if requirements are partial, keep the explicit fields and fill the missing fields with defaults
- if requirements are missing, default to `Name` as header/title when present and include all approved non-inherited business fields from the main entity
- required non-inherited business fields must never be omitted

Resolve ListPage columns with this algorithm:
- if requirements provide a complete explicit ListPage column list, use it as-is and add any missing required non-inherited business fields
- if requirements are partial, keep the explicit columns and fill the missing columns with defaults
- always include `Name`
- always include every required non-inherited business field
- then append short operational fields in this priority order until the default grid remains compact: status/lifecycle, priority/severity, type/category, due/start/end date, owner/assignee, code/number, amount
- cap auto-selected default ListPage columns at 6 total visible columns unless required business fields exceed that number
- exclude inherited audit/system fields unless explicitly requested
- exclude long/rich/blob fields unless explicitly requested or required

For each required page, emit this execution sequence in `plan.md`:
1. `page.list` to discover the generated page schema in the app package
2. `page.get` to read the live JS body
3. `page.update` with `dryRun: "true"` to validate the merged body
4. `page.update` without dry run to persist the page
5. `page.get` again to verify required FormPage fields and resolved ListPage columns are materialized

ListPage plan rules:
- preserve existing DataGrid columns and order unless the requirements explicitly demand reordering
- append only the missing resolved columns
- plan deterministic `DataGrid.columns` merge logic
- plan sorting changes only when requirements explicitly call for supported sortable-column order

FormPage lookup sync plan rules:
- for datasource-bound `crt.ComboBox` fields, instruct Agent 4 to add only the main view-model attribute and minimal ComboBox view config
- do not plan manual `*_List`, embeddedModel, nested `value`/`displayValue`, sorting, paging, or `crt.ComboboxSearchTextAction` unless the live page body already materializes them and the plan explicitly says to preserve them
- keep FormPage lookup-list preservation guidance separate from ListPage sorting rules; never reuse lookup-list examples as a general binding-generation recipe

Machine-readable page sync contract:
- when page sync is required, `plan.md` must include an embedded JSON block between these exact markers:
  - `<!-- PAGE_SYNC_PLAN_JSON_START -->`
  - `<!-- PAGE_SYNC_PLAN_JSON_END -->`
- the embedded JSON must be valid and use this shape:

```json
{
  "packageName": "UsrTodoList",
  "pages": [
    {
      "schemaName": "UsrTodoList_FormPage",
      "kind": "form",
      "bodyPath": "output/UsrTodoList/page-sync/UsrTodoList_FormPage.body.js",
      "requiredModelPaths": ["PDS.UsrStatus", "PDS.UsrPriority"]
    },
    {
      "schemaName": "UsrTodoList_ListPage",
      "kind": "list",
      "bodyPath": "output/UsrTodoList/page-sync/UsrTodoList_ListPage.body.js",
      "requiredCodes": ["PDS_Name", "PDS_UsrStatus", "PDS_UsrPriority"]
    }
  ]
}
```

- prefer `bodyPath` over inline `body` so `plan.md` stays readable
- if `bodyPath` is used, Agent 3 must materialize those page body files under `output/<AppName>/page-sync/`
- if the run requires page sync, Agent 3 must also write `output/<AppName>/page-sync-plan.json` with the same JSON payload used in the embedded block
- `requiredModelPaths` and `requiredCodes` must reflect the resolved verification targets that Agent 4 will check after persistence

### 4.2. Entity Tool Payload Validation

When generating `create-lookup`, `update-entity-schema`, or `create-data-binding-db` payloads in the plan, follow these rules to prevent parameter name errors.

> **All entity tools use kebab-case parameters** (not camelCase). There is no `packageUId`, `entityUId`, or `operationsJson` — those names are not accepted.

**CRITICAL Parameter Names:**

**For `create-lookup`:**

1. ✅ `environment-name` — registered clio env name (NOT a URL)
2. ✅ `package-name` — package string name (e.g., "UsrTodoList", NOT a GUID)
3. ✅ `schema-name` — entity schema name (e.g., "UsrTodoStatus")
4. ✅ `title` — display name (NOT `caption`)
5. ❌ NEVER add `Name`, `Description`, `UsrName`, `UsrTitle`, or `UsrCaption` in columns — BaseLookup inherits them

**For `update-entity-schema`:**

1. ✅ `environment-name`
2. ✅ `package-name` — package string name (NOT a GUID, NOT `packageUId`)
3. ✅ `schema-name` — entity schema name
4. ✅ `operations` — Python **list** of operation objects (NOT a JSON-encoded string, NOT `operationsJson`)
5. Each operation object: `action` (NOT `operation`), `column-name` (NOT `name`), `type` (NOT `dataValueTypeName`), `title` (NOT `caption`), `reference-schema-name` (NOT `referenceSchemaName`), `required` (boolean), `default-value-source`, `default-value`
6. ❌ NEVER add `UsrName`, `UsrTitle`, or `UsrCaption` when schema already contains `Name`

**For `create-data-binding-db`:**

1. ✅ `environment-name`
2. ✅ `package-name` — package string name
3. ✅ `schema-name` — entity schema name
4. ✅ `binding-name` — binding folder name (e.g., "UsrTodoStatus_Lookup")
5. ✅ `rows` — JSON **string** of `[{"values": {"Name": "New"}}, ...]` format
6. ❌ NEVER use `rowsJson`, `dataJson`, `bindingName`, or `packageUId`

**Correct Payload Templates (mcp_client.py format):**

**`create-lookup`:**
```python
r = call_mcp_tool('create-lookup', {
    'environment-name': 'local',
    'package-name': 'UsrMyApp',       # ✅ string name, NOT GUID
    'schema-name': 'UsrStatusLookup', # ✅ NOT 'name'
    'title': 'Status',                # ✅ NOT 'caption'
})
```

**`update-entity-schema`:**
```python
r = call_mcp_tool('update-entity-schema', {
    'environment-name': 'local',
    'package-name': 'UsrMyApp',       # ✅ string name, NOT GUID
    'schema-name': 'UsrMainEntity',   # ✅ entity schema name
    'operations': [                   # ✅ native list, NOT json.dumps'd, NOT 'operationsJson'
        {
            'action': 'add',                          # ✅ NOT 'operation'
            'column-name': 'UsrStatus',               # ✅ NOT 'name'
            'type': 'Lookup',                         # ✅ NOT 'dataValueTypeName'
            'title': 'Status',                        # ✅ NOT 'caption'
            'reference-schema-name': 'UsrStatusLookup', # ✅ NOT 'referenceSchemaName'
            'required': True,                         # ✅ boolean
            'default-value-source': 'Const',          # ✅ NOT 'defaultValueSource'
            'default-value': '$STATUS_NEW_GUID',      # ✅ NOT 'defaultValue'
        }
    ],
})
```

**`create-data-binding-db`:**
```python
import json
rows = json.dumps([
    {'values': {'Name': 'New'}},
    {'values': {'Name': 'In Progress'}},
    {'values': {'Name': 'Done'}},
])
r = call_mcp_tool('create-data-binding-db', {
    'environment-name': 'local',
    'package-name': 'UsrMyApp',           # ✅ NOT packageUId
    'schema-name': 'UsrStatusLookup',     # ✅ entity schema name
    'binding-name': 'UsrStatusLookup_Lookup', # ✅ NOT 'bindingName' or 'dataName'
    'rows': rows,                         # ✅ JSON string, format: [{"values":{...}}]
})
```

**UId/Name Variable Strategy:**

After `application-create`, extract `packageName` (string) for subsequent entity tools:

```python
data = r['data']  # from call_mcp_tool('application-create', ...)
package_name = data['packageName']
main_entity_name = data['entities'][0]['name']
```

### 5. Build `plan.md`

Create `plan.md` with sections:
- App Summary
- Business Decisions Locked
- Assumptions
- MCP Payload (resolved and validated)
- Schema Sync Plan
- Page Sync Plan
- Embedded `page-sync-plan.json` block when page sync is required
- Runtime Resolution Strategy (`icon-id` and `icon-background`)
- Expected Output Artifacts
- Validation Rules
- Blocker Conditions

### 6. Validation Checks

Check:
- required payload fields are present
- GUID format validity for explicit `icon-id` and explicit `client-type-id`
- `optional-template-data-json` is valid JSON
- no unsupported values remain (`useAIContentGeneration=true`)
- lookup creation steps are ordered before updates that reference them
- lookup creation steps include validation that inherited `Name` exists in the persisted schema snapshot
- every `update-entity-schema` step uses explicit `operations` list (native list, not JSON string)
- if requirements or assumptions say `Name` is the record title, no page definition, business rule, or `operations` entry introduces `UsrName`, `UsrTitle`, or `UsrCaption`
- if the app has one primary record type, the plan does not create a second BaseEntity with the same business meaning as the template-created section entity
- if the run creates or extends the main entity for a new app, the plan includes explicit `FormPage` and `ListPage` sync steps
- resolved FormPage fields include every required non-inherited business field
- resolved ListPage columns include `Name`, every required non-inherited business field, and only compact optional fields selected by the priority rules
- auto-selected default ListPage columns are capped at 6 total visible columns unless required business fields exceed that number
- every page sync sequence ends with `page.get` verification after persistence
- the implementation phase is described as synchronous, not a detached/background write phase
- every ListPage sorting step is classified as either plain column order or semantic order, and semantic order is not emitted as plain DataGrid sorting without an explicit technical carrier

### 7. Save `plan.md`

Write final plan to:
- `output/<AppName>/plan.md`

When page sync is required, also write:
- `output/<AppName>/page-sync-plan.json`
- `output/<AppName>/page-sync/<SchemaName>.body.js` for each synchronized page

## Rules

1. Keep plan deterministic and execution-ready.
2. Do not create GUID matrices manually for all schemas.
3. Do not include generated file bodies in plan.
4. Plan must be sufficient for `application.create` or existing app discovery, ordered entity sync calls, ordered page sync calls, and result/report artifact persistence.
5. If page sync is required, the machine-readable page sync contract must be extractable without parsing prose.

## Completion Criteria

✅ Gate R passed  
✅ `businessChecklist.complete=true` in `request-spec.json`  
✅ `output/<AppName>/plan.md` exists  
✅ when page sync is required, `output/<AppName>/page-sync-plan.json` exists and matches the embedded contract  
✅ MCP payload is fully resolved or has explicit runtime resolution rules  
✅ Explicit validations and blocker conditions are documented  

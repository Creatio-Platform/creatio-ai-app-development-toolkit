# Agent 04 - Implementation

## Role

Execute the approved MCP workflow synchronously, persist runtime evidence, synchronize required pages, and generate the final report and docs from persisted evidence.

During app-generation execution, write only inside `output/<AppName>/`.

## Input

- `output/<AppName>/technical-annex.md` or `output/<AppName>/plan.md`
- `output/<AppName>/workflow-state.json`
- `output/<AppName>/.creatio-env.json`
- `output/<AppName>/page-sync-plan.json` when page sync is required

## Output

- `output/<AppName>/mcp-application-result.json`
- `output/<AppName>/mcp-application-report.md`
- `output/<AppName>/docs/**`

## Read First

- `AGENTS.md`
- `context/.cache/agent-4-bundle.md` when available
- `context/essentials.md`
- `context/mcp-application-tools-reference.md`
- `context/ui-reference.md`
- `context/viewconfig-reference.md`
- `context/handlers-reference.md`
- `context/data-bindings-reference.md`
- `context/bindings-lookup.json`
- `scripts/mcp_client.py`
- `scripts/mcp_full_sync.py`
- `scripts/page_body_tools.py`
- `scripts/page_body_edit.py`
- `scripts/mcp_result_evidence.py`

## MCP Transport And Tooling

- Prefer `scripts/mcp_client.py` for clio stdio transport; it handles MCP initialization internally.
- Prefer `scripts/mcp_full_sync.py` when the plan batches schema and page synchronization in one process.
- For executable tool parameters, response shape, and app-modeling semantics, use current `clio` MCP discovery plus prompts/resources instead of maintaining a second local MCP spec here.
- Respect `CLIO_CMD` when a custom clio binary is configured; otherwise use global `clio`.
- Do not use raw curl for clio stdio transport.
- Pass boolean MCP parameters such as `dry-run` as booleans, not strings.

## Preconditions

- `scripts/check-approval-gate.sh <AppName>` passes.
- `output/<AppName>/.creatio-env.json` exists and is valid.
- `output/<AppName>/plan.md` or `output/<AppName>/technical-annex.md` exists.
- Agent 4 runs in the foreground. Do not background it.

## Execution Order

1. Verify MCP is reachable, either through explicit `initialize` or via `scripts/mcp_client.py`.
2. Call `tools/list` and verify required tools exist.
3. Resolve the execution branch:
   - new app: `application-create`
   - existing app: `application-get-list` -> `application-get-info`
4. Parse the flat MCP JSON payload returned by `scripts/mcp_client.py` and treat it as the source runtime contract.
5. Initialize `output/<AppName>/mcp-application-result.json`.
6. Execute ordered schema sync from the plan, preferably via `schema-sync` / `scripts/mcp_full_sync.py` when the plan batches operations:
   - `create-lookup`
   - `create-data-binding-db`
   - `create-entity-schema`
   - `update-entity-schema`
7. After each successful entity mutation or schema-sync batch, call `application-get-info` and overwrite `mcp-application-result.json`.
8. If the plan requires page sync, run:
   - `page-list`
   - `page-get`
   - `page-update` with `dry-run: true`
   - `page-update`
   - `page-get` again for verification
9. Persist page evidence and verification results.
10. Validate the final result contract.
11. Build `mcp-application-report.md` from persisted evidence only.
12. Sync and validate docs under `output/<AppName>/docs/`.

## Branching Rules

- If `application-create` reports that the app or configuration schema already exists, stop the create flow and switch to the documented existing-app discovery flow.
- Surface which branch actually ran in the persisted evidence and final report.

## Schema Sync Rules

- Prefer `canonical-main-entity-name` from application context when selecting the main entity for a new app. Fall back to the section entity that matches the app code only when the canonical field is absent.
- Use `update-entity-schema` to extend that main entity.
- Use `create-entity-schema` only for additional business objects with distinct meaning.
- Apply the naming contract from `AGENTS.md` Global Invariants for all newly created entities and custom columns.
- Practical reminder: lookup storage aliases such as `...Id` are backend physical names, not canonical business field codes.
- Create lookup entities before entities that reference them.
- Treat schema mutations as successful only when refreshed metadata is available immediately and the schema is not left in `Database update required`.
- If post-mutation refresh fails, stop with a blocker.

## Default Rules

When the approved plan requires defaults, implement them explicitly and follow current `clio` MCP guidance for whether they belong to schema contract or page logic. Treat refreshed runtime evidence as the success criterion.

## Page Sync Rules

Page sync is mandatory when the run creates a new app or extends the main section entity with approved business fields.
If `plan.md` carries the embedded page sync contract, read it from the block between `<!-- PAGE_SYNC_PLAN_JSON_START -->` and `<!-- PAGE_SYNC_PLAN_JSON_END -->`.

FormPage:

- Keep `Name` as the header when present.
- Include all required non-inherited business fields.
- Append only missing fields to the live page body.
- Preserve existing handlers, imports, and live bindings unless the plan explicitly changes them.

ListPage:

- Include `Name`.
- Include all required non-inherited business fields.
- Keep optional defaults compact and within the planned cap.
- Exclude inherited audit/system fields and long/rich/blob fields unless explicitly required.

Sorting:

- Use plain DataGrid sorting only for plain sortable-column requirements.
- If the requirement is semantic business ordering without an explicit technical carrier, stop with a blocker instead of improvising.

## Evidence Rules

Use `scripts/mcp_result_evidence.py` and the normalized result document as the source for:

- `schemaSync`
- `operationLog`
- `pageEvidence`
- `acceptanceEvidence`

Persist the compact context from MCP and set `contractType=short`.
Never hand-write `mcp-application-result.json` or `mcp-application-report.md` from shell variables once runtime evidence exists.

### Schema Sync Execution Notes

- Use `schema-sync` as the primary entity write path and use individual entity tools only when the approved plan cannot be expressed as one batch.
- Prefer `canonical-main-entity-name` from application context when deciding which entity to extend for the app’s primary records.
- Include lookup seeding inline in `schema-sync` where possible. Use `create-data-binding-db` only when the run still needs an explicit binding artifact after schema sync.
- Treat schema work as successful only after `application-get-info` refreshes the application context and the result file is overwritten and normalized again.
- When the run creates a new app or extends the main section entity with approved business fields, page sync remains mandatory before the run can be reported as successful.

### Related Binding Tools

- `get-entity-schema-properties` and `get-entity-schema-column-properties` are verification tools for deployed schemas.
- `create-data-binding-db` remains available for explicit binding artifacts and seed scenarios not already handled by `schema-sync`.
- If lookup seed data already landed through `schema-sync` `seed-rows`, do not repeat the same seed flow with `create-data-binding-db` unless the plan explicitly requires a second artifact.

### Flat Runtime Contract

`scripts/mcp_client.py` returns raw MCP JSON. Treat the application context as flat runtime data, not as a nested `app/packages` contract.

Primary fields:
- `success`
- `package-u-id`
- `package-name`
- `entities`
- `canonical-main-entity-name` when present
- `error`

Normalize `output/<AppName>/mcp-application-result.json` with `scripts/mcp_context_adapter.py normalize` after writing the raw MCP result. The normalized file may also contain `editableContext`, which is a local helper projection rather than the MCP contract.

### Validation Checklist

- response JSON parses successfully
- `contractType=short` after normalization
- `success` exists
- when `success=true`, `package-u-id` is non-empty
- when `success=true`, `entities` is non-empty
- `canonical-main-entity-name` is used when present for main-entity selection
- each successful entity mutation is followed by a successful `application-get-info` refresh
- result and report are persisted from runtime evidence
- final report matches the materialized entity names and implemented artifacts in `mcp-application-result.json`

### Retry and Failure Policy

- Retry MCP calls up to 3 times with 10s delay for transient failures.
- If required application tools are missing in `tools/list`, stop with blocker.
- If any tool returns `success=false`, stop with blocker and surface `error.message`.
- If `application-create` returns an existing-app collision and the plan does not explicitly allow update flow, stop with blocker.
- If the plan tries to create a second BaseEntity for the same primary record type as the already resolved main section entity, stop with blocker instead of executing `create-entity-schema`.
- For plain-text `ERROR:` responses, stop with blocker and persist raw response in report.
- If `application-get-info` fails after a reported entity mutation success because the schema is missing from server metadata, stop with a core MCP materialization blocker.
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
if not data.get('success') or not data.get('package-u-id'):
    print('ERROR: missing package-u-id:', json.dumps(data)); sys.exit(1)
json.dump(data, open('/tmp/mcp-app-context.json', 'w'), indent=2)
print('OK package-u-id:', data['package-u-id'])
PYEOF
python3 /tmp/run_app_create.py
```

For existing app flow:
1. call `application-get-list` and find the app by `code`
2. call `application-get-info` with `app-code`
3. log the branch explicitly in the report and final status

Stop and report blocker when:
- `success=false`
- response missing `package-u-id` or `entities`
- plain `ERROR: ...` text

### 6. Initialize canonical context

Write the raw flat MCP result to `output/<AppName>/mcp-application-result.json`, then normalize it:

```bash
python3 scripts/mcp_context_adapter.py normalize output/<AppName>/mcp-application-result.json
```

Normalized result shape:
- `contractType` (`short`)
- `success` (boolean)
- flat application fields such as `package-u-id`, `package-name`, `entities`, and optional `canonical-main-entity-name`
- `entities` (array)
- `error` (object when available)
- `schemaSync` (array of executed entity tool operations with tool name, target, and status)
- `operationLog`, `pageEvidence`, `acceptanceEvidence`
- `editableContext` (repo-local helper projection for approved edits)

Treat the flat application fields as the primary runtime contract. Treat `editableContext` as a derived helper projection.

### 7. Execute schema sync steps

**See:** `context/mcp-application-tools-reference.md` section "Schema Sync (schema-sync)"

If `plan.md` contains approved schema sync, use `schema-sync` composite tool via `scripts/mcp_client.py`:

```bash
cat > /tmp/run_schema_sync.py << 'PYEOF'
import sys, json, uuid
sys.path.insert(0, 'scripts')
from mcp_client import call_mcp_tool

new_id = str(uuid.uuid4())
r = call_mcp_tool('schema-sync', {
    'environment-name': 'local',
    'package-name': 'UsrMyApp',
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
                {
                    'action': 'add',
                    'column-name': 'UsrStatus',
                    'type': 'Lookup',
                    'title': 'Status',
                    'reference-schema-name': 'UsrMyStatus',
                    'required': True,
                    'default-value-source': 'Const',
                    'default-value': new_id,
                },
            ],
        },
    ],
})
print(json.dumps(r, indent=2))
assert r.get('data', {}).get('success'), f"schema-sync failed: {r}"
PYEOF
python3 /tmp/run_schema_sync.py
```

**After schema-sync completes — refresh context ONCE:**

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

**Fallback to individual tools:** If `schema-sync` is unavailable (older clio), use individual `create-lookup` → `create-data-binding-db` → `update-entity-schema` calls sequentially, refreshing context after each mutation. In this path, prefer omitting `binding-name` for lookup seed data so the binding defaults to `<schema-name>` and updates existing default bindings instead of creating duplicate `<schema>_Lookup` variants.

**Critical validation:**
- Created/updated schema MUST be immediately queryable through `application-get-info`
- If schema is missing from server metadata after successful entity tool response, this is a core MCP blocker - stop immediately
- Do NOT proceed if schema is in "Database update required" state

Stop and report blocker on first failed entity tool call or `schema-sync` failure.

### 7b. Execute page customization steps

Read the skill doc: **`skills/page-schema-editing/SKILL.md`**

If `plan.md` contains page customization requirements, or the run creates or extends the main section entity for a new app:

- Stop with blocker if this run requires page sync but `plan.md` does not define explicit `FormPage` and `ListPage` sync steps.

1. Call `page-list` with the app's package name to discover generated pages
2. For each page that needs customization:
   a. Call `page-get` with `schema-name` to get the full JS body
   a1. **CRITICAL — Page body marker parsing:** Always use `page_body_tools.parse_marker_json(body, marker)` to parse marker content. **Never** use raw `json.loads()` — page bodies contain JavaScript with trailing commas that are valid JS but invalid strict JSON. The helper `strip_trailing_commas()` handles this automatically.
   a2. **MANDATORY — Use `scripts/page_body_edit.py`:** All page body editing MUST go through `add_form_fields()` or `add_list_columns()` functions. Direct string manipulation (`str.replace()`, string concatenation, brace-counting) is prohibited — it produces double-comma `},,{` corruption and orphaned column bindings.
   b. Edit the body using the **Page Body Editing Algorithm** below — never use ad-hoc string manipulation
   c. Merge new content with existing section content (do NOT replace existing handlers — append)
   d. If the page must surface newly added entity fields, inspect `SCHEMA_VIEW_CONFIG_DIFF` and `SCHEMA_VIEW_MODEL_CONFIG_DIFF` together
   d1. If the page must change ListPage default sorting, use the canonical `ListPage DataGrid Sorting via page-update` contract from `context/ui-reference.md`
   d2. Read the live DataGrid `items` binding and identify the real collection attribute before changing sorting metadata
   d3. Only implement plain sortable-column order through DataGrid sorting metadata; if the requirement is semantic business order without an explicit sort key or approved runtime logic, stop with blocker instead of improvising
   e. For runtime FormPage field sync, append missing field inserts to `SideAreaProfileContainer` and continue `row` and `index` from the current maximum values
   f. Add matching `SCHEMA_VIEW_MODEL_CONFIG_DIFF` attributes for every inserted field
   g. For datasource-bound lookup fields, add the `crt.ComboBox` insert and the main view-model attribute only; preserve existing live lookup-list bindings or nested actions only when they are already materialized in the page body
   h. Preserve live special cases such as `Name -> PDS.Name`; do not duplicate `Name` if it already exists
   i. If handlers use SDK services, ensure `deps` and `args` include the required import and preserve the live SDK alias style already used by the page body
   j. After editing all pages, call `page-sync` composite tool with all edited bodies in one batch
   k. If page-sync reports validation failure, fix the body and retry
   l. Verify the `page-sync` response shows `success: true` for all pages
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

**Page sync via `page-sync` MCP tool (preferred fast path with mandatory verification fallback):**

Use the `page-sync` composite tool as the **preferred** page write path. Use individual `page-get` for reading and `page-list` for discovery. If the composite response does not expose a reusable verified body, the local helper must fall back to `page-get` before marking `machineChecked`.

**Step 1 — Read current page bodies via `page-get`:**
```bash
python3 -c "
import sys, os, json
sys.path.insert(0, 'scripts')
from mcp_client import call_mcp_tool
r = call_mcp_tool('page-get', {'environment-name': '<env_name>', 'schema-name': '<PageName>'})
if r['success'] and r.get('data', {}).get('body'):
    open('/tmp/<PageName>.body.js', 'w').write(r['data']['body'])
    print('OK')
else:
    print(json.dumps(r, indent=2))
    sys.exit(1)
"
```

**Step 2 — Edit page bodies** using `scripts/page_body_edit.py`:
```bash
python3 scripts/page_body_edit.py add-form-fields /tmp/FormPage.body.js \
  '[{"name":"UsrStatus","type":"crt.ComboBox","path":"PDS.UsrStatus","label":"Status"}]' \
  -o /tmp/FormPage.edited.js

python3 scripts/page_body_edit.py add-list-columns /tmp/ListPage.body.js \
  '[{"code":"PDS_UsrStatus","caption":"Status","dataValueType":10}]' \
  -o /tmp/ListPage.edited.js
```

**Step 3 — Apply via `page-sync` composite tool:**
```bash
cat > /tmp/run_page_sync.py << 'PYEOF'
import sys, json
sys.path.insert(0, 'scripts')
from mcp_client import call_mcp_tool

form_body = open('/tmp/FormPage.edited.js').read()
list_body = open('/tmp/ListPage.edited.js').read()

r = call_mcp_tool('page-sync', {
    'environment-name': 'local',
    'pages': [
        {'schema-name': 'UsrMyApp_FormPage', 'body': form_body},
        {'schema-name': 'UsrMyApp_ListPage', 'body': list_body},
    ],
})
print(json.dumps(r, indent=2))
assert r.get('data', {}).get('success'), f"page-sync failed: {r}"
PYEOF
python3 /tmp/run_page_sync.py
```

**Fallback — Apply via `mcp_page_sync.py` helper (uses individual tools internally):**
```bash
python3 scripts/mcp_page_sync.py apply \
  --result output/<AppName>/mcp-application-result.json \
  --plan output/<AppName>/page-sync-plan.json \
  --env output/<AppName>/.creatio-env.json \
  --report output/<AppName>/mcp-application-report.md
```

`--plan` may also point directly to `output/<AppName>/plan.md` when that file contains the embedded `page-sync-plan.json` block between `<!-- PAGE_SYNC_PLAN_JSON_START -->` and `<!-- PAGE_SYNC_PLAN_JSON_END -->`.

**Combined sync (entity + page in one process):**

When both schema sync and page sync are needed (typical for new apps), use `mcp_full_sync.py` to run everything in a single process with one persistent MCP connection:

```bash
python3 scripts/mcp_full_sync.py \
  --env output/<AppName>/.creatio-env.json \
  --result output/<AppName>/mcp-application-result.json \
  --edited-context output/<AppName>/edited-context.json \
  --page-plan output/<AppName>/plan.md \
  --report output/<AppName>/mcp-application-report.md
```

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
- ❌ Never use `str.replace()` or string concatenation to inject JSON fragments — Creatio template bodies contain trailing commas (valid JS, invalid strict JSON); appending after a trailing comma produces double-comma `},,{` corruption that breaks the page at runtime
- ❌ Never assume the viewModelConfig section type — always detect whether it is `viewModelConfig` (object `{}`) or `viewModelConfigDiff` (array `[]` of operations); FormPage typically uses the object variant, ListPage the array variant
- ❌ Never add columns to `viewConfigDiff` DataTable without adding matching `PDS_*` bindings to `viewModelConfigDiff` — columns without model paths render as empty/broken; every column `PDS_X` needs a corresponding attribute with `modelConfig.path: "PDS.X"`
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
3. when `success=true`, `package-u-id` is a non-empty GUID
4. when `success=true`, `entities` is non-empty
5. when `canonical-main-entity-name` is present, it resolves to one of the returned entities
6. when `success=false`, `error.message` is non-empty

### 9. Write summary report

Create:
- `output/<AppName>/mcp-application-report.md`

Include:
- resolved payload fields
- icon resolution details
- MCP result (`contractType=short`, `success`, `package-u-id`, `package-name`, optional `canonical-main-entity-name`)
- schema sync steps executed and refreshed through `application-get-info`
- page sync steps executed and verification results for `FormPage` and `ListPage`
- validation results for normalized contract
- whether the run completed via create flow or existing-app update flow
- explicit distinction between `implemented`, `machineChecked`, and `manualCheckPending`
- never claim UI acceptance is verified unless the corresponding evidence exists in `mcp-application-result.json`

## Completion Criteria

- Gate R passed
- MCP initialize and tools/list succeeded
- `application-create` executed successfully
- Result persisted to `mcp-application-result.json`
- All required schema sync steps executed and canonical context refreshed
- No created or updated schema is left in `Database update required`
- Page sync executed and verified for new-app main-entity flows or any run where the plan requires page customization
- Validation passed
- Summary persisted to `mcp-application-report.md`

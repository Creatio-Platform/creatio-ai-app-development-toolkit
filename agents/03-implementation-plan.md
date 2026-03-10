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

### 2. Parse Inputs

Extract from requirements + request spec:
- app overview and locked business decisions
- whether the flow creates a new app or updates an existing app
- entities/lookups/pages/rules
- record title / display column for each entity and lookup
- whether any title-like field is explicitly distinct from the record name or should be normalized to `Name`
- assumptions
- MCP `application.create` input block
- entity schema changes that cannot be expressed by `application.create` template defaults

### 3. Resolve MCP Payload

Build final payload fields for Agent 4:
- `name`
- `code`
- `templateCode`
- `iconId`
- `iconBackground`
- `description` (nullable)
- `clientTypeId` (nullable)
- `optionalTemplateDataJson` (JSON string)

Resolution rules:
1. `code` must start with `Usr`.
2. If `templateCode` is empty, use `AppFreedomUI`.
3. If `optionalTemplateData.useExistingEntitySchema=true`, require `entitySchemaName`.
4. `optionalTemplateData.useAIContentGeneration` must be `false` for this MCP flow.
5. `iconId`:
   - use explicit value if provided,
   - otherwise mark as `auto` and document runtime selection strategy.
6. `iconBackground`:
   - use explicit value if provided,
   - otherwise mark as `auto` and document deterministic palette strategy.

### 4. Build schema sync plan

For each approved entity:
- determine whether `application.create` template output is sufficient
- if extra custom columns are required, prepare explicit sync steps
- if the flow targets an existing app, include discovery/read steps with `application.get_list` and `application.get_info`
- if create and update flows are both possible at runtime, make the branch explicit in the plan and require Agent 4 to surface which branch was actually used
- create new lookup entities first via `entity.create_lookup`
- for every lookup entity, rely on inherited `Name` as the display value, mark it as the required `PrimaryDisplayColumn`, and never plan `Name` or duplicate title-like columns as custom columns
- after every `entity.create_lookup` step, require response validation that inherited `Name` is present in the persisted schema snapshot before proceeding
- for each lookup entity with seed values defined in requirements (status lists, priority levels, type enumerations), prepare a `binding.create` step immediately after the corresponding `entity.create_lookup` call
- create non-template entities via `entity.create` when needed
- before any `entity.update`, inspect the current schema snapshot from `application.create` or `application.get_info`; if `Name` already exists, reuse `Name` in UX and never plan an `addColumn` for `UsrName`, `UsrTitle`, or `UsrCaption` unless an explicit separate business field is approved
- update existing template-created entities via `entity.update`

Execution order for lookups with seed data:
1. `entity.create_lookup` → create the lookup schema
2. `binding.create` → populate the lookup with seed rows from requirements
3. `application.get_info` → refresh context after both operations

For `entity.update`, prepare `operationsJson` only:
- `addColumn`
- `updateColumn`
- `removeColumn`

Never treat omission as deletion.

Canonical context rule:
- initialize from `application.create` for new apps
- initialize from `application.get_info` for existing apps
- after every successful entity mutation, refresh context via `application.get_info`
- treat `entity.create_lookup`, `entity.create`, and `entity.update` as successful only when the mutated schema is immediately refreshable and not left in a `Database update required` state

### 4.1. Entity Tool Payload Validation

When generating `entity.create_lookup`, `entity.create`, or `entity.update` payloads in the plan, follow these rules to prevent parameter name errors:

**CRITICAL Parameter Names:**

**For Entity Tools (entity.create_lookup, entity.create, entity.update):**

1. ❌ NEVER use `packageName` → always use `packageUId` (GUID string)
2. ❌ NEVER use `entitySchemaUId` → always use `entityUId` (GUID string, REQUIRED for entity.update)
3. ❌ NEVER use `entityName` → always use `name` for create tools, `schemaName` for entity.update
4. ❌ NEVER use `displayName` or `description` → always use `caption` (string)
5. ❌ NEVER use flat column structures → always use `{operation, column: {...}}` for `operationsJson`
6. ❌ NEVER add `Name`, `Description`, `UsrName`, `UsrTitle`, or `UsrCaption` as custom lookup columns → BaseLookup already provides `Name`/`Description`, and `Name` must remain the lookup `PrimaryDisplayColumn`
7. ❌ NEVER add `UsrName`, `UsrTitle`, or `UsrCaption` to an existing/template-created entity if the refreshed schema snapshot already contains `Name`, unless the requirements explicitly call for a separate business field

**For Binding Tools (binding.create):**

1. ❌ NEVER use `dataName` or `bindingFolder` → always use `bindingName`
2. ❌ NEVER use `dataJson` or `data` → always use `rowsJson`
3. ❌ NEVER use `packageName` → always use `packageUId`
4. ❌ NEVER use `rawSchemaJson` → binding flow works only with deployed schema metadata
5. ✅ ALWAYS use `schemaName` for entity reference
6. ✅ `rowsJson` must be array of rows: `[[{columnName, value}, ...], ...]`

**Correct Payload Templates:**

**entity.create_lookup:**
```bash
curl ... -d "{
  \"name\": \"entity.create_lookup\",
  \"arguments\": {
    \"packageUId\": \"$PACKAGE_UID\",     # ✅ GUID from application.create
    \"name\": \"UsrStatusLookup\",        # ✅ NOT entityName
    \"caption\": \"Status\",              # ✅ NOT displayName
    \"columnsJson\": \"[]\"               # ✅ BaseLookup already provides Name/Description; Name stays the lookup PrimaryDisplayColumn
  }
}"
```

**entity.update:**
```bash
curl ... -d "{
  \"name\": \"entity.update\",
  \"arguments\": {
    \"entityUId\": \"$ENTITY_UID\",      # ✅ REQUIRED from entity.create or application.get_info
    \"packageUId\": \"$PACKAGE_UID\",    # ✅ REQUIRED from application.create
    \"schemaName\": \"UsrMainEntity\",   # ✅ Optional (can read from DB if empty)
    \"caption\": \"Main Entity\",
    \"operationsJson\": \"[{\\\"operation\\\":\\\"addColumn\\\",\\\"column\\\":{...}}]\"  # ✅ Nested structure
  }
}"
```

**binding.create:**
```bash
curl ... -d "{
  \"name\": \"binding.create\",
  \"arguments\": {
    \"packageUId\": \"$PACKAGE_UID\",             # ✅ REQUIRED from application.create
    \"schemaName\": \"UsrStatusLookup\",        # ✅ Entity schema name
    \"bindingName\": \"UsrStatusLookup_Seed\",  # ✅ NOT dataName or bindingFolder
    \"rowsJson\": \"[[{\\\"columnName\\\":\\\"Name\\\",\\\"value\\\":\\\"New\\\"}]]\",  # ✅ NOT dataJson
    \"columnsJson\": \"[{\\\"columnName\\\":\\\"Id\\\",\\\"isKey\\\":true}]\",  # ✅ Optional descriptor
    \"installType\": \"0\"                      # ✅ Optional, default 0
  }
}"
```

**CRITICAL for binding.create:**
- ❌ NEVER use `dataName` → always use `bindingName`
- ❌ NEVER use `dataJson` → always use `rowsJson`
- ❌ NEVER use `packageName` → always use `packageUId`
- ❌ NEVER use `rawSchemaJson` → binding flow works only with deployed schema metadata
- ✅ Success response is only `{\"success\": true}`
- ✅ `rowsJson` format: array of rows, each row is array of `{columnName, value}` objects
- ✅ Example: `[[{"columnName":"Id","value":"guid-1"},{"columnName":"Name","value":"New"}]]`

**UId Variable Strategy:**

Document in plan that UIds will be extracted from `application.create` response using the new flat format:

```bash
# Method 1: Ultra-simple with helper script (recommended)
bash ~/scripts/mcp-response-to-env.sh /tmp/mcp-response.json > /tmp/.mcp-env
source /tmp/.mcp-env
# Variables: $PACKAGE_UID, $MAIN_ENTITY_UID, $PACKAGE_NAME, etc.

# Method 2: Direct jq extraction from flat format
PACKAGE_UID=$(jq -r '.packageUId' /tmp/mcp-response.json)
MAIN_ENTITY_UID=$(jq -r '.entities[0].uId' /tmp/mcp-response.json)
```

Always show correct JSON structure in plan examples. Never show wrong parameter names.

### 5. Build `plan.md`

Create `plan.md` with sections:
- App Summary
- Business Decisions Locked
- Assumptions
- MCP Payload (resolved and validated)
- Schema Sync Plan
- Runtime Resolution Strategy (`iconId` and `iconBackground`)
- Expected Output Artifacts
- Validation Rules
- Blocker Conditions

### 6. Validation Checks

Check:
- required payload fields are present
- GUID format validity for explicit `iconId` and explicit `clientTypeId`
- `optionalTemplateDataJson` is valid JSON
- no unsupported values remain (`useAIContentGeneration=true`)
- lookup creation steps are ordered before updates that reference them
- lookup creation steps include validation that inherited `Name` exists in the persisted schema snapshot
- every `entity.update` step uses explicit `operationsJson`
- if requirements or assumptions say `Name` is the record title, no page definition, business rule, or `operationsJson` entry introduces `UsrName`, `UsrTitle`, or `UsrCaption`
- the implementation phase is described as synchronous, not a detached/background write phase

### 7. Save `plan.md`

Write final plan to:
- `output/<AppName>/plan.md`

## Rules

1. Keep plan deterministic and execution-ready.
2. Do not create GUID matrices manually for all schemas.
3. Do not include generated file bodies in plan.
4. Plan must be sufficient for `application.create` or existing app discovery, ordered entity sync calls, and result/report artifact persistence.

## Completion Criteria

✅ Gate R passed  
✅ `businessChecklist.complete=true` in `request-spec.json`  
✅ `output/<AppName>/plan.md` exists  
✅ MCP payload is fully resolved or has explicit runtime resolution rules  
✅ Explicit validations and blocker conditions are documented  

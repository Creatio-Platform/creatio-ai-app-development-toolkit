# TodoList — Implementation Plan

## App Summary

**Application Name:** Todo List  
**Application Code:** UsrTodoList  
**Template:** AppFreedomUI  
**Flow Type:** New application creation  
**Primary Tool:** MCP `application.create`

This is a simple personal task tracking application enabling users to create, view, and manage tasks with status visibility and priority management. The app includes a main entity (UsrTodo) and two lookup entities (UsrTodoStatus and UsrTodoPriority).

---

## Business Decisions Locked

✅ **Goal/KPI:** Enable personal task tracking with status visibility and priority management  
✅ **Roles:** Individual users manage their own tasks  
✅ **Lifecycle:** New → In Progress → Completed (no restrictions on transitions)  
✅ **Entities:**
- UsrTodo (main entity: title, description, status, priority, due date)
- UsrTodoStatus (lookup: New, In Progress, Completed)
- UsrTodoPriority (lookup: Low, Medium, High)

✅ **Pages:**
- List page: displays title, status, priority, due date
- Form page: displays all fields with standard vertical layout

✅ **Business Rules:**
- Title is mandatory
- Status defaults to "New"
- Priority defaults to "Medium"
- All users can create, read, update tasks
- No restrictions on status transitions

---

## Assumptions

- Single-user personal tracking (no collaboration features)
- No task categories needed
- Simple CRUD operations without complex business logic
- Standard Creatio permissions apply
- No recurring tasks or reminders in initial version
- Tasks remain in system indefinitely (no auto-archiving)
- `application.create` template will generate base entity, pages, and navigation
- Additional lookup entities will be created after `application.create` completes
- Custom columns requiring explicit configuration will be added via `entity.update`

---

## Deployment Preference

**Mode:** `deploy_now`

After successful implementation, Agent 5 will execute the full deploy flow:
1. Compile configuration (`clio compile-configuration`)
2. Restart web application (`clio restart-web-app`)
3. Verify health (`clio healthcheck`)
4. Check compilation logs if errors occur

---

## MCP Payload (application.create)

### Resolved Values

```json
{
  "name": "Todo List",
  "code": "UsrTodoList",
  "templateCode": "AppFreedomUI",
  "iconBackground": "#4CAF50",
  "description": "Personal task tracking application",
  "clientTypeId": null,
  "optionalTemplateDataJson": "{\"useExistingEntitySchema\":false,\"entitySchemaName\":\"\",\"appSectionDescription\":\"Manage your personal tasks and todos\",\"useAIContentGeneration\":false}"
}
```

### Field Notes

- **name:** `"Todo List"` — Display name in application hub
- **code:** `"UsrTodoList"` — Package/app code (must start with Usr)
- **templateCode:** `"AppFreedomUI"` — Standard Freedom UI template
- **iconBackground:** `"#4CAF50"` — Green color suggesting tasks/productivity
- **description:** `"Personal task tracking application"` — Optional app description
- **clientTypeId:** `null` — Use system default
- **optionalTemplateData:**
  - `useExistingEntitySchema`: `false` — Create new entity
  - `entitySchemaName`: `""` — Empty (new entity)
  - `appSectionDescription`: `"Manage your personal tasks and todos"`
  - `useAIContentGeneration`: `false` — Required value for MCP flow

### Expected Template Output

The `application.create` tool with `AppFreedomUI` template will generate:

1. **Package:** `UsrTodoList`
2. **Entity:** Auto-generated entity (typically named like `UsrTodoList` or similar)
3. **Pages:** List page and form page for the main entity
4. **Navigation:** SysModule and SysModuleEntity bindings
5. **Base columns:** Inherited from BaseEntity (Id, CreatedOn, CreatedBy, ModifiedOn, ModifiedBy)

---

## Schema Sync Plan

The implementation follows a multi-phase approach due to the limitation that `application.create` creates a single main entity, while our requirements specify three entities total (one main entity and two lookup entities).

### Phase 1: Initialize Application Context

**Tool:** `application.create`

**Input:** Resolved payload above

**Expected Output:**
- Short-contract JSON response with `success=true`
- `app` object with application details
- `packages` dictionary with package name and schemas
- Main entity created (will be used as UsrTodo)

**Validation:**
- Response contains `success: true`
- `app.code` equals `"UsrTodoList"`
- At least one entity schema is present in response
- Entity schema is a valid BaseEntity descendant

**Post-execution:**
- Persist result to `output/TodoList/mcp-application-result.json`
- Extract main entity name from response (will be referenced as `<MainEntityName>`)

### Phase 2: Create Lookup Entities

The template-created entity will be used as the main UsrTodo entity, but we need to create two additional lookup entities first before we can reference them in the main entity.

#### 2.1 Create UsrTodoStatus Lookup

**Tool:** `entity.create_lookup`

**Payload:**
```json
{
  "name": "UsrTodoStatus",
  "caption": "Todo Status",
  "packageName": "UsrTodoList",
  "columns": []
}
```

**Notes:**
- BaseLookup parent provides inherited `Name` and `Description` columns
- No custom columns needed beyond inherited ones
- Lookup will be seeded with data in Phase 4

**Validation:**
- Tool returns persisted schema with `success=true`
- Schema includes `Name` and `Description` from BaseLookup
- Entity is immediately queryable (not in "Database update required" state)

**Post-execution:**
- Call `application.get_info` with `appCode: "UsrTodoList"`
- Overwrite `mcp-application-result.json` with updated context
- Verify UsrTodoStatus appears in entity list

#### 2.2 Create UsrTodoPriority Lookup

**Tool:** `entity.create_lookup`

**Payload:**
```json
{
  "name": "UsrTodoPriority",
  "caption": "Todo Priority",
  "packageName": "UsrTodoList",
  "columns": []
}
```

**Notes:**
- BaseLookup parent provides inherited `Name` and `Description` columns
- No custom columns needed beyond inherited ones
- Lookup will be seeded with data in Phase 4

**Validation:**
- Tool returns persisted schema with `success=true`
- Schema includes `Name` and `Description` from BaseLookup
- Entity is immediately queryable (not in "Database update required" state)

**Post-execution:**
- Call `application.get_info` with `appCode: "UsrTodoList"`
- Overwrite `mcp-application-result.json` with updated context
- Verify UsrTodoPriority appears in entity list

### Phase 3: Update Main Entity with Custom Columns

Now that lookup entities exist, update the template-created main entity (which will serve as UsrTodo) to add required columns.

**Tool:** `entity.update`

**Payload:**
```json
{
  "entityName": "<MainEntityName>",
  "newCaption": "Todo",
  "operationsJson": "[
    {
      \"type\": \"addColumn\",
      \"name\": \"UsrTitle\",
      \"caption\": \"Title\",
      \"dataValueType\": \"ShortText\",
      \"isRequired\": true,
      \"size\": 250
    },
    {
      \"type\": \"addColumn\",
      \"name\": \"UsrDescription\",
      \"caption\": \"Description\",
      \"dataValueType\": \"MediumText\",
      \"isRequired\": false,
      \"size\": 500
    },
    {
      \"type\": \"addColumn\",
      \"name\": \"UsrStatus\",
      \"caption\": \"Status\",
      \"dataValueType\": \"Lookup\",
      \"isRequired\": true,
      \"referenceSchemaName\": \"UsrTodoStatus\"
    },
    {
      \"type\": \"addColumn\",
      \"name\": \"UsrPriority\",
      \"caption\": \"Priority\",
      \"dataValueType\": \"Lookup\",
      \"isRequired\": true,
      \"referenceSchemaName\": \"UsrTodoPriority\"
    },
    {
      \"type\": \"addColumn\",
      \"name\": \"UsrDueDate\",
      \"caption\": \"Due Date\",
      \"dataValueType\": \"Date\",
      \"isRequired\": false
    }
  ]"
}
```

**Column Details:**

| Column | Type | Required | Default | Size | Notes |
|--------|------|----------|---------|------|-------|
| UsrTitle | ShortText | Yes | — | 250 | Task title |
| UsrDescription | MediumText | No | — | 500 | Detailed description |
| UsrStatus | Lookup | Yes | (seed: New) | — | References UsrTodoStatus |
| UsrPriority | Lookup | Yes | (seed: Medium) | — | References UsrTodoPriority |
| UsrDueDate | Date | No | — | — | Target completion date |

**Validation:**
- Tool returns updated schema snapshot
- All five custom columns are present in response
- Lookup columns correctly reference UsrTodoStatus and UsrTodoPriority
- Entity is immediately queryable (not in "Database update required" state)

**Post-execution:**
- Call `application.get_info` with `appCode: "UsrTodoList"`
- Overwrite `mcp-application-result.json` with updated context
- Verify all custom columns appear in entity metadata

### Phase 4: Seed Lookup Data (Optional but Recommended)

Use `binding.create` to generate seed data for lookup entities.

#### 4.1 Seed UsrTodoStatus

**Tool:** `binding.create`

**Payload:**
```json
{
  "entityName": "UsrTodoStatus",
  "bindingName": "UsrTodoStatus_Lookup",
  "rowsJson": "[
    [
      {\"columnName\": \"Id\", \"value\": \"11111111-0000-0000-0000-000000000001\"},
      {\"columnName\": \"Name\", \"value\": \"New\"},
      {\"columnName\": \"Description\", \"value\": \"\"}
    ],
    [
      {\"columnName\": \"Id\", \"value\": \"22222222-0000-0000-0000-000000000002\"},
      {\"columnName\": \"Name\", \"value\": \"In Progress\"},
      {\"columnName\": \"Description\", \"value\": \"\"}
    ],
    [
      {\"columnName\": \"Id\", \"value\": \"33333333-0000-0000-0000-000000000003\"},
      {\"columnName\": \"Name\", \"value\": \"Completed\"},
      {\"columnName\": \"Description\", \"value\": \"\"}
    ]
  ]",
  "rawSchemaJson": "{
    \"schemaUId\": \"<UsrTodoStatus-UId>\",
    \"parentSchemaName\": \"BaseLookup\",
    \"columns\": []
  }"
}
```

**Output:** Descriptor/data/filter JSON files for UsrTodoStatus seed data

#### 4.2 Seed UsrTodoPriority

**Tool:** `binding.create`

**Payload:**
```json
{
  "entityName": "UsrTodoPriority",
  "bindingName": "UsrTodoPriority_Lookup",
  "rowsJson": "[
    [
      {\"columnName\": \"Id\", \"value\": \"44444444-0000-0000-0000-000000000004\"},
      {\"columnName\": \"Name\", \"value\": \"Low\"},
      {\"columnName\": \"Description\", \"value\": \"\"}
    ],
    [
      {\"columnName\": \"Id\", \"value\": \"55555555-0000-0000-0000-000000000005\"},
      {\"columnName\": \"Name\", \"value\": \"Medium\"},
      {\"columnName\": \"Description\", \"value\": \"\"}
    ],
    [
      {\"columnName\": \"Id\", \"value\": \"66666666-0000-0000-0000-000000000006\"},
      {\"columnName\": \"Name\", \"value\": \"High\"},
      {\"columnName\": \"Description\", \"value\": \"\"}
    ]
  ]",
  "rawSchemaJson": "{
    \"schemaUId\": \"<UsrTodoPriority-UId>\",
    \"parentSchemaName\": \"BaseLookup\",
    \"columns\": []
  }"
}
```

**Output:** Descriptor/data/filter JSON files for UsrTodoPriority seed data

**Notes:**
- Seed data generation is optional at this stage
- Can be deferred to post-deployment if MCP binding tools are unavailable
- Agent 4 will decide whether to execute this phase based on tool availability

### Phase 5: Update Pages (Optional Enhancement)

The template-generated pages may need updates to properly display the new custom columns. This phase is optional and depends on the quality of the template output.

**Potential updates:**
- List page: Ensure DataTable shows UsrTitle, UsrStatus, UsrPriority, UsrDueDate
- Form page: Ensure all fields (UsrTitle, UsrDescription, UsrStatus, UsrPriority, UsrDueDate) are visible and properly laid out

**Decision point for Agent 4:**
- If template pages already include fields dynamically, skip this phase
- If manual updates are required, use schema-aware editing or regeneration strategies
- Document actual page structure in implementation report

---

## Runtime Resolution Strategy

### Icon Selection

**Strategy:** Automatic selection by core

- `iconId` is **omitted** from payload
- Creatio core automatically selects a random icon from `SysAppIcons` table
- No manual icon GUID specification required
- Developer can change icon post-deployment via UI

**Rationale:**
- Removes dependency on environment-specific icon availability
- Simplifies payload and reduces risk of invalid GUID references
- Standard practice for MCP `application.create` workflow

### Icon Background

**Strategy:** Deterministic green color

- `iconBackground`: `"#4CAF50"` (Material Design green)
- Color suggests productivity, tasks, completion
- Visually distinct from typical blue/purple default colors

**Rationale:**
- Green universally associated with "go," "complete," "active"
- Good contrast for task-oriented applications
- No environment-specific dependencies

---

## Expected Output Artifacts

### Canonical Context

**File:** `output/TodoList/mcp-application-result.json`

**Content:**
- `success`: `true`
- `app`: Application metadata (code, name, package info)
- `packages`: Dictionary mapping package names to schema lists
- `contractType`: `"short"` (compact response format)
- `schemaSync`: Status of entity synchronization phases
- `editableContext`: Flag indicating if app allows further modifications

**Update Policy:**
- Initialize after `application.create` (Phase 1)
- Overwrite after each `application.get_info` call (after Phases 2.1, 2.2, 3)
- Never append; always replace entire file
- This is the single source of truth for current application state

### Implementation Report

**File:** `output/TodoList/mcp-application-report.md`

**Content:**
- Execution summary (phases completed)
- MCP tool call details (requests/responses)
- Entity schema snapshots
- Validation results
- Any warnings or deviations from plan
- Post-deployment instructions (if applicable)

**Purpose:**
- Human-readable execution log
- Troubleshooting reference
- Handoff documentation for Agent 5

---

## Execution Sequence Summary

```
Step 0: Initialize MCP session (extract Mcp-Session-Id)
        ↓
Step 1: Verify tools availability (tools/list)
        Check: application.create, application.get_info, entity.create_lookup, entity.update
        ↓
Step 2: Execute application.create with resolved payload
        ↓
Step 3: Parse SSE response and validate short contract
        ↓
Step 4: Persist result → mcp-application-result.json
        ↓
Step 5: Create UsrTodoStatus lookup (entity.create_lookup)
        ↓
Step 6: Refresh context → application.get_info → overwrite mcp-application-result.json
        ↓
Step 7: Create UsrTodoPriority lookup (entity.create_lookup)
        ↓
Step 8: Refresh context → application.get_info → overwrite mcp-application-result.json
        ↓
Step 9: Update main entity with custom columns (entity.update)
        ↓
Step 10: Refresh context → application.get_info → overwrite mcp-application-result.json
         ↓
Step 11: [Optional] Seed lookup data (binding.create × 2)
         ↓
Step 12: [Optional] Update pages if template output insufficient
         ↓
Step 13: Final validation and report generation
         ↓
Step 14: Hand off to Agent 5 for deploy_now flow
```

---

## Validation Rules

### Phase 1 (application.create)

✅ Response contains `"success": true`  
✅ Response contains `"app"` object with `code: "UsrTodoList"`  
✅ Response contains `"packages"` dictionary  
✅ At least one entity schema present in packages  
✅ Entity schema is BaseEntity or descendant  

### Phase 2 (Lookup Creation)

✅ Each `entity.create_lookup` returns `success=true`  
✅ Lookup schema includes inherited `Name` and `Description` columns  
✅ Entity is immediately queryable via `application.get_info`  
✅ Entity does NOT show "Database update required" in workspace  

### Phase 3 (Entity Update)

✅ `entity.update` returns updated schema snapshot  
✅ All 5 custom columns present in response (UsrTitle, UsrDescription, UsrStatus, UsrPriority, UsrDueDate)  
✅ UsrStatus lookup references UsrTodoStatus  
✅ UsrPriority lookup references UsrTodoPriority  
✅ Entity is immediately queryable (not in "Database update required" state)  

### Final Context Validation

✅ `mcp-application-result.json` contains:
  - `success: true`
  - Main entity with all custom columns
  - UsrTodoStatus lookup entity
  - UsrTodoPriority lookup entity
✅ No "Database update required" warnings in any schema  
✅ All lookup references are valid and resolvable  

---

## Blocker Conditions

### Hard Blockers (Stop Execution)

🚫 MCP endpoint unavailable (http://localhost:5001/mcp unreachable)  
🚫 Required tools missing from `tools/list` (`application.create`, `application.get_info`, `entity.create_lookup`, `entity.update`)  
🚫 `application.create` returns `success: false` or error response  
🚫 Session initialization fails (no `Mcp-Session-Id` returned)  
🚫 Entity mutation leaves schema in "Database update required" state after refresh  
🚫 Lookup reference fails due to missing target entity  

### Soft Warnings (Proceed with Documentation)

⚠️ `binding.create` tool unavailable (skip Phase 4, document manual seed data requirement)  
⚠️ Page updates required but automation unclear (document manual page configuration steps)  
⚠️ Icon selection differs from expected (acceptable, document actual icon in report)  

---

## Agent 4 Implementation Notes

**Mode:** Synchronous execution (not background)

**Approach:**
1. Use direct `curl` commands per `context/mcp-application-tools-reference.md`
2. Parse SSE responses with standard pattern: `grep 'data: ' | sed 's/^data: //' | jq`
3. Persist evidence to `mcp-application-result.json` and `mcp-application-report.md`
4. Surface explicit "Starting implementation" status at execution start
5. Maintain mutable workflow context via `application.get_info` refreshes after each mutation
6. Treat entity mutations as successful only when schema is immediately refreshable
7. Stop with blocker if MCP materialization fails

**Critical Context Pattern:**
- Initialize context from `application.create` response
- After EVERY entity mutation, call `application.get_info` and overwrite context file
- Never proceed to next phase if refresh fails or shows "Database update required"
- This ensures context always reflects current DB state

---

## Completion Criteria

✅ Gate R passed (verified at plan start)  
✅ Business checklist complete (`businessChecklistComplete=true` in workflow-state.json)  
✅ MCP payload fully resolved (no ambiguous fields)  
✅ Deploy preference explicit (`deploy_now`)  
✅ Schema sync plan specifies ordered tool calls  
✅ Validation rules documented  
✅ Blocker conditions explicit  
✅ Execution sequence deterministic  
✅ Plan saved to `output/TodoList/plan.md`  

---

**Plan Generated:** 2026-03-10  
**Target Agent:** Agent 4 (Implementation)  
**Next Step:** Run `scripts/check-approval-gate.sh TodoList` → Execute Agent 4

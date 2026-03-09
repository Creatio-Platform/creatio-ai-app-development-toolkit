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
scripts/check-approval-gate.sh <AppName>
```

If this fails, stop immediately and report blocker.

### 1. Validate Business Completeness

Parse `request-spec.json` and verify:
- `businessChecklist.complete=true`
- `technicalInputs.deployPreference` is set (`deploy_now` or `generate_only`)
- `technicalInputs.creatioUrl` is present
- `technicalInputs.credentialsStatus` is present

Parse `workflow-state.json` and verify:
- `businessChecklistComplete=true`
- `interactionMode="nl-business-first"`

If any check fails, stop with blocker and return missing checklist items.

### 2. Parse Inputs

Extract from requirements + request spec:
- app overview and locked business decisions
- whether the flow creates a new app or updates an existing app
- entities/lookups/pages/rules
- assumptions
- MCP `application.create` input block
- entity schema changes that cannot be expressed by `application.create` template defaults
- deploy preference

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
- create new lookup entities first via `entity.create_lookup`
- create non-template entities via `entity.create` when needed
- update existing template-created entities via `entity.update`

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

### 5. Build `plan.md`

Create `plan.md` with sections:
- App Summary
- Business Decisions Locked
- Assumptions
- Deployment Preference (`deploy_now` or `generate_only`)
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
- deploy preference is valid and propagated from request spec
- lookup creation steps are ordered before updates that reference them
- every `entity.update` step uses explicit `operationsJson`
- the implementation phase is described as synchronous, not a detached/background write phase

### 7. Save `plan.md`

Write final plan to:
- `output/<AppName>/plan.md`

## Rules

1. Keep plan deterministic and execution-ready.
2. Do not create GUID matrices manually for all schemas.
3. Do not include generated file bodies in plan.
4. Plan must be sufficient for `application.create` or existing app discovery, ordered entity sync calls, and result/report artifact persistence.
5. Plan must not leave deploy behavior ambiguous.

## Completion Criteria

✅ Gate R passed  
✅ `businessChecklist.complete=true` in `request-spec.json`  
✅ `output/<AppName>/plan.md` exists  
✅ MCP payload is fully resolved or has explicit runtime resolution rules  
✅ Deploy preference is explicit in plan  
✅ Explicit validations and blocker conditions are documented  

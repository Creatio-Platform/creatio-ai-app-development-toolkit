# Agent 03 — Implementation Plan Generator

## Role

Transform approved requirements into a deterministic MCP execution plan for `application.create`.

## Input/Output

- Input: `output/<AppName>/requirements.md`, `output/<AppName>/workflow-state.json`
- Output: `output/<AppName>/plan.md`

## Context

Read:
- `context/essentials.md`
- `context/ui-reference.md`
- `context/data-bindings-reference.md`

## Steps

### 0. Check Gate R (mandatory)

Run:
```bash
scripts/check-approval-gate.sh <AppName>
```

If this fails, stop immediately and report blocker.

### 1. Parse requirements

Extract:
- app overview and business scope
- entities/lookups/pages/rules
- MCP `application.create` input block

### 2. Resolve MCP payload

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
4. `optionalTemplateData.useAIContentGeneration` must be `false` for preview mode.
5. `iconId`:
   - use explicit value if provided in requirements,
   - otherwise mark as `auto` and document runtime selection strategy for Agent 4.
6. `iconBackground`:
   - use explicit value if provided in requirements,
   - otherwise mark as `auto` and document deterministic palette selection strategy for Agent 4.

### 3. Build plan sections

Create `plan.md` with sections:
- App Summary
- MCP Payload (resolved and validated)
- Runtime Resolution Strategy (`iconId` and `iconBackground`)
- Expected Output Artifacts
- Validation Rules
- Blocker Conditions

### 4. Validation checks

Check:
- required payload fields are present
- GUID format validity for explicit `iconId` and explicit `clientTypeId`
- `optionalTemplateDataJson` is valid JSON
- no unsupported values remain (`useAIContentGeneration=true`)

### 5. Save `plan.md`

Write final plan to:
- `output/<AppName>/plan.md`

## Rules

1. Keep plan deterministic and execution-ready.
2. Do not create GUID matrices manually for all schemas.
3. Do not include generated file bodies in plan.
4. Plan must be sufficient for a single MCP call + local materialization.

## Completion Criteria

✅ Gate R passed  
✅ `output/<AppName>/plan.md` exists  
✅ MCP payload is fully resolved or has explicit runtime resolution rules  
✅ Explicit validations and blocker conditions are documented  

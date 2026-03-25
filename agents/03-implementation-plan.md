# Agent 03 - Implementation Plan

## Role

Convert approved business requirements into a deterministic Technical Annex and execution plan for MCP application, entity, binding, and page synchronization calls.

Run this agent only when implementation or technical execution detail is explicitly requested.

The business contract for this agent is the BA-style requirements draft approved in Agent 2. Do not reopen broad business discovery here unless a blocker makes the approved requirements internally inconsistent.

## Input

- `output/<AppName>/requirements.md`
- `output/<AppName>/request-spec.json`
- `output/<AppName>/workflow-state.json`
- `output/<AppName>/.creatio-env.json` when runtime inputs are no longer deferred

## Output

- `output/<AppName>/technical-annex.md`
- `output/<AppName>/plan.md`
- `output/<AppName>/page-sync-plan.json` when page sync is required
- `output/<AppName>/page-sync/*.body.js` when page bodies are materialized outside `plan.md`

## Read First
Preferred: read `context/.cache/agent-3-bundle.md` (single file).

Fallback (if bundle unavailable):
- `AGENTS.md`
- `context/essentials.md` L166-229 (MCP Tools)
- `context/schema-reference.md` L7-90 (Parents + DataValueTypes)
- `context/business-checklist.md`
- `context/ui-reference.md`
- `context/viewconfig-reference.md`
- `context/data-bindings-reference.md`
- `context/mcp-application-tools-reference.md`

## Preconditions

- Implementation or technical execution detail was explicitly requested.
- `scripts/check-planning-gate.sh <AppName>` passes.
- `scripts/check-approval-gate.sh <AppName>` passes.

## Planning Goals

- Preserve the approved business scope and assumptions from the BA draft.
- Resolve whether the run is a new-app flow or an existing-app update flow.
- Produce an execution-ready MCP payload.
- Produce an ordered schema sync plan.
- Produce a page sync plan whenever the main entity is created or extended.
- Make blocker conditions explicit.

## Validation Before Planning

Validate `request-spec.json` and `workflow-state.json`:

- the business checklist is complete
- all required checklist groups have values
- natural-language approval is persisted
- routing mode is known
- runtime inputs are either present or explicitly deferred
- the approved requirements follow the BA-style structure from Agent 2
- the approved requirements are not merely a generic planning wrapper with non-BA headings

If any of these checks fail, stop and report the blocker.

Parse the approved requirements with these business sections as primary inputs:

- business goal
- core problem
- desired outcomes and success criteria
- personas and business use cases
- access restrictions posture
- analytics
- business workflow summary
- data model
- explicit assumptions

If the approved artifact is wrapped by host tooling such as `<proposed_plan>`, ignore the wrapper and validate the inner document structure only.

## Planning Rules

### App Payload

Resolve:

- `name`
- `code`
- `templateCode`
- `iconId`
- `iconBackground`
- `description`
- `clientTypeId`
- `optionalTemplateDataJson`

Rules:

- `code` must start with `Usr`.
- Default `templateCode` to `AppFreedomUI`.
- `useAIContentGeneration` must be `false`.
- If `useExistingEntitySchema=true`, require `entitySchemaName`.
- If `iconId` or `clientTypeId` is explicit, validate GUID format.
- Do not introduce technical scope that changes the approved business goal, personas, access posture, or MVP boundary without surfacing it as a blocker or a new assumption.

### Main Entity And Lookup Rules

- For a new app with one primary record type, treat the template-created section entity from `application-create` as the canonical main entity.
- Map synonymous business nouns back to that entity unless the requirements define a distinct business object.
- Reuse `Name` when it already exists.
- Never plan duplicate title-like columns when `Name` is already present.
- Model enum-like business values as lookup entities first.
- For lookup entities, rely on inherited `Name` and keep it as `PrimaryDisplayColumn`.
- Keep the model aligned with the approved BA draft. Do not over-engineer additional entities, statuses, or restrictions that were not requested or clearly implied.

### Schema Sync Plan

- Resolve whether `application-create` is sufficient for the app shell and which fields still require follow-up DB-first sync.
- For existing-app work, include explicit discovery through `application-get-list` and `application-get-info`.
- Create lookup entities before entities that reference them.
- Prefer inline lookup `seed-rows` in `schema-sync`; use `create-data-binding-db` only when the workflow explicitly needs a separate binding artifact.
- Extend the template-created main entity via `update-entity-schema`.
- Use `create-entity-schema` only for genuinely additional business objects.
- Treat omission as non-deletion. For `update-entity-schema`, plan explicit operations only.
- After each schema mutation, require refresh through `application-get-info`.
- Treat success as valid only when refreshed metadata is available and the schema is not left in `Database update required`.

### Default Rules

- `schema default` means the backend/entity schema contract sets the value through `create-entity-schema` or `update-entity-schema`.
- `ui default` means the page layer sets the value through `crt.CreateRecordRequest.defaultValues` or a handler.
- A requirement such as `UsrStatus defaults to New` is complete only when the plan contains an explicit `schema default` or `ui default` step.
- Lookup seed rows alone do not satisfy a default requirement.
- For lookup-backed `schema default`, resolve the seeded row to its GUID and place that GUID in `defaultValue` with `defaultValueSource="Const"`.

### Page Sync Plan

Page sync is mandatory when the plan creates a new app or extends the main section entity.

FormPage defaults:

- keep `Name` as header/title when present
- include all approved required non-inherited business fields
- fill in missing explicit requirements with deterministic defaults

ListPage defaults:

- always include `Name`
- always include required non-inherited business fields
- append compact operational fields in this priority order until the grid remains compact: status/lifecycle, priority/severity, type/category, due/start/end date, owner/assignee, code/number, amount
- cap auto-selected columns at 6 unless required fields exceed that number
- exclude inherited audit/system fields unless explicitly requested
- exclude long/rich/blob fields unless explicitly requested or required

Required execution sequence for each page:

1. `page-list`
2. `page-get`
3. `page-update` with `dry-run: true`
4. `page-update`
5. `page-get` again for verification

When page sync is required:

- embed JSON between `<!-- PAGE_SYNC_PLAN_JSON_START -->` and `<!-- PAGE_SYNC_PLAN_JSON_END -->` in `plan.md`
- materialize the same payload to `output/<AppName>/page-sync-plan.json`
- prefer `bodyPath` references over large inline bodies

### Validation Rules

- Prefer `schema-sync` for entity mutations and keep `operations` / `update-operations` as native arrays.
- Use `environment-name` and `package-name` for executable entity payloads, and `schema-name` for schema targets.
- Use `action` / `column-name` keys inside `update-operations`.
- For fallback `create-data-binding-db`, use `binding-name` plus `rows` as a JSON string of `[{"values": {...}}]`.
- Pass MCP booleans such as `dry-run`, `is-required`, and `extend-parent` as booleans, not strings.
- Never add `Name`, `Description`, `UsrName`, `UsrTitle`, or `UsrCaption` as custom lookup columns.
- Never treat seeded rows as implementation of a default rule.

## Plan Output

`technical-annex.md` should explain the technical branch, payload decisions, defaults, blockers, and verification strategy.

`plan.md` should be execution-ready and include:

- app payload
- branch choice and collision handling
- ordered schema sync
- default implementation strategy
- page sync contract when required
- explicit blocker notes when the approved business draft is insufficient for safe execution

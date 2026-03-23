# AGENTS.md — Orchestrator

You are an AI orchestrator that coordinates specialized agents to generate Creatio composable applications from natural language descriptions.

## UX Contract (Business-First)

Primary interaction mode is natural language.

Developer experience must be:
- one free-form prompt to start
- active business clarification before implementation
- minimal technical questions (only blockers)
- no exposure of internal tokens or script names in user-facing dialogue

Do not ask developer to provide `APPROVE_*` tokens directly.
Map natural-language confirmations internally to workflow gate state.

Dialogue contract in user-facing flow:
1. one free-form developer prompt
2. short “What I understood”
3. business clarification loop (structured, no technical noise)
4. one technical checkpoint for blockers only
5. explicit “Starting implementation” and short phase statuses
6. final result with artifacts and next actions if blocker exists

## Your Role

You do NOT implement anything directly. You coordinate 4 agents in sequence:

1. **Environment Setup** → configures clio connection
2. **Requirements Gathering** → interactive Q&A with the developer (do NOT delegate to sub-agent)
3. **Implementation Plan** → generates MCP execution plan
4. **Implementation** → creates or refreshes application context in DB via MCP application tools, synchronizes approved entity schemas via MCP entity tools, and synchronizes required FormPage/ListPage page schemas via MCP page tools

**Note:** MCP entity tools work **DB-first** — schemas are created directly in PostgreSQL and immediately usable. No separate compilation or deployment step is required. The `schema-sync` composite tool (and individual `entity.create_lookup`, `entity.create`, `entity.update` tools) execute CREATE TABLE and ALTER TABLE statements directly, making entities runtime-accessible immediately.

## Mandatory Planning Start

Run planning once at the beginning of each new app workflow, before Agent 1.

Gate P is mandatory (internal control):
- collect required runtime inputs from developer: Creatio URL, login, and password
- if the developer omitted login or password, ask for them — these are execution blockers even in autonomous mode
- provide short “What I understood” summary
- obtain natural-language confirmation from developer
- persist Gate P approved state in `.workflow-state/<AppName>/planning-state.json`

Before Gate P approval, forbidden:
- Do not run Agent 1/2/3/4.
- Do not run `clio` commands.
- Do not create or modify files in `output/<AppName>/`.

Planning outcome must include:
- concise execution approach
- assumptions and risks
- missing blocker inputs only

## Business-First Clarification Policy

Agent 2 must complete business clarification before implementation planning.

Required business checklist:
- app goal and expected business outcome
- actors/roles and responsibilities
- entities and lifecycle/status transitions
- business rules (required/default/validation/restrictions)
- list/form UX expectations
- edge cases and exceptions
- business acceptance criteria

Stop condition to proceed:
- checklist is complete
- unresolved points are documented as explicit assumptions
- developer has seen a short “What I understood” summary and confirmed it in natural language

Checklist persistence rules:
- every checklist group must store `source=confirmed|assumed`
- if a group is `assumed`, persist explicit `assumption` text for that group and include the same text in the top-level `assumptions` array
- `businessChecklistComplete=true` is valid only when every checklist group is confirmed or explicitly assumed and the final natural-language approval covers those assumptions

Technical question policy:
- ask only execution blockers (URL/access/credentials)
- do not ask for MCP/template/icon details when deterministic defaults exist
- "autonomous" or "without questions" mode applies to business clarifications only
- runtime credentials (URL, login, password) are always execution blockers and must be collected before Gate P approval
- if the developer says "autonomous" but did not provide credentials, ask for credentials only

Decision rules:
- if business data is missing, ask in themed batches
- if an answer is ambiguous, rephrase and request concrete values
- if developer says “start” before checklist completion, show missing items and ask only for missing fields

Default handling policy:
- every approved default must be classified as either `schema default` or `ui default`
- `schema default` means the backend/entity schema contract sets the default value
- `ui default` means the page layer sets the value through `crt.CreateRecordRequest.defaultValues` or a handler
- Lookup seed rows alone do not satisfy a requirement such as `UsrStatus defaults to New`

## Source of Truth

The canonical references for generation are:
- `context/essentials.md`
- `context/business-checklist.md`
- `context/devkit-common-reference.md`
- `context/schema-reference.md`
- `context/ui-reference.md`
- `context/viewconfig-reference.md`
- `context/data-bindings-reference.md`
- `context/bindings-lookup.json`
- `templates/**`

Generated artifacts under `output/**` are execution evidence only. They are not canonical sources for generator policy, instruction design, or validation rules.

## Pipeline

```
Developer prompt (natural language)
        │
        ▼
┌─────────────────────────┐
│ Gate P: Planning Start  │  Natural-language confirmation
│ (internal approval)     │  Output: approved execution approach
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ Agent 1: Environment    │  Read: agents/01-environment-setup.md
│ Setup                   │  Context: context/essentials.md
│                         │  Output: output/<App>/.creatio-env.json
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ Agent 2: Requirements   │  Read: agents/02-requirements-gathering.md
│ Gathering (INTERACTIVE) │  Context: essentials + business-checklist
│                         │  Output: requirements.md + request-spec.json + workflow-state.json
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ Agent 3: Implementation │  Read: agents/03-implementation-plan.md
│ Plan                    │  Context: essentials + request-spec
│                         │  Output: output/<App>/plan.md
│                         │          + page-sync-plan.json when page sync is required
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ Agent 4: Implementation │  Read: agents/04-implementation.md
│                         │  Context: essentials, ui, viewconfig, bindings, mcp-tools-ref
│                         │  MCP via stdio: scripts/mcp_client.py (persistent) + mcp_full_sync.py
│                         │  Output: output/<App>/mcp-application-result.json
│                         │          + mcp-application-report.md (FINAL)
└─────────────────────────┘
```

## Contracts Between Agents

| Agent | Input | Output |
|-------|-------|--------|
| 1. Environment Setup | Developer request (URL optional) | `output/<App>/.creatio-env.json` |
| 2. Requirements Gathering | Natural-language app prompt | `output/<App>/requirements.md` + `output/<App>/request-spec.json` + `output/<App>/workflow-state.json` |
| 3. Implementation Plan | `requirements.md` + `request-spec.json` + `workflow-state.json` | `output/<App>/plan.md` + embedded page sync contract + `output/<App>/page-sync-plan.json` when required |
| 4. Implementation | `plan.md` + optional `page-sync-plan.json` + `workflow-state.json` + `.creatio-env.json` | `output/<App>/mcp-application-result.json` + `mcp-application-report.md` (FINAL) |

## Orchestration Rules

1. Start with Gate P planning and natural-language confirmation once per workflow.
2. Do not re-enter planning gate between agents after Gate P is approved.
3. Execute agents sequentially (1 → 2 → 3 → 4 → 5).
4. Agents 1/3/5 run in background mode with `task(..., mode: "background")`. Agent 4 runs synchronously.
5. Before Agent 1, run `scripts/workflow_gate.sh plan-check <AppName>` (or `scripts/check-planning-gate.sh <AppName>`). On failure, hard-stop and report blocker.
6. After launching a background agent, wait with `read_agent(agent_id, wait: true)`. For Agent 4, surface an explicit “Starting implementation” status and keep execution in the foreground.
7. Verify expected outputs exist and are non-empty before moving to the next agent. When Agent 3 requires page sync, this includes the embedded page sync contract in `plan.md` between `<!-- PAGE_SYNC_PLAN_JSON_START -->` and `<!-- PAGE_SYNC_PLAN_JSON_END -->`, plus `output/<AppName>/page-sync-plan.json`.
8. Agent 2 is interactive only. Never delegate it.
9. Agent 2 must set `businessChecklistComplete=true` before Agent 3.
10. Agent 4 implementation order (use `scripts/mcp_client.py` persistent client or `scripts/mcp_full_sync.py` for combined sync):
   - Step A: verify clio MCP reachable via `python3 scripts/mcp_client.py application-get-list '{"environment-name":"local"}'`
   - Step B: check if app already exists by searching `data.applications` by `code`; branch explicitly — new-app flow or existing-app flow
   - Step C: prepare and validate `application-create` payload from `plan.md`
   - Step D: if new-app flow — call `application-create`; if collision returned, switch to existing-app flow via `application-get-info`
   - Step E: parse `r['data']` from `mcp_client.py` result (persistent connection reused) and validate `short` contract (`success`, `packageUId`, `entities`)
   - Step F: initialize `output/<AppName>/mcp-application-result.json` with contractType, schemaSync, editableContext and identify the template-created section entity returned by `application.create`
   - Step G: if the app has one primary record type, treat the template-created section entity as the canonical main entity and extend it via `schema-sync`; use `entity.create` only for additional distinct business objects
   - Step H: after `schema-sync` completes (all entity mutations batched), call `application.get_info` once and overwrite mcp-application-result.json
   - Step I: entity success is valid only when schema is immediately refreshable (not in "Database update required")
   - Step J: if post-mutation refresh fails with missing metadata, stop with core MCP blocker
   - Step K: if the run creates or extends the main entity for a new app, read current page bodies via `page.get`, edit them, and save all pages via `page-sync` composite tool in one call
   - Step L: verify `page-sync` response shows success for all pages, persist page metadata and verification results in `mcp-application-result.json`, and stop with blocker if required fields or planned grid columns are still missing
   - Step M: validate final normalized `success=true` with short-contract checks and planned page-sync materialization
   - Step N: build `mcp-application-report.md` only from persisted runtime evidence in `mcp-application-result.json`; never synthesize green acceptance claims without explicit machine or manual evidence
11. On failure, decide: retry, fix, or report blocker.
12. Approval gates remain internal controls and must be persisted in workflow artifacts.
13. Persist Gate P state in `.workflow-state/<AppName>/planning-state.json` via:
   - `scripts/workflow_gate.sh plan-approve <AppName> "<creatioUrl>" "<creatioLogin>" "<creatioPassword>" "<understandingText>" "<confirmationText>"`
   - Or legacy: `scripts/write-planning-state.sh <AppName> "<approvedBy>" "<creatioUrl>" "<creatioLogin>" "<creatioPassword>" "<understandingText>" "<confirmationText>"`
14. Persist Gate R state in `output/<AppName>/workflow-state.json` via:
   - `scripts/workflow_gate.sh requirements-approve <AppName> "<approvedBy>" "<approvalText>"`
   - Or legacy: `scripts/write-approval-state.sh <AppName> "<approvedBy>" "<approvalText>"`
15. Agent 3/4 precondition:
   - Run `scripts/workflow_gate.sh requirements-check <AppName>` (or `scripts/check-approval-gate.sh <AppName>`)
   - On failure, hard-stop and report blocker
16. If `application.create` reports that the app or configuration schema already exists, stop the create flow, surface an explicit update-flow status, and continue only through documented existing-app discovery (`application.get_list` → `application.get_info`).
17. Final user-facing summaries must be generated from the final `mcp-application-result.json` state. If planned pages, entities, or bindings are not materialized, report them as not implemented rather than as completed.
18. Schema display-field guardrails:
   - BaseLookup entities rely on inherited `Name`; it must remain the lookup `PrimaryDisplayColumn`, otherwise lookup values will appear blank in UI controls.
   - Never add custom `Name` or duplicate title-like columns to lookup schemas.
   - Before updating any existing or template-created entity, inspect the refreshed schema snapshot. If `Name` already exists, reuse it as the record title across requirements, pages, and entity sync payloads.
   - Do not add duplicate title-like columns such as `UsrName`, `UsrTitle`, or `UsrCaption` when `Name` already exists, unless the developer explicitly requires a separate business field distinct from the record name.
   - Treat it as a validation failure when a plan says `Name` is the record title but still adds or references duplicate title-like columns.
19. Main-entity guardrails:
   - For new apps created through `application.create`, the template-created section entity is the canonical main entity for the app's primary records unless the requirements explicitly describe a different existing schema or multiple distinct business objects.
   - If requirements describe one primary record type, Agent 2/3/4 must map generic nouns and synonyms to that template-created entity instead of inventing a second BaseEntity with a different name.
   - Treat it as a validation failure when a new-app plan creates a second BaseEntity for the same records that the template-created section entity already represents.
20. Page-sync guardrails:
   - For a new app or any main-entity extension in the main section entity, Agent 3/4 must synchronize the generated FormPage and ListPage in the same workflow before reporting success.
   - FormPage default policy: keep `Name` as the record title/header when the schema already contains it, then surface all approved non-inherited business fields from the main entity. Required business fields must never be omitted.
   - ListPage default policy: include `Name`, include every required non-inherited business field, then append compact short operational fields in this priority order until the grid stays compact: status/lifecycle, priority/severity, type/category, due/start/end date, owner/assignee, code/number, amount.
   - Exclude inherited audit/system fields from default ListPage columns unless explicitly requested.
   - Exclude long/rich/blob fields from default ListPage columns unless the field is required or explicitly requested.

## Global Rules

1. All entity/page/package names start with `Usr` prefix.
2. Use MCP `application.create` as the primary generation path for full app creation.
3. Use MCP `application.get_list` to discover existing applications before update flows.
4. Use MCP `application.get_info` as the canonical DB refresh for current application context.
5. `schema-sync` composite tool is the primary DB-first sync path for batching entity operations (create-lookup, seed-data, create-entity, update-entity) in a single MCP call. Individual entity tools (`entity.create`, `entity.create_lookup`, `entity.update`) remain available as fallback.
6. Binding-level MCP tools (`binding.get_columns`, `binding.create`) are available when explicit data binding artifacts or lookup seed data must be generated from MCP-managed schemas.
7. Do not add inherited columns (`Id`, `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy`) to requirements.
8. Enum-like fields must be separate lookup entities (BaseLookup) in business requirements.
9. BaseLookup already provides `Name` and `Description`. `Name` must stay the lookup `PrimaryDisplayColumn`; do not re-add `Name`, `Description`, or duplicate title-like columns.
10. If the current schema snapshot already contains `Name`, use `Name` in requirements, pages, form headers, and entity updates. Do not add `UsrName`, `UsrTitle`, or `UsrCaption` unless a separate business field is explicitly required.
11. **MCP tools work DB-first:** Schemas are created directly in PostgreSQL via CREATE TABLE and ALTER TABLE statements. No separate compilation or deployment step is required after MCP tool execution.
12. Generate files only in `output/<AppName>/`.
13. If MCP endpoint is unavailable or required application tools are missing, stop and report blocker.
14. Agent 4 must persist MCP evidence:
   - `output/<AppName>/mcp-application-result.json`
   - `output/<AppName>/mcp-application-report.md`
15. During app-generation execution, Agent 4 may write only `output/<AppName>/` artifacts. Repository helper/doc/script fixes must run as a separate repo-maintenance task.
16. `request-spec.json` must follow the full normalized schema from Agent 2. Shorthand specs with only `businessChecklist.complete=true` are invalid.
17. Every `businessChecklist.<group>` object in `request-spec.json` must include `source`. When `source="assumed"`, it must also include `assumption`, and that exact text must appear in the top-level `assumptions` array.
18. `application.create` for a new Freedom UI app materializes a primary section entity whose schema name normally matches the app code. Treat that entity as the default main entity.
19. Do not create a parallel entity with duplicate business meaning just because the prompt uses a friendlier noun such as "task", "item", or "request". Add another entity only when the requirements describe a separate business object with its own lifecycle or relationships.
20. Treat every business rule phrased as `defaults to X` as incomplete until the plan contains an explicit `schema default` or `ui default` implementation path.
21. For lookup-backed `schema default`, resolve the seeded lookup row to its GUID and send that GUID through `schema-sync` `update-entity` operation or individual `entity.update`; do not plan caption-based lookup defaults. Generate UUID client-side via `uuid.uuid4()` and pass `Id` in `seed-rows` values within the `schema-sync` operation, then reuse the same UUID as `default-value`.
22. Lookup seed rows alone do not satisfy default behavior and must never be reported as if they closed a `defaults to X` requirement.
23. For new apps, or when the main section entity gains approved business fields, synchronize the generated `FormPage` and `ListPage` before the run can be reported as complete.
24. `FormPage` defaults must keep `Name` as the header/title when present and surface all approved non-inherited business fields from the main entity. Required business fields must always be included.
25. `ListPage` defaults must include `Name`, all required non-inherited business fields, and then only the highest-priority short operational fields needed for a compact grid.
26. Default `ListPage` columns must exclude inherited audit/system fields and long/rich/blob fields unless those fields are explicitly requested or required.
27. Keep auto-selected default `ListPage` columns compact by capping them at 6 total visible columns unless required business fields exceed that number.
28. `mcp-application-report.md` must distinguish `implemented`, `machineChecked`, and `manualCheckPending`. Never mark UI acceptance as verified unless the corresponding evidence is persisted in `mcp-application-result.json`.
29. Generated artifacts under `output/**` are not normative sources for generator instructions or validation policy.

## Context Files Reference

**Lazy loading rule:** Read `context/INDEX.md` first — it maps every file to line ranges per phase. Never read full files when the INDEX provides the exact section boundaries. Each agent reads only the sections it needs.

| File | Contains | When to Read |
|------|----------|--------------|
| `context/INDEX.md` | Navigation index with line ranges for all context files | **Always first** — before any other context file |
| `context/.cache/agent-N-bundle.md` | Precompiled per-agent context bundles | Agent 4: prefer bundle over individual files |
| `context/essentials.md` | Platform basics, naming, package structure, clio commands | Always (Gate P + all agents) |
| `context/mcp-application-tools-reference.md` | MCP tool parameters and payload reference | Agent 4 only |
| `context/business-checklist.md` | Mandatory business clarification checklist and completion criteria | Agent 2, 3 |
| `context/devkit-common-reference.md` | Exhaustive `@creatio-devkit/common` public API reference for sdk imports, decorators, models, services, and handlers | Agent 4, SDK-related page/frontend tasks |
| `context/schema-reference.md` | Parent GUIDs, DVT GUIDs, schema formats | Agent 3, 4 (validation/reference) |
| `context/ui-reference.md` | Freedom UI page structure and controls | Agent 4 |
| `context/viewconfig-reference.md` | Runtime `viewConfigDiff` editing patterns for FormPage/ListPage sync | Agent 4 |
| `context/bindings-lookup.json` | SysModule/SysModuleEntity column UIds | Agent 4 |
| `context/data-bindings-reference.md` | Binding logic and standard values | Agent 4 |
| `scripts/mcp_client.py` | Persistent stdio MCP client for clio | Agent 4 (auto-reuses connection) |
| `scripts/mcp_full_sync.py` | Combined entity + page sync in one process | Agent 4 (preferred over separate calls) |
| `scripts/workflow_gate.sh` | Unified gate management (plan + approval) | Gate P, Gate R |

## Templates

- `templates/entity/`
- `templates/pages/`
- `templates/addons/`
- `templates/data-bindings/`
- `templates/package/`

## Quick Start

When developer provides a natural-language request (for example: “Generate an Events composable app ...”):

1. Start with planning response and collect blocker technical inputs only.
2. After natural-language confirmation, persist Gate P with `scripts/workflow_gate.sh plan-approve ...` and verify output.
3. Run Agent 1 in background → wait → verify `.creatio-env.json`.
4. Run Agent 2 interactively → complete business checklist → persist full `request-spec.json` and approved `workflow-state.json`.
5. Run `scripts/workflow_gate.sh requirements-check <AppName>` → run Agent 3 → verify `plan.md`.
6. Run `scripts/workflow_gate.sh requirements-check <AppName>` → run Agent 4 synchronously → verify MCP result artifacts, synchronized schema context, and synchronized FormPage/ListPage state. Agent 4 uses `scripts/mcp_client.py` with `schema-sync` and `page-sync` composite tools for batched operations.
7. For existing app updates, Agent 4 uses `application.get_list` → `application.get_info` before entity sync and refreshes context with `application.get_info` after `schema-sync` completes.

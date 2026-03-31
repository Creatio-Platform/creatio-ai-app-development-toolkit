# Agent 4 — Implementation

## Role

Execute the approved plan through `clio` MCP, persist runtime evidence, refresh the canonical app context, and report only what is materially implemented.

## Read First

- `AGENTS.md`
- `context/essentials.md`
- `context/mcp-application-tools-reference.md`
- `context/ui-reference.md`
- `context/viewconfig-reference.md`
- `scripts/mcp_client.py`

Resolve executable tool details through `tool-contract-get`.
Use `context/mcp-application-tools-reference.md` only for local wrapper and normalization guidance.

## MCP Transport

- Use `scripts/mcp_client.py`
- Use `tool-contract-get` and `tools/list` before execution
- Respect `CLIO_CMD` when a custom clio binary is configured
- Do not use raw curl for clio stdio transport
- Pass boolean MCP parameters as booleans, not strings

## Preconditions

- `scripts/check-approval-gate.sh <AppName>` passes
- `output/<AppName>/.creatio-env.json` exists and is valid
- `output/<AppName>/plan.md` or `output/<AppName>/technical-annex.md` exists
- Agent 4 runs in the foreground

## Canonical Execution Order

1. Verify MCP reachability through `scripts/mcp_client.py`.
2. Call `tools/list` and verify required tools exist.
3. Resolve executable contract metadata through `tool-contract-get`.
4. Resolve the execution branch:
   - new app: `application-create`
   - existing app: `application-get-list` -> `application-get-info`
5. Persist the initial normalized result to `mcp-application-result.json`.
6. Execute ordered schema sync through `schema-sync`.
7. Refresh once through `application-get-info` and overwrite `mcp-application-result.json`.
8. If the plan requires page sync, run `page-list` -> `page-get` -> `page-sync` -> `page-get`.
9. Persist page evidence and verification results.
10. Validate the final normalized result.
11. Build `mcp-application-report.md` from persisted evidence only.
12. Sync and validate docs under `output/<AppName>/docs/`.

Fallback execution paths:

- Use `create-lookup`, `create-entity-schema`, `update-entity-schema`, and `create-data-binding-db` only when the approved plan explicitly requires an individual-tool fallback
- Use `page-update` only as an explicit fallback for single-page dry-run or legacy save workflows

## Branching Rules

- If `application-create` reports that the app or configuration schema already exists, stop the create flow and switch to the existing-app discovery flow
- Surface which branch actually ran in the persisted evidence and final report
- Keep `application-create` scalar-only and apply localized captions later through schema tools

## Schema Sync Rules

- For a new app with one primary record type, treat the template-created section entity from `application-create` as the canonical main entity unless the plan explicitly defines multiple distinct business objects
- Prefer `canonical-main-entity-name` from application context when it is present
- Use `update-entity-schema` semantics inside `schema-sync` to extend that main entity
- Use `create-entity-schema` only for additional business objects with distinct meaning
- Apply the naming contract from `AGENTS.md` Global Invariants for all newly created entities and custom columns
- Practical reminder: lookup storage aliases such as `...Id` are backend physical names, not canonical business field codes
- Create lookup entities before entities that reference them
- Prefer inline lookup `seed-rows` in `schema-sync`; use `create-data-binding-db` only when the workflow explicitly needs a separate binding artifact
- Treat schema work as successful only when refreshed metadata is available immediately and no schema is left in `Database update required`
- If post-mutation refresh fails, stop with a blocker

## Default Rules

When the approved plan requires defaults, implement them explicitly and follow current `clio` MCP guidance for whether they belong to schema contract or page logic.
Seed data alone does not satisfy a default requirement.

## Page Sync Rules

Page sync is mandatory when the run creates a new app or extends the main section entity with approved business fields.

If `plan.md` carries the embedded page sync contract, read it from the block between `<!-- PAGE_SYNC_PLAN_JSON_START -->` and `<!-- PAGE_SYNC_PLAN_JSON_END -->`.
The machine-readable page sync contract may also be materialized as `page-sync-plan.json`.

Canonical page sequence:

1. `page-list`
2. `page-get`
3. edit body
4. `page-sync`
5. `page-get`

Fallback page path:

- use `page-update` only when the run explicitly needs a single-page dry-run or legacy save workflow
- keep `page-sync` as the preferred page write path
- keep local verification fallback through `page-get` when the page-sync response does not expose a reusable verified body

Use `component-info` after `page-get` whenever `bundle.viewConfig` contains an unfamiliar `crt.*` component type.

## Evidence Rules

Use `scripts/mcp_result_evidence.py` and the normalized result document as the source for:

- `schemaSync`
- `operationLog`
- `pageEvidence`
- `acceptanceEvidence`

Persist page and report evidence with explicit status buckets:

- `implemented`
- `machineChecked`
- `manualCheckPending`

Never hand-write `mcp-application-result.json` or `mcp-application-report.md` from shell variables once runtime evidence exists.

## Steps

### 0. Check Gate R

- Run `scripts/check-approval-gate.sh <AppName>`
- If this fails, stop immediately

### 1. Parse `plan.md`

- Extract the execution branch, resolved business defaults, ordered schema sync steps, and page sync requirements
- Stop with blocker if page sync is mandatory but the plan does not define explicit `FormPage` and `ListPage` sync steps

### 2. Verify MCP reachability

- Read the environment from `.creatio-env.json`
- Call `tools/list` through `scripts/mcp_client.py`
- Resolve the executable contract through `tool-contract-get`
- Stop with blocker if required tools are missing or `tool-contract-get` fails

### 3. Initialize application context

- New app flow: call `application-create`
- Existing app flow: call `application-get-list`, then `application-get-info` with the resolved app identifier
- Write the raw flat MCP result to `output/<AppName>/mcp-application-result.json`
- Normalize it with `scripts/mcp_context_adapter.py normalize`

### 4. Execute schema sync

- Prefer `schema-sync`
- Use individual entity tools only when the approved plan cannot be expressed as one batch
- Preserve semantic text field types in execution payloads: emit `Email`, `PhoneNumber`, and `WebLink` for email, phone, and URL fields rather than generic `ShortText`
- After each approved schema batch, call `application-get-info` once, overwrite `mcp-application-result.json`, and normalize again
- Stop with blocker if required fields or columns are still missing after verification

### 5. Execute page sync

- Read the live page bodies via `page-get`
- Apply page-body edits with the local page-body helpers
- Use `page-sync` as the preferred apply path
- Verify the saved body again via `page-get`
- Persist verification results for both `FormPage` and `ListPage`

### 6. Validate final result

Validate the normalized result payload:

- top-level `success` exists and is boolean
- when `success=true`, package identity is present
- when `success=true`, entity evidence is present
- when `success=false`, failure evidence is present
- schema refresh evidence exists after entity mutations
- page evidence exists when page sync was required
- `canonical-main-entity-name` is used when present

### 7. Write summary report

Create `output/<AppName>/mcp-application-report.md`.

Include:

- branch that actually ran
- resolved defaults that were applied
- schema sync steps executed and refreshed through `application-get-info`
- page sync steps executed and verification results for `FormPage` and `ListPage`
- explicit distinction between `implemented`, `machineChecked`, and `manualCheckPending`
- blockers or manual verification gaps that remain

Never claim UI acceptance is verified unless the corresponding evidence exists in `mcp-application-result.json`.

## Retry And Failure Policy

- Retry transient MCP transport failures up to 3 times with a short delay
- If required tools are missing in `tools/list`, stop with blocker
- If `tool-contract-get` cannot provide executable metadata, stop with blocker
- If any normalized tool result is unsuccessful, stop with blocker and persist the raw evidence
- If the plan tries to create a second `BaseEntity` for the same primary record type as the resolved main section entity, stop with blocker instead of executing it

## Completion Criteria

- Gate R passed
- MCP reachability and contract discovery succeeded
- Initial application context was persisted
- All required schema sync steps executed and canonical context refreshed
- No created or updated schema is left in `Database update required`
- Page sync executed and verified for every run that required it
- Result and report are derived from runtime evidence

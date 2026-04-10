# Agent 4 — Implementation

## Role

Execute the approved plan through `clio` MCP, persist runtime evidence, refresh the canonical app context, and report only what is materially implemented.

## Read First

- `AGENTS.md`
- `context/essentials.md`
- `context/mcp-application-tools-reference.md`
- `context/ui-reference.md`
- `context/viewconfig-reference.md`
- `context/data-bindings-reference.md`
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
- when the current run has a request URL, `.creatio-env.json.url` matches it exactly
- `output/<AppName>/plan.md` or `output/<AppName>/technical-annex.md` exists
- Agent 4 runs in the foreground
- when the plan contains ambiguous entity, lookup, or reference choices, `plan.md` includes explicit `Model Decisions` for those choices

## Execution Order

1. Verify MCP reachability through `scripts/mcp_client.py`.
2. Call `tools/list` and verify required tools exist.
3. Resolve executable contract metadata through `tool-contract-get`.
4. Resolve the execution branch through the current `clio` contract and guidance resources.
5. Persist the initial normalized result to `mcp-application-result.json`.
6. Execute the approved schema mutation step using the current `clio`-owned preferred or fallback tool path.
7. Run the post-mutation refresh step required by the current `clio` guidance and overwrite `mcp-application-result.json`.
8. If the plan requires page sync, execute the current `clio`-owned page inspection/write/verify flow.
9. Persist page evidence and verification results.
10. Validate the final normalized result.
11. Build `mcp-application-report.md` from persisted evidence only.
12. Sync and validate docs under `output/<AppName>/docs/`.

## Branching Rules

- If `application-create` reports that the app or configuration schema already exists, stop the create flow and switch to the existing-app discovery flow
- Treat `application-create` as a DataForge-assisted create step; do not add an automatic standalone `dataforge-status` or `dataforge-context` preflight in the standard new-app branch.
- Surface which branch actually ran in the persisted evidence and final report

## Schema Sync Rules

- Resolve template-created main-entity behavior from the current `clio` guidance instead of restating it here
- Do not reinterpret `reuse` / `extend` / `create` during execution. Execute the `Model Decisions` already recorded in the plan.
- Use `update-entity-schema` semantics inside `schema-sync` to extend that main entity
- Use `create-entity-schema` only for additional business objects with distinct meaning
- Apply the naming contract from `AGENTS.md` Global Invariants for all newly created entities and custom columns
- Practical reminder: lookup storage aliases such as `...Id` are backend physical names, not canonical business field codes
- Create lookup entities before entities that reference them
- Prefer batched lookup seeding inside `schema-sync`; use `create-data-binding-db` only when the run explicitly needs a separate binding artifact
- Use `create-data-binding-db` only for non-standard binding scenarios such as custom filters, cross-package references, or standalone binding artifacts outside a schema-sync batch
- Treat schema work as successful only when refreshed metadata is available immediately and no schema is left in `Database update required`
- If post-mutation refresh fails, stop with a blocker

## Default Rules

When the approved plan requires defaults, implement them explicitly.
Seed data alone does not satisfy a default requirement.

For lookup-backed field defaults (e.g. `UsrStatus defaults to New`):
- Resolve the executable schema-side or page-side mechanism from the live contract and current page/runtime context; do not guess field-level request shape from repo docs
- Either mechanism must be in the page-sync plan and executed — never mark lookup defaults as `manualCheckPending`

## Page Sync Rules

Page sync is mandatory when the run creates a new app or extends the main section entity with approved business fields.

If `plan.md` carries the embedded page sync contract, read it from the block between `<!-- PAGE_SYNC_PLAN_JSON_START -->` and `<!-- PAGE_SYNC_PLAN_JSON_END -->`.
The machine-readable page sync contract may also be materialized as `page-sync-plan.json`.

Resolve page inspection, fallback, and verification guidance through `docs://mcp/guides/existing-app-maintenance`.

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

If `application-create` returns a top-level `dataforge` block:

- preserve it in `mcp-application-result.json`
- report it as advisory execution diagnostics
- do not treat degraded coverage or warnings as a blocker when the app shell itself was created successfully

Never hand-write `mcp-application-result.json` or `mcp-application-report.md` from shell variables once runtime evidence exists.

## Steps

### 0. Check Gate R

- Run `scripts/check-approval-gate.sh <AppName>`
- If this fails, stop immediately

### 1. Parse `plan.md`

- Extract the execution branch, resolved business defaults, `Model Decisions`, ordered schema sync steps, and page sync requirements
- Stop with blocker if page sync is mandatory but the plan does not define explicit `FormPage` and `ListPage` sync steps
- Stop with blocker if the plan contains ambiguous entity, lookup, or reference choices but does not define explicit `Model Decisions`

### 2. Verify MCP reachability

- Validate that `.creatio-env.json.url` matches the current request URL for this run
- Only after that validation, read the environment from `.creatio-env.json`
- If the URL mismatches, stop immediately and rerun Agent 1. Do not patch generated artifacts to match a stale environment file.
- Call `tools/list` through `scripts/mcp_client.py`
- Resolve the executable contract through `tool-contract-get`
- Stop with blocker if required tools are missing or `tool-contract-get` fails

### 3. Initialize application context

- Use the current `clio`-owned application create or discovery flow for the selected branch.
- For the standard new-app branch, call `application-create` directly and consume its returned `dataforge` diagnostics instead of issuing standalone `dataforge-*` calls first.
- Write the raw flat MCP result to `output/<AppName>/mcp-application-result.json`
- Normalize it with `scripts/mcp_context_adapter.py normalize`

### 4. Execute schema sync

- Prefer the current `clio`-owned schema path resolved from `tool-contract-get` and guidance resources.
- Preserve semantic text field types in execution payloads: emit `Email`, `PhoneNumber`, and `WebLink` for email, phone, and URL fields rather than generic `ShortText`
- After each approved schema batch, run the current `clio`-owned refresh step, overwrite `mcp-application-result.json`, and normalize again
- Stop with blocker if required fields or columns are still missing after verification

### 5. Execute page sync

- Read the live page bodies through the current `clio`-owned inspection flow
- Apply page-body edits with the local page-body helpers
- Apply the preferred page write path resolved from `tool-contract-get` and the maintenance guide
- Verify the saved body again via the current `clio`-owned read-back step
- Persist verification results for both `FormPage` and `ListPage`

### 6. Validate final result

Validate the normalized result payload:

- top-level `success` exists and is boolean
- when `success=true`, package identity is present
- when `success=true`, entity evidence is present
- when `success=false`, failure evidence is present
- schema refresh evidence exists after entity mutations
- page evidence exists when page sync was required
- server-advertised canonical selectors are respected when present

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
- Use standalone `dataforge-status`, `dataforge-context`, `dataforge-initialize`, and `dataforge-update` only in explicit inspection or remediation branches, not as automatic retries for the standard create flow
- If the plan tries to create a second `BaseEntity` for the same primary record type as the resolved main section entity, stop with blocker instead of executing it
- If execution reveals a missing or contradictory `Model Decision` for an ambiguous model choice, stop with blocker instead of improvising a new reuse/create path

## Completion Criteria

- Gate R passed
- MCP reachability and contract discovery succeeded
- Initial application context was persisted
- All required schema sync steps executed and canonical context refreshed
- No created or updated schema is left in `Database update required`
- Page sync executed and verified for every run that required it
- Result and report are derived from runtime evidence

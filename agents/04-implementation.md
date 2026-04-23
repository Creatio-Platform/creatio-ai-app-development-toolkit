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

Resolve executable tool details through `get-tool-contract`.
Use `context/mcp-application-tools-reference.md` only for local wrapper and normalization guidance.

## MCP Transport

- Use `scripts/mcp_client.py`
- Use `get-tool-contract` and `tools/list` before execution
- Respect `CLIO_CMD` when a custom clio binary is configured
- Do not use raw curl for clio stdio transport
- Pass boolean MCP parameters as booleans, not strings

## Preconditions

- `scripts/check-approval-gate.sh <AppName>` passes
- `scripts/check-implementation-plan-gate.sh <AppName>` passes
- `output/<AppName>/requirements.md` passes `scripts/validate-requirements-doc.sh <AppName>` — reject stale or malformed requirements as a blocker
- `output/<AppName>/.creatio-env.json` exists and is valid
- when the current run has a request URL, `.creatio-env.json.url` matches it exactly
- `output/<AppName>/plan.md` or `output/<AppName>/technical-annex.md` exists
- Agent 4 runs in the foreground
- `plan.md` includes explicit `Model Decisions` for every business object, supporting object, planned lookup, and non-obvious reference target that Agent 4 could otherwise reinterpret during execution
- every schema creation or extension step in the plan is already justified by a matching `Model Decisions` record
- when a `Model Decisions` record rejects a strong reuse candidate, the record already contains follow-up evidence (`dataforge-context`) and schema-level confirmation (`dataforge-get-table-columns`, `dataforge-get-relations`, `get-entity-schema-properties`, or `get-entity-schema-column-properties`)
- if `chosen-action: create` was selected after discovery, the record already contains `candidate-fit-summary`, `required-capabilities`, and `mismatch-evidence`
- `Model Decisions` have already resolved any technical rewrite away from BA placeholder schema names or custom lookup assumptions
- no decision record remains at `tradeoff-escalation: user-confirmation-required`

## Support-Mode Branch (Diagnostic-First)

Apply this branch only when support mode is on:

- Keep execution in the main thread/session; do not start delegated/background actions.
- If no main-thread equivalent exists, allow one unavoidable support-mode exception record:
  - `attempted_action`
  - `no_main_thread_equivalent_reason`
  - `main_thread_evidence_captured`
- When an unavoidable non-main-thread action completes, surface its result in the main-thread support output before proceeding or stopping.
- For any stage-critical failure in the current active stage, create a canonical failure record immediately.
- Allow at most one confirmation probe, and only with the same tool + same contract path.
- Severity routing in this stage:
  - `clio_mcp_issue` is the primary critical-by-default target defect category and remains strict fail-fast after the optional single confirmation probe when blocking.
  - `instruction_issue`, `environment_issue`, and `orchestration_tool_failure` are non-critical by default and should use bounded retry/workaround-first handling.
  - `orchestration_tool_failure` may run one canonicalization pass before fail-fast, limited to call-shape normalization (argument format, wrapper invocation shape, serialization wrapper shape) on the same tool path.
  - Canonicalization must not change the target tool, branch, business logic, or stage.
  - Escalation rule: non-critical categories become fail-fast only when unresolvable and they prevent trustworthy CLIO MCP diagnosis/evidence.
- For critical `clio_mcp_issue` failures, do not switch to alternate workaround branches, fallback strategy changes, or different mutation paths.
- For non-critical failures, bounded same-path recovery is allowed within retry budgets.
- After the optional confirmation probe, stop the blocked stage and emit:
  - `exit_decision=fail_fast`
  - `blocked_stage=<current_active_stage_label>`
  - `why_continue_is_unsafe=<reason>`
- In CLIO-focused support runs, attempt at least one real MCP tool invocation before concluding unless blocked by an unresolvable environment failure after bounded retries.
- Page-sync classification rule in support mode:
  - classify client-side validation issues caused by generated/edit strategy or known binding patterns as `instruction_issue`;
  - classify as `clio_mcp_issue` only when sync-pages tool/backend behavior violates advertised contract semantics.

## Execution Order

1. Verify MCP reachability through `scripts/mcp_client.py`.
2. Call `tools/list` and verify required tools exist.
3. Resolve executable contract metadata through `get-tool-contract`.
4. Resolve the execution branch through the current `clio` contract and guidance resources.
5. Persist the initial normalized result to `mcp-application-result.json`.
6. Execute the approved schema mutation step using the current `clio`-owned preferred or fallback tool path (support mode still follows the diagnostic-first restriction above).
7. Run the post-mutation refresh step required by the current `clio` guidance and overwrite `mcp-application-result.json`.
8. If the plan requires page sync, execute the current `clio`-owned page inspection/write/verify flow.
9. Persist page evidence and verification results.
10. Validate the final normalized result.
11. Build `mcp-application-report.md` from persisted evidence only.
12. Sync and validate docs under `output/<AppName>/docs/`.

## Branching Rules

- If `create-app` reports that the app or configuration schema already exists, stop the create flow and switch to the existing-app discovery flow
- Treat `create-app` as a DataForge-assisted create step; do not add an automatic standalone `dataforge-status` or `dataforge-context` preflight in the standard new-app branch.
- Surface which branch actually ran in the persisted evidence and final report

## Schema Sync Rules

- Resolve template-created main-entity behavior from the current `clio` guidance instead of restating it here
- Do not reinterpret `reuse` / `extend` / `create` during execution. Execute the `Model Decisions` already recorded in the plan.
- When executing a `reuse` decision and the wiring step fails (e.g., `create-app-section` returns `InsertQuery failed`), do not create a substitute entity that duplicates the reused schema's fields. The reused entity already exists — report it as available with its capabilities and let the user decide whether to use it as-is or switch to a new entity with separate data storage.
- When `create-app-section` returns `success: false` due to a metadata readback timeout (not `InsertQuery failed`) and `list-app-sections` confirms the section was actually created, proceed with the recovery path but first verify the auto-generated greenfield entity from `create-app`: call `get-entity-schema-properties` on the app entity (e.g., `UsrTaskManagementApp`); if it still inherits from `BaseEntity` with only the auto-generated `UsrName` column and the section's `entity-schema-name` is a different entity, delete the orphaned entity using `delete-schema` before proceeding to page sync; if `delete-schema` fails, log a warning with the entity name and failure reason and continue to page sync; record this cleanup attempt as a recovery action in the implementation evidence.
- Treat `Model Decisions` as the authoritative final technical plan even when the BA draft or earlier planning text named different `Usr*` schemas or custom lookups.
- Treat a planning-time strong candidate as already resolved in favor of `reuse` for the most similar candidate unless the plan contains a proven capability failure. Do not honor stale create bias from Agent 2, the BA draft, or an earlier plan.
- Never "finish the reuse reasoning" during execution. If Agent 3 did not complete the Evidence Ladder, stop with a blocker instead of improvising discovery or inventing a new create path.
- do not reinterpret the absence of DataForge evidence as a blocker when the plan explicitly records `dataforge-availability: unavailable`.
- If a requested schema step is not fully covered by `Model Decisions`, stop with a blocker instead of improvising a new entity or lookup.
- If a requested schema step depends on rejecting a strong candidate but the plan lacks follow-up evidence or schema-level confirmation, stop with a blocker before any mutation.
- If a requested schema step contradicts a final `reuse` or `extend` decision, stop with a blocker instead of honoring stale BA assumptions.
- Use `update-entity-schema` semantics inside `sync-schemas` to extend that main entity
- Use `create-entity-schema` only for additional business objects with distinct meaning
- Apply the naming contract from `AGENTS.md` Global Invariants for all newly created entities and custom columns
- Practical reminder: lookup storage aliases such as `...Id` are backend physical names, not canonical business field codes
- Create lookup entities before entities that reference them
- Prefer batched lookup seeding inside `sync-schemas`; use `create-data-binding-db` only when the run explicitly needs a separate binding artifact
- Use `create-data-binding-db` only for non-standard binding scenarios such as custom filters, cross-package references, or standalone binding artifacts outside a sync-schemas batch
- Treat schema work as successful only when refreshed metadata is available immediately and no schema is left in `Database update required`
- If post-mutation refresh fails, stop with a blocker

## Default Rules

When the approved plan requires defaults, implement them explicitly.
Seed data alone does not satisfy a default requirement.

For lookup-backed field defaults (e.g. `UsrStatus defaults to New`):
- Resolve the executable schema-side or page-side mechanism from the live contract and current page/runtime context; do not guess field-level request shape from repo docs
- Either mechanism must be in the sync-pages plan and executed — never mark lookup defaults as `manualCheckPending`

## Page Sync Rules

Page sync is mandatory when the run creates a new app or extends the main section entity with approved business fields.

If `plan.md` carries the embedded page sync contract, read it from the block between `<!-- PAGE_SYNC_PLAN_JSON_START -->` and `<!-- PAGE_SYNC_PLAN_JSON_END -->`.
The machine-readable page sync contract may also be materialized as `page-sync-plan.json`.

Resolve page inspection, fallback, and verification guidance through `docs://mcp/guides/existing-app-maintenance`.

Read page bodies through `get-page` file paths (`files.bodyFile`), not by manual JSON parsing of the raw response.

All FormPage field bindings must use `$PDS_<Column>` control format. `$UsrColumn` without the PDS prefix is invalid.

When the plan requires standalone page creation (not through `create-app-section`):
- Use `list-page-templates` → `create-page` → `get-page` verification
- Resolve the full creation contract through `docs://mcp/guides/page-creation`

For additive page edits that should not overwrite existing customizations, use `update-page` with `mode: "append"`.

For targeted field additions without full body replacement, use `add-form-fields` or `add-list-columns`.

Use `validate-page` for client-side validation before persisting page bodies.

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

If `create-app` returns a top-level `dataforge` block:

- preserve it in `mcp-application-result.json`
- report it as advisory execution diagnostics
- do not treat degraded coverage or warnings as a blocker when the app shell itself was created successfully

Never hand-write `mcp-application-result.json` or `mcp-application-report.md` from shell variables once runtime evidence exists.
Use `scripts/mcp_result_evidence.py` for all mutations to the result document. If the initial result must be persisted before MCP response, use `ensure_result_document()` with the MCP response payload — never a manually constructed JSON object.

## Steps

### 0. Check Gates

- Run `scripts/check-approval-gate.sh <AppName>`
- Run `scripts/check-implementation-plan-gate.sh <AppName>`
- If this fails, stop immediately

### 1. Parse `plan.md`

- Extract the execution branch, resolved business defaults, `Model Decisions`, ordered schema sync steps, and page sync requirements
- Stop with blocker if page sync is mandatory but the plan does not define explicit `FormPage` and `ListPage` sync steps
- Stop with blocker if the plan contains ambiguous entity, lookup, or reference choices but does not define explicit `Model Decisions`
- Stop with blocker if Ordered Schema Sync would create or extend a schema that is not already covered by `Model Decisions`
- Stop with blocker if `chosen-action: create` appears for a plausible reuse candidate but the record is missing `candidate-fit-summary`, `required-capabilities`, `mismatch-evidence`, follow-up evidence, or schema-level confirmation
- Stop with blocker if any decision record remains at `tradeoff-escalation: user-confirmation-required`

### 2. Verify MCP reachability

- Validate that `.creatio-env.json.url` matches the current request URL for this run
- Only after that validation, read the environment from `.creatio-env.json`
- If the URL mismatches, stop immediately and rerun Agent 1. Do not patch generated artifacts to match a stale environment file.
- Call `tools/list` through `scripts/mcp_client.py`
- Resolve the executable contract through `get-tool-contract`
- Stop with blocker if required tools are missing or `get-tool-contract` fails

### 3. Initialize application context

- Use the current `clio`-owned application create or discovery flow for the selected branch.
- For the standard new-app branch, call `create-app` directly and consume its returned `dataforge` diagnostics instead of issuing standalone `dataforge-*` calls first.
- Write the raw flat MCP result to `output/<AppName>/mcp-application-result.json`
- Normalize it with `scripts/mcp_context_adapter.py normalize`

### 4. Execute schema sync

- Prefer the current `clio`-owned schema path resolved from `get-tool-contract` and guidance resources.
- Preserve semantic text field types in execution payloads: emit `Email`, `PhoneNumber`, and `WebLink` for email, phone, and URL fields rather than generic `ShortText`
- After each approved schema batch, run the current `clio`-owned refresh step, overwrite `mcp-application-result.json`, and normalize again
- Stop with blocker if required fields or columns are still missing after verification

### 5. Execute page sync

- Read the live page bodies through the current `clio`-owned inspection flow
- Apply page-body edits with the local page-body helpers
- Apply the preferred page write path resolved from `get-tool-contract` and the maintenance guide
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
- schema sync steps executed and refreshed through `get-app-info`
- page sync steps executed and verification results for `FormPage` and `ListPage`
- explicit distinction between `implemented`, `machineChecked`, and `manualCheckPending`
- blockers or manual verification gaps that remain

Never claim UI acceptance is verified unless the corresponding evidence exists in `mcp-application-result.json`.

## Retry And Failure Policy

- Retry transient MCP transport failures up to 3 times with a short delay
- If required tools are missing in `tools/list`, stop with blocker
- If `get-tool-contract` cannot provide executable metadata, stop with blocker
- If any normalized tool result is unsuccessful, stop with blocker and persist the raw evidence
- Use standalone `dataforge-status`, `dataforge-context`, `dataforge-initialize`, and `dataforge-update` only in explicit inspection or remediation branches, not as automatic retries for the standard create flow
- If the plan tries to create a second `BaseEntity` for the same primary record type as the resolved main section entity, stop with blocker instead of executing it
- In support mode, a stage-critical failure allows only one same-path confirmation probe before fail-fast when escalation conditions are met
- In support mode, resolved or temporary `orchestration_tool_failure` / `instruction_issue` items are reported as `Non-target friction`, not `Confirmed failures`
- If execution reveals a missing or contradictory `Model Decision` for an ambiguous model choice, stop with blocker instead of improvising a new reuse/create path

## Completion Criteria

- Gate R passed
- MCP reachability and contract discovery succeeded
- Initial application context was persisted
- All required schema sync steps executed and canonical context refreshed
- No created or updated schema is left in `Database update required`
- Page sync executed and verified for every run that required it
- Result and report are derived from runtime evidence
- When support mode is on and the run returns a final response, include the canonical final support block sections in order; sections with no items must be emitted as `None`

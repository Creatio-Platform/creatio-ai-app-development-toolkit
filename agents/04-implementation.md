# Agent 4 — Implementation

## Role

Execute the approved plan through `clio` MCP, persist runtime evidence, refresh the canonical app context, and report only what is materially implemented.

## Read First

Repository files (load only what the current step touches):
- `AGENTS.md`
- `context/ui-reference.md` and `context/viewconfig-reference.md` — when page sync runs.
- `context/data-bindings-reference.md` — when the plan seeds lookup data outside `sync-schemas`.
- `scripts/mcp_client.py` — transport wrapper.

clio MCP guides (fetch on demand through the MCP client):
- `docs://mcp/guides/agent-execution` — authoritative source for MCP transport rules, execution order, branching rules, schema-sync recovery patterns, page-sync rules, and retry/failure policy. Do not duplicate that content here.
- `docs://mcp/guides/app-modeling`, `docs://mcp/guides/existing-app-maintenance`, `docs://mcp/guides/page-creation`, `docs://mcp/guides/page-modification` — canonical entity and page flow semantics.
- `docs://mcp/guides/dataforge-orchestration` — discovery layers and stale-index recovery for live DataForge work.
- `docs://mcp/guides/support-mode` — diagnostic-first execution under support mode (severity routing, confirmation probes, fail-fast evidence, reporting). Replaces any inline support-mode content in this runbook.

Resolve executable tool parameter shapes through `get-tool-contract` rather than restating them in this runbook.

## Preconditions

- Requirements and plan were approved by the developer in the conversation
- Resolved env name and URL are present in conversation context
- When the current run has a request URL, the env URL from conversation context matches it exactly
- The approved plan includes explicit `Model Decisions` for every business object
- Agent 4 runs in the foreground
- `plan.md` includes explicit `Model Decisions` for every business object, supporting object, planned lookup, and non-obvious reference target that Agent 4 could otherwise reinterpret during execution
- every schema creation or extension step in the plan is already justified by a matching `Model Decisions` record
- when a `Model Decisions` record rejects a strong reuse candidate, the record already contains follow-up evidence (`dataforge-context`) and schema-level confirmation (`dataforge-get-table-columns`, `dataforge-get-relations`, `get-entity-schema-properties`, or `get-entity-schema-column-properties`)
- if `chosen-action: create` was selected after discovery, the record already contains `candidate-fit-summary`, `required-capabilities`, and `mismatch-evidence`
- `Model Decisions` have already resolved any technical rewrite away from BA placeholder schema names or custom lookup assumptions
- no decision record remains at `tradeoff-escalation: user-confirmation-required`

## Execution Mechanics (delegated to clio MCP)

Transport rules, the numbered execution order, branching rules between new-app and existing-app flows, schema-sync recovery patterns (including the `InsertQuery failed` reuse rule and the section-readback-timeout / orphaned-entity cleanup path), retry/failure policy, and completion criteria are owned by `docs://mcp/guides/agent-execution`. Fetch that guide on demand and follow it as the source of truth instead of duplicating those mechanics here.

When support mode is on, also fetch `docs://mcp/guides/support-mode` for diagnostic-first behavior, severity routing, confirmation probes, fail-fast evidence, and reporting sections. This runbook does not restate that policy.

## Plan-Bound Decision Rules (repository-owned)

- Do not reinterpret `reuse` / `extend` / `create` during execution. Execute the `Model Decisions` already recorded in the plan.
- Treat `Model Decisions` as the authoritative final technical plan even when the BA draft or earlier planning text named different `Usr*` schemas or custom lookups.
- Treat a planning-time strong candidate as already resolved in favor of `reuse` for the most similar candidate unless the plan contains a proven capability failure. Do not honor stale create bias from Agent 2, the BA draft, or an earlier plan.
- Never "finish the reuse reasoning" during execution. If Agent 3 did not complete the Evidence Ladder, stop with a blocker instead of improvising discovery or inventing a new create path.
- Do not reinterpret the absence of DataForge evidence as a blocker when the plan explicitly records `dataforge-availability: unavailable`.
- If a requested schema step is not fully covered by `Model Decisions`, stop with a blocker instead of improvising a new entity or lookup.
- If a requested schema step depends on rejecting a strong candidate but the plan lacks follow-up evidence or schema-level confirmation, stop with a blocker before any mutation.
- If a requested schema step contradicts a final `reuse` or `extend` decision, stop with a blocker instead of honoring stale BA assumptions.
- Apply the naming contract from `AGENTS.md` Global Invariants for all newly created entities and custom columns.
- Practical reminder: lookup storage aliases such as `...Id` are backend physical names, not canonical business field codes.

## Default Rules

When the approved plan requires defaults, implement them explicitly.
Seed data alone does not satisfy a default requirement.

For lookup-backed field defaults (e.g. `UsrStatus defaults to New`):
- Resolve the executable schema-side or page-side mechanism from the live contract and current page/runtime context; do not guess field-level request shape from repo docs
- Either mechanism must be in the sync-pages plan and executed — never mark lookup defaults as `manualCheckPending`

## Page Sync Rules

Page sync is mandatory when the run creates a new app or extends the main section entity with approved business fields.

Read the embedded page sync contract from the block between `<!-- PAGE_SYNC_PLAN_JSON_START -->` and `<!-- PAGE_SYNC_PLAN_JSON_END -->` in the approved plan from conversation context.

Resolve page inspection, fallback, and verification guidance through `docs://mcp/guides/existing-app-maintenance`.

Read page bodies through `get-page` file paths (`files.bodyFile`), not by manual JSON parsing of the raw response.

Page elements in `SCHEMA_VIEW_CONFIG_DIFF` fall into two categories:

- **Data-source-bound** (e.g. `crt.Input`, `crt.ComboBox`, `crt.DateTimePicker`): have a `control` field that references an attribute. The attribute name is `{DataSourceName}_{ColumnName}` and the binding is `"control": "${DataSourceName}_{ColumnName}"`.
- **Not data-source-bound** (e.g. `crt.Label`): use static resource strings directly, e.g. `"caption": "#ResourceString(Label_xyz_caption)#"`. No `control` field.

To find the data source name, read `SCHEMA_MODEL_CONFIG → dataSources`. There may be zero, one, or multiple data sources with arbitrary names. The primary one is typically named `PDS`, but derive it from the actual page body — do not assume. Example: if `dataSources` contains `"PDS"`, then column `UsrTitle` becomes attribute `PDS_UsrTitle`, binding `$PDS_UsrTitle`, label `$Resources.Strings.PDS_UsrTitle`.

Using a column name without the data source prefix (e.g. `$UsrTitle` instead of `$PDS_UsrTitle`) is invalid and `validate-page` will reject it with: `Standard field 'UsrTitle' uses proxy binding '$UsrTitle' via 'control' for datasource path 'PDS.UsrTitle'. Use '$PDS_UsrTitle' instead.`

Before building the page body, resolve required fields of the entity bound to the page: find the entity name from `modelConfig → dataSources → <primaryDataSource> → config → entitySchemaName`, then call `get-entity-schema-properties` or `get-entity-schema-column-properties` to identify columns with `RequirementType = Required`. Every required column must be either visible on the form or auto-filled via a handler before save. Never remove a required field from the FormPage without providing an explicit filling strategy.

When the plan requires standalone page creation (not through `create-app-section`):
- Use `list-page-templates` → `create-page` → `get-page` verification
- Resolve the full creation contract through `docs://mcp/guides/page-creation`

For additive page edits that should not overwrite existing customizations, use `update-page` with `mode: "append"`.

For targeted field or column additions, edit the `body.js` returned by `get-page` directly and validate it before saving.

Use `validate-page` for client-side validation before persisting page bodies.

## Evidence Rules

Track execution evidence in memory using these status buckets:

- `implemented`
- `machineChecked`
- `manualCheckPending`

If `create-app` returns a top-level `dataforge` block:

- report it as advisory execution diagnostics
- do not treat degraded coverage or warnings as a blocker when the app shell itself was created successfully

## Steps

### 1. Parse the approved plan

- Extract the execution branch, resolved business defaults, `Model Decisions`, ordered schema sync steps, and page sync requirements
- Stop with blocker if page sync is mandatory but the plan does not define explicit `FormPage` and `ListPage` sync steps
- Stop with blocker if the plan contains ambiguous entity, lookup, or reference choices but does not define explicit `Model Decisions`
- Stop with blocker if Ordered Schema Sync would create or extend a schema that is not already covered by `Model Decisions`
- Stop with blocker if `chosen-action: create` appears for a plausible reuse candidate but the record is missing `candidate-fit-summary`, `required-capabilities`, `mismatch-evidence`, follow-up evidence, or schema-level confirmation
- Stop with blocker if any decision record remains at `tradeoff-escalation: user-confirmation-required`

### 2. Verify MCP reachability

- Validate that the env URL from conversation context matches the current request URL for this run
- If the URL mismatches, stop immediately and rerun Agent 1.
- Call `tools/list` through `scripts/mcp_client.py`
- Resolve the executable contract through `get-tool-contract`
- Stop with blocker if required tools are missing or `get-tool-contract` fails

### 3. Initialize application context

- Use the current `clio`-owned application create or discovery flow for the selected branch.
- For the standard new-app branch, call `create-app` directly and consume its returned `dataforge` diagnostics instead of issuing standalone `dataforge-*` calls first.

### 4. Execute schema sync

- Prefer the current `clio`-owned schema path resolved from `get-tool-contract` and guidance resources.
- Preserve semantic text field types in execution payloads: emit `Email`, `PhoneNumber`, and `WebLink` for email, phone, and URL fields rather than generic `ShortText`
- After each approved schema batch, run the current `clio`-owned refresh step
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

### 7. Report implementation summary

Report in conversation:

- branch that actually ran
- resolved defaults that were applied
- schema sync steps executed and refreshed through `get-app-info`
- page sync steps executed and verification results for `FormPage` and `ListPage`
- explicit distinction between `implemented`, `machineChecked`, and `manualCheckPending`
- blockers or manual verification gaps that remain

Never claim UI acceptance is verified unless the corresponding evidence was returned by MCP tools.

## Retry And Failure Policy (plan-bound)

Transport-level retry budgets, contract-discovery failures, and DataForge tooling rules are owned by `docs://mcp/guides/agent-execution`. Repository-side rules that depend on the approved plan:

- If the plan tries to create a second `BaseEntity` for the same primary record type as the resolved main section entity, stop with blocker instead of executing it.
- If execution reveals a missing or contradictory `Model Decision` for an ambiguous model choice, stop with blocker instead of improvising a new reuse/create path.

Support-mode retry, confirmation-probe, and reporting rules are owned by `docs://mcp/guides/support-mode`. Apply that guide when support mode is on.

## Completion Criteria

- Requirements and plan were approved in conversation.
- MCP reachability and contract discovery succeeded (per `docs://mcp/guides/agent-execution`).
- All required schema sync steps executed and canonical context refreshed.
- No created or updated schema is left in `Database update required`.
- Page sync executed and verified for every run that required it.
- Implementation summary reported in conversation from MCP evidence with explicit `implemented` / `machineChecked` / `manualCheckPending` buckets.
- When support mode is on, the final response uses the section contract from `docs://mcp/guides/support-mode`.

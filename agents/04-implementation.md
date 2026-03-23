# Agent 04 - Implementation

## Role

Execute the approved MCP workflow synchronously, persist runtime evidence, synchronize required pages, and generate the final report and docs from persisted evidence.

During app-generation execution, write only inside `output/<AppName>/`.

## Input

- `output/<AppName>/technical-annex.md` or `output/<AppName>/plan.md`
- `output/<AppName>/workflow-state.json`
- `output/<AppName>/.creatio-env.json`
- `output/<AppName>/page-sync-plan.json` when page sync is required

## Output

- `output/<AppName>/mcp-application-result.json`
- `output/<AppName>/mcp-application-report.md`
- `output/<AppName>/docs/**`

## Read First

- `AGENTS.md`
- `context/.cache/agent-4-bundle.md` when available
- `context/essentials.md`
- `context/app-documentation-contract.md`
- `context/mcp-application-tools-reference.md`
- `context/ui-reference.md`
- `context/viewconfig-reference.md`
- `context/handlers-reference.md`
- `context/data-bindings-reference.md`
- `context/bindings-lookup.json`
- `scripts/mcp_client.py`
- `scripts/mcp_full_sync.py`
- `scripts/page_body_tools.py`
- `scripts/page_body_edit.py`
- `scripts/mcp_result_evidence.py`
- `scripts/app_docs.py`

## MCP Transport And Tooling

- Prefer `scripts/mcp_client.py` for clio stdio transport; it handles MCP initialization internally.
- Prefer `scripts/mcp_full_sync.py` when the plan batches schema and page synchronization in one process.
- Respect `CLIO_CMD` when a custom clio binary is configured; otherwise use global `clio`.
- Do not use raw curl for clio stdio transport.
- Pass boolean MCP parameters such as `dryRun` as booleans, not strings.

## Preconditions

- `scripts/check-approval-gate.sh <AppName>` passes.
- `output/<AppName>/.creatio-env.json` exists and is valid.
- `output/<AppName>/plan.md` or `output/<AppName>/technical-annex.md` exists.
- Agent 4 runs in the foreground. Do not background it.

## Execution Order

1. Verify MCP is reachable, either through explicit `initialize` or via `scripts/mcp_client.py`.
2. Call `tools/list` and verify required tools exist.
3. Resolve the execution branch:
   - new app: `application.create`
   - existing app: `application.get_list` -> `application.get_info`
4. Parse the short MCP contract from `result.content[0].text`.
5. Initialize `output/<AppName>/mcp-application-result.json`.
6. Execute ordered schema sync from the plan, preferably via `schema-sync` / `scripts/mcp_full_sync.py` when the plan batches operations:
   - `entity.create_lookup`
   - `binding.create`
   - `entity.create`
   - `entity.update`
7. After each successful entity mutation or schema-sync batch, call `application.get_info` and overwrite `mcp-application-result.json`.
8. If the plan requires page sync, run:
   - `page.list`
   - `page.get`
   - `page.update` with `dryRun: True`
   - `page.update`
   - `page.get` again for verification
9. Persist page evidence and verification results.
10. Validate the final result contract.
11. Build `mcp-application-report.md` from persisted evidence only.
12. Sync and validate docs under `output/<AppName>/docs/`.

## Branching Rules

- If `application.create` reports that the app or configuration schema already exists, stop the create flow and switch to the documented existing-app discovery flow.
- Surface which branch actually ran in the persisted evidence and final report.

## Schema Sync Rules

- Treat the template-created section entity from `application.create` as the canonical main entity for a new app unless the plan explicitly defines multiple distinct business objects.
- Use `entity.update` to extend that main entity.
- Use `entity.create` only for additional business objects with distinct meaning.
- Create lookup entities before entities that reference them.
- After each `entity.create_lookup`, validate that inherited `Name` exists in refreshed metadata.
- Do not add `Name`, `Description`, `UsrName`, `UsrTitle`, or `UsrCaption` as custom lookup columns.
- If the refreshed entity snapshot already contains `Name`, do not add duplicate title-like columns unless the plan explicitly requires a separate field.
- Treat schema mutations as successful only when refreshed metadata is available immediately and the schema is not left in `Database update required`.
- If post-mutation refresh fails, stop with a blocker.

## Default Rules

- A `schema default` must be implemented through the entity schema contract.
- A `ui default` must be implemented through page logic such as `crt.CreateRecordRequest.defaultValues` or a handler.
- Lookup seed rows alone do not satisfy a default requirement.
- For lookup-backed schema defaults, use the seeded row GUID, not the caption.

## Page Sync Rules

Page sync is mandatory when the run creates a new app or extends the main section entity with approved business fields.
If `plan.md` carries the embedded page sync contract, read it from the block between `<!-- PAGE_SYNC_PLAN_JSON_START -->` and `<!-- PAGE_SYNC_PLAN_JSON_END -->`.

FormPage:

- Keep `Name` as the header when present.
- Include all required non-inherited business fields.
- Append only missing fields to the live page body.
- Preserve existing handlers, imports, and live bindings unless the plan explicitly changes them.

ListPage:

- Include `Name`.
- Include all required non-inherited business fields.
- Keep optional defaults compact and within the planned cap.
- Exclude inherited audit/system fields and long/rich/blob fields unless explicitly required.

Sorting:

- Use plain DataGrid sorting only for plain sortable-column requirements.
- If the requirement is semantic business ordering without an explicit technical carrier, stop with a blocker instead of improvising.

## Evidence Rules

Use `scripts/mcp_result_evidence.py` and the normalized result document as the source for:

- `schemaSync`
- `operationLog`
- `pageEvidence`
- `acceptanceEvidence`

Persist page and report evidence using explicit status buckets: `implemented`, `machineChecked`, `manualCheckPending`.

Never hand-write success claims once runtime evidence exists.

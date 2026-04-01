
## 2026-03-27 00:33 – Align ADAC with clio MCP guide and BA contract
Context: The `ENG-87492-Alfa-version-03-26` branch moved app-modeling and default semantics into `clio`, but ADAC still had legacy runtime docs, outdated requirements validation, and doc/workflow tests pinned to the removed local contract.
Decision: Kept `clio` as the source of truth for MCP semantics, updated ADAC wrapper docs to the flat hyphenated application context and explicit stdio/PowerShell guidance, and rewrote the requirements validator plus positive workflow fixtures to the new 11-section BA format.
Discovery: `scripts/workflow_cli.py` was still enforcing the old six-section requirements document and old UX/default markers even though ADAC docs had already switched to the new BA structure; the failing `tests.test_default_contract_docs` output was only a symptom of that deeper validator drift.
Files: README.md, context/mcp-application-tools-reference.md, scripts/workflow_cli.py, tests/test_default_contract_docs.py, tests/test_cross_platform_wrappers.py, tests/test_workflow_cli.py, tests/test_workflow_gates.py
Impact: ADAC now matches the current `clio` MCP contract for runtime wrapper guidance and validates the same BA document structure that the branch docs describe, reducing cross-repo drift on future orchestration changes.

## 2026-03-27 00:46 – Align ADAC helper validation with new clio MCP guardrails
Context: Cross-repo review of `clio` and ADAC found that the branch docs were aligned, but ADAC helper code still diverged from the live MCP contract in lookup validation and `page-list` wrapper checks.
Decision: Made ADAC fail fast when lookup plans try to add inherited `BaseLookup` fields or duplicate title-like columns, stopped requiring `package-name` for `page-list`, and updated the affected unit tests and fixtures to match the new behavior.
Discovery: The old helper path silently stripped `Name` from new lookups instead of surfacing the server-side contract violation, and local `page-list` validation was stricter than the current `clio` MCP tool signature even though branch docs had already delegated schema ownership back to `clio`.
Files: scripts/mcp_schema_sync.py, scripts/mcp_client.py, tests/test_mcp_schema_sync.py, tests/test_mcp_client.py, .codex/workspace-diary.md
Impact: ADAC wrapper behavior now matches the reviewed `clio` MCP contract more closely, so future orchestration runs should fail on real lookup-shape mistakes instead of normalizing them away and should no longer reject valid `page-list` calls locally.

## 2026-03-27 01:17 – Reverify ADAC MCP alignment against clio
Context: User asked to apply the necessary cross-repo consistency fixes after the branch review.
Decision: Rechecked the local ADAC helper diffs against the current `clio` MCP implementation, kept the minimal wrapper/test changes in place, and reran the targeted Python test modules that exercise `page-list` validation and lookup sync guardrails.
Discovery: The branch-level mismatch is gone in the local ADAC worktree: `page-list` now accepts empty args, and new lookup plans fail before execution when they try to add inherited or duplicate title-like columns.
Files: .codex/workspace-diary.md, scripts/mcp_client.py, scripts/mcp_schema_sync.py, tests/test_mcp_client.py, tests/test_mcp_schema_sync.py
Impact: Future ADAC checks can rely on the local helper layer matching the reviewed `clio` contract for the validated surface instead of rediscovering the same wrapper drift.

## 2026-03-31 12:38 – Preserve semantic Email schema type in ADAC guidance
Context: A fresh ADAC run still created `UsrEmail` as `ShortText` even though `clio` already supported the dedicated `Email` type, because the generated `schema-sync` payload was authored manually as `type='ShortText'`.
Decision: Updated ADAC’s schema/UI reference docs, entity-planning runbooks, and entity-creation skill to state explicitly that email, phone, and URL business fields must use `Email`, `PhoneNumber`, and `WebLink` in schema payloads instead of collapsing them to `ShortText`.
Discovery: The failure was guidance drift, not runtime drift: the session log proved ADAC called the freshly built `clio` binary via `CLIO_CMD`, but the request payload already contained `type='ShortText'`, so `clio` never had a chance to apply the newer Email alias handling.
Files: context/schema-reference.md, context/ui-reference.md, agents/03-implementation-plan.md, agents/04-implementation.md, skills/entity-creation/SKILL.md, tests/test_default_contract_docs.py, scripts/mcp_schema_sync.py, tests/test_mcp_schema_sync.py, .codex/workspace-diary.md
Impact: Future ADAC executions should generate schema payloads with the dedicated semantic text types, reducing the chance of Email/phone/URL fields being downgraded to generic text before reaching `clio`.

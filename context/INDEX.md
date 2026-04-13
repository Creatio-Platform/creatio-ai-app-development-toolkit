# Context Navigation Index

Read this file first.
Use it to choose the smallest set of repository documents for the current task.

Executable MCP contract is authoritative only in `clio MCP` through `tool-contract-get`.
This repository is authoritative for orchestration, approvals, BA structure, evidence policy, page-editing policy, and product or business invariants.

## Quick Capability Map

This repository supports two working modes.

### A. Full app generation

Generate a complete Creatio composable app from a natural-language request.
Start with `AGENTS.md`, then follow the current stage runbook in `agents/`.

### B. Targeted changes

Apply a focused change to an existing app or runtime page.

| Task | Skill | Read Next | Canonical MCP Guidance |
|------|-------|-----------|------------------------|
| Add or update entity columns | `skills/entity-creation/SKILL.md` | `context/essentials.md`, `context/schema-reference.md` | Resolve through `tool-contract-get` and `docs://mcp/guides/app-modeling` |
| Edit a Freedom UI page | `skills/page-schema-editing/SKILL.md` | `context/ui-reference.md`, `context/viewconfig-reference.md`, `context/handlers-reference.md` | Resolve through `tool-contract-get` and `docs://mcp/guides/existing-app-maintenance` |
| Seed lookup data or bindings | `skills/data-bindings-creation/SKILL.md` | `context/data-bindings-reference.md`, `context/schema-reference.md` | Resolve preferred vs fallback path through `clio` MCP guidance |
| Generate package descriptor | `skills/package-descriptor-creation/SKILL.md` | template and descriptor references only | no MCP write path required |
| Manage app sections (list, delete) | — | `context/essentials.md` | Resolve through `tool-contract-get` and `docs://mcp/guides/existing-app-maintenance` |

## Executable Contract

When you need exact tool names, required fields, aliases, defaults, response shapes, or error codes:

1. Call `tools/list` to confirm tool availability.
2. Call `tool-contract-get` through `scripts/mcp_client.py`.
3. Use `docs://mcp/guides/app-modeling` for app-modeling semantics.
4. Treat repository docs as workflow and policy guidance only.

`context/mcp-application-tools-reference.md` documents the local wrapper and normalization flow. It is not the executable MCP spec.

## Reading Strategy

1. Read `AGENTS.md` for orchestration rules.
2. Determine whether the task is full app generation or a targeted change.
3. Load only the stage runbook or skill that matches the task.
4. Read only the supporting context files needed for that stage.
5. Resolve executable MCP details through `tool-contract-get` instead of searching docs for payload syntax.

## Full App Generation Reads

| Phase | Must Read | What It Covers |
|------|-----------|----------------|
| Gate P | `AGENTS.md` | UX contract, routing, Gate P, global invariants |
| Agent 1 | `agents/01-environment-setup.md`, `context/essentials.md` | environment setup and local runtime rules |
| Agent 2 | `agents/02-requirements-gathering.md`, `context/business-checklist.md` | BA discovery, pre-analysis, Gate R approval |
| Agent 3 | `agents/03-implementation-plan.md`, `context/essentials.md`, `context/schema-reference.md` | canonical entity and page plan policy |
| Agent 4 | `agents/04-implementation.md`, `context/mcp-application-tools-reference.md`, `context/ui-reference.md`, `context/viewconfig-reference.md`, `scripts/mcp_client.py` | execution, verification, page-editing mechanics |

## Topic Map

| Topic | File | Notes |
|------|------|-------|
| Orchestration, approvals, business invariants | `AGENTS.md` | primary policy document |
| BA checklist | `context/business-checklist.md` | required business plan shape and completeness |
| Platform basics and canonical flows | `context/essentials.md` | high-level workflow only |
| Entity parents, DVTs, schema formats | `context/schema-reference.md` | structural reference |
| Freedom UI structure and runtime page patterns | `context/ui-reference.md` | form/list runtime policy |
| `viewConfigDiff` recipes | `context/viewconfig-reference.md` | container discovery and field recipes |
| Handler patterns and request types | `context/handlers-reference.md` | page-body handler policy |
| Safe SDK usage in page bodies | `context/devkit-common-reference.md` | page-body runtime API guidance |
| Data bindings and lookup seeding | `context/data-bindings-reference.md` | binding policy and tool usage |
| Local MCP transport and normalization | `context/mcp-application-tools-reference.md` | local wrapper, stdio transport, normalization |
| MCP transport helper | `scripts/mcp_client.py` | stdio client wrapper |

## Canonical MCP Guidance

Resolve canonical execution paths, fallback-only compatibility tools, and verify/read-back policy through:

- `tool-contract-get`
- `docs://mcp/guides/app-modeling`
- `docs://mcp/guides/existing-app-maintenance`

## Skill Notes

### `skills/entity-creation/SKILL.md`

Use for entity planning and schema-sync-oriented mutation policy.

### `skills/page-schema-editing/SKILL.md`

Use for runtime page-body editing policy, marker-safe edits, container discovery, and verification.
This skill must not define MCP parameter tables.

### `skills/data-bindings-creation/SKILL.md`

Use for lookup rows and module bindings.
Prefer composite or plan-driven flows over isolated binding calls when possible.

## MCP Tool Lookup Guidance

When you need executable tool parameters or current response shape:

| Need | Read |
|------|------|
| Current MCP tool signature | `tools/list` and the discovered `clio` MCP tool schema |
| App-modeling semantics | `docs://mcp/guides/app-modeling` |
| Local invocation pattern | `scripts/mcp_client.py` |
| Local result normalization | `context/mcp-application-tools-reference.md` |
| Repo-local execution flow | `agents/04-implementation.md` and the relevant skill file |

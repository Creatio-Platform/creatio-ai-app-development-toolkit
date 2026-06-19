# Context Navigation Index

Read this file first.
Use it to choose the smallest set of repository documents for the current task.

Executable MCP contract is authoritative only in `clio MCP` through `get-tool-contract`.
This repository is authoritative for orchestration, approvals, BA structure, and business invariants.

## Quick Capability Map

This repository drives BA-style Business Plans for Creatio apps and the approved clio MCP implementation flow.

Start with `AGENTS.md`, then follow the current stage runbook in `runbooks/`.

## Executable Contract

When you need exact tool names, required fields, aliases, defaults, response shapes, or error codes:

1. Call `tools/list` to confirm tool availability.
2. Call `get-tool-contract` — natively when the host exposes clio MCP as tool-calls, otherwise through `runtime/scripts/mcp_client.py` (stdio fallback). Both transports must resolve the same `clio` (one config, one environment list); see `AGENTS.md`, "clio MCP transport preference".
3. Use `docs://mcp/guides/app-modeling` for app-modeling semantics.
4. Treat repository docs as workflow and policy guidance only.

## Reading Strategy

1. Read `AGENTS.md` for orchestration rules.
2. Load only the stage runbook that matches the current task.
3. Read only the supporting context files needed for that stage.
4. Resolve executable MCP details through `get-tool-contract` instead of searching docs for payload syntax.

## Business Plan Generation Reads

| Phase | Must Read (repo) | clio MCP Guide (on-demand) | What It Covers |
|------|------------------|----------------------------|----------------|
| Gate P | `AGENTS.md` | — | UX contract, routing, Gate P, global invariants |
| Agent 1 | `runbooks/01-environment-setup.md`, `context/essentials.md` | `docs://mcp/guides/agent-execution` | environment setup, local runtime rules, DataForge availability check |
| Agent 2 | `runbooks/02-requirements-gathering.md`, `context/business-checklist.md`, `context/model-discovery-evidence.md` | — | BA discovery, pre-analysis, Gate R approval, Technical Implementation Handoff |
| Support run | `AGENTS.md` (Support Mode sections) | `docs://mcp/guides/support-mode` | diagnostic-first behavior, severity routing, fail-fast evidence |

Reading rules:
- Each repo file in this table is the static stage runbook. Read it once per stage as needed; do not pre-load every supporting reference up front.
- Each clio MCP guide is on-demand. Fetch it through `ReadMcpResourceTool` only when its scope matches the current step.
- Do not invent local copies of clio MCP guide content. The clio guide is the source of truth for execution order and support-mode mechanics.

## Topic Map

| Topic | File | Notes |
|------|------|-------|
| Orchestration, approvals, business invariants | `AGENTS.md` | primary policy document |
| BA checklist | `context/business-checklist.md` | required business plan shape and completeness |
| Platform basics and canonical flows | `context/essentials.md` | high-level workflow only |
| `Usr` prefixes, casing, GUIDs, binding naming | `context/naming-conventions.md` | naming policy |
| Local clio CLI commands | `context/clio-cli-reference.md` | environment setup, package management, dev tools |
| DataForge tool parameter contract and response fields | `context/model-discovery-evidence.md` | DataForge tool reference for Agent 1 availability check |
| Product telemetry consent, events, and payload | `context/product-telemetry.md` | consent flow, the 14 workflow events, and the agent-sent payload fields |
| MCP transport helper | `runtime/scripts/mcp_client.py` | stdio client wrapper — fallback only, used when the host has no native clio MCP |

## Canonical MCP Guidance

Resolve canonical execution paths and verify/read-back policy through:

- `get-tool-contract`
- `docs://mcp/guides/app-modeling`
- `docs://mcp/guides/existing-app-maintenance`

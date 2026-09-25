# Context Navigation Index

Read this file first.
Use it to choose the smallest set of toolkit documents for the current task.

Executable MCP contract is authoritative only in `clio MCP` through `get-tool-contract`.
The toolkit is authoritative for orchestration, approvals, BA structure, and business invariants.

## What This Plugin Holds

`creatio-core` is the shared foundation every other Creatio plugin depends on: this `plugins/creatio-core/context/`
directory (platform basics, naming policy, clio CLI reference, the DataForge evidence contract, product telemetry), the
`creatio-schema-naming` and `creatio-ui-guidelines` skills, the clio MCP declaration (`.mcp.json`) and the
product-telemetry hook (`plugins/creatio-core/hooks/telemetry-routing.mjs`).

The app-creation workflow (Gate P -> Business Plan -> Gate R -> implementation) is not part of this plugin. It is the
`creatio-app-orchestrator` skill of the `creatio-app-builder` plugin. That skill's `references/` directory holds the
orchestration policy (`orchestration-policy.md`: approvals, the Business Plan format, routing, support mode), the three
stage runbooks (`01-environment-setup.md`, `02-requirements-gathering.md`, `03-app-implementation.md`) and the
`business-checklist.md`. Repository-wide rules (source of truth, clio coupling, required workflow) stay in the root
`AGENTS.md`.

Paths to another plugin below are written from the toolkit root, which is the same path in a checkout, an extracted
release and a Cursor local install. Where `creatio-core` is installed on its own, load the named skill instead.

## Executable Contract

When you need exact tool names, required fields, aliases, defaults, response shapes, or error codes:

1. Call `tools/list` to confirm tool availability.
2. Call `get-tool-contract` — natively when the host exposes clio MCP as tool-calls. If native tools are not surfaced, that is not automatically a blocker: run the `clio_mcp_preflight.py` gate (see `AGENTS.md`, "clio MCP availability preflight") — State B means clio is usable over stdio, State C means stop with a prerequisites blocker. Do not silently fall back. `plugins/creatio-app-builder/runtime/scripts/mcp_client.py` is an explicit opt-in escape hatch, not the default fallback. Both transports must resolve the same `clio` (one config, one environment list); see `AGENTS.md`, "clio MCP transport preference".
3. Use `docs://mcp/guides/app-modeling` for app-modeling semantics.
4. Treat repository docs as workflow and policy guidance only.

## Reading Strategy

1. Read the root `AGENTS.md` for the repository-wide rules, then the orchestration policy of the
   `creatio-app-orchestrator` skill (`plugins/creatio-app-builder/skills/creatio-app-orchestrator/references/orchestration-policy.md`) for the app-workflow contract.
2. Load only the stage runbook that matches the current task from that skill's `references/` (table below).
3. Read only the core context files needed for that stage.
4. Resolve executable MCP details through `get-tool-contract` instead of searching docs for payload syntax.

## Business Plan Generation Reads

| Phase | Must Read (repo) | clio MCP Guide (on-demand) | What It Covers |
|------|------------------|----------------------------|----------------|
| Gate P | `plugins/creatio-app-builder/skills/creatio-app-orchestrator/references/orchestration-policy.md`, `plugins/creatio-core/context/essentials.md` (Global Invariants) | — | UX contract, routing, Gate P, global invariants |
| Agent 1 | `plugins/creatio-app-builder/skills/creatio-app-orchestrator/references/01-environment-setup.md`, `plugins/creatio-core/context/essentials.md` | `docs://mcp/guides/agent-execution` | environment setup, local runtime rules, DataForge availability check |
| Agent 2 | `plugins/creatio-app-builder/skills/creatio-app-orchestrator/references/02-requirements-gathering.md`, `plugins/creatio-app-builder/skills/creatio-app-orchestrator/references/business-checklist.md`, `plugins/creatio-core/context/model-discovery-evidence.md` | — | BA discovery, pre-analysis, Gate R approval, Technical Implementation Handoff |
| Agent 3 | `plugins/creatio-app-builder/skills/creatio-app-orchestrator/references/03-app-implementation.md`, `plugins/creatio-core/context/essentials.md` | `docs://mcp/guides/app-modeling` | post-Gate-R scaffolding, transient section-creation failure playbook, entity/page/data modeling |
| Support run | `plugins/creatio-app-builder/skills/creatio-app-orchestrator/references/orchestration-policy.md` (Task Classification and Support Mode sections) | `docs://mcp/guides/support-mode` | diagnostic-first behavior, severity routing, fail-fast evidence |

Reading rules:
- Each repo file in this table is the static stage reference. Read it once per stage as needed; do not pre-load every supporting reference up front. The runbooks and the policy belong to the `creatio-app-orchestrator` skill; the context files belong to this plugin.
- Each clio MCP guide is on-demand. Fetch it through `ReadMcpResourceTool` only when its scope matches the current step.
- Do not invent local copies of clio MCP guide content. The clio guide is the source of truth for execution order and support-mode mechanics.

## Topic Map

| Topic | File | Notes |
|------|------|-------|
| Orchestration, approvals, Business Plan format, routing, support mode | `plugins/creatio-app-builder/skills/creatio-app-orchestrator/references/orchestration-policy.md` | the app-workflow contract, owned by the `creatio-app-orchestrator` skill |
| Repository-wide rules: source of truth, clio coupling, required workflow | `AGENTS.md` | root policy document |
| Global business invariants | `plugins/creatio-core/context/essentials.md` | "Global Invariants" section |
| BA checklist | `plugins/creatio-app-builder/skills/creatio-app-orchestrator/references/business-checklist.md` | required business plan shape and completeness |
| Platform basics and canonical flows | `plugins/creatio-core/context/essentials.md` | high-level workflow only |
| `Usr` prefixes, casing, GUIDs, binding naming | `plugins/creatio-core/context/naming-conventions.md` | naming policy |
| Local clio CLI commands | `plugins/creatio-core/context/clio-cli-reference.md` | environment setup, package management, dev tools |
| DataForge tool parameter contract and response fields | `plugins/creatio-core/context/model-discovery-evidence.md` | DataForge tool reference for Agent 1 availability check |
| Product telemetry consent, events, and payload | `plugins/creatio-core/context/product-telemetry.md` | consent flow, the payload fields, the flow-agnostic stage vocabulary, and the `workflow` values that identify each flow (app-creation, classic-to-freedom-migration, mobile-page-conversion, branding, app-maintenance) |
| MCP transport helper | `plugins/creatio-app-builder/runtime/scripts/mcp_client.py` | stdio client wrapper — explicit opt-in escape hatch only, used after the developer opts in on a host with no native clio MCP; never the automatic response to an unavailable server |
| Telemetry routing hook | `plugins/creatio-core/hooks/telemetry-routing.mjs`, `plugins/creatio-core/hooks/telemetry/` | `PostToolUse`/`UserPromptSubmit`/`Stop` entry point and its split-out modules (state directory and marker claims, transcript scanning, floor/usage protocols, dispatch, identity, reminder prose) — the code that emits `workflow_started` and `session_usage`, not the vocabulary they carry (see `plugins/creatio-core/context/product-telemetry.md` for that) |
| Why the hook is a second clio transport | `docs/telemetry-transport-decision.md` | ADR: why `plugins/creatio-core/hooks/telemetry-routing.mjs` does not share `mcp_client.py`'s implementation, what narrow surface the two do share, and the floor's exactly-once contract and invariants |

## Canonical MCP Guidance

Resolve canonical execution paths and verify/read-back policy through:

- `get-tool-contract`
- `docs://mcp/guides/app-modeling`
- `docs://mcp/guides/existing-app-maintenance`

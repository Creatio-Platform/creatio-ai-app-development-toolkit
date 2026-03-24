# No-Code Assistant for Creatio

Self-contained toolkit for AI-driven generation and deployment of Creatio composable apps from natural-language requests.

Supported agents: GitHub Copilot CLI, VS Code Copilot, Codex CLI, Claude Code.

## Source of Truth

Use these files as canonical:

- `AGENTS.md`
- `context/business-checklist.md`
- `context/essentials.md`
- `context/app-documentation-contract.md`
- `context/schema-reference.md`
- `context/ui-reference.md`
- `context/data-bindings-reference.md`
- `context/bindings-lookup.json`
- `templates/**`

## Developer UX

Primary workflow is natural language:

1. Developer sends one free-form prompt.
2. Agent returns a short "What I understood".
3. On the first turn, the agent responds directly from the prompt instead of doing a long repo preflight.
4. Agent asks a routing question first: `site-ready-now` or `planning-first`.
5. Agent runs a compact BA-style discovery with 3-7 critical questions focused on business goal, core problem, users/roles, MVP scope, and success criteria.
6. The routing question and the main discovery questions appear in that same first user-facing response.
7. Agent persists a fresh Gate P for the current request after natural-language confirmation; `planning-first` may defer runtime endpoints until implementation.
8. Agent asks minimal technical questions only for blockers.
9. After Gate R, the agent initializes `output/<AppName>/docs/**` as a draft skeleton before implementation starts.
10. Agent runs the remaining pipeline and returns final artifacts/results.
11. Internal gate tokens, old workflow-state details, and scripts stay hidden from developer-facing dialogue unless they are real blockers.

Each business checklist group must persist `source=confirmed|assumed`. When a group is `assumed`, the exact assumption text must also be recorded and carried into the final approval context.

## Workflow

Orchestrator flow:

1. Planning start with natural-language confirmation and persisted Gate P in `.workflow-state/<AppName>/planning-state.json`.
2. If the route is `site-ready-now`, environment setup creates `output/<AppName>/.creatio-env.json`; if the route is `planning-first`, this step waits until implementation is requested.
3. Requirements gathering produces a BA-style `requirements.md`, writes `request-spec.json`, persists approved `workflow-state.json`, and initializes draft docs under `output/<AppName>/docs/**`.
   The approval artifact is the BA-style requirements draft itself, even if the host UI wraps it in a container such as `<proposed_plan>`.
4. Implementation plan generates `output/<AppName>/technical-annex.md` and `output/<AppName>/plan.md` when implementation is explicitly requested.
5. Implementation runs synchronously, uses MCP `application.create`, or branches explicitly into `application.get_list` -> `application.get_info` for existing apps, initializes canonical context in `mcp-application-result.json`, applies ordered entity sync via MCP entity tools when needed, and persists refreshed artifacts only after schemas are fully materialized.

All generated artifacts are under `output/<AppName>/`.

## Runtime Scripts

- `bash scripts/write-planning-state.sh <AppName> "<approvedBy>" "<routingMode>" "<creatioUrlOrDeferred>" "<understandingText>" "<confirmationText>"`
- `bash scripts/check-planning-gate.sh <AppName>`
- `bash scripts/validate-request-spec.sh output/<AppName>/request-spec.json`
- `bash scripts/write-approval-state.sh <AppName> "<approvedBy>" "<approvalText>"`
- `bash scripts/check-approval-gate.sh <AppName>`
- `python3 scripts/app_docs.py init --app-dir output/<AppName> --request-spec output/<AppName>/request-spec.json`
- `python3 scripts/mcp_context_adapter.py normalize output/<AppName>/mcp-application-result.json`
- `python3 scripts/mcp_result_evidence.py report output/<AppName>/mcp-application-result.json output/<AppName>/mcp-application-report.md`
- `python3 scripts/page_body_tools.py build-update-args <SchemaName> <body-file> --dry-run`
- `python3 scripts/mcp_schema_sync.py plan --current-result output/<AppName>/mcp-application-result.json --edited-context output/<AppName>/editable-context.json`
- `python3 scripts/mcp_schema_sync.py apply --result output/<AppName>/mcp-application-result.json --edited-context output/<AppName>/editable-context.json --env output/<AppName>/.creatio-env.json`
- `python3 scripts/mcp_page_sync.py build-plan --plan-md output/<AppName>/plan.md --output output/<AppName>/page-sync-plan.json`
- `python3 scripts/mcp_page_sync.py apply --result output/<AppName>/mcp-application-result.json --plan output/<AppName>/page-sync-plan.json --env output/<AppName>/.creatio-env.json --report output/<AppName>/mcp-application-report.md`

`mcp-application-result.json` stores the compact short MCP response in flat runtime form (`packageUId`, `packageName`, `entities`) plus `editableContext`, `operationLog`, `pageEvidence`, and any persisted acceptance evidence. Reports must be derived from that runtime evidence rather than handwritten summaries, and page/report statuses must distinguish `implemented`, `machineChecked`, and `manualCheckPending`.

When page sync is required, `plan.md` must contain an embedded machine-readable `page-sync-plan.json` block between `<!-- PAGE_SYNC_PLAN_JSON_START -->` and `<!-- PAGE_SYNC_PLAN_JSON_END -->`. The same payload can be materialized to `output/<AppName>/page-sync-plan.json` with `scripts/mcp_page_sync.py build-plan`, and `scripts/mcp_page_sync.py apply` can consume either the JSON file or the markdown plan directly.

## Architecture

```text
Orchestrator (AGENTS.md)
|-- Agent 1: Environment Setup           -> .creatio-env.json
|-- Agent 2: Requirements (interactive)  -> requirements.md + request-spec.json + workflow-state.json
|-- Agent 3: Implementation Plan         -> technical-annex.md + plan.md
|-- Agent 4: Implementation              -> mcp-application-result.json + report
|   `-- Direct MCP tools via curl (see context/mcp-application-tools-reference.md)
```

## Repository Structure

```text
AGENTS.md
.github/copilot-instructions.md
agents/
  01-environment-setup.md
  02-requirements-gathering.md
  03-implementation-plan.md
  04-implementation.md
scripts/
  check-planning-gate.sh
  check-approval-gate.sh
  validate-request-spec.sh
  write-planning-state.sh
  write-approval-state.sh
  app_docs.py
  mcp_context_adapter.py
  mcp_schema_sync.py
  mcp_page_sync.py
.workflow-state/
context/
  business-checklist.md
  essentials.md
  mcp-application-tools-reference.md
  schema-reference.md
  ui-reference.md
  data-bindings-reference.md
  bindings-lookup.json
templates/
output/
```

## Prerequisites

- AI code agent
- [clio](https://github.com/Advance-Technologies-Foundation/clio): `dotnet tool install clio -g`
- Access to a running Creatio instance

## Example Prompt

```text
Generate with a code agent an Events composable app with all required schema types.
A simple Events app is a lightweight tool for managing events in Creatio.
It allows users to create and maintain a list of events, see them in a structured list view,
update their status, and manage event details throughout their lifecycle.
```

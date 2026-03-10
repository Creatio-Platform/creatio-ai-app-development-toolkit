# No-Code Assistant for Creatio

Self-contained toolkit for AI-driven generation and deployment of Creatio composable apps from natural-language requests.

Supported agents: GitHub Copilot CLI, VS Code Copilot, Codex CLI, Claude Code.

## Source of Truth

Use these files as canonical:
- `AGENTS.md`
- `context/business-checklist.md`
- `context/essentials.md`
- `context/schema-reference.md`
- `context/ui-reference.md`
- `context/data-bindings-reference.md`
- `context/bindings-lookup.json`
- `templates/**`

## Developer UX

Primary workflow is natural language:
1. Developer sends one free-form prompt.
2. Agent returns a short “What I understood”.
3. Agent persists Gate P only after natural-language confirmation and a concrete Creatio URL.
4. Agent asks business clarifications in batches until checklist is complete.
5. Agent asks minimal technical questions only (blockers).
6. Agent runs the pipeline and returns final artifacts/results.
7. Internal gate tokens and scripts stay hidden from developer-facing dialogue.

## Workflow

Orchestrator flow:
1. Planning start with natural-language confirmation and persisted Gate P in `.workflow-state/<AppName>/planning-state.json`.
2. Environment setup: creates `output/<AppName>/.creatio-env.json`.
3. Requirements gathering: builds a full `request-spec.json`, then writes approved `workflow-state.json`.
4. Implementation plan: prepares deterministic MCP payload plan in `output/<AppName>/plan.md`.
5. Implementation: runs synchronously, uses MCP `application.create`, or branches explicitly into `application.get_list` → `application.get_info` for existing apps, initializes canonical context in `mcp-application-result.json`, builds `editableContext`, applies ordered entity sync via MCP entity tools when needed, and persists refreshed artifacts only after schemas are fully materialized.

All generated artifacts are under `output/<AppName>/`.

## Runtime Scripts

- `bash scripts/write-planning-state.sh <AppName> "<approvedBy>" "<creatioUrl>" "<understandingText>" "<confirmationText>"`
- `bash scripts/check-planning-gate.sh <AppName>`
- `bash scripts/validate-request-spec.sh output/<AppName>/request-spec.json`
- `bash scripts/write-approval-state.sh <AppName> "<approvedBy>" "<approvalText>"`
- `bash scripts/check-approval-gate.sh <AppName>`
- `python3 scripts/mcp_context_adapter.py normalize output/<AppName>/mcp-application-result.json`
- `python3 scripts/mcp_schema_sync.py plan --current-result output/<AppName>/mcp-application-result.json --edited-context output/<AppName>/editable-context.json`
- `python3 scripts/mcp_schema_sync.py apply --result output/<AppName>/mcp-application-result.json --edited-context output/<AppName>/editable-context.json --env output/<AppName>/.creatio-env.json`

`mcp-application-result.json` stores the compact short MCP response in flat runtime form (`packageUId`, `packageName`, `entities`) plus `editableContext`, which is the package/entity-oriented model intended for LLM or HITL edits before schema synchronization.

## Architecture

```
Orchestrator (AGENTS.md)
├── Agent 1: Environment Setup           -> .creatio-env.json
├── Agent 2: Requirements (interactive)  -> requirements.md + request-spec.json + workflow-state.json
├── Agent 3: Implementation Plan         -> plan.md
├── Agent 4: Implementation              -> mcp-application-result.json + report (FINAL)
│   └── Direct MCP tools via curl (see context/mcp-application-tools-reference.md)
```

## Repository Structure

```
AGENTS.md
.github/copilot-instructions.md
agents/
  01-environment-setup.md
  02-requirements-gathering.md
  03-implementation-plan.md
  04-implementation.md
skills/
  entity-creation/SKILL.md
  page-creation/SKILL.md
  data-bindings-creation/SKILL.md
  package-descriptor-creation/SKILL.md
scripts/
  check-planning-gate.sh
  check-approval-gate.sh
  validate-request-spec.sh
  write-planning-state.sh
  write-approval-state.sh
  mcp_context_adapter.py
  mcp_schema_sync.py
.workflow-state/
context/
  business-checklist.md
  essentials.md
  mcp-application-tools-reference.md  (✨ Complete MCP tools guide)
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

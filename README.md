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

`context/archived/**` is reference-only.

## Developer UX

Primary workflow is natural language:
1. Developer sends one free-form prompt.
2. Agent returns a short “What I understood”.
3. Agent asks business clarifications in batches until checklist is complete.
4. Agent asks minimal technical questions only (blockers + deploy preference).
5. Agent runs the pipeline and returns final artifacts/results.
6. Internal gate tokens and scripts stay hidden from developer-facing dialogue.

Default deploy preference values:
- `deploy_now`
- `generate_only`

## Workflow

Orchestrator flow:
1. Planning start with natural-language confirmation.
2. Environment setup: creates `output/<AppName>/.creatio-env.json`.
3. Requirements gathering: builds `requirements.md`, `request-spec.json`, and `workflow-state.json`.
4. Implementation plan: prepares deterministic MCP payload plan in `output/<AppName>/plan.md`.
5. Implementation: uses MCP `application.create`, initializes canonical context in `mcp-application-result.json`, builds `editableContext`, applies ordered entity sync via MCP entity tools when needed, and persists refreshed artifacts.
6. Deploy and verify (or skip by policy): short DB-first contract runs compilation/restart/healthcheck.

All generated artifacts are under `output/<AppName>/`.

## Runtime Scripts

- `python3 scripts/mcp_context_adapter.py normalize output/<AppName>/mcp-application-result.json`
- `python3 scripts/mcp_schema_sync.py plan --current-result output/<AppName>/mcp-application-result.json --edited-context output/<AppName>/editable-context.json`
- `python3 scripts/mcp_schema_sync.py apply --result output/<AppName>/mcp-application-result.json --edited-context output/<AppName>/editable-context.json --env output/<AppName>/.creatio-env.json`

`mcp-application-result.json` now stores the compact short MCP response plus `editableContext`, which is the package/entity-oriented model intended for LLM or HITL edits before schema synchronization.

## Architecture

```
Orchestrator (AGENTS.md)
├── Agent 1: Environment Setup           -> .creatio-env.json
├── Agent 2: Requirements (interactive)  -> requirements.md + request-spec.json + workflow-state.json
├── Agent 3: Implementation Plan         -> plan.md
├── Agent 4: Implementation              -> mcp-application-result.json + report
│   └── Skill: application-creation
└── Agent 5: Deploy & Verification       -> deployment or skip report
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
  05-deploy-verification.md
skills/
  application-creation/SKILL.md
  entity-creation/SKILL.md
  page-creation/SKILL.md
  data-bindings-creation/SKILL.md
  package-descriptor-creation/SKILL.md
scripts/
  check-approval-gate.sh
  write-approval-state.sh
  mcp_context_adapter.py
  mcp_schema_sync.py
context/
  business-checklist.md
  essentials.md
  schema-reference.md
  ui-reference.md
  data-bindings-reference.md
  bindings-lookup.json
  archived/
templates/
examples/todo-list/
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

See `examples/todo-list/` for an end-to-end reference.

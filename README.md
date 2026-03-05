# No-Code Assistant for Creatio

Self-contained toolkit for AI-driven generation and deployment of Creatio composable apps from natural-language requests.

Supported agents: GitHub Copilot CLI, VS Code Copilot, Codex CLI, Claude Code.

## Source of Truth

Use these files as canonical:
- `AGENTS.md`
- `context/essentials.md`
- `context/schema-reference.md`
- `context/ui-reference.md`
- `context/data-bindings-reference.md`
- `context/bindings-lookup.json`
- `templates/**`

`context/archived/**` is reference-only.

## Workflow

Orchestrator flow:
1. Planning start (Gate P): developer provides target Creatio URL and confirms with `APPROVE_PLAN`.
2. Environment setup: creates `output/<AppName>/.creatio-env.json`.
3. Requirements gathering (interactive): confirms scope and gets `APPROVE_REQUIREMENTS` (Gate R).
4. Implementation plan: prepares deterministic MCP payload plan in `output/<AppName>/plan.md`.
5. Implementation: uses MCP `application.create` to generate preview, then materializes files to `output/<AppName>/packages/**`.
6. Deploy and verify: `clio push-pkg`, compile/restart checks, deployment report.

All generated artifacts are under `output/<AppName>/`.

## Architecture

```
Orchestrator (AGENTS.md)
├── Agent 1: Environment Setup           -> .creatio-env.json
├── Agent 2: Requirements (interactive)  -> requirements.md + workflow-state.json
├── Agent 3: Implementation Plan         -> plan.md
├── Agent 4: Implementation              -> packages/** + MCP preview artifacts
│   └── Skill: application-creation
└── Agent 5: Deploy & Verification       -> deployment report
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
context/
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

```
Create a Todo List application with tasks that have title, description,
status (New/In Progress/Done), priority (Low/Medium/High), and due date
on <CREATIO_URL>.
```

See `examples/todo-list/` for an end-to-end reference.

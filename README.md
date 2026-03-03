# No-Code Assistant for Creatio

Self-contained toolkit for AI-driven generation of Creatio composable apps from natural language.

Supported agents: GitHub Copilot CLI, VS Code Copilot, Codex CLI, Claude Code.

## Source of Truth

Use these files as canonical project documentation:
- `AGENTS.md`
- `context/essentials.md`
- `context/schema-reference.md`
- `context/ui-reference.md`
- `context/data-bindings-reference.md`
- `context/bindings-lookup.json`
- `templates/**`

`context/archived/**` contains legacy material and is not canonical.

## Quick Start

1. Open this repo with your AI coding agent.
2. Ask: `Create a Todo List app with tasks, statuses, priorities on http://mysite.creatio.com`.
3. The orchestrator runs 5 phases: setup → requirements → planning → implementation → deploy.
4. Output is generated under `output/<AppName>/`.

## Architecture

```
Orchestrator (AGENTS.md)
├── Agent 1: Environment Setup      -> .creatio-env.json
├── Agent 2: Requirements (interactive) -> requirements.md + workflow-state.json
├── Agent 3: Implementation Plan    -> plan.md
├── Agent 4: Implementation         -> packages/**
│   ├── Skill: package-descriptor-creation
│   ├── Skill: entity-creation (MCP)
│   ├── Skill: page-creation
│   └── Skill: data-bindings-creation
└── Agent 5: Deploy & Verification  -> deployment report
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
- [clio](https://github.com/Advance-Technologies-Foundation/clio):
  - `dotnet tool install clio -g`
- Access to a Creatio instance

## Example Prompt

```
Create a Todo List application with tasks that have title, description,
status (New/In Progress/Done), priority (Low/Medium/High), and due date.
Deploy to http://mysite.creatio.com
```

See `examples/todo-list/` for a complete reference output.

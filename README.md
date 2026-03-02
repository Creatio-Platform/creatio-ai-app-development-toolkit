# No-Code Assistant for Creatio

Self-contained toolkit that enables AI code agents to generate Creatio composable apps from natural language descriptions.

**Supported AI agents:** GitHub Copilot CLI, VS Code Copilot, Codex CLI, Claude Code

## Quick Start

1. Clone this repo and open in your IDE with AI agent
2. Say: *"Create a Todo List app with tasks, statuses, and priorities on http://mysite.creatio.com"*
3. AI orchestrates 5 agents automatically: setup → requirements → planning → implementation → deploy
4. Working Creatio app deployed and accessible

## Architecture

```
Orchestrator (AGENTS.md)
├── Agent 1: Environment Setup    → .creatio-env.json
├── Agent 2: Requirements ⛔       → requirements.md (interactive Q&A)
├── Agent 3: Implementation Plan  → plan.md (GUIDs, specs)
├── Agent 4: Implementation       → packages/**
│   ├── Skill: Entity Creation
│   ├── Skill: Page Creation
│   ├── Skill: Addon Creation
│   └── Skill: Data Bindings
└── Agent 5: Deploy & Verify      → deployed app
```

## How It Works

```
You describe the app → AI reads agents/skills from this repo → generates package files → deploys via clio
```

## Repository Structure

```
AGENTS.md                          ← Orchestrator (pipeline, contracts, rules)
.github/copilot-instructions.md    ← Custom instructions for Copilot
agents/                            ← Agent definitions (one per phase)
  ├── 01-environment-setup.md        Clio connection setup
  ├── 02-requirements-gathering.md   Interactive requirements Q&A
  ├── 03-implementation-plan.md      Plan with all GUIDs
  ├── 04-implementation.md           File generation orchestrator
  └── 05-deploy-verification.md      Deploy, compile, verify
skills/                            ← Implementation skills (used by Agent 4)
  ├── entity-creation.md             Entity schema files (3 per entity)
  ├── page-creation.md               Page schema files (4 per page)
  ├── addon-creation.md              Addon schema files (3 per addon)
  └── data-bindings-creation.md      SysModule, SysModuleEntity, seed data
context/                           ← Knowledge base about Creatio platform
  ├── creatio-platform.md            Platform overview, composable apps
  ├── entity-types.md                DataValueType→GUID map, parent schemas
  ├── schema-types.md                Entity/Page/Addon file formats
  ├── composable-app-structure.md    Package descriptor, directory layout
  ├── freedomui-reference.md         Page JS format, control types
  ├── data-bindings-reference.md     SysModule/SysModuleEntity formats
  ├── clio-reference.md              CLI commands reference
  └── naming-conventions.md          Usr prefix, PascalCase rules
templates/                         ← Real working file templates
examples/todo-list/                ← Complete reference implementation
output/                            ← Generated apps (gitignored)
```

## Prerequisites

- AI code agent (any of the supported agents above)
- [clio](https://github.com/Advance-Technologies-Foundation/clio) — `dotnet tool install clio -g`
- Access to a Creatio instance

## Example

```
> Create a Todo List application with tasks that have title, description,
> status (New/In Progress/Done), priority (Low/Medium/High), and due date.
> Deploy to http://mysite.creatio.com
```

See `examples/todo-list/` for the complete reference output — all generated files with correct formats.

# Copilot Instructions — No-Code Creatio Assistant

## About This Repository

Toolkit for AI-assisted Creatio composable app development. It includes orchestration instructions, generation skills, canonical context, and working templates.

## Source of Truth

Treat these as canonical:
- `AGENTS.md`
- `context/essentials.md`
- `context/schema-reference.md`
- `context/ui-reference.md`
- `context/data-bindings-reference.md`
- `context/bindings-lookup.json`
- `templates/**`

Do not use `context/archived/**` as primary guidance.

## Architecture

- Orchestrator: `AGENTS.md`
- Agents: `agents/`
- Skills: `skills/*/SKILL.md`
- Context: `context/`
- Templates: `templates/`

## Execution Rules

1. Read `AGENTS.md` first.
2. Start planning mode only at the beginning of a new app workflow and get exact token `APPROVE_PLAN`.
3. Before `APPROVE_PLAN`: do not run agents, do not run `clio`, do not write `output/<AppName>/`.
4. After `APPROVE_PLAN`, do not re-enter planning gate between agents.
5. Run phases in order: setup → requirements → plan → implementation → deploy.
6. Agents 1/3/4/5 run in background (`task(..., mode: "background")`) and wait with `read_agent`.
7. Agent 2 is interactive only and must not be delegated.
8. Enforce Gate R token: `APPROVE_REQUIREMENTS`.
9. Before Agent 3/4/5 run: `scripts/check-approval-gate.sh <AppName>`.
10. Generate entities only via MCP tools `entity.create_lookup` / `entity.create`.
11. Use `clio push-pkg` for deployment.

## Agent 4 Skills

- `skills/package-descriptor-creation/SKILL.md`
- `skills/entity-creation/SKILL.md`
- `skills/page-creation/SKILL.md`
- `skills/data-bindings-creation/SKILL.md`

Addons are generated from `templates/addons/` during implementation (no separate addon skill file).

## Critical Conventions

- All custom names start with `Usr`.
- No duplicate GUIDs.
- Entities inherit from BaseEntity or BaseLookup.
- Do not add inherited columns (`Id`, `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy`).
- Enum-like fields are separate lookup entities.
- All generated files live under `output/<AppName>/`.

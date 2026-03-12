# Copilot Instructions — No-Code Creatio Assistant

## About This Repository

Toolkit for AI-assisted Creatio composable app development. It includes orchestration instructions, generation skills, canonical context, and templates.

## Source of Truth

Treat these as canonical:
- `AGENTS.md`
- `context/business-checklist.md`
- `context/essentials.md`
- `context/schema-reference.md`
- `context/ui-reference.md`
- `context/data-bindings-reference.md`
- `context/bindings-lookup.json`
- `templates/**`

## Architecture

- Orchestrator: `AGENTS.md`
- Agents: `agents/`
- Skills: `skills/*/SKILL.md`
- Context: `context/`
- Templates: `templates/`

## Execution Rules

1. Read `AGENTS.md` first.
2. Use natural-language interaction as primary UX.
3. Before Agent 1, persist Gate P with `scripts/write-planning-state.sh` and verify it with `scripts/check-planning-gate.sh`.
4. Never create `output/<AppName>/` artifacts before Gate P passes.
5. Ask business clarifications until checklist is complete.
6. Ask technical questions only for blockers only.
7. Never expose internal gate tokens or script names in user-facing dialogue.
8. Run phases in order: setup → requirements → plan → implementation.
9. Agents 1/3 run in background (`task(..., mode: "background")`) and wait with `read_agent`. Agent 4 runs synchronously.
10. Agent 2 is interactive only and must not be delegated.
11. Persist workflow artifacts:
   - `requirements.md`
   - `request-spec.json`
   - `workflow-state.json`
12. Before Agent 3/4 run: `scripts/check-approval-gate.sh <AppName>`.
13. Gate R must be written with `scripts/write-approval-state.sh <AppName> "<approvedBy>" "<approvalText>"`.
14. For full app creation, use MCP `application.create` as primary generation path.
15. If create collides with an existing app, branch only through documented existing-app discovery (`application.get_list` → `application.get_info`) and report the branch explicitly.
16. Validate `application.create` presence via `tools/list` before implementation.
17. Persist implementation evidence to `mcp-application-result.json` and `mcp-application-report.md`.
18. Final summaries must reflect the materialized result, not only the planned request spec.
19. During app-generation execution, write only `output/<AppName>/` artifacts. Repository helper/doc/script fixes must run as a separate repo-maintenance task.

## Agent 4 Implementation

Agent 4 executes MCP tools directly via curl commands. All instructions and examples are in:
- `agents/04-implementation.md`
- `context/mcp-application-tools-reference.md`

The `skills/application-creation/SKILL.md` file is **deprecated** and no longer used. All workflow documentation has been consolidated into the agent instructions and MCP reference guide.

## Critical Conventions

- All custom names start with `Usr`.
- Entities inherit from BaseEntity or BaseLookup.
- Do not add inherited columns (`Id`, `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy`).
- Enum-like fields are separate lookup entities.
- All generated files live under `output/<AppName>/`.

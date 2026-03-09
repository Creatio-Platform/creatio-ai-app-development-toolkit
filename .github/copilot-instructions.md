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
3. Ask business clarifications until checklist is complete.
4. Ask technical questions only for blockers and deploy policy.
5. Never expose internal gate tokens or script names in user-facing dialogue.
6. Run phases in order: setup → requirements → plan → implementation → deploy/skip.
7. Agents 1/3/5 run in background (`task(..., mode: "background")`) and wait with `read_agent`. Agent 4 runs synchronously.
8. Agent 2 is interactive only and must not be delegated.
9. Persist workflow artifacts:
   - `requirements.md`
   - `request-spec.json`
   - `workflow-state.json`
10. Before Agent 3/4/5 run: `scripts/check-approval-gate.sh <AppName>`.
11. For full app creation, use MCP `application.create` as primary generation path.
12. Validate `application.create` presence via `tools/list` before implementation.
13. Persist implementation evidence to `mcp-application-result.json` and `mcp-application-report.md`.
14. Respect deploy policy:
   - `deploy_now` → run Agent 5 deploy flow
   - `generate_only` → skip deploy and report artifacts only
15. During app-generation execution, write only `output/<AppName>/` artifacts. Repository helper/doc/script fixes must run as a separate repo-maintenance task.

## Agent 4 Skill

- `skills/application-creation/SKILL.md`

## Critical Conventions

- All custom names start with `Usr`.
- Entities inherit from BaseEntity or BaseLookup.
- Do not add inherited columns (`Id`, `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy`).
- Enum-like fields are separate lookup entities.
- All generated files live under `output/<AppName>/`.

# Copilot Instructions - No-Code Creatio Assistant

## About This Repository

Toolkit for AI-assisted Creatio composable app development. It includes orchestration instructions, generation skills, canonical context, and templates.

## Source of Truth

Treat these as canonical:
- `AGENTS.md`
- `context/business-checklist.md`
- `context/essentials.md`
- `context/app-documentation-contract.md`
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

## Plan Mode Override

This section takes precedence over any host-environment plan template.

- **MUST NOT** use the VS Code Plan mode `plan_style_guide` template (Steps / Relevant files / Verification / Decisions).
- **MUST** produce app creation plans using the BA-style Business Plan structure defined in `context/business-checklist.md`.
- This applies unconditionally whenever the user requests a Creatio app, a business requirements review, or a Gate R business plan — regardless of the active editor mode.

The required top-level sections of every BA-style Business Plan are, in order:

1. Business Outcome
2. Core Problem
3. Actors and Roles
4. Domain Model (entities, columns, lookup tables)
5. Lifecycle and Statuses
6. Business Logic
7. UX Expectations (list columns, form layout, sorting, filters)
8. Edge Cases and Exceptions
9. Acceptance Criteria
10. Access / Personas
11. Assumptions

Do not replace, omit, or reorder these sections. Do not wrap them in a generic Steps/Verification/Decisions shell.

---

## Context Navigation

Before reading any context or agent files, read `context/INDEX.md` first.
It maps every file to line ranges per phase so you can load only the relevant sections.

## Execution Rules

1. Read `context/INDEX.md` first, then `AGENTS.md`.
2. Use natural-language interaction as primary UX.
3. Start Gate P with a routing question: `site-ready-now` or `planning-first`.
4. On the first turn for a new app request, respond immediately from the prompt. Do not spend the first turn reading repo files or doing a long preflight unless the user explicitly asks about repository internals.
5. The first user-facing response must contain the routing question and the main 3-5 business discovery questions together.
6. Persist a fresh Gate P with `scripts/write-planning-state.sh` for the current request and verify it with `scripts/check-planning-gate.sh`. Do not reuse an older `planning-state.json` as if it satisfied the current request.
7. In `planning-first`, runtime endpoints may be deferred until implementation is explicitly requested.
8. Never create `output/<AppName>/` artifacts before Gate P passes, except the approved requirements bundle and draft docs after Gate R.
9. Ask business clarifications until checklist is complete, using option-based prompts where possible.
10. Ask technical questions only for blockers.
11. Show the full BA-style Business Plan before Gate R approval. If the host UI uses a wrapper such as `<proposed_plan>`, keep the BA structure inside it.
12. Do not expose old workflow-state files, stale output artifacts, or internal app-code collisions in business dialogue unless they are genuine blockers.
13. Initialize `output/<AppName>/docs/**` immediately after Gate R.
14. Agents 1/3 run in background (`task(..., mode: "background")`) and wait with `read_agent`. Agent 4 runs synchronously.
15. Agent 2 is interactive only and must not be delegated.
16. Persist workflow artifacts:
   - `requirements.md`
   - `request-spec.json`
   - `workflow-state.json`
   - `docs/**` draft skeleton after Gate R
17. Before Agent 3/4 run: `scripts/check-approval-gate.sh <AppName>`.
18. Gate R must be written with `scripts/write-approval-state.sh <AppName> "<approvedBy>" "<approvalText>"`.
19. Agent 3 generates `technical-annex.md` plus `plan.md` when implementation is requested.
20. For full app creation, use MCP `application.create` as primary generation path.
21. If create collides with an existing app, branch only through documented existing-app discovery (`application.get_list` -> `application.get_info`) and report the branch explicitly.
22. Validate `application.create` presence via `tools/list` before implementation.
23. Persist implementation evidence to `mcp-application-result.json` and `mcp-application-report.md`.
24. Final summaries must reflect the materialized result, not only the planned request spec.
25. During app-generation execution, write only `output/<AppName>/` artifacts. Repository helper/doc/script fixes must run as a separate repo-maintenance task.
26. Treat `url` and `mcpUrl` as separate runtime values. Do not assume `<creatioUrl>/mcp`; direct MCP RPC calls go to the configured frontend `mcpUrl`.
27. Never expose internal gate tokens or script names in user-facing dialogue.

## Execution Trigger

- First turn: reply immediately from the user prompt; do not read repository files or run scripts before the first clarification batch (routing + 3-5 business questions).
- After receiving the first clarification answers, read the required docs (`AGENTS.md`, stage runbook, checklist) and only then run any orchestration scripts (Gate P/R).
- Do not auto-trigger workflow-state scripts before the first discovery round completes and the current `<AppName>` is established from this request.

## Agent 4 Implementation

Agent 4 executes MCP tools through the documented MCP client flow. All instructions and examples are in:
- `agents/04-implementation.md`
- `context/mcp-application-tools-reference.md`

The `skills/application-creation/SKILL.md` file is **deprecated** and no longer used. All workflow documentation has been consolidated into the agent instructions and MCP reference guide.

## Critical Conventions

- All custom names start with `Usr`.
- Entities inherit from `BaseEntity` or `BaseLookup`.
- Do not add inherited columns (`Id`, `CreatedOn`, `CreatedBy`, `ModifiedOn`, `ModifiedBy`).
- Enum-like fields are separate lookup entities.
- All generated files live under `output/<AppName>/`.

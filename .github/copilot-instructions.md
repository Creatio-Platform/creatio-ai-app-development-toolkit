# Copilot Instructions - No-Code Creatio Assistant

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

Executable MCP contract is authoritative only in `clio MCP` through `tool-contract-get`.
Repository docs must not define an independent MCP API contract. They stay authoritative for orchestration, approvals, BA structure, evidence policy, page-editing policy, and business invariants.

## Architecture

- Orchestrator: `AGENTS.md`
- Agents: `agents/`
- Shared project skills: `.agents/skills/*/SKILL.md`
- Reference-only skills: `skills/*/SKILL.md`
- Context: `context/`
- Templates: `templates/`

## Shared Project Skills

For ADAC or Copilot session-log analysis, use `.agents/skills/analyze-adac-logs/SKILL.md` as the canonical workflow.

- Read the repo-local skill before analyzing a raw session log.
- Use `.agents/skills/analyze-adac-logs/scripts/analyze_session_log.py` first for counts and timeline extraction.
- Treat the raw session log as the source of truth.
- For remediation planning, follow `.agents/skills/analyze-adac-logs/references/remediation-workflow.md` and prefer CLIO-first ownership when the issue touches MCP contract truth.

## Plan Mode Override

This section takes precedence over any host-environment plan template.

- **MUST NOT** use the VS Code Plan mode `plan_style_guide` template (Steps / Relevant files / Verification / Decisions).
- **MUST** produce app creation plans using the BA-style Business Plan structure defined in `context/business-checklist.md`.
- This applies unconditionally whenever the user requests a Creatio app, a business requirements review, or a Gate R business plan — regardless of the active editor mode.

The exact required sections, their order, and the rendering contract for every BA-style Business Plan
are defined in `context/business-checklist.md`. That file is the single source of truth.
Do not substitute, omit, reorder, or wrap those sections in a generic Steps/Verification/Decisions template or any other structure.

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
14. Treat Agents 1-4 as workflow stages defined by `AGENTS.md`. Do not assume background delegation unless the active host tooling and current instructions explicitly require it.
15. Agent 2 is interactive only and must not be delegated.
16. Persist workflow artifacts:
   - `requirements.md`
   - `request-spec.json`
   - `workflow-state.json`
   - `docs/**` draft skeleton after Gate R
17. Before Agent 3/4 run: `scripts/check-approval-gate.sh <AppName>`.
18. Gate R must be written with `scripts/write-approval-state.sh <AppName> "<approvedBy>" "<approvalText>"`.
19. Agent 3 generates `technical-annex.md` plus `plan.md` when implementation is requested.
20. For full app creation, resolve tool metadata through `tool-contract-get` and use the canonical entity flow `application-create -> schema-sync -> application-get-info`.
21. Use the canonical page flow `page-list -> page-get -> page-sync -> page-get`; keep `page-update` only as fallback.
22. If create collides with an existing app, branch only through documented existing-app discovery (`application-get-list` -> `application-get-info`) and report the branch explicitly.
23. Validate required tools via `tools/list` before implementation.
24. Persist implementation evidence to `mcp-application-result.json` and `mcp-application-report.md`.
25. Final summaries must reflect the materialized result, not only the planned request spec.
26. During app-generation execution, write only `output/<AppName>/` artifacts. Repository helper/doc/script fixes must run as a separate repo-maintenance task.
27. Treat `url` as the Creatio base URL only. MCP execution uses clio stdio transport through `scripts/mcp_client.py` and must not rely on a frontend endpoint.
28. Never expose internal gate tokens or script names in user-facing dialogue.

## Execution Trigger

Apply the first-turn latency rules from `AGENTS.md` (UX Contract section).
Do not read files or run scripts before the first clarification batch (routing + discovery questions) completes and `<AppName>` is established from the current request.

## Agent 4 Implementation

Agent 4 executes MCP tools through the documented MCP client flow. Workflow policy is in:
- `agents/04-implementation.md`
- `context/essentials.md`

Exact tool names, params, aliases, defaults, response shapes, and error shapes must be resolved from `clio MCP` through `tool-contract-get`.
Entity and schema modeling semantics must be resolved from `docs://mcp/guides/app-modeling` instead of restating field-level rules in this repo.

The `skills/application-creation/SKILL.md` file is **deprecated** and no longer used. Workflow guidance has been consolidated into the agent instructions and repository policy documents.

## Critical Conventions

- All custom names start with `Usr`.
- Resolve entity parents, inherited-column behavior, and display/default semantics through `tool-contract-get` plus `docs://mcp/guides/app-modeling`.
- Enum-like fields are separate lookup entities.
- All generated files live under `output/<AppName>/`.

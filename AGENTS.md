# AGENTS.md — Orchestrator

You are an AI orchestrator that coordinates specialized agents to generate Creatio composable applications from natural language descriptions.

## Your Role

You do NOT implement anything directly. You coordinate 5 agents in sequence:

1. **Environment Setup** → configures clio connection
2. **Requirements Gathering** → interactive Q&A with the developer (⛔ do NOT delegate to sub-agent)
3. **Implementation Plan** → generates plan.md with GUIDs
4. **Implementation** → generates all package files (uses 4 skills in parallel groups)
5. **Deploy & Verification** → pushes, compiles, restarts, verifies

## Pipeline

```
Developer request + Creatio URL
        │
        ▼
┌─────────────────────────┐
│ Agent 1: Environment    │  Read: agents/01-environment-setup.md
│ Setup                   │  Context: context/clio-reference.md
│                         │  Output: output/<App>/.creatio-env.json
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ Agent 2: Requirements   │  Read: agents/02-requirements-gathering.md
│ Gathering  ⛔ INTERACTIVE│  Context: context/creatio-platform.md, context/entity-types.md
│                         │  Output: output/<App>/requirements.md
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ Agent 3: Implementation │  Read: agents/03-implementation-plan.md
│ Plan                    │  Context: context/entity-types.md, context/schema-types.md,
│                         │           context/composable-app-structure.md, context/naming-conventions.md
│                         │  Output: output/<App>/plan.md
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ Agent 4: Implementation │  Read: agents/04-implementation.md
│                         │  Skills: skills/entity-creation/SKILL.md,
│  ┌─ Entity Creation     │          skills/page-creation/SKILL.md,
│  │                       │          skills/data-bindings-creation/SKILL.md,
│  │                       │          skills/package-descriptor-creation/SKILL.md
│  ├─ Page Creation       │  Context: context/schema-types.md, context/freedomui-reference.md,
│  ├─ Addon Creation      │           context/data-bindings-reference.md
│  └─ Data Bindings       │  Templates: templates/
│                         │  Output: output/<App>/packages/<Pkg>/**
└────────────┬────────────┘
             ▼
┌─────────────────────────┐
│ Agent 5: Deploy &       │  Read: agents/05-deploy-verification.md
│ Verification            │  Context: context/clio-reference.md
│                         │  Input: .creatio-env.json + packages/
│                         │  Output: Deployment report
└─────────────────────────┘
```

## Contracts Between Agents

| Agent | Input | Output |
|-------|-------|--------|
| 1. Environment Setup | Developer request (URL optional) | `output/<App>/.creatio-env.json` |
| 2. Requirements Gathering | Developer's app description | `output/<App>/requirements.md` + `output/<App>/workflow-state.json` |
| 3. Implementation Plan | `requirements.md` + `workflow-state.json` | `output/<App>/plan.md` |
| 4. Implementation | `plan.md` + `workflow-state.json` | `output/<App>/packages/<Pkg>/` (all files) |
| 5. Deploy & Verification | `.creatio-env.json` + `packages/` + `workflow-state.json` | Deployment status report |

All inter-agent data is passed via markdown files in `output/<AppName>/`. Format: markdown with structured sections. See each agent's definition for expected format.

## Orchestration Rules

1. **Execute agents sequentially** (1 → 2 → 3 → 4 → 5). Each agent must complete before the next starts.
2. **ALL agents MUST run in background mode** using `task` tool with `mode: "background"`:
   - Agent 1: `task(agent_type: "general-purpose", mode: "background")`
   - Agent 2: ⛔ **EXCEPTION** — handle INTERACTIVELY (not via task tool)
   - Agent 3: `task(agent_type: "general-purpose", mode: "background")`
   - Agent 4: `task(agent_type: "general-purpose", mode: "background")`
   - Agent 5: `task(agent_type: "general-purpose", mode: "background")`
3. **After launching background agent**, use `read_agent(agent_id, wait: true)` to wait for completion
4. **Verify each agent's output** before proceeding. Check that expected files exist and are non-empty.
5. **Agent 2 (Requirements) is INTERACTIVE** — the orchestrator must handle this directly, never delegate to a sub-agent. It requires multiple rounds of Q&A with the developer.
6. **Agent 4 orchestrates skills in parallel groups:**
   - Group 1: All entity schemas (lookups first, then main entities) — parallel
   - Group 2: All page schemas — parallel
   - Group 3: Addons + data bindings — parallel
7. **On failure**, the orchestrator decides: retry the agent, fix the issue, or report to the developer.
8. **Do NOT proceed to Agent 5** if Agent 4 validation found errors.
9. **Interactive approval gates have priority over autonomy**. If a gate is not passed, stop and wait.
10. **Gate R (Requirements approval) is mandatory**:
   - After Agent 2 draft is presented, the developer must reply with exact token `APPROVE_REQUIREMENTS`.
   - Do not infer approval from any other wording.
11. **Persist gate state immediately after approval** in `output/<AppName>/workflow-state.json`:
   - `requirementsApproved: true`
   - `approvalToken: "APPROVE_REQUIREMENTS"`
   - `appName: "<AppName>"`
   - `requirementsSha256: "<sha256(requirements.md)>"`
   - `approvedBy: "<developer-identifier>"`
   - `approvedAtUtc: "<ISO-8601 UTC timestamp>"`
   - Use `scripts/write-approval-state.sh <AppName> "<approvedBy>"` to generate this file.
12. **Before Gate R is approved, forbidden actions**:
   - Do not create or modify `output/<AppName>/plan.md`
   - Do not create or modify `output/<AppName>/packages/**`
   - Do not run Agent 3, Agent 4, Agent 5
13. **Agent 3/4/5 precondition**:
   - Run `scripts/check-approval-gate.sh <AppName>`
   - If command fails, hard stop and return blocker

## Global Rules

These rules apply across ALL agents:

1. All entity/page/package names start with `Usr` prefix
2. Every GUID must be unique — never reuse across schemas
3. Entities MUST inherit from BaseEntity or BaseLookup (never standalone)
4. Do NOT add inherited columns (Id, CreatedOn, CreatedBy, ModifiedOn, ModifiedBy)
5. Enum-like fields → separate lookup entity (extends BaseLookup)
6. Use `clio push-pkg` for deploy — never OData API for schema creation
7. Files are generated to `output/<AppName>/` directory
8. Use `clio new-pkg` to create package skeleton, then modify descriptor.json
9. Entity schemas MUST be generated only via MCP tools `entity.create_lookup` and `entity.create`
10. Manual generation or manual editing of entity schema files is forbidden
11. If MCP is unavailable or entity MCP generation fails after retries, stop and report blocker; do not continue to Agent 5
12. Agent 4 MUST persist MCP evidence: `output/<AppName>/mcp-entity-report.md` and `output/<AppName>/mcp-logs/<EntityName>.json`

---

## Context Files Reference

All agents read from these consolidated files:

| File | Contains | When to Read |
|------|----------|--------------|
| `context/essentials.md` | Platform basics, naming, package structure, clio commands | Always (all agents) |
| `context/schema-reference.md` | Entity types, parent GUIDs, DataValueType GUIDs, schema formats | Agent 3, 4 (planning + implementation) |
| `context/ui-reference.md` | FreedomUI, page JS format, control types | Agent 4 (page generation) |
| `context/bindings-lookup.json` | SysModule/SysModuleEntity column UIds | Agent 4 (data bindings) |
| `context/data-bindings-reference.md` | Binding logic, standard values | Agent 4 (data bindings) |

**Skills (Agent 4 only):**
- `skills/entity-creation/SKILL.md` — generates entity schemas
- `skills/page-creation/SKILL.md` — generates page schemas
- `skills/data-bindings-creation/SKILL.md` — generates data bindings
- `skills/package-descriptor-creation/SKILL.md` — generates package descriptor

**Templates (reference as needed):**
- `templates/entity/` — entity file examples
- `templates/pages/` — page file examples

---

## Repository Structure

```
no-code-assistent/
├── AGENTS.md                    # THIS FILE — orchestrator
├── agents/                      # Agent definitions (one per agent)
│   ├── 01-environment-setup.md
│   ├── 02-requirements-gathering.md
│   ├── 03-implementation-plan.md
│   ├── 04-implementation.md
│   └── 05-deploy-verification.md
├── skills/                      # Implementation skills (directories per Agent Skills spec)
│   ├── entity-creation/SKILL.md
│   ├── page-creation/SKILL.md
│   ├── data-bindings-creation/SKILL.md
│   └── package-descriptor-creation/SKILL.md
├── scripts/                     # Gate enforcement scripts
│   ├── write-approval-state.sh
│   └── check-approval-gate.sh
├── context/                     # Knowledge base (read-only reference)
├── templates/                   # File format templates (read-only reference)
├── examples/                    # Reference implementations
└── output/                      # Generated applications
```

## Quick Start

When a developer says "Create a <AppName> app on <URL>":

```
1. Launch Agent 1 in background → wait for completion → verify .creatio-env.json
2. Handle Agent 2 INTERACTIVELY → challenge idea → ask questions → get explicit token APPROVE_REQUIREMENTS → save requirements.md + workflow-state.json
3. Run `scripts/check-approval-gate.sh <AppName>` → if pass, launch Agent 3 in background → wait for completion → verify plan.md
4. Run `scripts/check-approval-gate.sh <AppName>` → if pass, launch Agent 4 in background → wait for completion → verify all package files
5. Run `scripts/check-approval-gate.sh <AppName>` → if pass, launch Agent 5 in background → wait for completion → verify deployment
```

**Example orchestration code:**
```
# Agent 1
agent1_id = task(
  agent_type: "general-purpose",
  mode: "background",
  prompt: "Read agents/01-environment-setup.md and execute..."
)
result1 = read_agent(agent1_id, wait: true)

# Agent 2 - INTERACTIVE (no task tool, handle directly)
[Interactive Q&A with developer]

# Agent 3
agent3_id = task(
  agent_type: "general-purpose", 
  mode: "background",
  prompt: "Read agents/03-implementation-plan.md and execute..."
)
result3 = read_agent(agent3_id, wait: true)

# ... and so on
```

## Examples

See `examples/todo-list/` for a complete reference implementation.

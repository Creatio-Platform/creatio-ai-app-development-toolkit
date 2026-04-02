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

Executable MCP contract is authoritative only in `clio MCP` through `tool-contract-get`.
This repository is authoritative for orchestration, approvals, BA structure, evidence policy, page-editing policy, and business invariants.

## Developer UX

Primary workflow is natural language:

1. Developer sends one free-form prompt.
2. Agent returns a short "What I understood".
3. On the first turn, the agent responds directly from the prompt instead of doing a long repo preflight.
4. Agent asks a routing question first: `site-ready-now` or `planning-first`.
5. Agent runs a compact BA-style discovery with 3-7 critical questions focused on business goal, core problem, users/roles, MVP scope, and success criteria.
6. The routing question and the main discovery questions appear in that same first user-facing response.
7. Agent persists a fresh Gate P for the current request after natural-language confirmation; `planning-first` may defer runtime endpoints until implementation.
8. Agent asks minimal technical questions only for blockers.
9. After Gate R, the agent initializes `output/<AppName>/docs/**` as a draft skeleton before implementation starts.
10. Agent runs the remaining pipeline and returns final artifacts/results.
11. Internal gate tokens, old workflow-state details, and scripts stay hidden from developer-facing dialogue unless they are real blockers.

Each business checklist group must persist `source=confirmed|assumed`. When a group is `assumed`, the exact assumption text must also be recorded and carried into the final approval context.

## Support Mode (Troubleshooting)

Support mode is a user-friendly troubleshooting mode that maximizes visible session traceability.

### Start and Stop

Use natural language (case-insensitive):

- `support mode on`
- `turn on support mode`
- `support mode off`

Support mode is run-scoped and non-persistent by default (`support_mode_active: true|false`).

### Guarantees While Active

- No subagents, no background tasks, no delegated execution.
- Work is executed in the main thread/session only.
- If a task is only possible through delegation/background execution, the agent proceeds and records a support-mode exception that explains why background execution was required.
- Existing delegation behavior remains unchanged when support mode is off.

### Expected Support Output

For each substantial step:

- `Action`: what the agent is doing
- `Result`: success/fail and key output
- `If failed`: error and the next recovery attempt

Final response includes:

- ordered execution summary
- unresolved blockers
- collected evidence summary
- support-mode exceptions summary for unavoidable background/delegated steps
- completion handoff prompt asking the user to share the session with support

Reasoning visibility in support mode:

- Include concise decision evidence (`Instruction check`, `Decision rationale`, `Constraint conflicts`, `Skipped options`, `Self-check`).
- Internal private chain-of-thought is non-contractual and not required to be exposed.

### Copy-Paste Examples

```text
Add print button on the page. Support mode on.
```

```text
Hide obsolete field from the form page. Support mode on.
```

```text
Analyze why the page-sync step did not update the list page. Support mode on.
```

```text
Support mode off. Continue with normal execution.
```

```text
Support mode is on. Please share this session with support for analysis.
```

```text
Support mode is on. Please share this session with support for analysis using /share.
```

### Verification Checklist

1. Activation/deactivation is acknowledged when user says `support mode on` or `support mode off`.
2. While active, delegated/background execution is avoided by default; unavoidable cases are explicitly logged as support-mode exceptions with reason.
3. While active, each major step reports action/result and failure recovery when needed.
4. While active, final response includes execution summary, blockers, evidence, support-mode exceptions (if any), and completion handoff prompt.
5. Support mode ON + success: completion handoff prompt is present.
6. Support mode ON + failure: completion handoff prompt is present.
7. Support mode OFF: completion handoff prompt is absent.
8. With support mode off, existing delegation behavior is unchanged.

## Workflow

Orchestrator flow:

1. Planning start with natural-language confirmation and persisted Gate P in `.workflow-state/<AppName>/planning-state.json`.
2. If the route is `site-ready-now`, environment setup creates `output/<AppName>/.creatio-env.json`; if the route is `planning-first`, this step waits until implementation is requested.
3. Requirements gathering produces a BA-style `requirements.md`, writes `request-spec.json`, persists approved `workflow-state.json`, and initializes draft docs under `output/<AppName>/docs/**`.
   The approval artifact is the BA-style requirements draft itself, even if the host UI wraps it in a container such as `<proposed_plan>`.
4. Implementation plan generates `output/<AppName>/technical-annex.md` and `output/<AppName>/plan.md` when implementation is explicitly requested.
5. Implementation runs synchronously, resolves executable contract metadata through `tool-contract-get`, initializes canonical context in `mcp-application-result.json`, applies the canonical entity flow `application-create -> schema-sync -> application-get-info`, and applies the canonical page flow `page-list -> page-get -> page-sync -> page-get`.
6. Existing-app branching stays explicit through `application-get-list -> application-get-info`. Individual entity/page tools remain fallback-only compatibility paths.

All generated artifacts are under `output/<AppName>/`.

## Runtime Scripts

- Canonical helper logic lives in `python3 scripts/workflow_cli.py`.
- Unix/macOS wrappers stay supported:
  - `bash scripts/write-planning-state.sh <AppName> "<approvedBy>" "<routingMode>" "<creatioUrlOrDeferred>" "<understandingText>" "<confirmationText>"`
  - `bash scripts/check-planning-gate.sh <AppName>`
  - `bash scripts/validate-request-spec.sh output/<AppName>/request-spec.json`
  - `bash scripts/write-approval-state.sh <AppName> "<approvedBy>" "<approvalText>"`
  - `bash scripts/check-approval-gate.sh <AppName>`
- PowerShell peers are available on Windows:
  - `.\scripts\write-planning-state.ps1 <AppName> <approvedBy> <routingMode> <creatioUrlOrDeferred> <understandingText> <confirmationText>`
  - `.\scripts\check-planning-gate.ps1 <AppName>`
  - `.\scripts\validate-request-spec.ps1 output/<AppName>/request-spec.json`
  - `.\scripts\write-approval-state.ps1 <AppName> <approvedBy> <approvalText>`
  - `.\scripts\check-approval-gate.ps1 <AppName>`
- `python3 scripts/mcp_context_adapter.py normalize output/<AppName>/mcp-application-result.json`
- `python3 scripts/mcp_result_evidence.py report output/<AppName>/mcp-application-result.json output/<AppName>/mcp-application-report.md`
- `python3 scripts/page_body_tools.py build-update-args <SchemaName> <body-file> --dry-run`
- `python3 scripts/mcp_schema_sync.py plan --current-result output/<AppName>/mcp-application-result.json --edited-context output/<AppName>/editable-context.json`
- `python3 scripts/mcp_schema_sync.py apply --result output/<AppName>/mcp-application-result.json --edited-context output/<AppName>/editable-context.json --env output/<AppName>/.creatio-env.json`
- `python3 scripts/mcp_page_sync.py build-plan --plan-md output/<AppName>/plan.md --output output/<AppName>/page-sync-plan.json`
- `python3 scripts/mcp_page_sync.py apply --result output/<AppName>/mcp-application-result.json --plan output/<AppName>/page-sync-plan.json --env output/<AppName>/.creatio-env.json --report output/<AppName>/mcp-application-report.md`

For JSON-heavy MCP payloads, prefer `args.json` plus `--args-file` over inline shell quoting.

### Bash

```bash
python3 scripts/mcp_client.py application-get-list --args-file ./args.json --timeout 30
```

### PowerShell

```powershell
$env:PYTHON_CMD = & { . .\scripts\find_python.ps1; $env:PYTHON_CMD }
& $env:PYTHON_CMD .\scripts\mcp_client.py application-get-list --args-file .\args.json --timeout 30
```

`mcp-application-result.json` stores the compact short MCP response in flat runtime form (`package-u-id`, `package-name`, `entities`, optional `canonical-main-entity-name`) plus `editableContext`, `operationLog`, `pageEvidence`, and any persisted acceptance evidence. Reports must be derived from that runtime evidence rather than handwritten summaries, and page/report statuses must distinguish `implemented`, `machineChecked`, and `manualCheckPending`.

When page sync is required, `plan.md` must contain an embedded machine-readable `page-sync-plan.json` block between `<!-- PAGE_SYNC_PLAN_JSON_START -->` and `<!-- PAGE_SYNC_PLAN_JSON_END -->`. The same payload can be materialized to `output/<AppName>/page-sync-plan.json` with `scripts/mcp_page_sync.py build-plan`, and `scripts/mcp_page_sync.py apply` can consume either the JSON file or the markdown plan directly. `page-sync` is the preferred write path, while `mcp_page_sync.py` keeps a mandatory verification fallback through `page-get` when the server response does not include a reusable verified body.

## Architecture

```text
Orchestrator (AGENTS.md)
|-- Agent 1: Environment Setup           -> .creatio-env.json
|-- Agent 2: Requirements (interactive)  -> requirements.md + request-spec.json + workflow-state.json
|-- Agent 3: Implementation Plan         -> technical-annex.md + plan.md
|-- Agent 4: Implementation              -> mcp-application-result.json + report
|   `-- clio stdio MCP via scripts/mcp_client.py and sync helpers
```

## Repository Structure

```text
AGENTS.md
.github/copilot-instructions.md
agents/
  01-environment-setup.md
  02-requirements-gathering.md
  03-implementation-plan.md
  04-implementation.md
scripts/
  workflow_cli.py
  check-planning-gate.sh
  check-planning-gate.ps1
  check-approval-gate.sh
  check-approval-gate.ps1
  validate-request-spec.sh
  validate-request-spec.ps1
  write-planning-state.sh
  write-planning-state.ps1
  write-approval-state.sh
  write-approval-state.ps1
  workflow_gate.sh
  workflow_gate.ps1
  mcp_context_adapter.py
  mcp_schema_sync.py
  mcp_page_sync.py
.workflow-state/
context/
  business-checklist.md
  essentials.md
  schema-reference.md
  ui-reference.md
  data-bindings-reference.md
  bindings-lookup.json
templates/
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

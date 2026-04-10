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

- No subagents, no background tasks, no delegated execution by default.
- Work is executed in the main thread/session first so evidence stays in the shared trace.
- If no main-thread equivalent exists for a required step, allow one unavoidable support-mode exception record and proceed with the minimal non-main-thread action.
- Existing delegation behavior remains unchanged when support mode is off.

Recovery budget while active:

- Support mode is for diagnosis, not workaround completion.
- A stage-critical failure is any failure in the current active stage that blocks trustworthy continuation or trustworthy evidence for the current run.
- The first stage-critical failure must produce a canonical failure record immediately.
- At most one confirmation probe is allowed, and only with the same tool + same contract path.
- Severity routing:
  - `clio_mcp_issue` is the primary critical target category. Keep strict diagnostic handling: canonical incident record, one same-path confirmation probe, then fail-fast when blocking.
  - `instruction_issue`, `environment_issue`, and `orchestration_tool_failure` are non-critical by default. Use bounded retry/workaround-first handling and fail-fast only when unresolvable.
  - `orchestration_tool_failure` may run one canonicalization pass before fail-fast, limited to call-shape normalization (argument format, wrapper invocation shape, serialization wrapper shape) on the same tool path.
  - Canonicalization does not allow branch switching or business-logic changes.
  - Transient site reachability errors under `environment_issue` should use a bounded reconnect budget before fail-fast classification: retry the same registration/healthcheck path up to 3 additional attempts with 15-second delays.
  - Escalation rule: any non-critical category becomes fail-fast only when it prevents trustworthy CLIO MCP tool invocation or contract verification, or leaves evidence unreliable.
- For `clio_mcp_issue` critical failures, do not switch to alternate workaround branches or fallback strategy changes after the first failed attempt.
- For non-critical categories, bounded recovery is allowed on the same target path within the configured retry budget.
- After escalation conditions are met, emit fail-fast evidence and stop the blocked stage.

### Expected Support Output

Support mode logs only actionable failures:

- `orchestration_tool_failure`
- `instruction_issue`
- `clio_mcp_issue`
- `environment_issue` (auth/network/runtime/preflight)
- Category scope: use `orchestration_tool_failure` for caller/orchestration-side failures; use `clio_mcp_issue` for CLIO MCP/backend contract or transport failures.
- Reporting stays session-only by default (conversation summary), without persisted support metrics artifacts.

Category decision matrix:

- `clio_mcp_issue`: CLIO MCP contract, transport, backend tool request/response faults.
- `instruction_issue`: guidance or expected-pattern defects, including incorrect generated/edit strategies.
- `orchestration_tool_failure`: caller or wrapper invocation faults such as args shape, adapter, or normalizer issues.
- `environment_issue`: auth, network, runtime reachability, or preflight failures.
- Page-sync validation rule:
  - classify as `instruction_issue` when failure is caused by generated/edit strategy or known binding rules;
  - classify as `clio_mcp_issue` only when tool/backend behavior violates advertised contract semantics.

Canonical failure record:

- One canonical failure record is required for each unique incident.
- `category`
- `what_failed`
- `evidence` (tool/error snippet/session reference)
- `expected_behavior`
- `fix_target` (`instructions|clio_mcp|tooling|environment`)
- `next_recovery_attempt`
- `error_signature`
- `repeat_count`
- `timestamps` (optional when `repeat_count > 1`)

Deduplication rule:

- Keep one canonical record per unique failure signature.
- Treat incidents as identical when `error_signature` and tool/context match.
- For repeats, update `repeat_count` (and optional `timestamps`) instead of repeating raw dumps.

Final response must include (in this exact order):

- `Confirmed failures`
- `Unresolved blockers`
- `Next recovery attempts`
- `Support-mode exceptions`
- `Non-target friction` (resolved or temporary `orchestration_tool_failure` / `instruction_issue` items)

Zero-state rule:

- When a required section has no items, include the section and set its value to `None` instead of omitting it.

CLIO-focused reporting rules:

- Keep `Confirmed failures` focused on unresolved blockers and target defects.
- Do not list resolved or temporary instruction/tooling friction under `Confirmed failures`; put it under `Non-target friction` when needed.
- In CLIO-focused support runs, attempt at least one real MCP tool invocation before concluding unless an environment failure remains unresolvable after the bounded retry budget.
- Present categories in this priority order: `clio_mcp_issue`, `environment_issue`, `orchestration_tool_failure`, `instruction_issue`.

Noise control:

- Prefer phase checkpoints only: `env`, `gates`, `schema`, `pages`, `final`.
- Emit interim status only when timeout thresholds are crossed or recovery path changes.

Fail-fast decision evidence:

- Before blocker summary, include:
  - `exit_decision=fail_fast`
  - `blocked_stage=<current_active_stage_label>`
  - `why_continue_is_unsafe=<reason>`

Support-mode exception record (when unavoidable):

- `attempted_action`
- `no_main_thread_equivalent_reason`
- `main_thread_evidence_captured`
- When an unavoidable non-main-thread action completes, its result must be surfaced in the main-thread support output before proceeding or stopping.

CLIO mismatch rule:

- Contract/transport mismatches are `category=clio_mcp_issue` and include normalized `error_signature` (example: `html_instead_of_json_response`).

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

### Verification Checklist

1. Activation/deactivation is acknowledged when user says `support mode on` or `support mode off`.
2. While active, delegated/background execution is forbidden by default; unavoidable cases produce one explicit support-mode exception record.
3. Failure logs use canonical categories and canonical failure-record fields.
4. Repeated failures are deduplicated with `repeat_count` (+ optional `timestamps`).
5. Heartbeat chatter is suppressed; phase-checkpoint reporting is used.
6. In support mode, first stage-critical failure records an incident; only one same-path confirmation probe is allowed.
7. No fallback branch switching or workaround path changes are allowed for critical `clio_mcp_issue` failures; non-critical categories use bounded recovery first.
8. Fail-fast exits include `exit_decision=fail_fast`, `blocked_stage`, and `why_continue_is_unsafe`.
9. For CLIO-focused support runs, at least one real MCP tool invocation is attempted unless an environment failure remains unresolvable after the bounded retry budget.
10. Final response includes `Confirmed failures`, `Unresolved blockers`, `Next recovery attempts`, `Support-mode exceptions`, and `Non-target friction` (use `None` when empty).
11. Support mode ON + success: completion handoff prompt is present.
12. Support mode ON + failure: completion handoff prompt is present.
13. Support mode OFF: completion handoff prompt is absent.
14. With support mode off, existing delegation behavior is unchanged.
15. Missing any required final support section is a support-mode reporting failure.

## Workflow

Orchestrator flow:

1. Planning start with natural-language confirmation and persisted Gate P in `.workflow-state/<AppName>/planning-state.json`.
2. If the route is `site-ready-now`, environment setup creates `output/<AppName>/.creatio-env.json`; if the route is `planning-first`, this step waits until implementation is requested.
3. Requirements gathering produces a BA-style `requirements.md`, writes `request-spec.json`, persists approved `workflow-state.json`, and initializes draft docs under `output/<AppName>/docs/**`.
   The approval artifact is the BA-style requirements draft itself, even if the host UI wraps it in a container such as `<proposed_plan>`.
4. Implementation plan generates `output/<AppName>/technical-annex.md` and `output/<AppName>/plan.md` when implementation is explicitly requested.
5. Implementation runs synchronously, resolves executable contract metadata through `tool-contract-get`, initializes canonical context in `mcp-application-result.json`, and executes the current `clio`-owned entity and page flows referenced by `docs://mcp/guides/app-modeling` and `docs://mcp/guides/existing-app-maintenance`.
6. Existing-app branching remains explicit in the workflow, but the canonical discover/inspect/mutate path and fallback tool guidance are owned by `clio` rather than this repository.

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

`mcp-application-result.json` stores the normalized runtime context used by this repository, plus `editableContext`, `operationLog`, `pageEvidence`, and any persisted acceptance evidence. Reports must be derived from that runtime evidence rather than handwritten summaries, and page/report statuses must distinguish `implemented`, `machineChecked`, and `manualCheckPending`.

When page sync is required, `plan.md` must contain an embedded machine-readable `page-sync-plan.json` block between `<!-- PAGE_SYNC_PLAN_JSON_START -->` and `<!-- PAGE_SYNC_PLAN_JSON_END -->`. The same payload can be materialized to `output/<AppName>/page-sync-plan.json` with `scripts/mcp_page_sync.py build-plan`, and `scripts/mcp_page_sync.py apply` can consume either the JSON file or the markdown plan directly. `scripts/mcp_page_sync.py` is a thin adapter: it reads the embedded plan, calls `page-sync`, and persists repo-local evidence. Resolve page-write and verification semantics through the current `clio` guidance resources; this repository no longer owns a custom page executor or fallback save flow.

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

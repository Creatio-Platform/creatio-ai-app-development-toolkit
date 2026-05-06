# Business Plan Generator for Creatio

AI-driven toolkit for generating BA-style Business Plans for Creatio apps from natural-language requests.
The Business Plan and Technical Implementation Handoff are the final deliverables.
A separate implementing code agent uses the Business Plan output to build the app via clio MCP tools.

First-class supported agents: Codex CLI/Desktop, Claude Code, Cursor.
Compatible/manual targets: GitHub Copilot CLI, VS Code Copilot, and other MCP-capable coding agents.

## Source of Truth

Use these files as canonical:

- `AGENTS.md`
- `context/business-checklist.md`
- `context/essentials.md`
- `context/naming-conventions.md`
- `context/clio-cli-reference.md`
- `context/model-discovery-evidence.md`

Executable MCP contract is authoritative only in `clio MCP` through `get-tool-contract`.
This repository is authoritative for orchestration, approvals, BA structure, and business invariants.

## Developer UX

Primary workflow is natural language:

1. Developer sends one free-form prompt.
2. Agent returns a short "What I understood".
3. Agent runs compact BA-style discovery with 3-7 critical questions focused on business goal, core problem, users/roles, MVP scope, and success criteria.
4. The main discovery questions appear in that same first user-facing response.
5. Agent asks minimal technical questions only for blockers.
6. Agent produces the BA-style Business Plan (7 sections) and Technical Implementation Handoff.
7. Developer approves the Business Plan. After approval, agent collects runtime inputs and implements the plan with clio MCP tools.
8. Internal gate names and scripts stay hidden from developer-facing dialogue unless they are real blockers.

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
  - `clio_mcp_issue` is the primary critical-by-default target defect category. Keep strict diagnostic handling: canonical incident record, one same-path confirmation probe, then fail-fast when blocking.
  - `instruction_issue`, `environment_issue`, and `orchestration_tool_failure` are non-critical by default. Use bounded retry/workaround-first handling and fail-fast only when unresolvable.
  - `orchestration_tool_failure` may run one canonicalization pass before fail-fast, limited to call-shape normalization (argument format, wrapper invocation shape, serialization wrapper shape) on the same tool path.
  - Canonicalization is not a workaround branch switch and must not change business logic, target tool, or execution stage.
  - Transient site reachability errors under `environment_issue` should use a bounded reconnect budget before fail-fast classification: retry the same registration/healthcheck path up to 3 additional attempts with 15-second delays.
  - Escalation rule: any non-critical category becomes fail-fast only when it prevents trustworthy CLIO MCP tool invocation or contract verification, or leaves evidence unreliable for the current run.
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

- Prefer phase checkpoints only: `env`, `gates`, `schema`, `final`.
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
Create a Business Plan for a customer feedback tracking app. Support mode on.
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

1. Planning start: understanding summary, assumptions/risks, and natural-language confirmation. Gate P is satisfied when the developer confirms in conversation.
2. Agent 2 produces a BA-style Business Plan (7 sections) and Technical Implementation Handoff inline in the conversation. Gate R is satisfied when the developer explicitly approves the plan.
3. After Gate R approval, collect required runtime inputs, run Agent 1 to resolve the environment name and DataForge availability, then implement the plan with clio MCP tools.
4. Session complete. The implemented app is the final deliverable.

## Runtime Scripts

Validation logic lives in `runtime/scripts/workflow_validators.py` and is called inline from Python with content passed as a string/dict (no file I/O):

```bash
python3 -c "
import sys
from pathlib import Path
sys.path.insert(0, str(Path.cwd()))
from runtime.scripts.workflow_validators import validate_requirements_doc
validate_requirements_doc(sys.stdin.read())
" << 'EOF'
<requirements.md content>
EOF
```

Available validators: `validate_requirements_doc(content: str)`. Raises `WorkflowError` on failure.

For MCP transport, the agent uses `runtime/scripts/mcp_client.py` for stdio MCP calls. JSON-heavy payloads should be passed via `--args-file` to avoid inline shell quoting.

### Bash

```bash
python3 runtime/scripts/mcp_client.py dataforge-status --args-file ./args.json --timeout 30
```

### PowerShell

```powershell
$env:PYTHON_CMD = & { . .\runtime\scripts\find_python.ps1; $env:PYTHON_CMD }
& $env:PYTHON_CMD .\runtime\scripts\mcp_client.py dataforge-status --args-file .\args.json --timeout 30
```

## Architecture

The entire workflow runs in a single AI session. State lives in conversation context — there is no file-based IPC between agents.

```text
Orchestrator (AGENTS.md)
|-- Agent 1: Environment Setup           -> env name + DataForge status reported in conversation
|-- Agent 2: Requirements (interactive)  -> BA-style Business Plan (7 sections) + Technical Implementation Handoff inline
|   `-- clio stdio MCP via runtime/scripts/mcp_client.py (DataForge status check only)
```

## Repository Structure

```text
AGENTS.md
runbooks/
  01-environment-setup.md
  02-requirements-gathering.md
runtime/scripts/
  workflow_validators.py     # pure validation functions (no file I/O)
  mcp_client.py              # stdio MCP client
  find_python.{sh,ps1}       # python resolver
context/
  business-checklist.md
  essentials.md
  naming-conventions.md
  clio-cli-reference.md
  model-discovery-evidence.md
```

## Prerequisites

- AI code agent
- [clio](https://github.com/Advance-Technologies-Foundation/clio): `dotnet tool install clio -g`
- Access to a running Creatio instance (required after Business Plan approval)

## Install

After the hosted ADAC installer URL is published:

```bash
curl -fsSL <hosted-adac-install-url>/install.py | python3
```

Until then, from a local checkout:

```bash
python installer/install.py
```

When launched from `installer/install.py` inside a plugin checkout, the installer uses that checkout as the install source.

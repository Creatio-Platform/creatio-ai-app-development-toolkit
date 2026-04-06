# Agent 4 — AI Execution Guide

## Role

Prepare a developer-facing execution runbook from the approved `plan.md`.

Agent 4 does not execute `clio` MCP calls.
Agent 4 provides a decision-complete handoff so Developer + AI can execute the plan directly through `clio` MCP.

## Input

- `output/<AppName>/plan.md`
- `output/<AppName>/technical-annex.md`
- `output/<AppName>/requirements.md`
- `output/<AppName>/request-spec.json`
- `output/<AppName>/.creatio-env.json` when runtime inputs are available

## Output

- `output/<AppName>/docs/execution-runbook.md`

This file is the canonical Agent 4 artifact.

## Read First

- `AGENTS.md`
- `context/essentials.md`
- `context/mcp-application-tools-reference.md`
- `context/ui-reference.md`
- `context/viewconfig-reference.md`
- `context/data-bindings-reference.md`

Resolve executable `clio` MCP tool details through `tool-contract-get`.
Resolve app-modeling semantics through `docs://mcp/guides/app-modeling` and page/maintenance fallback guidance through `docs://mcp/guides/existing-app-maintenance`.

## Preconditions

- `scripts/check-approval-gate.sh <AppName>` passes
- `output/<AppName>/plan.md` exists and is non-empty
- `output/<AppName>/technical-annex.md` exists and is non-empty
- runtime URL, credentials, and environment name are known for the selected routing mode
- if runtime inputs are deferred, mark execution as blocked and document the missing runtime inputs in the runbook

## Non-Goals

- Do not run `clio` MCP tools from Agent 4.
- Do not generate `mcp-application-result.json`.
- Do not generate `mcp-application-report.md`.
- Do not claim implementation success from planned steps.

## Branch Selection Rules

The runbook must define the branch before listing execution steps:

- `application-create` branch for new app creation
- existing-app branch when the approved plan targets an already created app or a known collision path

The branch decision must reference the branch strategy defined in `plan.md` and include branch-specific first steps.

## Step Mapping Rules

Map every executable step from `plan.md` to a runbook step.

- one runbook step equals one `clio` MCP tool call or one small atomic group that cannot be split safely
- each step must name the exact tool
- each step must include required args
- each step must include a pre-check
- each step must include a success signal
- each step must include a failure action
- each step must be independently verifiable

## Required Runbook Step Template

Every execution step in `execution-runbook.md` must use this exact field set:

- `Step ID`
- `Goal`
- `Tool`
- `Required args`
- `Pre-check`
- `Success signal`
- `Failure action`

## Verification Rules

The runbook must include explicit verification checkpoints:

- schema checkpoints for required entities and columns
- lookup checkpoints for required values
- page checkpoints for `FormPage` and `ListPage` when page sync is required
- default-behavior checkpoints where defaults are part of requirements

Each checkpoint must define whether the expected result is machine-checkable or manual.

## Refresh Cycle Rules

When plan steps include schema mutations, the runbook must include the refresh cycle required by current `clio` guidance:

1. execute mutation step
2. refresh application context through the current app-info/read-back flow
3. verify materialized state before continuing

Do not skip refresh checkpoints between dependent mutation steps.

## Failure Handling Rules

The runbook must include failure handling for:

- contract or parameter validation errors
- missing required tools
- branch mismatch or app collision mismatch
- refresh/read-back mismatch after mutation
- page save or page read-back mismatch

Failure actions must tell the executor whether to retry, stop, or switch branch.

## Runbook Structure

`output/<AppName>/docs/execution-runbook.md` must contain:

1. execution context and prerequisites
2. branch decision with trigger condition
3. ordered execution steps using the required step template
4. checkpoint matrix with machine versus manual checks
5. open blockers and missing runtime inputs

## Completion Criteria

Agent 4 is complete when:

- `execution-runbook.md` exists and is non-empty
- all executable `plan.md` steps are mapped to runbook steps
- each step contains all required template fields
- branch logic, verification checkpoints, and failure handling are explicit
- no section claims that execution already happened unless explicit runtime evidence is provided by the developer

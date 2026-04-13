# Local MCP Workflow Wrapper

This file documents how this repository invokes `clio` MCP and how it persists runtime results locally.

It is not the executable MCP specification.

## Source Of Truth

Use this repo for:
- local transport helpers such as `scripts/mcp_client.py`
- local normalization into `output/<AppName>/mcp-application-result.json`
- local follow-up helpers and evidence generation

Use `clio` MCP discovery plus MCP prompts/resources for:
- tool parameters and response payloads
- transport and safety metadata exposed by the MCP server
- canonical main-entity rules
- lookup display-field rules
- default semantics
- current `sync-schemas` and `sync-pages` behavior

For app-modeling guidance, use `docs://mcp/guides/app-modeling`.

## Local Transport

Invoke `clio` MCP through `scripts/mcp_client.py`.
Use clio stdio transport instead of ad-hoc shell pipes or HTTP wrappers.

```python
from scripts.mcp_client import call_mcp_tool

result = call_mcp_tool('list-apps', {'environment-name': 'local'})
if not result['success']:
    raise RuntimeError(result['raw'])
```

Local transport rules:
- prefer `--args-file` or `--args-stdin` for JSON-heavy payloads
- do not call `clio mcp-server` directly from ad-hoc shell pipes
- do not use `curl`; this flow is stdio, not HTTP
- Do not use curl as an MCP execution pattern.
- respect `CLIO_CMD` when the environment config points to a custom `clio`

### PowerShell

```powershell
$env:PYTHON_CMD = & { . .\scripts\find_python.ps1; $env:PYTHON_CMD }
& $env:PYTHON_CMD .\scripts\mcp_client.py list-apps --args-file .\args.json --timeout 30
```

## Canonical Runtime Result

The primary application context used by this repo starts from the flat MCP response returned by `create-app` or `get-app-info`.

Use `get-tool-contract` plus `clio` prompts/resources for the current executable response shape and field names.
This repo only normalizes the current response envelope into local helper state and evidence files.
Do not treat legacy `app/packages` examples as the MCP response contract.
For the standard new-app branch, treat `create-app` as already DataForge-assisted. Standalone `dataforge-*` tools are for explicit inspection or remediation flows only.
For planning, this policy is narrower: standalone `dataforge-*` tools are not a mandatory preflight, but read-only discovery becomes required when the model is ambiguous or strong existing-schema candidates exist. That discovery must end in explicit `Model Decisions` recorded in the plan.

## Normalize Into `mcp-application-result.json`

After writing the raw MCP result to `output/<AppName>/mcp-application-result.json`, normalize it:

```bash
python3 scripts/mcp_context_adapter.py normalize output/<AppName>/mcp-application-result.json
```

Normalization keeps the flat runtime contract and adds repo-local helper state:
- `schemaSync`
- `operationLog`
- `pageEvidence`
- `acceptanceEvidence`
- `editableContext`

`editableContext` is a local derived projection for helper scripts. It is not the MCP response contract.
Normalization is strict: persisted result documents must already match the canonical helper-state shape and must not carry legacy fields such as `contractType`.

## Local Refresh Pattern

This repository keeps a local refresh and persistence loop around the current `clio`-owned MCP flow:
1. Initialize the runtime result through the current app create or app discovery step resolved from `get-tool-contract`
2. Normalize and persist the result file
3. Run approved helper orchestration
4. Re-read and normalize the runtime result again when the chosen `clio` workflow requires refresh
5. Run page sync and evidence helpers when required

## Local Follow-up Helpers

Use these helpers after MCP calls:
- `scripts/mcp_context_adapter.py normalize` to normalize the runtime result
- `scripts/mcp_result_evidence.py report` to generate `mcp-application-report.md`
- `scripts/mcp_schema_sync.py plan` and `apply` for repo-local schema sync orchestration
- `scripts/mcp_page_sync.py build-plan` and `apply` for repo-local page plan materialization and evidence persistence around `sync-pages`

Local helper rules:
- follow the current `clio` MCP guidance for preferred entity/page write paths and read-back verification
- preserve top-level `dataforge` diagnostics from `create-app` and treat degraded Data Forge coverage as advisory unless the run explicitly entered a remediation branch
- when planning-time discovery surfaces candidates, convert them into explicit `reuse` / `extend` / `create` decisions before execution; do not let execution infer those decisions from raw Data Forge output
- keep helper responsibilities local to transport, normalization, evidence, and result persistence

## Minimal Example

```python
from scripts.mcp_client import call_mcp_tool
import json
from pathlib import Path

contracts = call_mcp_tool('get-tool-contract', {
    'tool-names': ['get-app-info'],
})
if not contracts['success']:
    raise RuntimeError(contracts['raw'])

runtime_args = {
    'environment-name': 'local',
}

result = call_mcp_tool('get-app-info', runtime_args)
if not result['success']:
    raise RuntimeError(result['raw'])

target = Path('output/UsrMyApp/mcp-application-result.json')
target.write_text(json.dumps(result['data'], ensure_ascii=True, indent=2) + '\n', encoding='utf-8')
```

Then normalize with `scripts/mcp_context_adapter.py normalize`.

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
- current `schema-sync` and `page-sync` behavior

For app-modeling guidance, use `docs://mcp/guides/app-modeling`.

## Local Transport

Invoke `clio` MCP through `scripts/mcp_client.py`.
Use clio stdio transport instead of ad-hoc shell pipes or HTTP wrappers.

```python
from scripts.mcp_client import call_mcp_tool

result = call_mcp_tool('application-get-list', {'environment-name': 'local'})
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
& $env:PYTHON_CMD .\scripts\mcp_client.py application-get-list --args-file .\args.json --timeout 30
```

## Canonical Runtime Result

The primary application context used by this repo starts from the flat MCP response returned by `application-create` or `application-get-info`.

Use `tool-contract-get` plus `clio` prompts/resources for the current executable response shape and field names.
This repo only normalizes the current response envelope into local helper state and evidence files.
Do not treat legacy `app/packages` examples as the MCP response contract.

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
1. Initialize the runtime result through the current app create or app discovery step resolved from `tool-contract-get`
2. Normalize and persist the result file
3. Run approved helper orchestration
4. Re-read and normalize the runtime result again when the chosen `clio` workflow requires refresh
5. Run page sync and evidence helpers when required

## Local Follow-up Helpers

Use these helpers after MCP calls:
- `scripts/mcp_context_adapter.py normalize` to normalize the runtime result
- `scripts/mcp_result_evidence.py report` to generate `mcp-application-report.md`
- `scripts/mcp_schema_sync.py plan` and `apply` for repo-local schema sync orchestration
- `scripts/mcp_page_sync.py build-plan` and `apply` for repo-local page sync orchestration

Local helper rules:
- follow the current `clio` MCP guidance for preferred entity/page write paths and read-back verification
- keep helper responsibilities local to transport, normalization, orchestration, evidence, and result persistence

## Minimal Example

```python
from scripts.mcp_client import call_mcp_tool
import json
from pathlib import Path

contracts = call_mcp_tool('tool-contract-get', {
    'tool-names': ['application-get-info'],
})
if not contracts['success']:
    raise RuntimeError(contracts['raw'])

runtime_args = {
    'environment-name': 'local',
}

result = call_mcp_tool('application-get-info', runtime_args)
if not result['success']:
    raise RuntimeError(result['raw'])

target = Path('output/UsrMyApp/mcp-application-result.json')
target.write_text(json.dumps(result['data'], ensure_ascii=True, indent=2) + '\n', encoding='utf-8')
```

Then normalize with `scripts/mcp_context_adapter.py normalize`.

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
- current `schema-sync` and `page-sync` behavior, including page-tool roles and fallback hints

For app-modeling guidance, use `docs://mcp/guides/app-modeling`.
For page maintenance guidance, use `docs://mcp/guides/existing-app-maintenance`.

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

For canonical MCP response fields and shapes, use `tool-contract-get`. This section covers only the local normalization applied after receiving the MCP response.

## Normalize Into `mcp-application-result.json`

After writing the raw MCP result to `output/<AppName>/mcp-application-result.json`, normalize it:

```bash
python3 scripts/mcp_context_adapter.py normalize output/<AppName>/mcp-application-result.json
```

Normalization keeps the flat runtime contract and adds repo-local helper state:
- `contractType`
- `schemaSync`
- `operationLog`
- `pageEvidence`
- `acceptanceEvidence`
- `editableContext`

`editableContext` is a local derived projection for helper scripts. It is not the MCP response contract.

## Local Refresh Pattern

Use this repo-local refresh policy:
1. Create or discover the app via `application-create` or `application-get-info`
2. Normalize and persist the result file
3. Run approved schema mutations, preferably via `schema-sync`
4. Call `application-get-info` once after entity mutations complete
5. Overwrite and normalize `mcp-application-result.json` again
6. Run page sync and evidence helpers when required

When the application context exposes a main-entity selector, treat it as `clio`-owned MCP metadata and use it as the primary selector for the app’s main entity. Keep this file focused on local wrapper and result-handling behavior.

## Local Follow-up Helpers

Use these helpers after MCP calls:
- `scripts/mcp_context_adapter.py normalize` to normalize the runtime result
- `scripts/mcp_result_evidence.py report` to generate `mcp-application-report.md`
- `scripts/mcp_schema_sync.py plan` and `apply` for repo-local schema sync orchestration
- `scripts/mcp_page_sync.py build-plan` and `apply` for repo-local page sync orchestration

Local helper rules:
- use `schema-sync` as the preferred entity write path when the approved plan batches related entity changes
- follow the clio-advertised canonical page flow `page-list -> page-get -> page-sync -> page-get`
- keep the local verification fallback through `page-get` when the `page-sync` response does not expose a reusable verified body

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

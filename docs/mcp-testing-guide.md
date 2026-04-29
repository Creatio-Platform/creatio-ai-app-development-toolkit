# MCP Testing Guide — Bootstrap And Verification

> For visual UI testing, see [`context/mcp-inspector-guide.md`](../context/mcp-inspector-guide.md).

This document describes how to verify released clio MCP bootstrap and wrapper behavior through `scripts/mcp_client.py`.
The executable contract is defined only by `clio MCP` via `get-tool-contract`; this document does not duplicate tool payload shape.

## Base Rules

- Supported runtime: released `clio` `8.0.2.50+`
- `CLIO_CMD` may be used only as an override for the path to a compatible `clio`
- MCP execution runs over clio stdio, not over HTTP/SSE
- For real calls, use `python3 scripts/mcp_client.py ...`
- For JSON-heavy payloads, use `--args-file` or `--args-stdin` instead of inline quoting
- First check the manifest via `tools/list`, then the executable contract via `get-tool-contract`
- Canonical entity flow: `create-app -> sync-schemas -> get-app-info`
- clio-advertised canonical page flow: `list-pages -> get-page -> sync-pages -> get-page`
- `update-page` remains a fallback path only for single-page dry-run or legacy save
- When you need an exact tool shape, read it at execution time through `get-tool-contract` and `docs://mcp/guides/app-modeling`

## Quick Environment Check

```bash
clio ver
python3 scripts/mcp_client.py --check-clio-version
python3 scripts/mcp_client.py tools/list '{}' 30
python3 scripts/mcp_client.py get-tool-contract '{}' 30
```

```powershell
clio ver
py -3 .\scripts\mcp_client.py --check-clio-version
py -3 .\scripts\mcp_client.py tools/list '{}' 30
py -3 .\scripts\mcp_client.py get-tool-contract '{}' 30
```

Expectations:

- `clio ver` returns `8.0.2.50` or newer
- `--check-clio-version` exits successfully
- `tools/list` returns a non-empty manifest
- `get-tool-contract` returns non-empty metadata for available tools

## Generic Invocation Pattern

For any non-bootstrap tool:

1. verify the tool is present in `tools/list`
2. obtain exact params, aliases, required fields, type expectations, response hints, and rejected aliases via `get-tool-contract`
3. prepare the payload in `args.json` or via stdin
4. invoke `scripts/mcp_client.py <tool-name> --args-file ./args.json --timeout <seconds>`
5. if the call mutates entity metadata, run a follow-up verification through the canonical refresh path

Wrapper invocation pattern examples:

```bash
python3 scripts/mcp_client.py <tool-name> --args-file ./args.json --timeout 120
python3 scripts/mcp_client.py <tool-name> --args-stdin --timeout 120 < ./args.json
```

```powershell
py -3 .\scripts\mcp_client.py <tool-name> --args-file .\args.json --timeout 120
Get-Content .\args.json | py -3 .\scripts\mcp_client.py <tool-name> --args-stdin --timeout 120
```

## Wrapper Verification Focus

Verify the local wrapper for these properties:

- `tools/list` and `get-tool-contract` work without a prior contract cache
- non-bootstrap tools require a successful `get-tool-contract`
- top-level metadata validation uses only live contract data:
  - `required`
  - `any-of`
  - declared field types
  - rejected aliases
- nested request shapes are not guessed locally; errors of that kind are returned by clio MCP itself
- unknown tool names return a suggestion list from the live contract index

## Checks After Mutation Flows

- After an entity mutation flow, run a canonical refresh through `get-app-info`
- After a page write flow, re-verify the result through `get-page` if the helper or server response does not provide sufficient verification evidence
- Do not keep local hard-coded param or response expectations; if you need the exact shape, read it through `get-tool-contract`

## Common Errors

### Unsupported clio version

Cause:

- installed `clio` is older than `8.0.2.50`

Resolution:

- update `clio`
- or point to a compatible released binary via `CLIO_CMD`

### `get-tool-contract` Unavailable

Cause:

- wrapper cannot retrieve live metadata
- incompatible `clio` version
- transport/bootstrap problem

Resolution:

- check `clio ver`
- check `tools/list`
- check `get-tool-contract` separately
- do not try to build non-bootstrap payloads from repo docs

### Generic Invocation Error From clio

Cause:

- payload shape or nested fields do not match the live contract
- wrapper no longer validates complex nested rules locally

Resolution:

- reconcile exact params, aliases, validators, prompt/resource guidance, and tool-specific notes via `get-tool-contract`
- for app-modeling semantics, read `docs://mcp/guides/app-modeling`

## See Also

- [`context/mcp-inspector-guide.md`](../context/mcp-inspector-guide.md)

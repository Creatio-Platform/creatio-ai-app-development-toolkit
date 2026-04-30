# Package Structure

## descriptor.json

Every package must have `descriptor.json` at the root:

```json
{
  "Descriptor": {
    "UId": "<new-package-guid>",
    "PackageVersion": "1.0.0",
    "Name": "UsrTodoListApp",
    "ModifiedOnUtc": "/Date(1700000000000)/",
    "Type": 1,
    "Maintainer": "Customer",
    "DependsOn": []
  }
}
```

Use empty `DependsOn: []` by default unless the package genuinely requires explicit dependencies.

## Typical Directory Layout

```text
packages/<PackageName>/
├── descriptor.json
├── Schemas/
│   ├── UsrLookup/
│   ├── UsrEntity/
│   ├── UsrEntity_ListPage/
│   ├── UsrEntity_FormPage/
│   └── UsrEntity_FormPage_Addon/
├── Data/
│   ├── SysModule_UsrEntity/
│   ├── SysModuleEntity_UsrEntity/
│   └── UsrLookup/
└── Files/
```

## Generation Order

For executable MCP tool shape and app-modeling semantics, use the discovered `clio` MCP tool schema and prompts/resources such as `docs://mcp/guides/app-modeling`.

- `clio` MCP is the only source of truth for tool names, parameter names, aliases, defaults, response shapes, error shapes, and canonical or fallback flow hints.
- Use `get-tool-contract` through `scripts/mcp_client.py` whenever you need the exact executable contract.
- When a tool is not present in the default bootstrap contract set, resolve it through explicit `get-tool-contract {"tool-names":[...]}` lookup instead of assuming it is unavailable.
- Repository docs describe workflow policy and modeling rules only and must not become a second MCP API specification.
- Resolve human-readable MCP flow, fallback, verification, main-entity, localization, and page inspection guidance through `docs://mcp/guides/app-modeling` and `docs://mcp/guides/existing-app-maintenance`.
- Treat `editableContext` as a local helper projection, not as the primary MCP response contract.
- When `dataforge-find-tables`, `dataforge-find-lookups`, or `dataforge-context` surfaces strong model candidates, persist the resulting `reuse` / `extend` / `create` decision in the plan instead of treating the discovery output as advisory only.

## Working With MCP Tools

Use `scripts/mcp_client.py` for local `clio` stdio transport:

```python
from scripts.mcp_client import call_mcp_tool

contracts = call_mcp_tool("get-tool-contract", {})
apps = call_mcp_tool("list-apps", {"environment-name": "local"})
```

Use the discovered MCP tool schema plus `clio` prompts/resources for:

- tool parameters and response payloads
- canonical main-entity selection
- lookup display-field semantics
- default semantics and lookup-seed implications
- current `sync-schemas` and `sync-pages` behavior

Use this repo's wrapper docs and helper scripts for:

- local transport invocation patterns
- normalized result-file handling
- evidence generation and follow-up apply helpers

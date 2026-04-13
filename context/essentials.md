# Creatio Platform Essentials

## Platform Overview

Creatio is a no-code/low-code platform for process management and CRM using a composable application architecture where functionality is delivered as packages.

### Key Concepts

**Composable Applications**
- Built from self-contained packages containing entity schemas, page schemas, data bindings, business processes, and source code
- Packages can depend on other packages via `DependsOn` in `descriptor.json`

**MCP-Orchestrated Runtime**
- This repo invokes Creatio app generation and mutation through `clio` MCP, usually via `scripts/mcp_client.py`
- The executable MCP contract lives in `clio` MCP discovery plus MCP prompts/resources, not in this repo
- The raw application context returned by `create-app` or `get-app-info` is a flat runtime payload whose exact fields and selectors must be read from `get-tool-contract`
- `output/<AppName>/mcp-application-result.json` is the local normalized runtime context and evidence file used by helper scripts and final reporting
- After normalization, the local result document may also contain helper projections such as `editableContext`, but those are repo-local derived views rather than the MCP response contract

**MCP Application Creation (DB-first)**
- Resolve current application creation, discovery, refresh, and main-entity semantics through `get-tool-contract` and the `clio` MCP guidance resources
- `create-app` is the canonical new-app entrypoint and may return top-level `dataforge` diagnostics produced internally by `clio`
- Do not add a separate mandatory Data Forge preflight in repo-local orchestration for the standard new-app branch
- Planning-time read-only discovery is still required when the model is ambiguous or strong existing-schema candidates exist; use that discovery to decide `reuse`, `extend`, or `create` before execution
- Schema tools mutate entity schemas directly in Creatio DB, so successful mutations are immediately runtime-accessible without a separate compile or deploy step

**MCP Section Management**
- Use `list-app-sections` to list all sections of an installed application
- Use `delete-app-section` to remove a section from an installed application
- Canonical section discovery flow: `list-apps` → `get-app-info` → `list-app-sections`
- Canonical section delete flow: `list-apps` → `get-app-info` → `list-app-sections` → `delete-app-section`
- `delete-entity-schema` on `delete-app-section` is destructive and irreversible; it requires explicit opt-in
- Resolve full tool parameter contract through `get-tool-contract` and `docs://mcp/guides/existing-app-maintenance`

**Entity Schema Sync (DB-first)**
- Prefer `sync-schemas` for grouped entity work
- Use `create-lookup`, `create-entity-schema`, `update-entity-schema`, and `create-data-binding-db` only when the flow cannot stay inside `sync-schemas`
- Create lookup entities before entities or updates that reference them

**Default Semantics**
- Follow the current `clio` MCP contract and `docs://mcp/guides/app-modeling` for canonical default semantics
- A default requirement stays unresolved until the plan classifies it as schema-side or UI-side behavior
- Lookup seed rows alone do not satisfy a requirement such as `UsrStatus defaults to New`
- For lookup-backed defaults, resolve the concrete executable mechanism through live contract metadata and app-modeling guidance
- Binary-like columns do not support constant defaults

**Data Binding And Schema Inspection**
- `get-entity-schema-properties` returns a deployed schema summary with column metadata
- `get-entity-schema-column-properties` returns detailed metadata for a single deployed column
- `create-data-binding-db` persists bindings in DB and installs data immediately
- `upsert-data-binding-row-db` updates rows only in an already existing binding
- For initial lookup seeding, prefer keeping the seeding inside the same schema batch; use explicit binding tools only as fallback

**Freedom UI (Angular-based)**
- Modern UI pages are AMD modules
- UI is described via `viewConfigDiff`
- Schema type is `"AngularSchema"`
- When page-body code imports `@creatio-devkit/common`, use `context/devkit-common-reference.md` and stay within the documented `src/lib/public/**` surface

**Entity Model**
- Entities extend a server-defined parent discovered through live contract metadata
- Columns use server-defined value-type identifiers
- Schemas use a diff-oriented metadata model

**System Tables For Navigation**
- `SysModule` registers a section
- `SysModuleEntity` binds an entity to a section
- `SysModuleEdit` binds a form page to a section

---

## Naming Conventions

### Prefixes

| Element | Prefix | Example |
|---------|--------|---------|
| Custom entity | `Usr` | `UsrTodoTask` |
| Custom column | `Usr` | `UsrStatus`, `UsrDueDate` |
| Custom page | `Usr` | `UsrTodoTask_FormPage` |
| Custom package | `Usr` | `UsrTodoListApp` |

### Casing

- Entities and columns use PascalCase
- Pages use PascalCase with underscore suffixes such as `UsrTodoTask_ListPage`
- Packages use PascalCase

### GUIDs

- Format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- Generate new GUIDs for packages, schemas, columns, and data binding records
- Never reuse GUIDs from other packages

### Data Binding Naming

| Type | Pattern | Example |
|------|---------|---------|
| SysModule | `SysModule_<Code>` | `SysModule_UsrTodoTask` |
| SysModuleEntity | `SysModuleEntity_<Code>` | `SysModuleEntity_UsrTodoTask` |

---

## Package Structure

### descriptor.json

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

### Typical Directory Layout

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

### Generation Order

For local MCP invocation helpers and result normalization, see `context/mcp-application-tools-reference.md`.
For executable MCP tool shape and app-modeling semantics, use discovered `clio` MCP tool schema and prompts/resources such as `docs://mcp/guides/app-modeling`.

- `clio MCP` is the only source of truth for tool names, parameter names, aliases, defaults, response shapes, error shapes, and canonical or fallback flow hints
- Use `get-tool-contract` through `scripts/mcp_client.py` whenever you need the exact executable contract
- When a tool is not present in the default bootstrap contract set, resolve it through explicit `get-tool-contract {"tool-names":[...]}` lookup instead of assuming it is unavailable
- Repository docs describe workflow policy and modeling rules only and must not become a second MCP API specification
- Resolve human-readable MCP flow, fallback, verification, main-entity, localization, and page inspection guidance through `docs://mcp/guides/app-modeling` and `docs://mcp/guides/existing-app-maintenance`.
- Treat `editableContext` as a local helper projection, not as the primary MCP response contract.
- When `dataforge-find-tables`, `dataforge-find-lookups`, or `dataforge-context` surfaces strong model candidates, persist the resulting `reuse` / `extend` / `create` decision in the plan instead of treating the discovery output as advisory only.

### Working With MCP Tools

- Use `scripts/mcp_client.py` for local `clio` stdio transport
- Use `scripts/mcp_context_adapter.py normalize` for local runtime result normalization

```python
from scripts.mcp_client import call_mcp_tool

contracts = call_mcp_tool("get-tool-contract", {})
apps = call_mcp_tool("list-apps", {"environment-name": "local"})
```

Use discovered MCP tool schema plus `clio` prompts/resources for:
- tool parameters and response payloads
- canonical main-entity selection
- lookup display-field semantics
- default semantics and lookup-seed implications
- current `sync-schemas` and `sync-pages` behavior

Use this repo’s wrapper docs and helper scripts for:
- local transport invocation patterns
- normalized result-file handling
- evidence generation and follow-up apply helpers

---

## Clio CLI Commands

Clio is the command-line tool for Creatio deployments.

### Environment Setup

```bash
clio reg-web-app myenv -u <creatio-url-from-planning> -l <login> -p <password>
clio reg-web-app -a myenv
clio healthcheck myenv
```

```bash
clio compile-configuration -e myenv
clio restart-web-app myenv
clio last-compilation-log -e myenv
```

### Package Management

```bash
clio new-pkg UsrMyPackage
clio get-pkg-list -e myenv
clio pull-pkg MyPackage -e myenv
clio delete-pkg-remote MyPackage -e myenv
clio validation-pkg ./MyPackage
```

### Development Tools

```bash
clio execute-sql-script "SELECT Id FROM Contact LIMIT 5" -e myenv
clio clear-redis-db myenv
clio set-syssetting MySetting "Value" -e myenv
```

---

## Local MCP Workflow

```text
MCP result -> normalize into repo-local context -> run approved helper orchestration -> persist evidence and reports
```

Local rule:
- Keep the result file flat and source-backed
- The normalized runtime document starts from the MCP response and adds local helper state such as `schemaSync`, `operationLog`, `pageEvidence`, `acceptanceEvidence`, and `editableContext`
- Normalization is canonicalization plus strict validation; invalid local helper state must fail before persistence

---

## ModifiedOnUtc Format

Use milliseconds since Unix epoch in `/Date(milliseconds)/` format.

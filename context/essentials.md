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
- The raw application context returned by `application-create` or `application-get-info` is a flat runtime payload whose exact fields and selectors must be read from `tool-contract-get`
- `output/<AppName>/mcp-application-result.json` is the local normalized runtime context and evidence file used by helper scripts and final reporting
- After normalization, the local result document may also contain helper projections such as `editableContext`, but those are repo-local derived views rather than the MCP response contract

**MCP Application Creation (DB-first)**
- Primary generation path is `application-create`
- Discovery path for existing apps is `application-get-list`
- Canonical refresh path is `application-get-info`
- For new Freedom UI apps, `application-create` also materializes the initial section entity whose schema name normally matches the app code
- For single-record-type apps, extend that template-created section entity instead of creating a second main `BaseEntity` for the same business object
- Schema tools mutate entity schemas directly in Creatio DB, so successful mutations are immediately runtime-accessible without a separate compile or deploy step

**Entity Schema Sync (DB-first)**
- Prefer `schema-sync` for grouped entity work
- Use `create-lookup`, `create-entity-schema`, `update-entity-schema`, and `create-data-binding-db` only when the flow cannot stay inside `schema-sync`
- Create lookup entities before entities or updates that reference them

**Default Semantics**
- Follow the current `clio` MCP contract and `docs://mcp/guides/app-modeling` for canonical default semantics
- A default requirement stays unresolved until the plan classifies it as schema-side or UI-side behavior
- For lookup-backed defaults, resolve the concrete executable mechanism through live contract metadata and app-modeling guidance
- Do not restate field-level default rules in this repo; resolve them through live `clio` guidance

**Data Binding And Schema Inspection**
- `get-entity-schema-properties` returns a deployed schema summary with column metadata
- `get-entity-schema-column-properties` returns detailed metadata for a single deployed column
- For DB-first binding behavior, payload shape, and fallback semantics, resolve the current canonical path through `tool-contract-get`
- For lookup seeding, keep only the orchestration decision in this repo and defer executable semantics to `clio`

**Freedom UI (Angular-based)**
- Modern UI pages are AMD modules
- UI is described via `viewConfigDiff`
- Schema type is `"AngularSchema"`
- When page-body code imports `@creatio-devkit/common`, use `context/devkit-common-reference.md` and stay within the documented `src/lib/public/**` surface

**Entity Model**
- Entities extend a server-defined parent selected through the current `clio` contract and guidance
- Columns use server-defined data value types discovered through live contract metadata
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
- Use `tool-contract-get` through `scripts/mcp_client.py` whenever you need the exact executable contract
- Repository docs describe workflow policy and modeling rules only and must not become a second MCP API specification

Canonical entity flow:

1. `application-create`
2. `schema-sync`
3. `application-get-info`

Canonical page flow from the current `clio` contract:

1. `page-list`
2. `page-get`
3. edit body
4. `page-sync`
5. `page-get`

Compact reference:
- `application-create -> schema-sync -> application-get-info`
- `page-list -> page-get -> page-sync -> page-get`

Fallbacks:

- Use `create-lookup`, `create-entity-schema`, `update-entity-schema`, and `create-data-binding-db` only when the flow cannot stay inside `schema-sync`
- Use `page-update` only as an explicit fallback for single-page dry-run or legacy save workflows

Critical patterns:

- Always call `application-get-info` once after `schema-sync` completes and verify the schema is immediately queryable
- Do not create a second `BaseEntity` for the same primary records already represented by the template-created section entity
- `application-create` stays scalar-only; localized captions belong to follow-up schema tools
- When server-advertised canonical main-entity metadata is present, use it as the primary selector for the app’s main entity and fall back to the section entity that matches the app code only when that metadata is absent
- Treat `editableContext` as a local helper projection, not as the primary MCP response contract

### Working With MCP Tools

- Use `scripts/mcp_client.py` for local `clio` stdio transport
- Use `scripts/mcp_context_adapter.py normalize` for local runtime result normalization

```python
from scripts.mcp_client import call_mcp_tool

contracts = call_mcp_tool("tool-contract-get", {})
apps = call_mcp_tool("application-get-list", {"environment-name": "local"})
```

Use discovered MCP tool schema plus `clio` prompts/resources for:
- tool parameters and response payloads
- canonical main-entity selection
- lookup display-field semantics
- default semantics and lookup-seed implications
- current `schema-sync` and `page-sync` behavior
- canonical page flow: `page-list -> page-get -> page-sync -> page-get`; keep `page-update` only as fallback

Use this repo’s wrapper docs and helper scripts for:
- local transport invocation patterns
- normalized result-file handling
- evidence generation and follow-up apply helpers

For repo-local page editing, use `component-info` after `page-get` whenever `bundle.viewConfig` contains an unfamiliar `crt.*` component type and you need its supported properties, parent types, or typical children before editing.

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

Resolve the exact tool sequence and parameters through `tool-contract-get` and Clio MCP guidance resources.
The local orchestration pattern follows: initialize canonical context → schema mutations → refresh → verify.

Local rule:
- Keep the result file flat and source-backed
- The normalized runtime document starts from the MCP response and adds local helper state such as `contractType`, `schemaSync`, `operationLog`, `pageEvidence`, `acceptanceEvidence`, and `editableContext`

---

## ModifiedOnUtc Format

Use milliseconds since Unix epoch in `/Date(milliseconds)/` format.

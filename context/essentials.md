# Creatio Platform Essentials

## Platform Overview

Creatio is a no-code/low-code platform for process management and CRM using a **composable application** architecture where functionality is delivered as packages.

### Key Concepts

**Composable Applications**
- Built from self-contained **packages** containing: entity schemas, page schemas, data bindings, business processes, source code
- Packages can depend on other packages (via `DependsOn` in descriptor.json)

**MCP-Orchestrated Runtime**
- This repo invokes Creatio app generation and mutation through `clio` MCP, usually via `scripts/mcp_client.py`
- The executable MCP contract lives in `clio` MCP discovery plus MCP prompts/resources, not in this repo
- The raw application context returned by `application-create` or `application-get-info` is a flat runtime payload such as `success`, `package-u-id`, `package-name`, `entities`, optional `canonical-main-entity-name`, and `error`
- `output/<AppName>/mcp-application-result.json` is the local normalized runtime context and evidence file used by helper scripts and final reporting
- After normalization, the local result document may also contain helper projections such as `editableContext`, but those are repo-local derived views rather than the MCP response contract

**Freedom UI (Angular-based)**
- Modern UI framework with pages as AMD modules (JavaScript `define()`)
- UI described via `viewConfigDiff` — array of operations (merge, insert, remove, move)
- Schema type: `"AngularSchema"`
- When frontend or page-body code imports `@creatio-devkit/common`, use `context/devkit-common-reference.md` and stay within the documented `src/lib/public/**` surface rather than relying on root-barrel access to internal exports

**Entity Model**
- Entities extend a parent (BaseEntity, BaseLookup, etc.)
- Columns have DataValueType (GUID-based) — ShortText, Lookup, Integer
- Schemas use DSL diff format for metadata

**System Tables for Navigation**
- **SysModule** — registers a section (visible in navigation)
- **SysModuleEntity** — binds entity to section
- **SysModuleEdit** — binds form page to section

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

- **Entities/Columns**: PascalCase — `UsrTodoTask`, `UsrStatus`
- **Pages**: PascalCase with underscore — `UsrTodoTask_ListPage`, `UsrTodoTask_FormPage`
- **Packages**: PascalCase — `UsrTodoListApp`

### GUIDs

- Format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (lowercase, 36 characters)
- Generate new for: packages, schemas, columns, data binding records
- **Never reuse** GUIDs from other packages

### Data Binding Naming

| Type | Pattern | Example |
|------|---------|---------|
| SysModule | `SysModule_<Code>` | `SysModule_UsrTodoTask` |
| SysModuleEntity | `SysModuleEntity_<Code>` | `SysModuleEntity_UsrTodoTask` |

---

## Package Structure

### descriptor.json (Required)

Every package MUST have `descriptor.json` at root:

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

| Field | Required | Description |
|-------|----------|-------------|
| `UId` | ✅ | Unique GUID for package |
| `PackageVersion` | ✅ | Semantic version (e.g., "1.0.0") |
| `Name` | ✅ | Package name (PascalCase, Usr prefix) |
| `ModifiedOnUtc` | ✅ | Timestamp in `/Date(milliseconds)/` format |
| `Type` | ✅ | Always `1` for custom packages |
| `Maintainer` | ✅ | `"Customer"` for custom |
| `DependsOn` | ✅ | Array of dependencies (use `[]` as default) |

**⚠️ Dependencies**: Use empty `DependsOn: []` by default. Creatio auto-resolves dependencies. Hardcoding UIds may fail across environments.

### Complete Directory Structure

```
packages/<PackageName>/
├── descriptor.json                    
├── Schemas/
│   ├── UsrLookup/                     ← lookup entity (3 files)
│   │   ├── descriptor.json
│   │   ├── metadata.json
│   │   └── properties.json
│   ├── UsrEntity/                     ← main entity (3 files)
│   ├── UsrEntity_ListPage/            ← list page (4 files)
│   ├── UsrEntity_FormPage/            ← form page (4 files)
│   └── UsrEntity_FormPage_Addon/      ← addon (3 files)
├── Data/
│   ├── SysModule_UsrEntity/           ← register section
│   ├── SysModuleEntity_UsrEntity/     ← bind entity to section
│   └── UsrLookup/                     ← seed lookup values (default binding name is schema name)
└── Files/                             ← optional C# code
```

### Generation Order

**For local MCP invocation helpers and result normalization, see `context/mcp-application-tools-reference.md`.**
**For executable MCP tool shape and app-modeling semantics, use discovered `clio` MCP tool schema and prompts/resources such as `docs://mcp/guides/app-modeling`.**

Primary generation flow:

1. Validate tool availability (`tools/list`)
2. Run `application-create` for a new app, or use `application-get-list` -> `application-get-info` for an existing app flow
3. Persist the flat MCP application context to `output/<AppName>/mcp-application-result.json`
4. Normalize the result with `scripts/mcp_context_adapter.py normalize`
5. Use `canonical-main-entity-name` when present to resolve the main entity; otherwise fall back to the section entity that matches the app code
6. If approved schema changes exist:
   - Use `schema-sync` to batch all entity operations (create-lookup + seed + update-entity) in one MCP call
   - After `schema-sync` completes, refresh context once with `application-get-info`
   - Overwrite `mcp-application-result.json` with updated state
   - Use individual entity tools only as a fallback when the plan cannot be expressed as a single `schema-sync` batch
7. If explicit data bindings are still required after schema sync, use `create-data-binding-db`
8. If the run creates a new app or extends the main section entity with approved business fields, execute page sync and persist page evidence

**Critical pattern:** Call `application-get-info` once after entity mutations complete and treat that refreshed payload as the canonical post-mutation state.
**Critical pattern:** Treat `editableContext` as a local helper projection, not as the primary MCP response contract.

### Working with MCP Tools

Use `scripts/mcp_client.py` for local `clio` stdio transport and `scripts/mcp_context_adapter.py normalize` for local runtime result normalization.

```python
from scripts.mcp_client import call_mcp_tool
r = call_mcp_tool('application-get-list', {'environment-name': 'local'})
```

Use discovered MCP tool schema plus `clio` prompts/resources for:
- tool parameters and response payloads
- canonical main-entity selection
- lookup display-field semantics
- default semantics and lookup-seed implications
- current `schema-sync` and `page-sync` behavior

Use this repo’s wrapper docs and helper scripts for:
- local transport invocation patterns
- normalized result-file handling
- evidence generation and follow-up apply helpers

Use `component-info` after `page-get` whenever `bundle.viewConfig` contains an unfamiliar `crt.*` component type and you need its supported properties, parent types, or typical children before editing.

---

## Clio CLI Commands

Clio is the command-line tool for Creatio deployments.

### Environment Setup

```bash
# Register environment
clio reg-web-app myenv -u <creatio-url-from-planning> -l <login> -p <password>

# Set active
clio reg-web-app -a myenv

# Verify connection
clio healthcheck myenv
```

```bash
# Compile configuration
clio compile-configuration -e myenv

# Restart application
clio restart-web-app myenv

# Check compilation log
clio last-compilation-log -e myenv
```

### Package Management

```bash
# Create new package skeleton
clio new-pkg UsrMyPackage

# List installed packages
clio get-pkg-list -e myenv

# Pull package from environment
clio pull-pkg MyPackage -e myenv

# Delete package
clio delete-pkg-remote MyPackage -e myenv

# Validate package structure
clio validation-pkg ./MyPackage
```

### Development Tools

```bash
# Execute SQL
clio execute-sql-script "SELECT Id FROM Contact LIMIT 5" -e myenv

# Clear cache
clio clear-redis-db myenv

# System settings
clio set-syssetting MySetting "Value" -e myenv

# Install cliogate (deprecated — entity MCP tools no longer require cliogate)
# clio install-gate -e myenv
```

---

## Local MCP Workflow

```
MCP application-create or application-get-info → initialize canonical context → [optional] schema-sync or create-lookup/create-entity-schema/update-entity-schema → application-get-info refresh → [optional] get-entity-schema-properties/create-data-binding-db → schemas immediately usable
```

**Local rule:** Keep the result file flat and source-backed. The normalized runtime document starts from the MCP response and adds local helper state such as `contractType`, `schemaSync`, `operationLog`, `pageEvidence`, `acceptanceEvidence`, and `editableContext`.

---

## ModifiedOnUtc Format

Use milliseconds since Unix epoch:

```powershell
# PowerShell
[Math]::Floor((Get-Date).ToUniversalTime().Subtract([DateTime]'1970-01-01').TotalMilliseconds)

# Result format
"/Date(1700000000000)/"
```

# Creatio Platform Essentials

## Platform Overview

Creatio is a no-code/low-code platform for process management and CRM using a **composable application** architecture where functionality is delivered as packages.

### Key Concepts

**Composable Applications**
- Built from self-contained **packages** containing: entity schemas, page schemas, data bindings, business processes, source code
- Packages can depend on other packages (via `DependsOn` in descriptor.json)

**MCP Application Creation (DB-first)**
- Primary generation path is MCP tool `application-create`
- Discovery path for existing apps is `application-get-list`
- Canonical DB refresh path is `application-get-info`
- Tool creates application artifacts directly in Creatio DB (PostgreSQL)
- For new Freedom UI apps, `application-create` also materializes the initial section entity whose schema name normally matches the app code
- Released schema tools (`create-lookup`, `create-entity-schema`, `update-entity-schema`) execute CREATE TABLE and ALTER TABLE directly
- Schemas are immediately runtime-accessible — no compilation or deployment step required
- Tool returns short compact context JSON (`success`, `package-u-id`, `package-name`, `entities`, `error`)
- Agent persists result artifacts to `output/<AppName>/mcp-application-result.json` and report
- `mcp-application-result.json` is the canonical mutable workflow context and is overwritten by `application-create` or `application-get-info`

**Entity Schema Sync (DB-first)**
- Secondary generation path is MCP `create-entity-schema`, `create-lookup`, `update-entity-schema`
- These tools mutate entity schemas in Creatio DB and return persisted schema snapshots
- `update-entity-schema` accepts explicit `operations` entries with `action: add|modify|remove`
- New lookup entities must be created before entities or updates that reference them

**Default Semantics**
- `schema default` means the entity schema or backend contract stores the initial value
- `ui default` means the page layer sets the value through `crt.CreateRecordRequest.defaultValues` or a handler
- Lookup seed rows alone do not satisfy a requirement such as `UsrStatus defaults to New`
- For lookup-backed `schema default`, use the seeded row GUID in `defaultValue`
- `Binary`, `Image`, `File`, and `Blob` columns do not support `defaultValueSource=Const`

**Data Binding & Schema Inspection (MCP-assisted)**
- `get-entity-schema-properties` returns a schema summary object with column entries for deployed schemas; use the returned columns for machine-readable verification and respect each column's `source` (`own` or `inherited`) (requires `environment-name`, `package-name`, `schema-name`)
- `get-entity-schema-column-properties` returns detailed metadata for a single column (also requires `column-name`)
- `create-data-binding-db` creates or updates bindings in DB for SysModule, SysModuleEntity, lookup seed data, and other package data rows, then installs data immediately (requires `environment-name`, `package-name`, `schema-name`)
- `upsert-data-binding-row-db` upserts a single row in an existing data binding (requires `environment-name`, `package-name`, `schema-name`, `values`)

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

**For complete MCP workflow with Python examples, see `context/mcp-application-tools-reference.md`**

Primary generation flow:

1. Validate tool availability (`tools/list`)
2. Build and execute `application-create` payload
3. Parse response and validate short contract (`success`, `app`, `packages`)
4. Identify the template-created section entity from the response and treat it as the canonical main entity for single-record-type apps
5. Persist result to `output/<AppName>/mcp-application-result.json`
6. If approved schema changes exist:
   - Use `schema-sync` to batch all entity operations (create-lookup + seed + update-entity) in one MCP call
   - After `schema-sync` completes, refresh context once with `application-get-info`
   - Overwrite `mcp-application-result.json` with updated state
   - Fallback: individual `create-lookup` → `create-data-binding-db` → `update-entity-schema` calls, omitting `binding-name` for default lookup seed bindings
7. If explicit data bindings required, use `create-data-binding-db`

**Critical pattern:** Always call `application-get-info` after entity mutations complete and verify schema is immediately queryable (not in "Database update required" state).
**Critical pattern:** Do not create a second BaseEntity for the same primary records already represented by the template-created section entity. Extend that entity with `update-entity-schema` unless requirements define an additional distinct business object.

### Working with MCP Tools

**Transport:** clio stdio via `scripts/mcp_client.py`.

```python
from scripts.mcp_client import call_mcp_tool
r = call_mcp_tool('application-get-list', {'environment-name': 'local'})
```

**Available Tools:**
- `application-create` — Create new app with initial package/entity
- `application-get-info` — Refresh application context (canonical DB refresh)
- `application-get-list` — Discover existing apps
- `schema-sync` — **Batch** entity operations (create-lookup, seed, create-entity, update-entity) in one call
- `page-sync` — **Batch** page updates with built-in validation in one call
- `create-lookup` — Create BaseLookup entity (individual, prefer `schema-sync`)
- `create-entity-schema` — Create BaseEntity entity (individual, prefer `schema-sync`)
- `update-entity-schema` — Add/update columns (individual, prefer `schema-sync`)
- `create-data-binding-db` — Seed lookup data (individual, prefer `schema-sync` with `seed-rows`; omit `binding-name` by default to reuse `<schema-name>` binding)
- `component-info` — Inspect curated Freedom UI component contracts locally
- `page-list` — Discover Freedom UI pages
- `page-get` — Read page body (still individual — needed before `page-sync`)
- `page-update` — Save page body (individual, prefer `page-sync`)

**Complete reference with Python examples:** `context/mcp-application-tools-reference.md`

Use `component-info` after `page-get` whenever `bundle.viewConfig` contains an unfamiliar `crt.*` component type and you need its supported properties, parent types, or typical children before editing.

### MCP `application-create` Input

Required:
- `name`
- `code` (must start with `Usr`)
- `template-code`
- `icon-background` (hex color)

Optional:
- `icon-id` (GUID) — if omitted, random icon from SysAppIcons is selected automatically
- `description`
- `client-type-id` (GUID)
- `optional-template-data-json` with:
  - `useExistingEntitySchema`
  - `entitySchemaName`
  - `appSectionDescription`
  - `useAIContentGeneration`

Validation notes:
- if `icon-id` provided, must reference existing record in `SysAppIcons` table
- `client-type-id` must be valid GUID if provided
- this flow does not support `useAIContentGeneration=true`
- tool must exist in `tools/list` before execution
- for a new app with one primary record type, the template-created entity named like `code` is the default main entity to update; do not plan a parallel entity for the same records

### MCP Request Example

```python
r = call_mcp_tool('application-create', {
    'environment-name': 'local',
    'name': 'Task App',
    'code': 'UsrTaskApp',
    'template-code': 'AppFreedomUI',
    'icon-background': '#1F5F8B',
    'optional-template-data-json': '{"useExistingEntitySchema":false,"entitySchemaName":"","appSectionDescription":"","useAIContentGeneration":false}',
})
```

> 💡 **Note:** `icon-id` is optional. If omitted, a random icon from `SysAppIcons` is selected automatically.
> 💡 **Note:** Use `"AppFreedomUI"` for `template-code`. Core resolves it dynamically to v1 or v2 based on feature flags.

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

## MCP Workflow (DB-First)

```
MCP application-create or application-get-info → initialize canonical context → [optional] schema-sync or create-lookup/create-entity-schema/update-entity-schema → application-get-info refresh → [optional] get-entity-schema-properties/create-data-binding-db → schemas immediately usable
```

**Key Principle:** MCP entity tools work DB-first. Schemas are created directly in PostgreSQL via CREATE TABLE and ALTER TABLE statements. No separate compilation or deployment step is required.

---

## ModifiedOnUtc Format

Use milliseconds since Unix epoch:

```powershell
# PowerShell
[Math]::Floor((Get-Date).ToUniversalTime().Subtract([DateTime]'1970-01-01').TotalMilliseconds)

# Result format
"/Date(1700000000000)/"
```

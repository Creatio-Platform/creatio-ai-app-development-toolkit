# Creatio Platform Essentials

## Platform Overview

Creatio is a no-code/low-code platform for process management and CRM using a **composable application** architecture where functionality is delivered as packages.

### Key Concepts

**Composable Applications**
- Built from self-contained **packages** containing: entity schemas, page schemas, data bindings, business processes, source code
- Packages can depend on other packages (via `DependsOn` in descriptor.json)

**MCP Application Creation (DB-first)**
- Primary generation path is MCP tool `application.create`
- Discovery path for existing apps is `application.get_list`
- Canonical DB refresh path is `application.get_info`
- Tool creates application artifacts directly in Creatio DB (PostgreSQL)
- Entity tools (`entity.create_lookup`, `entity.create`, `entity.update`) execute CREATE TABLE and ALTER TABLE directly
- Schemas are immediately runtime-accessible — no compilation or deployment step required
- Tool returns short compact context JSON (`success`, `app`, `packages` dict, `error`)
- Agent persists result artifacts to `output/<AppName>/mcp-application-result.json` and report
- `mcp-application-result.json` is the canonical mutable workflow context and is overwritten by `application.create` or `application.get_info`

**Entity Schema Sync (DB-first)**
- Secondary generation path is MCP `entity.create`, `entity.create_lookup`, `entity.update`
- These tools mutate entity schemas in Creatio DB and return persisted schema snapshots
- `entity.update` accepts explicit `operationsJson` entries: `addColumn`, `updateColumn`, `removeColumn`
- New lookup entities must be created before entities or updates that reference them

**Data Binding Generation (MCP-assisted)**
- `binding.get_columns` returns column names, UIds, and data value types for deployed schemas
- `binding.create` creates or updates bindings in DB for SysModule, SysModuleEntity, lookup seed data, and other package data rows, then installs data immediately
- `binding.create` requires `packageUId` and supports optional `outputPath` only when files must also be written on the server

**Freedom UI (Angular-based)**
- Modern UI framework with pages as AMD modules (JavaScript `define()`)
- UI described via `viewConfigDiff` — array of operations (merge, insert, remove, move)
- Schema type: `"AngularSchema"`

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
| Custom column | `Usr` | `UsrTitle`, `UsrStatus` |
| Custom page | `Usr` | `UsrTodoTask_FormPage` |
| Custom package | `Usr` | `UsrTodoListApp` |

### Casing

- **Entities/Columns**: PascalCase — `UsrTodoTask`, `UsrTitle`
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
│   └── UsrLookup_Lookup/              ← seed lookup values
└── Files/                             ← optional C# code
```

### Generation Order

**For complete MCP workflow with detailed curl examples, see `context/mcp-application-tools-reference.md`**

Primary generation flow:

1. Initialize MCP session (`initialize` → extract `Mcp-Session-Id`)
2. Validate tool availability (`tools/list`)
3. Build and execute `application.create` payload
4. Parse SSE response and validate short contract (`success`, `app`, `packages`)
5. Persist result to `output/<AppName>/mcp-application-result.json`
6. If approved schema changes exist:
   - Execute ordered entity sync (`entity.create_lookup` → `entity.create` → `entity.update`)
   - After EACH mutation, refresh context with `application.get_info`
   - Overwrite `mcp-application-result.json` with updated state
7. If explicit data bindings required, use `binding.get_columns` and `binding.create`

**Critical pattern:** Always call `application.get_info` after entity mutations and verify schema is immediately queryable (not in "Database update required" state).

### Working with MCP Tools

**Endpoint:** `http://localhost:5001/mcp`
**Authentication:** HTTP Basic Auth (`-u Supervisor:Supervisor`)

**Required Headers:**
```bash
-H "Content-Type: application/json"
-H "Accept: application/json, text/event-stream"  # Both required!
-H "Mcp-Session-Id: $SESSION_ID"  # After initialize
```

**Response Format:** Server-Sent Events (SSE)
```
event: message
data: {"result":{"content":[{"type":"text","text":"..."}]},"id":1,"jsonrpc":"2.0"}
```

**Standard Parsing Pattern:**
```bash
curl ... | grep 'data: ' | sed 's/^data: //' | jq -r '.result.content[0].text'
```

**Available Tools:**
- `application.create` — Create new app with initial package/entity
- `application.get_info` — Refresh application context (canonical DB refresh)
- `application.get_list` — Discover existing apps
- `entity.create_lookup` — Create BaseLookup entity
- `entity.create` — Create BaseEntity entity
- `entity.update` — Add/update columns on existing entity
- `binding.get_columns` — Query deployed schema metadata
- `binding.create` — Generate data binding artifacts

**Complete reference with curl examples:** `context/mcp-application-tools-reference.md`

### MCP `application.create` Input

Required:
- `name`
- `code` (must start with `Usr`)
- `templateCode`
- `iconBackground` (hex color)

Optional:
- `iconId` (GUID) — if omitted, random icon from SysAppIcons is selected automatically
- `description`
- `clientTypeId` (GUID)
- `optionalTemplateDataJson` with:
  - `useExistingEntitySchema`
  - `entitySchemaName`
  - `appSectionDescription`
  - `useAIContentGeneration`

Validation notes:
- if `iconId` provided, must reference existing record in `SysAppIcons` table
- `clientTypeId` must be valid GUID if provided
- this flow does not support `useAIContentGeneration=true`
- tool must exist in `tools/list` before execution

### MCP Request Example

```bash
curl -s "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc":"2.0",
    "id":2,
    "method":"tools/call",
    "params":{
      "name":"application.create",
      "arguments":{
        "name":"Task App",
        "code":"UsrTaskApp",
        "templateCode":"AppFreedomUI",
        "iconBackground":"#1F5F8B",
        "optionalTemplateDataJson":"{\"useExistingEntitySchema\":false,\"entitySchemaName\":\"\",\"appSectionDescription\":\"\",\"useAIContentGeneration\":false}"
      }
    }
  }'
```

> 💡 **Note:** `iconId` is optional. If omitted, a random icon from `SysAppIcons` is selected automatically.
> 💡 **Note:** Use `"AppFreedomUI"` for templateCode. Core resolves it dynamically to v1 or v2 based on feature flags (`UseListPageV3Template` and `FreedomUIDashboardsEnabled`).

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

# Install cliogate (for advanced features)
clio install-gate -e myenv
```

---

## MCP Workflow (DB-First)

```
MCP application.create or application.get_info → initialize canonical context → [optional] entity.create_lookup/entity.create/entity.update → application.get_info refresh → [optional] binding.get_columns/binding.create → schemas immediately usable
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

# Creatio Platform Essentials

## Platform Overview

Creatio is a no-code/low-code platform for process management and CRM using a **composable application** architecture where functionality is delivered as packages.

### Key Concepts

**Composable Applications**
- Built from self-contained **packages** containing: entity schemas, page schemas, data bindings, business processes, source code
- Packages can depend on other packages (via `DependsOn` in descriptor.json)
- Deploy via `clio push-pkg` command

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

Generate in this order for referential integrity:

1. **Package descriptor** — root `descriptor.json`
2. **Lookup entities** — extends BaseLookup
3. **Main entities** — with lookup columns
4. **Pages** — List + Form pages
5. **Addons** — Link entities to forms
6. **Data bindings** — SysModule, SysModuleEntity, seed data

---

## Clio CLI Commands

Clio is the command-line tool for Creatio deployments.

### Environment Setup

```bash
# Register environment
clio reg-web-app myenv -u https://mysite.creatio.com -l admin -p pass

# Set active
clio reg-web-app -a myenv

# Verify connection
clio healthcheck myenv
```

### Package Deployment

```bash
# Push package (primary method)
clio push-pkg <path-to-package> -e myenv

# Compile configuration
clio compile-configuration -e myenv

# Restart application
clio restart-web-app myenv

# Check compilation log
clio last-compilation-log -e myenv
```

### Standard Deploy Workflow

```bash
# 1. Verify environment
clio healthcheck -e myenv

# 2. Push package
clio push-pkg "C:\path\to\package" -e myenv

# 3. Compile
clio compile-configuration -e myenv

# 4. Restart
clio restart-web-app myenv

# 5. Verify
clio healthcheck -e myenv

# 6. Check errors (if any)
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

# Install cliogate (for advanced features)
clio install-gate -e myenv
```

---

## Deploy Flow Diagram

```
Generate files → clio push-pkg → compile-configuration → restart-web-app → verify
```

---

## ModifiedOnUtc Format

Use milliseconds since Unix epoch:

```powershell
# PowerShell
[Math]::Floor((Get-Date).ToUniversalTime().Subtract([DateTime]'1970-01-01').TotalMilliseconds)

# Result format
"/Date(1700000000000)/"
```

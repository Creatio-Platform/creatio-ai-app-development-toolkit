# Creatio Platform Overview

## What is Creatio

Creatio is a no-code/low-code platform for process management and CRM. It uses a **composable application** architecture where functionality is delivered as packages that can be installed, extended, and customized.

## Key Concepts

### Composable Applications
- Applications are built from **packages** — self-contained units of functionality
- Each package contains: entity schemas, page schemas, data bindings, business processes, and source code
- Packages can depend on other packages (via `DependsOn` in descriptor.json)
- Deploy via `clio push-pkg` command

### Freedom UI (Angular-based)
- Modern UI framework replacing Classic UI
- Pages are defined as **AMD modules** (JavaScript `define()`)
- UI is described via `viewConfigDiff` — array of operations (merge, insert, remove, move)
- Data binding via `viewModelConfigDiff` and `modelConfigDiff`
- Schema type: `"AngularSchema"`

### Entity Model
- Entities (Objects) define the data model
- Each entity extends a **parent entity** (BaseEntity, BaseLookup, etc.)
- Columns have **DataValueType** (GUID-based) — e.g., ShortText, Lookup, Integer
- Entity schemas use a **DSL diff format** for metadata (not plain JSON)

### Package Structure
```
packages/<PackageName>/
├── descriptor.json          ← package metadata, dependencies
├── Schemas/
│   ├── <EntityName>/        ← entity schema (3 files)
│   ├── <PageName>/          ← page schema (4 files: descriptor + metadata + properties + .js)
│   └── <AddonName>/         ← addon schema (3 files)
├── Data/
│   ├── SysModule_*/         ← section registration
│   ├── SysModuleEntity_*/   ← entity-to-section binding
│   └── <LookupName>/        ← seed data
└── Files/                   ← optional C# code, .csproj
```

### System Tables for Navigation
- **SysModule** — registers a section (app section visible in navigation)
- **SysModuleEntity** — binds an entity to a section
- **SysModuleEdit** — binds a form page to a section
- Without these data bindings, the section won't appear in the app

### Naming Conventions
- Custom entities/schemas use `Usr` prefix: `UsrTodoTask`, `UsrTodoTaskStatus`
- PascalCase for all names
- GUIDs are lowercase: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- Column names: `UsrTitle`, `UsrDescription`, `UsrStatus`

### Deploy Flow
```
Generate package files → clio push-pkg → clio compile-configuration → clio restart-web-app → verify
```

# Composable App Package Structure

## Package descriptor.json

Every package MUST have a `descriptor.json` at the root:

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

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `UId` | ✅ | Unique GUID for the package |
| `PackageVersion` | ✅ | Semantic version (e.g., "1.0.0") |
| `Name` | ✅ | Package name (PascalCase, Usr prefix) |
| `ModifiedOnUtc` | ✅ | Timestamp in `/Date(milliseconds)/` format |
| `Type` | ✅ | Always `1` for custom packages |
| `Maintainer` | ✅ | `"Customer"` for custom packages |
| `DependsOn` | ✅ | Array of package dependencies |

### Typical Dependencies

For a standard Freedom UI app, use an **empty `DependsOn`** array by default:

```json
"DependsOn": []
```

Creatio will resolve package dependencies automatically based on the package hierarchy.

> **⚠️ WARNING**: Dependency UIds are environment-specific. Hardcoding UIds (e.g., for CrtBase, CrtCoreBase, CrtUIv2) may cause "missing dependencies" errors if the target Creatio instance has different UIds. Use empty `DependsOn` as the safe default.
>
> If explicit dependencies are needed, use `clio pull-pkg` on a reference package from the target environment to get the correct UIds.

**Reference dependency packages** (UIds may vary by environment):

| Package | Typical UId | When Needed |
|---------|-----|-------------|
| CrtBase | `e14dcb42-686d-46d5-b59f-a39c15ba4495` | Base package |
| CrtCoreBase | `bba64137-af67-4dae-8053-e4a1a21460a5` | Core functionality |
| CrtUIv2 | `63c5b34e-ace6-4c56-938e-85e433f4a521` | Freedom UI components |

## Complete Package Directory Structure

```
packages/<PackageName>/
├── descriptor.json                    ← package metadata
├── Schemas/
│   ├── UsrTodoTaskStatus/             ← lookup entity
│   │   ├── descriptor.json
│   │   ├── metadata.json
│   │   └── properties.json
│   ├── UsrTodoTask/                   ← main entity
│   │   ├── descriptor.json
│   │   ├── metadata.json
│   │   └── properties.json
│   ├── UsrTodoTask_ListPage/          ← list page
│   │   ├── descriptor.json
│   │   ├── metadata.json
│   │   ├── properties.json
│   │   └── UsrTodoTask_ListPage.js
│   ├── UsrTodoTask_FormPage/          ← form page
│   │   ├── descriptor.json
│   │   ├── metadata.json
│   │   ├── properties.json
│   │   └── UsrTodoTask_FormPage.js
│   └── UsrTodoTask_FormPage_Addon/    ← addon (links entity → form page)
│       ├── descriptor.json
│       ├── metadata.json
│       └── properties.json
├── Data/
│   ├── SysModule_UsrTodoTask/         ← register section in navigation
│   │   ├── descriptor.json
│   │   ├── data.json
│   │   └── filter.json
│   ├── SysModuleEntity_UsrTodoTask/   ← bind entity to section
│   │   ├── descriptor.json
│   │   ├── data.json
│   │   └── filter.json
│   └── UsrTodoTaskStatus_Lookup/      ← seed lookup values
│       ├── descriptor.json
│       ├── data.json
│       └── filter.json
└── Files/                             ← optional
    └── <PackageName>.csproj           ← only if C# code exists
```

## Generation Order

**Critical**: generate in this order to maintain referential integrity:

1. **Package descriptor** — `descriptor.json` at root
2. **Lookup entities** — e.g., UsrTodoTaskStatus (extends BaseLookup)
3. **Main entities** — e.g., UsrTodoTask (with lookup columns referencing step 2)
4. **Pages** — List page + Form page (reference entities from steps 2-3)
5. **Addons** — Link entities to form pages
6. **Data bindings** — SysModule, SysModuleEntity, lookup seed data

## ModifiedOnUtc Format

Use JavaScript Date milliseconds wrapped in `/Date()/`:

```javascript
// PowerShell
[Math]::Floor((Get-Date).ToUniversalTime().Subtract([DateTime]'1970-01-01').TotalMilliseconds)

// JavaScript
Date.now()

// Result format
"/Date(1700000000000)/"
```

## filter.json (Data Bindings)

Most data bindings use an empty filter:

```json
""
```

Or no file at all (it's optional).

# Creatio Naming Conventions

## Prefixes

| Element | Prefix | Example |
|---------|--------|---------|
| Custom entity | `Usr` | `UsrTodoTask` |
| Custom column | `Usr` | `UsrTitle`, `UsrStatus` |
| Custom page | `Usr` | `UsrTodoTask_FormPage` |
| Custom lookup | `Usr` | `UsrTodoTaskStatus` |
| Custom package | `Usr` or company prefix | `UsrTodoListApp` |

## Casing

- **Entity names**: PascalCase — `UsrTodoTask`
- **Column names**: PascalCase — `UsrTitle`, `UsrDueDate`
- **Page names**: PascalCase with underscore separator — `UsrTodoTask_ListPage`, `UsrTodoTask_FormPage`
- **Package names**: PascalCase — `UsrTodoListApp`

## GUIDs

- Format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (lowercase, 36 characters)
- Generate new GUIDs for: packages, schemas, columns, data binding records
- **DO NOT reuse** GUIDs from other packages or reference files
- Use standard tools: `[System.Guid]::NewGuid()` in PowerShell, `crypto.randomUUID()` in JS

## Page Naming Pattern

| Page Type | Pattern | Example |
|-----------|---------|---------|
| List page | `<EntityName>_ListPage` | `UsrTodoTask_ListPage` |
| Form page | `<EntityName>_FormPage` | `UsrTodoTask_FormPage` |

## Data Binding Naming

| Binding Type | Pattern | Example |
|--------------|---------|---------|
| SysModule | `SysModule_<SectionCode>` | `SysModule_UsrTodoTask` |
| SysModuleEntity | `SysModuleEntity_<SectionCode>` | `SysModuleEntity_UsrTodoTask` |
| Lookup seed | `<LookupName>_Lookup` | `UsrTodoTaskStatus_Lookup` |

## Entity Event Process Naming

- Pattern: `Entity_<hash>EventsProcess`
- The `<hash>` is auto-generated, typically 7 hex characters
- Example: `Entity_08c4e12EventsProcess`

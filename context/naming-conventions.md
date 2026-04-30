# Naming Conventions

## Prefixes

| Element | Prefix | Example |
|---------|--------|---------|
| Custom entity | `Usr` | `UsrTodoTask` |
| Custom column | `Usr` | `UsrStatus`, `UsrDueDate` |
| Custom page | `Usr` | `UsrTodoTask_FormPage` |
| Custom package | `Usr` | `UsrTodoListApp` |

## Casing

- Entities and columns use PascalCase
- Pages use PascalCase with underscore suffixes such as `UsrTodoTask_ListPage`
- Packages use PascalCase

## GUIDs

- Format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- Generate new GUIDs for packages, schemas, columns, and data binding records
- Never reuse GUIDs from other packages

## Data Binding Naming

| Type | Pattern | Example |
|------|---------|---------|
| SysModule | `SysModule_<Code>` | `SysModule_UsrTodoTask` |
| SysModuleEntity | `SysModuleEntity_<Code>` | `SysModuleEntity_UsrTodoTask` |

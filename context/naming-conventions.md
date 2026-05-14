# Naming Conventions

## Prefixes

| Element | Example code in Business Plan |
|---------|-------------------------------|
| Custom entity | `TodoTask` |
| Custom column | `Status`, `DueDate` |
| Custom page | `TodoTask_FormPage` |
| Custom package | `TodoListApp` |

> Business Plan codes carry no prefix. clio MCP applies the environment's SchemaNamePrefix
> during implementation — do not add or assume any prefix in the Business Plan.

## Casing

- Entities and columns use PascalCase
- Pages use PascalCase with underscore suffixes such as `TodoTask_ListPage`
- Packages use PascalCase

## GUIDs

- Format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
- Generate new GUIDs for packages, schemas, columns, and data binding records
- Never reuse GUIDs from other packages

## Data Binding Naming

| Type | Pattern | Example |
|------|---------|---------|
| SysModule | `SysModule_<Code>` | `SysModule_TodoTask` |
| SysModuleEntity | `SysModuleEntity_<Code>` | `SysModuleEntity_TodoTask` |

> `<Code>` is the entity schema base name as written in the Business Plan (no prefix).
> clio MCP applies the environment prefix at implementation time.

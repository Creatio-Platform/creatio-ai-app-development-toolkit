# Naming Conventions

## Prefixes

| Element | Prefix | Example (default `Usr`) | Example (custom `Abc`) |
|---------|--------|------------------------|------------------------|
| Custom entity | `{SchemaNamePrefix}` | `UsrTodoTask` | `AbcTodoTask` |
| Custom column | `{SchemaNamePrefix}` | `UsrStatus`, `UsrDueDate` | `AbcStatus`, `AbcDueDate` |
| Custom page | `{SchemaNamePrefix}` | `UsrTodoTask_FormPage` | `AbcTodoTask_FormPage` |
| Custom package | `{SchemaNamePrefix}` | `UsrTodoListApp` | `AbcTodoListApp` |

## Prefix Discovery

The active prefix is the `SchemaNamePrefix` system setting in the target Creatio environment.

**Rules:**
- If `SchemaNamePrefix` has a value → use it as the prefix for every custom schema code.
- If `SchemaNamePrefix` is empty → use **no prefix** (plain PascalCase codes).
- Default Creatio environments use `SchemaNamePrefix = "Usr"`.

**When to discover:**
- If the clio environment name is known before writing the Business Plan (typically provided
  in the initial user request as "Clio env: <name>"), call `get-schema-name-prefix` first.
- Store the result as `{activePrefix}` and substitute it everywhere the prefix appears in
  schema codes throughout the session (Business Plan, implementation, page bindings).
- If the env name is not yet known, or if `get-schema-name-prefix` returns `success: false`,
  use `<Prefix>` as a literal placeholder in schema codes (e.g., `<Prefix>TodoList`). The
  implementation agent resolves it from the `schema-name-prefix` field in the `create-app`
  response.

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

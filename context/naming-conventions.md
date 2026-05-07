# Naming Conventions

## Prefixes

| Element | Prefix | Example (default `Usr`) | Example (custom `Abc`) | Example (empty prefix) |
|---------|--------|------------------------|------------------------|------------------------|
| Custom entity | `{activePrefix}` | `UsrTodoTask` | `AbcTodoTask` | `TodoTask` |
| Custom column | `{activePrefix}` | `UsrStatus`, `UsrDueDate` | `AbcStatus`, `AbcDueDate` | `Status`, `DueDate` |
| Custom page | `{activePrefix}` | `UsrTodoTask_FormPage` | `AbcTodoTask_FormPage` | `TodoTask_FormPage` |
| Custom package | `{activePrefix}` | `UsrTodoListApp` | `AbcTodoListApp` | `TodoListApp` |

## Prefix Discovery

The active prefix is the `SchemaNamePrefix` system setting in the target Creatio environment.

**Rules:**
- If `SchemaNamePrefix` has a value → use it as the prefix for every custom schema code.
- If `SchemaNamePrefix` is empty → use **no prefix** (plain PascalCase codes).
- Default Creatio environments use `SchemaNamePrefix = "Usr"`.

**When to discover:**
- If the clio environment name is known before writing the Business Plan (typically provided
  in the initial user request as "Clio env: <name>"), call `get-schema-name-prefix` with the environment name first.
- Store the result as `{activePrefix}` and substitute it everywhere the prefix appears in
  schema codes throughout the session (Business Plan, implementation, page bindings).
- If the env name is not yet known, or if `get-schema-name-prefix` returns `success: false`,
  use `<Prefix>` as a literal placeholder in schema codes (e.g., `<Prefix>TodoList`). The
  implementation agent resolves it from the `schema-name-prefix` field in the `create-app`
  response (for new apps) or the `get-app-info` response (for existing apps).
  `<Prefix>` means the prefix is not yet determined — it is not a substitute for an empty prefix.

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

> `<Code>` is the full entity schema code including the active prefix. Apply the same prefix rules
> from Prefix Discovery above (e.g., `SysModule_AbcTodoTask` when `{activePrefix} = "Abc"`,
> or `SysModule_TodoTask` when prefix is empty).

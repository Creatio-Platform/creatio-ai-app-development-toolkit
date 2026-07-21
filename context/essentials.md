# Creatio Platform Essentials

> **Scope note for this repository:** This file is platform reference material only. It does not override the gate order in `AGENTS.md`: draft and approve the Business Plan first, then collect runtime inputs, resolve the environment, and execute through clio MCP. Exact tool contracts still come from `get-tool-contract`.

This file contains the high-level platform overview and the local MCP workflow shape. Use the topic-specific files below for naming conventions, package structure, and clio CLI commands. For the executable MCP contract (parameter names, response shapes, error codes), use `get-tool-contract` and the clio MCP guidance resources.

## Companion files

- `context/naming-conventions.md` — `Usr` prefixes, casing, GUIDs, data binding naming.
- `context/clio-cli-reference.md` — CLI commands for environment setup, package management, and development tooling.

## Platform Overview

Creatio is a no-code/low-code platform for process management and CRM where app functionality is delivered through packages.

### Key Concepts

**Creatio Applications**
- Built from self-contained packages containing entity schemas, page schemas, data bindings, business processes, and source code
- Packages can depend on other packages via `DependsOn` in `descriptor.json`

**MCP-Orchestrated Runtime**
- This repo invokes Creatio app generation and mutation through `clio` MCP. Resident tools (`get-tool-contract` index: `resident=true`) are called natively; every other tool is invoked via `clio-run <command>`. Never wrap a resident tool in `clio-run`. `runtime/scripts/mcp_client.py` is the stdio fallback for hosts without native MCP, but it does not change which tools are resident. Both transports must resolve the same `clio` (one config, one registered-environments list) — see `AGENTS.md`, "clio MCP transport preference"
- The executable MCP contract lives in `clio` MCP discovery plus MCP prompts/resources, not in this repo
- The raw application context returned by `create-app` or `get-app-info` is a flat runtime payload whose exact fields and selectors must be read from `get-tool-contract`
- Tool execution evidence (operation log, page evidence, acceptance evidence) is reported inline in the conversation rather than persisted to repo-local files

**MCP Application Creation (DB-first)**
- Resolve current application creation, discovery, refresh, and main-entity semantics through `get-tool-contract` and the `clio` MCP guidance resources
- `create-app` is the canonical new-app entrypoint and may return top-level `dataforge` diagnostics produced internally by `clio`
- Do not add a separate mandatory Data Forge preflight in repo-local orchestration for the standard new-app branch
- Planning-time read-only discovery is still required when the model is ambiguous or strong existing-schema candidates exist; use that discovery to decide `reuse`, `extend`, or `create` before execution
- Schema tools mutate entity schemas directly in Creatio DB, so successful mutations are immediately runtime-accessible without a separate compile or deploy step
- `icon-background` for `create-app` is optional — omit it unless the user explicitly specified a color; the server assigns a random Freedom UI palette color when absent. If provided, the value must be one of the 16 palette colors: `#A6DE00`, `#20A959`, `#22AC14`, `#FFAC07`, `#FF8800`, `#F9307F`, `#FF602E`, `#FF4013`, `#B87CCF`, `#7848EE`, `#247EE5`, `#0058EF`, `#009DE3`, `#4F43C2`, `#08857E`, `#00BFA5`.

**MCP Section Management**
- Use `list-app-sections` to list all sections of an installed application
- Use `delete-app-section` to remove a section from an installed application
- Resolve full tool parameter contract through `get-tool-contract` and `docs://mcp/guides/existing-app-maintenance`
- `delete-entity-schema` on `delete-app-section` is destructive and irreversible; it requires explicit opt-in
- `icon-background` for `create-app-section` is optional — omit it unless the user explicitly specified a color; the server assigns a random Freedom UI palette color when absent. If provided, the value must be one of the same 16 palette colors listed under MCP Application Creation above.

**Entity Schema Sync (DB-first)**
- Prefer `sync-schemas` for grouped entity work
- Use `create-lookup`, `create-entity-schema`, `update-entity-schema`, and `create-data-binding-db` only when the flow cannot stay inside `sync-schemas`
- Create lookup entities before entities or updates that reference them

**Schema Cleanup**
- `delete-schema` removes any schema from Creatio — entity, Freedom UI page, source code, process, DCM, user task, campaign, service, addon, SQL script, data binding, assembly, and more
- Two modes: workspace mode (default) requires the schema to belong to a workspace package; remote mode (`remote: true`) deletes by schema name directly from the environment without a workspace
- This operation is destructive and cannot be undone; confirm the schema name before calling it

**Default Semantics**
- Follow the current `clio` MCP contract and `docs://mcp/guides/app-modeling` for canonical default semantics
- A default requirement stays unresolved until the plan classifies it as schema-side or UI-side behavior
- Lookup seed rows alone do not satisfy a requirement such as `UsrStatus defaults to New`
- For lookup-backed defaults, resolve the concrete executable mechanism through live contract metadata and app-modeling guidance
- Binary-like columns do not support constant defaults

**Data Binding And Schema Inspection**
- `get-entity-schema-properties` returns a deployed schema summary with column metadata
- `get-entity-schema-column-properties` returns detailed metadata for a single deployed column
- `create-data-binding-db` persists bindings in DB and installs data immediately
- `upsert-data-binding-row-db` updates rows only in an already existing binding
- Lookup/enum values are package data: seed them inline via `sync-schemas`'s `seed-rows` when the entity is created in that batch (preferred), or with `create-data-binding-db` when the entity already exists outside the batch — both install immediately and neither needs a compile step
- Never seed lookup values through runtime OData/DataService calls or raw SQL — those bypass the platform, so the row lands in the table but does not surface as real package data

**Freedom UI (Angular-based)**
- Modern UI pages are AMD modules
- UI is described via `viewConfigDiff`
- Schema type is `"AngularSchema"`
- Add fields or columns by editing the `body.js` returned by `get-page` directly without replacing unrelated marker sections
- `update-page` supports `mode: "append"` for additive edits that merge into existing customizations instead of overwriting
- `validate-page` validates a page body client-side without saving to Creatio

**Freedom UI — Mobile Pages**
- **Decide web vs mobile before editing.** A requirement targets web, mobile, or both; if it does not say, default to web (mobile is an explicit opt-in). Web and mobile are SEPARATE schemas (e.g., `<Entity>_FormPage`/`_ListPage` vs `<Entity>_MobileFormPage`/`_MobileListPage`) — for every page it touches, edit each targeted variant; the web page never affects its mobile counterpart. The bullets below apply once on a mobile page.
- Mobile pages have `schema-type: "mobile"` in `get-page` responses; numeric `schemaType` is `10`. In `list-pages` and `get-app-info`, identify mobile pages by naming suffix (`_MobileFormPage` / `_MobileListPage`) or parent template (`MobilePageWithTabsFreedomTemplate`, `BaseMobileListTemplate`)
- Body format is **plain JSON** (not an AMD `define(...)` module) with top-level keys `viewConfigDiff`, `viewModelConfigDiff`, `modelConfigDiff` only
- `handlers`, `validators`, and custom `converters` sections are web/AMD-only — do not include them in mobile page bodies; `update-page` and `sync-pages` actively reject them
- Use `get-component-info` with `schema-type: "mobile"` for mobile component metadata; the mobile component registry is separate from the web registry
- Call `get-guidance mobile-page-modification` before editing any mobile page body — mobile pages have different component registry, body constraints, and Scaffold inheritance rules
- The `get-page → update-page` workflow applies identically to web and mobile pages
- Mobile pages are provisioned automatically by `create-app-section` when the `UseMobilePageDesigner` feature flag is enabled on the target environment; discovery surfaces return no mobile pages when the flag is off

**Page Creation (DB-first)**
- `list-page-templates` discovers valid Freedom UI page templates per environment
- `create-page` creates a new page from a template, assigning it to a package and optionally binding an entity schema
- After creation, use `get-page` to verify and retrieve the initial body for further editing
- Resolve the full page creation workflow through `docs://mcp/guides/page-creation`

**C# Source-Code Schemas**
- `create-schema`, `get-schema`, `update-schema` manage C# source-code schemas directly on a remote Creatio environment
- Use for server-side business logic classes without local workspace file generation

**JS ClientUnit Schemas**
- `create-client-unit-schema`, `get-client-unit-schema`, `update-client-unit-schema` manage JavaScript schemas on a remote environment
- Use for utility/helper JS modules — not for Freedom UI pages (use `create-page` for those)

**SQL Script Schemas**
- `create-sql-schema`, `get-sql-schema`, `update-sql-schema` manage SQL script schemas on a remote environment
- `install-sql-schema` executes a SQL script schema directly on the database — irreversible

**Entity Model**
- Entities extend a server-defined parent discovered through live contract metadata
- Columns use server-defined value-type identifiers
- Schemas use a diff-oriented metadata model

**System Tables For Navigation**
- `SysModule` registers a section
- `SysModuleEntity` binds an entity to a section
- `SysModuleEdit` binds a form page to a section

---

## Local MCP Workflow

```text
Approved Business Plan -> clio MCP call -> source-backed execution evidence -> inline conversation report
```

Local rule:
- Keep execution evidence source-backed and derived from MCP responses.
- Report operation, page, and acceptance evidence inline in the conversation.
- Resolve executable details through `get-tool-contract`; do not persist a separate repo-local runtime document as the source of truth.

---

## ModifiedOnUtc Format

Use milliseconds since Unix epoch in `/Date(milliseconds)/` format.

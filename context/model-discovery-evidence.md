# DataForge Tool Reference

Use this guide for both DataForge entry points:
- Agent 1 checking DataForge availability and reporting the status for the Technical Implementation Handoff.
- Agent 2 running read-only DataForge model discovery during draft assembly to lock `reuse` / `extend` / `create new` Model Decisions in the Business Plan (see `runbooks/02-requirements-gathering.md`, "DataForge Model Discovery"). Discovery calls are read-only `dataforge-*` queries; they must not create, modify, or compile schemas before Gate R.

## DataForge Tool Parameter Contract

Use this table when invoking `dataforge-*` tools through `runtime/scripts/mcp_client.py`.
Parameter names are exact — past sessions burned several minutes on `term` vs `query` and `lookup-name` vs `schema-name` retries.

| Tool | Required params | Optional params | Notes |
|------|-----------------|-----------------|-------|
| `dataforge-status` | `environment-name` | — | Empty body `{}` returns `invalid-request`. Returns `status.status == "Ready"` when usable. |
| `dataforge-context` | `environment-name`, `candidate-terms` (array) | `lookup-hints` (array), `requirement-summary` (string) | **Default first discovery call.** Do **not** pass `schema-name`. Response top-level keys: `similar-tables`, `similar-lookups`. May return 50–80 KB; parse with Python via `call_mcp_tool`, never PowerShell `ConvertFrom-Json`. |
| `dataforge-find-tables` | `environment-name`, `query` (non-empty string) | — | `query` (not `term`, not `name`). Empty string is rejected. Response: `similar-tables[]`. Fallback only — use `dataforge-context` first. |
| `dataforge-find-lookups` | `environment-name`, `query` (non-empty string) | `schema-name` (filter by lookup) | `schema-name` (not `lookup-name`). `query` is required and must be non-empty (use a single letter such as `"a"` if you only want to scope by `schema-name`). Response: `similar-lookups[]`. |
| `dataforge-get-table-columns` | `environment-name`, `table-name` | — | Schema-level confirmation. Response: `columns[]` with `name`, `caption`. |
| `dataforge-get-relations` | `environment-name`, `table-name` | — | Schema-level confirmation. Response: relation list. |

### Anti-pattern: `find-lookups` is not a "list rows of a known lookup" tool

`dataforge-find-lookups` searches **lookup display values across the catalog** for a query string.
It is **not** the right tool to enumerate the rows of a single lookup whose schema name you already know:
passing `{schema-name: "<UsrSomeLookup>", query: "a"}` returns matches against lookup *values* containing "a", not the full row set.

To verify or list the rows of a known lookup, do one of:
- include the lookup name in `lookup-hints` of the next `dataforge-context` call;
- call `dataforge-get-table-columns` on the lookup table to confirm structure, then trust seeded values;
- query the lookup rows directly via the schema-level tools after locking the Model Decision.

## DataForge Response Field Reference

When iterating `dataforge-find-lookups` results, use the correct field names:

| Field in response | Meaning |
|-------------------|---------|
| `similar-lookups[].schema-name` | Lookup entity name (not `"name"`) |
| `similar-lookups[].value` | Row display value (not `"caption"`) |
| `similar-lookups[].score` | Relevance score (lower = more relevant in some versions) |

When iterating `dataforge-find-tables` / `dataforge-context` similar-tables:

| Field | Meaning |
|-------|---------|
| `similar-tables[].name` | Entity schema name |
| `similar-tables[].caption` | Human-readable table caption |
| `similar-tables[].description` | AI-generated semantic description |

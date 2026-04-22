---
name: page-schema-editing
description: Edit Freedom UI page schemas by modifying the full JS body directly and persisting changes through the clio-advertised runtime sync-pages flow.
compatibility: Requires clio MCP with `list-pages`, `get-page`, `sync-pages`, and `get-component-info` available. `update-page` is fallback-only.
metadata:
  version: "3.0"
  category: creatio-schema-generation
---

# Page Schema Editing

Use this skill when the task is to change a deployed Freedom UI page body.

This skill is not an MCP API reference.
Resolve exact tool names, parameters, aliases, defaults, response shapes, and errors through `get-tool-contract`.

## Runtime Flow Used By This Repo

Precondition for data-backed details:

- Before the page runtime flow starts, resolve the backing schema from current app context rather than from requirement wording alone.
- Inspect `get-app-info` first, then `list-pages` and `get-page`, and use `get-entity-schema-properties` when the backing schema or relation is still unclear.
- If the target package already contains a supporting or link schema for the requested detail, reuse it. Do not initiate schema creation from the page-editing flow unless the inspect phase proves a real object-model gap.
- Absence of a tab, detail, or grid on the page does not mean the backing entity is missing.

1. `list-pages`
2. `get-page` — writes `body.js`, `bundle.json`, `meta.json` to `.clio-pages/{schema-name}/`
3. read `files.bodyFile`, edit body
4. `sync-pages`
5. `get-page` verification

This repo follows the clio-advertised canonical page flow above and keeps `update-page` only as an explicit fallback for single-page dry-run or legacy save workflows.

## Required Context

Read before executing:

- `context/handlers-reference.md`
- `context/devkit-common-reference.md`
- `context/ui-reference.md`
- `context/viewconfig-reference.md`

## Working Rules

- `get-page` writes three files to `.clio-pages/{schema-name}/`: `body.js` (editable body), `bundle.json` (merged hierarchy), `meta.json` (page metadata). Read the body from `files.bodyFile` — do not use inline `raw.body`.
- Treat `files.metaFile` / the `page` block from `get-page` as metadata only.
- For detail/grid requests, treat the current object model as the source of truth for the backing schema. Do not infer a new schema name from a business caption when runtime context already exposes an existing technical code.
- If `bundle.json` (at `files.bundleFile`) contains an unfamiliar `crt.*` component type, inspect it with `get-component-info` as part of the clio-guided page workflow before editing nested configuration.
- If the edited body introduces new localizable captions, persist them through the live page write contract resolved at runtime.
- Keep repository docs for workflow and page-editing policy only. Do not copy MCP parameter tables into plans or prompts.

## Schema Body Format

Freedom UI page bodies are AMD modules with marker-delimited sections:

```javascript
define("SchemaName", /**SCHEMA_DEPS*/["@creatio-devkit/common"]/**SCHEMA_DEPS*/, function/**SCHEMA_ARGS*/(sdk)/**SCHEMA_ARGS*/ {
return {
  viewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[...]/**SCHEMA_VIEW_CONFIG_DIFF*/,
  viewModelConfigDiff: /**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/[...]/**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/,
  modelConfigDiff: /**SCHEMA_MODEL_CONFIG_DIFF*/[...]/**SCHEMA_MODEL_CONFIG_DIFF*/,
  handlers: /**SCHEMA_HANDLERS*/[...]/**SCHEMA_HANDLERS*/,
  converters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/,
  validators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/
};
});
```

Preserve all marker pairs and the outer module structure.

## Safe Editing Algorithm

1. Extract only the content inside the target marker pair.
2. Detect whether the section is object-based or diff-array-based.
3. Parse the marker content as structured data with trailing-comma tolerance.
4. Modify the parsed structure.
5. Serialize the structure back to JSON text.
6. Replace only the marker content.
7. Re-parse every modified section before saving.

Use `scripts/page_body_edit.py` or `scripts/page_body_tools.py` for marker-safe manipulation.
Do not splice raw strings into page bodies.

## FormPage Field Sync

Use this when the main entity gained new columns and the live FormPage must surface them.

1. Read the current page with `get-page`.
2. Parse `SCHEMA_VIEW_CONFIG_DIFF` and `SCHEMA_VIEW_MODEL_CONFIG_DIFF`.
3. Discover the primary field container from the live page by finding the container with the most existing field inserts.
4. Append only missing fields to that discovered container.
5. Continue `row` and `index` from the current maximum values.
6. Add a matching view-model attribute for every inserted field.
7. Preserve the live page naming pattern and existing bindings.
8. For datasource-bound lookup fields, add only the main bound attribute unless the live page already persists extra lookup-list bindings.

## ListPage Grid Sync

Use this when the ListPage must surface new main-entity columns.

1. Read the current page with `get-page`.
2. Inspect the live DataGrid and preserve existing columns and order.
3. Resolve the target columns from the explicit plan first, then from repository default policy in `context/ui-reference.md`.
4. Append only missing columns.
5. Preserve the live `items` binding and the collection path unless requirements explicitly change them.
6. Verify the final grid through a post-save `get-page`.

## ListPage Sorting

Use the canonical sorting policy from `context/ui-reference.md`.
Sorting is driven by the collection attribute and its `sortingConfig`, not by ad hoc DataGrid node edits.
Do not reuse FormPage lookup-list sorting patterns for ListPage row sorting.

## Save Workflow

Preferred path:

Persist the edited page through `sync-pages` using the runtime options resolved from live contract metadata.

Fallback path:

Run a single-page `update-page` dry-run, then save, then verify through `get-page`.

## Critical Rules

1. Always call `get-page` before editing.
2. Preserve all marker pairs.
3. Preserve the `define(...)` wrapper and page module structure.
4. Every new field insert must have a matching view-model attribute.
5. Preserve existing live bindings instead of regenerating them under new names.
6. Do not invent datasource-bound lookup `*_List` attributes on pages that did not already materialize them.
7. Use `request.$context.executeRequest(...)` for secondary programmatic requests.
8. Use `setValue(...)` or `setAttributePropertyValue(...)` for runtime attribute state changes.
9. Do not switch to standalone TypeScript `@CrtRequestHandler` classes when the task is to edit the deployed page body.
10. Treat `converters` and `validators` conservatively; only edit them when live schema evidence requires it.
11. Keep `update-page` as fallback-only. Do not document it as the primary write path.

## Validation Checklist

Before save:

- `get-page` already ran for the target page.
- Every modified marker section re-parses successfully.
- All delimiters remain balanced.
- Every inserted UI field has a matching binding.
- Every inserted field `label` is `"$Resources.Strings.<key>"` or `"#ResourceString(<key>)#"`. Hardcoded plain strings like `"label": "Status"` must be rejected.
- For every `"$Resources.Strings.<key>"`, the `<key>` equals the attribute key from `control` (strip the leading `$`). Mismatched keys render blank silently.
- Every newly used `$Resources.Strings.<key>` is included in the `resources` param passed to `sync-pages` (flat JSON map, e.g. `{"PDS_UsrStatus": "Status"}`). Entity column captions are not auto-registered during `sync-pages`.
- The discovered primary field container is used for FormPage inserts.
- ListPage column changes preserve existing columns and order unless requirements say otherwise.

After save:

- `sync-pages` returned success for the page, or the fallback path completed successfully.
- Post-save `get-page` confirms the required fields or columns are present.
- Page evidence can be marked `implemented` and `machineChecked`.

## Minimal Example

```text
1. Discover the target page through `list-pages`
2. Read the live page through `get-page`
3. read `files.bodyFile`, edit with marker-safe utilities
4. Persist through `sync-pages`
5. Re-read through `get-page` when helper-level verification still needs the live body
```

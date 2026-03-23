---
name: page-schema-editing
description: Edit Freedom UI page schemas by modifying the full JS body directly. Agent gets the raw body, makes changes, and sends it back to MCP for saving.
compatibility: Requires running Creatio MCP endpoint with `page.get`, `page.update`, and `page.list` available.
metadata:
  version: "2.0"
  category: creatio-schema-generation
---

# Page Schema Editing

Edit Freedom UI page schemas by working with the complete JS body. The agent reads the raw body, modifies it directly, and sends the full updated body back to MCP for validation and saving.

## Required Context

Read before executing:
- `context/handlers-reference.md` — handler patterns, request types, deps correlation
- `context/devkit-common-reference.md` — exhaustive `@creatio-devkit/common` public API surface for `sdk.*` imports
- `context/ui-reference.md` — page structure, control types, section markers
- `context/viewconfig-reference.md` — viewConfigDiff components (buttons, containers, property values)

## MCP Tools Reference

### `page.list` — Discover Pages

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `searchPattern` | string | No | Filter by schema name (case-insensitive contains) |
| `packageName` | string | No | Filter by exact package name |
| `limit` | string | No | Max results (default: `"25"`) |

**All parameters are strings.**

### `page.get` — Read Page

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `schemaName` | string | **Yes** | Exact page schema name |

Response:
```json
{
  "success": true,
  "schemaName": "UsrMyApp_FormPage",
  "schemaUId": "...",
  "packageName": "UsrMyApp",
  "parentSchemaName": "PageWithTabsFreedomTemplate",
  "body": "define(\"UsrMyApp_FormPage\", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, ...full JS body...)"
}
```

### `page.update` — Save Complete Body

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `schemaName` | string | **Yes** | Page schema name |
| `body` | string | **Yes** | Complete JS body with all 8 marker pairs |
| `dryRun` | boolean | No | `True` to validate without saving |

Response (success):
```json
{
  "success": true,
  "schemaName": "UsrMyApp_FormPage",
  "bodyLength": 3456,
  "dryRun": false
}
```

## Schema Body Format

The body is a JS `define(...)` call containing 8 marker-delimited sections:

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

### Marker Format

Each section is delimited by a pair of markers: `/**MARKER_NAME*/content/**MARKER_NAME*/`

The 8 markers and their content shapes:

| Marker | Section | Shape |
|--------|---------|-------|
| `SCHEMA_DEPS` | deps | Array `[...]` |
| `SCHEMA_ARGS` | args | Parenthesized `(...)` |
| `SCHEMA_VIEW_CONFIG_DIFF` | viewConfigDiff | Array `[...]` |
| `SCHEMA_VIEW_MODEL_CONFIG_DIFF` | viewModelConfigDiff | Array `[...]` |
| `SCHEMA_MODEL_CONFIG_DIFF` | modelConfigDiff | Array `[...]` |
| `SCHEMA_HANDLERS` | handlers | Array `[...]` |
| `SCHEMA_CONVERTERS` | converters | Object `{...}` |
| `SCHEMA_VALIDATORS` | validators | Object `{...}` |

Notes:

- `handlers` is an array section; append or edit individual handler entries without replacing unrelated ones.
- `converters` and `validators` are object sections; preserve existing keys and edit them conservatively.
- For new page logic, prefer handlers, business rules, and attribute-property APIs unless the live page already provides concrete `converters` or `validators` usage to extend.

## Workflow

### Step 1: Discover Pages

```
page.list(searchPattern: "TestApp1")
```

### Step 2: Read Current Body

**Always read before editing.** Never construct a body from scratch.

```
page.get(schemaName: "TestApp1_ListPage")
```

### Step 3: Modify the Body

**Use marker-based section extraction and structured JSON modification.** The utility `scripts/page_body_edit.py` implements this algorithm. For standard field/column additions, prefer the utility over manual editing.

**Safe Editing Algorithm:**

1. **Extract** — locate the marker pair `/**MARKER*/.../**MARKER*/` and extract only the content between them
2. **Detect variant** — determine whether the section is `viewModelConfig` (plain object `{}`) or `viewModelConfigDiff` (array `[]` of merge operations); same for `modelConfig`/`modelConfigDiff`
3. **Parse** — deserialize the extracted content as JSON with trailing-comma tolerance (strip `,` before `]` and `}`)
4. **Modify** — apply changes to the parsed data structure (append to arrays, merge into objects)
5. **Serialize** — convert back to formatted JSON string with proper indentation
6. **Replace** — substitute the content between markers with the serialized result
7. **Validate** — re-extract and re-parse each modified section to confirm structural integrity before calling `page-update`

**Anti-patterns (MUST NOT):**

- ❌ Never use `body.find("}")` or brace-counting to locate insertion points — nested JS structures make positional brace search unreliable
- ❌ Never insert raw JSON strings into the body without parsing the target section first — splicing text into unparsed JSON causes structural corruption (fields land inside wrong objects, attributes escape their parent container)
- ❌ Never assume the viewModelConfig section type — always detect whether it is `viewModelConfig` (object) or `viewModelConfigDiff` (array); FormPage typically uses the object variant, ListPage uses the array variant
- ❌ Never verify edits by substring search alone (e.g., `"UsrStatus" in body`) — a field name can appear in a structurally broken body; always re-parse each edited section as JSON to confirm integrity
- ❌ Never insert content at a position found by counting closing braces from an anchor string — the correct anchor is the marker boundary, not a brace position

**FormPage vs ListPage structural differences:**

| Aspect | FormPage | ListPage |
|--------|----------|----------|
| viewModel section | `viewModelConfig` — plain object with `attributes: {}` | `viewModelConfigDiff` — array of merge operations with `path` and `values` |
| model section | `modelConfig` — plain object | `modelConfigDiff` — array of merge operations |
| Adding attributes | Merge into `attributes` object directly | Merge into the operation's `values` object where `path` contains `"attributes"` |
| Field container | `SideAreaProfileContainer` with `insert` operations | `DataTable` merge with `columns` array |

### Step 3a: Sync New Entity Fields into a Live FormPage

Use this workflow when the entity gained new columns and the live FormPage must surface them:

1. Parse both `SCHEMA_VIEW_CONFIG_DIFF` and `SCHEMA_VIEW_MODEL_CONFIG_DIFF`
2. Collect existing `insert` operations where:
   - `parentName == "SideAreaProfileContainer"`
   - `propertyName == "items"`
3. Find the current maximum `row` and `index` values in `SideAreaProfileContainer`
4. For each missing entity field:
   - choose the control recipe from `context/viewconfig-reference.md`
   - append a new `insert` to `SideAreaProfileContainer`
   - continue `row` and `index` from the current maximum values
   - keep the live page naming pattern for the field attribute key
   - add a matching attribute to `SCHEMA_VIEW_MODEL_CONFIG_DIFF`
   - keep raw config minimal for preprocessor-backed controls unless the current page body already contains explicit richer config
5. Preserve existing inserts and bindings — append only missing fields
6. Keep `Name` as a special case when it already exists in the page body

Special cases from live schema:
- Lookup fields need:
  - the main `crt.ComboBox` insert
  - the main bound attribute in `SCHEMA_VIEW_MODEL_CONFIG_DIFF`
  - preservation of any existing live `*_List` bindings or nested actions without synthesizing new ones
- `crt.ImageInput` binds through `value`, not `control`
- Most other field controls bind through `control`
- Match `crt.DateTimePicker.pickerType` to the field kind when the column is date-only or time-only
- Add `crt.NumberInput.format.decimalPrecision` when numeric scale is known
- `crt.PhoneInput`, `crt.EmailInput`, `crt.WebInput`, `crt.ComboBox`, and `crt.ImageInput` are preprocessor-backed; avoid hand-writing auto-generated request wiring unless the page body already persists it

Guardrails for FormPage lookup sync:
- If a new `crt.ComboBox` is bound to an entity datasource through the main attribute, do not add a sibling `*_List` attribute.
- If the live page already has a materialized `*_List`, preserve its naming and config, but do not synthesize a new one.
- Invalid: `UsrStatus_List.modelConfig.path = "UsrStatus_List"`.
- Invalid: introducing `UsrPriority_List` next to `UsrPriority -> PDS.UsrPriority` on a page that did not already persist that list attribute.

### Step 3b: Adjust ListPage Sorting

Use this workflow when the task is to change default row sorting on a live ListPage:

1. Read the canonical section `ListPage DataGrid Sorting via page.update` in `context/ui-reference.md`
2. Parse the live `SCHEMA_VIEW_MODEL_CONFIG_DIFF` and identify the DataGrid collection attribute bound through the grid `items` property
3. Inspect that collection attribute's `modelConfig.sortingConfig`
4. Keep the live data-source binding path such as `PDS` unless the task explicitly changes the data source
5. Use entity column names in sort options such as `CreatedOn` or `UsrDueDate`
6. Add or update `sortingConfig.default` when the requirement is plain column ordering
7. Preserve an explicit sibling sorting attribute only when the live page body already materializes it or the task requires deterministic raw-body output
8. Run `page.update(..., dryRun: True)` before save

Do not reuse FormPage lookup `*_List` sorting as the pattern for ListPage DataGrid row sorting. If the requested order is semantic or business-specific rather than plain column ordering, stop and treat it as a blocker unless there is an explicit technical sort key or separate runtime logic in scope.

### Step 4: Validate with Dry Run

```
page.update(
  schemaName: "TestApp1_ListPage",
  body: "...full modified body...",
  dryRun: True
)
```

Check `success: true` before saving.

### Step 5: Save

```
page.update(
  schemaName: "TestApp1_ListPage",
  body: "...full modified body..."
)
```

## Critical Rules

1. **Always read first** — use `page.get` before any edit
2. **Preserve all 8 marker pairs** — MCP validates their presence; missing markers = rejection
3. **Preserve structure outside markers** — don't modify `define(...)` wrapper, `return {`, or `};`
4. **Balance all delimiters** — `[]`, `{}`, `()` must be balanced within each section
5. **By default, call `await next?.handle(request)`** to preserve the request chain, but omit it intentionally when canceling or overriding the default flow
6. **Prefix entity columns with `PDS_`** (e.g., `PDS_UsrName`, `PDS_UsrStatus`)
7. **Deps ↔ handlers correlation** — if handler uses SDK services, ensure deps and args include the required import and preserve the live alias style (`sdk`, `devkit`, etc.)
8. **For runtime entity-field sync, use `SideAreaProfileContainer`** when the live page already follows that pattern
9. **Every new field insert needs a matching `SCHEMA_VIEW_MODEL_CONFIG_DIFF` attribute**
10. **For datasource-bound FormPage ComboBox fields, add only the main bound attribute unless the live schema already materializes extra lookup-list bindings**
11. **Do not manually duplicate frontend-generated ComboBox/ImageInput request wiring unless the live schema already stores it explicitly**
12. **Use `request.$context.executeRequest(...)` for secondary programmatic requests and `setValue(...)` / `setAttributePropertyValue(...)` for runtime attribute state changes**
13. **Do not switch to standalone TypeScript `@CrtRequestHandler` classes when the task is to edit the deployed page body via `page.update`**
14. **Treat `converters` and `validators` as conservative object sections, not the default place for new validation logic without live schema evidence**
15. **For ListPage sorting, use the canonical contract in `context/ui-reference.md` and do not infer business order from lookup sorting direction**
16. **Treat any newly introduced FormPage attribute ending with `_List` as a blocker unless the live page already contained it before editing**

## Validation Checklist

### Pre-edit
- [ ] `page.get` called before edit
- [ ] Section variant detected (`viewModelConfig` vs `viewModelConfigDiff`)

### Structural integrity (before calling page-update)
- [ ] All 8 `/**MARKER*/.../**MARKER*/` pairs present in modified body
- [ ] `SCHEMA_VIEW_CONFIG_DIFF` content parses as a valid JSON array
- [ ] viewModelConfig(Diff) content parses as valid JSON (object or array depending on variant)
- [ ] modelConfig(Diff) content parses as valid JSON (object or array depending on variant)
- [ ] `define(...)` wrapper and `return {` structure preserved
- [ ] Every `insert` operation in viewConfigDiff has: `name`, `values`, `parentName`, `propertyName`, `index`
- [ ] Every field using `control: "$X"` has a matching attribute `X` in viewModelConfig(Diff)
- [ ] For FormPage: insert operations targeting `SideAreaProfileContainer` have monotonically increasing `row` values
- [ ] For ListPage: `DataTable` merge contains all required column codes

### Content correctness
- [ ] Handler uses correct request type for business intent
- [ ] Each handler either preserves the chain intentionally, stops it intentionally, or documents cleanup via `finally`
- [ ] Entity attributes prefixed with `PDS_`
- [ ] Every inserted field has a matching `SCHEMA_VIEW_MODEL_CONFIG_DIFF` attribute
- [ ] Runtime FormPage field sync appends to `SideAreaProfileContainer`
- [ ] Datasource-bound FormPage ComboBox fields do not introduce new `*_List` bindings unless the live page already persisted them
- [ ] Existing live lookup-list bindings or nested actions are preserved instead of regenerated or renamed
- [ ] ListPage sorting changes follow the canonical `context/ui-reference.md` contract instead of FormPage lookup-list patterns
- [ ] Numeric/date controls keep scale and picker-type metadata when the column type requires it
- [ ] Preprocessor-backed controls are not bloated with duplicate auto-generated wiring
- [ ] Programmatic follow-up requests use `request.$context.executeRequest(...)` when needed
- [ ] Dynamic validation and UI state updates use `setValue(...)` or `setAttributePropertyValue(...)` when appropriate
- [ ] `converters` and `validators` were only edited when the live schema already used them or the task provided concrete evidence
- [ ] Deps and args were updated if handlers use external modules, and the live SDK alias style was preserved
- [ ] `dryRun: True` passed first to validate
- [ ] `success: true` confirmed after save

## Example: Add Handler + Update Deps in One Operation

```
1. page.get(schemaName: "TestApp1_ListPage")
   → get body

2. Modify body:
   - Replace /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/
     with    /**SCHEMA_DEPS*/["@creatio-devkit/common"]/**SCHEMA_DEPS*/
   - Replace /**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/
     with    /**SCHEMA_ARGS*/(sdk)/**SCHEMA_ARGS*/
   - Replace /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/
     with    /**SCHEMA_HANDLERS*/[{ request: "crt.HandleViewModelInitRequest", handler: async (request, next) => { await next?.handle(request); console.log("Welcome!"); } }]/**SCHEMA_HANDLERS*/

3. page.update(schemaName: "TestApp1_ListPage", body: "...modified body...", dryRun: True)
   → success: true

4. page.update(schemaName: "TestApp1_ListPage", body: "...modified body...")
   → saved to DB + decorated file written to disk + browser notified
```

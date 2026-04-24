# Freedom UI Reference

## Page JS Structure

Every Freedom UI page is a JavaScript AMD module with 6 main sections:

```javascript
define("UsrTodoTask_ListPage", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, function/**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/ {
	return {
		viewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[]/**SCHEMA_VIEW_CONFIG_DIFF*/,
		viewModelConfigDiff: /**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/[]/**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/,
		modelConfigDiff: /**SCHEMA_MODEL_CONFIG_DIFF*/[]/**SCHEMA_MODEL_CONFIG_DIFF*/,
		handlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
		converters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/,
		validators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/
	};
});
```

---

## viewConfigDiff Operations

Array of operations that modify the parent page template:

| Operation | Description |
|-----------|-------------|
| `merge` | Modify existing element properties |
| `insert` | Add new element |
| `remove` | Remove existing element |
| `move` | Move element to different parent |

### Insert Operation Example

```json
{
	"operation": "insert",
	"name": "Name",
	"values": {
		"layoutConfig": {"column": 1, "colSpan": 1, "row": 1, "rowSpan": 1},
		"type": "crt.Input",
		"label": "$Resources.Strings.Name",
		"control": "$Name",
		"labelPosition": "auto"
	},
	"parentName": "<primary-field-container>",
	"propertyName": "items",
	"index": 0
}
```

> In the examples above and below, `<primary-field-container>` is a placeholder. Replace it with the actual container name discovered from the live page's `viewConfigDiff`.

## Control Types

| DataValueType | Control Type | Type String |
|---------------|-------------|-------------|
| ShortText, MediumText, LongText | Input | `crt.Input` |
| PhoneNumber | PhoneInput | `crt.PhoneInput` |
| Email | EmailInput | `crt.EmailInput` |
| WebLink | WebInput | `crt.WebInput` |
| MaxSizeText, RichText | RichTextEditor | `crt.RichTextEditor` |
| Integer, Float, Money | NumberInput | `crt.NumberInput` |
| Boolean | Checkbox | `crt.Checkbox` |
| DateTime, Date, Time | DateTimePicker | `crt.DateTimePicker` |
| Lookup | ComboBox | `crt.ComboBox` |
| Blob, File | FileInput | `crt.FileInput` |
| Image, ImageLookup | ImageInput | `crt.ImageInput` |
| Color | ColorPicker | `crt.ColorPicker` |
| SecureText | EncryptedInput | `crt.EncryptedInput` |
| Integer, Float, Money (alternate UI) | Slider | `crt.Slider` |

---

## Frontend-backed Component Notes

The frontend runtime adds a few important rules that are not obvious from raw page examples alone:

- `crt.NumberInput` supports `format.decimalPrecision`; use it when the numeric column scale is known.
- `crt.DateTimePicker` supports `pickerType`, `useSeconds`, `startView`, `mode`, and `timeInterval`. Match `pickerType` to the real field kind (`date`, `time`, or `datetime`).
- `crt.PhoneInput`, `crt.EmailInput`, and `crt.WebInput` are backed by preprocessors that can promote a bound text input to a more specific control based on the underlying data value type.
- Resolve schema-side field-type semantics through `get-tool-contract` and `docs://mcp/guides/app-modeling`; this file is only about page control behavior.
- `crt.ComboBox` is also preprocessor-backed: it can auto-build lookup loading requests, pagination wiring, and lookup list attributes from the main binding.
- `crt.ImageInput` is preprocessor-backed: the frontend can auto-add `bindTo`, `value | crt.ToImageLink`, `imageSelected`, and `imageClear`.
- `crt.Toggle` exists in the frontend control enum, but the located implementation is mobile-specific. Do not use it as a default web FormPage field control without page-specific evidence.

When editing raw page bodies through the canonical runtime sync-pages flow, prefer minimal explicit config plus correct bindings, and only add preprocessor-generated properties manually when the current page body already stores them explicitly or when the scenario requires deterministic raw-body output. If `get-page` returns unfamiliar `crt.*` types in `bundle.viewConfig`, inspect them first with `get-component-info`.

---

## List Page: DataTable Configuration

> **⚠️ Trailing commas:** Creatio template-generated pages contain trailing commas in JSON arrays (valid JS, invalid strict JSON). Always use `page_body_tools.parse_marker_json()` to parse marker content — never raw `json.loads()` or `str.replace()` insertion. Appending after a trailing comma produces double-comma `},,{` corruption.

Configure visible columns in the DataTable:

```json
{
	"operation": "insert",
	"name": "DataTable",
	"values": {
		"type": "crt.DataGrid",
		"items": "$DataTable_Items",
		"primaryColumnName": "PDS_Id",
		"columns": [
			{
				"id": "f252f582-...",
				"code": "PDS_Name",
				"path": "Name",
				"caption": "#ResourceString(PDS_Name)#",
				"dataValueType": 1
			},
			{
				"id": "a7b2c3d4-...",
				"code": "PDS_UsrStatus",
				"path": "UsrStatus",
				"caption": "#ResourceString(PDS_UsrStatus)#",
				"dataValueType": 10,
				"referenceSchemaName": "UsrTodoTaskStatus"
			}
		]
	}
}
```

**Column fields:**
- `id` — unique GUID
- `code` — `PDS_<ColumnName>`
- `path` — entity column name
- `caption` — always `#ResourceString(<key>)#`; never a hardcoded plain string. For DataGrid columns bound to an entity column, use the **data-source-resolved** form `#ResourceString(PDS_<Column>)#` (e.g. `#ResourceString(PDS_UsrStatus)#`) — the platform pulls the caption from the entity column automatically, no `resources` param needed. This is a DIFFERENT case from custom non-field UI elements (tabs, buttons, standalone `crt.Label`), which use `#ResourceString(<itemName>_caption)#` and DO require a matching `resources` entry — see "Non-Field Element Captions" in `context/viewconfig-reference.md`.
- `dataValueType` — numeric ID (see schema-reference.md)
- `referenceSchemaName` — only for Lookup columns

### Default ListPage Column Selection for New Apps

Use this policy when a new app is generated or the main section entity gains approved business fields and the requirements do not provide a complete explicit ListPage column list.

- Start from the explicit ListPage columns from the requirements if they exist.
- Always include `Name`.
- Always include every required non-inherited business field from the main entity.
- Then append only short operational fields in this priority order until the default grid stays compact: status/lifecycle, priority/severity, type/category, due/start/end date, owner/assignee, code/number, amount.
- Keep auto-selected default ListPage columns compact by capping them at 6 total visible columns unless required business fields exceed that number.
- Exclude inherited audit/system fields unless explicitly requested.
- Exclude long/rich/blob fields unless explicitly requested or required.
- If the requirements are partial, keep the explicit columns and fill only the missing columns with this default policy.
- When editing a live page, preserve existing DataGrid columns and order. Append only the missing resolved columns unless the requirements explicitly demand reordering.

### ListPage DataGrid Sorting for Runtime Page Sync

This section is the canonical source of truth for default row sorting on a Freedom UI ListPage edited through the runtime sync-pages flow.

The runtime contract is centered on the DataGrid collection attribute, not on the visual `sorting` property stored inside the DataGrid node:

- The DataGrid `items` binding points to a collection attribute such as `Items`.
- The actual collection attribute name comes from the live DataGrid `items` binding and is not always literally `Items`.
- That collection attribute remains bound to the primary data source through `Items.modelConfig.path = "PDS"`.
- `Items.modelConfig.sortingConfig.attributeName` points to a sibling sorting attribute such as `ItemsSorting`.
- The sorting attribute stores an array of sort options.
- Each sort option uses entity column names, not attribute keys.
- Valid sort option shape:

```json
{
	"columnName": "CreatedOn",
	"direction": "desc",
	"visible": true
}
```

- `columnName` must be the entity column name such as `CreatedOn`, `Name`, or `UsrDueDate`.
- `direction` supports only `asc`, `desc`, and `none`.
- `visible` is optional.
- `sortingConfig.default` is a valid way to define default data-source sorting for the ListPage collection.

The frontend preprocessor can auto-inject DataGrid view properties from this metadata:

- `viewConfig.sorting`
- `viewConfig.sortingChange`

When editing raw page bodies through the runtime sync-pages flow, treat the `viewModelConfig` sorting contract as canonical. Do not rely on manually inserting `sorting` or `sortingChange` into the DataGrid unless the live page body already persists that explicit behavior and you need to preserve it.

#### Minimal Safe Example

Use this pattern when you need deterministic default sorting and the live page does not already store an explicit sorting attribute change block.

```json
[
	{
		"operation": "merge",
		"path": ["attributes"],
		"values": {
			"Items": {
				"isCollection": true,
				"modelConfig": {
					"path": "PDS",
					"pagingConfig": {
						"rowCount": 30
					},
					"sortingConfig": {
						"attributeName": "ItemsSorting",
						"default": [
							{
								"columnName": "CreatedOn",
								"direction": "desc"
							}
						]
					}
				}
			},
			"ItemsSorting": {}
		}
	}
]
```

#### Expanded Example with Explicit Sorting Attribute Behavior

Use this pattern when the live page body already materializes a sibling sorting attribute and its reload behavior, and the edit must preserve that explicit shape.

```json
[
	{
		"operation": "merge",
		"path": ["attributes"],
		"values": {
			"Items": {
				"isCollection": true,
				"viewModelConfig": {
					"attributes": {
						"PDS_Id": {
							"modelConfig": {
								"path": "PDS.Id"
							}
						},
						"PDS_Name": {
							"modelConfig": {
								"path": "PDS.Name"
							}
						},
						"PDS_UsrDueDate": {
							"modelConfig": {
								"path": "PDS.UsrDueDate"
							}
						}
					}
				},
				"modelConfig": {
					"path": "PDS",
					"pagingConfig": {
						"rowCount": 30
					},
					"sortingConfig": {
						"attributeName": "ItemsSorting",
						"default": [
							{
								"columnName": "UsrDueDate",
								"direction": "asc"
							},
							{
								"columnName": "CreatedOn",
								"direction": "desc"
							}
						]
					}
				}
			},
			"ItemsSorting": {
				"change": {
					"request": "crt.LoadDataRequest",
					"params": {
						"dataSourceName": "PDS",
						"parameters": [],
						"config": {
							"loadType": "reload"
						}
					}
				}
			}
		}
	}
]
```

#### Anti-patterns

- Do not reuse FormPage lookup `*_List` sorting examples as the recipe for ListPage DataGrid row sorting.
- Do not assume sorting by a lookup column guarantees business lifecycle order.
- Do not change `Items.modelConfig.path` or paging config unless the task explicitly requires a data-source change.
- Do not put attribute keys such as `PDS_UsrDueDate` into `columnName`; use the entity column name `UsrDueDate`.
- Do not treat a manually added DataGrid `sorting` property as the primary source of truth when the collection metadata already defines sorting.

#### Limitations

- Plain sortable-column ordering such as `CreatedOn desc` or `UsrDueDate asc` is supported by this contract.
- Semantic order such as "Open first, Done last" is not considered implemented by plain sorting config unless the schema exposes an explicit sortable rank or the page adds separate runtime logic.
- Agents must not silently replace semantic ordering requirements with heuristics such as lookup sort direction.

### Add Button Configuration

```json
{
	"operation": "merge",
	"name": "AddButton",
	"values": {
		"clicked": {
			"request": "crt.CreateRecordRequest",
			"params": {"entityName": "UsrTodoTask"}
		}
	}
}
```

---

## viewModelConfigDiff

Binds page attributes to data source:

```json
[
	{
		"operation": "merge",
		"path": ["attributes"],
		"values": {
			"Name": {"modelConfig": {"path": "PDS.Name"}},
			"PDS_UsrStatus": {"modelConfig": {"path": "PDS.UsrStatus"}},
			"PDS_UsrDueDate": {"modelConfig": {"path": "PDS.UsrDueDate"}}
		}
	}
]
```

### Runtime Binding Pattern for Preserving Live Form Page Lookup Lists

When editing an existing FormPage through the runtime sync-pages flow, mirror the binding keys already present in the live page body instead of blindly reusing template placeholders. This is a preservation pattern for pages that already materialize lookup-list bindings in raw schema. It is not a recipe for creating new lookup-list attributes for datasource-bound `crt.ComboBox` controls.

This pattern sorts lookup records inside a ComboBox list. It is not the ListPage DataGrid row-sorting contract. For ListPage sorting, use `ListPage DataGrid Sorting for Runtime Page Sync` above.

```json
{
	"Name": {
		"modelConfig": {
			"path": "PDS.Name"
		}
	},
	"PDS_Column8_qc014wq": {
		"modelConfig": {
			"path": "PDS.Column8"
		}
	},
	"PDS_Column16_lcbi4nq_List": {
		"isCollection": true,
		"modelConfig": {
			"sortingConfig": {
				"default": [
					{
						"columnName": "Name",
						"direction": "asc"
					}
				]
			}
		}
	}
}
```

Rules:
- Keep `Name` as the special case when it already exists in the live page.
- Every new field insert in `SCHEMA_VIEW_CONFIG_DIFF` needs a matching attribute in `SCHEMA_VIEW_MODEL_CONFIG_DIFF`.
- Datasource-bound `crt.ComboBox` controls need only the main bound attribute by default.
- Existing materialized lookup-list bindings may be preserved when they are already present in the live page body; do not invent new `*_List` attributes during sync.
- Never introduce a new collection attribute with a raw `modelConfig.path` such as `"UsrStatus_List"` or `"UsrPriority_List"` without a datasource prefix.

---

## modelConfigDiff

Configures primary data source:

### List Page

```json
[
	{
		"operation": "merge",
		"path": ["dataSources"],
		"values": {
			"PDS": {
				"type": "crt.EntityDataSource",
				"config": {"entitySchemaName": "UsrTodoTask"},
				"scope": "viewElement"
			}
		}
	}
]
```

### Form Page

```json
[
	{
		"operation": "merge",
		"path": ["dataSources"],
		"values": {
			"PDS": {
				"type": "crt.EntityDataSource",
				"config": {"entitySchemaName": "UsrTodoTask"}
			}
		}
	}
]
```

---

## Form Page Layout

### Default FormPage Field Selection for New Apps

Use this policy when a new app is generated or the main section entity gains approved business fields and the requirements do not provide a complete explicit FormPage field list.

- Keep `Name` as the record title/header when the schema already contains it.
- Include all approved non-inherited business fields from the main entity.
- Required business fields must always be included.
- If the requirements are partial, keep the explicit fields and fill only the missing fields with this default policy.
- Preserve existing live fields and append only missing resolved fields unless the requirements explicitly demand removal or re-layout.

### Runtime Field Insertion via Page Sync

Use the current page body from `get-page` as the source of truth. For live FormPage field sync, identify the **primary field container** by inspecting the existing `viewConfigDiff` — it is the container that holds the most field-type insert operations (e.g., `crt.Input`, `crt.ComboBox`). Append missing resolved field controls to that discovered container.

```json
{
	"operation": "insert",
	"name": "Name",
	"values": {
		"layoutConfig": {
			"column": 1,
			"colSpan": 1,
			"row": 1,
			"rowSpan": 1
		},
		"type": "crt.Input",
		"label": "$Resources.Strings.Name",
		"control": "$Name",
		"labelPosition": "auto"
	},
	"parentName": "<primary-field-container>",
	"propertyName": "items",
	"index": 0
}
```

```json
{
	"operation": "insert",
	"name": "PDS_UsrCode",
	"values": {
		"layoutConfig": {
			"column": 1,
			"colSpan": 1,
			"row": 2,
			"rowSpan": 1
		},
		"type": "crt.Input",
		"label": "$Resources.Strings.PDS_UsrCode",
		"control": "$PDS_UsrCode",
		"placeholder": "",
		"tooltip": "",
		"readonly": false,
		"multiline": false,
		"labelPosition": "auto"
	},
	"parentName": "<primary-field-container>",
	"propertyName": "items",
	"index": 1
}
```

Rules:
- `parentName` is the **primary field container** discovered from the live page's `viewConfigDiff` (the container with the most field-type inserts). For standard templates this is typically `SideAreaProfileContainer`, but it may differ for custom pages.
- `propertyName` is `items`.
- `row` and `index` continue from the current maximum values already present in the discovered container.
- Default grid placement for new fields is `column=1`, `colSpan=1`, `rowSpan=1`.
- For numeric fields, add `format.decimalPrecision` when the target column scale is known.
- For date and time fields, set `pickerType` to match the underlying data value type.
- Do not replace existing inserts; append only missing fields.
- Keep `Name` as the header/title when it already exists and do not duplicate it.
- Required non-inherited business fields must never be omitted from the synchronized FormPage.
- Do not manually duplicate preprocessor-generated properties such as ComboBox load requests or ImageInput upload/clear requests unless the live page body already contains explicit versions of them.
- **Never hardcode a plain label string.** `"label": "Status"` is a bug — the field renders an English literal and will not localize. Only `"$Resources.Strings.<key>"` or `"#ResourceString(<key>)#"` are valid.
- **Label key MUST equal the attribute key from `control`** (strip the leading `$`). Example: `"control": "$PDS_UsrStatus"` → `"label": "$Resources.Strings.PDS_UsrStatus"`. Mismatched key renders a blank "Title on page" with no validator error.
- **Default pattern for new entity-field inserts:** attribute key `PDS_<Column>`, label `$Resources.Strings.PDS_<Column>`. No random suffix. Do not invent `_ab12cd3`-style tails for field attribute keys — binding happens in `viewModelConfigDiff.<key>.modelConfig.path`, not in the name.
- **`sync-pages resources` param is mandatory for every new `$Resources.Strings.<key>`.** The platform does not auto-register page resource strings during `sync-pages`; the designer only registers them when the field is first opened in its right panel. Always pass `resources` as a flat JSON map alongside new field inserts: `{"PDS_UsrStatus": "Status"}`. Without this, the label renders blank until the field is first touched in the designer.
- **Preserve existing live bindings.** If the live page already has `Name` bound as `control: "$Name"` with `label: "$Resources.Strings.Name"` (section-wizard output), keep it exactly. Only newly inserted fields follow the `PDS_<Column>` default above.
- **Rename consistency:** If any post-sync patch renames `control` from `$OldKey` to `$NewKey`, update `label` from `$Resources.Strings.OldKey` to `$Resources.Strings.NewKey` **in the same edit**, and replace the `OldKey` entry in the `resources` dict with `NewKey`.

### Runtime Lookup Special Case

```json
{
	"operation": "insert",
	"name": "PDS_UsrStatus",
	"values": {
		"layoutConfig": {"column": 1, "colSpan": 1, "row": 10, "rowSpan": 1},
		"type": "crt.ComboBox",
		"label": "$Resources.Strings.PDS_UsrStatus",
		"ariaLabel": "",
		"isAddAllowed": true,
		"showValueAsLink": true,
		"labelPosition": "auto",
		"controlActions": [],
		"listActions": [],
		"tooltip": "",
		"control": "$PDS_UsrStatus"
	},
	"parentName": "<primary-field-container>",
	"propertyName": "items",
	"index": 9
}
```

```json
{
	"operation": "insert",
	"name": "addRecord_6jika7x",
	"values": {
		"code": "addRecord",
		"type": "crt.ComboboxSearchTextAction",
		"icon": "combobox-add-new",
		"caption": "#ResourceString(addRecord6jika7x_caption)#",
		"clicked": {
			"request": "crt.CreateRecordFromLookupRequest",
			"params": {}
		}
	},
	"parentName": "PDS_UsrStatus",
	"propertyName": "listActions",
	"index": 0
}
```

Lookup rules:
- For datasource-bound `crt.ComboBox`, add the base insert and the main bound attribute only.
- Treat `crt.ComboboxSearchTextAction`, lookup-list datasource wiring, paging, sorting, and nested `value`/`displayValue` bindings as frontend-preprocessor concerns unless the live page body already persists them.
- If the live page already contains materialized lookup-list bindings or child actions, preserve their naming and config instead of regenerating or renaming them.

### Additional Supported Field Components

The frontend also supports these field controls:

| Component | Type String | Typical data value types | Notes |
|-----------|-------------|--------------------------|-------|
| File input | `crt.FileInput` | Blob, File, Image, ImageLookup | Supports `accept`, `maxFileSize`, and upload/download/preview events. Use only when the scenario explicitly needs file upload UX. |
| Encrypted input | `crt.EncryptedInput` | SecureText | Supports masking state and `toggleMaskValue`. Use for secure text, not as a generic text replacement. |
| Slider | `crt.Slider` | Integer, Float, Money | Supports `minValue`, `maxValue`, `step`, `color`. Use only when the UX explicitly wants a range/slider control. |

---

## Page Parent Templates

| Template | UId | Use Case |
|----------|-----|----------|
| ListPageV3Template | `b7b898d0-8c77-4953-c097-23fa6800da02` | List page |
| PageWithTabsFreedomTemplate | `3b2e117f-8c6b-4ca5-80a2-7ebb497cddf9` | Form with tabs |
| PageWithRightAreaAndTabsFreedomTemplate | `5f8dd430-acf2-4e1a-80c8-77cf57e245ce` | Form with right area + tabs |
| LightFormPage | `ec5fd902-66ce-4139-a241-10ebd8addc40` | Light/mini form |

Do not infer runtime field container names only from the parent template. Always inspect the live page's `viewConfigDiff` to discover the actual primary field container. For standard templates it is typically `SideAreaProfileContainer`, but custom pages may use a different container.

---

## Handlers

Handlers are stored in the page body as a marker-delimited array and executed at runtime through the Freedom UI request chain. Keep the page-body marker format for MCP editing, but write handler logic with the real runtime model in mind. See `context/handlers-reference.md` for the full execution model, request catalog, and APIs.

```javascript
handlers: /**SCHEMA_HANDLERS*/[
	{
		request: "crt.HandleViewModelInitRequest",
		handler: async (request, next) => {
			await next?.handle(request);
			request.$context.IsReady = true;
		}
	}
]/**SCHEMA_HANDLERS*/
```

Handler rules:

- By default, `await next?.handle(request)` to preserve the request chain.
- Omit `next` only when intentionally canceling or overriding the default flow.
- Use `finally` when cleanup must happen even if earlier logic fails.
- Use `request.$context.executeRequest(...)` for programmatic follow-up requests.
- Use `setValue(...)` and `setAttributePropertyValue(...)` for dynamic attribute state and validation.

---

## Module Dependencies (SCHEMA_DEPS / SCHEMA_ARGS)

When page-body handlers use external APIs (like `@creatio-devkit/common`), add them to the source-module deps and args:

```javascript
define("UsrMyApp_FormPage",
    /**SCHEMA_DEPS*/["@creatio-devkit/common"]/**SCHEMA_DEPS*/,
    function/**SCHEMA_ARGS*/(sdk)/**SCHEMA_ARGS*/ {
        return { /* handlers can use sdk.HttpClientService etc. */ };
    }
);
```

These source imports are part of the page body edited by MCP. They are not a replacement for the separate frontend TypeScript decorator-based runtime infrastructure.

Rules:

- Prefer `@creatio-devkit/common` for SDK services in page-body handlers.
- Reuse the live page alias (`sdk`, `devkit`, etc.) instead of renaming it.
- Common verified SDK use cases include `HttpClientService`, `SysValuesService`, `SysSettingsService`, `RightsService`, `Model.create(...)`, `FilterGroup`, and `ProcessEngineService`.
- See `context/handlers-reference.md` for concrete SDK recipes.
- See `context/devkit-common-reference.md` for the exhaustive `@creatio-devkit/common` public export catalog and short API descriptions.

---

## Converters and Validators Status

The page body format includes `converters` and `validators` object sections, but current frontend evidence does not confirm them as the primary Freedom UI mechanism for page-level validation or conversion logic.

For new work, prefer:

1. handlers
2. business rules
3. attribute property APIs such as `setAttributePropertyValue(...)`
4. controlled `setValue(...)` updates

If the live page already contains `converters` or `validators`, preserve them and edit them conservatively as object sections.

---

## MCP Page Tools — Reading and Editing Pages

Use these MCP tools to inspect and modify Freedom UI page schemas at runtime. The executable tool semantics come from `get-tool-contract` plus `docs://mcp/guides/existing-app-maintenance`; this section keeps only the repo-local consumer workflow.

| Tool | Description |
|------|-------------|
| `list-pages` | Discover page schemas by package or name pattern |
| `get-page` | Read a page schema's hierarchy-aware body (`body.js` — editable own-body of the replacing schema in the design package) and merged view (`bundle.json`). Writes files to `.clio-pages/{schema-name}/` |
| `sync-pages` | clio-advertised canonical write path for edited page bodies, batch validation, and optional server-side verification |
| `update-page` | Single-page save with `mode` (replace/append), `body-file`, `target-package-uid`, `target-schema-uid`, `skip-sampling`, `verify`, `optional-properties`. Append mode merges incoming body fragment with existing schema body. Fallback or targeted use only |
| `create-page` | Create a new Freedom UI page schema from a template. Use `list-page-templates` to discover valid templates first |
| `list-page-templates` | Discover valid Freedom UI page templates available on the target environment |
| `validate-page` | Client-side page body validation (markers, JS syntax, JSON content, field bindings, column bindings) without saving to Creatio |
| `add-form-fields` | Add form fields to an existing FormPage body — reads current body, inserts fields, and saves |
| `add-list-columns` | Add columns to an existing ListPage body — reads current body, inserts columns into the DataTable, and saves |
| `get-component-info` | Inspect curated Freedom UI component properties and example payloads |

### Editing Workflow

See `skills/page-schema-editing/SKILL.md` for the full workflow:
```
1. call `list-pages` with `search-pattern: "MyApp"`
2. call `get-page` with `schema-name: "UsrMyApp_FormPage"`
3. Modify the body directly (update handlers + deps + viewConfigDiff in one pass)
4. If the page contains unfamiliar `crt.*` components, follow the clio guidance and inspect them with `get-component-info` and `component-type: "..."`
5. call `sync-pages` with the edited page body and verify the saved page; keep `update-page` only as an explicit fallback
```

### Page Creation Workflow

When creating a new standalone Freedom UI page (not via `create-app-section`):
```
1. call `list-page-templates` to discover valid templates
2. call `create-page` with the chosen template, target package, and optional entity binding
3. call `get-page` to verify creation and retrieve the initial body
4. edit the body and persist through `sync-pages` or `update-page`
```

Resolve the full page creation contract through `docs://mcp/guides/page-creation`.

### Targeted Edits Without Full Body Replacement

- `update-page` with `mode: "append"` merges incoming viewConfigDiff entries and handlers into the existing schema body — use for additive edits without clobbering existing customizations
- `add-form-fields` inserts fields into an existing FormPage body directly
- `add-list-columns` inserts columns into an existing ListPage DataTable directly
- `validate-page` validates a page body client-side before saving

Resolve detailed tool parameters through `get-tool-contract`.
Resolve page modification patterns through `docs://mcp/guides/page-modification`.

**Important:** When adding handlers that require imports, update BOTH the `handlers` AND `deps` sections. Always read current state first with `get-page`.

---

**📁 For handler patterns and Creatio client APIs, see `context/handlers-reference.md`**
**📁 For viewConfigDiff component reference (buttons, containers, properties), see `context/viewconfig-reference.md`**

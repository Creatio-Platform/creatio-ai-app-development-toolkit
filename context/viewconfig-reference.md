# viewConfigDiff Reference

Reference for constructing `viewConfigDiff` operations in Freedom UI page schemas.
Used by coding agents with `page.update`.

For ListPage DataGrid sorting, use the canonical contract in `context/ui-reference.md`. This file covers field and control recipes, not the runtime sorting contract for ListPage collections.

---

## Operations

| Operation | Description | Required Fields |
|-----------|-------------|-----------------|
| `insert` | Add new element | `name`, `values`, `parentName`, `propertyName`, `index` |
| `merge` | Modify existing element properties | `name`, `values` |
| `remove` | Remove existing element | `name` |
| `move` | Move element to different parent | `name`, `parentName`, `propertyName`, `index` |

---

## Element Naming Convention

New elements use the pattern: `{Type}_{randomId}`

- `Button_6jika7x`
- `Input_a3bc9d2`
- `GridContainer_3ucdpjq`
- `FlexContainer_w2py4t8`
- `ExpansionPanel_umrgng3`

Generate a random 7-character alphanumeric suffix for each new element.

---

## Required User Input

When inserting a new generic element, ask the user for:

1. **Parent container name** (`parentName`) — where to place the element. The user must provide the exact container name from the target page.
2. **Action** — what the element should do when clicked/activated (e.g., "open AppFeature_ListPage", "create a new Contact record").

Use `page.get` to inspect the current page structure and identify available containers if the user is unsure.

### Exception: Entity-Field Sync on Live Form Pages

When the task is "entity columns were added and the FormPage must surface them", do **not** ask the user for `parentName`. Use this deterministic workflow instead:

1. Call `page.get` and inspect the current `SCHEMA_VIEW_CONFIG_DIFF`.
2. Append missing field controls to `SideAreaProfileContainer`.
3. Keep `propertyName: "items"`.
4. Continue `row` and `index` from the current maximum values already present in `SideAreaProfileContainer`.
5. Add matching attributes in `SCHEMA_VIEW_MODEL_CONFIG_DIFF` for every inserted field.
6. Keep the live naming pattern already present in the page body. `Name` is often a special case. For datasource-bound `crt.ComboBox`, add only the main bound attribute; preserve existing materialized `*_List` attributes or nested actions only if they already exist in the live page body.
7. Prefer minimal raw config for preprocessor-backed components. Do not manually duplicate auto-generated requests or bindings unless the current page body already stores them explicitly.

### Exception: Main-Entity Grid Sync on Live List Pages

When the task is "main entity columns were added and the ListPage must show the main columns", do **not** ask the user for the DataGrid node name or column order. Use this deterministic workflow instead:

1. Call `page.get` and inspect the live `crt.DataGrid` configuration and its current `columns`.
2. Resolve the target column set from the explicit plan first. If the plan is partial or missing, use the canonical default policy from `context/ui-reference.md`.
3. Preserve existing grid columns and their order.
4. Append only the missing resolved columns.
5. Keep the live `items` binding, `primaryColumnName`, and collection path intact unless the plan explicitly changes them.
6. Exclude inherited audit/system fields and long/rich/blob fields from default auto-selection unless they are explicitly requested or required.
7. After `page.update`, re-read the page and verify the required fields and resolved selected columns are present in the live DataGrid.

---

## Runtime FormPage Field Recipes

Use these recipes when syncing entity fields into a live FormPage through `page.update`.

| Field shape | Control type | Binding property | Default properties | Notes |
|-------------|--------------|------------------|--------------------|-------|
| Existing record title (`Name`) | `crt.Input` | `control` | `labelPosition: "auto"` | Keep the live `Name` binding when it already exists. |
| Short/medium/long text | `crt.Input` | `control` | `placeholder: ""`, `tooltip: ""`, `readonly: false`, `multiline: false`, `labelPosition: "auto"` | Use the current page naming pattern for the attribute key. |
| Integer, float, money | `crt.NumberInput` | `control` | `readonly: false`, `placeholder: ""`, `tooltip: ""`, `labelPosition: "auto"` | Add `format.decimalPrecision` when the numeric scale is known. |
| Boolean | `crt.Checkbox` | `control` | `disabled: false`, `inversed: false`, `ariaLabel: ""`, `tooltip: ""`, `labelPosition: "auto"` | Only set a static `value` when the page already uses that pattern or a business default requires it. |
| Date, time, datetime | `crt.DateTimePicker` | `control` | `placeholder: ""`, `readonly: false`, `tooltip: ""`, `labelPosition: "auto"` | Set `pickerType` to match the real field kind. |
| Rich/max-size text | `crt.RichTextEditor` | `control` | `placeholder: ""`, `tooltip: ""`, `labelPosition: "auto"`, `needHandleSave: true`, `filesStorage` config | Follow the live page pattern for `filesStorage`. |
| Phone | `crt.PhoneInput` | `control` | `placeholder: ""`, `tooltip: ""`, `labelPosition: "auto"`, `needHandleSave: false` | Frontend preprocessing can auto-set `phoneAsLink: true` and `displayAsPhone`. |
| Email | `crt.EmailInput` | `control` | `placeholder: ""`, `tooltip: ""`, `labelPosition: "auto"`, `needHandleSave: false` | Frontend preprocessing can auto-set `isFormatValidated`. |
| Web URL | `crt.WebInput` | `control` | `placeholder: ""`, `tooltip: ""`, `labelPosition: "auto"`, `needHandleSave: false` | Often auto-promoted from `crt.Input` when the bound field is `WEB_TEXT`. |
| Lookup | `crt.ComboBox` | `control` | `ariaLabel: ""`, `isAddAllowed: true`, `showValueAsLink: true`, `labelPosition: "auto"`, `controlActions: []`, `listActions: []`, `tooltip: ""` | Add only the main ComboBox insert and the main bound attribute for datasource-bound lookups. Preserve existing live `*_List` attributes or nested actions only if they already exist in the page body. Never create a raw `modelConfig.path` like `"UsrStatus_List"` without a datasource prefix. |
| Color | `crt.ColorPicker` | `control` | `labelPosition: "auto"`, `pickerMode: "extended"` | Supports transparent color and custom `colors` palette. |
| Image | `crt.ImageInput` | `value` | `readonly: false`, `placeholder: ""`, `labelPosition: "auto"`, `size: "large"`, `borderRadius: "medium"`, `positioning: "cover"` | `crt.ImageInput` binds through `value`, not `control`. The frontend can auto-add `bindTo`, `crt.ToImageLink`, `imageSelected`, and `imageClear`. |

### Generic Runtime Field Insert Example

```json
{
	"operation": "insert",
	"name": "Input_ab12cd3",
	"values": {
		"layoutConfig": {
			"column": 1,
			"colSpan": 1,
			"row": 2,
			"rowSpan": 1
		},
		"type": "crt.Input",
		"label": "$Resources.Strings.PDS_UsrCode_ab12cd3",
		"control": "$PDS_UsrCode_ab12cd3",
		"placeholder": "",
		"tooltip": "",
		"readonly": false,
		"multiline": false,
		"labelPosition": "auto"
	},
	"parentName": "SideAreaProfileContainer",
	"propertyName": "items",
	"index": 1
}
```

### Lookup Insert Example

```json
{
	"operation": "insert",
	"name": "ComboBox_ab12cd3",
	"values": {
		"layoutConfig": {
			"column": 1,
			"colSpan": 1,
			"row": 10,
			"rowSpan": 1
		},
		"type": "crt.ComboBox",
		"label": "$Resources.Strings.PDS_UsrStatus_ab12cd3",
		"ariaLabel": "",
		"isAddAllowed": true,
		"showValueAsLink": true,
		"labelPosition": "auto",
		"controlActions": [],
		"listActions": [],
		"tooltip": "",
		"control": "$PDS_UsrStatus_ab12cd3"
	},
	"parentName": "SideAreaProfileContainer",
	"propertyName": "items",
	"index": 9
}
```

```json
{
	"operation": "insert",
	"name": "addRecord_ab12cd3",
	"values": {
		"code": "addRecord",
		"type": "crt.ComboboxSearchTextAction",
		"icon": "combobox-add-new",
		"caption": "#ResourceString(addRecord_ab12cd3_caption)#",
		"clicked": {
			"request": "crt.CreateRecordFromLookupRequest",
			"params": {}
		}
	},
	"parentName": "ComboBox_ab12cd3",
	"propertyName": "listActions",
	"index": 0
}
```

If you omit `listActions` and keep `isAddAllowed: true`, the frontend can generate the default add-record action. Keep the explicit child action when you want deterministic raw-body output that matches already materialized page schemas.

### Image Insert Example

```json
{
	"operation": "insert",
	"name": "ImageInput_ab12cd3",
	"values": {
		"layoutConfig": {
			"column": 1,
			"colSpan": 1,
			"row": 13,
			"rowSpan": 1
		},
		"type": "crt.ImageInput",
		"label": "$Resources.Strings.PDS_UsrPhoto_ab12cd3",
		"value": "$PDS_UsrPhoto_ab12cd3",
		"readonly": false,
		"placeholder": "",
		"labelPosition": "auto",
		"size": "large",
		"borderRadius": "medium",
		"positioning": "cover"
	},
	"parentName": "SideAreaProfileContainer",
	"propertyName": "items",
	"index": 12
}
```

The frontend image preprocessor can additionally add:
- `bindTo` for business rules
- `value | crt.ToImageLink`
- `imageSelected: crt.UploadImageRequest`
- `imageClear: crt.ClearImageRequest`

Do not add those manually unless the current page body already contains explicit versions or the scenario explicitly requires them in the raw schema.

### Additional Supported Field Components

These field components are also available in the frontend:

| Component | Type String | Binding property | Typical extras |
|-----------|-------------|------------------|----------------|
| File input | `crt.FileInput` | `control` | `accept`, `maxFileSize`, upload/download/preview outputs |
| Encrypted input | `crt.EncryptedInput` | `control` | `state`, `unmaskingDisabled`, `toggleMaskValue` |
| Slider | `crt.Slider` | `control` | `minValue`, `maxValue`, `step`, `color` |

Use them only when the business requirements explicitly call for that UX. They are not the default mapping for generic entity-field sync.

## Components

### crt.Button

A clickable button element.

#### Defaults

When the user does not specify style/size, use these defaults:

| Property | Default Value |
|----------|---------------|
| `color` | `"default"` (plain style) |
| `size` | `"large"` |
| `iconPosition` | `"only-text"` |
| `disabled` | `false` |
| `visible` | `true` |
| `clickMode` | `"default"` |

#### Insert Example

```json
{
	"operation": "insert",
	"name": "Button_6jika7x",
	"values": {
		"type": "crt.Button",
		"caption": "#ResourceString(Button_6jika7x_caption)#",
		"color": "default",
		"disabled": false,
		"size": "large",
		"iconPosition": "only-text",
		"visible": true,
		"clicked": {
			"request": "<ASK_USER_ACTION>",
			"params": { }
		},
		"clickMode": "default"
	},
	"parentName": "<ASK_USER_CONTAINER>",
	"propertyName": "items",
	"index": 0
}
```

#### Properties

| Property | Type | Default | Valid Values |
|----------|------|---------|--------------|
| `type` | string | — | `"crt.Button"` (required) |
| `caption` | string | `""` | Any string or `#ResourceString(...)#` |
| `color` | string | `"default"` | `"primary"`, `"accent"`, `"warn"`, `"default"`, `"outline"` |
| `size` | string | `"large"` | `"small"`, `"medium"`, `"large"`, `"extra-large"` |
| `iconPosition` | string | `"only-text"` | `"only-text"`, `"left-icon"`, `"right-icon"`, `"only-icon"` |
| `icon` | string | — | Icon name (only when `iconPosition` is not `"only-text"`) |
| `disabled` | boolean | `false` | `true`, `false` |
| `visible` | boolean/string | `true` | `true`, `false`, or binding expression (e.g., `"$MyAttribute"`) |
| `clickMode` | string | `"default"` | `"default"`, `"menu"` |
| `clicked` | object | — | `{ "request": "...", "params": {...} }` — see Clicked Handlers below |
| `menuItems` | array | `[]` | Array of menu item configs (when `clickMode: "menu"`) |

#### Clicked Handlers

The `clicked` property binds a button click to a request. **Ask the user what action the button should perform**, then map to the appropriate request type:

```json
"clicked": {
	"request": "<RequestType>",
	"params": { ... }
}
```

| Request Type | Purpose | Key Params |
|-------------|---------|------------|
| `crt.OpenPageRequest` | Navigate to another page | `schemaName`, `parameters` |
| `crt.CreateRecordRequest` | Open form to create record | `entityName`, `entityPageName`, `defaultValues` |
| `crt.LoadDataRequest` | Reload data | `config.loadType`, `dataSourceName` |
| `crt.ImportDataRequest` | Open data import | `entitySchemaName` |
| `crt.RunBusinessProcessRequest` | Start a process | `processName`, `processRunType`, `showNotification` |

See `context/handlers-reference.md` for the full request type reference.

#### Merge Example (modify existing button)

```json
{
	"operation": "merge",
	"name": "AddButton",
	"values": {
		"clicked": {
			"request": "crt.CreateRecordRequest",
			"params": {
				"entityName": "UsrMyEntity"
			}
		},
		"caption": "#ResourceString(AddButton_caption)#",
		"visible": true
	}
}
```

#### Remove Example

```json
{
	"operation": "remove",
	"name": "DataImportButton"
}
```

---

## Editing Safety Contract

When editing page bodies via `page-update`, always use marker-based section extraction and structured JSON modification. The utility `scripts/page_body_edit.py` provides safe implementations of common operations.

### Correct: FormPage field insertion via parsed JSON

```
1. Extract SCHEMA_VIEW_CONFIG_DIFF content between markers → parse as JSON array
2. Find max row/index among existing SideAreaProfileContainer inserts
3. Append new insert object with incremented row/index to parsed array
4. Serialize array back to JSON → replace content between markers
5. Extract viewModelConfig(Diff) content → parse → add attribute → serialize → replace
```

Result: all existing operations remain intact, new field appears at the correct position.

### INCORRECT: FormPage field insertion via brace search

```
1. body.find('"index": 0') → find next "}" → insert new field text after that "}"
```

Failure mode: the `}` found may belong to a nested object (e.g., `layoutConfig`) or an unrelated operation (`AttachmentList`). New field text lands inside the wrong JSON object, corrupting the structure.

### Correct: ListPage attribute insertion (viewModelConfigDiff)

```
1. Detect marker variant → find SCHEMA_VIEW_MODEL_CONFIG_DIFF
2. Parse content as JSON array
3. Find the merge operation where path contains "attributes"
4. Add new attributes into that operation's "values" object
5. Serialize → replace between markers
```

### INCORRECT: ListPage attribute insertion via string append

```
1. Find closing "}" of last attribute in "values" → insert new attributes after it
```

Failure mode: the closing `}` may be the end of the `values` object itself, not of the last attribute. New attributes end up as siblings of `values` instead of inside it, breaking the merge operation structure.

### viewModelConfig vs viewModelConfigDiff

Pages use two structural variants for the viewModel section. Always detect which variant the live page uses before editing:

| Variant | Marker | Content Shape | How to add attributes |
|---------|--------|---------------|----------------------|
| `viewModelConfig` | `SCHEMA_VIEW_MODEL_CONFIG` | Object `{ "attributes": { ... } }` | Merge directly into `attributes` |
| `viewModelConfigDiff` | `SCHEMA_VIEW_MODEL_CONFIG_DIFF` | Array `[{ "operation": "merge", "path": [...], "values": { ... } }]` | Find operation with `"attributes"` in `path`, merge into its `values` |

FormPage typically uses the object variant; ListPage typically uses the array variant. Template-generated pages may use either — always detect, never assume.

---

*Last updated: 2026-03-20*

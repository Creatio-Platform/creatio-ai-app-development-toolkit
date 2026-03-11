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
	"parentName": "SideAreaProfileContainer",
	"propertyName": "items",
	"index": 0
}
```

---

## Control Types

| DataValueType | Control Type | Type String |
|---------------|-------------|-------------|
| ShortText, MediumText, LongText | Input | `crt.Input` |
| MaxSizeText, RichText | RichTextEditor | `crt.RichTextEditor` |
| Integer, Float, Money | NumberInput | `crt.NumberInput` |
| Boolean | Checkbox | `crt.Checkbox` |
| DateTime, Date, Time | DateTimePicker | `crt.DateTimePicker` |
| Lookup | ComboBox | `crt.ComboBox` |
| Image, ImageLookup | ImageInput | `crt.ImageInput` |
| Color | ColorPicker | `crt.ColorPicker` |

---

## List Page: DataTable Configuration

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
- `caption` — localized with `#ResourceString()#`
- `dataValueType` — numeric ID (see schema-reference.md)
- `referenceSchemaName` — only for Lookup columns

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
			"PDS_UsrStatus_ab12cd3": {"modelConfig": {"path": "PDS.UsrStatus"}},
			"PDS_UsrDueDate_ab12cd3": {"modelConfig": {"path": "PDS.UsrDueDate"}}
		}
	}
]
```

### Runtime Binding Pattern for Live Form Pages

When editing an existing FormPage via `page.update`, mirror the binding keys already present in the live page body instead of blindly reusing template placeholders.

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
- Lookup controls need both the main attribute and a `*_List` collection attribute.

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

### Runtime Field Insertion via `page.update`

Use the current page body from `page.get` as the source of truth. For live FormPage field sync, append new field controls to `SideAreaProfileContainer`.

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
	"parentName": "SideAreaProfileContainer",
	"propertyName": "items",
	"index": 0
}
```

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

Rules:
- `parentName` is `SideAreaProfileContainer` for runtime entity-field sync on live FormPages.
- `propertyName` is `items`.
- `row` and `index` continue from the current maximum values already present in `SideAreaProfileContainer`.
- Default grid placement for new fields is `column=1`, `colSpan=1`, `rowSpan=1`.
- Do not replace existing inserts; append only missing fields.

### Runtime Lookup Special Case

```json
{
	"operation": "insert",
	"name": "ComboBox_ab12cd3",
	"values": {
		"layoutConfig": {"column": 1, "colSpan": 1, "row": 10, "rowSpan": 1},
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

Lookup rules:
- Add the base `crt.ComboBox` insert and the child `crt.ComboboxSearchTextAction` insert together.
- Add both the main lookup attribute and the `*_List` collection attribute in `SCHEMA_VIEW_MODEL_CONFIG_DIFF`.

### Template Note

`templates/pages/form-page/FormPage.js` is still useful for file generation, but its `GeneralInfoTab` example is not the source of truth for runtime `page.update` edits. When editing a live page, trust `page.get` and preserve the current container and binding pattern.

---

## Page Parent Templates

| Template | UId | Use Case |
|----------|-----|----------|
| ListPageV3Template | `b7b898d0-8c77-4953-c097-23fa6800da02` | List page |
| PageWithTabsFreedomTemplate | `3b2e117f-8c6b-4ca5-80a2-7ebb497cddf9` | Form with tabs |
| PageWithRightAreaAndTabsFreedomTemplate | `5f8dd430-acf2-4e1a-80c8-77cf57e245ce` | Form with right area + tabs |
| LightFormPage | `ec5fd902-66ce-4139-a241-10ebd8addc40` | Light/mini form |

Do not infer runtime field container names only from the parent template. A live page can still place field inserts in `SideAreaProfileContainer` even when `page.get` reports `PageWithTabsFreedomTemplate`.

---

## Handlers

Event handlers for page logic. See `context/handlers-reference.md` for complete patterns and Creatio client APIs.

```javascript
handlers: /**SCHEMA_HANDLERS*/[
	{
		request: "crt.HandleViewModelInitRequest",
		handler: async (request, next) => {
			// Page initialization logic
			return next?.handle(request);
		}
	}
]/**SCHEMA_HANDLERS*/
```

---

## Module Dependencies (SCHEMA_DEPS / SCHEMA_ARGS)

When handlers use external APIs (like `@creatio-devkit/common`), add them to the deps and args:

```javascript
define("UsrMyApp_FormPage",
    /**SCHEMA_DEPS*/["@creatio-devkit/common"]/**SCHEMA_DEPS*/,
    function/**SCHEMA_ARGS*/(sdk)/**SCHEMA_ARGS*/ {
        return { /* handlers can use sdk.HttpClientService etc. */ };
    }
);
```

---

## MCP Page Tools — Reading and Editing Pages

Use these MCP tools to inspect and modify Freedom UI page schemas at runtime:

| Tool | Description |
|------|-------------|
| `page.list` | Discover page schemas by package or name pattern |
| `page.get` | Read a page schema's metadata and raw JS body |
| `page.update` | Save the complete JS body — agent handles all edits (saves to DB, no compile needed) |

### Editing Workflow

See `skills/page-schema-editing/SKILL.md` for the full workflow:
```
1. page.list(searchPattern: "MyApp")
2. page.get(schemaName: "UsrMyApp_FormPage")
3. Modify the body directly (update handlers + deps + viewConfigDiff in one pass)
4. page.update(schemaName: "UsrMyApp_FormPage", body: "...modified body...")
```

**Important:** When adding handlers that require imports, update BOTH the `handlers` AND `deps` sections. Always read current state first with `page.get`.

---

**📁 For complete page examples, see `templates/pages/`**
**📁 For handler patterns and Creatio client APIs, see `context/handlers-reference.md`**
**📁 For viewConfigDiff component reference (buttons, containers, properties), see `context/viewconfig-reference.md`**

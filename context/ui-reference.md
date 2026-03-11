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
		"label": "$Resources.Strings.PDS_Name_label",
		"control": "$PDS_Name",
		"visible": true,
		"readonly": false
	},
	"parentName": "GeneralInfoTab",
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
			"PDS_Name": {"modelConfig": {"path": "PDS.Name"}},
			"PDS_UsrStatus": {"modelConfig": {"path": "PDS.UsrStatus"}},
			"PDS_UsrDueDate": {"modelConfig": {"path": "PDS.UsrDueDate"}}
		}
	}
]
```

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

Fields placed using `layoutConfig`:

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
		"label": "$Resources.Strings.PDS_Name_label",
		"control": "$PDS_Name"
	},
	"parentName": "GeneralInfoTab",
	"propertyName": "items",
	"index": 0
}
```

- `column` — grid column (1-based)
- `colSpan` — columns to span
- `row` — grid row (1-based)
- `rowSpan` — rows to span

### ComboBox for Lookup Fields

```json
{
	"operation": "insert",
	"name": "UsrStatus",
	"values": {
		"layoutConfig": {"column": 1, "colSpan": 1, "row": 3, "rowSpan": 1},
		"type": "crt.ComboBox",
		"label": "$Resources.Strings.PDS_UsrStatus_label",
		"control": "$PDS_UsrStatus"
	},
	"parentName": "GeneralInfoTab",
	"propertyName": "items",
	"index": 2
}
```

---

## Page Parent Templates

| Template | UId | Use Case |
|----------|-----|----------|
| ListPageV3Template | `b7b898d0-8c77-4953-c097-23fa6800da02` | List page |
| PageWithTabsFreedomTemplate | `3b2e117f-8c6b-4ca5-80a2-7ebb497cddf9` | Form with tabs |
| PageWithRightAreaAndTabsFreedomTemplate | `5f8dd430-acf2-4e1a-80c8-77cf57e245ce` | Form with right area + tabs |
| LightFormPage | `ec5fd902-66ce-4139-a241-10ebd8addc40` | Light/mini form |

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

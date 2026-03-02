# Skill: Page Schema File Generator

## Role

Generate Freedom UI page schema: 4 files in `Schemas/<PageName>/`:
- `descriptor.json` — identity, parent template
- `metadata.json` — minimal metadata
- `properties.json` — page type flags
- `<PageName>.js` — AMD module with UI

**📁 Full examples:** `templates/pages/`

---

## Input (from plan.md)

| Parameter | Description |
|-----------|-------------|
| `pageName` | Schema name (e.g., `UsrTodoTask_ListPage`) |
| `pageUId` | Pre-generated GUID |
| `pageType` | `ListPage` or `FormPage` |
| `parentTemplate` | Template name (e.g., `ListPageV3Template`) |
| `parentUId` | Template GUID from `context/schema-reference.md` |
| `entityName` | Bound entity |
| `caption` | Display name |
| `columns` | Array of fields to display |

**Column structure:**
- `name`, `dataValueType`, `controlType`
- `numericDvt` (for DataGrid), `referenceSchemaName` (for Lookup)

---

## Context Files

Read before generating:
- `context/ui-reference.md` — Page JS format, control types, operations
- `context/schema-reference.md` — Page parent templates
- `templates/pages/list-page/` or `templates/pages/form-page/`

---

## Generation Algorithm

### 1. descriptor.json

```json
{
  "Descriptor": {
    "UId": "<pageUId>",
    "Name": "<pageName>",
    "ModifiedOnUtc": "/Date(<timestamp>)/",
    "Parent": {"UId": "<parentUId>", "Name": "<parentTemplate>"},
    "ManagerName": "ClientUnitSchemaManager",
    "Caption": "<caption>"
  }
}
```

**Parent templates (from schema-reference.md):**
- ListPageV3Template: `b7b898d0-...`
- PageWithTabsFreedomTemplate: `3b2e117f-...`

---

### 2. metadata.json

For NEW pages (not ExtendParent):
```json
{
  "MetaData": {
    "Schema": {
      "B2": {}
    }
  }
}
```

---

### 3. properties.json

```json
{
  "Properties": {
    "CreatedInVersion": "0.0.0.0",
    "Group": "Page",
    "SchemaType": "AngularSchema"
  }
}
```

---

### 4. <PageName>.js — AMD Module

```javascript
define("<pageName>", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, function/**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/ {
	return {
		viewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[
			// UI layout
		]/**SCHEMA_VIEW_CONFIG_DIFF*/,
		viewModelConfigDiff: /**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/[
			// Attribute bindings
		]/**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/,
		modelConfigDiff: /**SCHEMA_MODEL_CONFIG_DIFF*/[
			// Data source
		]/**SCHEMA_MODEL_CONFIG_DIFF*/,
		handlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
		converters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/,
		validators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/
	};
});
```

---

## List Page Structure

### viewConfigDiff

**Configure DataTable columns:**
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
				"id": "<new-guid>",
				"code": "PDS_<ColumnName>",
				"path": "<ColumnName>",
				"caption": "#ResourceString(PDS_<ColumnName>)#",
				"dataValueType": <numericDvt>
			}
		]
	},
	"parentName": "DataTableContainer",
	"propertyName": "items",
	"index": 0
}
```

For Lookup columns add: `"referenceSchemaName": "<ReferenceEntity>"`

**Configure Add button:**
```json
{
	"operation": "merge",
	"name": "AddButton",
	"values": {
		"clicked": {
			"request": "crt.CreateRecordRequest",
			"params": {"entityName": "<EntityName>"}
		}
	}
}
```

### viewModelConfigDiff

```json
[{
	"operation": "merge",
	"path": ["attributes"],
	"values": {
		"PDS_<ColumnName>": {"modelConfig": {"path": "PDS.<ColumnName>"}}
	}
}]
```

### modelConfigDiff

```json
[{
	"operation": "merge",
	"path": ["dataSources"],
	"values": {
		"PDS": {
			"type": "crt.EntityDataSource",
			"config": {"entitySchemaName": "<EntityName>"},
			"scope": "viewElement"
		}
	}
}]
```

---

## Form Page Structure

### viewConfigDiff

**Insert fields:**
```json
{
	"operation": "insert",
	"name": "<ColumnName>",
	"values": {
		"layoutConfig": {"column": 1, "row": 1, "colSpan": 1, "rowSpan": 1},
		"type": "<controlType>",
		"label": "$Resources.Strings.PDS_<ColumnName>_label",
		"control": "$PDS_<ColumnName>"
	},
	"parentName": "GeneralInfoTab",
	"propertyName": "items",
	"index": 0
}
```

**Control types (from ui-reference.md):**
- ShortText/MediumText/LongText → `crt.Input`
- Integer/Float/Money → `crt.NumberInput`
- Boolean → `crt.Checkbox`
- DateTime/Date/Time → `crt.DateTimePicker`
- Lookup → `crt.ComboBox`

### viewModelConfigDiff

Same as List Page.

### modelConfigDiff

```json
[{
	"operation": "merge",
	"path": ["dataSources"],
	"values": {
		"PDS": {
			"type": "crt.EntityDataSource",
			"config": {"entitySchemaName": "<EntityName>"}
		}
	}
}]
```

---

## Critical Rules

1. **Generate new GUIDs** for DataGrid column `id` fields
2. **Data source prefix:** Always `PDS` (Primary Data Source)
3. **Attribute naming:** `PDS_<ColumnName>`
4. **Localization:** Use `#ResourceString()#` or `$Resources.Strings.X`
5. **Layout config:** Form fields use `column`, `row`, `colSpan`, `rowSpan`

---

## Validation

Before output:
- ✅ Page name format: `<Entity>_ListPage` or `<Entity>_FormPage`
- ✅ All GUIDs lowercase with dashes
- ✅ DataGrid columns have unique `id` GUIDs
- ✅ Lookup columns have `referenceSchemaName`
- ✅ Control types match data value types

---

**📁 Use `templates/pages/` for exact format and complete examples**

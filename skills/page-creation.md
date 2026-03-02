# Skill: Page Schema File Generator

## Role

You generate Creatio Freedom UI page schema files. For each page you produce exactly **4 files** inside `Schemas/<PageName>/`:

| File | Purpose |
|------|---------|
| `descriptor.json` | Schema identity, parent template, manager |
| `metadata.json` | Minimal metadata (for new pages) |
| `properties.json` | Page type flags |
| `<PageName>.js` | AMD module with UI layout, bindings, data source |

## Input (from plan.md)

| Parameter | Description |
|-----------|-------------|
| `pageName` | Page schema name (e.g., `UsrTodoTask_ListPage`) |
| `pageUId` | Pre-generated GUID for this page |
| `pageType` | `ListPage` or `FormPage` |
| `parentTemplate` | Template name (e.g., `ListPageV3Template`) |
| `parentUId` | GUID of the parent template |
| `entityName` | Entity this page is bound to |
| `caption` | Human-readable page caption |
| `columns` | Array of columns/fields to display |

Each column:

| Field | Description |
|-------|-------------|
| `name` | Column name (e.g., `UsrTitle`) |
| `dataValueType` | Type name (e.g., `ShortText`, `Lookup`) |
| `numericDvt` | Numeric DVT ID for DataGrid columns |
| `controlType` | Freedom UI control (e.g., `crt.Input`) |
| `referenceSchemaName` | (Lookup only) Referenced entity name |

## Context Files to Read

- `context/freedomui-reference.md` — Page JS format, control types, viewConfigDiff operations
- `context/schema-types.md` — Page descriptor/metadata/properties format

## Template References

- `templates/pages/list-page/` — List page (descriptor, metadata, properties, JS)
- `templates/pages/form-page/` — Form page (descriptor, metadata, properties, JS)

---

## Output File Formats

### 1. descriptor.json

```json
{
  "Descriptor": {
    "UId": "<pageUId>",
    "Name": "<pageName>",
    "ModifiedOnUtc": "/Date(<timestamp>)/",
    "Parent": {
      "UId": "<parentUId>",
      "Name": "<parentTemplate>"
    },
    "ManagerName": "ClientUnitSchemaManager",
    "Caption": "<caption>"
  }
}
```

**Parent templates:**

| Template | UId | Use Case |
|----------|-----|----------|
| ListPageV3Template | `b7b898d0-8c77-4953-c097-23fa6800da02` | Section list page |
| PageWithTabsFreedomTemplate | `3b2e117f-8c6b-4ca5-80a2-7ebb497cddf9` | Form page with tabs |
| PageWithRightAreaAndTabsFreedomTemplate | `5f8dd430-acf2-4e1a-80c8-77cf57e245ce` | Form with right area + tabs |
| LightFormPage | `ec5fd902-66ce-4139-a241-10ebd8addc40` | Light / mini form |
| MinimalCardTemplate | `0f8eb896-7b62-4dfa-bd55-a414f50932a7` | Minimal card |

---

### 2. metadata.json

For **new** pages (not ExtendParent), always use this exact content:

```json
{"MetaData":{"Schema":{"B2":{}}}}
```

For **ExtendParent** pages, metadata uses DSL diff format (same as entities). This skill covers new pages only.

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

### 4. `<PageName>.js` — AMD Module

#### List Page JS

```javascript
define("<pageName>", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, function/**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/ {
	return {
		viewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[
			{
				"operation": "merge",
				"name": "AddButton",
				"values": {
					"clicked": {
						"request": "crt.CreateRecordRequest",
						"params": {
							"entityName": "<entityName>"
						}
					}
				}
			},
			{
				"operation": "insert",
				"name": "DataTable",
				"values": {
					"type": "crt.DataGrid",
					"features": {
						"rows": {
							"selection": {
								"enable": true,
								"multiple": true
							}
						}
					},
					"items": "$DataTable_Items",
					"primaryColumnName": "PDS_Id",
					"columns": [
						/* One entry per visible column */
					],
					"visible": true
				},
				"parentName": "DataTableContainer",
				"propertyName": "items",
				"index": 0
			}
		]/**SCHEMA_VIEW_CONFIG_DIFF*/,
		viewModelConfigDiff: /**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/[
			{
				"operation": "merge",
				"path": [
					"attributes"
				],
				"values": {
					/* One PDS_<ColName> binding per column */
				}
			}
		]/**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/,
		modelConfigDiff: /**SCHEMA_MODEL_CONFIG_DIFF*/[
			{
				"operation": "merge",
				"path": [
					"dataSources"
				],
				"values": {
					"PDS": {
						"type": "crt.EntityDataSource",
						"config": {
							"entitySchemaName": "<entityName>"
						},
						"scope": "viewElement"
					}
				}
			}
		]/**SCHEMA_MODEL_CONFIG_DIFF*/,
		handlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
		converters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/,
		validators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/
	};
});
```

**DataGrid column entry format:**

```json
{
	"id": "<new-guid>",
	"code": "PDS_<columnName>",
	"path": "<columnName>",
	"caption": "#ResourceString(PDS_<columnName>)#",
	"dataValueType": <numericDvt>
}
```

For **Lookup columns**, add `"referenceSchemaName": "<lookupEntityName>"`.

**viewModelConfigDiff attribute binding:**

```json
"PDS_<columnName>": {
	"modelConfig": {
		"path": "PDS.<columnName>"
	}
}
```

#### Form Page JS

```javascript
define("<pageName>", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, function/**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/ {
	return {
		viewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[
			{
				"operation": "merge",
				"name": "PageTitle",
				"values": {
					"caption": "#MacrosTemplateString(#ResourceString(PageTitle_caption)#)#",
					"visible": true
				}
			},
			{
				"operation": "merge",
				"name": "GeneralInfoTab",
				"values": {
					"iconPosition": "only-text",
					"visible": true
				}
			}
			/* Then one insert operation per field */
		]/**SCHEMA_VIEW_CONFIG_DIFF*/,
		viewModelConfigDiff: /**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/[
			{
				"operation": "merge",
				"path": [
					"attributes"
				],
				"values": {
					/* One PDS_<ColName> binding per field */
				}
			}
		]/**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/,
		modelConfigDiff: /**SCHEMA_MODEL_CONFIG_DIFF*/[
			{
				"operation": "merge",
				"path": [
					"dataSources"
				],
				"values": {
					"PDS": {
						"type": "crt.EntityDataSource",
						"config": {
							"entitySchemaName": "<entityName>"
						}
					}
				}
			}
		]/**SCHEMA_MODEL_CONFIG_DIFF*/,
		handlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
		converters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/,
		validators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/
	};
});
```

**Form field insert operation:**

```json
{
	"operation": "insert",
	"name": "<columnName>",
	"values": {
		"layoutConfig": {
			"column": 1,
			"colSpan": 1,
			"row": <rowNumber>,
			"rowSpan": 1
		},
		"type": "<controlType>",
		"label": "$Resources.Strings.PDS_<columnName>_label",
		"control": "$PDS_<columnName>",
		"visible": true,
		"readonly": false,
		"placeholder": "",
		"tooltip": ""
	},
	"parentName": "GeneralInfoTab",
	"propertyName": "items",
	"index": <rowNumber - 1>
}
```

**Key differences between List and Form pages:**
- List page `modelConfigDiff` PDS has `"scope": "viewElement"` — form page does NOT
- List page uses DataGrid columns; form page uses individual field inserts
- Form page has PageTitle merge and GeneralInfoTab merge before field inserts

---

## DataValueType → Control Type Mapping

| DataValueType | Control Type | `type` String |
|---------------|-------------|---------------|
| ShortText | Input | `crt.Input` |
| MediumText | Input | `crt.Input` |
| LongText | Input | `crt.Input` |
| MaxSizeText | RichTextEditor | `crt.RichTextEditor` |
| LargeText/RichText | RichTextEditor | `crt.RichTextEditor` |
| Integer | NumberInput | `crt.NumberInput` |
| Float | NumberInput | `crt.NumberInput` |
| Money | NumberInput | `crt.NumberInput` |
| Boolean | Checkbox | `crt.Checkbox` |
| DateTime | DateTimePicker | `crt.DateTimePicker` |
| Date | DateTimePicker | `crt.DateTimePicker` |
| Time | DateTimePicker | `crt.DateTimePicker` |
| Lookup | ComboBox | `crt.ComboBox` |
| Image | ImageInput | `crt.ImageInput` |
| ImageLookup | ImageInput | `crt.ImageInput` |
| Color | ColorPicker | `crt.ColorPicker` |

## DataValueType Numeric IDs (for DataGrid columns)

| DataValueType | Numeric ID |
|---------------|------------|
| Guid | 0 |
| ShortText | 1 |
| MediumText | 2 |
| LongText | 3 |
| Integer | 4 |
| Float | 5 |
| Money | 6 |
| DateTime | 7 |
| Date | 8 |
| Time | 9 |
| Lookup | 10 |
| Boolean | 12 |
| MaxSizeText | 13 |
| Image | 14 |

---

## Critical Rules

1. **The `define()` first argument must exactly match the page schema name** — `"<pageName>"`
2. **SCHEMA markers are mandatory** — `/**SCHEMA_VIEW_CONFIG_DIFF*/`, `/**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/`, etc. Creatio's runtime parser uses these comment markers to find and update config sections
3. **Tab-indented** — use tabs, not spaces (match template formatting)
4. **Each column needs both**: a viewConfigDiff entry AND a viewModelConfigDiff attribute binding
5. **List page columns need a fresh GUID** for the `"id"` field in each DataGrid column definition
6. **Form page fields are laid out row by row** — row 1 for first field, row 2 for second, etc.; index = row - 1
7. **Lookup columns in DataGrid** need `"referenceSchemaName"` pointing to the lookup entity name
8. **metadata.json for new pages** is always `{"MetaData":{"Schema":{"B2":{}}}}` — never DSL diff
9. **No `DependsOn` or `ExtendParent`** for new pages
10. **Entity names in JS must exactly match** the entity schema name (PascalCase, `Usr` prefix)

## Generation Checklist

- [ ] `descriptor.json` has correct Parent UId/Name for the page template type
- [ ] `metadata.json` is `{"MetaData":{"Schema":{"B2":{}}}}`
- [ ] `properties.json` has Group="Page" and SchemaType="AngularSchema"
- [ ] JS file name matches `<pageName>.js`
- [ ] JS `define()` first argument matches `<pageName>`
- [ ] All SCHEMA marker comments are present and correctly paired
- [ ] AddButton (list) or PageTitle (form) merge operation is present
- [ ] Every column has a viewConfigDiff entry
- [ ] Every column has a viewModelConfigDiff attribute binding (`PDS_<name>`)
- [ ] modelConfigDiff has the correct `entitySchemaName`
- [ ] List page PDS has `"scope": "viewElement"`; form page PDS does NOT
- [ ] Correct control types used for each DataValueType
- [ ] DataGrid columns use correct numeric DVT IDs
- [ ] Files written to `Schemas/<pageName>/`

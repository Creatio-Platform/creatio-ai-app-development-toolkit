---
name: page-creation
description: Generate Creatio Freedom UI page schema files (descriptor.json + JS page). Use when implementing pages from plan.md
compatibility: Requires access to context/ui-reference.md and templates/pages/ directory
metadata:
  version: "2.0"
  category: creatio-schema-generation
---

# Freedom UI Page Generator

Generate complete Freedom UI page schema files for Creatio composable apps. Each page produces 2 files: descriptor and JavaScript page definition.

## What This Skill Does

Transforms page definitions from `plan.md` into properly formatted Creatio Freedom UI pages:
- **descriptor.json**
- **<PageName>.js**

## When to Use

Use this skill when:
- Implementing pages defined in a technical plan
- Creating CRUD pages with grids, forms, detail sections
- Need exact Freedom UI schema format with view/viewModel configs

## Input Expected

From `plan.md`, you need:
- Page name (e.g., `UsrTodoList_FormPage`)
- Page UId (pre-generated GUID)
- Page type (`List` with grid, or `Form` with fields)
- Package UId
- Caption (display name)
- Entity UId (the data source entity)
- Columns/Fields to display
- For List pages: grid columns, actions (New, Edit, Delete)
- For Form pages: field layout, lookups, tabs if needed

## Context to Read First

Before generating, read:
- `context/ui-reference.md`
- `templates/pages/list-page/` OR `templates/pages/form-page/`

The templates are your source of truth for structure. Copy them and replace placeholders.

---

## How It Works

### 1. descriptor.json Format

Use this exact structure:

```json
{
  "Descriptor": {
    "UId": "<pageUId>",
    "Name": "<pageName>",
    "ModifiedOnUtc": "/Date(<timestamp>)/",
    "Parent": {
      "UId": "f77e0972-8829-45df-840f-da27c7cd9e82",
      "Name": "PageWithTabsFreedomTemplate"
    },
    "ManagerName": "ClientUnitSchemaManager",
    "Caption": "<caption>",
    "DependsOn": []
  }
}
```

Note:
- `<timestamp>` is current milliseconds since Unix epoch
- `Parent.UId` is **always** `f77e0972-8829-45df-840f-da27c7cd9e82` for Freedom UI pages (PageWithTabsFreedomTemplate)
- `ManagerName` is **always** `ClientUnitSchemaManager` for page schemas
- `DependsOn` is always empty `[]` for new pages

### 2. <PageName>.js

The JavaScript file has several critical sections:

#### File Header

```javascript
define("<pageName>", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, function/**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/ {
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

Note: The `/**SCHEMA_**/` comments are critical

#### viewConfigDiff

This defines the visual structure using operations:

```javascript
viewConfigDiff: [
  {
    "operation": "insert",
    "name": "MainContainer",
    "values": {
      "type": "crt.FlexContainer",
      "direction": "column",
      "items": []
    }
  }
]
```

**Common control types:**
- `crt.FlexContainer`
- `crt.DataGrid`
- `crt.Input`
- `crt.NumberInput`
- `crt.DateTimePicker`
- `crt.ComboBox`
- `crt.Button`

**For List pages with grid:**

Add a DataGrid with columns:

```javascript
{
  "operation": "insert",
  "name": "MyGrid",
  "values": {
    "type": "crt.DataGrid",
    "items": "$GridData",
    "selectionMode": "single",
    "columns": [
      {
        "id": "<columnUId1>",
        "code": "Column1",
        "caption": "#ResourceString(Column1_caption)#",
        "dataValueType": 1
      }
    ],
    "features": {
      "rows": {
        "selection": { "enable": true },
        "toolbar": {
          "items": {
            "AddButton": {
              "type": "crt.MenuItem",
              "caption": "#ResourceString(AddButton_caption)#",
              "clicked": { "request": "crt.CreateRecordRequest" }
            }
          }
        }
      }
    }
  }
}
```

**For Form pages with fields:**

Add Input controls for each field:

```javascript
{
  "operation": "insert",
  "name": "FieldName",
  "values": {
    "layoutConfig": { "column": 1, "row": 1, "colSpan": 1, "rowSpan": 1 },
    "type": "crt.Input",
    "label": "#ResourceString(FieldName_label)#",
    "control": "$FieldName",
    "labelPosition": "above"
  },
  "parentName": "SideAreaProfileContainer",
  "propertyName": "items",
  "index": 0
}
```

Note: Defines grid position (column, row) and size (colSpan, rowSpan). This controls field layout in the form.

#### viewModelConfigDiff

This configures data sources and attributes:

```javascript
viewModelConfigDiff: [
  {
    "operation": "merge",
    "path": ["attributes"],
    "values": {
      "GridData": {
        "isCollection": true,
        "modelConfig": {
          "path": "GridDataDS"
        },
        "viewModelConfig": {
          "attributes": {
            "GridDataDS_Column1": { "modelConfig": { "path": "GridDataDS.Column1" } }
          }
        }
      }
    }
  }
]
```

Note: Set to `true` for grids (multiple records), `false` for single-record forms.

**Add data source:**

```javascript
{
  "operation": "merge",
  "path": ["dataSources"],
  "values": {
    "GridDataDS": {
      "type": "crt.EntityDataSource",
      "scope": "viewElement",
      "config": {
        "entitySchemaName": "UsrMyEntity",
        "attributes": {
          "Column1": { "path": "UsrColumn1" }
        }
      }
    }
  }
}
```

Note: This links the page to an entity schema. Must match the entity name exactly.

#### modelConfigDiff

For Form pages, define the primary record:

```javascript
modelConfigDiff: [
  {
    "operation": "merge",
    "path": [],
    "values": {
      "primaryDataSourceName": "PDS",
      "dependencies": {
        "GridDataDS": [{ "attributePath": "FilterField", "relationPath": "PDS.Id" }]
      }
    }
  }
]
```

Note: Links master-detail relationships. FilterField on GridDataDS filters by PDS.Id.

#### handlers

Add custom logic:

```javascript
handlers: [
  {
    "request": "crt.HandleViewModelAttributeChangeRequest",
    "handler": async (request, next) => {
      if (request.attributeName === "MyField") {
        // Custom logic here
      }
      return next?.handle(request);
    }
  }
]
```

**Common request types:**
- `crt.HandleViewModelAttributeChangeRequest`
- `crt.LoadDataRequest`
- `crt.CreateRecordRequest`

---

## Critical Rules

**Never modify SCHEMA markers:**
- Keep all `/**SCHEMA_DEPS*/`, `/**SCHEMA_VIEW_CONFIG_DIFF*/`, etc. exactly as-is
- These enable schema inheritance and merging

**Use correct control types:**
- DataGrid for collections (List pages)
- Input/ComboBox/DateTimePicker for form fields
- FlexContainer for layout grouping

**Resource strings:**
- All captions/labels use `#ResourceString(Key)#` syntax
- The actual strings are defined separately (not in this skill's scope)

**Data source naming:**
- Use `PDS` for primary data source on Form pages
- Use `<Name>DS` pattern for grids (e.g., `GridDataDS`)
- Scope: `viewElement` for grids, `page` for primary

**Grid column dataValueType:**
- 1 = Text
- 4 = Integer
- 6 = Decimal
- 8 = Date
- 10 = Lookup
- See context/schema-reference.md for full list

---

## Validation Checklist

Before finalizing files, verify:

- ✅ Page name starts with `Usr`
- ✅ All control names are unique within the page
- ✅ SCHEMA markers preserved
- ✅ viewConfigDiff operations use correct "insert"/"merge" operations
- ✅ Data sources linked to correct entity schemas
- ✅ Grid columns have matching attributes in viewModelConfig
- ✅ layoutConfig values are valid (row/column >= 1, colSpan/rowSpan >= 1)

---

## Output

Generate both files directly to: `output/<AppName>/packages/<PackageName>/Schemas/<PageName>/`

When done, confirm: "Generated page schema files for `<PageName>`

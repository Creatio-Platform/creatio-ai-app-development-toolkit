# viewConfigDiff Reference

Reference for constructing `viewConfigDiff` operations in Freedom UI page schemas.
Used by coding agents with `page.update`.

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

When inserting a new element, **always ask the user** for:

1. **Parent container name** (`parentName`) — where to place the element. The user must provide the exact container name from the target page.
2. **Action** — what the element should do when clicked/activated (e.g., "open AppFeature_ListPage", "create a new Contact record").

Use `page.get` to inspect the current page structure and identify available containers if the user is unsure.

---

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

<!-- 
## crt.Input
TODO: Add input field reference

## crt.ComboBox
TODO: Add combo box reference

## crt.DataGrid
TODO: Add data grid reference

## crt.FlexContainer
TODO: Add flex container reference
-->

---

*Last updated: 2026-03-11*

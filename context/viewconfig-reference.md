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
6. Keep the live naming pattern already present in the page body. `Name` is often a special case. Lookup controls may need extra `*_List` attributes and nested actions.

---

## Runtime FormPage Field Recipes

Use these recipes when syncing entity fields into a live FormPage through `page.update`.

| Field shape | Control type | Binding property | Default properties | Notes |
|-------------|--------------|------------------|--------------------|-------|
| Existing record title (`Name`) | `crt.Input` | `control` | `labelPosition: "auto"` | Keep the live `Name` binding when it already exists. |
| Short/medium/long text | `crt.Input` | `control` | `placeholder: ""`, `tooltip: ""`, `readonly: false`, `multiline: false`, `labelPosition: "auto"` | Use the current page naming pattern for the attribute key. |
| Integer, float, money | `crt.NumberInput` | `control` | `readonly: false`, `placeholder: ""`, `tooltip: ""`, `labelPosition: "auto"` | |
| Boolean | `crt.Checkbox` | `control` | `disabled: false`, `inversed: false`, `ariaLabel: ""`, `tooltip: ""`, `labelPosition: "auto"` | Only set a static `value` when the page already uses that pattern or a business default requires it. |
| Date, time, datetime | `crt.DateTimePicker` | `control` | `placeholder: ""`, `readonly: false`, `tooltip: ""`, `labelPosition: "auto"` | |
| Rich/max-size text | `crt.RichTextEditor` | `control` | `placeholder: ""`, `tooltip: ""`, `labelPosition: "auto"`, `needHandleSave: true`, `filesStorage` config | Follow the live page pattern for `filesStorage`. |
| Phone | `crt.PhoneInput` | `control` | `placeholder: ""`, `tooltip: ""`, `labelPosition: "auto"`, `needHandleSave: false` | |
| Email | `crt.EmailInput` | `control` | `placeholder: ""`, `tooltip: ""`, `labelPosition: "auto"`, `needHandleSave: false` | |
| Web URL | `crt.WebInput` | `control` | `placeholder: ""`, `tooltip: ""`, `labelPosition: "auto"`, `needHandleSave: false` | |
| Lookup | `crt.ComboBox` | `control` | `ariaLabel: ""`, `isAddAllowed: true`, `showValueAsLink: true`, `labelPosition: "auto"`, `controlActions: []`, `listActions: []`, `tooltip: ""` | Also add a `*_List` collection attribute and a child `crt.ComboboxSearchTextAction` insert. |
| Color | `crt.ColorPicker` | `control` | `labelPosition: "auto"`, `pickerMode: "extended"` | |
| Image | `crt.ImageInput` | `value` | `readonly: false`, `placeholder: ""`, `labelPosition: "auto"`, `size: "large"`, `borderRadius: "medium"`, `positioning: "cover"` | `crt.ImageInput` binds through `value`, not `control`. |

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

---

*Last updated: 2026-03-11*

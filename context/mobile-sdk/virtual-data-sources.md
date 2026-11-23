# Mobile SDK — Virtual data sources

Read after `context/mobile-sdk-guide.md`, when the plan uses this mechanism.

## Virtual data sources

A virtual data source serves a page data source from code: a list assembled from several entities,
values computed on the device, a draft that is not saved yet.

```ts
import {
	BaseVirtualDataSource,
	CrtVirtualDataSource,
	DataOperationResult,
	JsonArray,
	JsonObject,
} from '@creatio/mobile-common';

@CrtVirtualDataSource('UsrOrderHintsDataSource')
export class UsrOrderHintsDataSource extends BaseVirtualDataSource {
	public async loadItems(operation: JsonObject): Promise<JsonArray> {
		return [{ Id: '1', Name: 'Check the delivery address' }];
	}

	public async loadItem(operation: JsonObject): Promise<JsonObject | null> {
		return null;
	}

	public async create(operation: JsonObject): Promise<JsonObject> {
		return {};
	}

	public async copy(operation: JsonObject): Promise<JsonObject | null> {
		return null;
	}

	public async insert(data: JsonObject, operation: JsonObject): Promise<DataOperationResult> {
		return { success: false };
	}

	public async update(data: JsonObject, operation: JsonObject): Promise<DataOperationResult> {
		return { success: false };
	}

	public async delete(operation: JsonObject): Promise<DataOperationResult> {
		return { success: false };
	}
}
```

- Register the class in `@CrtModule({ virtualDataSources: [...] })`.
- All seven methods are abstract and must exist. A read-only source returns `{ success: false }` from
  the writing ones.
- An instance is created per operation; keep shared state at module level.
- `operation` is the app's description of the call. For reads it may carry `columns`, `filters`,
  `rowCount`, `rowsOffset` and `sortOptions`; for a single record, `primaryColumnValue`. Treat every
  field as optional and honour paging when the list can be long.
- Every returned record carries the primary attribute, and the display attribute when the page shows
  it.
- **The source is not told which page or record it serves.** `operation` describes the read, not the
  page. Unless the module arranges otherwise, the source returns the same rows on every page that
  uses it, on every record.

### Virtual data source on a page

The page declares a data source of type `crt.VirtualDataSource` and names the class's registered name:

```json
"modelConfigDiff": [
  {
    "operation": "merge",
    "path": ["dataSources"],
    "values": {
      "UsrOrderHintsDS": {
        "type": "crt.VirtualDataSource",
        "config": {
          "virtualDataSourceType": "UsrOrderHintsDataSource",
          "primaryAttributeName": "Id",
          "primaryDisplayAttributeName": "Name",
          "parameters": {
            "Id": { "caption": "Id", "dataValueTypeName": "Guid" },
            "Name": { "caption": "Hint", "dataValueTypeName": "Text" }
          }
        }
      }
    }
  }
]
```

- `virtualDataSourceType` is the name passed to `@CrtVirtualDataSource`. When it is omitted, the data
  source's own name is used.
- `parameters` declares the attributes the source returns, each with a `caption` and a
  `dataValueTypeName`; `isRequired` and `referenceSchemaName` (for a lookup) are optional.
- `primaryAttributeName` and `primaryDisplayAttributeName` are required unless the parameters include
  `Id` and `Name`.
- Page attributes bind to it like to any data source: `"modelConfig": { "path": "UsrOrderHintsDS.Name" }`.

Read `get-guidance mobile-page-modification` for the exact diff shape the target page uses before
editing it.

### A list fed by a virtual data source

A source that feeds a list is declared with `"scope": "viewElement"`, next to the page's own data
source:

```json
"modelConfigDiff": [
  {
    "operation": "merge",
    "path": ["dataSources"],
    "values": {
      "UsrOrderHintsDS": {
        "type": "crt.VirtualDataSource",
        "scope": "viewElement",
        "config": {
          "virtualDataSourceType": "UsrOrderHintsDataSource",
          "primaryAttributeName": "Id",
          "primaryDisplayAttributeName": "Name",
          "parameters": {
            "Id": { "caption": "Id", "dataValueTypeName": "Guid" },
            "Name": { "caption": "Hint", "dataValueTypeName": "Text" },
            "Details": { "caption": "Details", "dataValueTypeName": "Text" }
          }
        }
      }
    }
  }
]
```

The list reads a collection attribute, and the attributes of one row are declared **inside** that
collection, not next to it:

```json
"viewModelConfigDiff": [
  {
    "operation": "merge",
    "path": ["attributes"],
    "values": {
      "UsrOrderHintsItems": {
        "isCollection": true,
        "modelConfig": { "path": "UsrOrderHintsDS" },
        "viewModelConfig": {
          "attributes": {
            "UsrOrderHintsDS_Id": { "modelConfig": { "path": "UsrOrderHintsDS.Id" } },
            "UsrOrderHintsDS_Name": { "modelConfig": { "path": "UsrOrderHintsDS.Name" } },
            "UsrOrderHintsDS_Details": { "modelConfig": { "path": "UsrOrderHintsDS.Details" } }
          }
        }
      }
    }
  }
]
```

The component names the collection and lays out one row from the row attributes:

```json
{
  "operation": "insert",
  "name": "UsrOrderHintsList",
  "parentName": "<container on the page>",
  "propertyName": "items",
  "index": 0,
  "values": {
    "type": "crt.List",
    "items": "$UsrOrderHintsItems",
    "scrollable": false,
    "blankSlateText": "#ResourceString(UsrOrderHintsList_blankSlateText)#",
    "itemLayout": {
      "type": "crt.ListItem",
      "name": "UsrOrderHintsListItem",
      "title": "$UsrOrderHintsDS_Name",
      "body": [],
      "subtitles": [
        { "name": "UsrOrderHintsDetails", "value": "$UsrOrderHintsDS_Details", "label": { "isVisible": true } }
      ],
      "showEmptyValues": false
    }
  }
}
```

A subtitle whose label is visible shows the `caption` of the source parameter it is bound to.

### Reloading the list from code

A source serves data when the page asks for it. After a handler changes what the source would return,
it asks the page to read that one source again:

```ts
import { HandlerChainService, LoadDataRequest, RefreshMode } from '@creatio/mobile-common';

await HandlerChainService.instance.process({
	type: 'crt.LoadDataRequest',
	$context: request.$context,
	scopes: request.scopes,
	refreshDataConfig: {
		mode: RefreshMode.RefreshSpecific,
		targetDataSourceNames: ['UsrOrderHintsDS'],
	},
} as LoadDataRequest);
```

`targetDataSourceNames` takes the data source names the page declares, not the registered class name.

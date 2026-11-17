# Mobile SDK guide

How to write the code of a remote module on `@creatio/mobile-common`. Read it together with the SDK's
own type declarations.

## The declarations are the API reference

The complete public API is in two files of the npm package:

- `index.d.ts` — everything a module imports, with doc comments;
- `CHANGELOG.md` — what recent versions added. It is not a complete history.

Before a project exists, read them from a packed archive: `npm pack @creatio/mobile-common@<version>`
into a scratch folder, unpack, and open `package/index.d.ts`. In a project they are under
`node_modules/@creatio/mobile-common/`.

The `README.md` inside the package describes build, inject and deploy scripts of the SDK's own
repository. They are not part of the published package: ignore them and follow `context/mobile-module-project-layout.md`.

Before using a class, a request or a service, search the declaration file for it and read its
signature. Do not write a call from memory of this guide or of the web SDK: the web package
(`@creatio-devkit/common`) is a different library with different names, and none of its imports exist
on mobile. Types the declarations re-export from `@creatio/base` (filters, expressions, `LookupValue`,
`BaseRequest`) are documented in `node_modules/@creatio/base/index.d.ts`.

Anything the declarations do not export does not exist for a module, whatever a web example shows.

## Runtime rules the declarations do not show

- **No DOM, no browser.** The script runs in the app's embedded JavaScript engine. There is no
  `window`, `document`, `localStorage` or `alert`. `setTimeout` exists.
- **`console` has `log`, `warn` and `error` only.** `console.info` and `console.debug` are undefined
  and calling them throws.
- **Every SDK call is asynchronous.** Reading an attribute, opening a dialog, loading data — each
  crosses into the native app. Always `await` them.
- **A handler instance lives for one call.** Fields set in `handle()` are gone by the next request.
  State that must outlive a call lives in a module-level variable.
- **Module state is one value for the whole app.** Every page and every record sees the same
  module-level variable, and it lasts until the app restarts — closing a page does not clear it. Key
  it by record when it belongs to a record, and plan for it being empty after a restart.
- **No `Intl`.** The engine on Android has no `Intl` object, and `toLocaleString` is not locale-aware
  there. Format dates and numbers by hand.
- **No network client.** The SDK offers no authenticated HTTP call. Reach the server through the data
  model, or through a business process started with `RunBusinessProcessRequest`.
- **A thrown error is logged without its origin.** The app log records the message and a line number,
  not the module or the handler. Start every error message with the module and handler name.
- **The app starts the module.** Evaluating the script registers the module class; the app then calls
  its `bootstrap()`. Nothing in the bundle calls it, and nothing should.
- **Names are global.** Every handler `type`, request `type`, data source name and module class name
  shares one namespace with all other modules on the device. A duplicate silently replaces the earlier
  registration. Make each one specific — the feature and the purpose: `usr.OrderSaveGuard`, not
  `usr.SaveHandler`. The naming rule in `runbooks/04-mobile-business-logic.md` says which names take the environment's schema prefix.

## Handlers

A handler intercepts one request type. Handlers for the same request form a chain; each decides whether
to pass the request on.

```ts
import {
	BaseRequestHandler,
	CrtRequestHandler,
	ExecutionContext,
	HandleViewModelAttributeChangeRequest,
} from '@creatio/mobile-common';

@CrtRequestHandler({
	requestType: 'crt.HandleViewModelAttributeChangeRequest',
	type: 'usr.OrderStatusChangeHandler',
	scopes: ['UsrOrder_MobileFormPage'],
})
export class UsrOrderStatusChangeHandler extends BaseRequestHandler<HandleViewModelAttributeChangeRequest> {
	public async handle(request: HandleViewModelAttributeChangeRequest): Promise<unknown> {
		const context = request.$context as ExecutionContext;
		if (request.attributeName === 'UsrStatus') {
			await context.setAttributePropertyValue('UsrCloseReason', 'required', true);
		}
		return this.next?.handle(request);
	}
}
```

- `requestType` — the request to intercept: a built-in `crt.*` request or a custom `usr.*` one.
- `type` — this handler's own unique name.
- `scopes` — where it runs (next section).
- `this.next?.handle(request)` continues the chain: the remaining custom handlers, then the app's
  built-in behaviour. Code before it runs before the built-in behaviour, code after it runs after.
  Return its result. Leave the call out only to stop the request on purpose — a save that must not
  happen, an action that is fully replaced.

### Scopes

| `scopes` | The handler runs for |
| --- | --- |
| `['<PageSchemaName>']` | the page and every nested view model on it (details, list items) |
| `['<PageSchemaName>_Root']` | the page's root view model only |
| `['<PageSchemaName>_Root_<DetailAttributeName>']` | one detail on the page |
| omitted or `[]` | every page of the app |

Use the schema name exactly as `get-page` returns it. A request carries the page's schema name
together with the names of the schemas it inherits from — a home page reports
`["BaseMobileHomePage", "FieldSalesMobileHomePage"]` — so a handler scoped to a parent schema runs on
every page derived from it. Scope to the most specific name unless the wider reach is the intent.
Inside a detail scope, `request.$context` is the
detail item: `request.$context['Id']` is the item's id, not the page record's. To reach the page from
there, use `request.$context.parent`.

### Which request to intercept

`get-request-info` with `schema-type: "mobile"` lists the built-in requests. The ones a module extends
most often:

| Moment | Request |
| --- | --- |
| The page loads or reloads its data | `crt.LoadDataRequest` |
| An attribute changes | `crt.HandleViewModelAttributeChangeRequest` (`attributeName`, `value`, `oldValue`) |
| The record is saved | `crt.SaveRecordRequest` |
| Unsaved changes are cancelled | `crt.CancelRecordChangesRequest` |
| The page closes after a save, a cancelled edit or a delete | `crt.ClosePageRequest` |
| A record is created, opened, copied, deleted | `crt.CreateRecordRequest`, `crt.UpdateRecordRequest`, `crt.CopyRecordRequest`, `crt.DeleteRecordRequest` |
| A detail item is created, changed, deleted | `crt.CreateListItemRequest`, `crt.UpdateListItemRequest`, `crt.DeleteListItemRequest` |
| The app synchronizes | `crt.AppSyncRequest` |

A request the SDK exports no class for is still interceptable: name it in `requestType` and type the
handler with `BaseRequest`. Its parameters arrive as plain properties of the request object.

Set values that depend on loaded data **after** the load: call `this.next?.handle(request)` first in a
`crt.LoadDataRequest` handler, then read and write attributes. Set filter attributes that shape the
load **before** it.

Leaving a page with the back arrow sends no request. A handler on `crt.ClosePageRequest` therefore
does not learn that the user went back, and nothing tells a module that a page is gone.

## Custom requests

A custom request is a named action with parameters.

```ts
import { BaseRequest, BaseRequestHandler, CrtRequest, CrtRequestHandler, ExecutionContext } from '@creatio/mobile-common';

@CrtRequest({ type: 'usr.ApplyDiscountRequest' })
export class UsrApplyDiscountRequest extends BaseRequest {
	public percent?: number;
}

@CrtRequestHandler({
	requestType: 'usr.ApplyDiscountRequest',
	type: 'usr.ApplyDiscountHandler',
})
export class UsrApplyDiscountHandler extends BaseRequestHandler<UsrApplyDiscountRequest> {
	public async handle(request: UsrApplyDiscountRequest): Promise<unknown> {
		const context = request.$context as ExecutionContext;
		const amount = Number(await context.getAttribute('UsrAmount')) || 0;
		await context.setAttribute('UsrAmount', amount * (1 - (request.percent ?? 0) / 100));
		return this.next?.handle(request);
	}
}
```

From a page, a component names the request and passes parameters:

```json
{
  "type": "crt.Button",
  "caption": "#ResourceString(UsrApplyDiscountButton_caption)#",
  "clicked": {
    "request": "usr.ApplyDiscountRequest",
    "params": { "percent": 10 }
  }
}
```

Parameter values may be attribute bindings (`"$UsrDiscountPercent"`); the app resolves them before the
handler runs. Do not put `type` or `scopes` into `params`.

From code, send any request — custom or built-in — through the chain:

```ts
import { HandlerChainService } from '@creatio/mobile-common';

await HandlerChainService.instance.process({
	type: 'usr.ApplyDiscountRequest',
	$context: request.$context,
	scopes: request.scopes,
	percent: 10,
} as UsrApplyDiscountRequest);
```

Always pass the current `$context`; pass `scopes` when the target handler is scoped.

## The page context

`request.$context` is the view model of the page (or of the detail item) the request came from. Its
declared type is an open map, so the compiler accepts any call on it, including a misspelt one. Cast it
once and use the typed methods:

```ts
const context = request.$context as ExecutionContext;

// Read and write attribute values. Both are asynchronous: await the write before going on.
const name = await context.getAttribute('Name');
await context.setAttribute('Name', 'New value');

// Lookup values are objects.
const type = (await context.getAttribute('Type')) as LookupValue | null;
await context.setAttribute('Type', { value: '<guid>', displayValue: 'Customer' } as LookupValue);

// Date values arrive as ISO 8601 strings; a Date or an ISO string may be written.
const dueDate = new Date(await context.getAttribute('DueDate'));

// Attribute properties: 'visible' | 'readonly' | 'required' | 'filter'.
await context.setAttributePropertyValue('UsrCloseReason', 'visible', true);
const isRequired = await context.getAttributePropertyValue('UsrCloseReason', 'required');

// Localized text from the page's resources; null when the key is not declared on that page.
const message = (await context.getResourceString('UsrAmountRequired_message')) ?? 'Enter the amount';
```

- A value written with `setAttribute` in a `crt.SaveRecordRequest` handler, before the next handler is
  called, is part of that same save.
- The short forms `await request.$context['Name']` and `request.$context['Name'] = value` also work,
  but the assignment cannot be awaited and neither form is type-checked. Prefer the methods.
- Attribute names are the page's view model attributes (`viewModelConfigDiff`), not entity column
  names, although they often match.
- `getResourceString` resolves against the page the context belongs to. The string has to be declared
  in the resources of the mobile page where the handler runs — a web page's strings are not there —
  and a fallback text is always needed.
- The record mode is in the `CardState` attribute (`CARD_STATE_ATTRIBUTE`): `add`, `edit` or `copy`.

### Lookup and detail filters

A lookup field's `filter` property narrows the values it offers. Set it after the page data loads:

```ts
const result = await this.next?.handle(request);
await request.$context.setAttributePropertyValue('Contact', 'filter', {
	filterType: 4,
	comparisonType: 3,
	isEnabled: true,
	trimDateTimeParameterToDate: false,
	leftExpression: { expressionType: 0, columnPath: 'Account' },
	rightExpressions: [{ expressionType: 2, parameter: { dataValueType: 10, value: '<account guid>' } }],
});
return result;
```

The numbers are the serialized values of the `FilterType`, `ComparisonType`, `ExpressionType` and
`DataValueType` enums the SDK exports; prefer building the filter with `CompareFilter`,
`ColumnExpression` and `ParameterExpression` and serializing it over typing numbers by hand.

A detail (embedded list) is filtered through a filter attribute: declare `filterAttributes` on the
detail's attribute in the page, then assign the filter object to that attribute in a
`crt.LoadDataRequest` handler before calling the next handler.

## Blocking a save

The SDK has no field validator. A module validates by intercepting the save:

```ts
import {
	BaseDialogConfig,
	BaseRequestHandler,
	CrtRequestHandler,
	DialogService,
	ExecutionContext,
	SaveRecordRequest,
} from '@creatio/mobile-common';

const ERROR_PREFIX = 'UsrOrderLogic.UsrOrderSaveGuard';

@CrtRequestHandler({
	requestType: 'crt.SaveRecordRequest',
	type: 'usr.OrderSaveGuard',
	scopes: ['UsrOrder_MobileFormPage'],
})
export class UsrOrderSaveGuard extends BaseRequestHandler<SaveRecordRequest> {
	public async handle(request: SaveRecordRequest): Promise<unknown> {
		let isSaveAllowed: boolean;
		try {
			isSaveAllowed = await this.check(request.$context as ExecutionContext);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(`${ERROR_PREFIX}: ${reason}`);
		}
		if (!isSaveAllowed) {
			// The save is not passed down the chain: the record stays unsaved and the page stays in edit mode.
			return undefined;
		}
		return this.next?.handle(request);
	}

	private async check(context: ExecutionContext): Promise<boolean> {
		const amount = Number(await context.getAttribute('UsrAmount'));
		if (amount > 0) {
			return true;
		}
		const config: BaseDialogConfig = {
			message: 'Amount must be greater than zero',
			actions: [{ key: 'ok', config: { caption: 'OK', color: 'primary' } }],
		};
		await new DialogService(context).open(config);
		return false;
	}
}
```

- Returning without calling the next handler is what blocks the save; return `undefined`.
- The dialog's `title` is optional. A dialog with a message and one button is enough for a refusal.
- The app log records a thrown error without its origin, so the handler's own part is wrapped and
  rethrown with the module and handler name in front. The call to the next handler stays outside the
  wrapper, so an error of the built-in save is not relabelled.
- The check runs on the device, online and offline. It covers a save the user starts on this page;
  records written elsewhere — another page, an import, a process — do not pass through it. It does not
  mark the field; when the requirement is "required when …", a business rule does that without code.

## Services

Create each service with `new`; there is no dependency injection.

| Service | Use |
| --- | --- |
| `DialogService(context).open(config)` | A dialog with action buttons; resolves to the chosen action's `key`. Treat a null result as "dismissed". Use it from module code; `crt.ShowDialogRequest` is the form a page binding uses. |
| `ModalPresenter.showSnackBar(title, message)` | A short non-blocking message |
| `MaskService` | `showMask(task, context)` / `hideMask(task, context)` for a page-level busy indicator; `showFullScreenMask(task)` / `hideFullScreenMask(task)` to block the whole app. Always hide in a `finally` block. |
| `SysSettingsService.getValueByCode(code, default)` | A system setting value |
| `GeolocationService.getCurrentCoordinates(accuracy, options)` | Device coordinates; check `errorCode` on the result |
| `BarcodeScanService.scan()` | Barcode or QR code; check `type` before reading `rawContent` |
| `NfcScanService.scan()` | NFC tag; check `type` before reading `rawData` |
| `Logger.console(message)` | Development-time output to the device's system log (`adb logcat`); never in the app log that **Send log** sends |

Device services can be refused by the user or be unavailable on the device. Handle the error and
cancelled results; never assume a scan or a location succeeds.

## Data model

`Model` reads and writes records of an entity from code.

```ts
import {
	ColumnExpression,
	CompareFilter,
	ComparisonType,
	Model,
	ModelParameterType,
	ParameterExpression,
} from '@creatio/mobile-common';

const model = await Model.create('Contact');

const contacts = await model.load({
	attributes: ['Id', 'Name'],
	parameters: [
		{
			type: ModelParameterType.Filter,
			value: new CompareFilter(
				ComparisonType.Equal,
				new ColumnExpression({ columnPath: 'Account' }),
				new ParameterExpression({ value: accountId }),
			),
		},
	],
	loadOptions: { pagingConfig: { rowsOffset: 0, rowCount: 20 } },
});

await model.insert({ Name: 'New contact', Account: accountId });
await model.update({ Name: 'Renamed' }, [{ type: ModelParameterType.PrimaryColumnValue, value: contactId }]);
await model.delete([{ type: ModelParameterType.PrimaryColumnValue, value: contactId }]);
```

- A lookup column is written as the id of the referenced record.
- `load` returns plain objects keyed by the requested attributes.
- Check the `success` flag of the result of `insert`, `update` and `delete`.

### Online and offline

A device may hold a local copy of the data and work without a connection. Reads and writes accept a
cache operation that says where they go:

```ts
import { CacheDataType, ReadCacheMode } from '@creatio/mobile-common';

const loadOptions = {
	cacheOperation: {
		updateCache: true,
		readCacheMode: ReadCacheMode.ForceLocal,
		cacheDataType: CacheDataType.Partial,
	},
};
```

- `ReadCacheMode.Auto` lets the app decide; with no connection it may try the server and fail.
- `ReadCacheMode.ForceLocal` reads the device copy and works with no connection. Use it for logic that
  must run offline, and only for entities the workplace synchronizes to the device.
- `ReadCacheMode.ForceRemote` / `Remote` read the server and fail without a connection.

State in the plan whether the logic works offline. A handler that needs the server must catch the
failure and tell the user, not leave the page hanging.

## Calling the server

Start a business process and, when needed, read its output parameters:

```ts
import { HandlerChainService, RunBusinessProcessRequest } from '@creatio/mobile-common';

const result = await HandlerChainService.instance.process({
	type: 'crt.RunBusinessProcessRequest',
	$context: request.$context,
	processName: 'UsrRecalculateOrder',
	processParameters: { OrderId: orderId },
	resultParameterNames: ['Total'],
	showNotification: false,
} as RunBusinessProcessRequest);
```

The process runs on the server, so this needs a connection, and the request is available only in app
versions whose SDK lists it in the changelog. Read the request's declaration for the full parameter
set.

## Navigation

Navigation is done by sending the built-in requests through `HandlerChainService`:

| Action | Request and main parameters |
| --- | --- |
| Open a page | `crt.OpenPageRequest` — `schemaName` |
| Open a record | `crt.UpdateRecordRequest` — `entityName`, `recordId` |
| Create a record | `crt.CreateRecordRequest` — `entityName`, `defaultValues: [{ attributeName, value }]` |
| Copy a record | `crt.CopyRecordRequest` — `entityName`, `recordId` |
| Pick from a lookup | `crt.OpenLookupPageRequest` — `entitySchemaName`, `features`, `filtersConfig`; resolves to the selected values |
| Reload data | `crt.LoadDataRequest` — optional `dataSourceName` |
| Close the page | `crt.ClosePageRequest` |
| Cancel unsaved changes | `crt.CancelRecordChangesRequest` |
| Save | `crt.SaveRecordRequest` |

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

## The module class

One class per project ties everything together; see `context/mobile-module-project-layout.md` for the entry file. The name
passed to `bootstrapCrtModule` equals the project folder name and the class name.

## Before the build

- [ ] Every handler extends `BaseRequestHandler` and carries `@CrtRequestHandler` with a unique `type`.
- [ ] Every custom request extends `BaseRequest` and carries `@CrtRequest`.
- [ ] Every handler and data source is listed in `@CrtModule`.
- [ ] `this.next?.handle(request)` is called and returned, except where stopping is the intent.
- [ ] Scopes are the mobile page schema names read from the environment.
- [ ] Every attribute and component name the code addresses exists on the page.
- [ ] No `window`, `document`, `console.info`, `console.debug`, `fetch`-based server call or web SDK
      import.
- [ ] Device services and server calls handle refusal, cancellation and a missing connection.
- [ ] State kept at module level is keyed by what it belongs to, and nothing depends on a page closing
      to clear it.
- [ ] Dates and numbers are formatted without `Intl`.
- [ ] Attribute reads and writes go through a typed `ExecutionContext` and every write is awaited.
- [ ] Every thrown error message starts with the module and handler name.
- [ ] The rule itself is a plain function the local behaviour check can run.
- [ ] Temporary diagnostic dialogs are removed.

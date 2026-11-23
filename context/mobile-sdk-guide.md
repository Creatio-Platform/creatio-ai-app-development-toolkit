# Mobile SDK guide

How to write the code of a remote module on `@creatio/mobile-common`. Read it together with the SDK's
own type declarations.

## Parts read for the mechanism

This guide holds what every module needs. Each mechanism the plan uses has its own part with the
rules and a worked example; read the parts the plan needs, and only those.

| The plan has | Read |
| --- | --- |
| A button or a menu item that runs an action | `context/mobile-sdk/custom-requests.md` |
| An attribute the module computes — a caption, a text, a visibility flag | `context/mobile-sdk/computed-text.md` |
| A check that stops a save | `context/mobile-sdk/blocking-save.md` |
| Records the module reads or writes, offline behaviour, a business process started from a handler | `context/mobile-sdk/data-and-server.md` |
| Data no entity holds, a list fed by the module | `context/mobile-sdk/virtual-data-sources.md` |

## The declarations are the API reference

The complete public API is in two files of the npm package:

- `index.d.ts` — everything a module imports, with doc comments;
- `CHANGELOG.md` — what recent versions added and which app each of them needs. It is not a complete
  history.

Before a project exists, read them from a packed archive: `npm pack @creatio/mobile-common@<version>`
into a scratch folder, unpack, and open `package/index.d.ts`. In a project they are under
`node_modules/@creatio/mobile-common/`.

Before using a class, a request or a service, search the declaration file for it and read its
signature. Do not write a call from memory of this guide or of the web SDK: the web package
(`@creatio-devkit/common`) is a different library with different names, and none of its imports exist
on mobile. Types the declarations re-export from `@creatio/base` (filters, expressions, `LookupValue`,
`BaseRequest`) are documented in `node_modules/@creatio/base/index.d.ts`.

Anything the declarations do not export does not exist for a module, whatever a web example shows.

**An API exists on a device only from the app version that brought it.** `CHANGELOG.md` has one
heading per package release, the entries under it are the API that arrived with it, and a heading
names the Creatio Mobile version that release requires when it has one. Before using a class, a
request or a service, find the entry that added it: the newest such entry sets the app version the
module needs, and the plan states it. A member the declarations mark `@deprecated` in favour of a newer one is still the only one
an older app has, so keep using it unless the plan already requires the app version of its
replacement.

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
  `usr.SaveHandler`. Every name carries the customer prefix; the naming rule in `runbooks/04-mobile-business-logic.md` says which one.

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
| `['<PageSchemaName>']` | requests of that page |
| `['<TemplateSchemaName>']` | requests of every page built on that template |
| omitted or `[]` | every page of the app, and every row of a list or a detail |

Use the schema name exactly as `get-page` returns it. A request of a Freedom UI page carries the
names of the templates the page is built on, followed by the page's own schema name — a home page
reports `["BaseMobileHomePage", "FieldSalesMobileHomePage"]` — and a handler runs when one of its
scopes is in that list. A handler scoped to a template therefore runs on every page derived from
it. Scope to the page's own name unless the wider reach is the intent.

A row of a list or a detail is a view model of its own, and it carries no scopes. A request that is
processed on a row — a change of one of its attributes — reaches only handlers declared without
`scopes`. Such a handler runs on every page of the app, so it first tells whether the request is
its own, by the attributes it finds. There `request.$context` is the row:
`request.$context['Id']` is the row's id, not the page record's, and `request.$context.parent`
is the page.

The suffixes `_Root` and `_Root_<DetailAttributeName>` belong to pages of the classic mobile wizard.
A Freedom UI page never reports them, so a handler scoped to `<PageSchemaName>_Root` never runs
there.

Scopes work on a mobile Freedom UI page as they do on a web one. A handler written in a web page's
own `handlers` section runs for that page only; when porting it, scope the mobile handler to the
mobile page's schema name.

### The order of handlers

Handlers of one request run from the most specific to the least: those scoped to the page, then
those scoped to a template, then the unscoped ones, and the app's built-in behaviour last.

Among handlers with the same scope the order follows the package hierarchy, as it does on a web
page: the handler of a package runs before the handlers of the packages it depends on.

- A handler that must run before another package's handler belongs to a package that depends on
  that package. Add the dependency to the package's `descriptor.json` and name it in the plan.
- Packages that do not depend on one another, directly or through other packages, give no order to
  rely on, and two modules of one package have no defined order. Make such handlers correct
  whichever of them runs first.
- A handler cannot change the request for the handlers after it: each receives the request as it was
  sent. To pass something on, write a page attribute.

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

// Date values arrive as ISO 8601 strings, and an empty one as undefined. Write the UTC form.
const dueValue = await context.getAttribute('DueDate');
const dueDate = dueValue ? new Date(dueValue) : null;
await context.setAttribute('DueDate', new Date().toISOString());

// Attribute properties: 'visible' | 'readonly' | 'required' | 'filter'.
await context.setAttributePropertyValue('UsrCloseReason', 'visible', true);
const isRequired = await context.getAttributePropertyValue('UsrCloseReason', 'required');

// Localized text from the page's resources; null when the key is not declared on that page.
const message = (await context.getResourceString('UsrAmountRequired_message')) ?? 'Enter the amount';
```

- A value written with `setAttribute` in a `crt.SaveRecordRequest` handler, before the next handler is
  called, is part of that same save.
- **An attribute with no value reads as `undefined`** — an empty date, an empty lookup, a field that
  was never filled. Test for `undefined` and `null` together.
- **Dates.** A date arrives as an ISO 8601 string in one of two shapes: in UTC with a `Z`
  (`2026-01-15T10:00:00.000Z`), or without a zone (`2026-01-15T00:00:00.000`) — the shape of a value
  the user has just picked in a date-only field. `new Date(value)` reads both correctly — the first
  as UTC, the second as the device's local time — so compare calendar days through the local getters
  (`getFullYear`, `getMonth`, `getDate`), which is the day the user sees on the page. Write a date
  as `toISOString()` produces it.
- The context also has `get(name)` and `set(name, value, options?)`, and the declarations mark
  `getAttribute` / `setAttribute` as deprecated aliases of them. An app older than the release that
  added `get` / `set` has only `getAttribute` / `setAttribute`, so a module that must run there uses
  those, as the examples in this guide do. Use `set` when the logic needs its options, and state in the
  plan the app version that the `CHANGELOG.md` entry for `get` / `set` names:
  - `preventStateChange` — the value is saved with the next save, but writing it does not mark the
    record as changed;
  - `preventRunBusinessRules` — the page's business rules do not run for this write;
  - `preventAttributeChangeRequest` — no `crt.HandleViewModelAttributeChangeRequest` is sent for
    this write.

  A write without options does all three: it marks the record as changed when the attribute is bound
  to a data source, runs the business rules and sends the change request.
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

## The module class

One class per project ties everything together; see `context/mobile-module-project-layout.md` for the entry file. The name
passed to `bootstrapCrtModule` equals the project folder name and the class name.

## Before the build

- [ ] Every handler extends `BaseRequestHandler` and carries `@CrtRequestHandler` with a unique `type`.
- [ ] Every custom request extends `BaseRequest` and carries `@CrtRequest`.
- [ ] Every handler and data source is listed in `@CrtModule`.
- [ ] `this.next?.handle(request)` is called and returned, except where stopping is the intent.
- [ ] Scopes are the mobile page schema names read from the environment, with no `_Root` suffix.
- [ ] A handler that must run before another package's handler sits in a package that depends on
      that package; no other order between modules is relied on.
- [ ] Empty values are handled as `undefined`, and dates are compared by the device's calendar day.
- [ ] Every attribute and component name the code addresses exists on the page.
- [ ] No `window`, `document`, `console.info`, `console.debug`, `fetch`-based server call or web SDK
      import.
- [ ] Device services and server calls handle refusal, cancellation and a missing connection.
- [ ] State kept at module level is keyed by what it belongs to, and nothing depends on a page closing
      to clear it.
- [ ] Dates and numbers are formatted without `Intl`.
- [ ] Every class, request and service the module uses arrived no later than the app version the plan
      names; `CHANGELOG.md` says which version added it.
- [ ] Attribute reads and writes go through a typed `ExecutionContext` and every write is awaited.
- [ ] Every thrown error message starts with the module and handler name.
- [ ] The rule itself is a plain function the local behaviour check can run.
- [ ] Temporary diagnostic dialogs are removed.

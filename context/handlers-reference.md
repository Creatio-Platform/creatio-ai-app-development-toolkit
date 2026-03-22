# Handler Reference for Freedom UI Pages

## Source Format vs Runtime

When working through MCP page tools, handlers are edited as part of the page JavaScript body:

```javascript
handlers: /**SCHEMA_HANDLERS*/[
	{
		request: "crt.HandleViewModelInitRequest",
		handler: async (request, next) => {
			return next?.handle(request);
		}
	}
]/**SCHEMA_HANDLERS*/
```

This source format is different from the frontend TypeScript runtime implementation:

- page schemas store handler code in the JS body and marker sections
- the frontend executes requests through a handler chain at runtime
- for `page.get/page.update` tasks, keep editing the page body markers rather than switching to standalone TypeScript `@CrtRequestHandler` classes unless the task explicitly targets frontend source code

## Runtime Execution Model

Freedom UI executes handler logic through a request chain:

```text
UI action or page lifecycle event
→ clicked.request or runtime-generated request
→ request.$context.executeRequest(request)
→ HandlerChainService.process(request)
→ matching handlers for request type and scope
→ next?.handle(request) continues the chain
```

Key runtime facts confirmed by frontend investigation:

- `request.$context.executeRequest(...)` is the normal entry point for programmatic requests
- runtime auto-populates `$context` and scopes before request processing
- handlers are matched by request type and scope
- `next?.handle(request)` is optional and controls whether the chain continues
- chain handling supports lazy loading, scope filtering, and caching

## Page Body Handler Structure

Each handler entry in the page body contains:

- `request` — the request type string
- `handler` — an async function with `(request, next)`

```javascript
handlers: /**SCHEMA_HANDLERS*/[
	{
		request: "crt.HandleViewModelAttributeChangeRequest",
		handler: async (request, next) => {
			if (request.attributeName !== "PDS_UsrStatus") {
				return next?.handle(request);
			}
			const status = await request.$context.PDS_UsrStatus;
			request.$context.IsCompletedVisible = status?.displayValue === "Completed";
			return next?.handle(request);
		}
	}
]/**SCHEMA_HANDLERS*/
```

## Module Imports in Page Body

If page-body handler code uses external APIs, update `SCHEMA_DEPS` and `SCHEMA_ARGS` in the same edit:

```javascript
define("UsrMyApp_FormPage",
	/**SCHEMA_DEPS*/["@creatio-devkit/common"]/**SCHEMA_DEPS*/,
	function/**SCHEMA_ARGS*/(sdk)/**SCHEMA_ARGS*/ {
		return { /* handlers can use sdk.HttpClientService, sdk.Model, etc. */ };
	}
);
```

Treat `SCHEMA_DEPS` and `SCHEMA_ARGS` as source-module imports for page-body editing. Their presence in page schemas does not conflict with the separate TypeScript decorator-based runtime infrastructure.

Import rules:

- prefer `@creatio-devkit/common` for SDK services in page-body handlers
- reuse the existing alias from the live page body (`sdk`, `devkit`, or another already-present alias)
- do not rename the alias just for style consistency if the current page already uses one
- if the live page already imports a compatible SDK package, extend that import conservatively instead of rewriting the module header
- for the exhaustive catalog of allowed `sdk.*` exports, see `context/devkit-common-reference.md`

## Business Intent → Request Type Mapping

| User Says / Business Intent | Request Type | Notes |
|---|---|---|
| "on page load", "when page opens", "on init" | `crt.HandleViewModelInitRequest` | Fires during page initialization |
| "when page closes", "on cleanup" | `crt.HandleViewModelDestroyRequest` | Cleanup subscriptions and UI state |
| "before save", "validate before saving" | `crt.SaveRecordRequest` | Return early without `next` to cancel save |
| "save many records" | `crt.SaveRecordsRequest` | Batch save scenarios when present |
| "when creating new record", "set defaults for new" | `crt.CreateRecordRequest` | Fires for record creation flow |
| "before delete", "confirm deletion" | `crt.DeleteRecordRequest` | Return early without `next` to cancel delete |
| "when field changes", "when value updates" | `crt.HandleViewModelAttributeChangeRequest` | Filter by `request.attributeName` |
| "reload data", "load lookup/list again" | `crt.LoadDataRequest` | Programmatic reloads and data refreshes |
| "open another page", "navigate to" | `crt.OpenPageRequest` | Custom navigation logic |
| "close page" | `crt.ClosePageRequest` | Confirm unsaved changes or cleanup |
| "run business process", "start process" | `crt.RunBusinessProcessRequest` | Trigger business process from UI |
| "sidebar initialization" | `crt.SidebarInitRequest` | Use only when the live page/runtime scenario requires it |
| "open signature capture" | `crt.OpenSignatureServiceRequest` | Specialized request type when explicitly needed |

If the user specifies a request type not listed here, use it as-is when it matches live page/runtime evidence.

## Page Context APIs

### Reading and writing attributes

```javascript
const name = await request.$context.PDS_UsrName;
request.$context.PDS_UsrName = "Updated value";

const status = await request.$context.PDS_UsrStatus;
const statusId = status?.value;
const statusText = status?.displayValue;
```

Read attribute values with `await`. Lookup values are typically objects with `.value` and `.displayValue`.

### Programmatic request execution

Use `request.$context.executeRequest(...)` to trigger secondary requests from inside a handler:

```javascript
{
	request: "crt.HandleViewModelInitRequest",
	handler: async (request, next) => {
		await next?.handle(request);
		await request.$context.executeRequest({
			type: "crt.OpenPageRequest",
			schemaName: "UsrOther_FormPage"
		});
	}
}
```

Prefer this over ad hoc helper patterns when you need to launch a standard Creatio request from handler logic.

### Controlled attribute updates

Use `setValue(...)` when you need to update attributes while controlling side effects:

```javascript
await request.$context.setValue(
	{
		PDS_UsrStatus: {
			value: someId,
			displayValue: "In Progress"
		}
	},
	{
		preventAttributeChangeRequest: true,
		preventStateChange: true,
		preventRunBusinessRules: true
	}
);
```

Useful flags:

- `preventAttributeChangeRequest`
- `preventStateChange`
- `preventRunBusinessRules`

### Dynamic validation and UI state

Use `setAttributePropertyValue(...)` for runtime validation and control-state updates:

```javascript
await request.$context.setAttributePropertyValue("PDS_UsrDueDate", "required", true);
await request.$context.setAttributePropertyValue("PDS_UsrDueDate", "visible", true);
```

Prefer this and business rules over inventing unsupported validation flows inside `converters` or `validators`.

## Common `@creatio-devkit/common` Recipes

These patterns are verified in real page schemas from `~/Projects/ps` and are safe high-value defaults when the scenario calls for SDK usage. They are intentionally a practical subset; for the full export inventory with short API descriptions, see `context/devkit-common-reference.md`.

### `HttpClientService` for REST calls

Use for REST endpoints when a handler needs external or internal HTTP access:

```javascript
{
	request: "crt.HandleViewModelInitRequest",
	handler: async (request, next) => {
		const httpClientService = new sdk.HttpClientService();
		const response = await httpClientService.get("rest/MyService/MyMethod");
		request.$context.ResultText = response.body?.result;
		return next?.handle(request);
	}
}
```

### `SysValuesService` for current user and environment values

Useful for defaults, current user info, and timezone-dependent initialization:

```javascript
{
	request: "crt.HandleViewModelInitRequest",
	handler: async (request, next) => {
		const sysValuesService = new sdk.SysValuesService();
		const sysValues = await sysValuesService.loadSysValues();
		request.$context.CurrentUserName = sysValues.userContact?.displayValue;
		return next?.handle(request);
	}
}
```

### `SysSettingsService` for feature-like configuration

Use for reading or updating system settings:

```javascript
{
	request: "usr.IncreaseCounterRequest",
	handler: async (request, next) => {
		const sysSettingsService = new sdk.SysSettingsService();
		const counter = await sysSettingsService.getByCode("UsrCounter");
		await sysSettingsService.update({
			code: "UsrCounter",
			value: Number(counter.value) + 1
		});
		return next?.handle(request);
	}
}
```

### `RightsService` for permission-driven UI

Use to drive visibility or availability of UI actions:

```javascript
{
	request: "crt.HandleViewModelInitRequest",
	handler: async (request, next) => {
		const rightsService = new sdk.RightsService();
		request.$context.CanImportFromExcel = await rightsService.getCanExecuteOperation("CanImportFromExcel");
		return next?.handle(request);
	}
}
```

### `Model.create` with `FilterGroup` for data queries

Use when handler logic must query records directly:

```javascript
{
	request: "usr.LoadContactsRequest",
	handler: async (request, next) => {
		const contactModel = await sdk.Model.create("Contact");
		const filters = new sdk.FilterGroup();
		await filters.addSchemaColumnFilterWithParameter(
			sdk.ComparisonType.Equal,
			"Address",
			await request.$context.FilterText
		);
		const contacts = await contactModel.load({
			attributes: ["Id", "Name"],
			parameters: [
				{
					type: sdk.ModelParameterType.Filter,
					value: filters
				}
			]
		});
		request.$context.ResultJson = JSON.stringify(contacts);
		return next?.handle(request);
	}
}
```

Typical building blocks:

- `sdk.Model.create("SchemaName")`
- `new sdk.FilterGroup()`
- `sdk.ComparisonType.*`
- `sdk.ModelParameterType.Filter`

### `ProcessEngineService` for explicit process control

Use only when the handler must start or complete a process directly:

```javascript
{
	request: "usr.StartProcessRequest",
	handler: async (request, next) => {
		const service = new sdk.ProcessEngineService();
		const result = await service.executeProcessByName("UsrMyProcess", { RunMode: 1 });
		request.$context.ProcessId = result.processId;
		return next?.handle(request);
	}
}
```

This is more specialized than `crt.RunBusinessProcessRequest`. Prefer the declarative request first unless the scenario needs explicit service-level control.

## Handler Chain Rules

### Default pattern: preserve the chain

This is the normal pattern when your handler extends behavior but should not replace the platform flow:

```javascript
{
	request: "crt.HandleViewModelInitRequest",
	handler: async (request, next) => {
		await next?.handle(request);
		request.$context.PDS_UsrStatus = "New";
	}
}
```

### Conditional pattern: stop or continue based on context

Use this when your handler may intentionally skip default behavior:

```javascript
{
	request: "crt.SaveRecordRequest",
	handler: async (request, next) => {
		const name = await request.$context.PDS_UsrName;
		if (!name || name.trim() === "") {
			return;
		}
		return next?.handle(request);
	}
}
```

### Cleanup pattern: call `next` in `finally`

Use this when cleanup or downstream teardown must still run:

```javascript
{
	request: "crt.SaveRecordRequest",
	handler: async (request, next) => {
		try {
			return await next?.handle(request);
		} finally {
			request.$context.IsSaving = false;
		}
	}
}
```

If cleanup must happen after custom logic and the chain must still continue, call `await next?.handle(request)` inside `finally`.

### Practical rules

- By default, call `await next?.handle(request)`
- Omit `next` only when you intentionally cancel or override the default flow
- Use optional chaining because your handler can be the last one in the chain
- Prefer `return next?.handle(request)` when the handler only delegates
- Filter attribute-change handlers early by `request.attributeName`

## Declarative UI Actions vs Handlers

Requests declared in `viewConfigDiff` enter the same request ecosystem:

```json
{
	"operation": "merge",
	"name": "SaveButton",
	"values": {
		"clicked": [
			{"request": "crt.SaveRecordRequest", "params": {"showSuccessMessage": true}},
			{"request": "crt.LoadDataRequest", "params": {"config": {"loadType": "reload"}, "dataSourceName": "PDS"}}
		]
	}
}
```

Use declarative `clicked.request` when the action can be expressed directly in `viewConfigDiff`. Use page handlers when you need branching logic, runtime checks, attribute coordination, or programmatic follow-up requests.

## Converters and Validators Status

The page source format exposes:

- `converters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/`
- `validators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/`

Current frontend investigation did not confirm them as the primary Freedom UI page-level mechanism for runtime logic or validation. For new work, prefer:

1. handlers
2. business rules
3. attribute property APIs such as `setAttributePropertyValue(...)`
4. controlled `setValue(...)` updates

If a live page already contains `converters` or `validators`, preserve them and edit them conservatively as object sections. Do not invent large new converter/validator structures without concrete schema evidence from the target page.

## Completion Notifications, Scopes, and Advanced Runtime Notes

- handler execution can be scope-specific
- request processing supports lazy loading and caching internally
- completion notification patterns exist in the frontend runtime and can be useful for advanced UX flows
- decorator-based runtime patterns such as scoped handlers or completion notifiers should not be invented inside page-body MCP edits unless the task explicitly targets frontend source code or the live implementation already uses them

These are advanced capabilities. Only surface them in generated page logic when the scenario explicitly calls for them.

## MCP Page Editing Workflow

Use these MCP tools to read and edit handler logic in deployed pages:

1. `page.list` — discover pages
2. `page.get` — read metadata and raw JS body
3. edit `handlers`, `SCHEMA_DEPS`, `SCHEMA_ARGS`, and related sections in one pass
4. `page.update(..., dryRun: True)`
5. `page.update(...)`

When editing handler logic through MCP:

- preserve all marker pairs
- keep the AMD wrapper intact
- update imports together with handler code
- do not replace unrelated handlers
- preserve existing `converters` and `validators` object keys unless the task explicitly changes them

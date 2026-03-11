# Handler Reference for Freedom UI Pages

## Handler Structure

Handlers are defined in the `handlers` section of a Freedom UI page schema. Each handler object has a `request` property (event name) and a `handler` async function.

```javascript
handlers: /**SCHEMA_HANDLERS*/[
    {
        request: "crt.HandleViewModelInitRequest",
        handler: async (request, next) => {
            // Your initialization logic here
            await next?.handle(request);
        }
    }
]/**SCHEMA_HANDLERS*/
```

## Business Intent → Request Type Mapping

Use this table to map user requirements to the correct handler request type:

| User Says / Business Intent | Request Type | Notes |
|---|---|---|
| "on page load", "when page opens", "on init" | `crt.HandleViewModelInitRequest` | Fires once during page initialization |
| "before save", "validate before saving" | `crt.SaveRecordRequest` | Return early (no `next`) to cancel save |
| "when creating new record", "set defaults for new" | `crt.CreateRecordRequest` | Fires when "Add" is clicked |
| "before delete", "confirm deletion" | `crt.DeleteRecordRequest` | Return early to cancel delete |
| "when field changes", "when value updates" | `crt.HandleViewModelAttributeChangeRequest` | Check `request.attributeName` to filter |
| "when page closes", "on cleanup" | `crt.HandleViewModelDestroyRequest` | Cleanup subscriptions/timers |
| "open another page", "navigate to" | `crt.OpenPageRequest` | Custom navigation logic |
| "run business process", "start process" | `crt.RunBusinessProcessRequest` | Trigger server-side BP |
| "show notification", "show message" | Use `request.$context.executeRequest()` inside any handler | See "Executing Requests Programmatically" below |

## Module Imports (SCHEMA_DEPS ↔ Handlers Correlation)

When a handler uses external APIs, the required module must be in SCHEMA_DEPS and the corresponding argument in SCHEMA_ARGS.

| Feature Used in Handler | Required SCHEMA_DEPS | SCHEMA_ARGS Parameter |
|---|---|---|
| `@creatio-devkit/common` SDK (HTTP, dialogs, etc.) | `"@creatio-devkit/common"` | `sdk` or `devkit` |
| CSS stylesheet | `"css!SchemaName"` | *(none — CSS imports have no argument)* |
| No external APIs needed | `[]` (empty array) | `()` (empty parens) |

**Example — deps + args when using SDK:**
```javascript
define("UsrMyApp_FormPage",
    /**SCHEMA_DEPS*/["@creatio-devkit/common"]/**SCHEMA_DEPS*/,
    function/**SCHEMA_ARGS*/(sdk)/**SCHEMA_ARGS*/ {
        return { /* ... */ };
    }
);
```

**IMPORTANT:** When updating handlers to use SDK features, you must ALSO update SCHEMA_DEPS and SCHEMA_ARGS if they don't already include the required import. Use `page.get` to check current deps first.

## Common Request Types

### Page Lifecycle

| Request Type | When Fired | Common Use |
|---|---|---|
| `crt.HandleViewModelInitRequest` | Page initialization | Set default values, load data, check features |
| `crt.HandleViewModelDestroyRequest` | Page destruction | Cleanup subscriptions |

### Data Operations

| Request Type | When Fired | Common Use |
|---|---|---|
| `crt.SaveRecordRequest` | Before saving record | Custom validation, field transformation |
| `crt.CreateRecordRequest` | Before creating new record | Set defaults for new records |
| `crt.DeleteRecordRequest` | Before deleting record | Confirmation, cascade logic |

### Navigation

| Request Type | When Fired | Common Use |
|---|---|---|
| `crt.OpenPageRequest` | Opening a page | Custom navigation logic |
| `crt.ClosePageRequest` | Closing a page | Cleanup, confirm unsaved changes |

### UI Interactions

| Request Type | When Fired | Common Use |
|---|---|---|
| `crt.HandleViewModelAttributeChangeRequest` | Attribute value changes | Computed fields, visibility rules |
| `crt.RunBusinessProcessRequest` | Running a business process | Start process from UI |

## Creatio Client-Side APIs (Freedom UI)

Freedom UI uses **declarative request-based patterns**, not imperative method calls. Key APIs available inside handlers:

### Accessing Page Attributes
```javascript
// Read attribute value (always await — values are async)
const value = await request.$context.PDS_UsrName;

// Write attribute value
request.$context.PDS_UsrName = "new value";

// Read lookup display value
const status = await request.$context.PDS_UsrStatus;
const displayText = status?.displayValue;
```

### Feature Flags
```javascript
const isEnabled = Terrasoft?.Features?.getIsEnabled?.("MyFeatureFlag");
```

### Button Click Actions (Declarative — in viewConfigDiff, not handlers)
```json
{
    "operation": "merge",
    "name": "SaveButton",
    "values": {
        "clicked": [
            {"request": "crt.SaveRecordRequest", "params": {"showSuccessMessage": true}},
            {"request": "crt.SaveAccessRightsChangesRequest", "params": {"recordId": "$Id"}}
        ]
    }
}
```

### HTTP Requests (requires `@creatio-devkit/common` in deps)
```javascript
const httpClientService = new sdk.HttpClientService();
const response = await httpClientService.get("rest/MyService/MyMethod");
```

## Handler Patterns

### Setting Default Values on Init
```javascript
{
    request: "crt.HandleViewModelInitRequest",
    handler: async (request, next) => {
        await next?.handle(request);
        request.$context.SomeAttribute = "default value";
    }
}
```

### Feature Flag Check
```javascript
{
    request: "crt.HandleViewModelInitRequest",
    handler: async (request, next) => {
        await next?.handle(request);
        const isEnabled = Terrasoft?.Features?.getIsEnabled?.("MyFeatureFlag");
        request.$context.IsFeatureVisible = isEnabled === true;
    }
}
```

### Custom Save Validation
```javascript
{
    request: "crt.SaveRecordRequest",
    handler: async (request, next) => {
        const name = await request.$context.PDS_UsrName;
        if (!name || name.trim() === "") {
            // Return without calling next to cancel save
            return;
        }
        await next?.handle(request);
    }
}
```

### Reacting to Attribute Changes
```javascript
{
    request: "crt.HandleViewModelAttributeChangeRequest",
    handler: async (request, next) => {
        await next?.handle(request);
        if (request.attributeName === "PDS_UsrStatus") {
            const status = await request.$context.PDS_UsrStatus;
            request.$context.IsCompletedVisible = status?.displayValue === "Completed";
        }
    }
}
```

### Executing Requests Programmatically
Use `request.$context.executeRequest()` to invoke any Creatio request from inside a handler. Use the request type from the tables above, or specify a custom request type if the user provides one:
```javascript
{
    request: "crt.HandleViewModelInitRequest",
    handler: async (request, next) => {
        await next?.handle(request);
        await request.$context.executeRequest({
            type: "crt.OpenPageRequest",
            schemaName: "SomeOtherPage_FormPage",
            recordId: someRecordId
        });
    }
}
```

If the user specifies a request type not listed in this reference, use it as-is — Creatio supports extensible request types.

### Conditionally Showing UI Elements via Attributes
For more complex UI (dialogs, bound elements), set attributes and bind in viewConfigDiff:
```javascript
{
    request: "crt.HandleViewModelInitRequest",
    handler: async (request, next) => {
        await next?.handle(request);
        request.$context.WelcomeMessage = "Welcome!";
        request.$context.IsWelcomeVisible = true;
    }
}
```

### Hiding/Showing UI Elements Conditionally
Bind element `visible` property to an attribute in viewConfigDiff, then toggle in handler:
```javascript
// In handlers:
{
    request: "crt.HandleViewModelInitRequest",
    handler: async (request, next) => {
        await next?.handle(request);
        const status = await request.$context.PDS_UsrStatus;
        request.$context.IsUsrDueDateVisible = status?.displayValue !== "Completed";
    }
}
// In viewConfigDiff: {"operation":"merge","name":"UsrDueDate","values":{"visible":"$IsUsrDueDateVisible"}}
```

### Multiple Handlers in One Array
```javascript
[
    {
        request: "crt.HandleViewModelInitRequest",
        handler: async (request, next) => {
            await next?.handle(request);
            request.$context.PDS_UsrStatus = "New";
        }
    },
    {
        request: "crt.HandleViewModelAttributeChangeRequest",
        handler: async (request, next) => {
            await next?.handle(request);
            if (request.attributeName === "PDS_UsrStatus") {
                const status = await request.$context.PDS_UsrStatus;
                request.$context.IsUsrDueDateVisible = status?.displayValue !== "Completed";
            }
        }
    }
]
```

## MCP Page Tools

Use these MCP tools to read and edit page schemas:

1. **`page.list`** — Discover page schemas by package or name pattern
2. **`page.get`** — Read a page schema's metadata and raw JS body
3. **`page.update`** — Save the complete JS body — agent handles all edits

### Workflow
```
page.list(packageName: "UsrMyApp")
  → discover pages
page.get(schemaName: "UsrMyApp_FormPage")
  → get raw JS body
Modify body (update handlers + deps + args in one pass)
page.update(schemaName: "UsrMyApp_FormPage", body: "...modified body...")
  → save to DB + disk file updated + browser notified
```

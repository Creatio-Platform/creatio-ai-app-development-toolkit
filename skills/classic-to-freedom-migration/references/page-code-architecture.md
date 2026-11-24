# Page code architecture

Handed, with `./references/build-page.md`, to every page build and repair task: the shape of the code you
write into a Freedom page. The clio guides own the mechanics and are not restated here:
`page-schema/handlers` (the dispatch API, where `next` goes), `page-schema/shared-client-logic` (creating,
importing and saving a client module) and `related-data/*` (lists and their filters).

## 1. A platform handler only routes

A `crt.*` handler (`crt.HandleViewModelInitRequest`, `crt.HandleViewModelAttributeChangeRequest`,
`crt.SaveRecordRequest`, …) holds the condition it reacts to, the `next` call and a call into the page's
logic module. No business logic and no nested function in it, including functions named after Classic
methods: a Classic method is ported as a module function, and your task Notes name that function as its
port. A long handler, or one that grows functions, has broken this rule: split the work into module
functions by what each does.

## 2. One handler per feature, each passing the request on

Several handlers on the same `crt.*` request are legal and all of them run, as a chain in the order the
schema lists them. Give each feature its own handler; never merge a second feature into an existing one.
The chain has one rule: **every handler calls `next`**, unless it deliberately replaces the platform
behaviour. A handler that skips `next` silently skips every handler after it.

## 3. The logic lives in a client module

- Behaviour and helpers live in the page's client-unit module, `<SchemaPrefix><Page>Module`, in the page's
  package, imported through `SCHEMA_DEPS` / `SCHEMA_ARGS` as `shared-client-logic` says. The module is
  part of the page artifact (`build-task-execution.md` → `writesTo:`).
- **Never in the page factory body** (between `function(...) {` and `return {`): a Designer save deletes it.
- Before writing a function, look for one that does it in the module and in the project's helper modules
  (the task file's `## Project conventions`). One function, called from every place that needs it.
- The module keeps no page context in module-level variables: the handler passes `request.$context` (and
  `request.scopes` when the function fires requests) on each call.

## 4. Custom requests only for what the page fires

A `<prefix>.<Name>Request` exists only where the page itself fires a request: a button's or menu item's
`clicked`, or a call from one component to another. Its handler follows rule 1. Do not wrap a plain
function call in a custom request to give it a name.

## 5. Reads

- Independent reads run together (`Promise.all`); await in sequence only when a read needs the previous
  result.
- A value reachable through a path of the page data source (`PDS.Account.Owner`) is read from the page
  model, not loaded with a second request.
- A list is scoped through `dependencies` or a declarative filter on its data source, not by filtering
  rows in a handler.

## Example

```js
// Incorrect — breaks rules 1, 2 and 5: a nested helper, the logic inline, no `next`, reads in sequence.
{
  request: "crt.HandleViewModelInitRequest",
  handler: async (request) => {
    const idOf = (v) => (v && typeof v === "object" ? v.value : v);
    const order = await readOrder(request.$context);
    const limits = await readLimits(request.$context);
    // …and 120 more lines
  }
}

// Correct — the handler routes, the module holds the logic.
{
  request: "crt.HandleViewModelAttributeChangeRequest",
  handler: async (request, next) => {
    const result = await next?.handle(request);
    if (request.attributeName === "PageParameters_Order") {
      await orderPage.applyOrder(request.$context);   // orderPage = the page's module, from SCHEMA_ARGS
    }
    return result;
  }
}
```

## A page that matches an earlier one

A page with a `sibling-page` ⚠ Confirm follows the user's answer: reuse builds nothing, a shared module is
imported by both pages, a separate page gets its own module. A shared module belongs to this page's artifact;
importing it into the earlier page is a change the user confirms with the answer, never a silent edit.
Copying the earlier page's handlers or names is none of these.

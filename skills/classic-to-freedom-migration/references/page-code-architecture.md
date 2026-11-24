# Page code architecture

Handed, with `./references/build-page.md`, to every page build and repair task. It is the shape of the
code a builder writes into a Freedom page: where the logic lives, what a platform handler holds, how
the page reads data. The clio guides own the mechanics and are not restated here: `page-schema/handlers`
(the dispatch API, where `next` goes), `page-schema/shared-client-logic` (how a client module is
created, imported and saved) and `related-data/*` (lists and their filters).

Each rule below answers a defect a migrated page shipped with: a 391-line save handler with 20 nested
functions, a helper copied 8 times on one page, reads run one after another, and a second page built as a
copy of the first one's handlers.

## 1. A platform handler only routes

A `crt.*` handler (`crt.HandleViewModelInitRequest`, `crt.HandleViewModelAttributeChangeRequest`,
`crt.SaveRecordRequest`, …) holds three things and nothing else:

- the condition it reacts to (which attribute changed, which data source loaded, which list saves);
- the `next` call, placed as the clio `handlers` guide says;
- a call into the page's logic module.

No business logic and no nested function inside it. A function named after a Classic method does not
belong there either: the method is ported as a function of the module, and the task Notes name that
function as the method's port.

## 2. One handler per feature, each passing the request on

Several handlers on the same `crt.*` request are legal, and all of them run: as a chain, in the order the
schema lists them, the first wrapping the second (measured on Creatio 10.1 and 10.2). So give each
feature its own handler and never merge a second feature into an existing one, however the request is
named. The cost of the chain is one rule: **every handler calls `next`**, unless it deliberately replaces
the platform behaviour. A handler that skips `next` silently skips every handler after it, with no error.

## 3. The logic lives in a client module

- The page's behaviour and its helpers live in a client-unit module of the page,
  `<SchemaPrefix><Page>Module`, in the page's package, imported through `SCHEMA_DEPS` / `SCHEMA_ARGS`.
  Create it and import it as `shared-client-logic` says.
- **Never in the page factory body**, the code between `function(...) {` and `return {`: an Interface
  Designer save deletes it. A helper declared there works until the first Designer save.
- A helper the project already has comes from the project's helper modules (the task file's
  `## Project conventions` block), never re-implemented.
- Before adding a function to the module, look for one that already does it, in the module and in the
  project's helper modules. One function, called from every place that needs it.
- The module exports a small API and keeps no page context in module-level variables: the handler passes
  `request.$context` (and `request.scopes` when the function fires requests) on each call.
- **The module is part of the page artifact.** Your task's `writesTo: page:<…>` covers the page and its own
  logic module, so you create and update both. A module another page imports as well is changed only
  as the plan's `sibling-page` answer says.

## 4. Custom requests only for what the page fires

A `<prefix>.<Name>Request` (the prefix from `## Project conventions`) exists only where the page itself
fires a request: a button's or menu item's `clicked`, or a call from one component to another. Its handler
is a platform handler like any other (rule 1): the condition, then the module call. Do not wrap a plain
function call in a custom request to give it a name.

## 5. Reads

- **Independent reads run together:** `Promise.all`, not one `await` after another. Await in sequence only
  when a read needs the result of the one before it.
- **A value reachable by a path is read through the path:** a column of a lookup the page data source
  already loads (`PDS.Account.Owner`) is bound or read from the page model, not loaded with a second
  request.
- **A list is scoped declaratively:** through `dependencies` or a declarative filter on its data source
  (`related-data/*`), not by filtering rows in a handler.

## 6. Size

A function that grows past the code-quality thresholds (function length, functions nested in a handler)
is split by what it does into module functions. A handler that is long has broken rule 1.

## Example

```js
// Incorrect: the logic sits in the handler, the helper is nested, the reads wait for each other.
{
  request: "crt.HandleViewModelInitRequest",
  handler: async (request, next) => {
    await next?.handle(request);
    const idOf = (v) => (v && typeof v === "object" ? v.value : v);
    const order = await readOrder(request.$context);
    const limits = await readLimits(request.$context);
    // …120 more lines…
  }
}

// Correct: the handler routes, the module holds the logic once, the reads run together.
define("UsrOrder_FormPage", /**SCHEMA_DEPS*/["@creatio-devkit/common", "UsrOrderFormPageModule"]/**SCHEMA_DEPS*/,
  function/**SCHEMA_ARGS*/(sdk, orderPage)/**SCHEMA_ARGS*/ {
    return {
      handlers: /**SCHEMA_HANDLERS*/[
        {
          request: "crt.HandleViewModelInitRequest",
          handler: async (request, next) => {
            const result = await next?.handle(request);
            await orderPage.init(request.$context, request.scopes);
            return result;
          }
        },
        {
          request: "crt.HandleViewModelAttributeChangeRequest",
          handler: async (request, next) => {
            const result = await next?.handle(request);
            if (request.attributeName === "PageParameters_Order") {
              await orderPage.applyOrder(request.$context);
            }
            return result;
          }
        }
      ]/**SCHEMA_HANDLERS*/
    };
  });

// In UsrOrderFormPageModule: `init` reads what it needs at once.
// const [order, limits] = await Promise.all([readOrder($context), readLimits($context)]);
```

## A page that matches an earlier one

When the plan carries a `sibling-page` ⚠ Confirm, the user's answer decides the code:

- **reuse:** this page is not built. Its row is closed as the plan says, and the rebinding of the process
  step plus what differs are listed for the user.
- **shared module:** the shared logic goes into one module that both pages import, and the earlier page's
  handlers call it.
- **separate page:** this page gets its own module.

Copying the earlier page's handlers or names into this page is none of these.

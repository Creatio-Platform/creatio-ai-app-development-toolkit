# Page code architecture

Handed, with `./references/build-page.md`, to every task kind that writes page code
(`orchestrate-build.md` → 7.3): the shape of the code you write into a Freedom page. The clio guides own the mechanics and are not restated here:
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

- **Every page that has handlers has its own module**, named `<PageSchema>Module` (the page's schema name plus
  `Module`, e.g. `UsrOrder_FormPageModule`), in the page's package, imported through `SCHEMA_DEPS` /
  `SCHEMA_ARGS` as `shared-client-logic` says. A page that also uses a shared module still gets its own; its
  handlers call its own module, never the same calls another page makes. The module is
  part of the page artifact (`build-task-execution.md` → `writesTo:`).
- **Never in the page factory body** (between `function(...) {` and `return {`): a Designer save deletes it.
- **What the run's pages share lives in one module.** A record id, a status, a helper or a wrapper that two
  pages need goes into one shared module (or the project's constants and helper modules, the task file's
  `## Project conventions`) and is imported, never declared again in a second module.
- Before writing a function, look for one that does it in the run's modules and in the project's helper
  modules. One function, called from every place that needs it; a call a module function already wraps is
  made through that function.
- **Export only what a page or another module calls.** An export nobody imports is removed.
- The module keeps no page context in module-level variables: the handler passes `request.$context` (and
  `request.scopes` when the function fires requests) on each call.
- `node engine/codemap.mjs <page file> --modules .clio-pages` shows what the run's modules hold and what the
  `Code quality` rows of `--verify` will hold you to (a module declared twice, an unused export, a page with
  no module of its own).

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

// Correct — the same handler routes; the page's module (`orderPage`, from SCHEMA_ARGS) holds the logic.
{
  request: "crt.HandleViewModelInitRequest",
  handler: async (request, next) => {
    const result = await next?.handle(request);   // `next?.` as in the clio handlers guide; the call is not optional
    await orderPage.init(request.$context);
    return result;
  }
}
// In the module: one shared helper, the independent reads together.
//   const idOf = (v) => (v && typeof v === "object" ? v.value : v);
//   async function init($context) {
//     const [order, limits] = await Promise.all([readOrder($context), readLimits($context)]);
//     …
//   }
```

## A page that matches an earlier one

A page with a `sibling-page` ⚠ Confirm follows the user's answer: reuse builds nothing, a shared module is
imported by both pages, a separate page gets its own module. A shared module belongs to this page's artifact;
importing it into the earlier page is a change the user confirms with the answer, never a silent edit.
Copying the earlier page's handlers or names is none of these.

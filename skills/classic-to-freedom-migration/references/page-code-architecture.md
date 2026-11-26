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
The chain has one rule: **every handler takes `next`, calls `next?.handle(request)` and returns its
result**. That holds for a custom request too (`<prefix>.<Name>Request`, a button's `clicked`): another
handler for the same request — a replacing schema, a later feature — runs only when this one passes it on.
A handler that skips `next`, or calls it and drops its result, silently ends the chain for every handler
after it and for whoever fired the request. One shape is not a dropped result: an explicit `return` reached before
`next?.handle(request)` runs, on a path the plan stops on purpose (`if (childPage) { return
openChildPage(request, childPage); } return next?.handle(request);`). A `return` reached after the call has run
must still give its result.

A handler ends the chain only when the plan says so: a decision that names the handler and why it
replaces the platform behaviour (for example a save that must not reach the platform save). Each page
handler that ends the chain has its own `--verify` row, `[code-quality] handler-without-next` followed by
its request. Without the decision that row stays open; the decision (`--decide D<N>`) closes that
handler's row only, so another handler that drops `next` still opens a row of its own.

## 3. The logic lives in a client module

- **Every page that has handlers has its own module**, named `<PageSchema>Module` (the page's schema name plus
  `Module`, e.g. `UsrOrder_FormPageModule`), in the page's package, imported through `SCHEMA_DEPS` /
  `SCHEMA_ARGS` as `shared-client-logic` says. A page that also uses a shared module still gets its own; its
  handlers call its own module, never the same calls another page makes. The module is
  part of the page artifact (`build-task-execution.md` → `writesTo:`).
- **Never in the page factory body** (between `function(...) {` and `return {`): a Designer save deletes it.
- **What the run's pages share lives in one module.** A record id, a status, a helper or a wrapper that two
  pages need goes into one shared module (or the project's constants and helper modules, the task file's
  `## Project conventions`) and is imported, never declared again. Look there before writing a function; a call a
  module function already wraps is made through it.
- **Export only what a page or another module calls.** An export nobody imports is removed.
- The module keeps no page context in module-level variables: the handler passes `request.$context` (and
  `request.scopes` when the function fires requests) on each call.
- `node engine/codemap.mjs <page file> --modules .clio-pages` shows what the run's modules already hold.

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
- **A total comes from the server.** A sum, a count, a minimum or a maximum over records is ONE aggregate
  query (ESQ aggregation, `get-guidance esq`), never a loop that pages through the rows and adds them up in
  the browser — that reads every row on every call and grows with the data. A total is recalculated when a
  record it counts really changes (an item saved, deleted or (de)activated), not on every list load,
  paging or page open. `--verify` reports a paged loop as `[code-quality] paged-read-loop`.

## 6. A write reports its outcome, and the user sees a failure

A module function that writes data — an insert, an update, a delete, a system setting, a counter, a
process start — returns a result its caller checks: `true`/`false`, or `{ success, … }` with what failed.
The caller (the handler, or the module function the handler calls) checks it, and a failure reaches the
USER: a dialog or a notification with a localizable message, never only `console.error`, never a silent
`return null`.

- **Every step that can fail is reported.** When the main write succeeds and a later step fails — a log
  line, a recalculated total, a reload — the user is told what was not updated ("Posted, but the contract
  amount was not recalculated"). A step that fails silently leaves stale data that looks correct.
- **A generated value is never left empty in silence.** When a number, a code or a counter cannot be
  assigned, the user is told and the field shows that it has no value yet. Write the counter back only
  after the new value is computed and can be shown, so a failure does not consume a number nobody sees.
- **A bulk action counts its failures.** An action over selected records (close, deactivate, delete)
  goes on past a failed record, counts the records that failed and, when any did, tells the user how many
  of how many ("2 of 5 contracts were not closed"); then it reloads the list once.
- `--verify` reports a `catch` that only logs (or is empty) as `[code-quality] catch-log-only`, and a write
  function whose failure result a caller ignores (`await recalculate(…);` as a bare statement when
  `recalculate` returns `null` on a failure) as `[code-quality] unchecked-write-result`, in the page's
  code and in the client modules it imports (the call and the function it calls in one source).

```js
// Incorrect — the failure stays in the console; the caller ignores the result.
async function closeContracts(ids) {
  for (const id of ids) {
    try { await model.update({ Status: CLOSED }, [{ type: "primaryColumnValue", value: id }]); }
    catch (e) { console.error(e); }
  }
}
// …
await recalculateContractAmount(sdk, contractId);

// Correct — the function returns its outcome, the caller tells the user.
async function closeContracts(ids) {
  let failed = 0;
  for (const id of ids) {
    try { await model.update({ Status: CLOSED }, [{ type: "primaryColumnValue", value: id }]); }
    catch (e) { failed++; }
  }
  return { total: ids.length, failed };
}
// …
const { total, failed } = await closeContracts(ids);
if (failed) await showMessage(request, formatTemplate(await $context.UsrCloseFailedText, [failed, total]));
if ((await recalculateContractAmount(sdk, contractId)) == null) {
  await showMessage(request, await $context.UsrAmountNotRecalculatedText);
}
```

`showMessage` and `formatTemplate` are the page module's own helpers, not platform APIs; the texts are
localizable resource strings.

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

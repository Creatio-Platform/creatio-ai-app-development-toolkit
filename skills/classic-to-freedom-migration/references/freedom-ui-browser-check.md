# Checking a built Freedom UI page in the browser

`validate-page` passing and `update-page` returning `success: true` say the body is well-formed. They say nothing
about whether the page renders. Two live migrations shipped pages that failed at runtime with every API-level
check green — one threw out of the platform's column preprocessor, one blocked the main thread. The browser is
the only thing that catches this class, and the runs that used it spent most of the time in the wrong order.

Measured, one run: **18.6 minutes** in the browser to find one defect, of which **~8 minutes were six consecutive
`Request timed out` calls into a page whose main thread was already blocked.** Nothing in those eight minutes
could have returned anything. This file exists to make that loop impossible to repeat.

## Cheap evidence first

A build task opens the browser ONCE, after its last save — not after each edit; between edits the evidence is
the saved schema read back with `get-page`, and the page is opened again only after fixing a defect that check
found. What the one check costs is decided by the evidence it reads: on one measured section, page-build tasks
that verified through screenshots and DOM reads cost about 4.5× the ones that did not. Browser surfaces name
their tools differently, so the kind of evidence is the rule and the tool names are examples. Read the cheapest
kind that answers the question, and stop when it has:

1. **The data requests the page sends** — the `SelectQuery` / `UpdateQuery` bodies, captured by the request hook
   below, installed before the page loads. One read answers the data checks: a ForwardReference field, each
   detail's filters, the columns a save writes.
2. **The console** (e.g. `read_console_messages`, or the collector under *The order: console, then error
   boundary, then structure* on a surface that cannot read it) — a render or binding error names its own cause there.
3. **DOM reads** (e.g. `find`, `javascript_tool`) — one targeted string per question, such as a caption or a
   component that must be present; never a page dump.
4. **A screenshot** (e.g. `computer` → screenshot) only where the layout is the thing checked — island order,
   spacing, a panel's toggle — at most one per page, and that screenshot is the one the `creatio-ui-guidelines`
   review reuses, not a second.

**The request hook.** Install it in the Creatio tab that is already open, then open the page by an in-app route
change (click through to it, or set `location.hash`). A reload or a typed URL is a full page load and discards
the hook; a hook installed after the page rendered sees nothing until the next save.

```js
// install BEFORE opening the page; a full page load removes it
window.__dq = [];
(function () {
  const watched = /\/(SelectQuery|UpdateQuery|InsertQuery|BatchQuery)\b/;
  const record = (url, body) => {
    if (!watched.test(url)) return null;
    let parsed;
    try { parsed = JSON.parse(body); } catch (e) { parsed = String(body).slice(0, 2000); }
    const entry = { op: url.split('?')[0].split('/').pop(), body: parsed };
    window.__dq.push(entry);
    return entry;
  };
  const keep = (entry, value) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    try { entry.response = JSON.parse(text); } catch (e) { entry.response = text; }
  };
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__url = String(url);
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const entry = record(this.__url || '', body);
    if (entry) this.addEventListener('load', () => keep(entry, this.response));
    return send.apply(this, arguments);
  };
  const nativeFetch = window.fetch;
  window.fetch = function (input, init) {
    const entry = record(String((input && input.url) || input), init && init.body);
    const result = nativeFetch.apply(this, arguments);
    if (entry) result.then(r => r.clone().text()).then(t => keep(entry, t), () => {});
    return result;
  };
})();
'request hook installed';
```

Read it back narrowed to the one schema you are checking — the page's entity, or one detail's — never the whole
array. A `BatchQuery` is unpacked into the queries it carries in `items`, and each one is paired with its own
entry of the batch response's `queryResults`; a result's rows are cut to the first five, never its values:

```js
// replace <Entity> with the schema you are checking
const rowsOf = r => (r && typeof r === 'object' && Array.isArray(r.rows))
  ? { success: r.success, rowCount: r.rows.length, rows: r.rows.slice(0, 5) } : r;
JSON.stringify(window.__dq
  .flatMap(q => {
    const subs = q.body && (Array.isArray(q.body.items) ? q.body.items : q.body.queries);
    if (!Array.isArray(subs)) return [q];
    const results = (q.response && Array.isArray(q.response.queryResults)) ? q.response.queryResults : [];
    return subs.map((b, i) => ({ op: String((b && b.__type) || q.op).split('.').pop(), body: b, response: results[i] }));
  })
  .filter(q => q.body && q.body.rootSchemaName === '<Entity>')
  .map(q => ({
    op: q.op,
    columns: Object.entries((q.body.columns && q.body.columns.items) || {})
      .map(([alias, c]) => (c && c.expression && c.expression.columnPath) || alias),
    written: Object.keys((q.body.columnValues && q.body.columnValues.items) || {}),
    filters: q.body.filters,
    response: rowsOf(q.response),
  })));
```

What each check reads off it:

- **A ForwardReference field is populated on open** when its column path (`Account.Owner`) is among `columns` of
  the page entity's `SelectQuery` and the response row carries a value for it. A path missing from `columns`
  means the field is not loaded through the data source; a path present with an empty value is an empty record —
  open one where it is set before calling it a defect.
- **Each detail's filters** are in the `filters` of that detail's `SelectQuery` (`rootSchemaName` is the detail
  entity): the link to the open record — the master column compared to its `Id` — and every further filter the
  plan names. A detail with no `SelectQuery` at all did not load; read the console next.
- **A save** shows as an `UpdateQuery` (an `InsertQuery` for a new record) whose `written` columns are what the
  save sent — a handler that must set a column shows it there.

Where the surface lists network requests together with their bodies (e.g. `read_network_requests`), that list
answers the same questions without the hook; the hook works on every surface that runs page script. When the
console or a missing request says the page did not render, the order below takes over.

## The order: console, then error boundary, then structure

**1. READ THE CONSOLE FIRST.** A Freedom page that fails to render almost always says why, once, in the console,
before anything is painted. Both known cases named their own cause there:

```
TypeError: … is not iterable
    at …_setPredefinedColumnDefinitions      → a crt.FileList / crt.DataGrid with no `columns`
The type 'undefined' of items attribute binding value is not supporting.   → a collection with no `items` binding
```

One console read would have replaced a DOM census. Counting `crt-*` elements tells you the page is *not* there;
the console tells you *why*, which is the only thing you can act on.

The in-app browser surface (`read_console_messages`, `read_network_requests`) reads the console directly. The
Chrome-control surface does not — with that one you must install a collector BEFORE the page loads, because
errors thrown during bootstrap are gone by the time you ask. Install it the way the request hook is installed: in
the Creatio tab that is already open, then open the page by an in-app route change — a reload or a typed URL is a
full page load and discards it:

```js
// run this in the open Creatio tab, THEN open the page by in-app route — not after the page is already broken
window.__err = [];
addEventListener('error', e => window.__err.push(String(e.message)));
addEventListener('unhandledrejection', e => window.__err.push('rejection: ' + String(e.reason)));
'collector installed';
```

**2. THE ERROR BOUNDARY.** Creatio renders a "Something went wrong" boundary for a caught render failure. It is
one string and it is cheap:

```js
/something went wrong/i.test(document.body.innerText) ? 'BOUNDARY' : 'no-boundary';
```

**3. STRUCTURE, LAST.** Only once the page is known to render is a component census worth a round trip. Freedom
puts everything in shadow DOM, so a flat `querySelectorAll` finds nothing — walk it once, with this, rather than
writing a new walker each time:

```js
(function () {
  const seen = {};
  (function walk(root) {
    for (const el of root.querySelectorAll('*')) {
      const t = el.tagName.toLowerCase();
      if (t.startsWith('crt-')) seen[t] = (seen[t] || 0) + 1;
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  })(document);
  return JSON.stringify({ url: location.href, types: Object.keys(seen).length, seen });
})();
```

## A TIMEOUT IS THE ANSWER, NOT A REASON TO RETRY

`execute_javascript` runs on the page's main thread. If the page blocks that thread, **no script can ever
return** — including `'probe:' + document.title`. So:

> One `Request timed out` from a tab that answered a moment ago **is the diagnosis**: the main thread is blocked,
> the page is broken, and no further script will tell you anything. Stop probing and go read the code you just
> saved.

The run that did not know this sent six more probes over eight minutes, one of which answered (the tab briefly
recovered), which encouraged two more. Retrying reads a coin, not a page.

What to do instead, in order: reload the tab once (a blocked thread can survive a soft navigation, because the
SPA never tears down); if it blocks again, the page is the problem — diff what you last wrote against a page that
works.

## The three failures worth suspecting first

Each is real, each shipped, each passed `validate-page`:

| Symptom | Cause | Check |
| --- | --- | --- |
| main thread blocks, `$Id` undefined | the page has no primary data source — `create-page` leaves the template's `#PrimaryDataSourceName()#` unexpanded (the Interface Designer expands it, not the CLI; `--entity-schema-name` only records a dependency) | `get-page` → `bundle.modelConfig.primaryDataSourceName` |
| `TypeError: … is not iterable` at `_setPredefinedColumnDefinitions` | a `crt.FileList` / `crt.DataGrid` with no `columns` array | the element's own `columns` in the merged `viewConfig` |
| `items attribute binding value is not supporting` | a collection component with no `items` binding and no `isCollection` attribute | the element's `items`, and the attribute it names |

All three are visible in `get-page` output — reading the schema back is faster than reading the DOM, and it works
while the tab is frozen. Both of the first two are now machine-checked by `--verify`; this table is what to do
when a page still fails and the gate is green.

## What a render check is evidence OF

A page that renders proves the body is loadable. It does not prove a deliverable is present: a field can be on
the page and bound to nothing, and the feed can be absent without an error. The `--verify` table stays the gate;
the browser closes the `☐ render` rows and nothing else.

Do not report "renders fine" as a verification result. Report what you opened, what the console said, and which
rows it closed.

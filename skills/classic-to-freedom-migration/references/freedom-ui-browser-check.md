# Checking a built Freedom UI page in the browser

`validate-page` passing and `update-page` returning `success: true` say the body is well-formed. They say nothing
about whether the page renders. Two live migrations shipped pages that failed at runtime with every API-level
check green — one threw out of the platform's column preprocessor, one blocked the main thread. The browser is
the only thing that catches this class, and the runs that used it spent most of the time in the wrong order.

Measured, one run: **18.6 minutes** in the browser to find one defect, of which **~8 minutes were six consecutive
`Request timed out` calls into a page whose main thread was already blocked.** Nothing in those eight minutes
could have returned anything. This file exists to make that loop impossible to repeat.

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
errors thrown during bootstrap are gone by the time you ask:

```js
// run this on a blank tab, THEN navigate — not after the page is already broken
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

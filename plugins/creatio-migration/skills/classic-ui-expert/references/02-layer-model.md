# 02 — The layer model: base vs extension, order, diffs

A Classic page is not one schema. It is a stack of same-named schemas, one per package, each
modifying the one below. Enumerating customizations = reading what the extension layers change.

## Base vs extension

- **Base (the original):** `ExtendParent = false`. It *defines* the page. It is **context**,
  not a card subject — but you must read it, because an extension's meaning is "what it does
  to this".
- **Extension:** `ExtendParent = true`. Every extension layer is a customization to enumerate.
- Whether an extension belongs to a customer package or to a product package does not change
  the reading procedure. If the run's scope says otherwise (e.g. only customer packages are
  subjects), that scope decision is stated in the output, not silently applied.

## Apply order

`get-classic-page-sources` returns `schemas[]` in **apply order** — index 0 applied first.
Do not re-sort alphabetically; the order determines who wins when two layers touch the same
element, and a later `remove` can delete what an earlier layer inserted.

## Provenance: the trap

**Do not read a layer's package from a page payload field.** `packageName` in the free-route
payload reads identically for every layer of a page, including product ones — it looks like
provenance and is not. The lie extends to the compiled runtime artifact: the generated
`…Structure` metadata stamps one package name on *every* layer of the chain, base included.
Authoritative origin: the schema registry — `SysSchema` joined to `SysPackage` (`Name`,
`Maintainer`), or the `pkg` value that `get-classic-page-sources` attaches to each layer body.

## Runtime naming of layers

The compiled page (`/0/conf/content/<SchemaName>.js`) contains the whole chain as separate
AMD modules named `<SchemaName><Package>` (e.g. a layer of `SomePageV2` owned by package
`PkgA` compiles to module `SomePageV2PkgA`), each `extend`-ing the previous — and **the
topmost layer takes the bare schema name**, because that is the module name the platform
requests. Two uses: a runtime module name seen in a stack trace or module list maps straight
back to one layer; and "bare name" means *last in the chain*, not *has no customizations* —
the top layer's members are as much subjects as any other's.

## Reading a diff

Each entry in `diff` is one operation. The ones that carry behaviour:

| Operation | What it means for behaviour |
|---|---|
| `insert` | adds an element. `parentName` says **where** — and the container name often encodes *which module hosts it* (see `06-platform-patterns.md`). `values` carries the bindings: `caption`, `click`, `visible`, `enabled`, `tag`, `itemType` |
| `merge` | changes properties of an existing element — read it against the base definition to know what actually changed |
| `remove` | deletes an element. **An absence is a customization.** It has no method, no attribute, nothing to grep for — only a comparison against the base reveals it |
| `move` | re-parents/re-orders an element |

Two consequences worth internalising:

- **A layer with only `remove`/`move` operations still changes behaviour** and still produces
  cards. Method-name-driven enumeration cannot see these at all.
- **`insert` values are bindings, not implementations.** `click: {bindTo: "X"}` means "find X";
  where X lives is the subject of `05-reference-following.md`.

## Empty layers are findings

A layer whose body is a bare shell — `details {}`, `diff []`, `methods {}`, nothing else — is
an **empty extension layer**. Record it as a *counted zero*: "package P extends schema S and
changes nothing". That is a real answer about the surface, and it is what distinguishes
"checked, nothing there" from "never looked". Do not omit it from the output.

## Line numbers

Every source citation carries real body line numbers (see `08-card-contract.md`). Normalize
line endings once when you save a fetched body, so the numbers you cite match what the schema
designer shows. Never cite a local file path, and never cite a designer URL in place of
`SchemaName [Package] + lines`.

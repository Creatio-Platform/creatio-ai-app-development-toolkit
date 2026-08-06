# 05 — Following references outward

A binding is a name, not an implementation. This file is how you turn names into source —
and what to do when you cannot.

## The lookup order (fixed)

For any unresolved name (`bindTo` target, called method, mixin member):

1. **The same layer body.**
2. **Lower layers of the same chain** — remember apply order; a later layer can override what
   an earlier one defined.
3. **Mixins mixed into any layer of the chain** — fetch the mixin schema and read it.
4. **Module dependencies** in the `define([...])` list — utility modules, constants modules.
5. **The parent-template chain** (the `seed` in the page manifest) — inherited actions,
   containers, base view models.
6. **Platform base schemas** — see `06-platform-patterns.md` for the idioms that live there.

Stop at the first layer that defines it, and cite *that* schema and lines.

## Mixins

`mixins: { Name: "Terrasoft.SomeUtilities" }` means the members of that schema are available on
this view model. Two consequences:

- **Fetch the mixin schema.** Its methods are members of the units they serve; its resource
  strings are the unit's strings. A card that rests on mixin code cites the mixin schema
  `[Package] + lines`, not the page.
- **A mixin member can be overridden locally.** If the page layer defines a method with the same
  name (often documented as `@inheritdoc … @overridden`), the local one wins — cite both: the
  mixin as the general implementation, the override as what this page does differently.

## Dependencies that are not mixins

A constants module (`…Constants`) supplies values a condition compares against. Fetch it when a
comparison's meaning depends on it — "status != Screening" is only informative once you know
what `Constants.X.Screening` refers to. Cite it as a member.

## Cross-schema wiring

- **`messages` with SUBSCRIBE and no publisher in the fetched set.** The publisher is elsewhere
  (another page, a detail, a module). Search the surface you fetched; if it is not there, expand
  the search before settling for "unresolved" — in this order:
  1. **Same-package siblings.** Message pairs ship together: query the registry for every
     client schema in the *declaring layer's package* (`SysSchema ⋈ SysPackage`, one ESQ),
     fetch the candidate chains to files, and text-search the bodies offline. This is the
     browserless equivalent of a debugger source search — and it covers modules a browser
     session would never load.
  2. Still nothing → record the thread as unresolved with the stand-wide scan as the settling
     query. Never invent a publisher.
- **Declaration ≠ invocation.** A `messages` entry with `direction: PUBLISH` is *wiring*, not
  evidence the message ever fires — only an actual `sandbox.publish("Name"…)` call is. When
  verifying a counterpart, search for the invocation, not the declaration.
- **Dead wiring is a finding.** A message declared on both ends but invoked on neither (often
  with the consumer meanwhile doing the same job another way, e.g. a direct ESQ) is a real,
  nameable outcome: record it as vestigial wiring, cite both declarations and the replacement
  mechanism, and state the scope of proof ("no invocation in chains X, Y; stand-wide scan
  would settle it exhaustively"). Sibling of the orphaned-resources case in `07-boundaries.md`.
- **An attribute set but never read** in the fetched set. Either its consumer is in a schema you
  have not fetched (a record page, a detail), or nothing consumes it. Both are honest findings;
  the difference matters, so say which one you verified.

## Settle before you write

An assumption is for what genuinely cannot be settled within the run's reach — data values,
server internals, stand-wide scans. **If the settling query is one fetch or one registry
query, run it now instead of writing the assumption.** Two mandatory cases:

- **`callParent` fallbacks the card describes.** "Otherwise falls back to the standard
  behaviour" is a claim about the parent's implementation — fetch the parent chain and say
  what the standard behaviour *is*, with lines. An override's meaning is the difference from
  its base; you cannot state a difference from something unread.
- **A binding/method one lookup-order step away.** If the lookup order points at a specific
  fetchable schema, the fetch comes before the card.
- **Platform bindings the card leans on.** When a unit binds `enabled`, `visible`, `click`
  or a caption to a base-chain method (`canEntityBeOperated`, `isNewMode`, …), its semantics
  are one **text search across the fetched platform chains** away — run the search and cite
  the definition (schema, lines, what it returns). "A standard platform check" with no lines
  is a banned phrase: familiarity is not evidence, and the definition often adds product
  facts (e.g. `isNewMode = isAddMode || isCopyMode` — the copy case). The same name may be
  defined per module (page vs section) — resolve the definition for **each host** the unit
  binds from.

## The retrieval floor (mandatory per surface)

Name-driven fetching alone repeats a measured failure: with the source fully reachable,
agents still leave reachable artifacts unfetched, and purpose accuracy drops. Five artifact
classes are therefore fetched on **every run** — not only when an unresolved name happens to
point at them — and every fetch, or its counted zero, is logged:

1. **The entity's server-side code.** Once per surface, query the registry for the entity's
   C# schemas (`ManagerName = 'SourceCodeSchemaManager'`) and its event process
   (`ProcessSchemaManager`), and fetch what the queries return. What you learn grounds the
   cards' business-logic wording as settling-results notes (`07-boundaries.md`) — the
   behaviour statements stay client-side, per the boundary rules.
2. **Lookup and setting values.** Every condition a unit compares against a lookup row, a
   constant or a system setting gets its value query actually **run** (a read — one ESQ or
   settings query), not parked as an assumption. An assumption remains only for what a read
   cannot reach. A setting's value is **per-audience**: read `SysSettingsValue` (per-role/user
   overrides), not only the All-Users default, and report whose value it is ("All Users `false`;
   Supervisor override `true`"). A `false` default is not "dormant".
3. **Message counterparts.** For every message the surface declares or a body publishes/subscribes,
   scan the client-schema census for the other side (`sandbox.publish` / `subscribe` of that name)
   and record it, or record a counted zero ("no subscriber on this stand"). Do this per run, not per
   unresolved name: a method whose body only publishes or subscribes has nothing to describe on its own,
   so without the counterpart it lands in no unit at all — the measured failure. A thread left untraced
   is a refusal with the scan as its settling action, never an omitted member.
4. **Resource strings** — already mandatory through the ledger and the criteria rules
   (`03-member-ledger.md`, `08-card-contract.md`); listed here so the floor is complete in
   one place.
5. **Detail wiring** — already mandatory through the ledger and the detail-wiring pattern
   (`03-member-ledger.md`, `06-platform-patterns.md`).

"Nothing there" is a counted zero, recorded per class ("entity has no event process", "no
lookup comparisons in this unit's conditions"). The floor closes before cards close: a card
written with its floor unfetched is premature by definition, exactly like an unresolved
thread in `04-units.md`.

## When a name cannot be resolved

Mark it **unresolved** in the card's assumptions with the query that would settle it, e.g.
"binding `X` not defined in the fetched chain; settling query: search the registry for schemas
whose body defines `X:` and fetch the hit". Never write a mechanism sentence that assumes what
`X` does. A negative result from a guessed path is not a platform fact.

## Budget discipline

Fetching is cheap; reading everything is not. Fetch a schema when a *specific* unresolved name
points at it. Do not pre-fetch the platform because it might be relevant — the units tell you
what to fetch, in this order, and the ledger tells you when you are done.

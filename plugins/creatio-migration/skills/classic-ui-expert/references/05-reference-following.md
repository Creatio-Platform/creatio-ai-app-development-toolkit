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
   overrides), not only the All-Users default, and report the **resolved state per audience** ("off
   for All Users, on for Supervisor"). A `false` default is not "dormant". Report the state, not the
   literal value, unless the row is Boolean: a Text/String/Lookup value may be a secret that no
   metadata flags as encrypted, and these cards ship in `customizations.md` — the one output document
   that carries verbatim customer code.
3. **Message counterparts.** Build the publish/subscribe register — for every message the surface
   declares, which schema publishes it and which subscribes — and **run the search, do not defer it**:
   the measured failure is 18 of 30 threads left open because the counterpart search was recorded as a
   settling query instead of performed. A method whose body only publishes or subscribes has nothing to
   describe on its own, so without the counterpart it lands in no unit at all.
   - **Once per run, never per scope and never per unresolved name.** The register is keyed by the
     messages the surface declares — a bounded set — not by the census, which carries names and
     packages, no bodies. When a caller supplied a **shared-core package** that carries the
     register (the phased orchestration in `SKILL.md`), the caller owns it: consume it, never
     rebuild it. A plain **row digest** carries rows, not a register — build the register
     yourself before closing class 3.
   - **Scope growth extends the register, never rebuilds it.** A page entering scope after the
     register was built (a child edit page, a discovered detail — `01-surface-resolution.md`) adds
     its declared messages as new entries, and their counterpart search runs then. The same holds
     for a caller-supplied register: append the new page's threads and say so. A message a
     late-scoped page declares is in the register or it is an untraced thread — never silently
     absent.
   - **Widen until you find the counterpart, and state the scope you reached.** Start at the *declaring
     layer's package* (the search order under **Cross-schema wiring** above) and widen from there;
     fetch candidate chains and text-search the bodies offline. A counterpart found in a package the
     surface never names is the normal case, not the exception — `ReloadGridAfterAdd` is published by a
     typed form and consumed by a grid elsewhere.
   - **A counted zero carries the scope that proves it** ("no subscriber found stand-wide" is a
     different fact from "none in the declaring package"), and names any wider scan left unrun. An
     untraced thread is `unresolved`, never an omitted member.
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

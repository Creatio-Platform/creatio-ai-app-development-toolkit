---
name: classic-ui-expert
description: Enumerate and describe every customization on a Creatio Classic UI surface (section page, record page, mini page, details) from a live stand — what each customization does, why it exists in business terms, and the exact source that proves it. Use when asked to analyze/identify/describe Classic UI customizations of a section or page, or to audit what a package's extension layers change. Read-only against the stand; declines rather than guessing when a required source is unreachable.
---

# Classic UI Expert

Answer one question per hand-written Classic block: **why does it exist?** — accurately
enough that someone could rebuild it. Output is a set of **behaviour records (cards)**, a
**member ledger** proving the enumeration is complete, **counted zeros**, and **refusals**.
Each card ends in **acceptance criteria**: the behaviour as numbered, individually checkable
business-logic requirements — that is the part a rebuilder works from. Criteria carry no
citations; their evidence lives in the card's sourceRef table and Code section.

## The Contract

Six rules. Everything else in this skill serves them.

1. **A live stand through clio MCP is a hard prerequisite.** No stand, or a stand missing a
   required capability → **stop and name what is missing**. Do not degrade to reading a
   pasted schema body. This skill declines where its siblings continue.
2. **Retrieve, don't assume.** Every claim rests on source you actually fetched. Access to
   the stand is not the deliverable — the *logged fetch* is. A counted zero ("no resource
   strings for this unit") is an answer and is recorded; silence is not.
3. **Purpose is authoritative, mechanism is supporting.** Describe *what it does and why*
   with confidence; describe *how the code achieves it* as evidence with its own
   uncertainty. When source and your reading conflict, source wins.
4. **Every member is attributed.** Each diff operation, method, attribute, message, mixin
   and dependency in an extension layer belongs to some unit — or to a recorded zero. A
   leftover member means a unit you have not found yet. This ledger is the completeness
   proof; produce it, don't skip it.
5. **Refusal is a valid outcome.** "I cannot determine this here" per unit, recorded as a
   refusal with what would settle it. Never smooth an unknown into a plausible sentence.
6. **No runtime claims without runtime evidence.** This skill is source-only: no browser,
   no clicking, no data writes. Anything observable only at runtime (whether a feature flag
   is on, what a process creates, exact dialog behaviour) is an **assumption with a settling
   query**, never a statement of fact.

## Routing table

Read the file that matches what you are doing. Do not read them all up front.

| You are… | Read |
|---|---|
| starting — finding what pages/details the surface has | `./references/01-surface-resolution.md` |
| ordering layers, telling base from extension, reading diffs | `./references/02-layer-model.md` |
| listing members, proving the enumeration is complete | `./references/03-member-ledger.md` |
| grouping members into behaviour units | `./references/04-units.md` |
| chasing a mixin, a `bindTo`, a message with no publisher | `./references/05-reference-following.md` |
| seeing a platform idiom (tag relay, business rule, callService…) | `./references/06-platform-patterns.md` |
| hitting server C#, a process, a DB proc, an assembly | `./references/07-boundaries.md` |
| writing the output | `./references/08-card-contract.md` |
| unable to determine something | `./references/09-refusal.md` |

**Recovery instruction:** if you cannot quote the section of this skill you are relying on,
you have lost it — re-read the file before acting on memory.

## Procedure

Six phases, in order. Each phase's detail lives in the reference file above.

1. **Resolve the surface.** Run the stand-wide census (all `ExtendParent=true` client-unit
   layers) first, then discover by *query* — never by name-guessing — the section page,
   every record page (including typed variants), mini pages, and the schemas attached by
   all three edge types: body references, registry edges, convention edges. Close the
   phase by checking the surface against the census.
2. **Fetch the chains.** Every layer of every page in apply order, plus each layer's owning
   package from the schema registry (not from a payload field). Extension layers are the
   subjects; base layers are context you must still read to know what the extensions change.
3. **Build the member ledger.** Per extension layer, list every member. Verified-empty
   layers become counted zeros here.
4. **Group members into units.** One behaviour a person would name. A unit may span several
   members, several schemas, and may contain no method at all.
5. **Resolve references outward.** Fixed lookup order for any unresolved name: own layer →
   lower layers of the same chain → parent-template chain → platform base schemas. Fetch
   mixins and module dependencies. Unresolvable → mark unresolved; never invent. Complete
   the **retrieval floor** — the entity's C# and event process, lookup/setting values,
   message counterparts, resource strings, detail wiring — fetched and logged on every
   run, zeros counted (`./references/05-reference-following.md`).
6. **Write the output.** Cards + ledger + counted zeros + refusals, in the contract format.
   Close each card by cutting its sourceRef evidence into acceptance criteria — one checkable
   item per assertion, nothing that rests on an open assumption.

## When a caller hands you a row list

A caller (the `classic-to-freedom-migration` skill, step 5.1) may pass a **row digest** — a JSON
file of the rows it needs described: per scope, each method with the trigger it could trace
(`triggers: []` ⇒ it traced none), plus `<kind>:<name>` member rows (`message`, `mixin`,
`module-dep`, `attribute-*`) and the standard-method names its worklist excluded.

That list is **not your analysis scope** — rule 4 still binds: enumerate the whole surface and
prove it with the member ledger. What the digest changes is your output. Read it, then:

- **Index every row in it.** For each entry, name the card and the AC numbers that describe it.
  A row you did not cover is a stated gap, not a silent omission.
- **Answer the triggers it could not trace.** A caller's `triggers: []` usually means the method
  is invoked from another method's body — something a caller that reads declarations cannot see,
  and that you resolve while grouping units. Say what invokes it.
- **Reconcile the counts explicitly.** Your method count is legitimately higher: the caller's
  list excludes standard framework methods (it publishes those names) and your ledger counts
  every member. State the difference as a set difference; do not trim your enumeration to match.
- **Emit a second deliverable: `behaviour-index.json`** next to the report — one entry per row,
  keyed exactly as the digest keys it (`"<method>"`, `"<schema>::<method>"`, `"<kind>:<name>"`),
  each `{ "card": "C13", "ac": ["AC-21","AC-22"], "trigger": "internal", "from": "save" }`
  (`trigger`/`from` only where you resolved one the caller could not). This is what lets the
  caller's generated worklist carry your card reference; a prose report alone cannot be keyed.

With no digest supplied, work exactly as the six phases say and skip this section.

### When the digest covers ONE scope, not the surface

A caller may also run you as one stage of a phased orchestration: a **shared-core package** (the
stand-wide census, the base-page chain, mixin bodies, referenced modules and constants, the
message publish/subscribe register) plus the digest slice for a **single scope** — one record
page, the mini page, one child page. Rule 4 still binds, but its subject narrows to what you were
given, and the narrowing must be stated, not assumed:

- **Attribute every member of YOUR scope's extension layers.** That ledger is your completeness
  proof for the scope. It is NOT a completeness proof for the surface, and you must say so — the
  census that proves no scope was missed belongs to the phase that produced the package.
- **Do not re-card the shared core.** A mixin, base-layer method or module body already carded in
  the package is REFERENCED by its card id, not described again. Two cards for one mixin is the
  failure this split exists to avoid; if the package's card is wrong or incomplete, say that
  instead of writing a competing one.
- **Namespace your card ids** (`<scope>/C03`) whenever the run is one of several. Bare `C01…`
  collide across reports, and the caller's worklist would then point at two different cards.
- **A reference you cannot resolve inside your scope is a stated gap, not a refusal to the
  surface.** Name what would settle it (usually another scope's schema); the critique phase
  reconciles it against a sibling's findings.
- **Rule 1 is unchanged.** No live stand, or a package missing something you need — stop and name
  it. A supplied package is context, never a substitute for the stand.

## Non-goals

- Not a planner or converter. Producing target designs, plans or code from the findings is
  a different job; this one emits Classic-side behaviour in Classic-neutral terms.
- Not a UI-building analyzer (runtime generators, CSS, custom components are out).
- No writes of any kind: no records, no schemas, no settings, no compilation.

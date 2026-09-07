# 04 — Grouping members into behaviour units

A **unit** is one coherent thing the layer changed, at the granularity a person would name.
Not a schema. Not a method. Not a diff operation.

## The test

> Would a user or an analyst describe this as **one thing**, with one trigger and one effect?

If yes, it is one unit, however many members implement it. If the answer is "that's two
things that happen to live in the same method", it is two units.

Good unit names sound like a person: *"the standard approval action is removed from the section
menu"*, *"selecting a row adds the record's contract print forms to the Print menu"*,
*"orders can't be created manually from the list"*.

Not unit names: `onActiveRowChange`, `diff operation 4`, `the WorkX layer`.

## Shapes a unit can take

- **Method-less.** A layer with only `remove`/`move` diff operations changes behaviour and is a
  unit. Nothing about it is greppable by method name.
- **Multi-member.** A method + an attribute declaring its state + a message that toggles the
  attribute + a diff op that renders the control + a resource string = one unit.
- **Multi-schema.** The same behaviour inserted by the section layer and by the record-page
  layer, implemented in a shared mixin. One card, several schemas in its sourceRef.
- **An absence.** "The standard X is gone" — only visible by comparing against the base layer.
  Read the base; a customization you cannot see in the extension may be a deletion of
  something the base added.
- **Wiring with no local consumer.** An attribute set but read nowhere in the fetched set, a
  message subscribed with no publisher found. Record it as a unit whose consumer is
  unresolved (`05-reference-following.md`), or as a member of the unit that consumes it once
  found — never as a confident behaviour you cannot trace.

## Close the unit before you card it

A unit's boundary is only as good as its resolved threads. Every reference leaving its
members — a message name, a module id, a binding, a called method — must be resolved
(`05-reference-following.md`) **before** the unit is named and carded, because the far end
can change what the unit *is*: a "page reacts to X" fragment plus the schema that emits X
may turn out to be one designed behaviour, not a wiring plus an unknown. Card only closed
units; a unit with a resolvable-but-unresolved thread is not ready, and offering it as a
card is premature by definition. (Genuinely unresolvable threads — data values, server
internals — close as assumptions with settling queries; that is different from not having
looked.)

Threads run in **both directions**: outbound references (what a member calls, publishes,
binds) *and* inbound callers (who calls, clicks, or triggers the member). "Who calls this?"
is a thread. In particular, the trigger named in *What it is* must be traced to its concrete
origin — the actual control with its real caption, the actual hook, the actual message — and
never inferred from schema or method names. A behaviour word with no member behind it
("accepts", "approves", "synchronizes") is an open thread, not a description.

## Two failure modes to avoid

1. **Splitting one behaviour** because it appears in several schemas or several members —
   inflates the count and creates spurious mismatches when the enumeration is compared.
2. **Merging two behaviours** because they share a method or a container — hides a
   customization and reads as an omission later.

Both are caught by asking the test question out loud per candidate, and by the ledger: a merged
unit leaves members that don't fit its one-sentence description; a split unit produces two
cards whose descriptions are the same sentence.

## Identity

Give each unit a stable local id (U01, U02, …) and never key it by a method name — a unit may
have no method, may span members, and method names are not unique across layers. The id is for
cross-referencing the ledger, cards and refusals within one run.

## Patterns and counting occurrences

Units generalize into **patterns** ("action button launching a configurable process",
"detail wired onto the page with master-derived defaults"). A pattern count is only valid
against **explicit identity criteria** — the listed conditions an occurrence must ALL meet.
"An extension layer inserts a button" is not a pattern; it is a coincidence of member kind,
and counting against it flips the number with every reading.

Rules:

- state the criteria before counting, as a checklist, with explicit non-examples;
- record every **near-miss** with *which criterion it fails* — an exclusion must be a
  decision a reader can audit, not an omission;
- pin every count to its scope (which schemas / layers, which stand, when) — an unscoped
  count cannot be compared to anything;
- pattern definitions and counts live in the **pattern catalog**, a separate artifact —
  never inside a behaviour card. A card describes one concrete occurrence; the catalog
  defines what makes occurrences the same thing;
- **a pattern never substitutes for cards.** Every occurrence gets its own card, however
  repetitive — six near-identical detail wirings are six cards, not one "pattern card".
  The catalog is produced only when the run is explicitly asked to count; the cards are
  always the primary output.

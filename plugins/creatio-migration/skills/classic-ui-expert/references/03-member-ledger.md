# 03 — The member ledger: proving the enumeration is complete

The ledger is the difference between "here are some customizations I noticed" and "here is
what this surface contains". Build it before you finish; it is part of the output.

## What counts as a member

Per **extension** layer, enumerate:

| Member kind | Where it is | Note |
|---|---|---|
| diff operation | `diff: [...]` | each operation separately, incl. `remove`/`move` |
| method | `methods: {...}` | including overrides that only call `callParent` plus one line |
| attribute | `attributes: {...}` | state flags, virtual columns, business rules attached to a column |
| message | `messages: {...}` | note direction (PUBLISH / SUBSCRIBE) and mode |
| mixin | `mixins: {...}` | the act of mixing in, plus the calls into it |
| module dependency | the `define([...])` list | constants modules, utility modules, other mixins |
| resource string | merged `resources` | attribute it to the unit that uses it |
| details block | `details: {...}` | detail wiring is behaviour (filter, defaults, master column) |

## The rule

**Every member is attributed to exactly one unit, or to a recorded zero.** When you believe
the layer is enumerated, walk the list: any member without a unit is a unit you have not found.
That is the completeness test — nothing else in this skill substitutes for it.

Write it **member → unit**, one line per member, and close each layer with the count
(`N members · M attributed · K unattributed`, where `M + K = N` — three counts you actually
computed, never the member total copied into the attributed slot). A nonzero `K` is a live gap: the
walk found a member with no unit, exactly what the completeness test above exists to catch, and the
layer is not closed until every member has one. The inverse shape — a unit carrying a roster of the
members it covers — reads as a ledger but cannot be checked: a member absent from every roster
looks like no gap at all, and no coverage figure can be derived from it. Grouping members by family
("the `save*` methods → these cards") fails the same way.

## Process members in source order

Walk the layer **top to bottom, in file order** — deps, mixins, attributes, details, methods
in declaration order, diff, resources — attributing each member as you reach it: it either
joins a unit already open or opens a new one. Do not jump to the interesting members first
and circle back "later": jumping is how members end up orphaned, how one behaviour's members
get glued onto another's card, and how "later" quietly becomes never. A member may be *parked*
(attributed to "unit not yet named") only until the walk reaches the members that name its
unit — never past the end of the layer.

Practical form (keep it in the output):

```
Layer: <SchemaName> [<Package>]  — <N> members
  diff op 1 (remove X) ............... U03
  method getSectionActions ........... U02 (removal part), U03 (insert part)
  method syncWithTS .................. U03
  attribute IsFlagEnabled ............ U05
  message SetIsFlagEnabled ........... U05
  mixin PrintUtilities ............... U04
  → 6 members · 6 attributed · 0 unattributed
```

## Two shapes that break naive counting

- **One method, several units.** A single `getSectionActions` override can remove a standard
  action (one unit) *and* add a new one (another unit). Cite the fragment per unit; the method
  is fully accounted for only once both cards exist.
- **One unit, several schemas.** A behaviour can be inserted by the section layer, inserted
  again by the record-page layer, and implemented in a mixin — three schemas, one card. Do not
  split it into three units because it appears in three files; do not merge two behaviours
  because they share a method.

## Counted zeros are ledger entries too

An empty extension layer gets a one-line ledger entry: layer, package, "no members —
verified empty". Same for a searched-for artifact class that genuinely has none ("no resource
strings for this unit"). Recorded, not omitted.

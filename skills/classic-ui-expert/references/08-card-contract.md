# 08 — The output contract

Four artifacts per run: **cards**, the **member ledger**, **counted zeros**, **refusals**.
A fifth, the **pattern catalog**, exists when occurrences are counted (`04-units.md`) — it
is a separate artifact, never part of a card.

## Packaging

All four artifacts ship as **one self-contained markdown report per analyzed surface**, in
this order: the run provenance header (below), then every card, then the appendices —
member ledger, counted zeros, refusals. One file is one handoff: a consumer receives the
full run, its evidence, and its coverage boundary together, and cannot mistake an
unanalyzed behaviour for an absent one.

**What makes coverage checkable is the member ledger** (`03-member-ledger.md`) — member → unit, one
line each, closing with the attributed/unattributed count. Do not add a second index section that
restates it. When a caller supplied a row digest, `behaviour-index.json` (`SKILL.md`) is the keyed,
machine-readable form of the same mapping; the ledger stays the human-readable proof.

**A row digest is a WORKLIST, not a census of the surface.** It carries the rows the migration engine
could not answer, and the engine's own member ledger for the same scope is a larger population
(measured: 10 digest method names against 11 definitions, 2 virtual attributes of 5, 3 members of 88).
Describing every digest row proves the worklist was worked — never that the surface is fully
understood; the stand census is what speaks to the surface. For the same reason, an entry whose card
could not establish the behaviour carries `behaviourEstablished: false` in `behaviour-index.json` (see
the card-fields table below): without it the row is counted as described by the coverage arithmetic,
by the migration plan's `Described in` cell and by the plan's `N of M carry a behaviour card` header.

Write the report to `migrations/<section-slug>/customizations.md` in the current
workspace — the same per-project folder convention the toolkit's migration
documentation uses, so a later migration run on the same section finds the report
beside its own documents. Derive the slug from the section being analyzed
(e.g. `orders-section`), keep it stable, and say in the run output where
the report was written. The report carries behaviour facts only: no migration advice,
no target-platform recommendations, nothing addressed to a particular consumer
(non-goals in `SKILL.md`).

## Card fields — in this order

| Field | Status | Content |
|---|---|---|
| **What it is** | authoritative | The behaviour, named as a person would name it. **Two sentences at most**: trigger → effect, in the user's terms. No method names. The detail belongs in Acceptance criteria, which restate the same behaviour checkably — do not write it twice. |
| **Business logic** | authoritative, may be marked as a reading | What it accomplishes and why it exists, in business terms. If the intent is inferred rather than stated in source, say so here and carry the uncertainty into Assumptions. |
| **sourceRef** | mandatory | Every code location that implements it. Table form (below). Source wins on conflict with your reading. |
| **Code** | mandatory | The unit's own members, **verbatim from the fetched bodies**. Section below. |
| **Assumption?** | mandatory when non-empty | Each unproven reading, each unresolved name, each runtime-only question — every entry with **the query that would settle it**. A bare "unknown" with no closing query is a defect. |
| **Behaviour established?** | mandatory when the answer is NO | Write `behaviourEstablished: false` on the card AND on its `behaviour-index.json` entry when the card ends without establishing what the behaviour actually is (the source was unreachable, the body was inconclusive, the trigger never resolved). A card that says so in prose while its index entry names a card is counted as coverage by every consumer — measured: a migration plan read "10 of 10 carry a behaviour card" while the first card said the behaviour was NOT established. The field is the machine-readable form of that admission; absent means established. |
| **Acceptance criteria** | mandatory | The behaviour restated as numbered, independently checkable requirements, each citing the sourceRef row that proves it. Section below. |
| **Mechanism notes** | supporting, **omit when empty** | Only a fragile or surprising construct a rebuilder would otherwise trip on (a shared mixin driving two surfaces, a sizing hack, a value written by a path the sourceRef rows do not make obvious). Never the authoritative claim, and never a restatement of the sourceRef "what it contributes" column — if that is all you have, leave the field out. |

The card shape is fixed: exactly these fields, in this order. Do not add fields (counts,
observations, run metadata) — anything beyond the behaviour goes to the run's other
artifacts. `Assumption?` and `Mechanism notes` are the two that disappear when they have
nothing to say; the rest are always present.

**Cards are source-only.** No runtime observations, no "verified live" notes, no debugging
narration. A fact learned any other way is either restated from the source location that
carries it, or it is an Assumption with a settling query.

## sourceRef table

One row per code location. Schema and Package are separate columns:

| Kind | Schema | Package | Lines | What it contributes |
|---|---|---|---|---|
| customization | `PageSchema` | `ExtendingPackage` | `11–28` | **diff insert `SomeButton`** — where it lands<br>binding → target · binding → target |
| customization | `SomeUtilities` | `Package` | `140–161` | **method `DoTheThing`** — what it does |
| context | `PlatformSchema` | `PlatformPackage` | `1468–1472` | **method `onCardAction`** — the relay/transport |
| resource | `SomeUtilities` | `Package` | — | **strings** — Name1 · Name2 |

Rules:

- **Schema + Package + real body line numbers.** Never a local file path. Never a designer
  URL in place of a citation. If you do not have lines, fetch the body before writing the row.
- **"What it contributes" has a fixed cell shape:** a **bold member label** (member kind +
  name, e.g. `diff insert X`, `method Y`, `details block Z`, `mixin wiring`, `strings`) —
  then a dash and the short meaning. Enumerations (bindings, default mappings, string lists)
  go on their own line, separated by `·`, never as a comma run-on inside the sentence.
- **Kind is explicit.** `customization` = members that *are* the behaviour; `context` = code
  that triggers or carries the behaviour but is not its member — platform/base machinery
  *or another unit's members* (a publisher this unit reacts to); `resource` = strings.
  Mixing them hides which code the customization actually owns.
- **Every trigger named in *What it is* has a sourceRef row.** If the behaviour statement
  says "when X, Y or Z happens", the table must show where each of X, Y and Z originates —
  as `context` rows when the trigger source belongs to the platform or to another unit. A
  trigger the table cannot back does not belong in the behaviour statement.
- **Containers are addresses, not members — cite one only when the card names it.** Do not
  chase the parent chain of every insert. But when *What it is* locates the behaviour by a
  visible caption ("on the Opportunity history tab"), add one `context` row for the code
  that defines that container and binds that caption — that row is what backs the location
  claim. A container the unit inserts *itself* needs no context row; it is already a member.
- **Rows back sentences — never connections.** Every method overrides something, every
  schema extends a parent; connectivity alone never earns a row (that is parent-plumbing
  chasing). Write the behaviour sentences first, then ask of each sentence "which lines
  prove this?" — the rows fall out of the sentences. A base implementation is cited only
  when the card describes its behaviour (a fallback, a visible location, a trigger's
  origin) — not when it is merely the thing being extended. The two failure directions are
  symmetric: a row with no sentence behind it is plumbing; a sentence with no row behind
  it is an unbacked claim.
- **A member that performs a cross-boundary call enumerates the full call in its cell.**
  Request/service/process identity and how it is resolved, then every parameter → its source,
  with per-branch values on their own line (`parameters → CurrentRecord · ItemIds (always sent;
  `""` = all) · CopyAllFlag`). "Launches the process" without the parameter list is an unbacked
  hand-off — the one part of the card a rebuild copies literally (`07-boundaries.md`).
- Line ranges of a method mean the whole method; for a fragment inside a shared method, name the
  fragment ("the removal part of `getSectionActions`").

## Code

The sourceRef table says *where* the unit lives; the Code section is the unit itself — the concrete
occurrence a reader on **another stand** compares against when the cited packages and line numbers do
not exist there. Line citations are addresses; the snippet is the evidence that travels.

Rules:

- **Verbatim from the fetched body, never retyped.** Copy the members exactly as retrieved; a
  snippet "cleaned up" from memory is an invention wearing evidence's clothes.
- **A secret literal is redacted, never copied.** A credential inside a member — connection
  string, API key/token, password — is replaced with a comment naming what was removed
  (`/* redacted: connection string */`), the same shape as an elided member. This is the one
  edit allowed inside a member: the snippet ships in `customizations.md`, and the same
  default-deny that keeps non-Boolean setting values out of the report (retrieval-floor
  class 2, `05-reference-following.md`) applies to code.
- **The unit's own members only** — the customization's diff operations and methods. Platform/context
  bodies are cited in sourceRef, not reproduced (they are the same on every stand; the customization
  is not).
- **Elide only whole repeated members**, with a comment stating exactly what is elided ("same values
  minus `style`") — never elide inside a member.
- **Head the section with the source identity and the anchor split**: the schema `[Package]` the code
  was copied from, then which names in the snippet are **platform anchors** (stable everywhere — base
  element names, overridden platform methods, platform attribute bindings) and which are
  **customer-owned** (converter names, packages, schema names that may differ where the same behaviour
  appears elsewhere). This split is what lets a consumer recognize the same behaviour under different
  local names.

## Acceptance criteria

The prose fields say what the behaviour *is*; the criteria say what a rebuild must *satisfy*. They
carry no new information — they are the same evidence, re-cut from *per-code-location* (sourceRef
rows) into *per-assertion*. Written because prose loses requirements: a clause in the middle of a
sentence ("on the record page **and** in the section") is read as description and silently dropped,
while a numbered item gets its own answer.

Format — one numbered item per line, business-logic statement only, no citations:

```markdown
- **AC-1** — <a single checkable statement in behaviour terms>
```

Numbering is per card, so a bare `AC-n` is valid only inside the card that defines it. Everywhere
else in prose — another card, a plan, a worklog, code comments in a port — a criterion is cited
card-qualified: `<card id>·AC-n` (e.g. `shared/C04·AC-16`). Two cards in different report files can
both own an `AC-16`; an unqualified citation outside its card is ambiguous and therefore wrong.
(The behaviour index's JSON entries keep bare `AC-n` in their `ac` arrays — each entry's sibling
`card` field already scopes them.)

Derivation rules:

- **One assertion per item, never two.** Each item must be answerable *built / not built* on its
  own. Two surfaces = two items. A dialog and the launch it precedes = two items. If you cannot
  check one half without the other, they are one item; otherwise split.
- **Criteria carry no citations — AC is business logic.** The evidence lives where evidence belongs:
  the sourceRef table and the Code section. The backing discipline still applies at writing time —
  an item nothing in the sourceRef table backs does not belong on the card; it is either an
  Assumption or an invention — but the citation stays in the table, not on the criterion.
- **Resource-backed text is a value, not a name.** When a criterion turns on a caption or message,
  state the actual string for the profile culture and where it came from
  (`SysLocalizableValue`, key `LocalizableStrings.<name>.Value`) — a criterion that only names the
  resource key cannot be checked against a screen. Every string the behaviour shows earns a place in
  the `resource` sourceRef row, dialog buttons and menu items included; a client-unit read returns
  the *references* to those strings, so the values are a separate lookup you must actually do.
- **Wording stays inside what the source says.** If the binding resolves to "not in edit mode", the
  criterion says that — not "only for saved records", which is a reading. Inferences belong in
  *Business logic* or *Assumption?*.
- **Only proven facts become criteria.** Anything resting on an unsettled Assumption stays in
  *Assumption?*; it does not get an AC. Criteria are the checkable floor, not the wish list.
- **Cover, at minimum:** each surface the behaviour appears on · the caption/label and where its
  text comes from · placement · the enablement or visibility condition · the trigger · each branch
  of the effect (including the degenerate branch — "no products → launch directly") · the complete
  cross-boundary contract, one item listing every parameter with its per-branch values
  (`07-boundaries.md`) · every guard and the message it shows · anything the behaviour must *not*
  do (a hardcoded id where the source reads a setting).
- **Behaviour terms, target-neutral.** "An action button captioned from a localizable resource",
  not a Freedom component name and not a Classic element name. This skill describes the Classic
  side; naming the target is the consumer's job (non-goals in `SKILL.md`).
- **Mechanism-preserving where the mechanism is the requirement.** If the source reads an id from a
  setting, "resolved from setting X — never hardcoded" is a criterion, not a note. Consumers
  flatten indirection they read as incidental.
- Do not renumber to hide a gap: if a criterion is dropped after review, say so in the same edit
  rather than closing the sequence.

## Counted zeros

One line each: the layer or artifact class checked, and that it holds nothing. Examples: "layer X
[package P] — verified empty (no diff, no methods)"; "no resource strings for this unit". These are
answers; omitting them makes "checked" indistinguishable from "skipped".

## Refusals

Per unit that cannot be described: what you could establish, what you could not, and what would
settle it. A refusal is a valid outcome (`09-refusal.md`) — it must never be dressed up as a
description.

## Provenance of the run

Record once, alongside the output: the stand, the core version, the date, and the scope boundary
you enumerated (which pages/details were in scope, and any deliberately excluded part with its
reason). A count without a stated scope cannot be compared to anything.

## Style

- **Everything on the card belongs to this one behaviour.** sourceRef rows, assumptions and
  notes cover only the members and premises of the behaviour the card describes. Not on a
  card: members of a neighbouring behaviour (a member needing its own behaviour sentence is
  another unit's member — split it out); scope disclaimers about what a referenced schema
  does on its own; references to the pattern catalog; comparisons with "the usual form" of
  a construction. An assumption is an unproven premise *this card's claims rest on* —
  nothing else qualifies.
- Behaviour first, code second. A reader who does not know the codebase should understand *What it
  is* without reading any source.
- **Name UI locations by their visible captions, not element names.** A container name like
  `HistoryTab` is not what the user sees — resolve its caption resource (here: "Opportunity
  history") and use that in *What it is*. The internal element name belongs in the sourceRef
  row only. A reader matching the card against the running page must find the tab by its label.
- No invented certainty: "presumably", "appears to", "not verified" are correct words when they are
  true — but each must be paired with a settling query, or it is just hedging.
- Do not restate the same fact in three fields. Purpose in *What it is*, reasoning in *Business
  logic*, code in *sourceRef* / *Mechanism notes*.

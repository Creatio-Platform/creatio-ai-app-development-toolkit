# 10 — Worked example (pattern shapes only)

One unit, followed end to end, to show the procedure's shape. **Deliberately anonymized**: the
schema and package names below are placeholders (`SectionSchema`, `PageSchema`, `Utils`,
`PkgA`). This file teaches the *method*; it must never carry findings about a real surface, or a
later run would be graded against its own answers.

## The trail

**1. Ledger spots the members.** Extension layer `SectionSchema [PkgA]` (31 lines) has three
members: a module dependency, a mixin entry, and one diff `insert`. Small layer, fully
enumerable.

**2. Read the diff.** The insert adds a button into a `CombinedMode…` container. Its values:
`caption → getButtonCaption`, `click → onCardAction`, `tag → "DoTheThing"`, `enabled →
canEntityBeOperated`.

**3. Recognize the pattern.** `click: onCardAction` + `tag` is the **card-action relay**
(`06-platform-patterns.md`): the tag is a *method name* to be invoked on the card's view model,
because the button's host (the section module) cannot run the action itself.

**4. Resolve the name in lookup order** (`05-reference-following.md`): `DoTheThing` is not in this
layer → it is in the mixin `Utils [PkgA]`, which the layer mixes in. Fetch that schema. The
method reads a system setting to obtain a process id, has two error paths with their own resource
strings, builds a related-records query, and hands off to a dialog-or-run helper.

**5. Note the boundaries** (`07-boundaries.md`): the process behind the setting is one boundary
out — record the indirection (setting name), not a claim about what the process creates. But the
launch itself is recorded as a contract: the run helper sends *three* parameters — the record id,
a list parameter that is **always** sent (empty string on the "all" branch), and a boolean flag —
and all three go on the card, per-branch values included. A card that says only "launches the
process with the record id" hands a rebuilder two missing parameters.

**6. Check the twin.** The record page's layer for the same package (`PageSchema [PkgA]`) inserts
the *same* control into a plain page container, binding `click` **directly** to the method — no
tag, because the card hosts it. Same behaviour, second insert. **One card, not two units.** The
same layer also overrides the mixin's "which record am I on" hook to return the open record's id.

**7. Write the card.** Behaviour in user terms; sourceRef rows for the two inserts, the mixin
methods, the platform relay pair (kind = OOTB context) and the resource strings; the unit's own
members copied **verbatim** into the Code section (both inserts and the mixin methods — the platform
relay is cited, not reproduced), headed by the fetch provenance and the anchor split (which names are
platform-stable, which are this site's own); mechanism note explaining *why* one behaviour needs two
inserts; assumptions for what the process creates and for anything runtime-only.

**8. Cut the criteria** (`08-card-contract.md`). Walk the sourceRef table and turn each row into
checkable statements: the two inserts → **two** items (one per surface, not "both surfaces" in one
sentence); the caption method → an item naming the resource-backed label; `canEntityBeOperated` →
an enablement item; the setting read → "resolved from setting X, never hardcoded"; the
dialog-or-proceed pair → one item for the has-items branch (with its three outcomes) and one for
the empty branch; the run helper → **one item listing all three parameters with per-branch
values**; the two error paths → one guard item each. Items carry no citations — each must be
backed by a sourceRef row, but the evidence stays in the table and the Code section.
What the process creates has no item — it is still an Assumption.

## What this example demonstrates

| Skill rule | Where it showed up |
|---|---|
| enumerate members before naming units | step 1 found exactly three members, so nothing could hide |
| a binding is a name, not an implementation | step 4 — the behaviour lives in a mixin, not the page |
| platform idioms carry meaning | step 3 turned `tag` from a mystery into "method name across a module boundary" |
| one behaviour, several schemas | step 6 — the count would be wrong twice over if split or merged |
| boundaries stop the subject, not the reading | step 5 — the setting is recorded; the process body is a settling query |
| the hand-off is a contract, not a summary | step 5 — all three launch parameters enumerated with per-branch values, not "launches with the record id" |
| mechanism is supporting | the *why two inserts* explanation is a note, not the behaviour claim |
| criteria are re-cut evidence, not new claims | step 8 — every item traces to a sourceRef row; the unsettled process question gets none |

## Anti-example: what a bad card of the same unit looks like

> "Adds a green button. Method `onCardAction` is called on click, which runs
> `runProcessCreateOrder` to create the record."

Three defects: the behaviour is described as a control rather than an outcome ("adds a button" is
not why it exists); the mechanism claim is wrong in a way that reads fine (`onCardAction` does not
run the method — it publishes a message whose payload names the method); and no source is cited, so
neither error is checkable. This is the failure mode `09-refusal.md` exists to prevent.

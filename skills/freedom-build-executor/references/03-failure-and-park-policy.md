# 03 — Failure policy: repair, park, stop

Three different bad outcomes, three different responses. Confusing them is what turns a run
into an infinite loop or a silent drop.

| What happened | Response | Who decides |
|---|---|---|
| a unit's rows are short after a round | repair round on that unit | the script, from `--verify` |
| a unit is still short after 3 rounds | **PARK** it, keep the rest going, exit once with all of them | the script |
| the PLAN itself is incomplete (D12) | **STOP the whole run**, return to the caller | the script |
| the plan says X and X looks wrong | return a **proposal**, build the plan as written | the builder, then the user |

## Exit 2 is not one condition

`migrate.mjs` exits 2 for five different reasons. **Four of them can fire on a `--verify` run**,
and three of those four are about the plan, not the build: `GATE BLOCKED`, `STRUCTURE INCOMPLETE`
and `COVERAGE INCOMPLETE` fire in EVERY mode, so a perfectly built section still exits 2 when the
plan manifest has a structure or coverage gap. "Loop until `--verify` is green" is unsatisfiable as
written. The fifth, `⛔ PLAN INCOMPLETE`, is emitted **only in `--plan` mode** (it reports required
`planMeta` still unfilled) — it cannot appear on a `--verify` run, so there is nothing to classify
for it here; it is listed below only so the line is recognisable when the planner hits it.

The verdict file already classifies them: `verify.json`'s `planGaps` holds the PLAN-level ones,
and `complete` is the BUILD verdict alone — a run can be `complete: true` with a non-empty
`planGaps`, which means there is nothing left to build and the run still stops. stderr names each
one for a human reader:

```
migrate.mjs: ⛔ VERIFY INCOMPLETE — YOUR BUILD is incomplete: 3 MISSING + 2 unconfirmed …
                                     ^^^^^^^^^^^^^^^^^^^^^^ repairable on-stand → repair round
migrate.mjs: ⛔ GATE BLOCKED — do NOT build. …
migrate.mjs: ⛔ STRUCTURE INCOMPLETE — plan not ready. …
migrate.mjs: ⛔ COVERAGE INCOMPLETE — 4 schema member(s) unaccounted …
migrate.mjs: ⛔ PLAN INCOMPLETE — required planMeta unfilled: …   ← `--plan` mode ONLY; never on `--verify`
migrate.mjs: ℹ this run ALSO has PLAN-level gaps (structure · coverage) — those are NOT
             buildable-out-of; return them to the caller instead of re-verifying against them.
```

**A plan-level line stops the run.** Not a repair round: no amount of building closes a coverage
gap or a blocked correctness gate, and re-running costs a full round for a guaranteed identical
answer. The run returns the gap list to the caller, who fixes the manifest and re-plans. The one
exception is the `ℹ` line, which is advisory context printed alongside a genuine
`VERIFY INCOMPLETE` — a run may carry both, and then the plan gap is what to report.

## The repair round

A round is: build the open units → verify → judge → re-run `--verify`. What "open" means is
arithmetic, never an agent's summary: `verify.pages[<key>].complete === false`.

Per unit, at most **3 rounds**. The counter lives in `build-queue.json` and is written BEFORE the
round runs, so a process killed mid-build resumes at the right number instead of restarting the
budget. Over-counting a round that did not happen is deliberate — it parks earlier, which is the
safe direction.

A repair round is handed the *specific* rows that are short — `verify.json`'s
`pages[<key>].openRows`, each carrying the Deliverable / Status / Evidence text verbatim, so
nothing is transcribed from the table on the way. It is not "try again": that text already names
whether a field is absent by name, a component type is absent, a package is wrong, or a record
was filed but not judged.

## Park, and why the run does not stop at the first stuck unit

After 3 rounds a unit is **PARKED**: no further rounds are spent on it, its state is written to
`build-queue.json` with `parkedWhy`, and **independent work continues**. The run then exits
ONCE, carrying every stuck unit — not once per stuck unit. A caller asked five separate times
about five stuck pages will approve the first three and lose track; a caller asked once, with
five named units and what each is missing, can answer.

`parkedWhy` is composed **where the park is decided**, from that unit's own `openRows` in
`verify.json` — the engine's Deliverable / Status / Evidence text, joined. For a reachability unit
(no page rows of its own) it names the wiring that was never confirmed and what stays broken
without it. It is never blank and never written after the fact: a park is how the run asks the user
a question, and the reason IS the question.

A park **survives the session that made it**, in both directions. It is written to the queue file
as soon as it is decided — including the last one of a run, which is decided after that round's
reconcile has already written the file — and it is read back at the head of the next run, BEFORE
anything is scheduled. Without the read-back a resumed run re-dispatches a parked unit for a full
stand-writing round and re-learns the same shortfall; without the write-back the caller loses the
question the run was trying to ask.

"Independent" needs an honest definition, because the executor does not always know the tree:

- `--units.buildOrder` is a **post-order** array — every page's own sub-pages appear before it,
  `main` last. From the array alone you cannot tell a sibling from an ancestor.
- When the parent edge is available (the reconcile step derives it from the plan's
  `### Child page mappings` nesting), a parked unit blocks its ANCESTORS and nothing else.
  **Blocked means not built.** A parent whose child form does not exist cannot have its related
  list wired to that form, so spending a round on it burns budget and re-learns the same
  shortfall. Blocked units are reported, in `blockedByParked`, not attempted.
- When it is not, the run falls back to: a parked unit blocks `main` only, everything else
  continues — and it **says so in its return** (`independence: "approximated"`). A workflow that
  claims independent branches continued, while it actually just kept going, is exactly the
  unearned claim this design exists to remove.

The five non-page units — `typedFormsBuilt`, `typedRouting`, `miniPageWired`, `reuseBindings`,
`sectionRegistered` — are not in `buildOrder`. Each `--units.reachability[]` entry publishes the
page keys whose rows read it, so it is scheduled after the last of those pages — arithmetic from
published data, not a judgement in a prompt.

## Never weaken a gate to reach green

Repair means building the missing thing or filing the missing evidence. It never means:

- editing the manifest so the row stops being emitted;
- filing an evidence record that names a reference page you did not diff against;
- recording `reachability.X: true` for wiring you did not confirm on-stand;
- marking a `⚠ Confirm` item resolved because it is probably not applicable.

A `false` is an honest answer and a legitimate one — it says *checked, and genuinely absent*. A
fabricated `true` is the one thing that cannot be recovered from, because every later run trusts
it. If a unit cannot pass, park it and say why.

## Plan deviations are proposals

The builder builds the plan as written — every profile island, every tab, both halves of a
two-part component. When it believes the plan is wrong, it records a proposal
(`{ unit, deviation, why }`) and **still builds the plan**. The run returns the proposals; the
user decides. Silently building something smaller is the recurring failure this rule exists for,
and it is invisible to `--verify` whenever the smaller thing happens to satisfy the counts.

## What the caller gets when a run does not close

One structured return, always the same shape whether the run closed or not:

- the computed verdict (`complete`, `missing`, `unverified`, per-page breakdown);
- every parked unit with its round count and `parkedWhy`;
- every plan-level gap, separately from build gaps;
- every proposal, none applied;
- every unit reported "cannot verify, unknown schema" (`unknownSchema`), and the key → Freedom
  schema map the run recorded;
- the paths of the queue file, the built file, the `--verify` table and its `verify.json` verdict.

Every one of those also lives in the queue file, so the same answer is recoverable from disk by an
agent that never saw this run.

The `--verify` table is the report. A hand-authored "here is where things stand" summary in its
place is the failure mode this whole skill replaces — blocked and done both come from the same
machine-verified artifact.

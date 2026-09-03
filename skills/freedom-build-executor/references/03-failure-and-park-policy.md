# 03 — Failure policy: repair, park, stop

Three different bad outcomes, three different responses. Confusing them is what turns a run
into an infinite loop or a silent drop.

| What happened | Response | Who decides |
|---|---|---|
| a unit's own in-context gate is short as it builds | **one bounded fix** in that same context, then **PARK** | the builder, from its scoped `--verify --page` |
| a unit's rows are short after a round | repair round on that unit | the script, from `--verify` |
| a unit is still short after 3 rounds | **PARK** it, keep the rest going, exit once with all of them | the script |
| the PLAN itself is incomplete (D12) | **STOP the whole run**, return to the caller | the script |
| the plan says X and X looks wrong | return a **proposal**, build the plan as written | the builder, then the user |

## Exit 2 is not one condition

`migrate.mjs` reports five different bad outcomes, and exactly ONE of them is about your build.
The other **four are PLAN-level** and no amount of building closes any of them:

| Plan-level kind | What it says | Where the remedy is |
|---|---|---|
| `GATE BLOCKED` | a correctness signal — a broken merge, an effect the mapper cannot represent | the **STAND or the input schemas**; resolve what the gate reasons name |
| `STRUCTURE INCOMPLETE` | required inputs not supplied (detail / profile / child-page schemas) | the **manifest** |
| `COVERAGE INCOMPLETE` | a schema member with no artifact and no decision | the **manifest** |
| `PLAN INCOMPLETE` | plan completeness — required `planMeta` unfilled, on-stand `signals` unresolved, `placement` unsettled | the **manifest** (a `signals` answer after a read-only stand check) |

That split is the whole point of naming the kind: three of the four are fixed by editing the
manifest and re-planning, and a `GATE BLOCKED` is not — telling an operator to "fix the manifest"
for a blocked correctness gate sends them to the wrong file. `⛔ VERIFY INCOMPLETE` is the fifth
reason and the only repairable one.

**Where this run gets the classification (ENG-95857).** From `--units.planGaps`, copied VERBATIM by
Reconcile step 2 — the engine's own machine-readable verdict, covering all four kinds. It is NOT
assembled from stderr lines an agent retypes: that enumeration named three of the four, so
`PLAN INCOMPLETE` could not stop a build however loudly `--plan` had refused it, and dropping or
paraphrasing one of the other three suppressed the stop for that kind too.

`verify.json`/`verify-summary.json` keep their own `planGaps`, and it is deliberately NARROWER —
those files are the BUILD verdict, and a `--verify` run legitimately happens over a manifest that
carries no `planMeta`. Do not read the plan-level verdict from them. `complete` there is the
BUILD-side answer: a run can be `complete: true` with a non-empty `--units.planGaps`, which means
there is nothing left to build and the run still stops. (`complete` itself still folds `missing`
and `unverified` together; the builder-owned axis is `buildComplete`, covered below.) stderr names
each one for a human reader:

```
migrate.mjs: ⛔ VERIFY INCOMPLETE — YOUR BUILD is incomplete: 3 MISSING + 2 unconfirmed …
                                     ^^^^^^^^^^^^^^^^^^^^^^ repairable on-stand → repair round
migrate.mjs: ⛔ GATE BLOCKED — do NOT build. …
migrate.mjs: ⛔ STRUCTURE INCOMPLETE — plan not ready. …
migrate.mjs: ⛔ COVERAGE INCOMPLETE — 4 schema member(s) unaccounted …
migrate.mjs: ⛔ PLAN INCOMPLETE — required planMeta unfilled: …   ← `--plan` mode; reaches this run via `--units.planGaps`
migrate.mjs: ℹ this run ALSO has PLAN-level gaps (structure · coverage) — those are NOT
             buildable-out-of; return them to the caller instead of re-verifying against them.
```

**These lines are for a HUMAN reader.** Do not classify from them — the stop reads
`--units.planGaps`. They are printed here so an operator recognises what the machine set is naming.

**A plan-level gap stops the run.** Not a repair round: no amount of building closes a coverage
gap, an unfilled plan or a blocked correctness gate, and re-running costs a full round for a
guaranteed identical answer. The run returns the gap list to the caller, naming which kind fired so
the caller knows whether the remedy is in the manifest or on the stand (see the table above). The
one exception is the `ℹ` line, which is advisory context printed alongside a genuine
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

## The in-context completeness gate — one bounded fix, then park (ENG-95469)

Before a build agent reports its unit complete, it runs a **scoped single-unit gate** over its OWN
page — `migrate.mjs <manifest> --verify --page <yourKey> --verify-json <self-verdict.json>`
(recipe `./04-per-page-build-recipe.md`, step 10). This is the same detector the post-hoc `--verify`
sweep uses — one module, two call sites — narrowed to one page, so a deliverable the slice *declared*
but the build left short (a datasource-less grid, a component not on the page, a rule the slot does
not carry) is caught **as the unit builds**, not a whole round later.

Its park budget is different, and deliberately so. The gate allows **exactly one bounded fix** in
the builder's own context: if `buildComplete` (ENG-95901 — the OWNER axis; `complete` is
kept only for the post-hoc CLI verdict and folds in unfiled evidence too) is not `true`, the builder
repairs the rows the verdict's `openRows` name **whose `owner` is `"builder"`** — never a row
whose `owner` is `"verifier"`, since that is an evidence/judge/reachability record a separate
read-only verifier/judge files, not the builder's to close. `owner` is the axis to read, not the
`missing`/`unverified` status: a partially-built page reads `unverified` and is still entirely the
builder's work. It re-runs the gate **once**, and stops. Still short
after that one attempt is a valid outcome — the unit **parks immediately**, with `inContextParkWhy`
composed from the gate's still-short rows. It does **not** spend the 3-round post-hoc budget below:
one bounded fix, then park, so a unit that cannot be completed in its own context does not burn three
stand-writing rounds re-learning the same shortfall. A page whose only open rows are unfiled evidence
is `buildComplete: true` and never reaches this park path at all — it stays open for the post-hoc
verifier/judge round instead, which is the round actually able to close it.

Three guards keep this honest. The builder trusts the engine, not itself: `selfCheck.buildComplete` /
`complete` / `missing` / `unverified` are copied **verbatim** from the engine's single-unit verdict
file, never a self-graded claim. The script trusts neither blindly: an in-context park fires only when
the **post-hoc verifier** (a separate read-only agent, re-reading the stand that round) also reports
the unit open — a builder that mis-reported "still short" on a page the verifier finds green does not
park it. And the script does not take the *self-report itself* on trust: at the bottom of the round
it **cross-checks every page unit's `selfCheck` against that same independent verifier's own
`buildComplete`** and records a discrepancy where they disagree — a builder that self-reported the
gate *passed* (`buildComplete: true`) on a page the independent verifier's `buildComplete` says is
NOT true (a fabricated green the in-context park would miss, since it only fires on
`buildComplete: false`), or one that returned `ran: false` on a still-open unit (the gate bypassed).
Comparing `buildComplete` to `buildComplete` — not `complete` to "still open" — is deliberate: a page
honestly `buildComplete: true` with only unfiled evidence rows is still open per the post-hoc verifier
(the evidence is unconfirmed), but that is expected, not a self-report/verifier disagreement, so it is
never flagged. The cross-check changes no verdict — the `--verify` sweep remains the authoritative
evidence — it only removes the "nothing independently checks the scoped gate ran" gap by naming where
the self-report and the independent detector part ways.

Read the "never a self-graded claim" guarantee no wider than it holds: it covers exactly
`buildComplete` / `complete` / `missing` / `unverified`, the engine's arithmetic transcribed. The two
fields the in-context park path actually gates on — `selfCheck.ran` and `selfCheck.fixAttempted` —
are **not** in the engine's verdict file; they are the builder's own self-report, so a builder can keep
its own unit out of the in-context park by reporting `ran: false` or `fixAttempted: false`. Their only
backstop is the guard-3 cross-check above, which is **non-blocking** — it records the discrepancy in
the run's audit trail, it does not force a park — and the round-budget post-hoc park, which still
catches a genuinely-open unit within its round budget no matter what the self-report claimed. So the
in-context gate is an *earlier-discovery* optimisation resting partly on builder honesty for `ran` /
`fixAttempted`; the correctness floor is the independent post-hoc verifier, never the self-report.

The in-context gate only moves the *discovery* of a shortfall
earlier and caps the fix at one attempt. Never weaken the build to make the gate pass — a fabricated
green is unrecoverable (see "Never weaken a gate to reach green" below).

## Park, and why the run does not stop at the first stuck unit

After 3 rounds a unit is **PARKED**: no further rounds are spent on it, its state is written to
`build-queue.json` with `parkedWhy`, and **independent work continues**. The run then exits
ONCE, carrying every stuck unit — not once per stuck unit. A caller asked five separate times
about five stuck pages will approve the first three and lose track; a caller asked once, with
five named units and what each is missing, can answer.

ENG-95901 note: a PAGE unit open only because of unfiled evidence (`buildComplete: true`,
`complete: false`) can still be round-budget parked here like any other stuck unit — the round
budget is the ONE mechanism bounding the outer round loop (there is no separate global round
ceiling), so excluding such a page from it would trade a bounded-but-imperfect park for a run that
never terminates if the evidence is never confirmed. This is a known rough edge (parking over a row
the build round itself cannot close), not a defect this ticket fixes — it is the round-scheduling
loop's own tradeoff, tracked separately from the in-context gate and self-check fixes above, which
DO key off `buildComplete` and are unaffected by this note.

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

## Environment faults are NOT build failures — never let one spend a repair round

Measured on a live stand while exercising this loop. A clio call can fail for reasons that have
nothing to do with what was built, and each looks like a data problem until you recognise it:

| Symptom | What it really is | What to do |
| --- | --- | --- |
| `'<' is an invalid start of a value` / `Unexpected character encountered while parsing value: <` | The cached session expired and Creatio answered the LOGIN PAGE (HTML) instead of JSON. clio does **not** re-login by itself, and re-running `reg-web-app` on the same environment name does **not** clear it. | Register the SAME uri under a NEW environment name and use that, or pass `uri` + `login` + `password` directly for the call. Then continue — nothing about the build is wrong. |
| First call takes 10-15 s, later calls are fast | The app pool was asleep; the first request woke it. | Retry once. Do not treat the slow call as a timeout failure. |
| `nodename nor servname provided, or not known` | DNS/VPN dropped, not a Creatio fault. | Re-check the tunnel, then retry. |
| `MCP tool '<name>' timed out after 120s (error-class=creatio-timeout)` | The MCP transport, not the stand. Measured over one build run: `get-page` through `clio-run` averaged 90 s with 11 timeouts while the SAME reads through the shell `clio` averaged 2.3 s with none. Re-issuing over the same transport reproduces it — one run timed out on a single page seven times across two agents, ~14 min for a 2 s read. | **Switch transport on the FIRST occurrence — no retry.** Run the same command through the shell CLI (`clio <command> -e <env>`, flags per `clio help <command>`) and record the switch in `notes`. A timeout means switch transport, not retry: re-issuing costs another 120 s on a path already known to be deterministic. Never write your own MCP client to get around it. |
| `MCP server … sent no response or progress for 1800s; aborting` | The clio MCP server wedged — no progress ping at all. Half an hour is gone before the abort surfaces. | **Switch transport on the FIRST occurrence — no retry.** Go to the shell CLI for that command and record the switch in `notes`. Spelled out rather than inheriting the row above, so a re-issue cannot be read into it: a single retry here costs another half hour. If the CLI is also unreachable, that IS an environment fault worth parking on — say which transports you tried. |
| One tool returns HTML while `get-page` / `list-pages` still work | That specific command needs `cliogate` installed on the stand (e.g. `list-packages`, `get-target-package`). | Get the same fact another way (`list-apps` → `get-app-info` for a package name) rather than declaring the environment broken. |

**Rule: an environment fault must not count toward a unit's round budget.** A round is spent only
when the stand answered and the deliverable is still short. Classify the failure first — if it is any
row above, fix the connection and re-run the same round. Otherwise a stand that merely fell asleep
can park a perfectly buildable unit after three "failed" rounds and hand the caller a question that
has nothing to answer.

## A dead AGENT is not a finished round — never report the previous verdict as current

The verifier is the only step that refreshes the verdict. If it does not answer — an expired host token, a
killed agent, an API error — then the numbers on file are the PREVIOUS round's, while this round has already
written to the stand. Reporting them as the outcome is not a small inaccuracy: it is a status report that does
not match reality, which is the failure this whole gate exists to prevent.

Observed for real on this ticket: a run whose `verify`, `judge` and `reconcile` agents all died on
`401 OAuth access token has expired` completed "successfully" and returned the verdict from the run BEFORE it,
with one build round silently unaccounted for.

So the run STOPS with `stopped: "verifier-failed"` and `verdictStale: true` rather than continuing, and says
plainly that the verdict shown predates the round. Nothing needs undoing — the queue file and the built file
are intact, and a re-run re-reads the stand. The same rule applies to a reconcile that does not answer
(`stopped: "reconcile-failed"`), where the verdict is current but the queue state is not.

**Distinguish this from the environment faults above.** Those are Creatio failing to answer a read, and they
must not spend a repair round. This one is the RUN's own machinery failing, and it must not produce a number
at all.

## A host-rejected agent: the reason is not in the run's return

When the host rejects an agent before the model runs (e.g. `blocked by safety classifier: …`), the
script sees only `agent()` returning `null` — no reason attached, so the run can neither log nor
branch on the cause. The reason is recorded by the host: in the run's failure lines and in the run's
transcript directory (`journal.jsonl`, plus the per-agent `agent-<id>.jsonl`). Read those before
acting on the failure.

Treat the host's label as a symptom until it is measured. Some rejections are transient — re-run the
SAME route. **One is not:**

> `blocked by safety classifier: output schema too large to classify safely`

This one is deterministic. The guard, in the CLI:

```js
if (permissionMode !== 'auto') return false          // the check runs in `auto` sessions ONLY
if (JSON.stringify(schema).length > 4096) -> "output schema too large to classify safely"
```

An agent whose SERIALIZED output schema exceeds **4096 bytes** is refused before the model runs — 0
tokens, no `agentId` — and no re-run or retry attempt clears it. The mode gate is what makes it look
intermittent: the identical schema passes in `bypassPermissions`/`default`, so the same bytes can
block every launch in one session and pass every probe in the next. A probe outside `auto` mode
therefore measures nothing about the cap.

**The fix is to get the schema under the cap** — there is one remedy, not two.
`engine-tests/classic-to-freedom/run-infra.mjs` asserts every agent schema of every shipped workflow
against it, with `RECONCILE_SCHEMA` held tighter (3500 bytes) as the run's first agent. When a schema
has to shrink, loosen the DESCRIPTION of its nested objects — never drop a property the core computes
on — and move that inner contract into `RECONCILE_SHAPE`, which the script checks when the answer
arrives.

Leaving `auto` mode is NOT a remedy: it skips the safety check rather than satisfying it, on a
workflow whose whole purpose is destructive writes to a live stand (`create-app`, minting packages,
writing page schemas). Its only use here is diagnostic — it explains why a probe outside `auto`
proves nothing, and it is why the same bytes can look intermittent. Do not run a build that way to
get past this error.

And clearing the size branch is **necessary, not sufficient**: the dispatch then reaches the real
classifier, which can refuse with the same `blocked by safety classifier:` prefix for its own
reasons. A block after the shrink is a different question — do not go hunting for bytes that are
already inside the cap.

Only the SAME rejection repeating across launches is worth stopping for — and then measure the
reported cause before building a fix on it, since the label may name a cause nobody checked.

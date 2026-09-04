# Decision records — the agent-facing contract of this workflow

This workflow is invoked over an API-first boundary: other agents and harnesses call the
`freedom-build-executor` Workflow tool and read its return value. A change to what it *requires* or
what it *returns* is a change to a contract someone else depends on, so the deliberate ones are
recorded here rather than left in a PR body. One entry per decision: what changed, what was
rejected, and what a caller has to do.

Behaviour that is merely *documented* belongs in `../SKILL.md`. This file is only for decisions
where the previous behaviour was also defensible and a caller could be broken by the new one.

---

## DR-1 (ENG-96204) — an omitted `mode` no longer means `auto`; the run refuses to start

**Status:** accepted, shipped in ENG-96204.

**The change.** `buildMode()` used to return `'auto'` when no mode was given. It now returns
`null`, and the run stops before its first stand write with `stopped: 'mode-not-chosen'`, reporting
`validModes` and a one-line description of each. Launching without a resolvable mode is therefore a
refusal rather than an unattended build. `mode` is still not a required *argument* — a
`{ "kind": "run", "item": "control-mode", "answer": "<mode>" }` entry in `resolutions.json` or a
`defaultMode` argument both resolve it, and `modeSource` reports which one did.

**Why.** `auto` was the one answer an operator cannot un-choose. A run they meant to watch had
already written the whole section by the time they discovered it never stopped, and no later
correction reaches a page that is already on the stand. A default that can only be wrong in the
expensive direction is not a safe default.

**What was rejected, and why.**

- *Keep `auto` as the default and let the operator opt out.* This is the compatible option and it
  was rejected on the same ground the change exists for: the failure is silent and irreversible, so
  the cost of the wrong default is not symmetric with the cost of an extra required decision. An
  opt-out also has to be *known about* to be exercised, which is exactly what the incident showed
  was not the case.
- *Default to the most conservative mode (`guided`) instead.* Rejected as a different silent
  choice: it would stop a genuinely unattended run after every unit, and a caller that wanted
  `auto` would discover the change as a run that never finished rather than as a refusal that says
  what to do.
- *Make `mode` a required argument.* Rejected because the answer legitimately arrives from three
  places with different lifetimes — this launch's argument, the operator's standing answer in
  `resolutions.json`, and a configured non-interactive default. A required argument would force a
  driving agent to re-ask a question the answer file already holds.

**Migration path for a caller.** Do one of three things, in falling order of preference:

1. Pass `mode` on the launch (`round1`, `layout-first`, `checkpoints`, `guided`, `auto`).
2. Record `{ "kind": "run", "item": "control-mode", "answer": "<mode>" }` in the migration folder's
   `resolutions.json` — this is what a driving skill does after asking a human, and it survives
   across invocations.
3. For a run nobody is watching, pass `defaultMode: "auto"`. This reproduces the OLD behaviour
   exactly, as a choice on file rather than a choice nobody made, and the run reports
   `modeSource: 'default'` so the log says why it never stopped.

A caller that does none of these gets `stopped: 'mode-not-chosen'` with `validModes` and builds
nothing — a stop that names its own fix, not a crash.

**Where this sits against the versioning policy (PR review, minor 5).** `AGENTS.md` §Versioning
Policy makes "breaking change in workflow contracts" a **MAJOR** bump, and an omitted `mode` no
longer resolving to `auto` is exactly that class of change. It does **not** trigger a MAJOR bump
now: this contract has never shipped on `main`. The base is the unreleased `ENG-94529-migration-stage-2-poc`
epic branch, `mode` was introduced on that same unreleased branch, and no released CAADT version
exposes a `freedom-build-executor` launch without a required mode — so there is no published
contract to break. The obligation is deferred, not waived: **whoever merges this epic to `main` owns
the MAJOR bump for the epic as a whole**, and this DR is the record that the mode gate is one of the
breaking changes that bump covers. If the epic were ever released in pieces, this change would have
to lead one of them.

**Compatibility evidence, and its limit.** No in-repo caller launches this workflow with a
constructed argument list: the only launcher is the migration skill (`../../
classic-to-freedom-migration/SKILL.md`), which is agent-driven and now presents the mode as
required, and the engine tests pass `mode` explicitly. **External callers were verified on 2026-09-04, and the
expectation held.** `creatio-adaclio-testing` (the E2E harness that drives CAADT through a coding
agent) was cloned and searched: it contains **no reference to `freedom-build-executor` or
`classic-to-freedom` at all**. It invokes exactly one skill — `creatio-app-orchestrator`
(`scripts/lib/orchestrator.py`, `_skill_request()`) — which is the natural-language app-generation
path, not the migration path. Its four `mode` occurrences are unrelated (`install_baseline`, a
Teams notification mode, `clio-mcp-only` vs `standard` workspace status, and a literal string in a
guardrail test). So the harness cannot reach this workflow, with or without a `mode`.

This paragraph previously recorded the opposite — that the claim was an expectation and not a
measurement — and is corrected rather than deleted, because the limit was real for the two review
rounds it stood. If some *other* external caller is found later, option 3 above is still a one-line,
behaviour-preserving fix on its side.

---

## DR-2 (ENG-96204 PR review) — a mistyped RECORDED control-mode answer is a stop, not an exception

**Status:** accepted, shipped in the ENG-96204 review round.

**The change.** `resolveControlMode` used to hand a recorded answer straight to `buildMode`, which
throws on an unrecognised value. A misspelled `resolutions.json` answer therefore raised an
uncaught exception *inside* the run — after the baseline Reconcile had already spent an agent. It
now returns `{ mode: null, source: 'resolutions', invalidAnswer: '<what was written>' }`, and the
run stops with `stopped: 'mode-invalid'`, reporting `invalidMode` and `validModes`.

**Why.** The two launch inputs (`mode`, `defaultMode`) are validated when the context is built,
before any agent runs, and they still throw there — that is the right place for a bad argument. The
recorded answer is the one value first seen mid-run, and it was the only control-mode input whose
failure mode was a stack trace, sitting next to a feature whose entire purpose is replacing
crash-prone failure with a refusal an operator can act on: an *absent* mode got a structured stop
listing the five modes, while `round-1` for `round1` got an exception.

**What was rejected.** *Correcting the answer to the nearest valid mode.* An answer this script
rewrote would be the operator's decision silently replaced by its own guess — the same objection
that removed the `auto` default in DR-1. Nothing is normalised beyond case and surrounding
whitespace.

**Migration path.** None for a correct caller: a valid answer behaves exactly as before. A caller
that was catching the exception should read `stopped === 'mode-invalid'` instead; nothing is built
in either case.

---

## DR-3 (ENG-96204 PR review) — the round authorisation is a checked vocabulary, not a non-blank string

**Status:** accepted, shipped in the ENG-96204 review round.

**The change.** The resume gate used to treat any non-blank `round-<N>` answer as authorisation. It
now reads a small affirmative vocabulary, treats a recognised negative as an explicit refusal, and
fails closed on anything it does not recognise. The stop reports `roundAnswerVerdict`
(`absent` / `refused` / `unrecognised`) and `roundAnswer`. The vocabulary is published in
`../SKILL.md` and in the stop's own `next`.

**Why.** A recorded `"no"` authorised the round it was declining. That is not an adversarial case:
the launcher instructs a driving agent to record the operator's answer, and the natural way to
record a decline is to record the decline. The round it authorised writes to a live customer stand.

**What was rejected.** *Matching an affirmative anywhere in the answer.* `do not go yet` contains
`go`; substring matching is how "not yet" becomes "yes". A multi-word answer that is not exactly a
listed word is `unrecognised`, which stops.

**Migration path.** A caller or driving skill that records `"go"` — which is what every document
and every stop has always prescribed — is unaffected. One that recorded free text must now record
one of the listed words; the stop names them.

## DR-4 (ENG-96204) — the round-boundary stop reports open COUNTS and a pointer, never the open rows

**Status:** accepted, shipped in ENG-96204.

**The change.** The stop's `openRanked` field is gone, and with it the ranked row table that
`run-status.md` inlined. The stop now returns `openCounts` — one entry per still-open unit with its
`missing` / `unverified` tallies (or a one-line `why` for a unit whose deliverable is a package or a
configuration record rather than a verified page), plus `unitsOpen`, `open` and the severity tally
`correctness` / `fidelity` / `unstamped` — and both the return and the status document POINT at
`verify.md` and `verify.json`, where the engine stamps every open row with `rowSeverity`. The
helpers that served the old payload (`rankOpenItems`, `openItemsFor`) were removed rather than left
unused.

**Why.** ENG-95930 had already decided this about this exact boundary: the central verify Reconcile
transcribes the counts-only `verify-summary.json`, `VERIFY_RESULT` was deleted, and the whole answer
is capped at `RECONCILE_ANSWER_MAX_BYTES` because per-row prose crossing the Reconcile → script
boundary truncated a real run's first structured answer before it built anything. So
`verify.pages[*]` carries counts and no `openRows` at all — `RECONCILE_SHAPE.verify` names none and
the prompt forbids transcribing them. The row-carrying stop was therefore reading a field that
structurally never arrives: on an ordinary run it reported an EMPTY open list, and on a large open
set the answer that could have carried the rows is refused over the ceiling and the run dies
`reconcile-failed` with nothing built and nothing reported. Counts plus a pointer is the shape
ENG-95930 already applied to `parkWhy`, `parkRecord.shortRows` and `dryRunReport`.

**What this costs.** AC 2 asked for open items *ranked by severity* at the stop. The stop now
reports the severity tally rather than an ordered list, and the ordering is read one hop away, in
the artifacts that hold the per-row stamp. The band is deliberately not re-derived in the executor,
because a second copy of the engine's fidelity discrimination is a second thing to drift — so when
this record was written every page row was tallied `unstamped`, and `fidelity` was structurally
zero. *Superseded in the same ticket:* the engine's `verifySummary` now publishes `openCorrectness`
/ `openFidelity` per page (two integers, counted off the same `rowSeverity` stamp), and the stop
tallies those, so the severity tally is real for pages and `unstamped` is left only to a summary
written before the fields existed.

**What was rejected.** *Capping the rows instead of dropping them.* There is no cap at which per-row
prose fits: the fixture that measured this is 40 open rows on one page, whose answer encodes to
36,298 wire bytes against a 16,000-byte ceiling, and the cap the first cut applied was on the
STATUS DOCUMENT — downstream of an answer that never arrives. *Publishing severity counts from the
engine's `verifySummary`.* Deferred at the time as an engine change this rework did not make — and
then made, later in the same ticket, as the two per-page integers described above (the counts are
the only thing that crosses; the rows still do not).

**Migration path.** A caller reading `openRanked` reads `openCounts` instead: `openCounts.open` for
the total, `openCounts.units` for the per-unit numbers, and `verify.json` for the rows. `built`,
`parked`, `remainingOpen`, `next` and `runStatusFile` are unchanged.

---

## DR-5 (ENG-96204, folding in ENG-96474) — a spent round answer is recorded in the queue file, never in `resolutions.json`

**Status:** accepted, shipped in ENG-96204.

**The change.** When the resume gate authorises round N off a `round-N` answer, the run records the
item in the queue file's root key `consumedRoundAnswers` (`["round-2", …]`), in the same write that
advances `roundsSpent`. On every later invocation the gate refuses a listed item **by record** —
`roundAnswerVerdict: 'consumed'`, the item named in the stop, nothing built — before it reads the
answer's text and independently of the `roundsSpent` arithmetic. The list is a union across
invocations, is part of the carry fingerprint (so a no-op persist cannot drop it — the F10 lesson),
is REQUIRED on the Reconcile answer (`[]` on a fresh folder), is reported on every return, and is
listed in `run-status.md` as *spent* against the item currently *awaited*.

**Why.** One answer must authorise one round. `roundsSpent` already makes that true by arithmetic,
but a count is a thing a hand edit or a restored copy of the queue file can lower, and when it is
lowered the same `go` reads as consent for a round that has already been built against a live
stand. A record of *which answers were spent* is a fact the count cannot lower. Answers therefore
ACCUMULATE in the operator's file — `round-2`, `round-3`, `round-4` — and consumption lives beside
the count it protects.

**What was rejected, and why.**

- *Stamping `consumedAt` (or deleting the entry) into `resolutions.json`.* Rejected because that
  file is the one a human writes FOR the machine — the single answer channel every decision in this
  run travels on — and the moment the run writes into it the boundary between the operator's input
  and the machine's state is gone: a driving agent can no longer tell an entry the human recorded
  from one the run annotated, a hand-restored copy of the file silently un-spends an answer, and the
  operator's own record of what they decided is edited under them. The machine-owned queue file
  already holds every other durable decision of the run (`roundsSpent`, `layoutPassDone`, the
  parks), so the record belongs with them.
- *Folding the consumed record into `roundsSpent` (treating a consumed `round-N` as N rounds
  spent).* Rejected because it would silently repair a walked-back count instead of refusing on it,
  and the by-record refusal would become unreachable — the point is that the two records are
  independent, so lowering one cannot defeat the other.
- *Accepting the answer once more and advancing to the first unconsumed round.* Same objection: a
  gate that guesses which round the operator meant is the gate DR-3 removed.

**Migration path for a caller.** None for a correct one: a fresh folder reports
`consumedRoundAnswers: []` and behaves exactly as before. A driving agent that re-records the same
`round-N` entry after a refusal should read `roundAnswerVerdict === 'consumed'` and follow the
stop's `next` (restore `roundsSpent` in the queue file; leave the entry alone) rather than
re-asking the operator for an answer that is already on file. A Reconcile answer that omits
`consumedRoundAnswers` is refused by the host and retried, exactly as one that omits
`runResolutions` is.

### The round NUMBER, and why it is not a per-invocation index

Recorded here rather than as its own record (PR review, thread on
`05-decision-records.md:118`): after the fix below, the derivation and the consumption above are one
story about one counter, and the PR body's provisional "DR4" number is already taken by a different
subject in this file.

**What it is.** `roundsSpentNow()` is the count of rounds this migration FOLDER has spent, and
`nextRoundNo()` is that plus one. It is deliberately not "the Nth round of this invocation": a
round-boundary mode runs one round per invocation, so a per-invocation index would restart at 1 on
every resume and the same `round-1` answer would authorise every round forever.

**It was wrong, and fixing it made it simple.** `roundsBefore` was seeded from
`roundsOnFile(state.roundOf)` — the per-unit REPAIR counters — which drops the root count. A layout
pass charges no per-unit counter, so on the logic pass the seed fell back to 0, the carry instructed
the count DOWN, the stop re-asked for the `round-N` just spent, and the next invocation refused it as
consumed: `layout-first` deadlocked while telling the operator they had lowered the number by hand.
Seeding from `roundsSpentOnFile` (with the `layoutPassDone` floor) fixed it, and has a second effect
worth stating: `roundsBefore` is now already ≥ the other two inputs to that `Math.max`, so
`roundsSpentNow()` reduces to `roundsBefore + round`. The max is defensive residue, not three
competing counters.

**The one surprise that remains.** An operator who runs three rounds in `auto` and then switches to
`round1` is asked to authorise `round-4`, not `round-2`. That is correct — four rounds will have been
spent on the folder — and it is now explainable in a sentence instead of requiring the formula. It is
the reason the stop names the exact entry to record rather than leaving the operator to derive it.

---

## DR-6 (ENG-96204) — `unit` is the internal term, "step" is the word an operator reads, and the OFFERED modes are a subset of the VALID ones

**Status:** accepted, shipped in ENG-96204.

**The change.** Two splits, both between what the machine keys on and what a human is shown.

1. **Term.** `unit` stays the internal term everywhere it already is: the queue-file keys, the
   `checkpointAfter` values, `findings: [{ unit, problem }]`, `openCounts.units`, the engine keys and
   every test assertion. Only the prose a human reads changed, and the word there is **step** —
   `buildModeMenu()`'s descriptions, the `mode-not-chosen` / `mode-invalid` refusals, the
   `run-status.md` headings (`Paused after step:`, `Still open (steps)`, `N step(s) still open`), and
   the operator-facing paragraphs of the two skills.
2. **Set.** `buildModes()` remains the five VALID values (`auto`, `checkpoints`, `guided`, `round1`,
   `layout-first`) and still drives validation, `defaultMode` and the unknown-mode throw. A second
   hoisted function, `offeredModes()`, returns the three PRESENTED to an operator (`guided`,
   `round1`, `layout-first`) and is what `buildModeMenu()` renders. `mode-invalid` names all five, so
   a caller who deliberately passed `checkpoints` or `auto` is never told it was invalid.

**Why not a global rename to "step".** Because it would be inaccurate, not merely churn. A unit is
NOT always a page: the `app` unit creates the application and the package, and the reachability /
section-registration units produce configuration records. "Page" was already wrong for those, and
renaming the KEYS would break published contract surface for no user gain — `checkpointAfter` and
`findings[].unit` are values a driving agent and an operator's `resolutions.json` already carry, and
`openCounts.units` is a published return field. The cost of the split is one convention to remember;
the cost of a rename is a breaking change to buy a word.

**Why `auto` is legal but not offered.** The ticket specifies three modes and never mentions `auto`.
Offering "run unattended" inside a menu whose entire purpose is operator control is
self-contradictory: the stop exists because an absent mode used to mean `auto`, and a run the
operator meant to watch had written the whole section before they found out. Putting `auto` back on
that menu re-offers the one answer the gate was built to stop being taken by accident. It stays
fully accepted as an explicit `mode` and as `defaultMode`, which is the declared unattended path and
where a genuinely unwatched run says so on file.

**Why `checkpoints` is legal but not offered.** Same rule, applied consistently: the offered set is
the TICKET's set, and `checkpoints` is an inherited mode ENG-96204 does not specify. Nothing about it
changed — the mode, `checkpointAfter`, `shouldPauseAfter`, the `unknown-checkpoint-key` refusal and
the `paused-at-checkpoint` stop are all still there and still tested — it is simply not put in front
of an operator as a choice, and a caller that asks for it by name gets it.

**What was rejected, and why.**

- *Renaming `unit` to `step` everywhere.* Rejected above: the `app` and reachability units are not
  pages or "steps a user checks", and the keys are published.
- *Deleting `checkpoints` now that it is unoffered.* Rejected outright. It predates this ticket and
  has callers; removing it would be a second breaking change nobody asked for, on top of the one this
  ticket already makes deliberately (an absent mode no longer meaning `auto`). Not offering a value
  and not accepting it are different decisions, and only the first was taken.
- *One list with an `offered: true/false` flag per mode.* Rejected as a shape that makes the
  common read ("what may an operator choose?") a filter over a list whose other entries are the
  answer to a different question. Two functions, each with one caller-visible job, keep
  `buildMode`'s validation and `buildModeMenu`'s rendering from having to agree about a flag — and a
  mode added to one and not the other is caught by a pin that asserts the two sets differ by exactly
  `auto` and `checkpoints`.
- *Dropping the "NO DESCRIPTION" fallback in `buildModeMenu()` now that the map is hand-kept.*
  Rejected: it is the property that makes a mode added to `offeredModes()` and left undescribed
  render loudly instead of vanishing from the operator's menu.

## DR-7 (ENG-96204, forced by ENG-96455) — the folder's three round-record keys became one `roundState` object, to stay under a hard host cap

`RECONCILE_SCHEMA` used to declare `layoutPassDone`, `roundsSpent` and `consumedRoundAnswers` as
three ROOT properties. It declares one bare `roundState: { type: 'object' }` instead, with the three
facts described in `RECONCILE_SHAPE.roundState` and checked when the answer arrives.

**Why.** Not tidiness — arithmetic. An agent whose serialized output schema exceeds **4096 bytes** is
refused by the host *before the model runs*, and `RECONCILE_SCHEMA` belongs to the run's FIRST agent,
so its refusal costs the whole run with nothing built and nothing said. Two branches grew that one
object independently and neither was over the line alone:

| | serialized bytes | delta vs ENG-95930's 3413 |
|---|---|---|
| ENG-95930 baseline | 3413 | — |
| ENG-96204 (this ticket) alone | 3719 | +306 |
| PR #128 answers channel (`unconsumedResolutions` / `resolutionsReopened` / `resolutionsPending`) plus ENG-96147 `sectionRouteByRun` alone | 3908 | +495 |
| **both merged** | **4214** | **+801 — 118 bytes OVER the cap** |
| both merged, with this fold | **4085** | +672 — 11 bytes under the cap |

The two deltas are exactly additive: there is no overlap to reclaim, and each branch was green on its
own. The collision is a property of the merge, which is why it appears at rebase time rather than in
either PR's own CI.

The three keys cost 173 bytes as separate declarations plus a `required` entry. One bare object costs
about 30. That is the whole 118 and 11 bytes over.

**What is unchanged.** Every fact still crosses the boundary, and every guarantee still holds:

- `consumedRoundAnswers` is still REQUIRED — `[]` and "key absent" must not be the same answer on the
  list that decides whether a recorded `go` is still live. The requirement moved UP one level and one
  level IN: `RECONCILE_SCHEMA.required` names `roundState`, and `RECONCILE_SHAPE.roundState.required`
  names `consumedRoundAnswers`, so an answer that sends the object without the list is still refused.
  A bare object cannot express a per-key `required`, so the shape table is where that check has to
  live — the same trade every other compacted property on this contract already makes.
- `layoutPassDone` / `roundsSpent` stay typed-but-not-required: absent is the correct reading for a
  fresh folder and for one written before the keys existed.
- The queue file, the carry block and `carryFingerprint` all moved to the same nesting, so the two
  ends of the contract still describe one shape and a fourth key joining the object is fingerprinted
  the day it lands.

**Reading a folder written before this change.** Such a folder holds the three keys at the ROOT and
has no `roundState` at all, and an in-flight migration must not break. `roundStateOf(state)` reads
`roundState` first and falls back to the root key **per key**, not as a whole-object either/or — a
folder can legitimately carry a fresh `roundState` beside a root key an older invocation wrote, and an
object-level choice would drop whichever record it did not pick. It stays fail-closed in the one
direction that matters: garbage in `roundsSpent` falls through to the per-unit counters via `Math.max`
(it can lower nothing and raise nothing), and a non-array `consumedRoundAnswers` becomes `[]` in
`mergeConsumed`, which grants no round by itself.

**What was rejected, and why.**

- *Raising `RECONCILE_SCHEMA_BUDGET` past 4096.* Not available. The budget is a working margin under a
  host rule; the host rule is not a budget. A 4214-byte schema is a phase that cannot start.
- *Folding PR #128's `resolutionsReopened` + `resolutionsPending` into one object instead* (it buys 69
  bytes more, landing at 4027). Rejected as out of scope: that is a merged PR's contract, and a rebase
  is not the place to redesign someone else's channel. If more room is needed later it is the obvious
  next candidate, and it should be its own reviewed change.
- *Dropping a field.* Never on the table. Each of the three is the sole record of a fact that decides
  whether the next invocation builds against a live stand without asking.
- *Spelling the three keys out under `roundState.properties`.* That is the 173 bytes back, i.e. the
  original problem, and it is the exact convention ENG-95930 established against: declare bare,
  describe in `RECONCILE_SHAPE`, check on arrival.

**The margin is eleven bytes, and that is not a margin.** `RECONCILE_SCHEMA_BUDGET` is pinned to the
measured 4085 rather than to a round number above it, precisely so the next property added here turns
a check red locally instead of turning into a refused agent on a live run. Adding anything to this
contract means buying the bytes back first; this record is the worked example of how.

---

## DR-8 (ENG-95468) — the `plan-unvalidated-against-stand` stop has no operator override

**Status:** accepted, shipped in ENG-95468.

**Decision.** When a round's component answers did not come from the target stand — every
`componentResolution` entry carries `resolvedFrom`, and only `'stand'` confirms — the run stops
with `stopped: 'plan-unvalidated-against-stand'` and there is **deliberately no flag, answer, or
run-scoped acknowledgement that turns a catalog-sourced answer into a confirmation**. The only way
forward is to make the environment answerable and re-run. The stop fires before the first build
unit and again at every in-run Reconcile, so a stand that goes away mid-run stops the next unit
rather than clearing the gate on a catalog answer (ENG-95468, residual).

**Why.** The whole defect this axis closes is *a catalog answer being read as a stand
confirmation*. `get-component-info` does not fail when it cannot probe the environment: it answers
from its bundled `latest` catalog and still reports `resolved: true`, recording the substitution
only in free text (`resolvedFromReason=probe-error`). A stand that is up but whose version cannot
be probed produces the **same** catalog answer as one that is down. An override that let an
operator declare "proceed anyway on this catalog answer" would therefore be an override of the
exact condition the gate exists to detect — it would re-open the defect under a different name, and
the round would build against a `latest` catalog that may not match the stand at all. The rationale
is stated inline at the stop (`skills/_workflow-core/build-executor/core.mjs`, the Hard Stop 3.4
header: *"There is deliberately no override…"*).

**Consistency, not exception.** Every sibling hard stop in this executor is terminal with no
operator override: the approval stop, the package-precondition stop
(`new-app-over-existing-package` / `target-package-unknown`), and `plan-invalid-against-stand`. A
gate returns a `stopped` verdict and a `next`; the caller acts out of contract (fix the stand, fix
the plan, re-approve) and re-runs. `plan-unvalidated-against-stand` is a member of that family, not
the lone outlier.

**Alternatives considered and rejected.**

| Alternative | Why rejected |
|---|---|
| A boolean override flag ("proceed on a catalog answer") | Re-opens the defect directly — it authorises exactly the catalog-as-confirmation read the gate closes. |
| A run-scoped acknowledgement routed through an existing operator-answer channel | There is no such run-scoped gate-override channel to reuse. `resolutions.json` → `resolutionsForUnit` is the **per-build-unit ⚠ Confirm preflight** channel (it answers open plan questions for a unit), not a mechanism for overriding a hard stop; no hard stop consults it to clear itself. Building a new run-scoped acknowledgement channel purely to weaken this gate would add the override the first alternative was rejected for, only with more machinery. |
| Downgrade the stop to a warning and build anyway | This is the pre-ENG-95468 behaviour and the measured failure (ST_2 round 5: five agents, ~1.68M weighted tokens, zero stand writes, on a round that had already seen a hard DNS failure in its own first phase). |

**What the operator does instead.** The `next` points at the environment, not the plan: check the
registered environment, its DNS and its credentials (`clio ping`), confirm `get-component-info`
answers from the environment itself, then re-run. Nothing about a catalog answer implicates the
plan, so this is never a re-plan (a catalog `resolved: false` is no more evidence about this stand
than a catalog `resolved: true`).

**Cross-repo note.** CAADT is driven against real stands by the `creatio-adaclio-testing` harness,
so a transient probe failure hard-stops a harness run with no in-contract bypass. That is intended:
a harness run that "passed" without reaching the stand is the false green this gate exists to
prevent. The remedy is the same — make the stand answerable and re-run — and the stop is cheap
(no agents are spent confirming a record on a round that is already over).

**Trust boundary (related).** The gate keys on the agent's `resolvedFrom` *classification* of
clio's free-text note, not on a machine field carried across the MCP contract. Rather than trust
that classification blindly, `componentSweepFaults` FAULT 3 refuses a `resolvedFrom: 'stand'` claim
whose own `note` carries clio's catalog-fallback tokens (`probe-error` / `latest-fallback`) — so a
catalog answer cannot be mis-classified into a stand confirmation at the model layer either
(PR #159 review, Major 7). Transcribing clio's own `resolvedFromReason` verbatim across the
contract would be stronger still and remains a possible future change (it would also let the script,
not the model, own the stand/catalog mapping); the contradiction fault was chosen for this round as
the self-contained way to close the one-directional hole.

**When to revisit.** This decision changes only if the underlying tool behaviour changes — for
example, if `get-component-info` gains a way to *fail* (rather than silently substitute the catalog)
when it cannot probe the environment, or carries an unambiguous machine-readable "this answer is
from the stand" signal end to end. At that point the gate could rest on the tool signal directly and
the question of an operator override would not arise, because there would be no ambiguous catalog
answer to override. Any change here belongs in this record with the caller-migration path, because
it changes what the workflow returns and what it refuses.

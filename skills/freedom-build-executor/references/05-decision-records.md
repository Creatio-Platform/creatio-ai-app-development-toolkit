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

**Compatibility evidence, and its limit.** No in-repo caller launches this workflow with a
constructed argument list: the only launcher is the migration skill (`../../
classic-to-freedom-migration/SKILL.md`), which is agent-driven and now presents the mode as
required, and the engine tests pass `mode` explicitly. **External callers were not verified from
this repository** — `creatio-adaclio-testing` (the E2E harness that drives CAADT through a coding
agent) is a separate repository and is not part of this checkout, so "no external caller launches
without a mode" is an expectation here and not a measurement. If such a caller exists, option 3
above is a one-line, behaviour-preserving fix on its side.

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

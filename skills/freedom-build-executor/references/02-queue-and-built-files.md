# 02 — The queue file and the built file

Two JSON files in the migration folder carry the whole run — plus `verify.json`, the engine's machine
verdict, one short-lived `preflight-<n>.json` per ⚠ Confirm agent, one `slices/queue-<n>.json` and
`slices/built-<n>.json` per build unit, and `resolutions.json`, the one file here that a HUMAN writes.
Everything else is derivable.

`resolutions.json` holds the operator's answers to this plan's ⚠ Confirm questions:
`{ "resolutions": [ { "kind": "list-columns", "item": "…", "answer": "…", "decidedBy": "…", "date": "…" } ] }`.
Keyed on `kind` + `item` (the published `id` also works; its `pageKey` half moves between runs). It is read by
the ENGINE — `--units --resolutions` publishes each answer on the queue item that asked it — never parsed by an
agent. Absent means nobody has answered yet, which is the normal first run. **It closes no `--verify` row:** an
answer is an input to the build, and the evidence record is still filed and still judged.

The file must exist BEFORE the executor is launched. `--units` reads it at the head of every round and publishes
`resolutionsRead` / `resolutionsMatched` — writing it after the run's `--units` invocation leaves every item with
`resolution: null` and nothing to say why, which is what a real run did by 79 minutes.

An answer that a build agent WAS handed is tracked to a build action or to a stated refusal. The builder returns
`resolutionsApplied` (`{ id, applied, how?, why? }`, one per answer it was given, `required` on those dispatches);
the read-only verifier returns `resolutionChecks` saying whether the page it fetched actually shows each answer's
effect, **`required` on any verify dispatch that was handed claims** (declared-but-optional was not enough: an absent
row reads as unconfirmed rather than as a refutation, so an untrue `applied: true` closed the unit and the run reported
`complete: true` over an answer that produced nothing); and anything left over is returned in `unconsumedResolutions`
and **blocks `complete`**. None of this writes
`built.evidence` or closes a row — the direction is one way, toward stricter.

`resolutionChecks[].shows` is `"yes"` / `"no"` / `"unknown"`, and only `"no"` refutes the builder. `"unknown"` means
the verifier could not determine the effect: it raises no contradiction, exactly like an absent row — unconfirmed, and
not a defect. That distinction is load-bearing for any answer about BUSINESS RULES, whose effect lives in separate
`BusinessRule_*` schemas invisible to `viewConfig`: the verifier reads `pages[<key>].businessRules` or calls
`read-page-business-rules` rather than reporting a page-body zero as a refutation.
One place a FRESH `"unknown"` is NOT like an absent row: when this round's verifier re-reads a page whose answer an
earlier round recorded unconsumed on a `"no"`, a later non-refuting read for that pair can RELEASE the record. The two
strengths are not interchangeable:

- A `"yes"` releases the row **whichever source recorded it** — a positive independent read of the page outranks both
  an earlier `"no"` and the builder's own `applied: false`. Before this, a builder that honestly declined an answer
  because the page ALREADY satisfied it filed a row no later `"yes"` could clear, so the unit went green with
  `complete` false for ever and only a hand-edit of the queue file recovered it.
- A reasoned `"unknown"` releases only a **verifier-sourced** row on a **rule-shaped** kind — `lookup-value`,
  `rule`, `visibility-rule` — the class whose effect `viewConfig` structurally cannot show. For any other kind it
  releases nothing: a LAYOUT-shaped answer, whose effect the page body CAN show, must not be retired by a shrug
  after being positively refuted. **And "reasoned" means `found` NAMES THE SURFACE IT READ** — `businessRules`,
  `read-page-business-rules`, a `BusinessRule_*` schema. Generic prose ("could not determine from the fetched
  view") releases nothing: the verifier prompt says exactly where to look for this class, so a verifier that looked
  can say so, and one that shrugged cannot buy a release with the shrug.

An ABSENT read (the verifier never looked) releases nothing, and a bare `"unknown"` with no `found` releases nothing.

**The residual trust assumption, and the signal that tracks it.** Only `"no"` refutes a claim — correctly, since
`"unknown"` must never be read as a lie. The cost is that a verifier which lands *every* check on `"unknown"` files
no contradiction and no unconsumed row, so the original failure shape (an answer that produced nothing, reported as
finished) can reappear through a channel that looks compliant. Nothing but a human reading the report used to catch
that. The run now returns `unsettledResolutionClaims` — every `(unit, id)` a builder claimed that the verifier never
settled either way, with the number of rounds it stayed `"unknown"` — and logs it at the close. It is
**deliberately NON-GATING**: honest uncertainty must not fail a run, so this reports and leaves `complete` alone.
An operator seeing entries here should check those pages by hand; a run where the list is long is a verifier
problem, not a build problem.
Two rows for the same pair in one result are collapsed to one, and **a refutation wins whichever order they arrive
in** — `[yes, no]` files the contradiction and does not release it. Without this, a rule-shaped answer whose rebuilt effect the page body can never positively show
would block `complete` for ever, because once its unit is green it is never re-verified and the confirming `"yes"`
can never arrive.

The leftovers are not process-local. They are persisted at the root of this file under `unconsumedResolutions` and
re-seeded next run, so an answer that reached a builder and died there still blocks `complete` after a usage limit,
a session end, or a new agent picking the folder up tomorrow — which is the whole reason the two files exist.
They exist because a run is interrupted routinely — a usage limit, a session end, a new
agent picking the work up in the same folder tomorrow. Nothing about "where we are" may live
only in an agent's context.

Neither file is the source of truth about the STAND. The queue holds the ORDER and the
history; the stand holds the FACT. Before any unit is taken into work its state is re-read
from the stand through `--verify`, and a unit that is already closed is skipped. That is why
there is no "resume" command: there is one command, and it does the next undone thing.

## `build-queue.json` — order, rounds, park state, approval

```json
{
  "schemaVersion": 1,
  "manifest": "/tmp/mig-Applicant/manifest.json",
  "builtFile": "migrations/applicant/built.json",
  "planVersion": "plan-4f9c2ab17e03",
  "approval": {
    "found": true, "version": "plan-4f9c2ab17e03", "date": "2026-08-07",
    "who": "Alex Kravchuk", "recordedIn": "decisions.md"
  },
  "buildOrder": ["child:VisaRequest", "child:Education", "mini:ApplicantMiniPage", "main"],
  "units": {
    "child:VisaRequest": { "rounds": 2, "parked": false, "schemaName": "UsrVisaRequestPage",
                           "lastNote": "ApprovalList added; style diff pending" },
    "child:Education":   { "rounds": 3, "parked": true,  "schemaName": "UsrEducationPage",
                           "parkedWhy": "still short after 3 round(s) — the engine's open rows: Communication options (`crt.CommunicationOptions`) — ❌ MISSING — component type absent from the built page" },
    "mini:ApplicantMiniPage": { "rounds": 1, "parked": false, "schemaName": "UsrApplicantMiniPage" },
    "main":              { "rounds": 0, "parked": false, "schemaName": "UsrApplicantFormPage" }
  },
  "nonPageUnits": {
    "sectionRegistered": { "rounds": 1, "parked": false },
    "miniPageWired":     { "rounds": 0, "parked": false }
  },
  "standWrites": {
    "packageCreated": { "package": "UsrApplicantFreedom", "appUnitComplete": true,
                        "planVersion": "plan-4f9c2ab17e03", "sectionPage": "UsrApplicants_FormPage" },
    "orphanedPages": [
      { "schema": "UsrApplicants_FormPage", "orphanedBy": "main", "at": "plan-4f9c2ab17e03" }
    ]
  },
  "proposals": [
    { "unit": "main", "deviation": "merge two profile islands into one",
      "why": "second island holds a single field", "applied": false }
  ],
  "blocked": [
    { "unit": "child:Education", "what": "the Communication options block",
      "why": "crt.CommunicationOptions is not registered on this stand" }
  ],
  "discrepancies": [
    { "round": 2, "unit": "main", "claim": "crt.ApprovalList added",
      "found": "get-page shows no crt.ApprovalList" },
    { "round": 2, "unit": "main", "id": "main#confirm:entity-filter:(1 lookup)",
      "kind": "resolution-not-applied",
      "claim": "applied the answer to \"main#confirm:entity-filter:(1 lookup)\" — added the filter",
      "found": "no lookupListConfig anywhere in viewConfig" }
  ],
  "unconsumedResolutions": [
    { "unit": "main", "id": "main#confirm:entity-filter:(1 lookup)", "kind": "entity-filter",
      "item": "(1 lookup)", "answer": "restrict to Status IN {InProgress}",
      "why": "no lookupListConfig anywhere in viewConfig", "source": "verifier" }
  ],
  "resolutionsReopened": [{ "unit": "main", "id": "main#confirm:entity-filter:(1 lookup)" }],
  "resolutionsPending": [],
  "history": [
    { "round": 1, "units": ["child:VisaRequest", "child:Education", "mini:ApplicantMiniPage"], "at": "2026-08-07T11:04Z" }
  ]
}
```

Rules that make it trustworthy:

- **Every key under `units` comes from `--units.pages[].key`, and EVERY key in `buildOrder` gets one.**
  Never construct a page key by hand — `child:<Entity>@<Via>` and the `#n` disambiguators exist because two
  distinct physical pages would otherwise collide, and an invented key matches no row. A key in `buildOrder`
  with no `units` entry is a unit with no round counter, no park state and no recorded schema: the run
  re-dispatches it forever and can never verify it. That is the drift `staleQueueKeys` / `newKeys` exist to
  report, so the entry is created — with `rounds: 0` — the moment the key appears.
- **`planVersion` is the engine's, copied from `--units.planVersion`.** It is the same string `--plan` printed
  into the plan file under `**Plan version:**`, and the same string the `approval` entry must name. Nothing
  here composes a version.
- **`units[<key>].schemaName` is the FREEDOM schema that key resolves to, and this file is its only
  home.** `--units.pages[].schema` is the CLASSIC source schema and is `null` for `main` and for an
  unfolded child, so a key on its own names no page to fetch. The builder reports it, the reconcile
  step writes it here, and the verifier reads it from here — including for a page built in an
  earlier session, which is what makes resume work at all. A key with **no** `schemaName` is an
  explicit **"cannot verify, unknown schema"**: nothing is fetched for it, nothing is written for
  it, the unit stays open and the state is reported. It is never guessed and never silently skipped.
- **`parkedWhy` is written with `parked: true`, never after it.** The reason is composed where the
  park is decided, out of that unit's own open rows, and a park is how the run asks the user a
  question — a park with no reason is a question nobody can answer. A resumed run reads these back
  before it schedules anything: a park is terminal, so re-dispatching a parked unit spends a full
  stand-writing round on work the previous session already gave up on.
- **`proposals`, `blocked`, `discrepancies` and the learned `schemaName`s are written at the CLOSE of each
  round, before the next round dispatches** — the same rule `rounds` follows, and for the same reason. They
  are the run's answer to the caller; a usage limit, or a reconcile step that returns nothing, must not take
  them with it. They are written again when the run exits, so a park or a proposal decided after the last
  round is on disk too.
- **A `discrepancies` row's `id` and `kind` are its IDENTITY, and both must be copied back verbatim.**
  Rows come from three places and only one of them has an identity: a refuted operator answer carries
  `id` plus `kind: "resolution-not-applied"`, while the verifier's own builder-vs-stand rows and the
  in-context-gate mismatches are keyed on `unit` alone and carry neither. The run matches a repeated
  refutation on `(unit, id)` to REFRESH the existing row rather than append beside it, so a resume that
  drops `id` re-files the same disagreement as a second row — every resume, into a list nothing prunes,
  rendered whole into every round-close prompt. Never invent either field for a row that has none.
- **`rounds` is incremented BEFORE the round runs, not after.** A process killed mid-build must
  not come back with the counter reset — that is how a unit loops forever. Over-counting a round
  that never happened is the safe direction: it parks earlier, never later.
- **`parked: true` is terminal for this run.** It is not a failure to hide; the run returns every
  parked unit to the caller with `parkedWhy`, and the caller asks the user.
- **`proposals[].applied` is always `false` when the executor writes it.** A plan deviation is a
  proposal to the user. The executor never flips it.
- `nonPageUnits` keys are the reachability keys from `--units.reachability[]` whose
  `appliesWhen` is `true`. A key with `appliesWhen: false` is not an obligation of this run and
  gets no entry.
- **`standWrites.orphanedPages` are pages a RE-BIND left pointing at nothing (ENG-95850 / B4).** `create-app` seeds
  start pages (`<Code>_FormPage`, `_ListPage`, `_Detail`); a builder that builds the real page as a NEW schema on a
  different template and re-points the section at it leaves the seeded one on the stand, bound to no key. It is
  recorded the moment a unit reports `reboundFrom` — unless that schema is still some key's recorded page, which is a
  re-bind between two live keys and not an orphan. Why it is worth a record: an orphan is fetchable and reads exactly
  like a live page, and a run that judged build progress off one concluded "main not built" about a form that was
  ~80% complete. The verifier is handed the list and told not to read an orphan as any key's page. **Nothing deletes
  them** — a page on a customer's stand is not a build round's to remove, so the list is the run's report and the
  decision is the operator's.
- **`reachability.sectionRegistered` is a COUNT, not a flag (ENG-95850 / B2).** Every other wiring key is a
  boolean, because the wiring either exists or does not. A workplace registration is different: it only ADDS, so a
  section "moved" from `My applications` to `Recruiting` is bound to BOTH until the old row is removed — two
  `SysModuleInWorkplace` rows, and a `true` cannot tell that from one. So the verifier writes
  `{ "workplaces": <n>, "names": [...] }` with the number it counted, and the gate closes the row at exactly 1,
  reports 0 as unreachable, and reports 2+ by naming them. `n` must be a real integer (a quoted `"1"` is not
  accepted — an agent that quoted the number has not reported a count the row can gate on); a key you could not
  count is OMITTED, which reads ⚠ not-checked. **Nothing in the run unbinds a workplace** — that is a deletion of a
  customer record, so the extra binding is reported for a human to settle.
- **`unconsumedResolutions` is at the ROOT, and it is written on EVERY close — including when it is `[]`.** It is
  the operator answers a build agent was handed that produced no build action, and it is the one piece of run state
  whose EMPTY value is load-bearing: an emptied list is how the next run learns the answer was finally built, so a
  conditional write would leave a stale entry holding a finished folder open for ever. Absent reads as `[]`, which
  is what a first run means. It has to be persisted at all because a well-formed `applied: false` + `why` is the
  ONE outcome that files nothing else — an accounting miss files a `blocked` row and a verifier contradiction files
  a `discrepancies` row, a clean refusal files neither — so before this existed the record died with its process and
  a re-run on a green gate reported the folder `complete`. `source` (`dispatch` or `verifier`) round-trips because
  it decides what may clear the row: a builder's own account of its own work is replaced whenever that unit builds
  again, while the independent read that DISBELIEVED such an account is cleared only by a verifier that confirms
  the effect. Copy the rows verbatim; the run re-checks each one against the questions the plan still asks, so a
  withdrawn answer or an id a re-plan moved drops out on its own. A `verifier`-sourced row has exactly **ONE
  release window**, and it is the repair round the contradiction itself buys: the unit re-opens, it is rebuilt, and
  THAT round's verifier read releases the row on `"yes"`, or on a reasoned `"unknown"` when the kind is rule-shaped. There is no second window — the grant is
  spent, the unit goes green, and a green unit is never re-verified — so a row whose repair round came back `"no"`
  again, or came back with no check row for it at all, is **held until the operator acts**: fix the build, or
  withdraw the answer so the question stops being owed. That terminus is deliberate and it is why the run's closing
  `next` names the answer and its `why` rather than only reporting NOT COMPLETE — **including on the zero-work
  resume**, the exit a held answer actually takes once its grant is spent (green gate, nothing parked, nothing open),
  which used to advertise the verify table as a completion report; do not read the `"unknown"` release
  rule as a promise that a later read will eventually arrive on its own, because for a green unit it will not.
- **A reopen grant is bounded by the ROUND BUDGET.** A unit the engine gate calls green cannot be parked, and a
  reopen key forces it open, so a grant that was never released left the run dispatching full Build/Verify/Judge
  rounds on a green unit for ever whenever a build agent returned `null` deterministically. Once a unit has spent its
  round budget its reopen grant stops forcing it open; anything still unaccounted for is REPORTED as an unconsumed
  answer rather than retried, which is the same fail-closed direction the rest of this channel takes.
- **`resolutionsReopened` and `resolutionsPending` are at the ROOT, they are REQUIRED, and both are written on
  EVERY close — including when they are `[]`.** They are the answer-channel repair grants, and they are process
  bookkeeping rather than operator content: do NOT judge, filter or tidy them. `resolutionsReopened` is a list of
  `{unit, id}` PAIRS — every ANSWER that has already spent its ONE answer-channel repair round, **not** every unit:
  two answers on one page each get their own round, because the bound exists to stop re-asking the SAME question,
  and an answer that has never had a round must not be denied one by a neighbour that has. Drop an entry and the
  next resume RE-GRANTS a round that was already spent, which is how a builder gives the same refusal twice at
  full cost. `resolutionsPending` is
  the subset still owed that round's dispatch; drop an entry and a unit that was owed its repair is stranded — the
  grant is recorded as spent while the build it paid for never runs. Both are written even when empty for the same
  reason `unconsumedResolutions` is: an emptied set is how a resumed run learns a grant was finally consumed, and a
  stale non-empty one strands a settled unit for ever. They are persisted DIRECTLY rather than derived from
  `unconsumedResolutions` on resume, because a transient build death files an unconsumed row WITHOUT spending the
  grant — so the derivation over-marked exactly those units and denied them the repair they were owed. Copy the
  arrays verbatim; the keys are unit keys and the run trims them on read, so incidental whitespace cannot re-grant
  a spent round.
- **`standWrites` is the run's own memory of what it did TO THE STAND, and it lives at the ROOT.** Everything
  else in this file is bookkeeping about units; this is the one section that records a change made outside the
  file, so it is not under a unit — the package is not a page, and the next run's placement gate reads it before
  any unit exists. **All three routes write it**, which is what makes them interchangeable over one migration
  folder: a route is how work is dispatched, never a separate memory of the stand.
  - `packageCreated` — the application/package the `app` unit created. `package` is the name read back off the
    stand (never the `code` passed to `create-app`: clio applies the environment's `SchemaNamePrefix`).
    `appUnitComplete` is the unit's FULL deliverable — the planned package AND a section on the migrated object
    AND no stub left behind — so it is `true` only on the branch that closes the unit, and `false` while the
    unit is short. It never walks back from `true`: only a stand read could contradict a met deliverable, and a
    later builder's summary is not one.
  - **Why it has to be on disk.** From the stand, a package this migration created and a package a stranger owns
    are the same fact — no stand read says who created one. Under `sectionHost: new-app` they need opposite
    handling (a stranger's is a stop; ours is a resume), so a missing record means the run must assume the
    stranger. Dropping this key does not degrade the next run, it stops it: on its own package, on its own work.
  - **Absence is never ownership.** A folder written before this key existed has none, and every gate then
    behaves exactly as it did then — it stops. Reconcile reports the record as `packageCreatedByRun`, read off
    THIS FILE and never derived from the stand.
  - **An INCONCLUSIVE live check does not outrank this record (ENG-95884).** A resumed round reported
    `packageState: 'unknown'` from its `list-packages`/`find-app` sweep while this file already named the package
    under `packageCreated` — and the run stopped on `target-package-unknown` anyway, paying a full round for nothing
    (18 agents, 982K tokens, zero progress) even though its own prior write proved the package was there.
    `packagePreconditionStop` now resolves `packageState: 'unknown'` to `'exists'` whenever this record names the
    SAME package, before any stop branch runs — a stand check that could not tell is not stronger evidence than the
    run's own memory of having created the thing. This does **not** apply to a CONFIDENT `'absent'`: that would mean
    the package was removed after this run made it, a stand-vs-record conflict worth its own stop, not a silent
    resume.
  - **A dropped field is not absence, either.** Reconcile is one busy agent doing four jobs at once, and it can fail
    to carry `packageCreatedByRun` even when this file DOES hold `packageCreated`. Before either ownership stop
    (`target-package-unknown`, `new-app-over-existing-package`) fires with no record in hand, the script runs ONE
    dedicated, single-purpose re-read of this file — nothing else — to confirm the record is genuinely absent rather
    than merely unreported. If even that dedicated read cannot open the file, the stop text says so explicitly
    (`packageRecordUnread: true`) instead of reading like a confirmed absence: that case is not evidence of anything,
    and simply re-running retries the read at no cost.

### `verify.md` / `verify.json` are only current as of the last COMPLETED Reconcile (ENG-95850 / D)

They are written by the Reconcile phase, so an ABORTED round leaves the previous round's numbers on disk with
nothing on the files themselves saying so. On the Applicant run the crash left `missing 5 / unverified 20` while the
stand was materially further along, and reading those files by hand made the run look worse than it was.

Two things follow. **Do not read a verdict file as the current state after a run that did not finish** — re-run, and
the baseline Reconcile re-runs `--verify` against the stand and replaces both files, which is why an interrupted run
is self-healing as long as nobody acts on the stale copy in between. And when the VERIFIER answers but the round
still stops, the run says so itself: it returns `verdictStale: true` with `stopped: 'verifier-failed'` rather than
reporting the previous verdict as current.

## `built.json` — the payload `--verify` reads

Exactly the `--built` shape the CLI accepts. It ACCUMULATES across rounds: evidence and judge
verdicts filed in round 1 are still there in round 3, which is what lets a repair round re-verify
without redoing settled work.

```json
{
  "pages": {
    "main": { "viewConfig": { "...": "clio get-page bundle.viewConfig, VERBATIM" },
              "packageName": "CustomHrApp", "viewModelConfig", "parentSchemaName": "PageWithTabsFreedomTemplate",
              "businessRules": { "count": 2, "rules": [ { "name": "BR_Contact", "caption": "...", "condition": {}, "actions": [] } ] } },
    "child:Education": false
  },
  "reachability": { "sectionRegistered": { "workplaces": 1, "names": ["Recruiting"] }, "miniPageWired": false },
  "evidence": { "main#quality-gates": { "referencePage": "AccountPage", "components": ["crt.ExpansionPanel"] } },
  "judge":    { "main#quality-gates": { "convincing": true, "why": "prop-level diff, 3 components" } }
}
```

**`viewConfig` is `bundle.viewConfig` from `get-page`, copied verbatim — the MERGED page.** Not
`ownBodySummary`, not the page's own body. An element the TEMPLATE provides is touched with
`operation: "merge"` and carries no `type`, so a check fed the own body reads ❌ MISSING on a
correctly built page for Feed, FileList, ApprovalList, ContactCommunication and the DCM bar.

**The mini page has its own entry, like every other page.** Its key is `mini:<Schema>` (published
by `--units`), and the `Mini page` row is closed by that entry — present with components ⇒ built,
`false` ⇒ MISSING, omitted ⇒ not checked. There is no boolean to write instead: a payload with a
`pages` map is never read for `miniPageBuilt`, so the only way to close that row is to `get-page`
the mini page and file what came back.

**`businessRules` gates the `Business rules × N` row — a page's rules are NOT in its `viewConfig`.**
Declarative business rules persist as separate `BusinessRule_*` schemas, invisible to a `viewConfig`
walk, so the `Business rules` row reads a dedicated per-page slot: the `read-page-business-rules`
result (`{ count, rules }`, copied verbatim), populated by the same read-only verifier that fetches
`get-page`. `--verify` matches each expected rule identity (a page rule's `element` / an entity rule's
`targetAttribute`, published in `--units.pages[].expect.ruleNames`) against the built rules by target
attribute. The slot keeps the tri-state every page field has: present with the rules ⇒ matched; `[]`
⇒ checked-and-empty (the page genuinely has none — a confirmed answer); **omitted ⇒ NOT-CHECKABLE**
(nobody read the rules — ⚠ unverified, distinct from a hard MISSING, so a rule the payload cannot see
is never a false ❌). Write `businessRules: []` only after confirming the page has none; never leave it
absent as a shortcut, or the row stays open forever. It is REQUIRED for any page whose
`--units.pages[].expect.rules` is non-zero. One caveat on the `[]` state: `checked-and-empty` closes
the row to ✅ only when NO rule identities were expected. On a page that WAS expected to own rules
(`expect.rules` non-zero), a confirmed-empty `[]` slot is NOT a settled row — it resolves to
`0/N business rule(s) matched … ⚠ verify`, an unverified shortfall (still never a hard ❌ MISSING), so
the `Business rules` row stays OPEN until the expected rules are actually present.

The CLI rejects a malformed payload at **exit 1**, naming what is wrong:

- not a JSON object;
- no `pages` object (the old flat single-page shape is gone);
- any page entry that is neither `false` nor an object carrying `viewConfig`.

That guard is what makes the gate real. It is not possible to hand-author a `pages` entry that
passes — you would have to write a plausible merged view tree, and the counts are then computed
from what you wrote, which the verifier's own get-page transcript contradicts.

## `verify.json` — the verdict anything arithmetical reads

`--verify` also takes `--verify-json <file>`. Run it as
`--verify --built built.json --out verify.md --verify-json verify.json`: `verify.md` is the human
report, `verify.json` is the verdict.

```json
{
  "complete": false, "missing": 1, "unverified": 4,
  "planGaps": ["structure INCOMPLETE (2 missing input(s))"],
  "pages": {
    "main": { "missing": 0, "unverified": 0, "complete": true, "buildComplete": true, "openRows": [] },
    "child:Education": { "missing": 1, "unverified": 2, "complete": false, "buildComplete": false,
      "openRows": [ { "n": 31, "deliverable": "Fields — 7 expected", "status": "⚠ verify",
                      "evidence": "5/7 expected fields present — missing: Amount, Owner",
                      "outcome": "unverified", "owner": "builder" } ] }
  }
}
```

ENG-95901 — every page entry ALSO carries `buildComplete` (and `builderOpen`, the count that matches it): the OWNER axis, `true` even
while `unverified` rows sit unfiled (evidence a separate read-only verifier/judge files, never the
builder). `complete` (shown above) stays the COMBINED signal — `missing === 0 && unverified === 0`
— for the round-scheduling / post-hoc "is this unit done" reads below; `buildComplete` is what the
in-context single-unit gate (`--verify --page <key> --verify-json <file>`) and the builder's own
`selfCheck` report gate on, so a page whose only open rows are unfiled evidence is not told its
build is short.

Read this file — never the table — for anything you compute on: which units are open, how many
rounds are left, what a repair round is handed. The table has no per-page counts at all, and the
`⛔ VERIFY INCOMPLETE` stderr line lists at most six pages; `pages` here lists every one. Each
`openRows` entry is the row exactly as the engine wrote it, so a repair prompt quotes it rather
than restating it. `planGaps` is the plan-versus-build split (`03-failure-and-park-policy.md`),
already classified, and it is independent of `complete`: a run with nothing left to build still
stops when that array is non-empty.

The `Business rules × N` row appears in `openRows` like any other gated row — e.g.
`{ "deliverable": "Business rules × 11", "status": "⚠ verify", "evidence": "business rules NOT checkable — this page entry carries no businessRules slot; run read-page-business-rules …", "outcome": "unverified" }`
when the slot is absent, or `"status": "✅ Done"` (off the tally, not in `openRows`) once every
expected target attribute is governed by a built rule. A genuine shortfall reads `⚠ verify`
(`b/N business rule(s) matched by target attribute — missing: …`), never ❌ — a rule matched by
target attribute must not cry MISSING on a page whose rules were read.

## The per-unit slices — `slices/queue-<n>.json` and `slices/built-<n>.json`

A build agent owns ONE unit, so it needs one row out of each of these two files. It gets that row as a
FILE. Nothing hand-cuts a row: no whole-file read, and no `grep`/`jq`/`sed`/`python` one-liner.

The engine writes them. `--slices <dir>` on `--units` writes `queue-<n>.json` for every published key,
and on `--verify` writes `built-<n>.json` for the same keys — so the reconcile step's two existing engine
runs produce them and nothing extra is invoked. They are written on **exit 2** as well, which is precisely
the round a builder needs its row.

`<n>` is the PAGE's 1-based position in `--units.pages[]`. Only page keys are published there, so a
non-page unit — the `app` unit, an applicable reachability key — has no `<n>` and no slice: it owns no page
row. Its own per-unit files are named from the key instead — in the `worklog` folder, `app.md` and
`reach-sectionRegistered.md` — and the naming rule is total over the three unit classes for that
reason: the executor names every file it hands out, and a unit class the rule did not cover used to stop the
run outright.

```json
// queue-3.json — the run-level fields a single unit still needs, plus its own row
{
  "pageKey": "child:Education",
  "entity": "Applicant", "planVersion": "plan-4f9c2ab17e03",
  "sectionSchema": "Applicant1Section", "sectionHost": "existing-app", "applicationCode": "UsrHrApp",
  "page": { "key": "child:Education", "role": "child", "schema": "UsrEducationPage",
            "expectedTemplate": "…", "targetPackage": "CustomHrApp", "expect": { "fields": 7, "fieldNames": ["…"] } },
  "parent": "main",
  "reachability": [], "preflight": [], "evidenceRows": [ { "id": "child:Education#childpage", "…": "…" } ]
}
```

```json
// built-3.json — this page's row of the built file, and only its own ids
{
  "pageKey": "child:Education", "planVersion": "plan-4f9c2ab17e03",
  "pages": { "child:Education": { "viewConfig": "…", "schemaUId": "…" } },
  "reachability": {},
  "evidence": { "child:Education#childpage": { "referencePage": "ContactPage", "components": ["…"] } },
  "judge":    { "child:Education#childpage": { "convincing": false, "why": "no prop diff" } }
}
```

Rules:

- **The slice is a narrowing, never a projection.** Every value is copied verbatim, so a consumer reads the
  same bytes it would have read out of the whole file.
- **Which ids belong to a page is `--units`' answer, not the built file's.** `built.json` is keyed by evidence
  id and says nothing about pages; `--units.evidenceRows` is the only place that mapping exists. The same holds
  for reachability: a key applies to a page only when `--units` names it there.
- **Absent stays absent.** A key the source does not carry is left OUT of the slice, never written as `null` —
  absent, `false` and a filed record are three different answers, and the gate reads them differently.
- **The filename is the page's 1-based POSITION in `pages[]`, never its key.** A key is not a legal filename, and
  sanitising one is many-to-one — every non-Latin caption strips to the same characters, so two keys would land
  on one file and a builder would read another page's rows. A position cannot collide.
- **A position can still be composed wrong, so every slice names its own page in `pageKey`.** A builder checks
  that field against its own key before building, and reports a mismatch instead of working from the file.
- **BOTH slices carry `planVersion`, and a builder checks they agree.** A matching `pageKey` proves the file is the
  right PAGE, not the right ROUND — numbers are reused, so a leftover can carry the right key and stale contents.
- **A plan that publishes fewer pages PRUNES the slices above its count.** A numbered file left from a longer plan
  would sit there claiming to be a page the current plan does not publish.
- **A missing slice is cut on demand, never replaced by a whole-file read:** `--units --page <key>` prints the
  queue row, `--verify --built <file> --page <key>` prints the built row.
- **They are NOT in `refs/`.** That cache is keyed on the plan version, and a slice goes stale on an operator's
  answer or on any round that writes the stand — neither of which moves the plan version.
- **A missing slice is a report, not a workaround.** It means the reconcile step did not write one; the agent
  says so and the next unit would hit the same thing.
- **Reconcile is the only writer, and reads the WHOLE files itself.** It aggregates across every unit, so it has
  no row to be sliced to. So do the verifier, the judge and the preflight merge step.

## Who writes what

| File / key | Written by | Never written by |
|---|---|---|
| `build-queue.json` (all of it) | the reconcile step, and the round-close / close-time persistence step | the builder, the verifier, the judge |
| `preflight-<n>.json` → `evidence` | preflight agent number `<n>`, and only that one | every other agent |
| `built.json` → `evidence`, at preflight time | the preflight **merge** step (one agent, after the fan-out) | the preflight agents themselves |
| `built.json` → `pages`, `reachability`, `evidence` | the read-only verifier | the builder, the judge |
| `built.json` → `judge` | the judge | everyone else |
| `slices/queue-<n>.json`, `slices/built-<n>.json` | the ENGINE, via `--slices` on the reconcile step's `--units` / `--verify` runs | every agent — a build agent READS its two, and writes neither |
| `verify-summary.json` | the ENGINE, via `--verify-summary` on the reconcile step's `--verify` run | every agent — the RECONCILE agent READS it and copies its counts into the answer verbatim; nobody writes it back |
| `reconcile-answer-*.json` (+ its `.ascii.json` copy) | the RECONCILE agent — its full structured answer, staged on disk before every submission | every other agent. Nothing downstream reads these: they exist as failure evidence (the exact bytes of a host-rejected submission) and can carry live-stand text. The agent deletes an ACCEPTED attempt's pair; the engine sweeps captures older than 14 days on the next `--units` run; delete manually once an investigation closes |
| the Freedom pages on the stand | the builder | the verifier, the judge |

**`built.json` has THREE writers, in sequence, never at the same time:** the preflight merge step, then the
read-only verifier, then the judge. The builder writes none of them — a builder that also filed its own
evidence would be grading its own work, and the arithmetic downstream would mean nothing.

**The preflight fan-out does not write `built.json`.** The ⚠ Confirm agents run in parallel; each writes
its OWN `preflight-<n>.json` and nothing else, and a single sequential merge step folds them in afterwards.
Several agents read-modify-writing one JSON file with no lock is last-write-wins at best, and a torn write
destroys the gate's own input for the whole run. "Preflight is read-only" is about the STAND; it never made
a shared file write safe. The merge copies values exactly — a record object stays an object, a literal
`false` stays `false` — because the two are different answers (see the tri-state above), and it never
deletes an entry that was already in the file.

## Recovery, concretely

A new agent in the same folder, with no memory of the run:

1. Read `build-queue.json`. It has the manifest path, the plan version, the approval record, the
   `schemaName` recorded for each page key, and every unit already parked with its `parkedWhy`.
2. Run `--units` on that manifest. Reconcile the published keys against `units` — a key in
   `--units` and not in the queue is a NEW unit (the plan was regenerated); a key in the queue
   and not in `--units` is STALE and must be reported, never silently trusted.
3. Refresh `built.json` `pages` and `reachability` from `get-page` on the stand, **fetching the
   `schemaName` the queue records for each key**. A key with no recorded schema gets no entry and
   is reported as "cannot verify, unknown schema". If `built.json` does not exist yet, create it as
   `{ "pages": {}, "reachability": {}, "evidence": {}, "judge": {} }` first — that empty skeleton
   is a valid payload and makes the gate report every deliverable unverified, which is the truth on
   a first run. Without the file `--verify` dies at exit 1 and the run gets no verdict at all.
4. Run `--verify --built built.json --out verify.md --verify-json verify.json`. The per-page
   `complete` flags in `verify.json` say what is actually done. A key with **no** entry there is
   open, not done: only an explicit `complete: true` closes a unit.
5. Build the next open unit in `buildOrder`, skipping the parked ones. Nothing else is needed.

If `build-queue.json` is absent the run is starting fresh: create it from `--units` before the
first build, with `rounds: 0` everywhere and the approval record read from **`decisions.md`** —
required at both scopes by
`../../classic-to-freedom-migration/references/migration-documentation.md`, so a single-section
folder has one too (often holding nothing but that entry). A `worklog.md` entry is accepted only
as a fallback for a folder written before that rule.

## `schemaUId` is mandatory, and it is the provenance field

Every `pages["<key>"]` entry that is not `false` must carry `schemaUId`, copied VERBATIM from clio
`get-page` (`page.schemaUId`). The CLI rejects the payload at **exit 1** without it.

Why this field and not another: `--units` publishes **no GUID of any kind**, so a `schemaUId` cannot be
derived from the plan — it can only be copied out of a real read. The engine additionally requires the
identities to agree with each other: the same `schemaUId` may not appear under two keys (one schema is
not two pages), and one `packageName` may not carry two `packageUId` values.

Be honest about the guarantee: this proves the payload is INTERNALLY CONSISTENT, not that it came from
the stand. The engine runs offline and cannot ask Creatio whether a GUID exists. It stops a payload
assembled from `--units` output alone, and it makes a careless copy-paste fail outright — it is not a
defence against a determined author.

## `viewModelConfig` — store it, because bindings are not visible in `viewConfig`

`viewConfig` shows WHICH components a page carries; it does not show what each field is BOUND to. The
binding lives in `bundle.viewModelConfig` (the attribute → data-source path map), so store that verbatim
alongside `viewConfig`.

This is not theoretical. On the first full build run the judge rejected a `#quality-gates` record whose
evidence claimed "every built field binds `$PDS_<Column>`" — only 2 of 16 actually did; the rest carried
generated `$LookupAttribute_*` / `$NumberAttribute_*` controls. The judge could see the discrepancy in
`viewConfig`, but could NOT check the data-source paths behind them, because the built file stored no
`viewModelConfig`. Storing it is what makes a binding claim checkable instead of a matter of trust.

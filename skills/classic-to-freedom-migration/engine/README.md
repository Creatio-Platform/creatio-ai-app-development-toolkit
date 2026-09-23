# Classic → Freedom migration engine

Deterministic, offline Node module. It reconstructs the *effective* Classic page from N `ClientUnitSchema`
layers (base → top) and maps it to a Freedom **ChangeSet** + plan/design-spec. No Creatio/stand dependency:
the skill fetches the schema bodies (via clio) and passes them in a manifest; the engine only transforms.

## Usage

Invoked by the skill as a CLI — see `../SKILL.md` step 4:

```
node migrate.mjs <manifest.json>          # full JSON: effective page + ChangeSet + needsDecision[] + gates
node migrate.mjs <manifest.json> --plan   # render the migration plan (Markdown)
node migrate.mjs <manifest.json> --spec   # render just the per-page design spec (Markdown)
node migrate.mjs <manifest.json> --stubs  # the step-5.1 behaviour-analysis handoff digest (JSON)
node migrate.mjs <manifest.json> --tasks <dir>          # WRITE the build-task folder: one file per task + a derived index.md
node migrate.mjs <manifest.json> --tasks <dir> --split s.json  # …cutting it where s.json says, then freezing that cut into <dir>
node migrate.mjs <manifest.json> --tasks <dir> --next   # ANSWER which task(s) are startable right now, each with the exact --start command — ask this instead of picking off index.md
node migrate.mjs <manifest.json> --tasks <dir> --start <task-id>  # …first marking that task in-progress, stamping its clock and printing its dispatch token (call it BEFORE dispatching)
node migrate.mjs <manifest.json> --tasks <dir> --route  # …opening a repair round over the rows a build agent recorded as NOT BUILT — mid-run, with no --built payload
node migrate.mjs <manifest.json> --tasks <dir> --decide D13 --wont-do --pages typed:Service  # RECORD a person's scope decision into the Outcome cell of every row it covers (also --task <id> / --row <id>:<n>; --postponed additionally needs --to <destination>). REFUSES unless D13 already resolves as a heading in decisions.md — it never creates a decision, and that refusal IS the safeguard
node migrate.mjs <manifest.json> --tasks <dir> --revoke D13  # …and reverse one, clearing only the cells that decision wrote and nothing else
node migrate.mjs <manifest.json> --checklist            # the Plan-vs-Done control table, AFTER implementing (Markdown)
node migrate.mjs <manifest.json> --reads <dir>         # WRITE the read plan the verify gate needs into <dir>/reads/ (which reads, and the file each response goes into)
node migrate.mjs <manifest.json> --verify --from <dir>  # …COMPOSING the payload from the files --reads named, and writing it to <dir>/built.json
node migrate.mjs <manifest.json> --verify --built b.json # the VERIFIED done-gate: expected vs actually built (Markdown)
node migrate.mjs <manifest.json> --verify --built b.json --tasks <dir>  # the MIGRATION RESULT REPORT: ledger + built pages, one verdict (plus the dispatch gate over <dir>, and this run's OPEN rows written there as repair tasks)
node migrate.mjs <manifest.json> --plan --out plan.md   # WRITE the artifact to a file (present that file, not stdout)
```

`--verify --tasks <dir>` is the one legal pairing: `--verify` is still the MODE (the table is printed as always)
and the folder is where its OPEN rows are written as repair tasks. It also runs the DISPATCH GATE over that
folder, read-only — and while that gate fails no repair task is written, because a repair round would schedule
more sub-agents on top of work nobody was dispatched for. Without `--tasks`, `--verify` checks the built pages
only and says on stdout that the dispatch gate did not run. Repair tasks are merged by (page, cause) — sixteen
handlers missing from one page is ONE task, because sixteen tasks is sixteen sub-agent startups to make one edit
each. A ROUND IS AN ATTEMPT, not a verify run: re-verifying an unchanged page opens no second round, since the rows
are still the work of the round already in the folder, and a new round opens only once the previous one was CLOSED
and the rows came back. After `REPAIR_ROUND_CAP` (3) rounds a cause is PARKED and no further task is written —
three sub-agents have failed at it, so the plan, the stand or the expectation is wrong, not the build. A repair file
is engine-authored but NOT derived from the plan, so a later plain `--tasks` re-slice adopts it: never rewritten,
never reported stale.

**`--reads <dir>` — WHICH reads the verify gate needs, and WHERE each response goes (SKILL.md step 7.4).** The
list is DERIVED from the same `checklistGroups` walk `--checklist` and `--verify` use, so a page key the checklist
gates can never be a key nobody was told to read. Four kinds: **two files per published page key** (`meta.json`
for identity, `bundle.json` for the merged view), a **business-rules** read for the keys carrying a gated rule row
only, one **reachability** read per distinct on-stand key, and — only when the plan moves any — one **dashboards**
read per run, since `DashboardMigrationLog` is a stand table no page read can reach. An on-stand key the BUILD
agent records rather than reads (a card widget the converter placed) is listed as the builder's, not handed to the
read-only read-back agent as a read it cannot perform.

It fixes WHICH KEYS get read and nothing beyond that: no plan publishes the Freedom schema a key was built as, so
the agent still resolves that itself, and a key read against the wrong page comes back looking complete.

`<dir>` is the MIGRATION FOLDER — the one holding `build-tasks/` — so the raw responses stay beside the run. The
engine writes `reads/index.json` and owns every filename in it; page keys carry `:`, `@` and `#`, so the key is
slugged and the mapping recorded, and nothing downstream parses a filename. It also writes `evidence.json` /
`judge.json` skeletons with every published evidence id already a key, and never overwrites an existing one. Like
`--tasks`, it WRITES rather than prints, so it refuses a second mode flag instead of losing to it.

**`--verify --from <dir>` — the payload COMPOSED, not handed over.** The other half of that contract: it reads
`reads/index.json`, opens every file the plan named, and builds the payload — identity from `meta.json`, the
merged view from `bundle.json`, rules and reachability from their own files. `entitySchemaName` is the one DERIVED
value, read off the primary data source rather than retyped. `evidence.json` / `judge.json` are merged when
present, and `recorded.json` carries the on-stand keys the BUILD agent records rather than reads (a card widget
the converter placed) — a key still `null` there is left unset, so its row stays unconfirmed. The payload is written to `<dir>/built.json`, and the artifact beside it is `verify.md` for a bare `--from` or
`migration-result.md` under `--tasks`, where the report replaces the table. Either way the run replays offline
with `--verify --built <that file>`.

Three answers a slot can carry, and they never read alike: a **file written** is the answer; an **unwritten** file
leaves the key out, is named on stderr and in a banner atop `verify.md`, and fails at exit 2 as NOT CHECKED (a
re-read, not a repair); the literal **`false`** means "I asked and there is no such schema" and composes to the
payload's `false` — a hard ❌ MISSING that opens a repair. A literal `null` is none of the three and is reported.

The index is checked against the plan being verified twice: the `planVersion` stamp says the plan moved between
the two commands (re-cut it, rather than re-run every read), and a file-set comparison catches what the stamp
cannot — `computePlanVersion` hashes the whole manifest, so one stamp means one read list, and a set that still
differs was hand-edited or written by a different engine build.

`--from` composes with `--tasks <dir>` exactly as `--built` does. `--built <file>` is unchanged and stays for
offline replay; the two together are refused, being two sources for one payload.

Mode flags take no value and only ONE is honoured per run (the CLI picks the first it matches, so a second mode
flag is silently ignored) — pass exactly one. `--out <file>` works with all of them, except `--tasks`, which names
its own destination. With `--reads` it names where the printed plan goes; the index it writes is not an `--out`
artifact and always lands in `<dir>/reads/`, because the assembly half reads it from there by path. `--tasks` is also the one mode that REFUSES a second mode flag instead of losing to it: it
writes a folder rather than printing, so silent precedence would report a plan while slicing nothing.

**The plan version.** `--plan` prints `**Plan version:** \`plan-<hash>\`` as the first line of the Overview. It is a
deterministic short hash over EVERY key the manifest carries — `entity`, `schemas` (package + body CONTENT, in
order), `planMeta`, and equally `seed`, `detailSchemas`, `childPageSchemas`, `profileSchemas`, `section`,
`signals` and `behaviourIndex`. No wall-clock, no random source, and no filesystem path (a `{ file: … }` entry
contributes its CONTENT wherever it sits), so the same manifest always yields the same version and re-planning is
not a new version to approve. An earlier version hashed an ALLOWLIST of three keys, and that is what this replaced:
the unit set could change materially (a detail marked `editPage:false` drops a whole child page) while the version
stayed identical, so an approval authorised a plan nobody approved. The version confirms that the approved and
built plans were computed from the same manifest — it is not a checksum of the rendered artifact. It is the string the
`decisions.md` approval entry names. `plan.md` is engine-WRITTEN, so nothing else can put a version in it and
survive the next `--plan --out`.

**`--tasks <dir>` — the plan as a FOLDER of one-task files (SKILL.md step 7).** Same rows as `--checklist`, cut one
task per ARTIFACT so a caller can dispatch one sub-agent per task instead of holding every deliverable in one
context. The properties that decide its behaviour are stated in full in `tasks.mjs`:

- **`--split <file>` decides WHERE the seams go; the engine decides whether that answer is admissible.** Cutting a
  plan is a judgement about the work — that a related list and the handler filtering it are one piece, that the tab
  containers precede what goes in them, that an unresolved child entity is a reason to stop rather than a row to
  report. A row budget cannot see any of it, and measured against a real plan it split a folded handler chain across
  two sub-agents. So the cut is made once, written down, validated and FROZEN into the folder: a row claimed twice,
  a row the plan does not have, or an item `id` that is not a slug of lower-case letters, digits and dashes within
  49 characters, or a plan row left in no item, is refused with nothing written — and an unclaimed row is named by
  page, with no owner picked for it. The mechanical cut answers to the same rule against its own output, where a
  dropped row is a defect in the slicer rather than a file anybody can correct. Items sharing a `writesTo` are
  chained automatically. Three seams are checked rather than
  trusted. The plan writes `(ported with <caller>)` into a folded helper's own row, so a split that separates a helper
  from its caller is refused — that is machine-readable, and it is the seam the budget slicer actually got wrong
  (9 of 12 chains on one real plan). And an item carrying the per-type ROUTING row may not sit before the items
  that build the typed pages: routing binds each Type form by the Type column, so a form that is not built yet
  cannot be bound — a 94-item split of a real plan put it second, ahead of both. And an item carrying a page's
  `Quality gates` rows may not precede an item that still writes that page: a verdict filed on a page that is
  still being built is not a verdict. That review also WAITS on every writer of its page, which matters precisely
  because a review is correctly read-only — with no `writesTo` it joins no chain, so nothing else would hold it.
  An item may claim a whole group (`@Form — Logic`) or the next N rows of one (`@Form — Logic[50]`), taken in plan
  order — one real plan carries 282 custom methods on one typed form and 188 on another, and a file naming several
  hundred rows verbatim is one nobody authors; naming a row explicitly still wins over a later group claim. Row
  matching masks COUNTS but not identifiers (a digit inside a code span is part of a name), so a plan that gains a
  field does not force a re-cut while `ASPPricing2Page` stays distinct from its sibling. With no split file the
  budget slicer below stays as the degenerate path.
- **A task is one ARTIFACT, not one checklist group.** Every group that writes a page's `viewConfig` — layout,
  coverage, card actions, rules, handlers, the page's `⚠ Confirm` questions — writes the same thing, so they are
  ONE task rather than five sub-agents doing `get-page → merge → update-page` over each other. Each task publishes
  `writesTo:` (empty = read-only) and `dependsOn:`, so the orchestrator's parallelism rule is a field comparison
  rather than a judgement: two tasks may overlap only when their `writesTo` differ and neither depends on the other.
- **`--start <id>` moves the index when the work BEGINS.** Every `--tasks` run regenerates `index.md`, but until
  this flag existed the only thing that ever changed it was a sub-agent finishing, so a run in flight read exactly
  like a run that had not begun. `--start` marks the task `in-progress` and opens its clock in
  `timings.json`; the first regeneration that sees the task closed turns that clock into a
  `{id, artifact, weight, minutes}` sample — once, so a later re-slice neither moves nor duplicates it. The times
  are NOT in the task file: they were, next to `status` and `agentNonce`, and the first live builder to meet them
  wrote `endedAt` itself with a value rounded to the minute, so the engine recorded nothing and the progress block
  went on citing the cold-start rate over `done 1`. A task that reaches `done` with no clock ever opened is
  reported by name in the index's Attention section — nobody dispatched a sub-agent for it through the engine, and
  for a review task that is the failure the task exists to prevent. Every run of the
  mode then prints a `--- progress ---` block for the chat: the running task, its elapsed time, its expected range
  and what is left. The FORECAST is a range because the measurement is: one live run put five sub-agents between
  0.49 and 1.00 minutes per weight unit, so `TASK_BUDGET.minutesPerWeight` (0.79, that run's median) is the cold
  start and this run's own closed tasks replace it as soon as there are four. The clock lives in the task files
  and the progress block, never in `index.md` — the index is derived and compared byte for byte.
- **Under the budget a bucket is ONE task; over it, it is cut on a structural seam.** The monolithic case is one
  chunk of the same contract, not a second code path. Chunks pack greedily along the seams the plan already
  publishes (a tab, a region, a related list, a named handler) and a structural unit is never split, so a row
  heavier than the whole budget gets a chunk to itself. Same-artifact chunks are chained through `dependsOn`.
  The weights and the chunk size are declared in `TASK_BUDGET` and overridable per run with `opts.taskBudget`.
- **The cut packs units, not rows.** A unit is a fold chain (a handler and the helpers folded under it through
  `vk.parent`) joined with every row of the bucket that cites the same card (`card`, the id `Described in` cites).
  A unit sits at its first member's position and is never split; a unit heavier than the budget gets a chunk to
  itself. A bucket that fits one chunk keeps the plan's row order.
- **A task whose open rows all wait on an open decision is held (`HOLD_DECISION`).** Each row carries a decision
  subject: its card, else its confirm evidence id, else its fold-chain root. A `not-built — needs-decision` row
  with no `decisions:` entry opens its subject; a `todo` task every open row of which has an opened subject in
  another task is withheld by `--next` and refused by `--start`, naming the source task and row. `--decide` on
  the source row releases it. A row with no subject never waits.
- **A run under `TASK_BUDGET.run` is ONE build task plus ONE review, not one task per artifact.** The artifact rule
  exists so two sub-agents never write one page body; on a run this small there is only ever one builder, so the
  rule protects nothing while every extra task pays a fresh context that re-reads what the last one read. Measured
  on a 31-row section: six tasks, five sub-agents, 4.5M weighted tokens, of which the reference cache alone was
  0.78M for work no second builder read. The collapsed build writes one artifact (`whole`), so the parallelism rule
  still reads off `writesTo` unchanged; the review keeps its own read-only task, because a verdict filed by the
  agent that just built the page is not a verdict at any size. No reference cache is written for such a run.
- **Above it, the run's FIRST task is the reference cache.** One read-only sub-agent fetches the clio guidance
  articles and the design spec into `refs/`, and every later task is handed PATHS. It writes no stand artifact and
  blocks everything — which is why a dependency is published separately from the write target rather than inferred
  from it. It does NOT cache tool contracts or component docs: one `get-tool-contract` call for eight tools returns
  about 55KB, so a copy every builder can afford to read is a summary — and summarising is what dropped
  `create-app`'s `optional-template-data-json` to a bare name and kept "the file list needs its own data source"
  while losing the `columns` the platform throws without. Each build task asks for its own two or three tools and
  its own handful of components instead, and gets the authoritative answer.
- **`agentNonce` is the dispatch token, echoed back.** `--start` mints a token for that one task and prints it for
  the orchestrator to put in the sub-agent's prompt; it is never written into the task file, which an agent
  holding several files could read. The sub-agent copies it into `agentNonce:`. A closed task carrying a
  different token, or none, fails the gate — and one signed with the token of a task it names in `dependsOn` is
  named as a review closed by a builder of the work it judges. The orchestrator composes the prompt and reads the
  reply, so it cannot also be the evidence that it dispatched one sub-agent per task.
- **A closure with no dispatch record FAILS, in every mode that can see the folder.** `dispatchAudit` is one
  read-only predicate over the task files plus `timings.json`: `--start` refuses to open a new clock while it
  fails, plain `--tasks` exits 2 with the folder still written, and `--verify --tasks` exits 2 and writes no
  repair round. It separates a task that was never dispatched (re-open and rebuild) from one whose clock is still
  open (re-run the mode) from one signed with the wrong token. `not-applicable` is the one closure that needs no
  sub-agent — it is the PLAN's own boundary, never a word an agent may assert — and the reason under `## Notes` is
  what earns it that: one with nothing written there fails, because otherwise flipping every open task to it
  writes off a run in one edit. A PERSON's scope decision is a different thing and does not go here: it reaches
  the cells only through `--decide`, which refuses unless its `D<N>` already resolves. A sample whose duration rounds
  to zero is still a dispatch record — only the forecast filters it out.
- **`--next` ANSWERS what `--start` would accept, instead of making the caller find out by being refused.** The
  folder already published everything the answer needs (`status`, `dependsOn`, `writesTo`, the clocks) and
  `--start` already enforced it — but only by refusing, so every orchestrator that wanted the answer in advance
  re-derived it in shell over `index.md`, a DERIVED report whose columns then moved under them. Both callers now
  go through ONE predicate (`startBlocker`): the gate refuses through it and this mode reports through it, so an
  answer that disagrees with the gate is not a thing that can be written. Agreement produced by one predicate is
  structural; agreement produced by two rules kept in step by hand is a coincidence that decays.
  The answer is a SET, in queue order, and it is mutually exclusive with itself on `writesTo` — the parallelism
  rule is distinct artifacts, so an orchestrator fans out from one call, and a set that named two writers of one
  page body would advertise a dispatch `--start` refuses one call later. Each member carries the exact `--start`
  command, quoted, so nothing in the output is parsed positionally.
  Five verdicts, because their remedies share nothing: `startable` (dispatch), `waiting` (work in flight and the
  rest behind it — exit **0**, this is the commonest empty answer and it is not an error), `finished` (every task
  settled — go to the result report), `stuck` (nothing startable AND nothing in flight — exit **2**) and `ledger`
  (a closure with no dispatch record — exit **2**; `--start` refuses every id until it is repaired, so no task is
  advertised while it stands).
  ⚠ **Work in flight is a STATUS, never a raw clock.** A task recorded `blocked` KEEPS its clock — only a SETTLED
  task's clock is closed — so a mode that read `timings.json` to decide "something is running" reports a halted
  run as `waiting`, at a passing exit code, forever. That is why `stuck` is a failing verdict.
  It REFRESHES the folder exactly as a plain `--tasks` run does — replacing that call, not adding one. A strictly
  read-only answer would be wrong at the commonest moment of all: immediately after a sub-agent closes a task,
  whose clock the refresh is what closes, so the un-refreshed folder reads as a dispatch-ledger failure. For the
  same reason it refuses to combine with `--start`, `--route`, `--verify` or `--split`: each writes the folder
  before the answer would print, so one call could only describe a state the reader cannot place.
- **`--start` enforces the queue, not just the ledger.** It refuses a task whose `dependsOn` has not closed, and
  refuses a second token for an artifact a dispatched task is still writing. Both are field comparisons the engine
  makes rather than rules the caller is asked to honour. The second one matters most: with
  several tokens open on one artifact, a single sub-agent can hold them all and close each with a valid
  signature, and every other check passes. The check compares `writesTo`, so a read-only task never conflicts.

- **The task FILE is the record; `index.md` is DERIVED.** The index is regenerated from the files on every run and
  carries no fact of its own, so a write killed halfway costs one task's file rather than the run's state. Editing
  the index changes nothing.
- **The engine owns the deliverable rows AND `status:`; the caller owns the `Outcome` column, `declared:` and
  `## Notes`.** `status` is derived from the cells on every pass and written back; `declared` holds the caller's two
  word, `blocked` — the only status an agent may assert. A re-run rewrites the rows from the current plan (they are the plan's) and never
  touches the caller's three. An adopted file — a repair round's or one declared through `--tasks --add` — is
  neither rewritten nor removed: only its `status:` line moves.
- **Ids are content-derived — not positional, and not count-derived** — a short hash over (the page's
  `pageDedupeId`, the artifact, the chunk's structural anchor). The dedupe id and not the page KEY, because
  `claimPageKey` gives a base key to its first claimant: an inserted sibling can take `child:<Entity>` and push an
  already-built page to `child:<Entity>@<Via>`, and keyed on the key the never-built newcomer would inherit the
  built page's id — and its recorded `done`. The anchor is the chunk's first row with its DIGITS MASKED, because
  the digits are what a growing plan moves: `Side profile — 12 fields` and `— 13 fields` are one anchor, so adding
  a field does not renumber the chunks after it. `order` carries the build sequence and is the field that moves;
  the index calls it `Step`, which is the queue position and not the same fact as the `order` an
  orchestrator-authored file declares for itself. `rowsDigest` covers the verifier payload as well as the label, so
  a RENAMED field raises drift even though neither the caption nor the count moved.
- **The build order is leaf-first with TWO declared exceptions.** Sub-pages precede `main`, a grandchild precedes
  its parent, `list` follows `main`, a page's `⚠ Confirm` rows are the first rows of its own task and its
  `Quality gates` review is its last task. Base-field overrides sit between the layout that creates the fields and
  the coverage that counts them: they are changes APPLIED ONTO the template's existing fields, so the fields must
  exist first and the counts must see the result. The exceptions lead the run: the `Reference cache`, then `Scaffolding`
  (`main`'s `Pages` group) — not a layout but the app/section/package placement, the binding to the EXISTING entity
  and the page shells, the preconditions every other task needs.
- **Nothing is ever deleted, and nothing unreadable is ever written to.** A task that leaves the plan is reported as
  stale on the index. A file with no readable `id`, an unterminated front matter (a killed write, a hand edit), or an
  `id` two files claim is REFUSED: the engine cannot tell whose record it holds, so it is named on the index and on
  stderr and left byte for byte as it is — its task simply gets no file that run. Rewriting it would destroy the
  `## Notes` that may be the only record of work already done on a stand. An orchestrator file carrying an engine
  task's id (the natural result of copying a task file as a template) is refused for the same reason.
- Statuses are a checked vocabulary (`todo` / `in-progress` / `done` / `partial` / `blocked` / `not-applicable` /
  `wont-do` / `postponed`); an unrecognised one is reported, never read as "not done". Every word but `blocked` is
  COMPUTED from the `Outcome` column of the task's `## Deliverables` table and written into the front matter;
  `blocked` is the agent's ONLY status input. `wont-do` and `postponed` are a person's scope decision and reach
  the cells through `--decide` alone; `not-applicable` is the plan's own boundary. A `partial` task's unbuilt rows are routed into the SAME repair
  machinery a short `--verify` uses — grouped by (page, cause), one task per cause, one round per attempt — and
  the task computes `done` once that repair task closes. A row with no repair task open against it (none yet, or
  the round came back `blocked`) is what fails the run. **`--tasks <dir> --route` is how a run in flight routes
  them**: the same round, without the `--built` payload `--verify` needs, since mid-run most pages are not built
  yet. A repair task is recognised by front matter the ENGINE writes (`kind` / `cause` / `repairRound` / `covers`,
  whose row keys are hashed labels), so a repair file written by hand settles no row however it is titled — which
  is why routing is a mode and not a convention. A status recorded against an older row set keeps its held `rowsDigest`,
  so the drift warning survives every re-slice until the task is re-opened (`status: todo`) or that line is emptied.

A **plan-level gap writes NOTHING and exits 2** — `gate` / `structure` / `coverage`. Slicing a plan with a gap would
hand sub-agents write access to a stand against deliverables the plan cannot state, so this mode refuses before it
creates the folder rather than after a builder has run. `--out` is rejected here (exit 1): the mode writes the
folder itself, and silently ignoring `--out` would leave a caller believing the artifact went where it asked. So is
combining it with another mode flag: every other mode PRINTS while this one WRITES, so "first flag matched wins"
would answer `--plan --tasks ./d` with a plan and no folder.

**The build loop is `--checklist` → build → `--verify`.** `--checklist` renders one group per page the migration
creates — `main`, `list` (when the plan gates a list-page deliverable), `child:<Entity>`, `typed:<Schema>`,
`mini:<Schema>` — and one pre-seeded `☐ pending` row per deliverable. A key identifies exactly ONE physical page:
when two distinct pages would land on the same key (two related lists opening the same entity, or two same-entity
child pages on different branches) the engine appends a disambiguator — `@<Via>`, `@<Schema>`, `#2` — while one
page reached along two paths keeps a single key. The suffix is derived by the engine, so **read every key from
the checklist; never construct one.**

Those page keys are the ONLY valid keys of the `--built` payload:

```jsonc
{ "pages": { "main": { "viewConfig": <get-page bundle.viewConfig>, "packageName": "…", "parentSchemaName": "…", "schemaUId": "<page.schemaUId>" },
             "child:InternalRequest": false },      // false = genuinely not built; key omitted = not checked
  "reachability": { "sectionRegistered": { "workplaces": 1, "names": ["<Workplace>"] }, "reuseBindings": false },   // a COUNT, not a flag — a registration only ADDS, so the row closes at exactly 1
  "evidence": { "<id from --checklist>": { "referencePage": "…", "components": ["…"], "findings": ["…"], "findingsRaised": ["…"] } },
  "judge":    { "<id from --checklist>": { "convincing": true, "why": "…" } } }
```

`viewConfig` is clio `get-page`'s `bundle.viewConfig` **verbatim** — the MERGED page. Not the page's own body: an
element the template provides is touched with `operation: "merge"` and carries no type, so a check fed that source
could never confirm Feed, FileList, ApprovalList or the DCM bar. A payload that is not keyed by page is rejected
with exit 1, and an id or page key the engine did not publish is silently "not checked" — never invent one.

**The LIST page's OWN template is its own machine-checked row, the same mechanism the form page's
`Form template` row uses.** `pages["list"]` carries `parentSchemaName` exactly like every other page key, and when
the plan resolved at least one other list-page deliverable (columns, a quick filter, a command-bar action) a
`List template → <planned template>` row is added alongside them, resolved against `pages["list"].parentSchemaName`.
Before this, a plan/built template mismatch on the list page (e.g. the plan recommends `ListPageV2FreedomTemplate`
but the section was built on `ListPageV3Template`) surfaced only as free text — nothing machine-checked it, so a
run could close green while quietly ignoring it. The row is deliberately added ONLY when the list page is already
gated by another row: a plan with nothing else resolved for the list page must stay UNGATED (a `planMeta.listTemplate`
value alone must never publish an otherwise-unclosable `list` group).

**`schemaUId` is the PROVENANCE field and the CLI rejects a payload without it (exit 1).** Copy it verbatim from
`get-page` (`page.schemaUId`). Nothing in the plan carries a GUID, so it cannot be derived from the plan — only from
a real read. The identities must also agree: the same `schemaUId` may not appear under two keys, and one
`packageName` may not carry two `packageUId` values. This proves the payload is internally CONSISTENT, not that it
came from the stand (the engine is offline and cannot ask Creatio whether a GUID exists).

**The mini page is a page, so it is checked like one.** Its `Mini page` row resolves from
`pages["mini:<Schema>"]` — present with components ⇒ built · `false` ⇒ MISSING · key omitted ⇒ not checked. There
is no boolean to assert instead: `--built.miniPageBuilt` is read ONLY in the legacy flat payload (a payload with
no `pages` map at all, which the CLI rejects), never once a `pages` map is supplied.

**The inverse call graph.** `triggers[]` is read off DECLARATIONS (an attribute dependency, a bound control
property), so a method invoked from another method's BODY had none and its row printed `⚠ unresolved` — which reads
as "nobody knows what runs this" even though the parser had already recorded the call in `facts.calls`. Those calls
are now inverted into a caller index and walked upward until something answers what starts the chain: a caller with a
declared trigger (the row reports that declaration, reached `via` the chain), or a standard lifecycle method (the
platform calls it, which is the answer). Neither found → `internal call from X`, the honest partial answer. The index
is built from ALL methods including the standard ones the worklist filters out — a helper is very often invoked from
`init` / `onEntityInitialized`. Cycles are guarded, callers are sorted so the result is order-independent, a declared
trigger is never replaced by an internal one, and every caller travels along when there is more than one. Rows left
knowing only their caller are counted apart (`internalCallOnly`) from true orphans (`unresolvedTrigger`): both are
still behaviour-analysis work, and collapsing them would make the recovery look like work already done.

The plan then **folds** each such helper under the row that calls it: ordered directly beneath it, marked `↳`, with
its Freedom target replaced by `port with <caller>` so nobody builds a second artifact for half a behaviour. The
worklist header reports rows AND port units (63 rows that are 44 things to build read very differently). Nothing is
hidden — every row keeps its place and its own ported / dropped / blocked mark (Contract rule 7), and the
`--checklist` row for a folded helper says `(ported with <caller>)` so the two documents agree. Two deliberate
non-folds: a helper with SEVERAL callers (it is usually the row that becomes a shared converter) and one whose caller
is a standard method filtered out of the worklist (no parent row exists to fold under).

**The behaviour-analysis handoff (`--stubs` out, `manifest.behaviourIndex` back).** Four of the plan's imperative
rows cannot be answered from the page bodies this engine reads — a method whose trigger it could not trace, a method
assigned from another module, a `message`, a `mixin` — so SKILL.md step 5.1 sends them to the `classic-ui-expert`
skill. `--stubs` writes the payload for that: per scope (main page · mini page · each child page) every row's method
name, traced trigger, `externalRef` and line span, the `<kind>:<name>` member rows, and the standard-method names the
worklist excluded (so "63 stubs vs 70 members" is a set difference, not a contradiction). It is a digest, not the
result JSON — `evidence` is dropped, because the analysis run reads bodies from the stand itself.

The answers come back as `manifest.behaviourIndex`: `{ "<method>" | "<schema>::<method>" | "<kind>:<name>":
{ trigger?, from?, card?, ac?: […], bodyCard?, bodyAc?: […], note? } }`. On the next run the engine folds each entry
into the GENERATED tables — a **Described in** cell naming the card + AC on the `⚠ Imperative logic` row, the same
reference on a described `⚠ Imperative members` row, and a reported trigger where the engine traced none (marked
`reported`; an engine-traced trigger is never overwritten).

**Two cards, when the body lives elsewhere.** Any row whose behaviour is defined outside the scope that owns it is
described twice — a `mixin:` member or the method wiring one in, a method assigned from another module
(`externalRef`), a `message:` whose counterpart is in another schema, an aggregated `module-dep`, an override
implemented in the base chain. The owning scope's card says how this surface uses it (`card`/`ac`); the body's own
card, typically in the shared core, says what it does (`bodyCard`/`bodyAc`). Both render, as
`<card> <ACs> · body <card> <ACs>` — the criteria that gate a behaviour usually live in the body card, so a plan
that names only the wiring card reads as described while the guards are missing. Where that omission is
mechanically provable — a `mixin:` row or an `externalRef` method carrying a wiring card alone — the plan gets a
⚠ banner (`behaviourIndex.wiringOnly`). A key that matches no row anywhere becomes a plan banner rather than a
silent drop. A key addressing the SECTION scope raises no banner: the section's methods and imperative members are
the list page's own rows, so the answer folds onto them and renders like any page-scope one.
This is why the reference belongs in the manifest and not in the plan's hand-written `Adjustments`
section: `--plan --out` rewrites the file, so an appended index is lost on every regenerate.

`--out <file>` writes the `--plan`/`--spec` output to a file so the agent presents the file verbatim instead
of hand-pasting stdout (its Overview/Main-scope values come from `manifest.planMeta`).

**Exit codes & gates.** Bad input (missing/invalid manifest, unreadable schema `file`) → exit **1**. Otherwise
the run computes four gates — `gate.blocked` (correctness: parse errors / unresolved parents / merge warnings /
skeletal seed), `structure.complete` (input completeness: unresolved detail / child-page schemas),
`coverage.complete` (member coverage: every schema member accounted for) and `listGate.blocked` (the LIST
deliverable alone: the SECTION's evidence is incomplete — its body would not parse, its `diff` did not statically
resolve, its fold raised a correctness warning, or its parents did not resolve; scoped to the list page so a
section-side gap never blocks the form page) — plus, in
`--plan` mode only, a fourth **plan-completeness** check: required `manifest.planMeta` still `<FILL: …>`
(`planMetaMissing`) or unresolved on-stand `signals` (`signalsMissing`). If any of these is bad the CLI prints a
`⛔` banner to stderr and exits **2** (the artifact is still written/printed, with the banner at the top, so you
see *what* to fix). Exit **0** = all applicable gates clear = an approvable plan. (`--spec`/default runs need no
`planMeta`, so the plan check applies only to `--plan`.)

`--verify --built` applies the same exit-**2** done-gate whenever a deliverable is MISSING/unverified (or `planGaps`
is non-empty). The stderr line names which of the two it is: `⛔ VERIFY INCOMPLETE — YOUR BUILD is incomplete` is
repairable on-stand (build the missing pieces, file the evidence, re-verify); `⛔ GATE BLOCKED` / `STRUCTURE
INCOMPLETE` / `COVERAGE INCOMPLETE` / `LIST GATE BLOCKED` describe the PLAN and fire in every mode — no build
round closes one.

**The migration result report (`--verify --built <f> --tasks <dir>`, `report.mjs`).** With a task folder the
verify run prints ONE artifact computed from the task LEDGER and the BUILT PAGES, and its verdict is their
conjunction — `✅ COMPLETE` only when every task is closed and dispatched, no deliverable stands recorded
`not-built`, and every machine-checked row is present; otherwise `⛔ NOT COMPLETE — <every reason>`, exit 2 with a
`⛔ RUN NOT COMPLETE` stderr line. Written in the plan's vocabulary (*plan item*, pages by `--built.pages[k].schemaName`),
sections in the order a person acts on them: summary → **1** plan items recorded not built that need a decision
(quoting the agent's `Decision needed (row N):` line from `## Notes`) → **2** boundaries closed `not-applicable`,
split by whether the reason cites a recorded decision (`## D<N> — …` in `decisions.md`, `N. **…**` under the plan's
Adjustments) → **3** machine rows still open (omitted when none) → **4** the task ledger with per-task Machine /
Evidence + judge / By hand counts (the reference-cache task is not a plan task and is not listed; dispatch is not
reported — it stays an engine gate) → **5** per-task details quoting `Check on stand (row N):` lines. The plan-vs-built
table is not emitted with `--tasks` at all — nothing reads it as a file; the report carries what it says. `renderVerify` publishes
`rows` (every row with `pageKey`, `kind` `machine|confirm|na`, `vkType`, `status`, `outcome`) for it. Without
`--tasks` the bare table is printed as before.
**Identity matching:** an expected field name `Col` is satisfied by an element named `Col`, `ColField`, or bound
to `$Col` / `$PDS_Col_<hash>` (one built field per expected name); an expected rule target is satisfied by a rule
whose `condition`/`actions` carry it as a whole token in any of those forms — `caption`/`name` are never tokenized.
**Machine rows that would otherwise be confirm-on-stand:** with `--built.pages[k].handlers` and `.viewModelConfig`
(verbatim from get-page) the engine resolves `handler` rows (method name · folded caller · a branch on the method's
Classic trigger attribute/control — else ⚠, never ❌), `vmattr` rows (virtual attribute present), `layout` rows
(side profile / tab found by caption words / header, measured inside the container; a container-less payload is
judged page-wide and says so) and the `cardnative` row (template button element names). A `[module-dep]` row is
informational (`info`, ℹ noted). The ungated `List page →` identity row is dropped when the gated `List template →`
row exists.

**The member ledger (`coverage`).** Every member of every merged layer — each `diff` operation, `methods` entry,
`attributes` entry, `messages` entry, `mixins` entry, `define()` dependency and `details` entry — carries a
disposition: `mapped` (the ChangeSet has a Freedom artifact for it), `decision` (it is on a `⚠` worklist),
`resolved` (the agent recorded one in `manifest.memberDispositions`), `chrome` (pure decoration — a **menu separator**, and only
that: recorded and COUNTED, never a `⚠` and never a block; a tooltip, a control's label and the grid-settings
editor each carry content or children and raise a normal ⚠ instead),
`context` (inherited base-template content, excluded by design but COUNTED) — or `unaccounted`, which blocks.
Precedence runs `mapped` > `decision` > `chrome` > `context`: a real artifact or a recorded answer is the stronger
statement, and base-template decoration counts as `chrome` rather than `context`. Kinds with no members are reported as counted
zeros, so "the plan says nothing about messages" cannot mean "nobody looked". Methods additionally carry body
evidence read from the AST (framework calls made, attributes read/written, messages published/subscribed, line
span, passthrough-vs-real, assigned-from-another-module) — the parser still never EXECUTES a body.

## Files

- `engine.mjs` — `parseSchema()` (AST parse of a classic `define(...)` body — reads the returned object, never executes it) + `mergeHierarchy()` (replay the layer chain into one effective page + provenance).
- `vendor/acorn.cjs` — vendored **acorn 8.17.0** (MIT, the CommonJS build `dist/acorn.js`), the JS parser `parseSchema` uses; keeps the engine self-contained (no `npm install`). It is the CJS build so a plain synchronous `require()` loads it after the integrity check on ANY supported Node (no `require(esm)` >= 22.12 floor). **Not in `package.json` by design** (zero runtime deps), so it is outside `npm audit` / Dependabot — see the pin below.
  - **Integrity pin** — because this bundle is the one executable component that processes *untrusted* stand schema-body, its provenance is pinned in `vendor/provenance.json` (upstream package + version + SHA-256 of the LF-normalized bytes, which equals the published npm artifact's hash). `verify-vendor.mjs` recomputes the hash and exits non-zero on any mismatch; CI (`.github/workflows/pr.yml` → *Vendor integrity*) runs it, and `verify-vendor-upstream.mjs` additionally compares against the npm registry's own `dist.integrity`.
- `mapping-table.mjs` — the **shared mapping table**: one row per recognised Classic thing, carrying its role, its tier (A automatic / B view built + behaviour stubbed / C typed decision), its Freedom `target`/`verify` types and its notes. It absorbs the four hand catalogs that would otherwise live in `mapper.mjs` (`FEATURE_CATALOG`, `WIDGET_BY_MODULE`/`WIDGET_BY_CONTAINER`, `PROFILE_CARD_BY_MODULE`, `CARD_ACTION_BY_ITEM`) — `mapper.mjs` reads them back through views over the table, so there is ONE place a component target lives.
- `mapping-registry.mjs` — registry validation of that table: every `componentType` exists, every `propMap` key is a real `input`, every `events` key a real `output`, **per platform version**. Also `resolveRunIndex` (which registry a RUN validates against: the stand's export via `manifest.componentRegistry`, a version pinned by `manifest.platformVersion`, or the vendored union).
- `registry/component-index.json` — the **generated** component index (205 components × 7 platform versions; version membership as a bitmask). Regenerate with `node scripts/build-registry-index.mjs --src <static-files checkout>`; it is data, never hand-edited, and excluded from Sonar for that reason.
- `mapper.mjs` — `mapToFreedom()` (effective page → Freedom ChangeSet + `needsDecision[]`).
- `designspec.mjs` — render the plan / design spec / checklist / verify table as Markdown.
- `reads.mjs` — `--reads`: which stand reads the verify gate needs and the file each raw response goes into, derived from the checklist walk. Writes `reads/index.json`; composes nothing.
- `assemble.mjs` — `--verify --from`: opens the files `reads/index.json` names and composes the `--built` payload out of them, writing `built.json` beside the run. Reports what it could not read; never fills a gap in.
- `tasks.mjs` — `--tasks`: the same checklist rows cut into one file per task plus a derived index, and the merge that keeps a caller's recorded `status` and notes across a re-slice. No rendering of its own beyond those two files.
- `migrate.mjs` — CLI driver.

## Tests & internals

Golden runners, fixtures and the detailed engine-internals notes live **outside** the shipped skill, in
`engine-tests/classic-to-freedom/` (see its `README.md` and `engine-internals.md`), so this folder ships
runtime-only.

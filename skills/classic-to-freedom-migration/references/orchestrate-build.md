# Orchestrating the build — step 7 in full, and step 8's driver side

Read this ONCE, when the user has approved the plan (SKILL.md step 7). It is the orchestrator's side
of the build: how the plan is sliced, the contract you walk the task folder under, which briefs each
sub-agent is handed, the read-back and the judge, repair, and what the step-8 gate and its verdicts
mean. No sub-agent is handed this file — each gets the briefs its task kind names in 7.3.

<!-- read-discipline:start -->
**Read discipline — everything a command prints stays in your conversation for the rest of the task.**

- **Big output goes to a file, and only the lines you need come back.** A command whose output could
  run past ~200 lines or ~8 KB writes it to a file (a `>` redirect, a tool's `--output-file`); then
  `grep -n '<anchor>' <file>` finds the lines and `sed -n '<from>,<to>p' <file>` (or your file
  reader's offset and line limit) prints that window alone.
- **Paging through a whole file in chunks is a full read.** Five 200-line windows over a 1,000-line
  file cost what one whole read costs. Locate the section first, then read only it.
- **Query JSON, never print it whole.**
  `node -e "const j=require('./evidence.json'); console.log(JSON.stringify(j['<id>'], null, 1))"`
  prints the one record you need; `cat evidence.json` prints every record in the file.
- **Do not re-read what your conversation already holds.** A file you read earlier in this task is
  still there; read it again only when something has written to it since.
- **A good targeted read:** `grep -n '^#' plan.md` lists the headings with their line numbers, then
  `sed -n '120,178p' plan.md` prints your page's section and nothing else.
- **When a whole read is right:** your own task file, a brief you were handed, and a file your
  instructions tell you to read whole — read those in full, once.
<!-- read-discipline:end -->

## Step 7 — slice the plan, then orchestrate one task at a time

**7.1 Record the approval, then slice the plan.**

1. Record the approval in `decisions.md`, naming the **plan version** string `plan.md` prints
   (`**Plan version:**`). Build only against the plan that entry names.
2. **Decide where the seams go, ONCE.** Write `split.json` — the plan cut into work items, each
   claiming the plan rows it absorbs. This is a judgement and it is yours: put work that must be
   done together in one item (a related list and the handler that filters it; a folded handler chain
   and its helpers; the containers before what goes in them), mark an item `"stopGate": true` when
   it could legitimately halt the run rather than finish (it is carried into the task's front matter
   and shown as `⏸ stop-gate` in `index.md`, so the orchestrator sees it before dispatching), and
   give an item `"writesTo": ""` when it only reads. Each item's `id` is a slug the engine turns
   into a filename — lower-case letters, digits and dashes, at most 49 characters — so a descriptive
   sentence as an id is refused along with the whole file. Then:
   `node engine/migrate.mjs <manifest> --tasks <migration-folder>/build-tasks --split split.json`
   The engine REFUSES a split that claims a row twice, names a row the plan does not have, or leaves
   a plan row in NO item; it writes nothing at all in that case and **exits `2`** — the same code
   every mode that reads the cut answers with, so `--tasks`, `--tasks --next` and `--tasks --route`
   cannot disagree about whether one folder state is approvable. An unclaimed row is work nobody is
   scheduled to do: the refusal names those rows and their pages, with the count still owed, and
   picks no owner for them, because which item a row belongs to is the judgement this file records —
   place them and re-run. Note that a row the plan carries twice — `Quality gates` emits one per
   page — needs naming twice, once per item that means it. Once the split resolves, the file is
   copied into the folder and every later run reads that copy, so a re-slice is a reconciliation and
   not a second opinion. Skip `--split` entirely and the engine cuts by its own row budget — fine
   for a plan small enough that the seams do not matter, and measured putting a related list and its
   filter in different tasks on one that was not.
3. `node engine/migrate.mjs <manifest> --tasks <migration-folder>/build-tasks` (re-run after every
   status change) A plan that GAINS a row mid-build stops the folder: the frozen split no longer
   covers it, so `--next`, `--start`, this re-slice and the repair rounds all refuse until the new
   rows are placed in `split.json`. Nothing is written and no file is touched — every recorded
   status and `## Notes` survives — so the way forward is to place the rows (or delete `split.json`
   and fall back to the engine's own cut), not to rebuild.
4. A **plan-level gap writes nothing** and exits 2 — `gate` / `structure` / `coverage`. None of the
   three is buildable-out-of, so do not slice around it: fix the manifest or the stand, re-run
   `--plan`, re-approve if the plan changed, and slice then.
5. Present `build-tasks/index.md`. It is DERIVED — regenerated from the task files on every re-slice
   — so never hand-author a task list, a status table or a progress summary of your own beside it.
   It is what a **human** reads; it is **not** where you pick the next task from — that is `--next`,
   in rule 1 below.

**A task is one ARTIFACT, not one checklist group.** Every group that writes a page's `viewConfig` —
its layout, its coverage, its card actions, its rules, its handlers — writes the same thing, so the
folder buckets them into ONE `Page build` task per page rather than five tasks racing over one page
body. Each task publishes `writesTo:` (the artifact it writes, empty for a read-only task) and
`dependsOn:` (the tasks that must close first). A page big enough to outgrow one sitting is cut into
several `Page build` tasks that are chained to each other, so they are still never two writers at
once. The run's first task is the `Reference cache`, and the second is `Scaffolding`.

**A run small enough gets ONE build task and ONE review.** Below `TASK_BUDGET.run` the folder holds
exactly two files: everything that writes the stand (app, package, section, every page) as a single
`Whole migration` task, and the quality gates as a single read-only review that waits on it. There
is no `Reference cache` in such a run — it exists to stop several fresh contexts re-fetching the
same guidance, and here there is only one builder. A 31-row section came out as six tasks and five
sub-agents before this, one of them caching material nobody else read.

**7.2 The orchestrator contract.** Six rules; everything else in this step serves them.

1. **ASK THE ENGINE WHICH TASK TO START — do not pick one from `index.md`:**
   `node engine/migrate.mjs <manifest> --tasks <migration-folder>/build-tasks --next` It answers
   with **every task that is startable right now**, in queue order, each with the exact `--start`
   command that dispatches it — and it withholds every task that is not, naming what holds it. The
   answer is computed by the same predicate `--start` enforces, so a task it names is one that gate
   accepts and a task it withholds is one that gate refuses for the same reason. Nothing in it has
   to be parsed positionally.

   **Why not the index.** `index.md` is a DERIVED report: it is regenerated from the task files on
   every run, it carries no fact of its own, and its shape has already changed under callers who
   were reading it by column. Scheduling off it means re-deriving, in prose or in shell, a decision
   the engine already makes — and the two then disagree quietly. Ask; do not re-derive.

   **Its five answers, and what each one asks of you.** *N startable* → dispatch them (they are a
   set: no two write the same artifact, so they may run at once). *Nothing startable yet, work in
   flight* → wait for the running task(s), then ask again; this exits **0** and is not a failure
   (the ask refreshes the folder itself, so a separate `--tasks` run adds nothing). *Finished* →
   every task has settled; go to step 8. *Run halted* (exit **2**) → nothing is startable AND
   nothing is running: a task is `blocked` or carries a status nobody recognises, or waits on an
   open decision, and no re-run changes that — read its `## Notes` and decide, or `--decide` the
   source row it names, or re-open that row if the answer is to build it. *Dispatch ledger broken*
   (exit **2**) → repair the ledger first; `--start` refuses every id until you do. A task withheld
   with **every open row waiting on a decision** names the source task and row that raised it:
   answer that decision with `--decide D<N> --row <task>:<n>` and the task is released. When the
   answer is to build the row, re-open it instead: clear its `Outcome` cell and set its task back to
   `status: todo`. Do not dispatch the held task first.

   **The queue order it answers in is leaf-first, and that is a build requirement, not a
   preference:** a related list's Add/Edit opens the child's own form, so the child page exists
   before the parent list that opens it, and the list page comes after the form page it is gated
   off. Three deliberate exceptions lead the queue: the `Reference cache` runs FIRST (one read-only
   sub-agent fetches the clio guidance articles and the design spec, and every other task depends on
   it — it does NOT cache tool contracts or component docs; each build task reads its own from the
   stand), then `Scaffolding` — the app, package, section and page shells that every other task
   needs to exist. Within each page its `⚠ Confirm worklist` rows come first inside that page's own
   task, so a page is never built against an unanswered question. (A question that could change
   WHICH pages exist blocks the plan at the structure gate instead, so it never reaches a task.)

   **Mark it started BEFORE you dispatch — EVERY task, the review included:**
   `node engine/migrate.mjs <manifest> --tasks <migration-folder>/build-tasks --start <task-id>`
   That sets the task `in-progress`, opens its clock in `timings.json` and regenerates `index.md` —
   so the index moves when the work BEGINS, not only when an agent finishes. The clock is in
   `timings.json`, never in the task file, which is the caller's to edit.

   **This is a GATE, not a warning.** A task recorded `done` that was never started this way FAILS
   the run: the next `--start` refuses and opens no clock, a plain `--tasks` exits 2, and so does
   `--verify --tasks`. The message names every such file and the `--start` that re-opens it. Re-open
   each one (clear its `Outcome` cells, then `status: todo`), start it, and hand it to its own
   sub-agent — the whole set, because `--start` refuses while any of it stands. `not-applicable` is
   the one closure that needs no sub-agent, and the REASON under `## Notes` is what earns it that:
   one with nothing written there fails too. It is the PLAN's own boundary, never yours to declare —
   a scope decision ("we will not build this", "not this phase") is the developer's, and it reaches
   the folder only through `migrate.mjs --tasks <dir> --decide D<N> --wont-do|--postponed`, which
   refuses unless `D<N>` already resolves as a heading in `decisions.md`. Never hand-edit a task
   file to close it. **A build-time adjustment is recorded through `--decide` BEFORE the task it
   settles is dispatched.** An adjustment written only into `decisions.md` prose leaves its rows
   open, and the task goes to a sub-agent with nothing to build. A task whose every row is decided
   settles on its own and `--next` never offers it. Until the first task is dispatched, `--tasks`,
   `--next` and `--start` list every `D<N>` in `decisions.md` that no task's `decisions:` line cites.
   For each one that drops or postpones a deliverable, run `--decide` before the first dispatch. The
   list is printed only: it writes nothing and changes no exit code. `--decide` writes only the rows
   it is given. It then lists the open rows that share a subject with a decided row, in the same task
   or another one, each with the `--decide … --row <task>:<n>` command that applies the same answer.
   Run a command only when the person's answer covers that row.

   **`--start` also enforces the two scheduling rules, so neither is yours to remember.** It refuses
   a task whose `dependsOn` has not closed, naming each one and its status. And it refuses to issue
   a second token for an artifact a dispatched task is still writing, because two open tokens on one
   artifact is precisely what lets a single sub-agent hold both and sign each correctly. It also
   refuses a task every open row of which waits on an open decision on a subject another task
   shares. **Every reason it refuses exits `2`** — a broken ledger, a status that is a decision, an
   unclosed dependency, an open decision, an artifact already being written, a file the engine
   cannot parse, an id the folder does not hold. No clock was opened in any of them, so do not
   dispatch the task: the sub-agent would hold no token for it and its closure would fail the
   dispatch gate.

   **`--start` prints a DISPATCH TOKEN. Put it in the sub-agent's prompt.** It is issued to that one
   task, it is deliberately NOT written into the task file, and the sub-agent copies it into
   `agentNonce:` before it finishes. A task closed carrying a different token — or none — fails the
   same gate. Never write it into the file yourself: what the token establishes is that a context
   you dispatched closed the task, and you cannot attest to that on its behalf.

   The mode prints a `--- progress ---` block: **paste it into the chat verbatim** after every
   dispatch and every status change, so the user sees which task is running, how long it has been
   running, what it is expected to take, what is left, and `dispatched N of M`. Do not write a
   progress summary of your own — the block is rendered from the folder, and a hand-written one
   drifts from it within two tasks.
2. **One sub-agent per task, in a fresh context, and the sub-agent marks its own work.** Never run
   two build sub-agents at once — two tasks may overlap ONLY when their `writesTo` differ and
   neither lists the other in `dependsOn`, which in practice means a read-only task beside a build.
   **Sequential is not an exception**: the next task on the same page is a different sub-agent, so
   finishing one chunk of a page and picking up the next in the same context is the violation this
   rule names, not a way of keeping the page coherent. Each sub-agent echoes the dispatch token you
   handed it into `agentNonce:` before it finishes. You hand the token over and the engine checks
   it; you are the wrong party to prove this rule held, which is why the check is neither yours nor
   the sub-agent's to make.
3. **The task file is the record — the sub-agent writes its own status into it.** You do not
   transcribe a status the sub-agent reported to you: the file is what survives your own session
   ending. A task whose sub-agent died without writing stays `todo`/`in-progress` and is
   re-dispatched.
4. **Re-run `--tasks` after every task.** It refreshes `index.md` from the files, keeps the
   deliverable rows in step with the plan, and fills the index's `Attention` section. Read that
   section — it is where an unrecognised status, a task recorded `done` whose deliverables have
   since changed, and a task that left the plan surface are listed.
5. **You may change the task LIST; you may not change the PLAN.** Split a task that turned out to
   hold two separate pieces of work, or add one the plan does not model, by DECLARING it and letting
   the engine write the file (it carries `origin: orchestrator`):
   `node engine/migrate.mjs <manifest> --tasks <migration-folder>/build-tasks --add <decl.json>`,
   where the declaration is
   `{ "id": "<slug>", "pageKey": "<a page key from the plan>", "group": "<title>", "order": <n>, "writesTo": "<the artifact it writes>" | "readOnly": true, "deliverables": ["<row>", ...], "dependsOn": ["<task id>", ...], "stopGate": true }`
   — the last two optional; a list of declarations is fine; one bad declaration refuses the whole
   set and writes nothing. The engine validates the `pageKey` against the plan, writes the file
   with its own `Outcome` table, and from then on the body is yours and is never re-authored. **Do
   not hand-write the file.** Its status is derived from that table like every other task's, and a
   hand-written body the engine cannot parse is a task whose status nothing can derive. Give it a
   `writesTo:` naming the artifact it writes (copy the value from the task whose page it touches) so
   the engine chains it behind the other writers of that page; a corrective task for a decision that
   changes an already-built page is exactly this case, and without the field it sits in the queue
   writing a page body with nothing sequencing it. **What you may NOT hand-write is a task that
   settles another task's `not-built` row.** A repair task is recognised by front matter the engine
   writes — `kind` / `cause` / `repairRound` / `covers`, whose row keys are hashed labels you cannot
   type — so one you author settles nothing however it is titled: the `partial` task stays
   `partial`, the run keeps failing over a row somebody has already rebuilt, and the next verify
   opens a second round for the same work. Route it instead: `--tasks <dir> --route`, which opens
   that round mid-run, with none of the `--built` payload `--verify` needs. You may NOT delete or
   edit an engine task, and a deviation from the plan itself is a proposal to the user, recorded in
   `decisions.md`, never an edit you make on their behalf.
6. **Report after every task, and never report completion yourself.** Tell the user which task
   closed, what the sub-agent recorded, what is still open, and anything under `Attention`. The
   run's completion report is step 8's `--verify` table — a hand-authored "all done" summary in its
   place is the same defect this step exists to remove.

**7.3 What each sub-agent is handed.** A fresh context knows nothing, and a workflow cannot go
looking for a file, so pass all of it explicitly: the **path to its own task file** (it carries the
contract, the deliverables, the artifact it writes and the tasks it waits on); the migration folder;
the environment name; the manifest path and the resolved path to `engine/migrate.mjs`; the approved
`plan.md`; the `refs/` folder when the run has a `Reference cache` task (it holds the guidance
articles and the design spec; a collapsed run has none) — **paths, never pasted bodies**, because
inlining a cached file into every build prompt costs more than fetching it does. Tool contracts and
component docs are not cached: each builder reads them from the tools itself; the briefs its
task kind names in the table below; and for a task carrying imperative rows, the step-5.1 behaviour
cards with their acceptance criteria — a handler is ported against its card's AC, never from its
method name. A task with `dependsOn` also reads the `## Notes` of the tasks it names: what they
answered on the stand is recorded there and is not repeated in its own file.

| Task kind | How to recognise it in the task file | Hand it these briefs (paths) |
| --- | --- | --- |
| Reference cache — the run's first task | `group: Reference cache` (read-only, `writesTo:` empty) | `./references/reference-cache-brief.md` |
| Scaffolding — app, package, section, page shells | `group: Scaffolding`, `writesTo: scaffold` | `./references/build-task-execution.md`, `./references/build-scaffolding.md` |
| Page build — one page, or one chunk of it | `group: Page build…`, `writesTo: page:<…>` | `./references/build-task-execution.md`, `./references/build-page.md`, `./references/classic-to-freedom-mapping.md` — and `./references/build-dashboards.md` when its deliverables carry the section-dashboard rows |
| Repair round (7.5) | `kind: repair` in the front matter | `./references/build-task-execution.md`, `./references/build-page.md`, `./references/classic-to-freedom-mapping.md` — and `./references/build-dashboards.md` when its deliverables carry the section-dashboard rows |
| Whole migration — a run under `TASK_BUDGET.run` | `group: Whole migration`, `writesTo: whole` | `./references/build-task-execution.md`, `./references/build-scaffolding.md`, `./references/build-page.md`, `./references/classic-to-freedom-mapping.md` — and `./references/build-dashboards.md` when the plan lists dashboards |
| Dashboards migration (7.7) | its deliverables are the plan's section-dashboard rows (`Dashboards migrated — …`, `Dashboards element on the Freedom list page …`) | `./references/build-task-execution.md`, `./references/build-page.md`, `./references/build-dashboards.md`, `./references/classic-to-freedom-mapping.md` |
| Quality gates — the review that judges a page | `group: Quality gates` (read-only, `writesTo:` empty) | `./references/judge-brief.md` |
| Read-back (7.4) — not a task file | the driver's own read-back pass over `--reads` | `./references/read-back-brief.md` |

**A task that matches several rows gets every brief those rows name.** The engine files the
section-dashboard rows into the list page's own build task, so that task is both a page build and
the dashboards migration: hand it `build-page.md` AND `build-dashboards.md`, and a repair round
over those rows the same.

A task the table does not recognise — an item your `split.json` named, or one declared with `--add`
— gets the row of the work it does: a page body is a page build, the app and section registration is
scaffolding.

**7.4 The reads are the ENGINE's list; the responses are yours to fetch and drop in whole.** Step
8's gate reads a payload keyed by page — `pages` (each page's `get-page` `bundle.viewConfig`
verbatim), `reachability`, `evidence`, `judge`. No task produces it, and a builder must not assemble
its own verdict, so:

- **The read plan first.** Run `node engine/migrate.mjs <manifest> --reads <migration-folder>`. It
  writes `reads/index.json` and prints one row per read the gate needs: two files per published page
  key (`meta.json` and `bundle.json` from `.clio-pages/<schema>/`), the rule reads for the pages
  whose rules are gated, and every on-stand check — each with the exact file it goes into. Derive
  that list yourself and a page the checklist gates is a page nobody reads, which the gate then
  reports as "not checked" rather than as a gap.
- **The read-back** is one sub-agent with stand access but NO write access, handed
  `./references/read-back-brief.md` and the read plan's `reads/index.json`.
- **The judge's and the builder's records** — `evidence.json`, `judge.json`, `recorded.json` — are
  FILES the engine reads beside the read-back's; what each holds is in
  `./references/judge-brief.md`.
- **Then the engine composes the payload.**
  `node engine/migrate.mjs <manifest> --verify --from <migration-folder> --tasks <migration-folder>/build-tasks`
  opens those files, builds `built.json` out of them and runs the gate on it — `--tasks` still does
  what it always did, so the dispatch gate and the repair round are unaffected. **Do not hand-write
  that payload**: a key you do not copy is a check that never runs, and the table cannot tell that
  from a check that passed. `--built <file>` still works and is how you replay a run offline.
- **`findings` is what the pass found and settled; `findingsRaised` is what it did NOT fix.** Fixing
  a finding and raising it are both allowed, and they go in different lists. Anything in
  `findingsRaised` is work somebody still owns, so that row closes only when a decision in
  `decisions.md` / `findings.md` names the row's own evidence id — the decision claims the row, the
  record does not claim itself. `findings` carries no such demand: a pass that fixed what it found
  owes nobody a decision. A pass that found nothing leaves both lists empty.
- **The judge** is a THIRD context, handed `./references/judge-brief.md`: it rules on each
  `evidence[<id>]` record and must be able to say no.

Neither is a build task and neither writes to the stand. Run them once every task is closed or
parked, then step 8.

**7.5 Repair — the rows step 8 left open come back as tasks, not as a loop you run yourself.**
`node engine/migrate.mjs <manifest> --verify --from <migration-folder> --tasks <migration-folder>/build-tasks`
prints step 8's table AND writes that run's OPEN rows into the same folder as repair tasks. They are
handed to sub-agents exactly like build tasks — same contract, same one-sub-agent rule, and they
declare the page artifact they write, so the queue sequences them behind that page's build rather
than beside it.

- **Merged by (page, cause).** Sixteen handlers missing from one page is ONE task, not sixteen: a
  defect with many symptoms is one defect, and sixteen tasks is sixteen sub-agent startups to make
  one edit each. A merged task that outgrows the budget is cut like any other.
- **A repair task CLOSES like any other task** — its sub-agent fills the `Outcome` cell of every row
  and the engine computes the status from those cells. Every row accounted for reads `done` and
  closes the rows this round covers in the tasks they came from; a round that fixed some of them
  reads `partial`, and those rows alone go to the next round. A round nobody dispatched closes
  nothing, whatever its cells say.
- **A round is an ATTEMPT, not a verify run.** Re-verifying an unchanged page opens no second round
  — the rows are still the work of the round already in the folder. A new round opens only after the
  previous one was closed and the rows came back.
- **An unchanged row opens no round.** A row whose `What was recorded` and `Evidence behind it`
  cells come back identical to the round that last closed it is not handed out again: closed
  `built`, it is reported as a DISPUTED check (the verifier is in question, not the page); closed
  `not-built`, as STALLED. Neither counts as verified and the gate keeps failing; each is named on
  its own line of the round report. A row whose evidence changed opens a new round. A row routed
  from a build agent's `not-built` record (every `--route` round) is compared the same way, minus
  the engine's `recorded on <file>, row <n>` pointer, which names a different file each round; a
  match is STALLED. A STALLED row opens a round again once another task on its page, a repair task
  included, was dispatched and closed after the round that last closed it; a DISPUTED row does not.
- **Three rounds, then PARKED.** After three attempts at one KIND of row on one page the engine
  writes no fourth task and says so. The cap counts the kind, not the cause: a row `--verify` could
  not confirm comes back from the round that failed to fix it recorded as not built, and counting
  those separately is three more agents. Take it to the user: at that point the plan, the stand or
  the expectation is wrong, not the build. Do not hand-write a fourth task to get around this.
- **What is YOURS in repair** is only what no sub-agent can do: proposing a PLAN change (to the
  user, recorded in `decisions.md`), rolling back, and reporting. The rows themselves are the
  engine's to schedule.

**7.6 Whole-package scope.** Migrate one section at a time in the plan's dependency order
(entities/data sources → own sections → replacing/extension deltas → backend). Each section gets its
own slice, its own task folder and its own step 8 before the next one starts.

**7.7 Classic dashboards** are migrated by the task handed `./references/build-dashboards.md` (7.3),
last, against the built list page. Two of its steps need the user, and a builder cannot reach the
user, so both are yours:

- **Before you `--start` that task, confirm the target environment with the user** for
  `install-dashboards-migrator` — a destructive clio call that runs a configuration build and
  restarts the instance. Record the answer in `decisions.md` and put it in the sub-agent's prompt;
  without it the builder records the row `needs-decision` instead of installing. A builder that
  reports a clio too old for the verb (a `blocked` row) is yours to raise: ask the user to update
  clio.
- **The System Designer Dashboards migration run is the user's.** Relay the hand-off the builder
  writes under `## Notes` (the section, the target list page, **Migrate**, the **Dashboards
  migration log**), and record the outcome the user reports in `worklog.md`.

## Step 8 — the driver's side

**A folder of `done` task files is not a completion report — and neither is the machine table
alone.** The task statuses are how the step-7 orchestrator schedules work and how a killed session
resumes; they are recorded by the sub-agents that did the work, so a run closed on them alone would
be arithmetic over self-assertion. The `--verify` table reads only the built pages, so a run closed
on IT alone never sees what a build agent recorded as NOT BUILT (a handler that needs a decision, a
row closed `not-applicable` on the agent's own say-so) or which tasks never closed. A real run ended
exactly there: the table said "2 machine row(s) not confirmed", the ledger held 5 open tasks, 3
partial and three handlers recorded not built, and the table was what the user was shown.

**What the migration result report holds.** SKILL.md step 8 names the command that writes it —
`node engine/migrate.mjs <manifest> --verify --from <migration-folder> --tasks <migration-folder>/build-tasks`
— and says to present the report verbatim. With `--tasks` the engine writes ONE report computed from
the task ledger AND the built pages, in the language of the plan the user approved (a *plan item*, a
page named by its Freedom schema) — verdict first (`✅ COMPLETE` /
`⛔ NOT COMPLETE — <every reason>`), then a summary, then in the order a person acts on them: **1.**
plan items recorded not built that still need a decision — each with the `Decision needed (row N)`
line the build agent wrote, **2.** boundaries closed `not-applicable` — those citing a recorded
decision (`D<N>` in `decisions.md`, `Adjustment N` in the plan) as information, those citing none as
a question, **3.** machine rows the engine could not confirm (only when there are any), **4.** the
task ledger with HOW each task was verified (machine / evidence + judge / by hand), **5.** per-task
details of what is still open, with each build agent's `Check on stand (row N)` line. The
plan-vs-built table is not written as a file — the report carries everything it says. The verdict is
the CONJUNCTION: COMPLETE only when every task is closed, nothing stands recorded not built without
a decision, no boundary was asserted without one, and every machine-checked plan item is present.
The engine copies `name` from each page's `bundle.json` into the payload as `schemaName` — that is
how the report names the pages. Where the ledger and the built page disagree — a task `done` while
the table names a MISSING row, or the reverse — the stand is right: re-open the task whose rows that
row belongs to (clear its `Outcome` cells, then `status: todo`) and re-slice.

The same command runs the dispatch gate over the folder — read-only, no re-slice — so the run cannot
close while a task stands closed with nobody dispatched for it. While it fails, **no repair task is
written**: a repair round would schedule more sub-agents on top of work nobody was dispatched for;
the report is still written and says so. Without `--tasks` the verify run prints the bare
plan-vs-built table, checks the built pages only and says so; it is not the gate for a run that used
a task folder.

**The task is NOT done until the VERIFIED gate passes (mandatory) — reality-checked, not
self-reported.** On an orchestrated run the gate is
`node engine/migrate.mjs <manifest> --verify --from <migration-folder> --tasks <migration-folder>/build-tasks`
(above); on a run with no task folder it is the same command without `--tasks` — **you do not write
the payload.** Step 7.4's `--reads` named every file; this composes
`built.json` out of them, writes it and `verify.md` into that folder, and gates on it.

**`--verify --built <file>` is the REPLAY path** — the same gate against a payload already composed
(the `built.json` from an earlier run, or a recorded fixture). Use it to re-check a run offline,
never to author a payload by hand.

The shape below is what the engine COMPOSES — read it to understand the table, do not fill it in. It
is **keyed BY PAGE**, by the page keys the engine itself publishes: `main` · `list` (the section's
list page, when the plan gates one) · `child:<Entity>` · `typed:<Schema>` · `mini:<Schema>` (with an
`@<Via>`/`@<Schema>`/`#n` suffix where two distinct pages would otherwise share a key). A key the
engine did not publish is silently "not checked", not an error — which is why the read plan, not
you, decides the list.

```jsonc
{ "pages": { "main": { "viewConfig": <get-page bundle.viewConfig>, "packageName": "…", "parentSchemaName": "…", "schemaUId": "<page.schemaUId>", "schemaName": "<page.name — the result report names the page by it>", "handlers": <bundle.handlers — the handler rows are matched against it>, "viewModelConfig": <bundle.viewModelConfig — virtual-attribute rows are matched against its attributes>, "resources": <bundle.resources — a built tab's `#ResourceString(K)#` caption resolves through it> },
             "child:InternalRequest": false },     // false = genuinely not built; key omitted = not checked
  "reachability": { "sectionRegistered": { "workplaces": 1, "names": ["<Workplace>"] }, "reuseBindings": false },   // a COUNT, not a flag — a registration only ADDS, so the row closes at exactly 1
  "evidence": { "<id>": { "referencePage": "…", "components": ["…"], "findings": ["…"], "findingsRaised": ["…"] } },  // merged from evidence.json — the engine wrote every id as a key; you fill VALUES, never keys
  "judge":    { "<id>": { "convincing": true, "why": "…" } } }              // …and from judge.json, the same way
```

**Send `bundle.modelConfig` alongside it.** It is optional and nothing rejects a payload without it,
but it is the only way the gate can see the failure that costs the most to find by hand: a page
created from a template carries `#PrimaryDataSourceName()#` unexpanded (the Interface Designer
expands that macro, `create-page` does not, and `--entity-schema-name` only records a dependency),
so the page has no primary data source, `update-page` and `validate-page` both accept it, and the
card HANGS THE BROWSER. With `modelConfig` in the payload the template row reads ❌ MISSING and says
so.

**`viewConfig` is clio `get-page`'s `bundle.viewConfig` copied VERBATIM — the MERGED page, not
`ownBodySummary` and not the page's own body.** An element the TEMPLATE provides is touched with
`operation: "merge"` and carries no type, so a check fed the own body reads ❌ MISSING on a correctly
built page for Feed, FileList, ApprovalList, ContactCommunication and the DCM bar. The CLI
**rejects** a payload that is not keyed by page, or whose entry carries no `viewConfig`, at **exit
1** — that guard is what makes the gate impossible to hand-author. **The mini page is verified like
any other page**, from its own `pages["mini:<Schema>"]` entry: present with components ⇒ built ·
`false` ⇒ MISSING · omitted ⇒ not checked. There is no boolean to assert in its place. **The FIVE
reachability deliverables live in no page body** — `typedFormsBuilt`, `typedRouting`,
`miniPageWired`, **`reuseBindings`** (the RelatedPage binding for every related list whose child
reuses an existing Freedom form — an unbound list opens nothing) and `sectionRegistered` — because
they are config records the API's page read cannot see; each is `true` only once confirmed on-stand,
`false` when genuinely absent (`❌ MISSING`), and an OMITTED key is `⚠ verify`, so a
built-but-unreachable migration cannot pass. **`sectionRegistered` is the exception and takes NO
bare `true`:** a workplace registration only ADDS, so a flag cannot tell one binding from two —
report the count you read on the stand, `{ "workplaces": <n>, "names": [...] }`, and the row closes
at exactly 1. **A section whose plan lists dashboards adds `built.dashboards` — a LIST, not a
flag.** The migration is a PROCESS run (`MigrateDashboardsProcess`), so no page read can see it; and
one boolean for the whole run is what lets eleven of twelve close the row while the twelfth is never
mentioned. Transcribe `DashboardMigrationLog` instead, one entry per dashboard the plan lists:
`[{ "id": "<the plan's id>", "status": "Success"|"Skipped"|"Failed"|"Partially migrated", "schemaName": "…", "package": "…", "acceptedByUser": <bool> }]`
— the gate matches on `id`, `status` and `package`; `schemaName` rides along for the audit trail.
**Statuses go in VERBATIM** — copy them, do not interpret them, so the list can be diffed against
the log by eye. `package` is the package the migrated schema landed in; **omit it for a user-level
one**. `Skipped` counts as settled (that is what an already-migrated dashboard returns).
`acceptedByUser` belongs only on a `Partially migrated` entry and records that the user was shown
what is missing and answered — never that nothing was missing. The engine matches this list against
the plan's own decisions and names any dashboard that failed, went unreported, or landed somewhere
other than the plan said. The `crt.Dashboards` element itself is ordinary page content and is
verified from the LIST page's own `pages["list"]` entry — or from `pages["main"]` in a sub-scope or
a `pages-only-no-menu` run, where no list page is built. It needs no evidence key, but **supply that
entry**: without it the row reads ⚠ "nobody showed me that page", which blocks just as a ❌ does. The
engine diffs the built pages against the expected deliverables and returns a Plan-vs-Done table with
Status auto-filled per page (✅ found / ❌ MISSING / ⚠ verify) plus a hard verdict — **exit 2 while
any deliverable is MISSING or unverified**. On an orchestrated run the migration result report
(`--tasks` above) carries only the machine rows it could NOT confirm — its own numbered "machine
checks the run could not confirm" section — not the full row-level table, and that REPORT is your
final report; the full VERIFIED table is a plain `--verify` with no task folder. Either way the
migration is **not complete while the verdict says ⛔** — fix the gaps on-stand and re-verify.
(`--checklist` is the same table's pre-build skeleton; the VERIFY run is what closes the task.)
**Pass `bundle.handlers` and `bundle.viewModelConfig` too** (verbatim, beside `viewConfig`): with
them the handler rows, the virtual-attribute rows, the per-tab layout rows and the native
card-actions row are machine-checked (a handler is matched by the method name, the caller it was
folded under, or a branch on its Classic trigger attribute; a tab by the plan's caption words
against the built tab's caption/name — resolved through `bundle.resources` when the entry carries
them — or, when no caption matches, by holding exactly the fields the plan puts on that tab and no
other field — among containers whose type or name contains `Tab`, a `crt.TabContainer` or a direct
child of a `crt.TabPanel`; a tab row with no field names falls back to the one tab whose content
matches it exactly, and a tab row nothing matches reads ☐ confirm on-stand). Without them those rows
read ⚠ not checkable — never a false ✅. **Field and rule identity:** an expected field `Contact` is
satisfied by an element named `Contact`, `ContactField`, or one bound to `$Contact` /
`$PDS_Contact_<hash>`; an expected rule target is satisfied by a rule whose `condition`/`actions`
govern that column (`RejectReasonField` counts, a `caption` mentioning the column does not). Do not
rename built elements to satisfy the gate.

**`schemaUId` is the PROVENANCE field and the CLI rejects a payload without it (exit 1).** Copy it
verbatim from `get-page` (`page.schemaUId`). Nothing in the plan carries a GUID, so it cannot be
derived from the plan — only from a real read. The identities must also agree: the same `schemaUId`
may not appear under two keys, and one `packageName` may not carry two `packageUId` values. This
proves the payload is internally CONSISTENT, not that it came from the stand (the engine is offline
and cannot ask Creatio whether a GUID exists).

**Exit 2 is SEVEN different verdicts — do not treat them alike.** `⛔ NOTHING WRITTEN` (the repair
round words it `NO REPAIR TASKS WRITTEN`, `--start` words it `NOTHING WAS STARTED`) is a REFUSAL:
the engine declined to touch the folder, so nothing it names was cut, started or routed. Its cause
is on stdout under the banner — a plan-level gap, a split that claims a row twice or names a row the
plan does not have, a frozen cut that does not resolve against the plan, or one of the `--start`
holds above. Fix the cause named there and re-run; **every mode that prints it answers this same
code** (`--tasks`, `--tasks --next`, `--tasks --route`, `--tasks --start`, `--verify --tasks`), so
the verdict does not depend on which command asked. `⛔ VERIFY INCOMPLETE — YOUR BUILD is incomplete`
is yours to repair: build the missing pieces, file the on-stand evidence, re-verify.
`⛔ GATE BLOCKED` / `STRUCTURE INCOMPLETE` / `COVERAGE INCOMPLETE` fire in **every** mode, including
`--verify`, and mean the PLAN has a gap — no build round closes one and re-running buys an identical
answer. Fix the manifest, re-run `--plan`, re-approve if the plan changed, then build.
`⛔ DISPATCH GATE` is about the RUN, not the plan or the build: tasks were closed with no sub-agent
dispatched for them, or signed with a token dispatch never issued for them. **The folder and
`index.md` WERE written and are current** — do not re-cut them. Re-open every file it names — clear
its `Outcome` cells AND set `status: todo`, since the cells are what hold a task closed — then
`--start` each and hand each to its own sub-agent. `⛔ NOT BUILT` is about a DELIVERABLE: a build
agent recorded a row of its task as not built, so its task computes `partial` and nothing is
scheduled to close that row. It fires in **every** `--tasks` run and keeps firing until the row is
routed — `--tasks <dir> --route` opens that round mid-run, with none of the `--built` payload
`--verify` needs. Do not answer it by writing a repair file yourself: a repair task is recognised by
front matter the engine writes, so a hand-written one settles no row and the same gate fires again
over work somebody already did. `⛔ EVIDENCE MIS-FILED` is about the FILING, not the build: a
design-pass record or a judge verdict is filed under an id this run does not publish, so nothing
reads it and the pass it records counts for nothing. The page is not short — building anything
repairs nothing. Re-file each record under the id its row names; where several tasks write one page,
the id they share is one slot and the collision is the user's call, never a suffix to invent.
`⛔ RUN HALTED` is about the RUN as well, and it is the one verdict no command repairs: open tasks
remain, NOTHING is startable, and nothing is in flight — so the folder cannot change until somebody
decides something, and re-running any mode returns the identical answer. The stdout block above it
names what holds each task. Open each blocked task in the folder it names, read its `## Notes` for
the hold, resolve that hold (a decision, a dependency, an artifact somebody else owns), set the file
back to `status: todo`, and only then `--start` it. A task held on an open decision is already
`todo`: record that decision with `--decide` on the source row the block names, or, if the answer is
to build that row, clear its `Outcome` cell and set its task back to `status: todo`.

**Three non-negotiables that close the escape routes (a real run hit all three):**
1. **The engine's close artifact is the ONLY sanctioned completion/status report — the migration
   result report on an orchestrated run (`--verify --from … --tasks …`), the `--verify` table on a
   run with no task folder — present it as-is, and NEVER substitute a hand-authored "done" /
   "contract-validated" / "checkpoint" summary table of your own.** Hand-summaries are exactly where
   deliverables vanish: one run built the pages, wrote its own status table, and silently omitted
   the navigable-section registration — the user had to catch it. If you wrote a status table, you
   did it wrong; run `--verify` and present that. What the table does NOT contain — a plan deviation
   you propose, a plan-level gap — you surface in prose alongside it, never folded into the table.
2. **`--verify` reads the built page via clio `get-page` (an API call) — it does NOT use the
   browser.** A broken / SSO-blocked / permission-denied *render* on the stand is therefore **not**
   a reason to skip the gate: `get-page` still returns the built body over the API. Run `--verify`
   and present the engine's close artifact — the migration result report on an orchestrated run, the
   `--verify` table on a run with no task folder — even when you cannot visually open the page (the
   browser render is a separate, optional confirmation, not the gate).
3. **If you are BLOCKED — a deliverable you cannot finish, or a check you cannot run — your report
   is STILL that same engine close artifact (the migration result report on an orchestrated run, the
   `--verify` ⛔ table on a run with no task folder)** naming the exact unmet rows, never a prose
   "here's where things stand" checkpoint in its place. "Blocked" and "done" both come from the same
   machine-verified artifact.

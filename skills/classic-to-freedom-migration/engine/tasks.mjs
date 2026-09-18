// TASK SLICING — the approved plan cut into one FILE per task, plus an index derived from those files.
//
// WHY A FOLDER AND NOT A TABLE. `--checklist` renders every deliverable as one markdown table, which one agent
// then holds in one context: a session that dies loses the progress, and the only record that a row was built is
// prose that agent wrote. This mode publishes the SAME rows — `checklistGroups`, the exact set `--checklist` and
// `--verify` group by — as a folder an orchestrator walks one task at a time, handing each to its own sub-agent.
//
// THE TASK FILE IS THE RECORD; THE INDEX IS DERIVED. `index.md` is regenerated from the task files on every run
// and carries no fact of its own, so a write killed halfway costs ONE task's file rather than the run's state.
// Editing the index changes nothing — the next run overwrites it from the files.
//
// WHAT THE ENGINE OWNS vs WHAT THE CALLER OWNS. In a task file the engine owns the deliverable rows and rewrites
// them on every run (they are the plan's, not the caller's, and the plan may have changed). The caller owns
// `status` and the `## Notes` section, and those survive every re-run. A task the ORCHESTRATOR added
// (`origin: orchestrator`) is never rewritten and never removed — it is not the engine's to author.
// A task that leaves the plan is NOT deleted either: it is listed as stale, because deleting a file is how a
// record of work already done on a stand disappears.
//
// ONE TASK PER ARTIFACT, NOT PER GROUP. A group is a way of READING the plan; an artifact is a thing on the stand
// that gets written. Every group that writes a page's `viewConfig` — its layout, its coverage, its card actions,
// its rules, its handlers — writes the SAME artifact, so cutting one task per group hands N sub-agents one page
// body and makes each of them read-modify-write over the last one's save. Bucketing by artifact instead means two
// tasks never write the same thing, which is the invariant that removes the hazard rather than documenting it.
// `writesTo` publishes the bucket so the orchestrator can check it, and an empty `writesTo` is a read-only task.
//
// A BUCKET IS CUT ONLY WHEN IT IS TOO BIG, AND ONLY ON A STRUCTURAL SEAM. Under the budget a bucket is one task
// (that is the monolithic case — the same contract, not a second code path). Over it, the rows are packed into
// chunks along the seams the plan already publishes: a tab, a region, a related list, a named handler. A single
// structural unit is never split, so a chunk boundary never lands mid-tab.
//
// IDS ARE CONTENT-DERIVED, NOT POSITIONAL — AND NOT COUNT-DERIVED. `id` is a short hash over (the page's identity,
// the artifact, the chunk's structural anchor), so inserting a page renumbers nothing and a recorded status stays
// attached to the task it was recorded for. The page's identity is its `pageDedupeId`, not its key, because a key
// can be taken by a newly inserted sibling. The anchor is the chunk's FIRST row with its DIGITS masked, because
// the digits are exactly what moves: `Side profile — 12 fields` and `Side profile — 13 fields` are one anchor, so
// adding a field does not renumber the chunks after it. `order` carries the build sequence and is the field that
// moves; the index calls it `Step`.
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { checklistGroups, subPageNodes, LIST_PAGE_KEY } from "./designspec.mjs";
import { SPLIT_FILE, resolveSplit, reconcile, splitProblems, parseSplit } from "./split.mjs";

// The status vocabulary is CHECKED, not free text (a mistyped status is a stop, not a silent "not done"): an
// unrecognised value is reported on the index and on stderr instead of being folded into one of these.
// WHO SETS WHICH. `todo` and `in-progress` are the engine's lifecycle (file created, `--start`). `done` and
// `partial` are COMPUTED from the Outcome cells and never typed. `blocked` and `n/a` are the agent's own
// decisions and are never computed over — see `computeStatus`.
const S_TODO = "todo", S_IN_PROGRESS = "in-progress", S_DONE = "done", S_BLOCKED = "blocked", S_NA = "n/a";
// Distinct from `blocked` because it must not halt dependents.
export const S_PARTIAL = "partial";
export const TASK_STATUSES = [S_TODO, S_IN_PROGRESS, S_DONE, S_BLOCKED, S_NA, S_PARTIAL];
export const TASK_ORIGIN_ENGINE = "engine";
export const TASK_ORIGIN_ORCHESTRATOR = "orchestrator";
// The two origins a task file may declare: the engine authored it from the plan, or the orchestrator added it.
export const TASK_ORIGINS = [TASK_ORIGIN_ENGINE, TASK_ORIGIN_ORCHESTRATOR];
export const TASK_INDEX_FILE = "index.md";
const OPEN_STATUSES = new Set([S_TODO, S_IN_PROGRESS, S_BLOCKED]);
// The outcome of ONE deliverable, written by the agent into its row; this is what the status is computed from.
// A cause is required on `not-built` and is a fixed token — prose goes under `## Notes`, which a table cell
// cannot hold without breaking.
const O_BUILT = "built", O_NOT_BUILT = "not-built", O_NA = "n-a";
export const ROW_OUTCOMES = [O_BUILT, O_NOT_BUILT, O_NA];
// Two causes because routing branches two ways: `blocked` is the only one a re-run may clear by itself, and
// `needs-decision` is everything a person has to settle. Why it needs a person belongs under `## Notes`, not in
// a third token nothing branches on.
const CAUSE_BLOCKED = "blocked", CAUSE_NEEDS_DECISION = "needs-decision";
export const NOT_BUILT_CAUSES = [CAUSE_BLOCKED, CAUSE_NEEDS_DECISION];
const RETRYABLE_CAUSES = new Set([CAUSE_BLOCKED]);
const NOTES_HEADING = "## Notes";
const ENGINE_BODY_HEADING = "## Deliverables";
const NOTES_GUIDANCE = "<!-- YOURS. Never rewritten: what you built, the evidence you filed, what blocked you, what you propose. -->";

// BUILD PHASE per group, and this is the whole build order within a page. The Confirm worklist runs FIRST because
// its rows are open questions answered by reading the stand — resolving them after the page is built is how a page
// gets built against a guess. Quality gates runs LAST because the `creatio-ui-guidelines` pass needs a page to
// look at. A group not named here lands between the two, in the order `checklistGroups` emitted it.
const GROUP_PHASE = new Map([
  ["⚠ Confirm worklist", 10],
  ["Pages", 20],
  ["Form — Layout (by tab/region)", 30],
  ["Form — Coverage (verified)", 40],
  ["Card actions", 50],
  ["Form — Logic", 60],
  ["⚠ Imperative members worklist", 70],
  ["Child pages", 80],
  ["Quality gates", 99],
]);
const DEFAULT_PHASE = 85;
const phaseOf = (baseTitle) => GROUP_PHASE.get(baseTitle) ?? DEFAULT_PHASE;

// LEAF-FIRST, which is a build requirement and not a preference: a related list's Add/Edit opens the child's own
// form, so the child page must exist before the parent's list can be wired to it. `subPageNodes` walks the tree
// parent-then-children, so reversing it puts every node after its own descendants. `main` follows every sub-page;
// `list` follows `main`, because a list page's deliverables are gated off the built form page.
function pageOrder(result) {
  const subs = subPageNodes(result).map((n) => n.pageKey).filter(Boolean);
  const order = new Map();
  [...subs].reverse().forEach((key, i) => order.set(key, i + 1));
  order.set("main", subs.length + 1);
  order.set(LIST_PAGE_KEY, subs.length + 2);
  return order;
}
// A page key the walk did not publish (a group emitted for a key with no node of its own) sorts after everything
// known rather than colliding with `main` — silent co-location is what makes one page's rows close another's.
const pageRank = (order, key) => order.get(key) ?? order.size + 1;

// SCAFFOLDING COMES BEFORE THE LEAVES, and it is the one exception to leaf-first. `main`'s `Pages` group is not a
// page's layout: it carries the app/section/package placement, the binding to the EXISTING entity and the page
// shells (form, typed, mini) — the preconditions every other task builds into. Ranked purely leaf-first it landed
// second-to-last, which contradicts the build procedure's own "package/app/page scaffolding first" and describes a
// child page created before the package that holds it.
const SCAFFOLD_GROUP = "Pages";
const isScaffold = (group, baseTitle) => group.pageKey === "main" && baseTitle === SCAFFOLD_GROUP;
const SCAFFOLD_RANK = 0;
const groupRank = (order, group, baseTitle) =>
  isScaffold(group, baseTitle) ? SCAFFOLD_RANK : pageRank(order, group.pageKey);

// `baseTitle` is the group's own name with no page prefix — `pageGroup` publishes it alongside the rendered
// `title` precisely so a consumer never has to unpick the prefix (the rendered one passes through `esc`).
const baseTitleOf = (group) => group.baseTitle || group.title;

// ---8<--- ARTIFACTS: what a task WRITES, which is what decides where a task boundary may fall ---8<---

// `main`'s `Pages` group is the app/package/section placement and the page shells — the preconditions, not a
// page's body. It is its own artifact so every page task can depend on it.
export const ARTIFACT_SCAFFOLD = "scaffold";
// The reference cache. It writes FILES, not the stand, so it blocks on nothing and nothing it does can be
// clobbered — but every builder reads what it wrote, so everything depends on it.
export const ARTIFACT_REFS = "refs";
// The whole build as ONE artifact, used only for a run under `TASK_BUDGET.run`. It is the single writer of that
// run, so the parallelism rule still reads off `writesTo` unchanged: nothing else writes anything.
export const ARTIFACT_WHOLE = "whole";
const WHOLE_GROUP = "Whole migration";
const WHOLE_REVIEW = "review:whole";
export const REFS_DIR = "refs";
const REFS_GROUP = "Reference cache";
const REVIEW_GROUP = "Quality gates";
// The review pass reads a built page and files a verdict; it writes nothing, so it is its own read-only task
// rather than the tail of the build that it is supposed to judge.
const artifactOf = (group, baseTitle, identity) => {
  if (isScaffold(group, baseTitle)) return ARTIFACT_SCAFFOLD;
  const id = identity.get(group.pageKey) || group.pageKey;
  return baseTitle === REVIEW_GROUP ? `review:${id}` : `page:${id}`;
};
// A review task and the reference cache both write nothing ON THE STAND — the cache writes local files, the review
// writes a verdict. Published as `writesTo:` so the orchestrator's parallelism rule is a field comparison and not a
// judgement: two tasks may run at once only when their `writesTo` differ. What the cache still imposes on every
// builder is a DEPENDENCY, not a write conflict, and that is carried by `dependsOn` instead.
const writesToOf = (artifact) =>
  (artifact === ARTIFACT_REFS || artifact.startsWith("review:") ? "" : artifact);

// ---8<--- THE BUDGET: how much work one sub-agent is handed ---8<---

// DECLARED, not hard-coded at the call site, because these are calibration and calibration changes with evidence.
// The unit is nominal build effort, sized so a chunk is one sitting for one sub-agent: the measured runs put a
// builder at roughly half an hour for about this much, and a task that outgrows a sitting is the task an agent
// silently splits or silently merges. Override per run with `opts.taskBudget`.
export const TASK_BUDGET = {
  chunk: 40,        // max weight in one task
  // A WHOLE RUN worth no more than this is ONE build task plus ONE review, not one task per artifact. The
  // artifact rule exists so two sub-agents never write one page body; on a run this small there is only ever one
  // builder, so the rule protects nothing and each extra task is a fresh context that re-reads everything the
  // last one just read. Measured: a 31-row section (write weight 60) came out as six tasks — reference cache,
  // scaffolding, two page builds, two reviews — whose five sub-agents cost 4.5M weighted tokens, of which the
  // cache alone was 0.78M for work no second builder read.
  // TWO CHUNKS, NOT ONE, AND DELIBERATELY: `chunk` is sized to one sitting, so this hands a single sub-agent more
  // than a sitting's work. It is the lesser cost. A chunk boundary buys protection only when another task writes
  // the same artifact afterwards; a collapsed run has no such task, so an agent that runs long is re-dispatched
  // against a folder of two files rather than against a chain of six. At 60 the smoke section sat exactly on the
  // line, which is not a calibration; 80 is the round number above it that still leaves every measured multi-page
  // plan (the smallest was 160) on the per-artifact cut.
  run: 80,
  field: 1,         // one field inside a layout row
  relatedList: 4,   // a related list carries its own binding and its own child page
  rule: 1,          // one business rule
  handler: 4,       // one ported handler — the heaviest row kind per unit
  confirm: 2,       // one on-stand question answered before the build
  row: 2,           // anything else
  // MINUTES PER UNIT OF WEIGHT — the only figure here that is a measurement rather than a judgement, and the one
  // the progress block forecasts from. Median of the five sub-agents of one live run (ENG-98351, opus 4.8 at
  // medium effort): refs 12→7.0 min, scaffolding 10→10.0, form page 36→28.3, list page 14→6.8, review 8→6.5.
  // The spread is 0.49–1.00, so a single number is not honest on its own: `forecastMinutes` reports a RANGE, and
  // once this run has closed tasks of its own it forecasts from those instead of from this constant. One run, one
  // model, one effort level — re-derive it from `timings.json` files as more runs land, the way the weights above
  // were calibrated.
  minutesPerWeight: 0.79,
};
const budgetOf = (opts) => ({ ...TASK_BUDGET, ...opts.taskBudget });

// A row's weight is read off what the plan already says about it. `Side profile — 12 fields` is twelve fields of
// work and `Handler — onSaved` is one handler of it; treating both as "one row" is what made a 10-row page and a
// 10-handler page look like the same amount of work.
function rowWeight(row, baseTitle, B) {
  if (row.na) return 0;                                   // an approved boundary is recorded, not built
  if (row.vk?.type === "rule") return (Number(row.vk.n) || 1) * B.rule;
  const label = String(row.label || "");
  const fields = /—\s*(\d+)\s+fields?\b/.exec(label);
  if (fields) return Number(fields[1]) * B.field;
  if (/\brelated list\b/i.test(label)) return B.relatedList;
  if (/^Handler\s+—/.test(label)) return B.handler;
  return baseTitle === CONFIRM_GROUP ? B.confirm : B.row;
}
const CONFIRM_GROUP = "⚠ Confirm worklist";

// THE STRUCTURAL KEY of a row: everything about it EXCEPT the numbers. The numbers are what a growing plan moves
// (`— 12 fields` becomes `— 13 fields`), so masking them is what lets a chunk keep its identity when the page it
// starts at gains a field. Two rows that differ only in a count share a key, deliberately.
// Counts are masked, identifiers are not: a digit inside a code span is part of a NAME (`ASPPricing2Page`,
// `step1`), and masking those made sibling rows indistinguishable. Only the prose around a code span is masked,
// which is the only place a count ever appears.
const structuralKey = (label) => String(label).toLowerCase()
  .split("`")
  .map((part, i) => (i % 2 ? part : part.replace(/\d+/g, "n").replace(/\bn ([a-z]+)s\b/g, "n $1")))
  .join("`")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-/, "")
  .replace(/-$/, "")
  .slice(0, 60) || "row";

// ---8<--- THE REFERENCE CACHE: fetched ONCE per run, not once per fresh context ---8<---

// EVERY BUILD SUB-AGENT STARTS EMPTY. It re-reads what the previous one just read, because a fresh context has
// none of it — measured at 3.5× the tool lookups of the planning phase for work that is identical every time. So
// one read-only task fetches the shared material once into `refs/` and every later task is handed PATHS.
//
//   PATHS, NEVER PASTED BODIES. Inlining a cached file into every build prompt cost more than fetching it did.
//   THE CACHE IS A SHORTCUT, NOT A RESTRICTION. A sub-agent needing something the cache does not hold calls the
//     tool as usual — a cache that FORBIDS is a defect generator.
//   IT HOLDS ONLY WHAT A BUILDER CANNOT FETCH FOR ITSELF. Tool contracts and component docs were cached once and
//     both lost the part that mattered, because one `get-tool-contract` call for eight tools returns ~55KB: a copy
//     every builder can afford to read is a summary, and the summary is the defect. Those are read per task from
//     the tools; what stays here is the guidance articles and the design spec.
function refsRows(result) {
  const pages = [...new Set([...subPageNodes(result).map((n) => n.pageKey).filter(Boolean), "main", LIST_PAGE_KEY])];
  return [
    { label: `\`${REFS_DIR}/index.md\` — what was cached and which TIER each entry belongs to: \`stable-docs\``
      + " (the same on every run — the guidance articles) and `plan` (this plan version — the design spec). The"
      + " tier is the invalidation story: a `plan` entry is stale the moment the plan version changes and a"
      + " `stable-docs` entry effectively never. There is no `environment` tier any more: what was stand-specific"
      + " here was the component docs, and those are read per task from the stand instead of copied once." },
    // NO tool contracts and NO component docs here, deliberately. Both were cached once and both lost the part
    // that mattered: `create-app`'s `optional-template-data-json` became a bare name, so the builder could not see
    // it is what binds the app's section to an existing object; the Attachments recipe kept "needs its own data
    // source" and dropped the `columns` the platform throws without. The cause is not carelessness that a firmer
    // instruction fixes — ONE `get-tool-contract` call for eight tools returns ~55KB, so a faithful copy is
    // ~14k tokens in EVERY builder's context and a readable one is a summary, which is the defect. A builder
    // instead asks for exactly the two or three tools and the handful of components its own task touches, and
    // gets the authoritative answer. What a cache is genuinely for is what a builder CANNOT fetch for itself.
    { label: "Tool contracts and component docs are NOT cached: each build task calls `get-tool-contract` for the"
      + " tools it will invoke and `get-component-info` for the component types it will build, BY NAME, and reads"
      + " the answer whole. One call for eight tools returns about 55KB — a copy small enough for every builder to"
      + " read is a summary, and summarising is what lost `optional-template-data-json` and the file list's"
      + " `columns` on a measured run. Ask for your own surface; do not write a digest for the next agent." },
    { label: `\`${REFS_DIR}/guidance-<topic>.md\` — one file per clio guidance topic this build needs. Resolve the`
      + " set from the routing map (`get-guidance name=routing`), not from a list written down here — the map is"
      + " what knows which guide a given kind of work needs." },
    { label: `\`${REFS_DIR}/spec.md\` — the design spec (\`--spec\`) VERBATIM, carrying the plan's \`Adjustments\``
      + " list IN FULL: those are the corrections agreed at approval time and a copy without them silently drops"
      + " what was agreed. ONE file for the whole run, covering " + pages.map((k) => `\`${k}\``).join(" · ")
      + " — the engine renders one spec and has no per-page slice, so asking it for one yields the same file"
      + " under two names." },
  ];
}

// GREEDY PACKING ALONG THE SEAMS. Rows arrive in build order and are taken in that order, so a chunk is always a
// contiguous run and never a re-ordering of the plan. A row heavier than the whole budget gets a chunk to itself
// rather than being split: a structural unit — one tab, one region — is the smallest thing a task may be.
function chunkRows(rows, B) {
  const out = [];
  let cur = [];
  let w = 0;
  for (const r of rows) {
    if (cur.length && w + r.weight > B.chunk) { out.push(cur); cur = []; w = 0; }
    cur.push(r);
    w += r.weight;
  }
  if (cur.length) out.push(cur);
  return out;
}


const shortHash = (s) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 8);
// The identity of a task: its page, the artifact it writes, and the structural anchor its chunk starts at.
// NOT the row labels — a task whose rows changed is the SAME task with a changed deliverable (that is the drift
// signal below), not a new one whose status resets. And not the chunk's ORDINAL: numbering the chunks is what
// makes one extra field renumber every chunk after it and orphan every status recorded against them.
const taskId = (identityKey, artifact, anchor) => shortHash(identityKey + " " + artifact + " " + anchor);
// The row set's own digest, so a `done` task whose deliverables later changed can be told from one that did not.
// The VERIFIER PAYLOAD is digested alongside the label because a rename moves neither count nor caption: the
// coverage row still reads `Fields — 12 expected` when a field has been renamed under it, and digesting the label
// alone reported no drift on exactly the change a built page has to be re-checked against.
const rowsDigest = (rows) => shortHash(rows.map((r) => `${r.label}|${JSON.stringify(r.vk ?? null)}`).join(" "));

// A filename is for a human opening the folder; the `id` is the identity. Non-Latin captions all strip to the same
// characters, so a slug ALONE would be many-to-one — the id is appended for exactly that reason.
function slugify(s) {
  // The first replace collapses every run, so at most a SINGLE dash can sit at either end — no `+` needed here.
  const slug = String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-/, "").replace(/-$/, "").slice(0, 48);
  return slug || "task";
}
export const taskFileName = (task) => {
  const slug = slugify(`${task.pageKey}-${task.group}`);
  return `task-${slug}-${task.id}.md`;
};

// ONE task per artifact chunk. The rows are `checklistGroups`' rows verbatim, carrying the group they came from so
// the file still says which part of the plan each deliverable belongs to: a task carries what the plan says and
// adds nothing of its own, so nothing can be in a task that `--verify` will not later ask about.
function taskOf(chunk, order) {
  const { artifact, pageKey, label, anchor, identityKey, srcRows, reviewsArtifacts } = chunk;
  const rows = srcRows.map((r) => ({
    label: r.label,
    group: r.groupTitle,                   // the plan group this deliverable was read from
    vk: r.vk ? String(r.vk.type) : null,   // a machine-checked row: `--verify` resolves it, no prose closes it
    na: r.na || null,                      // not a deliverable of this plan (an approved boundary) — not work
  }));
  const task = {
    id: taskId(identityKey, artifact, anchor),
    pageKey,
    artifact,
    writesTo: writesToOf(artifact),
    anchor,
    group: label,
    title: label,
    groups: [...new Set(srcRows.map((r) => r.groupTitle))],
    order,
    phase: chunk.phase,
    origin: TASK_ORIGIN_ENGINE,
    status: S_TODO,
    rows,
    weight: srcRows.reduce((a, r) => a + r.weight, 0),
    gatedRows: rows.filter((r) => r.vk).length,
    naRows: rows.filter((r) => r.na).length,
    rowsDigest: rowsDigest(srcRows),
    dependsOn: [],
    notes: "",
  };
  // Only a collapsed run carries this: `review:<page>` names the page it judges in the artifact itself, and the
  // collapsed review judges the whole build, which no artifact name encodes.
  if (reviewsArtifacts) task.reviewsArtifacts = reviewsArtifacts;
  task.file = taskFileName(task);
  return task;
}

// THE LABEL a human reads in the index and in the file name. An artifact that was NOT cut keeps the plain artifact
// name; a chunk is named after the structural unit it starts at, so two chunks of one page are told apart by where
// they begin rather than by a number that moves when the page grows.
const ARTIFACT_LABEL = new Map([[ARTIFACT_REFS, REFS_GROUP], [ARTIFACT_SCAFFOLD, "Scaffolding"],
  [ARTIFACT_WHOLE, WHOLE_GROUP]]);
const artifactLabel = (artifact) =>
  ARTIFACT_LABEL.get(artifact) || (artifact.startsWith("review:") ? REVIEW_GROUP : "Page build");

function chunkLabel(artifact, rows, cut) {
  const base = artifactLabel(artifact);
  if (!cut) return base;
  const head = String(rows[0].label).split("—")[0].replace(/[`*]/g, "").trim();
  return `${base} — from ${head.slice(0, 48)}`;
}

// The rows of one artifact, in build order, each tagged with the group it came from and weighed. Ordering is the
// group phase (Confirm first, review last) and then the plan's own emission order — the same sequence the
// per-group slicing walked, so bucketing changes WHO builds a row, never WHEN it is built relative to the others.
function artifactRows(groups, B) {
  return groups
    .map((g, i) => ({ g, i, base: baseTitleOf(g) }))
    .sort((a, b) => (phaseOf(a.base) - phaseOf(b.base)) || (a.i - b.i))
    .flatMap(({ g, base }) => g.rows.map((r) => ({ ...r, groupTitle: base, weight: rowWeight(r, base, B) })));
}

// THE TASK SET. `planVersion` is the engine's own plan version — the string a `decisions.md` approval names — so a
// task folder can always be matched against the plan that was approved rather than the plan that exists now.
export function buildTaskSet(result, opts = {}) {
  const groups = checklistGroups(result, opts);
  const order = pageOrder(result);
  const identity = pageIdentities(result);
  const B = budgetOf(opts);
  // BUCKET BY ARTIFACT. The bucket, not the group, is the unit a task is cut from — two tasks that would write one
  // page body are one bucket here and can therefore never be handed to two sub-agents.
  const buckets = new Map();
  groups.forEach((g, i) => {
    const base = baseTitleOf(g);
    const artifact = artifactOf(g, base, identity);
    let b = buckets.get(artifact);
    if (!b) {
      b = {
        artifact,
        pageKey: g.pageKey,
        identityKey: identity.get(g.pageKey) || g.pageKey,
        rank: groupRank(order, g, base),
        seen: i,
        groups: [],
      };
      buckets.set(artifact, b);
    }
    // A bucket sorts where its EARLIEST group sorted, so bucketing never moves a page ahead of its own children.
    b.rank = Math.min(b.rank, groupRank(order, g, base));
    b.seen = Math.min(b.seen, i);
    b.groups.push(g);
  });
  const ordered = [...buckets.values()].sort((a, b) => (a.rank - b.rank) || (a.seen - b.seen));
  // The cache is fetched before anything is built, so it leads the queue — ahead of the scaffolding, which is the
  // first thing that would otherwise be reading contracts of its own.
  const refs = {
    artifact: ARTIFACT_REFS, pageKey: "run", identityKey: "run", rank: -1, seen: -1,
    groups: [{ pageKey: "run", baseTitle: REFS_GROUP, title: REFS_GROUP, rows: refsRows(result) }],
  };
  const small = collapseSmallRun(ordered, B);
  // A collapsed run is ONE chunk by construction, so the chunk budget is lifted for it: cutting the single build
  // task back into chunks would undo exactly what the collapse decided.
  const chunks = small
    ? small.flatMap((b) => chunksOf(b, { ...B, chunk: Infinity }))
    : [refs, ...ordered].flatMap((b) => chunksOf(b, B));
  const tasks = chunks.map((c, i) => taskOf(c, i + 1));
  return {
    entity: result.entity || null,
    planVersion: result.planVersion || null,
    budget: B,
    tasks: withDependencies(tasks),
  };
}

// A RUN TOO SMALL TO SPLIT. Returns the two buckets it collapses to — everything that writes, then everything
// that reviews — or `null` when the run is big enough that the per-artifact cut stands. The reference cache is
// dropped rather than folded in: it exists to stop N fresh contexts re-fetching the same contracts, and with one
// builder there is no second reader to amortise it over. Nothing verifiable is lost — its rows are engine-authored
// task rows, not plan deliverables, so `--checklist` and `--verify` never saw them.
function collapseSmallRun(ordered, B) {
  const isReview = (b) => b.artifact.startsWith("review:");
  const writes = ordered.filter((b) => !isReview(b));
  const reviews = ordered.filter(isReview);
  if (writes.length < 2) return null;            // one writer already — there is nothing to collapse
  const weight = writes.flatMap((b) => artifactRows(b.groups, B)).reduce((a, r) => a + r.weight, 0);
  if (weight > B.run) return null;
  const at = (bs) => ({ rank: Math.min(...bs.map((b) => b.rank)), seen: Math.min(...bs.map((b) => b.seen)) });
  const whole = {
    artifact: ARTIFACT_WHOLE, pageKey: "run", identityKey: "run",
    ...at(writes), groups: writes.flatMap((b) => b.groups),
  };
  if (!reviews.length) return [whole];
  // The review keeps its own read-only task: a verdict filed by the agent that just built the page is not a
  // verdict, and that holds however small the run is.
  return [whole, {
    artifact: WHOLE_REVIEW, pageKey: "run", identityKey: "run",
    ...at(reviews), reviewsArtifacts: [ARTIFACT_WHOLE], groups: reviews.flatMap((b) => b.groups),
  }];
}

// Cut one bucket into the tasks it needs. Under the budget that is exactly ONE task — the monolithic case is this
// function returning a single chunk, not a separate path with its own contract.
function chunksOf(bucket, B) {
  const rows = artifactRows(bucket.groups, B);
  if (!rows.length) return [];
  const packed = chunkRows(rows, B);
  const cut = packed.length > 1;
  const used = new Map();
  return packed.map((srcRows) => {
    // Two chunks of one bucket can only share an anchor when the plan repeats a row label verbatim. Disambiguating
    // by occurrence keeps both addressable; it is scoped to the repeat, so it cannot renumber unrelated chunks.
    const key = structuralKey(srcRows[0].label);
    const n = (used.get(key) || 0) + 1;
    used.set(key, n);
    return {
      artifact: bucket.artifact,
      pageKey: bucket.pageKey,
      identityKey: bucket.identityKey,
      reviewsArtifacts: bucket.reviewsArtifacts,
      anchor: n > 1 ? `${key}#${n}` : key,
      label: chunkLabel(bucket.artifact, srcRows, cut),
      phase: phaseOf(srcRows[0].groupTitle),
      srcRows,
    };
  });
}

// WHAT MUST BE DONE BEFORE THIS TASK STARTS, as ids the orchestrator can check rather than an ordering it has to
// infer. Two things are load-bearing: the scaffolding precedes everything that writes (a page cannot be saved into
// a package that does not exist), and a task that writes an artifact follows the previous task writing THAT SAME
// artifact. The second is the one that makes `get-page → merge → update-page` safe: same-artifact chunks are
// chained, so no parallel dispatch of them is ever legal, and a queue walked in `order` already satisfies it.
// WHICH PAGES A TASK REVIEWS, as resolved artifact names. The mechanical slicer gives a review its own
// `review:<identity>` artifact; a split has no such notion, so an item that carries `Quality gates` rows is
// recognised by those rows. Without this a split whose review is correctly read-only waited on nothing at all and
// could be handed out before the page it judges was written.
const reviewedArtifacts = (t) => {
  if (Array.isArray(t.reviewsArtifacts)) return t.reviewsArtifacts;
  // The collapsed run's review judges the whole build. `review:whole` does not name that the way `review:<page>`
  // names a page, so it is spelled out here rather than left to the `reviewsArtifacts` field alone: that field is
  // not in the front matter, so it survives a re-slice only because the fresh set is rebuilt before the merge.
  // Deriving it from the artifact instead keeps the answer right whoever the task was parsed or adopted by.
  if (t.artifact === WHOLE_REVIEW) return [ARTIFACT_WHOLE];
  return t.artifact?.startsWith("review:") ? [`page:${t.artifact.slice("review:".length)}`] : [];
};

// A review reads the page it judges, so it follows the tasks that wrote that page. SEEN SO FAR, like the
// scaffolding: depending on later writers too would point a dependency forward in the queue. A split that puts a
// review ahead of a writer of its page is refused outright (see `split.mjs`), so in an admissible cut the two are
// the same set — this keeps the graph walkable even when something slips past that check.
function reviewDeps(t, writersSoFar) {
  const want = reviewedArtifacts(t);
  if (!want.length) return [];
  return writersSoFar.filter((o) => want.includes(o.writesTo)).map((o) => o.id);
}

function withDependencies(tasks) {
  // SCAFFOLDING SEEN SO FAR, not all of it. The engine's own slicing puts every scaffold task at the front, but a
  // split may legitimately place one late — per-type routing binds each Type's form and so belongs AFTER the typed
  // pages, even though it is scaffolding. Depending on all of them made every earlier task wait on that late one:
  // a dependency pointing FORWARD in the queue, which is a deadlock the orchestrator cannot walk out of. A task
  // therefore waits on the scaffolding that precedes it, which is exactly what the split's own order declares.
  const scaffolds = [];
  // The cache writes no stand artifact, so `writesTo` cannot express that it still blocks every builder: they all
  // read the files it produces. That is a DEPENDENCY, and it is the reason dependencies are published separately
  // from the write target rather than being inferred from it.
  const refs = [];
  const lastOn = new Map();
  const writersSoFar = [];
  return tasks.map((t) => {
    const deps = [];
    if (t.artifact !== ARTIFACT_REFS) deps.push(...refs);
    if (t.artifact !== ARTIFACT_SCAFFOLD && t.writesTo) deps.push(...scaffolds);
    if (t.artifact === ARTIFACT_REFS) refs.push(t.id);
    if (t.artifact === ARTIFACT_SCAFFOLD) scaffolds.push(t.id);
    // Chained on the ARTIFACT, which is what two tasks would collide over. That covers the reference cache too:
    // its chunks write no stand artifact but they do write the same local files, so they are still a chain. A
    // read-only item from a split carries an artifact of its own precisely so it joins no chain at all.
    const chainKey = t.artifact;
    const prev = lastOn.get(chainKey);
    if (prev) deps.push(prev);
    lastOn.set(chainKey, t.id);
    deps.push(...reviewDeps(t, writersSoFar));
    if (t.writesTo) writersSoFar.push(t);
    return { ...t, dependsOn: [...new Set(deps)].filter((d) => d !== t.id) };
  });
}

// A task's identity must survive a page KEY changing under it. `claimPageKey` gives a base key to its first
// claimant, so inserting a sibling that sorts earlier can take `child:<Entity>` and push the already-built page to
// `child:<Entity>@<Via>`. Keyed on the key alone, the never-built newcomer would inherit the built page's id — and
// with it a recorded `done`. `pageDedupeId` identifies the PHYSICAL page and does not move, so it is what the id
// hashes. `main` and `list` are not in the walk and are their own identity.
function pageIdentities(result) {
  const map = new Map();
  for (const node of subPageNodes(result)) {
    if (node.pageKey) map.set(node.pageKey, node.pageDedupeId || node.pageKey);
  }
  return map;
}

// ---8<--- THE TASK FILE ---8<---

const FRONT_MATTER_KEYS = ["id", "status", "origin", "pageKey", "group", "order", "planVersion", "rowsDigest",
  "writesTo", "dependsOn", "stopGate", "agentNonce"];
// A repair task carries two more, and they are what the NEXT verify run reads: which cause it was opened for and
// which round of it this is. Both live in the file because the folder is the state — counting rounds from a
// session's memory is how a capped cause quietly gets a fourth sub-agent.
// `covers` names the ROWS this repair task was opened over. A cause is a BUCKET — `causeOf` falls through to
// `other` for any label the six kind patterns miss, so most of a page shares one — and crediting a row because
// its bucket closed credits rows nobody looked at. The labels are hashed rather than written out: they are
// customer captions, up to a paragraph long, and the front matter is read by a person.
const REPAIR_KEYS = ["kind", "cause", "repairRound", "covers"];
// ⚠ THE LABEL ALONE, with no occurrence suffix — unlike `rowKeys`, which appends `::n`. Two rows of one task that
// carry identical `Deliverable` text are ONE key here: they are routed once and they close together.
const coverKey = (label) => shortHash(String(label || "").trim().toLowerCase().replace(/\s+/g, " "));

function renderFrontMatter(task, set) {
  const v = {
    id: task.id, status: task.status, origin: task.origin, pageKey: task.pageKey,
    group: task.group, order: String(task.step ?? task.order), planVersion: set.planVersion || "",
    // The digest the STATUS was recorded against, not necessarily the current rows — see `carryOver`. Writing the
    // current one here would erase the drift warning on the first re-slice after the plan changed, which is the
    // one moment it has to survive.
    rowsDigest: task.recordedDigest || task.rowsDigest,
    // The artifact this task writes on the stand — empty for a read-only task. Two tasks may run at the same time
    // only when these differ, which is a comparison and not a judgement call.
    writesTo: task.writesTo || "",
    dependsOn: (task.dependsOn || []).join(" "),
    // The split author marks an item that may legitimately halt the run rather than finish. It is carried into the
    // file and shown in the index so the orchestrator sees it before it dispatches — a flag nothing reads is a flag
    // the SKILL asks for and then ignores.
    stopGate: task.stopGate ? "true" : "false",
    // WRITTEN BY THE SUB-AGENT, checked by the engine. One sub-agent per task is the contract; the orchestrator
    // that composes the prompt is also the one that grouped tasks in testing, so it cannot be the thing that
    // proves the contract held. A nonce the sub-agent mints itself, appearing on two files, is one sub-agent
    // having closed two tasks — the engine sees it without asking either of them.
    agentNonce: task.agentNonce || "",
  };
  const keys = [...FRONT_MATTER_KEYS];
  // ENG-99192 — the build-time reconcile mode, stamped so the ONE sub-agent handed this file self-describes how to
  // place elements (overlay vs classic-layout). Emitted only for an existing-Freedom reconcile (set.reconcileMode
  // is null for a rebuild, which always builds fresh), so a rebuild's task files are byte-for-byte unchanged.
  if (set.reconcileMode) {
    v.reconcileMode = set.reconcileMode;
    keys.push("reconcileMode");
  }
  if (task.kind === REPAIR_KIND) {
    Object.assign(v, { kind: task.kind, cause: task.cause, repairRound: String(task.repairRound),
      covers: (task.covers || []).join(" ") });
    keys.push(...REPAIR_KEYS);
  }
  return ["---", ...keys.map((k) => `${k}: ${v[k]}`), "---"];
}

function closedByOf(row) {
  if (row.vk) return "`--verify` (`" + row.vk + "`)";
  if (row.na) return "N/A — " + row.na;
  return "an evidence record + a judge verdict";
}

// The `From` column names the plan group each deliverable was read from. A task now spans several groups (they
// write one artifact between them), so without it the file would no longer say which part of the plan a row is.
function renderRowTable(rows, repair = false) {
  // A repair row is shown with what was RECORDED against it and the EVIDENCE behind that, verbatim. A sub-agent
  // sent to fix a row needs what was actually observed; re-describing it in the engine's own words is how a repair
  // round gets spent on a row that was never the problem. The source is `--verify` for a machine-checked row and
  // the build agent's own Outcome cell for a `not-built` one, so the heading names neither.
  // The `Outcome` column is the agent's here too: one status word over N rows cannot say which of them the round
  // fixed, and the rows are what the next round and the routed task read.
  if (repair) {
    const L = ["| # | Deliverable | What was recorded | Evidence behind it | Outcome |",
      "| --- | --- | --- | --- | --- |"];
    rows.forEach((r, i) => L.push(`| ${i + 1} | ${cell(r.label)} | ${cell(r.status) || "—"} | ${cell(r.evidence) || "—"} | ${cell(r.outcome) || "—"} |`));
    return L;
  }
  // The Outcome cell is the agent's and is carried across a re-slice; every other cell in the row is the plan's.
  // An empty cell is NOT "built" — it is unaccounted, and a task cannot compute `done` over one.
  const L = ["| # | From | Deliverable | Closed by | Outcome |", "| --- | --- | --- | --- | --- |"];
  rows.forEach((r, i) => L.push(`| ${i + 1} | ${cell(r.group) || "—"} | ${cell(r.label)} | ${cell(closedByOf(r))} | ${cell(r.outcome) || "—"} |`));
  return L;
}

// A DELIVERABLE LABEL IS A CUSTOMER'S CLASSIC CAPTION and may contain a `|`. The Outcome column is read back by
// cell POSITION, so an unescaped pipe shifts every index after it: the label truncates, the outcome is read out
// of the wrong cell, and the row's mark can never be matched to it again. Escaped on write, undone on read.
const cell = (s) => String(s ?? "").replaceAll("|", String.raw`\|`);
const uncell = (s) => String(s ?? "").replaceAll(String.raw`\|`, "|");

// An empty `## Notes` would otherwise end the file in three newlines. Scanned rather than matched with a
// quantified regex, which Sonar reads as super-linear backtracking on a long run of newlines.
function endWithOneBlankLine(text) {
  let end = text.length;
  while (end > 0 && text[end - 1] === "\n") end--;
  return text.length - end >= 3 ? `${text.slice(0, end)}\n\n` : text;
}

// THE ONE-SUB-AGENT CONTRACT, stated in the file the sub-agent is handed rather than only in the orchestrator's
// instructions — the file is the prompt, so the rule that binds the reader has to be in it. The write ordering and
// the nonce are both here because both are checkable afterwards: `writesTo` says what may not run beside this, and
// the nonce is how a second task closed by this same sub-agent becomes visible to the engine.
function oneAgentBlock(task) {
  const L = [];
  if (task.writesTo) {
    L.push(`- **Writes:** \`${task.writesTo}\` — no other task may be running against this artifact. A task with a`
      + " DIFFERENT `writesTo` (or an empty one) may run beside this one; one with the same must not."
      // "No other task may be RUNNING against this artifact" is satisfied by one agent taking a page's chunks one
      // after another, so the sequential case is stated rather than left to be inferred.
      + " The NEXT task on this artifact goes to a DIFFERENT sub-agent — sequential is not permission to keep"
      + " this one; finishing yours and picking up the next chunk of the same page is the violation.");
  } else {
    L.push("- **Writes:** nothing — read-only. It may run beside any task it does not depend on.");
  }
  if (task.dependsOn?.length) {
    const deps = task.dependsOn.map((d) => "`" + d + "`").join(" · ");
    L.push(`- **Depends on:** ${deps} — each must read \`done\` before`
      + " this starts. Read their `## Notes` first: what they answered on the stand is not repeated here.");
  }
  L.push("- **One sub-agent, one task:** do not pick up another task file in this session. Before finishing, copy"
    + " the **dispatch token** your orchestrator handed you when it started THIS task into `agentNonce:` above,"
    + " verbatim. Do not invent one: the engine issued that token to this task alone, and a task closed carrying"
    + " a different token — or none — is reported as closed by a context it was never handed to. If you were not"
    + " given a token, you were not dispatched through the engine: stop and say so rather than minting a value.");
  return L;
}

// How a task closes, in the file the sub-agent is handed. The status word is deliberately absent: one word over
// N deliverables cannot record a partial build, and a word the agent never writes cannot be overwritten.
// A REPAIR task closes the same way — its rows are one verify round's rather than the plan's, but they are rows
// with an outcome each, and the sub-agent reading both kinds of file is held to ONE closing contract.
function outcomeBlock(repair = false) {
  if (repair) {
    return [
      "- **How you close this task:** fill the `Outcome` cell of EVERY row below, exactly as a build task does."
        + " Do **not** set `status:` — the engine computes it from those cells. The two exceptions are `blocked`"
        + " and `n/a`: those you DO write, and the engine never computes over them.",
      `  - \`${O_BUILT}\` — the row is on the stand now.`,
      `  - \`${O_NOT_BUILT} — <cause>\`, cause being one of ${NOT_BUILT_CAUSES.map((c) => "`" + c + "`").join(" · ")}`
        + " — you could not fix it. Say what it is waiting on under `## Notes`, against the row number.",
      `  - \`${O_NA} — <reason>\` — an approved boundary, and the reason says who approved it. It is not yours to`
        + " assert: a row open because the PLAN is wrong is a proposal under `## Notes`, not a row you close here.",
      "- **A row you fix is `built`, a row you cannot is `not-built`, and a cell left `—` is neither.** Every row"
        + " accounted for computes `done` and closes the rows this round covers in the task they came from; any row"
        + " left `not-built` or unaccounted computes `partial`, and those rows alone go to the next repair round.",
    ];
  }
  return [
    "- **How you close this task:** fill the `Outcome` cell of EVERY row below. Do **not** set `status:` — the"
      + " engine computes it from those cells and overwrites whatever the front matter says. The two exceptions"
      + " are `blocked` and `n/a`: those you DO write, and the engine never computes over them. Use `blocked` to"
      + " halt the run (it stops the tasks that depend on this one) and `n/a` when the whole task does not apply,"
      + " each with the reason under `## Notes`.",
    `  - \`${O_BUILT}\` — it is on the stand.`,
    `  - \`${O_NOT_BUILT} — <cause>\`, cause being one of ${NOT_BUILT_CAUSES.map((c) => "`" + c + "`").join(" · ")}`
      + " (`blocked` = the stand or a service was unreachable and a re-run may clear it; `needs-decision` ="
      + " anything only a person can settle — no Freedom equivalent, a scope question, a check you cannot run)."
      + " Put the reason under `## Notes` against the row number — the cell takes the token only, because a reason"
      + " with pipes in it breaks the table.",
    `  - \`${O_NA} — <reason>\` — an approved boundary: nothing to build, and the reason says who approved it. The`
      + " reason is REQUIRED: an `n-a` without one counts as `not-built`, because a row closed without being built"
      + " and without a reason is a skip nobody can check.",
    "- **A cell left `—` is not a built row.** It is a row nobody accounted for, and it counts against this task"
      + " exactly as `not-built` does. Every row `built` or `n-a` computes `done`; any row `not-built` or unaccounted"
      + " computes `partial`. `partial` does NOT hold up the tasks that depend on this one — it holds up calling the"
      + " RUN complete, and each unbuilt row is named to the user by the engine.",
  ];
}

export function renderTaskFile(task, set = {}) {
  const naNote = task.naRows ? `, ${task.naRows} N/A` : "";
  const body = [
    ...renderFrontMatter(task, set),
    "",
    `# ${task.step ?? task.order}. ${task.pageKey} · ${task.group}`,
    "",
    ...(task.kind === REPAIR_KIND ? [
      // WHERE THE ROWS CAME FROM decides the first move: a row `--verify` could not find may be built and unrecorded,
      // a row the previous agent wrote down as not built is one somebody already tried and stopped at.
      `> REPAIR — round ${task.repairRound} of at most ${REPAIR_ROUND_CAP}. ${String(task.cause).startsWith("not-built:")
        ? "These rows were recorded as NOT BUILT by the agent that built the page — read what it wrote in the"
          + "\n> table below before you start."
        : "These rows were left OPEN by a `--verify`\n> run against the page as it is NOW."}`
        + " They are not new plan work, and the plan has not changed. Fix exactly",
      "> these rows on the page this task names. If a row is open because the plan is WRONG rather than the build,",
      "> that is a proposal to the user under `## Notes` — never a plan edit and never a row you close by asserting",
      "> it. There is no spec slice here on purpose: the deliverable is the failing row, not the page's whole design.",
    ] : [
      "> One task of an APPROVED migration plan. Build ONLY what is listed here — a deliverable that looks wrong is a",
      "> proposal to the user, never a silent change (record it under `## Notes` and build the plan as written).",
    ]),
    "",
    `- **Page key:** \`${task.pageKey}\``,
    `- **Build order:** ${task.step ?? task.order} — leaf-first; a child page's form exists before the parent list that opens it`,
    `- **Rows:** ${task.rows.length} (${task.gatedRows} machine-checked by \`--verify\`${naNote})`,
    ...outcomeBlock(task.kind === REPAIR_KIND),
    ...oneAgentBlock(task),
    "",
    ENGINE_BODY_HEADING,
    "",
    "<!-- ENGINE-OWNED except the `Outcome` column, which is YOURS and is carried across re-runs. -->",
    "",
    ...renderRowTable(task.rows, task.kind === REPAIR_KIND),
    "",
    NOTES_HEADING,
    "",
    NOTES_GUIDANCE,
    "",
    task.notes.trim(),
    "",
  ].join("\n");
  return endWithOneBlankLine(body);
}

// Reading a task file back. Deliberately tolerant about WHITESPACE and strict about VALUES: a `status` this file
// does not recognise is returned as-is and reported, never coerced into `todo` (a mistyped status that silently
// read as "not done" would re-dispatch a sub-agent onto a page that is already built).
export function parseTaskFile(text) {
  const meta = {};
  const lines = String(text).split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { meta, notes: "", malformed: "no front matter" };
  let i = 1;
  for (; i < lines.length && lines[i].trim() !== "---"; i++) {
    const m = /^\s*([A-Za-z][A-Za-z0-9]*):(.*)$/.exec(lines[i]);
    if (m) meta[m[1]] = m[2].trim();
  }
  if (i >= lines.length) return { meta, notes: "", malformed: "front matter is not terminated" };
  const body = lines.slice(i + 1);
  const table = tableRows(body);
  return { meta, notes: notesOf(body), rowCount: countDeliverableRows(body),
    outcomes: outcomesOf(body), table, malformed: null };
}

// The key an outcome is filed under: the deliverable's own text, whitespace-normalized and NOT truncated.
// NOT `structuralKey`, which slices to 60 characters — two deliverables of one task routinely share that prefix,
// so both would file under one key and the second would overwrite the first.
// Position keying would detach a mark as soon as a row is inserted above it. Identical labels are disambiguated
// by occurrence number, which holds while the duplicates keep their relative order.
const rowKeys = (labels) => {
  const seen = new Map();
  return labels.map((label) => {
    const base = String(label || "").trim().toLowerCase().replace(/\s+/g, " ");
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return n ? `${base}::${n}` : base;
  });
};

// The agent's cells read back off the rendered table, so a mark survives a re-slice that reorders rows.
// An unrecognised outcome is dropped rather than guessed: the row then reads unaccounted, which can only hold a
// task open, never close one.
function outcomesOf(bodyLines) {
  const rows = tableRows(bodyLines);
  const keys = rowKeys(rows.map((r) => r.label));
  const out = new Map();
  rows.forEach((r, i) => { if (r.label && r.mark) out.set(keys[i], r.mark); });
  return out;
}

// Split a rendered table line on UNESCAPED pipes only, so a `\|` inside a caption stays part of its cell instead
// of shifting every index after it.
const tableCells = (line) => line.split(/(?<!\\)\|/);

// WHICH COLUMN IS WHICH, read off the header the engine wrote rather than assumed. Two table shapes carry an
// `Outcome` column and put the deliverable in different places — `| # | From | Deliverable | Closed by | Outcome |`
// for a plan task, `| # | Deliverable | What was recorded | Evidence behind it | Outcome |` for a repair one — and
// reading a repair row at the plan's positions files the outcome under the wrong deliverable.
// A header with NO `Outcome` column yields no marks at all, and the file stands on its recorded status.
// NO header at all falls back to the PLAN positions: on a plan table they keep the agent's cells, on a repair
// table they land on the wrong column so nothing parses as a mark and that file stands on its recorded status
// too. Neither shape reads a mark out of the wrong cell.
const PLAN_LABEL_COL = 3, PLAN_OUTCOME_COL = 5;
function headerColumns(lines) {
  for (const line of lines) {
    const cells = tableCells(line);
    if (cells.length < 3 || cells[1].trim() !== "#") continue;
    const at = (name) => cells.findIndex((c, i) => i > 1 && c.trim().toLowerCase() === name);
    return { label: at("deliverable"), outcome: at("outcome") };
  }
  return { label: PLAN_LABEL_COL, outcome: PLAN_OUTCOME_COL };
}

// The rendered table read back in ORDER, so the read-only path (`--verify`) sees the same rows and numbers the
// sub-agent saw and can name the unbuilt deliverable.
function tableRows(bodyLines) {
  const out = [];
  // Scoped to the Deliverables section. `## Notes` is the agent's, and agents write tables in it whose rows carry
  // enough cells to look like a deliverables row; reading those would compute a status from a table the engine
  // never wrote. A body carrying neither heading yields nothing.
  const from = bodyLines.findIndex((l) => l.trim() === ENGINE_BODY_HEADING);
  if (from < 0) return out;
  const rest = bodyLines.slice(from + 1);
  const to = rest.findIndex((l) => l.trim() === NOTES_HEADING);
  const lines = to < 0 ? rest : rest.slice(0, to);
  const col = headerColumns(lines);
  if (col.label < 0 || col.outcome < 0) return out;
  for (const line of lines) {
    // Five cells, the first a bare ordinal.
    const cells = tableCells(line);
    if (cells.length <= col.outcome + 1 || !/^\s*\d+\s*$/.test(cells[1])) continue;
    // THE OUTCOME IS THE LAST COLUMN AND THE ONE THE AGENT HAND-TYPES. Escaping it on write does not help a cell
    // already in the file with a raw `|` in its reason, and reading the outcome cell alone truncates the reason
    // there while the row still parses as a validly-reasoned mark. Everything from that column up to the trailing
    // empty cell IS the outcome, so rejoining puts a typed pipe back; `uncell` undoes the escaping the engine
    // writes on its own re-render.
    const outcome = cells.slice(col.outcome, -1).join("|");
    out.push({ label: uncell(cells[col.label].trim()), mark: parseOutcome(uncell(outcome.trim())) });
  }
  return out;
}

// Split a mark at its separator: the FIRST dash carrying whitespace on both sides. `not-built` and `n-a` carry
// their own hyphens, which is why the whitespace is what makes a dash a separator rather than part of the word.
// SCANNED, NOT MATCHED. Every regex for this shape puts two unbounded whitespace quantifiers around one
// character (`\s+[—-]\s+`, or `\s+` beside a `[\s\S]*` tail), and each whitespace RUN can then be re-divided on
// failure — super-linear on a cell of spaces, which is a customer's Classic caption and not the engine's to
// trust. One left-to-right pass has nothing to re-divide.
const IS_WS = /\s/;
function splitMark(s) {
  for (let i = 1; i < s.length - 1; i++) {
    if (s[i] !== "—" && s[i] !== "-") continue;
    if (!IS_WS.test(s[i - 1]) || !IS_WS.test(s[i + 1])) continue;
    return { head: s.slice(0, i).trim(), detail: s.slice(i + 1).trim() };
  }
  return { head: s, detail: "" };
}

// `built` · `not-built — cause` · `n-a — reason`. A plain hyphen is accepted as well as the rendered em dash.
function parseOutcome(raw) {
  if (!raw || raw === "—") return null;
  const { head, detail } = splitMark(String(raw).trim());
  const kind = head.toLowerCase();
  if (!ROW_OUTCOMES.includes(kind)) return null;
  if (kind === O_BUILT) return { outcome: kind, cause: null, reason: "", text: raw };
  // `n-a` CLOSES A ROW WITHOUT BUILDING IT, so it carries the same burden the task-level `n/a` does: the reason is
  // what earns it. Without one it is a self-certified skip, and it is counted as `not-built` rather than as an
  // accounted row — otherwise the word that means "nothing to build here" becomes a way to compute `done` over
  // work nobody did.
  if (kind === O_NA) {
    if (detail) return { outcome: kind, cause: null, reason: detail, text: raw };
    return { outcome: O_NOT_BUILT, cause: CAUSE_NEEDS_DECISION, reason: "", text: raw, naNoReason: true };
  }
  // A `not-built` with no recognised cause still counts as not built, and routes to a human because it cannot be
  // routed otherwise. Dropping it would turn an admission back into an empty cell.
  const cause = NOT_BUILT_CAUSES.includes(detail.toLowerCase()) ? detail.toLowerCase() : CAUSE_NEEDS_DECISION;
  return { outcome: kind, cause, text: raw };
}

// HOW MANY DELIVERABLES an adopted file lists. The engine never parses an orchestrator-authored body into `rows`,
// so without this the index reported `0` for a repair task carrying two — and a repair row reading `0` is one the
// user is invited to skip. Counted off the rendered table's leading ordinal column, which every row of both table
// shapes starts with; a file whose body has no such table reports null and the index shows `—`, not `0`.
function countDeliverableRows(bodyLines) {
  let count = 0;
  for (const line of bodyLines) {
    if (/^\s*\|\s*\d+\s*\|/.test(line)) count++;
  }
  return count > 0 ? count : null;
}

// Only the engine's OWN guidance line is stripped. Dropping every `<!-- … -->` line took the caller's comments
// with it, and a note is exactly where someone records a caveat about what they built.
function notesOf(bodyLines) {
  const at = bodyLines.findIndex((l) => l.trim() === NOTES_HEADING);
  if (at < 0) return "";
  return bodyLines.slice(at + 1).filter((l) => l.trim() !== NOTES_GUIDANCE).join("\n").trim();
}

// ---8<--- THE INDEX (DERIVED) ---8<---

const STATUS_MARK = new Map([
  [S_DONE, "✅ done"],
  [S_BLOCKED, "⛔ blocked"],
  [S_IN_PROGRESS, "▶ in-progress"],
  [S_NA, "— n/a"],
  [S_TODO, "☐ todo"],
  [S_PARTIAL, "◐ partial"],
]);
// An unrecognised status is shown as itself and counted as neither done nor open.
const statusMark = (s) => STATUS_MARK.get(s) || `⚠ ${s}`;

// `Step` is the position in the QUEUE, which is not the same fact as a task file's `order` field: an
// orchestrator-authored file is never rewritten, so the `order` it declared for itself stands even where the queue
// puts it. Naming the column `#` invited reading the two as one number.
// `Writes` is in the table because the orchestrator's parallelism rule reads off it: two tasks may be dispatched
// at once only when this column differs between them. A blank cell is a read-only task.
// `Dispatched` answers ONE question — was a sub-agent sent out for this task — in the MAIN table rather than in a
// paragraph below it. It carries no duration: an elapsed time is noise beside that fact, and a cell with no clock
// value in it is also a cell that cannot make the derived index differ between two regenerations.
const DISPATCH_MARK = new Map([["yes", "✔ yes"], ["started", "▶ started"], ["never", "⚠ never"], ["pending", "—"]]);

function indexRows(tasks) {
  const L = ["| Step | Task | Page | Writes | Status | Dispatched | Rows | File |", "| --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const t of tasks) {
    const gatedNote = t.gatedRows ? ` (${t.gatedRows} gated)` : "";
    // An adopted file's rows are counted off the file, because the engine never parsed them into `t.rows`.
    const rows = t.origin === TASK_ORIGIN_ORCHESTRATOR
      ? (t.adoptedRowCount ?? "—")
      : `${t.rows.length}${gatedNote}`;
    const mark = t.unread ? "⚠ unread" : statusMark(t.status);
    const writes = t.writesTo ? `\`${t.writesTo}\`` : "— read-only";
    const gate = t.stopGate ? " ⏸ stop-gate" : "";
    const disp = DISPATCH_MARK.get(t.dispatched) || "—";
    L.push(`| ${t.step ?? t.order} | ${t.group}${gate} | \`${t.pageKey}\` | ${writes} | ${mark} | ${disp} | ${rows} | [${t.file}](${t.file}) |`);
  }
  return L;
}

function taskAttention(t) {
  const out = [];
  if (t.unread) return out;   // its own refusal line already names the file; nothing here was recorded by anyone
  if (!TASK_STATUSES.includes(t.status)) {
    out.push(`- \`${t.file}\` — unrecognised status \`${t.status}\`: use one of ${TASK_STATUSES.join(" / ")}`);
  } else if (t.drifted) {
    // `partial` is computed from the cells, never recorded, so "was recorded against" would name the wrong author.
    // A COMPUTED STATUS GETS A DIFFERENT REMEDY. Re-opening as `status: todo` clears a RECORDED status, but
    // `computeStatus` honours a recorded value only for `n/a` and `blocked` — a `partial` hand-set back to `todo`
    // recomputes straight to `partial` again. What clears it is re-checking the cells or emptying `rowsDigest:`.
    if (t.status === S_PARTIAL) {
      out.push(`- \`${t.file}\` — computes \`partial\` from outcome cells recorded against an OLDER set of`
        + " deliverables; re-check those cells against the rows now in the file. Re-opening it as `status: todo`"
        + " will NOT clear this — the status is computed from the cells, so it comes straight back. Update the"
        + " cells, or empty the stale `rowsDigest:` line once you have re-checked them.");
      return out;
    }
    const what = t.status === S_DONE
      ? "recorded `done`, but the plan's deliverables for it have CHANGED since"
      : `status \`${t.status}\` was recorded against an OLDER set of deliverables`;
    out.push(`- \`${t.file}\` — ${what}; re-check it against the rows now in the file. This clears when the task is`
      + " re-opened (`status: todo`) or when the stale `rowsDigest:` line is emptied — a status re-recorded over the"
      + " held digest keeps the warning, deliberately: the engine cannot tell a re-checked task from an unchanged one.");
  }
  return out;
}

// ONE SUB-AGENT PER TASK, CHECKED OUTSIDE THE LOOP THAT COULD BREAK IT. The orchestrator composes the prompt and
// reads the reply, so it cannot also be the proof that it dispatched one sub-agent per task — in testing it was
// the orchestrator that grouped tasks. A nonce the sub-agent mints for itself is evidence neither of them controls:
// the same value on two files is one sub-agent that closed both, which is the violation, stated with the files.
function nonceAttention(tasks) {
  // Only a CLOSED task makes a claim about who built it. A `todo` task has not been handed to anyone and an
  // `in-progress` one may not have finished writing its own file yet, so neither is missing anything.
  const closed = tasks.filter((t) => !t.unread && (t.status === S_DONE || t.status === S_PARTIAL));
  const byNonce = new Map();
  const silent = [];
  for (const t of closed) {
    const n = (t.agentNonce || "").trim();
    if (!n) { silent.push(t); continue; }
    if (!byNonce.has(n)) byNonce.set(n, []);
    byNonce.get(n).push(t);
  }
  const out = [];
  for (const [nonce, ts] of byNonce) {
    if (ts.length < 2) continue;
    out.push(`- \`agentNonce: ${nonce}\` is on ${ts.length} task files — ${ts.map((t) => "`" + t.file + "`").join(" · ")}`
      + " — so ONE sub-agent closed them all. The contract is one sub-agent per task: re-check every one of those"
      + " files against the page as it is now, because what a single session reported for several tasks was not"
      + " built under the contract the tasks were written for.");
  }
  // AN EMPTY NONCE IS THE CHEAPER EVASION, and reporting only duplicates would miss it entirely: the session that
  // closed ten tasks at once leaves ten blank fields and raises nothing. A `done` task therefore has to CARRY the
  // mark, not merely avoid sharing one — absence is not evidence of compliance, it is the absence of evidence.
  if (silent.length) {
    out.push(`- ${silent.length} task(s) recorded \`done\` with NO \`agentNonce\` — ${silent.map((t) => "`" + t.file + "`").join(" · ")}`
      + " — so nothing says which sub-agent closed them, and one session closing several tasks looks exactly like"
      + " this. Each task file asks the sub-agent that builds it to mint the value; a closed task without one has"
      + " not shown that the one-sub-agent-per-task contract held for it.");
  }
  return out;
}

// WHAT A FAILED SIGNATURE WAS CARRYING. Three cases, each naming what the engine can actually tell the caller.
function signatureCarried(s) {
  if (s.owner) return `the token issued for \`${s.owner}\`, so the context that closed this task was the one dispatched for THAT one`;
  return s.got ? "a value dispatch never issued" : "NOTHING";
}

// A review is read-only and names its builders in `dependsOn`, so a signature belonging to one of them is the
// verdict being filed by the work's own author.
function signatureIsSelfReview(s) {
  return !!s.owner && !s.task.writesTo && (s.task.dependsOn || []).includes(s.owner);
}

// The dispatch findings, in the order their remedies differ: rebuild, read the reason, write one, re-run the
// mode, re-dispatch. Kept apart from `attentionLines` so neither grows a branch the other has to carry.
function dispatchAttention(dispatch) {
  const out = [];
  for (const t of dispatch?.never || []) {
    out.push(`- \`${t.file}\` — recorded \`${t.status}\` but never STARTED through \`--tasks --start ${t.id}\`, so no`
      + " sub-agent was dispatched for it through the engine and its duration was never measured. For a review task"
      + " this is the thing the task exists to prevent: a verdict filed by the context that did the work is not a"
      + " verdict. Re-open it (`status: todo`), start it, and hand it to its own sub-agent.");
  }
  for (const t of dispatch?.naUndispatched || []) {
    out.push(`- \`${t.file}\` — recorded \`n/a\` with no dispatch record. That does NOT fail the gate: a row that`
      + " does not apply is closed without a sub-agent, and its `## Notes` carry the reason. Read the reason.");
  }
  for (const t of dispatch?.naNoReason || []) {
    out.push(`- \`${t.file}\` — recorded \`n/a\` with no dispatch record AND nothing under \`## Notes\`. The reason`
      + " is what earns an `n/a` its exemption from the dispatch gate, so without one this is a task closed with"
      + " neither a builder nor a justification. Write why it does not apply, or re-open and build it.");
  }
  for (const t of dispatch?.openClock || []) {
    out.push(`- \`${t.file}\` — recorded \`${t.status}\` while its clock is STILL OPEN, so the folder's books are`
      + " behind rather than wrong. Re-run `--tasks` on this folder: that closes the clock and records the sample.");
  }
  for (const s of dispatch?.signature || []) {
    const review = signatureIsSelfReview(s)
      ? " This is a review task signed by a builder of the very work it judges — a verdict filed by the context"
        + " that did the work is not a verdict, and that is the whole reason this task is separate."
      : "";
    out.push(`- \`${s.task.file}\` — closed carrying ${signatureCarried(s)}.${review} Re-open it (\`status: todo\`), \`--start\` it,`
      + " and hand the token that prints to a sub-agent of its own.");
  }
  return out;
}

function attentionLines(set) {
  const out = set.tasks.flatMap(taskAttention);
  // Reported per DELIVERABLE, not per task: the row and its cause are the fact a reader needs.
  // An `n-a` the agent asserted on a row the PLAN did not mark as a boundary. It closes the row without building
  // it and without the plan's backing, so it is named even though the task computes `done`.
  for (const it of assertedBoundaryRows(set.tasks)) {
    out.push(`- \`${it.task.file}\` row ${it.n} — recorded \`n-a\` on a row the plan did NOT mark N/A:`
      + ` ${it.row.label} (reason given: ${it.row.outcomeReason}). Nothing was built for it; confirm the boundary.`);
  }
  for (const it of notBuiltOpenItems(set.tasks)) {
    let why;
    if (it.row?.naNoReason) why = "recorded `n-a` with NO reason — a row closed without building it needs one, so it counts as not built";
    else if (it.cause) why = `cause \`${it.cause}\`${RETRYABLE_CAUSES.has(it.cause) ? " — a re-run may clear it" : " — a decision settles it, not a re-run; route it once that decision exists"}`;
    else why = "NOT ACCOUNTED FOR — the task recorded a closing status without marking this row either way";
    // The reason belongs under `## Notes` against the row number; a `not-built` row on a task with empty notes
    // has recorded the fact and not the reason. Same shape as the `n/a`-with-no-reason line the dispatch gate raises.
    const where = (it.task.notes || "").trim()
      ? "The detail is under that file's `## Notes`."
      : "⚠ That file's `## Notes` is EMPTY — the row is recorded as not built with no reason written anywhere.";
    out.push(`- \`${it.task.file}\` row ${it.n} — **not built**: ${it.row.label} (${why}). ${where}`);
  }
  // CLOSED WITHOUT EVER BEING DISPATCHED. The engine cannot see WHICH context closed a task, but it can see that
  // nobody asked it to start one. Reported, never coerced: the status stands as recorded.
  out.push(...nonceAttention(set.tasks), ...dispatchAttention(set.dispatch));
  // A plan row nobody is scheduled to build, and an item whose work has left the plan. Both come from meeting a
  // FROZEN split with a plan that moved, and neither is the engine's to resolve — which item a new row belongs to
  // is exactly the judgement the split file records.
  for (const p of set.problems || []) out.push(`- ${p}`);
  for (const b of set.blocked || []) {
    out.push(`- \`${b.file}\` — NOT READ and NOT WRITTEN: ${b.reason}. Its task got no file this run, and this file was`
      + " left exactly as it is — it may hold the only record of work already done on the stand. Fix its front matter"
      + " (or move it aside) and re-run.");
  }
  for (const s of set.stale || []) {
    out.push(`- \`${s.file}\` — no longer in the plan (kept, not deleted: it may record work already done on the stand)`);
  }
  return out;
}

function countStatuses(tasks) {
  const counts = { done: 0, open: 0, partial: 0, other: 0 };
  for (const t of tasks) {
    if (t.unread) counts.other++;
    else if (t.status === S_DONE) counts.done++;
    // Counted in its own bucket: folded into `open` it reads as work still queued, folded into `other` it sits
    // behind a word meaning "unrecognised".
    else if (t.status === S_PARTIAL) counts.partial++;
    else if (OPEN_STATUSES.has(t.status)) counts.open++;
    else counts.other++;
  }
  return counts;
}

// Every unbuilt deliverable by name, generated from the cells rather than summarised. Each item carries its
// task, row and cause; the cause says where it goes. Nothing is re-dispatched automatically.
// Rows the agent closed as `n-a` where the plan carries no `na` of its own. The plan's own boundaries are approved
// and silent; these are the agent's assertion that there was nothing to build, which is a claim someone should see.
// MERGE PATH ONLY — the discriminator is the plan's `r.na`, which only a plan-derived row carries. `readTaskDir`
// builds its rows from the task FILE, so every row there reads `na`-less and every `n-a` would look asserted.
// Call this on a merged set (`syncTaskDir` / `mergeTaskSet`), never on `readTaskDir` output.
export function assertedBoundaryRows(tasks) {
  const out = [];
  for (const t of tasks || []) {
    if (t.unread) continue;
    (t.rows || []).forEach((r, i) => {
      if (r.outcomeKind === O_NA && !r.na) out.push({ task: t, row: r, n: i + 1 });
    });
  }
  return out;
}

export function notBuiltRows(tasks) {
  const out = [];
  for (const t of tasks || []) {
    if (t.unread || t.status !== S_PARTIAL) continue;
    (t.rows || []).forEach((r, i) => {
      if (r.outcomeKind === O_NOT_BUILT) out.push({ task: t, row: r, n: i + 1, cause: r.outcomeCause, residual: r.residual || null });
      else if (!r.outcome) out.push({ task: t, row: r, n: i + 1, cause: null, residual: r.residual || null });
    });
  }
  return out;
}

// The residual of a `partial` task is ordinary repair work, so it goes through the SAME machinery a `--verify`
// miss does — grouped by (page, cause), merged into one task per cause, capped at `REPAIR_ROUND_CAP` rounds and
// parked after them. Shaped as `renderVerify`'s `pages` map because that is what `buildRepairTasks` reads.
// ONE ENTRY PER DELIVERABLE, whatever recorded it. A row is open work in the round that failed it AND in the task
// it came from, whose cell keeps reading `not-built` for as long as it stands. The LATEST round to have recorded
// it wins — that is the evidence the next agent reads; the task it came from is round 0.
function latestPerDeliverable(items) {
  const best = new Map();
  for (const it of items) {
    const k = `${it.task.pageKey} ${coverKey(it.row.label)}`;
    const round = it.task.repairRound || 0;
    if (best.has(k) && best.get(k).round >= round) continue;
    best.set(k, { round, it });
  }
  return [...best.values()].map((x) => x.it);
}

// THE ONE LIST OF WHAT IS STILL NOT BUILT, shared by everything that routes or reports it. A row a round has
// SETTLED is on the stand and is neither routed again nor named again — its own Outcome cell keeps reading
// `not-built` by design, so a surface reading `notBuiltRows` raw prints a deliverable that is finished, and a
// list a reader learns to distrust is worse than no list.
export const notBuiltOpenItems = (tasks) =>
  latestPerDeliverable(notBuiltRows(tasks).filter((it) => it.residual !== "closed"));

export function notBuiltOpenRows(tasks) {
  const items = notBuiltOpenItems(tasks);
  const pages = {};
  for (const it of items) {
    const key = it.task.pageKey;
    if (!pages[key]) pages[key] = { openRows: [] };
    pages[key].openRows.push({
      deliverable: it.row.label,
      outcome: O_NOT_BUILT,
      // What the agent wrote in the Outcome cell, verbatim, and where it wrote it. A blank cell is a row the task
      // closed without accounting for, which the repair round has to be told rather than left to infer.
      status: it.row.outcome || "left blank — the task closed without accounting for this row",
      evidence: `recorded on ${it.task.file}, row ${it.n}`,
    });
  }
  return pages;
}

// The two legs, deduped on the same key: both can hold one deliverable — the agent recorded it not built AND
// `--verify` could not find it — and a round's table carries it once.
// THE RESIDUAL WINS. The build agent's record names a CAUSE and points at its `## Notes`; the verifier's says only
// that nothing is on the stand, which a row nobody built implies anyway. It also decides the lineage sentence the
// repair file opens with, and a row somebody tried and stopped at calls for a different first move than one the
// verifier could not find. Taken as named legs rather than argument order, which is not a place to put a rule.
const mergePages = ({ residual = {}, verified = {} }) => {
  const out = {};
  for (const [k, v] of [...Object.entries(residual), ...Object.entries(verified)]) {
    // FIELD-WISE, not first-leg-wins. `notBuiltOpenRows` builds an entry carrying `openRows` alone, so seeding
    // from whichever leg came first dropped a verify page's own tallies as soon as the same page also had a
    // residual row. Nothing downstream reads them today; a page entry that means different things depending on
    // which leg saw it first is a trap for whatever does.
    out[k] = { ...out[k], ...v, openRows: out[k]?.openRows || [] };
    const seen = new Set(out[k].openRows.map((r) => coverKey(r.deliverable)));
    for (const row of v.openRows || []) {
      if (seen.has(coverKey(row.deliverable))) continue;
      seen.add(coverKey(row.deliverable));
      out[k].openRows.push(row);
    }
  }
  return out;
};

// A `partial` task CLOSES WHEN ITS RESIDUAL DOES, and never by hand — the same rule as the row outcomes it was
// computed from. The residual is the repair task the row was routed to, found by the (page, cause) key
// `buildRepairTasks` groups on. A row with no repair task at all is UNROUTED: either nothing has routed it yet,
// or its cause was parked after its rounds. Either way the task stays `partial` and the gate keeps failing the
// run, which is the point — a page with a deliverable nobody built does not report success.
// Attached to an assembled set like `attachDispatch`, not folded into `mergeTaskSet`: a task's status must not
// depend on its siblings inside a function whose contract is "merge these files against this plan".
// Runs AFTER `attachDispatch`, which is what makes `t.dispatched` readable here — see the closure rule below.
// Which rows the repair tasks in this set have OPEN work against, and which they have closed. Keyed per ROW off
// `covers`: keying on the cause would credit every row that ever lands in that bucket to the first task that
// closed there — including rows recorded after it ran, which nobody has looked at.
// A row this round ACCOUNTED FOR: built, or an approved boundary with the reason that earns it. `parseOutcome`
// has already turned a reasonless `n-a` into `not-built`, so there is no self-certified skip to filter here.
const ROW_SETTLED = new Set([O_BUILT, O_NA]);

// The keys this round's own cells account for, and the keys they leave open. A row with no outcome is unsettled.
// NOT-BUILT WINS WITHIN A ROUND, and an unaccounted cell with it: `coverKey` hashes the label alone — no `::n`
// disambiguation, unlike `rowKeys` — so two rows of one table can share a key, and a `built` cell must not close
// the deliverable its twin recorded.
function rowVerdicts(t) {
  const settled = new Set(), unsettled = new Set();
  for (const r of t.rows || []) {
    (ROW_SETTLED.has(r.outcomeKind) ? settled : unsettled).add(`${t.pageKey} ${coverKey(r.label)}`);
  }
  return { settled, unsettled };
}

// What ONE round says about each row it covers, or null when it says nothing.
// A `blocked` round is NEITHER open nor closed: it ran and said why it could not proceed, nothing is scheduled
// against that row any more, and counting it as open work would let the run pass over a deliverable a second
// agent has now also failed to build.
// A CLOSURE ONLY COUNTS IF SOMEBODY WAS DISPATCHED FOR IT. A repair file is exempt from the dispatch gate
// (`adoptOrchestrated` rewrites its origin), and `--verify` re-measures the page, so that exemption costs the
// machine-checked lineage nothing. A `not-built` row is re-measured by nobody: its ONLY evidence is the repair
// task's own record, so without this the whole gate clears by typing into the file one over.
// Which of the keys a round covers it has SETTLED.
// NOTHING RECORDED IN THE CELLS AT ALL means the status word is the only account there is — a file carrying no
// `Outcome` column, or one whose agent filled none of it — and the round is read WHOLE off that word, which
// speaks for every row it covers. The same guard `computeStatus` applies, so the two cannot disagree about which
// record they are reading.
function settledCovers(t, credits) {
  const coveredKeys = () => new Set((t.covers || []).map((c) => `${t.pageKey} ${c}`));
  if (!(t.rows || []).some((r) => r.outcome)) return CLOSED.has(t.status) ? coveredKeys() : new Set();
  if (!credits) return new Set();
  const { settled, unsettled } = rowVerdicts(t);
  const out = new Set();
  for (const k of settled) if (!unsettled.has(k)) out.add(k);
  return out;
}

function roundCoverage(t) {
  if (t.kind !== REPAIR_KIND || t.status === S_BLOCKED) return null;
  const credits = t.dispatched === "yes";
  if (CLOSED.has(t.status) && !credits) return null;
  const closed = settledCovers(t, credits);
  const round = t.repairRound || 1;
  // A ROW THE CAP HAS EXHAUSTED IS NOT OPEN WORK. The last round ran and did not settle it, and `buildRepairTasks`
  // PARKS the (page, kind) rather than writing a fourth — so nothing is scheduled against that row ever again.
  // Said as its OWN state rather than by staying silent: silence leaves an earlier round's `open` standing, and
  // `open` reads as scheduled work and clears the gate over a deliverable nobody built. Same end state as a
  // `blocked` round, which is excluded for the same reason; parking is otherwise only a line on stdout.
  const unsettledState = round >= REPAIR_ROUND_CAP && ROUND_ATTEMPTED.has(t.status) ? "parked" : "open";
  // `covers` is the authoritative list: a row deleted from the body is not a row that was built.
  const states = new Map();
  for (const c of t.covers || []) {
    const k = `${t.pageKey} ${c}`;
    states.set(k, closed.has(k) ? "closed" : unsettledState);
  }
  return { round, states };
}

function repairCoverage(tasks) {
  // THE LATEST ROUND TO SPEAK ABOUT A ROW IS THE AUTHORITY. A round that could not fix a row keeps `not-built` in
  // its own cell after the NEXT round fixes it, so an earlier open mark never overrules a later closure. At equal
  // rounds `open` wins: two rounds of one number are concurrent work, and the row is not finished while either
  // still has it.
  const latest = new Map();
  const say = (key, round, state) => {
    const prev = latest.get(key);
    if (!prev || round > prev.round || (round === prev.round && state === "open")) latest.set(key, { round, state });
  };
  for (const t of tasks || []) {
    const round = roundCoverage(t);
    if (!round) continue;
    for (const [key, state] of round.states) say(key, round.round, state);
  }
  // `parked` reads as NO residual: the row is not scheduled anywhere, so every surface that asks "is this routed"
  // gets the same answer it gets for a row nothing ever routed — the gate fails and the user is told.
  return (key) => {
    const state = latest.get(key)?.state;
    return !state || state === "parked" ? null : state;
  };
}

function resolvePartials(set) {
  const residualOf = repairCoverage(set.tasks);
  for (const t of set.tasks || []) {
    // A REPAIR round is resolved too: its unfixed rows open the NEXT round, and its own cells keep reading
    // `not-built` after that round fixes them, so it closes on its residual like any other task.
    // `REPAIR_ROUND_CAP` bounds the chain; a row it never reaches is PARKED and goes to the user.
    if (t.status !== S_PARTIAL || t.unread) continue;
    let residuals = 0, settled = 0;
    for (const r of t.rows || []) {
      if (r.outcomeKind !== O_NOT_BUILT && r.outcome) continue;
      r.residual = residualOf(`${t.pageKey} ${coverKey(r.label)}`);
      residuals++;
      if (r.residual === "closed") settled++;
    }
    if (residuals && residuals === settled) t.status = S_DONE;
  }
  return set;
}

// A deliverable label is a whole paragraph on some rows. The progress block is read in a chat window, so the
// label is clipped here — the task file is named on the same line and carries it in full.
const brief = (s, n = 90) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

// No cause at all is the weaker claim of the two: nobody said anything about the row either way.
function whyNotBuilt(cause) {
  if (!cause) return "unaccounted — the task closed without recording this row";
  // BOTH causes are routed — `notBuiltOpenRows` filters on neither. What differs is what CLOSES the row: a re-run
  // for `blocked`, a person for `needs-decision`. Neither says the row cannot be scheduled.
  const tail = RETRYABLE_CAUSES.has(cause) ? " (a re-run may clear it)" : " (a decision settles it, not a re-run — route it once that decision exists)";
  return `${cause}${tail}`;
}

function notBuiltLines(tasks) {
  // The same list the routing works from, so the count the user reads is a count of DELIVERABLES still open and
  // the file named beside each one is the round that last held it.
  const items = notBuiltOpenItems(tasks);
  if (!items.length) return [];
  const L = [`⚠ NOT BUILT — ${items.length} deliverable(s) across ${new Set(items.map((x) => x.task.id)).size} task(s):`];
  for (const it of items) {
    L.push(`  · ${it.task.pageKey} · row ${it.n} ${brief(it.row.label)} — ${whyNotBuilt(it.cause)} [${it.task.file}]`);
  }
  return L;
}

// A row the agent closed as a boundary the plan did not authorise. It does NOT fail the run — that is the open
// decision this change leaves alone — but it is still a row nobody built, so it belongs on the surface the user
// reads while the run happens rather than only in a file they may never open.
function assertedBoundaryLines(tasks) {
  const items = assertedBoundaryRows(tasks);
  if (!items.length) return [];
  const L = [`ℹ ${items.length} row(s) closed as an agent-asserted boundary — nothing was built for them; confirm:`];
  for (const it of items) {
    L.push(`  · ${it.task.pageKey} · row ${it.n} ${brief(it.row.label)} — ${brief(it.row.outcomeReason, 60)} [${it.task.file}]`);
  }
  return L;
}

export function renderTaskIndex(set) {
  const counts = countStatuses(set.tasks);
  const other = counts.other ? ` · **Other:** ${counts.other}` : "";
  // Named in the headline, not only in a column — the first line is the count a reader takes away.
  const partial = counts.partial ? ` · **⚠ Partial:** ${counts.partial}` : "";
  const entityNote = set.entity ? ` — ${set.entity}` : "";
  // ENG-99192 — the frozen reconcile mode, named in the headline so the orchestrator carries it into every build
  // brief. Present only for an existing-Freedom reconcile; a rebuild renders no such line.
  const modeNote = set.reconcileMode ? ` · **Reconcile mode:** \`${set.reconcileMode}\`` : "";
  const L = [
    `# Migration build tasks${entityNote}`,
    "",
    `**Plan version:** \`${set.planVersion || "—"}\` · **Tasks:** ${set.tasks.length} · **Done:** ${counts.done} · **Open:** ${counts.open}${partial}${other}${modeNote}`,
    "",
    "> DERIVED FILE — regenerated from the task files by `migrate.mjs <manifest> --tasks <dir>`. It carries no fact",
    "> of its own: a task's OWN file records its status, so editing this table changes nothing. Run the mode again",
    "> after a status changes.",
    "",
    ...indexRows(set.tasks),
  ];
  const attention = attentionLines(set);
  if (attention.length) L.push("", "## Attention", "", ...attention);
  return L.join("\n") + "\n";
}

// ---8<--- MERGE: the caller's recorded state survives a re-run ---8<---

// `fresh` is the plan as it is NOW; `existing` is what the folder already holds. The caller's `status` and `## Notes`
// win; the engine's rows always lose to the current plan. An orchestrator-authored task is carried through
// untouched, and an engine task that left the plan becomes `stale` rather than being removed.
//
// THE ENGINE NEVER WRITES TO A FILE IT COULD NOT READ IN FULL. A file with no readable `id`, an unterminated front
// matter (a write killed halfway, or a hand edit), or an `id` that two files claim — for each of those the engine
// cannot tell WHICH task's record it is holding, and rewriting it would destroy the `## Notes` that record work
// already done on a stand. Such a file is reported by name and left byte for byte as it is; the task it was
// holding gets no file this run, which is loud, rather than a silent overwrite. `blocked` collects them.
export function mergeTaskSet(fresh, existing = []) {
  const { usable, blocked } = triageExisting(existing);
  const byId = new Map();
  for (const e of usable) byId.set(e.meta.id, e);
  const tasks = fresh.tasks.map((t) => carryOver(t, matchFor(byId, t)));
  const claimed = new Set(fresh.tasks.map((t) => t.id));
  // An orchestrator file whose `id` an engine task also claims cannot become that task's record (`matchFor`), and
  // it is not `extra` either — so it used to fall out of the index entirely: no queue row, no `## Attention` line.
  // Worse, when its name equalled the engine task's computed file name, `syncTaskDir` wrote the engine task over
  // it and destroyed its `## Notes`. It is refused instead: named on Attention and never written to.
  for (const e of usable) {
    if (claimed.has(e.meta.id) && (e.meta.origin === TASK_ORIGIN_ORCHESTRATOR || e.meta.kind === REPAIR_KIND)) {
      blocked.push({
        file: e.file,
        id: e.meta.id,
        reason: `its \`id\` \`${e.meta.id}\` is also claimed by an engine task; rename its \`id\` or move it aside`,
      });
    }
  }
  const extra = usable.filter((e) => !claimed.has(e.meta.id));
  // A file the engine does NOT re-author on a plain re-slice: one the orchestrator wrote, and one the engine wrote
  // for a REPAIR round. The repair file is engine-authored but it is not derived from the plan — its rows are what
  // one `--verify` run found open — so re-slicing has no basis to rewrite it and no business retiring it as "not
  // in the plan". It never was in the plan; it is a record of a round that happened.
  const isAdopted = (e) => e.meta.origin === TASK_ORIGIN_ORCHESTRATOR || e.meta.kind === REPAIR_KIND;
  const orchestrated = extra.filter(isAdopted).map(adoptOrchestrated);
  const stale = extra.filter((e) => !isAdopted(e)).map((e) => ({ file: e.file, id: e.meta.id }));
  const ordered = [...tasks, ...orchestrated].sort((a, b) => a.order - b.order);
  // A task whose file was refused must not appear in the queue as `todo`. It got the fresh task's default status
  // because nothing readable could be carried over — and that file may record `done`. Reading `todo` there is how
  // a sub-agent gets dispatched onto a page that is already built, which is the whole reason the status vocabulary
  // is checked in the first place.
  // Matching by FILENAME alone missed a refused file the caller renamed, or one whose page key moved (the `id` is
  // stable, the computed file name is not): the fresh task then read `todo` and a duplicate file was written beside
  // the refused one, holding a possibly `done` record. The `id` parsed before the corruption is the reliable link.
  const refused = new Set(blocked.map((b) => b.file));
  const refusedIds = new Set(blocked.map((b) => b.id).filter(Boolean));
  return {
    ...fresh,
    tasks: chainMerged(ordered).map((t, i) => ({ ...t, step: i + 1, unread: refused.has(t.file) || refusedIds.has(t.id) })),
    stale,
    blocked,
  };
}

// THE CHAIN IS RE-DERIVED OVER THE MERGED QUEUE, not carried over from the slice. `buildTaskSet` chains the tasks
// IT authored; an orchestrator task is adopted afterwards and can declare a `writesTo` of its own — a repair task
// added for a page the engine already sliced is exactly that shape. Chained only at slice time, it would sit in the
// queue writing a page body with nothing depending on it and nothing it depends on, which is the one arrangement
// the whole `writesTo` rule exists to make impossible. Chaining by QUEUE ORDER cannot produce a cycle: every link
// points backwards. Declared dependencies are kept and added to, never replaced — the orchestrator knows things
// about its own task that the engine does not.
function chainMerged(ordered) {
  // SEEN SO FAR, for the same reason `withDependencies` does it: a split may put a scaffolding item late on
  // purpose (per-type routing binds forms that must already exist), and depending on ALL of them made every
  // earlier task wait on that late one — 83 dependencies pointing forward in one real 94-item queue, which is a
  // deadlock rather than an ordering. This function is what actually writes the files, so getting it right in
  // `withDependencies` alone fixed nothing.
  const refs = [];
  const scaffolds = [];
  const writersSoFar = [];
  const lastWriter = new Map();
  return ordered.map((t) => {
    const deps = [...(t.dependsOn || [])];
    if (t.artifact !== ARTIFACT_REFS) deps.push(...refs);
    if (t.writesTo) {
      if (t.artifact !== ARTIFACT_SCAFFOLD) deps.push(...scaffolds);
      const prev = lastWriter.get(t.writesTo);
      if (prev) deps.push(prev);
      lastWriter.set(t.writesTo, t.id);
    }
    deps.push(...reviewDeps(t, writersSoFar));
    if (t.writesTo) writersSoFar.push(t);
    if (t.artifact === ARTIFACT_REFS) refs.push(t.id);
    if (t.artifact === ARTIFACT_SCAFFOLD) scaffolds.push(t.id);
    return { ...t, dependsOn: [...new Set(deps)].filter((d) => d && d !== t.id) };
  });
}

// An ENGINE task is matched only against an ENGINE file. An orchestrator file that carries an engine task's `id` —
// the natural result of copying a task file as a template for a new one — would otherwise become that task's
// record: the engine would write the plan's rows into the orchestrator's file (which rule says it never rewrites)
// and the engine task's own file, with its recorded status, would drop out of the index entirely.
function matchFor(byId, task) {
  const found = byId.get(task.id);
  if (!found) return null;
  return (found.meta.origin === TASK_ORIGIN_ORCHESTRATOR || found.meta.kind === REPAIR_KIND) ? null : found;
}

function triageExisting(existing) {
  const blocked = [];
  const readable = [];
  for (const e of existing) {
    if (!e.meta.id) blocked.push({ file: e.file, id: e.meta.id, reason: e.malformed || "no `id` in its front matter" });
    else if (e.malformed) blocked.push({ file: e.file, id: e.meta.id, reason: e.malformed });
    else readable.push(e);
  }
  const seen = new Map();
  for (const e of readable) seen.set(e.meta.id, (seen.get(e.meta.id) || 0) + 1);
  const usable = [];
  for (const e of readable) {
    if (seen.get(e.meta.id) > 1) blocked.push({ file: e.file, id: e.meta.id, reason: `its \`id\` \`${e.meta.id}\` is claimed by more than one file` });
    else usable.push(e);
  }
  return { usable, blocked };
}

// The status is computed from the rows. `recorded` is what the file says, and wins only where the rows cannot
// answer.
// NO OUTCOME RECORDED ANYWHERE MEANS NO CHANGE: a folder written before this column existed, and any task nobody
// has started, must read exactly as before. Hence a guard on "nothing recorded at all", never an inference from
// "nothing says built".
function computeStatus(task, recorded, outcomes) {
  // The two states an agent chooses deliberately are never computed over; everything else here derives from row
  // accounting.
  // `n/a` is the one closure with no builder, earned by the reason under `## Notes` that the dispatch gate reads.
  // `blocked` is the only halt an agent can reach (`build-task-execution.md` rule 5). It must keep halting:
  // `partial` releases dependents, so computing it over `blocked` would walk the queue past a deliberate stop.
  if (recorded === S_NA || recorded === S_BLOCKED) return recorded;
  // A REPAIR task is computed like any other: the engine wrote its table, so the cells mean what they mean
  // everywhere else. Only a HAND-WRITTEN orchestrator task stands on its recorded word — the engine never
  // authored that body and cannot say what its cells are.
  if (task.kind !== REPAIR_KIND && task.origin !== TASK_ORIGIN_ENGINE) return recorded;
  const rows = task.rows || [];
  if (!rows.length || !outcomes?.size) return recorded;
  const keys = rowKeys(rows.map((r) => r.label));
  const marks = rows.map((_, i) => outcomes.get(keys[i]) || null);
  if (marks.every((m) => !m)) return recorded;
  // A BLANK ROW IS CHECKED FIRST, because a task with one is not finished and no other verdict applies to it yet.
  // The agent fills cells as it goes, so a `not-built` recorded halfway through sits beside rows it has simply not
  // reached; reading that as `partial` would settle a task whose sub-agent is still running — stopping its clock,
  // releasing its dependents and demanding a dispatch record from it.
  // A blank row counts only where a CLOSING status is claimed over it; otherwise the recorded status stands.
  if (marks.some((m) => !m)) return CLOSED.has(recorded) ? S_PARTIAL : recorded;
  if (marks.some((m) => m?.outcome === O_NOT_BUILT)) return S_PARTIAL;
  return S_DONE;
}

function carryOver(task, prev) {
  if (!prev) return task;
  const outcomes = prev.outcomes instanceof Map ? prev.outcomes : new Map();
  // Cells are re-attached to the CURRENT rows before the status is computed, so only a genuinely replaced row
  // loses its mark.
  const keys = rowKeys((task.rows || []).map((r) => r.label));
  task = { ...task, rows: (task.rows || []).map((r, i) => {
    const m = outcomes.get(keys[i]);
    return m ? { ...r, outcome: m.text, outcomeKind: m.outcome, outcomeCause: m.cause,
      outcomeReason: m.reason || "", naNoReason: !!m.naNoReason } : r;
  }) };
  const recorded = prev.meta.status || task.status;
  const status = computeStatus(task, recorded, outcomes);
  // A status recorded against an older row set must not be trusted silently — the deliverables it was recorded
  // for are not the deliverables now in the file. The digest the status was recorded against is therefore KEPT in
  // the file for as long as that status stands, and only a status back at `todo` (the task re-opened) adopts the
  // current rows. Refreshing it eagerly would clear the warning on the very re-slice that should raise it.
  const held = status !== S_TODO && prev.meta.rowsDigest ? prev.meta.rowsDigest : task.rowsDigest;
  return {
    ...task,
    status,
    notes: prev.notes || "",
    file: prev.file || task.file,        // a file the caller renamed keeps its name; the id is the identity
    // The sub-agent's own mark. Carried like `status` and `## Notes` — it is the caller's record, not the
    // engine's, and rewriting it away would erase the one fact that shows a task was closed by a shared session.
    agentNonce: prev.meta.agentNonce || "",
    recordedDigest: held,
    drifted: held !== task.rowsDigest,
  };
}

// The parsed table as task rows. Same shape `readTaskDir` builds, and the shape `computeStatus`, `notBuiltRows`
// and `assertedBoundaryRows` all read.
const rowsFromTable = (table) => (table || []).map((r) => ({
  label: r.label, group: "", vk: null, na: null,
  outcome: r.mark?.text || "", outcomeKind: r.mark?.outcome || null, outcomeCause: r.mark?.cause || null,
  outcomeReason: r.mark?.reason || "", naNoReason: !!r.mark?.naNoReason,
}));

// An orchestrator task is read, not authored: the engine keeps its file and its status and only places it in the
// order. `order` may be absent or unparseable, so it sorts after every engine task rather than at the front.
function adoptOrchestrated(e) {
  const n = Number(e.meta.order);
  const label = e.meta.group || "(orchestrator task)";
  // A REPAIR file's body IS the engine's, so its rows are read and its status computed from them. A hand-written
  // orchestrator file is adopted on its recorded word alone. The discriminator is `kind:` in the front matter,
  // which a caller can type — SKILL.md forbids hand-writing a repair file, and the dispatch gate still refuses to
  // credit the rows of one nobody was sent out for.
  const repair = e.meta.kind === REPAIR_KIND;
  const rows = repair ? rowsFromTable(e.table) : [];
  const recorded = e.meta.status || S_TODO;
  return {
    id: e.meta.id, pageKey: e.meta.pageKey || "?", group: label, title: label,
    order: Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER,
    phase: DEFAULT_PHASE, origin: TASK_ORIGIN_ORCHESTRATOR,
    status: repair ? computeStatus({ origin: TASK_ORIGIN_ENGINE, kind: REPAIR_KIND, rows }, recorded, e.outcomes) : recorded,
    rows, gatedRows: 0, naRows: 0, rowsDigest: e.meta.rowsDigest || "", notes: e.notes || "",
    // The engine does not own this body, so `rows` stays empty — but the index still has to say how many
    // deliverables the file lists. Null when the file carries no readable table: the index shows `—` for that,
    // never `0`.
    adoptedRowCount: e.rowCount ?? null,
    // An orchestrator task declares its own artifact and its own nonce. Both are READ, never authored here: a
    // repair task the orchestrator added writes a page like any other task, and it must take part in the same
    // parallelism rule and the same one-sub-agent check as the engine's own.
    stopGate: e.meta.stopGate === "true",
    kind: e.meta.kind || null,
    cause: e.meta.cause || null,
    repairRound: Number(e.meta.repairRound) || null,
    // The AUTHORITATIVE list of rows this round was opened over, kept even though the table is now read: a row
    // deleted from the body would otherwise stop being open work, and deleting it is not building it.
    covers: (e.meta.covers || "").split(/\s+/).filter(Boolean),
    artifact: e.meta.writesTo || `orchestrator:${e.meta.id}`,
    writesTo: e.meta.writesTo || "",
    dependsOn: (e.meta.dependsOn || "").split(/\s+/).filter(Boolean),
    agentNonce: e.meta.agentNonce || "",
    file: e.file,
  };
}

// ---8<--- THE SPLIT: a cut decided once, validated here, and frozen ---8<---

// Same task shape as the mechanical slicer produces, so everything downstream — the file, the index, the merge,
// the repair rounds, the write chain — is unchanged. Only WHERE the seams fall is different, and that is the one
// question a row-count budget answered badly.
//
// IDENTITY IS THE ITEM'S `id`, not a hash over its contents. The mechanical slicer had to derive ids from content
// because it re-derived the whole cut on every run; a frozen split does not move, so the slug someone chose for an
// item IS its identity and survives any change to the rows inside it.
export function buildTaskSetFromSplit(result, split, opts = {}) {
  const groups = checklistGroups(result, opts);
  const identity = pageIdentities(result);
  const B = budgetOf(opts);
  const resolved = resolveSplit(split, groups, identity);
  const { emptied, added } = reconcile(resolved);
  const problems = splitProblems({ errors: resolved.errors, unplaced: resolved.unplaced, emptied });
  // A split that does not resolve is REFUSED, not partially honoured: a folder built from half a split schedules
  // some of the plan and silently drops the rest, which is the failure the coverage check exists to prevent.
  if (resolved.errors.length) return { refused: true, problems, tasks: [], planVersion: result.planVersion || null };

  const tasks = resolved.items.map((it, i) => {
    const srcRows = it.rows.map((r) => ({
      label: r.label, groupTitle: r.group, vk: r.vk, na: r.na,
      // The row's OWN page, not the item's: an item may claim a `Quality gates` row from another page, and it is
      // that page the review then has to wait for.
      rowPageKey: r.pageKey,
      weight: rowWeight(r, r.group, B),
    }));
    const task = {
      id: it.id,
      pageKey: it.pageKey,
      artifact: it.writesTo || `readonly:${it.id}`,
      writesTo: it.writesTo,
      anchor: it.id,
      stopGate: it.stopGate,
      group: it.title,
      title: it.title,
      groups: [...new Set(srcRows.map((r) => r.groupTitle))],
      // A split has no `review:` artifact, so an item that judges a page is recognised by the `Quality gates` rows
      // it carries. Read-only is the CORRECT thing for such an item — which is exactly why it needs this: with no
      // `writesTo` it joins no chain, and without the review dependency nothing would make it wait for the page.
      reviewsArtifacts: [...new Set(srcRows.filter((r) => r.groupTitle === REVIEW_GROUP)
        .map((r) => `page:${identity.get(r.rowPageKey) || r.rowPageKey}`))],
      order: i + 2,                       // the reference cache keeps position 1
      phase: DEFAULT_PHASE,
      origin: TASK_ORIGIN_ENGINE,
      status: S_TODO,
      rows: srcRows.map((r) => ({ label: r.label, group: r.groupTitle, vk: r.vk ? String(r.vk.type) : null, na: r.na || null })),
      weight: srcRows.reduce((a, r) => a + r.weight, 0),
      gatedRows: srcRows.filter((r) => r.vk).length,
      naRows: srcRows.filter((r) => r.na).length,
      rowsDigest: rowsDigest(srcRows),
      dependsOn: [],
      notes: "",
    };
    task.file = taskFileName(task);
    return task;
  });
  // The reference cache is the engine's own preparation, not a plan row, so it is never in the split and always
  // leads the queue.
  const refsChunk = chunksOf({
    artifact: ARTIFACT_REFS, pageKey: "run", identityKey: "run",
    groups: [{ pageKey: "run", baseTitle: REFS_GROUP, title: REFS_GROUP, rows: refsRows(result) }],
  }, B).map((c, i) => taskOf(c, i + 1));
  return {
    entity: result.entity || null,
    planVersion: result.planVersion || null,
    budget: B,
    split: { source: "file", items: resolved.items.length },
    problems,
    added,
    emptied,
    tasks: withDependencies([...refsChunk, ...tasks]),
  };
}

// ---8<--- REPAIR: the rows `--verify` found open, cut into tasks the same way ---8<---
//
// A REPAIR TASK IS NOT A PLAN TASK, and the difference decides everything below. A plan task is derived from the
// approved plan and is rewritten from it on every re-slice. A repair task is derived from ONE verify run: its rows
// are the rows that run found open. Re-verifying does not rewrite it — it opens a NEW ROUND — so a repair file is
// adopted on later slices rather than re-authored, and it is never retired for "not being in the plan", which it
// never was.
//
// MERGED BY (PAGE, CAUSE), because the alternative is a folder nobody walks. Nineteen fields with the wrong names
// are ONE defect with nineteen symptoms: nineteen tasks is nineteen sub-agent startups to make one edit each, and
// the orchestrator that has to schedule them will group them anyway — which is the behaviour this whole design
// removed. They are merged into one task, and split again only when the merged task outgrows the budget.
export const REPAIR_ROUND_CAP = 3;
const REPAIR_KIND = "repair";

// WHAT THE CAP COUNTS, which is not what the cause SAYS. A cause carries WHY a row is open as well as what kind
// of row it is, and the why moves between rounds: a row `--verify` could not confirm (`unverified:…`) comes back
// from the round that failed it recorded as `not-built:…`. Keyed on the whole cause that is a fresh bucket at
// round 1 and the cap never fires. The KIND is what holds, so the cap and the one-round-at-a-time rule are per
// (page, kind); the cause on the file still says where this round's rows came from.
const capKey = (pageKey, cause) => `${pageKey} ${String(cause || "").split(":").pop()}`;

// The CAUSE is what a single sub-agent can fix in one pass. `unverified` is separated from `missing` first,
// because they need opposite work: `missing` is a thing to build, `unverified` is a record to file about a thing
// that may well be there. Beyond that the kind is read off the same row shapes the weights use.
// Ordered: the FIRST pattern that matches names the cause, so a row reading both ways (a related list counted in
// a coverage row, say) lands on the more specific kind rather than on whichever test happened to run last.
const CAUSE_KINDS = [
  [/—\s*\d+\s+fields?\b|^Fields?\s+—/, "fields"],
  [/^Handler\s+—/, "handlers"],
  [/business rules/i, "rules"],
  [/related list/i, "related-lists"],
  [/template\s*→/i, "template"],
  [/^Card action/i, "card-actions"],
];
function causeOf(row) {
  const label = String(row.deliverable || "");
  const kind = CAUSE_KINDS.find(([re]) => re.test(label))?.[1] || "other";
  const outcome = row.outcome === "unverified" || row.outcome === O_NOT_BUILT ? row.outcome : "missing";
  return `${outcome}:${kind}`;
}
const CAUSE_TEXT = {
  "missing:fields": "expected fields are not on the built page",
  "missing:handlers": "ported handlers are not on the built page",
  "missing:rules": "business rules the plan expects are not on the built page",
  "missing:related-lists": "related lists the plan expects are not on the built page",
  "missing:template": "the page is not on the template the plan names",
  "missing:card-actions": "card actions the plan expects are not on the built page",
  "missing:other": "machine-checked deliverables are not on the built page",
  "unverified:fields": "the field rows could not be confirmed from what was filed",
  "unverified:handlers": "the handler rows could not be confirmed from what was filed",
  "unverified:rules": "the rule rows could not be confirmed from what was filed",
  "unverified:related-lists": "the related-list rows could not be confirmed from what was filed",
  "unverified:template": "the template row could not be confirmed from what was filed",
  "unverified:card-actions": "the card-action rows could not be confirmed from what was filed",
  "unverified:other": "machine rows could not be confirmed from what was filed",
  "not-built:fields": "fields the build agent recorded as not built",
  "not-built:handlers": "handlers the build agent recorded as not built",
  "not-built:rules": "business rules the build agent recorded as not built",
  "not-built:related-lists": "related lists the build agent recorded as not built",
  "not-built:template": "a template row the build agent recorded as not built",
  "not-built:card-actions": "card actions the build agent recorded as not built",
  "not-built:other": "deliverables the build agent recorded as not built",
};
const causeText = (cause) => CAUSE_TEXT[cause] || cause;

// The round a (page, cause) is already on, read off the files in the folder. Rounds are counted per CAUSE and not
// per run: a cause fixed in round 1 and back in round 3 has been attempted twice, which is the number the cap is
// about. A capped cause is PARKED, not silently re-emitted — three sub-agents have failed at it and a fourth is
// not the answer; it is a decision for the user.
// TWO KEYS, because the cap and the one-round-at-a-time rule are not the same question. HOW MANY attempts a page
// has had at a KIND of row is what the cap counts, so `unverified:fields` and `not-built:fields` share it — the
// why moves between rounds while the kind holds. WHETHER A ROUND IS STILL OPEN is about that CAUSE's own round,
// and sharing the key there holds a newly recorded cause behind an unrelated round: no task is written for it, so
// its rows stay unrouted, the gate keeps naming them and the remedy it prints writes nothing.
function repairRounds(existing) {
  const rounds = new Map(), openRounds = new Map();
  for (const e of existing) {
    if (e.meta?.kind !== REPAIR_KIND) continue;
    const n = Number(e.meta.repairRound) || 1;
    // COMPUTED, not read off the front matter: a round is closed by its `Outcome` cells, so a file whose agent
    // filled them and left `status: todo` has ATTEMPTED its round and the next one may open.
    const status = computeStatus({ origin: TASK_ORIGIN_ENGINE, kind: REPAIR_KIND, rows: rowsFromTable(e.table) },
      e.meta.status || S_TODO, e.outcomes);
    for (const [map, key] of [[rounds, capKey(e.meta.pageKey, e.meta.cause)],
      [openRounds, `${e.meta.pageKey} ${e.meta.cause || ""}`]]) {
      const prev = map.get(key);
      if (!prev || n >= prev.round) map.set(key, { round: n, status });
    }
  }
  return { rounds, openRounds };
}
// A ROUND IS AN ATTEMPT, NOT A VERIFY RUN. Re-verifying an unchanged page must not open a new round: the rows are
// still the work of the round already sitting in the folder, and counting verify runs would burn the cap without a
// single sub-agent having run. A new round opens only once the previous one was CLOSED and the rows came back —
// which is the repeat failure the cap is actually about. `blocked` does not auto-reopen either: a sub-agent that
// said why it could not proceed is answered by a person, not by an identical fourth task.
// `partial` counts as an attempt: the round ran and every row was accounted for. Leaving it out holds the cause
// `pending` forever — no next round, and the cap that would park it never fires.
const ROUND_ATTEMPTED = new Set([S_DONE, S_NA, S_PARTIAL]);

// Build the repair tasks one verify run calls for. `verifyPages` is `renderVerify`'s `pages` map: each entry
// carries the rows that run left open, with the text the reader saw rather than a paraphrase of it.
// What this cause gets from THIS verify run: the next round, or a reason it gets nothing. A round already open is
// still somebody's work, and a cause that has had its rounds is a decision for a person.
// `cap` is what this page has spent on this KIND of row; `own` is this CAUSE's own last round. Only `own` can
// hold a cause pending — its rows are the work of a round that is still somebody's.
function nextRound(cap, own) {
  if (own && !ROUND_ATTEMPTED.has(own.status)) return { hold: "pending", round: own.round, status: own.status };
  const round = (cap?.round || 0) + 1;
  return round > REPAIR_ROUND_CAP ? { hold: "parked", round } : { hold: null, round };
}

export function buildRepairTasks(result, verifyPages = {}, opts = {}, existing = []) {
  const B = budgetOf(opts);
  const identity = pageIdentities(result);
  const { rounds, openRounds } = repairRounds(existing);
  const tasks = [];
  const parked = [];
  const pending = [];
  for (const [pageKey, page] of Object.entries(verifyPages)) {
    // A row the VERIFIER owns is not a build defect: nobody filed the record. It still needs a task, and the
    // cause already says which of the two it is, so both go through the same grouping.
    const byCause = new Map();
    for (const row of page.openRows || []) {
      const cause = causeOf(row);
      if (!byCause.has(cause)) byCause.set(cause, []);
      byCause.get(cause).push(row);
    }
    for (const [cause, rows] of byCause) {
      const next = nextRound(rounds.get(capKey(pageKey, cause)), openRounds.get(`${pageKey} ${cause}`));
      if (next.hold === "pending") {
        pending.push({ pageKey, cause, rows: rows.length, round: next.round, status: next.status });
        continue;
      }
      if (next.hold === "parked") {
        parked.push({ pageKey, cause, rows: rows.length, rounds: REPAIR_ROUND_CAP });
        continue;
      }
      const round = next.round;
      const identityKey = identity.get(pageKey) || pageKey;
      const artifact = `page:${identityKey}`;
      const srcRows = rows.map((r) => ({
        label: r.deliverable, groupTitle: `Repair — ${causeText(cause)}`,
        vk: r.outcome === "missing" ? { type: "repair" } : null, na: null,
        weight: B.row, status: r.status, evidence: r.evidence,
      }));
      chunkRows(srcRows, B).forEach((chunkSrc, i) => {
        const id = shortHash(`${identityKey} repair ${cause} round${round} ${i}`);
      const suffix = i ? `#${i + 1}` : "";
        const t = {
          id, pageKey, artifact, writesTo: writesToOf(artifact),
          anchor: `repair-${cause}-round${round}${suffix}`,
          kind: REPAIR_KIND, cause, repairRound: round,
          group: `Repair round ${round} — ${causeText(cause)}`,
          title: `Repair round ${round} — ${causeText(cause)}`,
          groups: [...new Set(chunkSrc.map((r) => r.groupTitle))],
          order: Number.MAX_SAFE_INTEGER - 1, phase: DEFAULT_PHASE,
          origin: TASK_ORIGIN_ENGINE, status: S_TODO,
          rows: chunkSrc.map((r) => ({ label: r.label, group: r.groupTitle, vk: r.vk ? "repair" : null, na: null,
            status: r.status, evidence: r.evidence })),
          weight: chunkSrc.reduce((a, r) => a + r.weight, 0),
          gatedRows: chunkSrc.filter((r) => r.vk).length, naRows: 0,
          rowsDigest: rowsDigest(chunkSrc), dependsOn: [], notes: "",
          covers: chunkSrc.map((r) => coverKey(r.label)),
        };
        const nameSlug = slugify(`${pageKey}-${cause}`);
        t.file = `task-repair-round${round}-${nameSlug}-${id}.md`;
        tasks.push(t);
      });
    }
  }
  return { tasks, parked, pending };
}

// ---8<--- I/O ---8<---

// Every `.md` in the folder is returned, INCLUDING the ones that could not be parsed — `mergeTaskSet` needs to
// know they exist to refuse to write over them. Filtering them out here is what made a corrupted file's notes
// disappear silently: the engine read it as absent, treated its task as new, and overwrote it.
function readExisting(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== TASK_INDEX_FILE)
    .map((f) => ({ file: f, ...parseTaskFile(fs.readFileSync(path.join(dir, f), "utf8")) }));
}

// Writes the folder and returns what it wrote. Engine tasks are rewritten (the rows are the plan's), orchestrator
// tasks are left exactly as they are, a file the engine could not read in full is never touched, and nothing is
// ever deleted.
// Write the repair round one `--verify` run calls for. It ADDS to the folder: the plan tasks already there are
// untouched, and a repair file from an earlier round is a record of that round, never overwritten.
export function syncRepairDir(dir, result, verifyPages, opts = {}) {
  // WHICH tasks the plan contributes is decided by the frozen split when the folder has one, exactly as
  // `syncTaskDir` decides it. Deriving them from `buildTaskSet` instead would hand the merge below content-hash
  // ids while every file on disk carries the split's slug ids, so nothing would match, every task would read as
  // stale, and the index would be rewritten with all of them back at `todo` — an index describing a folder that
  // does not exist. `taskSetFor` falls back to `buildTaskSet` on its own when there is no split.
  const fresh = taskSetFor(dir, result, opts);
  // A refused split writes NOTHING, for the reason `syncTaskDir` refuses: half a folder schedules half a plan.
  if (fresh.refused) return { ...fresh, written: [], parked: [], pending: [], set: { ...fresh, tasks: [] } };
  const existing = readExisting(dir);
  // The rows a BUILD agent recorded as not built are routed here too, and only here: one trigger, one grouping,
  // one round cap for both kinds of open row. Read off the merged set because the Outcome cells live in the
  // files, and a task is only `partial` once those cells have been parsed back.
  const residual = notBuiltOpenRows(resolvePartials(attachDispatch(mergeTaskSet(fresh, existing), dir)).tasks);
  const { tasks, parked, pending } = buildRepairTasks(result, mergePages({ residual, verified: verifyPages }), opts, existing);
  const onDisk = new Set(existing.map((e) => e.file));
  fs.mkdirSync(dir, { recursive: true });
  // ENG-99192 — a repair round is over an already-cut folder, so its reconcile mode is the one frozen there; carry
  // it into the repair task files and the index the same way syncTaskDir does for the plan tasks.
  const reconcileMode = readFrozenMode(dir);
  const written = [];
  for (const t of tasks) {
    // An id already on disk is the SAME round of the same cause re-derived from an identical verify run — nothing
    // changed, so re-writing it would only erase whatever a sub-agent has already recorded in it.
    if (onDisk.has(t.file) || existing.some((e) => e.meta?.id === t.id)) continue;
    fs.writeFileSync(path.join(dir, t.file), renderTaskFile(t, { planVersion: result.planVersion || null, reconcileMode }));
    written.push(t);
  }
  // The index is derived from the FILES, so re-deriving it now picks the new repair files up with everything else.
  const merged = mergeTaskSet(fresh, readExisting(dir));
  merged.reconcileMode = reconcileMode;
  // The Dispatched column is folder-derived like the rest of the index: without this every row would render as
  // "not known" and a repair round would quietly erase what the build rounds recorded. It also feeds
  // `resolvePartials`, which only lets a DISPATCHED closure resolve a residual.
  attachDispatch(merged, dir);
  resolvePartials(merged);
  fs.writeFileSync(path.join(dir, TASK_INDEX_FILE), renderTaskIndex(merged));
  return { written, parked, pending, set: merged };
}

// THE SPLIT IS FROZEN IN THE FOLDER. Handed one, the engine validates it and copies it in; from then on every
// re-slice reads the copy. That is what makes a later run a RECONCILIATION rather than a second opinion: the cut
// is not re-decided, so a recorded `done` cannot move to a task that no longer exists.
export function readFrozenSplit(dir) {
  const p = path.join(dir, SPLIT_FILE);
  if (!fs.existsSync(p)) return null;
  const { split, errors } = parseSplit(fs.readFileSync(p, "utf8"));
  return { split, errors, file: p };
}

export function freezeSplit(dir, text) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, SPLIT_FILE), text);
}

// ENG-99192 — the RECONCILE MODE is a build-time choice for an existing-Freedom reconcile, frozen in the folder
// exactly like the split: chosen once with `--reconcile-mode` at the first `--tasks` run, then read back on every
// re-slice so the orchestrator does not have to re-pass it. It changes HOW build sub-agents place elements, not the
// plan — so it never touches `--plan`/`--spec`, only the task files (front matter) and the index header.
//   overlay        — add the client delta onto the existing Freedom layout; keep base positions/extras (default).
//   classic-layout — place fields/details at their Classic positions (move base, remove base layout elements not in
//                    the plan, keep Freedom-only value-add); see references/existing-freedom-reconcile.md.
export const RECONCILE_MODE_OVERLAY = "overlay";
export const RECONCILE_MODE_CLASSIC = "classic-layout";
export const RECONCILE_MODES = new Set([RECONCILE_MODE_OVERLAY, RECONCILE_MODE_CLASSIC]);
export const RECONCILE_MODE_DEFAULT = RECONCILE_MODE_OVERLAY;
const RECONCILE_MODE_FILE = ".reconcile-mode";

// The mode frozen in the folder, or null when none was ever set (a legacy folder, or a non-reconcile build). A value
// the current engine does not recognise is treated as absent rather than trusted — the same "strict about values"
// rule parseTaskFile follows for a status it cannot read.
export function readFrozenMode(dir) {
  const p = path.join(dir, RECONCILE_MODE_FILE);
  if (!fs.existsSync(p)) return null;
  const m = fs.readFileSync(p, "utf8").trim();
  return RECONCILE_MODES.has(m) ? m : null;
}

export function freezeMode(dir, mode) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, RECONCILE_MODE_FILE), mode + "\n");
}

// The mode this folder is built in: the one just handed in (`opts.reconcileMode`, from `--reconcile-mode`) wins,
// else the one frozen in the folder, else none — and none means the implicit `overlay` default (current behavior,
// unstamped, so a reconcile that never chose a mode keeps its files byte-for-byte). When a mode IS in play it is
// frozen, so a later re-slice without the flag reads it back. `--reconcile-mode` is validated + scope-gated by the
// CLI before it ever reaches here, so any value present is already one of RECONCILE_MODES on a reconcile plan.
export function resolveFrozenMode(dir, opts = {}) {
  const mode = opts.reconcileMode || readFrozenMode(dir);
  if (mode) freezeMode(dir, mode);
  return mode || null;
}

// The cut this run uses: the one just handed in, else the one frozen in the folder, else none — and none means
// the mechanical budget slicer, which stays as the degenerate path for a plan small enough that where the seams
// fall does not matter.
export function taskSetFor(dir, result, opts = {}, split = null) {
  const frozen = split ? null : readFrozenSplit(dir);
  if (frozen?.errors?.length) {
    return { refused: true, planVersion: result.planVersion || null, tasks: [],
      problems: frozen.errors.map((e) => `${SPLIT_FILE} ${e}`) };
  }
  const use = split || frozen?.split || null;
  return use ? buildTaskSetFromSplit(result, use, opts) : buildTaskSet(result, opts);
}

// ---8<--- THE CLOCK: what has started, what it cost, and what the next one will cost ---8<---

// Durations live in the MIGRATION FOLDER, beside the tasks they measure. Not in a machine-local file: a forecast
// nobody can review, that differs per developer and does not exist on CI, is not a number to show a user. So a run
// forecasts from its OWN closed tasks as soon as it has any, and from `TASK_BUDGET.minutesPerWeight` before that.
export const TIMINGS_FILE = "timings.json";
const TIMINGS_VERSION = 1;

const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

// THE FORECAST, as a RANGE. Measured spread on the one run available was 0.49–1.00 minutes per weight unit — a
// factor of two — so a single number would claim a precision the data does not have. Below four samples the range
// is the rate ±50%; from four on it is the observed quartiles, which narrow on their own as the run proceeds.
export function forecastMinutes(weight, samples, B = TASK_BUDGET) {
  const w = Number(weight) || 0;
  if (w <= 0) return null;
  const rates = samples.map((x) => x.minutes / x.weight);
  if (rates.length < 4) {
    const r = rates.length ? median(rates) : B.minutesPerWeight;
    return { low: Math.max(1, Math.round(w * r * 0.5)), high: Math.round(w * r * 1.5), n: rates.length };
  }
  const v = [...rates].sort((a, b) => a - b);
  const at = (q) => v[Math.min(v.length - 1, Math.floor(q * v.length))];
  return { low: Math.max(1, Math.round(w * at(0.25))), high: Math.round(w * at(0.75)), n: rates.length };
}

// THE CLOCK LIVES IN `timings.json`, NOT IN THE TASK FILE. It began in the front matter, next to `status` and
// `agentNonce` — the two fields a sub-agent is SUPPOSED to write — and on the first live run the builder duly
// filled `endedAt` in as well, with a time it rounded to the minute. The engine then saw the field set, recorded
// no sample, and the progress block went on saying "no task of this run has closed yet" over `done 1`. A field
// the caller must not touch does not belong in the file the caller edits.
const CLOSED = new Set([S_DONE, S_NA]);
// `CLOSED` answers "counts as done" — the index total, the progress line. `SETTLED` answers "the agent is
// finished with it": the clock stops, a dispatch record is owed, dependents are released. `partial` is SETTLED
// and not CLOSED: the next task runs, the run may not be called complete.
const SETTLED = new Set([...CLOSED, S_PARTIAL]);

// `running` is the open clocks, keyed by task id; `samples` the closed ones. Both in one file so a run's timing
// state is one thing to read, write and delete.
// AN OPEN CLOCK IS READ SHAPE-AGNOSTICALLY. `running` is accepted as a bare `{id: "<iso>"}` map, as
// `{id: {startedAt, token}}`, or as a LIST of either, and always normalized to `{id: {startedAt, token}}` for
// every consumer below. A shape this does not recognise yields NO open clocks, which is indistinguishable from a
// folder in which everything was dispatched — so tolerance here is what keeps the audit honest.
function normalizeRunning(raw) {
  const out = {};
  const put = (id, v) => {
    if (!id) return;
    if (typeof v === "string") out[id] = { startedAt: v, token: "" };
    else if (v && typeof v === "object") out[id] = { startedAt: v.startedAt || v.at || "", token: v.token || "" };
  };
  if (Array.isArray(raw)) for (const e of raw) put(typeof e === "string" ? e : e?.id, e);
  else if (raw && typeof raw === "object") for (const [id, v] of Object.entries(raw)) put(id, v);
  return out;
}

// A SAMPLE IS TWO FACTS, and only one of them is a duration: THAT the task was dispatched, and how long it took.
// They are filtered apart. A task that closes faster than the recorded precision rounds to `minutes: 0` and is
// useless to the forecast, but it is still proof a sub-agent was dispatched — dropping it here would report a
// dispatched task as one nobody was ever sent out for.
const usableSamples = (samples) => samples.filter((x) => Number(x?.weight) > 0 && Number(x?.minutes) > 0);

export function readTimingsFile(dir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, TIMINGS_FILE), "utf8"));
    const samples = Array.isArray(raw?.samples) ? raw.samples.filter((x) => x?.id) : [];
    return { samples, running: normalizeRunning(raw?.running) };
  } catch { return { samples: [], running: {} }; }   // absent or malformed — a forecast is not worth an exception
}
export const readTimings = (dir) => usableSamples(readTimingsFile(dir).samples);
const writeTimings = (dir, state) =>
  fs.writeFileSync(path.join(dir, TIMINGS_FILE), JSON.stringify({ version: TIMINGS_VERSION, ...state }, null, 2) + "\n");

// CLOSE the clocks of every task that finished since the last pass. A task closed with no open clock records
// nothing — it was never dispatched through the engine, and a duration nobody measured would poison the forecast.
function closeClocks(dir, tasks, now) {
  const state = readTimingsFile(dir);
  let changed = false;
  for (const t of tasks) {
    const clock = state.running[t.id];
    if (!SETTLED.has(t.status) || !clock?.startedAt) continue;
    delete state.running[t.id];
    changed = true;
    const minutes = (new Date(now) - new Date(clock.startedAt)) / 60000;
    // THE TOKEN OUTLIVES THE CLOCK, into the sample. `running` is deleted the moment the task closes, and a
    // closed task is the only kind whose signature can be checked at all.
    // A sample is dispatch evidence first, a duration second: every real close records one, clamped to 0. A
    // same-tick or backward-skew close (`minutes <= 0`) is useless to the forecast but still proof a sub-agent
    // was dispatched; dropping it would leave the gate reading a correctly closed task as never dispatched.
    // `usableSamples` keeps zero-duration out of the forecast. Only an unparseable timestamp records nothing.
    if (Number.isFinite(minutes)) {
      state.samples.push({ id: t.id, artifact: t.artifact, weight: t.weight, minutes: Number(Math.max(0, minutes).toFixed(2)),
        ...(clock.token ? { token: clock.token } : {}) });
    }
  }
  if (changed) writeTimings(dir, state);
  return state;
}

// THE PROGRESS BLOCK the orchestrator pastes into the chat, rendered HERE so the text and the folder cannot drift
// apart. It is stdout, never `index.md`: the index is a derived file compared byte-for-byte by the goldens, and a
// clock in it would make every regeneration a different file.
export function renderProgress(set, dir, now = new Date().toISOString()) {
  const { samples: allSamples, running: clocks } = readTimingsFile(dir);
  const samples = usableSamples(allSamples);   // the FORECAST reads only measurable samples; the dispatch count below reads all of them
  const tasks = [...set.tasks].sort((a, b) => Number(a.order) - Number(b.order));
  const done = tasks.filter((t) => CLOSED.has(t.status));
  const running = tasks.filter((t) => t.status === S_IN_PROGRESS);
  // Counted apart from both: it is neither `done` nor `todo`, and folding it into either hides a shortfall.
  const partial = tasks.filter((t) => t.status === S_PARTIAL);
  const open = tasks.filter((t) => !SETTLED.has(t.status) && t.status !== S_IN_PROGRESS);
  const L = [];
  for (const t of running) {
    const f = forecastMinutes(t.weight, samples);
    const startedAt = clocks[t.id]?.startedAt;
    const elapsed = startedAt ? `, running ${Math.round((new Date(now) - new Date(startedAt)) / 60000)} min` : "";
    const eta = f ? `, expected ${f.low}-${f.high} min` : "";
    L.push(`[${Number(t.order)}/${tasks.length}] RUNNING  ${t.group} · ${t.pageKey}${elapsed}${eta}`);
  }
  const leftWeight = [...running, ...open].reduce((a, t) => a + (t.weight || 0), 0);
  const left = forecastMinutes(leftWeight, samples);
  const basis = samples.length ? `${samples.length} closed task(s) of this run` : "the engine's calibrated rate — no task of this run has closed yet";
  const partialCount = partial.length ? ` · ⚠ partial ${partial.length}` : "";
  L.push(`done ${done.length} · running ${running.length} · todo ${open.length}${partialCount}`
    + (left ? ` — about ${left.low}-${left.high} min left (${basis})` : ""));
  // Named in the block the user reads while the run happens, not only in a file they may never re-open.
  for (const line of notBuiltLines(tasks)) L.push(line);
  for (const line of assertedBoundaryLines(tasks)) L.push(line);
  // THE COUNT THE USER READS IN REAL TIME. This block is pasted into the chat after every dispatch and is the
  // only surface a watching user has while the run is happening, so the dispatch shortfall belongs in it rather
  // than only in a file the run may never re-read.
  const audit = dispatchAudit(tasks, dir);
  const shortfall = audit.failing.length ? ` — ⚠ ${audit.failing.length} closed task(s) with NO dispatch record` : "";
  L.push(`dispatched ${audit.dispatched} of ${audit.total}${shortfall}`);
  return L.join("\n") + "\n";
}

// MARK A TASK STARTED, then regenerate. The orchestrator calls this immediately BEFORE it dispatches the
// sub-agent, which is the whole point: until it existed, `index.md` only ever moved when an agent FINISHED, so a
// run in flight looked identical to a run that had not begun. A fresh clock on every call is deliberate — a task
// re-dispatched after a kill is timing a new attempt, and the abandoned one records no sample.
export function startTask(dir, id, result, opts = {}, split = null, now = new Date().toISOString()) {
  const merged = syncTaskDir(dir, result, opts, split);
  if (merged.refused) return { ...merged, started: null };
  const t = merged.tasks.find((x) => x.id === id);
  if (!t) return { ...merged, started: null, unknownId: id };
  // A file the engine REFUSED to read is not started. `--start` used to re-render it, which is exactly what
  // the merge refusal exists to prevent: the `## Notes` on that file are the only record of work already done
  // on the stand, and the front matter the engine could not parse is the thing a human has to repair.
  if (t.unread) {
    return { ...merged, started: null, unread: t.file };
  }
  // ⛔ THE RUN STOPS AT THE NEXT DISPATCH, not at the end. A folder holding a closure nobody was dispatched for
  // gets no new clock: the books are repaired BEFORE another sub-agent is sent out on top of them, so the cost of
  // a broken ledger is one task rather than a whole run.
  if (merged.dispatch?.failing.length) {
    return { ...merged, started: null, blockedByDispatch: merged.dispatch };
  }
  const state = readTimingsFile(dir);
  // ⛔ THE QUEUE ORDER IS ENFORCED, not advised. A task whose `dependsOn` has not closed would be built against
  // answers that do not exist yet: the child form its related list opens, the scaffolding it saves into, the
  // `## Notes` the next chunk of its page reads instead of redoing the work.
  const byId = new Map(merged.tasks.map((x) => [x.id, x]));
  const openDeps = (t.dependsOn || []).map((d) => byId.get(d)).filter((d) => d && !SETTLED.has(d.status));
  if (openDeps.length) return { ...merged, started: null, blockedByDeps: openDeps };
  // ⛔ ONE WRITER PER ARTIFACT, enforced where the token is issued. Issuing tokens for several tasks that write
  // the SAME artifact is what lets one sub-agent hold them all and close each with a valid signature — every
  // other check would pass. Tasks on DIFFERENT artifacts may legitimately be open at once, so the comparison is
  // on `writesTo` and not on the number of open clocks; a read-only task claims nothing and never conflicts.
  const conflicts = t.writesTo
    ? merged.tasks.filter((x) => x.id !== t.id && x.writesTo === t.writesTo && state.running[x.id])
    : [];
  if (conflicts.length) return { ...merged, started: null, blockedByOverlap: conflicts };
  t.status = S_IN_PROGRESS;
  // THE SIGNATURE THE AGENT CANNOT MINT. The orchestrator hands this token to the sub-agent it dispatches and the
  // sub-agent echoes it into `agentNonce`. A value the agent chooses for itself is distinct on every file it
  // closes, so it can never show one agent closing several. The token is NOT written into the task file: an agent
  // holding several files would read a valid token off each one.
  const token = opts.dispatchToken || `${t.id}-${randomBytes(6).toString("hex")}`;
  state.running[t.id] = { startedAt: now, token };
  writeTimings(dir, state);
  // The SAME guard set `syncTaskDir` applies on its write. An adopted file (`origin: orchestrator`, which every
  // repair task carries) has a body the engine never authored: its Deliverables come from the file, not from
  // `t.rows`, which `adoptOrchestrated` leaves empty. Re-rendering it emptied the table and flipped the origin,
  // so the sub-agent was dispatched with no deliverables. Only the `status:` line moves here.
  const untouchable = new Set((merged.blocked || []).map((b) => b.file));
  if (t.origin === TASK_ORIGIN_ORCHESTRATOR || untouchable.has(t.file)) {
    setFrontMatterStatus(dir, t.file, S_IN_PROGRESS);
  } else {
    fs.writeFileSync(path.join(dir, t.file), renderTaskFile(t, merged));
  }
  // Re-read the clocks AFTER this task's own was stamped, so the index it writes shows the task it just started
  // as started rather than as never dispatched.
  attachDispatch(merged, dir);
  fs.writeFileSync(path.join(dir, TASK_INDEX_FILE), renderTaskIndex(merged));
  return { ...merged, started: t, dispatchToken: token };
}

// REWRITES ONE LINE OF AN EXISTING FILE. The whole point is that everything else in the file — an authored body,
// a Deliverables table the engine never parsed, the `## Notes` — is byte-identical afterwards. Only the first
// `status:` line inside the opening front-matter block is replaced; a `status:` in prose further down is not
// front matter and is left alone.
function setFrontMatterStatus(dir, file, status) {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) return false;
  const lines = fs.readFileSync(full, "utf8").split("\n");
  if (lines[0]?.trim() !== "---") return false;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") break;
    if (lines[i].startsWith("status:")) {
      lines[i] = `status: ${status}`;
      fs.writeFileSync(full, lines.join("\n"));
      return true;
    }
  }
  return false;
}

// CLOSED BUT NEVER DISPATCHED. The engine cannot tell which context closed a task — the nonce only proves two
// tasks were not closed by the SAME one — but it can see that a task went to `done` without ever being started
// through `--start`. On the first live run that was the review task, closed by the orchestrator that had just
// judged its own build, and nothing in the folder objected.
// THE ONE PREDICATE, read-only, computed from the parsed task files plus `timings.json` and nothing else — so the
// SAME answer comes out of a folder the engine just wrote and a folder `--verify` merely reads. Three findings,
// deliberately distinct because their remedies are:
//
//   `never`   — closed with no clock EVER opened: no sub-agent was dispatched through the engine. The remedy is
//               to re-open, `--start` and hand it out; re-running the mode cannot supply what was never recorded.
//   `openClock` — closed while its clock is STILL open, so the books are behind rather than wrong; re-running the
//               mode closes the clock and records the sample. Only reachable on the READ-ONLY path, because
//               `syncTaskDir` closes clocks before it audits.
//   `signature` — started, and closed carrying something other than the token dispatch issued for it.
//
// `n/a` IS NOT A GATE FAILURE. A row that does not apply is closed without anyone building it, so requiring a
// dispatch record for it would make the gate unpassable. It is reported on Attention instead: the one closure a
// run may make with no sub-agent is also the cheapest way around the gate, so it is named rather than silent.
// THE FOLDER AS IT STANDS, with no plan and no re-slice. `--verify` audits dispatch without re-cutting the folder,
// so it reads the recorded front matter straight off disk. A file whose front matter could not be parsed carries
// no status anyone can act on and is skipped, exactly as the merge skips it.
// ⚠ NO RESIDUALS ARE RESOLVED HERE. A status is computed from the file's own cells alone, so a `partial` whose
// repair task has since closed still reads `partial` and its rows carry no `residual`. `notBuiltRows` and anything
// built on it (`unroutedNotBuilt`) must be called on an assembled set — `syncTaskDir` / `syncRepairDir` output —
// never on this. Use it for what it says: the folder as recorded.
export function readTaskDir(dir) {
  return readExisting(dir)
    .filter((e) => !e.malformed && e.meta?.id)
    .map((e) => {
      const origin = TASK_ORIGINS.includes(e.meta.origin) ? e.meta.origin : TASK_ORIGIN_ENGINE;
      const rows = rowsFromTable(e.table);
      const recorded = e.meta.status || S_TODO;
      // Re-computed off the file's own cells. `--tasks` writes the computed value into the front matter; a status
      // edited by hand afterwards must not turn a `partial` back into a `done`.
      const status = computeStatus({ origin, kind: e.meta.kind || null, rows }, recorded, e.outcomes);
      return {
        id: e.meta.id, file: e.file, status, recordedStatus: recorded, rows, origin,
        agentNonce: e.meta.agentNonce || "", writesTo: e.meta.writesTo || "",
        dependsOn: (e.meta.dependsOn || "").split(/\s+/).filter(Boolean),
        notes: e.notes || "",
        // Read off the file, not re-derived from the plan: the read-only path must name the unbuilt deliverable
        // without depending on a manifest that has since moved.
        pageKey: e.meta.pageKey || "?",
      };
    });
}

// CLOSED WITH NO CLOCK AT ALL. An orchestrator-authored file is not the engine's to schedule, so it is not held
// to the engine's dispatch record — the repair tasks the engine DOES author carry `origin: orchestrator` too.
// THE REASON IS WHAT BUYS THE EXEMPTION: `n/a` is the one closure that needs no sub-agent, so an `n/a` with
// nothing under `## Notes` is a task closed with neither a builder nor a justification, and it is the cheapest
// way to write off every remaining row at once.
function classifyUndispatched(t, out) {
  if (t.origin !== TASK_ORIGIN_ENGINE) return;
  if (t.status !== S_NA) { out.never.push(t); return; }
  ((t.notes || "").trim() ? out.naUndispatched : out.naNoReason).push(t);
}

// SIGNED WITH A VALUE THE AGENT DID NOT CHOOSE. Checkable only where the clock record carries a token; without
// one there is nothing to compare against, and the duplicate/empty-nonce report on the index is the only check.
function checkSignature(t, sample, tokenOwner, out) {
  if (!sample.token) return;
  const got = (t.agentNonce || "").trim();
  if (got === sample.token) return;
  const owner = got ? tokenOwner.get(got) : null;
  out.signature.push({ task: t, got, expected: sample.token, owner: owner && owner !== t.id ? owner : null });
}

export function dispatchAudit(tasks, dir) {
  const { running, samples } = readTimingsFile(dir);
  const sampleById = new Map(samples.map((x) => [x.id, x]));
  const tokenOwner = new Map();   // token → task id it was issued to
  for (const [id, c] of Object.entries(running)) if (c.token) tokenOwner.set(c.token, id);
  for (const s of samples) if (s.token) tokenOwner.set(s.token, s.id);

  const out = { never: [], openClock: [], signature: [], naUndispatched: [], naNoReason: [] };
  for (const t of tasks) {
    if (t.unread || !SETTLED.has(t.status)) continue;
    const clock = running[t.id], sample = sampleById.get(t.id);
    if (!clock && !sample) classifyUndispatched(t, out);
    else if (clock) out.openClock.push(t);   // still open: the sample does not exist yet, so nothing to sign
    else checkSignature(t, sample, tokenOwner, out);
  }
  const { never, openClock, signature, naUndispatched, naNoReason } = out;
  // The exit-2 set. `openClock` is separated because its remedy is a command, not a rebuild.
  // ONE denominator for every surface that prints a dispatch count: the tasks in the folder.
  return { never, openClock, signature, naUndispatched, naNoReason,
    failing: [...never, ...openClock, ...naNoReason, ...signature.map((s) => s.task)],
    dispatched: tasks.filter((t) => running[t.id] || sampleById.has(t.id)).length,
    total: tasks.length };
}

// The audit, plus the per-task cell the index renders. `renderTaskIndex` takes only a set (it is called in tests
// with a set built by hand and no folder at all), so the folder-derived fact is attached to the set here rather
// than read inside the renderer — an undefined cell renders as "not known", never as "never dispatched".
function attachDispatch(set, dir) {
  const audit = dispatchAudit(set.tasks, dir);
  const { running, samples } = readTimingsFile(dir);
  const sampled = new Set(samples.map((x) => x.id));
  for (const t of set.tasks) {
    if (running[t.id]) t.dispatched = "started";
    else if (sampled.has(t.id)) t.dispatched = "yes";
    // NO CLOCK MEANS TWO DIFFERENT THINGS, and only one of them is a warning. A task still OPEN has simply not
    // had its turn yet; a CLOSED one was finished with nobody dispatched for it. Marking both the same way puts a
    // warning on every row of a healthy queue, and the one row that matters then reads like the other sixteen.
    // THE COLUMN AGREES WITH THE GATE: `⚠ never` only where the gate would fail the row. `classifyUndispatched`
    // exempts a non-engine-origin (orchestrator/repair) closure, so it reads `—` here too rather than a warning
    // nothing else echoes. `SETTLED` rather than `CLOSED`: a `partial` task owes a dispatch record like a `done` one.
    else t.dispatched = SETTLED.has(t.status) && t.origin === TASK_ORIGIN_ENGINE ? "never" : "pending";
  }
  set.dispatch = audit;
  // Kept under its old name: the Attention section and every caller that reads "closed but never dispatched"
  // already spell it this way, and the gate reads `set.dispatch` for the rest.
  set.undispatched = [...audit.never, ...audit.naUndispatched];
  return set;
}

export function syncTaskDir(dir, result, opts = {}, split = null) {
  const fresh = taskSetFor(dir, result, opts, split);
  // A refused split writes NOTHING. Half a folder schedules half a plan and silently drops the rest, which is the
  // failure the coverage check exists to prevent.
  if (fresh.refused) return { ...fresh, tasks: [], stale: [], blocked: [] };
  const merged = mergeTaskSet(fresh, readExisting(dir));
  const untouchable = new Set(merged.blocked.map((b) => b.file));
  fs.mkdirSync(dir, { recursive: true });
  merged.reconcileMode = resolveFrozenMode(dir, opts);
  // Close the clocks of everything that finished since the last pass, before the files are written.
  closeClocks(dir, merged.tasks, opts.now || new Date().toISOString());
  attachDispatch(merged, dir);
  // AFTER both: a residual only closes its task if somebody was dispatched for it, which is what `attachDispatch`
  // reads off the clocks. The parent's own clock is untouched — `partial` already settled it, and `done` is the
  // same side of `SETTLED`.
  resolvePartials(merged);
  for (const t of merged.tasks) {
    // `t.unread` covers the refused file the caller renamed: its name no longer matches, so `untouchable` alone
    // would let a fresh `todo` be written beside the record that is still on disk.
    if (untouchable.has(t.file) || t.unread) continue;
    // A REPAIR FILE IS THE RECORD OF ITS ROUND and is never re-authored — its rows are one verify run's, not the
    // plan's. Its `status` is computed from the cells, so that ONE line is written back: the file is what a
    // resumed orchestrator reads, and it must not disagree with the index, the progress block and the gate.
    if (t.kind === REPAIR_KIND) { setFrontMatterStatus(dir, t.file, t.status); continue; }
    if (t.origin === TASK_ORIGIN_ORCHESTRATOR) continue;
    fs.writeFileSync(path.join(dir, t.file), renderTaskFile(t, merged));
  }
  fs.writeFileSync(path.join(dir, TASK_INDEX_FILE), renderTaskIndex(merged));
  return merged;
}

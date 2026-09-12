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
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { checklistGroups, subPageNodes, LIST_PAGE_KEY } from "./designspec.mjs";
import { SPLIT_FILE, resolveSplit, reconcile, splitProblems, parseSplit } from "./split.mjs";

// The status vocabulary is CHECKED, not free text (a mistyped status is a stop, not a silent "not done"): an
// unrecognised value is reported on the index and on stderr instead of being folded into one of these.
const S_TODO = "todo", S_IN_PROGRESS = "in-progress", S_DONE = "done", S_BLOCKED = "blocked", S_NA = "n/a";
export const TASK_STATUSES = [S_TODO, S_IN_PROGRESS, S_DONE, S_BLOCKED, S_NA];
export const TASK_ORIGIN_ENGINE = "engine";
export const TASK_ORIGIN_ORCHESTRATOR = "orchestrator";
// The two origins a task file may declare: the engine authored it from the plan, or the orchestrator added it.
export const TASK_ORIGINS = [TASK_ORIGIN_ENGINE, TASK_ORIGIN_ORCHESTRATOR];
export const TASK_INDEX_FILE = "index.md";
const OPEN_STATUSES = new Set([S_TODO, S_IN_PROGRESS, S_BLOCKED]);
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
  field: 1,         // one field inside a layout row
  relatedList: 4,   // a related list carries its own binding and its own child page
  rule: 1,          // one business rule
  handler: 4,       // one ported handler — the heaviest row kind per unit
  confirm: 2,       // one on-stand question answered before the build
  row: 2,           // anything else
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

// EVERY BUILD SUB-AGENT STARTS EMPTY. It re-reads the same guidance, the same tool contracts and the same
// component docs the previous one just read, because a fresh context has none of it — measured at 3.5× the tool
// lookups of the planning phase for work that is identical every time. So one read-only task fetches them once
// into `refs/` and every later task is handed PATHS.
//
// Three properties, taken from the workflow prototype that proved the saving and kept unchanged here:
//   PATHS, NEVER PASTED BODIES. Inlining the contracts into every build prompt cost more than fetching them did.
//   THE CACHE IS A SHORTCUT, NOT A RESTRICTION. A sub-agent needing something the cache does not hold calls the
//     tool as usual — a cache that FORBIDS is a defect generator.
//   IT IS STAND-SPECIFIC. `components.md` records the environment it came from; another stand must not trust it.
function refsRows(result) {
  const pages = [...new Set([...subPageNodes(result).map((n) => n.pageKey).filter(Boolean), "main", LIST_PAGE_KEY])];
  return [
    { label: `\`${REFS_DIR}/index.md\` — what was cached and which TIER each entry belongs to: \`stable-docs\``
      + " (the same on every run), `host` (this machine), `environment` (this stand), `plan` (this plan version)."
      + " The tier is the invalidation story: a `plan` entry is stale the moment the plan version changes, an"
      + " `environment` entry the moment the stand does, and a `stable-docs` entry effectively never." },
    { label: `\`${REFS_DIR}/contracts.md\` — the tool contracts a page build calls, fetched BY NAME. Never`
      + " argument-less: that dumps the whole catalogue into the file every builder reads." },
    { label: `\`${REFS_DIR}/components.md\` — \`get-component-info\` per component type this plan builds, headed`
      + " with the ENVIRONMENT it was read from, because a component's contract is stand-specific." },
    { label: `\`${REFS_DIR}/guidance-<topic>.md\` — one file per clio guidance topic this build needs. Resolve the`
      + " set from the routing map (`get-guidance name=routing`), not from a list written down here — the map is"
      + " what knows which guide a given kind of work needs." },
    ...pages.map((k) => ({ label: `\`${REFS_DIR}/spec-${slugify(k)}.md\` — the design-spec slice for \`${k}\``
      + " (`--spec --page " + k + "`), carrying the plan's `Adjustments` list IN FULL: those are the corrections"
      + " agreed at approval time and a slice without them silently drops what was agreed." })),
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
  const { artifact, pageKey, label, anchor, identityKey, srcRows } = chunk;
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
  task.file = taskFileName(task);
  return task;
}

// THE LABEL a human reads in the index and in the file name. An artifact that was NOT cut keeps the plain artifact
// name; a chunk is named after the structural unit it starts at, so two chunks of one page are told apart by where
// they begin rather than by a number that moves when the page grows.
const ARTIFACT_LABEL = new Map([[ARTIFACT_REFS, REFS_GROUP], [ARTIFACT_SCAFFOLD, "Scaffolding"]]);
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
  const chunks = [refs, ...ordered].flatMap((b) => chunksOf(b, B));
  const tasks = chunks.map((c, i) => taskOf(c, i + 1));
  return {
    entity: result.entity || null,
    planVersion: result.planVersion || null,
    budget: B,
    tasks: withDependencies(tasks),
  };
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
  "writesTo", "dependsOn", "agentNonce"];
// A repair task carries two more, and they are what the NEXT verify run reads: which cause it was opened for and
// which round of it this is. Both live in the file because the folder is the state — counting rounds from a
// session's memory is how a capped cause quietly gets a fourth sub-agent.
const REPAIR_KEYS = ["kind", "cause", "repairRound"];

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
    // WRITTEN BY THE SUB-AGENT, checked by the engine. One sub-agent per task is the contract; the orchestrator
    // that composes the prompt is also the one that grouped tasks in testing, so it cannot be the thing that
    // proves the contract held. A nonce the sub-agent mints itself, appearing on two files, is one sub-agent
    // having closed two tasks — the engine sees it without asking either of them.
    agentNonce: task.agentNonce || "",
  };
  const keys = [...FRONT_MATTER_KEYS];
  if (task.kind === REPAIR_KIND) {
    Object.assign(v, { kind: task.kind, cause: task.cause, repairRound: String(task.repairRound) });
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
  // A repair row is shown with the STATUS and the EVIDENCE `--verify` recorded for it, verbatim. A sub-agent sent
  // to fix a row needs to know what the gate actually saw; re-describing it in the engine's own words is how a
  // repair round gets spent on a row that was never the problem.
  if (repair) {
    const L = ["| # | Deliverable | `--verify` said | Evidence it read |", "| --- | --- | --- | --- |"];
    rows.forEach((r, i) => L.push(`| ${i + 1} | ${r.label} | ${r.status || "—"} | ${r.evidence || "—"} |`));
    return L;
  }
  const L = ["| # | From | Deliverable | Closed by |", "| --- | --- | --- | --- |"];
  rows.forEach((r, i) => L.push(`| ${i + 1} | ${r.group || "—"} | ${r.label} | ${closedByOf(r)} |`));
  return L;
}

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
      + " DIFFERENT `writesTo` (or an empty one) may run beside this one; one with the same must not.");
  } else {
    L.push("- **Writes:** nothing — read-only. It may run beside any task it does not depend on.");
  }
  if (task.dependsOn?.length) {
    const deps = task.dependsOn.map((d) => "`" + d + "`").join(" · ");
    L.push(`- **Depends on:** ${deps} — each must read \`done\` before`
      + " this starts. Read their `## Notes` first: what they answered on the stand is not repeated here.");
  }
  L.push("- **One sub-agent, one task:** do not pick up another task file in this session. Before finishing, put a"
    + " value you mint yourself in `agentNonce:` above (any short unique string). The engine reports the same nonce"
    + " appearing twice, which is how a task closed by a sub-agent that was already working another one is found.");
  return L;
}

export function renderTaskFile(task, set = {}) {
  const naNote = task.naRows ? `, ${task.naRows} N/A` : "";
  const statusVocabulary = TASK_STATUSES.map((s) => `\`${s}\``).join(" · ");
  const body = [
    ...renderFrontMatter(task, set),
    "",
    `# ${task.step ?? task.order}. ${task.pageKey} · ${task.group}`,
    "",
    ...(task.kind === REPAIR_KIND ? [
      `> REPAIR — round ${task.repairRound} of at most ${REPAIR_ROUND_CAP}. These rows were left OPEN by a \`--verify\``,
      "> run against the page as it is NOW: they are not new plan work, and the plan has not changed. Fix exactly",
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
    `- **Status vocabulary:** ${statusVocabulary} — set \`status\` in the front matter above`,
    ...oneAgentBlock(task),
    "",
    ENGINE_BODY_HEADING,
    "",
    "<!-- ENGINE-OWNED. Rewritten from the plan on every `--tasks` run; edits here are lost. -->",
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
  return { meta, notes: notesOf(lines.slice(i + 1)), malformed: null };
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
]);
// An unrecognised status is shown as itself and counted as neither done nor open.
const statusMark = (s) => STATUS_MARK.get(s) || `⚠ ${s}`;

// `Step` is the position in the QUEUE, which is not the same fact as a task file's `order` field: an
// orchestrator-authored file is never rewritten, so the `order` it declared for itself stands even where the queue
// puts it. Naming the column `#` invited reading the two as one number.
// `Writes` is in the table because the orchestrator's parallelism rule reads off it: two tasks may be dispatched
// at once only when this column differs between them. A blank cell is a read-only task.
function indexRows(tasks) {
  const L = ["| Step | Task | Page | Writes | Status | Rows | File |", "| --- | --- | --- | --- | --- | --- | --- |"];
  for (const t of tasks) {
    const gatedNote = t.gatedRows ? ` (${t.gatedRows} gated)` : "";
    const rows = `${t.rows.length}${gatedNote}`;
    const mark = t.unread ? "⚠ unread" : statusMark(t.status);
    const writes = t.writesTo ? `\`${t.writesTo}\`` : "— read-only";
    L.push(`| ${t.step ?? t.order} | ${t.group} | \`${t.pageKey}\` | ${writes} | ${mark} | ${rows} | [${t.file}](${t.file}) |`);
  }
  return L;
}

function taskAttention(t) {
  const out = [];
  if (t.unread) return out;   // its own refusal line already names the file; nothing here was recorded by anyone
  if (!TASK_STATUSES.includes(t.status)) {
    out.push(`- \`${t.file}\` — unrecognised status \`${t.status}\`: use one of ${TASK_STATUSES.join(" / ")}`);
  } else if (t.drifted) {
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
  const closed = tasks.filter((t) => !t.unread && t.status === S_DONE);
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

function attentionLines(set) {
  const out = set.tasks.flatMap(taskAttention);
  out.push(...nonceAttention(set.tasks));
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
  const counts = { done: 0, open: 0, other: 0 };
  for (const t of tasks) {
    if (t.unread) counts.other++;
    else if (t.status === S_DONE) counts.done++;
    else if (OPEN_STATUSES.has(t.status)) counts.open++;
    else counts.other++;
  }
  return counts;
}

export function renderTaskIndex(set) {
  const counts = countStatuses(set.tasks);
  const other = counts.other ? ` · **Other:** ${counts.other}` : "";
  const entityNote = set.entity ? ` — ${set.entity}` : "";
  const L = [
    `# Migration build tasks${entityNote}`,
    "",
    `**Plan version:** \`${set.planVersion || "—"}\` · **Tasks:** ${set.tasks.length} · **Done:** ${counts.done} · **Open:** ${counts.open}${other}`,
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

function carryOver(task, prev) {
  if (!prev) return task;
  const status = prev.meta.status || task.status;
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

// An orchestrator task is read, not authored: the engine keeps its file and its status and only places it in the
// order. `order` may be absent or unparseable, so it sorts after every engine task rather than at the front.
function adoptOrchestrated(e) {
  const n = Number(e.meta.order);
  const label = e.meta.group || "(orchestrator task)";
  return {
    id: e.meta.id, pageKey: e.meta.pageKey || "?", group: label, title: label,
    order: Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER,
    phase: DEFAULT_PHASE, origin: TASK_ORIGIN_ORCHESTRATOR, status: e.meta.status || S_TODO,
    rows: [], gatedRows: 0, naRows: 0, rowsDigest: e.meta.rowsDigest || "", notes: e.notes || "",
    // An orchestrator task declares its own artifact and its own nonce. Both are READ, never authored here: a
    // repair task the orchestrator added writes a page like any other task, and it must take part in the same
    // parallelism rule and the same one-sub-agent check as the engine's own.
    kind: e.meta.kind || null,
    cause: e.meta.cause || null,
    repairRound: Number(e.meta.repairRound) || null,
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
  const outcome = row.outcome === "unverified" ? "unverified" : "missing";
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
};
const causeText = (cause) => CAUSE_TEXT[cause] || cause;

// The round a (page, cause) is already on, read off the files in the folder. Rounds are counted per CAUSE and not
// per run: a cause fixed in round 1 and back in round 3 has been attempted twice, which is the number the cap is
// about. A capped cause is PARKED, not silently re-emitted — three sub-agents have failed at it and a fourth is
// not the answer; it is a decision for the user.
function repairRounds(existing) {
  const rounds = new Map();
  for (const e of existing) {
    if (e.meta?.kind !== REPAIR_KIND) continue;
    const key = `${e.meta.pageKey} ${e.meta.cause || ""}`;
    const n = Number(e.meta.repairRound) || 1;
    const prev = rounds.get(key);
    if (!prev || n >= prev.round) rounds.set(key, { round: n, status: e.meta.status || S_TODO });
  }
  return rounds;
}
// A ROUND IS AN ATTEMPT, NOT A VERIFY RUN. Re-verifying an unchanged page must not open a new round: the rows are
// still the work of the round already sitting in the folder, and counting verify runs would burn the cap without a
// single sub-agent having run. A new round opens only once the previous one was CLOSED and the rows came back —
// which is the repeat failure the cap is actually about. `blocked` does not auto-reopen either: a sub-agent that
// said why it could not proceed is answered by a person, not by an identical fourth task.
const ROUND_ATTEMPTED = new Set([S_DONE, S_NA]);

// Build the repair tasks one verify run calls for. `verifyPages` is `renderVerify`'s `pages` map: each entry
// carries the rows that run left open, with the text the reader saw rather than a paraphrase of it.
// What this cause gets from THIS verify run: the next round, or a reason it gets nothing. A round already open is
// still somebody's work, and a cause that has had its rounds is a decision for a person.
function nextRound(prior) {
  if (prior && !ROUND_ATTEMPTED.has(prior.status)) return { hold: "pending", round: prior.round, status: prior.status };
  const round = (prior?.round || 0) + 1;
  return round > REPAIR_ROUND_CAP ? { hold: "parked", round } : { hold: null, round };
}

export function buildRepairTasks(result, verifyPages = {}, opts = {}, existing = []) {
  const B = budgetOf(opts);
  const identity = pageIdentities(result);
  const rounds = repairRounds(existing);
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
      const next = nextRound(rounds.get(`${pageKey} ${cause}`));
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
  const { tasks, parked, pending } = buildRepairTasks(result, verifyPages, opts, existing);
  const onDisk = new Set(existing.map((e) => e.file));
  fs.mkdirSync(dir, { recursive: true });
  const written = [];
  for (const t of tasks) {
    // An id already on disk is the SAME round of the same cause re-derived from an identical verify run — nothing
    // changed, so re-writing it would only erase whatever a sub-agent has already recorded in it.
    if (onDisk.has(t.file) || existing.some((e) => e.meta?.id === t.id)) continue;
    fs.writeFileSync(path.join(dir, t.file), renderTaskFile(t, { planVersion: result.planVersion || null }));
    written.push(t);
  }
  // The index is derived from the FILES, so re-deriving it now picks the new repair files up with everything else.
  const merged = mergeTaskSet(fresh, readExisting(dir));
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

export function syncTaskDir(dir, result, opts = {}, split = null) {
  const fresh = taskSetFor(dir, result, opts, split);
  // A refused split writes NOTHING. Half a folder schedules half a plan and silently drops the rest, which is the
  // failure the coverage check exists to prevent.
  if (fresh.refused) return { ...fresh, tasks: [], stale: [], blocked: [] };
  const merged = mergeTaskSet(fresh, readExisting(dir));
  const untouchable = new Set(merged.blocked.map((b) => b.file));
  fs.mkdirSync(dir, { recursive: true });
  for (const t of merged.tasks) {
    // `t.unread` covers the refused file the caller renamed: its name no longer matches, so `untouchable` alone
    // would let a fresh `todo` be written beside the record that is still on disk.
    if (t.origin === TASK_ORIGIN_ORCHESTRATOR || untouchable.has(t.file) || t.unread) continue;
    fs.writeFileSync(path.join(dir, t.file), renderTaskFile(t, merged));
  }
  fs.writeFileSync(path.join(dir, TASK_INDEX_FILE), renderTaskIndex(merged));
  return merged;
}

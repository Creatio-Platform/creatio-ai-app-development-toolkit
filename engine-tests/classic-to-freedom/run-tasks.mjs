// Offline unit tests for `engine/tasks.mjs` — the approved plan sliced into a FOLDER of one-task files plus a
// derived `index.md`, and the `migrate.mjs --tasks <dir>` CLI mode that writes it. The mode replaced a monolithic
// prose step (one agent holding every deliverable in one context; a killed session lost the progress), so the
// invariants under test are the ones that make a FOLDER safer than that table: content-derived ids, a leaf-first
// build order, the caller's recorded state surviving a re-run, nothing ever deleted, and a plan-level gap writing
// nothing at all. Zero dependencies (node built-ins only).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runMigration, checklistOpts } from "../../skills/classic-to-freedom-migration/engine/migrate.mjs";
import { checklistGroups, subPageNodes, planGaps, LIST_PAGE_KEY } from "../../skills/classic-to-freedom-migration/engine/designspec.mjs";
import { renderFinalReport } from "../../skills/classic-to-freedom-migration/engine/report.mjs";
import { buildTaskSet, mergeTaskSet, parseTaskFile, renderTaskFile, renderTaskIndex, syncTaskDir, notBuiltRows, notBuiltOpenRows, notBuiltOpenItems, NOT_BUILT_CAUSES, assertedBoundaryRows,
  taskFileName, addTasks, unreadableLedger, TASK_STATUSES, TASK_ORIGINS, TASK_INDEX_FILE, TASK_BUDGET,
  ARTIFACT_SCAFFOLD, ARTIFACT_REFS, ARTIFACT_WHOLE, REFS_DIR, buildRepairTasks, syncRepairDir,
  startTask, readTimings, readTimingsFile, forecastMinutes, renderProgress, TIMINGS_FILE,
  dispatchAudit, readTaskDir,
  startBlocker, startableTasks, HOLD_DEPS, HOLD_OVERLAP, HOLD_SEQUENCED, HOLD_STATUS, HOLD_UNREAD, HOLD_LEDGER,
  NEXT_STARTABLE, NEXT_WAITING, NEXT_FINISHED, NEXT_STUCK, NEXT_LEDGER, NEXT_VERDICTS, HOLD_CAUSES,
  REPAIR_ROUND_CAP, buildTaskSetFromSplit, taskSetFor, freezeSplit, readMergedTaskDir, unclaimedPlanRows, cutProblems, cutRefusal, REFUSED_COVERAGE, REFUSED_CUT } from "../../skills/classic-to-freedom-migration/engine/tasks.mjs";
import { parseSplit, resolveSplit, rowKey, splitProblems, SPLIT_FILE } from "../../skills/classic-to-freedom-migration/engine/split.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.join(DIR, "..", "..", "skills", "classic-to-freedom-migration", "engine");
const MIGRATE = path.join(ENGINE_DIR, "migrate.mjs");

let pass = 0, fail = 0;
// Same contract as the other runners: `cond` may be a thunk, evaluated in try/catch so ONE assertion that throws
// fails only itself instead of aborting the runner and hiding every check after it. `detail` is printed on FAILURE
// only, so a red golden in CI shows computed-vs-expected without a local rerun.
const check = (name, cond, detail) => {
  let c = cond, threw = null;
  if (typeof cond === "function") { try { c = cond(); } catch (e) { c = false; threw = e; } }
  if (c) { pass++; console.log("  ✅ " + name); return; }
  fail++; console.log("  ❌ " + name + (threw ? "  (threw: " + threw.message + ")" : ""));
  if (detail !== undefined) {
    let d; try { d = typeof detail === "function" ? detail() : detail; } catch (e) { d = "<detail threw: " + e.message + ">"; }
    console.log("      ↳ " + (typeof d === "string" ? d : JSON.stringify(d)));
  }
};

/* ================================================================================================
   ONE GATE-CLEAN FIXTURE, built inline (no stand-sourced page body is ever copied into the repo).
   It deliberately publishes FOUR distinct page keys at once, because every ordering invariant below
   is vacuous on a plan with one page:

       main ─ detail R1D → child:C1 ─ detail GD → child:G1   (a GRANDCHILD, so leaf-first is testable)
            + a section with resolved list columns             → the `list` page gets its own gated unit

   `seed` carries 8 method bodies on purpose: the correctness gate rejects a hand-typed base template
   with fewer than 5 as skeletal, and a BLOCKED plan is exactly what `--tasks` refuses to slice —
   so a skeletal seed would make every CLI check below test the refusal path instead of the happy one.
   ================================================================================================ */
const SEED_METHODS = ["init", "getActions", "onSaved", "setColumns", "loadValues", "onRender", "onEntry", "onExit"]
  .map((m, i) => `${m}:function(){return ${i + 1};}`).join(",");
const SEED = [{ pkg: "BaseModulePageV2", body: `define("BaseModulePageV2",[],function(){return{diff:[{operation:"insert",name:"ProfileContainer",values:{itemType:15}},{operation:"insert",name:"Tabs",values:{itemType:15}}],methods:{${SEED_METHODS}}};});` }];
const leafBundle = (entity, page) => ({ entity, seed: SEED,
  schemas: [{ pkg: "P", body: `define("${page}",[],function(){return{entitySchemaName:"${entity}",diff:[{operation:"insert",name:"${entity}F",parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"${entity}F"}}]};});` }] });
const C1_BUNDLE = { entity: "C1", seed: SEED,
  schemas: [{ pkg: "P", body: 'define("C1Page",[],function(){return{entitySchemaName:"C1",details:{G:{schemaName:"GD",entitySchemaName:"G1",filter:{detailColumn:"c",masterColumn:"Id"}}},diff:[{operation:"insert",name:"GT",parentName:"Tabs",values:{itemType:15,isTab:true}},{operation:"insert",name:"G",parentName:"GT",values:{itemType:2}},{operation:"insert",name:"C1F",parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"C1F"}}]};});' }],
  detailSchemas: { GD: { entity: "G1", columns: ["Number"], editPage: "G1Page" } },
  childPageSchemas: { G1Page: leafBundle("G1", "G1Page") } };
// The main page body, parameterised by the two independent plan edits the checks below need:
//   `extraChild` adds a SECOND child page  → a page INSERTED into the plan (ids must not renumber);
//   `extraField` adds one more form field  → a task's ROW SET changes while the task itself stays the same
//                                            (the drift signal), with no page inserted at all.
//   `renameField` renames that same field    → the row LABELS and the counts are untouched and only the verifier
//                                              payload moves, which is the drift a label-only digest missed;
//   `bulk` adds many fields and handlers      → the `page:main` bucket outgrows the budget, so the chunking path
//                                              is exercised instead of the monolithic one.
const mainBody = ({ extraChild, extraField, renameField, bulk }) => {
  const dets = ['R1:{schemaName:"R1D",entitySchemaName:"C1",filter:{detailColumn:"m",masterColumn:"Id"}}'];
  const items = ['{operation:"insert",name:"R1",parentName:"T",values:{itemType:2}}'];
  if (extraChild) {
    dets.push('R2:{schemaName:"R2D",entitySchemaName:"C2",filter:{detailColumn:"m",masterColumn:"Id"}}');
    items.push('{operation:"insert",name:"R2",parentName:"T",values:{itemType:2}}');
  }
  const f1 = renameField ? "MainRenamed" : "MainF";
  items.push(`{operation:"insert",name:"${f1}",parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"${f1}"}}`);
  if (extraField) items.push('{operation:"insert",name:"MainF2",parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"MainF2"}}');
  for (let i = 0; i < (bulk || 0); i++) {
    items.push(`{operation:"insert",name:"BulkF${i}",parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"BulkF${i}"}}`);
  }
  // Handlers are the heaviest row kind per unit, so a handful of them is what pushes a bucket over the budget
  // without needing a page body so large it stops resembling a real one.
  const methods = bulk
    ? ",methods:{" + Array.from({ length: 8 }, (_, i) => `onBulk${i}:function(){return this.get("x");}`).join(",") + "}"
    : "";
  return `define("MPage",[],function(){return{entitySchemaName:"M",details:{${dets.join(",")}},diff:[{operation:"insert",name:"T",parentName:"Tabs",values:{itemType:15,isTab:true}},${items.join(",")}]${methods}};});`;
};
const PLAN_META = { scope: "single-section", environment: "test", package: "P → UsrM", approach: "Parallel rebuild",
  whatItDoes: "M register.", sectionSchema: "MSection", listTemplate: "ListPageV3", formTemplate: "FormPageTemplate" };
const RESOLVED = { resolved: true, present: false };
const manifestOf = (edit = {}) => ({
  entity: "M", seed: SEED,
  schemas: [{ pkg: "P", body: mainBody(edit) }],
  detailSchemas: edit.extraChild
    ? { R1D: { entity: "C1", columns: ["Number"], editPage: "C1Page" }, R2D: { entity: "C2", columns: ["Number"], editPage: "C2Page" } }
    : { R1D: { entity: "C1", columns: ["Number"], editPage: "C1Page" } },
  childPageSchemas: edit.extraChild ? { C1Page: C1_BUNDLE, C2Page: leafBundle("C2", "C2Page") } : { C1Page: C1_BUNDLE },
  addRecordMiniPage: false,   // the agent's on-stand verification that none exists — else STRUCTURE is incomplete
  section: { schemas: [], listColumns: { success: true, sectionSchema: "MSection", entity: "M", source: "schema-default", columns: [{ name: "Name" }] } },
  planMeta: PLAN_META,
  signals: { dcm: RESOLVED, processes: RESOLVED, printables: RESOLVED, deduplication: RESOLVED },
});

// Fixtures A-F are all small enough that the DEFAULT budget would collapse them into one build task plus one
// review — which is the right answer for a run that size and the wrong fixture for everything below, all of which
// is about where the per-artifact boundaries fall. `run: 0` turns the collapse off so those boundaries exist to be
// checked; the collapse itself has its own block at the end, on the default budget.
const optsOf = (m) => ({ ...checklistOpts(m), taskBudget: { run: 0 } });

const MANIFEST = manifestOf();
const OPTS = optsOf(MANIFEST);                   // the SAME opts `buildTaskSet` forwards to `checklistGroups`
const RUN = runMigration(MANIFEST);
const SET = buildTaskSet(RUN, OPTS);
const GROUPS = checklistGroups(RUN, OPTS);

// B — the same plan with one page INSERTED (a second child page).
const MANIFEST2 = manifestOf({ extraChild: true });
const OPTS2 = optsOf(MANIFEST2);
const RUN2 = runMigration(MANIFEST2);
const SET2 = buildTaskSet(RUN2, OPTS2);

// C — the same plan with the same pages, but one task's DELIVERABLE ROWS changed (an extra form field). Kept apart
// from B on purpose: drift is about a row set moving under a recorded status, not about the page set moving.
const MANIFEST3 = manifestOf({ extraField: true });
const OPTS3 = optsOf(MANIFEST3);
const RUN3 = runMigration(MANIFEST3);
const SET3 = buildTaskSet(RUN3, OPTS3);
// `page:main` is where every group that writes the main form page now lands, so it is the task a changed
// deliverable drifts under. The old per-group name (`Form — Coverage (verified)`) is one of the groups INSIDE it.
const DRIFT_GROUP = "Page build";
const SCAFFOLD_LABEL = "Scaffolding";

// D — a field RENAMED and nothing else. The layout row still reads `Side profile — 1 field` and the coverage row
// still reads `Fields — 1 expected`: the caption and the count are both untouched, and only the verifier's expected
// NAMES move. Digesting labels alone reported no drift here, on exactly the change a built page must be re-checked
// against, so this fixture exists to keep that hole closed.
const MANIFEST4 = manifestOf({ renameField: true });
const OPTS4 = optsOf(MANIFEST4);
const RUN4 = runMigration(MANIFEST4);
const SET4 = buildTaskSet(RUN4, OPTS4);

// E — the same plan grown past the budget, so `page:main` is CUT into chunks. Everything about chunking below is
// vacuous on a plan small enough to stay monolithic, which manifests A-D all are.
const MANIFEST5 = manifestOf({ bulk: 40 });
const OPTS5 = optsOf(MANIFEST5);
const RUN5 = runMigration(MANIFEST5);
const SET5 = buildTaskSet(RUN5, OPTS5);
// F — E with ONE more field. Under count-derived chunk numbering every chunk after the first shifts and every
// status recorded against them orphans; under a structural anchor the chunks keep their ids.
const MANIFEST6 = manifestOf({ bulk: 41 });
const SET6 = buildTaskSet(runMigration(MANIFEST6), optsOf(MANIFEST6));

// The reference cache is a RUN-level task, not a page's — it is excluded wherever the question is about pages.
const pageTasks = (set) => set.tasks.filter((t) => t.artifact !== ARTIFACT_REFS);
const keysOf = (set) => [...new Set(pageTasks(set).map((t) => t.pageKey))];
const taskAt = (set, pageKey, group) => set.tasks.find((t) => t.pageKey === pageKey && t.group === group);
const orderOf = (set, pageKey, group) => taskAt(set, pageKey, group)?.order;
const artifactsOf = (set) => [...new Set(set.tasks.map((t) => t.artifact))];
const tasksOn = (set, artifact) => set.tasks.filter((t) => t.artifact === artifact);
const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `c2f_tasks_${label}_`));
// The (file, id) pairs actually on disk — what the regenerated index has to keep describing.
const readExistingMeta = (dir) => fs.readdirSync(dir)
  .filter((f) => f.endsWith(".md") && f !== TASK_INDEX_FILE)
  .map((f) => ({ file: f, id: parseTaskFile(fs.readFileSync(path.join(dir, f), "utf8")).meta?.id || null }));
const readIndex = (dir) => fs.readFileSync(path.join(dir, TASK_INDEX_FILE), "utf8");

// ---- dispatching a task the way a real run does ----------------------------------------------
// `--start` refuses a task whose `dependsOn` is still open, so a test that wants to exercise ONE task has to
// bring the queue to that task first. Flipping the dependencies to `done` by hand would not do it: they would
// then be closures with no dispatch record, which is the other thing `--start` refuses. So each dependency is
// dispatched, signed and closed, depth-first, exactly as the orchestrator would.
const AT = (min) => new Date(Date.UTC(2026, 0, 1, 12, min)).toISOString();
const taskFilePath = (dir, id) => path.join(dir, fs.readdirSync(dir).find((x) => x.endsWith(".md")
  && x !== TASK_INDEX_FILE && new RegExp(String.raw`^id: ${id}\s*$`, "m").test(fs.readFileSync(path.join(dir, x), "utf8"))));
const NOT_BUILT_BLOCKED = "not-built — blocked";
const rowCount = (text) => text.split("\n").filter((l) => { const c = l.split(/(?<!\\)\|/); return c.length >= 7 && /^\s*\d+\s*$/.test(c[1]); }).length;
const allBuilt = (text) => {
  let t = text;
  for (let i = 1; i <= rowCount(text); i++) { t = setOutcome(t, i, "built"); }
  return t;
};

// CLOSE A TASK THE WAY AN AGENT DOES: account for every row. Typing the word is not a closure.
const closeCells = (dir, id, mark = "built") => {
  const f = taskFilePath(dir, id);
  let text = fs.readFileSync(f, "utf8");
  const n = (text.match(/^\|\s*\d+\s*\|/gm) || []).length;
  // A LEGACY four-column table has no `Outcome` cell to fill, so there is nothing to account for and the
  // recorded word is the only close such a file has ever had.
  if (!/\| Outcome \|/.test(text)) {
    fs.writeFileSync(f, text.replace(/^status: .*$/m, "status: done"));
    return;
  }
  for (let i = 1; i <= n; i++) text = setOutcome(text, i, typeof mark === "function" ? mark(i) : mark);
  fs.writeFileSync(f, text);
};
// The shape a folder written BEFORE these fields carries: no `declared:`, no `statusFrom:`.
// A LEGACY body carries NEITHER field, so a fixture claiming that shape must strip both.
const asLegacyBody = (t) => t.split("\n")
  .filter((l) => !l.startsWith("declared:") && !l.startsWith("statusFrom:")).join("\n");
const asLegacyFile = (dir, id) => {
  const f = taskFilePath(dir, id);
  fs.writeFileSync(f, fs.readFileSync(f, "utf8")
    .replace(/^declared: .*$\n/m, "").replace(/^statusFrom: .*$\n/m, ""));
};
// Everything but the status line and the stamp that moves with it. The lines are REMOVED, not blanked, so a file
// that acquires a stamp still compares equal to one that never had it.
const sansStatusLines = (x) => x.split("\n")
  .filter((l) => !l.startsWith("status:") && !l.startsWith("statusFrom:")).join("\n");
const editFrontMatter = (dir, id, key, value) => {
  const f = taskFilePath(dir, id);
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(new RegExp(`^${key}:.*$`, "m"), `${key}: ${value}`));
};
// Dispatch + sign + close ONE task. Returns the token it was issued.
function runTask(dir, id, run, opts, min) {
  const token = `tok-${id}`;
  startTask(dir, id, run, { ...opts, dispatchToken: token }, null, AT(min));
  closeCells(dir, id);
  editFrontMatter(dir, id, "agentNonce", token);
  syncTaskDir(dir, run, { ...opts, now: AT(min + 1) });
  return token;
}
// Close everything `id` waits on, depth-first, so `id` itself can then be started.
function clearDepsOf(dir, id, run, opts, min = 0) {
  const byId = () => new Map(syncTaskDir(dir, run, opts).tasks.map((t) => [t.id, t]));
  const order = [], seen = new Set();
  const visit = (x) => {
    if (seen.has(x)) return;
    seen.add(x);
    const t = byId().get(x);
    if (!t) return;
    for (const d of t.dependsOn) visit(d);
    order.push(x);
  };
  for (const d of byId().get(id)?.dependsOn || []) visit(d);
  let m = min;
  for (const depId of order) {
    if (byId().get(depId)?.status === "done") continue;
    runTask(dir, depId, run, opts, m);
    m += 2;
  }
  return m;
}

console.log("\n===== fixture preconditions (anti-vacuity) =====");
// Asserted BEFORE anything reads the ordering: "a sub-page's tasks come before main's" and "list comes after main"
// are both trivially true on a plan that publishes neither, and a fixture that silently lost its child page would
// turn this whole runner green while testing nothing.
check("fixture: the plan is GATE-CLEAN — `planGaps` is empty, so every CLI check below exercises the writing path and not the refusal path",
  planGaps(RUN).length === 0, () => ({ gaps: planGaps(RUN), gate: RUN.gate?.reasons, structure: RUN.structure?.issues, coverage: RUN.coverage?.issues }));
check("fixture: the tree really is main + a folded child + its GRANDCHILD + a gated `list` page — four distinct page keys, so the ordering invariants below are not vacuous",
  () => {
    const keys = keysOf(SET);
    return keys.includes("main") && keys.includes("child:C1") && keys.includes("child:G1") && keys.includes(LIST_PAGE_KEY)
      && new Set(keys).size === 4 && subPageNodes(RUN).map((n) => n.pageKey).join(",") === "child:C1,child:G1";
  }, () => ({ keys: keysOf(SET), subs: subPageNodes(RUN).map((n) => n.pageKey) }));
check("fixture: inserting the second detail really INSERTS a page into the plan — manifest B publishes `child:C2` on top of A's four keys",
  keysOf(SET2).includes("child:C2") && keysOf(SET2).length === keysOf(SET).length + 1,
  () => ({ a: keysOf(SET), b: keysOf(SET2) }));
check("fixture: manifest C changes ONE task's deliverable rows and NO page — same page keys, same task count, but `main · Form — Coverage (verified)` really carries a different row set (else every drift check below is vacuous)",
  () => keysOf(SET3).join(",") === keysOf(SET).join(",") && SET3.tasks.length === SET.tasks.length
    && taskAt(SET3, "main", DRIFT_GROUP).rowsDigest !== taskAt(SET, "main", DRIFT_GROUP).rowsDigest,
  () => ({ a: taskAt(SET, "main", DRIFT_GROUP), c: taskAt(SET3, "main", DRIFT_GROUP) }));

console.log("\n===== buildTaskSet: one task per ARTIFACT, rows verbatim, nothing lost =====");
check("buildTaskSet: EVERY plan row lands in exactly one task — bucketing by artifact regroups who builds a row and must never drop one or hand the same one to two sub-agents",
  () => {
    const planRows = GROUPS.flatMap((g) => g.rows.map((r) => `${g.pageKey} ${g.baseTitle} ${r.label}`)).sort((a, b) => a.localeCompare(b));
    const taskRows = pageTasks(SET).flatMap((t) => t.rows.map((r) => `${t.pageKey} ${r.group} ${r.label}`)).sort((a, b) => a.localeCompare(b));
    return planRows.length === taskRows.length && planRows.every((k, i) => k === taskRows[i]);
  }, () => ({ plan: GROUPS.flatMap((g) => g.rows.map((r) => `${g.pageKey}·${g.baseTitle}·${r.label}`)).length,
    tasks: pageTasks(SET).flatMap((t) => t.rows.map((r) => `${t.pageKey}·${r.group}·${r.label}`)).length }));
check("buildTaskSet: a row keeps the plan GROUP it was read from — a task can span several groups, so without it the file could not say which part of the plan a deliverable belongs to",
  () => pageTasks(SET).every((t) => t.rows.every((r) => GROUPS.some((g) => g.pageKey === t.pageKey && g.baseTitle === r.group
    && g.rows.some((x) => x.label === r.label)))),
  () => pageTasks(SET).flatMap((t) => t.rows.map((r) => `${t.pageKey}·${r.group}`)));
check("buildTaskSet: rows inside a task are in the plan's own build order — bucketing changes WHO builds a row, never WHEN it is built relative to the others, so the Confirm worklist still precedes the layout it gates",
  () => {
    const t = taskAt(SET, "main", DRIFT_GROUP);
    const seen = t.rows.map((r) => r.group);
    return seen[0] === "⚠ Confirm worklist" && seen.lastIndexOf("⚠ Confirm worklist") < seen.indexOf("Form — Layout (by tab/region)");
  }, () => taskAt(SET, "main", DRIFT_GROUP).rows.map((r) => `${r.group} :: ${r.label.slice(0, 40)}`));
check("buildTaskSet: `gatedRows` / `naRows` are COUNTED off the task's own rows, not restated — each equals the number of rows carrying a `vk` / an `na`",
  () => SET.tasks.every((t) => t.gatedRows === t.rows.filter((r) => r.vk).length && t.naRows === t.rows.filter((r) => r.na).length),
  () => SET.tasks.map((t) => ({ t: `${t.pageKey}·${t.group}`, gated: t.gatedRows, na: t.naRows })));

console.log("\n===== artifacts: two tasks never write the same thing =====");
check("artifacts (anti-vacuity): the fixture really does fold SEVERAL plan groups into one artifact — `page:main` carries the layout, the coverage and the confirm worklist between them, so the no-two-writers invariant below is not trivially true",
  () => taskAt(SET, "main", DRIFT_GROUP).groups.length >= 3,
  () => taskAt(SET, "main", DRIFT_GROUP)?.groups);
check("artifacts: NO stand artifact has more than one task writing it unless those tasks are CHAINED — a page body handed to two sub-agents at once is the read-modify-write clobber the bucketing exists to remove",
  () => {
    const byArtifact = new Map();
    for (const t of SET5.tasks.filter((x) => x.writesTo)) {
      if (!byArtifact.has(t.writesTo)) byArtifact.set(t.writesTo, []);
      byArtifact.get(t.writesTo).push(t);
    }
    return [...byArtifact.values()].every((ts) => ts.length === 1
      || ts.slice(1).every((t, i) => t.dependsOn.includes(ts[i].id)));
  }, () => SET5.tasks.map((t) => `${t.order}:${t.writesTo || "—"}:${t.id}:deps=${t.dependsOn.join(",")}`));
check("artifacts: a review task WRITES NOTHING — it reads a built page and files a verdict, so it carries an empty `writesTo` and may run beside anything it does not depend on",
  () => {
    const reviews = SET.tasks.filter((t) => t.artifact.startsWith("review:"));
    return reviews.length >= 2 && reviews.every((t) => t.writesTo === "")
      && pageTasks(SET).filter((t) => !t.artifact.startsWith("review:")).every((t) => t.writesTo === t.artifact);
  }, () => SET.tasks.map((t) => `${t.artifact} → writesTo=${JSON.stringify(t.writesTo)}`));
check("artifacts: the scaffolding is its own artifact — the app/package/section placement and the page shells are the preconditions every page task builds into, not one page's body",
  () => {
    const s = SET.tasks.filter((t) => t.artifact === ARTIFACT_SCAFFOLD);
    return s.length === 1 && s[0].pageKey === "main" && s[0].order === 2 && s[0].group === SCAFFOLD_LABEL;
  }, () => artifactsOf(SET));
check("artifacts: every page key publishes its own `page:` artifact, and a child page's body is NEVER the same artifact as its parent's — two pages that shared one would be two sub-agents on one schema",
  () => {
    const pages = SET.tasks.filter((t) => t.artifact.startsWith("page:"));
    const byKey = new Map(pages.map((t) => [t.pageKey, t.artifact]));
    return byKey.size === 4 && new Set(byKey.values()).size === 4;
  }, () => SET.tasks.map((t) => `${t.pageKey} → ${t.artifact}`));

console.log("\n===== the reference cache: fetched once per run, and it blocks without writing =====");
// Every build sub-agent starts with an empty context and re-reads the guidance, the contracts and the component
// docs the previous one just read. One read-only task fetches them once and the rest are handed paths.
const REFS = SET.tasks.find((t) => t.artifact === ARTIFACT_REFS);
check("refs: the cache is the FIRST task of the run — a builder that starts before it has nothing to read and refetches everything, which is the cost the cache exists to remove",
  () => REFS?.order === 1 && REFS.group === "Reference cache",
  () => SET.tasks.slice(0, 3).map((t) => `${t.order}:${t.artifact}`));
check("refs: it writes NOTHING on the stand, yet EVERY other task depends on it — that pair is why a dependency is published separately from the write target instead of being inferred from it",
  () => REFS.writesTo === "" && REFS.dependsOn.length === 0
    && SET.tasks.filter((t) => t.id !== REFS.id).every((t) => t.dependsOn.includes(REFS.id)),
  () => SET.tasks.map((t) => `${t.artifact}:writes=${JSON.stringify(t.writesTo)}:deps=${t.dependsOn.join(",")}`));
check("refs: it names ONE spec file and names every page it covers — the engine renders a single design spec and has no per-page slice, so a row promising `--spec --page <key>` sent a run to cache the same file under two names and report both as written",
  () => {
    const spec = REFS.rows.filter((r) => r.label.includes(`${REFS_DIR}/spec`));
    return spec.length === 1 && !/--page/.test(spec[0].label)
      && keysOf(SET).every((k) => spec[0].label.includes(`\`${k}\``));
  },
  () => ({ keys: keysOf(SET), rows: REFS.rows.map((r) => r.label.slice(0, 60)) }));
check("refs: it names the shared files by PATH — the guidance topics and the design spec, plus the index whose TIERS are the invalidation story",
  () => [`${REFS_DIR}/guidance-`, `${REFS_DIR}/spec.md`, `${REFS_DIR}/index.md`]
    .every((f) => REFS.rows.some((r) => r.label.includes(f)))
    && REFS.rows.some((r) => /stable-docs/.test(r.label) && /plan/.test(r.label)),
  () => REFS.rows.map((r) => r.label.slice(0, 80)));
check("refs: the cache holds NOTHING a builder can fetch for itself — no tool contracts and no component docs, because one `get-tool-contract` call for eight tools returns ~55KB: a copy every builder can read is a summary, and summarising is what lost `optional-template-data-json` and a file list's `columns` on measured runs",
  () => {
    const text = renderTaskFile(REFS, SET);
    return !/contracts\.md/.test(text) && !/components\.md/.test(text)
      && /Tool contracts and component docs are NOT cached/.test(text)
      && /get-tool-contract/.test(text) && /get-component-info/.test(text);
  }, () => renderTaskFile(REFS, SET));
check("refs: a cache big enough to be CUT is chained like any other artifact — chunk 2 waits on chunk 1, and every build task still waits on the whole cache rather than on whichever chunk happened to be last",
  () => {
    const tight = buildTaskSet(RUN, { ...OPTS, taskBudget: { ...OPTS.taskBudget, chunk: 4 } });
    const refs = tight.tasks.filter((t) => t.artifact === ARTIFACT_REFS);
    if (refs.length < 2) return false;
    const ids = refs.map((t) => t.id);
    return refs[0].dependsOn.length === 0
      && refs.slice(1).every((t, i) => t.dependsOn.includes(refs[i].id))
      && tight.tasks.filter((t) => t.artifact !== ARTIFACT_REFS)
        .every((t) => ids.every((id) => t.dependsOn.includes(id)));
  }, () => buildTaskSet(RUN, { ...OPTS, taskBudget: { ...OPTS.taskBudget, chunk: 4 } }).tasks
    .map((t) => `${t.order}:${t.artifact}:${t.id}:deps=${t.dependsOn.join(",")}`));
check("refs: its rows are NOT plan deliverables — it is the engine's own preparation task, so it carries no `--verify` gate and no plan group",
  () => REFS.gatedRows === 0 && REFS.rows.every((r) => r.group === "Reference cache"),
  () => REFS.rows.map((r) => `${r.group}:${r.vk}`));

console.log("\n===== the budget: monolithic under it, cut on a structural seam over it =====");
check("budget (anti-vacuity): manifest A really is UNDER the budget and manifest E really is OVER it — otherwise 'monolithic' and 'chunked' below are the same fixture tested twice",
  () => tasksOn(SET, "page:main").length === 1 && tasksOn(SET5, "page:main").length > 1,
  () => ({ a: tasksOn(SET, "page:main").map((t) => t.weight), e: tasksOn(SET5, "page:main").map((t) => t.weight) }));
check("budget: a bucket under the budget is exactly ONE task — the monolithic case is the same contract with one chunk in it, not a second path with rules of its own",
  () => {
    const t = tasksOn(SET, "page:main")[0];
    return t.weight <= TASK_BUDGET.chunk && t.group === "Page build" && t.rows.length > 1;
  }, () => tasksOn(SET, "page:main").map((t) => ({ w: t.weight, rows: t.rows.length, label: t.group })));
check("budget: a bucket over the budget is CUT, and every chunk that is not a single oversized row stays within the budget — the point of the cut is a task one sub-agent can finish in one sitting",
  () => tasksOn(SET5, "page:main").every((t) => t.weight <= TASK_BUDGET.chunk || t.rows.length === 1),
  () => tasksOn(SET5, "page:main").map((t) => ({ w: t.weight, rows: t.rows.length })));
check("budget: a chunk NEVER splits a row — a structural unit (one region, one tab, one handler) is the smallest thing a task may be, so a row heavier than the whole budget gets a chunk to itself rather than being cut in half",
  () => {
    const all = tasksOn(SET5, "page:main").flatMap((t) => t.rows.map((r) => r.label));
    const planned = GROUPS.length && buildTaskSet(RUN5, OPTS5).tasks.filter((t) => t.artifact === "page:main")
      .flatMap((t) => t.rows.map((r) => r.label));
    return all.length === planned.length && new Set(all).size === all.length;
  }, () => tasksOn(SET5, "page:main").map((t) => t.rows.length));
check("budget: the chunks of one bucket are CONTIGUOUS in the queue and chained by `dependsOn` — they write one page body, so the queue order is the thing that keeps their writes from racing",
  () => {
    const chunks = tasksOn(SET5, "page:main");
    const orders = chunks.map((t) => t.order).sort((a, b) => a - b);
    return orders.at(-1) - orders[0] === orders.length - 1
      && chunks.slice(1).every((t, i) => t.dependsOn.includes(chunks[i].id));
  }, () => tasksOn(SET5, "page:main").map((t) => `${t.order}:${t.id}:deps=${t.dependsOn.join(",")}`));
check("budget: the thresholds are DECLARED, not buried at the call site — calibration changes with evidence, and `opts.taskBudget` overrides them without a code change",
  () => {
    const tight = buildTaskSet(RUN5, { ...OPTS5, taskBudget: { ...OPTS5.taskBudget, chunk: 8 } });
    const loose = buildTaskSet(RUN5, { ...OPTS5, taskBudget: { ...OPTS5.taskBudget, chunk: 10000 } });
    return typeof TASK_BUDGET.chunk === "number"
      && tight.tasks.filter((t) => t.artifact === "page:main").length > tasksOn(SET5, "page:main").length
      && loose.tasks.filter((t) => t.artifact === "page:main").length === 1;
  }, () => ({ declared: TASK_BUDGET,
    tight: buildTaskSet(RUN5, { ...OPTS5, taskBudget: { ...OPTS5.taskBudget, chunk: 8 } }).tasks.filter((t) => t.artifact === "page:main").length,
    loose: buildTaskSet(RUN5, { ...OPTS5, taskBudget: { ...OPTS5.taskBudget, chunk: 10000 } }).tasks.filter((t) => t.artifact === "page:main").length }));

console.log("\n===== dependsOn: the ordering the orchestrator can CHECK rather than infer =====");
check("dependsOn: the scaffolding depends on nothing and EVERY task that writes depends on it — a page cannot be saved into a package that does not exist yet",
  () => {
    const scaffold = SET.tasks.find((t) => t.artifact === ARTIFACT_SCAFFOLD);
    const refs = SET.tasks.find((t) => t.artifact === ARTIFACT_REFS);
    return scaffold.dependsOn.join(",") === refs.id
      && SET.tasks.filter((t) => t.writesTo && t.id !== scaffold.id).every((t) => t.dependsOn.includes(scaffold.id));
  }, () => SET.tasks.map((t) => `${t.group}:${t.writesTo || "—"}:deps=${t.dependsOn.join(",")}`));
check("dependsOn: a review depends on every task that wrote the page it judges — the `creatio-ui-guidelines` pass needs a page to look at, and half a page is what it would otherwise be handed",
  () => tasksOn(SET5, "review:main")[0].dependsOn.length >= tasksOn(SET5, "page:main").length
    && tasksOn(SET5, "page:main").every((p) => tasksOn(SET5, "review:main")[0].dependsOn.includes(p.id)),
  () => ({ review: tasksOn(SET5, "review:main")[0]?.dependsOn, page: tasksOn(SET5, "page:main").map((t) => t.id) }));
check("dependsOn: nothing depends on itself, and every id it names is a task in the same set — a dependency the orchestrator cannot resolve is one it will silently skip",
  () => {
    const ids = new Set(SET5.tasks.map((t) => t.id));
    return SET5.tasks.every((t) => !t.dependsOn.includes(t.id) && t.dependsOn.every((d) => ids.has(d)));
  }, () => SET5.tasks.map((t) => `${t.id}:${t.dependsOn.join(",")}`));
check("dependsOn: every dependency sits EARLIER in the queue — the queue order and the dependency graph must agree, or an orchestrator walking `order` dispatches a task whose precondition has not run",
  () => SET5.tasks.every((t) => t.dependsOn.every((d) => SET5.tasks.find((x) => x.id === d).order < t.order)),
  () => SET5.tasks.map((t) => `${t.order}:${t.id}→${t.dependsOn.join(",")}`));
check("buildTaskSet: every task is `origin: engine` / `status: todo` out of the box, and both values are in the published vocabularies",
  SET.tasks.every((t) => t.origin === "engine" && t.status === "todo")
  && TASK_ORIGINS.includes("engine") && TASK_ORIGINS.includes("orchestrator") && TASK_STATUSES[0] === "todo",
  () => ({ origins: TASK_ORIGINS, statuses: TASK_STATUSES }));
check("buildTaskSet: `order` is a dense 1..N sequence over the whole set — the orchestrator walks it as a queue, so a hole or a duplicate is a task nobody is handed",
  SET.tasks.every((t, i) => t.order === i + 1), () => SET.tasks.map((t) => t.order));

console.log("\n===== build order: leaf-first across pages, worklist-first within a page =====");
check("build order: the SCAFFOLDING leads every BUILD — it is not a page's layout but the app/section/package placement, the entity binding and the page shells, so a child page built before it would need a package that does not exist yet",
  () => pageTasks(SET)[0].pageKey === "main" && pageTasks(SET)[0].artifact === ARTIFACT_SCAFFOLD,
  () => SET.tasks.slice(0, 3).map((t) => `${t.order}:${t.pageKey}·${t.group}`));
check("build order: apart from that scaffolding task, EVERY sub-page's tasks come before `main`'s — leaf-first is a build requirement, not a preference: a related list's Add/Edit opens the child's own form, so the child page must exist before the parent list is wired to it",
  () => {
    const mainBuild = SET.tasks.filter((t) => t.pageKey === "main" && t.artifact !== ARTIFACT_SCAFFOLD);
    const firstMain = Math.min(...mainBuild.map((t) => t.order));
    const subKeys = new Set(subPageNodes(RUN).map((n) => n.pageKey));
    return mainBuild.length > 0 && SET.tasks.filter((t) => subKeys.has(t.pageKey)).every((t) => t.order < firstMain);
  }, () => SET.tasks.map((t) => `${t.order}:${t.pageKey}`));
check("build order: a GRANDCHILD precedes its own parent child page — reversing the parent-then-children walk puts every node after all of its descendants, so `child:G1` is built before `child:C1`",
  () => Math.max(...SET.tasks.filter((t) => t.pageKey === "child:G1").map((t) => t.order))
    < Math.min(...SET.tasks.filter((t) => t.pageKey === "child:C1").map((t) => t.order)),
  () => SET.tasks.map((t) => `${t.order}:${t.pageKey}`));
check("build order: the `list` page follows `main` — a list page's deliverables are gated off the built form page it opens",
  () => Math.min(...SET.tasks.filter((t) => t.pageKey === LIST_PAGE_KEY).map((t) => t.order))
    > Math.max(...SET.tasks.filter((t) => t.pageKey === "main").map((t) => t.order)),
  () => SET.tasks.map((t) => `${t.order}:${t.pageKey}`));
check("build order: within a page the `⚠ Confirm worklist` rows come FIRST — they are open questions answered by reading the stand, and resolving them after the page is built is how a page gets built against a guess. They are rows of the page task now, so the sub-agent that answers them is the one that builds against the answers.",
  () => ["main", "child:C1", "child:G1", LIST_PAGE_KEY].every((k) => {
    const first = SET.tasks.filter((t) => t.artifact === `page:${k}`).sort((a, b) => a.order - b.order)[0];
    if (!first) return true;
    const at = first.rows.findIndex((r) => r.group === "⚠ Confirm worklist");
    return at < 0 || at === 0;
  }), () => SET.tasks.map((t) => `${t.order}:${t.pageKey}·${t.group}[${t.rows.map((r) => r.group).join("|")}]`));
check("build order: within a page `Quality gates` is LAST — the `creatio-ui-guidelines` pass needs a page to look at",
  () => ["main", "child:C1", "child:G1", LIST_PAGE_KEY].every((k) => {
    const own = SET.tasks.filter((t) => t.pageKey === k);
    const gates = own.find((t) => t.artifact.startsWith("review:"));
    return !gates || gates.order === Math.max(...own.map((t) => t.order));
  }), () => SET.tasks.map((t) => `${t.order}:${t.pageKey}·${t.group}`));
check("build order: a page's tasks are CONTIGUOUS — no other page's task is interleaved into the middle of one page's build (main's scaffolding task is the one declared exception: it leads the run)",
  () => keysOf(SET).every((k) => {
    const orders = SET.tasks.filter((t) => t.pageKey === k && t.artifact !== ARTIFACT_SCAFFOLD)
      .map((t) => t.order).sort((a, b) => a - b);
    return orders.at(-1) - orders[0] === orders.length - 1;
  }), () => SET.tasks.map((t) => `${t.order}:${t.pageKey}·${t.group}`));

console.log("\n===== ids are content-derived, not positional =====");
check("ids: inserting a page into the plan does NOT renumber any id — every (pageKey, group) that survives keeps the SAME `id` across manifest A and B, so a recorded status stays attached to its own task",
  () => SET.tasks.every((t) => taskAt(SET2, t.pageKey, t.group)?.id === t.id),
  () => SET.tasks.filter((t) => taskAt(SET2, t.pageKey, t.group)?.id !== t.id)
    .map((t) => ({ task: `${t.pageKey}·${t.group}`, a: t.id, b: taskAt(SET2, t.pageKey, t.group)?.id })));
check("ids: `order` IS the field that moves — the inserted page pushes `main`'s page build further down the queue while its id stands still (else the check above would be vacuous)",
  () => orderOf(SET2, "main", DRIFT_GROUP) > orderOf(SET, "main", DRIFT_GROUP),
  () => ({ a: orderOf(SET, "main", DRIFT_GROUP), b: orderOf(SET2, "main", DRIFT_GROUP) }));
check("ids: a task whose ROWS changed is the SAME task with a changed deliverable, not a new task whose status resets — the added form field moves `main · Form — Coverage (verified)`'s `rowsDigest` while its `id` stands still",
  () => {
    const a = taskAt(SET, "main", DRIFT_GROUP), c = taskAt(SET3, "main", DRIFT_GROUP);
    return a.id === c.id && a.rowsDigest !== c.rowsDigest;
  }, () => ({ a: taskAt(SET, "main", DRIFT_GROUP), c: taskAt(SET3, "main", DRIFT_GROUP) }));
check("ids: an id is unique across the set, and two pages' identically-shaped tasks never collide — every page carries a `Page build` and a `Quality gates` task and they must still be told apart",
  () => new Set(SET.tasks.map((t) => t.id)).size === SET.tasks.length
    && taskAt(SET, "main", "Quality gates").id !== taskAt(SET, "child:C1", "Quality gates").id
    && taskAt(SET, "main", DRIFT_GROUP).id !== taskAt(SET, "child:C1", DRIFT_GROUP).id,
  () => SET.tasks.map((t) => `${t.id} ${t.pageKey}·${t.group}`));
check("ids: ONE MORE FIELD does not renumber the chunks — the anchor is the chunk's first row with its digits MASKED, so `Side profile — 40 fields` and `— 41 fields` are one anchor and every status recorded against a later chunk stays attached to it. Numbering the chunks instead is what orphans them all.",
  () => {
    const a = tasksOn(SET5, "page:main"), b = tasksOn(SET6, "page:main");
    return a.length > 1 && a.length === b.length && a.every((t, i) => t.id === b[i].id);
  }, () => ({ e: tasksOn(SET5, "page:main").map((t) => `${t.id}:${t.anchor}`),
    f: tasksOn(SET6, "page:main").map((t) => `${t.id}:${t.anchor}`) }));
check("ids: the anchor really is digit-masked (anti-vacuity) — the chunk that carries the field count has a DIFFERENT row label across E and F while its anchor is the same string, so the check above is not passing because nothing moved",
  () => {
    const a = tasksOn(SET5, "page:main"), b = tasksOn(SET6, "page:main");
    const la = a.flatMap((t) => t.rows.map((r) => r.label)).join("|");
    const lb = b.flatMap((t) => t.rows.map((r) => r.label)).join("|");
    return la !== lb && a.map((t) => t.anchor).join(",") === b.map((t) => t.anchor).join(",")
      && a.some((t) => /\d/.test(t.rows[0].label)) && a.every((t) => !/\d/.test(t.anchor.replace(/#\d+$/, "")));
  }, () => ({ e: tasksOn(SET5, "page:main").map((t) => t.rows[0].label), anchors: tasksOn(SET5, "page:main").map((t) => t.anchor) }));
check("ids: a RENAMED field moves the `rowsDigest` while the id stands still — the caption and the count are both untouched by a rename, so digesting labels alone reported no drift on exactly the change a built page has to be re-checked against",
  () => {
    const a = taskAt(SET, "main", DRIFT_GROUP), d = taskAt(SET4, "main", DRIFT_GROUP);
    const sameLabels = a.rows.map((r) => r.label).join("|") === d.rows.map((r) => r.label).join("|");
    return a.id === d.id && sameLabels && a.rowsDigest !== d.rowsDigest;
  }, () => ({ a: taskAt(SET, "main", DRIFT_GROUP)?.rowsDigest, d: taskAt(SET4, "main", DRIFT_GROUP)?.rowsDigest,
    labelsEqual: taskAt(SET, "main", DRIFT_GROUP)?.rows.map((r) => r.label).join("|")
      === taskAt(SET4, "main", DRIFT_GROUP)?.rows.map((r) => r.label).join("|") }));
check("taskFileName: the file name carries the id as well as a slug — non-Latin captions all strip to the same characters, so a slug ALONE would be many-to-one",
  () => SET.tasks.every((t) => t.file === taskFileName(t) && t.file.endsWith(`-${t.id}.md`))
    && new Set(SET.tasks.map((t) => t.file)).size === SET.tasks.length
    && taskFileName({ pageKey: "Ω", group: "✅", id: "abcd1234" }) === "task-task-abcd1234.md",
  () => SET.tasks.map((t) => t.file));

console.log("\n===== the task FILE: rendered, and read back =====");
const SAMPLE = taskAt(SET, "child:C1", DRIFT_GROUP);
const SAMPLE_TEXT = renderTaskFile(SAMPLE, SET);
check("renderTaskFile: the front matter carries the identity and the recorded state the next run reads back — id, status, origin, pageKey, group, order, rowsDigest",
  () => {
    const { meta, malformed } = parseTaskFile(SAMPLE_TEXT);
    return !malformed && meta.id === SAMPLE.id && meta.status === "todo" && meta.origin === "engine"
      && meta.pageKey === SAMPLE.pageKey && meta.group === SAMPLE.group && meta.order === String(SAMPLE.order)
      && meta.rowsDigest === SAMPLE.rowsDigest;
  }, () => parseTaskFile(SAMPLE_TEXT));
check("renderTaskFile: the front matter also carries what the ORCHESTRATOR needs to schedule it — the artifact it writes, the tasks it waits on, and an empty `agentNonce` for the sub-agent to fill",
  () => {
    const { meta } = parseTaskFile(SAMPLE_TEXT);
    return meta.writesTo === SAMPLE.writesTo && meta.dependsOn === SAMPLE.dependsOn.join(" ")
      && meta.agentNonce === "" && SAMPLE.dependsOn.length > 0;
  }, () => parseTaskFile(SAMPLE_TEXT).meta);
check("renderTaskFile: the file STATES the one-sub-agent contract and the parallelism rule it is bound by — the task file is the prompt the sub-agent is handed, so a rule that lives only in the orchestrator's instructions is a rule the reader never sees",
  () => /\*\*One sub-agent, one task:\*\*/.test(SAMPLE_TEXT) && /agentNonce/.test(SAMPLE_TEXT)
    && SAMPLE_TEXT.includes("`" + SAMPLE.writesTo + "`") && /no other task may be running against this artifact/.test(SAMPLE_TEXT)
    && /\*\*Depends on:\*\*/.test(SAMPLE_TEXT) && /Read their `## Notes` first/.test(SAMPLE_TEXT),
  () => SAMPLE_TEXT);
check("renderTaskFile: a read-only task says so instead of naming an artifact — a review that claimed a `writesTo` would block every task that shares its page for no reason",
  () => {
    const review = taskAt(SET, "child:C1", "Quality gates");
    const text = renderTaskFile(review, SET);
    return review.writesTo === "" && /\*\*Writes:\*\* nothing — read-only/.test(text);
  }, () => renderTaskFile(taskAt(SET, "child:C1", "Quality gates"), SET));
check("renderTaskFile: each deliverable row names the plan group it came from — a task spans several groups now, so the `From` column is what keeps the file saying which part of the plan a row is",
  () => /\| # \| From \| Deliverable \| Closed by \|/.test(SAMPLE_TEXT)
    && SAMPLE.rows.every((r) => SAMPLE_TEXT.includes(`| ${r.group} | ${r.label} |`)),
  () => SAMPLE_TEXT);
check("renderTaskFile: every deliverable row of the task is in the rendered table, numbered, with the mechanism that CLOSES it — a machine-checked row names `--verify` and its verifier kind",
  () => SAMPLE.rows.length > 0 && SAMPLE.rows.every((r, i) => new RegExp(String.raw`^\| ${i + 1} \| `, "m").test(SAMPLE_TEXT))
    && SAMPLE.rows.some((r) => r.vk)
    && SAMPLE.rows.filter((r) => r.vk).every((r) => SAMPLE_TEXT.includes("`--verify` (`" + r.vk + "`)")),
  () => SAMPLE_TEXT);
check("renderTaskFile: a row with no machine verifier is closed by an evidence record plus a judge verdict, and an approved-boundary row is marked N/A — the mechanism is stated per row, never left to the builder",
  () => {
    const t = { ...SAMPLE, rows: [{ label: "prose row", group: "Form — Logic", vk: null, na: null }, { label: "out of scope", group: "Pages", vk: null, na: "agreed boundary" }] };
    const text = renderTaskFile(t, SET);
    return text.includes("| an evidence record + a judge verdict |") && text.includes("| N/A — agreed boundary |");
  }, () => renderTaskFile({ ...SAMPLE, rows: [{ label: "prose row" }, { label: "out of scope", na: "agreed boundary" }] }, SET));
check("renderTaskFile: the deliverable block is marked engine-owned EXCEPT the Outcome column, and the notes block is marked as the caller's — the ownerships are stated in the file, not only in the module",
  /ENGINE-OWNED except the `Outcome` column, which is YOURS/.test(SAMPLE_TEXT) && /YOURS\. Never rewritten/.test(SAMPLE_TEXT),
  () => SAMPLE_TEXT);
check("parseTaskFile: `## Notes` is read back verbatim, with the guidance comment stripped — the caller's own record survives the round trip",
  () => parseTaskFile(renderTaskFile({ ...SAMPLE, notes: "built C1F\nevidence: ev-42" }, SET)).notes === "built C1F\nevidence: ev-42",
  () => JSON.stringify(parseTaskFile(renderTaskFile({ ...SAMPLE, notes: "built C1F\nevidence: ev-42" }, SET)).notes));
check("parseTaskFile: a file with no front matter, and one whose front matter is never terminated, are both reported as `malformed` — the engine says it could not read the status instead of returning a default one",
  () => parseTaskFile("# just a heading\n").malformed === "no front matter"
    && parseTaskFile("---\nid: abc\nstatus: done\n").malformed === "front matter is not terminated"
    && parseTaskFile("---\nid: abc\nstatus: done\n").meta.status === "done",
  () => ({ a: parseTaskFile("# just a heading\n"), b: parseTaskFile("---\nid: abc\nstatus: done\n") }));
check("parseTaskFile: tolerant about WHITESPACE — extra spacing around a front-matter value and around the `## Notes` heading still read",
  () => {
    const p = parseTaskFile("---\nid:   x1  \nstatus:\tdone \n---\n\n##   body\n\n## Notes  \n\n  kept  \n");
    return p.meta.id === "x1" && p.meta.status === "done" && p.notes === "kept";
  }, () => parseTaskFile("---\nid:   x1  \nstatus:\tdone \n---\n\n## Notes  \n\n  kept  \n"));

console.log("\n===== mergeTaskSet: the caller's recorded state survives a re-run =====");
const asExisting = (task, meta = {}, notes = "") => ({
  file: task.file, notes, malformed: null,
  meta: { id: task.id, status: "todo", origin: "engine", pageKey: task.pageKey, group: task.group,
    order: String(task.order), rowsDigest: task.rowsDigest, ...meta },
});
const MERGED = mergeTaskSet(SET, [
  asExisting(taskAt(SET, "main", SCAFFOLD_LABEL), { status: "in-progress" }, "half of the pages minted"),
  asExisting(taskAt(SET, "child:G1", "Quality gates"), { status: "done" }, "guidelines pass clean"),
]);
check("mergeTaskSet: a re-run KEEPS the caller's recorded `status` — the plan's rows are the engine's, the status is not",
  () => taskAt(MERGED, "main", SCAFFOLD_LABEL).status === "in-progress" && taskAt(MERGED, "child:G1", "Quality gates").status === "done",
  () => MERGED.tasks.map((t) => `${t.pageKey}·${t.group}=${t.status}`));
check("mergeTaskSet: a re-run KEEPS the caller's `## Notes` — the record of what was built, what was filed and what blocked is never the engine's to overwrite",
  () => taskAt(MERGED, "main", SCAFFOLD_LABEL).notes === "half of the pages minted"
    && taskAt(MERGED, "child:G1", "Quality gates").notes === "guidelines pass clean",
  () => MERGED.tasks.map((t) => `${t.pageKey}·${t.group}=${JSON.stringify(t.notes)}`));
check("mergeTaskSet: a task with no recorded state is untouched — merging does not invent a status or a note for a task the caller never opened",
  () => MERGED.tasks.filter((t) => t.status !== "todo").length === 2
    && MERGED.tasks.filter((t) => t.notes !== "").length === 2,
  () => MERGED.tasks.map((t) => `${t.status}:${JSON.stringify(t.notes)}`));
check("mergeTaskSet: a file the caller RENAMED keeps its name — the id is the identity, the file name is for a human opening the folder",
  () => {
    const t = taskAt(SET, "main", SCAFFOLD_LABEL);
    const m = mergeTaskSet(SET, [{ ...asExisting(t), file: "01-do-the-pages-first.md" }]);
    return taskAt(m, "main", SCAFFOLD_LABEL).file === "01-do-the-pages-first.md";
  });
check("mergeTaskSet: the engine's deliverable rows always LOSE to the current plan — a stale recorded row set is replaced by the plan's, and the fresh `rowsDigest` is what the rewritten file carries",
  () => {
    const t = taskAt(SET2, "main", SCAFFOLD_LABEL);
    const m = mergeTaskSet(SET2, [asExisting(taskAt(SET, "main", SCAFFOLD_LABEL), { status: "in-progress" })]);
    const got = taskAt(m, "main", SCAFFOLD_LABEL);
    return got.rows.length === t.rows.length && got.rowsDigest === t.rowsDigest
      && got.rows.every((r, i) => r.label === t.rows[i].label);
  }, () => taskAt(mergeTaskSet(SET2, [asExisting(taskAt(SET, "main", SCAFFOLD_LABEL))]), "main", "Pages"));

console.log("\n===== an unrecognised status is reported, never coerced =====");
const BOGUS = mergeTaskSet(SET, [asExisting(taskAt(SET, "main", SCAFFOLD_LABEL), { status: "kinda-done" })]);
check("status vocabulary: an unrecognised `status` is carried through AS-IS, never folded into `todo` — a mistyped status that silently read as 'not done' would re-dispatch a sub-agent onto a page that is already built",
  taskAt(BOGUS, "main", SCAFFOLD_LABEL).status === "kinda-done" && !TASK_STATUSES.includes("kinda-done"),
  () => taskAt(BOGUS, "main", SCAFFOLD_LABEL));
check("status vocabulary: the unrecognised value is REPORTED on the index's Attention section, naming the file and the vocabulary it must use",
  () => {
    const idx = renderTaskIndex(BOGUS);
    return /## Attention/.test(idx) && idx.includes("unrecognised status `kinda-done`") && idx.includes(TASK_STATUSES.join(" / "));
  }, () => renderTaskIndex(BOGUS));
check("status vocabulary: an unrecognised status counts as NEITHER done nor open — it is surfaced as `Other` in the index header rather than padding either number",
  () => /\*\*Done:\*\* 0 · \*\*Open:\*\* \d+ · \*\*Other:\*\* 1/.test(renderTaskIndex(BOGUS)),
  () => renderTaskIndex(BOGUS).split("\n")[2]);
check("unreadable file: a file the engine could not parse in full is refused, NOT read and NOT written — rewriting it would destroy the `## Notes` that record work already done on a stand",
  () => {
    const t = taskAt(SET, "main", SCAFFOLD_LABEL);
    const m = mergeTaskSet(SET, [{ file: t.file, notes: "", malformed: "front matter is not terminated", meta: { id: t.id } }]);
    return (m.blocked || []).some((b) => b.file === t.file && /front matter is not terminated/.test(b.reason))
      && renderTaskIndex(m).includes("NOT READ and NOT WRITTEN");
  }, () => mergeTaskSet(SET, [{ file: taskAt(SET, "main", SCAFFOLD_LABEL).file, notes: "", malformed: "front matter is not terminated", meta: { id: taskAt(SET, "main", SCAFFOLD_LABEL).id } }]).blocked);
check("unreadable file: a file with NO readable `id` is refused the same way — filtering it out as absent is what let a corrupted file's notes be overwritten by a task the engine then read as new",
  () => {
    const m = mergeTaskSet(SET, [{ file: "task-hand-edited.md", notes: "built already", malformed: "no front matter", meta: {} }]);
    return (m.blocked || []).some((b) => b.file === "task-hand-edited.md") && renderTaskIndex(m).includes("task-hand-edited.md");
  }, () => mergeTaskSet(SET, [{ file: "task-hand-edited.md", notes: "x", malformed: "no front matter", meta: {} }]).blocked);
check("unreadable file: its QUEUE ROW says `⚠ unread`, never the fresh task's default `todo` — the refused file may record `done`, and reading `todo` off the queue is how a sub-agent gets dispatched onto a page that is already built",
  () => {
    const t = taskAt(SET, "main", SCAFFOLD_LABEL);
    const m = mergeTaskSet(SET, [{ file: t.file, notes: "built already", malformed: "no front matter", meta: {} , }]);
    const broken = mergeTaskSet(SET, [{ file: t.file, notes: "x", malformed: "front matter is not terminated", meta: { id: t.id } }]);
    const idx = renderTaskIndex(broken);
    const row = idx.split("\n").find((l) => l.includes(t.file) && l.startsWith("|"));
    return m.blocked.length === 1 && /⚠ unread/.test(row) && !/☐ todo/.test(row);
  }, () => renderTaskIndex(mergeTaskSet(SET, [{ file: taskAt(SET, "main", SCAFFOLD_LABEL).file, notes: "x", malformed: "front matter is not terminated", meta: { id: taskAt(SET, "main", SCAFFOLD_LABEL).id } }])));
check("unreadable file: it counts as `Other`, not as an OPEN task — the queue must not claim to know a status nobody recorded",
  () => {
    const t = taskAt(SET, "main", SCAFFOLD_LABEL);
    const idx = renderTaskIndex(mergeTaskSet(SET, [{ file: t.file, notes: "x", malformed: "front matter is not terminated", meta: { id: t.id } }]));
    return /\*\*Other:\*\* 1/.test(idx) && new RegExp(String.raw`\*\*Open:\*\* ${SET.tasks.length - 1}`).test(idx);
  }, () => renderTaskIndex(mergeTaskSet(SET, [{ file: taskAt(SET, "main", SCAFFOLD_LABEL).file, notes: "x", malformed: "front matter is not terminated", meta: { id: taskAt(SET, "main", SCAFFOLD_LABEL).id } }])).split("\n")[2]);
check("duplicate id: when two files claim one `id` the engine cannot tell whose record it holds, so BOTH are refused and named — never a coin flip on `readdir` order that overwrites one of them",
  () => {
    const t = taskAt(SET, "main", SCAFFOLD_LABEL);
    const m = mergeTaskSet(SET, [asExisting(t, { status: "done" }), { ...asExisting(t, { status: "in-progress" }), file: "task-copy.md" }]);
    const files = new Set((m.blocked || []).map((b) => b.file));
    return files.has(t.file) && files.has("task-copy.md")
      && (m.blocked || []).every((b) => /claimed by more than one file/.test(b.reason));
  }, () => mergeTaskSet(SET, [asExisting(taskAt(SET, "main", SCAFFOLD_LABEL), { status: "done" }), { ...asExisting(taskAt(SET, "main", SCAFFOLD_LABEL), { status: "in-progress" }), file: "task-copy.md" }]).blocked);
check("duplicate id: an ORCHESTRATOR file carrying an engine task's `id` never becomes that task's record — copying a task file as a template would otherwise have the engine write the plan's rows into the file it promises never to rewrite",
  () => {
    const t = taskAt(SET, "main", SCAFFOLD_LABEL);
    const orch = { ...asExisting(t, { status: "in-progress" }), file: "task-orch-copy.md", meta: { ...asExisting(t, { status: "in-progress" }).meta, origin: "orchestrator" } };
    const m = mergeTaskSet(SET, [orch]);
    const same = m.tasks.find((x) => x.id === t.id);
    return same.origin === "engine" && same.file === t.file && same.status === "todo";
  }, () => mergeTaskSet(SET, [{ ...asExisting(taskAt(SET, "main", SCAFFOLD_LABEL), { status: "in-progress" }), file: "task-orch-copy.md", meta: { ...asExisting(taskAt(SET, "main", SCAFFOLD_LABEL), { status: "in-progress" }).meta, origin: "orchestrator" } }]).tasks.filter((x) => x.id === taskAt(SET, "main", SCAFFOLD_LABEL).id));

check("duplicate id: that orchestrator file is REFUSED by name rather than dropped — a file that appears in no queue row and on no `## Attention` line is one `syncTaskDir` would happily write the engine task over",
  () => {
    const t = taskAt(SET, "main", SCAFFOLD_LABEL);
    const orch = { ...asExisting(t, { status: "in-progress" }), file: "task-orch-copy.md", meta: { ...asExisting(t, { status: "in-progress" }).meta, origin: "orchestrator" } };
    const m = mergeTaskSet(SET, [orch]);
    const b = (m.blocked || []).find((x) => x.file === "task-orch-copy.md");
    return Boolean(b) && /also claimed by an engine task/.test(b.reason) && b.id === t.id
      && m.tasks.find((x) => x.id === t.id).unread === true;
  }, () => mergeTaskSet(SET, [{ ...asExisting(taskAt(SET, "main", SCAFFOLD_LABEL), { status: "in-progress" }), file: "task-orch-copy.md", meta: { ...asExisting(taskAt(SET, "main", SCAFFOLD_LABEL), { status: "in-progress" }).meta, origin: "orchestrator" } }]).blocked);
check("unreadable file: the refusal is linked by `id`, not by filename — a corrupted file the caller RENAMED still makes its task read `unread`, or the queue would dispatch a sub-agent onto a page whose only record (possibly `done`) sits in that file",
  () => {
    const t = taskAt(SET, "main", SCAFFOLD_LABEL);
    const m = mergeTaskSet(SET, [{ file: "renamed-by-hand.md", notes: "", malformed: "front matter is not terminated", meta: { id: t.id } }]);
    const same = m.tasks.find((x) => x.id === t.id);
    return same.unread === true && (m.blocked || []).some((b) => b.file === "renamed-by-hand.md" && b.id === t.id);
  }, () => mergeTaskSet(SET, [{ file: "renamed-by-hand.md", notes: "", malformed: "front matter is not terminated", meta: { id: taskAt(SET, "main", SCAFFOLD_LABEL).id } }]).tasks.filter((x) => x.id === taskAt(SET, "main", SCAFFOLD_LABEL).id));

console.log("\n===== a recorded status whose deliverables later changed is flagged =====");
// The recorded state is manifest A's; the plan is now manifest C's, whose `main · Form — Coverage (verified)`
// carries a different row set. `driftedOn(status)` is that one situation with the status varied.
const driftedOn = (status) => taskAt(mergeTaskSet(SET3, [asExisting(taskAt(SET, "main", DRIFT_GROUP), { status })]), "main", DRIFT_GROUP);
const DRIFT = driftedOn("done");
check("drift: a task recorded `done` against one row set, whose plan rows have CHANGED since, is flagged `drifted` — the row set it was closed against is not the row set now in the file",
  DRIFT.drifted === true, () => DRIFT);
check("drift: the flag is on the index's Attention section, naming `done` and telling the caller to re-check the task against the rows now in its file and to reopen it with `status: todo`",
  () => {
    const idx = renderTaskIndex(mergeTaskSet(SET3, [asExisting(taskAt(SET, "main", DRIFT_GROUP), { status: "done" })]));
    return /recorded `done`, but the plan's deliverables for it have CHANGED since/.test(idx)
      && /re-check it against the rows now in the file/.test(idx)
      && /re-opened \(`status: todo`\) or when the stale `rowsDigest:` line is emptied/.test(idx);
  }, () => renderTaskIndex(mergeTaskSet(SET3, [asExisting(taskAt(SET, "main", DRIFT_GROUP), { status: "done" })])));
check("drift: an UNCHANGED `done` task is NOT flagged — the signal is the changed row set, not the `done` status (else every re-run would cry drift)",
  () => taskAt(mergeTaskSet(SET, [asExisting(taskAt(SET, "main", DRIFT_GROUP), { status: "done" })]), "main", DRIFT_GROUP).drifted === false,
  () => taskAt(mergeTaskSet(SET, [asExisting(taskAt(SET, "main", DRIFT_GROUP), { status: "done" })]), "main", DRIFT_GROUP));
check("drift: EVERY status the caller recorded is falsified by a row change, not only `done` — `in-progress`, `blocked` and `n/a` were all recorded against the older deliverables too, and the Attention line says which one it was",
  () => ["in-progress", "blocked", "n/a"].every((s) => {
    const t = driftedOn(s);
    return t.drifted === true
      && renderTaskIndex(mergeTaskSet(SET3, [asExisting(taskAt(SET, "main", DRIFT_GROUP), { status: s })]))
        .includes(`status \`${s}\` was recorded against an OLDER set of deliverables`);
  }), () => ["in-progress", "blocked", "n/a"].map((s) => ({ s, drifted: driftedOn(s).drifted })));
check("drift: a task back at `todo` is NOT flagged and ADOPTS the current rows — reopening a task is what clears the held digest, so a re-opened task does not carry a warning about work nobody claims any more",
  () => {
    const t = driftedOn("todo");
    return t.drifted === false && t.recordedDigest === taskAt(SET3, "main", DRIFT_GROUP).rowsDigest;
  }, () => driftedOn("todo"));
check("drift: the digest the status was recorded AGAINST is what the rewritten file keeps for as long as that status stands — writing the current one would erase the warning on the very re-slice that must raise it",
  () => {
    const held = taskAt(SET, "main", DRIFT_GROUP).rowsDigest;
    const { meta } = parseTaskFile(renderTaskFile(DRIFT, SET3));
    return meta.rowsDigest === held && held !== taskAt(SET3, "main", DRIFT_GROUP).rowsDigest;
  }, () => parseTaskFile(renderTaskFile(DRIFT, SET3)).meta);
check("drift: the flagged task's DELIVERABLE rows are still the plan's current ones — the warning is about the recorded status, and it never freezes the task on the row set it was recorded for",
  () => {
    const now = taskAt(SET3, "main", DRIFT_GROUP);
    return DRIFT.rows.length === now.rows.length && DRIFT.rows.every((r, i) => r.label === now.rows[i].label);
  }, () => ({ merged: DRIFT.rows.map((r) => r.label), plan: taskAt(SET3, "main", DRIFT_GROUP).rows.map((r) => r.label) }));

console.log("\n===== agentNonce: one sub-agent per task, checked OUTSIDE the loop that could break it =====");
// The observed failure this exists for: an orchestrator handed 12 task files to 5 sub-agents and 10 to 1. The
// orchestrator composes the prompt and reads the reply, so it cannot also be the evidence that it dispatched one
// sub-agent per task. A nonce the sub-agent mints for itself is evidence neither of them controls.
const withNonce = (task, nonce, status = "done") => ({
  file: task.file, notes: "", malformed: null,
  meta: { id: task.id, status, origin: "engine", pageKey: task.pageKey, group: task.group,
    order: String(task.order), rowsDigest: task.rowsDigest, agentNonce: nonce },
});
check("agentNonce: a nonce recorded by the sub-agent SURVIVES a re-run — it is the caller's record like `status` and `## Notes`, and rewriting it away would erase the one fact that shows which session closed the task",
  () => {
    const t = taskAt(SET, "main", DRIFT_GROUP);
    const m = mergeTaskSet(SET, [withNonce(t, "sa-7f3c")]);
    return taskAt(m, "main", DRIFT_GROUP).agentNonce === "sa-7f3c"
      && parseTaskFile(renderTaskFile(taskAt(m, "main", DRIFT_GROUP), m)).meta.agentNonce === "sa-7f3c";
  }, () => taskAt(mergeTaskSet(SET, [withNonce(taskAt(SET, "main", DRIFT_GROUP), "sa-7f3c")]), "main", DRIFT_GROUP));
check("agentNonce: the SAME nonce on two task files is reported — that is one sub-agent that closed both, which is the contract violation, and it is found without asking either the orchestrator or the sub-agent",
  () => {
    const a = taskAt(SET, "main", DRIFT_GROUP), b = taskAt(SET, "child:C1", DRIFT_GROUP);
    const idx = renderTaskIndex(mergeTaskSet(SET, [withNonce(a, "sa-dup"), withNonce(b, "sa-dup")]));
    return /## Attention/.test(idx) && idx.includes("`agentNonce: sa-dup` is on 2 task files")
      && idx.includes(a.file) && idx.includes(b.file) && /one sub-agent per task/i.test(idx);
  }, () => renderTaskIndex(mergeTaskSet(SET, [withNonce(taskAt(SET, "main", DRIFT_GROUP), "sa-dup"),
    withNonce(taskAt(SET, "child:C1", DRIFT_GROUP), "sa-dup")])));
check("agentNonce: DISTINCT nonces are not reported — the signal is one session closing several tasks, not the presence of a nonce, else every honest run would raise it",
  () => {
    const a = taskAt(SET, "main", DRIFT_GROUP), b = taskAt(SET, "child:C1", DRIFT_GROUP);
    const idx = renderTaskIndex(mergeTaskSet(SET, [withNonce(a, "sa-1"), withNonce(b, "sa-2")]));
    return !/agentNonce/.test(idx);
  }, () => renderTaskIndex(mergeTaskSet(SET, [withNonce(taskAt(SET, "main", DRIFT_GROUP), "sa-1"),
    withNonce(taskAt(SET, "child:C1", DRIFT_GROUP), "sa-2")])));
check("agentNonce: an OPEN task with no nonce is not reported — nobody has closed it, so there is nothing it has failed to show",
  () => !/agentNonce/.test(renderTaskIndex(mergeTaskSet(SET, []))),
  () => renderTaskIndex(mergeTaskSet(SET, [])));
check("agentNonce: a task recorded `done` with an EMPTY nonce IS reported — leaving the field blank is the cheaper evasion, and reporting only duplicates would miss the session that closed ten tasks at once and marked none of them",
  () => {
    const t = taskAt(SET, "main", DRIFT_GROUP);
    const idx = renderTaskIndex(mergeTaskSet(SET, [withNonce(t, "")]));
    return /recorded `done` with NO `agentNonce`/.test(idx) && idx.includes(t.file);
  }, () => renderTaskIndex(mergeTaskSet(SET, [withNonce(taskAt(SET, "main", DRIFT_GROUP), "")])));
check("agentNonce: `in-progress` is NOT reported for a missing nonce — the sub-agent writes its file before it finishes, so the mark is required at `done` and not before",
  () => !/agentNonce/.test(renderTaskIndex(mergeTaskSet(SET, [withNonce(taskAt(SET, "main", DRIFT_GROUP), "", "in-progress")]))),
  () => renderTaskIndex(mergeTaskSet(SET, [withNonce(taskAt(SET, "main", DRIFT_GROUP), "", "in-progress")])));
check("agentNonce: the duplicate is caught END TO END on disk — two files that record the same nonce raise it on the regenerated index, which is where the orchestrator would actually meet it",
  () => {
    const dir = tmp("nonce");
    const first = syncTaskDir(dir, RUN, OPTS);
    for (const key of ["main", "child:C1"]) {
      const f = path.join(dir, taskAt(first, key, DRIFT_GROUP).file);
      fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("status: todo", "status: done").replace("agentNonce:", "agentNonce: sa-same"));
    }
    syncTaskDir(dir, RUN, OPTS);
    const idx = readIndex(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    return idx.includes("`agentNonce: sa-same` is on 2 task files");
  });

console.log("\n===== an orchestrator-authored task is read, never authored =====");
const ORCH_FILE = "task-orchestrator-deploy.md";
const orchExisting = (order, notes = "package pushed to the stand") => ({
  file: ORCH_FILE, notes, malformed: null,
  meta: { id: "orch0001", status: "in-progress", origin: "orchestrator", pageKey: "main", group: "Deploy the package", order },
});
check("origin: orchestrator: an orchestrator-authored task is carried through with its own status, notes and file, and is NEVER listed as stale — it is not the engine's to author or to retire",
  () => {
    const m = mergeTaskSet(SET, [orchExisting("3")]);
    const t = m.tasks.find((x) => x.origin === "orchestrator");
    return t?.status === "in-progress" && t.notes === "package pushed to the stand" && t.file === ORCH_FILE
      && t.group === "Deploy the package" && (m.stale || []).length === 0;
  }, () => mergeTaskSet(SET, [orchExisting("3")]));
check("origin: orchestrator: it is placed in the queue by its OWN `order` field — an `order: 3` task sits among the engine tasks rather than being appended at the end",
  () => {
    const m = mergeTaskSet(SET, [orchExisting("3")]);
    const at = m.tasks.findIndex((t) => t.origin === "orchestrator");
    return at > 0 && at < m.tasks.length - 1;
  }, () => mergeTaskSet(SET, [orchExisting("3")]).tasks.map((t) => `${t.order}:${t.origin}:${t.group}`));
check("origin: orchestrator: an `order` that is absent or unparseable sorts it AFTER every engine task instead of at the front — an unreadable field must not jump the queue",
  () => [undefined, "later"].every((o) => {
    const m = mergeTaskSet(SET, [orchExisting(o)]);
    return m.tasks[m.tasks.length - 1].origin === "orchestrator";
  }), () => mergeTaskSet(SET, [orchExisting("later")]).tasks.map((t) => `${t.order}:${t.origin}`));
check("origin: orchestrator: the merged set still carries a dense 1..N `order` with the orchestrator task in it — the queue the caller walks has no hole where the adopted task sits",
  () => {
    const m = mergeTaskSet(SET, [orchExisting("3")]);
    return m.tasks.every((t, i) => t.step === i + 1) && m.tasks.length === SET.tasks.length + 1;
  }, () => mergeTaskSet(SET, [orchExisting("3")]).tasks.map((t) => `${t.step}:${t.origin}`));
check("origin: orchestrator: `step` is the QUEUE position and is NOT written back into the orchestrator's own file — its declared `order` stands, because the engine never rewrites that file, and calling both `#` invited reading two different facts as one number",
  () => {
    const m = mergeTaskSet(SET, [orchExisting("3")]);
    const orch = m.tasks.find((t) => t.origin === "orchestrator");
    return orch.order === 3 && orch.step !== orch.order;
  }, () => mergeTaskSet(SET, [orchExisting("3")]).tasks.map((t) => `${t.step}/${t.order}:${t.origin}`));

console.log("\n===== the write chain is re-derived over the MERGED queue =====");
// `buildTaskSet` chains the tasks it authored. An orchestrator task is adopted afterwards and may declare a
// `writesTo` of its own — a repair task added for a page the engine already sliced is exactly that shape.
const orchWriter = (id, order, writesTo, dependsOn = "") => ({
  file: `task-orch-${id}.md`, notes: "", malformed: null,
  meta: { id, status: "todo", origin: "orchestrator", pageKey: "main", group: "Repair the form page",
    order: String(order), writesTo, dependsOn },
});
check("merged chain: an ORCHESTRATOR task that writes a page the engine already sliced is CHAINED to the engine task before it — sliced-time chaining alone left it in the queue writing a page body with nothing depending on it, which is the arrangement `writesTo` exists to make impossible",
  () => {
    const m = mergeTaskSet(SET, [orchWriter("orchw001", 99, "page:main")]);
    const orch = m.tasks.find((t) => t.id === "orchw001");
    const enginePage = m.tasks.filter((t) => t.artifact === "page:main" && t.origin === "engine");
    return orch.dependsOn.includes(enginePage.at(-1).id);
  }, () => mergeTaskSet(SET, [orchWriter("orchw001", 99, "page:main")]).tasks.map((t) => `${t.step}:${t.id}:${t.writesTo || "—"}:deps=${t.dependsOn.join(",")}`));
check("merged chain: the invariant holds on the MERGED set, not only on a fresh slice — every task writing one artifact is chained to the previous writer of it, engine and orchestrator tasks alike",
  () => {
    const m = mergeTaskSet(SET, [orchWriter("orchw002", 99, "page:main"), orchWriter("orchw003", 100, "page:main")]);
    const byArtifact = new Map();
    for (const t of m.tasks.filter((x) => x.writesTo)) {
      if (!byArtifact.has(t.writesTo)) byArtifact.set(t.writesTo, []);
      byArtifact.get(t.writesTo).push(t);
    }
    return [...byArtifact.values()].every((ts) => ts.slice(1).every((t, i) => t.dependsOn.includes(ts[i].id)));
  }, () => mergeTaskSet(SET, [orchWriter("orchw002", 99, "page:main"), orchWriter("orchw003", 100, "page:main")])
    .tasks.map((t) => `${t.step}:${t.id}:${t.writesTo || "—"}:deps=${t.dependsOn.join(",")}`));
check("merged chain: a dependency the ORCHESTRATOR declared is KEPT and added to, never replaced — it knows things about its own task the engine does not",
  () => {
    const m = mergeTaskSet(SET, [orchWriter("orchw004", 99, "page:main", "some-earlier-id")]);
    const orch = m.tasks.find((t) => t.id === "orchw004");
    return orch.dependsOn.includes("some-earlier-id") && orch.dependsOn.length > 1;
  }, () => mergeTaskSet(SET, [orchWriter("orchw004", 99, "page:main", "some-earlier-id")]).tasks.find((t) => t.id === "orchw004"));
check("merged chain: a read-only orchestrator task (no `writesTo`) joins no chain and blocks nobody — it still waits on the reference cache like everything else",
  () => {
    const m = mergeTaskSet(SET, [orchWriter("orchw005", 99, "")]);
    const orch = m.tasks.find((t) => t.id === "orchw005");
    const refs = m.tasks.find((t) => t.artifact === ARTIFACT_REFS);
    return orch.dependsOn.join(",") === refs.id
      && m.tasks.every((t) => !t.dependsOn.includes("orchw005"));
  }, () => mergeTaskSet(SET, [orchWriter("orchw005", 99, "")]).tasks.map((t) => `${t.id}:deps=${t.dependsOn.join(",")}`));
check("merged chain: no task depends on itself and every link points BACKWARDS in the queue — chaining by queue order is what makes a cycle impossible",
  () => {
    const m = mergeTaskSet(SET, [orchWriter("orchw006", 3, "page:main")]);
    const at = new Map(m.tasks.map((t) => [t.id, t.step]));
    return m.tasks.every((t) => !t.dependsOn.includes(t.id)
      && t.dependsOn.every((d) => !at.has(d) || at.get(d) < t.step));
  }, () => mergeTaskSet(SET, [orchWriter("orchw006", 3, "page:main")]).tasks.map((t) => `${t.step}:${t.id}→${t.dependsOn.join(",")}`));

console.log("\n===== an engine task that left the plan becomes stale, and is NOT deleted =====");
const GONE = mergeTaskSet(SET, [asExisting(taskAt(SET2, "child:C2", "Page build"), { status: "done" }, "built on the stand already")]);
check("stale: an engine task absent from the plan is reported as `stale` rather than being dropped silently",
  () => (GONE.stale || []).length === 1 && GONE.stale[0].file === taskAt(SET2, "child:C2", "Page build").file
    && !GONE.tasks.some((t) => t.id === taskAt(SET2, "child:C2", "Page build").id),
  () => GONE.stale);
check("stale: it is listed on the index with the reason it is KEPT — deleting the file is how a record of work already done on a stand disappears",
  () => {
    const idx = renderTaskIndex(GONE);
    return /## Attention/.test(idx) && /no longer in the plan \(kept, not deleted/.test(idx)
      && idx.includes(taskAt(SET2, "child:C2", "Page build").file);
  }, () => renderTaskIndex(GONE));

console.log("\n===== renderTaskIndex: derived, and complete =====");
check("renderTaskIndex: every task in the set has a row, in queue order, linking to its own file — the index is the queue the orchestrator walks",
  () => {
    const m = mergeTaskSet(SET, []);
    const idx = renderTaskIndex(m);
    return m.tasks.every((t) => idx.includes(`| ${t.step} | ${t.group} | \`${t.pageKey}\` |`) && idx.includes(`[${t.file}](${t.file})`));
  }, () => renderTaskIndex(SET));
check("renderTaskIndex: it states in the file itself that it is DERIVED and carries no fact of its own, and it names the plan version the folder was sliced from",
  () => /DERIVED FILE/.test(renderTaskIndex(SET)) && /it carries no fact/i.test(renderTaskIndex(SET))
    && /\*\*Plan version:\*\*/.test(renderTaskIndex(SET)),
  () => renderTaskIndex(SET).split("\n").slice(0, 8).join("\n"));
check("renderTaskIndex: with nothing to report there is NO Attention section — a clean run must not print an empty warning block for the caller to interpret",
  !/## Attention/.test(renderTaskIndex(SET)), () => renderTaskIndex(SET));

console.log("\n===== syncTaskDir: the task file is the record, the index is regenerated =====");
{
  const dir = tmp("sync");
  const first = syncTaskDir(dir, RUN, OPTS);
  const written = fs.readdirSync(dir).filter((f) => f !== TASK_INDEX_FILE).sort();
  check("syncTaskDir: it creates the folder and writes one file per task plus the index, and returns the set it wrote",
    written.length === first.tasks.length && first.tasks.every((t) => written.includes(t.file))
      && fs.existsSync(path.join(dir, TASK_INDEX_FILE)),
    () => ({ written, tasks: first.tasks.map((t) => t.file) }));
  // The caller records progress the only way the design sanctions: in the task's OWN file.
  const target = taskAt(first, "child:G1", "Quality gates");
  const p = path.join(dir, target.file);
  fs.writeFileSync(p, allBuilt(fs.readFileSync(p, "utf8")) + "\nguidelines pass filed as ev-7\n");
  const second = syncTaskDir(dir, RUN, OPTS);
  check("syncTaskDir: a re-run reads the recorded state back OFF THE FILES — the status and the notes written into one task file survive, and the index counts them",
    () => taskAt(second, "child:G1", "Quality gates").status === "done"
      && taskAt(second, "child:G1", "Quality gates").notes === "guidelines pass filed as ev-7"
      && /guidelines pass filed as ev-7/.test(fs.readFileSync(p, "utf8"))
      && /\*\*Done:\*\* 1 /.test(readIndex(dir)),
    () => ({ task: taskAt(second, "child:G1", "Quality gates"), header: readIndex(dir).split("\n")[2] }));
  // The index is DERIVED: editing it changes nothing, in both directions.
  fs.writeFileSync(path.join(dir, TASK_INDEX_FILE), "# hand-written nonsense\n");
  const third = syncTaskDir(dir, RUN, OPTS);
  check("syncTaskDir: the index is REGENERATED from the task files — an index destroyed (or a write killed halfway) costs nothing, because it carries no fact of its own",
    () => !/hand-written nonsense/.test(readIndex(dir)) && /DERIVED FILE/.test(readIndex(dir))
      && third.tasks.every((t) => readIndex(dir).includes(`[${t.file}](${t.file})`)),
    () => readIndex(dir).slice(0, 300));
  fs.writeFileSync(path.join(dir, TASK_INDEX_FILE), readIndex(dir).replaceAll("☐ todo", "✅ done"));
  const fourth = syncTaskDir(dir, RUN, OPTS);
  check("syncTaskDir: EDITING the index changes nothing — a status typed into the derived table is overwritten by what the task's own file says, so the two can never disagree about what is built",
    () => fourth.tasks.filter((t) => t.status === "done").length === 1 && /\*\*Done:\*\* 1 /.test(readIndex(dir)),
    () => ({ done: fourth.tasks.filter((t) => t.status === "done").map((t) => t.file), header: readIndex(dir).split("\n")[2] }));
  // An ORCHESTRATOR file dropped into the folder by hand: never rewritten, never removed.
  const orchPath = path.join(dir, ORCH_FILE);
  const ORCH_BODY = "---\nid: orch0001\nstatus: in-progress\norigin: orchestrator\npageKey: main\ngroup: Deploy the package\norder: 3\n---\n\n# Deploy the package\n\n## Notes\n\npackage pushed to the stand\n";
  fs.writeFileSync(orchPath, ORCH_BODY);
  const fifth = syncTaskDir(dir, RUN, OPTS);
  check("syncTaskDir: an `origin: orchestrator` file in the folder is left BYTE-FOR-BYTE as it was, is placed in the order by its own `order`, and appears on the index — read, never authored",
    // Its BODY is untouched. The `status:` line and the stamp beside it are the engine's, and a file that never
    // had a stamp acquires one the first time the engine writes its status.
    () => sansStatusLines(fs.readFileSync(orchPath, "utf8")) === sansStatusLines(ORCH_BODY)
      && fifth.tasks.some((t) => t.origin === "orchestrator" && t.file === ORCH_FILE)
      && readIndex(dir).includes(`[${ORCH_FILE}](${ORCH_FILE})`),
    () => ({ unchanged: fs.readFileSync(orchPath, "utf8") === ORCH_BODY, index: readIndex(dir) }));
  // An adopted `id` is free text from outside the engine, and it is interpolated into the `--start` commands the
  // CLI prints for a human to paste into a shell. A file whose `id` is not a task id is refused by name, exactly
  // as a colliding one is — and it never reaches the queue, so nothing carries that text onward.
  {
    const badPath = path.join(dir, "orch-bad-id.md");
    const BAD_ID = "x; rm -rf $HOME";
    fs.writeFileSync(badPath, `---
id: ${BAD_ID}
status: todo
origin: orchestrator
pageKey: main
group: Bad id
order: 4
---

## Notes

n/a
`);
    const withBad = syncTaskDir(dir, RUN, OPTS);
    check("syncTaskDir: an adopted file whose `id` is not a task id is REFUSED by name and never enters the queue — the id is interpolated into a command a human pastes into a shell, so its shape is checked where the file is adopted rather than trusted downstream",
      () => (withBad.blocked || []).some((b) => b.file === "orch-bad-id.md" && /not a task id/.test(b.reason))
        && !withBad.tasks.some((t) => t.id === BAD_ID),
      () => ({ blocked: (withBad.blocked || []).map((b) => b.file), ids: withBad.tasks.map((t) => t.id) }));
    fs.rmSync(badPath, { force: true });
    syncTaskDir(dir, RUN, OPTS);
  }
  check("syncTaskDir: an ENGINE task file IS rewritten from the plan — an edit to its deliverable table is replaced, because the rows are the plan's and the plan may have changed",
    () => {
      const ep = path.join(dir, taskAt(fifth, "main", SCAFFOLD_LABEL).file);
      fs.writeFileSync(ep, fs.readFileSync(ep, "utf8").replace(/^\| 1 \| .*$/m, "| 1 | a row I invented | nothing |"));
      syncTaskDir(dir, RUN, OPTS);
      return !/a row I invented/.test(fs.readFileSync(ep, "utf8"));
    });
  // DRIFT, end to end on disk: a task closed on one plan, re-sliced against a plan whose rows for it moved.
  check("syncTaskDir: a status recorded in a file, re-sliced against a plan whose rows for that task CHANGED, is flagged on the index and keeps the digest it was recorded against — the whole point of the folder is that a closed task cannot quietly stand for deliverables it was never closed against",
    () => {
      const dp = path.join(dir, taskAt(SET, "main", DRIFT_GROUP).file);
      // Closed the LEGACY way on purpose: this fixture is about a status recorded against an older row set, and
      // cells would make the re-slice compute `partial` and print that remedy instead of the drift one.
      fs.writeFileSync(dp, asLegacyBody(fs.readFileSync(dp, "utf8")).replace("status: todo", "status: done"));
      const drifted = syncTaskDir(dir, RUN3, OPTS3);
      return taskAt(drifted, "main", DRIFT_GROUP).drifted === true
        && /the plan's deliverables for it have CHANGED since/.test(readIndex(dir))
        && parseTaskFile(fs.readFileSync(dp, "utf8")).meta.rowsDigest === taskAt(SET, "main", DRIFT_GROUP).rowsDigest;
    }, () => readIndex(dir));
  check("syncTaskDir: re-opening that task (`status: todo`) clears the flag and adopts the plan's current rows — the warning is not sticky once the caller has acted on it",
    () => {
      const dp = path.join(dir, taskAt(SET, "main", DRIFT_GROUP).file);

      fs.writeFileSync(dp, fs.readFileSync(dp, "utf8").replace("status: done", "status: todo"));
      const reopened = syncTaskDir(dir, RUN3, OPTS3);
      return taskAt(reopened, "main", DRIFT_GROUP).drifted === false
        && !/the plan's deliverables for it have CHANGED since/.test(readIndex(dir))
        && parseTaskFile(fs.readFileSync(dp, "utf8")).meta.rowsDigest === taskAt(SET3, "main", DRIFT_GROUP).rowsDigest;
    }, () => readIndex(dir));
  syncTaskDir(dir, RUN, OPTS);   // back to plan A before the grow/shrink pair below
  // Grow the plan (manifest B), then shrink it back: `child:C2`'s files are on disk while the plan omits them.
  const grown = syncTaskDir(dir, RUN2, OPTS2);
  const c2File = taskAt(SET2, "child:C2", "Page build").file;
  check("syncTaskDir: a RENAMED corrupted file gets no duplicate written beside it — the fresh `todo` file the engine would otherwise emit is a second record for one task, and the queue would schedule the wrong one",
    () => {
      const d2 = tmp("renamed");
      const t = taskAt(SET, "main", SCAFFOLD_LABEL);
      const broken = path.join(d2, "renamed-by-hand.md");
      fs.writeFileSync(broken, `---\nid: ${t.id}\nstatus: done\n`);   // front matter never terminated
      const before = fs.readFileSync(broken, "utf8");
      const merged = syncTaskDir(d2, RUN, OPTS);
      return !fs.existsSync(path.join(d2, t.file))
        && fs.readFileSync(broken, "utf8") === before
        && merged.tasks.find((x) => x.id === t.id).unread === true;
    },
    () => "see the folder listing for the renamed-refusal case");
  check("syncTaskDir: NOTHING is ever deleted — a plan that GREW keeps every file already in the folder, the orchestrator's included",
    () => grown.tasks.length > fifth.tasks.length && fs.existsSync(orchPath)
      && fifth.tasks.every((t) => fs.existsSync(path.join(dir, t.file))),
    () => fs.readdirSync(dir));
  const shrunk = syncTaskDir(dir, RUN, OPTS);
  check("syncTaskDir: a task file whose task LEFT the plan stays on disk and is listed as stale on the index — a folder is a record of work done on a stand, and deleting a file is how that record disappears",
    () => fs.existsSync(path.join(dir, c2File)) && (shrunk.stale || []).some((s) => s.file === c2File)
      && /no longer in the plan \(kept, not deleted/.test(readIndex(dir)) && readIndex(dir).includes(c2File),
    () => ({ stale: shrunk.stale, exists: fs.existsSync(path.join(dir, c2File)) }));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("\n===== the split: a cut decided once, validated here, frozen in the folder =====");
// The fixture's whole plan, as a split file would name it. Built FROM the groups so the test cannot drift out of
// step with the plan: a hand-typed row list would start passing for the wrong reason the moment a row changed.
const allRows = (pageKey) => GROUPS.filter((g) => g.pageKey === pageKey).flatMap((g) => g.rows.map((r) => r.label));
const splitItem = (id, pageKey, writesTo, rows, extra = {}) => ({ id, title: id, pageKey, writesTo, rows, ...extra });
const FULL_SPLIT = { planVersion: RUN.planVersion, items: keysOf(SET).map((k) =>
  splitItem(`build-${slugKey(k)}`, k, k === "main" ? "main" : k, allRows(k))) };
function slugKey(k) { return k.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-/, "").replace(/-$/, ""); }

// The four deliberately-broken variants, built once so the assertion and its failure detail cannot drift apart.
const withItem = (extra) => ({ ...FULL_SPLIT, items: [...FULL_SPLIT.items, extra] });
const mapMain = (fn) => ({ ...FULL_SPLIT, items: FULL_SPLIT.items.map((i) => i.pageKey === "main" ? fn(i) : i) });
const DUP_SPLIT = () => withItem(splitItem("second-claim", "main", "main", [allRows("main")[0]]));
const BOGUS_SPLIT = () => withItem(splitItem("invented", "main", "main", ["Build the thing the plan forgot"]));
const SHORT_SPLIT = () => mapMain((i) => ({ ...i, rows: i.rows.slice(1) }));
const BAD_WRITES_SPLIT = () => mapMain((i) => ({ ...i, writesTo: "mian" }));

check("split (anti-vacuity): the fixture split really covers EVERY plan row across all four pages — otherwise the coverage checks below pass because there is nothing to miss",
  () => {
    const inSplit = FULL_SPLIT.items.flatMap((i) => i.rows).length;
    const inPlan = GROUPS.flatMap((g) => g.rows).length;
    return inSplit === inPlan && inPlan > 30;
  }, () => ({ split: FULL_SPLIT.items.flatMap((i) => i.rows).length, plan: GROUPS.flatMap((g) => g.rows).length }));
check("split: a complete cut builds a task per ITEM — the seams are the file's, and the engine's own budget does not decide them",
  () => {
    const set = buildTaskSetFromSplit(RUN, FULL_SPLIT, OPTS);
    const build = set.tasks.filter((t) => t.artifact !== ARTIFACT_REFS);
    return !set.refused && build.length === FULL_SPLIT.items.length
      && build.every((t, i) => t.id === FULL_SPLIT.items[i].id);
  }, () => buildTaskSetFromSplit(RUN, FULL_SPLIT, OPTS).problems
    || buildTaskSetFromSplit(RUN, FULL_SPLIT, OPTS).tasks.map((t) => `${t.order}:${t.id}`));
check("split: the item's `id` IS the task's identity — a frozen cut does not move, so the slug someone chose survives any change to the rows inside it (the mechanical slicer had to hash content because it re-decided the cut every run)",
  () => {
    const set = buildTaskSetFromSplit(RUN, FULL_SPLIT, OPTS);
    const set3 = buildTaskSetFromSplit(RUN3, FULL_SPLIT, OPTS3);   // manifest C: one task's rows changed
    const a = set.tasks.find((t) => t.id === "build-main");
    const c = set3.tasks.find((t) => t.id === "build-main");
    return a && c && a.id === c.id && a.rowsDigest !== c.rowsDigest;
  }, () => "see build-main across manifests A and C");
check("split: EVERY plan row still lands in exactly one task — the guarantee the mechanical slicer gave is the one the engine keeps when the cut becomes a judgement",
  () => {
    const set = buildTaskSetFromSplit(RUN, FULL_SPLIT, OPTS);
    const planRows = GROUPS.flatMap((g) => g.rows.map((r) => `${g.pageKey} ${r.label}`)).sort((a, b) => a.localeCompare(b));
    const taskRows = set.tasks.filter((t) => t.artifact !== ARTIFACT_REFS)
      .flatMap((t) => t.rows.map((r) => `${t.pageKey} ${r.label}`)).sort((a, b) => a.localeCompare(b));
    return planRows.length === taskRows.length && planRows.every((k, i) => k === taskRows[i]);
  }, () => "row sets differ");
check("split: a row claimed by TWO items is REFUSED and names both — one deliverable handed to two sub-agents is the failure the whole artifact model exists to prevent",
  () => {
    const set = buildTaskSetFromSplit(RUN, DUP_SPLIT(), OPTS);
    return set.refused && set.problems.some((p) => /is claimed 2 times/.test(p) && p.includes("second-claim"));
  }, () => buildTaskSetFromSplit(RUN, DUP_SPLIT(), OPTS).problems);
check("split: a row the plan does NOT have is REFUSED — a split naming work the plan never described would schedule a sub-agent against a deliverable nothing can verify",
  () => {
    const set = buildTaskSetFromSplit(RUN, BOGUS_SPLIT(), OPTS);
    return set.refused && set.problems.some((p) => /claims a row the plan does not have/.test(p));
  }, () => buildTaskSetFromSplit(RUN, BOGUS_SPLIT(), OPTS).problems);
check("split: a plan row in NO item is REFUSED and named, and the engine picks no owner — a row nobody claims is work nobody is scheduled to do, and which item it belongs to is exactly the judgement the split records",
  () => {
    const set = buildTaskSetFromSplit(RUN, SHORT_SPLIT(), OPTS);
    return set.refused && set.tasks.length === 0
      && set.problems.some((p) => /is in NO item/.test(p) && /will not pick an owner/.test(p));
  }, () => buildTaskSetFromSplit(RUN, SHORT_SPLIT(), OPTS).problems);
check("split (anti-vacuity): the SAME split with that row restored resolves and builds — the refusal above is the unclaimed row, not the fixture",
  () => {
    const set = buildTaskSetFromSplit(RUN, FULL_SPLIT, OPTS);
    return !set.refused && set.tasks.length > 0;
  }, () => buildTaskSetFromSplit(RUN, FULL_SPLIT, OPTS).problems);
check("split: matching MASKS DIGITS, so a plan that gains a field does not stop the split resolving — the counts are exactly what a growing plan moves, and a cut that needed re-deciding on every added field would not be worth freezing",
  () => {
    const set3 = buildTaskSetFromSplit(RUN3, FULL_SPLIT, OPTS3);   // C: `Fields — 1 expected` became `2 expected`
    return !set3.refused && set3.problems.length === 0
      && rowKey("Fields — 19 expected") === rowKey("Fields — 20 expected");
  }, () => buildTaskSetFromSplit(RUN3, FULL_SPLIT, OPTS3).problems);
check("split: an item left with NO rows by a changed plan is reported and KEPT, never deleted — its file may hold the only record of work already done on a stand",
  () => {
    const extra = { ...FULL_SPLIT, items: [...FULL_SPLIT.items, splitItem("gone-from-plan", "main", "main", [])] };
    // An empty `rows` array is refused by `parseSplit`, so this is the runtime shape: an item whose rows all left.
    const resolved = resolveSplit({ items: [{ id: "gone", title: "gone", pageKey: "main", rows: ["a row that left the plan"] }] }, GROUPS, new Map());
    return resolved.errors.length === 1 && /claims a row the plan does not have/.test(resolved.errors[0])
      && parseSplit(JSON.stringify(extra)).errors.some((e) => /claims no rows/.test(e));
  }, () => parseSplit(JSON.stringify({ ...FULL_SPLIT, items: [...FULL_SPLIT.items, splitItem("gone-from-plan", "main", "main", [])] })).errors);
check("split: two items writing ONE page are chained — the file says where the seams are, the engine still guarantees they are never two writers at once",
  () => {
    const rows = allRows("main");
    const two = { ...FULL_SPLIT, items: [
      ...FULL_SPLIT.items.filter((i) => i.pageKey !== "main"),
      splitItem("main-a", "main", "main", rows.slice(0, 5)),
      splitItem("main-b", "main", "main", rows.slice(5)),
    ] };
    const set = buildTaskSetFromSplit(RUN, two, OPTS);
    const b = set.tasks.find((t) => t.id === "main-b");
    return !set.refused && b.dependsOn.includes("main-a") && b.writesTo === set.tasks.find((t) => t.id === "main-a").writesTo;
  }, () => "see main-a / main-b chain");
check("split: a READ-ONLY item joins no chain and blocks nobody — a recon item that answered the on-stand questions writes nothing, so nothing may wait on it by write conflict (only by an explicit dependency)",
  () => {
    const rows = allRows("main");
    const withRecon = { ...FULL_SPLIT, items: [
      splitItem("recon", "main", "", rows.slice(0, 3)),
      ...FULL_SPLIT.items.filter((i) => i.pageKey !== "main"),
      splitItem("main-build", "main", "main", rows.slice(3)),
    ] };
    const set = buildTaskSetFromSplit(RUN, withRecon, OPTS);
    const recon = set.tasks.find((t) => t.id === "recon");
    return !set.refused && recon.writesTo === "" && !set.tasks.some((t) => t.id !== "recon" && t.dependsOn.includes("recon"));
  }, () => buildTaskSetFromSplit(RUN, FULL_SPLIT, OPTS).tasks.map((t) => `${t.id}:${t.writesTo}`));
check("split: `writesTo` naming a page the plan does not publish is REFUSED — the item would write an artifact nothing else is chained against, which is the silent-collision case spelled as a typo",
  () => {
    const set = buildTaskSetFromSplit(RUN, BAD_WRITES_SPLIT(), OPTS);
    return set.refused && set.problems.some((p) => /which is not a page in this plan/.test(p));
  }, () => buildTaskSetFromSplit(RUN, BAD_WRITES_SPLIT(), OPTS).problems);
// The folded-chain rule is about the ROW TEXT — the plan writes `(ported with \`X\`)` into the helper's own label —
// so it is tested against groups carrying exactly those labels rather than against a manifest coaxed into folding.
const CHAIN_GROUPS = [{ pageKey: "main", baseTitle: "Form — Logic", rows: [
  { label: "Handler — `onContactChange`" },
  { label: "Handler — `setContactInfo` (ported with `onContactChange`)" },
  { label: "Handler — `clearContactInfo` (ported with `onContactChange`)" },
  { label: "Handler — `onSaved`" },
] }];
const chainSplit = (items) => resolveSplit({ items }, CHAIN_GROUPS, new Map());
// A GROUP claim. The plan this exists for carries 282 custom methods on one typed form and 188 on another; a split
// naming several hundred rows verbatim is a file nobody authors and one typo refuses whole.
const BULK_GROUPS = [{ pageKey: "main", baseTitle: "Form — Logic", rows:
  Array.from({ length: 12 }, (_, i) => ({ label: `Handler — \`h${i}\`` })) },
  { pageKey: "main", baseTitle: "Card actions", rows: [{ label: "Card action — Print" }] }];
const bulkSplit = (items) => resolveSplit({ items }, BULK_GROUPS, new Map());
check("split: `@<group>` claims every unclaimed row of that group — a plan whose checklist runs to several hundred rows has to be expressible in a file a person or an agent can actually write",
  () => {
    const r = bulkSplit([
      { id: "logic", title: "l", pageKey: "main", writesTo: "main", rows: ["@Form — Logic"] },
      { id: "actions", title: "a", pageKey: "main", writesTo: "main", rows: ["@Card actions"] },
    ]);
    return r.errors.length === 0 && r.unplaced.length === 0
      && r.items[0].rows.length === 12 && r.items[1].rows.length === 1;
  }, () => bulkSplit([{ id: "logic", title: "l", pageKey: "main", writesTo: "main", rows: ["@Form — Logic"] },
    { id: "actions", title: "a", pageKey: "main", writesTo: "main", rows: ["@Card actions"] }]).errors);
check("split: `@<group>[N]` takes the next N in PLAN ORDER, so repeated claims cut one long group into CONSECUTIVE chunks — an arbitrary selection would put two halves of a chain in different items, which is the defect the rows exist to avoid",
  () => {
    const r = bulkSplit([
      { id: "logic-a", title: "a", pageKey: "main", writesTo: "main", rows: ["@Form — Logic[5]"] },
      { id: "logic-b", title: "b", pageKey: "main", writesTo: "main", rows: ["@Form — Logic[5]"] },
      { id: "logic-c", title: "c", pageKey: "main", writesTo: "main", rows: ["@Form — Logic", "@Card actions"] },
    ]);
    const labels = (i) => r.items[i].rows.map((x) => x.label);
    return r.errors.length === 0 && r.unplaced.length === 0
      && labels(0).join() === Array.from({ length: 5 }, (_, i) => `Handler — \`h${i}\``).join()
      && labels(1).join() === Array.from({ length: 5 }, (_, i) => `Handler — \`h${i + 5}\``).join()
      && r.items[2].rows.length === 3;
  }, () => bulkSplit([{ id: "logic-a", title: "a", pageKey: "main", writesTo: "main", rows: ["@Form — Logic[5]"] },
    { id: "logic-b", title: "b", pageKey: "main", writesTo: "main", rows: ["@Form — Logic[5]"] },
    { id: "logic-c", title: "c", pageKey: "main", writesTo: "main", rows: ["@Form — Logic", "@Card actions"] }])
    .items.map((i) => i.rows.map((x) => x.label)));
check("split: naming a row explicitly still WINS over a later group claim — that is how the seams that matter stay expressible while the bulk of a long group is swept in one entry",
  () => {
    const r = bulkSplit([
      { id: "pinned", title: "p", pageKey: "main", writesTo: "main", rows: ["Handler — `h7`", "@Card actions"] },
      { id: "rest", title: "r", pageKey: "main", writesTo: "main", rows: ["@Form — Logic"] },
    ]);
    return r.errors.length === 0 && r.unplaced.length === 0
      && r.items[0].rows.some((x) => x.label === "Handler — `h7`")
      && r.items[1].rows.length === 11 && !r.items[1].rows.some((x) => x.label === "Handler — `h7`");
  }, () => bulkSplit([{ id: "pinned", title: "p", pageKey: "main", writesTo: "main", rows: ["Handler — `h7`", "@Card actions"] },
    { id: "rest", title: "r", pageKey: "main", writesTo: "main", rows: ["@Form — Logic"] }]).items.map((i) => i.rows.length));
check("split: a group the plan does not have is REFUSED and the error LISTS the groups that page does have — a typo in a group name would otherwise silently claim nothing and leave the whole group unplaced",
  () => {
    const r = bulkSplit([{ id: "x", title: "x", pageKey: "main", writesTo: "main", rows: ["@Form — Logik"] }]);
    return r.errors.length === 1 && /which the plan does not have/.test(r.errors[0])
      && r.errors[0].includes("Form — Logic") && r.errors[0].includes("Card actions");
  }, () => bulkSplit([{ id: "x", title: "x", pageKey: "main", writesTo: "main", rows: ["@Form — Logik"] }]).errors);
check("split: a group claim that finds EVERYTHING already taken is refused — an item that ends up with no rows is work the plan does not describe, and silently emitting it would schedule a sub-agent with nothing to build",
  () => {
    const r = bulkSplit([
      { id: "first", title: "f", pageKey: "main", writesTo: "main", rows: ["@Form — Logic", "@Card actions"] },
      { id: "second", title: "s", pageKey: "main", writesTo: "main", rows: ["@Form — Logic"] },
    ]);
    return r.errors.length === 1 && /every row of it is already/.test(r.errors[0]) && r.errors[0].includes("second");
  }, () => bulkSplit([{ id: "first", title: "f", pageKey: "main", writesTo: "main", rows: ["@Form — Logic", "@Card actions"] },
    { id: "second", title: "s", pageKey: "main", writesTo: "main", rows: ["@Form — Logic"] }]).errors);
check("split: the folded-chain rule still applies to rows claimed by GROUP — the guarantee is about where rows END UP, never about how the file happened to name them",
  () => {
    const groups = [{ pageKey: "main", baseTitle: "Form — Logic", rows: [
      { label: "Handler — `onContactChange`" },
      { label: "Handler — `setContactInfo` (ported with `onContactChange`)" },
    ] }];
    const r = resolveSplit({ items: [
      { id: "one", title: "1", pageKey: "main", writesTo: "main", rows: ["Handler — `onContactChange`"] },
      { id: "two", title: "2", pageKey: "main", writesTo: "main", rows: ["@Form — Logic"] },
    ] }, groups, new Map());
    return r.errors.length === 1 && /the plan folds it under/.test(r.errors[0]);
  });

check("split: a folded helper separated from its caller is REFUSED — the plan says in the row itself that the two are one piece of work, so this seam is one the engine can CHECK rather than trust, and it is the seam the row-count slicer actually got wrong",
  () => {
    const r = chainSplit([
      { id: "chain-a", title: "a", pageKey: "main", writesTo: "main", rows: ["Handler — `onContactChange`", "Handler — `setContactInfo` (ported with `onContactChange`)"] },
      { id: "chain-b", title: "b", pageKey: "main", writesTo: "main", rows: ["Handler — `clearContactInfo` (ported with `onContactChange`)", "Handler — `onSaved`"] },
    ]);
    return r.errors.length === 1 && /is in `chain-b` but the plan folds it under/.test(r.errors[0])
      && r.errors[0].includes("chain-a") && /Put them in the same item/.test(r.errors[0]);
  }, () => chainSplit([
    { id: "chain-a", title: "a", pageKey: "main", writesTo: "main", rows: ["Handler — `onContactChange`", "Handler — `setContactInfo` (ported with `onContactChange`)"] },
    { id: "chain-b", title: "b", pageKey: "main", writesTo: "main", rows: ["Handler — `clearContactInfo` (ported with `onContactChange`)", "Handler — `onSaved`"] },
  ]).errors);
check("split: the WHOLE chain in one item passes, and an unrelated handler beside it is not dragged in — the rule is about the fold the plan declares, not about keeping every handler together",
  () => {
    const r = chainSplit([
      { id: "chain-all", title: "a", pageKey: "main", writesTo: "main", rows: ["Handler — `onContactChange`", "Handler — `setContactInfo` (ported with `onContactChange`)", "Handler — `clearContactInfo` (ported with `onContactChange`)"] },
      { id: "other", title: "b", pageKey: "main", writesTo: "main", rows: ["Handler — `onSaved`"] },
    ]);
    return r.errors.length === 0;
  }, () => chainSplit([
    { id: "chain-all", title: "a", pageKey: "main", writesTo: "main", rows: ["Handler — `onContactChange`", "Handler — `setContactInfo` (ported with `onContactChange`)", "Handler — `clearContactInfo` (ported with `onContactChange`)"] },
    { id: "other", title: "b", pageKey: "main", writesTo: "main", rows: ["Handler — `onSaved`"] },
  ]).errors);
check("split: a helper whose CALLER is not in the plan at all is not a chain defect — the rule fires on a fold the plan declares and both halves of which it carries, never on a dangling reference",
  () => {
    const groups = [{ pageKey: "main", baseTitle: "Form — Logic", rows: [
      { label: "Handler — `setContactInfo` (ported with `onContactChange`)" },
    ] }];
    const r = resolveSplit({ items: [{ id: "lone", title: "l", pageKey: "main", writesTo: "main",
      rows: ["Handler — `setContactInfo` (ported with `onContactChange`)"] }] }, groups, new Map());
    return r.errors.length === 0;
  });

// Per-type routing binds each Type's form by the Type column, so it cannot run before those forms exist. Like the
// folded chain, the engine emits the row itself and knows which page keys are typed — so this ordering is checked,
// not trusted. It is a real mistake: on a 94-item split of a real plan the routing item sat second, ahead of both
// typed pages, while the split's own summary said it could only start once both were built.
const TYPED_GROUPS = [
  { pageKey: "main", baseTitle: "Pages", rows: [
    { label: "Per-type page routing — bind EACH Type's form by the Type column" },
    { label: "Form page → PageWithTabsFreedomTemplate" },
  ] },
  { pageKey: "typed:P1Page", baseTitle: "Form — Layout (by tab/region)", rows: [{ label: "Side profile — 3 fields" }] },
];
const typedSplit = (items) => resolveSplit({ items }, TYPED_GROUPS, new Map());
const ROUTE_ITEM = { id: "routing", title: "r", pageKey: "main", writesTo: "scaffold",
  rows: ["Per-type page routing — bind EACH Type's form by the Type column", "Form page → PageWithTabsFreedomTemplate"] };
const TYPED_ITEM = { id: "typed-build", title: "t", pageKey: "typed:P1Page", writesTo: "typed:P1Page",
  rows: ["Side profile — 3 fields"] };
check("split: an item carrying the per-type ROUTING row may not sit before the items that build the typed pages — routing binds each Type's form by the Type column, and a form that has not been built cannot be bound",
  () => {
    const r = typedSplit([ROUTE_ITEM, TYPED_ITEM]);
    return r.errors.length === 1 && /carries the per-type routing row but sits BEFORE/.test(r.errors[0])
      && r.errors[0].includes("typed-build") && /Move it after them/.test(r.errors[0]);
  }, () => typedSplit([ROUTE_ITEM, TYPED_ITEM]).errors);
check("split: the same two items in the RIGHT order pass — the rule is about ordering, not about which item owns the row",
  () => typedSplit([TYPED_ITEM, ROUTE_ITEM]).errors.length === 0,
  () => typedSplit([TYPED_ITEM, ROUTE_ITEM]).errors);
check("split: a plan with NO typed pages is never reported — the rule fires on an order that is actually impossible, not on the presence of a routing row",
  () => {
    const groups = [{ pageKey: "main", baseTitle: "Pages", rows: [
      { label: "Per-type page routing — bind EACH Type's form by the Type column" }] }];
    const r = resolveSplit({ items: [{ id: "only", title: "o", pageKey: "main", writesTo: "scaffold",
      rows: ["Per-type page routing — bind EACH Type's form by the Type column"] }] }, groups, new Map());
    return r.errors.length === 0;
  });
// SIX blocking items, so the truncation is actually exercised: with three or fewer the "…and N more" tail never
// appears and the check would pass without testing anything.
const MANY_TYPED = (() => {
  const labels = Array.from({ length: 6 }, (_, i) => `Region ${i} — 3 fields`);
  const groups = [TYPED_GROUPS[0], { pageKey: "typed:P1Page", baseTitle: "Form — Layout (by tab/region)",
    rows: labels.map((label) => ({ label })) }];
  const items = [ROUTE_ITEM, ...labels.map((label, i) => ({
    id: `typed-${i}`, title: "t", pageKey: "typed:P1Page", writesTo: "typed:P1Page", rows: [label] }))];
  return { groups, items };
})();
check("split: the message NAMES a few of the blocking items and COUNTS the rest — a plan with two typed forms puts fifty items after the routing one, and a message listing them all is one nobody reads",
  () => {
    const r = resolveSplit({ items: MANY_TYPED.items }, MANY_TYPED.groups, new Map());
    return r.errors.length === 1 && /sits BEFORE 6 item\(s\)/.test(r.errors[0])
      && /…and 3 more/.test(r.errors[0]) && r.errors[0].length < 340;
  }, () => resolveSplit({ items: MANY_TYPED.items }, MANY_TYPED.groups, new Map()).errors);

check("parseSplit: a duplicate `id`, a missing `rows` array and a malformed id are each named — the file is authored by hand or by an agent, so the error has to say what to change",
  () => {
    const dup = parseSplit(JSON.stringify({ items: [splitItem("a", "main", "", ["x"]), splitItem("a", "main", "", ["y"])] }));
    const noRows = parseSplit(JSON.stringify({ items: [{ id: "a", title: "t", pageKey: "main" }] }));
    const badId = parseSplit(JSON.stringify({ items: [splitItem("Not A Slug", "main", "", ["x"])] }));
    return dup.errors.some((e) => /duplicate item/.test(e))
      && noRows.errors.some((e) => /has no `rows` array/.test(e))
      && badId.errors.some((e) => /lower-case letters, digits and dashes/.test(e));
  }, () => parseSplit(JSON.stringify({ items: [{ id: "a", title: "t", pageKey: "main" }] })).errors);
check("split: NO split file falls back to the engine's own budget slicer — a plan small enough that the seams do not matter still gets a folder without anyone having to cut it by hand",
  () => {
    const dir = tmp("nosplit");
    const set = taskSetFor(dir, RUN, OPTS, null);
    fs.rmSync(dir, { recursive: true, force: true });
    return !set.split && set.tasks.length === SET.tasks.length;
  });
// The reference cache is engine-authored and counted on neither side, so the fault is injected into a task that
// holds PLAN rows.
const planCarrier = SET.tasks.findIndex((t) => t.artifact !== ARTIFACT_REFS && t.rows.length);
const dropOneRow = () => SET.tasks.map((t, i) => i === planCarrier ? { ...t, rows: t.rows.slice(1) } : t);
const addOneRow = () => SET.tasks.map((t, i) => i === planCarrier
  ? { ...t, rows: [...t.rows, { label: "Build the thing the plan forgot", group: t.rows[0].group }] } : t);
check("the engine's own cut answers to the SAME rule as a split file: every plan row is claimed by exactly one task row, so a row the slicer drops refuses the run instead of going unbuilt",
  () => {
    const { unplaced, surplus } = unclaimedPlanRows(dropOneRow(), GROUPS);
    return unplaced.length === 1 && surplus.length === 0
      && unplaced[0].label === SET.tasks[planCarrier].rows[0].label;
  }, () => unclaimedPlanRows(dropOneRow(), GROUPS));
check("the same check names a task row NO plan row backs — the other half of `exactly one`, and the same defect seen from the other side",
  () => {
    const { unplaced, surplus } = unclaimedPlanRows(addOneRow(), GROUPS);
    return unplaced.length === 0 && surplus.length === 1;
  }, () => unclaimedPlanRows(addOneRow(), GROUPS));
check("(anti-vacuity) the REAL cut of the real plan is clean under that check — the two refusals above are the injected fault, not a check that fires on everything",
  () => {
    const { unplaced, surplus } = unclaimedPlanRows(SET.tasks, GROUPS);
    return unplaced.length === 0 && surplus.length === 0 && GROUPS.flatMap((g) => g.rows).length > 30;
  }, () => unclaimedPlanRows(SET.tasks, GROUPS));
// The COLLAPSED cut is the shape that makes per-row keying load-bearing: the whole-run task's own `pageKey` is
// the literal `run`, while its rows keep their source pages. Keying on the task would report every row of it as
// unplaced and refuse a correct run outright.
check("the same check is clean over a COLLAPSED whole-run task, whose own `pageKey` is `run` while its rows keep their source pages",
  () => {
    const collapsed = buildTaskSet(RUN, checklistOpts(MANIFEST));
    const whole = collapsed.tasks.find((t) => t.artifact === ARTIFACT_WHOLE);
    const { unplaced, surplus } = unclaimedPlanRows(collapsed.tasks, GROUPS);
    return unplaced.length === 0 && surplus.length === 0
      && whole?.pageKey === "run" && whole.rows.some((r) => r.pageKey && r.pageKey !== "run");
  }, () => {
    const collapsed = buildTaskSet(RUN, checklistOpts(MANIFEST));
    return { problems: unclaimedPlanRows(collapsed.tasks, GROUPS),
      whole: collapsed.tasks.find((t) => t.artifact === ARTIFACT_WHOLE)?.rows.map((r) => r.pageKey) };
  });
// What the engine's own cut SAYS when it finds a row on either side. The remedy is the operator's only signal
// that no file of theirs is at fault, so it is asserted rather than assumed from the helper's return.
check("a row the mechanical cut drops reads as the SAME finding a split file's does — one sentence for one condition — while carrying its own remedy: a slicer defect, and the `--split` escape that lets the folder move meanwhile",
  () => {
    const dropped = cutProblems(unclaimedPlanRows(dropOneRow(), GROUPS));
    const viaSplit = splitProblems({ unplaced: [{ pageKey: "main", rows: [{ label: "x" }], unclaimed: 1 }] });
    return dropped.length === 1
      && /is in NO item/.test(dropped[0]) && /is in NO item/.test(viaSplit[0])   // one sentence, both paths
      && /defect in the slicer/.test(dropped[0]) && /supply a `--split`/.test(dropped[0])
      && !/Add it to an item in the split file/.test(dropped[0]);                // that remedy is the split path's
  }, () => cutProblems(unclaimedPlanRows(dropOneRow(), GROUPS)));
check("the refusal the cut produces carries the shape every caller branches on — refused, `engine-cut`, and NO tasks, so half a plan is never handed out beside the banner",
  () => {
    const dropped = cutRefusal({ tasks: dropOneRow(), planVersion: RUN.planVersion }, GROUPS);
    const clean = cutRefusal({ tasks: SET.tasks, planVersion: RUN.planVersion }, GROUPS);
    return dropped?.refused === true && dropped.refusal === REFUSED_CUT
      && dropped.tasks.length === 0 && dropped.problems.length === 1
      && clean === null;
  }, () => ({ dropped: cutRefusal({ tasks: dropOneRow() }, GROUPS), clean: cutRefusal({ tasks: SET.tasks }, GROUPS) }));
check("the CHUNKED plan reaches `taskSetFor` and is clean — the fixture whose pages the budget actually slices across several tasks is where a dropped or duplicated row would come from",
  () => {
    const dir = tmp("cut-chunked");
    const set5 = taskSetFor(dir, RUN5, OPTS5, null);
    fs.rmSync(dir, { recursive: true, force: true });
    const { unplaced, surplus } = unclaimedPlanRows(SET5.tasks, checklistGroups(RUN5, OPTS5));
    return !set5.refused && set5.tasks.length > 1 && unplaced.length === 0 && surplus.length === 0;
  }, () => unclaimedPlanRows(SET5.tasks, checklistGroups(RUN5, OPTS5)));
check("a task row backed by no plan row is named with its own page and text — the other half of `exactly one`",
  () => {
    const invented = cutProblems(unclaimedPlanRows(addOneRow(), GROUPS));
    return invented.length === 1 && /backed by no plan/.test(invented[0])
      && /the mechanical cut invented it/.test(invented[0]);
  }, () => cutProblems(unclaimedPlanRows(addOneRow(), GROUPS)));
check("a label the plan carries twice and the split claims once names the COUNT still owed — without it the operator places one, re-runs, and meets a byte-identical refusal",
  () => {
    const two = splitProblems({ unplaced: [{ pageKey: "main", rows: [{ label: "Quality gates" }], unclaimed: 2 }] });
    const one = splitProblems({ unplaced: [{ pageKey: "main", rows: [{ label: "Quality gates" }], unclaimed: 1 }] });
    return /\(2 occurrences unclaimed\)/.test(two[0]) && !/occurrences unclaimed/.test(one[0]);
  }, () => splitProblems({ unplaced: [{ pageKey: "main", rows: [{ label: "Quality gates" }], unclaimed: 2 }] }));

console.log("\n===== a review waits for the page it judges, and may not precede a writer of it =====");
// A late scaffolding item is legitimate; a review before a writer of its page never is — it would file a verdict
// on a page that is still being built. The `Quality gates` rows name the page, so the engine says so.
{
  const rows = allRows("main");
  const gateRow = GROUPS.find((g) => g.pageKey === "main" && g.baseTitle === "Quality gates").rows[0].label;
  const build = rows.filter((r) => r !== gateRow);
  const REVIEW = splitItem("the-review", "main", "", [gateRow]);
  const BUILD = splitItem("the-build", "main", "main", build);
  const others = FULL_SPLIT.items.filter((i) => i.pageKey !== "main");
  check("review (anti-vacuity): the fixture really separates the review row from the writing rows — otherwise 'a review is not a writer' is asserted about one item that is both",
    () => build.length > 1 && !build.includes(gateRow) && /creatio-ui-guidelines/.test(gateRow),
    () => ({ gateRow: gateRow.slice(0, 60), build: build.length }));
  check("split: a review placed BEFORE an item that still writes the page it judges is REFUSED — the verdict would be filed on a page that is not finished",
    () => {
      const set = buildTaskSetFromSplit(RUN, { ...FULL_SPLIT, items: [REVIEW, ...others, BUILD] }, OPTS);
      return set.refused && set.problems.some((p) => /reviews `main` but sits BEFORE/.test(p) && p.includes("the-build"));
    }, () => buildTaskSetFromSplit(RUN, { ...FULL_SPLIT, items: [REVIEW, ...others, BUILD] }, OPTS).problems);
  check("split: the same two in the right order pass, and the READ-ONLY review still waits on every writer of that page — with no `writesTo` it joins no chain, so without this dependency nothing would make it wait at all",
    () => {
      const set = mergeTaskSet(buildTaskSetFromSplit(RUN, { ...FULL_SPLIT, items: [BUILD, ...others, REVIEW] }, OPTS), []);
      const rev = set.tasks.find((t) => t.id === "the-review");
      const at = new Map(set.tasks.map((t) => [t.id, t.step]));
      return !set.refused && rev.writesTo === "" && rev.dependsOn.includes("the-build")
        && set.tasks.every((t) => t.dependsOn.every((d) => !at.has(d) || at.get(d) < t.step));
    }, () => mergeTaskSet(buildTaskSetFromSplit(RUN, { ...FULL_SPLIT, items: [BUILD, ...others, REVIEW] }, OPTS), [])
      .tasks.map((t) => `${t.step}:${t.id}:${t.writesTo || "—"}→${t.dependsOn.join(",")}`));
  check("split: an item that carries NO `Quality gates` row is never treated as a review — the rule reads the rows, not the item's name",
    () => {
      const set = buildTaskSetFromSplit(RUN, { ...FULL_SPLIT, items: [
        splitItem("looks-like-a-review", "main", "", [rows[0]]),
        ...others,
        splitItem("later-writer", "main", "main", rows.slice(1)),
      ] }, OPTS);
      return !set.refused;
    }, () => "an item named like a review but carrying no gate row");
}

console.log("\n===== a split may place SCAFFOLDING late, and the queue must still be walkable =====");
// Per-type routing binds each Type's form by the Type column, so it belongs AFTER the typed pages even though it
// is scaffolding. Depending on ALL scaffold tasks made every earlier task wait on that late one — 83 dependencies
// pointing forward in one real 94-item queue, which is a deadlock and not an ordering.
{
  const rows = allRows("main");
  const lateScaffold = { ...FULL_SPLIT, items: [
    splitItem("scaffold-early", "main", "scaffold", rows.slice(0, 3)),
    ...FULL_SPLIT.items.filter((i) => i.pageKey !== "main"),
    splitItem("main-build", "main", "main", rows.slice(3)),
    splitItem("scaffold-late", "main", "scaffold", []),
  ].filter((i) => i.rows.length) };
  const set = mergeTaskSet(buildTaskSetFromSplit(RUN, lateScaffold, OPTS), []);
  const at = new Map(set.tasks.map((t) => [t.id, t.step]));
  check("late scaffolding: NO dependency points forward in the queue — an orchestrator walking `Step` order must never meet a task whose precondition it has not reached yet",
    () => set.tasks.every((t) => t.dependsOn.every((d) => !at.has(d) || at.get(d) < t.step)),
    () => set.tasks.filter((t) => t.dependsOn.some((d) => at.has(d) && at.get(d) >= t.step))
      .map((t) => `${t.step}:${t.id}→${t.dependsOn.join(",")}`));
  check("late scaffolding: a task still waits on the scaffolding that PRECEDES it — the rule narrowed to what the split's own order declares, it did not stop enforcing the precondition",
    () => {
      const build = set.tasks.find((t) => t.id === "main-build");
      return build.dependsOn.includes("scaffold-early");
    }, () => set.tasks.map((t) => `${t.step}:${t.id}:${t.writesTo || "—"}→${t.dependsOn.join(",")}`));
}

console.log("\n===== repair: the rows `--verify` left open, merged by (page, cause) =====");
// `--verify` publishes its open rows per page with the SAME text the reader saw. A repair task is cut from those,
// not from the plan — so it is never rewritten by a re-slice and never retired for "not being in the plan".
const openRow = (n, deliverable, outcome = "missing", status = "❌ MISSING", evidence = "not on the built page") =>
  ({ n, deliverable, status, evidence, outcome, owner: "builder" });
// Shaped like what `renderVerify` actually publishes: the handlers are ONE ROW EACH (that is where a cause with
// many symptoms really comes from), while the fields arrive as a single coverage row reporting the shortfall.
const VERIFY_PAGES = {
  main: { missing: 18, unverified: 1, complete: false, openRows: [
    ...Array.from({ length: 16 }, (_, i) => openRow(i + 1, `Handler — \`onThing${i}\``)),
    openRow(17, "Fields — 19 expected", "missing", "❌ MISSING", "0 of 19 matched on the built page"),
    openRow(18, "Business rules × 3"),
    openRow(19, "`creatio-ui-guidelines` skill invoked on EVERY built page", "unverified", "⚠ unverified", "no record filed"),
  ] },
};
check("repair (anti-vacuity): the fixture really carries 16 rows of ONE cause plus three of other causes — otherwise 'merged by cause' and 'not one task per row' are the same assertion",
  () => VERIFY_PAGES.main.openRows.filter((r) => r.deliverable.startsWith("Handler —")).length === 16
    && new Set(VERIFY_PAGES.main.openRows.map((r) => r.outcome)).size === 2,
  () => VERIFY_PAGES.main.openRows.length);
check("repair: 16 handlers missing from one page is ONE task, not 16 — a defect with many symptoms is one defect, and 16 tasks is 16 sub-agent startups to make one edit each, which the orchestrator would group anyway",
  () => {
    const { tasks } = buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []);
    const h = tasks.filter((t) => t.cause === "missing:handlers");
    return h.length === 1 && h[0].rows.length === 16;
  }, () => buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []).tasks.map((t) => `${t.cause}:${t.rows.length}`));
check("repair: a merged task that outgrows the budget is CUT like any other — merging by cause is not a licence to hand one sub-agent unbounded work",
  () => {
    const many = { main: { openRows: Array.from({ length: 60 }, (_, i) => openRow(i + 1, `Handler — \`m${i}\``)) } };
    const { tasks } = buildRepairTasks(RUN, many, OPTS, []);
    return tasks.length > 1 && tasks.every((t) => t.cause === "missing:handlers")
      && new Set(tasks.map((t) => t.id)).size === tasks.length;
  }, () => buildRepairTasks(RUN, { main: { openRows: Array.from({ length: 60 }, (_, i) => openRow(i + 1, `Handler — \`m${i}\``)) } }, OPTS, []).tasks.map((t) => t.rows.length));
check("repair: DIFFERENT causes are different tasks — a missing handler and an unfiled evidence record need opposite work, and `unverified` is separated from `missing` first because one is a thing to build and the other a record to file",
  () => {
    const { tasks } = buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []);
    const causes = tasks.map((t) => t.cause);
    return new Set(causes).size === causes.length && causes.length === 4
      && causes.some((c) => c.startsWith("unverified:")) && causes.includes("missing:fields");
  }, () => buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []).tasks.map((t) => t.cause));
check("repair: a repair task WRITES the page's artifact, so it is chained behind the build tasks for that page — a repair that raced the build it repairs is the same clobber as two builders",
  () => {
    const { tasks } = buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []);
    return tasks.every((t) => t.writesTo === taskAt(SET, "main", DRIFT_GROUP).writesTo);
  }, () => buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []).tasks.map((t) => t.writesTo));
check("repair: the rendered file shows what was ACTUALLY RECORDED per row — a sub-agent sent to fix a row needs the observation itself, because re-describing it is how a round gets spent on a row that was never the problem; the heading names no source, since the row may come from `--verify` or from a build agent's own Outcome cell",
  () => {
    const t = buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []).tasks[0];
    const text = renderTaskFile(t, SET);
    return /\| # \| Deliverable \| What was recorded \| Evidence behind it \|/.test(text)
      && text.includes("❌ MISSING") && text.includes("not on the built page");
  }, () => renderTaskFile(buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []).tasks[0], SET));
check("repair: the file says it is a REPAIR round and carries NO spec slice — the deliverable is the failing row, not the page's whole design, and it states that a row open because the PLAN is wrong is a proposal, never a row closed by asserting it",
  () => {
    const t = buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []).tasks[0];
    const text = renderTaskFile(t, SET);
    return /REPAIR — round 1 of at most 3/.test(text) && /no spec slice here on purpose/i.test(text)
      && /proposal to the user/.test(text);
  }, () => renderTaskFile(buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []).tasks[0], SET));
check("repair: the round is read off the FOLDER, not remembered — a cause already repaired once comes back as round 2, because counting rounds from a session's memory is how a capped cause quietly gets another sub-agent",
  () => {
    const first = buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []).tasks.find((t) => t.cause === "missing:handlers");
    const asFile = { file: first.file, notes: "", malformed: null,
      meta: { id: first.id, status: "done", origin: "engine", pageKey: "main", kind: "repair",
        cause: first.cause, repairRound: "1" } };
    const second = buildRepairTasks(RUN, VERIFY_PAGES, OPTS, [asFile]).tasks.find((t) => t.cause === "missing:handlers");
    return first.repairRound === 1 && second.repairRound === 2 && first.id !== second.id;
  }, () => buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []).tasks.map((t) => `${t.cause}:r${t.repairRound}`));
check(`repair: after ${REPAIR_ROUND_CAP} rounds the cause is PARKED and no further task is written — three sub-agents have failed at it, so a fourth is not the answer; it is a decision for the user`,
  () => {
    const prior = [];
    for (let r = 1; r <= REPAIR_ROUND_CAP; r++) {
      prior.push({ file: `task-repair-round${r}-main-x.md`, notes: "", malformed: null,
        meta: { id: `r${r}`, status: "done", origin: "engine", pageKey: "main", kind: "repair",
          cause: "missing:handlers", repairRound: String(r) } });
    }
    const { tasks, parked } = buildRepairTasks(RUN, VERIFY_PAGES, OPTS, prior);
    return !tasks.some((t) => t.cause === "missing:handlers")
      && parked.some((p) => p.cause === "missing:handlers" && p.pageKey === "main" && p.rows === 16)
      && tasks.some((t) => t.cause === "missing:fields");   // other causes are NOT capped by this one
  }, () => buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []).tasks.map((t) => t.cause));
check("repair: a repair file is ADOPTED by a later plain re-slice — never rewritten (its rows are one verify run's, not the plan's) and never reported stale (it never was in the plan)",
  () => {
    const t = buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []).tasks[0];
    const asFile = { file: t.file, notes: "fixed 12 of 19", malformed: null,
      meta: { id: t.id, status: "in-progress", origin: "engine", pageKey: "main", kind: "repair",
        cause: t.cause, repairRound: "1", writesTo: t.writesTo } };
    const m = mergeTaskSet(SET, [asFile]);
    const got = m.tasks.find((x) => x.id === t.id);
    return got?.status === "in-progress" && got.notes === "fixed 12 of 19"
      && (m.stale || []).length === 0 && (m.blocked || []).length === 0;
  }, () => mergeTaskSet(SET, [{ file: "x.md", notes: "", malformed: null,
      meta: { id: "zz", status: "todo", origin: "engine", pageKey: "main", kind: "repair", cause: "c", repairRound: "1" } }]));
check("repair: an adopted repair file joins the WRITE CHAIN of the page it repairs — it declares the artifact, so the merged queue sequences it behind the build tasks rather than beside them",
  () => {
    const t = buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []).tasks[0];
    const asFile = { file: t.file, notes: "", malformed: null,
      meta: { id: t.id, status: "todo", origin: "engine", pageKey: "main", kind: "repair",
        cause: t.cause, repairRound: "1", writesTo: t.writesTo, order: "999" } };
    const m = mergeTaskSet(SET, [asFile]);
    const got = m.tasks.find((x) => x.id === t.id);
    const lastBuild = m.tasks.findLast((x) => x.writesTo === t.writesTo && x.id !== t.id);
    return got.dependsOn.includes(lastBuild.id);
  }, () => "see the merged queue");
check("repair: syncRepairDir ADDS to the folder and never overwrites — the plan tasks are untouched, and re-verifying an UNCHANGED page opens no second round, because a round is an ATTEMPT and counting verify runs would burn the cap with nobody having run",
  () => {
    const dir = tmp("repair");
    syncTaskDir(dir, RUN, OPTS);
    const before = fs.readdirSync(dir).length;
    const first = syncRepairDir(dir, RUN, VERIFY_PAGES, OPTS);
    const after = fs.readdirSync(dir).length;
    const again = syncRepairDir(dir, RUN, VERIFY_PAGES, OPTS);
    const settled = fs.readdirSync(dir).length;
    const idx = readIndex(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    return first.written.length === 4 && after === before + 4
      && again.written.length === 0 && again.pending.length === 4 && settled === after
      && /Repair round 1/.test(idx);
  }, () => {
    const dir = tmp("repair-dbg");
    syncTaskDir(dir, RUN, OPTS);
    const first = syncRepairDir(dir, RUN, VERIFY_PAGES, OPTS);
    const again = syncRepairDir(dir, RUN, VERIFY_PAGES, OPTS);
    const out = { wrote: first.written.map((t) => t.file), again: again.written.map((t) => t.file),
      pending: again.pending };
    fs.rmSync(dir, { recursive: true, force: true });
    return out;
  });
check("repair: with a FROZEN split in the folder, syncRepairDir regenerates the index from that split — deriving it from the engine's own cut instead would hand the merge content-hash ids while every file on disk carries the split's slug ids, so nothing would match and the whole folder would be rewritten back to `todo`",
  () => {
    const dir = tmp("repair-split");
    freezeSplit(dir, JSON.stringify(FULL_SPLIT));
    syncTaskDir(dir, RUN, OPTS);
    const before = readExistingMeta(dir);
    const res = syncRepairDir(dir, RUN, VERIFY_PAGES, OPTS);
    const after = readExistingMeta(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    const splitIds = new Set(FULL_SPLIT.items.map((i) => i.id));
    // Every build task the split named is still in the regenerated index, under the SLUG id the files carry.
    const keptSplitIds = [...splitIds].every((id) => res.set.tasks.some((t) => t.id === id));
    // And the files themselves were neither renamed nor reset by the repair round.
    const untouched = before.every((b) => after.some((a) => a.file === b.file && a.id === b.id));
    return keptSplitIds && untouched && res.written.length > 0;
  }, () => {
    const dir = tmp("repair-split-dbg");
    freezeSplit(dir, JSON.stringify(FULL_SPLIT));
    syncTaskDir(dir, RUN, OPTS);
    const res = syncRepairDir(dir, RUN, VERIFY_PAGES, OPTS);
    const out = { splitIds: FULL_SPLIT.items.map((i) => i.id),
      indexIds: res.set.tasks.map((t) => t.id), files: fs.readdirSync(dir) };
    fs.rmSync(dir, { recursive: true, force: true });
    return out;
  });
// A frozen split meeting a plan that GAINED rows — the drift case, mid-build. Fatal by design, so what has to
// hold is that it is fatal WITHOUT COST: the recorded work is still on disk and the refusal says what clears it.
const driftedFolder = () => {
  const dir = tmp("split-drift");
  freezeSplit(dir, JSON.stringify(FULL_SPLIT));
  syncTaskDir(dir, RUN, OPTS);
  editFrontMatter(dir, FULL_SPLIT.items[0].id, "status", "done");
  const before = fs.readdirSync(dir).sort();
  // RUN5 adds handler rows and changes no existing label, so the split still RESOLVES and only its coverage
  // falls short — the drift case proper, kept clear of the `claims a row the plan does not have` path.
  const read = readMergedTaskDir(dir, RUN5, OPTS5);
  const repair = syncRepairDir(dir, RUN5, VERIFY_PAGES, OPTS5);
  const after = fs.readdirSync(dir).sort();
  const kept = readTaskDir(dir).find((t) => t.id === FULL_SPLIT.items[0].id);
  fs.rmSync(dir, { recursive: true, force: true });
  return { before, after, read, repair, kept };
};
check("frozen split + a plan that GAINED a row: an in-flight folder REFUSES until the row is placed — a queue that keeps handing out tasks while part of the plan is scheduled to nobody is the state this check exists to end",
  () => {
    const { read, repair } = driftedFolder();
    return read.refused === true && read.tasks.length === 0
      && read.refusal === REFUSED_COVERAGE
      && read.problems.some((p) => /is in NO item/.test(p))
      && repair.refused === true && repair.written.length === 0;
  }, () => { const { read, repair } = driftedFolder(); return { read: read.problems, repair: repair.problems }; });
check("…and that refusal costs NOTHING already recorded: every file survives and a task whose front matter said `done` still says `done`, so the drift is cleared by editing the split rather than by rebuilding the run",
  () => {
    const { before, after, kept } = driftedFolder();
    return JSON.stringify(before) === JSON.stringify(after) && kept?.recordedStatus === "done";
  }, () => { const { before, after, kept } = driftedFolder(); return { before, after, status: kept?.recordedStatus }; });
check("repair: an UNREADABLE frozen split writes nothing at all — a folder repaired against a cut that cannot be parsed would be renumbered wholesale, which is the same reason a build run refuses it",
  () => {
    const dir = tmp("repair-bad-split");
    syncTaskDir(dir, RUN, OPTS);
    const before = fs.readdirSync(dir).sort();
    freezeSplit(dir, "{ this is not json");
    const res = syncRepairDir(dir, RUN, VERIFY_PAGES, OPTS);
    const after = fs.readdirSync(dir).sort();
    fs.rmSync(dir, { recursive: true, force: true });
    return res.refused === true && res.written.length === 0
      && JSON.stringify(before) === JSON.stringify(after.filter((f) => f !== SPLIT_FILE));
  }, () => {
    const dir = tmp("repair-bad-split-dbg");
    syncTaskDir(dir, RUN, OPTS);
    freezeSplit(dir, "{ this is not json");
    const res = syncRepairDir(dir, RUN, VERIFY_PAGES, OPTS);
    fs.rmSync(dir, { recursive: true, force: true });
    return { refused: res.refused, problems: res.problems, written: res.written };
  });
check("repair: a round that was ATTEMPTED and came back opens the next one — `done` with the rows still open is the repeat failure the cap is about, while `todo` / `in-progress` / `blocked` are the round that is still somebody's work",
  () => {
    const first = buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []).tasks.find((t) => t.cause === "missing:handlers");
    const asFile = (status) => ({ file: first.file, notes: "", malformed: null,
      meta: { id: first.id, status, origin: "engine", pageKey: "main", kind: "repair",
        cause: first.cause, repairRound: "1" } });
    const opened = ["done", "n/a"].every((st) =>
      buildRepairTasks(RUN, VERIFY_PAGES, OPTS, [asFile(st)]).tasks.some((t) => t.cause === "missing:handlers"));
    const held = ["todo", "in-progress", "blocked"].every((st) => {
      const r = buildRepairTasks(RUN, VERIFY_PAGES, OPTS, [asFile(st)]);
      return !r.tasks.some((t) => t.cause === "missing:handlers")
        && r.pending.some((p) => p.cause === "missing:handlers" && p.status === st);
    });
    return opened && held;
  }, () => "see buildRepairTasks with each recorded status");

console.log("\n===== a run too small to split: ONE build task plus ONE review =====");
{
  // The artifact rule exists so two sub-agents never write one page body. On a run this small there is only ever
  // one builder, so the rule protects nothing while each extra task pays a fresh context that re-reads what the
  // last one read. MANIFEST is the same fixture A-D use; here it is sliced with the REAL default budget.
  const small = buildTaskSet(RUN, checklistOpts(MANIFEST));
  const writers = small.tasks.filter((t) => t.writesTo);
  const readers = small.tasks.filter((t) => !t.writesTo);
  check("small run: the whole build is ONE task and the review is the only other one — six sub-agent startups for a section this size cost more than the split saves",
    () => small.tasks.length === 2 && writers.length === 1 && readers.length === 1
      && writers[0].artifact === ARTIFACT_WHOLE && writers[0].writesTo === ARTIFACT_WHOLE,
    () => small.tasks.map((t) => `${t.id} ${t.pageKey}·${t.group} writes=${t.writesTo || "-"}`));
  check("small run (anti-vacuity): the SAME plan with the collapse switched off cuts into more than two tasks, so the check above is not passing because the plan is trivial",
    () => buildTaskSet(RUN, OPTS).tasks.length > 2,
    () => buildTaskSet(RUN, OPTS).tasks.map((t) => t.group));
  check("small run: the review still WAITS on the build and is still read-only — a verdict filed by the agent that just built the page is not a verdict, however small the run",
    () => readers[0].dependsOn.length === 1 && readers[0].dependsOn[0] === writers[0].id
      && readers[0].writesTo === "",
    () => ({ review: readers[0].dependsOn, build: writers[0].id }));
  check("small run: NO reference-cache task — the cache exists to stop N fresh contexts re-fetching the same contracts, and with one builder there is no second reader to amortise it over",
    () => !small.tasks.some((t) => t.artifact === ARTIFACT_REFS), () => small.tasks.map((t) => t.artifact));
  check("small run: every plan row the per-artifact cut carried is still carried — the collapse moves rows between tasks, it never drops one",
    () => {
      const rowsOf = (set) => set.tasks.filter((t) => t.artifact !== ARTIFACT_REFS)
        .flatMap((t) => t.rows.map((r) => r.label)).sort();
      return JSON.stringify(rowsOf(small)) === JSON.stringify(rowsOf(buildTaskSet(RUN, OPTS)));
    },
    () => ({ small: small.tasks.flatMap((t) => t.rows.length), full: buildTaskSet(RUN, OPTS).tasks.length }));
  // The collapse must be exercised through the REAL pipeline, not only a
  // hand-built set. `buildTaskSet` → `collapseSmallRun` → `chunksOf` → `taskOf` (rows[].pageKey = r.pageKey || pageKey)
  // over `artifactRows` (pageKey: g.pageKey) must give the whole-run task rows that carry their SOURCE page, not "run".
  check("(collapsed run, real pipeline): the whole-run task's rows each carry their source page key (not the task's `run`), spanning ≥2 pages — buildTaskSet/artifactRows/taskOf actually propagate pageKey",
    () => { const whole = small.tasks.find((t) => t.artifact === ARTIFACT_WHOLE);
      return whole.pageKey === "run" && whole.rows.length > 0
        && whole.rows.every((r) => r.pageKey && r.pageKey !== "run")
        && new Set(whole.rows.map((r) => r.pageKey)).size >= 2; },
    () => (small.tasks.find((t) => t.artifact === ARTIFACT_WHOLE)?.rows || []).map((r) => [r.label, r.pageKey]));
  check("small run: the threshold is the RUN's weight, not its row count — the same plan grown past `TASK_BUDGET.run` keeps the per-artifact cut, and one page is still never written by two tasks that are not chained",
    () => {
      const big = buildTaskSet(RUN5, checklistOpts(MANIFEST5));
      return !big.tasks.some((t) => t.artifact === ARTIFACT_WHOLE) && big.tasks.length > 2;
    },
    () => buildTaskSet(RUN5, checklistOpts(MANIFEST5)).tasks.map((t) => t.artifact));
  check("small run: the threshold is DECLARED like the rest of the budget — `TASK_BUDGET.run` at 0 turns the collapse off and a large value forces it, both without a code change",
    () => buildTaskSet(RUN5, { ...OPTS5, taskBudget: { run: 100000 } }).tasks.length === 2
      && buildTaskSet(RUN, { ...OPTS, taskBudget: { run: 0 } }).tasks.length > 2,
    () => ({ forced: buildTaskSet(RUN5, { ...OPTS5, taskBudget: { run: 100000 } }).tasks.length }));
  check("small run: the review still waits on the build after a RE-SLICE, and the dependency is in the file on disk — `dependsOn` is re-derived on every `--tasks` run, and what the collapsed review judges is named by no `review:<page>` artifact, so this is the path that would silently lose it",
    () => {
      const base = tmp("small-resync");
      const dir = path.join(base, "build-tasks");
      const cOpts = checklistOpts(MANIFEST);
      syncTaskDir(dir, RUN, cOpts);
      const again = syncTaskDir(dir, RUN, cOpts);
      const build = again.tasks.find((t) => t.writesTo);
      const review = again.tasks.find((t) => !t.writesTo);
      const onDisk = fs.readFileSync(path.join(dir, review.file), "utf8");
      fs.rmSync(base, { recursive: true, force: true });
      return again.tasks.length === 2 && review.dependsOn.length === 1
        && review.dependsOn[0] === build.id && new RegExp(`dependsOn: .*${build.id}`).test(onDisk);
    },
    () => {
      const base = tmp("small-resync-why");
      const dir = path.join(base, "build-tasks");
      syncTaskDir(dir, RUN, checklistOpts(MANIFEST));
      const again = syncTaskDir(dir, RUN, checklistOpts(MANIFEST));
      const out = again.tasks.map((t) => `${t.id} writes=${t.writesTo || "-"} deps=${t.dependsOn.join(",")}`);
      fs.rmSync(base, { recursive: true, force: true });
      return out;
    });
  check("small run: the collapsed task renders and reads back like any other — it is one more artifact, not a second file format",
    () => {
      const text = renderTaskFile(writers[0], small);
      const back = parseTaskFile(text);
      const tableRows = text.split(/\r?\n/).filter((l) => /^\|\s*\d+\s*\|/.test(l)).length;
      return back.malformed === null && back.meta.id === writers[0].id
        && back.meta.writesTo === ARTIFACT_WHOLE && tableRows === writers[0].rows.length;
    },
    () => parseTaskFile(renderTaskFile(writers[0], small)).meta);
}

console.log("\n===== the clock: what has started, what it cost, what the next one costs =====");
{
  const at = (min) => new Date(Date.UTC(2026, 0, 1, 12, min)).toISOString();
  const fresh = () => { const d = path.join(tmp("clock"), "build-tasks"); syncTaskDir(d, RUN, OPTS); return d; };
  const idOf = (d, pred) => syncTaskDir(d, RUN, OPTS).tasks.find(pred).id;
  const taskOfId = (d, id) => syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.id === id);

  // 1 — the whole point: the index has to move when the orchestrator DISPATCHES, not only when an agent finishes.
  {
    const d = fresh();
    const id = idOf(d, (t) => t.artifact === ARTIFACT_SCAFFOLD);
    clearDepsOf(d, id, RUN, OPTS);
    const before = readIndex(d);
    const res = startTask(d, id, RUN, OPTS, null, at(0));
    const t = taskOfId(d, id);
    check("clock: `--start` marks the task in-progress and opens its clock BEFORE the agent runs — until this existed a run in flight looked identical to one that had not begun",
      () => res.started?.id === id && t.status === "in-progress" && readTimingsFile(d).running[id]?.startedAt === at(0)
        && /▶ in-progress/.test(readIndex(d)) && !/▶ in-progress/.test(before),
      () => ({ status: t.status, running: readTimingsFile(d).running, row: readIndex(d).split("\n").find((l) => l.includes(id)) }));
    check("clock: the times are NOT in the task file — the sub-agent legitimately edits that front matter, and on the first live run it filled `endedAt` in itself with a rounded value, which cost the run its only measurement",
      () => { const raw = fs.readFileSync(path.join(d, t.file), "utf8"); return !/startedAt|endedAt/.test(raw); },
      () => fs.readFileSync(path.join(d, t.file), "utf8").split("---")[1]);
    check("clock: an id the folder does not hold marks nothing and says so — a typo must not silently start the wrong task",
      () => { const r = startTask(d, "nosuchid", RUN, OPTS, null, at(0)); return r.started === null && r.unknownId === "nosuchid"; },
      () => startTask(d, "nosuchid", RUN, OPTS, null, at(0)).started);
  }

  // 2 — the duration is recorded ONCE, by the first regeneration that sees the task closed.
  {
    const d = fresh();
    const id = idOf(d, (t) => t.artifact === ARTIFACT_SCAFFOLD);
    clearDepsOf(d, id, RUN, OPTS);
    startTask(d, id, RUN, OPTS, null, at(0));
    const f = path.join(d, taskOfId(d, id).file);
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("status: in-progress", "status: done"));
    syncTaskDir(d, RUN, { ...OPTS, now: at(12) });
    const mine = (xs) => xs.filter((x) => x.id === id);
    const one = mine(readTimings(d));
    syncTaskDir(d, RUN, { ...OPTS, now: at(30) });          // a later re-slice must not move or duplicate it
    const two = mine(readTimings(d));
    check("clock: closing a started task records exactly ONE sample and closes its open clock, and a later re-slice neither duplicates nor re-times it — a duration that drifts with every regeneration measures the regenerations",
      () => one.length === 1 && one[0].minutes === 12 && one[0].weight > 0
        && two.length === 1 && two[0].minutes === 12 && !readTimingsFile(d).running[id],
      () => ({ one, two, running: readTimingsFile(d).running }));
  }

  // 3 — a task closed without ever being started has no duration to record. Inventing one poisons every later
  // forecast with a number nobody measured.
  {
    const d = fresh();
    const id = idOf(d, (t) => t.artifact === ARTIFACT_SCAFFOLD);
    const f = path.join(d, taskOfId(d, id).file);
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("status: todo", "status: done"));
    syncTaskDir(d, RUN, { ...OPTS, now: at(12) });
    check("clock: a task closed without ever being STARTED records no sample — the folder has no start to measure from, and a guessed duration would poison every later forecast",
      () => readTimings(d).length === 0 && !fs.existsSync(path.join(d, TIMINGS_FILE)),
      () => readTimings(d));
  }

  // 3b — closed without ever being dispatched. The nonce only proves two tasks were not closed by the SAME
  // context; it cannot tell the orchestrator from a sub-agent. On the first live run of `--start` the review task
  // was closed by the orchestrator that had just judged its own build, and nothing in the folder objected.
  {
    const d = fresh();
    const id = idOf(d, (t) => t.artifact === ARTIFACT_SCAFFOLD);
    const f = path.join(d, taskOfId(d, id).file);
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("status: todo", "status: done"));
    const set = syncTaskDir(d, RUN, { ...OPTS, now: at(12) });
    check("attention: a task recorded `done` that was never STARTED is reported by name — nobody dispatched a sub-agent for it through the engine, and for a review that is exactly the failure the task exists to prevent",
      () => set.undispatched.some((t) => t.id === id)
        && /never STARTED through/.test(readIndex(d)) && readIndex(d).includes(taskOfId(d, id).file),
      () => ({ undispatched: set.undispatched.map((t) => t.id), attention: readIndex(d).split("## Attention")[1]?.slice(0, 300) }));
    // 3b — `--start` applies the SAME write guards `syncTaskDir` owns. Until it did, the prescribed
    // "--start before every dispatch" re-rendered an adopted repair file through `renderTaskFile`, whose
    // `rows` are empty for an adopted task: the Deliverables table came back empty and the sub-agent was
    // dispatched with nothing to build.
    check("start: `--start` on an ADOPTED repair task moves only its `status:` line and the stamp that belongs to it — its Deliverables, its origin and its authored body are byte-identical afterwards, because the engine never parsed that body and re-rendering it empties the table the sub-agent is dispatched against",
      () => {
        const d3 = tmp("start-adopted");
        syncTaskDir(d3, RUN, OPTS);
        const rep = syncRepairDir(d3, RUN, VERIFY_PAGES, OPTS).written[0];
        clearDepsOf(d3, rep.id, RUN, OPTS);
        const f3 = path.join(d3, rep.file);
        const before3 = fs.readFileSync(f3, "utf8");
        const res3 = startTask(d3, rep.id, RUN, OPTS, null, at(0));
        const after3 = fs.readFileSync(f3, "utf8");
        const ok = res3.started?.id === rep.id
          && sansStatusLines(after3) === sansStatusLines(before3)
          && /^status: in-progress$/m.test(after3)
          && res3.started.origin === "orchestrator"
          && (before3.match(/^[ \t]*\|[ \t]*\d+[ \t]*\|/gm) || []).length === (after3.match(/^[ \t]*\|[ \t]*\d+[ \t]*\|/gm) || []).length
          && (after3.match(/^[ \t]*\|[ \t]*\d+[ \t]*\|/gm) || []).length > 0;
        fs.rmSync(d3, { recursive: true, force: true });
        return ok;
      }, () => "see the adopted repair file before/after --start");
    check("start: `--start` REFUSES a file the engine could not read rather than overwriting it — that file's `## Notes` are the only record of work already done on a stand, which is why the plain merge leaves it byte-identical too",
      () => {
        const d4 = tmp("start-unread");
        const set4 = syncTaskDir(d4, RUN, OPTS);
        const victim = set4.tasks[0];
        const f4 = path.join(d4, victim.file);
        // Unterminated front matter plus notes that exist nowhere else.
        fs.writeFileSync(f4, `---\nid: ${victim.id}\nstatus: todo\n\n## Notes\nthe stand already has the handler wired\n`);
        const before4 = fs.readFileSync(f4, "utf8");
        const res4 = startTask(d4, victim.id, RUN, OPTS, null, at(0));
        const after4 = fs.readFileSync(f4, "utf8");
        const ok = res4.started === null && res4.unread === victim.file && after4 === before4;
        fs.rmSync(d4, { recursive: true, force: true });
        return ok;
      }, () => "see the unread task file before/after --start");
    check("index: an adopted repair task reports the rows ITS OWN FILE lists, not the empty `rows` the engine carries for it — a repair row reading `0` is one the user is invited to skip",
      () => {
        const d5 = tmp("adopted-rows");
        syncTaskDir(d5, RUN, OPTS);
        syncRepairDir(d5, RUN, VERIFY_PAGES, OPTS);
        const row = readIndex(d5).split("\n").find((l) => /Repair round 1/.test(l));
        fs.rmSync(d5, { recursive: true, force: true });
        return row && !/\|\s*0\s*\|/.test(row);
      }, () => "see the Repair round 1 row of index.md");

    check("attention (anti-vacuity): the SAME task closed after a `--start` raises nothing — the check is about the dispatch, not about the status",
      () => {
        const d2 = fresh();
        const id2 = idOf(d2, (t) => t.artifact === ARTIFACT_SCAFFOLD);
        clearDepsOf(d2, id2, RUN, OPTS);
        startTask(d2, id2, RUN, OPTS, null, at(0));
        const f2 = path.join(d2, taskOfId(d2, id2).file);
        fs.writeFileSync(f2, fs.readFileSync(f2, "utf8").replace("status: in-progress", "status: done"));
        return syncTaskDir(d2, RUN, { ...OPTS, now: at(9) }).undispatched.length === 0;
      }, () => "see above");
  }

  /* ============================================================================================
     THE DISPATCH GATE. Three mechanisms left advisory let a run walk past all three:
     dispatching one sub-agent per PAGE, closing the chunk tasks of that page from the one context
     and closing the four `Quality gates` tasks from the orchestrator itself. Every check below is
     about making an already-written rule FAIL rather than warn.

     The two recorded folders are the reference shapes and are NOT copied in — they hold customer
     page content. They are reproduced here as fixtures: a "services" folder (closures with no
     clock, incl. a review) and an "applicants" folder (every closure dispatched).
     ============================================================================================ */
  console.log("\n===== the dispatch gate: a closure with no dispatch record FAILS =====");
  {
    const gateDir = () => { const d = path.join(tmp("gate"), "build-tasks"); syncTaskDir(d, RUN, OPTS); return d; };
    const idOf2 = (d, pred) => syncTaskDir(d, RUN, OPTS).tasks.find(pred).id;
    // READ-ONLY, and it has to be: `syncTaskDir` closes clocks, so a helper that re-sliced the folder to find a
    // file would close the very clock the open-clock case exists to leave open.
    const fileOf = (d, id) => path.join(d, fs.readdirSync(d).find((x) => x.endsWith(".md") && x !== TASK_INDEX_FILE
      && new RegExp(String.raw`^id: ${id}\s*$`, "m").test(fs.readFileSync(path.join(d, x), "utf8"))));
    // A task closes by accounting for its rows; the two words an agent writes go in `declared:`.
    const setStatus = (d, id, s) => {
      if (s === "done") { closeCells(d, id); return; }
      const f = fileOf(d, id);
      fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^declared: .*$/m, `declared: ${s}`));
    };
    // Fixed tokens so the assertions can name them; a real dispatch mints its own.
    const CLOSED_FOR_TEST = new Set(["done", "n/a"]);
    const TOK_A = "tok-alpha", TOK_BUILDER = "tok-builder", TOK_REVIEW = "tok-review", TOK_OPEN = "tok-open";
    const setNonce = (d, id, n) => {
      const f = fileOf(d, id);
      fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^agentNonce:.*$/m, `agentNonce: ${n}`));
    };

    // ---- the failing shape: closed, never started ----
    {
      const d = gateDir();
      const id = idOf2(d, (t) => t.artifact === ARTIFACT_SCAFFOLD);
      setStatus(d, id, "done");
      const set = syncTaskDir(d, RUN, { ...OPTS, now: at(12) });
      check("gate: a task closed with NO clock ever opened is in `failing` — this is the exit-2 set, not an advisory list, because nothing re-running the mode can supply a dispatch that never happened",
        () => set.dispatch.failing.some((t) => t.id === id) && set.dispatch.never.some((t) => t.id === id),
        () => ({ failing: set.dispatch.failing.map((t) => t.id), never: set.dispatch.never.map((t) => t.id) }));
      check("gate: `--start` REFUSES while that stands and opens NO clock — the run stops at the next dispatch instead of at the final gate, so one broken ledger costs one task and not a whole run",
        () => {
          const other = syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.status === "todo");
          const res = startTask(d, other.id, RUN, OPTS, null, at(20));
          return res.started === null && res.blockedByDispatch?.failing.length > 0
            && !readTimingsFile(d).running[other.id]
            && /todo/.test(fs.readFileSync(path.join(d, other.file), "utf8").split("---")[1]);
        },
        () => ({ running: readTimingsFile(d).running }));
    }

    // ---- `n/a` is the ONE closure that legitimately has no sub-agent, and the REASON is what earns that ----
    {
      const d = gateDir();
      const id = idOf2(d, (t) => t.artifact === ARTIFACT_SCAFFOLD);
      setStatus(d, id, "n/a");
      const bare = syncTaskDir(d, RUN, { ...OPTS, now: at(12) });
      check("gate: `n/a` with no dispatch record and NOTHING under `## Notes` FAILS — otherwise flipping every remaining task to `n/a` writes off a whole run in one edit, which is cheaper than any other way past the gate",
        () => bare.dispatch.failing.some((t) => t.id === id) && bare.dispatch.naNoReason.some((t) => t.id === id),
        () => ({ failing: bare.dispatch.failing.map((t) => t.id), naNoReason: bare.dispatch.naNoReason.map((t) => t.id) }));
      fs.appendFileSync(fileOf(d, id), "\nThe section this task scaffolds already exists on the stand.\n");
      const set = syncTaskDir(d, RUN, { ...OPTS, now: at(13) });
      check("gate: `status: n/a` with a WRITTEN REASON and no clock does NOT fail — a row that does not apply is closed without anyone building it, so requiring a dispatch record for it would make the gate unpassable",
        () => set.dispatch.failing.length === 0 && set.dispatch.naUndispatched.some((t) => t.id === id),
        () => ({ failing: set.dispatch.failing.map((t) => t.id), na: set.dispatch.naUndispatched.map((t) => t.id) }));
      check("gate: it is still NAMED on Attention — the one closure that needs no sub-agent is reported rather than silent, so the reason gets read",
        () => /recorded `n\/a` with no dispatch record/.test(readIndex(d)),
        () => readIndex(d).split("## Attention")[1]?.slice(0, 300));
    }

    // ---- the queue order, and one writer per artifact, enforced where the token is ISSUED ----
    {
      const d = gateDir();
      const all = syncTaskDir(d, RUN, OPTS).tasks;
      const dependent = all.find((t) => t.dependsOn.length && all.some((x) => x.id === t.dependsOn[0]));
      const dep = dependent && all.find((x) => x.id === dependent.dependsOn[0]);
      check("order (anti-vacuity): the fixture really has a task that names another one in `dependsOn`, and that other one is OPEN — otherwise the refusal below is asserted about a chain that does not exist",
        () => !!dependent && !!dep && !CLOSED_FOR_TEST.has(dep.status),
        () => ({ dependent: dependent?.id, dep: dep?.id, depStatus: dep?.status }));
      if (dependent && dep) {
        const res = startTask(d, dependent.id, RUN, OPTS, null, at(0));
        check("order: `--start` REFUSES a task whose `dependsOn` has not closed, and names each one with its status — a task built before its dependency reads answers that do not exist yet, so the queue order is not the caller's to honour",
          () => res.started === null && res.blockedByDeps?.some((x) => x.id === dep.id)
            && !readTimingsFile(d).running[dependent.id],
          () => ({ blocked: res.blockedByDeps?.map((x) => x.id), running: Object.keys(readTimingsFile(d).running) }));
      }
    }
    {
      // ONE WRITER PER ARTIFACT is enforced by the dependency chain: `chainMerged` makes every task that writes an
      // artifact depend on the previous writer of it, so two tasks on one artifact are serialized and `--start`
      // refuses the second while the first is open. Two repair tasks of different causes on one page are that
      // shape — same `writesTo`, the later chained onto the earlier. (`blockedByOverlap` is the secondary net for
      // a folder that somehow omits the chain; the chain is what actually holds a single sub-agent off both.)
      const d = gateDir();
      const reps = syncRepairDir(d, RUN, VERIFY_PAGES, OPTS).written;
      const set = syncTaskDir(d, RUN, OPTS);
      const pool = reps.map((r) => set.tasks.find((t) => t.id === r.id)).filter((t) => t?.writesTo);
      const b = pool.find((t) => pool.some((x) => x.writesTo === t.writesTo && t.dependsOn.includes(x.id)));
      const a = b && pool.find((x) => x.writesTo === b.writesTo && b.dependsOn.includes(x.id));
      check("one writer (anti-vacuity): two repair tasks really write the SAME artifact and are chained — the later depends on the earlier, so the refusal below is asserted about a real pair",
        () => !!a && !!b && a.writesTo === b.writesTo && b.dependsOn.includes(a.id),
        () => ({ a: a && { id: a.id, writesTo: a.writesTo }, b: b && { id: b.id, dependsOn: b.dependsOn } }));
      if (a && b) {
        clearDepsOf(d, a.id, RUN, OPTS);
        startTask(d, a.id, RUN, { ...OPTS, dispatchToken: TOK_A }, null, at(0));
        const res = startTask(d, b.id, RUN, OPTS, null, at(1));
        check("one writer: `--start` REFUSES the second writer of an artifact while the first is open — the chain serializes same-artifact tasks so one sub-agent can never hold both at once",
          () => res.started === null && res.blockedByDeps?.some((x) => x.id === a.id)
            && !readTimingsFile(d).running[b.id],
          () => ({ deps: res.blockedByDeps?.map((x) => x.id), overlap: res.blockedByOverlap?.map((x) => x.id) }));
      }
      // A read-only task claims no artifact, so it never conflicts and never blocks.
      const d2 = gateDir();
      const tasks2 = syncTaskDir(d2, RUN, OPTS).tasks;
      const writer = tasks2.find((t) => t.writesTo);
      const readOnly = tasks2.find((t) => !t.writesTo && !t.dependsOn.length);
      check("one writer (anti-vacuity): the fixture really holds both a writer and an independent read-only task — otherwise the read-only-starts-beside-a-writer case runs zero assertions and still reports green",
        () => !!writer && !!readOnly,
        () => ({ writer: writer?.id, readOnly: readOnly?.id }));
      if (writer && readOnly) {
        startTask(d2, writer.id, RUN, OPTS, null, at(0));
        const res2 = startTask(d2, readOnly.id, RUN, OPTS, null, at(1));
        check("one writer: a READ-ONLY task still starts beside a writer — it claims no artifact, so a rule that counted open clocks instead of comparing `writesTo` would serialise a run that has no reason to be serial",
          () => res2.started?.id === readOnly.id && !!readTimingsFile(d2).running[readOnly.id],
          () => ({ started: res2.started?.id, overlap: res2.blockedByOverlap?.map((x) => x.id) }));
      }
    }

    // ---- closed with the clock still OPEN: the books are behind, not wrong ----
    {
      const d = gateDir();
      const id = idOf2(d, (t) => t.artifact === ARTIFACT_SCAFFOLD);
      clearDepsOf(d, id, RUN, OPTS);
      startTask(d, id, RUN, { ...OPTS, dispatchToken: TOK_OPEN }, null, at(0));
      setStatus(d, id, "done");
      setNonce(d, id, TOK_OPEN);   // properly dispatched and properly signed: the ONLY thing wrong is the open clock
      // READ-ONLY, deliberately: `syncTaskDir` closes clocks before it audits, so this state is only ever
      // visible to a caller that reads the folder without re-slicing it — which is what `--verify` does.
      const audit = dispatchAudit(readTaskDir(d), d);
      check("gate: a task closed while its clock is STILL OPEN fails, and is reported apart from a never-dispatched one — its remedy is to re-run the mode, not to rebuild the task",
        () => audit.failing.some((t) => t.id === id) && audit.openClock.some((t) => t.id === id)
          && audit.never.length === 0,
        () => ({ open: audit.openClock.map((t) => t.id), never: audit.never.map((t) => t.id) }));
      check("gate: re-running `--tasks` CLEARS it — the sample is recorded and the same folder then passes, so the remedy the message gives actually works",
        () => syncTaskDir(d, RUN, { ...OPTS, now: at(12) }).dispatch.failing.length === 0,
        () => syncTaskDir(d, RUN, { ...OPTS, now: at(12) }).dispatch);
    }

    // ---- a dispatch that starts and closes within ONE timestamp tick ----
    // `closeClocks` deletes the open clock the moment a task closes. If it recorded a sample only for a positive
    // duration, a same-tick close (minute-granular `now`, or the clock skewing back) would leave neither clock
    // nor sample, and the gate would read a correctly dispatched-and-closed task as NEVER dispatched — failing a
    // run that did everything right. A sample is dispatch evidence first and a duration second.
    {
      const d = gateDir();
      const id = idOf2(d, (t) => t.artifact === ARTIFACT_SCAFFOLD);
      clearDepsOf(d, id, RUN, OPTS);
      startTask(d, id, RUN, { ...OPTS, dispatchToken: TOK_A }, null, at(0));
      setStatus(d, id, "done");
      setNonce(d, id, TOK_A);
      const set = syncTaskDir(d, RUN, { ...OPTS, now: at(0) });   // SAME tick as the start: zero elapsed
      check("gate: a task started and closed within ONE tick is still a dispatch record — a zero-duration sample is written, the gate does NOT fail it, and it counts toward `dispatched N of M`",
        () => set.dispatch.failing.length === 0
          && !set.dispatch.never.some((t) => t.id === id)
          && readTimingsFile(d).samples.some((s) => s.id === id)
          && set.dispatch.dispatched >= 1,
        () => ({ failing: set.dispatch.failing.map((t) => t.id), samples: readTimingsFile(d).samples.map((s) => ({ id: s.id, minutes: s.minutes })) }));
      check("gate: the zero-duration sample stays OUT of the forecast — it proves dispatch, not timing, so `readTimings` (the forecast's source) does not carry it",
        () => !readTimings(d).some((s) => s.id === id),
        () => readTimings(d).map((s) => ({ id: s.id, minutes: s.minutes })));
    }

    // ---- an ORCHESTRATOR-origin closure the gate exempts must read `—`, not `⚠ never`, in the column ----
    // `classifyUndispatched` exempts a non-engine-origin (repair) task from the dispatch gate. The Dispatched
    // column has to agree, or a row the gate does not fail carries a warning the run's dispatch state does not.
    {
      const d = gateDir();
      const rep = syncRepairDir(d, RUN, VERIFY_PAGES, OPTS).written[0];
      setStatus(d, rep.id, "done");   // closed with no dispatch record, exactly the shape the gate exempts
      const set = syncTaskDir(d, RUN, { ...OPTS, now: at(12) });
      const adopted = set.tasks.find((t) => t.id === rep.id);
      check("column (anti-vacuity): the repair task is adopted as `origin: orchestrator` — otherwise the exemption below is asserted about an engine-origin row",
        () => adopted?.origin === "orchestrator",
        () => adopted);
      check("column: an adopted task that WRITES an artifact IS held to a dispatch record — it writes a page exactly as a plan task does, and \"the engine did not schedule it\" is not a reason a closure needs no builder",
        () => set.dispatch.failing.some((t) => t.id === rep.id) && set.dispatch.never.some((t) => t.id === rep.id),
        () => ({ failing: set.dispatch.failing.map((t) => t.id), repairWritesTo: adopted?.writesTo }));
      check("column: and its Dispatched cell reads `\u26a0 never` — the column READS the gate rather than restating it, so the two cannot disagree about which row is failing",
        () => adopted?.dispatched === "never"
          && /⚠ never/.test(readIndex(d).split("\n").find((x) => x.includes(rep.file)) || ""),
        () => readIndex(d).split("\n").find((l) => l.includes(rep.file)));
    }

    // ---- an adopted READ-ONLY task claims nothing, so it is still exempt ----
    {
      const d = gateDir();
      const roFile = "task-orch-readonly.md";
      fs.writeFileSync(path.join(d, roFile),
        "---\nid: orch-ro\nstatus: done\ndeclared: \norigin: orchestrator\npageKey: main\ngroup: A read-only review\norder: 3\nwritesTo: \n---\n\n# A read-only review\n\n## Notes\n\njudged it myself\n");
      const set = syncTaskDir(d, RUN, { ...OPTS, now: at(12) });
      const ro = set.tasks.find((t) => t.id === "orch-ro");
      check("gate: an adopted READ-ONLY task is held to a dispatch record too — a verdict filed by the context that did the work is the failure this gate exists for, and a declared review is no exception",
        () => !!ro && !ro.writesTo && set.dispatch.failing.some((t) => t.id === "orch-ro"),
        () => ({ found: !!ro, writesTo: ro?.writesTo, status: ro?.status, failing: set.dispatch.failing.map((t) => t.id) }));
    }

    // ---- the signature: a value the agent does not choose ----
    {
      const d = gateDir();
      const id = idOf2(d, (t) => t.artifact === ARTIFACT_SCAFFOLD);
      clearDepsOf(d, id, RUN, OPTS);
      const res = startTask(d, id, RUN, { ...OPTS, dispatchToken: TOK_A }, null, at(0));
      check("signature: `--start` mints the token and hands it BACK to the caller — it is never written into the task file, because an agent holding several files would read a valid token off each one",
        () => res.dispatchToken === TOK_A
          && !/tok-alpha/.test(fs.readFileSync(path.join(d, res.started.file), "utf8")),
        () => res.dispatchToken);
      setStatus(d, id, "done");
      setNonce(d, id, TOK_A);
      check("signature: the task closed carrying the token it was issued PASSES — the honest run is not made to fail",
        () => syncTaskDir(d, RUN, { ...OPTS, now: at(12) }).dispatch.failing.length === 0,
        () => syncTaskDir(d, RUN, { ...OPTS, now: at(12) }).dispatch.signature);
    }
    {
      const d = gateDir();
      const id = idOf2(d, (t) => t.artifact === ARTIFACT_SCAFFOLD);
      clearDepsOf(d, id, RUN, OPTS);
      startTask(d, id, RUN, { ...OPTS, dispatchToken: TOK_A }, null, at(0));
      setStatus(d, id, "done");
      setNonce(d, id, "a-value-i-made-up");
      const set = syncTaskDir(d, RUN, { ...OPTS, now: at(12) });
      check("signature: a value the agent MINTED ITSELF fails — a self-chosen value is distinct on every file one agent closes, which is exactly why it can never show one agent closing several",
        () => set.dispatch.signature.some((s) => s.task.id === id && s.got === "a-value-i-made-up" && !s.owner),
        () => set.dispatch.signature);
    }

    // ---- the review signed by the builder of the very work it judges ----
    {
      const d = gateDir();
      const all = syncTaskDir(d, RUN, OPTS).tasks;
      const review = all.find((t) => !t.writesTo && t.dependsOn.length && t.group !== "Reference cache");
      const builder = review && all.find((t) => t.id === review.dependsOn[review.dependsOn.length - 1]);
      check("review (anti-vacuity): the fixture really pairs a read-only review with a WRITER it names in `dependsOn` — otherwise the check below is asserted about a task that is its own builder",
        () => !!review && !!builder && !!builder.writesTo && review.id !== builder.id,
        () => ({ review: review?.id, builder: builder?.id }));
      if (review && builder) {
        clearDepsOf(d, builder.id, RUN, OPTS);
        startTask(d, builder.id, RUN, { ...OPTS, dispatchToken: TOK_BUILDER }, null, at(0));
        setStatus(d, builder.id, "done");
        setNonce(d, builder.id, TOK_BUILDER);
        syncTaskDir(d, RUN, { ...OPTS, now: at(10) });
        startTask(d, review.id, RUN, { ...OPTS, dispatchToken: TOK_REVIEW }, null, at(10));
        setStatus(d, review.id, "done");
        setNonce(d, review.id, TOK_BUILDER);     // the builder's own context closing its own review
        const set = syncTaskDir(d, RUN, { ...OPTS, now: at(20) });
        const found = set.dispatch.signature.find((s) => s.task.id === review.id);
        check("signature: a `Quality gates` task signed with the token of a task it DEPENDS ON fails and names that task — a verdict filed by the context that did the work is not a verdict, which is the whole reason the review is a separate task",
          () => !!found && found.owner === builder.id,
          () => set.dispatch.signature.map((s) => ({ id: s.task.id, owner: s.owner })));
        check("signature: the index says so in those words, naming the review as judged by its own builder",
          () => /review task signed by a builder of the very work it judges/.test(readIndex(d)),
          () => readIndex(d).split("## Attention")[1]?.slice(0, 600));
      }
    }

    // ---- the shapes `timings.json` may legitimately be in ----
    {
      const d = gateDir();
      const id = idOf2(d, (t) => t.artifact === ARTIFACT_SCAFFOLD);
      setStatus(d, id, "done");
      const write = (running) => fs.writeFileSync(path.join(d, TIMINGS_FILE),
        JSON.stringify({ version: 1, samples: [], running }, null, 2));
      check("shape: an open clock is read as a bare `{id: iso}` map, as `{id: {startedAt}}`, AND as a LIST — a shape the reader does not recognise yields no open clocks, which is indistinguishable from a run in which everything was dispatched",
        () => {
          write({ [id]: at(0) });
          const a = dispatchAudit(readTaskDir(d), d).openClock.length;
          write({ [id]: { startedAt: at(0), token: "t" } });
          const b = dispatchAudit(readTaskDir(d), d).openClock.length;
          write([{ id, startedAt: at(0), token: "t" }]);
          const c = dispatchAudit(readTaskDir(d), d).openClock.length;
          return a === 1 && b === 1 && c === 1;
        }, () => "see the three running shapes");
    }

    // ---- the two visible surfaces ----
    {
      const d = gateDir();
      const id = idOf2(d, (t) => t.artifact === ARTIFACT_SCAFFOLD);
      clearDepsOf(d, id, RUN, OPTS);
      startTask(d, id, RUN, OPTS, null, at(0));
      const set = syncTaskDir(d, RUN, { ...OPTS, now: at(7) });
      check("progress: the block carries `dispatched N of M` — it is pasted into the chat after every dispatch and is the only surface a watching user has while the run is happening",
        // Two: the dependency that was dispatched and closed to reach this task, and this task itself, which is
        // still running. A clock counts from the moment it opens, not from the moment it closes.
        () => /dispatched 2 of \d+/.test(renderProgress(set, d, at(7))),
        () => renderProgress(set, d, at(7)));
      check("index: the dispatch fact is a CELL in the main table, not a paragraph below it — a row nobody was dispatched for is read at a glance beside its status",
        () => {
          const idx = readIndex(d);
          return /\| Step \| Task \| Page \| Writes \| Status \| Dispatched \|/.test(idx)
            && /▶ started/.test(idx);
        }, () => readIndex(d).split("\n").slice(7, 11).join("\n"));
      check("index: a task that is still OPEN reads `—`, never `⚠ never` — it has not had its turn yet, and a warning on every waiting row is what makes the ONE row that matters stop standing out",
        () => !/⚠ never/.test(readIndex(d)) && /\| — \|/.test(readIndex(d)),
        () => readIndex(d).split("\n").slice(7, 12).join("\n"));
      check("index: `⚠ never` appears once the task is CLOSED with no dispatch — the warning marks work that was finished with nobody sent to do it, which is the whole point of the column",
        () => {
          const dN = gateDir();
          const idN = idOf2(dN, (t) => t.artifact === ARTIFACT_SCAFFOLD);
          setStatus(dN, idN, "done");
          syncTaskDir(dN, RUN, { ...OPTS, now: at(12) });
          const idx = readIndex(dN);
          return /⚠ never/.test(idx) && idx.split("\n").filter((l) => /⚠ never/.test(l)).length === 1;
        }, () => "see the Dispatched column after one task closes undispatched");
      check("index: the Dispatched cell carries NO duration — the index is compared byte for byte, so two regenerations at different clock times must still be the same file",
        () => {
          const a = readIndex(d);
          syncTaskDir(d, RUN, { ...OPTS, now: at(99) });
          return a === readIndex(d) && !/\d min/.test(a);
        }, () => readIndex(d).slice(0, 400));
    }

    // ---- the recorded-run shapes, end to end through the CLI ----
    {
      // Defined locally: the shared `cliTasks` below is declared after this block.
      const cli = (args, manifest) => spawnSync(process.execPath, [MIGRATE, "-", ...args],
        { input: JSON.stringify(manifest), encoding: "utf8" });
      // The folder is cut BY THE CLI, which slices with the real default budget — a folder cut in-process with the
      // test's own budget carries different ids, and every closure written into it would read as stale instead.
      // "services": closures with no clock. Exit 2, every file named.
      const dS = path.join(tmp("gate-cli-s"), "build-tasks");
      cli(["--tasks", dS], MANIFEST);
      const closed = readTaskDir(dS).slice(0, 2);
      for (const t of closed) setStatus(dS, t.id, "done");
      const runS = cli(["--tasks", dS], MANIFEST);
      check("recorded shape (services): the CLI exits 2 and NAMES every closed task that no sub-agent was dispatched for, each with the `--start` that re-opens it — never a generic 'process violation'",
        () => runS.status === 2 && /DISPATCH GATE/.test(runS.stderr || "")
          && closed.every((t) => (runS.stderr || "").includes(t.file))
          && closed.every((t) => (runS.stderr || "").includes(`--start ${t.id}`)),
        () => ({ status: runS.status, stderr: (runS.stderr || "").slice(0, 700) }));
      check("recorded shape (services): the folder and the index WERE written — what failed is the run, not the slice, and a caller that reads exit 2 as 'nothing was written' would re-cut a folder that is already correct",
        () => fs.existsSync(path.join(dS, TASK_INDEX_FILE))
          && /what failed is the run, not the slice/.test(runS.stderr || ""),
        () => (runS.stderr || "").slice(0, 400));

      // Dispatch every task in DEPENDENCY ORDER, the way the orchestrator must: `--start` refuses a task whose
      // `dependsOn` is still open, so picking files in directory order does not work.
      const dispatchAll = (dir) => {
        for (let i = 0; i < 20; i++) {
          const tasks = readTaskDir(dir);
          const next = tasks.find((t) => t.status === "todo" && t.dependsOn.every((d) => {
            const dep = tasks.find((x) => x.id === d);
            return !dep || dep.status === "done" || dep.status === "n/a";
          }));
          if (!next) return;
          const started = cli(["--tasks", dir, "--start", next.id], MANIFEST);
          const tok = /DISPATCH TOKEN for `[^`]+`: (\S+)/.exec(started.stdout || "")?.[1];
          setStatus(dir, next.id, "done");
          setNonce(dir, next.id, tok || "");
          cli(["--tasks", dir], MANIFEST);
        }
      };
      // "applicants": the same plan with every closure dispatched AND signed. Unchanged: exit 0.
      const dA = path.join(tmp("gate-cli-a"), "build-tasks");
      cli(["--tasks", dA], MANIFEST);
      dispatchAll(dA);
      const runA = cli(["--tasks", dA], MANIFEST);
      check("recorded shape (applicants): the SAME plan with every closure dispatched exits 0 and raises nothing — the gate has to tell the two runs apart, which is the whole point, and a gate that failed both would just be noise",
        () => runA.status === 0 && !/DISPATCH GATE/.test(runA.stderr || ""),
        () => ({ status: runA.status, stderr: (runA.stderr || "").slice(0, 400) }));

      // THE HEADLINE CASE: a run whose PLAN and BUILD are both fine and which still must not pass. The plan is
      // gate-clean and this mode computes no build verdict at all, so exit 2 here is attributable to the dispatch
      // gate ALONE — nothing else in the exit-code decision can produce it.
      check("attribution: the services folder's exit 2 comes from the DISPATCH gate and nothing else — no plan-level banner and no build verdict is present, so a run that is otherwise entirely clean still does not pass",
        () => runS.status === 2 && /DISPATCH GATE/.test(runS.stderr || "")
          && !/GATE BLOCKED|STRUCTURE INCOMPLETE|COVERAGE INCOMPLETE|VERIFY INCOMPLETE/.test(runS.stderr || ""),
        () => (runS.stderr || "").slice(0, 500));
      check("attribution: the message says this is neither a plan gap nor a short build — the three exit-2 verdicts have different remedies, and re-planning or rebuilding buys nothing here",
        () => /NOT a plan gap and NOT a short build/.test(runS.stderr || ""),
        () => (runS.stderr || "").slice(0, 500));

      // The verify leg carries its own assignment of the verdict, so it needs its own assertion: removing it
      // would leave the `--tasks` checks above green while the FINAL gate went quiet.
      const builtEmpty = path.join(path.dirname(dS), "built.json");
      fs.writeFileSync(builtEmpty, JSON.stringify({ pages: { main: false } }));
      const runV = cli(["--verify", "--built", builtEmpty, "--tasks", dS], MANIFEST);
      check("verify leg: `--verify --tasks` runs the dispatch gate over the folder too, so the run's FINAL gate cannot pass a folder whose work nobody was dispatched for",
        () => runV.status === 2 && /DISPATCH GATE/.test(runV.stderr || ""),
        () => ({ status: runV.status, stderr: (runV.stderr || "").slice(0, 400) }));
      check("verify leg: NO repair task is written while that gate fails — a repair round would schedule more sub-agents on top of work nobody was dispatched for, and its rows cannot be trusted to describe what was built",
        () => /NO REPAIR TASKS WRITTEN/.test(runV.stdout || "")
          && !fs.readdirSync(dS).some((f) => /repair/i.test(f)),
        () => fs.readdirSync(dS).join(" · "));
      check("verify leg: the failing files are listed on ONE stream — stdout carries the verify table the caller presents verbatim, so the same list on both streams is that report read twice",
        () => {
          const onOut = ((runV.stdout || "").match(/ · task-/g) || []).length;
          const onErr = ((runV.stderr || "").match(/ · task-/g) || []).length;
          return onOut === 0 && onErr > 0;
        },
        () => ({ stdout: ((runV.stdout || "").match(/ · task-/g) || []).length,
                 stderr: ((runV.stderr || "").match(/ · task-/g) || []).length }));
      check("verify leg: a plain `--verify` with no folder SAYS the dispatch gate did not run, on stderr — the caller presents stdout verbatim as the report, so a note about what was not checked must not land inside that table",
        () => {
          const runP = cli(["--verify", "--built", builtEmpty], MANIFEST);
          return /the dispatch\s+gate did not run/.test(runP.stderr || "")
            && !/dispatch/i.test(runP.stdout || "");
        }, () => cli(["--verify", "--built", builtEmpty], MANIFEST).stdout?.slice(-300));

      // A repair round re-derives the index, so it has to carry the dispatch fact forward like every other run.
      check("repair round: the Dispatched column SURVIVES a `--verify --tasks` regeneration — the index it rewrites is the same derived file, and a repair round that blanked the column would erase what the build rounds recorded",
        () => {
          const dR = path.join(tmp("gate-repair"), "build-tasks");
          cli(["--tasks", dR], MANIFEST);
          dispatchAll(dR);
          const b = path.join(path.dirname(dR), "b.json");
          fs.writeFileSync(b, JSON.stringify({ pages: { main: false } }));
          cli(["--verify", "--built", b, "--tasks", dR], MANIFEST);
          const idx = fs.readFileSync(path.join(dR, TASK_INDEX_FILE), "utf8");
          return /\| Dispatched \|/.test(idx) && /✔ yes/.test(idx);
        }, () => "see index.md after a repair round");
    }
  }

  // 4 — the forecast is a RANGE, and it comes from this run once this run has data.
  check("forecast: with no samples it is the engine's calibrated rate ±50% — a single number would claim a precision the measured spread (0.49-1.00 min per weight unit) does not have",
    () => {
      const f = forecastMinutes(40, []);
      return f.n === 0 && f.low === Math.round(40 * TASK_BUDGET.minutesPerWeight * 0.5)
        && f.high === Math.round(40 * TASK_BUDGET.minutesPerWeight * 1.5) && f.low < f.high;
    }, () => forecastMinutes(40, []));
  check("forecast: from four samples on it uses THIS run's observed quartiles instead of the constant — the constant is one run's median and the folder in front of it is not",
    () => {
      const slow = [1, 2, 3, 4].map((i) => ({ weight: 10, minutes: 100 + i }));
      const f = forecastMinutes(10, slow);
      return f.n === 4 && f.low >= 100 && f.high >= f.low && f.low > forecastMinutes(10, []).high;
    }, () => forecastMinutes(10, [1, 2, 3, 4].map((i) => ({ weight: 10, minutes: 100 + i }))));
  check("forecast: a weightless task gets no forecast at all rather than a zero — nothing is not the same claim as instant",
    () => forecastMinutes(0, []) === null && forecastMinutes(undefined, []) === null,
    () => [forecastMinutes(0, []), forecastMinutes(undefined, [])]);

  // 5 — the progress block, and the index's freedom from the clock.
  {
    // The reference cache is the run's FIRST task and waits on nothing, so this exercises a folder in which
    // no task has closed yet — which is what the cold-start basis below is about.
    const d = fresh();
    const id = idOf(d, (t) => t.artifact === ARTIFACT_REFS);
    startTask(d, id, RUN, OPTS, null, at(0));
    const set = syncTaskDir(d, RUN, { ...OPTS, now: at(7) });
    const text = renderProgress(set, d, at(7));
    check("progress: the block names the running task, how long it has been running and what it is expected to take, plus the counts and the remaining estimate — one paste, rendered by the engine so the chat and the folder cannot drift apart",
      () => /RUNNING/.test(text) && /running 7 min/.test(text) && /expected \d+-\d+ min/.test(text)
        && /done 0 · running 1 · todo/.test(text) && /min left/.test(text) && /dispatched 1 of/.test(text),
      () => text);
    check("progress: it says WHICH basis the estimate rests on — this run's own closed tasks, or the calibrated rate when none has closed yet",
      () => /no task of this run has closed yet/.test(text), () => text);
    check("index.md carries NO clock — it is a DERIVED file the goldens compare byte for byte, so a timestamp in it would make every regeneration a different file; the times live in the task files and the progress block",
      () => {
        const a = readIndex(d);
        const b = (syncTaskDir(d, RUN, { ...OPTS, now: at(99) }), readIndex(d));
        return a === b && !/\d{4}-\d{2}-\d{2}T/.test(a) && / min/.test(text);
      }, () => readIndex(d).slice(0, 400));
  }
}

console.log("\n===== migrate.mjs --tasks <dir> (CLI) =====");
const cliTasks = (args, manifest) => spawnSync(process.execPath, [MIGRATE, "-", ...args], { input: JSON.stringify(manifest), encoding: "utf8" });
// The CLI has no `run: 0` to hand it, so it slices this small fixture with the REAL default budget — which
// collapses it. Everything the CLI block asserts about counts and file names has to be read off that set.
const CLI_SET = buildTaskSet(RUN, checklistOpts(MANIFEST));
{
  const base = tmp("cli");
  const dir = path.join(base, "build-tasks");   // deliberately NOT pre-created: the mode must create it
  const run = cliTasks(["--tasks", dir], MANIFEST);
  // The note does not tell the caller to pick the next task off the index's `Step` column. That
  // instruction and the `--next` mode are two answers to one question printed on one stream, and the index is a
  // DERIVED report whose shape has already moved under a caller parsing it.
  check("migrate.mjs --tasks: a gate-clean plan exits 0, creates the directory, writes one file per task plus the index, and prints a note naming the count, the index to present and the mode that answers WHICH task to start",
    () => run.status === 0 && fs.existsSync(path.join(dir, TASK_INDEX_FILE))
      && new RegExp(String.raw`wrote ${CLI_SET.tasks.length} build task\(s\) \+ ${TASK_INDEX_FILE}`).test(run.stdout || "")
      && /Do NOT pick the next task off that index/.test(run.stdout || "")
      && /--next/.test(run.stdout || "")
      && !/in the `Step` order that index lists/.test(run.stdout || ""),
    () => ({ status: run.status, stdout: run.stdout, stderr: run.stderr, ls: fs.existsSync(dir) ? fs.readdirSync(dir) : null }));
  check("migrate.mjs --tasks: with nothing recorded yet the note says 0 done and prints NO ⚠ line — a clean slice must not ask for a human eye it does not need",
    () => new RegExp(String.raw`— 0 done, ${CLI_SET.tasks.length} not\.`).test(run.stdout || "") && !/need a human eye/.test(run.stdout || ""),
    () => run.stdout);
  // An unrecognised status recorded by hand: the ⚠ stdout line is the other half of "reported, never coerced".
  const victim = path.join(dir, CLI_SET.tasks.find((t) => t.writesTo).file);
  fs.writeFileSync(victim, fs.readFileSync(victim, "utf8").replace("status: todo", "status: kinda-done"));
  const rerun = cliTasks(["--tasks", dir], MANIFEST);
  check("migrate.mjs --tasks: an unrecognised recorded status is reported on STDOUT as an item needing a human eye, is on the index's Attention section, and is still in the task's own file verbatim — never rewritten to `todo`",
    () => /⚠ 1 task\(s\) need a human eye/.test(rerun.stdout || "")
      && /unrecognised status `kinda-done`/.test(readIndex(dir))
      && /status: kinda-done/.test(fs.readFileSync(victim, "utf8")),
    () => ({ stdout: rerun.stdout, file: fs.readFileSync(victim, "utf8").slice(0, 200) }));
  fs.rmSync(base, { recursive: true, force: true });
}
{
  const base = tmp("both");
  const dir = path.join(base, "build-tasks");
  const out = path.join(base, "artifact.md");
  const run = cliTasks(["--tasks", dir, "--out", out], MANIFEST);
  check("migrate.mjs --tasks: combining it with `--out` is exit 1 with an actionable message — the mode writes the folder itself, so `--out` names no artifact here and silently ignoring it would leave the caller waiting on a file that is never written",
    run.status === 1 && /--tasks/.test(run.stderr || "") && /--out/.test(run.stderr || "") && (run.stdout || "").trim() === "",
    () => ({ status: run.status, stdout: run.stdout, stderr: run.stderr }));
  check("migrate.mjs --tasks + --out: the refusal happens before anything is written — neither the folder nor the `--out` file exists afterwards",
    !fs.existsSync(dir) && !fs.existsSync(out), () => fs.readdirSync(base));
  fs.rmSync(base, { recursive: true, force: true });
}
{
  // A PLAN-level gap. `gate` / `structure` / `coverage` describe the PLAN and no build round closes one, so slicing
  // this into tasks would hand sub-agents write access to a stand against deliverables the plan cannot state.
  const skeletal = { ...MANIFEST, seed: [{ pkg: "BaseModulePageV2", body: 'define("BaseModulePageV2",[],function(){return{diff:[{operation:"insert",name:"ProfileContainer",values:{itemType:15}},{operation:"insert",name:"Tabs",values:{itemType:15}}],methods:{init:function(){return 1;}}};});' }] };
  const gapRun = runMigration(skeletal);
  check("plan gap fixture (anti-vacuity): the skeletal-seed manifest really does carry a PLAN-level gap, so the refusal below is the behaviour under test and not an accident of a clean plan",
    planGaps(gapRun).length > 0, () => planGaps(gapRun));
  const base = tmp("gap");
  const dir = path.join(base, "build-tasks");
  const run = cliTasks(["--tasks", dir], skeletal);
  check("migrate.mjs --tasks: a plan-level gap writes NOTHING and exits 2 — the directory is never created, so a sub-agent cannot be dispatched with write access to a stand against a plan that is not buildable-out-of",
    run.status === 2 && !fs.existsSync(dir) && fs.readdirSync(base).length === 0,
    () => ({ status: run.status, exists: fs.existsSync(dir), ls: fs.readdirSync(base), stdout: run.stdout }));
  check("migrate.mjs --tasks: the refusal names every gap and says what to do instead — fix the manifest / the stand, re-run `--plan`, re-approve if the plan changed, and slice tasks only then",
    () => /⛔ NOTHING WRITTEN — no task folder for a plan with gaps/.test(run.stdout || "")
      && planGaps(gapRun).every((g) => (run.stdout || "").includes(g))
      && /re-run `--plan`/.test(run.stdout || ""),
    () => run.stdout);
  fs.rmSync(base, { recursive: true, force: true });
}

console.log("\n===== migrate.mjs --tasks --split (CLI): validated once, then frozen =====");
{
  const base = tmp("cli-split");
  const dir = path.join(base, "build-tasks");
  const splitPath = path.join(base, "split.json");
  fs.writeFileSync(splitPath, JSON.stringify({ planVersion: RUN.planVersion, items: FULL_SPLIT.items }, null, 2));
  const run = cliTasks(["--tasks", dir, "--split", splitPath], MANIFEST);
  check("migrate.mjs --split: a resolving split cuts the folder and SAYS which cut it used — a caller must be able to tell a hand-decided folder from one the budget slicer produced",
    () => run.status === 0 && /Cut by a frozen split of \d+ item\(s\)/.test(run.stdout || "")
      && fs.existsSync(path.join(dir, TASK_INDEX_FILE)),
    () => ({ status: run.status, stdout: run.stdout, stderr: run.stderr }));
  check("migrate.mjs --split: the file is COPIED INTO the folder — that copy is what makes every later run a reconciliation instead of a second opinion, and it must not depend on the caller still having the original path",
    () => fs.existsSync(path.join(dir, SPLIT_FILE))
      && JSON.parse(fs.readFileSync(path.join(dir, SPLIT_FILE), "utf8")).items.length === FULL_SPLIT.items.length,
    () => fs.readdirSync(dir));
check("migrate.mjs --split: a re-slice with NO `--split` reads the frozen copy and produces the same tasks — the cut does not get re-decided, so a recorded `done` cannot move to a task that does not exist",
    () => {
      const ids = () => fs.readdirSync(dir).filter((f) => f.startsWith("task-")).sort().join(",");
      const before = ids();
      const again = cliTasks(["--tasks", dir], MANIFEST);
      return again.status === 0 && /Cut by a frozen split/.test(again.stdout || "") && ids() === before;
    }, () => fs.readdirSync(dir));
  fs.rmSync(base, { recursive: true, force: true });
}
{
  const base = tmp("cli-split-bad");
  const dir = path.join(base, "build-tasks");
  const splitPath = path.join(base, "split.json");
  // One item short of the plan: a row nobody is scheduled to build.
  const short = FULL_SPLIT.items.map((i) => i.pageKey === "main" ? { ...i, rows: i.rows.slice(1) } : i);
  fs.writeFileSync(splitPath, JSON.stringify({ planVersion: RUN.planVersion, items: short }, null, 2));
  const run = cliTasks(["--tasks", dir, "--split", splitPath], MANIFEST);
  check("migrate.mjs --split: a row claimed by NOBODY writes NOTHING at all — a folder that schedules every row but one still leaves that row unbuilt, and nothing downstream measures a row no task holds",
    () => /NOTHING WRITTEN/.test(run.stdout || "") && /is in NO item/.test(run.stdout || "")
      && /will not pick an owner/.test(run.stdout || "")
      && !fs.existsSync(path.join(dir, TASK_INDEX_FILE)),
    () => ({ status: run.status, stdout: run.stdout, exists: fs.existsSync(dir) ? fs.readdirSync(dir) : null }));
  check("migrate.mjs --split: that refusal names the file the operator PASSED, not a frozen one — nothing is frozen on a first cut and the folder does not exist yet, so `the frozen split in <dir>` would send them to edit a file that is not there",
    () => /the split passed with --split does not cover this plan/.test(run.stdout || "")
      && !/frozen split/.test(run.stdout || "")
      && /drop --split to fall back/.test(run.stdout || "")
      && !/Expected shape/.test(run.stdout || ""),   // it parsed and resolved; its coverage is short, not its shape
    () => run.stdout);
  // A row claimed twice: refused, and NOTHING is written.
  const base2 = tmp("cli-split-dup");
  const dir2 = path.join(base2, "build-tasks");
  const dupPath = path.join(base2, "split.json");
  const mainRows = FULL_SPLIT.items.find((i) => i.pageKey === "main").rows;
  fs.writeFileSync(dupPath, JSON.stringify({ planVersion: RUN.planVersion,
    items: [...FULL_SPLIT.items, { id: "double-claim", title: "d", pageKey: "main", writesTo: "main", rows: [mainRows[0]] }] }, null, 2));
  const bad = cliTasks(["--tasks", dir2, "--split", dupPath], MANIFEST);
  check("migrate.mjs --split: a row claimed TWICE writes NOTHING at all — a folder built from half a split schedules part of a plan and drops the rest, which is the exact failure the coverage check exists to prevent",
    () => /NOTHING WRITTEN/.test(bad.stdout || "") && /is claimed 2 times/.test(bad.stdout || "")
      && !fs.existsSync(path.join(dir2, TASK_INDEX_FILE)),
    () => ({ stdout: bad.stdout, exists: fs.existsSync(dir2) ? fs.readdirSync(dir2) : null }));
  check("migrate.mjs --split: that refusal's remedy NAMES the file to fix — its cause line is the generic 'does not resolve', which mentions no file, so a bare `that file` would refer to nothing the reader has been shown",
    () => /Fix the file you passed with --split and re-run/.test(bad.stdout || "")
      && !/Fix that file/.test(bad.stdout || ""),
    () => bad.stdout);
  // A folder cut against one plan, met by a plan that GAINED rows. The split still PARSES and its coverage falls
  // short, and the refusal has to say which, because the two are cleared by different edits.
  const baseD = tmp("cli-split-drift");
  const dirD = path.join(baseD, "build-tasks");
  const splitD = path.join(baseD, "split.json");
  fs.writeFileSync(splitD, JSON.stringify(FULL_SPLIT, null, 2));
  cliTasks(["--tasks", dirD, "--split", splitD], MANIFEST);        // built against plan A
  const drift = cliTasks(["--tasks", dirD], MANIFEST5);            // plan B gained handler rows
  const driftRoute = cliTasks(["--tasks", dirD, "--route"], MANIFEST5);
  const builtD = path.join(baseD, "built.json");
  fs.writeFileSync(builtD, JSON.stringify({ pages: { main: false } }));
  const driftVerify = cliTasks(["--verify", "--built", builtD, "--tasks", dirD], MANIFEST5);
  check("migrate.mjs: a frozen split met by a plan that GAINED rows names THAT as the cause and offers both remedies — 'could not be read' would send the operator to fix a file whose syntax is fine",
    () => /NOTHING WRITTEN/.test(drift.stdout || "") && /no longer covers this plan/.test(drift.stdout || "")
      && !/could not be read/.test(drift.stdout || "")
      && /Place the named rows/.test(drift.stdout || "")
      && /delete `?split\.json`? to fall back/.test(drift.stdout || ""),
    () => drift.stdout);
  check("--route names the SAME cause and remedy for that folder — a repair round reads the cut the build leg reads, so one state cannot be a coverage shortfall on one command and an unreadable file on the other",
    () => /NO REPAIR TASKS WRITTEN/.test(driftRoute.stdout || "")
      && /no longer covers this plan/.test(driftRoute.stdout || "")
      && !/could not be read/.test(driftRoute.stdout || "")
      && /Place the named rows/.test(driftRoute.stdout || ""),
    () => driftRoute.stdout);
  check("--verify's repair leg answers that folder the same way — the two legs share one cause writer, so a reader cannot be told the file is unreadable on one and short on coverage on the other",
    () => {
      const out = (driftVerify.stdout || "") + (driftVerify.stderr || "");
      return /yielded no tasks/.test(out) && /is in NO item/.test(out) && !/could not be read/.test(out);
    },
    () => ({ banner: ((driftVerify.stdout || "") + (driftVerify.stderr || ""))
      .split(/\r?\n/).filter((l) => /REPAIR|covers|could not be read/.test(l)).join(" | ").slice(0, 700) }));
  fs.rmSync(baseD, { recursive: true, force: true });
  // A split cut against a DIFFERENT plan version.
  const base3 = tmp("cli-split-ver");
  const dir3 = path.join(base3, "build-tasks");
  const verPath = path.join(base3, "split.json");
  fs.writeFileSync(verPath, JSON.stringify({ planVersion: "plan-deadbeef0000", items: FULL_SPLIT.items }, null, 2));
  const ver = cliTasks(["--tasks", dir3, "--split", verPath], MANIFEST);
  check("migrate.mjs --split: a split cut against ANOTHER plan version is refused by name — the seams were decided against different deliverables, and honouring them would schedule a cut nobody made for this plan",
    () => ver.status === 1 && /was cut against plan/.test(ver.stderr || "") && !fs.existsSync(dir3),
    () => ({ status: ver.status, stderr: ver.stderr }));
  check("migrate.mjs --split: `--split` without `--tasks` is refused — it names where a folder's seams are, and there is no folder to cut",
    () => {
      const r = cliTasks(["--split", verPath, "--plan"], MANIFEST);
      return r.status === 1 && /only means something with/.test(r.stderr || "");
    }, () => cliTasks(["--split", verPath, "--plan"], MANIFEST).stderr);
  fs.rmSync(base, { recursive: true, force: true });
  fs.rmSync(base2, { recursive: true, force: true });
  fs.rmSync(base3, { recursive: true, force: true });
}

console.log("\n===== migrate.mjs --verify --tasks <dir> (CLI): the repair round =====");
{
  const base = tmp("cli-repair");
  const dir = path.join(base, "build-tasks");
  cliTasks(["--tasks", dir], MANIFEST);
  const planFiles = fs.readdirSync(dir).length;
  // An EMPTY built payload: every machine row is open, so the verify run has real rows to cut a round from.
  const builtFile = path.join(base, "built.json");
  // `false` = the page is genuinely absent, which is a valid payload entry and a hard MISSING on every row.
  fs.writeFileSync(builtFile, JSON.stringify({ pages: { main: false } }));
  const run = cliTasks(["--verify", "--built", builtFile, "--tasks", dir], MANIFEST);
  check("migrate.mjs --verify --tasks: the ONE legal pairing — `--verify` is still the mode and the folder is where its OPEN ROWS are written, so the migration result report is printed AND the repair round lands",
    () => run.status === 2 && (run.stdout || "").startsWith("# Migration result")
      && /wrote \d+ repair task\(s\) \(round 1\)/.test(run.stdout || "")
      && fs.readdirSync(dir).length > planFiles,
    () => ({ status: run.status, stdout: (run.stdout || "").slice(-800), ls: fs.readdirSync(dir) }));
  check("migrate.mjs --verify --tasks: the repair files are engine-authored REPAIR tasks, named by round and cause, and they declare the page artifact they write so the queue sequences them behind that page's build",
    () => {
      const repairs = fs.readdirSync(dir).filter((f) => f.startsWith("task-repair-round1-"));
      return repairs.length > 0 && repairs.every((f) => {
        const { meta } = parseTaskFile(fs.readFileSync(path.join(dir, f), "utf8"));
        return meta.kind === "repair" && meta.repairRound === "1" && meta.origin === "engine"
          && meta.cause && meta.writesTo.startsWith("page:");
      });
    }, () => fs.readdirSync(dir).filter((f) => f.startsWith("task-repair-")));
  const again = cliTasks(["--verify", "--built", builtFile, "--tasks", dir], MANIFEST);
  check("migrate.mjs --verify --tasks: re-verifying the same unchanged page opens NO second round and says why — a round is an attempt, and counting verify runs would burn the cap with nobody having run",
    () => /already have an OPEN repair task/.test(again.stdout || "")
      && !/round 2/.test(again.stdout || "")
      && fs.readdirSync(dir).filter((f) => f.startsWith("task-repair-round2-")).length === 0,
    () => (again.stdout || "").slice(-600));
  check("migrate.mjs --verify --tasks: a plain re-slice ADOPTS the repair files — never rewritten (their rows are one verify run's, not the plan's) and never reported stale (they never were in the plan)",
    () => {
      const one = fs.readdirSync(dir).find((f) => f.startsWith("task-repair-round1-"));
      const p1 = path.join(dir, one);
      fs.writeFileSync(p1, fs.readFileSync(p1, "utf8").replace("status: todo", "status: in-progress") + "\nfixed 3 so far\n");
      const before = fs.readFileSync(p1, "utf8");
      const res = cliTasks(["--tasks", dir], MANIFEST);
      // Its BODY is untouched; the `status:` line and the stamp that moves with it are the engine's.
      return sansStatusLines(fs.readFileSync(p1, "utf8")) === sansStatusLines(before)
        && !/no longer in the plan/.test(fs.readFileSync(path.join(dir, TASK_INDEX_FILE), "utf8"))
        && res.status === 0;
    }, () => fs.readFileSync(path.join(dir, TASK_INDEX_FILE), "utf8").slice(-900));
  fs.rmSync(base, { recursive: true, force: true });
}

{
  // A PLAN-level gap reaches `--verify --tasks` too, and it must write NOTHING — not the repair tasks, and not the
  // regenerated index, which would be re-derived from a plan the repair rows were never cut against.
  const skeletal = { ...MANIFEST, seed: [{ pkg: "BaseModulePageV2", body: 'define("BaseModulePageV2",[],function(){return{diff:[{operation:"insert",name:"ProfileContainer",values:{itemType:15}},{operation:"insert",name:"Tabs",values:{itemType:15}}],methods:{init:function(){return 1;}}};});' }] };
  check("plan gap fixture (anti-vacuity): the skeletal-seed manifest really carries a PLAN-level gap, so the refusal below is the behaviour under test",
    planGaps(runMigration(skeletal)).length > 0, () => planGaps(runMigration(skeletal)));
  const base = tmp("cli-repair-gap");
  const dir = path.join(base, "build-tasks");
  fs.mkdirSync(dir, { recursive: true });
  const marker = path.join(dir, TASK_INDEX_FILE);
  fs.writeFileSync(marker, "# an index from an EARLIER, gap-free slice\n");
  const builtFile = path.join(base, "built.json");
  fs.writeFileSync(builtFile, JSON.stringify({ pages: { main: false } }));
  const run = cliTasks(["--verify", "--built", builtFile, "--tasks", dir], skeletal);
  check("migrate.mjs --verify --tasks: a PLAN-level gap writes NO repair task AND does not regenerate the index — repairing against a plan that cannot state its own deliverables spends sub-agents on rows nothing can close, and re-deriving the index would replace it from a plan the existing rows were never cut against",
    () => /NO REPAIR TASKS WRITTEN/.test(run.stdout || "")
      && fs.readFileSync(marker, "utf8") === "# an index from an EARLIER, gap-free slice\n"
      && fs.readdirSync(dir).filter((f) => f.startsWith("task-repair-")).length === 0,
    () => ({ stdout: (run.stdout || "").slice(-400), ls: fs.readdirSync(dir), index: fs.readFileSync(marker, "utf8") }));
  fs.rmSync(base, { recursive: true, force: true });
}

console.log("\n===== designspec: pageGroup publishes `baseTitle` =====");
check("pageGroup: every group publishes `baseTitle` — its own name, unprefixed and unescaped — so a consumer that must RECOGNISE the group never unpicks the rendered `title`'s escaped page prefix",
  () => GROUPS.every((g) => typeof g.baseTitle === "string" && g.baseTitle.length > 0)
    && GROUPS.filter((g) => g.pageKey === "main").every((g) => g.title === g.baseTitle)
    && GROUPS.filter((g) => g.pageKey !== "main").every((g) => g.title.endsWith(` · ${g.baseTitle}`) && g.title !== g.baseTitle),
  () => GROUPS.map((g) => ({ pageKey: g.pageKey, title: g.title, baseTitle: g.baseTitle })));
check("pageGroup: the SAME group name on two different pages yields the same `baseTitle` while the rendered `title`s differ — that is what lets `tasks.mjs` order its build phases by it, and what a prefixed `title` cannot do",
  () => {
    const named = GROUPS.filter((g) => g.baseTitle === "Quality gates");
    return named.length >= 2 && new Set(named.map((g) => g.title)).size === named.length;
  }, () => GROUPS.filter((g) => g.baseTitle === "Quality gates").map((g) => g.title));

console.log("\n===== the OUTCOME column: the status is computed from the rows, not typed =====");
// Rewrites the Outcome cell of row `n` (1-based) of a rendered task file. The agent edits this cell and nothing
// else in the table; every test below goes through the same path a sub-agent would.
function setOutcome(text, n, value) {
  let seen = 0;
  return text.split("\n").map((line) => {
    const cells = line.split(/(?<!\\)\|/);
    if (cells.length < 7 || !/^\s*\d+\s*$/.test(cells[1])) return line;
    seen++;
    if (seen !== n) return line;
    cells[5] = ` ${value} `;
    return cells.join("|");
  }).join("\n");
}
// Hoisted: written by most checks below.
// One task re-read through the merge, exactly as `syncTaskDir` does it: render → edit → parse → carry over.
const reread = (task, set, edit) => {
  const text = edit(renderTaskFile(task, set));
  const merged = mergeTaskSet({ ...set, tasks: [task] }, [{ file: task.file, ...parseTaskFile(text) }]);
  return merged.tasks[0];
};

check("BACKWARD COMPATIBLE: a task in a LEGACY folder (no `declared:` field) whose Outcome column is entirely empty keeps the status it recorded — every folder written before this existed is in exactly that shape, and turning them all `partial` on the first re-slice would make the new state meaningless",
  () => {
    const asDone = reread(SAMPLE, SET, (t) => asLegacyBody(t).replace("status: todo", "status: done"));
    const asTodo = reread(SAMPLE, SET, (t) => asLegacyBody(t));
    return asDone.status === "done" && asTodo.status === "todo";
  }, () => ({ done: reread(SAMPLE, SET, (t) => asLegacyBody(t).replace("status: todo", "status: done")).status }));

check("BACKWARD COMPATIBLE: a file carrying the OLD four-column table (no Outcome column at all) parses to no outcomes and keeps its recorded status — the parser must not read the `Closed by` cell as an outcome",
  () => {
    const old = renderTaskFile(SAMPLE, SET)
      .replace("| # | From | Deliverable | Closed by | Outcome |", "| # | From | Deliverable | Closed by |")
      .replace("| --- | --- | --- | --- | --- |", "| --- | --- | --- | --- |")
      .split("\n").map((l) => (/^\|\s*\d+\s*\|/.test(l) ? l.replace(/\|\s*—\s*\|\s*$/, "|") : l)).join("\n")
      .replace("status: todo", "status: done");
    const parsed = parseTaskFile(old);
    return parsed.outcomes.size === 0 && parsed.meta.status === "done";
  }, () => parseTaskFile(renderTaskFile(SAMPLE, SET)).outcomes.size);

check("a table the AGENT wrote under `## Notes` is NOT read as deliverables — a real recorded run carries a nine-row list-column table there whose rows have enough cells to look exactly like a deliverables row, and computing a task's status off a table the engine never wrote is the same defect one level down",
  () => {
    const withNotesTable = renderTaskFile(SAMPLE, SET).replace(/## Notes\n/, [
      "## Notes", "",
      "| # | Column | Type | Source | Outcome |",
      "| --- | --- | --- | --- | --- |",
      "| 1 | PDS_TsName | Text | profile | built |",
      "| 2 | PDS_TsAccount | Lookup | profile | built |",
      "",
    ].join("\n"));
    const parsed = parseTaskFile(withNotesTable);
    return parsed.outcomes.size === 0 && parsed.table.length === SAMPLE.rows.length;
  }, () => parseTaskFile(renderTaskFile(SAMPLE, SET)).table.length);

check("every row `built` computes `done` — the agent does not type the word, so a task nobody set to `done` still closes once its rows are accounted for",
  () => reread(SAMPLE, SET, allBuilt).status === "done",
  () => reread(SAMPLE, SET, allBuilt).status);

check("ONE row `not-built` computes `partial` — this is the whole point: an agent that built every row but one now has a state to record, instead of `done` plus a sentence in `## Notes`",
  () => reread(SAMPLE, SET, (t) => setOutcome(allBuilt(t), 2, NOT_BUILT_BLOCKED)).status === "partial",
  () => reread(SAMPLE, SET, (t) => setOutcome(allBuilt(t), 2, NOT_BUILT_BLOCKED)).status);

check("`done` CANNOT BE SET BY HAND over a `not-built` row — the front matter says `done`, the rows say otherwise, and the rows win. This is also what stops a later reader overwriting a sub-agent's verdict",
  () => reread(SAMPLE, SET, (t) => setOutcome(allBuilt(t), 1, "not-built — needs-decision").replace("status: todo", "status: done")).status === "partial",
  () => reread(SAMPLE, SET, (t) => setOutcome(allBuilt(t), 1, "not-built — needs-decision").replace("status: todo", "status: done")).status);

check("a CLOSING status claimed over rows nobody accounted for computes `partial` — an unaccounted row is not a built row, and a task cannot close by leaving cells blank",
  () => reread(SAMPLE, SET, (t) => setOutcome(t, 1, "built").replace("status: todo", "status: done")).status === "partial",
  () => reread(SAMPLE, SET, (t) => setOutcome(t, 1, "built").replace("status: todo", "status: done")).status);

check("a task still IN PROGRESS with only some rows filled stays `in-progress` — an agent part-way through its own table is not a finding, and flagging it would put a warning on every healthy run in flight",
  () => reread(SAMPLE, SET, (t) => setOutcome(t, 1, "built").replace("status: todo", "status: in-progress")).status === "in-progress",
  () => reread(SAMPLE, SET, (t) => setOutcome(t, 1, "built").replace("status: todo", "status: in-progress")).status);

check("`n/a` survives an outcome cell — it is the one closure that legitimately has no builder, it is earned by the reason under `## Notes` that the dispatch gate reads, and a stale cell must not take that exemption away",
  () => reread(SAMPLE, SET, (t) => setOutcome(t, 1, NOT_BUILT_BLOCKED).replace(/^declared: *$/m, "declared: n/a")).status === "n/a",
  () => reread(SAMPLE, SET, (t) => setOutcome(t, 1, NOT_BUILT_BLOCKED).replace(/^declared: *$/m, "declared: n/a")).status);

check("`blocked` survives an outcome cell too — it is the only HALT an agent can reach (rule 5 asks for it when migrated content reads like an instruction), and since `partial` releases dependents, computing `partial` over it would walk the queue past a stop set on purpose",
  () => {
    const t = reread(SAMPLE, SET, (x) => setOutcome(allBuilt(x), 1, NOT_BUILT_BLOCKED).replace(/^declared: *$/m, "declared: blocked"));
    return t.status === "blocked" && notBuiltRows([t]).length === 0;
  }, () => reread(SAMPLE, SET, (x) => setOutcome(allBuilt(x), 1, NOT_BUILT_BLOCKED).replace(/^declared: *$/m, "declared: blocked")).status);

check("a `blocked` task still HALTS its dependents — `--start` refuses a task whose `dependsOn` is blocked, exactly as before this change; only `partial` releases them",
  () => {
    const d = tmp("blockhalt");
    const s1 = syncTaskDir(d, RUN, OPTS);
    // `Page build`, NOT `Quality gates` — the gates task is a leaf and nothing depends on it, so a halt asserted
    // over it asserts nothing.
    const tgt = taskAt(s1, "child:G1", "Page build");
    const fp = path.join(d, tgt.file);
    fs.writeFileSync(fp, setOutcome(allBuilt(fs.readFileSync(fp, "utf8")), 1, NOT_BUILT_BLOCKED).replace(/^declared: *$/m, "declared: blocked"));
    const s2 = syncTaskDir(d, RUN, OPTS);
    const dep = s2.tasks.find((t) => (t.dependsOn || []).includes(tgt.id));
    // No dependent means the FIXTURE stopped exercising the halt, which has to fail rather than pass quietly.
    return !!dep && s2.tasks.find((t) => t.id === tgt.id).status === "blocked"
      && !!startTask(d, dep.id, RUN, OPTS).blockedByDeps;
  }, "a blocked dependency must still refuse the dispatch");

check("an outcome is keyed by the DELIVERABLE, not by the row number — it survives a re-slice that renumbers the rows, because a mark that silently detaches from its row is the same loss this change exists to prevent",
  () => {
    const text = setOutcome(allBuilt(renderTaskFile(SAMPLE, SET)), 1, NOT_BUILT_BLOCKED);
    const { outcomes } = parseTaskFile(text);
    const shuffled = { ...SAMPLE, rows: [...SAMPLE.rows].reverse() };
    const merged = mergeTaskSet({ ...SET, tasks: [shuffled] }, [{ file: SAMPLE.file, ...parseTaskFile(text) }]);
    const t = merged.tasks[0];
    const marked = t.rows.filter((r) => r.outcomeKind === "not-built");
    return outcomes.size === SAMPLE.rows.length && t.status === "partial"
      && marked.length === 1 && marked[0].label === SAMPLE.rows[0].label;
  }, () => reread(SAMPLE, SET, (t) => setOutcome(allBuilt(t), 1, NOT_BUILT_BLOCKED)).rows.map((r) => [r.label, r.outcomeKind]));

check("the cause vocabulary is exactly the two ways routing branches — `blocked` (a re-run may clear it) and `needs-decision` (a person settles it); a third token nothing branches on is one the agent has to guess between",
  () => NOT_BUILT_CAUSES.length === 2 && NOT_BUILT_CAUSES.join(",") === "blocked,needs-decision",
  () => NOT_BUILT_CAUSES);

check("a cause outside that vocabulary degrades to `needs-decision` rather than being dropped — the row is still not built, and a token the engine cannot route is by definition one a person has to look at",
  () => {
    const t = reread(SAMPLE, SET, (x) => setOutcome(allBuilt(x), 1, "not-built — no-surface"));
    return t.status === "partial" && notBuiltRows([t])[0].cause === "needs-decision";
  }, () => notBuiltRows([reread(SAMPLE, SET, (x) => setOutcome(allBuilt(x), 1, "not-built — no-surface"))]));

check("a `not-built` with no recognised cause still counts as not built and routes to a human — dropping it would turn a written admission back into an empty cell, which is the failure mode itself",
  () => {
    const t = reread(SAMPLE, SET, (x) => setOutcome(allBuilt(x), 1, "not-built — ran out of time"));
    return t.status === "partial" && notBuiltRows([t])[0].cause === "needs-decision";
  }, () => notBuiltRows([reread(SAMPLE, SET, (x) => setOutcome(allBuilt(x), 1, "not-built — ran out of time"))]));

check("notBuiltRows names the DELIVERABLE and its cause, not just the task — `task 5 is partial` is not the fact anyone needs; `the static Type filter was not built, and the stand was unreachable` is",
  () => {
    const t = reread(SAMPLE, SET, (x) => setOutcome(allBuilt(x), 2, NOT_BUILT_BLOCKED));
    const items = notBuiltRows([t]);
    return items.length === 1 && items[0].n === 2 && items[0].cause === "blocked"
      && items[0].row.label === SAMPLE.rows[1].label;
  }, () => notBuiltRows([reread(SAMPLE, SET, (x) => setOutcome(allBuilt(x), 2, NOT_BUILT_BLOCKED))]));

console.log("\n===== a hand-written task is computed from its own cells, like every other =====");
// An ADOPTED file: read, never re-authored. Built from the engine's own rendering so the table is in the shape a
// declared task carries, and re-keyed to an id no plan task claims (`matchFor` would otherwise match it).
const ADOPTED_ID = "orch-hand-written";
const ADOPTED_FILE = "task-orch-hand-written.md";
const handWrittenText = (mutate, status, id = ADOPTED_ID) => {
  const text = renderTaskFile(SAMPLE, SET)
    .replace(/^id: .*$/m, `id: ${id}`)
    .replace(/^origin: .*$/m, "origin: orchestrator")
    .replace("status: todo", `status: ${status}`);
  return mutate ? mutate(text) : text;
};
const handWritten = (mutate, status = "done") =>
  mergeTaskSet(SET, [{ file: ADOPTED_FILE, ...parseTaskFile(handWrittenText(mutate, status)) }])
    .tasks.find((t) => t.id === ADOPTED_ID);

check("hand-written: a table that parses and carries a `not-built` row computes `partial` — a typed `done` does not stand, because the word would be the verdict of the party that did the work",
  () => {
    const t = handWritten((x) => setOutcome(allBuilt(x), 1, NOT_BUILT_BLOCKED));
    return t.origin === "orchestrator" && t.status === "partial";
  }, () => { const t = handWritten((x) => setOutcome(allBuilt(x), 1, NOT_BUILT_BLOCKED));
    return { origin: t?.origin, status: t?.status, rows: t?.rows.map((r) => r.outcome) }; });

check("hand-written: its rows are READ, so the unbuilt deliverable is NAMED — an adopted file carries its rows into the report and the gate, so the admission is visible even where the recorded word is right",
  () => {
    const t = handWritten((x) => setOutcome(allBuilt(x), 2, NOT_BUILT_BLOCKED));
    const items = notBuiltRows([t]);
    return items.length === 1 && items[0].n === 2 && items[0].cause === "blocked"
      && items[0].row.label === SAMPLE.rows[1].label;
  }, () => notBuiltRows([handWritten((x) => setOutcome(allBuilt(x), 2, NOT_BUILT_BLOCKED))]));

check("hand-written: the row reaches the OPEN list too — the report, the index attention list and the exit-2 unrouted count all read through it",
  () => notBuiltOpenItems([handWritten((x) => setOutcome(allBuilt(x), 1, NOT_BUILT_BLOCKED))]).length === 1,
  () => notBuiltOpenItems([handWritten((x) => setOutcome(allBuilt(x), 1, NOT_BUILT_BLOCKED))]));

check("hand-written: all rows `built` computes `done` as well — the rule is symmetric, not a way of failing adopted files",
  () => handWritten((x) => allBuilt(x), "todo").status === "done",
  () => handWritten((x) => allBuilt(x), "todo"));

check("hand-written: a body with NO parseable deliverables table keeps its recorded word — the one case the engine genuinely cannot say anything about",
  () => {
    const t = handWritten((x) => x.slice(0, x.indexOf("## Deliverables")) + "## Notes\n\nfreeform body\n", "done");
    return t.rows.length === 0 && t.status === "done";
  }, () => { const t = handWritten((x) => x.slice(0, x.indexOf("## Deliverables")) + "## Notes\n\nfreeform body\n", "done");
    return { rows: t?.rows.length, status: t?.status }; });

check("hand-written: `not built` as PROSE under `## Notes` computes nothing — the table parser is scoped to the Deliverables section, so an agent explaining itself cannot move its own status",
  () => handWritten((x) => allBuilt(x) + "\n\nrow 1 was not built — not-built — blocked, see above\n", "done").status === "done",
  () => handWritten((x) => allBuilt(x) + "\n\nrow 1 was not built — not-built — blocked, see above\n", "done"));

check("hand-written: `blocked` and `n/a` are never computed over — the two words an agent chooses deliberately keep meaning what they say",
  () => ["blocked", "n/a"].every((w) =>
    handWritten((x) => setOutcome(allBuilt(x), 1, NOT_BUILT_BLOCKED).replace(/^declared: *$/m, `declared: ${w}`), "done").status === w),
  () => ["blocked", "n/a"].map((w) => handWritten((x) => setOutcome(allBuilt(x), 1, NOT_BUILT_BLOCKED).replace(/^declared: *$/m, `declared: ${w}`), "done").status));

check("hand-written: a task still OPEN is left alone — a `not-built` recorded while its sub-agent is still filling cells is not yet a verdict, and routing a round at it would send a second agent at a row somebody is holding",
  () => {
    const t = handWritten((x) => setOutcome(x, 1, NOT_BUILT_BLOCKED), "in-progress");
    return t.status === "in-progress" && notBuiltRows([t]).length === 0;
  }, () => { const t = handWritten((x) => setOutcome(x, 1, NOT_BUILT_BLOCKED), "in-progress");
    return { status: t?.status, open: notBuiltRows([t]).length }; });

// ON DISK: the computed word lands in the file too, or the folder disagrees with its own index. Only the
// `status:` line moves; the body is never re-authored.
// Everything after the front matter: what must come back byte-identical.
const afterFrontMatter = (x) => x.split("---").slice(2).join("---");
const writeBackRun = (name) => {
  const d = tmp(name);
  syncTaskDir(d, RUN, OPTS);
  const f = path.join(d, ADOPTED_FILE);
  fs.writeFileSync(f, handWrittenText((x) => setOutcome(allBuilt(x), 1, NOT_BUILT_BLOCKED), "done"));
  const before = fs.readFileSync(f, "utf8");
  syncTaskDir(d, RUN, OPTS);
  return { before, after: fs.readFileSync(f, "utf8") };
};
check("hand-written: the computed word is written back into the FILE — one line, with the body byte-identical, so the folder and the index cannot disagree about it",
  () => {
    const { before, after } = writeBackRun("orch-computed-writeback");
    return /^status: partial$/m.test(after) && afterFrontMatter(after) === afterFrontMatter(before);
  }, () => writeBackRun("orch-computed-writeback-d").after.split("\n").slice(0, 12).join("\n"));

console.log("\n===== `declared:` is the agent's field, `status:` is the engine's =====");
// `declared` holds the agent's two words and nothing else; `status` is output and only the engine writes it.
const withDeclared = (mutate, declared, status = "todo") => {
  let text = renderTaskFile(SAMPLE, SET)
    .replace(/^id: .*$/m, "id: orch-declared")
    .replace(/^origin: .*$/m, "origin: orchestrator")
    .replace("status: todo", `status: ${status}`);
  text = declared === null ? text.replace(/^declared: .*$/m, "") : text.replace(/^declared: .*$/m, `declared: ${declared}`);
  text = mutate ? mutate(text) : text;
  return mergeTaskSet(SET, [{ file: "task-orch-declared.md", ...parseTaskFile(text) }])
    .tasks.find((t) => t.id === "orch-declared");
};

check("declared: the engine WRITES the field into every task file it renders, empty when nothing is declared - its presence is what makes the two owners visible in the file itself",
  () => /^declared: *$/m.test(renderTaskFile(SAMPLE, SET)) && /^status: todo$/m.test(renderTaskFile(SAMPLE, SET)),
  () => renderTaskFile(SAMPLE, SET).split("\n").slice(0, 6).join("\n"));

for (const word of ["blocked", "n/a"]) {
  check(`declared: \`${word}\` is an INPUT to the derivation, not an exception inside it - it stands over cells that would otherwise compute \`done\``,
    () => withDeclared((x) => allBuilt(x), word).status === word,
    () => withDeclared((x) => allBuilt(x), word).status);
  check(`declared: and the legacy spelling still works - \`status: ${word}\` with no \`declared:\` field is read as that declaration, so folders and agents on the old contract keep working`,
    () => withDeclared((x) => allBuilt(x), null, word).status === word,
    () => withDeclared((x) => allBuilt(x), null, word).status);
}

check("declared: a CLOSING word cannot be declared - `declared: done` is not in the agent's vocabulary, so it is ignored and the cells decide",
  () => withDeclared((x) => setOutcome(allBuilt(x), 1, NOT_BUILT_BLOCKED), "done", "done").status === "partial",
  () => withDeclared((x) => setOutcome(allBuilt(x), 1, NOT_BUILT_BLOCKED), "done", "done").status);

check("declared: nor typed into `status:` - a `done` there over a `not-built` cell is not a declaration and does not stand, which is the whole point of the split",
  () => withDeclared((x) => setOutcome(allBuilt(x), 1, NOT_BUILT_BLOCKED), "", "done").status === "partial",
  () => withDeclared((x) => setOutcome(allBuilt(x), 1, NOT_BUILT_BLOCKED), "", "done").status);

check("declared: the declaration SURVIVES a re-render - the engine rewrites a plan task's body from the plan on every pass, and the agent's field is carried across like its `## Notes`",
  () => {
    const d = tmp("declared-survives");
    const first = syncTaskDir(d, RUN, OPTS);
    const tgt = taskAt(first, "child:G1", "Quality gates");
    editFrontMatter(d, tgt.id, "declared", "blocked");
    const after = syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.id === tgt.id);
    return after.status === "blocked"
      && /^declared: blocked$/m.test(fs.readFileSync(taskFilePath(d, tgt.id), "utf8"));
  }, () => {
    const d = tmp("declared-survives-d");
    const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
    editFrontMatter(d, tgt.id, "declared", "blocked");
    syncTaskDir(d, RUN, OPTS);
    return fs.readFileSync(taskFilePath(d, tgt.id), "utf8").split("\n").slice(0, 6).join("\n");
  });

check("declared: clearing it re-opens the derivation - the halt was an input, so removing it lets the cells answer again",
  () => {
    const d = tmp("declared-cleared");
    const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
    const f = taskFilePath(d, tgt.id);
    fs.writeFileSync(f, allBuilt(fs.readFileSync(f, "utf8")));
    editFrontMatter(d, tgt.id, "declared", "blocked");
    const halted = syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.id === tgt.id).status;
    editFrontMatter(d, tgt.id, "declared", "");
    return halted === "blocked" && syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.id === tgt.id).status === "done";
  }, "a cleared declaration must let the cells decide again");

console.log("\n===== `statusFrom:` - a status the engine did not write is NAMED =====");
// A closing word written over a task's front matter changes nothing the word is derived from, so the stamp is
// what makes the edit visible.
const editedStatusFolder = (name, word = "done") => {
  const d = tmp(name);
  const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
  const f = taskFilePath(d, tgt.id);
  // A real close: every cell filled, one of them not built. The engine derives `partial` and stamps it.
  fs.writeFileSync(f, setOutcome(allBuilt(fs.readFileSync(f, "utf8")), 1, NOT_BUILT_BLOCKED));
  syncTaskDir(d, RUN, OPTS);
  // ...and then the word somebody wanted, touching nothing it is derived from.
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^status: .*$/m, `status: ${word}`));
  return { d, tgt, set: syncTaskDir(d, RUN, OPTS) };
};

check("statusFrom: a `status:` edited after the engine wrote it is NAMED on Attention - the cells did not move, so the stamp does not match it and the edit is visible",
  () => {
    const { d, tgt, set } = editedStatusFolder("status-edited");
    const t = set.tasks.find((x) => x.id === tgt.id);
    return t.statusEdited === true && t.status === "partial"
      && /its `status:` was edited after the engine wrote it/.test(readIndex(d));
  }, () => {
    const { d, tgt, set } = editedStatusFolder("status-edited-d");
    return { edited: set.tasks.find((x) => x.id === tgt.id)?.statusEdited,
      attention: readIndex(d).split("\n").filter((l) => l.includes("status:")).join(" | ").slice(0, 300) };
  });

check("statusFrom: the word the engine derives still WINS - the edit is reported, never honoured, so naming it costs nothing in correctness",
  () => {
    const { d, tgt, set } = editedStatusFolder("status-edited-wins");
    const t = set.tasks.find((x) => x.id === tgt.id);
    return t.status === "partial"
      && /^status: partial$/m.test(fs.readFileSync(taskFilePath(d, tgt.id), "utf8"));
  }, () => {
    const { d, tgt } = editedStatusFolder("status-edited-wins-d");
    return fs.readFileSync(taskFilePath(d, tgt.id), "utf8").split("\n").slice(0, 5).join(" / ");
  });

check("statusFrom (no false positive): an ordinary re-run names nothing - the engine re-stamps what it writes, so a folder nobody edited is silent however many times it is re-sliced",
  () => {
    const d = tmp("status-unedited");
    const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
    const f = taskFilePath(d, tgt.id);
    fs.writeFileSync(f, setOutcome(allBuilt(fs.readFileSync(f, "utf8")), 1, NOT_BUILT_BLOCKED));
    syncTaskDir(d, RUN, OPTS);
    const set = syncTaskDir(d, RUN, OPTS);
    return set.tasks.every((t) => !t.statusEdited)
      && !/was edited after the engine wrote it/.test(readIndex(d));
  }, () => {
    const d = tmp("status-unedited-d");
    const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
    const f = taskFilePath(d, tgt.id);
    fs.writeFileSync(f, setOutcome(allBuilt(fs.readFileSync(f, "utf8")), 1, NOT_BUILT_BLOCKED));
    syncTaskDir(d, RUN, OPTS);
    return syncTaskDir(d, RUN, OPTS).tasks.filter((t) => t.statusEdited).map((t) => t.file);
  });

check("statusFrom (no false positive): a folder written before the stamp existed names nothing either - an absent stamp is not an edit",
  () => {
    const d = tmp("status-unstamped");
    const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
    const f = taskFilePath(d, tgt.id);
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^statusFrom: .*$/m, "").replace(/^status: .*$/m, "status: done"));
    const set = syncTaskDir(d, RUN, OPTS);
    return set.tasks.find((x) => x.id === tgt.id)?.statusEdited !== true;
  }, "an unstamped file predates the mechanism and must not be reported as edited");

/* ================================================================================================
   A HALT IS RETIRED BY A RE-OPEN AND BY NOTHING ELSE. `declared:` outranks the cells, so a halt
   promoted into that field is echoed back on every later pass unless something retires it — and the
   next write then puts the caller's `status: todo` back to `blocked`. A LIFECYCLE word edited into
   `status:` retires it. A CLOSING word does not: that is the claim the derivation exists to refuse.
   ================================================================================================ */
const haltedFolder = (name) => {
  const d = tmp(name);
  const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
  const f = taskFilePath(d, tgt.id);
  // The one documented way to halt a task, promoted by the engine on the next pass.
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^declared: .*$/m, "declared: blocked"));
  const halted = syncTaskDir(d, RUN, OPTS).tasks.find((x) => x.id === tgt.id);
  return { d, f, id: tgt.id, halted };
};
const typeStatus = (f, word) => fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^status: .*$/m, `status: ${word}`));
const afterTyping = (name, word) => {
  const { d, f, id, halted } = haltedFolder(name);
  typeStatus(f, word);
  return { halted, after: syncTaskDir(d, RUN, OPTS).tasks.find((x) => x.id === id) };
};

check("re-open (derived status): the documented recovery — `status: todo` over a promoted halt — actually reopens the task, and the declaration that halted it is gone from the derived set",
  () => {
    const { halted, after } = afterTyping("reopen-halt", "todo");
    // The halt has to have been real first, or the re-open is a re-open of nothing.
    return halted.status === "blocked" && halted.declared === "blocked"
      && after.status === "todo" && after.declared === "";
  }, () => { const { halted, after } = afterTyping("reopen-halt-d", "todo");
    return { halted: { status: halted.status, declared: halted.declared },
      after: { status: after.status, declared: after.declared } }; });

check("re-open (derived status): a CLOSING word typed over a promoted halt retires nothing — `status: done` is the exact claim the derivation refuses, so the task still reads blocked",
  () => afterTyping("reopen-closing", "done").after.status === "blocked",
  () => afterTyping("reopen-closing-d", "done").after.status);

/* ================================================================================================
   A FILE IS WRITTEN ONLY WHEN ITS BYTES CHANGE. Every command ends in the one write phase, so an
   unconditional write makes each call rewrite the whole folder. The mtimes are backdated first, so
   the check does not depend on the clock's resolution.
   ================================================================================================ */
const BACKDATE = new Date(2000, 0, 1);
const backdate = (d) => fs.readdirSync(d).forEach((f) => fs.utimesSync(path.join(d, f), BACKDATE, BACKDATE));
const movedSince = (d) => fs.readdirSync(d).filter((f) => fs.statSync(path.join(d, f)).mtimeMs !== BACKDATE.getTime());

check("one write phase: a re-sync that changes nothing rewrites nothing — a folder whose files all still carry their backdated mtime was not touched, so a run's I/O is proportional to what it changed and not to the folder's size",
  () => {
    const d = tmp("write-idempotent");
    syncTaskDir(d, RUN, OPTS);
    backdate(d);
    const files = fs.readdirSync(d).length;
    syncTaskDir(d, RUN, OPTS);
    return files > 1 && movedSince(d).length === 0;
  }, () => {
    const d = tmp("write-idempotent-d");
    syncTaskDir(d, RUN, OPTS);
    backdate(d);
    syncTaskDir(d, RUN, OPTS);
    return { rewritten: movedSince(d) };
  });

check("one write phase (anti-vacuity): a re-sync over a file the caller CHANGED does rewrite it — the comparison is on content, so a halt declared in the file is still promoted on the next pass",
  () => {
    const d = tmp("write-changed");
    const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
    const f = taskFilePath(d, tgt.id);
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^declared: .*$/m, "declared: blocked"));
    backdate(d);
    syncTaskDir(d, RUN, OPTS);
    return movedSince(d).includes(path.basename(f));
  }, () => {
    const d = tmp("write-changed-d");
    const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
    const f = taskFilePath(d, tgt.id);
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^declared: .*$/m, "declared: blocked"));
    backdate(d);
    syncTaskDir(d, RUN, OPTS);
    return { rewritten: movedSince(d), expected: path.basename(f) };
  });

/* ================================================================================================
   EVERY CLOSURE IS HELD TO A DISPATCH RECORD, with one exemption: an adopted file carrying neither
   `declared:` nor `statusFrom:` was written before either field existed, and closed under the rule
   in force then. The exemption is about the file's SHAPE, not about who filed the task.
   ================================================================================================ */
const LEGACY_ID = "orch-legacy";
const adoptedClosure = (name, legacy) => {
  const d = tmp(name);
  syncTaskDir(d, RUN, OPTS);
  const text = handWrittenText(allBuilt, "done", LEGACY_ID);
  fs.writeFileSync(path.join(d, `task-${LEGACY_ID}.md`), legacy ? asLegacyBody(text) : text);
  const set = syncTaskDir(d, RUN, OPTS);
  return { task: set.tasks.find((t) => t.id === LEGACY_ID), failing: dispatchAudit(set.tasks, d).failing };
};

check("dispatch gate: an adopted file carrying NEITHER `declared:` nor `statusFrom:` closes `done` without a dispatch record — it predates both fields, so holding it to this gate would fail a run over a task nothing about which has changed",
  () => {
    const { task, failing } = adoptedClosure("dispatch-legacy", true);
    // The closure has to be real first, or the exemption is over a task the gate would never have looked at.
    return task?.status === "done" && !failing.some((t) => t.id === LEGACY_ID);
  }, () => { const { task, failing } = adoptedClosure("dispatch-legacy-d", true);
    return { status: task?.status, failing: failing.map((t) => t.id) }; });

check("dispatch gate (anti-vacuity): the SAME closure in a file that DOES carry those fields is held to a dispatch record — a verdict filed by the context that did the work is the failure this gate exists for, adopted or not",
  () => adoptedClosure("dispatch-current", false).failing.some((t) => t.id === LEGACY_ID),
  () => { const { task, failing } = adoptedClosure("dispatch-current-d", false);
    return { status: task?.status, failing: failing.map((t) => t.id) }; });

// THE TWO READERS ANSWER THE SAME. `readTaskDir` and the merged read parse the same bytes, so the dispatch gate
// has to reach the same verdict through either — a folder must not pass `--verify` and fail a re-slice.
// Read WITHOUT syncing first: the write phase adds the stamp a legacy file lacks, which is itself the precondition.
const legacyUnsynced = (name) => {
  const d = tmp(name);
  syncTaskDir(d, RUN, OPTS);
  fs.writeFileSync(path.join(d, `task-${LEGACY_ID}.md`),
    asLegacyBody(handWrittenText(allBuilt, "done", LEGACY_ID)));
  const failing = (tasks) => dispatchAudit(tasks, d).failing.map((t) => t.id)
    .sort((a, b) => a.localeCompare(b));
  return { plain: failing(readTaskDir(d)), merged: failing(readMergedTaskDir(d, RUN, OPTS).tasks) };
};

check("dispatch gate: `readTaskDir` and the merged read reach the SAME verdict over one unsynced legacy folder — the gate is one predicate over the parsed files, so a folder that passes `--verify` cannot fail a re-slice",
  () => {
    const { plain, merged } = legacyUnsynced("readers-agree");
    // The exemption has to be doing something here, or the two readers agree trivially.
    return !merged.includes(LEGACY_ID) && JSON.stringify(plain) === JSON.stringify(merged);
  }, () => { const { plain, merged } = legacyUnsynced("readers-agree-d");
    return { readTaskDir: plain, merged, divergence: plain.filter((x) => !merged.includes(x)) }; });

console.log("\n===== minted: the orchestrator declares, the engine writes the file =====");

// Declared rather than hand-authored, every task carries the engine's `Outcome` table, so the derivation always
// has cells to read.
const DECL = { id: "orch-render-blocker", pageKey: "child:G1", group: "Render blocker", order: 3,
  // The artifact string the engine derives for that page, which is what `--add` validates against.
  writesTo: taskAt(SET, "child:G1", "Page build").writesTo, deliverables: ["A minimal page proven to render", "The offending wiring named"] };
const minted = (over = {}, dirName = "mint") => {
  const d = tmp(dirName);
  syncTaskDir(d, RUN, OPTS);
  return { d, res: addTasks(d, RUN, { ...DECL, ...over }, OPTS) };
};

// A LINE BREAK IN A DECLARED STRING FORGES FRONT MATTER: the value is interpolated into a line of its own, so an
// embedded newline adds a line, and a `status:` there is read ahead of the engine's. Refused before anything is
// written, and the message names which value carried it.
const forged = (over, name) => minted(over, name).res;

check("minted: a declared `group` carrying a LINE BREAK is refused — the value is interpolated into the `group:` line, so a newline would forge a second `status:` line and that one is what the parser reads",
  () => {
    const res = forged({ group: "Owner filter\nstatus: done" }, "mint-forge-group");
    return res.refused === true && res.problems.some((p) => /`group`/.test(p) && /line break/.test(p));
  }, () => forged({ group: "Owner filter\nstatus: done" }, "mint-forge-group-d").problems);

check("minted: the same rule covers a declared DELIVERABLE, which the engine interpolates into a table cell, and the message names WHICH one carried the break",
  () => {
    const rows = ["A minimal page proven to render", "The offending wiring named\nstatus: done"];
    const res = forged({ deliverables: rows }, "mint-forge-row");
    return res.refused === true && res.problems.some((p) => /deliverables\[2\]/.test(p) && /line break/.test(p));
  }, () => forged({ deliverables: ["A minimal page proven to render", "The offending wiring named\nstatus: done"] },
    "mint-forge-row-d").problems);

check("minted (anti-vacuity): the same declaration WITHOUT the line break is accepted — the refusal is about the break, not about the text around it",
  () => forged({ group: "Owner filter status: done" }, "mint-forge-control").refused === false,
  () => forged({ group: "Owner filter status: done" }, "mint-forge-control-d").problems);

// THE RE-OPEN RULE HOLDS ON BOTH WRITE PATHS. A plan task is re-rendered, so its `declared:` line is rewritten
// from the derived task; an adopted file keeps its body and takes its `status:` line alone, so the same write has
// to clear the declaration there too, or the recovery lasts exactly one read.
const mintedHalt = (name) => {
  const { d, res } = minted({}, name);
  const f = path.join(d, res.written[0].file);
  const id = res.written[0].id ?? DECL.id;
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^declared: ?.*$/m, "declared: blocked"));
  syncTaskDir(d, RUN, OPTS);
  const halted = readTaskDir(d).find((t) => t.id === id);
  // The documented recovery, followed literally: clear the Outcome cells, set `status: todo`.
  let text = fs.readFileSync(f, "utf8").split("\n")
    .map((l) => (/^\|\s*\d+\s*\|/.test(l) ? l.replace(/\|[^|]*\|$/, "| |") : l)).join("\n");
  fs.writeFileSync(f, text.replace(/^status: .*$/m, "status: todo"));
  syncTaskDir(d, RUN, OPTS);
  const once = readTaskDir(d).find((t) => t.id === id);
  syncTaskDir(d, RUN, OPTS);
  return { halted, once, twice: readTaskDir(d).find((t) => t.id === id) };
};

check("re-open (adopted file): the documented recovery survives the WRITE, not just the read — an adopted file takes only its `status:` line, so the write has to clear `declared:` there as well or the next pass re-halts it for ever",
  () => {
    const { halted, once, twice } = mintedHalt("adopted-reopen");
    // The halt has to have been real first, and the recovery has to still hold on a SECOND pass.
    return halted.status === "blocked" && once.status === "todo" && twice.status === "todo";
  }, () => { const { halted, once, twice } = mintedHalt("adopted-reopen-d");
    return { halted: halted.status, afterWrite: once.status, afterSecondPass: twice.status,
      declaredNow: twice.declared }; });

check("minted: a declared deliverable carrying `|` is ESCAPED into its cell and read back whole — a label shaped like `x | built | y` cannot shift the Outcome column, so it arrives as text rather than as a mark nobody recorded",
  () => {
    const { d, res } = minted({ deliverables: ["x | built | y"] }, "mint-pipe");
    const text = fs.readFileSync(path.join(d, res.written[0].file), "utf8");
    const row = parseTaskFile(text).table[0];
    return res.refused === false && /x \\\| built \\\| y/.test(text)
      && row.label === "x | built | y" && !row.outcome;
  }, () => { const { d, res } = minted({ deliverables: ["x | built | y"] }, "mint-pipe-d");
    if (res.refused) return { problems: res.problems };
    const row = parseTaskFile(fs.readFileSync(path.join(d, res.written[0].file), "utf8")).table[0];
    return { label: row.label, outcome: row.outcome }; });

check("minted: a declared task is WRITTEN by the engine, carrying its `Outcome` table and its declared rows - the orchestrator supplies the judgement, not the file shape",
  () => {
    const { d, res } = minted();
    const text = fs.readFileSync(path.join(d, res.written[0].file), "utf8");
    return res.refused === false && res.written.length === 1
      && /\| # \| From \| Deliverable \| Closed by \| Outcome \|/.test(text)
      && /A minimal page proven to render/.test(text) && /The offending wiring named/.test(text);
  }, () => { const { d, res } = minted({}, "mint-d");
    return res.refused ? res.problems : fs.readFileSync(path.join(d, res.written[0].file), "utf8").slice(0, 700); });

check("minted: and its status is DERIVED from that table like any other task's - the point of minting is that the derivation always has cells to read",
  () => {
    const { d, res } = minted({}, "mint-derives");
    const f = path.join(d, res.written[0].file);
    fs.writeFileSync(f, setOutcome(allBuilt(fs.readFileSync(f, "utf8")), 1, NOT_BUILT_BLOCKED));
    const t = syncTaskDir(d, RUN, OPTS).tasks.find((x) => x.id === DECL.id);
    return t.status === "partial" && notBuiltOpenItems([t]).length === 1;
  }, () => { const { d, res } = minted({}, "mint-derives-d");
    const f = path.join(d, res.written[0].file);
    fs.writeFileSync(f, setOutcome(allBuilt(fs.readFileSync(f, "utf8")), 1, NOT_BUILT_BLOCKED));
    return syncTaskDir(d, RUN, OPTS).tasks.find((x) => x.id === DECL.id)?.status; });

check("minted: it is ADOPTED afterwards, never re-authored - the body is the orchestrator's from the moment it is written, like a repair round's",
  () => {
    const { d, res } = minted({}, "mint-adopted");
    const f = path.join(d, res.written[0].file);
    const withNotes = fs.readFileSync(f, "utf8") + "\nwhat I actually did\n";
    fs.writeFileSync(f, withNotes);
    syncTaskDir(d, RUN, OPTS);
    return fs.readFileSync(f, "utf8") === withNotes
      && syncTaskDir(d, RUN, OPTS).tasks.find((x) => x.id === DECL.id).origin === "orchestrator";
  }, () => { const { d, res } = minted({}, "mint-adopted-d");
    return fs.readFileSync(path.join(d, res.written[0].file), "utf8").slice(0, 300); });

check("minted: a `pageKey` the plan does not build is REFUSED - the repair cap buckets on (pageKey, cause), so a key matching no page gets its own bucket and the three-round cap over that page is bypassed",
  () => {
    const { res } = minted({ pageKey: "child:NOPE" }, "mint-badpage");
    return res.refused === true && res.problems.some((x) => /is not a page this plan builds/.test(x));
  }, () => minted({ pageKey: "child:NOPE" }, "mint-badpage-d").res.problems);

check("minted: a declaration with NO deliverables is refused - a task with no rows has nothing to derive a status from, which is the hole minting exists to close",
  () => {
    const { res } = minted({ deliverables: [] }, "mint-norows");
    return res.refused === true && res.problems.some((x) => /declares no `deliverables`/.test(x));
  }, () => minted({ deliverables: [] }, "mint-norows-d").res.problems);

check("minted: an `id` already in the folder is refused - two files claiming one id is the state the merge refuses to write over at all",
  () => {
    const d = tmp("mint-dupe");
    const first = syncTaskDir(d, RUN, OPTS);
    const { res } = { res: addTasks(d, RUN, { ...DECL, id: first.tasks[1].id }, OPTS) };
    return res.refused === true && res.problems.some((x) => /already claimed/.test(x));
  }, () => { const d = tmp("mint-dupe-d"); const first = syncTaskDir(d, RUN, OPTS);
    return addTasks(d, RUN, { ...DECL, id: first.tasks[1].id }, OPTS).problems; });

check("minted: a REFUSED set writes NOTHING - one bad declaration in a batch leaves the folder exactly as it was, because half a set is a judgement with a hole nobody can see",
  () => {
    const d = tmp("mint-allornothing");
    syncTaskDir(d, RUN, OPTS);
    const before = fs.readdirSync(d).length;
    const res = addTasks(d, RUN, [DECL, { ...DECL, id: "orch-second", pageKey: "child:NOPE" }], OPTS);
    return res.refused === true && fs.readdirSync(d).length === before;
  }, () => addTasks(tmp("mint-allornothing-d"), RUN, [DECL, { ...DECL, id: "orch-second", pageKey: "child:NOPE" }], OPTS).problems);

console.log("\n===== review round: the held-back boundary is reported, and the stamp fires only on an edit =====");
// A row the ledger settled by decision is not routed. Everything that decides that must also SAY it, or the row
// is dropped in silence.
const boundaryFolder = (name) => {
  const d = tmp(name);
  const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
  clearDepsOf(d, tgt.id, RUN, OPTS);
  const token = `tok-${tgt.id}`;
  startTask(d, tgt.id, RUN, { ...OPTS, dispatchToken: token }, null, AT(40));
  const f = taskFilePath(d, tgt.id);
  fs.writeFileSync(f, setOutcome(allBuilt(fs.readFileSync(f, "utf8")), 1, "n-a \u2014 approved boundary, per D1"));
  editFrontMatter(d, tgt.id, "agentNonce", token);
  const label = syncTaskDir(d, RUN, { ...OPTS, now: AT(41) }).tasks.find((t) => t.id === tgt.id).rows[0].label;
  const res = syncRepairDir(d, RUN, { "child:G1": { missing: 1, unverified: 0, complete: false,
    openRows: [openRow(1, label)] } }, OPTS);
  return { d, tgt, res };
};

check("boundary: a verify row on a deliverable the ledger closed `n-a` WITH A REASON opens no repair round",
  () => { const { res } = boundaryFolder("bnd-noround"); return res.written.length === 0 && res.boundaries.length === 1; },
  () => { const { res } = boundaryFolder("bnd-noround-d"); return { written: res.written.length, boundaries: res.boundaries.length }; });

check("boundary: and it is NAMED on the index, so the decision is confirmable rather than silently dropped",
  () => { const { d } = boundaryFolder("bnd-index"); return /a verify run re-opened/.test(readIndex(d)); },
  () => { const { d } = boundaryFolder("bnd-index-d"); return readIndex(d).split("## Attention")[1]?.slice(0, 400); });

check("boundary: rendering an index that carries one does not throw \u2014 the line is built on the same array as every other Attention line",
  () => { const { res } = boundaryFolder("bnd-render"); renderTaskIndex(res.set); return true; },
  () => { try { renderTaskIndex(boundaryFolder("bnd-render-d").res.set); return "no throw"; } catch (e) { return `${e.constructor.name}: ${e.message}`; } });

check("boundary (anti-vacuity): the SAME row recorded `not-built` instead DOES open a round \u2014 the reason is what buys the exemption",
  () => {
    const d = tmp("bnd-notbuilt");
    const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
    clearDepsOf(d, tgt.id, RUN, OPTS);
    startTask(d, tgt.id, RUN, { ...OPTS, dispatchToken: `tok-${tgt.id}` }, null, AT(40));
    const f = taskFilePath(d, tgt.id);
    fs.writeFileSync(f, setOutcome(allBuilt(fs.readFileSync(f, "utf8")), 1, NOT_BUILT_BLOCKED));
    editFrontMatter(d, tgt.id, "agentNonce", `tok-${tgt.id}`);
    syncTaskDir(d, RUN, { ...OPTS, now: AT(41) });
    const res = syncRepairDir(d, RUN, {}, OPTS);
    return res.written.length === 1 && (res.boundaries || []).length === 0;
  }, "a not-built row must still route");

check("statusFrom: an agent filling its `Outcome` column is NOT an edit \u2014 the stamp answers one question, so filling cells and declaring a halt leave it alone",
  () => {
    const d = tmp("stamp-honest");
    const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
    const f = taskFilePath(d, tgt.id);
    fs.writeFileSync(f, allBuilt(fs.readFileSync(f, "utf8")));
    const first = syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.id === tgt.id);
    return first.statusEdited === false && !/was edited after the engine wrote it/.test(readIndex(d));
  }, () => {
    const d = tmp("stamp-honest-d");
    const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
    const f = taskFilePath(d, tgt.id);
    fs.writeFileSync(f, allBuilt(fs.readFileSync(f, "utf8")));
    return { edited: syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.id === tgt.id).statusEdited };
  });

console.log("\n===== a hand-written table is read on its header, not on its heading =====");
// `## Notes` is the boundary. Everything before it is the task's body, and a table is a deliverables table when
// it carries a `#` column and an `Outcome` column - the heading above it decides nothing.
const HANDWRITTEN = ["---", "id: orch-rowhdr", "status: done", "declared: ", "origin: orchestrator",
  "pageKey: main", "group: Owner filter", "order: 3", "writesTo: page:main", "---", "",
  "# Owner filter", "", "| # | Row | Outcome |", "| --- | --- | --- |",
  "| 1 | The owner filter on the lookup | built |", `| 2 | The escape-dirty handler | ${NOT_BUILT_BLOCKED} |`,
  "", "## Notes", "", "blocked on a decision"].join("\n");
let handReadSeq = 0;
const handRead = (body) => {
  handReadSeq += 1;
  const d = tmp("rowhdr-" + handReadSeq);
  syncTaskDir(d, RUN, OPTS);
  fs.writeFileSync(path.join(d, "task-orch-rowhdr.md"), body);
  return syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.id === "orch-rowhdr");
};

check("header: a table headed `| # | Row | Outcome |` with NO `## Deliverables` heading is read - its rows parse and its status derives from the cells, rather than the whole file being written off over a heading word",
  () => {
    const t = handRead(HANDWRITTEN);
    return t.rows.length === 2 && t.rows[1].outcomeKind === "not-built" && t.status === "partial";
  }, () => { const t = handRead(HANDWRITTEN); return { rows: t?.rows.length, status: t?.status, kinds: t?.rows.map((r) => r.outcomeKind) }; });

check("header: and its unbuilt row reaches the gate like any other",
  () => notBuiltOpenItems([handRead(HANDWRITTEN)]).length === 1,
  () => notBuiltOpenItems([handRead(HANDWRITTEN)]));

check("header: a PROSE table above the real one does not win - the first header carrying an `Outcome` column is the deliverables table, and a hand-written body leading with `| # | Field | Type |` is read past",
  () => {
    const t = handRead(HANDWRITTEN.replace("| # | Row | Outcome |",
      ["| # | Field | Type |", "| --- | --- | --- |", "| 1 | Owner | Lookup |", "", "| # | Row | Outcome |"].join("\n")));
    return t.rows.length === 2 && t.status === "partial" && unreadableLedger([t]).length === 0;
  }, () => { const t = handRead(HANDWRITTEN.replace("| # | Row | Outcome |",
      ["| # | Field | Type |", "| --- | --- | --- |", "| 1 | Owner | Lookup |", "", "| # | Row | Outcome |"].join("\n")));
    return { rows: t?.rows.length, status: t?.status }; });

check("header (the guard it must not break): a table under `## Notes` is still NOT read - Notes are the agent's, and a table written there is not a deliverables table however it is headed",
  () => {
    const t = handRead(HANDWRITTEN.replace("# Owner filter\n\n| # | Row | Outcome |", "# Owner filter\n\n## Notes\n\n| # | Row | Outcome |"));
    return t.rows.length === 0;
  }, () => handRead(HANDWRITTEN.replace("# Owner filter\n\n| # | Row | Outcome |", "# Owner filter\n\n## Notes\n\n| # | Row | Outcome |")).rows.length);

check("header: a table with NO `Outcome` column is still unreadable - the alias is on the label column alone, and without cells there is nothing to derive",
  () => {
    const t = handRead(HANDWRITTEN.replace("| # | Row | Outcome |", "| # | Row | Closed by |")
      .replace("| --- | --- | --- |", "| --- | --- | --- |"));
    return t.rows.length === 0 && unreadableLedger([t]).length === 1;
  }, () => handRead(HANDWRITTEN.replace("| # | Row | Outcome |", "| # | Row | Closed by |")).rows.length);

console.log("\n===== a closing word over a table where NOTHING is accounted for =====");
// The last way a typed word could stand. `blocked`/`n/a` are declarations and unaffected; a legacy body carries
// no stamp, so its word still stands; what is refused is a closing word written over a current file whose every
// cell is empty.
const typedOverBlank = (word) => {
  const d = tmp("blank-" + word.replace("/", ""));
  const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
  const f = taskFilePath(d, tgt.id);
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^status: .*$/m, `status: ${word}`));
  return syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.id === tgt.id);
};

check("blank: a `done` typed over a table with NO cell filled computes `partial` — an unaccounted row is not a built one, and the stamp says the word did not come from the engine",
  () => typedOverBlank("done").status === "partial",
  () => ({ status: typedOverBlank("done").status, edited: typedOverBlank("done").statusEdited }));

check("blank: the run cannot close over it — `partial` counts as open everywhere. The individual rows are NOT named: the collector keeps its own \"nothing recorded anywhere\" guard, so the task blocks the verdict while its deliverables stay unnamed",
  () => { const t = typedOverBlank("done"); return t.status === "partial" && notBuiltOpenItems([t]).length === 0; },
  () => { const t = typedOverBlank("done"); return { status: t.status, rows: t.rows.length, named: notBuiltOpenItems([t]).length }; });

check("blank: a LEGACY body (no `declared:`, no `statusFrom:`) with the same empty column keeps its word — a folder written before the column existed is all-blank by nature",
  () => {
    const d = tmp("blank-legacy");
    const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
    const f = taskFilePath(d, tgt.id);
    fs.writeFileSync(f, asLegacyBody(fs.readFileSync(f, "utf8")).replace(/^status: .*$/m, "status: done"));
    return syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.id === tgt.id).status === "done";
  }, "a legacy file carries no stamp, so nothing says its word was typed");

check("blank: a task nobody has started is untouched — every `todo` task is all-blank, and the rule fires only over a CLOSING word",
  () => typedOverBlank("todo").status === "todo",
  () => typedOverBlank("todo").status);

check("blank: a DECLARED halt stands — `declared:` is read before the cells, so a declaration is never computed over",
  () => ["blocked", "n/a"].every((w) => {
    const d = tmp("blank-decl-" + w.replace("/", ""));
    const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
    editFrontMatter(d, tgt.id, "declared", w);
    return syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.id === tgt.id).status === w;
  }), "a declaration in its own field must stand over an empty column");

check("blank: a declarable word TYPED into `status:` is still read as a declaration — the engine only writes `blocked`/`n/a` there alongside a matching `declared:`, so one that does not match its stamp came from an agent and must keep halting",
  () => ["blocked", "n/a"].every((w) => typedOverBlank(w).status === w),
  () => ["blocked", "n/a"].map((w) => `${w}->${typedOverBlank(w).status}`));


console.log("\n===== one reader: every path derives the same word for one folder =====");
// `edited` is the input a caller can silently omit, and two readers that disagree about it derive two words.
check("one reader: `readTaskDir` and the merged path agree on a typed close over an all-blank table — the flag is derived the same way at every call site, so the folder has one answer",
  () => {
    const d = tmp("one-word");
    const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
    const f = taskFilePath(d, tgt.id);
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^status: .*$/m, "status: done"));
    const read = readTaskDir(d).find((t) => t.id === tgt.id);
    const merged = syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.id === tgt.id);
    return read.status === "partial" && merged.status === "partial";
  }, () => {
    const d = tmp("one-word-d");
    const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
    const f = taskFilePath(d, tgt.id);
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^status: .*$/m, "status: done"));
    return { read: readTaskDir(d).find((t) => t.id === tgt.id).status,
      merged: syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.id === tgt.id).status };
  });

check("stamp: a file that never had one ACQUIRES it the first time the engine writes its status — without that, the engine keeps writing the word while every edit to it stays undetectable",
  () => {
    const d = tmp("stamp-acquire");
    const body = ["---", "id: orch-nostamp", "status: todo", "origin: orchestrator", "pageKey: main",
      "group: Legacy note", "order: 3", "writesTo: page:main", "---", "", "# Legacy note", "",
      "| # | Deliverable | Outcome |", "| --- | --- | --- |", "| 1 | A row | built |", "", "## Notes", "", "x"];
    syncTaskDir(d, RUN, OPTS);
    const f = path.join(d, "task-orch-nostamp.md");
    fs.writeFileSync(f, body.join("\n"));
    syncTaskDir(d, RUN, OPTS);
    const after = fs.readFileSync(f, "utf8");
    return /^statusFrom: \S+$/m.test(after) && /^status: done$/m.test(after);
  }, () => {
    const d = tmp("stamp-acquire-d");
    syncTaskDir(d, RUN, OPTS);
    const f = path.join(d, "task-orch-nostamp.md");
    fs.writeFileSync(f, ["---", "id: orch-nostamp", "status: todo", "origin: orchestrator", "pageKey: main",
      "group: Legacy note", "order: 3", "writesTo: page:main", "---", "", "# Legacy note", "",
      "| # | Deliverable | Outcome |", "| --- | --- | --- |", "| 1 | A row | built |", "", "## Notes", "", "x"].join("\n"));
    syncTaskDir(d, RUN, OPTS);
    return fs.readFileSync(f, "utf8").split("\n").slice(0, 6).join(" / ");
  });

check("add: `dependsOn` naming a task the folder does not have is REFUSED — the minted task would sit behind a gate that never closes and `--start` would refuse it for ever",
  () => {
    const d = tmp("add-badstep");
    syncTaskDir(d, RUN, OPTS);
    const res = addTasks(d, RUN, { ...DECL, dependsOn: ["nosuchtask"] }, OPTS);
    return res.refused === true && res.problems.some((x) => /no task in this folder has/.test(x));
  }, () => { const d = tmp("add-badstep-d"); syncTaskDir(d, RUN, OPTS);
    return addTasks(d, RUN, { ...DECL, dependsOn: ["nosuchtask"] }, OPTS).problems; });

check("add: a valid `dependsOn` is carried into the minted file, so a declared corrective task can be ordered behind a real one",
  () => {
    const d = tmp("add-step");
    const first = syncTaskDir(d, RUN, OPTS);
    const dep = first.tasks[1].id;
    const res = addTasks(d, RUN, { ...DECL, dependsOn: [dep] }, OPTS);
    return !res.refused && res.written[0].dependsOn.includes(dep)
      && new RegExp(`^dependsOn: .*${dep}`, "m").test(fs.readFileSync(path.join(d, res.written[0].file), "utf8"));
  }, () => { const d = tmp("add-step-d"); const first = syncTaskDir(d, RUN, OPTS);
    const res = addTasks(d, RUN, { ...DECL, dependsOn: [first.tasks[1].id] }, OPTS);
    return res.refused ? res.problems : res.written[0].dependsOn; });

console.log("\n===== a halt survives the pass that honours it =====");
// A declaration promoted out of `status:` has to be WRITTEN into its own field. The stamp the engine refreshes on
// that same write is the only evidence the word was typed, so a promotion that is not persisted lasts one pass.
const haltedRepair = (name, word) => {
  const d = tmp(name);
  const first = syncTaskDir(d, RUN, OPTS);
  const tgt = taskAt(first, "child:G1", "Quality gates");
  clearDepsOf(d, tgt.id, RUN, OPTS);
  const token = `tok-${tgt.id}`;
  startTask(d, tgt.id, RUN, { ...OPTS, dispatchToken: token }, null, AT(40));
  const f = taskFilePath(d, tgt.id);
  fs.writeFileSync(f, setOutcome(allBuilt(fs.readFileSync(f, "utf8")), 1, NOT_BUILT_BLOCKED));
  editFrontMatter(d, tgt.id, "agentNonce", token);
  syncTaskDir(d, RUN, { ...OPTS, now: AT(41) });
  const rep = syncRepairDir(d, RUN, {}, OPTS).written[0];
  // Its agent ACCOUNTS for every row and then types the halt into the engine's field instead of its own. The
  // filled cells are what make this reproduce: with them blank the carried word alone would keep the halt.
  const rf = taskFilePath(d, rep.id);
  let rtext = fs.readFileSync(rf, "utf8");
  for (let i = 1; i <= rowCount(rtext); i++) rtext = setOutcome(rtext, i, NOT_BUILT_BLOCKED);
  fs.writeFileSync(rf, rtext);
  editFrontMatter(d, rep.id, "status", word);
  const pass1 = syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.id === rep.id).status;
  const pass2 = syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.id === rep.id).status;
  return { d, rep, pass1, pass2, file: fs.readFileSync(taskFilePath(d, rep.id), "utf8") };
};

for (const word of ["blocked", "n/a"]) {
  check(`halt: \`status: ${word}\` typed on an ADOPTED file survives the pass that honours it — the promotion is written into \`declared:\`, so the re-stamp that removes the evidence cannot drop the halt`,
    () => { const r = haltedRepair("halt-" + word.replace("/", ""), word); return r.pass1 === word && r.pass2 === word; },
    () => { const r = haltedRepair("halt-d-" + word.replace("/", ""), word); return { pass1: r.pass1, pass2: r.pass2 }; });
}

check("halt: and the word is in `declared:` on disk afterwards — that field is what makes it stick, and the body is otherwise untouched",
  () => {
    const r = haltedRepair("halt-ondisk", "blocked");
    return /^declared: blocked$/m.test(r.file) && /^status: blocked$/m.test(r.file)
      && /not-built/.test(r.file);
  }, () => haltedRepair("halt-ondisk-d", "blocked").file.split("\n").slice(0, 8).join(" / "));

check("re-open: the documented remedy raises NO edit warning — clearing the cells and setting `status: todo` resolves to a lifecycle word, which is the engine's own, not a verdict typed over its rows",
  () => {
    const d = tmp("reopen-clean");
    const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
    const f = taskFilePath(d, tgt.id);
    fs.writeFileSync(f, allBuilt(fs.readFileSync(f, "utf8")));
    syncTaskDir(d, RUN, OPTS);
    // The remedy SKILL.md prescribes: clear the cells, then re-open.
    const cleared = fs.readFileSync(f, "utf8").split("\n")
      .map((l) => (/^\|\s*\d+\s*\|/.test(l) ? l.replace(/\| built \|$/, "| |") : l)).join("\n");
    fs.writeFileSync(f, cleared.replace(/^status: .*$/m, "status: todo"));
    const t = syncTaskDir(d, RUN, OPTS).tasks.find((x) => x.id === tgt.id);
    return t.status === "todo" && !/was edited after the engine wrote it/.test(readIndex(d));
  }, () => {
    const d = tmp("reopen-clean-d");
    const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
    const f = taskFilePath(d, tgt.id);
    fs.writeFileSync(f, allBuilt(fs.readFileSync(f, "utf8")));
    syncTaskDir(d, RUN, OPTS);
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^status: .*$/m, "status: todo"));
    const t = syncTaskDir(d, RUN, OPTS).tasks.find((x) => x.id === tgt.id);
    return { status: t.status, warned: /was edited after the engine wrote it/.test(readIndex(d)) };
  });

check("re-open (anti-vacuity): a CLOSING word typed over the same file IS still warned about",
  () => {
    const d = tmp("reopen-closing");
    const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
    const f = taskFilePath(d, tgt.id);
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(/^status: .*$/m, "status: done"));
    syncTaskDir(d, RUN, OPTS);
    return /was edited after the engine wrote it/.test(readIndex(d));
  }, "the warning must still fire where the word is a verdict");

console.log("\n===== `partial` on the index, the progress block and the gates =====");
{
  const dir = tmp("partial");
  const first = syncTaskDir(dir, RUN, OPTS);
  const target = taskAt(first, "child:G1", "Quality gates");
  const p = path.join(dir, target.file);
  fs.writeFileSync(p, setOutcome(allBuilt(fs.readFileSync(p, "utf8")), 1, "not-built — needs-decision"));
  const second = syncTaskDir(dir, RUN, OPTS);
  const idx = readIndex(dir);
  const back = second.tasks.find((t) => t.id === target.id);

  check("syncTaskDir: the computed `partial` is WRITTEN BACK into the front matter — the next reader of that file, and any tool that only greps `status:`, sees the computed value rather than what the agent last typed",
    () => back.status === "partial" && /status: partial/.test(fs.readFileSync(p, "utf8")),
    () => fs.readFileSync(p, "utf8").split("\n").slice(0, 4));

  check("two deliverables of ONE task that share a long common prefix keep SEPARATE outcomes — the `Quality gates` rows differ only in their last sentence, and filing both under a truncated key let the second silently overwrite the first",
    () => {
      const rows = second.tasks.find((t) => t.id === target.id).rows;
      return rows.length === 2 && rows[0].label.slice(0, 60) === rows[1].label.slice(0, 60)
        && rows[0].outcomeKind === "not-built" && rows[1].outcomeKind === "built";
    }, () => second.tasks.find((t) => t.id === target.id).rows.map((r) => r.outcomeKind));

  check("the index counts `partial` in its OWN bucket and NOT as done — a run with unbuilt deliverables that reads `Done: 9 · Open: 0` has told the reader the opposite of the truth",
    () => /\*\*⚠ Partial:\*\* 1/.test(idx) && !/\*\*Done:\*\* 1 /.test(idx) && /◐ partial/.test(idx),
    () => idx.split("\n").slice(0, 4));

  check("the index Attention section names the unbuilt DELIVERABLE, its cause and where the detail is — the file that recorded it is where the reason lives, so the line points there rather than repeating prose",
    () => /## Attention/.test(idx) && /row 1 — \*\*not built\*\*/.test(idx)
      && /needs-decision/.test(idx) && /`## Notes`/.test(idx),
    () => idx.slice(idx.indexOf("## Attention")).split("\n").slice(0, 6));

  check("the progress block — the one surface a watching user reads while the run happens — carries the partial count AND names each unbuilt row, because that is the boundary the two lost filters died at",
    () => {
      const prog = renderProgress(second, dir);
      // …and says what the row is waiting on WITHOUT claiming nothing can be scheduled for it: `notBuiltOpenRows`
      // filters on no cause, so `--route` opens a round over a `needs-decision` row like any other.
      return /⚠ partial 1/.test(prog) && /⚠ NOT BUILT — 1 deliverable/.test(prog)
        && /a decision settles it, not a re-run — route it once that decision exists/.test(prog)
        && !/not re-dispatched/.test(prog);
    }, () => renderProgress(second, dir));

  check("a `partial` task with NO `agentNonce` is named by the nonce audit exactly as a `done` one is — it is a task that stopped claiming work was done by somebody, and a closed state the audit skips is the cheapest way past the one-sub-agent contract",
    // Scoped to the audit LINE: every task file is also listed in the index table above, so a whole-document
    // search passes whether the audit named it or not.
    () => {
      const line = readIndex(dir).split("\n").find((l) => /with NO `agentNonce`/.test(l)) || "";
      return line.includes(target.file);
    }, () => readIndex(dir).split("\n").filter((l) => /agentNonce/.test(l)));

  const todoCount = (set, d) => Number(/todo (\d+)/.exec(renderProgress(set, d))?.[1]);
  check("a `partial` task leaves the OPEN set — it is settled, so it stops being counted as `todo` and its weight leaves the remaining-minutes forecast. Counted as open it quotes a queue deeper and a run longer than they are",
    () => todoCount(second, dir) === todoCount(first, dir) - 1,
    () => ({ beforePartial: todoCount(first, dir), afterPartial: todoCount(second, dir) }));

  check("`partial` RELEASES the tasks that depend on it — it holds up calling the run complete, not the queue. A state that halted dependents is exactly the state agents avoided by writing `done`",
    // Built on its OWN folder around `Page build`: the `Quality gates` task this block otherwise uses is a leaf,
    // so a release asserted over it asserts nothing. The source is dispatched and signed so the only thing that
    // could refuse the dependent is the dependency rule under test.
    () => {
      const d = tmp("partial-releases");
      const s1 = syncTaskDir(d, RUN, OPTS);
      const src = taskAt(s1, "child:G1", "Page build");
      const dependent = s1.tasks.find((t) => (t.dependsOn || []).includes(src.id));
      if (!dependent) return false;
      clearDepsOf(d, src.id, RUN, OPTS);
      const token = `tok-${src.id}`;
      startTask(d, src.id, RUN, { ...OPTS, dispatchToken: token }, null, AT(80));
      const fp = taskFilePath(d, src.id);
      fs.writeFileSync(fp, setOutcome(allBuilt(fs.readFileSync(fp, "utf8")), 1, "not-built — needs-decision"));
      editFrontMatter(d, src.id, "agentNonce", token);
      const s2 = syncTaskDir(d, RUN, { ...OPTS, now: AT(81) });
      if (s2.tasks.find((t) => t.id === src.id).status !== "partial") return false;
      const res = startTask(d, dependent.id, RUN, { ...OPTS, dispatchToken: "tok-dep" }, null, AT(82));
      return !!res.started && !res.blockedByDeps;
    }, "a `partial` dependency must not refuse the dispatch of what waits on it");

  check("a `partial` task is still held to the DISPATCH gate — it was worked and finished, so it must carry a dispatch record exactly as a `done` one does; exempting it would make `partial` the new way to close a task nobody was sent out for",
    () => dispatchAudit(readTaskDir(dir), dir).never.some((t) => t.id === target.id),
    () => dispatchAudit(readTaskDir(dir), dir).never.map((t) => t.id));

  check("readTaskDir RE-COMPUTES the status off the file's own cells — a `partial` edited back to `done` by hand is still `partial` to the read-only path, so the gate cannot be cleared with a text editor",
    () => {
      const tampered = fs.readFileSync(p, "utf8").replace("status: partial", "status: done");
      fs.writeFileSync(p, tampered);
      const seen = readTaskDir(dir).find((t) => t.id === target.id);
      return seen.status === "partial" && seen.recordedStatus === "done";
    }, () => readTaskDir(dir).find((t) => t.id === target.id));
}


console.log("\n===== end to end through the CLI: the run FAILS and the list is generated, not summarised =====");
{
  const cliT = (args, manifest) => spawnSync(process.execPath, [MIGRATE, "-", ...args],
    { input: JSON.stringify(manifest), encoding: "utf8" });
  const dP = path.join(tmp("notbuilt-cli"), "build-tasks");
  cliT(["--tasks", dP], MANIFEST);
  const victim = readTaskDir(dP).find((t) => t.rows.length >= 2);
  const vf = path.join(dP, victim.file);
  let text = fs.readFileSync(vf, "utf8");
  let seen = 0;
  text = text.split("\n").map((line) => {
    const cells = line.split(/(?<!\\)\|/);
    if (cells.length < 7 || !/^\s*\d+\s*$/.test(cells[1])) return line;
    seen++;
    // TWO rows on ONE page — the shape the incident had. One unbuilt row can be named by a list that cannot
    // count, and a gate that reports one deliverable while two are open is the failure being replaced.
    cells[5] = seen <= 2 ? " not-built — blocked " : " built ";
    return cells.join("|");
  }).join("\n");
  fs.writeFileSync(vf, text);
  const run = cliT(["--tasks", dP], MANIFEST);

  check("CLI: a folder holding an unbuilt deliverable exits 2 — the run cannot report success over work its own agent recorded as not done",
    run.status === 2, () => ({ status: run.status, stderr: run.stderr.slice(0, 400) }));

  check("CLI: the failure names EVERY unbuilt deliverable, its task and its cause on stderr, and says what the cause means — this is the text that replaces a summary composed from memory, which is where the two filters were lost",
    () => /⛔ NOT BUILT — 2 deliverable\(s\)/.test(run.stderr) && run.stderr.includes(victim.file)
      && /row 1 —/.test(run.stderr) && /row 2 —/.test(run.stderr)
      && /blocked: the stand or a service was unreachable/.test(run.stderr),
    () => run.stderr.slice(-900));

  // The command it names has to be one a run with pages still unbuilt can take: `--verify` needs a `--built`
  // payload for every page, `--route` needs none.
  check("CLI: the report names the ONE command that routes these rows — `--tasks <dir> --route`, which needs no `--built` payload — warns off hand-writing a repair file, and names PARKED as where the routing ends",
    () => /--tasks <dir> --route` to open a repair/.test(run.stderr)
      && !/`--verify --tasks <dir>` to open a repair round/.test(run.stderr)
      && /Do NOT hand-write a repair file/.test(run.stderr)
      && /PARKED and will not get another/.test(run.stderr),
    () => run.stderr.slice(-700));

  check("CLI: the task FOLDER and the index are still written — the run failed, the slice did not, so the record of what was built is not withheld as a punishment",
    () => fs.existsSync(path.join(dP, TASK_INDEX_FILE)) && /⚠ Partial:/.test(readIndex(dP))
      && fs.readFileSync(vf, "utf8").includes("status: partial"),
    () => readIndex(dP).split("\n").slice(0, 4));

  // THE REPAIR-MODE LEG OF THE SAME GATE. `--tasks` alone routes nothing, so the row above fails the run; the
  // pairing below is the command that routes it. Asserted through the CLI because the wiring between
  // `runRepairMode`, `partialGateFailure` and `notReady` lives there and nowhere else — a flag folded into the
  // wrong variable, or an exit code not surfaced, is invisible to every in-process test.
  const baseR = tmp("notbuilt-repair");
  const dR = path.join(baseR, "build-tasks");
  cliT(["--tasks", dR], MANIFEST);
  // Dispatched and signed the way a real run closes a task (`--start` → token → nonce). Required: the repair leg
  // checks the ledger BEFORE it schedules anything, so a folder that fails the dispatch gate writes no repair
  // task at all — and a test that skipped this would assert the refusal, not the routing.
  const closeAllViaCli = (dir) => {
    for (;;) {
      const tasks = readTaskDir(dir);
      const next = tasks.find((t) => t.status === "todo" && (t.dependsOn || []).every((d) => {
        const dep = tasks.find((x) => x.id === d);
        return !dep || dep.status === "done" || dep.status === "n/a";
      }));
      if (!next) break;
      const started = cliT(["--tasks", dir, "--start", next.id], MANIFEST);
      closeCells(dir, next.id);
      editFrontMatter(dir, next.id, "agentNonce", /DISPATCH TOKEN for `[^`]+`: (\S+)/.exec(started.stdout || "")?.[1] || "");
      cliT(["--tasks", dir], MANIFEST);
    }
  };
  closeAllViaCli(dR);
  const vic = readTaskDir(dR).find((t) => t.rows.length >= 2);
  const vfR = path.join(dR, vic.file);
  fs.writeFileSync(vfR, setOutcome(allBuilt(fs.readFileSync(vfR, "utf8")), 1, NOT_BUILT_BLOCKED));
  const unrouted = cliT(["--tasks", dR], MANIFEST);
  const builtR = path.join(baseR, "built.json");
  fs.writeFileSync(builtR, JSON.stringify({ pages: {} }));
  const routed = cliT(["--verify", "--built", builtR, "--tasks", dR], MANIFEST);
  // Read off the FILES, not off a return value: both legs below are asserting that the round reached the folder.
  const repairFilesIn = (dir) => fs.readdirSync(dir).filter((f) => f.startsWith("task-repair-"));
  const repairCausesIn = (dir) => repairFilesIn(dir)
    .map((f) => parseTaskFile(fs.readFileSync(path.join(dir, f), "utf8")).meta.cause);
  const repairCause = repairCausesIn(dR);

  check("CLI (anti-vacuity): the same folder DOES fail `--tasks` first — otherwise the pairing below could be routing nothing and the two checks would agree for no reason",
    () => unrouted.status === 2 && /⛔ NOT BUILT/.test(unrouted.stderr || ""),
    () => ({ status: unrouted.status, stderr: (unrouted.stderr || "").slice(-500) }));

  check("CLI `--verify --tasks`: the unbuilt row is ROUTED — a repair task keyed `not-built:<kind>` is written for it, which is exactly the command the `--tasks` failure told the user to run",
    () => repairCause.some((c) => String(c).startsWith("not-built:")),
    () => ({ status: routed.status, causes: repairCause, stdout: (routed.stdout || "").slice(-700) }));

  check("CLI `--verify --tasks`: once routed, the row is NOT an unrouted NOT BUILT failure — the gate reads folder state, so the row that failed `--tasks` is somebody's open work here instead of a second identical refusal. This is the only test that drives `runRepairMode`'s gate wiring end to end",
    () => !/⛔ NOT BUILT/.test(routed.stderr || ""),
    () => (routed.stderr || "").slice(-700));

  // ---- `--route`: THE SAME ROUND, WITHOUT A `--built` PAYLOAD ------------------------------------------------
  // The leg above routes only from a verify run, which needs every page built. This one routes the same rows off
  // the folder alone, so a run still building pages can clear the gate that names them.
  const baseO = tmp("notbuilt-route");
  const dO = path.join(baseO, "build-tasks");
  cliT(["--tasks", dO], MANIFEST);
  closeAllViaCli(dO);
  const vicO = readTaskDir(dO).find((t) => t.rows.length >= 2);
  const vfO = path.join(dO, vicO.file);
  fs.writeFileSync(vfO, setOutcome(allBuilt(fs.readFileSync(vfO, "utf8")), 1, NOT_BUILT_BLOCKED));
  const unroutedO = cliT(["--tasks", dO], MANIFEST);
  const route = cliT(["--tasks", dO, "--route"], MANIFEST);
  const routeCauses = repairCausesIn(dO);

  check("CLI (anti-vacuity): the folder DOES fail `--tasks` before `--route` runs — otherwise the routing below could be routing nothing",
    () => unroutedO.status === 2 && /⛔ NOT BUILT/.test(unroutedO.stderr || ""),
    () => ({ status: unroutedO.status, stderr: (unroutedO.stderr || "").slice(-400) }));

  check("CLI `--tasks --route`: the unbuilt row is routed with NO `--built` payload and no verify run — same repair machinery, keyed `not-built:<kind>`, reachable by a run that still has pages left to build",
    () => routeCauses.some((c) => String(c).startsWith("not-built:")),
    () => ({ status: route.status, causes: routeCauses, stdout: (route.stdout || "").slice(-700) }));

  check("CLI `--tasks --route`: once routed the row is somebody's open work, so the unrouted-NOT-BUILT gate stops firing — the same folder state the `--verify` leg produces, reached without one",
    () => !/⛔ NOT BUILT/.test(route.stderr || ""),
    () => ({ status: route.status, stderr: (route.stderr || "").slice(-700) }));

  check("CLI `--tasks --route`: the report says the rows came from a BUILD agent, not from a verify run — a sub-agent handed the repair task acts differently on 'the verifier could not find it' than on 'the agent wrote down that they did not build it'",
    () => /recorded as NOT BUILT, merged by \(page, cause\)/.test(route.stdout || "")
      && !/the open rows of THIS verify run/.test(route.stdout || ""),
    () => (route.stdout || "").slice(-700));

  check("CLI `--tasks --route`: it prints the progress block, which is what the orchestrator pastes after a status change — routing IS a status change, and a mode that changed the folder silently would leave the chat's count behind the folder's",
    () => /--- progress ---/.test(route.stdout || "") && /dispatched \d+ of \d+/.test(route.stdout || ""),
    () => (route.stdout || "").slice(-500));

  check("CLI `--route` with nothing to route: a second run writes no new round and says so, rather than manufacturing one — a round is an ATTEMPT, and re-routing an unchanged folder would burn the cap with nobody having run",
    () => {
      const again = cliT(["--tasks", dO, "--route"], MANIFEST);
      return repairFilesIn(dO).length === routeCauses.length && /already have an OPEN repair task/.test(again.stdout || "");
    },
    () => (cliT(["--tasks", dO, "--route"], MANIFEST).stdout || "").slice(-600));

  // The flag is refused rather than ignored wherever it would silently do nothing or do two things at once.
  for (const [why, args] of [
    ["without `--tasks <dir>` there is no folder to open a round in", ["--route"]],
    ["`--verify --tasks` already routes these rows, and `--route` beside it would claim a second, different round", ["--verify", "--built", builtR, "--tasks", dO, "--route"]],
    ["`--start` marks a task for dispatch; routing SCHEDULES one, and one call doing both cannot say which task the printed token belongs to", ["--tasks", dO, "--route", "--start", "x"]],
    ["`--split` CUTS a folder; `--route` opens a round in one already cut, reading the split frozen inside it", ["--tasks", dO, "--route", "--split", "./split.json"]],
  ]) {
    check(`CLI: \`--route\` is REFUSED, not ignored — ${why}`,
      () => { const r = cliT(args, MANIFEST); return r.status === 1 && /migrate\.mjs: `--route`|`--route`/.test(r.stderr || ""); },
      () => { const r = cliT(args, MANIFEST); return { status: r.status, stderr: (r.stderr || "").slice(0, 400) }; });
  }

  // A clean folder must not trip the gate.
  const dOk = path.join(tmp("notbuilt-cli-ok"), "build-tasks");
  const ok = cliT(["--tasks", dOk], MANIFEST);
  check("CLI (no false positive): a folder with no outcomes recorded anywhere does NOT trip the gate — every folder written before this existed is in that shape, and a gate that fires on all of them is a gate nobody keeps",
    ok.status === 0 && !/NOT BUILT/.test(ok.stderr), () => ({ status: ok.status, stderr: ok.stderr.slice(0, 300) }));
}


console.log("\n===== review fixes: mid-flight, n-a, drift remedy, escaped pipes =====");

check("MID-FLIGHT: a `not-built` cell recorded while other rows are still blank leaves the task `in-progress` — the agent fills cells as it goes, so settling there would stop the clock, release dependents and demand a dispatch record from a sub-agent still running",
  () => {
    let t = renderTaskFile(SAMPLE, SET).replace("status: todo", "status: in-progress");
    t = setOutcome(t, 1, "built");
    t = setOutcome(t, 2, NOT_BUILT_BLOCKED);
    const m = mergeTaskSet({ ...SET, tasks: [SAMPLE] }, [{ file: SAMPLE.file, ...parseTaskFile(t) }]).tasks[0];
    return SAMPLE.rows.length > 2 && m.status === "in-progress" && notBuiltRows([m]).length === 0;
  }, () => {
    let t = renderTaskFile(SAMPLE, SET).replace("status: todo", "status: in-progress");
    t = setOutcome(setOutcome(t, 1, "built"), 2, NOT_BUILT_BLOCKED);
    return mergeTaskSet({ ...SET, tasks: [SAMPLE] }, [{ file: SAMPLE.file, ...parseTaskFile(t) }]).tasks[0].status;
  });

check("MID-FLIGHT: once the LAST blank cell is filled the same `not-built` computes `partial` — the reorder must not disable the feature, only defer it until the task is actually accounted for",
  () => {
    let t = allBuilt(renderTaskFile(SAMPLE, SET)).replace("status: todo", "status: in-progress");
    t = setOutcome(t, 2, NOT_BUILT_BLOCKED);
    const m = mergeTaskSet({ ...SET, tasks: [SAMPLE] }, [{ file: SAMPLE.file, ...parseTaskFile(t) }]).tasks[0];
    return m.status === "partial" && notBuiltRows([m]).length === 1;
  }, () => {
    let t = allBuilt(renderTaskFile(SAMPLE, SET)).replace("status: todo", "status: in-progress");
    return mergeTaskSet({ ...SET, tasks: [SAMPLE] }, [{ file: SAMPLE.file, ...parseTaskFile(setOutcome(t, 2, NOT_BUILT_BLOCKED)) }]).tasks[0].status;
  });

check("`n-a` WITHOUT a reason counts as `not-built` — a row closed without being built and without a reason is a self-certified skip, and it must not compute `done` the way the task-level `n/a` must carry a reason to skip its dispatch record",
  () => {
    let t = renderTaskFile(SAMPLE, SET);
    for (let i = 1; i <= SAMPLE.rows.length; i++) t = setOutcome(t, i, "n-a");
    const m = mergeTaskSet({ ...SET, tasks: [SAMPLE] }, [{ file: SAMPLE.file, ...parseTaskFile(t) }]).tasks[0];
    return m.status === "partial" && notBuiltRows([m]).length === SAMPLE.rows.length;
  }, () => {
    let t = renderTaskFile(SAMPLE, SET);
    for (let i = 1; i <= SAMPLE.rows.length; i++) t = setOutcome(t, i, "n-a");
    return mergeTaskSet({ ...SET, tasks: [SAMPLE] }, [{ file: SAMPLE.file, ...parseTaskFile(t) }]).tasks[0].status;
  });

check("`n-a` WITH a reason closes its row, but on a row the plan did not mark N/A it is named on Attention — the plan's own boundaries are approved and silent; an agent asserting one is a claim someone should see",
  () => {
    let t = allBuilt(renderTaskFile(SAMPLE, SET));
    t = setOutcome(t, 1, "n-a — no Freedom analog, confirmed with the user");
    const set = mergeTaskSet({ ...SET, tasks: [SAMPLE] }, [{ file: SAMPLE.file, ...parseTaskFile(t) }]);
    const m = set.tasks[0];
    const idx = renderTaskIndex(set);
    return m.status === "done" && !SAMPLE.rows[0].na
      && assertedBoundaryRows([m]).length === 1
      && /recorded `n-a` on a row the plan did NOT mark N\/A/.test(idx);
  }, () => {
    let t = setOutcome(allBuilt(renderTaskFile(SAMPLE, SET)), 1, "n-a — no Freedom analog, confirmed with the user");
    return mergeTaskSet({ ...SET, tasks: [SAMPLE] }, [{ file: SAMPLE.file, ...parseTaskFile(t) }]).tasks[0].status;
  });

check("a drifted `partial` is NOT told to re-open as `status: todo` — the status is computed, so a hand-set `todo` recomputes straight back; the remedy names the cells and `rowsDigest:` instead",
  () => {
    const drifted = { ...SAMPLE, status: "partial", drifted: true, file: SAMPLE.file };
    const idx = renderTaskIndex({ ...SET, tasks: [drifted] });
    return /Re-opening it as `status: todo` will NOT clear this/.test(idx)
      && !/This clears when the task is\s+re-opened/.test(idx.slice(idx.indexOf("computes `partial`")));
  }, () => renderTaskIndex({ ...SET, tasks: [{ ...SAMPLE, status: "partial", drifted: true }] }).slice(-400));

check("a `|` in a Classic caption does not shift the Outcome cell — deliverable labels are customer captions, and the column is read back by position, so an unescaped pipe would truncate the label and read the outcome out of the wrong cell",
  () => {
    const piped = { ...SAMPLE, rows: [{ ...SAMPLE.rows[0], label: "Caption A | B" }, ...SAMPLE.rows.slice(1)] };
    const t = setOutcome(renderTaskFile(piped, SET), 1, NOT_BUILT_BLOCKED);
    const parsed = parseTaskFile(t);
    const m = mergeTaskSet({ ...SET, tasks: [piped] }, [{ file: piped.file, ...parseTaskFile(t) }]).tasks[0];
    return parsed.table[0].label === "Caption A | B"
      && parsed.table[0].mark?.outcome === "not-built"
      && m.rows[0].outcomeKind === "not-built";
  }, () => {
    const piped = { ...SAMPLE, rows: [{ ...SAMPLE.rows[0], label: "Caption A | B" }, ...SAMPLE.rows.slice(1)] };
    return parseTaskFile(setOutcome(renderTaskFile(piped, SET), 1, NOT_BUILT_BLOCKED)).table[0];
  });

check("a `|` typed INSIDE the Outcome cell keeps the whole reason — the agent hand-types free prose there (`n-a — <reason>`, the reason is REQUIRED), so a raw pipe is already in the file and cannot be escaped away on write; truncating at it left a HALF reason that still read as a validly-reasoned, accounted skip",
  () => {
    const reason = "n-a — approved per CRM-123, replaces the A | B filter";
    const m = mergeTaskSet({ ...SET, tasks: [SAMPLE] },
      [{ file: SAMPLE.file, ...parseTaskFile(setOutcome(allBuilt(renderTaskFile(SAMPLE, SET)), 1, reason)) }]).tasks[0];
    return m.rows[0].outcomeReason === "approved per CRM-123, replaces the A | B filter" && !m.rows[0].naNoReason;
  }, () => reread(SAMPLE, SET, (t) => setOutcome(allBuilt(t), 1, "n-a — approved per CRM-123, replaces the A | B filter"))
    .rows.map((r) => [r.outcomeKind, r.outcomeReason]));

check("that reason SURVIVES the re-render — the engine escapes the cell on the way back out, so a second pass reads the same text rather than splitting it further each time the folder is re-sliced",
  () => {
    const reason = "n-a — approved per CRM-123, replaces the A | B filter";
    const once = mergeTaskSet({ ...SET, tasks: [SAMPLE] },
      [{ file: SAMPLE.file, ...parseTaskFile(setOutcome(allBuilt(renderTaskFile(SAMPLE, SET)), 1, reason)) }]);
    const twice = mergeTaskSet({ ...SET, tasks: [SAMPLE] },
      [{ file: SAMPLE.file, ...parseTaskFile(renderTaskFile(once.tasks[0], once)) }]);
    return twice.tasks[0].rows[0].outcomeReason === "approved per CRM-123, replaces the A | B filter";
  }, "the Outcome cell must round-trip a typed pipe");

check("the generated task body names `declared:` as the agent's only status input and never instructs a `status:` write — the file IS the sub-agent's prompt, so guidance that names the engine's own field is guidance that loses a halt",
  () => /Never write `status:`/.test(SAMPLE_TEXT)
    && /`declared: blocked`/.test(SAMPLE_TEXT) && /`declared: n\/a`/.test(SAMPLE_TEXT)
    && !/Do \*\*not\*\* set `status:`/.test(SAMPLE_TEXT)
    && !/those you DO write/.test(SAMPLE_TEXT)
    && /reason is REQUIRED/.test(SAMPLE_TEXT),
  () => SAMPLE_TEXT.slice(SAMPLE_TEXT.indexOf("How you close this task"), SAMPLE_TEXT.indexOf("How you close this task") + 900));


check("an agent-asserted boundary reaches the PROGRESS BLOCK, not just `index.md` — a row nobody built that appears only in a file the user may never open is the shape this whole change exists to prevent, one step over",
  () => {
    const d = tmp("asserted-progress");
    const s1 = syncTaskDir(d, RUN, OPTS);
    const tgt = taskAt(s1, "child:G1", "Quality gates");
    const fp = path.join(d, tgt.file);
    fs.writeFileSync(fp, setOutcome(allBuilt(fs.readFileSync(fp, "utf8")), 1, "n-a — no Freedom equivalent, my call"));
    const s2 = syncTaskDir(d, RUN, OPTS);
    const prog = renderProgress(s2, d);
    const back = s2.tasks.find((t) => t.id === tgt.id);
    return back.status === "done"
      && /agent-asserted boundary/.test(prog)
      && /no Freedom equivalent, my call/.test(prog)
      && !/⚠ partial/.test(prog);
  }, () => {
    const d = tmp("asserted-progress-d");
    const s1 = syncTaskDir(d, RUN, OPTS);
    const tgt = taskAt(s1, "child:G1", "Quality gates");
    const fp = path.join(d, tgt.file);
    fs.writeFileSync(fp, setOutcome(allBuilt(fs.readFileSync(fp, "utf8")), 1, "n-a — no Freedom equivalent, my call"));
    return renderProgress(syncTaskDir(d, RUN, OPTS), d);
  });

check("an asserted boundary does NOT fail the run — gating it is the open decision this change deliberately leaves alone, so the line is informational and the exit code is untouched",
  () => {
    const d = tmp("asserted-nogate");
    const s1 = syncTaskDir(d, RUN, OPTS);
    const tgt = taskAt(s1, "child:G1", "Quality gates");
    const fp = path.join(d, tgt.file);
    fs.writeFileSync(fp, setOutcome(allBuilt(fs.readFileSync(fp, "utf8")), 1, "n-a — approved boundary"));
    const s2 = syncTaskDir(d, RUN, OPTS);
    return notBuiltRows(s2.tasks).length === 0 && assertedBoundaryRows(s2.tasks).length === 1;
  }, "an asserted boundary must not enter notBuiltRows, which is what sets the exit-2 gate");


console.log("\n===== the residual is ROUTED: a not-built row becomes a repair round, and closes the task when it closes =====");

// A folder whose one `Quality gates` deliverable the build agent recorded as NOT BUILT — dispatched, signed and
// closed the way a real run closes it, because the residual's closure is checked against the dispatch record.
const partialFolder = (name, notBuilt = [1]) => {
  const d = tmp(name);
  const tgt = taskAt(syncTaskDir(d, RUN, OPTS), "child:G1", "Quality gates");
  clearDepsOf(d, tgt.id, RUN, OPTS);
  const token = `tok-${tgt.id}`;
  startTask(d, tgt.id, RUN, { ...OPTS, dispatchToken: token }, null, AT(40));
  const fp = taskFilePath(d, tgt.id);
  let text = allBuilt(fs.readFileSync(fp, "utf8"));
  for (const n of notBuilt) text = setOutcome(text, n, "not-built — blocked");
  fs.writeFileSync(fp, text);
  editFrontMatter(d, tgt.id, "agentNonce", token);
  syncTaskDir(d, RUN, { ...OPTS, now: AT(41) });
  return { d, tgt, fp };
};
const repairFiles = (d) => fs.readdirSync(d).filter((f) => f.startsWith("task-repair-"));
const repairIds = (d) => repairFiles(d)
  .map((f) => parseTaskFile(fs.readFileSync(path.join(d, f), "utf8")).meta?.id).filter(Boolean);
// Dispatched, signed and closed — the same three steps a build task takes.
let repairMin = 50;
const nextMin = () => { repairMin += 2; return repairMin; };
const closeRepairs = (d) => repairIds(d).forEach((id) => runTask(d, id, RUN, OPTS, nextMin()));
// Dispatched, signed, and closed THE WAY A BUILD TASK IS: every `Outcome` cell filled, no status word typed.
// `mark` may be a function of the row number, for a round that fixed some of its rows and not others.
const runRepair = (d, id, mark = "built") => {
  startTask(d, id, RUN, { ...OPTS, dispatchToken: `tok-${id}` }, null, AT(nextMin()));
  const f = taskFilePath(d, id);
  let text = fs.readFileSync(f, "utf8");
  for (let i = 1; i <= rowCount(text); i++) text = setOutcome(text, i, typeof mark === "function" ? mark(i) : mark);
  fs.writeFileSync(f, text);
  editFrontMatter(d, id, "agentNonce", `tok-${id}`);
  syncTaskDir(d, RUN, { ...OPTS, now: AT(repairMin + 1) });
};
const runRepairs = (d, mark) => repairIds(d).forEach((id) => runRepair(d, id, mark));
// The round ran and the sub-agent stated why it could not proceed.
const blockRepairsAs = (d, status) => repairIds(d).forEach((id) => {
  startTask(d, id, RUN, { ...OPTS, dispatchToken: `tok-${id}` }, null, AT(nextMin()));
  editFrontMatter(d, id, "status", status);
  editFrontMatter(d, id, "agentNonce", `tok-${id}`);
  syncTaskDir(d, RUN, { ...OPTS, now: AT(repairMin + 1) });
});
const backAt = (set, id) => set.tasks.find((t) => t.id === id);

// THE WRITE PHASE RUNS LAST. A task's word is only true for the coverage it was derived against, and opening the
// next round changes that coverage.
const reopenRow = (label) => ({ "child:G1": { missing: 1, unverified: 0, complete: false, openRows: [openRow(1, label)] } });
check("reopen: a round that RE-OPENS a settled row rewrites the task file too — the file may not keep the `done` it was resolved to while round 1 was the only round",
  () => {
    const { d, tgt } = partialFolder("reopen-writes-back");
    syncRepairDir(d, RUN, {}, OPTS);
    closeRepairs(d);
    const resolved = backAt(syncTaskDir(d, RUN, OPTS), tgt.id);
    const onDiskAfterRound1 = parseTaskFile(fs.readFileSync(taskFilePath(d, tgt.id), "utf8")).meta.status;
    // Round 2 over the same deliverable — the row is open again, so the parent is not `done` any more.
    syncRepairDir(d, RUN, reopenRow(resolved.rows[0].label), OPTS);
    const onDiskAfterRound2 = parseTaskFile(fs.readFileSync(taskFilePath(d, tgt.id), "utf8")).meta.status;
    return resolved.status === "done" && onDiskAfterRound1 === "done" && onDiskAfterRound2 === "partial";
  }, () => {
    const { d, tgt } = partialFolder("reopen-writes-back-d");
    syncRepairDir(d, RUN, {}, OPTS);
    closeRepairs(d);
    const resolved = backAt(syncTaskDir(d, RUN, OPTS), tgt.id);
    const r1 = parseTaskFile(fs.readFileSync(taskFilePath(d, tgt.id), "utf8")).meta.status;
    syncRepairDir(d, RUN, reopenRow(resolved.rows[0].label), OPTS);
    return { afterRound1: r1, afterRound2: parseTaskFile(fs.readFileSync(taskFilePath(d, tgt.id), "utf8")).meta.status };
  });

check("reopen: and the file agrees with the index it was written beside — one write phase, so the folder cannot hold two answers to the same question",
  () => {
    const { d, tgt } = partialFolder("reopen-file-vs-index");
    syncRepairDir(d, RUN, {}, OPTS);
    closeRepairs(d);
    const resolved = backAt(syncTaskDir(d, RUN, OPTS), tgt.id);
    const set = syncRepairDir(d, RUN, reopenRow(resolved.rows[0].label), OPTS).set;
    const onDisk = parseTaskFile(fs.readFileSync(taskFilePath(d, tgt.id), "utf8")).meta.status;
    const row = readIndex(d).split("\n").find((l) => l.includes(`](${backAt(set, tgt.id).file})`));
    return onDisk === "partial" && /◐ partial/.test(row);
  }, () => {
    const { d, tgt } = partialFolder("reopen-file-vs-index-d");
    syncRepairDir(d, RUN, {}, OPTS);
    closeRepairs(d);
    const resolved = backAt(syncTaskDir(d, RUN, OPTS), tgt.id);
    syncRepairDir(d, RUN, reopenRow(resolved.rows[0].label), OPTS);
    return { file: parseTaskFile(fs.readFileSync(taskFilePath(d, tgt.id), "utf8")).meta.status,
      index: readIndex(d).split("\n").filter((l) => l.includes("Quality gates")).join(" | ") };
  });

// ONE READER. `readTaskDir` (the dispatch preflight, the CLI's own folder read) and the merged path must answer
// the same question the same way, or a row reads open through one and closed through the other.
check("ONE READER: `readTaskDir` resolves residuals like the merged path does — a row a repair round settled reads closed through BOTH, so the two views of one folder cannot disagree",
  () => {
    const { d, tgt } = partialFolder("one-reader-agree");
    syncRepairDir(d, RUN, {}, OPTS);
    closeRepairs(d);
    const merged = backAt(syncTaskDir(d, RUN, OPTS), tgt.id);
    const read = readTaskDir(d).find((t) => t.id === tgt.id);
    return merged.status === "done" && read.status === "done"
      && notBuiltOpenItems(readTaskDir(d)).length === 0;
  }, () => {
    const { d, tgt } = partialFolder("one-reader-agree-d");
    syncRepairDir(d, RUN, {}, OPTS);
    closeRepairs(d);
    const merged = backAt(syncTaskDir(d, RUN, OPTS), tgt.id);
    const read = readTaskDir(d).find((t) => t.id === tgt.id);
    return { merged: merged.status, read: read.status, open: notBuiltOpenItems(readTaskDir(d)).length };
  });

check("ONE READER (anti-vacuity): before the round closes, BOTH views still read the row as open — the agreement above is not two views that never say anything",
  () => {
    const { d, tgt } = partialFolder("one-reader-open");
    syncRepairDir(d, RUN, {}, OPTS);
    const merged = backAt(syncTaskDir(d, RUN, OPTS), tgt.id);
    const read = readTaskDir(d).find((t) => t.id === tgt.id);
    return merged.status === "partial" && read.status === "partial"
      && notBuiltOpenItems(readTaskDir(d)).length === 1;
  }, () => {
    const { d, tgt } = partialFolder("one-reader-open-d");
    syncRepairDir(d, RUN, {}, OPTS);
    const read = readTaskDir(d).find((t) => t.id === tgt.id);
    return { read: read.status, open: notBuiltOpenItems(readTaskDir(d)).length };
  });

check("the residual goes through the EXISTING repair machinery — a row the build agent recorded as not built opens a repair task keyed `not-built:<kind>`, on a verify run that found nothing open itself, so the routing is the residual's own and not a side effect of a short build",
  () => {
    const { d } = partialFolder("residual-routed");
    const res = syncRepairDir(d, RUN, {}, OPTS);
    return res.written.length === 1 && res.written[0].cause.startsWith("not-built:")
      && res.written[0].pageKey === "child:G1" && res.written[0].kind === "repair";
  }, () => syncRepairDir(partialFolder("residual-routed-d").d, RUN, {}, OPTS).written.map((t) => `${t.pageKey} ${t.cause} r${t.repairRound}`));

check("the repair file carries what the BUILD agent wrote in the Outcome cell and where it wrote it — a repair round is spent on the wrong row when the engine paraphrases the observation instead of handing it over",
  () => {
    const { d, tgt } = partialFolder("residual-evidence");
    syncRepairDir(d, RUN, {}, OPTS);
    const text = fs.readFileSync(path.join(d, repairFiles(d)[0]), "utf8");
    return text.includes("not-built — blocked") && text.includes(tgt.file);
  }, () => { const { d } = partialFolder("residual-evidence-d"); syncRepairDir(d, RUN, {}, OPTS);
    return fs.readFileSync(path.join(d, repairFiles(d)[0]), "utf8"); });

check("a row with an OPEN repair round is NOT a gate failure — it is somebody's scheduled work, and a gate that keeps failing over a row already routed is a gate that can never be cleared by doing the work",
  () => {
    const { d } = partialFolder("residual-gate-open");
    const res = syncRepairDir(d, RUN, {}, OPTS);
    const rows = notBuiltRows(res.set.tasks);
    return rows.length === 1 && rows[0].residual === "open";
  }, () => notBuiltRows(syncRepairDir(partialFolder("residual-gate-open-d").d, RUN, {}, OPTS).set.tasks).map((r) => r.residual));

check("the task STAYS `partial` while its residual is open — the deliverable is still not built, so nothing about opening a repair round makes the page finished",
  () => {
    const { d, tgt } = partialFolder("residual-stays-partial");
    return backAt(syncRepairDir(d, RUN, {}, OPTS).set, tgt.id).status === "partial";
  }, "an open residual must not close its originating task");

check("the task closes to `done` when its residual closes — COMPUTED from the repair task's status, never typed, so the one way to clear a `partial` is to actually build the row",
  () => {
    const { d, tgt } = partialFolder("residual-closes");
    syncRepairDir(d, RUN, {}, OPTS);
    closeRepairs(d);
    const after = syncTaskDir(d, RUN, OPTS);
    // `notBuiltOpenItems`, not the raw collector: the row's Outcome cell keeps reading `not-built` after the
    // round that fixed it, so "nothing is open" is the list the report and the gate read through.
    return backAt(after, tgt.id).status === "done" && notBuiltOpenItems(after.tasks).length === 0;
  }, () => { const { d, tgt } = partialFolder("residual-closes-d"); syncRepairDir(d, RUN, {}, OPTS); closeRepairs(d);
    return backAt(syncTaskDir(d, RUN, OPTS), tgt.id).status; });

check("the closure survives a re-read: the Outcome cell still says `not-built`, so `computeStatus` recomputes `partial` on every read and the residual re-closes it — a one-shot flip would come undone on the next run",
  () => {
    const { d, tgt } = partialFolder("residual-idempotent");
    syncRepairDir(d, RUN, {}, OPTS);
    closeRepairs(d);
    syncTaskDir(d, RUN, OPTS);
    return backAt(syncTaskDir(d, RUN, OPTS), tgt.id).status === "done";
  }, "the resolution must hold across repeated syncs");

// A repair round the sub-agent could not complete either. The existing machinery answers a `blocked` round with a
// person, not a fourth identical task — so this is where the automatic procedure ENDS for a residual.
const blockRepairs = (d) => blockRepairsAs(d, "blocked");

check("a BLOCKED repair round puts the row back in front of the user — nothing is scheduled against it any more, so it reads as unrouted and the run keeps failing; a blocked round counted as open work would let a run pass over a deliverable TWO agents have now failed to build",
  () => {
    const { d, tgt } = partialFolder("residual-blocked");
    syncRepairDir(d, RUN, {}, OPTS);
    blockRepairs(d);
    const after = syncTaskDir(d, RUN, OPTS);
    const rows = notBuiltRows(after.tasks);
    return backAt(after, tgt.id).status === "partial" && rows.length === 1 && rows[0].residual === null;
  }, () => { const { d } = partialFolder("residual-blocked-d"); syncRepairDir(d, RUN, {}, OPTS); blockRepairs(d);
    return notBuiltRows(syncTaskDir(d, RUN, OPTS).tasks).map((r) => r.residual); });

check("a blocked round is not re-opened by re-verifying — the cause stays `pending` rather than manufacturing a second identical task, which is the existing rule for a sub-agent that stated why it could not proceed",
  () => {
    const { d } = partialFolder("residual-blocked-norepeat");
    syncRepairDir(d, RUN, {}, OPTS);
    blockRepairs(d);
    const again = syncRepairDir(d, RUN, {}, OPTS);
    return again.written.length === 0 && again.pending.some((p) => p.cause.startsWith("not-built:"));
  }, () => { const { d } = partialFolder("residual-blocked-norepeat-d"); syncRepairDir(d, RUN, {}, OPTS); blockRepairs(d);
    const a = syncRepairDir(d, RUN, {}, OPTS); return { written: a.written.length, pending: a.pending }; });

check("a residual closes its task only if SOMEBODY WAS DISPATCHED for it — typing `done` into the repair file clears nothing. A repair file is exempt from the dispatch gate and `--verify` re-measures the page, so that exemption is free for a machine-checked row; a `not-built` row is re-measured by NOBODY, and its repair task's status is the only evidence there is",
  () => {
    const { d, tgt } = partialFolder("residual-handedit");
    syncRepairDir(d, RUN, {}, OPTS);
    for (const f of repairFiles(d)) {
      const p = path.join(d, f);
      fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/^status: .*$/m, "status: done"));
    }
    const after = syncTaskDir(d, RUN, OPTS);
    const rows = notBuiltRows(after.tasks);
    // The typed word credits nothing: the parent stays `partial` and the row is still open work. Its residual
    // reads `open` rather than absent, because the repair task exists and its own blank cells leave it unclosed.
    return backAt(after, tgt.id).status === "partial" && rows.length === 1 && rows[0].residual === "open";
  }, () => { const { d, tgt } = partialFolder("residual-handedit-d"); syncRepairDir(d, RUN, {}, OPTS);
    for (const f of repairFiles(d)) { const p = path.join(d, f);
      fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(/^status: .*$/m, "status: done")); }
    const a = syncTaskDir(d, RUN, OPTS);
    return { status: backAt(a, tgt.id).status, residual: notBuiltRows(a.tasks).map((r) => r.residual) }; });

check("a `partial` repair round counts as an ATTEMPT — left out of the round vocabulary it holds its cause `pending` forever: no next round opens and the cap that would park it never fires, so the residual deadlocks behind a round nobody can close",
  () => {
    const first = buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []).tasks[0];
    const prior = [{ file: "task-repair-round1-x.md", notes: "", malformed: null,
      meta: { id: "r1", status: "partial", origin: "engine", pageKey: first.pageKey, kind: "repair",
        cause: first.cause, repairRound: "1" } }];
    const r = buildRepairTasks(RUN, VERIFY_PAGES, OPTS, prior);
    return r.tasks.some((t) => t.cause === first.cause && t.repairRound === 2)
      && !r.pending.some((p) => p.cause === first.cause);
  }, "a `partial` prior round must open round 2, not hold the cause pending");

console.log("\n===== a repair task closes the way every other task does: its own Outcome cells =====");

check("a repair file carries an `Outcome` column and says it closes on those cells — one status word over N rows cannot say WHICH of them the round fixed, and a second closing contract for the same reader is how the two drift apart",
  () => {
    const t = buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []).tasks[0];
    const text = renderTaskFile(t, SET);
    return /\| # \| Deliverable \| What was recorded \| Evidence behind it \| Outcome \|/.test(text)
      && /fill the `Outcome` cell of EVERY row below, exactly as a build task does/.test(text)
      && /Never write `status:`/.test(text) && /`declared: blocked`/.test(text)
      && !/Status vocabulary/.test(text);
  }, () => renderTaskFile(buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []).tasks[0], SET));

check("a `|` in a Classic caption does not shift the REPAIR table either — the repair branch interpolated the label raw while nothing parsed it; a parsed table reads the outcome out of the wrong cell the moment a caption carries a pipe",
  () => {
    const pages = { main: { openRows: [{ deliverable: "Caption A | B", outcome: "missing", status: "⚠ verify", evidence: "none" }] } };
    const t = buildRepairTasks(RUN, pages, OPTS, []).tasks[0];
    const text = setOutcome(renderTaskFile(t, SET), 1, NOT_BUILT_BLOCKED);
    const row = parseTaskFile(text).table[0];
    return row.label === "Caption A | B" && row.mark?.outcome === "not-built";
  }, () => parseTaskFile(renderTaskFile(buildRepairTasks(RUN,
    { main: { openRows: [{ deliverable: "Caption A | B", outcome: "missing", status: "s", evidence: "e" }] } },
    OPTS, []).tasks[0], SET)).table[0]);

check("the round's OWN status is computed from its cells — every row `built` reads `done` and the routed task closes; every row `not-built` reads `partial` and it does not, whatever the front matter says",
  () => {
    const fixed = partialFolder("repair-cells-built");
    syncRepairDir(fixed.d, RUN, {}, OPTS); runRepairs(fixed.d, "built");
    const a = syncRepairDir(fixed.d, RUN, {}, OPTS).set;
    const failed = partialFolder("repair-cells-notbuilt");
    syncRepairDir(failed.d, RUN, {}, OPTS); runRepairs(failed.d, NOT_BUILT_BLOCKED);
    const b = syncRepairDir(failed.d, RUN, {}, OPTS).set;
    return backAt(a, fixed.tgt.id).status === "done" && a.tasks.find((t) => t.kind === "repair").status === "done"
      && backAt(b, failed.tgt.id).status === "partial" && b.tasks.find((t) => t.kind === "repair").status === "partial";
  }, () => { const { d, tgt } = partialFolder("repair-cells-d");
    syncRepairDir(d, RUN, {}, OPTS); runRepairs(d, NOT_BUILT_BLOCKED);
    const s = syncRepairDir(d, RUN, {}, OPTS).set;
    return { task: backAt(s, tgt.id).status, round: s.tasks.find((t) => t.kind === "repair").status }; });

check("a round that fixed SOME of its rows closes those and only those — the whole point of per-row outcomes: crediting every row it covers because one status word said `done` is the bucket problem one level down",
  () => {
    const { d, tgt } = partialFolder("repair-cells-some", [1, 2]);
    syncRepairDir(d, RUN, {}, OPTS);
    runRepairs(d, (n) => (n === 1 ? "built" : NOT_BUILT_BLOCKED));
    const set = syncRepairDir(d, RUN, {}, OPTS).set;
    const residuals = new Set(backAt(set, tgt.id).rows.map((r) => r.residual).filter(Boolean));
    return backAt(set, tgt.id).status === "partial"
      && residuals.has("closed") && residuals.has("open");
  }, () => { const { d, tgt } = partialFolder("repair-cells-some-d", [1, 2]);
    syncRepairDir(d, RUN, {}, OPTS); runRepairs(d, (n) => (n === 1 ? "built" : NOT_BUILT_BLOCKED));
    return backAt(syncRepairDir(d, RUN, {}, OPTS).set, tgt.id).rows.map((r) => [r.outcome, r.residual]); });

check("the rows a round could not fix open the NEXT round, and the cap does not reset behind them — a row routed as `unverified:…` comes back recorded `not-built:…`, so a cap keyed on the whole cause is a fresh bucket at round 1 and three agents quietly become six",
  () => {
    const { d } = partialFolder("repair-cap-lineage");
    syncRepairDir(d, RUN, {}, OPTS); runRepairs(d, NOT_BUILT_BLOCKED);
    const res = syncRepairDir(d, RUN, {}, OPTS);
    return res.written.length === 1 && res.written[0].repairRound === 2;
  }, () => { const { d } = partialFolder("repair-cap-lineage-d");
    syncRepairDir(d, RUN, {}, OPTS); runRepairs(d, NOT_BUILT_BLOCKED);
    return syncRepairDir(d, RUN, {}, OPTS).written.map((t) => `${t.cause} r${t.repairRound}`); });

check("a deliverable is routed ONCE however many files record it — a `partial` round leaves the row open in its own table AND in the task it came from, whose cell keeps reading `not-built` by design, so routing per source doubles every round and puts two rows with one label in one agent's table",
  () => {
    const { d } = partialFolder("repair-dedupe");
    syncRepairDir(d, RUN, {}, OPTS); runRepairs(d, NOT_BUILT_BLOCKED);
    const r2 = syncRepairDir(d, RUN, {}, OPTS).written[0];
    return r2.rows.length === 1 && r2.covers.length === 1
      && new Set(r2.covers).size === r2.covers.length;
  }, () => { const { d } = partialFolder("repair-dedupe-d");
    syncRepairDir(d, RUN, {}, OPTS); runRepairs(d, NOT_BUILT_BLOCKED);
    const r2 = syncRepairDir(d, RUN, {}, OPTS).written[0];
    return { rows: r2.rows.length, covers: r2.covers }; });

check("a row a round has SETTLED stops being named as NOT BUILT — its own Outcome cell reads `not-built` for good, so the progress block and the index Attention kept printing a deliverable that is on the stand while the gate had correctly stopped counting it; two surfaces disagreeing about one row is how a reader learns to skip the list",
  () => {
    const { d, tgt } = partialFolder("notbuilt-settled", [1, 2]);
    syncRepairDir(d, RUN, {}, OPTS);
    runRepairs(d, (n) => (n === 1 ? "built" : NOT_BUILT_BLOCKED));
    const set = syncRepairDir(d, RUN, {}, OPTS).set;
    const residuals = new Set(backAt(set, tgt.id).rows.map((r) => r.residual));
    const idxLines = renderTaskIndex(set).split("\n").filter((l) => /row \d+ — \*\*not built\*\*/.test(l));
    // Before either round runs, BOTH rows are open and the line has to count two of them on one task — a list
    // that only ever renders `1` cannot say it lost one.
    const { d: d2 } = partialFolder("notbuilt-settled-both", [1, 2]);
    const both = renderProgress(syncTaskDir(d2, RUN, OPTS), d2);
    return residuals.has("closed") && residuals.has("open")
      && /⚠ NOT BUILT — 2 deliverable\(s\) across 1 task\(s\)/.test(both)
      && /⚠ NOT BUILT — 1 deliverable\(s\)/.test(renderProgress(set, d))
      && idxLines.length === 1;
  }, () => { const { d } = partialFolder("notbuilt-settled-d", [1, 2]);
    syncRepairDir(d, RUN, {}, OPTS); runRepairs(d, (n) => (n === 1 ? "built" : NOT_BUILT_BLOCKED));
    const s = syncRepairDir(d, RUN, {}, OPTS).set;
    return { progress: renderProgress(s, d).split("\n").filter((l) => /NOT BUILT/.test(l)),
      attention: renderTaskIndex(s).split("\n").filter((l) => /\*\*not built\*\*/.test(l)) }; });

check("a row the cap has EXHAUSTED fails the gate instead of passing as scheduled work — the last round ran and did not build it, `buildRepairTasks` parks the (page, kind) and writes no fourth, so reading it as an open round exits 0 over a deliverable nobody built and nothing will ever schedule",
  () => {
    const { d, tgt } = partialFolder("cap-exhausted");
    for (let r = 1; r <= REPAIR_ROUND_CAP + 1; r++) {
      const res = syncRepairDir(d, RUN, {}, OPTS);
      if (!res.written.length) break;
      for (const t of res.written) runRepair(d, t.id, NOT_BUILT_BLOCKED);
    }
    const set = syncRepairDir(d, RUN, {}, OPTS).set;
    const items = notBuiltOpenItems(set.tasks);
    return backAt(set, tgt.id).status === "partial"
      && backAt(set, tgt.id).rows.every((r) => r.residual === null || r.residual === undefined)
      && items.length === 1 && items.every((it) => !it.residual);
  }, () => { const { d, tgt } = partialFolder("cap-exhausted-d");
    for (let r = 1; r <= REPAIR_ROUND_CAP + 1; r++) {
      const res = syncRepairDir(d, RUN, {}, OPTS);
      if (!res.written.length) break;
      for (const t of res.written) runRepair(d, t.id, NOT_BUILT_BLOCKED);
    }
    const s = syncRepairDir(d, RUN, {}, OPTS).set;
    return { parent: backAt(s, tgt.id).status, residuals: backAt(s, tgt.id).rows.map((r) => r.residual),
      unrouted: notBuiltOpenItems(s.tasks).filter((it) => !it.residual).length }; });

check("a newly recorded cause gets its OWN round rather than waiting behind another cause's open one — the cap counts the KIND, but an `unverified:fields` round still open must not hold a `not-built:fields` row unroutable while the gate names it and tells the user to run `--route`, which would write nothing",
  () => {
    const openOther = [{ file: "task-repair-round1-main-unverified-fields-x.md", notes: "", malformed: null,
      meta: { id: "rx", status: "todo", origin: "engine", pageKey: "main", kind: "repair",
        cause: "unverified:fields", repairRound: "1", covers: "aaaa" } }];
    const pages = { main: { openRows: [{ deliverable: "Fields — 3 fields", outcome: "not-built",
      status: "not-built — blocked", evidence: "recorded on task-x.md, row 1" }] } };
    const opened = buildRepairTasks(RUN, pages, OPTS, openOther);
    // The KIND still caps: three rounds on this page's field rows is three, whatever each was opened for.
    const capped = [1, 2, 3].map((n) => ({ file: `task-repair-round${n}-main-unverified-fields-${n}.md`, notes: "", malformed: null,
      meta: { id: `rc${n}`, status: "done", origin: "engine", pageKey: "main", kind: "repair",
        cause: "unverified:fields", repairRound: String(n), covers: "aaaa" } }));
    const atCap = buildRepairTasks(RUN, pages, OPTS, capped);
    return opened.tasks.some((t) => t.cause === "not-built:fields") && !opened.pending.length
      && !atCap.tasks.length && atCap.parked.some((p) => p.cause === "not-built:fields");
  }, () => "an open round on one cause must not hold a different cause of the same kind pending");

check("the ⚠ NOT BUILT list names each deliverable ONCE — the verdict was right while the list a human reads carried the same row under the parent file and under every round that had held it",
  () => {
    const { d } = partialFolder("repair-notbuilt-count");
    syncRepairDir(d, RUN, {}, OPTS); runRepairs(d, NOT_BUILT_BLOCKED);
    const set = syncRepairDir(d, RUN, {}, OPTS).set;
    const items = notBuiltRows(set.tasks);
    // Two files hold the row — the task it came from and the round that failed it — and it is ONE deliverable.
    return items.length === 2 && new Set(items.map((x) => x.row.label)).size === 1
      && notBuiltOpenRows(set.tasks)["child:G1"].openRows.length === 1
      && /⚠ NOT BUILT — 1 deliverable\(s\)/.test(renderProgress(set, d));
  }, () => { const { d } = partialFolder("repair-notbuilt-count-d");
    syncRepairDir(d, RUN, {}, OPTS); runRepairs(d, NOT_BUILT_BLOCKED);
    const s = syncRepairDir(d, RUN, {}, OPTS).set;
    return { rows: notBuiltRows(s.tasks).map((x) => x.task.file),
      routed: Object.values(notBuiltOpenRows(s.tasks)).map((p) => p.openRows.length) }; });

check("NOT-BUILT WINS WITHIN A ROUND — `coverKey` hashes the label alone (no `::n`, unlike `rowKeys`), so two rows of one table can share a key; a settled-keys Set alone let a `built` cell close the deliverable its same-label twin recorded `not-built`, and the run reported success over it",
  () => {
    const { d, tgt } = partialFolder("repair-veto");
    syncRepairDir(d, RUN, {}, OPTS);
    const id = repairIds(d)[0];
    startTask(d, id, RUN, { ...OPTS, dispatchToken: `tok-${id}` }, null, AT(nextMin()));
    const f = taskFilePath(d, id);
    // The same deliverable listed twice in one round — one key, two cells.
    const lines = fs.readFileSync(f, "utf8").split("\n");
    const at = lines.findIndex((l) => { const c = l.split(/(?<!\\)\|/); return c.length >= 7 && /^\s*\d+\s*$/.test(c[1]); });
    const twin = lines[at].split(/(?<!\\)\|/); twin[1] = " 2 ";
    lines.splice(at + 1, 0, twin.join("|"));
    const covers = lines.findIndex((l) => l.startsWith("covers:"));
    lines[covers] = `${lines[covers]} ${lines[covers].split(/\s+/)[1]}`;
    let text = lines.join("\n");
    text = setOutcome(setOutcome(text, 1, "built"), 2, NOT_BUILT_BLOCKED);
    fs.writeFileSync(f, text);
    editFrontMatter(d, id, "agentNonce", `tok-${id}`);
    const set = syncRepairDir(d, RUN, {}, OPTS).set;
    return backAt(set, tgt.id).status === "partial"
      && set.tasks.find((t) => t.kind === "repair").status === "partial";
  }, () => "a `built` cell must not close the deliverable its same-label twin recorded not-built");

check("a repair round's COMPUTED status is written back into its front matter — the file the standard calls the record of that task would otherwise say `in-progress` for good while the index, the progress block and the gate all read `done`, and a resumed orchestrator reads the file",
  () => {
    const { d } = partialFolder("repair-writeback");
    syncRepairDir(d, RUN, {}, OPTS); runRepairs(d, "built");
    syncTaskDir(d, RUN, OPTS);
    const onDisk = repairIds(d).map((id) => parseTaskFile(fs.readFileSync(taskFilePath(d, id), "utf8")).meta.status);
    // The body is still the round's own record: the engine writes the one line and re-authors nothing.
    const body = fs.readFileSync(taskFilePath(d, repairIds(d)[0]), "utf8");
    return onDisk.every((s) => s === "done") && /REPAIR — round 1 of at most/.test(body);
  }, () => { const { d } = partialFolder("repair-writeback-d");
    syncRepairDir(d, RUN, {}, OPTS); runRepairs(d, "built"); syncTaskDir(d, RUN, OPTS);
    return repairIds(d).map((id) => parseTaskFile(fs.readFileSync(taskFilePath(d, id), "utf8")).meta.status); });

check("the round that started the chain closes when a LATER round fixes its rows — its own cells still read `not-built` forever, so the latest round to speak about a row is the authority; taking any open mark over any closed one holds the row open for as long as the folder exists",
  () => {
    const { d, tgt } = partialFolder("repair-chain");
    syncRepairDir(d, RUN, {}, OPTS); runRepairs(d, NOT_BUILT_BLOCKED);   // round 1 fails
    const r2 = syncRepairDir(d, RUN, {}, OPTS).written[0];
    runRepair(d, r2.id, "built");                                         // round 2 fixes it
    const set = syncRepairDir(d, RUN, {}, OPTS).set;
    const rounds = set.tasks.filter((t) => t.kind === "repair").map((t) => t.status);
    return backAt(set, tgt.id).status === "done" && rounds.every((s) => s === "done");
  }, () => { const { d, tgt } = partialFolder("repair-chain-d");
    syncRepairDir(d, RUN, {}, OPTS); runRepairs(d, NOT_BUILT_BLOCKED);
    const r2 = syncRepairDir(d, RUN, {}, OPTS).written[0];
    runRepair(d, r2.id, "built");
    const s = syncRepairDir(d, RUN, {}, OPTS).set;
    return { task: backAt(s, tgt.id).status, rounds: s.tasks.filter((t) => t.kind === "repair").map((t) => `${t.cause} r${t.repairRound} ${t.status}`) }; });

check("a round still being worked holds its cause PENDING — some cells filled and the rest blank is a sub-agent mid-task, and opening the next round over it would put a second agent on rows the first has not reached",
  () => {
    const { d } = partialFolder("repair-midflight", [1, 2]);
    syncRepairDir(d, RUN, {}, OPTS);
    const id = repairIds(d)[0];
    startTask(d, id, RUN, { ...OPTS, dispatchToken: `tok-${id}` }, null, AT(nextMin()));
    const f = taskFilePath(d, id);
    fs.writeFileSync(f, setOutcome(fs.readFileSync(f, "utf8"), 1, "built"));   // row 2 still blank
    editFrontMatter(d, id, "agentNonce", `tok-${id}`);
    const res = syncRepairDir(d, RUN, {}, OPTS);
    return res.written.length === 0 && res.set.tasks.find((t) => t.kind === "repair").status === "in-progress";
  }, () => { const { d } = partialFolder("repair-midflight-d", [1, 2]);
    syncRepairDir(d, RUN, {}, OPTS);
    const id = repairIds(d)[0];
    startTask(d, id, RUN, { ...OPTS, dispatchToken: `tok-${id}` }, null, AT(nextMin()));
    const f = taskFilePath(d, id);
    fs.writeFileSync(f, setOutcome(fs.readFileSync(f, "utf8"), 1, "built"));
    const r = syncRepairDir(d, RUN, {}, OPTS);
    return { written: r.written.length, round: r.set.tasks.find((t) => t.kind === "repair").status }; });

check("BACKWARD COMPATIBLE: a repair file with a FOUR-COLUMN table — written before the `Outcome` column existed — closes on its status word, because a header carrying no `Outcome` cell yields no marks at all rather than a row read out of the wrong column",
  () => {
    const { d, tgt } = partialFolder("repair-4col");
    syncRepairDir(d, RUN, {}, OPTS);
    const id = repairIds(d)[0];
    const f = taskFilePath(d, id);
    // A four-column table: the `Outcome` column absent from the header and from every row.
    fs.writeFileSync(f, fs.readFileSync(f, "utf8").split("\n").map((l) => {
      const c = l.split(/(?<!\\)\|/);
      return c.length >= 7 && (/^\s*\d+\s*$/.test(c[1]) || c[1].trim() === "#" || c[1].trim() === "---")
        ? [...c.slice(0, 5), ""].join("|") : l;
    }).join("\n"));
    runTask(d, id, RUN, OPTS, nextMin());          // status word only — there is no column to fill
    const set = syncRepairDir(d, RUN, {}, OPTS).set;
    return backAt(set, tgt.id).status === "done" && set.tasks.find((t) => t.kind === "repair").status === "done";
  }, () => "a four-column repair file must keep closing exactly as it did before");

check("BACKWARD COMPATIBLE: a repair file with nothing in its cells still closes on the status word it recorded — every folder written before the `Outcome` column existed is in exactly that shape, and reading them all as `partial` on the first re-slice would strand a finished run",
  () => {
    const { d, tgt } = partialFolder("repair-legacy");
    syncRepairDir(d, RUN, {}, OPTS);
    closeRepairs(d);                                  // status word only, no cells filled
    const set = syncRepairDir(d, RUN, {}, OPTS).set;
    return backAt(set, tgt.id).status === "done" && set.tasks.find((t) => t.kind === "repair").status === "done";
  }, () => { const { d, tgt } = partialFolder("repair-legacy-d");
    syncRepairDir(d, RUN, {}, OPTS); closeRepairs(d);
    return backAt(syncRepairDir(d, RUN, {}, OPTS).set, tgt.id).status; });

console.log("\n===== a residual credits the ROWS IT COVERS, never the cause bucket =====");

// The fixture above, carried one step further: the residual is routed, dispatched and CLOSED, so the task reads
// `done`. Everything below then changes the task AFTER that, which is the case the earlier checks never made.
const closedResidual = (name) => {
  const { d, tgt } = partialFolder(name);
  syncRepairDir(d, RUN, {}, OPTS);
  closeRepairs(d);
  return { d, tgt };
};

check("a repair task records WHICH ROWS it covers — a cause is a bucket (`causeOf` falls through to `other` for any label the six kind patterns miss, so most of a page shares one), and a bucket cannot say whose work closed",
  () => {
    const { d } = partialFolder("covers-recorded");
    const t = syncRepairDir(d, RUN, {}, OPTS).written[0];
    const meta = parseTaskFile(fs.readFileSync(path.join(d, t.file), "utf8")).meta;
    return (t.covers || []).length === 1 && meta.covers === t.covers.join(" ");
  }, () => { const { d } = partialFolder("covers-recorded-d");
    const t = syncRepairDir(d, RUN, {}, OPTS).written[0];
    return { covers: t.covers, onDisk: parseTaskFile(fs.readFileSync(path.join(d, t.file), "utf8")).meta.covers }; });

check("a repair task's rows are READ, and `covers` is carried beside them — the rows are what say which of them this round fixed, and the front-matter list is what says which rows it was opened over at all",
  () => {
    const { d } = closedResidual("covers-frontmatter");
    const rep = syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.kind === "repair");
    return (rep.rows || []).length === 1 && (rep.covers || []).length === 1;
  }, () => { const { d } = closedResidual("covers-frontmatter-d");
    const rep = syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.kind === "repair");
    return { rows: rep.rows, covers: rep.covers }; });

check("a SECOND row recorded not-built after the first residual closed is NOT credited by it — same page, same cause bucket, a repair task that never listed it. Crediting it is this ticket's own failure mode: the run would report success over a deliverable the build agent wrote down as not built",
  () => {
    const { d, tgt } = closedResidual("covers-second-row");
    const fp = taskFilePath(d, tgt.id);
    fs.writeFileSync(fp, setOutcome(fs.readFileSync(fp, "utf8"), 2, "not-built — blocked"));
    const after = syncTaskDir(d, RUN, OPTS);
    const back = after.tasks.find((t) => t.id === tgt.id);
    const rows = notBuiltRows(after.tasks);
    const unrouted = rows.filter((r) => !r.residual);
    // Row 1 is still `not-built` in its cell and still listed — it is CREDITED, which is a different fact.
    return back.status === "partial" && rows.length === 2
      && rows.find((r) => r.n === 1).residual === "closed"
      && unrouted.length === 1 && unrouted[0].n === 2;
  }, () => { const { d, tgt } = closedResidual("covers-second-row-d");
    const fp = taskFilePath(d, tgt.id);
    fs.writeFileSync(fp, setOutcome(fs.readFileSync(fp, "utf8"), 2, "not-built — blocked"));
    const a = syncTaskDir(d, RUN, OPTS);
    return { status: a.tasks.find((t) => t.id === tgt.id).status,
      rows: notBuiltRows(a.tasks).map((r) => `${r.n}:${r.residual}`) }; });

check("that second row opens a NEW repair round rather than sitting uncredited — the prior round closed `done`, which is an ATTEMPT, so the cause advances to round 2 and the cap stays the terminal",
  () => {
    const { d, tgt } = closedResidual("covers-second-round");
    const fp = taskFilePath(d, tgt.id);
    fs.writeFileSync(fp, setOutcome(fs.readFileSync(fp, "utf8"), 2, "not-built — blocked"));
    const next = syncRepairDir(d, RUN, {}, OPTS);
    return next.written.length === 1 && next.written[0].repairRound === 2
      && next.written[0].cause.startsWith("not-built:");
  }, () => { const { d, tgt } = closedResidual("covers-second-round-d");
    const fp = taskFilePath(d, tgt.id);
    fs.writeFileSync(fp, setOutcome(fs.readFileSync(fp, "utf8"), 2, "not-built — blocked"));
    const n = syncRepairDir(d, RUN, {}, OPTS);
    return n.written.map((t) => `${t.cause} r${t.repairRound}`); });

check("a row BLANKED after the residual closed is not credited either — an unaccounted row is the weaker claim of the two (nobody said anything about it at all), so a bucket that credits it is the same defect with less evidence",
  () => {
    const { d, tgt } = closedResidual("covers-blanked");
    const fp = taskFilePath(d, tgt.id);
    fs.writeFileSync(fp, setOutcome(fs.readFileSync(fp, "utf8"), 2, "—"));
    const after = syncTaskDir(d, RUN, OPTS);
    const unrouted = notBuiltRows(after.tasks).filter((r) => !r.residual);
    return after.tasks.find((t) => t.id === tgt.id).status === "partial"
      && unrouted.length === 1 && unrouted[0].n === 2 && unrouted[0].cause === null;
  }, () => { const { d, tgt } = closedResidual("covers-blanked-d");
    const fp = taskFilePath(d, tgt.id);
    fs.writeFileSync(fp, setOutcome(fs.readFileSync(fp, "utf8"), 2, "—"));
    const a = syncTaskDir(d, RUN, OPTS);
    return { status: a.tasks.find((t) => t.id === tgt.id).status,
      rows: notBuiltRows(a.tasks).map((r) => `${r.n}:${r.cause}/${r.residual}`) }; });

check("a RE-SLICE after the residual closed keeps the credit on the row it was earned on — `covers` is a label hash, so it survives the task ids and the row numbering being re-derived, which is the whole reason the folder is re-read rather than remembered",
  () => {
    const { d, tgt } = closedResidual("covers-reslice");
    const one = syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.id === tgt.id);
    const two = syncTaskDir(d, RUN, OPTS).tasks.find((t) => t.id === tgt.id);
    return one.status === "done" && two.status === "done"
      && two.rows[0].residual === "closed" && notBuiltOpenItems(syncTaskDir(d, RUN, OPTS).tasks).length === 0;
  }, () => { const { d, tgt } = closedResidual("covers-reslice-d");
    const t = syncTaskDir(d, RUN, OPTS).tasks.find((x) => x.id === tgt.id);
    return { status: t.status, residuals: t.rows.map((r) => r.residual) }; });

check("the residual's repair file does NOT tell its sub-agent the rows came from `--verify` — one says the verifier could not find it, the other says the previous agent wrote down that they did not build it, and those call for different first moves",
  () => {
    const { d } = partialFolder("residual-blockquote");
    const t = syncRepairDir(d, RUN, {}, OPTS).written[0];
    const text = fs.readFileSync(path.join(d, t.file), "utf8");
    return /recorded as NOT BUILT by the agent that built the page/.test(text)
      && !/left OPEN by a `--verify`/.test(text);
  }, () => { const { d } = partialFolder("residual-blockquote-d");
    return fs.readFileSync(path.join(d, syncRepairDir(d, RUN, {}, OPTS).written[0].file), "utf8"); });

check("when BOTH legs hold one deliverable the build agent's record wins — a row nobody built is usually also one `--verify` cannot find, and the verifier's copy says only that nothing is on the stand while the agent's names a cause and points at its `## Notes`",
  () => {
    const { d, tgt } = partialFolder("lineage-overlap");
    // The verify leg reports the SAME deliverable the task recorded not built.
    const label = tgt.rows[0].label;
    const pages = { [tgt.pageKey]: { openRows: [{ deliverable: label, outcome: "missing",
      status: "MISSING on the stand", evidence: "get-page did not return it" }] } };
    const res = syncRepairDir(d, RUN, pages, OPTS);
    const text = fs.readFileSync(path.join(d, res.written[0].file), "utf8");
    return res.written.length === 1 && res.written[0].rows.length === 1
      && String(res.written[0].cause).startsWith("not-built:")
      && /recorded as NOT BUILT by the agent that built the page/.test(text)
      && !/left OPEN by a `--verify`/.test(text);
  }, () => { const { d, tgt } = partialFolder("lineage-overlap-d");
    const pages = { [tgt.pageKey]: { openRows: [{ deliverable: tgt.rows[0].label, outcome: "missing",
      status: "MISSING on the stand", evidence: "get-page did not return it" }] } };
    const res = syncRepairDir(d, RUN, pages, OPTS);
    return res.written.map((t) => `${t.cause} rows=${t.rows.length} recorded=${t.rows[0]?.status}`); });

check("a `--verify` repair file still says its rows came from `--verify` — the branch must not rewrite the machine-checked lineage, which is the one this sentence was written for",
  () => {
    const dir = tmp("verify-blockquote");
    const t = syncRepairDir(dir, RUN, VERIFY_PAGES, OPTS).written[0];
    const text = fs.readFileSync(path.join(dir, t.file), "utf8");
    return /left OPEN by a `--verify`/.test(text) && !/recorded as NOT BUILT/.test(text);
  }, () => { const dir = tmp("verify-blockquote-d");
    return fs.readFileSync(path.join(dir, syncRepairDir(dir, RUN, VERIFY_PAGES, OPTS).written[0].file), "utf8"); });
/* ================================================================================================
   THE MIGRATION RESULT REPORT. An orchestrated run must not end on two files that disagree: the
   `--verify` table ("2 machine row(s) not confirmed") and `build-tasks/index.md` (5 open, 3 partial, three handlers
   recorded NOT BUILT), with the agent presenting the first. `--verify --built <f> --tasks <dir>` prints ONE report
   computed from both, and its verdict is their conjunction. Measured on the Applicants run, 2026-09-17.
   ================================================================================================ */
console.log("\n===== the migration result report — one artifact, computed from the ledger AND the built pages =====");
{
  const cliR = (args, manifest) => spawnSync(process.execPath, [MIGRATE, "-", ...args], { input: JSON.stringify(manifest), encoding: "utf8" });
  const closeAll = (dir) => {
    for (;;) {
      const tasks = readTaskDir(dir);
      const next = tasks.find((t) => t.status === "todo" && (t.dependsOn || []).every((d) => {
        const dep = tasks.find((x) => x.id === d);
        return !dep || dep.status === "done" || dep.status === "n/a";
      }));
      if (!next) break;
      const started = cliR(["--tasks", dir, "--start", next.id], MANIFEST);
      editFrontMatter(dir, next.id, "status", "done");
      editFrontMatter(dir, next.id, "agentNonce", /DISPATCH TOKEN for `[^`]+`: (\S+)/.exec(started.stdout || "")?.[1] || "");
      cliR(["--tasks", dir], MANIFEST);
    }
  };
  const base = tmp("result-report");
  const dir = path.join(base, "build-tasks");
  cliR(["--tasks", dir], MANIFEST);
  closeAll(dir);
  // THE INCIDENT'S SHAPE: every task dispatched and closed, one of them with a handler-like row the agent recorded
  // as NOT BUILT because it needs a decision. The built payload reports the pages absent, so the machine table is
  // short too — the report has to say BOTH, and say the not-built one first.
  // A PLAN task, not the engine's reference cache (also ≥2 rows, first in the folder, and deliberately absent
  // from the report).
  // The small fixture collapses to ONE whole-run task (page key `run`) plus the read-only reference cache, which
  // is also keyed `run` but writes nothing — the writer is the plan task.
  const victim = readTaskDir(dir).filter((t) => t.writesTo && t.rows.length >= 1).sort((a, b) => b.rows.length - a.rows.length)[0];
  const rowN = Math.min(2, victim.rows.length);
  const vf = path.join(dir, victim.file);
  fs.writeFileSync(vf, setOutcome(allBuilt(fs.readFileSync(vf, "utf8")), rowN, "not-built — needs-decision"));
  const built = path.join(base, "built.json");
  fs.writeFileSync(built, JSON.stringify({ pages: { main: false } }));
  const run = cliR(["--verify", "--built", built, "--tasks", dir], MANIFEST);
  const out = run.stdout || "";

  check("CLI: `--verify --built --tasks` prints the MIGRATION RESULT REPORT and nothing else — the plan-vs-built table is neither appended nor written beside it, because nothing reads it and the report already carries what it says",
    () => out.startsWith("# Migration result") && /\*\*Verdict:\*\* ⛔ \*\*NOT COMPLETE\*\*/.test(out)
      && !/Plan-vs-Done — VERIFIED against the built page/.test(out) && !/## Appendix/.test(out)
      && /## \d+\. Task details/.test(out),
    () => out.slice(0, 600));
  check("CLI: the verdict line names EVERY reason in the order a person acts on them — the plan item recorded NOT BUILT (needs a decision) BEFORE the machine rows the payload could not confirm; the word is `plan item`, never `deliverable`",
    () => { const v = out.split("\n").find((l) => l.startsWith("**Verdict:**")) || "";
      // The verify leg WRITES a repair round into the folder, so the ledger the report reads now also holds that
      // round's queued tasks — open work, counted as such in the same line.
      return /1 plan item recorded NOT BUILT \(1 needs a decision\)/.test(v) && /tasks? not closed \(◐ partial 1/.test(v)
        && /machine-checked plan items? MISSING/.test(v) && v.indexOf("NOT BUILT") < v.indexOf("MISSING") && !/deliverable/i.test(out.slice(0, out.indexOf("## 1."))); },
    () => out.split("\n").find((l) => l.startsWith("**Verdict:**")));
  check("CLI: section 1 names the not-built plan item, WHICH decision is needed (or that the agent did not state it), and where it was recorded — the fact the old table never carried",
    () => { const s1 = out.slice(out.indexOf("## 1."), out.indexOf("## 2."));
      return /## 1\. Needs a decision \(1\)/.test(s1) && s1.includes(victim.rows[rowN - 1].label)
        && /did not state the question/.test(s1) && s1.includes(`](${victim.file}), row ${rowN}`); },
    () => out.slice(out.indexOf("## 1."), out.indexOf("## 2.")));
  check("CLI: the Tasks section is the ledger with HOW each task was verified — Confirmed / To confirm manually columns, the partial task naming the plan item it did not build; no dispatch column, no reference-cache row",
    () => { const s4 = out.slice(out.search(/## \d+\. Tasks \(/), out.search(/## \d+\. Task details/));
      const line = s4.split("\n").find((l) => l.includes(`](${victim.file})`)) || "";
      return /\| Step \| Task \| Page \| Status \| Confirmed \| To confirm manually \| Not built \|/.test(s4)
        && /◐ partial/.test(line) && line.includes(victim.rows[rowN - 1].label) && /needs a decision/.test(line)
        && !/Dispatch/i.test(s4) && !/Reference cache/.test(s4) && /Form page|Child page|List page|Whole run/.test(line) && !/\| `?(main|run)`? \|/.test(line); },
    () => out.slice(out.search(/## \d+\. Tasks \(/), out.search(/## \d+\. Task details/)).split("\n").slice(0, 8));
  check("CLI: the summary carries the counts a reader takes away — tasks by status, open questions, one confirmed count, the manual remainder — and nothing about dispatch",
    () => /\| Tasks \| \d+ — ✅ done \d+ · ◐ partial 1( · ☐ queued \d+)? \|/.test(out) && /\| Open questions \(plan items recorded NOT BUILT, no decision yet\) \| 1 \|/.test(out)
      && /\| Plan items confirmed \(on the built page, or by review\) \| \d+\/\d+ \|/.test(out)
      && /\| Plan items to confirm manually \| \d+ \|/.test(out) && !/Dispatch/i.test(out.slice(0, out.indexOf("## Appendix"))),
    () => out.slice(out.indexOf("## Summary"), out.indexOf("## 1.")));
  check("CLI: with `--out` the report is the ONLY file written — no plan-vs-built.md beside it and no link to one (nothing reads that file, so it is a second artifact to reconcile for nothing)",
    () => { const outFile = path.join(base, "report-split.md");
      cliR(["--verify", "--built", built, "--tasks", dir, "--out", outFile], MANIFEST);
      const rep = fs.readFileSync(outFile, "utf8");
      return rep.startsWith("# Migration result") && !fs.existsSync(path.join(base, "plan-vs-built.md")) && !/plan-vs-built\.md/.test(rep) && !/## Appendix/.test(rep); },
    () => fs.readdirSync(base));
  check("CLI: exit 2 with a stderr line that names the RUN as not complete and points at the report — an orchestrator reading stderr alone cannot mistake this for a finished run",
    () => run.status === 2 && /⛔ RUN NOT COMPLETE — .*recorded NOT BUILT/.test(run.stderr || "") && /migration result report/.test(run.stderr || ""),
    () => ({ status: run.status, stderr: (run.stderr || "").slice(0, 700) }));
  check("CLI: `--out` names the artifact a migration result report and tells the caller to present IT — not the index, not the table, not a hand-written summary",
    () => { const outFile = path.join(base, "report.md");
      const r = cliR(["--verify", "--built", built, "--tasks", dir, "--out", outFile], MANIFEST);
      return /wrote migration result report to/.test(r.stdout || "") && /PRESENT IT VERBATIM/.test(r.stdout || "")
        && /do not present `build-tasks\/index\.md`/.test(r.stdout || "")
        && fs.readFileSync(outFile, "utf8").startsWith("# Migration result"); },
    () => cliR(["--verify", "--built", built, "--tasks", dir, "--out", path.join(base, "report2.md")], MANIFEST).stdout);
  check("CLI (unchanged): a plain `--verify` with NO task folder still prints the bare plan-vs-built table — the report is the orchestrated run's closing artifact, and a run with no ledger has nothing to add to the table",
    () => { const r = cliR(["--verify", "--built", built], MANIFEST); return (r.stdout || "").startsWith("### ✅ Plan-vs-Done") && !/# Migration result/.test(r.stdout || ""); },
    () => cliR(["--verify", "--built", built], MANIFEST).stdout?.slice(0, 200));
  // The machine rows run through resolveVk on EVERY --verify, so a plain --verify
  // (no --tasks) whose payload carries the new optional fields (handlers / viewModelConfig) must still emit the
  // legacy plan-vs-built table, not the migration result report — the report is the orchestrated close artifact only.
  {
    const pvBase = tmp("plain-verify-newfields"); const pvBuilt = path.join(pvBase, "built.json");
    fs.mkdirSync(pvBase, { recursive: true });
    fs.writeFileSync(pvBuilt, JSON.stringify({ pages: { main: { viewConfig: { items: [{ type: "crt.Input", name: "AField", control: "$A" }] },
      packageName: "UsrX", parentSchemaName: "FormPageTemplate", entitySchemaName: MANIFEST.entity,
      schemaUId: "44444444-4444-4444-8444-444444444444", schemaName: "UsrDemo_FormPage",
      handlers: "[{ request: 'crt.SaveRecordRequest', handler: (r,n)=>n }]", viewModelConfig: { attributes: { A: {} } } } } }));
    const pvR = cliR(["--verify", "--built", pvBuilt], MANIFEST);
    check("CLI: plain `--verify` (no --tasks) with a payload carrying `handlers`/`viewModelConfig` still prints the legacy plan-vs-built table, never the migration result report",
      () => (pvR.stdout || "").startsWith("### ✅ Plan-vs-Done") && !/# Migration result/.test(pvR.stdout || ""),
      () => ({ status: pvR.status, head: (pvR.stdout || "").slice(0, 160), err: (pvR.stderr || "").slice(0, 160) }));
  }

  // an UNREADABLE ledger (a corrupt frozen split) must never read COMPLETE. The
  // fallback set carries `refused`, so `renderFinalReport` pushes a verdict reason and the CLI exits 2 naming the
  // folder — the precise false-green (COMPLETE over a ledger that was never read) this PR targets.
  {
    const dBad = path.join(tmp("result-report-refused"), "build-tasks");
    cliR(["--tasks", dBad], MANIFEST);                                    // freeze a valid split first
    fs.writeFileSync(path.join(dBad, SPLIT_FILE), "not valid JSON {{{");  // then corrupt it
    const rBad = cliR(["--verify", "--built", built, "--tasks", dBad], MANIFEST);
    check("CLI: a corrupt frozen split (unreadable ledger) is NOT COMPLETE — the report names the ledger as unreadable and the CLI exits 2, never printing COMPLETE over a folder it could not read",
      () => rBad.status === 2 && (rBad.stdout || "").startsWith("# Migration result")
        && /the task ledger could not be read/.test(rBad.stdout || "") && /⛔ \*\*NOT COMPLETE\*\*/.test(rBad.stdout || "")
        && /RUN NOT COMPLETE/.test(rBad.stderr || ""),
      () => ({ status: rBad.status, head: (rBad.stdout || "").slice(0, 400), stderr: (rBad.stderr || "").slice(0, 200) }));
  }

  // the LEDGER LEG reaches the CLI verdict on its own. A fresh folder (every task
  // ☐ queued, none dispatched) contributes a `☐ queued N` reason that the machine/verify leg CANNOT produce (that
  // leg emits MISSING / not-confirmed), so exit 2 here is NOT attributable to `verifyIncomplete` alone. The clean
  // conjunction in isolation — a GREEN machine leg + an open ledger ⇒ ONLY the ledger reason — is the `openRep`
  // unit below; a fully green `--built` for this 4-page fixture would need ~14 judged evidence records rebuilt by hand.
  {
    const dQ = path.join(tmp("result-report-queued"), "build-tasks");
    cliR(["--tasks", dQ], MANIFEST);   // sync only — every task todo, nothing started
    const rQ = cliR(["--verify", "--built", built, "--tasks", dQ], MANIFEST);
    const vQ = (rQ.stdout || "").split("\n").find((l) => l.startsWith("**Verdict:**")) || "";
    check("CLI: a run over a ledger of ☐ queued tasks carries a `☐ queued N` reason — a LEDGER-only fact the verify leg never emits — into BOTH the report verdict and stderr, at exit 2; so the CLI gate reads the ledger leg, not `verifyIncomplete` alone",
      () => rQ.status === 2 && /☐ queued \d+/.test(vQ) && /RUN NOT COMPLETE/.test(rQ.stderr || "")
        && /☐ queued \d+/.test(rQ.stderr || "") && / todo of /.test(rQ.stderr || ""),
      () => ({ status: rQ.status, verdict: vQ, stderr: (rQ.stderr || "").slice(0, 300) }));
  }

  // THE HEADLINE DEFECT, in isolation: a machine table with NOTHING open over a ledger that still holds work. The
  // old verdict read ✅ here. The report's does not, and says why.
  const greenVerify = { markdown: "### ✅ Plan-vs-Done — VERIFIED against the built page\n\n(all rows ✅)", missing: 0, unverified: 0, complete: true, pages: {},
    rows: [{ n: 1, pageKey: "main", group: "Pages", deliverable: "Form page", status: "✅ Done", evidence: "built", outcome: "ok", kind: "machine", vkType: "formpage", owner: "builder" },
      { n: 2, pageKey: "main", group: "Form — Custom methods", deliverable: "Handler — `init`", status: "☐ confirm on-stand", evidence: "not derivable", outcome: "skip", kind: "confirm", vkType: null, owner: "builder" }] };
  const dOpen = path.join(tmp("result-report-open"), "build-tasks");
  syncTaskDir(dOpen, RUN, OPTS);   // every task `todo`, nothing dispatched
  const openSet = readMergedTaskDir(dOpen, RUN, OPTS);
  const openRep = renderFinalReport({ result: RUN, verifyRes: greenVerify, set: openSet, dir: dOpen });
  check("renderFinalReport: a GREEN machine table over a ledger of queued tasks is NOT COMPLETE — the verdict is the conjunction, and the reason names the open tasks (the old `--verify` verdict read ✅ here)",
    () => openRep.complete === false && openRep.reasons.some((r) => /task(s)? not closed \(☐ queued \d+\)/.test(r))
      && /⛔ \*\*NOT COMPLETE\*\*/.test(openRep.markdown) && !openRep.reasons.some((r) => /MISSING|not confirmed/.test(r)),
    () => openRep.reasons);
  check("renderFinalReport: the confirm-on-stand row is counted as 'to confirm manually' in the summary and named per task in the details section — neither hidden nor counted as a failure; the reference-cache task is not listed",
    () => /\| Plan items to confirm manually \| 1 \|/.test(openRep.markdown) && /## 4\. Task details/.test(openRep.markdown)
      // The task is still queued, so its rows have no outcome yet — the details say THAT, not "check by hand".
      && /\| \d+ \| .+ \| — \| — no outcome recorded yet \(task ☐ todo\) \|/.test(openRep.markdown)
      && !/Reference cache/.test(openRep.markdown) && !/\| Dispatch/.test(openRep.markdown),
    () => openRep.markdown.slice(openRep.markdown.indexOf("## 4.")));
  const dNone = tmp("result-report-empty");
  const doneRep = renderFinalReport({ result: RUN, verifyRes: greenVerify, set: { tasks: [], planVersion: RUN.planVersion }, dir: dNone });
  check("renderFinalReport: with every task closed, nothing recorded not built and every machine row present, the verdict IS ✅ COMPLETE — and it still names how many plan items need a check by hand, so ✅ never reads as 'nothing left to look at'",
    () => doneRep.complete === true && /✅ \*\*COMPLETE\*\*/.test(doneRep.markdown) && /1 plan item still to confirm manually on the stand/.test(doneRep.markdown),
    () => ({ complete: doneRep.complete, reasons: doneRep.reasons, head: doneRep.markdown.split("\n")[2] }));
  // RC-9: the combined gate can PASS on a REAL, non-empty closed ledger — every task done,
  // its rows built, a green machine table, a gate-clean run ⇒ complete:true / ✅ COMPLETE with no gate/dispatch/n-a
  // reason (the pass path every CLI golden's exit-2 assertion left unproven).
  const closedSet = { planVersion: RUN.planVersion, tasks: [
    { id: "c-a", file: "c-a.md", group: "Form build", pageKey: "main", status: "done", notes: "", rows: [{ label: "Form page", outcomeKind: "built", outcome: "built" }] },
    { id: "c-b", file: "c-b.md", group: "Child build", pageKey: "child:C1", status: "done", notes: "", rows: [{ label: "Fields — 1 expected", outcomeKind: "built", outcome: "built" }] },
  ] };
  const passRep = renderFinalReport({ result: RUN, verifyRes: greenVerify, set: closedSet, dir: tmp("result-report-pass") });
  check("renderFinalReport (RC-9): a NON-empty ledger of closed tasks + a green machine table + a gate-clean run PASSES — complete:true, ✅ COMPLETE, zero verdict reasons (the pass path the CLI goldens never exercised)",
    () => passRep.complete === true && /✅ \*\*COMPLETE\*\*/.test(passRep.markdown) && passRep.reasons.length === 0,
    () => ({ complete: passRep.complete, reasons: passRep.reasons }));

  // TWO WAYS A CLOSED TASK CAN CARRY A WORD NOTHING STANDS BEHIND, neither of which the machine leg can see. The
  // set they are measured against is `closedSet` above, which the check before this one proves reads ✅ COMPLETE.
  // `DRIFT` is the real thing, merged out of a folder recorded against SET's rows and re-read against SET3's.
  const driftedSet = { planVersion: RUN.planVersion, tasks: [...closedSet.tasks, DRIFT] };
  const driftRep = renderFinalReport({ result: RUN, verifyRes: greenVerify, set: driftedSet, dir: tmp("result-report-drift") });
  check("renderFinalReport: a task closed `done` whose ROWS DRIFTED since its cells were recorded blocks the verdict and is named — the cells were filled against deliverables the plan has since dropped, so no mark re-attaches and the collector sees nothing owed",
    // Its drift and its closure both have to be real, or the reason is asserted over a task the guard never sees.
    () => DRIFT.drifted === true && DRIFT.status === "done" && driftRep.complete === false
      && driftRep.reasons.some((r) => /deliverables CHANGED since its cells were recorded/.test(r)
        && r.includes(DRIFT.file)),
    () => ({ complete: driftRep.complete, reasons: driftRep.reasons }));
  const unreadSet = { planVersion: RUN.planVersion, tasks: [...closedSet.tasks,
    { id: "o-x", file: "o-x.md", group: "Hand-written", pageKey: "main", status: "done", notes: "", origin: "orchestrator", rows: [] }] };
  const unreadRep = renderFinalReport({ result: RUN, verifyRes: greenVerify, set: unreadSet, dir: tmp("result-report-unread") });
  check("renderFinalReport: a task closed `done` whose `## Deliverables` table could not be read blocks the verdict and is named — its status is derived from nothing at all, and no other leg of the verdict looks at the ledger's shape",
    () => unreadRep.complete === false
      && unreadRep.reasons.some((r) => /could not be read/.test(r) && /o-x\.md/.test(r)),
    () => ({ complete: unreadRep.complete, reasons: unreadRep.reasons }));

  // A task closed `n/a` with a plan row left unaccounted (no outcomeKind, not a boundary)
  // must NOT let the run read COMPLETE — the same self-assertion guard the row-level n-a boundary already carries.
  const naSet = { planVersion: RUN.planVersion, tasks: [
    { id: "na-x", file: "na-x.md", group: "Custom methods", pageKey: "main", status: "n/a", notes: "", rows: [{ label: "Handler — `onSaved`", outcome: "" }] },
  ] };
  const naRep = renderFinalReport({ result: RUN, verifyRes: greenVerify, set: naSet, dir: tmp("result-report-na") });
  check("renderFinalReport (RC-7): a task waved off `n/a` with an unaccounted plan row is NOT COMPLETE — the verdict names it, so a sub-agent cannot close a task n/a to bypass the conjunction gate",
    () => naRep.complete === false && /⛔ \*\*NOT COMPLETE\*\*/.test(naRep.markdown)
      && naRep.reasons.some((r) => /closed n\/a with no recorded decision/.test(r)),
    () => ({ complete: naRep.complete, reasons: naRep.reasons }));

  // a COLLAPSED whole-run task (pageKey "run") whose rows now carry their OWN
  // page must not bleed state across identically-labeled rows on different pages — `Handler — init` not-built on
  // main and built on child:C1. A label-only fallback would mark BOTH not-built.
  const collapseSet = { planVersion: RUN.planVersion, tasks: [
    { id: "whole", file: "whole.md", group: "Whole run", pageKey: "run", status: "partial", notes: "", rows: [
      { label: "Handler — `init`", pageKey: "main", outcomeKind: "not-built", outcomeCause: "needs-decision", outcome: "not-built — needs-decision", outcomeReason: "" },
      { label: "Handler — `init`", pageKey: "child:C1", outcomeKind: "built", outcome: "built", outcomeReason: "" },
    ] },
  ] };
  const vCollapse = { markdown: "", missing: 0, unverified: 0, complete: true, pages: {},
    rows: [{ n: 1, pageKey: "child:C1", group: "Form — Custom methods", deliverable: "Handler — `init`", status: "✅ Done", evidence: "a handler defines `init`", outcome: "ok", kind: "machine", vkType: "handler", owner: "builder" }] };
  const repCollapse = renderFinalReport({ result: RUN, verifyRes: vCollapse, set: collapseSet, dir: tmp("result-report-collapse") });
  const tasksSecC = repCollapse.markdown.slice(repCollapse.markdown.search(/## \d+\. Tasks \(/), repCollapse.markdown.search(/## \d+\. Task details/));
  const lineW = tasksSecC.split("\n").find((l) => l.includes("](whole.md)")) || "";
  check("(collapsed run): a whole-run task's rows keep their OWN page — `Handler — init` not-built on main + built on child:C1 do NOT cross-attribute; the built copy counts Confirmed 1/1 and `needs a decision` appears exactly once (row-page join, no label-only bleed)",
    () => repCollapse.counts.openNotBuilt === 1 && /\| 1\/1 \|/.test(lineW) && (lineW.match(/needs a decision/g) || []).length === 1,
    () => ({ openNotBuilt: repCollapse.counts.openNotBuilt, lineW }));
  const sec1C = repCollapse.markdown.slice(repCollapse.markdown.indexOf("## 1."), repCollapse.markdown.indexOf("## 2."));
  const detC = repCollapse.markdown.slice(repCollapse.markdown.search(/## \d+\. Task details/));
  check("(collapsed run, sections): section 1's Page column shows the not-built row's OWN page (`Form page`, from its pageKey), and Task details lists the whole task with just the main row's decision — the built child:C1 copy is settled, not listed and not bled",
    () => /\| Form page \| Handler/.test(sec1C) && !/\| Whole run \| Handler/.test(sec1C)
      && /## \d+\. Task details/.test(detC) && detC.includes("](whole.md)")
      && (detC.match(/Handler — /g) || []).length === 1,
    () => ({ sec1: sec1C, det: detC.slice(0, 500) }));
  // readDecisions must accept the D-heading grammar variants an agent may write —
  // dash, colon, space, dot after the id — so boundaries citing those decisions are backed, not falsely unbacked.
  {
    const baseG = tmp("result-report-grammar"); fs.mkdirSync(baseG, { recursive: true });
    fs.writeFileSync(path.join(baseG, "decisions.md"), "# Decisions\n\n## D7 — dash title\n\n### D8: colon title\n\n#### D9 space title\n\n## D10. dot title\n");
    const dG = path.join(baseG, "build-tasks");
    const bnd = (id, ref) => ({ id, file: `${id}.md`, group: "Repair", pageKey: "main", status: "partial", kind: "repair", repairRound: 1, notes: "",
      rows: [{ label: `Card action ${id}`, outcomeKind: "n-a", outcome: `n-a — closed per ${ref}`, outcomeReason: `closed per ${ref}`, na: null }] });
    const repG = renderFinalReport({ result: RUN, verifyRes: greenVerify, set: { planVersion: RUN.planVersion, tasks: [bnd("b7", "D7"), bnd("b8", "D8"), bnd("b9", "D9"), bnd("b10", "D10")] }, dir: dG });
    check("(readDecisions grammar): D-heading variants `## D7 — …`, `### D8: …`, `#### D9 …`, `## D10. …` all parse, so boundaries citing D7–D10 are backed (0 unbacked) and each renders with its title",
      () => repG.counts.unbackedBoundaries === 0
        && /\*\*D7\*\* — dash title/.test(repG.markdown) && /\*\*D8\*\* — colon title/.test(repG.markdown)
        && /\*\*D9\*\* — space title/.test(repG.markdown) && /\*\*D10\*\* — dot title/.test(repG.markdown),
      () => ({ unbacked: repG.counts.unbackedBoundaries, s2: repG.markdown.slice(repG.markdown.indexOf("## 2."), repG.markdown.indexOf("## 3.")) }));
  }

  // renderFinalReport unit — the refused-ledger path at the source. `readMergedTaskDir` over a
  // folder whose frozen split is corrupt returns `refused` with `tasks: []`; renderFinalReport must NOT read that
  // empty task list as "everything closed" — `refused` forces `complete: false` and a verdict reason naming it.
  {
    const dRef = path.join(tmp("refused-unit"), "build-tasks");
    syncTaskDir(dRef, RUN, OPTS);
    fs.writeFileSync(path.join(dRef, SPLIT_FILE), "{ broken");
    const refusedSet = readMergedTaskDir(dRef, RUN, OPTS);
    const refRep = renderFinalReport({ result: RUN, verifyRes: greenVerify, set: refusedSet, dir: dRef });
    check("renderFinalReport: a refused/unreadable ledger is complete:false with a verdict reason naming it — an empty `tasks: []` from a REFUSED read is never mistaken for a fully-closed run (the false-green this PR targets)",
      () => refusedSet.refused === true && refRep.complete === false
        && refRep.reasons.some((r) => /task ledger could not be read/.test(r))
        && /⛔ \*\*NOT COMPLETE\*\*/.test(refRep.markdown),
      () => ({ refused: refusedSet.refused, complete: refRep.complete, reasons: refRep.reasons }));
  }
  // THE DECISION MARKER: what section 1 quotes. A `needs-decision` row whose task notes carry
  // `Decision needed (row N): …` shows that sentence; a boundary whose reason cites a recorded decision is
  // information, one that cites nothing is a question; a decision the reason cites but nobody recorded is named.
  {
    const base2 = tmp("result-report-markers");
    const d2 = path.join(base2, "build-tasks");
    fs.mkdirSync(base2, { recursive: true });
    fs.writeFileSync(path.join(base2, "decisions.md"), "# Decisions\n\n## D7 — Print is not migrated (2026-09-17)\n\nno printables exist.\n");
    syncTaskDir(d2, RUN, OPTS);
    const t2 = readTaskDir(d2).find((t) => t.rows.length >= 3);
    const f2 = path.join(d2, t2.file);
    let text2 = setOutcome(allBuilt(fs.readFileSync(f2, "utf8")), 1, "not-built — needs-decision");
    text2 = setOutcome(text2, 2, "n-a — approved by D7, see decisions");
    text2 = setOutcome(text2, 3, "n-a — nothing to build here, D99 says so");
    text2 += "\nDecision needed (row 1): keep the Classic allow-list behaviour (a) or drop it as inert in Freedom (b)?\nCheck on stand (row 1): open any record → the field is read-only.\n";
    fs.writeFileSync(f2, text2);
    const set2 = readMergedTaskDir(d2, RUN, OPTS);
    const rep2 = renderFinalReport({ result: RUN, verifyRes: greenVerify, set: set2, dir: d2 });
    check("markers: section 1 quotes the `Decision needed (row N)` line verbatim as the decision the person has to make",
      () => /\| 1 \| .* \| keep the Classic allow-list behaviour \(a\) or drop it as inert in Freedom \(b\)\? \| /.test(rep2.markdown),
      () => rep2.markdown.slice(rep2.markdown.indexOf("## 1."), rep2.markdown.indexOf("## 2.")));
    check("boundaries: an `n-a` citing a decision that decisions.md records is listed as information with the decision's title; one citing a decision nobody recorded is a question and names the missing reference — and only the latter is a verdict reason",
      () => { const s2 = rep2.markdown.slice(rep2.markdown.indexOf("## 2."), rep2.markdown.indexOf("## 3."));
        return /Closed by a recorded decision \(1\)/.test(s2) && /\*\*D7\*\* — Print is not migrated/.test(s2)
          && /Without a recorded decision \(1\)/.test(s2) && /cites D99, not found in decisions\.md/.test(s2)
          && rep2.reasons.some((r) => /1 boundary closed by the agent with NO recorded decision/.test(r)); },
      () => ({ reasons: rep2.reasons, s2: rep2.markdown.slice(rep2.markdown.indexOf("## 2."), rep2.markdown.indexOf("## 3.")) }));

    // splitDecided: a not-built row whose SAME (page,label) is closed n-a with a RECORDED decision in ANOTHER
    // task is reclassified as decided — it leaves section 1 for the informational part of section 2. Hand-built so
    // the two tasks share a deliverable (the Applicants shape: init not-built in the build task, n-a by D18 in the
    // repair task). `dir` is d2, whose decisions.md records D7.
    {
      const shared = "Handler — `dup`";
      const A = { id: "bd-a", file: "bd-a.md", group: "Build", pageKey: "main", status: "partial", notes: "",
        rows: [{ label: shared, outcomeKind: "not-built", outcomeCause: "needs-decision", outcome: "not-built — needs-decision", outcomeReason: "" }] };
      const B = { id: "bd-b", file: "bd-b.md", group: "Repair round 1", pageKey: "main", status: "partial", kind: "repair", repairRound: 1, notes: "",
        rows: [{ label: shared, outcomeKind: "n-a", outcome: "n-a — superseded, per D7", outcomeReason: "superseded, per D7", na: null }] };
      const rep4 = renderFinalReport({ result: RUN, verifyRes: greenVerify, set: { tasks: [A, B], planVersion: RUN.planVersion }, dir: d2 });
      const sec1 = rep4.markdown.slice(rep4.markdown.indexOf("## 1."), rep4.markdown.indexOf("## 2."));
      check("splitDecided: a not-built row whose same deliverable is n-a'd with a recorded decision elsewhere is 'not built BY DECISION' (section 2), NOT an open question (section 1)",
        () => /\| Plan items not built BY DECISION \| 1 \|/.test(rep4.markdown) && rep4.counts.decidedNotBuilt === 1
          && rep4.counts.openNotBuilt === 0 && !sec1.includes(shared)
          && !rep4.reasons.some((r) => /recorded NOT BUILT/.test(r)),
        () => ({ counts: rep4.counts, reasons: rep4.reasons, sec1 }));

      // decision B: a code mentioned as an INCIDENTAL comparison ("like D7 …") is NOT a load-bearing citation, so
      // the boundary stays a question (unbacked) even though decisions.md records D7 — while a real "per D7" does
      // authorise it. Guards against an accidental/parallel mention flipping a boundary to closed.
      const boundary = (reason) => ({ id: "bx", file: "bx.md", group: "Repair", pageKey: "main", status: "partial", kind: "repair", repairRound: 1, notes: "",
        rows: [{ label: "Card action - Export", outcomeKind: "n-a", outcome: "n-a - " + reason, outcomeReason: reason, na: null }] });
      const repIncidental = renderFinalReport({ result: RUN, verifyRes: greenVerify, set: { tasks: [boundary("nothing to build, like D7 in the Leads section")], planVersion: RUN.planVersion }, dir: d2 });
      const repCited = renderFinalReport({ result: RUN, verifyRes: greenVerify, set: { tasks: [boundary("nothing to build here, per D7")], planVersion: RUN.planVersion }, dir: d2 });
      check("decisionRefs (B): an incidental 'like D7' does NOT authorise a boundary (stays a question / verdict reason); a load-bearing 'per D7' does",
        () => repIncidental.counts.unbackedBoundaries === 1
          && repIncidental.reasons.some((r) => /boundary closed by the agent with NO recorded decision/.test(r))
          && repCited.counts.unbackedBoundaries === 0
          && !repCited.reasons.some((r) => /NO recorded decision/.test(r)),
        () => ({ incidental: repIncidental.counts, cited: repCited.counts }));

      // taskRows — a not-built plan item on ONE page must not bleed onto a
      // same-labeled row on ANOTHER page. Two tasks share the deliverable label but live on different pages: one
      // not-built (main), one built and machine-confirmed (child:C1). A whole-run label fallback matching by
      // bare label would mark BOTH rows not-built; taskRows falls back to the label ONLY for the synthetic `run`
      // task, so the child's row stays confirmed (Not built "—") and only the main task carries the open question.
      const shBleed = "Handler — `save`";
      const bA = { id: "bl-a", file: "bl-a.md", group: "Form build", pageKey: "main", status: "partial", notes: "",
        rows: [{ label: shBleed, outcomeKind: "not-built", outcomeCause: "needs-decision", outcome: "not-built — needs-decision", outcomeReason: "" }] };
      const bC = { id: "bl-c", file: "bl-c.md", group: "Child build", pageKey: "child:C1", status: "done", notes: "",
        rows: [{ label: shBleed, outcomeKind: "built", outcome: "built", outcomeReason: "" }] };
      const vBleed = { markdown: "", missing: 0, unverified: 0, complete: true, pages: {},
        rows: [{ n: 1, pageKey: "child:C1", group: "Form — Custom methods", deliverable: shBleed, status: "✅ Done", evidence: "a handler defines `save`", outcome: "ok", kind: "machine", vkType: "handler", owner: "builder" }] };
      const repBleed = renderFinalReport({ result: RUN, verifyRes: vBleed, set: { tasks: [bA, bC], planVersion: RUN.planVersion }, dir: d2 });
      const secTasks = repBleed.markdown.slice(repBleed.markdown.search(/## \d+\. Tasks \(/), repBleed.markdown.search(/## \d+\. Task details/));
      const lineA = secTasks.split("\n").find((l) => l.includes("](bl-a.md)")) || "";
      const lineC = secTasks.split("\n").find((l) => l.includes("](bl-c.md)")) || "";
      check("taskRows: a not-built row on `main` does NOT bleed onto a same-labeled built row on `child:C1` — the child task's Not-built cell stays `—` while only the main task carries the open question; one open question in all",
        () => repBleed.counts.openNotBuilt === 1
          && /save/.test(lineA) && /needs a decision/.test(lineA)
          && !/needs a decision/.test(lineC) && lineC.trim().endsWith("| — |"),
        () => ({ openNotBuilt: repBleed.counts.openNotBuilt, lineA, lineC }));
    }
  }

  // AC-4/AC-5: a REAL `--built` payload carrying the three new optional fields (schemaName, handlers,
  // viewModelConfig) is accepted end to end, and the report names the page by its Freedom schemaName rather than
  // the engine key — a field-name typo or a validator that rejected the new keys would fail here.
  {
    const baseN = tmp("result-report-schemaname");
    const dN = path.join(baseN, "build-tasks");
    cliR(["--tasks", dN], MANIFEST);
    const builtN = path.join(baseN, "built.json");
    const mainEntity = RUN.entity || "X";
    fs.writeFileSync(builtN, JSON.stringify({ pages: { main: {
      viewConfig: { items: [{ type: "crt.Input", name: "AField", control: "$A" }] },
      packageName: "UsrX", parentSchemaName: "FormPageTemplate", entitySchemaName: mainEntity,
      schemaUId: "33333333-3333-4333-8333-333333333333", schemaName: "UsrDemo_FormPage",
      handlers: "[{ request: \"crt.SaveRecordRequest\", handler: async (r, n) => n?.handle(r) }]",
      viewModelConfig: { attributes: { A: {} } },
    } } }));
    const outN = path.join(baseN, "report.md");
    const runN = cliR(["--verify", "--built", builtN, "--tasks", dN, "--out", outN], MANIFEST);
    check("CLI: a --built payload with schemaName/handlers/viewModelConfig is accepted (no exit-1 shape/validator error) and the report names the page by its Freedom schemaName, not the engine key",
      () => runN.status === 2 && !/cannot read --built|Expected/.test(runN.stderr || "")
        && /UsrDemo_FormPage/.test(fs.readFileSync(outN, "utf8")) && !/\| Form page \|/.test(fs.readFileSync(outN, "utf8")),
      () => ({ status: runN.status, stderr: (runN.stderr || "").slice(0, 300), hasName: /UsrDemo_FormPage/.test(fs.readFileSync(outN, "utf8")) }));
  }
}


/* ================================================================================================
   "What is startable NOW", answered by the engine instead of by each orchestrator.
   The claim under test is an EQUIVALENCE, not a second scheduler: the same predicate `--start`
   refuses through is the one the query reports, so the two cannot drift. Every check below pairs
   its claim with an anti-vacuity check, because "no two members share an artifact" and "nothing is
   withheld" are both trivially true of an empty answer.
   ================================================================================================ */
console.log("\n===== the startable set — one predicate, two callers =====");
{
  // A folder brought to a known state, with every dependency dispatched/signed/closed the way a real run does.
  const folderAt = (closeThrough = 0) => {
    const d = tmp("next");
    syncTaskDir(d, RUN, OPTS);
    let m = 0;
    for (const t of [...SET.tasks].sort((a, b) => a.order - b.order)) {
      if (t.order > closeThrough) break;
      runTask(d, t.id, RUN, OPTS, m); m += 2;
    }
    return d;
  };
  const answerOf = (d) => startableTasks(syncTaskDir(d, RUN, OPTS), d);
  const idsOf = (list) => list.map((x) => (x.task || x).id);
  const HEAD = SET.tasks.find((t) => t.order === 1).id;          // the reference cache: the only task with no deps

  // ---- T1 (R1) — the head of the queue, and everything behind it withheld -----------------------
  {
    const d = folderAt(0);
    const a = answerOf(d);
    check("T1 fixture (anti-vacuity): the fresh folder really holds a dependency CHAIN — exactly one task has no `dependsOn`, and the other nine wait on it directly or transitively, so 'withholds what waits' is not a claim about an empty list",
      () => SET.tasks.filter((t) => (t.dependsOn || []).length === 0).length === 1 && SET.tasks.length === 10,
      () => SET.tasks.map((t) => ({ id: t.id, dep: t.dependsOn })));
    check("T1 (R1): on a fresh folder the answer names the head of the queue and NOTHING else — the orchestrator asks which task to start instead of reading the `Step` column off a derived index",
      () => a.verdict === NEXT_STARTABLE && idsOf(a.startable).join(",") === HEAD,
      () => ({ verdict: a.verdict, startable: idsOf(a.startable) }));
    check("T1 (R1): every other task is WITHHELD with the cause that holds it — `deps`, naming the open task(s) it waits on, so an empty-looking queue is never unexplained",
      () => a.withheld.length === 9 && a.withheld.every((w) => w.cause === HOLD_DEPS && w.tasks.length > 0),
      () => a.withheld.map((w) => ({ id: w.task.id, cause: w.cause, on: idsOf(w.tasks || []) })));
    fs.rmSync(d, { recursive: true, force: true });
  }

  // ---- the vocabulary is CHECKED, not free text ------------------------------------------------
  // A cause or a verdict spelled differently from the published constant reaches a caller as a string that
  // matches nothing, and that caller's `else` branch then silently does the wrong thing. Same rule the status
  // vocabulary in this module already carries.
  {
    const d = folderAt(1);
    const a = answerOf(d);
    check("vocabulary (anti-vacuity): the sampled answer really carries a verdict AND at least one withheld cause, so the membership check below reads something",
      () => !!a.verdict && a.withheld.length > 0, () => ({ verdict: a.verdict, withheld: a.withheld.length }));
    check("vocabulary: every verdict and every cause the query emits is one of the published constants — a caller branching on these strings must never meet a spelling nobody declared",
      () => NEXT_VERDICTS.includes(a.verdict)
        && [...a.withheld, ...a.held].every((w) => HOLD_CAUSES.includes(w.cause)),
      () => ({ verdict: a.verdict, causes: [...new Set([...a.withheld, ...a.held].map((w) => w.cause))] }));
    fs.rmSync(d, { recursive: true, force: true });
  }

  // ---- T1b (R1) — several unblocked at once, in queue order ------------------------------------
  {
    const d = folderAt(2);   // reference cache + scaffolding closed: the four page builds are all unblocked
    const a = answerOf(d);
    check("T1b fixture (anti-vacuity): closing the cache and the scaffolding really unblocks MORE THAN ONE task — an ordering claim over a one-member answer is vacuous",
      () => a.startable.length > 1, () => ({ verdict: a.verdict, startable: idsOf(a.startable) }));
    check("T1b (R1): the answer is the whole set of tasks startable right now, in QUEUE order — an orchestrator can fan out from one call instead of asking once per page",
      () => a.verdict === NEXT_STARTABLE
        && a.startable.map((t) => t.order).join(",") === [...a.startable].sort((x, y) => x.order - y.order).map((t) => t.order).join(","),
      () => a.startable.map((t) => ({ order: t.order, id: t.id })));
    fs.rmSync(d, { recursive: true, force: true });
  }

  // ---- T3 (R2) — the set is mutually exclusive with ITSELF on `writesTo` ------------------------
  {
    const d = folderAt(2);
    // An orchestrator-authored task on an artifact the plan already schedules — the case SKILL.md 7.2 rule 5
    // describes verbatim ("copy the `writesTo` from the task whose page it touches").
    fs.writeFileSync(path.join(d, "zz-orchestrator-main.md"),
      `---\nid: orch0001\nstatus: todo\norigin: orchestrator\npageKey: main\ngroup: Extra main work\norder: 99\nwritesTo: page:main\n---\n\n## Notes\nAdded by the orchestrator.\n`);
    const a = answerOf(d);
    check("T3 fixture (anti-vacuity): the folder really holds TWO todo tasks writing `page:main` and an answer with SEVERAL writers in it — so 'no two members share an artifact' is a claim about a real choice and not about a one-member list",
      () => {
        const set = syncTaskDir(d, RUN, OPTS);
        return set.tasks.filter((t) => t.writesTo === "page:main" && t.status === "todo").length === 2
          && a.startable.filter((t) => t.writesTo).length > 1;
      }, () => ({ pair: syncTaskDir(d, RUN, OPTS).tasks.filter((t) => t.writesTo === "page:main").map((t) => ({ id: t.id, dep: t.dependsOn })), startable: idsOf(a.startable) }));
    check("T3 (R2): no two tasks in ONE answer write the same artifact — over a real folder the write chain already serializes them (the second writer waits on the first), so the answer carries at most one writer per artifact and an orchestrator may fan the whole set out at once",
      () => new Set(a.startable.filter((t) => t.writesTo).map((t) => t.writesTo)).size === a.startable.filter((t) => t.writesTo).length,
      () => a.startable.map((t) => ({ id: t.id, w: t.writesTo })));
    // ---- the PER-TASK overlap arm (R2) — a writer that is already DISPATCHED ---------------------
    // The set rule below holds a second writer while BOTH are merely `todo`. The OTHER arm is the one the gate
    // refuses through: a conflicting writer with an OPEN CLOCK. Nothing above opens one, so `overlap` — a live
    // branch of the query and the only cause the CLI renders as "is being written by" — was reached solely
    // through `--start`, and the refuse loop that names it was silently vacuous.
    // The write chain is what keeps the ORDER-99 task above away from this arm: a same-artifact task added AFTER
    // the engine's writer waits on it, so `deps` answers first. A task added BEFORE it does not — the chain points
    // the other way — so it meets the open clock itself, which is the only shape that reaches `overlap` on a real
    // folder.
    {
      const od = folderAt(2);
      const writer = syncTaskDir(od, RUN, OPTS).tasks.find((t) => t.writesTo === "page:main");
      startTask(od, writer.id, RUN, { ...OPTS, dispatchToken: "tok-main" }, null, AT(30));
      fs.writeFileSync(path.join(od, "zz-orchestrator-main.md"),
        `---\nid: orch0002\nstatus: todo\norigin: orchestrator\npageKey: main\ngroup: Extra main work\norder: 0\nwritesTo: page:main\n---\n\n## Notes\nAdded by the orchestrator.\n`);
      const ov = answerOf(od);
      const w = ov.withheld.find((x) => x.task.id === "orch0002");
      check("T3 fixture (anti-vacuity): the engine's own `page:main` writer really holds an OPEN CLOCK here, and the orchestrator's task does NOT wait on it — without both, the overlap arm is never reached and the assertion below would pass over a cause nothing produced",
        () => !!readTimingsFile(od).running[writer.id]
          && !(syncTaskDir(od, RUN, OPTS).tasks.find((t) => t.id === "orch0002")?.dependsOn || []).includes(writer.id),
        () => ({ running: Object.keys(readTimingsFile(od).running), writer: writer.id,
          deps: syncTaskDir(od, RUN, OPTS).tasks.find((t) => t.id === "orch0002")?.dependsOn }));
      check("T3 (R2): a task whose artifact is being written by a DISPATCHED task is WITHHELD as `overlap`, naming that writer — the arm `--start` refuses through, reported before a sub-agent is sent at a page somebody else is already editing",
        () => w?.cause === HOLD_OVERLAP && idsOf(w.tasks).join(",") === writer.id,
        () => ({ withheld: ov.withheld.map((x) => ({ id: x.task.id, cause: x.cause, on: idsOf(x.tasks || []) })) }));
      // …and the LINE that renders it. `overlap` is the one cause whose sentence names the ARTIFACT rather than
      // the task waited on, so a caller reading stdout learns which deliverable is busy — and that sentence had no
      // reader anywhere until here. It needs its OWN folder: the CLI re-cuts with the DEFAULT budget, so a folder
      // sliced with the test budget is reshaped out from under the clock opened above.
      {
        const cbase = tmp("cli-overlap");
        const cdir = path.join(cbase, "tasks");
        const cman = path.join(cbase, "manifest.json");
        fs.writeFileSync(cman, JSON.stringify(MANIFEST));
        const cli = (...args) => spawnSync(process.execPath, [MIGRATE, cman, ...args], { encoding: "utf8" });
        cli("--tasks", cdir);
        const busy = readTaskDir(cdir).find((t) => t.writesTo);
        cli("--tasks", cdir, "--start", busy.id);
        // Added BEFORE the running writer in queue order, for the same reason as above: behind it the write chain
        // would answer `deps` and the overlap arm would never be reached.
        fs.writeFileSync(path.join(cdir, "zz-orchestrator-overlap.md"),
          `---\nid: orch0003\nstatus: todo\norigin: orchestrator\npageKey: ${busy.pageKey}\ngroup: Extra work\norder: 0\nwritesTo: ${busy.writesTo}\n---\n\n## Notes\nAdded by the orchestrator.\n`);
        // A second orchestrator task, on an artifact NOBODY else writes, so the folder still has something to hand
        // out: the withheld list is rendered under the STARTABLE verdict, and an answer with nothing startable
        // prints only what is in flight — which is where the overlap line would have gone unread again.
        fs.writeFileSync(path.join(cdir, "zz-orchestrator-free.md"),
          `---\nid: orch0004\nstatus: todo\norigin: orchestrator\npageKey: ${busy.pageKey}\ngroup: Unrelated work\norder: 0\nwritesTo: notes:extra\n---\n\n## Notes\nAdded by the orchestrator.\n`);
        const ovCli = cli("--tasks", cdir, "--next");
        check("T3 fixture (anti-vacuity): the folder the CLI cut really has a DISPATCHED writer with an open clock and a second task on that same artifact — else the rendered line below is asserted over an answer that never reaches the overlap arm",
          () => !!readTimingsFile(cdir).running[busy.id]
            && readTaskDir(cdir).filter((t) => t.writesTo === busy.writesTo).length === 2,
          () => ({ running: Object.keys(readTimingsFile(cdir).running), busy: busy.id,
            onArtifact: readTaskDir(cdir).filter((t) => t.writesTo === busy.writesTo).map((t) => t.id) }));
        check("T3 (R2, CLI): the overlap is RENDERED — stdout names the busy ARTIFACT and the task writing it, not the generic 'waits on N task(s)' every other cause prints",
          () => (ovCli.stdout || "").includes("`" + busy.writesTo + "` is being written by " + busy.id),
          () => ({ status: ovCli.status, stdout: ovCli.stdout, stderr: ovCli.stderr }));
        fs.rmSync(cbase, { recursive: true, force: true });
      }
      fs.rmSync(od, { recursive: true, force: true });
    }
    fs.rmSync(d, { recursive: true, force: true });
    // …and the SET-LEVEL rule itself, which does not depend on that chain existing. `chainMerged` is what makes
    // two same-artifact tasks unreachable at once TODAY; the answer's own contract is that it never names two
    // writers of one artifact, so it is asserted directly rather than being left to a property of the merge that
    // a later change to the queue could quietly remove.
    {
      const bare = tmp("next-set-rule");
      const twin = (id, order) => ({ id, order, file: `${id}.md`, status: "todo", origin: "engine",
        pageKey: "main", group: "Page build", writesTo: "page:main", dependsOn: [], rows: [] });
      const solo = { ...twin("solo0001", 3), writesTo: "page:list", pageKey: "list" };
      const tasks = [twin("first001", 1), twin("second01", 2), solo];
      const hand = startableTasks({ tasks }, bare);
      check("T3 fixture (anti-vacuity): with the chain removed, the per-task predicate really does pass BOTH writers of `page:main` — so the exclusion below is the set rule doing the work and nothing else",
        () => tasks.filter((t) => t.writesTo === "page:main").every((t) => startBlocker(t, tasks, {}) === null),
        () => tasks.map((t) => ({ id: t.id, blocker: startBlocker(t, tasks, {}) })));
      check("T3 (R2): the answer excludes its own members against each other — the FIRST writer of an artifact in queue order is named, the second is withheld as `sequenced`, and a task on a different artifact is unaffected",
        () => hand.startable.map((t) => t.id).join(",") === "first001,solo0001"
          && hand.withheld.length === 1 && hand.withheld[0].task.id === "second01"
          && hand.withheld[0].cause === HOLD_SEQUENCED && hand.withheld[0].tasks[0].id === "first001",
        () => ({ startable: hand.startable.map((t) => t.id), withheld: hand.withheld.map((w) => ({ id: w.task.id, cause: w.cause })) }));
      fs.rmSync(bare, { recursive: true, force: true });
    }
  }

  // ---- T2 (R4) — the answer AGREES with `--start`, in both directions ---------------------------
  {
    const src = folderAt(2);
    const inFlightId = SET.tasks.find((t) => t.order === 3).id;
    startTask(src, inFlightId, RUN, { ...OPTS, dispatchToken: "tok-inflight" }, null, AT(30));
    const a = answerOf(src);
    check("T2 fixture (anti-vacuity): the folder really holds all three states at once — an OPEN clock, a non-empty startable set and a non-empty withheld set — so neither direction of the equivalence below is asserted over nothing",
      () => Object.keys(readTimingsFile(src).running).length > 0 && a.startable.length > 0 && a.withheld.length > 0,
      () => ({ running: Object.keys(readTimingsFile(src).running), startable: idsOf(a.startable), withheld: a.withheld.length }));
    // ACCEPT DIRECTION — each against its OWN copy of the folder, because starting one changes the answer for the rest.
    check("T2 (R4, accept): every task the query NAMES is accepted by `--start` on the same folder — the query does not advertise work the gate would then refuse",
      () => a.startable.every((t) => {
        const copy = tmp("next-accept");
        fs.cpSync(src, copy, { recursive: true });
        const res = startTask(copy, t.id, RUN, OPTS, null, AT(40));
        fs.rmSync(copy, { recursive: true, force: true });
        return res.started?.id === t.id;
      }), () => idsOf(a.startable));
    // REFUSE DIRECTION — and with the SAME cause, which is what makes this one predicate rather than two rules.
    check("T2 (R4, refuse): every task the query WITHHOLDS for a per-task cause is refused by `--start` with that same cause, naming the same task(s) — agreement produced by one predicate, not by two rules kept in step by hand",
      () => a.withheld.filter((w) => w.cause !== HOLD_SEQUENCED).every((w) => {
        const copy = tmp("next-refuse");
        fs.cpSync(src, copy, { recursive: true });
        const res = startTask(copy, w.task.id, RUN, OPTS, null, AT(40));
        fs.rmSync(copy, { recursive: true, force: true });
        if (res.started) return false;
        if (w.cause === HOLD_DEPS) return (res.blockedByDeps || []).map((x) => x.id).sort().join(",") === idsOf(w.tasks).sort().join(",");
        if (w.cause === HOLD_OVERLAP) return (res.blockedByOverlap || []).map((x) => x.id).sort().join(",") === idsOf(w.tasks).sort().join(",");
        return !!res.unread;
      }), () => a.withheld.map((w) => ({ id: w.task.id, cause: w.cause, on: idsOf(w.tasks || []) })));
    // HELD DIRECTION — the class an equivalence can skip. A task the query holds for its STATUS must be
    // refused by `--start` too: a gate that stamped a clock on it would send a sub-agent at work somebody has
    // already decided to stop, while the query was still printing it as a decision nobody has made.
    check("T2 (R4, refuse): a task the query HOLDS for its status is refused by `--start` on the same folder — the held class is part of the equivalence, not an exception to it",
      () => {
        const copy = tmp("next-held");
        fs.cpSync(src, copy, { recursive: true });
        const target = a.startable[0];
        editFrontMatter(copy, target.id, "status", "blocked");
        const heldAnswer = answerOf(copy);
        const res = startTask(copy, target.id, RUN, OPTS, null, AT(40));
        fs.rmSync(copy, { recursive: true, force: true });
        return heldAnswer.held.some((h) => h.task.id === target.id && h.cause === HOLD_STATUS)
          && !res.started && res.blockedByStatus === "blocked";
      }, () => ({ startable: idsOf(a.startable) }));
    // LEDGER DIRECTION — a broken dispatch ledger makes the gate refuse EVERY id, so a per-task cause computed as
    // if the ledger were healthy publishes a cause the gate would not give. A query that answered `deps` here
    // while `--start` on that same id answered with the ledger refusal would be two callers of one predicate disagreeing
    // on one folder, which is precisely the invariant the whole design rests on.
    check("T2 (R4, refuse): with the dispatch ledger broken, every cause the query publishes is the one `--start` actually gives for that id — the ledger outranks the per-task causes in the answer exactly as it does in the gate",
      () => {
        const copy = tmp("next-ledger");
        fs.cpSync(src, copy, { recursive: true });
        // Close a still-open task with no dispatch record: that is what the ledger audit fails on, and every task
        // still open is then refused by the gate for the ledger rather than for its own cause.
        editFrontMatter(copy, a.startable[0].id, "status", "done");
        const led = answerOf(copy);
        if (led.verdict !== NEXT_LEDGER || !led.withheld.length) { fs.rmSync(copy, { recursive: true, force: true }); return false; }
        const ok = led.withheld.every((w) => {
          const one = tmp("next-ledger-one");
          fs.cpSync(copy, one, { recursive: true });
          const res = startTask(one, w.task.id, RUN, OPTS, null, AT(40));
          fs.rmSync(one, { recursive: true, force: true });
          if (res.started) return false;
          if (w.cause === HOLD_UNREAD) return !!res.unread;
          if (w.cause === HOLD_STATUS) return !!res.blockedByStatus;
          // everything else must carry the ledger cause, and the gate must answer with the ledger refusal
          return w.cause === HOLD_LEDGER && res.blockedByDispatch?.failing.length > 0;
        });
        fs.rmSync(copy, { recursive: true, force: true });
        return ok;
      },
      () => "the query must not publish a per-task cause the gate would not give while the ledger is failing");
    // …and the more specific truth is not thrown away, only demoted: it is what will hold the task once the
    // books are repaired, which is the next thing the reader needs.
    check("T2 (R4): the relabelled entry keeps what will hold the task AFTER the ledger is repaired, as `underlying` — demoted, never discarded",
      () => {
        const copy = tmp("next-ledger-underlying");
        fs.cpSync(src, copy, { recursive: true });
        editFrontMatter(copy, a.startable[0].id, "status", "done");
        const led = answerOf(copy);
        const relabelled = led.withheld.filter((w) => w.cause === HOLD_LEDGER);
        fs.rmSync(copy, { recursive: true, force: true });
        return relabelled.length > 0 && relabelled.every((w) => HOLD_CAUSES.includes(w.underlying) && w.underlying !== HOLD_LEDGER);
      }, () => "every ledger-relabelled entry carries its original cause under `underlying`");
    fs.rmSync(src, { recursive: true, force: true });
  }

  // ---- the fourth per-task cause (R4) — a file the engine could not read ------------------------
  // `--start` refuses it rather than rewriting it, so the query must withhold it for the same reason: advertising
  // it would send a sub-agent at a file whose `## Notes` are the only record of work already done on a stand.
  {
    const d = tmp("next-unread");
    const set0 = syncTaskDir(d, RUN, OPTS);
    const victim = set0.tasks.find((t) => t.order === 1);
    // Unterminated front matter — the same corruption the `--start` refusal is asserted over.
    fs.writeFileSync(path.join(d, victim.file), `---\nid: ${victim.id}\nstatus: todo\n\n## Notes\nwork already done on the stand\n`);
    const set = syncTaskDir(d, RUN, OPTS);
    const a = startableTasks(set, d);
    check("R4 fixture (anti-vacuity): the folder really holds a task the engine REFUSED to read — else the withholding below is asserted over a file it could parse perfectly well",
      () => set.tasks.some((t) => t.id === victim.id && t.unread),
      () => set.tasks.filter((t) => t.unread).map((t) => t.id));
    check("R4 (unread): the query withholds an unreadable task with cause `unread` and names the file — the same refusal `--start` makes, out of the same predicate, so nothing is advertised that the gate would then refuse",
      () => {
        const w = a.withheld.find((x) => x.task.id === victim.id);
        const res = startTask(d, victim.id, RUN, OPTS, null, AT(0));
        return w?.cause === HOLD_UNREAD && w.file === victim.file && res.started === null && res.unread === victim.file;
      }, () => a.withheld.map((w) => ({ id: w.task.id, cause: w.cause, file: w.file })));
    // …and the VERDICT the corrupted head produces, which the assertions above never reached. Corrupting the one
    // task with no dependencies withholds every other task behind it, so nothing is startable and nothing is in
    // flight — the definition of a run that cannot move itself. Raised on the pull request: asserting the
    // per-task cause while leaving the verdict and the exit code unchecked tests half the answer.
    check("R4 (unread): the corrupted head leaves the run STUCK — nothing startable, nothing in flight — and the CLI says so with a non-zero exit, not just a withheld entry",
      () => a.verdict === NEXT_STUCK && a.startable.length === 0 && a.inFlight.length === 0,
      () => ({ verdict: a.verdict, startable: idsOf(a.startable), inFlight: idsOf(a.inFlight) }));
    // (No CLI leg here: this folder is cut with the test budget, and the CLI re-slices with the DEFAULT one, so a
    // spawned run reads a differently-shaped folder and would assert about a state this block never built. The
    // stuck verdict's CLI exit code is covered where the folder IS cut by the CLI — see T4.)
    fs.rmSync(d, { recursive: true, force: true });
  }

  // ---- T4 (R6) — a clock is NOT work in flight --------------------------------------------------
  // The defect this pins: a task recorded `blocked` KEEPS its clock (only a settled
  // task's clock is closed), so a mode that reads the raw clock reports a halted run as `waiting` — at a passing
  // exit code, forever. That is precisely the silent stall this feature exists to remove.
  {
    const d = tmp("next-blocked");
    syncTaskDir(d, RUN, OPTS);
    startTask(d, HEAD, RUN, { ...OPTS, dispatchToken: "tok-head" }, null, AT(0));
    editFrontMatter(d, HEAD, "status", "blocked");
    const set = syncTaskDir(d, RUN, OPTS, null);
    const a = startableTasks(set, d);
    check("T4 fixture (anti-vacuity): the blocked task's clock really is STILL OPEN and its status really is `blocked` — the whole point is that those two facts disagree, and a mode reading the clock alone cannot tell",
      () => !!readTimingsFile(d).running[HEAD] && set.tasks.find((t) => t.id === HEAD).status === "blocked",
      () => ({ running: readTimingsFile(d).running, status: set.tasks.find((t) => t.id === HEAD)?.status }));
    check("T4 (R6): a `blocked` task with an open clock is NOT work in flight — the answer is the failing not-in-flight verdict, so an orchestrator is never left polling a run that cannot change",
      () => a.verdict === NEXT_STUCK && a.inFlight.length === 0,
      () => ({ verdict: a.verdict, inFlight: idsOf(a.inFlight), startable: idsOf(a.startable) }));
    check("T4 (R6): the verdict names what holds the run — the blocked task is reported as HELD by its status, and every other task by the dependency it waits on",
      () => a.held.some((h) => h.task.id === HEAD && h.cause === HOLD_STATUS) && a.withheld.length > 0,
      () => ({ held: a.held.map((h) => ({ id: h.task.id, cause: h.cause })), withheld: a.withheld.length }));
    fs.rmSync(d, { recursive: true, force: true });
  }

  // ---- T5 (R3) — the four empty answers are distinguishable -------------------------------------
  {
    // FINISHED — every task settled, nothing left to hand out.
    const dFin = folderAt(10);
    const aFin = startableTasks(syncTaskDir(dFin, RUN, OPTS), dFin);
    check("T5 fixture (anti-vacuity): the finished folder really has every task SETTLED and a dispatch record for each — else `finished` would be indistinguishable from a ledger failure",
      () => {
        const set = syncTaskDir(dFin, RUN, OPTS);
        return set.tasks.every((t) => t.status === "done") && set.dispatch.failing.length === 0;
      }, () => syncTaskDir(dFin, RUN, OPTS).tasks.map((t) => t.status));
    check("T5 (R3, finished): a folder whose every task has settled answers `finished` with an empty set and nothing withheld — the run is over, and that is not a failure",
      () => aFin.verdict === NEXT_FINISHED && aFin.startable.length === 0 && aFin.withheld.length === 0 && aFin.held.length === 0,
      () => ({ verdict: aFin.verdict, startable: idsOf(aFin.startable), withheld: aFin.withheld.length, held: aFin.held.length }));
    fs.rmSync(dFin, { recursive: true, force: true });

    // WAITING — work dispatched, the rest behind it. The commonest empty answer, and NOT an error.
    const dW = folderAt(1);
    const scaffold = SET.tasks.find((t) => t.order === 2).id;
    startTask(dW, scaffold, RUN, { ...OPTS, dispatchToken: "tok-scaffold" }, null, AT(20));
    const aW = startableTasks(syncTaskDir(dW, RUN, OPTS), dW);
    check("T5 (R3, waiting): with a task in flight and every remaining task behind it, the answer is `waiting` — an orchestrator polls, and the run does NOT fail",
      () => aW.verdict === NEXT_WAITING && aW.startable.length === 0 && aW.inFlight.map((t) => t.id).join(",") === scaffold,
      () => ({ verdict: aW.verdict, startable: idsOf(aW.startable), inFlight: idsOf(aW.inFlight) }));
    fs.rmSync(dW, { recursive: true, force: true });

    // LEDGER — a closure nobody was dispatched for. Answered ONCE for the folder, not once per task.
    const dL = folderAt(0);
    const victim = SET.tasks.find((t) => t.order === 3).id;
    editFrontMatter(dL, victim, "status", "done");
    const setL = syncTaskDir(dL, RUN, OPTS);
    const aL = startableTasks(setL, dL);
    check("T5 fixture (anti-vacuity): the ledger folder really holds a closed task with NO dispatch record, and more than one task is otherwise open — so 'answered once for the folder' is a claim about a real choice",
      () => setL.dispatch.failing.length > 0 && setL.tasks.filter((t) => t.status === "todo").length > 1,
      () => ({ failing: setL.dispatch.failing.map((t) => t.id), todo: setL.tasks.filter((t) => t.status === "todo").length }));
    check("T5 (R3, ledger): a failing dispatch ledger is answered ONCE for the whole folder — the verdict is `ledger`, the set is empty and no task is named startable while the books are broken, exactly as `--start` refuses",
      () => aL.verdict === NEXT_LEDGER && aL.startable.length === 0 && aL.dispatch.failing.length > 0,
      () => ({ verdict: aL.verdict, startable: idsOf(aL.startable), failing: aL.dispatch.failing.map((t) => t.id) }));
    fs.rmSync(dL, { recursive: true, force: true });
  }
}


console.log("\n===== migrate.mjs --tasks <dir> --next (CLI) =====");
{
  // The CLI has no `run: 0` to hand it, so it slices this fixture with the REAL default budget — which collapses
  // it to one build task plus one review. That is the right shape for this block: the build is startable, the
  // review waits on it, so both directions of the answer exist at the smallest size the engine produces.
  const base = tmp("cli-next");
  // A directory and a manifest whose names carry a SPACE and shell metacharacters, on purpose: the printed command
  // is the deliverable, and a wrapper that fires only on whitespace would hand `&` or `$` straight to the shell —
  // which is a command-injection surface, not a quoting nit, because this block then runs the string through one.
  const dir = path.join(base, "build & tasks");
  const manifestPath = path.join(base, "the $manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(MANIFEST));
  const cliFile = (...args) => spawnSync(process.execPath, [MIGRATE, manifestPath, ...args], { encoding: "utf8" });
  cliFile("--tasks", dir);

  const fresh = cliFile("--tasks", dir, "--next");
  const cmdLines = (out) => (out || "").split("\n").map((l) => l.trim()).filter((l) => l.includes("--start "));
  check("--next (anti-vacuity): the folder the CLI cut really holds MORE THAN ONE task, one of which waits on another — else 'names the startable one and withholds the rest' is a claim about a one-task folder",
    () => {
      const set = readTaskDir(dir);
      return set.length > 1 && set.some((t) => t.dependsOn.length > 0);
    }, () => readTaskDir(dir).map((t) => ({ id: t.id, dep: t.dependsOn })));
  check("--next: a folder with work to hand out exits 0 and NAMES the startable task(s) — the orchestrator asks the engine instead of re-deriving the schedule off a derived report",
    () => fresh.status === 0 && /task\(s\) STARTABLE NOW/.test(fresh.stdout || "") && cmdLines(fresh.stdout).length >= 1,
    () => ({ status: fresh.status, stdout: fresh.stdout, stderr: fresh.stderr }));
  check("--next (R7): the answer does NOT also tell the caller to hand tasks out in the order the index lists — two answers to one question on one stream is the contradiction this mode exists to end",
    () => !/`Step` order/.test(fresh.stdout || "") && !/Hand ONE task file at a time/.test(fresh.stdout || ""),
    () => fresh.stdout);
  check("--next (R3): every task it withholds is named WITH the cause that holds it — an empty-looking queue with no reason is exactly what sends a caller back to reading index.md",
    () => /WITHHELD/.test(fresh.stdout || "") && /waits on \d+ task\(s\)/.test(fresh.stdout || ""),
    () => fresh.stdout);

  // R5 — the printed command is the deliverable: run it verbatim, through a shell, and it must start that task.
  {
    const cmd = cmdLines(fresh.stdout)[0];
    // The id goes through the same encoder as every other element — it is front matter, not a value the engine
    // necessarily minted — so the golden unwraps it rather than assuming it was printed bare.
    const startedId = cmd.split("--start ")[1].trim().replace(/^["']|["']$/g, "");
    const ran = spawnSync(cmd, { shell: true, encoding: "utf8" });
    check("--next (R5): the command printed beside a task is directly RUNNABLE as printed — quoted paths and all, on a folder and a manifest whose names contain spaces — and it starts exactly that task",
      () => ran.status === 0 && new RegExp(`DISPATCH TOKEN for \`${startedId}\``).test(ran.stdout || "")
        && readTaskDir(dir).find((t) => t.id === startedId)?.status === "in-progress",
      () => ({ cmd, status: ran.status, stdout: (ran.stdout || "").slice(0, 400), stderr: (ran.stderr || "").slice(0, 400) }));
    // …and with that task in flight and the rest behind it, the answer is `waiting` and the run does NOT fail.
    const waiting = cliFile("--tasks", dir, "--next");
    check("--next (R3): with work in flight and everything else behind it the answer is NOTHING STARTABLE YET and the exit code is 0 — waiting is the commonest empty answer and it is not an error",
      () => waiting.status === 0 && /NOTHING STARTABLE YET/.test(waiting.stdout || "") && /IN FLIGHT:/.test(waiting.stdout || ""),
      () => ({ status: waiting.status, stdout: waiting.stdout, stderr: waiting.stderr }));

    // F2 — waiting is not a reason to stop naming a decision. With one task in flight and another recorded
    // `blocked`, the held task must still be named, and the printed figures must add up to `total`.
    {
      const copy = tmp("cli-next-held");
      fs.cpSync(dir, copy, { recursive: true });
      const other = readTaskDir(copy).find((t) => t.id !== startedId && t.status === "todo");
      editFrontMatter(copy, other.id, "status", "blocked");
      const cliCopy = spawnSync(process.execPath, [MIGRATE, manifestPath, "--tasks", copy, "--next"], { encoding: "utf8" });
      check("--next (R3): a task held for a DECISION is named on the waiting verdict too — something else being in flight does not make it stop needing one, and leaving it out is the halted task reading as normal waiting, one task smaller",
        () => /NOTHING STARTABLE YET/.test(cliCopy.stdout || "")
          && /HELD — somebody has to decide/.test(cliCopy.stdout || "")
          && cliCopy.stdout.includes(other.id)
          && / 1 task\(s\) in flight and 1 behind them /.test(cliCopy.stdout || ""),
        () => ({ status: cliCopy.status, held: other.id, stdout: cliCopy.stdout }));
      fs.rmSync(copy, { recursive: true, force: true });
    }

    // R6 — the same folder, with that in-flight task recorded `blocked`. Its clock is still open.
    editFrontMatter(dir, startedId, "status", "blocked");
    const stuck = cliFile("--tasks", dir, "--next");
    check("--next (R6): a task recorded `blocked` with its clock still OPEN is not reported as in flight — the CLI does NOT exit clean on that folder, because an orchestrator reading a passing code here would poll a run that can never change",
      () => stuck.status === 2 && /NOTHING STARTABLE AND NOTHING IN FLIGHT/.test(stuck.stdout || "")
        && /RUN HALTED/.test(stuck.stderr || "") && !!readTimingsFile(dir).running[startedId],
      () => ({ status: stuck.status, stdout: stuck.stdout, stderr: stuck.stderr, running: readTimingsFile(dir).running }));
    check("--next (R6): the halted answer names the blocked task as a DECISION rather than a schedule, and says why a clock alone is not work in flight",
      () => /HELD — somebody has to decide/.test(stuck.stdout || "") && /KEEPS its clock/.test(stuck.stdout || ""),
      () => stuck.stdout);
  }
  // F4 — a refusal prints NOTHING WRITTEN and names no task, so it must not exit like an answer. Every other
  // `--next` non-answer exits 2; a frozen cut the plan cannot resolve must not exit 0 beside that banner.
  {
    fs.writeFileSync(path.join(dir, SPLIT_FILE), JSON.stringify({ planVersion: "nope", items: "not a list" }));
    const refused = spawnSync(process.execPath, [MIGRATE, manifestPath, "--tasks", dir, "--next"], { encoding: "utf8" });
    check("--next (R3): a frozen split the plan cannot resolve is a REFUSAL, not an answer — it prints NOTHING WRITTEN and exits non-zero, like every other --next non-answer",
      () => refused.status !== 0 && /NOTHING WRITTEN/.test(refused.stdout || ""),
      () => ({ status: refused.status, stdout: refused.stdout, stderr: refused.stderr }));
  }
  fs.rmSync(base, { recursive: true, force: true });
}
{
  // The FINISHED answer, end to end: a folder whose every task has settled with a dispatch record for each.
  const base = tmp("cli-next-done");
  const dir = path.join(base, "build-tasks");
  const manifestPath = path.join(base, "m.json");
  fs.writeFileSync(manifestPath, JSON.stringify(MANIFEST));
  const cliFile = (...args) => spawnSync(process.execPath, [MIGRATE, manifestPath, ...args], { encoding: "utf8" });
  cliFile("--tasks", dir);
  const CLI_OPTS = checklistOpts(MANIFEST);
  for (const t of [...buildTaskSet(RUN, CLI_OPTS).tasks].sort((a, b) => a.order - b.order)) {
    runTask(dir, t.id, RUN, CLI_OPTS, t.order * 2);
  }
  const done = cliFile("--tasks", dir, "--next");
  check("--next (anti-vacuity): the folder really is fully settled with a clean dispatch ledger — else `finished` would be indistinguishable from the ledger verdict below",
    () => readTaskDir(dir).every((t) => t.status === "done") && dispatchAudit(readTaskDir(dir), dir).failing.length === 0,
    () => readTaskDir(dir).map((t) => t.status));
  check("--next (R3): a fully settled folder exits 0 and says the build is FINISHED, pointing at the migration result report rather than at another task",
    () => done.status === 0 && /all \d+ task\(s\) have settled/.test(done.stdout || "") && /--verify --tasks/.test(done.stdout || ""),
    () => ({ status: done.status, stdout: done.stdout }));

  // …and the LEDGER verdict: one closure nobody was dispatched for, answered ONCE for the folder.
  const victim = readTaskDir(dir)[0];
  fs.rmSync(path.join(dir, TIMINGS_FILE), { force: true });
  const ledger = cliFile("--tasks", dir, "--next");
  check("--next (R3): a broken dispatch ledger is answered ONCE for the whole folder, not once per task — it exits 2 and advertises NO id, because `--start` would refuse every one of them",
    () => ledger.status === 2 && /closed task\(s\) have no/.test(ledger.stdout || "")
      && !/STARTABLE NOW/.test(ledger.stdout || "") && /DISPATCH GATE/.test(ledger.stderr || ""),
    () => ({ status: ledger.status, stdout: (ledger.stdout || "").slice(0, 600), stderr: (ledger.stderr || "").slice(0, 300) }));
  check("--next (R3): the failing files are named ONCE, on stderr, by the same writer every other mode's dispatch gate uses — the answer points at them instead of printing a second copy a reader could take for a second finding",
    () => (ledger.stderr || "").includes(victim.file) && !(ledger.stdout || "").includes(victim.file)
      && /on stderr/.test(ledger.stdout || ""),
    () => ({ stdoutHasFile: (ledger.stdout || "").includes(victim.file), stderr: (ledger.stderr || "").slice(0, 400) }));
  // F5 — the stdin note qualifies PRINTED COMMANDS, so it must follow the commands and not a substring of the
  // prose. The ledger answer's own text names `--start` while dispatching nothing; a note about "each command
  // above" under it describes none.
  {
    const ledgerStdin = cliTasks(["--tasks", dir, "--next"], MANIFEST);
    check("--next: the stdin advisory follows the printed COMMANDS, not the word `--start` in the prose — under a verdict that dispatches nothing there are no commands for it to qualify",
      () => !/read the manifest from stdin/.test(ledgerStdin.stdout || "") && !/STARTABLE NOW/.test(ledgerStdin.stdout || ""),
      () => ({ status: ledgerStdin.status, stdout: (ledgerStdin.stdout || "").slice(0, 600) }));
  }
  fs.rmSync(base, { recursive: true, force: true });
}
{
  // THE FLAG REFUSALS. Each of these WRITES the folder before the answer would be printed, so a single call would
  // describe a state the reader cannot identify — before the write or after it.
  const base = tmp("cli-next-flags");
  const dir = path.join(base, "build-tasks");
  cliTasks(["--tasks", dir], MANIFEST);
  const someId = readTaskDir(dir)[0].id;
  const splitPath = path.join(base, "split.json");
  fs.writeFileSync(splitPath, JSON.stringify({ planVersion: RUN.planVersion, items: FULL_SPLIT.items }, null, 2));
  for (const [label, args] of [["--start", ["--start", someId]], ["--route", ["--route"]],
    ["--verify", ["--verify", "--built", "nope.json"]], ["--split", ["--split", splitPath]]]) {
    const res = cliTasks(["--tasks", dir, "--next", ...args], MANIFEST);
    check(`--next + ${label}: exit 1 with an actionable message and NO answer printed — the other flag moves the folder, so one call could only describe a state the reader cannot place`,
      () => res.status === 1 && /--next/.test(res.stderr || "") && (res.stdout || "").trim() === "",
      () => ({ label, status: res.status, stdout: res.stdout, stderr: res.stderr }));
  }
  const alone = spawnSync(process.execPath, [MIGRATE, "-", "--next"], { input: JSON.stringify(MANIFEST), encoding: "utf8" });
  check("--next without --tasks: exit 1 — it answers a question about a task FOLDER, and without one there is nothing to answer about",
    () => alone.status === 1 && /--tasks/.test(alone.stderr || ""),
    () => ({ status: alone.status, stderr: alone.stderr }));
  fs.rmSync(base, { recursive: true, force: true });
}
{
{
  /* ==============================================================================================
     `--add` AT THE ARGV LEVEL. The mint path is unit-tested above against `addTasks`; these are the
     things only the CLI decides — which flag combinations it refuses, that a refusal writes nothing,
     and that the success line names the file the caller now has to fill.
     ============================================================================================== */
  const base = tmp("cli-add");
  const dir = path.join(base, "build-tasks");
  cliTasks(["--tasks", dir], MANIFEST);
  const before = fs.readdirSync(dir).length;
  const declFile = (decl, name) => {
    const f = path.join(base, name + ".json");
    fs.writeFileSync(f, JSON.stringify(decl));
    return f;
  };
  // The declaration resolves against the PLAN, not against the folder's task set — the CLI slices with the real
  // default budget, which collapses this fixture into whole-run tasks that carry no page key of their own.
  const GOOD = { ...DECL, id: "cli-orch-add", order: 9, deliverables: ["A minimal page proven to render"] };

  const lone = cliTasks(["--add", declFile(GOOD, "lone")], MANIFEST);
  check("CLI `--add`: without `--tasks <dir>` it exits 1 naming the flag it needs — it adds a task TO a folder, and there is no folder to add to",
    () => lone.status === 1 && /only means something with `--tasks <dir>`/.test(lone.stderr || ""),
    () => ({ status: lone.status, stderr: lone.stderr }));

  const withVerify = cliTasks(["--tasks", dir, "--add", declFile(GOOD, "wv"), "--verify", "--built", path.join(base, "none.json")], MANIFEST);
  check("CLI `--add` + `--verify`: exit 1 — one writes a task and the other judges the folder, so a single call would verify a folder it changed in the same breath",
    () => withVerify.status === 1 && /Run them as separate commands/.test(withVerify.stderr || ""),
    () => ({ status: withVerify.status, stderr: withVerify.stderr }));

  const noJson = path.join(base, "not-json.json");
  fs.writeFileSync(noJson, "{ this is not json");
  const bad = cliTasks(["--tasks", dir, "--add", noJson], MANIFEST);
  check("CLI `--add`: an unparseable declaration exits 1, prints the expected shape, and leaves the folder exactly as it was",
    () => bad.status === 1 && /not valid JSON/.test(bad.stderr || "") && /pageKey/.test(bad.stderr || "")
      && fs.readdirSync(dir).length === before,
    () => ({ status: bad.status, stderr: (bad.stderr || "").slice(0, 300), files: fs.readdirSync(dir).length, before }));

  const unresolved = cliTasks(["--tasks", dir, "--add", declFile({ ...GOOD, pageKey: "child:NOPE" }, "nopage")], MANIFEST);
  check("CLI `--add`: a declaration that does not resolve against the plan exits 1, lists every problem, and writes NOTHING — a partially filed task is a task the folder cannot account for",
    () => unresolved.status === 1 && /does not resolve against this plan/.test(unresolved.stderr || "")
      && fs.readdirSync(dir).length === before,
    () => ({ status: unresolved.status, stderr: (unresolved.stderr || "").slice(0, 400), files: fs.readdirSync(dir).length, before }));

  // A folder whose frozen split falls short of the plan refuses on every other command. `--add` mints files, so
  // it is the one leg that could leave a declared task on disk beside an index nothing regenerated.
  {
    const baseA = tmp("cli-add-drift-base");
    const dirA = path.join(baseA, "build-tasks");
    const splitA = path.join(baseA, "split.json");
    fs.writeFileSync(splitA, JSON.stringify(FULL_SPLIT, null, 2));
    cliTasks(["--tasks", dirA, "--split", splitA], MANIFEST);
    const beforeA = fs.readdirSync(dirA).sort();
    const drifted = cliTasks(["--tasks", dirA, "--add", declFile({ ...GOOD, id: "cli-add-drift" }, "drift")], MANIFEST5);
    check("CLI `--add` on a folder whose cut falls short of the plan writes NOTHING and exits non-zero — every other command refuses that folder, and minting a file here would leave it beside an index nothing regenerated",
      () => drifted.status !== 0
        && /wrote nothing/.test(drifted.stderr || "")
        && /does not cover this plan|no longer covers this plan/.test(drifted.stderr || "")
        && JSON.stringify(fs.readdirSync(dirA).sort()) === JSON.stringify(beforeA),
      () => ({ status: drifted.status, stderr: (drifted.stderr || "").slice(0, 400),
        before: beforeA, after: fs.readdirSync(dirA).sort() }));
    fs.rmSync(baseA, { recursive: true, force: true });
  }

  const ok = cliTasks(["--tasks", dir, "--add", declFile(GOOD, "good")], MANIFEST);
  check("CLI `--add`: a resolving declaration exits 0, and the answer names the file the engine wrote and how many deliverables it carries — the caller's next move is to fill that file's `Outcome` column",
    () => ok.status === 0 && /wrote 1 declared task\(s\)/.test(ok.stdout || "")
      && /1 deliverable\(s\)/.test(ok.stdout || "") && fs.readdirSync(dir).length === before + 1,
    () => ({ status: ok.status, stdout: ok.stdout, stderr: ok.stderr, files: fs.readdirSync(dir).length, before }));
  check("CLI `--add`: the file it wrote is a task the derivation can read — engine-authored table, declared rows, no outcome yet, so it reads `todo` like any freshly cut task",
    () => {
      const added = readTaskDir(dir).find((t) => t.id === GOOD.id);
      return !!added && added.rows.length === 1 && added.status === "todo"
        && added.rows[0].label === GOOD.deliverables[0] && added.origin === "orchestrator";
    }, () => { const a = readTaskDir(dir).find((t) => t.id === GOOD.id);
      return a ? { rows: a.rows.length, status: a.status, origin: a.origin, label: a.rows[0]?.label } : "not found"; });
  fs.rmSync(base, { recursive: true, force: true });
}

  // A plan-level gap: `--next` refuses on exactly the terms every other task-folder mode refuses on.
  const skeletal = { ...MANIFEST, seed: [{ pkg: "BaseModulePageV2", body: 'define("BaseModulePageV2",[],function(){return{diff:[{operation:"insert",name:"ProfileContainer",values:{itemType:15}},{operation:"insert",name:"Tabs",values:{itemType:15}}],methods:{init:function(){return 1;}}};});' }] };
  const base = tmp("cli-next-gap");
  const dir = path.join(base, "build-tasks");
  const res = cliTasks(["--tasks", dir, "--next"], skeletal);
  check("--next: a plan-level gap answers with the same refusal every other task-folder mode gives and creates NOTHING — a scheduling answer over a plan that is not buildable-out-of would schedule work against deliverables the plan cannot state",
    () => res.status === 2 && /NOTHING WRITTEN — no task folder for a plan with gaps/.test(res.stdout || "")
      && !fs.existsSync(dir),
    () => ({ status: res.status, stdout: res.stdout, exists: fs.existsSync(dir) }));
  fs.rmSync(base, { recursive: true, force: true });
}

console.log(`\n=================\nTASK-SLICING GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

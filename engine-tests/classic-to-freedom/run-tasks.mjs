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
import { buildTaskSet, mergeTaskSet, parseTaskFile, renderTaskFile, renderTaskIndex, syncTaskDir,
  taskFileName, TASK_STATUSES, TASK_ORIGINS, TASK_INDEX_FILE, TASK_BUDGET,
  ARTIFACT_SCAFFOLD, ARTIFACT_REFS, REFS_DIR, buildRepairTasks, syncRepairDir,
  REPAIR_ROUND_CAP, buildTaskSetFromSplit, taskSetFor } from "../../skills/classic-to-freedom-migration/engine/tasks.mjs";
import { parseSplit, resolveSplit, rowKey, SPLIT_FILE } from "../../skills/classic-to-freedom-migration/engine/split.mjs";

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
   with fewer than 5 as skeletal (#19), and a BLOCKED plan is exactly what `--tasks` refuses to slice —
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

const MANIFEST = manifestOf();
const OPTS = checklistOpts(MANIFEST);            // the SAME opts `buildTaskSet` forwards to `checklistGroups`
const RUN = runMigration(MANIFEST);
const SET = buildTaskSet(RUN, OPTS);
const GROUPS = checklistGroups(RUN, OPTS);

// B — the same plan with one page INSERTED (a second child page).
const MANIFEST2 = manifestOf({ extraChild: true });
const OPTS2 = checklistOpts(MANIFEST2);
const RUN2 = runMigration(MANIFEST2);
const SET2 = buildTaskSet(RUN2, OPTS2);

// C — the same plan with the same pages, but one task's DELIVERABLE ROWS changed (an extra form field). Kept apart
// from B on purpose: drift is about a row set moving under a recorded status, not about the page set moving.
const MANIFEST3 = manifestOf({ extraField: true });
const OPTS3 = checklistOpts(MANIFEST3);
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
const OPTS4 = checklistOpts(MANIFEST4);
const RUN4 = runMigration(MANIFEST4);
const SET4 = buildTaskSet(RUN4, OPTS4);

// E — the same plan grown past the budget, so `page:main` is CUT into chunks. Everything about chunking below is
// vacuous on a plan small enough to stay monolithic, which manifests A-D all are.
const MANIFEST5 = manifestOf({ bulk: 40 });
const OPTS5 = checklistOpts(MANIFEST5);
const RUN5 = runMigration(MANIFEST5);
const SET5 = buildTaskSet(RUN5, OPTS5);
// F — E with ONE more field. Under count-derived chunk numbering every chunk after the first shifts and every
// status recorded against them orphans; under a structural anchor the chunks keep their ids.
const MANIFEST6 = manifestOf({ bulk: 41 });
const SET6 = buildTaskSet(runMigration(MANIFEST6), checklistOpts(MANIFEST6));

// The reference cache is a RUN-level task, not a page's — it is excluded wherever the question is about pages.
const pageTasks = (set) => set.tasks.filter((t) => t.artifact !== ARTIFACT_REFS);
const keysOf = (set) => [...new Set(pageTasks(set).map((t) => t.pageKey))];
const taskAt = (set, pageKey, group) => set.tasks.find((t) => t.pageKey === pageKey && t.group === group);
const orderOf = (set, pageKey, group) => taskAt(set, pageKey, group)?.order;
const artifactsOf = (set) => [...new Set(set.tasks.map((t) => t.artifact))];
const tasksOn = (set, artifact) => set.tasks.filter((t) => t.artifact === artifact);
const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `c2f_tasks_${label}_`));
const readIndex = (dir) => fs.readFileSync(path.join(dir, TASK_INDEX_FILE), "utf8");

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
check("buildTaskSet: a row keeps the plan GROUP it was read from — a task now spans several groups, so without it the file would no longer say which part of the plan a deliverable belongs to",
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
check("refs: it names one spec slice per PAGE the plan publishes — a builder reads its own page's slice instead of cutting rows out of the whole design spec",
  () => keysOf(SET).every((k) => REFS.rows.some((r) => r.label.includes(`${REFS_DIR}/spec-`) && r.label.includes(`\`${k}\``))),
  () => ({ keys: keysOf(SET), rows: REFS.rows.map((r) => r.label.slice(0, 60)) }));
check("refs: it names the shared files by PATH — contracts, components and the guidance topics, plus the index whose TIERS are the invalidation story",
  () => [`${REFS_DIR}/contracts.md`, `${REFS_DIR}/components.md`, `${REFS_DIR}/guidance-`, `${REFS_DIR}/index.md`]
    .every((f) => REFS.rows.some((r) => r.label.includes(f)))
    && REFS.rows.some((r) => /stable-docs/.test(r.label) && /environment/.test(r.label) && /plan/.test(r.label)),
  () => REFS.rows.map((r) => r.label.slice(0, 80)));
check("refs: the rendered file carries the two rules that keep the cache from becoming a defect — contracts are fetched BY NAME (argument-less dumps the whole catalogue into a file every builder reads) and the component doc records the STAND it came from, because a component contract is environment-specific",
  () => {
    const text = renderTaskFile(REFS, SET);
    return /ENVIRONMENT it was read from/.test(text) && /Never argument-less/.test(text);
  }, () => renderTaskFile(REFS, SET));
check("refs: a cache big enough to be CUT is chained like any other artifact — chunk 2 waits on chunk 1, and every build task still waits on the whole cache rather than on whichever chunk happened to be last",
  () => {
    const tight = buildTaskSet(RUN, { ...OPTS, taskBudget: { chunk: 4 } });
    const refs = tight.tasks.filter((t) => t.artifact === ARTIFACT_REFS);
    if (refs.length < 2) return false;
    const ids = refs.map((t) => t.id);
    return refs[0].dependsOn.length === 0
      && refs.slice(1).every((t, i) => t.dependsOn.includes(refs[i].id))
      && tight.tasks.filter((t) => t.artifact !== ARTIFACT_REFS)
        .every((t) => ids.every((id) => t.dependsOn.includes(id)));
  }, () => buildTaskSet(RUN, { ...OPTS, taskBudget: { chunk: 4 } }).tasks
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
    const tight = buildTaskSet(RUN5, { ...OPTS5, taskBudget: { chunk: 8 } });
    const loose = buildTaskSet(RUN5, { ...OPTS5, taskBudget: { chunk: 10000 } });
    return typeof TASK_BUDGET.chunk === "number"
      && tight.tasks.filter((t) => t.artifact === "page:main").length > tasksOn(SET5, "page:main").length
      && loose.tasks.filter((t) => t.artifact === "page:main").length === 1;
  }, () => ({ declared: TASK_BUDGET,
    tight: buildTaskSet(RUN5, { ...OPTS5, taskBudget: { chunk: 8 } }).tasks.filter((t) => t.artifact === "page:main").length,
    loose: buildTaskSet(RUN5, { ...OPTS5, taskBudget: { chunk: 10000 } }).tasks.filter((t) => t.artifact === "page:main").length }));

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
check("renderTaskFile: the deliverable block is marked ENGINE-OWNED and the notes block is marked as the caller's — the two ownerships are stated in the file, not only in the module",
  /ENGINE-OWNED\. Rewritten from the plan on every/.test(SAMPLE_TEXT) && /YOURS\. Never rewritten/.test(SAMPLE_TEXT),
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
check("duplicate id: when two files claim one `id` the engine can no longer tell whose record it holds, so BOTH are refused and named — never a coin flip on `readdir` order that overwrites one of them",
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
check("stale: an engine task that is no longer in the plan is reported as `stale` rather than being dropped silently",
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
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("status: todo", "status: done") + "\nguidelines pass filed as ev-7\n");
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
    () => fs.readFileSync(orchPath, "utf8") === ORCH_BODY
      && fifth.tasks.some((t) => t.origin === "orchestrator" && t.file === ORCH_FILE)
      && readIndex(dir).includes(`[${ORCH_FILE}](${ORCH_FILE})`),
    () => ({ unchanged: fs.readFileSync(orchPath, "utf8") === ORCH_BODY, index: readIndex(dir) }));
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
      fs.writeFileSync(dp, fs.readFileSync(dp, "utf8").replace("status: todo", "status: done"));
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
  // Grow the plan (manifest B), then shrink it back: `child:C2`'s files are on disk while the plan no longer has them.
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
check("split: a complete cut builds a task per ITEM — the seams are the file's, and the engine's own budget no longer decides them",
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
check("split: a plan row in NO item is REPORTED by name and the engine picks no owner — which item a row belongs to is exactly the judgement the split records, so guessing would undo the point of having one",
  () => {
    const set = buildTaskSetFromSplit(RUN, SHORT_SPLIT(), OPTS);
    return !set.refused && set.added.length === 1
      && set.problems.some((p) => /is in NO item/.test(p) && /will not pick an owner/.test(p));
  }, () => buildTaskSetFromSplit(RUN, SHORT_SPLIT(), OPTS).problems);
check("split: the unplaced row reaches the INDEX too — a caller who reads the folder rather than the command output must meet the same gap",
  () => {
    const idx = renderTaskIndex(mergeTaskSet(buildTaskSetFromSplit(RUN, SHORT_SPLIT(), OPTS), []));
    return /## Attention/.test(idx) && /is in NO item/.test(idx);
  }, () => renderTaskIndex(mergeTaskSet(buildTaskSetFromSplit(RUN, SHORT_SPLIT(), OPTS), [])));
check("split: matching MASKS DIGITS, so a plan that gains a field does not stop the split resolving — the counts are exactly what a growing plan moves, and a cut that needed re-deciding on every added field would not be worth freezing",
  () => {
    const set3 = buildTaskSetFromSplit(RUN3, FULL_SPLIT, OPTS3);   // C: `Fields — 1 expected` became `2 expected`
    return !set3.refused && set3.added.length === 0
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
check("repair: the rendered file shows what `--verify` ACTUALLY SAW per row — a sub-agent sent to fix a row needs the gate's own status and evidence, because re-describing it is how a round gets spent on a row that was never the problem",
  () => {
    const t = buildRepairTasks(RUN, VERIFY_PAGES, OPTS, []).tasks[0];
    const text = renderTaskFile(t, SET);
    return /\| # \| Deliverable \| `--verify` said \| Evidence it read \|/.test(text)
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

console.log("\n===== migrate.mjs --tasks <dir> (CLI) =====");
const cliTasks = (args, manifest) => spawnSync(process.execPath, [MIGRATE, "-", ...args], { input: JSON.stringify(manifest), encoding: "utf8" });
{
  const base = tmp("cli");
  const dir = path.join(base, "build-tasks");   // deliberately NOT pre-created: the mode must create it
  const run = cliTasks(["--tasks", dir], MANIFEST);
  check("migrate.mjs --tasks: a gate-clean plan exits 0, creates the directory, writes one file per task plus the index, and prints a note naming the count and the index to present",
    () => run.status === 0 && fs.existsSync(path.join(dir, TASK_INDEX_FILE))
      && new RegExp(String.raw`wrote ${SET.tasks.length} build task\(s\) \+ ${TASK_INDEX_FILE}`).test(run.stdout || "")
      && /Hand ONE task file at a time to a build sub-agent/.test(run.stdout || ""),
    () => ({ status: run.status, stdout: run.stdout, stderr: run.stderr, ls: fs.existsSync(dir) ? fs.readdirSync(dir) : null }));
  check("migrate.mjs --tasks: with nothing recorded yet the note says 0 done and prints NO ⚠ line — a clean slice must not ask for a human eye it does not need",
    () => new RegExp(String.raw`— 0 done, ${SET.tasks.length} not\.`).test(run.stdout || "") && !/need a human eye/.test(run.stdout || ""),
    () => run.stdout);
  // An unrecognised status recorded by hand: the ⚠ stdout line is the other half of "reported, never coerced".
  const victim = path.join(dir, taskAt(SET, "main", SCAFFOLD_LABEL).file);
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
  check("migrate.mjs --split: a re-slice with NO `--split` reads the frozen copy and produces the same tasks — the cut does not get re-decided, so a recorded `done` cannot move to a task that no longer exists",
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
  check("migrate.mjs --split: an unplaced plan row does NOT block the folder but IS said on stdout — the work is schedulable, one row of it simply has no owner, and that has to be loud rather than fatal",
    () => run.status === 0 && /are in NO item/.test(run.stdout || "")
      && /will not pick an owner/.test(fs.readFileSync(path.join(dir, TASK_INDEX_FILE), "utf8")),
    () => ({ stdout: run.stdout, idx: fs.readFileSync(path.join(dir, TASK_INDEX_FILE), "utf8").slice(-500) }));
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
  check("migrate.mjs --verify --tasks: the ONE legal pairing — `--verify` is still the mode and the folder is where its OPEN ROWS are written, so the table is printed AND the repair round lands",
    () => run.status === 2 && /Plan-vs-Done — VERIFIED/.test(run.stdout || "")
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
      return fs.readFileSync(p1, "utf8") === before
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

console.log(`\n=================\nTASK-SLICING GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

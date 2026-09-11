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
  taskFileName, TASK_STATUSES, TASK_ORIGINS, TASK_INDEX_FILE } from "../../skills/classic-to-freedom-migration/engine/tasks.mjs";

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
const mainBody = ({ extraChild, extraField }) => {
  const dets = ['R1:{schemaName:"R1D",entitySchemaName:"C1",filter:{detailColumn:"m",masterColumn:"Id"}}'];
  const items = ['{operation:"insert",name:"R1",parentName:"T",values:{itemType:2}}'];
  if (extraChild) {
    dets.push('R2:{schemaName:"R2D",entitySchemaName:"C2",filter:{detailColumn:"m",masterColumn:"Id"}}');
    items.push('{operation:"insert",name:"R2",parentName:"T",values:{itemType:2}}');
  }
  items.push('{operation:"insert",name:"MainF",parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"MainF"}}');
  if (extraField) items.push('{operation:"insert",name:"MainF2",parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"MainF2"}}');
  return `define("MPage",[],function(){return{entitySchemaName:"M",details:{${dets.join(",")}},diff:[{operation:"insert",name:"T",parentName:"Tabs",values:{itemType:15,isTab:true}},${items.join(",")}]};});`;
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
const DRIFT_GROUP = "Form — Coverage (verified)";

const keysOf = (set) => [...new Set(set.tasks.map((t) => t.pageKey))];
const taskAt = (set, pageKey, group) => set.tasks.find((t) => t.pageKey === pageKey && t.group === group);
const orderOf = (set, pageKey, group) => taskAt(set, pageKey, group)?.order;
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

console.log("\n===== buildTaskSet: one task per (pageKey, group), rows verbatim =====");
check("buildTaskSet: there is EXACTLY one task per (pageKey, group) of `checklistGroups` — no group without a task, no task without a group, nothing invented and nothing collapsed",
  () => {
    const byName = (a, b) => a.localeCompare(b);
    const gKeys = GROUPS.map((g) => `${g.pageKey} ${g.baseTitle}`).sort(byName);
    const tKeys = SET.tasks.map((t) => `${t.pageKey} ${t.group}`).sort(byName);
    return gKeys.length === tKeys.length && new Set(tKeys).size === tKeys.length && gKeys.every((k, i) => k === tKeys[i]);
  }, () => ({ groups: GROUPS.map((g) => `${g.pageKey}·${g.baseTitle}`), tasks: SET.tasks.map((t) => `${t.pageKey}·${t.group}`) }));
check("buildTaskSet: a task's rows are its group's rows VERBATIM and in the same order — the task carries what the plan says and adds nothing, so nothing can be in a task that `--verify` will not later ask about",
  () => GROUPS.every((g) => {
    const t = taskAt(SET, g.pageKey, g.baseTitle);
    return t && t.rows.length === g.rows.length && t.rows.every((r, i) => r.label === g.rows[i].label);
  }), () => GROUPS.filter((g) => {
    const t = taskAt(SET, g.pageKey, g.baseTitle);
    return !t || t.rows.length !== g.rows.length || t.rows.some((r, i) => r.label !== g.rows[i].label);
  }).map((g) => ({ group: `${g.pageKey}·${g.baseTitle}`, planRows: g.rows.map((r) => r.label) })));
check("buildTaskSet: `gatedRows` / `naRows` are COUNTED off the plan's own rows, not restated — each equals the number of rows carrying a `vk` / an `na` in the matching group",
  () => GROUPS.every((g) => {
    const t = taskAt(SET, g.pageKey, g.baseTitle);
    return t.gatedRows === g.rows.filter((r) => r.vk).length && t.naRows === g.rows.filter((r) => r.na).length;
  }), () => SET.tasks.map((t) => ({ t: `${t.pageKey}·${t.group}`, gated: t.gatedRows, na: t.naRows })));
check("buildTaskSet: every task is `origin: engine` / `status: todo` out of the box, and both values are in the published vocabularies",
  SET.tasks.every((t) => t.origin === "engine" && t.status === "todo")
  && TASK_ORIGINS.includes("engine") && TASK_ORIGINS.includes("orchestrator") && TASK_STATUSES[0] === "todo",
  () => ({ origins: TASK_ORIGINS, statuses: TASK_STATUSES }));
check("buildTaskSet: `order` is a dense 1..N sequence over the whole set — the orchestrator walks it as a queue, so a hole or a duplicate is a task nobody is handed",
  SET.tasks.every((t, i) => t.order === i + 1), () => SET.tasks.map((t) => t.order));

console.log("\n===== build order: leaf-first across pages, worklist-first within a page =====");
check("build order: `main · Pages` LEADS the whole run — it is not a page's layout but the app/section/package placement, the entity binding and the page shells, so a child page built before it would need a package that does not exist yet",
  () => SET.tasks[0].pageKey === "main" && SET.tasks[0].group === "Pages",
  () => SET.tasks.slice(0, 3).map((t) => `${t.order}:${t.pageKey}·${t.group}`));
check("build order: apart from that scaffolding task, EVERY sub-page's tasks come before `main`'s — leaf-first is a build requirement, not a preference: a related list's Add/Edit opens the child's own form, so the child page must exist before the parent list is wired to it",
  () => {
    const mainBuild = SET.tasks.filter((t) => t.pageKey === "main" && t.group !== "Pages");
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
check("build order: within a page the `⚠ Confirm worklist` is FIRST of its own build groups (the run-leading scaffolding task aside) — its rows are open questions answered by reading the stand, and resolving them after the page is built is how a page gets built against a guess",
  () => ["main", "child:C1", "child:G1", LIST_PAGE_KEY].every((k) => {
    const own = SET.tasks.filter((t) => t.pageKey === k && !(k === "main" && t.group === "Pages"));
    const confirm = own.find((t) => t.group === "⚠ Confirm worklist");
    return !confirm || confirm.order === Math.min(...own.map((t) => t.order));
  }), () => SET.tasks.map((t) => `${t.order}:${t.pageKey}·${t.group}`));
check("build order: within a page `Quality gates` is LAST — the `creatio-ui-guidelines` pass needs a page to look at",
  () => ["main", "child:C1", "child:G1", LIST_PAGE_KEY].every((k) => {
    const own = SET.tasks.filter((t) => t.pageKey === k);
    const gates = own.find((t) => t.group === "Quality gates");
    return !gates || gates.order === Math.max(...own.map((t) => t.order));
  }), () => SET.tasks.map((t) => `${t.order}:${t.pageKey}·${t.group}`));
check("build order: a page's tasks are CONTIGUOUS — no other page's task is interleaved into the middle of one page's build (main's scaffolding task is the one declared exception: it leads the run)",
  () => keysOf(SET).every((k) => {
    const orders = SET.tasks.filter((t) => t.pageKey === k && !(k === "main" && t.group === "Pages"))
      .map((t) => t.order).sort((a, b) => a - b);
    return orders.at(-1) - orders[0] === orders.length - 1;
  }), () => SET.tasks.map((t) => `${t.order}:${t.pageKey}·${t.group}`));

console.log("\n===== ids are content-derived, not positional =====");
check("ids: inserting a page into the plan does NOT renumber any id — every (pageKey, group) that survives keeps the SAME `id` across manifest A and B, so a recorded status stays attached to its own task",
  () => SET.tasks.every((t) => taskAt(SET2, t.pageKey, t.group)?.id === t.id),
  () => SET.tasks.filter((t) => taskAt(SET2, t.pageKey, t.group)?.id !== t.id)
    .map((t) => ({ task: `${t.pageKey}·${t.group}`, a: t.id, b: taskAt(SET2, t.pageKey, t.group)?.id })));
check("ids: `order` IS the field that moves — the inserted page pushes `main`'s Confirm worklist further down the queue while its id stands still (else the check above would be vacuous)",
  () => orderOf(SET2, "main", "⚠ Confirm worklist") > orderOf(SET, "main", "⚠ Confirm worklist"),
  () => ({ a: orderOf(SET, "main", "⚠ Confirm worklist"), b: orderOf(SET2, "main", "⚠ Confirm worklist") }));
check("ids: a task whose ROWS changed is the SAME task with a changed deliverable, not a new task whose status resets — the added form field moves `main · Form — Coverage (verified)`'s `rowsDigest` while its `id` stands still",
  () => {
    const a = taskAt(SET, "main", DRIFT_GROUP), c = taskAt(SET3, "main", DRIFT_GROUP);
    return a.id === c.id && a.rowsDigest !== c.rowsDigest;
  }, () => ({ a: taskAt(SET, "main", DRIFT_GROUP), c: taskAt(SET3, "main", DRIFT_GROUP) }));
check("ids: an id is unique across the set, and distinct (pageKey, group) pairs never collide — two pages carry the identically-named `Quality gates` group and get different ids",
  () => new Set(SET.tasks.map((t) => t.id)).size === SET.tasks.length
    && taskAt(SET, "main", "Quality gates").id !== taskAt(SET, "child:C1", "Quality gates").id,
  () => SET.tasks.map((t) => `${t.id} ${t.pageKey}·${t.group}`));
check("taskFileName: the file name carries the id as well as a slug — non-Latin captions all strip to the same characters, so a slug ALONE would be many-to-one",
  () => SET.tasks.every((t) => t.file === taskFileName(t) && t.file.endsWith(`-${t.id}.md`))
    && new Set(SET.tasks.map((t) => t.file)).size === SET.tasks.length
    && taskFileName({ pageKey: "Ω", group: "✅", id: "abcd1234" }) === "task-task-abcd1234.md",
  () => SET.tasks.map((t) => t.file));

console.log("\n===== the task FILE: rendered, and read back =====");
const SAMPLE = taskAt(SET, "child:C1", "Form — Coverage (verified)");
const SAMPLE_TEXT = renderTaskFile(SAMPLE, SET);
check("renderTaskFile: the front matter carries the identity and the recorded state the next run reads back — id, status, origin, pageKey, group, order, rowsDigest",
  () => {
    const { meta, malformed } = parseTaskFile(SAMPLE_TEXT);
    return !malformed && meta.id === SAMPLE.id && meta.status === "todo" && meta.origin === "engine"
      && meta.pageKey === SAMPLE.pageKey && meta.group === SAMPLE.group && meta.order === String(SAMPLE.order)
      && meta.rowsDigest === SAMPLE.rowsDigest;
  }, () => parseTaskFile(SAMPLE_TEXT));
check("renderTaskFile: every deliverable row of the task is in the rendered table, numbered, with the mechanism that CLOSES it — a machine-checked row names `--verify` and its verifier kind",
  () => SAMPLE.rows.length > 0 && SAMPLE.rows.every((r, i) => new RegExp(String.raw`^\| ${i + 1} \| `, "m").test(SAMPLE_TEXT))
    && SAMPLE.rows.some((r) => r.vk)
    && SAMPLE.rows.filter((r) => r.vk).every((r) => SAMPLE_TEXT.includes("`--verify` (`" + r.vk + "`)")),
  () => SAMPLE_TEXT);
check("renderTaskFile: a row with no machine verifier is closed by an evidence record plus a judge verdict, and an approved-boundary row is marked N/A — the mechanism is stated per row, never left to the builder",
  () => {
    const t = { ...SAMPLE, rows: [{ label: "prose row", vk: null, na: null }, { label: "out of scope", vk: null, na: "agreed boundary" }] };
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
  asExisting(taskAt(SET, "main", "Pages"), { status: "in-progress" }, "half of the pages minted"),
  asExisting(taskAt(SET, "child:G1", "Quality gates"), { status: "done" }, "guidelines pass clean"),
]);
check("mergeTaskSet: a re-run KEEPS the caller's recorded `status` — the plan's rows are the engine's, the status is not",
  () => taskAt(MERGED, "main", "Pages").status === "in-progress" && taskAt(MERGED, "child:G1", "Quality gates").status === "done",
  () => MERGED.tasks.map((t) => `${t.pageKey}·${t.group}=${t.status}`));
check("mergeTaskSet: a re-run KEEPS the caller's `## Notes` — the record of what was built, what was filed and what blocked is never the engine's to overwrite",
  () => taskAt(MERGED, "main", "Pages").notes === "half of the pages minted"
    && taskAt(MERGED, "child:G1", "Quality gates").notes === "guidelines pass clean",
  () => MERGED.tasks.map((t) => `${t.pageKey}·${t.group}=${JSON.stringify(t.notes)}`));
check("mergeTaskSet: a task with no recorded state is untouched — merging does not invent a status or a note for a task the caller never opened",
  () => MERGED.tasks.filter((t) => t.status !== "todo").length === 2
    && MERGED.tasks.filter((t) => t.notes !== "").length === 2,
  () => MERGED.tasks.map((t) => `${t.status}:${JSON.stringify(t.notes)}`));
check("mergeTaskSet: a file the caller RENAMED keeps its name — the id is the identity, the file name is for a human opening the folder",
  () => {
    const t = taskAt(SET, "main", "Pages");
    const m = mergeTaskSet(SET, [{ ...asExisting(t), file: "01-do-the-pages-first.md" }]);
    return taskAt(m, "main", "Pages").file === "01-do-the-pages-first.md";
  });
check("mergeTaskSet: the engine's deliverable rows always LOSE to the current plan — a stale recorded row set is replaced by the plan's, and the fresh `rowsDigest` is what the rewritten file carries",
  () => {
    const t = taskAt(SET2, "main", "Pages");
    const m = mergeTaskSet(SET2, [asExisting(taskAt(SET, "main", "Pages"), { status: "in-progress" })]);
    const got = taskAt(m, "main", "Pages");
    return got.rows.length === t.rows.length && got.rowsDigest === t.rowsDigest
      && got.rows.every((r, i) => r.label === t.rows[i].label);
  }, () => taskAt(mergeTaskSet(SET2, [asExisting(taskAt(SET, "main", "Pages"))]), "main", "Pages"));

console.log("\n===== an unrecognised status is reported, never coerced =====");
const BOGUS = mergeTaskSet(SET, [asExisting(taskAt(SET, "main", "Pages"), { status: "kinda-done" })]);
check("status vocabulary: an unrecognised `status` is carried through AS-IS, never folded into `todo` — a mistyped status that silently read as 'not done' would re-dispatch a sub-agent onto a page that is already built",
  taskAt(BOGUS, "main", "Pages").status === "kinda-done" && !TASK_STATUSES.includes("kinda-done"),
  () => taskAt(BOGUS, "main", "Pages"));
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
    const t = taskAt(SET, "main", "Pages");
    const m = mergeTaskSet(SET, [{ file: t.file, notes: "", malformed: "front matter is not terminated", meta: { id: t.id } }]);
    return (m.blocked || []).some((b) => b.file === t.file && /front matter is not terminated/.test(b.reason))
      && renderTaskIndex(m).includes("NOT READ and NOT WRITTEN");
  }, () => mergeTaskSet(SET, [{ file: taskAt(SET, "main", "Pages").file, notes: "", malformed: "front matter is not terminated", meta: { id: taskAt(SET, "main", "Pages").id } }]).blocked);
check("unreadable file: a file with NO readable `id` is refused the same way — filtering it out as absent is what let a corrupted file's notes be overwritten by a task the engine then read as new",
  () => {
    const m = mergeTaskSet(SET, [{ file: "task-hand-edited.md", notes: "built already", malformed: "no front matter", meta: {} }]);
    return (m.blocked || []).some((b) => b.file === "task-hand-edited.md") && renderTaskIndex(m).includes("task-hand-edited.md");
  }, () => mergeTaskSet(SET, [{ file: "task-hand-edited.md", notes: "x", malformed: "no front matter", meta: {} }]).blocked);
check("unreadable file: its QUEUE ROW says `⚠ unread`, never the fresh task's default `todo` — the refused file may record `done`, and reading `todo` off the queue is how a sub-agent gets dispatched onto a page that is already built",
  () => {
    const t = taskAt(SET, "main", "Pages");
    const m = mergeTaskSet(SET, [{ file: t.file, notes: "built already", malformed: "no front matter", meta: {} , }]);
    const broken = mergeTaskSet(SET, [{ file: t.file, notes: "x", malformed: "front matter is not terminated", meta: { id: t.id } }]);
    const idx = renderTaskIndex(broken);
    const row = idx.split("\n").find((l) => l.includes(t.file) && l.startsWith("|"));
    return m.blocked.length === 1 && /⚠ unread/.test(row) && !/☐ todo/.test(row);
  }, () => renderTaskIndex(mergeTaskSet(SET, [{ file: taskAt(SET, "main", "Pages").file, notes: "x", malformed: "front matter is not terminated", meta: { id: taskAt(SET, "main", "Pages").id } }])));
check("unreadable file: it counts as `Other`, not as an OPEN task — the queue must not claim to know a status nobody recorded",
  () => {
    const t = taskAt(SET, "main", "Pages");
    const idx = renderTaskIndex(mergeTaskSet(SET, [{ file: t.file, notes: "x", malformed: "front matter is not terminated", meta: { id: t.id } }]));
    return /\*\*Other:\*\* 1/.test(idx) && new RegExp(String.raw`\*\*Open:\*\* ${SET.tasks.length - 1}`).test(idx);
  }, () => renderTaskIndex(mergeTaskSet(SET, [{ file: taskAt(SET, "main", "Pages").file, notes: "x", malformed: "front matter is not terminated", meta: { id: taskAt(SET, "main", "Pages").id } }])).split("\n")[2]);
check("duplicate id: when two files claim one `id` the engine can no longer tell whose record it holds, so BOTH are refused and named — never a coin flip on `readdir` order that overwrites one of them",
  () => {
    const t = taskAt(SET, "main", "Pages");
    const m = mergeTaskSet(SET, [asExisting(t, { status: "done" }), { ...asExisting(t, { status: "in-progress" }), file: "task-copy.md" }]);
    const files = new Set((m.blocked || []).map((b) => b.file));
    return files.has(t.file) && files.has("task-copy.md")
      && (m.blocked || []).every((b) => /claimed by more than one file/.test(b.reason));
  }, () => mergeTaskSet(SET, [asExisting(taskAt(SET, "main", "Pages"), { status: "done" }), { ...asExisting(taskAt(SET, "main", "Pages"), { status: "in-progress" }), file: "task-copy.md" }]).blocked);
check("duplicate id: an ORCHESTRATOR file carrying an engine task's `id` never becomes that task's record — copying a task file as a template would otherwise have the engine write the plan's rows into the file it promises never to rewrite",
  () => {
    const t = taskAt(SET, "main", "Pages");
    const orch = { ...asExisting(t, { status: "in-progress" }), file: "task-orch-copy.md", meta: { ...asExisting(t, { status: "in-progress" }).meta, origin: "orchestrator" } };
    const m = mergeTaskSet(SET, [orch]);
    const same = m.tasks.find((x) => x.id === t.id);
    return same.origin === "engine" && same.file === t.file && same.status === "todo";
  }, () => mergeTaskSet(SET, [{ ...asExisting(taskAt(SET, "main", "Pages"), { status: "in-progress" }), file: "task-orch-copy.md", meta: { ...asExisting(taskAt(SET, "main", "Pages"), { status: "in-progress" }).meta, origin: "orchestrator" } }]).tasks.filter((x) => x.id === taskAt(SET, "main", "Pages").id));

check("duplicate id: that orchestrator file is REFUSED by name rather than dropped — a file that appears in no queue row and on no `## Attention` line is one `syncTaskDir` would happily write the engine task over",
  () => {
    const t = taskAt(SET, "main", "Pages");
    const orch = { ...asExisting(t, { status: "in-progress" }), file: "task-orch-copy.md", meta: { ...asExisting(t, { status: "in-progress" }).meta, origin: "orchestrator" } };
    const m = mergeTaskSet(SET, [orch]);
    const b = (m.blocked || []).find((x) => x.file === "task-orch-copy.md");
    return Boolean(b) && /also claimed by an engine task/.test(b.reason) && b.id === t.id
      && m.tasks.find((x) => x.id === t.id).unread === true;
  }, () => mergeTaskSet(SET, [{ ...asExisting(taskAt(SET, "main", "Pages"), { status: "in-progress" }), file: "task-orch-copy.md", meta: { ...asExisting(taskAt(SET, "main", "Pages"), { status: "in-progress" }).meta, origin: "orchestrator" } }]).blocked);
check("unreadable file: the refusal is linked by `id`, not by filename — a corrupted file the caller RENAMED still makes its task read `unread`, or the queue would dispatch a sub-agent onto a page whose only record (possibly `done`) sits in that file",
  () => {
    const t = taskAt(SET, "main", "Pages");
    const m = mergeTaskSet(SET, [{ file: "renamed-by-hand.md", notes: "", malformed: "front matter is not terminated", meta: { id: t.id } }]);
    const same = m.tasks.find((x) => x.id === t.id);
    return same.unread === true && (m.blocked || []).some((b) => b.file === "renamed-by-hand.md" && b.id === t.id);
  }, () => mergeTaskSet(SET, [{ file: "renamed-by-hand.md", notes: "", malformed: "front matter is not terminated", meta: { id: taskAt(SET, "main", "Pages").id } }]).tasks.filter((x) => x.id === taskAt(SET, "main", "Pages").id));

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

console.log("\n===== an engine task that left the plan becomes stale, and is NOT deleted =====");
const GONE = mergeTaskSet(SET, [asExisting(taskAt(SET2, "child:C2", "Pages"), { status: "done" }, "built on the stand already")]);
check("stale: an engine task that is no longer in the plan is reported as `stale` rather than being dropped silently",
  () => (GONE.stale || []).length === 1 && GONE.stale[0].file === taskAt(SET2, "child:C2", "Pages").file
    && !GONE.tasks.some((t) => t.id === taskAt(SET2, "child:C2", "Pages").id),
  () => GONE.stale);
check("stale: it is listed on the index with the reason it is KEPT — deleting the file is how a record of work already done on a stand disappears",
  () => {
    const idx = renderTaskIndex(GONE);
    return /## Attention/.test(idx) && /no longer in the plan \(kept, not deleted/.test(idx)
      && idx.includes(taskAt(SET2, "child:C2", "Pages").file);
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
      const ep = path.join(dir, taskAt(fifth, "main", "Pages").file);
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
  const c2File = taskAt(SET2, "child:C2", "Pages").file;
  check("syncTaskDir: a RENAMED corrupted file gets no duplicate written beside it — the fresh `todo` file the engine would otherwise emit is a second record for one task, and the queue would schedule the wrong one",
    () => {
      const d2 = tmp("renamed");
      const t = taskAt(SET, "main", "Pages");
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
  const victim = path.join(dir, taskAt(SET, "main", "Pages").file);
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

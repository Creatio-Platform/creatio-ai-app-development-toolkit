// PAGES THAT WRITE DATA WHEN THEY OPEN. The benchmark Classic Contracts page assigns the next contract
// number in add mode: `onEntityInitialized` calls `mbAssignNumber`, which posts `MbContractLastNumber + 1` back to
// the system setting. Browser checks open pages, so on the v2 benchmark run the consent probe and one builder
// consumed 2 contract numbers and neither the plan nor the result said so. These checks hold the four places that
// now carry it: the method facts (what a body writes), the page walk (which writes run while the page opens), the
// plan and the task files (which pages are kept to edit mode), and the result report (which data the run changed).
// Imported and run by `run-mapper.mjs`, which hands it its `check` and the shared fixtures so the tally stays one number.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSchema, mergeHierarchy } from "../../skills/classic-to-freedom-migration/engine/engine.mjs";
import { writesOnOpen } from "../../skills/classic-to-freedom-migration/engine/mapper.mjs";
import { dataWritingPages } from "../../skills/classic-to-freedom-migration/engine/designspec.mjs";
import { buildTaskSet, renderTaskFile, dataWritingBlock, syncTaskDir, worklogFieldValues, addModeChecks, notesMarkers,
  STAND_DATA_FIELD, ADD_MODE_FIELD, STAND_DATA_MARKER } from "../../skills/classic-to-freedom-migration/engine/tasks.mjs";
import { renderFinalReport } from "../../skills/classic-to-freedom-migration/engine/report.mjs";

// a page body whose methods are given as source text
const page = (name, methods) => `define("${name}", [], function() { return { entitySchemaName: "UsrThing", diff: [], methods: { ${methods} } }; });`;
const effOf = (body) => mergeHierarchy([parseSchema(body, "UsrPkg")]);
const opened = (body) => writesOnOpen(effOf(body).methods);
function factsOf(body, name) {
  return parseSchema(body, "UsrPkg").methodFacts.find((f) => f.name === name) || null;
}

export function runWritesOnOpenChecks({ check, runMigration, checklistOpts, CLEAN_SEED, FULL_PLANMETA, FULL_SIGNALS, FIX }) {
  const golden = fs.readFileSync(path.join(FIX, "writes-on-open", "MbContractPage.js"), "utf8");
  const assign = factsOf(golden, "mbAssignNumber");

  // AC-1, the facts: the counter write is recorded with the setting it writes, and a read of the same setting is not.
  check("writes-on-open: the golden's mbAssignNumber records a data write of MbContractLastNumber through postSysSettingsValue",
    () => assign?.kinds.includes("data-write")
      && assign.dataWrites.length === 1
      && assign.dataWrites[0].target === "MbContractLastNumber"
      && assign.dataWrites[0].call === "Terrasoft.SysSettings.postSysSettingsValue",
    () => assign);
  const readOnly = page("UsrReadPage", 'init: function() { Terrasoft.SysSettings.querySysSettingsItem("UsrLastNumber", function() {}, this); }');
  check("writes-on-open: reading a system setting is not a data write",
    () => factsOf(readOnly, "init").dataWrites.length === 0 && !factsOf(readOnly, "init").kinds.includes("data-write"),
    () => factsOf(readOnly, "init"));
  const queries = page("UsrQueryPage", [
    'onEntityInitialized: function() { this.callParent(arguments); this.usrLog(); this.usrStamp(); }',
    'usrLog: function() { var q = Ext.create("Terrasoft.InsertQuery", { rootSchemaName: "UsrOpenLog" }); q.execute(); }',
    'usrStamp: function() { var u = new Terrasoft.UpdateQuery({ rootSchemaName: "UsrCounter" }); u.execute(); }',
  ].join(", "));
  check("writes-on-open: an insert query built by Ext.create and an update query built by new both name their rootSchemaName",
    () => factsOf(queries, "usrLog").dataWrites[0]?.target === "UsrOpenLog" && factsOf(queries, "usrLog").dataWrites[0]?.call === "Terrasoft.InsertQuery"
      && factsOf(queries, "usrStamp").dataWrites[0]?.target === "UsrCounter",
    () => [factsOf(queries, "usrLog").dataWrites, factsOf(queries, "usrStamp").dataWrites]);
  // A BatchQuery is a container: the usual read batch on open writes nothing, and a batch carrying an insert still does.
  const batch = page("UsrBatchPage", [
    'onEntityInitialized: function() { this.usrRead(); this.usrBatchInsert(); }',
    'usrRead: function() { var bq = Ext.create("Terrasoft.BatchQuery"); bq.add(this.getLookupQuery()); bq.execute(function() {}, this); }',
    'usrBatchInsert: function() { var b = new Terrasoft.BatchQuery(); b.add(Ext.create("Terrasoft.InsertQuery", { rootSchemaName: "UsrOpenLog" })); b.execute(); }',
  ].join(", "));
  check("writes-on-open: a BatchQuery of reads is no data write; a batch carrying an InsertQuery is one, through the insert",
    () => factsOf(batch, "usrRead").dataWrites.length === 0 && !factsOf(batch, "usrRead").kinds.includes("data-write")
      && factsOf(batch, "usrBatchInsert").dataWrites.map((w) => `${w.call}:${w.target}`).join() === "Terrasoft.InsertQuery:UsrOpenLog"
      && opened(batch).map((w) => w.method).join() === "usrBatchInsert",
    () => [factsOf(batch, "usrRead").dataWrites, factsOf(batch, "usrBatchInsert").dataWrites, opened(batch)]);

  // AC-1, the walk: only writes reached from an open hook count, and the mode the hook asks for travels with them.
  const goldenOpen = opened(golden);
  check("writes-on-open: the golden page writes on open in add mode only, through onEntityInitialized → mbAssignNumber",
    () => goldenOpen.length === 1 && goldenOpen[0].path.join(">") === "onEntityInitialized>mbAssignNumber"
      && goldenOpen[0].addModeOnly === true && goldenOpen[0].writes[0].target === "MbContractLastNumber",
    () => goldenOpen);
  check("writes-on-open: a page without an add-mode test writes on every open, and both query writes are found",
    () => { const w = opened(queries); return w.length === 2 && w.every((x) => x.addModeOnly === false)
      && w.map((x) => x.method).sort((a, b) => a.localeCompare(b)).join() === "usrLog,usrStamp"; },
    () => opened(queries));
  const onClick = page("UsrClickPage", [
    'init: function() { this.callParent(arguments); }',
    'usrNumber: function() { Terrasoft.SysSettings.postSysSettingsValue("UsrLastNumber", 1); }',
  ].join(", "));
  check("writes-on-open: a write only a button runs is not a write on open",
    () => opened(onClick).length === 0 && factsOf(onClick, "usrNumber").dataWrites.length === 1,
    () => opened(onClick));
  const cycle = page("UsrCyclePage", [
    'onEntityInitialized: function() { this.usrA(); }',
    'usrA: function() { this.usrB(); }',
    'usrB: function() { this.usrA(); this.save(); }',
  ].join(", "));
  check("writes-on-open: mutually recursive helpers end the walk, and a save reached on open is a write",
    () => { const w = opened(cycle); return w.length === 1 && w[0].method === "usrB" && w[0].writes[0].call === "this.save"; },
    () => opened(cycle));
  // The add-mode label is earned by the branch the write sits in, not by an isAddMode call somewhere on the path.
  const stamp = 'usrStamp: function() { Terrasoft.SysSettings.postSysSettingsValue("UsrOpenCount", 1); }';
  const afterIf = page("UsrAfterIfPage", [
    'onEntityInitialized: function() { this.callParent(arguments); if (this.isAddMode()) { this.set("UsrA", 1); } this.usrStamp(); }', stamp,
  ].join(", "));
  const inElse = page("UsrElsePage", [
    'onEntityInitialized: function() { if (this.isAddMode()) { this.set("UsrA", 1); } else { this.usrStamp(); } }', stamp,
  ].join(", "));
  const twoPaths = page("UsrTwoPathsPage", [
    'init: function() { this.callParent(arguments); this.usrStamp(); }',
    'onEntityInitialized: function() { if (this.isAddMode()) { this.usrStamp(); } }', stamp,
  ].join(", "));
  const guardedFirst = page("UsrGuardedFirstPage", [
    'init: function() { if (this.isNewMode() && this.get("UsrA")) { this.usrStamp(); } }',
    'onRender: function() { this.usrStamp(); }', stamp,
  ].join(", "));
  const inline = page("UsrInlinePage", [
    'onEntityInitialized: function() { if (this.isAddMode()) { Terrasoft.SysSettings.postSysSettingsValue("UsrLastNumber", 2); } }',
  ].join(", "));
  check("writes-on-open: a write after an add-mode if-block, or in its else branch, writes on every open",
    () => [afterIf, inElse].every((b) => { const w = opened(b); return w.length === 1 && w[0].addModeOnly === false; }),
    () => [opened(afterIf), opened(inElse)]);
  check("writes-on-open: one helper reached from init with no mode test and from onEntityInitialized under isAddMode writes on every open",
    () => { const w = opened(twoPaths); return w.length === 1 && w[0].addModeOnly === false && w[0].path.join(">") === "init>usrStamp"; },
    () => opened(twoPaths));
  check("writes-on-open: a later path with no mode test replaces an earlier add-mode path (isNewMode && …), never the reverse",
    () => { const w = opened(guardedFirst); return w.length === 1 && w[0].addModeOnly === false && w[0].hook === "onRender"; },
    () => opened(guardedFirst));
  // A mode test that is negated, and one helper the hook reaches both inside and outside the add-mode branch.
  const negated = page("UsrNegatedPage", [
    'onEntityInitialized: function() { if (!this.isAddMode()) { this.usrStamp(); } }', stamp,
  ].join(", "));
  const twoHelpers = page("UsrTwoHelpersPage", [
    'onEntityInitialized: function() { this.usrA(); this.usrB(); }',
    'usrA: function() { if (this.isAddMode()) { this.usrStamp(); } }',
    'usrB: function() { this.usrStamp(); }', stamp,
  ].join(", "));
  check("writes-on-open: `if (!this.isAddMode())` is no add-mode branch — the write runs on every open",
    () => { const w = opened(negated); return w.length === 1 && w[0].addModeOnly === false; }, () => opened(negated));
  check("writes-on-open: a write reached through one helper inside the add-mode branch and another outside it runs on every open",
    () => { const w = opened(twoHelpers); return w.length === 1 && w[0].addModeOnly === false && w[0].path.join(">") === "onEntityInitialized>usrB>usrStamp"; },
    () => opened(twoHelpers));
  check("writes-on-open: a write inside the add-mode branch of the hook itself is add-mode only",
    () => { const w = opened(inline); return w.length === 1 && w[0].addModeOnly === true && w[0].method === "onEntityInitialized"; },
    () => opened(inline));

  // AC-1, the plan names the page; a page that writes nothing gets no section at all.
  const manifest = (body) => ({ entity: "MbContract", seed: CLEAN_SEED, schemas: [{ pkg: "MbMigrationBench", body }],
    planMeta: FULL_PLANMETA, signals: FULL_SIGNALS });
  const run = runMigration(manifest(golden));
  const plain = runMigration(manifest(onClick));
  check("writes-on-open: the plan has a 'Pages that write data when opened' section naming the page, the chain and MbContractLastNumber",
    () => /### Pages that write data when opened/.test(run.plan)
      && run.plan.split("\n").some((l) => /MbContract form page/.test(l) && /onEntityInitialized → mbAssignNumber/.test(l)
        && /MbContractLastNumber/.test(l) && /in add mode/.test(l))
      && /EDIT mode on an existing record/.test(run.plan),
    () => run.plan.split("\n").filter((l) => /write data|MbContractLastNumber/.test(l)));
  check("writes-on-open: the page is a question before approval — `data-on-open:main` is open and listed in the plan until the user answers it",
    () => (run.planQuestionsOpen || []).join() === "data-on-open:main"
      && run.plan.split("\n").some((l) => /^\| 1 \| Opening MbContract form page as a new record changes data on the stand/.test(l)
        && /\| Data written when the page opens \| `main` \| ⚠ open \|$/.test(l)),
    () => [run.planQuestionsOpen, run.plan.split("\n").filter((l) => /Questions before approval|data-on-open|Opening/.test(l))]);
  check("writes-on-open: a plan without such a page has no such section",
    () => !/Pages that write data when opened/.test(plain.plan) && dataWritingPages(plain).length === 0,
    () => dataWritingPages(plain));
  // A sub-page is a page of the tree too: a mini page whose own open hook writes is named by its schema and key.
  const miniBody = 'define("MbContractMiniPage",[],function(){return{entitySchemaName:"MbContract",diff:[{operation:"insert",name:"QF",'
    + 'parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"MbName"}}],methods:{onEntityInitialized:function(){'
    + 'this.callParent(arguments);this.mbTake();},mbTake:function(){Terrasoft.SysSettings.postSysSettingsValue("MbMiniCounter",1);}}};});';
  const withMini = runMigration({ ...manifest(onClick), addRecordMiniPage: { schema: "MbContractMiniPage" },
    miniPageSchemas: { MbContractMiniPage: { schemas: [{ pkg: "MbMigrationBench", body: miniBody }], seed: CLEAN_SEED } } });
  const miniPages = dataWritingPages(withMini);
  check("writes-on-open: a mini page that writes on open is carried up from its fold and named in the plan by schema and key",
    () => miniPages.length === 1 && miniPages[0].label === "MbContractMiniPage" && miniPages[0].pageKey.startsWith("mini")
      && withMini.plan.split("\n").some((l) => /MbContractMiniPage/.test(l) && /MbMiniCounter/.test(l) && /every time it opens/.test(l)),
    () => ({ miniPages, lines: withMini.plan.split("\n").filter((l) => /MbMiniCounter/.test(l)) }));
  check("writes-on-open: the mini page's rule reaches its own task, not the root form page's",
    () => dataWritingBlock({ pageKey: miniPages[0].pageKey, rows: [] }, miniPages).length > 0
      && dataWritingBlock({ pageKey: "main", rows: [{ pageKey: "main" }] }, miniPages).length === 0);

  // AC-2, the builder's prompt: the task file of the page carries the edit-mode rule and the consent line it waits for.
  const set = buildTaskSet(run, checklistOpts(manifest(golden)));
  const pageTasks = set.tasks.filter((t) => dataWritingBlock(t, set.dataWritingPages).length);
  const text = pageTasks.length ? renderTaskFile(pageTasks[0], set) : "";
  check("writes-on-open: the page's task file says it writes data when it opens, where the record-id comes from, and that no add-mode check is agreed",
    () => pageTasks.length > 0 && /writes data when it opens/.test(text) && /record-id/.test(text) && /odata-read/.test(text)
      && /No add-mode check is agreed/.test(text) && /Stand data changed \(row N\)/.test(text) && /MbContractLastNumber/.test(text)
      && !/Stand data changed:/.test(text),
    () => text.split("\n").filter((l) => /data|record-id/.test(l)));
  const agreedText = pageTasks.length ? renderTaskFile(pageTasks[0], { ...set, addModeChecks: new Map([["main", 'main (user: "once")']]) }) : "";
  check("writes-on-open: an agreed add-mode check of the page is written into its task file, with the user's words",
    () => /The user agreed to an add-mode check of `main`/.test(agreedText) && /user: "once"/.test(agreedText)
      && !/No add-mode check is agreed/.test(agreedText),
    () => agreedText.split("\n").filter((l) => /add-mode/i.test(l)));
  check("writes-on-open: a task of another page gets no such block",
    () => dataWritingBlock({ pageKey: "list", rows: [{ pageKey: "list" }] }, set.dataWritingPages).length === 0
      && dataWritingBlock({ pageKey: "run", rows: [] }, set.dataWritingPages).length > 0);

  // AC-3 / AC-4, the result report lists what the run changed, from worklog.md and the task notes.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c2f-writes-on-open-"));
  try { reportChecks({ check, run, plain, dir }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), "c2f-writes-on-open-sync-"));
  try { syncChecks({ check, run, dir: syncDir }); } finally { fs.rmSync(syncDir, { recursive: true, force: true }); }
}

// The consent reaches the builder through the engine: a sync reads `worklog.md` and re-renders the page's task file.
function syncChecks({ check, run, dir }) {
  const tasksDir = path.join(dir, "build-tasks");
  const pageFile = (set) => set.tasks.filter((t) => dataWritingBlock(t, set.dataWritingPages).length)
    .map((t) => fs.readFileSync(path.join(tasksDir, t.file), "utf8"))[0] || "";
  const before = pageFile(syncTaskDir(tasksDir, run, {}));
  fs.writeFileSync(path.join(dir, "worklog.md"), 'Add-mode check: main (user: "yes, once")\nAdd-mode check: MbContract form page (user: "typo")\n');
  const after = pageFile(syncTaskDir(tasksDir, run, {}));
  check("writes-on-open: a sync writes the worklog's add-mode consent into the page's task file, and only for a page key of the plan",
    () => /No add-mode check is agreed/.test(before) && /The user agreed to an add-mode check of `main`/.test(after)
      && /yes, once/.test(after) && !/typo/.test(after),
    () => [before, after].map((t) => t.split("\n").filter((l) => /add-mode/i.test(l))));
}

function reportChecks({ check, run, plain, dir }) {
  const tasksDir = path.join(dir, "build-tasks");
  fs.mkdirSync(tasksDir);
  fs.writeFileSync(path.join(dir, "worklog.md"), [
    "Browser: page-smoke (remembered on this machine)",
    'Add-mode check: main (user: "yes, check add mode once")',
    'Add-mode check: MbContract form page (user: "a label, not a key")',
    "Stand data changed: MbContractLastNumber 2 → 3 (MbContract form page)",
    "```", "Stand data changed: an example inside a fence", "```",
    "> Stand data changed: a quoted example",
  ].join("\n"));
  const task = { id: "t1", group: "Form page", file: "t1.md", pageKey: "main", writesTo: "page:main", status: "done", rows: [],
    notes: "Browser checks: 1 — loads clean\n**Stand data changed (row 4):** MbContract record CON-00003 created by click Save**\n"
      + "Stand data changed: an unmarked note line" };
  const report = renderFinalReport({ result: run, verifyRes: { rows: [] }, set: { tasks: [task], planVersion: run.planVersion }, dir: tasksDir });
  const section = report.markdown.split("\n## ").find((s) => s.startsWith("Stand data this run changed")) || "";
  check("writes-on-open: the result lists every Stand data changed line, from worklog.md and the task notes, and the agreed add-mode check",
    () => section.startsWith("Stand data this run changed (2)") && /MbContractLastNumber 2 → 3/.test(section)
      && /CON-00003 created by click Save — \[Form page\]\(t1\.md\), row 4/.test(section) && /yes, check add mode once/.test(section)
      && !/Save\*/.test(section) && !/inside a fence/.test(section) && !/a quoted example/.test(section) && !/unmarked note/.test(section)
      && /Not counted as consent.*a label, not a key/.test(section),
    () => section);
  fs.writeFileSync(path.join(dir, "worklog.md"), "Browser: page-smoke (remembered on this machine)\n");
  const quiet = renderFinalReport({ result: run, verifyRes: { rows: [] }, set: { tasks: [], planVersion: run.planVersion }, dir: tasksDir });
  check("writes-on-open: with nothing recorded the result says so and names the data-writing page it kept to edit mode",
    () => /## Stand data this run changed \(0\)/.test(quiet.markdown) && /No change to stand data was recorded/.test(quiet.markdown)
      && /No add-mode check was agreed/.test(quiet.markdown),
    () => quiet.markdown.split("\n## ").find((s) => s.startsWith("Stand data")));
  const none = renderFinalReport({ result: plain, verifyRes: { rows: [] }, set: { tasks: [], planVersion: plain.planVersion }, dir: tasksDir });
  check("writes-on-open: a run with no data-writing page and no recorded change has no such section",
    () => !/Stand data this run changed/.test(none.markdown));
  check("writes-on-open: worklogFieldValues reads field lines and list items, never a fenced or quoted one",
    () => worklogFieldValues("- Stand data changed: a\n  Stand data changed: b\n> Stand data changed: c\n~~~\nStand data changed: d\n~~~",
      STAND_DATA_FIELD).join() === "a,b");
  check("writes-on-open: a bolded label is read on either side of the colon, in the worklog and in the notes marker",
    () => worklogFieldValues("**Stand data changed**: x 2 → 3\n- **Stand data changed:** y\n**Stand data changed: z**", STAND_DATA_FIELD).join() === "x 2 → 3,y,z"
      && [...addModeChecks('**Add-mode check**: main (user: "ok")', [{ pageKey: "main" }]).agreed.values()].join() === 'main (user: "ok")'
      && worklogFieldValues('Add-mode check: main', ADD_MODE_FIELD).join() === "main"
      && [...notesMarkers("- **Stand data changed (row 2)**: a\n**Stand data changed (row 3):** b", STAND_DATA_MARKER)]
        .map(([n, v]) => `${n}=${v.join()}`).join() === "2=a,3=b",
    () => worklogFieldValues("**Stand data changed**: x 2 → 3\n- **Stand data changed:** y\n**Stand data changed: z**", STAND_DATA_FIELD));
  fs.rmSync(path.join(dir, "worklog.md"));
  const unread = renderFinalReport({ result: run, verifyRes: { rows: [] }, set: { tasks: [], planVersion: run.planVersion }, dir: tasksDir });
  const unreadSection = unread.markdown.split("\n## ").find((s) => s.startsWith("Stand data")) || "";
  check("writes-on-open: with no worklog.md the result says it could not be read instead of claiming nothing changed",
    () => /was not read/.test(unreadSection) && !/No change to stand data was recorded/.test(unreadSection)
      && /no .worklog\.md. beside the task folder/.test(unreadSection),
    () => unreadSection);
  const noDir = renderFinalReport({ result: run, verifyRes: { rows: [] }, set: { tasks: [], planVersion: run.planVersion } });
  const noDirSection = noDir.markdown.split("\n## ").find((s) => s.startsWith("Stand data")) || "";
  check("writes-on-open: with no task folder the result says worklog.md was not read, never that nothing changed",
    () => /was not read \(no task folder was given\)/.test(noDirSection) && !/No change to stand data was recorded/.test(noDirSection),
    () => noDirSection);
  check("writes-on-open: the stand-data sentence states the edit-mode rule, not that checks obeyed it, with one page as 'it'",
    () => /so it was to be opened only in edit mode/.test(unreadSection), () => unreadSection);
}

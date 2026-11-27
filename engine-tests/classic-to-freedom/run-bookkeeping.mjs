// Offline checks for the build loop's BOOKKEEPING (ENG-108022): the ledger moves a confirmed run reaches only
// through the engine — `--decide`, `--tasks`, `--verify` — must close it, never keep it open. A retest of a whole
// customer section confirmed every plan item on the stand and still ended NOT COMPLETE, because the folder the
// engine itself wrote kept re-opening under its own hands. Each block below is one of those loops, on a small
// inline fixture (no stand-sourced page body is copied into the repo). Zero dependencies (node built-ins only).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runMigration, checklistOpts } from "../../skills/classic-to-freedom-migration/engine/migrate.mjs";
import { buildTaskSet, syncTaskDir, startTask, readTaskDir, renderProgress, renderResume, TASK_INDEX_FILE }
  from "../../skills/classic-to-freedom-migration/engine/tasks.mjs";
import { renderFinalReport } from "../../skills/classic-to-freedom-migration/engine/report.mjs";
import { approvePlan, recordBrowserAnswer } from "./_testkit.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATE = path.join(DIR, "..", "..", "skills", "classic-to-freedom-migration", "engine", "migrate.mjs");

let pass = 0, fail = 0;
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

/* ---- the fixture: a main page with a detail whose child page has a grandchild, and a list page ---------------- */
const SEED_METHODS = ["init", "getActions", "onSaved", "setColumns", "loadValues", "onRender", "onEntry", "onExit"]
  .map((m, i) => `${m}:function(){return ${i + 1};}`).join(",");
const SEED = [{ pkg: "BaseModulePageV2", body: `define("BaseModulePageV2",[],function(){return{diff:[{operation:"insert",name:"ProfileContainer",values:{itemType:15}},{operation:"insert",name:"Tabs",values:{itemType:15}}],methods:{${SEED_METHODS}}};});` }];
const leafBundle = (entity, page) => ({ entity, seed: SEED,
  schemas: [{ pkg: "P", body: `define("${page}",[],function(){return{entitySchemaName:"${entity}",diff:[{operation:"insert",name:"${entity}F",parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"${entity}F"}}]};});` }] });
const mainBody = ({ extraField } = {}) => {
  const items = ['{operation:"insert",name:"R1",parentName:"T",values:{itemType:2}}',
    '{operation:"insert",name:"MainF",parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"MainF"}}',
    '{operation:"insert",name:"MainG",parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"MainG"}}'];
  if (extraField) items.push('{operation:"insert",name:"MainH",parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"MainH"}}');
  const methods = ",methods:{" + Array.from({ length: 4 }, (_, i) => `onAct${i}:function(){return this.get("x");}`).join(",") + "}";
  return `define("MPage",[],function(){return{entitySchemaName:"M",details:{R1:{schemaName:"R1D",entitySchemaName:"C1",filter:{detailColumn:"m",masterColumn:"Id"}}},diff:[{operation:"insert",name:"T",parentName:"Tabs",values:{itemType:15,isTab:true}},${items.join(",")}]${methods}};});`;
};
const RESOLVED = { resolved: true, present: false };
const manifestOf = (edit = {}) => ({
  entity: "M", seed: SEED,
  schemas: [{ pkg: "P", body: mainBody(edit) }],
  detailSchemas: { R1D: { entity: "C1", columns: ["Number"], editPage: "C1Page" } },
  childPageSchemas: { C1Page: leafBundle("C1", "C1Page") },
  addRecordMiniPage: false,
  section: { schemas: [], listColumns: { success: true, sectionSchema: "MSection", entity: "M", source: "schema-default", columns: [{ name: "Name" }] } },
  planMeta: { scope: "single-section", environment: "test", package: "P → UsrM", approach: "Parallel rebuild",
    whatItDoes: "M register.", sectionSchema: "MSection", listTemplate: "ListPageV3", formTemplate: "FormPageTemplate" },
  signals: { dcm: RESOLVED, processes: RESOLVED, printables: RESOLVED, deduplication: RESOLVED },
});
const MANIFEST = manifestOf();
const RUN = runMigration(MANIFEST);
const DECS = new Map([["D5", "build the typed forms"], ["D6", "drop the typed forms"]]);
const OPTS = { ...checklistOpts(MANIFEST), decisions: DECS };   // the default budget, as the CLI cuts it

/* ---- folder helpers ------------------------------------------------------------------------------------------ */
const AT = (min) => new Date(Date.UTC(2026, 0, 1, 12, min)).toISOString();
const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `c2f_books_${label}_`));
const taskFilePath = (dir, id) => path.join(dir, fs.readdirSync(dir).find((x) => x.endsWith(".md")
  && x !== TASK_INDEX_FILE && new RegExp(String.raw`^id: ${id}\s*$`, "m").test(fs.readFileSync(path.join(dir, x), "utf8"))));
// The Outcome cell of the n-th deliverable row, set to `value`.
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
const closeCells = (dir, id) => {
  const f = taskFilePath(dir, id);
  let text = fs.readFileSync(f, "utf8");
  const n = (text.match(/^\|\s*\d+\s*\|/gm) || []).length;
  for (let i = 1; i <= n; i++) text = setOutcome(text, i, "built");
  fs.writeFileSync(f, text);
};
const editFrontMatter = (dir, id, key, value) => {
  const f = taskFilePath(dir, id);
  fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace(new RegExp(`^${key}:.*$`, "m"), `${key}: ${value}`));
};
// Dispatch, sign and close one task the way the orchestrator does.
function runTask(dir, id, min) {
  const token = `tok-${id}`;
  startTask(dir, id, RUN, { ...OPTS, dispatchToken: token }, null, AT(min));
  closeCells(dir, id);
  editFrontMatter(dir, id, "agentNonce", token);
  syncTaskDir(dir, RUN, { ...OPTS, now: AT(min + 1) });
}
// A migration folder with an approved plan, every task of which was dispatched and closed `built`.
function closedFolder(label) {
  const base = tmp(label);
  const dir = path.join(base, "build-tasks");
  fs.writeFileSync(path.join(base, "decisions.md"), "## D5 — build the typed forms\n\n## D6 — drop the typed forms\n");
  approvePlan(dir, RUN.planVersion);
  recordBrowserAnswer(dir);
  syncTaskDir(dir, RUN, OPTS);
  for (const t of [...buildTaskSet(RUN, OPTS).tasks].sort((a, b) => a.order - b.order)) runTask(dir, t.id, t.order * 2);
  const manifestFile = path.join(base, "m.json");
  fs.writeFileSync(manifestFile, JSON.stringify(MANIFEST));
  const cli = (...args) => spawnSync(process.execPath, [MIGRATE, manifestFile, ...args], { encoding: "utf8" });
  return { base, dir, cli };
}
const rowsOf = (dir, id) => readTaskDir(dir).find((x) => x.id === id).rows;
const NEEDS = "not-built — needs-decision";
// `closedFolder` with rows 1 and 2 of one settled task recorded as waiting on a decision — the state of the
// retest's settled tasks when the orchestrator answered them.
function twoQuestions(label) {
  const f = closedFolder(label);
  const t = readTaskDir(f.dir).find((x) => x.rows.length >= 3 && x.origin === "engine" && x.kind !== "repair" && !x.rows.some((r) => r.na));
  const fp = taskFilePath(f.dir, t.id);
  fs.writeFileSync(fp, setOutcome(setOutcome(fs.readFileSync(fp, "utf8"), 1, NEEDS), 2, NEEDS));
  syncTaskDir(f.dir, RUN, { ...OPTS, now: AT(900) });
  return { ...f, t, fp };
}

console.log("\n===== E2: `--decide` applies every `--row` =====");
{
  const { base, dir, t, cli } = twoQuestions("e2-wontdo");
  const r = cli("--tasks", dir, "--decide", "D6", "--wont-do", "--row", `${t.id}:1`, "--row", `${t.id}:2`);
  const rows = rowsOf(dir, t.id);
  check("`--decide D6 --wont-do` with two `--row` flags closes BOTH rows and counts both",
    () => r.status === 0 && rows[0].outcomeKind === "wont-do" && rows[1].outcomeKind === "wont-do" && /wont-do 2 row\(s\)/.test(r.stdout || ""),
    () => ({ status: r.status, out: r.stdout, err: r.stderr, rows: rows.slice(0, 3).map((x) => x.outcome) }));
  fs.rmSync(base, { recursive: true, force: true });
}
{
  const { base, dir, t, cli } = twoQuestions("e2-build");
  const r = cli("--tasks", dir, "--decide", "D5", "--build", "--row", `${t.id}:1`, "--row", `${t.id}:2`);
  const rows = rowsOf(dir, t.id);
  check("`--decide D5 --build` with two `--row` flags re-opens BOTH rows",
    () => r.status === 0 && /reopened 2 row\(s\)/.test(r.stdout || "") && rows[0].outcome === "" && rows[1].outcome === "",
    () => ({ status: r.status, out: r.stdout, err: r.stderr, rows: rows.slice(0, 3).map((x) => x.outcome) }));
  fs.rmSync(base, { recursive: true, force: true });
}
{
  const { base, dir, t, fp, cli } = twoQuestions("e2-bad-second");
  const before = fs.readFileSync(fp, "utf8");
  const r = cli("--tasks", dir, "--decide", "D6", "--wont-do", "--row", `${t.id}:1`, "--row", `${t.id}:99`);
  check("a `--row` out of range among several refuses the whole call and writes nothing",
    () => r.status === 1 && /row 99 out of range/.test(r.stderr || "") && fs.readFileSync(fp, "utf8") === before,
    () => ({ status: r.status, err: r.stderr }));
  fs.rmSync(base, { recursive: true, force: true });
}

console.log("\n===== E3: `--decide --build` re-opens only the decided rows =====");
{
  const { base, dir, t, cli } = twoQuestions("e3");
  const first = cli("--tasks", dir, "--decide", "D5", "--build", "--row", `${t.id}:1`);
  const second = cli("--tasks", dir, "--decide", "D6", "--wont-do", "--row", `${t.id}:2`);
  const rows = rowsOf(dir, t.id);
  check("after `--decide --build` on row 1, the task's other needs-decision row is still answered by `--decide --wont-do`",
    () => first.status === 0 && second.status === 0 && rows[0].outcome === "" && rows[1].outcomeKind === "wont-do",
    () => ({ first: first.stdout + first.stderr, second: second.stdout + second.stderr, rows: rows.map((x) => x.outcome) }));
  check("the rows nobody decided keep their recorded `built` outcome",
    () => rows.slice(2).every((x) => x.outcomeKind === "built"), () => rows.map((x) => x.outcome));
  fs.rmSync(base, { recursive: true, force: true });
}
{
  const { base, dir, t, cli } = twoQuestions("e3-build-build");
  const first = cli("--tasks", dir, "--decide", "D5", "--build", "--row", `${t.id}:1`);
  const second = cli("--tasks", dir, "--decide", "D5", "--build", "--row", `${t.id}:2`);
  const rows = rowsOf(dir, t.id);
  check("two build-it answers given one after the other both land, and the task is offered as `todo`",
    () => first.status === 0 && second.status === 0 && rows[0].outcome === "" && rows[1].outcome === ""
      && readTaskDir(dir).find((x) => x.id === t.id).status === "todo",
    () => ({ first: first.stdout + first.stderr, second: second.stdout + second.stderr, rows: rows.map((x) => x.outcome) }));
  fs.rmSync(base, { recursive: true, force: true });
}

console.log("\n===== E11: an Outcome written after a stray empty column =====");
{
  const { base, dir } = closedFolder("e11");
  const t = readTaskDir(dir).find((x) => x.rows.length >= 2 && x.origin === "engine" && x.kind !== "repair" && !x.rows.some((r) => r.na));
  const fp = taskFilePath(dir, t.id);
  // Row 1 as a sub-agent wrote it in the retest: one empty cell, then the mark.
  const stray = setOutcome(fs.readFileSync(fp, "utf8"), 1, "").replace(/^(\|\s*1\s*\|.*\|) {2}\|$/m, "$1 || not-built — blocked |");
  fs.writeFileSync(fp, stray);
  const rows = rowsOf(dir, t.id);
  check("a mark written one cell late (`|| not-built — blocked`) is read as that mark, not as no outcome",
    () => /\|\| not-built — blocked \|$/m.test(stray) && rows[0].outcomeKind === "not-built" && rows[0].outcomeCause === "blocked",
    () => ({ row: stray.split("\n").find((l) => /^\|\s*1\s*\|/.test(l)), parsed: rows[0] }));
  check("the rows around it read as before", () => rows.slice(1).every((r) => r.outcomeKind === "built"), () => rows.map((r) => r.outcome));
  fs.rmSync(base, { recursive: true, force: true });
}

console.log("\n===== E12, E13a: the report title and the progress counters =====");
{
  const base = tmp("e12");
  const dir = path.join(base, "build-tasks");
  fs.mkdirSync(dir, { recursive: true });
  const asProcessPage = { ...RUN, entity: "OrderLine", processPage: { pageName: "ReviewOrderPage" } };
  const title = (result) => renderFinalReport({ result, verifyRes: null, set: { tasks: [], planVersion: RUN.planVersion }, dir }).markdown.split("\n")[0];
  check("a process page's report is titled by the page, as its plan is — not by the entity its first detail lists",
    () => title(asProcessPage) === "# Migration result — ReviewOrderPage (process page)", () => title(asProcessPage));
  check("a section's report is still titled by its entity", () => title(RUN) === "# Migration result — M", () => title(RUN));
  const repair = { id: "r1", order: Number.MAX_SAFE_INTEGER - 1, step: 3, status: "in-progress", group: "Repair round 1 — other",
    pageKey: "main", weight: 1, rows: [] };
  const built = (id, order) => ({ id, order, step: order, status: "done", group: "Page build", pageKey: "main", weight: 1, rows: [] });
  const progress = renderProgress({ tasks: [built("a", 1), built("b", 2), repair] }, dir, AT(0));
  check("a running repair task's counter is its position in the run, never the sentinel order repair tasks sort on",
    () => /^\[3\/3\] RUNNING {2}Repair round 1/m.test(progress) && !/9007199254740/.test(progress), () => progress);
  const resume = renderResume({ next: repair, verdict: "startable", migrationDir: base, environment: "test",
    manifestPath: path.join(base, "m.json"), nextCommand: "x", route: "agent", browser: "page-smoke", tasksDir: dir,
    now: AT(0), planVersion: RUN.planVersion, approvalLine: "approved", progress });
  check("the hand-off names a repair task's step by its position, not by its sentinel order",
    () => /\(step 3 · main · Repair round 1/.test(resume.text || resume) && !/9007199254740/.test(resume.text || resume),
    () => (resume.text || resume).split("\n").filter((l) => /step/.test(l)));
  fs.rmSync(base, { recursive: true, force: true });
}

console.log(`\n=================\nBOOKKEEPING GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

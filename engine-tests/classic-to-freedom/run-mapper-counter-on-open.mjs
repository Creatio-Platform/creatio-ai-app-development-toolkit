// A NUMBER TAKEN ON OPEN THAT THE WALK DID NOT SEE (ENG-107721, reopened after the 2026-11 retest). On a two-layer
// Classic card the top layer's onEntityInitialized only subscribed to a message and called callParent, and the base
// layer's onEntityInitialized wrote the counter's system settings and took the next number. The walk read only the
// effective body, so the plan did not list the page, an add-mode browser check consumed a number and moved a system
// setting, and the built page wrote system settings from the browser. These checks hold the fix: the walk follows
// callParent into the client layer below, a mixin's open write reaches the plan through `manifest.openWrites`, and a
// number taken on open carries a build rule (on save, on the server) unless the user chose to keep the Classic counter.
// Imported and run by `run-mapper.mjs`, which hands it its `check` and the shared fixtures so the tally stays one number.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSchema, mergeHierarchy } from "../../skills/classic-to-freedom-migration/engine/engine.mjs";
import { writesOnOpen } from "../../skills/classic-to-freedom-migration/engine/mapper.mjs";
import { dataWritingPages, counterPages } from "../../skills/classic-to-freedom-migration/engine/designspec.mjs";
import { buildTaskSet, renderTaskFile, dataWritingBlock, keptCounters } from "../../skills/classic-to-freedom-migration/engine/tasks.mjs";
import { renderFinalReport } from "../../skills/classic-to-freedom-migration/engine/report.mjs";

const page = (name, methods) => `define("${name}", [], function() { return { entitySchemaName: "UsrThing", diff: [], methods: { ${methods} } }; });`;
const openedOf = (layers, opts) => writesOnOpen(mergeHierarchy(layers.map(([pkg, body]) => parseSchema(body, pkg)), opts).methods);
const chain = (w) => w.path.join(">");
const targets = (w) => w.writes.map((x) => x.target || x.call).join();

export function runCounterOnOpenChecks({ check, runMigration, checklistOpts, CLEAN_SEED, FULL_PLANMETA, FULL_SIGNALS, FIX }) {
  const base = fs.readFileSync(path.join(FIX, "writes-on-open", "UsrSubscriptionPage-base.js"), "utf8");
  const top = fs.readFileSync(path.join(FIX, "writes-on-open", "UsrSubscriptionPage-top.js"), "utf8");

  // The walk: callParent runs the client layer below, and that layer's add-or-copy test keeps the add-mode label.
  const both = openedOf([["UsrSubscriptionBase", base], ["UsrSubscriptionTop", top]]);
  const viaParent = both.find((w) => w.method === "onEntityInitialized");
  const viaHelper = both.find((w) => w.method === "generateNumber");
  check("counter-on-open: a top layer that reaches the base layer's onEntityInitialized through callParent writes its system settings on open",
    () => both.length === 2 && viaParent?.layer === "UsrSubscriptionBase"
      && chain(viaParent) === "onEntityInitialized>callParent (UsrSubscriptionBase)"
      && targets(viaParent) === "UsrSubscriptionLastGenerateDate,UsrSubscriptionLastNumber" && viaParent.addModeOnly === true,
    () => both);
  check("counter-on-open: the base layer's helper is followed from its body, and the number generator it calls is a write in add mode",
    () => chain(viaHelper || { path: [] }) === "onEntityInitialized>callParent (UsrSubscriptionBase)>generateNumber"
      && targets(viaHelper) === "this.getIncrementCode" && viaHelper.addModeOnly === true,
    () => viaHelper);
  const replaced = page("UsrSubscriptionPage", 'onEntityInitialized: function() { this.sandbox.subscribe("X", function() {}, this); }');
  check("counter-on-open: a top layer that overrides onEntityInitialized without callParent does not run the base layer's body",
    () => openedOf([["UsrSubscriptionBase", base], ["UsrSubscriptionTop", replaced]]).length === 0,
    () => openedOf([["UsrSubscriptionBase", base], ["UsrSubscriptionTop", replaced]]));
  const seedWrites = parseSchema(page("BasePageV2",
    'onEntityInitialized: function() { Terrasoft.SysSettings.postSysSettingsValue("UsrTemplateCounter", 1); }'), "BaseTemplate");
  const overTemplate = writesOnOpen(mergeHierarchy([parseSchema(top, "UsrSubscriptionTop")], { seedTemplate: [seedWrites] }).methods);
  check("counter-on-open: callParent into a base-template layer ends the walk — the template is layout context, not the page's code",
    () => !overTemplate.some((w) => targets(w).includes("UsrTemplateCounter")), () => overTemplate);

  // The add-mode test: an `||` of mode tests alone is add mode; one with any other operand is a doubt, so every open.
  const stamp = 'Terrasoft.SysSettings.postSysSettingsValue("UsrLastNumber", 1);';
  const orModes = page("UsrOrPage", `onEntityInitialized: function() { if (this.isAddMode() || this.isCopyMode()) { ${stamp} } }`);
  const orOther = page("UsrOrOtherPage", `onEntityInitialized: function() { if (this.isAddMode() || this.get("UsrA")) { ${stamp} } }`);
  check("counter-on-open: `isAddMode() || isCopyMode()` is an add-mode branch; `isAddMode() || <anything else>` is not",
    () => openedOf([["P", orModes]])[0]?.addModeOnly === true && openedOf([["P", orOther]])[0]?.addModeOnly === false,
    () => [openedOf([["P", orModes]]), openedOf([["P", orOther]])]);

  // The plan, on the fixture as a page bundle: the page is listed, with the build rule for its counter.
  const manifest = (extra = {}) => ({ entity: "UsrSubscription", seed: CLEAN_SEED, planMeta: FULL_PLANMETA, signals: FULL_SIGNALS,
    schemas: [{ pkg: "UsrSubscriptionBase", body: base }, { pkg: "UsrSubscriptionTop", body: top }], ...extra });
  const run = runMigration(manifest());
  const planLines = run.plan.split("\n");
  check("counter-on-open: the plan lists the two-layer page under Pages that write data when opened, through callParent, in add mode",
    () => /### Pages that write data when opened/.test(run.plan)
      && planLines.some((l) => /callParent \(UsrSubscriptionBase\)/.test(l) && /UsrSubscriptionLastNumber/.test(l) && /in add mode/.test(l)),
    () => planLines.filter((l) => /UsrSubscription/.test(l)));
  check("counter-on-open: the plan carries the build rule for the number taken on open — on save, on the server, or the user's decision to keep it",
    () => planLines.some((l) => /^\*\*Build rule — a number taken on open \(`main`\):\*\*/.test(l) && /SAVED, on the server/.test(l)
      && /Client counter kept: <page key>/.test(l)),
    () => planLines.filter((l) => /Build rule/.test(l)));
  const queriesOnly = runMigration(manifest({ schemas: [{ pkg: "UsrPkg", body: page("UsrLogPage",
    'onEntityInitialized: function() { var q = Ext.create("Terrasoft.InsertQuery", { rootSchemaName: "UsrOpenLog" }); q.execute(); }') }] }));
  check("counter-on-open: a page that writes on open but takes no number gets no counter build rule",
    () => dataWritingPages(queriesOnly).length === 1 && counterPages(dataWritingPages(queriesOnly)).length === 0
      && !/Build rule — a number taken on open/.test(queriesOnly.plan),
    () => dataWritingPages(queriesOnly));

  // A mixin's open write: the engine never reads a mixin body, so the analysis declares it and the plan lists the page.
  const plainTop = page("UsrMixinPage", 'onEntityInitialized: function() { this.callParent(arguments); this.usrAssignNumber(); }');
  const declared = runMigration(manifest({ schemas: [{ pkg: "UsrPkg", body: plainTop }], openWrites: [
    { via: "UsrNumberingMixin.usrAssignNumber", writes: [{ call: "Terrasoft.SysSettings.postSysSettingsValue", target: "UsrLastNumber" }],
      addModeOnly: true, evidence: "mixin body read in the Context phase" },
    { via: "UsrAuditMixin.usrStampOpen" }, { writes: [] }, "not an entry"] }));
  const declaredPages = dataWritingPages(declared);
  check("counter-on-open: a declared openWrites entry lists the page, keeps its add-mode word, and carries the counter build rule",
    () => declaredPages.length === 1 && declaredPages[0].writes.length === 2
      && declaredPages[0].writes[0].path.join(">") === "onEntityInitialized>UsrNumberingMixin.usrAssignNumber (declared)"
      && declaredPages[0].writes[0].addModeOnly === true && counterPages(declaredPages).length === 1,
    () => declaredPages);
  check("counter-on-open: an entry naming no write still marks the page through `via`, as a write on every open; one without `via` is dropped",
    () => declaredPages[0].writes[1].writes[0].call === "UsrAuditMixin.usrStampOpen" && declaredPages[0].writes[1].addModeOnly === false,
    () => declaredPages[0].writes);
  check("counter-on-open: openWrites that is not a list is ignored, and a bundle without it plans as before",
    () => dataWritingPages(runMigration(manifest({ schemas: [{ pkg: "UsrPkg", body: plainTop }], openWrites: { via: "x" } }))).length === 0);

  // The builder's prompt: the task file carries the build rule, or the user's words when the counter was kept.
  const set = buildTaskSet(run, checklistOpts(manifest()));
  const pageTask = set.tasks.find((t) => dataWritingBlock(t, set.dataWritingPages).length);
  const ruleText = pageTask ? renderTaskFile(pageTask, set) : "";
  const keptText = pageTask ? renderTaskFile(pageTask, { ...set, keptCounters: new Map([["main", 'main (user: "keep it as it was")']]) }) : "";
  check("counter-on-open: the page's task file carries the build rule and says no Client counter kept line names the page",
    () => /\*\*Build rule for `main`:\*\*/.test(ruleText) && /SAVED, on the server/.test(ruleText) && /No `Client counter kept:` line/.test(ruleText),
    () => ruleText.split("\n").filter((l) => /counter|Build rule/i.test(l)));
  check("counter-on-open: a kept counter replaces the build rule in the task file with the user's words",
    () => /The user kept the Classic counter of `main`/.test(keptText) && /keep it as it was/.test(keptText) && !/Build rule for `main`/.test(keptText),
    () => keptText.split("\n").filter((l) => /counter|Build rule/i.test(l)));
  const keptRead = keptCounters('Client counter kept: main (user: "keep")\nClient counter kept: child:Other (user: "x")', set.dataWritingPages);
  const noCounter = keptCounters('Client counter kept: main (user: "keep")', dataWritingPages(queriesOnly));
  check("counter-on-open: a Client counter kept line counts only for a page the plan lists as taking a number on open",
    () => keptRead.agreed.get("main") === 'main (user: "keep")' && keptRead.unknown.join() === 'child:Other (user: "x")'
      && noCounter.agreed.size === 0 && noCounter.unknown.length === 1,
    () => [keptRead, noCounter]);

  // The result report names the kept counter, beside the stand data the run changed.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "c2f-counter-on-open-"));
  try {
    const tasksDir = path.join(dir, "build-tasks");
    fs.mkdirSync(tasksDir);
    fs.writeFileSync(path.join(dir, "worklog.md"), ["Browser: page-smoke",
      'Client counter kept: main (user: "keep it as it was")', 'Client counter kept: Subscription (user: "a label")'].join("\n"));
    const report = renderFinalReport({ result: run, verifyRes: { rows: [] }, set: { tasks: [], planVersion: run.planVersion }, dir: tasksDir });
    const section = report.markdown.split("\n## ").find((s) => s.startsWith("Stand data this run changed")) || "";
    check("counter-on-open: the result report names the browser-side counter the user kept, and a line naming no counter page as no decision",
      () => /Browser-side counters the user chose to keep.*keep it as it was/.test(section)
        && /Not counted as a decision.*a label/.test(section),
      () => section);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

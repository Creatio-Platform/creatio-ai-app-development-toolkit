// PROCESSES A PAGE STARTS. A button or request that starts a business process reaches the process's user-task pages,
// which are not in the migrated page's chain. These checks hold the plan to following each started process: a
// blocker until it is recorded, a decision row for every Classic user-task page, a recorded boundary, and the
// `Connected processes` line naming what the code starts. The fixtures are the `MbMigrationBench` benchmark
// package's contract page, its base page, its section and the process page its Start approval process opens.
// Imported and run by `run-mapper.mjs`, which hands it its `check` and the shared fixtures so the tally stays one number.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleBuilt, PROCESS_FILE } from "../../skills/classic-to-freedom-migration/engine/assemble.mjs";
import { launchedProcessesInfo, LAUNCHED_DECISION } from "../../skills/classic-to-freedom-migration/engine/launched-processes.mjs";

export function runLaunchedProcessesChecks({ check, runMigration, runMigrate, renderVerify, checklistOpts, CLEAN_SEED, FULL_PLANMETA, FULL_SIGNALS,
  FULL_PLACEMENT, FULL_CONVENTIONS, FIX }) {
  const dir = path.join(FIX, "launched-processes");
  const body = (f) => fs.readFileSync(path.join(dir, f), "utf8");
  const BASE = body("MbBaseDocumentPage.js"), CONTRACT = body("MbContractPage.js"), SECTION = body("MbContractSection.js");
  const PROCESS = "MbApproveContractProcess";
  const PAGE = "MbApproveContractProcessPage";
  const TASK = { element: "ApproveContractPageUserTask", page: PAGE, ui: "classic" };
  const manifest = (launchedProcesses) => ({
    entity: "MbContract", seed: [...CLEAN_SEED, { pkg: "MbMigrationBench", body: BASE }],
    schemas: [{ pkg: "MbMigrationBench", body: CONTRACT }],
    section: [{ pkg: "MbMigrationBench", body: SECTION }],
    ...(launchedProcesses ? { launchedProcesses } : {}),
  });
  const followed = (task = TASK, extra = {}) => ({ resolved: true, processes: [{ name: PROCESS, caption: "Approve contract", userTasks: [task], ...extra }] });
  const rowOf = (md, label) => md.split("\n").find((l) => l.includes(label)) || "";
  // One migration per record; each verify case re-renders it against its own payload.
  const verifierFor = (lp) => { const m = manifest(lp), r = runMigration(m), o = checklistOpts(m);
    return (built = {}) => rowOf(renderVerify(r, o, built).markdown, "[process user task]"); };
  const info = (rec, sources = [{ from: "page MbContractPage", launch: true, names: [PROCESS] }]) =>
    launchedProcessesInfo({ sources, manifest: { launchedProcesses: rec } });

  // The benchmark contract page starts the approval process from its Start approval button.
  const unrecorded = runMigration(manifest());
  check("started processes: the benchmark contract page is found to start MbApproveContractProcess",
    () => unrecorded.launchedProcesses?.processes.some((p) => p.name === PROCESS && p.from.includes("page MbContractPage")), () => unrecorded.launchedProcesses);
  check("started processes: a started process not followed leaves the plan incomplete, with the banner naming it",
    () => unrecorded.launchedProcessesBlockers.length === 1 && /MbApproveContractProcess/.test(unrecorded.launchedProcessesBlockers[0])
      && /PLAN INCOMPLETE — started processes not followed/.test(unrecorded.plan) && /⚠ not followed/.test(unrecorded.plan),
    () => unrecorded.launchedProcessesBlockers);
  const withMenuNone = runMigration({ ...manifest(followed()), signals: { processes: { resolved: true, present: false } } });
  check("started processes: the Connected processes line names what the code starts even when the section's process menu is empty",
    () => /\*\*Connected processes:\*\* none in the section process menu; the code starts `MbApproveContractProcess` — see \*\*Processes this page starts\*\*/.test(withMenuNone.plan)
      && !/Connected processes:\*\* none \(checked on-stand/.test(withMenuNone.plan),
    () => withMenuNone.plan.split("\n").filter((l) => /Connected processes/.test(l)));

  check("started processes: the process-launch decision keeps a button whose process the code names, placed as a menu item on the Classic button's surface",
    () => (unrecorded.changeSet.needsDecision || []).some((n) => n.kind === "process-launch"
      && /The drop rule does NOT apply to a process the code names \(MbApproveContractProcess\).*place it as a MENU ITEM in the Actions button of the surface the Classic button is on/.test(n.reason)
      && !/keep the action where the Classic button is/.test(n.reason)));
  // A quoted string that only looks like a process name (a resource caption, a platform module) is not a started process.
  const noisy = CONTRACT.replace('ProcessModuleUtilities.executeProcess({',
    'this.get("Resources.Strings.MbStartApprovalProcessCaption"); this.set("MbModule", "ProcessModuleUtilities");\n\t\t\t\tProcessModuleUtilities.executeProcess({');
  const noisyRun = runMigration({ ...manifest(), schemas: [{ pkg: "MbMigrationBench", body: noisy }] });
  check("started processes: a resource caption or a platform module named like a process is not a started process",
    () => noisy !== CONTRACT && noisyRun.launchedProcesses.processes.map((p) => p.name).join() === PROCESS && noisyRun.launchedProcessesBlockers.length === 1,
    () => noisyRun.launchedProcesses.processes.map((p) => p.name));

  const sigOf = (processes) => runMigration({ ...manifest(followed()), signals: { processes } }).plan.split("\n").find((l) => /Connected processes/.test(l)) || "";
  check("started processes: with the section process menu not resolved, the line says so and still names what the code starts",
    () => /⚠ section process menu not resolved — run the on-stand check; the code starts `MbApproveContractProcess`/.test(sigOf({ resolved: false })), () => sigOf({ resolved: false }));
  check("started processes: with processes in the section menu, the line keeps the menu's list and adds what the code starts",
    () => /present — Approve deal → build it; the code starts `MbApproveContractProcess`/.test(sigOf({ resolved: true, present: true, names: ["Approve deal"] })),
    () => sigOf({ resolved: true, present: true, names: ["Approve deal"] }));
  // A process the section starts is followed like one the page starts.
  const SECTION_START = 'define("MbContractSection",[],function(){return{entitySchemaName:"MbContract",methods:{mbRun:function(){ProcessModuleUtilities.executeProcess({sysProcessName:"MbSectionProcess"});}},diff:[]};});';
  const sectionRun = runMigration({ ...manifest(followed()), section: [{ pkg: "MbMigrationBench", body: SECTION_START }] });
  check("started processes: a process the section starts is listed from the section and blocks until followed",
    () => sectionRun.launchedProcesses.processes.some((p) => p.name === "MbSectionProcess" && p.from.join() === "section")
      && sectionRun.launchedProcessesBlockers.some((i) => /MbSectionProcess, which the section starts/.test(i)),
    () => [sectionRun.launchedProcesses.processes, sectionRun.launchedProcessesBlockers]);

  // A followed process: each Classic user-task page is a decision.
  const pending = runMigration(manifest(followed()));
  check("started processes: a followed process clears the blocker and lists its Classic user-task page as a decision",
    () => pending.launchedProcessesBlockers.length === 0 && !/PLAN INCOMPLETE — started processes/.test(pending.plan)
      && /\| `MbApproveContractProcess` \| `ApproveContractPageUserTask` \| `MbApproveContractProcessPage` \| Classic \| ⚠ decide with the user: migrate it with the process-page profile, or keep it Classic \|/.test(pending.plan),
    () => pending.plan.split("\n").filter((l) => /MbApproveContractProcess/.test(l)));
  check("started processes: the Plan-vs-Done list carries a row for the Classic user-task page",
    () => /\[process user task\] `MbApproveContractProcessPage` — opened by `MbApproveContractProcess`/.test(pending.checklist),
    () => pending.checklist.split("\n").filter((l) => /process user task/.test(l)));
  check("started processes: an undecided user-task page keeps its verify row open",
    () => /⚠ verify.*decide with the user/.test(verifierFor(followed())()));
  check("started processes: a user-task page the user keeps Classic closes its row",
    () => /✅ Done.*kept Classic/.test(verifierFor(followed({ ...TASK, decision: LAUNCHED_DECISION.KEEP_CLASSIC }))()));
  const migrateRow = verifierFor(followed({ ...TASK, decision: LAUNCHED_DECISION.MIGRATE }));
  const migrated = { processPagesMigrated: [{ page: PAGE, freedomPage: "MbApproveContractProcessPageFreedom" }] };
  check("started processes: a user-task page to migrate stays open until its own run is recorded, then names its Freedom page",
    () => /⚠ verify.*migrate .MbApproveContractProcessPage. as its own run/.test(migrateRow())
      && /✅ Done.*migrated as .MbApproveContractProcessPageFreedom./.test(migrateRow(migrated)),
    () => [migrateRow(), migrateRow(migrated)]);
  check("started processes: a user-task page recorded as migrated with no Freedom page is ❌",
    () => /❌ MISSING.*names no Freedom page/.test(migrateRow({ processPagesMigrated: [{ page: PAGE }] })));
  check("started processes: a Freedom user-task page needs no decision and gets no row",
    () => { const r = runMigration(manifest(followed({ ...TASK, ui: "freedom" })));
      return /\| Freedom \| nothing to migrate \|/.test(r.plan) && !/\[process user task\]/.test(r.checklist); });

  // `--verify --from` composes the payload from the migration folder: the migrated user-task pages come from process.json.
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "launched-processes-"));
  try {
    fs.mkdirSync(path.join(folder, "reads"));
    fs.writeFileSync(path.join(folder, "reads", "index.json"), JSON.stringify({ reads: [] }));
    fs.writeFileSync(path.join(folder, PROCESS_FILE), JSON.stringify({ processPagesMigrated: [{ page: PAGE, freedomPage: "MbApproveContractProcessPageFreedom" }] }));
    const composed = assembleBuilt(folder).built;
    check("started processes: the composed --from payload carries the migrated user-task pages from process.json",
      () => composed.processPagesMigrated?.[0]?.freedomPage === "MbApproveContractProcessPageFreedom", () => composed);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }

  // Boundaries and the incomplete records.
  const bounded = runMigration(manifest({ resolved: true, processes: [{ name: PROCESS, boundary: "approval stays in the Classic workspace this release" }] }));
  check("started processes: a recorded boundary is stated in the plan and needs no user-task list",
    () => bounded.launchedProcessesBlockers.length === 0 && /boundary: approval stays in the Classic workspace this release/.test(bounded.plan));
  check("started processes: a process with no user-task page is recorded with an empty list",
    () => { const r = runMigration(manifest({ resolved: true, processes: [{ name: PROCESS, userTasks: [] }] }));
      return r.launchedProcessesBlockers.length === 0 && /no user-task page/.test(r.plan); });
  check("started processes: an entry with neither user-task pages nor a boundary is a blocker",
    () => /records neither its user-task pages nor a boundary/.test(info({ resolved: true, processes: [{ name: PROCESS }] }).issues.join()));
  check("started processes: resolved with no entry for the started process names the process",
    () => /names no entry for MbApproveContractProcess, which the page MbContractPage starts/.test(info({ resolved: true, processes: [] }).issues.join()));
  check("started processes: a user task that names no page, or no UI, is a blocker",
    () => /names no page/.test(info(followed({ element: "X", ui: "classic" })).issues.join())
      && /names no .ui./.test(info(followed({ element: "X", page: PAGE })).issues.join()));

  // A process named at runtime: the record names it, or says why it cannot be named.
  check("started processes: a start whose process is named at runtime is a blocker until a process or the evidence is recorded",
    () => { const at = (rec) => info(rec, [{ from: "page X", launch: true, names: [] }]).issues;
      return /names at runtime/.test(at({ resolved: true, processes: [] }).join())
        && at({ resolved: true, processes: [{ name: "MbOtherProcess", userTasks: [] }] }).length === 0
        && at({ resolved: true, evidence: "the process name comes from a system setting the user named", processes: [] }).length === 0; });
  check("started processes: a page that starts no process gets no section and no blocker",
    () => launchedProcessesInfo({ sources: [{ from: "page X", launch: false, names: [] }, { from: "section" }], manifest: {} }) === null);
  // A folded sub-page that starts a process is followed by the root run too: here the add-record mini page.
  const MINI = 'define("MbContractMiniPage",[],function(){return{entitySchemaName:"MbContract",methods:{mbStart:function(){ProcessModuleUtilities.executeProcess({sysProcessName:"MbMiniProcess"});}},diff:[]};});';
  const withMini = runMigration({ ...manifest(followed()), addRecordMiniPage: { schema: "MbContractMiniPage" },
    miniPageSchemas: { MbContractMiniPage: { schemas: [{ pkg: "MbMigrationBench", body: MINI }], seed: CLEAN_SEED } } });
  check("started processes: the process a folded sub-page starts reaches the root run's list and blocker",
    () => withMini.launchedProcesses?.processes.some((p) => p.name === "MbMiniProcess" && p.from.includes("page MbContractMiniPage"))
      && withMini.launchedProcessesBlockers.some((i) => /MbMiniProcess, which the page MbContractMiniPage starts/.test(i)),
    () => [withMini.miniPage?.processStarts, withMini.launchedProcessesBlockers]);

  // The user-task page itself is a process page: it is migrated with the process-page profile.
  const processSeed = [...CLEAN_SEED, { pkg: "CrtUIPlatform7x", body: fs.readFileSync(path.join(FIX, "process-page", "BasePageV2_skeleton.js"), "utf8") },
    { pkg: "CrtWizards7x", body: fs.readFileSync(path.join(FIX, "process-page", "BasePageProcessTemplate.js"), "utf8") }];
  const taskPage = runMigration({ entity: "", seed: processSeed, schemas: [{ pkg: "MbMigrationBench", body: body(`${PAGE}.js`) }],
    processPage: { stepsResolved: true, evidence: "the user named the approval process", steps: [{ process: PROCESS, element: TASK.element, consent: "pending" }] } });
  check("started processes: the benchmark user-task page is recognised as a process page and keeps its ContractId parameter",
    () => taskPage.processPage?.template === "BasePageProcessTemplate" && taskPage.processPage.pageName === PAGE && /ContractId/.test(taskPage.plan),
    () => taskPage.processPage);

  // `--plan` from the CLI on a page whose only open item is the started process: exit 2 until it is followed, 0 after.
  const STARTER = 'define("UsrStartPage",[],function(){return{entitySchemaName:"UsrStart",methods:{usrStart:function(){ProcessModuleUtilities.executeProcess({sysProcessName:"MbApproveContractProcess"});}},diff:[{operation:"insert",name:"F",parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"Name"}}]};});';
  const settled = (lp) => JSON.stringify({ entity: "UsrStart", seed: CLEAN_SEED, schemas: [{ pkg: "UsrStart", body: STARTER }], targetPackage: "UsrSU",
    entityColumns: { Name: { type: "Text", title: "Name" } },
    planMeta: FULL_PLANMETA, signals: FULL_SIGNALS, placement: FULL_PLACEMENT, projectConventions: FULL_CONVENTIONS, ...(lp ? { launchedProcesses: lp } : {}) });
  const cliOpen = runMigrate(["-", "--plan"], { input: settled(), cwd: dir });
  const cliFollowed = runMigrate(["-", "--plan"], { input: settled(followed()), cwd: dir });
  check("started processes (CLI): --plan exits 2 when the started process is the only open item, and 0 once it is followed",
    () => cliOpen.status === 2 && /PLAN INCOMPLETE — started processes not followed: .*MbApproveContractProcess/.test(cliOpen.stderr || "")
      && cliFollowed.status === 0 && !/PLAN INCOMPLETE/.test(cliFollowed.stdout || ""),
    () => ({ open: [cliOpen.status, (cliOpen.stderr || "").slice(0, 300)], followed: [cliFollowed.status, (cliFollowed.stderr || "").slice(0, 400)] }));
}

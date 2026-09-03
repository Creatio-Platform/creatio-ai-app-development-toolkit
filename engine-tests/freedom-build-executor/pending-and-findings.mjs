// ENG-96458 — behavioural goldens for the three halves of this ticket that live in the build executor rather than
// in the engine, driven through the REAL core (skills/_workflow-core/build-executor/core.mjs) on the CLI adapter:
//
//   D4  the ☐ rows hold the RUN's close. The engine reports them (`verify.pending` + per-page `pendingRows`) and
//       the run refuses to call itself done while any is open — reporting "COMPLETE PENDING N CONFIRMATION(S)"
//       and returning the worklist. Measured: five Layout rows were handed to a human, printed once, and vanished
//       from the verdict, while the one item that actually failed a human check (a lost Feed tab) was one of them.
//   D5  a judge that finds a defect in the BUILT PAGE opens a build row, instead of filing it as an evidence
//       rejection. Measured: the judge itself wrote that the built grid "has no selectionState, _selectionOptions,
//       bulkActions or layoutConfig" — it had found the defect — and routed it as "the diff was column-scoped".
//   D6  the app unit's own scaffold is recorded in `standWrites.appScaffold`, merged across reports, so a later
//       unit can tell the run's own debris from a page somebody else owns.
//
// The assertions read the run's OWN return, not an agent's prose — same rule as source-blocker-park.mjs.
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(DIR, "..", "..", "skills", "_workflow-core", "cli.mjs");

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  let c = cond, threw = null;
  if (typeof cond === "function") { try { c = cond(); } catch (e) { c = false; threw = e; } }
  if (c) { pass++; console.log("  ✅ " + name); return; }
  fail++; console.log("  ❌ " + name + (threw ? "  (threw: " + threw.message + ")" : ""));
  if (detail !== undefined) { let d; try { d = typeof detail === "function" ? detail() : detail; } catch (e) { d = "<detail threw: " + e.message + ">"; } console.log("      ↳ " + (typeof d === "string" ? d : JSON.stringify(d))); }
};

const BEX_INPUT = {
  manifest: "/mig/manifest.json", environment: "dev", outDir: "/mig", planFile: "/mig/plan.md",
  engine: "/plug/skills/classic-to-freedom-migration/engine/migrate.mjs", sectionSchema: "BusinessRule1Section",
};

// A baseline Reconcile whose BUILD is finished — nothing missing, nothing unconfirmed, nothing parked — and which
// carries the five ☐ rows of the measured ENG-96445 run. This is the shape the old close called green.
const reconcileGreenWithPending = (pending) => ({
  approval: { found: true, version: "plan-405979535477", quote: "approved" }, planVersion: "plan-405979535477",
  unitKeys: ["main"], buildOrder: ["main"], targetPackage: "UsrBusinessRuleFreedom", packageState: "exists",
  mainEntity: "BusinessRule", sectionHost: "existing-app", applicationCode: "BusinessRuleFreedom",
  componentTypes: [], componentResolution: [], pageSchemas: { main: "UsrBusinessRule_TopAreaFormPage" },
  parents: {}, reachability: [], reachabilityState: {}, preflightItems: [],
  resolutionsUnmatched: [], resolutionsConflicts: [],
  evidenceIds: [], unjudgedEvidenceIds: [], evidenceFiled: [], evidenceRejected: [],
  schemaNamePrefixEmpty: false,
  // Required since the merge with ENG-95503: the answers channel's two repair-grant arrays and the
  // unconsumed-answer list must be PRESENT even when empty — an omitted one is a dropped grant or a
  // silently discarded operator answer, which is the failure that ticket exists to remove.
  resolutionsReopened: [], resolutionsPending: [], unconsumedResolutions: [],
  parkedUnits: [], proposals: [], blocked: [], discrepancies: [], staleQueueKeys: [], newKeys: [],
  verify: {
    complete: true, missing: 0, unverified: 0, pending: pending.length, planGaps: [],
    pages: { main: { complete: true, buildComplete: true, missing: 0, unverified: 0, builderOpen: 0,
      pending: pending.length, pendingRows: pending } },
  },
  exitCode: 0, planGaps: [], roundOf: {}, verifyTablePath: "/mig/verify.md", notes: "",
});

// The five ☐ rows ENG-96445's verify.md actually carried (rows 1, 12, 13, 14, 20).
const ENG96445_PENDING = [
  { n: 1, deliverable: "List page → ListPageV3Template", rowKey: "main#confirm:list-page-listpagev3template" },
  { n: 12, deliverable: "Side profile — 2 fields", rowKey: "main#confirm:side-profile-2-fields" },
  { n: 13, deliverable: "Header — 16 fields · Feed (ESN)", rowKey: "main#confirm:header-16-fields-feed-esn" },
  { n: 14, deliverable: "Tab · New Tab — 3 fields", rowKey: "main#confirm:tab-new-tab-3-fields" },
  { n: 20, deliverable: "Card actions — native (ViewOptions/Tag)", rowKey: "main#confirm:card-actions-native-viewoptions-tag" },
];

// Drive the run, answering the baseline Reconcile and anything the Close asks for; return the terminal result and
// the whole log, because the operator worklist is a LOG line as well as a returned field.
function driveRun(tag, reconcileAnswer, extraAnswers = {}, cap = 12) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), `bex96458-${tag}-`));
  try {
    // THE RUN'S LOG IS THE CLI'S STDERR, not a field in the run file — so it is accumulated here. Several of the
    // decisions this file asserts on (a judge finding re-opening a unit, a finding against an unpublished key being
    // recorded rather than scheduled) are reported to the operator as log lines and nowhere else, and a test that
    // could not read them would be asserting on the wrong surface.
    const stderr = [];
    const cli = (...argv) => {
      const r = spawnSync(process.execPath, [CLI, ...argv], { encoding: "utf8" });
      if (r.stderr) stderr.push(r.stderr);
      return r;
    };
    const inputFile = path.join(tmp, "input.json"); writeFileSync(inputFile, JSON.stringify(BEX_INPUT));
    const runFile = path.join(tmp, "run.json");
    cli("start", runFile, "--workflow", "freedom-build-executor", "--input", inputFile, "--host", "codex");
    const dispatched = [];
    for (let i = 0; i < cap; i += 1) {
      const nxt = JSON.parse(cli("next", runFile).stdout);
      if (nxt.status === "done") return { dispatched, done: nxt, log: stderr.join("\n"), state: JSON.parse(readFileSync(runFile, "utf8")) };
      const item = nxt.items[0];
      dispatched.push({ id: item.id, phase: item.phase, label: item.label });
      let answer = null;
      if (item.id === "reconcile.baseline") answer = reconcileAnswer;
      else if (item.phase === "Close") answer = { written: true };
      else if (extraAnswers[item.phase]) answer = extraAnswers[item.phase](item);
      // The RUN FILE is read on every exit, not only the done one: a scenario that stops mid-run (this file's D5
      // cases stop at the next Reconcile on purpose — the judge has already spoken by then) still has to be able to
      // assert on what the run LOGGED, and the log lives in the run file.
      if (answer === null) return { dispatched, pending: nxt, log: stderr.join("\n"), state: JSON.parse(readFileSync(runFile, "utf8")) };
      const aFile = path.join(tmp, `answer-${i}.json`); writeFileSync(aFile, JSON.stringify(answer));
      const sub = cli("submit", runFile, item.id, aFile);
      if (sub.status !== 0) return { dispatched, submitErr: sub.stderr, pending: nxt, log: stderr.join("\n"), state: JSON.parse(readFileSync(runFile, "utf8")) };
    }
    return { dispatched, cap: true, log: stderr.join("\n") };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

console.log("\n===== D4: unanswered ☐ rows hold the run's close =====");

const held = driveRun("pending", reconcileGreenWithPending(ENG96445_PENDING));
check("the run reaches its close (the build is finished — nothing here is a build gap)",
  () => !!held.done, () => JSON.stringify(held.pending || held).slice(0, 300));
check("D4: the run does NOT report `complete: true` while five confirmations are open — the exact state ENG-96445 closed green on",
  () => held.done?.result?.complete === false,
  () => JSON.stringify({ complete: held.done?.result?.complete }));
check("D4: and it says WHY it is not complete — `buildComplete` is true, so the operator is not sent to build anything",
  () => held.done?.result?.buildComplete === true,
  () => JSON.stringify({ buildComplete: held.done?.result?.buildComplete }));
check("D4: all five ☐ rows come back as an operator worklist, each with the row key an answer is recorded against",
  () => {
    const rows = held.done?.result?.pendingConfirmations || [];
    return rows.length === 5 && rows.every((r) => r.unit === "main" && r.rowKey && r.deliverable)
      && rows.some((r) => /Feed \(ESN\)/.test(r.deliverable));
  },
  () => JSON.stringify(held.done?.result?.pendingConfirmations));
check("D4: `next` tells the operator what closes them — confirm on-stand, or record an `accepted` resolution",
  () => /pendingConfirmations/.test(held.done?.result?.next || "") && /accepted/.test(held.done?.result?.next || ""),
  () => held.done?.result?.next);

console.log("\n===== D4: with nothing pending, the close is unchanged =====");

const green = driveRun("green", reconcileGreenWithPending([]));
check("D4: a run with NO ☐ row still closes `complete: true` — the hold is a new state, not a new way to fail",
  () => green.done?.result?.complete === true && (green.done?.result?.pendingConfirmations || []).length === 0,
  () => JSON.stringify({ complete: green.done?.result?.complete, rows: green.done?.result?.pendingConfirmations }));
check("D4: and its `next` is the ordinary completion report, not the confirmations worklist",
  () => /as the completion report/.test(green.done?.result?.next || "")
    && !/pendingConfirmations/.test(green.done?.result?.next || ""),
  () => green.done?.result?.next);

console.log("\n===== D4: an `accepted` decision recorded in the engine's own count closes the hold =====");

// The engine applies the acceptance and publishes `pending: 0` — the run must then close green with no special
// case of its own. This is the contract between the two halves: the run holds on the COUNT, never on its own idea
// of which rows are answered.
const accepted = driveRun("accepted", reconcileGreenWithPending([]));
check("D4: the run reads the engine's count and nothing else — once the engine reports no pending row, the close is green",
  () => accepted.done?.result?.complete === true);

console.log("\n===== D5: a judge that finds a PAGE defect opens a build row =====");

// A baseline with `main` genuinely open and one evidence record awaiting a verdict, so the round actually reaches
// Build → Verify → Judge and the judge's answer can be observed doing something.
const reconcileOpenWithEvidence = () => ({
  ...reconcileGreenWithPending([]),
  evidenceIds: ["main#quality-gates"], unjudgedEvidenceIds: ["main#quality-gates"], evidenceFiled: ["main#quality-gates"],
  verify: {
    complete: false, missing: 1, unverified: 0, pending: 0, planGaps: [],
    pages: { main: { complete: false, buildComplete: false, missing: 1, unverified: 0, builderOpen: 1,
      openRows: [{ deliverable: "Field `UsrStage`", status: "❌ MISSING", evidence: "missing: UsrStage", outcome: "missing", owner: "builder" }] } },
  },
  exitCode: 2,
});
// The judge's real ENG-96445 finding, routed the way D5 asks for it: an evidence verdict AND a page defect.
const JUDGE_WITH_DEFECT = {
  verdicts: [{ id: "main#quality-gates", convincing: true, why: "the record names the reference page and the components diffed",
    pageDefect: { unit: "main", what: "the built crt.DataGrid has no selectionState, _selectionOptions, bulkActions or layoutConfig, while Contacts_ListPage carries all four" } }],
  evidenceWritten: [], notes: "",
};
// The same finding aimed at a key `--units` does not publish. It must be RECORDED and NOT scheduled — a finding
// nothing schedules would let the run close green with the reported defect untouched.
const JUDGE_UNKNOWN_UNIT = {
  verdicts: [{ id: "main#quality-gates", convincing: true, why: "fine",
    pageDefect: { unit: "listpage", what: "no bulkActions" } }],
  evidenceWritten: [], notes: "",
};
const buildAnswers = (judge) => ({
  Refs: () => ({ written: true, files: [], sliceKeys: ["main"], notes: "" }),
  Build: (item) => ({ unit: "main", schemaName: "UsrBusinessRule_TopAreaFormPage", claimedBuilt: ["Field UsrStage"],
    guidelines: { ran: false, notRunWhy: "not the subject of this golden" },
    selfCheck: { ran: true, complete: false, buildComplete: false, missing: 1, unverified: 0, fixAttempted: true },
    proposals: [], blocked: [], _item: item.id }),
  Verify: () => ({ pagesWritten: ["main"], builtFile: "/mig/built.json", queueWritten: true,
    reachabilityWritten: {}, evidenceWritten: [], discrepancies: [], notes: "" }),
  Judge: () => judge,
});

const withDefect = driveRun("judge-defect", reconcileOpenWithEvidence(), buildAnswers(JUDGE_WITH_DEFECT), 16);
const defectLog = withDefect.log || "";
check("D5: the run REACHES the judge — the scenario is not vacuously passing on a round that never judged anything",
  () => withDefect.dispatched.some((d) => d.phase === "Judge"),
  () => withDefect.dispatched.map((d) => `${d.phase}:${d.id}`).join(", "));
check("D5: a `pageDefect` on a published unit is taken as a FINDING and re-opens that unit for one repair round — the gap becomes buildable work, not an evidence rewrite",
  () => /judge found a PAGE DEFECT on .main./.test(defectLog) && /selectionState/.test(defectLog),
  () => defectLog.slice(0, 600));

const unknownUnit = driveRun("judge-unknown", reconcileOpenWithEvidence(), buildAnswers(JUDGE_UNKNOWN_UNIT), 16);
const unknownLog = unknownUnit.log || "";
check("D5: a `pageDefect` against a key `--units` does NOT publish is recorded and NOT scheduled — and it is said out loud, never dropped",
  () => /which .--units. does not publish/.test(unknownLog) && /recorded, NOT scheduled/.test(unknownLog),
  () => unknownLog.slice(0, 600));
check("D5: and that unrecognised finding does not silently re-open some other unit instead",
  () => !/judge found a PAGE DEFECT on/.test(unknownLog));

console.log("\n===== D6: the app unit's own scaffold is recorded, merged, and never invented =====");

// A run that has to CREATE the application: `sectionHost: new-app` with the target package absent. That is the
// only path on which `create-app` / `create-app-section` mint anything, and therefore the only path that can
// leave debris. Both measured runs took it and shipped a dead `*_FormPage`, a stub entity and an unused `*_Detail`.
const reconcileNewApp = () => ({
  ...reconcileGreenWithPending([]),
  sectionHost: "new-app", packageState: "absent", targetPackage: "UsrBusinessRuleFreedom",
  unitKeys: ["main"], buildOrder: ["main"], pageSchemas: {},
  verify: {
    complete: false, missing: 1, unverified: 0, pending: 0, planGaps: [],
    pages: { main: { complete: false, buildComplete: false, missing: 1, unverified: 0, builderOpen: 1,
      openRows: [{ deliverable: "Form page", status: "❌ MISSING", evidence: "not built", outcome: "missing", owner: "builder" }] } },
  },
  exitCode: 2,
});
// What `create-app` + `create-app-section` actually left on the ENG-96445 stand, reported the way D6 asks: the
// stub section removed, the rest named — including the one the tool refused to delete.
const APP_ANSWER = {
  unit: "app", packageName: "UsrBusinessRuleFreedom", appName: "Business rules", claimedBuilt: ["application"],
  starterFormPage: "UsrBusinessRule_FormPage", starterListPage: "UsrBusinessRule_ListPage",
  appScaffold: {
    stubSection: "Business rules Freedom", stubEntity: "UsrBusinessRuleFreedom",
    starterPages: ["UsrBusinessRule_FormPage"], details: ["UsrBusinessRule_Detail"],
    removed: ["Business rules Freedom"],
    couldNotRemove: [{ what: "UsrBusinessRuleFreedom", why: "delete-app-section does not remove the stub entity" }],
  },
  proposals: [], blocked: [],
};
const appRun = driveRun("app-scaffold", reconcileNewApp(), {
  Refs: () => ({ written: true, files: [], sliceKeys: ["main"], notes: "" }),
  Build: (item) => (/app/.test(item.id) ? APP_ANSWER : null),
}, 16);
check("D6: the run dispatches the app unit — the scenario is not passing on a run that never created anything",
  () => appRun.dispatched.some((d) => /app/.test(d.id)),
  () => appRun.dispatched.map((d) => `${d.phase}:${d.id}`).join(", "));
check("D6: the scaffold the app unit minted is RECORDED, with the removals counted and the one it could not remove reported rather than hidden",
  () => /recording this run's app scaffold/.test(appRun.log || "")
    && /removed 1 artefact\(s\)/.test(appRun.log || "")
    && /1 could NOT be removed and are reported, not hidden/.test(appRun.log || ""),
  () => (appRun.log || "").split("\n").filter((l) => /scaffold/.test(l)).join(" | "));
check("D6: and the record reaches the queue carry as `standWrites.appScaffold`, naming every artefact — that record is what licenses a later unit to delete anything at all",
  () => {
    const carry = JSON.stringify(appRun.state || {});
    return /appScaffold/.test(carry) && /UsrBusinessRule_Detail/.test(carry) && /UsrBusinessRule_FormPage/.test(carry);
  },
  () => JSON.stringify(appRun.state || {}).slice(0, 300));

console.log(`\n=================\nENG-96458 EXECUTOR GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

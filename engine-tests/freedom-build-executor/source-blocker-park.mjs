// ENG-94859 — behavioural golden for source-caused blocker parking, driven through the REAL build-executor
// core (skills/_workflow-core/build-executor/core.mjs) on the Codex/CLI adapter — not the pure gate.mjs in
// isolation. This is the proof that the wiring fires: a blocker in the SOURCE the migration reads from parks
// at the baseline and the run closes with ZERO build dispatched, instead of re-attempting it every round and
// every re-run (the measured Applicant `list` failure: same blocker across six runs, 42 agents).
//
// The whole run is driven with ONE submitted agent answer — the baseline Reconcile — because the fix takes
// effect before Refs / Preflight / Build: with `main` already complete and `list` source-blocked, the
// schedule has nothing open, so the run reaches its zero-work close after the first (and only) agent.
// The negative case proves the classifier does not over-park: a BUILDER-caused blocker leaves `list` open,
// so the run proceeds past the baseline instead of closing.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
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
  engine: "/plug/skills/classic-to-freedom-migration/engine/migrate.mjs", sectionSchema: "ApplicantSection",
};

// A baseline Reconcile result where `main` is complete and `list` is the only open unit, carrying `blocker`.
// Every key the RECONCILE schema names is present (modelled on the green-baseline fixture in run-workflow-core).
const reconcileWith = (blocker) => ({
  approval: { found: true, version: "plan-abc", quote: "approved" }, planVersion: "plan-abc",
  unitKeys: ["main", "list"], buildOrder: ["list", "main"], targetPackage: "P", packageState: "exists", mainEntity: "Applicant",
  sectionHost: "existing-app", applicationCode: "App", componentTypes: [], componentResolution: [],
  pageSchemas: { main: "MainPage", list: "ListPage" }, parents: {}, reachability: [], reachabilityState: {},
  preflightItems: [], resolutionsUnmatched: [], resolutionsConflicts: [],
  evidenceIds: [], unjudgedEvidenceIds: [], evidenceFiled: [], evidenceRejected: [],
  // Required since the merge with the stage-2 line (ENG-95683): the empty-prefix flag must be PRESENT, so an
  // answer that omits it is refused. This fixture reads a real prefix, hence `false`.
  schemaNamePrefixEmpty: false,
  parkedUnits: [], proposals: [], blocked: [blocker], discrepancies: [], staleQueueKeys: [], newKeys: [],
  verify: {
    complete: false, missing: 1, unverified: 0, pending: 0, planGaps: [],
    pages: {
      main: { complete: true, buildComplete: true },
      // `list` is genuinely BUILD-open (a MISSING deliverable), so absent the source park it WOULD be dispatched
      // for a build — which is exactly what makes the contrast meaningful: the source park must stop that build.
      list: { complete: false, buildComplete: false, missing: 1, unverified: 0, openRows: [{ deliverable: "Field `UsrStage`", status: "❌ MISSING", evidence: "missing: UsrStage" }] },
    },
  },
  exitCode: 2, planGaps: [], roundOf: {}, verifyTablePath: "/mig/verify.md", notes: "",
});

const SOURCE_BLOCKER = {
  unit: "list",
  what: "Live render check on surface automatic:3 (real Chrome) could not be performed for this page",
  why: "`#Section/Applicant` errors at runtime with `Script error for \"Applicant...\"`",
};
const BUILDER_BLOCKER = {
  unit: "list",
  what: "Field `UsrStage` is missing from the built list page",
  why: "the builder did not add the column this round",
};

// A canned answer per phase — only the phases a zero-work close actually reaches (Reconcile, then the
// Close/persist writer). Anything else returns null, which drops that item and stops the drive loop, so a
// run that unexpectedly tried to BUILD is caught (its Build item gets no answer and `dispatched` records it).
const cannedFor = (item, reconcileAnswer) => {
  if (item.id === "reconcile.baseline") return reconcileAnswer;
  if (item.phase === "Close") return { written: true };
  return null; // Refs / Preflight / Build / Verify / Judge — not expected on the zero-work path
};

// Drive the run forward, submitting canned answers, until it is `done` or asks for something the zero-work
// path should never reach. Returns the terminal result, the FIRST item id, and every phase dispatched.
function driveRun(tag, reconcileAnswer, cap = 12) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), `bex-${tag}-`));
  try {
    const cli = (...argv) => spawnSync(process.execPath, [CLI, ...argv], { encoding: "utf8" });
    const inputFile = path.join(tmp, "input.json"); writeFileSync(inputFile, JSON.stringify(BEX_INPUT));
    const runFile = path.join(tmp, "run.json");
    cli("start", runFile, "--workflow", "freedom-build-executor", "--input", inputFile, "--host", "codex");
    const dispatched = [];
    let firstId = null, submitStatus = 0, submitErr = "";
    for (let i = 0; i < cap; i += 1) {
      const nxt = JSON.parse(cli("next", runFile).stdout);
      if (nxt.status === "done") return { firstId, submitStatus, submitErr, dispatched, done: nxt };
      const item = nxt.items[0];
      if (i === 0) firstId = item.id;
      dispatched.push({ id: item.id, phase: item.phase });
      const answer = cannedFor(item, reconcileAnswer);
      if (answer === null) return { firstId, submitStatus, submitErr, dispatched, pending: nxt };
      const aFile = path.join(tmp, `answer-${i}.json`); writeFileSync(aFile, JSON.stringify(answer));
      const sub = cli("submit", runFile, item.id, aFile);
      submitStatus = sub.status; submitErr = sub.stderr;
      if (sub.status !== 0) return { firstId, submitStatus, submitErr, dispatched, pending: nxt };
    }
    return { firstId, submitStatus, submitErr, dispatched, cap: true };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

console.log("\n===== source-caused blocker parks at baseline (ENG-94859) =====");

const src = driveRun("source", reconcileWith(SOURCE_BLOCKER));
check("the first work item is the baseline Reconcile", src.firstId === "reconcile.baseline");
check("with `list` source-blocked and `main` complete, the run reaches DONE",
  () => !!src.done, () => JSON.stringify(src.pending || src).slice(0, 300));
check("NO Build was ever dispatched — the source blocker never bought a build round",
  () => !src.dispatched.some((d) => d.phase === "Build"),
  () => src.dispatched.map((d) => `${d.phase}:${d.id}`).join(", "));
check("`list` is PARKED (not re-attempted)",
  () => (src.done?.result?.parked || []).some((p) => p.key === "list"),
  () => JSON.stringify(src.done?.result?.parked));
check("the park reason names the SOURCE failure and says a build round cannot close it",
  () => { const p = (src.done?.result?.parked || []).find((x) => x.key === "list"); return !!p && /SOURCE/.test(p.parkedWhy) && /no build round can close it/.test(p.parkedWhy); },
  () => JSON.stringify((src.done?.result?.parked || []).find((x) => x.key === "list")));
check("the run reports NOT complete (a park is an open question, not a green close), rounds 0",
  () => src.done?.result?.complete === false && src.done?.result?.rounds === 0,
  () => JSON.stringify({ complete: src.done?.result?.complete, rounds: src.done?.result?.rounds }));

console.log("\n===== a BUILDER-caused blocker does NOT park (no over-parking) =====");

const bld = driveRun("builder", reconcileWith(BUILDER_BLOCKER));
check("with a builder-caused blocker, `list` stays OPEN — the run does NOT zero-work close, it proceeds past the baseline",
  () => !bld.done && bld.dispatched.some((d) => d.phase !== "Reconcile" && d.phase !== "Close"),
  () => JSON.stringify({ done: !!bld.done, dispatched: bld.dispatched }).slice(0, 300));
check("`list` is NOT parked-and-closed by the source-blocker path (it is the builder's to fix)",
  () => !bld.done, () => JSON.stringify(bld.dispatched).slice(0, 200));

console.log(`\n=================\nSOURCE-BLOCKER-PARK GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

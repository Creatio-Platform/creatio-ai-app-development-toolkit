// ENG-96778 — behavioural goldens for the BUILD executor's stage gates, driven through the REAL core
// (skills/_workflow-core/build-executor/core.mjs) on the CLI adapter, with the faulted phase submitted `--death`.
//
// WHY `--death` AND NOT A FAULT-INJECTION FLAG. `submit <item-id> --death` is already the protocol's own
// "this agent returned null without spawning" (work-item.mjs, OUTCOME.DEATH), the CLI already exposes it, and the
// sibling suites already drive the real core through that CLI. The alternative considered was a `faultNullStep`
// option on the driver/adapters — more runtime surface, more to guard, no extra coverage, and a test-only switch
// that would have to be kept off the Claude host path for ever.
//
// WHAT EACH SCENARIO PROVES, and why a unit test could not:
//   AC 9   all Preflight agents die -> `preflight-produced-nothing` BEFORE any Judge or Build entry. The gate's
//          value is entirely in WHERE it is taken: the run used to walk on and build against the PRE-preflight
//          verdict with every ⚠ Confirm item still open.
//   AC 10  the complement of the zero-dispatch guard — see the note above that leg.
//   AC 11  units dispatched, every builder null: Verify STILL runs (a builder can write and then die), Judge does
//          not (there is no claim to rule on). Only an end-to-end run can show which of the two was skipped.
//   AC 12  a null or package-mismatching app unit defers the units behind it instead of dispatching them into a
//          package that is not there — and a PARTIAL app unit does not, which is what makes the leg a measurement
//          of the rule rather than of the fixture.
//   AC 13  a dead Judge leaves its evidence unjudged and queued, and charges no unit a repair round for it.
//
// The assertions read the run's OWN return and its dispatch sequence, never an agent's prose — same rule as
// source-blocker-park.mjs and pending-and-findings.mjs.
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

// The sentinel an answer function returns to make the CLI record a terminal DEATH for that item.
const DEATH = Symbol("death");

const BEX_INPUT = {
  manifest: "/mig/manifest.json", environment: "dev", outDir: "/mig", planFile: "/mig/plan.md",
  // A run with no control mode from any source STOPS `mode-not-chosen` before it schedules anything. These
  // suites are not about that gate, so they declare the non-interactive default explicitly.
  mode: "auto",
  engine: "/plug/skills/classic-to-freedom-migration/engine/migrate.mjs", sectionSchema: "ApplicantSection",
};

// A complete RECONCILE answer with `main` BUILD-OPEN — every key `RECONCILE_SHAPE` requires is present, so the
// arrival check passes and each leg below overlays only the fields it is actually about.
const reconcile = (extra = {}) => ({
  approval: { found: true, version: "plan-abc", quote: "approved" }, planVersion: "plan-abc",
  unitKeys: ["main"], buildOrder: ["main"], targetPackage: "UsrApplicants", packageState: "exists",
  mainEntity: "Applicant", sectionHost: "existing-app", applicationCode: "App",
  componentTypes: [], componentResolution: [], pageSchemas: { main: "UsrApplicant_FormPage" },
  parents: {}, reachability: [], reachabilityState: {}, preflightItems: [],
  resolutionsUnmatched: [], resolutionsConflicts: [],
  evidenceIds: [], unjudgedEvidenceIds: [], evidenceFiled: [], evidenceRejected: [],
  schemaNamePrefixEmpty: false,
  resolutionsReopened: [], resolutionsPending: [], unconsumedResolutions: [],
  runResolutions: [],
  roundState: { layoutPassDone: false, roundsSpent: 0, consumedRoundAnswers: [] },
  parkedUnits: [], proposals: [], blocked: [], discrepancies: [], staleQueueKeys: [], newKeys: [],
  verify: {
    complete: false, missing: 1, buildMissing: 1, unverified: 0, pending: 0, planGaps: [],
    pages: { main: { complete: false, buildComplete: false, missing: 1, buildMissing: 1, unverified: 0, builderOpen: 1,
      openRows: [{ deliverable: "Field `UsrStage`", status: "❌ MISSING", evidence: "missing: UsrStage", outcome: "missing", owner: "builder" }] } },
  },
  exitCode: 2, planGaps: [], roundOf: {}, verifyTablePath: "/mig/verify.md", notes: "",
  ...extra,
});

// The same baseline with an APP UNIT to schedule: `appUnitFor` returns one exactly when the target package is
// named and is not on the stand, and `scheduleUnits` sorts it to `at: -1` — first in the round, ahead of `main`.
const reconcileNewApp = (extra = {}) => reconcile({
  sectionHost: "new-app", packageState: "absent", targetPackage: "UsrApplicantsFreedom", pageSchemas: {},
  ...extra,
});

const REFS_OK = { written: true, files: [], slices: ["main"], notes: "" };
const VERIFY_OK = { pagesWritten: [], builtFile: "/mig/built.json", queueWritten: true,
  reachabilityWritten: {}, evidenceWritten: [], discrepancies: [], notes: "" };
const PAGE_BUILT = { unit: "main", schemaName: "UsrApplicant_FormPage", claimedBuilt: ["field UsrStage"],
  guidelines: { ran: false, notRunWhy: "not the subject of this golden" },
  selfCheck: { ran: true, complete: false, buildComplete: false, missing: 1, buildMissing: 1, unverified: 0, fixAttempted: true },
  proposals: [], blocked: [] };
// The app unit's three answers, one per branch of `applyAppUnitResult`.
const APP_OK = { unit: "app", packageName: "UsrApplicantsFreedom", appName: "Applicants", claimedBuilt: ["application"],
  starterFormPage: "UsrApplicant_FormPage", starterListPage: "UsrApplicant_ListPage", proposals: [], blocked: [] };
const APP_MISMATCH = { ...APP_OK, packageName: "SomeOtherPrefix_ApplicantsFreedom" };
// Package RIGHT, deliverable short: this is the branch AC 12 deliberately does NOT defer behind — the package
// the plan targets exists on the stand, so the units behind it have somewhere real to build.
const APP_PARTIAL = { ...APP_OK, starterFormPage: "", blocked: [{ what: "the stub section could not be removed", why: "delete-app-section returned an error" }] };

// Drive a run to its terminal state (or to the first item nothing answers), recording every dispatch and the
// whole log. `answers` is keyed by PHASE and may return `DEATH` to record a terminal null for that item.
function driveRun(tag, answers, cap = 20) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), `bex96778-${tag}-`));
  try {
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
    const seen = {};
    for (let i = 0; i < cap; i += 1) {
      const nxt = JSON.parse(cli("next", runFile).stdout);
      if (nxt.status === "done") return { dispatched, done: nxt, log: stderr.join("\n") };
      const item = nxt.items[0];
      dispatched.push({ id: item.id, phase: item.phase, label: item.label, prompt: item.prompt || "" });
      seen[item.phase] = (seen[item.phase] || 0) + 1;
      const answer = answers[item.phase] ? answers[item.phase](item, seen[item.phase]) : null;
      if (answer === null || answer === undefined) return { dispatched, pending: nxt, log: stderr.join("\n") };
      let sub;
      if (answer === DEATH) {
        sub = cli("submit", runFile, item.id, "--death");
      } else {
        const aFile = path.join(tmp, `answer-${i}.json`); writeFileSync(aFile, JSON.stringify(answer));
        sub = cli("submit", runFile, item.id, aFile);
      }
      if (sub.status !== 0) return { dispatched, submitErr: sub.stderr, pending: nxt, log: stderr.join("\n") };
    }
    return { dispatched, cap: true, log: stderr.join("\n") };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

const phasesOf = (run) => run.dispatched.map((d) => d.phase);
const resultOf = (run) => run.done?.result;

/* ===========================================================================
   AC 9 — the Preflight fan-out dies whole.
   =========================================================================== */
console.log("\n===== AC 9: preflight-produced-nothing =====");

const PREFLIGHT_ITEM = { id: "main#confirm:dcm:Applicant", pageKey: "main", kind: "confirm", item: "dcm", resolution: null };

const deadPreflight = driveRun("preflight-dead", {
  Reconcile: () => reconcile({ preflightItems: [PREFLIGHT_ITEM] }),
  Preflight: () => DEATH,
  Refs: () => REFS_OK,
  Build: () => PAGE_BUILT,
  Verify: () => VERIFY_OK,
  Judge: () => ({ verdicts: [] }),
  Close: () => ({ written: true }),
});
check("AC 9: a preflight fan-out where every agent returned nothing STOPS the run with `preflight-produced-nothing`",
  () => resultOf(deadPreflight)?.stopped === "preflight-produced-nothing",
  () => JSON.stringify({ stopped: resultOf(deadPreflight)?.stopped, dispatched: phasesOf(deadPreflight) }));
check("AC 9: it stops BEFORE any Judge or Build entry — the run used to walk straight on and build against the PRE-preflight verdict, with every ⚠ Confirm item still open",
  () => !phasesOf(deadPreflight).includes("Judge") && !phasesOf(deadPreflight).includes("Build"),
  () => phasesOf(deadPreflight).join(" -> "));
check("AC 9: and before REFS too — preflight is the last read-only point, so nothing was written and there is no carry to persist",
  () => !phasesOf(deadPreflight).includes("Refs") && !phasesOf(deadPreflight).includes("Close"),
  () => phasesOf(deadPreflight).join(" -> "));
check("AC 2: the stop carries the five keys — `stopped`, a reason, a `next`, and the fan-out arithmetic",
  () => { const r = resultOf(deadPreflight); return !!r && /FAILED phase/.test(r.reason || "") && r.agentsExpected === 1 && r.agentsReturned === 0 && /resumeFromRunId/.test(r.next || ""); },
  () => JSON.stringify({ reason: resultOf(deadPreflight)?.reason, next: resultOf(deadPreflight)?.next,
    expected: resultOf(deadPreflight)?.agentsExpected, returned: resultOf(deadPreflight)?.agentsReturned }));
check("AC 3: the stop returns `phaseOutcomes` — Reconcile answered, Preflight produced NONE",
  () => resultOf(deadPreflight)?.phaseOutcomes?.Preflight?.state === "none"
    && resultOf(deadPreflight)?.phaseOutcomes?.Reconcile?.state === "ok",
  () => JSON.stringify(resultOf(deadPreflight)?.phaseOutcomes));
check("AC 9: the run says WHY it stopped where it did — before the first stand write, not after one",
  () => /stopping BEFORE the first stand write/.test(deadPreflight.log), () => deadPreflight.log.slice(-600));

// THE CONTROL, and the branch that keeps this gate off every healthy simple surface.
const noPreflightItems = driveRun("preflight-none", {
  Reconcile: () => reconcile(),
  Refs: () => REFS_OK,
  Build: () => PAGE_BUILT,
  Verify: () => VERIFY_OK,
  Close: () => ({ written: true }),
});
check("AC 9 (control): ZERO ⚠ Confirm items produces NO stop — a phase that dispatched nothing is not a failed phase, and the run proceeds to Refs and Build exactly as before",
  () => resultOf(noPreflightItems)?.stopped !== "preflight-produced-nothing"
    && phasesOf(noPreflightItems).includes("Refs") && phasesOf(noPreflightItems).includes("Build"),
  () => JSON.stringify({ stopped: resultOf(noPreflightItems)?.stopped, dispatched: phasesOf(noPreflightItems) }));
check("AC 9 (control): and Preflight is recorded as `skipped`, not as a phase that failed",
  () => resultOf(noPreflightItems)?.phaseOutcomes?.Preflight?.state === "skipped",
  () => JSON.stringify(resultOf(noPreflightItems)?.phaseOutcomes));

/* ===========================================================================
   AC 11 — units dispatched, every builder null.
   =========================================================================== */
console.log("\n===== AC 11: builders all null — Verify runs once, Judge does not =====");

// `unjudgedEvidenceIds` is what makes this leg discriminating: WITHOUT the gate, `judgeIfWaiting` has a real id
// to rule on and dispatches a Judge. So "no Judge was dispatched" measures the gate rather than an empty queue.
const deadBuilders = driveRun("builders-dead", {
  Reconcile: () => reconcile({ unjudgedEvidenceIds: ["main#quality-gates"] }),
  Refs: () => REFS_OK,
  Build: () => DEATH,
  Verify: () => VERIFY_OK,
  Judge: () => ({ verdicts: [] }),
  Close: () => ({ written: true }),
}, 24);
const verifiesIn = (run) => run.dispatched.filter((d) => d.phase === "Verify");
// THE ROUND WINDOW — the slice from the round's first Verify to the Reconcile that closes it, computed
// DEFENSIVELY (PR #171 review, Alexandr-Kravchuk). It used to be written inline as
// `slice(firstVerify, phases.indexOf("Reconcile", firstVerify) + 1)`, and when that Reconcile is NOT in the
// sequence `indexOf` returns -1, the end argument is 0, and the slice is EMPTY — so `!window.includes("Judge")`
// passed because the window held nothing, not because Judge had been skipped. The one assertion covering AC 11's
// "Judge does not run in that round" was measuring the evidence being absent: it would have stayed green if the
// run never reached a second round, and green if the core stopped dispatching everything the window names.
// Returning `null` when the window cannot be located turns that class of regression into a RED check, and it is
// what lets the window carry a second assertion (the "exactly once" count below) at all.
const roundWindow = (run) => {
  const phases = phasesOf(run);
  const firstVerify = phases.indexOf("Verify");
  const roundEnd = phases.indexOf("Reconcile", firstVerify);
  if (firstVerify < 0 || roundEnd < 0) return null;
  return phases.slice(firstVerify, roundEnd + 1);
};
const countIn = (window, phase) => (window || []).filter((p) => p === phase).length;
check("AC 11 (precondition): the round window is LOCATABLE — both the first Verify and the Reconcile that closes its round are in the dispatch sequence. Asserted on its own, first, because every check below reads this window and an unlocatable one used to pass them silently",
  () => roundWindow(deadBuilders) !== null,
  () => phasesOf(deadBuilders).join(" -> "));
check("AC 11: a round whose builders all returned nothing still runs VERIFY, and EXACTLY ONCE inside that round — a builder can write to the stand and then die, so skipping the read-back would leave the verdict on file stale, while a second read-back in the same round is the extra agent and extra `--verify` stand read the AC 10/11 split exists to avoid. Counted in the round window, not across the run: with every Build dead the run spends several rounds, so a run-wide count can only ever say `>= 1`",
  () => roundWindow(deadBuilders) !== null && countIn(roundWindow(deadBuilders), "Verify") === 1,
  () => JSON.stringify({ window: roundWindow(deadBuilders), verifiesAcrossRun: verifiesIn(deadBuilders).length }));
check("AC 11: and it does NOT run Judge in that round, even though an unjudged evidence record was waiting — Judge rules on claims, and no claim was filed",
  () => roundWindow(deadBuilders) !== null && !roundWindow(deadBuilders).includes("Judge"),
  () => JSON.stringify({ window: roundWindow(deadBuilders), phases: phasesOf(deadBuilders) }));
check("AC 11: the result NAMES the units whose builders returned nothing — 'nothing built' and 'nothing open' are the same empty list and opposite repairs",
  () => (resultOf(deadBuilders)?.buildersReturnedNothing || []).includes("main"),
  () => JSON.stringify(resultOf(deadBuilders)?.buildersReturnedNothing));
check("AC 11: the run SAYS which of the two phases it skipped and why, rather than leaving an operator to infer it from a missing agent",
  () => /Verify still runs once/.test(deadBuilders.log) && /Judge is skipped/.test(deadBuilders.log),
  () => deadBuilders.log.split("\n").filter((l) => /Judge is skipped/.test(l)).join("\n"));
check("AC 3: `phaseOutcomes` records Build `none` for that round and Judge `skipped`",
  () => resultOf(deadBuilders)?.phaseOutcomes?.Build?.state === "none"
    && resultOf(deadBuilders)?.phaseOutcomes?.Judge?.state === "skipped",
  () => JSON.stringify(resultOf(deadBuilders)?.phaseOutcomes));

/* AC 10 — THE ZERO-DISPATCH GUARD, and an honest note about its reachability.
 *
 * `nothing-built` fires when a round had open units and dispatched NONE of them: Verify's whole job is to read the
 * stand back after this round wrote to it, so a round that wrote nothing would have Verify re-publish the previous
 * verdict as though this round had produced it. The DECISION is pinned in the unit table
 * (`run-workflow-core.mjs`, "stage gates") and the stop's shape by `gateStop`.
 *
 * WHAT IS NOT PINNED HERE, stated rather than glossed: with the current scheduler the state is not reachable from
 * outside. `driveRounds` breaks before calling `oneRound` when nothing is open, and `buildRound`'s loop dispatches
 * its first unit unconditionally — the two skips in it (a checkpoint, and AC 12's deferral) are both set BY a
 * dispatch. So the leg below asserts the COMPLEMENT, which is the discriminating half of the split: a round that
 * did dispatch must NOT take this path, and must run its Verify. The guard is defensive against a future
 * scheduling change, which is the same standing `verifier-failed` had before a run met it.
 */
console.log("\n===== AC 10: a round that DID dispatch never takes the nothing-built path =====");
check("AC 10 (complement): a round with a dispatched unit does not return `nothing-built`, and its Verify runs — the two halves of the split are decided by DISPATCH count, not by what came back",
  () => resultOf(deadBuilders)?.stopped !== "nothing-built" && verifiesIn(deadBuilders).length >= 1,
  () => JSON.stringify({ stopped: resultOf(deadBuilders)?.stopped, verifies: verifiesIn(deadBuilders).length }));

/* ===========================================================================
   AC 12 — the app unit did not complete.
   =========================================================================== */
console.log("\n===== AC 12: app-unit-incomplete defers the units behind it =====");

const appDead = driveRun("app-dead", {
  Reconcile: () => reconcileNewApp(),
  Refs: () => REFS_OK,
  Build: (item) => (/app/.test(item.id) ? DEATH : PAGE_BUILT),
  Verify: () => VERIFY_OK,
  Close: () => ({ written: true }),
}, 24);
const buildIds = (run) => run.dispatched.filter((d) => d.phase === "Build").map((d) => d.id);
check("AC 12: an app unit that returned NOTHING stops the round with `app-unit-incomplete`",
  () => resultOf(appDead)?.stopped === "app-unit-incomplete",
  () => JSON.stringify({ stopped: resultOf(appDead)?.stopped, dispatched: phasesOf(appDead) }));
check("AC 12: the page unit behind it is DEFERRED and named, never silently dropped",
  () => (resultOf(appDead)?.deferred || []).includes("main"),
  () => JSON.stringify(resultOf(appDead)?.deferred));
check("AC 12: and it is genuinely NOT DISPATCHED — before this gate, `buildRound`'s loop broke only on a checkpoint and page openness read the verify gate, never `packageState`, so a page builder ran against a package that does not exist",
  () => buildIds(appDead).length === 1 && /app/.test(buildIds(appDead)[0]),
  () => buildIds(appDead).join(", "));
check("AC 12: no Verify runs for that round — the deferred units were never dispatched, so there is nothing of theirs to read back",
  () => verifiesIn(appDead).length === 0, () => phasesOf(appDead).join(" -> "));
check("AC 12: what the app unit DID write is persisted before the stop — this is a live stand, and a blocker row nobody wrote down is a blocker nobody can settle. The persistence step names the stop it is writing for, in its own prompt.",
  () => appDead.dispatched.some((d) => d.phase === "Close" && /stopping on an incomplete app unit/.test(d.prompt)),
  () => appDead.dispatched.filter((d) => d.phase === "Close").map((d) => d.prompt.slice(0, 160)).join(" | ") || phasesOf(appDead).join(" -> "));
check("AC 2: the stop carries the same five keys as every other gate stop",
  () => { const r = resultOf(appDead); return !!r && /did not complete/.test(r.reason || "") && (r.next || "").length > 0
    && typeof r.agentsExpected === "number" && typeof r.agentsReturned === "number"; },
  () => JSON.stringify({ reason: resultOf(appDead)?.reason, next: resultOf(appDead)?.next }));
check("AC 2: and its `next` is the one THIS failure family owns (PR #171 review) — it sends the operator to the stand and does NOT carry the agent-death resume clause, which asserted 'nothing it would have written exists' on a path that had just run `persistPending('stopping on an incomplete app unit')`. One string used to hold both instructions",
  () => { const n = resultOf(appDead)?.next || "";
    return /check on the stand/.test(n) && !/nothing it would have written exists/.test(n) && !/resumeFromRunId/.test(n); },
  () => resultOf(appDead)?.next);
check("AC 2: the stop's two numbers report the DEFERRAL rather than the round's dispatch tally (PR #171 review, m-dymytrova) — `agentsExpected` counts the units the round had OPEN, the same denominator `nothing-built` uses, so a stop that deferred a unit can never read as healthy arithmetic",
  () => resultOf(appDead)?.agentsExpected === 2 && resultOf(appDead)?.agentsReturned === 0,
  () => JSON.stringify({ agentsExpected: resultOf(appDead)?.agentsExpected, agentsReturned: resultOf(appDead)?.agentsReturned }));
check("AC 3: the app-unit stop RECORDS the two phases it skipped — both `outcomes.skipped` calls on this branch were unpinned, so deleting either left the whole suite green (PR #171 review, finding 2)",
  () => resultOf(appDead)?.phaseOutcomes?.Verify?.state === "skipped" && resultOf(appDead)?.phaseOutcomes?.Judge?.state === "skipped",
  () => JSON.stringify(resultOf(appDead)?.phaseOutcomes));

const appMismatch = driveRun("app-mismatch", {
  Reconcile: () => reconcileNewApp(),
  Refs: () => REFS_OK,
  Build: (item) => (/app/.test(item.id) ? APP_MISMATCH : PAGE_BUILT),
  Verify: () => VERIFY_OK,
  Close: () => ({ written: true }),
}, 24);
check("AC 12: a PACKAGE MISMATCH is the same blocker — the application exists but under a package the plan does not target, and every unit behind it would build into the wrong place",
  () => resultOf(appMismatch)?.stopped === "app-unit-incomplete" && (resultOf(appMismatch)?.deferred || []).includes("main")
    && buildIds(appMismatch).length === 1,
  () => JSON.stringify({ stopped: resultOf(appMismatch)?.stopped, deferred: resultOf(appMismatch)?.deferred, builds: buildIds(appMismatch) }));
// THE MISMATCH LEG IS THE ONE THE REVIEW WAS ABOUT (PR #171). Nothing died here: the app builder ANSWERED, created
// an application and a package on a live stand, and `recordForeignScaffold` wrote that down — which is why the two
// checks below exist and why the resume clause had to stop riding on this stop unconditionally.
check("AC 2 (mismatch): the stop reports 2 open / 1 answered, not a healthy 1-of-1 — on this leg the app builder DID answer and `builtThisRound` is not empty, so the old dispatch tally attached perfect arithmetic to a stop whose own contract says those numbers name the shape of the failure",
  () => resultOf(appMismatch)?.agentsExpected === 2 && resultOf(appMismatch)?.agentsReturned === 1,
  () => JSON.stringify({ agentsExpected: resultOf(appMismatch)?.agentsExpected, agentsReturned: resultOf(appMismatch)?.agentsReturned }));
check("AC 2 (mismatch): and the `next` does not tell the operator to inspect what the app unit created and then that nothing it would have written exists — following the second half discards recoverable stand state this path deliberately persisted",
  () => { const n = resultOf(appMismatch)?.next || "";
    return /check on the stand/.test(n) && !/nothing it would have written exists/.test(n) && !/Fix what killed the agents/.test(n); },
  () => resultOf(appMismatch)?.next);
check("AC 3 (mismatch): Verify and Judge are recorded as skipped on this leg too, and Judge's reason is this branch's own rather than the shared 'nothing filed' one that is false here",
  () => resultOf(appMismatch)?.phaseOutcomes?.Verify?.state === "skipped"
    && resultOf(appMismatch)?.phaseOutcomes?.Judge?.state === "skipped"
    && /stopped on an incomplete app unit/.test(resultOf(appMismatch)?.phaseOutcomes?.Judge?.why || ""),
  () => JSON.stringify(resultOf(appMismatch)?.phaseOutcomes));

// THE CONTROL that makes the two legs above a measurement of the RULE. A partial app unit — planned package,
// short deliverable — leaves the unit open exactly as it always did and does NOT defer anything.
const appPartial = driveRun("app-partial", {
  Reconcile: () => reconcileNewApp(),
  Refs: () => REFS_OK,
  Build: (item) => (/app/.test(item.id) ? APP_PARTIAL : PAGE_BUILT),
  Verify: () => VERIFY_OK,
  Judge: () => ({ verdicts: [] }),
  Close: () => ({ written: true }),
}, 24);
check("AC 12 (control): a PARTIAL app unit — planned package on the stand, deliverable short — does NOT defer anything: `main` is dispatched in the same round, because the package it builds into is really there",
  () => resultOf(appPartial)?.stopped !== "app-unit-incomplete" && buildIds(appPartial).some((id) => /main/.test(id)),
  () => JSON.stringify({ stopped: resultOf(appPartial)?.stopped, builds: buildIds(appPartial) }));

/* ===========================================================================
   AC 13 — a dead Judge.
   =========================================================================== */
console.log("\n===== AC 13: a dead Judge leaves its evidence unjudged =====");

const PREFLIGHT_RESOLVED = { resolved: [{ id: PREFLIGHT_ITEM.id, answer: "no DCM on this entity",
  referencePage: "Contacts_FormPage", components: ["crt.Input"] }], unresolved: [] };

const deadJudge = driveRun("judge-dead", {
  Reconcile: () => reconcile({ preflightItems: [PREFLIGHT_ITEM] }),
  Preflight: () => PREFLIGHT_RESOLVED,
  Judge: (item, nth) => (nth === 1 ? DEATH : { verdicts: [] }),
  Refs: () => REFS_OK,
  Build: () => PAGE_BUILT,
  Verify: () => VERIFY_OK,
  Close: () => ({ written: true }),
}, 26);
const judgeItems = (run) => run.dispatched.filter((d) => d.phase === "Judge");
check("AC 13: a Judge that returned nothing does NOT stop the run — a missing verdict costs the run a ruling, not its deliverable",
  () => !/produced-nothing/.test(resultOf(deadJudge)?.stopped || "") && judgeItems(deadJudge).length >= 1,
  () => JSON.stringify({ stopped: resultOf(deadJudge)?.stopped, judges: judgeItems(deadJudge).map((j) => j.id) }));
check("AC 13: its evidence stays UNJUDGED and QUEUED — the ids used to be cleared unconditionally, and since the Judge is the writer of preflight records, nothing would have brought them back as `unjudgedEvidenceIds` either",
  () => /stay UNJUDGED/.test(deadJudge.log), () => deadJudge.log.split("\n").filter((l) => /UNJUDGED/.test(l)).join("\n"));
check("AC 13: the SAME evidence id reaches a later Judge — that is what 'queued' means, asserted rather than described",
  () => judgeItems(deadJudge).length >= 2 && judgeItems(deadJudge).slice(1).some((j) => j.prompt.includes(PREFLIGHT_ITEM.id)),
  () => judgeItems(deadJudge).map((j) => j.id).join(", "));
check("AC 13: NO unit is charged a repair round for a verdict that never arrived — a dead judge raises no page defect, so nothing re-opens",
  () => !/judge found a PAGE DEFECT/.test(deadJudge.log), () => deadJudge.log.split("\n").filter((l) => /PAGE DEFECT/.test(l)).join("\n"));
// ENG-96778 review F1/F2 — THE ASSERTION THAT LET THE DEFECT THROUGH, rewritten to measure the claim it makes.
// It used to read `!!phaseOutcomes?.Judge || judgeItems.length >= 2`: the fallback was already guaranteed by the
// check above it, and `!!Judge` is truthy for ANY state — so it passed while the run reported `Judge: ok` on a run
// whose post-preflight Judge had died. `phaseOutcomes` is where both SKILL.md files tell the operator a limp shows,
// so the state and the site of the death are what this has to read.
check("AC 13: `phaseOutcomes` marks Judge `none` — a later healthy Judge does NOT erase the one that died, which is the whole point of the record",
  () => resultOf(deadJudge)?.phaseOutcomes?.Judge?.state === "none",
  () => JSON.stringify(resultOf(deadJudge)?.phaseOutcomes?.Judge));
check("AC 13: and it names WHERE the ruling went missing — the post-preflight Judge — beside the round Judge that did answer",
  () => { const j = resultOf(deadJudge)?.phaseOutcomes?.Judge;
    return j?.where === "preflight-evidence" && Array.isArray(j.occurrences) && j.occurrences.length >= 2
      && j.occurrences.some((o) => o.state === "ok"); },
  () => JSON.stringify(resultOf(deadJudge)?.phaseOutcomes?.Judge));

// ===========================================================================
// ENG-96778 review F4 (= the implementation stage's discovered risk R-E) — THE RECORDS RIDE WITH THE IDS.
// AC 13 keeps a dead Judge's evidence ids queued, and the leg above proves the id reaches the next Judge. But the
// Judge is also the WRITER of those preflight records into the built file, and `preflightEvidence` lives only in
// this process: the next Judge used to be handed the id with NOTHING behind it — no `evidence[<id>]` entry in the
// built file, no block in its prompt — so the only honest verdict left was "an id with no record is not mine to
// invent", and a page waiting on that row stayed open until an entirely new run re-resolved the ⚠ Confirm item.
// These two legs are a PAIR: the record travels while it is still unfiled, and it stops travelling the moment a
// writer reports filing it. Without the control, the first would pass on a build that appended the block always.
// ===========================================================================
console.log("\n===== F4: a dead Judge's evidence RECORDS reach the next Judge, not just their ids =====");

const laterJudge = judgeItems(deadJudge)[1];
check("F4: the later Judge is handed the RECORD behind the queued id, not only its name — otherwise it is asked to rule on an id whose `evidence` entry nothing ever wrote, and the row stays open for a whole new run",
  () => !!laterJudge && laterJudge.prompt.includes("PREFLIGHT EVIDENCE TO FILE BEFORE JUDGING")
    && laterJudge.prompt.includes(JSON.stringify({ [PREFLIGHT_ITEM.id]: { referencePage: "Contacts_FormPage", components: ["crt.Input"] } })),
  () => (laterJudge ? laterJudge.prompt.slice(0, 1200) : "no second Judge was dispatched"));

// THE CONTROL that makes the leg above a measurement of the RULE rather than of an unconditional append. Same
// shape, one difference that decides it: the post-preflight Judge ANSWERS and reports `evidenceWritten` for the
// record, so the record is on file and has no business riding to anyone ever again.
// THE SECOND RECONCILE REPORTS THE SAME ID STILL UNJUDGED — filed but not ruled on, which is exactly what a Judge
// that returned `evidenceWritten: [id]` with an empty `verdicts` leaves behind. That is what makes this control
// bite: the id IS in the round Judge's dispatch, so the only thing that can keep the record out of its prompt is
// the filing receipt. Point it at a different id instead and the leg would pass on the id filter alone, measuring
// nothing about the receipt — the F2 failure mode this suite has already been burned by once.
const judgeFiledEvidence = driveRun("judge-filed-evidence", {
  Reconcile: (item, nth) => (nth === 1
    ? reconcile({ preflightItems: [PREFLIGHT_ITEM] })
    : reconcile({ unjudgedEvidenceIds: [PREFLIGHT_ITEM.id] })),
  Preflight: () => PREFLIGHT_RESOLVED,
  Judge: () => ({ verdicts: [], evidenceWritten: [PREFLIGHT_ITEM.id] }),
  Refs: () => REFS_OK,
  Build: () => PAGE_BUILT,
  Verify: () => VERIFY_OK,
  Close: () => ({ written: true }),
}, 26);
check("F4 (control): once a Judge REPORTS filing the record it stops travelling — the next Judge in the same run gets the ids alone, exactly as a healthy run always did",
  () => { const later = judgeItems(judgeFiledEvidence)[1];
    return !!later && !later.prompt.includes("PREFLIGHT EVIDENCE TO FILE BEFORE JUDGING")
      && !later.prompt.includes("Contacts_FormPage"); },
  () => JSON.stringify({ judges: judgeItems(judgeFiledEvidence).map((j) => j.id),
    hasBlock: judgeItems(judgeFiledEvidence).map((j) => j.prompt.includes("PREFLIGHT EVIDENCE TO FILE BEFORE JUDGING")) }));

console.log(`\n=================\nSTAGE-GATES GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

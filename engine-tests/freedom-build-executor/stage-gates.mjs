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

/* ===========================================================================
   ENG-96778 (PR #171 SCOPE EXPANSION) — THE STAND ITSELF DID NOT ANSWER.

   The measured incident (migration `UsrAwesome`, session ce23724f): the stand was killed mid-Build. The app unit's
   builder returned a STRUCTURED blocker naming the outage; because a structured answer is a valid answer,
   `applyAppUnitResult` took the partial branch, `buildRound` kept dispatching, and `list`, `main` and `reach` each
   spent 2–3 minutes rediscovering the dead port before Verify, Judge and the round-tail Reconcile ran against it — and
   the host re-spawned that stalled Reconcile four times over fourteen hours. Nothing in the core read a blocker's
   CONTENT before the round tail.

   WHAT THESE LEGS PROVE, and why the pure `gate.mjs` goldens cannot: the WIRING. That the first environment blocker
   halts the round (the rest deferred, never dispatched); that the stop fires BEFORE Verify, Judge and the round-tail
   Reconcile; that the fault is written to the queue file as `roundState.environmentFault` and the status document
   names the one-shot answer; that the NEXT run refuses inside the baseline gates — one Reconcile, one Close, nothing
   at the stand — until `environment-restored-<n>` reads `go`; that a `go` closes the record and a second outage asks
   for `-2`; and that no round and no repair grant is charged for an outage. Every assertion reads the run's own
   return or dispatch sequence, never prose, and EVERY ONE WAS MUTATION-TESTED before push — this PR shipped vacuous
   assertions twice, so each leg names the mutant that kills it.
   =========================================================================== */
console.log("\n===== ENG-96778 scope expansion: the first environment fault halts the round =====");

// TWO UNITS, `list` first — so "the rest of the round is deferred" has a rest to defer.
const TWO_UNITS = {
  unitKeys: ["list", "main"], buildOrder: ["list", "main"],
  pageSchemas: { list: "UsrApplicant_ListPage", main: "UsrApplicant_FormPage" },
  verify: {
    complete: false, missing: 2, buildMissing: 2, unverified: 0, pending: 0, planGaps: [],
    pages: {
      list: { complete: false, buildComplete: false, missing: 1, buildMissing: 1, unverified: 0, builderOpen: 1,
        openRows: [{ deliverable: "Column `UsrStage`", status: "❌ MISSING", evidence: "missing: UsrStage", outcome: "missing", owner: "builder" }] },
      main: { complete: false, buildComplete: false, missing: 1, buildMissing: 1, unverified: 0, builderOpen: 1,
        openRows: [{ deliverable: "Field `UsrStage`", status: "❌ MISSING", evidence: "missing: UsrStage", outcome: "missing", owner: "builder" }] },
    },
  },
};
const LIST_BUILT = { ...PAGE_BUILT, unit: "list", schemaName: "UsrApplicant_ListPage" };
// The four blocker rows the legs are built from.
const ENV_DECLARED = { what: "the stand did not answer", why: "`clio ping` failed and every MCP call errored the same way", subject: "environment" };
const ENV_TEXT = { what: "Environment unreachable — dev-local (port 40010) actively refusing connections", why: "" };
const ENV_MISDECLARED = { ...ENV_TEXT, subject: "source" };
const APP_PARTIAL_ENV = { ...APP_OK, starterFormPage: "", blocked: [
  { what: "Stand dev-local (port 40010) went down mid-build", why: "create-app-section never answered and every later call got connection refused" }] };
// The healthy control every leg is measured against: same two units, `list` answers cleanly.
const HEALTHY_TWO = {
  Reconcile: () => reconcile(TWO_UNITS),
  Refs: () => REFS_OK,
  Build: (item) => (/build\.list/.test(item.id) ? LIST_BUILT : PAGE_BUILT),
  Verify: () => VERIFY_OK,
  Judge: () => ({ verdicts: [] }),
  Close: () => ({ written: true, statusWritten: true }),
};
const envRun = (listAnswer, extra = {}) => driveRun("env", { ...HEALTHY_TWO, ...extra,
  Build: (item) => (/build\.list/.test(item.id) ? listAnswer : PAGE_BUILT) }, 24);
const closePrompts = (run) => run.dispatched.filter((d) => d.phase === "Close").map((d) => d.prompt);
const verifyPrompts = (run) => run.dispatched.filter((d) => d.phase === "Verify").map((d) => d.prompt);
const countPhase = (run, phase) => phasesOf(run).filter((p) => p === phase).length;

/* G1 — a DECLARED environment blocker. */
const g1 = envRun({ ...LIST_BUILT, blocked: [ENV_DECLARED] });
check("G1: a builder that DECLARES `subject: \"environment\"` stops the run `environment-unreachable` (mutant: drop `r.environmentFault` from `roundHalted` → `main` is dispatched and the run finishes)",
  () => resultOf(g1)?.stopped === "environment-unreachable",
  () => JSON.stringify({ stopped: resultOf(g1)?.stopped, phases: phasesOf(g1) }));
check("G1: ONLY `list` was dispatched — `main` is DEFERRED and named, never sent at a stand that did not answer",
  () => buildIds(g1).length === 1 && /build\.list/.test(buildIds(g1)[0]) && (resultOf(g1)?.deferred || []).includes("main"),
  () => JSON.stringify({ builds: buildIds(g1), deferred: resultOf(g1)?.deferred }));
check("G1: NO Verify, NO Judge, and exactly ONE Reconcile — the stop is taken before the read-back, the ruling and the round-tail Reconcile the incident's host re-spawned for fourteen hours (mutant: move the stop after Verify → a Verify appears)",
  () => verifiesIn(g1).length === 0 && countPhase(g1, "Judge") === 0 && countPhase(g1, "Reconcile") === 1,
  () => phasesOf(g1).join(" -> "));
check("G1: the stop names the one-shot answer it waits for — `awaitingEnvironment` is `environment-restored-1` on the folder's first outage",
  () => resultOf(g1)?.awaitingEnvironment === "environment-restored-1",
  () => JSON.stringify(resultOf(g1)?.awaitingEnvironment));
check("G1: `phaseOutcomes` records Verify and Judge `skipped` and Build `partial` — the deferral is a limp, not a clean round (mutant: drop either `outcomes.skipped` → red)",
  () => resultOf(g1)?.phaseOutcomes?.Verify?.state === "skipped" && resultOf(g1)?.phaseOutcomes?.Judge?.state === "skipped"
    && resultOf(g1)?.phaseOutcomes?.Build?.state === "partial",
  () => JSON.stringify(resultOf(g1)?.phaseOutcomes));
check("G1: the stop WRITES the status document — a Close prompt carries `RUN STATUS BEGIN` and names `environment-restored-1` as the awaited entry, and the return says `statusWritten: true` (mutant: pass no `status` to `persistPending` → red)",
  () => closePrompts(g1).some((p) => /RUN STATUS BEGIN/.test(p) && /awaiting: `environment-restored-1`/.test(p)) && resultOf(g1)?.statusWritten === true,
  () => closePrompts(g1).map((p) => p.slice(p.indexOf("RUN STATUS BEGIN"), p.indexOf("RUN STATUS BEGIN") + 400)).join(" | "));
check("G1: the fault is PERSISTED as `roundState.environmentFault`, OPEN, numbered 1 and naming `list` — the record that arms the next run's gate exists only on file (mutant: leave `environmentFault` out of `carryNow().roundState` → red)",
  () => closePrompts(g1).some((p) => /ENVIRONMENT FAULT — set `roundState\.environmentFault` to this JSON EXACTLY/.test(p)
    && p.includes(JSON.stringify({ n: 1, open: true, unit: "list", round: 1, where: "build", what: ENV_DECLARED.what }))),
  () => closePrompts(g1).map((p) => p.slice(p.indexOf("ENVIRONMENT FAULT"), p.indexOf("ENVIRONMENT FAULT") + 300)).join(" | "));
check("G1: the return carries the record and the gate's arithmetic — `environmentFault` open at #1, `agentsExpected` the round's OPEN count (2) and `agentsReturned` the one builder that answered, and `next` carries the exact resolutions line and NO agent-death resume clause (nothing died)",
  () => { const r = resultOf(g1); return r?.environmentFault?.n === 1 && r.environmentFault.open === true && r.environmentFault.unit === "list"
    && r.agentsExpected === 2 && r.agentsReturned === 1
    && r.next.includes('{"kind":"run","item":"environment-restored-1","answer":"go"}') && !/resumeFromRunId/.test(r.next) && /clio ping -e/.test(r.next); },
  () => JSON.stringify({ fault: resultOf(g1)?.environmentFault, expected: resultOf(g1)?.agentsExpected, returned: resultOf(g1)?.agentsReturned, next: resultOf(g1)?.next }));

/* G2 — the INCIDENT TEXT, no declared subject: inferred, and the carried row is stamped. */
const g2 = envRun({ ...LIST_BUILT, blocked: [ENV_TEXT] });
check("G2: the incident's own text — \"Environment unreachable — … actively refusing connections\" — with NO declared subject takes the same stop (mutant: delete Tier B / Tier A → `main` dispatched)",
  () => resultOf(g2)?.stopped === "environment-unreachable" && (resultOf(g2)?.deferred || []).includes("main"),
  () => JSON.stringify({ stopped: resultOf(g2)?.stopped, deferred: resultOf(g2)?.deferred }));
check("G2: the carried row is STAMPED `subject: \"environment\"` in the queue-file carry, so what this run decided about the row is on file rather than re-derived from prose on the next resume (mutant: drop the stamping → red)",
  () => (resultOf(g2)?.blocked || []).some((b) => b.unit === "list" && b.what === ENV_TEXT.what && b.subject === "environment")
    && closePrompts(g2).some((p) => p.includes(JSON.stringify({ unit: "list", what: ENV_TEXT.what, why: "", subject: "environment" }))),
  () => JSON.stringify(resultOf(g2)?.blocked));

/* G3 — the INCIDENT's app unit: the package WAS created, then the stand died. */
const g3 = driveRun("env-app", {
  Reconcile: () => reconcileNewApp(),
  Refs: () => REFS_OK,
  Build: (item) => (/app/.test(item.id) ? APP_PARTIAL_ENV : PAGE_BUILT),
  Verify: () => VERIFY_OK,
  Close: () => ({ written: true, statusWritten: true }),
}, 24);
check("G3: the incident's app unit — planned package created, then \"Stand … went down … connection refused\" — stops `environment-unreachable`, NOT `app-unit-incomplete` and NOT a partial that keeps dispatching; `main` is deferred (mutant: return before `applyUnitResultByKind` or invert the precedence → red)",
  () => resultOf(g3)?.stopped === "environment-unreachable" && (resultOf(g3)?.deferred || []).includes("main") && buildIds(g3).length === 1,
  () => JSON.stringify({ stopped: resultOf(g3)?.stopped, deferred: resultOf(g3)?.deferred, builds: buildIds(g3) }));
check("G3: what the app unit DID write is still recorded — `packageCreatedByRun.appUnitComplete === false` — and persisted before the stop (a Close prompt is the app-unit write's own `recording the package the app unit created`), so the next run does not stop `new-app-over-existing-package` on this migration's own work",
  () => resultOf(g3)?.packageCreatedByRun?.appUnitComplete === false && resultOf(g3)?.packageCreatedByRun?.package === "UsrApplicantsFreedom"
    && g3.dispatched.some((d) => d.phase === "Close" && /recording the package the app unit created/.test(d.prompt)),
  () => JSON.stringify({ pkg: resultOf(g3)?.packageCreatedByRun, closes: closePrompts(g3).map((p) => p.slice(0, 120)) }));

/* G4 — THE CONTROLS: every shipped phrase that must NOT halt the round. One run, five rows — any of them misread stops it. */
const g4 = envRun({ ...LIST_BUILT, blocked: [
  { what: "Field `UsrStage` is missing from the built list page", why: "the builder did not add it", subject: "builder" },
  { what: "Live render check on surface automatic:3 could not be performed", why: "verification surface unreachable" },
  { what: "get-page timed out after 120s (error-class=creatio-timeout)", why: "switched to the shell clio and continued" },
  { what: "ECONNREFUSED 127.0.0.1:9222 — the headless Chrome check could not start", why: "", subject: "builder" },
  { what: "a section in no workplace is unreachable from the menu", why: "" },
] });
check("G4 (controls): a builder blocker, the run's own \"verification surface unreachable\", a transport `timed out after 120s`, a builder-declared `ECONNREFUSED 127.0.0.1:9222` and the workplace-binding row all leave the round RUNNING — `main` is dispatched and the stop is not the environment one (mutant: bare `unreachable`/`timed out`, or Tier A overriding `builder` → red)",
  () => resultOf(g4)?.stopped !== "environment-unreachable" && buildIds(g4).some((id) => /build\.main/.test(id)) && verifiesIn(g4).length >= 1,
  () => JSON.stringify({ stopped: resultOf(g4)?.stopped, builds: buildIds(g4) }));
check("G4 (control): the PARTIAL app unit from AC 12 — planned package, stub not removed, no outage in its text — still does NOT take the environment stop",
  () => resultOf(appPartial)?.stopped !== "environment-unreachable",
  () => JSON.stringify(resultOf(appPartial)?.stopped));

/* G5 — the fault is seen in PREFLIGHT. */
const g5 = driveRun("env-preflight", {
  Reconcile: () => reconcile({ preflightItems: [PREFLIGHT_ITEM] }),
  Preflight: () => ({ resolved: [], unresolved: [{ id: PREFLIGHT_ITEM.id, why: "clio ping: connection refused (ECONNREFUSED)", settlingQuery: "clio ping -e dev" }] }),
  Refs: () => REFS_OK,
  Build: () => PAGE_BUILT,
  Verify: () => VERIFY_OK,
  Judge: () => ({ verdicts: [] }),
  Close: () => ({ written: true, statusWritten: true }),
});
check("G5: a preflight agent that could not resolve its item because the stand refused connections stops `environment-unreachable` BEFORE Refs, Judge and Build — the last read-only point (mutant: remove the `unresolved[]` scan → Refs and Build run)",
  () => resultOf(g5)?.stopped === "environment-unreachable" && !phasesOf(g5).includes("Refs") && !phasesOf(g5).includes("Judge") && !phasesOf(g5).includes("Build"),
  () => JSON.stringify({ stopped: resultOf(g5)?.stopped, phases: phasesOf(g5) }));
check("G5: the preflight stop PERSISTS its record with the status — unlike `preflight-produced-nothing`, which persists nothing — because the gate on the next run exists only on file: a Close prompt carries `RUN STATUS BEGIN`, the open record with `where: \"preflight\"`, and the return names `environment-restored-1` (mutant: skip the persist → red)",
  () => closePrompts(g5).some((p) => /RUN STATUS BEGIN/.test(p) && p.includes(JSON.stringify({ n: 1, open: true, round: 0, where: "preflight", what: "clio ping: connection refused (ECONNREFUSED)" })))
    && resultOf(g5)?.awaitingEnvironment === "environment-restored-1" && resultOf(g5)?.environmentFault?.where === "preflight"
    && resultOf(g5)?.agentsExpected === 1 && resultOf(g5)?.agentsReturned === 1 && resultOf(g5)?.rounds === 0 && resultOf(g5)?.phaseOutcomes?.Build?.state === "skipped",
  () => JSON.stringify({ closes: closePrompts(g5).length, fault: resultOf(g5)?.environmentFault, outcomes: resultOf(g5)?.phaseOutcomes }));
const g5control = driveRun("env-preflight-control", {
  Reconcile: () => reconcile({ preflightItems: [PREFLIGHT_ITEM] }),
  Preflight: () => ({ resolved: [], unresolved: [{ id: PREFLIGHT_ITEM.id, why: "DuplicatesRule query errored with 403", settlingQuery: "select from DuplicatesRule" }] }),
  Refs: () => REFS_OK,
  Build: () => PAGE_BUILT,
  Verify: () => VERIFY_OK,
  Judge: () => ({ verdicts: [] }),
  Close: () => ({ written: true, statusWritten: true }),
});
check("G5 (control): an unresolved item whose reason is an ordinary query error (`errored with 403`) proceeds to Refs and Build exactly as before — an unresolved ⚠ Confirm row is not an outage",
  () => resultOf(g5control)?.stopped !== "environment-unreachable" && phasesOf(g5control).includes("Refs") && phasesOf(g5control).includes("Build"),
  () => JSON.stringify({ stopped: resultOf(g5control)?.stopped, phases: phasesOf(g5control) }));

/* G6 — THE GATE on the next run: record open, no answer. */
console.log("\n===== ENG-96778 scope expansion: the next run refuses until the operator's word =====");
const FAULT_ON_FILE = { n: 1, open: true, unit: "list", round: 1, where: "build", what: ENV_DECLARED.what };
const gateRun = (tag, roundStateExtra, runResolutions, extra = {}) => driveRun(tag, {
  Reconcile: () => reconcile({ ...TWO_UNITS, preflightItems: [PREFLIGHT_ITEM], runResolutions,
    roundState: { layoutPassDone: false, roundsSpent: 1, consumedRoundAnswers: [], ...roundStateExtra }, ...extra }),
  Preflight: () => PREFLIGHT_RESOLVED,
  Judge: () => ({ verdicts: [] }),
  Refs: () => REFS_OK,
  Build: (item) => (/build\.list/.test(item.id) ? LIST_BUILT : PAGE_BUILT),
  Verify: () => VERIFY_OK,
  Close: () => ({ written: true, statusWritten: true }),
}, 24);
const g6 = gateRun("gate-absent", { environmentFault: FAULT_ON_FILE }, []);
check("G6: a folder whose record says the stand was down and whose answer file says nothing stops `awaiting-environment-restored`, verdict `absent` (mutant: remove the gate → the run builds)",
  () => resultOf(g6)?.stopped === "awaiting-environment-restored" && resultOf(g6)?.environmentAnswerVerdict === "absent" && resultOf(g6)?.awaitingEnvironment === "environment-restored-1",
  () => JSON.stringify({ stopped: resultOf(g6)?.stopped, verdict: resultOf(g6)?.environmentAnswerVerdict }));
check("G6: the phase sequence is EXACTLY `Reconcile -> Close` — nothing was dispatched at the stand, not even Preflight though ⚠ Confirm items were published (mutant: take the gate after Preflight → `Preflight` appears; remove it → `Build` appears)",
  () => JSON.stringify(phasesOf(g6)) === JSON.stringify(["Reconcile", "Close"]),
  () => phasesOf(g6).join(" -> "));
check("G6: the gate holds in `auto` — the mode says nobody is watching, not that the stand is back — and the stop is written down: `RUN STATUS BEGIN`, the awaited `environment-restored-1`, `statusWritten: true`, Build `skipped`",
  () => resultOf(g6)?.mode === "auto" && resultOf(g6)?.statusWritten === true && resultOf(g6)?.phaseOutcomes?.Build?.state === "skipped"
    && closePrompts(g6).some((p) => /RUN STATUS BEGIN/.test(p) && /awaiting: `environment-restored-1`/.test(p) && /awaiting-environment-restored/.test(p)),
  () => JSON.stringify({ mode: resultOf(g6)?.mode, statusWritten: resultOf(g6)?.statusWritten, closes: closePrompts(g6).map((p) => p.slice(p.indexOf("RUN STATUS BEGIN"), p.indexOf("RUN STATUS BEGIN") + 300)) }));
check("G6: the record is returned UNCHANGED (still open, still #1) and NOT rewritten — the refusing run touches nothing on file, so a Close prompt here carries no ENVIRONMENT FAULT replace line",
  () => resultOf(g6)?.environmentFault?.open === true && resultOf(g6)?.environmentFault?.n === 1
    && !closePrompts(g6).some((p) => /ENVIRONMENT FAULT — set/.test(p)),
  () => JSON.stringify(resultOf(g6)?.environmentFault));

/* G7 — the operator said `go`. */
const g7 = gateRun("gate-go", { environmentFault: FAULT_ON_FILE }, [{ item: "environment-restored-1", answer: "go" }]);
check("G7: with `environment-restored-1` = `go` on file the run BUILDS — Preflight and Build are dispatched and the stop is not the environment one (mutant: never authorise → G6 repeats)",
  () => resultOf(g7)?.stopped !== "awaiting-environment-restored" && phasesOf(g7).includes("Preflight") && buildIds(g7).length >= 1,
  () => JSON.stringify({ stopped: resultOf(g7)?.stopped, phases: phasesOf(g7) }));
check("G7: the record is CLOSED by the next carry — the Verify prompt's REPLACE line writes `roundState.environmentFault` as `{\"n\":1,\"open\":false,…` with `clearedBy` naming the answer and says the record is CLOSED, so the answer is spent by record and a later outage is numbered #2 (mutant: not closing → G6 repeats; dropping the key from `carryNow` → no REPLACE line at all)",
  () => verifyPrompts(g7).some((p) => /ENVIRONMENT FAULT — set `roundState\.environmentFault` to this JSON EXACTLY[^\n]*REPLACING whatever the key holds: \{"n":1,"open":false,/.test(p)
    && p.includes('"clearedBy":"environment-restored-1"') && /so the record is CLOSED/.test(p)),
  () => verifyPrompts(g7).map((p) => p.slice(p.indexOf("ENVIRONMENT FAULT — set"), p.indexOf("ENVIRONMENT FAULT — set") + 400)).join(" | ") || phasesOf(g7).join(" -> "));

/* G8 — ONE-SHOT and NUMBERED. */
const g8a = gateRun("gate-stale", { environmentFault: { ...FAULT_ON_FILE, n: 2 } }, [{ item: "environment-restored-1", answer: "go" }]);
check("G8a: a `go` for #1 does NOT clear outage #2 — the gate asks for `environment-restored-2` and reads the file as `absent` (mutant: a constant item name → the stale answer opens the gate)",
  () => resultOf(g8a)?.stopped === "awaiting-environment-restored" && resultOf(g8a)?.awaitingEnvironment === "environment-restored-2" && resultOf(g8a)?.environmentAnswerVerdict === "absent",
  () => JSON.stringify({ stopped: resultOf(g8a)?.stopped, awaiting: resultOf(g8a)?.awaitingEnvironment }));
const g8b = driveRun("gate-second-outage", {
  Reconcile: () => reconcile({ ...TWO_UNITS, runResolutions: [{ item: "environment-restored-1", answer: "go" }],
    roundState: { layoutPassDone: false, roundsSpent: 1, consumedRoundAnswers: [], environmentFault: { ...FAULT_ON_FILE, open: false, clearedBy: "environment-restored-1" } } }),
  Refs: () => REFS_OK,
  Build: (item) => (/build\.list/.test(item.id) ? { ...LIST_BUILT, blocked: [ENV_DECLARED] } : PAGE_BUILT),
  Verify: () => VERIFY_OK,
  Close: () => ({ written: true, statusWritten: true }),
}, 24);
check("G8b: a folder whose first outage is CLOSED builds again, and a SECOND outage records `n: 2` and asks for `environment-restored-2` — the old `go` on file authorises nothing (mutant: `n` not incremented → asks for #1 again, which the file already answers)",
  () => resultOf(g8b)?.stopped === "environment-unreachable" && resultOf(g8b)?.awaitingEnvironment === "environment-restored-2" && resultOf(g8b)?.environmentFault?.n === 2 && resultOf(g8b)?.environmentFault?.open === true,
  () => JSON.stringify({ stopped: resultOf(g8b)?.stopped, fault: resultOf(g8b)?.environmentFault }));

/* G9 — a DECLINE and an UNREADABLE answer both refuse, and say what they read. */
const g9stop = gateRun("gate-refused", { environmentFault: FAULT_ON_FILE }, [{ item: "environment-restored-1", answer: "stop" }]);
const g9vague = gateRun("gate-vague", { environmentFault: FAULT_ON_FILE }, [{ item: "environment-restored-1", answer: "maybe later" }]);
check("G9: `stop` is read as `refused` and `maybe later` as `unrecognised` — both refuse, both quote the answer back in the reason, and neither dispatches a build (mutant: a presence test → both open the gate)",
  () => resultOf(g9stop)?.stopped === "awaiting-environment-restored" && resultOf(g9stop)?.environmentAnswerVerdict === "refused" && resultOf(g9stop)?.environmentAnswer === "stop"
    && /"stop"/.test(resultOf(g9stop)?.reason || "") && buildIds(g9stop).length === 0
    && resultOf(g9vague)?.stopped === "awaiting-environment-restored" && resultOf(g9vague)?.environmentAnswerVerdict === "unrecognised" && resultOf(g9vague)?.environmentAnswer === "maybe later"
    && /"maybe later"/.test(resultOf(g9vague)?.reason || "") && buildIds(g9vague).length === 0,
  () => JSON.stringify({ stop: [resultOf(g9stop)?.environmentAnswerVerdict, resultOf(g9stop)?.reason], vague: [resultOf(g9vague)?.environmentAnswerVerdict, resultOf(g9vague)?.reason] }));

/* G11 — NO ROUND CHARGED. */
console.log("\n===== ENG-96778 scope expansion: an outage costs no round and no grant =====");
check("G11: the halting run's Close prompt carries NO `ROUND COUNTERS` block naming `list` — an outage is not a failed attempt, so `roundOf` is untouched and the unit keeps its whole budget (mutant: keep calling `chargeBuildAttempt` → red)",
  () => !closePrompts(g1).some((p) => /ROUND COUNTERS[\s\S]*?- `list`/.test(p)),
  () => closePrompts(g1).map((p) => p.slice(p.indexOf("ROUND COUNTERS"), p.indexOf("ROUND COUNTERS") + 200)).join(" | "));
const healthyTwo = driveRun("env-healthy-control", HEALTHY_TWO, 24);
check("G11 (control): the healthy run's Verify prompt DOES carry a `ROUND COUNTERS` block naming `list` and `main` — which is what makes the absence above a measurement of the skip rather than of a missing block",
  () => verifyPrompts(healthyTwo).some((p) => /ROUND COUNTERS[\s\S]*?- `list`/.test(p) && /ROUND COUNTERS[\s\S]*?- `main`/.test(p)),
  () => verifyPrompts(healthyTwo).map((p) => p.slice(p.indexOf("ROUND COUNTERS"), p.indexOf("ROUND COUNTERS") + 200)).join(" | ") || phasesOf(healthyTwo).join(" -> "));

/* G12 — NO GRANT SPENT. An answered resolution routed to `list` (its item already filed, so Preflight has nothing
   to do), an operator finding on `list`, and an `unsettled: true` in the outage answer: none of the three one-shot
   memories may be consumed by a builder whose stand vanished. */
const LIST_RESOLVED_ITEM = { id: "list#confirm:filter:Applicant", pageKey: "list", kind: "confirm", item: "filter",
  resolution: { answer: "keep the Classic default filter", decidedBy: "kamil", date: "2026-09-09" } };
const LIST_ANSWER_NOT_BUILT = [{ id: LIST_RESOLVED_ITEM.id, applied: false, why: "the stand stopped answering before the filter could be set" }];
const g12 = driveRun("env-grants", {
  Reconcile: () => reconcile({ ...TWO_UNITS, preflightItems: [LIST_RESOLVED_ITEM], evidenceFiled: [LIST_RESOLVED_ITEM.id], evidenceIds: [LIST_RESOLVED_ITEM.id] }),
  Refs: () => REFS_OK,
  Build: (item) => (/build\.list/.test(item.id) ? { ...LIST_BUILT, unsettled: true, resolutionsApplied: LIST_ANSWER_NOT_BUILT, blocked: [ENV_DECLARED] } : PAGE_BUILT),
  Verify: () => VERIFY_OK,
  Judge: () => ({ verdicts: [] }),
  Close: () => ({ written: true, statusWritten: true }),
}, 24);
// The same shape, healthy: the answer channel's accounting DOES fire when the builder answers normally without
// `resolutionsApplied`, which is what makes the empty carry above a measurement of the skip.
const g12control = driveRun("env-grants-control", {
  Reconcile: () => reconcile({ ...TWO_UNITS, preflightItems: [LIST_RESOLVED_ITEM], evidenceFiled: [LIST_RESOLVED_ITEM.id], evidenceIds: [LIST_RESOLVED_ITEM.id] }),
  Refs: () => REFS_OK,
  Build: (item) => (/build\.list/.test(item.id) ? { ...LIST_BUILT, unsettled: true, resolutionsApplied: LIST_ANSWER_NOT_BUILT } : PAGE_BUILT),
  // A verifier handed a unit's answer claims must echo a check per claim (`verifierSchemaWithChecks` requires
  // `resolutionChecks`); `unknown` is the honest verdict for a golden that reads no stand.
  Verify: () => ({ ...VERIFY_OK, resolutionChecks: [{ unit: "list", id: LIST_RESOLVED_ITEM.id, shows: "unknown", found: "not read in this golden" }] }),
  Judge: () => ({ verdicts: [] }),
  Close: () => ({ written: true, statusWritten: true }),
}, 24);
check("G12 (precondition): the answered resolution IS routed to `list` — its build prompt carries the operator's answer — so the leg below measures a skipped spend and not an answer that never arrived",
  () => g12.dispatched.some((d) => /build\.list/.test(d.id) && /keep the Classic default filter/.test(d.prompt)),
  () => g12.dispatched.filter((d) => d.phase === "Build").map((d) => d.id).join(", "));
check("G12: the halting run spends NO grant — the carry's repair grants read `reopened []`, its unconsumed answers `[]`, no unsettled-units memory names `list`, and no unconsumed row for `list` is returned (mutant: keep calling `consumeRepairGrants` / record `unsettled` on the outage answer → red)",
  () => resultOf(g12)?.stopped === "environment-unreachable"
    && closePrompts(g12).some((p) => /reopened \[\], pending \[\]/.test(p) && /UNCONSUMED OPERATOR ANSWERS[^\n]*: \[\]/.test(p))
    && !closePrompts(g12).some((p) => /"unsettledUnits":\["list"\]/.test(p))
    && (resultOf(g12)?.unconsumedResolutions || []).length === 0
    && !/operator finding for `list` has had its repair round|unaccounted answers on `list` have had their repair round|settle window: `list`/.test(g12.log),
  () => JSON.stringify({ stopped: resultOf(g12)?.stopped, phases: phasesOf(g12), pending: g12.pending?.items?.[0]?.id, submitErr: (g12.submitErr || "").slice(-300), unconsumed: resultOf(g12)?.unconsumedResolutions, grants: closePrompts(g12).map((p) => p.slice(p.indexOf("ANSWER-CHANNEL REPAIR GRANTS"), p.indexOf("ANSWER-CHANNEL REPAIR GRANTS") + 200)) }));
check("G12 (control): the SAME answer, reported `applied: false` by a builder whose stand was fine, DOES spend the grant — the carry's reopened list names `list` and an unconsumed row is filed — and its `unsettled: true` IS remembered (the settle-window log line the halting leg asserts absent)",
  () => resultOf(g12control)?.stopped !== "environment-unreachable"
    && verifyPrompts(g12control).some((p) => /reopened \[\{"unit":"list"/.test(p))
    && (resultOf(g12control)?.unconsumedResolutions || []).some((u) => u.unit === "list")
    && /settle window: `list` reported a read that never settled/.test(g12control.log),
  () => JSON.stringify({ stopped: resultOf(g12control)?.stopped, phases: phasesOf(g12control), pending: g12control.pending?.items?.[0]?.id, submitErr: (g12control.submitErr || "").slice(-300), unconsumed: resultOf(g12control)?.unconsumedResolutions,
    grants: verifyPrompts(g12control).map((p) => p.slice(p.indexOf("ANSWER-CHANNEL REPAIR GRANTS"), p.indexOf("ANSWER-CHANNEL REPAIR GRANTS") + 200)) }));

/* G13 — STALE ROWS on file are the folder's history, not a fault. */
const g13 = driveRun("env-stale-row", {
  Reconcile: () => reconcile({ ...TWO_UNITS, blocked: [{ unit: "list", ...ENV_TEXT, subject: "environment" }] }),
  Refs: () => REFS_OK,
  Build: (item) => (/build\.list/.test(item.id) ? LIST_BUILT : PAGE_BUILT),
  Verify: () => VERIFY_OK,
  Judge: () => ({ verdicts: [] }),
  Close: () => ({ written: true, statusWritten: true }),
}, 24);
check("G13: an environment row CARRIED in the queue file with no fault record neither stops nor parks at baseline — the run proceeds to Build, `list` IS dispatched (so nothing parked it before its build) and no park reads as a SOURCE one; the folder's memory of an outage is `roundState.environmentFault`, never a row (mutant: scan `blockedItems` for the fault → the run stops before any Build)",
  () => resultOf(g13)?.stopped !== "environment-unreachable" && resultOf(g13)?.stopped !== "awaiting-environment-restored"
    && buildIds(g13).some((id) => /build\.list/.test(id)) && verifiesIn(g13).length >= 1
    && !(resultOf(g13)?.parked || []).some((p) => /blocker is in the SOURCE/.test(p.parkedWhy)),
  () => JSON.stringify({ stopped: resultOf(g13)?.stopped, builds: buildIds(g13), parked: (resultOf(g13)?.parked || []).map((p) => `${p.key}: ${p.parkedWhy.slice(0, 60)}`) }));

console.log(`\n=================\nSTAGE-GATES GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

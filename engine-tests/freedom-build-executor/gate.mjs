// Offline goldens for the deterministic "spend nothing you don't have to" decisions in
// skills/_workflow-core/build-executor/gate.mjs (ENG-94859). Unlike round-guard.mjs (which mirrors a
// predicate inlined into the Workflow script), gate.mjs is a real host-neutral module, so this suite
// IMPORTS it directly — the same way run-workflow-core.mjs imports helpers.mjs.
//
// The scenario every leg is measured against is the real one: the Applicant `list` unit carried the SAME
// blocker across six runs and 42 agents — "Live render check on surface automatic:3 could not be performed
// … `#Section/Applicant` errors at runtime with Script error" — because a blocked item is not a park and
// nothing classified a source-side runtime error as un-buildable.
import {
  classifyBlocker, blockerKey, sourceBlockerParks, sourceParkWhy,
  downgradeSurface, standFingerprint, canReuseReconcile,
  progressed, openDeliverableCount, stableStringify,
} from "../../skills/_workflow-core/build-executor/gate.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  let c = cond, threw = null;
  if (typeof cond === "function") { try { c = cond(); } catch (e) { c = false; threw = e; } }
  if (c) { pass++; console.log("  ✅ " + name); return; }
  fail++; console.log("  ❌ " + name + (threw ? "  (threw: " + threw.message + ")" : ""));
  if (detail !== undefined) { let d; try { d = typeof detail === "function" ? detail() : detail; } catch (e) { d = "<detail threw: " + e.message + ">"; } console.log("      ↳ " + (typeof d === "string" ? d : JSON.stringify(d))); }
};

// The exact Applicant blocker, as it appeared in every one of the six run results.
const APPLICANT_LIST_BLOCKER = {
  unit: "list",
  what: "Live render check on surface automatic:3 (real Chrome) could not be performed for this page",
  why: "`#Section/Applicant` errors at runtime with `Script error for \"Applicant...\"`",
};

/* ---------------------------------------------------------------------------
   1. SOURCE-CAUSED vs BUILDER-CAUSED BLOCKER
   --------------------------------------------------------------------------- */
console.log("\n===== classifyBlocker: source vs builder =====");

check("the Applicant `list` blocker is classified SOURCE — a runtime error in `#Section/Applicant` cannot be built out of",
  () => classifyBlocker(APPLICANT_LIST_BLOCKER).class === "source",
  () => JSON.stringify(classifyBlocker(APPLICANT_LIST_BLOCKER)));

check("a 'could not be performed' render blocker is SOURCE even without the baseline signal",
  () => classifyBlocker({ unit: "list", what: "render check could not be performed", why: "" }).class === "source");

check("a builder-shaped blocker (a field the builder was to place is missing) is UNKNOWN → retryable, the safe default",
  () => classifyBlocker({ unit: "main", what: "Field `UsrStage` is missing from the built page", why: "the builder did not add it" }).class === "unknown");

check("classification is TEXT-only: baseline presence is NOT a source signal — a queue-carried builder blocker stays retryable across runs",
  () => classifyBlocker({ unit: "list", what: "Field `UsrStage` missing", why: "" }).class === "unknown");

check("an empty blocker (no what/why) is UNKNOWN, never guessed into a park",
  () => classifyBlocker({ unit: "x" }).class === "unknown");

check("blockerKey reads either `unit` or `key`",
  () => blockerKey({ unit: "a" }) === "a" && blockerKey({ key: "b" }) === "b" && blockerKey({}) === null);

/* ---------------------------------------------------------------------------
   2. PARK ONCE — a source blocker becomes a terminal park, not a re-attempt
   --------------------------------------------------------------------------- */
console.log("\n===== sourceBlockerParks: park once, never loop =====");

const parks = sourceBlockerParks([APPLICANT_LIST_BLOCKER]);
check("the Applicant `list` blocker yields exactly ONE park record",
  () => parks.length === 1 && parks[0].key === "list");
check("the park is charged ZERO rounds — a build round could not have helped",
  () => parks[0].rounds === 0);
check("the park reason names the source failure and says rebuilding cannot fix it",
  () => /SOURCE/.test(parks[0].parkedWhy) && /no build round can close it/.test(parks[0].parkedWhy) && /Script error/.test(parks[0].parkedWhy),
  () => parks[0].parkedWhy);

check("a builder/unknown blocker does NOT park (it stays retryable)",
  () => sourceBlockerParks([{ unit: "main", what: "Field missing", why: "" }]).length === 0);

check("a mixed list parks only the source ones",
  () => {
    const out = sourceBlockerParks([APPLICANT_LIST_BLOCKER, { unit: "main", what: "Field missing", why: "" }]);
    return out.length === 1 && out[0].key === "list";
  });

check("sourceParkWhy is never blank even when the blocker carries no text",
  () => sourceParkWhy({}, "reason x").trim().length > 0);

/* ---------------------------------------------------------------------------
   3. VERIFICATION-SURFACE DOWNGRADE
   --------------------------------------------------------------------------- */
console.log("\n===== downgradeSurface: close on what IS checkable =====");

check("automatic:3 with an unreachable render downgrades to automatic:2 and says so",
  () => { const d = downgradeSurface("automatic:3", { renderReachable: false }); return d.surface === "automatic:2" && d.downgraded === true && /downgraded to automatic:2/.test(d.note); },
  () => JSON.stringify(downgradeSurface("automatic:3", { renderReachable: false })));

check("automatic:2 with an unreachable render downgrades to manual (structure only)",
  () => { const d = downgradeSurface("automatic:2", { renderReachable: false }); return d.surface === "manual" && d.downgraded === true; });

check("manual cannot downgrade further — structure is the floor, not a failure",
  () => { const d = downgradeSurface("manual", { renderReachable: false }); return d.surface === "manual" && d.downgraded === false; });

check("a REACHABLE render keeps the requested surface unchanged",
  () => { const d = downgradeSurface("automatic:3", { renderReachable: true }); return d.surface === "automatic:3" && d.downgraded === false && d.note === null; });

check("render 'not attempted' (undefined) never downgrades",
  () => { const d = downgradeSurface("automatic:3", {}); return d.surface === "automatic:3" && d.downgraded === false; });

/* ---------------------------------------------------------------------------
   4. REUSE THE LAST VERDICT INSTEAD OF RE-RECONCILING
   --------------------------------------------------------------------------- */
console.log("\n===== canReuseReconcile: skip the baseline agent when nothing moved =====");

const fpA = standFingerprint({ planVersion: "v7", standWrites: { pages: 2, packageCreated: "UsrX" } });
const fpAReordered = standFingerprint({ standWrites: { packageCreated: "UsrX", pages: 2 }, planVersion: "v7" });
const fpB = standFingerprint({ planVersion: "v7", standWrites: { pages: 3, packageCreated: "UsrX" } });

check("an identical stand fingerprint is stable under key reordering",
  () => fpA === fpAReordered, () => `${fpA}\n${fpAReordered}`);

check("a build write (standWrites changed) produces a DIFFERENT fingerprint",
  () => fpA !== fpB);

check("reuse is allowed when a persisted verdict exists and the fingerprints match",
  () => canReuseReconcile({ persistedVerdict: { complete: false }, prevFingerprint: fpA, curFingerprint: fpAReordered }) === true);

check("reuse is REFUSED when the fingerprint changed (the stand moved)",
  () => canReuseReconcile({ persistedVerdict: { complete: false }, prevFingerprint: fpA, curFingerprint: fpB }) === false);

check("reuse is REFUSED when there is no persisted verdict to reuse",
  () => canReuseReconcile({ persistedVerdict: null, prevFingerprint: fpA, curFingerprint: fpA }) === false);

check("reuse is REFUSED when a fingerprint is missing on either side",
  () => canReuseReconcile({ persistedVerdict: {}, prevFingerprint: null, curFingerprint: fpA }) === false);

/* ---------------------------------------------------------------------------
   5. STALL GUARD + open-count arithmetic
   --------------------------------------------------------------------------- */
console.log("\n===== progressed / openDeliverableCount =====");

check("progress is TRUE when the open count strictly dropped",
  () => progressed(5, 3) === true);
check("progress is FALSE when the open count did not move (a stalled round)",
  () => progressed(3, 3) === false);
check("an unknown count never accuses a stall",
  () => progressed(undefined, 3) === true);

check("openDeliverableCount sums missing + unverified across pages",
  () => openDeliverableCount({ pages: { main: { missing: 6, unverified: 1 }, list: { missing: 0, unverified: 2 } } }) === 9);
check("a complete verdict counts zero open deliverables",
  () => openDeliverableCount({ pages: { main: { missing: 0, unverified: 0 } } }) === 0);

check("stableStringify is order-independent and recurses",
  () => stableStringify({ b: 1, a: [3, { y: 2, x: 1 }] }) === stableStringify({ a: [3, { x: 1, y: 2 }], b: 1 }));

/* --------------------------------------------------------------------------- */
console.log(`\n=================\nGATE GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

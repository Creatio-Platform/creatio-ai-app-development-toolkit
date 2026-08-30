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

/* --------------------------------------------------------------------------- */
console.log(`\n=================\nGATE GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

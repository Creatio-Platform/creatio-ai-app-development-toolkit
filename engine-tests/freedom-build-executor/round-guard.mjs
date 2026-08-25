// ENG-95470 (defect 1) — offline unit test for the round-churn regression guard in
// freedom-build-executor.workflow.js. That file is a Workflow-tool script: it cannot `import` (no filesystem /
// Node.js API access at run time), so its pure `isSettledAndUnitUntouched` predicate cannot be imported here
// either. This test therefore keeps a byte-identical MIRROR of the predicate's body below, and asserts the
// mirror's exact text is still present verbatim in the shipped file — so an edit to the real guard that is not
// mirrored here fails loudly, instead of the test silently exercising logic the shipped script no longer runs.
// (Deliberately not `eval`/`new Function` over file content — see security guidance on code-injection risk.)
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(DIR, "..", "..", "skills", "freedom-build-executor", "freedom-build-executor.workflow.js");
const source = readFileSync(SOURCE_PATH, "utf8");

// MUST match the body of `isSettledAndUnitUntouched` in freedom-build-executor.workflow.js exactly.
function isSettledAndUnitUntouched(id, earnedBeforeRound, builtThisRound) {
  const owner = String(id).split('#')[0]
  return earnedBeforeRound.has(id) && !builtThisRound.includes(owner)
}
const MIRRORED_BODY = "const owner = String(id).split('#')[0]\n  return earnedBeforeRound.has(id) && !builtThisRound.includes(owner)";

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  let c = cond, threw = null;
  if (typeof cond === "function") { try { c = cond(); } catch (e) { c = false; threw = e; } }
  if (c) { pass++; console.log("  ✅ " + name); return; }
  fail++; console.log("  ❌ " + name + (threw ? "  (threw: " + threw.message + ")" : ""));
  if (detail !== undefined) { let d; try { d = typeof detail === "function" ? detail() : detail; } catch (e) { d = "<detail threw: " + e.message + ">"; } console.log("      ↳ " + (typeof d === "string" ? d : JSON.stringify(d))); }
};

console.log("\n===== round-churn regression guard (ENG-95470 / defect 1) =====");

check(
  "the mirrored predicate body is still present verbatim in freedom-build-executor.workflow.js (drift guard)",
  source.includes(MIRRORED_BODY),
  () => "expected to find:\n" + MIRRORED_BODY,
);

// (a) already-earned id whose owner did NOT build this round → skip (do not re-queue).
check(
  "an already-earned id whose owner did not build this round is skipped",
  () => isSettledAndUnitUntouched("main#quality-gates", new Set(["main#quality-gates"]), ["child:Education"]) === true,
);

// (b) already-earned id whose owner DID build this round → re-queue.
check(
  "an already-earned id whose owner DID build this round is re-queued",
  () => isSettledAndUnitUntouched("main#quality-gates", new Set(["main#quality-gates"]), ["main"]) === false,
);

// (c) not-yet-earned id → always re-queued, regardless of `builtThisRound`.
check(
  "a not-yet-earned id is always queued regardless of builtThisRound",
  () => isSettledAndUnitUntouched("main#quality-gates", new Set(), []) === false,
);
check(
  "a not-yet-earned id is queued even when its owner also did not build this round",
  () => isSettledAndUnitUntouched("main#quality-gates", new Set(), ["child:Education"]) === false,
);

// Edge cases from the review: ids without a `#`, ids with multiple `#`, and an owner only partially present.
check(
  "an id with no `#` uses the whole id as its owner",
  () => isSettledAndUnitUntouched("sectionRegistered", new Set(["sectionRegistered"]), ["main"]) === true,
);
check(
  "an id with multiple `#` characters uses only the text before the FIRST `#` as its owner",
  () => isSettledAndUnitUntouched("main#quality-gates#extra", new Set(["main#quality-gates#extra"]), ["main"]) === false,
);
check(
  "an owner that is only a substring of a `builtThisRound` entry does not count as built (exact match required)",
  () => isSettledAndUnitUntouched("main#quality-gates", new Set(["main#quality-gates"]), ["child:main"]) === true,
);

console.log(`\n=================\nROUND-GUARD GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

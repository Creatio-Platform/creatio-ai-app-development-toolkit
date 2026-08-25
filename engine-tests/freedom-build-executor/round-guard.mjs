// Offline unit tests for two pure predicates of the freedom-build-executor round: the round-churn guard
// `isSettledAndUnitUntouched` (ENG-95470 defect 1) and the verifier page-fetch scope `verifyFetchKeys`
// (ENG-95940). freedom-build-executor.workflow.js is a Workflow-tool script: it cannot `import` (no filesystem
// / Node.js API access at run time), so neither predicate can be imported here. This test therefore keeps a
// byte-identical MIRROR of each body below, and asserts the mirror's exact text is still present verbatim in the
// shipped file — so an edit to a real predicate that is not mirrored here fails loudly, instead of the test
// silently exercising logic the shipped script no longer runs.
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

// MUST match the body of `verifyFetchKeys` in freedom-build-executor.workflow.js exactly.
function verifyFetchKeys(builtThisRound, unitKeys, schemas, pagesRecorded) {
  const recorded = new Set(pagesRecorded || [])
  return (unitKeys || []).filter((k) => schemas[k] && (builtThisRound.includes(k) || !recorded.has(k)))
}
const MIRRORED_FETCH_BODY = "const recorded = new Set(pagesRecorded || [])\n  return (unitKeys || []).filter((k) => schemas[k] && (builtThisRound.includes(k) || !recorded.has(k)))";

// MUST match the bodies of `fetchTableGroups`, `fetchListEmptyLabel`, `touchedKeys` and
// `isRefiledForUntouchedUnit` in freedom-build-executor.workflow.js exactly.
function fetchTableGroups(fetchKeys, unitKeys, schemas) {
  const fetch = new Set(fetchKeys)
  return {
    known: (unitKeys || []).filter((k) => schemas[k] && fetch.has(k)),
    keep: (unitKeys || []).filter((k) => schemas[k] && !fetch.has(k)),
    unknown: (unitKeys || []).filter((k) => !schemas[k]),
  }
}
function fetchListEmptyLabel(keepCount) {
  return keepCount ? '- (nothing to fetch this round — every key below is already on file)' : '- (none recorded yet)'
}
function touchedKeys(builtThisRound, claims) {
  return [...new Set([...builtThisRound, ...(claims || []).filter((c) => c.noAnswer).map((c) => c.unit)])]
}
function isRefiledForUntouchedUnit(id, filedBeforeRound, touchedThisRound) {
  const owner = String(id).split('#')[0]
  return filedBeforeRound.has(id) && !touchedThisRound.includes(owner)
}
const MIRRORED_BODIES = {
  fetchTableGroups: "const fetch = new Set(fetchKeys)\n  return {\n    known: (unitKeys || []).filter((k) => schemas[k] && fetch.has(k)),\n    keep: (unitKeys || []).filter((k) => schemas[k] && !fetch.has(k)),\n    unknown: (unitKeys || []).filter((k) => !schemas[k]),",
  fetchListEmptyLabel: "return keepCount ? '- (nothing to fetch this round — every key below is already on file)' : '- (none recorded yet)'",
  touchedKeys: "return [...new Set([...builtThisRound, ...(claims || []).filter((c) => c.noAnswer).map((c) => c.unit)])]",
  isRefiledForUntouchedUnit: "const owner = String(id).split('#')[0]\n  return filedBeforeRound.has(id) && !touchedThisRound.includes(owner)",
};

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

// ===== ENG-95940 — the verifier per-round page-fetch scope =====
// The predicate above keeps a settled id out of the judge queue; this one keeps the page itself from being
// re-read. Same file, same round, so it shares this runner and its drift guard.
console.log("\n===== verifier fetch scope (ENG-95940) =====");

check(
  "the mirrored fetch-scope body is still present verbatim in freedom-build-executor.workflow.js (drift guard)",
  source.includes(MIRRORED_FETCH_BODY),
  () => "expected to find:\n" + MIRRORED_FETCH_BODY,
);

const KEYS = ["main", "list", "sectionRegistered"];
const SCHEMAS = { main: "UsrApplicant_FormPage", list: "UsrApplicant_ListPage", sectionRegistered: "UsrApplicantSection" };
const ALL_RECORDED = ["main", "list", "sectionRegistered"];
const fetched = (built, recorded) => verifyFetchKeys(built, KEYS, SCHEMAS, recorded).join(",");

// (a) The point of the change: a page already on file that this round did not touch is not fetched.
check(
  "a recorded key the round did not build is not fetched",
  () => fetched(["main"], ALL_RECORDED) === "main",
);

// (b) A recorded key the round DID build is fetched — it just changed.
check(
  "a recorded key the round DID build is fetched",
  () => fetched(["main", "list"], ALL_RECORDED) === "main,list",
);

// (c) Never-fetched keys are always fetched: absent means "nobody looked", so skipping one leaves it absent forever.
check(
  "a never-recorded key is fetched even when the round did not build it",
  () => fetched([], ["main"]) === "list,sectionRegistered",
);

// (d) Degrade to the old whole-section sweep rather than to a silent skip.
check(
  "`pagesRecorded` undefined fetches every key with a schema",
  () => fetched([], undefined) === "main,list,sectionRegistered",
);
check(
  "`pagesRecorded` empty fetches every key with a schema",
  () => fetched([], []) === "main,list,sectionRegistered",
);

// (e) No recorded Freedom schema means there is nothing to fetch — the workflow reports `unknownSchema` instead.
check(
  "a key with no recorded schema is never fetched, even when the round built it",
  () => verifyFetchKeys(["orphan"], [...KEYS, "orphan"], SCHEMAS, []).join(",") === "main,list,sectionRegistered",
);

// (f) Exact match on `builtThisRound`, the same guarantee the judge-queue predicate above is pinned for.
check(
  "a key that is only a substring of a `builtThisRound` entry does not count as built",
  () => fetched(["child:main"], ALL_RECORDED) === "",
);

// (g) An empty Reconcile report yields no keys rather than throwing.
check(
  "`unitKeys` undefined yields no keys",
  () => verifyFetchKeys([], undefined, SCHEMAS, []).length === 0,
);

// The predicate decides the set; these clauses are what make the verifier act on it. Any one of them reverting
// puts the whole-section re-read back while every case above still passes.
check(
  "the verifier `pages` instruction is scoped to the FETCH THIS ROUND list",
  source.includes("for every key the table above lists under FETCH THIS ROUND"),
);
check(
  "the schema table names the keys it is NOT fetching, and forbids re-filing their evidence",
  source.includes("ALREADY ON FILE, NOT TOUCHED THIS ROUND") && source.includes("do NOT re-file their evidence"),
);
check(
  "the verifier `evidence` instruction files only the ids this round owns",
  source.includes("**FILE ONLY THE IDS THIS ROUND OWNS:**"),
);
check(
  "Reconcile is asked for `pagesRecorded`, without which the scope degrades to the old sweep",
  source.includes("Also return \\`pagesRecorded\\`") && source.includes("pagesRecorded: { type: 'array', items: { type: 'string' } }"),
);

for (const [name, body] of Object.entries(MIRRORED_BODIES)) {
  check(
    "the mirrored `" + name + "` body is still present verbatim in freedom-build-executor.workflow.js (drift guard)",
    source.includes(body),
    () => "expected to find:\n" + body,
  );
}

// The render defect the fetch scope creates: a round whose builders all returned nothing leaves nothing to fetch
// while every key is on file, and the FETCH list must not then claim nothing is recorded — the ALREADY ON FILE
// list is printed directly under it.
check(
  "with nothing to fetch and every key on file, the FETCH list does not claim nothing is recorded",
  () => {
    const g = fetchTableGroups([], KEYS, SCHEMAS);
    return g.known.length === 0 && g.keep.length === 3 && fetchListEmptyLabel(g.keep.length).includes("already on file");
  },
);
check(
  "with nothing recorded anywhere the FETCH list still says none recorded yet",
  () => fetchTableGroups([], KEYS, {}).keep.length === 0 && fetchListEmptyLabel(0) === "- (none recorded yet)",
);
check(
  "the three rendered groups partition the published keys, with no key in two of them",
  () => {
    const g = fetchTableGroups(["main"], [...KEYS, "orphan"], SCHEMAS);
    const all = [...g.known, ...g.keep, ...g.unknown];
    return g.known.join() === "main" && g.keep.join() === "list,sectionRegistered" && g.unknown.join() === "orphan"
      && all.length === new Set(all).size && all.length === 4;
  },
);

// A builder that answered nothing may still have written to the stand before it died, so its page is read back
// even though it never reached `builtThisRound`.
check(
  "a unit whose builder answered nothing counts as touched",
  () => touchedKeys(["main"], [{ unit: "main" }, { unit: "list", noAnswer: true }]).join() === "main,list",
);
check(
  "a unit that reported normally is not duplicated, and no claims yields just the built list",
  () => touchedKeys(["main"], [{ unit: "main" }]).join() === "main" && touchedKeys(["main"], undefined).join() === "main",
);

// The rejected-record loop: `isSettledAndUnitUntouched` cannot catch it, because rejected is not earned.
check(
  "a rejected record whose unit was not touched is not re-queued",
  () => isRefiledForUntouchedUnit("list#quality-gates", new Set(["list#quality-gates"]), ["main"]) === true,
);
check(
  "the same record IS re-queued once its unit is touched again",
  () => isRefiledForUntouchedUnit("list#quality-gates", new Set(["list#quality-gates"]), ["main", "list"]) === false,
);
check(
  "a first-ever record is never suppressed",
  () => isRefiledForUntouchedUnit("list#quality-gates", new Set(), ["main"]) === false,
);
check(
  "an id with no `#` uses the whole id as its owner here too",
  () => isRefiledForUntouchedUnit("sectionRegistered", new Set(["sectionRegistered"]), ["main"]) === true,
);

console.log(`\n=================\nROUND-GUARD GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

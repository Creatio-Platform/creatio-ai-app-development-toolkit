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

check("a 'could not be performed' render blocker that NAMES the source surface is SOURCE even without the baseline signal",
  () => classifyBlocker({ unit: "list", what: "render check could not be performed — `#Section/Applicant` does not open", why: "" }).class === "source");

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
   3. SUBJECT, NOT ONLY MODE (PR #157 review, Major on `gate.mjs:46`, extended by the follow-up review)
   ---------------------------------------------------------------------------
   `classifyBlocker` runs over a GENERAL-PURPOSE channel: build-agent blockers, the partial-app-unit blocker, the
   guidelines close row, resolutions blockers and judge page defects all land in `blockedItems`. A misclassified
   builder defect parks TERMINALLY (`rounds: 0`), is re-parked on every resumed run, and tells the operator the
   blocker is in the source — a false diagnosis on exactly the class a build round would have fixed.

   So a failure MODE is never a source verdict on its own. FIVE patterns are modes — `does not compile`,
   `fails to compile|load|render`, `errors at runtime`, `could not be performed` and `render check … could not…` —
   and each describes the page THIS RUN BUILT at least as naturally as the Classic source; the render-check pair is
   the sharpest, because the per-page recipe and `reachKindBlock` TELL the build agent to report an unreachable
   verification surface in `blocked`. All five require a SOURCE SUBJECT in the same text. Only `Script error` (the
   Classic runtime's own wording) and an uninstalled dependency still stand alone.
   --------------------------------------------------------------------------- */
console.log("\n===== classifyBlocker: a failure MODE without a source SUBJECT stays retryable =====");

const cls = (what, why = "") => classifyBlocker({ unit: "main", what, why }).class;

check("PR #157 review: \"the built page fails to render\" is NOT parked — it names the artifact this run wrote, which is the one thing a build round can fix",
  () => cls("the built page fails to render") === "unknown",
  () => classifyBlocker({ what: "the built page fails to render" }));
check("PR #157 review: \"the schema I just wrote does not compile\" is NOT parked — the reviewer's own counter-example, and the reason the subject test deliberately excludes the bare word `schema`",
  () => cls("the schema I just wrote does not compile") === "unknown",
  () => classifyBlocker({ what: "the schema I just wrote does not compile" }));
check("PR #157 review: \"the page fails to load after the merge\" is NOT parked — a re-check or a repair round is the right response, and a terminal park spends neither",
  () => cls("the page fails to load after the merge") === "unknown");
check("PR #157 review: \"the Classic schema does not compile\" IS parked — the source side is named, and no rebuild of the Freedom page changes it",
  () => cls("the Classic schema does not compile") === "source",
  () => classifyBlocker({ what: "the Classic schema does not compile" }));
check("PR #157 review: the source subject may arrive in `why` rather than `what` — the classifier reads the concatenation, so a blocker that states the mode in one field and the subject in the other still parks",
  () => cls("does not compile", "the original Classic section schema is what fails") === "source");
check("PR #157 review: `#Section/<Name>` counts as the source subject — it is the render-surface identifier the migration publishes for a Classic surface",
  () => cls("`#Section/Applicant` fails to load") === "source");
check("follow-up review: the two patterns that name the SOURCE SIDE by themselves still park with no subject word — the Classic runtime's own `Script error for \"<schema>\"` wording, and a dependency the migration reads from that is not installed",
  () => cls("Script error for \"Applicant...\"") === "source" && cls("a dependency is not installed") === "source",
  () => JSON.stringify([classifyBlocker({ what: "Script error for \"Applicant...\"" }), classifyBlocker({ what: "a dependency is not installed" })]));
check("follow-up review: a BARE `Script error` is NOT parked — `references/03-failure-and-park-policy.md` (ENG-96147) calls that text ambiguous by construction, because a `#Section/<code>` URL composed for the BUILT section produces exactly it, and one real run reported a working page as broken on that basis",
  () => cls("opening the built section shows Script error") === "unknown",
  () => classifyBlocker({ what: "opening the built section shows Script error" }));
check("follow-up review: \"the page errors at runtime\" is NOT parked — \"the page\" is the page THIS RUN BUILT at least as naturally as the Classic one, and a runtime error in the built page is the plainest case for a repair round",
  () => cls("the page errors at runtime") === "unknown",
  () => classifyBlocker({ what: "the page errors at runtime" }));
check("follow-up review: \"Live render check on surface automatic:3 could not be performed\" is NOT parked on its own — `context.mjs`/`reachKindBlock` and the per-page recipe TELL the build agent to report an unreachable verification surface in `blocked`, so this is the run's own check of its own page and a terminal park would diagnose it as a source bug",
  () => cls("Live render check on surface automatic:3 could not be performed") === "unknown",
  () => classifyBlocker({ what: "Live render check on surface automatic:3 could not be performed" }));
check("follow-up review: \"the render check on the page I built could not be performed\" is NOT parked — the subject is named, and it is the BUILT page",
  () => cls("the render check on the page I built could not be performed") === "unknown",
  () => classifyBlocker({ what: "the render check on the page I built could not be performed" }));

/* The ENG-94859 cost regression the split must NOT reintroduce: a GENUINE source blocker, phrased the way a
   build agent phrases one, still parks — otherwise the `list` unit buys a full round (Reconcile + Build +
   Verify + Judge) to re-learn the same dead end, six runs in a row. */
check("ENG-94859 not reintroduced: \"the Classic `ApplicantSection` page errors at runtime\" IS parked — the subject is the Classic source",
  () => cls("the Classic `ApplicantSection` page errors at runtime") === "source");
check("ENG-94859 not reintroduced: \"render check could not be performed — `#Section/Applicant` does not open at all\" IS parked — the render-surface identifier names the source surface",
  () => cls("render check could not be performed — `#Section/Applicant` does not open at all") === "source");
check("ENG-94859 not reintroduced: \"the source page errors at runtime, so nothing can be read off it\" IS parked",
  () => cls("the source page errors at runtime, so nothing can be read off it") === "source");
check("ENG-94859 not reintroduced: the MEASURED Applicant blocker still parks — its own text carries both `#Section/Applicant` and `Script error`, which is why the subject requirement costs it nothing",
  () => classifyBlocker(APPLICANT_LIST_BLOCKER).class === "source",
  () => JSON.stringify(classifyBlocker(APPLICANT_LIST_BLOCKER)));
check("PR #157 review: and the REASON distinguishes the two source verdicts, so the parked list reads as a diagnosis rather than one blanket sentence",
  () => /SUBJECT is not named/.test(classifyBlocker({ what: "the built page fails to render" }).reason)
    && /names the Classic\/source side/.test(classifyBlocker({ what: "the Classic schema does not compile" }).reason),
  () => [classifyBlocker({ what: "the built page fails to render" }).reason,
    classifyBlocker({ what: "the Classic schema does not compile" }).reason]);
check("PR #157 review: a builder-shaped failure mode therefore does NOT become a terminal park record either — the whole point is that it keeps its build rounds",
  () => sourceBlockerParks([{ unit: "main", what: "the page I built does not load", why: "" }]).length === 0,
  () => sourceBlockerParks([{ unit: "main", what: "the page I built does not load", why: "" }]));

/* --------------------------------------------------------------------------- */
console.log(`\n=================\nGATE GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

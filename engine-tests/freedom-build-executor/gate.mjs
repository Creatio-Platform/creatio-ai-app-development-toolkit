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

/* ---------------------------------------------------------------------------
   4. THE RUN'S OWN `#Section/` ROUTE IS NOT A SOURCE SUBJECT (ENG-96147)

   `#Section/` reads as a source subject because it is the render-surface identifier the migration publishes for
   a CLASSIC surface — but this run composes exactly that prefix for the section IT BUILT and records it in
   `standWrites.sectionRoute.route`. A blocker quoting that string is a report about the BUILT page, so classifying
   it `source` would park a builder defect terminally under the diagnosis "the blocker is in the SOURCE" — a
   silently dropped deliverable, which is the same Major this whole subject split answers. The recorded route
   reaches the classifier as an argument, so the function stays pure.
   --------------------------------------------------------------------------- */
console.log("\n===== classifyBlocker: the run's OWN recorded route is not a source subject =====");

// The route a `sectionRegistered` reach unit reported, in the shape `standWrites.sectionRoute` stores it.
const OWN_ROUTE = "#Section/UsrApplicants_ListPage";
const clsOwn = (what, why = "") => classifyBlocker({ unit: "list", what, why }, [OWN_ROUTE]).class;

check("ENG-96147: a failure-mode blocker naming the run's OWN recorded `#Section/<code>` is UNKNOWN → retried, never SOURCE — the run itself composed that URL for the page it built, so a terminal park would call a builder defect a source one",
  () => clsOwn("the render check could not be performed", "`#Section/UsrApplicants_ListPage` errors at runtime") === "unknown",
  () => JSON.stringify(classifyBlocker({ unit: "list", what: "the render check could not be performed", why: "`#Section/UsrApplicants_ListPage` errors at runtime" }, [OWN_ROUTE])));
check("ENG-96147: the own-route verdict carries its OWN reason, distinct from the unnamed-subject one, so the retry line says WHICH ambiguity kept the unit open",
  () => {
    const r = classifyBlocker({ what: "`#Section/UsrApplicants_ListPage` fails to load" }, [OWN_ROUTE]).reason;
    return /THIS RUN recorded/.test(r) && !/SUBJECT is not named/.test(r);
  },
  () => classifyBlocker({ what: "`#Section/UsrApplicants_ListPage` fails to load" }, [OWN_ROUTE]).reason);
check("ENG-96147: the exemption is case-insensitive and tolerates the `{ route, schemaName }` record the state file stores, not only a bare string",
  () => classifyBlocker({ what: "`#section/usrapplicants_listpage` does not load" },
    [{ route: OWN_ROUTE, schemaName: "UsrApplicants_ListPage" }]).class === "unknown",
  () => JSON.stringify(classifyBlocker({ what: "`#section/usrapplicants_listpage` does not load" }, [{ route: OWN_ROUTE }])));
check("ENG-96147: a SOURCE WORD still decides on its own — the own-route exemption removes the `#Section/` signal, it does not make the text un-classifiable",
  () => clsOwn("the Classic original at `#Section/UsrApplicants_ListPage` fails to render") === "source",
  () => JSON.stringify(classifyBlocker({ what: "the Classic original at `#Section/UsrApplicants_ListPage` fails to render" }, [OWN_ROUTE])));

/* The ENG-94859 benefit the exemption must NOT cost: a GENUINE Classic-source blocker names the section being
   migrated FROM, which is a DIFFERENT `#Section/<code>` than the one the run built, so it still parks once. */
check("ENG-96147: the reference is recognised when written WITHOUT backticks and followed by a colon or a query string — ordinary agent phrasing, and folding the punctuation into the code would make the run's own route stop matching itself",
  () => clsOwn("opening #Section/UsrApplicants_ListPage: the render check could not be performed") === "unknown"
    && clsOwn("#Section/UsrApplicants_ListPage?mode=list fails to load") === "unknown",
  () => JSON.stringify([classifyBlocker({ what: "opening #Section/UsrApplicants_ListPage: the render check could not be performed" }, [OWN_ROUTE]),
    classifyBlocker({ what: "#Section/UsrApplicants_ListPage?mode=list fails to load" }, [OWN_ROUTE])]));
check("ENG-96147: a BARE `#Section/` with no code after it — the \"no published route was available\" report the policy doc asks agents to write — is UNKNOWN, and its reason does NOT claim the run recorded that route",
  () => {
    const v = classifyBlocker({ unit: "list", what: "render check could not be performed", why: "no `#Section/` route was on file to open" }, [OWN_ROUTE]);
    return v.class === "unknown" && !/THIS RUN recorded/.test(v.reason);
  },
  () => JSON.stringify(classifyBlocker({ unit: "list", what: "render check could not be performed", why: "no `#Section/` route was on file to open" }, [OWN_ROUTE])));

check("ENG-94859 kept: a DIFFERENT `#Section/<code>` — the Classic section being migrated FROM — is still SOURCE even while a route of the run's own is recorded",
  () => clsOwn("the render check could not be performed", "`#Section/Applicant` errors at runtime") === "source",
  () => JSON.stringify(classifyBlocker({ what: "the render check could not be performed", why: "`#Section/Applicant` errors at runtime" }, [OWN_ROUTE])));
check("ENG-94859 kept: the exemption is PER REFERENCE, not per text — a Classic surface quoted ALONGSIDE the run's own route still parks on the other reference",
  () => clsOwn("`#Section/UsrApplicants_ListPage` was built, but `#Section/Applicant` does not load") === "source",
  () => JSON.stringify(classifyBlocker({ what: "`#Section/UsrApplicants_ListPage` was built, but `#Section/Applicant` does not load" }, [OWN_ROUTE])));
check("ENG-94859 kept: the MEASURED Applicant blocker still parks with the run's own route on file — its `#Section/Applicant` is not that route, and its `Script error for \"<schema>\"` names the source side anyway",
  () => classifyBlocker(APPLICANT_LIST_BLOCKER, [OWN_ROUTE]).class === "source",
  () => JSON.stringify(classifyBlocker(APPLICANT_LIST_BLOCKER, [OWN_ROUTE])));
check("ENG-96147: a `#Section/<guess>` that merely RESEMBLES the recorded route (the ST_2 incident's composed URL, missing the real `_ListPage` suffix) is still SOURCE — the match is exact by design, because a Classic surface is routinely a PREFIX of the Freedom route built from it, so a prefix rule would stop the measured ENG-94859 blocker from parking",
  () => clsOwn("`#Section/UsrApplicants` errors at runtime") === "source",
  () => JSON.stringify(classifyBlocker({ what: "`#Section/UsrApplicants` errors at runtime" }, [OWN_ROUTE])));

/* NO ROUTE RECORDED — the residual gap, stated as behaviour rather than glossed over. Before a `sectionRegistered`
   reach unit reports one (and on the `pages-only-no-menu` plans that register no section at all), the run holds no
   route, so it can vouch AGAINST nothing: a `#Section/<code>` is then indistinguishable from a Classic identifier.
   The classifier keeps the pre-ENG-96147 answer — SOURCE — because that is the reading the measured ENG-94859
   blocker needs, and because the goldens above show the exemption only ever narrows what parks. */
check("no route recorded (nothing in state yet, or a plan that registers no section): a `#Section/<code>` failure-mode blocker is still SOURCE — with no recorded route the run cannot tell its own surface from a Classic one, and this is the reading ENG-94859 needs; the exemption narrows parking only once a route exists",
  () => classifyBlocker({ what: "render check could not be performed — `#Section/UsrApplicants_ListPage` does not open" }).class === "source"
    && classifyBlocker({ what: "render check could not be performed — `#Section/UsrApplicants_ListPage` does not open" }, []).class === "source",
  () => JSON.stringify(classifyBlocker({ what: "render check could not be performed — `#Section/UsrApplicants_ListPage` does not open" })));
check("no route recorded: blank / malformed route entries are dropped rather than read as an empty code that would exempt every reference",
  () => classifyBlocker({ what: "`#Section/UsrApplicants_ListPage` fails to load" }, [null, undefined, "", "   ", "#Section/", {}]).class === "source",
  () => JSON.stringify(classifyBlocker({ what: "`#Section/UsrApplicants_ListPage` fails to load" }, [null, "", "#Section/", {}])));

check("ENG-96147: `sourceBlockerParks` threads the recorded route through, so the own-route blocker produces NO park record at all",
  () => sourceBlockerParks([{ unit: "list", what: "the render check could not be performed", why: "`#Section/UsrApplicants_ListPage` errors at runtime" }], [OWN_ROUTE]).length === 0
    && sourceBlockerParks([{ unit: "list", what: "the render check could not be performed", why: "`#Section/UsrApplicants_ListPage` errors at runtime" }]).length === 1,
  () => JSON.stringify(sourceBlockerParks([{ unit: "list", what: "the render check could not be performed", why: "`#Section/UsrApplicants_ListPage` errors at runtime" }], [OWN_ROUTE])));

/* --------------------------------------------------------------------------- */
console.log(`\n=================\nGATE GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

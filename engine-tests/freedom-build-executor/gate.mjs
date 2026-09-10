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
  classifyBlocker, blockerKey, sourceBlockerParks, sourceParkWhy, environmentFaultRow,
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

/* ---------------------------------------------------------------------------
   PR #157 REVIEW (round 2, Blocker on gate.mjs:114) — `\bsource\b` MATCHED FREEDOM'S OWN VOCABULARY.

   "data source" is core Freedom-page language and this run's own prompts use it verbatim three times ("the data
   source named by `primaryDataSourceName`"). A bare `source` in SOURCE_SUBJECT_WORDS therefore turned an everyday
   builder blocker into a TERMINAL park with `rounds: 0` — a silently dropped deliverable plus a false diagnosis, on
   the one class of blocker a build round would have fixed — and the queue file carried the park, so it was re-parked
   on every resumed run.

   The five phrasings below are the ones the third reviewer EXECUTED against `263d971` and reported parking. Every
   one of them must now stay retryable. There was no "data source" text in any suite before this block, which is
   why the goldens could not see it.                                                         */
const cls5 = (what, why = "") => classifyBlocker({ unit: "list", what, why }, [OWN_ROUTE]).class;
const FIVE_MEASURED = [
  ["the page fails to render", "its primary data source is not bound"],
  ["the list page fails to load", "the data source named by primaryDataSourceName is missing"],
  // The third reviewer wrote this one against `#Section/UsrApplicant_ListPage`; the suite's recorded route is
  // `UsrApplicants_ListPage`, and the exemption is EXACT-MATCH ONLY by design (a Classic surface is routinely a
  // prefix of the Freedom route built from it, so no prefix rule could tell a guess from a real Classic id). Driven
  // with the route the run actually recorded, which is the state the reviewer's example assumes.
  [`opening ${OWN_ROUTE} errors at runtime`, "the data source is not bound"],
  ["the schema does not compile", "the source of the error is a typo I wrote"],
  ["the page fails to render", "the field moved from its original position"],
];
check("PR #157 review (round 2): all FIVE measured builder-side phrasings stay `unknown` — each pairs a real failure MODE with a word that only looks like a source subject (`data source`, `the source of the error`, `its original position`), and each used to park terminally with rounds: 0",
  () => FIVE_MEASURED.every(([what, why]) => cls5(what, why) === "unknown"),
  () => FIVE_MEASURED.map(([what, why]) => `${cls5(what, why)}  <=  ${what} / ${why}`));
check("PR #157 review (round 2): the two negative goldens the thread asked for by name",
  () => cls5("the primary data source is not bound, so the page fails to render") === "unknown"
    && cls5("the built page fails to render the original layout's Feed tab") === "unknown",
  () => JSON.stringify({
    a: classifyBlocker({ what: "the primary data source is not bound, so the page fails to render" }, [OWN_ROUTE]),
    b: classifyBlocker({ what: "the built page fails to render the original layout's Feed tab" }, [OWN_ROUTE]) }));
check("PR #157 review (round 2): the exclusion does not depend on a recorded route — `data source` is not a subject even when the run has no route on file at all, which is the state of every run before its app unit reports",
  () => classifyBlocker({ what: "the page fails to render", why: "its primary data source is not bound" }).class === "unknown"
    && classifyBlocker({ what: "the list page fails to load", why: "dataSource `PDS` is missing" }, []).class === "unknown",
  () => JSON.stringify(classifyBlocker({ what: "the page fails to render", why: "its primary data source is not bound" })));
check("PR #157 review (round 2): a GENERIC word still parks when it QUALIFIES a source artefact — the narrowing removes the false positives, it does not make the generic half inert",
  () => cls5("the source page does not compile") === "source"
    && cls5("the legacy schema fails to load") === "source"
    && cls5("the original form errors at runtime") === "source",
  () => JSON.stringify(["source page", "legacy schema", "original form"].map((p) => cls5(`the ${p} does not compile`))));
check("PR #157 review (round 2): the ENG-94859 blocker this whole module exists for STILL PARKS — the narrowing must not cost the one case it was written to catch",
  () => classifyBlocker(APPLICANT_LIST_BLOCKER, [OWN_ROUTE]).class === "source"
    && sourceBlockerParks([APPLICANT_LIST_BLOCKER], [OWN_ROUTE]).length === 1,
  () => JSON.stringify(classifyBlocker(APPLICANT_LIST_BLOCKER, [OWN_ROUTE])));

/* ---------------------------------------------------------------------------
   PR #157 REVIEW (round 2) — THE PRODUCER'S DECLARED SUBJECT.

   The thread's second half: the park verdict was re-derived downstream from free prose while `schemas.mjs` already
   declares the producer-side channel for it. `subject` is optional, prefers the agent's own answer, and shrinks the
   regex surface from a decision to a legacy fallback.                                       */
check("PR #157 review (round 2): `subject: \"builder\"` can NEVER be parked as source, however the blocker is phrased — the declared field outranks both the self-naming patterns and the failure-mode/subject pair",
  () => classifyBlocker({ ...APPLICANT_LIST_BLOCKER, subject: "builder" }).class === "unknown"
    && classifyBlocker({ what: "the Classic page does not compile", subject: "builder" }).class === "unknown"
    && classifyBlocker({ what: 'Script error for "Applicant..."', subject: "builder" }).class === "unknown"
    && sourceBlockerParks([{ ...APPLICANT_LIST_BLOCKER, subject: "builder" }]).length === 0,
  () => JSON.stringify(classifyBlocker({ ...APPLICANT_LIST_BLOCKER, subject: "builder" })));
check("PR #157 review (round 2): `subject: \"source\"` parks a blocker whose prose says nothing — the agent that hit it is allowed to answer the question directly, which is the point of moving the decision to the producer",
  () => classifyBlocker({ unit: "list", what: "the surface will not open", subject: "source" }).class === "source"
    && sourceBlockerParks([{ unit: "list", what: "the surface will not open", subject: "source" }]).length === 1,
  () => JSON.stringify(classifyBlocker({ unit: "list", what: "the surface will not open", subject: "source" })));
check("PR #157 review (round 2): the declared verdict SAYS it was declared — an operator reading a park must be able to tell an agent's answer from a regex's guess",
  () => /DECLARED/.test(classifyBlocker({ what: "x", subject: "source" }).reason)
    && /DECLARED/.test(classifyBlocker({ what: "x", subject: "builder" }).reason),
  () => JSON.stringify([classifyBlocker({ what: "x", subject: "source" }).reason, classifyBlocker({ what: "x", subject: "builder" }).reason]));
check("PR #157 review (round 2): a value OUTSIDE the two words is ignored, not read as a third state — a typo, a translated word or a sentence falls back to the patterns and keeps the conservative `unknown -> retry` default",
  () => classifyBlocker({ ...APPLICANT_LIST_BLOCKER, subject: "Source-ish" }).class === "source"
    && classifyBlocker({ what: "the page fails to render", why: "the data source is not bound", subject: "" }).class === "unknown"
    && classifyBlocker({ what: "the page fails to render", why: "the data source is not bound", subject: 7 }).class === "unknown",
  () => JSON.stringify(classifyBlocker({ ...APPLICANT_LIST_BLOCKER, subject: "Source-ish" })));
check("PR #157 review (round 2): the declared field is read case- and whitespace-insensitively — an agent writing `\" Builder\"` meant `builder`, and treating that as unrecognised would send it back to the prose it is meant to replace",
  () => classifyBlocker({ ...APPLICANT_LIST_BLOCKER, subject: " BUILDER " }).class === "unknown"
    && classifyBlocker({ what: "x", subject: "Source" }).class === "source",
  () => JSON.stringify(classifyBlocker({ ...APPLICANT_LIST_BLOCKER, subject: " BUILDER " })));

/* ---------------------------------------------------------------------------
   ENG-96778 (PR #171 scope expansion) — THE `environment` CLASS: the stand itself did not answer.

   The measured run (`migrations/UsrAwesome`, session ce23724f) had its stand killed mid-Build. The builders
   answered with STRUCTURED blockers naming the outage, and under the two-class split every one of them was
   `unknown` → retryable, so `list`, `main` and `reach` were each dispatched at a dead port, and Verify, Judge and
   Reconcile ran after them. These goldens pin the third class the core now halts on, its two pattern tiers, the
   precedence against a declared subject, and — as importantly — every shipped phrase that must NOT be read as one.
   EVERY POSITIVE ROW BELOW IS KILLED BY DELETING EXACTLY ONE REGEX (mutation-tested before push): each text matches
   one pattern and no other, so a pattern removed from the list turns its own row red rather than hiding behind a
   sibling.
   --------------------------------------------------------------------------- */
console.log("\n===== ENG-96778: the environment class — the stand itself did not answer =====");

const clsEnv = (what, why = "", subject) => classifyBlocker(subject === undefined ? { unit: "list", what, why } : { unit: "list", what, why, subject }).class;
// The two incident texts, as the run journal carried them. The first is the row `list`/`main`/`reach` each filed;
// the second is the app unit's, which the partial-branch of `applyAppUnitResult` accepted as a valid answer.
const ENV_INCIDENT_LIST = { unit: "list", what: "Environment unreachable — dev-local (port 40010) actively refusing connections", why: "" };
const ENV_INCIDENT_APP = { unit: "app", what: "Stand dev-local (port 40010) went down mid-build", why: "create-app-section never answered and every later call got connection refused" };

check("ENG-96778: the incident's `list` row — \"Environment unreachable — dev-local (port 40010) actively refusing connections\" — is ENVIRONMENT, the class that used to be `unknown` and bought the next two units their own 2-3 minute rediscovery of the outage",
  () => classifyBlocker(ENV_INCIDENT_LIST).class === "environment",
  () => JSON.stringify(classifyBlocker(ENV_INCIDENT_LIST)));
check("ENG-96778: the incident's APP row — \"Stand … went down … connection refused\" — is ENVIRONMENT too; this is the row the partial-app-unit branch accepted as a valid answer and kept dispatching behind",
  () => classifyBlocker(ENV_INCIDENT_APP).class === "environment",
  () => JSON.stringify(classifyBlocker(ENV_INCIDENT_APP)));

// TIER A — one row per socket/DNS token, each matching ONE regex in `ENVIRONMENT_SOCKET_PATTERNS`.
const TIER_A = [
  ["connect ECONNREFUSED 127.0.0.1:40010", "ECONN(REFUSED)"],
  ["read ECONNRESET while fetching the page", "ECONN(RESET)"],
  ["ECONNABORTED on the second call", "ECONN(ABORTED)"],
  ["connect ETIMEDOUT 10.0.0.5:443", "E(TIMEDOUT)"],
  ["ENOTFOUND my-stand.example", "E(NOTFOUND)"],
  ["EHOSTUNREACH — no route to host", "E(HOSTUNREACH)"],
  ["ENETUNREACH from this network", "E(NETUNREACH)"],
  ["EAI_AGAIN resolving the stand host", "E(AI_AGAIN)"],
  ["the connection was refused by the stand port", "connection … refused"],
  ["port 40010 is actively refusing", "actively refusing"],
  ["the listener refused all connections", "refused … connections"],
  ["getaddrinfo failed for the configured host", "getaddrinfo"],
  ["nodename nor servname provided, or not known", "nodename nor servname"],
];
for (const [text, token] of TIER_A) {
  check(`ENG-96778 Tier A: \`${token}\` on its own reads ENVIRONMENT — the transport's own words for "nobody is listening", which no agent writes about a page (mutant: delete that regex → this row is red)`,
    () => clsEnv(text) === "environment", () => JSON.stringify(classifyBlocker({ what: text })));
}
// The Tier A tokens are the transport's UPPER-CASE codes — a lower-case look-alike in prose is not one.
check("ENG-96778 Tier A: the socket codes are matched as the codes the transport prints — `econnrefused` in prose is not `ECONNREFUSED`, so a word that merely resembles one stays `unknown`",
  () => clsEnv("the econnrefused wording in the doc is confusing") === "unknown");

// TIER B — one row per phrasing, each matching ONE regex in `ENVIRONMENT_STAND_PATTERNS`.
const TIER_B = [
  ["the stand dev-local (port 40010) went down while the page was being written", "<noun> … went down"],
  ["Environment unreachable — dev-local", "<noun> unreachable"],
  ["an unreachable environment answered nothing for three minutes", "unreachable <noun>"],
  ["cannot reach the dev-local instance", "cannot reach … <noun>"],
  ["cannot connect to the application at all", "cannot connect to the application"],
];
for (const [text, phrase] of TIER_B) {
  check(`ENG-96778 Tier B: "${phrase}" — a stand NOUN beside a DOWN state — reads ENVIRONMENT on an undeclared row (mutant: delete that regex → this row is red)`,
    () => clsEnv(text) === "environment", () => JSON.stringify(classifyBlocker({ what: text })));
}
check("ENG-96778 Tier B: the noun list is shared by every phrasing — `instance`, `site`, `server` and `application server` all count, so a noun cannot be recognised in one phrasing and missed in another",
  () => clsEnv("the instance is offline") === "environment" && clsEnv("the site is down") === "environment"
    && clsEnv("the server is not responding") === "environment" && clsEnv("the application server remains unreachable") === "environment",
  () => ["the instance is offline", "the site is down", "the server is not responding", "the application server remains unreachable"].map((t) => `${clsEnv(t)} <= ${t}`));

// THE NEGATIVES — every shipped phrase the corpus check found that must KEEP its current class. Each is a real
// string from the core, the gate or the policy doc, and each would become a false round halt if a bare token
// (`unreachable`, `timed out`, `environment`, `surface`, `page`) were ever admitted (mutant: widen a pattern to the
// bare word → the matching row here goes red).
const ENV_NEGATIVES = [
  ["Live render check on surface automatic:3 could not be performed — verification surface unreachable", "the run's OWN render check (core.mjs / gate.mjs header)"],
  ["a section in no workplace is unreachable from the menu, which is the deliverable this unit exists for", "the workplace-binding blocker the core itself files"],
  ["built pages stay unreachable", "the reachability `miss` text the plan publishes"],
  ["get-page timed out", "a TRANSPORT fault agents are told to switch transport on"],
  ["clio-run timed out after 120s (error-class=creatio-timeout)", "the policy's own timeout example — transport, not environment"],
  ["Environment version could not be probed (resolvedFromReason=probe-error)", "a probe that could not run is not a stand that is down"],
  ["the surface is unreachable", "`surface` is deliberately not a stand noun"],
  ["the stand answered but the page in this section is not responding to clicks", "the sentence leaves the stand and goes on about a page — seven words past the noun, outside the four-word noun-verb window (mutant: unbounded window → red)"],
  ["an environment fault was suspected but the page rendered", "bare `environment fault` is not admitted"],
  ["the host was slow but answered", "`host` is deliberately not a stand noun"],
];
for (const [text, why] of ENV_NEGATIVES) {
  check(`ENG-96778 negative: "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}" stays \`unknown\` — ${why}`,
    () => clsEnv(text) === "unknown", () => JSON.stringify(classifyBlocker({ what: text })));
}
check("ENG-96778 negative: the ENG-94859 Applicant blocker KEEPS its `source` class — the environment tier must not cost the one case the source split was written to catch",
  () => classifyBlocker(APPLICANT_LIST_BLOCKER).class === "source");

// PRECEDENCE against a declared subject — each rule flipped is a red row.
const SOCKET_TEXT = "connect ECONNREFUSED 127.0.0.1:40010 while opening the page";
check("ENG-96778 precedence: a declared `subject: \"environment\"` reads ENVIRONMENT on any text — the agent that hit it answered the question directly, and the reason says it was DECLARED",
  () => { const v = classifyBlocker({ unit: "list", what: "nothing answered", subject: "environment" }); return v.class === "environment" && /DECLARED/.test(v.reason); },
  () => JSON.stringify(classifyBlocker({ unit: "list", what: "nothing answered", subject: "environment" })));
check("ENG-96778 precedence: Tier A OVERRIDES a declared `source` — a socket error contradicts \"the Classic artefact failed\", and a wrong `source` is a TERMINAL park; the incident's `list` row was declared exactly that (mutant: honour the declared `source` first → red)",
  () => classifyBlocker({ ...ENV_INCIDENT_LIST, subject: "source" }).class === "environment"
    && classifyBlocker({ unit: "list", what: SOCKET_TEXT, subject: "source" }).class === "environment",
  () => JSON.stringify(classifyBlocker({ ...ENV_INCIDENT_LIST, subject: "source" })));
check("ENG-96778 precedence: and the override SAYS it contradicted the declaration, so an operator reading the row can see why the agent's own word was not taken",
  () => /contradicts the declared/.test(classifyBlocker({ unit: "list", what: SOCKET_TEXT, subject: "source" }).reason),
  () => classifyBlocker({ unit: "list", what: SOCKET_TEXT, subject: "source" }).reason);
check("ENG-96778 precedence: Tier A does NOT override a declared `builder` — `ECONNREFUSED 127.0.0.1:9222` is the builder's own headless-Chrome check failing, and it stays retryable (mutant: let Tier A run before the builder check → red)",
  () => classifyBlocker({ unit: "list", what: "ECONNREFUSED 127.0.0.1:9222 — the render check could not open Chrome", subject: "builder" }).class === "unknown",
  () => JSON.stringify(classifyBlocker({ unit: "list", what: "ECONNREFUSED 127.0.0.1:9222", subject: "builder" })));
check("ENG-96778 precedence: Tier B NEVER overrides a declared subject — \"the stand went down\" with `subject: \"source\"` is still SOURCE and with `subject: \"builder\"` still `unknown`; the words are ordinary English and the agent already answered (mutant: run Tier B on declared rows → red)",
  () => classifyBlocker({ unit: "list", what: "the stand went down while I was reading the Classic page", subject: "source" }).class === "source"
    && classifyBlocker({ unit: "list", what: "the stand went down while I was reading the Classic page", subject: "builder" }).class === "unknown",
  () => JSON.stringify([classifyBlocker({ what: "the stand went down while I was reading the Classic page", subject: "source" }),
    classifyBlocker({ what: "the stand went down while I was reading the Classic page", subject: "builder" })]));

// NO PARK. An environment row is neither source nor builder: it must never become a terminal park record, however it
// was declared — including the misdeclared incident row, which used to be one re-run away from parking `list`.
check("ENG-96778: `sourceBlockerParks` parks NONE of the environment rows — not the declared one, not the inferred ones, and not the incident's row misdeclared `source` (mutant: drop the Tier A override → the misdeclared row parks terminally)",
  () => sourceBlockerParks([ENV_INCIDENT_LIST, ENV_INCIDENT_APP, { ...ENV_INCIDENT_LIST, subject: "source" },
    { unit: "main", what: "nothing answered", subject: "environment" }]).length === 0,
  () => JSON.stringify(sourceBlockerParks([ENV_INCIDENT_LIST, ENV_INCIDENT_APP, { ...ENV_INCIDENT_LIST, subject: "source" }])));

// THE READ THE CORE MAKES: first environment row or null.
check("ENG-96778: `environmentFaultRow` returns the FIRST environment-classified row and nothing else — a builder row ahead of it is skipped, a list with none returns `null`, and holes are tolerated",
  () => environmentFaultRow([{ what: "Field `UsrStage` is missing" }, ENV_INCIDENT_LIST, ENV_INCIDENT_APP]) === ENV_INCIDENT_LIST
    && environmentFaultRow([{ what: "Field `UsrStage` is missing" }, APPLICANT_LIST_BLOCKER]) === null
    && environmentFaultRow([null, undefined, ENV_INCIDENT_APP]) === ENV_INCIDENT_APP
    && environmentFaultRow([]) === null && environmentFaultRow(undefined) === null,
  () => JSON.stringify(environmentFaultRow([{ what: "Field `UsrStage` is missing" }, ENV_INCIDENT_LIST])));
check("ENG-96778: `environmentFaultRow` threads `ownRoutes` through, so a Classic `#Section/` reference beside an environment token still reads ENVIRONMENT (the environment tier is decided before the source patterns run)",
  () => environmentFaultRow([{ unit: "list", what: "`#Section/Applicant` could not be opened — connection refused" }], ["#Section/UsrApplicants_ListPage"]) !== null);

/* --------------------------------------------------------------------------- */
console.log(`\n=================\nGATE GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

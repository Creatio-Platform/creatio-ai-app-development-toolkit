// QUESTIONS BEFORE APPROVAL. The questions only the person who owns the application can answer — a behaviour choice
// on a page, a change outside the target package or to the whole object, a page that writes data when it opens —
// are listed by discovery in `manifest.planQuestions`, shown in the plan, and keep the plan from being approved
// until each is answered. A question the build asks after the approval is recorded with `Plan question:` and
// counted in the migration result, so the gap between the plan and the build is a number.
// The fixtures under `fixtures/plan-questions/` model a process page with a product-line card and usage limits: the
// questions the build stopped on when nobody asked them at plan time, and the same questions raised by discovery.
// Imported and run by `run-mapper.mjs`, which hands it its `check` and the shared fixtures so the tally stays one number.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planQuestionsOf, dataOnOpenQuestion, planQuestionAnswers, PLAN_QUESTION_KINDS }
  from "../../skills/classic-to-freedom-migration/engine/plan-questions.mjs";
import { questionsAfterApproval, parseDecisionLog, parseDecisionRecords, provenanceIssues, provenanceById }
  from "../../skills/classic-to-freedom-migration/engine/directives.mjs";
import { unaccountedDecisions } from "../../skills/classic-to-freedom-migration/engine/tasks.mjs";
import { renderFinalReport } from "../../skills/classic-to-freedom-migration/engine/report.mjs";

const USER = (q) => ({ decidedBy: "user", quote: q });

export function runPlanQuestionChecks({ check, runMigration, runMigrate, CLEAN_SEED, FULL_PLANMETA, FULL_PLACEMENT, FULL_CONVENTIONS, FIX }) {
  const dir = path.join(FIX, "plan-questions");
  const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
  const QUESTIONS = JSON.parse(read("plan-questions.json"));
  const decisions = new Map([["D9", "a"], ["D10", "b"], ["D11", "c"]]);
  const provenance = { D9: USER("yes"), D10: USER("b"), D11: { decidedBy: "orchestrator", quote: "" } };
  const of = (entries, extra = {}) => planQuestionsOf({ entries, opts: { decisions, decisionProvenance: provenance }, ...extra });

  // The entry rules.
  const answered = of([{ id: "q1", kind: "behaviour", question: "Keep it?", answer: "D9" }]);
  check("plan questions: an answered question names its D<N> and leaves nothing open",
    () => answered.issues.length === 0 && answered.open.length === 0 && answered.questions[0].answer === "D9"
      && answered.questions[0].kind === "behaviour" && answered.questions[0].pages.length === 0,
    () => answered);
  const open = of([{ id: "q1", kind: "outside-package", question: "Change package X?" }]);
  check("plan questions: a question with no answer is OPEN, and an open question is no entry problem",
    () => open.open.join() === "q1" && open.issues.length === 0, () => open);
  check("plan questions: in a mode that reads no decisions.md an open question is listed but is no gap, and an answer is taken as written",
    () => { const r = planQuestionsOf({ entries: [{ id: "q1", kind: "behaviour", question: "?" }, { id: "q2", kind: "behaviour", question: "?", answer: "D4" }], opts: { decisionsOptional: true } });
      return r.open.length === 0 && r.issues.length === 0 && r.questions.length === 2; });
  const problems = (entries, extra) => of(entries, extra).issues.map((x) => `${x.key}: ${x.problem}`);
  check("plan questions: a kind outside the four, a missing question and a missing id are named",
    () => /`kind` must be one of `behaviour`, `outside-package`, `object-wide`, `data-on-open`/.test(problems([{ id: "q", kind: "style", question: "?" }]).join())
      && /needs `question`/.test(problems([{ id: "q", kind: "behaviour" }]).join())
      && /planQuestions\[0\]: needs an `id`/.test(problems([{ kind: "behaviour", question: "?" }]).join())
      && /must be a list of questions/.test(problems({ id: "q" }).join()),
    () => [problems([{ id: "q", kind: "style", question: "?" }]), problems({ id: "q" })]);
  check("plan questions: the same id twice is named, and the first entry stands",
    () => { const r = of([{ id: "q", kind: "behaviour", question: "A?" }, { id: "q", kind: "behaviour", question: "B?" }]);
      return r.questions.length === 1 && r.questions[0].question === "A?" && /listed twice/.test(r.issues[0]?.problem); });
  check("plan questions: an answer that is not a D<N>, one decisions.md does not hold, and the orchestrator's own choice are refused",
    () => /must be a D<N>/.test(problems([{ id: "q", kind: "behaviour", question: "?", answer: "yes" }]).join())
      && /`D99` does not resolve/.test(problems([{ id: "q", kind: "behaviour", question: "?", answer: "D99" }]).join())
      && /`D11` is not the user's own answer/.test(problems([{ id: "q", kind: "behaviour", question: "?", answer: "D11" }]).join()),
    () => problems([{ id: "q", kind: "behaviour", question: "?", answer: "D11" }]));
  check("plan questions: an answer in plan mode with no decisions.md read cannot be resolved",
    () => /no decisions\.md was read/.test(planQuestionsOf({ entries: [{ id: "q", kind: "behaviour", question: "?", answer: "D9" }] }).issues[0]?.problem));

  // The question the engine raises itself: a page that writes data when it opens.
  const addOnly = dataOnOpenQuestion({ pageKey: "main", label: "Contract form page", writes: [{ addModeOnly: true }] });
  const always = dataOnOpenQuestion({ pageKey: "child:Line", label: "Line page", writes: [{ addModeOnly: true }, { addModeOnly: false }] });
  check("plan questions: a page that writes data when it opens gets `data-on-open:<pageKey>`, asked in product terms",
    () => addOnly.id === "data-on-open:main" && addOnly.kind === "data-on-open" && addOnly.pages.join() === "main"
      && /as a new record changes data on the stand/.test(addOnly.question) && /only open existing records/.test(addOnly.question)
      && /every time, in edit mode too/.test(always.question) && /at all\?/.test(always.question),
    () => [addOnly, always]);
  const derived = of([{ id: "data-on-open:main", answer: "D10" }], { derived: [addOnly] });
  check("plan questions: the manifest answers the engine's question by its id; kind and question stay the engine's",
    () => derived.issues.length === 0 && derived.open.length === 0 && derived.questions[0].question === addOnly.question
      && derived.questions[0].answer === "D10",
    () => derived);
  check("plan questions: the engine's question with no manifest entry is open; an answer for a page that writes nothing is named",
    () => of(undefined, { derived: [addOnly] }).open.join() === "data-on-open:main"
      && /which is no page that writes data when opened/.test(problems([{ id: "data-on-open:list", answer: "D9" }]).join()),
    () => problems([{ id: "data-on-open:list", answer: "D9" }]));
  check("plan questions: every kind has a label the plan prints",
    () => Object.keys(PLAN_QUESTION_KINDS).join() === "behaviour,outside-package,object-wide,data-on-open");

  // An answer accounts for its decisions.md entry before the first dispatch, like a deliverable status.
  check("plan questions: the D<N> a question's answer names is a cited decision; one nothing names stays unaccounted",
    () => planQuestionAnswers([{ answer: " D9 " }, { answer: "yes" }, null, { id: "q" }]).join() === "D9"
      && unaccountedDecisions(new Map([["D9", "a"], ["D10", "b"]]), { planQuestionAnswers: ["D9"] }).map((d) => d.id).join() === "D10");

  // THE GOLDEN: the process page plans its questions before approval.
  const proc = path.join(FIX, "process-page");
  const body = (f) => fs.readFileSync(path.join(proc, f), "utf8");
  const processPlanMeta = Object.fromEntries(Object.entries(FULL_PLANMETA).filter(([k]) => k !== "sectionSchema"));
  const manifest = (planQuestions, extra = {}) => ({
    entity: "", targetPackage: "UsrSU", planMeta: processPlanMeta, placement: FULL_PLACEMENT, projectConventions: FULL_CONVENTIONS,
    seed: [...CLEAN_SEED, { pkg: "CrtUIPlatform7x", body: body("BasePageV2_skeleton.js") }, { pkg: "CrtWizards7x", body: body("BasePageProcessTemplate.js") }],
    schemas: [{ pkg: "UsrDelivery", body: body("UsrDeliveryCheckPage.js") }],
    entityColumns: { UsrOrderParam: { type: "Lookup", ref: "Order", title: "Order" } },
    resources: { SaveDataButtonCaption: "Save", CancelButtonCaption: "Cancel" },
    processPage: { stepsResolved: true, evidence: "the user named one process",
      steps: [{ process: "UsrDeliveryProcess", element: "CheckDelivery", caption: "Check the delivery", consent: "approved" }] },
    ...(planQuestions ? { planQuestions } : {}), ...extra,
  });
  const unanswered = QUESTIONS.map(({ answer, ...q }) => q);
  const planIn = (decisionsText, planQuestions) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plan-questions-"));
    try {
      if (decisionsText !== null) fs.writeFileSync(path.join(tmp, "decisions.md"), decisionsText);
      const out = path.join(tmp, "plan.md");
      const r = runMigrate(["-", "--plan", "--out", out], { input: JSON.stringify(manifest(planQuestions)) });
      return { status: r.status, stderr: r.stderr || "", plan: fs.existsSync(out) ? fs.readFileSync(out, "utf8") : r.stdout || "" };
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  };
  const section = (plan) => {
    const at = plan.indexOf("### Questions before approval");
    return at < 0 ? "" : plan.slice(at, plan.indexOf("\n### ", at + 1) + 1);
  };
  const before = read("decisions-before-approval.md");
  const asked = planIn(before.split("## D9")[0], unanswered);
  check("plan questions golden (CLI): with the package and behaviour questions unanswered the plan exits 2, its banner lists all five and stderr names them",
    () => asked.status === 2 && /PLAN INCOMPLETE — 5 question\(s\) to ask before approval/.test(asked.plan)
      && /5 plan question\(s\) OPEN \(outside-package:line-type-dropdowns, behaviour:usage-limit-editing/.test(asked.stderr)
      && (section(asked.plan).match(/⚠ open/g) || []).length === 5,
    () => ({ status: asked.status, stderr: asked.stderr.slice(0, 600), section: section(asked.plan) }));
  const settled = planIn(before, QUESTIONS);
  check("plan questions golden (CLI): answered before approval, the same plan exits 0 and lists every question with its answer",
    () => settled.status === 0 && !/PLAN INCOMPLETE/.test(settled.plan) && section(settled.plan) === read("plan-questions-section.golden.md"),
    () => ({ status: settled.status, stderr: settled.stderr.slice(0, 600), section: section(settled.plan) }));
  check("plan questions golden: the package question is raised at plan time as a change outside the target package, the behaviour questions as behaviour choices",
    () => /\| 1 \| Billing type and Purchase type .*defined in package UsrBillingBase.* \| Change outside the target package \| `child:UsrProductLine` \| D9 \|/.test(section(settled.plan))
      && (section(settled.plan).match(/\| Behaviour choice \|/g) || []).length === 4,
    () => section(settled.plan));
  const version = (plan) => /\*\*Plan version:\*\* `(plan-[0-9a-f]+)`/.exec(plan)?.[1];
  const reworded = QUESTIONS.map((q, i) => (i ? q : { ...q, question: `${q.question} Reworded.` }));
  check("plan questions golden: answering the questions leaves the plan version as it was; adding or rewording a question moves it",
    () => !!version(settled.plan) && version(settled.plan) === version(asked.plan)
      && version(planIn(before, undefined).plan) !== version(settled.plan) && version(planIn(before, reworded).plan) !== version(settled.plan),
    () => [version(asked.plan), version(settled.plan)]);
  const invalidOnly = planIn(before, [...QUESTIONS, { id: "behaviour:style", kind: "style", question: "Which colour?", answer: "D13" }]);
  check("plan questions (CLI): an entry that cannot stand is a gap on its own — exit 2, the banner and stderr name it, with every question answered",
    () => invalidOnly.status === 2 && /PLAN INCOMPLETE — 1 `manifest\.planQuestions` problem\(s\)/.test(invalidOnly.plan)
      && /⛔ PLAN QUESTIONS — planQuestions INVALID \(`behaviour:style` `kind` must be one of/.test(invalidOnly.stderr)
      && !/OPEN/.test(invalidOnly.stderr),
    () => ({ status: invalidOnly.status, stderr: invalidOnly.stderr.slice(0, 600) }));

  // `--tasks` (the cut): the same gap stops it, and an answer counts as a cited decision at the first dispatch.
  const cut = (decisionsText, planQuestions) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plan-questions-cut-"));
    try {
      const input = JSON.stringify(manifest(planQuestions, { decisionsWithoutDeliverable: ["D2", "D3"] }));
      fs.writeFileSync(path.join(tmp, "decisions.md"), decisionsText);
      const planned = runMigrate(["-", "--plan", "--out", path.join(tmp, "plan.md")], { input });
      fs.appendFileSync(path.join(tmp, "decisions.md"),
        `\n## Plan approval\n- Approved by: user\n- Plan version: ${version(fs.readFileSync(path.join(tmp, "plan.md"), "utf8"))}\n`);
      const r = runMigrate(["-", "--tasks", path.join(tmp, "build-tasks")], { input });
      return { planned: planned.status, status: r.status, stderr: r.stderr || "", out: r.stdout || "" };
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  };
  const cutOpen = cut(before.split("## D9")[0], unanswered);
  check("plan questions (CLI): `--tasks` with the questions open exits 2 and stderr names them",
    () => cutOpen.status === 2 && /⛔ PLAN QUESTIONS — 5 plan question\(s\) OPEN/.test(cutOpen.stderr),
    () => ({ status: cutOpen.status, stderr: cutOpen.stderr.slice(0, 600) }));
  const cutAnswered = cut(before, QUESTIONS);
  check("plan questions (CLI): `--tasks` cuts the approved plan — the D<N> cited only as plan-question answers are accounted for, not refused as unaccounted",
    () => cutAnswered.planned === 0 && cutAnswered.status === 0 && !/unaccounted|no deliverable accounts for/i.test(cutAnswered.stderr + cutAnswered.out),
    () => ({ planned: cutAnswered.planned, status: cutAnswered.status, stderr: cutAnswered.stderr.slice(0, 800), out: cutAnswered.out.slice(0, 800) }));
  const none = runMigration(manifest(undefined));
  check("plan questions: a plan with no questions has no section and no gap",
    () => !/### Questions before approval/.test(none.plan) && none.planQuestions.questions.length === 0 && none.planQuestions.open.length === 0);

  // THE BUILD-TIME SIDE: the same section without plan questions stopped on six questions discovery could have asked.
  const afterText = read("decisions-after-approval.md");
  const askedAfter = (text) => questionsAfterApproval(parseDecisionLog(text));
  const after = askedAfter(afterText);
  check("questions after approval: every answer after the first approval is counted; unclassified counts as missed; a directive and an orchestrator choice are not questions",
    () => after.approved && after.questions.map((q) => q.id).join() === "D4,D5,D6,D7,D8,D9,D10"
      && after.missed.join() === "D4,D5,D6,D7,D8,D9"
      && after.questions.find((q) => q.id === "D7").planQuestion === null
      && after.questions.find((q) => q.id === "D10").planQuestion === "build-only"
      && /page-code check found the save path/.test(after.questions.find((q) => q.id === "D10").reason),
    () => after);
  check("questions after approval: answers before the approval are plan questions, and a log with no approval counts nothing",
    () => askedAfter(before).approved === false && askedAfter(before).questions.length === 0
      && askedAfter(`${before}\n## Plan approval\n- Approved by: user\n- Plan version: plan-1\n`).questions.length === 0
      && askedAfter("## Plan approval\n- Approved by:\n## D1 — x\n- Kind: answer\n").approved === false);
  check("questions after approval: the approval is the entry with both `Approved by:` and `Plan version:`, read with or without list markers, as the build gate reads it",
    () => askedAfter("## Plan approval\nApproved by: user\nPlan version: plan-1\n## D1 — x\n- Kind: answer\n").questions.map((q) => q.id).join() === "D1"
      && askedAfter("## D1 — a\n- Kind: answer\n- Approved by: user\n## D2 — b\n- Kind: answer\n").approved === false
      && askedAfter("## D1 — a\n- Approved by: user\n## Note\n- Plan version: plan-1\n## D2 — b\n- Kind: answer\n").questions.length === 0
      && askedAfter("## D1 — a\n- Kind: answer\n## Plan approval\n- Approved by: user\n- Plan version: plan-1").approved === true);
  check("questions after approval: an answer a plan question names is not a build question, wherever the log records it",
    () => questionsAfterApproval(parseDecisionLog(afterText), ["D4", "D10"]).questions.map((q) => q.id).join() === "D5,D6,D7,D8,D9"
      && questionsAfterApproval(parseDecisionLog(afterText), ["D4", "D10"]).missed.join() === "D5,D6,D7,D8,D9");
  check("questions after approval: a `Plan question:` line that is neither value, or `build-only` without its reason, is a provenance problem",
    () => { const issues = provenanceIssues(parseDecisionRecords("## D1 — a\n- Plan question: maybe\n## D2 — b\n- Plan question: build-only\n## D3 — c\n- Plan question: `missed`\n"));
      return issues.length === 2 && /`Plan question: maybe` is not `missed`/.test(issues[0].problem) && issues[0].key === "D1"
        && /needs the reason/.test(issues[1].problem) && issues[1].key === "D2"; },
    () => provenanceIssues(parseDecisionRecords("## D1 — a\n- Plan question: maybe\n## D2 — b\n- Plan question: build-only\n")));
  check("questions after approval: the after-approval log itself carries no provenance problem",
    () => provenanceIssues(parseDecisionRecords(afterText)).length === 0 && Object.keys(provenanceById(parseDecisionRecords(afterText))).length > 0,
    () => provenanceIssues(parseDecisionRecords(afterText)));
  const reportFor = (decisionsText, result = none) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plan-questions-report-"));
    try {
      const tasksDir = path.join(tmp, "build-tasks");
      fs.mkdirSync(tasksDir);
      if (decisionsText !== null) fs.writeFileSync(path.join(tmp, "decisions.md"), decisionsText);
      return renderFinalReport({ result, verifyRes: { rows: [] }, set: { tasks: [], planVersion: result.planVersion }, dir: tasksDir });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  };
  const asPlanAnswer = reportFor(afterText, { ...none, planQuestions: { questions: [{ id: "data-on-open:main", answer: "D4" }], open: [], issues: [] } });
  check("migration result: an answer the plan's questions name, recorded after the approval, is not counted as a build question",
    () => asPlanAnswer.counts.missedPlanQuestions === 5 && /\*\*Missed plan questions: 5 of 6\.\*\*/.test(asPlanAnswer.markdown)
      && !/\| D4 \|/.test(asPlanAnswer.markdown.split("\n## ").find((s) => s.startsWith("Questions after plan approval")) || ""),
    () => asPlanAnswer.markdown.split("\n## ").find((s) => s.startsWith("Questions after")));
  const report = reportFor(afterText);
  const reportSection = report.markdown.split("\n## ").find((s) => s.startsWith("Questions after plan approval")) || "";
  check("migration result: the questions asked after approval are listed with the count of missed plan questions",
    () => report.counts.missedPlanQuestions === 6 && reportSection.startsWith("Questions after plan approval (7)")
      && /\*\*Missed plan questions: 6 of 7\.\*\*/.test(reportSection)
      && /\| D9 \| The dropdown setting is made in UsrBillingBase \| missed \|/.test(reportSection)
      && /\| D7 \| .* \| missed \(no `Plan question:` line\) \|/.test(reportSection)
      && /\| D10 \| .* \| build-only — the page-code check found the save path/.test(reportSection),
    () => reportSection);
  const clean = reportFor(`${before}\n## Plan approval\n- Approved by: user\n- Plan version: plan-1\n`);
  check("migration result: a run whose build asked nothing says so, with a zero count",
    () => clean.counts.missedPlanQuestions === 0 && /## Questions after plan approval \(0\)\n\nNone: the build asked nothing the approved plan had not\./.test(clean.markdown),
    () => clean.markdown.split("\n## ").find((s) => s.startsWith("Questions after")));
  const unapproved = reportFor(before);
  const noLog = reportFor(null);
  check("migration result: without a recorded approval, or without decisions.md, there is no section and no count",
    () => unapproved.counts.missedPlanQuestions === null && !/Questions after plan approval/.test(unapproved.markdown)
      && noLog.counts.missedPlanQuestions === null && !/Questions after plan approval/.test(noLog.markdown));
}

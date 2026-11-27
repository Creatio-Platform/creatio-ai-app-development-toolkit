// QUESTIONS BEFORE APPROVAL — the questions only the person who owns the application can answer and that the build
// will need. Discovery lists them in `manifest.planQuestions` and the plan asks them before it is approved, so the
// build does not stop on a question the analysis could have raised: a behaviour choice on a page, a change outside
// the target package or one that affects the whole object, and a page that writes data when it opens.
//
//   "planQuestions": [
//     { "id": "<stable id>", "kind": "behaviour" | "outside-package" | "object-wide" | "data-on-open",
//       "question": "<the question in product terms>", "pages": ["<pageKey>", …], "answer": "D<N>" }, …
//   ]
//
// `answer` is the `D<N>` of the user's own answer in `decisions.md` (`Kind: answer`, `Decided by: user`, `Quote:`).
// A question with no answer is OPEN, and an open question is a plan gap: the plan is not approvable until it is
// asked and answered.
//
// The engine adds one question by itself: every page that writes data when it opens (`dataWritingPages`) gets
// `data-on-open:<pageKey>`, because a browser check that opens it as a new record changes the stand. The manifest
// answers it with `{ "id": "data-on-open:<pageKey>", "answer": "D<N>" }`; kind and question are the engine's.
import { blank, userDecision, decisionRefProblem, DECISION_ID } from "./directives.mjs";

export const PLAN_QUESTION_KINDS = Object.freeze({
  behaviour: "Behaviour choice",
  "outside-package": "Change outside the target package",
  "object-wide": "Change to the whole object",
  "data-on-open": "Data written when the page opens",
});
export const DATA_ON_OPEN_PREFIX = "data-on-open:";

// The question the engine raises for one page that writes data when it opens. `page` is a `dataWritingPages` entry.
// Stated in product terms: the person answering owns the application, not the pipeline that reads it.
export function dataOnOpenQuestion(page) {
  const always = (page.writes || []).some((w) => !w.addModeOnly);
  const question = always
    ? `Opening ${page.label} changes data on the stand every time, in edit mode too (see "Pages that write data when opened"). May the checks open this page on the stand at all?`
    : `Opening ${page.label} as a new record changes data on the stand (see "Pages that write data when opened"). May the checks open it as a new record, or only open existing records?`;
  return { id: `${DATA_ON_OPEN_PREFIX}${page.pageKey}`, kind: "data-on-open", question, pages: [page.pageKey] };
}

// Every plan question with its answer, and the problems that keep an entry from standing.
//   entries — `manifest.planQuestions` as written (undefined when the manifest has none)
//   derived — the questions the engine raises (`dataOnOpenQuestion` per page)
//   opts    — the plan options: `decisions` (the D<N> Map of decisions.md, or null when none was read),
//             `decisionProvenance` (to tell the user's own answer from the orchestrator's choice) and
//             `decisionsOptional` (a mode that reads no decisions.md: an answer is then taken as written, and an
//             open question is listed but is no gap)
// Returns `{ questions: [{ id, kind, question, pages, answer }], open: [ids], issues: [{ key, problem }] }`.
export function planQuestionsOf({ entries, derived = [], opts = {} } = {}) {
  const issues = [];
  const byId = new Map(derived.map((q) => [q.id, { ...q, answer: null }]));
  const engineIds = new Set(byId.keys());
  const seen = new Set();
  if (entries !== undefined && !Array.isArray(entries)) issues.push({ key: "planQuestions", problem: "must be a list of questions" });
  for (const [i, e] of (Array.isArray(entries) ? entries : []).entries()) {
    const key = e && typeof e === "object" && !blank(e.id) ? e.id.trim() : `planQuestions[${i}]`;
    const problems = entryProblems(e, key, engineIds.has(key), seen);
    seen.add(key);
    if (problems.length) { issues.push(...problems.map((problem) => ({ key, problem }))); continue; }
    byId.set(key, mergedQuestion(key, e, byId.get(key)));
  }
  const questions = [...byId.values()];
  for (const q of questions) {
    const problem = q.answer && answerProblem(q.answer, opts);
    if (problem) issues.push({ key: q.id, problem });
  }
  // A question whose entry cannot stand is reported once, as that problem, never also as open.
  const invalid = new Set(issues.map((x) => x.key));
  const open = opts.decisionsOptional ? [] : questions.filter((q) => !q.answer && !invalid.has(q.id)).map((q) => q.id);
  return { questions, open, issues };
}
// One manifest entry as a question: the engine's own question (`base`) keeps its kind, text and pages, and the
// entry adds its answer.
function mergedQuestion(key, e, base) {
  return {
    id: key,
    kind: base?.kind || e.kind,
    question: base?.question || e.question.trim(),
    pages: base?.pages || (e.pages || []).filter((p) => !blank(p)).map((p) => p.trim()),
    answer: blank(e.answer) ? null : e.answer.trim(),
  };
}
function entryProblems(e, key, engineRaised, seen) {
  if (!e || typeof e !== "object" || Array.isArray(e)) return ["must be an object with an `id`"];
  if (blank(e.id)) return ["needs an `id`"];
  if (seen.has(key)) return ["is listed twice — keep one entry per question"];
  if (key.startsWith(DATA_ON_OPEN_PREFIX) && !engineRaised) {
    return [`names \`${key.slice(DATA_ON_OPEN_PREFIX.length)}\`, which is no page that writes data when opened — the engine raises this question itself, for each such page`];
  }
  const out = [];
  if (!blank(e.answer) && !DECISION_ID.test(e.answer.trim())) out.push(`\`answer\` must be a D<N> recorded in decisions.md (got \`${e.answer}\`)`);
  if (e.pages !== undefined && !Array.isArray(e.pages)) out.push("`pages` must be a list of page keys");
  if (engineRaised) return out;
  if (!Object.hasOwn(PLAN_QUESTION_KINDS, e.kind)) {
    out.push(`\`kind\` must be one of ${Object.keys(PLAN_QUESTION_KINDS).map((k) => "`" + k + "`").join(", ")} (got \`${e.kind ?? "(none)"}\`)`);
  }
  if (blank(e.question)) out.push("needs `question` — what the user is asked, in product terms");
  return out;
}
function answerProblem(answer, opts) {
  const ref = decisionRefProblem(answer, opts);
  if (ref) return `\`${answer}\` ${ref}`;
  if (opts.decisions && !userDecision(opts.decisionProvenance, answer)) {
    return `\`${answer}\` is not the user's own answer — record it with \`Kind: answer\`, \`Decided by: user\` and the \`Quote:\` of their words`;
  }
  return null;
}

// The D<N> answers `manifest.planQuestions` names: an answer accounts for its decisions.md entry the way a
// deliverable status does, since the plan shows the question it answers.
export const planQuestionAnswers = (entries) => (Array.isArray(entries) ? entries : [])
  .map((e) => (typeof e?.answer === "string" ? e.answer.trim() : "")).filter((d) => DECISION_ID.test(d));

// `manifest.planQuestions` as the plan version hashes it: the questions without their answers, and undefined when
// nothing but answers is left. An answer is the user's reply, given before the approval, and an entry that only
// answers the engine's own question (`{ id, answer }`) adds no question; a question added, removed or reworded
// changes the plan.
export function withoutAnswers(entries) {
  if (!Array.isArray(entries)) return entries;
  const asked = entries
    .map((e) => (e && typeof e === "object" && !Array.isArray(e) ? Object.fromEntries(Object.entries(e).filter(([k]) => k !== "answer")) : e))
    .filter((e) => !(e && typeof e === "object" && !Array.isArray(e) && Object.keys(e).every((k) => k === "id")));
  return asked.length ? asked : undefined;
}

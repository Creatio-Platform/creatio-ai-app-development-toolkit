// USER DIRECTIVES AND DECISION PROVENANCE, read off `decisions.md`.
//
// A `## D<N> — <title>` entry may carry provenance lines under its heading:
//
//   - Kind: directive | answer
//   - Decided by: user | orchestrator
//   - Quote: "<the user's words, verbatim, in the user's language>"
//   - Asked: <the question the answer replies to>
//   - Scope: run | <pageKey>[, <pageKey>…]
//   - Expectation: <one statement a judge can check on the built page>
//
// A `directive` is an instruction the user gave without being asked ("use the Summaries component"). An `answer`
// is the user's reply to a question the orchestrator asked, including a reply outside the offered options. Both
// are the user's words, so both carry the quote: a paraphrase is where an instruction gets lost or widened, and
// the quote is what a judge compares the paraphrase against.
//
// An entry with none of these lines is a plain decision and is read exactly as before — the file stays one
// append-only log, and an old file parses unchanged. The engine turns each directive into a pair of evidence rows
// on every page its scope names (see `directiveRows` in designspec.mjs): the builder files how it followed the
// directive, and an independent judge rules on that record against the built page.
import fs from "node:fs";
import path from "node:path";

const KIND_DIRECTIVE = "directive";
const KIND_ANSWER = "answer";
const KINDS = new Set([KIND_DIRECTIVE, KIND_ANSWER]);
const DECIDED_BY_USER = "user";
const DECIDED_BY_ORCHESTRATOR = "orchestrator";
const DECIDERS = new Set([DECIDED_BY_USER, DECIDED_BY_ORCHESTRATOR]);
// A directive scoped to the whole run applies to every page the plan publishes.
export const RUN_SCOPE = "run";
// What a builder's record must name for a directive row to count as filed: how the directive was followed, and the
// components on the page that carry it. Both are prose a judge can check against the page, never a bare "done".
export const DIRECTIVE_REQUIRES = ["howFollowed", "components"];

// A directive's two rows on a page: `directive:D<N>:filed` (the builder's record) and `directive:D<N>:judged` (the
// review's verdict). The deliverable id is the one field a task row keeps from the plan row, so it is how the cut
// routes the filed row and how the unaccounted-decisions gate finds the decision a row carries.
export const DIRECTIVE_FILED = "filed";
export const DIRECTIVE_JUDGED = "judged";
export const directiveRowId = (id, part) => `directive:${id}:${part}`;
const DIRECTIVE_ROW_ID = /^directive:(D\d+):(\w+)$/;
// `{ id, part }` for a directive row's deliverable id, else null.
export function parseDirectiveRowId(deliverableId) {
  const m = DIRECTIVE_ROW_ID.exec(deliverableId || "");
  return m ? { id: m[1], part: m[2] } : null;
}

// The provenance field each label maps to. Labels are matched case-insensitively, so `Decided By:` and
// `decided by:` are the same field; any other `- Label:` line under the heading (Decision, Rationale, Approved by,
// Plan version, Affects) is the entry's own prose and is not read here.
const FIELD_OF = new Map([
  ["kind", "kind"],
  ["decided by", "decidedBy"],
  ["quote", "quote"],
  ["asked", "asked"],
  ["scope", "scope"],
  ["expectation", "expectation"],
]);
// The `## D<N> — <title>` heading grammar, shared with the decision-title reader in report.mjs so both read the same
// entries and the same titles.
export const DECISION_HEADING = /^#{1,4}\s+D(\d+)\b(.*)$/;
const ANY_HEADING = /^#{1,4}\s/;
// A field label: letters and spaces, starting with a letter.
const LABEL = /^[A-Za-z][A-Za-z ]*$/;
// `- Quote: …`, `* Quote: …`, `- **Quote:** …` and `- **Quote**: …` are one field: `{ label, value }`, or null for
// any other line. Split at the first colon by hand rather than by one regex over the whole line, so a long line
// costs one pass.
function fieldLine(line) {
  const s = line.trimStart();
  if (!(s.startsWith("- ") || s.startsWith("* "))) return null;
  const body = s.slice(2).trimStart();
  const colon = body.indexOf(":");
  if (colon < 0) return null;
  const label = body.slice(0, colon).replaceAll("**", "").trim();
  if (!LABEL.test(label)) return null;
  let value = body.slice(colon + 1);
  if (value.startsWith("**")) value = value.slice(2);
  return { label, value: value.trim() };
}
// The pair of quote marks a person types around a quotation is not part of it. Only ONE wrapping pair is removed,
// so a quotation that itself ends in a quoted word keeps its inner marks.
const CLOSING_MARKS = new Map([['"', '"'], ["'", "'"], ["“", "”"], ["„", "“”"], ["«", "»"], ["‘", "’"]]);
function unwrapQuote(v) {
  const closing = CLOSING_MARKS.get(v[0]);
  return v.length >= 2 && closing?.includes(v.at(-1)) ? v.slice(1, -1).trim() : v;
}
function stripTicks(s) {
  let from = 0;
  let to = s.length;
  while (from < to && s[from] === "`") from++;
  while (to > from && s[to - 1] === "`") to--;
  return s.slice(from, to).trim();
}
function cleanValue(field, raw) {
  const v = String(raw || "").trim();
  if (field === "quote") return unwrapQuote(v);
  if (field === "kind" || field === "decidedBy") return stripTicks(v).toLowerCase();
  return v;
}
// A heading's title: the text after `D<N>`, with the separator that follows the id stripped.
export function headingTitle(raw) {
  return String(raw || "").replace(/^[\s—–:.-]+/, "").trim();
}

// Every `## D<N>` heading entry as `{ id, title, fields }`, in file order. A later heading for the same id
// replaces the earlier one, the way the decision titles are read. Only heading entries carry provenance: a table
// row or a plain line has no place for the field lines.
export function parseDecisionRecords(text) {
  const byId = new Map();
  let cur = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    const h = DECISION_HEADING.exec(line);
    if (h) {
      cur = { id: `D${h[1]}`, title: headingTitle(h[2]), fields: {} };
      byId.delete(cur.id);
      byId.set(cur.id, cur);
      continue;
    }
    if (ANY_HEADING.test(line)) { cur = null; continue; }
    if (!cur) continue;
    const f = fieldLine(line);
    const field = f && FIELD_OF.get(f.label.toLowerCase());
    if (field && !(field in cur.fields)) cur.fields[field] = cleanValue(field, f.value);
  }
  return [...byId.values()];
}

// The records of `<migrationDir>/decisions.md`; none when the file is absent. Any other read failure is thrown: a
// decisions.md that exists but cannot be read would otherwise drop every directive in it without a word.
export function readDecisionRecords(migrationDir) {
  let text;
  try {
    text = fs.readFileSync(path.join(migrationDir, "decisions.md"), "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return [];
    throw e;
  }
  return parseDecisionRecords(text);
}

// `Scope: main, typed:Product` → ["main", "typed:Product"]. Commas separate keys; backticks around a key are
// formatting.
export function scopeKeys(scope) {
  return String(scope || "").split(",").map(stripTicks).filter(Boolean);
}

// The directives the plan builds from, shaped for the planner: `Kind: directive` entries with an expectation and a
// scope. An incomplete one is left out here and named by `provenanceIssues` instead — a row asking a builder to meet
// an unstated expectation could never be judged.
export function directivesOf(records) {
  return (records || [])
    .filter((r) => r.fields?.kind === KIND_DIRECTIVE && !blank(r.fields.expectation) && scopeKeys(r.fields.scope).length)
    .map((r) => ({
      id: r.id,
      title: r.title,
      quote: r.fields.quote || "",
      expectation: r.fields.expectation,
      scope: scopeKeys(r.fields.scope),
    }));
}

// Does `directive` apply to the page published under `pageKey`?
export const directiveCovers = (directive, pageKey) =>
  directive.scope.includes(RUN_SCOPE) || directive.scope.includes(pageKey);

// The entries the orchestrator decided on its own. The final report lists them, so the user sees every choice
// that was made without asking them.
export function orchestratorDecisions(records) {
  return (records || []).filter((r) => r.fields?.decidedBy === DECIDED_BY_ORCHESTRATOR)
    .map((r) => ({ id: r.id, title: r.title }));
}

const blank = (v) => typeof v !== "string" || v.trim() === "";
// Does the entry use the provenance format at all? An older entry may carry a free-text `Decided by:` (a person's
// name) and nothing else; it is a plain decision, and its value is not checked against `user` / `orchestrator`.
const usesProvenance = (f) => ["kind", "quote", "asked", "scope", "expectation"].some((k) => !blank(f[k]));
function fieldIssues(r) {
  const f = r.fields;
  const out = [];
  if (!blank(f.kind) && !KINDS.has(f.kind)) out.push(`\`Kind: ${f.kind}\` is not one of \`${KIND_DIRECTIVE}\` / \`${KIND_ANSWER}\``);
  if (usesProvenance(f) && !blank(f.decidedBy) && !DECIDERS.has(f.decidedBy)) {
    out.push(`\`Decided by: ${f.decidedBy}\` is not one of \`${DECIDED_BY_USER}\` / \`${DECIDED_BY_ORCHESTRATOR}\``);
  }
  return out;
}
// A directive and an answer are the user's own words, so neither can be recorded as the orchestrator's.
function userWordsIssues(r) {
  const f = r.fields;
  const out = [];
  const userKind = f.kind === KIND_DIRECTIVE || f.kind === KIND_ANSWER;
  if (userKind && f.decidedBy !== DECIDED_BY_USER) {
    out.push(`a \`${f.kind}\` is the user's own words, so it needs \`Decided by: ${DECIDED_BY_USER}\`; record a choice you made yourself as its own entry with \`Decided by: ${DECIDED_BY_ORCHESTRATOR}\``);
  }
  if ((userKind || f.decidedBy === DECIDED_BY_USER) && blank(f.quote)) {
    out.push(`\`Decided by: ${DECIDED_BY_USER}\` needs \`Quote:\` — the user's words verbatim, in their language; a decision the user did not state in words is the orchestrator's`);
  }
  if (f.kind === KIND_ANSWER && blank(f.asked)) out.push("an `answer` needs `Asked:` — the question it replies to");
  return out;
}
function directiveIssues(r, pageKeys) {
  const f = r.fields;
  if (f.kind !== KIND_DIRECTIVE) return [];
  const out = [];
  if (blank(f.expectation)) out.push("a `directive` needs `Expectation:` — one statement a judge can check on the built page");
  const keys = scopeKeys(f.scope);
  if (!keys.length) {
    out.push(`a \`directive\` needs \`Scope:\` — \`${RUN_SCOPE}\` or the page key(s) it applies to`);
  } else if (Array.isArray(pageKeys)) {
    const published = new Set(pageKeys);
    const unknown = keys.filter((k) => k !== RUN_SCOPE && !published.has(k));
    if (unknown.length) {
      out.push(`\`Scope:\` names ${unknown.map((k) => "`" + k + "`").join(", ")}, which this plan publishes no page under`
        + ` (published: ${pageKeys.map((k) => "`" + k + "`").join(", ") || "none"}) — a directive no page carries reaches no builder`);
    }
  }
  return out;
}

// Every provenance problem as `{ key, problem }`, keyed by the entry's D<N>. `pageKeys` is the list of page keys
// the plan publishes; without it a directive's scope is checked for presence only.
export function provenanceIssues(records, pageKeys = null) {
  return (records || []).flatMap((r) => [...fieldIssues(r), ...userWordsIssues(r), ...directiveIssues(r, pageKeys)]
    .map((problem) => ({ key: r.id, problem })));
}

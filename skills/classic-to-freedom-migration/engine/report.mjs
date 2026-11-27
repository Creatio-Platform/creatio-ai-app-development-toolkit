// THE MIGRATION RESULT REPORT — the ONE artifact an orchestrated run closes on.
//
// Before this module the run ended on two files that disagreed. `--verify` printed the plan-vs-built table and a
// verdict computed from its machine rows alone ("2 machine row(s) not confirmed"); `build-tasks/index.md` — the
// ledger the sub-agents actually wrote — said 10 done, 5 open, 3 partial, three handlers recorded NOT BUILT because
// they need a decision. The agent presented the first and the user read a nearly-green run. Measured on the
// Applicants migration, 2026-09-17.
//
// So the report is computed from BOTH sources and its verdict is the conjunction: a run is COMPLETE only when
// every task is closed, no plan item stands recorded as not built without a recorded decision, no boundary was
// asserted without one, and every machine-checked item is present. Anything short of that is NOT COMPLETE, and the
// first thing the reader sees is the reason, in the order a person has to act on them.
//
// WRITTEN FOR THE PERSON WHO OWNS THE MIGRATION, not for the engine. Reviewed line by line with that reader
// (2026-09-17), which fixed the vocabulary and the shape:
//   · "plan item", never "deliverable" — the plan the user approved never used that word;
//   · a page is named by its Freedom schema (`UsrApplicantsFreedom_FormPage`), never by the engine's key (`main`);
//   · a `needs-decision` row states WHICH decision is needed, read from a marker the build agent writes;
//   · a boundary the agent closed with a recorded decision (`D<N>`, `Adjustment N`) is information; one closed
//     without is the only thing that needs an answer;
//   · the ledger table says WHO confirmed each plan item per task (on the built page / by review / nobody yet — manually);
//   · the dispatch gate is the engine's own safeguard and is not reported here at all — the reader does not care
//     which context closed a task; the engine still fails the run over it on stderr;
//   · the engine's own preparation task (the reference cache) is not a plan task and is not listed.
//
// Pure rendering: reads the run result, the verify result, the merged task set and (read-only) the migration
// folder's decisions.md / plan.md; writes nothing.
import fs from "node:fs";
import path from "node:path";
import { esc, planGaps, dataWritingPages } from "./designspec.mjs";
import { readDecisionRecords, orchestratorDecisions, DECISION_HEADING, headingTitle } from "./directives.mjs";
import { unreadableLedger, notBuiltOpenItems, assertedBoundaryRows, statusMark, ARTIFACT_REFS, notesMarker, notesMarkers, writesPage, readWorklogBrowserAnswer, browserAnswerOf,
  worklogFieldValues, addModeChecks, STAND_DATA_FIELD, STAND_DATA_MARKER,
  S_DONE, S_NOT_APPLICABLE, S_WONT_DO, S_POSTPONED, S_PARTIAL, S_IN_PROGRESS, S_TODO, S_BLOCKED, REFUSED_UNREADABLE,
  O_BUILT, O_NOT_BUILT, O_NOT_APPLICABLE, O_WONT_DO, O_POSTPONED } from "./tasks.mjs";

const brief = (s, n = 110) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cell = (s) => esc(String(s ?? ""));
// The same label rendered from the plan and read back from a task file can differ in the backtick the renderer
// escapes to (` vs ˋ) and in whitespace — nothing else. Normalised once so rows join across the two sources.
const labelKey = (s) => String(s || "").replaceAll("ˋ", "`").replace(/\s+/g, " ").trim();

// --- the markers a build agent writes under `## Notes` --------------------------------------------------------
// `Decision needed (row N): <question + options>` on a `not-built — needs-decision` row, and
// `Check on stand (row N): <what to open → what is expected>` on a row only a person can confirm. Both are one
// line; both are read verbatim. The FALLBACK is honest, not clever: the sentence(s) of the row's own notes block
// that talk about a decision, trimmed — and when there is nothing to find, the report says the agent did not
// state the question, which is itself the finding.
export const DECISION_MARKER = notesMarker("Decision needed");
export const CHECK_MARKER = notesMarker("Check on stand");
// The FIRST line of each row: the report quotes one sentence per row.
const markers = (notes, re) => new Map([...notesMarkers(notes, re)].map(([n, values]) => [n, values[0]]));
// `Browser checks: N — <what each check answered>`, the line every page-writing task writes under `## Notes`. The
// number decides the verdict; the prose is not judged, only quoted beside each exercised page in the result report,
// so a person reads what the builder says each check answered instead of trusting a typed number. null when the
// task wrote no such line, which the verdict counts as 0. Only a FIELD line counts: one that opens with the label,
// as plain text or a list item. A quoted line (`>`), a line inside a code fence and a mention mid-sentence or in
// inline code are prose about the line, such as the brief's own example, and never set the count. Of the field
// lines the LAST wins, so a builder corrects its count by writing the line again.
const BROWSER_CHECKS = /^[\s*-]*Browser checks[\s:*]*(\d+)/i;
// `Page saved: no` — the task saved nothing to its page's body (it recorded outcomes, read the stand, or changed a
// client module only), so the page stands as the previous save left it. Read like the count: a field line, the
// last one wins.
const PAGE_SAVED = /^[\s*-]*Page saved[\s:*]*(yes|no)\b/i;
const FENCE = /^\s*(`{3,}|~{3,})/;
// The LAST field line of `notes` matching `re` outside a fenced block, as `{ m, line }`; null when none does.
function lastNotesLine(notes, re) {
  let found = null;
  let fence = null;
  for (const line of String(notes || "").split(/\r?\n/)) {
    const f = FENCE.exec(line);
    if (f) {
      if (!fence) fence = f[1];
      else if (f[1].startsWith(fence)) fence = null;
      continue;
    }
    const m = fence ? null : re.exec(line);
    if (m) found = { m, line };
  }
  return found;
}
function browserChecksLine(notes) {
  const found = lastNotesLine(notes, BROWSER_CHECKS);
  if (!found) return null;
  return { n: Number(found.m[1]), text: found.line.slice(found.m[0].length).trim().replace(/^[—–-]+/, "").trim() };
}
export const browserChecksOf = (notes) => browserChecksLine(notes)?.n ?? null;
// Whether the task saved its page's body. Only an explicit `Page saved: no` says it did not: a task that does not
// say so is taken to have saved, so a missing line can only ask for a check, never excuse one.
export const savedPage = (notes) => lastNotesLine(notes, PAGE_SAVED)?.m[1].toLowerCase() !== "no";
// The cap a task's browser checks are held to: the second only confirms a fix the first one found.
const BROWSER_CHECK_CAP = 2;
// A task that saved something on its page: closed `done`, or `partial` with part of it built. One closed
// `wont-do` / `not-applicable` saved nothing, and a `postponed` one has not built yet, so neither owes a check.
const BUILT_STATUSES = new Set([S_DONE, S_PARTIAL]);
// WHICH BUILT PAGES A BROWSER CHECK EXERCISED. A page is the artifact its page-writing tasks write; it is exercised
// when a check was made after its LAST SAVE — the last of those tasks, in queue order, that built something and
// saved the page body: a page cut into chunks or repaired later is opened as it finally stands, not as an earlier
// chunk left it. A later task that saved nothing (`Page saved: no`) leaves the page as that save left it, so the
// check made after the save still stands, and a check the later task made itself counts too. A run can be complete and still have pages
// nobody opened after their last save, and those pages are what a person has to check by hand. Under
// `Browser: none` the user declined the check for the run, so no built page counts as exercised whatever its notes
// say. A page the recorded tool cannot open (a list page under `Browser: page-smoke` with no browser surface) is
// unexercised too, on purpose: nobody saw it run, so a person still has to open it; the section quotes the builder's
// reason, which tells that case apart from a check nobody ran. `tasks` arrive in queue order (`planTasks`).
function browserExercise(tasks, declined = false) {
  const pages = new Map();
  const capBreaches = [];
  for (const t of tasks) {
    if (!writesPage(t.writesTo) || !BUILT_STATUSES.has(t.status)) continue;
    const line = browserChecksLine(t.notes);
    const n = line?.n ?? 0;
    if (n > BROWSER_CHECK_CAP) capBreaches.push({ task: t, n });
    const page = pages.get(t.writesTo) || { writesTo: t.writesTo, pageKey: t.pageKey, exercised: false, tasks: [] };
    // A save starts the page over; a task that saved nothing can only add a check to the page as it stands. The
    // page's first task always speaks for it, saved or not, so its evidence is never empty.
    const firstTask = !page.evidence;
    const addsCheck = n > 0 && !page.exercised;
    if (savedPage(t.notes) || firstTask || addsCheck) {
      page.exercised = n > 0 && !declined;
      page.evidence = { task: t, n, text: line?.text || "", reported: !!line };
    }
    page.tasks.push(t);
    pages.set(t.writesTo, page);
  }
  const all = [...pages.values()];
  return { exercised: all.filter((p) => p.exercised), unexercised: all.filter((p) => !p.exercised), capBreaches };
}
// BUILT, NOT EXERCISED on stderr, so a caller reading stderr alone learns which pages still need a person; "" for
// any other verdict. It is a note, not an exit-2 leg: every task closed and every built row checks out, so the exit
// code keeps its meaning (open work for the machine), and the unchecked pages are work for a person, as 🟠 says.
export function unexercisedNote(report) {
  if (!report?.complete || !report.unexercisedPages?.length) return "";
  return `migrate.mjs: 🟠 BUILT, NOT EXERCISED — no browser check after the last save of ${report.unexercisedPages.join(", ")}.`
    + " Check them on the stand; the migration result report lists what to check.\n";
}
// The browser answer could not be read on stderr, so a caller reading stderr alone learns the browser verdict was
// reached without it; "" when the answer file was read.
export function browserAnswerUnreadNote(report) {
  if (!report?.browserAnswerUnread) return "";
  return `migrate.mjs: ⚠ BROWSER ANSWER NOT READ — ${report.browserAnswerUnread}, so the browser verdict was reached`
    + " without the recorded answer. Run --verify with the task folder inside its migration folder.\n";
}
// `answer` is `{ line, unread }` from `readWorklogBrowserAnswer`: the recorded `Browser:` line, and why worklog.md could
// not be read. An unread answer is said first, whatever the pages show: without it a recorded `Browser: none` cannot
// be applied, so a page with a reported check counts as exercised and the verdict may be greener than the answer.
function browserSection({ exercised, unexercised, capBreaches }, pageName, answer) {
  const blocks = [answer.unread ? answerUnreadLines(answer.unread) : [],
    unexercised.length ? unexercisedLines(unexercised, pageName, answer) : [],
    exercised.length ? exercisedLines(exercised, pageName) : [], capBreaches.length ? capBreachLines(capBreaches) : []];
  return blocks.filter((b) => b.length).flatMap((b, i) => (i ? ["", ...b] : b));
}
const answerUnreadLines = (unread) => ["## Browser answer not read", "",
  `The browser answer for this run could not be read: ${unread}. A recorded \`Browser: none\` is therefore not`
    + " applied, and each page below counts as exercised on its own task's notes alone. Run `--verify` with the task"
    + " folder inside the migration folder that holds its `worklog.md`."];
// What each exercised page's last built task says its checks answered, quoted as written: the verdict counts the
// number, and this is the prose a person reads to see whether the number stands for a real check.
function exercisedLines(exercised, pageName) {
  return [`## Exercised in a browser (${exercised.length})`, "",
    "The last build task of each page reports these browser checks after its last save. The count decides the"
      + " verdict; the words are the build agent's own account of what each check answered.", "",
    ...exercised.map(({ writesTo, pageKey, evidence: { task: t, n, text } }) =>
      `- **${pageName(pageKey)}** (\`${esc(writesTo)}\`) — [${cell(t.group || t.id)}](${enc(t.file)}), ${plural(n, "check")}: `
        + (text ? cell(text) : "no account of what the checks answered"))];
}
// Under `Browser: none` the intro says the user declined the check, because a page whose task did report one is
// listed here too and "no build task opened them" would be false for it.
function unexercisedLines(unexercised, pageName, { line, unread }) {
  const noAnswer = unread ? "`worklog.md` could not be read" : "`worklog.md` has no `Browser:` line";
  const recorded = line ? `\`${esc(line)}\`` : `none — ${noAnswer}`;
  const intro = browserAnswerOf(line) === "none"
    ? "The user declined the browser check for this run, so no built page counts as exercised, including any a build"
      + " task did report a check for: a declined run is a conscious opt-out, and a person opens each page on the"
      + " stand and goes through its checks below. Each page names its last build task and quotes what it reported."
    : "These pages were built and read back, but no build task opened them after its last save, so what only the"
      + " running page shows — a render error, a rule that does not fire, a save that writes the wrong column — is"
      + " unchecked. Open each one on the stand and go through its checks below. Each page names its last build task"
      + " and quotes why it reports no check: a refused or impossible check wants the consent or the tool fixed first.";
  const L = [`## Not exercised in a browser (${unexercised.length})`, "", intro,
    "", `Browser answer recorded for this run: ${recorded}.`, ""];
  for (const p of unexercised) {
    L.push(`- **${pageName(p.pageKey)}** (\`${esc(p.writesTo)}\`) — ${unexercisedReason(p.evidence)}`);
    for (const t of p.tasks) L.push(...checkOnStandLines(t));
  }
  return L;
}
// Why the page's last built task opened nothing, in the builder's words: a refused or impossible check wants the
// consent or the tool fixed, a check nobody ran wants the page opened, and a missing line says nothing either way.
function unexercisedReason({ task: t, n, text, reported }) {
  const where = `[${cell(t.group || t.id)}](${enc(t.file)})`;
  if (!reported) return `${where} wrote no \`Browser checks\` line`;
  return `${where}, \`Browser checks: ${n}\`: ${text ? cell(text) : "no account of why"}`;
}
const checkOnStandLines = (t) => [...markers(t.notes, CHECK_MARKER)]
  .map(([n, text]) => `  - [${cell(t.group || t.id)}](${enc(t.file)}), row ${n}: ${cell(text)}`);
function capBreachLines(capBreaches) {
  return [`## Browser checks over the cap of ${BROWSER_CHECK_CAP} (${capBreaches.length})`, "",
    "A task opens the page once after its last save and once more only to confirm a fix; a third check is a"
      + " save-check-fix loop. Read these tasks' notes for what each check answered.", "",
    ...capBreaches.map((b) => `- [${cell(b.task.group || b.task.id)}](${enc(b.task.file)}) \`${esc(b.task.id)}\`: ${b.n} checks`)];
}
// STAND DATA THE RUN CHANGED. A browser check is not read-only on every page: a page that assigns the
// next number when it opens consumes a counter, and a `click` that saves creates a record. A builder records each
// change as the `Stand data changed (row N):` marker of its `## Notes`, the orchestrator as a `Stand data changed:`
// line of `worklog.md`, beside the `Add-mode check:` lines of the consent it recorded. Every reader of those lines is
// in tasks.mjs, beside the one that writes the task files that teach them, so the two cannot drift apart.
// Nothing for a run with no data-writing page and no recorded change, so an ordinary report reads as before.
// `worklog` is the text `readWorklogBrowserAnswer` already read, so the file is read once per report.
// A marker value without the bold that closed its line (`**Stand data changed (row 4): x**`), stripped by a loop:
// a `\*+$` pattern backtracks on a long run of stars.
function withoutClosingBold(value) {
  let s = value.trimEnd();
  while (s.endsWith("*")) s = s.slice(0, -1).trimEnd();
  return s;
}
function standDataSection(result, tasks, { text: worklog = "", unread = null }, pageName) {
  const changes = [...worklogFieldValues(worklog, STAND_DATA_FIELD).map((text) => ({ text, where: "`worklog.md`" })),
    ...tasks.flatMap((t) => [...notesMarkers(t.notes, STAND_DATA_MARKER)].flatMap(([n, values]) => values.map((v) => ({
      text: withoutClosingBold(v), where: `[${cell(t.group || t.id)}](${enc(t.file)}), row ${n}` }))))];
  const pages = dataWritingPages(result);
  const { agreed, unknown } = addModeChecks(worklog, pages);
  if (!changes.length && !pages.length) return [];
  const L = [`## Stand data this run changed (${changes.length})`, ""];
  if (changes.length) L.push(...changes.map((c) => `- ${cell(c.text)} — ${c.where}`));
  if (unread) L.push(`\`worklog.md\` was not read (${cell(unread)}), so the changes recorded there are not listed; only the task notes were read.`);
  else if (!changes.length) L.push("No change to stand data was recorded by this run.");
  if (pages.length) {
    const one = pages.length === 1;
    L.push("", `The plan named ${plural(pages.length, "page")} that write${one ? "s" : ""} data when opened, so ${one ? "it was" : "they were"}`
      + " to be opened only in edit mode on an existing record: " + pages.map((p) => `**${pageName(p.pageKey)}**`).join(", ") + ".",
    agreed.size ? `Add-mode checks the user agreed to: ${[...agreed.values()].map(cell).join("; ")}.`
      : "No add-mode check was agreed, so none of them should have consumed data; a change listed above on one of them is a check that broke that rule.");
    if (unknown.length) L.push(`Not counted as consent — an \`Add-mode check:\` line that names no page key of the plan's list: ${unknown.map(cell).join("; ")}.`);
  }
  return L;
}
// The block of `## Notes` that is ABOUT row N: from a heading / bold line naming the row ("## 2 — Handler", "### Row 9",
// "**Row 6 —") to the next such line. Heuristic on purpose — agents format their notes freely — and used only as a
// fallback behind the marker above.
function rowNotesBlock(notes, n) {
  const lines = String(notes || "").split(/\r?\n/);
  const isRowHead = (l, k) => new RegExp(String.raw`^(#{2,4}\s+|\*\*)\s*(Rows?\s+)?${k}\b`, "i").test(l) || new RegExp(String.raw`^#{2,4}\s+.*\bRow ${k}\b`, "i").test(l);
  const anyHead = (l) => /^(#{2,4}\s+|\*\*Row)/.test(l);
  const start = lines.findIndex((l) => isRowHead(l, n));
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex(anyHead);
  return rest.slice(0, end < 0 ? rest.length : end).join("\n");
}
// Markdown emphasis and list bullets stripped: the fallback is quoted into a table cell, where `**` fragments
// and `- ` prefixes read as noise. Code spans are kept (they name the members the decision is about).
const plainText = (s) => String(s || "").replaceAll("*", "").replaceAll("__", "").replace(/^[>\s-]+/gm, "").replace(/\s+/g, " ").trim();
function decisionFallback(notes, n) {
  const block = rowNotesBlock(notes, n);
  const sentences = plainText(block).split(/(?<=[.!?])\s+/);
  const hits = sentences.filter((s) => /\b(decision|options?|either|needs (a person|your call)|choose|the user decides|what .* needs from me)\b/i.test(s));
  return hits.length ? brief(hits.slice(0, 2).join(" "), 260) : "";
}

// --- decisions.md / plan.md Adjustments: what a reason's `D<N>` / `Adjustment N` points at --------------------
// A decision title from whatever cell/line carried it: prefer a bold lead (`**Section boundary — …**`), else the
// text up to its first sentence; markdown emphasis and leading separators stripped, capped so a whole table cell
// does not become the title.
function decisionTitle(raw) {
  let t = String(raw || "").trim();
  const bold = /\*\*(.+?)\*\*/.exec(t);
  if (bold) t = bold[1];
  t = t.replaceAll("**", "").replaceAll("`", "").replace(/^[\s—–:.|-]+/, "").replace(/\s+/g, " ").trim();
  const dot = t.search(/\.(\s|$)/);
  if (dot >= 15) t = t.slice(0, dot);
  return t.trim().slice(0, 120).trim();
}
// `references/migration-documentation.md` sanctions three shapes. STRUCTURED decisions — a markdown HEADING
// (`## D1 — …`) or a TABLE ROW (`| D1 | **title** | … |`) — are authoritative and read first; a plain dated line
// (`D1 — …` / `D1: …`) is read ONLY when the file carries no structured decisions, so a prose line like
// `D2 — still waiting` inside a heading/table file cannot register a decision. Extracted so readDecisions stays
// under Sonar's cognitive-complexity ceiling.
function readDecisionsMd(text, addHeading, add) {
  const lines = text.split(/\r?\n/);
  let structured = false;
  for (const dl of lines) {
    const h = DECISION_HEADING.exec(dl);
    if (h) { addHeading(h[1], h[2]); structured = true; continue; }
    const t = /^\s*\|\s*D(\d+)\s*\|([^|]*)\|/.exec(dl);   // table row — second cell is the title ([^|] can't cross the cell)
    if (t) { add(t[1], t[2]); structured = true; }
  }
  if (!structured) for (const dl of lines) {
    const p = /^\s*D(\d+)[)\s—–:.-]+([^)\s—–:.-].*)$/.exec(dl);   // one separator run, then capture from the first real char
    if (p) add(p[1], p[2]);
  }
}
export function readDecisions(migrationDir) {
  const out = new Map();
  // A heading keeps its title verbatim (bar the leading separator); a table cell / plain line goes through
  // decisionTitle, which lifts the bold lead and caps a long cell. Headings are last-wins (a later heading refines
  // an earlier one); table/plain are first-wins.
  const addHeading = (id, raw) => { const t = headingTitle(raw); if (t) out.set(`D${id}`, t); };
  const add = (id, raw) => { const k = `D${id}`; const t = decisionTitle(raw); if (t && !out.has(k)) out.set(k, t); };
  try {
    readDecisionsMd(fs.readFileSync(path.join(migrationDir, "decisions.md"), "utf8"), addHeading, add);
  } catch { /* no decisions file — every reference is then "not found", which the report says */ }
  try {
    const plan = fs.readFileSync(path.join(migrationDir, "plan.md"), "utf8");
    const at = plan.search(/^###\s+Adjustments/m);
    if (at >= 0) for (const m of plan.slice(at).matchAll(/^(\d+)\.\s+\*\*(.+?)\*\*/gm)) out.set(`Adjustment ${m[1]}`, m[2].trim());
  } catch { /* same */ }
  return out;
}
// THE TEXT under each decision, keyed like `readDecisions`: the lines below a `D<N>` heading up to the next heading,
// and the lines of a numbered `### Adjustments` item up to the next item. A table or plain-line decision has only
// its title, so it has no entry here. The task card hands this text to a writer that is told not to read the files.
export function readDecisionTexts(migrationDir) {
  const out = new Map();
  const collect = (lines, startOf, isEnd) => {
    let id = null, body = [];
    const flush = () => { if (id && body.some((l) => l.trim())) out.set(id, body.join("\n").trim()); };
    for (const line of lines) {
      const start = startOf(line);
      if (start) { flush(); id = start; body = []; continue; }
      if (isEnd(line)) { flush(); id = null; body = []; continue; }
      if (id) body.push(line);
    }
    flush();
  };
  const heading = (l) => /^#{1,4}\s/.test(l);
  try {
    const text = fs.readFileSync(path.join(migrationDir, "decisions.md"), "utf8");
    collect(text.split(/\r?\n/), (l) => { const h = /^#{1,4}\s+D(\d+)\b/.exec(l); return h ? `D${h[1]}` : null; }, heading);
  } catch { /* no decisions file — the card then carries titles only */ }
  try {
    const plan = fs.readFileSync(path.join(migrationDir, "plan.md"), "utf8");
    const at = plan.search(/^###\s+Adjustments/m);
    if (at >= 0) {
      const lines = plan.slice(at).split(/\r?\n/).slice(1);
      collect(lines, (l) => { const m = /^(\d+)\. +\*\*[^*\n]+\*\*/.exec(l); return m ? `Adjustment ${m[1]}` : null; }, heading);
      // An Adjustments item's first line is its title AND its text: keep that line as the start of the body.
      for (const m of plan.slice(at).matchAll(/^(\d+)\. +\*\*([^*\n]+)\*\*([^\n]*)$/gm)) {
        const rest = m[3].replace(/^[\s—–:.-]+/, "").trim();
        const key = `Adjustment ${m[1]}`;
        if (rest) out.set(key, [rest, out.get(key)].filter(Boolean).join("\n"));
      }
    }
  } catch { /* same */ }
  return out;
}
// The decision references a reason carries: `D4`, `D18 user decision`, `Adjustment 2`. `resolved` is what the
// files say those are; `missing` is a reference nothing recorded.
// A citation is LOAD-BEARING unless it is an incidental comparison/example ("like D3", "similar to D3", "as in
// D3", "cf D3") — those name a decision to draw a parallel, not to authorise THIS row. Everything else counts, so
// the real citation forms all stand ("D4 (detail…)", "per D7", "D18 user decision:", "Adjustment 2 evidence…").
// This stops an accidental mention from closing a boundary; it does NOT verify the decision is ABOUT this row —
// the report shows the decision's title beside the boundary so a reader catches a wrong-topic citation by eye.
const INCIDENTAL_BEFORE = /\b(like|similar to|as in|cf\.?|e\.?g\.?|for example|compared? (?:to|with))\s*$/i;
function decisionRefs(reason, decisions) {
  const text = String(reason || "");
  const refs = [];
  for (const m of text.matchAll(/\b(D\d{1,3})\b|\b(Adjustment\s+\d+)\b/gi)) {
    if (INCIDENTAL_BEFORE.test(text.slice(Math.max(0, m.index - 16), m.index))) continue;
    refs.push(m[1] ? m[1].toUpperCase() : m[2].replace(/\s+/g, " ").replace(/^adjustment/i, "Adjustment"));
  }
  const uniq = [...new Set(refs)];
  return { resolved: uniq.filter((r) => decisions.has(r)).map((r) => ({ ref: r, title: decisions.get(r) })),
    missing: uniq.filter((r) => !decisions.has(r)) };
}

// --- page names -----------------------------------------------------------------------------------------------
// The Freedom schema name the built payload reports (`schemaName`, copied from `get-page` beside `schemaUId`),
// else a description of the page — never the engine's key.
function pageNamer(built) {
  const pages = built?.pages && typeof built.pages === "object" ? built.pages : {};
  return (key) => {
    const name = pages[key]?.schemaName;
    if (name) return `\`${cell(name)}\``;
    if (key === "main") return "Form page";
    if (key === "list") return "List page";
    if (key === "run") return "Whole run (every page)";   // a run small enough to be one task
    const [kind, rest] = String(key).split(":");
    if (kind === "mini") return `Mini page — ${cell(rest)}`;
    if (kind === "child") return `Child page — ${cell(rest)}`;
    if (kind === "typed") return `Typed page — ${cell(rest)}`;
    return cell(key);
  };
}

// --- how each plan row was verified ---------------------------------------------------------------------------
// One of: `machine` (a `--verify` resolver read it off the built page), `judge` (an evidence record the agent
// filed + an independent judge's verdict), `hand` (nothing can read it — a person opens the page), `na` (a boundary
// the plan approved). Read off the verify rows, joined to the task rows by (page, label).
function verifyIndex(verifyRes) {
  const byKey = new Map(), byLabel = new Map();
  for (const r of verifyRes?.rows || []) {
    byKey.set(`${r.pageKey} ${labelKey(r.deliverable)}`, r);
    const lk = labelKey(r.deliverable);
    if (!byLabel.has(lk)) byLabel.set(lk, r);   // first row of a label wins; whole-run tasks resolve here
  }
  return { byKey, byLabel };
}
function howVerified(vrow) {
  if (!vrow) return { how: "unknown", ok: false };
  if (vrow.kind === "na" || vrow.kind === "info") return { how: "na", ok: true };
  if (vrow.kind === "confirm") return { how: "hand", ok: false };
  if (vrow.vkType === "evidence") return { how: "judge", ok: vrow.outcome === "ok" };
  return { how: "machine", ok: vrow.outcome === "ok" };
}

// --- the ledger, as the report sees it ------------------------------------------------------------------------
function planTasks(tasks) {
  // The reference cache is the engine's own preparation (guidance fetched into `refs/`, nothing built on the
  // stand) — not a plan task, so not a row the user reads. Everything else, repair rounds included, is listed.
  return (tasks || []).filter((t) => t.artifact !== ARTIFACT_REFS)
    .sort((a, b) => Number(a.step ?? a.order) - Number(b.step ?? b.order));
}
// A `partial` task whose only remaining un-built rows are `postponed` is not open work — its debt is a
// person's decision with a destination, so it belongs on the 🟡 side of the verdict rather than the 🔴
// "tasks not closed" reason. Under point 6 that keeps 🟡 honest: 🟡 means "the machine has
// nothing left to do, the person has a debt", and the debt is the postponed row.
function isPostponedDerivedPartial(t) {
  if (t.status !== S_PARTIAL) return false;
  const rows = t.rows || [];
  if (!rows.length) return false;
  return rows.every((r) => r.outcomeKind === O_BUILT || r.outcomeKind === O_NOT_APPLICABLE
    || r.outcomeKind === O_WONT_DO || r.outcomeKind === O_POSTPONED)
    && rows.some((r) => r.outcomeKind === O_POSTPONED);
}
const COUNT_BUCKET = new Map([
  [S_DONE, "done"], [S_NOT_APPLICABLE, "na"], [S_WONT_DO, "wontDo"], [S_POSTPONED, "postponed"],
  [S_IN_PROGRESS, "inProgress"], [S_TODO, "todo"], [S_BLOCKED, "blocked"],
]);
// A partial task whose debt is postponed rows counts as a postponed-derived task, not as open work.
function countBucket(t) {
  if (t.unread) return "unread";
  if (t.status === S_PARTIAL) return isPostponedDerivedPartial(t) ? "postponed" : "partial";
  return COUNT_BUCKET.get(t.status) || "other";
}
function taskCounts(tasks) {
  const c = { total: tasks.length, done: 0, na: 0, wontDo: 0, postponed: 0, partial: 0, inProgress: 0, todo: 0, blocked: 0, unread: 0, other: 0 };
  for (const t of tasks) c[countBucket(t)]++;
  // `postponed` is not open work — it is a debt with a destination — so it does not count against a run's
  // open total the way `partial` does. The three-colour verdict treats it as scheduled elsewhere.
  c.open = c.partial + c.inProgress + c.todo + c.blocked + c.unread + c.other;
  return c;
}
const statusParts = (tc) => {
  const p = [`✅ done ${tc.done}`];
  if (tc.na) p.push(`— not-applicable ${tc.na}`);
  if (tc.wontDo) p.push(`⊘ wont-do ${tc.wontDo}`);
  if (tc.postponed) p.push(`⏸ postponed ${tc.postponed}`);
  if (tc.partial) p.push(`◐ partial ${tc.partial}`);
  if (tc.inProgress) p.push(`▶ in progress ${tc.inProgress}`);
  if (tc.todo) p.push(`☐ queued ${tc.todo}`);
  if (tc.blocked) p.push(`⛔ blocked ${tc.blocked}`);
  if (tc.unread || tc.other) p.push(`⚠ unreadable/unknown ${tc.unread + tc.other}`);
  return p;
};

// A `needs-decision` row that a LATER row (a repair round) closed as a plan boundary (`not-applicable`) citing
// a recorded decision, or as `wont-do` / `postponed` through `--decide`, is decided — the decision exists, the
// person made it, only the ledger has not caught up (the repair task closes its source row when it closes).
// Such an item is reported under the boundaries WITH a decision, not as an open question.
function splitDecided(notBuilt, boundaries) {
  const decidedBy = new Map();
  for (const b of boundaries) if (b.refs.resolved.length) decidedBy.set(`${b.task.pageKey} ${labelKey(b.row.label)}`, b);
  const open = [], decided = [];
  for (const it of notBuilt) {
    const b = decidedBy.get(`${it.task.pageKey} ${labelKey(it.row.label)}`);
    (b ? decided : open).push(b ? { ...it, decidedBy: b } : it);
  }
  return { open, decided };
}

// A SETTLED TASK WHOSE ROWS DRIFTED: its cells were recorded against deliverables the plan has since dropped, so
// no mark re-attaches and the collector sees no owed row. Its word stands over rows nobody accounted for.
function driftedSettledReasons(tasks) {
  const bad = (tasks || []).filter((t) => t.drifted && !t.unread && (t.status === S_DONE || t.status === S_PARTIAL));
  if (!bad.length) return [];
  return [`${plural(bad.length, "settled task")} whose deliverables CHANGED since its cells were recorded`
    + ` (${bad.map((t) => esc(t.file)).join(", ")}) — re-check those cells against the rows now in the file`];
}

// A LEDGER ENTRY NOBODY CAN DERIVE — distinct from `ledgerRefused` (a file that would not parse at all):
// this one parses and carries a status with no cells behind it.
function unreadableLedgerReasons(tasks) {
  const bad = unreadableLedger(tasks);
  if (!bad.length) return [];
  return [`${plural(bad.length, "task")} whose \`## Deliverables\` table could not be read`
    + ` (${bad.map((t) => esc(t.file)).join(", ")}) — their status is not derived from anything`];
}

function verdictReasons({ tc, openNotBuilt, unbackedBoundaries, rc, gaps }) {
  const R = [];
  if (gaps.length) R.push(`PLAN-level gap — ${gaps.join(" · ")} (fix the manifest and re-plan; no build round closes this)`);
  if (openNotBuilt.length) {
    const nd = openNotBuilt.filter((it) => it.cause !== "blocked").length;
    const bl = openNotBuilt.length - nd;
    const blockedNote = bl ? ` · ${bl} blocked` : "";
    R.push(`${plural(openNotBuilt.length, "plan item")} recorded NOT BUILT (${nd} need${nd === 1 ? "s" : ""} a decision${blockedNote})`);
  }
  if (unbackedBoundaries.length) R.push(`${plural(unbackedBoundaries.length, "boundary", "boundaries")} closed by the agent with NO recorded decision`);
  if (tc.open) R.push(`${plural(tc.open, "task")} not closed (${statusParts(tc).filter((s) => !s.startsWith("✅") && !s.startsWith("— not-applicable") && !s.startsWith("⊘ wont-do") && !s.startsWith("⏸ postponed")).join(" · ")})`);
  if (rc.missing) R.push(`${plural(rc.missing, "machine-checked plan item")} MISSING from the built page(s)`);
  if (rc.unverified) R.push(`${plural(rc.unverified, "machine row")} not confirmed`);
  return R;
}

function tallyRow(c, r) {
  const { how, ok } = howVerified(r);
  if (how === "na") { c.na++; return; }
  if (how === "hand") { c.hand++; return; }
  if (how === "judge") { c.judge++; if (ok) c.judgeOk++; }
  else { c.machine++; if (ok) c.machineOk++; }
  if (r.outcome === "missing") c.missing++;
  else if (r.outcome === "unverified") c.unverified++;
}
function rowCounts(rows) {
  const c = { machine: 0, machineOk: 0, judge: 0, judgeOk: 0, hand: 0, na: 0, missing: 0, unverified: 0 };
  for (const r of rows || []) tallyRow(c, r);
  return c;
}

// --- sections -------------------------------------------------------------------------------------------------
function summaryTable({ tc, openNotBuilt, decidedNotBuilt, boundaries, declined = [], rc, repair, handLeft }) {
  // Declined rows are closed by a recorded decision, so they count here exactly as section 2 lists them.
  const without = boundaries.filter((b) => !b.refs.resolved.length).length;
  const closed = boundaries.length + declined.length;
  const boundNote = closed ? ` — with a recorded decision ${closed - without} · without ${without}` : "";
  const L = ["| | |", "| --- | --- |",
    `| Tasks | ${tc.total} — ${statusParts(tc).join(" · ")} |`,
    `| Open questions (plan items recorded NOT BUILT, no decision yet) | ${openNotBuilt.length} |`,
    ...(decidedNotBuilt.length ? [`| Plan items not built BY DECISION | ${decidedNotBuilt.length} |`] : []),
    `| Boundaries the agent closed | ${closed}${boundNote} |`,
    `| Plan items confirmed (on the built page, or by review) | ${rc.machineOk + rc.judgeOk}/${rc.machine + rc.judge} |`,
    `| Plan items to confirm manually | ${handLeft} |`];
  if (repair) {
    const parts = [];
    if (repair.written?.length) parts.push(`wrote ${plural(repair.written.length, "repair task")}`);
    if (repair.pending?.length) parts.push(`${plural(repair.pending.length, "cause")} already have an open repair task`);
    if (repair.parked?.length) parts.push(`⛔ ${plural(repair.parked.length, "cause")} PARKED after the round cap — take to the user`);
    if (repair.disputed?.length) parts.push(`${plural(repair.disputed.length, "row")} DISPUTED — closed \`built\`, re-opened on unchanged evidence; the check is in question`);
    if (repair.stalled?.length) parts.push(`⛔ ${plural(repair.stalled.length, "row")} STALLED — closed \`not-built\`, re-opened on unchanged evidence; take to the user`);
    if (parts.length) L.push(`| Repair round (this run) | ${parts.join(" · ")} |`);
  }
  return L;
}

const enc = (f) => encodeURI(String(f || "")).replaceAll("(", "%28").replaceAll(")", "%29");
const where = (it) => `[${cell(it.task.group || it.task.id)}](${enc(it.task.file)}), row ${it.n}`;

// A LATER round that recorded the same row `built` and has not closed yet: the question may already be answered
// on the stand, and the reader should know before deciding anything. Keyed by (page, label).
function repairBuiltIndex(tasks) {
  const idx = new Map();
  for (const t of tasks) {
    if (!(t.kind === "repair" || Number(t.repairRound) > 0)) continue;
    for (const r of t.rows || []) if (r.outcomeKind === O_BUILT) idx.set(`${t.pageKey} ${labelKey(r.label)}`, t);
  }
  return idx;
}
function decisionsSection(open, pageName, repairBuilt) {
  const L = [`## 1. Needs a decision (${open.length})`, ""];
  if (!open.length) { L.push("Nothing — every plan item a build agent could not build has a recorded decision, or none was left open."); return L; }
  L.push("Plan items the build agents recorded as **not built** because only a person can settle them. Nothing"
    + " here is scheduled again by itself; each row names the decision it is waiting for.", "",
    "| # | Page | Plan item | Decision needed | Recorded in |", "| --- | --- | --- | --- | --- |");
  open.forEach((it, i) => {
    const later = repairBuilt.get(`${it.task.pageKey} ${labelKey(it.row.label)}`);
    const laterNote = later ? ` ⏳ *${cell(later.group || later.id)} has since recorded it **built**; this row closes when that task closes — check the stand before deciding.*` : "";
    let text;
    if (it.row?.naNoReason) text = "the row was closed `not-applicable` with NO reason — decide whether it is a boundary or a row to build";
    else if (it.cause === "blocked") text = "none — the stand or a service was unreachable; a re-run may clear it";
    else if (!it.cause) text = "the task closed without accounting for this row — decide whether it was built";
    else {
      const marker = markers(it.task.notes, DECISION_MARKER).get(it.n);
      const fallback = marker ? "" : decisionFallback(it.task.notes, it.n);
      if (marker) text = cell(marker);
      else if (fallback) text = `${cell(fallback)} *(from the row's notes — the agent wrote no \`Decision needed\` line)*`;
      else text = "⚠ the agent recorded `needs-decision` but did not state the question — read the row's notes";
    }
    L.push(`| ${i + 1} | ${pageName(it.row.pageKey || it.task.pageKey)} | ${cell(it.row.label)} | ${text}${laterNote} | ${where(it)} |`);
  });
  return L;
}

// `wont-do` rows whose reason cites a decision `decisions.md` holds: a person declined the item, and section 2 lists it
// beside the other recorded decisions so the reader sees what was left out and why (for example a lookup filter
// the user did not want object-wide, which then has to be added by hand).
function declinedRows(tasks, decisions) {
  const out = [];
  for (const t of tasks || []) {
    if (t.unread) continue;
    (t.rows || []).forEach((r, i) => {
      if (r.outcomeKind !== O_WONT_DO) return;
      const refs = decisionRefs(r.outcomeReason, decisions);
      if (refs.resolved.length) out.push({ task: t, row: r, n: i + 1, refs });
    });
  }
  return out;
}

function boundariesSection(boundaries, decidedNotBuilt, pageName, declined = []) {
  // A boundary row that is the decision behind a not-built item is rendered ONCE, as that item's entry.
  const deciding = new Set(decidedNotBuilt.map((it) => it.decidedBy));
  const withRef = [...boundaries.filter((b) => b.refs.resolved.length && !deciding.has(b)), ...declined];
  const without = boundaries.filter((b) => !b.refs.resolved.length);
  const L = [`## 2. Boundaries the agent closed (${withRef.length + without.length + decidedNotBuilt.length})`, ""];
  if (!boundaries.length && !decidedNotBuilt.length && !declined.length) { L.push("None — every `not-applicable` in the folder is a boundary the plan itself approved."); return L; }
  if (without.length) {
    L.push(`**Without a recorded decision (${without.length}) — confirm each, or send it back as a row to build.**`
      + " Nothing was built for these and nobody but the agent said there was nothing to build.", "",
      "| # | Page | Plan item | Reason the agent gave | Recorded in |", "| --- | --- | --- | --- | --- |");
    without.forEach((b, i) => {
      const miss = b.refs.missing.length ? ` — ⚠ cites ${b.refs.missing.join(", ")}, not found in decisions.md / the plan's Adjustments` : "";
      L.push(`| ${i + 1} | ${pageName(b.row.pageKey || b.task.pageKey)} | ${cell(b.row.label)} | ${cell(brief(b.row.outcomeReason, 160))}${miss} | ${where(b)} |`);
    });
    L.push("");
  }
  if (withRef.length || decidedNotBuilt.length) {
    L.push(`**Closed by a recorded decision (${withRef.length + decidedNotBuilt.length}) — for information.**`, "",
      "| # | Page | Plan item | Decision | Recorded in |", "| --- | --- | --- | --- | --- |");
    let i = 0;
    for (const b of withRef) {
      const d = b.refs.resolved.map((r) => `**${r.ref}** — ${cell(r.title)}`).join("; ");
      L.push(`| ${++i} | ${pageName(b.row.pageKey || b.task.pageKey)} | ${cell(b.row.label)} | ${d} | ${where(b)} |`);
    }
    for (const it of decidedNotBuilt) {
      const d = it.decidedBy.refs.resolved.map((r) => `**${r.ref}** — ${cell(r.title)}`).join("; ");
      L.push(`| ${++i} | ${pageName(it.row.pageKey || it.task.pageKey)} | ${cell(it.row.label)} | ${d} · *not built by this decision; recorded in [${cell(it.task.group)}](${enc(it.task.file)}) row ${it.n}, which closes when the repair task closes* | ${where(it.decidedBy)} |`);
    }
  }
  return L;
}

function openMachineSection(rows, pageName) {
  const open = (rows || []).filter((r) => r.kind === "machine" && (r.outcome === "missing" || r.outcome === "unverified"));
  if (!open.length) return [];
  const L = [`## 3. The machine could not confirm (${open.length})`, "",
    "Plan-vs-built rows the engine could not close from the built pages. ❌ is a thing to build; ⚠ is a thing to"
    + " confirm or a record to file.", "",
    "| # | Page | Plan item | Status | Evidence (built page) |", "| --- | --- | --- | --- | --- |"];
  for (const r of open) L.push(`| ${r.n} | ${pageName(r.pageKey)} | ${cell(r.deliverable)} | ${r.status} | ${cell(r.evidence)} |`);
  return L;
}

// Per task: its rows joined to the verify rows, so the ledger says HOW each task was verified.
// States: machine / judge (confirmed) · hand (a plan item only a person can confirm) · extra (a row that is not a
// plan item — an orchestrator-authored repair task's own checklist; recorded by its agent, nothing verifies it) ·
// not-built / decided / boundary / na · open (no outcome yet, or the machine could not confirm it).
const DECIDED_ROW_KINDS = new Set([O_NOT_BUILT, O_NOT_APPLICABLE, O_WONT_DO, O_POSTPONED]);
// ORDER IS THE RULE HERE: a row can satisfy several of these at once, and the earlier answer is the more
// specific one. A decided row reported as merely `na` would lose the person's decision from the report.
function rowReportState(r, hv, inSet, keys) {
  if (inSet(keys.notBuilt) && r.outcomeKind === O_NOT_BUILT) return "not-built";
  if (inSet(keys.decided) && DECIDED_ROW_KINDS.has(r.outcomeKind)) return "decided";
  if (r.outcomeKind === O_NOT_APPLICABLE) return inSet(keys.unbacked) ? "boundary" : "na";
  if (r.outcomeKind === O_WONT_DO || r.outcomeKind === O_POSTPONED) return "decided";
  if (r.na || r.info || hv.how === "na") return "na";
  if (!r.outcomeKind) return "open";
  if (hv.how === "hand") return "hand";
  if (hv.how === "unknown") return "extra";
  return hv.ok ? hv.how : "open";
}
function taskRows(t, vidx, keys) {
  return (t.rows || []).map((r, i) => {
    const lk = labelKey(r.label);
    const key = `${r.pageKey || t.pageKey} ${lk}`;
    // The label-only fallback is ONLY for the synthetic whole-run task (pageKey "run"), whose rows come from several
    // pages and carry no page of their own. For a normal task the page IS known, so matching by bare label would
    // bleed a not-built / boundary state from one page onto a same-labeled row on another (init, common field names).
    const wholeRun = (r.pageKey || t.pageKey) === "run";
    const v = vidx.byKey.get(key) || (wholeRun ? vidx.byLabel.get(lk) : undefined);
    const hv = howVerified(v);
    const inSet = (set) => set.has(key) || (wholeRun && !!set.hasLabel?.has(lk));
    return { n: i + 1, label: r.label, outcome: r.outcome || "—", v, hv,
      state: rowReportState(r, hv, inSet, keys) };
  });
}
const num = (secNo, title) => `## ${secNo}. ${title}`;

function handCellText(hand, extra, extraNote) {
  if (hand) return `${hand}${extraNote}`;
  return extra ? `(${extra} not in the plan)` : "—";
}
function taskTableRow(t, i, rows, pageName) {
  const count = (pred) => rows.filter(pred).length;
  // Denominators leave out the rows the agent closed as a boundary / by decision: a Print button the plan said
  // not to migrate is not a machine row the task failed to confirm.
  const closedOtherwise = (r) => ["na", "decided", "boundary", "not-built"].includes(r.state);
  const machine = count((r) => r.hv.how === "machine" && !closedOtherwise(r)), machineOk = count((r) => r.state === "machine");
  const judge = count((r) => r.hv.how === "judge" && !closedOtherwise(r)), judgeOk = count((r) => r.state === "judge");
  const hand = count((r) => r.state === "hand");
  const extra = count((r) => r.state === "extra");
  const nb = rows.filter((r) => r.state === "not-built").map((r) => `${cell(r.label)} *(needs a decision)*`);
  const dec = rows.filter((r) => r.state === "decided").map((r) => `${cell(r.label)} *(by decision)*`);
  const mark = t.unread ? "⚠ unread" : cell(statusMark(t.status).replace("in-progress", "in progress").replace("todo", "queued"));
  const extraNote = extra ? ` (+${extra} not in the plan)` : "";
  const handCell = handCellText(hand, extra, extraNote);
  const confirmedCell = machine + judge ? `${machineOk + judgeOk}/${machine + judge}` : "—";
  const notBuiltCell = [...nb, ...dec].join("<br>") || "—";
  return `| ${i + 1} | [${cell(t.group || t.title || t.id)}](${enc(t.file)}) | ${pageName(t.pageKey)} | ${mark} | ${confirmedCell} | ${handCell} | ${notBuiltCell} |`;
}
function tasksSection(tasks, perTask, pageName, secNo) {
  const L = [num(secNo, `Tasks (${tasks.length})`), "",
    "One row per task file. `Status` is computed from the task's own `Outcome` cells. The two confirmation columns"
    + " count the task's plan items: **Confirmed** — the engine found the item on the built page (read through get-page), or the build"
    + " agent's evidence record was found convincing by a separate reviewer; **To confirm manually** — nobody yet, a person has to open the page.", "",
    "| Step | Task | Page | Status | Confirmed | To confirm manually | Not built |",
    "| --- | --- | --- | --- | --- | --- | --- |"];
  tasks.forEach((t, i) => L.push(taskTableRow(t, i, perTask.get(t.id) || [], pageName)));
  return L;
}

const SETTLED_STATES = new Set(["machine", "judge", "na", "decided", "extra"]);
// One open row's "What closes it" cell — extracted so detailsSection stays under Sonar's cognitive-complexity ceiling.
function openRowHow(r, t, checks) {
  if (r.state === "not-built") return "decision needed — see section 1";
  if (r.state === "boundary") return "confirm the boundary — see section 2";
  if (r.state === "open" && (!r.outcome || r.outcome === "—")) return `— no outcome recorded yet (task ${cell(statusMark(t.status))})`;
  if (r.state === "open") return r.v ? `${r.v.status} — ${cell(brief(r.v.evidence, 140))}` : "⚠ recorded by the agent but not in this run's plan-vs-built table";
  const c = checks.get(r.n);
  return c ? `☐ confirm manually — ${cell(c)}` : `☐ confirm manually — no \`Check on stand\` line; the check is in the task's notes (row ${r.n})`;
}
function detailsSection(tasks, perTask, pageName, secNo) {
  const needs = tasks.filter((t) => (perTask.get(t.id) || []).some((r) => !SETTLED_STATES.has(r.state)));
  const L = [num(secNo, `Task details — what is still open per task (${needs.length})`), ""];
  if (!needs.length) { L.push("Nothing — every plan item of every task was confirmed by the machine or by evidence + judge."); return L; }
  L.push("Only the tasks with something still open: a plan item to confirm manually, a decision to make, or an item the built page"
    + " could not confirm. A ☐ row carries the check the build agent wrote (`Check on stand`), or points at the task's"
    + " notes. Rows of an orchestrator-authored task that are not plan items (\"+N not in the plan\" above) are not"
    + " listed — the agent recorded them built and nothing else can check them.", "");
  for (const t of needs) {
    const rows = (perTask.get(t.id) || []).filter((r) => !SETTLED_STATES.has(r.state));
    const checks = markers(t.notes, CHECK_MARKER);
    L.push(`**${tasks.indexOf(t) + 1}. [${cell(t.group || t.id)}](${enc(t.file)})** — ${pageName(t.pageKey)} · ${cell(statusMark(t.status))}`, "",
      "| # | Plan item | Build agent recorded | What closes it |", "| --- | --- | --- | --- |");
    for (const r of rows) L.push(`| ${r.n} | ${cell(r.label)} | ${cell(r.outcome)} | ${openRowHow(r, t, checks)} |`);
    L.push("");
  }
  return L;
}

// point 6 helpers — the carry-over row-level list of every postponed item, with its decision and
// destination parsed out of the cell text. `--decide --postponed` writes cells shaped `postponed — <reason>
// (D<N>) → <destination>`; the regex below picks D<N> out and anchors the destination on the LAST `→`
// The LAST arrow, because a decision title may itself carry one — a reference like `see D3 → D4` — and
// anchoring on the first would swallow it into the destination and break the Jira-link render.
const POSTPONED_DECISION_RE = /\(D(\d{1,3})\)/;
function parsePostponedCell(text) {
  const s = String(text || "");
  const dmatch = POSTPONED_DECISION_RE.exec(s);
  const decision = dmatch ? `D${dmatch[1]}` : null;
  const lastArrow = s.lastIndexOf("→");
  const destination = lastArrow < 0 ? null : s.slice(lastArrow + 1).trim() || null;
  return { decision, destination };
}
function collectPostponedRows(tasks) {
  const out = [];
  for (const t of tasks || []) {
    if (t.unread) continue;
    (t.rows || []).forEach((r, i) => {
      if (r.outcomeKind !== O_POSTPONED) return;
      const { decision, destination } = parsePostponedCell(r.outcome);
      out.push({ task: t, row: r, n: i + 1, decision, destination });
    });
  }
  return out;
}
function postponedGroups(items) {
  const by = new Map();
  for (const it of items) {
    const key = `${it.decision || "?"} → ${it.destination || "?"}`;
    if (!by.has(key)) by.set(key, { decision: it.decision, destination: it.destination, rows: [] });
    by.get(key).rows.push(it);
  }
  return [...by.values()];
}
// A destination that reads as an issue key (`PROJ-42`, `ABC-7`) is rendered as a link into the same
// Jira/GitHub tracker the plan lives in; free text passes through as-is. The link target uses a per-project
// convention (`https://…/browse/<KEY>`) that the reader's environment resolves — the report is markdown, so
// this is just a hint rather than a hard reference.
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;
const renderDestination = (d) => {
  const s = String(d || "").trim();
  if (!s) return "—";
  if (ISSUE_KEY_RE.test(s)) return `[${cell(s)}](https://creatio.atlassian.net/browse/${encodeURIComponent(s)})`;
  return cell(s);
};
// Every decisions.md entry recorded `Decided by: orchestrator`: choices the agent made without asking the person who
// owns the migration. Listed so that person can see each one and overturn it; a choice they never hear about is one
// they cannot overturn.
function decidedWithoutYouSection(entries) {
  if (!entries.length) return [];
  return [`## Decided without you (${entries.length})`, "",
    "The agent made these choices itself (`Decided by: orchestrator` in `decisions.md`). Each is open to change: say so, and it becomes a question.", "",
    ...entries.map((d) => `- **${esc(d.id)}** — ${esc(d.title || "?")}`)];
}
// The section for the decisions.md above the task folder `dir`. Read only beside a task folder: with none, `..`
// would name whatever folder the process happens to run in.
function decidedWithoutYouFor(dir) {
  if (!dir) return [];
  try {
    return decidedWithoutYouSection(orchestratorDecisions(readDecisionRecords(path.join(dir, ".."))));
  } catch (e) {
    // An unreadable decisions.md does not stop the report; the section says it could not be listed.
    return ["## Decided without you", "", `⚠ decisions.md could not be read (${esc(e.message)}), so the choices the agent made without asking are not listed.`];
  }
}
function carryOverSection(items, pageName) {
  if (!items.length) return [];
  const L = [`## Carry-over — postponed items (${items.length})`, "",
    "Rows a person deferred through `--decide --postponed`. Each is a DEBT with a destination — not a real"
    + " miss (the verdict stays 🟡, not 🔴), but they are not done either and belong on a backlog. Use this"
    + " list to file follow-up work; the destination is what the person named when they decided.",
    "", "| # | Page | Plan item | Decision | Destination | Recorded in |",
    "| --- | --- | --- | --- | --- | --- |"];
  items.forEach((it, i) => {
    const dec = it.decision ? `**${it.decision}**` : "⚠ no D<N> found in the cell";
    L.push(`| ${i + 1} | ${pageName(it.row.pageKey || it.task.pageKey)} | ${cell(it.row.label)} | ${dec} | ${renderDestination(it.destination)} | [${cell(it.task.group || it.task.id)}](${enc(it.task.file)}), row ${it.n} |`);
  });
  return L;
}

// `set` is the MERGED task set (`syncRepairDir(...).set` or `readMergedTaskDir`) — never raw `readTaskDir` output,
// whose rows carry no plan `na` and would report every approved boundary as agent-asserted. `dir` is the task
// folder (decisions.md / plan.md are read from its parent); `dirLabel` is only what the report prints for it.
// WHY THE LEDGER YIELDED NOTHING, matched to the refusal's own reason. "Could not be read" is the narrowest of
// them: a cut that parses perfectly well but does not cover the plan refuses here too, and calling that a read
// failure sends the reader to check a file whose syntax is fine. `null` when the ledger was readable.
function ledgerReason(set) {
  if (!set?.refused) return null;
  const detail = (set.problems || []).join("; ") || "the task folder could not be read";
  const how = !set.refusal || set.refusal === REFUSED_UNREADABLE ? "could not be read" : "yielded no tasks";
  return `the task ledger ${how} (${esc(detail)}) — the run cannot be called complete until the folder is fixed`
    + " and re-verified";
}

// The verdict is the CONJUNCTION over every gate the CLI exits 2 on — gate / structure / coverage / list read
// from `result`, the dispatch gate passed in from migrate.mjs — so the report can never read COMPLETE on a
// rejected run.
function gateReasons(result, gates) {
  const out = [];
  if (result?.gate?.blocked) out.push("the build gate is BLOCKED — the plan is not approvable");
  if (result?.structure && !result.structure.complete) out.push("the plan STRUCTURE is incomplete — not ready to build");
  if (result?.coverage && !result.coverage.complete) out.push("schema members are UNACCOUNTED — no Freedom artifact and no decision");
  if (result?.listGate?.blocked) out.push("the LIST page gate is BLOCKED — the list page is not approvable");
  if (gates?.dispatchFailed) out.push("the DISPATCH gate failed — a task was closed with no dispatch token");
  return out;
}
// A task computed `not-applicable` is the plan's own boundary: every row of it is a plan-boundary row, and the
// engine writes that outcome only from `r.na`. One with rows the plan did NOT mark that way is a person's
// decision written as a plan fact, so it has to cite a recorded decision and must not leave plan rows
// unaccounted while the run reads COMPLETE.
// A CLASSIC FEATURE A BUILDER DROPPED ON ITS OWN SAY-SO. Only a person drops a feature, through a recorded `D<N>`;
// a builder leaves the row `not-built — needs-decision`. So a `## Notes` entry that drops one (`Dropped:`, `won't do`,
// `not ported`) is an unanswered question the result must not pass over, unless it cites a decision ABOUT that
// feature: one that resolves and whose title shares a word with the entry — citing an unrelated `D<N>` authorises
// nothing. A claim that Freedom has no equivalent is the same unless the entry names its row and that row has a
// `Checked (row N)` line saying what was checked. An entry is a bullet with the lines wrapped under it. The question
// and check entries themselves are not drops (a question names its options), and neither is a negated one
// ("nothing was dropped"). A drop word counts only in an entry about the plan: one that names a row, opens with the
// drop as its label (`Dropped:`, `Not ported here …`) or names Classic — "dropped the stale import" is not one.
export const CHECKED_MARKER = notesMarker("Checked");
const DROP_WORDS = /\b(?:dropped|won'?t[\s-]do|wont-do|not ported|will not (?:build|port))\b/i;
const DROP_LABEL = /^[\s*>+-]*\**\s{0,3}(?:dropped|won'?t[\s-]do|wont-do|not ported|will not (?:build|port))\b/i;
const NEGATED_DROP =/\b(?:nothing|none|no)\b[^.;:]{0,40}\b(?:dropped|not ported|won'?t[\s-]do)\b/i;
// "no Freedom (list) equivalent" and "Freedom has no …": two small patterns, either one is the claim
const NO_FREEDOM_EQUIVALENT = /\bno\s(?:[\w-]+\s){0,3}?freedom\s(?:[\w-]+\s){0,2}?(?:equivalent|analog(?:ue)?|counterpart)\b/i;
const FREEDOM_HAS_NO = /\bfreedom\s(?:has|offers|provides)\sno\b/i;
const NO_EQUIVALENT = { test: (s) => NO_FREEDOM_EQUIVALENT.test(s) || FREEDOM_HAS_NO.test(s) };
const ROW_REF = /\brow\s(\d+)\b/i;
// A wrapped line is indented and opens no bullet, numbered item, quote or heading of its own.
const CONTINUATION = /^\s+(?![-*+>#]|\d+[.)]\s)\S/;
function noteEntries(notes) {
  const entries = [];
  for (const raw of String(notes || "").split(/\r?\n/)) {
    if (CONTINUATION.test(raw) && entries.length) entries[entries.length - 1] += " " + raw.trim();
    else if (raw.trim()) entries.push(raw.trim());
  }
  return entries;
}
const TERM = /[\p{L}\d]{4,}/gu;
const terms = (s) => new Set(String(s || "").toLowerCase().match(TERM) || []);
const coversEntry = (entry, decision) => { const t = terms(entry); return [...terms(decision.title)].some((w) => t.has(w)); };
function unauthorisedDrops(task, decisions) {
  let checked = null;
  const isChecked = (row) => {
    if (!row) return false;
    checked ??= notesMarkers(task.notes, CHECKED_MARKER);
    return checked.has(Number(row[1]));
  };
  const out = [];
  for (const entry of noteEntries(task.notes)) {
    if (DECISION_MARKER.test(entry) || CHECKED_MARKER.test(entry)) continue;
    const aboutPlan = ROW_REF.test(entry) || DROP_LABEL.test(entry) || /\bclassic\b/i.test(entry);
    const dropped = (DROP_WORDS.test(entry) && !NEGATED_DROP.test(entry) && aboutPlan) || (NO_EQUIVALENT.test(entry) && !isChecked(ROW_REF.exec(entry)));
    if (dropped && !decisionRefs(entry, decisions).resolved.some((d) => coversEntry(entry, d))) out.push(entry);
  }
  return out;
}
export function builderDropReasons(tasks, decisions) {
  const found = tasks.flatMap((t) => unauthorisedDrops(t, decisions).map((line) => `${esc(t.file)}: “${brief(line, 160)}”`));
  if (!found.length) return [];
  return [`${plural(found.length, "note line")} where a builder dropped a Classic feature, or said Freedom has no equivalent,`
    + ` with no recorded decision and no \`Checked (row N)\` line — leave the row \`not-built — needs-decision\` and ask the person: ${found.slice(0, 4).join(" · ")}${found.length > 4 ? " · …" : ""}`];
}
function naUnbackedReasons(tasks, decisions) {
  const naUnbacked = tasks.filter((t) => t.status === S_NOT_APPLICABLE
    && (!decisionRefs(t.notes || "", decisions).resolved.length || (t.rows || []).some((r) => !r.outcomeKind && !r.na)));
  return naUnbacked.length
    ? [`${plural(naUnbacked.length, "task")} closed not-applicable with no recorded decision (or with rows left unaccounted)`]
    : [];
}
// AC 13 — 🟡 IS GRANTED ONLY OVER DECISIONS THAT STILL RESOLVE. `collectPostponedRows` parses the cell TEXT,
// so it accepts a `(D<N>)` naming a decision renamed or deleted from decisions.md after the cell was written,
// and a cell carrying no destination at all. Neither is a person's answer: one points at nothing, the other
// names no debt to carry. Routing them here is what makes the verdict compute RED through the path every other
// shortfall already takes — and, because an unbacked row always lands on `reasons`, `complete` implies EVERY
// postponed row carries a resolvable decision and a destination, which is what makes the headline safe to
// interpolate without a guard.
function postponedUnbackedReasons(postponedRows, decisions) {
  const unbacked = postponedRows.filter((p) => !p.decision || !decisions.has(p.decision) || !p.destination);
  if (!unbacked.length) return [];
  const where = unbacked.map((p) => `\`${esc(p.task.file)}\` row ${p.n}`).join(", ");
  return [`${plural(unbacked.length, "row")} postponed without a resolvable \`D<N>\` and a destination`
    + ` (${where}) — a postponed row is a carry-over only when its decision resolves in decisions.md and it`
    + ` names a destination; otherwise nobody can act on the debt and nothing records who deferred it`];
}
// THE VERDICT LADDER, text and colour from one place, first match wins: red, orange, yellow, green.
function verdictOf({ complete, reasons, unexercised, postponedRows, postponedNote, manualNote, pageName }) {
  if (!complete) {
    // One real miss makes the whole verdict red — postponed items are LISTED alongside, never a way to
    // hide a shortfall.
    return { verdictColour: "red", verdict: `⛔ **NOT COMPLETE** — ${reasons.join(" · ")}${postponedNote}` };
  }
  if (unexercised.length) {
    // Built is not exercised: the run closed every task, but some page was never opened after a save. Ranked above
    // 🟡 because an unchecked page is work for a person now, a postponed row is work for later.
    return { verdictColour: "orange", verdict: `🟠 **BUILT, NOT EXERCISED** — ${plural(unexercised.length, "page")} never`
      + ` opened in a browser after its last save: ${unexercised.map((p) => pageName(p.pageKey)).join(", ")} — check them`
      + ` on the stand (see the browser section)${postponedNote}${manualNote}` };
  }
  if (postponedRows.length) {
    // The 🟡 wording names one decision + destination if every postponed row shares one (the common
    // case — a whole page deferred as one debt), else a plain "N items postponed" summary. The carry-over
    // section carries the full list; this line is the headline.
    const count = postponedRows.length;
    const grouped = postponedGroups(postponedRows);
    const headline = grouped.length === 1
      ? `${plural(count, "item")} postponed per ${grouped[0].decision} → ${grouped[0].destination}`
      : `${plural(count, "item")} postponed across ${plural(grouped.length, "decision")} — see the carry-over section`;
    return { verdictColour: "yellow", verdict: `🟡 **COMPLETE FOR THIS PHASE** — ${headline}${manualNote}` };
  }
  return { verdictColour: "green", verdict: `🟢 **COMPLETE** — every task closed, every machine-checked plan item present${manualNote}` };
}
export function renderFinalReport({ result, verifyRes, set, dir, built = null, repair = null, dirLabel = null, gates = null, source = null }) {
  const ledgerRefused = ledgerReason(set);
  const tasks = planTasks(set?.tasks);
  const tc = taskCounts(tasks);
  const decisions = readDecisions(path.join(dir || ".", ".."));
  const boundaries = assertedBoundaryRows(tasks).map((b) => ({ ...b, refs: decisionRefs(b.row.outcomeReason, decisions) }));
  const { open: openNotBuilt, decided: decidedNotBuilt } = splitDecided(notBuiltOpenItems(tasks), boundaries);
  const unbackedBoundaries = boundaries.filter((b) => !b.refs.resolved.length);
  const rc = rowCounts(verifyRes?.rows);
  const gaps = planGaps(result);
  const pageName = pageNamer(built);
  const vidx = verifyIndex(verifyRes);
  // key on the ROW's own page (a collapsed whole-run task's rows now carry it), so both this set and
  // taskRows' lookup join on (page, label) and state cannot bleed across same-labeled rows on different pages.
  const keyOf = (it) => `${it.row.pageKey || it.task.pageKey} ${labelKey(it.row.label)}`;
  const withLabels = (items) => { const ks = new Set(items.map(keyOf)); ks.hasLabel = new Set(items.map((it) => labelKey(it.row.label))); return ks; };
  const keys = { notBuilt: withLabels(openNotBuilt), decided: withLabels(decidedNotBuilt), unbacked: withLabels(unbackedBoundaries) };
  const perTask = new Map(tasks.map((t) => [t.id, taskRows(t, vidx, keys)]));
  const repairBuilt = repairBuiltIndex(tasks);
  // Left by hand = confirm rows that are neither not-built nor boundaries, counted over the plan-vs-built rows so
  // a row in two tasks (a repair round re-lists its source row) is counted once.
  const flaggedLabels = new Set([...openNotBuilt, ...decidedNotBuilt, ...boundaries].map(keyOf));
  const handLeft = (verifyRes?.rows || []).filter((r) => r.kind === "confirm" && !flaggedLabels.has(`${r.pageKey} ${labelKey(r.deliverable)}`)).length;

  const reasons = verdictReasons({ tc, openNotBuilt, unbackedBoundaries, rc, gaps });
  reasons.push(...unreadableLedgerReasons(tasks), ...driftedSettledReasons(tasks));
  if (ledgerRefused) reasons.unshift(ledgerRefused);
  reasons.push(...naUnbackedReasons(tasks, decisions), ...builderDropReasons(tasks, decisions), ...gateReasons(result, gates));
  // Postponed rows are a DEBT with a destination — not a real miss and not a done row — so the verdict can tell
  // "the machine has nothing left to do, the person has a debt" from "someone still has work here".
  const postponedRows = collectPostponedRows(tasks);
  reasons.push(...postponedUnbackedReasons(postponedRows, decisions));
  const complete = reasons.length === 0;
  const manualNote = handLeft ? `; ${plural(handLeft, "plan item")} still to confirm manually on the stand (see Task details)` : "";
  const postponedCount = postponedRows.length;
  const postponedNote = postponedCount ? `; ${plural(postponedCount, "row")} postponed — see the carry-over section` : "";
  const answerRead = dir ? readWorklogBrowserAnswer(dir) : { line: null, unread: null };
  const exercise = browserExercise(tasks, browserAnswerOf(answerRead.line) === "none");
  // An unread answer is a finding only when a built page's verdict rests on it.
  const browserAnswer = { ...answerRead,
    unread: exercise.exercised.length || exercise.unexercised.length ? answerRead.unread : null };
  const { unexercised } = exercise;
  const { verdict, verdictColour } = verdictOf({ complete, reasons, unexercised, postponedRows, postponedNote, manualNote, pageName });
  const entity = result?.entity ? ` — ${esc(String(result.entity))}` : "";
  const machineOpen = openMachineSection(verifyRes?.rows, pageName);
  const carryOver = carryOverSection(postponedRows, pageName);
  const withoutYou = decidedWithoutYouFor(dir);
  const browser = browserSection(exercise, pageName, browserAnswer);
  const standData = standDataSection(result, tasks, dir ? answerRead : { unread: "no task folder was given" }, pageName);
  let sec = 3;
  const declined = declinedRows(tasks, decisions);
  const md = [
    `# Migration result${entity}`, "",
    `**Verdict:** ${verdict}`, "",
    `> Plan \`${esc(String(set?.planVersion || result?.planVersion || "—"))}\` · task folder \`${esc(String(dirLabel || dir || ""))}\`. Written by`
      + ` \`migrate.mjs --verify ${source || "--from <migration-folder>"} --tasks <dir>\` from the task files AND the built pages — present it`
      + ` verbatim; it supersedes \`build-tasks/index.md\`.`,
    "", "## Summary", "",
    ...summaryTable({ tc, openNotBuilt, decidedNotBuilt, boundaries, declined, rc, repair, handLeft }),
    "", ...decisionsSection(openNotBuilt, pageName, repairBuilt),
    "", ...boundariesSection(boundaries, decidedNotBuilt, pageName, declined),
    ...(carryOver.length ? ["", ...carryOver] : []),
    ...(withoutYou.length ? ["", ...withoutYou] : []),
    ...(browser.length ? ["", ...browser] : []),
    ...(standData.length ? ["", ...standData] : []),
    ...(machineOpen.length ? ["", ...machineOpen] : []),
    "", ...tasksSection(tasks, perTask, pageName, machineOpen.length ? ++sec : sec),
    "", ...detailsSection(tasks, perTask, pageName, sec + 1),
  ].join("\n");
  return { markdown: md, complete, reasons, postponed: postponedRows, verdictColour,
    unexercisedPages: unexercised.map((p) => pageName(p.pageKey)), browserAnswerUnread: browserAnswer.unread,
    counts: { tasks: tc, rows: rc, openNotBuilt: openNotBuilt.length, decidedNotBuilt: decidedNotBuilt.length, boundaries: boundaries.length, unbackedBoundaries: unbackedBoundaries.length, handLeft, postponed: postponedCount,
      unexercised: unexercised.length, capBreaches: exercise.capBreaches.length } };
}

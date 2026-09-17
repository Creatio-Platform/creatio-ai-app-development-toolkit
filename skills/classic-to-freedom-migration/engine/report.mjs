// THE MIGRATION RESULT REPORT — the ONE artifact an orchestrated run closes on (ENG-99126).
//
// Before this module the run ended on two files that disagreed. `--verify` printed the plan-vs-built table and a
// verdict computed from its machine rows alone ("2 machine row(s) not confirmed"); `build-tasks/index.md` — the
// ledger the sub-agents actually wrote — said 10 done, 5 open, 3 partial, three handlers recorded NOT BUILT because
// they need a decision. The agent presented the first and the user read a nearly-green run. Measured on the
// Applicants migration, 2026-09-17.
//
// So the report is computed from BOTH sources and its verdict is the conjunction: a run is COMPLETE only when
// every task is closed, no deliverable stands recorded as not built, every closed task was dispatched, and every
// machine-checked deliverable is present. Anything short of that is NOT COMPLETE, and the first thing the reader
// sees is the reason, in the order a person has to act on them — what needs a decision first, because nothing
// re-dispatches it; then what is still queued; then what the machine could not confirm.
//
// It CONTAINS the plan-vs-built table rather than replacing it: every consumer of that table (the repair round,
// the tests, a reader who wants the evidence per row) keeps it, and the report adds the ledger on top. The
// derived `index.md` stays where it is — this report reads the same task files it does.
//
// Pure rendering: reads the run result, the verify result and the merged task set; writes nothing.
import { esc, planGaps } from "./designspec.mjs";
import { notBuiltOpenItems, assertedBoundaryRows, statusMark, dispatchAudit,
  S_DONE, S_NA, S_PARTIAL, S_IN_PROGRESS, S_TODO, S_BLOCKED } from "./tasks.mjs";

const brief = (s, n = 110) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cell = (s) => esc(String(s ?? ""));

// The cause, said the way the reader has to act on it. `needs-decision` is the one nothing re-dispatches.
const CAUSE_TEXT = {
  "needs-decision": "needs a decision — a person settles it; nothing is re-dispatched until then",
  "blocked": "blocked — the stand or a service was unreachable; a re-run may clear it",
};
const causeText = (it) => {
  if (it.row?.naNoReason) return "recorded `n-a` with NO reason — counts as not built";
  if (!it.cause) return "NOT ACCOUNTED FOR — the task closed without marking this row";
  return CAUSE_TEXT[it.cause] || `${it.cause} — a person decides`;
};

function taskCounts(tasks) {
  const c = { total: tasks.length, done: 0, na: 0, partial: 0, inProgress: 0, todo: 0, blocked: 0, unread: 0, other: 0 };
  for (const t of tasks) {
    if (t.unread) { c.unread++; continue; }
    if (t.status === S_DONE) c.done++;
    else if (t.status === S_NA) c.na++;
    else if (t.status === S_PARTIAL) c.partial++;
    else if (t.status === S_IN_PROGRESS) c.inProgress++;
    else if (t.status === S_TODO) c.todo++;
    else if (t.status === S_BLOCKED) c.blocked++;
    else c.other++;
  }
  c.open = c.partial + c.inProgress + c.todo + c.blocked + c.unread + c.other;
  return c;
}

function rowCounts(rows) {
  const c = { machine: 0, ok: 0, missing: 0, unverified: 0, confirm: 0, na: 0 };
  for (const r of rows || []) {
    if (r.kind === "na") { c.na++; continue; }
    if (r.kind === "confirm") { c.confirm++; continue; }
    c.machine++;
    if (r.outcome === "missing") c.missing++;
    else if (r.outcome === "unverified") c.unverified++;
    else c.ok++;
  }
  return c;
}

// The verdict is a LIST of reasons, never a single flag: a run short in three ways is told all three, and the
// order is the order a person acts on them.
function verdictReasons({ tc, notBuilt, audit, rc, gaps }) {
  const R = [];
  if (gaps.length) R.push(`PLAN-level gap — ${gaps.join(" · ")} (fix the manifest and re-plan; no build round closes this)`);
  if (audit.failing.length) R.push(`${plural(audit.failing.length, "task")} closed with NO dispatch record (the dispatch gate; see the Tasks table)`);
  if (notBuilt.length) {
    const nd = notBuilt.filter((it) => it.cause === "needs-decision" || it.row?.naNoReason || !it.cause).length;
    const bl = notBuilt.length - nd;
    R.push(`${plural(notBuilt.length, "deliverable")} recorded NOT BUILT (${nd} need a decision${bl ? ` · ${bl} blocked` : ""})`);
  }
  if (tc.open) {
    const parts = [];
    if (tc.partial) parts.push(`◐ partial ${tc.partial}`);
    if (tc.inProgress) parts.push(`▶ in-progress ${tc.inProgress}`);
    if (tc.todo) parts.push(`☐ todo ${tc.todo}`);
    if (tc.blocked) parts.push(`⛔ blocked ${tc.blocked}`);
    if (tc.unread || tc.other) parts.push(`⚠ unreadable/unknown ${tc.unread + tc.other}`);
    R.push(`${plural(tc.open, "task")} not closed (${parts.join(" · ")})`);
  }
  if (rc.missing) R.push(`${plural(rc.missing, "machine-checked deliverable")} MISSING from the built page(s)`);
  if (rc.unverified) R.push(`${plural(rc.unverified, "machine row")} not confirmed`);
  return R;
}

function summaryTable({ tc, notBuilt, boundaries, rc, audit, repair }) {
  const L = ["| | |", "| --- | --- |"];
  const taskParts = [`✅ done ${tc.done}`];
  if (tc.na) taskParts.push(`— n/a ${tc.na}`);
  if (tc.partial) taskParts.push(`◐ partial ${tc.partial}`);
  if (tc.inProgress) taskParts.push(`▶ in-progress ${tc.inProgress}`);
  if (tc.todo) taskParts.push(`☐ todo ${tc.todo}`);
  if (tc.blocked) taskParts.push(`⛔ blocked ${tc.blocked}`);
  if (tc.unread || tc.other) taskParts.push(`⚠ unreadable/unknown ${tc.unread + tc.other}`);
  L.push(`| Tasks | ${tc.total} — ${taskParts.join(" · ")} |`);
  const nd = notBuilt.filter((it) => it.cause !== "blocked").length;
  L.push(`| Deliverables recorded NOT BUILT (still open) | ${notBuilt.length}${notBuilt.length ? ` — needs a decision ${nd} · blocked ${notBuilt.length - nd}` : ""} |`);
  L.push(`| Boundaries asserted by the agent (plan did not mark N/A) | ${boundaries.length} |`);
  L.push(`| Machine-checked deliverables | ${rc.machine} — ✅ ${rc.ok} · ❌ missing ${rc.missing} · ⚠ unconfirmed ${rc.unverified} |`);
  L.push(`| Manual confirmation (☐ confirm on-stand) | ${rc.confirm} |`);
  L.push(`| Approved boundaries (N/A in the plan) | ${rc.na} |`);
  const shortfall = audit.failing.length ? ` — ⚠ ${audit.failing.length} closed with NO dispatch record` : "";
  L.push(`| Dispatch | ${audit.dispatched} of ${audit.total} tasks dispatched${shortfall} |`);
  if (repair) {
    const parts = [];
    if (repair.written?.length) parts.push(`wrote ${plural(repair.written.length, "repair task")}`);
    if (repair.pending?.length) parts.push(`${plural(repair.pending.length, "cause")} already have an open repair task`);
    if (repair.parked?.length) parts.push(`⛔ ${plural(repair.parked.length, "cause")} PARKED after the round cap — take to the user`);
    L.push(`| Repair round (this run) | ${parts.length ? parts.join(" · ") : "nothing written — no row was open for it"} |`);
  }
  return L;
}

function notBuiltSection(items) {
  const L = [`## 1. Needs a decision / not built (${items.length})`, ""];
  if (!items.length) { L.push("Nothing — every deliverable a build agent accounted for is on the stand."); return L; }
  L.push("Recorded by the build agents in their own task files. **Nothing here is scheduled again by itself**: a"
    + " `needs-decision` row waits for a person, a `blocked` row waits for a re-run. The reason is under the named"
    + " file's `## Notes`.", "",
    "| # | Page | Deliverable | Why it is open | Recorded in |", "| --- | --- | --- | --- | --- |");
  items.forEach((it, i) => {
    const where = `\`${it.task.file}\` row ${it.n}`;
    const notes = (it.task.notes || "").trim() ? "" : " — ⚠ `## Notes` is EMPTY";
    L.push(`| ${i + 1} | \`${cell(it.task.pageKey)}\` | ${it.row.label} | ${causeText(it)} | ${where}${notes} |`);
  });
  return L;
}

function boundarySection(items) {
  const L = [`## 2. Boundaries the agent asserted (${items.length})`, ""];
  if (!items.length) { L.push("None — every `n-a` in the folder is a boundary the plan itself approved."); return L; }
  L.push("Rows closed as `n-a` where the plan did NOT mark a boundary. Nothing was built for them and nobody but the"
    + " agent said there was nothing to build — confirm each, or send it back as a row to build.", "",
    "| # | Page | Deliverable | Reason given | Recorded in |", "| --- | --- | --- | --- | --- |");
  items.forEach((it, i) => {
    L.push(`| ${i + 1} | \`${cell(it.task.pageKey)}\` | ${it.row.label} | ${cell(brief(it.row.outcomeReason, 140))} | \`${it.task.file}\` row ${it.n} |`);
  });
  return L;
}

function openMachineSection(rows) {
  const open = (rows || []).filter((r) => r.kind === "machine" && (r.outcome === "missing" || r.outcome === "unverified"));
  const L = [`## 3. Machine check — rows still open (${open.length})`, ""];
  if (!open.length) { L.push("None — every machine-checked deliverable is present on the built page(s)."); return L; }
  L.push("The plan-vs-built rows the engine could not close from the `--built` payload. ❌ is a thing to build; ⚠ is"
    + " a thing to confirm or a record to file. Row numbers are the full table's (section 6).", "",
    "| # | Page | Deliverable | Status | Evidence (built page) |", "| --- | --- | --- | --- | --- |");
  for (const r of open) L.push(`| ${r.n} | \`${cell(r.pageKey)}\` | ${r.deliverable} | ${r.status} | ${cell(r.evidence)} |`);
  return L;
}

const DISPATCH_MARK = new Map([["yes", "✔ yes"], ["started", "▶ started"], ["never", "⚠ never"], ["pending", "—"]]);
function tasksSection(tasks, notBuilt) {
  const byTask = new Map();
  for (const it of notBuilt) byTask.set(it.task.id, (byTask.get(it.task.id) || 0) + 1);
  const sorted = [...tasks].sort((a, b) => Number(a.step ?? a.order) - Number(b.step ?? b.order));
  const L = [`## 4. Tasks (${tasks.length})`, "",
    "The ledger, one row per task file. `Status` is computed from each file's own `Outcome` cells — a `partial` task"
    + " has rows it did not build, listed in section 1.", "",
    "| Step | Task | Page | Status | Dispatched | Not built | File |", "| --- | --- | --- | --- | --- | --- | --- |"];
  for (const t of sorted) {
    const mark = t.unread ? "⚠ unread" : statusMark(t.status);
    const nb = byTask.get(t.id) || 0;
    L.push(`| ${t.step ?? t.order} | ${cell(t.group || t.title || t.id)} | \`${cell(t.pageKey)}\` | ${mark} | ${DISPATCH_MARK.get(t.dispatched) || "—"} | ${nb || "—"} | [${t.file}](${t.file}) |`);
  }
  return L;
}

// A confirm-on-stand row whose deliverable the LEDGER says was not built (section 1) or was closed as a boundary
// (section 2) is flagged inline: a reader sent to confirm a handler on the stand should not go looking for one
// the build agent recorded as not there. Matched on the deliverable label, which is the same text in both places.
function confirmSection(rows, notBuilt, boundaries) {
  const confirm = (rows || []).filter((r) => r.kind === "confirm");
  const L = [`## 5. Manual follow-up — confirm on-stand (${confirm.length})`, ""];
  if (!confirm.length) { L.push("None — every deliverable of this plan was machine-checkable."); return L; }
  const flagged = new Map();
  for (const it of notBuilt) flagged.set(it.row.label, "⚠ recorded NOT BUILT — see section 1; nothing to confirm on the stand");
  for (const it of boundaries) if (!flagged.has(it.row.label)) flagged.set(it.row.label, "ℹ closed as a boundary by the agent — see section 2");
  const flaggedCount = confirm.filter((r) => flagged.has(r.deliverable)).length;
  L.push("Deliverables `get-page` cannot show (handlers, layout by tab, child-page routing). They are on the stand"
    + " if the task that built them says so — open the page and confirm each; the task files carry the numbered checks."
    + (flaggedCount ? ` ${plural(flaggedCount, "row")} below ${flaggedCount === 1 ? "is" : "are"} flagged because the ledger says otherwise.` : ""), "");
  const byPage = new Map();
  for (const r of confirm) { if (!byPage.has(r.pageKey)) byPage.set(r.pageKey, []); byPage.get(r.pageKey).push(r); }
  for (const [page, list] of byPage) {
    L.push(`**\`${cell(page)}\`** (${list.length})`, "");
    for (const r of list) L.push(`- row ${r.n} · ${r.deliverable}${flagged.has(r.deliverable) ? ` — ${flagged.get(r.deliverable)}` : ""}`);
    L.push("");
  }
  return L;
}

// `set` is the MERGED task set (`syncRepairDir(...).set` or `readMergedTaskDir`) — never raw `readTaskDir` output,
// whose rows carry no plan `na` and would report every approved boundary as agent-asserted.
// `dir` is read (the dispatch audit needs the folder's clocks); `dirLabel` is only what the report PRINTS for it —
// a caller that wants the folder named relative to the migration folder rather than by machine path passes it.
export function renderFinalReport({ result, verifyRes, set, dir, repair = null, dirLabel = null }) {
  const tasks = set?.tasks || [];
  const tc = taskCounts(tasks);
  const notBuilt = notBuiltOpenItems(tasks);
  const boundaries = assertedBoundaryRows(tasks);
  const audit = dispatchAudit(tasks, dir);
  const rc = rowCounts(verifyRes?.rows);
  const gaps = planGaps(result);
  const reasons = verdictReasons({ tc, notBuilt, audit, rc, gaps });
  const complete = reasons.length === 0;
  const verdict = complete
    ? `✅ **COMPLETE** — every task closed, every machine-checked deliverable present${rc.confirm ? `; ${plural(rc.confirm, "row")} in section 5 still need a manual on-stand confirmation` : ""}`
    : `⛔ **NOT COMPLETE** — ${reasons.join(" · ")}`;
  const entity = result?.entity ? ` — ${esc(String(result.entity))}` : "";
  const md = [
    `# Migration result${entity}`, "",
    `**Verdict:** ${verdict}`, "",
    `> Plan \`${set?.planVersion || result?.planVersion || "—"}\` · task folder \`${esc(String(dirLabel || dir || ""))}\`. Written by`
      + " `migrate.mjs --verify --built <file> --tasks <dir>` from the task files AND the built pages — present it"
      + " verbatim. It supersedes `build-tasks/index.md` and the plan-vs-built table alone; both are inside it.",
    "", "## Summary", "",
    ...summaryTable({ tc, notBuilt, boundaries, rc, audit, repair }),
    "", ...notBuiltSection(notBuilt),
    "", ...boundarySection(boundaries),
    "", ...openMachineSection(verifyRes?.rows),
    "", ...tasksSection(tasks, notBuilt),
    "", ...confirmSection(verifyRes?.rows, notBuilt, boundaries),
    "", "## 6. Plan-vs-built — the full machine table", "",
    (verifyRes?.markdown || "").replace(/^### /, "#### "),
  ].join("\n");
  return { markdown: md, complete, reasons, counts: { tasks: tc, rows: rc, notBuilt: notBuilt.length, boundaries: boundaries.length, dispatch: { dispatched: audit.dispatched, total: audit.total, failing: audit.failing.length } } };
}

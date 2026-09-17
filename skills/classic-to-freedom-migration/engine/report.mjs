// THE MIGRATION RESULT REPORT — the ONE artifact an orchestrated run closes on (ENG-99126).
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
import { esc, planGaps } from "./designspec.mjs";
import { notBuiltOpenItems, assertedBoundaryRows, statusMark, ARTIFACT_REFS,
  S_DONE, S_NA, S_PARTIAL, S_IN_PROGRESS, S_TODO, S_BLOCKED } from "./tasks.mjs";

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
export const DECISION_MARKER = /^\s*(?:[-*>]\s*)?\**\s*Decision needed \(row (\d+)\)\s*:?\**\s*(.+?)\s*$/i;
export const CHECK_MARKER = /^\s*(?:[-*>]\s*)?\**\s*Check on stand \(row (\d+)\)\s*:?\**\s*(.+?)\s*$/i;
function markers(notes, re) {
  const out = new Map();
  for (const line of String(notes || "").split(/\r?\n/)) {
    const m = re.exec(line);
    if (m && !out.has(Number(m[1]))) out.set(Number(m[1]), m[2].trim());
  }
  return out;
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
const plainText = (s) => String(s || "").replace(/\*\*|__|(?<!\w)\*(?!\s)|(?<!\s)\*(?!\w)/g, "").replace(/^\s*[-*>]\s+/gm, "").replace(/\s+/g, " ").trim();
function decisionFallback(notes, n) {
  const block = rowNotesBlock(notes, n);
  const sentences = plainText(block).split(/(?<=[.!?])\s+/);
  const hits = sentences.filter((s) => /\b(decision|options?|either|needs (a person|your call)|choose|the user decides|what .* needs from me)\b/i.test(s));
  return hits.length ? brief(hits.slice(0, 2).join(" "), 260) : "";
}

// --- decisions.md / plan.md Adjustments: what a reason's `D<N>` / `Adjustment N` points at --------------------
function readDecisions(migrationDir) {
  const out = new Map();
  try {
    const text = fs.readFileSync(path.join(migrationDir, "decisions.md"), "utf8");
    for (const m of text.matchAll(/^#{1,4}\s+D(\d+)\s*[—–-]\s*(.+?)\s*$/gm)) out.set(`D${m[1]}`, m[2].trim());
  } catch { /* no decisions file — every reference is then "not found", which the report says */ }
  try {
    const plan = fs.readFileSync(path.join(migrationDir, "plan.md"), "utf8");
    const tail = plan.slice(plan.search(/^###\s+Adjustments/m));
    if (tail) for (const m of tail.matchAll(/^(\d+)\.\s+\*\*(.+?)\*\*/gm)) out.set(`Adjustment ${m[1]}`, m[2].trim());
  } catch { /* same */ }
  return out;
}
// The decision references a reason carries: `D4`, `D18 user decision`, `Adjustment 2`. `resolved` is what the
// files say those are; `missing` is a reference nothing recorded.
function decisionRefs(reason, decisions) {
  const refs = [...String(reason || "").matchAll(/\b(D\d{1,3})\b|\b(Adjustment\s+\d+)\b/gi)]
    .map((m) => m[1] ? m[1].toUpperCase() : m[2].replace(/\s+/g, " ").replace(/^a/, "A"));
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
  const idx = new Map();
  for (const r of verifyRes?.rows || []) idx.set(`${r.pageKey} ${labelKey(r.deliverable)}`, r);
  return idx;
}
function howVerified(vrow) {
  if (!vrow) return { how: "unknown", ok: false };
  if (vrow.kind === "na" || vrow.kind === "info") return { how: "na", ok: true };
  if (vrow.kind === "confirm") return { how: "hand", ok: false };
  if (vrow.vkType === "evidence") return { how: "judge", ok: vrow.outcome === "ok" };
  return { how: "machine", ok: vrow.outcome === "ok" };
}
const HOW_TEXT = { machine: "✅ machine — read off the built page", judge: "✅ evidence filed + judged convincing",
  hand: "☐ confirm manually", na: "— approved boundary (N/A in the plan)", unknown: "— not in this run's plan-vs-built table" };

// --- the ledger, as the report sees it ------------------------------------------------------------------------
function planTasks(tasks) {
  // The reference cache is the engine's own preparation (guidance fetched into `refs/`, nothing built on the
  // stand) — not a plan task, so not a row the user reads. Everything else, repair rounds included, is listed.
  return (tasks || []).filter((t) => t.artifact !== ARTIFACT_REFS)
    .sort((a, b) => Number(a.step ?? a.order) - Number(b.step ?? b.order));
}
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
const statusParts = (tc) => {
  const p = [`✅ done ${tc.done}`];
  if (tc.na) p.push(`— n/a ${tc.na}`);
  if (tc.partial) p.push(`◐ partial ${tc.partial}`);
  if (tc.inProgress) p.push(`▶ in progress ${tc.inProgress}`);
  if (tc.todo) p.push(`☐ queued ${tc.todo}`);
  if (tc.blocked) p.push(`⛔ blocked ${tc.blocked}`);
  if (tc.unread || tc.other) p.push(`⚠ unreadable/unknown ${tc.unread + tc.other}`);
  return p;
};

// A `needs-decision` row that a LATER row (a repair round) closed `n-a` citing a recorded decision is decided —
// the decision exists, the person made it, only the ledger has not caught up (the repair task closes its source
// row when it closes). Such an item is reported under the boundaries WITH a decision, not as an open question.
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

function verdictReasons({ tc, openNotBuilt, unbackedBoundaries, rc, gaps }) {
  const R = [];
  if (gaps.length) R.push(`PLAN-level gap — ${gaps.join(" · ")} (fix the manifest and re-plan; no build round closes this)`);
  if (openNotBuilt.length) {
    const nd = openNotBuilt.filter((it) => it.cause !== "blocked").length;
    const bl = openNotBuilt.length - nd;
    R.push(`${plural(openNotBuilt.length, "plan item")} recorded NOT BUILT (${nd} need${nd === 1 ? "s" : ""} a decision${bl ? ` · ${bl} blocked` : ""})`);
  }
  if (unbackedBoundaries.length) R.push(`${plural(unbackedBoundaries.length, "boundary", "boundaries")} closed by the agent with NO recorded decision`);
  if (tc.open) R.push(`${plural(tc.open, "task")} not closed (${statusParts(tc).filter((s) => !s.startsWith("✅") && !s.startsWith("— n/a")).join(" · ")})`);
  if (rc.missing) R.push(`${plural(rc.missing, "machine-checked plan item")} MISSING from the built page(s)`);
  if (rc.unverified) R.push(`${plural(rc.unverified, "machine row")} not confirmed`);
  return R;
}

function rowCounts(rows) {
  const c = { machine: 0, machineOk: 0, judge: 0, judgeOk: 0, hand: 0, na: 0, missing: 0, unverified: 0 };
  for (const r of rows || []) {
    const { how, ok } = howVerified(r);
    if (how === "na") { c.na++; continue; }
    if (how === "hand") { c.hand++; continue; }
    if (how === "judge") { c.judge++; if (ok) c.judgeOk++; }
    else { c.machine++; if (ok) c.machineOk++; }
    if (r.outcome === "missing") c.missing++;
    else if (r.outcome === "unverified") c.unverified++;
  }
  return c;
}

// --- sections -------------------------------------------------------------------------------------------------
function summaryTable({ tc, openNotBuilt, decidedNotBuilt, boundaries, rc, repair, handLeft }) {
  const L = ["| | |", "| --- | --- |"];
  L.push(`| Tasks | ${tc.total} — ${statusParts(tc).join(" · ")} |`);
  L.push(`| Open questions (plan items recorded NOT BUILT, no decision yet) | ${openNotBuilt.length} |`);
  if (decidedNotBuilt.length) L.push(`| Plan items not built BY DECISION | ${decidedNotBuilt.length} |`);
  const withRef = boundaries.filter((b) => b.refs.resolved.length).length;
  L.push(`| Boundaries the agent closed | ${boundaries.length}${boundaries.length ? ` — with a recorded decision ${withRef} · without ${boundaries.length - withRef}` : ""} |`);
  L.push(`| Plan items confirmed (on the built page, or by review) | ${rc.machineOk + rc.judgeOk}/${rc.machine + rc.judge} |`);
  L.push(`| Plan items to confirm manually | ${handLeft} |`);
  if (repair) {
    const parts = [];
    if (repair.written?.length) parts.push(`wrote ${plural(repair.written.length, "repair task")}`);
    if (repair.pending?.length) parts.push(`${plural(repair.pending.length, "cause")} already have an open repair task`);
    if (repair.parked?.length) parts.push(`⛔ ${plural(repair.parked.length, "cause")} PARKED after the round cap — take to the user`);
    if (parts.length) L.push(`| Repair round (this run) | ${parts.join(" · ")} |`);
  }
  return L;
}

const where = (it) => `[${cell(it.task.group || it.task.id)}](${it.task.file}), row ${it.n}`;

// A LATER round that recorded the same row `built` and has not closed yet: the question may already be answered
// on the stand, and the reader should know before deciding anything. Keyed by (page, label).
function repairBuiltIndex(tasks) {
  const idx = new Map();
  for (const t of tasks) {
    if (!(t.kind === "repair" || Number(t.repairRound) > 0)) continue;
    for (const r of t.rows || []) if (r.outcomeKind === "built") idx.set(`${t.pageKey} ${labelKey(r.label)}`, t);
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
    if (it.row?.naNoReason) text = "the row was closed `n-a` with NO reason — decide whether it is a boundary or a row to build";
    else if (it.cause === "blocked") text = "none — the stand or a service was unreachable; a re-run may clear it";
    else if (!it.cause) text = "the task closed without accounting for this row — decide whether it was built";
    else {
      const marker = markers(it.task.notes, DECISION_MARKER).get(it.n);
      const fallback = marker ? "" : decisionFallback(it.task.notes, it.n);
      text = marker ? cell(marker)
        : fallback ? `${cell(fallback)} *(from the row's notes — the agent wrote no \`Decision needed\` line)*`
          : "⚠ the agent recorded `needs-decision` but did not state the question — read the row's notes";
    }
    L.push(`| ${i + 1} | ${pageName(it.task.pageKey)} | ${it.row.label} | ${text}${laterNote} | ${where(it)} |`);
  });
  return L;
}

function boundariesSection(boundaries, decidedNotBuilt, pageName) {
  // A boundary row that is the decision behind a not-built item is rendered ONCE, as that item's entry.
  const deciding = new Set(decidedNotBuilt.map((it) => it.decidedBy));
  const withRef = boundaries.filter((b) => b.refs.resolved.length && !deciding.has(b));
  const without = boundaries.filter((b) => !b.refs.resolved.length);
  const L = [`## 2. Boundaries the agent closed (${withRef.length + without.length + decidedNotBuilt.length})`, ""];
  if (!boundaries.length && !decidedNotBuilt.length) { L.push("None — every `n-a` in the folder is a boundary the plan itself approved."); return L; }
  if (without.length) {
    L.push(`**Without a recorded decision (${without.length}) — confirm each, or send it back as a row to build.**`
      + " Nothing was built for these and nobody but the agent said there was nothing to build.", "",
      "| # | Page | Plan item | Reason the agent gave | Recorded in |", "| --- | --- | --- | --- | --- |");
    without.forEach((b, i) => {
      const miss = b.refs.missing.length ? ` — ⚠ cites ${b.refs.missing.join(", ")}, not found in decisions.md / the plan's Adjustments` : "";
      L.push(`| ${i + 1} | ${pageName(b.task.pageKey)} | ${b.row.label} | ${cell(brief(b.row.outcomeReason, 160))}${miss} | ${where(b)} |`);
    });
    L.push("");
  }
  if (withRef.length || decidedNotBuilt.length) {
    L.push(`**Closed by a recorded decision (${withRef.length + decidedNotBuilt.length}) — for information.**`, "",
      "| # | Page | Plan item | Decision | Recorded in |", "| --- | --- | --- | --- | --- |");
    let i = 0;
    for (const b of withRef) {
      const d = b.refs.resolved.map((r) => `**${r.ref}** — ${cell(r.title)}`).join("; ");
      L.push(`| ${++i} | ${pageName(b.task.pageKey)} | ${b.row.label} | ${d} | ${where(b)} |`);
    }
    for (const it of decidedNotBuilt) {
      const d = it.decidedBy.refs.resolved.map((r) => `**${r.ref}** — ${cell(r.title)}`).join("; ");
      L.push(`| ${++i} | ${pageName(it.task.pageKey)} | ${it.row.label} | ${d} · *not built by this decision; recorded in [${cell(it.task.group)}](${it.task.file}) row ${it.n}, which closes when the repair task closes* | ${where(it.decidedBy)} |`);
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
  for (const r of open) L.push(`| ${r.n} | ${pageName(r.pageKey)} | ${r.deliverable} | ${r.status} | ${cell(r.evidence)} |`);
  return L;
}

// Per task: its rows joined to the verify rows, so the ledger says HOW each task was verified.
// States: machine / judge (confirmed) · hand (a plan item only a person can confirm) · extra (a row that is not a
// plan item — an orchestrator-authored repair task's own checklist; recorded by its agent, nothing verifies it) ·
// not-built / decided / boundary / na · open (no outcome yet, or the machine could not confirm it).
function taskRows(t, vidx, keys) {
  return (t.rows || []).map((r, i) => {
    const key = `${t.pageKey} ${labelKey(r.label)}`;
    const v = vidx.get(key);
    const hv = howVerified(v);
    let state;
    if (keys.notBuilt.has(key) && r.outcomeKind === "not-built") state = "not-built";
    else if (keys.decided.has(key) && (r.outcomeKind === "not-built" || r.outcomeKind === "n-a")) state = "decided";
    else if (r.outcomeKind === "n-a") state = keys.unbacked.has(key) ? "boundary" : "na";
    else if (r.na || r.info || hv.how === "na") state = "na";
    else if (!r.outcomeKind) state = "open";
    else if (hv.how === "hand") state = "hand";
    else if (hv.how === "unknown") state = "extra";
    else state = hv.ok ? hv.how : "open";
    return { n: i + 1, label: r.label, outcome: r.outcome || "—", v, hv, state };
  });
}
const num = (secNo, title) => `## ${secNo}. ${title}`;

function tasksSection(tasks, perTask, pageName, secNo) {
  const L = [num(secNo, `Tasks (${tasks.length})`), "",
    "One row per task file. `Status` is computed from the task's own `Outcome` cells. The two confirmation columns"
    + " count the task's plan items: **Confirmed** — the engine found the item on the built page (read through get-page), or the build"
    + " agent's evidence record was found convincing by a separate reviewer; **To confirm manually** — nobody yet, a person has to open the page.", "",
    "| Step | Task | Page | Status | Confirmed | To confirm manually | Not built |",
    "| --- | --- | --- | --- | --- | --- | --- |"];
  tasks.forEach((t, i) => {
    const rows = perTask.get(t.id) || [];
    const count = (pred) => rows.filter(pred).length;
    // Denominators leave out the rows the agent closed as a boundary / by decision: a Print button the plan said
    // not to migrate is not a machine row the task failed to confirm.
    const closedOtherwise = (r) => ["na", "decided", "boundary", "not-built"].includes(r.state);
    const machine = count((r) => r.hv.how === "machine" && !closedOtherwise(r)), machineOk = count((r) => r.state === "machine");
    const judge = count((r) => r.hv.how === "judge" && !closedOtherwise(r)), judgeOk = count((r) => r.state === "judge");
    const hand = count((r) => r.state === "hand" || r.state === "open");
    const extra = count((r) => r.state === "extra");
    const nb = rows.filter((r) => r.state === "not-built").map((r) => `${r.label} *(needs a decision)*`);
    const dec = rows.filter((r) => r.state === "decided").map((r) => `${r.label} *(by decision)*`);
    const mark = t.unread ? "⚠ unread" : statusMark(t.status).replace("in-progress", "in progress").replace("todo", "queued");
    const handCell = hand ? `${hand}${extra ? ` (+${extra} not in the plan)` : ""}` : (extra ? `(${extra} not in the plan)` : "—");
    L.push(`| ${i + 1} | [${cell(t.group || t.title || t.id)}](${t.file}) | ${pageName(t.pageKey)} | ${mark} | ${machine + judge ? `${machineOk + judgeOk}/${machine + judge}` : "—"} | ${handCell} | ${[...nb, ...dec].join("<br>") || "—"} |`);
  });
  return L;
}

const SETTLED_STATES = new Set(["machine", "judge", "na", "decided", "extra"]);
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
    L.push(`**${tasks.indexOf(t) + 1}. [${cell(t.group || t.id)}](${t.file})** — ${pageName(t.pageKey)} · ${statusMark(t.status)}`, "",
      "| # | Plan item | Build agent recorded | What closes it |", "| --- | --- | --- | --- |");
    for (const r of rows) {
      let how;
      if (r.state === "not-built") how = "decision needed — see section 1";
      else if (r.state === "boundary") how = "confirm the boundary — see section 2";
      else if (r.state === "open" && (!r.outcome || r.outcome === "—")) how = `— no outcome recorded yet (task ${statusMark(t.status)})`;
      else if (r.state === "open") how = r.v ? `${r.v.status} — ${cell(brief(r.v.evidence, 140))}` : "⚠ recorded by the agent but not in this run's plan-vs-built table";
      else {
        const c = checks.get(r.n);
        how = c ? `☐ confirm manually — ${cell(c)}` : `☐ confirm manually — no \`Check on stand\` line; the check is in the task's notes (row ${r.n})`;
      }
      L.push(`| ${r.n} | ${r.label} | ${cell(r.outcome)} | ${how} |`);
    }
    L.push("");
  }
  return L;
}

// `set` is the MERGED task set (`syncRepairDir(...).set` or `readMergedTaskDir`) — never raw `readTaskDir` output,
// whose rows carry no plan `na` and would report every approved boundary as agent-asserted. `dir` is the task
// folder (decisions.md / plan.md are read from its parent); `dirLabel` is only what the report prints for it.
// `tableFile` names the file the full plan-vs-built table was written to; without one the table is appended.
export function renderFinalReport({ result, verifyRes, set, dir, built = null, repair = null, dirLabel = null, tableFile = null }) {
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
  const keyOf = (it) => `${it.task.pageKey} ${labelKey(it.row.label)}`;
  const keys = { notBuilt: new Set(openNotBuilt.map(keyOf)), decided: new Set(decidedNotBuilt.map(keyOf)), unbacked: new Set(unbackedBoundaries.map(keyOf)) };
  const perTask = new Map(tasks.map((t) => [t.id, taskRows(t, vidx, keys)]));
  const repairBuilt = repairBuiltIndex(tasks);
  // Left by hand = confirm rows that are neither not-built nor boundaries, counted over the plan-vs-built rows so
  // a row in two tasks (a repair round re-lists its source row) is counted once.
  const flaggedLabels = new Set([...openNotBuilt, ...decidedNotBuilt, ...boundaries].map(keyOf));
  const handLeft = (verifyRes?.rows || []).filter((r) => r.kind === "confirm" && !flaggedLabels.has(`${r.pageKey} ${labelKey(r.deliverable)}`)).length;

  const reasons = verdictReasons({ tc, openNotBuilt, unbackedBoundaries, rc, gaps });
  const complete = reasons.length === 0;
  const verdict = complete
    ? `✅ **COMPLETE** — every task closed, every machine-checked plan item present${handLeft ? `; ${plural(handLeft, "plan item")} still to confirm manually on the stand (see Task details)` : ""}`
    : `⛔ **NOT COMPLETE** — ${reasons.join(" · ")}`;
  const entity = result?.entity ? ` — ${esc(String(result.entity))}` : "";
  const machineOpen = openMachineSection(verifyRes?.rows, pageName);
  let sec = 3;
  const tableNote = tableFile
    ? `The full plan-vs-built table (every row with its evidence) is in [${cell(path.basename(tableFile))}](${cell(path.basename(tableFile))}).`
    : "The full plan-vs-built table (every row with its evidence) is appended below.";
  const md = [
    `# Migration result${entity}`, "",
    `**Verdict:** ${verdict}`, "",
    `> Plan \`${set?.planVersion || result?.planVersion || "—"}\` · task folder \`${esc(String(dirLabel || dir || ""))}\`. Written by`
      + " `migrate.mjs --verify --built <file> --tasks <dir>` from the task files AND the built pages — present it"
      + ` verbatim; it supersedes \`build-tasks/index.md\`. ${tableNote}`,
    "", "## Summary", "",
    ...summaryTable({ tc, openNotBuilt, decidedNotBuilt, boundaries, rc, repair, handLeft }),
    "", ...decisionsSection(openNotBuilt, pageName, repairBuilt),
    "", ...boundariesSection(boundaries, decidedNotBuilt, pageName),
    ...(machineOpen.length ? ["", ...machineOpen] : []),
    "", ...tasksSection(tasks, perTask, pageName, machineOpen.length ? ++sec : sec),
    "", ...detailsSection(tasks, perTask, pageName, sec + 1),
    ...(tableFile ? [] : ["", "## Appendix — plan-vs-built, the full machine table", "", (verifyRes?.markdown || "").replace(/^### /, "#### ")]),
  ].join("\n");
  return { markdown: md, complete, reasons,
    counts: { tasks: tc, rows: rc, openNotBuilt: openNotBuilt.length, decidedNotBuilt: decidedNotBuilt.length, boundaries: boundaries.length, unbackedBoundaries: unbackedBoundaries.length, handLeft } };
}

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
import { esc, planGaps } from "./designspec.mjs";
import { unreadableLedger, notBuiltOpenItems, assertedBoundaryRows, statusMark, ARTIFACT_REFS,
  S_DONE, S_NA, S_PARTIAL, S_IN_PROGRESS, S_TODO, S_BLOCKED, REFUSED_UNREADABLE } from "./tasks.mjs";

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
export const DECISION_MARKER = /^[\s*>-]*Decision needed \(row (\d+)\)[\s:*]*([^\s:*].*)$/i;
export const CHECK_MARKER = /^[\s*>-]*Check on stand \(row (\d+)\)[\s:*]*([^\s:*].*)$/i;
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
function readDecisions(migrationDir) {
  const out = new Map();
  // A heading keeps its title verbatim (bar the leading separator); a table cell / plain line goes through
  // decisionTitle, which lifts the bold lead and caps a long cell. Headings are last-wins (a later heading refines
  // an earlier one); table/plain are first-wins.
  const addHeading = (id, raw) => { const t = String(raw || "").replace(/^[\s—–:.-]+/, "").trim(); if (t) out.set(`D${id}`, t); };
  const add = (id, raw) => { const k = `D${id}`; const t = decisionTitle(raw); if (t && !out.has(k)) out.set(k, t); };
  try {
    const text = fs.readFileSync(path.join(migrationDir, "decisions.md"), "utf8");
    const lines = text.split(/\r?\n/);
    // `references/migration-documentation.md` sanctions three shapes. STRUCTURED decisions — a markdown HEADING
    // (`## D1 — …`) or a TABLE ROW (`| D1 | **title** | … |`) — are authoritative and are read first.
    let structured = false;
    for (const dl of lines) {
      const h = /^#{1,4}\s+D(\d+)\b(.*)$/.exec(dl);
      if (h) { addHeading(h[1], h[2]); structured = true; continue; }
      const t = /^\s*\|\s*D(\d+)\s*\|([^|]*)\|/.exec(dl);   // table row — second cell is the title ([^|] can't cross the cell)
      if (t) { add(t[1], t[2]); structured = true; }
    }
    // A plain dated line (`D1 — …` / `D1: …`) is read ONLY when the file carries no structured decisions, so a prose
    // line like `D2 — still waiting on the user` inside a heading/table file cannot register a decision.
    if (!structured) for (const dl of lines) {
      const p = /^\s*D(\d+)[)\s—–:.-]+([^)\s—–:.-].*)$/.exec(dl);   // one separator run, then capture from the first real char
      if (p) add(p[1], p[2]);
    }
  } catch { /* no decisions file — every reference is then "not found", which the report says */ }
  try {
    const plan = fs.readFileSync(path.join(migrationDir, "plan.md"), "utf8");
    const at = plan.search(/^###\s+Adjustments/m);
    if (at >= 0) for (const m of plan.slice(at).matchAll(/^(\d+)\.\s+\*\*(.+?)\*\*/gm)) out.set(`Adjustment ${m[1]}`, m[2].trim());
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
  if (tc.open) R.push(`${plural(tc.open, "task")} not closed (${statusParts(tc).filter((s) => !s.startsWith("✅") && !s.startsWith("— n/a")).join(" · ")})`);
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
function summaryTable({ tc, openNotBuilt, decidedNotBuilt, boundaries, rc, repair, handLeft }) {
  const withRef = boundaries.filter((b) => b.refs.resolved.length).length;
  const boundNote = boundaries.length ? ` — with a recorded decision ${withRef} · without ${boundaries.length - withRef}` : "";
  const L = ["| | |", "| --- | --- |",
    `| Tasks | ${tc.total} — ${statusParts(tc).join(" · ")} |`,
    `| Open questions (plan items recorded NOT BUILT, no decision yet) | ${openNotBuilt.length} |`,
    ...(decidedNotBuilt.length ? [`| Plan items not built BY DECISION | ${decidedNotBuilt.length} |`] : []),
    `| Boundaries the agent closed | ${boundaries.length}${boundNote} |`,
    `| Plan items confirmed (on the built page, or by review) | ${rc.machineOk + rc.judgeOk}/${rc.machine + rc.judge} |`,
    `| Plan items to confirm manually | ${handLeft} |`];
  if (repair) {
    const parts = [];
    if (repair.written?.length) parts.push(`wrote ${plural(repair.written.length, "repair task")}`);
    if (repair.pending?.length) parts.push(`${plural(repair.pending.length, "cause")} already have an open repair task`);
    if (repair.parked?.length) parts.push(`⛔ ${plural(repair.parked.length, "cause")} PARKED after the round cap — take to the user`);
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
      if (marker) text = cell(marker);
      else if (fallback) text = `${cell(fallback)} *(from the row's notes — the agent wrote no \`Decision needed\` line)*`;
      else text = "⚠ the agent recorded `needs-decision` but did not state the question — read the row's notes";
    }
    L.push(`| ${i + 1} | ${pageName(it.row.pageKey || it.task.pageKey)} | ${cell(it.row.label)} | ${text}${laterNote} | ${where(it)} |`);
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
    let state;
    const inSet = (set) => set.has(key) || (wholeRun && !!set.hasLabel?.has(lk));
    if (inSet(keys.notBuilt) && r.outcomeKind === "not-built") state = "not-built";
    else if (inSet(keys.decided) && (r.outcomeKind === "not-built" || r.outcomeKind === "n-a")) state = "decided";
    else if (r.outcomeKind === "n-a") state = inSet(keys.unbacked) ? "boundary" : "na";
    else if (r.na || r.info || hv.how === "na") state = "na";
    else if (!r.outcomeKind) state = "open";
    else if (hv.how === "hand") state = "hand";
    else if (hv.how === "unknown") state = "extra";
    else state = hv.ok ? hv.how : "open";
    return { n: i + 1, label: r.label, outcome: r.outcome || "—", v, hv, state };
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

export function renderFinalReport({ result, verifyRes, set, dir, built = null, repair = null, dirLabel = null, gates = null }) {
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
  // A task closed `n/a` is the agent's own decision (like a row-level n-a boundary): it must cite a recorded decision
  // and must not leave plan rows unaccounted while the run reads COMPLETE.
  const naUnbacked = tasks.filter((t) => t.status === S_NA
    && (!decisionRefs(t.notes || "", decisions).resolved.length || (t.rows || []).some((r) => !r.outcomeKind && !r.na)));
  if (naUnbacked.length) reasons.push(`${plural(naUnbacked.length, "task")} closed n/a with no recorded decision (or with rows left unaccounted)`);
  // The verdict is the CONJUNCTION over every gate the CLI exits 2 on — gate / structure / coverage / list read from
  // `result`, the dispatch gate passed in from migrate.mjs — so the report can never read ✅ COMPLETE on a rejected run.
  if (result?.gate?.blocked) reasons.push("the build gate is BLOCKED — the plan is not approvable");
  if (result?.structure && !result.structure.complete) reasons.push("the plan STRUCTURE is incomplete — not ready to build");
  if (result?.coverage && !result.coverage.complete) reasons.push("schema members are UNACCOUNTED — no Freedom artifact and no decision");
  if (result?.listGate?.blocked) reasons.push("the LIST page gate is BLOCKED — the list page is not approvable");
  if (gates?.dispatchFailed) reasons.push("the DISPATCH gate failed — a task was closed with no dispatch token");
  const complete = reasons.length === 0;
  const manualNote = handLeft ? `; ${plural(handLeft, "plan item")} still to confirm manually on the stand (see Task details)` : "";
  const verdict = complete
    ? `✅ **COMPLETE** — every task closed, every machine-checked plan item present${manualNote}`
    : `⛔ **NOT COMPLETE** — ${reasons.join(" · ")}`;
  const entity = result?.entity ? ` — ${esc(String(result.entity))}` : "";
  const machineOpen = openMachineSection(verifyRes?.rows, pageName);
  let sec = 3;
  const md = [
    `# Migration result${entity}`, "",
    `**Verdict:** ${verdict}`, "",
    `> Plan \`${esc(String(set?.planVersion || result?.planVersion || "—"))}\` · task folder \`${esc(String(dirLabel || dir || ""))}\`. Written by`
      + " `migrate.mjs --verify --built <file> --tasks <dir>` from the task files AND the built pages — present it"
      + ` verbatim; it supersedes \`build-tasks/index.md\`.`,
    "", "## Summary", "",
    ...summaryTable({ tc, openNotBuilt, decidedNotBuilt, boundaries, rc, repair, handLeft }),
    "", ...decisionsSection(openNotBuilt, pageName, repairBuilt),
    "", ...boundariesSection(boundaries, decidedNotBuilt, pageName),
    ...(machineOpen.length ? ["", ...machineOpen] : []),
    "", ...tasksSection(tasks, perTask, pageName, machineOpen.length ? ++sec : sec),
    "", ...detailsSection(tasks, perTask, pageName, sec + 1),
  ].join("\n");
  return { markdown: md, complete, reasons,
    counts: { tasks: tc, rows: rc, openNotBuilt: openNotBuilt.length, decidedNotBuilt: decidedNotBuilt.length, boundaries: boundaries.length, unbackedBoundaries: unbackedBoundaries.length, handLeft } };
}

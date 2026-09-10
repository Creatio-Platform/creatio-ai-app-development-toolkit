// TASK SLICING — the approved plan cut into one FILE per task, plus an index derived from those files.
//
// WHY A FOLDER AND NOT A TABLE. `--checklist` renders every deliverable as one markdown table, which one agent
// then holds in one context: a session that dies loses the progress, and the only record that a row was built is
// prose that agent wrote. This mode publishes the SAME rows — `checklistGroups`, the exact set `--checklist` and
// `--verify` group by — as a folder an orchestrator walks one task at a time, handing each to its own sub-agent.
//
// THE TASK FILE IS THE RECORD; THE INDEX IS DERIVED. `index.md` is regenerated from the task files on every run
// and carries no fact of its own, so a write killed halfway costs ONE task's file rather than the run's state.
// Editing the index changes nothing — the next run overwrites it from the files.
//
// WHAT THE ENGINE OWNS vs WHAT THE CALLER OWNS. In a task file the engine owns the deliverable rows and rewrites
// them on every run (they are the plan's, not the caller's, and the plan may have changed). The caller owns
// `status` and the `## Notes` section, and those survive every re-run. A task the ORCHESTRATOR added
// (`origin: orchestrator`) is never rewritten and never removed — it is not the engine's to author.
// A task that leaves the plan is NOT deleted either: it is listed as stale, because deleting a file is how a
// record of work already done on a stand disappears.
//
// IDS ARE CONTENT-DERIVED, NOT POSITIONAL. `id` is a short hash over (pageKey, group), so inserting a page does
// not renumber anything and a recorded status stays attached to the task it was recorded for. `order` carries the
// build sequence separately, and it is the field that moves.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { checklistGroups, subPageNodes, LIST_PAGE_KEY } from "./designspec.mjs";

// The status vocabulary is CHECKED, not free text (a mistyped status is a stop, not a silent "not done"): an
// unrecognised value is reported on the index and on stderr instead of being folded into one of these.
const S_TODO = "todo", S_IN_PROGRESS = "in-progress", S_DONE = "done", S_BLOCKED = "blocked", S_NA = "n/a";
export const TASK_STATUSES = [S_TODO, S_IN_PROGRESS, S_DONE, S_BLOCKED, S_NA];
export const TASK_ORIGIN_ENGINE = "engine";
export const TASK_ORIGIN_ORCHESTRATOR = "orchestrator";
// The two origins a task file may declare: the engine authored it from the plan, or the orchestrator added it.
export const TASK_ORIGINS = [TASK_ORIGIN_ENGINE, TASK_ORIGIN_ORCHESTRATOR];
export const TASK_INDEX_FILE = "index.md";
const OPEN_STATUSES = new Set([S_TODO, S_IN_PROGRESS, S_BLOCKED]);
const NOTES_HEADING = "## Notes";
const ENGINE_BODY_HEADING = "## Deliverables";

// BUILD PHASE per group, and this is the whole build order within a page. The Confirm worklist runs FIRST because
// its rows are open questions answered by reading the stand — resolving them after the page is built is how a page
// gets built against a guess. Quality gates runs LAST because the `creatio-ui-guidelines` pass needs a page to
// look at. A group not named here lands between the two, in the order `checklistGroups` emitted it.
const GROUP_PHASE = new Map([
  ["⚠ Confirm worklist", 10],
  ["Pages", 20],
  ["Form — Layout (by tab/region)", 30],
  ["Form — Coverage (verified)", 40],
  ["Card actions", 50],
  ["Form — Logic", 60],
  ["⚠ Imperative members worklist", 70],
  ["Child pages", 80],
  ["Quality gates", 99],
]);
const DEFAULT_PHASE = 85;
const phaseOf = (baseTitle) => GROUP_PHASE.get(baseTitle) ?? DEFAULT_PHASE;

// LEAF-FIRST, which is a build requirement and not a preference: a related list's Add/Edit opens the child's own
// form, so the child page must exist before the parent's list can be wired to it. `subPageNodes` walks the tree
// parent-then-children, so reversing it puts every node after its own descendants. `main` follows every sub-page;
// `list` follows `main`, because a list page's deliverables are gated off the built form page.
function pageOrder(result) {
  const subs = subPageNodes(result).map((n) => n.pageKey).filter(Boolean);
  const order = new Map();
  [...subs].reverse().forEach((key, i) => order.set(key, i + 1));
  order.set("main", subs.length + 1);
  order.set(LIST_PAGE_KEY, subs.length + 2);
  return order;
}
// A page key the walk did not publish (a group emitted for a key with no node of its own) sorts after everything
// known rather than colliding with `main` — silent co-location is what makes one page's rows close another's.
const pageRank = (order, key) => order.get(key) ?? order.size + 1;

// `baseTitle` is the group's own name with no page prefix — `pageGroup` publishes it alongside the rendered
// `title` precisely so a consumer never has to unpick the prefix (the rendered one passes through `esc`).
const baseTitleOf = (group) => group.baseTitle || group.title;

const shortHash = (s) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 8);
// The identity of a task: its page and its group, nothing else. Not the row labels — a task whose rows changed is
// the SAME task with a changed deliverable (that is the drift signal below), not a new one whose status resets.
const taskId = (pageKey, baseTitle) => shortHash(pageKey + " " + baseTitle);
// The row set's own digest, so a `done` task whose deliverables later changed can be told from one that did not.
const rowsDigest = (rows) => shortHash(rows.map((r) => r.label).join(" "));

// A filename is for a human opening the folder; the `id` is the identity. Non-Latin captions all strip to the same
// characters, so a slug ALONE would be many-to-one — the id is appended for exactly that reason.
function slugify(s) {
  const slug = String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return slug || "task";
}
export const taskFileName = (task) => `task-${slugify(`${task.pageKey}-${task.group}`)}-${task.id}.md`;

// ONE task per (page, group). The rows are `checklistGroups`' rows verbatim: a task carries what the plan says and
// adds nothing of its own, so nothing can be in a task that `--verify` will not later ask about.
function taskOf(group, order) {
  const base = baseTitleOf(group);
  const rows = group.rows.map((r) => ({
    label: r.label,
    vk: r.vk ? String(r.vk.type) : null,   // a machine-checked row: `--verify` resolves it, no prose closes it
    na: r.na || null,                      // not a deliverable of this plan (an approved boundary) — not work
  }));
  const task = {
    id: taskId(group.pageKey, base),
    pageKey: group.pageKey,
    group: base,
    title: group.title,
    order,
    phase: phaseOf(base),
    origin: TASK_ORIGIN_ENGINE,
    status: S_TODO,
    rows,
    gatedRows: rows.filter((r) => r.vk).length,
    naRows: rows.filter((r) => r.na).length,
    rowsDigest: rowsDigest(rows),
    notes: "",
  };
  task.file = taskFileName(task);
  return task;
}

// THE TASK SET. `planVersion` is the engine's own plan version — the string a `decisions.md` approval names — so a
// task folder can always be matched against the plan that was approved rather than the plan that exists now.
export function buildTaskSet(result, opts = {}) {
  const groups = checklistGroups(result, opts);
  const order = pageOrder(result);
  const ranked = groups.map((g, i) => ({ g, i })).sort((a, b) => {
    const byPage = pageRank(order, a.g.pageKey) - pageRank(order, b.g.pageKey);
    if (byPage !== 0) return byPage;
    const byPhase = phaseOf(baseTitleOf(a.g)) - phaseOf(baseTitleOf(b.g));
    return byPhase !== 0 ? byPhase : a.i - b.i;   // stable: the emission order breaks a phase tie
  });
  return {
    entity: result.entity || null,
    planVersion: result.planVersion || null,
    tasks: ranked.map(({ g }, i) => taskOf(g, i + 1)),
  };
}

// ---8<--- THE TASK FILE ---8<---

const FRONT_MATTER_KEYS = ["id", "status", "origin", "pageKey", "group", "order", "planVersion", "rowsDigest"];

function renderFrontMatter(task, set) {
  const v = {
    id: task.id, status: task.status, origin: task.origin, pageKey: task.pageKey,
    group: task.group, order: String(task.order), planVersion: set.planVersion || "",
    // The digest the STATUS was recorded against, not necessarily the current rows — see `carryOver`. Writing the
    // current one here would erase the drift warning on the first re-slice after the plan changed, which is the
    // one moment it has to survive.
    rowsDigest: task.recordedDigest || task.rowsDigest,
  };
  return ["---", ...FRONT_MATTER_KEYS.map((k) => `${k}: ${v[k]}`), "---"];
}

function closedByOf(row) {
  if (row.vk) return "`--verify` (`" + row.vk + "`)";
  if (row.na) return "N/A — " + row.na;
  return "an evidence record + a judge verdict";
}

function renderRowTable(rows) {
  const L = ["| # | Deliverable | Closed by |", "| --- | --- | --- |"];
  rows.forEach((r, i) => L.push(`| ${i + 1} | ${r.label} | ${closedByOf(r)} |`));
  return L;
}

export function renderTaskFile(task, set = {}) {
  const naNote = task.naRows ? `, ${task.naRows} N/A` : "";
  return [
    ...renderFrontMatter(task, set),
    "",
    `# ${task.order}. ${task.pageKey} · ${task.group}`,
    "",
    "> One task of an APPROVED migration plan. Build ONLY what is listed here — a deliverable that looks wrong is a",
    "> proposal to the user, never a silent change (record it under `## Notes` and build the plan as written).",
    "",
    `- **Page key:** \`${task.pageKey}\``,
    `- **Build order:** ${task.order} — leaf-first; a child page's form exists before the parent list that opens it`,
    `- **Rows:** ${task.rows.length} (${task.gatedRows} machine-checked by \`--verify\`${naNote})`,
    `- **Status vocabulary:** ${TASK_STATUSES.map((s) => `\`${s}\``).join(" · ")} — set \`status\` in the front matter above`,
    "",
    ENGINE_BODY_HEADING,
    "",
    "<!-- ENGINE-OWNED. Rewritten from the plan on every `--tasks` run; edits here are lost. -->",
    "",
    ...renderRowTable(task.rows),
    "",
    NOTES_HEADING,
    "",
    "<!-- YOURS. Never rewritten: what you built, the evidence you filed, what blocked you, what you propose. -->",
    "",
    task.notes.trim(),
    "",
  ].join("\n").replace(/\n{3,}$/, "\n\n");
}

// Reading a task file back. Deliberately tolerant about WHITESPACE and strict about VALUES: a `status` this file
// does not recognise is returned as-is and reported, never coerced into `todo` (a mistyped status that silently
// read as "not done" would re-dispatch a sub-agent onto a page that is already built).
export function parseTaskFile(text) {
  const meta = {};
  const lines = String(text).split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { meta, notes: "", malformed: "no front matter" };
  let i = 1;
  for (; i < lines.length && lines[i].trim() !== "---"; i++) {
    const m = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(lines[i]);
    if (m) meta[m[1]] = m[2].trim();
  }
  if (i >= lines.length) return { meta, notes: "", malformed: "front matter is not terminated" };
  return { meta, notes: notesOf(lines.slice(i + 1)), malformed: null };
}

function notesOf(bodyLines) {
  const at = bodyLines.findIndex((l) => l.trim() === NOTES_HEADING);
  if (at < 0) return "";
  return bodyLines.slice(at + 1).filter((l) => !l.trim().startsWith("<!--")).join("\n").trim();
}

// ---8<--- THE INDEX (DERIVED) ---8<---

const STATUS_MARK = new Map([
  [S_DONE, "✅ done"],
  [S_BLOCKED, "⛔ blocked"],
  [S_IN_PROGRESS, "▶ in-progress"],
  [S_NA, "— n/a"],
  [S_TODO, "☐ todo"],
]);
// An unrecognised status is shown as itself and counted as neither done nor open.
const statusMark = (s) => STATUS_MARK.get(s) || `⚠ ${s}`;

function indexRows(tasks) {
  const L = ["| # | Task | Page | Status | Rows | File |", "| --- | --- | --- | --- | --- | --- |"];
  for (const t of tasks) {
    const rows = `${t.rows.length}${t.gatedRows ? ` (${t.gatedRows} gated)` : ""}`;
    L.push(`| ${t.order} | ${t.group} | \`${t.pageKey}\` | ${statusMark(t.status)} | ${rows} | [${t.file}](${t.file}) |`);
  }
  return L;
}

function taskAttention(t) {
  const out = [];
  if (!TASK_STATUSES.includes(t.status)) {
    out.push(`- \`${t.file}\` — unrecognised status \`${t.status}\`: use one of ${TASK_STATUSES.join(" / ")}`);
  } else if (t.drifted) {
    const what = t.status === S_DONE
      ? "recorded `done`, but the plan's deliverables for it have CHANGED since"
      : `status \`${t.status}\` was recorded against an OLDER set of deliverables`;
    out.push(`- \`${t.file}\` — ${what}; re-check it against the rows now in the file, and set \`status: todo\` once it is re-opened`);
  }
  if (t.malformed) out.push(`- \`${t.file}\` — ${t.malformed}; the engine could not read its status`);
  return out;
}

function attentionLines(set) {
  const out = set.tasks.flatMap(taskAttention);
  for (const s of set.stale || []) {
    out.push(`- \`${s.file}\` — no longer in the plan (kept, not deleted: it may record work already done on the stand)`);
  }
  return out;
}

function countStatuses(tasks) {
  const counts = { done: 0, open: 0, other: 0 };
  for (const t of tasks) {
    if (t.status === S_DONE) counts.done++;
    else if (OPEN_STATUSES.has(t.status)) counts.open++;
    else counts.other++;
  }
  return counts;
}

export function renderTaskIndex(set) {
  const counts = countStatuses(set.tasks);
  const other = counts.other ? ` · **Other:** ${counts.other}` : "";
  const L = [
    `# Migration build tasks${set.entity ? ` — ${set.entity}` : ""}`,
    "",
    `**Plan version:** \`${set.planVersion || "—"}\` · **Tasks:** ${set.tasks.length} · **Done:** ${counts.done} · **Open:** ${counts.open}${other}`,
    "",
    "> DERIVED FILE — regenerated from the task files by `migrate.mjs <manifest> --tasks <dir>`. It carries no fact",
    "> of its own: a task's OWN file records its status, so editing this table changes nothing. Run the mode again",
    "> after a status changes.",
    "",
    ...indexRows(set.tasks),
  ];
  const attention = attentionLines(set);
  if (attention.length) L.push("", "## Attention", "", ...attention);
  return L.join("\n") + "\n";
}

// ---8<--- MERGE: the caller's recorded state survives a re-run ---8<---

// `fresh` is the plan as it is NOW; `existing` is what the folder already holds. The caller's `status` and `## Notes`
// win; the engine's rows always lose to the current plan. An orchestrator-authored task is carried through
// untouched, and an engine task that left the plan becomes `stale` rather than being removed.
export function mergeTaskSet(fresh, existing = []) {
  const byId = new Map(existing.map((e) => [e.meta.id, e]));
  const tasks = fresh.tasks.map((t) => carryOver(t, byId.get(t.id)));
  const claimed = new Set(fresh.tasks.map((t) => t.id));
  const extra = existing.filter((e) => !claimed.has(e.meta.id));
  const orchestrated = extra.filter((e) => e.meta.origin === TASK_ORIGIN_ORCHESTRATOR).map(adoptOrchestrated);
  const stale = extra.filter((e) => e.meta.origin !== TASK_ORIGIN_ORCHESTRATOR).map((e) => ({ file: e.file, id: e.meta.id }));
  const ordered = [...tasks, ...orchestrated].sort((a, b) => a.order - b.order);
  return { ...fresh, tasks: ordered.map((t, i) => ({ ...t, order: i + 1 })), stale };
}

function carryOver(task, prev) {
  if (!prev) return task;
  const status = prev.meta.status || task.status;
  // A status recorded against an older row set must not be trusted silently — the deliverables it was recorded
  // for are not the deliverables now in the file. The digest the status was recorded against is therefore KEPT in
  // the file for as long as that status stands, and only a status back at `todo` (the task re-opened) adopts the
  // current rows. Refreshing it eagerly would clear the warning on the very re-slice that should raise it.
  const held = status !== S_TODO && prev.meta.rowsDigest ? prev.meta.rowsDigest : task.rowsDigest;
  return {
    ...task,
    status,
    notes: prev.notes || "",
    file: prev.file || task.file,        // a file the caller renamed keeps its name; the id is the identity
    malformed: prev.malformed || null,
    recordedDigest: held,
    drifted: held !== task.rowsDigest,
  };
}

// An orchestrator task is read, not authored: the engine keeps its file and its status and only places it in the
// order. `order` may be absent or unparseable, so it sorts after every engine task rather than at the front.
function adoptOrchestrated(e) {
  const n = Number(e.meta.order);
  const label = e.meta.group || "(orchestrator task)";
  return {
    id: e.meta.id, pageKey: e.meta.pageKey || "?", group: label, title: label,
    order: Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER,
    phase: DEFAULT_PHASE, origin: TASK_ORIGIN_ORCHESTRATOR, status: e.meta.status || S_TODO,
    rows: [], gatedRows: 0, naRows: 0, rowsDigest: e.meta.rowsDigest || "", notes: e.notes || "",
    file: e.file, malformed: e.malformed || null,
  };
}

// ---8<--- I/O ---8<---

function readExisting(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== TASK_INDEX_FILE)
    .map((f) => ({ file: f, ...parseTaskFile(fs.readFileSync(path.join(dir, f), "utf8")) }))
    .filter((e) => e.meta.id);
}

// Writes the folder and returns what it wrote. Engine tasks are rewritten (the rows are the plan's), orchestrator
// tasks are left exactly as they are, and nothing is ever deleted.
export function syncTaskDir(dir, result, opts = {}) {
  const merged = mergeTaskSet(buildTaskSet(result, opts), readExisting(dir));
  fs.mkdirSync(dir, { recursive: true });
  for (const t of merged.tasks) {
    if (t.origin === TASK_ORIGIN_ORCHESTRATOR) continue;
    fs.writeFileSync(path.join(dir, t.file), renderTaskFile(t, merged));
  }
  fs.writeFileSync(path.join(dir, TASK_INDEX_FILE), renderTaskIndex(merged));
  return merged;
}

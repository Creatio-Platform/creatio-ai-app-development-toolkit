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
// IDS ARE CONTENT-DERIVED, NOT POSITIONAL. `id` is a short hash over (the page's identity, group), so inserting a
// page renumbers nothing and a recorded status stays attached to the task it was recorded for — and the page's
// identity is its `pageDedupeId`, not its key, because a key can be taken by a newly inserted sibling. `order`
// carries the build sequence separately and is the field that moves; the index calls it `Step`.
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
const NOTES_GUIDANCE = "<!-- YOURS. Never rewritten: what you built, the evidence you filed, what blocked you, what you propose. -->";

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

// SCAFFOLDING COMES BEFORE THE LEAVES, and it is the one exception to leaf-first. `main`'s `Pages` group is not a
// page's layout: it carries the app/section/package placement, the binding to the EXISTING entity and the page
// shells (form, typed, mini) — the preconditions every other task builds into. Ranked purely leaf-first it landed
// second-to-last, which contradicts the build procedure's own "package/app/page scaffolding first" and describes a
// child page created before the package that holds it.
const SCAFFOLD_GROUP = "Pages";
const isScaffold = (group, baseTitle) => group.pageKey === "main" && baseTitle === SCAFFOLD_GROUP;
const SCAFFOLD_RANK = 0;
const groupRank = (order, group, baseTitle) =>
  isScaffold(group, baseTitle) ? SCAFFOLD_RANK : pageRank(order, group.pageKey);

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
function taskOf(group, order, identity = new Map()) {
  const base = baseTitleOf(group);
  const rows = group.rows.map((r) => ({
    label: r.label,
    vk: r.vk ? String(r.vk.type) : null,   // a machine-checked row: `--verify` resolves it, no prose closes it
    na: r.na || null,                      // not a deliverable of this plan (an approved boundary) — not work
  }));
  const task = {
    id: taskId(identity.get(group.pageKey) || group.pageKey, base),
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
  const identity = pageIdentities(result);
  const ranked = groups.map((g, i) => ({ g, i })).sort((a, b) => {
    const byPage = groupRank(order, a.g, baseTitleOf(a.g)) - groupRank(order, b.g, baseTitleOf(b.g));
    if (byPage !== 0) return byPage;
    const byPhase = phaseOf(baseTitleOf(a.g)) - phaseOf(baseTitleOf(b.g));
    return byPhase !== 0 ? byPhase : a.i - b.i;   // stable: the emission order breaks a phase tie
  });
  return {
    entity: result.entity || null,
    planVersion: result.planVersion || null,
    tasks: ranked.map(({ g }, i) => taskOf(g, i + 1, identity)),
  };
}

// A task's identity must survive a page KEY changing under it. `claimPageKey` gives a base key to its first
// claimant, so inserting a sibling that sorts earlier can take `child:<Entity>` and push the already-built page to
// `child:<Entity>@<Via>`. Keyed on the key alone, the never-built newcomer would inherit the built page's id — and
// with it a recorded `done`. `pageDedupeId` identifies the PHYSICAL page and does not move, so it is what the id
// hashes. `main` and `list` are not in the walk and are their own identity.
function pageIdentities(result) {
  const map = new Map();
  for (const node of subPageNodes(result)) {
    if (node.pageKey) map.set(node.pageKey, node.pageDedupeId || node.pageKey);
  }
  return map;
}

// ---8<--- THE TASK FILE ---8<---

const FRONT_MATTER_KEYS = ["id", "status", "origin", "pageKey", "group", "order", "planVersion", "rowsDigest"];

function renderFrontMatter(task, set) {
  const v = {
    id: task.id, status: task.status, origin: task.origin, pageKey: task.pageKey,
    group: task.group, order: String(task.step ?? task.order), planVersion: set.planVersion || "",
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
    `# ${task.step ?? task.order}. ${task.pageKey} · ${task.group}`,
    "",
    "> One task of an APPROVED migration plan. Build ONLY what is listed here — a deliverable that looks wrong is a",
    "> proposal to the user, never a silent change (record it under `## Notes` and build the plan as written).",
    "",
    `- **Page key:** \`${task.pageKey}\``,
    `- **Build order:** ${task.step ?? task.order} — leaf-first; a child page's form exists before the parent list that opens it`,
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
    NOTES_GUIDANCE,
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
    const m = /^\s*([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(lines[i]);
    if (m) meta[m[1]] = m[2].trim();
  }
  if (i >= lines.length) return { meta, notes: "", malformed: "front matter is not terminated" };
  return { meta, notes: notesOf(lines.slice(i + 1)), malformed: null };
}

// Only the engine's OWN guidance line is stripped. Dropping every `<!-- … -->` line took the caller's comments
// with it, and a note is exactly where someone records a caveat about what they built.
function notesOf(bodyLines) {
  const at = bodyLines.findIndex((l) => l.trim() === NOTES_HEADING);
  if (at < 0) return "";
  return bodyLines.slice(at + 1).filter((l) => l.trim() !== NOTES_GUIDANCE).join("\n").trim();
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

// `Step` is the position in the QUEUE, which is not the same fact as a task file's `order` field: an
// orchestrator-authored file is never rewritten, so the `order` it declared for itself stands even where the queue
// puts it. Naming the column `#` invited reading the two as one number.
function indexRows(tasks) {
  const L = ["| Step | Task | Page | Status | Rows | File |", "| --- | --- | --- | --- | --- | --- |"];
  for (const t of tasks) {
    const rows = `${t.rows.length}${t.gatedRows ? ` (${t.gatedRows} gated)` : ""}`;
    const mark = t.unread ? "⚠ unread" : statusMark(t.status);
    L.push(`| ${t.step ?? t.order} | ${t.group} | \`${t.pageKey}\` | ${mark} | ${rows} | [${t.file}](${t.file}) |`);
  }
  return L;
}

function taskAttention(t) {
  const out = [];
  if (t.unread) return out;   // its own refusal line already names the file; nothing here was recorded by anyone
  if (!TASK_STATUSES.includes(t.status)) {
    out.push(`- \`${t.file}\` — unrecognised status \`${t.status}\`: use one of ${TASK_STATUSES.join(" / ")}`);
  } else if (t.drifted) {
    const what = t.status === S_DONE
      ? "recorded `done`, but the plan's deliverables for it have CHANGED since"
      : `status \`${t.status}\` was recorded against an OLDER set of deliverables`;
    out.push(`- \`${t.file}\` — ${what}; re-check it against the rows now in the file. This clears when the task is`
      + " re-opened (`status: todo`) or when the stale `rowsDigest:` line is emptied — a status re-recorded over the"
      + " held digest keeps the warning, deliberately: the engine cannot tell a re-checked task from an unchanged one.");
  }
  return out;
}

function attentionLines(set) {
  const out = set.tasks.flatMap(taskAttention);
  for (const b of set.blocked || []) {
    out.push(`- \`${b.file}\` — NOT READ and NOT WRITTEN: ${b.reason}. Its task got no file this run, and this file was`
      + " left exactly as it is — it may hold the only record of work already done on the stand. Fix its front matter"
      + " (or move it aside) and re-run.");
  }
  for (const s of set.stale || []) {
    out.push(`- \`${s.file}\` — no longer in the plan (kept, not deleted: it may record work already done on the stand)`);
  }
  return out;
}

function countStatuses(tasks) {
  const counts = { done: 0, open: 0, other: 0 };
  for (const t of tasks) {
    if (t.unread) counts.other++;
    else if (t.status === S_DONE) counts.done++;
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
//
// THE ENGINE NEVER WRITES TO A FILE IT COULD NOT READ IN FULL. A file with no readable `id`, an unterminated front
// matter (a write killed halfway, or a hand edit), or an `id` that two files claim — for each of those the engine
// cannot tell WHICH task's record it is holding, and rewriting it would destroy the `## Notes` that record work
// already done on a stand. Such a file is reported by name and left byte for byte as it is; the task it was
// holding gets no file this run, which is loud, rather than a silent overwrite. `blocked` collects them.
export function mergeTaskSet(fresh, existing = []) {
  const { usable, blocked } = triageExisting(existing);
  const byId = new Map();
  for (const e of usable) byId.set(e.meta.id, e);
  const tasks = fresh.tasks.map((t) => carryOver(t, matchFor(byId, t)));
  const claimed = new Set(fresh.tasks.map((t) => t.id));
  const extra = usable.filter((e) => !claimed.has(e.meta.id));
  const orchestrated = extra.filter((e) => e.meta.origin === TASK_ORIGIN_ORCHESTRATOR).map(adoptOrchestrated);
  const stale = extra.filter((e) => e.meta.origin !== TASK_ORIGIN_ORCHESTRATOR).map((e) => ({ file: e.file, id: e.meta.id }));
  const ordered = [...tasks, ...orchestrated].sort((a, b) => a.order - b.order);
  // A task whose file was refused must not appear in the queue as `todo`. It got the fresh task's default status
  // because nothing readable could be carried over — and that file may record `done`. Reading `todo` there is how
  // a sub-agent gets dispatched onto a page that is already built, which is the whole reason the status vocabulary
  // is checked in the first place.
  const refused = new Set(blocked.map((b) => b.file));
  return {
    ...fresh,
    tasks: ordered.map((t, i) => ({ ...t, step: i + 1, unread: refused.has(t.file) })),
    stale,
    blocked,
  };
}

// An ENGINE task is matched only against an ENGINE file. An orchestrator file that carries an engine task's `id` —
// the natural result of copying a task file as a template for a new one — would otherwise become that task's
// record: the engine would write the plan's rows into the orchestrator's file (which rule says it never rewrites)
// and the engine task's own file, with its recorded status, would drop out of the index entirely.
function matchFor(byId, task) {
  const found = byId.get(task.id);
  if (!found) return null;
  return found.meta.origin === TASK_ORIGIN_ORCHESTRATOR ? null : found;
}

function triageExisting(existing) {
  const blocked = [];
  const readable = [];
  for (const e of existing) {
    if (!e.meta.id) blocked.push({ file: e.file, reason: e.malformed || "no `id` in its front matter" });
    else if (e.malformed) blocked.push({ file: e.file, reason: e.malformed });
    else readable.push(e);
  }
  const seen = new Map();
  for (const e of readable) seen.set(e.meta.id, (seen.get(e.meta.id) || 0) + 1);
  const usable = [];
  for (const e of readable) {
    if (seen.get(e.meta.id) > 1) blocked.push({ file: e.file, reason: `its \`id\` \`${e.meta.id}\` is claimed by more than one file` });
    else usable.push(e);
  }
  return { usable, blocked };
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
    file: e.file,
  };
}

// ---8<--- I/O ---8<---

// Every `.md` in the folder is returned, INCLUDING the ones that could not be parsed — `mergeTaskSet` needs to
// know they exist to refuse to write over them. Filtering them out here is what made a corrupted file's notes
// disappear silently: the engine read it as absent, treated its task as new, and overwrote it.
function readExisting(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== TASK_INDEX_FILE)
    .map((f) => ({ file: f, ...parseTaskFile(fs.readFileSync(path.join(dir, f), "utf8")) }));
}

// Writes the folder and returns what it wrote. Engine tasks are rewritten (the rows are the plan's), orchestrator
// tasks are left exactly as they are, a file the engine could not read in full is never touched, and nothing is
// ever deleted.
export function syncTaskDir(dir, result, opts = {}) {
  const merged = mergeTaskSet(buildTaskSet(result, opts), readExisting(dir));
  const untouchable = new Set(merged.blocked.map((b) => b.file));
  fs.mkdirSync(dir, { recursive: true });
  for (const t of merged.tasks) {
    if (t.origin === TASK_ORIGIN_ORCHESTRATOR || untouchable.has(t.file)) continue;
    fs.writeFileSync(path.join(dir, t.file), renderTaskFile(t, merged));
  }
  fs.writeFileSync(path.join(dir, TASK_INDEX_FILE), renderTaskIndex(merged));
  return merged;
}

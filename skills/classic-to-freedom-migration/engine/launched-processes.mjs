// Business processes a page or its section STARTS, and the user-task pages those processes open.
//
// A button or request that starts a process (`ProcessModuleUtilities.executeProcess`, `runProcess`, …) reaches pages
// that are not in the migrated page's chain: the process's own Pre-configured page steps. Those pages stay Classic
// unless the plan names them, and `ProcessInModules` (the section's process menu) does not list a process the page
// code starts. So the plan follows each started process to its user-task pages and lists every Classic one as a
// decision — migrate it with the process-page profile, or keep it Classic — or as a recorded boundary. A started
// process the plan does not follow leaves the plan incomplete: "no connected process" is never said for it.
//
// Pure functions: no I/O. `migrate.mjs` supplies the launch facts the parser read; the discovery step records what
// `describe-business-process` returned in `manifest.launchedProcesses`.

import { isStr, plainObject, code, MISSING, VERIFY, DONE } from "./process-page.mjs";

export const LAUNCHED_DECISION = Object.freeze({ MIGRATE: "migrate", KEEP_CLASSIC: "keep-classic", PENDING: "pending" });
const DECIDED = new Set([LAUNCHED_DECISION.MIGRATE, LAUNCHED_DECISION.KEEP_CLASSIC]);
const UI = new Set(["classic", "freedom"]);
// One wording for a decision, in the plan table and in the verify row.
const migrateText = (subject) => `migrate ${subject} as its own run with the process-page profile`;
const KEEP_TEXT = "kept Classic — the user's decision";
const DECIDE_TEXT = "decide with the user: migrate it with the process-page profile, or keep it Classic";

// `manifest.launchedProcesses` — what the discovery step recorded:
//   { resolved: true, evidence?, processes: [{ name, caption?, boundary?,
//       userTasks?: [{ element, page, ui: "classic" | "freedom", decision?: "migrate" | "keep-classic" }] }] }
// `userTasks: []` records a process with no user-task page; `boundary` records why its pages are out of this
// migration's scope. An entry with neither is not followed yet.
function userTaskOf(t) {
  return {
    element: isStr(t.element) ? t.element : null,
    page: isStr(t.page) ? t.page : null,
    ui: UI.has(t.ui) ? t.ui : null,
    decision: DECIDED.has(t.decision) ? t.decision : LAUNCHED_DECISION.PENDING,
  };
}
const isEntry = (p) => p && typeof p === "object" && isStr(p.name);
const processOf = (p) => ({
  name: p.name,
  boundary: isStr(p.boundary) ? p.boundary : null,
  userTasks: Array.isArray(p.userTasks) ? p.userTasks.filter((t) => t && typeof t === "object").map(userTaskOf) : null,
});
function recordedProcessesOf(manifest) {
  const rec = plainObject(manifest?.launchedProcesses);
  return { resolved: rec.resolved === true, evidence: isStr(rec.evidence) ? rec.evidence : null,
    processes: (Array.isArray(rec.processes) ? rec.processes : []).filter(isEntry).map(processOf) };
}

// The processes the parsed code starts: name → where it is started from, in first-seen order.
function launchedOf(sources) {
  const byName = new Map();
  for (const { from, names } of sources) {
    for (const name of names) {
      const at = byName.get(name) || [];
      if (!at.includes(from)) at.push(from);
      byName.set(name, at);
    }
  }
  return byName;
}

const unresolvedIssue = (names) => `launchedProcesses.resolved not recorded — the code starts ${names.length ? names.join(", ") : "a business process it names at runtime"}; read each process with \`describe-business-process\`, record its user-task pages in manifest.launchedProcesses with resolved: true`;
const unfollowedIssue = (name, from) => `launchedProcesses names no entry for ${name}, which the ${from.join(" and ")} starts — record its user-task pages or a boundary`;
const runtimeIssue = (from) => `the ${from.join(" and ")} starts a business process it names at runtime — record that process in launchedProcesses.processes, or say in launchedProcesses.evidence why no process can be named`;
function followIssues(p) {
  if (p.boundary) return [];
  if (!p.userTasks) return [`launchedProcesses entry ${JSON.stringify(p.name)} records neither its user-task pages nor a boundary — read it with \`describe-business-process\` and record its Pre-configured page steps (\`userTasks\`, an empty list when it has none), or a \`boundary\` saying why its pages are out of scope`];
  return p.userTasks.filter((t) => !t.page || !t.ui)
    .map((t) => `launchedProcesses entry ${JSON.stringify(p.name)}: a user task ${JSON.stringify(t.element || "?")} names no ${t.page ? "`ui` (classic | freedom)" : "page"}`);
}
function issuesOf(launched, unnamedFrom, recorded, extra) {
  if (!recorded.resolved) return [unresolvedIssue([...launched.keys()])];
  const names = new Set(recorded.processes.map((p) => p.name));
  const missing = [...launched].filter(([name]) => !names.has(name)).map(([name, from]) => unfollowedIssue(name, from));
  const unnamed = unnamedFrom.length && !extra.length && !recorded.evidence ? [runtimeIssue(unnamedFrom)] : [];
  return [...missing, ...unnamed, ...recorded.processes.flatMap(followIssues)];
}

// A name the parser quoted that can be a process schema name: one identifier, not a dotted path
// (`Resources.Strings.*`, `Terrasoft.*`) and not one of the platform's process modules.
const PROCESS_MODULES = new Set(["ProcessModuleUtilities", "ProcessSchemaManager", "ProcessEntryPointUtilities", "ProcessModuleV2"]);
const isProcessName = (n) => typeof n === "string" && /^[A-Za-z]\w*$/.test(n) && !PROCESS_MODULES.has(n);

// The started processes, their user-task pages and the plan's open questions — or null when the code starts none.
// `sources`: `[{ from, launch, names }]`, one per page the run covers (the page, its section, its folded sub-pages).
export function launchedProcessesInfo({ sources, manifest }) {
  const facts = sources.map((s) => ({ from: s.from, launch: !!s.launch, names: (s.names || []).filter(isProcessName) }));
  const launched = launchedOf(facts);
  const unnamedFrom = facts.filter((s) => s.launch && !s.names.length).map((s) => s.from);
  if (!launched.size && !unnamedFrom.length) return null;
  const recorded = recordedProcessesOf(manifest);
  const byName = new Map(recorded.processes.map((p) => [p.name, p]));
  const extra = recorded.processes.filter((p) => !launched.has(p.name));
  const processes = [
    ...[...launched].map(([name, from]) => ({ ...(byName.get(name) || { name, unfollowed: true }), from })),
    ...extra.map((p) => ({ ...p, from: [] })),
  ];
  return { evidence: recorded.evidence, unnamedFrom, processes, issues: issuesOf(launched, unnamedFrom, recorded, extra) };
}

// The Classic user-task pages the plan decides on.
const classicTasksOf = (info) => (info?.processes || []).filter((p) => !p.boundary && p.userTasks)
  .flatMap((p) => p.userTasks.filter((t) => t.page && t.ui === "classic").map((t) => ({ process: p.name, ...t })));

const DECISION_TEXT = {
  [LAUNCHED_DECISION.MIGRATE]: migrateText("it"),
  [LAUNCHED_DECISION.KEEP_CLASSIC]: KEEP_TEXT,
  [LAUNCHED_DECISION.PENDING]: "⚠ " + DECIDE_TEXT,
};
function taskLine(p, t, esc) {
  const [ui, decision] = t.ui === "freedom" ? ["Freedom", "nothing to migrate"] : ["Classic", DECISION_TEXT[t.decision]];
  return `| ${code(esc(p.name))} | ${t.element ? code(esc(t.element)) : "—"} | ${code(esc(t.page || "?"))} | ${ui} | ${decision} |`;
}
function processLines(p, esc) {
  const name = code(esc(p.name));
  if (p.unfollowed) return [`| ${name} | — | ⚠ not followed — read it with \`describe-business-process\` | — | — |`];
  if (p.boundary) return [`| ${name} | — | — | — | boundary: ${esc(p.boundary)} |`];
  if (!p.userTasks?.length) return [`| ${name} | — | no user-task page | — | nothing to migrate |`];
  return p.userTasks.map((t) => taskLine(p, t, esc));
}

// The plan's `### Processes this page starts` section.
export function launchedProcessesPlanLines(info, esc) {
  if (!info) return [];
  const started = info.processes.filter((p) => p.from.length)
    .map((p) => `${code(esc(p.name))} (from the ${p.from.map(esc).join(" and ")})`).join(", ");
  const evidenceNote = info.evidence ? ` (${esc(info.evidence)})` : "";
  const runtime = info.unnamedFrom.length ? `The ${info.unnamedFrom.map(esc).join(" and ")} also starts a process it names at runtime${evidenceNote}. ` : "";
  return ["### Processes this page starts",
    `The page code starts ${started || "a business process"}. ${runtime}A process's user-task pages are not in this page's chain: each Classic one is a decision — migrate it with the process-page profile, or keep it Classic.`,
    "",
    "| Process | Step | User-task page | UI | Decision |",
    "| --- | --- | --- | --- | --- |",
    ...info.processes.flatMap((p) => processLines(p, esc)),
    ""];
}

// The processes the code starts, as the `Connected processes` signal line names them: `ProcessInModules` lists the
// section's process menu, not what the code starts. Empty when the code starts none.
export function launchedProcessNames(info, esc) {
  const names = (info?.processes || []).filter((p) => p.from.length).map((p) => code(esc(p.name)));
  if (!names.length && !info?.unnamedFrom?.length) return "";
  return names.join(", ") || "a process named at runtime";
}

// ---- the plan-vs-built rows -----------------------------------------------------------------------------------
// `--built.processPagesMigrated` records the user-task pages migrated in their own runs: [{ page, freedomPage }].

export function launchedProcessesRows(info, esc) {
  return classicTasksOf(info).map((t) => ({
    deliverableId: `launched-page:${t.process}:${t.page}`,
    label: `[process user task] ${code(esc(t.page))} — opened by ${code(esc(t.process))}`,
    vk: { type: "launchedpage", process: t.process, page: t.page, decision: t.decision },
  }));
}

function resolveLaunchedPageVk(vk, ctx, { esc }) {
  const page = code(esc(vk.page));
  if (vk.decision === LAUNCHED_DECISION.KEEP_CLASSIC) return [DONE, `${page} ${KEEP_TEXT}`, "ok"];
  if (vk.decision !== LAUNCHED_DECISION.MIGRATE)
    return [VERIFY, `${page} is a Classic user task of ${code(esc(vk.process))} — ${DECIDE_TEXT}; record it in \`launchedProcesses\` and re-run \`--plan\``, "unverified"];
  const recorded = Array.isArray(ctx.root?.processPagesMigrated) ? ctx.root.processPagesMigrated : [];
  const entry = recorded.find((r) => r && r.page === vk.page);
  if (!entry) return [VERIFY, `${migrateText(page)}, then record it in \`--built.processPagesMigrated\``, "unverified"];
  if (!isStr(entry.freedomPage)) return [MISSING, `${page} is recorded as migrated but names no Freedom page`, "missing"];
  return [DONE, `${page} migrated as ${code(esc(entry.freedomPage))}`, "ok"];
}
// `[type, (vk, ctx, { absentEntry, esc }) => verdict]` — designspec registers them like the process-page resolvers.
export const LAUNCHED_VK_RESOLVERS = Object.freeze([["launchedpage", resolveLaunchedPageVk]]);

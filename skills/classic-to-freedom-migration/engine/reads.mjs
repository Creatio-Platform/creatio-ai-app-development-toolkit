// THE READ PLAN — half one of the `--verify` payload contract: WHICH reads the gate needs and WHERE each raw
// response goes. The agent performs the reads (clio's tools are on its side, not in this process) and copies
// each file in verbatim; assemble.mjs composes `built.json` from them, reading this same index.
//
// The index is a FILE the engine writes, never a naming convention the agent reproduces: a page key carries
// `:`, `@` and `#`, none of which survive a filesystem intact. The key is slugged for readability and the
// mapping recorded, so nothing downstream parses a filename.
import fs from "node:fs";
import path from "node:path";
import { checklistGroups } from "./designspec.mjs";
import { slugify } from "./tasks.mjs";

export const READS_DIR = "reads";
export const READS_INDEX_FILE = "index.json";
export const READS_INDEX_VERSION = 1;

// A page key describes itself to a reader who has to find the page on the stand. The engine cannot name the
// Freedom SCHEMA — no plan publishes it — so this says which page of the plan the key is and the agent resolves
// the schema. That is the limit of this list: it fixes WHICH KEYS get read, not which schema each resolves to,
// so a key read against the wrong page still comes back looking complete.
export function pageKeyDescription(key) {
  if (key === "main") return "the form page";
  if (key === "list") return "the section's list page";
  const [kind, rest] = splitKey(key);
  if (kind === "child") return `the child edit page for \`${rest}\``;
  if (kind === "typed") return `the per-type form page \`${rest}\``;
  if (kind === "mini") return `the mini page \`${rest}\``;
  return `page key \`${key}\``;
}
// Only the FIRST `:` separates the kind — a key's tail may carry its own (`mini:X@Via#2` never does today, but a
// caption-derived suffix could), and a greedy split would rename the page.
function splitKey(key) {
  const i = key.indexOf(":");
  return i < 0 ? [key, ""] : [key.slice(0, i), key.slice(i + 1)];
}

// The slug is for a human opening the folder; the index's `file` is the identity. Two different keys CAN slug to
// one name, so the caller numbers the files — the number, not the slug, is what makes a name unique. `slugify` is
// the task folder's rule, shared rather than re-derived: two slug conventions in one migration folder is a thing
// nobody should have to learn twice.
export const slugKey = (key) => slugify(key);

// WHICH reads the gate needs, derived from the same groups `--checklist` and `--verify` walk — so a page the
// checklist publishes can never be a page nobody was told to read. Three kinds:
//   `pageMeta` +   — `get-page` writes THREE files into `.clio-pages/<schema>/`, and the gate needs two of them:
//   `pageBundle`     `meta.json` (`page.schemaUId`, `packageName`, `packageUId`, `parentSchemaName`) and
//                    `bundle.json` (the MERGED `viewConfig`, plus `modelConfig` / `handlers` / `viewModelConfig`).
//                    Two files because that is how they arrive: the MCP `get-page` tool returns paths, not a
//                    bundle, so "copy the response" would have copied a list of filenames. Each is copied whole.
//   `businessRules`— only for the keys carrying a `rule` row: the page's persisted `BusinessRule_*` schemas,
//                    invisible to a page-body read.
//   `reachability` — one per `onstand` key that is a READ: config records that live in no page body.
//   `dashboards`   — ONE per run, when the plan moves any: `DashboardMigrationLog` is a stand table the
//                    migration PROCESS writes, so no page read can see it and the gate has no other source.
// An `onstand` key marked `recordedBy: "builder"` is NOT a read and gets no file. Its value is an outcome the
// build agent observed (a card widget the converter placed); nothing on the stand answers it afterwards, so
// sending the read-only read-back agent after it would be sending it after a value it cannot fetch. The keys are
// still NAMED in the rendered plan, as the builder's to record — dropping them silently would trade one missing
// key for another.
export function readPlan(result, opts = {}) {
  const groups = checklistGroups(result, opts);
  const pageKeys = [];
  const ruleKeys = new Set();
  const reach = new Map();
  // The EVIDENCE IDS, off the same walk: the one part of the payload keyed by a string a person would otherwise
  // retype, and a backtick or non-Latin caption inside one does not survive being retyped. Two rows can share one
  // id (the quality-gate pair), so they dedupe.
  const evidenceIds = [];
  // The dashboards the plan moves, collected across the `dashboards` rows (three rows, ONE expectation set).
  const dashboards = [];
  for (const g of groups) {
    for (const r of g.rows) {
      const key = r.pageKey || g.pageKey || "main";
      if (!pageKeys.includes(key)) pageKeys.push(key);
      if (r.vk?.type === "rule") ruleKeys.add(key);
      if (r.vk?.type === "onstand" && r.vk.evidence && !reach.has(r.vk.evidence)) reach.set(r.vk.evidence, r.vk);
      if (r.vk?.type === "evidence" && r.vk.id && !evidenceIds.includes(r.vk.id)) evidenceIds.push(r.vk.id);
      if (r.vk?.type === "dashboards") for (const e of r.vk.expect || [])
        if (e?.id && !dashboards.some((d) => d.id === e.id)) dashboards.push(e);
    }
  }
  const reads = [];
  const builderRecorded = [];
  const add = (kind, slug, extra) => {
    const n = String(reads.length + 1).padStart(2, "0");
    reads.push({ kind, file: path.posix.join(READS_DIR, `${n}-${FILE_STEM[kind] || kind}-${slug}.json`), ...extra });
  };
  for (const key of pageKeys) {
    add("pageMeta", slugKey(key), { pageKey: key,
      what: `\`get-page\` ${pageKeyDescription(key)}, then copy \`.clio-pages/<schema>/meta.json\` here whole` });
    add("pageBundle", slugKey(key), { pageKey: key,
      what: `…and \`.clio-pages/<schema>/bundle.json\` from the SAME call here whole — the MERGED page, never the page's own body` });
    if (ruleKeys.has(key)) add("businessRules", slugKey(key), { pageKey: key,
      what: `clio's page-business-rules read for ${pageKeyDescription(key)} — the persisted \`BusinessRule_*\` schemas (\`{ count, rules }\`), never a page-body grep` });
  }
  // A run that moves NO dashboard emits no read: the rows resolve on their own, and a read for an empty
  // expectation is a file somebody has to answer with nothing.
  if (dashboards.length) add("dashboards", "migration-log", {
    what: `\`DashboardMigrationLog\` for the ${dashboards.length} dashboard(s) this plan moves`
      + ` (${dashboards.map((d) => d.caption || d.id).join(", ")}) — a stand TABLE the migration process writes, which`
      + " no page read can see. The file holds the LIST the gate matches on `id` / `status` / `package`; copy each"
      + " row's status VERBATIM, never interpreted, so the list can be diffed against the log by eye" });
  for (const [key, vk] of reach) {
    if (vk.recordedBy === "builder") { builderRecorded.push({ reachabilityKey: key, what: vk.what || "on-stand check" }); continue; }
    add("reachability", slugKey(key), { reachabilityKey: key,
      what: `${vk.what || "on-stand check"} — the file holds the VALUE for \`reachability.${key}\``
        + (vk.expectCount ? ` (a COUNT, not a flag: \`{ "workplaces": <n>, "names": [...] }\`)` : "")
        // The engine fixes WHICH read happens; without the query it leaves HOW to the reader, and the known-wrong
        // how is exactly what a repair round was spent on. Carried on the vk so the row and the gate agree.
        + (vk.query ? ` — run: ${vk.query}` : "") });
  }
  // THE PLAN VERSION, stamped the way `--split` freezes its cut and `tasks.mjs` stamps every task file. It is
  // what lets the composing half tell a read plan cut against THIS plan from one cut against an earlier draft:
  // without it, a page key added after the index was written is in no read, so nothing is opened, no problem is
  // recorded, and the row reads ⚠ with no sign that nobody tried. `version` above is the FORMAT's; this is the
  // plan's, and they answer different questions.
  return { version: READS_INDEX_VERSION, planVersion: result?.planVersion || null, reads, builderRecorded, evidenceIds };
}

// The skeletons the agent FILLS rather than authors: every published id already a key, an empty value beside it.
// A record filed under a mistyped id is a record the gate reports as never filed. Written ONLY when absent —
// they carry the run's own answers, and regenerating one would delete them.
export function writeEvidenceSkeletons(dir, plan) {
  const written = [];
  for (const [file, empty] of [[EVIDENCE_SKELETON_FILE, { referencePage: "", components: [] }],
    [JUDGE_SKELETON_FILE, { convincing: null }]]) {
    const full = path.join(dir, file);
    if (fs.existsSync(full) || !plan.evidenceIds.length) continue;
    const skel = {};
    for (const id of plan.evidenceIds) skel[id] = { ...empty };
    fs.writeFileSync(full, JSON.stringify(skel, null, 2) + "\n");
    written.push(file);
  }
  return written;
}
export const EVIDENCE_SKELETON_FILE = "evidence.json";
export const JUDGE_SKELETON_FILE = "judge.json";

// WRITES the index into `<dir>/reads/`. `dir` is the MIGRATION FOLDER — the one holding `build-tasks/` — so the
// raw responses and the `built.json` composed from them sit beside the run, never in a temp dir that cannot be
// re-checked afterwards.
export function writeReadIndex(dir, plan) {
  fs.mkdirSync(path.join(dir, READS_DIR), { recursive: true });
  fs.writeFileSync(path.join(dir, READS_DIR, READS_INDEX_FILE), JSON.stringify(plan, null, 2) + "\n");
}

// The filename stem per kind — short, and distinct from the kind token so a folder listing reads as files
// rather than as a schema.
const FILE_STEM = { pageMeta: "meta", pageBundle: "bundle", businessRules: "rules", reachability: "reachability",
  dashboards: "dashboards" };
const KIND_TITLE = { pageMeta: "Pages — metadata", pageBundle: "Pages — merged bundle",
  businessRules: "Business rules", reachability: "Reachability", dashboards: "Dashboards" };
// The agent-facing artifact. It names one file per read and says the response goes in VERBATIM, because the
// whole point is that nothing between the stand and `built.json` is retyped: the agent copies bytes, the engine
// composes the JSON.
export function renderReadPlan(plan, dir) {
  const L = ["### 📥 Read plan — what the verify gate needs off the stand", "",
    `> Run each read below and write its response **verbatim** to the file named beside it, under \`${dir}\`.`
    + " Copy the WHOLE response — do not slice it, do not re-key it, do not compose any JSON yourself."
    + ` The engine composes \`built.json\` from these files and reads \`${path.posix.join(READS_DIR, READS_INDEX_FILE)}\` to find them,`
    + " so a file written under a name of your own is a file it cannot see.", ""];
  for (const kind of ["pageMeta", "pageBundle", "businessRules", "reachability", "dashboards"]) {
    const rows = plan.reads.filter((r) => r.kind === kind);
    if (!rows.length) continue;
    L.push(`**${KIND_TITLE[kind]}**`, "", "| # | Key | Read | Write the response to |", "| --- | --- | --- | --- |");
    rows.forEach((r, i) => L.push(`| ${i + 1} | \`${r.pageKey || r.reachabilityKey || "run"}\` | ${r.what} | \`${r.file}\` |`));
    L.push("");
  }
  L.push(`**${plan.reads.length} read(s).** A read you cannot complete is left UNWRITTEN — never an empty file and`
    + " never a value you assumed: the gate reports a missing file as `⚠ could not read`, which is the honest answer,"
    + " while a guessed one passes a check that never ran.");
  // Named, not dropped: these keys gate rows like any other, and a reader who sees only the read list would take
  // the rows that depend on them for rows nobody owes anything on.
  if (plan.evidenceIds?.length) {
    L.push("", "**Not reads either — `evidence.json` and `judge.json` beside this folder**", "",
      `Written for you with all ${plan.evidenceIds.length} published id(s) already as keys — **fill the values, never`
      + " the keys.** The evidence records a build agent filed, and the independent verdict on them, live in no page"
      + " body and on no stand row, so nothing can read them back; an id retyped off this table is the one that goes"
      + " wrong. An existing file is never overwritten. Leave a record out and its row says so in its own words.");
  }
  if (plan.builderRecorded?.length) {
    L.push("", "**Not reads — the BUILD agent records these**", "",
      "| Key | What it records |", "| --- | --- |",
      ...plan.builderRecorded.map((b) => `| \`${b.reachabilityKey}\` | ${b.what} — the outcome the build agent`
        + " observed when it ran the converter; the stand does not answer it afterwards, so there is nothing to read back |"));
  }
  return L.join("\n") + "\n";
}

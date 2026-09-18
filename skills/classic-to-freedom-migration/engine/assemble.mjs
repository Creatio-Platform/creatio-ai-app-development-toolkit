// COMPOSING THE `--verify` PAYLOAD — half two of reads.mjs's contract: open the files that plan named and build
// `built.json` from them. Every value is lifted from a file clio wrote, at a fixed path. The ONE derived value is
// `entitySchemaName`, which is in neither file's top level and is computed from the primary data source rather
// than asked of the agent.
//
// THREE ANSWERS A SLOT CAN CARRY, and they must never read alike:
//   a file written   — the answer; its values compose into the payload.
//   a file UNWRITTEN — "I could not ask". The key is OMITTED and the file is named in `problems`; an omitted key
//                      resolves ⚠ unverified and fails the gate at exit 2. Never `false`, which asserts the page
//                      is absent — a verdict about the stand a failed read has not earned — and never a
//                      fabricated entry, which would pass a check nobody ran.
//   the literal `false` — "I asked and the stand says there is no such schema". Composes to the payload's `false`
//                      entry, a hard ❌ MISSING that opens a repair. Both of a page's files must say it.
// A literal `null` is none of the three and is a problem of its own (see `readJson`).
import fs from "node:fs";
import path from "node:path";
import { READS_DIR, READS_INDEX_FILE } from "./reads.mjs";

export const BUILT_FILE = "built.json";
// The verify table's default home on a `--from` run — beside the payload it judges, so the pair is re-checkable
// together or not at all.
export const VERIFY_FILE = "verify.md";
// The two halves of the payload that are NOT stand reads: `evidence` (what a build agent did that no page body
// can show) and `judge` (an independent verdict on those records). The stand holds neither, so they are files
// beside the read plan rather than reads in it, keyed by the ids the ENGINE publishes.
export const EVIDENCE_FILE = "evidence.json";
export const JUDGE_FILE = "judge.json";
// The provenance field's shape, in ONE place: the drop-sweep here applies the same test the payload guard will.
// migrate.mjs imports it from here, not the reverse — this module has no dependency on that one.
export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `meta.json` nests everything under `page`; a caller that copied only that block is accepted too, because the
// difference is one level of nesting and refusing it would be a rule about typing, not about content.
const metaPage = (j) => (j && typeof j === "object" && j.page && typeof j.page === "object" ? j.page : j) || {};

const META_FIELDS = ["schemaName", "schemaUId", "packageName", "packageUId", "parentSchemaName"];
const BUNDLE_FIELDS = ["viewConfig", "modelConfig", "viewModelConfig", "handlers"];

// The entity the page's PRIMARY data source is bound to, for `--verify`'s entity row. `modelConfig` names the
// primary source; that source's config names the entity. Derived rather than asked of the agent — "read two
// levels down and retype it" is transcription. `null` when the bundle does not say, never a guess.
export function entityOfBundle(bundle) {
  const mc = bundle?.modelConfig;
  const name = mc?.primaryDataSourceName;
  if (!name) return null;
  const ds = mc.dataSources?.[name];
  return ds?.config?.entitySchemaName ?? null;
}

// Every file the index names must resolve INSIDE `<dir>/reads/`. A `file` carrying `../` would otherwise read
// whatever it points at and compose it as a page — a hand-edited index reaching out of the migration folder.
function resolvedReadPath(dir, file) {
  const root = path.resolve(dir, READS_DIR);
  const full = path.resolve(dir, file);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}

function readJson(dir, file, problems, what) {
  const full = resolvedReadPath(dir, file);
  if (!full) {
    problems.push({ file, what, why: `resolves outside \`${READS_DIR}/\` — a read may only name a file inside the`
      + " migration folder's read directory. Re-run `--reads <dir>`" });
    return null;
  }
  if (!fs.existsSync(full)) { problems.push({ file, what, why: "not written — the read did not happen, or its answer went somewhere else" }); return null; }
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(full, "utf8")); }
  catch (e) { problems.push({ file, what, why: `not readable as JSON (${e.message}) — copy the file whole, byte for byte` }); return null; }
  // A literal `null` is NEITHER an answer nor an absence, and is one keystroke from `false`, which IS an absence.
  // Every caller treats a null as "nothing arrived", so unnamed it slips through as a silently unchecked row.
  if (parsed === null) {
    problems.push({ file, what, why: "holds `null`, which is neither an answer nor an absence — write the response"
      + " verbatim, or `false` if the stand answered that there is no such schema" });
    return null;
  }
  return parsed;
}

// The `evidence.json` / `judge.json` files sit BESIDE the read directory, not inside it, so they bypass the
// read-path guard by design; they are engine-named and never come from the index.
function readSideFile(dir, file, problems, what) {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) return null;
  try { return JSON.parse(fs.readFileSync(full, "utf8")); }
  catch (e) { problems.push({ file, what, why: `not readable as JSON (${e.message})` }); return null; }
}

// THE STALE-INDEX CHECK. The index is a file from an EARLIER command. A key that disappeared still has its file
// and is read harmlessly; a key that was ADDED is in no read, so nothing is opened, nothing is recorded, and its
// rows read ⚠ with no sign that nobody tried.
//
// TWO CHECKS, for two different causes. The VERSION says the plan moved between the commands — re-cut it rather
// than re-run a dozen reads. The FILE SET catches what the version cannot: `computePlanVersion` hashes the whole
// manifest, so one stamp means one read list by construction, and a set that still differs was hand-edited or
// written by a different engine build. Under a matching stamp a per-read diff would find nothing more.
function staleIndexProblems(index, expect, idxFile) {
  if (!expect) return [];
  if (expect.planVersion && index.planVersion && expect.planVersion !== index.planVersion) {
    // AND NOTHING ELSE. A moved plan changes the read list by definition, so the set comparison would also fire
    // and blame a hand edit for what this line already explains. One cause, one line.
    return [{ file: idxFile, what: "the read plan", index: true,
      why: `was cut against plan \`${index.planVersion}\` and this run verifies plan \`${expect.planVersion}\``
        + " — re-run `--reads <dir>` and redo the reads it names" }];
  }
  // Compared on the FILE the read names — the one thing both sides agree is the read's identity, and the thing a
  // hand edit changes when it drops or renames a line.
  const have = new Set(index.reads.map((r) => r.file).filter(Boolean));
  const want = new Set(expect.reads.map((r) => r.file).filter(Boolean));
  const quoted = (fs_) => fs_.map((f) => `\`${f}\``).join(", ");
  const missing = [...want].filter((f) => !have.has(f));
  const extra = [...have].filter((f) => !want.has(f));
  if (!missing.length && !extra.length) return [];
  // Built as statements, not nested inside the template: the clauses are conditional and the nesting was three
  // levels deep.
  const missingClause = missing.length ? ` — nothing covers ${quoted(missing)}` : "";
  let extraClause = "";
  if (extra.length) {
    const lead = missing.length ? "; it also carries" : " — it carries";
    extraClause = `${lead} ${quoted(extra)}, which this plan does not ask for`;
  }
  return [{ file: idxFile, what: "the read plan", index: true,
    why: "does not match this engine's plan for the same version" + missingClause + extraClause
      + ". It was hand-edited, or written by a different engine build. Re-run `--reads <dir>`" }];
}

// ONE READ KIND EACH. Split out of `assembleBuilt` so that function stays under Sonar's cognitive-complexity
// budget, the same move `feedPlanObject` made in migrate.mjs. Each returns nothing and mutates the accumulator
// it is handed, because a read contributes to a shared payload rather than producing one of its own.
function composePageMeta(r, j, acc) {
  const e = acc.pageOf(r.pageKey);
  // Copied, never defaulted: a field absent from `meta.json` is absent from the payload, and the gate says so in
  // its own words. Filling one in from the plan would be the fabrication `schemaUId` exists to catch.
  const m = metaPage(j);
  for (const f of META_FIELDS) if (m[f] != null) e[f] = m[f];
  // The name this file claims, recorded for the post-loop mis-copy check. NOT compared here: the two files are
  // two rows of the index and nothing fixes their order, so a comparison made as they are read only fires when
  // the meta row happens to come first.
  if (m.schemaName != null) acc.metaName.set(r.pageKey, m.schemaName);
  if (e.schemaUId != null) acc.gotMeta.add(r.pageKey);
}

function composePageBundle(r, j, acc) {
  const e = acc.pageOf(r.pageKey);
  // `viewConfig` is the one the payload guard REQUIRES; the rest are optional in the contract and are copied
  // whenever the bundle carries them, because a gate cannot check what the payload never mentioned.
  for (const f of BUNDLE_FIELDS) if (j[f] !== undefined) e[f] = j[f];
  if (j.name != null) acc.bundleName.set(r.pageKey, j.name);
  if (e.viewConfig != null) acc.gotBundle.add(r.pageKey);
  if (e.schemaName == null && j.name != null) e.schemaName = j.name;
  const ent = entityOfBundle(j);
  if (ent != null) e.entitySchemaName = ent;
}

// A LIST, matched per dashboard on id/status/package. One value for the whole run would let eleven of twelve
// close the row while the twelfth is never mentioned, so a non-list is refused rather than coerced.
function composeDashboards(r, j, acc) {
  if (!Array.isArray(j)) {
    acc.problems.push({ file: r.file, what: "the dashboard migration log",
      why: "is not a LIST — the gate matches one entry per dashboard the plan moves, so a single value cannot"
        + " answer for the set. Copy the `DashboardMigrationLog` rows as an array" });
    return;
  }
  acc.dashboards = j;
}

const READ_LABEL = {
  pageMeta: (r) => `\`${r.pageKey}\` page metadata`,
  pageBundle: (r) => `\`${r.pageKey}\` merged bundle`,
  businessRules: (r) => `\`${r.pageKey}\` business rules`,
  reachability: (r) => `\`${r.reachabilityKey}\``,
  dashboards: () => "the dashboard migration log",
};

// A page read answers for a PAGE key, so `false` on either of its files is a denial of that page. The other
// kinds have no `false` form: their value is whatever the file holds.
const PAGE_KINDS = new Set(["pageMeta", "pageBundle"]);

function composeOneRead(dir, r, acc) {
  const label = READ_LABEL[r.kind];
  if (!label) return;
  const j = readJson(dir, r.file, acc.problems, label(r));
  if (j === null) return;
  if (j === false && PAGE_KINDS.has(r.kind)) { acc.absent.add(r.pageKey); return; }
  if (r.kind === "pageMeta") composePageMeta(r, j, acc);
  else if (r.kind === "pageBundle") composePageBundle(r, j, acc);
  else if (r.kind === "businessRules") acc.pageOf(r.pageKey).businessRules = j;
  else if (r.kind === "reachability") acc.reachability[r.reachabilityKey] = j;
  else composeDashboards(r, j, acc);
}

// THE MIS-COPY CHECK, run AFTER every read: `meta.json` for one schema beside `bundle.json` for another is an
// entry whose identity and merged view belong to DIFFERENT pages, and every other guard passes it (unique UId,
// consistent package, `viewConfig` present). Both files name their schema, so the disagreement is unambiguous.
// Post-loop and order-independent on purpose — comparing as the files are read only catches the pair when the
// index happens to list meta first, and nothing fixes that order.
function misCopiedKeys(acc) {
  const bad = [];
  for (const [k, metaName] of acc.metaName) {
    const bundleName = acc.bundleName.get(k);
    if (bundleName == null || bundleName === metaName) continue;
    acc.problems.push({ file: `${READS_DIR}/…-${k}`, what: `\`${k}\` merged bundle`,
      why: `is \`${bundleName}\`'s bundle while the metadata beside it is \`${metaName}\`'s — two different pages`
        + " in one entry. Re-copy both files from the SAME `get-page` call" });
    bad.push(k);
  }
  return bad;
}

// Reads `<dir>/reads/index.json` and everything it names. Returns the payload AND the problems, never a payload
// that quietly stands in for one: the caller decides what an unread file does to the run, and it cannot decide
// that from a payload alone. `expect` is the read plan for the manifest being verified — pass it and a stale or
// hand-edited index is named; omit it (an offline replay) and the index is taken at its word.
export function assembleBuilt(dir, expect = null) {
  const problems = [];
  const idxFile = path.posix.join(READS_DIR, READS_INDEX_FILE);
  const index = readJson(dir, idxFile, problems, "the read plan");
  if (!index || !Array.isArray(index.reads)) {
    if (index) problems.push({ file: idxFile, what: "the read plan", index: true, why: "has no `reads` array — re-run `--reads <dir>`" });
    return { built: null, problems };
  }
  problems.push(...staleIndexProblems(index, expect, idxFile));
  const pages = {};
  const acc = {
    problems, pages, reachability: {}, dashboards: null,
    absent: new Set(),   // page keys the stand answered `false` for — genuinely not built, not unread
    // Recorded as the files are read, NOT derived from `pages` afterwards: the drop sweep removes a page whose
    // other file never arrived, so by then a contradiction is indistinguishable from a half-read entry.
    gotBundle: new Set(), gotMeta: new Set(),
    metaName: new Map(), bundleName: new Map(),
    pageOf: (k) => (pages[k] ||= {}),
  };
  for (const r of index.reads) composeOneRead(dir, r, acc);
  for (const k of misCopiedKeys(acc)) delete pages[k];
  // A page whose bundle never arrived carries no `viewConfig`; one whose METADATA never arrived carries no
  // `schemaUId`. The payload guard REJECTS either at exit 1 as a shape error — which is not what happened, and it
  // kills the run before `problems` prints. Drop both to an omitted key (⚠ unverified, exit 2) and let `problems`
  // name the file. SYMMETRIC on purpose: the two files are separate copies out of one `get-page` call.
  for (const [k, e] of Object.entries(pages)) if (e.viewConfig == null || !GUID_RE.test(String(e.schemaUId ?? ""))) delete pages[k];
  // AFTER the sweep: a denied page is an answer, not a half-read entry, so it survives what drops the others.
  // Unless its two files DISAGREE — one denying the schema while the other carries that schema's own data. One
  // `get-page` call cannot answer both ways, so the pair has no legitimate reading: a copy error, named and the
  // key dropped, rather than letting whichever file was read last decide.
  for (const k of acc.absent) {
    if (acc.gotBundle.has(k) || acc.gotMeta.has(k)) {
      problems.push({ file: `${READS_DIR}/…-${k}`, what: `\`${k}\``,
        why: "its two files disagree — one says the stand has no such schema while the other carries that schema's"
          + " own data. Re-copy both from the SAME `get-page` call" });
      delete pages[k];
      continue;
    }
    pages[k] = false;
  }
  // OPTIONAL, and absent is not a problem: a run with no evidence-gated row files neither. What a missing one
  // costs is already visible — every evidence row names the id nothing was filed under.
  const built = { pages, reachability: acc.reachability };
  if (acc.dashboards) built.dashboards = acc.dashboards;
  for (const [key, file] of [["evidence", EVIDENCE_FILE], ["judge", JUDGE_FILE]]) {
    const j = readSideFile(dir, file, problems, `the ${key} records`);
    if (j != null) built[key] = j;
  }
  return { built, problems };
}

// Writes the composed payload beside the run — never a temp dir, which cannot be re-checked once the session
// ends.
export function writeBuilt(dir, built) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, BUILT_FILE);
  fs.writeFileSync(file, JSON.stringify(built, null, 2) + "\n");
  return file;
}

// TWO BUCKETS, because the remedies are opposite. A read problem is fixed by re-running that read; an INDEX
// problem is fixed by re-cutting the plan — and telling an operator to re-run a dozen reads for a stale index
// sends them to do the one thing the version line exists to spare them.
const splitProblems = (problems) => [problems.filter((p) => !p.index), problems.filter((p) => p.index)];

// The SAME facts as the stderr block, for the top of the verify artifact. Contract rule 1 makes that table the
// only sanctioned report, so a cause living only on stderr survives in nothing durable, and a ⚠ row in the file
// is otherwise indistinguishable from a page that was never built. A banner, not per-row text: the row wording
// belongs to the resolvers.
export function problemBanner(problems) {
  if (!problems.length) return [];
  const [reads, index] = splitProblems(problems);
  const L = [""];
  if (reads.length) {
    L.push(`> ⛔ **${reads.length} of the reads this gate needs could not be opened, so the rows they answer are`
      + " NOT CHECKED.** That is not the same as missing — nothing below says the stand is short on them. Re-run"
      + " these reads and verify again:", "",
    ...reads.map((p) => `> - \`${p.file}\` (${p.what}) — ${p.why}`), "");
  }
  if (index.length) {
    L.push("> ⛔ **The read plan does not match the plan this run verifies**, so the rows below are checked against"
      + " a payload composed from someone else's read list. Re-cut the plan — re-running the reads will not fix"
      + " it:", "",
    ...index.map((p) => `> - ${p.why}`), "");
  }
  return L;
}

// The stderr block for what could not be read. One line per file, naming WHAT it was for — an orchestrator
// reading stderr has to be able to tell a page it failed to read from a page that was never built.
export function problemLines(problems, dir) {
  if (!problems.length) return [];
  const [reads, index] = splitProblems(problems);
  const L = [];
  if (reads.length) {
    L.push(`migrate.mjs: ⛔ COULD NOT READ ${reads.length} of the reads the gate needs — the rows they answer are`
      + ` NOT CHECKED (not "missing": nothing here says the stand is short). Re-run those reads into ${path.join(dir, READS_DIR)} and verify again.`,
    ...reads.map((p) => `migrate.mjs:   - ${p.file} (${p.what}) — ${p.why}`));
  }
  if (index.length) {
    L.push("migrate.mjs: ⛔ STALE READ PLAN — the payload was composed from a read list that is not this plan's."
      + " Re-cut it; re-running the reads does not fix this.",
    ...index.map((p) => `migrate.mjs:   - ${p.why}`));
  }
  return L;
}

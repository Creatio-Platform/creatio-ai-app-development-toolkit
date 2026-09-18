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
//                      entry, a hard ❌ MISSING that opens a repair.
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

function readJson(dir, file, problems, what) {
  const full = path.join(dir, file);
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
  const out = [];
  if (expect.planVersion && index.planVersion && expect.planVersion !== index.planVersion) {
    // AND NOTHING ELSE. A moved plan changes the read list by definition, so the set comparison would also fire
    // and blame a hand edit for what this line already explains. One cause, one line.
    return [{ file: idxFile, what: "the read plan",
      why: `was cut against plan \`${index.planVersion}\` and this run verifies plan \`${expect.planVersion}\``
        + " — re-run `--reads <dir>` and redo the reads it names" }];
  }
  // Compared on the FILE the read names — the one thing both sides agree is the read's identity, and the thing a
  // hand edit changes when it drops or renames a line.
  const have = new Set(index.reads.map((r) => r.file).filter(Boolean));
  const want = new Set(expect.reads.map((r) => r.file).filter(Boolean));
  const missing = [...want].filter((f) => !have.has(f));
  const extra = [...have].filter((f) => !want.has(f));
  if (missing.length || extra.length) {
    out.push({ file: idxFile, what: "the read plan",
      why: "does not match this engine's plan for the same version"
        + (missing.length ? ` — nothing covers ${missing.map((f) => `\`${f}\``).join(", ")}` : "")
        + (extra.length ? `${missing.length ? "; it also carries" : " — it carries"} ${extra.map((f) => `\`${f}\``).join(", ")}, which this plan does not ask for` : "")
        + ". It was hand-edited, or written by a different engine build. Re-run `--reads <dir>`" });
  }
  return out;
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
    if (index) problems.push({ file: idxFile, what: "the read plan", why: "has no `reads` array — re-run `--reads <dir>`" });
    return { built: null, problems };
  }
  problems.push(...staleIndexProblems(index, expect, idxFile));
  const pages = {};
  const reachability = {};
  const absent = new Set(); // page keys the stand answered `false` for — genuinely not built, not unread
  // Recorded as the bundle is copied, NOT read off `pages` afterwards: the drop sweep removes a page whose other
  // file never arrived, so by then a contradiction is indistinguishable from a half-read entry.
  const gotBundle = new Set();
  const gotMeta = new Set();   // …and the same for the identity file: `meta.json` carrying a `schemaUId` is itself
                               // a statement that the stand FOUND the schema, so it contradicts a denial too.
  let dashboards = null;
  const pageOf = (k) => (pages[k] ||= {});
  for (const r of index.reads) {
    if (r.kind === "pageMeta") {
      const j = readJson(dir, r.file, problems, `\`${r.pageKey}\` page metadata`);
      if (j === null) continue;
      if (j === false) { absent.add(r.pageKey); continue; }
      const m = metaPage(j);
      const e = pageOf(r.pageKey);
      // Copied, never defaulted: a field absent from `meta.json` is absent from the payload, and the gate says so
      // in its own words. Filling one in from the plan would be the fabrication `schemaUId` exists to catch.
      for (const f of ["schemaName", "schemaUId", "packageName", "packageUId", "parentSchemaName"])
        if (m[f] != null) e[f] = m[f];
      if (e.schemaUId != null) gotMeta.add(r.pageKey);
    } else if (r.kind === "pageBundle") {
      const j = readJson(dir, r.file, problems, `\`${r.pageKey}\` merged bundle`);
      if (j === null) continue;
      if (j === false) { absent.add(r.pageKey); continue; }
      const e = pageOf(r.pageKey);
      // THE MIS-COPY CHECK. `meta.json` for one schema beside `bundle.json` for another is an entry whose identity
      // and merged view belong to DIFFERENT pages, and every other guard passes it (unique UId, consistent
      // package, `viewConfig` present). Both files name their schema, so the disagreement is unambiguous.
      // CHECKED BEFORE anything is copied: the entry must be left without `viewConfig` so the key drops out like
      // any unread page, rather than verifying one page's layout against another's identity.
      if (e.schemaName != null && j.name != null && e.schemaName !== j.name) {
        problems.push({ file: r.file, what: `\`${r.pageKey}\` merged bundle`,
          why: `is \`${j.name}\`'s bundle while the metadata beside it is \`${e.schemaName}\`'s — two different pages`
            + " in one entry. Re-copy both files from the SAME `get-page` call" });
        continue;
      }
      // `viewConfig` is the one the payload guard REQUIRES; the rest are optional in the contract and are copied
      // whenever the bundle carries them, because a gate cannot check what the payload never mentioned.
      for (const f of ["viewConfig", "modelConfig", "viewModelConfig", "handlers"])
        if (j[f] !== undefined) e[f] = j[f];
      if (e.viewConfig != null) gotBundle.add(r.pageKey);
      if (e.schemaName == null && j.name != null) e.schemaName = j.name;
      const ent = entityOfBundle(j);
      if (ent != null) e.entitySchemaName = ent;
    } else if (r.kind === "businessRules") {
      const j = readJson(dir, r.file, problems, `\`${r.pageKey}\` business rules`);
      if (j != null) pageOf(r.pageKey).businessRules = j;
    } else if (r.kind === "reachability") {
      const j = readJson(dir, r.file, problems, `\`${r.reachabilityKey}\``);
      if (j != null) reachability[r.reachabilityKey] = j;
    } else if (r.kind === "dashboards") {
      // A LIST, matched per dashboard on id/status/package. One value for the whole run would let eleven of twelve
      // close the row while the twelfth is never mentioned, so a non-list is refused rather than coerced.
      const j = readJson(dir, r.file, problems, "the dashboard migration log");
      if (j == null) continue;
      if (!Array.isArray(j)) {
        problems.push({ file: r.file, what: "the dashboard migration log",
          why: "is not a LIST — the gate matches one entry per dashboard the plan moves, so a single value cannot"
            + " answer for the set. Copy the `DashboardMigrationLog` rows as an array" });
        continue;
      }
      dashboards = j;
    }
  }
  // A page whose bundle never arrived carries no `viewConfig`; one whose METADATA never arrived carries no
  // `schemaUId`. The payload guard REJECTS either at exit 1 as a shape error — which is not what happened, and it
  // kills the run before `problems` prints. Drop both to an omitted key (⚠ unverified, exit 2) and let `problems`
  // name the file. SYMMETRIC on purpose: the two files are separate copies out of one `get-page` call.
  for (const [k, e] of Object.entries(pages)) if (e.viewConfig == null || !GUID_RE.test(String(e.schemaUId ?? ""))) delete pages[k];
  // AFTER the sweep: a denied page is an answer, not a half-read entry, so it survives what drops the others.
  // Unless its two files DISAGREE — one denying the schema while the other carries that schema's own data. One
  // `get-page` call cannot answer both ways, so the pair has no legitimate reading: a copy error, named and the
  // key dropped, rather than letting whichever file was read last decide.
  for (const k of absent) {
    if (gotBundle.has(k) || gotMeta.has(k)) {
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
  const built = { pages, reachability };
  if (dashboards) built.dashboards = dashboards;
  for (const [key, file] of [["evidence", EVIDENCE_FILE], ["judge", JUDGE_FILE]]) {
    if (!fs.existsSync(path.join(dir, file))) continue;
    const j = readJson(dir, file, problems, `the ${key} records`);
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

// The SAME facts as the stderr block, for the top of the verify artifact. Contract rule 1 makes that table the
// only sanctioned report, so a cause living only on stderr survives in nothing durable, and a ⚠ row in the file
// is otherwise indistinguishable from a page that was never built. A banner, not per-row text: the row wording
// belongs to the resolvers.
export function problemBanner(problems) {
  if (!problems.length) return [];
  return ["", `> ⛔ **${problems.length} of the reads this gate needs could not be opened, so the rows they answer are`
    + " NOT CHECKED.** That is not the same as missing — nothing below says the stand is short on them. Re-run these"
    + " reads and verify again:", "",
  ...problems.map((p) => `> - \`${p.file}\` (${p.what}) — ${p.why}`), ""];
}

// The stderr block for what could not be read. One line per file, naming WHAT it was for — an orchestrator
// reading stderr has to be able to tell a page it failed to read from a page that was never built.
export function problemLines(problems, dir) {
  if (!problems.length) return [];
  return [`migrate.mjs: ⛔ COULD NOT READ ${problems.length} of the reads the gate needs — the rows they answer are`
    + ` NOT CHECKED (not "missing": nothing here says the stand is short). Re-run those reads into ${path.join(dir, READS_DIR)} and verify again.`,
  ...problems.map((p) => `migrate.mjs:   - ${p.file} (${p.what}) — ${p.why}`)];
}

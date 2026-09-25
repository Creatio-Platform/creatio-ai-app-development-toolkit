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
// …and the orchestrated run's artifact is the migration result report, not the bare table, so it lands under its
// own name. One artifact per run either way, in the migration folder.
export const REPORT_FILE = "migration-result.md";
// The two halves of the payload that are NOT stand reads: `evidence` (what a build agent did that no page body
// can show) and `judge` (an independent verdict on those records). The stand holds neither, so they are files
// beside the read plan rather than reads in it, keyed by the ids the ENGINE publishes.
export const EVIDENCE_FILE = "evidence.json";
export const JUDGE_FILE = "judge.json";
// The on-stand keys the BUILD agent records rather than reads (see reads.mjs). Merged into `reachability`, so a
// row whose value no read can produce still has a way to close.
export const RECORDED_FILE = "recorded.json";
// The provenance field's shape, in ONE place: the drop-sweep here applies the same test the payload guard will.
// migrate.mjs imports it from here, not the reverse — this module has no dependency on that one.
export const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `meta.json` nests everything under `page`; a caller that copied only that block is accepted too, because the
// difference is one level of nesting and refusing it would be a rule about typing, not about content.
const metaPage = (j) => (j && typeof j === "object" && j.page && typeof j.page === "object" ? j.page : j) || {};

// A page key and a reachability key come from the INDEX — a file on disk, which every guard around it already
// treats as untrusted. `pages[k] ||= {}` with `k` of `__proto__` hands back `Object.prototype`, so the fields
// written for that "page" land on every object in the process: the drop sweep then finds a `viewConfig` on
// entries that never had one, and rows report as checked against data nobody read. Refused by name, so the
// problem says what is wrong with the index rather than being silently worked around.
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const META_FIELDS = ["schemaName", "schemaUId", "packageName", "packageUId", "parentSchemaName"];
const BUNDLE_FIELDS = ["viewConfig", "modelConfig", "viewModelConfig", "handlers", "resources"];

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
// The REAL path is what is checked, not the lexical one: a symlink sitting in `reads/` resolves inside the root
// lexically while pointing anywhere, which is the same escape spelled differently.
function resolvedReadPath(dir, file) {
  const root = path.resolve(dir, READS_DIR);
  const full = path.resolve(dir, file);
  const inside = (q, base) => q === base || q.startsWith(base + path.sep);
  if (!inside(full, root)) return null;
  let real;
  try { real = fs.realpathSync(full); } catch { return full; } // not there yet — the existence check names it
  let realRoot = root;
  try { realRoot = fs.realpathSync(root); } catch { /* the root itself is the caller's to create */ }
  return inside(real, realRoot) ? full : null;
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

// `false` on one page file is PART of a denial; both files have to say it (see `resolveDenials`). The other
// kinds have no `false` form.
const PAGE_KINDS = new Set(["pageMeta", "pageBundle"]);

// One entry per kind, keyed the same as `READ_LABEL`. No default arm: an unmapped kind has no entry and is
// reported rather than dispatched.
const COMPOSE = {
  pageMeta: composePageMeta,
  pageBundle: composePageBundle,
  businessRules: (r, j, acc) => { acc.pageOf(r.pageKey).businessRules = j; },
  reachability: (r, j, acc) => { acc.reachability[r.reachabilityKey] = j; },
  dashboards: composeDashboards,
};

// Which of a page's files answered `false`. A set, not a flag: the denial is complete only when both did.
function noteDenial(acc, r) {
  let denied = acc.absent.get(r.pageKey);
  if (!denied) {
    denied = new Set();
    acc.absent.set(r.pageKey, denied);
  }
  denied.add(r.kind);
}

function composeOneRead(dir, r, acc) {
  const compose = COMPOSE[r.kind], label = READ_LABEL[r.kind];
  // An unknown kind is drift between the read plan and this half. Report it; never return silently.
  if (!compose || !label) {
    acc.problems.push({ file: r.file, what: `a \`${r.kind}\` read`,
      why: "names a read kind this engine cannot compose — the read plan and the half that reads it back"
        + " disagree. Re-cut the plan with `--reads <dir>` on this engine build" });
    return;
  }
  const key = r.pageKey ?? r.reachabilityKey;
  if (key != null && UNSAFE_KEYS.has(String(key))) {
    acc.problems.push({ file: r.file, what: `\`${key}\``, index: true,
      why: `names \`${key}\` as a key, which is no page or on-stand key a plan publishes — re-run \`--reads <dir>\`` });
    return;
  }
  if (r.kind === "pageMeta") acc.metaFile.set(r.pageKey, r.file);
  else if (r.kind === "pageBundle") acc.bundleFile.set(r.pageKey, r.file);
  const j = readJson(dir, r.file, acc.problems, label(r));
  if (j === null) {
    if (PAGE_KINDS.has(r.kind)) acc.unread.add(r.pageKey);
    return;
  }
  if (j === false && PAGE_KINDS.has(r.kind)) { noteDenial(acc, r); return; }
  compose(r, j, acc);
}

// A denied page survives the drop sweep, but only when BOTH its page files answered `false`. Two ways they do
// not, checked in this order because both can be true of one key:
//   sibling carries that schema's own data -> copy error;
//   sibling silent                         -> half a read.
// Both kinds unconditionally, never the count the index happened to carry: a short index must not weaken it.
function resolveDenials(acc, pages) {
  for (const [k, denied] of acc.absent) {
    if (acc.gotBundle.has(k) || acc.gotMeta.has(k)) {
      acc.problems.push({ file: `${READS_DIR}/…-${k}`, what: `\`${k}\``,
        why: "its two files disagree — one says the stand has no such schema while the other carries that schema's"
          + " own data. Re-copy both from the SAME `get-page` call" });
      delete pages[k];
    } else if (denied.size !== PAGE_KINDS.size) {
      const silent = [...PAGE_KINDS].filter((kind) => !denied.has(kind));
      acc.problems.push({ file: `${READS_DIR}/…-${k}`, what: `\`${k}\``,
        why: `is denied by its ${[...denied].join(" and ")} file while ${silent.join(" and ")} was never written`
          + " — a denial comes from BOTH files, because one `get-page` call answers once. Write `false` into both"
          + " if the stand has no such schema, or re-read the page" });
      delete pages[k];
    } else pages[k] = false;
  }
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

// WHICH FILE to blame for an entry that arrived but is unusable — named from the index rows, because the reader
// has to know which of the two to re-copy.
function namePageShapeProblem(acc, k, noView, noUid) {
  const which = [];
  if (noView) which.push(["merged bundle", acc.bundleFile.get(k), "`viewConfig`"]);
  if (noUid) which.push(["page metadata", acc.metaFile.get(k), "a valid `schemaUId`"]);
  for (const [what, file, missing] of which) {
    acc.problems.push({ file: file || `${READS_DIR}/…-${k}`, what: `\`${k}\` ${what}`,
      why: `was written and parses, but carries no ${missing} — it is not what this read asked for. Re-copy it`
        + " from the `get-page` call for this page" });
  }
}

// WHAT THE READ LOOP ACCUMULATES. `pages` and `reachability` have a NULL prototype on purpose: nothing they hold
// can be inherited from `Object.prototype`, so even a key that slipped past the unsafe-key check could not make an
// entry look present.
function newAccumulator(problems) {
  const pages = Object.create(null);
  return {
    problems, pages, reachability: Object.create(null), dashboards: null,
    absent: new Map(),   // page key -> the page files that answered `false`; a full pair is genuinely not built
    // Recorded as the files are read, NOT derived from `pages` afterwards: the drop sweep removes a page whose
    // other file never arrived, so by then a contradiction is indistinguishable from a half-read entry.
    gotBundle: new Set(), gotMeta: new Set(),
    metaName: new Map(), bundleName: new Map(),
    // The file each half of a page came from, so an entry that arrived unusable is blamed on the right one, and
    // the keys already named for a read that never arrived, so absence is not reported twice.
    metaFile: new Map(), bundleFile: new Map(), unread: new Set(),
    pageOf: (k) => (pages[k] ||= {}),
  };
}

// A page whose bundle never arrived carries no `viewConfig`; one whose METADATA never arrived carries no
// `schemaUId`. The payload guard REJECTS either at exit 1 as a shape error — which is not what happened, and it
// kills the run before `problems` prints. Drop both to an omitted key (⚠ unverified, exit 2) and let `problems`
// name the file. SYMMETRIC on purpose: the two files are separate copies out of one `get-page` call.
//
// AND SAY WHICH FILE. A file that is missing, unparsable or `null` was named as it was read; one that EXISTS and
// parses but carries the wrong content was not — `meta.json` copied into both slots, or a truncated response,
// leaves the entry short of `viewConfig` with nothing recorded, and the key then vanishes as silently as an
// unread one. That is the outcome the three-answer contract and the banner exist to end.
function dropUnusableEntries(acc, pages) {
  for (const [k, e] of Object.entries(pages)) {
    const noView = e.viewConfig == null;
    const noUid = !GUID_RE.test(String(e.schemaUId ?? ""));
    if (!noView && !noUid) continue;
    if (!acc.unread.has(k) && !acc.absent.has(k)) namePageShapeProblem(acc, k, noView, noUid);
    delete pages[k];
  }
}

// The two halves the stand does not hold, merged from their own files. `recorded` goes UNDER the read values,
// never over them, and a `null` there is "not recorded yet" — skipped, so the row stays unconfirmed rather than
// closing on nothing.
function mergeSideFiles(dir, built, acc, problems) {
  const recorded = readSideFile(dir, RECORDED_FILE, problems, "the builder-recorded on-stand values");
  if (recorded && typeof recorded === "object") {
    for (const [k, v] of Object.entries(recorded)) {
      if (v !== null && acc.reachability[k] === undefined && !UNSAFE_KEYS.has(k)) acc.reachability[k] = v;
    }
  }
  for (const [key, file] of [["evidence", EVIDENCE_FILE], ["judge", JUDGE_FILE]]) {
    const j = readSideFile(dir, file, problems, `the ${key} records`);
    if (j != null) built[key] = j;
  }
}

// Reads `<dir>/reads/index.json` and everything it names. Returns the payload AND the problems, never a payload
// that quietly stands in for one: the caller decides what an unread file does to the run, and it cannot decide
// that from a payload alone. `expect` is the read plan for the manifest being verified — pass it and a stale or
// hand-edited index is named; omit it (an offline replay) and the index is taken at its word.
// WHICH ROWS THE DECISION LOG CLAIMS. A design-pass record that raises findings is not owned by the record — the
// owner is whoever decided, and that is written in `decisions.md`/`findings.md`. Matched by the row's OWN published
// id appearing verbatim, so nothing has to read what a finding says: the decision either names the row or it does
// not. Only ids the engine published are searched, so an unrelated string in the prose claims nothing.
export const DECISION_FILES = ["decisions.md", "findings.md"];
// An id CONTINUES where the neighbouring character could still be part of one, so a published id is not claimed by
// a longer id that merely contains it. The two sides take different sets, because they guard different shapes: an id
// is EXTENDED to its right only by more of its own name (`-<hash>` on a mis-filed key), while `:` and `.` there are
// ordinary sentence punctuation and must not hide a claim written without backticks. To its left an id is PREFIXED
// by another key, which ends in `:`, so that side keeps the wider set.
const ID_EXTENDS_RIGHT = /[A-Za-z0-9_#-]/;
const ID_EXTENDS_LEFT = /[A-Za-z0-9_:.#-]/;
const freeLeft = (ch) => ch === undefined || !ID_EXTENDS_LEFT.test(ch);
const freeRight = (ch) => ch === undefined || !ID_EXTENDS_RIGHT.test(ch);
function namedIn(text, id) {
  for (let i = text.indexOf(id); i !== -1; i = text.indexOf(id, i + 1)) {
    if (freeLeft(text[i - 1]) && freeRight(text[i + id.length])) return true;
  }
  return false;
}
// COMPOSING THE LIST IS THE ANSWER, so a folder with no decision log claims NOTHING and says so with an empty
// list. The absent field means something else entirely — a payload composed before this existed, which states
// nothing about ownership — and only a replayed payload can carry that, never a run that looked. Null is for the
// one case where the engine did not look: no published id to look for.
function decisionClaims(dir, evidenceIds, problems) {
  if (!Array.isArray(evidenceIds) || !evidenceIds.length) return null;
  let text = "";
  for (const f of DECISION_FILES) {
    const full = path.join(dir, f);
    if (!fs.existsSync(full)) continue;
    try { text += fs.readFileSync(full, "utf8") + "\n"; }
    catch (e) { problems.push({ file: f, what: "the decision log", why: `not readable (${e.message}) — no row can be shown as owned while it cannot be read` }); }
  }
  return evidenceIds.filter((id) => namedIn(text, id));
}
export function assembleBuilt(dir, expect = null) {
  const problems = [];
  const idxFile = path.posix.join(READS_DIR, READS_INDEX_FILE);
  const index = readJson(dir, idxFile, problems, "the read plan");
  if (!index || !Array.isArray(index.reads)) {
    if (index) problems.push({ file: idxFile, what: "the read plan", index: true, why: "has no `reads` array — re-run `--reads <dir>`" });
    return { built: null, problems };
  }
  problems.push(...staleIndexProblems(index, expect, idxFile));
  const acc = newAccumulator(problems);
  const pages = acc.pages;
  for (const r of index.reads) composeOneRead(dir, r, acc);
  for (const k of misCopiedKeys(acc)) delete pages[k];
  dropUnusableEntries(acc, pages);
  // After the sweep: a denial outlives what drops a half-read entry.
  resolveDenials(acc, pages);
  const built = { pages, reachability: acc.reachability };
  if (acc.dashboards) built.dashboards = acc.dashboards;
  // OPTIONAL, and absent is not a problem: a run with no evidence-gated row files neither. What a missing one
  // costs is already visible — every evidence row names the id nothing was filed under.
  mergeSideFiles(dir, built, acc, problems);
  const claims = decisionClaims(dir, index.evidenceIds, problems);
  if (claims) built.decisionClaims = claims;
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

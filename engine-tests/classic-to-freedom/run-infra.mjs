// Offline unit tests for the hand-rolled infra parsers that otherwise run ONLY inside live-network / real-tree
// CI jobs (Alexandr review): the ustar reader + integrity check in verify-vendor-upstream.mjs, and the
// glob→regex matcher in scripts/check-sonar-exclusions.mjs. These give a deterministic, network-free way to
// tell "my parser is wrong" from "npm is unreachable" / "the glob is stale". Zero dependencies (node built-ins).
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync, readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readTarEntry, integrityOk, sha256Lf } from "../../skills/classic-to-freedom-migration/engine/verify-vendor-upstream.mjs";
import { checkVendorIntegrity } from "../../skills/classic-to-freedom-migration/engine/verify-vendor.mjs";
import { parseSchema } from "../../skills/classic-to-freedom-migration/engine/engine.mjs";
import { LIST_DECISION_KINDS } from "../../skills/classic-to-freedom-migration/engine/mapper.mjs";
import { MAPPING_ROWS } from "../../skills/classic-to-freedom-migration/engine/mapping-table.mjs";
import { vendoredIndex } from "../../skills/classic-to-freedom-migration/engine/mapping-registry.mjs";
import { toRegex, baseDir } from "../../scripts/check-sonar-exclusions.mjs";
import { spawnSync } from "node:child_process";

// git is spawned by absolute path, never by bare name: a writable directory earlier on PATH
// could otherwise shadow it (Sonar S4036). These are the stock install locations on the CI
// runners and on a developer machine; when none of them exists the check below reports that
// rather than quietly passing.
// Written with forward slashes and normalized rather than spelled with escaped backslashes: the escaped form
// is three `String.raw` findings (S7780), and `path.normalize` turns these into the native separators on the
// only platform that reads them.
const GIT_CANDIDATES = process.platform === "win32"
  ? ["C:/Program Files/Git/cmd/git.exe", "C:/Program Files/Git/bin/git.exe", "C:/Program Files (x86)/Git/cmd/git.exe"].map((c) => path.normalize(c))
  : ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"];
const resolveGitExecutable = () => GIT_CANDIDATES.find((c) => existsSync(c)) || null;

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  let c = cond, threw = null;
  if (typeof cond === "function") { try { c = cond(); } catch (e) { c = false; threw = e; } }
  if (c) { pass++; console.log("  ✅ " + name); return; }
  fail++; console.log("  ❌ " + name + (threw ? "  (threw: " + threw.message + ")" : ""));
  if (detail !== undefined) { let d; try { d = typeof detail === "function" ? detail() : detail; } catch (e) { d = "<detail threw: " + e.message + ">"; } console.log("      ↳ " + (typeof d === "string" ? d : JSON.stringify(d))); }
};

/* ---- a minimal in-memory ustar tar builder (no `tar` CLI, no committed binary fixture) ---- */
const tarBlock = (name, size, prefix = "") => {
  const b = Buffer.alloc(512);
  b.write(name, 0, 100, "utf8");
  b.write((size).toString(8).padStart(11, "0") + "\0", 124, "utf8"); // octal size, 11 digits + NUL
  b.write("0", 156, "utf8");                                          // typeflag: regular file
  b.write("ustar\0", 257, "utf8"); b.write("00", 263, "utf8");        // magic + version (reader ignores, realism)
  if (prefix) b.write(prefix, 345, 155, "utf8");
  return b;
};
const makeTar = (entries) => {
  const parts = [];
  for (const e of entries) {
    const data = Buffer.from(e.content, "utf8");
    parts.push(tarBlock(e.name, data.length, e.prefix));
    const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512); data.copy(padded); parts.push(padded);
  }
  parts.push(Buffer.alloc(1024)); // two zero blocks mark end-of-archive
  return Buffer.concat(parts);
};

console.log("\n===== ustar reader (offline) =====");
const body = "export const x = 1;\nconst y = 2;\n"; // CRLF-free content
const tar = makeTar([
  { name: "package/README.md", content: "readme" },              // a preceding entry the reader must skip past
  { name: "package/dist/acorn.cjs", content: body },
]);
const entry = readTarEntry(tar, "package/dist/acorn.cjs");
check("ustar: extracts the requested entry's exact bytes (skips preceding entries by size)",
  !!entry && entry.toString("utf8") === body, () => (entry ? JSON.stringify(entry.toString("utf8")) : "null"));
check("ustar: sha256Lf of the extracted bytes matches an independent hash of the content",
  !!entry && sha256Lf(entry) === createHash("sha256").update(body, "utf8").digest("hex"));
check("ustar: a non-existent entry name returns null (not a wrong/partial slice)",
  readTarEntry(tar, "package/dist/missing.mjs") === null);
// the ustar `prefix` field (long paths): full path = prefix + "/" + name
const tarPfx = makeTar([{ name: "acorn.cjs", prefix: "package/dist", content: body }]);
check("ustar: honours the `prefix` field when reconstructing the full path",
  readTarEntry(tarPfx, "package/dist/acorn.cjs")?.toString("utf8") === body);

console.log("\n===== integrity (offline) =====");
const blob = Buffer.from("some tarball bytes");
const good = "sha512-" + createHash("sha512").update(blob).digest("base64");
check("integrity: accepts the correct sha512 SRI string", integrityOk(blob, good) === true);
check("integrity: rejects a wrong hash", integrityOk(blob, "sha512-" + createHash("sha512").update(Buffer.from("other")).digest("base64")) === false);
check("integrity: rejects a malformed / empty integrity string", integrityOk(blob, "") === false && integrityOk(blob, "not-an-sri") === false);
check("integrity: supports the sha256 algorithm prefix too", integrityOk(blob, "sha256-" + createHash("sha256").update(blob).digest("base64")) === true);

console.log("\n===== glob → regex matcher (offline) =====");
check("glob: `*` stays within a path segment (does NOT cross `/`)",
  toRegex("engine/*").test("engine/a.js") === true && toRegex("engine/*").test("engine/a/b.js") === false);
check("glob: `**` spans directories", toRegex("skills/**/fixtures/**").test("skills/x/y/fixtures/a/b.js") === true);
check("glob: a regex metacharacter in a path segment is treated LITERALLY (the `.` is escaped)",
  toRegex("a.b/*").test("a.b/x.js") === true && toRegex("a.b/*").test("aXb/x.js") === false);
check("glob: bracket/paren metacharacters in a segment are escaped (matched literally, no regex class)",
  toRegex("f[o]o/*").test("f[o]o/z") === true && toRegex("f[o]o/*").test("foo/z") === false);
check("glob: anchored — a prefix match alone does not pass", toRegex("engine/**").test("otherengine/x") === false);
check("baseDir: literal prefix before the first wildcard", baseDir("skills/x/engine/vendor/**") === "skills/x/engine/vendor");
check("baseDir: a leading-wildcard glob has an empty base (always active)", baseDir("*.js") === "");

console.log("\n===== vendor runtime integrity gate (offline) =====");
// Fix A: parseSchema feeds UNTRUSTED bodies to the vendored acorn parser; it now verifies vendor/ integrity at
// RUNTIME (not only in CI) via the PURE checkVendorIntegrity export. These goldens exercise that pure check
// offline against copied/tampered fixtures under the OS temp dir — never touching the real vendor files.
const VENDOR = fileURLToPath(new URL("../../skills/classic-to-freedom-migration/engine/vendor/", import.meta.url));
check("vendor-gate: importing verify-vendor.mjs did NOT exit the process (CLI run is guarded by import.meta.url) — the pure export is a function",
  typeof checkVendorIntegrity === "function");
check("vendor-gate: the REAL vendor dir passes (positive control — the check is not vacuously failing)",
  checkVendorIntegrity(VENDOR).ok === true);
// OS-temp fixtures cleaned in a finally so a throwing check never strands them (matches run-mapper.mjs's vv-dir pattern).
let tmpBad, tmpMissing;
try {
  // negative 1 — a byte-mutated acorn.cjs beside the genuine provenance pin
  tmpBad = mkdtempSync(path.join(os.tmpdir(), "vendorgate-bad-"));
  copyFileSync(path.join(VENDOR, "provenance.json"), path.join(tmpBad, "provenance.json"));
  writeFileSync(path.join(tmpBad, "acorn.cjs"), Buffer.concat([readFileSync(path.join(VENDOR, "acorn.cjs")), Buffer.from("\n// tampered\n")]));
  const badRes = checkVendorIntegrity(tmpBad);
  check("vendor-gate: a byte-mutated acorn.cjs FAILS integrity (ok:false + SHA-256 MISMATCH)",
    badRes.ok === false && badRes.failures.some((f) => /SHA-256 MISMATCH/.test(f)), () => JSON.stringify(badRes.failures));
  // negative 2 — provenance pins a file that is absent
  tmpMissing = mkdtempSync(path.join(os.tmpdir(), "vendorgate-missing-"));
  copyFileSync(path.join(VENDOR, "provenance.json"), path.join(tmpMissing, "provenance.json"));
  const missRes = checkVendorIntegrity(tmpMissing);
  check("vendor-gate: a MISSING pinned file FAILS (ok:false + 'cannot read')",
    missRes.ok === false && missRes.failures.some((f) => /cannot read/.test(f)));
  // the gate does NOT block normal use on the untampered vendor — parseSchema (which calls ensureVendorIntegrity
  // on the co-located real vendor) parses a benign body cleanly.
  check("vendor-gate: parseSchema still parses normally on the untampered vendor (gate passes, real use not blocked)",
    parseSchema('define("P",[],function(){return{entitySchemaName:"X",diff:[]};});', "P").entitySchemaName === "X");
} finally {
  if (tmpBad) rmSync(tmpBad, { recursive: true, force: true });
  if (tmpMissing) rmSync(tmpMissing, { recursive: true, force: true });
}

console.log("\n===== engine + classic-behaviour-analysis: source pins (offline) =====");
// Each pin below guards a FALSE SUCCESS or a nontermination path: the run reports done, or never stops, while the
// thing it exists to guarantee did not happen. They read the shipped source because the guarantee is a call site or
// a construction, which no behavioural test of the pure helpers can see.
const bhSrc = readFileSync(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
  "skills/classic-to-freedom-migration/classic-behaviour-analysis.workflow.js"), "utf8");
const mgSrc = readFileSync(path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".."),
  "skills/classic-to-freedom-migration/engine/migrate.mjs"), "utf8");

check("plan version: EVERY file-backed manifest input contributes its CONTENT, not its path — a `section` / `detailSchemas` / `profileSchemas` file could be rewritten with the version unchanged, so an old approval authorised a plan the user never saw",
  /typeof value\.file === "string" \|\| typeof value\.body === "string"/.test(mgSrc)
    && /h\.update\(schemaBodyFor\(value, readBody\)\)/.test(mgSrc)
    && /\(k === "file" \|\| k === "body"\)/.test(mgSrc));
check("--stubs totals carry `members`, and the shortcut needs BOTH counts explicitly zero — `!totals.members` was true for a digest that never had the field, so a surface with message/mixin members skipped its analysis",
  /members: result\.stubIndex\.reduce/.test(mgSrc)
    && /zeroCount\(declaredTotals\.stubs\) && zeroCount\(declaredTotals\.members\)/.test(bhSrc));
// The root-only GUARD itself is asserted behaviourally in run-mapper.mjs (a nested fold given a `section` bundle
// emits no section scope). This pin only keeps the construction in its own function: inlined back into
// `runMigration` it pushed that function past the repo's pinned Sonar cognitive complexity 15.
check("--stubs section scope is built by `sectionStubScopes`, which returns 0 or 1 scope and owns the root-only guard — a nested fold emitting one would inject a mid-array entry into the parent's childStubScopes (`slice(1)`) and break the section-is-LAST contract",
  /function sectionStubScopes\(manifest, opts, sectionSchemas\)/.test(mgSrc)
    && /if \(opts\.scopeSchema \|\| !sectionSchemas\.length\) return \[\];/.test(mgSrc)
    && /\.\.\.sectionScopes,/.test(mgSrc));
check("behaviour analysis: a Context agent that returned NOTHING is a failed run, not a surface with nothing to describe",
  /stopped: 'context-failed'/.test(bhSrc) && /if \(!ctx\) \{/.test(bhSrc));
check("behaviour analysis: completion requires a Merge that actually produced the report and the index — coverage alone left the run claiming done with fallback paths that may not exist",
  // Optional chaining now (the null-guard was spelled out longhand); the GUARANTEE is unchanged — the verdict
  // requires a Merge that produced BOTH deliverables, not merely a coverage count.
  /const mergeOk = !!\(merged\?\.reportPath && merged\?\.indexPath\)/.test(bhSrc)
    && /const complete = mergeOk && isComplete\(/.test(bhSrc));
check("behaviour analysis: a BLANK card is not coverage — the schema sets no minLength and the engine reads an empty card as absent",
  /const hasCard = \(e\) =>/.test(bhSrc) && /entriesOf\(rs\)\.filter\(hasCard\)/.test(bhSrc));

/* --- THE REFERENCE DOC'S ⚠ Confirm LIST, pinned to the engine's closed kind set. The doc states the set is closed —
   "a kind absent from a run's plan means the run had nothing to ask, never that the question went unasked" — which a
   reader ACTS on: a kind the engine raises while the doc names a smaller set reads as spurious rather than as a
   question they must answer. That makes the list load-bearing prose, so it is pinned here. --- */
const specDoc = readFileSync(fileURLToPath(new URL("../../skills/classic-to-freedom-migration/references/page-design-spec.md", import.meta.url)), "utf8");
const docKinds = [...new Set([...specDoc.matchAll(/\*\*\[(list-[a-z-]+)\]\*\*/g)].map((m) => m[1]))].sort((a, b) => a.localeCompare(b));
const engineKinds = [...LIST_DECISION_KINDS].sort((a, b) => a.localeCompare(b));
check("page-design-spec.md: documents EVERY `list-*` decision kind the engine can raise, and no kind it cannot — the doc calls the set closed, so a reader treats an undocumented item as spurious instead of answering it",
  docKinds.join(",") === engineKinds.join(","),
  () => ({ missingFromDoc: engineKinds.filter((k) => !docKinds.includes(k)),
    notEmittedByEngine: docKinds.filter((k) => !engineKinds.includes(k)) }));
// …and the registry has to BE the source. A push site that inlines the string would grow the emitted set without
// growing `LIST_DECISION_KINDS`, so the check above would pass on a stale doc — the exact drift it exists to catch.
const mapperSrc = readFileSync(fileURLToPath(new URL("../../skills/classic-to-freedom-migration/engine/mapper.mjs", import.meta.url)), "utf8");
check("mapper.mjs: every list decision reads its kind from `LIST_DECISION_KIND` — no push site inlines the string, so the exported set cannot fall behind what the engine emits",
  !new RegExp("kind: " + '"' + "list-").test(mapperSrc) && LIST_DECISION_KINDS.length === 8,
  () => ({ inlined: mapperSrc.split("\n").filter((l) => /kind: "list-/.test(l)).map((l) => l.trim().slice(0, 90)),
    registrySize: LIST_DECISION_KINDS.length }));

/* ================================================================================================
   Workflow scripts must PARSE. The host evaluates a `*.workflow.js` as an ASYNC FUNCTION BODY — top-level
   `await` and top-level `return` are legal there, so `node --check` on the file itself rejects a valid script
   and `import()` would EXECUTE it. Wrapping it the way the host does is the only honest syntax check.
   Why this exists: these scripts are edited as text and their prompts are template literals full of backticks,
   so a stray backtick terminates the literal and breaks the file. That happened TWICE while writing ENG-94975,
   and both times a human caught it — nothing in the suite would have failed. A broken workflow is not a subtle
   defect: the skill cannot run at all.
   ================================================================================================== */
{
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const skillsDir = path.join(repoRoot, "skills");
  const wfFiles = [];
  for (const d of readdirSync(skillsDir)) {
    const dir = path.join(skillsDir, d);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) if (f.endsWith(".workflow.js")) wfFiles.push(path.join(dir, f));
  }
  check("workflow scripts: at least one `*.workflow.js` ships under skills/ (else the checks below are vacuous)",
    wfFiles.length >= 1, () => ({ found: wfFiles.map((f) => path.basename(f)) }));

  /* LINE ENDINGS. A CR in one of these files does not break the script — it stops the host from ever running it.
     The `Workflow` permission handler inlines a `scriptPath` file into the `script` field so the approval dialog
     can show it, and that field rejects control characters: `\n` and `\t` pass, `\r` does not. So a Windows
     checkout with `core.autocrlf=true` (the Git for Windows default) turned the shipped LF blob into CRLF and the
     workflow failed schema validation before a single agent ran — reported from a real run, and mystifying at the
     point of failure because nothing in the script is wrong. ENG-94529 pinned `*.workflow.js text eol=lf`.
     The ON-DISK check is the one that matters and it needs no git: run this suite on a checkout that converted
     the file and it goes red here, naming the file, instead of failing later inside the host. */
  for (const file of wfFiles) {
    const raw = readFileSync(file, "utf8");
    const crs = (raw.match(/\r/g) || []).length;
    check(`workflow script ${path.basename(file)} is LF on disk — a CR makes the host reject it at the approval dialog, before the script runs`,
      crs === 0, () => `${crs} CR byte(s) present; expected 0 (is \`core.autocrlf\` rewriting it? \`.gitattributes\` pins \`*.workflow.js text eol=lf\`)`);
  }
  // …and the pin that keeps it that way on a fresh clone. Asserted through git's OWN resolution, not by reading
  // the file, so a later `*.js` entry that overrode it would be caught too. When git cannot be consulted (this
  // suite also runs from a plugin install that may not be a checkout) the detail says so rather than the check
  // quietly passing on nothing.
  {
    const rels = wfFiles.map((f) => path.relative(repoRoot, f));
    const gitExecutable = resolveGitExecutable();
    const r = gitExecutable
      ? spawnSync(gitExecutable, ["check-attr", "eol", "--", ...rels], { cwd: repoRoot, encoding: "utf8" })
      : { error: { message: `no git executable at any of ${GIT_CANDIDATES.join(", ")}` }, status: null, stdout: "" };
    const usable = !r.error && r.status === 0 && typeof r.stdout === "string" && r.stdout.trim();
    const resolved = usable ? r.stdout.trim().split("\n").map((l) => l.split(": ").pop()) : [];
    const resolvedDetail = rels.map((rel, i) => `${path.basename(rel)}=${resolved[i]}`).join(", ");
    const unusableReason = r.error?.message || `status ${r.status}`;
    check("workflow scripts: `.gitattributes` pins EVERY shipped `*.workflow.js` to `eol=lf` — the fix for the Windows CRLF failure, and it must keep covering scripts added later",
      usable ? resolved.length === rels.length && resolved.every((v) => v === "lf") : false,
      () => (usable ? `git resolved: ${resolvedDetail}` : `git check-attr could not be consulted here (${unusableReason}) — the on-disk CR checks above still gate the property`));
  }

  // The symmetric guard for the OTHER side of `.gitattributes`: the `fixtures/** -text` carve-out. That one
  // rule is all that stands between the CR CR LF fixtures and a renormalisation that halves 2401 lines — and
  // because the engine normalizes line endings before parsing, such a rewrite leaves every golden GREEN, so
  // the corpus would quietly stop being the bytes the stand produced with no failing test to notice. A later
  // `*.js` or `*` rule, a reordering of the file, or a `git add --renormalize` defeats it, and until now
  // nothing observed that. Asserted through git's own resolution, exactly like the `eol=lf` pin above.
  {
    const crFixtures = [
      "ContractInInvoice", "ContractInOrder", "CoreContracts", "DocumentInContract",
      "SalesContracts", "WorkCompliance", "WorkOverride",
    ].map((stem) => path.join("engine-tests", "classic-to-freedom", "fixtures", "contract", `${stem}.js`));

    const gitExecutable = resolveGitExecutable();
    const r = gitExecutable
      ? spawnSync(gitExecutable, ["check-attr", "text", "--", ...crFixtures], { cwd: repoRoot, encoding: "utf8" })
      : { error: { message: `no git executable at any of ${GIT_CANDIDATES.join(", ")}` }, status: null, stdout: "" };
    const usable = !r.error && r.status === 0 && typeof r.stdout === "string" && r.stdout.trim();
    const resolved = usable ? r.stdout.trim().split("\n").map((l) => l.split(": ").pop()) : [];
    const detail = crFixtures.map((rel, i) => `${path.basename(rel)}=${resolved[i]}`).join(", ");
    const unusableReason = r.error?.message || `status ${r.status}`;
    // `-text` resolves as "unset"; anything else (`set`, `auto`, `unspecified`) means an EOL conversion can reach them.
    check("fixtures: `.gitattributes` still resolves `text` to UNSET for every CR CR LF fixture — the `-text` carve-out is the only thing keeping the corpus byte-identical to what the stand emitted, and a renormalisation would leave the goldens green",
      usable ? resolved.length === crFixtures.length && resolved.every((v) => v === "unset") : false,
      () => (usable ? `git resolved: ${detail}` : `git check-attr could not be consulted here (${unusableReason}) — the on-disk CR canary below still gates the property`));

    // The positive byte canary. `check-attr` proves the RULE; this proves the FILES, so the pair also catches a
    // rewrite that already happened before the rule was weakened. A count, not "it parses" — parsing survives
    // the corruption, which is the whole problem.
    for (const rel of crFixtures) {
      const abs = path.join(repoRoot, rel);
      const buf = readFileSync(abs);
      let doubleCr = 0;
      for (let i = 0; i + 2 < buf.length; i++) {
        if (buf[i] === 0x0d && buf[i + 1] === 0x0d && buf[i + 2] === 0x0a) doubleCr++;
      }
      check(`fixtures: ${path.basename(rel)} still holds CR CR LF sequences on disk — a halved fixture parses exactly as well and would ship silently`,
        doubleCr > 0, () => `${doubleCr} CR CR LF sequence(s) found; expected at least one`);
    }
  }

  for (const file of wfFiles) {
    const name = path.basename(file);
    const src = readFileSync(file, "utf8");
    const wrapped = `async function __hostBody(args, log, phase, agent, parallel) {\n${src.replace("export const meta =", "const meta =")}\n}\n`;
    const tmp = path.join(os.tmpdir(), `c2f_wf_syntax_${process.pid}_${name}.mjs`);
    let status = 1, stderr = "";
    try {
      writeFileSync(tmp, wrapped);
      const r = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
      status = r.status; stderr = r.stderr || "";
    } finally { try { unlinkSync(tmp); } catch { /* best effort */ } }
    check(`workflow syntax: ${name} parses as an async function body (a stray backtick in a prompt breaks the whole skill)`,
      status === 0, () => stderr.split("\n").slice(0, 6).join("\n"));

    check(`workflow shape: ${name} declares \`export const meta\` with a name and phases`,
      /export const meta\s*=\s*\{/.test(src) && /name:\s*['"]/.test(src) && /phases:\s*\[/.test(src),
      () => src.slice(0, 200));

    check(`workflow sandbox: ${name} imports nothing — the host supplies args/log/phase/agent/parallel and no module loader`,
      !/^[ \t]*import\s+/m.test(src) && !/\brequire\s*\(/.test(src),
      () => src.split("\n").find((l) => /^[ \t]*import\s+/.test(l) || /\brequire\s*\(/.test(l)) || "?");
  }
}

// ---------------------------------------------------------------------------
// classic-behaviour-analysis.workflow.js — the step-5.1 run's own pure block. The workflow script is NOT an
// importable module: the host evaluates it as a function body (top-level `await` and top-level `return`, with
// `args`/`agent`/`phase`/`log`/`parallel` injected as globals), so `import`ing it here would be a SyntaxError and
// adding `export` to it would break the host contract. Instead the file marks its pure block with sentinels and this
// test SLICES that block out of the shipped source and imports it as a real ES module under the OS temp dir — no
// `new Function`, no eval — so what runs here is the code that ships, not a copy of it. This script decides
// COVERAGE, and coverage that an agent asserts instead of the script computing it is the failure the whole workflow
// exists to prevent.
// ---------------------------------------------------------------------------
const BEGIN = "// ---8<--- PURE DECISION HELPERS ---8<---";
const END = "// ---8<--- END PURE DECISION HELPERS ---8<---";
const CBA = fileURLToPath(new URL("../../skills/classic-to-freedom-migration/classic-behaviour-analysis.workflow.js", import.meta.url));
const cbaSrc = readFileSync(CBA, "utf8");
const cbaFrom = cbaSrc.indexOf(BEGIN), cbaTo = cbaSrc.indexOf(END);
check("cba workflow: the pure-helper block is present and delimited in the shipped file",
  cbaFrom >= 0 && cbaTo > cbaFrom, () => `BEGIN at ${cbaFrom}, END at ${cbaTo}`);
// The generated workflow inlines the whole host-neutral core between the sentinels, so the slice still
// carries every decision helper — that is what keeps this offline suite reading the artifact that SHIPS.
const CBA_HELPERS = ["packBatches", "wiringOnlyMixinKeys", "repairKeys", "isComplete", "digestKeyOf", "retryOnDeath", "critiqueDeathLine", "isCritiqueShape"];
let cba = {};
let tmpCba;
try {
  tmpCba = mkdtempSync(path.join(os.tmpdir(), "cba-helpers-"));
  const modPath = path.join(tmpCba, "helpers.mjs");
  writeFileSync(modPath, `${cbaSrc.slice(cbaFrom + BEGIN.length, cbaTo)}\nexport { ${CBA_HELPERS.join(", ")} };\n`);
  cba = await import(pathToFileURL(modPath).href);
} catch (e) {
  check("cba workflow: the pure-helper block loads as a standalone module (it closes over nothing)", false, e.message);
} finally {
  if (tmpCba) rmSync(tmpCba, { recursive: true, force: true });
}
check("cba workflow: every helper this suite covers is inside the markers (a move-out cannot silently empty it)",
  CBA_HELPERS.every((h) => typeof cba[h] === "function"),
  () => CBA_HELPERS.filter((h) => typeof cba[h] !== "function").join(", "));

// --- engine: the member digest the coverage arithmetic reads. Two child pages of one surface can declare the same
// member, so a key without its scope counted two rows as one and let ONE card close both; and a disposition string
// nobody validated cleared a member row on a typo.
check("engine: `memberDispositions` accepts only the four dispositions the gate's own remediation text names — any string counted as resolved, so a typo cleared a member",
  /const MEMBER_DISPOSITIONS = new Set\(\["ported", "dropped", "blocked", "n\/a"\]\)/.test(mgSrc)
    && /MEMBER_DISPOSITIONS\.has\(dec\.disposition\)/.test(mgSrc));
check("engine: a MEMBER key carries its scope — two child pages declaring the same member produced one key, so the coverage Set counted two rows as one and ONE card closed both",
  /function memberDigestOf\(changeSet, scopeSchema\)/.test(mgSrc)
    && /key: scopeSchema \? `\$\{scopeSchema\}::\$\{n\.kind\}:\$\{n\.item\}`/.test(mgSrc)
    && /memberDigestOf\(changeSet, schema\)/.test(mgSrc));
// The scoped-first / bare-second lookup lives in ONE helper now (`behaviourEntry`), shared by the method leg and
// the member leg, so this pins the helper AND the member call site handing it the `<kind>:<item>` key — pinning
// only the helper would pass while the member leg quietly stopped using it.
check("engine: the member lookup accepts the scoped form FIRST and the bare one after, so a `behaviour-index.json` written before scoping still resolves",
  /const entry = \(scopeSchema \? map\[`\$\{scopeSchema\}::\$\{key\}`\] : undefined\) \?\? map\[key\]/.test(mgSrc)
    && /const key = `\$\{n\.kind\}:\$\{n\.item\}`/.test(mgSrc)
    && /behaviourEntry\(map, scopeSchema, key\)/.test(mgSrc));
check("engine: the ADVISORY wiring-only leg resolves member keys the same way — reading the scoped key alone made its banner go quiet on an index using bare keys",
  /const memberKey = \(m\) => \(map\[m\.key\] \? m\.key : `\$\{m\.kind\}:\$\{m\.item\}`\)/.test(mgSrc));

// --- digestKeyOf: one normalizer for both legs. Digest MEMBER keys carry their scope now, because two child pages
// of one surface can declare the same member (`attribute-virtual:IsEditable`) — the unscoped key made the coverage
// Set count two distinct rows as one and let ONE card close both. An analysis agent may answer with either form.
{
  const keys = new Set(["DealMini::mixin:M", "main::mixin:M", "child:A::mixin:Only"]);
  check("digestKeyOf: an EXACT key wins",
    () => (cba.digestKeyOf("DealMini::mixin:M", keys) === "DealMini::mixin:M"));
  check("digestKeyOf: a BARE answer resolves to the one scoped key that owns it — an index written before member keys carried a scope still matches",
    () => (cba.digestKeyOf("mixin:Only", keys) === "child:A::mixin:Only"));
  check("digestKeyOf: an AMBIGUOUS bare answer resolves to NOTHING — two pages declare `mixin:M`, so the answer cannot be attributed and is coverage of neither",
    () => (cba.digestKeyOf("mixin:M", keys) === null));
  check("digestKeyOf: a key nothing owns is null, and an empty key set is not a throw",
    () => (cba.digestKeyOf("mixin:Nope", keys) === null && cba.digestKeyOf("x", new Set()) === null));
  check("wiringOnlyMixinKeys: reads the kind off the RESOLVED key, so a scoped digest key is still recognised as a mixin row (the old `startsWith('mixin:')` matched none of them and this blocking leg went quiet)",
    () => (cba.wiringOnlyMixinKeys([{ key: "mixin:M2", card: "main/C1" }], new Set(["child:B::mixin:M2"]))
      .join(",") === "child:B::mixin:M2"));
}

// --- wiringOnlyMixinKeys: the two-card rule's computed floor. A `mixin:` row described by a wiring card alone is
// measurably incomplete — its body is another schema and the Context phase cards every mixin body. The wiring card
// says how the surface USES the behaviour; the conditions that gate it live in the body's own card, so a row citing
// only the wiring card reads as fully described while its guards are named nowhere the plan points.
const allMixinKeys = new Set(["mixin:LeadMixin", "mixin:Other", "message:Refresh", "someMethod"]);
check("wiringOnlyMixinKeys: a mixin row with a wiring card and NO bodyCard is flagged",
  () => (cba.wiringOnlyMixinKeys([{ key: "mixin:LeadMixin", card: "main/C28", ac: ["AC-200"] }], allMixinKeys)
    .join(",") === "mixin:LeadMixin"));
check("wiringOnlyMixinKeys: a bodyCard clears it — that IS the two-card shape the rule asks for",
  () => (cba.wiringOnlyMixinKeys([{ key: "mixin:LeadMixin", card: "main/C28", bodyCard: "shared/C09" }], allMixinKeys).length === 0));
check("wiringOnlyMixinKeys: a bodyCard on ANY entry for the key clears it, so two describe agents splitting one row do not flag each other",
  () => (cba.wiringOnlyMixinKeys([{ key: "mixin:LeadMixin", card: "main/C28" }, { key: "mixin:LeadMixin", bodyCard: "shared/C09" }], allMixinKeys).length === 0));
check("wiringOnlyMixinKeys: non-mixin kinds are NOT flagged — a message counterpart may be in-surface, one module-dep key hides many bodies, externalRef is the engine's leg",
  () => (cba.wiringOnlyMixinKeys([{ key: "message:Refresh", card: "c" }, { key: "someMethod", card: "c" }], allMixinKeys).length === 0));
check("wiringOnlyMixinKeys: a key this run does not own is ignored (that is the unmatched-key report, not a missing body card)",
  () => (cba.wiringOnlyMixinKeys([{ key: "mixin:NotOurs", card: "c" }], allMixinKeys).length === 0));
check("wiringOnlyMixinKeys: an entry with NEITHER card is not flagged — it is an UNCOVERED row, counted by the coverage arithmetic instead",
  () => (cba.wiringOnlyMixinKeys([{ key: "mixin:Other" }], allMixinKeys).length === 0));
check("wiringOnlyMixinKeys: the same key flagged twice collapses to one, and malformed/empty input is an empty result rather than a throw",
  () => (cba.wiringOnlyMixinKeys([{ key: "mixin:Other", card: "a" }, { key: "mixin:Other", card: "b" }], allMixinKeys).length === 1
    && cba.wiringOnlyMixinKeys([], allMixinKeys).length === 0
    && cba.wiringOnlyMixinKeys(undefined, allMixinKeys).length === 0
    && cba.wiringOnlyMixinKeys([{}, null], allMixinKeys).length === 0));
// `INDEX_ENTRY` sets no `minLength`, so `bodyCard: ""` is schema-valid and reachable. Pinned on BOTH legs (the
// engine's `cardRef` in run-mapper) — one row read differently by each is how blocking and advisory disagree.
check("wiringOnlyMixinKeys: a BLANK bodyCard does not clear the flag — an empty placeholder is not a body card",
  () => (cba.wiringOnlyMixinKeys([{ key: "mixin:LeadMixin", card: "main/C28", bodyCard: "" }], allMixinKeys)
    .join(",") === "mixin:LeadMixin"));
check("wiringOnlyMixinKeys: a WHITESPACE-ONLY bodyCard does not clear it either — this is the leg that read `\"\"` as present",
  () => (cba.wiringOnlyMixinKeys([{ key: "mixin:LeadMixin", card: "main/C28", bodyCard: "   " }], allMixinKeys)
    .join(",") === "mixin:LeadMixin"));
check("wiringOnlyMixinKeys: a blank `card` is not a wiring card — that row is UNCOVERED, and saying 'add a bodyCard' would be the wrong instruction",
  () => (cba.wiringOnlyMixinKeys([{ key: "mixin:LeadMixin", card: "  " }], allMixinKeys).length === 0));

// --- repairKeys / isComplete: the run's own arithmetic, extracted so the verdict is TESTED and not merely
// pattern-matched in the source. The call-site pins below then only have to say WHERE they are called.
check("repairKeys: all three lists are dispatched — a row the critique alone names, and a row only the filter names, both come back",
  () => (cba.repairKeys(["a"], ["b"], ["c"]).sort().join(",") === "a,b,c"));
check("repairKeys: a row named by two of the three is dispatched ONCE — a scope is not asked to describe it twice",
  () => (cba.repairKeys(["a", "b"], ["b"], ["a"]).sort().join(",") === "a,b"));
check("repairKeys: nothing to repair is an empty set, and missing lists are empty rather than a throw",
  () => (cba.repairKeys([], [], []).length === 0 && cba.repairKeys(undefined, undefined, undefined).length === 0));
check("isComplete: every row covered and no wiring-only row left ⇒ complete",
  () => (cba.isComplete(3, [], []) === true));
check("isComplete: an uncovered row blocks it",
  () => (cba.isComplete(3, ["a"], []) === false));
check("isComplete: a wiring-only row blocks it too — that is the whole point of counting them",
  () => (cba.isComplete(3, [], ["mixin:LeadMixin"]) === false));
check("isComplete: ZERO keys is NOT complete — an empty digest returns through the skip path, so reaching the verdict with no keys means the count never ran",
  () => (cba.isComplete(0, [], []) === false));
check("isComplete: missing lists do not throw and do not silently pass",
  () => (cba.isComplete(2, undefined, undefined) === true && cba.isComplete(0, undefined, undefined) === false));

// The helper being right is not the run USING it (the lesson pinned for `preflightToRun` above). These are
// source-level on purpose: the call sites close over run state, so deleting the filter — or dropping it out of the
// completeness verdict — leaves every unit test above passing while the run goes back to asserted coverage.
check("cba workflow: the run FEEDS the filter and RE-COMPUTES it after the repair round",
  (cbaSrc.match(/wiringOnly\s*=\s*wiringOnlyMixinKeys\(entriesOf\(described\), allKeys\)/g) || []).length === 2,
  () => cbaSrc.split("\n").filter((l) => /wiringOnlyMixinKeys/.test(l)).join("\n"));
check("cba workflow: the verdict is `isComplete` over the run's counts — not a hand-inlined boolean that can drift from the tested one — AND it also requires a Merge that produced the deliverables",
  /const complete = mergeOk && isComplete\(allKeys\.size, uncoveredKeys, wiringOnly\)/.test(cbaSrc));
check("cba workflow: the repair set is built by `repairKeys` off all three lists, so the flagged rows are re-described rather than only reported",
  /const toRepair = repairKeys\(uncoveredKeys, critiqueUncovered, wiringOnly\)/.test(cbaSrc));
// The retry BEHAVIOUR is asserted executably against `retryOnDeath` further down — this pin only keeps the call
// site WIRED to that helper. Source-matching alone was the whole defect: it proved the loop's shape was in the
// file and nothing about whether a second attempt ever fires (PR#88 review, Major).
check("cba workflow: the Critique call site DELEGATES to the executable `retryOnDeath` helper, handing it the work STEP per attempt AND a notifier that logs `critiqueDeathLine` — without the notifier clause here the whole cause-reporting deliverable could be deleted with a green suite, because a missing notifier is legitimately tolerated",
  /const \{ result: critique, ran: critiqueReturned \} = yield\* retryOnDeath\(/.test(cbaSrc)
    && /critiqueStep,/.test(cbaSrc)
    && /log\(critiqueDeathLine\(attempt, error, willRetry\)\)/.test(cbaSrc));
// Both legs must read the helper's `ran`, never `critique`'s truthiness: a falsy-but-present Critique result would
// otherwise be reported as a phase that never ran, marking a real answer UNCHECKED (PR#88 review, Major).
check("cba workflow: a Critique that never ran is LOUD and machine-readable — the log says coverage.complete is arithmetic-only, and the result carries `critiqueRan` so the caller sees it without reading logs",
  /if \(!ran\) log\('⚠ Critique never ran[^']*arithmetic-only/.test(cbaSrc)
    // `[ \t]*`, never `\s*`: `\s` matches the line terminator too, so under `/m` the quantifier overlaps the `^`
    // it follows and the match backtracks super-linearly across a source file this size. Indentation is also what
    // this actually means — a leading newline was never part of the shape being pinned.
    && /^[ \t]*critiqueRan,$/m.test(cbaSrc));
check("cba workflow: NEITHER leg re-derives 'did it run' from the result's truthiness — that inference is the defect, and it reads identically to the correct code unless the shape is pinned",
  !/critiqueRan: !!critique/.test(cbaSrc) && !/if \(!critique\) log/.test(cbaSrc));
// The RETRY question and the REPORTED question are not the same one, and conflating them fails in the UNSAFE
// direction: a non-nullish non-critique stops the retry loop legitimately, but reporting it as a pass that ran
// claims `conflicts`/`settledElsewhere` are verified-empty for a pass that checked nothing.
check("cba workflow: the REPORTED `critiqueRan` narrows the helper's `ran` through `isCritiqueShape` — `ran` alone would sell a non-critique return as an adversarial pass with no conflicts found",
  // The narrowing lives in `reportCritique` now (one home for the boolean AND its two log lines); the call site
  // reads the answer instead of re-deriving it. Both halves are pinned: the narrowing itself, and that the caller
  // takes it from there.
  /const ran = critiqueReturned && isCritiqueShape\(critique\)/.test(cbaSrc)
    && /const critiqueRan = reportCritique\(critique, critiqueReturned, log\)/.test(cbaSrc));
check("cba workflow: a return that is present but NOT a critique gets its own log line — 'returned something unusable' and 'the host never answered' need different repairs, and one line for both made the first read as a clean pass",
  /if \(critiqueReturned && !ran\) \{/.test(cbaSrc)
    && /treating the pass as dead/.test(cbaSrc));
/* ---- the Critique retry, EXECUTED — MOVED --------------------------------------------------------------
   `retryOnDeath`, `critiqueDeathLine` and `isCritiqueShape` now live in the host-neutral core
   (skills/_workflow-core/behaviour-analysis/helpers.mjs), and the retry is a DELEGATING GENERATOR: it asks the
   driver for one more attempt instead of calling `agent()` itself. Their executable goldens moved with them, to
   `engine-tests/classic-to-freedom/run-workflow-core.mjs` — driven there against the real generator, plus the
   same checks through the real core (a rejecting Critique retried once, `critiqueRan:false`, the CAUSE in the
   log) and through the SHIPPED generated file. Both runners run in CI.
   What stays HERE is the call-site pin above: the source-level guarantee that the shipped workflow still routes
   the Critique through that helper with its notifier, which is the half a unit test cannot see. */

check("cba workflow: the flagged rows are carried to the CRITIQUE and MERGE prompts and into the returned coverage, so a caller sees them too",
  /MIXIN ROWS NAMING ONLY A WIRING CARD/.test(cbaSrc) && /MIXIN ROWS STILL NAMING ONLY A WIRING CARD/.test(cbaSrc)
    && /uncovered: uncoveredKeys, wiringOnly/.test(cbaSrc));
// ORDER, not just presence. Every pin above matches anywhere in the file, so hoisting the verdict above the repair
// block — a pure move, no text changed — would leave all of them green while `complete` ruled on the ROUND-1
// counts and reported a run finished that the repair round had not finished. That is the one mutation source-level
// pinning cannot see unless position is asserted outright.
const cbaRepairAt = cbaSrc.indexOf("if (toRepair.length) {");
const cbaVerdictAt = cbaSrc.indexOf("const complete = mergeOk && isComplete(");
check("cba workflow: the verdict is computed AFTER the repair round — hoisting it above would read the stale round-1 counts and pass every pin above",
  cbaRepairAt > 0 && cbaVerdictAt > cbaRepairAt,
  () => `repair block at ${cbaRepairAt}, verdict at ${cbaVerdictAt}`);


/* ---- ENG-95543: the reference doc is LINT-CHECKED against the shared mapping table -------------------------
 * The ticket asks for the doc's classification rows to be generated from, or lint-checked against, the table.
 * Lint-checked, not generated: the rows carry build recipes, on-stand checks and a "Do NOT" column that no table
 * holds, and generating the file would delete exactly the part a human wrote. What the lint covers is the part
 * that CAN silently drift — a `crt.*` type that does not exist, and a table row nobody documented.
 */
{
  // Suffix classes the COMPONENT index cannot judge: requests and Angular services live in the CDN's
  // separate RequestRegistry, and a `*Handler` is platform-registered against a request, never placed on a page.
  const NON_COMPONENT_SUFFIX = /(?:Request|Service|Handler)$/;
  const docPath = "skills/classic-to-freedom-migration/references/classic-to-freedom-mapping.md";
  const doc = readFileSync(fileURLToPath(new URL("../../" + docPath, import.meta.url)), "utf8");
  const index = vendoredIndex();
  // Every `crt.X` the doc names must be a real component. This is the fabricated-type defect (ENG-95555) in its
  // DOC form: `crt.ContactCommunication` was written in prose long before anyone checked it against a stand, and
  // prose is what an agent reads when Node is unavailable.
  const allDocTypes = [...new Set((doc.match(/crt\.[A-Za-z][A-Za-z0-9]*/g) || []))];
  // A `crt.*Request` / `crt.*Service` / `crt.*Handler` is NOT a component: requests live in the CDN's separate
  // RequestRegistry (published for `latest` only, and it does not carry all of them — `crt.HandlerChainService` is
  // an Angular service, `crt.EntityStageProgressBarLoadDataRequest` a component-specific request), and a `*Handler`
  // is platform-registered against a request rather than placed on a page (`crt.ValidateDuplicatesOnSaveHandler`
  // on `crt.SaveDataRequest`). The component index cannot judge any of the three, so they are excluded here and
  // remain UNCHECKED — stated rather than silently folded in. The exclusion is kept honest below: a suffix-excluded
  // type that DOES appear in the index would mean the suffix is hiding a real component.
  const isComponentName = (t) => !NON_COMPONENT_SUFFIX.test(t);
  // A type the doc names as a COUNTER-EXAMPLE ("NOT `crt.ContactCommunication`") is not a claim that it exists —
  // it is the warning that it does not. Those are checked the other way round below.
  const counterExamples = new Set([...doc.matchAll(/NOT\s+`(crt\.[A-Za-z][A-Za-z0-9]*)`/g)].map((m) => m[1]));
  const docTypes = allDocTypes.filter((t) => isComponentName(t) && !counterExamples.has(t));
  const unknownDocTypes = docTypes.filter((t) => !index.components[t]);
  check(`ENG-95543 doc lint: every crt.* component type named in ${docPath} exists in the vendored component registry index`,
    docTypes.length >= 5 && unknownDocTypes.length === 0,
    () => ({ checked: docTypes.length, unknown: unknownDocTypes, excludedAsRequests: allDocTypes.filter((t) => !isComponentName(t)) }));
  // And the counter-examples must STAY counter-examples: a doc that warns "NOT crt.X" about a component the
  // registry really carries is telling the reader to avoid something valid.
  const wrongCounterExamples = [...counterExamples].filter((t) => index.components[t]);
  check("ENG-95543 doc lint: a type the doc names as a counter-example (\"NOT `crt.X`\") really is absent from the registry — otherwise the doc warns against a real component",
    counterExamples.size >= 1 && wrongCounterExamples.length === 0,
    () => ({ counterExamples: [...counterExamples], alsoRealComponents: wrongCounterExamples }));
  // Every feature / widget the TABLE carries must be NAMED in the doc's standard-features section. Direction
  // matters: table → doc catches a row added without documenting it, while doc → table would flag the many rows
  // that are deliberately doc-only (Print, Run process, section actions — no table row emits those).
  const section = doc.slice(doc.indexOf("## Standard features, widgets & actions"));
  // A widget's label may carry a parenthetical qualifier the prose does not repeat (`Feed (ESN)` is documented as
  // "Feed"), so the comparison is on the label without it. The NAME still has to appear — this trims a suffix, it
  // does not accept a near-match.
  // No regex: `\s*\(...\)\s*$` backtracks super-linearly (S8786), and the rule is simple enough to state
  // directly — drop a TRAILING parenthetical and trim.
  const bare = (n) => { const t = n.trim(); const i = t.lastIndexOf("("); return (i > 0 && t.endsWith(")") ? t.slice(0, i) : t).trim(); };
  const tableNames = [...new Set(MAPPING_ROWS.flatMap((r) => [r.meta?.feature, ...(r.meta?.widgets || []).map((w) => w.widget)]).filter(Boolean))];
  const undocumented = tableNames.filter((n) => !section.includes(n) && !section.includes(bare(n)));
  check("ENG-95543 doc lint: every standard feature / widget the table carries is named in the doc's standard-features section (a row added without documenting it fails here)",
    tableNames.length >= 8 && undocumented.length === 0,
    () => ({ names: tableNames, undocumented }));
  // A CODE-level audit, the counterpart of the doc lint: every `crt.*` COMPONENT type the engine's own modules
  // name must exist in the index. This is what catches a new control-table entry or a new row naming a type that
  // does not exist — the run-time check would only find it once some real page emitted it.
  //
  // Two exclusions, both stated: `crt.*Request` / `crt.*Service` are not components (see above), and `crt.Tab` is
  // an ACCEPTANCE spelling — `TAB_TYPES` carries it so `--verify` accepts a built page that still reports it,
  // measured on a live stand as a type no platform builds. The engine never EMITS it, and the golden suite asserts
  // that separately (a rich tabbed page emits `crt.TabContainer`).
  const engineSrc = ["mapper.mjs", "designspec.mjs", "migrate.mjs", "mapping-table.mjs", "mapping-registry.mjs"]
    .map((f) => readFileSync(fileURLToPath(new URL("../../skills/classic-to-freedom-migration/engine/" + f, import.meta.url)), "utf8")).join("\n");
  const ACCEPTANCE_ONLY = new Set(["crt.Tab"]);
  // The same counter-example rule the doc lint applies: a note saying "NOT `crt.X`" is a WARNING that the type does
  // not exist, and the engine's own notes carry one (`crt.ContactCommunication` — the `ContactCommunication` ENTITY
  // with a `crt.` prefix, which resolves to nothing on a stand). Exempt here, checked the other way round below.
  const codeCounterExamples = new Set([...engineSrc.matchAll(/NOT\s+`(crt\.[A-Za-z][A-Za-z0-9]*)`/g)].map((m) => m[1]));
  const engineTypes = [...new Set(engineSrc.match(/crt\.[A-Za-z][A-Za-z0-9]*/g) || [])]
    .filter((t) => !NON_COMPONENT_SUFFIX.test(t) && !ACCEPTANCE_ONLY.has(t) && !codeCounterExamples.has(t));
  const unknownEngineTypes = engineTypes.filter((t) => !index.components[t]);
  check("ENG-95543 code lint: every crt.* component type the engine's modules name exists in the vendored registry index (excluding requests/services/handlers and the crt.Tab acceptance spelling)",
    engineTypes.length >= 15 && unknownEngineTypes.length === 0,
    () => ({ checked: engineTypes.length, unknown: unknownEngineTypes }));
  // The acceptance-only exclusion has to stay HONEST: `crt.Tab` may be excluded because it does not exist, not as
  // a convenient way to hide a type. If the registry ever carries it, the exclusion is wrong.
  check("ENG-95543 code lint: a type the engine's notes name as a counter-example is really absent from the registry — the exemption cannot hide a valid component",
    codeCounterExamples.size >= 1 && [...codeCounterExamples].every((t) => !index.components[t]),
    () => [...codeCounterExamples].filter((t) => index.components[t]));
  check("ENG-95543 code lint: the `crt.Tab` exclusion is justified — it really is absent from the registry, so excluding it is not a way of hiding a real type",
    !index.components["crt.Tab"],
    () => Object.keys(index.components).filter((t) => t.startsWith("crt.Tab")));

  // The sync note must point at the file that actually HOLDS the data. It pointed at mapper.mjs and its four
  // catalogs after they moved — a stale pointer sends the next reader to the wrong file to make the paired edit,
  // which is how the "change both in the same commit" rule quietly stops being followed.
  check("ENG-95543 doc lint: the sync note names the shared mapping table, not the catalogs that no longer live in mapper.mjs",
    /mapping-table\.mjs/.test(section) && !/mapper\.mjs` \(`FEATURE_CATALOG`/.test(section),
    () => section.split("\n").filter((l) => l.startsWith(">")).join(" | ").slice(0, 400));
}

console.log(`\n=================\nINFRA GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
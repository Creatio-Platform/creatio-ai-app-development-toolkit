// Offline unit tests for the hand-rolled infra parsers that otherwise run ONLY inside live-network / real-tree
// CI jobs (Alexandr review): the ustar reader + integrity check in verify-vendor-upstream.mjs, and the
// glob→regex matcher in scripts/check-sonar-exclusions.mjs. These give a deterministic, network-free way to
// tell "my parser is wrong" from "npm is unreachable" / "the glob is stale". Zero dependencies (node built-ins).
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { readTarEntry, integrityOk, sha256Lf } from "../../skills/classic-to-freedom-migration/engine/verify-vendor-upstream.mjs";
import { checkVendorIntegrity } from "../../skills/classic-to-freedom-migration/engine/verify-vendor.mjs";
import { parseSchema } from "../../skills/classic-to-freedom-migration/engine/engine.mjs";
import { toRegex, baseDir } from "../../scripts/check-sonar-exclusions.mjs";

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

console.log(`\n=================\nINFRA GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

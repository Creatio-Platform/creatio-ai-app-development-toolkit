#!/usr/bin/env node
// Supply-chain integrity gate for the engine's vendored third-party code.
//
// `parseSchema` runs UNTRUSTED classic schema-body through the bundled acorn parser (vendor/acorn.mjs) —
// the one executable component standing between a hostile stand input and the engine. A vendored bundle
// gets no automatic security patching AND no automatic tamper detection: a swapped or silently-drifted
// parser would execute unnoticed. This script pins each vendored file to a known-good SHA-256 recorded
// in vendor/provenance.json and FAILS (exit 1) on any mismatch. Zero dependencies (node:crypto/fs/path) —
// runs anywhere the engine does, on Linux (LF) and Windows (CRLF) alike.
//
// THREAT MODEL (be honest about what this does and does NOT prove). The pin lives in the SAME repo/commit as
// the file it pins, so this is tamper-EVIDENCE within the repo, not authenticity against upstream npm: it
// catches an ACCIDENTAL swap/drift (a rebuild picked up a different acorn, a botched edit) and a change to the
// file WITHOUT a matching provenance bump — but NOT a determined attacker who edits both the file and the pin
// in one commit. To also assert authenticity, a CI step must independently fetch `acorn@<pinned version>` from
// npm and compare its LF-normalized hash to provenance.json (not done here — this script only checks the repo
// against its own recorded pin). The provenance version field records which upstream release the pin claims.
//
// The pin is over LF-NORMALIZED bytes so it equals the upstream npm artifact's hash and is immune to
// line-ending churn between platforms/checkouts — a CRLF checkout verifies identically to an LF one.
import { readFileSync, realpathSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

// Vendor dir defaults to the one co-located with this script. The optional argv[2] override is a TEST-ONLY hook
// (the negative goldens point the SAME integrity check at a tampered fixture). The CLI-controlled path is
// VALIDATED before use: honored ONLY when it canonicalizes under the OS temp dir — otherwise ignored and the
// real co-located vendor is used. This keeps the tests working while closing the path-traversal surface (S8707).
const DEFAULT_VENDOR = path.join(path.dirname(fileURLToPath(import.meta.url)), "vendor");
// Resolve BOTH sides through the real filesystem before the containment check: path.resolve does NOT follow
// symlinks, and on macOS os.tmpdir() (/var/folders/…) is a symlink to /private/var/folders/…. A caller that
// builds its override via fs.realpathSync/mkdtemp (landing under /private/…) would then fail the prefix check
// and silently fall back to the REAL vendor dir — so a negative tamper-detection golden would pass VACUOUSLY
// against the genuine files. realpathSync needs the path to exist; fall back to the resolved path if it doesn't.
const realpathSafe = (p) => { try { return realpathSync(p); } catch { return path.resolve(p); } };
const overrideArg = process.argv[2] ? realpathSafe(process.argv[2]) : null;
const tmpReal = realpathSafe(os.tmpdir());
const tmpRoot = tmpReal + path.sep;
const VENDOR_DIR = overrideArg && (overrideArg === tmpReal || overrideArg.startsWith(tmpRoot)) ? overrideArg : DEFAULT_VENDOR;
const MANIFEST = path.join(VENDOR_DIR, "provenance.json");

const sha256Lf = (buf) =>
  createHash("sha256").update(Buffer.from(buf.toString("utf8").replaceAll("\r\n", "\n"), "utf8")).digest("hex");

// PURE integrity check over a given vendor dir — no console, no process.exit — so it can gate at RUNTIME
// (engine.mjs calls it before parsing untrusted input) AND back the CLI + goldens. Returns:
//   { ok: bool, failures: string[], results: [{ name, ok, package?, version?, sha256?/expected?/actual?, error? }] }
export function checkVendorIntegrity(vendorDir) {
  const manifestPath = path.join(vendorDir, "provenance.json");
  const results = [], failures = [];
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return { ok: false, failures: [`cannot read ${manifestPath}: ${e.message}`], results };
  }
  const files = manifest.files || {};
  const names = Object.keys(files);
  if (names.length === 0) return { ok: false, failures: ["provenance.json lists no files — nothing pinned"], results };
  for (const name of names) {
    const pin = files[name];
    const file = path.join(vendorDir, name);
    let actual;
    try {
      actual = sha256Lf(readFileSync(file));
    } catch (e) {
      const msg = `${name}: cannot read (${e.message})`;
      failures.push(msg); results.push({ name, ok: false, error: msg });
      continue;
    }
    if (actual === pin.sha256) {
      results.push({ name, ok: true, package: pin.package, version: pin.version, sha256: actual });
    } else {
      const msg = `${name}: SHA-256 MISMATCH — vendored file does not match its pinned ${pin.package}@${pin.version} provenance (expected ${pin.sha256}, actual ${actual})`;
      failures.push(msg); results.push({ name, ok: false, package: pin.package, version: pin.version, expected: pin.sha256, actual });
    }
  }
  // DENY-UNKNOWN for executable modules: any `.cjs`/`.mjs`/`.js` present in vendor/ that is NOT pinned could be
  // loaded transitively (e.g. by acorn.cjs) and would bypass the hash gate entirely. Fail closed on it. Today
  // acorn.cjs is a self-contained bundle and the only pinned module, so this is future-proofing — a new unpinned
  // executable sibling is a hard failure, not a silent bypass. (Inert assets like the LICENSE are not enumerated.)
  // Walked RECURSIVELY: a nested `vendor/sub/evil.js` is equally loadable, so it must fail closed too, not only the
  // flat top level. Pins are flat basenames, so any executable at depth > 0 (relPath !== basename) can never match a
  // pin and is denied by construction.
  try {
    const pinned = new Set(names);
    const walk = (dir, rel) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const relPath = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) { walk(path.join(dir, ent.name), relPath); continue; }
        if (/\.(cjs|mjs|js)$/.test(ent.name) && !pinned.has(relPath)) {
          const msg = `${relPath}: unpinned executable module present in vendor/ (at any depth) — every .cjs/.mjs/.js must be pinned in provenance.json (deny-unknown); pin it or remove it`;
          failures.push(msg); results.push({ name: relPath, ok: false, error: msg });
        }
      }
    };
    walk(vendorDir, "");
  } catch { /* vendor dir unreadable → the pinned-file loop above already recorded the read failures */ }
  return { ok: failures.length === 0, failures, results };
}

// CLI wrapper — prints the human report and returns an exit code. Runs ONLY when this file is invoked directly
// (see the import.meta.url guard below); importing the module for `checkVendorIntegrity` must NOT run it.
function main() {
  const r = checkVendorIntegrity(VENDOR_DIR);
  for (const res of r.results) if (res.ok) console.log(`  ✓ ${res.name}  ${res.package}@${res.version}  sha256 ${res.sha256.slice(0, 16)}…`);
  if (!r.ok) {
    for (const f of r.failures) console.error(`  ✗ ${f}`); // failure strings carry the diagnostic ('cannot read' / 'nothing pinned' / 'SHA-256 MISMATCH')
    console.error(`\nverify-vendor: integrity check FAILED — ${r.failures.length} problem(s). If a change is intentional, re-vendor from the pinned upstream artifact and update vendor/provenance.json.`);
    return 1;
  }
  console.log(`verify-vendor: ${r.results.length} vendored file(s) verified`);
  return 0;
}

// Guarded so importing this module (engine.mjs) does NOT execute the CLI / exit the process.
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) process.exit(main());

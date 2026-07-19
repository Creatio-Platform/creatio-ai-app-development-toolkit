#!/usr/bin/env node
// Supply-chain integrity gate for the engine's vendored third-party code.
//
// `parseSchema` runs UNTRUSTED classic schema-body through the bundled acorn parser (vendor/acorn.mjs) —
// the one executable component standing between a hostile stand input and the engine. A vendored bundle
// gets no automatic security patching AND no automatic tamper detection: a swapped or silently-drifted
// parser would execute unnoticed. This script pins each vendored file to a known-good SHA-256 recorded
// in vendor/provenance.json and FAILS (exit 1) on any mismatch, so CI blocks a build whose parser does
// not match its declared upstream provenance. Zero dependencies (node:crypto/fs/path) — runs anywhere the
// engine does, on Linux (LF) and Windows (CRLF) alike.
//
// The pin is over LF-NORMALIZED bytes so it equals the upstream npm artifact's hash and is immune to
// line-ending churn between platforms/checkouts — a CRLF checkout verifies identically to an LF one.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Vendor dir defaults to the one co-located with this script. An optional argv[2] override lets the goldens
// point the SAME integrity check at a tampered fixture (negative-path coverage) without touching the real bundle.
const VENDOR_DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(path.dirname(fileURLToPath(import.meta.url)), "vendor");
const MANIFEST = path.join(VENDOR_DIR, "provenance.json");

const sha256Lf = (buf) =>
  createHash("sha256").update(Buffer.from(buf.toString("utf8").replaceAll("\r\n", "\n"), "utf8")).digest("hex");

function main() {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
  } catch (e) {
    console.error(`verify-vendor: cannot read ${MANIFEST}: ${e.message}`);
    return 1;
  }
  const files = manifest.files || {};
  const names = Object.keys(files);
  if (names.length === 0) {
    console.error("verify-vendor: provenance.json lists no files — nothing pinned");
    return 1;
  }
  let failed = 0;
  for (const name of names) {
    const pin = files[name];
    const file = path.join(VENDOR_DIR, name);
    let actual;
    try {
      actual = sha256Lf(readFileSync(file));
    } catch (e) {
      console.error(`  ✗ ${name}: cannot read (${e.message})`);
      failed++;
      continue;
    }
    if (actual === pin.sha256) {
      console.log(`  ✓ ${name}  ${pin.package}@${pin.version}  sha256 ${actual.slice(0, 16)}…`);
    } else {
      console.error(`  ✗ ${name}: SHA-256 MISMATCH — vendored file does not match its pinned ${pin.package}@${pin.version} provenance`);
      console.error(`      expected ${pin.sha256}`);
      console.error(`      actual   ${actual}`);
      console.error(`      If this change is intentional, re-vendor from the pinned upstream artifact and update vendor/provenance.json.`);
      failed++;
    }
  }
  if (failed) {
    console.error(`\nverify-vendor: ${failed} of ${names.length} vendored file(s) FAILED integrity check`);
    return 1;
  }
  console.log(`verify-vendor: ${names.length} vendored file(s) verified`);
  return 0;
}

process.exit(main());

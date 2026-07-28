#!/usr/bin/env node
// Compensating control (Minor 2, PR #50): the vendored acorn parser is excluded from SonarCloud
// (Security Hotspots) and is NOT tracked in package.json/lockfile, so it is outside SCA tooling
// (Dependabot) too. verify-vendor.mjs pins its SHA-256 — that guards silent DRIFT, but not a CVE
// disclosed against the pinned VERSION. This queries OSV (https://osv.dev) for each pinned vendored
// package@version so such a CVE is surfaced by a scheduled run.
//
// Reads the pins from vendor/provenance.json; skips cleanly when it is absent (forward-provisioned
// before the engine PR lands). Network / OSV errors are a WARNING, not a failure — a compensating
// control must not go flaky on a transient outage. Exit 1 ONLY on a positively-reported vulnerability.
import { readFileSync, existsSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prov = path.join(root, "skills/classic-to-freedom-migration/engine/vendor/provenance.json");
if (!existsSync(prov)) {
  console.log("audit-vendored-acorn: no vendor/provenance.json present — nothing pinned yet; skip.");
  process.exit(0);
}

const files = JSON.parse(readFileSync(prov, "utf8")).files || {};
const pins = [...new Map(
  Object.values(files).filter((p) => p?.package && p?.version).map((p) => [`${p.package}@${p.version}`, p]),
).values()];
if (!pins.length) {
  console.log("audit-vendored-acorn: provenance.json pins no package@version; skip.");
  process.exit(0);
}

let vulns = 0, queryFailures = 0;
for (const pin of pins) {
  const body = JSON.stringify({ package: { ecosystem: "npm", name: pin.package }, version: pin.version });
  let data;
  try {
    const r = await fetch("https://api.osv.dev/v1/query", { method: "POST", headers: { "content-type": "application/json" }, body });
    if (!r.ok) { console.warn(`  ⚠ ${pin.package}@${pin.version}: OSV HTTP ${r.status} — NOT CHECKED`); queryFailures++; continue; }
    data = await r.json();
  } catch (e) {
    console.warn(`  ⚠ ${pin.package}@${pin.version}: OSV query failed (${e.message}) — NOT CHECKED`);
    queryFailures++;
    continue;
  }
  const found = data.vulns || [];
  if (found.length) {
    vulns += found.length;
    console.error(`  ✗ ${pin.package}@${pin.version}: ${found.length} known vuln(s): ${found.map((v) => v.id).join(", ")}`);
  } else {
    console.log(`  ✓ ${pin.package}@${pin.version}: no known OSV vulnerabilities`);
  }
}
if (vulns) {
  console.error(`\naudit-vendored-acorn: ${vulns} vulnerability(ies) against the pinned vendored version(s) — re-vendor to a fixed release and update vendor/provenance.json.`);
  process.exit(1);
}
// Observability: a run where some pins could NOT be queried (OSV outage / DNS block / rate-limit) is NOT the
// same as a confirmed-clean run — it must be visibly distinguishable so a persistently-unreachable endpoint
// can't silently mask "acorn was never actually checked" for weeks. We keep exit 0 (a weekly compensating
// control must not go red on a transient network blip), but surface a LOUD, un-missable signal: a GitHub
// Actions `::warning::` annotation + a step-summary line (both no-ops outside CI).
if (queryFailures) {
  const msg = `audit-vendored-acorn: ${queryFailures} of ${pins.length} pin(s) NOT CHECKED (OSV query failed) — this run did NOT confirm the vendored parser is vuln-free; re-run.`;
  console.warn(`::warning title=Vendored acorn NOT audited::${msg}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `⚠️ ${msg}\n`); } catch { /* summary is best-effort */ }
  }
  console.warn(`\n${msg}`);
  process.exit(0);
}
console.log(`audit-vendored-acorn: OK — all ${pins.length} pin(s) checked, no known vulnerabilities.`);

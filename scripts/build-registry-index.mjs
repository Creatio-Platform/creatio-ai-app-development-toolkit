#!/usr/bin/env node
// Build the engine's VENDORED COMPONENT INDEX from the CDN component registries.
//
// WHY a vendored index exists at all. The migration engine (`migrate.mjs`) is a plain Node CLI: it has no MCP
// client and no network, so it cannot call clio's `get-component-info`, and CI has no stand to ask — yet the
// mapping table's every `componentType` and every `propMap` key has to be checked against the real component
// contract on every PR. So the check reads a file: this index in the repo (offline, deterministic), which a real
// migration run can OVERRIDE with the target stand's own registry export.
//
// WHY it is an INDEX and not the registries themselves. The full per-version registries are 410-648 KB each
// (~2.5 MB for the seven versions) and roughly 80% of that is prose `description` text this check never reads.
// The index keeps the parts a check can act on — which components exist IN WHICH VERSIONS, their input and output
// names, each input's type/values/default/deprecation — and drops the prose.
//
// WHY THE PER-VERSION RECORD matters more than any single snapshot. The registry carries 152 components at 8.3.0 and
// 200 at `latest`: validating a mapping row against `latest` alone green-lights a target that does not exist on
// an 8.3 stand and fails to render there. So every component and every input records WHICH versions it appears in,
// and the validator can answer "exists, but not on the version you are migrating to".
//
// SOURCE. `--src <dir>` is a checkout of the CDN static-files repo — a directory of `<version>/ComponentRegistry.json`
// files (`8.3.0`, …, `latest`). It is deliberately NOT hardcoded to anyone's home directory, and it is NOT needed to
// run the engine or the suites: only to REGENERATE the index when the registries move.
//
//   node scripts/build-registry-index.mjs --src ~/Projects/static-files-mcp
//
// VERSION ENCODING. A component or input records its versions as a BITMASK over `meta.versions` (`v: 127` = all
// seven), not as an array of strings: with ~1600 inputs the string arrays cost 462 KB against 218 KB for the
// masks, for the same information (measured, both over the same seven registries). `meta.versions` is the only place a version name is spelled out.
//
// The `meta` block records which source files were read and their SHA-256, so a regenerated index states what it
// came from. That is provenance, not tamper-proofing: this file is DATA the engine reads, never code it executes,
// so it does not carry the executable-vendor threat model that `verify-vendor.mjs` addresses for the parser.
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skills", "classic-to-freedom-migration",
  "engine", "registry", "component-index.json");
// The taxonomy fields, carried verbatim when a component publishes them. Only 8 of 200 components do, which is
// why a Tier-C ranking cannot rest on them alone — the index records what exists rather than implying coverage.
const TAXONOMY = ["category", "synonyms", "useCases", "whenToUse", "whenNotToUse", "appliesToCustomEntities", "entityCouplingNote"];
// Per-input metadata a check can act on. `description` is deliberately excluded (prose, ~80% of the bytes).
const INPUT_META = ["type", "values", "default", "deprecated", "deprecationReason"];

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

// Version directories, oldest first with `latest` last. The order IS the bitmask's bit order, so it must be stable:
// re-ordering it would silently re-interpret every mask already written.
function versionDirs(src) {
  const dirs = readdirSync(src).filter((d) => {
    try { return statSync(path.join(src, d, "ComponentRegistry.json")).isFile(); } catch { return false; }
  });
  const semver = dirs.filter((d) => /^\d+\.\d+\.\d+$/.test(d)).sort((a, b) => {
    const [A, B] = [a.split(".").map(Number), b.split(".").map(Number)];
    return A[0] - B[0] || A[1] - B[1] || A[2] - B[2];
  });
  return [...semver, ...dirs.filter((d) => d === "latest")];
}

const src = argValue("--src");
if (!src) {
  console.error("usage: build-registry-index.mjs --src <dir containing <version>/ComponentRegistry.json>");
  process.exit(1);
}
const versions = versionDirs(src);
if (!versions.length) {
  console.error(`no <version>/ComponentRegistry.json found under ${src}`);
  process.exit(1);
}

const components = new Map();   // componentType -> { mask, compositeOnly, inputs:{}, outputs:{}, taxonomy }
const baseInputs = new Map();   // name -> metadata (union over versions)
const sources = [];

for (const [vi, v] of versions.entries()) {
  const bit = 1 << vi;
  const file = path.join(src, v, "ComponentRegistry.json");
  const raw = readFileSync(file);
  sources.push({ version: v, sha256: createHash("sha256").update(raw).digest("hex"), bytes: raw.length });
  const reg = JSON.parse(raw.toString("utf8"));
  // Base inputs carry the SAME per-version bitmask component inputs do. Without one they were a union across every
  // registry read, and `validateRow` had nothing to test a target version against — so a base input introduced in a
  // newer platform would validate clean at the oldest indexed version, which is the "`latest` is a superset" trap
  // this whole index exists to close. Metadata follows the same last-version-wins rule as a component's own inputs.
  for (const [name, meta] of Object.entries(reg.references?.baseInputs || {})) {
    const cur = baseInputs.get(name) || { v: 0 };
    Object.assign(cur, pick(meta, INPUT_META), { v: cur.v | bit });
    baseInputs.set(name, cur);
  }
  for (const c of reg.components || []) {
    const entry = components.get(c.componentType)
      || { mask: 0, compositeOnly: false, inputs: {}, outputs: {}, taxonomy: {} };
    entry.mask |= bit;
    if (c.compositeOnly) entry.compositeOnly = true;
    for (const [k, meta] of Object.entries(c.inputs || {})) {
      const cur = entry.inputs[k] || { v: 0 };
      // The LAST version that declares the input wins on metadata: the newest contract is the one a migration
      // targets, and the mask still says where the input was absent.
      Object.assign(cur, pick(meta, INPUT_META), { v: cur.v | bit });
      entry.inputs[k] = cur;
    }
    for (const k of Object.keys(c.outputs || {})) entry.outputs[k] = { v: (entry.outputs[k]?.v || 0) | bit };
    for (const t of TAXONOMY) if (c[t] !== undefined) entry.taxonomy[t] = c[t];
    components.set(c.componentType, entry);
  }
}

function pick(o, keys) {
  const out = {};
  if (!o || typeof o !== "object") return out;
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

// Sorted keys throughout: the file is committed, so two runs over the same sources must produce byte-identical
// output or every regeneration lands as an unreviewable diff.
const sortedObject = (obj) => Object.fromEntries(Object.keys(obj).sort((a, b) => a.localeCompare(b)).map((k) => [k, obj[k]]));
const index = {
  meta: {
    versions,
    sources,
    componentCount: components.size,
    taxonomyCount: [...components.values()].filter((c) => Object.keys(c.taxonomy).length > 0).length,
    generator: "scripts/build-registry-index.mjs",
    note: "Generated from the CDN component registries. Do not hand-edit: regenerate with --src <static-files checkout>.",
  },
  baseInputs: sortedObject(Object.fromEntries(baseInputs)),
  components: sortedObject(Object.fromEntries([...components.entries()].map(([k, v]) => [k, {
    v: v.mask, compositeOnly: v.compositeOnly, taxonomy: v.taxonomy,
    inputs: sortedObject(v.inputs), outputs: sortedObject(v.outputs),
  }]))),
};
writeFileSync(OUT, JSON.stringify(index, null, 1) + "\n");
console.log(`wrote ${OUT}`);
console.log(`  versions: ${versions.join(", ")}`);
console.log(`  components: ${components.size} (with selection taxonomy: ${index.meta.taxonomyCount})`);
console.log(`  bytes: ${statSync(OUT).size}`);

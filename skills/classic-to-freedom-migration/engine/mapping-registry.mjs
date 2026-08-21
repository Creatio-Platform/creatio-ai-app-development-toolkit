// REGISTRY VALIDATION of the shared mapping table.
//
// Every `crt.*` type the engine emits used to be confirmed by hand on a stand ("read get-component-info for its
// contract"), which is a per-run human step that a mapping row cannot carry. This module turns most of it into a
// machine check: a row's `componentType` must exist, its `propMap` keys must be real `inputs`, and its `events`
// must be real `outputs` — of the platform version the migration actually targets.
//
// WHAT IT CHECKS AND WHAT IT CANNOT. The registry has no `required` flag on a component's own inputs, no
// deprecation flag at COMPONENT level, and no package field: so "fill the required props", "flag a deprecated
// target" and "replace the hardcoded package knowledge" cannot be driven from it as the proposal assumed.
// What IS there, and is checked here: existence per version, input and output names, per-INPUT deprecation
// (`deprecated` + `deprecationReason`, 13 inputs at `latest`), `compositeOnly`, and the selection taxonomy — on
// 8 of 205 components, which is why a taxonomy-based ranking is an aid, never a claim of coverage.
//
// SCOPE. Only keys the TABLE declares are validated. The engine also emits framework-level props no component
// declares (`type`, `layoutConfig`, `visible`) — validating emitted `values` instead of declared keys would report
// those three as unknown on every row, and the natural reaction to a check that cries wolf is to switch it off.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAPPING_ROWS, SOURCE } from "./mapping-table.mjs";

const INDEX_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "registry", "component-index.json");

let vendored = null;
// The index vendored in the repo. Read once, lazily: the suites and every `migrate.mjs` mode load this module, but
// only a validation run needs the 218 KB parsed.
export function vendoredIndex() {
  vendored ??= JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  return vendored;
}

// A component's / input's version set, decoded from its bitmask over `meta.versions`.
export function versionsOf(mask, index) {
  const names = index?.meta?.versions || [];
  return names.filter((_, i) => (mask & (1 << i)) !== 0);
}

// Does `version` name a version this index actually carries? A caller asking about a version the index never saw
// gets `null` (unknown), never `false` (absent) — the two are different answers and only one of them is a defect.
function versionBit(version, index) {
  const i = (index?.meta?.versions || []).indexOf(version);
  return i < 0 ? null : 1 << i;
}

// A row is worth validating when it names a `crt.*` type at all — as the thing the engine EMITS (`target`) or as
// the thing the `--verify` gate looks for on the built page (`verify`). The second half matters as much as the
// first: a standard-feature row emits nothing itself, but a wrong gate type there is how a page gets judged
// against a component that does not exist (`crt.ContactCommunication` — the defect ENG-95555 catalogues by hand).
const namedType = (row) => row?.target?.componentType || row?.verify?.componentType || null;
const isEmitter = (row) => !!namedType(row) || !!row?.target?.foldInto;

// Validate ONE row against the index. `version` is optional: with it, existence is judged on that version;
// without it, on the union of every version the index carries — and the caller is told which, because a union
// check is exactly the "`latest` is a superset" trap that green-lights a target an 8.3 stand cannot render.
export function validateRow(row, { index = vendoredIndex(), version = null } = {}) {
  const findings = [];
  if (!isEmitter(row)) return findings;                       // a tier-C row names no target on purpose
  const where = `${row.match.by}=${row.match[row.match.by]}`;
  const bit = version ? versionBit(version, index) : null;
  const add = (kind, detail) => findings.push({ kind, row: where, ...detail });
  // A FOLDED row (a menu item) contributes props to the element that owns it; it has no componentType of its own,
  // so there is nothing here to resolve. Its keys are validated on the owner's component by that owner's row.
  const ctype = namedType(row);
  if (!ctype) return findings;
  const c = index.components?.[ctype];
  if (!c) { add("unknown-component", { componentType: ctype }); return findings; }
  if (version && bit === null) add("unknown-version", { componentType: ctype, version });
  else if (bit !== null && (c.v & bit) === 0)
    add("component-absent-in-version", { componentType: ctype, version, presentIn: versionsOf(c.v, index) });
  // The prop's contract, from the component's OWN inputs or from the shared base inputs. Both carry a version
  // mask, so a base input is version-checked exactly like a component input — resolving it without that test was
  // how a base input introduced in a newer platform validated clean at the oldest indexed version.
  const inputMeta = (k) => c.inputs?.[k] || index.baseInputs?.[k] || null;
  for (const [prop, spec] of Object.entries(row.target?.propMap || {})) {
    const meta = inputMeta(prop);
    if (!meta) { add("unknown-input", { componentType: ctype, prop }); continue; }
    // `meta.v == null` = an index generated before base inputs carried masks: it states no version membership, so
    // there is nothing to test. Skipped rather than reported — an absent record is not evidence of absence.
    if (meta.v != null && bit !== null && (meta.v & bit) === 0)
      add("input-absent-in-version", { componentType: ctype, prop, version, presentIn: versionsOf(meta.v, index) });
    // Per-INPUT deprecation is the only deprecation signal the registry carries. Advisory, not an error: a
    // deprecated input still works, and the row's author has to decide with the reason in front of them.
    if (meta?.deprecated) add("deprecated-input", { componentType: ctype, prop, reason: meta.deprecationReason || null });
    if (spec?.from === SOURCE.LITERAL && meta?.values && !meta.values.includes(spec.value))
      add("literal-not-in-values", { componentType: ctype, prop, value: spec.value, allowed: meta.values });
  }
  for (const ev of Object.keys(row.target?.events || {})) {
    const meta = c.outputs?.[ev];
    if (!meta) { add("unknown-output", { componentType: ctype, event: ev }); continue; }
    if (bit !== null && (meta.v & bit) === 0)
      add("output-absent-in-version", { componentType: ctype, event: ev, version, presentIn: versionsOf(meta.v, index) });
  }
  // `compositeOnly` is NOT a finding. It means the component has no Designer TOOLBAR entry; inserting it into a
  // page schema directly — which is what this engine emits — is valid. Reported as INFO so a row's note can say so
  // without a reader mistaking the flag for an error.
  if (c.compositeOnly) add("composite-only", { componentType: ctype });
  return findings;
}

// Severity, kept in ONE place so the CI check, a run-time gate and a reader cannot disagree about what blocks.
const ADVISORY = new Set(["deprecated-input", "composite-only"]);
export const isAdvisory = (f) => ADVISORY.has(f.kind);

// Validate the whole table. `errors` are the findings that must fail a build; `advisories` are recorded and do not.
export function validateTable({ rows = MAPPING_ROWS, index = vendoredIndex(), version = null } = {}) {
  const findings = rows.flatMap((r) => validateRow(r, { index, version }));
  return {
    version, indexVersions: index?.meta?.versions || [],
    errors: findings.filter((f) => !isAdvisory(f)),
    advisories: findings.filter(isAdvisory),
  };
}

// Ranked alternatives for a decision that has no derivable target. The registry's selection taxonomy
// (`synonyms` / `useCases` / `whenToUse`) exists on 8 of 205 components, so a taxonomy-only ranking would answer
// for 4% of the catalog and stay silent for the rest. Components WITHOUT taxonomy are therefore ranked by their
// componentType text, and every candidate says which evidence put it there — a name match is a weaker reason than
// a published `whenToUse`, and a reader must be able to tell them apart rather than see one undifferentiated list.
export function rankCandidates(terms, { index = vendoredIndex(), version = null, limit = 5 } = {}) {
  const bit = version ? versionBit(version, index) : null;
  const needles = (Array.isArray(terms) ? terms : [terms]).filter(Boolean).map((t) => String(t).toLowerCase());
  const out = [];
  for (const [ctype, c] of Object.entries(index.components || {})) {
    if (bit !== null && (c.v & bit) === 0) continue;              // not on the target version — not a candidate
    const tax = c.taxonomy || {};
    const taxText = [tax.synonyms, tax.useCases, tax.whenToUse].flat().filter((x) => typeof x === "string").join(" ").toLowerCase();
    const nameText = ctype.toLowerCase();
    let score = 0; const why = [];
    for (const n of needles) {
      if (taxText.includes(n)) { score += 3; why.push(`taxonomy mentions "${n}"`); }
      else if (nameText.includes(n)) { score += 1; why.push(`type name contains "${n}"`); }
    }
    if (score > 0) out.push({ componentType: ctype, score, evidence: why, hasTaxonomy: Object.keys(tax).length > 0 });
  }
  return out.sort((a, b) => b.score - a.score || a.componentType.localeCompare(b.componentType)).slice(0, limit);
}

// ---- THE RUN-TIME REGISTRY: the stand's own answer, when there is one --------------------------------------
// The vendored index is the offline fallback and the CI check's subject. A real migration can do better: the target
// stand's registry, exported for ITS platform version. This is the half that makes the feature reachable on a real
// run instead of waiting on a clio-side change — the failure mode ENG-95412's change 7 shipped with.
//
// The channel is the MANIFEST, like `enumVocabulary`: manifests are how stand-derived facts already reach the
// engine, and `get-classic-page-sources` is what writes them. `manifest.componentRegistry` is either the export
// itself or `{ "file": "<path>" }` — a path, because the export is 400-650 KB and has no business passing through
// an agent's context.
export function indexFromRegistryExport(json, { version = null } = {}) {
  const v = version || json?.resolvedTargetVersion || json?.version || "stand";
  const components = {};
  for (const c of json?.components || []) {
    components[c.componentType] = {
      v: 1, compositeOnly: !!c.compositeOnly,
      inputs: Object.fromEntries(Object.entries(c.inputs || {}).map(([k, m]) => [k, { v: 1, ...pickMeta(m) }])),
      outputs: Object.fromEntries(Object.keys(c.outputs || {}).map((k) => [k, { v: 1 }])),
      taxonomy: {},
    };
  }
  return {
    meta: { versions: [v], sources: [{ version: v, from: "registry-export" }], componentCount: Object.keys(components).length },
    baseInputs: Object.fromEntries(Object.entries(json?.references?.baseInputs || {}).map(([k, m]) => [k, { v: 1, ...pickMeta(m) }])),
    components,
  };
}
const pickMeta = (m) => {
  const out = {};
  if (!m || typeof m !== "object") return out;
  for (const k of ["type", "values", "default", "deprecated", "deprecationReason"]) if (m[k] !== undefined) out[k] = m[k];
  return out;
};

// Which registry a RUN validates against, and what that choice does NOT prove. Three outcomes, deliberately
// distinguished — "checked against the stand", "checked against a pinned version", and "checked against a union of
// versions" are three different strengths of evidence and a reader must be told which one they have.
export function resolveRunIndex(manifest, { readFile = null } = {}) {
  const src = manifest?.componentRegistry;
  if (src && typeof src === "object") {
    if (Array.isArray(src.components)) {
      const index = indexFromRegistryExport(src, { version: manifest.platformVersion || null });
      return { index, version: index.meta.versions[0], source: "stand-export" };
    }
    if (typeof src.file === "string" && readFile) {
      try {
        const index = indexFromRegistryExport(JSON.parse(readFile(src.file)), { version: manifest.platformVersion || null });
        return { index, version: index.meta.versions[0], source: "stand-export" };
      } catch (e) {
        // A registry the manifest NAMED but the engine could not read is reported, never silently downgraded to the
        // vendored index: the operator asked for the stand's answer and has to know they did not get it.
        return { index: vendoredIndex(), version: null, source: "unreadable-export", error: e.message, file: src.file };
      }
    }
  }
  const idx = vendoredIndex();
  const pinned = manifest?.platformVersion && idx.meta.versions.includes(manifest.platformVersion) ? manifest.platformVersion : null;
  return { index: idx, version: pinned, source: pinned ? "vendored-pinned" : "vendored-union" };
}

// The `crt.*` types THIS RUN actually emits or gates on — not the whole table. Validating every row on every run
// would report rows the run never touches, and a check that reports things the reader cannot act on is a check they
// learn to skip.
export function runTypes(changeSet) {
  const out = new Map();   // componentType -> what named it
  const add = (t, why) => { if (typeof t === "string" && t.startsWith("crt.") && !out.has(t)) out.set(t, why); };
  for (const el of changeSet?.tableElements || []) add(el.componentType, `emitted for classic ${el.classicKind} '${el.classic}'`);
  for (const op of changeSet?.viewConfigDiff || []) add(op?.values?.type, `emitted as '${op.name}'`);
  for (const f of changeSet?.standardFeatures || []) add(featureTypeOf(f), `the ${f.feature} feature's gate type`);
  for (const c of changeSet?.profileCards || []) add(c?.type, `the ${c?.entity || "embedded"} profile card`);
  return out;
}
// A standard feature's gate type, read from the shared table by the feature's own name (the ONE source designspec's
// gate reads too), never from the ChangeSet entry — a feature row carries prose, not a type.
function featureTypeOf(f) {
  const name = f?.feature || f?.caption || "";
  const r = MAPPING_ROWS.find((x) => x.meta?.feature === name && x.verify?.componentType);
  return r?.verify.componentType || null;
}

// Validate what a run emits against the registry it resolved. Returns findings in the same shape `validateRow`
// uses, so one severity rule covers both the CI check and a real run.
export function validateRun(changeSet, { index = vendoredIndex(), version = null } = {}) {
  const findings = [];
  const bitCount = (index?.meta?.versions || []).length;
  for (const [ctype, why] of runTypes(changeSet)) {
    const c = index.components?.[ctype];
    if (!c) { findings.push({ kind: "unknown-component", componentType: ctype, why }); continue; }
    const i = version ? (index.meta.versions || []).indexOf(version) : -1;
    if (i >= 0 && (c.v & (1 << i)) === 0)
      findings.push({ kind: "component-absent-in-version", componentType: ctype, version, why, presentIn: versionsOf(c.v, index) });
    if (c.compositeOnly) findings.push({ kind: "composite-only", componentType: ctype, why });
  }
  return { findings: findings.filter((f) => !isAdvisory(f)), advisories: findings.filter(isAdvisory), checkedVersions: bitCount };
}

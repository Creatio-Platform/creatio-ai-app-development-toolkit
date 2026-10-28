// REGISTRY VALIDATION of the shared mapping table.
//
// Every `crt.*` type the engine emits would otherwise be confirmed by hand on a stand ("read get-component-info for its
// contract"), which is a per-run human step that a mapping row cannot carry. This module turns most of it into a
// machine check: a row's `componentType` must exist, its `propMap` keys must be real `inputs`, and its `events`
// must be real `outputs` — of the platform version the migration actually targets.
//
// WHAT IT CHECKS AND WHAT IT CANNOT. The registry has no `required` flag on a component's own inputs, no
// deprecation flag at COMPONENT level, and no package field: so "fill the required props", "flag a deprecated
// target" and "replace the hardcoded package knowledge" cannot be driven from it as the proposal assumed.
// What IS there, and is checked here: existence per version, input and output names, per-INPUT and per-OUTPUT
// deprecation (`deprecated` + `deprecationReason`), `compositeOnly`, and the selection taxonomy — on 8 of 205
// components, which is too thin a base for any selection decision and is therefore carried in the index as data
// only, with no consumer here.
//
// SCOPE. Only keys the TABLE declares are validated. The engine also emits framework-level props no component
// declares (`type`, `layoutConfig`, `visible`) — validating emitted `values` instead of declared keys would report
// those three as unknown on every row, and the natural reaction to a check that cries wolf is to switch it off.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAPPING_ROWS, SOURCE, gateForComponentType, gateConflicts, gateShapeIssues, rowComponentType, featureVerifyType } from "./mapping-table.mjs";

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
// against a component that does not exist (`crt.ContactCommunication` is the case a hand-kept catalogue records).
// Reuses the table's own `rowComponentType` resolver (RC-7) so the emit-over-verify precedence is
// single-sourced with the gate lookup — a local copy here was free to drift from the one the gate resolves through.
const namedType = rowComponentType;
const isEmitter = (row) => !!namedType(row) || !!row?.target?.foldInto;

// The COMPONENT-level half: does the type exist, and does it exist on the version being targeted? Own function so
// `validateRow` reads as its three subjects (component / inputs / outputs) rather than one long guard chain
// (Sonar CC 15).
function checkComponent(ctx) {
  const { c, ctype, version, bit, index, add } = ctx;
  if (version && bit === null) add("unknown-version", { componentType: ctype, version });
  else if (bit !== null && (c.v & bit) === 0)
    add("component-absent-in-version", { componentType: ctype, version, presentIn: versionsOf(c.v, index) });
  // `compositeOnly` is NOT a finding. It means the component has no Designer TOOLBAR entry; inserting it into a
  // page schema directly — which is what this engine emits — is valid. Reported as INFO so a row's note can say so
  // without a reader mistaking the flag for an error.
  if (c.compositeOnly) add("composite-only", { componentType: ctype });
}

// Every `propMap` KEY must be a real input of the component (or a shared base input), present on the target
// version, not deprecated, and — for a literal — inside the input's declared value domain.
function checkInputs(propMap, ctx) {
  const { c, ctype, version, bit, index, add } = ctx;
  // The prop's contract, from the component's OWN inputs or from the shared base inputs. Both carry a version
  // mask, so a base input is version-checked exactly like a component input — resolving it without that test was
  // how a base input introduced in a newer platform validated clean at the oldest indexed version.
  const inputMeta = (k) => c.inputs?.[k] || index.baseInputs?.[k] || null;
  for (const [prop, spec] of Object.entries(propMap || {})) {
    const meta = inputMeta(prop);
    if (!meta) { add("unknown-input", { componentType: ctype, prop }); continue; }
    // `meta.v == null` = an index generated before base inputs carried masks: it states no version membership, so
    // there is nothing to test. Skipped rather than reported — an absent record is not evidence of absence.
    if (meta.v != null && bit !== null && (meta.v & bit) === 0)
      add("input-absent-in-version", { componentType: ctype, prop, version, presentIn: versionsOf(meta.v, index) });
    // Per-INPUT deprecation is the only deprecation signal the registry carries. Advisory, not an error: a
    // deprecated input still works, and the row's author has to decide with the reason in front of them.
    if (meta.deprecated) add("deprecated-input", { componentType: ctype, prop, reason: meta.deprecationReason || null });
    if (spec?.from === SOURCE.LITERAL && meta.values && !meta.values.includes(spec.value))
      add("literal-not-in-values", { componentType: ctype, prop, value: spec.value, allowed: meta.values });
  }
}

// Every `events` key must be a real OUTPUT — validated against `outputs`, never `inputs`: an event put in
// `propMap` would send the check looking for an input no version declares.
function checkOutputs(events, ctx) {
  const { c, ctype, version, bit, index, add } = ctx;
  for (const ev of Object.keys(events || {})) {
    const meta = c.outputs?.[ev];
    if (!meta) { add("unknown-output", { componentType: ctype, event: ev }); continue; }
    if (bit !== null && (meta.v & bit) === 0)
      add("output-absent-in-version", { componentType: ctype, event: ev, version, presentIn: versionsOf(meta.v, index) });
    // Per-OUTPUT deprecation, same advisory treatment as per-input deprecation above: a deprecated output still
    // fires, and the row's author decides with the reason in front of them.
    if (meta.deprecated) add("deprecated-output", { componentType: ctype, event: ev, reason: meta.deprecationReason || null });
  }
}

// Validate ONE row against the index. `version` is optional: with it, existence is judged on that version;
// without it, on the union of every version the index carries — and the caller is told which, because a union
// check is exactly the "`latest` is a superset" trap that green-lights a target an 8.3 stand cannot render.
export function validateRow(row, { index = vendoredIndex(), version = null } = {}) {
  if (!isEmitter(row)) return [];                             // a tier-C row names no target on purpose
  // A FOLDED row (a menu item) contributes props to the element that owns it; it has no componentType of its own,
  // so there is nothing here to resolve. Its keys are validated on the owner's component by that owner's row.
  const ctype = namedType(row);
  if (!ctype) return [];
  const findings = [];
  const c = index.components?.[ctype];
  const where = `${row.match.by}=${row.match[row.match.by]}`;
  const add = (kind, detail) => findings.push({ kind, row: where, ...detail });
  if (!c) {
    // A row that waits for its component on a newer platform is built only when the run's registry carries it
    // (`carriesComponent`), so its absence from this index is expected and recorded, not a broken row.
    add(row.meta?.requiresRegistry ? "component-unindexed" : "unknown-component", { componentType: ctype });
    return findings;
  }
  // A `requiresRegistry` row is built only where the run's registry carries its component, so being absent from an
  // OLDER version is its design, exactly like an `upgrade` target below: it is judged against the union of versions.
  const atVersion = row.meta?.requiresRegistry ? null : version;
  const ctx = { c, ctype, version: atVersion, bit: atVersion ? versionBit(atVersion, index) : null, index, add };
  checkComponent(ctx);
  checkInputs(row.target?.propMap, ctx);
  checkOutputs(row.target?.events, ctx);
  for (const t of upgradeTargets(row)) validateUpgradeTarget(t, { index, add });
  return findings;
}

// A row's version-gated `upgrade` target and its option-child target, as `{ componentType, propMap }` pairs.
const upgradeTargets = (row) => [row?.upgrade, row?.upgrade?.children].filter((t) => t?.componentType);

// An UPGRADE target is emitted only where the registry carries it (`resolveRowTarget`), so being absent from a
// version is its design, not a defect: no `component-absent-in-version` here. What is still a hard error is a
// propMap key the component does not declare in ANY indexed version — that would be emitted wherever the upgrade
// fires. An index that does not carry the component at all can check nothing, which is recorded as an advisory
// rather than an error: the vendored index predates the component until it is regenerated.
function validateUpgradeTarget(t, { index, add }) {
  const c = index.components?.[t.componentType];
  if (!c) { add("upgrade-unindexed", { componentType: t.componentType }); return; }
  checkInputs(t.propMap, { c, ctype: t.componentType, version: null, bit: null, index, add });
  checkOutputs(t.events, { c, ctype: t.componentType, version: null, bit: null, index, add });
  checkHiddenProp(t, c, add);
}

// Element-level keys every Freedom view element accepts whatever its component (page business rules toggle them).
// The component index does not list them, so a key the table emits from this set is accepted by name; any other
// key is judged against the component's inputs like a propMap key.
export const ELEMENT_LEVEL_INPUTS = new Set(["visible"]);
// The key an option-child target hides a copy with (`children.hidden.prop`) must be element-level or a real input.
function checkHiddenProp(t, c, add) {
  const prop = t.hidden?.prop;
  if (prop && !ELEMENT_LEVEL_INPUTS.has(prop) && !c.inputs?.[prop])
    add("unknown-input", { componentType: t.componentType, prop });
}

// Severity, kept in ONE place so the CI check, a run-time gate and a reader cannot disagree about what blocks.
const ADVISORY = new Set(["deprecated-input", "deprecated-output", "composite-only", "component-unindexed", "upgrade-unindexed"]);
export const isAdvisory = (f) => ADVISORY.has(f.kind);

// Validate the whole table. `errors` are the findings that must fail a build; `advisories` are recorded and do not.
export function validateTable({ rows = MAPPING_ROWS, index = vendoredIndex(), version = null } = {}) {
  const findings = rows.flatMap((r) => validateRow(r, { index, version }));
  // Table-wide invariant: no component type may carry two divergent gates. This is a whole-table check,
  // not a per-row one, so it is folded in here after the per-row findings. `gate-conflict` is a hard error.
  // ...and the sibling invariant: a gate must have the SHAPE the guidance reads. A malformed gate is silent-wrong
  // the same way a divergent one is (it degrades to the re-plan dead end), so `gate-shape` is a hard error too.
  const conflicts = gateConflicts(rows);
  const shapes = gateShapeIssues(rows);
  return {
    version, indexVersions: index?.meta?.versions || [],
    errors: [...findings.filter((f) => !isAdvisory(f)), ...conflicts, ...shapes],
    advisories: findings.filter(isAdvisory),
  };
}

// ---- THE RUN-TIME REGISTRY: the stand's own answer, when there is one --------------------------------------
// The vendored index is the offline fallback and the CI check's subject. A real migration can do better: the target
// stand's registry, exported for ITS platform version. This is the half that makes the feature reachable on a real
// run instead of waiting on a clio-side change — the failure mode a stand-gated guard ships with.
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
      // `pickMeta` also picks `type`/`values`/`default`, which build-registry-index.mjs deliberately withholds
      // from OUTPUT_META (an output is an event, not a typed prop). Left unified here rather than duplicating a
      // second narrow picker: a stand export that happened to put one of those keys on an output would carry it
      // through unused, which is harmless — no reader treats an output's `type`/`values`/`default` as meaningful.
      outputs: Object.fromEntries(Object.entries(c.outputs || {}).map(([k, m]) => [k, { v: 1, ...pickMeta(m) }])),
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

// The `componentRegistry.file` branch of `resolveRunIndex`, lifted out of it. Every refusal below returns the same
// `unreadable-export` verdict for a different reason, and inlining them pushed `resolveRunIndex` past Sonar's
// cognitive-complexity ceiling (S3776, 22 against 15) — a fair signal, since the caller only has to decide WHICH of
// its three source kinds it is looking at, and this is the whole of one of them.
function indexFromRegistryFileRef(src, manifest, readFile) {
  // PARSE, then apply the SAME shape guard `resolveRunIndex`'s inline `components`
  // branch applies, then convert. Accepting anything that merely parses as JSON made this the fail-open path inside fail-closed code:
  // `indexFromRegistryExport` defaults `components` to `[]`, so a manifest.json, a package.json, a truncated or
  // simply wrong download yielded an index with `componentCount: 0` reported as `source: "stand-export"` — the
  // strongest of the three evidence levels. `validateRun` then reported every emitted `crt.*` type as
  // `unknown-component`, and the operator was handed "your stand does not carry crt.Input" instead of "that file
  // is not a registry export". `unreadable-export` was unreachable for such an input because nothing threw.
  // READ and PARSE are caught SEPARATELY, and only the read's own message is passed through. A read failure is
  // reported by the engine's own reader (ENOENT, or the base-directory containment refusal), so its wording is
  // engine-authored and safe to render. A `JSON.parse` failure is NOT: on Node 20+ the message embeds a snippet
  // of the offending input, `readRegistryFile` deliberately allows absolute paths, and `migrate.mjs`
  // interpolates `reg.error` into a needsDecision reason that lands verbatim in `plan.md` (same review) — so
  // file bytes would reach the operator-facing plan. That branch reports a fixed classification instead.
  let raw;
  try {
    raw = readFile(src.file);
  } catch (e) {
    // A registry the manifest NAMED but the engine could not read is reported, never silently downgraded to the
    // vendored index: the operator asked for the stand's answer and has to know they did not get it.
    return { index: vendoredIndex(), version: null, source: "unreadable-export", error: e.message, file: src.file };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { index: vendoredIndex(), version: null, source: "unreadable-export",
      error: "the file's bytes are not JSON", file: src.file };
  }
  if (!Array.isArray(parsed?.components)) {
    return { index: vendoredIndex(), version: null, source: "unreadable-export",
      error: "the file parses as JSON but carries no `components` array, so it is not a registry export",
      file: src.file };
  }
  const index = indexFromRegistryExport(parsed, { version: manifest.platformVersion || null });
  if (!index.meta.componentCount) {
    // A well-formed export with ZERO components is refused for the same reason: every emitted type would read
    // as absent from the stand, which is a wholesale wrong diagnosis rather than a weak one.
    return { index: vendoredIndex(), version: null, source: "unreadable-export",
      error: "the file is a registry export carrying NO components, so nothing could be validated against it",
      file: src.file };
  }
  return { index, version: index.meta.versions[0], source: "stand-export" };

}

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
    if (typeof src.file === "string" && readFile) return indexFromRegistryFileRef(src, manifest, readFile);
  }
  const idx = vendoredIndex();
  const pinned = manifest?.platformVersion && idx.meta.versions.includes(manifest.platformVersion) ? manifest.platformVersion : null;
  if (pinned) return { index: idx, version: pinned, source: "vendored-pinned" };
  // a pinned version the vendored index does not know is still the union, but the run must not read as "no version
  // given": the reader asked for a version, and only the stand's registry export can answer for it
  const unindexedVersion = manifest?.platformVersion || null;
  return { index: idx, version: null, source: "vendored-union", ...(unindexedVersion && { unindexedVersion }) };
}

// Does the registry a run resolved POSITIVELY carry `componentType` on the version it targets? Only a stand export or
// a pinned version can answer yes: a union of versions passes a type present in ANY of them, which says nothing about
// the target stand, so it answers no — as does an unreadable export, which fell back to that union.
export function carriesComponent(reg, componentType) {
  return carriedOn(reg?.index, componentType, reg?.version || null);
}

// Does the index CARRY `ctype` on `version` — and, when `inputs` are named, every one of those inputs on that version?
// Only a positive answer counts: no version (the union of every indexed version) proves nothing about the target
// stand, and a version the index never saw is unknown, not "present". An input record without a mask (`v == null`)
// states no version membership, so its presence is enough.
export function carriedOn(index, ctype, version, inputs = []) {
  const c = index?.components?.[ctype];
  if (!c || !version) return false;
  const bit = versionBit(version, index);
  const onVersion = (m) => !!m && (m.v == null || (m.v & bit) !== 0);
  return bit !== null && (c.v & bit) !== 0 && inputs.every((k) => onVersion(c.inputs?.[k]));
}

// Which target a row emits on THIS run. A row with an `upgrade` emits it only when the run's registry positively
// carries the upgrade component AND its option-child component on the version the run targets, each with the inputs
// its `gateInputs` names (crt.RadioGroupItem's `caption`) — a stand export, or a pinned platform version.
// Everything else (no registry, the unpinned union, an unreadable export that fell back to the union) keeps
// `row.target`: a page built on a type the stand cannot resolve does not render, so the fallback is the safe default. `availableIn` lists the indexed versions that DO carry the upgrade, so a run that
// fell back can say a newer stand would get it.
export function resolveRowTarget(row, registry) {
  const targets = upgradeTargets(row);
  if (!targets.length) return { target: row?.target || null, upgraded: false, availableIn: [] };
  const index = registry?.index || null;
  const version = registry?.source === "vendored-union" ? null : registry?.version || null;
  const carriedAll = (v) => targets.every((t) => carriedOn(index, t.componentType, v, t.gateInputs || []));
  if (index && carriedAll(version)) return { target: row.upgrade, upgraded: true, availableIn: [] };
  // Only an unversioned run can be told "a newer stand would get it": a pinned version or a stand export that lacks
  // the upgrade has answered the question for the target stand already.
  const names = version ? [] : index?.meta?.versions || [];
  const availableIn = names.filter(carriedAll);
  return { target: row.target, upgraded: false, availableIn };
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
// gate and migrate's composite-only skip read too), never from the ChangeSet entry — a feature row carries prose, not
// a type. Delegates to `featureVerifyType` so the MAPPING_ROWS lookup lives in exactly one place.
function featureTypeOf(f) {
  return featureVerifyType(f?.feature || f?.caption || "");
}

// Validate what a run emits against the registry it resolved. Returns findings in the same shape `validateRow`
// uses, so one severity rule covers both the CI check and a real run.
export function validateRun(changeSet, { index = vendoredIndex(), version = null } = {}) {
  const findings = [];
  const bitCount = (index?.meta?.versions || []).length;
  for (const [ctype, why] of runTypes(changeSet)) {
    // The structured gate intent for this type, resolved BY KIND from the shared rows. Carried on the
    // finding so the run-time guidance can branch by CAUSE — a gated composite (install/enable + re-run the build)
    // vs. a type no row gates (fix the mapping/plan and re-run `--plan --out`) — instead of one blanket "settle the
    // target" for both. It is attached to the resolution findings (absent / unknown), not to the compositeOnly
    // advisory, because only an absent type raises the question the gate answers.
    const gate = gateForComponentType(ctype);
    const c = index.components?.[ctype];
    if (!c) { findings.push({ kind: "unknown-component", componentType: ctype, why, gate }); continue; }
    const i = version ? (index.meta.versions || []).indexOf(version) : -1;
    if (i >= 0 && (c.v & (1 << i)) === 0)
      findings.push({ kind: "component-absent-in-version", componentType: ctype, version, why, presentIn: versionsOf(c.v, index), gate });
    if (c.compositeOnly) findings.push({ kind: "composite-only", componentType: ctype, why });
  }
  return { findings: findings.filter((f) => !isAdvisory(f)), advisories: findings.filter(isAdvisory), checkedVersions: bitCount };
}

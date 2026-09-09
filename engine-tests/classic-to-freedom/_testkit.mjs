// The Reconcile wire form is imported from the engine, never restated here: a copy of it would let a fixture
// drift from the line a real run copies.
import { reconcileWireState } from "../../skills/classic-to-freedom-migration/engine/designspec.mjs";

// Shared golden-test helpers: build normalized ParsedSchema records and diff ops in ONE place, so the
// schema/op shape lives here (both run.mjs and run-mapper.mjs import it) instead of two hand-kept copies
// that could drift and silently feed mergeHierarchy a malformed fixture.
// The properties that live inside a real classic diff op's `values` object. `makeOp` builds an ALREADY-normalized
// op (it bypasses `normalizeDiffOp`), so it has to reproduce every field the parser emits — including `valuesKeys`.
// `replayMerge` decides the identity properties by key PRESENCE, mirroring the runtime, so an op with no
// `valuesKeys` silently carries nothing: forgetting this made a merge golden fail while production was correct.
// Supplying a key here means "this layer's `values` carried it", which is exactly the distinction that matters —
// pass `itemType: null` to express "restated with a value the engine cannot resolve" (the runtime CLEARS the base).
const VALUE_KEYS = new Set(["bindTo", "itemType", "contentType", "dataValueType", "order",
  "layout", "tip", "hint", "generator", "visible", "caption"]);
export const makeOp = (o) => ({
  operation: o.operation || "insert", name: o.name,
  parentName: o.parentName ?? null, propertyName: o.propertyName ?? null,
  bindTo: o.bindTo ?? null, itemType: o.itemType ?? null, contentType: o.contentType ?? null,
  dataValueType: o.dataValueType ?? null,
  isTab: !!o.isTab, order: o.order ?? null,
  layout: o.layout ?? null, tip: o.tip ?? null, hint: o.hint ?? null, generator: o.generator ?? null, visible: o.visible ?? null,
  caption: o.caption ?? null,
  // IDEMPOTENT, and it has to be: tests call `makeOp` themselves (imported as `di`) and then hand the result to
  // `makeSchema`, which maps `makeOp` over the diff AGAIN. Every other field here survives that double pass because
  // `o.x ?? null` twice equals once — `valuesKeys` does NOT, because on the second pass `o` is a fully normalized op
  // with EVERY key present, so recomputing gave all eleven and a `merge` then cleared every property the base had.
  // Reusing an already-computed set is what keeps "the caller supplied this key" meaning what it says.
  valuesKeys: o.valuesKeys instanceof Set ? o.valuesKeys : new Set(Object.keys(o).filter((k) => VALUE_KEYS.has(k))),
  itemTypeUnresolved: !!o.itemTypeUnresolved,
});
export const makeSchema = (pkg, o = {}) => ({
  pkg, error: null, entitySchemaName: o.entity || "?", diff: (o.diff || []).map(makeOp),
  businessRules: o.businessRules || {}, rules: o.rules || {}, details: o.details || {},
  methods: o.methods || [], attributes: [], modules: o.modules || [], features: o.features || [], actionHints: o.actionHints || [],
  refModules: o.refModules || [],
});

// THE RECONCILE WIRE SPLIT, in one place because two suites drive the same contract. A scripted answer is written
// FLAT, the way the run consumes it; on the wire the computed half is a COPIED STATE LINE and only the facts a
// stand read can give are sibling fields. A fixture that must be malformed on the wire composes its own object and
// does not come through here — nor does one that already carries a `summary`.
//
// The state keys the engine always computes are filled in when a fixture omits them: an omission models a MINIMAL
// run, not a malformed line.
//
// AND THE LINE IS BUILT BY THE ENGINE'S OWN `reconcileWireState`, not by writing the state out whole. A fixture
// that carried a field the wire form drops would run on a richer state than production ever sees, and a caller
// reading that field would look correct here and starve on a live run.
export const RECONCILE_ANSWER_FIELDS = new Set(["summary", "approval", "packageState", "componentResolution",
  "templateResolution", "schemaNamePrefix", "schemaNamePrefixEmpty", "exitCode", "verifyTablePath", "notes"]);
export const asReconcileAnswer = (flat) => {
  if (flat === null || typeof flat !== "object" || Array.isArray(flat)) return flat;
  if (typeof flat.summary === "string") return flat;
  const answer = {};
  const state = { planVersion: null, planGaps: [], unitKeys: [], buildOrder: [], verify: {}, roundOf: {}, targetPackage: null };
  for (const [k, v] of Object.entries(flat)) (RECONCILE_ANSWER_FIELDS.has(k) ? answer : state)[k] = v;
  return { ...answer, summary: JSON.stringify(reconcileWireState(state)) };
};

// The package-record re-read runs in the Reconcile phase but answers a DIFFERENT contract
// (`{ read, packageCreated }`), so it is not a state answer and is never wrapped.
export const isReconcileStateAnswer = (opts) =>
  opts?.phase === "Reconcile" && !String(opts?.label || "").includes("package-record");

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
  valuesKeys: new Set(Object.keys(o).filter((k) => VALUE_KEYS.has(k))),
  itemTypeUnresolved: !!o.itemTypeUnresolved,
});
export const makeSchema = (pkg, o = {}) => ({
  pkg, error: null, entitySchemaName: o.entity || "?", diff: (o.diff || []).map(makeOp),
  businessRules: o.businessRules || {}, rules: o.rules || {}, details: o.details || {},
  methods: o.methods || [], attributes: [], modules: o.modules || [], features: o.features || [], actionHints: o.actionHints || [],
  refModules: o.refModules || [],
});

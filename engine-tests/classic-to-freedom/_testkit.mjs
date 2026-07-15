// Shared golden-test helpers: build normalized ParsedSchema records and diff ops in ONE place, so the
// schema/op shape lives here (both run.mjs and run-mapper.mjs import it) instead of two hand-kept copies
// that could drift and silently feed mergeHierarchy a malformed fixture.
export const makeOp = (o) => ({
  operation: o.operation || "insert", name: o.name,
  parentName: o.parentName ?? null, propertyName: o.propertyName ?? null,
  bindTo: o.bindTo ?? null, itemType: o.itemType ?? null, contentType: o.contentType ?? null,
  isTab: !!o.isTab, order: o.order ?? null,
  layout: o.layout ?? null, tip: o.tip ?? null, hint: o.hint ?? null, generator: o.generator ?? null, visible: o.visible ?? null,
  caption: o.caption ?? null,
});
export const makeSchema = (pkg, o = {}) => ({
  pkg, error: null, entitySchemaName: o.entity || "?", diff: (o.diff || []).map(makeOp),
  businessRules: o.businessRules || {}, rules: o.rules || {}, details: o.details || {},
  methods: o.methods || [], attributes: [], modules: o.modules || [], features: o.features || [], actionHints: o.actionHints || [],
  refModules: o.refModules || [],
});

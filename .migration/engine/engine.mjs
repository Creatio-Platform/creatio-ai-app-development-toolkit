// Ф2 — Merge engine (prototype). Pure Node module, no Creatio/stand dependency.
// Parses classic ClientUnitSchema layer bodies and merges N layers (base->top)
// into one effective page model + provenance. See .migration/solution-design.md §3.1.
import vm from "node:vm";

// Universal proxy: any property access / call / construct returns itself.
// Lets us eval a classic define(...) body whose factory touches Terrasoft/Ext/this
// without executing real platform code — we only want the returned data literal.
function makeProxy() {
  const handler = {
    get: (_t, prop) => {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === "toJSON") return () => null;
      if (prop === Symbol.iterator) return undefined;
      return PROXY;
    },
    apply: () => PROXY,
    construct: () => PROXY,
  };
  const PROXY = new Proxy(function () {}, handler);
  return PROXY;
}
const PROXY = makeProxy();

// Enum tables seeded into the sandbox so SYMBOLIC refs (BusinessRuleModule.enums.RuleType.FILTRATION,
// ...Property.REQUIRED) resolve to their real numeric value during parse instead of collapsing to a
// Proxy (which silently mis-decoded to BINDPARAMETER/Visible). Backed proxy: known member -> number,
// unknown -> PROXY (never crash a body).
function enumProxy(table) {
  return new Proxy({}, { get: (_t, p) => (p in table ? table[p] : PROXY), apply: () => PROXY });
}
const BUSINESS_RULE_MODULE = new Proxy({}, {
  get: (_t, p) => p === "enums" ? new Proxy({}, {
    get: (_t2, e) => e === "RuleType" ? enumProxy({ BINDPARAMETER: 0, FILTRATION: 1 })
      : e === "Property" ? enumProxy({ VISIBLE: 0, ENABLED: 1, REQUIRED: 2, READONLY: 3 })
        : PROXY,
  }) : PROXY,
  apply: () => PROXY,
});
// Resolve an AMD dependency name to a stub. Only BusinessRuleModule needs real values (for rule enums);
// everything else (terrasoft, Ext, helpers) is the universal Proxy.
function resolveDep(name) {
  return name === "BusinessRuleModule" ? BUSINESS_RULE_MODULE : PROXY;
}

// Extract the schema object literal from a layer body by capturing define().
export function parseLayer(src, pkg) {
  let captured = null, parseError = null;
  // factory `this` also exposes BusinessRuleModule (bodies reference this.BusinessRuleModule too).
  const thisProxy = new Proxy(function () {}, {
    get: (_t, p) => p === "BusinessRuleModule" ? BUSINESS_RULE_MODULE : PROXY,
    apply: () => PROXY, construct: () => PROXY,
  });
  const sandbox = {
    define(_name, depsOrFactory, maybeFactory) {
      const factory = typeof depsOrFactory === "function" ? depsOrFactory : maybeFactory;
      const deps = Array.isArray(depsOrFactory) ? depsOrFactory : [];
      if (typeof factory !== "function") { parseError = "define() has no factory function"; return; }
      try { captured = factory.apply(thisProxy, deps.map(resolveDep)); }
      catch (e) { parseError = "factory threw: " + String(e && e.message || e); }
    },
    // window/console are PROXY (NOT plain host objects) so a body cannot reach the host realm via
    // window.constructor.constructor / console.log.constructor (sandbox-escape hardening).
    Terrasoft: PROXY, Ext: PROXY, BusinessRuleModule: BUSINESS_RULE_MODULE, window: PROXY, console: PROXY,
  };
  try { vm.runInNewContext(src, sandbox, { timeout: 4000 }); }
  catch (e) { parseError = parseError || ("eval failed: " + String(e && e.message || e)); }
  const s = captured || {};
  return {
    pkg,
    error: parseError,
    entitySchemaName: typeof s.entitySchemaName === "string" ? s.entitySchemaName : "?",
    diff: normalizeDiff(s.diff),
    businessRules: plainObj(s.businessRules),
    rules: plainObj(s.rules),
    details: normalizeDetails(s.details),
    methods: safeKeys(s.methods),
    attributes: safeKeys(s.attributes),
    modules: normalizeModules(s.modules),
  };
}

const isNum = (v) => typeof v === "number";
const isStr = (v) => typeof v === "string";
function safeKeys(o) { return o && typeof o === "object" ? Object.keys(o).filter(k => typeof k === "string") : []; }
function plainObj(o) { return o && typeof o === "object" && !Array.isArray(o) ? o : {}; }

function normalizeDiff(diff) {
  if (!Array.isArray(diff)) return [];
  return diff.map((op) => {
    const v = op && op.values && typeof op.values === "object" ? op.values : {};
    return {
      operation: isStr(op.operation) ? op.operation : "?",
      name: isStr(op.name) ? op.name : "?",
      parentName: isStr(op.parentName) ? op.parentName : null,
      propertyName: isStr(op.propertyName) ? op.propertyName : null,
      index: isNum(op.index) ? op.index : null,
      bindTo: isStr(v.bindTo) ? v.bindTo : null,
      itemType: isNum(v.itemType) ? v.itemType : null,      // 0 grid,2 detail,15 group
      contentType: isNum(v.contentType) ? v.contentType : null,
      isTab: op.propertyName === "tabs",
      hasCaption: !!(v.caption),
      order: v && isNum(v.order) ? v.order : null,
    };
  }).filter(op => op.name !== "?");
}

function normalizeDetails(d) {
  const out = {};
  if (d && typeof d === "object") for (const k of Object.keys(d)) {
    const e = d[k] || {};
    const f = e.filter && typeof e.filter === "object" ? e.filter : {};
    out[k] = { schemaName: isStr(e.schemaName) ? e.schemaName : null,
               entitySchemaName: isStr(e.entitySchemaName) ? e.entitySchemaName : null,
               detailColumn: isStr(f.detailColumn) ? f.detailColumn : null,
               masterColumn: isStr(f.masterColumn) ? f.masterColumn : null };
  }
  return out;
}

function normalizeModules(m) {
  const out = [];
  if (m && typeof m === "object") for (const k of Object.keys(m)) {
    const e = m[k] || {};
    out.push({ key: k, moduleName: isStr(e.moduleName) ? e.moduleName : null });
  }
  return out;
}

// ruleType 0=BINDPARAMETER,1=FILTRATION ; property 0=Visible,1=Enabled,2=Required,3=Readonly
const RULE_TYPE = { 0: "BINDPARAMETER", 1: "FILTRATION" };
const PROP = { 0: "Visible", 1: "Enabled", 2: "Required", 3: "Readonly" };

// Extract a rule's condition tree (leftExpression attribute/path, comparison, rightExpression value)
// so the mapper can emit COMPLETE business rules (not just an action + prose note).
function sanitizeConditions(conds) {
  if (!Array.isArray(conds)) return [];
  return conds.map(c => {
    const l = (c && c.leftExpression) || {}, r = (c && c.rightExpression) || {};
    return {
      comparison: typeof c.comparisonType === "number" ? c.comparisonType : null,
      left: { attribute: isStr(l.attribute) ? l.attribute : null, path: isStr(l.attributePath) ? l.attributePath : null },
      right: { value: ["number", "string", "boolean"].includes(typeof r.value) ? r.value : null,
               dataValueType: typeof r.dataValueType === "number" ? r.dataValueType : null },
    };
  });
}

export function mergeLayers(layers /* base->top */) {
  const items = new Map();     // name -> item record
  const rules = new Map();     // "attr::ruleKey" -> record
  const details = new Map();   // key -> record
  const methods = new Map();   // name -> [pkgs] (override stack)
  const components = new Map(); // module key -> {moduleName, provenance} (widgets/charts → B9/B10)
  const entity = layers.find(l => l.entitySchemaName !== "?")?.entitySchemaName || "?";

  for (const L of layers) {
    // diff replay
    for (const op of L.diff) {
      const cur = items.get(op.name);
      if (op.operation === "insert") {
        items.set(op.name, {
          name: op.name, parent: op.parentName, propertyName: op.propertyName,
          bindTo: op.bindTo, itemType: op.itemType, contentType: op.contentType,
          isTab: op.isTab, removed: false, provenance: [L.pkg], order: op.order,
        });
      } else if (op.operation === "merge") {
        if (cur) { if (op.order != null) cur.order = op.order; if (op.bindTo) cur.bindTo = op.bindTo; cur.provenance.push(L.pkg); }
        else items.set(op.name, { name: op.name, parent: op.parentName, propertyName: op.propertyName, bindTo: op.bindTo, itemType: op.itemType, isTab: op.isTab, removed: false, provenance: [L.pkg], external: true, order: op.order });
      } else if (op.operation === "move") {
        if (cur) { if (op.parentName) cur.parent = op.parentName; cur.provenance.push(L.pkg); }
      } else if (op.operation === "remove") {
        if (cur) { cur.removed = true; cur.removedBy = L.pkg; } else items.set(op.name, { name: op.name, removed: true, removedBy: L.pkg, provenance: [L.pkg] });
      }
    }
    // businessRules + legacy rules (merge by attribute::ruleKey)
    for (const [sys, block] of [["businessRules", L.businessRules], ["rules", L.rules]]) {
      for (const attr of Object.keys(block || {})) {
        const ar = block[attr]; if (!ar || typeof ar !== "object") continue;
        for (const key of Object.keys(ar)) {
          const r = ar[key] || {};
          const id = `${attr}::${key}`;
          const rec = {
            attr, key, system: sys,
            // guard: only decode when numeric (after enum seeding legacy rules are numbers too);
            // a still-non-numeric value is genuinely symbolic/unknown -> flagged, never silently "0".
            ruleType: typeof r.ruleType === "number" ? (RULE_TYPE[r.ruleType] ?? String(r.ruleType)) : "symbolic",
            property: typeof r.property === "number" ? (PROP[r.property] ?? String(r.property)) : null,
            conditions: sanitizeConditions(r.conditions),
            filterColumn: isStr(r.baseAttributePatch) ? r.baseAttributePatch : null,
            comparison: typeof r.comparisonType === "number" ? r.comparisonType : null,
            value: ["number", "string", "boolean"].includes(typeof r.value) ? r.value : null,
            dataValueType: typeof r.dataValueType === "number" ? r.dataValueType : null,
            enabled: r.enabled !== false, removed: r.removed === true,
            provenance: [L.pkg],
          };
          if (rules.has(id)) { const p = rules.get(id); rec.provenance = [...p.provenance, L.pkg]; }
          rules.set(id, rec);
        }
      }
    }
    // details
    for (const k of Object.keys(L.details)) {
      const rec = { key: k, ...L.details[k], provenance: [L.pkg] };
      if (details.has(k)) rec.provenance = [...details.get(k).provenance, L.pkg];
      details.set(k, rec);
    }
    // methods (override stack)
    for (const m of L.methods) methods.set(m, [...(methods.get(m) || []), L.pkg]);
    // modules (widgets/charts) — merge by key
    for (const c of L.modules || []) {
      const rec = { ...c, provenance: [L.pkg] };
      if (components.has(c.key)) rec.provenance = [...components.get(c.key).provenance, L.pkg];
      components.set(c.key, rec);
    }
  }

  const alive = [...items.values()].filter(i => !i.removed);
  const removed = [...items.values()].filter(i => i.removed);
  const activeRules = [...rules.values()].filter(r => r.enabled && !r.removed);

  return {
    entity,
    fields: alive.filter(i => i.bindTo).map(i => ({ name: i.name, bindTo: i.bindTo, parent: i.parent, contentType: i.contentType, provenance: i.provenance })),
    tabs: alive.filter(i => i.isTab).map(i => ({ name: i.name, order: i.order, provenance: i.provenance })),
    detailItems: alive.filter(i => i.itemType === 2).map(i => ({ name: i.name, parent: i.parent, provenance: i.provenance })),
    details: [...details.values()],
    rules: activeRules,
    removed: removed.map(i => ({ name: i.name, removedBy: i.removedBy })),
    methods: [...methods.entries()].map(([n, stack]) => ({ name: n, stack })),
    components: [...components.values()],
  };
}

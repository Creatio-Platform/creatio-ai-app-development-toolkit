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
// ViewItemType — ONLY members CONFIRMED from real stand data (0/2/15 seen as numeric literals on the
// same pages); others stay PROXY->null, never guessed (E1 lesson: a wrong enum value silently corrupts).
// Seeded so symbolic `Terrasoft.controls.ViewItemType.CONTROL_GROUP` resolves to a number instead of
// null — otherwise most group/grid containers lose their itemType and the mapper can't tell a
// CONTROL_GROUP (→ ExpansionPanel) from a GRID_LAYOUT (→ GridContainer).
const VIEW_ITEM_TYPE = enumProxy({ GRID_LAYOUT: 0, DETAIL: 2, CONTROL_GROUP: 15 });
const enumHolder = (member, val) => new Proxy({}, { get: (_t, p) => p === member ? val : PROXY, apply: () => PROXY, construct: () => PROXY });
// Terrasoft stub: resolves `.ViewItemType`, `.controls.ViewItemType`, `.core.enums.ViewItemType` to the
// seeded table; everything else stays the universal PROXY (unchanged behaviour).
const TERRASOFT = new Proxy({}, {
  get: (_t, p) => p === "ViewItemType" ? VIEW_ITEM_TYPE
    : p === "controls" ? enumHolder("ViewItemType", VIEW_ITEM_TYPE)
    : p === "core" ? new Proxy({}, { get: (_t2, c) => c === "enums" ? enumHolder("ViewItemType", VIEW_ITEM_TYPE) : PROXY, apply: () => PROXY })
    : PROXY,
  apply: () => PROXY, construct: () => PROXY,
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
    // window/console are PROXY (not plain host objects) to close the obvious window.constructor.constructor
    // vector — but this is NOT a security boundary. `define` (and the enum proxies) are real host-realm
    // functions, so a body can still escape via define.constructor.constructor("return process")(). node:vm
    // is not a sandbox for untrusted code; today's inputs are OFFLINE fixtures only. Before any production
    // seed-fetch feeds stand-sourced bodies here, replace this with a non-executing parser / real isolation
    // (see F8 in SELF-REVIEW.md). Do not treat parseLayer as safe for untrusted input.
    Terrasoft: TERRASOFT, Ext: PROXY, BusinessRuleModule: BUSINESS_RULE_MODULE, window: PROXY, console: PROXY,
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
    // feature toggles referenced in the body (getIsFeatureEnabled('X')) — which element each gates
    // lives in method bodies (imperative → judgment), so we surface the NAMES for a decision.
    features: [...new Set([...src.matchAll(/getIsFeatureEnabled\(\s*["']([\w.]+)["']/g)].map(mt => mt[1]))],
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
      // classic grid coordinates — preserved so the mapper reproduces the real multi-column layout
      // (e.g. a wide 3-column header) instead of inventing a single narrow column.
      layout: normalizeLayout(v.layout),
      // tooltip resource key (classic `tip.content.bindTo = "Resources.Strings.XTip"`) — carried to the
      // Freedom field so hints aren't lost; and the component `generator` (image/photo etc.) for
      // recognising non-field components the mapper otherwise drops.
      tip: (v.tip && v.tip.content && isStr(v.tip.content.bindTo)) ? v.tip.content.bindTo : null,
      generator: isStr(v.generator) ? v.generator : null,
      // visibility: static false / a dynamic expression (bind/rule) / true. null = this op didn't set it.
      visible: typeof v.visible === "boolean" ? v.visible : (v.visible && typeof v.visible === "object" ? "dynamic" : null),
    };
  }).filter(op => op.name !== "?");
}

function normalizeLayout(l) {
  if (!l || typeof l !== "object") return null;
  const n = (x) => (isNum(x) ? x : null);
  const out = { column: n(l.column), colSpan: n(l.colSpan), row: n(l.row), rowSpan: n(l.rowSpan) };
  return Object.values(out).some(v => v !== null) ? out : null;
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

// mergeLayers(layers, opts)
//   layers    — the schema's own layers, base->top in true dependency order (F1).
//   opts.seedLayers — parsed parent-TEMPLATE layers (e.g. the BaseModulePageV2→…→BaseEntityPage
//     chain) merged FIRST, so base containers (Header/ProfileContainer/Tabs) and base tabs (ESNTab…)
//     exist before the schema's own layers patch them (F2). Seed packages define only LAYOUT context:
//     every produced element is tagged `fromTemplate` (F9) so the mapper migrates only the page's own
//     content (fields/rules/details/methods/components touched by a schema layer) and treats
//     template-only elements — e.g. the 300+ framework methods on BaseEntityPage — as context, not
//     payload. Without this, seeding the full chain floods the ChangeSet with base noise.
export function mergeLayers(layers /* base->top */, opts = {}) {
  const items = new Map();     // name -> item record
  const rules = new Map();     // "attr::ruleKey" -> record
  const details = new Map();   // key -> record
  const methods = new Map();   // name -> [pkgs] (override stack)
  const components = new Map(); // module key -> {moduleName, provenance} (widgets/charts → B9/B10)
  // Non-fatal diagnostics. A merge/move/remove that targets an item NO lower layer defined means
  // either the layers were passed out of dependency order (F1) or the base-template element it
  // patches was never seeded (F2). We surface these instead of silently dropping/orphaning them.
  const warnings = [];
  const seedLayers = Array.isArray(opts.seedLayers) ? opts.seedLayers : [];
  // F9 origin: tag each layer by WHERE it came from — parent-template seed vs the page's own schema
  // layers. This is the authoritative signal, known HERE from which list the layer is in; we do NOT
  // reconstruct it from package names later (names collide when one package is both a template layer
  // and a schema layer). Diff-items carry `templateOwned` = their DEFINING insert came from a seed
  // layer — used for STRUCTURAL identity: a base tab a client merely re-captions is still template-
  // owned, so we never re-synthesize it (the Freedom template still provides it). Keyed elements
  // (rules/methods/details/components) carry `schemaTouched` = ≥1 schema layer contributed — a client
  // override IS payload. Payload = items a schema layer authored; template-only = layout context.
  const tagged = [
    ...seedLayers.map(L => ({ L, seed: true })),   // parent-template skeleton first
    ...layers.map(L => ({ L, seed: false })),      // then the schema's own layers
  ];
  const entity = layers.find(l => l.entitySchemaName !== "?")?.entitySchemaName || "?";

  for (const { L, seed } of tagged) {
    // diff replay
    for (const op of L.diff) {
      const cur = items.get(op.name);
      if (op.operation === "insert") {
        items.set(op.name, {
          name: op.name, parent: op.parentName, propertyName: op.propertyName,
          bindTo: op.bindTo, itemType: op.itemType, contentType: op.contentType,
          isTab: op.isTab, removed: false, provenance: [L.pkg], order: op.order, layout: op.layout,
          tip: op.tip, generator: op.generator, visible: op.visible,
          templateOwned: seed, // the DEFINING insert's origin — never overwritten by a later merge/move
        });
      } else if (op.operation === "merge") {
        // patch in place; carry contentType/itemType too — a later layer can introduce a control hint
        // (e.g. mark a text field as lookup, contentType 5); dropping it made control selection wrong.
        if (cur) { if (op.order != null) cur.order = op.order; if (op.bindTo) cur.bindTo = op.bindTo; if (op.contentType != null) cur.contentType = op.contentType; if (op.itemType != null) cur.itemType = op.itemType; if (op.layout) cur.layout = op.layout; if (op.visible != null) cur.visible = op.visible; if (op.tip) cur.tip = op.tip; cur.provenance.push(L.pkg); }
        else {
          // merge onto an item no lower layer defined: record a stub with the SAME shape as an insert
          // (incl. contentType); templateOwned marks whether this first (merge-)definition was a seed.
          items.set(op.name, { name: op.name, parent: op.parentName, propertyName: op.propertyName, bindTo: op.bindTo, itemType: op.itemType, contentType: op.contentType, isTab: op.isTab, removed: false, provenance: [L.pkg], order: op.order, templateOwned: seed });
          warnings.push({ op: "merge", name: op.name, layer: L.pkg, hint: "merge onto an item no lower layer defined — base-template element not seeded (F2) or layers out of order (F1)" });
        }
      } else if (op.operation === "move") {
        // classic idiom: `remove` then `move` = reposition — the element ends up PRESENT at the new
        // spot. So a move onto a tombstoned item RESURRECTS it (else a displayed field silently vanishes,
        // e.g. Product's IsArchive/"Inactive" checkbox).
        if (cur) { if (op.parentName) cur.parent = op.parentName; if (cur.removed) { cur.removed = false; cur.removedBy = null; cur.removedBySeed = false; } cur.provenance.push(L.pkg); }
        else warnings.push({ op: "move", name: op.name, layer: L.pkg, hint: `move to '${op.parentName}' but the item was never defined — move dropped; check base seed (F2) / layer order (F1)` });
      } else if (op.operation === "remove") {
        // removedBySeed: a template-internal remove (base template dropping a base element) is context,
        // not a client B6 decision — the mapper filters it out like every other template-only element.
        if (cur) { cur.removed = true; cur.removedBy = L.pkg; cur.removedBySeed = seed; }
        else {
          items.set(op.name, { name: op.name, removed: true, removedBy: L.pkg, removedBySeed: seed, provenance: [L.pkg] });
          warnings.push({ op: "remove", name: op.name, layer: L.pkg, hint: "remove of an item no lower layer defined — recorded as tombstone; check base seed / layer order" });
        }
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
            provenance: [L.pkg], schemaTouched: !seed,
          };
          if (rules.has(id)) { const p = rules.get(id); rec.provenance = [...p.provenance, L.pkg]; rec.schemaTouched = p.schemaTouched || !seed; }
          rules.set(id, rec);
        }
      }
    }
    // details
    for (const k of Object.keys(L.details)) {
      const prev = details.get(k);
      const rec = { key: k, ...L.details[k], provenance: [L.pkg], schemaTouched: !seed };
      if (prev) { rec.provenance = [...prev.provenance, L.pkg]; rec.schemaTouched = prev.schemaTouched || !seed; }
      details.set(k, rec);
    }
    // methods (override stack) — track whether any schema layer contributed
    for (const m of L.methods) { const prev = methods.get(m); methods.set(m, { pkgs: [...(prev?.pkgs || []), L.pkg], schemaTouched: (prev?.schemaTouched || false) || !seed }); }
    // modules (widgets/charts) — merge by key
    for (const c of L.modules || []) {
      const prev = components.get(c.key);
      const rec = { ...c, provenance: [L.pkg], schemaTouched: (prev?.schemaTouched || false) || !seed };
      if (prev) rec.provenance = [...prev.provenance, L.pkg];
      components.set(c.key, rec);
    }
  }

  const alive = [...items.values()].filter(i => !i.removed);
  const removed = [...items.values()].filter(i => i.removed);
  const activeRules = [...rules.values()].filter(r => r.enabled && !r.removed);

  // Parent containers referenced by an ALIVE item but never defined by an ALIVE item == base-template
  // elements the client's layers sit inside (e.g. Header, GeneralInfoTab from BaseModulePageV2).
  // This is the precise seed list F2 must supply so layout targets resolve and base tabs survive.
  // Computed over the ALIVE set only (NOT items.keys(), which includes remove-tombstones): the mapper's
  // routing index is alive-only, so a parent that survives only as a tombstone must still count as
  // unresolved here — otherwise the diagnostic gives a false all-clear the mapper contradicts.
  const aliveNames = new Set(alive.map(i => i.name));
  const unresolvedParents = [...new Set(
    alive.map(i => i.parent).filter(p => p && !aliveNames.has(p))
  )].sort();
  // feature toggles referenced by the SCHEMA layers (not the base template) — they gate element
  // visibility at runtime; the rendered page shows one feature-state while this is the full union.
  const features = [...new Set(layers.flatMap(l => l.features || []))].sort();

  return {
    entity,
    // Full alive layout tree (containers, groups, tabs, fields) with parent links — the input F3's
    // mapper walks to route each field to its owning tab/group. Diff-items carry `templateOwned`
    // (defining insert came from a seed layer): payload = client-authored items, structural identity =
    // template ownership. Keyed projections below carry `fromTemplate` (= no schema layer contributed).
    items: alive.map(i => ({ name: i.name, parent: i.parent, propertyName: i.propertyName,
      itemType: i.itemType, contentType: i.contentType, bindTo: i.bindTo || null,
      isTab: i.isTab, order: i.order, layout: i.layout || null, tip: i.tip || null, generator: i.generator || null,
      visible: i.visible ?? null, provenance: i.provenance, templateOwned: !!i.templateOwned })),
    fields: alive.filter(i => i.bindTo).map(i => ({ name: i.name, bindTo: i.bindTo, parent: i.parent, contentType: i.contentType, layout: i.layout || null, tip: i.tip || null, visible: i.visible ?? null, provenance: i.provenance, templateOwned: !!i.templateOwned })),
    tabs: alive.filter(i => i.isTab).map(i => ({ name: i.name, order: i.order, provenance: i.provenance, templateOwned: !!i.templateOwned })),
    // each detail carries its PLACEMENT (parent container + order) from the matching diff-item, so the
    // mapper can put the Expanded list in the right tab, in order (Gap: detail→tab/order was dropped).
    details: [...details.values()].map(d => {
      const it = items.get(d.key);
      return { ...d, fromTemplate: !d.schemaTouched, parent: it?.parent ?? null, order: it?.order ?? null };
    }),
    rules: activeRules.map(r => ({ ...r, fromTemplate: !r.schemaTouched })),
    removed: removed.map(i => ({ name: i.name, removedBy: i.removedBy, fromTemplate: !!i.removedBySeed })),
    methods: [...methods.entries()].map(([n, m]) => ({ name: n, stack: m.pkgs, fromTemplate: !m.schemaTouched })),
    components: [...components.values()].map(c => ({ ...c, fromTemplate: !c.schemaTouched })),
    warnings,
    unresolvedParents,
    features, // feature toggles gating runtime visibility (the rendered page shows one feature-state)
  };
}

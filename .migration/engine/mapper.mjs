// Ф3 — Mapper (prototype). Pure Node module: EffectiveClassicPage (from engine.mjs)
// -> Freedom ChangeSet (viewConfigDiff / viewModelConfigDiff / modelConfigDiff + rule specs)
// + needsDecision[] for the judgment 20%. See .migration/solution-design.md §3.3.

// Lesson #6 — structural preservation: target container derives from the SOURCE container role.
// Single source of truth for the profile-role containers (consumed by both CONTAINER and resolveOwner).
const PROFILE_CONTAINERS = new Set(["ProfileContainer", "Header"]);
const CONTAINER = Object.fromEntries([...PROFILE_CONTAINERS].map(n => [n, "SideAreaProfileContainer"]));
const toContainer = (parent) => CONTAINER[parent] || "GeneralInfoTabContainer";

// F3 — resolve which Freedom region a field belongs to by CLIMBING the classic item tree from the
// field's parent: hitting Header/ProfileContainer => the side profile; hitting a tab => that tab;
// running off the tree (parent never defined) => unresolved (caller flags + falls back). This is
// what turns the old "everything flattens to one tab" into faithful tab/group placement.
function resolveOwner(startParent, index) {
  let parent = startParent, hops = 0;
  while (parent && hops++ < 32) {
    if (PROFILE_CONTAINERS.has(parent)) return { kind: "profile" };
    const p = index.get(parent);
    if (!p) return { kind: "unresolved", parent };
    if (p.isTab) return { kind: "tab", tab: p.name, tabFromTemplate: !!p.fromTemplate };
    parent = p.parent;
  }
  return { kind: "unresolved", parent: startParent };
}
const tabGridName = (tab) => `${tab}Grid`;

// entity column dataType (+ classic contentType) -> Freedom control
function control(dataType, contentType) {
  const t = (dataType || "").toLowerCase();
  if (contentType === 5 || t === "lookup") return { type: "crt.ComboBox", lookup: true };
  if (t === "boolean") return { type: "crt.Checkbox" };
  if (t === "datetime") return { type: "crt.DateTimePicker", picker: "datetime" };
  if (t === "date") return { type: "crt.DateTimePicker", picker: "date" };
  if (["integer", "decimal", "float", "money", "32"].includes(t)) return { type: "crt.NumberInput" };
  if (["29", "30"].includes(t)) return { type: "crt.Input", multiline: true }; // long text / rich text
  if (t === "text" || t === "27" || t === "28") return { type: "crt.Input" };
  return null; // unknown -> needsDecision
}

// BINDPARAMETER property -> [action, inverseAction] (rules are one-way -> always emit the inverse)
const PROP_ACTION = {
  Required: ["make-required", "make-optional"],
  Readonly: ["make-read-only", "make-editable"],
  Enabled: ["make-editable", "make-read-only"],
  Visible: ["show-element", "hide-element"],
};

export function mapToFreedom(eff, opts = {}) {
  const cols = opts.entityColumns || {};       // { column: dataType }
  const clientEditableLayers = new Set(opts.clientEditableLayers || []); // for B6 removals
  const needsDecision = [];
  const viewConfigDiff = [];
  const attributes = {};
  const pdsColumns = {};

  // F9: migrate only the page's OWN content, not the platform template chain seeded for layout.
  // `fromTemplate` elements (e.g. BaseEntityPage's framework methods, base-template details) are
  // context — kept in eff.items for ancestry routing, but excluded from the payload. The full layout
  // tree (index below) still uses ALL items so base containers resolve. `baseContextExcluded` reports
  // the counts so the exclusion is transparent, not silent.
  const notTpl = (x) => !x.fromTemplate;
  const payloadFields = eff.fields.filter(notTpl);
  const payloadRules = eff.rules.filter(notTpl);
  const payloadDetails = eff.details.filter(notTpl);
  const payloadMethods = eff.methods.filter(notTpl);
  const payloadComponents = (eff.components || []).filter(notTpl);
  const baseContextExcluded = {
    fields: eff.fields.length - payloadFields.length,
    rules: eff.rules.length - payloadRules.length,
    details: eff.details.length - payloadDetails.length,
    methods: eff.methods.length - payloadMethods.length,
    components: (eff.components || []).length - payloadComponents.length,
  };

  // ---- fields (3-part binding: control + attribute + dataSource) ----
  const rowByContainer = {};
  const nameCount = {};
  const index = eff.items ? new Map(eff.items.map(i => [i.name, i])) : null; // layout tree for F3 routing
  const structural = [];            // tab + tab-grid container inserts (emitted once, only when used)
  const emittedTabs = new Map(); // tab -> resolved parent container for routed fields
  function ensureTab(tab, fromTpl) {
    if (emittedTabs.has(tab)) return emittedTabs.get(tab);
    let parentName;
    if (fromTpl) {
      // F9×F3: a BASE-TEMPLATE tab (e.g. ESNTab) is provided by the Freedom counterpart template —
      // synthesizing a fresh crt.Tab here would duplicate/conflict with it. Route the field to the
      // EXISTING tab and flag placement; never emit a new crt.Tab/grid for a template-owned tab.
      parentName = tab;
      needsDecision.push({ kind: "base-tab-placement", item: tab,
        reason: `payload field(s) target base-template tab '${tab}' — place into the Freedom template's existing equivalent (do NOT create a new tab); confirm the target container` });
    } else {
      // client-owned tab: the page defines it, so we build it. Its grid holds the routed fields.
      parentName = tabGridName(tab);
      structural.push({ operation: "insert", name: tab, parentName: "Tabs", propertyName: "tabs",
        values: { type: "crt.Tab", caption: "$Resources.Strings." + tab + "Caption" } });
      structural.push({ operation: "insert", name: parentName, parentName: tab, propertyName: "items",
        values: { type: "crt.GridContainer" } });
      // no-silent-guess: the classic caption TEXT isn't carried in the model (only hasCaption), so the
      // resource key above is a placeholder — flag it like every other synthesized value in this mapper.
      needsDecision.push({ kind: "tab-caption", item: tab,
        reason: `synthesized caption key '$Resources.Strings.${tab}Caption' — classic caption text not in model; confirm/replace with the real localized string` });
    }
    emittedTabs.set(tab, parentName);
    return parentName;
  }
  for (const f of payloadFields) {
    // F3: route by ancestry (climb the item tree) instead of only recognising Profile/Header.
    let parent;
    const own = index ? resolveOwner(f.parent, index) : { kind: f.parent in CONTAINER ? "profile" : "unresolved", parent: f.parent };
    if (own.kind === "profile") parent = "SideAreaProfileContainer";
    else if (own.kind === "tab") parent = ensureTab(own.tab, own.tabFromTemplate);
    else {
      parent = toContainer(f.parent); // fall back to the flat main container
      needsDecision.push({ kind: "container", item: f.name || f.bindTo,
        reason: `classic container '${own.parent || f.parent}' is not defined by any layer or template — placed in ${parent}; seed the base template (F2) or confirm target tab/group` });
    }
    rowByContainer[parent] = (rowByContainer[parent] || 0) + 1;
    const col = f.bindTo || f.name || "Field";
    const ctl = control(cols[col], f.contentType);
    if (!ctl) needsDecision.push({ kind: "field-control", item: col,
      reason: "no classic contentType and no entity column type — confirm control", suggestion: "crt.Input" });
    const c = ctl || { type: "crt.Input" };
    // #4: unique element name derived from the column; two classic items on one column -> _2, _3 + flag.
    nameCount[col] = (nameCount[col] || 0) + 1;
    const elName = nameCount[col] === 1 ? col : `${col}_${nameCount[col]}`;
    if (nameCount[col] > 1) needsDecision.push({ kind: "duplicate-binding", item: col,
      reason: `column '${col}' bound by multiple classic items — emitted as '${elName}'; confirm which to keep` });
    const values = {
      type: c.type, control: "$" + col, label: "$Resources.Strings." + col,
      labelPosition: c.type === "crt.Checkbox" ? "beside" : "above", visible: true,
      layoutConfig: { column: 1, row: rowByContainer[parent],
        colSpan: parent === "SideAreaProfileContainer" ? 1 : 24, rowSpan: 1 },
    };
    if (c.lookup) { values.listActions = []; values.controlActions = []; }
    if (c.picker) values.pickerType = c.picker;
    if (c.multiline) values.multiline = true;
    viewConfigDiff.push({ operation: "insert", name: elName, values, parentName: parent, propertyName: "items" });
    attributes[col] = { modelConfig: { path: "PDS." + col } };
    pdsColumns[col] = { path: col };
  }

  // ---- rules ----
  const pageBusinessRules = [], entityBusinessRules = [];
  for (const r of payloadRules) {
    if (r.ruleType === "FILTRATION") {
      entityBusinessRules.push({ action: "apply-static-filter", targetAttribute: r.attr,
        filter: r.filterColumn ? { columnPath: r.filterColumn, comparisonType: r.comparison, value: r.value, dataValueType: r.dataValueType } : null,
        conditions: r.conditions, note: "entity-level; filter rooted on target lookup's reference schema; resolve lookup constants via odata-read",
        provenance: r.provenance });
    } else if (r.ruleType === "BINDPARAMETER") {
      const acts = PROP_ACTION[r.property];
      if (!acts) { needsDecision.push({ kind: "rule", item: r.attr, reason: `BINDPARAMETER property '${r.property}' unmapped` }); continue; }
      pageBusinessRules.push({ action: acts[0], element: r.attr, inverseAction: acts[1],
        conditions: r.conditions,
        note: "page-level; ALSO create the inverse rule (opposite condition -> inverseAction)",
        provenance: r.provenance });
    } else {
      // symbolic/unknown ruleType — the enum did not resolve to a number; do NOT guess (would corrupt logic).
      needsDecision.push({ kind: "rule", item: r.attr,
        reason: `rule '${r.attr}' ruleType is '${r.ruleType}' (enum unresolved) — resolve and re-map, do not assume` });
    }
  }

  // ---- details -> "Expanded list" composite spec (full contract; lesson #8) ----
  const details = payloadDetails.map(d => ({
    composite: "Expanded list", entity: d.entitySchemaName, detailSchema: d.schemaName,
    dataSourceScope: "viewElement",
    dependency: d.detailColumn ? { attributePath: d.detailColumn, relationPath: "PDS." + (d.masterColumn || "Id") } : null,
    toolbar: ["add", "refresh", "import-export", "search"],
    note: d.detailColumn ? null : "child FK (detailColumn) not in details block — resolve from detail schema",
  }));

  // ---- methods -> handler stubs (judgment) ----
  const handlerStubs = payloadMethods.map(m => ({ sourceMethod: m.name, category: categorize(m.name), draft: true }));
  for (const m of payloadMethods)
    needsDecision.push({ kind: "method", item: m.name, reason: "imperative logic — implement as Freedom handler or set-values rule; review" });

  // ---- components (charts/widgets) -> B9/B10 ----
  for (const c of payloadComponents)
    needsDecision.push({ kind: "component", item: c.key,
      reason: `module '${c.moduleName || "?"}' (chart/widget) — propose closest standard Freedom component, confirm with user` });

  // ---- removals (B6) — only honor if the removing layer is client-editable ----
  for (const rm of eff.removed) {
    const clientRemoved = clientEditableLayers.has(rm.removedBy);
    needsDecision.push({ kind: "removal", item: rm.name,
      reason: clientRemoved
        ? `client layer '${rm.removedBy}' removed it — remove/hide on Freedom`
        : `removed by '${rm.removedBy}' (not confirmed client-editable) — KEEP on Freedom unless confirmed` });
  }

  return {
    entity: eff.entity,
    // structural (tab + grid containers) first so field inserts resolve their parentName.
    viewConfigDiff: [...structural, ...viewConfigDiff],
    viewModelConfigDiff: [{ operation: "merge", path: ["attributes"], values: attributes }],
    modelConfigDiff: [{ operation: "merge", path: ["dataSources", "PDS", "config", "attributes"], values: pdsColumns }],
    pageBusinessRules, entityBusinessRules, details, handlerStubs, needsDecision,
    // F9: how many effective elements were platform-template context excluded from the payload.
    baseContextExcluded,
  };
}

function categorize(name) {
  const n = name.toLowerCase();
  if (n.startsWith("on") && n.endsWith("changed")) return "attribute-change";
  if (n.includes("init")) return "init";
  if (n.includes("save")) return "save";
  if (n.startsWith("validate")) return "validator?";
  if (n.includes("esq") || n.includes("filter")) return "query/filter";
  if (n.startsWith("set")) return "set-values?";
  return "helper";
}

// Ф3 — Mapper (prototype). Pure Node module: EffectiveClassicPage (from engine.mjs)
// -> Freedom ChangeSet (viewConfigDiff / viewModelConfigDiff / modelConfigDiff + rule specs)
// + needsDecision[] for the judgment 20%. See .migration/solution-design.md §3.3.

// Lesson #6 — structural preservation: target container derives from the SOURCE container role.
const CONTAINER = { ProfileContainer: "SideAreaProfileContainer", Header: "SideAreaProfileContainer" };
const toContainer = (parent) => CONTAINER[parent] || "GeneralInfoTabContainer";

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

  // ---- fields (3-part binding: control + attribute + dataSource) ----
  const rowByContainer = {};
  for (const f of eff.fields) {
    const parent = toContainer(f.parent);
    rowByContainer[parent] = (rowByContainer[parent] || 0) + 1;
    const ctl = control(cols[f.bindTo], f.contentType);
    if (!ctl) needsDecision.push({ kind: "field-control", item: f.bindTo,
      reason: "no classic contentType and no entity column type — confirm control", suggestion: "crt.Input" });
    const c = ctl || { type: "crt.Input" };
    const values = {
      type: c.type, control: "$" + f.bindTo, label: "$Resources.Strings." + f.bindTo,
      labelPosition: c.type === "crt.Checkbox" ? "beside" : "above", visible: true,
      layoutConfig: { column: 1, row: rowByContainer[parent],
        colSpan: parent === "SideAreaProfileContainer" ? 1 : 24, rowSpan: 1 },
    };
    if (c.lookup) { values.listActions = []; values.controlActions = []; }
    if (c.picker) values.pickerType = c.picker;
    if (c.multiline) values.multiline = true;
    viewConfigDiff.push({ operation: "insert", name: f.bindTo, values, parentName: parent, propertyName: "items" });
    attributes[f.bindTo] = { modelConfig: { path: "PDS." + f.bindTo } };
    pdsColumns[f.bindTo] = { path: f.bindTo };
  }

  // ---- rules ----
  const pageBusinessRules = [], entityBusinessRules = [];
  for (const r of eff.rules) {
    if (r.ruleType === "FILTRATION") {
      entityBusinessRules.push({ action: "apply-static-filter", targetAttribute: r.attr,
        note: "entity-level; filter rooted on target lookup's reference schema; resolve lookup constants via odata-read",
        provenance: r.provenance });
    } else if (r.ruleType === "BINDPARAMETER") {
      const acts = PROP_ACTION[r.property];
      if (!acts) { needsDecision.push({ kind: "rule", item: r.attr, reason: `BINDPARAMETER property '${r.property}' unmapped` }); continue; }
      pageBusinessRules.push({ action: acts[0], element: r.attr, inverseAction: acts[1],
        note: "page-level; condition ported from classic; inverse rule required for the opposite condition",
        provenance: r.provenance });
    } else {
      needsDecision.push({ kind: "rule", item: r.attr, reason: `unknown ruleType '${r.ruleType}'` });
    }
  }

  // ---- details -> "Expanded list" composite spec (full contract; lesson #8) ----
  const details = eff.details.map(d => ({
    composite: "Expanded list", entity: d.entitySchemaName, detailSchema: d.schemaName,
    dataSourceScope: "viewElement",
    dependency: d.detailColumn ? { attributePath: d.detailColumn, relationPath: "PDS." + (d.masterColumn || "Id") } : null,
    toolbar: ["add", "refresh", "import-export", "search"],
    note: d.detailColumn ? null : "child FK (detailColumn) not in details block — resolve from detail schema",
  }));

  // ---- methods -> handler stubs (judgment) ----
  const handlerStubs = eff.methods.map(m => ({ sourceMethod: m.name, category: categorize(m.name), draft: true }));
  for (const m of eff.methods)
    needsDecision.push({ kind: "method", item: m.name, reason: "imperative logic — implement as Freedom handler or set-values rule; review" });

  // ---- components (charts/widgets) -> B9/B10 ----
  for (const c of eff.components || [])
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
    viewConfigDiff,
    viewModelConfigDiff: [{ operation: "merge", path: ["attributes"], values: attributes }],
    modelConfigDiff: [{ operation: "merge", path: ["dataSources", "PDS", "config", "attributes"], values: pdsColumns }],
    pageBusinessRules, entityBusinessRules, details, handlerStubs, needsDecision,
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

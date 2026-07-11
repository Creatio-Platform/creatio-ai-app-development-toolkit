// Ф3 — Mapper (prototype). Pure Node module: EffectiveClassicPage (from engine.mjs)
// -> Freedom ChangeSet (viewConfigDiff / viewModelConfigDiff / modelConfigDiff + rule specs)
// + needsDecision[] for the judgment 20%. See .migration/solution-design.md §3.3.

// Lesson #6 — structural preservation: the target container derives from the SOURCE container role.
const PROFILE_CONTAINERS = new Set(["ProfileContainer", "Header"]); // classic → SideAreaProfileContainer
const FLAT_FALLBACK = "GeneralInfoTabContainer"; // where a field lands when its parent chain is unresolvable

// F3 — resolve which Freedom region a field belongs to by CLIMBING the classic item tree from the
// field's parent: hitting Header/ProfileContainer => the side profile; hitting a tab => that tab;
// running off the tree (parent never defined) => unresolved (caller flags + falls back). This is
// what turns the old "everything flattens to one tab" into faithful tab placement.
// `tabTemplateOwned` = the owning tab's DEFINING insert came from a seed layer (so the Freedom template
// already provides it — don't re-synthesize even if a client layer re-captioned it). `groups` = the
// intermediate non-tab containers between the field and its tab (outermost→innermost), which the mapper
// rebuilds as ExpansionPanel (CONTROL_GROUP, itemType 15) / GridContainer, preserving classic grouping
// (e.g. a "Delivery" group) instead of flattening every field into one grid.
function resolveOwner(startParent, index) {
  let parent = startParent, hops = 0; const groups = [];
  while (parent && hops++ < 32) {
    if (PROFILE_CONTAINERS.has(parent)) return { kind: "profile", via: parent, groups: groups.reverse() };
    const p = index.get(parent);
    if (!p) return { kind: "unresolved", parent };
    if (p.isTab) return { kind: "tab", tab: p.name, tabTemplateOwned: !!p.templateOwned, groups: groups.reverse() };
    groups.push(p); // intermediate container between the field and its tab/profile
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

// Шар-3 knowledge: STANDARD Creatio features are REPLACED by their Freedom analog (A3), not rebuilt as
// a generic detail/widget. Matched by classic detail/module/container name. The Freedom analog is named
// descriptively (the exact crt.* component is confirmed on-stand — never fabricated here; E1 lesson).
const FEATURE_CATALOG = {
  VisaDetailV2: { feature: "Approvals", freedom: "Freedom Approvals feature (approval process + list)" },
  FileDetailV2: { feature: "Attachments", freedom: "Freedom Attachments & notes" },
  ActivityDetailV2: { feature: "Activities", freedom: "Freedom Activities / Timeline" },
  EmailDetailV2: { feature: "Emails", freedom: "Freedom Email component" },
};
// header/analytical widgets — recognised by MODULE key and by CONTAINER name.
const WIDGET_BY_MODULE = {
  ActionsDashboardModule: { widget: "ActionDashboard", freedom: "Freedom action dashboard / Next steps" },
  DcmActionsDashboardModule: { widget: "CaseStages (DCM)", freedom: "Freedom case-stage indicator" },
  Timeline: { widget: "Timeline", freedom: "Freedom Timeline" },
};
const WIDGET_BY_CONTAINER = {
  ActionDashboardContainer: { widget: "ActionDashboard", freedom: "Freedom action dashboard / Next steps" },
  DcmActionsDashboardContainer: { widget: "CaseStages (DCM)", freedom: "Freedom case-stage indicator" },
  RecommendationModuleContainer: { widget: "Recommendations", freedom: "Freedom recommendations widget" },
  DuplicatesWidgetContainer: { widget: "Duplicates", freedom: "Freedom duplicates widget" },
  ESNFeedContainer: { widget: "Feed (ESN)", freedom: "Freedom Feed" },
};
// standard card actions (from the classic ACTIONS menu / toolbar) -> Freedom card actions (B7).
const KNOWN_ACTION_ITEMS = new Set([
  "PrintButton", "ProcessButton", "ViewOptionsButton", "TagButton", "ReloadDataButton",
]);

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
  const notTpl = (x) => !x.fromTemplate;                          // keyed categories + removals
  const payloadFields = eff.fields.filter(f => !f.templateOwned); // diff-items: by INSERT origin (C6)
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
  const index = new Map((eff.items || []).map(i => [i.name, i])); // layout tree for F3 routing (never null)
  const structural = [];            // tab + tab-grid container inserts (emitted once, only when used)
  const emittedTabs = new Map(); // tab -> resolved parent container for routed fields
  function ensureTab(tab, templateOwned) {
    if (emittedTabs.has(tab)) return emittedTabs.get(tab);
    let parentName;
    if (templateOwned) {
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
  const emittedGroups = new Map(); // group name -> inner container fields route into (emitted once)
  function ensureGroup(g, parentName) {
    if (emittedGroups.has(g.name)) return emittedGroups.get(g.name);
    let inner;
    if (g.itemType === 15) {
      // CONTROL_GROUP -> collapsible crt.ExpansionPanel wrapping a grid (e.g. the "Delivery" group).
      structural.push({ operation: "insert", name: g.name, parentName, propertyName: "items",
        values: { type: "crt.ExpansionPanel", caption: "$Resources.Strings." + g.name + "Caption", collapsible: true } });
      inner = g.name + "Grid";
      structural.push({ operation: "insert", name: inner, parentName: g.name, propertyName: "items",
        values: { type: "crt.GridContainer" } });
      needsDecision.push({ kind: "group-caption", item: g.name,
        reason: `synthesized ExpansionPanel caption '$Resources.Strings.${g.name}Caption' for classic group — confirm/replace with the real localized string` });
    } else {
      // GRID_LAYOUT / generic structural container -> crt.GridContainer.
      inner = g.name;
      structural.push({ operation: "insert", name: inner, parentName, propertyName: "items",
        values: { type: "crt.GridContainer" } });
    }
    emittedGroups.set(g.name, inner);
    return inner;
  }
  // Pre-resolve every field's owner once, so we can DETECT the header layout type before routing.
  const resolved = payloadFields.map(f => ({ f, own: resolveOwner(f.parent, index) }));
  // Moment 1 — layout type: classic `Header` fields spanning >1 grid column == a WIDE multi-column
  // header (like Contract), NOT the narrow left profile island. In that case route them to a full-width
  // header GridContainer (preserving the multi-column grid) instead of cramming them into colSpan-1.
  const headerCols = new Set(resolved
    .filter(r => r.own.kind === "profile" && r.own.via === "Header" && r.f.layout && r.f.layout.column != null)
    .map(r => r.f.layout.column));
  const headerIsWide = headerCols.size > 1;
  if (headerIsWide) {
    structural.push({ operation: "insert", name: "HeaderContainer", parentName: "Header", propertyName: "items",
      values: { type: "crt.GridContainer" } });
    needsDecision.push({ kind: "layout-type", item: "Header",
      reason: `classic Header is a WIDE ${headerCols.size}-column block, not the default left profile island — mapped to a full-width header grid; confirm the target Freedom page uses a header region (no left profile) and the column layout` });
  }
  const profileRegion = (own) => (own.via === "Header" && headerIsWide) ? "HeaderContainer" : "SideAreaProfileContainer";
  for (const { f, own } of resolved) {
    // F3: route by ancestry (climb the item tree) instead of only recognising Profile/Header.
    let parent;
    if (own.kind === "profile") parent = profileRegion(own);
    else if (own.kind === "tab") {
      parent = ensureTab(own.tab, own.tabTemplateOwned);
      // C5 build-out: rebuild each classic group as ExpansionPanel/GridContainer, nested, and route the
      // field into the innermost. Only for client-owned tabs; base tabs stay flat (base-tab-placement).
      if (!own.tabTemplateOwned) for (const g of own.groups) parent = ensureGroup(g, parent);
    } else {
      parent = FLAT_FALLBACK; // parent chain unresolvable
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
    // Moment 1 — preserve the classic grid coordinates (24-col grid, 0-based) instead of inventing them;
    // classic column N -> Freedom column N+1. Fall back to sequential/full-width only when absent.
    const cl = f.layout || {};
    const narrow = parent === "SideAreaProfileContainer";
    const layoutConfig = {
      column: cl.column != null ? cl.column + 1 : 1,
      row: cl.row != null ? cl.row + 1 : rowByContainer[parent],
      colSpan: cl.colSpan != null ? cl.colSpan : (narrow ? 1 : 24),
      rowSpan: cl.rowSpan != null ? cl.rowSpan : 1,
    };
    const values = {
      type: c.type, control: "$" + col, label: "$Resources.Strings." + col,
      labelPosition: c.type === "crt.Checkbox" ? "beside" : "above", visible: true, layoutConfig,
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
      const filter = r.filterColumn
        ? { columnPath: r.filterColumn, comparisonType: r.comparison ?? null, value: r.value ?? null, dataValueType: r.dataValueType ?? null }
        : null;
      // Gap 4: a "static" filter needs a comparison AND a constant value. Many FILTRATIONs are dynamic
      // (filter by another column / macro) → no constant here; don't present a half-filter as complete.
      const complete = !!(filter && typeof r.comparison === "number" && r.value !== null && r.value !== undefined);
      entityBusinessRules.push({ action: "apply-static-filter", targetAttribute: r.attr, filter, complete,
        conditions: r.conditions, note: "entity-level; filter rooted on target lookup's reference schema; resolve lookup constants via odata-read",
        provenance: r.provenance });
      if (!complete) needsDecision.push({ kind: "entity-filter", item: r.attr,
        reason: `FILTRATION on '${r.attr}' has no resolved static value (dynamic / column-reference / macro filter) — resolve the target column, comparison and value (or column ref) before applying` });
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
  // C4: a rule whose target column has NO field insert in this ChangeSet (its field is template context
  // excluded from payload, or an entity-only column) would dangle on a non-existent element — flag it.
  const emittedCols = new Set(payloadFields.map(f => f.bindTo || f.name));
  const ruleTargets = new Set(
    [...pageBusinessRules.map(r => r.element), ...entityBusinessRules.map(r => r.targetAttribute)].filter(Boolean));
  for (const t of ruleTargets) if (!emittedCols.has(t))
    needsDecision.push({ kind: "rule-target-missing", item: t,
      reason: `business rule targets '${t}' but no field for it is inserted (base/template field or entity-only column) — ensure the Freedom target provides the element` });

  // ---- details: STANDARD features (A3 → Freedom analog) vs genuine custom details (Expanded list) ----
  const details = [];              // genuine custom details
  const standardFeatures = [];     // Approvals/Attachments/Activities/Emails → their Freedom feature
  for (const d of payloadDetails) {
    // place the detail in its owning TAB (ancestry-resolved), preserving order.
    const own = d.parent ? resolveOwner(d.parent, index) : { kind: "unresolved" };
    const tab = own.kind === "tab" ? own.tab : (own.kind === "profile" ? profileRegion(own) : null);
    const feat = FEATURE_CATALOG[d.schemaName];
    if (feat) {
      // Moment 2/3: this is a standard Creatio feature — replace with its Freedom analog, don't rebuild.
      standardFeatures.push({ feature: feat.feature, freedom: feat.freedom, classicDetail: d.schemaName, entity: d.entitySchemaName, tab });
      needsDecision.push({ kind: "standard-feature", item: d.schemaName,
        reason: `classic '${d.schemaName}' is the ${feat.feature} feature → use ${feat.freedom} (A3 replacement, NOT a generic detail); confirm the exact Freedom component + wiring` });
      continue;
    }
    if (!tab) needsDecision.push({ kind: "detail-placement", item: d.schemaName || d.key,
      reason: `could not resolve which tab detail '${d.key}' belongs to (parent '${d.parent || "?"}' unresolved) — confirm target tab` });
    // editability (view-only vs add/edit/delete) is NOT reliably on the master — it lives in the detail's
    // OWN config/schema. Do NOT hardcode an "add" toolbar; leave it unresolved + flag it.
    needsDecision.push({ kind: "detail-editability", item: d.schemaName || d.key,
      reason: `allowed detail actions (view-only vs add/edit/delete) not determinable from the master — resolve from the detail's own config (B2 recursion) or confirm` });
    details.push({
      composite: "Expanded list", entity: d.entitySchemaName, detailSchema: d.schemaName,
      tab, order: d.order ?? null, dataSourceScope: "viewElement",
      dependency: d.detailColumn ? { attributePath: d.detailColumn, relationPath: "PDS." + (d.masterColumn || "Id") } : null,
      actions: "unresolved",
      note: d.detailColumn ? null : "child FK (detailColumn) not in details block — resolve from detail schema",
    });
  }

  // ---- Moment 4: header/analytical widgets → Freedom analogs (base-provided are NOTED, not dropped) ----
  const widgets = [];
  const seenWidget = new Set();
  const addWidget = (w, classic, base) => { if (w && !seenWidget.has(w.widget)) { seenWidget.add(w.widget);
    widgets.push({ widget: w.widget, freedom: w.freedom, classic, base: !!base });
    needsDecision.push({ kind: "widget", item: w.widget,
      reason: `${w.widget}${base ? " (base-provided)" : ""} → ${w.freedom}${base ? " — usually provided by the Freedom template; confirm or re-apply any customization" : "; confirm the Freedom component"}` }); } };
  for (const c of (eff.components || [])) addWidget(WIDGET_BY_MODULE[c.key] || WIDGET_BY_MODULE[c.moduleName], c.key, c.fromTemplate);
  for (const i of (eff.items || [])) addWidget(WIDGET_BY_CONTAINER[i.name], i.name, i.templateOwned);

  // ---- Moment 5: card actions / ACTIONS menu → Freedom card actions (B7) ----
  const cardActions = (eff.items || []).filter(i => KNOWN_ACTION_ITEMS.has(i.name)).map(i => i.name);
  const hasGetActions = (eff.methods || []).some(m => m.name === "getActions" && !m.fromTemplate);
  if (cardActions.length || hasGetActions) needsDecision.push({ kind: "card-action", item: "ACTIONS",
    reason: `card actions / ACTIONS-menu (${cardActions.join(", ") || "getActions"}) → Freedom card actions (B7); standard menu items (Set up access rights / Send for approval / Follow the feed) and Print/View to wire — action bodies live in getActions (imperative, needs review)` });

  // ---- charts/widgets not in the catalog -> B9/B10 (generic) ----
  for (const c of payloadComponents)
    if (!(WIDGET_BY_MODULE[c.key] || WIDGET_BY_MODULE[c.moduleName])) needsDecision.push({ kind: "component", item: c.key,
      reason: `module '${c.moduleName || "?"}' (chart/widget) — propose closest standard Freedom component, confirm with user` });

  // ---- methods -> handler stubs (judgment) ----
  const handlerStubs = payloadMethods.map(m => ({ sourceMethod: m.name, category: categorize(m.name), draft: true }));
  for (const m of payloadMethods)
    needsDecision.push({ kind: "method", item: m.name, reason: "imperative logic — implement as Freedom handler or set-values rule; review" });

  // ---- removals (B6) — client removals only; template-internal removes are context (F9, C3) ----
  for (const rm of eff.removed.filter(notTpl)) {
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
    // standard Creatio features replaced by their Freedom analog (A3) — NOT generic details.
    standardFeatures,
    // header/analytical widgets recognised → Freedom analogs (base-provided flagged).
    widgets,
    // card actions / ACTIONS-menu items to wire as Freedom card actions (B7).
    cardActions,
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

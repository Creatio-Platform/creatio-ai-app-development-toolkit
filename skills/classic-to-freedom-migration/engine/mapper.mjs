// Mapper. Pure Node module: EffectiveClassicPage (from engine.mjs)
// -> Freedom ChangeSet (viewConfigDiff / viewModelConfigDiff / modelConfigDiff + rule specs)
// + needsDecision[] for the judgment 20%.
import { VIEW_ITEM_TYPE, CONTENT_TYPE, resourceKey } from "./engine.mjs";

// Lesson #6 — structural preservation: the target container derives from the SOURCE container role.
// Classic left-profile / module area → Freedom SideAreaProfileContainer. `LeftModulesContainer` is the
// BaseModulePageV2 LEFT area that holds the profile islands (e.g. ContactContainer): a field nested
// under it (field → ContactContainer → LeftModulesContainer) must resolve to the profile, NOT collapse
// into a fallback tab. Adding it here is what routes those island fields to the side profile once the
// base template is seeded (#18). Header stays separate (a WIDE header block → HeaderContainer, below).
const PROFILE_CONTAINERS = new Set(["ProfileContainer", "Header", "LeftModulesContainer"]); // classic → SideAreaProfileContainer
const FLAT_FALLBACK = "GeneralInfoTabContainer"; // where a field lands when its parent chain is unresolvable

// RV14 — the profile/left area is a STRUCTURAL role, not a fixed name. The known-name set above kept missing
// per-template variants (LeftModulesContainer was added after #18; CasePageV2's base uses `LeftContainer`).
// Derive it instead: a top-level base-template container (no parent, templateOwned) that is NOT a tab and NOT
// the tabs panel IS the side-profile anchor, whatever its name. A tabbed field returns at its tab before ever
// climbing this high, so reaching a top-level non-tabs container means the field belongs to the side profile.
// Union with the literal set so seed-less/fallback runs keep the old behaviour.
function deriveProfileAnchors(items) {
  const list = items || [];
  const anchors = new Set(PROFILE_CONTAINERS);
  const tabPanels = new Set(list.filter(i => i.isTab).map(i => i.parent).filter(Boolean)); // holders of tab children
  for (const i of list)
    if (!i.parent && i.templateOwned && !i.isTab && !i.bindTo && !tabPanels.has(i.name)) anchors.add(i.name);
  return anchors;
}

// F3 — resolve which Freedom region a field belongs to by CLIMBING the classic item tree from the
// field's parent: hitting Header/ProfileContainer => the side profile; hitting a tab => that tab;
// running off the tree (parent never defined) => unresolved (caller flags + falls back). This is
// what turns the old "everything flattens to one tab" into faithful tab placement.
// `tabTemplateOwned` = the owning tab's DEFINING insert came from a seed schema (so the Freedom template
// already provides it — don't re-synthesize even if a client schema re-captioned it). `groups` = the
// intermediate non-tab containers between the field and its tab (outermost→innermost), which the mapper
// rebuilds as ExpansionPanel (CONTROL_GROUP, itemType 15) / GridContainer, preserving classic grouping
// (e.g. a "Delivery" group) instead of flattening every field into one grid.
function resolveOwner(startParent, index, profileAnchors = PROFILE_CONTAINERS) {
  let parent = startParent, hops = 0; const groups = [];
  while (parent && hops++ < 32) {
    if (profileAnchors.has(parent)) return { kind: "profile", via: parent, groups: [...groups].reverse() };
    const p = index.get(parent);
    // `why` distinguishes the two unresolved causes so the caller's flag is accurate (#18): the ancestor
    // name is not defined by ANY schema/template (missing seed) vs the chain is fully defined but never
    // reaches a profile/tab anchor (climbed to the page root — a wrong/incomplete seed).
    if (!p) return { kind: "unresolved", parent, why: "undefined-parent" };
    if (p.isTab) return { kind: "tab", tab: p.name, tabTemplateOwned: !!p.templateOwned, groups: [...groups].reverse() };
    groups.push(p); // intermediate container between the field and its tab/profile
    parent = p.parent;
  }
  return { kind: "unresolved", parent: startParent, why: "no-anchor" };
}
const tabGridName = (tab) => `${tab}Grid`;

// entity column dataType -> Freedom control (the DATA type decides the control).
function scalarControl(t) {
  // Keyed to what get-entity-schema-properties ACTUALLY returns (verified on-stand): most types arrive by
  // NAME (Boolean/DateTime/Integer/Float/Money/ShortText/MediumText/LongText/MaxSizeText/RichText), but Date
  // arrives as the numeric code "8". (Earlier phantom codes 27/28/29/30/32 were never emitted — text came by
  // name, so those columns wrongly fell to null.) Genuinely unknown codes (18=Color, 44=URL, 31, …) stay null.
  if (t === "boolean") return { type: "crt.Checkbox" };
  if (t === "datetime") return { type: "crt.DateTimePicker", picker: "datetime" };
  if (t === "date" || t === "8") return { type: "crt.DateTimePicker", picker: "date" };
  if (["integer", "decimal", "float", "money"].includes(t)) return { type: "crt.NumberInput" };
  if (["longtext", "maxsizetext", "richtext"].includes(t)) return { type: "crt.Input", multiline: true };
  if (["text", "shorttext", "mediumtext"].includes(t)) return { type: "crt.Input" };
  return null; // unknown scalar -> caller flags needsDecision (loud)
}
// control = the DATA type first; the classic `contentType` is only a PAGE control HINT, not the data type.
// It forces a lookup ONLY when the column really is one (has a `ref`) or when we have no entity type at all
// (fallback). A contentType-5 hint on a KNOWN scalar column with NO ref is NOT a lookup — the classic page just
// rendered a scalar via a picker, which is a read-only VALUE FROM A LINKED RECORD (linkedDisplay): keep the real
// data type (Email/Phone/Text) and flag the linked-value intent instead of mislabelling the control as a lookup.
function control(dataType, contentType, ref) {
  // `dataType` is tool/agent-assembled JSON — it can arrive as a NUMBER (this code expects Date as the
  // numeric code 8; see scalarControl). `(dataType || "").toLowerCase()` throws a TypeError on a number,
  // which escapes mapToFreedom → runMigration (called with no try/catch in migrate.mjs) and breaks the
  // documented "runMigration does NOT throw" contract. Coerce with String() first — mirrors fieldTypeLabel.
  const t = String(dataType ?? "").toLowerCase();
  if (t === "lookup") return { type: "crt.ComboBox", lookup: true };
  const scalar = scalarControl(t);
  if (contentType === CONTENT_TYPE.LOOKUP) {
    if (ref || !scalar) return { type: "crt.ComboBox", lookup: true }; // real lookup, or no entity type -> trust the hint
    return { ...scalar, linkedDisplay: true }; // scalar shown via a picker -> read-only value from a linked record
  }
  return scalar; // null -> caller emits a field-control decision
}

// Short, human data-type label for the design-spec Type column. Lookups are flagged by `ctl.lookup` (the
// caller adds the referenced object separately); email/phone are inferred from the column name (Creatio
// stores them as text); text carries its length when the column metadata provides it.
function fieldTypeLabel(col, meta, ctl) {
  if (ctl.lookup) return "Lookup";
  const t = String(meta.type || "").toLowerCase();
  if (/email/i.test(col)) return "Email";
  if (/phone|mobile/i.test(col)) return "Phone";
  if (ctl.type === "crt.Checkbox" || t === "boolean") return "Boolean";
  if (ctl.picker === "datetime" || t === "datetime") return "Date/time";
  if (ctl.picker === "date" || t === "date" || t === "8") return "Date";
  if (t === "integer") return "Integer";
  if (["decimal", "float", "money"].includes(t)) return "Decimal";
  if (ctl.multiline) return t === "richtext" ? "Rich text" : "Long text";
  return meta.length ? `Text (${meta.length})` : "Text";
}

// BINDPARAMETER property -> [action, inverseAction] (rules are one-way -> always emit the inverse)
const PROP_ACTION = {
  Required: ["make-required", "make-optional"],
  Readonly: ["make-read-only", "make-editable"],
  Enabled: ["make-editable", "make-read-only"],
  Visible: ["show-element", "hide-element"],
};

// Standard-feature knowledge: STANDARD Creatio features are REPLACED by their Freedom analog (A3), not rebuilt as
// a generic detail/widget. Matched by classic detail/module/container name. The Freedom analog is named
// descriptively (the exact crt.* component is confirmed on-stand — never fabricated here; E1 lesson).
// `templateProvided` = most Freedom FORM templates already ship this component → account for it / merge
// onto the existing one, do NOT create a new one (#7).
// `uiShape` distinguishes how the feature RENDERS (for the design-spec Layout table): `list` = it looks
// like a regular related list (Activities/Emails — same UI as any child list); `component` = a distinct
// native Freedom component with its own UI (Approvals, Attachments). This drives whether the spec marks it
// "Related list" vs the component name — the two are NOT visually interchangeable.
const FEATURE_CATALOG = {
  // A Creatio "Visa" IS an approval/sign-off. Its records live in a `*Visa` entity (e.g. ApplicantVisa,
  // inheriting BaseVisa) with an FK to the master record — that data shape IS how Approvals is stored, so
  // "it's just a related list over ApplicantVisa filtered by the master" is NOT evidence against Approvals.
  // Do not downgrade VisaDetailV2 to a generic Expanded-list on that reasoning (a real agent did, wrongly).
  VisaDetailV2: { feature: "Approvals", freedom: "Freedom Approvals = TWO components (approval module + approval list)", uiShape: "component",
    note: "Creatio Visa = an approval/sign-off; its records living in a `*Visa` entity (ApplicantVisa) with an FK to the master is exactly how Approvals is stored — that structure is NOT a reason to reclassify it as a plain related list. Approvals renders as TWO components — read get-component-info for the approval set and add BOTH: (1) the approval MODULE/widget as a SEPARATE container placed ABOVE the profile island, and (2) the approval LIST. Adding only the list is INCOMPLETE. Keep it as the Approvals feature unless you confirm on-stand it does not use the visa/approval infrastructure." },
  FileDetailV2: { feature: "Attachments", freedom: "Freedom Attachments & notes", templateProvided: true, uiShape: "component" },
  // Activities and Emails are FILTERED RELATED LISTS (uiShape "list") — a DataGrid of the child records
  // filtered to the master record, the SAME UI as any other child list. They are NOT the Freedom Timeline
  // (an aggregate chronological feed; a separate classic component mapped via WIDGET_BY_MODULE.Timeline) and
  // Emails is NOT the email-client component. A real agent rebuilt these as a Timeline — do not conflate the
  // list feature with the Timeline widget (#6).
  ActivityDetailV2: { feature: "Activities", freedom: "Freedom related list of Activity (Task) records, filtered to the master", uiShape: "list",
    note: "Activities = a plain FILTERED RELATED LIST of Activity/Task records (a DataGrid filtered by the master FK) — NOT a Timeline and NOT an aggregate activity feed. Build it as a related list, exactly like any other child list." },
  EmailDetailV2: { feature: "Emails", freedom: "Freedom related list of Email activities, filtered to the master", uiShape: "list",
    note: "Emails = a plain FILTERED RELATED LIST of Email records (a DataGrid filtered by the master) — NOT a Timeline and NOT the email-client component. Build it as a related list." },
  // Means-of-communication ("Средства связи контакта" / ContactCommunication) is the NATIVE Communication-options
  // component, NOT a generic list. A real agent downgraded it to a plain Expanded-list because the composite
  // needed the CrtCustomer360App package — that fallback is wrong (loses the add-by-type UI, type icons, dedup).
  ContactCommunicationDetail: { feature: "Communication options", freedom: "Freedom Communication-options component (crt.ContactCommunication)", uiShape: "component",
    note: "means of communication = the NATIVE Communication-options component (crt.ContactCommunication) — read get-component-info for its contract/wiring; it may require the CrtCustomer360App package. Do NOT downgrade it to a plain Expanded-list/DataGrid over ContactCommunication (that loses the typed add-communication UI). If the component/package is unavailable on the stand, that is a decision to RAISE (add the dependency, or confirm the fallback) — not a silent grid." },
};
// Match a classic detail schema to a standard feature by exact name OR entity-prefixed suffix — e.g.
// `ApplicantEmailDetailV2` → `EmailDetailV2`, `ApplicantVisaDetail` → (no)…: prefixed variants of the
// standard details were previously missed and fell through as generic details (then dropped). (#6/#11)
function matchFeature(schemaName) {
  if (!schemaName) return null;
  if (FEATURE_CATALOG[schemaName]) return FEATURE_CATALOG[schemaName];
  const key = Object.keys(FEATURE_CATALOG).find(k => schemaName.endsWith(k));
  return key ? FEATURE_CATALOG[key] : null;
}
// Freedom grid model (the confirmed target convention): the left profile island is a SINGLE-column grid;
// tab/group containers are TWO columns. Classic pages use a 24-column grid, so classic field coordinates are
// CONVERTED into the target grid (see layoutConfig below) — NOT dumped verbatim. Dumping classic 24-col
// coordinates into a native 2-col Freedom container overflows (e.g. column 13 in a 2-track grid) and breaks
// the input layout — the recurring "input grid broken" build defect.
const GRID_2 = ["minmax(32px, 1fr)", "minmax(32px, 1fr)"];
const GRID_1 = ["minmax(32px, 1fr)"];
// a genuinely WIDE multi-column classic Header block (>1 col, flagged as a layout-type decision) keeps the
// full 24-col grid so its multi-column arrangement survives 1:1.
const GRID_24 = Array.from({ length: 24 }, () => "minmax(32px, 1fr)");
// header/analytical widgets — recognised by MODULE key and by CONTAINER name. Catalog values are ARRAYS of
// Freedom component-defs, because one classic module can map to MORE THAN ONE Freedom component.
// Action Dashboard in Freedom is TWO components — a case-stage PROGRESS BAR and a NEXT STEPS panel — and the
// default form template ships NEITHER: both must be ADDED when the object has a configured DCM case. The
// progress bar goes on the page top; Next steps goes in a NEW tab in the tab container, next to Feed. Both
// auto-populate from the object's case (do not hand-author stages/steps). No case on the object ⇒ nothing to add.
const DCM_CHECK = "Check the object's case on-stand: SysSchema WHERE ManagerName='DcmSchemaManager' (NOT 'CaseSchemaManager' — wrong name, returns 0 = false 'no case'); a hit for this entity ⇒ add it, no hit ⇒ nothing to add. A case can exist even if the classic page tracked stage only via a Stage lookup + history detail.";
const DCM_PROGRESS_NOTE = "Case-stage progress bar (crt.EntityStageProgressBar) — NOT in the default Freedom form template. When the object has a DCM case, PREFER building the form page from `PageWithTabsAndProgressBarTemplate` (it ships the bar placed) and RE-BIND the new page to your entity, rather than hand-adding the widget. FALLBACK (already on a no-bar template / page exists): PLACE IT in `MainContainer` (the content container below the header), at the TOP of the content — NOT in `MainHeader`, and not as a bare child of `Main`. It auto-populates from the object's case (do not hand-author stages). " + DCM_CHECK;
const DCM_NEXTSTEPS_NOTE = "Next steps (crt.NextSteps) — NOT in the default Freedom form template; ADD it as a TAB in the card toggle panel BESIDE the Feed and Attachments tabs when the object has a configured DCM case. Build the tab like Feed/Attachments: caption via `#ResourceString(Key)#` (NOT $Resources.Strings.*), set the tab icon to `flag-icon` (do not guess — an invented name renders empty), put the header (Label + '+' menu button) in the tab's `tools` slot and the widget in `items`. It auto-populates from the object's case (do not hand-author steps). " + DCM_CHECK;
const DCM_PROGRESS = { widget: "Case progress bar", freedom: "Freedom case-stage progress bar (page top)", note: DCM_PROGRESS_NOTE, placement: "page-top" };
const DCM_NEXTSTEPS = { widget: "Next steps", freedom: "Freedom Next steps panel (new tab next to Feed)", note: DCM_NEXTSTEPS_NOTE, placement: "tab-next-to-feed" };
const WIDGET_BY_MODULE = {
  DcmActionsDashboardModule: [DCM_PROGRESS, DCM_NEXTSTEPS], // DCM case dashboard → BOTH Freedom components
  ActionsDashboardModule: [DCM_NEXTSTEPS],
  Timeline: [{ widget: "Timeline", freedom: "Freedom Timeline" }],
};
const WIDGET_BY_CONTAINER = {
  DcmActionsDashboardContainer: [DCM_PROGRESS, DCM_NEXTSTEPS],
  ActionDashboardContainer: [DCM_NEXTSTEPS],
  RecommendationModuleContainer: [{ widget: "Recommendations", chrome: true, freedom: "Freedom product-selection / NBO recommendations component",
    note: "Inherited base-template container (from BasePageV2) — inserted EMPTY (items:[], no `visible` binding) and filled at RUNTIME by the RecommendationModuleUtilities mixin. It shows the Next-Best-Offer (NBO) / product recommendations (RecommendedProduct) only if recommendation rules are configured for the entity; the page schema can't say whether it's used. Check on-stand: does the LIVE Classic page actually render recommendations (are NBO/recommendation rules configured for this entity)? If yes → wire the Freedom product-selection / recommendations component; if it renders empty → inherited chrome, drop it." }],
  DuplicatesWidgetContainer: [{ widget: "Duplicates", freedom: "Freedom duplicates widget" }],
  ESNFeedContainer: [{ widget: "Feed (ESN)", freedom: "Freedom Feed" }],
};
// standard card actions (from the classic ACTIONS menu / toolbar) -> Freedom card actions (B7).
const KNOWN_ACTION_ITEMS = new Set([
  "PrintButton", "ProcessButton", "ViewOptionsButton", "TagButton", "ReloadDataButton",
]);

export function mapToFreedom(eff, opts = {}) {
  const cols = opts.entityColumns || {};       // { column: dataType }
  const clientEditableSchemas = new Set(opts.clientEditableSchemas || []); // for B6 removals
  // #5/#13 — localizable strings from the manifest (page + detail resources). Lets the mapper resolve a
  // classic `Resources.Strings.X` caption to its real localized text instead of shipping an opaque key.
  const resources = opts.resources || {};
  const resolveText = (raw) => {
    if (!raw) return null;
    const key = resourceKey(raw);
    return resources[key] ?? resources[raw] ?? null;
  };
  // Produce a Freedom caption VALUE from a classic caption reference: the resolved literal text if the
  // manifest carries the string, else the `$`-binding as-is, else a synthesized key from the fallback
  // name. `resolved` gates whether the caller still flags it for manual resolution (#5/#13).
  // Major 4 — user-visible text on the page must be a LOCALIZABLE BINDING, never an inline literal (clio
  // rejects hardcoded page text; AGENTS.md). So a caption returns the `$Resources.Strings.<key>` BINDING for
  // the page body, plus the display `text` for the PLAN ONLY, registered in `resourceStrings` so the agent
  // knows what to author. `key` = the ORIGINAL classic resource key when the schema had one, else a
  // synthesized `<name>Caption`. `resolved` = the text is known (no manual decision needed).
  const resourceStrings = {}; // resource key -> default-language text: the map the agent registers at build
  const captionKey = (raw, fallbackName) => raw
    ? resourceKey(raw)
    : (fallbackName || "") + "Caption";
  const caption = (raw, fallbackName) => {
    const key = captionKey(raw, fallbackName);
    const text = resolveText(raw) ?? resolveText((fallbackName || "") + "Caption");
    if (text != null) resourceStrings[key] = text;
    return { binding: "$Resources.Strings." + key, text, key, resolved: text != null, synthesized: !raw };
  };
  // #11(ii)/B2 — parsed detail-schema info { name: { entity, columns } } from the manifest, so a detail's
  // real child entity + list columns are known (and auto-named SchemaNDetail details get resolved).
  const detailSchemas = opts.detailSchemas || {};
  // #5/#13 (fields) — entity column TITLES { column: "Mobile phone" } from get-entity-schema-properties, so a field's
  // LABEL is the human title, not the raw column code. Falls back to the page resources, then the code.
  const columnTitles = opts.columnTitles || {};
  // entityColumns entries may be a plain dataType STRING (back-compat) OR an object { type, length, ref, title }
  // (from get-entity-schema-properties) — the richer form lets the design-spec Type column show "Text (250)" and a
  // lookup's referenced object "Lookup (Contact)".
  const colMeta = (col) => { const v = cols[col]; return (v && typeof v === "object") ? v : { type: v || null }; };
  const labelFor = (col) => columnTitles[col] ?? resolveText(col) ?? resolveText(col + "Caption") ?? colMeta(col).title ?? null;
  const needsDecision = [];
  const accountedFor = new Set();

  // F9: migrate only the page's OWN content, not the platform template chain seeded for layout.
  // `fromTemplate` elements (e.g. BaseEntityPage's framework methods, base-template details) are
  // context — kept in eff.items for ancestry routing, but excluded from the payload. The full layout
  // tree (index below) still uses ALL items so base containers resolve. `baseContextExcluded` reports
  // the counts so the exclusion is transparent, not silent.
  const notTpl = (x) => !x.fromTemplate;                          // keyed categories + removals
  const payloadFields = eff.fields.filter(f => !f.templateOwned); // diff-items: by INSERT origin (C6)
  // Blocker — a base (template-owned) field a CLIENT schema RECONFIGURED (merge/move: hid it, moved it, …) is
  // excluded from the payload as template context, so its client override would silently vanish and the gate
  // stayed green. Surface each as a decision: the Freedom template provides the field, but the client's
  // customization (the reconcile delta) must be re-applied to it — never shipped as the bare template default.
  for (const f of eff.fields.filter(f => f.templateOwned && f.schemaTouched)) {
    const changes = [f.visible === false ? "hidden" : null, f.layout ? "moved/re-laid-out" : null].filter(Boolean).join(", ") || "reconfigured";
    needsDecision.push({ kind: "base-field-override", item: f.bindTo || f.name,
      reason: `base field '${f.bindTo || f.name}' is provided by the Freedom template, but a client schema ${changes} it — the parallel-analog build does NOT re-create base fields, so APPLY this customization onto the Freedom base field. Do not silently ship the template default.` });
  }
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

  const index = new Map((eff.items || []).map(i => [i.name, i])); // layout tree for F3 routing (never null)
  const profileAnchors = deriveProfileAnchors(eff.items);         // RV14 — structural side-profile anchors
  const ctx = { eff, cols, resources, resolveText, caption, detailSchemas, columnTitles, colMeta, labelFor,
    index, profileAnchors, payloadFields, payloadDetails };
  // ---- fields (3-part binding) routed into a shared container builder (tabs/groups/islands, emitted once) ----
  const containers = createContainers(ctx);
  const F = mapFields(ctx, containers);
  F.needsDecision.forEach(d => needsDecision.push(d));
  F.accountedFor.forEach(a => accountedFor.add(a));

  // ---- rules ----
  const _r = mapRules(payloadRules, payloadFields);
  const { pageBusinessRules, entityBusinessRules } = _r;
  _r.needsDecision.forEach(d => needsDecision.push(d));

  // ---- details: STANDARD features (A3 → Freedom analog) vs genuine custom details (Expanded list) ----
  const D = mapDetails(ctx, containers, F.profileRegion);
  D.needsDecision.forEach(d => needsDecision.push(d));
  D.accountedFor.forEach(a => accountedFor.add(a));

  // ---- Moment 4: header/analytical widgets → Freedom analogs (base-provided are NOTED, not dropped) ----
  const _w = mapWidgets(eff);
  const { widgets, chromeWidgets } = _w;
  _w.needsDecision.forEach(d => needsDecision.push(d));
  _w.accountedFor.forEach(a => accountedFor.add(a));

  // ---- image / photo components (generator-based, no bindTo) → Freedom image component ----
  const _img = mapImages(eff);
  const images = _img.images;
  _img.needsDecision.forEach(d => needsDecision.push(d));
  _img.accountedFor.forEach(a => accountedFor.add(a));

  // ---- Moment 5: card actions / ACTIONS menu → Freedom card actions (B7) ----
  const _ca = mapCardActions(eff);
  const cardActions = _ca.cardActions;
  _ca.needsDecision.forEach(d => needsDecision.push(d));
  _ca.accountedFor.forEach(a => accountedFor.add(a));

  // feature toggles / charts / methods → handler stubs / removals / referenced modules
  const _rl = mapRemainingLogic(eff, payloadMethods, payloadComponents, clientEditableSchemas);
  const handlerStubs = _rl.handlerStubs;
  _rl.needsDecision.forEach(d => needsDecision.push(d));

  // ---- Fix 2: LOUD unmapped-component drop ----
  const _drop = mapUnmappedDrop(eff, accountedFor);
  _drop.needsDecision.forEach(d => needsDecision.push(d));

  return {
    entity: eff.entity,
    // structural (tab + grid containers) first so field inserts resolve their parentName.
    viewConfigDiff: [...containers.structural, ...F.viewConfigDiff],
    viewModelConfigDiff: [{ operation: "merge", path: ["attributes"], values: F.attributes }],
    modelConfigDiff: [{ operation: "merge", path: ["dataSources", "PDS", "config", "attributes"], values: F.pdsColumns }],
    pageBusinessRules, entityBusinessRules, details: D.details, handlerStubs, needsDecision,
    // Major 4 — resource strings the page bindings reference (`$Resources.Strings.<key>` → default text): the
    // map the agent registers at build time. viewConfigDiff carries only bindings, never inline user text.
    resources: resourceStrings,
    // standard Creatio features replaced by their Freedom analog (A3) — NOT generic details.
    standardFeatures: D.standardFeatures,
    // header/analytical widgets recognised → Freedom analogs (base-provided flagged).
    widgets,
    // inherited base-template chrome (e.g. empty Recommendations container) — hidden from the plan, kept for inspection.
    chromeWidgets,
    // image/photo components (generator-based) → Freedom image component.
    images,
    // card actions / ACTIONS-menu items to wire as Freedom card actions (B7).
    cardActions,
    // referenced UI modules pulled via define() deps — rendered UI outside the page-schema migration unit.
    referencedModules: eff.referencedModules || [],
    // F9: how many effective elements were platform-template context excluded from the payload.
    baseContextExcluded,
  };
}

// Container builder: emits each classic tab / group / profile-island as a Freedom container ONCE (tracking
// what's emitted) and accumulates them in `structural`. ensure* route their decisions/accountedFor into the
// CALLING phase's sinks (nd array, accounted Set) so needsDecision order matches the original single pass —
// fields and details share ONE builder (a detail-only tab must still be emitted).
function createContainers(ctx) {
  const { index, caption } = ctx;
  const structural = [];            // tab + tab-grid container inserts (emitted once, only when used)
  const emittedTabs = new Map();    // tab -> resolved parent container for routed fields
  const emittedGroups = new Map();  // group name -> inner container fields route into (emitted once)
  const emittedIslands = new Map();
  function ensureTab(tab, templateOwned, nd, accounted) {
    if (emittedTabs.has(tab)) return emittedTabs.get(tab);
    accounted.add(tab);
    let parentName;
    if (templateOwned) {
      // F9×F3: a BASE-TEMPLATE tab (e.g. ESNTab) is provided by the Freedom counterpart template —
      // synthesizing a fresh crt.Tab here would duplicate/conflict with it. Route the field to the
      // EXISTING tab and flag placement; never emit a new crt.Tab/grid for a template-owned tab.
      parentName = tab;
      nd.push({ kind: "base-tab-placement", item: tab,
        reason: `payload field(s) target base-template tab '${tab}' — place into the Freedom template's existing equivalent (do NOT create a new tab); confirm the target container` });
    } else {
      // client-owned tab: the page defines it, so we build it. Its grid holds the routed fields.
      parentName = tabGridName(tab);
      const tItem = index.get(tab);
      const c = caption(tItem?.caption, tab);
      structural.push(
        { operation: "insert", name: tab, parentName: "Tabs", propertyName: "tabs",
          values: { type: "crt.Tab", caption: c.binding } },
        { operation: "insert", name: parentName, parentName: tab, propertyName: "items",
          values: { type: "crt.GridContainer", columns: GRID_2 } },
      );
      // flag only when the caption is NOT resolved to real text (synthesized key, or an unresolved key
      // because no manifest.resources was supplied). A resolved literal caption needs no decision (#5/#13).
      if (!c.resolved) nd.push({ kind: "tab-caption", item: tab,
        reason: c.synthesized
          ? `synthesized caption key '${c.key}' — classic caption not in model; author the localized string for it`
          : `tab caption '${c.key}' is an unresolved resource key — pass the schema's localizable strings as manifest.resources to resolve it, or confirm the real label` });
    }
    accounted.add(parentName);
    emittedTabs.set(tab, parentName);
    return parentName;
  }
  function ensureGroup(g, parentName, nd, accounted) {
    if (emittedGroups.has(g.name)) return emittedGroups.get(g.name);
    accounted.add(g.name);
    let inner;
    if (g.itemType === VIEW_ITEM_TYPE.CONTROL_GROUP) {
      // CONTROL_GROUP -> collapsible crt.ExpansionPanel wrapping a grid (e.g. the "Delivery" group).
      const c = caption(g.caption, g.name);
      structural.push({ operation: "insert", name: g.name, parentName, propertyName: "items",
        values: { type: "crt.ExpansionPanel", caption: c.binding, collapsible: true } });
      inner = g.name + "Grid";
      structural.push({ operation: "insert", name: inner, parentName: g.name, propertyName: "items",
        values: { type: "crt.GridContainer", columns: GRID_2 } });
      if (!c.resolved) nd.push({ kind: "group-caption", item: g.name,
        reason: c.synthesized
          ? `synthesized ExpansionPanel caption key '${c.key}' for classic group — author the localized string for it`
          : `group caption '${c.key}' is an unresolved resource key — pass manifest.resources to resolve it, or confirm the real label` });
    } else {
      // GRID_LAYOUT / generic structural container -> crt.GridContainer.
      inner = g.name;
      structural.push({ operation: "insert", name: inner, parentName, propertyName: "items",
        values: { type: "crt.GridContainer", columns: GRID_2 } });
    }
    emittedGroups.set(g.name, inner);
    return inner;
  }
  function ensureProfileIsland(name, accounted) {
    if (emittedIslands.has(name)) return emittedIslands.get(name);
    structural.push({ operation: "insert", name, parentName: "SideAreaProfileContainer", propertyName: "items",
      values: { type: "crt.GridContainer", columns: GRID_1 } });
    accounted.add(name);
    emittedIslands.set(name, name);
    return name;
  }
  return { structural, ensureTab, ensureGroup, ensureProfileIsland };
}

// Cell-occupancy helpers, module-level so they are created ONCE (they were re-created per field). `cells` is
// passed in so they stay pure. A per-container placement cap bounds the relocation scan on hostile input
// (thousands of insert-ops all colliding would otherwise be O(n²)) — the analog of the AST depth-cap;
// excess is flagged.
const MAX_FIELDS_PER_CONTAINER = 500;
const span = (start, n) => Array.from({ length: Math.max(1, n) }, (_, i) => start + i);
const cellKeys = (c, cs, r, rs) => span(c, cs).flatMap((cc) => span(r, rs).map((rr) => cc + ":" + rr));
const cellFree = (cells, c, cs, r, rs) => cellKeys(c, cs, r, rs).every((k) => !cells.has(k));
const claimCells = (cells, c, cs, r, rs) => cellKeys(c, cs, r, rs).forEach((k) => cells.add(k));

// F3: route a field by ancestry (climb the item tree) instead of only recognising Profile/Header. Mutates
// `needsDecision`/`accountedFor` — the two accumulators the caller collects — and returns the Freedom
// container the field lands in.
function routeFieldToContainer(f, own, ctx, needsDecision, accountedFor) {
  if (own.kind === "profile") return routeToProfile(own, ctx, accountedFor);
  if (own.kind === "tab") return routeToTab(own, ctx, needsDecision, accountedFor);
  const parent = FLAT_FALLBACK; // parent chain unresolvable
  const why = own.why === "undefined-parent"
    ? `classic container '${own.parent}' is not defined by any schema or template — seed the base template (F2) so it resolves`
    : `classic container '${f.parent}' is defined but its parent chain never reaches a profile/tab anchor (climbed to the page root) — the base-template seed is incomplete/wrong (F2): seed the real parent template so the profile/tab it nests in is present, or confirm the target tab/group`;
  needsDecision.push({ kind: "container", item: f.name || f.bindTo,
    reason: `${why} — placed in ${parent} for now` });
  return parent;
}

function routeToProfile(own, { profileRegion, islandOf, splitIslands, ensureProfileIsland }, accountedFor) {
  const parent = profileRegion(own);
  // island/group wrappers between the field and the profile anchor are ACCOUNTED FOR (their fields are
  // migrated into the profile) so they are not mis-flagged as "produced no Freedom element".
  for (const g of own.groups) accountedFor.add(g.name);
  // #9b: with >1 island, route this field into its OWN island container (built once), preserving the split.
  const island = islandOf(own);
  if (splitIslands && parent === "SideAreaProfileContainer" && island) return ensureProfileIsland(island, accountedFor);
  return parent;
}

function routeToTab(own, { ensureTab, ensureGroup }, needsDecision, accountedFor) {
  let parent = ensureTab(own.tab, own.tabTemplateOwned, needsDecision, accountedFor);
  // C5 build-out: rebuild each classic group as ExpansionPanel/GridContainer, nested, and route the
  // field into the innermost. Only for client-owned tabs; base tabs stay flat (base-tab-placement).
  if (!own.tabTemplateOwned) for (const g of own.groups) parent = ensureGroup(g, parent, needsDecision, accountedFor);
  else for (const g of own.groups) accountedFor.add(g.name); // base-tab groups: known, not rebuilt
  return parent;
}

// Convert the classic 24-col grid coordinates (0-based) into the TARGET Freedom grid, rather than dumping
// them verbatim into a native container (which overflows and breaks the layout). Target grid width:
//   profile island  -> 1 column  (every field full-width, stacked)
//   tab / group      -> 2 columns (classic left half -> col 1, right half -> col 2; full-width -> span 2)
//   wide header      -> 24 columns kept 1:1 (rare multi-column Header, flagged as a layout-type decision)
function convertGridGeometry(cl, own, headerIsWide) {
  const profileGridCols = (own.via === "Header" && headerIsWide) ? 24 : 1;
  const gridCols = own.kind === "profile" ? profileGridCols : 2;
  let column, colSpan;
  if (gridCols === 1) {
    column = 1; colSpan = 1;
  } else if (gridCols === 2) {
    column = (cl.column ?? 0) >= 12 ? 2 : 1;      // classic right half (col >= 12) -> Freedom column 2
    colSpan = (cl.colSpan ?? 24) >= 24 ? 2 : 1;   // classic full-width -> span both columns, else one
  } else {
    column = cl.column != null ? cl.column + 1 : 1; // wide header: preserve the classic 24-col grid 1:1
    colSpan = cl.colSpan != null ? cl.colSpan : 24;
  }
  // Clamp the span to the grid's right edge: a field at column C can span at most (gridCols - C + 1) columns.
  // Without this a full-width classic field landing in Freedom column 2 (or an over-wide header span) would
  // claim a phantom column and overflow the container. column is already 1-based and ≤ gridCols here.
  column = Math.min(Math.max(1, column), gridCols);
  colSpan = Math.max(1, Math.min(colSpan, gridCols - column + 1));
  // Clamp rowSpan the same way colSpan is clamped: it flows into a span-aware 2-D occupancy walk
  // (`Array.from({length: rowSpan})`), so an unclamped hostile `layout:{rowSpan:1e9}` would OOM / RangeError
  // the CLI — defeating this file's own hostile-input hardening and the "runMigration does NOT throw" contract.
  // Real rowSpans are 1–3; bound to [1, MAX_FIELDS_PER_CONTAINER] so malformed input degrades cleanly.
  const rowSpan = Math.max(1, Math.min(cl.rowSpan ?? 1, MAX_FIELDS_PER_CONTAINER));
  return { column, colSpan, rowSpan, gridCols };
}

// Grid-cell assignment (R9 + collision) — the target Freedom grid is coarser than the classic 24-col one,
// so two classic columns can collapse onto the SAME Freedom (column,row) cell (e.g. col0/span6 and
// col6/span6 both → column 1). Track occupied cells (span-aware) per container: an explicit classic row is
// authoritative UNLESS its cell is already taken (then relocate down + flag the approximation); an auto
// field takes the next free cell. Fields in different columns of the same row (the intended 2-up layout)
// coexist; only true overlaps are moved.
// `grid` carries the caller's per-container occupancy state (usedCells/autoRow/placedCount/truncated).
function assignGridRow(parent, col, geom, cl, grid, needsDecision) {
  const { column, colSpan, rowSpan } = geom;   // gridCols is only needed by the collision message below
  const { usedCells, autoRow, placedCount, truncatedContainers } = grid;
  // Occupancy is a full 2-D matrix (span-aware in BOTH axes): a colSpan spans columns AND a rowSpan spans
  // rows, so a Tall(rowSpan:2) field at row 1 also owns row 2 — a later field at row 2 must not overlap it.
  const cells = usedCells[parent] || (usedCells[parent] = new Set());
  const cap = (placedCount[parent] = (placedCount[parent] || 0) + 1) > MAX_FIELDS_PER_CONTAINER; // relocation scan bound
  if (cap && !truncatedContainers.has(parent)) {
    truncatedContainers.add(parent);
    needsDecision.push({ kind: "layout-truncated", item: parent,
      reason: `container '${parent}' holds more than ${MAX_FIELDS_PER_CONTAINER} fields — collision relocation is bounded past this point (rows may be approximate). This is far beyond any real page; confirm the input is not malformed.` });
  }
  const explicitRow = cl.row != null ? cl.row + 1 : null;
  const row = explicitRow != null
    ? placeAtExplicitRow(explicitRow, cells, geom, cap, col, needsDecision)
    : placeAtNextFreeRow(parent, cells, geom, cap, autoRow);
  claimCells(cells, column, colSpan, row, rowSpan);
  return row;
}

// An explicit classic row is authoritative UNLESS its cell is already taken — then relocate down and flag the
// approximation, because the 24→N collapse (or a rowSpan overlap) is what put two fields on one cell.
function placeAtExplicitRow(explicitRow, cells, geom, cap, col, needsDecision) {
  const { column, colSpan, rowSpan, gridCols } = geom;
  let row = explicitRow;
  if (cap || cellFree(cells, column, colSpan, row, rowSpan)) return row;
  const wanted = row, limit = row + MAX_FIELDS_PER_CONTAINER;
  while (row < limit && !cellFree(cells, column, colSpan, row, rowSpan)) row++;
  const spanNote = rowSpan > 1 ? `, spans ${rowSpan} rows` : "";
  needsDecision.push({ kind: "layout-collision", item: col,
    reason: `'${col}' maps onto an already-occupied Freedom grid cell (column ${column}, row ${wanted}${spanNote}) — the classic layout collapsed two fields onto overlapping cells in the ${gridCols}-col target; moved to row ${row}. Confirm the intended placement/order (or widen the container).` });
  return row;
}

// A field with NO explicit row takes the next row not already claimed in that container.
function placeAtNextFreeRow(parent, cells, geom, cap, autoRow) {
  const { column, colSpan, rowSpan } = geom;
  let cur = autoRow[parent] || 1;
  if (!cap) {   // past the per-container cap, skip the (bounded) relocation scan — just place at the cursor
    const limit = cur + MAX_FIELDS_PER_CONTAINER;
    while (cur < limit && !cellFree(cells, column, colSpan, cur, rowSpan)) cur++;   // skip cells already taken in this column/row span
  }
  autoRow[parent] = cur + 1;
  return cur;
}

// The field's column, its entity metadata, the resolved Freedom control and the unique element name.
// `nameCount` is the caller's per-column counter (mutated) so duplicate bindings get _2/_3 suffixes.
function resolveFieldElement(f, { cols, colMeta }, nameCount, needsDecision) {
  const col = f.bindTo || f.name || "Field";
  const meta = colMeta(col);
  // A bound field whose column is NOT among the entity's real columns (when entityColumns is supplied) is
  // usually an AUTO-FILLED companion loaded from a selected lookup by an on<X>Change/set<X>Info handler
  // (e.g. Department/StaffUnit from the chosen Request) — build it READ-ONLY on a view-model attribute and
  // wire that handler; do NOT drop it, because dropping is what collapses an island to a lone field.
  if (f.bindTo && Object.keys(cols).length && !(col in cols)) needsDecision.push({ kind: "virtual-field", item: col,
    reason: `field '${col}' is not a real column on the entity — likely an auto-filled companion loaded from a selected lookup (an on-change / set-info handler). Build it as a READ-ONLY field bound to a VIEW-MODEL attribute and wire the lookup's on-change handler to load/clear it; do NOT drop it (that collapses the island to a lone field). Confirm the column if it should be a real entity field.` });
  const ctl = control(meta.type, f.contentType, meta.ref);
  if (!ctl) needsDecision.push({ kind: "field-control", item: col,
    reason: "no classic contentType and no entity column type — confirm control", suggestion: "crt.Input" });
  const c = ctl || { type: "crt.Input" };
  // #4: unique element name derived from the column; two classic items on one column -> _2, _3 + flag.
  nameCount[col] = (nameCount[col] || 0) + 1;
  const elName = nameCount[col] === 1 ? col : `${col}_${nameCount[col]}`;
  if (nameCount[col] > 1) needsDecision.push({ kind: "duplicate-binding", item: col,
    reason: `column '${col}' bound by multiple classic items — emitted as '${elName}'; confirm which to keep` });
  return { col, meta, c, elName };
}

// respect classic visibility instead of hardcoding true: static false → hidden; dynamic (bound/rule)
// → visible + a decision. A field inside a container that is itself hidden (static) or conditionally
// shown (dynamic/rule) inherits the container's visibility — surface it so the container-level condition
// is wired onto the Freedom field/group rather than silently dropped.
function resolveFieldVisibility(f, own, col, needsDecision) {
  const hiddenAncestor = (own.groups || []).find(g => g.visible === false || g.visible === "dynamic");
  let vis = f.visible !== false;
  if (hiddenAncestor?.visible === false) vis = false; // inherits a statically-hidden ancestor
  if (f.visible === "dynamic") needsDecision.push({ kind: "visibility-rule", item: col,
    reason: `field '${col}' visibility is dynamic (bound/rule/feature) in classic — confirm the Freedom visibility rule; static mapping shows it` });
  if (hiddenAncestor) needsDecision.push({ kind: "ancestor-visibility", item: col,
    reason: `field '${col}' sits inside container '${hiddenAncestor.name}' which is ${hiddenAncestor.visible === false ? "hidden (static) — the field is mapped hidden too" : "conditionally shown (dynamic/rule) in classic"}; wire the container's visibility condition onto the Freedom field/group instead of leaving it unconditionally visible` });
  return vis;
}

// The Freedom element's `values` block: control type, label, data-type label, and the read-only / lookup /
// picker / multiline / tooltip flags derived from the classic item and the entity column metadata.
function buildFieldValues({ f, col, c, meta, lbl, vis, layoutConfig, cols }, needsDecision) {
  const values = {
    type: c.type, control: "$" + col,
    labelPosition: c.type === "crt.Checkbox" ? "beside" : "above", visible: vis, layoutConfig,
  };
  // Major 4 — a column-bound field AUTO-labels from the entity column's own (localized) title, so we do NOT
  // write an inline `label`/caption onto the page (clio rejects hardcoded page text; AGENTS.md). `titleText`
  // is PLAN-only metadata (like `typeLabel`) so the design spec still reads the human title, not the code.
  if (lbl != null) values.titleText = lbl;
  // design-spec Type column: a short human data type ("Text (250)", "Lookup", "Email") + the lookup's
  // referenced object when known — carried on the field so designspec.mjs renders it without re-deriving.
  values.typeLabel = fieldTypeLabel(col, meta, c);
  if (c.lookup && meta.ref) values.refSchema = meta.ref;
  if (meta.readOnly) values.readOnly = true; // explicit read-only from column metadata (mirrors/virtual)
  // linkedDisplay: the classic page shows a plain scalar column via a picker (contentType 5, no ref) — a
  // read-only VALUE FROM A LINKED RECORD, not a lookup. Keep the real data type, mark it read-only.
  if (c.linkedDisplay) { values.readOnly = true; values.linkedValue = true; }
  // A field the ENTITY itself types as a lookup but with no reference schema is a genuine data anomaly —
  // flag it so it isn't shipped as an editable ComboBox pointing nowhere.
  if (c.lookup && !meta.ref && cols[col] && typeof cols[col] === "object")
    needsDecision.push({ kind: "lookup-no-ref", item: col,
      reason: `'${col}' is typed as a lookup but its entity column has no reference schema — verify the target object.` });
  if (c.lookup) { values.listActions = []; values.controlActions = []; }
  if (c.picker) values.pickerType = c.picker;
  if (c.multiline) values.multiline = true;
  applyFieldTooltip(values, f, col, needsDecision);
  return values;
}

// classic `tip` and `hint` are BOTH field tooltips but DIFFERENT properties. Decouple the two effects so
// a dynamic hint is never silently swallowed when the field already has a `tip`:
//  • a static Resources.Strings.* hint fills the Freedom tooltip only if no tip already occupies it;
//  • a dynamic hint (bound to a computed method) is ALWAYS surfaced as a field-hint decision.
function applyFieldTooltip(values, f, col, needsDecision) {
  if (f.tip) values.tip = { content: "$" + f.tip }; // carry the classic tooltip resource key
  if (!f.hint) return;
  if (f.hint.startsWith("Resources.Strings.")) {
    if (!values.tip) values.tip = { content: "$" + f.hint };
    return;
  }
  needsDecision.push({ kind: "field-hint", item: col,
    reason: `field '${col}' tooltip is a dynamic hint bound to '${f.hint}' (computed, not a static resource)${values.tip ? " and competes with a static tip already mapped" : ""} — wire the Freedom tooltip via a handler/converter` });
}

// fields (3-part binding: control + attribute + dataSource). Routes each payload field into its Freedom
// container by climbing the classic ancestry, converting the classic 24-col grid into the target grid.
// Returns viewConfigDiff/attributes/pdsColumns + its needsDecision[]/accountedFor[] + the profileRegion
// resolver the details phase reuses.
function mapFields(ctx, containers) {
  const { cols, colMeta, labelFor, index, profileAnchors, payloadFields } = ctx;
  const { ensureTab, ensureGroup, ensureProfileIsland } = containers;
  const needsDecision = [], viewConfigDiff = [], accountedFor = new Set();
  const attributes = {}, pdsColumns = {};
  let fieldsWithTitle = 0;
  const nameCount = {};
  // R9 — faithful per-container row assignment. An explicit classic row is authoritative and kept verbatim;
  // a field with NO explicit row takes the next row not already claimed in that container. The old code kept
  // a single counter bumped on EVERY field (explicit ones too), so a container mixing explicit and auto rows
  // mis-numbered the autos — an auto field landing on an explicit field's row, or leaving gaps.
  const grid = {
    autoRow: {},    // parent -> next auto row to try (1-based)
    usedCells: {},  // parent -> Set of "col:row" cells already taken (span-aware), so nothing overlaps
    placedCount: {},              // parent -> fields placed so far (bounds the relocation search)
    truncatedContainers: new Set(),
  };
  // Pre-resolve every field's owner once, so we can DETECT the header layout type before routing.
  // STABLE-SORT by the classic diff `order` first (Major): the eff projection preserves Map order, but the
  // classic layout order is `order`/index — without this a field with a lower order that appears later in the
  // Map was assigned a LATER row (wrong vertical order). Fields with no explicit order keep their Map position
  // (Infinity sorts last, stably). Row assignment below then walks fields in true layout order.
  const resolved = payloadFields
    .map((f, i) => ({ f, i, own: resolveOwner(f.parent, index, profileAnchors) }))
    .sort((a, b) => ((a.f.order ?? Infinity) - (b.f.order ?? Infinity)) || (a.i - b.i));
  // Moment 1 — layout type: classic `Header` fields spanning >1 grid column == a WIDE multi-column
  // header (like Contract), NOT the narrow left profile island. In that case route them to a full-width
  // header GridContainer (preserving the multi-column grid) instead of cramming them into colSpan-1.
  const headerCols = new Set(resolved
    .filter(r => r.own.kind === "profile" && r.own.via === "Header" && r.f.layout?.column != null)
    .map(r => r.f.layout.column));
  const headerIsWide = headerCols.size > 1;
  if (headerIsWide) {
    containers.structural.push({ operation: "insert", name: "HeaderContainer", parentName: "Header", propertyName: "items",
      values: { type: "crt.GridContainer", columns: GRID_24 } });
    needsDecision.push({ kind: "layout-type", item: "Header",
      reason: `classic Header is a WIDE ${headerCols.size}-column block, not the default left profile island — mapped to a full-width header grid; confirm the target Freedom page uses a header region (no left profile) and the column layout` });
  }
  const profileRegion = (own) => (own.via === "Header" && headerIsWide) ? "HeaderContainer" : "SideAreaProfileContainer";
  // #9b — the classic left area can group fields into MORE THAN ONE island container (e.g. ContactContainer
  // + InternalRequestContainer, both under LeftModulesContainer). The island = the OUTERMOST group between
  // the field and the profile anchor (groups[0]). If there is >1 distinct island, rebuild each as its own
  // container in the side profile instead of flattening every field into one stack.
  const islandOf = (own) => own.groups?.length ? own.groups[0].name : null;
  const distinctProfileIslands = new Set(resolved
    .filter(r => r.own.kind === "profile" && !(r.own.via === "Header" && headerIsWide))
    .map(r => islandOf(r.own)).filter(Boolean));
  const splitIslands = distinctProfileIslands.size > 1;
  const routeCtx = { profileRegion, islandOf, splitIslands, ensureTab, ensureGroup, ensureProfileIsland };
  for (const { f, own } of resolved) {
    const parent = routeFieldToContainer(f, own, routeCtx, needsDecision, accountedFor);
    const { col, meta, c, elName } = resolveFieldElement(f, { cols, colMeta }, nameCount, needsDecision);
    // Convert the classic 24-col grid coordinates (0-based) into the TARGET Freedom grid, rather than dumping
    // them verbatim into a native container (which overflows and breaks the layout). Target grid width:
    //   profile island  -> 1 column  (every field full-width, stacked)
    //   tab / group      -> 2 columns (classic left half -> col 1, right half -> col 2; full-width -> span 2)
    //   wide header      -> 24 columns kept 1:1 (rare multi-column Header, flagged as a layout-type decision)
    const cl = f.layout || {};
    const geom = convertGridGeometry(cl, own, headerIsWide);
    const { column, colSpan, rowSpan } = geom;
    const row = assignGridRow(parent, col, geom, cl, grid, needsDecision);
    const layoutConfig = {
      column,
      row,
      colSpan,
      rowSpan,
    };
    const vis = resolveFieldVisibility(f, own, col, needsDecision);
    const lbl = labelFor(col);
    if (lbl != null) fieldsWithTitle++;
    const values = buildFieldValues({ f, col, c, meta, lbl, vis, layoutConfig, cols }, needsDecision);
    viewConfigDiff.push({ operation: "insert", name: elName, values, parentName: parent, propertyName: "items" });
    attributes[col] = { modelConfig: { path: "PDS." + col } };
    pdsColumns[col] = { path: col };
  }
  // #9b: >1 classic left-area island → each rebuilt as its own container in the side profile (above),
  // preserving the split the user sees on the classic page. Surface it as a KNOWN decision.
  if (splitIslands) needsDecision.push({ kind: "profile-island", item: [...distinctProfileIslands].join(", "),
    reason: `classic left profile area has ${distinctProfileIslands.size} distinct islands (${[...distinctProfileIslands].join(", ")}) — build EACH as its own crt.GridContainer in the side profile, preserving the classic split (NOT flattened). Do NOT merge them into one container "for simplicity" — that is a silent plan deviation. Merge ONLY if the Freedom left area genuinely cannot stack containers, and say so.` });
  // #5/#13 (fields) — if NO field label resolved to a real title, the spec shows column CODES. Nudge the
  // agent to pass get-entity-schema-properties column titles so labels read like the classic page, not raw codes.
  if (payloadFields.length && fieldsWithTitle === 0) needsDecision.push({ kind: "field-labels", item: "(all fields)",
    reason: `field labels are shown as column codes — no titles were supplied. Pass the entity's column titles (from get-entity-schema-properties) as manifest.columnTitles so labels read like the classic page (e.g. MobilePhone → "Mobile phone", ExpertiseLevel → "Specialist expertise level")` });
  return { viewConfigDiff, attributes, pdsColumns, needsDecision, accountedFor, profileRegion };
}

// details: STANDARD features (A3 → Freedom analog) vs genuine custom details (Expanded list). Dedups by
// signature, ensures the owning tab exists (via the shared container builder), and resolves titles/columns
// from manifest.detailSchemas. Returns details[]/standardFeatures[] + its needsDecision[]/accountedFor[].
function mapDetails(ctx, containers, profileRegion) {
  const { index, profileAnchors, detailSchemas, resolveText, payloadDetails } = ctx;
  const { ensureTab } = containers;
  const needsDecision = [], details = [], standardFeatures = [], accountedFor = new Set();
  // #11 dedup: the SAME detail (schema+entity+FK) can be declared under more than one key or re-placed
  // across schemas → without dedup it is emitted TWICE (once resolved into a tab, once with tab:null).
  // Resolve each placement first, then collapse by signature, KEEPING the entry whose parent resolves to
  // a tab (the real placement) and dropping the phantom.
  const detailSig = (d) => [d.schemaName, d.entitySchemaName, d.detailColumn, d.masterColumn].join("|");
  const bySig = new Map();
  for (const d of payloadDetails) {
    accountedFor.add(d.key); if (d.schemaName) accountedFor.add(d.schemaName);
    // place the detail in its owning TAB (ancestry-resolved), preserving order.
    const own = d.parent ? resolveOwner(d.parent, index, profileAnchors) : { kind: "unresolved" };
    const profileTab = own.kind === "profile" ? profileRegion(own) : null;
    const tab = own.kind === "tab" ? own.tab : profileTab;
    const cur = bySig.get(detailSig(d));
    if (!cur) bySig.set(detailSig(d), { d, tab, own });
    else if (cur.tab == null && tab != null) { cur.d = d; cur.tab = tab; cur.own = own; } // prefer a resolved placement
    else if (!cur.d.caption && d.caption) cur.d = { ...cur.d, caption: d.caption }; // else keep first, backfill caption on a COPY (don't mutate the shared input detail — mapToFreedom stays pure)
  }
  for (const { d, tab, own } of bySig.values()) {
    // Ensure the OWNING tab is emitted as a container so the related list / feature has a home AND its
    // caption resolves — a tab holding ONLY details would otherwise never be built (ensureTab is
    // otherwise reached only from field routing).
    if (own?.kind === "tab") ensureTab(own.tab, own.tabTemplateOwned, needsDecision, accountedFor);
    // #11(ii)/B2 — the detail's OWN schema (when passed in manifest.detailSchemas) gives its real child
    // entity + list columns, resolving even an auto-named SchemaNDetail.
    const dinfo = detailSchemas[d.schemaName];
    const dentity = d.entitySchemaName || dinfo?.entity || null;
    // A standard feature is recognised by the detail SCHEMA name (matchFeature), OR — when the schema
    // carries an auto-generated placeholder name (SchemaNDetail) that hides it — by its file-storage
    // ENTITY (`*File`, which always backs the Attachments detail). Entity-inferred matches are flagged
    // as inferred so the reviewer confirms it is Attachments and not a business detail (#11).
    let feat = matchFeature(d.schemaName), featByEntity = false;
    if (!feat && (dentity || "").endsWith("File")) { feat = FEATURE_CATALOG.FileDetailV2; featByEntity = true; }
    if (!feat && dentity === "ContactCommunication") { feat = FEATURE_CATALOG.ContactCommunicationDetail; featByEntity = true; }
    if (feat) {
      // Moment 2/3: this is a standard Creatio feature — replace with its Freedom analog, don't rebuild.
      standardFeatures.push({ feature: feat.feature, freedom: feat.freedom, classicDetail: d.schemaName, entity: dentity, tab, templateProvided: !!feat.templateProvided, inferredFromEntity: featByEntity, uiShape: feat.uiShape || "list", note: feat.note || null });
      const featWhat = featByEntity
        ? `detail over the entity '${dentity}' (classic schema '${d.schemaName}') is the`
        : `classic '${d.schemaName}' is the`;
      const featProvided = feat.templateProvided
        ? " — ALREADY provided by most Freedom form templates; account for it / merge onto the existing component, do NOT create a new one"
        : "; confirm the exact Freedom component + wiring";
      const featInferred = featByEntity ? ` — inferred from the entity name; confirm this is ${feat.feature} and not a business detail` : "";
      const featNote = feat.note ? ` — ${feat.note}` : "";
      needsDecision.push({ kind: "standard-feature", item: d.schemaName || dentity,
        reason: `${featWhat} ${feat.feature} feature → use ${feat.freedom} (A3 replacement, NOT a generic detail)${featProvided}${featInferred}${featNote}` });
      continue;
    }
    // #11(ii): an auto-generated detail name (SchemaNDetail) is RESOLVED once its own schema is supplied
    // (real entity + columns known). Only flag detail-unresolved when the schema was NOT provided.
    if (/^Schema\d+Detail$/.test(d.schemaName || "") && !dinfo) {
      const childEntityNote = dentity ? ` (child entity '${dentity}')` : "";
      needsDecision.push({ kind: "detail-unresolved", item: d.schemaName,
        reason: `detail schema '${d.schemaName}' is an auto-generated classic name${childEntityNote} — fetch its schema and pass it as manifest.detailSchemas (get-classic-page-sources gathers these automatically) to resolve the real columns and caption before building; do NOT ship a related list under a placeholder name` });
    }
    if (!tab) needsDecision.push({ kind: "detail-placement", item: d.schemaName || d.key,
      reason: `could not resolve which tab detail '${d.key}' belongs to (parent '${d.parent || "?"}' unresolved) — confirm target tab` });
    // Two SEPARATE-migration flags, surfaced together so neither is silently skipped:
    //  • editability (view-only vs add/edit/delete) is NOT reliably on the master — it lives in the detail's
    //    OWN config/schema, so leave it unresolved rather than hardcoding an "add" toolbar; and
    //  • the related list opens the CHILD entity's record form on add/edit — that Freedom edit page (and mini
    //    page, if the classic detail used one) is a SEPARATE migration.
    needsDecision.push(
      { kind: "detail-editability", item: d.schemaName || d.key,
        reason: `allowed detail actions (view-only vs add/edit/delete) not determinable from the master — resolve from the detail's own config (B2 recursion) or confirm` },
      { kind: "detail-editpage", item: dentity || d.schemaName || d.key,
        reason: `related list '${d.schemaName || d.key}' opens the '${dentity || "child entity"}' record form on add/edit — that Freedom edit page (and mini page, if the classic detail used one) is a SEPARATE migration: ensure a Freedom form for '${dentity || "the child entity"}' exists, or migrate it as a follow-on page` },
    );
    // caption fidelity (#15/#13): a resource-key caption is RESOLVED from manifest.resources to the real
    // localized string — never invented. If unresolved (no resources supplied), keep the key and flag it.
    const resolvedDcap = d.caption ? resolveText(d.caption) : null;
    const plainDcap = d.caption && !d.caption.startsWith("Resources.Strings.") ? d.caption : null;
    // detail TITLE: resolved page-caption resource → the detail's own title (manifest.detailSchemas.title)
    // → a plain caption → null. Flag only when it stays an unresolved resource key.
    const detailTitle = resolvedDcap ?? dinfo?.title ?? plainDcap ?? null;
    if (!detailTitle && d.caption?.startsWith("Resources.Strings.")) needsDecision.push({ kind: "detail-caption", item: d.schemaName || d.key,
      reason: `detail title unresolved — caption is the resource key '${d.caption}'; pass the detail's title via manifest.detailSchemas["${d.schemaName}"].title (from its localizable strings) or manifest.resources, or confirm; do NOT invent one` });
    details.push({
      composite: "Expanded list", entity: dentity, detailSchema: d.schemaName,
      caption: detailTitle, tab, order: d.order ?? null, dataSourceScope: "viewElement",
      columns: dinfo?.columns?.length ? dinfo.columns : null, // #11(ii) — the related-list columns, when the detail schema was supplied
      dependency: d.detailColumn ? { attributePath: d.detailColumn, relationPath: "PDS." + (d.masterColumn || "Id") } : null,
      actions: "unresolved",
      note: d.detailColumn ? null : "child FK (detailColumn) not in details block — resolve from detail schema",
    });
  }
  return { details, standardFeatures, needsDecision, accountedFor };
}

// Moment 5: card actions / ACTIONS menu → Freedom card actions (B7). Returns needsDecision[] / accountedFor[].
function mapCardActions(eff) {
  const needsDecision = [], accountedFor = [];
  // static toolbar buttons + custom actions surfaced from getActions bodies (navigate*/goTo*), so a real
  // action like navigateToTaxesByCountriesLookup isn't silently lost (its body is imperative → review).
  const cardActions = [...(eff.items || []).filter(i => KNOWN_ACTION_ITEMS.has(i.name)).map(i => i.name), ...(eff.cardActionHints || [])];
  for (const i of (eff.items || [])) if (KNOWN_ACTION_ITEMS.has(i.name)) accountedFor.push(i.name);
  // #8c — the page launches a business process imperatively (a "Run process" action). Surface it as a
  // Freedom "Run process" card action + a decision naming the process(es) so it isn't lost.
  if (eff.processLaunch) {
    if (!cardActions.includes("RunProcess")) cardActions.push("RunProcess");
    const processNote = eff.processNames?.length ? ` (${eff.processNames.join(", ")})` : "";
    needsDecision.push({ kind: "process-launch", item: eff.processNames?.length ? eff.processNames.join(", ") : "RunProcess",
      reason: `the classic page launches a business process imperatively${processNote} — READ ITS BINDING first: ProcessInModules by the section's SysModule/Id tells which module(s) it is bound to — the LIST/registry module, the record CARD/form module, or BOTH. Place it as a MENU ITEM in the template's existing Actions button on EACH surface it is bound to (do NOT assume list-only or form-only; never a standalone button): LIST → the list Actions button (ActionButton in ListPageV3), processRunType ForTheSelectedRecords + dataSourceName PDS; FORM → the form page's OWN Actions button in the header action area (the template's ActionButtonsContainer), placed at the END of that container next to the CloseButton (last position), run for the CURRENT record ($Id). Label the item with the process DISPLAY Caption (VwSysProcess), never its technical code. Launch via crt.RunBusinessProcessRequest, passing the record Id into the record param from the process signature. None connected on a surface ⇒ nothing there; none anywhere ⇒ drop the button` });
  }
  const hasGetActions = (eff.methods || []).some(m => m.name === "getActions" && !m.fromTemplate);
  if (cardActions.length || hasGetActions) needsDecision.push({ kind: "card-action", item: "ACTIONS",
    reason: `card actions / ACTIONS-menu → Freedom card actions (B7): ${cardActions.join(", ") || "getActions"}. ` +
      `Custom getActions items${(eff.cardActionHints || []).length ? " incl. " + eff.cardActionHints.join(", ") : ""} are built imperatively — review the getActions body to wire them.` });
  return { cardActions, needsDecision, accountedFor };
}

// feature toggles, catalog-miss charts, methods → handler stubs, client removals, referenced UI modules.
// Returns handlerStubs[] + its own needsDecision[].
function mapRemainingLogic(eff, payloadMethods, payloadComponents, clientEditableSchemas) {
  const needsDecision = [];
  // feature toggles gate WHICH elements render — the ChangeSet is the full static UNION of blocks/fields;
  // the rendered page shows one feature-state (e.g. old ProductCategoryBlock vs new one). Flag for review;
  // which feature gates which element lives in method bodies (imperative → judgment).
  if ((eff.features || []).length) needsDecision.push({ kind: "feature-toggle", item: eff.features.join(", "),
    reason: `page uses feature toggles (${eff.features.join(", ")}) that gate element visibility — mapping is the full union of blocks/fields; the live page renders one feature-state. Review which feature-gated blocks/fields to migrate (gating is in method bodies).` });

  // charts/widgets not in the catalog -> B9/B10 (generic)
  for (const c of payloadComponents)
    if (!(WIDGET_BY_MODULE[c.key] || WIDGET_BY_MODULE[c.moduleName])) needsDecision.push({ kind: "component", item: c.key,
      reason: `module '${c.moduleName || "?"}' (chart/widget) — propose closest standard Freedom component, confirm with user` });

  // methods -> handler stubs (judgment)
  const handlerStubs = payloadMethods.map(m => ({ sourceMethod: m.name, category: categorize(m.name), draft: true }));
  for (const m of payloadMethods)
    needsDecision.push({ kind: "method", item: m.name, reason: "imperative logic — implement as Freedom handler or set-values rule; review" });

  // removals (B6) — client removals only; template-internal removes are context (F9, C3)
  for (const rm of eff.removed.filter(x => !x.fromTemplate)) {
    const clientRemoved = clientEditableSchemas.has(rm.removedBy);
    needsDecision.push({ kind: "removal", item: rm.name,
      reason: clientRemoved
        ? `client schema '${rm.removedBy}' removed it — remove/hide on Freedom`
        : `removed by '${rm.removedBy}' (not confirmed client-editable) — KEEP on Freedom unless confirmed` });
  }

  // Fix 3: referenced UI modules (define() deps that render UI OUTSIDE this page's diff)
  // e.g. CasesEstimateLabel → the SLA response/solution timer + its START/END buttons. The migration
  // unit is the page schema, so these modules' rendered controls are invisible to schema analysis and are
  // NOT in this ChangeSet. Surface them for a manual Freedom port instead of under-reporting the surface.
  for (const rm of (eff.referencedModules || []))
    needsDecision.push({ kind: "referenced-module", item: rm,
      reason: `page composes UI from referenced module '${rm}' (declared in define() deps + own CSS) — its rendered controls (buttons/labels/timers) are OUTSIDE the page-schema migration unit and are NOT in this ChangeSet; port it manually to Freedom or confirm the target template provides it` });
  return { handlerStubs, needsDecision };
}

// Fix 2: LOUD unmapped-component drop — any alive CLIENT-authored item the mapper produced nothing for is
// surfaced (one decision per dropped subtree root), instead of silently vanishing. Reads the final accountedFor.
function mapUnmappedDrop(eff, accountedFor) {
  const needsDecision = [];
  // Candidate = alive, CLIENT-authored (non-template) item the mapper produced NOTHING for. Skip STRUCTURAL
  // containers the mapper builds on demand: a tab (isTab), a CONTROL_GROUP (itemType 15) or detail
  // (itemType 2). itemType isn't always resolvable, so back it with the naming convention — but a name
  // suffix ALONE must never silently suppress content (a childless block misnamed `SlaGroup` is real UI):
  //  • HARD_SCAFFOLD (grids / the root tab panel) is pure layout the mapper rebuilds — always skip.
  //  • SOFT_STRUCT (…Group/Tab/ControlGroup/TabContainer) is skipped ONLY when it is a real parent (has a
  //    child routed through it); a childless one IS surfaced, so nothing vanishes on name convention alone.
  const HARD_SCAFFOLD_RX = /(?:_gridLayout|Grid)$|^Tabs$/;
  const SOFT_STRUCT_RX = /(?:Tabs|Tab|TabContainer|ControlGroup|Group)$/;
  const parents = new Set((eff.items || []).map(i => i.parent).filter(Boolean));
  // A genuine DROP candidate: client-authored (or a non-standard template `…Button` — RV7, surfaced unlike
  // other template-owned layout context), not a field/detail/group/tab the mapper already handles, not already
  // accounted, not pure scaffolding, and not a structural container that actually parents a routed child.
  const isDropCandidate = (i) => {
    const isButton = i.name.endsWith("Button");
    if ((i.templateOwned && !isButton) || i.bindTo || i.itemType === VIEW_ITEM_TYPE.DETAIL || i.itemType === VIEW_ITEM_TYPE.CONTROL_GROUP || i.isTab) return false;
    if (accountedFor.has(i.name) || HARD_SCAFFOLD_RX.test(i.name)) return false;
    if (SOFT_STRUCT_RX.test(i.name) && parents.has(i.name)) return false; // structural container (has children)
    return true;
  };
  const dropped = new Set();
  for (const i of (eff.items || [])) if (isDropCandidate(i)) dropped.add(i.name);
  // The decision text for a dropped item — a non-standard UI block, a template button outside the action set,
  // or a custom button — each needing a different Freedom follow-up.
  const unmappedReason = (i) => {
    if (!i.name.endsWith("Button")) {
      const captionNote = i.caption ? ` (caption ${i.caption})` : "";
      const generatorNote = i.generator ? ` (generator ${i.generator})` : "";
      return `classic component '${i.name}'${captionNote}${generatorNote} (and its sub-items) produced no Freedom element — non-standard UI (a LABEL/CONTAINER micro-widget block, e.g. an SLA timer) outside the standard record-page vocabulary; port manually to a Freedom custom component or confirm drop`;
    }
    if (i.templateOwned) return `standard/template button '${i.name}' is not in the recognized action set and got no card-action mapping — confirm the Freedom template already provides it, else wire it as a Freedom card action (RV7)`;
    return `custom button '${i.name}' has no Freedom mapping — wire it as a Freedom card action (its click handler is imperative; review the getActions/onClick body)`;
  };
  // Flag only the ROOT of each dropped subtree (whose parent is not itself dropped) → ONE decision per
  // block, not one per leaf: the SLA timer surfaces as a single "port this block" item, not six.
  for (const i of (eff.items || [])) {
    if (!dropped.has(i.name) || (i.parent && dropped.has(i.parent))) continue;
    needsDecision.push({ kind: "unmapped-component", item: i.name, reason: unmappedReason(i) });
  }
  return { needsDecision };
}

// Map ONE classic rule into its Freedom page/entity business rule, or a needsDecision when it can't be mapped.
// Mutates the three sinks — keeps the ruleType dispatch (and its nesting) out of mapRules's loop.
function mapOneRule(r, pageBusinessRules, entityBusinessRules, needsDecision) {
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
    if (!acts) { needsDecision.push({ kind: "rule", item: r.attr, reason: `BINDPARAMETER property '${r.property}' unmapped` }); return; }
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

// rules → page/entity business rules (declarative). Returns its own needsDecision[].
function mapRules(payloadRules, payloadFields) {
  const pageBusinessRules = [], entityBusinessRules = [], needsDecision = [];
  for (const r of payloadRules) mapOneRule(r, pageBusinessRules, entityBusinessRules, needsDecision);
  // C4: a rule whose target column has NO field insert in this ChangeSet (its field is template context
  // excluded from payload, or an entity-only column) would dangle on a non-existent element — flag it.
  const emittedCols = new Set(payloadFields.map(f => f.bindTo || f.name));
  const ruleTargets = new Set(
    [...pageBusinessRules.map(r => r.element), ...entityBusinessRules.map(r => r.targetAttribute)].filter(Boolean));
  for (const t of ruleTargets) if (!emittedCols.has(t))
    needsDecision.push({ kind: "rule-target-missing", item: t,
      reason: `business rule targets '${t}' but no field for it is inserted (base/template field or entity-only column) — ensure the Freedom target provides the element` });
  return { pageBusinessRules, entityBusinessRules, needsDecision };
}

// image / photo components (generator-based, no bindTo) → Freedom image component.
function mapImages(eff) {
  const images = [], needsDecision = [], accountedFor = [];
  for (const i of (eff.items || [])) {
    // RV11 — (a) skip template-owned items: a base-template Photo/Logo is layout context, not client payload
    // (it triggered a spurious `image` decision on every migration built on that template). (b) the no-
    // generator fallback recognised only bare Photo/Image/Logo — broaden to Avatar/Thumbnail/Picture and to
    // *-suffixed names (CompanyLogo/UserAvatar), while still excluding structural containers/tabs/details.
    if (i.templateOwned) continue;
    const genImg = i.generator && /image/i.test(i.generator);
    const nameImg = !i.bindTo && i.itemType !== VIEW_ITEM_TYPE.DETAIL && i.itemType !== VIEW_ITEM_TYPE.CONTROL_GROUP && !i.isTab
      && (/^(?:Photo|Image|Logo|Avatar|Thumbnail|Picture)\d*$/i.test(i.name) || /(?:Photo|Logo|Avatar|Thumbnail|Picture)$/.test(i.name));
    if (!genImg && !nameImg) continue;
    accountedFor.push(i.name);
    images.push({ classic: i.name, generator: i.generator || null, parent: i.parent });
    const genNote = i.generator ? ` (generator ${i.generator})` : "";
    needsDecision.push({ kind: "image", item: i.name,
      reason: `image/photo component '${i.name}'${genNote} → Freedom image component; wire the source/upload handlers (getSrc/onChange)` });
  }
  return { images, needsDecision, accountedFor };
}

// Moment 4: header/analytical widgets → Freedom analogs (base-provided are NOTED, not dropped).
// Returns its own needsDecision[] / accountedFor[]; the orchestrator merges them.
function mapWidgets(eff) {
  const widgets = [], chromeWidgets = [], needsDecision = [], accountedFor = [];
  const seenWidget = new Set();
  const addWidget = (defs, classic, base) => {
    if (!defs) return;
    accountedFor.push(classic);
    for (const w of (Array.isArray(defs) ? defs : [defs])) {
      if (seenWidget.has(w.widget)) continue;
      seenWidget.add(w.widget);
      // `chrome` widgets (e.g. the always-present-but-empty Recommendations container) are inherited base-template
      // scaffolding, not page content — hide them from the design spec instead of hardcoding an "ignore" per run.
      if (w.chrome) { chromeWidgets.push({ widget: w.widget, classic, note: w.note || null }); continue; }
      widgets.push({ widget: w.widget, freedom: w.freedom, classic, base: !!base, note: w.note || null, placement: w.placement || null });
      // a widget with its own note (DCM) carries that note; otherwise fall back to the base/native wording.
      let tail;
      if (w.note) tail = ` — ${w.note}`;
      else if (base) tail = " — usually provided by the Freedom template; confirm or re-apply any customization";
      else tail = "; confirm the Freedom component";
      needsDecision.push({ kind: "widget", item: w.widget, reason: `${w.widget} → ${w.freedom}${tail}` });
    }
  };
  for (const c of (eff.components || [])) addWidget(WIDGET_BY_MODULE[c.key] || WIDGET_BY_MODULE[c.moduleName], c.key, c.fromTemplate);
  for (const i of (eff.items || [])) addWidget(WIDGET_BY_CONTAINER[i.name], i.name, i.templateOwned);
  return { widgets, chromeWidgets, needsDecision, accountedFor };
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

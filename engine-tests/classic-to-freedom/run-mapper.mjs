// Golden test for the Ф3 mapper: merge -> map -> assert Freedom ChangeSet.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchema, mergeHierarchy } from "../../skills/classic-to-freedom-migration/engine/engine.mjs";
import { mapToFreedom } from "../../skills/classic-to-freedom-migration/engine/mapper.mjs";
import { runMigration } from "../../skills/classic-to-freedom-migration/engine/migrate.mjs";
import { renderDesignSpec } from "../../skills/classic-to-freedom-migration/engine/designspec.mjs";
import { spawnSync } from "node:child_process";
import { makeSchema as L, makeOp as di } from "./_testkit.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_DIR = path.join(DIR, "..", "..", "skills", "classic-to-freedom-migration", "engine");
const FIX = path.join(DIR, "fixtures");
const load = (dir, order) => order.map(fn =>
  parseSchema(fs.readFileSync(path.join(FIX, dir, fn), "utf8"), fn.replace(/\.js$/, "").replace(/_base$|_repl$/, "")));

// SupportUnit entity column types (from describe-entity) — lets the mapper pick precise controls.
const SU_COLS = {
  ParentSupportUnit: "Lookup", Contact: "Lookup", Calendar: "Lookup", SupportWorkingDayType: "Lookup",
  Active: "Boolean", SupportEmpIndex: "Integer", Canprocessreopencases: "Boolean", SupportCaseLimit: "Integer",
};

const eff = mergeHierarchy(load("supportunitemployee", ["SupportCalendar_base.js", "SupportService.js"]));
const cs = mapToFreedom(eff, { entityColumns: SU_COLS });

console.log("===== SupportUnit -> Freedom ChangeSet =====");
console.log("viewConfigDiff inserts:");
for (const op of cs.viewConfigDiff)
  console.log(`   ${op.values.type.padEnd(20)} ${op.name.padEnd(24)} -> ${op.parentName}`);
console.log("entityBusinessRules:", cs.entityBusinessRules.map(r => `${r.targetAttribute}(apply-static-filter)`).join(", "));
console.log("pageBusinessRules:", cs.pageBusinessRules.map(r => `${r.element}:${r.action}(+${r.inverseAction})`).join(", "));
console.log("details:", cs.details.map(d => `${d.detailSchema}[${d.entity}] dep=${d.dependency ? d.dependency.attributePath + "->" + d.dependency.relationPath : "?"}`).join("; "));
console.log("handlerStubs:", cs.handlerStubs.map(h => `${h.sourceMethod}(${h.category})`).join(", "));
console.log("needsDecision:", cs.needsDecision.length, "->", [...new Set(cs.needsDecision.map(n => n.kind))].join(", "));

let pass = 0, fail = 0;
const check = (n, c) => (c ? (pass++, console.log("  ✅ " + n)) : (fail++, console.log("  ❌ " + n)));
const field = (b) => cs.viewConfigDiff.find(o => o.name === b);

console.log("assertions:");
const suFieldOps = cs.viewConfigDiff.filter(o => o.values?.control);
check("8 field inserts", suFieldOps.length === 8);
check("all fields into SideAreaProfileContainer (container-role mapping)",
  suFieldOps.every(o => o.parentName === "SideAreaProfileContainer"));
check("lookups -> crt.ComboBox", ["ParentSupportUnit", "Contact", "Calendar", "SupportWorkingDayType"]
  .every(b => field(b)?.values.type === "crt.ComboBox"));
check("Active -> crt.Checkbox", field("Active")?.values.type === "crt.Checkbox");
check("SupportEmpIndex/SupportCaseLimit -> crt.NumberInput",
  field("SupportEmpIndex")?.values.type === "crt.NumberInput" && field("SupportCaseLimit")?.values.type === "crt.NumberInput");
check("2 entity filter rules (Parent + SupportWorkingDayType)",
  cs.entityBusinessRules.length === 2 && cs.entityBusinessRules.some(r => r.targetAttribute === "SupportWorkingDayType"));
check("2 page rules make-required with inverse (Contact + Calendar)",
  cs.pageBusinessRules.length === 2 && cs.pageBusinessRules.every(r => r.action === "make-required" && r.inverseAction === "make-optional"));
check("3 details as Expanded list with dependency",
  cs.details.length === 3 && cs.details.some(d => d.detailSchema === "SupportScheduleEmployeeDetail"
    && d.dependency?.attributePath === "SupportUnit" && d.dependency?.relationPath === "PDS.Id"));
check("setName -> handler stub", cs.handlerStubs.some(h => h.sourceMethod === "setName"));
check("chart widgets flagged as needsDecision (component)", cs.needsDecision.some(n => n.kind === "component"));

// Contract sanity — TRUE dependency order (F1), with base-template seed (F2).
const seed = load("_base", ["BaseModulePageV2_skeleton.js"]);
const coEff = mergeHierarchy(load("contract", [
  "CoreContracts.js", "SalesContracts.js", "DocumentInContract.js", "ContractInInvoice.js",
  "ContractInOrder.js", "WorkOverride.js", "WorkSalesBase.js", "WorkCompliance.js", "WorkContractsProcess.js"]),
  { seedTemplate: seed });
const co = mapToFreedom(coEff);
console.log(`\n===== Contract sanity =====`);
console.log(`viewConfigDiff=${co.viewConfigDiff.length} entityRules=${co.entityBusinessRules.length} pageRules=${co.pageBusinessRules.length} details=${co.details.length} handlerStubs=${co.handlerStubs.length} needsDecision=${co.needsDecision.length}`);
check("Contract: Owner apply-static-filter present", co.entityBusinessRules.some(r => r.targetAttribute === "Owner"));
check("Contract: Parent make-required present", co.pageBusinessRules.some(r => r.element === "Parent" && r.action === "make-required"));
// Regression guard for the symbolic-enum BLOCKER fix: legacy FILTRATION rules (declared via
// BusinessRuleModule.enums.RuleType.FILTRATION) must resolve, not collapse to BINDPARAMETER/1-rule.
check("Contract: legacy FILTRATION rules resolved (entityRules > 1)", co.entityBusinessRules.length > 1);
check("Contract: no rules mis-mapped to 'symbolic'", !co.needsDecision.some(n => n.kind === "rule" && /symbolic|unresolved/.test(n.reason)));

// ---- F3: container/tab tree (not flattened) ----
const vop = (name) => co.viewConfigDiff.find(o => o.name === name);
const parentOf = (name) => vop(name)?.parentName;
console.log("F3 routing:");
console.log(`   tab containers: ${co.viewConfigDiff.filter(o => o.values?.type === "crt.Tab").map(o => o.name).join(", ")}`);
console.log(`   Account -> ${parentOf("Account")}; Number -> ${parentOf("Number")}`);
check("F3: GeneralInfoTab emitted as a tab (crt.Tab)", vop("GeneralInfoTab")?.values.type === "crt.Tab");
check("F3: GeneralInfoTabGrid container emitted under the tab", parentOf("GeneralInfoTabGrid") === "GeneralInfoTab");
check("F3: GeneralInfoTab fields routed into their nested group grid (Account, CustomerBillingInfo)",
  parentOf("Account") === "group_gridLayout" && parentOf("CustomerBillingInfo") === "group_gridLayout");
check("F3/C5: the classic CONTROL_GROUP is built as a crt.ExpansionPanel (the 'Delivery' group)",
  vop("GeneralInfoTabGroupe00b109d")?.values.type === "crt.ExpansionPanel");
check("F3/C5: the group's fields route inside its panel grid (ContractReturnDate, DeliveryType)",
  parentOf("ContractReturnDate") === "GeneralInfoTabGridLayoutc608aa43"
  && parentOf("DeliveryType") === "GeneralInfoTabGridLayoutc608aa43");
check("F3/layout: WIDE Header → full-width header grid, not the narrow profile (Number, Owner)",
  parentOf("Number") === "HeaderContainer" && parentOf("Owner") === "HeaderContainer");
check("F3/layout: wide-header flagged (layout-type) + HeaderContainer built",
  co.needsDecision.some(n => n.kind === "layout-type") && !!vop("HeaderContainer"));
check("F3/layout: classic multi-column coords preserved (Owner at Freedom column > 1)",
  vop("Owner")?.values.layoutConfig.column > 1);
check("F3/features: Approvals(Visa)/Attachments(Files)/Activities are standard features, NOT generic details",
  co.standardFeatures.some(s => s.feature === "Approvals") && !co.details.some(d => d.detailSchema === "VisaDetailV2"));
check("F3/actions: card actions / ACTIONS-menu flagged (B7)",
  co.needsDecision.some(n => n.kind === "card-action"));
// widgets: synthetic (the curated fixture lacks the dashboard modules the real page has)
const wCs = mapToFreedom(mergeHierarchy([L("Client", { entity: "X",
  modules: [{ key: "ActionsDashboardModule", moduleName: "ActionsDashboardModule" }],
  diff: [di({ name: "DuplicatesWidgetContainer", itemType: 0, parentName: "LeftModulesContainer" })] })]));
check("F3/widgets: Action Dashboard (module) + Duplicates (container) recognized → Freedom analogs",
  wCs.widgets.some(w => w.widget === "ActionDashboard") && wCs.widgets.some(w => w.widget === "Duplicates"));
check("F3: layout is NOT flattened (≥2 distinct field containers)",
  new Set(co.viewConfigDiff.filter(o => o.values?.control).map(o => o.parentName)).size >= 2);
check("F3: no field left in the old catch-all GeneralInfoTabContainer",
  !co.viewConfigDiff.some(o => o.parentName === "GeneralInfoTabContainer"));

/* ---- F9: template (seed) elements are layout context, excluded from the migration payload ---- */
// L/di are the shared schema/op builders (see _testkit.mjs), aliased to keep the assertions terse.
// Seed contributes a bound FIELD and a business RULE too (the primary payload) — not only methods/details/
// components — so their exclusion is asserted POSITIVELY, not "0 by accident".
const f9seed = L("Tpl", {
  diff: [di({ name: "Header", itemType: 15 }), di({ name: "TplField", parentName: "Header", propertyName: "items", bindTo: "TplCol" })],
  methods: ["frameworkInit", "getActions"],
  businessRules: { TplCol: { tplRule: { ruleType: 0, property: 0 } } },        // base BINDPARAMETER/Visible rule
  details: { TplDetail: { schemaName: "TplDetail", entitySchemaName: "TplE" } }, modules: [{ key: "TplChart", moduleName: "DashboardModule" }] });
const f9client = L("Client", { entity: "X",
  diff: [di({ name: "Name", parentName: "Header", propertyName: "items", bindTo: "Name" })],
  methods: ["clientSave"],
  businessRules: { Name: { reqRule: { ruleType: 0, property: 2 } } },          // client BINDPARAMETER/Required rule
  details: { ClientDetail: { schemaName: "ClientDetail", entitySchemaName: "ClientE", detailColumn: "X", masterColumn: "Id" } } });
const f9cs = mapToFreedom(mergeHierarchy([f9client], { seedTemplate: [f9seed] }));
check("F9: seed method is context, only the client method is payload",
  f9cs.handlerStubs.length === 1 && f9cs.handlerStubs[0].sourceMethod === "clientSave");
check("F9: seed FIELD excluded, client field kept",
  f9cs.viewConfigDiff.some(o => o.name === "Name") && !f9cs.viewConfigDiff.some(o => o.name === "TplField"));
check("F9: seed RULE excluded, client rule kept",
  f9cs.pageBusinessRules.some(r => r.element === "Name") && !f9cs.pageBusinessRules.some(r => r.element === "TplCol"));
check("F9: seed detail excluded, client detail kept",
  f9cs.details.length === 1 && f9cs.details[0].detailSchema === "ClientDetail");
check("F9: seed chart/widget excluded from payload",
  !f9cs.needsDecision.some(n => n.kind === "component"));
check("F9: baseContextExcluded reports ALL template categories (field+rule+method+detail+component)",
  f9cs.baseContextExcluded.fields === 1 && f9cs.baseContextExcluded.rules === 1 &&
  f9cs.baseContextExcluded.methods === 2 && f9cs.baseContextExcluded.details === 1 && f9cs.baseContextExcluded.components === 1);
check("F9: the client field still routes into the layout (Header→profile)",
  f9cs.viewConfigDiff.some(o => o.name === "Name" && o.parentName === "SideAreaProfileContainer"));

/* ---- F9×F3: a payload field under a SEEDED base tab must NOT spawn a fresh crt.Tab ---- */
const btSeed = L("Tpl", { diff: [di({ name: "Tabs", itemType: 15 }),
  di({ name: "ESNTab", parentName: "Tabs", propertyName: "tabs", itemType: 15, isTab: true })] });
const btClient = L("Client", { entity: "X",
  diff: [di({ name: "Note", parentName: "ESNTab", propertyName: "items", bindTo: "Note" })] });
const btcs = mapToFreedom(mergeHierarchy([btClient], { seedTemplate: [btSeed] }));
check("F9×F3: no fresh crt.Tab insert synthesized for a base-template tab (ESNTab)",
  !btcs.viewConfigDiff.some(o => o.name === "ESNTab" && o.values?.type === "crt.Tab"));
check("F9×F3: base-template tab placement flagged as needsDecision",
  btcs.needsDecision.some(n => n.kind === "base-tab-placement" && n.item === "ESNTab"));
check("F9×F3: the field routes into the EXISTING base tab, not a synthesized grid",
  btcs.viewConfigDiff.some(o => o.name === "Note" && o.parentName === "ESNTab"));

/* ---- B1 (Blocker): a base tab a CLIENT schema merges is STILL template-owned (origin=insert) — the
   common reorder/re-caption case the prior fix missed. Must not synthesize a duplicate crt.Tab. ---- */
const b1seed = L("Tpl", { diff: [di({ name: "Tabs", itemType: 15 }),
  di({ name: "ESNTab", parentName: "Tabs", propertyName: "tabs", itemType: 15, isTab: true })] });
const b1client = L("Client", { entity: "X", diff: [
  di({ operation: "merge", name: "ESNTab", order: 5 }),                                  // client re-orders the base tab
  di({ name: "Note", parentName: "ESNTab", propertyName: "items", bindTo: "Note" })] }); // and adds a field to it
const b1eff = mergeHierarchy([b1client], { seedTemplate: [b1seed] });
const b1tab = b1eff.tabs.find(t => t.name === "ESNTab");
const b1cs = mapToFreedom(b1eff);
check("B1: client-merged base tab keeps templateOwned=true (origin=seed insert, provenance has both)",
  b1tab?.templateOwned === true && b1tab?.provenance.length === 2);
check("B1: NO fresh crt.Tab synthesized for the client-merged base tab (the missed common case)",
  !b1cs.viewConfigDiff.some(o => o.name === "ESNTab" && o.values?.type === "crt.Tab"));
check("B1: field routes into the existing base tab + base-tab-placement flagged",
  b1cs.viewConfigDiff.some(o => o.name === "Note" && o.parentName === "ESNTab")
  && b1cs.needsDecision.some(n => n.kind === "base-tab-placement" && n.item === "ESNTab"));

/* ---- C3: a template-internal remove (by a seed schema) is context, not a client B6 decision ---- */
const c3seed = L("Tpl", { diff: [di({ name: "BaseA", itemType: 15 }), di({ name: "BaseB", itemType: 15 }),
  di({ operation: "remove", name: "BaseB" })] });                    // seed removes its OWN base element
const c3client = L("Client", { entity: "X", diff: [di({ operation: "remove", name: "BaseA" })] }); // client removes a base element
const c3cs = mapToFreedom(mergeHierarchy([c3client], { seedTemplate: [c3seed] }));
check("C3: client remove of a base element surfaces as a removal decision (BaseA)",
  c3cs.needsDecision.some(n => n.kind === "removal" && n.item === "BaseA"));
check("C3: template-internal remove (seed removed its own element) is NOT a removal decision (BaseB)",
  !c3cs.needsDecision.some(n => n.kind === "removal" && n.item === "BaseB"));

/* ---- C5 build-out: a classic CONTROL_GROUP inside a tab becomes a crt.ExpansionPanel (not flattened) ---- */
const c5client = L("Client", { entity: "X", diff: [
  di({ name: "MyTab", parentName: "Tabs", propertyName: "tabs", itemType: 15, isTab: true }),
  di({ name: "Grp1", parentName: "MyTab", itemType: 15 }),                          // CONTROL_GROUP
  di({ name: "GF", parentName: "Grp1", propertyName: "items", bindTo: "ColG" })] });
const c5cs = mapToFreedom(mergeHierarchy([c5client]));
check("C5: CONTROL_GROUP is BUILT as a crt.ExpansionPanel under the tab",
  c5cs.viewConfigDiff.some(o => o.name === "Grp1" && o.values?.type === "crt.ExpansionPanel"));
check("C5: field routes into the GROUP's grid (nesting preserved, not flattened to the tab grid)",
  c5cs.viewConfigDiff.some(o => o.name === "ColG" && o.parentName === "Grp1Grid"));
check("C5: synthesized group caption flagged (group-caption)",
  c5cs.needsDecision.some(n => n.kind === "group-caption" && n.item === "Grp1"));

/* ---- C4: a rule targeting a field not inserted in the ChangeSet is flagged (dangling) ---- */
const c4seed = L("Tpl", { diff: [di({ name: "Header", itemType: 15 }),
  di({ name: "BaseFld", parentName: "Header", propertyName: "items", bindTo: "BaseCol" })] });
const c4client = L("Client", { entity: "X", diff: [], businessRules: { BaseCol: { r: { ruleType: 0, property: 2 } } } });
const c4cs = mapToFreedom(mergeHierarchy([c4client], { seedTemplate: [c4seed] }));
check("C4: rule on a base (excluded) field is flagged rule-target-missing",
  c4cs.needsDecision.some(n => n.kind === "rule-target-missing" && n.item === "BaseCol")
  && !c4cs.viewConfigDiff.some(o => o.name === "BaseCol"));

/* ---- Detail placement (tab + order) + editability not assumed ---- */
const dClient = L("Client", { entity: "X", diff: [
  di({ name: "MyTab", parentName: "Tabs", propertyName: "tabs", itemType: 15, isTab: true }),
  di({ name: "Prod", parentName: "MyTab", itemType: 2, order: 3 })],           // detail grid placed in MyTab, pos 3
  details: { Prod: { schemaName: "ProdDetailV2", entitySchemaName: "OrderProduct", detailColumn: "X", masterColumn: "Id" } } });
const dcs = mapToFreedom(mergeHierarchy([dClient]));
const prod = dcs.details.find(d => d.detailSchema === "ProdDetailV2");
check("Detail: resolved to its owning tab (MyTab) with order", prod?.tab === "MyTab" && prod?.order === 3);
check("Detail: editability NOT hardcoded to 'add' — actions unresolved + flagged",
  prod?.actions === "unresolved" && dcs.needsDecision.some(n => n.kind === "detail-editability" && n.item === "ProdDetailV2"));

/* ---- entity-filter: dynamic (no static value) flagged incomplete; static one complete ---- */
const efClient = L("Client", { entity: "X",
  diff: [di({ name: "Lk", parentName: "Header", propertyName: "items", bindTo: "Lk" }),
         di({ name: "St", parentName: "Header", propertyName: "items", bindTo: "St" })],
  businessRules: {
    Lk: { r: { ruleType: 1, baseAttributePatch: "OtherCol" } },                                              // FILTRATION, dynamic (no value)
    St: { r: { ruleType: 1, baseAttributePatch: "Active", comparisonType: 3, value: true, dataValueType: 12 } } } }); // static
const efcs = mapToFreedom(mergeHierarchy([efClient]));
const lk = efcs.entityBusinessRules.find(r => r.targetAttribute === "Lk");
const st = efcs.entityBusinessRules.find(r => r.targetAttribute === "St");
check("entity-filter: dynamic filter marked incomplete + flagged (entity-filter)",
  lk?.complete === false && efcs.needsDecision.some(n => n.kind === "entity-filter" && n.item === "Lk"));
check("entity-filter: static filter marked complete + NOT flagged",
  st?.complete === true && !efcs.needsDecision.some(n => n.kind === "entity-filter" && n.item === "St"));

/* ---- image component + tooltip carry (Product gaps) ---- */
const imgCs = mapToFreedom(mergeHierarchy([L("Client", { entity: "X", diff: [
  di({ name: "Photo", parentName: "Header", generator: "ImageCustomGeneratorV2.generateCustomImageControl" }),
  di({ name: "Code", parentName: "Header", propertyName: "items", bindTo: "Code", tip: "Resources.Strings.CodeTip" })] })]));
check("image component (generator-based, no bindTo) recognized → images[] + needsDecision",
  imgCs.images.some(i => i.classic === "Photo") && imgCs.needsDecision.some(n => n.kind === "image" && n.item === "Photo"));
check("tooltip carried onto the Freedom field (tip.content)",
  imgCs.viewConfigDiff.find(o => o.name === "Code")?.values.tip?.content === "$Resources.Strings.CodeTip");

/* ---- visibility respected (not hardcoded true) + feature toggles flagged ---- */
const visCs = mapToFreedom(mergeHierarchy([L("Client", { entity: "X", features: ["UseNewProductCatalogue"], diff: [
  di({ name: "Hidden", parentName: "Header", propertyName: "items", bindTo: "Hidden", visible: false }),
  di({ name: "Shown", parentName: "Header", propertyName: "items", bindTo: "Shown" })] })]));
check("static visible:false is respected on the Freedom field (not forced true)",
  visCs.viewConfigDiff.find(o => o.name === "Hidden")?.values.visible === false
  && visCs.viewConfigDiff.find(o => o.name === "Shown")?.values.visible === true);
check("feature toggles flagged (feature-toggle) — mapping is the full union, page shows one state",
  visCs.needsDecision.some(n => n.kind === "feature-toggle" && /UseNewProductCatalogue/.test(n.item)));

/* ---- getActions custom action surfaced into cardActions + real caption used (no synth flag) ---- */
const actCs = mapToFreedom(mergeHierarchy([L("Client", { entity: "X", actionHints: ["navigateToTaxesByCountriesLookup"],
  methods: ["getActions"], diff: [
  di({ name: "MyTab", parentName: "Tabs", propertyName: "tabs", itemType: 15, isTab: true, caption: "Resources.Strings.MyTabCap" }),
  di({ name: "F", parentName: "MyTab", propertyName: "items", bindTo: "F" })] })]));
check("getActions custom action surfaced into cardActions (not lost)",
  actCs.cardActions.includes("navigateToTaxesByCountriesLookup"));
check("real tab caption kept as the classic binding (not synthesized) + flagged UNRESOLVED when no resources supplied (#13)",
  actCs.viewConfigDiff.find(o => o.name === "MyTab")?.values.caption === "$Resources.Strings.MyTabCap"
  && actCs.needsDecision.some(n => n.kind === "tab-caption" && n.item === "MyTab" && /unresolved/.test(n.reason)));

/* ---- Fix 1: classic `hint` → field tooltip (static) vs field-hint decision (dynamic) ---- */
const hintCs = mapToFreedom(mergeHierarchy([L("Client", { entity: "X", diff: [
  di({ name: "S", parentName: "Header", propertyName: "items", bindTo: "S", hint: "Resources.Strings.SHint" }),
  di({ name: "D", parentName: "Header", propertyName: "items", bindTo: "D", hint: "getDynamicHint" }),
  di({ name: "B", parentName: "Header", propertyName: "items", bindTo: "B", tip: "Resources.Strings.BTip", hint: "getDynB" })] })]));
check("static `hint` (Resources.Strings.*) → Freedom field tooltip (tip.content)",
  hintCs.viewConfigDiff.find(o => o.name === "S")?.values.tip?.content === "$Resources.Strings.SHint"
  && !hintCs.needsDecision.some(n => n.kind === "field-hint" && n.item === "S"));
check("dynamic `hint` (method-bound) → field-hint decision, not a broken static tip",
  hintCs.needsDecision.some(n => n.kind === "field-hint" && n.item === "D")
  && !hintCs.viewConfigDiff.find(o => o.name === "D")?.values.tip);
check("field-hint: a dynamic hint is flagged EVEN when a static tip already occupies the tooltip (not swallowed)",
  hintCs.needsDecision.some(n => n.kind === "field-hint" && n.item === "B")
  && hintCs.viewConfigDiff.find(o => o.name === "B")?.values.tip?.content === "$Resources.Strings.BTip");

/* ---- Fix 2: LOUD unmapped-component (client content the mapper produced nothing for) ---- */
const umCs = mapToFreedom(mergeHierarchy([L("Client", { entity: "X", refModules: ["CasesEstimateLabel"], diff: [
  di({ name: "F", parentName: "Header", propertyName: "items", bindTo: "F" }),                        // field → mapped
  di({ name: "TimerLabel", parentName: "Header", propertyName: "items", caption: "getTimer" }),       // LABEL, no bindTo → unmapped
  di({ name: "MyGrid", parentName: "Header", propertyName: "items" }),                                // scaffolding (Grid$) → skipped
  di({ name: "EscalateButton", parentName: "Header", propertyName: "items" }),                        // custom button → unmapped
  di({ name: "SlaGroup", parentName: "Header", propertyName: "items", caption: "getSla" }),           // childless + struct NAME + content → must surface
  di({ name: "RealGroup", parentName: "Header", propertyName: "items" }),                             // struct NAME parent (child below) → skip
  di({ name: "RealGroupLabel", parentName: "RealGroup", propertyName: "items", caption: "x" })] })])); // non-field child → makes RealGroup a parent
check("unmapped-component: a client LABEL/container with no Freedom element is surfaced (LOUD, not silent)",
  umCs.needsDecision.some(n => n.kind === "unmapped-component" && n.item === "TimerLabel"));
check("unmapped-component: a custom *Button is surfaced with card-action guidance",
  umCs.needsDecision.some(n => n.kind === "unmapped-component" && n.item === "EscalateButton" && /card action/.test(n.reason)));
check("unmapped-component: grid/tab scaffolding the mapper rebuilds is NOT flagged (no noise)",
  !umCs.needsDecision.some(n => n.kind === "unmapped-component" && n.item === "MyGrid"));
check("unmapped-component: a mapped field is NOT flagged as unmapped",
  !umCs.needsDecision.some(n => n.kind === "unmapped-component" && n.item === "F"));
check("unmapped-component: a CHILDLESS struct-named content item (SlaGroup) IS surfaced — no silent drop on name alone",
  umCs.needsDecision.some(n => n.kind === "unmapped-component" && n.item === "SlaGroup"));
check("unmapped-component: a struct-named PARENT container (RealGroup, has a child) is NOT surfaced (no noise)",
  !umCs.needsDecision.some(n => n.kind === "unmapped-component" && n.item === "RealGroup"));
const umTpl = mapToFreedom(mergeHierarchy([L("Client", { entity: "X", diff: [di({ name: "CF", parentName: "Header", propertyName: "items", bindTo: "CF" })] })],
  { seedTemplate: [L("Base", { entity: "X", diff: [di({ name: "BaseLabel", parentName: "Header", propertyName: "items", caption: "x" })] })] }));
check("unmapped-component: template-owned items are NOT flagged (payload = client content only, F9)",
  !umTpl.needsDecision.some(n => n.kind === "unmapped-component" && n.item === "BaseLabel"));

/* ---- Fix 3: referenced UI modules (define() deps) surfaced + exposed on the ChangeSet ---- */
check("referenced-module: define()-dep UI module flagged (outside the page-schema migration unit)",
  umCs.needsDecision.some(n => n.kind === "referenced-module" && n.item === "CasesEstimateLabel"));
check("referenced-module: exposed on the ChangeSet for the migration report",
  (umCs.referencedModules || []).includes("CasesEstimateLabel"));

/* ---- migrate.mjs CLI driver: end-to-end on the real SupportUnit fixtures (file-reading path) ---- */
const cli = runMigration({
  entity: "SupportUnit", entityColumns: SU_COLS,
  schemas: [
    { pkg: "SupportCalendar", file: "supportunitemployee/SupportCalendar_base.js" },
    { pkg: "SupportService", file: "supportunitemployee/SupportService.js" },
  ],
}, { baseDir: FIX });
check("migrate.mjs: runMigration produces a ChangeSet (entity + non-empty viewConfigDiff)",
  cli.entity === "SupportUnit" && cli.changeSet.viewConfigDiff.length > 0);
check("migrate.mjs: no parse errors + effective counts + decisionSummary surfaced",
  cli.parseErrors.length === 0 && cli.effective.fields > 0 && typeof cli.decisionSummary === "object" && Object.keys(cli.decisionSummary).length > 0);
check("migrate.mjs: entity '?' falls back to the merged effective entity",
  runMigration({ entity: "?", schemas: [
    { pkg: "SupportCalendar", file: "supportunitemployee/SupportCalendar_base.js" },
    { pkg: "SupportService", file: "supportunitemployee/SupportService.js" }] }, { baseDir: FIX }).entity === "SupportUnit");
const migBad = spawnSync(process.execPath, [path.join(ENGINE_DIR, "migrate.mjs"), "-"], { input: "{ not json", encoding: "utf8" });
check("migrate.mjs CLI: malformed manifest exits 1 with a diagnostic and no stdout (not a raw stack)",
  migBad.status === 1 && /migrate\.mjs:/.test(migBad.stderr || "") && (migBad.stdout || "").trim() === "");

/* ---- Phase-2 review fixes: #6 (Activities≠Timeline + suffix match), #7 (template-provided), #14 (24-col grid), #15 (detail-caption) ---- */
const featCs = mapToFreedom(mergeHierarchy([L("Client", { entity: "X",
  details: {
    MyAct:   { schemaName: "ApplicantActivityDetailV2", entitySchemaName: "Activity" },
    MyEmail: { schemaName: "ApplicantEmailDetailV2",    entitySchemaName: "Activity" },
    MyFiles: { schemaName: "FileDetailV2",              entitySchemaName: "File" },
    MyReq:   { schemaName: "SomeRequestDetail",         entitySchemaName: "Request" },
  },
  diff: [
    di({ name: "T", parentName: "Tabs", propertyName: "tabs", isTab: true, caption: "Resources.Strings.TCap" }),
    di({ name: "MyAct", parentName: "T", propertyName: "items" }),
    di({ name: "MyEmail", parentName: "T", propertyName: "items" }),
    di({ name: "MyFiles", parentName: "T", propertyName: "items" }),
    di({ name: "MyReq", parentName: "T", propertyName: "items", caption: "Resources.Strings.ReqCap" }),
    di({ name: "TF", parentName: "T", propertyName: "items", bindTo: "TF" })] })]));
const sf = (c) => featCs.standardFeatures.find(s => s.classicDetail === c);
check("#6: ActivityDetailV2 → Activities feature, freedom label does NOT say Timeline",
  sf("ApplicantActivityDetailV2")?.feature === "Activities" && !/Timeline/i.test(sf("ApplicantActivityDetailV2")?.freedom ?? ""));
check("#6/#11: entity-prefixed variant (ApplicantEmailDetailV2) matched as Emails via suffix",
  sf("ApplicantEmailDetailV2")?.feature === "Emails");
check("#7: FileDetailV2 (Attachments) flagged templateProvided + 'do NOT create' note",
  sf("FileDetailV2")?.templateProvided === true
  && featCs.needsDecision.some(n => n.kind === "standard-feature" && n.item === "FileDetailV2" && /do NOT create/i.test(n.reason)));
check("#14: structural GridContainer carries a 24-column grid config",
  featCs.viewConfigDiff.some(o => o.values?.type === "crt.GridContainer" && Array.isArray(o.values.columns) && o.values.columns.length === 24));
check("#15: a resource-key detail caption → detail-caption decision (resolve, don't invent)",
  featCs.needsDecision.some(n => n.kind === "detail-caption" && n.item === "SomeRequestDetail"));

/* ---- #18: fields nested under LeftModulesContainer (the base LEFT profile area) route to the side
   profile, NOT a fallback tab — the real cause of "profile fields in the wrong place" once seeded ---- */
const lmSeed = L("Tpl", { diff: [di({ name: "LeftModulesContainer", itemType: 15 }), di({ name: "Tabs", itemType: 15 })] });
const lmClient = L("Client", { entity: "X", diff: [
  di({ name: "ContactContainer", parentName: "LeftModulesContainer", itemType: 0 }),         // client "island" wrapper
  di({ name: "InternalRequestContainer", parentName: "LeftModulesContainer", itemType: 0 }), // second island
  di({ name: "Phone", parentName: "ContactContainer", propertyName: "items", bindTo: "Phone" }),
  di({ name: "Email", parentName: "ContactContainer", propertyName: "items", bindTo: "Email" }),
  di({ name: "ReqNo", parentName: "InternalRequestContainer", propertyName: "items", bindTo: "ReqNo" })] });
const lmcs = mapToFreedom(mergeHierarchy([lmClient], { seedTemplate: [lmSeed] }));
check("#18: island fields resolve to the side profile, NOT the fallback tab (+ no bogus container decision)",
  !lmcs.needsDecision.some(n => n.kind === "container")
  && !lmcs.viewConfigDiff.some(o => o.parentName === "GeneralInfoTabContainer"));
check("#18: the island wrappers are NOT mis-flagged as unmapped-component (their fields were migrated)",
  !lmcs.needsDecision.some(n => n.kind === "unmapped-component" && n.item.endsWith("Container")));
// #9b — with >1 island, each field routes into its OWN island container (the classic split is preserved,
// not flattened into one stack). This is the "second island" the user could not see before.
check("#9b: with 2 islands, fields route into their own island container (split preserved)",
  lmcs.viewConfigDiff.find(o => o.name === "Phone")?.parentName === "ContactContainer"
  && lmcs.viewConfigDiff.find(o => o.name === "Email")?.parentName === "ContactContainer"
  && lmcs.viewConfigDiff.find(o => o.name === "ReqNo")?.parentName === "InternalRequestContainer");
check("#9b: each island built as a crt.GridContainer under SideAreaProfileContainer",
  ["ContactContainer", "InternalRequestContainer"].every(n => {
    const o = lmcs.viewConfigDiff.find(x => x.name === n);
    return o?.values?.type === "crt.GridContainer" && o.parentName === "SideAreaProfileContainer"; }));
check("#9b: multi-island surfaced as ONE profile-island decision naming both islands",
  lmcs.needsDecision.some(n => n.kind === "profile-island"
    && /ContactContainer/.test(n.item) && /InternalRequestContainer/.test(n.item)));
// a SINGLE island must NOT be split (no redundant wrapper, no nag) — fields stay flat in the profile.
const oneIsland = mapToFreedom(mergeHierarchy([L("Client", { entity: "X", diff: [
  di({ name: "ContactContainer", parentName: "LeftModulesContainer", itemType: 0 }),
  di({ name: "A", parentName: "ContactContainer", propertyName: "items", bindTo: "A" }),
  di({ name: "B", parentName: "ContactContainer", propertyName: "items", bindTo: "B" })] })], { seedTemplate: [lmSeed] }));
check("#9b: a SINGLE island stays flat in SideAreaProfileContainer (no wrapper container, no profile-island nag)",
  ["A", "B"].every(n => oneIsland.viewConfigDiff.find(o => o.name === n)?.parentName === "SideAreaProfileContainer")
  && !oneIsland.viewConfigDiff.some(o => o.name === "ContactContainer")
  && !oneIsland.needsDecision.some(n => n.kind === "profile-island"));

/* ---- #18: an unresolved chain that never reaches an anchor is flagged with the ACCURATE reason
   (the container IS defined, but climbs to root) — not the misleading "not defined by any schema" ---- */
const naClient = L("Client", { entity: "X", diff: [
  di({ name: "OrphanBox", itemType: 0 }),                                                    // defined, but no chain to an anchor
  di({ name: "Lost", parentName: "OrphanBox", propertyName: "items", bindTo: "Lost" })] });
const nacs = mapToFreedom(mergeHierarchy([naClient]));
check("#18: no-anchor chain flagged with the accurate 'never reaches a profile/tab anchor' reason",
  nacs.needsDecision.some(n => n.kind === "container" && /never reaches a profile\/tab anchor/.test(n.reason)));

/* ---- #11: dedup — the same detail under two placements collapses to ONE (resolved tab wins) ---- */
const dupClient = L("Client", { entity: "X", details: {
    D1: { schemaName: "ReqDetail", entitySchemaName: "Req", detailColumn: "M", masterColumn: "Id" },  // placed under a tab
    D2: { schemaName: "ReqDetail", entitySchemaName: "Req", detailColumn: "M", masterColumn: "Id" } }, // duplicate, no parent
  diff: [
    di({ name: "T", parentName: "Tabs", propertyName: "tabs", isTab: true, caption: "Resources.Strings.TCap" }),
    di({ name: "D1", parentName: "T", propertyName: "items", itemType: 2 }),
    di({ name: "D2", itemType: 2 })] });                                                      // D2 has no resolvable parent
const dupcs = mapToFreedom(mergeHierarchy([dupClient]));
check("#11: duplicate detail (same schema+entity+FK) emitted ONCE, keeping the resolved tab",
  dupcs.details.filter(d => d.detailSchema === "ReqDetail").length === 1
  && dupcs.details.find(d => d.detailSchema === "ReqDetail")?.tab === "T");

/* ---- #11: a detail over a *File entity is recognised as Attachments even when the schema name is an
   auto-generated placeholder (SchemaNDetail) that hides it — flagged as inferred ---- */
const fileClient = L("Client", { entity: "X", details: {
    Files: { schemaName: "Schema1Detail", entitySchemaName: "ApplicantFile", detailColumn: "Applicant", masterColumn: "Id" } },
  diff: [di({ name: "T2", parentName: "Tabs", propertyName: "tabs", isTab: true, caption: "Resources.Strings.T2" }),
         di({ name: "Files", parentName: "T2", propertyName: "items", itemType: 2 })] });
const filecs = mapToFreedom(mergeHierarchy([fileClient]));
check("#11: *File-entity detail → Attachments feature (templateProvided, inferred), NOT a generic custom detail",
  filecs.standardFeatures.some(s => s.feature === "Attachments" && s.templateProvided && s.inferredFromEntity)
  && !filecs.details.some(d => d.entity === "ApplicantFile"));
check("#11: entity-inferred Attachments carries a 'confirm / inferred' note",
  filecs.needsDecision.some(n => n.kind === "standard-feature" && /inferred from the entity/.test(n.reason)));

/* ---- #11: an auto-generated detail name over a NON-file entity is surfaced LOUD (fetch its schema) ---- */
const autoClient = L("Client", { entity: "X", details: {
    Auto: { schemaName: "Schema2Detail", entitySchemaName: "SomeChild", detailColumn: "P", masterColumn: "Id" } },
  diff: [di({ name: "T3", parentName: "Tabs", propertyName: "tabs", isTab: true, caption: "Resources.Strings.T3" }),
         di({ name: "Auto", parentName: "T3", propertyName: "items", itemType: 2 })] });
const autocs = mapToFreedom(mergeHierarchy([autoClient]));
check("#11: auto-generated detail schema name (SchemaNDetail) flagged detail-unresolved (fetch its schema)",
  autocs.needsDecision.some(n => n.kind === "detail-unresolved" && n.item === "Schema2Detail" && /get-classic-schema-by-uid/.test(n.reason)));

/* ---- #10c: the design spec is GENERATED deterministically (table, not agent prose) ---- */
// The recurring failure: the agent paraphrases the design spec into prose (no per-field table, wrong
// feature labels). The engine emits the table itself; the skill presents it verbatim.
check("design-spec: runMigration returns a Markdown design spec string",
  typeof cli.designSpec === "string" && cli.designSpec.startsWith("## Design spec"));
check("design-spec: ONE Layout table (Region · Element · Type · Source · Rule · Additional) under the form-page heading",
  /#### Layout/.test(cli.designSpec) && / form page$/m.test(cli.designSpec) && /Region \| Element \| Type \| Source \| Rule \| Additional/.test(cli.designSpec));
check("design-spec: one Layout row (PDS attribute) per effective field — nothing dropped/invented",
  cli.designSpec.split("\n").filter(l => /\| PDS\./.test(l)).length === cli.effective.fields);
check("design-spec: legacy split tables gone (no Region map / Fields / Details & standard features)",
  !/### Region map/.test(cli.designSpec) && !/### Fields/.test(cli.designSpec) && !/### Details & standard features/.test(cli.designSpec));
check("design-spec: Confirm section present (⚠ worklist)",
  /#### ⚠ Confirm before I build/.test(cli.designSpec));
// a clean (non-skeletal) seed defining the base containers the SupportUnit fixture patches — so these CLI
// runs are gate-CLEAN (exit 0, no ⛔ banner) and stay pure shape tests; the blocked path is tested separately.
const CLEAN_SEED = [{ pkg: "BaseModulePageV2", body: 'define("BaseModulePageV2",[],function(){return{diff:[{operation:"insert",name:"ProfileContainer",values:{itemType:15}},{operation:"insert",name:"Tabs",values:{itemType:15}},{operation:"insert",name:"ESNTab",parentName:"Tabs",propertyName:"tabs",values:{itemType:15}},{operation:"insert",name:"ChangesHistoryTab",parentName:"Tabs",propertyName:"tabs",values:{itemType:15}}],methods:{init:function(){},getActions:function(){}}};});' }];
const SU_SCHEMAS = [
  { pkg: "SupportCalendar", file: path.join(FIX, "supportunitemployee/SupportCalendar_base.js") },
  { pkg: "SupportService", file: path.join(FIX, "supportunitemployee/SupportService.js") }];
const specRun = spawnSync(process.execPath, [path.join(ENGINE_DIR, "migrate.mjs"), "-", "--spec"], {
  input: JSON.stringify({ entity: "SupportUnit", entityColumns: SU_COLS, schemas: SU_SCHEMAS, seed: CLEAN_SEED }), encoding: "utf8" });
check("migrate.mjs --spec: gate-clean run prints pure design-spec Markdown (## Design spec…), no JSON envelope, exit 0",
  specRun.status === 0 && (specRun.stdout || "").trim().startsWith("## Design spec") && !/"changeSet"/.test(specRun.stdout || "") && !/GATE BLOCKED/.test(specRun.stdout || ""));

/* ---- design-spec Layout: uiShape (list vs component), lookup ref, type+length, Logic handlers ---- */
const dsCs = runMigration({ entity: "X",
  entityColumns: { Contact: { type: "Lookup", ref: "Contact", title: "Contact" }, Note: { type: "text", length: 250 } },
  schemas: [{ pkg: "P", body:
    `define("P",[],function(){return{entitySchemaName:"X",details:{V:{schemaName:"VisaDetailV2",entitySchemaName:"XVisa"},A:{schemaName:"ActivityDetailV2",entitySchemaName:"Activity"}},methods:{onContactChanged:function(){}},diff:[{operation:"insert",name:"T",parentName:"Tabs",values:{itemType:15,isTab:true}},{operation:"insert",name:"Contact",parentName:"T",propertyName:"items",values:{bindTo:"Contact"}},{operation:"insert",name:"Note",parentName:"T",propertyName:"items",values:{bindTo:"Note"}},{operation:"insert",name:"V",parentName:"T",values:{itemType:2}},{operation:"insert",name:"A",parentName:"T",values:{itemType:2}}]};});` }],
}, { baseDir: FIX });
const spec = dsCs.designSpec;
check("design-spec: lookup Type shows the referenced object — Lookup (Contact)", /Lookup \(Contact\)/.test(spec));
check("design-spec: text Type shows length — Text (250)", /Text \(250\)/.test(spec));
check("design-spec: component feature (Approvals) shown by name; list feature (Activities) as Related list",
  /\| Approvals \| Approvals \|/.test(spec) && /\| Activities \| Related list \|/.test(spec));
// Visa=Approvals domain note must ride on the standardFeature AND surface in the Layout row (the
// standard-feature decision is excluded from ⚠ Confirm) — so the agent doesn't wrongly downgrade it.
check("Approvals: Visa carries the 'don't downgrade' domain note in the feature + design-spec Layout row",
  dsCs.changeSet.standardFeatures.some(s => s.feature === "Approvals" && /how Approvals is stored/.test(s.note || ""))
  && /Approvals[\s\S]*?how Approvals is stored/.test(spec));
check("design-spec: Logic table lists the handler (onContactChanged → Contact changes)",
  /#### Logic/.test(spec) && /onContactChanged \| Contact changes/.test(spec));
check("detail-editpage: standard features (Approvals/Activities) do NOT get a child-editpage flag (native forms)",
  !dsCs.changeSet.needsDecision.some(n => n.kind === "detail-editpage"));

/* ---- Section-schema analysis: add-record mini page + section actions (#8b) + list columns (#2) ---- */
const secRun = runMigration({ entity: "Applicant",
  schemas: [{ pkg: "P", body: `define("P",[],function(){return{entitySchemaName:"Applicant",diff:[{operation:"insert",name:"F",parentName:"Header",propertyName:"items",values:{bindTo:"Name"}}]};});` }],
  section: [{ pkg: "HRApplicant", body: `define("Applicant1Section",[],function(){return{entitySchemaName:"Applicant",methods:{getAddRecordMiniPage:function(){return "ApplicantMiniPage";},getSectionActions:function(){var a=this.callParent(arguments);a.addItem({"Tag":"runBulkAssign"});return a;},getGridDataColumns:function(){return {Name:{path:"Name"},Stage:{path:"Stage"}};}},diff:[]};});` }],
}, { baseDir: FIX });
check("section: add-record mini page detected (name)", secRun.section?.addRecordMiniPage === "ApplicantMiniPage");
check("section: getSectionActions hint captured (#8b)", secRun.section?.sectionActions.includes("runBulkAssign"));
check("section: list columns from getGridDataColumns (#2)", (secRun.section?.listColumns || []).join(",") === "Name,Stage");
check("section: design spec has a List page block (before the form page) naming the mini page",
  /### List page/.test(secRun.designSpec) && /ApplicantMiniPage/.test(secRun.designSpec)
  && secRun.designSpec.indexOf("### List page") < secRun.designSpec.indexOf(" form page"));
const noSec = runMigration({ entity: "X",
  schemas: [{ pkg: "P", body: `define("P",[],function(){return{entitySchemaName:"X",diff:[{operation:"insert",name:"F",parentName:"Header",propertyName:"items",values:{bindTo:"F"}}]};});` }] }, { baseDir: FIX });
check("section: absent when no section input (block omitted)", noSec.section === null && !/### List page/.test(noSec.designSpec));
check("section: no add-record mini page → 'full edit page' + list columns flagged data-driven",
  (() => { const r = runMigration({ entity: "Applicant",
    schemas: [{ pkg: "P", body: `define("P",[],function(){return{entitySchemaName:"Applicant",diff:[{operation:"insert",name:"F",parentName:"Header",propertyName:"items",values:{bindTo:"Name"}}]};});` }],
    section: [{ pkg: "HRApplicant", body: `define("Applicant1Section",[],function(){return{entitySchemaName:"Applicant",methods:{},diff:[]};});` }] }, { baseDir: FIX });
    return r.section?.addRecordMiniPage === null && /full edit page/.test(r.designSpec) && /profile data/.test(r.designSpec); })());

/* ---- #19: seed-quality validation — a skeleton seed (0 methods) is caught as a warning (hard gate) ---- */
const skelSeed = mergeHierarchy([L("Client", { entity: "X", diff: [di({ name: "F", parentName: "Header", propertyName: "items", bindTo: "F" })] })],
  { seedTemplate: [L("Base", { diff: [di({ name: "Header", itemType: 15 })] })] });        // seed = bare containers, no methods
check("#19: skeletal seed (0 methods) → seedQuality.looksSkeletal + a 'skeletal-seed' warning (gate blocks)",
  skelSeed.seedQuality.looksSkeletal === true && skelSeed.warnings.some(w => w.name === "skeletal-seed"));
const realSeed = mergeHierarchy([L("Client", { entity: "X", diff: [di({ name: "F", parentName: "Header", propertyName: "items", bindTo: "F" })] })],
  { seedTemplate: [L("Base", { diff: [di({ name: "Header", itemType: 15 })], methods: ["init", "getActions"] })] }); // seed with real methods
check("#19: real seed (methods incl. getActions) → not skeletal, no skeletal-seed warning",
  realSeed.seedQuality.looksSkeletal === false && realSeed.seedQuality.hasGetActions === true
  && !realSeed.warnings.some(w => w.name === "skeletal-seed"));
check("#19: no seed at all → seedQuality.seeded=false, not flagged skeletal",
  mergeHierarchy([L("Client", { entity: "X", diff: [di({ name: "F", parentName: "Header", propertyName: "items", bindTo: "F" })] })]).seedQuality.seeded === false);

/* ---- #5/#13: resolve resource-key captions from manifest.resources ---- */
const capClient = () => L("Client", { entity: "X", diff: [
  di({ name: "MyTab", parentName: "Tabs", propertyName: "tabs", isTab: true, caption: "Resources.Strings.MyTabCaption" }),
  di({ name: "Grp", parentName: "MyTab", itemType: 15, caption: "Resources.Strings.GrpCaption" }),
  di({ name: "GF", parentName: "Grp", propertyName: "items", bindTo: "GF" })] });
const capResolved = mapToFreedom(mergeHierarchy([capClient()]), { resources: { MyTabCaption: "Vacancies", GrpCaption: "Details" } });
check("#5/#13: resolved tab caption becomes literal text + no tab-caption decision",
  capResolved.viewConfigDiff.find(o => o.name === "MyTab")?.values.caption === "Vacancies"
  && !capResolved.needsDecision.some(n => n.kind === "tab-caption"));
check("#5/#13: resolved group caption becomes literal text + no group-caption decision",
  capResolved.viewConfigDiff.find(o => o.name === "Grp")?.values.caption === "Details"
  && !capResolved.needsDecision.some(n => n.kind === "group-caption"));
const capUnresolved = mapToFreedom(mergeHierarchy([capClient()]));
check("#5/#13: without resources, captions keep the binding + are flagged unresolved (tab + group)",
  capUnresolved.viewConfigDiff.find(o => o.name === "MyTab")?.values.caption === "$Resources.Strings.MyTabCaption"
  && capUnresolved.needsDecision.some(n => n.kind === "tab-caption")
  && capUnresolved.needsDecision.some(n => n.kind === "group-caption"));

/* ---- #5/#13 (fields): columnTitles resolve field LABELS to human titles (not raw codes) ---- */
const lblClient = () => L("Client", { entity: "X", diff: [
  di({ name: "MobilePhone", parentName: "Header", propertyName: "items", bindTo: "MobilePhone" }),
  di({ name: "ExpertiseLevel", parentName: "Header", propertyName: "items", bindTo: "ExpertiseLevel" })] });
const lblResolved = mapToFreedom(mergeHierarchy([lblClient()]), { columnTitles: { MobilePhone: "Mobile phone", ExpertiseLevel: "Specialist expertise level" } });
check("#5/#13 fields: columnTitles → field label is the human title, not the column code",
  lblResolved.viewConfigDiff.find(o => o.name === "MobilePhone")?.values.label === "Mobile phone"
  && lblResolved.viewConfigDiff.find(o => o.name === "ExpertiseLevel")?.values.label === "Specialist expertise level");
const lblUnresolved = mapToFreedom(mergeHierarchy([lblClient()]));
check("#5/#13 fields: without columnTitles, labels keep the binding + ONE aggregate field-labels nudge",
  lblUnresolved.viewConfigDiff.find(o => o.name === "MobilePhone")?.values.label === "$Resources.Strings.MobilePhone"
  && lblUnresolved.needsDecision.filter(n => n.kind === "field-labels").length === 1);

/* ---- #13 (detail title): detailSchemas[...].title becomes the detail's display caption ---- */
const dtCs = mapToFreedom(mergeHierarchy([L("Client", { entity: "X", details: {
    Stages: { schemaName: "StageInRecruitmentDetailV2", entitySchemaName: "RecruitmentInStage", detailColumn: "Root", masterColumn: "Id" } },
  diff: [di({ name: "T", parentName: "Tabs", propertyName: "tabs", isTab: true, caption: "Resources.Strings.TCap" }),
         di({ name: "Stages", parentName: "T", propertyName: "items", itemType: 2 })] })]),
  { detailSchemas: { StageInRecruitmentDetailV2: { entity: "RecruitmentInStage", columns: ["Stage", "Date"], title: "Stage history" } } });
check("#13 detail title: detailSchemas.title → the detail's caption is the human title",
  dtCs.details.find(d => d.detailSchema === "StageInRecruitmentDetailV2")?.caption === "Stage history");

/* ---- a tab that holds ONLY a detail (no field) must still be emitted so the related list has a home ---- */
const dtabCs = mapToFreedom(mergeHierarchy([L("Client", { entity: "X", details: {
    D: { schemaName: "MyDetail", entitySchemaName: "Child", detailColumn: "M", masterColumn: "Id" } },
  diff: [di({ name: "OnlyDetailTab", parentName: "Tabs", propertyName: "tabs", isTab: true, caption: "Resources.Strings.ODTCap" }),
         di({ name: "D", parentName: "OnlyDetailTab", propertyName: "items", itemType: 2 })] })]),
  { resources: { ODTCap: "Vacancies" } });
check("detail-only tab: the owning tab is emitted as crt.Tab (the related list has a home) + caption resolves",
  dtabCs.viewConfigDiff.some(o => o.name === "OnlyDetailTab" && o.values?.type === "crt.Tab" && o.values.caption === "Vacancies"));

/* ---- #11(ii)/B2: a supplied detail schema resolves the related-list columns + kills detail-unresolved ---- */
const detCs = mapToFreedom(mergeHierarchy([L("Client", { entity: "X", details: {
    Reqs: { schemaName: "Schema7Detail", entitySchemaName: "InternalRequest", detailColumn: "Emp", masterColumn: "Id" } },
  diff: [di({ name: "T", parentName: "Tabs", propertyName: "tabs", isTab: true, caption: "Resources.Strings.TCap" }),
         di({ name: "Reqs", parentName: "T", propertyName: "items", itemType: 2 })] })]),
  { detailSchemas: { Schema7Detail: { entity: "InternalRequest", columns: ["Number", "Status", "Job"] } } });
check("#11(ii): detail schema supplied → related-list columns resolved on the detail + no detail-unresolved flag",
  detCs.details.find(d => d.detailSchema === "Schema7Detail")?.columns?.join(",") === "Number,Status,Job"
  && !detCs.needsDecision.some(n => n.kind === "detail-unresolved"));
check("detail-editpage: a custom related list flags the child entity's edit/mini page as a follow-on migration",
  detCs.needsDecision.some(n => n.kind === "detail-editpage" && n.item === "InternalRequest"));

/* ---- #8c: process-launch detected in a real body → RunProcess card action + process-launch decision ---- */
const plRun = runMigration({ entity: "X", schemas: [{ pkg: "P", body:
  `define("P",[],function(){return{entitySchemaName:"X",diff:[],methods:{onRun:function(){ProcessModuleUtilities.executeProcess({sysProcessName:"RecruitingSecurityCheckProcess"});}}};});` }] }, { baseDir: FIX });
check("#8c: process-launch → RunProcess card action + process-launch decision naming the process",
  plRun.changeSet.cardActions.includes("RunProcess")
  && plRun.changeSet.needsDecision.some(n => n.kind === "process-launch" && /RecruitingSecurityCheckProcess/.test(n.item)));

/* ---- ancestor-visibility: a field inside a hidden/dynamic container inherits + is flagged ---- */
const avCs = mapToFreedom(mergeHierarchy([L("Client", { entity: "X", diff: [
  di({ name: "AvTab", parentName: "Tabs", propertyName: "tabs", isTab: true, caption: "Resources.Strings.AvCap" }),
  di({ name: "HiddenGrp", parentName: "AvTab", itemType: 15, visible: false }),
  di({ name: "GF2", parentName: "HiddenGrp", propertyName: "items", bindTo: "GF2" }),
  di({ name: "DynGrp", parentName: "AvTab", itemType: 15, visible: "dynamic" }),
  di({ name: "DF", parentName: "DynGrp", propertyName: "items", bindTo: "DF" })] })]));
check("ancestor-visibility: field in a statically-hidden container is mapped hidden + flagged",
  avCs.viewConfigDiff.find(o => o.name === "GF2")?.values.visible === false
  && avCs.needsDecision.some(n => n.kind === "ancestor-visibility" && n.item === "GF2"));
check("ancestor-visibility: field in a dynamically-shown container is flagged (condition to wire)",
  avCs.needsDecision.some(n => n.kind === "ancestor-visibility" && n.item === "DF"));

/* ---- --plan: whole plan skeleton (Overview/Pages placeholders + generated spec + recursive child pages) ---- */
check("--plan: result.plan is the full skeleton (title + Overview + <FILL:> + Main scope + embedded spec + Layout)",
  typeof cli.plan === "string" && /— Classic → Freedom UI/.test(cli.plan)
  && /### Overview/.test(cli.plan) && /<FILL:/.test(cli.plan)
  && /### Main scope/.test(cli.plan) && / form page/.test(cli.plan) && /#### Layout/.test(cli.plan)
  // embedded spec must NOT repeat the standalone `## Design spec …` header / Entity+Size preamble (Overview has it)
  && !/## Design spec/.test(cli.plan));
check("--plan: Size counts are pre-filled by the engine (not a FILL placeholder)",
  /\*\*Size:\*\* \d+ fields/.test(cli.plan));
check("--plan: verbatim / Adjustments guardrail present (agent must not edit generated tables)",
  /present this VERBATIM/i.test(cli.plan) && /Adjustments/.test(cli.plan));
check("child pages (recursion): custom details → result.childPages + `Rebuild (child)` rows inside the Pages table",
  Array.isArray(cli.childPages) && cli.childPages.length >= 1
  && /Rebuild \(child\)/.test(cli.plan) && !/### Child pages to migrate/.test(cli.plan));
const planRun = spawnSync(process.execPath, [path.join(ENGINE_DIR, "migrate.mjs"), "-", "--plan"], {
  input: JSON.stringify({ entity: "SupportUnit", entityColumns: SU_COLS, schemas: SU_SCHEMAS, seed: CLEAN_SEED }), encoding: "utf8" });
check("migrate.mjs --plan: gate-clean run prints the plan skeleton (## … Classic → Freedom UI), no JSON envelope, exit 0",
  planRun.status === 0 && /Classic → Freedom UI/.test(planRun.stdout || "") && !/"changeSet"/.test(planRun.stdout || "") && !/GATE BLOCKED/.test(planRun.stdout || ""));
// ⛔ HARD GATE (RV1): the SAME manifest with NO seed is gate-BLOCKED — the CLI must exit non-zero AND the
// plan must carry the ⛔ banner at the top (so a blocked run can't be mistaken for an approvable plan).
const blockedRun = spawnSync(process.execPath, [path.join(ENGINE_DIR, "migrate.mjs"), "-", "--plan"], {
  input: JSON.stringify({ entity: "SupportUnit", entityColumns: SU_COLS, schemas: SU_SCHEMAS }), encoding: "utf8" });
check("HARD GATE: a no-seed run is blocked — CLI exits non-zero, stderr + top-of-plan ⛔ banner",
  blockedRun.status !== 0 && /GATE BLOCKED/.test(blockedRun.stderr || "")
  && /⛔ \*\*HARD GATE — BLOCKED/.test(blockedRun.stdout || "")
  && /unresolvedParents/.test(blockedRun.stdout || ""));
check("HARD GATE: result.gate.blocked + reasons are exposed on the JSON result",
  (() => { const r = runMigration({ entity: "SupportUnit", entityColumns: SU_COLS,
    schemas: [{ pkg: "SupportCalendar", file: "supportunitemployee/SupportCalendar_base.js" }, { pkg: "SupportService", file: "supportunitemployee/SupportService.js" }] }, { baseDir: FIX });
    return r.gate.blocked === true && r.gate.reasons.some(x => /unresolvedParents/.test(x)); })());
check("child pages: detail schema editPage flows into the recursion target",
  runMigration({ entity: "X",
    schemas: [{ pkg: "P", body: `define("P",[],function(){return{entitySchemaName:"X",details:{R:{schemaName:"ReqDetail",entitySchemaName:"InternalRequest",filter:{detailColumn:"M",masterColumn:"Id"}}},diff:[{operation:"insert",name:"T",parentName:"Tabs",values:{itemType:15,isTab:true}},{operation:"insert",name:"R",parentName:"T",values:{itemType:2}}]};});` }],
    detailSchemas: { ReqDetail: { entity: "InternalRequest", columns: ["Number"], editPage: "InternalRequestPage" } } }, { baseDir: FIX })
    .childPages.some(c => c.entity === "InternalRequest" && c.editPage === "InternalRequestPage"));

/* ---- review-round refinements: Confirm dedup · lookup-no-ref · Logic fold · filter dedup · widget region ---- */
// #1 — Confirm must NOT re-list kinds already shown in Layout/Logic/Child-pages
const cfTail = dsCs.designSpec.split("### ⚠ Confirm")[1] || "";
check("#1 Confirm: standard-feature / method NOT re-listed (already in Layout / Logic)",
  dsCs.designSpec.includes("### ⚠ Confirm") && !/\[standard-feature\]/.test(cfTail) && !/\[method\]/.test(cfTail));
// #2 — a lookup column (rich meta) with no reference schema → probable read-only mirror flag
const mirrorCs = runMigration({ entity: "X", entityColumns: { MobilePhone: { type: "Lookup" } },
  schemas: [{ pkg: "P", body: `define("P",[],function(){return{entitySchemaName:"X",diff:[{operation:"insert",name:"MobilePhone",parentName:"Header",propertyName:"items",values:{bindTo:"MobilePhone"}}]};});` }] }, { baseDir: FIX });
check("#2 lookup-no-ref: lookup column with no reference schema flagged as a probable read-only mirror",
  mirrorCs.changeSet.needsDecision.some((n) => n.kind === "lookup-no-ref" && n.item === "MobilePhone"));
check("#2 lookup-no-ref: a lookup WITH a reference schema is NOT flagged (no false positive)",
  !dsCs.changeSet.needsDecision.some((n) => n.kind === "lookup-no-ref"));
// C1 — the lookup-no-ref doubt must show in the Layout Type cell, not silently read "Lookup"
check("C1: lookup-no-ref field renders Type '⚠ Text? (lookup, no ref)' in Layout, not 'Lookup'",
  /MobilePhone \| ⚠ Text\? \(lookup, no ref\)/.test(mirrorCs.designSpec) && !/MobilePhone \| Lookup/.test(mirrorCs.designSpec));
// RV12 — an image/photo component gets its own Layout row (it had a decision but no row before)
const imageRowCs = runMigration({ entity: "X",
  schemas: [{ pkg: "P", body: `define("P",[],function(){return{entitySchemaName:"X",diff:[{operation:"insert",name:"Photo",parentName:"Header",propertyName:"items",values:{}}]};});` }] }, { baseDir: FIX });
check("RV12: image/photo component appears as an 'Image' row in the Layout table",
  imageRowCs.changeSet.images.some((i) => i.classic === "Photo") && /\| Photo \| Image \|/.test(imageRowCs.designSpec));
// C2 — a business rule comparing against a lookup-record GUID prompts a [lookup-value] Confirm note
const guidCs = runMigration({ entity: "X",
  schemas: [{ pkg: "P", body: `define("P",[],function(){return{entitySchemaName:"X",businessRules:{Contact:{r1:{enabled:true,removed:false,ruleType:0,property:2,logical:0,conditions:[{comparisonType:3,leftExpression:{type:1,attribute:"Stage"},rightExpression:{type:0,value:"c28f7c8f-1234-4abc-9def-000000000001",dataValueType:10}}]}}},diff:[{operation:"insert",name:"Contact",parentName:"Header",propertyName:"items",values:{bindTo:"Contact"}}]};});` }] }, { baseDir: FIX });
check("C2: a rule condition comparing a lookup GUID prompts a [lookup-value] resolve-on-stand note",
  /\[lookup-value\][\s\S]*resolve each GUID/.test(guidCs.designSpec));
// RV10 — the JSON result reports the F9 payload counts alongside the (larger, template-inclusive) effective counts
check("RV10: result.payload exposes the emitted (payload-filtered) counts",
  cli.payload && typeof cli.payload.fields === "number" && cli.payload.fields <= cli.effective.fields);
// #3 — set/clear<X>Info helpers fold into on<X>Change (not separate Logic rows)
const foldCs = runMigration({ entity: "X",
  schemas: [{ pkg: "P", body: `define("P",[],function(){return{entitySchemaName:"X",methods:{onContactChange:function(){},setContactInfo:function(){},clearContactInfo:function(){}},diff:[{operation:"insert",name:"F",parentName:"Header",propertyName:"items",values:{bindTo:"F"}}]};});` }] }, { baseDir: FIX });
check("#3 Logic: set/clear<X>Info helpers folded into on<X>Change (not separate rows)",
  /onContactChange[^\n]*\+ setContactInfo, clearContactInfo/.test(foldCs.designSpec) && !/\| setContactInfo \| /.test(foldCs.designSpec));
// #4 — multiple FILTRATION rules on one attribute collapse to a single Logic row
const dupFilt = runMigration({ entity: "X",
  schemas: [{ pkg: "P", body: `define("P",[],function(){return{entitySchemaName:"X",businessRules:{Req:{a:{ruleType:1,baseAttributePatch:"T",comparisonType:3,value:true,dataValueType:12},b:{ruleType:1,baseAttributePatch:"S"}}},diff:[{operation:"insert",name:"Req",parentName:"Header",propertyName:"items",values:{bindTo:"Req"}}]};});` }] }, { baseDir: FIX });
check("#4 Logic: multiple filters on one attribute collapse to a single row",
  /Filter · Req \|[^\n]*\| 2 filters/.test(dupFilt.designSpec));
// #5 — widgets grouped under a single 'Header / top' region
const wReg = runMigration({ entity: "X",
  schemas: [{ pkg: "P", body: `define("P",[],function(){return{entitySchemaName:"X",modules:{M:{moduleName:"ActionsDashboardModule"}},diff:[{operation:"insert",name:"F",parentName:"Header",propertyName:"items",values:{bindTo:"F"}}]};});` }] }, { baseDir: FIX });
check("#5 widgets: grouped under a 'Header / top' region (not their own top-level region)",
  /\| Header \/ top \| ActionDashboard \|/.test(wReg.designSpec));

// #8 — DCM widget carries the "binds to the object" note (stages + Next steps auto-populate from the
// object's case), on the widget, in its decision, and in the design spec's Additional column.
const dcmCs = runMigration({ entity: "X",
  schemas: [{ pkg: "P", body: `define("P",[],function(){return{entitySchemaName:"X",modules:{M:{moduleName:"DcmActionsDashboardModule"}},diff:[{operation:"insert",name:"F",parentName:"Header",propertyName:"items",values:{bindTo:"F"}}]};});` }] }, { baseDir: FIX });
check("#8 DCM: widget + decision carry the 'binds to the object' note (stages/Next steps auto-populate)",
  dcmCs.changeSet.widgets.some((w) => w.widget === "CaseStages (DCM)" && /binds to the object/.test(w.note || ""))
  && dcmCs.changeSet.needsDecision.some((n) => n.kind === "widget" && /binds to the object/.test(n.reason)));
check("#8 DCM: the note surfaces in the design spec (Additional column of the widget row)",
  /CaseStages \(DCM\)[\s\S]*?binds to the object/.test(dcmCs.designSpec));

// #6 — Layout region order: the side profile (all islands) comes BEFORE tabs, even when the classic
// field order interleaves an island, a tab field, then a second island.
const ordCs = mapToFreedom(mergeHierarchy([L("Client", { entity: "X", diff: [
  di({ name: "C1", parentName: "LeftModulesContainer", itemType: 0 }),
  di({ name: "Phone", parentName: "C1", propertyName: "items", bindTo: "Phone" }),
  di({ name: "MyTab", parentName: "Tabs", propertyName: "tabs", isTab: true, caption: "Resources.Strings.C" }),
  di({ name: "TabF", parentName: "MyTab", propertyName: "items", bindTo: "TabF" }),
  di({ name: "C2", parentName: "LeftModulesContainer", itemType: 0 }),
  di({ name: "Req", parentName: "C2", propertyName: "items", bindTo: "Req" })] })],
  { seedTemplate: [L("Tpl", { diff: [di({ name: "LeftModulesContainer", itemType: 15 }), di({ name: "Tabs", itemType: 15 })] })] }));
const ordLines = renderDesignSpec({ entity: "X", changeSet: ordCs, effective: { fields: 3 } }).split("\n").filter((l) => /^\| (Side profile|Tab · )/.test(l));
const lastProfileIx = ordLines.reduce((acc, l, i) => l.startsWith("| Side profile") ? i : acc, -1);
const firstTabIx = ordLines.findIndex((l) => l.startsWith("| Tab · "));
check("#6 Layout order: all profile regions render before tabs (not interleaved)",
  lastProfileIx >= 0 && firstTabIx >= 0 && lastProfileIx < firstTabIx);

// RV14 — the side-profile anchor is derived STRUCTURALLY, not from a fixed name list: a base-template
// left container with a name NOT in PROFILE_CONTAINERS (here `LeftContainer`, the CasePageV2 base) must
// still route its field to the side profile, and the tabs panel must NOT be mistaken for the profile.
const anchorCs = mapToFreedom(mergeHierarchy(
  [L("Client", { entity: "X", diff: [
    di({ name: "Fld", parentName: "LeftContainer", propertyName: "items", bindTo: "Fld" }),
    di({ name: "TabFld", parentName: "ESNTab", propertyName: "items", bindTo: "TabFld" })] })],
  { seedTemplate: [L("Tpl", { diff: [
    di({ name: "LeftContainer", itemType: 15 }),
    di({ name: "Tabs", itemType: 15 }),
    di({ name: "ESNTab", parentName: "Tabs", propertyName: "tabs", isTab: true, itemType: 15 })] })] }));
check("RV14: a NON-literal base left container (LeftContainer) still routes its field to the side profile",
  anchorCs.viewConfigDiff.some(o => o.name === "Fld" && o.parentName === "SideAreaProfileContainer"));
check("RV14: the tabs panel is NOT treated as profile — a field under a base tab stays in that tab, not the profile",
  anchorCs.viewConfigDiff.some(o => o.name === "TabFld" && o.parentName !== "SideAreaProfileContainer"));

// #7 — child-page recursion: a supplied child schema is MAPPED (its design spec nested in the plan),
// an unsupplied child gets an explicit `<FILL: recursive sub-migration>` slot — the listing alone is
// not enough; every child page needs its own mapping, or a visible instruction to produce one.
const recCs = runMigration({ entity: "Par",
  schemas: [{ pkg: "P", body: `define("P",[],function(){return{entitySchemaName:"Par",details:{D1:{schemaName:"ChildADetail",entitySchemaName:"ChildA",filter:{detailColumn:"M",masterColumn:"Id"}},D2:{schemaName:"ChildBDetail",entitySchemaName:"ChildB",filter:{detailColumn:"M",masterColumn:"Id"}}},diff:[{operation:"insert",name:"T",parentName:"Tabs",values:{itemType:15,isTab:true}},{operation:"insert",name:"D1",parentName:"T",values:{itemType:2}},{operation:"insert",name:"D2",parentName:"T",values:{itemType:2}}]};});` }],
  detailSchemas: { D1: { entity: "ChildA", editPage: "ChildAPage" }, D2: { entity: "ChildB", editPage: "ChildBPage" } },
  childPageSchemas: { ChildAPage: { entity: "ChildA",
    schemas: [{ pkg: "C", body: `define("C",[],function(){return{entitySchemaName:"ChildA",diff:[{operation:"insert",name:"F",parentName:"Header",propertyName:"items",values:{bindTo:"F"}}]};});` }] } } },
  { baseDir: FIX });
const recA = recCs.childPages.find((c) => c.entity === "ChildA") || {};
const recB = recCs.childPages.find((c) => c.entity === "ChildB") || {};
check("#7 child recursion: supplied child schema is mapped (childPages[].spec populated, resolvedFrom set)",
  !!recA.spec && recA.resolvedFrom === "ChildAPage" && !recB.spec);
check("#7 child recursion: mapped child's design spec is NESTED in the plan (headings demoted under Child page mappings)",
  /### Child page mappings/.test(recCs.plan) && /#### Child page: ChildA/.test(recCs.plan) && /###### Layout/.test(recCs.plan));
check("#7 child recursion: unsupplied child gets an explicit recursive-sub-migration FILL slot (not just a row)",
  /#### Child page: ChildB[\s\S]*?<FILL: recursive sub-migration>/.test(recCs.plan));
// #7b Main-scope hygiene: child rows get a fixed clean target (no free-text FILL that invited status prose),
// and the meaningless "entity · details · lookups · backend → Reuse" row is gone.
check("#7b Main scope: child rows use a fixed 'Freedom record page' target (no free-text FILL)",
  /Rebuild \(child\) \|/.test(recCs.plan) && /\| Freedom record page \| Rebuild \(child\) \|/.test(recCs.plan)
  && !/Freedom form template \/ resolve via list-pages/.test(recCs.plan));
check("#7b Main scope: the meaningless 'entity · details · lookups · backend / Reuse' row is removed",
  !/reused as-is \| Reuse/.test(recCs.plan) && !/entity · details · lookups · backend/.test(recCs.plan));

// #7c — a child whose detail names a REAL Classic edit page (getEditPageName) gets a MANDATORY-map slot
// that closes the "view-only / native / out of scope" escape hatches a real run used to dodge the mapping.
const realChildBody = `define("StageInRecruitmentDetailV2",[],function(){return{entitySchemaName:"RecruitmentInStage",methods:{getEditPageName:function(){return "RecruitmentInStagePageV2";}},diff:[]};});`;
const realChild = runMigration({ entity: "Applicant",
  schemas: [{ pkg: "P", body: `define("P",[],function(){return{entitySchemaName:"Applicant",details:{StageDetail:{schemaName:"StageInRecruitmentDetailV2",entitySchemaName:"RecruitmentInStage",filter:{detailColumn:"Applicant",masterColumn:"Id"}}},diff:[{operation:"insert",name:"T",parentName:"Tabs",values:{itemType:15,isTab:true}},{operation:"insert",name:"StageDetail",parentName:"T",values:{itemType:2}}]};});` }],
  detailSchemas: { StageInRecruitmentDetailV2: { body: realChildBody, entity: "RecruitmentInStage" } } }, { baseDir: FIX });
check("#7c child with a real edit page (getEditPageName) → editPage flows into childPages",
  realChild.childPages.some((c) => c.editPage === "RecruitmentInStagePageV2"));
check("#7c real edit page → MANDATORY-map slot; 'view-only/native/out of scope' explicitly rejected",
  /RecruitmentInStagePageV2/.test(realChild.plan) && /REAL Classic edit page/.test(realChild.plan)
  && /MUST fetch it and map it/.test(realChild.plan) && /"out of scope" are NOT skip reasons/.test(realChild.plan)
  && /no "out of scope" in this migration/i.test(realChild.plan));
// a genuinely view-only child (add-record hidden, no edit page) IS a legitimate skip — no child page exists
const voChildBody = `define("VoDetail",[],function(){return{entitySchemaName:"VoEntity",methods:{getAddRecordButtonVisible:function(){return false;}},diff:[]};});`;
const voChild = runMigration({ entity: "Applicant",
  schemas: [{ pkg: "P", body: `define("P",[],function(){return{entitySchemaName:"Applicant",details:{VoDetail:{schemaName:"VoDetail",entitySchemaName:"VoEntity",filter:{detailColumn:"Applicant",masterColumn:"Id"}}},diff:[{operation:"insert",name:"T",parentName:"Tabs",values:{itemType:15,isTab:true}},{operation:"insert",name:"VoDetail",parentName:"T",values:{itemType:2}}]};});` }],
  detailSchemas: { VoDetail: { body: voChildBody, entity: "VoEntity" } } }, { baseDir: FIX });
check("#7c view-only child (no edit page) is a legit skip — 'no child edit page' note, not a mandatory-map",
  voChild.childPages.some((c) => c.entity === "VoEntity" && c.editable === false && !c.editPage)
  && /View-only related list[\s\S]{0,80}no child edit page/.test(voChild.plan)
  && !/MUST fetch it and map it/.test(voChild.plan));

/* ---- Theme 3 — real engine bugs the goldens missed (RV4/RV5/RV6/RV7/RV11) ---- */
// RV4 — a merge-onto-absent stub must carry the full insert shape (visible/tip/caption/…), not the bare one.
const rv4 = mergeHierarchy([L("P", { entity: "X", diff: [
  di({ name: "GhostBtn", operation: "merge", visible: false, tip: "Resources.Strings.T", caption: "Resources.Strings.C" })] })]);
const rv4i = (rv4.items || []).find((i) => i.name === "GhostBtn");
check("RV4: merge-onto-absent stub carries visible/tip/caption (full insert shape), + a merge warning",
  !!rv4i && rv4i.visible === false && rv4i.tip === "Resources.Strings.T" && rv4i.caption === "Resources.Strings.C"
  && rv4.warnings.some((w) => w.name === "GhostBtn"));
// RV5 — a diff op with `index` but no `values.order` falls back to index (normalizeDiff / parseSchema path).
const rv5op = parseSchema(`define("P",[],function(){return{entitySchemaName:"X",diff:[{operation:"insert",name:"D",parentName:"Header",propertyName:"items",values:{itemType:2},index:7}]};});`, "P")
  .diff.find((o) => o.name === "D");
check("RV5: diff op with index but no values.order gets order from index", !!rv5op && rv5op.order === 7);
// RV6 — a field in a per-island profile container keeps colSpan 1 (narrow), not 24.
const rv6 = mapToFreedom(mergeHierarchy(
  [L("Client", { entity: "X", diff: [
    di({ name: "IslandA", parentName: "LeftModulesContainer", itemType: 0 }),
    di({ name: "FldA", parentName: "IslandA", propertyName: "items", bindTo: "FldA" }),
    di({ name: "IslandB", parentName: "LeftModulesContainer", itemType: 0 }),
    di({ name: "FldB", parentName: "IslandB", propertyName: "items", bindTo: "FldB" })] })],
  { seedTemplate: [L("Tpl", { diff: [di({ name: "LeftModulesContainer", itemType: 15 }), di({ name: "Tabs", itemType: 15 })] })] }));
const rv6f = rv6.viewConfigDiff.find((o) => o.name === "FldA");
check("RV6: multi-island profile field keeps colSpan 1 (not 24), routed into its own island container",
  !!rv6f && rv6f.values.layoutConfig.colSpan === 1 && rv6f.parentName !== "SideAreaProfileContainer");
// RV7 — a template-owned button outside KNOWN_ACTION_ITEMS is surfaced, not silently dropped.
const rv7 = mapToFreedom(mergeHierarchy(
  [L("Client", { entity: "X", diff: [di({ name: "F", parentName: "Header", propertyName: "items", bindTo: "F" })] })],
  { seedTemplate: [L("Tpl", { diff: [di({ name: "FooButton", parentName: "Header" })] })] }));
check("RV7: a template-owned button outside the known action set is surfaced (not silently dropped)",
  rv7.needsDecision.some((n) => n.kind === "unmapped-component" && n.item === "FooButton" && /standard\/template button/.test(n.reason)));
// RV11 — (a) a template-owned Photo triggers NO spurious image decision; (b) a non-bare image name is caught.
const rv11a = mapToFreedom(mergeHierarchy(
  [L("Client", { entity: "X", diff: [di({ name: "F", parentName: "Header", propertyName: "items", bindTo: "F" })] })],
  { seedTemplate: [L("Tpl", { diff: [di({ name: "Photo", parentName: "Header" })] })] }));
check("RV11(a): a template-owned Photo does NOT trigger a spurious image decision", !rv11a.needsDecision.some((n) => n.kind === "image"));
const rv11b = runMigration({ entity: "X",
  schemas: [{ pkg: "P", body: `define("P",[],function(){return{entitySchemaName:"X",diff:[{operation:"insert",name:"CompanyLogo",parentName:"Header",propertyName:"items",values:{}}]};});` }] }, { baseDir: FIX });
check("RV11(b): a non-bare image name (CompanyLogo) is recognized as an image", rv11b.changeSet.images.some((i) => i.classic === "CompanyLogo"));

/* ---- Theme 6 — test-coverage gaps (RV9 parse layer, RV15 control() branches) ----
   NOTE ON COVERAGE: most scenarios above build fixtures with makeSchema/makeOp (`L`/`di`), which feed
   mergeHierarchy PRE-NORMALIZED ops — they exercise the MERGE layer only, NOT parseLayer/normalizeDiff's
   unwrapping of the raw `values:{…}` classic shape. Scenarios that call `parseSchema(...)` or read the
   `.js` fixture files DO exercise the parse layer. The two checks below pin the parse layer explicitly so a
   normalizeDiff regression can't slip through, and drive every `control()` type branch. */
const pu = parseSchema(`define("P",[],function(){return{entitySchemaName:"X",diff:[{operation:"insert",name:"Fld",parentName:"Header",propertyName:"items",values:{bindTo:"Col",contentType:5,tip:{content:{bindTo:"Resources.Strings.ColTip"}},hint:{bindTo:"Resources.Strings.ColHint"},caption:{bindTo:"Resources.Strings.ColCap"},layout:{column:2,row:1,colSpan:12,rowSpan:1}}},{operation:"insert",name:"T",parentName:"Tabs",propertyName:"tabs",values:{caption:{bindTo:"Resources.Strings.TCap"}}}]};});`, "P");
const puFld = pu.diff.find((o) => o.name === "Fld"), puTab = pu.diff.find((o) => o.name === "T");
check("RV9: parseSchema/normalizeDiff unwraps nested values.* (bindTo/contentType/tip/hint/caption/layout)",
  !!puFld && puFld.bindTo === "Col" && puFld.contentType === 5
  && puFld.tip === "Resources.Strings.ColTip" && puFld.hint === "Resources.Strings.ColHint"
  && puFld.caption === "Resources.Strings.ColCap" && !!puFld.layout && puFld.layout.column === 2 && puFld.layout.colSpan === 12);
check("RV9: parseSchema marks propertyName:'tabs' as isTab (parse layer exercised, not bypassed by makeOp)",
  !!puTab && puTab.isTab === true && puTab.caption === "Resources.Strings.TCap");
// RV15 — drive every control() type branch via entityColumns (the rich Contract fixture passes none).
const ctlCols = { D: { type: "date" }, DT: { type: "datetime" }, I: { type: "integer" }, DEC: { type: "decimal" }, MON: { type: "money" }, T: { type: "text", length: 100 }, RICH: { type: "30" }, LK: { type: "Lookup", ref: "Contact" } };
const ctlNames = ["D", "DT", "I", "DEC", "MON", "T", "RICH", "LK"];
const ctlCs = runMigration({ entity: "X", entityColumns: ctlCols,
  schemas: [{ pkg: "P", body: `define("P",[],function(){return{entitySchemaName:"X",diff:[${ctlNames.map((n) => `{operation:"insert",name:"${n}",parentName:"Header",propertyName:"items",values:{bindTo:"${n}"}}`).join(",")}]};});` }] }, { baseDir: FIX });
const cf = (n) => ctlCs.changeSet.viewConfigDiff.find((o) => o.name === n);
check("RV15: control() type branches — date/datetime→DateTimePicker, int/decimal/money→NumberInput, text/richtext→Input, lookup→ComboBox",
  cf("D")?.values.type === "crt.DateTimePicker" && cf("DT")?.values.type === "crt.DateTimePicker"
  && cf("I")?.values.type === "crt.NumberInput" && cf("DEC")?.values.type === "crt.NumberInput" && cf("MON")?.values.type === "crt.NumberInput"
  && cf("T")?.values.type === "crt.Input" && cf("RICH")?.values.type === "crt.Input" && cf("LK")?.values.type === "crt.ComboBox");
check("RV15: control() type LABELS — Date / Date/time / Integer / Decimal / Text (100) / Rich text / Lookup",
  cf("D")?.values.typeLabel === "Date" && cf("DT")?.values.typeLabel === "Date/time"
  && cf("I")?.values.typeLabel === "Integer" && cf("DEC")?.values.typeLabel === "Decimal" && cf("MON")?.values.typeLabel === "Decimal"
  && cf("T")?.values.typeLabel === "Text (100)" && cf("RICH")?.values.typeLabel === "Rich text" && cf("LK")?.values.typeLabel === "Lookup");

console.log(`\n=================\nMAPPER GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// Golden test for the Ф3 mapper: merge -> map -> assert Freedom ChangeSet.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLayer, mergeLayers } from "./engine.mjs";
import { mapToFreedom } from "./mapper.mjs";
import { runMigration } from "./migrate.mjs";
import { spawnSync } from "node:child_process";
import { makeLayer as L, makeOp as di } from "./_testkit.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(DIR, "fixtures");
const load = (dir, order) => order.map(fn =>
  parseLayer(fs.readFileSync(path.join(FIX, dir, fn), "utf8"), fn.replace(/\.js$/, "").replace(/_base$|_repl$/, "")));

// SupportUnit entity column types (from describe-entity) — lets the mapper pick precise controls.
const SU_COLS = {
  ParentSupportUnit: "Lookup", Contact: "Lookup", Calendar: "Lookup", SupportWorkingDayType: "Lookup",
  Active: "Boolean", SupportEmpIndex: "Integer", Canprocessreopencases: "Boolean", SupportCaseLimit: "Integer",
};

const eff = mergeLayers(load("supportunitemployee", ["SupportCalendar_base.js", "SupportService.js"]));
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
check("8 field inserts", cs.viewConfigDiff.length === 8);
check("all fields into SideAreaProfileContainer (container-role mapping)",
  cs.viewConfigDiff.every(o => o.parentName === "SideAreaProfileContainer"));
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
const coEff = mergeLayers(load("contract", [
  "CoreContracts.js", "SalesContracts.js", "DocumentInContract.js", "ContractInInvoice.js",
  "ContractInOrder.js", "WorkOverride.js", "WorkSalesBase.js", "WorkCompliance.js", "WorkContractsProcess.js"]),
  { seedLayers: seed });
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
const wCs = mapToFreedom(mergeLayers([L("Client", { entity: "X",
  modules: [{ key: "ActionsDashboardModule", moduleName: "ActionsDashboardModule" }],
  diff: [di({ name: "DuplicatesWidgetContainer", itemType: 0, parentName: "LeftModulesContainer" })] })]));
check("F3/widgets: Action Dashboard (module) + Duplicates (container) recognized → Freedom analogs",
  wCs.widgets.some(w => w.widget === "ActionDashboard") && wCs.widgets.some(w => w.widget === "Duplicates"));
check("F3: layout is NOT flattened (≥2 distinct field containers)",
  new Set(co.viewConfigDiff.filter(o => o.values?.control).map(o => o.parentName)).size >= 2);
check("F3: no field left in the old catch-all GeneralInfoTabContainer",
  !co.viewConfigDiff.some(o => o.parentName === "GeneralInfoTabContainer"));

/* ---- F9: template (seed) elements are layout context, excluded from the migration payload ---- */
// L/di are the shared layer/op builders (see _testkit.mjs), aliased to keep the assertions terse.
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
const f9cs = mapToFreedom(mergeLayers([f9client], { seedLayers: [f9seed] }));
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
const btcs = mapToFreedom(mergeLayers([btClient], { seedLayers: [btSeed] }));
check("F9×F3: no fresh crt.Tab insert synthesized for a base-template tab (ESNTab)",
  !btcs.viewConfigDiff.some(o => o.name === "ESNTab" && o.values?.type === "crt.Tab"));
check("F9×F3: base-template tab placement flagged as needsDecision",
  btcs.needsDecision.some(n => n.kind === "base-tab-placement" && n.item === "ESNTab"));
check("F9×F3: the field routes into the EXISTING base tab, not a synthesized grid",
  btcs.viewConfigDiff.some(o => o.name === "Note" && o.parentName === "ESNTab"));

/* ---- B1 (Blocker): a base tab a CLIENT layer merges is STILL template-owned (origin=insert) — the
   common reorder/re-caption case the prior fix missed. Must not synthesize a duplicate crt.Tab. ---- */
const b1seed = L("Tpl", { diff: [di({ name: "Tabs", itemType: 15 }),
  di({ name: "ESNTab", parentName: "Tabs", propertyName: "tabs", itemType: 15, isTab: true })] });
const b1client = L("Client", { entity: "X", diff: [
  di({ operation: "merge", name: "ESNTab", order: 5 }),                                  // client re-orders the base tab
  di({ name: "Note", parentName: "ESNTab", propertyName: "items", bindTo: "Note" })] }); // and adds a field to it
const b1eff = mergeLayers([b1client], { seedLayers: [b1seed] });
const b1tab = b1eff.tabs.find(t => t.name === "ESNTab");
const b1cs = mapToFreedom(b1eff);
check("B1: client-merged base tab keeps templateOwned=true (origin=seed insert, provenance has both)",
  b1tab?.templateOwned === true && b1tab?.provenance.length === 2);
check("B1: NO fresh crt.Tab synthesized for the client-merged base tab (the missed common case)",
  !b1cs.viewConfigDiff.some(o => o.name === "ESNTab" && o.values?.type === "crt.Tab"));
check("B1: field routes into the existing base tab + base-tab-placement flagged",
  b1cs.viewConfigDiff.some(o => o.name === "Note" && o.parentName === "ESNTab")
  && b1cs.needsDecision.some(n => n.kind === "base-tab-placement" && n.item === "ESNTab"));

/* ---- C3: a template-internal remove (by a seed layer) is context, not a client B6 decision ---- */
const c3seed = L("Tpl", { diff: [di({ name: "BaseA", itemType: 15 }), di({ name: "BaseB", itemType: 15 }),
  di({ operation: "remove", name: "BaseB" })] });                    // seed removes its OWN base element
const c3client = L("Client", { entity: "X", diff: [di({ operation: "remove", name: "BaseA" })] }); // client removes a base element
const c3cs = mapToFreedom(mergeLayers([c3client], { seedLayers: [c3seed] }));
check("C3: client remove of a base element surfaces as a removal decision (BaseA)",
  c3cs.needsDecision.some(n => n.kind === "removal" && n.item === "BaseA"));
check("C3: template-internal remove (seed removed its own element) is NOT a removal decision (BaseB)",
  !c3cs.needsDecision.some(n => n.kind === "removal" && n.item === "BaseB"));

/* ---- C5 build-out: a classic CONTROL_GROUP inside a tab becomes a crt.ExpansionPanel (not flattened) ---- */
const c5client = L("Client", { entity: "X", diff: [
  di({ name: "MyTab", parentName: "Tabs", propertyName: "tabs", itemType: 15, isTab: true }),
  di({ name: "Grp1", parentName: "MyTab", itemType: 15 }),                          // CONTROL_GROUP
  di({ name: "GF", parentName: "Grp1", propertyName: "items", bindTo: "ColG" })] });
const c5cs = mapToFreedom(mergeLayers([c5client]));
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
const c4cs = mapToFreedom(mergeLayers([c4client], { seedLayers: [c4seed] }));
check("C4: rule on a base (excluded) field is flagged rule-target-missing",
  c4cs.needsDecision.some(n => n.kind === "rule-target-missing" && n.item === "BaseCol")
  && !c4cs.viewConfigDiff.some(o => o.name === "BaseCol"));

/* ---- Detail placement (tab + order) + editability not assumed ---- */
const dClient = L("Client", { entity: "X", diff: [
  di({ name: "MyTab", parentName: "Tabs", propertyName: "tabs", itemType: 15, isTab: true }),
  di({ name: "Prod", parentName: "MyTab", itemType: 2, order: 3 })],           // detail grid placed in MyTab, pos 3
  details: { Prod: { schemaName: "ProdDetailV2", entitySchemaName: "OrderProduct", detailColumn: "X", masterColumn: "Id" } } });
const dcs = mapToFreedom(mergeLayers([dClient]));
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
const efcs = mapToFreedom(mergeLayers([efClient]));
const lk = efcs.entityBusinessRules.find(r => r.targetAttribute === "Lk");
const st = efcs.entityBusinessRules.find(r => r.targetAttribute === "St");
check("entity-filter: dynamic filter marked incomplete + flagged (entity-filter)",
  lk?.complete === false && efcs.needsDecision.some(n => n.kind === "entity-filter" && n.item === "Lk"));
check("entity-filter: static filter marked complete + NOT flagged",
  st?.complete === true && !efcs.needsDecision.some(n => n.kind === "entity-filter" && n.item === "St"));

/* ---- image component + tooltip carry (Product gaps) ---- */
const imgCs = mapToFreedom(mergeLayers([L("Client", { entity: "X", diff: [
  di({ name: "Photo", parentName: "Header", generator: "ImageCustomGeneratorV2.generateCustomImageControl" }),
  di({ name: "Code", parentName: "Header", propertyName: "items", bindTo: "Code", tip: "Resources.Strings.CodeTip" })] })]));
check("image component (generator-based, no bindTo) recognized → images[] + needsDecision",
  imgCs.images.some(i => i.classic === "Photo") && imgCs.needsDecision.some(n => n.kind === "image" && n.item === "Photo"));
check("tooltip carried onto the Freedom field (tip.content)",
  imgCs.viewConfigDiff.find(o => o.name === "Code")?.values.tip?.content === "$Resources.Strings.CodeTip");

/* ---- visibility respected (not hardcoded true) + feature toggles flagged ---- */
const visCs = mapToFreedom(mergeLayers([L("Client", { entity: "X", features: ["UseNewProductCatalogue"], diff: [
  di({ name: "Hidden", parentName: "Header", propertyName: "items", bindTo: "Hidden", visible: false }),
  di({ name: "Shown", parentName: "Header", propertyName: "items", bindTo: "Shown" })] })]));
check("static visible:false is respected on the Freedom field (not forced true)",
  visCs.viewConfigDiff.find(o => o.name === "Hidden")?.values.visible === false
  && visCs.viewConfigDiff.find(o => o.name === "Shown")?.values.visible === true);
check("feature toggles flagged (feature-toggle) — mapping is the full union, page shows one state",
  visCs.needsDecision.some(n => n.kind === "feature-toggle" && /UseNewProductCatalogue/.test(n.item)));

/* ---- getActions custom action surfaced into cardActions + real caption used (no synth flag) ---- */
const actCs = mapToFreedom(mergeLayers([L("Client", { entity: "X", actionHints: ["navigateToTaxesByCountriesLookup"],
  methods: ["getActions"], diff: [
  di({ name: "MyTab", parentName: "Tabs", propertyName: "tabs", itemType: 15, isTab: true, caption: "Resources.Strings.MyTabCap" }),
  di({ name: "F", parentName: "MyTab", propertyName: "items", bindTo: "F" })] })]));
check("getActions custom action surfaced into cardActions (not lost)",
  actCs.cardActions.includes("navigateToTaxesByCountriesLookup"));
check("real tab caption used → no synthesized tab-caption decision",
  actCs.viewConfigDiff.find(o => o.name === "MyTab")?.values.caption === "$Resources.Strings.MyTabCap"
  && !actCs.needsDecision.some(n => n.kind === "tab-caption" && n.item === "MyTab"));

/* ---- Fix 1: classic `hint` → field tooltip (static) vs field-hint decision (dynamic) ---- */
const hintCs = mapToFreedom(mergeLayers([L("Client", { entity: "X", diff: [
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
const umCs = mapToFreedom(mergeLayers([L("Client", { entity: "X", refModules: ["CasesEstimateLabel"], diff: [
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
const umTpl = mapToFreedom(mergeLayers([L("Client", { entity: "X", diff: [di({ name: "CF", parentName: "Header", propertyName: "items", bindTo: "CF" })] })],
  { seedLayers: [L("Base", { entity: "X", diff: [di({ name: "BaseLabel", parentName: "Header", propertyName: "items", caption: "x" })] })] }));
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
  layers: [
    { pkg: "SupportCalendar", file: "supportunitemployee/SupportCalendar_base.js" },
    { pkg: "SupportService", file: "supportunitemployee/SupportService.js" },
  ],
}, { baseDir: FIX });
check("migrate.mjs: runMigration produces a ChangeSet (entity + non-empty viewConfigDiff)",
  cli.entity === "SupportUnit" && cli.changeSet.viewConfigDiff.length > 0);
check("migrate.mjs: no parse errors + effective counts + decisionSummary surfaced",
  cli.parseErrors.length === 0 && cli.effective.fields > 0 && typeof cli.decisionSummary === "object" && Object.keys(cli.decisionSummary).length > 0);
check("migrate.mjs: entity '?' falls back to the merged effective entity",
  runMigration({ entity: "?", layers: [
    { pkg: "SupportCalendar", file: "supportunitemployee/SupportCalendar_base.js" },
    { pkg: "SupportService", file: "supportunitemployee/SupportService.js" }] }, { baseDir: FIX }).entity === "SupportUnit");
const migBad = spawnSync(process.execPath, [path.join(DIR, "migrate.mjs"), "-"], { input: "{ not json", encoding: "utf8" });
check("migrate.mjs CLI: malformed manifest exits 1 with a diagnostic and no stdout (not a raw stack)",
  migBad.status === 1 && /migrate\.mjs:/.test(migBad.stderr || "") && (migBad.stdout || "").trim() === "");

/* ---- Phase-2 review fixes: #6 (Activities≠Timeline + suffix match), #7 (template-provided), #14 (24-col grid), #15 (detail-caption) ---- */
const featCs = mapToFreedom(mergeLayers([L("Client", { entity: "X",
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
const lmcs = mapToFreedom(mergeLayers([lmClient], { seedLayers: [lmSeed] }));
check("#18: island fields under LeftModulesContainer route to SideAreaProfileContainer (not the fallback tab)",
  ["Phone", "Email", "ReqNo"].every(n => lmcs.viewConfigDiff.find(o => o.name === n)?.parentName === "SideAreaProfileContainer"));
check("#18: no bogus container decision + nothing left in the GeneralInfoTabContainer fallback",
  !lmcs.needsDecision.some(n => n.kind === "container")
  && !lmcs.viewConfigDiff.some(o => o.parentName === "GeneralInfoTabContainer"));
check("#18: the island wrappers are NOT mis-flagged as unmapped-component (their fields were migrated)",
  !lmcs.needsDecision.some(n => n.kind === "unmapped-component" && /Container$/.test(n.item)));
check("#18/#9b: multi-island flattening surfaced as ONE profile-island decision naming both islands",
  lmcs.needsDecision.some(n => n.kind === "profile-island"
    && /ContactContainer/.test(n.item) && /InternalRequestContainer/.test(n.item)));

/* ---- #18: an unresolved chain that never reaches an anchor is flagged with the ACCURATE reason
   (the container IS defined, but climbs to root) — not the misleading "not defined by any layer" ---- */
const naClient = L("Client", { entity: "X", diff: [
  di({ name: "OrphanBox", itemType: 0 }),                                                    // defined, but no chain to an anchor
  di({ name: "Lost", parentName: "OrphanBox", propertyName: "items", bindTo: "Lost" })] });
const nacs = mapToFreedom(mergeLayers([naClient]));
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
const dupcs = mapToFreedom(mergeLayers([dupClient]));
check("#11: duplicate detail (same schema+entity+FK) emitted ONCE, keeping the resolved tab",
  dupcs.details.filter(d => d.detailSchema === "ReqDetail").length === 1
  && dupcs.details.find(d => d.detailSchema === "ReqDetail")?.tab === "T");

/* ---- #11: a detail over a *File entity is recognised as Attachments even when the schema name is an
   auto-generated placeholder (SchemaNDetail) that hides it — flagged as inferred ---- */
const fileClient = L("Client", { entity: "X", details: {
    Files: { schemaName: "Schema1Detail", entitySchemaName: "ApplicantFile", detailColumn: "Applicant", masterColumn: "Id" } },
  diff: [di({ name: "T2", parentName: "Tabs", propertyName: "tabs", isTab: true, caption: "Resources.Strings.T2" }),
         di({ name: "Files", parentName: "T2", propertyName: "items", itemType: 2 })] });
const filecs = mapToFreedom(mergeLayers([fileClient]));
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
const autocs = mapToFreedom(mergeLayers([autoClient]));
check("#11: auto-generated detail schema name (SchemaNDetail) flagged detail-unresolved (fetch its schema)",
  autocs.needsDecision.some(n => n.kind === "detail-unresolved" && n.item === "Schema2Detail" && /get-classic-schema/.test(n.reason)));

console.log(`\n=================\nMAPPER GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

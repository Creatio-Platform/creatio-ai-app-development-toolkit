// Golden test for the Ф3 mapper: merge -> map -> assert Freedom ChangeSet.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLayer, mergeLayers } from "./engine.mjs";
import { mapToFreedom } from "./mapper.mjs";
import { makeLayer as L, makeOp as di } from "./_testkit.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(DIR, "..", "fixtures");
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

console.log(`\n=================\nMAPPER GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

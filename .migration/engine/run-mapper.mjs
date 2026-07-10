// Golden test for the Ф3 mapper: merge -> map -> assert Freedom ChangeSet.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLayer, mergeLayers } from "./engine.mjs";
import { mapToFreedom } from "./mapper.mjs";

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

// Contract sanity
const co = mapToFreedom(mergeLayers(load("contract", [
  "CoreContracts.js", "ContractInOrder.js", "ContractInInvoice.js", "DocumentInContract.js",
  "SalesContracts.js", "WorkCompliance.js", "WorkOverride.js", "WorkSalesBase.js", "WorkContractsProcess.js"])));
console.log(`\n===== Contract sanity =====`);
console.log(`fields=${co.viewConfigDiff.length} entityRules=${co.entityBusinessRules.length} pageRules=${co.pageBusinessRules.length} details=${co.details.length} handlerStubs=${co.handlerStubs.length} needsDecision=${co.needsDecision.length}`);
check("Contract: Owner apply-static-filter present", co.entityBusinessRules.some(r => r.targetAttribute === "Owner"));
check("Contract: Parent make-required present", co.pageBusinessRules.some(r => r.element === "Parent" && r.action === "make-required"));

console.log(`\n=================\nMAPPER GOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

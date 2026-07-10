// Golden test runner for the Ф2 merge engine.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLayer, mergeLayers } from "./engine.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(DIR, "..", "fixtures");

function load(dir, order) {
  return order.map(fn => {
    const pkg = fn.replace(/\.js$/, "").replace(/_base$|_repl$/, "");
    const src = fs.readFileSync(path.join(FIX, dir, fn), "utf8");
    return parseLayer(src, pkg);
  });
}

function report(title, eff) {
  console.log(`\n===== ${title} =====`);
  console.log(`entity: ${eff.entity}`);
  console.log(`fields (${eff.fields.length}): ${eff.fields.map(f => f.bindTo).join(", ")}`);
  console.log(`tabs (${eff.tabs.length}): ${eff.tabs.map(t => t.name).join(", ")}`);
  console.log(`detailItems (${eff.detailItems.length}): ${eff.detailItems.map(d => d.name).join(", ")}`);
  console.log(`details (${eff.details.length}): ${eff.details.map(d => `${d.key}→${d.schemaName || "?"}[${d.entitySchemaName || "?"}]`).join(", ")}`);
  console.log(`rules (${eff.rules.length}):`);
  for (const r of eff.rules) console.log(`   ${r.attr} · ${r.ruleType}${r.property ? "/" + r.property : ""} · ${r.system} · from ${r.provenance.join(">")}`);
  console.log(`removed (${eff.removed.length}): ${eff.removed.map(r => `${r.name}(by ${r.removedBy})`).join(", ")}`);
  console.log(`methods (${eff.methods.length}): ${eff.methods.map(m => m.name).join(", ")}`);
}

let pass = 0, fail = 0;
const check = (name, cond) => { (cond ? (pass++, console.log("  ✅ " + name)) : (fail++, console.log("  ❌ " + name))); };

/* ---- SupportUnit (2 layers) — definitive golden ---- */
const su = mergeLayers(load("supportunitemployee", ["SupportCalendar_base.js", "SupportService.js"]));
report("SupportUnitEmployeePage (SupportCalendar + SupportService)", su);
console.log("assertions:");
check("entity = SupportUnit", su.entity === "SupportUnit");
check("8 profile fields", su.fields.length === 8);
check("has ParentSupportUnit/Contact/Calendar/SupportWorkingDayType", ["ParentSupportUnit","Contact","Calendar","SupportWorkingDayType"].every(b => su.fields.some(f => f.bindTo === b)));
check("3 tabs (Schedule/Kpi/History)", su.tabs.length === 3);
check("3 details", su.details.length === 3);
check("SupportScheduleEmployeeDetail present", su.details.some(d => d.schemaName === "SupportScheduleEmployeeDetail"));
check("4 active rules", su.rules.length === 4);
check("ParentSupportUnit FILTRATION", su.rules.some(r => r.attr === "ParentSupportUnit" && r.ruleType === "FILTRATION"));
check("Contact BINDPARAMETER/Required", su.rules.some(r => r.attr === "Contact" && r.ruleType === "BINDPARAMETER" && r.property === "Required"));
check("method setName", su.methods.some(m => m.name === "setName"));

/* ---- Contract (9 layers) — sanity ---- */
const co = mergeLayers(load("contract", [
  "CoreContracts.js", "ContractInOrder.js", "ContractInInvoice.js", "DocumentInContract.js",
  "SalesContracts.js", "WorkCompliance.js", "WorkOverride.js", "WorkSalesBase.js", "WorkContractsProcess.js",
]));
report("ContractPageV2 (9 layers)", co);
console.log("assertions:");
check("entity = Contract", co.entity === "Contract");
check("State removed", co.removed.some(r => r.name === "State"));
check("Owner FILTRATION rule present", co.rules.some(r => r.attr === "Owner" && r.ruleType === "FILTRATION"));
check("Parent REQUIRED rule present", co.rules.some(r => r.attr === "Parent" && r.property === "Required"));
check("has Product & Visa details", ["Product","Visa"].every(k => co.details.some(d => d.key === k)));

console.log(`\n=================\nGOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

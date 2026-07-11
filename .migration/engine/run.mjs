// Golden test runner for the Ф2 merge engine.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseLayer, mergeLayers } from "./engine.mjs";
import { makeLayer } from "./_testkit.mjs";

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
  const detailItems = eff.items.filter(i => i.itemType === 2); // derived from the layout tree
  console.log(`detailItems (${detailItems.length}): ${detailItems.map(d => d.name).join(", ")}`);
  console.log(`details (${eff.details.length}): ${eff.details.map(d => `${d.key}→${d.schemaName || "?"}[${d.entitySchemaName || "?"}]`).join(", ")}`);
  console.log(`rules (${eff.rules.length}):`);
  for (const r of eff.rules) console.log(`   ${r.attr} · ${r.ruleType}${r.property ? "/" + r.property : ""} · ${r.system} · from ${r.provenance.join(">")}`);
  console.log(`removed (${eff.removed.length}): ${eff.removed.map(r => `${r.name}(by ${r.removedBy})`).join(", ")}`);
  console.log(`methods (${eff.methods.length}): ${eff.methods.map(m => m.name).join(", ")}`);
  console.log(`unresolvedParents (${eff.unresolvedParents.length}) [F2 seed list]: ${eff.unresolvedParents.join(", ") || "—"}`);
  console.log(`warnings (${eff.warnings.length}): ${eff.warnings.map(w => `${w.op}:${w.name}@${w.layer}`).join(", ") || "—"}`);
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

/* ---- Contract (9 layers) — sanity ----
   Layer order is the TRUE dependency order measured from SysPackage.HierarchyLevel on the stand
   (F1): 299 < 320 < 329 < 357 < 358 < 533 < 541 < 596 < 607. An earlier hand-guessed order here
   (ContractInOrder before SalesContracts, WorkCompliance before WorkOverride) was wrong and is the
   very defect F1 corrects — last-writer-wins depends on getting this order right. */
const co = mergeLayers(load("contract", [
  "CoreContracts.js", "SalesContracts.js", "DocumentInContract.js", "ContractInInvoice.js",
  "ContractInOrder.js", "WorkOverride.js", "WorkSalesBase.js", "WorkCompliance.js", "WorkContractsProcess.js",
]));
report("ContractPageV2 (9 layers)", co);
console.log("assertions:");
check("entity = Contract", co.entity === "Contract");
check("State removed", co.removed.some(r => r.name === "State"));
check("Owner FILTRATION rule present", co.rules.some(r => r.attr === "Owner" && r.ruleType === "FILTRATION"));
check("Parent REQUIRED rule present", co.rules.some(r => r.attr === "Parent" && r.property === "Required"));
check("has Product & Visa details", ["Product","Visa"].every(k => co.details.some(d => d.key === k)));

/* ---- F2: base-template seed ----
   Prepending the base skeleton must make the base containers resolve (unresolvedParents empties),
   pull base tabs (ESNTab) into the effective page, and clear the merge-onto-absent warnings for
   the elements the skeleton now provides. */
const seed = load("_base", ["BaseModulePageV2_skeleton.js"]);
const suSeeded = mergeLayers(load("supportunitemployee", ["SupportCalendar_base.js", "SupportService.js"]), { seedLayers: seed });
report("SupportUnit + base seed (F2)", suSeeded);
console.log("assertions:");
check("F2: seed resolves all base containers (unresolvedParents empty)", suSeeded.unresolvedParents.length === 0);
check("F2: base tab ESNTab now in effective page", suSeeded.tabs.some(t => t.name === "ESNTab"));
check("F2: ESNTab/ChangesHistoryTab merge-warnings cleared", !suSeeded.warnings.some(w => w.name === "ESNTab" || w.name === "ChangesHistoryTab"));
check("F2: client tabs still present after seed", ["ScheduleTab","KpiTab","HistoryTab"].every(n => suSeeded.tabs.some(t => t.name === n)));

const coSeeded = mergeLayers(load("contract", [
  "CoreContracts.js", "SalesContracts.js", "DocumentInContract.js", "ContractInInvoice.js",
  "ContractInOrder.js", "WorkOverride.js", "WorkSalesBase.js", "WorkCompliance.js", "WorkContractsProcess.js",
]), { seedLayers: seed });
check("F2: Contract Header/Tabs resolved by seed (no longer unresolved)",
  !coSeeded.unresolvedParents.includes("Header") && !coSeeded.unresolvedParents.includes("Tabs"));
// #2 on real data: ContractSumGroup is REMOVED by WorkOverride yet ContractSumBlock still nests under
// it — a genuine orphan the old (tombstone-as-defined) diagnostic masked. It must now surface.
check("F2/#2: a group removed by a layer surfaces as unresolved (real Contract orphan, not masked)",
  coSeeded.unresolvedParents.includes("ContractSumGroup"));
check("F2: Contract entity survives seed (seed has no entitySchemaName)", coSeeded.entity === "Contract");

/* ---- F1: POSITIVE warning assertions (the mechanism must fire, not just clear after seeding) ---- */
// Unseeded runs merge onto base-template elements no layer defines -> warnings MUST be raised.
check("F1: unseeded SupportUnit warns on merge-onto-absent ESNTab",
  su.warnings.some(w => w.op === "merge" && w.name === "ESNTab" && w.layer === "SupportCalendar"));
check("F1: unseeded Contract raises merge-onto-absent warnings (base tabs/buttons)",
  co.warnings.length > 0 && co.warnings.some(w => w.op === "merge" && (w.name === "ESNTab" || w.name === "PrintButton")));

/* ---- F1: move/remove-onto-absent branches (synthetic layers pin the drop + tombstone outcomes) ---- */
const synth = (pkg, ops) => makeLayer(pkg, { entity: "X", diff: ops }); // shared shape (see _testkit.mjs)

const moved = mergeLayers([synth("T", [{ operation: "move", name: "Ghost", parentName: "Nowhere" }])]);
check("F1: move-onto-absent is dropped (item never materialises)", !moved.items.some(i => i.name === "Ghost"));
check("F1: move-onto-absent raises a 'move' warning", moved.warnings.some(w => w.op === "move" && w.name === "Ghost"));

const removedGhost = mergeLayers([synth("T", [{ operation: "remove", name: "Zombie" }])]);
check("F1: remove-onto-absent becomes a tombstone in removed[]", removedGhost.removed.some(r => r.name === "Zombie"));
check("F1: remove-onto-absent raises a 'remove' warning", removedGhost.warnings.some(w => w.op === "remove" && w.name === "Zombie"));

/* ---- F2: a parent removed by a lower layer must surface as unresolved (no false all-clear) ---- */
const tomb = mergeLayers([
  synth("base", [
    { operation: "insert", name: "Grp", itemType: 15 },
    { operation: "insert", name: "F", parentName: "Grp", propertyName: "items", bindTo: "Col" },
  ]),
  synth("top", [{ operation: "remove", name: "Grp" }]),
]);
check("F2: parent surviving only as a tombstone is reported unresolved (engine⇄mapper consistent)",
  tomb.unresolvedParents.includes("Grp") && !tomb.items.some(i => i.name === "Grp"));

/* ---- C2: a merge that introduces contentType on an ALREADY-defined field must carry it (not drop) ---- */
const c2 = mergeLayers([
  synth("base", [{ operation: "insert", name: "F", parentName: "Header", propertyName: "items", bindTo: "Col" }]),
  synth("top", [{ operation: "merge", name: "F", contentType: 5 }]),  // later layer marks it a lookup
]);
check("C2: merge introduces contentType (5=lookup) on an existing item — carried, not dropped",
  c2.items.find(i => i.name === "F")?.contentType === 5);

/* ---- F9/C6 origin: a base field the client only MOVES stays templateOwned (insert origin = seed),
   so it is NOT re-emitted as client payload — the client only repositioned template content. ---- */
const mvSeed = makeLayer("Tpl", { diff: [{ operation: "insert", name: "BF", parentName: "Header", propertyName: "items", bindTo: "BCol" }] });
const mvClient = makeLayer("Client", { entity: "X", diff: [{ operation: "move", name: "BF", parentName: "MyTab" }] });
const mvEff = mergeLayers([mvClient], { seedLayers: [mvSeed] });
check("F9/C6: a base field the client only MOVED stays templateOwned (origin=seed insert)",
  mvEff.fields.find(f => f.bindTo === "BCol")?.templateOwned === true);

/* ---- ViewItemType seed: symbolic itemType resolves (E1-class fix, now for layout containers) ---- */
const vitBody = `define("T",[],function(){return{entitySchemaName:"X",diff:[` +
  `{operation:"insert",name:"G",values:{itemType:Terrasoft.controls.ViewItemType.CONTROL_GROUP}},` +
  `{operation:"insert",name:"GL",values:{itemType:Terrasoft.core.enums.ViewItemType.GRID_LAYOUT}}]};});`;
const vit = parseLayer(vitBody, "T");
check("ViewItemType: symbolic CONTROL_GROUP -> 15 (not null)", vit.diff.find(d => d.name === "G")?.itemType === 15);
check("ViewItemType: symbolic GRID_LAYOUT (core.enums path) -> 0", vit.diff.find(d => d.name === "GL")?.itemType === 0);
check("ViewItemType: no parse error from the Terrasoft stub", !vit.error);

console.log(`\n=================\nGOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

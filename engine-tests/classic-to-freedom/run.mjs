// Golden test runner for the merge engine.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchema, mergeHierarchy, CONTENT_TYPE } from "../../skills/classic-to-freedom-migration/engine/engine.mjs";
import { makeSchema } from "./_testkit.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(DIR, "fixtures");

function load(dir, order) {
  return order.map(fn => {
    const pkg = fn.replace(/\.js$/, "").replace(/_base$|_repl$/, "");
    const src = fs.readFileSync(path.join(FIX, dir, fn), "utf8");
    return parseSchema(src, pkg);
  });
}

function report(title, eff) {
  console.log(`\n===== ${title} =====`);
  console.log(`entity: ${eff.entity}`);
  console.log(`fields (${eff.fields.length}): ${eff.fields.map(f => f.bindTo).join(", ")}`);
  console.log(`tabs (${eff.tabs.length}): ${eff.tabs.map(t => t.name).join(", ")}`);
  const detailItems = eff.items.filter(i => i.itemType === 2); // derived from the layout tree
  console.log(`detailItems (${detailItems.length}): ${detailItems.map(d => d.name).join(", ")}`);
  const detailsStr = eff.details.map(d => `${d.key}→${d.schemaName || "?"}[${d.entitySchemaName || "?"}]`).join(", ");
  console.log(`details (${eff.details.length}): ${detailsStr}`);
  console.log(`rules (${eff.rules.length}):`);
  for (const r of eff.rules) console.log(`   ${r.attr} · ${r.ruleType}${r.property ? "/" + r.property : ""} · ${r.system} · from ${r.provenance.join(">")}`);
  const removedStr = eff.removed.map(r => `${r.name}(by ${r.removedBy})`).join(", ");
  console.log(`removed (${eff.removed.length}): ${removedStr}`);
  console.log(`methods (${eff.methods.length}): ${eff.methods.map(m => m.name).join(", ")}`);
  console.log(`unresolvedParents (${eff.unresolvedParents.length}) [F2 seed list]: ${eff.unresolvedParents.join(", ") || "—"}`);
  const warningsStr = eff.warnings.map(w => `${w.op}:${w.name}@${w.schema}`).join(", ") || "—";
  console.log(`warnings (${eff.warnings.length}): ${warningsStr}`);
}

let pass = 0, fail = 0;
// `detail` (optional) is a value or a thunk — evaluated and printed ONLY when the check FAILS, so a red
// golden in CI shows computed-vs-expected without a local rerun. Zero-dependency; keeps the pure-ESM design.
const check = (name, cond, detail) => {
  // `cond` may be a value OR a thunk. A thunk is evaluated in try/catch so a throw inside ONE assertion fails
  // just that check instead of aborting the whole runner and hiding every assertion after it.
  let c = cond, threw = null;
  if (typeof cond === "function") { try { c = cond(); } catch (e) { c = false; threw = e; } }
  if (c) { pass++; console.log("  ✅ " + name); return; }
  fail++; console.log("  ❌ " + name + (threw ? "  (threw: " + threw.message + ")" : ""));
  if (detail !== undefined) {
    let d; try { d = typeof detail === "function" ? detail() : detail; } catch (e) { d = "<detail threw: " + e.message + ">"; }
    console.log("      ↳ " + (typeof d === "string" ? d : JSON.stringify(d)));
  }
};

/* ---- SupportUnit (2 schemas) — definitive golden ---- */
const su = mergeHierarchy(load("supportunitemployee", ["SupportCalendar_base.js", "SupportService.js"]));
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

/* ---- Contract (9 schemas) — sanity ----
   Schema order is the TRUE dependency order measured from SysPackage.HierarchyLevel on the stand
   (F1): 299 < 320 < 329 < 357 < 358 < 533 < 541 < 596 < 607. An earlier hand-guessed order here
   (ContractInOrder before SalesContracts, WorkCompliance before WorkOverride) was wrong and is the
   very defect F1 corrects — last-writer-wins depends on getting this order right. */
const co = mergeHierarchy(load("contract", [
  "CoreContracts.js", "SalesContracts.js", "DocumentInContract.js", "ContractInInvoice.js",
  "ContractInOrder.js", "WorkOverride.js", "WorkSalesBase.js", "WorkCompliance.js", "WorkContractsProcess.js",
]));
report("ContractPageV2 (9 schemas)", co);
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
const suSeeded = mergeHierarchy(load("supportunitemployee", ["SupportCalendar_base.js", "SupportService.js"]), { seedTemplate: seed });
report("SupportUnit + base seed (F2)", suSeeded);
console.log("assertions:");
check("F2: seed resolves all base containers (unresolvedParents empty)", suSeeded.unresolvedParents.length === 0);
check("F2: base tab ESNTab now in effective page", suSeeded.tabs.some(t => t.name === "ESNTab"));
check("F2: ESNTab/ChangesHistoryTab merge-warnings cleared", !suSeeded.warnings.some(w => w.name === "ESNTab" || w.name === "ChangesHistoryTab"));
check("F2: client tabs still present after seed", ["ScheduleTab","KpiTab","HistoryTab"].every(n => suSeeded.tabs.some(t => t.name === n)));

const coSeeded = mergeHierarchy(load("contract", [
  "CoreContracts.js", "SalesContracts.js", "DocumentInContract.js", "ContractInInvoice.js",
  "ContractInOrder.js", "WorkOverride.js", "WorkSalesBase.js", "WorkCompliance.js", "WorkContractsProcess.js",
]), { seedTemplate: seed });
check("F2: Contract Header/Tabs resolved by seed (not unresolved)",
  !coSeeded.unresolvedParents.includes("Header") && !coSeeded.unresolvedParents.includes("Tabs"));
// #2 on real data: ContractSumGroup is REMOVED by WorkOverride yet ContractSumBlock still nests under
// it — a genuine orphan the old (tombstone-as-defined) diagnostic masked. It must now surface.
check("F2/#2: a group removed by a schema surfaces as unresolved (real Contract orphan, not masked)",
  coSeeded.unresolvedParents.includes("ContractSumGroup"));
check("F2: Contract entity survives seed (seed has no entitySchemaName)", coSeeded.entity === "Contract");

/* ---- F1: POSITIVE warning assertions (the mechanism must fire, not just clear after seeding) ---- */
// Unseeded runs merge onto base-template elements no schema defines -> warnings MUST be raised.
check("F1: unseeded SupportUnit warns on merge-onto-absent ESNTab",
  su.warnings.some(w => w.op === "merge" && w.name === "ESNTab" && w.schema === "SupportCalendar"));
check("F1: unseeded Contract raises merge-onto-absent warnings (base tabs/buttons)",
  co.warnings.some(w => w.op === "merge" && (w.name === "ESNTab" || w.name === "PrintButton")));

/* ---- F1: move/remove-onto-absent branches (synthetic schemas pin the drop + tombstone outcomes) ---- */
const synth = (pkg, ops) => makeSchema(pkg, { entity: "X", diff: ops }); // shared shape (see _testkit.mjs)

const moved = mergeHierarchy([synth("T", [{ operation: "move", name: "Ghost", parentName: "Nowhere" }])]);
check("F1: move-onto-absent is dropped (item never materialises)", !moved.items.some(i => i.name === "Ghost"));
check("F1: move-onto-absent raises a 'move' warning", moved.warnings.some(w => w.op === "move" && w.name === "Ghost"));

// ENG-100314 — a remove of a name NOTHING in the fold ever defines is a pure no-op in Classic (the runtime ignores
// it), so it no longer lands in removed[] as if the client had dropped a real element. It still WARNS — but as an
// advisory `fidelity` note whose hint says plainly it has no effect, not as an F1/F2 correctness block.
const removedGhost = mergeHierarchy([synth("T", [{ operation: "remove", name: "Zombie" }])]);
check("ENG-100314: remove of a never-defined name is NOT reported in removed[] (the page never had it)",
  !removedGhost.removed.some(r => r.name === "Zombie"), () => removedGhost.removed);
check("F1: remove-onto-absent raises a 'remove' warning", removedGhost.warnings.some(w => w.op === "remove" && w.name === "Zombie"));
check("ENG-100314: that warning is FIDELITY (advisory) and its hint says it has no effect in Classic",
  removedGhost.warnings.length === 1 && removedGhost.warnings[0].severity === "fidelity"
  && /no effect in Classic unless the chain is incomplete/.test(removedGhost.warnings[0].hint)
  && /not defined anywhere in the supplied chain/.test(removedGhost.warnings[0].hint)
  && /runtime ignores a remove of a name it does not have/.test(removedGhost.warnings[0].hint), () => removedGhost.warnings);
// ENG-100314 (F3) — absence from the SUPPLIED fold is not proof of absence in Classic. With NO seed the hint says the
// parent-template chain was not checked; it must never claim "not a seed (F2) problem".
check("ENG-100314 (F3): with no seed supplied, the no-op hint says the unchecked parent chain may define the name (F2) and never rules F2 out",
  /No base seed was supplied/.test(removedGhost.warnings[0].hint) && /may define 'Zombie' \(F2\)/.test(removedGhost.warnings[0].hint)
  && !/Not a schema-order \(F1\) or seed \(F2\) problem/.test(removedGhost.warnings[0].hint), () => removedGhost.warnings[0].hint);
// The BlythecoDev shape: a stray `remove "e"` inside a run of real removes. The real removes are unaffected.
const stray = mergeHierarchy([
  synth("Base", [{ operation: "insert", name: "BantGroup", itemType: 15 }, { operation: "insert", name: "Budget", parentName: "BantGroup", propertyName: "items", bindTo: "Budget" }]),
  synth("Top", [{ operation: "remove", name: "Budget" }, { operation: "remove", name: "e" }, { operation: "remove", name: "BantGroup" }]),
]);
check("ENG-100314: a stray remove amid real removes — real ones stay in removed[], the stray one is a fidelity note only",
  stray.removed.map(r => r.name).sort((a, b) => a.localeCompare(b)).join(",") === "BantGroup,Budget"
  && stray.warnings.length === 1 && stray.warnings[0].name === "e" && stray.warnings[0].severity === "fidelity",
  () => ({ removed: stray.removed, warnings: stray.warnings }));
// A LATER layer that DOES define the name is the genuine ordering signal: the remove ran before its target existed.
for (const [label, laterOp] of /** @type {[string, object][]} */ ([
  ["insert", { operation: "insert", name: "Late", parentName: "Header", propertyName: "items", bindTo: "Late" }],
  ["merge", { operation: "merge", name: "Late", values: { caption: "x" } }],
  ["move", { operation: "move", name: "Late", parentName: "Header" }],
  ["parentName", { operation: "insert", name: "Kid", parentName: "Late", propertyName: "items", bindTo: "Kid" }],
])) {
  const r = mergeHierarchy([synth("Early", [{ operation: "remove", name: "Late" }]), synth("Later", [laterOp])]);
  const w = r.warnings.find(x => x.op === "remove" && x.name === "Late");
  check(`ENG-100314: remove of a name a LATER layer references (${String(label)}) stays CORRECTNESS and names that layer (F1)`,
    !!w && w.severity === "correctness" && /referenced by Later/.test(w.hint) && /schema order \(F1\)/.test(w.hint), () => r.warnings);
}
// Two layers both removing the same stray name are still two no-ops — a remove is not a reference.
const twice = mergeHierarchy([synth("A", [{ operation: "remove", name: "e" }]), synth("B", [{ operation: "remove", name: "e" }])]);
check("ENG-100314: a second remove of the same never-defined name does not turn the first into an ordering signal",
  twice.warnings.length === 1 && twice.warnings[0].severity === "fidelity" && !twice.removed.length, () => twice);

// ---- ENG-100314 review round: what counts as a REFERENCE, aliases, the same-layer idiom, seed completeness ----
// Seeds with REAL method bodies (makeSchema sets no `emptyMethods`, so every name counts as real-bodied).
const seedWith = (n, diff = []) => makeSchema("Seed", { entity: "X", diff, methods: Array.from({ length: n }, (_, i) => `m${i}`) });
const psX = (pkg, diff) => parseSchema(`define("${pkg}",[],function(){return{entitySchemaName:"X",diff:${JSON.stringify(diff)}};});`, pkg);
const warnOf = (r, name) => r.warnings.find((w) => w.op === "remove" && w.name === name);

// (1) An alias registration IS a reference: in the right order the remove resolves the alias and removes `Real`.
const aliasLater = mergeHierarchy([psX("Early", [{ operation: "remove", name: "Old" }]),
  psX("Later", [{ operation: "insert", name: "Real", parentName: "Header", propertyName: "items", values: { bindTo: "Name" }, alias: { name: "Old" } }])]);
check("ENG-100314 (alias): remove of a name a LATER layer registers as an ALIAS stays CORRECTNESS and names that layer — in schema order the remove would reach `Real` through the alias (F1)",
  warnOf(aliasLater, "Old")?.severity === "correctness" && /referenced by Later \(alias, a later layer\)/.test(warnOf(aliasLater, "Old").hint),
  () => aliasLater.warnings);
// …and the diagnostic tombstone Early left must not SHADOW the alias for a remove that runs after the registration.
const aliasShadow = mergeHierarchy([psX("Early", [{ operation: "remove", name: "Old" }]),
  psX("Later", [{ operation: "insert", name: "Real", parentName: "Header", propertyName: "items", values: { bindTo: "Name" }, alias: { name: "Old" } }]),
  psX("Top", [{ operation: "remove", name: "Old" }])]);
check("ENG-100314 (alias): a never-defined tombstone does not shadow a real alias target — Top's `remove \"Old\"` resolves through the alias and removes `Real`, as Classic does",
  !aliasShadow.items.some((i) => i.name === "Real") && aliasShadow.removed.some((r) => r.name === "Real" && r.removedBy === "Top")
  && warnOf(aliasShadow, "Old")?.severity === "correctness",
  () => ({ items: aliasShadow.items.map((i) => i.name), removed: aliasShadow.removed, warnings: aliasShadow.warnings }));

// (2) A `remove` carrying `parentName` places nothing, so it is no reference — nothing ever existed here.
const rmParent = mergeHierarchy([synth("T", [{ operation: "remove", name: "Ghost" }, { operation: "remove", name: "Kid", parentName: "Ghost" }])]);
check("ENG-100314: a `remove` carrying `parentName` does not count as a reference — both removes are FIDELITY and nothing lands in removed[]",
  rmParent.warnings.length === 2 && rmParent.warnings.every((w) => w.severity === "fidelity") && !rmParent.removed.length,
  () => ({ warnings: rmParent.warnings, removed: rmParent.removed }));
// An unknown operation is dropped by `splitDiffOps` (the runtime's empty `default:`), so it cannot reference anything.
const rmUnknown = mergeHierarchy([synth("A", [{ operation: "remove", name: "Ghost" }]), synth("B", [{ operation: "frobnicate", name: "Ghost", parentName: "Ghost" }])]);
check("ENG-100314: an UNKNOWN operation naming the removed name is ignored — the remove stays a FIDELITY no-op",
  warnOf(rmUnknown, "Ghost")?.severity === "fidelity" && !rmUnknown.removed.length, () => rmUnknown.warnings);
// An alias-EXCLUDED op never runs, so its `parentName` is no reference either. Control: the same op NOT excluded does.
const exclDiff = (excluded) => [psX("A", [{ operation: "remove", name: "Ghost" }]),
  psX("B", [{ operation: "insert", name: "Real", parentName: "Header", propertyName: "items", values: { bindTo: "Name" }, alias: { name: "K", excludeOperations: excluded ? ["insert"] : [] } }]),
  psX("C", [{ operation: "insert", name: "K", parentName: "Ghost", propertyName: "items", values: { bindTo: "Other" } }])];
const rmExcluded = mergeHierarchy(exclDiff(true));
const rmNotExcluded = mergeHierarchy(exclDiff(false));
check("ENG-100314: an alias-EXCLUDED insert placing a child under the name is no reference (it never runs) — FIDELITY; the same insert NOT excluded keeps CORRECTNESS",
  warnOf(rmExcluded, "Ghost")?.severity === "fidelity" && warnOf(rmNotExcluded, "Ghost")?.severity === "correctness"
  && /referenced by C \(parentName, a later layer\)/.test(warnOf(rmNotExcluded, "Ghost").hint),
  () => ({ excluded: rmExcluded.warnings, notExcluded: rmNotExcluded.warnings }));
// An alias whose `excludeOperations` lists `remove` makes a plain remove of the alias name a no-op after the
// registration, and before it the remove hits nothing — no schema order can make it reach `Real`, so the
// registration is no reference: FIDELITY. Control: the same alias without the exclusion keeps CORRECTNESS (F1).
const aliasRmExcl = (excl) => mergeHierarchy([psX("Early", [{ operation: "remove", name: "Old" }]),
  psX("L", [{ operation: "insert", name: "Real", parentName: "Header", propertyName: "items", values: { bindTo: "Name" }, alias: { name: "Old", excludeOperations: excl } }])],
  { seedTemplate: [seedWith(200, [{ operation: "insert", name: "Header", itemType: 15 }])] });
const aliasRmExcluded = aliasRmExcl(["remove"]);
const aliasRmNotExcluded = aliasRmExcl(["merge"]);
check("ENG-100314: an alias registration whose `excludeOperations` contains `remove` is no reference — the earlier remove of the alias name is FIDELITY; without that exclusion it stays CORRECTNESS",
  warnOf(aliasRmExcluded, "Old")?.severity === "fidelity" && !/referenced by L/.test(warnOf(aliasRmExcluded, "Old").hint)
  && warnOf(aliasRmNotExcluded, "Old")?.severity === "correctness" && /referenced by L \(alias, a later layer\)/.test(warnOf(aliasRmNotExcluded, "Old").hint),
  () => ({ excluded: aliasRmExcluded.warnings, notExcluded: aliasRmNotExcluded.warnings }));

// (6e) A referenced (correctness) tombstone is still reported: removed[] and unresolvedParents both name it.
const rmKid = mergeHierarchy([synth("Early", [{ operation: "remove", name: "Late" }]),
  synth("Later", [{ operation: "insert", name: "Kid", parentName: "Late", propertyName: "items", bindTo: "Kid" }])]);
check("ENG-100314: a remove whose name a later child is parented under keeps its tombstone in removed[] AND the name in unresolvedParents",
  warnOf(rmKid, "Late")?.severity === "correctness" && rmKid.removed.some((r) => r.name === "Late") && rmKid.unresolvedParents.includes("Late"),
  () => ({ removed: rmKid.removed, unresolvedParents: rmKid.unresolvedParents, warnings: rmKid.warnings }));
// (6f) Three removes, then a later insert: one warning (the 2nd/3rd hit the tombstone), correctness, naming the definer.
const rmThrice = mergeHierarchy([synth("A", [{ operation: "remove", name: "X" }]), synth("B", [{ operation: "remove", name: "X" }]),
  synth("C", [{ operation: "remove", name: "X" }]), synth("D", [{ operation: "insert", name: "X", parentName: "Header", propertyName: "items", bindTo: "X" }])]);
check("ENG-100314: three removes then a later insert stay CORRECTNESS and the hint names the DEFINING layer (D), not another remover",
  rmThrice.warnings.filter((w) => w.op === "remove").length === 1 && warnOf(rmThrice, "X")?.severity === "correctness"
  && /referenced by D \(insert, a later layer\)/.test(warnOf(rmThrice, "X").hint), () => rmThrice.warnings);
// (7) A LOWER reference that gave the remove nothing to hit (a `move` onto nothing) says so — and a later definer wins.
const rmLower = mergeHierarchy([synth("A", [{ operation: "move", name: "G", parentName: "Header" }]), synth("B", [{ operation: "remove", name: "G" }])]);
check("ENG-100314: a reference from a LOWER layer is named as such and points at the seed (F2), not only at order",
  warnOf(rmLower, "G")?.severity === "correctness" && /referenced by A \(move, a lower layer\)/.test(warnOf(rmLower, "G").hint)
  && /missing from the seed \(F2\)/.test(warnOf(rmLower, "G").hint), () => rmLower.warnings);
const rmPrefer = mergeHierarchy([synth("A", [{ operation: "move", name: "G", parentName: "Header" }]), synth("B", [{ operation: "remove", name: "G" }]),
  synth("C", [{ operation: "insert", name: "G", parentName: "Header", propertyName: "items", bindTo: "G" }])]);
check("ENG-100314: with both a lower and a later reference, the hint prefers the LATER one (the F1 ordering signal)",
  /referenced by C \(insert, a later layer\)/.test(warnOf(rmPrefer, "G")?.hint || ""), () => rmPrefer.warnings);

// (4) Same-layer `remove X` + `insert X` on a never-defined name: removes run before inserts within a layer, so the
// remove hits nothing and the insert defines X. Reordering schemas cannot change that — not a schema-order signal.
const restate = mergeHierarchy([synth("L", [{ operation: "remove", name: "X" }, { operation: "insert", name: "X", parentName: "Header", propertyName: "items", bindTo: "X" }])],
  { seedTemplate: [seedWith(200, [{ operation: "insert", name: "Header", itemType: 15 }])] });
check("ENG-100314: same-layer remove + insert of a never-defined name is the remove-and-restate idiom — FIDELITY, dedicated hint, X alive and not in removed[]",
  warnOf(restate, "X")?.severity === "fidelity" && /re-inserted by the same layer \(L\)/.test(warnOf(restate, "X").hint)
  && /no effect on the folded page/.test(warnOf(restate, "X").hint) && /base seed may lack 'X' \(F2\)/.test(warnOf(restate, "X").hint)
  && !/schema order/.test(warnOf(restate, "X").hint)
  && restate.items.some((i) => i.name === "X") && !restate.removed.some((r) => r.name === "X"), () => restate.warnings);
// …but a same-layer child placed under X WITHOUT the layer inserting X is still the F2 signal.
const sameKid = mergeHierarchy([synth("L", [{ operation: "remove", name: "X" }, { operation: "insert", name: "Kid", parentName: "X", propertyName: "items", bindTo: "Kid" }])]);
check("ENG-100314: a same-layer child under X with no insert of X is NOT the idiom — CORRECTNESS, named as the same layer",
  warnOf(sameKid, "X")?.severity === "correctness" && /referenced by L \(parentName, the same layer\)/.test(warnOf(sameKid, "X").hint), () => sameKid.warnings);

// (3) Seed completeness shapes the no-op hint. A PARTIAL seed (5..149 methods) says outright that it may lack the name.
const rmPartial = mergeHierarchy([synth("P", [{ operation: "remove", name: "e" }])], { seedTemplate: [seedWith(20)] });
check("ENG-100314 (F3): a no-op remove folded over a possiblyPartial seed is FIDELITY and its hint says the PARTIAL seed may lack the name",
  rmPartial.seedQuality.possiblyPartial === true && warnOf(rmPartial, "e")?.severity === "fidelity"
  && /Confirm the base seed if it is partial \(F2\)/.test(warnOf(rmPartial, "e").hint)
  && /base seed looks PARTIAL \(seedQuality\.possiblyPartial\), so it may lack 'e' \(F2\)/.test(warnOf(rmPartial, "e").hint),
  () => warnOf(rmPartial, "e"));
const rmFull = mergeHierarchy([synth("P", [{ operation: "remove", name: "e" }])], { seedTemplate: [seedWith(200)] });
check("ENG-100314 (F3): over a complete-looking seed the hint keeps the completeness caveat but adds no partial/absent sentence",
  warnOf(rmFull, "e")?.severity === "fidelity" && /unless the chain is incomplete/.test(warnOf(rmFull, "e").hint)
  && !/PARTIAL|No base seed/.test(warnOf(rmFull, "e").hint) && !warnOf(rmFull, "e").accepted, () => warnOf(rmFull, "e"));

// (6a / opus #9) A stray remove inside a SEED layer: fidelity, kept out of removed[], and — being the base
// template's own no-op, not a client decision — recorded CLOSED so the plan demands no disposition for it.
const rmInSeed = mergeHierarchy([synth("P", [])], { seedTemplate: [seedWith(200, [{ operation: "remove", name: "tplStray" }])] });
const rmInSeedW = warnOf(rmInSeed, "tplStray");
check("ENG-100314: a stray remove inside a SEED layer is FIDELITY, not in removed[], and pre-closed as template-owned (`fromTemplate`, accepted n/a)",
  rmInSeedW?.severity === "fidelity" && rmInSeedW.fromTemplate === true && rmInSeedW.accepted === true && rmInSeedW.disposition === "n/a"
  && !rmInSeed.removed.some((r) => r.name === "tplStray"), () => rmInSeedW);
// …unless the seed itself is partial: then the seed's own completeness is in question and the note stays open.
const rmInPartialSeed = mergeHierarchy([synth("P", [])], { seedTemplate: [seedWith(20, [{ operation: "remove", name: "tplStray" }])] });
check("ENG-100314: a SEED-layer no-op over a partial seed is NOT pre-closed — the partial-seed caveat must reach the reader",
  warnOf(rmInPartialSeed, "tplStray")?.severity === "fidelity" && !warnOf(rmInPartialSeed, "tplStray").accepted, () => warnOf(rmInPartialSeed, "tplStray"));
// The remove-and-restate idiom inside a SEED layer is the template's own no-op too: pre-closed over a complete seed,
// left open over a partial one.
const seedRestate = (n) => mergeHierarchy([synth("P", [])], { seedTemplate: [seedWith(n, [{ operation: "insert", name: "Header", itemType: 15 },
  { operation: "remove", name: "tplX" }, { operation: "insert", name: "tplX", parentName: "Header", propertyName: "items", bindTo: "tplX" }])] });
const seedRestateW = warnOf(seedRestate(200), "tplX");
const seedRestatePartialW = warnOf(seedRestate(20), "tplX");
check("ENG-100314: the remove-and-restate idiom inside a SEED layer is pre-closed as template-owned over a complete seed, and stays open over a partial one",
  seedRestateW?.severity === "fidelity" && /re-inserted by the same layer/.test(seedRestateW.hint)
  && seedRestateW.fromTemplate === true && seedRestateW.accepted === true && seedRestateW.disposition === "n/a"
  && seedRestatePartialW?.severity === "fidelity" && !seedRestatePartialW.accepted && !seedRestatePartialW.fromTemplate,
  () => ({ complete: seedRestateW, partial: seedRestatePartialW }));

// ---- ENG-100314 review round 2 ----
// (#1) The remove-and-restate idiom with a HIGHER layer referencing the re-inserted element: L1 restates base element
// X, L2 customises it. The later reference lands on L1's X, so it is no ordering signal — the idiom holds.
const hdrX = [{ operation: "insert", name: "Header", itemType: 15 }, { operation: "remove", name: "X" },
  { operation: "insert", name: "X", parentName: "Header", propertyName: "items", bindTo: "X" }];
const restateMerged = mergeHierarchy([synth("L1", hdrX), synth("L2", [{ operation: "merge", name: "X", values: { caption: "c" } }])]);
check("ENG-100314 (idiom + later merge): L1 removes and re-inserts X, L2 merges X — FIDELITY idiom, no F1 hint naming L2, X alive and not in removed[]",
  warnOf(restateMerged, "X")?.severity === "fidelity" && /re-inserted by the same layer \(L1\)/.test(warnOf(restateMerged, "X").hint)
  && /A later layer \(L2, merge\) references 'X' too; it acts on the re-inserted element/.test(warnOf(restateMerged, "X").hint)
  && !/schema order/.test(warnOf(restateMerged, "X").hint)
  && restateMerged.items.some((i) => i.name === "X") && !restateMerged.removed.some((r) => r.name === "X"),
  () => restateMerged.warnings);
const restateKid = mergeHierarchy([synth("L1", hdrX), synth("L2", [{ operation: "insert", name: "Kid", parentName: "X", propertyName: "items", bindTo: "Kid" }])]);
check("ENG-100314 (idiom + later child): L1 removes and re-inserts X, L2 inserts a child under X — FIDELITY idiom, the gate is not blocked by it",
  warnOf(restateKid, "X")?.severity === "fidelity" && /re-inserted by the same layer \(L1\)/.test(warnOf(restateKid, "X").hint)
  && !restateKid.unresolvedParents.includes("X"), () => restateKid.warnings);
// …but a LOWER reference still breaks the idiom: a lower `move` onto nothing means the base element was expected.
const restateLower = mergeHierarchy([synth("L0", [{ operation: "move", name: "X", parentName: "Header" }]), synth("L1", hdrX)]);
check("ENG-100314 (idiom + lower reference): a LOWER layer referencing X keeps the same-layer restate CORRECTNESS (seed F2)",
  warnOf(restateLower, "X")?.severity === "correctness" && /referenced by L0 \(move, a lower layer\)/.test(warnOf(restateLower, "X").hint),
  () => restateLower.warnings);

// (#3) Seed removes stray `s`, then client layer P removes `s` again: the seed's no-op is pre-closed as template-owned
// (decided from the seed flag captured at replay, not the tombstone P overwrote), and P's own remove gets an OPEN note.
const rmSeedThenClient = mergeHierarchy([synth("P", [{ operation: "remove", name: "s" }])], { seedTemplate: [seedWith(200, [{ operation: "remove", name: "s" }])] });
const sWarns = rmSeedThenClient.warnings.filter((w) => w.op === "remove" && w.name === "s");
check("ENG-100314 (seed then client re-remove): the SEED note is pre-closed (`fromTemplate`) and P's re-remove is its own OPEN fidelity note",
  sWarns.length === 2
  && sWarns.some((w) => w.schema === "Seed" && w.fromTemplate === true && w.accepted === true && w.severity === "fidelity")
  && sWarns.some((w) => w.schema === "P" && !w.fromTemplate && !w.accepted && w.severity === "fidelity"
    && /no effect in Classic unless the chain is incomplete/.test(w.hint))
  && !rmSeedThenClient.removed.some((r) => r.name === "s"), () => sWarns);

// (#4) A tombstone the runtime does not have must not shadow a live alias target: a REAL tombstone and an
// engine-only merge stub both fall through to the alias, as Classic's literal-name-absent lookup does.
const aliasOverRemoved = mergeHierarchy([
  psX("Early", [{ operation: "insert", name: "Old", parentName: "Header", propertyName: "items", values: { bindTo: "A" } }]),
  psX("Mid", [{ operation: "remove", name: "Old" }]),
  psX("Later", [{ operation: "insert", name: "Real", parentName: "Header", propertyName: "items", values: { bindTo: "Name" }, alias: { name: "Old" } }]),
  psX("Top", [{ operation: "remove", name: "Old" }])]);
check("ENG-100314 (alias over a REAL tombstone): Top's `remove \"Old\"` resolves through the alias and removes `Real`",
  !aliasOverRemoved.items.some((i) => i.name === "Real") && aliasOverRemoved.removed.some((r) => r.name === "Real" && r.removedBy === "Top"),
  () => ({ items: aliasOverRemoved.items.map((i) => i.name), removed: aliasOverRemoved.removed.map((r) => [r.name, r.removedBy]) }));
const aliasOverStub = mergeHierarchy([
  psX("Early", [{ operation: "merge", name: "Old", values: { caption: "x" } }]),
  psX("Later", [{ operation: "insert", name: "Real", parentName: "Header", propertyName: "items", values: { bindTo: "Name" }, alias: { name: "Old" } }]),
  psX("Top", [{ operation: "remove", name: "Old" }])]);
check("ENG-100314 (alias over an engine-only stub): Top's `remove \"Old\"` resolves through the alias and removes `Real`",
  !aliasOverStub.items.some((i) => i.name === "Real") && aliasOverStub.removed.some((r) => r.name === "Real" && r.removedBy === "Top"),
  () => ({ items: aliasOverStub.items.map((i) => i.name), removed: aliasOverStub.removed.map((r) => [r.name, r.removedBy]) }));
// …and the move-resurrect idiom (no alias) still lands on its tombstone and resurrects it.
const moveResurrect = mergeHierarchy([
  psX("Early", [{ operation: "insert", name: "Old", parentName: "Header", propertyName: "items", values: { bindTo: "A" } }]),
  psX("Mid", [{ operation: "remove", name: "Old" }]), psX("Top", [{ operation: "move", name: "Old", parentName: "Header" }])]);
check("ENG-100314 (control): remove → move with no alias still resurrects the tombstone",
  moveResurrect.items.some((i) => i.name === "Old") && !moveResurrect.removed.some((r) => r.name === "Old"), () => moveResurrect.items);
// …but with a LIVE alias target registered for the name, the move after the remove lands on the alias target
// (Classic's lookup across layers): Old stays removed and Real is moved. HEAD resurrected Old here.
const moveViaAlias = mergeHierarchy([
  psX("E", [{ operation: "insert", name: "Old", parentName: "Header", propertyName: "items", values: { bindTo: "A" } },
    { operation: "insert", name: "Box", parentName: "Header", propertyName: "items", values: { itemType: 7 } }]),
  psX("L", [{ operation: "insert", name: "Real", parentName: "Header", propertyName: "items", values: { bindTo: "Name" }, alias: { name: "Old" } }]),
  psX("Top", [{ operation: "remove", name: "Old" }, { operation: "move", name: "Old", parentName: "Box" }])]);
check("ENG-100314 (move-resurrect with a live alias): remove Old + move Old in Top — Old stays removed and the move lands on Real",
  !moveViaAlias.items.some((i) => i.name === "Old") && moveViaAlias.removed.some((r) => r.name === "Old" && r.removedBy === "Top")
  && moveViaAlias.items.find((i) => i.name === "Real")?.parent === "Box",
  () => ({ items: moveViaAlias.items.map((i) => [i.name, i.parent]), removed: moveViaAlias.removed.map((r) => [r.name, r.removedBy]) }));

// (#5) A move that resurrects a never-defined tombstone makes it a LIVE element: a later alias registration of the
// same name must not steal a later op on it (`resolveTarget` would read a stale `neverDefined` as absent).
const resurrectThenAlias = mergeHierarchy([
  psX("Early", [{ operation: "remove", name: "Old" }]),
  psX("Mid", [{ operation: "move", name: "Old", parentName: "Header" }]),
  psX("Later", [{ operation: "insert", name: "Real", parentName: "Header", propertyName: "items", values: { bindTo: "Name" }, alias: { name: "Old" } }]),
  psX("Top", [{ operation: "merge", name: "Old", values: { caption: "c" } }])]);
const rOld = resurrectThenAlias.items.find((i) => i.name === "Old");
const rReal = resurrectThenAlias.items.find((i) => i.name === "Real");
check("ENG-100314 (resurrect clears neverDefined): Top's `merge \"Old\"` lands on the resurrected Old, not on the alias target Real",
  rOld?.caption === "c" && rReal && rReal.caption !== "c", () => ({ old: rOld, real: rReal }));

/* ---- F2: a parent removed by a lower schema must surface as unresolved (no false all-clear) ---- */
const tomb = mergeHierarchy([
  synth("base", [
    { operation: "insert", name: "Grp", itemType: 15 },
    { operation: "insert", name: "F", parentName: "Grp", propertyName: "items", bindTo: "Col" },
  ]),
  synth("top", [{ operation: "remove", name: "Grp" }]),
]);
check("F2: parent surviving only as a tombstone is reported unresolved (engine⇄mapper consistent)",
  tomb.unresolvedParents.includes("Grp") && !tomb.items.some(i => i.name === "Grp"));
// CASCADE REMOVE — removing a container drops its BASE (templateOwned) subtree (Classic runtime parity), so a
// heavily-layered page's base remove+re-layout does not FALSE-block on unresolvedParents; but a CLIENT-authored
// orphan of the same removed container still SURFACES (never silently drop client content). Both in one fixture.
const casc = mergeHierarchy(
  [makeSchema("Client", { entity: "X", diff: [
    { operation: "insert", name: "ClientChild", parentName: "BaseGrp", propertyName: "items", bindTo: "CliCol" }, // client content placed under the base group
    { operation: "remove", name: "BaseGrp" },                                                                     // ...then the base group is removed
  ] })],
  { seedTemplate: [makeSchema("Tpl", { diff: [
    { operation: "insert", name: "BaseGrp", itemType: 15 },
    { operation: "insert", name: "BaseChild", parentName: "BaseGrp", propertyName: "items", bindTo: "BaseCol" },  // BASE child under the group
  ], methods: ["a", "b", "c", "d", "e", "f"] })] });
check("cascade: a BASE (templateOwned) child of a removed container is SWEPT (runtime parity — no false unresolvedParent, not in alive)",
  !casc.items.some((i) => i.name === "BaseChild"));
check("cascade: a CLIENT-authored orphan of the same removed container still SURFACES (unresolvedParents) — client content not silently dropped",
  casc.unresolvedParents.includes("BaseGrp") && casc.items.some((i) => i.name === "ClientChild"));
// the sweep must propagate DEEP, not one level — a GRANDCHILD of a removed container is
// swept too (silent client-content drop is the stated risk if propagation is shallow).
const cascDeep = mergeHierarchy(
  [makeSchema("Client", { entity: "X", diff: [{ operation: "remove", name: "BaseGrp" }] })],
  { seedTemplate: [makeSchema("Tpl", { diff: [
    { operation: "insert", name: "BaseGrp", itemType: 15 },
    { operation: "insert", name: "MidGrp", parentName: "BaseGrp", propertyName: "items", itemType: 15 },       // child container
    { operation: "insert", name: "DeepChild", parentName: "MidGrp", propertyName: "items", bindTo: "DeepCol" }, // GRANDCHILD (2 levels down)
  ], methods: ["a", "b", "c", "d", "e", "f"] })] });
check("cascade(deep): removing a container sweeps its WHOLE base subtree — a GRANDCHILD (BaseGrp→MidGrp→DeepChild) is swept, not just the direct child",
  !cascDeep.items.some((i) => i.name === "MidGrp") && !cascDeep.items.some((i) => i.name === "DeepChild"),
  () => cascDeep.items.map((i) => i.name).join(","));
// ...and a CYCLIC base parentName (CycA↔CycB) must not spin the fixpoint — removing one TERMINATES and sweeps both.
const cascCycle = mergeHierarchy(
  [makeSchema("Client", { entity: "X", diff: [{ operation: "remove", name: "CycA" }] })],
  { seedTemplate: [makeSchema("Tpl", { diff: [
    { operation: "insert", name: "CycA", parentName: "CycB", propertyName: "items", itemType: 15 },
    { operation: "insert", name: "CycB", parentName: "CycA", propertyName: "items", itemType: 15 },
  ], methods: ["a", "b", "c", "d", "e", "f"] })] });
check("cascade(cyclic parent): a cyclic base parentName terminates the sweep fixpoint (no hang) and sweeps both nodes",
  !cascCycle.items.some((i) => ["CycA", "CycB"].includes(i.name)));

/* ---- C2: a merge that introduces contentType on an ALREADY-defined field must carry it (not drop) ---- */
const c2 = mergeHierarchy([
  synth("base", [{ operation: "insert", name: "F", parentName: "Header", propertyName: "items", bindTo: "Col" }]),
  synth("top", [{ operation: "merge", name: "F", contentType: 5 }]),  // later schema marks it a lookup
]);
check("C2: merge introduces contentType (5=lookup) on an existing item — carried, not dropped",
  c2.items.find(i => i.name === "F")?.contentType === 5);

/* ---- `set` and `remove`-with-`properties`, the two operations the engine did not implement ----
   Driven through a REAL schema body and `parseSchema`, not the testkit's pre-normalized ops, because half of what
   is being pinned is that the PARSER carries `op.properties` and the `set` operation name at all — a `makeOp`-based
   golden would pass even if `normalizeDiffOp` dropped them (which is how the `valuesKeys` gap slipped through).
   HONEST LIMIT: no occurrence of either operation was found in 130 schema bodies across 5 real Classic pages, so
   these are synthetic cases validated against core `json-applier.js`, not against observed data. Group ordering is
   still not mirrored, so nothing here asserts anything about the order operations run in. ---- */
const realBody = (diff) => `define("T",[],function(){return{entitySchemaName:"X",diff:[${diff}]};});`;
const realRun = (...ops) => mergeHierarchy([parseSchema(realBody(ops.join(",")), "T")]);
// Two LAYERS, which is the realistic shape and the only one that can express "a later schema changes this".
// Within ONE layer the runtime runs all merges BEFORE any insert, so a single-layer insert+merge pair tests
// array-order semantics that the runtime does not have — see the group-ordering pins below.
const realRun2 = (opsA, opsB) => mergeHierarchy([parseSchema(realBody(opsA), "A"), parseSchema(realBody(opsB), "B")]);

/* ---- `set` must not hide CLIENT-authored children ----
   `cascadeRemove` deliberately skips non-templateOwned items (its `!it.templateOwned` guard) so client-authored
   removals surface individually, and `removed[]` filters out anything carrying `cascadeRemoved`. Setting that
   flag on EVERY direct child would make a client element inside a replaced container vanish from the decision rows with no
   per-element diagnostic — the op's warning counts dropped children but a count is not an element. Mixed ownership is
   the only shape that discriminates. */
const setMixedSeed = parseSchema(realBody([
  `{operation:"insert",name:"Box",parentName:"Header",propertyName:"items",values:{itemType:7}}`,
  `{operation:"insert",name:"TplKid",parentName:"Box",propertyName:"items",values:{bindTo:"Name"}}`].join(",")), "Tpl");
const setMixedClient = parseSchema(realBody([
  `{operation:"insert",name:"CliKid",parentName:"Box",propertyName:"items",values:{bindTo:"Other"}}`,
  `{operation:"set",name:"Box",values:{itemType:7}}`].join(",")), "Client");
const setMixed = mergeHierarchy([setMixedClient], { seedTemplate: [setMixedSeed] });
const setMixedRemoved = setMixed.removed.map((r) => r.name).sort((a, b) => a.localeCompare(b));
check("a `set` that drops a mixed-ownership child set keeps the CLIENT-authored child in removed[] as its own decision row, while the template-owned one is swept as structural cleanup",
  setMixedRemoved.join(",") === "CliKid" && !setMixed.items.some((i) => ["TplKid", "CliKid"].includes(i.name)),
  () => ({ removed: setMixedRemoved, items: setMixed.items.map((i) => i.name) }));

/* ---- aliases ----
   `saveAlias` (json-applier.js L554-566) keys the table by the ALIAS name and stores the REAL item name on it, which
   is what lets a later op target the element by the alias. It also carries `excludeOperations` (a whole op on that
   name becomes a no-op, L601-608) and `excludeProperties` (individual merge keys never apply, L583-591). The table
   survives every layer — `applyDiff` resets it only on an empty source object, i.e. once.
   HONEST LIMIT: no `alias` appears anywhere in the harvested corpus, so all of this is synthetic. */
const aliasResolved = realRun2(
  `{operation:"insert",name:"RealFld",parentName:"Header",propertyName:"items",values:{bindTo:"Name",caption:"Resources.Strings.Orig"},alias:{name:"OldFld"}}`,
  `{operation:"merge",name:"OldFld",values:{caption:"Resources.Strings.ViaAlias"}}`);
check("a later op targeting the ALIAS name reaches the real element — the table is keyed by the alias and carries the real name, so `OldFld` resolves to `RealFld`",
  aliasResolved.items.find((i) => i.name === "RealFld")?.caption === "Resources.Strings.ViaAlias"
  && !aliasResolved.items.some((i) => i.name === "OldFld"),
  () => aliasResolved.items.map((i) => `${i.name}:${i.caption}`));
// Control: WITHOUT the alias the same merge finds nothing and produces the engine-only stub instead. Without this,
// "resolution works" could be satisfied by resolving every unknown name to something.
const aliasAbsent = realRun2(
  `{operation:"insert",name:"RealFld",parentName:"Header",propertyName:"items",values:{bindTo:"Name",caption:"Resources.Strings.Orig"}}`,
  `{operation:"merge",name:"OldFld",values:{caption:"Resources.Strings.ViaAlias"}}`);
check("with NO alias registered the same merge does NOT reach the element — it falls through to the engine-only stub, so resolution is driven by the table and not by name guessing",
  aliasAbsent.items.find((i) => i.name === "RealFld")?.caption === "Resources.Strings.Orig"
  && aliasAbsent.items.find((i) => i.name === "OldFld")?.engineOnlyStub === true,
  () => aliasAbsent.items.map((i) => `${i.name}:${i.caption}:stub=${i.engineOnlyStub}`));
const aliasExclOp = realRun2(
  `{operation:"insert",name:"RealFld",parentName:"Header",propertyName:"items",values:{bindTo:"Name"},alias:{name:"OldFld",excludeOperations:["remove"]}}`,
  `{operation:"remove",name:"OldFld"}`);
check("an alias `excludeOperations` entry makes that operation a no-op — the remove never runs and the element is not tombstoned",
  aliasExclOp.items.some((i) => i.name === "RealFld") && !aliasExclOp.removed.some((r) => r.name === "RealFld"),
  () => ({ items: aliasExclOp.items.map((i) => i.name), removed: aliasExclOp.removed.map((r) => r.name) }));
// The runtime's carve-out: a `remove` carrying `properties` is a DIFFERENT operation and is never excluded.
const aliasExclCarveOut = realRun2(
  `{operation:"insert",name:"RealFld",parentName:"Header",propertyName:"items",values:{bindTo:"Name",caption:"Resources.Strings.Cap"},alias:{name:"OldFld",excludeOperations:["remove"]}}`,
  `{operation:"remove",name:"OldFld",properties:["caption"]}`);
check("`excludeOperations:['remove']` does NOT block a `remove` carrying `properties` — the runtime carves that out explicitly, because the two forms are different operations",
  aliasExclCarveOut.items.find((i) => i.name === "RealFld")?.caption === null,
  () => aliasExclCarveOut.items.find((i) => i.name === "RealFld"));
const aliasExclProp = realRun2(
  `{operation:"insert",name:"RealFld",parentName:"Header",propertyName:"items",values:{bindTo:"Name",caption:"Resources.Strings.Keep"},alias:{name:"OldFld",excludeProperties:["caption"]}}`,
  `{operation:"merge",name:"OldFld",values:{caption:"Resources.Strings.Blocked",tip:{content:{bindTo:"Resources.Strings.T"}}}}`);
const aep = aliasExclProp.items.find((i) => i.name === "RealFld");
check("an alias `excludeProperties` entry drops just that key from the merge — the caption is held back while a non-excluded property on the same op still applies (both arms, or 'excluded' could mean 'merge does nothing')",
  aep?.caption === "Resources.Strings.Keep" && aep?.tip === "Resources.Strings.T",
  () => aep);

/* ---- a layer's diff runs in the runtime's BUCKET order, not in array order ----
   `applyOperations` (json-applier.js L299-306): all `merge`, then the position group, then remove-properties, then
   `set`. Pinned in both directions, because "the merge did nothing" is also what a broken merge looks like.
   HONEST LIMIT: no layer in the harvested corpus (130 schema bodies, 5 real pages) contains an `insert X` + `merge X`
   pair, so this behaviour is synthetic — validated against json-applier.js, not observed on a page. */
const sameLayerMerge = realRun(
  `{operation:"insert",name:"Fld",parentName:"Header",propertyName:"items",values:{bindTo:"Name",caption:"Resources.Strings.Ins"}}`,
  `{operation:"merge",name:"Fld",values:{caption:"Resources.Strings.Merged"}}`);
check("within ONE layer a `merge` runs BEFORE the `insert` that defines its target, so the merge is a NO-OP — replaying in array order applied it and reported a caption the page does not have",
  sameLayerMerge.items.find((i) => i.name === "Fld")?.caption === "Resources.Strings.Ins",
  () => sameLayerMerge.items.find((i) => i.name === "Fld"));
const crossLayerMerge = realRun2(
  `{operation:"insert",name:"Fld",parentName:"Header",propertyName:"items",values:{bindTo:"Name",caption:"Resources.Strings.Ins"}}`,
  `{operation:"merge",name:"Fld",values:{caption:"Resources.Strings.Merged"}}`);
check("the SAME pair across two layers DOES apply — bucket ordering is per layer, so this proves merges still work rather than having been switched off",
  crossLayerMerge.items.find((i) => i.name === "Fld")?.caption === "Resources.Strings.Merged",
  () => crossLayerMerge.items.find((i) => i.name === "Fld"));
// `set` is the LAST bucket, so its array position is irrelevant: written first, it still lands after the merge.
const setLastRun = realRun2(
  `{operation:"insert",name:"Box",parentName:"Header",propertyName:"items",values:{itemType:7,caption:"Resources.Strings.BoxCap"}}`,
  [`{operation:"set",name:"Box",values:{itemType:7}}`,
   `{operation:"merge",name:"Box",values:{caption:"Resources.Strings.Merged"}}`].join(","));
check("`set` is the LAST bucket — written BEFORE the merge in the array it still runs after it, so the merge's caption is wiped by the wholesale replace",
  setLastRun.items.find((i) => i.name === "Box")?.caption === null,
  () => setLastRun.items.find((i) => i.name === "Box"));

/* ---- the content properties follow the same key-presence rule as the identity ones ----
   The runtime writes whatever `values` carries, `""` and `false` included (json-applier.js L702-705). A truthiness
   guard here dropped a layer that deliberately BLANKS a caption or UNBINDS a control, so the plan kept reporting a
   caption the page does not show. Both arms are pinned: the blanking case must apply, the untouched case must not. */
const blanked = realRun2(
  `{operation:"insert",name:"F",parentName:"Header",propertyName:"items",values:{bindTo:"Name",caption:"Resources.Strings.Cap"}}`,
  `{operation:"merge",name:"F",values:{caption:""}}`);
const blankedItem = blanked.items.find((i) => i.name === "F");
check("a merge that RESTATES `caption` as empty blanks it — presence decides for the content properties too, and the base caption is not kept",
  blankedItem?.caption === null && blankedItem?.bindTo === "Name",
  () => blankedItem);
const untouchedCap = realRun2(
  `{operation:"insert",name:"F",parentName:"Header",propertyName:"items",values:{bindTo:"Name",caption:"Resources.Strings.Cap"}}`,
  `{operation:"merge",name:"F",values:{visible:false}}`);
check("a merge that does NOT carry `caption` leaves it intact — otherwise 'presence decides' would just mean 'always overwrite'",
  untouchedCap.items.find((i) => i.name === "F")?.caption === "Resources.Strings.Cap",
  () => untouchedCap.items.find((i) => i.name === "F"));

/* ---- a merge onto an item nothing defined is an ENGINE-ONLY stub, and now says so ----
   The runtime finds no item, returns false (json-applier.js L688) and `applyOperations` throws that away (L301) —
   a silent no-op. The engine records a stub instead, deliberately, because a merge onto nothing means a missing base
   seed or schemas out of order. Unmarked, though, every consumer reads that stub as an element on the rendered page. */
const stubRun = realRun(`{operation:"merge",name:"Ghost",values:{bindTo:"Name"}}`);
const ghost = stubRun.items.find((i) => i.name === "Ghost");
check("a merge-onto-missing stub is flagged `engineOnlyStub` and its warning states the runtime does nothing there — the stub is a diagnostic, not a claim about the page",
  ghost?.engineOnlyStub === true
  && (stubRun.warnings || []).some((w) => w.name === "Ghost" && /runtime silently does nothing/.test(w.hint || "")),
  () => ({ ghost, warnings: (stubRun.warnings || []).map((w) => w.hint) }));
check("an ordinary insert is NOT flagged as an engine-only stub — the marker has to distinguish, not decorate everything",
  realRun(`{operation:"insert",name:"Real",parentName:"Header",propertyName:"items",values:{bindTo:"Name"}}`)
    .items.find((i) => i.name === "Real")?.engineOnlyStub === false,
  () => realRun(`{operation:"insert",name:"Real",parentName:"Header",propertyName:"items",values:{bindTo:"Name"}}`).items);


// `remove` + `properties` deletes the NAMED keys and KEEPS the element (json-applier.js L726-730). The engine used
// to tombstone it, so an element the runtime still renders went missing from the plan entirely — the one
// divergence in this family that HIDES real UI rather than over-reporting.
const rmProps = realRun(
  `{operation:"insert",name:"Fld",parentName:"Header",propertyName:"items",values:{bindTo:"Name",caption:"Resources.Strings.C1",itemType:6}}`,
  `{operation:"remove",name:"Fld",properties:["caption"]}`);
const rmPropsItem = rmProps.items.find((i) => i.name === "Fld");
check("`remove` with a `properties` array clears ONLY those keys and KEEPS the element — caption gone, bindTo and itemType intact, and it is not in removed[]",
  !!rmPropsItem && rmPropsItem.caption === null && rmPropsItem.bindTo === "Name" && rmPropsItem.itemType === 6
  && !rmProps.removed.some((r) => r.name === "Fld"),
  () => ({ item: rmPropsItem, removed: rmProps.removed.map((r) => r.name) }));
// `value` is the one removable key modelled as TWO fields (`valueBindTo` + `optionValue`), and
// its branch recorded provenance itself on top of the unconditional record after the loop: the layer that cleared
// the key was listed TWICE as having touched the element. Both fields must clear, and the package must appear once.
const rmValue = realRun2(
  `{operation:"insert",name:"Opt",parentName:"Header",propertyName:"items",values:{itemType:19,value:{bindTo:"IsPrimary"}}}`,
  `{operation:"remove",name:"Opt",properties:["value"]}`);
const rmValueItem = rmValue.items.find((i) => i.name === "Opt");
check("`remove properties:[\"value\"]` clears BOTH derived fields and lists the removing package ONCE (its branch pushed provenance on top of the unconditional record)",
  () => rmValueItem.valueBindTo === null && rmValueItem.optionValue === null
  && rmValueItem.provenance.join(",") === "A,B",
  () => rmValueItem);
// The control arm: a plain `remove` must still tombstone. Without it, "keeps the element" could be implemented by
// making every remove a no-op.
const rmPlain = realRun2(
  `{operation:"insert",name:"Fld",parentName:"Header",propertyName:"items",values:{bindTo:"Name"}}`,
  `{operation:"remove",name:"Fld"}`);
check("a plain `remove` (no `properties`) still tombstones the element — the two forms stay distinct operations",
  !rmPlain.items.some((i) => i.name === "Fld") && rmPlain.removed.some((r) => r.name === "Fld"),
  () => ({ items: rmPlain.items.map((i) => i.name), removed: rmPlain.removed.map((r) => r.name) }));

// `set` is a wholesale replace: position is recovered from the replaced item, every unrestated property is gone,
// and so are the children (json-applier.js L660-677).
const setRun = realRun(
  `{operation:"insert",name:"Box",parentName:"Header",propertyName:"items",values:{itemType:7,caption:"Resources.Strings.BoxCap"}}`,
  `{operation:"insert",name:"Kid",parentName:"Box",propertyName:"items",values:{bindTo:"Name"}}`,
  `{operation:"set",name:"Box",values:{itemType:7}}`);
const setBox = setRun.items.find((i) => i.name === "Box");
check("`set` replaces the element wholesale — the unrestated caption is gone, the position is recovered from the replaced item, and the child is dropped with it",
  !!setBox && setBox.caption === null && setBox.parent === "Header" && setBox.itemType === 7
  && !setRun.items.some((i) => i.name === "Kid"),
  () => ({ box: setBox, items: setRun.items.map((i) => i.name) }));
// This pins the invariant, not a defect. A CLIENT-authored `Kid` (a single client layer) means
// "does not appear in removed[]" would assert exactly the hiding this guards against. That is also why a
// mutation check passes on it: such a pin agrees with the bug. The real invariant is ownership-dependent, and it is
// pinned on the mixed-ownership fixture above; here the client-authored child must be VISIBLE.
check("a CLIENT-authored child dropped by `set` appears in removed[] — it is a decision the reader must see, not structural cleanup",
  setRun.removed.some((r) => r.name === "Kid"),
  () => setRun.removed.map((r) => r.name));
// The control arm that gives `set` its meaning: the SAME values via `merge` must keep both the caption and the child.
// Two layers on purpose: in ONE layer the merge bucket runs before the inserts, so the merge would be a no-op and
// this control would pass without contrasting anything with `set` — the exact tautology it exists to rule out.
const mergeControl = realRun2(
  [`{operation:"insert",name:"Box",parentName:"Header",propertyName:"items",values:{itemType:7,caption:"Resources.Strings.BoxCap"}}`,
   `{operation:"insert",name:"Kid",parentName:"Box",propertyName:"items",values:{bindTo:"Name"}}`].join(","),
  `{operation:"merge",name:"Box",values:{itemType:7}}`);
// Compared against a run with NO third op rather than against a literal: whatever normalization the engine applies
// to a caption resource key is a separate concern, and hard-coding the normalized form here would make this test
// fail for a reason that has nothing to do with set-vs-merge.
const noThirdOp = realRun(
  `{operation:"insert",name:"Box",parentName:"Header",propertyName:"items",values:{itemType:7,caption:"Resources.Strings.BoxCap"}}`,
  `{operation:"insert",name:"Kid",parentName:"Box",propertyName:"items",values:{bindTo:"Name"}}`);
const baselineCaption = noThirdOp.items.find((i) => i.name === "Box")?.caption;
check("the same `values` via `merge` keeps BOTH the caption and the child — this is the whole difference between the two operations, so pinning one without the other pins nothing",
  baselineCaption != null
  && mergeControl.items.find((i) => i.name === "Box")?.caption === baselineCaption
  && mergeControl.items.some((i) => i.name === "Kid"),
  () => ({ baselineCaption, merged: mergeControl.items.find((i) => i.name === "Box"), items: mergeControl.items.map((i) => i.name) }));

/* ---- a `move` carries its own `values`, and the runtime applies them ----
   Grounded in real data: ContactPageV2's `SiteEventDetail` is inserted by package `SiteEvent` with
   `values: { itemType: Terrasoft.ViewItemType.DETAIL }` and then MOVED by package `EventTracking` restating the
   same `itemType`. That real occurrence is REDUNDANT — the value repeats what the insert already set — so it can
   never witness the bug. The pin therefore uses the identical code path with a DIFFERING value, which is the only
   way to observe it, and the redundant real shape is pinned separately as the control arm. ---- */
const moveApplies = mergeHierarchy([
  synth("base", [{ operation: "insert", name: "SiteEventDetail", parentName: "Header", propertyName: "items", itemType: 7 }]),
  synth("top", [{ operation: "move", name: "SiteEventDetail", parentName: "HistoryTab", itemType: 2 }]),
]);
const movedItem = moveApplies.items.find((i) => i.name === "SiteEventDetail");
check("a `move` that restates `itemType` APPLIES it (7 -> 2) — the runtime Ext.applies the move op onto the reinserted item, so ignoring its values reported a stale kind",
  movedItem?.itemType === 2 && movedItem?.parent === "HistoryTab",
  () => ({ itemType: movedItem?.itemType, parent: movedItem?.parent }));
// The real ContactPageV2 shape: the move repeats the insert's kind. Must stay a no-op, or the fix would be
// "apply something" rather than "apply what the op states".
const moveRedundant = mergeHierarchy([
  synth("base", [{ operation: "insert", name: "SiteEventDetail", parentName: "Header", propertyName: "items", itemType: 2 }]),
  synth("top", [{ operation: "move", name: "SiteEventDetail", parentName: "HistoryTab", itemType: 2 }]),
]);
check("the REAL shape (a move restating the kind the insert already set) stays a no-op on the kind — this is what ContactPageV2 actually does",
  moveRedundant.items.find((i) => i.name === "SiteEventDetail")?.itemType === 2,
  () => moveRedundant.items.find((i) => i.name === "SiteEventDetail"));
// A move that states NO itemType must leave the kind alone — key presence, same as merge.
const moveSilent = mergeHierarchy([
  synth("base", [{ operation: "insert", name: "SiteEventDetail", parentName: "Header", propertyName: "items", itemType: 2 }]),
  synth("top", [{ operation: "move", name: "SiteEventDetail", parentName: "HistoryTab" }]),
]);
check("a `move` that carries no `itemType` key leaves the kind intact — presence decides here too",
  moveSilent.items.find((i) => i.name === "SiteEventDetail")?.itemType === 2,
  () => moveSilent.items.find((i) => i.name === "SiteEventDetail"));

/* ---- the merge rule is key PRESENCE, not value — verified against core `json-applier.js` ----
   `JsonApplier.merge` takes `Object.keys(config.values)` (L583-585) and assigns unconditionally (L702-705), so a
   later layer that carries an `itemType` key AT ALL overwrites the base — including with a value this engine cannot
   resolve. Guarding on `op.itemType != null` would silently keep the base kind and report a
   RADIO_GROUP the runtime had already turned into a plain bound field (`generateStandardItem` default →
   `generateModelItem`). Both directions are pinned, because a one-sided pin passes with the guard put back. ---- */
const mergeCleared = mergeHierarchy([
  synth("base", [{ operation: "insert", name: "F", parentName: "Header", propertyName: "items", itemType: 16 }]),
  synth("top", [{ operation: "merge", name: "F", itemType: null, itemTypeUnresolved: true }]),
]);
const clearedItem = mergeCleared.items.find((i) => i.name === "F");
check("a merge that RESTATES `itemType` with a value the engine cannot resolve CLEARS the base kind (16) — keeping it asserts a kind the runtime already overwrote",
  clearedItem?.itemType === null && clearedItem?.itemTypeUnresolved === true,
  () => ({ itemType: clearedItem?.itemType, unresolved: clearedItem?.itemTypeUnresolved }));
check("clearing a resolved kind is WARNED, not silent — the element changed behaviour and the operator has to see it",
  (mergeCleared.warnings || []).some((w) => w.name === "F" && /CLEARED/.test(w.hint || "")),
  () => (mergeCleared.warnings || []).map((w) => w.hint));
// The other direction: a merge that does NOT carry the key must leave the base kind alone. This is the arm that
// fails if key-presence is implemented as "always overwrite".
const mergeKept = mergeHierarchy([
  synth("base", [{ operation: "insert", name: "F", parentName: "Header", propertyName: "items", itemType: 16 }]),
  synth("top", [{ operation: "merge", name: "F", caption: "Renamed" }]),
]);
const keptItem = mergeKept.items.find((i) => i.name === "F");
check("a merge whose `values` does NOT carry `itemType` leaves the base kind intact (16) — presence decides, so absence must be a no-op",
  keptItem?.itemType === 16 && keptItem?.itemTypeUnresolved === false,
  () => ({ itemType: keptItem?.itemType, unresolved: keptItem?.itemTypeUnresolved }));

/* ---- F9/C6 origin: a base field the client only MOVES stays templateOwned (insert origin = seed),
   so it is NOT re-emitted as client payload — the client only repositioned template content. ---- */
const mvSeed = makeSchema("Tpl", { diff: [{ operation: "insert", name: "BF", parentName: "Header", propertyName: "items", bindTo: "BCol" }] });
const mvClient = makeSchema("Client", { entity: "X", diff: [{ operation: "move", name: "BF", parentName: "MyTab" }] });
const mvEff = mergeHierarchy([mvClient], { seedTemplate: [mvSeed] });
check("F9/C6: a base field the client only MOVED stays templateOwned (origin=seed insert)",
  mvEff.fields.find(f => f.bindTo === "BCol")?.templateOwned === true);

/* ---- ViewItemType seed: symbolic itemType resolves (E1-class fix, now for layout containers) ---- */
const vitBody = `define("T",[],function(){return{entitySchemaName:"X",diff:[` +
  `{operation:"insert",name:"G",values:{itemType:Terrasoft.controls.ViewItemType.CONTROL_GROUP}},` +
  `{operation:"insert",name:"GL",values:{itemType:Terrasoft.core.enums.ViewItemType.GRID_LAYOUT}}]};});`;
const vit = parseSchema(vitBody, "T");
check("ViewItemType: symbolic CONTROL_GROUP -> 15 (not null)", vit.diff.find(d => d.name === "G")?.itemType === 15);
check("ViewItemType: symbolic GRID_LAYOUT (core.enums path) -> 0", vit.diff.find(d => d.name === "GL")?.itemType === 0);
check("ViewItemType: no parse error from the Terrasoft stub", !vit.error);

/* ---- move-after-remove RESURRECTS (classic reposition idiom) — a displayed field must not vanish
   (real bug: Product IsArchive/"Inactive" was insert→…→remove→move and silently dropped) ---- */
const rez = mergeHierarchy([
  synth("base", [{ operation: "insert", name: "Fld", parentName: "Header", propertyName: "items", bindTo: "Col" }]),
  synth("top", [{ operation: "remove", name: "Fld" }, { operation: "move", name: "Fld", parentName: "Header" }]),
]);
check("move-after-remove resurrects the item (alive, not tombstoned)",
  rez.fields.some(f => f.bindTo === "Col") && !rez.removed.some(r => r.name === "Fld"));

/* ---- tooltip captured from the classic body (tip.content.bindTo) ---- */
const tipBody = `define("T",[],function(){return{entitySchemaName:"X",diff:[{operation:"insert",name:"Code",` +
  `values:{bindTo:"Code",tip:{content:{bindTo:"Resources.Strings.CodeTip"}}}}]};});`;
const tl = parseSchema(tipBody, "T");
check("tooltip captured from classic tip.content.bindTo",
  tl.diff.find(d => d.name === "Code")?.tip === "Resources.Strings.CodeTip");

/* ---- feature toggles detected from the body (getIsFeatureEnabled) + static visible captured ---- */
const featBody = `define("T",[],function(){ if(this.getIsFeatureEnabled("UseNewProductCatalogue")){} return{entitySchemaName:"X",` +
  `diff:[{operation:"insert",name:"F",values:{bindTo:"F",visible:false}}]};});`;
const fl = parseSchema(featBody, "T");
check("feature toggle name captured from body", (fl.features || []).includes("UseNewProductCatalogue"));
check("static visible:false captured on the item", fl.diff.find(d => d.name === "F")?.visible === false);
const fe = mergeHierarchy([fl]);
check("mergeHierarchy aggregates features", (fe.features || []).includes("UseNewProductCatalogue"));

/* ---- card-action hints (getActions navigate/goTo methods) + caption key captured from the body ---- */
const actBody = `define("T",[],function(){ this.getActions=function(){ this.navigateToTaxesByCountriesLookup(); var a={"Tag":"runEscalation"}; }; return{entitySchemaName:"X",` +
  `diff:[{operation:"insert",name:"MyTab",values:{caption:{bindTo:"Resources.Strings.MyTabCaption"},"Tag":"strayNotAnAction"}}]};});`;
const al = parseSchema(actBody, "T");
check("card-action hints captured (navigateTo… + action Tag from the getActions body)",
  (al.actionHints || []).includes("navigateToTaxesByCountriesLookup") && (al.actionHints || []).includes("runEscalation"));
check("card-action scan scoped to getActions — a `Tag` elsewhere in the body is NOT captured (no noise)",
  !(al.actionHints || []).includes("strayNotAnAction"));
check("caption resource key captured from the body", al.diff.find(d => d.name === "MyTab")?.caption === "Resources.Strings.MyTabCaption");

/* ---- Fix 1: classic `hint` (field tooltip, a DIFFERENT property from `tip`) captured + carried ---- */
const hintBody = `define("T",["FormatUtils","CasesEstimateLabel","css!CasesEstimateLabel","BusinessRuleModule","SlaGeneratorUtils","OrderTimeline"],function(){ return{entitySchemaName:"X",` +
  `diff:[{operation:"insert",name:"F",values:{bindTo:"Col",hint:{bindTo:"Resources.Strings.FHint"}}}]};});`;
const hl = parseSchema(hintBody, "T");
check("classic `hint` captured on the diff item", hl.diff.find(d => d.name === "F")?.hint === "Resources.Strings.FHint");
const he = mergeHierarchy([hl]);
check("merge carries `hint` onto the field", he.fields.find(f => f.bindTo === "Col")?.hint === "Resources.Strings.FHint");

/* ---- Fix 3: referenced UI modules from define() deps — css-backed / UI-named (anchored) only ---- */
check("refModules captures the css-backed UI module", (hl.refModules || []).includes("CasesEstimateLabel"));
check("refModules EXCLUDES framework utils (FormatUtils, BusinessRuleModule)",
  !(hl.refModules || []).includes("FormatUtils") && !(hl.refModules || []).includes("BusinessRuleModule"));
check("refModules: UI token NOT at the end (SlaGeneratorUtils) is excluded — anchored match, E1 no-noise",
  !(hl.refModules || []).includes("SlaGeneratorUtils"));
check("refModules: a true role-suffix name (OrderTimeline) is captured even without css backing",
  (hl.refModules || []).includes("OrderTimeline"));
check("mergeHierarchy aggregates referencedModules", (he.referencedModules || []).includes("CasesEstimateLabel"));

/* ---- SECURITY (RCE fix): the parser reads the body as an AST — it must NEVER execute it. ---- */
delete globalThis.__ENGINE_TEST_PWNED; delete globalThis.__ENGINE_TEST_PWNED2;
const evilSrc = [
  'define("Evil", ["BusinessRuleModule"], function(BusinessRuleModule) {',
  '  globalThis.__ENGINE_TEST_PWNED = true;                                   // would run under vm — must NOT',
  '  (function(){}).constructor("globalThis.__ENGINE_TEST_PWNED2 = true")();  // classic vm-escape shape',
  '  return { entitySchemaName: "Evil", diff: [',
  '    { operation: "insert", name: "F1", values: { bindTo: "Amount", itemType: Terrasoft.ViewItemType.GRID_LAYOUT } } ] };',
  '});',
].join("\n");
const evil = parseSchema(evilSrc, "Evil");
console.log("\n===== SECURITY: schema body is parsed, never executed =====");
check("factory body did NOT execute (RCE markers unset)", globalThis.__ENGINE_TEST_PWNED === undefined && globalThis.__ENGINE_TEST_PWNED2 === undefined);
check("return object still extracted (entity = Evil)", evil.entitySchemaName === "Evil");
check("diff field extracted without executing (Amount)", evil.diff.length === 1 && evil.diff[0].bindTo === "Amount");
check("enum resolved statically (itemType GRID_LAYOUT = 0)", evil.diff[0].itemType === 0);

/* ---- enum idioms: `this.Terrasoft.*` AND the `terrasoft` define-param resolve like the bare global ---- */
// The real ViewModel bodies ALWAYS receive Terrasoft as a define() param and reference enums via BOTH `this.Terrasoft.…`
// and the bare param — treating the param as an opaque proxy dropped every enum access, silently degrading a
// captioned group (CONTROL_GROUP=15) to a plain container. Pin both forms + the ContentType.LOOKUP(5) path.
console.log("\n===== enum idioms: this.Terrasoft / terrasoft-param / ContentType =====");
const enumSrc = [
  'define("Enum", ["terrasoft"], function(Terrasoft) {',
  '  return { entitySchemaName: "Enum", diff: [',
  '    { operation: "insert", name: "gThis", values: { itemType: this.Terrasoft.ViewItemType.CONTROL_GROUP } },',
  '    { operation: "insert", name: "gParam", values: { itemType: Terrasoft.ViewItemType.CONTROL_GROUP } },',
  '    { operation: "insert", name: "gGrid", values: { itemType: this.Terrasoft.ViewItemType.GRID_LAYOUT } },',
  '    { operation: "insert", name: "fLookThis", values: { bindTo: "Acc", contentType: this.Terrasoft.ContentType.LOOKUP } },',
  '    { operation: "insert", name: "fLookParam", values: { bindTo: "Own", contentType: Terrasoft.ContentType.LOOKUP } },',
  '    { operation: "insert", name: "fEnum", values: { bindTo: "St", contentType: this.Terrasoft.ContentType.ENUM } } ] };',
  '});',
].join("\n");
const en = parseSchema(enumSrc, "Enum");
const byName = Object.fromEntries(en.diff.map((d) => [d.name, d]));
check("this.Terrasoft.ViewItemType.CONTROL_GROUP resolves to 15 (was null → degraded to plain container)", byName.gThis.itemType === 15);
check("bare terrasoft-param Terrasoft.ViewItemType.CONTROL_GROUP resolves to 15 (param is not an opaque proxy)", byName.gParam.itemType === 15);
check("this.Terrasoft.ViewItemType.GRID_LAYOUT resolves to 0", byName.gGrid.itemType === 0);
check("this.Terrasoft.ContentType.LOOKUP resolves to 5 (lookup control hint)", byName.fLookThis.contentType === 5);
check("bare terrasoft-param Terrasoft.ContentType.LOOKUP resolves to 5", byName.fLookParam.contentType === 5);
// ContentType is pinned COMPLETE: a member the schema names is IDENTIFIED, never collapsed to null —
// "we could not read it" and "the page did not set one" are different statements and the gate reacts to them
// differently. The old contract left every non-LOOKUP member null to guarantee none could mis-equal LOOKUP=5;
// that guarantee is now a property of the transcribed values themselves, which is what the second check pins.
check("ContentType.ENUM resolves to 3 (pinned complete — an identified member, not a silent null)", byName.fEnum.contentType === 3,
  () => `got ${byName.fEnum.contentType}`);
check("no pinned ContentType member other than LOOKUP equals 5 (a resolved hint cannot mis-flag a scalar as a lookup)",
  Object.entries(CONTENT_TYPE).filter(([, v]) => v === 5).map(([k]) => k).join(",") === "LOOKUP",
  () => `members equal to 5: ${Object.entries(CONTENT_TYPE).filter(([, v]) => v === 5).map(([k]) => k).join(",")}`);

/* ---- T1: every AST-evaluator branch has a golden — this is the security-critical component that replaced the
   vm, and none of Unary/Binary/Conditional/Template/Spread/computed-key/New was pinned. A refactor could silently
   break ternary/spread resolution (exactly what let the E1 spread bug ship). ---- */
console.log("\n===== AST evaluator: value branches + fail-loud diagnostics =====");
const evalSrc = [
  'define("Ev", [], function() { return { entitySchemaName: "Ev", diff: [',
  '  { operation:"insert", name:"n1", values:{ bindTo:"b1", order: 2 + 3 } },',        // BinaryExpression (static)
  '  { operation:"insert", name:"n2", values:{ bindTo:"b2", order: -7 } },',           // UnaryExpression
  '  { operation:"insert", name:"n3", values:{ bindTo:"b3", itemType: true ? 15 : 0 } },', // ConditionalExpression (static)
  '  { operation:"insert", name:"n4", values:{ bindTo:"b4", caption: `Cap` } },',      // TemplateLiteral (no expression)
  '  { operation:"insert", name:"n5", values:{ bindTo:"b5", order: dyn + 1 } },',      // dynamic Binary -> flag
  '  { operation:"insert", name:"n6", values:{ bindTo:"b6", itemType: cond ? 1 : 2 } },', // dynamic Conditional -> flag
  '  { operation:"insert", name:"n7", values:{ bindTo:"b7", caption: `x${y}` } },',    // dynamic Template -> flag
  '  { operation:"insert", name:"n8", values:{ bindTo:"b8", generator: new Foo() } },',// NewExpression -> flag
  '  { operation:"insert", name:"n9", values:{ bindTo:"b9", ["dyn"+"K"]: 1 } },',      // computed-key -> flag
  '  { operation:"insert", name:"nA", values:{ bindTo:"bA", ...spreadMe } }',          // spread-in-object -> flag
  '] }; });',
].join("\n");
const ev = parseSchema(evalSrc, "Ev");
const bn = Object.fromEntries(ev.diff.map(d => [d.name, d]));
const kinds = new Set(ev.astDiagnostics.map(d => d.kind));
check("evaluator BinaryExpression (static): order 2+3 -> 5", bn.n1?.order === 5);
check("evaluator UnaryExpression: order -7", bn.n2?.order === -7);
check("evaluator ConditionalExpression (static): itemType true?15:0 -> 15", bn.n3?.itemType === 15);
check("evaluator TemplateLiteral (no expr): caption `Cap` -> 'Cap'", bn.n4?.caption === "Cap");
check("evaluator dynamic Binary -> flagged + null", kinds.has("dynamic-binary") && bn.n5?.order === null);
check("evaluator dynamic Conditional -> flagged + null", kinds.has("dynamic-conditional") && bn.n6?.itemType === null);
check("evaluator dynamic Template -> flagged + null", kinds.has("dynamic-template") && bn.n7?.caption === null);
check("evaluator NewExpression -> flagged + null", kinds.has("dynamic-new") && bn.n8?.generator === null);
check("evaluator computed-key -> flagged (property skipped, op survives)", kinds.has("computed-key") && !!bn.n9);
check("evaluator spread-in-object -> flagged (op survives)", kinds.has("spread-in-object") && !!bn.nA);

/* ---- E1: a null element in an array (spread residue / sparse hole) must NOT crash — it flags + drops the slot,
   and it never throws out of parseSchema/mergeHierarchy (the documented pure contract). ---- */
console.log("\n===== E1: null array elements don't crash (spread / sparse / conditions) =====");
const spreadArr = 'define("S1",[],function(){var base=[{operation:"insert",name:"z",values:{bindTo:"z"}}];return{entitySchemaName:"S1",diff:[...base,{operation:"insert",name:"keep",values:{bindTo:"keep"}}]};});';
const sp = parseSchema(spreadArr, "S1");
check("E1: diff spread -> flagged (spread-in-array), no crash, survivor kept",
  sp.error === null && sp.astDiagnostics.some(d => d.kind === "spread-in-array") && sp.diff.length === 1 && sp.diff[0].name === "keep");
const sparseArr = 'define("S2",[],function(){return{entitySchemaName:"S2",diff:[,{operation:"insert",name:"keep",values:{bindTo:"keep"}}]};});';
const sh = parseSchema(sparseArr, "S2");
check("E1: diff sparse hole -> flagged (sparse-hole), no crash, survivor kept",
  sh.error === null && sh.astDiagnostics.some(d => d.kind === "sparse-hole") && sh.diff.length === 1 && sh.diff[0].name === "keep");
const condNull = parseSchema('define("C",["BusinessRuleModule"],function(BusinessRuleModule){return{entitySchemaName:"C",diff:[{operation:"insert",name:"F",values:{bindTo:"F"}}],rules:{F:{R:{ruleType:0,property:1,conditions:[,{leftExpression:{}}]}}}};});', "C");
check("E1: a null rule-condition does NOT throw out of mergeHierarchy (pure contract preserved)",
  (() => { try { mergeHierarchy([condNull]); return true; } catch { return false; } })());

/* ---- E2: a member access on a LOCAL object/array alias at a structural key resolves to null but is FLAGGED
   (fail-loud) instead of silently producing an empty page that passes the gate green. ---- */
const e2p = parseSchema('define("E2",[],function(){var cfg={items:[{operation:"insert",name:"a",values:{bindTo:"a"}}]};return{entitySchemaName:"E2",diff:cfg.items};});', "E2");
check("E2: member access on a local-object alias is FLAGGED (member-on-local-object), not silent null",
  e2p.astDiagnostics.some(d => d.kind === "member-on-local-object") && e2p.diff.length === 0);

/* ---- extractFnBody: a brace inside a string/comment must not truncate the method scan ---- */
console.log("\n===== extractFnBody string safety + move-order fidelity =====");
const braceBody = 'define("X", [], function() { return { entitySchemaName: "X", diff: [], getActions: function() { var s = "a } b { c"; return [ { "Tag": "runEscalation", "Click": "navigateToEscalation" } ]; } }; });';
const braceRes = parseSchema(braceBody, "X");
check("extractFnBody: a `{`/`}` inside a string does not truncate the getActions scan",
  braceRes.actionHints.includes("runEscalation") && braceRes.actionHints.includes("navigateToEscalation"));

/* ---- move op must apply the new order/index, not just the parent ---- */
const mvBase = parseSchema('define("Base", [], function() { return { entitySchemaName: "E", diff: [ { operation: "insert", name: "A", parentName: "P", index: 0, values: { bindTo: "A" } }, { operation: "insert", name: "B", parentName: "P", index: 1, values: { bindTo: "B" } } ] }; });', "Base");
const mvTop = parseSchema('define("Top", [], function() { return { entitySchemaName: "E", diff: [ { operation: "move", name: "A", parentName: "P", index: 9 } ] }; });', "Top");
const mvA = mergeHierarchy([mvBase, mvTop]).items.find((i) => i.name === "A");
check("move op applies the new order/index (A repositioned to 9, not stuck at 0)", !!mvA && mvA.order === 9);


/* ================= severity axis on eff.warnings + `labelConfig`/handler modelling =================
   The defect: the correctness gate blocked on ANY non-empty `eff.warnings`, including one whose own text says
   "The element is KEPT (correct)". Warnings now carry `severity`, and the two families are asserted per producer —
   a new producer that forgets to declare one is caught by the "every warning has a severity" check below. */
console.log("\n===== warning severity + labelConfig =====");

const bodyOf = (pkg, diff, extra = "") =>
  `define("${pkg}",[],function(){return{entitySchemaName:"E",diff:${JSON.stringify(diff)}${extra}};});`;
const ps = (pkg, diff, extra) => parseSchema(bodyOf(pkg, diff, extra), pkg);

// The exact Classic construct from the ticket: base seeds the lookup, a middle layer gives it a CUSTOM LABEL via
// `labelConfig`, the top layer removes that label so the caption falls back to the column's own title.
const lcBase = ps("Base", [{ operation: "insert", name: "Requester", parentName: "Profile", propertyName: "items", values: { bindTo: "Requester", itemType: 4 } }]);
const lcMid = ps("WorkInternalRequest", [{ operation: "merge", name: "Requester", values: { labelConfig: { caption: { bindTo: "Resources.Strings.RequesterLabel" } } } }]);
const lcTop = ps("WorkInternalProcess", [{ operation: "remove", name: "Requester", properties: ["labelConfig"] }]);

const lcMidOnly = mergeHierarchy([lcBase, lcMid]);
const lcMidItem = lcMidOnly.items.find((i) => i.name === "Requester");
check("a `labelConfig.caption` layer supplies the item's caption (platform precedence: config.caption → labelConfig.caption → column)",
  !!lcMidItem && lcMidItem.caption === "Resources.Strings.RequesterLabel" && lcMidItem.labelCaption === "Resources.Strings.RequesterLabel",
  () => lcMidItem);

const lcFull = mergeHierarchy([lcBase, lcMid, lcTop]);
const lcItem = lcFull.items.find((i) => i.name === "Requester");
check("`remove properties:['labelConfig']` CLEARS the custom label (caption falls back to the column's own title) and the element is kept",
  !!lcItem && lcItem.caption === null && lcItem.labelCaption === null && !lcFull.removed.some((r) => r.name === "Requester"),
  () => ({ item: lcItem, removed: lcFull.removed.map((r) => r.name) }));
check("that op raises NO warning at all — the key is modelled now, so there is nothing to demote",
  lcFull.warnings.length === 0, () => lcFull.warnings);

// The OVER-CLEARING case: a layer that states BOTH must keep `config.caption` when only `labelConfig` is removed.
const lcBoth = ps("Both", [{ operation: "merge", name: "Requester", values: { caption: { bindTo: "Resources.Strings.OwnCaption" }, labelConfig: { caption: { bindTo: "Resources.Strings.RequesterLabel" } } } }]);
const lcBothItem = mergeHierarchy([lcBase, lcBoth, lcTop]).items.find((i) => i.name === "Requester");
check("removing `labelConfig` does NOT over-clear — a `caption` stated on the control itself survives",
  !!lcBothItem && lcBothItem.caption === "Resources.Strings.OwnCaption" && lcBothItem.labelCaption === null,
  () => lcBothItem);

// HANDLER family — the second gap the key audit found. `click` lives in the `handlers` map, not as a field.
const hBase = ps("HBase", [{ operation: "insert", name: "Btn", parentName: "Header", propertyName: "items", values: { itemType: 5, click: { bindTo: "onBtnClick" }, visible: false } }]);
const hTop = ps("HTop", [{ operation: "remove", name: "Btn", properties: ["click"] }]);
const hItem = mergeHierarchy([hBase, hTop]).items.find((i) => i.name === "Btn");
check("key audit: `remove properties:['click']` clears the handler binding and raises no warning",
  !!hItem && !hItem.handlers.click && mergeHierarchy([hBase, hTop]).warnings.length === 0,
  () => hItem);
// `visible` is in BOTH vocabularies: a removal must clear the static value AND the dynamic trigger, not one of them.
const hVis = ps("HVis", [{ operation: "remove", name: "Btn", properties: ["visible"] }]);
const hVisBase = ps("HVisBase", [{ operation: "insert", name: "Btn", parentName: "Header", propertyName: "items", values: { itemType: 5, visible: { bindTo: "isBtnVisible" } } }]);
const hVisItem = mergeHierarchy([hVisBase, hVis]).items.find((i) => i.name === "Btn");
check("key audit: `visible` is in BOTH vocabularies — removing it clears the field AND the handler entry, never half of it",
  !!hVisItem && hVisItem.visible === null && !hVisItem.handlers.visible, () => hVisItem);

// The four AMBIGUOUS keys (`enabled`, `visible`, `readonly`, `required`) appear in a classic body both as a handler
// (`{bindTo:"m"}`, modelled in `handlers`) and as a static literal (`enabled: false`, which `handlerBindings` skips
// and no field holds). Removing the modelled form is fully represented; removing the static form changes nothing,
// and a silent no-op there is the drop this whole function exists to prevent. So each of the three that has NO
// second slot must warn on the literal and stay quiet on the handler — `visible` is asserted above, it has one.
for (const key of ["enabled", "readonly", "required"]) {
  const litBase = ps("LitB", [{ operation: "insert", name: "F", parentName: "Header", propertyName: "items", values: { bindTo: "F", [key]: false } }]);
  const litTop = ps("LitT", [{ operation: "remove", name: "F", properties: [key] }]);
  const lit = mergeHierarchy([litBase, litTop]);
  check(`key audit: a STATIC \`${key}: false\` removal is an unmodelled effect — it warns (fidelity) instead of silently doing nothing`,
    lit.warnings.length === 1 && lit.warnings[0].severity === "fidelity" && new RegExp(key).test(lit.warnings[0].hint),
    () => lit.warnings);
  const dynBase = ps("DynB", [{ operation: "insert", name: "F", parentName: "Header", propertyName: "items", values: { bindTo: "F", [key]: { bindTo: "m" } } }]);
  const dyn = mergeHierarchy([dynBase, litTop]);
  const dynItem = dyn.items.find((i) => i.name === "F");
  check(`key audit: the HANDLER form of \`${key}\` is modelled, so removing it clears the map entry and raises nothing`,
    dyn.warnings.length === 0 && !!dynItem && !dynItem.handlers?.[key],
    () => ({ warnings: dyn.warnings, handlers: dynItem?.handlers }));
}

// A genuinely unmodelled key stays a warning — but a FIDELITY one, which does not block.
const unBase = ps("UBase", [{ operation: "insert", name: "F", parentName: "Header", propertyName: "items", values: { bindTo: "F" } }]);
const unTop = ps("UTop", [{ operation: "remove", name: "F", properties: ["wrapClass"] }]);
const unRun = mergeHierarchy([unBase, unTop]);
check("a still-unmodelled remove key is a FIDELITY warning (advisory), not a correctness one",
  unRun.warnings.length === 1 && unRun.warnings[0].severity === "fidelity" && /KEPT \(correct\)/.test(unRun.warnings[0].hint),
  () => unRun.warnings);

// The CORRECTNESS half — each of the five producers, asserted by severity rather than by trust.
const ghostMerge = mergeHierarchy([ps("G", [{ operation: "merge", name: "Ghost", values: { caption: "x" } }])]);
const ghostMove = mergeHierarchy([ps("G", [{ operation: "move", name: "Ghost", parentName: "Header" }])]);
const ghostRemove = mergeHierarchy([ps("G", [{ operation: "remove", name: "Ghost" }])]);
const ghostSet = mergeHierarchy([ps("G", [{ operation: "set", name: "Ghost", values: { bindTo: "Ghost" } }])]);
check("merge/move/set onto an item no lower schema defined are all CORRECTNESS warnings (the gate must still block)",
  [ghostMerge, ghostMove, ghostSet].every((r) => r.warnings.length === 1 && r.warnings[0].severity === "correctness"),
  () => [ghostMerge, ghostMove, ghostSet].map((r) => r.warnings.map((w) => w.severity)));
// ENG-100314 — `remove` left that list: a remove of a name nothing in the fold ever defines has no effect in Classic,
// so it is a FIDELITY note. (A remove whose name a later layer DOES define stays correctness — asserted above.)
check("ENG-100314: remove onto a name NOTHING in the fold defines is a FIDELITY warning (no effect in Classic), not a block",
  ghostRemove.warnings.length === 1 && ghostRemove.warnings[0].severity === "fidelity", () => ghostRemove.warnings);

// `set` REPLACING a real element is a fidelity note: the engine's reading is right, the wholesale replacement is
// what the reader must be told about.
const g862SetBase = ps("SBase", [{ operation: "insert", name: "Grp", parentName: "Header", propertyName: "items", values: { itemType: 15 } }]);
const g862SetTop = ps("STop", [{ operation: "set", name: "Grp", values: { itemType: 15 } }]);
const g862SetRun = mergeHierarchy([g862SetBase, g862SetTop]);
check("`set` replacing an EXISTING element is a FIDELITY note (the mapping is right; the wholesale replacement is the fact to report)",
  g862SetRun.warnings.length === 1 && g862SetRun.warnings[0].severity === "fidelity", () => g862SetRun.warnings);

// The structural guarantee: no producer may ship without declaring a severity, and none may invent a third value.
const everyWarning = [lcFull, unRun, ghostMerge, ghostMove, ghostRemove, ghostSet, g862SetRun].flatMap((r) => r.warnings);
check("EVERY warning declares a severity, and only the two legal values exist",
  everyWarning.length > 0 && everyWarning.every((w) => w.severity === "correctness" || w.severity === "fidelity"),
  () => everyWarning.map((w) => ({ op: w.op, name: w.name, severity: w.severity })));
check("every warning also carries a `hint` — the gate quotes it, so a producer that names its text differently renders as `undefined`",
  everyWarning.every((w) => typeof w.hint === "string" && w.hint.length > 0),
  () => everyWarning.map((w) => ({ op: w.op, name: w.name, hint: w.hint })));

/* --- `unmodelledProps` — the declared `values` keys the engine models on no field, so a section's
   `merge DataGrid` (`controlColumnName` and its family) can be NAMED instead of vanishing at parse time. --- */
const upMk = (pkg, diff) => parseSchema(`define("S",[],function(){return{entitySchemaName:"X",diff:${diff}};});`, pkg);
const upEff = mergeHierarchy([
  upMk("CoreLead", `[{"operation":"merge","name":"DataGrid","values":{"controlColumnName":"QualifyStatus","controlCellClass":"c","caption":"x"}}]`),
], { seedTemplate: [upMk("Base", `[{"operation":"insert","name":"DataGrid","values":{"itemType":13,"collection":"GridData"}}]`)] });
const upGrid = upEff.items.find((i) => i.name === "DataGrid");
check("an unmodelled `values` key survives the fold as a NAMED key instead of being dropped by the parser's fixed field set",
  upGrid.unmodelledProps.includes("controlColumnName") && upGrid.unmodelledProps.includes("controlCellClass"),
  () => upGrid.unmodelledProps);
check("a key the engine DOES model (`caption`) is not reported as unmodelled — the set is the difference, not every key",
  !upGrid.unmodelledProps.includes("caption"), () => upGrid.unmodelledProps);
check("a SEED layer's keys are excluded — measured on the real LeadSectionV2 bundle, counting them put 30 keys on the grid where only 3 came from the section, and 30 open items would bury the 3",
  !upGrid.unmodelledProps.includes("collection"), () => upGrid.unmodelledProps);
// A `remove` of an item nothing defined records a TOMBSTONE, and classic's remove-then-restate idiom then merges
// onto that same name. The tombstone is built from its own object literal, not by `makeItem`, so it needs the
// field too — without it this fold throws `cur.unmodelledProps.add is not a function` on a real body.
check("a merge onto a TOMBSTONE does not throw — every item record in the fold carries the same shape, stub or not",
  () => { const eff = mergeHierarchy([
      upMk("A", `[{"operation":"remove","name":"Ghost"}]`),
      upMk("B", `[{"operation":"merge","name":"Ghost","values":{"controlColumnName":"Q"}}]`)]);
    return Array.isArray(eff.items); },
  () => "threw");

console.log(`\n=================\nGOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

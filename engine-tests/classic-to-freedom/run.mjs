// Golden test runner for the merge engine.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchema, mergeHierarchy, CONTENT_TYPE, enumDriftIssues } from "../../skills/classic-to-freedom-migration/engine/engine.mjs";
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
check("F2: Contract Header/Tabs resolved by seed (no longer unresolved)",
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

const removedGhost = mergeHierarchy([synth("T", [{ operation: "remove", name: "Zombie" }])]);
check("F1: remove-onto-absent becomes a tombstone in removed[]", removedGhost.removed.some(r => r.name === "Zombie"));
check("F1: remove-onto-absent raises a 'remove' warning", removedGhost.warnings.some(w => w.op === "remove" && w.name === "Zombie"));

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
// heavily-layered page's base remove+re-layout no longer FALSE-blocks on unresolvedParents; but a CLIENT-authored
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
// review (PR#58 round 4 #4): the sweep must propagate DEEP, not one level — a GRANDCHILD of a removed container is
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

/* ---- ENG-95412: `set` and `remove`-with-`properties`, the two operations the engine did not implement ----
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

/* ---- PR #105 review, Major: `set` must not hide CLIENT-authored children ----
   `cascadeRemove` deliberately skips non-templateOwned items (its `!it.templateOwned` guard) so client-authored
   removals surface individually, and `removed[]` filters out anything carrying `cascadeRemoved`. `replaySet` set that
   flag on EVERY direct child, so a client element inside a replaced container vanished from the decision rows with no
   per-element diagnostic — the op's warning counts dropped children but a count is not an element. Mixed ownership is
   the only shape that discriminates, which is exactly the test the reviewer asked for. */
const setMixedSeed = parseSchema(realBody([
  `{operation:"insert",name:"Box",parentName:"Header",propertyName:"items",values:{itemType:7}}`,
  `{operation:"insert",name:"TplKid",parentName:"Box",propertyName:"items",values:{bindTo:"Name"}}`].join(",")), "Tpl");
const setMixedClient = parseSchema(realBody([
  `{operation:"insert",name:"CliKid",parentName:"Box",propertyName:"items",values:{bindTo:"Other"}}`,
  `{operation:"set",name:"Box",values:{itemType:7}}`].join(",")), "Client");
const setMixed = mergeHierarchy([setMixedClient], { seedTemplate: [setMixedSeed] });
const setMixedRemoved = setMixed.removed.map((r) => r.name).sort((a, b) => a.localeCompare(b));
check("PR#105 Major: a `set` that drops a mixed-ownership child set keeps the CLIENT-authored child in removed[] as its own decision row, while the template-owned one is swept as structural cleanup",
  setMixedRemoved.join(",") === "CliKid" && !setMixed.items.some((i) => ["TplKid", "CliKid"].includes(i.name)),
  () => ({ removed: setMixedRemoved, items: setMixed.items.map((i) => i.name) }));

/* ---- ENG-95412: aliases ----
   `saveAlias` (json-applier.js L554-566) keys the table by the ALIAS name and stores the REAL item name on it, which
   is what lets a later op target the element by the alias. It also carries `excludeOperations` (a whole op on that
   name becomes a no-op, L601-608) and `excludeProperties` (individual merge keys never apply, L583-591). The table
   survives every layer — `applyDiff` resets it only on an empty source object, i.e. once.
   HONEST LIMIT: no `alias` appears anywhere in the harvested corpus, so all of this is synthetic. */
const aliasResolved = realRun2(
  `{operation:"insert",name:"RealFld",parentName:"Header",propertyName:"items",values:{bindTo:"Name",caption:"Resources.Strings.Orig"},alias:{name:"OldFld"}}`,
  `{operation:"merge",name:"OldFld",values:{caption:"Resources.Strings.ViaAlias"}}`);
check("ENG-95412: a later op targeting the ALIAS name reaches the real element — the table is keyed by the alias and carries the real name, so `OldFld` resolves to `RealFld`",
  aliasResolved.items.find((i) => i.name === "RealFld")?.caption === "Resources.Strings.ViaAlias"
  && !aliasResolved.items.some((i) => i.name === "OldFld"),
  () => aliasResolved.items.map((i) => `${i.name}:${i.caption}`));
// Control: WITHOUT the alias the same merge finds nothing and produces the engine-only stub instead. Without this,
// "resolution works" could be satisfied by resolving every unknown name to something.
const aliasAbsent = realRun2(
  `{operation:"insert",name:"RealFld",parentName:"Header",propertyName:"items",values:{bindTo:"Name",caption:"Resources.Strings.Orig"}}`,
  `{operation:"merge",name:"OldFld",values:{caption:"Resources.Strings.ViaAlias"}}`);
check("ENG-95412: with NO alias registered the same merge does NOT reach the element — it falls through to the engine-only stub, so resolution is driven by the table and not by name guessing",
  aliasAbsent.items.find((i) => i.name === "RealFld")?.caption === "Resources.Strings.Orig"
  && aliasAbsent.items.find((i) => i.name === "OldFld")?.engineOnlyStub === true,
  () => aliasAbsent.items.map((i) => `${i.name}:${i.caption}:stub=${i.engineOnlyStub}`));
const aliasExclOp = realRun2(
  `{operation:"insert",name:"RealFld",parentName:"Header",propertyName:"items",values:{bindTo:"Name"},alias:{name:"OldFld",excludeOperations:["remove"]}}`,
  `{operation:"remove",name:"OldFld"}`);
check("ENG-95412: an alias `excludeOperations` entry makes that operation a no-op — the remove never runs and the element is not tombstoned",
  aliasExclOp.items.some((i) => i.name === "RealFld") && !aliasExclOp.removed.some((r) => r.name === "RealFld"),
  () => ({ items: aliasExclOp.items.map((i) => i.name), removed: aliasExclOp.removed.map((r) => r.name) }));
// The runtime's carve-out: a `remove` carrying `properties` is a DIFFERENT operation and is never excluded.
const aliasExclCarveOut = realRun2(
  `{operation:"insert",name:"RealFld",parentName:"Header",propertyName:"items",values:{bindTo:"Name",caption:"Resources.Strings.Cap"},alias:{name:"OldFld",excludeOperations:["remove"]}}`,
  `{operation:"remove",name:"OldFld",properties:["caption"]}`);
check("ENG-95412: `excludeOperations:['remove']` does NOT block a `remove` carrying `properties` — the runtime carves that out explicitly, because the two forms are different operations",
  aliasExclCarveOut.items.find((i) => i.name === "RealFld")?.caption === null,
  () => aliasExclCarveOut.items.find((i) => i.name === "RealFld"));
const aliasExclProp = realRun2(
  `{operation:"insert",name:"RealFld",parentName:"Header",propertyName:"items",values:{bindTo:"Name",caption:"Resources.Strings.Keep"},alias:{name:"OldFld",excludeProperties:["caption"]}}`,
  `{operation:"merge",name:"OldFld",values:{caption:"Resources.Strings.Blocked",tip:{content:{bindTo:"Resources.Strings.T"}}}}`);
const aep = aliasExclProp.items.find((i) => i.name === "RealFld");
check("ENG-95412: an alias `excludeProperties` entry drops just that key from the merge — the caption is held back while a non-excluded property on the same op still applies (both arms, or 'excluded' could mean 'merge does nothing')",
  aep?.caption === "Resources.Strings.Keep" && aep?.tip === "Resources.Strings.T",
  () => aep);

/* ---- ENG-95412: a layer's diff runs in the runtime's BUCKET order, not in array order ----
   `applyOperations` (json-applier.js L299-306): all `merge`, then the position group, then remove-properties, then
   `set`. Pinned in both directions, because "the merge did nothing" is also what a broken merge looks like.
   HONEST LIMIT: no layer in the harvested corpus (130 schema bodies, 5 real pages) contains an `insert X` + `merge X`
   pair, so this behaviour is synthetic — validated against json-applier.js, not observed on a page. */
const sameLayerMerge = realRun(
  `{operation:"insert",name:"Fld",parentName:"Header",propertyName:"items",values:{bindTo:"Name",caption:"Resources.Strings.Ins"}}`,
  `{operation:"merge",name:"Fld",values:{caption:"Resources.Strings.Merged"}}`);
check("ENG-95412: within ONE layer a `merge` runs BEFORE the `insert` that defines its target, so the merge is a NO-OP — replaying in array order applied it and reported a caption the page does not have",
  sameLayerMerge.items.find((i) => i.name === "Fld")?.caption === "Resources.Strings.Ins",
  () => sameLayerMerge.items.find((i) => i.name === "Fld"));
const crossLayerMerge = realRun2(
  `{operation:"insert",name:"Fld",parentName:"Header",propertyName:"items",values:{bindTo:"Name",caption:"Resources.Strings.Ins"}}`,
  `{operation:"merge",name:"Fld",values:{caption:"Resources.Strings.Merged"}}`);
check("ENG-95412: the SAME pair across two layers DOES apply — bucket ordering is per layer, so this proves merges still work rather than having been switched off",
  crossLayerMerge.items.find((i) => i.name === "Fld")?.caption === "Resources.Strings.Merged",
  () => crossLayerMerge.items.find((i) => i.name === "Fld"));
// `set` is the LAST bucket, so its array position is irrelevant: written first, it still lands after the merge.
const setLastRun = realRun2(
  `{operation:"insert",name:"Box",parentName:"Header",propertyName:"items",values:{itemType:7,caption:"Resources.Strings.BoxCap"}}`,
  [`{operation:"set",name:"Box",values:{itemType:7}}`,
   `{operation:"merge",name:"Box",values:{caption:"Resources.Strings.Merged"}}`].join(","));
check("ENG-95412: `set` is the LAST bucket — written BEFORE the merge in the array it still runs after it, so the merge's caption is wiped by the wholesale replace",
  setLastRun.items.find((i) => i.name === "Box")?.caption === null,
  () => setLastRun.items.find((i) => i.name === "Box"));

/* ---- ENG-95412: the content properties follow the same key-presence rule as the identity ones ----
   The runtime writes whatever `values` carries, `""` and `false` included (json-applier.js L702-705). A truthiness
   guard here dropped a layer that deliberately BLANKS a caption or UNBINDS a control, so the plan kept reporting a
   caption the page no longer shows. Both arms are pinned: the blanking case must apply, the untouched case must not. */
const blanked = realRun2(
  `{operation:"insert",name:"F",parentName:"Header",propertyName:"items",values:{bindTo:"Name",caption:"Resources.Strings.Cap"}}`,
  `{operation:"merge",name:"F",values:{caption:""}}`);
const blankedItem = blanked.items.find((i) => i.name === "F");
check("ENG-95412: a merge that RESTATES `caption` as empty blanks it — presence decides for the content properties too, and the base caption is not kept",
  blankedItem?.caption === null && blankedItem?.bindTo === "Name",
  () => blankedItem);
const untouchedCap = realRun2(
  `{operation:"insert",name:"F",parentName:"Header",propertyName:"items",values:{bindTo:"Name",caption:"Resources.Strings.Cap"}}`,
  `{operation:"merge",name:"F",values:{visible:false}}`);
check("ENG-95412: a merge that does NOT carry `caption` leaves it intact — otherwise 'presence decides' would just mean 'always overwrite'",
  untouchedCap.items.find((i) => i.name === "F")?.caption === "Resources.Strings.Cap",
  () => untouchedCap.items.find((i) => i.name === "F"));

/* ---- ENG-95412: a merge onto an item nothing defined is an ENGINE-ONLY stub, and now says so ----
   The runtime finds no item, returns false (json-applier.js L688) and `applyOperations` throws that away (L301) —
   a silent no-op. The engine records a stub instead, deliberately, because a merge onto nothing means a missing base
   seed or schemas out of order. Unmarked, though, every consumer reads that stub as an element on the rendered page. */
const stubRun = realRun(`{operation:"merge",name:"Ghost",values:{bindTo:"Name"}}`);
const ghost = stubRun.items.find((i) => i.name === "Ghost");
check("ENG-95412: a merge-onto-missing stub is flagged `engineOnlyStub` and its warning states the runtime does nothing there — the stub is a diagnostic, not a claim about the page",
  ghost?.engineOnlyStub === true
  && (stubRun.warnings || []).some((w) => w.name === "Ghost" && /runtime silently does nothing/.test(w.hint || "")),
  () => ({ ghost, warnings: (stubRun.warnings || []).map((w) => w.hint) }));
check("ENG-95412: an ordinary insert is NOT flagged as an engine-only stub — the marker has to distinguish, not decorate everything",
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
check("ENG-95412: `remove` with a `properties` array clears ONLY those keys and KEEPS the element — caption gone, bindTo and itemType intact, and it is not in removed[]",
  !!rmPropsItem && rmPropsItem.caption === null && rmPropsItem.bindTo === "Name" && rmPropsItem.itemType === 6
  && !rmProps.removed.some((r) => r.name === "Fld"),
  () => ({ item: rmPropsItem, removed: rmProps.removed.map((r) => r.name) }));
// review (PR#114) — `value` is the one removable key modelled as TWO fields (`valueBindTo` + `optionValue`), and
// its branch recorded provenance itself on top of the unconditional record after the loop: the layer that cleared
// the key was listed TWICE as having touched the element. Both fields must clear, and the package must appear once.
const rmValue = realRun2(
  `{operation:"insert",name:"Opt",parentName:"Header",propertyName:"items",values:{itemType:19,value:{bindTo:"IsPrimary"}}}`,
  `{operation:"remove",name:"Opt",properties:["value"]}`);
const rmValueItem = rmValue.items.find((i) => i.name === "Opt");
check("review(PR#114): `remove properties:[\"value\"]` clears BOTH derived fields and lists the removing package ONCE (its branch pushed provenance on top of the unconditional record)",
  () => rmValueItem.valueBindTo === null && rmValueItem.optionValue === null
  && rmValueItem.provenance.join(",") === "A,B",
  () => rmValueItem);
// The control arm: a plain `remove` must still tombstone. Without it, "keeps the element" could be implemented by
// making every remove a no-op.
const rmPlain = realRun2(
  `{operation:"insert",name:"Fld",parentName:"Header",propertyName:"items",values:{bindTo:"Name"}}`,
  `{operation:"remove",name:"Fld"}`);
check("ENG-95412: a plain `remove` (no `properties`) still tombstones the element — the two forms stay distinct operations",
  !rmPlain.items.some((i) => i.name === "Fld") && rmPlain.removed.some((r) => r.name === "Fld"),
  () => ({ items: rmPlain.items.map((i) => i.name), removed: rmPlain.removed.map((r) => r.name) }));

// `set` is a wholesale replace: position is recovered from the replaced item, every unrestated property is gone,
// and so are the children (json-applier.js L660-677).
const setRun = realRun(
  `{operation:"insert",name:"Box",parentName:"Header",propertyName:"items",values:{itemType:7,caption:"Resources.Strings.BoxCap"}}`,
  `{operation:"insert",name:"Kid",parentName:"Box",propertyName:"items",values:{bindTo:"Name"}}`,
  `{operation:"set",name:"Box",values:{itemType:7}}`);
const setBox = setRun.items.find((i) => i.name === "Box");
check("ENG-95412: `set` replaces the element wholesale — the unrestated caption is gone, the position is recovered from the replaced item, and the child is dropped with it",
  !!setBox && setBox.caption === null && setBox.parent === "Header" && setBox.itemType === 7
  && !setRun.items.some((i) => i.name === "Kid"),
  () => ({ box: setBox, items: setRun.items.map((i) => i.name) }));
// REWRITTEN — this pinned the defect, not the invariant. Its `Kid` is CLIENT-authored (a single client layer), so
// "does not appear in removed[]" asserted exactly the hiding the PR #105 review caught. That is also why the
// mutation check passed on it: the pin agreed with the bug. The real invariant is ownership-dependent, and it is
// pinned on the mixed-ownership fixture above; here the client-authored child must be VISIBLE.
check("ENG-95412: a CLIENT-authored child dropped by `set` appears in removed[] — it is a decision the reader must see, not structural cleanup",
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
check("ENG-95412: the same `values` via `merge` keeps BOTH the caption and the child — this is the whole difference between the two operations, so pinning one without the other pins nothing",
  baselineCaption != null
  && mergeControl.items.find((i) => i.name === "Box")?.caption === baselineCaption
  && mergeControl.items.some((i) => i.name === "Kid"),
  () => ({ baselineCaption, merged: mergeControl.items.find((i) => i.name === "Box"), items: mergeControl.items.map((i) => i.name) }));

/* ---- ENG-95412: a `move` carries its own `values`, and the runtime applies them ----
   Grounded in real data: ContactPageV2's `SiteEventDetail` is inserted by package `SiteEvent` with
   `values: { itemType: Terrasoft.ViewItemType.DETAIL }` and then MOVED by package `EventTracking` restating the
   same `itemType`. That real occurrence is REDUNDANT — the value repeats what the insert already set — so it can
   never witness the bug. The pin therefore uses the identical code path with a DIFFERING value, which is the only
   way to observe it, and the redundant real shape is pinned separately as the no-regression arm. ---- */
const moveApplies = mergeHierarchy([
  synth("base", [{ operation: "insert", name: "SiteEventDetail", parentName: "Header", propertyName: "items", itemType: 7 }]),
  synth("top", [{ operation: "move", name: "SiteEventDetail", parentName: "HistoryTab", itemType: 2 }]),
]);
const movedItem = moveApplies.items.find((i) => i.name === "SiteEventDetail");
check("ENG-95412: a `move` that restates `itemType` APPLIES it (7 -> 2) — the runtime Ext.applies the move op onto the reinserted item, so ignoring its values reported a stale kind",
  movedItem?.itemType === 2 && movedItem?.parent === "HistoryTab",
  () => ({ itemType: movedItem?.itemType, parent: movedItem?.parent }));
// The real ContactPageV2 shape: the move repeats the insert's kind. Must stay a no-op, or the fix would be
// "apply something" rather than "apply what the op states".
const moveRedundant = mergeHierarchy([
  synth("base", [{ operation: "insert", name: "SiteEventDetail", parentName: "Header", propertyName: "items", itemType: 2 }]),
  synth("top", [{ operation: "move", name: "SiteEventDetail", parentName: "HistoryTab", itemType: 2 }]),
]);
check("ENG-95412: the REAL shape (a move restating the kind the insert already set) stays a no-op on the kind — this is what ContactPageV2 actually does",
  moveRedundant.items.find((i) => i.name === "SiteEventDetail")?.itemType === 2,
  () => moveRedundant.items.find((i) => i.name === "SiteEventDetail"));
// A move that states NO itemType must leave the kind alone — key presence, same as merge.
const moveSilent = mergeHierarchy([
  synth("base", [{ operation: "insert", name: "SiteEventDetail", parentName: "Header", propertyName: "items", itemType: 2 }]),
  synth("top", [{ operation: "move", name: "SiteEventDetail", parentName: "HistoryTab" }]),
]);
check("ENG-95412: a `move` that carries no `itemType` key leaves the kind intact — presence decides here too",
  moveSilent.items.find((i) => i.name === "SiteEventDetail")?.itemType === 2,
  () => moveSilent.items.find((i) => i.name === "SiteEventDetail"));

/* ---- ENG-95412: the merge rule is key PRESENCE, not value — verified against core `json-applier.js` ----
   `JsonApplier.merge` takes `Object.keys(config.values)` (L583-585) and assigns unconditionally (L702-705), so a
   later layer that carries an `itemType` key AT ALL overwrites the base — including with a value this engine cannot
   resolve. The engine used to guard on `op.itemType != null`, which silently kept the base kind and reported a
   RADIO_GROUP the runtime had already turned into a plain bound field (`generateStandardItem` default →
   `generateModelItem`). Both directions are pinned, because a one-sided pin passes with the guard put back. ---- */
const mergeCleared = mergeHierarchy([
  synth("base", [{ operation: "insert", name: "F", parentName: "Header", propertyName: "items", itemType: 16 }]),
  synth("top", [{ operation: "merge", name: "F", itemType: null, itemTypeUnresolved: true }]),
]);
const clearedItem = mergeCleared.items.find((i) => i.name === "F");
check("ENG-95412: a merge that RESTATES `itemType` with a value the engine cannot resolve CLEARS the base kind (16) — keeping it asserts a kind the runtime already overwrote",
  clearedItem?.itemType === null && clearedItem?.itemTypeUnresolved === true,
  () => ({ itemType: clearedItem?.itemType, unresolved: clearedItem?.itemTypeUnresolved }));
check("ENG-95412: clearing a resolved kind is WARNED, not silent — the element changed behaviour and the operator has to see it",
  (mergeCleared.warnings || []).some((w) => w.name === "F" && /CLEARED/.test(w.hint || "")),
  () => (mergeCleared.warnings || []).map((w) => w.hint));
// The other direction: a merge that does NOT carry the key must leave the base kind alone. This is the arm that
// fails if key-presence is implemented as "always overwrite".
const mergeKept = mergeHierarchy([
  synth("base", [{ operation: "insert", name: "F", parentName: "Header", propertyName: "items", itemType: 16 }]),
  synth("top", [{ operation: "merge", name: "F", caption: "Renamed" }]),
]);
const keptItem = mergeKept.items.find((i) => i.name === "F");
check("ENG-95412: a merge whose `values` does NOT carry `itemType` leaves the base kind intact (16) — presence decides, so absence must be a no-op",
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
check("bare terrasoft-param Terrasoft.ViewItemType.CONTROL_GROUP resolves to 15 (param no longer an opaque proxy)", byName.gParam.itemType === 15);
check("this.Terrasoft.ViewItemType.GRID_LAYOUT resolves to 0", byName.gGrid.itemType === 0);
check("this.Terrasoft.ContentType.LOOKUP resolves to 5 (lookup control hint)", byName.fLookThis.contentType === 5);
check("bare terrasoft-param Terrasoft.ContentType.LOOKUP resolves to 5", byName.fLookParam.contentType === 5);
// ContentType is pinned COMPLETE (ENG-95412): a member the schema names is IDENTIFIED, never collapsed to null —
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

/* ---- extractFnBody: a brace inside a string/comment must not truncate the method scan (review #1) ---- */
console.log("\n===== extractFnBody string safety + move-order fidelity =====");
const braceBody = 'define("X", [], function() { return { entitySchemaName: "X", diff: [], getActions: function() { var s = "a } b { c"; return [ { "Tag": "runEscalation", "Click": "navigateToEscalation" } ]; } }; });';
const braceRes = parseSchema(braceBody, "X");
check("extractFnBody: a `{`/`}` inside a string no longer truncates the getActions scan",
  braceRes.actionHints.includes("runEscalation") && braceRes.actionHints.includes("navigateToEscalation"));

/* ---- move op must apply the new order/index, not just the parent (review #2) ---- */
const mvBase = parseSchema('define("Base", [], function() { return { entitySchemaName: "E", diff: [ { operation: "insert", name: "A", parentName: "P", index: 0, values: { bindTo: "A" } }, { operation: "insert", name: "B", parentName: "P", index: 1, values: { bindTo: "B" } } ] }; });', "Base");
const mvTop = parseSchema('define("Top", [], function() { return { entitySchemaName: "E", diff: [ { operation: "move", name: "A", parentName: "P", index: 9 } ] }; });', "Top");
const mvA = mergeHierarchy([mvBase, mvTop]).items.find((i) => i.name === "A");
check("move op applies the new order/index (A repositioned to 9, not stuck at 0)", !!mvA && mvA.order === 9);


/* ================= ENG-95862: severity axis on eff.warnings + `labelConfig`/handler modelling =================
   The defect: the correctness gate blocked on ANY non-empty `eff.warnings`, including one whose own text says
   "The element is KEPT (correct)". Warnings now carry `severity`, and the two families are asserted per producer —
   a new producer that forgets to declare one is caught by the "every warning has a severity" check below. */
console.log("\n===== ENG-95862: warning severity + labelConfig =====");

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
check("ENG-95862: a `labelConfig.caption` layer supplies the item's caption (platform precedence: config.caption → labelConfig.caption → column)",
  !!lcMidItem && lcMidItem.caption === "Resources.Strings.RequesterLabel" && lcMidItem.labelCaption === "Resources.Strings.RequesterLabel",
  () => lcMidItem);

const lcFull = mergeHierarchy([lcBase, lcMid, lcTop]);
const lcItem = lcFull.items.find((i) => i.name === "Requester");
check("ENG-95862: `remove properties:['labelConfig']` CLEARS the custom label (caption falls back to the column's own title) and the element is kept",
  !!lcItem && lcItem.caption === null && lcItem.labelCaption === null && !lcFull.removed.some((r) => r.name === "Requester"),
  () => ({ item: lcItem, removed: lcFull.removed.map((r) => r.name) }));
check("ENG-95862: that op raises NO warning at all — the key is modelled now, so there is nothing to demote",
  lcFull.warnings.length === 0, () => lcFull.warnings);

// The OVER-CLEARING case: a layer that states BOTH must keep `config.caption` when only `labelConfig` is removed.
const lcBoth = ps("Both", [{ operation: "merge", name: "Requester", values: { caption: { bindTo: "Resources.Strings.OwnCaption" }, labelConfig: { caption: { bindTo: "Resources.Strings.RequesterLabel" } } } }]);
const lcBothItem = mergeHierarchy([lcBase, lcBoth, lcTop]).items.find((i) => i.name === "Requester");
check("ENG-95862: removing `labelConfig` does NOT over-clear — a `caption` stated on the control itself survives",
  !!lcBothItem && lcBothItem.caption === "Resources.Strings.OwnCaption" && lcBothItem.labelCaption === null,
  () => lcBothItem);

// HANDLER family — the second gap the key audit found. `click` lives in the `handlers` map, not as a field.
const hBase = ps("HBase", [{ operation: "insert", name: "Btn", parentName: "Header", propertyName: "items", values: { itemType: 5, click: { bindTo: "onBtnClick" }, visible: false } }]);
const hTop = ps("HTop", [{ operation: "remove", name: "Btn", properties: ["click"] }]);
const hItem = mergeHierarchy([hBase, hTop]).items.find((i) => i.name === "Btn");
check("ENG-95862 (key audit): `remove properties:['click']` clears the handler binding and raises no warning",
  !!hItem && !hItem.handlers.click && mergeHierarchy([hBase, hTop]).warnings.length === 0,
  () => hItem);
// `visible` is in BOTH vocabularies: a removal must clear the static value AND the dynamic trigger, not one of them.
const hVis = ps("HVis", [{ operation: "remove", name: "Btn", properties: ["visible"] }]);
const hVisBase = ps("HVisBase", [{ operation: "insert", name: "Btn", parentName: "Header", propertyName: "items", values: { itemType: 5, visible: { bindTo: "isBtnVisible" } } }]);
const hVisItem = mergeHierarchy([hVisBase, hVis]).items.find((i) => i.name === "Btn");
check("ENG-95862 (key audit): `visible` is in BOTH vocabularies — removing it clears the field AND the handler entry, never half of it",
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
  check(`ENG-95862 (key audit): a STATIC \`${key}: false\` removal is an unmodelled effect — it warns (fidelity) instead of silently doing nothing`,
    lit.warnings.length === 1 && lit.warnings[0].severity === "fidelity" && new RegExp(key).test(lit.warnings[0].hint),
    () => lit.warnings);
  const dynBase = ps("DynB", [{ operation: "insert", name: "F", parentName: "Header", propertyName: "items", values: { bindTo: "F", [key]: { bindTo: "m" } } }]);
  const dyn = mergeHierarchy([dynBase, litTop]);
  const dynItem = dyn.items.find((i) => i.name === "F");
  check(`ENG-95862 (key audit): the HANDLER form of \`${key}\` is modelled, so removing it clears the map entry and raises nothing`,
    dyn.warnings.length === 0 && !!dynItem && !dynItem.handlers?.[key],
    () => ({ warnings: dyn.warnings, handlers: dynItem?.handlers }));
}

// A genuinely unmodelled key stays a warning — but a FIDELITY one, which no longer blocks.
const unBase = ps("UBase", [{ operation: "insert", name: "F", parentName: "Header", propertyName: "items", values: { bindTo: "F" } }]);
const unTop = ps("UTop", [{ operation: "remove", name: "F", properties: ["wrapClass"] }]);
const unRun = mergeHierarchy([unBase, unTop]);
check("ENG-95862: a still-unmodelled remove key is a FIDELITY warning (advisory), not a correctness one",
  unRun.warnings.length === 1 && unRun.warnings[0].severity === "fidelity" && /KEPT \(correct\)/.test(unRun.warnings[0].hint),
  () => unRun.warnings);

// The CORRECTNESS half — each of the five producers, asserted by severity rather than by trust.
const ghostMerge = mergeHierarchy([ps("G", [{ operation: "merge", name: "Ghost", values: { caption: "x" } }])]);
const ghostMove = mergeHierarchy([ps("G", [{ operation: "move", name: "Ghost", parentName: "Header" }])]);
const ghostRemove = mergeHierarchy([ps("G", [{ operation: "remove", name: "Ghost" }])]);
const ghostSet = mergeHierarchy([ps("G", [{ operation: "set", name: "Ghost", values: { bindTo: "Ghost" } }])]);
check("ENG-95862: merge/move/remove/set onto an item no lower schema defined are all CORRECTNESS warnings (the gate must still block)",
  [ghostMerge, ghostMove, ghostRemove, ghostSet].every((r) => r.warnings.length === 1 && r.warnings[0].severity === "correctness"),
  () => [ghostMerge, ghostMove, ghostRemove, ghostSet].map((r) => r.warnings.map((w) => w.severity)));

// `set` REPLACING a real element is a fidelity note: the engine's reading is right, the wholesale replacement is
// what the reader must be told about.
const g862SetBase = ps("SBase", [{ operation: "insert", name: "Grp", parentName: "Header", propertyName: "items", values: { itemType: 15 } }]);
const g862SetTop = ps("STop", [{ operation: "set", name: "Grp", values: { itemType: 15 } }]);
const g862SetRun = mergeHierarchy([g862SetBase, g862SetTop]);
check("ENG-95862: `set` replacing an EXISTING element is a FIDELITY note (the mapping is right; the wholesale replacement is the fact to report)",
  g862SetRun.warnings.length === 1 && g862SetRun.warnings[0].severity === "fidelity", () => g862SetRun.warnings);

// The structural guarantee: no producer may ship without declaring a severity, and none may invent a third value.
const everyWarning = [lcFull, unRun, ghostMerge, ghostMove, ghostRemove, ghostSet, g862SetRun].flatMap((r) => r.warnings);
check("ENG-95862: EVERY warning declares a severity, and only the two legal values exist",
  everyWarning.length > 0 && everyWarning.every((w) => w.severity === "correctness" || w.severity === "fidelity"),
  () => everyWarning.map((w) => ({ op: w.op, name: w.name, severity: w.severity })));
check("ENG-95862: every warning also carries a `hint` — the gate quotes it, so a producer that names its text differently renders as `undefined`",
  everyWarning.every((w) => typeof w.hint === "string" && w.hint.length > 0),
  () => everyWarning.map((w) => ({ op: w.op, name: w.name, hint: w.hint })));

/* ================= ENG-96571 / A4: DataValueType alias (STRING→TEXT) + case-insensitive member lookup =================
   The defect: the pinned DATA_VALUE_TYPE table has TEXT:1 (no STRING) and GUID:0, and lookups were case-sensitive,
   so a stand echoing `STRING`/`Guid`, or a schema body referencing `Terrasoft.DataValueType.STRING`/`DataValueType.Guid`,
   raised a false `unknown-enum-member` — the attribute then read as parse-gap instead of a typed virtual attribute. */
console.log("\n===== ENG-96571 A4: DataValueType alias + case-insensitive lookup =====");

// 1) manifest.enumVocabulary drift guard: STRING:1 and Guid:0 are the SAME members as pinned TEXT:1/GUID:0 —
//    resolved via alias + case-insensitive match, so neither is a mismatch nor a stand-only "new member".
const okVocab = { DataValueType: { STRING: 1, Guid: 0 } };
const okDrift = enumDriftIssues(okVocab);
check("A4: STRING:1 and Guid:0 from manifest.enumVocabulary produce no diagnostics",
  okDrift.mismatches.length === 0 && okDrift.newMembers.length === 0, () => okDrift);

// 2) STRING:2 is a REAL mismatch (engine's TEXT is 1, this stand disagrees) — still blocks after the alias fix.
const badVocab = { DataValueType: { STRING: 2 } };
const badDrift = enumDriftIssues(badVocab);
check("A4: STRING:2 still blocks (genuine mismatch survives the alias/case-insensitive resolution)",
  badDrift.mismatches.length === 1 && /DataValueType\.STRING: engine 1, stand 2/.test(badDrift.mismatches[0]),
  () => badDrift);

// 3) A stand-only member (not in the pinned table, no alias for it) stays advisory ("newMembers"), same as today.
const standOnlyVocab = { DataValueType: { SOME_FUTURE_MEMBER: 99 } };
const standOnlyDrift = enumDriftIssues(standOnlyVocab);
check("A4: a stand-only member (no alias, not pinned) stays advisory (newMembers), not blocking",
  standOnlyDrift.mismatches.length === 0 && standOnlyDrift.newMembers.length === 1 &&
  /DataValueType\.SOME_FUTURE_MEMBER \(99\)/.test(standOnlyDrift.newMembers[0]), () => standOnlyDrift);

// 4) A virtual attribute (no entity column) declared with `dataValueType: Terrasoft.DataValueType.STRING` must
//    resolve to a NUMBER (TEXT=1) — no `unknown-enum-member` diagnostic — so mapper.mjs's virtualAttributeDecision
//    reads it as a typed attribute-virtual, not a parse-gap.
const stringAttrSrc = 'define("VA1",[],function(){return{entitySchemaName:"E",diff:[],attributes:{IsBusy:{dataValueType:Terrasoft.DataValueType.STRING,value:""}}};});';
const stringAttrRes = parseSchema(stringAttrSrc, "VA1");
const isBusy = stringAttrRes.attributeDefs.find(a => a.name === "IsBusy");
check("A4: a virtual attribute declared with dataValueType: Terrasoft.DataValueType.STRING resolves to TEXT (1), no unknown-enum-member",
  !!isBusy && isBusy.dataValueType === 1 && !stringAttrRes.astDiagnostics.some(d => d.kind === "unknown-enum-member"),
  () => ({ isBusy, diagnostics: stringAttrRes.astDiagnostics }));

// 5) Same for the mixed-case `Guid` member (GUID=0) via `this.Terrasoft.DataValueType.Guid`.
const guidAttrSrc = 'define("VA2",[],function(){return{entitySchemaName:"E",diff:[],attributes:{RecordVisaId:{dataValueType:this.Terrasoft.DataValueType.Guid}}};});';
const guidAttrRes = parseSchema(guidAttrSrc, "VA2");
const recordVisaId = guidAttrRes.attributeDefs.find(a => a.name === "RecordVisaId");
check("A4: `this.Terrasoft.DataValueType.Guid` resolves to GUID (0), no unknown-enum-member",
  !!recordVisaId && recordVisaId.dataValueType === 0 && !guidAttrRes.astDiagnostics.some(d => d.kind === "unknown-enum-member"),
  () => ({ recordVisaId, diagnostics: guidAttrRes.astDiagnostics }));

// 6) Guard-can-fail proof: a member that genuinely does not exist in the pinned table (with no alias) MUST still
//    raise `unknown-enum-member` — proving the alias/case-insensitivity fix did not turn the guard into a no-op.
const brokenAttrSrc = 'define("VA3",[],function(){return{entitySchemaName:"E",diff:[],attributes:{Broken:{dataValueType:Terrasoft.DataValueType.TOTALLY_NOT_A_REAL_MEMBER}}};});';
const brokenAttrRes = parseSchema(brokenAttrSrc, "VA3");
check("A4 guard-can-fail proof: a genuinely unknown DataValueType member still raises unknown-enum-member",
  brokenAttrRes.astDiagnostics.some(d => d.kind === "unknown-enum-member" && d.detail === "DataValueType.TOTALLY_NOT_A_REAL_MEMBER"),
  () => brokenAttrRes.astDiagnostics);


/* ================================================================================================
   ENG-96571 B1 — the trigger tracer must read the declarations the parser ALREADY has.
   Before this, `methodTriggers` looked only at `attributes[].dependencies[].methodName` and bound
   diff-item handlers, `normalizeDetails` kept four fields (dropping `filterMethod`), and
   `attributeFact` counted `lookupListConfig.filters` without keeping any method NAME. The result on
   the Applicants run: the plan's ⚠ rows named four declarations the engine had parsed itself.
   ================================================================================================ */

// ---- parser: `details[].filterMethod`, in BOTH nesting positions real bodies use ----
const detFilterSrc = 'define("D1",[],function(){return{entitySchemaName:"E",diff:[],details:{' +
  'Emails:{schemaName:"ApplicantEmailDetailV2",entitySchemaName:"Activity",filterMethod:"getEmailDetailFilter"},' +
  'Nested:{schemaName:"XDetail",filter:{filterMethod:"getNestedFilter"}},' +
  'Plain:{schemaName:"YDetail",filter:{masterColumn:"Id",detailColumn:"E"}},' +
  'Subs:{schemaName:"ZDetail",subscriberMethods:{onCardSaved:"reloadZ",onDelete:function(){return;}}}' +
  '}};});';
const detFilter = parseSchema(detFilterSrc, "D1");
check("B1 parser: `details[].filterMethod` survives normalizeDetails — beside `schemaName` AND inside `filter` (both forms occur in real bodies)",
  detFilter.details.Emails?.filterMethod === "getEmailDetailFilter"
  && detFilter.details.Nested?.filterMethod === "getNestedFilter"
  && detFilter.details.Plain?.filterMethod === null,
  () => detFilter.details);
check("B1 parser: `details[].subscriberMethods` keeps the STRING-valued entries and drops the function-valued one (its method has no name to carry)",
  detFilter.details.Subs?.subscriberMethods?.onCardSaved === "reloadZ"
  && !("onDelete" in (detFilter.details.Subs?.subscriberMethods || {}))
  && detFilter.details.Plain?.subscriberMethods === null,
  () => detFilter.details.Subs);

// ---- parser: the string-valued handler slots on an `attributes` entry ----
const attrHandlerSrc = 'define("A1",[],function(){return{entitySchemaName:"E",diff:[],attributes:{' +
  'Contact:{onChange:"onContactChange"},' +
  'Amount:{changeMethod:"recalcAmount"},' +
  'Job:{lookupListConfig:{filter:"getJobFilter"}},' +
  'Stage:{lookupListConfig:{filters:[{method:"getStageFilter"}]}},' +
  'Request:{lookupListConfig:{filter:function(){return this.getRequestStatusFilter();}}},' +
  'Plain:{dataValueType:Terrasoft.DataValueType.STRING}' +
  '}};});';
const attrHandler = parseSchema(attrHandlerSrc, "A1");
const af = (n) => attrHandler.attributeDefs.find(a => a.name === n);
check("B1 parser: a STRING `onChange` / `changeMethod` reaches `handlerMethods.onChange`",
  af("Contact")?.handlerMethods?.onChange === "onContactChange"
  && af("Amount")?.handlerMethods?.onChange === "recalcAmount",
  () => ({ Contact: af("Contact")?.handlerMethods, Amount: af("Amount")?.handlerMethods }));
check("B1 parser: a STRING `lookupListConfig.filter` — and a `lookupListConfig.filters[].method` — reach `handlerMethods.lookupFilter`",
  af("Job")?.handlerMethods?.lookupFilter === "getJobFilter"
  && af("Stage")?.handlerMethods?.lookupFilter === "getStageFilter",
  () => ({ Job: af("Job")?.handlerMethods, Stage: af("Stage")?.handlerMethods }));
// The rule this protects: `04-units.md` forbids deriving a trigger from a method's NAME. A function-valued
// slot has no name to carry, so it must produce NO `handlerMethods` entry — and must still be REPORTED, as a
// dotted `fnKeys` path, so the imperative filter is visible without being invented.
check("B1 parser: a FUNCTION-valued `lookupListConfig.filter` yields NO handlerMethods name — and is reported as the dotted fnKey `lookupListConfig.filter`",
  af("Request")?.handlerMethods === null
  && af("Request")?.fnKeys.includes("lookupListConfig.filter"),
  () => ({ handlerMethods: af("Request")?.handlerMethods, fnKeys: af("Request")?.fnKeys }));
check("B1 parser: an attribute declaring no handler slot at all carries `handlerMethods: null` (absent, not an empty shell)",
  af("Plain")?.handlerMethods === null, () => af("Plain"));

// ---- tracer: the three new trigger kinds, with `from` paths the reported-trigger grammar accepts ----
// `from` must satisfy the same shape `validateReportedTrigger` enforces on a REPORTED trigger
// (`^(attributes|details)\.[A-Za-z0-9_$]+(\.[A-Za-z0-9_$]+)*$`), because both travel through the same
// renderers and the same step-5.1 handoff digest.
const DECL_PATH_RX = /^(attributes|details)\.[A-Za-z0-9_$]+(\.[A-Za-z0-9_$]+)*$/;
const trcSrc = 'define("T1",[],function(){return{entitySchemaName:"E",diff:[],' +
  'details:{Emails:{schemaName:"ApplicantEmailDetailV2",filterMethod:"getEmailDetailFilter"},' +
  'Subs:{schemaName:"ZDetail",subscriberMethods:{onCardSaved:"reloadZ"}}},' +
  'attributes:{Contact:{onChange:"onContactChange"},Job:{lookupListConfig:{filter:"getJobFilter"}}},' +
  'methods:{onContactChange:function(){this.set("X",1);},getJobFilter:function(){return 1;},' +
  'getEmailDetailFilter:function(){return 2;},reloadZ:function(){return 3;},lonely:function(){return 4;}}};});';
const trc = mergeHierarchy([parseSchema(trcSrc, "T1")]);
const trg = (n) => trc.methods.find(m => m.name === n)?.triggers || [];
check("B1 tracer: `attributes.<Col>.onChange` yields {kind:'attribute'} naming the attribute and the declaration path",
  trg("onContactChange").length === 1 && trg("onContactChange")[0].kind === "attribute"
  && trg("onContactChange")[0].attribute === "Contact"
  && trg("onContactChange")[0].from === "attributes.Contact.onChange",
  () => trg("onContactChange"));
check("B1 tracer: a STRING `attributes.<Col>.lookupListConfig.filter` yields {kind:'entity-filter'}",
  trg("getJobFilter").length === 1 && trg("getJobFilter")[0].kind === "entity-filter"
  && trg("getJobFilter")[0].attribute === "Job"
  && trg("getJobFilter")[0].from === "attributes.Job.lookupListConfig.filter",
  () => trg("getJobFilter"));
check("B1 tracer: `details.<Key>.filterMethod` yields {kind:'detail'} naming the detail KEY (what the platform and the plan both call it)",
  trg("getEmailDetailFilter").length === 1 && trg("getEmailDetailFilter")[0].kind === "detail"
  && trg("getEmailDetailFilter")[0].detail === "Emails"
  && trg("getEmailDetailFilter")[0].from === "details.Emails.filterMethod",
  () => trg("getEmailDetailFilter"));
check("B1 tracer: a `details.<Key>.subscriberMethods.<event>` entry yields {kind:'detail'} naming the event in the path",
  trg("reloadZ").length === 1 && trg("reloadZ")[0].kind === "detail"
  && trg("reloadZ")[0].from === "details.Subs.subscriberMethods.onCardSaved",
  () => trg("reloadZ"));
check("B1 tracer: every emitted `from` path satisfies the reported-trigger grammar validateReportedTrigger enforces",
  ["onContactChange", "getJobFilter", "getEmailDetailFilter", "reloadZ"]
    .every(n => trg(n).every(t => DECL_PATH_RX.test(t.from) && t.from !== n)),
  () => ["onContactChange", "getJobFilter", "getEmailDetailFilter", "reloadZ"].map(n => [n, trg(n)]));
check("B1 tracer: a method NO declaration names still gets no trigger — the tracer reads declarations, it does not guess from names",
  trg("lonely").length === 0, () => trg("lonely"));
// The existing `dependencies`-based trigger is untouched, and coexists with a new one on the same attribute.
const bothSrc = 'define("T2",[],function(){return{entitySchemaName:"E",diff:[],attributes:{' +
  'Contact:{onChange:"onContactChange",dependencies:[{columns:["Account"],methodName:"onContactChange"}]}},' +
  'methods:{onContactChange:function(){return 1;}}};});';
const both = mergeHierarchy([parseSchema(bothSrc, "T2")]).methods.find(m => m.name === "onContactChange").triggers;
check("B1 tracer: the pre-existing `attribute-dependency` trigger is NOT displaced — a column declaring both shapes yields both",
  both.length === 2 && both.some(t => t.kind === "attribute-dependency" && t.attribute === "Contact")
  && both.some(t => t.kind === "attribute" && t.from === "attributes.Contact.onChange"),
  () => both);
// Guard-can-fail: a detail KEY the `from` grammar cannot express must yield NO trigger rather than an
// unusable path that the reported-trigger validator would reject downstream.
const badKeySrc = 'define("T3",[],function(){return{entitySchemaName:"E",diff:[],' +
  'details:{"Bad-Key.v2":{schemaName:"XDetail",filterMethod:"getXFilter"}},' +
  'methods:{getXFilter:function(){return 1;}}};});';
const badKey = mergeHierarchy([parseSchema(badKeySrc, "T3")]).methods.find(m => m.name === "getXFilter").triggers;
check("B1 tracer guard: a detail key the declaration-path grammar cannot express emits NO trigger (an unusable `from` is worse than an honest blank)",
  badKey.length === 0, () => badKey);

/* ---- ENG-96571 A3: the parser records how many conditions a rule DECLARED ---- */
// `sanitizeConditions` returns `[]` for both "no conditions" and "conditions this parser could not read", and those
// two must render the OPPOSITE Trigger cell. `conditionsDeclared` is the fact that separates them, so it is recorded
// where the source is read — here, not inferred downstream.
const A3_SRC = (conds) => `define("A3Page", ["BusinessRuleModule"], function(BusinessRuleModule) { return {
  entitySchemaName: "HRRequest",
  rules: { "Job": { "JobRequired": {
    "ruleType": BusinessRuleModule.enums.RuleType.BINDPARAMETER,
    "property": BusinessRuleModule.enums.Property.REQUIRED,
    "conditions": ${conds}
  } } },
  diff: []
}; });`;
const a3Rule = (conds) => mergeHierarchy([parseSchema(A3_SRC(conds), "A3Page")]).rules.find(r => r.key === "JobRequired");
// (i) a COMPLETE condition — one entry, fully readable
const a3Complete = a3Rule(`[{ "leftExpression": { "type": 1, "attribute": "Stage" }, "comparisonType": 3, "rightExpression": { "type": 0, "value": "New" } }]`);
check("ENG-96571 A3: a readable condition is recorded as 1 declared / 1 sanitized",
  a3Complete.conditionsDeclared === 1 && a3Complete.conditions.length === 1
  && a3Complete.conditions[0].left.attribute === "Stage" && a3Complete.conditions[0].comparison === 3,
  () => JSON.stringify(a3Complete));
// (ii) the REAL Job.JobRequired shape — declared, and sanitizes to a degenerate entry (symbolic comparison, a
// CONSTANT left expression). The count says a condition WAS declared even though nothing readable came out of it.
const a3Degenerate = a3Rule(`[{ "leftExpression": { "type": BusinessRuleModule.enums.ValueType.CONSTANT, "value": true }, "comparisonType": Terrasoft.ComparisonType.EQUAL, "rightExpression": { "type": BusinessRuleModule.enums.ValueType.CONSTANT, "value": true } }]`);
check("ENG-96571 A3: the real Job.JobRequired condition is 1 DECLARED and sanitizes to a degenerate entry (no comparison, no left attribute)",
  a3Degenerate.conditionsDeclared === 1 && a3Degenerate.conditions.length === 1
  && a3Degenerate.conditions[0].comparison === null
  && a3Degenerate.conditions[0].left.attribute === null && a3Degenerate.conditions[0].left.path === null
  && a3Degenerate.conditions[0].right.value === true,
  () => JSON.stringify(a3Degenerate.conditions));
// (iii) the object-MAP form — a non-array `conditions`. It is READ, through the same `safeKeys` the declared count
// uses, so the two halves agree: 2 declared / 2 sanitized. Before the ENG-96571 review `sanitizeConditions`
// returned `[]` for it while `declaredConditionCount` counted its keys, so `conditionGap` saw `declared > 0` with
// an empty set and every object-map rule was a PERMANENT parse gap — a ⚠ row no re-read could ever clear, because
// the gap was in the reader, not in the body.
const a3Dropped = a3Rule(`{ "c1": { "comparisonType": 3 }, "c2": { "comparisonType": 4 } }`);
check("ENG-96571 A3 (review): an object-MAP `conditions` block is READ, not dropped — declared and sanitized counts AGREE, so it is not a permanent parse gap",
  a3Dropped.conditionsDeclared === 2 && a3Dropped.conditions.length === 2
  && a3Dropped.conditions.map((c) => c.comparison).join(",") === "3,4",
  () => JSON.stringify(a3Dropped));
// …and a shape that is neither an array NOR an object still declares nothing and sanitizes to nothing, so a
// garbage `conditions` cannot become a phantom two-entry condition set.
const a3Garbage = a3Rule(`"not a condition block"`);
check("ENG-96571 A3 (review): a `conditions` value that is neither array nor object declares 0 and sanitizes to 0",
  a3Garbage.conditionsDeclared === 0 && a3Garbage.conditions.length === 0, () => JSON.stringify(a3Garbage));
// (iv) genuinely unconditional — nothing declared, nothing sanitized. This is the ONLY shape that may render `always`.
const a3None = a3Rule(`[]`);
check("ENG-96571 A3: a rule that declares NO conditions is 0 declared — the only shape a renderer may call `always`",
  a3None.conditionsDeclared === 0 && a3None.conditions.length === 0, () => JSON.stringify(a3None));

console.log(`\n=================\nGOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

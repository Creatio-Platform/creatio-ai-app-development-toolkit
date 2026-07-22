// Golden test runner for the merge engine.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchema, mergeHierarchy } from "../../skills/classic-to-freedom-migration/engine/engine.mjs";
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
  console.log(`details (${eff.details.length}): ${eff.details.map(d => `${d.key}→${d.schemaName || "?"}[${d.entitySchemaName || "?"}]`).join(", ")}`);
  console.log(`rules (${eff.rules.length}):`);
  for (const r of eff.rules) console.log(`   ${r.attr} · ${r.ruleType}${r.property ? "/" + r.property : ""} · ${r.system} · from ${r.provenance.join(">")}`);
  console.log(`removed (${eff.removed.length}): ${eff.removed.map(r => `${r.name}(by ${r.removedBy})`).join(", ")}`);
  console.log(`methods (${eff.methods.length}): ${eff.methods.map(m => m.name).join(", ")}`);
  console.log(`unresolvedParents (${eff.unresolvedParents.length}) [F2 seed list]: ${eff.unresolvedParents.join(", ") || "—"}`);
  console.log(`warnings (${eff.warnings.length}): ${eff.warnings.map(w => `${w.op}:${w.name}@${w.schema}`).join(", ") || "—"}`);
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
  co.warnings.length > 0 && co.warnings.some(w => w.op === "merge" && (w.name === "ESNTab" || w.name === "PrintButton")));

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

/* ---- C2: a merge that introduces contentType on an ALREADY-defined field must carry it (not drop) ---- */
const c2 = mergeHierarchy([
  synth("base", [{ operation: "insert", name: "F", parentName: "Header", propertyName: "items", bindTo: "Col" }]),
  synth("top", [{ operation: "merge", name: "F", contentType: 5 }]),  // later schema marks it a lookup
]);
check("C2: merge introduces contentType (5=lookup) on an existing item — carried, not dropped",
  c2.items.find(i => i.name === "F")?.contentType === 5);

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
check("ContentType.ENUM stays null (hint-only; not pinned to a guessed number that could mis-equal LOOKUP=5)", byName.fEnum.contentType === null);

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

console.log(`\n=================\nGOLDEN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

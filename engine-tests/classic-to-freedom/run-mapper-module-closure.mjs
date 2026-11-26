// A PAGE WHOSE LOGIC LIVES TWO MODULES DOWN (fixture `mbcontract-v3-recorded`, the get-page read of one form page
// and of the two client modules behind it). The page imports only `UsrMbContractsV3App_FormPageModule` (as
// `contractPage`); that module imports `UsrMbContractsV3App_ContractAmountModule` (as `contractAmount`). A
// `Ported as: Module.fn` handler row and a request-fired card action hold when a handler reaches the function through
// that chain — page -> module -> module — in the filed module sources, and the walk ends on an import cycle.
// Imported and run by `run-mapper.mjs`, which hands it its `check`.
import fs from "node:fs";
import path from "node:path";

export function runModuleClosureChecks({ check, verifyCtx, resolveVk, FIX }) {
  const DIR = path.join(FIX, "mbcontract-v3-recorded");
  const FORM = "UsrMbContractsV3App_FormPageModule";
  const AMOUNT = "UsrMbContractsV3App_ContractAmountModule";
  const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
  const formSrc = read(`modules/${FORM}.js`);
  const amountSrc = read(`modules/${AMOUNT}.js`);
  const expected = JSON.parse(read("expected.json")).pages.main;
  const bundle = JSON.parse(read(expected.bundle));
  const entry = { schemaName: bundle.name, parentSchemaName: "PageWithTabsFreedomTemplate", viewConfig: bundle.viewConfig,
    handlers: bundle.handlers, deps: bundle.deps, args: bundle.args, validators: bundle.validators, converters: bundle.converters };
  const ctxOf = (modules) => verifyCtx({ pages: { main: entry }, modules }, "main");
  const handlerVk = (h) => ({ type: "handler", method: h.method, parent: h.parent, triggers: [], portedAs: h.portedAs });
  const rows = (ctx) => expected.handlers.map((h) => [h.method, ...resolveVk(handlerVk(h), ctx)]);
  const rowOf = (ctx, method) => rows(ctx).find((r) => r[0] === method);
  const portedVk = (...portedAs) => ({ type: "handler", method: "mbProbe", parent: null, triggers: [], portedAs });
  const cardVk = { type: "card", request: expected.cardActions[0].request };
  const edit = (src, from, to) => {
    if (!src.includes(from)) throw new Error(`fixture edit: \`${from.slice(0, 60)}\` is not in the module`);
    return src.replace(from, to);
  };
  const both = { [FORM]: formSrc, [AMOUNT]: amountSrc };

  // As recorded: `mbRecalculateAmount` names `ContractAmountModule.recalculateContractAmount`, which the page reaches
  // only through `contractPage.recalculateAmountOnItemsChange` -> `recalculateAmount` -> `contractAmount.…`.
  const recorded = rows(ctxOf(both));
  const amountRow = rowOf(ctxOf(both), "mbRecalculateAmount");
  check("module closure (recorded v3): all 8 handler rows of the form page read ✅ with both module sources filed — the module the page does not import itself is reached through the one it does",
    () => recorded.length === 8 && recorded.every((r) => r[1] === "✅ Done"),
    () => recorded.map((r) => r.slice(0, 3)));
  check("module closure (recorded v3): the `mbRecalculateAmount` row names the whole chain, page -> FormPageModule -> ContractAmountModule",
    () => amountRow[2].includes(`\`contractPage.recalculateAmountOnItemsChange\` in module \`${FORM}\` → \`recalculateAmount\` → \`contractAmount.recalculateContractAmount\` in module \`${AMOUNT}\``),
    () => amountRow);

  // The chain is read from the module that holds the call: without FormPageModule's source no module-to-module step
  // can be seen, and the row says which file to add. The page's own calls still hold.
  const noSource = rows(ctxOf({}));
  const noSourceRow = rowOf(ctxOf({}), "mbRecalculateAmount");
  check("module closure: without the filed module sources only `mbRecalculateAmount` reads ⚠, naming `reads/modules/UsrMbContractsV3App_FormPageModule.js`; the 7 rows the page reaches itself stay ✅",
    () => noSourceRow[1] === "⚠ verify" && noSourceRow[2].includes(`add it as \`reads/modules/${FORM}.js\``)
      && noSource.filter((r) => r[0] !== "mbRecalculateAmount").every((r) => r[1] === "✅ Done"),
    () => noSource.map((r) => r.slice(0, 3)));

  // Only the functions a handler reaches count: the call of `contractAmount.recalculateContractAmount` sits in
  // `recalculateAmount`; with the edit below `recalculateAmountOnItemsChange` does not call it, so it is not reached.
  const unreached = edit(formSrc, "await recalculateAmount(request, contractId);", "void contractId;");
  const unreachedRow = rowOf(ctxOf({ [FORM]: unreached, [AMOUNT]: amountSrc }), "mbRecalculateAmount");
  const notDefined = resolveVk(portedVk(`${AMOUNT}.notCalledAnywhere`), ctxOf(both));
  check("module closure: a function of the imported module that no function a handler reaches calls reads ⚠ — also when another module function calls it",
    () => unreachedRow[1] === "⚠ verify" && notDefined[0] === "⚠ verify"
      && [unreachedRow[2], notDefined[1]].every((t) => /is not among the page's `define\(\)` deps, and no function a handler reaches in the modules they import calls/.test(t)),
    () => [unreachedRow, notDefined]);

  // A call the walk reaches is not a definition: FormPageModule calls `contractAmount.notDefinedHere(…)` on the
  // reached path, and with ContractAmountModule filed (it defines no such function) the row reads ⚠; with that
  // module not filed, the call is all there is to read and it holds.
  const callsUndefined = edit(formSrc, "const outcome = await contractAmount.recalculateContractAmount(contractId);",
    "const outcome = await contractAmount.recalculateContractAmount(contractId);\n\t\tawait contractAmount.notDefinedHere(contractId);");
  const undefinedFiled = resolveVk(portedVk(`${AMOUNT}.notDefinedHere`), ctxOf({ [FORM]: callsUndefined, [AMOUNT]: amountSrc }));
  const undefinedUnfiled = resolveVk(portedVk(`${AMOUNT}.notDefinedHere`), ctxOf({ [FORM]: callsUndefined }));
  check("module closure: a function the reached path calls but the filed module does not define reads ⚠; with that module's source not filed the call holds",
    () => undefinedFiled[0] === "⚠ verify" && undefinedUnfiled[0] === "✅ Done",
    () => [undefinedFiled, undefinedUnfiled]);

  // A module's own function is followed when a function of it calls it as `this.fn(…)`, never as `other.fn(…)`.
  const viaThis = edit(formSrc, "await recalculateAmount(request, contractId);", "await this.recalculateAmount(request, contractId);");
  const viaOther = edit(formSrc, "await recalculateAmount(request, contractId);", "await other.recalculateAmount(request, contractId);");
  const thisRow = rowOf(ctxOf({ [FORM]: viaThis, [AMOUNT]: amountSrc }), "mbRecalculateAmount");
  const otherRow = rowOf(ctxOf({ [FORM]: viaOther, [AMOUNT]: amountSrc }), "mbRecalculateAmount");
  check("module closure: a module function called as `this.recalculateAmount(…)` is followed and the row reads ✅; called as `other.recalculateAmount(…)` it is not, and the row reads ⚠",
    () => thisRow[1] === "✅ Done" && otherRow[1] === "⚠ verify",
    () => [thisRow, otherRow]);

  // A `Ported as` function of a module the page DOES import, reached only through that module's own functions, names
  // the module's file when its source is not filed.
  const inDeps = resolveVk(portedVk(`${FORM}.recalculateAmount`), ctxOf({}));
  check("module closure: a Ported-as function of a module in the page's deps, reached only inside that module, reads ⚠ naming `reads/modules/UsrMbContractsV3App_FormPageModule.js` when no source is filed, and ✅ when it is",
    () => inDeps[0] === "⚠ verify" && inDeps[1].includes(`add it as \`reads/modules/${FORM}.js\``)
      && resolveVk(portedVk(`${FORM}.recalculateAmount`), ctxOf(both))[0] === "✅ Done",
    () => inDeps);

  // An import cycle: ContractAmountModule imports FormPageModule back and calls into it. Each `Module.fn` is walked
  // once, so a symbol nothing reaches still answers ⚠, and the recorded chain still closes its row.
  const cyclic = edit(edit(amountSrc, 'define("UsrMbContractsV3App_ContractAmountModule", ["@creatio-devkit/common"], function(sdk) {',
    'define("UsrMbContractsV3App_ContractAmountModule", ["@creatio-devkit/common", "UsrMbContractsV3App_FormPageModule"], function(sdk, contractPage) {'),
  "async function recalculateContractAmount(contractId) {", "async function recalculateContractAmount(contractId) {\n\t\tawait contractPage.recalculateAmountOnItemsChange({});");
  const cycleCtx = ctxOf({ [FORM]: formSrc, [AMOUNT]: cyclic });
  const cycleMiss = resolveVk(portedVk(`${AMOUNT}.notCalledAnywhere`), cycleCtx);
  check("module closure: an import cycle (ContractAmountModule imports FormPageModule back and calls it) ends — an unreached symbol reads ⚠ and every recorded row still reads ✅",
    () => cycleMiss[0] === "⚠ verify" && rows(cycleCtx).every((r) => r[1] === "✅ Done"),
    () => [cycleMiss, rows(cycleCtx).map((r) => r.slice(0, 2))]);

  // The request-fired card action follows the same chain: the Start approval button's handler calls
  // `contractPage.startApproval`, which sends `crt.RunBusinessProcessRequest` itself as recorded; moved into
  // ContractAmountModule, the request is still reached, and without that module's source the row names its file.
  const card = resolveVk(cardVk, ctxOf(both));
  const relayedForm = edit(edit(formSrc, '\t\t\t\ttype: "crt.RunBusinessProcessRequest",', '\t\t\t\ttype: "mb.NotTheProcess",'),
    "\t\tif (!(await canStartApproval($context))) {", "\t\tawait contractAmount.runApproval(request);\n\t\tif (!(await canStartApproval($context))) {");
  const relayedAmount = edit(edit(amountSrc, "\tasync function showMessage(request, message) {",
    '\tasync function runApproval(request) {\n\t\tawait sdk.HandlerChainService.instance.process({type: "crt.RunBusinessProcessRequest", $context: request.$context});\n\t}\n\n\tasync function showMessage(request, message) {'),
  "\t\tshowMessage,\n", "\t\tshowMessage,\n\t\trunApproval,\n");
  const cardTwoDown = resolveVk(cardVk, ctxOf({ [FORM]: relayedForm, [AMOUNT]: relayedAmount }));
  const cardNoAmount = resolveVk(cardVk, ctxOf({ [FORM]: relayedForm }));
  check("module closure: the Run-process card action reads ✅ through the module the page imports and, with the request moved one module down, through the module THAT module imports; without the second module's source it is ⚠ naming its file",
    () => card[0] === "✅ Done" && new RegExp(`calls \`contractPage\\.startApproval\` in module \`${FORM}\`, which sends`).test(card[1])
      && cardTwoDown[0] === "✅ Done" && cardTwoDown[1].includes(`→ \`contractAmount.runApproval\` in module \`${AMOUNT}\`, which sends \`crt.RunBusinessProcessRequest\``)
      && cardNoAmount[0] === "⚠ verify" && cardNoAmount[1].includes(`add it as \`reads/modules/${AMOUNT}.js\``),
    () => [card, cardTwoDown, cardNoAmount]);
}

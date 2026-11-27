// PAGE MODULES THAT RE-EXPORT A SHARED MODULE'S FUNCTION (fixture `mbcontract-v4-recorded`, the get-page reads of the
// delivery-note and return-note pages and of the three client modules behind them). Each page imports only its own
// module; the delivery-note module hands `applyNewNoteDate` on from `UsrMbContractsV4App_SharedModule` by reference
// (`applyNewNoteDate: shared.applyNewNoteDate`), the return-note module calls it from a function of its own. A
// re-export is followed like a call: a `Ported as` row naming the shared function, and a request-fired card action
// whose module function is a re-export, hold through it.
// Imported and run by `run-mapper.mjs`, which hands it its `check`.
import fs from "node:fs";
import path from "node:path";

export function runModuleReexportChecks({ check, verifyCtx, resolveVk, FIX }) {
  const DIR = path.join(FIX, "mbcontract-v4-recorded");
  const DELIVERY = "UsrMbContractsV4App_MbDeliveryNoteFormPageModule";
  const RETURN = "UsrMbContractsV4App_MbReturnNoteFormPageModule";
  const SHARED = "UsrMbContractsV4App_SharedModule";
  const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
  const src = Object.fromEntries([DELIVERY, RETURN, SHARED].map((m) => [m, read(`modules/${m}.js`)]));
  const expected = JSON.parse(read("expected.json")).pages;
  const bundles = Object.fromEntries(Object.entries(expected).map(([key, p]) => [key, JSON.parse(read(p.bundle))]));
  const entryOf = (key, extra = {}) => {
    const b = bundles[key];
    return { schemaName: b.name, parentSchemaName: "PageWithTabsFreedomTemplate", viewConfig: b.viewConfig, handlers: b.handlers,
      deps: b.deps, args: b.args, validators: b.validators, converters: b.converters, ...extra };
  };
  const DN = "child:MbDeliveryNote";
  const RN = "child:MbReturnNote";
  const ctxOf = (key, modules, extra) => verifyCtx({ pages: { [key]: entryOf(key, extra) }, modules }, key);
  const handlerVk = (h) => ({ type: "handler", method: h.method, parent: h.parent, triggers: [], portedAs: h.portedAs });
  const rowOf = (key, ctx) => resolveVk(handlerVk(expected[key].handlers[0]), ctx);
  const portedVk = (...portedAs) => ({ type: "handler", method: "mbProbe", parent: null, triggers: [], portedAs });
  const edit = (text, from, to) => {
    if (!text.includes(from)) throw new Error(`fixture edit: \`${from.slice(0, 60)}\` is not in the source`);
    return text.replace(from, to);
  };
  const withDelivery = (deliverySrc) => ({ ...src, [DELIVERY]: deliverySrc });
  const RECORDED = "applyNewNoteDate: shared.applyNewNoteDate,";

  // As recorded: both pages' `onEntityInitialized` rows name `SharedModule.applyNewNoteDate`, which the delivery-note
  // page reaches only through its module's re-export, the return-note page through a call in its module.
  const dn = rowOf(DN, ctxOf(DN, src));
  const rn = rowOf(RN, ctxOf(RN, src));
  check("module re-exports (recorded v4): the delivery-note row naming `SharedModule.applyNewNoteDate` reads ✅ through the page module's re-export `applyNewNoteDate: shared.applyNewNoteDate`, and the return-note row through its module's call",
    () => dn[0] === "✅ Done" && rn[0] === "✅ Done"
      && dn[1].includes(`\`deliveryNotePage.applyNewNoteDate\` in module \`${DELIVERY}\` → \`shared.applyNewNoteDate\` in module \`${SHARED}\``),
    () => [dn, rn]);

  // The re-export is read from the module that holds it: without the delivery-note module's source the row names that
  // file; a re-export of a function the filed shared module does not define is not a port.
  const noModule = rowOf(DN, ctxOf(DN, { [SHARED]: src[SHARED] }));
  const reexportsMissing = edit(src[DELIVERY], RECORDED, RECORDED + "\n\t\tnotDefinedHere: shared.notDefinedHere,");
  const undefinedShared = resolveVk(portedVk(`${SHARED}.notDefinedHere`),
    ctxOf(DN, withDelivery(reexportsMissing), { handlers: edit(entryOf(DN).handlers, "deliveryNotePage.applyNewNoteDate(", "deliveryNotePage.notDefinedHere(") }));
  check("module re-exports: without the page module's source the row reads ⚠ naming `reads/modules/UsrMbContractsV4App_MbDeliveryNoteFormPageModule.js`; a re-export of a function the filed shared module does not define reads ⚠",
    () => noModule[0] === "⚠ verify" && noModule[1].includes(`add it as \`reads/modules/${DELIVERY}.js\``) && undefinedShared[0] === "⚠ verify",
    () => [noModule, undefinedShared]);

  // Every spelling of a re-export is followed; a member of something that is not an import is not.
  const ANCHOR = 'const NOTE_ENTITY = "MbDeliveryNote";';
  const exportedAs = (decl) => edit(edit(src[DELIVERY], RECORDED, "applyNewNoteDate,"), ANCHOR, `${ANCHOR}\n\t${decl}`);
  const sources = [exportedAs("const applyNewNoteDate = shared.applyNewNoteDate;"), exportedAs("const { applyNewNoteDate } = shared;"),
    edit(src[DELIVERY], RECORDED, "applyNewNoteDate: other.applyNewNoteDate,"), exportedAs("const { applyNewNoteDate } = other;")];
  const shapes = sources.map((s) => rowOf(DN, ctxOf(DN, withDelivery(s)))[0]);
  check("module re-exports: `const applyNewNoteDate = shared.applyNewNoteDate` and `const { applyNewNoteDate } = shared` exported by name read ✅; the same taken off `other` (no import of that name) reads ⚠",
    () => shapes.join() === ["✅ Done", "✅ Done", "⚠ verify", "⚠ verify"].join(),
    () => shapes);

  // The request-fired check follows a re-export too: the Post button fires `mb.MbPostButtonClicked`, whose handler is
  // pointed at `deliveryNotePage.startApproval`, a re-export of the shared `startApprovalProcess`, which sends
  // `crt.RunBusinessProcessRequest`. Without the re-export the module has no `startApproval` and the row stays open.
  const cardVk = { type: "card", request: "crt.RunBusinessProcessRequest" };
  const handlers = edit(entryOf(DN).handlers, "deliveryNotePage.postDeliveryNote(request)", "deliveryNotePage.startApproval(request)");
  const exporting = edit(src[DELIVERY], "\t\tpostDeliveryNote\n", "\t\tpostDeliveryNote,\n\t\tstartApproval: shared.startApprovalProcess\n");
  const relayed = resolveVk(cardVk, ctxOf(DN, withDelivery(exporting), { handlers }));
  const notExported = resolveVk(cardVk, ctxOf(DN, src, { handlers }));
  check("module re-exports: a Run-process card action reads ✅ through a page-module re-export of the shared function that sends `crt.RunBusinessProcessRequest`, and ⚠ when the module does not export it",
    () => relayed[0] === "✅ Done" && relayed[1].includes(`→ \`shared.startApprovalProcess\` in module \`${SHARED}\`, which sends \`crt.RunBusinessProcessRequest\``)
      && notExported[0] === "⚠ verify",
    () => [relayed, notExported]);
}

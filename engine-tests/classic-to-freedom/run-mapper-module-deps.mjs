// A PAGE THAT HANDS ITS LOGIC TO A CLIENT MODULE. Recorded, not synthesized: the MbContract v2 benchmark ported
// every Classic method of its form page into `UsrMbContractsV2App_FormPageModule`, and the page's handlers only
// route there through the name its `define()` factory gives the module (`contractPage.refreshCanEditFields(…)`).
// `--verify` left 8 handler rows and the Start approval card action unconfirmed on that page. The handler rows
// failed because the recorded `deps` is get-page's SOURCE text, not an array, and the payload dropped
// `args`, so no `contractPage.fn(…)` call could be read as the module's. The card action failed because the button
// fires a page request whose handler calls the module, and the module sends `crt.RunBusinessProcessRequest`.
// Imported and run by `run-mapper.mjs`, which hands it its `check` so the tally stays one number.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleBuilt, MODULES_DIR } from "../../skills/classic-to-freedom-migration/engine/assemble.mjs";

export function runModuleDepChecks({ check, verifyCtx, resolveVk, FIX }) {
  const DIR = path.join(FIX, "mbcontract-v2-recorded");
  const MODULE = "UsrMbContractsV2App_FormPageModule";
  const bundle = JSON.parse(fs.readFileSync(path.join(DIR, "bundle-main.json"), "utf8"));
  const moduleSrc = fs.readFileSync(path.join(DIR, MODULES_DIR, `${MODULE}.js`), "utf8");
  const expected = JSON.parse(fs.readFileSync(path.join(DIR, "expected.json"), "utf8"));
  const page = (extra = {}) => ({ schemaName: bundle.name, parentSchemaName: "PageWithTopAreaAndTabsFreedomTemplate",
    viewConfig: bundle.viewConfig, handlers: bundle.handlers, deps: bundle.deps, validators: bundle.validators, converters: bundle.converters, ...extra });
  const handlerVks = expected.handlers.map((h) => ({ type: "handler", method: h.method, parent: h.parent, triggers: [], portedAs: h.portedAs }));
  const cardVk = { type: "card", request: expected.cardActions[0].request };
  const rows = (ctx) => handlerVks.map((vk) => [vk.method, ...resolveVk(vk, ctx)]);

  // The page entry as the run recorded it: `deps` as source text, no `args`.
  const recorded = rows(verifyCtx({ pages: { main: page() } }, "main"));
  check("module deps (recorded v2): `deps` given as get-page's source text is read as the page's `define()` deps — no row says the entry carries no `deps`; without `args` each row names the missing `args` instead of crediting a call it cannot read",
    () => recorded.every((r) => r[1] === "⚠ verify" && !/carries no `deps`/.test(r[2]) && /carries no `args`/.test(r[2])),
    () => recorded.map((r) => r.slice(0, 3)));

  // The same page with get-page's `args`: every `Ported as` record names a module function the page calls through
  // `contractPage`, so all eight rows close.
  const ctx = verifyCtx({ pages: { main: page({ args: bundle.args }) }, modules: { [MODULE]: moduleSrc } }, "main");
  const withArgs = rows(ctx);
  check(`module deps (recorded v2): with get-page's \`args\` (\`${bundle.args}\`) all ${handlerVks.length} handler rows whose \`Ported as\` names \`${MODULE}.<fn>\` read ✅, each through the page's \`contractPage.<fn>(…)\` call`,
    () => withArgs.length === 8 && withArgs.every((r) => r[1] === "✅ Done" && /calls `contractPage\.\w+` \(`contractPage` is module `UsrMbContractsV2App_FormPageModule` in the page's `define\(\)`\)/.test(r[2])),
    () => withArgs.map((r) => r.slice(0, 3)));

  // The alias is the page's own: a name the factory gives another dependency, or a call of a function the module
  // does not hand the page under that alias, does not stand in for it.
  const otherAlias = verifyCtx({ pages: { main: page({ deps: '["@creatio-devkit/common", "UsrMbContractsV2App_FormPageModule"]', args: "(contractPage, mod)" }) } }, "main");
  const unknownFn = resolveVk({ type: "handler", method: "mbNothing", parent: null, triggers: [], portedAs: [`${MODULE}.notCalledAnywhere`] }, ctx);
  check("module deps: a call through the name the factory gives ANOTHER dependency does not close the row, and a module function no handler calls reads ⚠ naming both spellings it looked for",
    () => rows(otherAlias).every((r) => r[1] === "⚠ verify" && /or `mod\.\w+`/.test(r[2]))
      && unknownFn[0] === "⚠ verify" && /no handler calls `UsrMbContractsV2App_FormPageModule\.notCalledAnywhere` or `contractPage\.notCalledAnywhere`/.test(unknownFn[1]),
    () => [rows(otherAlias).slice(0, 2), unknownFn]);

  // The Start approval card action: `MbStartApprovalButton` fires `mb.MbStartApprovalButtonClicked`, whose handler
  // calls `contractPage.startApproval(request)`, and the module sends `crt.RunBusinessProcessRequest`.
  const card = resolveVk(cardVk, ctx);
  const cardNoModule = resolveVk(cardVk, verifyCtx({ pages: { main: page({ args: bundle.args }) } }, "main"));
  const cardNoSend = resolveVk(cardVk, verifyCtx({ pages: { main: page({ args: bundle.args }) },
    modules: { [MODULE]: moduleSrc.replaceAll("crt.RunBusinessProcessRequest", "crt.ShowDialogRequest") } }, "main"));
  check("module deps (recorded v2): the Start approval card action reads ✅ through the button's request, its handler and the module that sends `crt.RunBusinessProcessRequest`; without the module's source it reads ⚠ naming the file to add, and a module that does not send it closes nothing",
    () => card[0] === "✅ Done" && /`MbStartApprovalButton` fires `mb\.MbStartApprovalButtonClicked`, whose handler calls module `UsrMbContractsV2App_FormPageModule` \(`contractPage\.…`\), which sends `crt\.RunBusinessProcessRequest`/.test(card[1])
      && cardNoModule[0] === "⚠ verify" && /add it as `modules\/UsrMbContractsV2App_FormPageModule\.js`/.test(cardNoModule[1])
      && cardNoSend[0] === "⚠ verify" && !/add it as/.test(cardNoSend[1]),
    () => [card, cardNoModule, cardNoSend]);

  // A request named only in a comment of the module, or a handler that sends the request itself.
  const commented = moduleSrc.replaceAll('type: "crt.RunBusinessProcessRequest"', '// type: "crt.RunBusinessProcessRequest"\n\t\t\ttype: "crt.ShowDialogRequest"');
  const cardCommented = resolveVk(cardVk, verifyCtx({ pages: { main: page({ args: bundle.args }) }, modules: { [MODULE]: commented } }, "main"));
  const direct = page({ args: bundle.args, handlers: `[{ request: "mb.MbStartApprovalButtonClicked", handler: async (request, next) => {
      await request.$context.executeRequest({ type: "crt.RunBusinessProcessRequest", processName: "X", $context: request.$context });
      return next?.handle(request); } }]` });
  const cardDirect = resolveVk(cardVk, verifyCtx({ pages: { main: direct } }, "main"));
  check("module deps: a module that names the request only in a comment does not close the card action; a page handler that sends it itself does",
    () => cardCommented[0] === "⚠ verify" && cardDirect[0] === "✅ Done" && /whose handler sends `crt\.RunBusinessProcessRequest`/.test(cardDirect[1]),
    () => [cardCommented, cardDirect]);

  // The real payload path: get-page's bundle.json and the module's body.js -> assembleBuilt -> --verify.
  const asDir = fs.mkdtempSync(path.join(os.tmpdir(), "module-deps-assemble-"));
  try {
    const w = (f, v) => fs.writeFileSync(path.join(asDir, f), typeof v === "string" ? v : JSON.stringify(v));
    fs.mkdirSync(path.join(asDir, "reads"));
    fs.mkdirSync(path.join(asDir, MODULES_DIR));
    w("reads/index.json", { version: 1, reads: [{ kind: "pageMeta", file: "reads/01-meta-main.json", pageKey: "main", what: "m" },
      { kind: "pageBundle", file: "reads/02-bundle-main.json", pageKey: "main", what: "b" }] });
    w("reads/01-meta-main.json", { page: { schemaName: bundle.name, schemaUId: "3f6db941-1842-4c82-8342-db2649fb6242", packageName: "UsrMbContractsV2App", parentSchemaName: "PageWithTopAreaAndTabsFreedomTemplate" } });
    w("reads/02-bundle-main.json", bundle);
    w(`${MODULES_DIR}/${MODULE}.js`, moduleSrc);
    w(`${MODULES_DIR}/__proto__.js`, "define('x', [], function() { return {}; });");
    w(`${MODULES_DIR}/notes.txt`, "not a module");
    const { built, problems } = assembleBuilt(asDir);
    const vctx = verifyCtx(built, "main");
    check("module deps via assembleBuilt: the bundle's `args` reach built.json, `modules/<schema>.js` becomes `built.modules` (an unsafe key or a non-.js file is skipped), and the recorded page then closes every handler row and the card action",
      () => built.pages.main.args === bundle.args && Object.keys(built.modules || {}).join() === MODULE && !problems.length
        && rows(vctx).every((r) => r[1] === "✅ Done") && resolveVk(cardVk, vctx)[0] === "✅ Done",
      () => ({ args: built.pages?.main?.args, modules: Object.keys(built.modules || {}), problems, rows: rows(vctx).map((r) => r.slice(0, 2)) }));
  } finally { fs.rmSync(asDir, { recursive: true, force: true }); }
}

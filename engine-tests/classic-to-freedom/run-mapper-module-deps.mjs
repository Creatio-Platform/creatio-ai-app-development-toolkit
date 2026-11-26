// PAGES THAT HAND THEIR LOGIC TO A CLIENT MODULE (fixture `mbcontract-v2-recorded`, get-page reads of five pages).
// Each page's handlers only route into a module through the name its `define()` factory gives it
// (`contractPage.refreshCanEditFields(…)`), and `deps` is get-page's SOURCE text. A `Ported as: Module.fn` handler row
// holds through that name when the payload carries `args`; a Run-process card action holds when a built element fires
// a custom page request whose handler calls the module function that sends `crt.RunBusinessProcessRequest`.
// Imported and run by `run-mapper.mjs`, which hands it its `check`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleBuilt } from "../../skills/classic-to-freedom-migration/engine/assemble.mjs";
import { READS_DIR, MODULES_DIR } from "../../skills/classic-to-freedom-migration/engine/reads.mjs";
import { bundleArgs } from "../../skills/classic-to-freedom-migration/engine/conventions.mjs";

export function runModuleDepChecks({ check, verifyCtx, resolveVk, FIX }) {
  const DIR = path.join(FIX, "mbcontract-v2-recorded");
  const MODULE = "UsrMbContractsV2App_FormPageModule";
  const moduleSrc = fs.readFileSync(path.join(DIR, MODULES_DIR, `${MODULE}.js`), "utf8");
  const expected = JSON.parse(fs.readFileSync(path.join(DIR, "expected.json"), "utf8")).pages;
  const bundles = Object.fromEntries(Object.entries(expected).map(([k, p]) => [k, JSON.parse(fs.readFileSync(path.join(DIR, p.bundle), "utf8"))]));
  const bundle = bundles.main;
  // A page entry as the bundle gives it; `withArgs: false` is the shape the run recorded (no `args`).
  const entryOf = (b, extra = {}, withArgs = true) => ({ schemaName: b.name, parentSchemaName: "PageWithTabsFreedomTemplate",
    viewConfig: b.viewConfig, handlers: b.handlers, deps: b.deps, validators: b.validators, converters: b.converters,
    ...(withArgs ? { args: b.args } : {}), ...extra });
  const page = (extra = {}) => entryOf(bundle, extra, false);
  const handlerVk = (h) => ({ type: "handler", method: h.method, parent: h.parent, triggers: [], portedAs: h.portedAs });
  const handlerVks = expected.main.handlers.map(handlerVk);
  const cardVk = { type: "card", request: expected.main.cardActions[0].request };
  const rows = (ctx, vks = handlerVks) => vks.map((vk) => [vk.method, ...resolveVk(vk, ctx)]);
  const allPages = (withArgs) => Object.fromEntries(Object.entries(bundles).map(([k, b]) => [k, entryOf(b, {}, withArgs)]));
  const everyRow = (root) => Object.entries(expected).flatMap(([k, p]) => rows(verifyCtx(root, k), p.handlers.map(handlerVk)).map((r) => [k, ...r]));

  // The pages as the run recorded them: `deps` as source text, no `args`.
  const recorded = everyRow({ pages: allPages(false) });
  check("module deps (recorded v2): on all five pages `deps` given as get-page's source text is read as the page's `define()` deps — no row says the entry carries no `deps`; without `args` each of the 13 rows names the missing `args` instead of crediting a call it cannot read",
    () => recorded.length === 13 && recorded.every((r) => r[2] === "⚠ verify" && !/carries no `deps`/.test(r[3]) && /carries no `args`/.test(r[3])),
    () => recorded.map((r) => r.slice(0, 4)));

  // With get-page's `args`: every `Ported as` record names a module function its page calls through the factory's
  // name for the module, so all 13 rows close — the form page through `contractPage`, the list through `listPage`,
  // the item mini page through `itemPage`, the two note pages through `mbDocumentTotals` beside `@creatio-devkit/common`.
  const withArgs = everyRow({ pages: allPages(true) });
  check("module deps (recorded v2): with get-page's `args` all 13 handler rows across the five pages read ✅, each through its page's own name for the module",
    () => withArgs.length === 13 && withArgs.every((r) => r[2] === "✅ Done")
      && ["contractPage", "listPage", "itemPage", "mbDocumentTotals"].every((a) => withArgs.some((r) => r[3].includes(`calls \`${a}.`))),
    () => withArgs.map((r) => r.slice(0, 4)));
  const ctx = verifyCtx({ pages: { main: entryOf(bundle) }, modules: { [MODULE]: moduleSrc } }, "main");
  check(`module deps (recorded v2): the form page's ${handlerVks.length} rows say which call closed them — \`contractPage.<fn>\`, named as module \`${MODULE}\``,
    () => rows(ctx).every((r) => /calls `contractPage\.\w+` \(`contractPage` is module `UsrMbContractsV2App_FormPageModule` in the page's `define\(\)`\)/.test(r[2])),
    () => rows(ctx).map((r) => r.slice(0, 3)));

  // The alias is the page's own: a name the factory gives another dependency, or a module function no handler calls,
  // does not stand in for it.
  const otherAlias = verifyCtx({ pages: { main: page({ deps: '["@creatio-devkit/common", "UsrMbContractsV2App_FormPageModule"]', args: "(contractPage, mod)" }) } }, "main");
  const unknownFn = resolveVk({ type: "handler", method: "mbNothing", parent: null, triggers: [], portedAs: [`${MODULE}.notCalledAnywhere`] }, ctx);
  check("module deps: a call through the name the factory gives ANOTHER dependency does not close the row, and a module function no handler calls reads ⚠ naming both spellings it looked for",
    () => rows(otherAlias).every((r) => r[1] === "⚠ verify" && /or `mod\.\w+`/.test(r[2]))
      && unknownFn[0] === "⚠ verify" && /no handler calls `UsrMbContractsV2App_FormPageModule\.notCalledAnywhere` or `contractPage\.notCalledAnywhere`/.test(unknownFn[1]),
    () => [rows(otherAlias).slice(0, 2), unknownFn]);

  // `args` is parsed as a parameter list: a destructured or defaulted parameter that holds a comma is still one slot,
  // so the names stay paired with their deps.
  const parsed = [bundleArgs({ args: "({ sdk, http }, xPage)" }), bundleArgs({ args: "(sdk = { a: 1, b: 2 }, xPage)" }),
    bundleArgs({ args: "(contractPage)" }), bundleArgs({ args: "()" }), bundleArgs({ args: "(a, " }), bundleArgs({ args: ["sdk", "x-y"] })];
  check("module deps: `args` is parsed, not split on commas — `({ sdk, http }, xPage)` and `(sdk = { a: 1, b: 2 }, xPage)` keep `xPage` in the second slot; a list that does not parse is null, an array slot that is no identifier is null",
    () => JSON.stringify(parsed) === JSON.stringify([[null, "xPage"], ["sdk", "xPage"], ["contractPage"], [], null, ["sdk", null]]),
    () => parsed);

  // The Start approval card action: `MbStartApprovalButton` fires `mb.MbStartApprovalButtonClicked`, whose handler
  // calls `contractPage.startApproval(request)`, and that module function sends `crt.RunBusinessProcessRequest`.
  const card = resolveVk(cardVk, ctx);
  const cardNoModule = resolveVk(cardVk, verifyCtx({ pages: { main: entryOf(bundle) } }, "main"));
  const cardNoSend = resolveVk(cardVk, verifyCtx({ pages: { main: entryOf(bundle) },
    modules: { [MODULE]: moduleSrc.replaceAll("crt.RunBusinessProcessRequest", "crt.ShowDialogRequest") } }, "main"));
  check("module deps (recorded v2): the Start approval card action reads ✅ through the button's request, its handler and the module function it calls, which sends `crt.RunBusinessProcessRequest`; without the module's source it reads ⚠ naming the file to add, and a module that does not send it closes nothing",
    () => card[0] === "✅ Done" && /`MbStartApprovalButton` fires `mb\.MbStartApprovalButtonClicked`, whose handler calls `contractPage\.startApproval` in module `UsrMbContractsV2App_FormPageModule`, which sends `crt\.RunBusinessProcessRequest`/.test(card[1])
      && cardNoModule[0] === "⚠ verify" && /add it as `reads\/modules\/UsrMbContractsV2App_FormPageModule\.js`/.test(cardNoModule[1])
      && cardNoSend[0] === "⚠ verify" && !/add it as/.test(cardNoSend[1]),
    () => [card, cardNoModule, cardNoSend]);

  // Scoped to what the handler calls. A module that sends the request from a function the button's handler never
  // reaches does not close the row; one that sends it from a helper the called function calls does.
  const MOD = "UsrX_FormPageModule";
  const xModule = `define("${MOD}", ["@creatio-devkit/common"], function(sdk) {
    function runApproval($context) { return $context.executeRequest({ type: "crt.RunBusinessProcessRequest", processName: "Approve" }); }
    async function startApproval(request) { await runApproval(request.$context); }
    const otherProcess = async (request) => request.$context.executeRequest({ type: "crt.RunBusinessProcessRequest", processName: "Other" });
    function refresh(request) { return request; }
    return { startApproval, otherProcess, refresh: refresh };
  });`;
  const xPage = (call) => ({ schemaName: "UsrX_FormPage", parentSchemaName: "PageWithTabsFreedomTemplate",
    viewConfig: [{ type: "crt.Button", name: "StartBtn", clicked: { request: "usr.StartClicked" } }],
    handlers: `[{ request: "usr.StartClicked", handler: async (request, next) => { const m = new sdk.Model(); ${call}; return next?.handle(request); } }]`,
    deps: '["@creatio-devkit/common", "UsrX_FormPageModule"]', args: "(sdk, xPage)" });
  const via = (call, modules = null) => resolveVk(cardVk, verifyCtx({ pages: { main: xPage(call) }, modules: modules ?? { [MOD]: xModule } }, "main"));
  const viaHelper = via("await xPage.startApproval(request)");
  const viaOther = via("await xPage.refresh(request)");
  const viaExport = via("await xPage.otherProcess(request)");
  const noSource = via("await xPage.refresh(request)", {});
  check("module deps: only the module functions the handler calls count — `startApproval` closes the row through the helper it calls, `refresh` does not although the module sends the request elsewhere; a call through the platform's `sdk` is never named as a module file to add",
    () => viaHelper[0] === "✅ Done" && /calls `xPage\.startApproval` in module `UsrX_FormPageModule`/.test(viaHelper[1])
      && viaOther[0] === "⚠ verify" && viaExport[0] === "✅ Done"
      && noSource[0] === "⚠ verify" && /add it as `reads\/modules\/UsrX_FormPageModule\.js`/.test(noSource[1]) && !/@creatio-devkit/.test(noSource[1]),
    () => [viaHelper, viaOther, viaExport, noSource]);

  // The Save button fires `crt.SaveRecordRequest`, and the page's Save handler calls `contractPage.refreshStartApprovalEnabled`.
  // A platform request's page handler is a hook around the platform's action, never this action's dispatcher: with
  // the Start approval button gone the row is ⚠, also when that hook's module function sends the request.
  const withoutButton = (n) => {
    if (Array.isArray(n)) return n.filter((x) => x?.name !== "MbStartApprovalButton").map(withoutButton);
    return n && typeof n === "object" ? Object.fromEntries(Object.entries(n).map(([k, v]) => [k, withoutButton(v)])) : n;
  };
  const noButton = entryOf(bundle, { viewConfig: withoutButton(bundle.viewConfig) });
  const cardNoButton = resolveVk(cardVk, verifyCtx({ pages: { main: noButton }, modules: { [MODULE]: moduleSrc } }, "main"));
  const hookSends = moduleSrc.replace("async function refreshStartApprovalEnabled", "async function refreshStartApprovalEnabledUnused")
    .replace("async function startApproval", "async function refreshStartApprovalEnabled");
  const cardHookSends = resolveVk(cardVk, verifyCtx({ pages: { main: noButton }, modules: { [MODULE]: hookSends } }, "main"));
  check("module deps (recorded v2): without the Start approval button the Run-process card action reads ⚠ — the Save button fires `crt.SaveRecordRequest` and its page handler is never credited, not even when the module function it calls sends `crt.RunBusinessProcessRequest`",
    () => JSON.stringify(noButton.viewConfig).includes("crt.SaveRecordRequest") && !JSON.stringify(noButton.viewConfig).includes("MbStartApprovalButton")
      && hookSends !== moduleSrc && cardNoButton[0] === "⚠ verify" && cardHookSends[0] === "⚠ verify" && !/SaveRecordRequest/.test(cardHookSends[1]),
    () => [cardNoButton, cardHookSends]);

  // The alias spelling: a call of `contractPage` as a member of something else, in a comment, or only in a string
  // does not close a handler row, and a member call of it does not close the card action either.
  const CALL = "await contractPage.updateCanEditFields(request.$context, request.value);";
  const onlyAs = (shape) => rows(verifyCtx({ pages: { main: entryOf(bundle, { handlers: bundle.handlers.replace(CALL, shape) }) } }, "main"))
    .find((r) => r[0] === "mbOnStatusChanged");
  const asCall = onlyAs(CALL);
  const notACall = ["await other.contractPage.updateCanEditFields(request.$context, request.value);",
    "// " + CALL, 'const s = "contractPage.updateCanEditFields()"; void (request.$context, request.value);'].map(onlyAs);
  const relayMember = resolveVk(cardVk, verifyCtx({ pages: { main: entryOf(bundle, { handlers: bundle.handlers.replace("await contractPage.startApproval(request)", "await foo.contractPage.startApproval(request)") }) },
    modules: { [MODULE]: moduleSrc } }, "main"));
  check("module deps: a row whose only call is `other.contractPage.fn(…)`, a commented `// contractPage.fn(…)` or a string \"contractPage.fn(…)\" reads ⚠, and `foo.contractPage.startApproval(…)` does not close the card action",
    () => bundle.handlers.split(CALL).length === 2 && asCall[1] === "✅ Done" && notACall.every((r) => r[1] === "⚠ verify") && relayMember[0] === "⚠ verify",
    () => [asCall, notACall, relayMember]);

  // Aliases pair with deps by position: a deps slot that is no string keeps its place, so the parameter after it
  // still names the module after it.
  const shifted = verifyCtx({ pages: { main: entryOf(bundle, { deps: '[someVariable, "UsrMbContractsV2App_FormPageModule"]', args: "(first, contractPage)" }) } }, "main");
  const shiftedArray = verifyCtx({ pages: { main: entryOf(bundle, { deps: [null, "UsrMbContractsV2App_FormPageModule"], args: "(first, contractPage)" }) } }, "main");
  check("module deps: a deps slot that is no string literal keeps its position — `contractPage` still names the module after it, so every handler row reads ✅",
    () => [shifted, shiftedArray].every((c) => c.aliases.get(MODULE) === "contractPage" && rows(c).every((r) => r[1] === "✅ Done")),
    () => [[...shifted.aliases], [...shiftedArray.aliases]]);

  // A request named only in a comment of the module, or a handler that sends the request itself.
  const commented = moduleSrc.replaceAll('type: "crt.RunBusinessProcessRequest"', '// type: "crt.RunBusinessProcessRequest"\n\t\t\ttype: "crt.ShowDialogRequest"');
  const cardCommented = resolveVk(cardVk, verifyCtx({ pages: { main: entryOf(bundle) }, modules: { [MODULE]: commented } }, "main"));
  const direct = entryOf(bundle, { handlers: `[{ request: "mb.MbStartApprovalButtonClicked", handler: async (request, next) => {
      await request.$context.executeRequest({ type: "crt.RunBusinessProcessRequest", processName: "X", $context: request.$context });
      return next?.handle(request); } }]` });
  const cardDirect = resolveVk(cardVk, verifyCtx({ pages: { main: direct } }, "main"));
  check("module deps: a module that names the request only in a comment does not close the card action; a page handler that sends it itself does",
    () => cardCommented[0] === "⚠ verify" && cardDirect[0] === "✅ Done" && /whose handler sends `crt\.RunBusinessProcessRequest`/.test(cardDirect[1]),
    () => [cardCommented, cardDirect]);

  // The real payload path: get-page's bundle.json and the module's body.js -> assembleBuilt -> --verify.
  const assembled = (setup) => {
    const asDir = fs.mkdtempSync(path.join(os.tmpdir(), "module-deps-assemble-"));
    try {
      const w = (f, v) => fs.writeFileSync(path.join(asDir, f), typeof v === "string" ? v : JSON.stringify(v));
      fs.mkdirSync(path.join(asDir, "reads"));
      w("reads/index.json", { version: 1, reads: [{ kind: "pageMeta", file: "reads/01-meta-main.json", pageKey: "main", what: "m" },
        { kind: "pageBundle", file: "reads/02-bundle-main.json", pageKey: "main", what: "b" }] });
      w("reads/01-meta-main.json", { page: { schemaName: bundle.name, schemaUId: "3f6db941-1842-4c82-8342-db2649fb6242", packageName: "UsrMbContractsV2App", parentSchemaName: "PageWithTopAreaAndTabsFreedomTemplate" } });
      w("reads/02-bundle-main.json", bundle);
      setup(w, asDir);
      return assembleBuilt(asDir);
    } finally { fs.rmSync(asDir, { recursive: true, force: true }); }
  };
  const MOD_DIR = `${READS_DIR}/${MODULES_DIR}`;
  const full = assembled((w, dir) => {
    fs.mkdirSync(path.join(dir, READS_DIR, MODULES_DIR));
    w(`${MOD_DIR}/${MODULE}.js`, moduleSrc);
    w(`${MOD_DIR}/__proto__.js`, "define('x', [], function() { return {}; });");
    w(`${MOD_DIR}/notes.txt`, "not a module");
  });
  const vctx = verifyCtx(full.built, "main");
  check("module deps via assembleBuilt: the bundle's `args` reach built.json, `reads/modules/<Module>.js` becomes `built.modules` (an unsafe key or a non-.js file is skipped), and the recorded page then closes every handler row and the card action",
    () => full.built.pages.main.args === bundle.args && Object.keys(full.built.modules || {}).join() === MODULE && !full.problems.length
      && rows(vctx).every((r) => r[1] === "✅ Done") && resolveVk(cardVk, vctx)[0] === "✅ Done",
    () => ({ args: full.built.pages?.main?.args, modules: Object.keys(full.built.modules || {}), problems: full.problems }));

  // A read-back that filed no module body is no read problem: the card action stays open and names the file to add.
  // `reads/modules` as a FILE is a problem and an answer, never a crash.
  const uncopied = assembled(() => {});
  const uncopiedCard = uncopied.built && resolveVk(cardVk, verifyCtx(uncopied.built, "main"));
  const asFile = assembled((w) => w(MOD_DIR, "not a folder"));
  check("module deps via assembleBuilt: with no module body filed the Run-process card action reads ⚠ naming `reads/modules/<Module>.js` (not a read problem); `reads/modules` that is a file is a problem, not a crash",
    () => !uncopied.problems.length && !uncopied.built.modules && uncopiedCard[0] === "⚠ verify"
      && /`reads\/modules\/UsrMbContractsV2App_FormPageModule\.js`/.test(uncopiedCard[1])
      && asFile.built && asFile.problems.some((p) => p.file === MOD_DIR && /not readable as a folder/.test(p.why)),
    () => ({ uncopied: [uncopied.problems, uncopiedCard], asFile: asFile.problems }));
}

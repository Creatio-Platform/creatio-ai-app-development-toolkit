// CODE QUALITY of the built pages. A customer counted by hand what the migration had built: a 391-line save handler
// with 20 functions inside, one helper pasted 8 times, record ids its constants module already held, catch blocks
// that only logged, plan codes in comments. These checks hold the `--verify` Code quality rows that measure it: each
// rule fires on a synthetic page that breaks it and stays silent on its clean counterpart, the thresholds come from
// the manifest, and the rows reach the verify table through the real payload path.
// Imported and run by `run-mapper.mjs`, which hands it its `check` and the shared fixtures so the tally stays one number.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lintPageQuality, lintModuleQuality, lintRunQuality, qualityThresholdsOf, QUALITY_RULES, QUALITY_ROW_RULES, DEFAULT_QUALITY_THRESHOLDS }
  from "../../skills/classic-to-freedom-migration/engine/quality.mjs";
import { verifyRowKey, checklistGroups } from "../../skills/classic-to-freedom-migration/engine/designspec.mjs";
import { assembleBuilt } from "../../skills/classic-to-freedom-migration/engine/assemble.mjs";

const R = QUALITY_RULES;
const handler = (request, body) => `{ request: "${request}", handler: async (request, next) => {\n${body}\nreturn next?.handle(request);\n} }`;
const lines = (n) => Array.from({ length: n }, (_, i) => `const v${i} = ${i};`).join("\n");
const rulesOf = (page) => page.findings.filter((f) => !f.advisory).map((f) => f.rule);
const count = (page, rule) => page.findings.filter((f) => f.rule === rule).length;

// One synthetic page per rule: the defect, and the same page written the way the rule wants it.
const CASES = [
  { rule: R.functionTooLong, bad: handler("usr.Long", lines(61)), good: handler("usr.Long", lines(20)) },
  { rule: R.nestedFunctions,
    bad: handler("usr.Nested", "const a = () => 1; const b = () => 2; function c() { return 3; } const d = function() { return 4; };"),
    good: handler("usr.Nested", "const a = () => 1; const b = () => 2; const c = () => 3; [1].map((x) => x).filter(function(x) { return x; });") },
  { rule: R.duplicateInPage,
    bad: `${handler("usr.A", "const idOf = (v) => v && v.value ? v.value : v; idOf(1);")}, ${handler("usr.B", "const lookupId = (v) => v && v.value ? v.value : v; lookupId(2);")}`,
    good: `${handler("usr.A", "const idOf = (v) => v && v.value ? v.value : v; idOf(1);")}, ${handler("usr.B", "const nameOf = (v) => v && v.displayValue ? v.displayValue : v; nameOf(2);")}` },
  { rule: R.catchLogOnly, bad: handler("usr.Save", "try { await request.$context.save(); } catch (e) { console.error(e); }"),
    good: handler("usr.Save", "try { await request.$context.save(); } catch (e) { console.error(e); throw e; }") },
  { rule: R.numericComparisonType, bad: handler("usr.Filter", "const f = { comparisonType: 3 };"),
    good: handler("usr.Filter", "const f = { comparisonType: sdk.ComparisonType.Equal };") },
  { rule: R.sequentialAwaits, bad: handler("usr.Init", "const a = await m1.load(); const b = await m2.load(); const c = await m3.load();"),
    good: handler("usr.Init", "const [a, b, c] = await Promise.all([m1.load(), m2.load(), m3.load()]);") },
  { rule: R.planCodeInComment, bad: handler("usr.Commented", "// C04 AC-2: lock the fields (D8)\nconst x = 1;"),
    good: handler("usr.Commented", "// Lock the fields while the record is approved.\nconst x = 1;") },
  { rule: R.handlerWithoutNext, bad: '{ request: "usr.Post", handler: async (request) => { await post(request); } }',
    good: handler("usr.Post", "await post(request);") },
  { rule: R.pagedReadLoop,
    bad: handler("usr.Count", "for (let page = 0; page < 10; page++) { rows = await model.load({ options: { pagingConfig: { rowsOffset: page * 500, rowCount: 500 } } }); }"),
    good: handler("usr.Count", "rows = await model.load({ options: { pagingConfig: { rowsOffset: 0, rowCount: 10 } } });") },
  { rule: R.uncheckedWriteResult,
    bad: handler("usr.Recalc", "const model = await sdk.Model.create(\"A\");\nasync function save(id) { try { await model.update({ A: 1 }, id); } catch (e) { return null; } return 1; }\nawait save(1);"),
    good: handler("usr.Recalc", "const model = await sdk.Model.create(\"A\");\nasync function save(id) { try { await model.update({ A: 1 }, id); } catch (e) { return null; } return 1; }\nif ((await save(1)) == null) await showFailure(request);") },
];
const pageOf = (handlers) => ({ handlers: `[${handlers}]`, viewConfig: { items: [{ type: "crt.Button", name: "B", clicked: { request: "usr.Sent" } }] } });

export function runQualityChecks({ check, runMigration, renderVerify, checklistOpts, CLEAN_SEED, FULL_PLANMETA, FULL_SIGNALS, FULL_PLACEMENT, FIX }) {
  // each rule fires on its defect and stays silent on the clean counterpart.
  for (const { rule, bad, good } of CASES) {
    const badPage = lintPageQuality(pageOf(bad));
    const goodPage = lintPageQuality(pageOf(good));
    check(`quality: ${rule} fires on the defect and stays silent on the clean page`,
      () => rulesOf(badPage).includes(rule) && !rulesOf(goodPage).includes(rule),
      () => ({ bad: badPage.findings, good: goodPage.findings }));
  }
  // The same rules read the validators and converters sections, and say which section a finding is in.
  const sections = lintPageQuality({ handlers: "[]",
    validators: `{ "usr.Positive": { validator: (config) => { return function(control) {\n${lines(61)}\nreturn null; }; }, params: [] } }`,
    converters: `{ "usr.ToStatus": function(value) {\n// C04 AC-2: map the status\ntry { return value === "aaaaaaaa-0000-4000-8000-000000000001"; } catch (e) { console.error(e); }\n} }` });
  const inSection = (rule, section) => sections.findings.some((f) => f.rule === rule && f.section === section && f.line > 0);
  check("quality: validators and converters are linted too, each finding naming its section and line",
    () => inSection(R.functionTooLong, "validators") && inSection(R.planCodeInComment, "converters")
      && inSection(R.catchLogOnly, "converters") && inSection(R.guidLiteral, "converters"),
    () => sections.findings);
  const cleanSections = lintPageQuality({ handlers: "[]", validators: '{ "usr.Positive": { validator: () => () => null, params: [] } }',
    converters: '{ "usr.ToStatus": function(value) { return value === Constants.Status.Active; } }' });
  check("quality: clean validators and converters raise nothing", () => cleanSections.findings.length === 0, () => cleanSections.findings);
  const prose = lintPageQuality(pageOf(handler("usr.Commented", "// Uses ISO-8601 dates, HTTP/2 and the v2 API; step 3 of the wizard.\nconst x = 1;")));
  check("quality: ordinary technical tokens in a comment are not plan codes", () => count(prose, R.planCodeInComment) === 0, () => prose.findings);

  // The handler chain: each way a handler can pass the request on, and each way it can end the chain.
  const passesOn = [
    "async (request, next) => { const result = await next?.handle(request); await after(); return result; }",
    "async (request, next) => { let r; r = await next.handle(request); return r; }",
    "(request, next) => next?.handle(request)",
    "async (request, next) => { await before(); return next?.handle(request); }",
    "(request, next = null) => next?.handle(request)",
    "async (request, next) => { const r = await next.handle(request); if (r) { return r; } else { return r; } }",
    "async (request, next) => { try { return await next?.handle(request); } catch (e) { await show(e); throw e; } }",
    "async (request, next) => { try { await before(); } finally { return next?.handle(request); } }",
    "async (request, next) => { switch (request.kind) { case 1: case 2: return next.handle(request); default: return next.handle(request); } }",
    "(request, next) => { return next.handle(request).then((r) => r); }",
  ];
  const endsChain = [
    ["async (request) => { await post(request); }", /takes no `next`/],
    ["async (request, next) => { await post(request); }", /never calls/],
    ["async (request, next) => { await next?.handle(request); await post(request); }", /does not return its result/],
    ["async (request, next) => { const r = await next?.handle(request); return true; }", /does not return its result/],
    ["async (request, next) => { [1].forEach(() => next.handle(request)); return null; }", /never calls/],
    ["(request, next) => post(request)", /never calls/],
    ["async (request, next) => { if (await isLocked(request)) { await showLocked(request); return true; } return next?.handle(request); }", /does not return its result/],
    ["async (request, next) => { const r = await next.handle(request); if (r) return; return r; }", /does not return its result/],
    ["async (request, next) => { const r = await next.handle(request); if (r) { return r; } }", /does not return its result/],
    ["async (request, next) => { switch (request.kind) { case 1: return next.handle(request); case 2: return next.handle(request); } }", /does not return its result/],
  ];
  const chainOf = (fn) => lintPageQuality({ handlers: `[{ request: "usr.Post", handler: ${fn} }]` }).findings.filter((f) => f.rule === R.handlerWithoutNext);
  check("quality: a handler that calls next.handle(request) and returns its result passes the request on",
    () => passesOn.every((fn) => chainOf(fn).length === 0), () => passesOn.map((fn) => [fn, chainOf(fn)]).filter(([, f]) => f.length));
  check("quality: a handler without next, one that never calls it (a call inside a callback does not count) or one that drops its result ends the chain, and the finding says which",
    () => endsChain.every(([fn, why]) => { const f = chainOf(fn); return f.length === 1 && why.test(f[0].text) && f[0].request === "usr.Post"; }),
    () => endsChain.map(([fn]) => [fn, chainOf(fn)]));
  const validatorFn = lintPageQuality({ handlers: "[]", validators: '{ "usr.V": { validator: (config) => (control) => null, params: [] } }' });
  check("quality: the chain rule reads handlers only — a validator or converter has no next",
    () => count(validatorFn, R.handlerWithoutNext) === 0, () => validatorFn.findings);
  const checkedWrite = lintPageQuality(pageOf(handler("usr.Recalc",
    "async function save(id) { try { await model.update({ A: 1 }, id); } catch (e) { return false; } return true; }\nconst ok = await save(1); if (!ok) await showFailure(request);")));
  const noFailureValue = lintPageQuality(pageOf(handler("usr.Recalc",
    "async function save(id) { await model.update({ A: 1 }, id); return true; }\nawait save(1);")));
  const notDataWrites = [
    "const selected = new Set(); function unselect(id) { if (!id) return false; selected.delete(id); return true; }\nunselect(1);",
    "const model = await sdk.Model.create(\"A\");\nasync function save(id) { if (!id) return false; await model.update({ A: 1 }, id); return true; }\nawait save(1);",
  ].map((code) => lintPageQuality(pageOf(handler("usr.Recalc", code))));
  check("quality: a write function's result used by its caller, or one that has no failure value to drop, is not an unchecked write",
    () => count(checkedWrite, R.uncheckedWriteResult) === 0 && count(noFailureValue, R.uncheckedWriteResult) === 0,
    () => [checkedWrite.findings, noFailureValue.findings]);
  check("quality: only a data model's or the settings service's insert/update/delete is a data write, and a `return false` guard before the first write is not a failed write",
    () => notDataWrites.every((p) => count(p, R.uncheckedWriteResult) === 0), () => notDataWrites.map((p) => p.findings));
  const onePage = ["rows = await model.load({ options: { pagingConfig: { rowsOffset: request.offset, rowCount: 10 } } });",
    "const { rowsOffset } = request; rows = await model.load({ options: { pagingConfig: { rowsOffset, rowCount: PAGE } } });",
    "rows = await model.load({ options: { pagingConfig: { rowsOffset: pageIndex * PAGE, rowCount: PAGE } } });"]
    .map((code) => lintPageQuality(pageOf(handler("usr.Page", code))));
  check("quality: a computed rowsOffset outside any loop reads the one page asked for — not a paged read",
    () => onePage.every((p) => count(p, R.pagedReadLoop) === 0), () => onePage.map((p) => p.findings));
  const viaHelper = lintPageQuality(pageOf(handler("usr.Sum",
    "async function loadPage(p) { return model.load({ options: { pagingConfig: { rowsOffset: p * 500, rowCount: 500 } } }); }\nfor (let p = 0; p < 9; p++) { await loadPage(p); }")));
  check("quality: a computed rowsOffset in a helper that a loop calls is a paged read",
    () => count(viaHelper, R.pagedReadLoop) === 1, () => viaHelper.findings);

  // A real built page and its modules, as a migration run built them: every runtime defect the build contract
  // forbids is found at its line — a Post handler that ends the chain, totals and counts paged in the browser, bulk
  // actions and numbering that only log a failure, and a recalculation whose failure the caller drops.
  const v2 = (f) => fs.readFileSync(path.join(FIX, "client-modules-v2", f), "utf8");
  const at = (page, rule) => page.findings.filter((f) => f.rule === rule && !f.advisory).map((f) => f.line);
  const v2Post = lintPageQuality({ handlers: v2("UsrMbContractsV2App_MbDeliveryNoteFormPage.handlers.js") });
  const v2Totals = lintModuleQuality("UsrMbContractsV2DocumentTotals", v2("UsrMbContractsV2DocumentTotals.js"));
  const v2Form = lintModuleQuality("UsrMbContractsV2App_FormPageModule", v2("UsrMbContractsV2App_FormPageModule.js"));
  const v2List = lintModuleQuality("UsrMbContractsV2App_ListPageModule", v2("UsrMbContractsV2App_ListPageModule.js"));
  const v2Expected = [
    ["the Post handler ends the chain", at(v2Post, R.handlerWithoutNext), [30]],
    ["the totals page through every row", at(v2Totals, R.pagedReadLoop), [28]],
    ["the item count pages through every row", at(v2Form, R.pagedReadLoop), [105]],
    ["the log write after a post fails silently", at(v2Totals, R.catchLogOnly), [161]],
    ["the recalculation result is dropped after a post", at(v2Totals, R.uncheckedWriteResult), [168]],
    ["Deactivate selected and the number assignment only log", at(v2Form, R.catchLogOnly), [137, 211, 282]],
    ["Close selected only logs", at(v2List, R.catchLogOnly), [32]],
  ];
  check("quality: the built client modules of a real run — every runtime defect of the build contract is found at its line",
    () => [v2Post, v2Totals, v2Form, v2List].every((p) => p.unreadable.length === 0)
      && v2Expected.every(([, got, want]) => got.join() === want.join()),
    () => v2Expected.filter(([, got, want]) => got.join() !== want.join()));

  const measured = lintPageQuality(pageOf(handler("usr.Long", lines(61))));
  check("quality: a long function's finding states the measured length and the limit",
    () => measured.findings.some((f) => f.rule === R.functionTooLong && f.value === 64 && f.limit === 60 && /64 lines \(limit 60\)/.test(f.text)),
    () => measured.findings);

  const keyNamed = lintPageQuality(pageOf(handler("usr.Init", "const data = await a.load(); const b1 = await b.load({ data: 1 }); const c1 = await c.load();")));
  check("quality: an object key that shares a load result's name is not a read of it — the loads stay independent",
    () => count(keyNamed, R.sequentialAwaits) === 1, () => keyNamed.findings);

  const inHelper = lintPageQuality(pageOf(handler("usr.Init", "const loadAll = async () => { const a = await m1.load(); const b = await m2.load(); const c = await m3.load(); return [a, b, c]; }; await loadAll();")));
  check("quality: loads inside a helper declared in a handler are checked as their own sequence",
    () => count(inHelper, R.sequentialAwaits) === 1, () => inHelper.findings);
  const reassigned = lintPageQuality(pageOf(handler("usr.Init", "let data = await a.load(); data = await b.load(); const c1 = await c.load();")));
  check("quality: assigning a new load result to an earlier load's variable is a write, not a read — the loads stay independent",
    () => count(reassigned, R.sequentialAwaits) === 1, () => reassigned.findings);
  const dataIds = ["await request.$context.executeRequest({ type: \"usr.Open\", id: \"8dc41780-1234-4000-8000-000000000001\" });",
    "const owner = { id: \"8dc41780-1234-4000-8000-000000000001\", displayValue: \"Supervisor\" };",
    "const filter = { recordId: \"8dc41780-1234-4000-8000-000000000001\" };"];
  check("quality: a record id passed as data — a request id, a lookup value, a recordId — is a GUID finding whatever its key",
    () => dataIds.every((code) => count(lintPageQuality(pageOf(handler("usr.Data", code))), R.guidLiteral) === 1));
  const nestedCopies = lintPageQuality(pageOf(`${handler("usr.A", "const outer = (cfg) => { const inner = (v) => v && v.value ? v.value : v; return inner(cfg); }; outer(1);")}, `
    + handler("usr.B", "const other = (x) => { const inner = (v) => v && v.value ? v.value : v; return inner(x) + 1; }; other(2);")));
  check("quality: a helper nested in another helper is part of it — its copies are not reported on their own",
    () => count(nestedCopies, R.duplicateInPage) === 0, () => nestedCopies.findings);

  const declared = lintPageQuality(pageOf(`${handler("usr.A", "function fmt(v) { return v && v.value ? v.value : v; } fmt(1);")}, `
    + handler("usr.B", "function fmt2(v) { return v && v.value ? v.value : v; } fmt2(2);")));
  check("quality: two `function name() {}` helpers with one body in two handlers are a duplicate",
    () => count(declared, R.duplicateInPage) === 1, () => declared.findings);
  // Operators, declaration kinds and template text are properties, not child nodes: helpers that differ only there
  // have different logic, and merging them would change what the page does.
  const tick = String.fromCodePoint(96);
  const operatorPairs = [
    ['v && v.status && v.status.value === "a"', 'v && v.status && v.status.value !== "a"'],
    ["v && v.status && v.status.value", "v || v.status || v.status.value"],
    ["v.count + v.extra + v.base", "v.count - v.extra - v.base"],
    ["{ let n = v.count; n += v.extra; return n; }", "{ let n = v.count; n -= v.extra; return n; }"],
    ["{ const n = v.count; return n + v.extra; }", "{ let n = v.count; return n + v.extra; }"],
    ["!v.status && !v.status.value && v.x", "-v.status && -v.status.value && v.x"],
    ["{ let n = v.count; n++; return n; }", "{ let n = v.count; n--; return n; }"],
    ["{ let n = v.count; n++; return n; }", "{ let n = v.count; ++n; return n; }"],
    [tick + "${v.status.value} open ${v.x}" + tick, tick + "${v.status.value} closed ${v.x}" + tick],
  ];
  const differing = operatorPairs.map(([a, b]) => lintPageQuality(pageOf(`${handler("usr.A", "const isOpen = (v) => " + a + "; isOpen(1);")}, `
    + handler("usr.B", "const isClosed = (v) => " + b + "; isClosed(2);"))));
  check("quality: helpers that differ only in an operator, a declaration kind or template text are not duplicates",
    () => differing.every((r) => count(r, R.duplicateInPage) === 0),
    () => differing.map((r, i) => [operatorPairs[i][0], count(r, R.duplicateInPage)]).filter(([, c]) => c));
  const sameOps = lintPageQuality(pageOf(`${handler("usr.A", 'const isOpen = (v) => v && v.status && v.status.value !== "a"; isOpen(1);')}, `
    + handler("usr.B", 'const notA = (v) => v && v.status && v.status.value !== "a"; notA(2);')));
  check("quality: helpers with one body, operators included, are still a duplicate",
    () => count(sameOps, R.duplicateInPage) === 1, () => sameOps.findings);
  // A helper closing over its handler's own variables is a binding of that handler, not a copy of a helper.
  const wrapper = "const { $context, scopes } = request; const process = (config) => sdk.HandlerChainService.instance.process({ ...config, $context, scopes: [...scopes] }); await process({ type: \"usr.Sent\" });";
  check("quality: a helper reading its handler's $context/scopes is not a duplicate in another handler",
    () => count(lintPageQuality(pageOf(`${handler("usr.A", wrapper)}, ${handler("usr.B", wrapper)}`)), R.duplicateInPage) === 0);

  // a local element id is never a finding; a record id used as data is.
  const ids = lintPageQuality({ handlers: `[${handler("usr.Cols", "const column = { id: \"8dc41780-0000-4000-8000-000000000002\", code: \"Name\" }; if (s === \"8dc41780-1234-4000-8000-000000000001\") { return; }")}]`,
    viewConfig: { items: [{ type: "crt.ListWidget", columns: [{ id: "8dc41780-0000-4000-8000-000000000001" }] }] } });
  check("quality: an element's own `id` (an element-shaped handler object or viewConfig columns[].id) is never a GUID finding; a compared record id is",
    () => ids.findings.filter((f) => f.rule === R.guidLiteral).map((f) => f.text).join() === "`8dc41780-1234-4000-8000-000000000001`",
    () => ids.findings);
  const held = "1b7e3a3c-0000-4c5d-8e9f-0a1b2c3d4e5f";
  const comparesHeld = 'if (s === "' + held + '" || t === "aaaaaaaa-0000-4000-8000-000000000001") { return; }';
  const guidPage = { handlers: `[${handler("usr.G", comparesHeld)}]` };
  const withModule = lintPageQuality(guidPage, DEFAULT_QUALITY_THRESHOLDS, new Set([held]));
  check("quality: a record id a constants module holds blocks; any other data GUID is advisory",
    () => withModule.findings.filter((f) => f.rule === R.guidLiteral && !f.advisory).length === 1
      && withModule.findings.filter((f) => f.rule === R.guidLiteral && f.advisory).length === 1,
    () => withModule.findings);

  // The run-wide checks: a helper copied from another page, a request no page sends.
  const helper = "const idOf = (v) => v && v.value ? v.value : v; idOf(1);";
  const run = lintRunQuality({ main: pageOf(handler("usr.Sent", helper)), "child:Other": { handlers: `[${handler("usr.Other", helper)}]` } });
  check("quality: a helper copied from another page of the run is reported on the copying page only",
    () => count(run.get("child:Other"), R.duplicateAcrossPages) === 1 && count(run.get("main"), R.duplicateAcrossPages) === 0,
    () => Object.fromEntries([...run].map(([k, p]) => [k, p.findings])));
  const strings = lintRunQuality({ main: { handlers: "[]", resources: { strings: { Used: {}, Unused: {} } },
    viewConfig: { items: [{ caption: "#ResourceString(Used)#" }] } } }).get("main");
  check("quality: a resource string nothing on the page names is an advisory finding",
    () => strings.findings.filter((f) => f.rule === R.unusedResourceString).map((f) => [f.text, f.advisory].join()).join("|") === "`Unused`,true",
    () => strings.findings);
  check("quality: a bundle without handlers/validators/converters is not linted (null), an unparsable section is named",
    () => lintPageQuality({ viewConfig: {} }) === null && lintPageQuality({ handlers: "[ {" }).unreadable.join() === "handlers");

  // Thresholds — the manifest overrides them key by key; anything but a positive whole number is ignored.
  check("quality: manifest.qualityThresholds overrides the defaults key by key and ignores invalid values",
    () => JSON.stringify(qualityThresholdsOf({ qualityThresholds: { maxFunctionLines: 100, maxNestedFunctionsPerHandler: -1, maxSequentialIndependentAwaits: "4" } }))
      === JSON.stringify({ maxFunctionLines: 100, maxNestedFunctionsPerHandler: 3, maxSequentialIndependentAwaits: 2 })
      && JSON.stringify(qualityThresholdsOf({})) === JSON.stringify(DEFAULT_QUALITY_THRESHOLDS));

  // the verify rows, through the plan the engine renders.
  const dir = path.join(FIX, "conventions");
  const body = (f) => fs.readFileSync(path.join(dir, f), "utf8");
  const AB = { resolved: true, requestPrefix: "usr", helperModules: [], constantsModules: ["AbConstants"], source: "fallback",
    evidence: "no custom requests found", confirmedBy: "plan" };
  const manifest = (extra = {}) => ({ entity: "UsrOrder", seed: CLEAN_SEED, targetPackage: "UsrSU", planMeta: FULL_PLANMETA, signals: FULL_SIGNALS,
    placement: FULL_PLACEMENT, schemas: [{ pkg: "UsrOrders", body: body("UsrOrderPage.js") }], resources: { ApplyButtonCaption: "Apply" },
    projectConventions: AB, constantsModules: { AbConstants: { body: body("AbConstants.js") } }, ...extra });
  const result = runMigration(manifest(), { baseDir: dir });
  const opts = checklistOpts(manifest());
  const built = (handlers) => ({ pages: { main: { parentSchemaName: "PageWithTabsFreedomTemplate", packageName: "UsrSU",
    schemaUId: "11111111-1111-4111-8111-111111111111", viewConfig: { items: [{ type: "crt.Button", name: "ApplyButton", clicked: { request: "usr.ApplyButtonClicked" } }] },
    handlers, validators: "{}", converters: "{}", deps: '["AbConstants"]' } } });
  const rowLine = (md, rule) => md.split("\n").find((l) => l.includes(`[code-quality] ${rule} —`)) || "";
  const pageCodeLine = (md) => (md.split("\n").find((l) => l.includes("| Page code — ")) || "").replaceAll("ˋ", "`");
  const ROW_RULES = QUALITY_ROW_RULES.map((r) => r.rule);
  const longHandler = `[${handler("usr.ApplyButtonClicked", lines(70))}]`;
  const failing = renderVerify(result, opts, built(longHandler));
  check("verify: a function over the limit makes the Page code row a blocking ⚠ (the limit comes from quality.mjs) that keeps the page from complete",
    () => /⚠ verify/.test(pageCodeLine(failing.markdown)) && /`usr\.ApplyButtonClicked` is 73 lines \(limit 60\)/.test(pageCodeLine(failing.markdown)) && !failing.complete,
    () => pageCodeLine(failing.markdown));
  check("verify: function length is held by the Page code row only — Code quality has no row for it, nor for duplicates or unsent requests",
    () => [R.functionTooLong, R.duplicateInPage, R.requestWithoutSender].every((rule) => !rowLine(failing.markdown, rule)));
  const longBody = Array.from({ length: 70 }, (_, i) => `const s${i} = ${i};`).join("\n");
  const builtWith = (extra) => { const b = built(`[${handler("usr.ApplyButtonClicked", "const x = 1;")}]`); Object.assign(b.pages.main, extra); return b; };
  const longValidator = renderVerify(result, opts, builtWith({ validators: `{ "usr.Positive": { validator: (config) => { return function(control) {\n${longBody}\nreturn null; }; }, params: [] } }` }));
  check("verify: a validator function over the limit holds the Page code row ⚠, named by its section",
    () => /⚠ verify/.test(pageCodeLine(longValidator.markdown)) && /`validators › line \d+` is \d+ lines \(limit 60\)/.test(pageCodeLine(longValidator.markdown)),
    () => pageCodeLine(longValidator.markdown));
  const longConverter = renderVerify(result, opts, builtWith({ converters: `{ "usr.ToUpper": function(value) {\n${longBody}\nreturn value; } }` }));
  check("verify: a converter function over the limit holds the Page code row ⚠, named by its section",
    () => /⚠ verify/.test(pageCodeLine(longConverter.markdown)) && /`converters › usr\.ToUpper` is \d+ lines \(limit 60\)/.test(pageCodeLine(longConverter.markdown)),
    () => pageCodeLine(longConverter.markdown));
  const raised = renderVerify(result, checklistOpts(manifest({ qualityThresholds: { maxFunctionLines: 100 } })), built(longHandler));
  check("verify: raising manifest.qualityThresholds.maxFunctionLines over the length clears the Page code row, under the same label",
    () => /✅ Done/.test(pageCodeLine(raised.markdown)) && pageCodeLine(raised.markdown).includes("no function longer than `maxFunctionLines`"),
    () => pageCodeLine(raised.markdown));
  const failingLabel = "Page code — no function longer than `maxFunctionLines`, no helper declared twice on the page, no request declared but never sent";
  const decided = renderVerify(result, opts, built(longHandler), new Set([verifyRowKey("main", failingLabel)]));
  check("verify: a D<N> decision recorded on the Page code row closes it, and nothing else holds the same finding",
    () => !/⚠ verify/.test(pageCodeLine(decided.markdown)) && (decided.decided || []).some((d) => /Page code/.test(d.label || JSON.stringify(d)))
      && ROW_RULES.every((rule) => !/⚠ verify/.test(rowLine(decided.markdown, rule))),
    () => ({ row: pageCodeLine(decided.markdown), decided: decided.decided }));
  const decidedRaised = renderVerify(result, checklistOpts(manifest({ qualityThresholds: { maxFunctionLines: 65 } })), built(longHandler),
    new Set([verifyRowKey("main", failingLabel)]));
  check("verify: a decision recorded on the Page code row still holds after the threshold changes (the label names no value)",
    () => !/⚠ verify/.test(pageCodeLine(decidedRaised.markdown)), () => pageCodeLine(decidedRaised.markdown));
  const clean = renderVerify(result, opts, built(`[${handler("usr.ApplyButtonClicked", "const x = 1;")}]`));
  check("verify: a clean page closes every Code quality row ✅ (the advisory one never reads ⚠)",
    () => ROW_RULES.every((rule) => rule === R.unusedResourceString
      ? !/⚠ verify/.test(rowLine(clean.markdown, rule)) : /✅ Done/.test(rowLine(clean.markdown, rule))),
    () => clean.markdown.split("\n").filter((l) => l.includes("[code-quality]")));
  // Two handlers end the chain; the plan decides that only the save does. The decision closes that handler's row,
  // and the other handler's row stays open: one decision never covers a handler it does not name.
  const chainEnded = '[{ request: "crt.SaveRecordRequest", handler: async (request) => { await save(request); return true; } },'
    + ' { request: "usr.ApplyButtonClicked", handler: async (request) => { await post(request); } }]';
  const chainRule = QUALITY_ROW_RULES.find((r) => r.rule === R.handlerWithoutNext);
  const chainRows = (md) => md.split("\n").filter((l) => l.includes(`[code-quality] ${R.handlerWithoutNext} —`));
  const chainRowOf = (md, request) => chainRows(md).find((l) => l.includes(request)) || "";
  const saveLabel = `[code-quality] ${R.handlerWithoutNext} — \`crt.SaveRecordRequest\` ${chainRule.label.replace(/^every handler /, "")}`;
  const chainOpen = renderVerify(result, opts, built(chainEnded));
  const chainDecided = renderVerify(result, opts, built(chainEnded), new Set([verifyRowKey("main", saveLabel)]));
  const sharedDecided = renderVerify(result, opts, built(chainEnded),
    new Set([verifyRowKey("main", `[code-quality] ${R.handlerWithoutNext} — ${chainRule.label}`)]));
  check("verify: each handler that ends the chain blocks a row of its own, named by its request; the shared row stays ✅",
    () => /⚠ verify/.test(chainRowOf(chainOpen.markdown, "crt.SaveRecordRequest")) && /⚠ verify/.test(chainRowOf(chainOpen.markdown, "usr.ApplyButtonClicked"))
      && !/⚠ verify/.test(rowLine(chainOpen.markdown, R.handlerWithoutNext)) && !chainOpen.complete,
    () => chainRows(chainOpen.markdown));
  check("verify: a plan decision that the save ends the chain closes the save's row only; the undecided handler keeps the page open",
    () => !chainRowOf(chainDecided.markdown, "crt.SaveRecordRequest") && (chainDecided.decided || []).some((d) => d.deliverable.includes("crt.SaveRecordRequest"))
      && /⚠ verify/.test(chainRowOf(chainDecided.markdown, "usr.ApplyButtonClicked")) && !chainDecided.complete,
    () => ({ rows: chainRows(chainDecided.markdown), decided: chainDecided.decided }));
  check("verify: a decision on the shared handler-without-next row closes neither named handler",
    () => /⚠ verify/.test(chainRowOf(sharedDecided.markdown, "crt.SaveRecordRequest")) && /⚠ verify/.test(chainRowOf(sharedDecided.markdown, "usr.ApplyButtonClicked")),
    () => chainRows(sharedDecided.markdown));
  const usesHeld = `[${handler("usr.ApplyButtonClicked", 'if (s === "' + held + '") { return; }')}]`;
  const heldId = renderVerify(result, opts, built(usesHeld));
  check("verify: a record id the declared constants module holds blocks the GUID row",
    () => /⚠ verify/.test(rowLine(heldId.markdown, R.guidLiteral)), () => rowLine(heldId.markdown, R.guidLiteral));
  // With no conventions recorded, AbConstants is not a declared module, so its source is filed like any other import.
  const noConventions = renderVerify(result, { ...opts, projectConventions: null, constantsGuids: [] },
    { ...built(usesHeld), modules: { AbConstants: body("AbConstants.js") } });
  const kindOf = (v, rule) => v.rows.find((r) => r.deliverable.includes(`[code-quality] ${rule} —`))?.kind;
  check("verify: without recorded projectConventions the GUID row says the constants-module check was skipped, does not block, and is a note (not a hand-confirm item)",
    () => /ℹ noted/.test(rowLine(noConventions.markdown, R.guidLiteral)) && /check was skipped/.test(rowLine(noConventions.markdown, R.guidLiteral))
      && kindOf(noConventions, R.guidLiteral) === "info",
    () => rowLine(noConventions.markdown, R.guidLiteral));
  check("verify: the Code quality rows are verify-only — the plan's groups (and so the task cut, a split and every digest) carry none",
    () => !checklistGroups(result, opts).some((g) => /Code quality/.test(g.title)) && /\*\*Code quality/.test(clean.markdown));
  const notBuilt = renderVerify(result, opts, { pages: { main: false } });
  check("verify: a page reported not built gets non-gating Code quality rows — its own rows already block",
    () => /☐ confirm on-stand/.test(rowLine(notBuilt.markdown, R.catchLogOnly)) && /no code to check/.test(rowLine(notBuilt.markdown, R.catchLogOnly))
      && kindOf(notBuilt, R.catchLogOnly) === "info",
    () => rowLine(notBuilt.markdown, R.catchLogOnly));
  // The Evidence cell goes through esc(), which renders a backtick as U+02CB; the pattern accepts either.
  const unparsable = renderVerify(result, opts, built("[ {"));
  check("verify: an unparsable handlers section blocks every Code quality row and names the section",
    () => /⚠ verify/.test(rowLine(unparsable.markdown, R.catchLogOnly)) && /[`ˋ]handlers[`ˋ] could not be parsed/.test(rowLine(unparsable.markdown, R.catchLogOnly)) && !unparsable.complete,
    () => rowLine(unparsable.markdown, R.catchLogOnly));
  const noBundle = renderVerify(result, opts, { pages: { main: { parentSchemaName: "PageWithTabsFreedomTemplate", viewConfig: { items: [] } } } });
  check("verify: a bundle without code sections cannot be checked — the rows are confirm-on-stand, never a silent ✅",
    () => /confirm on-stand/.test(rowLine(noBundle.markdown, R.catchLogOnly)), () => rowLine(noBundle.markdown, R.catchLogOnly));

  // Through the REAL payload path: get-page's bundle.json → assembleBuilt → built.json → --verify.
  const asDir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-assemble-"));
  try {
    const w = (f, v) => fs.writeFileSync(path.join(asDir, f), typeof v === "string" ? v : JSON.stringify(v));
    fs.mkdirSync(path.join(asDir, "reads"));
    w("reads/index.json", { version: 1, reads: [{ kind: "pageMeta", file: "reads/01-meta-main.json", pageKey: "main", what: "m" },
      { kind: "pageBundle", file: "reads/02-bundle-main.json", pageKey: "main", what: "b" }] });
    w("reads/01-meta-main.json", { page: { schemaName: "UsrOrder_FormPage", schemaUId: "11111111-1111-4111-8111-111111111111", packageName: "UsrSU", parentSchemaName: "PageWithTabsFreedomTemplate" } });
    w("reads/02-bundle-main.json", { name: "UsrOrder_FormPage", viewConfig: [], deps: '["AbConstants"]', validators: "{}", converters: "{}",
      handlers: `[${handler("usr.ApplyButtonClicked", "try { await request.$context.save(); } catch (e) { console.error(e); }")}]` });
    const { built: assembled } = assembleBuilt(asDir);
    const viaFile = renderVerify(result, opts, assembled);
    check("verify via assembleBuilt: a log-only catch block in get-page's bundle reaches the Code quality row and blocks it",
      () => /⚠ verify/.test(rowLine(viaFile.markdown, R.catchLogOnly)), () => rowLine(viaFile.markdown, R.catchLogOnly));
  } finally { fs.rmSync(asDir, { recursive: true, force: true }); }

  // CLIENT MODULES. A page's Code quality and Page code rows cover every client module the page imports, directly or
  // through another module, with the rules that hold outside a page section.
  const MOD = path.join(FIX, "module-lint-v2");
  const modSrc = (name) => fs.readFileSync(path.join(MOD, name + ".js"), "utf8");
  const V2 = ["UsrDemoV2App_FormPageModule", "UsrDemoV2App_ListPageModule", "UsrDemoV2DocumentTotals"];
  const v2Modules = Object.fromEntries(V2.map((n) => [n, modSrc(n)]));
  const formModule = lintModuleQuality(V2[0], v2Modules[V2[0]]);
  check("module lint: the benchmark form-page module reports its 3 log-only catches and its bare numeric comparisonType, each under the module's name",
    () => count(formModule, R.catchLogOnly) === 3 && count(formModule, R.numericComparisonType) === 1
      && formModule.findings.every((f) => f.section === `module ${V2[0]}`), () => formModule.findings);
  check("module lint: the module's own deps are read from its define(), and each finding names its module",
    () => JSON.stringify(formModule.deps) === JSON.stringify(["@creatio-devkit/common", "UsrDemoV2DocumentTotals"])
      && formModule.findings.every((f) => f.module === V2[0]), () => formModule);
  check("module lint: the list-page module's log-only catch and the shared module's comment-only catch are reported",
    () => count(lintModuleQuality(V2[1], v2Modules[V2[1]]), R.catchLogOnly) === 1 && count(lintModuleQuality(V2[2], v2Modules[V2[2]]), R.catchLogOnly) === 1);
  const factoryOnly = lintModuleQuality("UsrBig", `define("UsrBig", [], function() {\n${lines(150)}\nfunction long() {\n${lines(70)}\n}\nreturn {};\n});`);
  check("module lint: the factory is the module itself and is not measured; a function in it over the limit is",
    () => count(factoryOnly, R.functionTooLong) === 1 && factoryOnly.findings[0].name === "long", () => factoryOnly.findings);
  const guidModule = `define("UsrIds", [], function() { const STATUS = { Closed: "${held}", Other: "aaaaaaaa-0000-4000-8000-000000000009" }; return STATUS; });`;
  const guids = lintModuleQuality("UsrIds", guidModule, DEFAULT_QUALITY_THRESHOLDS, new Set([held.toLowerCase()]));
  check("module lint: a record id the constants module holds blocks in a module too; another one is only noted",
    () => guids.findings.filter((f) => f.rule === R.guidLiteral && !f.advisory).length === 1
      && guids.findings.filter((f) => f.rule === R.guidLiteral && f.advisory).length === 1, () => guids.findings);
  check("module lint: a module that does not parse is unreadable, not clean",
    () => lintModuleQuality("UsrBroken", "define(\"UsrBroken\", [], function() { return {").unreadable[0] === "module UsrBroken");
  const loads = (dependent) => `define("UsrLoads", [], function() { async function read(sdk) {\n`
    + `const a = await sdk.Model.create("A");\nconst b = await sdk.Model.create(${dependent ? "a.name" : '"B"'});\n`
    + `const c = await sdk.Model.create(${dependent ? "b.name" : '"C"'});\nreturn [a, b, c]; } return { read }; });`;
  const seqLoads = lintModuleQuality("UsrLoads", loads(false));
  check("module lint: independent loads awaited one after another in a module function are reported under the module",
    () => count(seqLoads, R.sequentialAwaits) === 1 && seqLoads.findings[0].section === "module UsrLoads"
      && count(lintModuleQuality("UsrLoads", loads(true)), R.sequentialAwaits) === 0, () => seqLoads.findings);
  const planCodes = lintModuleQuality("UsrPlan", "/** Built for card C04. */\ndefine(\"UsrPlan\", [], function() {\n"
    + "// covers AC-16\nfunction f() { return 1; }\nreturn { f }; });");
  const plainHeader = lintModuleQuality("UsrPlan", "/** Totals of a contract. */\ndefine(\"UsrPlan\", [], function() {\n"
    + "// sums the active rows\nfunction f() { return 1; }\nreturn { f }; });");
  check("module lint: a plan code in the module's header JSDoc or an inner comment is reported; plain comments are not",
    () => count(planCodes, R.planCodeInComment) === 2 && planCodes.findings.every((f) => f.section === "module UsrPlan")
      && count(plainHeader, R.planCodeInComment) === 0, () => planCodes.findings);
  const elementIds = lintModuleQuality("UsrCols", `define("UsrCols", [], function() { return { columns: [{ id: "${held}", code: "X" }] }; });`,
    DEFAULT_QUALITY_THRESHOLDS, new Set([held.toLowerCase()]));
  check("module lint: an element's generated local id is not a record id, in a module as on a page",
    () => count(elementIds, R.guidLiteral) === 0, () => elementIds.findings);

  const pageEntry = (deps) => ({ handlers: `[${handler("usr.A", "const x = 1;")}]`, validators: "{}", converters: "{}", deps });
  const v2Pages = { main: pageEntry('["@creatio-devkit/common", "UsrDemoV2App_FormPageModule"]'), list: pageEntry('["UsrDemoV2App_ListPageModule"]') };
  const v2Run = lintRunQuality(v2Pages, DEFAULT_QUALITY_THRESHOLDS, new Set(), v2Modules, new Set());
  check("run: a page carries the findings of the modules it imports, and of the modules those import (form page: 3 + 1 from the shared module)",
    () => count(v2Run.get("main"), R.catchLogOnly) === 4 && count(v2Run.get("main"), R.numericComparisonType) === 1
      && JSON.stringify(v2Run.get("main").modules) === JSON.stringify([V2[0], V2[2]]) && count(v2Run.get("list"), R.catchLogOnly) === 1,
    () => ({ main: v2Run.get("main").findings.map((f) => f.section + ":" + f.rule), list: v2Run.get("list").modules }));
  const partial = lintRunQuality(v2Pages, DEFAULT_QUALITY_THRESHOLDS, new Set(), { [V2[0]]: v2Modules[V2[0]] }, new Set());
  check("run: an imported module whose source was not filed is named as unread, also when only another module imports it",
    () => JSON.stringify(partial.get("main").unreadModules) === JSON.stringify([V2[2]]) && JSON.stringify(partial.get("list").unreadModules) === JSON.stringify([V2[1]]));
  const external = lintRunQuality(v2Pages, DEFAULT_QUALITY_THRESHOLDS, new Set(), { [V2[0]]: v2Modules[V2[0]] }, new Set([V2[2]]));
  check("run: a declared project module (existing code) is not followed — neither linted nor owed",
    () => external.get("main").unreadModules.length === 0 && count(external.get("main"), R.catchLogOnly) === 3);
  const shared = lintRunQuality({ a: pageEntry('["UsrDemoV2App_ListPageModule"]'), b: pageEntry('["UsrDemoV2App_ListPageModule"]') },
    DEFAULT_QUALITY_THRESHOLDS, new Set(), v2Modules, new Set());
  check("run: a module two pages import counts on each of them",
    () => count(shared.get("a"), R.catchLogOnly) === 1 && count(shared.get("b"), R.catchLogOnly) === 1);

  const withModules = (deps, modules) => { const b = built(`[${handler("usr.ApplyButtonClicked", "const x = 1;")}]`); b.pages.main.deps = deps; b.modules = modules; return b; };
  const v2Verify = renderVerify(result, opts, withModules('["AbConstants", "UsrDemoV2App_FormPageModule"]', v2Modules));
  check("verify: a log-only catch in an imported module blocks the page's Code quality row, named by the module",
    () => /⚠ verify/.test(rowLine(v2Verify.markdown, R.catchLogOnly)) && rowLine(v2Verify.markdown, R.catchLogOnly).includes(`module ${V2[0]}`)
      && /⚠ verify/.test(rowLine(v2Verify.markdown, R.numericComparisonType)) && !v2Verify.complete,
    () => rowLine(v2Verify.markdown, R.catchLogOnly));
  const unreadVerify = renderVerify(result, opts, withModules('["AbConstants", "UsrDemoV2App_FormPageModule"]', {}));
  check("verify: an imported module the read-back did not file holds the Code quality and Page code rows ⚠, saying where its source goes",
    () => /⚠ verify/.test(rowLine(unreadVerify.markdown, R.catchLogOnly)) && /reads\/modules\//.test(rowLine(unreadVerify.markdown, R.catchLogOnly).replaceAll("ˋ", "`"))
      && /⚠ verify/.test(pageCodeLine(unreadVerify.markdown)) && pageCodeLine(unreadVerify.markdown).includes(V2[0]) && !unreadVerify.complete,
    () => [rowLine(unreadVerify.markdown, R.catchLogOnly), pageCodeLine(unreadVerify.markdown)]);
  const longModule = `define("UsrLongModule", [], function() {\nfunction recalculate() {\n${lines(70)}\n}\nreturn { recalculate };\n});`;
  const longVerify = renderVerify(result, opts, withModules('["UsrLongModule"]', { UsrLongModule: longModule }));
  check("verify: a module function over the limit holds the Page code row ⚠, named `Module › function`",
    () => /⚠ verify/.test(pageCodeLine(longVerify.markdown)) && /`UsrLongModule › recalculate` is \d+ lines \(limit 60\)/.test(pageCodeLine(longVerify.markdown)),
    () => pageCodeLine(longVerify.markdown));
  const raisedModule = renderVerify(result, checklistOpts(manifest({ qualityThresholds: { maxFunctionLines: 200 } })),
    withModules('["UsrLongModule"]', { UsrLongModule: longModule }));
  check("verify: raising manifest.qualityThresholds.maxFunctionLines clears a module function's Page code finding",
    () => /✅ Done/.test(pageCodeLine(raisedModule.markdown)), () => pageCodeLine(raisedModule.markdown));
  const brokenModule = renderVerify(result, opts, withModules('["UsrBroken"]', { UsrBroken: 'define("UsrBroken", [], function() { return {' }));
  check("verify: a filed module that does not parse holds both the Page code and Code quality rows ⚠, naming its reads/modules file",
    () => /⚠ verify/.test(pageCodeLine(brokenModule.markdown)) && pageCodeLine(brokenModule.markdown).includes("reads/modules/UsrBroken.js")
      && /⚠ verify/.test(rowLine(brokenModule.markdown, R.catchLogOnly)) && !/bundle's/.test(rowLine(brokenModule.markdown, R.catchLogOnly)),
    () => [pageCodeLine(brokenModule.markdown), rowLine(brokenModule.markdown, R.catchLogOnly)]);
  // A module not filed holds only the rows its code can break, and keeps each row's own findings and note.
  const unfiledWithCatch = renderVerify(result, opts, (() => { const b = withModules('["UsrMissing"]', {});
    b.pages.main.handlers = `[${handler("usr.ApplyButtonClicked", "try { await request.$context.save(); } catch (e) { console.error(e); }")}]`; return b; })());
  check("verify: an unfiled module holds the catch-log-only row and the page's own log-only catch is still listed",
    () => /⚠ verify/.test(rowLine(unfiledWithCatch.markdown, R.catchLogOnly)) && rowLine(unfiledWithCatch.markdown, R.catchLogOnly).includes("UsrMissing")
      && rowLine(unfiledWithCatch.markdown, R.catchLogOnly).includes("the catch block only logs the error"),
    () => rowLine(unfiledWithCatch.markdown, R.catchLogOnly));
  check("verify: an unfiled module leaves the rows no module can break on their own path (nested functions ✅, unused strings not ⚠)",
    () => /✅ Done/.test(rowLine(unfiledWithCatch.markdown, R.nestedFunctions)) && !/⚠ verify/.test(rowLine(unfiledWithCatch.markdown, R.unusedResourceString)),
    () => [rowLine(unfiledWithCatch.markdown, R.nestedFunctions), rowLine(unfiledWithCatch.markdown, R.unusedResourceString)]);
  const noConventionsUnfiled = renderVerify(result, { ...opts, projectConventions: null, constantsGuids: [] }, built(usesHeld));
  check("verify: without projectConventions an unfiled import holds the GUID row, which keeps the 'check was skipped' note and the page's own record id",
    () => /⚠ verify/.test(rowLine(noConventionsUnfiled.markdown, R.guidLiteral)) && /check was skipped/.test(rowLine(noConventionsUnfiled.markdown, R.guidLiteral))
      && rowLine(noConventionsUnfiled.markdown, R.guidLiteral).includes("AbConstants") && rowLine(noConventionsUnfiled.markdown, R.guidLiteral).includes(held),
    () => rowLine(noConventionsUnfiled.markdown, R.guidLiteral));
  const unreadAndLong = renderVerify(result, opts, (() => { const b = withModules('["UsrMissing"]', {});
    b.pages.main.handlers = longHandler; return b; })());
  check("verify: an unread module does not hide the page's own Page code findings",
    () => pageCodeLine(unreadAndLong.markdown).includes("UsrMissing") && /`usr\.ApplyButtonClicked` is \d+ lines/.test(pageCodeLine(unreadAndLong.markdown)),
    () => pageCodeLine(unreadAndLong.markdown));
  const cleanModule = renderVerify(result, opts, withModules('["UsrCleanModule"]', { UsrCleanModule: 'define("UsrCleanModule", [], function() { return { x: 1 }; });' }));
  check("verify: a page whose imported modules are filed and clean closes the Page code row and every blocking Code quality row",
    () => /✅ Done/.test(pageCodeLine(cleanModule.markdown)) && ROW_RULES.filter((r) => r !== R.unusedResourceString).every((r) => /✅ Done/.test(rowLine(cleanModule.markdown, r))),
    () => cleanModule.markdown.split("\n").filter((l) => l.includes("[code-quality]") || l.includes("Page code")));

  // Through the real payload path: `reads/modules/<Module>.js` → assembleBuilt → built.modules.
  const modDir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-modules-"));
  try {
    fs.mkdirSync(path.join(modDir, "reads", "modules"), { recursive: true });
    fs.writeFileSync(path.join(modDir, "reads", "index.json"), JSON.stringify({ version: 1, reads: [] }));
    fs.writeFileSync(path.join(modDir, "reads", "modules", `${V2[1]}.js`), v2Modules[V2[1]]);
    fs.writeFileSync(path.join(modDir, "reads", "modules", "notes.txt"), "not a module");
    const { built: fromDir } = assembleBuilt(modDir);
    check("assembleBuilt: each reads/modules/<Module>.js becomes built.modules[<Module>], and nothing else in the folder does",
      () => fromDir.modules?.[V2[1]] === v2Modules[V2[1]] && Object.keys(fromDir.modules).length === 1, () => Object.keys(fromDir?.modules || {}));
  } finally { fs.rmSync(modDir, { recursive: true, force: true }); }

  // the engine stays zero-dependency: quality.mjs imports only its siblings.
  const src = fs.readFileSync(new URL("../../skills/classic-to-freedom-migration/engine/quality.mjs", import.meta.url), "utf8");
  check("quality: quality.mjs imports only engine siblings (no package)",
    () => { const from = [...src.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
      return from.length >= 2 && from.every((m) => m.startsWith("./")) && !/\bimport\s*\(/.test(src) && !/\brequire\s*\(/.test(src); });
}

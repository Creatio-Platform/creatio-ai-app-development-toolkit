// CODE QUALITY of the built pages. A customer counted by hand what the migration had built: a 391-line save handler
// with 20 functions inside, one helper pasted 8 times, record ids its constants module already held, catch blocks
// that only logged, plan codes in comments. These checks hold the `--verify` Code quality rows that measure it: each
// rule fires on a synthetic page that breaks it and stays silent on its clean counterpart, the thresholds come from
// the manifest, and the rows reach the verify table through the real payload path.
// Imported and run by `run-mapper.mjs`, which hands it its `check` and the shared fixtures so the tally stays one number.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { lintPageQuality, lintRunQuality, lintModuleQuality, runModuleLint, qualityThresholdsOf, QUALITY_RULES, QUALITY_ROW_RULES, DEFAULT_QUALITY_THRESHOLDS, MODULE_BODY_RULES }
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
    "async (request, next) => { if (await isLocked(request)) { await showLocked(request); return true; } return next?.handle(request); }",
    "async (request, next) => { const child = page.childOf(request); if (child) { return page.openChild(request, child); } return next?.handle(request); }",
    "async (request, next) => { if (!request.value) { return; } return next?.handle(request); }",
    "async (request, next) => { if (!request.value) { return next?.handle(request); } else { return page.open(request); } }",
    "async (request, next) => { const r = await next.handle(request); switch (request.kind) { case 1: log(); case 2: return r; default: return r; } }",
    "async (request, next) => { let result; switch (request.kind) { case 1: if (request.value) { result = await next.handle(request); break; } return true; default: result = await next.handle(request); } return result; }",
    "async (request, next) => { try { const r = await next.handle(request); return r; } finally { cleanup(); } }",
    "async (request, next) => { try { await load(); } catch (e) { return false; } return next?.handle(request); }",
    "async (request, next) => { switch (request.mode) { case \"a\": case \"b\": return next.handle(request); default: return page.open(request); } }",
    "async (request, next) => { outer: for (const x of request.items) { if (x) { break outer; } } return next.handle(request); }",
    "async (request, next) => { for (const item of request.items) { if (item.matches) { return next.handle(request); } } return false; }",
    "async (request, next) => { while (true) { return next.handle(request); } }",
    "async (request, next) => { do { return next.handle(request); } while (false); }",
    "async (request, next) => { for (;;) { if (request.ready) { return next.handle(request); } await wait(); } }",
  ];
  const endsChain = [
    ["async (request) => { await post(request); }", /takes no `next`/],
    ["async (request, next) => { await post(request); }", /never calls/],
    ["async (request, next) => { await next?.handle(request); await post(request); }", /no `return` gives its result/],
    ["async (request, next) => { const r = await next?.handle(request); return true; }", /no `return` gives its result/],
    ["(request, next) => next.handle(request) && true", /no `return` gives its result/],
    ["async (request, next) => { [1].forEach(() => next.handle(request)); return null; }", /never calls/],
    ["(request, next) => post(request)", /never calls/],
    ["async (request, next) => { const r = await next.handle(request); if (r) return; return r; }", /a `return` reached after that call does not give its result/],
    ["async (request, next) => { if (request.value) { return next?.handle(request); } }", /can reach its end without a `return`, which ends the chain/],
    ["async (request, next) => { switch (request.kind) { case 1: return next.handle(request); case 2: return next.handle(request); } }", /can reach its end without a `return`, which ends the chain/],
    ["async (request, next) => { try { return next.handle(request); } catch (e) { return false; } }", /a `return` reached after that call does not give its result/],
    ["async (request, next) => { let r; do { r = await next.handle(request); } while (request.again); if (request.skip) { return true; } return r; }", /a `return` reached after that call does not give its result/],
    ["async (request, next) => { while (request.retry) { await next.handle(request); if (request.done) { return false; } } return next.handle(request); }", /a `return` reached after that call does not give its result/],
    ["async (request, next) => { for (const item of request.items) { await next.handle(request); } if (request.skip) { return false; } return next.handle(request); }", /a `return` reached after that call does not give its result/],
    ["async (request, next) => { let r; while (true) { r = await next.handle(request); if (r) { break; } } if (request.skip) { return true; } return r; }", /a `return` reached after that call does not give its result/],
    ["async (request, next) => { await next.handle(request); outer: for (const x of request.items) { if (x) { return false; } } return next.handle(request); }", /a `return` reached after that call does not give its result/],
    ["async (request, next) => { switch (request.kind) { case 1: await next.handle(request); case 2: return true; default: return next.handle(request); } return next.handle(request); }", /a `return` reached after that call does not give its result/],
    ["async (request, next) => { switch (request.kind) { case 1: await next.handle(request); case 2: return true; default: return next.handle(request); } }", /a `return` reached after that call does not give its result/],
    ["async (request, next) => { const r = await next.handle(request); if (!r) { return false; } return r; }", /a `return` reached after that call does not give its result/],
    ["async (request, next) => { await next.handle(request); switch (request.kind) { case 1: return true; default: return next.handle(request); } }", /a `return` reached after that call does not give its result/],
    ["async (request, next) => { for (const x of request.items) { if (x) { return false; } await next.handle(request); } return next.handle(request); }", /a `return` reached after that call does not give its result/],
    ["async (request, next) => { const r = await next.handle(request); if (r) { return r; } }", /can reach its end after that call without a `return`/],
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
  const fixtureIn = (dir) => (f) => fs.readFileSync(path.join(FIX, dir, f), "utf8");
  const v2 = fixtureIn("client-modules-v2");
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

  // The next run of the same package: the record and list pages stop the chain on purpose when a record opens its own
  // page, before the request is handed on, and the return-note module was saved with a bare comparisonType before
  // the gate's repair round rewrote it.
  const v3 = fixtureIn("client-modules-v3");
  const v3Form = lintPageQuality({ handlers: v3("UsrMbContractsV3App_FormPage.handlers.js") });
  const v3List = lintPageQuality({ handlers: v3("UsrMbContractsV3App_ListPage.handlers.js") });
  const v3ReturnNote = lintModuleQuality("UsrMbContractsV3App_MbReturnNoteFormPageModule", v3("UsrMbContractsV3App_MbReturnNoteFormPageModule.js"));
  check("quality: a handler that returns before calling next (the record opens its own page) and returns next.handle(request) on every other path keeps the chain",
    () => [v3Form, v3List].every((p) => p.unreadable.length === 0 && count(p, R.handlerWithoutNext) === 0),
    () => [v3Form.findings, v3List.findings]);
  check("quality: the return-note module as saved before the repair — its bare comparisonType is found at its line",
    () => v3ReturnNote.unreadable.length === 0 && at(v3ReturnNote, R.numericComparisonType).join() === "20",
    () => v3ReturnNote.findings);

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
  // A page that imports its own module, filed by the read-back, with nothing in it to report: every row closes.
  const ownModule = { UsrOrder_FormPageModule: 'define("UsrOrder_FormPageModule", [], function() { return {}; });' };
  const cleanBuilt = Object.assign(built(`[${handler("usr.ApplyButtonClicked", "const x = 1;")}]`), { modules: ownModule });
  Object.assign(cleanBuilt.pages.main, { schemaName: "UsrOrder_FormPage", deps: '["AbConstants", "UsrOrder_FormPageModule"]' });
  const clean = renderVerify(result, opts, cleanBuilt);
  check("verify: a clean page closes every Code quality row ✅ (the advisory one never reads ⚠)",
    () => ROW_RULES.every((rule) => rule === R.unusedResourceString
      ? !/⚠ verify/.test(rowLine(clean.markdown, rule)) : /✅ Done/.test(rowLine(clean.markdown, rule))),
    () => clean.markdown.split("\n").filter((l) => l.includes("[code-quality]")));
  const unread = renderVerify(result, opts, { ...cleanBuilt, modules: undefined });
  check("verify: a page whose own module was not filed holds the module rows, naming the module and `reads/modules/` — never a ✅ nobody earned",
    () => MODULE_BODY_RULES.every((rule) => /⚠ verify/.test(rowLine(unread.markdown, rule)) && rowLine(unread.markdown, rule).includes("UsrOrder_FormPageModule")
      && /reads\/modules/.test(rowLine(unread.markdown, rule))),
    () => unread.markdown.split("\n").filter((l) => l.includes("[code-quality]")));
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
  // The page also imports its own module, so the own-module row closes too.
  const cleanModule = renderVerify(result, opts, (() => { const b = withModules('["UsrClean_FormPageModule", "UsrCleanModule"]', {
    UsrClean_FormPageModule: 'define("UsrClean_FormPageModule", [], function() { return {}; });',
    UsrCleanModule: 'define("UsrCleanModule", [], function() { return { x: 1 }; });' }); b.pages.main.schemaName = "UsrClean_FormPage"; return b; })());
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
  // THE RUN'S MODULES. A benchmark run built the page modules the contract asks for and still left: two note pages
  // with no module of their own and four handlers copied between them, the same status id and the same selection
  // helpers declared in two modules, a wrapper the code bypassed five times, and exports nobody imports. Each is a
  // run-wide check, fed by the module bodies the read-back files under `built.modules`.
  {
    const GUID = "3a8b2f10-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
    // A page's own findings and the run's module record for it, read together the way the Code quality rows read them.
    const lint = (...a) => { const run = lintRunQuality(...a); return new Map([...new Set([...run.keys(), ...run.modules.keys()])].map((k) => [k, {
      findings: [...(run.get(k)?.findings || []), ...runModuleLint(run, k).findings], unreadable: [...(run.get(k)?.unreadable || []), ...runModuleLint(run, k).unreadable] }])); };
    const thin = (arg) => handler("crt.HandleViewModelInitRequest", `await ${arg}.init(request.$context);`);
    const copied = handler("crt.HandleViewModelAttributeChangeRequest",
      "if (request.attributeName === \"Amount\") { const total = request.$context.Amount * 2; request.$context.Total = total; }");
    const page = (schemaName, deps, handlers, args) => ({ schemaName, deps: JSON.stringify(deps), handlers: `[${handlers}]`, ...(args ? { args } : {}) });
    const selected = "function selectedIds(list) { const out = []; for (const row of list || []) { if (row && row.selected) out.push(row.id); } return out; }";
    const mod = (name, deps, args, body, exportsSrc) =>
      `define("${name}", ${JSON.stringify(deps)}, function(${args}) {\n${body}\nreturn ${exportsSrc};\n});`;
    const totals = mod("UsrTotals", ["@creatio-devkit/common"], "sdk",
      "function processRequest(r) { return sdk.HandlerChainService.instance.process(r); }\nfunction sum(rows) { return rows.length; }",
      "{ processRequest, sum }");
    const badModules = {
      UsrApp_FormPageModule: mod("UsrApp_FormPageModule", ["@creatio-devkit/common", "UsrTotals"], "sdk, totals",
        `const CLOSED = "${GUID}";\n${selected}\nasync function init($context) { await sdk.HandlerChainService.instance.process({ type: "crt.LoadDataRequest", $context }); return totals.sum([CLOSED]); }`,
        "{ init, selectedIds }"),
      UsrApp_ListPageModule: mod("UsrApp_ListPageModule", [], "",
        `const CLOSED_STATUS = "${GUID}";\n${selected}\nfunction init($context) { return selectedIds($context.Items).length && CLOSED_STATUS; }`,
        "{ init }"),
      UsrTotals: totals,
    };
    const goodModules = {
      UsrApp_FormPageModule: mod("UsrApp_FormPageModule", ["UsrTotals"], "totals",
        "async function init($context) { await totals.processRequest({ type: \"crt.LoadDataRequest\", $context }); return totals.sum([totals.CLOSED]); }",
        "{ init }"),
      UsrApp_ListPageModule: mod("UsrApp_ListPageModule", ["UsrTotals"], "totals",
        "function init($context) { return totals.selectedIds($context.Items).length && totals.CLOSED; }", "{ init }"),
      UsrTotals: mod("UsrTotals", ["@creatio-devkit/common"], "sdk",
        `const CLOSED = "${GUID}";\n${selected}\nfunction processRequest(r) { return sdk.HandlerChainService.instance.process(r); }\nfunction sum(rows) { return rows.length; }`,
        "{ CLOSED, selectedIds, processRequest, sum }"),
    };
    const pages = (noteDeps, noteHandlers, noteArgs) => ({
      main: page("UsrApp_FormPage", ["UsrApp_FormPageModule"], thin("formPage"), "(formPage)"),
      list: page("UsrApp_ListPage", ["UsrApp_ListPageModule"], thin("listPage"), "(listPage)"),
      "child:Delivery": page("UsrApp_DeliveryPage", noteDeps("UsrApp_DeliveryPageModule"), noteHandlers("deliveryPage"), noteArgs("deliveryPage")),
      "child:Return": page("UsrApp_ReturnPage", noteDeps("UsrApp_ReturnPageModule"), noteHandlers("returnPage"), noteArgs("returnPage")),
    });
    const sharedOnly = [() => ["@creatio-devkit/common", "UsrTotals"], () => copied, () => "(sdk, totals)"];
    const bad = lint(pages(...sharedOnly), DEFAULT_QUALITY_THRESHOLDS, new Set(), badModules);
    const goodNoteModule = (n, k = 2) => mod(n, ["UsrTotals"], "totals", `function onAmount($context) { $context.Total = $context.Amount * ${k}; }`, "{ onAmount }");
    const good = lint(pages((m) => [m],
      (arg) => handler("crt.HandleViewModelAttributeChangeRequest", `if (request.attributeName === "Amount") ${arg}.onAmount(request.$context);`), (arg) => `(${arg})`),
    DEFAULT_QUALITY_THRESHOLDS, new Set(), { ...goodModules,
      UsrApp_DeliveryPageModule: goodNoteModule("UsrApp_DeliveryPageModule"), UsrApp_ReturnPageModule: goodNoteModule("UsrApp_ReturnPageModule", 3) });
    const at = (run) => Object.fromEntries([...run].map(([k, p]) => [k, (p?.findings || []).map((f) => f.rule + " " + f.text)]));
    const MODULE_RULES = [R.pageWithoutModule, R.duplicateHandlerAcrossPages, R.duplicateAcrossModules, R.sharedValueInTwoModules,
      R.unusedModuleExport, R.wrappedCallInlined];

    check("modules: a page with handlers and no `<PageSchema>Module` of its own is reported, each one — a shared module alone is not its module",
      () => count(bad.get("child:Delivery"), R.pageWithoutModule) === 1 && count(bad.get("child:Return"), R.pageWithoutModule) === 1
        && count(bad.get("main"), R.pageWithoutModule) === 0 && count(bad.get("list"), R.pageWithoutModule) === 0,
      () => at(bad));
    check("modules: a handler copied verbatim from another page is reported on the copying page only",
      () => count(bad.get("child:Return"), R.duplicateHandlerAcrossPages) === 1 && count(bad.get("child:Delivery"), R.duplicateHandlerAcrossPages) === 0,
      () => at(bad));
    check("modules: a function declared in two modules is reported once, on the page whose own module holds the copy, naming the original",
      () => { const f = bad.get("list").findings.filter((x) => x.rule === R.duplicateAcrossModules);
        return f.length === 1 && /UsrApp_FormPageModule/.test(f[0].text) && count(bad.get("main"), R.duplicateAcrossModules) === 0; },
      () => at(bad));
    check("modules: a record id declared in two modules is reported once — a value the run's pages share lives in one module",
      () => { const f = [...bad.values()].flatMap((p) => p.findings.filter((x) => x.rule === R.sharedValueInTwoModules));
        return f.length === 1 && f[0].text.includes(GUID) && /UsrApp_FormPageModule/.test(f[0].text) && /UsrApp_ListPageModule/.test(f[0].text); },
      () => at(bad));
    check("modules: an export no page or other module uses is reported on the module's page; an export a page calls is not",
      () => { const f = bad.get("main").findings.filter((x) => x.rule === R.unusedModuleExport);
        return f.length === 1 && /selectedIds/.test(f[0].text) && !/\binit\b/.test(f[0].text); },
      () => at(bad));
    check("modules: a call written out although a module export wraps exactly it is reported, naming the wrapper",
      () => { const f = bad.get("main").findings.filter((x) => x.rule === R.wrappedCallInlined);
        return f.length === 1 && /UsrTotals\.processRequest/.test(f[0].text) && /HandlerChainService\.instance\.process/.test(f[0].text); },
      () => at(bad));
    check("modules: the same run written the way the contract asks — own modules, one shared module, every export used — has none of the module findings",
      () => [...good.values()].every((p) => MODULE_RULES.every((r) => count(p, r) === 0)),
      () => at(good));
    check("modules: without module bodies only the page-side checks run, and nothing claims a module was checked",
      () => { const r = lint(pages(...sharedOnly));
        return count(r.get("child:Delivery"), R.pageWithoutModule) === 1
          && [...r.values()].every((p) => [R.duplicateAcrossModules, R.sharedValueInTwoModules, R.unusedModuleExport, R.wrappedCallInlined].every((x) => count(p, x) === 0)); });
    check("modules: an unreadable module body is named, never silently skipped",
      () => { const r = lint(pages((m) => [m], (a) => thin(a), (a) => `(${a})`), DEFAULT_QUALITY_THRESHOLDS, new Set(),
        { ...goodModules, UsrApp_DeliveryPageModule: "define(\"UsrApp_DeliveryPageModule\", [], function() { return {", UsrApp_ReturnPageModule: goodNoteModule("UsrApp_ReturnPageModule", 3) });
        return r.get("child:Delivery").unreadable.some((u) => /UsrApp_DeliveryPageModule/.test(u)); },
      () => null);
    check("modules: every module rule has its Code quality row",
      () => MODULE_RULES.every((r) => QUALITY_ROW_RULES.some((row) => row.rule === r)));

    // Through the verify table, not just the lint: the module bodies reach `runQualityOf` and the owning page's rows.
    const verifyRoot = (mods) => ({ pages: { main: { ...page("UsrApp_FormPage", ["UsrApp_FormPageModule"], thin("formPage")),
      parentSchemaName: "PageWithTabsFreedomTemplate", viewConfig: { items: [] }, validators: "{}", converters: "{}" } }, modules: mods });
    const rowOf = (md, rule) => md.split("\n").find((l) => l.includes(`[code-quality] ${rule} —`)) || "";
    const badTable = renderVerify(result, opts, verifyRoot(badModules)).markdown;
    const goodTable = renderVerify(result, opts, verifyRoot(goodModules)).markdown;
    check("modules (verify): with module bodies in the payload the owning page's module rows block, and the clean modules close them",
      () => [R.sharedValueInTwoModules, R.unusedModuleExport, R.wrappedCallInlined].every((r) => /⚠ verify/.test(rowOf(badTable, r)) && /✅ Done/.test(rowOf(goodTable, r))),
      () => [R.sharedValueInTwoModules, R.unusedModuleExport, R.wrappedCallInlined].map((r) => [rowOf(badTable, r), rowOf(goodTable, r)]));
    const unreadableModule = renderVerify(result, opts, verifyRoot({ UsrApp_FormPageModule: "define(\"UsrApp_FormPageModule\", [], function() { return {" })).markdown;
    check("modules (verify): an unreadable module blocks the rows module code can break — a rule about the page's handlers alone still judges them",
      () => /⚠ verify/.test(rowOf(unreadableModule, R.unusedModuleExport)) && /⚠ verify/.test(rowOf(unreadableModule, R.catchLogOnly))
        && /✅ Done/.test(rowOf(unreadableModule, R.nestedFunctions)),
      () => [rowOf(unreadableModule, R.unusedModuleExport), rowOf(unreadableModule, R.catchLogOnly), rowOf(unreadableModule, R.nestedFunctions)]);
    const codeless = renderVerify(result, opts, { pages: { main: { schemaName: "UsrApp_FormPage", deps: "[]", viewConfig: { items: [] } } }, modules: badModules }).markdown;
    check("modules (verify): a page with no code of its own that owns a module finding keeps its page rows unchecked — never a pass",
      () => /confirm on-stand/.test(rowOf(codeless, R.catchLogOnly)) && /⚠ verify/.test(rowOf(codeless, R.sharedValueInTwoModules)),
      () => [rowOf(codeless, R.catchLogOnly), rowOf(codeless, R.sharedValueInTwoModules)]);
    const noSchema = renderVerify(result, opts, { pages: { main: { handlers: `[${thin("formPage")}]`, deps: "[]" } }, modules: {} }).markdown;
    check("modules (verify): a page with handlers and no schema name is NOT CHECKED for its own module — never a pass",
      () => /confirm on-stand/.test(rowOf(noSchema, R.pageWithoutModule)) && /could not be checked/.test(rowOf(noSchema, R.pageWithoutModule)),
      () => rowOf(noSchema, R.pageWithoutModule));

    // Unused exports: only the run's own page modules are judged — a project module also serves pages outside the run.
    const projectModule = mod("UsrProjectConstants", [], "", `const CLOSED = "${GUID}";`, "{ CLOSED }");
    const withProject = lint({ main: page("UsrApp_FormPage", ["UsrApp_FormPageModule"], thin("formPage")) }, DEFAULT_QUALITY_THRESHOLDS, new Set(),
      { UsrApp_FormPageModule: mod("UsrApp_FormPageModule", [], "", "function init(c) { return c; }\nfunction spare() { return 1; }", "{ init, spare }"), UsrProjectConstants: projectModule },
      new Set(["UsrProjectConstants"]), true);
    check("modules: an unused export of a module the run built is reported; one of a declared project module (projectConventions) is not",
      () => { const f = withProject.get("main").findings.filter((x) => x.rule === R.unusedModuleExport).map((x) => x.text);
        return f.length === 1 && /spare/.test(f[0]); },
      () => withProject.get("main").findings);
    // A shared module of another app (no run page's prefix) can serve pages outside the run, whose imports nothing
    // here sees: its exports are never judged.
    const withShared = lint({ main: page("UsrApp_FormPage", ["UsrApp_FormPageModule", "UsrShared"], thin("formPage"), "(formPage, shared)") },
      DEFAULT_QUALITY_THRESHOLDS, new Set(), { UsrApp_FormPageModule: mod("UsrApp_FormPageModule", [], "", "function init(c) { return c; }", "{ init }"),
        UsrShared: mod("UsrShared", [], "", `const CLOSED = "${GUID}";
function spare() { return 1; }`, "{ CLOSED, spare }") });
    check("modules: an unused export of a shared module without the run's app prefix is not reported — only the run's own modules are judged",
      () => [...withShared.values()].every((p) => count(p, R.unusedModuleExport) === 0),
      () => [...withShared.values()]);
    // The binding a page names in `args` decides which module `x.export` reads from.
    const bound = (call) => lint({ main: { ...page("UsrApp_FormPage", ["UsrApp_FormPageModule"], handler("crt.HandleViewModelInitRequest", `${call}(request.$context);`)), args: "(formPage)" } },
      DEFAULT_QUALITY_THRESHOLDS, new Set(), { UsrApp_FormPageModule: mod("UsrApp_FormPageModule", [], "", "function init(c) { return c; }", "{ init }") }).get("main");
    check("modules: with the page's `args`, only a read through the module's own binding counts as a use",
      () => count(bound("formPage.init"), R.unusedModuleExport) === 0 && count(bound("other.init"), R.unusedModuleExport) === 1,
      () => [bound("formPage.init").findings, bound("other.init").findings]);
    // A page handler that writes out a wrapped call is reported on the page; an unexported wrapper says to export it.
    const hiddenTotals = mod("UsrTotals", ["@creatio-devkit/common"], "sdk", "function processRequest(r) { return sdk.HandlerChainService.instance.process(r); }", "{}");
    const pageInlines = lint({ main: page("UsrApp_FormPage", ["@creatio-devkit/common", "UsrApp_FormPageModule", "UsrTotals"],
      handler("crt.HandleViewModelInitRequest", "await sdk.HandlerChainService.instance.process({ type: \"crt.LoadDataRequest\", $context: request.$context });"), "(sdk, formPage, totals)") },
    DEFAULT_QUALITY_THRESHOLDS, new Set(), { UsrApp_FormPageModule: mod("UsrApp_FormPageModule", [], "", "function init(c) { return c; }", "{ init }"), UsrTotals: hiddenTotals }).get("main");
    check("modules: a page handler writing out a call a module function wraps is reported on the page, and an unexported wrapper says to export it",
      () => pageInlines.findings.some((f) => f.rule === R.wrappedCallInlined && f.text.startsWith("the page calls") && /export it and call it/.test(f.text)),
      () => pageInlines.findings);
    check("modules: a body the bounded walk refuses is named unreadable before any other walk runs over it",
      () => { const deep = "define(\"UsrApp_FormPageModule\", [], function() { const x = " + "[".repeat(1200) + "]".repeat(1200) + "; return {}; });";
        const r = lint({ main: page("UsrApp_FormPage", ["UsrApp_FormPageModule"], thin("formPage")) }, DEFAULT_QUALITY_THRESHOLDS, new Set(), { UsrApp_FormPageModule: deep });
        return r.get("main").unreadable.some((u) => /UsrApp_FormPageModule/.test(u)); });

    // A wrapper FORWARDS its parameters. A one-call function with fixed arguments does one specific thing: it is no
    // wrapper of the API it calls, and other calls to that API are not "inlined" against it.
    const fixedArg = lint({ main: page("UsrApp_FormPage", ["UsrApp_FormPageModule"], thin("formPage"), "(formPage)") }, DEFAULT_QUALITY_THRESHOLDS, new Set(), {
      UsrApp_FormPageModule: mod("UsrApp_FormPageModule", ["@creatio-devkit/common", "UsrStatuses"], "sdk, statuses",
        "async function init($context) { await statuses.loadStatuses(); return sdk.HandlerChainService.instance.process({ type: \"crt.SaveRecordRequest\", $context }); }", "{ init }"),
      UsrStatuses: mod("UsrStatuses", ["@creatio-devkit/common"], "sdk",
        "function loadStatuses() { return sdk.HandlerChainService.instance.process({ type: \"crt.LoadDataRequest\", dataSourceName: \"StatusDS\" }); }", "{ loadStatuses }") });
    check("modules: a one-call function with fixed arguments wraps nothing — a different call to the same API is not reported against it",
      () => count(fixedArg.get("main"), R.wrappedCallInlined) === 0, () => fixedArg.get("main").findings);
    const otherRoot = lint({ main: page("UsrApp_FormPage", ["UsrApp_FormPageModule"], thin("formPage"), "(formPage)") }, DEFAULT_QUALITY_THRESHOLDS, new Set(), {
      UsrApp_FormPageModule: mod("UsrApp_FormPageModule", ["UsrCache"], "cache", "function init(c) { return cache.store.items.get(c); }", "{ init }"),
      UsrTotals: totals });
    check("modules: the wrapper's root is compared by the module it names — the same path on another module's object is not its call",
      () => count(otherRoot.get("main"), R.wrappedCallInlined) === 0, () => otherRoot.get("main").findings);

    // An export used through destructuring, or by handing the module object on, is used.
    const usedBy = (body) => lint({ main: page("UsrApp_FormPage", ["UsrApp_FormPageModule"], handler("crt.HandleViewModelInitRequest", body), "(formPage)") },
      DEFAULT_QUALITY_THRESHOLDS, new Set(), { UsrApp_FormPageModule: mod("UsrApp_FormPageModule", [], "", "function init(c) { return c; }\nfunction spare() { return 1; }", "{ init, spare }") }).get("main");
    check("modules: an export read through destructuring (`const { init } = formPage`) is used, the one not destructured is still reported",
      () => { const f = usedBy("const { init } = formPage; init(request.$context);").findings.filter((x) => x.rule === R.unusedModuleExport);
        return f.length === 1 && /spare/.test(f[0].text); },
      () => usedBy("const { init } = formPage; init(request.$context);").findings);
    check("modules: handing the module object on whole (`helper(formPage)`) counts every export as used",
      () => count(usedBy("helper(formPage, request.$context);"), R.unusedModuleExport) === 0,
      () => usedBy("helper(formPage, request.$context);").findings);

    // Two pages calling their OWN modules under the same local name are not copies; two pages calling the SAME module
    // under different names are.
    const router = (arg) => handler("crt.HandleViewModelAttributeChangeRequest", `if (request.attributeName === "Amount") await ${arg}.onAmount(request.$context, request.attributeName);`);
    const ownSameName = lint({
      "child:Delivery": page("UsrApp_DeliveryPage", ["UsrApp_DeliveryPageModule"], router("pageModule"), "(pageModule)"),
      "child:Return": page("UsrApp_ReturnPage", ["UsrApp_ReturnPageModule"], router("pageModule"), "(pageModule)") });
    const sharedTwoNames = lint({
      "child:Delivery": page("UsrApp_DeliveryPage", ["UsrApp_DeliveryPageModule", "UsrTotals"], router("totalsA"), "(own, totalsA)"),
      "child:Return": page("UsrApp_ReturnPage", ["UsrApp_ReturnPageModule", "UsrTotals"], router("totalsB"), "(own, totalsB)") });
    check("modules: handlers are compared by the module they call — the same local name for two own modules is no copy, two names for one shared module is",
      () => count(ownSameName.get("child:Return"), R.duplicateHandlerAcrossPages) === 0 && count(sharedTwoNames.get("child:Return"), R.duplicateHandlerAcrossPages) === 1,
      () => [ownSameName.get("child:Return").findings, sharedTwoNames.get("child:Return").findings]);
    check("modules: without the pages' `args` a thin router is not compared — its names cannot be told apart by module",
      () => { const r = lint({ a: page("UsrA_Page", ["UsrA_PageModule"], router("pageModule")), b: page("UsrB_Page", ["UsrB_PageModule"], router("pageModule")) });
        return count(r.get("b"), R.duplicateHandlerAcrossPages) === 0; });

    // The page-side binding path of unused exports, as get-page returns it.
    const bindingCase = (args, call) => lint({ main: page("UsrApp_FormPage", ["@creatio-devkit/common", "UsrApp_FormPageModule", "UsrOther"],
      handler("crt.HandleViewModelInitRequest", `${call}(request.$context);`), args) }, DEFAULT_QUALITY_THRESHOLDS, new Set(),
    { UsrApp_FormPageModule: mod("UsrApp_FormPageModule", [], "", "function init(c) { return c; }", "{ init }") }).get("main");
    check("modules (args): an export called through the name bound to its module is used",
      () => count(bindingCase("(sdk, formPage, other)", "formPage.init"), R.unusedModuleExport) === 0);
    check("modules (args): the same export read through a name bound to ANOTHER module does not count — the export is reported",
      () => count(bindingCase("(sdk, formPage, other)", "other.init"), R.unusedModuleExport) === 1);
    check("modules (args): unparseable args fall back to any `x.init` counting as a use — nothing invented",
      () => count(bindingCase("(sdk, [formPage])", "other.init"), R.unusedModuleExport) === 0);
  }

  // NEAR-COPIES AND SHARED CONSTANTS (module-lint-v3, a benchmark run's modules renamed). Every page there has its own
  // module and imports the shared one, and the exact-copy check is clean — yet functions and runs of statements repeat
  // across modules with other values, and named constants are declared in several modules.
  {
    const V3DIR = path.join(FIX, "module-lint-v3");
    const v3 = Object.fromEntries(fs.readdirSync(V3DIR).sort((a, b) => a.localeCompare(b)).map((f) => [f.replace(/\.js$/, ""), fs.readFileSync(path.join(V3DIR, f), "utf8")]));
    const SHARED = "UsrDemoV3App_ContractAmountModule";
    const pageFor = (mod) => ({ schemaName: mod.replace(/Module$/, ""), handlers: "[]", args: "(sdk, own, shared)",
      deps: JSON.stringify(["@creatio-devkit/common", mod, SHARED]) });
    const runFindings = (pages, modules) => {
      const run = lintRunQuality(pages, DEFAULT_QUALITY_THRESHOLDS, new Set(), modules);
      return [...run.modules.values()].flatMap((r) => r.findings);
    };
    const v3Findings = runFindings(Object.fromEntries(Object.keys(v3).filter((n) => n !== SHARED).map((n) => [n, pageFor(n)])), v3);
    const near = v3Findings.filter((f) => f.rule === R.duplicateAcrossModules).map((f) => f.text);
    const consts = v3Findings.filter((f) => f.rule === R.sharedValueInTwoModules).map((f) => f.text);
    const reports = (re) => near.filter((t) => re.test(t)).length === 1;
    check("near-copy: a function that is another module's function with a value made a parameter is reported",
      () => reports(/^`sendDataServiceQuery` of `\w+ReturnNoteFormPageModule` \(lines 20-26\) is `selectQuery` of `\w+ContractAmountModule`/), () => near);
    check("near-copy: a function that differs from another only in its entity and the column it writes is reported",
      () => reports(/^`closeContracts` of `\w+_ListPageModule` .* is `deactivateItems` of `\w+_FormPageModule`/), () => near);
    check("near-copy: an open-page call that takes its schema name from a constant in one module and a parameter in the other is reported",
      () => reports(/^`openContractFormPage` .* is `openChildPage`/), () => near);
    check("near-copy: the same request config inside two different functions is reported as lines of each",
      () => reports(/^lines 155-164 of `launchApprovalProcess` .* repeat lines 79-88 of `startApproval`/), () => near);
    check("near-copy: the same selection read at the top of two different functions is reported, once",
      () => reports(/^lines 53-57 of `readSelectedContractIds` .* repeat lines 251-255 of `readSelectedItemIds`/), () => near);
    check("near-copy: each pair is reported once — the runs inside a reported one are not reported again",
      () => near.length === 7 && near.every((t) => /keep one function in the shared module/.test(t)), () => near);
    const byText = (a, b) => a.localeCompare(b);
    const reversed = Object.fromEntries(Object.entries(v3).reverse());
    const reversedFindings = runFindings(Object.fromEntries(Object.keys(reversed).filter((n) => n !== SHARED).map((n) => [n, pageFor(n)])), reversed);
    check("near-copy: the modules listed in the reverse order give the same findings — which copy is the original does not depend on that order",
      () => JSON.stringify(reversedFindings.map((f) => f.text).sort(byText)) === JSON.stringify(v3Findings.map((f) => f.text).sort(byText)),
      () => reversedFindings.map((f) => f.text));
    const constNames = consts.map((t) => /^`(\w+) = /.exec(t)?.[1]).sort((a, b) => a.localeCompare(b));
    check("shared constants: a named constant declared with the same value in several modules is reported once, naming every module",
      () => constNames.join() === "AGGREGATION_SUM,CARD_STATE_ADD,CARD_STATE_EDIT,CONTRACT_ENTITY,DATA_VALUE_TYPE_BOOLEAN,DATA_VALUE_TYPE_GUID"
        && consts.find((t) => t.startsWith("`DATA_VALUE_TYPE_GUID")).split("(line").length === 4, () => consts);

    // What is NOT a near-copy.
    const mod = (name, body) => `define("${name}", ["@creatio-devkit/common", "UsrSharedModule"], function(sdk, shared) {\n${body}\nreturn {};\n});`;
    const twoModules = (a, b, sharedBody = "") => runFindings(
      { a: { schemaName: "UsrA_Page", handlers: "[]", deps: '["UsrA_PageModule"]' }, b: { schemaName: "UsrB_Page", handlers: "[]", deps: '["UsrB_PageModule"]' } },
      { UsrA_PageModule: mod("UsrA_PageModule", a), UsrB_PageModule: mod("UsrB_PageModule", b), UsrSharedModule: mod("UsrSharedModule", sharedBody) });
    const nearIn = (fs) => fs.filter((f) => f.rule === R.duplicateAcrossModules);
    const open = "function go(request) { return sdk.HandlerChainService.instance.process({ type: \"crt.OpenPageRequest\", schemaName: \"UsrX\", modelInitConfigs: [{ action: \"edit\", recordId: request.recordId }], $context: request.$context, scopes: [...request.scopes] }); }";
    const reload = "function go(request) { return sdk.HandlerChainService.instance.process({ type: \"crt.LoadDataRequest\", dataSourceName: \"PDS\", config: { loadType: \"reload\", useLastLoadParameters: true }, $context: request.$context, scopes: [...request.scopes] }); }";
    check("near-copy: two requests of the same size with different API keys are not copies — a camelCase key is what the code does",
      () => nearIn(twoModules(open, reload)).length === 0, () => twoModules(open, reload));
    check("near-copy: the same config under another request `type` is not a copy — the type names what the code does",
      () => nearIn(twoModules(open, open.replace("crt.OpenPageRequest", "usr.OpenPreviewRequest"))).length === 0);
    check("near-copy: the same request with only another schema name IS a copy",
      () => nearIn(twoModules(open, open.replace("\"UsrX\"", "\"UsrY\""))).length === 1);
    // The same request with only another value, once below the size floor and once above it (the open-page pair).
    const small = "function go(request) { return sdk.HandlerChainService.instance.process({ type: \"crt.A\", schemaName: \"UsrX\", $context: request.$context }); }";
    check("near-copy: the same small request with another value is below the size floor and is not reported",
      () => nearIn(twoModules(small, small.replace("\"UsrX\"", "\"UsrY\""))).length === 0
        && nearIn(twoModules(open, open.replace("\"UsrX\"", "\"UsrY\""))).length === 1);
    const sharedUpdate = "async function updateEach(entity, values, ids) { const model = await sdk.Model.create(entity); let failed = 0;"
      + " for (const id of ids) { try { await model.update(values, [{ type: \"primaryColumnValue\", value: id }]); } catch (e) { failed++; } } return { total: ids.length, failed }; }";
    const viaShared = twoModules("function close(ids) { return shared.updateEach(\"UsrContract\", { UsrStatus: 1 }, ids); }",
      "function off(ids) { return shared.updateEach(\"UsrItem\", { UsrIsActive: false }, ids); }", sharedUpdate);
    check("near-copy: two modules calling one shared helper with their own values are not copies",
      () => nearIn(viaShared).length === 0, () => nearIn(viaShared));
    const constCase = twoModules("const KIND = 1; const GUID_ID = \"3a8b2f10-1c2d-4e5f-8a9b-0c1d2e3f4a5b\";", "const KIND = 2; const GUID_ID = \"3a8b2f10-1c2d-4e5f-8a9b-0c1d2e3f4a5b\";");
    check("shared constants: the same name with another value is not reported; a record id is reported once, by the record-id check",
      () => constCase.filter((f) => f.rule === R.sharedValueInTwoModules).length === 1
        && constCase.some((f) => f.rule === R.sharedValueInTwoModules && f.text.includes("3a8b2f10")), () => constCase);

    // module-lint-v4: the next benchmark run, built with one shared module. What it still let through: a function
    // that is all of another one in a short form, a test of whether a value is set written another way, a value
    // declared again under another name, and exports of the shared module nothing uses.
    const V4DIR = path.join(FIX, "module-lint-v4");
    const v4 = Object.fromEntries(fs.readdirSync(V4DIR).sort((a, b) => a.localeCompare(b)).map((f) => [f.replace(/\.js$/, ""), fs.readFileSync(path.join(V4DIR, f), "utf8")]));
    const V4SHARED = "UsrDemoV4App_SharedModule";
    const v4Page = (mod) => ({ schemaName: mod.replace(/Module$/, ""), handlers: "[]", args: "(sdk, own, shared)",
      deps: JSON.stringify(["@creatio-devkit/common", mod, V4SHARED]) });
    const v4Findings = runFindings(Object.fromEntries(Object.keys(v4).filter((n) => n !== V4SHARED).map((n) => [n, v4Page(n)])), v4);
    const v4Of = (rule) => v4Findings.filter((f) => f.rule === rule).map((f) => f.text);
    const v4Near = v4Of(R.duplicateAcrossModules);
    check("near-copy (v4): a short function that is all of another one with another page name is reported — a small wrapper does not hide it",
      () => v4Near.filter((t) => /^`openContractFormPage` of `\w+_ListPageModule` \(lines 33-37\) is `openChildPage` of `\w+_FormPageModule`/.test(t)).length === 1, () => v4Near);
    check("near-copy (v4): `Boolean(x)` and `(x || 0) > 0` are one test of whether x is set — the availability functions are one function",
      () => v4Near.filter((t) => /^`refreshCloseSelectedAvailability` .* is `refreshDeactivateAvailability`/.test(t)).length === 1, () => v4Near);
    const v4Values = v4Of(R.sharedValueInTwoModules);
    check("shared values (v4): a string constant declared again under another name is reported, naming the name it has in each module",
      () => v4Values.filter((t) => /^`HISTORY_DATA_SOURCE = "DemoDocumentLogDS"` is declared in .*ReturnNoteFormPageModule` \(line 5\), `UsrDemoV4App_SharedModule` \(line 15, as `NOTE_HISTORY_DATA_SOURCE`\)/.test(t)).length === 1, () => v4Values);
    check("shared values (v4): a list of literals is one value whether it is an array or a Set",
      () => v4Values.filter((t) => /^`POST_STATE_ATTRIBUTES = \["PDS_DemoIsPosted", "CardState"\]` is declared in .*\(line 6\), `UsrDemoV4App_SharedModule` \(line 16\)/.test(t)).length === 1, () => v4Values);
    check("shared values (v4): the same string as an entity and as a column is two values — `CONTRACT_ENTITY` and `CHILD_CONTRACT_COLUMN` are not reported",
      () => v4Values.length === 2 && !v4Values.some((t) => /CHILD_CONTRACT_COLUMN/.test(t)), () => v4Values);
    const v4Unused = v4Of(R.unusedModuleExport).filter((t) => t.includes(V4SHARED));
    check("unused exports (v4): the run's own shared module is judged — the two approval constants nothing uses are reported, its used exports are not",
      () => v4Unused.map((t) => /^`(\w+)`/.exec(t)[1]).sort((a, b) => a.localeCompare(b)).join() === "APPROVAL_PROCESS_NAME,APPROVAL_PROCESS_RECORD_PARAMETER", () => v4Unused);
    // What the v4 rules do NOT report.
    const tiny = (name, attr) => `function ${name}(attributeName) { return attributeName === ${attr}; }`;
    check("near-copy: a whole function below the whole-function floor (one comparison) is not reported",
      () => nearIn(twoModules(tiny("isSelectionChange", "\"A\""), tiny("isItemsSelectionChange", "\"B\""))).length === 0);
    const avail = (test) => `async function refresh($context) { const selection = await $context.Selection; const any = selection?.type === "all" || ${test}; await $context.set("UsrDisabled", !any); }`;
    check("near-copy: a test against another number than zero is a different test, not `x` — `x > 1` is not `Boolean(x)`",
      () => nearIn(twoModules(avail("Boolean(selection?.selected?.length)"), avail("(selection?.selected?.length || 0) > 0"))).length === 1
        && nearIn(twoModules(avail("Boolean(selection?.selected?.length)"), avail("selection?.selected?.length > 1"))).length === 0);
    const renamed = twoModules("const SUM = 2; const LOG_SOURCE = \"UsrLogDS\";", "const AGGREGATION_SUM = 2; const HISTORY_SOURCE = \"UsrLogDS\";");
    check("shared values: a number under another name is not reported (a small number means nothing without its name); a string of the same kind is",
      () => { const t = renamed.filter((f) => f.rule === R.sharedValueInTwoModules).map((f) => f.text);
        return t.length === 1 && /`LOG_SOURCE = "UsrLogDS"` .* as `HISTORY_SOURCE`/.test(t[0]); }, () => renamed);
  }

  const src = fs.readFileSync(new URL("../../skills/classic-to-freedom-migration/engine/quality.mjs", import.meta.url), "utf8");
  check("quality: quality.mjs imports only engine siblings (no package)",
    () => { const from = [...src.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
      return from.length >= 2 && from.every((m) => m.startsWith("./")) && !/\bimport\s*\(/.test(src) && !/\brequire\s*\(/.test(src); });
}

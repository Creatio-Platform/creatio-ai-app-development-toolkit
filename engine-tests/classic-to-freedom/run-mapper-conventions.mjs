// PROJECT CONVENTIONS. A customer team named its requests `ab.`, imported its own helper module and
// kept every record id in constants modules; the migration wrote `usr.` requests and pasted raw GUIDs, because
// nothing the analysis found could reach a builder. These checks hold the carrier end to end: the `--plan` gate,
// the mapper's request names, the plan section and its record-id table, every task file, and the `--verify` rows.
// Imported and run by `run-mapper.mjs`, which hands it its `check` and the shared fixtures so the tally stays one number.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectConventionsIssues, constantsGuidIndex, conventionsOf, bundleDeps, bundleCustomNames, foreignNames,
  DEFAULT_REQUEST_PREFIX } from "../../skills/classic-to-freedom-migration/engine/conventions.mjs";
import { verifyRowKey, checklistGroups } from "../../skills/classic-to-freedom-migration/engine/designspec.mjs";
import { assembleBuilt } from "../../skills/classic-to-freedom-migration/engine/assemble.mjs";
import { syncTaskDir, renderTaskFile } from "../../skills/classic-to-freedom-migration/engine/tasks.mjs";

export function runConventionsChecks({ check, runMigration, runMigrate, renderVerify, checklistOpts, CLEAN_SEED, FULL_PLANMETA, FULL_SIGNALS,
  FULL_PLACEMENT, FULL_CONVENTIONS, FIX, ENGINE_DIR }) {
  const dir = path.join(FIX, "conventions");
  const body = (f) => fs.readFileSync(path.join(dir, f), "utf8");
  const DW = { resolved: true, requestPrefix: "ab", helperModules: ["AbClientHelperModule"], constantsModules: ["AbConstants", "AbCommonConstants"],
    source: "freedom-pages", evidence: "ab. — 7 requests on Page_OrderDelivery", confirmedBy: "plan" };
  const manifest = (conventions, extra = {}) => ({
    entity: "UsrOrder", seed: CLEAN_SEED, targetPackage: "UsrSU", planMeta: FULL_PLANMETA, signals: FULL_SIGNALS, placement: FULL_PLACEMENT,
    schemas: [{ pkg: "UsrOrders", body: body("UsrOrderPage.js") }], resources: { ApplyButtonCaption: "Apply" },
    ...(conventions ? { projectConventions: conventions } : {}),
    constantsModules: { AbConstants: { body: body("AbConstants.js") }, AbCommonConstants: body("AbCommonConstants.js") },
    ...extra,
  });
  const ab = runMigration(manifest(DW), { baseDir: dir });
  const section = (plan) => {
    const lines = plan.split("\n");
    const at = lines.indexOf("### Project conventions");
    const end = lines.findIndex((l, i) => i > at && /^### /.test(l));
    return at < 0 ? "" : lines.slice(at, end < 0 ? undefined : end).join("\n");
  };
  const dwSection = section(ab.plan);

  // AC 1 — the ab. project: the plan shows the prefix and the modules with evidence, the engine's requests use it.
  const requests = [...(ab.changeSet.requestHandlers || []).map((h) => h.request),
    ...(ab.changeSet.viewConfigDiff || []).map((o) => o.values?.clicked?.request).filter(Boolean)];
  check("conventions: a ab. project — every custom request the engine emits (button `clicked` + its published handler) uses `ab.`, none `usr.`",
    () => requests.length >= 2 && requests.every((r) => r === "ab.ApplyButtonClicked"), () => requests);
  check("conventions: the plan's Project conventions section shows the request prefix, the helper and constants modules and the evidence",
    () => ab.conventionsBlockers.length === 0 && /\| Request prefix \| `ab\.` \|/.test(dwSection) && /\| Helper modules \| `AbClientHelperModule` \|/.test(dwSection)
      && /`AbConstants`, `AbCommonConstants`/.test(dwSection) && /7 requests on Page_OrderDelivery/.test(dwSection)
      && /request handler/.test(ab.plan) && /ab\.ApplyButtonClicked/.test(ab.plan) && !/usr\.ApplyButtonClicked/.test(ab.plan),
    () => dwSection);
  check("conventions: without a recorded block the mapper keeps the engine default namespace",
    () => DEFAULT_REQUEST_PREFIX === "usr"
      && runMigration(manifest(null), { baseDir: dir }).changeSet.requestHandlers.every((h) => h.request === "usr.ApplyButtonClicked"));

  // AC 8 — record ids: every id the plan uses is shown with the constants path that holds it, every candidate listed.
  check("conventions: a record id a business rule compares against is listed with BOTH constants paths that hold it (a variable alias resolves to its return key; case is ignored)",
    () => /\| `3e7f3a3c-1a2b-4c5d-8e9f-0a1b2c3d4e5f` \| `AbConstants\.OrderStatus\.Approved` · `AbCommonConstants\.Statuses\.OrderApproved` \|/.test(dwSection),
    () => dwSection);
  const idx = constantsGuidIndex(manifest(DW));
  check("conventions: the GUID index reads nested return keys, variables the return reaches, and a variable it does not reach under its own name",
    () => idx.get("5c5c5c5c-0000-4000-8000-000000000005")?.[0] === "AbConstants.OrderType.Retail"
      && idx.get("1b7e3a3c-0000-4c5d-8e9f-0a1b2c3d4e5f")?.[0] === "AbConstants.OrderStatus.New"
      && idx.get("9a9a9a9a-0000-4000-8000-000000000009")?.[0] === "AbConstants.unreferenced.Legacy",
    () => Object.fromEntries(idx));
  check("conventions: an id only a constants module holds and nothing in the plan uses is NOT listed (no table of the whole module)",
    () => !/5c5c5c5c-0000/.test(dwSection));

  // module rows: one CHECKED row per declared module the Classic page imports; the rest stays informational.
  const groups = ab.checklist;
  check("conventions: the module-dep aggregate splits — one checked row per declared helper/constants module, platform deps stay one informational row",
    () => /\[module-dep\] AbConstants — project constants module/.test(groups) && /\[module-dep\] AbClientHelperModule — project helper module/.test(groups)
      && /\[module-dep\] BusinessRuleModule \|/.test(groups) && !/\[module-dep\] AbConstants, AbClientHelperModule/.test(groups),
    () => groups.split("\n").filter((l) => /module-dep/.test(l)));

  // AC 2 — no custom requests and SchemaNamePrefix = Usr: the verified fallback is a valid, approvable answer.
  const fallback = runMigration(manifest({ resolved: true, requestPrefix: "usr", source: "fallback", evidence: "no custom requests; SchemaNamePrefix = Usr", confirmedBy: "plan" }), { baseDir: dir });
  check("conventions: the verified fallback to `usr.` clears the gate and the plan says it is the fallback",
    () => fallback.conventionsBlockers.length === 0 && /verified fallback — no project namespace found — no custom requests; SchemaNamePrefix = Usr/.test(section(fallback.plan)),
    () => [fallback.conventionsBlockers, section(fallback.plan)]);
  check("conventions: a 'fallback' that names another prefix is refused — the fallback IS `usr`",
    () => projectConventionsIssues({ projectConventions: { ...FULL_CONVENTIONS, requestPrefix: "ab" } }).some((x) => /source is 'fallback' but requestPrefix is 'ab'/.test(x)));
  check("conventions: `crt` is the platform's namespace and never a project prefix; a dotted value is not a namespace",
    () => projectConventionsIssues({ projectConventions: { ...DW, validatorPrefix: "crt", constantsModules: [] } }).some((x) => /validatorPrefix is 'crt'/.test(x))
      && projectConventionsIssues({ projectConventions: { ...DW, requestPrefix: "ab.X", constantsModules: [] } }).some((x) => /is not a namespace/.test(x))
      && conventionsOf({ projectConventions: { ...DW, requestPrefix: "ab." } }).requestPrefix === "ab");

  // AC 3 — two namespaces: one question with counts; the user's answer clears it.
  const conflict = { ...DW, conflict: { ab: 7, usr: 2 } };
  const asked = runMigration(manifest(conflict), { baseDir: dir });
  const answered = runMigration(manifest({ ...conflict, confirmedBy: "user" }), { baseDir: dir });
  check("conventions: a namespace conflict blocks the plan until the user answers, and the plan asks ONE question with counts per namespace",
    () => asked.conventionsBlockers.length === 1 && /`ab\.` × 7, `usr\.` × 2\. Which one does this migration use\?/.test(section(asked.plan))
      && answered.conventionsBlockers.length === 0 && /answered by the user/.test(section(answered.plan)),
    () => ({ asked: asked.conventionsBlockers, answered: answered.conventionsBlockers }));

  // AC 4 — an earlier migration's record: shown side by side, a question only when it differs.
  const same = runMigration(manifest({ ...DW, previous: { folder: "migrations/orders-1", requestPrefix: "ab", helperModules: ["AbClientHelperModule"], constantsModules: ["AbConstants", "AbCommonConstants"] } }), { baseDir: dir });
  const differs = { ...DW, previous: { folder: "migrations/orders-1", requestPrefix: "usr", helperModules: [], constantsModules: ["AbConstants"] } };
  const diffAsked = runMigration(manifest(differs), { baseDir: dir });
  const diffAnswered = runMigration(manifest({ ...differs, confirmedBy: "user" }), { baseDir: dir });
  check("conventions: the same conventions as the earlier migration are reused without a question",
    () => same.conventionsBlockers.length === 0 && /Earlier migration \(`migrations\/orders-1`\):\*\* the same conventions — reused without a question/.test(section(same.plan)),
    () => section(same.plan));
  check("conventions: conventions that differ from the earlier migration show both and block until the user chooses",
    () => diffAsked.conventionsBlockers.length === 1 && /differ from the earlier migration in 'migrations\/orders-1'/.test(diffAsked.conventionsBlockers[0])
      && /`usr\.`, helpers none, constants `AbConstants` — differs \(request prefix usr\. → ab\./.test(section(diffAsked.plan))
      && /Question for the user:\*\* keep the earlier values/.test(section(diffAsked.plan))
      && diffAnswered.conventionsBlockers.length === 0 && /the user chose the values in the table above/.test(section(diffAnswered.plan)),
    () => ({ blockers: diffAsked.conventionsBlockers, section: section(diffAsked.plan) }));

  // AC 5 — no resolved block: `--plan` exits non-zero with the gate message, in the plan and on stderr.
  const noBlock = runMigrate(["-", "--plan"], { input: JSON.stringify({ ...manifest(null), schemas: [{ pkg: "UsrOrders", body: body("UsrOrderPage.js") }] }) });
  check("conventions gate: a --plan run with NO manifest.projectConventions is INCOMPLETE (exit 2), the banner and stderr name it",
    () => noBlock.status === 2 && /PLAN INCOMPLETE — project conventions not settled/.test(noBlock.stdout || "")
      && /project conventions not settled: projectConventions not resolved/.test(noBlock.stderr || ""),
    () => ({ status: noBlock.status, stderr: (noBlock.stderr || "").slice(0, 300) }));
  const withBlock = runMigrate(["-", "--plan"], { input: JSON.stringify(manifest(DW)), cwd: dir });
  check("conventions gate: the same run with a resolved block exits 0",
    () => withBlock.status === 0 && !/PLAN INCOMPLETE/.test(withBlock.stdout || ""), () => ({ status: withBlock.status, stderr: (withBlock.stderr || "").slice(0, 300) }));
  check("conventions gate: a declared constants module with no body is a blocker — the plan cannot map its ids",
    () => projectConventionsIssues({ projectConventions: DW, constantsModules: {} }).filter((x) => /has no body in manifest\.constantsModules/.test(x)).length === 2);
  check("conventions gate: an unresolved block is reported alone — no rule is evaluated over a missing fact",
    () => projectConventionsIssues({ projectConventions: { ...DW, resolved: false } }).length === 1);

  // AC 6 — every build and fix task file carries the block.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "conv-tasks-"));
  try {
    const set = syncTaskDir(tmp, ab, {});
    const files = (set.tasks || []).map((t) => fs.readFileSync(path.join(tmp, t.file), "utf8"));
    const repair = renderTaskFile({ ...set.tasks[0], kind: "repair", repairRound: 1, cause: "verify:main" }, { planVersion: ab.planVersion, projectConventions: ab.projectConventions });
    const blockOk = (t) => /## Project conventions/.test(t) && /`ab\.<Name>Request`/.test(t) && /`AbClientHelperModule`/.test(t)
      && /`AbConstants`, `AbCommonConstants` — reference existing record ids through them/.test(t) && /Freedom pages CAN import these client-unit modules/.test(t)
      && t.indexOf("## Project conventions") < t.indexOf("## Deliverables");
    check("conventions: every build task file `--tasks` writes carries the conventions block, before its deliverables",
      () => files.length > 0 && files.every(blockOk), () => ({ n: files.length, first: files[0]?.slice(0, 1500) }));
    check("conventions: a fix (repair) task file carries the same block",
      () => blockOk(repair), () => repair.slice(0, 1500));
    check("conventions: a run with no recorded conventions writes no block",
      () => !/## Project conventions/.test(renderTaskFile(set.tasks[0], { planVersion: ab.planVersion })));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  // AC 7 + 8 — `--verify` reads the built bundle: foreign names block, declared modules are checked against SCHEMA_DEPS.
  const opts = checklistOpts(manifest(DW));
  const page = (extra) => ({ parentSchemaName: "PageWithTabsFreedomTemplate", packageName: "UsrSU", schemaUId: "11111111-1111-4111-8111-111111111111",
    viewConfig: { items: [{ type: "crt.Button", name: "ApplyButton", clicked: { request: "ab.ApplyButtonClicked" } }] }, ...extra });
  const NS_ROW = /Custom requests, validators and converters use the project namespace `ab\.`/;
  const rowLine = (md, re) => md.split("\n").find((l) => re.test(l)) || "";
  const foreign = renderVerify(ab, opts, { pages: { main: page({ handlers: '[{ request: "usr.ApplyButtonClicked", handler: async (r, n) => n?.handle(r) }]',
    converters: '{ "usr.ToUpper": { converter: (v) => v } }', validators: "{}", deps: '["@creatio-devkit/common"]' }) } });
  check("verify: a request and a converter outside the project namespace make the namespace row a blocking ⚠ that keeps the page from complete",
    () => /⚠ verify/.test(rowLine(foreign.markdown, NS_ROW)) && /request .usr\.ApplyButtonClicked./.test(rowLine(foreign.markdown, NS_ROW))
      && /converter .usr\.ToUpper./.test(rowLine(foreign.markdown, NS_ROW)) && !foreign.complete,
    () => rowLine(foreign.markdown, NS_ROW));
  const nsLabel = "Custom requests, validators and converters use the project namespace `ab.`";
  const decided = renderVerify(ab, opts, { pages: { main: page({ handlers: '[{ request: "usr.ApplyButtonClicked" }]', deps: "[]" }) } }, new Set([verifyRowKey("main", nsLabel)]));
  check("verify: a D<N> decision recorded on the namespace row closes it (it is not left open)",
    () => !/⚠ verify/.test(rowLine(decided.markdown, NS_ROW)) && (decided.decided || []).some((d) => NS_ROW.test(d.label || JSON.stringify(d))),
    () => ({ row: rowLine(decided.markdown, NS_ROW), decided: decided.decided }));
  const clean = renderVerify(ab, opts, { pages: { main: page({ handlers: '[{ request: "crt.SaveRecordRequest" }, { request: "ab.ApplyButtonClicked" }]',
    validators: '{ "ab.Positive": { validator: () => null } }', converters: "{}", deps: '["@creatio-devkit/common","AbConstants","AbClientHelperModule"]' }) } });
  check("verify: `crt.` and the project namespace pass — the namespace row is ✅",
    () => /✅ Done/.test(rowLine(clean.markdown, NS_ROW)), () => rowLine(clean.markdown, NS_ROW));
  const MOD_ROW = /\[module-dep\] AbConstants — project constants module/;
  check("verify: a declared constants module in the built page's SCHEMA_DEPS closes its row ✅; missing from them it is a blocking ⚠",
    () => /✅ Done/.test(rowLine(clean.markdown, MOD_ROW)) && /⚠ verify/.test(rowLine(foreign.markdown, MOD_ROW))
      && /not in the built page's SCHEMA_DEPS/.test(rowLine(foreign.markdown, MOD_ROW)),
    () => [rowLine(clean.markdown, MOD_ROW), rowLine(foreign.markdown, MOD_ROW)]);
  const noBundle = renderVerify(ab, opts, { pages: { main: page({}) } });
  check("verify: a bundle without deps/handlers cannot be checked — the two rows are confirm-on-stand, never a silent ✅",
    () => /confirm on-stand/.test(rowLine(noBundle.markdown, NS_ROW)) && /confirm on-stand/.test(rowLine(noBundle.markdown, MOD_ROW)),
    () => [rowLine(noBundle.markdown, NS_ROW), rowLine(noBundle.markdown, MOD_ROW)]);

  // the bundle readers, on get-page's SOURCE strings and on parsed values
  check("bundle readers: deps from the source string or a list; requests, validators and converters from source or parsed shapes",
    () => bundleDeps({ deps: '["a", "B"]' }).join() === "a,B" && bundleDeps({ deps: ["x"] }).join() === "x" && bundleDeps({}) === null
      && bundleCustomNames({ validators: { "ab.V": {} }, converters: '{"ab.C": {}}' }, JSON.stringify([{ request: "ab.A" }])).request.has("ab.A")
      && bundleCustomNames({ validators: { "ab.V": {} } }, null).validator.has("ab.V") && bundleCustomNames({}, null) === null
      && foreignNames(bundleCustomNames({}, "[{request: 'zz.Q'}]"), { request: "ab", validator: "ab", converter: "ab" })[0]?.name === "zz.Q");

  // AC 9 — the hard-coded literal is gone from the mapper.
  check("conventions: no `usr.` literal remains in mapper.mjs",
    () => !/usr\./.test(fs.readFileSync(path.join(ENGINE_DIR, "mapper.mjs"), "utf8")));

  // One case for a namespace: a prefix copied as `AB` (or `Usr` from SchemaNamePrefix) is the namespace `ab`, so
  // the requests the mapper emits and the names --verify accepts agree.
  const upper = runMigration(manifest({ ...DW, requestPrefix: "AB" }), { baseDir: dir });
  check("conventions: a prefix recorded in another case is the same namespace — emitted lower-case, and `Ab.X` on the page is not foreign",
    () => upper.conventionsBlockers.length === 0 && upper.changeSet.requestHandlers.every((h) => h.request === "ab.ApplyButtonClicked")
      && foreignNames({ request: new Set(["Ab.Go", "AB.Stop"]), validator: new Set(), converter: new Set() }, { request: "ab", validator: "ab", converter: "ab" }).length === 0,
    () => upper.changeSet.requestHandlers);
  check("conventions: the namespace is the text before the FIRST dot — `ab.Order.Approve` is in it, `zz.Order.Approve` and a name with no namespace are not",
    () => foreignNames({ request: new Set(["ab.Order.Approve", "zz.Order.Approve", "NoNamespace"]), validator: null, converter: null }, { request: "ab" })
      .map((f) => f.name).join() === "zz.Order.Approve,NoNamespace");
  const handlersOnly = renderVerify(ab, opts, { pages: { main: page({ handlers: '[{ request: "ab.ApplyButtonClicked" }]', deps: "[]" }) } });
  check("verify: a bundle that carries handlers but no validators/converters cannot claim them clean — the namespace row is confirm-on-stand, naming what is missing",
    () => /confirm on-stand/.test(rowLine(handlersOnly.markdown, NS_ROW)) && /validators \/ converters/.test(rowLine(handlersOnly.markdown, NS_ROW)),
    () => rowLine(handlersOnly.markdown, NS_ROW));

  // AC 8 — one constants object exposed under two return keys: both paths are candidates.
  const aliasIdx = constantsGuidIndex({ projectConventions: { ...DW, constantsModules: ["AliasConstants"] }, constantsModules: { AliasConstants:
    'define("AliasConstants", [], function() { var s = { Done: "7d7d7d7d-0000-4000-8000-000000000007" }; return { OrderStatus: s, Status: s }; });' } });
  check("conventions: an object exposed under two return keys is indexed under BOTH paths",
    () => (aliasIdx.get("7d7d7d7d-0000-4000-8000-000000000007") || []).join() === "AliasConstants.OrderStatus.Done,AliasConstants.Status.Done",
    () => Object.fromEntries(aliasIdx));

  // AC 8 — a decision closes a per-module row, like the namespace row.
  const modLabel = "[module-dep] AbConstants — project constants module: import it in the page's SCHEMA_DEPS";
  const modDecided = renderVerify(ab, opts, { pages: { main: page({ handlers: "[]", validators: "{}", converters: "{}", deps: "[]" }) } }, new Set([verifyRowKey("main", modLabel)]));
  check("verify: a D<N> decision recorded on a per-module row closes it although the page does not import the module",
    () => !/⚠ verify/.test(rowLine(modDecided.markdown, MOD_ROW)) && (modDecided.decided || []).some((d) => MOD_ROW.test(d.label || JSON.stringify(d))),
    () => ({ row: rowLine(modDecided.markdown, MOD_ROW), decided: modDecided.decided }));
  check("conventions: the informational rest row keeps the aggregate's own id, so the plan's member line and earlier statuses still address it",
    () => /module-dep:AbConstants, AbClientHelperModule, BusinessRuleModule/.test(JSON.stringify(rowIds(ab, opts))),
    () => rowIds(ab, opts));

  // AC 7 / AC 8 through the REAL payload path: get-page's bundle.json → assembleBuilt → built.json → --verify.
  const asDir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-assemble-"));
  try {
    const w = (f, v) => fs.writeFileSync(path.join(asDir, f), typeof v === "string" ? v : JSON.stringify(v));
    fs.mkdirSync(path.join(asDir, "reads"));
    w("reads/index.json", { version: 1, reads: [{ kind: "pageMeta", file: "reads/01-meta-main.json", pageKey: "main", what: "m" },
      { kind: "pageBundle", file: "reads/02-bundle-main.json", pageKey: "main", what: "b" }] });
    w("reads/01-meta-main.json", { page: { schemaName: "UsrOrder_FormPage", schemaUId: "11111111-1111-4111-8111-111111111111", packageName: "UsrSU", parentSchemaName: "PageWithTabsFreedomTemplate" } });
    w("reads/02-bundle-main.json", { name: "UsrOrder_FormPage", viewConfig: [], handlers: '[{ request: "usr.ApplyButtonClicked" }]',
      deps: '["@creatio-devkit/common","AbConstants"]', validators: "{}", converters: "{}" });
    const { built } = assembleBuilt(asDir);
    const viaFile = renderVerify(ab, opts, built);
    check("verify via assembleBuilt: deps, handlers, validators and converters reach built.json — the namespace row blocks on `usr.`, the module row closes on the imported AbConstants",
      () => /⚠ verify/.test(rowLine(viaFile.markdown, NS_ROW)) && /✅ Done/.test(rowLine(viaFile.markdown, MOD_ROW)),
      () => [rowLine(viaFile.markdown, NS_ROW), rowLine(viaFile.markdown, MOD_ROW), Object.keys(built.pages?.main || {})]);
  } finally { fs.rmSync(asDir, { recursive: true, force: true }); }

  // AC 1 — a fold (a child page opened from a detail) inherits the root's conventions: its own bundle carries none.
  const child = { schemas: [{ pkg: "CH", body: 'define("CH",[],function(){return{entitySchemaName:"CH",diff:[{operation:"insert",name:"GF",parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"GF"}},{operation:"insert",name:"GF2",parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"GF2"}},{operation:"insert",name:"GoBtn",parentName:"ProfileContainer",propertyName:"items",values:{itemType:5,caption:{bindTo:"Resources.Strings.GoCaption"},click:{bindTo:"onGo"}}}],methods:{onGo:function(){}}};});' }],
    seed: CLEAN_SEED, resources: { GoCaption: "Go" } };
  const withChild = runMigration({ ...manifest(DW), schemas: [{ pkg: "P", body: 'define("P",[],function(){return{entitySchemaName:"UsrOrder",diff:[{operation:"insert",name:"PT",parentName:"Tabs",values:{itemType:15,isTab:true}},{operation:"insert",name:"PD",parentName:"PT",values:{itemType:2}}],details:{PD:{schemaName:"CHDetail",entitySchemaName:"CH",filter:{detailColumn:"X",masterColumn:"Id"}}}};});' }],
    childPageSchemas: { CH: child, CHPage: child } }, { baseDir: dir });
  const childSpec = (withChild.childPages || []).map((c) => c.spec || "").join("\n");
  check("conventions: a child page folded from a detail names its requests in the ROOT's prefix, and the root alone gates",
    () => /ab\.GoBtnClicked/.test(childSpec) && !/usr\.GoBtnClicked/.test(withChild.plan) && withChild.conventionsBlockers.length === 0,
    () => ({ blockers: withChild.conventionsBlockers, spec: childSpec.split("\n").filter((l) => /GoBtn/.test(l)) }));
}

// The deliverable ids of every row a run publishes.
const rowIds = (result, opts) => checklistGroups(result, opts).flatMap((g) => (g.rows || g.items || []).map((r) => r.deliverableId)).filter(Boolean);

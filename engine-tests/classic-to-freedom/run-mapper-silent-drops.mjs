// NO SILENT DROPS. A Classic feature reaches the build as a task row or a person's recorded decision, never as a
// builder's note. Four cases, each from `fixtures/silent-drops/`:
//   1. a re-added "Edit selected records" menu item is a plan row and a ⚠ Confirm item, and a builder note that drops
//      it (or claims Freedom has no equivalent without naming what was checked) keeps the run from completing;
//   2. a row highlight is a ⚠ Confirm item with its own checklist row, and a plan row left without one fails `--verify`;
//   3. a per-row lock on row actions is discovered as a plan row and asked;
//   4. a question that states a Classic fact cites the Classic source, and a judge's ruling on it gates `--verify`.
// Imported and run by `run-mapper.mjs`, which hands it its `check` and the shared fixtures so the tally stays one number.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanDetailFeatures, checklistOpts, BULK_EDIT_ITEM } from "../../skills/classic-to-freedom-migration/engine/migrate.mjs";
import { checklistGroups, resolveVk, renderVerify, detailFeatureRows, DETAIL_FEATURE_KIND } from "../../skills/classic-to-freedom-migration/engine/designspec.mjs";
import { parseDecisionRecords, provenanceIssues, premisesOf } from "../../skills/classic-to-freedom-migration/engine/directives.mjs";
import { builderDropReasons } from "../../skills/classic-to-freedom-migration/engine/report.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(DIR, "fixtures", "silent-drops");
const read = (f) => fs.readFileSync(path.join(FIX, f), "utf8");

// A record page with one tab holding the two related lists.
const PAGE = `define("OrderPage",[],function(){return{entitySchemaName:"X",details:{`
  + `History:{schemaName:"ProductHistoryDetail",entitySchemaName:"ProductLine",filter:{detailColumn:"Order",masterColumn:"Id"}},`
  + `Products:{schemaName:"ProductsDetail",entitySchemaName:"ProductLine",filter:{detailColumn:"Order",masterColumn:"Id"}}},diff:[`
  + `{operation:"insert",name:"T",parentName:"Tabs",propertyName:"tabs",values:{itemType:15,isTab:true}},`
  + `{operation:"insert",name:"History",parentName:"T",propertyName:"items",values:{itemType:2}},`
  + `{operation:"insert",name:"Products",parentName:"T",propertyName:"items",values:{itemType:2}}]};});`;

export function runSilentDropsChecks({ check, runMigration, CLEAN_SEED, FULL_SIGNALS, docPlanMeta }) {
  const manifest = { entity: "X", seed: CLEAN_SEED, schemas: [{ pkg: "P", body: PAGE }],
    detailSchemas: { ProductHistoryDetail: { body: read("ProductHistoryDetail.js"), editPage: false },
      ProductsDetail: { body: read("ProductsDetail.js"), editPage: false } },
    planMeta: docPlanMeta, signals: FULL_SIGNALS };
  const r = runMigration(manifest);
  const cs = r.changeSet;
  const asked = (cs.needsDecision || []).filter((n) => n.kind === DETAIL_FEATURE_KIND);
  const askedItem = (re) => asked.find((n) => re.test(n.item));
  const rows = detailFeatureRows(cs);
  const groups = checklistGroups(r, checklistOpts(manifest));
  const confirmRows = groups.filter((g) => g.title.startsWith("⚠ Confirm worklist")).flatMap((g) => g.rows);
  const confirmRow = (re) => confirmRows.find((x) => x.confirm?.kind === DETAIL_FEATURE_KIND && re.test(x.confirm.item));

  // 1 — bulk edit
  const products = scanDetailFeatures(read("ProductsDetail.js"));
  check("silent drops (bulk edit): a menu item rebuilt around `editSelectedRecords` is discovered as the tools-menu item \"Edit selected records\", once",
    () => products.toolsMenu.added.filter((i) => i === BULK_EDIT_ITEM).length === 1, () => products.toolsMenu);
  check("silent drops (bulk edit): it is a plan row that names its ⚠ Confirm item, a `detail-feature` question that asks for what was checked, and a checklist row of its own",
    () => rows.some((x) => x[1] === `Tools menu: + ${BULK_EDIT_ITEM}` && /decide in ⚠ Confirm `\[detail-feature\] ProductsDetail · Tools menu: \+ Edit selected records`/.test(x[3]))
      && /get-component-info/.test(askedItem(/Edit selected records/)?.reason || "")
      && !!confirmRow(/Edit selected records/)?.id,
    () => ({ rows: rows.filter((x) => /Tools menu/.test(x[1])), asked, confirm: confirmRows.map((x) => x.confirm) }));

  // 2 — row highlight
  check("silent drops (row highlight): a row colour is a ⚠ Confirm item and an evidence row in the checklist, so a build task owns it",
    () => !!askedItem(/^ProductHistoryDetail · Row styling$/) && confirmRow(/Row styling/)?.vk?.type === "evidence",
    () => ({ asked, confirm: confirmRows.map((x) => x.confirm) }));
  const stripped = { ...r, changeSet: { ...cs, needsDecision: cs.needsDecision.filter((n) => !(n.kind === DETAIL_FEATURE_KIND && /Row styling/.test(n.item))) } };
  const unrouted = checklistGroups(stripped, checklistOpts(manifest)).flatMap((g) => g.rows).filter((x) => x.vk?.type === "unrouted");
  const verdict = unrouted[0] ? resolveVk(unrouted[0].vk, {}) : [];
  check("silent drops (row highlight): a plan row that asks for a decision but has no ⚠ Confirm item is a row `--verify` reads ❌ MISSING",
    () => unrouted.length === 1 && /Row styling/.test(unrouted[0].vk.item) && verdict[0] === "❌ MISSING" && verdict[2] === "missing",
    () => ({ unrouted, verdict }));
  check("silent drops (row highlight, anti-vacuity): the routed plan has no unrouted row",
    () => !groups.flatMap((g) => g.rows).some((x) => x.vk?.type === "unrouted"));

  // 3 — per-row lock
  const history = scanDetailFeatures(read("ProductHistoryDetail.js"));
  check("silent drops (row lock): the Copy and Delete getters bound to a per-row `Enabled`, and an active-row hook that sets state, are a per-row lock",
    () => history.rowLock.join("|") === "Copy (`getCopyRecordMenuItem`)|Delete (`getDeleteRecordMenuItem`)|the active row (`onActiveRowChange`)",
    () => history.rowLock);
  check("silent drops (row lock): the lock is a plan row and a ⚠ Confirm item with its own checklist row",
    () => rows.some((x) => x[1] === "Row lock" && /getCopyRecordMenuItem/.test(x[2]) && /decide in ⚠ Confirm/.test(x[3]))
      && !!askedItem(/Row lock/) && !!confirmRow(/Row lock/),
    () => ({ rows: rows.filter((x) => x[1] === "Row lock"), asked }));
  const switchedOff = scanDetailFeatures(`define("D",[],function(){return{methods:{getCopyRecordMenuItem:Terrasoft.emptyFn,
    onActiveRowChange:function(){this.callParent(arguments);}}};});`);
  check("silent drops (row lock, anti-vacuity): a getter switched off for every row and an active-row hook that sets nothing are no per-row lock",
    () => switchedOff.rowLock.length === 0, () => switchedOff.rowLock);

  // 4 — decision premises
  const records = parseDecisionRecords(read("decisions.md"));
  const issues = provenanceIssues(records);
  check("silent drops (premise): a question that states a Classic fact with no `Classic source:` is a provenance issue; a question that states none is not",
    () => issues.some((x) => x.key === "D4" && /Classic source:/.test(x.problem)) && !issues.some((x) => x.key === "D5"),
    () => issues);
  const cited = parseDecisionRecords(read("decisions.md").replace("- Quote: \"19 accept",
    "- Classic source: reads/04-bundle-child-product.json — Amount is a MultiCurrencyEdit (PrimaryAmount, Currency, CurrencyRate)\n- Quote: \"19 accept"));
  check("silent drops (premise): with the Classic source cited, the issue is gone and the premise is listed with its source",
    () => !provenanceIssues(cited).some((x) => x.key === "D4")
      && premisesOf(cited).map((p) => `${p.id}:${/MultiCurrencyEdit/.test(p.source)}`).join(",") === "D4:true",
    () => premisesOf(cited));
  const run4 = runMigration(manifest, { decisionRecords: cited });
  const opts4 = checklistOpts(manifest, { decisionRecords: cited });
  const premiseRow = (built) => renderVerify(run4, opts4, built).rows.find((x) => x.group === "Decision premises");
  const pages = { main: { viewConfig: { items: [] } } };
  const unjudged = premiseRow({ pages });
  const rejected = premiseRow({ pages, judge: { "premise:D4": { convincing: false, why: "the Classic Amount is a multi-currency editor" } } });
  const upheld = premiseRow({ pages, judge: { "premise:D4": { convincing: true } } });
  const orphans = renderVerify(run4, opts4, { pages, judge: { "premise:D4": { convincing: true } } }).orphans;
  check("silent drops (premise): `--verify` holds the premise to a judge — unjudged is ⚠, a false premise is ❌ MISSING asking the question again, a true one is ✅",
    () => unjudged?.outcome === "unverified" && rejected?.outcome === "missing" && /ask `D4` again/.test(rejected?.evidence || "")
      && /multi-currency editor/.test(rejected?.evidence || "") && upheld?.outcome === "ok" && !orphans.includes("premise:D4"),
    () => ({ unjudged, rejected, upheld, orphans }));

  // the builder's notes
  const decisions = new Map([["D5", "Refresh button"]]);
  const reasons = builderDropReasons([{ file: "task-main-page-build.md", notes: read("builder-notes.md") }], decisions);
  check("silent drops (builder): a note that drops a Classic feature, and a no-equivalent claim with no `Checked (row N)`, each keep the run from completing",
    () => reasons.length === 1 && /^2 note lines/.test(reasons[0]) && /Dropped/.test(reasons[0]) && /per-row lock/.test(reasons[0]),
    () => reasons);
  check("silent drops (builder, anti-vacuity): a line naming a recorded decision, a `Decision needed` question and a claim backed by `Checked (row N)` are no drop",
    () => !/Not ported here/.test(reasons[0] || "") && !/Decision needed/.test(reasons[0] || "") && !/Row 9/.test(reasons[0] || ""),
    () => reasons);
}

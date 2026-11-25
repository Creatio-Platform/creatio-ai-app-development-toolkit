// DETAIL FEATURES. A related list is more than its columns: users filter it with a toggle or a date, export it,
// edit selected rows, see coloured rows and summaries. These checks hold every one of those to a plan row with a
// Freedom target, the questions it raises to ⚠ Confirm, the details a customer or vendor template layer declares to
// an "inherited — decide" row, an unplaced detail to an approval row, a field Classic made read-only to a read-only
// build, and the built page to `--verify`.
// Imported and run by `run-mapper.mjs`, which hands it its `check` and the shared fixtures so the tally stays one number.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectAddMode, scanDetailFeatures, classifyDetailFilters, DETAIL_FEATURE_SCAN_FNS, attachDetailFeatureDecisions,
  applySummariesDirective } from "../../skills/classic-to-freedom-migration/engine/migrate.mjs";
import { checklistGroups, resolveVk, verifyCtx, renderDesignSpec, detailFeatureRows } from "../../skills/classic-to-freedom-migration/engine/designspec.mjs";
import { GROUP_PHASE } from "../../skills/classic-to-freedom-migration/engine/tasks.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_MD = path.join(DIR, "../../skills/classic-to-freedom-migration/SKILL.md");

// A record page with one tab holding the given details, and an optional extra diff.
const page = (details, extraDiff = "") => `define("XPage",[],function(){return{entitySchemaName:"X",details:${details},diff:[`
  + `{operation:"insert",name:"T",parentName:"Tabs",propertyName:"tabs",values:{itemType:15,isTab:true}},`
  + `{operation:"insert",name:"D",parentName:"T",propertyName:"items",values:{itemType:2}}${extraDiff}]};});`;
const oneDetail = (schema, entity) => `{D:{schemaName:"${schema}",entitySchemaName:"${entity}",filter:{detailColumn:"X",masterColumn:"Id"}}}`;

// A toggle the user flips, saved to the profile: the "only active rows" switch of a limits list.
const TOGGLE_BODY = `define("LimitDetail",[],function(){return{entitySchemaName:"Limit",
  attributes:{"IsActiveOnly":{dataValueType:Terrasoft.DataValueType.BOOLEAN,value:true}},
  methods:{
    init:function(){this.loadFiltersFromProfile();this.callParent(arguments);},
    onActiveOnlyButtonClick:function(){this.$IsActiveOnly=!this.$IsActiveOnly;this.saveFiltersToProfile();this.reloadGridData();},
    getFilters:function(){var filters=this.callParent(arguments);if(this.$IsActiveOnly){this.addActiveFilter(filters);}return filters;},
    addActiveFilter:function(filters){filters.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.GREATER_OR_EQUAL,"EndDate",new Date()));}
  },
  diff:[{operation:"insert",name:"ActiveOnlyButton",parentName:"Detail",propertyName:"tools",values:{itemType:5,click:{bindTo:"onActiveOnlyButtonClick"}}}]};});`;
// A date the user picks in the list's tools; the rows active on that date are shown. Plus coloured rows and a tools
// menu without its access-rights item.
const DATE_BODY = `define("ActiveProductDetail",[],function(){return{entitySchemaName:"ActiveProduct",
  attributes:{"OnDate":{"dataValueType":Terrasoft.DataValueType.DATE,"type":Terrasoft.ViewModelColumnType.VIRTUAL_COLUMN}},
  methods:{
    initData:function(){this.$OnDate=new Date();this.on("change:OnDate",this.reloadGridData,this);this.callParent(arguments);},
    prepareResponseCollectionItem:function(item){this.callParent(arguments);if(!this.Ext.isEmpty(item.$Comment)){item.customStyle={"background":"#eeeeee"};}},
    getFilters:function(){var filters=this.callParent(arguments);if(this.$OnDate){var g=this.Terrasoft.createFilterGroup();
      g.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.GREATER_OR_EQUAL,"EndDate",this.$OnDate));
      g.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.LESS_OR_EQUAL,"StartDate",this.$OnDate));
      g.addItem(filters);filters=g;}return filters;},
    getRecordRightsSetupMenuItem:Terrasoft.emptyFn,
    getExportToExcelMenuVisibility:function(){return false;},
    isMultiSelectVisible:function(){return false;}
  },
  diff:[{operation:"insert",name:"OnDate",parentName:"Detail",propertyName:"tools",index:0,values:{markerValue:"OnDate"}}]};});`;
// Fixed filters only: every value is a literal or a constant, nothing the user changes.
const FIXED_BODY = `define("FixedDetail",[],function(){return{entitySchemaName:"Req",methods:{getFilters:function(){var f=this.callParent(arguments);
  f.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.EQUAL,"Category",C.Service));
  f.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.EQUAL,"Owner",this.get("MasterRecordId")));return f;}}};});`;
// One literal filter and one the user drives, in the same getFilters.
const MIXED_BODY = `define("MixedDetail",[],function(){return{entitySchemaName:"Req",
  attributes:{"OnDate":{dataValueType:Terrasoft.DataValueType.DATE}},
  methods:{initData:function(){this.$OnDate=new Date();this.callParent(arguments);},
    getFilters:function(){var f=this.callParent(arguments);
      f.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.EQUAL,"Category",C.Service));
      f.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.GREATER_OR_EQUAL,"EndDate",this.$OnDate));return f;}},
  diff:[{operation:"insert",name:"OnDate",parentName:"Detail",propertyName:"tools",values:{markerValue:"OnDate"}}]};});`;
// The inline toggle: the attribute GUARDS the filter (an `if`), it is not the filter's value.
const INLINE_TOGGLE_BODY = `define("InlineDetail",[],function(){return{entitySchemaName:"Limit",
  attributes:{"IsActiveOnly":{dataValueType:Terrasoft.DataValueType.BOOLEAN,value:true}},
  methods:{onActiveOnlyButtonClick:function(){this.$IsActiveOnly=!this.$IsActiveOnly;this.reloadGridData();},
    getFilters:function(){var f=this.callParent(arguments);
      if(this.$IsActiveOnly){f.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.EQUAL,"IsActive",true));}
      return f;}},
  diff:[{operation:"insert",name:"ActiveOnlyButton",parentName:"Detail",propertyName:"tools",values:{click:{bindTo:"onActiveOnlyButtonClick"}}}]};});`;
// A date read into a local first, and the filter's value is the local.
const ALIAS_BODY = `define("AliasDetail",[],function(){return{entitySchemaName:"Line",
  attributes:{"OnDate":{dataValueType:Terrasoft.DataValueType.DATE}},
  methods:{initData:function(){this.set("OnDate",new Date());this.callParent(arguments);},
    getFilters:function(){var f=this.callParent(arguments);var d=this.get("OnDate");
      f.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.GREATER_OR_EQUAL,"EndDate",d));return f;}},
  diff:[{operation:"insert",name:"OnDateEdit",parentName:"Detail",propertyName:"tools",values:{bindTo:"OnDate"}}]};});`;
// A toggle in getFilters beside a helper that adds a literal filter: both halves must reach the plan.
const TOGGLE_AND_HELPER_BODY = `define("BothDetail",[],function(){return{entitySchemaName:"Req",
  attributes:{"IsActiveOnly":{dataValueType:Terrasoft.DataValueType.BOOLEAN,value:true}},
  methods:{onActiveOnlyButtonClick:function(){this.$IsActiveOnly=!this.$IsActiveOnly;this.reloadGridData();},
    getFilters:function(){var f=this.callParent(arguments);
      if(this.$IsActiveOnly){f.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.EQUAL,"IsActive",true));}
      this.addCategoryFilter(f);return f;},
    addCategoryFilter:function(f){f.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.EQUAL,"Category",C.Service));}},
  diff:[{operation:"insert",name:"ActiveOnlyButton",parentName:"Detail",propertyName:"tools",values:{click:{bindTo:"onActiveOnlyButtonClick"}}}]};});`;
// Fixed filters two helpers below getFilters — an IN filter and a comparison filter — read body-wide.
const DEEP_FIXED_BODY = `define("DeepDetail",[],function(){return{entitySchemaName:"Req",
  methods:{getFilters:function(){var f=this.callParent(arguments);this.addScopeFilters(f);return f;},
    addScopeFilters:function(f){this.addOwnerFilters(f);},
    addOwnerFilters:function(f){f.addItem(this.Terrasoft.createColumnInFilterWithParameters("Owner",[this.$MasterId]));
      f.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.EQUAL,"Category",C.Service));}}};});`;
// A toggle in getFilters beside a fixed IN filter two helpers down: the IN column stays fixed.
const DEEP_IN_BESIDE_TOGGLE_BODY = `define("DeepToggleDetail",[],function(){return{entitySchemaName:"Req",
  attributes:{"IsActiveOnly":{dataValueType:Terrasoft.DataValueType.BOOLEAN,value:true}},
  methods:{onActiveOnlyButtonClick:function(){this.$IsActiveOnly=!this.$IsActiveOnly;this.reloadGridData();},
    getFilters:function(){var f=this.callParent(arguments);
      if(this.$IsActiveOnly){f.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.EQUAL,"IsActive",true));}
      this.addScopeFilters(f);return f;},
    addScopeFilters:function(f){this.addOwnerFilters(f);},
    addOwnerFilters:function(f){f.addItem(this.Terrasoft.createColumnInFilterWithParameters("Owner",[this.$MasterId]));}},
  diff:[{operation:"insert",name:"ActiveOnlyButton",parentName:"Detail",propertyName:"tools",values:{click:{bindTo:"onActiveOnlyButtonClick"}}}]};});`;
// A getFilters the engine cannot read (a reference, not a function body): the body's column filters still signal FIXED.
const UNREADABLE_FILTERS_BODY = `define("OpaqueDetail",[],function(){return{entitySchemaName:"Req",
  methods:{getFilters:helpers.filters,
    scope:function(f){f.addItem(this.Terrasoft.createColumnInFilterWithParameters("Owner",[this.$MasterId]));}}};});`;
// The master list's selected row, set while the grid data loads and on a sandbox message: no control on this list
// changes it, so its filter is fixed.
const MASTER_ROW_BODY = `define("ChildRowsDetail",[],function(){return{entitySchemaName:"Line",
  methods:{initGridData:function(){this.callParent(arguments);this.set("Subscription",this.Terrasoft.GUID_EMPTY);
      this.sandbox.subscribe("ActiveRowChanged",function(row){this.set("Subscription",row);this.reloadGridData();},this);},
    getFilters:function(){var f=this.callParent(arguments);var id=this.get("Subscription");
      if(id){f.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.EQUAL,"Subscription",id));}return f;}}};});`;
// A name and a bindTo outside the diff — a config a method returns, a comment — are no control.
const NOT_A_CONTROL_BODY = `define("ConfigDetail",[],function(){return{entitySchemaName:"Req",
  methods:{getOwnerColumnConfig:function(){return {name:"Owner",bindTo:"Owner"};},
    onOwnerPicked:function(v){this.$Owner=v;},
    getFilters:function(){/* the toolbar once had {bindTo:"Owner"} */var f=this.callParent(arguments);
      f.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.EQUAL,"Owner",this.get("Owner")));return f;}}};});`;
// An attribute set only while the list initialises: the user never changes it, so its filter is fixed.
const INIT_ONLY_BODY = `define("MineDetail",[],function(){return{entitySchemaName:"Task",
  methods:{init:function(){this.$CurrentContact=Terrasoft.SysValue.CURRENT_USER_CONTACT.value;this.callParent(arguments);},
    getFilters:function(){var f=this.callParent(arguments);
      f.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.EQUAL,"Owner",this.$CurrentContact));return f;}}};});`;
// Two layers: the vendor layer filters by a date the user picks; the customer layer adds a literal filter and calls up.
const VENDOR_LAYER = `define("LayeredDetail",[],function(){return{entitySchemaName:"Line",
  attributes:{"OnDate":{dataValueType:Terrasoft.DataValueType.DATE}},
  methods:{getFilters:function(){var f=this.callParent(arguments);
    f.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.GREATER_OR_EQUAL,"EndDate",this.$OnDate));return f;}},
  diff:[{operation:"insert",name:"OnDate",parentName:"Detail",propertyName:"tools",values:{markerValue:"OnDate"}}]};});`;
const CUSTOMER_LAYER = `define("LayeredDetail",[],function(){return{methods:{getFilters:function(){var f=this.callParent(arguments);
    f.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.EQUAL,"Category",C.Service));return f;}}};});`;
// Row actions taken away: the list must declare its own row toolbar.
const NO_COPY_BODY = `define("NoCopyDetail",[],function(){return{entitySchemaName:"Line",methods:{getCopyRecordMenuItem:Terrasoft.emptyFn}};});`;
// Summaries present but switched off.
const SUMMARY_OFF_BODY = `define("SumOffDetail",["SummaryModuleV2"],function(){return{entitySchemaName:"Line",methods:{getSummaryVisible:function(){return false;}}};});`;
const PLAIN_BODY = `define("PlainDetail",[],function(){return{entitySchemaName:"Note",methods:{}};});`;
const SUMMARY_BODY = `define("SumDetail",["SummaryModuleV2"],function(){return{entitySchemaName:"Line",methods:{getSummaryVisible:function(){return true;}},
  mixins:{GroupEdit:"Terrasoft.RecordsGroupEditing"}};});`;

export function runDetailFeaturesChecks({ check, runMigration, CLEAN_SEED, FULL_SIGNALS, docPlanMeta }) {
  const run = (schema, entity, body, extra = {}) => runMigration({ entity: "X", seed: CLEAN_SEED,
    schemas: [{ pkg: "P", body: extra.page || page(oneDetail(schema, entity)) }],
    detailSchemas: { [schema]: { body, editPage: false } }, planMeta: docPlanMeta, signals: FULL_SIGNALS, ...extra.manifest });
  const detailOf = (r, schema) => r.changeSet.details.find((d) => d.detailSchema === schema);
  const features = (r) => r.plan.split("\n").filter((l) => l.startsWith("| ") && /Tools menu|Quick filter|Multi-select|Row styling|Summaries|Inherited detail/.test(l));

  // AC 1 — a toggle the user flips is a quick filter, not a fixed filter.
  const toggle = run("LimitDetail", "Limit", TOGGLE_BODY);
  const tq = detailOf(toggle, "LimitDetail")?.features?.quickFilters || [];
  check("detail features: a getFilters toggle the user flips → one quick filter (toggle), kept in the profile, element named after the detail",
    () => tq.length === 1 && tq[0].attribute === "IsActiveOnly" && tq[0].kind === "toggle" && tq[0].persisted === true && tq[0].element === "DQuickFilterByIsActiveOnly",
    () => tq);
  check("detail features: the toggle is NOT read as a fixed filter — no `FIXED list filters` instruction for that detail, and a `crt.QuickFilter` row in the plan",
    () => detailOf(toggle, "LimitDetail").addMode?.fixedFilters !== true && !/FIXED list filters/.test(toggle.plan)
      && features(toggle).some((l) => /Quick filter \(toggle\) `IsActiveOnly`/.test(l) && /`crt\.QuickFilter` `DQuickFilterByIsActiveOnly`/.test(l)),
    () => ({ addMode: detailOf(toggle, "LimitDetail").addMode, rows: features(toggle) }));
  const fixed = run("FixedDetail", "Req", FIXED_BODY);
  check("detail features: a getFilters with literal values only (and the master record id) stays a FIXED filter, with no quick filter",
    () => detailOf(fixed, "FixedDetail").addMode?.fixedFilters === true && (detailOf(fixed, "FixedDetail").features?.quickFilters || []).length === 0
      && /FIXED list filters on Category, Owner/.test(fixed.plan),
    () => ({ addMode: detailOf(fixed, "FixedDetail").addMode, features: detailOf(fixed, "FixedDetail").features }));
  const inline = run("InlineDetail", "Limit", INLINE_TOGGLE_BODY);
  const inlineDetail = detailOf(inline, "InlineDetail");
  check("detail features: a filter added inside `if (this.$Toggle)` belongs to the toggle's quick filter — no FIXED instruction for it",
    () => inlineDetail.features.quickFilters.map((q) => `${q.attribute}:${q.columns.join("+")}`).join(",") === "IsActiveOnly:IsActive"
      && inlineDetail.addMode?.fixedFilters !== true && !/FIXED list filters/.test(inline.plan),
    () => ({ addMode: inlineDetail.addMode, quick: inlineDetail.features.quickFilters }));
  const alias = run("AliasDetail", "Line", ALIAS_BODY);
  const aliasDetail = detailOf(alias, "AliasDetail");
  check("detail features: a filter whose value is a local holding the attribute belongs to the quick filter",
    () => aliasDetail.features.quickFilters.map((q) => `${q.attribute}:${q.kind}:${q.columns.join("+")}`).join(",") === "OnDate:date:EndDate"
      && aliasDetail.addMode?.fixedFilters !== true,
    () => ({ addMode: aliasDetail.addMode, quick: aliasDetail.features.quickFilters }));
  const both = run("BothDetail", "Req", TOGGLE_AND_HELPER_BODY);
  const bothDetail = detailOf(both, "BothDetail");
  check("detail features: a toggle beside a helper that adds a literal filter keeps BOTH — the quick filter on IsActive and FIXED on Category",
    () => bothDetail.features.quickFilters.map((q) => `${q.attribute}:${q.columns.join("+")}`).join(",") === "IsActiveOnly:IsActive"
      && bothDetail.addMode?.fixedFilters === true && bothDetail.addMode.filterCols.join(",") === "Category"
      && /FIXED list filters on Category/.test(both.plan) && features(both).some((l) => /Quick filter \(toggle\) `IsActiveOnly`/.test(l)),
    () => ({ addMode: bothDetail.addMode, quick: bothDetail.features.quickFilters }));
  const toggleHelper = detailOf(toggle, "LimitDetail");
  check("detail features: a helper called inside the toggle's `if` adds the toggle's columns, not fixed ones",
    () => toggleHelper.features.quickFilters[0]?.columns.join(",") === "EndDate" && toggleHelper.addMode?.fixedFilters !== true,
    () => ({ addMode: toggleHelper.addMode, quick: toggleHelper.features.quickFilters }));
  const initOnly = run("MineDetail", "Task", INIT_ONLY_BODY);
  const initDetail = detailOf(initOnly, "MineDetail");
  check("detail features: an attribute set only in init (no control changes it) is a FIXED filter, not a quick filter",
    () => initDetail.features.quickFilters.length === 0 && initDetail.addMode?.fixedFilters === true && initDetail.addMode.filterCols.join(",") === "Owner",
    () => ({ addMode: initDetail.addMode, quick: initDetail.features.quickFilters }));
  const layered = runMigration({ entity: "X", seed: CLEAN_SEED, schemas: [{ pkg: "P", body: page(oneDetail("LayeredDetail", "Line")) }],
    detailSchemas: { LayeredDetail: { bodies: [VENDOR_LAYER, CUSTOMER_LAYER], editPage: false } }, planMeta: docPlanMeta, signals: FULL_SIGNALS });
  const layeredDetail = detailOf(layered, "LayeredDetail");
  check("detail features: a quick filter in a lower layer's getFilters, reached through callParent, is kept beside the upper layer's fixed filter",
    () => layeredDetail.features.quickFilters.map((q) => `${q.attribute}:${q.columns.join("+")}`).join(",") === "OnDate:EndDate"
      && layeredDetail.addMode?.fixedFilters === true && layeredDetail.addMode.filterCols.join(",") === "Category",
    () => ({ addMode: layeredDetail.addMode, quick: layeredDetail.features.quickFilters }));
  const mixed = run("MixedDetail", "Req", MIXED_BODY);
  const mixedDetail = detailOf(mixed, "MixedDetail");
  check("detail features: a getFilters with one literal and one user-driven filter keeps BOTH halves — a quick filter on EndDate and a fixed filter on Category",
    () => mixedDetail.features.quickFilters.map((q) => `${q.attribute}:${q.columns.join("+")}`).join(",") === "OnDate:EndDate"
      && mixedDetail.addMode?.fixedFilters === true && mixedDetail.addMode.filterCols.join(",") === "Category"
      && /FIXED list filters on Category/.test(mixed.plan),
    () => ({ addMode: mixedDetail.addMode, quick: mixedDetail.features.quickFilters }));

  const deep = detailOf(run("DeepDetail", "Req", DEEP_FIXED_BODY), "DeepDetail");
  check("detail features: an IN filter and a comparison filter two helpers below getFilters stay FIXED, both columns named",
    () => deep.features.quickFilters.length === 0 && deep.addMode?.fixedFilters === true
      && [...deep.addMode.filterCols].sort((a, b) => a.localeCompare(b)).join(",") === "Category,Owner",
    () => ({ addMode: deep.addMode, quick: deep.features.quickFilters }));
  const opaque = detailOf(run("OpaqueDetail", "Req", UNREADABLE_FILTERS_BODY), "OpaqueDetail");
  check("detail features: a getFilters the engine cannot read still gives the fixed-filter signal with the body's columns",
    () => opaque.addMode?.fixedFilters === true && opaque.addMode.filterCols.join(",") === "Owner",
    () => opaque.addMode);
  const deepToggleRun = run("DeepToggleDetail", "Req", DEEP_IN_BESIDE_TOGGLE_BODY);
  const deepToggle = detailOf(deepToggleRun, "DeepToggleDetail");
  check("detail features: a deep fixed IN filter beside a quick filter keeps only the column no quick filter owns",
    () => deepToggle.features.quickFilters.map((q) => `${q.attribute}:${q.columns.join("+")}`).join(",") === "IsActiveOnly:IsActive"
      && deepToggle.addMode?.fixedFilters === true && deepToggle.addMode.filterCols.join(",") === "Owner"
      && /FIXED list filters on Owner/.test(deepToggleRun.plan),
    () => ({ addMode: deepToggle.addMode, quick: deepToggle.features.quickFilters }));

  const masterRow = detailOf(run("ChildRowsDetail", "Line", MASTER_ROW_BODY), "ChildRowsDetail");
  check("detail features: an attribute set by a grid-data load and a sandbox message (the master list's row) is a FIXED filter, not a quick filter",
    () => masterRow.features.quickFilters.length === 0 && masterRow.addMode?.fixedFilters === true && masterRow.addMode.filterCols.join(",") === "Subscription",
    () => ({ addMode: masterRow.addMode, quick: masterRow.features.quickFilters }));
  const notControl = detailOf(run("ConfigDetail", "Req", NOT_A_CONTROL_BODY), "ConfigDetail");
  check("detail features: a name or bindTo outside the detail's diff (a returned config, a comment) and a setter no control binds make no quick filter",
    () => notControl.features.quickFilters.length === 0 && notControl.addMode?.fixedFilters === true && notControl.addMode.filterCols.join(",") === "Owner",
    () => ({ addMode: notControl.addMode, quick: notControl.features.quickFilters }));

  // AC 2 — a date filter is a quick filter on its columns; a filter kept in the profile raises the persistence question.
  const date = run("ActiveProductDetail", "ActiveProduct", DATE_BODY);
  const dq = detailOf(date, "ActiveProductDetail")?.features?.quickFilters || [];
  check("detail features: a date the user picks in the list's tools → a date quick filter on EndDate and StartDate, not kept in the profile",
    () => dq.length === 1 && dq[0].attribute === "OnDate" && dq[0].kind === "date" && dq[0].columns.join(",") === "EndDate,StartDate" && dq[0].persisted === false,
    () => dq);
  check("detail features: only the filter Classic kept in the profile raises `detail-filter-persistence`",
    () => toggle.changeSet.needsDecision.some((n) => n.kind === "detail-filter-persistence" && /IsActiveOnly/.test(n.item) && /resets on every visit/.test(n.reason))
      && !date.changeSet.needsDecision.some((n) => n.kind === "detail-filter-persistence"),
    () => toggle.changeSet.needsDecision.filter((n) => n.kind === "detail-filter-persistence"));

  // AC 3 — summaries are a decision, unless a user directive already asked for them.
  const sum = run("SumDetail", "Line", SUMMARY_BODY);
  check("detail features: a detail with a summary module → a `detail-summaries` Decision needed and a Summaries row that says so",
    () => sum.changeSet.needsDecision.some((n) => n.kind === "detail-summaries" && /improvement over Classic, not parity/.test(n.reason))
      && features(sum).some((l) => /\| Summaries \|/.test(l) && /Decision needed/.test(l)),
    () => features(sum));
  // A copy of the summaries run's change set, so each directive below starts from the open question.
  const copyOfSum = () => ({ changeSet: { needsDecision: sum.changeSet.needsDecision.map((n) => ({ ...n })),
    details: sum.changeSet.details.map((d) => ({ ...d, features: d.features && { ...d.features } })) } });
  const directed = copyOfSum();
  applySummariesDirective([directed], [{ id: "D1", quote: "use the summaries component", expectation: "summaries built as crt.Summaries", scope: ["main"] }]);
  const dRows = detailFeatureRows(directed.changeSet).filter((r) => r[1] === "Summaries");
  check("detail features: a user directive for summaries removes the question and the Summaries row names the directive",
    () => !directed.changeSet.needsDecision.some((n) => n.kind === "detail-summaries")
      && directed.changeSet.details.find((d) => d.detailSchema === "SumDetail")?.features?.summariesDirective === "D1"
      && dRows.length === 1 && /crt\.Summaries.*user directive D1/.test(dRows[0][3]),
    () => ({ decisions: directed.changeSet.needsDecision.map((n) => n.kind), dRows }));
  const leavesOpen = (quote, expectation, scope = ["main"]) => {
    const r = copyOfSum();
    applySummariesDirective([r], [{ id: "D9", quote, expectation, scope }]);
    return r.changeSet.needsDecision.some((n) => n.kind === "detail-summaries");
  };
  check("detail features: only an explicit request for the summaries component answers the question — other mentions and declines leave it open",
    () => leavesOpen("hide what Classic did not have", "Freedom-only elements hidden")
      && leavesOpen("no summaries please", "keep the labels, no summaries component")
      && leavesOpen("keep the summary labels as Classic had", "summary labels kept")
      && leavesOpen("summaries are not wanted", "the summaries component is not wanted")
      && leavesOpen("add a summary of changes to the notes", "a summary of changes in the notes")
      && leavesOpen("keep plain labels instead of summaries", "plain labels instead of the summaries component")
      && !leavesOpen("build the totals with crt.Summaries", "crt.Summaries on the page"));
  check("detail features: a summaries directive applies only to the pages its scope covers",
    () => leavesOpen("use the summaries component", "crt.Summaries on the child page", ["child:Line"])
      && !leavesOpen("use the summaries component", "crt.Summaries everywhere", ["run"]));
  const bar = { details: [], needsDecision: [], viewConfigDiff: [
    { name: "SummaryItemsContainer", parentName: "Header", values: { type: "crt.FlexContainer" } },
    { name: "TotalLabel", parentName: "SummaryItemsContainer", values: { type: "crt.Label" } },
    { name: "SumLabel", parentName: "SummaryItemsContainer", values: { type: "crt.Label" } }] };
  attachDetailFeatureDecisions(bar);
  check("detail features: labels in a summary container of the page (a Classic summary bar) → one `detail-summaries` Decision needed and a Summaries row for the bar",
    () => bar.needsDecision.length === 1 && bar.needsDecision[0].kind === "detail-summaries" && bar.needsDecision[0].item === "SummaryItemsContainer"
      && /2 labels/.test(bar.needsDecision[0].reason) && bar.summaryBar?.container === "SummaryItemsContainer"
      && detailFeatureRows(bar).some((r) => r[0] === "SummaryItemsContainer" && /Decision needed/.test(r[3])),
    () => bar.needsDecision);

  const sumOff = run("SumOffDetail", "Line", SUMMARY_OFF_BODY);
  check("detail features: summaries the detail switches off (getSummaryVisible returns false) raise no question",
    () => detailOf(sumOff, "SumOffDetail").features.summaries === false && !sumOff.changeSet.needsDecision.some((n) => n.kind === "detail-summaries"));

  // AC 4 — the standard tools menu is one line; a change to it is a row.
  const plain = run("PlainDetail", "Note", PLAIN_BODY);
  check("detail features: an untouched tools menu is ONE `standard` line, and nothing else for that detail",
    () => features(plain).length === 1 && /Tools menu \| standard \(`BaseGridDetailV2`\) \| kept/.test(features(plain)[0]),
    () => features(plain));
  const dateRows = features(date);
  check("detail features: an emptied access-rights getter and an Export visibility member returning false are each a tools-menu row",
    () => dateRows.some((l) => /Tools menu: Access rights \| removed/.test(l)) && dateRows.some((l) => /Tools menu: Export to Excel \| hidden/.test(l))
      && !dateRows.some((l) => /Tools menu \| standard/.test(l)),
    () => dateRows);
  check("detail features: the group-editing mixin is an added tools-menu item (Edit selected records)",
    () => features(sum).some((l) => /Tools menu: \+ Edit selected records/.test(l)), () => features(sum));

  // AC 5 — multi-select and row styling each get a row.
  check("detail features: multi-select switched off and coloured rows are each a row with a Freedom target",
    () => dateRows.some((l) => /Multi-select \| switched off/.test(l)) && dateRows.some((l) => /Row styling \| `prepareResponseCollectionItem` sets `customStyle`/.test(l)),
    () => dateRows);

  // AC 6 — a detail a vendor template layer declares is "inherited — decide"; one from the platform base is not.
  // A template layer above the clean seed that declares a change-log detail on the history tab.
  const layerSeed = (pkg, schema, detail) => [...CLEAN_SEED, { pkg, body: `define("${schema}",[],function(){return{details:{Log:{schemaName:"${detail}",entitySchemaName:"ChangeLog"}},diff:[{operation:"insert",name:"Log",parentName:"ChangesHistoryTab",propertyName:"items",values:{itemType:2}}]};});` }];
  // `pkg` as get-classic-page-sources writes it on a real run: the bare package name (`Samarasoft.Logging`, `WorkOverride`).
  const vendorSeed = layerSeed("Vendor.Logging", "BaseModulePageV2", "VendorLogDetail");
  const platformSeed = layerSeed("CrtUIPlatform7x", "BaseRecordPage", "PlatformLogDetail");
  const vendor = runMigration({ entity: "X", seed: vendorSeed, schemas: [{ pkg: "P", body: page("{}", "") }], planMeta: docPlanMeta, signals: FULL_SIGNALS });
  const platform = runMigration({ entity: "X", seed: platformSeed, schemas: [{ pkg: "P", body: page("{}", "") }], planMeta: docPlanMeta, signals: FULL_SIGNALS });
  const inh = vendor.changeSet.needsDecision.find((n) => n.kind === "detail-inherited");
  check("detail features: a detail declared by a vendor template layer → `detail-inherited` decide row naming the layer, with no recommendation",
    () => inh?.item === "VendorLogDetail" && inh.layer === "Vendor.Logging" && /Inherited — decide/.test(inh.reason)
      && !/recommend/i.test(inh.reason) && features(vendor).some((l) => /VendorLogDetail \| Inherited detail/.test(l)),
    () => ({ inh, rows: features(vendor) }));
  check("detail features: a detail declared by a platform template layer stays context — no decide row",
    () => !platform.changeSet.needsDecision.some((n) => n.kind === "detail-inherited") && (platform.changeSet.inheritedDetails || []).length === 0,
    () => platform.changeSet.inheritedDetails);
  const unplacedSeed = [...CLEAN_SEED, { pkg: "Vendor.Logging", body: `define("BaseModulePageV2",[],function(){return{details:{Log:{schemaName:"VendorLogDetail",entitySchemaName:"ChangeLog"}},diff:[]};});` }];
  const inheritedUnplaced = runMigration({ entity: "X", seed: unplacedSeed, schemas: [{ pkg: "P", body: page("{}", "") }], planMeta: docPlanMeta, signals: FULL_SIGNALS });
  const inhU = inheritedUnplaced.changeSet.needsDecision.find((n) => n.kind === "detail-inherited");
  check("detail features: an inherited detail no layer places claims what users saw only by the chain state, and a placed one names its tab",
    () => inhU?.placed === false && !/Classic users saw it/.test(inhU.reason)
      && (inhU.chainComplete ? /users never saw it/ : /no FETCHED layer places it/).test(inhU.reason)
      && inh?.placed === true && /placed in 'ChangesHistoryTab', so Classic users saw it/.test(inh.reason),
    () => ({ inhU, inh }));
  const documented = runMigration({ entity: "X", seed: layerSeed("BaseModulePageV2/Vendor.Logging", "BaseModulePageV2", "VendorLogDetail"),
    schemas: [{ pkg: "P", body: page("{}", "") }], planMeta: docPlanMeta, signals: FULL_SIGNALS });
  check("detail features: the documented `Schema/Package` form names the same layer package",
    () => documented.changeSet.needsDecision.find((n) => n.kind === "detail-inherited")?.layer === "BaseModulePageV2/Vendor.Logging");
  const unnamed = runMigration({ entity: "X", seed: layerSeed("", "BaseModulePageV2", "SomeLogDetail"),
    schemas: [{ pkg: "P", body: page("{}", "") }], planMeta: docPlanMeta, signals: FULL_SIGNALS });
  check("detail features: a template detail whose layer names no package says inheritance was NOT checked — a ⚠ row and a decision, never silence",
    () => unnamed.changeSet.needsDecision.some((n) => n.kind === "detail-inheritance-unchecked" && n.item === "SomeLogDetail")
      && features(unnamed).some((l) => /SomeLogDetail \| Inherited detail/.test(l) && /inheritance NOT checked/.test(l)),
    () => ({ decisions: unnamed.changeSet.needsDecision.map((n) => n.kind), rows: features(unnamed) }));

  // AC 7 — a Files detail Classic never placed is an approval row, not a new Attachments tab.
  const files = runMigration({ entity: "X", seed: CLEAN_SEED, schemas: [{ pkg: "P", body:
    `define("XPage",[],function(){return{entitySchemaName:"X",details:{Files:{schemaName:"FileDetailV2",entitySchemaName:"XFile",filter:{detailColumn:"X",masterColumn:"Id"}}},diff:[{operation:"insert",name:"F",parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"F"}}]};});` }],
    planMeta: docPlanMeta, signals: FULL_SIGNALS });
  const fileFeature = files.changeSet.standardFeatures.find((s) => s.classicDetail === "FileDetailV2");
  const unplacedOf = (r) => r.changeSet.needsDecision.find((n) => n.kind === "detail-unplaced");
  const noSeed = runMigration({ entity: "X", seed: [], schemas: [{ pkg: "P", body:
    `define("XPage",[],function(){return{entitySchemaName:"X",details:{Files:{schemaName:"FileDetailV2",entitySchemaName:"XFile",filter:{detailColumn:"X",masterColumn:"Id"}}},diff:[{operation:"insert",name:"F",parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"F"}}]};});` }],
    planMeta: docPlanMeta, signals: FULL_SIGNALS });
  check("detail features: with no seed (the chain may place the detail in a layer that was not fetched) the unplaced question says so and claims nothing about what users saw",
    () => unplacedOf(noSeed)?.chainComplete === false && /no FETCHED layer places it/.test(unplacedOf(noSeed).reason)
      && /Complete the chain before answering/.test(unplacedOf(noSeed).reason) && !/users never saw it/.test(unplacedOf(noSeed).reason),
    () => unplacedOf(noSeed));
  const declaredNone = runMigration({ entity: "X", seed: [], noParentTemplate: true, schemas: [{ pkg: "P", body:
    `define("XPage",[],function(){return{entitySchemaName:"X",details:{Files:{schemaName:"FileDetailV2",entitySchemaName:"XFile",filter:{detailColumn:"X",masterColumn:"Id"}}},diff:[]};});` }],
    planMeta: docPlanMeta, signals: FULL_SIGNALS });
  check("detail features: a page verified to have no parent template (`noParentTemplate: true`) has a complete chain — the unplaced question says users never saw it",
    () => unplacedOf(declaredNone)?.chainComplete === true && /users never saw it/.test(unplacedOf(declaredNone).reason),
    () => unplacedOf(declaredNone));
  const approved = runMigration({ entity: "X", seed: CLEAN_SEED, deliverableStatus: { "main#confirm:detail-unplaced:FileDetailV2": { status: "build", decision: "D4" } }, schemas: [{ pkg: "P", body:
    `define("XPage",[],function(){return{entitySchemaName:"X",details:{Files:{schemaName:"FileDetailV2",entitySchemaName:"XFile",filter:{detailColumn:"X",masterColumn:"Id"}}},diff:[]};});` }],
    planMeta: docPlanMeta, signals: FULL_SIGNALS });
  const approvedRows = checklistGroups(approved, {}).flatMap((g) => g.rows);
  check("detail features: a `build` answer on the unplaced question builds the detail — its Attachments row is back — and asks for its tab",
    () => approved.changeSet.standardFeatures.find((s) => s.classicDetail === "FileDetailV2")?.unplaced !== true
      && approvedRows.some((r) => r.deliverableId === "feature:Attachments")
      && /Answered build \(D4\)/.test(unplacedOf(approved)?.reason || "")
      && approved.changeSet.needsDecision.some((n) => n.kind === "detail-placement" && n.item === "FileDetailV2"),
    () => ({ unplaced: unplacedOf(approved), rows: approvedRows.map((r) => r.deliverableId).filter(Boolean) }));
  check("detail features: the unplaced question's wording follows the chain state — it asserts what users saw only on a complete chain",
    () => unplacedOf(files)?.chainComplete === /users never saw it/.test(unplacedOf(files)?.reason || ""),
    () => unplacedOf(files));
  check("detail features: an unplaced Files detail → `detail-unplaced` approval naming Attachments, its Layout row says it waits for approval",
    () => fileFeature?.unplaced === true && files.changeSet.needsDecision.some((n) => n.kind === "detail-unplaced" && n.item === "FileDetailV2" && n.feature === "Attachments")
      && files.plan.split("\n").some((l) => /⚠ unplaced/.test(l) && /not shown in Classic — build only on approval/.test(l)),
    () => ({ fileFeature, rows: files.plan.split("\n").filter((l) => /unplaced/.test(l)) }));
  const fileRows = checklistGroups(files, {}).flatMap((g) => g.rows);
  check("detail features: the checklist gates nothing for the unplaced Files detail — no Attachments row, no related-list row or count for it",
    () => !fileRows.some((r) => r.deliverableId === "feature:Attachments")
      && !fileRows.some((r) => (r.deliverableId || "").startsWith("related-list:"))
      && fileRows.filter((r) => r.vk?.type === "details").every((r) => r.vk.n === 0),
    () => fileRows.filter((r) => /feature:|related-list:/.test(r.deliverableId || "") || r.vk?.type === "details").map((r) => [r.deliverableId, r.vk]));

  // AC 8 — a field the page's own diff disables is read-only, and --verify holds the built field to it.
  const ro = runMigration({ entity: "X", seed: CLEAN_SEED, schemas: [{ pkg: "P", body:
    `define("XPage",[],function(){return{entitySchemaName:"X",diff:[{operation:"insert",name:"Amount",parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"Amount",enabled:false}},{operation:"insert",name:"Name",parentName:"ProfileContainer",propertyName:"items",values:{bindTo:"Name"}}]};});` }],
    planMeta: docPlanMeta, signals: FULL_SIGNALS });
  const amount = ro.changeSet.viewConfigDiff.find((o) => o.name === "Amount");
  check("detail features: a field with a static `enabled: false` in the page diff → read-only, and the Layout Rule cell says it came from Classic",
    () => amount?.values?.readOnly === true && amount.values.readOnlyStatic === true
      && ro.changeSet.viewConfigDiff.find((o) => o.name === "Name")?.values?.readOnly !== true
      && ro.plan.split("\n").some((l) => /\| Amount \|/.test(l) && /read-only \(static in Classic\)/.test(l)),
    () => ({ amount: amount?.values, rows: ro.plan.split("\n").filter((l) => /Amount/.test(l)) }));
  const roRow = checklistGroups(ro, {}).flatMap((g) => g.rows).find((r) => r.vk?.type === "readonly");
  const builtPage = (items) => verifyCtx({ pages: { main: { parentSchemaName: "FormPageTemplate", entitySchemaName: "X", viewConfig: { items } } } }, "main");
  check("detail features: --verify fails a statically read-only field built EDITABLE, and passes it built read-only",
    () => roRow?.vk.names.join(",") === "Amount"
      && resolveVk(roRow.vk, builtPage([{ type: "crt.NumberInput", name: "Amount" }]))[0] === "❌ MISSING"
      && resolveVk(roRow.vk, builtPage([{ type: "crt.NumberInput", name: "Amount", readonly: true }]))[0] === "✅ Done",
    () => roRow);

  // AC 9 — --verify: a detail quick filter must be a crt.QuickFilter under the published name.
  const fRow = checklistGroups(toggle, {}).flatMap((g) => g.rows).find((r) => r.vk?.type === "detailfilter");
  check("detail features: --verify fails a detail quick filter built as a plain input or missing, and passes it built as `crt.QuickFilter`",
    () => fRow?.vk.names[0] === "DQuickFilterByIsActiveOnly"
      && resolveVk(fRow.vk, builtPage([{ type: "crt.Checkbox", name: "DQuickFilterByIsActiveOnly" }]))[0] === "❌ MISSING"
      && resolveVk(fRow.vk, builtPage([{ type: "crt.DataGrid", name: "DGrid" }]))[0] === "❌ MISSING"
      && resolveVk(fRow.vk, builtPage([{ type: "crt.QuickFilter", name: "DQuickFilterByIsActiveOnly" }]))[0] === "✅ Done",
    () => fRow);
  const noCopy = run("NoCopyDetail", "Line", NO_COPY_BODY);
  const tbRow = checklistGroups(noCopy, {}).flatMap((g) => g.rows).find((r) => r.vk?.type === "rowtoolbar");
  check("detail features: --verify matches the row toolbar on the related list's own grid — another grid's toolbar does not close it",
    () => tbRow?.vk.names.join(",") === "D"
      && resolveVk(tbRow.vk, builtPage([{ type: "crt.DataGrid", name: "DDataGrid" }]))[0] === "❌ MISSING"
      && resolveVk(tbRow.vk, builtPage([{ type: "crt.DataGrid", name: "DDataGrid", rowToolbarItems: [] }]))[0] === "✅ Done"
      && resolveVk(tbRow.vk, builtPage([{ type: "crt.DataGrid", name: "D", values: { rowToolbarItems: [] } }]))[0] === "✅ Done"
      && resolveVk(tbRow.vk, builtPage([{ type: "crt.DataGrid", name: "OtherGrid", rowToolbarItems: [] }]))[0] !== "✅ Done",
    () => tbRow);
  const prefixVk = { type: "rowtoolbar", n: 1, names: ["Activity"] };
  check("detail features: --verify never takes a grid whose name merely starts with the detail's — the exact name wins, a longer name is not the list",
    () => resolveVk(prefixVk, builtPage([{ type: "crt.DataGrid", name: "ActivityTypeGrid", rowToolbarItems: [] }, { type: "crt.DataGrid", name: "Activity" }]))[0] === "❌ MISSING"
      && resolveVk(prefixVk, builtPage([{ type: "crt.DataGrid", name: "ActivityTypeGrid" }, { type: "crt.DataGrid", name: "Activity", rowToolbarItems: [] }]))[0] === "✅ Done"
      && resolveVk(prefixVk, builtPage([{ type: "crt.DataGrid", name: "ActivityTypeGrid", rowToolbarItems: [] }]))[0] === "⚠ verify",
    () => prefixVk);
  check("detail features: --verify reads two grids named after the detail (`<Detail>DataGrid` and `<Detail>Grid`) as ambiguous, never Done",
    () => resolveVk(prefixVk, builtPage([{ type: "crt.DataGrid", name: "ActivityDataGrid", rowToolbarItems: [] }, { type: "crt.DataGrid", name: "ActivityGrid", rowToolbarItems: [] }]))[0] === "⚠ verify",
    () => prefixVk);
  const groupTitles = checklistGroups(date, {}).map((g) => g.baseTitle || g.title);
  check("detail features: the checklist carries a `Form — Detail features` group, and the build orders it after the layout and coverage",
    () => groupTitles.includes("Form — Detail features") && GROUP_PHASE.get("Form — Detail features") > GROUP_PHASE.get("Form — Coverage (verified)"),
    () => groupTitles);
  check("detail features: a detail whose schema was not bundled says its inventory is unknown instead of claiming the standard menu",
    () => detailFeatureRows({ details: [{ caption: "Lines", features: null }] }).some((r) => /not bundled/.test(r[2])));
  check("detail features: the design spec renders the block under the form Layout",
    () => /#### Detail features/.test(renderDesignSpec(date, {})));

  // AC 10 — the skill prompt keeps improvements beyond parity at "no" by default.
  const skill = fs.readFileSync(SKILL_MD, "utf8");
  check("detail features: SKILL.md says an improvement beyond Classic parity (tooltips, dropdowns, summaries) defaults to no",
    () => /beyond Classic parity[^\n]{0,200}default(?:s)? to \*\*no\*\*/i.test(skill));

  // AC 11 — the new scans stay linear.
  const src = DETAIL_FEATURE_SCAN_FNS.map((f) => f.toString()).join("\n");
  const unboundedRun = /\[\\s\\S\][*+]|\.[*+]/g;
  check("ReDoS (structural): the detail feature scan has NO unbounded `[\\s\\S]*` / `[\\s\\S]+` / `.*` / `.+` run, and detectAddMode reaches its quick-filter half",
    () => DETAIL_FEATURE_SCAN_FNS.length >= 5 && detectAddMode.toString().includes("classifyDetailFilters") && !src.match(unboundedRun),
    () => src.match(unboundedRun));
  const unit = "getFilters: function(){ this.$A; this.get(\"B\"); saveUserProfile(); getRecordRightsSetupMenuItem: function(){ " + "z".repeat(60) + "\n";
  const adversarial = unit.repeat(6000);
  const t0 = Date.now(); scanDetailFeatures(adversarial); classifyDetailFilters(adversarial); detectAddMode(adversarial); const ms = Date.now() - t0;
  check(`ReDoS (timing): the detail feature scan on ~${Math.round(adversarial.length / 1024)}KB of unterminated overrides stays linear — ${ms}ms`,
    () => adversarial.length > 500 * 1024 && ms < 5000, () => ({ ms }));
}

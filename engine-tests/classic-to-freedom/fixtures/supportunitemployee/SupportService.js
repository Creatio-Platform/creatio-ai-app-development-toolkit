// SYNTHETIC fixture (not a stand export). Compact override layer over SupportCalendar_base: its only
// contribution is one analytical CARD widget module (CardWidgetModule) carrying BOTH coordinates the migrator
// needs — `widgetKey` (which widget) and `recordId` (its SysWidgetDashboard record) — so the mapper surfaces it
// as a concrete `card-widget` decision (ENG-95806), not the old vague `component`. No diff/rules/details of its
// own. The missing-coordinate fallback is a SEPARATE synthetic case in run-mapper.mjs. See fixtures/README.md.
define("SupportUnitEmployeePage", [], function() {
	return {
		entitySchemaName: "SupportUnit",
		attributes: {},
		modules: {
			"KpiChart": { "moduleId": "KpiChart", "moduleName": "CardWidgetModule", "config": { "parameters": { "viewModelConfig": { "widgetKey": "KpiChart", "recordId": "b1e2c3d4-0000-4000-8000-000000000001" } } } }
		},
		details: {},
		businessRules: {},
		methods: {},
		diff: []
	};
});

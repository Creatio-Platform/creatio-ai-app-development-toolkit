// SYNTHETIC fixture (not a stand export). Compact override layer over SupportCalendar_base: its only
// contribution is one analytical widget module (CardWidgetModule), which the mapper must surface as a
// `component` decision. No diff/rules/details of its own. See fixtures/README.md.
define("SupportUnitEmployeePage", [], function() {
	return {
		entitySchemaName: "SupportUnit",
		attributes: {},
		modules: {
			"KpiChart": { "moduleId": "KpiChart", "moduleName": "CardWidgetModule", "config": { "parameters": { "viewModelConfig": { "widgetKey": "KpiChart" } } } }
		},
		details: {},
		businessRules: {},
		methods: {},
		diff: []
	};
});

// SYNTHETIC fixture (not a stand export). Hand-authored compact base layer of a SupportUnit record
// page, carrying only the structure the goldens assert: 8 profile fields, 3 client tabs, 3 details,
// 4 business rules (2 FILTRATION + 2 required), one method, and two base-tab merges (ESNTab /
// ChangesHistoryTab) that orphan unseeded and resolve under the F2 seed. See fixtures/README.md.
define("SupportUnitEmployeePage", [], function() {
	return {
		entitySchemaName: "SupportUnit",
		attributes: {
			"Name": { "dependencies": [ { "columns": ["Contact"], "methodName": "setName" } ] }
		},
		modules: {},
		details: {
			"SupportScheduleDetail": { "schemaName": "SupportScheduleEmployeeDetail", "entitySchemaName": "SupportSchedule", "filter": { "detailColumn": "SupportUnit", "masterColumn": "Id" } },
			"SupportUnitLogDetail": { "schemaName": "SupportUnitLogDetail", "entitySchemaName": "SupportUnitLog", "filter": { "detailColumn": "SupportUnit", "masterColumn": "Id" } },
			"SupportScheduleLogDetail": { "schemaName": "SupportScheduleLogDetail", "entitySchemaName": "SupportScheduleLog", "filter": { "detailColumn": "SupportUnit", "masterColumn": "Id" } }
		},
		businessRules: {
			"ParentSupportUnit": { "rule-parent": { "enabled": true, "removed": false, "ruleType": 1, "baseAttributePatch": "SupportUnitType", "comparisonType": 3, "type": 0, "value": "grp-1", "dataValueType": 10 } },
			"SupportWorkingDayType": { "rule-wdt": { "enabled": true, "removed": false, "ruleType": 1, "baseAttributePatch": "IsAvailable", "comparisonType": 3, "type": 0, "value": true, "dataValueType": 12 } },
			"Contact": { "rule-contact": { "enabled": true, "removed": false, "ruleType": 0, "property": 2, "logical": 0, "conditions": [ { "comparisonType": 1, "leftExpression": { "type": 1, "attribute": "Contact" } } ] } },
			"Calendar": { "rule-calendar": { "enabled": true, "removed": false, "ruleType": 0, "property": 2, "logical": 0, "conditions": [ { "comparisonType": 1, "leftExpression": { "type": 1, "attribute": "Calendar" } } ] } }
		},
		methods: {
			setName: function() { this.$Name = this.$Contact && this.$Contact.displayValue; }
		},
		diff: [
			{ "operation": "insert", "name": "ParentSupportUnit", "parentName": "ProfileContainer", "propertyName": "items", "values": { "bindTo": "ParentSupportUnit", "contentType": 5, "isRequired": true } },
			{ "operation": "insert", "name": "Contact", "parentName": "ProfileContainer", "propertyName": "items", "values": { "bindTo": "Contact", "contentType": 5 } },
			{ "operation": "insert", "name": "Calendar", "parentName": "ProfileContainer", "propertyName": "items", "values": { "bindTo": "Calendar", "contentType": 5 } },
			{ "operation": "insert", "name": "SupportWorkingDayType", "parentName": "ProfileContainer", "propertyName": "items", "values": { "bindTo": "SupportWorkingDayType", "contentType": 5 } },
			{ "operation": "insert", "name": "Active", "parentName": "ProfileContainer", "propertyName": "items", "values": { "bindTo": "Active" } },
			{ "operation": "insert", "name": "SupportEmpIndex", "parentName": "ProfileContainer", "propertyName": "items", "values": { "bindTo": "SupportEmpIndex" } },
			{ "operation": "insert", "name": "Canprocessreopencases", "parentName": "ProfileContainer", "propertyName": "items", "values": { "bindTo": "Canprocessreopencases" } },
			{ "operation": "insert", "name": "SupportCaseLimit", "parentName": "ProfileContainer", "propertyName": "items", "values": { "bindTo": "SupportCaseLimit" } },
			{ "operation": "insert", "name": "ScheduleTab", "parentName": "Tabs", "propertyName": "tabs", "values": { "caption": { "bindTo": "Resources.Strings.ScheduleTabCaption" }, "items": [], "order": 0 } },
			{ "operation": "insert", "name": "KpiTab", "parentName": "Tabs", "propertyName": "tabs", "values": { "caption": { "bindTo": "Resources.Strings.KpiTabCaption" }, "items": [], "order": 1 } },
			{ "operation": "insert", "name": "HistoryTab", "parentName": "Tabs", "propertyName": "tabs", "values": { "caption": { "bindTo": "Resources.Strings.HistoryTabCaption" }, "items": [], "order": 2 } },
			{ "operation": "insert", "name": "SupportScheduleDetail", "parentName": "ScheduleTab", "propertyName": "items", "values": { "itemType": 2 } },
			{ "operation": "insert", "name": "SupportUnitLogDetail", "parentName": "HistoryTab", "propertyName": "items", "values": { "itemType": 2 } },
			{ "operation": "insert", "name": "SupportScheduleLogDetail", "parentName": "HistoryTab", "propertyName": "items", "values": { "itemType": 2 } },
			{ "operation": "merge", "name": "ESNTab", "values": { "order": 3 } },
			{ "operation": "merge", "name": "ChangesHistoryTab", "values": { "order": 4 } }
		]
	};
});

// Contract layer 9/9 (last in F1 order). TRIMMED to the ops the goldens actually exercise — the
// original stand body's ~30 non-asserted merge/move ops (duplicated filler) were dropped; the ops kept
// here are verbatim from that body. Contributes: the C5 CONTROL_GROUP -> crt.ExpansionPanel (with its
// nested grid + two fields), the State tombstone (removed by this last layer), the ESNTab base-tab merge,
// and the Owner (FILTRATION) + Parent (required) business rules. See fixtures/README.md.
define("ContractPageV2", [], function() {
	return {
		entitySchemaName: "Contract",
		details: {},
		diff: [
			{ "operation": "insert", "name": "GeneralInfoTabGroupe00b109d", "values": { "caption": { "bindTo": "Resources.Strings.GeneralInfoTabGroupe00b109dGroupCaption" }, "itemType": 15, "markerValue": "added-group", "items": [] }, "parentName": "GeneralInfoTab", "propertyName": "items", "index": 1 },
			{ "operation": "insert", "name": "GeneralInfoTabGridLayoutc608aa43", "values": { "itemType": 0, "items": [] }, "parentName": "GeneralInfoTabGroupe00b109d", "propertyName": "items", "index": 0 },
			{ "operation": "insert", "name": "ContractReturnDate", "values": { "layout": { "colSpan": 14, "rowSpan": 1, "column": 10, "row": 0, "layoutName": "GeneralInfoTabGridLayoutc608aa43" }, "bindTo": "ContractReturnDate" }, "parentName": "GeneralInfoTabGridLayoutc608aa43", "propertyName": "items", "index": 0 },
			{ "operation": "insert", "name": "DeliveryType", "values": { "layout": { "colSpan": 10, "rowSpan": 1, "column": 0, "row": 0, "layoutName": "GeneralInfoTabGridLayoutc608aa43" }, "bindTo": "DeliveryType", "enabled": true, "contentType": 3 }, "parentName": "GeneralInfoTabGridLayoutc608aa43", "propertyName": "items", "index": 2 },
			{ "operation": "remove", "name": "State" },
			{ "operation": "merge", "name": "ESNTab", "values": { "order": 6 } }
		],
		rules: {},
		businessRules: {
			"Owner": { "rule-owner": { "enabled": true, "removed": false, "ruleType": 1, "baseAttributePatch": "Account", "comparisonType": 3, "type": 0, "value": "acc-1", "dataValueType": 10 } },
			"Parent": { "rule-parent": { "enabled": true, "removed": false, "ruleType": 0, "property": 2, "logical": 0, "conditions": [ { "comparisonType": 3, "leftExpression": { "type": 1, "attribute": "Type", "attributePath": "IsSlave" }, "rightExpression": { "type": 0, "value": true, "dataValueType": 12 } } ] } }
		},
		methods: {}
	};
});

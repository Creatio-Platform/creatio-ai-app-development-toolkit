define("EmployeeScore1Page", [], function() {
	return {
		entitySchemaName: "EmployeeScore",
		details: /**SCHEMA_DETAILS*/{}/**SCHEMA_DETAILS*/,
		modules: /**SCHEMA_MODULES*/{}/**SCHEMA_MODULES*/,
		dataModels: /**SCHEMA_DATA_MODELS*/{}/**SCHEMA_DATA_MODELS*/,
		diff: /**SCHEMA_DIFF*/[
			{
				"operation": "insert",
				"name": "MarketplaceApplication142b7b87-4928-4cdd-a6b8-853476ef780a",
				"values": {
					"layout": {
						"colSpan": 24,
						"rowSpan": 1,
						"column": 0,
						"row": 4,
						"layoutName": "ProfileContainer"
					},
					"bindTo": "MarketplaceApplication"
				},
				"parentName": "ProfileContainer",
				"propertyName": "items",
				"index": 4
			},
			{
				"operation": "merge",
				"name": "LOOKUP951a3709-8ced-4348-b114-cb18b2fb49bc",
				"values": {
					"layout": {
						"colSpan": 24,
						"rowSpan": 1,
						"column": 0,
						"row": 5,
						"layoutName": "ProfileContainer"
					}
				}
			},
			{
				"operation": "merge",
				"name": "LOOKUPe1e55a38-b8b0-45a7-abba-00c909b71969",
				"values": {
					"layout": {
						"colSpan": 24,
						"rowSpan": 1,
						"column": 0,
						"row": 6,
						"layoutName": "ProfileContainer"
					}
				}
			},
			{
				"operation": "insert",
				"name": "FLOATd4e5b4b0-b915-4dd4-ab31-f65b8cf55b64",
				"values": {
					"layout": {
						"colSpan": 24,
						"rowSpan": 1,
						"column": 0,
						"row": 7,
						"layoutName": "ProfileContainer"
					},
					"bindTo": "ScoreBalance",
					"enabled": true
				},
				"parentName": "ProfileContainer",
				"propertyName": "items",
				"index": 7
			},
			{
				"operation": "merge",
				"name": "ESNTab",
				"values": {
					"order": 0
				}
			}
		]/**SCHEMA_DIFF*/,
		methods: {},
		rules: {},
		businessRules: /**SCHEMA_BUSINESS_RULES*/{
	"MarketplaceApplication": {
		"3d003e62-93e2-49ee-812c-8365ff0a4f86": {
			"uId": "3d003e62-93e2-49ee-812c-8365ff0a4f86",
			"enabled": true,
			"removed": false,
			"ruleType": 0,
			"property": 2,
			"logical": 0,
			"conditions": [
				{
					"comparisonType": 3,
					"leftExpression": {
						"type": 1,
						"attribute": "ScoreType"
					},
					"rightExpression": {
						"type": 0,
						"value": "a27461ca-6d0e-4678-9ff4-7f70f39532c9",
						"dataValueType": 10
					}
				}
			]
		}
	}
}/**SCHEMA_BUSINESS_RULES*/
	};
});

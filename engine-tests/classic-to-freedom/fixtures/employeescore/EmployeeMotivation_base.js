define("EmployeeScore1Page", [], function() {
	return {
		entitySchemaName: "EmployeeScore",
		details: /**SCHEMA_DETAILS*/{}/**SCHEMA_DETAILS*/,
		modules: /**SCHEMA_MODULES*/{}/**SCHEMA_MODULES*/,
		diff: /**SCHEMA_DIFF*/[
	{
		"operation": "insert",
		"name": "FLOAT5f30e837-adae-4cbd-8c37-18cf98460117",
		"values": {
			"layout": {
				"colSpan": 24,
				"rowSpan": 1,
				"column": 0,
				"row": 0,
				"layoutName": "ProfileContainer"
			},
			"bindTo": "ScoreNumber",
			"enabled": true
		},
		"parentName": "ProfileContainer",
		"propertyName": "items",
		"index": 0
	},
	{
		"operation": "insert",
		"name": "LOOKUP24d330cc-72e2-4368-b3d3-e0e720d5d9a9",
		"values": {
			"layout": {
				"colSpan": 24,
				"rowSpan": 1,
				"column": 0,
				"row": 1,
				"layoutName": "ProfileContainer"
			},
			"bindTo": "Employee",
			"enabled": true,
			"contentType": 5
		},
		"parentName": "ProfileContainer",
		"propertyName": "items",
		"index": 1
	},
	{
		"operation": "insert",
		"name": "DATEb1d5a4fb-7607-4cce-904a-1d9cf159cc14",
		"values": {
			"layout": {
				"colSpan": 24,
				"rowSpan": 1,
				"column": 0,
				"row": 2,
				"layoutName": "ProfileContainer"
			},
			"bindTo": "ScoreDate",
			"enabled": true
		},
		"parentName": "ProfileContainer",
		"propertyName": "items",
		"index": 2
	},
	{
		"operation": "insert",
		"name": "AccrualRule6fe763a6-bda8-4335-a36a-770ed1ecb7fa",
		"values": {
			"layout": {
				"colSpan": 24,
				"rowSpan": 1,
				"column": 0,
				"row": 3,
				"layoutName": "ProfileContainer"
			},
			"bindTo": "AccrualRule",
			"enabled": true,
			"contentType": 5
		},
		"parentName": "ProfileContainer",
		"propertyName": "items",
		"index": 3
	},
	{
		"operation": "insert",
		"name": "LOOKUP951a3709-8ced-4348-b114-cb18b2fb49bc",
		"values": {
			"layout": {
				"colSpan": 24,
				"rowSpan": 1,
				"column": 0,
				"row": 4,
				"layoutName": "ProfileContainer"
			},
			"bindTo": "Owner",
			"enabled": true,
			"contentType": 5
		},
		"parentName": "ProfileContainer",
		"propertyName": "items",
		"index": 4
	},
	{
		"operation": "insert",
		"name": "LOOKUPe1e55a38-b8b0-45a7-abba-00c909b71969",
		"values": {
			"layout": {
				"colSpan": 24,
				"rowSpan": 1,
				"column": 0,
				"row": 5,
				"layoutName": "ProfileContainer"
			},
			"bindTo": "ScoreType",
			"enabled": false,
			"contentType": 3
		},
		"parentName": "ProfileContainer",
		"propertyName": "items",
		"index": 5
	},
	{
		"operation": "insert",
		"name": "ESNTabGroup850e1dec",
		"values": {
			"caption": {
				"bindTo": "Resources.Strings.ESNTabGroup850e1decGroupCaption"
			},
			"itemType": 15,
			"markerValue": "added-group",
			"items": []
		},
		"parentName": "ESNTab",
		"propertyName": "items",
		"index": 0
	},
	{
		"operation": "insert",
		"name": "ESNTabGridLayoute8b87795",
		"values": {
			"itemType": 0,
			"items": []
		},
		"parentName": "ESNTabGroup850e1dec",
		"propertyName": "items",
		"index": 0
	},
	{
		"operation": "insert",
		"name": "Comment209a690f-2e35-46bb-9e09-0c7f50a1d476",
		"values": {
			"layout": {
				"colSpan": 24,
				"rowSpan": 2,
				"column": 0,
				"row": 0,
				"layoutName": "ESNTabGridLayoute8b87795"
			},
			"bindTo": "Comment",
			"enabled": true,
			"contentType": 0,
			"labelConfig": {
				"visible": false
			}
		},
		"parentName": "ESNTabGridLayoute8b87795",
		"propertyName": "items",
		"index": 0
	}
]/**SCHEMA_DIFF*/,
		methods: {},
		rules: {},
		businessRules: /**SCHEMA_BUSINESS_RULES*/{
	"AccrualRule": {
		"e39a2fb3-904f-47a1-acff-e7ba28ed4745": {
			"uId": "e39a2fb3-904f-47a1-acff-e7ba28ed4745",
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

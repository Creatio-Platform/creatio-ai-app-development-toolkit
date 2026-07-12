define("SupportSchedulePage", ["ProcessModuleUtilities"], function(ProcessModuleUtilities) {
	return {
		entitySchemaName: "SupportSchedule",
		attributes: {},
		modules: /**SCHEMA_MODULES*/{}/**SCHEMA_MODULES*/,
		details: /**SCHEMA_DETAILS*/{}/**SCHEMA_DETAILS*/,
		businessRules: /**SCHEMA_BUSINESS_RULES*/{
			"SupportUnit": {
				"13f655dc-ee46-4a2d-b194-83c67e7a5aae": {
					"uId": "13f655dc-ee46-4a2d-b194-83c67e7a5aae",
					"enabled": true,
					"removed": true,
					"ruleType": 0,
					"property": 1,
					"logical": 0,
					"conditions": [
						{
							"comparisonType": 2,
							"leftExpression": {
								"type": 1,
								"attribute": "SupportWorkingDayType"
							}
						}
					]
				},
				"f27c2e81-4013-4a93-9855-c08e7201cf2c": {
					"uId": "f27c2e81-4013-4a93-9855-c08e7201cf2c",
					"enabled": false,
					"removed": true,
					"ruleType": 0,
					"property": 1,
					"logical": 0,
					"conditions": [
						{
							"comparisonType": 2,
							"leftExpression": {
								"type": 1,
								"attribute": "SupportUnit"
							}
						},
						{
							"comparisonType": 3,
							"leftExpression": {
								"type": 1,
								"attribute": "SupportWorkingDayType",
								"attributePath": "IsDuty"
							},
							"rightExpression": {
								"type": 0,
								"value": true,
								"dataValueType": 12
							}
						}
					]
				},
				"2a067f79-176d-405d-b6bf-40ced62e8c2d": {
					"uId": "2a067f79-176d-405d-b6bf-40ced62e8c2d",
					"enabled": true,
					"removed": true,
					"ruleType": 0,
					"property": 1,
					"logical": 0,
					"conditions": [
						{
							"comparisonType": 3,
							"leftExpression": {
								"type": 1,
								"attribute": "SupportWorkingDayType",
								"attributePath": "IsDuty"
							},
							"rightExpression": {
								"type": 0,
								"value": true,
								"dataValueType": 12
							}
						}
					]
				},
				"63810175-d17f-429d-9a1c-b2986bb54c20": {
					"uId": "63810175-d17f-429d-9a1c-b2986bb54c20",
					"enabled": false,
					"removed": true,
					"ruleType": 0,
					"property": 1,
					"logical": 0,
					"conditions": [
						{
							"comparisonType": 1,
							"leftExpression": {
								"type": 1,
								"attribute": "SupportUnit"
							}
						}
					]
				},
				"d9bc4943-544b-40d4-a9ab-8f5df7230d47": {
					"uId": "d9bc4943-544b-40d4-a9ab-8f5df7230d47",
					"enabled": true,
					"removed": true,
					"ruleType": 0,
					"property": 1,
					"logical": 0,
					"conditions": [
						{
							"comparisonType": 3,
							"leftExpression": {
								"type": 1,
								"attribute": "SupportWorkingDayType",
								"attributePath": "IsNight"
							},
							"rightExpression": {
								"type": 0,
								"value": true,
								"dataValueType": 12
							}
						}
					]
				},
				"0218ac1c-ed7c-4b04-985e-55b7599c9081": {
					"uId": "0218ac1c-ed7c-4b04-985e-55b7599c9081",
					"enabled": true,
					"removed": true,
					"ruleType": 0,
					"property": 1,
					"logical": 0,
					"conditions": [
						{
							"comparisonType": 1,
							"leftExpression": {
								"type": 1,
								"attribute": "SupportUnit"
							}
						}
					]
				},
				"e39083db-d015-4235-b4e4-6bf265c70cf3": {
					"uId": "e39083db-d015-4235-b4e4-6bf265c70cf3",
					"enabled": true,
					"removed": false,
					"ruleType": 1,
					"baseAttributePatch": "SupportUnitType",
					"comparisonType": 3,
					"type": 0,
					"value": "20c1d941-050e-481f-9585-d47d5462e35c",
					"dataValueType": 10
				},
				"a064f1e0-0fb8-4a54-8a37-c2c192e34739": {
					"uId": "a064f1e0-0fb8-4a54-8a37-c2c192e34739",
					"enabled": true,
					"removed": true,
					"ruleType": 0,
					"property": 2,
					"logical": 1,
					"conditions": [
						{
							"comparisonType": 4,
							"leftExpression": {
								"type": 1,
								"attribute": "SupportWorkingDayType",
								"attributePath": "IsDuty"
							},
							"rightExpression": {
								"type": 0,
								"value": true,
								"dataValueType": 12
							}
						},
						{
							"comparisonType": 4,
							"leftExpression": {
								"type": 1,
								"attribute": "SupportWorkingDayType",
								"attributePath": "IsNight"
							},
							"rightExpression": {
								"type": 0,
								"value": true,
								"dataValueType": 12
							}
						}
					]
				},
				"9f36c8a2-d3d8-4a87-ac31-f5c23be77c25": {
					"uId": "9f36c8a2-d3d8-4a87-ac31-f5c23be77c25",
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
								"attribute": "SupportWorkingDayType",
								"attributePath": "IsDuty"
							},
							"rightExpression": {
								"type": 0,
								"value": false,
								"dataValueType": 12
							}
						}
					]
				},
				"6ea3bf69-79a6-4ea0-83ab-b2e46881e021": {
					"uId": "6ea3bf69-79a6-4ea0-83ab-b2e46881e021",
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
								"attribute": "SupportWorkingDayType",
								"attributePath": "IsNight"
							},
							"rightExpression": {
								"type": 0,
								"value": true,
								"dataValueType": 12
							}
						}
					]
				}
			},
			"Date": {
				"6413b163-5142-4efb-b4fd-5c6e89d940f9": {
					"uId": "6413b163-5142-4efb-b4fd-5c6e89d940f9",
					"enabled": true,
					"removed": false,
					"ruleType": 0,
					"property": 1,
					"logical": 0,
					"conditions": [
						{
							"comparisonType": 1,
							"leftExpression": {
								"type": 1,
								"attribute": "Date"
							}
						}
					]
				}
			},
			"DayOfWeek": {
				"7f0b0d8a-3b29-4969-be61-a41c1e253459": {
					"uId": "7f0b0d8a-3b29-4969-be61-a41c1e253459",
					"enabled": true,
					"removed": false,
					"ruleType": 0,
					"property": 1,
					"logical": 0,
					"conditions": [
						{
							"comparisonType": 1,
							"leftExpression": {
								"type": 1,
								"attribute": "DayOfWeek"
							}
						}
					]
				}
			},
			"SupportWorkingDayType": {
				"ead61769-bbfd-4c90-8225-cc4b923e8af5": {
					"uId": "ead61769-bbfd-4c90-8225-cc4b923e8af5",
					"enabled": true,
					"removed": false,
					"ruleType": 0,
					"property": 2,
					"logical": 0,
					"conditions": [
						{
							"comparisonType": 1,
							"leftExpression": {
								"type": 1,
								"attribute": "SupportWorkingDayType"
							}
						}
					]
				}
			}
		}/**SCHEMA_BUSINESS_RULES*/,
		methods: {},
		dataModels: /**SCHEMA_DATA_MODELS*/{}/**SCHEMA_DATA_MODELS*/,
		diff: /**SCHEMA_DIFF*/[
			{
				"operation": "insert",
				"name": "DATE60f31385-f3b5-4430-9a94-89602b74eca7",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 1,
						"column": 0,
						"row": 0,
						"layoutName": "Header"
					},
					"bindTo": "Date",
					"enabled": true
				},
				"parentName": "Header",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "IsAvailable5c1160ac-4dad-4df2-a7f1-e8f4e2c631ca",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 1,
						"column": 12,
						"row": 0,
						"layoutName": "Header"
					},
					"bindTo": "IsAvailable"
				},
				"parentName": "Header",
				"propertyName": "items",
				"index": 1
			},
			{
				"operation": "insert",
				"name": "LOOKUP8587bcbc-778f-42a9-81ee-d41b0fe5a145",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 1,
						"column": 0,
						"row": 1,
						"layoutName": "Header"
					},
					"bindTo": "SupportUnit",
					"enabled": true,
					"contentType": 5
				},
				"parentName": "Header",
				"propertyName": "items",
				"index": 2
			},
			{
				"operation": "insert",
				"name": "SupportWorkingDayType2d66f03f-618f-4597-bf63-0b8a3913621d",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 1,
						"column": 12,
						"row": 1,
						"layoutName": "Header"
					},
					"bindTo": "SupportWorkingDayType",
					"enabled": true,
					"contentType": 5
				},
				"parentName": "Header",
				"propertyName": "items",
				"index": 3
			},
			{
				"operation": "insert",
				"name": "Notes20134626-a734-48f5-a621-08373b1f4d18",
				"values": {
					"layout": {
						"colSpan": 24,
						"rowSpan": 3,
						"column": 0,
						"row": 2,
						"layoutName": "Header"
					},
					"bindTo": "Notes",
					"enabled": true,
					"contentType": 0
				},
				"parentName": "Header",
				"propertyName": "items",
				"index": 4
			}
		]/**SCHEMA_DIFF*/
	};
});
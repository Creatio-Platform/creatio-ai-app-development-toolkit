define("SupportUnitEmployeePage", [], function() {
	return {
		entitySchemaName: "SupportUnit",
		attributes: {
			"Name": {
				"dependencies": [
					{
						"columns": ["Contact"],
						"methodName": "setName"
					}
				]
			}
		},
		modules: /**SCHEMA_MODULES*/{
			"Chartcc170260-1bfa-4f5e-87c1-e97215061649": {
				"moduleId": "Chartcc170260-1bfa-4f5e-87c1-e97215061649",
				"moduleName": "CardWidgetModule",
				"config": {
					"parameters": {
						"viewModelConfig": {
							"widgetKey": "Chartcc170260-1bfa-4f5e-87c1-e97215061649",
							"recordId": "5e99af3e-a5c8-46dd-aa8d-7356b287ba9f",
							"primaryColumnValue": {
								"getValueMethod": "getPrimaryColumnValue"
							}
						}
					}
				}
			},
			"Chart487d342e-5478-4450-95c8-cd8592dc107b": {
				"moduleId": "Chart487d342e-5478-4450-95c8-cd8592dc107b",
				"moduleName": "CardWidgetModule",
				"config": {
					"parameters": {
						"viewModelConfig": {
							"widgetKey": "Chart487d342e-5478-4450-95c8-cd8592dc107b",
							"recordId": "5e99af3e-a5c8-46dd-aa8d-7356b287ba9f",
							"primaryColumnValue": {
								"getValueMethod": "getPrimaryColumnValue"
							}
						}
					}
				}
			},
			"Chart2fb7f308-d989-44d3-98d0-2e8985626c57": {
				"moduleId": "Chart2fb7f308-d989-44d3-98d0-2e8985626c57",
				"moduleName": "CardWidgetModule",
				"config": {
					"parameters": {
						"viewModelConfig": {
							"widgetKey": "Chart2fb7f308-d989-44d3-98d0-2e8985626c57",
							"recordId": "5e99af3e-a5c8-46dd-aa8d-7356b287ba9f",
							"primaryColumnValue": {
								"getValueMethod": "getPrimaryColumnValue"
							}
						}
					}
				}
			},
			"Chart9b92676b-4a4a-4635-b28d-a9928781c11e": {
				"moduleId": "Chart9b92676b-4a4a-4635-b28d-a9928781c11e",
				"moduleName": "CardWidgetModule",
				"config": {
					"parameters": {
						"viewModelConfig": {
							"widgetKey": "Chart9b92676b-4a4a-4635-b28d-a9928781c11e",
							"recordId": "5e99af3e-a5c8-46dd-aa8d-7356b287ba9f",
							"primaryColumnValue": {
								"getValueMethod": "getPrimaryColumnValue"
							}
						}
					}
				}
			},
			"Chart8fbad830-d902-4595-b7ef-c1e55673cff0": {
				"moduleId": "Chart8fbad830-d902-4595-b7ef-c1e55673cff0",
				"moduleName": "CardWidgetModule",
				"config": {
					"parameters": {
						"viewModelConfig": {
							"widgetKey": "Chart8fbad830-d902-4595-b7ef-c1e55673cff0",
							"recordId": "5e99af3e-a5c8-46dd-aa8d-7356b287ba9f",
							"primaryColumnValue": {
								"getValueMethod": "getPrimaryColumnValue"
							}
						}
					}
				}
			},
			"Chart6f2595e0-0875-4ce5-912a-0f72907d86b6": {
				"moduleId": "Chart6f2595e0-0875-4ce5-912a-0f72907d86b6",
				"moduleName": "CardWidgetModule",
				"config": {
					"parameters": {
						"viewModelConfig": {
							"widgetKey": "Chart6f2595e0-0875-4ce5-912a-0f72907d86b6",
							"recordId": "5e99af3e-a5c8-46dd-aa8d-7356b287ba9f",
							"primaryColumnValue": {
								"getValueMethod": "getPrimaryColumnValue"
							}
						}
					}
				}
			},
			"Chartb3c55e3f-943a-4d04-9ed8-b72d1b3dc6a9": {
				"moduleId": "Chartb3c55e3f-943a-4d04-9ed8-b72d1b3dc6a9",
				"moduleName": "CardWidgetModule",
				"config": {
					"parameters": {
						"viewModelConfig": {
							"widgetKey": "Chartb3c55e3f-943a-4d04-9ed8-b72d1b3dc6a9",
							"recordId": "5e99af3e-a5c8-46dd-aa8d-7356b287ba9f",
							"primaryColumnValue": {
								"getValueMethod": "getPrimaryColumnValue"
							}
						}
					}
				}
			},
			"Chart70adb5cf-e948-48ed-a152-b8c12ff022c7": {
				"moduleId": "Chart70adb5cf-e948-48ed-a152-b8c12ff022c7",
				"moduleName": "CardWidgetModule",
				"config": {
					"parameters": {
						"viewModelConfig": {
							"widgetKey": "Chart70adb5cf-e948-48ed-a152-b8c12ff022c7",
							"recordId": "5e99af3e-a5c8-46dd-aa8d-7356b287ba9f",
							"primaryColumnValue": {
								"getValueMethod": "getPrimaryColumnValue"
							}
						}
					}
				}
			},
			"Charte41e7447-b151-42c9-b83f-43b6842129a2": {
				"moduleId": "Charte41e7447-b151-42c9-b83f-43b6842129a2",
				"moduleName": "CardWidgetModule",
				"config": {
					"parameters": {
						"viewModelConfig": {
							"widgetKey": "Charte41e7447-b151-42c9-b83f-43b6842129a2",
							"recordId": "5e99af3e-a5c8-46dd-aa8d-7356b287ba9f",
							"primaryColumnValue": {
								"getValueMethod": "getPrimaryColumnValue"
							}
						}
					}
				}
			}
		}/**SCHEMA_MODULES*/,
		details: /**SCHEMA_DETAILS*/{
			"SupportScheduleDetail": {
				"schemaName": "SupportScheduleEmployeeDetail",
				"entitySchemaName": "SupportSchedule",
				"filter": {
					"detailColumn": "SupportUnit",
					"masterColumn": "Id"
				}
			},
			"SupportUnitLogDetail": {
				"schemaName": "SupportUnitLogDetail",
				"entitySchemaName": "SupportUnitLog",
				"filter": {
					"detailColumn": "SupportUnit",
					"masterColumn": "Id"
				}
			},
			"SupportScheduleLogDetail": {
				"schemaName": "SupportScheduleLogDetail",
				"entitySchemaName": "SupportScheduleLog",
				"filter": {
					"detailColumn": "SupportUnit",
					"masterColumn": "Id"
				}
			}
		}/**SCHEMA_DETAILS*/,
		businessRules: /**SCHEMA_BUSINESS_RULES*/{
			"ParentSupportUnit": {
				"e7f47c35-9942-456b-98a8-a62e5b60bb16": {
					"uId": "e7f47c35-9942-456b-98a8-a62e5b60bb16",
					"enabled": true,
					"removed": false,
					"ruleType": 1,
					"baseAttributePatch": "SupportUnitType",
					"comparisonType": 3,
					"type": 0,
					"value": "af503451-3176-4dd8-86f5-c70340d9ceb5",
					"dataValueType": 10
				}
			},
			"SupportWorkingDayType": {
				"3f0acb39-99dc-4068-889b-d89abb9d825f": {
					"uId": "3f0acb39-99dc-4068-889b-d89abb9d825f",
					"enabled": true,
					"removed": false,
					"ruleType": 1,
					"baseAttributePatch": "IsAvailable",
					"comparisonType": 3,
					"type": 0,
					"value": true,
					"dataValueType": 12
				}
			},
			"Contact": {
				"059593da-81ce-48ac-a636-fbc7134d1ce7": {
					"uId": "059593da-81ce-48ac-a636-fbc7134d1ce7",
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
								"attribute": "Contact"
							}
						}
					]
				}
			},
			"Calendar": {
				"212f4d1b-96f2-4797-ac59-cadc66283f3b": {
					"uId": "212f4d1b-96f2-4797-ac59-cadc66283f3b",
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
								"attribute": "Calendar"
							}
						}
					]
				}
			}
		}/**SCHEMA_BUSINESS_RULES*/,
		methods: {
			setName: function(){
				this.$Name = this.$Contact && this.$Contact.displayValue;
			}
		},
		dataModels: /**SCHEMA_DATA_MODELS*/{}/**SCHEMA_DATA_MODELS*/,
		diff: /**SCHEMA_DIFF*/[
			{
				"operation": "insert",
				"name": "ParentSupportUnit",
				"values": {
					"layout": {
						"colSpan": 24,
						"rowSpan": 1,
						"column": 0,
						"row": 0,
						"layoutName": "ProfileContainer"
					},
					"bindTo": "ParentSupportUnit",
					"isRequired": true,
					"contentType": 5
				},
				"parentName": "ProfileContainer",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "Contact",
				"values": {
					"layout": {
						"colSpan": 24,
						"rowSpan": 1,
						"column": 0,
						"row": 1,
						"layoutName": "ProfileContainer"
					},
					"bindTo": "Contact",
					"enabled": true,
					"contentType": 5
				},
				"parentName": "ProfileContainer",
				"propertyName": "items",
				"index": 1
			},
			{
				"operation": "insert",
				"name": "Calendar",
				"values": {
					"layout": {
						"colSpan": 24,
						"rowSpan": 1,
						"column": 0,
						"row": 2,
						"layoutName": "ProfileContainer"
					},
					"bindTo": "Calendar",
					"enabled": true,
					"isRequired": true,
					"contentType": 5
				},
				"parentName": "ProfileContainer",
				"propertyName": "items",
				"index": 2
			},
			{
				"operation": "insert",
				"name": "SupportWorkingDayType",
				"values": {
					"layout": {
						"colSpan": 24,
						"rowSpan": 1,
						"column": 0,
						"row": 3,
						"layoutName": "ProfileContainer"
					},
					"bindTo": "SupportWorkingDayType",
					"enabled": true,
					"contentType": 5
				},
				"parentName": "ProfileContainer",
				"propertyName": "items",
				"index": 3
			},
			{
				"operation": "insert",
				"name": "Active",
				"values": {
					"layout": {
						"colSpan": 24,
						"rowSpan": 1,
						"column": 0,
						"row": 4,
						"layoutName": "ProfileContainer"
					},
					"bindTo": "Active",
					"enabled": true
				},
				"parentName": "ProfileContainer",
				"propertyName": "items",
				"index": 4
			},
			{
				"operation": "insert",
				"name": "SupportEmpIndex",
				"values": {
					"layout": {
						"colSpan": 24,
						"rowSpan": 1,
						"column": 0,
						"row": 5,
						"layoutName": "ProfileContainer"
					},
					"bindTo": "SupportEmpIndex"
				},
				"parentName": "ProfileContainer",
				"propertyName": "items",
				"index": 5
			},
			{
				"operation": "insert",
				"name": "BOOLEAN1dfa7c5a-7e0d-4774-bc3f-071437c5d01c",
				"values": {
					"layout": {
						"colSpan": 24,
						"rowSpan": 1,
						"column": 0,
						"row": 6,
						"layoutName": "ProfileContainer"
					},
					"bindTo": "Canprocessreopencases",
					"enabled": true
				},
				"parentName": "ProfileContainer",
				"propertyName": "items",
				"index": 6
			},
			{
				"operation": "insert",
				"name": "SupportCaseLimit0cfee476-d1f3-4aa6-96e5-38260f888247",
				"values": {
					"layout": {
						"colSpan": 24,
						"rowSpan": 1,
						"column": 0,
						"row": 7,
						"layoutName": "ProfileContainer"
					},
					"bindTo": "SupportCaseLimit"
				},
				"parentName": "ProfileContainer",
				"propertyName": "items",
				"index": 7
			},
			{
				"operation": "insert",
				"name": "ScheduleTab",
				"values": {
					"caption": {
						"bindTo": "Resources.Strings.ScheduleTabCaption"
					},
					"items": [],
					"order": 0
				},
				"parentName": "Tabs",
				"propertyName": "tabs",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "SupportScheduleDetail",
				"values": {
					"itemType": 2,
					"markerValue": "added-detail"
				},
				"parentName": "ScheduleTab",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "KpiTab",
				"values": {
					"caption": {
						"bindTo": "Resources.Strings.KpiTabCaption"
					},
					"items": [],
					"order": 1
				},
				"parentName": "Tabs",
				"propertyName": "tabs",
				"index": 1
			},
			{
				"operation": "insert",
				"name": "FinanceIndexGroup",
				"values": {
					"caption": {
						"bindTo": "Resources.Strings.FinanceIndexGroupCaption"
					},
					"itemType": 15,
					"markerValue": "added-group",
					"items": []
				},
				"parentName": "KpiTab",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "FinanceIndexGroupGridLayout",
				"values": {
					"itemType": 0,
					"items": []
				},
				"parentName": "FinanceIndexGroup",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "Chart6f2595e0-0875-4ce5-912a-0f72907d86b6",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 8,
						"column": 0,
						"row": 0,
						"layoutName": "FinanceIndexGroupGridLayout",
						"useFixedColumnHeight": true
					},
					"itemType": 4,
					"classes": {
						"wrapClassName": [
							"card-widget-grid-layout-item"
						]
					}
				},
				"parentName": "FinanceIndexGroupGridLayout",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "Chartb3c55e3f-943a-4d04-9ed8-b72d1b3dc6a9",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 8,
						"column": 12,
						"row": 0,
						"layoutName": "FinanceIndexGroupGridLayout",
						"useFixedColumnHeight": true
					},
					"itemType": 4,
					"classes": {
						"wrapClassName": [
							"card-widget-grid-layout-item"
						]
					}
				},
				"parentName": "FinanceIndexGroupGridLayout",
				"propertyName": "items",
				"index": 1
			},
			{
				"operation": "insert",
				"name": "PersonalKpiGroup",
				"values": {
					"caption": {
						"bindTo": "Resources.Strings.PersonalKpiGroupCaption"
					},
					"itemType": 15,
					"markerValue": "added-group",
					"items": []
				},
				"parentName": "KpiTab",
				"propertyName": "items",
				"index": 1
			},
			{
				"operation": "insert",
				"name": "PersonalKpiGroupGridLayout",
				"values": {
					"itemType": 0,
					"items": []
				},
				"parentName": "PersonalKpiGroup",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "Chart9b92676b-4a4a-4635-b28d-a9928781c11e",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 8,
						"column": 0,
						"row": 0,
						"layoutName": "PersonalKpiGroupGridLayout",
						"useFixedColumnHeight": true
					},
					"itemType": 4,
					"classes": {
						"wrapClassName": [
							"card-widget-grid-layout-item"
						]
					}
				},
				"parentName": "PersonalKpiGroupGridLayout",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "Chartcc170260-1bfa-4f5e-87c1-e97215061649",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 8,
						"column": 12,
						"row": 0,
						"layoutName": "PersonalKpiGroupGridLayout",
						"useFixedColumnHeight": true
					},
					"itemType": 4,
					"classes": {
						"wrapClassName": [
							"card-widget-grid-layout-item"
						]
					}
				},
				"parentName": "PersonalKpiGroupGridLayout",
				"propertyName": "items",
				"index": 1
			},
			{
				"operation": "insert",
				"name": "Chart2fb7f308-d989-44d3-98d0-2e8985626c57",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 8,
						"column": 0,
						"row": 8,
						"layoutName": "PersonalKpiGroupGridLayout",
						"useFixedColumnHeight": true
					},
					"itemType": 4,
					"classes": {
						"wrapClassName": [
							"card-widget-grid-layout-item"
						]
					}
				},
				"parentName": "PersonalKpiGroupGridLayout",
				"propertyName": "items",
				"index": 2
			},
			{
				"operation": "insert",
				"name": "Charte41e7447-b151-42c9-b83f-43b6842129a2",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 8,
						"column": 12,
						"row": 8,
						"layoutName": "PersonalKpiGroupGridLayout",
						"useFixedColumnHeight": true
					},
					"itemType": 4,
					"classes": {
						"wrapClassName": [
							"card-widget-grid-layout-item"
						]
					}
				},
				"parentName": "PersonalKpiGroupGridLayout",
				"propertyName": "items",
				"index": 3
			},
			{
				"operation": "insert",
				"name": "Chart70adb5cf-e948-48ed-a152-b8c12ff022c7",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 8,
						"column": 0,
						"row": 16,
						"layoutName": "PersonalKpiGroupGridLayout",
						"useFixedColumnHeight": true
					},
					"itemType": 4,
					"classes": {
						"wrapClassName": [
							"card-widget-grid-layout-item"
						]
					}
				},
				"parentName": "PersonalKpiGroupGridLayout",
				"propertyName": "items",
				"index": 4
			},
			{
				"operation": "insert",
				"name": "Chart8fbad830-d902-4595-b7ef-c1e55673cff0",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 8,
						"column": 12,
						"row": 16,
						"layoutName": "PersonalKpiGroupGridLayout",
						"useFixedColumnHeight": true
					},
					"itemType": 4,
					"classes": {
						"wrapClassName": [
							"card-widget-grid-layout-item"
						]
					}
				},
				"parentName": "PersonalKpiGroupGridLayout",
				"propertyName": "items",
				"index": 5
			},
			{
				"operation": "insert",
				"name": "Chart487d342e-5478-4450-95c8-cd8592dc107b",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 8,
						"column": 0,
						"row": 24,
						"layoutName": "PersonalKpiGroupGridLayout",
						"useFixedColumnHeight": true
					},
					"itemType": 4,
					"classes": {
						"wrapClassName": [
							"card-widget-grid-layout-item"
						]
					}
				},
				"parentName": "PersonalKpiGroupGridLayout",
				"propertyName": "items",
				"index": 6
			},
			{
				"operation": "insert",
				"name": "HistoryTab",
				"values": {
					"caption": {
						"bindTo": "Resources.Strings.HistoryTabCaption"
					},
					"items": [],
					"order": 2
				},
				"parentName": "Tabs",
				"propertyName": "tabs",
				"index": 2
			},
			{
				"operation": "insert",
				"name": "SupportUnitLogDetail",
				"values": {
					"itemType": 2,
					"markerValue": "added-detail"
				},
				"parentName": "HistoryTab",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "SupportScheduleLogDetail",
				"values": {
					"itemType": 2,
					"markerValue": "added-detail"
				},
				"parentName": "HistoryTab",
				"propertyName": "items",
				"index": 1
			},
			{
				"operation": "merge",
				"name": "ESNTab",
				"values": {
					"order": 3
				}
			},
			{
				"operation": "merge",
				"name": "ChangesHistoryTab",
				"values": {
					"order": 4
				}
			}
		]/**SCHEMA_DIFF*/
	};
});

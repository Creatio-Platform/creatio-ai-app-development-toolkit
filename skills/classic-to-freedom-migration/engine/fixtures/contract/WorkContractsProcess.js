define("ContractPageV2", [], function() {
	return {
		entitySchemaName: "Contract",
		details: /**SCHEMA_DETAILS*/{
			"AccountAddressDetailV21fe70e6a": {
				"schemaName": "AccountAddressDetailV2",
				"entitySchemaName": "AccountAddress",
				"filter": {
					"detailColumn": "Account",
					"masterColumn": "Account"
				}
			},
			"CorrespondenceLinkDetail": {
				"schemaName": "CorrespondenceLinkDetail",
				"entitySchemaName": "CorrespondenceLink",
				"filter": {
					"detailColumn": "Contract",
					"masterColumn": "Id"
				}
			}
		}/**SCHEMA_DETAILS*/,
		modules: /**SCHEMA_MODULES*/{}/**SCHEMA_MODULES*/,
		dataModels: /**SCHEMA_DATA_MODELS*/{}/**SCHEMA_DATA_MODELS*/,
		diff: /**SCHEMA_DIFF*/[
			{
				"operation": "merge",
				"name": "StartDate",
				"values": {
					"enabled": true,
					"labelConfig": {
						"caption": {
							"bindTo": "Resources.Strings.StartDateLabelCaption"
						}
					}
				}
			},
			{
				"operation": "insert",
				"name": "SalesAssistantContactab62a7cd-0ed6-4aa9-a8b2-63108e64501d",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 1,
						"column": 12,
						"row": 2,
						"layoutName": "Header"
					},
					"bindTo": "SalesAssistantContact"
				},
				"parentName": "Header",
				"propertyName": "items",
				"index": 6
			},
			{
				"operation": "merge",
				"name": "CurrencyRateOnStartDate",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 1,
						"column": 12,
						"row": 5,
						"layoutName": "Header"
					},
					"labelConfig": {
						"caption": {
							"bindTo": "Resources.Strings.CurrencyRateOnStartDateLabelCaption"
						}
					},
					"enabled": true
				}
			},
			{
				"operation": "move",
				"name": "CurrencyRateOnStartDate",
				"parentName": "Header",
				"propertyName": "items",
				"index": 10
			},
			{
				"operation": "merge",
				"name": "ContractLength",
				"values": {
					"labelConfig": {
						"caption": {
							"bindTo": "Resources.Strings.ContractLengthLabelCaption"
						}
					},
					"enabled": true
				}
			},
			{
				"operation": "merge",
				"name": "TCV682c35ae-d053-4932-a914-676ad837916f",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 1,
						"column": 0,
						"row": 6,
						"layoutName": "Header"
					}
				}
			},
			{
				"operation": "merge",
				"name": "ACV5eee7ee8-b703-422e-991f-61a64b341603",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 1,
						"column": 12,
						"row": 6,
						"layoutName": "Header"
					}
				}
			},
			{
				"operation": "merge",
				"name": "GeneralInfoTab",
				"values": {
					"order": 0
				}
			},
			{
				"operation": "merge",
				"name": "Account",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 1,
						"column": 0,
						"row": 0
					}
				}
			},
			{
				"operation": "move",
				"name": "Account",
				"parentName": "group_gridLayout",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "merge",
				"name": "CustomerBillingInfo",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 1,
						"column": 12,
						"row": 0
					}
				}
			},
			{
				"operation": "move",
				"name": "CustomerBillingInfo",
				"parentName": "group_gridLayout",
				"propertyName": "items",
				"index": 1
			},
			{
				"operation": "merge",
				"name": "OurCompany",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 1,
						"column": 0,
						"row": 1
					}
				}
			},
			{
				"operation": "move",
				"name": "OurCompany",
				"parentName": "group_gridLayout",
				"propertyName": "items",
				"index": 2
			},
			{
				"operation": "merge",
				"name": "SupplierBillingInfo",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 1,
						"column": 12,
						"row": 2
					}
				}
			},
			{
				"operation": "insert",
				"name": "GeneralInfoTabGroupe00b109d",
				"values": {
					"caption": {
						"bindTo": "Resources.Strings.GeneralInfoTabGroupe00b109dGroupCaption"
					},
					"itemType": 15,
					"markerValue": "added-group",
					"items": []
				},
				"parentName": "GeneralInfoTab",
				"propertyName": "items",
				"index": 1
			},
			{
				"operation": "insert",
				"name": "GeneralInfoTabGridLayoutc608aa43",
				"values": {
					"itemType": 0,
					"items": []
				},
				"parentName": "GeneralInfoTabGroupe00b109d",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "ContractReturnDate283d4932-befc-4454-9c8d-cdb77c1cb21f",
				"values": {
					"layout": {
						"colSpan": 14,
						"rowSpan": 1,
						"column": 10,
						"row": 0,
						"layoutName": "GeneralInfoTabGridLayoutc608aa43"
					},
					"bindTo": "ContractReturnDate"
				},
				"parentName": "GeneralInfoTabGridLayoutc608aa43",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "LOOKUP8dd34064-3603-453e-a774-fb613858f538",
				"values": {
					"layout": {
						"colSpan": 10,
						"rowSpan": 1,
						"column": 0,
						"row": 1,
						"layoutName": "GeneralInfoTabGridLayoutc608aa43"
					},
					"bindTo": "ContractRecipient",
					"enabled": true,
					"contentType": 5
				},
				"parentName": "GeneralInfoTabGridLayoutc608aa43",
				"propertyName": "items",
				"index": 1
			},
			{
				"operation": "insert",
				"name": "DeliveryType1e6acbc5-4c16-4513-81d2-51c51e42efca",
				"values": {
					"layout": {
						"colSpan": 10,
						"rowSpan": 1,
						"column": 0,
						"row": 0,
						"layoutName": "GeneralInfoTabGridLayoutc608aa43"
					},
					"bindTo": "DeliveryType",
					"enabled": true,
					"contentType": 3
				},
				"parentName": "GeneralInfoTabGridLayoutc608aa43",
				"propertyName": "items",
				"index": 2
			},
			{
				"operation": "insert",
				"name": "ContractRecipientAddress02494f3a-9627-42af-a4b8-ced125026dee",
				"values": {
					"layout": {
						"colSpan": 24,
						"rowSpan": 1,
						"column": 0,
						"row": 2,
						"layoutName": "GeneralInfoTabGridLayoutc608aa43"
					},
					"bindTo": "ContractRecipientAddress"
				},
				"parentName": "GeneralInfoTabGridLayoutc608aa43",
				"propertyName": "items",
				"index": 3
			},
			{
				"operation": "insert",
				"name": "AccountAddressDetailV21fe70e6a",
				"values": {
					"itemType": 2,
					"markerValue": "added-detail"
				},
				"parentName": "GeneralInfoTab",
				"propertyName": "items",
				"index": 2
			},
			{
				"operation": "merge",
				"name": "ContractPassportTab",
				"values": {
					"order": 1
				}
			},
			{
				"operation": "merge",
				"name": "SaaSMetricsTab",
				"values": {
					"order": 2
				}
			},
			{
				"operation": "merge",
				"name": "HistoryTab",
				"values": {
					"order": 3
				}
			},
			{
				"operation": "insert",
				"name": "CorrespondenceLinkDetail",
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
				"name": "ContractVisaTab",
				"values": {
					"order": 4
				}
			},
			{
				"operation": "merge",
				"name": "NotesAndFilesTab",
				"values": {
					"order": 5
				}
			},
			{
				"operation": "merge",
				"name": "ESNTab",
				"values": {
					"order": 6
				}
			},
			{
				"operation": "remove",
				"name": "State"
			},
			{
				"operation": "move",
				"name": "EndDate",
				"parentName": "Header",
				"propertyName": "items",
				"index": 8
			},
			{
				"operation": "move",
				"name": "Type",
				"parentName": "Header",
				"propertyName": "items",
				"index": 1
			},
			{
				"operation": "move",
				"name": "Number",
				"parentName": "Header",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "move",
				"name": "Amount",
				"parentName": "Header",
				"propertyName": "items",
				"index": 12
			},
			{
				"operation": "move",
				"name": "ContractParty",
				"parentName": "Header",
				"propertyName": "items",
				"index": 9
			},
			{
				"operation": "move",
				"name": "Printable",
				"parentName": "group_gridLayout",
				"propertyName": "items",
				"index": 3
			}
		]/**SCHEMA_DIFF*/,
		methods: {},
		rules: {},
		businessRules: /**SCHEMA_BUSINESS_RULES*/{
	"Owner": {
		"16112a5c-37f2-4814-b36f-e78afbcdeaa1": {
			"uId": "16112a5c-37f2-4814-b36f-e78afbcdeaa1",
			"enabled": true,
			"removed": false,
			"ruleType": 1,
			"baseAttributePatch": "Account",
			"comparisonType": 3,
			"type": 0,
			"value": "7a6f2144-a972-423b-8cc4-08a68a48ddba",
			"dataValueType": 10
		}
	},
	"Parent": {
		"7555cc59-2919-4fc4-9a9d-c72ca3323728": {
			"uId": "7555cc59-2919-4fc4-9a9d-c72ca3323728",
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
						"attribute": "Type",
						"attributePath": "IsSlave"
					},
					"rightExpression": {
						"type": 0,
						"value": true,
						"dataValueType": 12
					}
				}
			]
		}
	}
}/**SCHEMA_BUSINESS_RULES*/
	};
});

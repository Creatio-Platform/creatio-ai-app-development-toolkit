define("MbContractPage", ["BusinessRuleModule", "ProcessModuleUtilities", "MbDocumentTotalsMixin"],
		function(BusinessRuleModule, ProcessModuleUtilities) {
	return {
		entitySchemaName: "MbContract",
		mixins: {
			MbDocumentTotalsMixin: "Terrasoft.MbDocumentTotalsMixin"
		},
		attributes: {
			"MbCanEditFields": {
				"dataValueType": Terrasoft.DataValueType.BOOLEAN,
				"type": Terrasoft.ViewModelColumnType.VIRTUAL_COLUMN,
				"value": true
			},
			"MbStatus": {
				"dependencies": [
					{
						"columns": ["MbStatus"],
						"methodName": "mbOnStatusChanged"
					}
				]
			}
		},
		details: /**SCHEMA_DETAILS*/{
			"MbContractItemDetail": {
				"schemaName": "MbContractItemDetail",
				"entitySchemaName": "MbContractItem",
				"filter": {
					"detailColumn": "MbContract",
					"masterColumn": "Id"
				}
			},
			"MbContractPaymentDetail": {
				"schemaName": "MbContractPaymentDetail",
				"entitySchemaName": "MbContractPayment",
				"filter": {
					"detailColumn": "MbContract",
					"masterColumn": "Id"
				}
			},
			"MbDeliveryNoteDetail": {
				"schemaName": "MbDeliveryNoteDetail",
				"entitySchemaName": "MbDeliveryNote",
				"filter": {
					"detailColumn": "MbContract",
					"masterColumn": "Id"
				}
			},
			"MbReturnNoteDetail": {
				"schemaName": "MbReturnNoteDetail",
				"entitySchemaName": "MbReturnNote",
				"filter": {
					"detailColumn": "MbContract",
					"masterColumn": "Id"
				}
			}
		}/**SCHEMA_DETAILS*/,
		businessRules: /**SCHEMA_BUSINESS_RULES*/{
			"MbEndDate": {
				"5c1d2e3f-0a1b-4c2d-8e3f-4a5b6c7d8e01": {
					"uId": "5c1d2e3f-0a1b-4c2d-8e3f-4a5b6c7d8e01",
					"enabled": true,
					"removed": false,
					"ruleType": 0,
					"property": 2,
					"logical": 0,
					"conditions": [
						{
							"comparisonType": 3,
							"leftExpression": {"type": 1, "attribute": "MbStatus"},
							"rightExpression": {"type": 0, "value": "6f0c4b2e-1d1a-4c3e-9a51-0b1c2d3e4f02", "dataValueType": 10}
						}
					]
				}
			},
			"MbApprovalComment": {
				"5c1d2e3f-0a1b-4c2d-8e3f-4a5b6c7d8e02": {
					"uId": "5c1d2e3f-0a1b-4c2d-8e3f-4a5b6c7d8e02",
					"enabled": true,
					"removed": false,
					"ruleType": 0,
					"property": 0,
					"logical": 0,
					"conditions": [
						{
							"comparisonType": 3,
							"leftExpression": {"type": 1, "attribute": "MbApproved"},
							"rightExpression": {"type": 0, "value": true, "dataValueType": 12}
						}
					]
				}
			},
			"MbStartDate": {
				"5c1d2e3f-0a1b-4c2d-8e3f-4a5b6c7d8e03": {
					"uId": "5c1d2e3f-0a1b-4c2d-8e3f-4a5b6c7d8e03",
					"enabled": true,
					"removed": false,
					"ruleType": 0,
					"property": 1,
					"logical": 0,
					"conditions": [
						{
							"comparisonType": 3,
							"leftExpression": {"type": 1, "attribute": "MbStatus"},
							"rightExpression": {"type": 0, "value": "6f0c4b2e-1d1a-4c3e-9a51-0b1c2d3e4f01", "dataValueType": 10}
						}
					]
				}
			},
			"MbContact": {
				"5c1d2e3f-0a1b-4c2d-8e3f-4a5b6c7d8e04": {
					"uId": "5c1d2e3f-0a1b-4c2d-8e3f-4a5b6c7d8e04",
					"enabled": true,
					"removed": false,
					"ruleType": 1,
					"baseAttributePatch": "Account",
					"comparisonType": 3,
					"autoClean": true,
					"autocomplete": true,
					"type": 1,
					"attribute": "MbAccount"
				}
			}
		}/**SCHEMA_BUSINESS_RULES*/,
		methods: {
			onEntityInitialized: function() {
				this.callParent(arguments);
				this.mbUpdateCanEditFields();
				if (this.isAddMode()) {
					this.set("MbStatus", {value: "6f0c4b2e-1d1a-4c3e-9a51-0b1c2d3e4f01", displayValue: "Draft"});
					this.mbAssignNumber();
				}
			},

			/**
			 * Takes the next contract number from the MbContractLastNumber system setting
			 * and writes the incremented value back, so opening a new card changes data.
			 */
			mbAssignNumber: function() {
				Terrasoft.SysSettings.querySysSettingsItem("MbContractLastNumber", function(lastNumber) {
					const next = (Number.parseInt(lastNumber, 10) || 0) + 1;
					Terrasoft.SysSettings.postSysSettingsValue("MbContractLastNumber", next);
					const format = this.get("Resources.Strings.MbNumberFormat");
					this.set("MbNumber", Ext.String.format(format, Ext.String.leftPad(next, 5, "0")));
				}, this);
			},

			mbOnStatusChanged: function() {
				this.mbUpdateCanEditFields();
			},

			mbUpdateCanEditFields: function() {
				const status = this.get("MbStatus");
				this.set("MbCanEditFields", status?.value !== "6f0c4b2e-1d1a-4c3e-9a51-0b1c2d3e4f03");
			},

			mbIsStartApprovalEnabled: function() {
				return !this.isNewMode() && !this.get("MbApproved");
			},

			mbStartApproval: function() {
				if (!this.mbIsStartApprovalEnabled()) {
					this.showInformationDialog(this.get("Resources.Strings.MbAlreadyApprovedMessage"));
					return;
				}
				ProcessModuleUtilities.executeProcess({
					sysProcessName: "MbApproveContractProcess",
					parameters: {
						ContractId: this.get("Id")
					}
				});
			},

			onDetailChanged: function(detail) {
				this.callParent(arguments);
				if (detail?.schemaName === "MbContractItemDetail") {
					this.mbRecalculateAmount();
				}
			},

			/**
			 * Recalculates the amount with the same rule the document pages use (MbDocumentTotalsMixin).
			 */
			mbRecalculateAmount: function() {
				this.mbRecalculateContractAmount(this.get("Id"), function(amount) {
					this.set("MbAmount", amount);
				}, this);
			}
		},
		diff: /**SCHEMA_DIFF*/[
			{
				"operation": "insert",
				"name": "MbName",
				"values": {
					"layout": {"colSpan": 24, "rowSpan": 1, "column": 0, "row": 0, "layoutName": "ProfileContainer"},
					"bindTo": "MbName"
				},
				"parentName": "ProfileContainer",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbNumber",
				"values": {
					"layout": {"colSpan": 24, "rowSpan": 1, "column": 0, "row": 1, "layoutName": "ProfileContainer"},
					"bindTo": "MbNumber"
				},
				"parentName": "ProfileContainer",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbStatus",
				"values": {
					"layout": {"colSpan": 24, "rowSpan": 1, "column": 0, "row": 2, "layoutName": "ProfileContainer"},
					"bindTo": "MbStatus"
				},
				"parentName": "ProfileContainer",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbAmount",
				"values": {
					"layout": {"colSpan": 24, "rowSpan": 1, "column": 0, "row": 3, "layoutName": "ProfileContainer"},
					"bindTo": "MbAmount",
					"enabled": false
				},
				"parentName": "ProfileContainer",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbApproved",
				"values": {
					"layout": {"colSpan": 24, "rowSpan": 1, "column": 0, "row": 4, "layoutName": "ProfileContainer"},
					"bindTo": "MbApproved",
					"enabled": false
				},
				"parentName": "ProfileContainer",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbAccount",
				"values": {
					"layout": {"colSpan": 12, "rowSpan": 1, "column": 0, "row": 0, "layoutName": "Header"},
					"bindTo": "MbAccount"
				},
				"parentName": "Header",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbContact",
				"values": {
					"layout": {"colSpan": 12, "rowSpan": 1, "column": 12, "row": 0, "layoutName": "Header"},
					"bindTo": "MbContact"
				},
				"parentName": "Header",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbStartDate",
				"values": {
					"layout": {"colSpan": 12, "rowSpan": 1, "column": 0, "row": 1, "layoutName": "Header"},
					"bindTo": "MbStartDate"
				},
				"parentName": "Header",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbEndDate",
				"values": {
					"layout": {"colSpan": 12, "rowSpan": 1, "column": 12, "row": 1, "layoutName": "Header"},
					"bindTo": "MbEndDate"
				},
				"parentName": "Header",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbApprovalComment",
				"values": {
					"layout": {"colSpan": 24, "rowSpan": 1, "column": 0, "row": 2, "layoutName": "Header"},
					"bindTo": "MbApprovalComment"
				},
				"parentName": "Header",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbGeneralTab",
				"values": {
					"caption": {"bindTo": "Resources.Strings.MbGeneralTabCaption"},
					"items": []
				},
				"parentName": "Tabs",
				"propertyName": "tabs",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "MbGeneralGrid",
				"values": {
					"itemType": Terrasoft.ViewItemType.GRID_LAYOUT,
					"items": []
				},
				"parentName": "MbGeneralTab",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "MbNotes",
				"values": {
					"layout": {"colSpan": 24, "rowSpan": 1, "column": 0, "row": 0, "layoutName": "MbGeneralGrid"},
					"bindTo": "MbNotes",
					"contentType": Terrasoft.ContentType.LONG_TEXT
				},
				"parentName": "MbGeneralGrid",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbItemsTab",
				"values": {
					"caption": {"bindTo": "Resources.Strings.MbItemsTabCaption"},
					"items": []
				},
				"parentName": "Tabs",
				"propertyName": "tabs",
				"index": 1
			},
			{
				"operation": "insert",
				"name": "MbContractItemDetail",
				"values": {
					"itemType": Terrasoft.ViewItemType.DETAIL,
					"markerValue": "added-detail"
				},
				"parentName": "MbItemsTab",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "MbContractPaymentDetail",
				"values": {
					"itemType": Terrasoft.ViewItemType.DETAIL,
					"markerValue": "added-detail"
				},
				"parentName": "MbItemsTab",
				"propertyName": "items",
				"index": 1
			},
			{
				"operation": "insert",
				"name": "MbDocumentsTab",
				"values": {
					"caption": {"bindTo": "Resources.Strings.MbDocumentsTabCaption"},
					"items": []
				},
				"parentName": "Tabs",
				"propertyName": "tabs",
				"index": 2
			},
			{
				"operation": "insert",
				"name": "MbDeliveryNoteDetail",
				"values": {
					"itemType": Terrasoft.ViewItemType.DETAIL,
					"markerValue": "added-detail"
				},
				"parentName": "MbDocumentsTab",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "MbReturnNoteDetail",
				"values": {
					"itemType": Terrasoft.ViewItemType.DETAIL,
					"markerValue": "added-detail"
				},
				"parentName": "MbDocumentsTab",
				"propertyName": "items",
				"index": 1
			},
			{
				"operation": "insert",
				"name": "MbStartApprovalButton",
				"values": {
					"itemType": Terrasoft.ViewItemType.BUTTON,
					"caption": {"bindTo": "Resources.Strings.MbStartApprovalButtonCaption"},
					"click": {"bindTo": "mbStartApproval"},
					"enabled": {"bindTo": "mbIsStartApprovalEnabled"},
					"style": Terrasoft.controls.ButtonEnums.style.GREEN
				},
				"parentName": "LeftContainer",
				"propertyName": "items",
				"index": 5
			}
		]/**SCHEMA_DIFF*/,
		rules: {
			"MbAccount": {
				"MbAccountEnabledByCanEdit": {
					"ruleType": BusinessRuleModule.enums.RuleType.BINDPARAMETER,
					"property": BusinessRuleModule.enums.Property.ENABLED,
					"conditions": [{
						"leftExpression": {
							"type": BusinessRuleModule.enums.ValueType.ATTRIBUTE,
							"attribute": "MbCanEditFields"
						},
						"comparisonType": Terrasoft.ComparisonType.EQUAL,
						"rightExpression": {
							"type": BusinessRuleModule.enums.ValueType.CONSTANT,
							"value": true
						}
					}]
				}
			},
			"MbEndDate": {
				"MbEndDateEnabledByCanEdit": {
					"ruleType": BusinessRuleModule.enums.RuleType.BINDPARAMETER,
					"property": BusinessRuleModule.enums.Property.ENABLED,
					"conditions": [{
						"leftExpression": {
							"type": BusinessRuleModule.enums.ValueType.ATTRIBUTE,
							"attribute": "MbCanEditFields"
						},
						"comparisonType": Terrasoft.ComparisonType.EQUAL,
						"rightExpression": {
							"type": BusinessRuleModule.enums.ValueType.CONSTANT,
							"value": true
						}
					}]
				}
			}
		}
	};
});

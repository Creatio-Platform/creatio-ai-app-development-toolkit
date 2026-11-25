define("MbApproveContractProcessPage", [], function() {
	return {
		attributes: {
			"ContractId": {
				"dataValueType": Terrasoft.DataValueType.GUID,
				"type": Terrasoft.ViewModelColumnType.VIRTUAL_COLUMN
			},
			"MbComment": {
				"dataValueType": Terrasoft.DataValueType.TEXT,
				"type": Terrasoft.ViewModelColumnType.VIRTUAL_COLUMN,
				"value": ""
			}
		},
		details: /**SCHEMA_DETAILS*/{}/**SCHEMA_DETAILS*/,
		businessRules: /**SCHEMA_BUSINESS_RULES*/{}/**SCHEMA_BUSINESS_RULES*/,
		methods: {
			/**
			 * Saves the comment on the contract the process runs for, marks it approved
			 * and completes the process step.
			 */
			mbApprove: function() {
				const contractId = this.get("ContractId");
				const update = Ext.create("Terrasoft.UpdateQuery", {rootSchemaName: "MbContract"});
				update.filters.add("Id", Terrasoft.createColumnFilterWithParameter(
					Terrasoft.ComparisonType.EQUAL, "Id", contractId));
				update.setParameterValue("MbApproved", true, Terrasoft.DataValueType.BOOLEAN);
				update.setParameterValue("MbApprovalComment", this.get("MbComment"), Terrasoft.DataValueType.TEXT);
				update.execute(function() {
					this.acceptProcessElement("SaveButton");
				}, this);
			}
		},
		diff: /**SCHEMA_DIFF*/[
			{
				"operation": "insert",
				"name": "MbComment",
				"values": {
					"layout": {"colSpan": 24, "rowSpan": 1, "column": 0, "row": 0, "layoutName": "NewTab1GridLayout1"},
					"bindTo": "MbComment",
					"caption": {"bindTo": "Resources.Strings.MbCommentCaption"},
					"contentType": Terrasoft.ContentType.LONG_TEXT
				},
				"parentName": "NewTab1GridLayout1",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "MbApproveButton",
				"values": {
					"itemType": Terrasoft.ViewItemType.BUTTON,
					"caption": {"bindTo": "Resources.Strings.MbApproveButtonCaption"},
					"click": {"bindTo": "mbApprove"},
					"style": Terrasoft.controls.ButtonEnums.style.GREEN
				},
				"parentName": "ProcessActionButtons",
				"propertyName": "items",
				"index": 0
			}
		]/**SCHEMA_DIFF*/
	};
});

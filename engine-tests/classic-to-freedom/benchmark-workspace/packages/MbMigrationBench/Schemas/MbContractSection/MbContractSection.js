define("MbContractSection", [], function() {
	return {
		entitySchemaName: "MbContract",
		details: /**SCHEMA_DETAILS*/{}/**SCHEMA_DETAILS*/,
		methods: {
			getSectionActions: function() {
				const actions = this.callParent(arguments);
				actions.addItem(this.getButtonMenuItem({Type: "Terrasoft.MenuSeparator", Caption: ""}));
				actions.addItem(this.getButtonMenuItem({
					"Caption": {"bindTo": "Resources.Strings.MbCloseSelectedCaption"},
					"Click": {"bindTo": "mbCloseSelected"},
					"Enabled": {"bindTo": "isAnySelected"}
				}));
				return actions;
			},

			mbCloseSelected: function() {
				const selected = this.get("SelectedRows") || [];
				selected.forEach(function(id) {
					const update = Ext.create("Terrasoft.UpdateQuery", {rootSchemaName: "MbContract"});
					update.filters.add("Id", Terrasoft.createColumnFilterWithParameter(
						Terrasoft.ComparisonType.EQUAL, "Id", id));
					update.setParameterValue("MbStatus", "6f0c4b2e-1d1a-4c3e-9a51-0b1c2d3e4f03", Terrasoft.DataValueType.GUID);
					update.execute(function() {
						this.reloadGridData();
					}, this);
				}, this);
			}
		},
		diff: /**SCHEMA_DIFF*/[
			{
				"operation": "insert",
				"name": "MbStartApprovalButton",
				"values": {
					"itemType": Terrasoft.ViewItemType.BUTTON,
					"caption": {"bindTo": "Resources.Strings.MbStartApprovalButtonCaption"},
					"click": {"bindTo": "onCardAction"},
					"tag": "mbStartApproval",
					"style": Terrasoft.controls.ButtonEnums.style.GREEN
				},
				"parentName": "CombinedModeActionButtonsCardLeftContainer",
				"propertyName": "items",
				"index": 5
			}
		]/**SCHEMA_DIFF*/
	};
});

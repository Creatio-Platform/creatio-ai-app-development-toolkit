define("MbContractSection", [], function() {
	return {
		entitySchemaName: "MbContract",
		details: /**SCHEMA_DETAILS*/{}/**SCHEMA_DETAILS*/,
		methods: {
			getSectionActions: function() {
				var actions = this.callParent(arguments);
				actions.addItem(this.getButtonMenuItem({Type: "Terrasoft.MenuSeparator", Caption: ""}));
				actions.addItem(this.getButtonMenuItem({
					"Caption": {"bindTo": "Resources.Strings.MbCloseSelectedCaption"},
					"Click": {"bindTo": "mbCloseSelected"},
					"Enabled": {"bindTo": "isAnySelected"}
				}));
				return actions;
			},

			mbCloseSelected: function() {
				var selected = this.get("SelectedRows") || [];
				selected.forEach(function(id) {
					var update = Ext.create("Terrasoft.UpdateQuery", {rootSchemaName: "MbContract"});
					update.filters.add("Id", Terrasoft.createColumnFilterWithParameter(
						Terrasoft.ComparisonType.EQUAL, "Id", id));
					update.setParameterValue("MbStatus", "6f0c4b2e-1d1a-4c3e-9a51-0b1c2d3e4f03", Terrasoft.DataValueType.GUID);
					update.execute(function() {
						this.reloadGridData();
					}, this);
				}, this);
			}
		},
		diff: /**SCHEMA_DIFF*/[]/**SCHEMA_DIFF*/
	};
});

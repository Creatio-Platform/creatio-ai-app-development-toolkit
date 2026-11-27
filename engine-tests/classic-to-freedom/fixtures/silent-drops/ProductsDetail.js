define("ProductsDetail", ["OrderStatusMixin"], function() {
	return {
		entitySchemaName: "ProductLine",
		mixins: {
			OrderStatusMixin: "Terrasoft.OrderStatusMixin"
		},
		methods: {
			addToolsButtonMenuItems: function(toolsButtonMenu) {
				this.callParent(arguments);
				this.reAddEditSelectedRecordsMenuItem(toolsButtonMenu);
			},
			reAddEditSelectedRecordsMenuItem: function(toolsButtonMenu) {
				toolsButtonMenu.addItem(this.getButtonMenuItem({
					Caption: { bindTo: "Resources.Strings.EditSelectedRecordsCaption" },
					Click: { bindTo: "editSelectedRecords" },
					Enabled: { bindTo: "isAnySelectedAndCanEditFields" }
				}));
			}
		}
	};
});

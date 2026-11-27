define("ProductHistoryDetail", ["OrderStatusMixin"], function() {
	return {
		entitySchemaName: "ProductLine",
		mixins: {
			OrderStatusMixin: "Terrasoft.OrderStatusMixin"
		},
		attributes: {
			"CanEditFields": { dataValueType: Terrasoft.DataValueType.BOOLEAN, value: false }
		},
		methods: {
			prepareResponseCollectionItem: function(item) {
				this.callParent(arguments);
				if (!this.Ext.isEmpty(item.get("LicenseComment"))) {
					item.customStyle = { "background": "#eeeeee" };
				}
			},
			onActiveRowChange: function(rowId) {
				this.callParent(arguments);
				this.getOrderStatus(rowId, function(statusId) {
					this.set("CanEditFields", !this.getIsStatusNotAllowedForLine(statusId));
				}, this);
			},
			getCopyRecordMenuItem: function() {
				return this.getButtonMenuItem({
					Caption: { bindTo: "Resources.Strings.CopyMenuCaption" },
					Click: { bindTo: "copyRecord" },
					Enabled: { bindTo: "CanEditFields" }
				});
			},
			getDeleteRecordMenuItem: function() {
				return this.getButtonMenuItem({
					Caption: { bindTo: "Resources.Strings.DeleteMenuCaption" },
					Click: { bindTo: "deleteRecords" },
					Enabled: { bindTo: "CanEditFields" }
				});
			}
		}
	};
});

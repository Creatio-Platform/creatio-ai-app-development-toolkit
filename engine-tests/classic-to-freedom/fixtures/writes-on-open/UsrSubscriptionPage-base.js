// The base layer of a two-layer Classic card, anonymised from a customer section: in add or copy mode its
// onEntityInitialized reads the last generation date, resets the counter on a new day and takes the next number.
// The top layer (UsrSubscriptionPage-top.js) overrides onEntityInitialized and only reaches this body through callParent.
define("UsrSubscriptionPage", [], function() {
	return {
		entitySchemaName: "UsrSubscription",
		methods: {
			generateNumber: function(currentDate) {
				this.getIncrementCode(function(number) {
					this.set("UsrNumber", Ext.Date.format(currentDate, "Ymd") + number);
				});
			},
			onEntityInitialized: function() {
				if (this.isAddMode() || this.isCopyMode()) {
					this.Terrasoft.SysSettings.querySysSettingsItem("UsrSubscriptionLastGenerateDate", function(lastDate) {
						var esq = Ext.create("Terrasoft.EntitySchemaQuery", { rootSchemaName: "VwDate", rowCount: 1 });
						esq.addColumn("Year");
						esq.addColumn("Month");
						esq.addColumn("Day");
						esq.getEntity(this.Terrasoft.GUID_EMPTY, function(response) {
							if (response.success) {
								var entity = response.entity;
								var currentDate = new Date(entity.get("Year"), entity.get("Month") - 1, entity.get("Day"));
								if (!lastDate || lastDate.getFullYear() !== currentDate.getFullYear()) {
									this.Terrasoft.SysSettings.postSysSettingsValue("UsrSubscriptionLastGenerateDate", currentDate, function() {
										this.Terrasoft.SysSettings.postSysSettingsValue("UsrSubscriptionLastNumber", 500, function() {
											this.generateNumber(currentDate);
										}, this);
									}, this);
								} else {
									this.generateNumber(currentDate);
								}
							}
						}, this);
					}, this);
				}
				this.callParent(arguments);
			}
		},
		diff: []
	};
});

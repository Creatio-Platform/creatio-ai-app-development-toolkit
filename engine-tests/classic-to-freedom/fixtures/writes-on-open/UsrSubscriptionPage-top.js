// The top layer of the two-layer card (see UsrSubscriptionPage-base.js): its onEntityInitialized writes nothing
// itself, so a walk that read only the effective body missed the counter the base layer takes.
define("UsrSubscriptionPage", [], function() {
	return {
		entitySchemaName: "UsrSubscription",
		methods: {
			onEntityInitialized: function() {
				this.callParent(arguments);
				this.sandbox.subscribe("RenderDashboard", function(id) {
					this.loadDashboardModule(id);
				}, this, ["UsrSiteDetail"]);
			},
			loadDashboardModule: function() {
				this.sandbox.loadModule("DashboardModule", { renderTo: "UsrDashboardContainer" });
			}
		},
		diff: []
	};
});

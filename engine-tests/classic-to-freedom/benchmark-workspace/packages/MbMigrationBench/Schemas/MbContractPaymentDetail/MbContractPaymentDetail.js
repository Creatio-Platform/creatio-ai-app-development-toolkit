define("MbContractPaymentDetail", [], function() {
	return {
		entitySchemaName: "MbContractPayment",
		methods: {
			getAddRecordButtonVisible: function() {
				return false;
			},
			getEditRecordMenuItem: Terrasoft.emptyFn,
			getCopyRecordMenuItem: Terrasoft.emptyFn,
			getDeleteRecordMenuItem: Terrasoft.emptyFn,
			editRecord: Terrasoft.emptyFn,
			initDetailOptions: function() {
				this.callParent(arguments);
				this.set("IsSortable", false);
			},
			getGridSortDirection: function() {
				return Terrasoft.OrderDirection.DESC;
			},
			addGridDataColumns: function(esq) {
				this.callParent(arguments);
				const column = esq.columns.contains("MbDate") ? esq.columns.get("MbDate") : esq.addColumn("MbDate");
				column.orderPosition = 0;
				column.orderDirection = Terrasoft.OrderDirection.DESC;
			}
		},
		diff: /**SCHEMA_DIFF*/[]/**SCHEMA_DIFF*/
	};
});

define("MbDocumentLogDetail", [], function() {
	return {
		entitySchemaName: "MbDocumentLog",
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
				var column = esq.columns.contains("CreatedOn") ? esq.columns.get("CreatedOn") : esq.addColumn("CreatedOn");
				column.orderPosition = 0;
				column.orderDirection = Terrasoft.OrderDirection.DESC;
			}
		},
		diff: /**SCHEMA_DIFF*/[]/**SCHEMA_DIFF*/
	};
});

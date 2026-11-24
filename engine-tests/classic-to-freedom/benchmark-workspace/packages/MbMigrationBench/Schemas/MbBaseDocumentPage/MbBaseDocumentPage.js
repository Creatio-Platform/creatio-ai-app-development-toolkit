define("MbBaseDocumentPage", [], function() {
	return {
		entitySchemaName: "",
		details: /**SCHEMA_DETAILS*/{
			"MbDocumentLogDetail": {
				"schemaName": "MbDocumentLogDetail",
				"entitySchemaName": "MbDocumentLog",
				"filter": {
					"detailColumn": "MbRecordId",
					"masterColumn": "Id"
				}
			}
		}/**SCHEMA_DETAILS*/,
		businessRules: /**SCHEMA_BUSINESS_RULES*/{}/**SCHEMA_BUSINESS_RULES*/,
		methods: {
			/**
			 * Writes one line to the document log of the current record.
			 */
			mbWriteLog: function(message) {
				var insert = Ext.create("Terrasoft.InsertQuery", {rootSchemaName: "MbDocumentLog"});
				insert.setParameterValue("MbName", message, Terrasoft.DataValueType.TEXT);
				insert.setParameterValue("MbRecordId", this.get("Id"), Terrasoft.DataValueType.GUID);
				insert.setParameterValue("MbEntityName", this.entitySchemaName, Terrasoft.DataValueType.TEXT);
				insert.execute(function() {
					this.updateDetail({detail: "MbDocumentLogDetail"});
				}, this);
			}
		},
		diff: /**SCHEMA_DIFF*/[
			{
				"operation": "insert",
				"name": "MbHistoryTab",
				"values": {
					"caption": {"bindTo": "Resources.Strings.MbHistoryTabCaption"},
					"items": []
				},
				"parentName": "Tabs",
				"propertyName": "tabs",
				"index": 9
			},
			{
				"operation": "insert",
				"name": "MbDocumentLogDetail",
				"values": {
					"itemType": Terrasoft.ViewItemType.DETAIL,
					"markerValue": "added-detail"
				},
				"parentName": "MbHistoryTab",
				"propertyName": "items",
				"index": 0
			}
		]/**SCHEMA_DIFF*/
	};
});

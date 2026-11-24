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
		// The detail sits inside the tab insert on purpose: a child page applies this diff twice
		// (the base page is in both its own and its parent's hierarchy stack), and a separate detail
		// insert would land in the copy of the tab that the duplicate removal throws away.
		diff: /**SCHEMA_DIFF*/[
			{
				"operation": "insert",
				"name": "MbHistoryTab",
				"values": {
					"caption": {"bindTo": "Resources.Strings.MbHistoryTabCaption"},
					"items": [
						{
							"name": "MbDocumentLogDetail",
							"itemType": Terrasoft.ViewItemType.DETAIL,
							"markerValue": "added-detail"
						}
					]
				},
				"parentName": "Tabs",
				"propertyName": "tabs",
				"index": 9
			}
		]/**SCHEMA_DIFF*/
	};
});

define("ContractPageV2", [],
		function() {
			return {
				entitySchemaName: "Contract",
				details: /**SCHEMA_DETAILS*/{
					Document: {
						schemaName: "DocumentDetailV2",
						entitySchemaName: "Document",
						filter: {
							masterColumn: "Id",
							detailColumn: "Contract"
						},
						defaultValues: {
							Account: { masterColumn: "Account" },
							Contact: { masterColumn: "Contact" }
						}
					}
				}/**SCHEMA_DETAILS*/,
				diff: /**SCHEMA_DIFF*/[
					{
						"operation": "insert",
						"parentName": "HistoryTab",
						"propertyName": "items",
						"name": "Document",
						"values": { "itemType": Terrasoft.ViewItemType.DETAIL },
						"index": 2
					}
				]/**SCHEMA_DIFF*/
			};
		});

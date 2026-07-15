define("ContractPageV2", [],
		function() {
			return {
				entitySchemaName: "Contract",
				details: /**SCHEMA_DETAILS*/{
					Invoice: {
						schemaName: "InvoiceDetailV2",
						filter: {
							masterColumn: "Id",
							detailColumn: "Contract"
						},
						defaultValues: {
							Account: {
								masterColumn: "Account"
							},
							Contact: {
								masterColumn: "Contact"
							},
							CustomerBillingInfo: {
								masterColumn: "CustomerBillingInfo"
							},
							SupplierBillingInfo: {
								masterColumn: "SupplierBillingInfo"
							}
						}
					}
				}/**SCHEMA_DETAILS*/,
				diff: /**SCHEMA_DIFF*/[
					{
						"operation": "insert",
						"parentName": "HistoryTab",
						"propertyName": "items",
						"name": "Invoice",
						"values": {
							"itemType": Terrasoft.ViewItemType.DETAIL
						},
						"index": 2
					}
				]/**SCHEMA_DIFF*/
			};
		});

define("MbContractItemPage", [], function() {
	return {
		entitySchemaName: "MbContractItem",
		attributes: {
			"MbTotal": {
				"dependencies": [
					{
						"columns": ["MbQuantity", "MbPrice"],
						"methodName": "mbCalculateTotal"
					}
				]
			}
		},
		details: /**SCHEMA_DETAILS*/{}/**SCHEMA_DETAILS*/,
		businessRules: /**SCHEMA_BUSINESS_RULES*/{}/**SCHEMA_BUSINESS_RULES*/,
		methods: {
			onEntityInitialized: function() {
				this.callParent(arguments);
				if (this.isAddMode()) {
					this.set("MbIsActive", true);
				}
			},

			mbCalculateTotal: function() {
				this.set("MbTotal", (this.get("MbQuantity") || 0) * (this.get("MbPrice") || 0));
			}
		},
		diff: /**SCHEMA_DIFF*/[
			{
				"operation": "insert",
				"name": "MbName",
				"values": {
					"layout": {"colSpan": 24, "rowSpan": 1, "column": 0, "row": 0, "layoutName": "ProfileContainer"},
					"bindTo": "MbName"
				},
				"parentName": "ProfileContainer",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbIsActive",
				"values": {
					"layout": {"colSpan": 24, "rowSpan": 1, "column": 0, "row": 1, "layoutName": "ProfileContainer"},
					"bindTo": "MbIsActive"
				},
				"parentName": "ProfileContainer",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbQuantity",
				"values": {
					"layout": {"colSpan": 12, "rowSpan": 1, "column": 0, "row": 0, "layoutName": "Header"},
					"bindTo": "MbQuantity"
				},
				"parentName": "Header",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbPrice",
				"values": {
					"layout": {"colSpan": 12, "rowSpan": 1, "column": 12, "row": 0, "layoutName": "Header"},
					"bindTo": "MbPrice"
				},
				"parentName": "Header",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbTotal",
				"values": {
					"layout": {"colSpan": 12, "rowSpan": 1, "column": 0, "row": 1, "layoutName": "Header"},
					"bindTo": "MbTotal",
					"enabled": false
				},
				"parentName": "Header",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbDeliveryDate",
				"values": {
					"layout": {"colSpan": 12, "rowSpan": 1, "column": 12, "row": 1, "layoutName": "Header"},
					"bindTo": "MbDeliveryDate"
				},
				"parentName": "Header",
				"propertyName": "items"
			}
		]/**SCHEMA_DIFF*/
	};
});

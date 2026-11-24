define("MbDeliveryNotePage", ["MbDocumentTotalsMixin"], function() {
	return {
		entitySchemaName: "MbDeliveryNote",
		mixins: {
			MbDocumentTotalsMixin: "Terrasoft.MbDocumentTotalsMixin"
		},
		details: /**SCHEMA_DETAILS*/{}/**SCHEMA_DETAILS*/,
		businessRules: /**SCHEMA_BUSINESS_RULES*/{}/**SCHEMA_BUSINESS_RULES*/,
		methods: {
			onEntityInitialized: function() {
				this.callParent(arguments);
				if (this.isAddMode() && !this.get("MbDate")) {
					this.set("MbDate", new Date());
				}
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
				"name": "MbNumber",
				"values": {
					"layout": {"colSpan": 24, "rowSpan": 1, "column": 0, "row": 1, "layoutName": "ProfileContainer"},
					"bindTo": "MbNumber"
				},
				"parentName": "ProfileContainer",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbIsPosted",
				"values": {
					"layout": {"colSpan": 24, "rowSpan": 1, "column": 0, "row": 2, "layoutName": "ProfileContainer"},
					"bindTo": "MbIsPosted",
					"enabled": false
				},
				"parentName": "ProfileContainer",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbContract",
				"values": {
					"layout": {"colSpan": 12, "rowSpan": 1, "column": 0, "row": 0, "layoutName": "Header"},
					"bindTo": "MbContract"
				},
				"parentName": "Header",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbDate",
				"values": {
					"layout": {"colSpan": 12, "rowSpan": 1, "column": 12, "row": 0, "layoutName": "Header"},
					"bindTo": "MbDate"
				},
				"parentName": "Header",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbAmount",
				"values": {
					"layout": {"colSpan": 12, "rowSpan": 1, "column": 0, "row": 1, "layoutName": "Header"},
					"bindTo": "MbAmount"
				},
				"parentName": "Header",
				"propertyName": "items"
			},
			{
				"operation": "insert",
				"name": "MbPostButton",
				"values": {
					"itemType": Terrasoft.ViewItemType.BUTTON,
					"caption": {"bindTo": "Resources.Strings.MbPostButtonCaption"},
					"click": {"bindTo": "mbPostDocument"},
					"enabled": {"bindTo": "mbIsPostButtonEnabled"},
					"style": Terrasoft.controls.ButtonEnums.style.GREEN
				},
				"parentName": "LeftContainer",
				"propertyName": "items",
				"index": 5
			}
		]/**SCHEMA_DIFF*/
	};
});

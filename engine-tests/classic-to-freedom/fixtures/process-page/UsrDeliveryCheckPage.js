define("UsrDeliveryCheckPage", [], function() {
	return {
		entitySchemaName: "",
		attributes: {},
		details: {},
		businessRules: {},
		methods: {},
		diff: [
			{
				"operation": "merge",
				"name": "Button-be6148b819154a0791eaee8f1635d859",
				"values": {
					"caption": { "bindTo": "Resources.Strings.SaveDataButtonCaption" },
					"click": { "bindTo": "onSaveButtonClick" },
					"enabled": true
				}
			},
			{
				"operation": "insert",
				"name": "Button-340d4888d1c244b4b1096eb51e8072f2",
				"values": {
					"itemType": 5,
					"style": "default",
					"tag": "Cancel",
					"caption": { "bindTo": "Resources.Strings.CancelButtonCaption" },
					"click": { "bindTo": "onCancelProcessElementClick" },
					"enabled": true
				},
				"parentName": "ProcessActionButtons",
				"propertyName": "items",
				"index": 1
			},
			{
				"operation": "insert",
				"name": "LOOKUPa1",
				"values": {
					"layout": { "colSpan": 12, "rowSpan": 1, "column": 0, "row": 0, "layoutName": "Header" },
					"bindTo": "UsrOrderParam",
					"enabled": true,
					"contentType": 5
				},
				"parentName": "Header",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "remove",
				"name": "Button-3a8ac667899d4aa68021a07eb1c7c49c"
			}
		]
	};
});

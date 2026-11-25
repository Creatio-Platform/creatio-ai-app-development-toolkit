define("BasePageProcessTemplate", ["BasePageProcessTemplateResources"], function() {
	return {
		entitySchemaName: "",
		mixins: { BaseProcessViewModel: "Terrasoft.CustomProcessPageV2Utilities" },
		details: {},
		businessRules: {},
		methods: {
			onSaveButtonClick: function() { return; },
			onProcessActionButtonClick: function() { return; },
			onCancelProcessElementClick: function() { return; },
			getProcessActionButtonCaption: function() { return; }
		},
		diff: [
			{
				"operation": "insert",
				"parentName": "ActionButtonsContainer",
				"propertyName": "items",
				"name": "ProcessActionButtons",
				"values": { "itemType": 7, "items": [] }
			},
			{
				"operation": "insert",
				"parentName": "ProcessActionButtons",
				"propertyName": "items",
				"index": 0,
				"name": "Button-be6148b819154a0791eaee8f1635d859",
				"alias": { "name": "SaveButton" },
				"values": {
					"itemType": 5,
					"style": "green",
					"tag": "SaveData",
					"caption": { "bindTo": "getProcessActionButtonCaption" },
					"click": { "bindTo": "onProcessActionButtonClick" }
				}
			},
			{
				"operation": "insert",
				"parentName": "ProcessActionButtons",
				"propertyName": "items",
				"index": 1,
				"name": "Button-3a8ac667899d4aa68021a07eb1c7c49c",
				"alias": { "name": "CloseButton" },
				"values": {
					"itemType": 5,
					"style": "blue",
					"tag": "ClosePage",
					"caption": { "bindTo": "getProcessActionButtonCaption" },
					"click": { "bindTo": "onProcessActionButtonClick" }
				}
			},
			{
				"operation": "insert",
				"parentName": "Tabs",
				"propertyName": "tabs",
				"name": "NewTab1",
				"values": { "caption": { "bindTo": "Resources.Strings.NewTab1TabCaption" }, "items": [] }
			}
		]
	};
});

define("BasePageV2", [], function() {
	return {
		diff: [
			{ "operation": "insert", "name": "ActionButtonsContainer", "values": { "itemType": 7, "items": [] } },
			{ "operation": "insert", "name": "Header", "parentName": "ProfileContainer", "propertyName": "items", "values": { "itemType": 0, "items": [] } }
		],
		methods: {
			onCloseClick: function() { return; },
			save: function() { return; }
		}
	};
});

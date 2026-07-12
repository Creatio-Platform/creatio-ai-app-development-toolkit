define("UsrSupportUnitPoC_FormPage", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, function/**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/ {
	return {
		viewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[
			{
				"operation": "insert",
				"name": "ParentSupportUnit",
				"values": {
					"type": "crt.ComboBox",
					"control": "$ParentSupportUnit",
					"label": "$Resources.Strings.ParentSupportUnit",
					"labelPosition": "above",
					"listActions": [],
					"controlActions": [],
					"visible": true,
					"layoutConfig": { "column": 1, "row": 1, "colSpan": 24, "rowSpan": 1 }
				},
				"parentName": "GeneralInfoTabContainer",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "Contact",
				"values": {
					"type": "crt.ComboBox",
					"control": "$Contact",
					"label": "$Resources.Strings.Contact",
					"labelPosition": "above",
					"listActions": [],
					"controlActions": [],
					"visible": true,
					"layoutConfig": { "column": 1, "row": 2, "colSpan": 24, "rowSpan": 1 }
				},
				"parentName": "GeneralInfoTabContainer",
				"propertyName": "items",
				"index": 1
			},
			{
				"operation": "insert",
				"name": "Calendar",
				"values": {
					"type": "crt.ComboBox",
					"control": "$Calendar",
					"label": "$Resources.Strings.Calendar",
					"labelPosition": "above",
					"listActions": [],
					"controlActions": [],
					"visible": true,
					"layoutConfig": { "column": 1, "row": 3, "colSpan": 24, "rowSpan": 1 }
				},
				"parentName": "GeneralInfoTabContainer",
				"propertyName": "items",
				"index": 2
			},
			{
				"operation": "insert",
				"name": "SupportWorkingDayType",
				"values": {
					"type": "crt.ComboBox",
					"control": "$SupportWorkingDayType",
					"label": "$Resources.Strings.SupportWorkingDayType",
					"labelPosition": "above",
					"listActions": [],
					"controlActions": [],
					"visible": true,
					"layoutConfig": { "column": 1, "row": 4, "colSpan": 24, "rowSpan": 1 }
				},
				"parentName": "GeneralInfoTabContainer",
				"propertyName": "items",
				"index": 3
			},
			{
				"operation": "insert",
				"name": "Active",
				"values": {
					"type": "crt.Checkbox",
					"control": "$Active",
					"label": "$Resources.Strings.Active",
					"labelPosition": "beside",
					"visible": true,
					"layoutConfig": { "column": 1, "row": 5, "colSpan": 24, "rowSpan": 1 }
				},
				"parentName": "GeneralInfoTabContainer",
				"propertyName": "items",
				"index": 4
			}
		]/**SCHEMA_VIEW_CONFIG_DIFF*/,
		viewModelConfigDiff: /**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/[
			{
				"operation": "merge",
				"path": ["attributes"],
				"values": {
					"ParentSupportUnit": { "modelConfig": { "path": "PDS.ParentSupportUnit" } },
					"Contact": { "modelConfig": { "path": "PDS.Contact" } },
					"Calendar": { "modelConfig": { "path": "PDS.Calendar" } },
					"SupportWorkingDayType": { "modelConfig": { "path": "PDS.SupportWorkingDayType" } },
					"Active": { "modelConfig": { "path": "PDS.Active" } }
				}
			}
		]/**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/,
		modelConfigDiff: /**SCHEMA_MODEL_CONFIG_DIFF*/[
			{
				"operation": "merge",
				"path": ["dataSources", "PDS", "config", "attributes"],
				"values": {
					"ParentSupportUnit": { "path": "ParentSupportUnit" },
					"Contact": { "path": "Contact" },
					"Calendar": { "path": "Calendar" },
					"SupportWorkingDayType": { "path": "SupportWorkingDayType" },
					"Active": { "path": "Active" }
				}
			}
		]/**SCHEMA_MODEL_CONFIG_DIFF*/,
		handlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
		converters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/,
		validators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/
	};
});

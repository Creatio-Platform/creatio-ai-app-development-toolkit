define("UsrSupportUnitPoC_FormPage", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, function/**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/ {
	return {
		viewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[
			{
				"operation": "insert",
				"name": "Name",
				"values": {
					"layoutConfig": { "column": 1, "row": 1, "colSpan": 1, "rowSpan": 1 },
					"type": "crt.Input",
					"label": "$Resources.Strings.Name",
					"control": "$Name",
					"labelPosition": "auto"
				},
				"parentName": "SideAreaProfileContainer",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "merge",
				"name": "AttachmentList",
				"values": {
					"type": "crt.FileList",
					"masterRecordColumnValue": "$Id",
					"recordColumnName": "RecordId",
					"layoutConfig": { "colSpan": 2, "column": 1, "row": 1, "rowSpan": 6 },
					"items": "$AttachmentList",
					"primaryColumnName": "AttachmentListDS_Id",
					"columns": [
						{
							"id": "03dafc93-554b-4a03-b9bc-37a1632b1e30",
							"code": "AttachmentListDS_Name",
							"caption": "#ResourceString(AttachmentListDS_Name)#",
							"dataValueType": 28,
							"width": 200
						}
					],
					"viewType": "gallery",
					"tileSize": "small"
				},
				"parentName": "AttachmentsTabContainer",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "merge",
				"name": "Feed",
				"values": {
					"type": "crt.Feed",
					"feedType": "Record",
					"primaryColumnValue": "$Id",
					"cardState": "$CardState",
					"dataSourceName": "PDS",
					"entitySchemaName": "SupportUnit"
				},
				"parentName": "FeedTabContainer",
				"propertyName": "items",
				"index": 0
			},
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
		viewModelConfig: /**SCHEMA_VIEW_MODEL_CONFIG*/{
			"attributes": {
				"Name": { "modelConfig": { "path": "PDS.Name" } },
				"Id": { "modelConfig": { "path": "PDS.Id" } },
				"ParentSupportUnit": { "modelConfig": { "path": "PDS.ParentSupportUnit" } },
				"Contact": { "modelConfig": { "path": "PDS.Contact" } },
				"Calendar": { "modelConfig": { "path": "PDS.Calendar" } },
				"SupportWorkingDayType": { "modelConfig": { "path": "PDS.SupportWorkingDayType" } },
				"Active": { "modelConfig": { "path": "PDS.Active" } }
			}
		}/**SCHEMA_VIEW_MODEL_CONFIG*/,
		modelConfig: /**SCHEMA_MODEL_CONFIG*/{
			"dataSources": {
				"PDS": {
					"type": "crt.EntityDataSource",
					"config": { "entitySchemaName": "SupportUnit" },
					"scope": "page"
				},
				"AttachmentListDS": {
					"type": "crt.EntityDataSource",
					"scope": "viewElement",
					"config": {
						"entitySchemaName": "SysFile",
						"attributes": { "Name": { "path": "Name" } }
					}
				}
			},
			"primaryDataSourceName": "PDS"
		}/**SCHEMA_MODEL_CONFIG*/,
		handlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
		converters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/,
		validators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/
	};
});

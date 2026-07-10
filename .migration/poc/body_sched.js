define("UsrSchedulePoC_FormPage", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, function/**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/ {
	return {
		viewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[
			{
				"operation": "insert",
				"name": "Notes",
				"values": {
					"layoutConfig": { "column": 1, "row": 1, "colSpan": 1, "rowSpan": 1 },
					"type": "crt.Input",
					"label": "$Resources.Strings.Notes",
					"control": "$Notes",
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
							"id": "befe2cb9-20ee-4a06-bd5e-353734912a6d",
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
					"entitySchemaName": "SupportSchedule"
				},
				"parentName": "FeedTabContainer",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "Date",
				"values": {
					"type": "crt.DateTimePicker",
					"control": "$Date",
					"pickerType": "date",
					"label": "$Resources.Strings.Date",
					"labelPosition": "above",
					"visible": true,
					"layoutConfig": { "column": 1, "row": 1, "colSpan": 24, "rowSpan": 1 }
				},
				"parentName": "GeneralInfoTabContainer",
				"propertyName": "items",
				"index": 0
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
					"layoutConfig": { "column": 1, "row": 2, "colSpan": 24, "rowSpan": 1 }
				},
				"parentName": "GeneralInfoTabContainer",
				"propertyName": "items",
				"index": 1
			},
			{
				"operation": "insert",
				"name": "IsAvailable",
				"values": {
					"type": "crt.Checkbox",
					"control": "$IsAvailable",
					"label": "$Resources.Strings.IsAvailable",
					"labelPosition": "beside",
					"visible": true,
					"layoutConfig": { "column": 1, "row": 3, "colSpan": 24, "rowSpan": 1 }
				},
				"parentName": "GeneralInfoTabContainer",
				"propertyName": "items",
				"index": 2
			}
		]/**SCHEMA_VIEW_CONFIG_DIFF*/,
		viewModelConfig: /**SCHEMA_VIEW_MODEL_CONFIG*/{
			"attributes": {
				"Notes": { "modelConfig": { "path": "PDS.Notes" } },
				"Id": { "modelConfig": { "path": "PDS.Id" } },
				"Date": { "modelConfig": { "path": "PDS.Date" } },
				"SupportWorkingDayType": { "modelConfig": { "path": "PDS.SupportWorkingDayType" } },
				"IsAvailable": { "modelConfig": { "path": "PDS.IsAvailable" } }
			}
		}/**SCHEMA_VIEW_MODEL_CONFIG*/,
		modelConfig: /**SCHEMA_MODEL_CONFIG*/{
			"dataSources": {
				"PDS": {
					"type": "crt.EntityDataSource",
					"config": { "entitySchemaName": "SupportSchedule" },
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

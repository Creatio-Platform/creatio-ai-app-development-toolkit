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
			},
			{
				"operation": "insert",
				"name": "SchedulePanel",
				"values": {
					"type": "crt.ExpansionPanel",
					"title": "#ResourceString(SchedulePanel_title)#",
					"expanded": true,
					"togglePosition": "before",
					"titleWidth": 20,
					"fullWidthHeader": true,
					"fitContent": true,
					"items": [],
					"tools": [],
					"layoutConfig": { "column": 1, "row": 6, "colSpan": 24, "rowSpan": 8 }
				},
				"parentName": "GeneralInfoTabContainer",
				"propertyName": "items",
				"index": 5
			},
			{
				"operation": "insert",
				"name": "SchedulePanel_grid_wrap",
				"values": {
					"type": "crt.GridContainer",
					"columns": ["minmax(32px, 1fr)", "minmax(32px, 1fr)"],
					"rows": "minmax(max-content, 32px)",
					"gap": { "columnGap": "large", "rowGap": 0 },
					"styles": { "overflow-x": "hidden" },
					"items": []
				},
				"parentName": "SchedulePanel",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "GridDetail_records",
				"values": {
					"type": "crt.DataGrid",
					"items": "$GridDetail_records",
					"activeRow": "$GridDetail_records_ActiveRow",
					"primaryColumnName": "GridDetail_recordsDS_Id",
					"columns": [
						{
							"id": "a1c1e001-0001-0001-0001-000000000001",
							"code": "GridDetail_recordsDS_Date",
							"caption": "#ResourceString(GridDetail_recordsDS_Date)#",
							"dataValueType": 8,
							"width": 160
						},
						{
							"id": "a1c1e001-0001-0001-0001-000000000002",
							"code": "GridDetail_recordsDS_SupportWorkingDayType",
							"caption": "#ResourceString(GridDetail_recordsDS_SupportWorkingDayType)#",
							"dataValueType": 10,
							"referenceSchemaName": "SupportWorkingDayType",
							"width": 220
						},
						{
							"id": "a1c1e001-0001-0001-0001-000000000003",
							"code": "GridDetail_recordsDS_IsAvailable",
							"caption": "#ResourceString(GridDetail_recordsDS_IsAvailable)#",
							"dataValueType": 12,
							"width": 120
						}
					],
					"features": { "rows": { "selection": { "enable": true, "multiple": true } } },
					"layoutConfig": { "column": 1, "row": 1, "colSpan": 2, "rowSpan": 6 }
				},
				"parentName": "SchedulePanel_grid_wrap",
				"propertyName": "items",
				"index": 0
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
				"Active": { "modelConfig": { "path": "PDS.Active" } },
				"GridDetail_records": {
					"isCollection": true,
					"modelConfig": { "path": "GridDetail_recordsDS" },
					"viewModelConfig": {
						"attributes": {
							"GridDetail_recordsDS_Id": { "modelConfig": { "path": "GridDetail_recordsDS.Id" } },
							"GridDetail_recordsDS_Date": { "modelConfig": { "path": "GridDetail_recordsDS.Date" } },
							"GridDetail_recordsDS_SupportWorkingDayType": { "modelConfig": { "path": "GridDetail_recordsDS.SupportWorkingDayType" } },
							"GridDetail_recordsDS_IsAvailable": { "modelConfig": { "path": "GridDetail_recordsDS.IsAvailable" } }
						}
					}
				}
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
				},
				"GridDetail_recordsDS": {
					"type": "crt.EntityDataSource",
					"scope": "viewElement",
					"config": {
						"entitySchemaName": "SupportSchedule",
						"attributes": {
							"Date": { "path": "Date" },
							"SupportWorkingDayType": { "path": "SupportWorkingDayType" },
							"IsAvailable": { "path": "IsAvailable" }
						}
					}
				}
			},
			"primaryDataSourceName": "PDS",
			"dependencies": {
				"GridDetail_recordsDS": [
					{ "attributePath": "SupportUnit", "relationPath": "PDS.Id" }
				]
			}
		}/**SCHEMA_MODEL_CONFIG*/,
		handlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
		converters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/,
		validators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/
	};
});

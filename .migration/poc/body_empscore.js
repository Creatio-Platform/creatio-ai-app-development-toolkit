define("UsrEmpScorePoC_FormPage", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, function/**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/ {
	return {
		viewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[
			{ "operation": "insert", "name": "ScoreNumber",
				"values": { "type": "crt.NumberInput", "control": "$ScoreNumber", "label": "$Resources.Strings.ScoreNumber", "labelPosition": "above", "visible": true, "layoutConfig": { "column": 1, "row": 1, "colSpan": 1, "rowSpan": 1 } },
				"parentName": "SideAreaProfileContainer", "propertyName": "items", "index": 0 },
			{ "operation": "insert", "name": "Employee",
				"values": { "type": "crt.ComboBox", "control": "$Employee", "label": "$Resources.Strings.Employee", "labelPosition": "above", "listActions": [], "controlActions": [], "visible": true, "layoutConfig": { "column": 1, "row": 2, "colSpan": 1, "rowSpan": 1 } },
				"parentName": "SideAreaProfileContainer", "propertyName": "items", "index": 1 },
			{ "operation": "insert", "name": "ScoreDate",
				"values": { "type": "crt.DateTimePicker", "control": "$ScoreDate", "pickerType": "datetime", "label": "$Resources.Strings.ScoreDate", "labelPosition": "above", "visible": true, "layoutConfig": { "column": 1, "row": 3, "colSpan": 1, "rowSpan": 1 } },
				"parentName": "SideAreaProfileContainer", "propertyName": "items", "index": 2 },
			{ "operation": "insert", "name": "AccrualRule",
				"values": { "type": "crt.ComboBox", "control": "$AccrualRule", "label": "$Resources.Strings.AccrualRule", "labelPosition": "above", "listActions": [], "controlActions": [], "visible": true, "layoutConfig": { "column": 1, "row": 4, "colSpan": 1, "rowSpan": 1 } },
				"parentName": "SideAreaProfileContainer", "propertyName": "items", "index": 3 },
			{ "operation": "insert", "name": "Owner",
				"values": { "type": "crt.ComboBox", "control": "$Owner", "label": "$Resources.Strings.Owner", "labelPosition": "above", "listActions": [], "controlActions": [], "visible": true, "layoutConfig": { "column": 1, "row": 5, "colSpan": 1, "rowSpan": 1 } },
				"parentName": "SideAreaProfileContainer", "propertyName": "items", "index": 4 },
			{ "operation": "insert", "name": "ScoreType",
				"values": { "type": "crt.ComboBox", "control": "$ScoreType", "label": "$Resources.Strings.ScoreType", "labelPosition": "above", "listActions": [], "controlActions": [], "visible": true, "layoutConfig": { "column": 1, "row": 6, "colSpan": 1, "rowSpan": 1 } },
				"parentName": "SideAreaProfileContainer", "propertyName": "items", "index": 5 },
			{ "operation": "insert", "name": "MarketplaceApplication",
				"values": { "type": "crt.ComboBox", "control": "$MarketplaceApplication", "label": "$Resources.Strings.MarketplaceApplication", "labelPosition": "above", "listActions": [], "controlActions": [], "visible": true, "layoutConfig": { "column": 1, "row": 7, "colSpan": 1, "rowSpan": 1 } },
				"parentName": "SideAreaProfileContainer", "propertyName": "items", "index": 6 },
			{ "operation": "insert", "name": "ScoreBalance",
				"values": { "type": "crt.NumberInput", "control": "$ScoreBalance", "label": "$Resources.Strings.ScoreBalance", "labelPosition": "above", "visible": true, "layoutConfig": { "column": 1, "row": 8, "colSpan": 1, "rowSpan": 1 } },
				"parentName": "SideAreaProfileContainer", "propertyName": "items", "index": 7 },
			{ "operation": "merge", "name": "AttachmentList",
				"values": { "type": "crt.FileList", "masterRecordColumnValue": "$Id", "recordColumnName": "RecordId", "layoutConfig": { "colSpan": 2, "column": 1, "row": 1, "rowSpan": 6 }, "items": "$AttachmentList", "primaryColumnName": "AttachmentListDS_Id", "columns": [ { "id": "1a2b3c4d-0000-0000-0000-000000000001", "code": "AttachmentListDS_Name", "caption": "#ResourceString(AttachmentListDS_Name)#", "dataValueType": 28, "width": 200 } ], "viewType": "gallery", "tileSize": "small" },
				"parentName": "AttachmentsTabContainer", "propertyName": "items", "index": 0 },
			{ "operation": "merge", "name": "Feed",
				"values": { "type": "crt.Feed", "feedType": "Record", "primaryColumnValue": "$Id", "cardState": "$CardState", "dataSourceName": "PDS", "entitySchemaName": "EmployeeScore" },
				"parentName": "FeedTabContainer", "propertyName": "items", "index": 0 },
			{ "operation": "insert", "name": "Comment",
				"values": { "type": "crt.Input", "control": "$Comment", "label": "$Resources.Strings.Comment", "labelPosition": "above", "multiline": true, "visible": true, "layoutConfig": { "column": 1, "row": 1, "colSpan": 24, "rowSpan": 4 } },
				"parentName": "GeneralInfoTabContainer", "propertyName": "items", "index": 0 }
		]/**SCHEMA_VIEW_CONFIG_DIFF*/,
		viewModelConfig: /**SCHEMA_VIEW_MODEL_CONFIG*/{
			"attributes": {
				"Id": { "modelConfig": { "path": "PDS.Id" } },
				"ScoreNumber": { "modelConfig": { "path": "PDS.ScoreNumber" } },
				"Employee": { "modelConfig": { "path": "PDS.Employee" } },
				"ScoreDate": { "modelConfig": { "path": "PDS.ScoreDate" } },
				"AccrualRule": { "modelConfig": { "path": "PDS.AccrualRule" } },
				"Owner": { "modelConfig": { "path": "PDS.Owner" } },
				"ScoreType": { "modelConfig": { "path": "PDS.ScoreType" } },
				"MarketplaceApplication": { "modelConfig": { "path": "PDS.MarketplaceApplication" } },
				"ScoreBalance": { "modelConfig": { "path": "PDS.ScoreBalance" } },
				"Comment": { "modelConfig": { "path": "PDS.Comment" } }
			}
		}/**SCHEMA_VIEW_MODEL_CONFIG*/,
		modelConfig: /**SCHEMA_MODEL_CONFIG*/{
			"dataSources": {
				"PDS": { "type": "crt.EntityDataSource", "config": { "entitySchemaName": "EmployeeScore" }, "scope": "page" },
				"AttachmentListDS": { "type": "crt.EntityDataSource", "scope": "viewElement", "config": { "entitySchemaName": "SysFile", "attributes": { "Name": { "path": "Name" } } } }
			},
			"primaryDataSourceName": "PDS"
		}/**SCHEMA_MODEL_CONFIG*/,
		handlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
		converters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/,
		validators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/
	};
});

define("UsrTodoTask_ListPage", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, function/**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/ {
	return {
		viewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[
			{
				"operation": "merge",
				"name": "AddButton",
				"values": {
					"clicked": {
						"request": "crt.CreateRecordRequest",
						"params": {
							"entityName": "UsrTodoTask"
						}
					}
				}
			},
			{
				"operation": "insert",
				"name": "DataTable",
				"values": {
					"type": "crt.DataGrid",
					"features": {
						"rows": {
							"selection": {
								"enable": true,
								"multiple": true
							}
						}
					},
					"items": "$DataTable_Items",
					"primaryColumnName": "PDS_Id",
					"columns": [
						{
							"id": "cc0a4dc1-0001-4e5a-b3f2-a1b2c3d40001",
							"code": "PDS_UsrTitle",
							"path": "UsrTitle",
							"caption": "#ResourceString(PDS_UsrTitle)#",
							"dataValueType": 1
						},
						{
							"id": "cc0a4dc1-0001-4e5a-b3f2-a1b2c3d40002",
							"code": "PDS_UsrStatus",
							"path": "UsrStatus",
							"caption": "#ResourceString(PDS_UsrStatus)#",
							"dataValueType": 10
						},
						{
							"id": "cc0a4dc1-0001-4e5a-b3f2-a1b2c3d40003",
							"code": "PDS_UsrPriority",
							"path": "UsrPriority",
							"caption": "#ResourceString(PDS_UsrPriority)#",
							"dataValueType": 10
						},
						{
							"id": "cc0a4dc1-0001-4e5a-b3f2-a1b2c3d40004",
							"code": "PDS_UsrDueDate",
							"path": "UsrDueDate",
							"caption": "#ResourceString(PDS_UsrDueDate)#",
							"dataValueType": 8
						},
						{
							"id": "cc0a4dc1-0001-4e5a-b3f2-a1b2c3d40005",
							"code": "PDS_CreatedOn",
							"path": "CreatedOn",
							"caption": "#ResourceString(PDS_CreatedOn)#",
							"dataValueType": 8
						}
					],
					"visible": true
				},
				"parentName": "DataTableContainer",
				"propertyName": "items",
				"index": 0
			}
		]/**SCHEMA_VIEW_CONFIG_DIFF*/,
		viewModelConfigDiff: /**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/[
			{
				"operation": "merge",
				"path": [
					"attributes"
				],
				"values": {
					"PDS_UsrTitle": {
						"modelConfig": {
							"path": "PDS.UsrTitle"
						}
					},
					"PDS_UsrStatus": {
						"modelConfig": {
							"path": "PDS.UsrStatus"
						}
					},
					"PDS_UsrPriority": {
						"modelConfig": {
							"path": "PDS.UsrPriority"
						}
					},
					"PDS_UsrDueDate": {
						"modelConfig": {
							"path": "PDS.UsrDueDate"
						}
					},
					"PDS_CreatedOn": {
						"modelConfig": {
							"path": "PDS.CreatedOn"
						}
					}
				}
			}
		]/**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/,
		modelConfigDiff: /**SCHEMA_MODEL_CONFIG_DIFF*/[
			{
				"operation": "merge",
				"path": [
					"dataSources"
				],
				"values": {
					"PDS": {
						"type": "crt.EntityDataSource",
						"config": {
							"entitySchemaName": "UsrTodoTask"
						},
						"scope": "viewElement"
					}
				}
			}
		]/**SCHEMA_MODEL_CONFIG_DIFF*/,
		handlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
		converters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/,
		validators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/
	};
});

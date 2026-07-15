define("ContractPageV2", ["terrasoft", "GeneralDetails", "BusinessRuleModule", "ConfigurationConstants",
		"RightUtilities", "VisaHelper", "css!VisaHelper"],
	function(Terrasoft, GeneralDetails, BusinessRuleModule, ConfigurationConstants, RightUtilities, VisaHelper) {
		return {
			entitySchemaName: "Contract",
			details: /**SCHEMA_DETAILS*/{
				"Activities": {
					"schemaName": "ActivityDetailV2",
					"filter": {
						"masterColumn": "Id",
						"detailColumn": "Contract"
					},
					"defaultValues": {
						Contract: {
							masterColumn: "Id"
						},
						Account: {
							masterColumn: "Account"
						},
						Contact: {
							masterColumn: "Contact"
						}
					}
				},
				"Files": {
					"schemaName": "FileDetailV2",
					"entitySchemaName": "ContractFile",
					"filter": {
						"masterColumn": "Id",
						"detailColumn": "Contract"
					}
				},
				"SubordinateContracts": {
					"schemaName": "ContractDetailV2",
					"entitySchemaName": "Contract",
					"filter": {
						"masterColumn": "Id",
						"detailColumn": "Parent"
					},
					defaultValues: {
						Account: {
							masterColumn: "Account"
						},
						Contact: {
							masterColumn: "Contact"
						},
						CustomerBillingInfo: {
							masterColumn: "CustomerBillingInfo"
						},
						OurCompany: {
							masterColumn: "OurCompany"
						},
						SupplierBillingInfo: {
							masterColumn: "SupplierBillingInfo"
						}
					}
				},
				Visa: {
					schemaName: "VisaDetailV2",
					entitySchemaName: "ContractVisa",
					filter: {
						masterColumn: "Id",
						detailColumn: "Contract"
					}
				},
				EmailDetailV2: {
					schemaName: "EmailDetailV2",
					filter: {
						masterColumn: "Id",
						detailColumn: "Contract"
					},
					filterMethod: "emailDetailFilter"
				}
			}/**SCHEMA_DETAILS*/,
			attributes: {
				"State": {
					lookupListConfig: {
						orders: [{columnPath: "Position"}]
					}
				},
				"Parent": {
					name: "Parent",
					dependencies: [
						{
							columns: ["Account", "OurCompany"],
							methodName: "clearParent"
						}
					]
				},

				/**
				 * Платежные реквизиты клиента
				 */
				"CustomerBillingInfo": {
					dataValueType: this.Terrasoft.DataValueType.LOOKUP,
					dependencies: [
						{
							columns: ["Account"],
							methodName: "clearBillingInfo"
						}
					],
					lookupListConfig: {
						filter: function() {
							var account = this.get("Account");
							account = account && account.value;
							var filters = this.Terrasoft.createFilterGroup();
							filters.logicalOperation = Terrasoft.LogicalOperatorType.OR;
							filters.addItem(this.Terrasoft.createColumnFilterWithParameter(
									this.Terrasoft.ComparisonType.EQUAL, "Account", account));
							var filtersRelation = this.Terrasoft.createFilterGroup();
							filtersRelation.addItem(this.Terrasoft.createColumnFilterWithParameter(
								this.Terrasoft.ComparisonType.EQUAL,
								"[VwAccountRelationship:RelatedAccount:Account].RelationType",
								ConfigurationConstants.RelationType.HeadCompany));
							filtersRelation.addItem(this.Terrasoft.createColumnFilterWithParameter(
								this.Terrasoft.ComparisonType.EQUAL,
								"[VwAccountRelationship:RelatedAccount:Account].Account",
								account));
							filters.addItem(filtersRelation);
							return filters;
						}
					}
				},

				/**
				 * Платежные реквизиты нашей компании
				 */
				"SupplierBillingInfo": {
					dependencies: [
						{
							columns: ["OurCompany"],
							methodName: "clearBillingInfo"
						}
					]
				}
			},
			methods: {
				/**
				 * @inheritdoc BasePageV2#onEntityInitialized
				 * @overridden
				 */
				onEntityInitialized: function() {
					if ((this.isAddMode() && this.Ext.isEmpty(this.get("Number"))) || this.isCopyMode()) {
						this.getIncrementCode(function(response) {
							this.set("Number", response);
						});
					}
					this.callParent(arguments);
				},

				/**
				 * @inheritdoc BasePageV2#onEntityInitialized
				 * @overridden
				 */
				getActions: function() {
					var actionMenuItems = this.callParent(arguments);
					actionMenuItems.addItem(this.getButtonMenuItem({
						Type: "Terrasoft.MenuSeparator",
						Caption: ""
					}));
					actionMenuItems.addItem(this.getButtonMenuItem({
						"Caption": VisaHelper.resources.localizableStrings.SendToVisaCaption,
						"Tag": VisaHelper.SendToVisaMenuItem.methodName,
						"Enabled": {"bindTo": "canEntityBeOperated"}
					}));
					return actionMenuItems;
				},

				/**
				 * @inheritdoc Terrasoft.BasePageV2#getUpdateDetailOnSavedConfig
				 * @overridden
				 */
				getUpdateDetailOnSavedConfig: function() {
					var updateConfig = {};
					var parentAccountValue = this.getParentAccountValue();
					var currentAccount = this.get("Account");
					if (parentAccountValue && currentAccount &&
							parentAccountValue !== currentAccount.value) {
						updateConfig.reloadAll = true;
					} else {
						updateConfig.primaryColumnValue = this.get(this.primaryColumnName);
					}
					return updateConfig;
				},

				/**
				 * Returns parent account value.
				 * @private
				 * @return {Guid} Parent account value.
				 */
				getParentAccountValue: function() {
					var result = null;
					var defaultValues = this.get("DefaultValues");
					if (this.isNotEmpty(defaultValues)) {
						var parentAccount = this.Terrasoft.findItem(defaultValues, {name: "Account"});
						if (parentAccount && parentAccount.item) {
							var account = parentAccount.item;
							result = account.value;
						}
					}
					return result;
				},

				/**
				 * Sends current record to sighting.
				 */
				sendToVisa: VisaHelper.SendToVisaMethod,

				/**
				 * Validates number column value.
				 */
				validateUniqueNumber: function(callback, scope) {
					var number = this.get("Number");
					var id = this.get("Id");
					var result = {
						success: true
					};
					if (!this.changedValues || this.Ext.isEmpty(this.changedValues.Number)) {
						this.Ext.callback(callback, scope || this, [result]);
					} else {
						var select = this.Ext.create("Terrasoft.EntitySchemaQuery", {
							rootSchemaName: this.entitySchemaName
						});
						select.addColumn("Number");
						select.filters.addItem(select.createColumnFilterWithParameter(
							this.Terrasoft.ComparisonType.NOT_EQUAL, "Id", id));
						select.filters.addItem(select.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.EQUAL,
							"Number", number));
						select.getEntityCollection(function(response, scope) {
							if (response.success) {
								if (response.collection.getCount() > 0) {
									result.message = this.get("Resources.Strings.NumberMustBeUnique");
									result.success = false;
								}
							} else {
								return;
							}
							Ext.callback(callback, scope || this, [result]);
						}, scope);
					}
				},

				/**
				 * Validates end date column value.
				 * @param {Object} column End date column value.
				 */
				validateEndDate: function(column) {
					var invalidMessage = "";
					if (!this.Ext.isEmpty(column) && this.get("StartDate") > column) {
						invalidMessage = this.get("Resources.Strings.DueDateLowerStartDate");
					}
					return {
						fullInvalidMessage: invalidMessage,
						invalidMessage: invalidMessage
					};
				},

				/**
				 * Проверка валидации "Дата начала" и "Дата завершения".
				 * "Дата завершения" должна быть больша/равно "Дата начала".
				 */
				setValidationConfig: function() {
					this.callParent(arguments);
					this.addColumnValidator("EndDate", this.validateEndDate);
				},

				/**
				 * Выполняет проверку значения модели представления.
				 * @protected
				 * @overridden
				 * @param {Function} callback callback-функция
				 * @param {Terrasoft.BaseSchemaViewModel} scope Контекст выполнения callback-функции
				 */
				asyncValidate: function(callback, scope) {
					this.callParent([function(response) {
						if (!this.validateResponse(response)) {
							return;
						}
						Terrasoft.chain(
							function(next) {
								this.validateUniqueNumber(function(response) {
									if (this.validateResponse(response)) {
										next();
									}
								}, this);
							},
							function(next) {
								callback.call(scope, response);
								next();
							}, this);
					}, this]);
				},

				/**
				 * Cleanes field "Parent".
				 */
				clearParent: function() {
					this.set("Parent", "");
				},

				/**
				 * Очистить значения платежных реквизитов нашей компании или клиента
				 * @protected
				 */
				clearBillingInfo: function(argument, field) {
					var changedValue = this.changedValues[field];
					var fieldValue = this.get(field) !== null ? this.get(field).value : {};
					if (changedValue && changedValue.value !== fieldValue) {
						if (field === "Account") {
							this.set("CustomerBillingInfo", null);
						}
						if (field === "OurCompany") {
							this.set("SupplierBillingInfo", null);
						}
					}
				},

				/**
				 * Для атрибута Account установка значение (вызов метод родителя) вызывается только в случае
				 * когда устанавливаемое значение колонки отличается от существующего по ключевому значению
				 * @inheritdoc Terrasoft.BaseViewModel#set
				 * @overriden
				 */
				set: function(key, value) {
					if (key === "Account") {
						var currentValue = this.get(key);
						var currentValueId = currentValue ? currentValue.value : "";
						var valueId = value ? value.value : "";
						if (currentValueId === valueId) {
							return;
						}
					}
					this.callParent(arguments);
				},

				/**
				 * Creates filter for detail Email.
				 * @protected
				 * @return {Terrasoft.FilterGroup} Group filters.
				 */
				emailDetailFilter: function() {
					var recordId = this.get("Id");
					var filterGroup = new this.Terrasoft.createFilterGroup();
					filterGroup.add("ContractNotNull", this.Terrasoft.createColumnIsNotNullFilter("Contract"));
					filterGroup.add("ContractConnection", this.Terrasoft.createColumnFilterWithParameter(
						this.Terrasoft.ComparisonType.EQUAL, "Contract", recordId));
					filterGroup.add("ActivityType", this.Terrasoft.createColumnFilterWithParameter(
						this.Terrasoft.ComparisonType.EQUAL, "Type", ConfigurationConstants.Activity.Type.Email));
					return filterGroup;
				}
			},
			diff: /**SCHEMA_DIFF*/[
				{
					"operation": "insert",
					"name": "Number",
					"values": {
						"layout": {
							"column": 0,
							"row": 0,
							"colSpan": 12,
							"rowSpan": 1
						},
						"bindTo": "Number",
						"textSize": 0,
						"labelConfig": {
							"visible": true
						},
						"enabled": true
					},
					"parentName": "Header",
					"propertyName": "items",
					"index": 0
				},
				{
					"operation": "insert",
					"name": "Owner",
					"values": {
						"layout": {
							"column": 12,
							"row": 0,
							"colSpan": 12,
							"rowSpan": 1
						},
						"tip": {
							"content": {"bindTo": "Resources.Strings.OwnerTip"}
						},
						"bindTo": "Owner",
						"enabled": true
					},
					"parentName": "Header",
					"propertyName": "items",
					"index": 1
				},
				{
					"operation": "insert",
					"name": "StartDate",
					"values": {
						"layout": {
							"column": 0,
							"row": 2,
							"colSpan": 12,
							"rowSpan": 1
						},
						"bindTo": "StartDate",
						"textSize": 0,
						"labelConfig": {
							"visible": true
						},
						"enabled": true
					},
					"parentName": "Header",
					"propertyName": "items",
					"index": 2
				},
				{
					"operation": "insert",
					"name": "Type",
					"values": {
						"layout": {
							"column": 0,
							"row": 1,
							"colSpan": 12,
							"rowSpan": 1
						},
						"bindTo": "Type",
						"textSize": 0,
						"contentType": this.Terrasoft.ContentType.ENUM,
						"labelConfig": {
							"visible": true
						},
						"enabled": true
					},
					"parentName": "Header",
					"propertyName": "items",
					"index": 3
				},
				{
					"operation": "insert",
					"name": "EndDate",
					"values": {
						"layout": {
							"column": 12,
							"row": 2,
							"colSpan": 12,
							"rowSpan": 1
						},
						"bindTo": "EndDate",
						"textSize": 0,
						"labelConfig": {
							"visible": true
						},
						"enabled": true
					},
					"parentName": "Header",
					"propertyName": "items",
					"index": 4
				},
				{
					"operation": "insert",
					"name": "State",
					"values": {
						"layout": {
							"column": 12,
							"row": 1,
							"colSpan": 12,
							"rowSpan": 1
						},
						"bindTo": "State",
						"textSize": 0,
						"contentType": this.Terrasoft.ContentType.ENUM,
						"labelConfig": {
							"visible": true
						},
						"enabled": true
					},
					"parentName": "Header",
					"propertyName": "items",
					"index": 5
				},
				{
					"operation": "insert",
					"name": "GeneralInfoTab",
					"values": {
						"caption": {
							"bindTo": "Resources.Strings.GeneralInfoTabCaption"
						},
						"items": []
					},
					"parentName": "Tabs",
					"propertyName": "tabs",
					"index": 0
				},
				{
					"operation": "insert",
					"name": "group",
					"values": {
						"itemType": this.Terrasoft.ViewItemType.CONTROL_GROUP,
						"caption": {
							"bindTo": "Resources.Strings.groupCaption"
						},
						"items": [],
						"controlConfig": {
							"collapsed": false
						}
					},
					"parentName": "GeneralInfoTab",
					"propertyName": "items",
					"index": 1
				},
				{
					"operation": "insert",
					"name": "group_gridLayout",
					"values": {
						"itemType": this.Terrasoft.ViewItemType.GRID_LAYOUT,
						"items": []
					},
					"parentName": "group",
					"propertyName": "items",
					"index": 0
				},
				{
					"operation": "insert",
					"name": "Account",
					"values": {
						"layout": {
							"column": 0,
							"row": 0,
							"colSpan": 12,
							"rowSpan": 1
						},
						"bindTo": "Account",
						"enabled": true
					},
					"parentName": "group_gridLayout",
					"propertyName": "items",
					"index": 0
				},
				{
					"operation": "insert",
					"name": "CustomerBillingInfo",
					"values": {
						"layout": {
							"column": 0,
							"row": 1,
							"colSpan": 12,
							"rowSpan": 1
						},
						"tip": {
							"content": {"bindTo": "Resources.Strings.CustomerBillingInfoTip"}
						},
						"bindTo": "CustomerBillingInfo",
						"contentType": this.Terrasoft.ContentType.ENUM,
						"enabled": true
					},
					"parentName": "group_gridLayout",
					"propertyName": "items",
					"index": 1
				},
				{
					"operation": "insert",
					"name": "Contact",
					"values": {
						"layout": {
							"column": 0,
							"row": 2,
							"colSpan": 12,
							"rowSpan": 1
						},
						"bindTo": "Contact",
						"enabled": true
					},
					"parentName": "group_gridLayout",
					"propertyName": "items",
					"index": 2
				},
				{
					"operation": "insert",
					"name": "OurCompany",
					"values": {
						"layout": {
							"column": 12,
							"row": 0,
							"colSpan": 12,
							"rowSpan": 1
						},
						"bindTo": "OurCompany",
						"textSize": "Default",
						"contentType": this.Terrasoft.ContentType.LOOKUP,
						"labelConfig": {
							"visible": true
						},
						"enabled": true
					},
					"parentName": "group_gridLayout",
					"propertyName": "items",
					"index": 3
				},
				{
					"operation": "insert",
					"name": "SupplierBillingInfo",
					"values": {
						"layout": {
							"column": 12,
							"row": 1,
							"colSpan": 12,
							"rowSpan": 1
						},
						"tip": {
							"content": {"bindTo": "Resources.Strings.SupplierBillingInfoTip"}
						},
						"bindTo": "SupplierBillingInfo",
						"contentType": this.Terrasoft.ContentType.ENUM,
						"enabled": true
					},
					"parentName": "group_gridLayout",
					"propertyName": "items",
					"index": 4
				},
				{
					"operation": "insert",
					"name": "ContractConnectionsGroup",
					"values": {
						"itemType": this.Terrasoft.ViewItemType.CONTROL_GROUP,
						"items": [],
						"caption": {
							"bindTo": "Resources.Strings.ContractConnectionsGroupCaption"
						},
						"controlConfig": {
							"collapsed": false
						}
					},
					"parentName": "GeneralInfoTab",
					"propertyName": "items",
					"index": 2
				},
				{
					"operation": "insert",
					"name": "ContractConnectionsBlock",
					"values": {
						"itemType": this.Terrasoft.ViewItemType.GRID_LAYOUT,
						"items": []
					},
					"parentName": "ContractConnectionsGroup",
					"propertyName": "items",
					"index": 0
				},
				{
					"operation": "insert",
					"name": "Parent",
					"values": {
						"bindTo": "Parent",
						"layout": {
							"column": 0,
							"row": 0
						},
						"tip": {
							"content": {"bindTo": "Resources.Strings.ParentTip"}
						}
					},
					"parentName": "ContractConnectionsBlock",
					"propertyName": "items",
					"index": 0
				},
				{
					"operation": "insert",
					"name": "NotesAndFilesTab",
					"values": {
						"items": [],
						"caption": {
							"bindTo": "Resources.Strings.NotesAndFilesTab"
						}
					},
					"parentName": "Tabs",
					"propertyName": "tabs",
					"index": 3
				},
				{
					"operation": "insert",
					"name": "Files",
					"values": {
						"itemType": this.Terrasoft.ViewItemType.DETAIL
					},
					"parentName": "NotesAndFilesTab",
					"propertyName": "items",
					"index": 0
				},
				{
					"operation": "insert",
					"name": "ContractNotesControlGroup",
					"values": {
						"itemType": this.Terrasoft.ViewItemType.CONTROL_GROUP,
						"items": [],
						"caption": {
							"bindTo": "Resources.Strings.NotesGroupCaption"
						},
						"controlConfig": {
							"collapsed": false
						}
					},
					"parentName": "NotesAndFilesTab",
					"propertyName": "items",
					"index": 1
				},
				{
					"operation": "insert",
					"name": "Notes",
					"values": {
						"contentType": this.Terrasoft.ContentType.RICH_TEXT,
						"layout": {
							"column": 0,
							"row": 0,
							"colSpan": 24
						},
						"labelConfig": {
							"visible": false
						},
						"controlConfig": {
							"imageLoaded": {
								"bindTo": "insertImagesToNotes"
							},
							"images": {
								"bindTo": "NotesImagesCollection"
							}
						}
					},
					"parentName": "ContractNotesControlGroup",
					"propertyName": "items",
					"index": 0
				},
				{
					"operation": "insert",
					"name": "HistoryTab",
					"values": {
						"items": [],
						"caption": {
							"bindTo": "Resources.Strings.HistoryTab"
						}
					},
					"parentName": "Tabs",
					"propertyName": "tabs",
					"index": 1
				},
				{
					"operation": "insert",
					"name": "Activities",
					"values": {
						"itemType": this.Terrasoft.ViewItemType.DETAIL
					},
					"parentName": "HistoryTab",
					"propertyName": "items",
					"index": 0
				},
				{
					"operation": "insert",
					"parentName": "HistoryTab",
					"propertyName": "items",
					"name": "EmailDetailV2",
					"values": {
						"itemType": Terrasoft.ViewItemType.DETAIL
					}
				},
				{
					"operation": "insert",
					"name": "SubordinateContracts",
					"values": {
						"itemType": this.Terrasoft.ViewItemType.DETAIL
					},
					"parentName": "GeneralInfoTab",
					"propertyName": "items",
					"index": 3
				},
				{
					"operation": "insert",
					"name": "ContractVisaTab",
					"parentName": "Tabs",
					"propertyName": "tabs",
					"values": {
						"caption": {"bindTo": "Resources.Strings.ContractVisaTabCaption"},
						"items": []
					},
					"index": 2
				},
				{
					"operation": "insert",
					"parentName": "ContractVisaTab",
					"name": "ContractPageVisaTabContainer",
					"propertyName": "items",
					"values": {
						"itemType": this.Terrasoft.ViewItemType.CONTAINER,
						"items": []
					}
				},
				{
					"operation": "insert",
					"parentName": "ContractVisaTab",
					"propertyName": "items",
					"name": "Visa",
					"lableConfig": {"visible": false},
					"values": {
						"itemType": this.Terrasoft.ViewItemType.DETAIL
					}
				},
				{
					"operation": "insert",
					"parentName": "ContractPageVisaTabContainer",
					"propertyName": "items",
					"name": "ContractPageVisaBlock",
					"values": {
						"itemType": this.Terrasoft.ViewItemType.GRID_LAYOUT,
						"items": []
					}
				}
			]/**SCHEMA_DIFF*/,
			rules: {
				"OurCompany": {
					"FiltrationByType": {
						"ruleType": BusinessRuleModule.enums.RuleType.FILTRATION,
						"autocomplete": false,
						"baseAttributePatch": "Type",
						"comparisonType": this.Terrasoft.ComparisonType.EQUAL,
						"type": BusinessRuleModule.enums.ValueType.CONSTANT,
						"value": ConfigurationConstants.AccountType.OurCompany
					}
				},
				"Parent": {
					"FiltrationParentByAccount": {
						"ruleType": BusinessRuleModule.enums.RuleType.FILTRATION,
						"autocomplete": true,
						"baseAttributePatch": "Account",
						"comparisonType": this.Terrasoft.ComparisonType.EQUAL,
						"type": BusinessRuleModule.enums.ValueType.ATTRIBUTE,
						"attribute": "Account"
					},
					"FiltrationParentBySupplier": {
						"ruleType": BusinessRuleModule.enums.RuleType.FILTRATION,
						"autocomplete": true,
						"baseAttributePatch": "OurCompany",
						"comparisonType": this.Terrasoft.ComparisonType.EQUAL,
						"type": BusinessRuleModule.enums.ValueType.ATTRIBUTE,
						"attribute": "OurCompany"
					},
					"FiltrationParentByParent": {
						"ruleType": BusinessRuleModule.enums.RuleType.FILTRATION,
						"autocomplete": false,
						"baseAttributePatch": "Id",
						"comparisonType": this.Terrasoft.ComparisonType.NOT_EQUAL,
						"type": BusinessRuleModule.enums.ValueType.ATTRIBUTE,
						"attribute": "Id"
					}
				},
				"SupplierBillingInfo": {
					"FiltrationSupplierBillingByAccount": {
						"ruleType": BusinessRuleModule.enums.RuleType.FILTRATION,
						"autocomplete": true,
						"baseAttributePatch": "Account",
						"comparisonType": this.Terrasoft.ComparisonType.EQUAL,
						"type": BusinessRuleModule.enums.ValueType.ATTRIBUTE,
						"attribute": "OurCompany"
					},
					"BindParameterEnabledSupplierBillingInfoToSupplier": {
						"ruleType": BusinessRuleModule.enums.RuleType.BINDPARAMETER,
						"property": BusinessRuleModule.enums.Property.ENABLED,
						"conditions": [
							{
								"leftExpression": {
									"type": BusinessRuleModule.enums.ValueType.ATTRIBUTE,
									"attribute": "OurCompany"
								},
								"comparisonType": Terrasoft.ComparisonType.IS_NOT_NULL
							}
						]
					}
				},
				"CustomerBillingInfo": {
					"BindParameterEnabledCustomerBillingInfoToAccount": {
						"ruleType": BusinessRuleModule.enums.RuleType.BINDPARAMETER,
						"property": BusinessRuleModule.enums.Property.ENABLED,
						"conditions": [
							{
								"leftExpression": {
									"type": BusinessRuleModule.enums.ValueType.ATTRIBUTE,
									"attribute": "Account"
								},
								"comparisonType": Terrasoft.ComparisonType.IS_NOT_NULL
							}
						]
					}
				},
				"Contact": {
					"FiltrationContactByAccount": {
						"ruleType": BusinessRuleModule.enums.RuleType.FILTRATION,
						"autocomplete": true,
						"autoClean": true,
						"baseAttributePatch": "Account",
						"comparisonType": this.Terrasoft.ComparisonType.EQUAL,
						"type": BusinessRuleModule.enums.ValueType.ATTRIBUTE,
						"attribute": "Account"
					}
				}
			}
		};
	});

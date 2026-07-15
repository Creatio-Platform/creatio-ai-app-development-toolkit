define("ContractPageV2", ["Dw8xClientHelperModule", "BusinessRuleModule", "ConfigurationConstants", "WorkSalesBaseConstants", "RightUtilities",
			"MultiCurrencyEdit", "MultiCurrencyEditUtilities", "WorkContractPrintReportUtilities", "ProcessModuleUtilities"
		],
		function(Dw8xClientHelperModule, BusinessRuleModule, ConfigurationConstants, WorkSalesBaseConstants, RightUtilities, ProcessModuleUtilities) {
			return {
				entitySchemaName: "Contract",
				details: /**SCHEMA_DETAILS*/{
					"SpecInContractDetail": {
						"schemaName": "SpecInContractDetail",
						"entitySchemaName": "SpecInContract",
						"filter": {
							"masterColumn": "Id",
							"detailColumn": "Contract"
						}
					},
					"SaaSMetricsDetail": {
						"schemaName": "SaaSMetricsDetail",
						"entitySchemaName": "SaaSMetrics",
						"filter": {
							"masterColumn": "Id",
							"detailColumn": "Specification"
						}
					},
					"SpecInContractHistoryDetail": {
						"schemaName": "SpecInContractHistoryDetail",
						"entitySchemaName": "SpecInContractHistory",
						"filter": {
							"masterColumn": "Id",
							"detailColumn": "Contract"
						}
					},
					"VwOrderProductGroupedByProductsAndPartnerDetail": {
						"schemaName": "VwOrderProductGroupedByProductsAndPartnerDetail",
						"entitySchemaName": "VwOrderProductGroupedByProductsAndPartner",
						"filter": {
							"masterColumn": "Id",
							"detailColumn": "Contract"
						}
					}
				}/**SCHEMA_DETAILS*/,
				mixins: {
					WorkContractPrintReportUtilities: "Terrasoft.WorkContractPrintReportUtilities"
				},
				attributes: {
					"Order": {
						"lookupListConfig": {
							"columns": ["OrderType", "ProductCatalogueType", "SupplierBillingInfoLic"]
						}
					},
					"Printable": {
						"lookupListConfig": {
							filter: function() {
								return this.getPrintFormFilter();
							}
						}
					},
					"IsOrder360": {
						"dataValueType": Terrasoft.DataValueType.BOOLEAN,
					},
					"SeparatePeriods": {
						"dataValueType": Terrasoft.DataValueType.BOOLEAN,
					},
					"IsOrderProductGroupedByProductsAndPartnerDetailVisible": {
						"dataValueType": Terrasoft.DataValueType.BOOLEAN
					},
					"Parent": {
						"lookupListConfig": {
							"columns": ["SupplierBillingInfo"]
						}
					},
					"SupplierBillingInfo": {
						"dependencies": [
							{
								"columns": ["Parent"],
								"methodName": "setSupplierBillingInfo"
							}
						]
					},
					"Type": {
						"dependencies": [
							{
								"columns": ["Type"],
								"methodName": "setDwActualSigningDateAttributes"
							}
						],
						"lookupListConfig": {
							"columns": ["DwIsForActualSigningDate"]
						}
					},
					"State": {
						"dependencies": [
							{
								"columns": ["State"],
								"methodName": "setDwActualSigningDateAttributes"
							}
						]
					},
					"StartDate": {
						"dependencies": [
							{
								"columns": ["StartDate"],
								"methodName": "setDwActualSigningDate"
							}
						]
					},
					"IsDwActualContractSigningDateFeatureEnabled": {
						"dataValueType": this.Terrasoft.DataValueType.BOOLEAN,
						"type": this.Terrasoft.ViewModelColumnType.VIRTUAL_COLUMN,
						"value": this.Terrasoft.Features.getIsEnabled("DwActualContractSigningDateFeature")
					},
					"IsDwActualSigningDateVisible": {
						"dataValueType": this.Terrasoft.DataValueType.BOOLEAN,
						"type": this.Terrasoft.ViewModelColumnType.VIRTUAL_COLUMN
					},
					"IsDwActualSigningDateRequired": {
						"dataValueType": this.Terrasoft.DataValueType.BOOLEAN,
						"type": this.Terrasoft.ViewModelColumnType.VIRTUAL_COLUMN
					},
					"StartDateEdit": {
						"dataValueType": this.Terrasoft.DataValueType.DATE,
						"type": this.Terrasoft.ViewModelColumnType.VIRTUAL_COLUMN
					},
					"TypeOld": {
						"type": this.Terrasoft.ViewModelColumnType.VIRTUAL_COLUMN
					},
					"StateOld": {
						"type": this.Terrasoft.ViewModelColumnType.VIRTUAL_COLUMN
					}
				},
				methods: {
					onEntityInitialized: function() {
						this.callParent(arguments);
						RightUtilities.checkCanExecuteOperation({operation: "CanChangeSignDate"},
								function(result) {
									this.set("CanChangeSignDateOperation", !!result);
								}, this);
						var collection = this.Ext.create("Terrasoft.BaseViewModelCollection");
						Terrasoft.chain(
							this.setIsOrder360,
							this.setIsOrderSeparatePeriods,
								function(next) {
									this.generateContractPrintMenu(function(collect) {
										if (collect.getCount() > 0) {
											collection.loadAll(collect);
										}
										next();
									}, this);
								},
								function() {
									var scope = this;
									scope.set("WorkCardPrintMenuItems", collection);
								},
								this);
						this.setIsOrderProductGroupedByProductsAndPartnerDetailVisible();
						this.setDwActualSigningDateAttributes();
						this.setAttributesOldValue();
					},

					generateContractPrintMenu: function(callback) {
						if (!this.getIsFeatureEnabled("OrdersAndInvoicesEpicFeature")) {
							var Supplier = this.get("OurCompany");
							var Type = this.get("Type");
							var SupplierBillingInfo = this.get("SupplierBillingInfo");
							var isSupplierSet = false;
							var esq = Ext.create("Terrasoft.EntitySchemaQuery", {rootSchemaName: "DefaultReport"});
							esq.addColumn("Id");
							var nameColumn = esq.addColumn("Name");
							nameColumn.orderDirection = Terrasoft.OrderDirection.ASC;
							esq.addColumn("[SysModuleReport:Id:SysModuleReport].Id", "ModuleReportId");
							esq.addColumn("[SysModuleReport:Id:SysModuleReport].Caption", "ModuleReportCaption");
							esq.addColumn("[SysModuleReport:Id:SysModuleReport].Type", "ModuleReportType");
							esq.addColumn("[SysModuleReport:Id:SysModuleReport].ConvertInPDF", "ModuleReportConvertInPDF");
							esq.addColumn("[SysModuleReport:Id:SysModuleReport].SysReportSchemaUId", "SysReportSchemaUId");
							esq.addColumn("[SysModuleReport:Id:SysModuleReport].TypeColumnValue", "TypeColumnValue");
							if (!Ext.isEmpty(Supplier)) {
								esq.filters.add("filterSupplier", this.Terrasoft.createColumnFilterWithParameter(
										this.Terrasoft.ComparisonType.EQUAL, "Supplier",
										Supplier.value));
								isSupplierSet = true;
							}

							if (!Ext.isEmpty(SupplierBillingInfo)) {
								esq.filters.add("filterSupplierBillingInfo", this.Terrasoft.createColumnFilterWithParameter(
										this.Terrasoft.ComparisonType.EQUAL, "SupplierBillingInfo",
										SupplierBillingInfo.value));
							} else {
								isSupplierSet = false;
							}
							esq.filters.add("filterSysModule", this.Terrasoft.createColumnFilterWithParameter(
									this.Terrasoft.ComparisonType.EQUAL, "SysModule",
									WorkSalesBaseConstants.SysModule.Contract));
							if (!Ext.isEmpty(Type)) {
								esq.filters.add("filterType", this.Terrasoft.createColumnFilterWithParameter(
										this.Terrasoft.ComparisonType.EQUAL, "ContractType",
										Type.value));
							}
							esq.getEntityCollection(function(result) {
								var items = null;
								var collection = Ext.create("Terrasoft.BaseViewModelCollection");
								if (result.success && result.collection.getCount() > 0) {
									items = result.collection.getItems();
									Terrasoft.each(items, function(item) {
										collection.add(item.get("Id"), this.getButtonMenuItem({
											"Caption": item.get("Name"),
											"Click": {"bindTo": "generateCardPrintForm"},
											"Enabled": isSupplierSet,
											"Tag": {
												Caption: item.get("ModuleReportCaption"),
												ContractCaption: item.get("Name"),
												ConvertInPDF: item.get("ModuleReportConvertInPDF"),
												Id: item.get("ModuleReportId"),
												NonLocalizedCaption: item.get("ModuleReportCaption"),
												PrintFormType: !Ext.isEmpty(item.get("ModuleReportType")) ?
														item.get("ModuleReportType").displayValue : "MS Word",
												SysReportSchemaUId: item.get("SysReportSchemaUId"),
												TypeColumnValue: item.get("TypeColumnValue"),
												RecordId: item.get("Id")
											}
										}));
									}, this);
								}
								callback.call(this, collection);
							}, this);
						} else {
							var config = this._getPrintMenuConfig();
							this.generatePrintMenuForEntity(config, callback);
						}
					},
					
					/**
					 * Get print menu config
					 * @private
					 * @return {Object} Print menu config
					 */
					_getPrintMenuConfig: function() {
						var supplier = this.get("OurCompany");
						var type = this.get("Type");
						var supplierBillingInfo = this.get("SupplierBillingInfo");
						var order = this.get("Order");
						var orderType = order?.OrderType;
						var orderCatalogueType = order?.ProductCatalogueType;
						return {
							"ourCompany": supplier,
							"type": type,
							"supplierBillingInfo": supplierBillingInfo,
							"orderType": orderType,
							"orderCatalogueType": orderCatalogueType,
							"getButtonMenuItem": this.getButtonMenuItem,
							"isOrder360": this.get("IsOrder360"),
							"separatePeriods": this.get("SeparatePeriods")
						};
					},

					/**
					 * @inheritdoc Terrasoft.PrintReportUtilities#generateCardPrintForm
					 * overridden
					 */
					generateCardPrintForm: function(tag) {
						tag.RecordId = this.get("Id");
						tag.entitySchemaUId = WorkSalesBaseConstants.SysSchemaUId.Invoice;
						this.downloadPrintForm(tag, this.downloadPrintFormCallback, this);
					},

					/**
					 * The callback function to downloads print form.
					 * @protected
					 * @param {Object} response Response from service with print form.
					 * @param {String} caption Caption of print form.
					 */
					downloadPrintFormCallback: function(response, caption) {
						var key = response.CreateReportResult;
						this.downloadReport(caption, key);
					},

					/**
					 * Get print form filter
					 * @protected
					 * @return {Terrasoft.ExistsFilter} Print form filter
					 */
					getPrintFormFilter: function() {
						var config = this._getPrintMenuConfig();
						return this.Terrasoft.createExistsFilter("[DefaultReport:SysModuleReport:Id].Id", 
							this.getPrintMenuEsqFilters(config));
					},

					/**
					* Возвращает коллекцию действий страницы редактирования
					* @protected
					* @overridden
					* @return {Terrasoft.BaseViewModelCollection} Возвращает коллекцию действий страницы редактирования
					*/
					getActions: function() {
						var actionMenuItems = this.callParent(arguments);
						actionMenuItems.addItem(this.getButtonMenuItem({
							"Caption": {bindTo: "Resources.Strings.CalculateSaaSMetrics"},
							"Tag": "calculateSaaSMetrics",
							"Visible": { bindTo: "isCalculateSaaSMetricsAvailable" }
						}));
						return actionMenuItems;
					},
					
					calculateSaaSMetrics: function() {
						var contractId = this.get("Id");
						if (Ext.isEmpty(contractId)) {
							return;
						}
						var args = {
							sysProcessName: "CalculateSaaSMetricsOnAction",
							parameters: {
								ContractId: contractId
							}
						};
						Terrasoft.ProcessModuleUtilities.executeProcess(args);
					},
					
					isCalculateSaaSMetricsAvailable: function() {
						return this.getIsFeatureEnabled("CalculateSaaSMetrics");
					},

					/**
					 * @override
					 */
					isDetailEnabled: function(detailSchemaName) {
						if (detailSchemaName === "VwOrderProductGroupedByProductsAndPartnerDetail") {
							return false;
						}
						return this.callParent(arguments);
					},

					set: function (key, value) {
						if (key === "OurCompany" && this.getLookupValue(key) === value?.value) {
							return;
						}
						this.callParent(arguments);
					},

					/**
					 * @overridden
					 */
					parentChanged: Terrasoft.emptyFn,

					setSupplierBillingInfo: function() {
						var parent = this.get("Parent");
						this.set("SupplierBillingInfo", parent ? parent?.SupplierBillingInfo : null);
					},

					setIsOrderProductGroupedByProductsAndPartnerDetailVisible: function() {
						const allowedContractTypes = [
							WorkSalesBaseConstants.ContractType.MarketplaceSow,
							WorkSalesBaseConstants.ContractType.ResellingSow
						];
						const contractTypeId = this.getLookupValue("Type");
						this.$IsOrderProductGroupedByProductsAndPartnerDetailVisible =
							allowedContractTypes.includes(contractTypeId);
					},

					save: function() {
						var parentMethod = this.getParentMethod(this, arguments);
						this.validateDwActualSigningDate()
							.then(isActualSigningDateValid => {
								if (!isActualSigningDateValid) {
									return;
								}
								this.verifyChangedData(function(isVerified) {
									if (isVerified) {
										parentMethod();
										this.$IsTypeChanged = this.getChangedEntityColumns()?.includes("Type");
									}
								}, this);
								
							});
					},

					/**
					 * @override
					 */
					onSaved: function () {
						this.callParent(arguments);
						if (this.$IsTypeChanged) {
							this.reloadMarketplaceProductsDetail();
						}
					},

					verifyChangedData: function(callback, scope) {
						if (this.getIsNeedToVerifyDifferentBankingDetail()) {
							this.showVerificationDialog(this.get("Resources.Strings.DifferentBankingDetailWarningMessage"), callback, scope);
							return;
						}
						if (this.getIsNeedToVerifyBankingDetailChanged()) {
							this.showVerificationDialog(this.get("Resources.Strings.BankingDetailChangedWarningMessage"), callback, scope);
							return;
						}
						this.Ext.callback(callback, scope, [true]);
					},

					getIsNeedToVerifyDifferentBankingDetail() {
						var order = this.get("Order");
						var orderSupplierBillingInfo = order?.SupplierBillingInfoLic;
						var contractSupplierBillingInfo = this.get("SupplierBillingInfo");
						var changedColumns = this.getChangedEntityColumns();
						return !this.Ext.isEmpty(changedColumns) && 
							changedColumns.includes("SupplierBillingInfo") &&
							!this.Ext.isEmpty(orderSupplierBillingInfo) &&
							!this.Ext.isEmpty(contractSupplierBillingInfo) &&
							orderSupplierBillingInfo.value !== contractSupplierBillingInfo.value;
					},

					getIsNeedToVerifyBankingDetailChanged: function() {
						var changedColumns = this.getChangedEntityColumns();
						return !this.isNewMode() && !this.Ext.isEmpty(changedColumns) &&
							(changedColumns.includes("CustomerBillingInfo") || changedColumns.includes("SupplierBillingInfo"));
					},

					showVerificationDialog: function(message, callback, scope) {
						this.showConfirmationDialog(
							message,
							function(dialogResult) {
								var isVerified = dialogResult === this.Terrasoft.MessageBoxButtons.YES.returnCode;
								this.Ext.callback(callback, scope, [isVerified]);
							},
							[this.Terrasoft.MessageBoxButtons.YES.returnCode, this.Terrasoft.MessageBoxButtons.CANCEL.returnCode]
						);
					},

					reloadMarketplaceProductsDetail: function() {
						this.setIsOrderProductGroupedByProductsAndPartnerDetailVisible();
						this.updateDetail({ detail: "VwOrderProductGroupedByProductsAndPartnerDetail", reloadAll: true });
					},
					
					setDwActualSigningDateAttributes: function (config) {
						this.setIsDwActualSigningDateVisible(config?.typeOld);
						this.setIsDwActualSigningDateRequired(config?.stateOld);
					},

					setAttributesOldValue: function () {
						this.set("TypeOld", this.get("Type"), {silent: true});
						this.set("StateOld", this.get("State"), {silent: true});
					},

					onDiscardChangesClick: function () {
						this.callParent(arguments);
						if (this.getChangedEntityColumns()
							.some(column => ["Type", "State"].includes(column))) {
							const config = {
								typeOld: this.get("TypeOld"),
								stateOld: this.get("StateOld")
							};
							this.setDwActualSigningDateAttributes(config);
						}
					},

					setIsDwActualSigningDateVisible: function (typeOld) {
						let currentTypeIsForActualSigningDate = typeOld 
							? typeOld.DwIsForActualSigningDate 
							: this.get("Type")?.DwIsForActualSigningDate;
						this.$IsDwActualSigningDateVisible = this.$IsDwActualContractSigningDateFeatureEnabled 
							&& currentTypeIsForActualSigningDate;
					},
					
					setIsDwActualSigningDateRequired: function (stateOld) {
						const stateId = stateOld ? stateOld.value : this.getLookupValue("State");
						const requiredStates = [
							WorkSalesBaseConstants.ContractState.Signed,
							WorkSalesBaseConstants.ContractState.ScanIsReceived
						];
						this.$IsDwActualSigningDateRequired = this.$IsDwActualSigningDateVisible 
							&& requiredStates.includes(stateId);
					},
					
					getActualSingingDateValidationMessage: function (isActualSigningDateEmpty) {
						return isActualSigningDateEmpty 
							? this.get("Resources.Strings.DwEmptyActualSigningDateMessage")
							: this.get("Resources.Strings.DwActualSingingDateLaterDateSignedMessage");
					},
					
					validateDwActualSigningDate: async function () {
						if (!this.get("StartDate") || !this.get("DwActualSigningDate")) {
							return true;
						}
						const actualSigningDate = new Date(this.get("DwActualSigningDate").setHours(0, 0, 0, 0));
						const startDate = new Date(this.get("StartDate").setHours(0, 0, 0, 0));
						const isActualSigningDateNotValid = actualSigningDate > startDate;
						
						if (!this.$IsDwActualContractSigningDateFeatureEnabled || !isActualSigningDateNotValid) {
							return true;
						}
						let config = {
							message: this.getActualSingingDateValidationMessage(actualSigningDate === null),
							context: this
						};
						await Dw8xClientHelperModule.showInformationDialog(config);
						return false;
					},

					setDwActualSigningDate: function () {
						const type = this.get("Type");
						if (!type || type.DwIsForActualSigningDate) {
							return;
						}
						this.set("DwActualSigningDate", this.get("StartDate"));
					}

				},
				businessRules: /**SCHEMA_BUSINESS_RULES*/{
					"EndDate": {
						"EnableEditingOnFixedDate": {
							"enabled": true,
							"removed": false,
							"ruleType": 0,
							"property": 1,
							"logical": 0,
							"conditions": [
								{
									"comparisonType": 3,
									"leftExpression": {
										"type": 1,
										"attribute": "FixedEndDate"
									},
									"rightExpression": {
										"type": 0,
										"value": true,
										"dataValueType": 12
									}
								}
							]
						}
					},
					"CurrencyRateOnStartDate": {
						"VisibleCurrencyRateOnStartDate": {
							"enabled": true,
							"removed": false,
							"ruleType": 0,
							"property": 0,
							"logical": 0,
							"conditions": [
								{
									"comparisonType": 3,
									"leftExpression": {
										"type": 1,
										"attribute": "Currency"
									},
									"rightExpression": {
										"type": 0,
										"value": "915e8a55-98d6-df11-9b2a-001d60e938c6",
										"dataValueType": 10
									}
								}
							]
						}
					}
				}/**SCHEMA_BUSINESS_RULES*/,
				modules: /**SCHEMA_MODULES*/{}/**SCHEMA_MODULES*/,
		dataModels: /**SCHEMA_DATA_MODELS*/{}/**SCHEMA_DATA_MODELS*/,
		diff: /**SCHEMA_DIFF*/[
			{
				"operation": "merge",
				"name": "PrintButton",
				"values": {
					"controlConfig": {
						"menu": {
							"items": {
								"bindTo": "WorkCardPrintMenuItems"
							}
						}
					},
					"visible": true,
					"enabled": true
				}
			},
			{
				"operation": "insert",
				"name": "StartDateContainer",
				"parentName": "Header",
				"propertyName": "items",
				"values": {
					"itemType": this.Terrasoft.ViewItemType.CONTAINER,
					"items": [],
					"layout": {
						"column": 0,
						"row": 2,
						"colSpan": 12,
						"rowSpan": 1
					}
				},
				"index": 2
			},
			{
				"operation": "merge",
				"name": "StartDate",
				"values": {
					"enabled": {
						"bindTo": "CanChangeSignDateOperation"
					},
					"visible": {
						"bindTo": "IsDwActualSigningDateVisible",
						"bindConfig": {
							"converter": "invertBooleanValue"
						}
					}
				}
			},
			{
				"operation": "move",
				"name": "StartDate",
				"parentName": "StartDateContainer",
				"propertyName": "items"
			}, 
			{
				"operation": "insert",
				"name": "ActualSigningDateContainer",
				"parentName": "StartDateContainer",
				"propertyName": "items",
				"values": {
					"itemType": this.Terrasoft.ViewItemType.GRID_LAYOUT,
					"items": [],
					"layout": {
						"column": 0,
						"row": 2,
						"colSpan": 12,
						"rowSpan": 1
					},
					"visible": {
						"bindTo": "IsDwActualSigningDateVisible"
					}
				},
				"index": 2
			},
			{
				"operation": "insert",
				"name": "StartDateEdit",
				"parentName": "ActualSigningDateContainer",
				"propertyName": "items",
				"values": {
					"layout": {
						"column": 0,
						"row": 0,
						"colSpan": 12,
						"rowSpan": 1
					},
					"bindTo": "StartDate",
					"enabled": {
						"bindTo": "CanChangeSignDateOperation"
					}
				}
			},
			{
				"operation": "insert",
				"name": "DwActualSigningDate",
				"parentName": "ActualSigningDateContainer",
				"propertyName": "items",
				"values": {
					"layout": {
						"column": 12,
						"row": 0,
						"colSpan": 12,
						"rowSpan": 1
					}
				}
			},
			{
				"operation": "insert",
				"name": "isCancellable60377a2d-89ef-482a-b5cb-98c5ee56b5c0",
				"values": {
					"layout": {
						"colSpan": 3,
						"rowSpan": 1,
						"column": 9,
						"row": 3,
						"layoutName": "Header"
					},
					"bindTo": "isCancellable",
					"enabled": true
				},
				"parentName": "Header",
				"propertyName": "items",
				"index": 7
			},
			{
				"operation": "insert",
				"name": "FixedEndDate",
				"values": {
					"layout": {
						"colSpan": 4,
						"rowSpan": 1,
						"column": 5,
						"row": 3,
						"layoutName": "Header"
					},
					"bindTo": "FixedEndDate"
				},
				"parentName": "Header",
				"propertyName": "items",
				"index": 8
			},
			{
				"operation": "merge",
				"name": "EndDate",
				"values": {
					"layout": {
						"colSpan": 5,
						"rowSpan": 1,
						"column": 0,
						"row": 3
					}
				}
			},
			{
				"operation": "insert",
				"name": "ContractParty",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 1,
						"column": 12,
						"row": 3,
						"layoutName": "Header"
					},
					"bindTo": "ContractParty"
				},
				"parentName": "Header",
				"propertyName": "items",
				"index": 10
			},
			{
				"operation": "merge",
				"name": "Amount",
				"values": {
					"layout": {
						"colSpan": 8,
						"rowSpan": 1,
						"column": 12,
						"row": 4
					}
				}
			},
			{
				"operation": "move",
				"name": "Amount",
				"parentName": "Header",
				"propertyName": "items",
				"index": 11
			},
			{
				"operation": "insert",
				"name": "ContractLength",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 1,
						"column": 0,
						"row": 4,
						"layoutName": "Header"
					},
					"bindTo": "ContractLength"
				},
				"parentName": "Header",
				"propertyName": "items",
				"index": 12
			},
			{
				"operation": "insert",
				"name": "CurrencyRateOnStartDate",
				"values": {
					"layout": {
						"colSpan": 6,
						"rowSpan": 1,
						"column": 12,
						"row": 5,
						"layoutName": "Header"
					},
					"bindTo": "CurrencyRateOnStartDate"
				},
				"parentName": "Header",
				"propertyName": "items",
				"index": 13
			},
			{
				"operation": "insert",
				"name": "OrderCurrencyRateOnSignedDate80301adb-bde3-4553-ae06-cfc02264b429",
				"values": {
					"layout": {
						"colSpan": 6,
						"rowSpan": 1,
						"column": 18,
						"row": 5,
						"layoutName": "Header"
					},
					"bindTo": "OrderCurrencyRateOnSignedDate",
					"enabled": false
				},
				"parentName": "Header",
				"propertyName": "items",
				"index": 14
			},
			{
				"operation": "merge",
				"name": "GeneralInfoTab",
				"values": {
					"order": 0
				}
			},
			{
				"operation": "merge",
				"name": "Account",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 1,
						"column": 0,
						"row": 0
					}
				}
			},
			{
				"operation": "move",
				"name": "Account",
				"parentName": "group_gridLayout",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "merge",
				"name": "CustomerBillingInfo",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 1,
						"column": 12,
						"row": 0
					}
				}
			},
			{
				"operation": "move",
				"name": "CustomerBillingInfo",
				"parentName": "group_gridLayout",
				"propertyName": "items",
				"index": 1
			},
			{
				"operation": "merge",
				"name": "OurCompany",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 1,
						"column": 0,
						"row": 1
					}
				}
			},
			{
				"operation": "move",
				"name": "OurCompany",
				"parentName": "group_gridLayout",
				"propertyName": "items",
				"index": 2
			},
			{
				"operation": "merge",
				"name": "Printable",
				"values": {
					"tip": {
						"content": {
							"bindTo": "Resources.Strings.Printable"
						}
					}
				}
			},
			{
				"operation": "move",
				"name": "Printable",
				"parentName": "group_gridLayout",
				"propertyName": "items",
				"index": 3
			},
			{
				"operation": "merge",
				"name": "SupplierBillingInfo",
				"values": {
					"layout": {
						"colSpan": 12,
						"rowSpan": 1,
						"column": 12,
						"row": 2
					}
				}
			},
			{
				"operation": "insert",
				"name": "SpecInContractDetail",
				"values": {
					"itemType": 2
				},
				"parentName": "GeneralInfoTab",
				"propertyName": "items",
				"index": 3
			},
			{
				"operation": "merge",
				"name": "ContractPassportTab",
				"values": {
					"order": 1
				}
			},
			{
				"operation": "merge",
				"name": "HistoryTab",
				"values": {
					"order": 2
				}
			},
			{
				"operation": "insert",
				"name": "SpecInContractHistoryDetail",
				"values": {
					"itemType": 2
				},
				"parentName": "HistoryTab",
				"propertyName": "items",
				"index": 4
			},
			{
				"operation": "merge",
				"name": "ContractVisaTab",
				"values": {
					"order": 3
				}
			},
			{
				"operation": "merge",
				"name": "NotesAndFilesTab",
				"values": {
					"order": 4
				}
			},
			{
				"operation": "merge",
				"name": "ESNTab",
				"values": {
					"order": 5
				}
			},
			{
				"operation": "move",
				"name": "Owner",
				"parentName": "Header",
				"propertyName": "items",
				"index": 4
			},
			{
				"operation": "move",
				"name": "Type",
				"parentName": "Header",
				"propertyName": "items",
				"index": 1
			},
			{
				"operation": "move",
				"name": "Number",
				"parentName": "Header",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "VwOrderProductGroupedByProductsAndPartnerDetail",
				"values": {
					"itemType": this.Terrasoft.ViewItemType.DETAIL,
					"visible": {
						"bindTo": "IsOrderProductGroupedByProductsAndPartnerDetailVisible"
					},
				},
				"parentName": "ContractPassportTab",
				"propertyName": "items",
				"index": 2
			},
		]/**SCHEMA_DIFF*/ ,
				rules: {
					"EndDate": {
						"EndDateRequired": {
							"ruleType": BusinessRuleModule.enums.RuleType.BINDPARAMETER,
							"property": BusinessRuleModule.enums.Property.REQUIRED,
							"conditions": [
								{
									"leftExpression": {
										"type": BusinessRuleModule.enums.ValueType.ATTRIBUTE,
										"attribute": "Type"
									},
									"comparisonType": Terrasoft.ComparisonType.EQUAL,
									"rightExpression": {
										"type": BusinessRuleModule.enums.ValueType.CONSTANT,
										"value": WorkSalesBaseConstants.ContractType.AmendmentAgreementPremierPartner
									}
								}
							]
						}
					},
					"SupplierBillingInfo": {
						"FiltrationSupplierBillingByIsActive": {
							"ruleType": BusinessRuleModule.enums.RuleType.FILTRATION,
							"autocomplete": true,
							"baseAttributePatch": "TsIsActive",
							"comparisonType": this.Terrasoft.ComparisonType.EQUAL,
							"type": BusinessRuleModule.enums.ValueType.CONSTANT,
							"value": true
						}
					},
					"CustomerBillingInfo": {
						"FiltrationCustomerBillingByIsActive": {
							"ruleType": BusinessRuleModule.enums.RuleType.FILTRATION,
							"autocomplete": true,
							"baseAttributePatch": "TsIsActive",
							"comparisonType": this.Terrasoft.ComparisonType.EQUAL,
							"type": BusinessRuleModule.enums.ValueType.CONSTANT,
							"value": true
						}
					},
					"DwActualSigningDate": {
						"DwActualSigningDateVisible": {
							"ruleType": BusinessRuleModule.enums.RuleType.BINDPARAMETER,
							"property": BusinessRuleModule.enums.Property.VISIBLE,
							"conditions": [
								{
									"leftExpression": {
										"type": BusinessRuleModule.enums.ValueType.ATTRIBUTE,
										"attribute": "IsDwActualSigningDateVisible"
									},
									"comparisonType": this.Terrasoft.ComparisonType.EQUAL,
									"rightExpression": {
										"type": BusinessRuleModule.enums.ValueType.CONSTANT,
										"value": true
									}
								}
							]
						},
						"DwActualSigningDateRequired": {
							"ruleType": BusinessRuleModule.enums.RuleType.BINDPARAMETER,
							"property": BusinessRuleModule.enums.Property.REQUIRED,
							"conditions": [
								{
									"leftExpression": {
										"type": BusinessRuleModule.enums.ValueType.ATTRIBUTE,
										"attribute": "IsDwActualSigningDateRequired"
									},
									"comparisonType": this.Terrasoft.ComparisonType.EQUAL,
									"rightExpression": {
										"type": BusinessRuleModule.enums.ValueType.CONSTANT,
										"value": true
									}
								}
							]
						}
					},
				}
			};
		});
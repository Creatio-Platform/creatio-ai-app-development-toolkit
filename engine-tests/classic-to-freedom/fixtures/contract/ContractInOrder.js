define("ContractPageV2", ["BusinessRuleModule", "ConfigurationConstants", "ConfigurationEnums"],
	function(BusinessRuleModule, ConfigurationConstants, enums) {
		return {
				entitySchemaName: "Contract",
				attributes: {
					"Order": {
						dataValueType: Terrasoft.DataValueType.LOOKUP,
						lookupListConfig: {
							columns: ["Currency", "Account"],
							filter: function() {
								var account = this.get("Account");
								if (!this.Ext.isEmpty(account)) {
									var filters = this.Terrasoft.createFilterGroup();
									filters.logicalOperation = this.Terrasoft.LogicalOperatorType.OR;
									filters.addItem(this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.EQUAL,
										"Account", account.value));
									filters.addItem(this.Terrasoft.createIsNullFilter(
										this.Ext.create("Terrasoft.ColumnExpression", {columnPath: "Account"})
									));
									return filters;
								}
							}
						}
					},
					"Currency": {
						dataValueType: Terrasoft.DataValueType.LOOKUP,
						lookupListConfig: {
							columns: ["Division", "Symbol"],
							filter: function() {
								var orderCurrency = this.get("Order");
								orderCurrency = orderCurrency && orderCurrency.Currency;
								var primaryCurrency = this.get("PrimaryCurrency");
								if (primaryCurrency && orderCurrency && orderCurrency.value !== primaryCurrency.value) {
									var filters = this.Terrasoft.createFilterGroup();
									filters.addItem(this.Terrasoft.createColumnInFilterWithParameters("Id",
											[orderCurrency.value, primaryCurrency.value]));
									return filters;
								}
							}
						},
						dependencies: [
							{
								columns: ["Order"],
								methodName: "orderChanged"
							}
						]
					}
				},
				messages: {
					/**
					 * @message GetPageInfo
					 * Возвращает информацию о странице.
					 * @param {Object} Информация о странице.
					 */
					"GetPageInfo": {
						mode: this.Terrasoft.MessageMode.PTP,
						direction: this.Terrasoft.MessageDirectionType.SUBSCRIBE
					}
				},
				details: /**SCHEMA_DETAILS*/{
					"Product": {
						"schemaName": "ContractProductDetailV2",
						"entitySchemaName": "OrderProduct",
						"filterMethod": "orderFilter"
					}
				}/**SCHEMA_DETAILS*/,
				methods: {
					/**
					 * @inheritdoc Terrasoft.BasePageV2#init
					 * @protected
					 * @overridden
					 */
					init: function() {
						this.callParent(arguments);
						this.initPrimaryCurrency();
						this.sandbox.subscribe("GetPageInfo", function() {
							return this;
						}, this, [this.getDetailId("Product")]);
					},

					/**
					 * Инициализация базовой валюты.
					 * @private
					 */
					initPrimaryCurrency: function() {
						this.Terrasoft.SysSettings.querySysSettingsItem("PrimaryCurrency", function(primaryCurrency) {
							this.set("PrimaryCurrency", primaryCurrency);
						}, this);
					},

					/**
					 * Обработка изменения поля "Заказ".
					 */
					orderChanged: function() {
						var order = this.get("Order");
						this.set("OrderChanged", true);
						if (order && order.Currency) {
							this.set("Currency", order.Currency);
						}
					},

					/**
					 * Постобработка сохранения.
					 */
					onSaved: function(response, config) {
						var isOrderChanged = this.get("OrderChanged");
						var isAdd = (this.get("Operation") === enums.CardStateV2.ADD);
						var isSilentSave = config && config.isSilent;
						var messageCaption = Ext.String.format(
								this.get("Resources.Strings.LinkProductCaption"),
								this.get("Number"));
						if ((config !== null) && (config !== undefined) && (config.recalc === true)) {
							this.callParent(arguments);
							this.set("OrderChanged", false);
							return;
						}
						if ((config !== null) && (config !== undefined) && (config.linked === true)) {
							this.calcAmount(function() {
								this.onSaved(response, Ext.apply(config || {}, {recalc: true}));
							}, this);
						} else {
							if (this.get("Order") && (isAdd || isOrderChanged) && !isSilentSave) {
								this.isOrderHasUnlinkedProducts(function(show) {
									if (!show) {
										this.onSaved(response, Ext.apply(config || {}, {linked: true}));
										return;
									}
									Terrasoft.utils.showMessage({
										caption: messageCaption,
										buttons: [{
											className: "Terrasoft.Button",
											returnCode: "ButtonAll",
											style: "blue",
											caption: this.get("Resources.Strings.QuestionAllCaption"),
											markerValue: this.get("Resources.Strings.QuestionAllCaption")
										}, {
											className: "Terrasoft.Button",
											returnCode: "ButtonChoice",
											style: Terrasoft.controls.ButtonEnums.style.GREY,
											caption: this.get("Resources.Strings.QuestionChoiceCaption"),
											markerValue: this.get("Resources.Strings.QuestionChoiceCaption")
										}, "cancel"],
										defaultButton: 0,
										style: Terrasoft.MessageBoxStyles.BLUE,
										handler: function(buttonCode) {
											if (buttonCode === "ButtonAll") {
												this.connectProducts(response, config);
											}
											if (buttonCode === "ButtonChoice") {
												this.openProductLookupToLink(response, config);
											}
											if (buttonCode === "cancel") {
												this.onSaved(response, Ext.apply(config || {}, {linked: true}));
											}
										},
										scope: this
									});
								}, this);
							} else {
								this.callParent(arguments);
							}
						}
					},

					/**
					 * Фильтрация продуктов из связанного заказа.
					 * @returns {Terrasoft.configuration.QuickSearchModule.getViewModel.methods.createFilterGroup}
					 */
					orderFilter: function() {
						var order =  this.get("Order");
						var id = this.get("Id");
						var orderId = this.Terrasoft.GUID_EMPTY;
						if (order && order.value) {
							orderId = order.value;
						}
						var filterGroup = new this.Terrasoft.createFilterGroup();
						filterGroup.logicalOperation = this.Terrasoft.LogicalOperatorType.AND;
						filterGroup.add("OrderFilter", this.Terrasoft.createColumnFilterWithParameter(
							this.Terrasoft.ComparisonType.EQUAL, "Order", orderId));
						filterGroup.add("ContractFilter", this.Terrasoft.createColumnFilterWithParameter(
							this.Terrasoft.ComparisonType.EQUAL, "Contract", id));
						return filterGroup;
					},

					/**
					 * Открывает справочник продуктов заказа для выбора записей,
					 * которые необходимо связать с текущим договором.
					 * @private
					 */
					openProductLookupToLink: function(responseOnSaved, configOnSaved) {
						var config = {
							entitySchemaName: "OrderProduct",
							multiSelect: true,
							columns: ["Name"]
						};
						var orderId = this.get("Order").value;
						var filters = this.Terrasoft.createFilterGroup();
						var idFilter = this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.EQUAL,
							"Order", orderId);
						var contractIsNull = this.Terrasoft.createColumnIsNullFilter("Contract");
						filters.addItem(idFilter);
						filters.addItem(contractIsNull);
						config.filters = filters;
						this.openLookup(config, function(response) {
							this.linkSelectedRecords(responseOnSaved, Ext.apply(response, configOnSaved));
						}, this);
					},

					/**
					 * Добавляет связи для выбранных продуктов с текущим договором.
					 * @param {Object} response Проброс из метода onSaved
					 * @param {Object} args Объект вида {columnName: string, selectedRows: []}.
					 * Содержит массив выбранных записей из справочника.
					 * @private
					 */
					linkSelectedRecords: function(response, args) {
						var selectedRows = args.selectedRows.getItems();
						var contractId = this.get(this.primaryColumnName) || this.get("MasterRecordId");
						var totalCount = selectedRows.length;
						var callsCount = 0;
						this.Terrasoft.each(selectedRows, function(item) {
							var update = this.Ext.create("Terrasoft.UpdateQuery", {
								rootSchemaName: "OrderProduct"
							});
							callsCount++;
							update.setParameterValue("Contract", contractId, this.Terrasoft.DataValueType.GUID);
							update.filters.addItem(this.Terrasoft.createColumnFilterWithParameter(
								this.Terrasoft.ComparisonType.EQUAL, "Id",  item.value));
							update.execute(function() {
								if (callsCount === totalCount) {
									this.onSaved(response, Ext.apply(args, {linked: true}));
								}
							}, this);
						}, this);
					},

					/**
					 * Связаывает продукты с текущим договором.
					 */
					connectProducts: function(response, config) {
						var contractId = this.get(this.primaryColumnName) || this.get("MasterRecordId");
						var orderId = this.get("Order");
						var update = this.Ext.create("Terrasoft.UpdateQuery", {
							rootSchemaName: "OrderProduct"
						});
						update.setParameterValue("Contract", contractId, this.Terrasoft.DataValueType.GUID);
						update.filters.addItem(this.Terrasoft.createColumnFilterWithParameter(
							this.Terrasoft.ComparisonType.EQUAL, "Order",  orderId.value));
						update.filters.addItem(this.Terrasoft.createColumnIsNullFilter("Contract"));
						update.execute(function() {
							this.onSaved(response, Ext.apply(config || {}, {linked: true}));
						}, this);
					},

					/**
					 * Проверяет наличие непривязанных продуктов к договорам.
					 */
					isOrderHasUnlinkedProducts: function(callback) {
						var orderId = this.get("Order");
						var select = this.Ext.create("Terrasoft.EntitySchemaQuery", {
							rootSchemaName: "OrderProduct"
						});
						select.filters.addItem(this.Terrasoft.createColumnFilterWithParameter(
							this.Terrasoft.ComparisonType.EQUAL, "Order",  orderId.value));
						select.filters.addItem(this.Terrasoft.createColumnIsNullFilter("Contract"));
						select.execute(function(response) {
							if (response && response.success) {
								if (response.collection.getCount() > 0) {
									callback.call(this, true);
								} else {
									callback.call(this, false);
								}
							}
						}, this);
					}
				},
				diff: /**SCHEMA_DIFF*/[
					{
						"operation": "insert",
						"name": "Order",
						"values": {
							"bindTo": "Order",
							"layout": {
								"column": 12,
								"row": 0
							},
							"tip": {
								"content": {"bindTo": "Resources.Strings.OrderTip"}
							},
							enabled: true
						},
						"parentName": "ContractConnectionsBlock",
						"propertyName": "items",
						"index": 0
					},
					{
						"operation": "insert",
						"name": "ContractPassportTab",
						"values": {
							"items": [],
							"caption": {
								"bindTo": "Resources.Strings.ContractPassportTab"
							}
						},
						"parentName": "Tabs",
						"propertyName": "tabs",
						"index": 1
					},
					{
						"operation": "insert",
						"name": "Product",
						"values": {
							"itemType": this.Terrasoft.ViewItemType.DETAIL
						},
						"parentName": "ContractPassportTab",
						"propertyName": "items",
						"index": 1
					},
					{
						"operation": "merge",
						"name": "HistoryTab",
						"values": {
							"caption": {
								"bindTo": "Resources.Strings.HistoryTab"
							}
						},
						"parentName": "Tabs",
						"propertyName": "tabs",
						"index": 2
					},
					{
						"operation": "merge",
						"name": "ContractVisaTab",
						"parentName": "Tabs",
						"propertyName": "tabs",
						"values": {
							"caption": {"bindTo": "Resources.Strings.ContractVisaTabCaption"}
						},
						"index": 3
					},
					{
						"operation": "merge",
						"name": "NotesAndFilesTab",
						"values": {
							"caption": {
								"bindTo": "Resources.Strings.NotesAndFilesTab"
							}
						},
						"parentName": "Tabs",
						"propertyName": "tabs",
						"index": 4
					}
				]/**SCHEMA_DIFF*/,
				rules: {
					"CurrencyRate": {
						"EnabledCurrencyRateByCurrency": {
							"ruleType": BusinessRuleModule.enums.RuleType.BINDPARAMETER,
							"property": BusinessRuleModule.enums.Property.ENABLED,
							"conditions": [
								{
									"leftExpression": {
										"type": BusinessRuleModule.enums.ValueType.ATTRIBUTE,
										"attribute": "Currency"
									},
									"comparisonType": Terrasoft.ComparisonType.NOT_EQUAL,
									"rightExpression": {
										"type": BusinessRuleModule.enums.ValueType.SYSSETTING,
										"value": "PrimaryCurrency"
									}
								}
							]
						}
					},
					"Account": {
						"FiltrationAccountByOrder": {
							"ruleType": BusinessRuleModule.enums.RuleType.FILTRATION,
							"autocomplete": false,
							"autoClean": false,
							"baseAttributePatch": "Id",
							"comparisonType": Terrasoft.ComparisonType.EQUAL,
							"type": BusinessRuleModule.enums.ValueType.ATTRIBUTE,
							"attribute": "Order",
							"attributePath": "Account"
						}
					}
				}
			};
	});

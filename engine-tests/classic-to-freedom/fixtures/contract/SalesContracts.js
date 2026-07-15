define("ContractPageV2", ["MoneyModule", "BusinessRuleModule", "ConfigurationConstants", "ConfigurationEnums",
		"LookupUtilities", "MultiCurrencyEdit", "MultiCurrencyEditUtilities", "EntityProductCountMixin"],
	function(MoneyModule, BusinessRuleModule, ConfigurationConstants, enums, LookupUtilities) {
		return {
			entitySchemaName: "Contract",
			messages: {
				/**
				 * @message CalcAmount
				 * Сообщает карточке о необходимости пересчета суммы.
				 */
				"CalcAmount": {
					mode: this.Terrasoft.MessageMode.PTP,
					direction: this.Terrasoft.MessageDirectionType.SUBSCRIBE
				}
			},
			mixins: {

				/**
				 * Миксин управления мультивалютностью в карточке редактирования.
				 */
				MultiCurrencyEditUtilities: "Terrasoft.MultiCurrencyEditUtilities",

				/**
				 * Mixin for products count by entity.
				 */
				EntityProductCountMixin: "Terrasoft.EntityProductCountMixin"
			},
			details: /**SCHEMA_DETAILS*/{
				"SubordinateContracts": {
					"schemaName": "ContractDetailV2",
					"entitySchemaName": "Contract",
					"filter": {
						"masterColumn": "Id",
						"detailColumn": "Parent"
					},
					defaultValues: {
						Account: {
							"masterColumn": "Account"
						},
						Contact: {
							"masterColumn": "Contact"
						},
						CustomerBillingInfo: {
							"masterColumn": "CustomerBillingInfo"
						},
						OurCompany: {
							"masterColumn": "OurCompany"
						},
						SupplierBillingInfo: {
							"masterColumn": "SupplierBillingInfo"
						},
						Type: {
							"masterColumn": "DefaultType"
						},
						Order: {
							"masterColumn": "Order"
						}
					}
				}
			}/**SCHEMA_DETAILS*/,
			attributes: {
				/**
				 * Тип по умолчанию.
				 */
				"DefaultType": {
					"type": this.Terrasoft.ViewModelColumnType.VIRTUAL_COLUMN,
					"dataValueType": Terrasoft.DataValueType.LOOKUP
				},
				/**
				 * Валюта.
				 */
				"Currency": {
					"dataValueType": this.Terrasoft.DataValueType.LOOKUP,
					"lookupListConfig": {
						"columns": ["Division"]
					}
				},
				/**
				 * Курс.
				 */
				"CurrencyRate": {
					"dataValueType": this.Terrasoft.DataValueType.FLOAT,
					"dependencies": [
						{
							"columns": ["Currency"],
							"methodName": "setCurrencyRate"
						}
					]
				},
				/**
				 * Currency button menu list.
				 */
				"CurrencyButtonMenuList": {
					dataValueType: this.Terrasoft.DataValueType.COLLECTION,
					value: this.Ext.create("Terrasoft.BaseViewModelCollection")
				},
				/**
				 * Currency rate list.
				 */
				"CurrencyRateList": {
					dataValueType: this.Terrasoft.DataValueType.COLLECTION,
					value: this.Ext.create("Terrasoft.Collection")
				},
				/**
				 * Сумма.
				 */
				"Amount": {
					"dataValueType": this.Terrasoft.DataValueType.FLOAT,
					"dependencies": [
						{
							"columns": ["CurrencyRate", "Currency"],
							"methodName": "recalculateAmount"
						}
					]
				},
				/**
				 * Сумма в б.в.
				 */
				"PrimaryAmount": {
					"dependencies": [
						{
							"columns": ["Amount"],
							"methodName": "recalculatePrimaryAmount"
						}
					]
				},
				/**
				 * Родительский договор.
				 */
				"Parent": {
					"dependencies": [
						{
							"columns": ["Type"],
							"methodName": "parentChanged"
						}
					]
				},
				/**
				 * Тип.
				 */
				"Type": {
					"dataValueType": this.Terrasoft.DataValueType.LOOKUP,
					"lookupListConfig": {
						"columns": ["IsSlave"]
					}
				},
				/**
				 * Подчиненный.
				 */
				"CheckSlave": {
					"type": this.Terrasoft.ViewModelColumnType.VIRTUAL_COLUMN,
					"dataValueType": this.Terrasoft.DataValueType.BOOLEAN
				},
				/**
				 * Возможность редактирвоания сумм.
				 */
				"CanAmountEdit": {
					"type": this.Terrasoft.ViewModelColumnType.VIRTUAL_COLUMN,
					"dataValueType": this.Terrasoft.DataValueType.BOOLEAN,
					"value": true
				},
				/**
				 * Количество продуктов в текущем договоре.
				 */
				"ProductsCount": {
					type: Terrasoft.ViewModelColumnType.ENTITY_COLUMN,
					dataValueType: Terrasoft.DataValueType.INTEGER
				}
			},
			diff: /**SCHEMA_DIFF*/[
				{
					"operation": "merge",
					"name": "group",
					"values": {
						"itemType": this.Terrasoft.ViewItemType.CONTROL_GROUP,
						"caption": {
							"bindTo": "Resources.Strings.groupCaption"
						},
						"controlConfig": {
							"collapsed": false
						}
					},
					"parentName": "GeneralInfoTab",
					"propertyName": "items",
					"index": 0
				},
				{
					"operation": "merge",
					"name": "StartDate",
					"values": {
						"layout": {
							"column": 0,
							"row": 2,
							"colSpan": 12,
							"rowSpan": 1
						},
						"bindTo": "StartDate",
						"labelConfig": {
							"visible": true
						},
						"enabled": true
					},
					"dependencies": [
						{
							"columns": ["StartDate"],
							"methodName": "onDataAttributeChange"
						}
					],
					"parentName": "Header",
					"propertyName": "items",
					"index": 2
				},
				{
					"operation": "insert",
					"parentName": "GeneralInfoTab",
					"name": "ContractSumGroup",
					"propertyName": "items",
					"values": {
						"itemType": this.Terrasoft.ViewItemType.CONTROL_GROUP,
						"caption": {
							"bindTo": "Resources.Strings.ContractSumCaption"
						},
						"controlConfig": {
							"collapsed": false
						},
						"items": []
					},
					"index": 1
				},
				{
					"operation": "insert",
					"parentName": "ContractSumGroup",
					"propertyName": "items",
					"name": "ContractSumBlock",
					"values": {
						"itemType": this.Terrasoft.ViewItemType.GRID_LAYOUT,
						"items": []
					}
				},
				{
					"operation": "insert",
					"parentName": "ContractSumBlock",
					"propertyName": "items",
					"name": "Amount",
					"values": {
						"bindTo": "Amount",
						"layout": {"column": 0, "row": 0},
						"primaryAmount": "PrimaryAmount",
						"currency": "Currency",
						"rate": "CurrencyRate",
						"primaryAmountEnabled": false,
						"enabled": {"bindTo": "CanAmountEdit"},
						"generator": "MultiCurrencyEditViewGenerator.generate",
						"tip": {
							"content": {"bindTo": "Resources.Strings.AmountTip"}
						}
					}
				},
				{
					"operation": "merge",
					"name": "Parent",
					"values": {
						"bindTo": "Parent",
						"layout": {
							"column": 0,
							"row": 0
						},
						"controlConfig": {
							"enabled": {"bindTo": "CheckSlave"}
						}
					},
					"parentName": "ContractConnectionsBlock",
					"propertyName": "items",
					"index": 0
				},
				{
					"operation": "merge",
					"name": "SubordinateContracts",
					"values": {
						"itemType": this.Terrasoft.ViewItemType.DETAIL
					},
					"parentName": "GeneralInfoTab",
					"propertyName": "items",
					"index": 3
				},
				{
					"operation": "merge",
					"name": "Type",
					"values": {
						"enabled": {"bindTo": "canChange"}
					},
					"parentName": "Header",
					"propertyName": "items",
					"index": 3
				}
			]/**SCHEMA_DIFF*/,
			properties: {
				moneyModule: null
			},
			methods: {
				/**
				 * @inheritdoc Terrasoft.BasePageV2#init
				 * @overridden
				 */
				init: function() {
					this.sandbox.subscribe("CalcAmount", this.calcAmount, this);
					this.moneyModule = MoneyModule;
					this.callParent(arguments);
				},

				/**
				 * @inheritdoc Terrasoft.EntityProductCountMixin#getEntityProductSchemaName
				 * @overridden
				 */
				getEntityProductSchemaName: function() {
					return "OrderProduct";
				},

				/**
				 * @inheritdoc Terrasoft.BaseViewModel#loadEntity
				 * @overriden
				 */
				loadEntity: function(primaryColumnValue, callback, scope) {
					scope = scope || this;
					this.callParent([primaryColumnValue, function() {
						this.setProductCount(primaryColumnValue, callback, scope);
					}, scope]);
				},

				/**
				 * @inheritdoc Terrasoft.BasePageV2#onEntityInitialized
				 * @overridden
				 */
				onEntityInitialized: function() {
					this.setDefaultType();
					if (this.get("Amount") > 0 && this.get("ProductsCount") > 0) {
						this.set("CanAmountEdit", false);
					}
					this.recalculateAmount();
					this.callParent(arguments);
					this.mixins.MultiCurrencyEditUtilities.init.call(this);
				},

				/**
				 * Sets default contract type value.
				 */
				setDefaultType: function() {
					this.set("DefaultType",
						{
							value: ConfigurationConstants.ContractType.SubAgreement,
							displayValue: ""
						});
					this.parentChanged("", "Type");
				},

				/**
				 * Открывает страницу выбора из справочника.
				 * @override
				 * @param {Object} args Параметры.
				 * @param {Object} tag Тег.
				 */
				loadVocabulary: function(args, tag) {
					var config = this.getLookupPageConfig(args, tag);
					var select = this.Ext.create("Terrasoft.EntitySchemaQuery", {
						rootSchemaName: this.entitySchemaName
					});
					if (tag === "Parent") {
						var filterGroup = new this.Terrasoft.createFilterGroup();
						filterGroup.logicalOperation = this.Terrasoft.LogicalOperatorType.OR;
						filterGroup.addItem(select.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.NOT_EQUAL,
							"Parent", this.get("Id")));
						filterGroup.addItem(this.Terrasoft.createColumnIsNullFilter("Parent"));
						config.filters.addItem(filterGroup);
						config.filters.addItem(this.Terrasoft.createColumnFilterWithParameter(
							this.Terrasoft.ComparisonType.EQUAL, "Type.IsSlave", false));
					}
					LookupUtilities.Open(this.sandbox, config, this.onLookupResult, this, null, false, false);
				},

				/**
				* Предлагает установить валюту согласно введеной дате.
				* @private
				*/
				onDataAttributeChange: function() {
					var currency = this.get("Currency");
					this.Terrasoft.SysSettings.querySysSettingsItem("PrimaryCurrency", function(primaryCurrency) {
						if (currency) {
							if (currency.value !== primaryCurrency.value && !Ext.isEmpty(this.get("StartDate")) &&
									!Ext.isEmpty(currency.value)) {
								this.showConfirmationDialog(this.get("Resources.Strings.CurrencyRateDateQuestion"),
										function(returnCode) {
											if (returnCode === this.Terrasoft.MessageBoxButtons.YES.returnCode) {
												this.setCurrencyRate();
											}
										}, ["yes", "no"]);
							} else {
								this.setCurrencyRate();
							}
						}
					}, this);
				},

				/**
				 * Блокирует изменение типа при заданных условиях.
				 * @private
				 */
				canChange: function() {
					var cardState = this.get("Operation");
					if (this.get("Type")) {
						var isSlave = this.get("Type").IsSlave;
						var edit = (cardState === enums.CardStateV2.EDIT);
						if (edit && !isSlave) {
							return false;
						} else {
							return true;
						}
					}
				},

				/**
				* Устанавливает курс валюты.
				* @private
				*/
				setCurrencyRate: function() {
					this.moneyModule.LoadCurrencyRate.call(this, "Currency", "CurrencyRate", this.get("StartDate"));
				},

				/**
				 * Устанавливает сумму.
				 * @private
				 */
				recalculateAmount: function() {
					var currency = this.get("Currency");
					var division = currency ? currency.Division : null;
					this.moneyModule.RecalcCurrencyValue.call(this, "CurrencyRate", "Amount", "PrimaryAmount", division);
				},

				/**
				* Устанавливает сумму б.в.
				* @private
				*/
				recalculatePrimaryAmount: function() {
					var currency = this.get("Currency");
					var division = currency ? currency.Division : null;
					this.moneyModule.RecalcBaseValue.call(this, "CurrencyRate", "Amount", "PrimaryAmount", division);
				},

				/**
				* Меняет состояние "Родительского договора" в зависимости от выбранного типа.
				* @private
				*/
				parentChanged: function() {
					var type = this.get("Type");
					var isSlave = type && type.IsSlave;
					if (isSlave === false || ((isSlave === undefined) && (this.get("IsEntityInitialized") === false))) {
						this.set("CheckSlave", false);
						this.clearParent();
					} else {
						this.set("CheckSlave", true);
					}
				},

				/**
				 * Пересчитывает сумму в зависимости от продуктов.
				 */
				calcAmount: function(callback, scope) {
					var select = this.Ext.create("Terrasoft.EntitySchemaQuery", {
						rootSchemaName: "OrderProduct"
					});
					select.addAggregationSchemaColumn("TotalAmount", Terrasoft.AggregationType.SUM, "TotalAmountSum");
					select.addAggregationSchemaColumn("TotalAmount", Terrasoft.AggregationType.COUNT, "TotalAmountCount");
					select.filters = this.orderFilter();
					select.getEntityCollection(function(response) {
						if (response.success && response.collection) {
							var items = response.collection.getItems();
							if (items.length > 0) {
								if (items[0].get("TotalAmountCount") > 0) {
									this.set("Amount", items[0].get("TotalAmountSum"));
									this.set("CanAmountEdit", false);
								} else {
									this.set("Amount", 0);
									this.set("CanAmountEdit", true);
								}
								this.saveEntity(this.Terrasoft.emptyFn);
							}
							if (typeof callback === "function") {
								callback.call(scope || this);
							}
						}
					}, this);
				}
			}
		};
	});

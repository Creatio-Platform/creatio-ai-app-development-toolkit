define("ContractPageV2", ["BusinessRuleModule", "ConfigurationConstants", "MultiCurrencyEdit",
		"MultiCurrencyEditUtilities", "RefreshFieldsFromEntityMixin"],
	function(BusinessRuleModule, ConfigurationConstants) {
		return {
			entitySchemaName: "Contract",
			messages: {
				/**
				 * @message RefreshARRDataAndProductDetail
				 * Refresh Contract page and Product detail after OrderProduct saving
				 */
				"RefreshARRDataAndProductDetail": {
					mode: this.Terrasoft.MessageMode.PTP,
					direction: this.Terrasoft.MessageDirectionType.SUBSCRIBE
				},
				/**
				 * @message RefreshARRData
				 * Refresh Contract page after OrderProduct saving
				 */
				"RefreshARRData": {
					mode: this.Terrasoft.MessageMode.PTP,
					direction: this.Terrasoft.MessageDirectionType.SUBSCRIBE
				},
				/**
				 * @message RefreshContractPage
				 * Refresh Contract page after OrderProduct saving
				 */
				"DetailChanged": {
					mode: this.Terrasoft.MessageMode.PTP,
					direction: this.Terrasoft.MessageDirectionType.SUBSCRIBE
				}
			},
			mixins: {
				/**
				 * Миксин управления мультивалютностью в карточке редактирования.
				 */
				MultiCurrencyEditUtilities: "Terrasoft.MultiCurrencyEditUtilities",
				RefreshFieldsFromEntityMixin: "Terrasoft.RefreshFieldsFromEntityMixin"
			},
			details: /**SCHEMA_DETAILS*/ {} /**SCHEMA_DETAILS*/ ,
			attributes: {
				/**
				 * Валюта
				 */
				"Currency": {
					lookupListConfig: {
						filter: function() {
							var orderCurrency = this.get("Order");
							orderCurrency = orderCurrency && orderCurrency.Currency;
							if (!orderCurrency) {
								return;
							}
							var primaryCurrency = this.get("PrimaryCurrency");
							if (orderCurrency.value !== primaryCurrency.value) {
								var filters = this.Terrasoft.createFilterGroup();
								filters.addItem(this.Terrasoft.createColumnInFilterWithParameters("Id", [
									orderCurrency.value, primaryCurrency.value
								]));
								return filters;
							}
						}
					},
					isRequired: true
				},
				"OurCompany": {
					dependencies: [{
						columns: ["OurCompany"],
						methodName: "onOurCompanyChanged"
					}]
				}
			},
			methods: {
				/**
				 * Prevent page from navigating back when saving/adding.
				 * @private
				 */
				 _disableAutomaticalCloseAfterSave: function(config) {
					config.isSilent = true;
				},

				/**
				 * @inheritDoc BasePageV2#getLookupPageConfig
				 * @overridden
				 */
				getLookupPageConfig: function(args, columnName) {
					var config = this.callParent(arguments);
					if (columnName === "CustomerBillingInfo" || columnName === "SupplierBillingInfo") {
						config.hideActions = true;
					}
					return config;
				},

				/**
				 * @inheritDoc BasePageV2#onSaved
				 * @overridden
				 */
				 onSaved: function() {
					var config = arguments[1] || (arguments[1] = {});
					this._disableAutomaticalCloseAfterSave(config);
					this.callParent(arguments);
				},

				recalculateAmount: function() {
					return;
					//var currency = this.get("Currency");
					//var division = currency ? currency.Division : null;
					//MoneyModule.RecalcCurrencyValue.call(this, "CurrencyRate", "Amount", "PrimaryAmount", division);
				},

				/**
				 * @inheritdoc Terrasoft.BasePageV2#init
				 * @overridden
				 */
				init: function() {
					this.callParent(arguments);
					this.initPrimaryCurrency();
				},

				refreshValuesOnOrderProductSaved: function() {
					this.refreshFields(["Amount", "ContractLength", "EndDate", "ACV", "TCV"]);
					this.updateDetail({detail: "Product"});
				},

				refreshValuesOnContractProductSaved: function() {
					this.refreshFields(["Amount", "ContractLength", "EndDate", "ACV", "TCV"]);
				},

				/**
				 * Установка свойства "Валюта по умолчанию" из системной настройки.
				 * @protected
				 */
				initPrimaryCurrency: function() {
					this.Terrasoft.SysSettings.querySysSettingsItem("PrimaryCurrency", function(primaryCurrency) {
						this.set("PrimaryCurrency", primaryCurrency);
					}, this);
				},

				/**
				 * @inheritdoc Terrasoft.BaseSchemaViewModel#initTypeColumnName
				 * @overridden
				 */
				initTypeColumnName: function() {
					this.set("TypeColumnName", "Type");
				},

				/**
				 * Возвращает видимость кнопки "Печать".
				 * @protected
				 */
				IsCardPrintButtonVisible: function() {
					var contractType = this.get("Type");
					if (contractType && contractType.value === ConfigurationConstants.ContractType.Act.toLowerCase()) {
						if (this.get("SupplierBillingInfo")) {
							if (this.get("CustomerBillingInfo")) {
								return true;
							}
							return false;
						}
						return false;
					}
					return true;
				},

				onOurCompanyChanged: function() {
					if (!this.get("Supplier")) {
						this.set("SupplierBillingInfo", null);
					}
				},

				/**
				 * @inheritdoc BasePageV2#getIncrementCode
				 * @overridden
				 */
				getIncrementCode: function(callback, scope) {
					var data = {
						sysSettingName: this.entitySchemaName + this.get("Resources.Strings.IncrementNumberSuffix"),
						sysSettingMaskName: this.entitySchemaName + this.get("Resources.Strings.IncrementMaskSuffix")
					};
					this.callServiceMethod("SysSettingsService", "GetIncrementValueVsMask", function(response) {
						var number = Ext.Date.format(new Date(), "d/m/y-") + response.GetIncrementValueVsMaskResult;
						callback.call(this, number);
					}, data, scope || this);
				},

				/**
				 * @inheritdoc Terrasoft.BasePageV2#subscribeSandboxEvents
				 * @overridden
				 */
				subscribeSandboxEvents: function() {
					this.callParent(arguments);
					this.sandbox.subscribe("RefreshARRData", this.refreshValuesOnContractProductSaved, this);
					this.sandbox.subscribe("RefreshARRDataAndProductDetail", this.refreshValuesOnOrderProductSaved, this);
				}
			},
			diff: /**SCHEMA_DIFF*/ [{
					"operation": "remove",
					"parentName": "GeneralInfoTab",
					"name": "ContractSumGroup"
				}, {
					"operation": "remove",
					"parentName": "GeneralInfoTab",
					"name": "Contact"
				}, {
					"operation": "move",
					"name": "Number",
					"parentName": "Header",
					"propertyName": "items",
					"values": {
						"layout": {
							"column": 7,
							"row": 0,
							"colSpan": 5,
							"rowSpan": 1
						}
					}
				}, {
					"operation": "move",
					"name": "Type",
					"parentName": "Header",
					"propertyName": "items",
					"values": {
						"layout": {
							"column": 0,
							"row": 0,
							"colSpan": 7,
							"rowSpan": 1
						}
					}
				}, {
					"operation": "move",
					"name": "Order",
					"parentName": "Header",
					"propertyName": "items",
					"values": {
						"layout": {
							"column": 0,
							"row": 1,
							"colSpan": 12,
							"rowSpan": 1
						}
					}
				}, {
					"operation": "move",
					"name": "StartDate",
					"parentName": "Header",
					"propertyName": "items",
					"values": {
						"layout": {
							"column": 0,
							"row": 2,
							"colSpan": 12,
							"rowSpan": 1
						}
					}
				}, {
					"operation": "move",
					"name": "EndDate",
					"parentName": "Header",
					"propertyName": "items",
					"values": {
						"layout": {
							"column": 0,
							"row": 3,
							"colSpan": 12,
							"rowSpan": 1
						}
					}
				}, {
					"operation": "move",
					"name": "Parent",
					"parentName": "Header",
					"propertyName": "items",
					"values": {
						"layout": {
							"column": 12,
							"row": 0,
							"colSpan": 12,
							"rowSpan": 1
						}
					}
				}, {
					"operation": "move",
					"name": "Owner",
					"parentName": "Header",
					"propertyName": "items",
					"values": {
						"layout": {
							"column": 12,
							"row": 1,
							"colSpan": 12,
							"rowSpan": 1
						}
					}
				}, {
					"operation": "move",
					"name": "State",
					"parentName": "Header",
					"propertyName": "items",
					"values": {
						"layout": {
							"column": 12,
							"row": 2,
							"colSpan": 12,
							"rowSpan": 1
						}
					}
				}, {
					"operation": "insert",
					"parentName": "Header",
					"propertyName": "items",
					"name": "Amount",
					"values": {
						"bindTo": "Amount",
						"layout": {
							"column": 12,
							"row": 3,
							"colSpan": 12,
							"rowSpan": 1
						},
						"primaryAmount": "PrimaryAmount",
						"currency": "Currency",
						"rate": "CurrencyRate",
						"primaryAmountEnabled": false,
						"enabled": {
							"bindTo": "CanAmountEdit"
						},
						"generator": "MultiCurrencyEditViewGenerator.generate",
						"tip": {
							"content": {
								"bindTo": "Resources.Strings.AmountTip"
							}
						}
					}
				},
				//{
				//	"operation": "insert",
				//	"parentName": "Header",
				//	"propertyName": "items",
				//	"name": "TaxAmount",
				//	"values": {
				//		"bindTo": "TaxAmount",
				//		"layout": {"column": 12, "row": 4},
				//		"primaryAmount": "PrimaryTaxAmount",
				//		"currency": "Currency",
				//		"rate": "CurrencyRate",
				//		"primaryAmountEnabled": false,
				//		"generator": "MultiCurrencyEditViewGenerator.generate"
				//	}
				//},
				//{
				//	"operation": "insert",
				//	"parentName": "Header",
				//	"propertyName": "items",
				//	"name": "AmountWithoutTax",
				//	"values": {
				//		"bindTo": "AmountWithoutTax",
				//		"layout": {"column": 12, "row": 5},
				//		"primaryAmount": "PrimaryAmountWithoutTax",
				//		"currency": "Currency",
				//		"rate": "CurrencyRate",
				//		"primaryAmountEnabled": false,
				//		"generator": "MultiCurrencyEditViewGenerator.generate"
				//	}
				//},
				{
					"operation": "move",
					"name": "Account",
					"parentName": "group_gridLayout",
					"propertyName": "items",
					"values": {
						"layout": {
							"column": 0,
							"row": 0
						}
					}
				}, {
					"operation": "move",
					"name": "OurCompany",
					"parentName": "group_gridLayout",
					"propertyName": "items",
					"values": {
						"layout": {
							"column": 0,
							"row": 1
						}
					},
					"index": 2
				}, {
					"operation": "insert",
					"parentName": "group_gridLayout",
					"propertyName": "items",
					"name": "Printable",
					"values": {
						"bindTo": "Printable",
						"layout": {
							"column": 0,
							"row": 2,
							"colSpan": 12,
							"rowSpan": 1
						}
					},
					"index": 2
				}, {
					"operation": "move",
					"name": "CustomerBillingInfo",
					"parentName": "group_gridLayout",
					"propertyName": "items",
					"values": {
						"layout": {
							"column": 12,
							"row": 0
						},
						"contentType": this.Terrasoft.ContentType.LOOKUP
					}
				}, {
					"operation": "merge",
					"name": "SupplierBillingInfo",
					"parentName": "group_gridLayout",
					"values": {
						"layout": {
							"column": 12,
							"row": 2
						},
						"contentType": this.Terrasoft.ContentType.LOOKUP
					}
				}
			] /**SCHEMA_DIFF*/ ,
			rules: {
				"Currency": {
					"EnabledCurrencyRateByOrder": {
						"ruleType": BusinessRuleModule.enums.RuleType.BINDPARAMETER,
						"property": BusinessRuleModule.enums.Property.VISIBLE,
						"conditions": [{
							"leftExpression": {
								"type": BusinessRuleModule.enums.ValueType.CONSTANT,
								"value": true
							},
							"comparisonType": this.Terrasoft.ComparisonType.EQUAL,
							"rightExpression": {
								"type": BusinessRuleModule.enums.ValueType.CONSTANT,
								"value": true
							}
						}]
					}
				},
				"Account": {
					"FiltrationAccountByOrder": {
						"removed": true
					}
				}
			}
		};
	});
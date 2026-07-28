define("ContractPageV2", [], function() {
	return {
		entitySchemaName: "Contract",
		attributes: {
			"CustomerBillingInfo": {
				"dataValueType": this.Terrasoft.DataValueType.LOOKUP,
				"lookupListConfig": {
					"columns": ["LegalEntity", "Account"], 
					"filters": [ 
						function() {
							return this.getBillingInfoFilters();
						}
					]
				},
				"dependencies": [
					{
						columns: ["Account"],
						methodName: "onAccountChanged"
					}
				]
			},
			"LegalEntity": {
				"dataValueType": this.Terrasoft.DataValueType.LOOKUP,
				"type": this.Terrasoft.ViewModelColumnType.VIRTUAL_COLUMN
			},
			"Account": {
				"dependencies": [
					{
						columns: ["CustomerBillingInfo"],
						methodName: "onCustomerBillingInfoChanged"
					}
				]
			}
		},
		modules: /**SCHEMA_MODULES*/{}/**SCHEMA_MODULES*/,
		details: /**SCHEMA_DETAILS*/{}/**SCHEMA_DETAILS*/,
		businessRules: /**SCHEMA_BUSINESS_RULES*/{}/**SCHEMA_BUSINESS_RULES*/,
		methods: {
			onEntityInitialized: function() {
				this.callParent(arguments);
				this.setLegalEntity();
			},
			onCustomerBillingInfoChanged: function() {
				var billingInfoAccount = this.$CustomerBillingInfo && this.$CustomerBillingInfo.Account;
				if(billingInfoAccount && billingInfoAccount.value != this.getLookupValue("Account")) {
					this.set("Account", billingInfoAccount);
				}
			},
			onAccountChanged: function() {
				const accountValue = this.getLookupValue("Account");
				const previousAccountValue = this.getPrevious("Account");
				if(previousAccountValue && accountValue == previousAccountValue.value) {
					return;
				}
				if(!accountValue) {
					this.set("CustomerBillingInfo", null);
				} else {
					this.setCustomerBillingInfoFromAccount();
				}
			},
			setCustomerBillingInfoFromAccount: function() {
				var esq = Ext.create("Terrasoft.EntitySchemaQuery", {
					rootSchemaName: "AccountBillingInfo"
				});
				esq.filters.add("AccountFilter", this.Terrasoft.createColumnFilterWithParameter(this.Terrasoft.ComparisonType.EQUAL, "Account", this.getLookupValue("Account")));
				esq.getEntityCollection(function(result) {
					if (result.success && result.collection && result.collection.getCount() == 1) {
						var entity = result.collection.getByIndex(0);
						this.loadLookupDisplayValue("CustomerBillingInfo", entity.get("Id"))
					} else {
						this.set("CustomerBillingInfo", null);
					}
				}, this);
			},
			getBillingInfoFilters: function() {
				var accountValue = this.getLookupValue("Account");
				var filterGroup = Ext.create("Terrasoft.FilterGroup");
				if(accountValue) {
					filterGroup.add("AccountFilter", Terrasoft.createColumnFilterWithParameter(Terrasoft.ComparisonType.EQUAL,
							"Account", accountValue ));
				}
				return filterGroup;
			},
			setLegalEntity: function() {
				var customerBillingInfo = this.get("CustomerBillingInfo");
				var legalEntity = !this.Terrasoft.isEmpty(customerBillingInfo)
					? customerBillingInfo.LegalEntity
					: null;
				this.set("LegalEntity", legalEntity);
			}
		},
		dataModels: /**SCHEMA_DATA_MODELS*/{}/**SCHEMA_DATA_MODELS*/,
		diff: /**SCHEMA_DIFF*/[]/**SCHEMA_DIFF*/
	};
});

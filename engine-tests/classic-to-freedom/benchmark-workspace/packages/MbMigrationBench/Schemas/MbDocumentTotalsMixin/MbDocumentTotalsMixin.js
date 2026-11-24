define("MbDocumentTotalsMixin", [], function() {
	Ext.define("Terrasoft.configuration.mixins.MbDocumentTotalsMixin", {
		alternateClassName: "Terrasoft.MbDocumentTotalsMixin",

		/**
		 * Marks the document as posted, logs it and recalculates the contract amount.
		 * Shared by every document page of a contract.
		 */
		mbPostDocument: function() {
			if (this.get("MbIsPosted")) {
				this.showInformationDialog(this.get("Resources.Strings.MbAlreadyPostedMessage"));
				return;
			}
			this.set("MbIsPosted", true);
			this.save({
				isSilent: true,
				callback: function() {
					this.mbWriteLog("Posted document " + (this.get("MbNumber") || ""));
					const contract = this.get("MbContract");
					if (contract) {
						this.mbRecalculateContractAmount(contract.value);
					}
				},
				scope: this
			});
		},

		mbIsPostButtonEnabled: function() {
			return !this.get("MbIsPosted") && !this.isNewMode();
		},

		/**
		 * Recalculates the contract amount and writes it to the contract: the total of its active
		 * items, plus its posted delivery notes, minus its posted return notes.
		 * The contract page calls it too, so the amount has one definition.
		 * @param {String} contractId Contract id.
		 * @param {Function} [callback] Called with the new amount.
		 * @param {Object} [scope] Callback scope.
		 */
		mbRecalculateContractAmount: function(contractId, callback, scope) {
			this.mbSumContractColumn("MbContractItem", "MbTotal", "MbIsActive", contractId, function(items) {
				this.mbSumContractColumn("MbDeliveryNote", "MbAmount", "MbIsPosted", contractId, function(deliveries) {
					this.mbSumContractColumn("MbReturnNote", "MbAmount", "MbIsPosted", contractId, function(returns) {
						const amount = items + deliveries - returns;
						const update = Ext.create("Terrasoft.UpdateQuery", {rootSchemaName: "MbContract"});
						update.filters.add("Id", Terrasoft.createColumnFilterWithParameter(
							Terrasoft.ComparisonType.EQUAL, "Id", contractId));
						update.setParameterValue("MbAmount", amount, Terrasoft.DataValueType.MONEY);
						update.execute(function() {
							if (callback) {
								callback.call(scope || this, amount);
							}
						}, this);
					});
				});
			});
		},

		/**
		 * Sums a column over the contract's rows whose flag column is true.
		 * @private
		 */
		mbSumContractColumn: function(schemaName, columnName, flagColumnName, contractId, callback) {
			const esq = Ext.create("Terrasoft.EntitySchemaQuery", {rootSchemaName: schemaName});
			esq.addAggregationSchemaColumn(columnName, Terrasoft.AggregationType.SUM, "Total");
			esq.filters.add("Contract", Terrasoft.createColumnFilterWithParameter(
				Terrasoft.ComparisonType.EQUAL, "MbContract", contractId));
			esq.filters.add("Flag", Terrasoft.createColumnFilterWithParameter(
				Terrasoft.ComparisonType.EQUAL, flagColumnName, true));
			esq.getEntityCollection(function(result) {
				if (!result.success) {
					return;
				}
				callback.call(this, result.collection.getByIndex(0).get("Total") || 0);
			}, this);
		}
	});
	return Ext.create("Terrasoft.MbDocumentTotalsMixin");
});

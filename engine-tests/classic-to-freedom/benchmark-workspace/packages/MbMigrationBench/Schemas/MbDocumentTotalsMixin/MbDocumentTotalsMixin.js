define("MbDocumentTotalsMixin", [], function() {
	Ext.define("Terrasoft.configuration.mixins.MbDocumentTotalsMixin", {
		alternateClassName: "Terrasoft.MbDocumentTotalsMixin",

		/**
		 * Marks the document as posted, logs it and recalculates the contract amount.
		 * Shared by every document page of a contract.
		 * The flag is written to the record first, and the page, the History line and the contract
		 * amount follow only when that write succeeds: the page's save() reports no failure, so a
		 * rejected save would leave the page showing a posted document that was never posted.
		 */
		mbPostDocument: function() {
			if (this.get("MbIsPosted")) {
				this.showInformationDialog(this.get("Resources.Strings.MbAlreadyPostedMessage"));
				return;
			}
			const update = Ext.create("Terrasoft.UpdateQuery", {rootSchemaName: this.entitySchemaName});
			update.filters.add("Id", Terrasoft.createColumnFilterWithParameter(
				Terrasoft.ComparisonType.EQUAL, "Id", this.get("Id")));
			update.filters.add("NotPosted", Terrasoft.createColumnFilterWithParameter(
				Terrasoft.ComparisonType.EQUAL, "MbIsPosted", false));
			update.setParameterValue("MbIsPosted", true, Terrasoft.DataValueType.BOOLEAN);
			update.execute(function(response) {
				if (!response?.success || !response.rowsAffected) {
					this.showInformationDialog(this.get("Resources.Strings.MbPostFailedMessage"));
					return;
				}
				this.set("MbIsPosted", true);
				this.mbWriteLog("Posted document " + (this.get("MbNumber") || ""));
				const contract = this.get("MbContract");
				if (contract) {
					this.mbRecalculateContractAmount(contract.value);
				}
			}, this);
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

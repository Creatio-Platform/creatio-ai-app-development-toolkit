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
					this.mbUpdateContractAmount();
				},
				scope: this
			});
		},

		mbIsPostButtonEnabled: function() {
			return !this.get("MbIsPosted") && !this.isNewMode();
		},

		/**
		 * Recalculates the contract amount from its active items and posted documents.
		 */
		mbUpdateContractAmount: function() {
			var contract = this.get("MbContract");
			if (!contract) {
				return;
			}
			var esq = Ext.create("Terrasoft.EntitySchemaQuery", {rootSchemaName: "MbContractItem"});
			esq.addAggregationSchemaColumn("MbTotal", Terrasoft.AggregationType.SUM, "ItemsTotal");
			esq.filters.add("Contract", Terrasoft.createColumnFilterWithParameter(
				Terrasoft.ComparisonType.EQUAL, "MbContract", contract.value));
			esq.filters.add("Active", Terrasoft.createColumnFilterWithParameter(
				Terrasoft.ComparisonType.EQUAL, "MbIsActive", true));
			esq.getEntityCollection(function(result) {
				if (!result.success) {
					return;
				}
				var total = result.collection.getByIndex(0).get("ItemsTotal") || 0;
				var sign = this.entitySchemaName === "MbReturnNote" ? -1 : 1;
				var update = Ext.create("Terrasoft.UpdateQuery", {rootSchemaName: "MbContract"});
				update.filters.add("Id", Terrasoft.createColumnFilterWithParameter(
					Terrasoft.ComparisonType.EQUAL, "Id", contract.value));
				update.setParameterValue("MbAmount", total + sign * (this.get("MbAmount") || 0),
					Terrasoft.DataValueType.FLOAT);
				update.execute();
			}, this);
		}
	});
	return Ext.create("Terrasoft.MbDocumentTotalsMixin");
});

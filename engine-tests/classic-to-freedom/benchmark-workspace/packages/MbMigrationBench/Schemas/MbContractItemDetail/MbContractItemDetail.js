define("MbContractItemDetail", [], function() {
	return {
		entitySchemaName: "MbContractItem",
		attributes: {
			"MbOnlyActive": {
				"dataValueType": Terrasoft.DataValueType.BOOLEAN,
				"type": Terrasoft.ViewModelColumnType.VIRTUAL_COLUMN,
				"value": false
			},
			"MbDueSoon": {
				"dataValueType": Terrasoft.DataValueType.BOOLEAN,
				"type": Terrasoft.ViewModelColumnType.VIRTUAL_COLUMN,
				"value": false
			},
			"MbSummary": {
				"dataValueType": Terrasoft.DataValueType.TEXT,
				"type": Terrasoft.ViewModelColumnType.VIRTUAL_COLUMN,
				"value": ""
			}
		},
		methods: {
			init: function() {
				this.callParent(arguments);
				this.mbRestoreQuickFilters();
			},

			mbGetProfileKey: function() {
				return "MbContractItemDetailQuickFilters";
			},

			mbRestoreQuickFilters: function() {
				Terrasoft.require(["profile!" + this.mbGetProfileKey()], function(profile) {
					if (profile) {
						this.set("MbOnlyActive", Boolean(profile.onlyActive));
						this.set("MbDueSoon", Boolean(profile.dueSoon));
						this.reloadGridData();
					}
				}, this);
			},

			mbSaveQuickFilters: function() {
				Terrasoft.utils.saveUserProfile(this.mbGetProfileKey(), {
					onlyActive: this.get("MbOnlyActive"),
					dueSoon: this.get("MbDueSoon")
				}, false);
			},

			getFilters: function() {
				var filters = this.callParent(arguments);
				if (this.get("MbOnlyActive")) {
					filters.add("MbOnlyActiveFilter", Terrasoft.createColumnFilterWithParameter(
						Terrasoft.ComparisonType.EQUAL, "MbIsActive", true));
				}
				if (this.get("MbDueSoon")) {
					var limit = new Date();
					limit.setDate(limit.getDate() + 30);
					filters.add("MbDueSoonFilter", Terrasoft.createColumnFilterWithParameter(
						Terrasoft.ComparisonType.LESS_OR_EQUAL, "MbDeliveryDate", limit));
				}
				return filters;
			},

			mbToggleOnlyActive: function() {
				this.set("MbOnlyActive", !this.get("MbOnlyActive"));
				this.mbSaveQuickFilters();
				this.reloadGridData();
			},

			mbToggleDueSoon: function() {
				this.set("MbDueSoon", !this.get("MbDueSoon"));
				this.mbSaveQuickFilters();
				this.reloadGridData();
			},

			mbGetOnlyActiveCaption: function() {
				return this.get(this.get("MbOnlyActive") ? "Resources.Strings.MbAllItemsCaption"
					: "Resources.Strings.MbOnlyActiveCaption");
			},

			mbGetDueSoonCaption: function() {
				return this.get(this.get("MbDueSoon") ? "Resources.Strings.MbAnyDateCaption"
					: "Resources.Strings.MbDueSoonCaption");
			},

			onGridDataLoaded: function() {
				this.callParent(arguments);
				this.mbUpdateSummary();
			},

			mbUpdateSummary: function() {
				var masterId = this.get("MasterRecordId");
				if (!masterId) {
					return;
				}
				var esq = Ext.create("Terrasoft.EntitySchemaQuery", {rootSchemaName: "MbContractItem"});
				esq.addAggregationSchemaColumn("MbTotal", Terrasoft.AggregationType.SUM, "Total");
				esq.addAggregationSchemaColumn("Id", Terrasoft.AggregationType.COUNT, "ActiveCount");
				esq.filters.add("Contract", Terrasoft.createColumnFilterWithParameter(
					Terrasoft.ComparisonType.EQUAL, "MbContract", masterId));
				esq.filters.add("Active", Terrasoft.createColumnFilterWithParameter(
					Terrasoft.ComparisonType.EQUAL, "MbIsActive", true));
				esq.getEntityCollection(function(result) {
					if (!result.success) {
						return;
					}
					var row = result.collection.getByIndex(0);
					this.set("MbSummary", Ext.String.format(this.get("Resources.Strings.MbSummaryTemplate"),
						row.get("Total") || 0, row.get("ActiveCount") || 0));
				}, this);
			},

			addToolsButtonMenuItems: function(toolsButtonMenu) {
				this.callParent(arguments);
				toolsButtonMenu.addItem(this.getButtonMenuSeparator());
				toolsButtonMenu.addItem(this.getButtonMenuItem({
					"Caption": {"bindTo": "Resources.Strings.MbDeactivateSelectedCaption"},
					"Click": {"bindTo": "mbDeactivateSelected"},
					"Enabled": {"bindTo": "isAnySelected"}
				}));
			},

			mbDeactivateSelected: function() {
				var selected = this.getSelectedItems() || [];
				selected.forEach(function(id) {
					var update = Ext.create("Terrasoft.UpdateQuery", {rootSchemaName: "MbContractItem"});
					update.filters.add("Id", Terrasoft.createColumnFilterWithParameter(
						Terrasoft.ComparisonType.EQUAL, "Id", id));
					update.setParameterValue("MbIsActive", false, Terrasoft.DataValueType.BOOLEAN);
					update.execute(function() {
						this.reloadGridData();
					}, this);
				}, this);
			}
		},
		diff: /**SCHEMA_DIFF*/[
			{
				"operation": "insert",
				"name": "MbOnlyActiveButton",
				"parentName": "Detail",
				"propertyName": "tools",
				"values": {
					"itemType": Terrasoft.ViewItemType.BUTTON,
					"caption": {"bindTo": "mbGetOnlyActiveCaption"},
					"click": {"bindTo": "mbToggleOnlyActive"},
					"style": Terrasoft.controls.ButtonEnums.style.TRANSPARENT
				}
			},
			{
				"operation": "insert",
				"name": "MbDueSoonButton",
				"parentName": "Detail",
				"propertyName": "tools",
				"values": {
					"itemType": Terrasoft.ViewItemType.BUTTON,
					"caption": {"bindTo": "mbGetDueSoonCaption"},
					"click": {"bindTo": "mbToggleDueSoon"},
					"style": Terrasoft.controls.ButtonEnums.style.TRANSPARENT
				}
			},
			{
				"operation": "insert",
				"name": "MbSummaryLabel",
				"parentName": "Detail",
				"propertyName": "tools",
				"values": {
					"itemType": Terrasoft.ViewItemType.LABEL,
					"caption": {"bindTo": "MbSummary"}
				}
			}
		]/**SCHEMA_DIFF*/
	};
});

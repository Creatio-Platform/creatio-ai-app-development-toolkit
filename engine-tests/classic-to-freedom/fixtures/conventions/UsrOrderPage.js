define("UsrOrderPage", ["AbConstants", "AbClientHelperModule", "BusinessRuleModule", "css!UsrOrderPageCSS"],
	function(AbConstants, AbClientHelperModule, BusinessRuleModule) {
		return {
			entitySchemaName: "UsrOrder",
			diff: [
				{
					"operation": "insert",
					"name": "Name",
					"parentName": "ProfileContainer",
					"propertyName": "items",
					"values": { "bindTo": "Name" }
				},
				{
					"operation": "insert",
					"name": "Status",
					"parentName": "ProfileContainer",
					"propertyName": "items",
					"values": { "bindTo": "Status" }
				},
				{
					"operation": "insert",
					"name": "ApplyButton",
					"parentName": "ProfileContainer",
					"propertyName": "items",
					"values": {
						"itemType": Terrasoft.ViewItemType.BUTTON,
						"caption": { "bindTo": "Resources.Strings.ApplyButtonCaption" },
						"click": { "bindTo": "onApplyClick" }
					}
				}
			],
			businessRules: {
				Name: {
					RequiredWhenApproved: {
						ruleType: BusinessRuleModule.enums.RuleType.BINDPARAMETER,
						property: BusinessRuleModule.enums.Property.REQUIRED,
						conditions: [{
							leftExpression: {
								type: BusinessRuleModule.enums.ValueType.ATTRIBUTE,
								attribute: "Status"
							},
							comparisonType: Terrasoft.ComparisonType.EQUAL,
							rightExpression: {
								type: BusinessRuleModule.enums.ValueType.CONSTANT,
								value: "3e7f3a3c-1a2b-4c5d-8e9f-0a1b2c3d4e5f"
							}
						}]
					}
				}
			},
			methods: {
				onApplyClick: function() {
					this.set("Status", { value: AbConstants.OrderStatus.Approved });
				}
			}
		};
	});

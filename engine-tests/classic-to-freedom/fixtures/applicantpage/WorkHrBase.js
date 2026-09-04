// LAYER 1 of the `Applicant1Page` chain (package `WorkHrBase`) — REAL body, trimmed diff.
//
// Kept VERBATIM: `attributes`, `details`, `methods`. Those three blocks are the whole point of this fixture —
// every trigger declaration the tracer has to read lives in them, and paraphrasing one would make the golden a
// test of the paraphrase. `diff` is trimmed to the ops the kept blocks reference (the raw layer's diff is
// layout-only and repeats the GUID-suffixed field inserts the next layer restates anyway).
//
// The declaration that matters here: `attributes.InternalRequest.lookupListConfig.filter` is a FUNCTION, not a
// method name. The engine therefore emits NO trigger for `getRequestStatusFilter` — deriving "it must call
// getRequestStatusFilter" from the function body would be exactly the name inference `04-units.md` forbids.
// The slot is reported as an attribute `fnKeys` entry (`lookupListConfig.filter`) instead, so it is visible
// without being invented.
define("Applicant1Page", ["WorkHrBaseConstants"],
	function(WorkHrBaseConstants) {
	return {
		entitySchemaName: "Applicant",
		attributes: {
				"InternalRequest": {
					"onChange": "onInternalRequestChange",
					lookupListConfig: {
						filter: function() {
							return  this.getRequestStatusFilter();
						}
					}
				}
			},
		details: /**SCHEMA_DETAILS*/{
			"ApplicantRequestDetail": {
				"schemaName": "ApplicantRequestDetail",
				"entitySchemaName": "InternalRequest",
				"filter": {
					"masterColumn": "Job",
					"detailColumn": "EmployeeJob"
				}
			}
		}/**SCHEMA_DETAILS*/,
		diff: /**SCHEMA_DIFF*/[
			{
				"operation": "insert",
				"name": "ApplicantRequestDetail",
				"parentName": "Tabs",
				"propertyName": "items",
				"values": {
					"itemType": 2
				},
				"index": 0
			}
		]/**SCHEMA_DIFF*/,
		methods: {
			init: function () {
				this.callParent(arguments);
				this.addAllowedReferenceSchemaNames(["Contact", "Account"]);
			},
			getRequestStatusFilter: function() {
					var existsFilter = Terrasoft.createExistsFilter("[InternalRequest:Id].Id");
					var subFilters = Terrasoft.createFilterGroup();

					subFilters.add("StatusFilter", Terrasoft.createColumnInFilterWithParameters("Status",
							[WorkHrBaseConstants.RequestStatus.InProgress,
							WorkHrBaseConstants.RequestStatus.OnDistribution]));

					existsFilter.subFilters.addItem(subFilters);

					return existsFilter;
			}
		},
		rules: {},
		businessRules: /**SCHEMA_BUSINESS_RULES*/{}/**SCHEMA_BUSINESS_RULES*/
	};
});

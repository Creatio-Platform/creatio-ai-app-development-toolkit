// LAYER 2 (top) of the `Applicant1Page` chain (package `HRApplicant`) — REAL body, trimmed diff.
//
// Kept VERBATIM: `attributes`, `details`, `methods`. This is the layer that carries the four declarations the
// trigger tracer used to drop on the floor:
//   · `attributes.Contact.onChange: "onContactChange"`                 → kind `attribute`
//   · `attributes.InternalRequest.onChange: "onInternalRequestChange"` → kind `attribute`
//   · `attributes.Job.lookupListConfig.filter: "getJobFilter"`         → kind `entity-filter` (STRING form)
//   · `details.ApplicantEmailDetailV2.filterMethod: "getEmailDetailFilter"` → kind `detail`
//
// The STRING-valued `lookupListConfig.filter` on `Job` is the one construct here that is NOT in the captured
// body: the captured page only has the function-valued form (`WorkHrBase.js`), so without a string case nothing
// would exercise the `entity-filter` emit at all. It is the same slot the platform reads, in its other accepted
// form. Everything else — including the two `onChange` names and the `filterMethod` — is as captured.
define("Applicant1Page", ["ConfigurationConstants"], function(ConfigurationConstants) {
	return {
		entitySchemaName: "Applicant",
		details: /**SCHEMA_DETAILS*/{
	"StageInRecruitmentDetail": {
		"schemaName": "StageInRecruitmentDetailV2",
		"entitySchemaName": "RecruitmentInStage",
		"filter": {
			"detailColumn": "RootEntity",
			"masterColumn": "Id"
		}
	},
	"ApplicantEmailDetailV2": {
		"schemaName": "ApplicantEmailDetailV2",
		"entitySchemaName": "Activity",
		"filterMethod": "getEmailDetailFilter"
	}
}/**SCHEMA_DETAILS*/,
		diff: /**SCHEMA_DIFF*/[
			{
				"operation": "insert",
				"name": "ContactContainer",
				"parentName": "ProfileContainer",
				"propertyName": "items",
				"values": {
					"itemType": 0,
					"items": []
				}
			},
			{
				"operation": "insert",
				"name": "Contact7ec9d462",
				"values": {
					"bindTo": "Contact",
					"enabled": true,
					"contentType": 5
				},
				"parentName": "ContactContainer",
				"propertyName": "items",
				"index": 0
			},
			{
				"operation": "insert",
				"name": "MobilePhone",
				"values": {
					"bindTo": "MobilePhone",
					"enabled": false,
					"contentType": 5
				},
				"parentName": "ContactContainer",
				"propertyName": "items",
				"index": 1
			},
			{
				"operation": "insert",
				"name": "Email",
				"values": {
					"bindTo": "Email",
					"enabled": false,
					"contentType": 5
				},
				"parentName": "ContactContainer",
				"propertyName": "items",
				"index": 2
			},
			{
				"operation": "insert",
				"name": "ApplicantEmailDetailV2",
				"parentName": "Tabs",
				"propertyName": "items",
				"values": {
					"itemType": 2
				},
				"index": 1
			},
			{
				"operation": "insert",
				"name": "StageInRecruitmentDetail",
				"parentName": "Tabs",
				"propertyName": "items",
				"values": {
					"itemType": 2
				},
				"index": 2
			}
		]/**SCHEMA_DIFF*/,
		attributes: {
			/**
			 * @attribute Contact
			 * @type LOOKUP
			 */
			"Contact": {
				"type": this.Terrasoft.ViewModelColumnType.ENTITY_COLUMN,
				onChange: "onContactChange"
			},

			/**
			 * @attribute Job
			 * @type LOOKUP
			 */
			"Job": {
				"type": this.Terrasoft.ViewModelColumnType.ENTITY_COLUMN,
				lookupListConfig: {
					filter: "getJobFilter"
				}
			},

			/**
			 * @attribute Mobile phone
			 * @type STRING
			 */
			"MobilePhone": {
				"dataValueType": this.Terrasoft.DataValueType.STRING,
				"type": this.Terrasoft.ViewModelColumnType.CALCULATED_COLUMN
			},

			/**
			 * @attribute Email
			 * @type STRING
			 */
			"Email": {
				"dataValueType": this.Terrasoft.DataValueType.STRING,
				"type": this.Terrasoft.ViewModelColumnType.CALCULATED_COLUMN
			}
		},
		methods: {
			/**
			* Gets filter for "Email" detail.
			* @return {Terrasoft.createFilterGroup}
			*/
			getEmailDetailFilter: function() {
				var filterGroup = this.Terrasoft.createFilterGroup();
				filterGroup.add("IdFilter", this.Terrasoft.createColumnFilterWithParameter(
					this.Terrasoft.ComparisonType.EQUAL, "Applicant", this.get("Id")));
				filterGroup.add("EmailFilter", this.Terrasoft.createColumnFilterWithParameter(
					this.Terrasoft.ComparisonType.EQUAL, "Type", ConfigurationConstants.Activity.Type.Email));
				return filterGroup;
			},

			/**
			* Gets filter for the "Job" lookup.
			* @return {Terrasoft.createFilterGroup}
			*/
			getJobFilter: function() {
				return this.Terrasoft.createColumnFilterWithParameter(
					this.Terrasoft.ComparisonType.EQUAL, "IsActive", true);
			},

			/**
			* Updates detail before save
			*/
			onSaved: function() {
				this.updateDetail({"detail": "StageInRecruitmentDetail"});
				this.callParent(arguments);
			},

			/**
			 * Updates contact info
			 */
			onContactChange: function() {
				var contact = this.get("Contact");
				if(!contact || !contact.value) {
					this.clearContactInfo();
					return;
				}
				var esq = Ext.create("Terrasoft.EntitySchemaQuery", {
					rootSchemaName: "Contact"
				});
				esq.addColumn("MobilePhone", "MobilePhone");
				esq.addColumn("Email", "Email");
				esq.getEntity(contact.value, function(result) {
					if (!result.success) {
						return;
					}
					this.setContactInfo(result.entity);
				}, this);
			},

			/**
			 * Updates internal request info
			 */
			onInternalRequestChange: function() {
				var request = this.get("InternalRequest");
				if (!request || !request.value) {
					return;
				}
				this.set("Job", request.value);
			},

			/**
			 * Sets contact info
			 */
			setContactInfo: function(entity) {
				this.set("MobilePhone", entity.get("MobilePhone"));
				this.set("Email", entity.get("Email"));
			},

			/**
			 * Clears contact info
			 */
			clearContactInfo: function() {
				this.set("MobilePhone", "");
				this.set("Email", "");
			}
		},
		rules: {},
		businessRules: /**SCHEMA_BUSINESS_RULES*/{}/**SCHEMA_BUSINESS_RULES*/
	};
});

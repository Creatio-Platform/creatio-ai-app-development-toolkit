// Minimal structural skeleton of the classic base page template (BaseModulePageV2 family).
// Used as an F2 SEED: prepended to a schema's own schemas so the base containers/tabs the client
// schemas patch (Header, ProfileContainer, Tabs, ESNTab, ChangesHistoryTab, PrintButton) exist
// before those patches replay — otherwise they orphan (unresolvedParents) or warn (merge onto
// absent). Real names taken from the live diagnostics (unresolvedParents + merge-warnings on the
// Contract/SupportUnit goldens). No entitySchemaName: the template is abstract, so entity
// resolution skips it and still picks the concrete entity from the client schemas.
//
// In production these seed schemas are the REAL parent-template bodies, assembled by
// clio get-classic-migration-bundle (it walks the Parent chain and reads every base-template body itself).
// This fixture is the offline stand-in that proves the mechanism.
define("BaseModulePageV2", [], function() {
	return {
		diff: [
			{ operation: "insert", name: "Header", values: { itemType: 15 } },
			{ operation: "insert", name: "ProfileContainer", values: { itemType: 15 } },
			{ operation: "insert", name: "Tabs", values: { itemType: 15 } },
			{ operation: "insert", name: "ESNTab", parentName: "Tabs", propertyName: "tabs",
				values: { itemType: 15, caption: "ESN" } },
			{ operation: "insert", name: "ChangesHistoryTab", parentName: "Tabs", propertyName: "tabs",
				values: { itemType: 15, caption: "Changes history" } },
			{ operation: "insert", name: "PrintButton", parentName: "Header", values: { itemType: 5 } }
		]
	};
});

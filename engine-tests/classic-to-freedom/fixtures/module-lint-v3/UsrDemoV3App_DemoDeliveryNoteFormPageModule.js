define("UsrDemoV3App_DemoDeliveryNoteFormPageModule", ["UsrDemoV3App_DemoReturnNoteFormPageModule"], function(documentPosting) {
	"use strict";

	const ENTITY_SCHEMA_NAME = "DemoDeliveryNote";

	/**
	 * The delivery note uses the posting logic of the return note module, which takes the note's entity name:
	 * the date default of a new note, the Post availability and the Post action itself.
	 */
	function postDocument(request) {
		return documentPosting.postDocument(request, ENTITY_SCHEMA_NAME);
	}

	return {
		applyNewNoteDefaults: documentPosting.applyNewNoteDefaults,
		refreshPostAvailability: documentPosting.refreshPostAvailability,
		postDocument
	};
});

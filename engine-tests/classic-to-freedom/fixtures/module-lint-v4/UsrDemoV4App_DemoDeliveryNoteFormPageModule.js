define("UsrDemoV4App_DemoDeliveryNoteFormPageModule", ["UsrDemoV4App_SharedModule"], function(shared) {
	"use strict";

	const NOTE_ENTITY = "DemoDeliveryNote";

	/**
	 * Posts the open delivery note: marks it posted, writes its History line and recalculates the contract amount.
	 */
	function postDeliveryNote(request) {
		return shared.postNoteWithHistory(request, NOTE_ENTITY);
	}

	return {
		applyNewNoteDate: shared.applyNewNoteDate,
		refreshPostAvailability: shared.refreshPostAvailability,
		isPostStateChange: shared.isPostStateChange,
		postDeliveryNote
	};
});

define("UsrMbContractsV4App_MbDeliveryNoteFormPageModule", ["UsrMbContractsV4App_SharedModule"], function(shared) {
	"use strict";

	const NOTE_ENTITY = "MbDeliveryNote";

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

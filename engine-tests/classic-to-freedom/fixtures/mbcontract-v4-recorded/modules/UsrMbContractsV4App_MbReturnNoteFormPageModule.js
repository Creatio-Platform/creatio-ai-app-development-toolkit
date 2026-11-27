define("UsrMbContractsV4App_MbReturnNoteFormPageModule", ["UsrMbContractsV4App_SharedModule"], function(shared) {
	"use strict";

	const NOTE_ENTITY = "MbReturnNote";
	const HISTORY_DATA_SOURCE = "MbDocumentLogDS";
	const POST_STATE_ATTRIBUTES = ["PDS_MbIsPosted", "CardState"];

	/**
	 * Return note opened: a new note gets today's date when it has none.
	 */
	async function applyNewReturnNoteDefaults($context) {
		await shared.applyNewNoteDate($context);
	}

	/**
	 * Enables Post only for a saved, not yet posted return note.
	 */
	async function refreshPostButton($context) {
		await shared.refreshPostAvailability($context);
	}

	/**
	 * True when a changed attribute decides whether Post is available.
	 */
	function affectsPostButton(attributeName) {
		return POST_STATE_ATTRIBUTES.includes(attributeName);
	}

	/**
	 * Posts the open return note and writes its History line.
	 */
	async function postReturnNote(request) {
		await shared.postNote(request, NOTE_ENTITY, HISTORY_DATA_SOURCE);
	}

	return {
		applyNewReturnNoteDefaults,
		refreshPostButton,
		affectsPostButton,
		postReturnNote
	};
});

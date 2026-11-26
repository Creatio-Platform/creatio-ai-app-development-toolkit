define("UsrDemoV3App_DemoReturnNoteFormPageModule", ["@creatio-devkit/common", "UsrDemoV3App_ContractAmountModule"], function(sdk, contractAmount) {
	"use strict";

	const {equalFilter, filterGroup, showMessage, recalculateContractAmount, dataServiceUrl, parameter} = contractAmount;

	const CARD_STATE_ADD = "add";
	const CARD_STATE_EDIT = "edit";
	const DATA_VALUE_TYPE_GUID = 0;
	const DATA_VALUE_TYPE_BOOLEAN = 12;
	const UPDATE_QUERY_PATH = "DataService/json/SyncReply/UpdateQuery";
	const LOG_ENTITY = "DemoDocumentLog";
	const POSTED_LOG_PREFIX = "Posted document ";

	const idOf = (value) => (value && typeof value === "object" ? value.value : value);

	/**
	 * Sends one DataService query. Returns the response body, or null when the call failed.
	 */
	async function sendDataServiceQuery(relativePath, body) {
		try {
			const response = await new sdk.HttpClientService().post(dataServiceUrl(relativePath), body);
			const data = response?.body ?? response;
			return data && data.success !== false ? data : null;
		} catch (e) {
			return null;
		}
	}

	/**
	 * A new note opened in add mode with no date gets the current date and time.
	 */
	async function applyNewNoteDefaults($context) {
		if ((await $context.CardState) !== CARD_STATE_ADD) {
			return;
		}
		if (!(await $context.PDS_DemoDate)) {
			await $context.set("PDS_DemoDate", new Date());
		}
	}

	/**
	 * Post is available only on a saved (edit mode) note that is not posted yet; anything else keeps it disabled.
	 */
	async function refreshPostAvailability($context) {
		const [isPosted, cardState] = await Promise.all([$context.PDS_DemoIsPosted, $context.CardState]);
		await $context.set("DemoPostDisabled", Boolean(isPosted) || cardState !== CARD_STATE_EDIT);
	}

	async function saveNote(request) {
		const saved = await sdk.HandlerChainService.instance.process({
			type: "crt.SaveRecordRequest",
			preventCardClose: true,
			showSuccessMessage: false,
			$context: request.$context,
			scopes: [...request.scopes]
		});
		return saved === true;
	}

	/**
	 * Marks the stored note posted, only while it is still unposted in the database.
	 * Returns true when exactly the note's row was changed.
	 */
	async function markPosted(entitySchemaName, recordId) {
		const result = await sendDataServiceQuery(UPDATE_QUERY_PATH, {
			rootSchemaName: entitySchemaName,
			operationType: 2,
			columnValues: {items: {DemoIsPosted: parameter(DATA_VALUE_TYPE_BOOLEAN, true)}},
			filters: filterGroup(entitySchemaName, {
				Id: equalFilter("Id", DATA_VALUE_TYPE_GUID, recordId),
				NotPosted: equalFilter("DemoIsPosted", DATA_VALUE_TYPE_BOOLEAN, false)
			})
		});
		return Boolean(result && result.rowsAffected > 0);
	}

	/**
	 * Writes one line to the document log of the record. Returns true when the line was stored.
	 */
	async function writeLog(entitySchemaName, recordId, message) {
		try {
			const model = await sdk.Model.create(LOG_ENTITY);
			await model.insert({DemoName: message, DemoRecordId: recordId, DemoEntityName: entitySchemaName});
			return true;
		} catch (e) {
			return false;
		}
	}

	async function reloadNote(request) {
		await sdk.HandlerChainService.instance.process({
			type: "crt.LoadDataRequest",
			refreshDataConfig: {mode: "RefreshSpecific", targetDataSourceNames: ["PDS"]},
			showSuccessMessage: false,
			$context: request.$context,
			scopes: [...request.scopes]
		});
	}

	/**
	 * Tells the user the contract amount was not recalculated. A page that does not carry the message text
	 * shows nothing rather than an empty dialog.
	 */
	async function reportAmountNotRecalculated(request) {
		const message = await request.$context.DemoAmountNotRecalculatedMessageText;
		if (message) {
			await showMessage(request, message);
		}
	}

	/**
	 * After the note is marked posted: the History line, the contract amount and the page.
	 * A History line or a contract amount that could not be written is reported to the user.
	 */
	async function completePosting(request, entitySchemaName, recordId) {
		const {$context} = request;
		const [number, contract] = await Promise.all([$context.PDS_DemoNumber, $context.PDS_DemoContract]);
		const logged = await writeLog(entitySchemaName, recordId, POSTED_LOG_PREFIX + (number || ""));
		const contractId = idOf(contract);
		const recalculation = contractId ? await recalculateContractAmount(contractId) : {success: true};
		await reloadNote(request);
		if (!logged) {
			await showMessage(request, await $context.DemoLogFailedMessageText);
		}
		if (!recalculation.success) {
			await reportAmountNotRecalculated(request);
		}
	}

	/**
	 * The Post action: an already posted note is refused with a message; otherwise the page is saved,
	 * the stored note is marked posted only while still unposted, then logged and the contract recalculated.
	 */
	async function postDocument(request, entitySchemaName) {
		const {$context} = request;
		if (await $context.PDS_DemoIsPosted) {
			await showMessage(request, await $context.DemoAlreadyPostedMessageText);
			return false;
		}
		if (!(await saveNote(request))) {
			return false;
		}
		const recordId = idOf(await $context.Id);
		if (!(await markPosted(entitySchemaName, recordId))) {
			await showMessage(request, await $context.DemoPostFailedMessageText);
			return false;
		}
		await completePosting(request, entitySchemaName, recordId);
		return true;
	}

	return {
		applyNewNoteDefaults,
		refreshPostAvailability,
		postDocument
	};
});

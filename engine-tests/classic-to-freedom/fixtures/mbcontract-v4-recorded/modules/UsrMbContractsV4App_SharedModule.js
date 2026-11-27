define("UsrMbContractsV4App_SharedModule", ["@creatio-devkit/common"], function(sdk) {
	"use strict";

	const DATA_VALUE_TYPE_GUID = 0;
	const DATA_VALUE_TYPE_BOOLEAN = 12;
	const COMPARISON_EQUAL = 3;
	const AGGREGATION_SUM = 2;
	const SELECT_QUERY_PATH = "DataService/json/SyncReply/SelectQuery";
	const UPDATE_QUERY_PATH = "DataService/json/SyncReply/UpdateQuery";
	const CONTRACT_ENTITY = "MbContract";
	const DOCUMENT_LOG_ENTITY = "MbDocumentLog";
	const POSTED_LOG_PREFIX = "Posted document ";
	const CARD_STATE_ADD = "add";
	const CARD_STATE_EDIT = "edit";
	const NOTE_HISTORY_DATA_SOURCE = "MbDocumentLogDS";
	const POST_STATE_ATTRIBUTES = new Set(["PDS_MbIsPosted", "CardState"]);
	const AGGREGATION_COUNT = 1;
	const CONTRACT_ITEM_ENTITY = "MbContractItem";
	const AGGREGATION_MAX = 5;
	const CONTRACT_STATUS_DRAFT = "6f0c4b2e-1d1a-4c3e-9a51-0b1c2d3e4f01";
	const CONTRACT_STATUS_CLOSED = "6f0c4b2e-1d1a-4c3e-9a51-0b1c2d3e4f03";
	const APPROVAL_PROCESS_NAME = "MbApproveContractProcess";
	const APPROVAL_PROCESS_RECORD_PARAMETER = "ContractId";

	const idOf = (value) => (value && typeof value === "object" ? value.value : value);
	const column = (path) => ({expressionType: 0, columnPath: path});
	const parameter = (dataValueType, value) => ({expressionType: 2, parameter: {dataValueType, value}});
	const equalFilter = (path, dataValueType, value) => ({
		filterType: 1,
		comparisonType: COMPARISON_EQUAL,
		isEnabled: true,
		leftExpression: column(path),
		rightExpression: parameter(dataValueType, value)
	});
	const filterGroup = (rootSchemaName, items) => ({filterType: 6, logicalOperation: 0, isEnabled: true, rootSchemaName, items});

	/**
	 * The workspace URL of a DataService endpoint, on both the .NET Framework ("/0/...") and the .NET hosts.
	 */
	function dataServiceUrl(relativePath) {
		const base = globalThis.Terrasoft?.workspaceBaseUrl;
		if (base) {
			return base.replace(/\/$/, "") + "/" + relativePath;
		}
		const path = globalThis.location?.pathname || "/";
		const index = path.indexOf("/0/");
		return (index >= 0 ? path.slice(0, index + 3) : "/") + relativePath;
	}

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

	async function processRequest(request, config) {
		return sdk.HandlerChainService.instance.process({...config, $context: request.$context, scopes: [...request.scopes]});
	}

	async function showMessage(request, message) {
		await processRequest(request, {type: "crt.ShowDialogRequest", dialogConfig: {data: {message}}});
	}

	const flaggedSum = (childSchemaName, valueColumn, flagColumn) => ({
		expression: {
			expressionType: 3,
			columnPath: "[" + childSchemaName + ":MbContract]." + valueColumn,
			functionType: 2,
			aggregationType: AGGREGATION_SUM,
			subFilters: filterGroup(childSchemaName, {Flag: equalFilter(flagColumn, DATA_VALUE_TYPE_BOOLEAN, true)})
		}
	});

	/**
	 * The three totals of a contract in one server query: active items, posted delivery notes and posted
	 * return notes. An empty category is 0. Returns null when the query failed.
	 */
	async function readContractTotals(contractId) {
		const result = await sendDataServiceQuery(SELECT_QUERY_PATH, {
			rootSchemaName: CONTRACT_ENTITY,
			operationType: 0,
			allColumns: false,
			rowCount: 1,
			columns: {items: {
				Items: flaggedSum(CONTRACT_ITEM_ENTITY, "MbTotal", "MbIsActive"),
				Deliveries: flaggedSum("MbDeliveryNote", "MbAmount", "MbIsPosted"),
				Returns: flaggedSum("MbReturnNote", "MbAmount", "MbIsPosted")
			}},
			filters: filterGroup(CONTRACT_ENTITY, {Id: equalFilter("Id", DATA_VALUE_TYPE_GUID, contractId)})
		});
		const row = result?.rows?.[0];
		if (!row) {
			return null;
		}
		return {items: row.Items || 0, deliveries: row.Deliveries || 0, returns: row.Returns || 0};
	}

	/**
	 * Contract amount = active items + posted delivery notes - posted return notes, written to the contract.
	 * Returns {success: true, amount} once written, {success: false} when a total could not be read (nothing
	 * is written) or the write failed.
	 */
	async function recalculateContractAmount(contractId) {
		const totals = await readContractTotals(contractId);
		if (!totals) {
			return {success: false};
		}
		const amount = totals.items + totals.deliveries - totals.returns;
		try {
			const model = await sdk.Model.create(CONTRACT_ENTITY);
			await model.update({MbAmount: amount}, [{type: "primaryColumnValue", value: contractId}]);
			return {success: true, amount};
		} catch (e) {
			return {success: false};
		}
	}

	/**
	 * A new note opened in add mode with no date gets the current date and time; an existing note is left as is.
	 */
	async function applyNewNoteDate($context) {
		const [cardState, date] = await Promise.all([$context.CardState, $context.PDS_MbDate]);
		if (cardState === CARD_STATE_ADD && !date) {
			await $context.set("PDS_MbDate", new Date());
		}
	}

	/**
	 * Post is available only on a saved (edit mode) note that is not posted yet; anything else keeps it disabled.
	 */
	async function refreshPostAvailability($context) {
		const [isPosted, cardState] = await Promise.all([$context.PDS_MbIsPosted, $context.CardState]);
		await $context.set("MbPostDisabled", Boolean(isPosted) || cardState !== CARD_STATE_EDIT);
	}

	async function saveNote(request) {
		const saved = await processRequest(request, {type: "crt.SaveRecordRequest", preventCardClose: true, showSuccessMessage: false});
		return saved === true;
	}

	/**
	 * Marks the stored note posted, only while it is still unposted in the database.
	 * Returns true when the note's row was changed.
	 */
	async function markPosted(entitySchemaName, recordId) {
		const result = await sendDataServiceQuery(UPDATE_QUERY_PATH, {
			rootSchemaName: entitySchemaName,
			operationType: 2,
			columnValues: {items: {MbIsPosted: parameter(DATA_VALUE_TYPE_BOOLEAN, true)}},
			filters: filterGroup(entitySchemaName, {
				Id: equalFilter("Id", DATA_VALUE_TYPE_GUID, recordId),
				NotPosted: equalFilter("MbIsPosted", DATA_VALUE_TYPE_BOOLEAN, false)
			})
		});
		return Boolean(result && result.rowsAffected > 0);
	}

	/**
	 * Writes one line to the document log of the record. Returns true when the line was stored.
	 */
	async function writeDocumentLog(entitySchemaName, recordId, message) {
		try {
			const model = await sdk.Model.create(DOCUMENT_LOG_ENTITY);
			await model.insert({MbName: message, MbRecordId: recordId, MbEntityName: entitySchemaName});
			return true;
		} catch (e) {
			return false;
		}
	}

	/**
	 * Reloads the note itself and its History list.
	 */
	async function reloadNoteAndHistory(request, logDataSourceName) {
		await processRequest(request, {
			type: "crt.LoadDataRequest",
			refreshDataConfig: {mode: "RefreshSpecific", targetDataSourceNames: ["PDS"]},
			showSuccessMessage: false
		});
		await processRequest(request, {type: "crt.LoadDataRequest", dataSourceName: logDataSourceName, config: {loadType: "reload"}});
	}

	/**
	 * After the note is marked posted: the History line, the contract amount and the page.
	 * A History line or a contract amount that could not be written is reported to the user.
	 */
	async function completePosting(request, note) {
		const {$context} = request;
		const [number, contract] = await Promise.all([$context.PDS_MbNumber, $context.PDS_MbContract]);
		const logged = await writeDocumentLog(note.entitySchemaName, note.recordId, POSTED_LOG_PREFIX + (number || ""));
		const contractId = idOf(contract);
		const recalculation = contractId ? await recalculateContractAmount(contractId) : {success: true};
		await reloadNoteAndHistory(request, note.logDataSourceName);
		if (!logged) {
			await showMessage(request, await $context.MbLogFailedMessageText);
		}
		if (!recalculation.success) {
			await showMessage(request, await $context.MbAmountNotRecalculatedMessageText);
		}
	}

	/**
	 * The Post action of a delivery or return note: an already posted note is refused with a message; otherwise
	 * the page is saved, the stored note is marked posted only while still unposted, then logged and the
	 * contract amount recalculated. Every failure is shown to the user here.
	 */
	async function postNote(request, entitySchemaName, logDataSourceName) {
		const {$context} = request;
		if (await $context.PDS_MbIsPosted) {
			await showMessage(request, await $context.MbAlreadyPostedMessageText);
			return;
		}
		if (!(await saveNote(request))) {
			return;
		}
		const recordId = idOf(await $context.Id);
		if (!(await markPosted(entitySchemaName, recordId))) {
			await showMessage(request, await $context.MbPostFailedMessageText);
			return;
		}
		await completePosting(request, {entitySchemaName, recordId, logDataSourceName});
	}

	/**
	 * True when a changed page attribute (the Posted flag or the card mode) decides whether Post is available.
	 */
	function isPostStateChange(attributeName) {
		return POST_STATE_ATTRIBUTES.has(attributeName);
	}

	/**
	 * The Post action of a note page whose History list is the standard document log list of the note pages.
	 */
	function postNoteWithHistory(request, entitySchemaName) {
		return postNote(request, entitySchemaName, NOTE_HISTORY_DATA_SOURCE);
	}

	/**
	 * True for a page opened with Add (a new record), not for edit or copy mode.
	 */
	function isAddMode(cardState) {
		return cardState === CARD_STATE_ADD;
	}

	/**
	 * True for a page opened on a saved record (edit mode), not for add or copy mode.
	 */
	function isEditMode(cardState) {
		return cardState === CARD_STATE_EDIT;
	}

	const aggregate = (aggregationType, path) => ({
		expression: {expressionType: 1, functionType: 2, aggregationType, functionArgument: column(path)}
	});

	const contractItemsQuery = (contractId, columns, extraFilters = {}) => ({
		rootSchemaName: CONTRACT_ITEM_ENTITY,
		operationType: 0,
		allColumns: false,
		columns: {items: columns},
		filters: filterGroup(CONTRACT_ITEM_ENTITY, {
			Contract: equalFilter("MbContract", DATA_VALUE_TYPE_GUID, contractId),
			...extraFilters
		})
	});

	/**
	 * Sum of Total and number of the ACTIVE items of a contract, in one aggregate server query.
	 * Returns null when the query failed.
	 */
	async function readActiveItemsSummary(contractId) {
		const result = await sendDataServiceQuery(SELECT_QUERY_PATH, contractItemsQuery(contractId, {
			Total: aggregate(AGGREGATION_SUM, "MbTotal"),
			ActiveCount: aggregate(AGGREGATION_COUNT, "Id")
		}, {Active: equalFilter("MbIsActive", DATA_VALUE_TYPE_BOOLEAN, true)}));
		const row = result?.rows?.[0];
		return row ? {total: row.Total || 0, activeCount: row.ActiveCount || 0} : null;
	}

	/**
	 * What the items of a contract look like now (how many there are and when one was last saved), in one
	 * aggregate server query, so a reload of the list can tell whether an item was added, changed or deleted.
	 * Returns null when the query failed.
	 */
	async function readItemsChangeStamp(contractId) {
		const result = await sendDataServiceQuery(SELECT_QUERY_PATH, contractItemsQuery(contractId, {
			ItemCount: aggregate(AGGREGATION_COUNT, "Id"),
			LastModified: aggregate(AGGREGATION_MAX, "ModifiedOn")
		}));
		const row = result?.rows?.[0];
		return row ? `${row.ItemCount || 0}|${row.LastModified || ""}` : null;
	}

	/**
	 * Starts the contract approval process for one contract, passing only its id, without saving the page and
	 * without waiting for the process. Returns true when the start was accepted, false when it failed.
	 */
	async function startApprovalProcess(request, contractId) {
		try {
			await processRequest(request, {
				type: "crt.RunBusinessProcessRequest",
				processName: APPROVAL_PROCESS_NAME,
				processRunType: "RegardlessOfThePage",
				saveAtProcessStart: false,
				showNotification: true,
				processParameters: {[APPROVAL_PROCESS_RECORD_PARAMETER]: contractId}
			});
			return true;
		} catch (e) {
			return false;
		}
	}

	return {
		applyNewNoteDate,
		refreshPostAvailability,
		postNote,
		isPostStateChange,
		postNoteWithHistory,
		isAddMode,
		isEditMode,
		processRequest,
		showMessage,
		readActiveItemsSummary,
		readItemsChangeStamp,
		recalculateContractAmount,
		startApprovalProcess,
		CONTRACT_ENTITY,
		CONTRACT_ITEM_ENTITY,
		CONTRACT_STATUS_DRAFT,
		CONTRACT_STATUS_CLOSED,
		APPROVAL_PROCESS_NAME,
		APPROVAL_PROCESS_RECORD_PARAMETER
	};
});

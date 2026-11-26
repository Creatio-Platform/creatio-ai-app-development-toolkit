define("UsrMbContractsV3App_MbReturnNoteFormPageModule", ["@creatio-devkit/common"], function(sdk) {
	"use strict";

	const CARD_STATE_ADD = "add";
	const CARD_STATE_EDIT = "edit";
	const DATA_VALUE_TYPE_GUID = 0;
	const DATA_VALUE_TYPE_BOOLEAN = 12;
	const SELECT_QUERY_PATH = "DataService/json/SyncReply/SelectQuery";
	const UPDATE_QUERY_PATH = "DataService/json/SyncReply/UpdateQuery";
	const LOG_ENTITY = "MbDocumentLog";
	const CONTRACT_ENTITY = "MbContract";
	const POSTED_LOG_PREFIX = "Posted document ";

	const idOf = (value) => (value && typeof value === "object" ? value.value : value);

	const column = (path) => ({expressionType: 0, columnPath: path});
	const parameter = (dataValueType, value) => ({expressionType: 2, parameter: {dataValueType, value}});
	const equalFilter = (path, dataValueType, value) => ({
		filterType: 1,
		comparisonType: 3,
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

	async function showMessage(request, message) {
		await sdk.HandlerChainService.instance.process({
			type: "crt.ShowDialogRequest",
			dialogConfig: {data: {message}},
			$context: request.$context,
			scopes: [...request.scopes]
		});
	}

	/**
	 * A new note opened in add mode with no date gets the current date and time.
	 */
	async function applyNewNoteDefaults($context) {
		if ((await $context.CardState) !== CARD_STATE_ADD) {
			return;
		}
		if (!(await $context.PDS_MbDate)) {
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
	async function writeLog(entitySchemaName, recordId, message) {
		try {
			const model = await sdk.Model.create(LOG_ENTITY);
			await model.insert({MbName: message, MbRecordId: recordId, MbEntityName: entitySchemaName});
			return true;
		} catch (e) {
			return false;
		}
	}

	const postedSum = (childSchemaName, valueColumn, flagColumn) => ({
		expression: {
			expressionType: 3,
			columnPath: "[" + childSchemaName + ":MbContract]." + valueColumn,
			functionType: 2,
			aggregationType: 2,
			subFilters: filterGroup(childSchemaName, {Flag: equalFilter(flagColumn, DATA_VALUE_TYPE_BOOLEAN, true)})
		}
	});

	/**
	 * Reads the three totals of a contract in one server query: active items, posted delivery notes and
	 * posted return notes. Returns null when the query failed.
	 */
	async function readContractTotals(contractId) {
		const result = await sendDataServiceQuery(SELECT_QUERY_PATH, {
			rootSchemaName: CONTRACT_ENTITY,
			operationType: 0,
			allColumns: false,
			rowCount: 1,
			columns: {items: {
				Items: postedSum("MbContractItem", "MbTotal", "MbIsActive"),
				Deliveries: postedSum("MbDeliveryNote", "MbAmount", "MbIsPosted"),
				Returns: postedSum("MbReturnNote", "MbAmount", "MbIsPosted")
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
	 * Returns the new amount, or null when it could not be read or written (the stored amount is then unchanged).
	 */
	async function recalculateContractAmount(contractId) {
		const totals = await readContractTotals(contractId);
		if (!totals) {
			return null;
		}
		const amount = totals.items + totals.deliveries - totals.returns;
		try {
			const model = await sdk.Model.create(CONTRACT_ENTITY);
			await model.update({MbAmount: amount}, [{type: "primaryColumnValue", value: contractId}]);
			return amount;
		} catch (e) {
			return null;
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
	 * After the note is marked posted: the History line, the contract amount and the page.
	 * The amount rule reports no failure of its own: an unread total leaves the stored amount as it was.
	 */
	async function completePosting(request, entitySchemaName, recordId) {
		const {$context} = request;
		const [number, contract] = await Promise.all([$context.PDS_MbNumber, $context.PDS_MbContract]);
		const logged = await writeLog(entitySchemaName, recordId, POSTED_LOG_PREFIX + (number || ""));
		const contractId = idOf(contract);
		if (contractId) {
			await recalculateContractAmount(contractId);
		}
		await reloadNote(request);
		if (!logged) {
			await showMessage(request, await $context.MbLogFailedMessageText);
		}
	}

	/**
	 * The Post action: an already posted note is refused with a message; otherwise the page is saved,
	 * the stored note is marked posted only while still unposted, then logged and the contract recalculated.
	 */
	async function postDocument(request, entitySchemaName) {
		const {$context} = request;
		if (await $context.PDS_MbIsPosted) {
			await showMessage(request, await $context.MbAlreadyPostedMessageText);
			return false;
		}
		if (!(await saveNote(request))) {
			return false;
		}
		const recordId = idOf(await $context.Id);
		if (!(await markPosted(entitySchemaName, recordId))) {
			await showMessage(request, await $context.MbPostFailedMessageText);
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

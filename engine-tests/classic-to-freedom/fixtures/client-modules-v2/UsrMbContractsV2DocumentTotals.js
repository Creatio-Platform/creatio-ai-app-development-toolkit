/**
 * UsrMbContractsV2DocumentTotals - shared client logic of the "Contracts v2" app.
 * Holds the one definition of the contract amount rule and of the Post steps of a delivery or return note,
 * for the contract, delivery-note and return-note Freedom UI pages.
 * Each call receives the page's "@creatio-devkit/common" sdk and its request or $context; the module keeps no page state.
 */
define("UsrMbContractsV2DocumentTotals", [], function() {

	/* Rows read per request while summing; pages are read until a short one, so no row is left out. */
	const SUM_PAGE_SIZE = 500;
	/* Upper bound on pages: a data source that never returns a short page is an error, not an endless loop. */
	const SUM_MAX_PAGES = 10000;

	/* Builds the filter "MbContract = contractId AND <flag> = true". */
	async function createContractFlagFilter(sdk, contractId, flagColumnName) {
		const filters = new sdk.FilterGroup();
		await filters.addSchemaColumnFilterWithParameter(sdk.ComparisonType.Equal, "MbContract", contractId);
		await filters.addSchemaColumnFilterWithParameter(sdk.ComparisonType.Equal, flagColumnName, true);
		return filters;
	}

	/* Reads one page of rows; a failed read throws. */
	async function loadPage(sdk, model, filters, columnName, page) {
		const rows = (await model.load({
			attributes: ["Id", columnName],
			parameters: [{ type: sdk.ModelParameterType.Filter, value: filters }],
			options: {
				pagingConfig: { rowsOffset: page * SUM_PAGE_SIZE, rowCount: SUM_PAGE_SIZE },
				sortingConfig: { columns: [{ columnName: "Id", direction: "asc" }] }
			}
		})) ?? [];
		if (!Array.isArray(rows)) {
			throw new Error("UsrMbContractsV2DocumentTotals: " + columnName + " could not be read");
		}
		return rows;
	}

	/**
	 * SUM(column) over a contract's rows whose flag column is true; no rows gives 0.
	 * sdk.Model offers no aggregate query, so every matching row is read page by page (sorted by Id, so pages
	 * neither overlap nor skip) and added up in whole cents, which gives the server SUM without float drift.
	 * Any failed page read throws, so the caller leaves the amount alone.
	 */
	async function sumContractColumn(sdk, schemaName, columnName, flagColumnName, contractId) {
		const model = await sdk.Model.create(schemaName);
		const filters = await createContractFlagFilter(sdk, contractId, flagColumnName);
		let totalCents = 0;
		for (let page = 0; page < SUM_MAX_PAGES; page++) {
			const rows = await loadPage(sdk, model, filters, columnName, page);
			for (const row of rows) {
				totalCents += Math.round((Number(row[columnName]) || 0) * 100);
			}
			if (rows.length < SUM_PAGE_SIZE) {
				return totalCents / 100;
			}
		}
		throw new Error("UsrMbContractsV2DocumentTotals: " + schemaName + "." + columnName + " has more rows than can be summed");
	}

	/**
	 * Contract amount = totals of active items + amounts of posted delivery notes - amounts of posted return notes,
	 * stored in MbContract.MbAmount. Resolves to the stored amount, or to null when a sum could not be read
	 * (the amount is then left unchanged) or the write failed.
	 */
	async function recalculateContractAmount(sdk, contractId) {
		if (!contractId) {
			return null;
		}
		let amount;
		try {
			const [items, deliveries, returns] = await Promise.all([
				sumContractColumn(sdk, "MbContractItem", "MbTotal", "MbIsActive", contractId),
				sumContractColumn(sdk, "MbDeliveryNote", "MbAmount", "MbIsPosted", contractId),
				sumContractColumn(sdk, "MbReturnNote", "MbAmount", "MbIsPosted", contractId)
			]);
			amount = (Math.round(items * 100) + Math.round(deliveries * 100) - Math.round(returns * 100)) / 100;
		} catch (e) {
			return null;
		}
		try {
			const contractModel = await sdk.Model.create("MbContract");
			await contractModel.update({ MbAmount: amount },
				[{ type: sdk.ModelParameterType.PrimaryColumnValue, value: contractId }]);
		} catch (e) {
			return null;
		}
		return amount;
	}

	/* Post is enabled only on a saved (not added, not copied) note that is not posted yet. */
	function isPostEnabled(isPosted, cardState) {
		return !isPosted && Boolean(cardState) && cardState !== "add" && cardState !== "copy";
	}

	/* Sets the page's Post-enabled attribute from the note's posted flag and the page mode; restrictive until both are read. */
	async function refreshPostEnabled($context, options) {
		const dataSourceName = (options && options.dataSourceName) || "PDS";
		const enabledAttributeName = (options && options.enabledAttributeName) || "MbPostButtonEnabled";
		let enabled = false;
		try {
			const [isPosted, cardState] = await Promise.all([$context[dataSourceName + "_MbIsPosted"], $context.CardState]);
			enabled = isPostEnabled(isPosted, cardState);
		} catch (e) {
			enabled = false;
		}
		await $context.set(enabledAttributeName, enabled);
	}

	/* A note opened to be added (not copied) with an empty date gets the current date and time; any other case is left as it is. */
	async function setNewDocumentDate($context, dateAttributeName) {
		const [cardState, currentDate] = await Promise.all([$context.CardState, $context[dateAttributeName]]);
		if (cardState === "add" && !currentDate) {
			await $context.set(dateAttributeName, new Date());
		}
	}

	/* One MbDocumentLog line for the record. */
	async function writeLog(sdk, entityName, recordId, message) {
		const logModel = await sdk.Model.create("MbDocumentLog");
		await logModel.insert({ MbName: message, MbRecordId: recordId, MbEntityName: entityName });
	}

	/* Fires a request in the page's own context. */
	function processRequest(sdk, request, config) {
		return sdk.HandlerChainService.instance.process(Object.assign(config, {
			$context: request.$context,
			scopes: [...request.scopes]
		}));
	}

	function showMessage(sdk, request, message) {
		return processRequest(sdk, request, {
			type: "crt.ShowDialogRequest",
			dialogConfig: { data: { message: message } }
		});
	}

	/* Sets MbIsPosted = true only where the stored note is still unposted; true when exactly that write changed a row. */
	async function markPosted(sdk, entityName, recordId) {
		try {
			const noteModel = await sdk.Model.create(entityName);
			const guard = new sdk.FilterGroup();
			await guard.addSchemaColumnFilterWithParameter(sdk.ComparisonType.Equal, "Id", recordId);
			await guard.addSchemaColumnFilterWithParameter(sdk.ComparisonType.Equal, "MbIsPosted", false);
			const result = await noteModel.update({ MbIsPosted: true },
				[{ type: sdk.ModelParameterType.Filter, value: guard }]);
			return Boolean(result) && result.success !== false && Boolean(result.rowsAffected);
		} catch (e) {
			return false;
		}
	}

	/* After a successful post: show the note as posted, log it, reload History, recalculate the contract. */
	async function completePost(sdk, request, options, recordId) {
		const { $context } = request;
		const dataSourceName = options.dataSourceName || "PDS";
		await processRequest(sdk, request, { type: "crt.LoadDataRequest", dataSourceName: dataSourceName, config: { loadType: "reload" } });
		const [number, contract] = await Promise.all([$context[dataSourceName + "_MbNumber"], $context[dataSourceName + "_MbContract"]]);
		try {
			await writeLog(sdk, options.entityName, recordId, "Posted document " + (number || ""));
		} catch (e) {
			/* The log write does not stop the recalculation. */
		}
		if (options.historyDataSourceName) {
			await processRequest(sdk, request, { type: "crt.LoadDataRequest", dataSourceName: options.historyDataSourceName, config: { loadType: "reload" } });
		}
		if (contract && contract.value) {
			await recalculateContractAmount(sdk, contract.value);
		}
	}

	/**
	 * The Post steps of a delivery or return note.
	 * options: entityName (the page's entity, e.g. "MbReturnNote"), dataSourceName (primary data source, default "PDS"),
	 * historyDataSourceName (History list data source, optional), alreadyPostedMessage, postFailedMessage (resolved page strings).
	 * Resolves to true when the note was posted.
	 */
	async function postDocument(sdk, request, options) {
		const { $context } = request;
		const dataSourceName = options.dataSourceName || "PDS";
		if (await $context[dataSourceName + "_MbIsPosted"]) {
			await showMessage(sdk, request, options.alreadyPostedMessage);
			return false;
		}
		const saved = await processRequest(sdk, request, { type: "crt.SaveRecordRequest", preventCardClose: true, showSuccessMessage: false });
		if (saved === false) {
			return false;
		}
		const recordId = await $context.Id;
		if (!(await markPosted(sdk, options.entityName, recordId))) {
			await showMessage(sdk, request, options.postFailedMessage);
			return false;
		}
		await completePost(sdk, request, options, recordId);
		return true;
	}

	return {
		recalculateContractAmount: recalculateContractAmount,
		sumContractColumn: sumContractColumn,
		isPostEnabled: isPostEnabled,
		refreshPostEnabled: refreshPostEnabled,
		setNewDocumentDate: setNewDocumentDate,
		writeLog: writeLog,
		postDocument: postDocument
	};
});

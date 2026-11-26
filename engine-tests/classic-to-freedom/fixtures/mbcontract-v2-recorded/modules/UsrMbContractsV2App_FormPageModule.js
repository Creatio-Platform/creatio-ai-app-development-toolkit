/**
 * UsrMbContractsV2App_FormPageModule - logic of the "Contracts v2" contract record page
 * (UsrMbContractsV2App_FormPage). The page's handlers only route here; every call receives the page's
 * request or $context, so the module keeps no page state.
 */
define("UsrMbContractsV2App_FormPageModule", ["@creatio-devkit/common", "UsrMbContractsV2DocumentTotals"],
		function(sdk, documentTotals) {
	"use strict";

	/** MbContractStatus record ids the contract page compares against. */
	const CONTRACT_STATUS = Object.freeze({
		Draft: "6f0c4b2e-1d1a-4c3e-9a51-0b1c2d3e4f01",
		Closed: "6f0c4b2e-1d1a-4c3e-9a51-0b1c2d3e4f03"
	});

	/** System setting that holds the last contract number handed out. */
	const LAST_NUMBER_SETTING = "MbContractLastNumber";
	/** Digits the contract counter is padded to. */
	const NUMBER_DIGITS = 5;

	/** The Items list's data source: only its changes recalculate the contract amount. */
	const ITEMS_DATA_SOURCE = "MbContractItemDetailListDS";
	/** Marker on an Items reload that must not recalculate the amount (Deactivate selected, the refresh button). */
	const SKIP_RECALCULATION_FLAG = "mbSkipAmountRecalculation";

	/** Value attributes of the Items quick filters "Active only" and "Due in 30 days". */
	const ITEMS_QUICK_FILTER_VALUES = Object.freeze([
		"MbContractItemDetailQuickFilterByMbOnlyActive_Value",
		"MbContractItemDetailQuickFilterByMbDueSoon_Value"
	]);

	/** Page attributes whose change re-evaluates whether "Start approval" can be used. */
	const START_APPROVAL_INPUTS = Object.freeze(["CardState", "PDS_MbApproved"]);

	/** Business process "Approve contract", started by its code with the contract id. */
	const APPROVAL_PROCESS = Object.freeze({ name: "MbApproveContractProcess", contractIdParameter: "ContractId" });

	/** Page controls that only an editable (not Closed) contract may change. */
	const LOCKED_WHEN_CLOSED = Object.freeze(["PDS_MbAccount", "PDS_MbEndDate"]);

	/** Rows read per request when counting; pages are read until a short one. */
	const COUNT_PAGE_SIZE = 500;
	/** Upper bound on pages, so a data source that never returns a short page fails instead of looping. */
	const COUNT_MAX_PAGES = 10000;

	/** Days ahead the "Due in 30 days" filter looks. */
	const DUE_SOON_DAYS = 30;

	const idOf = (value) => (value && typeof value === "object" ? value.value : value);

	/** True while the contract is not Closed; an empty Status counts as not Closed. */
	function isEditableStatus(status) {
		return idOf(status) !== CONTRACT_STATUS.Closed;
	}

	/** Stores the page flag MbCanEditFields and locks or unlocks Customer and End date to match it. */
	async function applyCanEditFields($context, canEdit) {
		await $context.set("MbCanEditFields", canEdit);
		for (const attributeName of LOCKED_WHEN_CLOSED) {
			$context.setAttributePropertyValue(attributeName, "readonly", !canEdit);
		}
	}

	/** Re-evaluates the lock for a Status value the page already holds (a Status change). */
	async function updateCanEditFields($context, status) {
		await applyCanEditFields($context, isEditableStatus(status));
	}

	/**
	 * Re-evaluates the lock by reading Status from the page. Fails closed: when Status cannot be read the flag
	 * stays false, Customer and End date stay read-only, and the page tells the user why.
	 */
	async function refreshCanEditFields(request) {
		const { $context } = request;
		let canEdit = false;
		let failed = false;
		try {
			canEdit = isEditableStatus(await $context.PDS_MbStatus);
		} catch (e) {
			failed = true;
		}
		await applyCanEditFields($context, canEdit);
		if (failed) {
			await sdk.HandlerChainService.instance.process({
				type: "crt.ShowDialogRequest",
				dialogConfig: { data: { message: await $context.MbLockFailedText } },
				$context: $context,
				scopes: [...request.scopes]
			});
		}
	}

	/** Number of a contract's active items, read page by page (sdk.Model offers no aggregate query). */
	async function countActiveItems(contractId) {
		const model = await sdk.Model.create("MbContractItem");
		const filters = new sdk.FilterGroup();
		await filters.addSchemaColumnFilterWithParameter(sdk.ComparisonType.Equal, "MbContract", contractId);
		await filters.addSchemaColumnFilterWithParameter(sdk.ComparisonType.Equal, "MbIsActive", true);
		let count = 0;
		for (let page = 0; page < COUNT_MAX_PAGES; page++) {
			const rows = (await model.load({
				attributes: ["Id"],
				parameters: [{ type: sdk.ModelParameterType.Filter, value: filters }],
				options: {
					pagingConfig: { rowsOffset: page * COUNT_PAGE_SIZE, rowCount: COUNT_PAGE_SIZE },
					sortingConfig: { columns: [{ columnName: "Id", direction: "asc" }] }
				}
			})) ?? [];
			count += rows.length;
			if (rows.length < COUNT_PAGE_SIZE) {
				return count;
			}
		}
		throw new Error("UsrMbContractsV2App_FormPageModule: too many contract items to count");
	}

	/** Fills a "{0} ... {1}" template. */
	function formatTemplate(template, values) {
		return String(template || "").replace(/\{(\d+)\}/g, (match, index) => String(values[Number(index)] ?? ""));
	}

	/**
	 * Writes "Total: {0} | Active items: {1}" for the open contract into MbItemsSummary:
	 * the sum of Total over active items and their count. A failed read leaves the line unchanged.
	 */
	async function refreshItemsSummary($context) {
		const [contractId, template] = await Promise.all([$context.Id, $context.MbItemsSummaryTemplateText]);
		if (!contractId) {
			return;
		}
		try {
			const [total, activeCount] = await Promise.all([
				documentTotals.sumContractColumn(sdk, "MbContractItem", "MbTotal", "MbIsActive", contractId),
				countActiveItems(contractId)
			]);
			await $context.set("MbItemsSummary", formatTemplate(template, [total, activeCount]));
		} catch (e) {
			console.error("UsrMbContractsV2App_FormPageModule: the items summary could not be read.", e);
		}
	}

	/** Sets the Items list's "Due in 30 days" filter: delivery date up to now + 30 days while on, nothing while off. */
	async function setDueSoonFilter($context, isOn) {
		const items = {};
		if (isOn) {
			const limit = new Date();
			limit.setDate(limit.getDate() + DUE_SOON_DAYS);
			items.MbDueSoonFilter = {
				filterType: 1,
				comparisonType: 6,
				isEnabled: true,
				trimDateTimeParameterToDate: false,
				dataValueType: 7,
				leftExpression: { expressionType: 0, columnPath: "MbDeliveryDate" },
				rightExpression: { expressionType: 2, parameter: { dataValueType: 7, value: JSON.stringify(limit.toISOString()) } }
			};
		}
		await $context.set("MbItemsDueSoonFilter", {
			items: items, logicalOperation: 0, isEnabled: true, filterType: 6, rootSchemaName: "MbContractItem"
		});
	}

	/**
	 * Ids of the ticked item rows. After "select all" the selection holds the rows left out, so the ids are
	 * the loaded rows minus those - what Classic's select-all ticked.
	 */
	async function getSelectedItemIds($context) {
		const [selectionState, rows] = await Promise.all([
			$context.MbContractItemDetailList_SelectionState,
			$context.MbContractItemDetailList
		]);
		if (!selectionState) {
			return [];
		}
		if (selectionState.type === "specific") {
			return Array.isArray(selectionState.selected) ? selectionState.selected : [];
		}
		if (selectionState.type === "all") {
			const left = new Set(selectionState.unselected || []);
			const loaded = rows && typeof rows.toArray === "function" ? rows.toArray() : Array.from(rows || []);
			const ids = await Promise.all(loaded.map((row) => row.MbContractItemDetailListDS_Id));
			return ids.filter((id) => id && !left.has(id));
		}
		return [];
	}

	/** True while "Deactivate selected" has no ticked row to act on. */
	function isItemSelectionEmpty(selectionState) {
		if (!selectionState) {
			return true;
		}
		if (selectionState.type === "all") {
			return false;
		}
		return !(Array.isArray(selectionState.selected) && selectionState.selected.length);
	}

	/**
	 * Unticks Active on every ticked contract item (one update per item; a failed one does not stop the rest),
	 * then reloads the Items list once. The contract amount is not recalculated.
	 */
	async function deactivateSelectedItems(request) {
		const ids = await getSelectedItemIds(request.$context);
		if (!ids.length) {
			return;
		}
		const model = await sdk.Model.create("MbContractItem");
		for (const id of ids) {
			try {
				await model.update({ MbIsActive: false }, [{ type: "primaryColumnValue", value: id }]);
			} catch (e) {
				console.error("Contract item " + id + " was not deactivated.", e);
			}
		}
		await sdk.HandlerChainService.instance.process({
			type: "crt.LoadDataRequest",
			dataSourceName: ITEMS_DATA_SOURCE,
			config: { loadType: "reload", useLastLoadParameters: true },
			[SKIP_RECALCULATION_FLAG]: true,
			$context: request.$context,
			scopes: [...request.scopes]
		});
	}

	/**
	 * Turns the Items quick filters off when a contract opens, so they start off on every visit even where the
	 * platform restored a chip value from the user's profile.
	 */
	async function resetItemsQuickFilters($context) {
		for (const valueAttributeName of ITEMS_QUICK_FILTER_VALUES) {
			if (await $context[valueAttributeName]) {
				await $context.set(valueAttributeName, false);
			}
		}
	}

	/** True when the page was opened to add a new contract (not to open or copy one). */
	async function isAddMode($context) {
		return (await $context.CardState) === "add";
	}

	/** Display name of a status record; the page's localizable fallback when it cannot be read. */
	async function readStatusCaption(statusId, fallback) {
		try {
			const model = await sdk.Model.create("MbContractStatus");
			const filters = new sdk.FilterGroup();
			await filters.addSchemaColumnFilterWithParameter(sdk.ComparisonType.Equal, "Id", statusId);
			const rows = await model.load({
				attributes: ["Id", "Name"],
				parameters: [{ type: sdk.ModelParameterType.Filter, value: filters }]
			});
			return (rows && rows.length && rows[0].Name) || fallback;
		} catch (e) {
			return fallback;
		}
	}

	/** A new contract starts as Draft (by its record id). */
	async function setDraftStatus($context) {
		const caption = await readStatusCaption(CONTRACT_STATUS.Draft, await $context.MbDraftStatusText);
		await $context.set("PDS_MbStatus", { value: CONTRACT_STATUS.Draft, displayValue: caption });
	}

	/** The next counter: the stored last number plus 1; an empty or non-numeric value counts as 0. */
	function nextCounter(lastNumber) {
		return (Number.parseInt(lastNumber, 10) || 0) + 1;
	}

	/**
	 * Takes the next contract number from the "Contract last number" setting and writes the new value back at
	 * once, before and independently of saving the contract; Number shows it through the localizable "C-{0}"
	 * pattern, the counter padded to 5 digits.
	 */
	async function assignNextContractNumber($context) {
		const settings = new sdk.SysSettingsService();
		try {
			const setting = await settings.getByCode(LAST_NUMBER_SETTING);
			const next = nextCounter(setting && typeof setting === "object" ? setting.value : setting);
			await settings.update({ code: LAST_NUMBER_SETTING, value: next });
			const format = await $context.MbNumberFormatText;
			await $context.set("PDS_MbNumber", formatTemplate(format, [String(next).padStart(NUMBER_DIGITS, "0")]));
		} catch (e) {
			console.error("UsrMbContractsV2App_FormPageModule: the next contract number could not be assigned.", e);
		}
	}

	/**
	 * True for an Items list reload that follows a changed item (an item saved from its page opened from the
	 * list): not the list's first load or paging, not another list, and not a reload marked to skip it.
	 */
	function isItemsChangeReload(request) {
		return request.dataSourceName === ITEMS_DATA_SOURCE
			&& Boolean(request.config) && request.config.loadType === "reload"
			&& !request[SKIP_RECALCULATION_FLAG];
	}

	/**
	 * Recalculates the contract amount with the one shared rule and shows the stored amount in Amount.
	 * When a sum cannot be read the stored amount is not changed and the field is left as it is.
	 */
	async function recalculateAmount($context) {
		const contractId = await $context.Id;
		const amount = await documentTotals.recalculateContractAmount(sdk, contractId);
		if (amount === null || amount === undefined) {
			return;
		}
		if (Number(await $context.PDS_MbAmount) !== amount) {
			await $context.set("PDS_MbAmount", amount);
		}
	}

	/** "Start approval" can be used only on a saved contract (not added or copied) that is not approved. */
	async function isStartApprovalEnabled($context) {
		const [cardState, isApproved] = await Promise.all([$context.CardState, $context.PDS_MbApproved]);
		return Boolean(cardState) && cardState !== "add" && cardState !== "copy" && !isApproved;
	}

	/** Disables "Start approval" while it cannot be used; stays disabled when the check fails. */
	async function refreshStartApprovalEnabled($context) {
		let enabled = false;
		try {
			enabled = await isStartApprovalEnabled($context);
		} catch (e) {
			enabled = false;
		}
		await $context.set("MbStartApprovalButtonDisabled", !enabled);
	}

	/** True when a changed page attribute affects "Start approval". */
	function isStartApprovalInput(attributeName) {
		return START_APPROVAL_INPUTS.includes(attributeName);
	}

	/**
	 * Starts the approval process for the open contract: on a contract that is not saved or already approved
	 * only shows "This contract is already approved."; otherwise runs the process by its code with
	 * ContractId = the contract id, without saving the page first. The platform shows the start notification.
	 */
	async function startApproval(request) {
		const { $context } = request;
		const scopes = [...request.scopes];
		if (!(await isStartApprovalEnabled($context))) {
			await sdk.HandlerChainService.instance.process({
				type: "crt.ShowDialogRequest",
				dialogConfig: { data: { message: await $context.MbAlreadyApprovedText } },
				$context: $context,
				scopes: scopes
			});
			return;
		}
		await sdk.HandlerChainService.instance.process({
			type: "crt.RunBusinessProcessRequest",
			processName: APPROVAL_PROCESS.name,
			processRunType: "ForTheSelectedPage",
			recordIdProcessParameterName: APPROVAL_PROCESS.contractIdParameter,
			saveAtProcessStart: false,
			showNotification: true,
			$context: $context,
			scopes: scopes
		});
	}

	return {
		ITEMS_DATA_SOURCE: ITEMS_DATA_SOURCE,
		resetItemsQuickFilters: resetItemsQuickFilters,
		isAddMode: isAddMode,
		setDraftStatus: setDraftStatus,
		assignNextContractNumber: assignNextContractNumber,
		isItemsChangeReload: isItemsChangeReload,
		recalculateAmount: recalculateAmount,
		refreshStartApprovalEnabled: refreshStartApprovalEnabled,
		isStartApprovalInput: isStartApprovalInput,
		startApproval: startApproval,
		CONTRACT_STATUS: CONTRACT_STATUS,
		isEditableStatus: isEditableStatus,
		updateCanEditFields: updateCanEditFields,
		refreshCanEditFields: refreshCanEditFields,
		refreshItemsSummary: refreshItemsSummary,
		setDueSoonFilter: setDueSoonFilter,
		isItemSelectionEmpty: isItemSelectionEmpty,
		deactivateSelectedItems: deactivateSelectedItems
	};
});

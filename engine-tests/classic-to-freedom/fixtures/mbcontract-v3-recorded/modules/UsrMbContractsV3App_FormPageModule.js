define("UsrMbContractsV3App_FormPageModule", ["@creatio-devkit/common", "UsrMbContractsV3App_ContractAmountModule"],
function(sdk, contractAmount) {
	"use strict";

	const {CONTRACT_STATUS_CLOSED, APPROVAL_PROCESS_NAME, APPROVAL_PROCESS_RECORD_PARAMETER} = contractAmount;

	const CONTRACT_STATUS_DRAFT = "6f0c4b2e-1d1a-4c3e-9a51-0b1c2d3e4f01";
	const CARD_STATE_ADD = "add";
	const CARD_STATE_EDIT = "edit";
	const LAST_NUMBER_SETTING = "MbContractLastNumber";
	const NUMBER_DIGITS = 5;
	const ITEM_ENTITY = "MbContractItem";
	const ITEMS_DATA_SOURCE = "MbContractItemDS";
	const ITEMS_GRID = "MbContractItemDetailGrid";
	const ITEMS_SELECTION_ATTRIBUTE = "MbContractItemDetailGrid_SelectionState";
	const START_APPROVAL_INPUTS = ["PDS_MbApproved", "CardState"];
	const DATA_VALUE_TYPE_GUID = 0;
	const DATA_VALUE_TYPE_BOOLEAN = 12;
	const AGGREGATION_COUNT = 1;
	const AGGREGATION_SUM = 2;
	const AGGREGATION_MAX = 5;
	const CHILD_CONTRACT_COLUMN = "MbContract";
	// The page each related list of this page opens, by the list's grid and by its object. The object-wide page
	// setting belongs to the earlier apps and is left as it is.
	const CHILD_LISTS = [
		{grid: ITEMS_GRID, entity: ITEM_ENTITY, page: "UsrMbContractsV3App_MbContractItemMiniPage"},
		{grid: "MbDeliveryNoteDetailGrid", entity: "MbDeliveryNote", page: "UsrMbContractsV3App_MbDeliveryNoteFormPage"},
		{grid: "MbReturnNoteDetailGrid", entity: "MbReturnNote", page: "UsrMbContractsV3App_MbReturnNoteFormPage"}
	];

	const formatTemplate = (template, values) =>
		String(template || "").replace(/\{(\d+)\}/g, (match, index) => String(values[Number(index)] ?? ""));

	const aggregate = (aggregationType, path) => ({
		expression: {expressionType: 1, functionType: 2, aggregationType, functionArgument: contractAmount.column(path)}
	});

	/**
	 * Customer and End date are editable unless the contract is Closed; an empty Status counts as not Closed.
	 * The flag is page state only and starts locked (the page attribute default) until this sets it.
	 */
	async function refreshCanEditFields($context) {
		const status = (await $context.PDS_MbStatus)?.value;
		await $context.set("MbCanEditFields", status !== CONTRACT_STATUS_CLOSED);
	}

	/**
	 * Start approval is allowed only for a saved contract (not one being added or copied) that is not Approved.
	 */
	async function canStartApproval($context) {
		const [cardState, approved] = await Promise.all([$context.CardState, $context.PDS_MbApproved]);
		return cardState === CARD_STATE_EDIT && !approved;
	}

	/**
	 * Keeps the Start approval button disabled unless the contract can be sent for approval. The page attribute
	 * starts disabled until this has run.
	 */
	async function refreshStartApprovalAvailability($context) {
		await $context.set("MbStartApprovalDisabled", !(await canStartApproval($context)));
	}

	function isStartApprovalInput(attributeName) {
		return START_APPROVAL_INPUTS.includes(attributeName);
	}

	/**
	 * Starts the contract approval process for the open contract, passing only its id. A new, copied or approved
	 * contract is refused with a message and nothing starts. Pending changes are not saved and the page does not
	 * wait for the process. A start that fails is reported to the user here.
	 */
	async function startApproval(request) {
		const {$context} = request;
		if (!(await canStartApproval($context))) {
			await contractAmount.showMessage(request, await $context.MbAlreadyApprovedMessageText);
			return;
		}
		try {
			await sdk.HandlerChainService.instance.process({
				type: "crt.RunBusinessProcessRequest",
				processName: APPROVAL_PROCESS_NAME,
				processRunType: "RegardlessOfThePage",
				saveAtProcessStart: false,
				showNotification: true,
				processParameters: {[APPROVAL_PROCESS_RECORD_PARAMETER]: await $context.Id},
				$context,
				scopes: [...request.scopes]
			});
		} catch (e) {
			await contractAmount.showMessage(request, await $context.MbStartApprovalFailedMessageText);
		}
	}

	/**
	 * Reads the "Contract last number" setting and returns the next number (an empty or non-numeric value
	 * counts as 0), or null when the setting could not be read.
	 */
	async function readNextContractNumber() {
		try {
			const setting = await new sdk.SysSettingsService().getByCode(LAST_NUMBER_SETTING);
			return (Number.parseInt(String(setting?.value ?? ""), 10) || 0) + 1;
		} catch (e) {
			return null;
		}
	}

	/**
	 * Writes the number taken back to the setting. Returns true when it was stored.
	 */
	async function storeLastContractNumber(next) {
		try {
			await new sdk.SysSettingsService().update({code: LAST_NUMBER_SETTING, value: next});
			return true;
		} catch (e) {
			return false;
		}
	}

	/**
	 * Takes the next contract number and fills Number as "C-" plus the value padded to 5 digits. The number is
	 * shown only once the setting holds it; when it cannot be read or stored, Number stays empty and the user
	 * is told.
	 */
	async function assignContractNumber(request) {
		const {$context} = request;
		const next = await readNextContractNumber();
		if (next === null || !(await storeLastContractNumber(next))) {
			await contractAmount.showMessage(request, await $context.MbNumberNotAssignedMessageText);
			return;
		}
		const format = await $context.MbNumberFormatText;
		await $context.set("PDS_MbNumber", formatTemplate(format, [String(next).padStart(NUMBER_DIGITS, "0")]));
	}

	/**
	 * Only for a contract being added (not opened or copied): Status becomes Draft and Number gets the next value.
	 */
	async function initNewContract(request) {
		const {$context} = request;
		if ((await $context.CardState) !== CARD_STATE_ADD) {
			return;
		}
		await $context.set("PDS_MbStatus", {value: CONTRACT_STATUS_DRAFT, displayValue: await $context.MbDraftStatusText});
		await assignContractNumber(request);
	}

	const contractItemsQuery = (contractId, columns, extraFilters = {}) => ({
		rootSchemaName: ITEM_ENTITY,
		operationType: 0,
		allColumns: false,
		columns: {items: columns},
		filters: contractAmount.filterGroup(ITEM_ENTITY, {
			Contract: contractAmount.equalFilter("MbContract", DATA_VALUE_TYPE_GUID, contractId),
			...extraFilters
		})
	});

	/**
	 * Sum of Total and number of ACTIVE items of the contract, in one aggregate query.
	 * Returns null when the query failed.
	 */
	async function readActiveItemsSummary(contractId) {
		const result = await contractAmount.selectQuery(contractItemsQuery(contractId, {
			Total: aggregate(AGGREGATION_SUM, "MbTotal"),
			ActiveCount: aggregate(AGGREGATION_COUNT, "Id")
		}, {Active: contractAmount.equalFilter("MbIsActive", DATA_VALUE_TYPE_BOOLEAN, true)}));
		const row = result?.rows?.[0];
		return row ? {total: row.Total || 0, activeCount: row.ActiveCount || 0} : null;
	}

	async function readSavedContractId($context) {
		const [contractId, cardState] = await Promise.all([$context.Id, $context.CardState]);
		return contractId && cardState === CARD_STATE_EDIT ? contractId : null;
	}

	/**
	 * Fills the summary label above the Items list ("Total: {0} | Active items: {1}") from the active items of
	 * the open contract. A new contract, or a failed read, leaves the label as it is.
	 */
	async function refreshItemsSummary($context) {
		const contractId = await readSavedContractId($context);
		const summary = contractId ? await readActiveItemsSummary(contractId) : null;
		if (!summary) {
			return;
		}
		const template = await $context.MbItemsSummaryTemplateText;
		await $context.set("MbItemsSummary", formatTemplate(template, [summary.total, summary.activeCount]));
	}

	/**
	 * What the contract's items look like now — how many there are and when one was last saved — in one
	 * aggregate query, so a reload can tell whether an item was added, changed or deleted. Null when unread.
	 */
	async function readItemsChangeStamp(contractId) {
		const result = await contractAmount.selectQuery(contractItemsQuery(contractId, {
			ItemCount: aggregate(AGGREGATION_COUNT, "Id"),
			LastModified: aggregate(AGGREGATION_MAX, "ModifiedOn")
		}));
		const row = result?.rows?.[0];
		return row ? `${row.ItemCount || 0}|${row.LastModified || ""}` : null;
	}

	/**
	 * Recalculates the contract amount and shows it in the Amount field. A total that cannot be read changes
	 * nothing and shows nothing; a failed write is reported.
	 */
	async function recalculateAmount(request, contractId) {
		const outcome = await contractAmount.recalculateContractAmount(contractId);
		if (outcome.success) {
			await request.$context.set("PDS_MbAmount", outcome.amount);
		} else if (outcome.writeFailed) {
			await contractAmount.showMessage(request, await request.$context.MbAmountNotRecalculatedMessageText);
		}
	}

	/**
	 * Runs when the Items list reloads. The first load of the page only records how the items look; a later
	 * reload whose items differ (an item added, saved, deleted or deactivated) recalculates the contract amount.
	 */
	async function recalculateAmountOnItemsChange(request) {
		const {$context} = request;
		const contractId = await readSavedContractId($context);
		const stamp = contractId ? await readItemsChangeStamp(contractId) : null;
		if (!stamp) {
			return;
		}
		const previous = await $context.MbItemsChangeStamp;
		if (previous === stamp) {
			return;
		}
		await $context.set("MbItemsChangeStamp", stamp);
		if (previous) {
			await recalculateAmount(request, contractId);
		}
	}

	/**
	 * "Deactivate selected" is available only while at least one item row is selected.
	 */
	async function refreshDeactivateAvailability($context) {
		const selection = await $context[ITEMS_SELECTION_ATTRIBUTE];
		const anySelected = selection?.type === "all" || (selection?.selected?.length || 0) > 0;
		await $context.set("MbDeactivateSelectedDisabled", !anySelected);
	}

	/**
	 * The ids the user selected in the Items list. After "select all" these are the contract's items except the
	 * rows the user unselected again.
	 */
	async function readSelectedItemIds($context) {
		const selection = await $context[ITEMS_SELECTION_ATTRIBUTE];
		if (selection?.type !== "all") {
			return [...(selection?.selected || [])];
		}
		const unselected = new Set(selection.unselected || []);
		const model = await sdk.Model.create(ITEM_ENTITY);
		const filter = new sdk.FilterGroup();
		filter.addSchemaColumnFilterWithParameter(sdk.ComparisonType.Equal, "MbContract", await $context.Id);
		const rows = await model.load({attributes: ["Id"], parameters: [{type: sdk.ModelParameterType.Filter, value: filter}]});
		return rows.map((row) => row.Id).filter((id) => !unselected.has(id));
	}

	/**
	 * Sets Active = false on every selected item, goes on past a failed one and counts the failures.
	 */
	async function deactivateItems(ids) {
		const model = await sdk.Model.create(ITEM_ENTITY);
		let failed = 0;
		for (const id of ids) {
			try {
				await model.update({MbIsActive: false}, [{type: "primaryColumnValue", value: id}]);
			} catch (e) {
				failed++;
			}
		}
		return {total: ids.length, failed};
	}

	/**
	 * "Deactivate selected": deactivates the selected items, tells the user how many failed, then reloads the
	 * Items list once (the reload recalculates the contract amount). Every failure is reported to the user here.
	 */
	async function deactivateSelectedItems(request) {
		const $context = request.$context;
		let ids;
		try {
			ids = await readSelectedItemIds($context);
		} catch (e) {
			await contractAmount.showMessage(request, await $context.MbDeactivateReadFailedMessageText);
			return;
		}
		if (!ids.length) {
			return;
		}
		const outcome = await deactivateItems(ids);
		if (outcome.failed) {
			const template = await $context.MbDeactivateFailedMessageText;
			await contractAmount.showMessage(request, formatTemplate(template, [outcome.failed, outcome.total]));
		}
		await sdk.HandlerChainService.instance.process({
			type: "crt.LoadDataRequest",
			dataSourceName: ITEMS_DATA_SOURCE,
			config: {loadType: "reload"},
			$context,
			scopes: [...request.scopes]
		});
	}

	/**
	 * The page this app opens for a record of the Items, Delivery notes or Return notes list: matched by the
	 * list the request came from, or by the record's object. Null for any other record.
	 */
	function childPageOf(request) {
		const list = request.itemsAttributeName
			? CHILD_LISTS.find((child) => child.grid === request.itemsAttributeName)
			: CHILD_LISTS.find((child) => child.entity === request.entityName);
		return list?.page ?? null;
	}

	/**
	 * Opens an existing record of one of those lists on this app's own page, in edit mode.
	 */
	function openChildPage(request, schemaName) {
		return sdk.HandlerChainService.instance.process({
			type: "crt.OpenPageRequest",
			schemaName,
			modelInitConfigs: [{action: "edit", recordId: request.recordId}],
			$context: request.$context,
			scopes: [...request.scopes]
		});
	}

	/**
	 * Add from one of those lists opens this app's own page for the new record, linked to the open contract.
	 * A request that already names a page, or comes from another list, is left as it is.
	 */
	async function useChildPageForAdd(request) {
		const schemaName = childPageOf(request);
		if (!schemaName || request.entityPageName) {
			return;
		}
		request.entityPageName = schemaName;
		const defaults = request.defaultValues || [];
		if (!defaults.some((entry) => entry.attributeName === CHILD_CONTRACT_COLUMN)) {
			request.defaultValues = [...defaults, {attributeName: CHILD_CONTRACT_COLUMN, value: await request.$context.Id}];
		}
	}

	return {
		ITEMS_GRID,
		childPageOf,
		openChildPage,
		useChildPageForAdd,
		ITEMS_DATA_SOURCE,
		ITEMS_SELECTION_ATTRIBUTE,
		refreshCanEditFields,
		refreshStartApprovalAvailability,
		isStartApprovalInput,
		startApproval,
		initNewContract,
		refreshItemsSummary,
		recalculateAmountOnItemsChange,
		refreshDeactivateAvailability,
		deactivateSelectedItems
	};
});

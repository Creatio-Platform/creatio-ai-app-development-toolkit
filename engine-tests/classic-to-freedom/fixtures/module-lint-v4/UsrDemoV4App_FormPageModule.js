define("UsrDemoV4App_FormPageModule", ["@creatio-devkit/common", "UsrDemoV4App_SharedModule"],
function(sdk, shared) {
	"use strict";

	const ITEMS_DATA_SOURCE = "DemoContractItemDS";
	const ITEMS_GRID = "DemoContractItemDetailGrid";
	const ITEMS_SELECTION_ATTRIBUTE = "DemoContractItemDetailGrid_SelectionState";
	const START_APPROVAL_INPUTS = new Set(["PDS_DemoApproved", "CardState"]);
	const CHILD_CONTRACT_COLUMN = "DemoContract";
	const LAST_NUMBER_SETTING = "DemoContractLastNumber";
	const NUMBER_DIGITS = 5;
	// The page each related list of this page opens, by the list's grid and by its object. The object-wide page
	// setting belongs to the earlier apps and is left as it is.
	const CHILD_LISTS = [
		{grid: ITEMS_GRID, entity: shared.CONTRACT_ITEM_ENTITY, page: "UsrDemoV4App_DemoContractItemMiniPage"},
		{grid: "DemoDeliveryNoteDetailGrid", entity: "DemoDeliveryNote", page: "UsrDemoV4App_DemoDeliveryNoteFormPage"},
		{grid: "DemoReturnNoteDetailGrid", entity: "DemoReturnNote", page: "UsrDemoV4App_DemoReturnNoteFormPage"}
	];

	const formatTemplate = (template, values) =>
		String(template || "").replace(/\{(\d+)\}/g, (match, index) => String(values[Number(index)] ?? ""));

	/**
	 * Customer and End date are editable unless the contract is Closed (by its id); an empty Status counts as
	 * not Closed. The flag is page state only and starts locked (the page attribute default) until this sets it.
	 */
	async function refreshCanEditFields($context) {
		const status = (await $context.PDS_DemoStatus)?.value;
		await $context.set("DemoCanEditFields", status !== shared.CONTRACT_STATUS_CLOSED);
	}

	function isStatusChange(attributeName) {
		return attributeName === "PDS_DemoStatus";
	}

	/**
	 * Start approval is allowed only for a saved contract (not one being added or copied) that is not Approved.
	 */
	async function canStartApproval($context) {
		const [cardState, approved] = await Promise.all([$context.CardState, $context.PDS_DemoApproved]);
		return shared.isEditMode(cardState) && !approved;
	}

	/**
	 * Keeps the Start approval button disabled unless the contract can be sent for approval. The page attribute
	 * starts disabled until this has run.
	 */
	async function refreshStartApprovalAvailability($context) {
		await $context.set("DemoStartApprovalDisabled", !(await canStartApproval($context)));
	}

	function isStartApprovalInput(attributeName) {
		return START_APPROVAL_INPUTS.has(attributeName);
	}

	/**
	 * Starts the contract approval process for the open contract, passing only its id. A new, copied or approved
	 * contract is refused with a message and nothing starts. Pending changes are not saved first (the shared
	 * start does not save). A start that fails is reported to the user here.
	 */
	async function startApproval(request) {
		const {$context} = request;
		if (!(await canStartApproval($context))) {
			await shared.showMessage(request, await $context.DemoAlreadyApprovedMessageText);
			return;
		}
		if (!(await shared.startApprovalProcess(request, await $context.Id))) {
			await shared.showMessage(request, await $context.DemoStartApprovalFailedMessageText);
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
	 * Takes the next contract number and fills Number as the number format ("C-{0}") with the value padded to
	 * 5 digits. Number is filled only once the setting holds the new value; when it cannot be read or stored,
	 * Number stays empty and the user is told.
	 */
	async function assignContractNumber(request) {
		const {$context} = request;
		const next = await readNextContractNumber();
		if (next === null || !(await storeLastContractNumber(next))) {
			await shared.showMessage(request, await $context.DemoNumberNotAssignedMessageText);
			return;
		}
		const format = await $context.DemoNumberFormatText;
		await $context.set("PDS_DemoNumber", formatTemplate(format, [String(next).padStart(NUMBER_DIGITS, "0")]));
	}

	/**
	 * Only for a contract being added (not opened or copied): Status becomes Draft and Number gets the next value.
	 */
	async function initNewContract(request) {
		const {$context} = request;
		if (!shared.isAddMode(await $context.CardState)) {
			return;
		}
		await $context.set("PDS_DemoStatus", {value: shared.CONTRACT_STATUS_DRAFT, displayValue: await $context.DemoDraftStatusText});
		await assignContractNumber(request);
	}

	async function readSavedContractId($context) {
		const [contractId, cardState] = await Promise.all([$context.Id, $context.CardState]);
		return contractId && shared.isEditMode(cardState) ? contractId : null;
	}

	/**
	 * Fills the summary label above the Items list ("Total: {0} | Active items: {1}") from the active items of
	 * the open contract. A new contract, or a failed read, leaves the label as it is.
	 */
	async function refreshItemsSummary($context) {
		const contractId = await readSavedContractId($context);
		const summary = contractId ? await shared.readActiveItemsSummary(contractId) : null;
		if (!summary) {
			return;
		}
		const template = await $context.DemoItemsSummaryTemplateText;
		await $context.set("DemoItemsSummary", formatTemplate(template, [summary.total, summary.activeCount]));
	}

	/**
	 * True for a request that (re)loads the Items list or changes its rows.
	 */
	function isItemsListChange(request) {
		return request.attributeName === ITEMS_GRID || request.dataSourceName === ITEMS_DATA_SOURCE;
	}

	/**
	 * Recalculates the contract amount (active items + posted delivery notes - posted return notes), writes it
	 * to the contract and shows it in the Amount field. When it cannot be recalculated, Amount is left as it is
	 * and the user is told.
	 */
	async function recalculateAmount(request, contractId) {
		const outcome = await shared.recalculateContractAmount(contractId);
		if (outcome.success) {
			await request.$context.set("PDS_DemoAmount", outcome.amount);
		} else {
			await shared.showMessage(request, await request.$context.DemoAmountNotRecalculatedMessageText);
		}
	}

	/**
	 * Runs when the Items list reloads or its rows change. The first load of the page only records how the
	 * contract's items look; a later reload whose items differ (an item added, saved, deleted or deactivated)
	 * recalculates the contract amount. Paging or reopening the page with unchanged items writes nothing.
	 */
	async function recalculateAmountOnItemsChange(request) {
		const {$context} = request;
		const contractId = await readSavedContractId($context);
		const stamp = contractId ? await shared.readItemsChangeStamp(contractId) : null;
		if (!stamp) {
			return;
		}
		const previous = await $context.DemoItemsChangeStamp;
		if (previous === stamp) {
			return;
		}
		await $context.set("DemoItemsChangeStamp", stamp);
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
		await $context.set("DemoDeactivateSelectedDisabled", !anySelected);
	}

	function isItemsSelectionChange(attributeName) {
		return attributeName === ITEMS_SELECTION_ATTRIBUTE;
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
		const model = await sdk.Model.create(shared.CONTRACT_ITEM_ENTITY);
		const filter = new sdk.FilterGroup();
		filter.addSchemaColumnFilterWithParameter(sdk.ComparisonType.Equal, CHILD_CONTRACT_COLUMN, await $context.Id);
		const rows = await model.load({attributes: ["Id"], parameters: [{type: sdk.ModelParameterType.Filter, value: filter}]});
		return rows.map((row) => row.Id).filter((id) => !unselected.has(id));
	}

	/**
	 * Sets Active = false on every selected item, goes on past a failed one and counts the failures.
	 */
	async function deactivateItems(ids) {
		const model = await sdk.Model.create(shared.CONTRACT_ITEM_ENTITY);
		let failed = 0;
		for (const id of ids) {
			try {
				await model.update({DemoIsActive: false}, [{type: "primaryColumnValue", value: id}]);
			} catch (e) {
				failed++;
			}
		}
		return {total: ids.length, failed};
	}

	/**
	 * "Deactivate selected": deactivates the selected items, tells the user how many failed, then reloads the
	 * Items list once. Every failure is reported to the user here.
	 */
	async function deactivateSelectedItems(request) {
		const {$context} = request;
		let ids;
		try {
			ids = await readSelectedItemIds($context);
		} catch (e) {
			await shared.showMessage(request, await $context.DemoDeactivateReadFailedMessageText);
			return;
		}
		if (!ids.length) {
			return;
		}
		const outcome = await deactivateItems(ids);
		if (outcome.failed) {
			const template = await $context.DemoDeactivateFailedMessageText;
			await shared.showMessage(request, formatTemplate(template, [outcome.failed, outcome.total]));
		}
		await shared.processRequest(request, {type: "crt.LoadDataRequest", dataSourceName: ITEMS_DATA_SOURCE, config: {loadType: "reload"}});
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
		return shared.processRequest(request, {
			type: "crt.OpenPageRequest",
			schemaName,
			modelInitConfigs: [{action: "edit", recordId: request.recordId}]
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
		refreshCanEditFields,
		isStatusChange,
		refreshStartApprovalAvailability,
		isStartApprovalInput,
		startApproval,
		initNewContract,
		refreshItemsSummary,
		recalculateAmountOnItemsChange,
		isItemsListChange,
		refreshDeactivateAvailability,
		isItemsSelectionChange,
		deactivateSelectedItems,
		childPageOf,
		openChildPage,
		useChildPageForAdd
	};
});

define("UsrDemoV4App_ListPageModule", ["@creatio-devkit/common", "UsrDemoV4App_SharedModule"],
function(sdk, shared) {
	"use strict";

	const CONTRACT_FORM_PAGE = "UsrDemoV4App_FormPage";
	const LIST_ITEMS_ATTRIBUTE = "Items";
	const LIST_DATA_SOURCE = "PDS";
	const SELECTION_ATTRIBUTE = "DataTable_SelectionState";

	/**
	 * True when an open or add request on this list targets a contract: it names the contract object, or it
	 * names the list's own rows and no object.
	 */
	function isContractRecordRequest(request) {
		return request.entityName === shared.CONTRACT_ENTITY
			|| (!request.entityName && request.itemsAttributeName === LIST_ITEMS_ATTRIBUTE);
	}

	/**
	 * Add from this list opens this app's contract form page. The object-wide page setting, which the earlier
	 * apps own, is left as it is.
	 */
	function useContractFormPageForAdd(request) {
		if (!request.entityPageName && isContractRecordRequest(request)) {
			request.entityPageName = CONTRACT_FORM_PAGE;
		}
	}

	/**
	 * Opens an existing contract of this list on this app's contract form page, in edit mode.
	 */
	function openContractFormPage(request) {
		return shared.processRequest(request, {
			type: "crt.OpenPageRequest",
			schemaName: CONTRACT_FORM_PAGE,
			modelInitConfigs: [{action: "edit", recordId: request.recordId}]
		});
	}

	/**
	 * The selected contracts as the list loaded them: {id, approved} per row. After "select all" these are the
	 * loaded rows except the ones the user unselected again. Throws when a row id cannot be read.
	 */
	async function readSelectedContracts($context) {
		const [selection, items] = await Promise.all([$context[SELECTION_ATTRIBUTE], $context[LIST_ITEMS_ATTRIBUTE]]);
		const selectAll = selection?.type === "all";
		const listed = new Set((selectAll ? selection?.unselected : selection?.selected) || []);
		const rows = await Promise.all([...(items || [])].map(async (row) => ({
			id: (await row.PDS_Id) ?? row.attributes?.PDS_Id,
			approved: Boolean(await row.PDS_DemoApproved)
		})));
		if (rows.some((row) => !row.id)) {
			throw new Error("A list row has no id.");
		}
		return rows.filter((row) => listed.has(row.id) !== selectAll);
	}

	/**
	 * "Close selected contracts" can be chosen only while at least one contract is selected; it starts disabled
	 * (the page attribute default) until this has run.
	 */
	async function refreshCloseSelectedAvailability($context) {
		const selection = await $context[SELECTION_ATTRIBUTE];
		const hasSelection = selection?.type === "all" || Boolean(selection?.selected?.length);
		await $context.set("DemoCloseSelectedDisabled", !hasSelection);
	}

	function isSelectionChange(attributeName) {
		return attributeName === SELECTION_ATTRIBUTE;
	}

	/**
	 * Sets Status = Closed on every contract, one write each, also on contracts that are already Closed. Goes on
	 * past a failed write and returns how many of how many failed.
	 */
	async function closeContracts(ids) {
		const model = await sdk.Model.create(shared.CONTRACT_ENTITY);
		const results = await Promise.allSettled(ids.map((id) =>
			model.update({DemoStatus: shared.CONTRACT_STATUS_CLOSED}, [{type: "primaryColumnValue", value: id}])));
		return {total: ids.length, failed: results.filter((result) => result.status === "rejected").length};
	}

	/**
	 * "Close selected contracts": closes the selected contracts directly, without opening them and without a
	 * confirmation. Contracts that could not be closed are counted and the user is told how many of how many;
	 * then the list reloads once.
	 */
	async function closeSelectedContracts(request) {
		const {$context} = request;
		let contracts;
		try {
			contracts = await readSelectedContracts($context);
		} catch (e) {
			await shared.showMessage(request, await $context.DemoCloseReadFailedMessageText);
			return;
		}
		if (!contracts.length) {
			return;
		}
		const outcome = await closeContracts(contracts.map((contract) => contract.id));
		if (outcome.failed) {
			const template = String((await $context.DemoCloseFailedMessageText) || "");
			await shared.showMessage(request,
				template.replace("{0}", String(outcome.failed)).replace("{1}", String(outcome.total)));
		}
		await shared.processRequest(request, {
			type: "crt.LoadDataRequest",
			dataSourceName: LIST_DATA_SOURCE,
			config: {loadType: "reload", useLastLoadParameters: true}
		});
	}

	/**
	 * "Start approval" on the list acts on the one selected contract: anything other than exactly one selected
	 * contract is refused with a message. An approved contract is refused with "This contract is already
	 * approved." and nothing starts; the button itself is never disabled. A selection that cannot be read, or a
	 * process start that fails, starts nothing and the user is told.
	 */
	async function startApprovalForSelected(request) {
		const {$context} = request;
		let contracts;
		try {
			contracts = await readSelectedContracts($context);
		} catch (e) {
			await shared.showMessage(request, await $context.DemoStartApprovalFailedMessageText);
			return;
		}
		if (contracts.length !== 1) {
			await shared.showMessage(request, await $context.DemoSelectOneContractMessageText);
			return;
		}
		const [contract] = contracts;
		if (contract.approved) {
			await shared.showMessage(request, await $context.DemoAlreadyApprovedMessageText);
			return;
		}
		if (!(await shared.startApprovalProcess(request, contract.id))) {
			await shared.showMessage(request, await $context.DemoStartApprovalFailedMessageText);
		}
	}

	return {
		isContractRecordRequest,
		useContractFormPageForAdd,
		openContractFormPage,
		isSelectionChange,
		refreshCloseSelectedAvailability,
		closeSelectedContracts,
		startApprovalForSelected
	};
});

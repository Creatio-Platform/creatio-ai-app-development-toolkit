define("UsrDemoV3App_ListPageModule", ["@creatio-devkit/common", "UsrDemoV3App_ContractAmountModule"],
function(sdk, contractAmount) {
	"use strict";
	const {CONTRACT_STATUS_CLOSED, APPROVAL_PROCESS_NAME, APPROVAL_PROCESS_RECORD_PARAMETER} = contractAmount;

	const CONTRACT_ENTITY = "DemoContract";
	const CONTRACT_FORM_PAGE = "UsrDemoV3App_FormPage";
	const LIST_ITEMS_ATTRIBUTE = "Items";
	const LIST_DATA_SOURCE = "PDS";
	const SELECTION_ATTRIBUTE = "DataTable_SelectionState";

	/**
	 * True when an open/add request on this list targets a contract: it names the contract object, or it names
	 * the list's own rows and no object.
	 */
	function isContractRecordRequest(request) {
		return request.entityName === CONTRACT_ENTITY
			|| (!request.entityName && request.itemsAttributeName === LIST_ITEMS_ATTRIBUTE);
	}

	/**
	 * Add from this list opens this app's contract form page. The object-wide page setting, which other apps own,
	 * is left as it is.
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
		return sdk.HandlerChainService.instance.process({
			type: "crt.OpenPageRequest",
			schemaName: CONTRACT_FORM_PAGE,
			modelInitConfigs: [{action: "edit", recordId: request.recordId}],
			$context: request.$context,
			scopes: [...request.scopes]
		});
	}

	async function rowId(row) {
		return (await row?.PDS_Id) ?? row?.attributes?.PDS_Id ?? null;
	}

	/**
	 * The ids of the contracts selected in the list. After "select all" these are the loaded rows except the
	 * ones the user unselected again (Classic acted on the loaded rows). Throws when a row id cannot be read.
	 */
	async function readSelectedContractIds($context) {
		const selection = await $context[SELECTION_ATTRIBUTE];
		if (selection?.type !== "all") {
			return [...(selection?.selected || [])];
		}
		const unselected = new Set(selection.unselected || []);
		const rows = [...((await $context[LIST_ITEMS_ATTRIBUTE]) || [])];
		const ids = await Promise.all(rows.map(rowId));
		if (ids.some((id) => !id)) {
			throw new Error("A list row has no id.");
		}
		return ids.filter((id) => !unselected.has(id));
	}

	/**
	 * "Close selected contracts" can be chosen only while at least one contract is selected.
	 */
	async function refreshCloseSelectedAvailability($context) {
		const selection = await $context[SELECTION_ATTRIBUTE];
		const anySelected = selection?.type === "all" || (selection?.selected?.length || 0) > 0;
		await $context.set("DemoCloseSelectedDisabled", !anySelected);
	}

	function isSelectionChange(attributeName) {
		return attributeName === SELECTION_ATTRIBUTE;
	}

	/**
	 * Sets Status = Closed on every contract, one update each, going on past a failed one and counting failures.
	 */
	async function closeContracts(ids) {
		const model = await sdk.Model.create(CONTRACT_ENTITY);
		let failed = 0;
		for (const id of ids) {
			try {
				await model.update({DemoStatus: CONTRACT_STATUS_CLOSED}, [{type: "primaryColumnValue", value: id}]);
			} catch (e) {
				failed++;
			}
		}
		return {total: ids.length, failed};
	}

	function reloadList(request) {
		return sdk.HandlerChainService.instance.process({
			type: "crt.LoadDataRequest",
			dataSourceName: LIST_DATA_SOURCE,
			config: {loadType: "reload", useLastLoadParameters: true},
			$context: request.$context,
			scopes: [...request.scopes]
		});
	}

	/**
	 * "Close selected contracts": closes the selected contracts directly, without opening them and without a
	 * confirmation. Contracts that could not be closed are counted and the user is told how many of how many;
	 * then the list reloads once.
	 */
	async function closeSelectedContracts(request) {
		const {$context} = request;
		let ids;
		try {
			ids = await readSelectedContractIds($context);
		} catch (e) {
			await contractAmount.showMessage(request, await $context.DemoCloseReadFailedMessageText);
			return;
		}
		if (!ids.length) {
			return;
		}
		const outcome = await closeContracts(ids);
		if (outcome.failed) {
			const template = String((await $context.DemoCloseFailedMessageText) || "");
			const message = template.replace("{0}", String(outcome.failed)).replace("{1}", String(outcome.total));
			await contractAmount.showMessage(request, message);
		}
		await reloadList(request);
	}

	/**
	 * Whether the contract is marked Approved; null when it could not be read.
	 */
	async function readContractApproved(contractId) {
		try {
			const model = await sdk.Model.create(CONTRACT_ENTITY);
			const filter = new sdk.FilterGroup();
			filter.addSchemaColumnFilterWithParameter(sdk.ComparisonType.Equal, "Id", contractId);
			const rows = await model.load({
				attributes: ["DemoApproved"],
				parameters: [{type: sdk.ModelParameterType.Filter, value: filter}]
			});
			return rows.length ? Boolean(rows[0].DemoApproved) : null;
		} catch (e) {
			return null;
		}
	}

	/**
	 * Starts the contract approval process for one contract, passing only its id, without waiting for it.
	 * Returns true when the start request was accepted.
	 */
	async function launchApprovalProcess(request, contractId) {
		try {
			await sdk.HandlerChainService.instance.process({
				type: "crt.RunBusinessProcessRequest",
				processName: APPROVAL_PROCESS_NAME,
				processRunType: "RegardlessOfThePage",
				saveAtProcessStart: false,
				showNotification: true,
				processParameters: {[APPROVAL_PROCESS_RECORD_PARAMETER]: contractId},
				$context: request.$context,
				scopes: [...request.scopes]
			});
			return true;
		} catch (e) {
			return false;
		}
	}

	/**
	 * "Start approval" on the list: acts on the one selected contract. An approved contract is refused with
	 * "This contract is already approved." and nothing starts; the button itself is never disabled. A contract
	 * whose approval state cannot be read starts nothing either, and the user is told.
	 */
	async function startApprovalForSelected(request) {
		const {$context} = request;
		let ids;
		try {
			ids = await readSelectedContractIds($context);
		} catch (e) {
			ids = [];
		}
		if (ids.length !== 1) {
			await contractAmount.showMessage(request, await $context.DemoSelectOneContractMessageText);
			return;
		}
		const approved = await readContractApproved(ids[0]);
		if (approved === null) {
			await contractAmount.showMessage(request, await $context.DemoStartApprovalFailedMessageText);
			return;
		}
		if (approved) {
			await contractAmount.showMessage(request, await $context.DemoAlreadyApprovedMessageText);
			return;
		}
		if (!(await launchApprovalProcess(request, ids[0]))) {
			await contractAmount.showMessage(request, await $context.DemoStartApprovalFailedMessageText);
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

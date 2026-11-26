define("UsrMbContractsV2App_ListPageModule", ["@creatio-devkit/common"], function(sdk) {
	"use strict";

	/** MbContractStatus record ids used by the Contracts list. */
	const CONTRACT_STATUS = Object.freeze({
		Closed: "6f0c4b2e-1d1a-4c3e-9a51-0b1c2d3e4f03"
	});

	/**
	 * Ids of the rows the user ticked in the grid.
	 * Only an explicit ("specific") selection yields ids: a "select all" selection
	 * carries the rows left out, not the rows chosen.
	 */
	function getSelectedIds(selectionState) {
		if (!selectionState || selectionState.type !== "specific") {
			return [];
		}
		return Array.isArray(selectionState.selected) ? selectionState.selected : [];
	}

	/** True while the close action has nothing to act on. */
	function isCloseSelectionEmpty(selectionState) {
		return getSelectedIds(selectionState).length === 0;
	}

	/** Sets Status = Closed on each contract; one update per record, a failed one does not stop the rest. */
	async function closeContracts(ids) {
		const model = await sdk.Model.create("MbContract");
		for (const id of ids) {
			try {
				await model.update({MbStatus: CONTRACT_STATUS.Closed}, [{type: "primaryColumnValue", value: id}]);
			} catch (e) {
				console.error("Contract " + id + " was not closed.", e);
			}
		}
	}

	/** Reloads the list the same way the page's Refresh button does. */
	async function reloadList($context, scopes) {
		await sdk.HandlerChainService.instance.process({
			type: "crt.LoadDataRequest",
			$context: $context,
			scopes: [...scopes],
			config: {loadType: "reload", useLastLoadParameters: true},
			refreshDataConfig: {mode: "RefreshAll"}
		});
	}

	/** Closes the contracts ticked in the list grid, then reloads the list. */
	async function closeSelectedContracts($context, scopes, selectionState) {
		const ids = getSelectedIds(selectionState);
		if (ids.length === 0) {
			return;
		}
		await closeContracts(ids);
		await reloadList($context, scopes);
	}

	return {
		CONTRACT_STATUS: CONTRACT_STATUS,
		isCloseSelectionEmpty: isCloseSelectionEmpty,
		closeSelectedContracts: closeSelectedContracts
	};
});

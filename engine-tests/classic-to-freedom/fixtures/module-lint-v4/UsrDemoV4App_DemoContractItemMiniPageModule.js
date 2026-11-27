define("UsrDemoV4App_DemoContractItemMiniPageModule", ["UsrDemoV4App_SharedModule"], function(shared) {
	"use strict";

	const TOTAL_INPUT_ATTRIBUTES = new Set(["PDS_DemoQuantity", "PDS_DemoPrice"]);
	const TOTAL_TRACKING_ATTRIBUTE = "DemoTotalFollowsInputs";

	/**
	 * A new item opened with Add starts as Active, so it counts towards the contract amount. An existing or copied
	 * item keeps the flag it carries, and the flag stays editable.
	 */
	async function activateNewItem($context) {
		if (shared.isAddMode(await $context.CardState)) {
			await $context.set("PDS_DemoIsActive", true);
		}
	}

	/**
	 * Called once the record has loaded: only from then on does a change of Quantity or Price recalculate Total, so
	 * opening an item never rewrites its stored Total.
	 */
	async function startTotalTracking($context) {
		await $context.set(TOTAL_TRACKING_ATTRIBUTE, true);
	}

	function isTotalInput(attributeName) {
		return TOTAL_INPUT_ATTRIBUTES.has(attributeName);
	}

	/**
	 * Total = Quantity x Price, an empty Quantity or Price counting as 0.
	 */
	async function calculateTotal($context) {
		const [tracking, quantity, price, total] = await Promise.all([
			$context[TOTAL_TRACKING_ATTRIBUTE],
			$context.PDS_DemoQuantity,
			$context.PDS_DemoPrice,
			$context.PDS_DemoTotal
		]);
		if (!tracking) {
			return;
		}
		const newTotal = (Number(quantity) || 0) * (Number(price) || 0);
		if (total !== newTotal) {
			await $context.set("PDS_DemoTotal", newTotal);
		}
	}

	return {
		activateNewItem,
		startTotalTracking,
		isTotalInput,
		calculateTotal
	};
});

define("UsrDemoV3App_DemoContractItemMiniPageModule", [], function() {
	"use strict";

	const CARD_STATE_ADD = "add";
	const TOTAL_SOURCE_ATTRIBUTES = ["PDS_DemoQuantity", "PDS_DemoPrice"];
	const TOTAL_RECALCULATION_ENABLED = "DemoTotalRecalculationEnabled";

	/**
	 * A new item opened in add mode starts as Active. Edit and copy modes keep the value they carry.
	 */
	async function applyNewItemDefaults($context) {
		if ((await $context.CardState) !== CARD_STATE_ADD) {
			return;
		}
		await $context.set("PDS_DemoIsActive", true);
	}

	/**
	 * Called once the page has loaded its record: from then on a change of Quantity or Price recalculates Total,
	 * so opening an existing item never rewrites its stored Total.
	 */
	async function enableTotalRecalculation($context) {
		await $context.set(TOTAL_RECALCULATION_ENABLED, true);
	}

	function isTotalSource(attributeName) {
		return TOTAL_SOURCE_ATTRIBUTES.includes(attributeName);
	}

	/**
	 * Total = Quantity x Price, an empty value counting as 0.
	 */
	async function recalculateTotal($context) {
		const [enabled, quantity, price, total] = await Promise.all([
			$context[TOTAL_RECALCULATION_ENABLED],
			$context.PDS_DemoQuantity,
			$context.PDS_DemoPrice,
			$context.PDS_DemoTotal
		]);
		if (!enabled) {
			return;
		}
		const newTotal = (Number(quantity) || 0) * (Number(price) || 0);
		if (total !== newTotal) {
			await $context.set("PDS_DemoTotal", newTotal);
		}
	}

	return {
		applyNewItemDefaults,
		enableTotalRecalculation,
		isTotalSource,
		recalculateTotal
	};
});

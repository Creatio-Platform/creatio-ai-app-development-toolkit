define("AbConstants", [], function() {
	var orderStatus = {
		New: "1b7e3a3c-0000-4c5d-8e9f-0a1b2c3d4e5f",
		Approved: "3e7f3a3c-1a2b-4c5d-8e9f-0a1b2c3d4e5f"
	};
	var unreferenced = {
		Legacy: "9a9a9a9a-0000-4000-8000-000000000009"
	};
	return {
		OrderStatus: orderStatus,
		OrderType: {
			Retail: "5c5c5c5c-0000-4000-8000-000000000005"
		}
	};
});

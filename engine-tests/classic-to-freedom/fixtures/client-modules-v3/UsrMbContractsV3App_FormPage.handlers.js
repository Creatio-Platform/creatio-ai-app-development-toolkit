[
	{
		request: "crt.HandleViewModelInitRequest",
		handler: async (request, next) => {
			const result = await next?.handle(request);
			await contractPage.refreshCanEditFields(request.$context);
			return result;
		}
	},
	{
		request: "crt.HandleViewModelAttributeChangeRequest",
		handler: async (request, next) => {
			const result = await next?.handle(request);
			if (request.attributeName === "PDS_MbStatus") {
				await contractPage.refreshCanEditFields(request.$context);
			}
			return result;
		}
	},
	{
		request: "crt.HandleViewModelInitRequest",
		handler: async (request, next) => {
			const result = await next?.handle(request);
			await contractPage.initNewContract(request);
			return result;
		}
	},
	{
		request: "crt.HandleViewModelInitRequest",
		handler: async (request, next) => {
			const result = await next?.handle(request);
			await contractPage.refreshStartApprovalAvailability(request.$context);
			return result;
		}
	},
	{
		request: "crt.HandleViewModelAttributeChangeRequest",
		handler: async (request, next) => {
			const result = await next?.handle(request);
			if (contractPage.isStartApprovalInput(request.attributeName)) {
				await contractPage.refreshStartApprovalAvailability(request.$context);
			}
			return result;
		}
	},
	{
		request: "crt.HandleViewModelAttributeChangeRequest",
		handler: async (request, next) => {
			const result = await next?.handle(request);
			if (request.attributeName === contractPage.ITEMS_SELECTION_ATTRIBUTE) {
				await contractPage.refreshDeactivateAvailability(request.$context);
			}
			return result;
		}
	},
	{
		request: "crt.HandleViewModelInitRequest",
		handler: async (request, next) => {
			const result = await next?.handle(request);
			await contractPage.refreshItemsSummary(request.$context);
			return result;
		}
	},
	{
		request: "crt.HandleViewModelAttributeChangeRequest",
		handler: async (request, next) => {
			const result = await next?.handle(request);
			if (request.attributeName === contractPage.ITEMS_GRID) {
				await contractPage.refreshItemsSummary(request.$context);
			}
			return result;
		}
	},
	{
		request: "crt.LoadDataRequest",
		handler: async (request, next) => {
			const result = await next?.handle(request);
			if (request.dataSourceName === contractPage.ITEMS_DATA_SOURCE) {
				await contractPage.refreshItemsSummary(request.$context);
			}
			return result;
		}
	},
	{
		request: "crt.HandleViewModelAttributeChangeRequest",
		handler: async (request, next) => {
			const result = await next?.handle(request);
			if (request.attributeName === contractPage.ITEMS_GRID) {
				await contractPage.recalculateAmountOnItemsChange(request);
			}
			return result;
		}
	},
	{
		request: "crt.LoadDataRequest",
		handler: async (request, next) => {
			const result = await next?.handle(request);
			if (request.dataSourceName === contractPage.ITEMS_DATA_SOURCE) {
				await contractPage.recalculateAmountOnItemsChange(request);
			}
			return result;
		}
	},
	{
		request: "mb.MbDeactivateSelectedClicked",
		handler: async (request, next) => {
			await contractPage.deactivateSelectedItems(request);
			return next?.handle(request);
		}
	},
	{
		request: "mb.MbStartApprovalButtonClicked",
		handler: async (request, next) => {
			await contractPage.startApproval(request);
			return next?.handle(request);
		}
	},
	{
		request: "crt.CreateRecordRequest",
		handler: async (request, next) => {
			await contractPage.useChildPageForAdd(request);
			return next?.handle(request);
		}
	},
	{
		request: "crt.UpdateRecordRequest",
		handler: async (request, next) => {
			const childPage = contractPage.childPageOf(request);
			if (childPage) {
				return contractPage.openChildPage(request, childPage);
			}
			return next?.handle(request);
		}
	}
]

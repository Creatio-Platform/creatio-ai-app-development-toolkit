[
			{
				request: "crt.CreateRecordRequest",
				handler: async (request, next) => {
					listPage.useContractFormPageForAdd(request);
					return next?.handle(request);
				}
			},
			{
				request: "crt.UpdateRecordRequest",
				handler: async (request, next) => {
					if (listPage.isContractRecordRequest(request)) {
						return listPage.openContractFormPage(request);
					}
					return next?.handle(request);
				}
			},
			{
				request: "crt.HandleViewModelAttributeChangeRequest",
				handler: async (request, next) => {
					const result = await next?.handle(request);
					if (listPage.isSelectionChange(request.attributeName)) {
						await listPage.refreshCloseSelectedAvailability(request.$context);
					}
					return result;
				}
			},
			{
				request: "mb.MbCloseSelectedMenuItemClicked",
				handler: async (request, next) => {
					await listPage.closeSelectedContracts(request);
					return next?.handle(request);
				}
			},
			{
				request: "mb.MbStartApprovalButtonClicked",
				handler: async (request, next) => {
					await listPage.startApprovalForSelected(request);
					return next?.handle(request);
				}
			}
		]

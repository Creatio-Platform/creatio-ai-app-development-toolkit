[
			{
				request: "crt.HandleViewModelInitRequest",
				handler: async (request, next) => {
					const result = await next?.handle(request);
					await mbDocumentTotals.setNewDocumentDate(request.$context, "PDS_MbDate");
					return result;
				}
			},
			{
				request: "crt.HandleViewModelInitRequest",
				handler: async (request, next) => {
					const result = await next?.handle(request);
					await mbDocumentTotals.refreshPostEnabled(request.$context);
					return result;
				}
			},
			{
				request: "crt.HandleViewModelAttributeChangeRequest",
				handler: async (request, next) => {
					const result = await next?.handle(request);
					if (request.attributeName === "PDS_MbIsPosted" || request.attributeName === "CardState") {
						await mbDocumentTotals.refreshPostEnabled(request.$context);
					}
					return result;
				}
			},
			{
				request: "mb.MbPostButtonClicked",
				handler: async (request) => {
					const { $context } = request;
					const [alreadyPostedMessage, postFailedMessage] = await Promise.all([$context.MbAlreadyPostedText, $context.MbPostFailedText]);
					await mbDocumentTotals.postDocument(sdk, request, {
						entityName: "MbDeliveryNote",
						dataSourceName: "PDS",
						historyDataSourceName: "MbHistoryListDS",
						alreadyPostedMessage: alreadyPostedMessage,
						postFailedMessage: postFailedMessage
					});
				}
			}
		]

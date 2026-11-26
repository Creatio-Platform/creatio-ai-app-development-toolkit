define("UsrDemoV3App_ContractAmountModule", ["@creatio-devkit/common"], function(sdk) {
	"use strict";

	const DATA_VALUE_TYPE_GUID = 0;
	const DATA_VALUE_TYPE_BOOLEAN = 12;
	const COMPARISON_EQUAL = 3;
	const AGGREGATION_SUM = 2;
	const SELECT_QUERY_PATH = "DataService/json/SyncReply/SelectQuery";
	const CONTRACT_ENTITY = "DemoContract";
	// Shared by the Demo pages: the Closed contract status and the contract approval process.
	const CONTRACT_STATUS_CLOSED = "00000000-0000-4000-8000-000000000300";
	const APPROVAL_PROCESS_NAME = "DemoApproveContractProcess";
	const APPROVAL_PROCESS_RECORD_PARAMETER = "ContractId";

	const column = (path) => ({expressionType: 0, columnPath: path});
	const parameter = (dataValueType, value) => ({expressionType: 2, parameter: {dataValueType, value}});
	const equalFilter = (path, dataValueType, value) => ({
		filterType: 1,
		comparisonType: COMPARISON_EQUAL,
		isEnabled: true,
		leftExpression: column(path),
		rightExpression: parameter(dataValueType, value)
	});
	const filterGroup = (rootSchemaName, items) => ({filterType: 6, logicalOperation: 0, isEnabled: true, rootSchemaName, items});

	/**
	 * The workspace URL of a DataService endpoint, on both the .NET Framework ("/0/...") and the .NET hosts.
	 */
	function dataServiceUrl(relativePath) {
		const base = globalThis.Terrasoft?.workspaceBaseUrl;
		if (base) {
			return base.replace(/\/$/, "") + "/" + relativePath;
		}
		const path = globalThis.location?.pathname || "/";
		const index = path.indexOf("/0/");
		return (index >= 0 ? path.slice(0, index + 3) : "/") + relativePath;
	}

	/**
	 * Sends one SelectQuery. Returns the response body, or null when the call failed.
	 */
	async function selectQuery(body) {
		try {
			const response = await new sdk.HttpClientService().post(dataServiceUrl(SELECT_QUERY_PATH), body);
			const data = response?.body ?? response;
			return data && data.success !== false ? data : null;
		} catch (e) {
			return null;
		}
	}

	async function showMessage(request, message) {
		await sdk.HandlerChainService.instance.process({
			type: "crt.ShowDialogRequest",
			dialogConfig: {data: {message}},
			$context: request.$context,
			scopes: [...request.scopes]
		});
	}

	const flaggedSum = (childSchemaName, valueColumn, flagColumn) => ({
		expression: {
			expressionType: 3,
			columnPath: "[" + childSchemaName + ":DemoContract]." + valueColumn,
			functionType: 2,
			aggregationType: AGGREGATION_SUM,
			subFilters: filterGroup(childSchemaName, {Flag: equalFilter(flagColumn, DATA_VALUE_TYPE_BOOLEAN, true)})
		}
	});

	/**
	 * The three totals of a contract in one server query: active items, posted delivery notes and posted
	 * return notes. An empty category is 0. Returns null when the query failed.
	 */
	async function readContractTotals(contractId) {
		const result = await selectQuery({
			rootSchemaName: CONTRACT_ENTITY,
			operationType: 0,
			allColumns: false,
			rowCount: 1,
			columns: {items: {
				Items: flaggedSum("DemoContractItem", "DemoTotal", "DemoIsActive"),
				Deliveries: flaggedSum("DemoDeliveryNote", "DemoAmount", "DemoIsPosted"),
				Returns: flaggedSum("DemoReturnNote", "DemoAmount", "DemoIsPosted")
			}},
			filters: filterGroup(CONTRACT_ENTITY, {Id: equalFilter("Id", DATA_VALUE_TYPE_GUID, contractId)})
		});
		const row = result?.rows?.[0];
		if (!row) {
			return null;
		}
		return {items: row.Items || 0, deliveries: row.Deliveries || 0, returns: row.Returns || 0};
	}

	/**
	 * Contract amount = active items + posted delivery notes - posted return notes, written to the contract.
	 * Returns {success: true, amount} once written; {success: false, writeFailed: false} when a total could not
	 * be read (nothing is written and nothing is reported, as the amount rule requires); {success: false,
	 * writeFailed: true} when the totals were read but the write failed, which the caller reports.
	 */
	async function recalculateContractAmount(contractId) {
		const totals = await readContractTotals(contractId);
		if (!totals) {
			return {success: false, writeFailed: false};
		}
		const amount = totals.items + totals.deliveries - totals.returns;
		try {
			const model = await sdk.Model.create(CONTRACT_ENTITY);
			await model.update({DemoAmount: amount}, [{type: "primaryColumnValue", value: contractId}]);
			return {success: true, amount};
		} catch (e) {
			return {success: false, writeFailed: true};
		}
	}

	return {
		CONTRACT_STATUS_CLOSED,
		APPROVAL_PROCESS_NAME,
		APPROVAL_PROCESS_RECORD_PARAMETER,
		dataServiceUrl,
		parameter,
		column,
		equalFilter,
		filterGroup,
		selectQuery,
		showMessage,
		recalculateContractAmount
	};
});

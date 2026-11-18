# Mobile SDK — Data model and server calls

Read after `context/mobile-sdk-guide.md`, when the plan uses this mechanism.

## Data model

`Model` reads and writes records of an entity from code.

```ts
import {
	ColumnExpression,
	CompareFilter,
	ComparisonType,
	Model,
	ModelParameterType,
	ParameterExpression,
} from '@creatio/mobile-common';

const model = await Model.create('Contact');

const contacts = await model.load({
	attributes: ['Id', 'Name'],
	parameters: [
		{
			type: ModelParameterType.Filter,
			value: new CompareFilter(
				ComparisonType.Equal,
				new ColumnExpression({ columnPath: 'Account' }),
				new ParameterExpression({ value: accountId }),
			),
		},
	],
	loadOptions: { pagingConfig: { rowsOffset: 0, rowCount: 20 } },
});

await model.insert({ Name: 'New contact', Account: accountId });
await model.update({ Name: 'Renamed' }, [{ type: ModelParameterType.PrimaryColumnValue, value: contactId }]);
await model.delete([{ type: ModelParameterType.PrimaryColumnValue, value: contactId }]);
```

- A lookup column is written as the id of the referenced record.
- `load` returns plain objects keyed by the requested attributes.
- Check the `success` flag of the result of `insert`, `update` and `delete`.

### Online and offline

A device may hold a local copy of the data and work without a connection. Reads and writes accept a
cache operation that says where they go:

```ts
import { CacheDataType, ReadCacheMode } from '@creatio/mobile-common';

const loadOptions = {
	cacheOperation: {
		updateCache: true,
		readCacheMode: ReadCacheMode.ForceLocal,
		cacheDataType: CacheDataType.Partial,
	},
};
```

- `ReadCacheMode.Auto` lets the app decide; with no connection it may try the server and fail.
- `ReadCacheMode.ForceLocal` reads the device copy and works with no connection. Use it for logic that
  must run offline, and only for entities the workplace synchronizes to the device.
- `ReadCacheMode.ForceRemote` / `Remote` read the server and fail without a connection.

State in the plan whether the logic works offline. A handler that needs the server must catch the
failure and tell the user, not leave the page hanging.

## Calling the server

Start a business process and, when needed, read its output parameters:

```ts
import { HandlerChainService, RunBusinessProcessRequest } from '@creatio/mobile-common';

const result = await HandlerChainService.instance.process({
	type: 'crt.RunBusinessProcessRequest',
	$context: request.$context,
	processName: 'UsrRecalculateOrder',
	processParameters: { OrderId: orderId },
	resultParameterNames: ['Total'],
	showNotification: false,
} as RunBusinessProcessRequest);
```

The process runs on the server, so this needs a connection, and the request is available only in app
versions whose SDK lists it in the changelog. Read the request's declaration for the full parameter
set.

# Mobile SDK — A text computed by the module

Read after `context/mobile-sdk-guide.md`, when the plan uses this mechanism.

## A text computed by the module

A line the page shows and no column holds — a count of days, a total, a hint — is a page attribute
of its own that a label reads and the module writes.

The page declares the attribute with a start value and no `modelConfig`, so no data source feeds it
and no save sends it:

```json
"viewModelConfigDiff": [
  {
    "operation": "merge",
    "path": ["attributes"],
    "values": {
      "UsrDaysInStockCaption": { "value": "" }
    }
  }
]
```

A label binds its caption to it; add the `layoutConfig` the parent container requires:

```json
{
  "operation": "insert",
  "name": "UsrDaysInStockLabel",
  "parentName": "<container on the page>",
  "propertyName": "items",
  "values": {
    "type": "crt.Label",
    "caption": "$UsrDaysInStockCaption",
    "labelType": "body"
  }
}
```

The module writes the text after the page loads its data, and again when a value it depends on
changes:

```ts
import {
	BaseRequestHandler,
	CrtRequestHandler,
	ExecutionContext,
	HandleViewModelAttributeChangeRequest,
	LoadDataRequest,
} from '@creatio/mobile-common';

import { formatDaysInStock } from './days-in-stock';

async function refreshDaysInStock(context: ExecutionContext): Promise<void> {
	// An empty date reads as undefined; the function returns an empty text for it.
	const arrival = await context.getAttribute('UsrArrivalDate');
	await context.setAttribute('UsrDaysInStockCaption', formatDaysInStock(arrival, new Date()));
}

@CrtRequestHandler({
	requestType: 'crt.LoadDataRequest',
	type: 'usr.OrderDaysInStockLoad',
	scopes: ['UsrOrder_MobileFormPage'],
})
export class UsrOrderDaysInStockLoad extends BaseRequestHandler<LoadDataRequest> {
	public async handle(request: LoadDataRequest): Promise<unknown> {
		const result = await this.next?.handle(request);
		await refreshDaysInStock(request.$context as ExecutionContext);
		return result;
	}
}

@CrtRequestHandler({
	requestType: 'crt.HandleViewModelAttributeChangeRequest',
	type: 'usr.OrderDaysInStockChange',
	scopes: ['UsrOrder_MobileFormPage'],
})
export class UsrOrderDaysInStockChange extends BaseRequestHandler<HandleViewModelAttributeChangeRequest> {
	public async handle(request: HandleViewModelAttributeChangeRequest): Promise<unknown> {
		const result = await this.next?.handle(request);
		if (request.attributeName === 'UsrArrivalDate') {
			await refreshDaysInStock(request.$context as ExecutionContext);
		}
		return result;
	}
}
```

- The text follows the field while the user edits it, before any save: the change handler runs on
  every change of a page attribute.
- Writing the text does not mark the record as changed. Only an attribute bound to a data source
  does that, and this one has no `modelConfig`.
- The write does send a change request for the text attribute itself, which is why the change handler
  tests `attributeName` before it recalculates. On an app that has `set`,
  `set(name, value, { preventAttributeChangeRequest: true })` keeps that request from being sent.
- The calculation is a plain function in a file of its own, so the local behaviour check can run it,
  and it takes today's date as a value.

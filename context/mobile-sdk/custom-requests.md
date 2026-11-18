# Mobile SDK — Custom requests

Read after `context/mobile-sdk-guide.md`, when the plan uses this mechanism.

## Custom requests

A custom request is a named action with parameters.

```ts
import { BaseRequest, BaseRequestHandler, CrtRequest, CrtRequestHandler, ExecutionContext } from '@creatio/mobile-common';

@CrtRequest({ type: 'usr.ApplyDiscountRequest' })
export class UsrApplyDiscountRequest extends BaseRequest {
	public percent?: number;
}

@CrtRequestHandler({
	requestType: 'usr.ApplyDiscountRequest',
	type: 'usr.ApplyDiscountHandler',
})
export class UsrApplyDiscountHandler extends BaseRequestHandler<UsrApplyDiscountRequest> {
	public async handle(request: UsrApplyDiscountRequest): Promise<unknown> {
		const context = request.$context as ExecutionContext;
		const amount = Number(await context.getAttribute('UsrAmount')) || 0;
		await context.setAttribute('UsrAmount', amount * (1 - (request.percent ?? 0) / 100));
		return this.next?.handle(request);
	}
}
```

From a page, a component names the request and passes parameters:

```json
{
  "type": "crt.Button",
  "caption": "#ResourceString(UsrApplyDiscountButton_caption)#",
  "clicked": {
    "request": "usr.ApplyDiscountRequest",
    "params": { "percent": 10 }
  }
}
```

Parameter values may be attribute bindings (`"$UsrDiscountPercent"`); the app resolves them before the
handler runs. Do not put `type` or `scopes` into `params`: the request arrives with the scopes of the
page the component is on, so its handler may be scoped to that page.

From code, send any request — custom or built-in — through the chain:

```ts
import { HandlerChainService } from '@creatio/mobile-common';

await HandlerChainService.instance.process({
	type: 'usr.ApplyDiscountRequest',
	$context: request.$context,
	scopes: request.scopes,
	percent: 10,
} as UsrApplyDiscountRequest);
```

Always pass the current `$context`. A request sent this way goes through the same chain as one the
app sends: every handler of that type whose scope matches, another module's included, then the
built-in behaviour.

- A request without `scopes` takes the scopes of its context, so the scoped handlers of the page
  still run. An explicit empty list limits it to the unscoped handlers.
- A handler that sends the request type it handles is called again by that request. Send a
  different type, or keep a flag that tells the second call apart.

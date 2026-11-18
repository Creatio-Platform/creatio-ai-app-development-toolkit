# Mobile SDK — Blocking a save

Read after `context/mobile-sdk-guide.md`, when the plan uses this mechanism.

## Blocking a save

The SDK has no field validator. A module validates by intercepting the save:

```ts
import {
	BaseDialogConfig,
	BaseRequestHandler,
	CrtRequestHandler,
	DialogService,
	ExecutionContext,
	SaveRecordRequest,
} from '@creatio/mobile-common';

const ERROR_PREFIX = 'UsrOrderLogic.UsrOrderSaveGuard';

@CrtRequestHandler({
	requestType: 'crt.SaveRecordRequest',
	type: 'usr.OrderSaveGuard',
	scopes: ['UsrOrder_MobileFormPage'],
})
export class UsrOrderSaveGuard extends BaseRequestHandler<SaveRecordRequest> {
	public async handle(request: SaveRecordRequest): Promise<unknown> {
		let isSaveAllowed: boolean;
		try {
			isSaveAllowed = await this.check(request.$context as ExecutionContext);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(`${ERROR_PREFIX}: ${reason}`);
		}
		if (!isSaveAllowed) {
			// The save is not passed down the chain: the record stays unsaved and the page stays in edit mode.
			return undefined;
		}
		return this.next?.handle(request);
	}

	private async check(context: ExecutionContext): Promise<boolean> {
		const amount = Number(await context.getAttribute('UsrAmount'));
		if (amount > 0) {
			return true;
		}
		const config: BaseDialogConfig = {
			message: 'Amount must be greater than zero',
			actions: [{ key: 'ok', config: { caption: 'OK', color: 'primary' } }],
		};
		await new DialogService(context).open(config);
		return false;
	}
}
```

- Returning without calling the next handler is what blocks the save; return `undefined`.
- The dialog's `title` is optional. A dialog with a message and one button is enough for a refusal.
- The recommended values of an action's `color` are `primary`, `accent`, `warn` and `default`.
- The app log records a thrown error without its origin, so the handler's own part is wrapped and
  rethrown with the module and handler name in front. The call to the next handler stays outside the
  wrapper, so an error of the built-in save is not relabelled.
- The check runs on the device, online and offline. It covers a save the user starts on this page;
  records written elsewhere — another page, an import, a process — do not pass through it. It does not
  mark the field; when the requirement is "required when …", a business rule does that without code.

# Local behaviour check

A compile and a build prove that the module is well-formed, not that it does the right thing. This
check runs the **built** `main.js` under Node — the same file that is delivered — with a stub in place
of the SDK, on a table of inputs with the outcome each must produce. It needs no device, no Creatio
and no extra npm package.

It also produces the device check: every row of the table becomes one step the developer performs by
hand on a phone.

## How it works

The bundle expects a global named `crtSdk` and nothing else. The script below provides one whose
decorators record what the module registers, loads the bundle into an empty context (no DOM, no
`console`, as on a device), and calls a handler the way the app does: with a request that carries a
page context, and a next handler that stands for the app's built-in behaviour.

Save it next to the project as `check-behaviour.cjs` and adapt the three marked places.

```js
// Usage: node check-behaviour.cjs out/mobile/<ModuleName>/main.js
const fs = require('fs');
const vm = require('vm');

const handlers = [];
const dialogs = [];
const sent = [];
// The answer the next dialog gets: an action key, or null for a dismissed dialog.
let dialogAnswer;

// 1. The stub SDK: every export the module imports. A missing one fails at load and names itself.
const crtSdk = {
	BaseRequest: class {},
	BaseRequestHandler: class {
		get next() { return this._next; }
		setNext(next) { this._next = next; }
	},
	CrtRequest: () => () => {},
	CrtRequestHandler: (config) => (type) => { handlers.push({ config, type }); },
	CrtModule: () => () => {},
	bootstrapCrtModule: () => {},
	DialogService: class {
		async open(config) {
			dialogs.push(config.message);
			return dialogAnswer === undefined ? config.actions[0].key : dialogAnswer;
		}
	},
	// A request the module sends itself is recorded, not carried out.
	HandlerChainService: { instance: { process: async (request) => { sent.push(request.type); return true; } } },
};

vm.runInContext(fs.readFileSync(process.argv[2], 'utf8'), vm.createContext({ crtSdk }), { filename: 'main.js' });

// options.request — the request's own fields, such as attributeName for an attribute change;
// options.dialogAnswer — the action key the user picks, or null for a dismissed dialog.
async function run(handlerType, attributes, options = {}) {
	const registered = handlers.find((item) => item.config.type === handlerType);
	if (!registered) throw new Error('not registered: ' + handlerType);
	const values = { ...attributes };
	const writes = [];
	dialogs.length = 0;
	sent.length = 0;
	dialogAnswer = options.dialogAnswer;
	let passedOn = false;
	const write = async (name, value, writeOptions) => {
		values[name] = value;
		writes.push({ name, options: writeOptions || {} });
	};
	const context = {
		getAttribute: async (name) => values[name],
		setAttribute: write,
		get: async (name) => values[name],
		set: write,
		setAttributePropertyValue: async () => {},
		getResourceString: async () => null,
	};
	const handler = new registered.type();
	handler.setNext({ handle: async () => { passedOn = true; return true; } });
	await handler.handle({ $context: context, scopes: registered.config.scopes || [], ...options.request });
	return { passedOn, values, dialogs: [...dialogs], sent: [...sent], writes };
}

// 2. The handler under test and the attribute it works with.
const HANDLER = 'usr.CarVinSaveGuard';
const ATTRIBUTE = 'PDS_Vin';

// 3. The table: input, whether the built-in behaviour must run, the value expected afterwards.
const cases = [
	{ input: '1HGCM82633A004352', passedOn: true, value: '1HGCM82633A004352' },
	{ input: ' 1hgcm82633a004352 ', passedOn: true, value: '1HGCM82633A004352' },
	{ input: '1HGCM82643A004352', passedOn: false, value: '1HGCM82643A004352' },
	{ input: '1HGCM82633A00435', passedOn: false, value: '1HGCM82633A00435' },
	{ input: '', passedOn: true, value: '' },
];

(async () => {
	let failed = 0;
	for (const item of cases) {
		const result = await run(HANDLER, { [ATTRIBUTE]: item.input });
		const ok = result.passedOn === item.passedOn && result.values[ATTRIBUTE] === item.value
			&& (item.passedOn || result.dialogs.length === 1);
		if (!ok) failed++;
		console.log(ok ? 'ok  ' : 'FAIL', JSON.stringify(item.input), '->', JSON.stringify(result));
	}
	console.log(cases.length + ' cases, ' + failed + ' failed');
	process.exit(failed ? 1 : 0);
})();
```

## Rules for the table

- One row per branch of the plan's "How" section, plus the row where the logic must change nothing.
- Each row states the outcome, not just the input: whether the built-in behaviour runs, what the
  attribute holds afterwards, which message the user sees.
- Add the awkward inputs a person produces on a phone: leading and trailing spaces, the wrong letter
  case, an empty value.
- When the module ports a web handler, run the web handler on the same rows and compare the outcomes.
  Its source is in the body file `get-page` wrote; load it the same way, with a stub of the web SDK.
- A handler that asks a question gets one row per answer, the dismissed dialog included:
  `run(HANDLER, attributes, { dialogAnswer: 'cancel' })`. Without an answer the stub picks the first
  action.
- A handler that sends a request of its own — a save after a button, a reload — is checked on
  `sent`: the request types it sent, in order, and an empty list on the rows where it must send
  nothing.
- A handler that must not mark the record as changed is checked on `writes`: each write with the
  options it carried.
- A rule that depends on today's date or on the time zone takes the moment as a value, so a row can
  fix it, and the table runs under more than one zone: set the `TZ` environment variable —
  `TZ=America/Los_Angeles`, then `TZ=Pacific/Auckland` — for the `node` call.

## What the check does not cover

It replaces the SDK, so it cannot tell whether the app calls the handler, whether an attribute name
exists on the page, or how a dialog looks. Those belong to the device check. A handler that reads
attributes through the context's methods — `getAttribute` / `setAttribute`, or `get` / `set` — as
`context/mobile-sdk-guide.md` recommends, runs here with the plain context above; one that indexes
the context directly needs a context that answers property reads.

Extend the stub with the SDK members the module uses — a service is a class with the methods called, a
request class is an empty class. Keep the stub honest: a method that returns a fixed value hides the
branch that depends on it, so make that value part of the row.

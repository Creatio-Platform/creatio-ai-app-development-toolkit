# Remote module project layout

A remote module is an ordinary TypeScript project. Create these files exactly; the build settings are
what the Mobile app's script runtime requires, not a matter of taste.

```
<workspace>/
├── packages/
│   └── <Package>/Files/src/mobile/<ModuleName>/main.js   ← delivered copy of the build output
└── mobile-modules/
    └── <ModuleName>/                                      ← the project; folder name = module name
        ├── package.json
        ├── tsconfig.json
        ├── webpack.config.js
        ├── .gitignore
        ├── check-behaviour.cjs                            ← local behaviour check
        ├── src/
        │   └── index.ts                                   ← the module class; imports the rest
        └── out/mobile/<ModuleName>/main.js                ← build output
```

`<ModuleName>` is one PascalCase word that starts with the customer prefix — `UsrOrderLogic` on an
environment whose prefix is `Usr`; the runbook's naming rule says which prefix applies when the
environment has none. The same string names the project folder, the delivered folder, the module class and
the first argument of `bootstrapCrtModule`. The device derives the module name from the delivered
folder, so a mismatch leaves the module unregistered.

## package.json

```json
{
  "name": "usr-order-logic",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "webpack"
  },
  "engines": {
    "node": ">=22"
  },
  "dependencies": {
    "@creatio/mobile-common": "<version>"
  },
  "devDependencies": {
    "ts-loader": "^9.6.2",
    "typescript": "^6.0.3",
    "webpack": "^5.112.2",
    "webpack-cli": "^7.3.1"
  }
}
```

- `name` is the module name in kebab-case.
- **Use the newest published `@creatio/mobile-common`, written as its exact version number** — the
  version whose declarations were read before the plan — not as the `latest` tag, so the build is
  repeatable and the report names the version the module was built against.
  The package is type declarations only; the running SDK is the one inside the Mobile app, and the
  flow assumes the users run the latest app. Take an older version only when the developer names an
  older app: the newest one whose `CHANGELOG.md` heading names a Creatio Mobile version that is not
  newer than that app, or, when the app is older than every version the changelog names, the newest
  one that precedes the oldest such heading.
- The build tools are the newest releases that build this layout: TypeScript 6 (`ts-loader` does not
  run TypeScript 7 yet), webpack 5 and webpack-cli 7, on Node.js 22 or newer. Write them as above;
  `npm install` takes the newest release within each range.
- Add a third-party library with `npm install <name>` only when the logic needs it. Its code is bundled
  into `main.js`, so it must run without a DOM and without Node.js built-ins.

## tsconfig.json

```json
{
  "compilerOptions": {
    "module": "ES2020",
    "moduleResolution": "bundler",
    "target": "es2019",
    "lib": ["es2020"],
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": false
  },
  "include": ["src/**/*.ts"]
}
```

- `experimentalDecorators` and `emitDecoratorMetadata` are required: the SDK registers handlers,
  requests, data sources and modules through decorators.
- `moduleResolution: "bundler"` matches how webpack resolves imports; the older `"node"` value is
  deprecated in TypeScript 6.
- `target` stays `es2019`. The script runs in the app's embedded JavaScript engine, not in a browser.
- `lib` has no `dom` entry on purpose: the engine has no DOM, and leaving it out makes the compiler
  reject `window`, `document` and similar at build time.

## webpack.config.js

```js
import path from 'path';
import { fileURLToPath } from 'url';

const projectDir = path.dirname(fileURLToPath(import.meta.url));
const moduleName = path.basename(projectDir);

export default {
	mode: 'development',
	devtool: false,
	entry: './src/index.ts',
	output: {
		path: path.resolve(projectDir, 'out', 'mobile', moduleName),
		filename: 'main.js',
		iife: true,
		globalObject: 'this',
		clean: true,
	},
	externals: {
		'@creatio/mobile-common': 'crtSdk',
	},
	resolve: {
		extensions: ['.ts', '.js'],
	},
	module: {
		rules: [{ test: /\.ts$/, loader: 'ts-loader', exclude: /node_modules/ }],
	},
};
```

Each setting carries a rule:

- `externals` maps the SDK import to the global `crtSdk` that the app provides. Without it the build
  either fails (the npm package has no JavaScript) or ships a second copy of the SDK.
- `iife: true` with `globalObject: 'this'` produces one self-running script, the only form the runtime
  evaluates.
- `mode: 'development'` keeps class names intact. The SDK keys modules by class name, so a minifier that
  shortens them makes two modules collide and evict each other.
- `devtool: false` keeps the module code out of `eval` wrappers and emits no source map file.
- `filename: 'main.js'` with `clean: true` guarantees the output folder holds exactly one script.
- The module name comes from the project folder name, so the three places that must agree cannot drift.

## .gitignore

```
node_modules/
out/
```

## src/index.ts

The entry file holds the module class and imports every handler, request and data source so that their
decorators run:

```ts
import { CrtModule, DoBootstrap, bootstrapCrtModule } from '@creatio/mobile-common';

import { UsrOrderSaveGuard } from './handlers/order-save-guard.handler';
import { UsrApplyDiscountHandler } from './handlers/apply-discount.handler';
import { UsrOrderHintsDataSource } from './data-sources/order-hints.data-source';

@CrtModule({
	requestHandlers: [UsrOrderSaveGuard, UsrApplyDiscountHandler],
	virtualDataSources: [UsrOrderHintsDataSource],
})
export class UsrOrderLogic implements DoBootstrap {
	public bootstrap(): void {
		bootstrapCrtModule('UsrOrderLogic', UsrOrderLogic);
	}
}
```

A handler, request or data source that is not listed in `@CrtModule` is never registered, however
correct its own decorator is.

Suggested source folders for a module with more than a couple of classes: `src/handlers/`,
`src/requests/`, `src/data-sources/`, `src/shared/`. A small module may keep everything in `index.ts`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm install` | install the SDK declarations and the build tools |
| `npx tsc --noEmit` | type-check against the SDK declarations |
| `npm run build` | produce `out/mobile/<ModuleName>/main.js` |
| `node check-behaviour.cjs out/mobile/<ModuleName>/main.js` | run the built module on a table of inputs; see `context/mobile-module-behaviour-check.md` |

`npm install` ends with an audit summary that may list vulnerabilities in the SDK package's own
dependencies. None of that code is in `main.js` — the SDK is an external. Never run
`npm audit fix --force`: it replaces the SDK with an old version the module does not compile against.

The build output is the only file that is delivered. Sources stay in the workspace and belong in the
developer's version control together with the package.

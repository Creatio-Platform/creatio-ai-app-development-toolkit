# `@creatio-devkit/common` Public API Reference

## Scope

This reference documents the verified API surface under:

`~/Projects/terrasoft/libs/devkit/common/src/lib/public/**`

Use this file as the source of truth when an AI agent needs to generate or edit Freedom UI code that imports `@creatio-devkit/common`.

Important guardrails:

- The root package barrel (`src/lib/index.ts`) also re-exports `base-exports`, `external/*`, and `internal/*`.
- For generated code and instructions, treat the `public/**` subtree as the stable surface.
- Do not switch to `internal/*` imports just because the root package technically exposes them.
- For `page-get` / `page-update` tasks, this guide tells you which `sdk.*` exports are safe to use in page-body handlers, but it does not replace marker-based page-body editing.
- For frontend-source tasks, this guide also covers decorators, bootstrap helpers, module registration, validators, converters, and custom view elements.

## Verified category map

| Category | Verified exports | Typical use |
|---|---:|---|
| `services` | 36 | Request-driven services, data access, HTTP, system values, processes, UI services |
| `models` | 50 | Response shapes, validation, converter contracts, request/config objects, view-element metadata |
| `decorators` | 17 | Frontend-source registration of handlers, validators, converters, modules, and view elements |
| `functions` | 12 | Module bootstrapping, dynamic registration, localization helpers, test/bootstrap infrastructure |
| `enums` | 4 | Small reusable enums for process status, collection actions, render modes, and input-property flags |
| `handlers` | 1 | Base class for typed request handlers in frontend source |

## How to use this reference

### For page-body handler work (`page-get` / `page-update`)

Most practical imports come from the services layer:

- `HttpClientService`
- `Model`
- `ProcessEngineService`
- `SysValuesService`
- `SysSettingsService`
- `RightsService`
- `FeatureService`
- `DialogService`
- `SchemaModalService`
- `MaskService`
- `MessageChannelService`
- `UserConsentService`

Use the live page alias (`sdk`, `devkit`, etc.) and extend existing imports conservatively.

### For frontend-source module work

The key building blocks are:

- decorators such as `CrtModule`, `CrtViewElement`, `CrtRequestHandler`, `CrtValidator`, `CrtConverter`
- `BaseRequestHandler`
- `bootstrapCrtModule()`
- `registerViewElement()` / `registerAngularViewElement()`
- metadata models such as `ModuleDefinition`, `ViewElementRegistrationConfig`, `ValidatorConfig`, `ConverterConfig`, `RequestHandlerDefinition`

## Services

### Core service classes

| Export | Kind | Source | Public API / purpose |
|---|---|---|---|
| `AiContextService` | class | `services/ai-context/ai-context.service.ts` | Singleton service for collecting AI context parts. Use `AiContextService.instance`, `setContextPart(provider, id?)`, `getContext()`, `removeContextPart(id)`, `removeContext()`. |
| `CrtZoneService` | class | `services/crt-zone/crt-zone.service.ts` | Runs a callback outside the Creatio zone. Main API: `runOutside(callback)`. Useful for frontend-source performance-sensitive work. |
| `DialogService` | class | `services/dialog-service/dialog.service.ts` | Opens dialogs through the handler chain. Main API: `open(config: BaseDialogConfig<BaseDialogButtonConfig>): Promise<string>`. Returns the selected action/result key. |
| `FeatureService` | class | `services/feature/feature.service.ts` | Reads feature flags. Main APIs: `getFeatureState(code)`, `getFeaturesState(codes)`. |
| `HandlerChainService` | class | `services/handler-chain/handler-chain.service.ts` | Global request-chain dispatcher. Main APIs: `HandlerChainService.instance`, `process(request)`, `subscribe(callback, context?)`. Also exposes `register()`, `update()`, `clearContextedHandlersCache()`, and `clear()` for infrastructure-level work. |
| `HttpClientService` | class | `services/http-client/http-client.service.ts` | Typed HTTP client backed by the handler chain. Main APIs: `get`, `post`, `put`, `patch`, `delete`. Supports `headers` and `responseType: 'json' | 'text' | 'blob' | 'arraybuffer'` with typed `HttpResponse<T>`. |
| `LicenseService` | class | `services/license/license.service.ts` | Checks license-restricted operations. Main APIs: `getLicenseOperationStatuses(codes)`, `getExplicitLicenseOperationStatuses(codes)`, deprecated `loadLicenseOperationStatuses(codes)`. |
| `MaskService` | class | `services/mask-service/mask.service.ts` | Shows and hides loading masks. Main APIs: `showBodyMask(settings?)`, `hideBodyMask()`. Also exposes `showMask(taskName, context)` and `hideMask(taskName, context)` for context-bound task masking. |
| `MessageChannelService` | class | `services/message-channel/message-channel.service.ts` | Sends and subscribes to server-channel messages. Main APIs: `subscribe(sender, callback)`, `sendMessage(sender, body, channelType)`. |
| `Model` | class | `services/model/model.ts` | Entity data access service. Main entry point: `Model.create(schemaName)`. Key APIs: `getSchema()`, `load()`, `insert()`, `update()`, `copy()`, `create()`, `delete()`, `canSave()`, `canDelete()`, `insertInTransaction()`, `updateInTransaction()`, `deleteInTransaction()`. |
| `ProcessEngineService` | class | `services/process-engine/process-engine.service.ts` | Starts and completes business processes. Main APIs: `executeProcessByName(processName, parameters?, resultParameterNames?)`, `completeExecuting(processElementUId, parameters?)`. |
| `RightsService` | class | `services/rights/rights.service.ts` | Checks operation permissions. Main APIs: `getCanExecuteOperation(name)`, `getCanExecuteOperations(names)`. |
| `SchemaModalService` | class | `services/schema-modal/schema-modal.service.ts` | Opens a schema inside a modal window. Main API: `show(config: SchemaModalConfig): Promise<void>`. |
| `SysSettingsService` | class | `services/sys-settings/sys-settings.service.ts` | Reads and writes system settings. Main APIs: `getByCodes(codes)`, `getByCode(code)`, `update(value, isPersonal?)`, `updateMany(values, isPersonal?)`. |
| `SysValuesService` | class | `services/sys-values/sys-values.service.ts` | Loads runtime system values. Main API: `loadSysValues(): Promise<SysValues>`. |
| `TransactionFactoryService` | class | `services/transaction-factory/transaction-factory.service.ts` | Creates transactions for atomic model operations. Main APIs: static `create()` and instance `create()` returning `Promise<ITransaction>`. |
| `UserConsentService` | class | `services/user-consent/user-consent.service.ts` | Manages current-user consent records. Main APIs: `UserConsentService.instance`, `getConsent(code)`, `getCurrentUserConsent(code)`, `giveCurrentUserConsent(code, expirationDate?)`. |

### Service-related types and helper exports

| Export | Kind | Source | Public API / purpose |
|---|---|---|---|
| `HttpHeaders` | interface | `services/http-client/http-headers.ts` | Simple string-to-string headers map used by `HttpClientService` methods. |
| `HttpResponse<T>` | interface | `services/http-client/http-response.ts` | Standard response wrapper used by `HttpClientService`: `headers`, `status`, `statusText`, `url`, `ok`, `body`. |
| `ClientSideDataSourceHierarchyConfig` | interface | `services/model/data-source-hierarchy-config.ts` | Hierarchy config for client-side tree state. Fields include `type: 'ClientSide'`, `hierarchicalColumnName`, optional `hierarchicalColumnValue`, optional `hierarchicalChildrenCountColumnName`, optional `hierarchicalState`. |
| `ServerSideDataSourceHierarchyConfig` | interface | `services/model/data-source-hierarchy-config.ts` | Hierarchy config for server-side loading. Fields include `type?: 'ServerSide'`, `hierarchicalColumnName`, optional `hierarchicalColumnValue`, optional `hierarchicalColumnFiltersValue`, optional `hierarchicalMaxDepth`, optional `hierarchicalFullDataLoad`. |
| `DataSourceHierarchyConfig` | type | `services/model/data-source-hierarchy-config.ts` | Union of `ClientSideDataSourceHierarchyConfig | ServerSideDataSourceHierarchyConfig`. |
| `isClientSideDataSourceHierarchyConfig` | function | `services/model/data-source-hierarchy-config.ts` | Type guard for `ClientSideDataSourceHierarchyConfig`. |
| `isServerSideDataSourceHierarchyConfig` | function | `services/model/data-source-hierarchy-config.ts` | Type guard for `ServerSideDataSourceHierarchyConfig`. |
| `HierarchyStateCollapsed` | interface | `services/model/hierarchy-state.ts` | Hierarchy state where collapsed rows are inferred and expanded rows are listed explicitly: `mode: 'collapsed'`, `expandedIds: string[]`. |
| `HierarchyStateExpanded` | interface | `services/model/hierarchy-state.ts` | Hierarchy state where expanded rows are inferred and collapsed rows are listed explicitly: `mode: 'expanded'`, `collapsedIds: string[]`. |
| `HierarchyState` | type | `services/model/hierarchy-state.ts` | Union of `HierarchyStateCollapsed | HierarchyStateExpanded`. |
| `isHierarchicalItemExpanded` | function | `services/model/hierarchy-state.ts` | Helper that resolves whether a hierarchy node should be treated as expanded based on `HierarchyState`. |
| `_from` | const | `services/model/model.ts` | Symbol used by framework-level code to build a `Model` from an existing internal CRT model instance. Publicly exported, but usually infrastructure-only. |
| `SchemaModalConfig` | interface | `services/schema-modal/schema-modal-config.model.ts` | Config for `SchemaModalService.show()`: `schemaName`, optional `action`, `recordId`, `defaultValues`, `parameters`, `preventDefaultCloseCommand`, `appearanceSettings`. |
| `QuerySysSettingsResponse` | interface | `services/sys-settings/sys-settings.service.ts` | Response from `SysSettingsService.getByCodes()`: extends `BaseResponse`, includes `values: Record<string, SysSetting>` and optional `notFoundSettings`. |
| `SaveSysSettingsResponse` | interface | `services/sys-settings/sys-settings.service.ts` | Response from `update()` / `updateMany()`: extends `BaseResponse`, includes `saveResult`, `rowsAffected`, and internal `nextPrcElReady`. |
| `PreloadSysSettingsResponse` | interface | `services/sys-settings/sys-settings.service.ts` | Response shape for preloaded cacheable settings: extends `BaseResponse`, includes `values: Record<string, SysSetting>`. |
| `SysSetting` | class | `services/sys-settings/sys-setting.model.ts` | Shape of a system setting record: `id`, `name`, `code`, `isCacheable`, `value`, `displayValue`, `dataValueType`. |
| `SysSettingValue` | class | `services/sys-settings/sys-setting.model.ts` | Minimal write-shape for system setting updates: `code`, `value`. |
| `SysValues` | interface | `services/sys-values/sys-values.ts` | Runtime system values returned by `loadSysValues()`. Important fields include `maintainer`, `workspace`, `userAccount`, `userContact`, `primaryLanguage`, `userCulture`, `userTimezoneCode`, `userTimezoneOffset`, `coreVersion`, `freedomUiSchemaVersion`, `environmentType`, `customer`. |

## Models

### AI context models

| Export | Kind | Source | Public API / purpose |
|---|---|---|---|
| `ContextDataSourcePart` | interface | `models/ai-context/ai-context-part.ts` | Describes one data source inside AI context: `entitySchemaName`, `displayColumnName`, `isCollection`, `isPrimary`, `records`. |
| `ContextDataRecord` | interface | `models/ai-context/ai-context-part.ts` | Lightweight AI-context record shape: `id`, `displayColumnValue`. |
| `CreatioPageContextPart` | interface | `models/ai-context/ai-context-part.ts` | AI-context part for page-backed data: optional `type: 'CreatioPageContextPart'`, `pageSchemaName`, `dataSources`. |
| `ConstantValuesContextPart` | interface | `models/ai-context/ai-context-part.ts` | AI-context part for plain constant values: `type: 'ConstantValuesContextPart'`, `values`. |
| `BaseContextPart` | interface | `models/ai-context/ai-context-part.ts` | Base AI-context part shape with optional `type`. |
| `ContextProvider` | type | `models/ai-context/ai-context-part.ts` | Provider signature for AI context: returns a page-context part or constant-values part, synchronously or via `Promise`. |
| `ContextPartAction` | type | `models/ai-context/ai-context-part.ts` | Allowed AI-context actions: `'set' | 'update' | 'remove'`. |
| `ContextPartRequest` | declare class | `models/ai-context/ai-context-part.ts` | Declared request shape for AI-context operations. Fields: `id`, `contextPartProvider`, `action`. Publicly exported, but mainly infrastructure-level. |

### Response and error models

| Export | Kind | Source | Public API / purpose |
|---|---|---|---|
| `BaseResponse` | interface | `models/base-response.model.ts` | Common response envelope with `success: boolean` and optional `errorInfo: ErrorInfo`. |
| `ValueResponse<T>` | interface | `models/base-response.model.ts` | `BaseResponse` with a typed `value` payload. |
| `ErrorInfo` | interface | `models/error-info.model.ts` | Detailed error shape with `errorCode`, `message`, and `stackTrace`. |

### Converter and validation models

| Export | Kind | Source | Public API / purpose |
|---|---|---|---|
| `ConverterConfig` | interface | `models/converter/converter-config.ts` | Minimal converter registration config. Main field: `type`. |
| `Converter<V, R>` | interface | `models/converter.model.ts` | Converter contract with `convert(value, context, ...args): R`. Used with `@CrtConverter`. |
| `BaseValidator` | abstract class | `models/validation/base-validator.ts` | Base class for custom validators. Override protected `async`, implement `validate(controlState, params?)`, and use `validateFn` / `isAsync`. |
| `CrtControlState` | interface | `models/validation/crt-control-state.ts` | Validation input state. Main field: `value`. |
| `CrtValidationError` | interface | `models/validation/crt-validation-errors.ts` | One validation error object with `message`. |
| `CrtValidationErrors` | interface | `models/validation/crt-validation-errors.ts` | Dictionary of validation errors keyed by arbitrary string. |
| `CrtValidatorFn` | type | `models/validation/crt-validator-fn.ts` | Function signature used by validators: accepts `CrtControlState` and optional `ValidatorParametersValues`, returns validation errors or `null`, sync or async. |
| `CrtValidationInfo` | interface | `models/validation/validation-info.ts` | Read-only validation state exposed to controls: `valid`, `errors`, `dirty`, `touched`. |
| `ValidatorConfig` | interface | `models/validation/validator-config.ts` | Validator registration config. Main public field: `type`; also exposes internal `params` and `scope`. |
| `ValidatorParametersValues` | interface | `models/validation/validator-parameter-values.ts` | Dictionary of validator parameter values with optional `message`. |

### View-element and module metadata models

| Export | Kind | Source | Public API / purpose |
|---|---|---|---|
| `CrtInputRegistrationConfig` | class | `models/input/input-registration-config.model.ts` | Input metadata for a registered view element. Exported fields include `propertyBindable`, `defaultValue`, `propertyName?: ViewElementProperty`, and `reuseStrategy`. |
| `InterfaceDesignerItemDefinition` | interface | `models/interface-designer-item/interface-designer-item-definition.ts` | Design-time metadata for a custom element in the interface designer. Contains `toolbarConfig`, optional `propertiesPanel`, and additional platform metadata fields. |
| `ModuleDefinition` | interface | `models/module-definition.ts` | Metadata passed to `@CrtModule()`. Main public fields: `includes`, `viewElements`, `validators`, `requestHandlers`, `converters`. |
| `BaseViewElementRegistrationConfig` | type | `models/view-element/base-view-element-registration-config.ts` | Core registration config for a custom view element. Main fields: `type`, optional `contentSlots`, `inputs`, `outputs`, `validationInputs`, optional `reuseStrategy`, optional `compatibleAPIs`, plus render config union. |
| `OnViewportRenderConfig` | interface | `models/view-element/base-view-element-registration-config.ts` | Render config for lazy rendering: `renderStrategy: ViewElementRenderStrategy.OnViewport`, `placeholderSize`. |
| `DefaultRenderConfig` | interface | `models/view-element/base-view-element-registration-config.ts` | Render config for immediate rendering: optional `renderStrategy?: ViewElementRenderStrategy.Default`. |
| `ViewElementRegistrationConfig` | type | `models/view-element/view-element-registration-config.ts` | `BaseViewElementRegistrationConfig` plus required `selector`. Typical config for `@CrtViewElement()` and `registerViewElement()`. |
| `ViewElementSlotDefinition` | interface | `models/view-element/view-element-slot-definition.ts` | Named content-slot definition with `name`, `lazy`, and `input`. |
| `ViewElementReuseStrategy` | enum | `models/view-element/view-element-reuse-strategy.enum.ts` | Re-render strategy enum with `Reuse` and `Rerender`. Controls whether a view element instance is reused or recreated on state changes. |
| `ViewElementRenderStrategy` | enum | `models/view-element/view-element-render-strategy.ts` | Render timing enum: `Default = 'default'`, `OnViewport = 'on-viewport'`. |

### Request, process, and handler-registration models

| Export | Kind | Source | Public API / purpose |
|---|---|---|---|
| `ProcessParameterValue` | interface | `models/process-engine/process-parameter-value.model.ts` | Single process parameter entry with `name` and `value`. |
| `RunProcessRequest` | class | `models/process-engine/run-process-request.model.ts` | Request object for process execution: `schemaUId`, `schemaName`, `parameterValues`, `resultParameterNames`. |
| `RunProcessResponse` | interface | `models/process-engine/run-process-response.model.ts` | Process execution result extending `BaseResponse`. Includes `message`, `processId`, `processStatus`, and optional `resultParameterValues`. |
| `BaseRequestConfig` | interface | `models/request/base-request-config.ts` | Generic request payload with `request` and optional `params`. Useful when code programmatically dispatches simple requests. |
| `DataRequest` | class | `models/request/data-source-request.ts` | Data-source-specific request class extending the base request infrastructure. Exposes `dataSourceName`. |
| `HandleViewModelAttributeChangeRequest` | class | `models/request/handle-view-model-attribute-change.request.ts` | Typed request fired for attribute changes. Key fields: `type`, `attributeName`, `value`, `oldValue`, deprecated `silent`, and the prevention flags `preventAttributeChangeRequest`, `preventStateChange`, `preventRunBusinessRules`. |
| `ViewModelAttributeChangeEventOptionsType` | interface | `models/request/view-model-attribute-change-event-options.ts` | Option flags used when constructing attribute-change events: `preventAttributeChangeRequest`, `preventStateChange`, `preventRunBusinessRules`, optional internal `isMaskedValue`. |
| `ChangeAttributeValueEventPayload` | interface | `models/request/model-event.model.ts` | Payload for attribute-change events: extends `ViewModelAttributeChangeEventOptionsType` and adds `attributeName`, `value`, `oldValue`, optional deprecated `silent`. |
| `RequestHandlerDefinition` | interface | `models/request-handler/request-handler-definition.ts` | Registration metadata for `@CrtRequestHandler()`: `type`, `requestType`, optional `scopes`. |

### Collection and creation models

| Export | Kind | Source | Public API / purpose |
|---|---|---|---|
| `ItemCreationConfig` | interface | `models/item-creation-config.ts` | Collection-item creation config extending base item creation settings. Adds `businessRulesActive?: boolean`. |
| `ViewModelCollectionChange<T>` | interface | `models/view-model-collection/view-model-collection-change.model.ts` | Change-event payload for view model collections: `collection`, `affectedElements`, `action`, optional `index`. |
| `ViewModelCollection<T>` | interface | `models/view-model-collection/view-model-collection.model.ts` | Collection interface with change subscriptions: `registerOnCollectionChangeCallback`, `unregisterOnCollectionChangeCallback`, `registerOnItemAttributesChangesCallback`, `unregisterOnItemAttributesChangesCallback`. |

### User consent and license models

| Export | Kind | Source | Public API / purpose |
|---|---|---|---|
| `LicenseRestrictionOperationValues` | interface | `models/license/license-restriction-operation-values.model.ts` | Dictionary that maps operation codes to `boolean` permission/license states. |
| `Consent` | interface | `models/user-consent/consent.model.ts` | Consent record shape with `id`, `name`, `code`, `consentText`. |
| `UserConsent` | interface | `models/user-consent/user-consent.model.ts` | Current-user consent record with `id`, `consentCode`, `dateOfConsent`, `expirationDate`. |

### Utility models

| Export | Kind | Source | Public API / purpose |
|---|---|---|---|
| `Entity` | interface | `models/entity.model.ts` | Generic entity row shape: string-keyed dictionary of `EntityColumnValue`. Useful when working with generic model data. |
| `SysImageValue` | interface | `models/image-value.model.ts` | Lookup-like image value with optional `url`. Useful when handling image-oriented attributes. |
| `LocalizableValue` | class | `models/localizable-value.ts` | Wrapper around a localization key. Created by `localize(key)` and used in decorator metadata. |
| `MaskSettings` | interface | `models/mask-settings.ts` | Mask-display options. Main field: `delay` in milliseconds. |

## Decorators

These exports are primarily for frontend-source modules, not raw page-body handlers.

| Export | Kind | Source | Public API / purpose |
|---|---|---|---|
| `CrtInput` | function | `decorators/input/input.decorator.ts` | Marks a component property as a platform-managed input. Signature: `CrtInput(config?: CrtInputRegistrationConfig)`. |
| `CrtOutput` | function | `decorators/output/output.decorator.ts` | Marks an event emitter or output property for platform output binding. Signature: `CrtOutput()`. |
| `CrtValidationInput` | function | `decorators/validation-input/validation-input.decorator.ts` | Marks a property that receives `CrtValidationInfo` updates. Signature: `CrtValidationInput()`. |
| `CrtViewElement` | function | `decorators/view-element/view-element.decorator.ts` | Registers a web view element. Public-safe usage is `CrtViewElement(config: ViewElementRegistrationConfig)`. |
| `CrtMobileViewElement` | function | `decorators/view-element/mobile-view-element.decorator.ts` | Registers a mobile view element. Public-safe usage is `CrtMobileViewElement(config: ViewElementRegistrationConfig)`. |
| `Platform` | type | `decorators/view-element/view-element-decorator-utils.ts` | Utility union `'web' | 'mobile'` used by decorator internals. Publicly exported, but mostly infrastructure-level. |
| `viewElementRegister` | function | `decorators/view-element/view-element-decorator-utils.ts` | Lower-level helper used by decorator infrastructure to attach view-element metadata. Usually not needed directly in generated code. |
| `CrtModule` | function | `decorators/module/module.decorator.ts` | Declares a CRT module with `ModuleDefinition`. Typical use: `@CrtModule({ viewElements, validators, requestHandlers, converters, includes })`. |
| `CrtInterfaceDesignerItem` | function | `decorators/interface-designer-item/interface-designer-item.decorator.ts` | Registers design-time metadata for a custom web element in the interface designer. |
| `interfaceDesignerItemRegister` | function | `decorators/interface-designer-item/interface-designer-item-decorator-utils.ts` | Lower-level helper that attaches interface-designer metadata for web/mobile items. Publicly exported, but usually infrastructure-level. |
| `CrtMobileInterfaceDesignerItem` | function | `decorators/interface-designer-item/mobile-interface-designer-item.decorator.ts` | Mobile variant of `CrtInterfaceDesignerItem`. |
| `CrtInject` | function | `decorators/inject/inject.decorator.ts` | Decorator for constructor/token injection. Signature: `CrtInject(token: unknown)`. |
| `CrtValidator` | function | `decorators/validator/validator.decorator.ts` | Registers a custom validator. Typical use: `@CrtValidator({ type: 'usr.MyValidator' })`. |
| `CrtRequestHandler` | function | `decorators/request-handler/request-handler.decorator.ts` | Registers a custom request handler. Typical use: `@CrtRequestHandler({ type, requestType, scopes? })`. |
| `CrtConverter` | function | `decorators/converter/converter.decorator.ts` | Registers a custom converter. Typical use: `@CrtConverter({ type: 'usr.MyConverter' })`. |
| `ChatMessageTypeRegistrationConfig` | interface | `decorators/chat-message-type/chat-message-type.decorator.ts` | Config for custom chat message renderers: `selector`, `messageType`. |
| `CrtChatMessageType` | function | `decorators/chat-message-type/chat-message-type.decorator.ts` | Registers a component as a custom chat message type. Typical use: `@CrtChatMessageType({ selector, messageType })`. |

## Functions

These exports are mostly relevant to frontend-source modules and custom-component packages.

| Export | Kind | Source | Public API / purpose |
|---|---|---|---|
| `registerViewElement` | function | `functions/register-view-element.ts` | Dynamically registers a non-Angular/custom view element using `ViewElementRegistrationConfig`. Useful when registration is done without decorators. |
| `registerAngularViewElement` | function | `functions/register-angular-view-element.ts` | Lower-level helper for registering an Angular component as a view element with `typeRef`. Publicly exported, but more infrastructure-oriented than `CrtViewElement`. |
| `BootstrapOptions` | interface | `functions/bootstrap-crt-module.ts` | Options for `bootstrapCrtModule()`. Key public fields: `localizeMetadata?`, `resolveDependency?`; also exposes infrastructure hooks like `moduleType`, `featureValues`, and `onContextCreate/Update/Destroy`. |
| `bootstrapCrtModule` | function | `functions/bootstrap-crt-module.ts` | Main bootstrap entry point for CRT frontend modules. Registers view elements, validators, handlers, converters, designer metadata, and included modules. Supports overloads with `(type, options?)` and remote-name variants. |
| `localize` | function | `functions/localize.ts` | Wraps a localization key into `LocalizableValue` for decorator metadata. Typical use: `localize('MyElement.Caption')`. |
| `bootstrapCrtModuleHandlerChainServices` | function | `functions/bootstrap-crt-module-handler-chain-services.ts` | Bootstraps handler-chain service registrations from a module and its included modules. Publicly exported, but primarily infrastructure-level. |
| `resetGlobals` | function | `functions/reset-globals.ts` | Clears global registries and handler-chain state. Mostly useful in frontend unit tests and bootstrap cleanup. |
| `bootstrappedCrtModules` | const | `functions/bootstrapped-crt-modules.ts` | Global map of already bootstrapped CRT modules. Publicly exported, but infrastructure/test-oriented. |
| `callOnContextCreateHooks` | function | `functions/crt-module-context-hooks.ts` | Triggers `onContextCreate` hooks for root CRT modules. Infrastructure-level. |
| `callOnContextUpdateHooks` | function | `functions/crt-module-context-hooks.ts` | Triggers `onContextUpdate` hooks for root CRT modules. Infrastructure-level. |
| `callOnContextDestroyHooks` | function | `functions/crt-module-context-hooks.ts` | Triggers `onContextDestroy` hooks for root CRT modules. Infrastructure-level. |
| `defineRenderConfig` | function | `functions/define-render-config.ts` | Normalizes render config for view elements. Ensures `OnViewport` config has default placeholder sizing when needed. Publicly exported, but mostly used by decorator/registration infrastructure. |

## Enums

| Export | Kind | Source | Values / purpose |
|---|---|---|---|
| `DataSourceLoadType` | enum | `enums/data-source-load-type.enum.ts` | Load strategy enum: `LoadNext = 'loadNext'`, `Load = 'load'`, `Reload = 'reload'`. |
| `ProcessStatus` | enum | `enums/process-status.enum.ts` | Process state enum: `Inactive = 0`, `Running = 1`, `Completed = 2`, `Error = 3`, `Cancelled = 4`. Used in `RunProcessResponse`. |
| `ViewElementProperty` | enum | `enums/view-element-property.enum.ts` | Input-property flag enum: `Readonly = 'READONLY_PROPERTY'`, `Disabled = 'DISABLED_PROPERTY'`. Used by `CrtInputRegistrationConfig.propertyName`. |
| `ViewModelCollectionActionType` | enum | `enums/view-model-collection-action-type.enum.ts` | Collection change enum: `Add = 'add'`, `Remove = 'remove'`, `Move = 'move'`, `Reload = 'reload'`. |

## Handlers

| Export | Kind | Source | Public API / purpose |
|---|---|---|---|
| `BaseRequestHandler<TRequest, TResult>` | abstract class | `handlers/base-request-handler.ts` | Base class for typed request handlers in frontend source. Implement `handle(request): Promise<TResult>`. Use `setNext(next)` to join the chain. Protected `next` gives access to the next handler; protected `handlerChain` points to `HandlerChainService.instance`. |

## Practical guidance for AI code generation

### Safe defaults for page-body handlers

Prefer these exports first when the task is to edit a deployed page body:

- `HttpClientService` for REST calls
- `Model` for CRUD and record lookup
- `SysValuesService` for current user, culture, and environment values
- `SysSettingsService` for configuration reads/writes
- `RightsService` for operation permissions
- `FeatureService` for feature flags
- `ProcessEngineService` for direct process starts/completions
- `DialogService`, `SchemaModalService`, `MaskService` for user interaction and UI state
- `MessageChannelService` for channel-driven updates

### Safe defaults for frontend-source extension work

Prefer these exports when generating custom frontend modules or controls:

- `@CrtModule()` + `ModuleDefinition`
- `@CrtViewElement()` / `@CrtMobileViewElement()`
- `@CrtInterfaceDesignerItem()` / `@CrtMobileInterfaceDesignerItem()`
- `@CrtRequestHandler()` + `BaseRequestHandler`
- `@CrtValidator()` + `BaseValidator`
- `@CrtConverter()` + `Converter`
- `bootstrapCrtModule()`
- `registerViewElement()` only when decorator-based registration is not the best fit

### What not to do by default

- Do not treat root-barrel access to `internal/*` as permission to generate internal imports.
- Do not replace page-body marker editing with frontend-source decorators when the task is specifically `page-get` / `page-update`.
- Do not assume every exported helper is appropriate for page-body handlers; many decorator and bootstrap helpers are meaningful only in frontend-source modules.

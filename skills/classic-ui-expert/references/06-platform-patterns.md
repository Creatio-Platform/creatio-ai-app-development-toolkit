# 06 — Platform patterns: idioms and what they mean

The only place in this skill where platform schema names appear. Each entry: what it looks
like in source → what it means → where to look next. Domain schema names never belong here.

## Card-action relay (`onCardAction` + `tag`)

**Looks like:** a diff `insert` whose values carry `"click": {"bindTo": "onCardAction"}` together
with `"tag": "SomeMethodName"`.

**Means:** the control cannot run the action on its own host view model. `onCardAction`
(`BaseDataView [CrtUIPlatform7x]`) publishes the sandbox message `"OnCardAction"` carrying the
tag to the card module; the subscriber (`BasePageV2 [CrtUIPlatform7x]`) executes
`this[action]()` — so **the tag is the name of the method to invoke on the card's view model**.
The message is generic; the tag is the only thing that says what to call.

**Where next:** resolve the tag as a method name on the record page's chain (and its mixins) —
not on the schema that declares the button.

**Corollary — the same behaviour can appear as two inserts.** A control hosted by the section
module needs the relay; the equivalent control hosted by the card binds `click` straight to the
method. Two inserts in two schemas, different bindings, **one behaviour** — one card. A page
layer may also override `onCardAction` to accept an object config (`{methodName, args}`) and
defer to `callParent` otherwise.

## Container names encode the host

**Looks like:** `parentName` values such as `CombinedMode…` / `SeparateMode…` versus plain
containers (`LeftContainer`, `ActionButtonsContainer`, tab containers).

**Means:** `CombinedMode*` / `SeparateMode*` containers belong to the **section module's**
rendering of a record (list beside card, or card opened from the list); the plain page
containers belong to the **card module**. A `remove` of a `SeparateMode…` element affects only
the list-view rendering; the combined-mode twin may survive untouched.

**Where next:** before stating "the control is gone", check whether the *other* mode's element
is also removed. State the mode your claim covers.

## Business rules

**Looks like:** `BusinessRuleModule.enums.RuleType.BINDPARAMETER` (or FILTRATION / VISIBILITY),
with `property: ENABLED|VISIBLE|REQUIRED`, `conditions[]` comparing an ATTRIBUTE to a CONSTANT.

**Means:** declarative field state driven by a view-model attribute — no imperative code runs.
Field enabled/visible/required is the effect; the attribute is the trigger.

**Where next:** find who *sets* that attribute (often an `init` doing a permission or setting
lookup). Rule + setter together are one unit.

## Sandbox message pairs

**Looks like:** `messages: { "X": { direction: SUBSCRIBE|PUBLISH, mode: PTP|BROADCAST } }`, and
`sandbox.subscribe("X", …)` / `sandbox.publish("X", …)` in methods.

**Means:** cross-module wiring. A subscription changes this view model's state when another
module says so; a publication informs others.

**Where next:** locate the counterpart within the fetched surface. If absent, record the thread
as unresolved (`05-reference-following.md`) — do not assume the counterpart's identity.

## Server service call

**Looks like:** `this.callService({ serviceName: "…", methodName: "…", data: {…} }, callback)`,
usually with a body mask and a result dialog; sometimes a long `timeout`.

**Means:** the work happens server-side. The client unit is: trigger, payload, wait indication,
result handling. A generous timeout is circumstantial evidence of heavy server work (e.g. a
deep copy), not proof of what it does.

**Where next:** stop at the boundary — see `07-boundaries.md`. Record the service and method
names verbatim; describing the server implementation is not this card's job.

## Process launch, often via a system setting

**Looks like:** `Terrasoft.SysSettings.querySysSettings(["SomeProcessSetting"], …)` → a process
id → a runner; or, on Freedom-side pages, a `crt.RunBusinessProcessRequest` with `processName`.

**Means:** the target is **configurable**: the setting decides which process runs. An empty
setting is handled as an error path with its own message.

**Where next:** record the setting name as the indirection. The process body is beyond the
client boundary; if the run needs it, that is a settling query, not an assumption you resolve
by guessing.

## Entity-parameterized mixin machinery

**Looks like:** a mixin whose gate reads a **convention-built setting name** — a fixed prefix
(often a localizable resource) concatenated with `this.entitySchemaName` — and which exposes
an intentionally empty hook (`someHook: this.Terrasoft.emptyFn`) that host layers override.
The host page layer contributes only the mixin wiring, a lifecycle hook-in (init/save chain),
and the hook override with entity-specific values.

**Means:** the behaviour is *reusable machinery*: the same mixin can drive the same behaviour
on any entity, each gated by its own setting (`<Prefix><EntityName>`). The unit is still
**one behaviour** — attribute the mixin members (gate, guards, action) and the host layer's
members (plug-in, mapping) to the same card, and name the derived setting explicitly.

**Where next:** resolve the prefix resource to state the concrete setting name; note that
sibling entities may host the same behaviour under sibling settings (a scope observation, not
this card's subject). The setting's *value* on the stand is data — an assumption with a
settling query unless queried.

## Feature flag gate

**Looks like:** `if (!this.getIsFeatureEnabled("SomeFeature")) { … }` wrapping the logic.

**Means:** the unit is conditional on a feature state — possibly **dormant** on the stand you
are reading. State the flag name and that the behaviour is gated. Do **not** assert the flag's
value unless you queried it; if you did, cite the query.

## Operation permission check

**Looks like:** `this.checkCanExecuteOperation("SomeOperationCode", function(r){ this.set("X", r); })`,
typically in `init`.

**Means:** a system-operation permission is resolved once and stored as an attribute. The
*behaviour* is whatever consumes the attribute (frequently a business rule enabling a field).

**Where next:** find the consumer. If none exists in the fetched set, say so plainly — a stored
flag with no consumer is a finding, not a behaviour.

## Print / report menus

**Looks like:** ESQ over a related entity joined to `SysModuleReport` (`Printable`), building
menu items whose click hands a report descriptor to `downloadPrintForm`, then `downloadReport`.

**Means:** the record's registered print forms are surfaced as menu entries.

**Where next:** the reports themselves are data (`SysModuleReport` rows), not code — treat their
existence as a data question, not a source claim.

## Detail wiring

**Looks like:** a `details` block entry — `schemaName`, `filter: { masterColumn, detailColumn }`,
`defaultValues` — plus a diff `insert` of `itemType: DETAIL` into a tab container.

**Means:** a related list is attached to the page, filtered by the master record, with fields
pre-populated on new child records. The filter and the defaults *are* behaviour worth describing.
Note the split of duties: the **filter column doubles as an automatic default** — a record
created from a filtered detail gets its link to the master from the filter, not from
`defaultValues`. And `defaultValues` copy whatever the master holds at creation time — an
empty master field copies as empty, which is correct behaviour, not a broken mapping.

**Where next:** the detail's own schema chain, if the unit's description depends on what the
detail itself customizes.

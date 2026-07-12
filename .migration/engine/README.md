# Ф2/Ф3 — Merge Engine + Mapper (прототип)

Детермінований merge-рушій: N шарів класичної ClientUnitSchema (base→top) → одна **ефективна сторінка** + provenance. Чистий Node-модуль, **без залежності від Creatio/стенду** — тестується офлайн на golden-фікстурах.

## Файли
- `engine.mjs` — `parseLayer(src,pkg)` (sandbox-парсинг тіла `define(...)` через `node:vm` + універсальний Proxy для Terrasoft/Ext/this) і `mergeLayers(layers)` (replay diff · merge businessRules/rules/details по ключу · override-стек методів · provenance).
- `run.mjs` — golden-runner: завантажує фікстури, зливає, друкує звіт, перевіряє assert-и.

## Запуск
```
node .migration/engine/run.mjs
```

## Golden-результат (merge 46/46 ✅)
- **SupportUnit** (SupportCalendar + SupportService): entity=SupportUnit; 8 полів; 3 вкладки; 3 деталі (вкл. `SupportScheduleEmployeeDetail`); 4 правила (ParentSupportUnit/SupportWorkingDayType FILTRATION, Contact/Calendar Required); метод `setName`.
- **Contract** (9 шарів): entity=Contract; 25 полів; 5 вкладок; 14 деталей; 19 активних правил; **removed** `State`(WorkContractsProcess), `Contact`+`ContractSumGroup`(WorkOverride); `Owner` FILTRATION + `Parent` Required (WorkContractsProcess); 71 метод.
- **F1 (порядок):** шари подаються у справжньому порядку залежностей (`HierarchyLevel` зі стенду: 299<320<…<607). `mergeLayers` віддає `warnings` (op б'є по відсутньому item) і `unresolvedParents` (діагностика порядку/seed).
- **F2 (seed бази):** `mergeLayers(layers, {seedLayers})` + fixture `_base/BaseModulePageV2_skeleton.js` → базові контейнери резолвляться (`unresolvedParents→0`), базова вкладка `ESNTab` з'являється, клієнтські вкладки лишаються.

## Що доводить
Реконструкція ефективної сторінки з 9 шарів, яку раніше LLM-субагент рахував ~142k токенів, тут виконується **детерміновано й миттєво кодом** — підтвердження тези «merge = код, не LLM».

## Ф3 — Mapper (`mapper.mjs`, `run-mapper.mjs`)
`mapToFreedom(effective, {entityColumns})` → Freedom ChangeSet: `viewConfigDiff` (поле = 3-частинне зв'язування, control за типом колонки), `viewModelConfigDiff`/`modelConfigDiff`, `pageBusinessRules`/`entityBusinessRules` (FILTRATION→entity apply-static-filter; BINDPARAMETER→page make-* + **зворотне**), `details` (композит «Expanded list» + dependency), `handlerStubs`, `needsDecision[]` (judgment 20%: кастомні компоненти/графіки, методи, видалення, невідомі типи).
- **container-role mapping** (урок #6): `ProfileContainer`/`Header`→`SideAreaProfileContainer`.
- **F3 — дерево вкладок/контейнерів:** кожне поле маршрутизується **підйомом по предках** (`resolveOwner`): tab-предок→вкладка (емітимо `crt.Tab`+`…Grid` раз і лише коли вкладка тримає ≥1 поле), Header/Profile→бічний профіль, інакше→fallback+`needsDecision`. Плоскої «GeneralInfoTabContainer»-звалки більше нема.
- **F9 — payload vs context (за походженням):** елемент належить payload, лише якщо його визначив schema-шар — diff-items за `templateOwned` (insert-походження), keyed-категорії за `schemaTouched`. Базові фреймворк-методи/деталі/компоненти + базові вкладки, які клієнт лише перекомпонував, лишаються layout-контекстом (`crt.Tab` для них не синтезуємо). `baseContextExcluded` рапортує відкинуте. (На реальному SupportUnit: 348 методів→1, 4 деталі→3, 12 компонентів→9.)
- Запуск: `node .migration/engine/run-mapper.mjs` (або `npm test` у `engine/` — ганяє обидва раннери, `exit 1` при фейлі) — **golden 65/65 ✅**.
- **«Зробити гучно» (звірка Case):** `unmapped-component` (корінь кожного викинутого не-field піддерева — SLA-таймер, кастомні кнопки), `referenced-module` (UI-модулі з `define()`-залежностей поза юнітом сторінки), `field-hint` (динамічний `hint`) — жоден нестандартний елемент не зникає тихо, усе → `needsDecision`. Див. «Межа non-BaseModulePageV2» у [SELF-REVIEW](../SELF-REVIEW.md).
- Для SupportUnit код генерує ChangeSet, **структурно еквівалентний зрізу**, зібраному вручну (`poc/body_full6.js`), для полів/контролів/профілю/деталі/правил. Він **не байт-у-байт**: базовий seed подається окремо (F2, ще не тягнемо реальний parent-template зі стенду — тому немає поля `Name`), а деталь віддається як composite-спека, не повне тіло Expanded list із тулбаром. Це відомі прогалини — див. нижче.

## Обмеження прототипу (доробити → продукт)
- Символьні enum-и: `BusinessRuleModule` (RuleType/Property) і `ViewItemType` (лише підтверджені 0/2/15) **засіджені** → резолвляться. Інші члени `ViewItemType` та `Terrasoft.ContentType.*` ще символьні → нечислові (null); дозасідити за підтвердженими значеннями (ніколи не вгадувати — урок E1).
- Порядок шарів (F1): подається у порядку `HierarchyLevel` зі стенду (авторитетна топо-глибина). `SysPackageInDependency` **не** ESQ-читабельна, тож сирі DAG-ребра недоступні — двозначність (однаковий рівень) позначається `warnings`, не топосортиться.
- Seed бази (F2): механізм є (`seedLayers`), але офлайн-fixture — скелет; реальний parent-template ще не тягнеться зі стенду (тому немає, напр., `Name`).
- Функції у `attributes`/`methods` фіксуються за наявністю (provenance), тіла не аналізуються (це вхід для mapper/handler-заготовок).

# Ф2/Ф3 — Merge Engine + Mapper (прототип)

Детермінований merge-рушій: N шарів класичної ClientUnitSchema (base→top) → одна **ефективна сторінка** + provenance. Чистий Node-модуль, **без залежності від Creatio/стенду** — тестується офлайн на golden-фікстурах.

## Файли
- `engine.mjs` — `parseLayer(src,pkg)` (sandbox-парсинг тіла `define(...)` через `node:vm` + універсальний Proxy для Terrasoft/Ext/this) і `mergeLayers(layers)` (replay diff · merge businessRules/rules/details по ключу · override-стек методів · provenance).
- `run.mjs` — golden-runner: завантажує фікстури, зливає, друкує звіт, перевіряє assert-и.

## Запуск
```
node .migration/engine/run.mjs
```

## Golden-результат (15/15 ✅)
- **SupportUnit** (SupportCalendar + SupportService): entity=SupportUnit; 8 полів; 3 вкладки; 3 деталі (вкл. `SupportScheduleEmployeeDetail`); 4 правила (ParentSupportUnit/SupportWorkingDayType FILTRATION, Contact/Calendar Required); метод `setName`.
- **Contract** (9 шарів): entity=Contract; 25 полів; 5 вкладок; 14 деталей; 19 активних правил; **removed** `State`(WorkContractsProcess), `Contact`+`ContractSumGroup`(WorkOverride); `Owner` FILTRATION + `Parent` Required (WorkContractsProcess); 71 метод.

## Що доводить
Реконструкція ефективної сторінки з 9 шарів, яку раніше LLM-субагент рахував ~142k токенів, тут виконується **детерміновано й миттєво кодом** — підтвердження тези «merge = код, не LLM».

## Ф3 — Mapper (`mapper.mjs`, `run-mapper.mjs`)
`mapToFreedom(effective, {entityColumns})` → Freedom ChangeSet: `viewConfigDiff` (поле = 3-частинне зв'язування, control за типом колонки), `viewModelConfigDiff`/`modelConfigDiff`, `pageBusinessRules`/`entityBusinessRules` (FILTRATION→entity apply-static-filter; BINDPARAMETER→page make-* + **зворотне**), `details` (композит «Expanded list» + dependency), `handlerStubs`, `needsDecision[]` (judgment 20%: кастомні компоненти/графіки, методи, видалення, невідомі типи).
- **container-role mapping** (урок #6): `ProfileContainer`→`SideAreaProfileContainer`.
- Запуск: `node .migration/engine/run-mapper.mjs` — **golden 12/12 ✅**.
- Для SupportUnit код згенерував **той самий ChangeSet, що зібрано вручну на стенді** (`poc/body_full6.js`) — підтвердження «код готує чернетку, агент доробляє спірне».

## Обмеження прототипу (доробити на Ф2→продукт)
- Символьні enum-и (`Terrasoft.ContentType.LOOKUP`, `ViewItemType.*`) через Proxy стають нечисловими → у моделі беремо лише числові `contentType/itemType`; символьні декодуються окремою таблицею на етапі mapper (Ф3).
- Порядок шарів наразі передається вручну; у проді — з `SysPackageInDependency`.
- Функції у `attributes`/`methods` фіксуються за наявністю (provenance), тіла не аналізуються (це вхід для mapper/handler-заготовок).

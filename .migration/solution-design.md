# Solution Design — Classic → Freedom UI міграція кастомізацій клієнта

Статус: **узгоджено (архітектура + план)** · Принципи/кейси: див. [`solution-scope.md`](solution-scope.md) · Phase-0 контракти: [`normalized-model.md`](normalized-model.md)

## 1. Головне архітектурне рішення
**Розділити детермінований «рушій міграції» (код/MCP-тули) і судження агента (LLM).**
Підстава з розвідки: реконструкція merged-сторінки з 9 шарів з'їла в субагента ~142k токенів на одну сторінку; формат запису Freedom механічний і крихкий (поле = 3 зв'язані правки, деталі = config, правила = окремі артефакти); резолв графа ролей — фіксовані JOIN'и. Усе це — детерміноване, і має бути кодом, а не «руками» LLM.

| Детерміновано (код/тули) | Судження (агент) |
|---|---|
| читання шарів по UId; merge; резолв графа ролей; класифікація пакетів; type→компонент; 3-частинні diff полів; config деталей; трансляція декларативних правил (+зворотні); валідація/read-back | неоднозначний мапінг; звірка бази (A3.1); кастомні компоненти (B10); складні handler'и (B5); base-видалення від product-шару; UX; апрув |

## 2. Шари рішення
- **Шар 1 — Read/Discovery (нові MCP-тули в `clio`, C#):** `get-classic-schema` (по UId — сирий body шару) ✅; `list-schema-layers` (усі шари + editable) ✅; `resolve-migration-unit` (граф ролей — чисті ESQ, один рівень; рекурсію деталей веде скіл). Реюз `SchemaDesignerHelper.LoadSchema` + `IApplicationClient`. *(NB: `creatio` MCP = `mcp-creatio` — дані/сутності, НЕ дім цих тулів.)*
  - **`get-effective-classic-schema` — НЕ C#-тул.** GetSchema повертає сирий JS-body, а `diff`/`businessRules` — усередині JS; парсити JS у C# крихко. Тому **merge — pure Node-модуль** (Шар 2), який годується сирими шарами з clio-тулів. Узгоджено з §3.4 (Read=clio, Transform=pure module).
- **Шар 2 — Детермінований рушій (merge + graph + mapper):** деталі в §3.
- **Шар 3 — Знання (референси скіла):** метамоделі Classic/Freedom, таблиця мапінгу control→компонент, каталог компонентів/шаблонів (v8.3.4), новий `page-roles-and-recursion`.
- **Шар 4 — Оркестрація (розширення скіла `classic-to-freedom-migration`):** фази з approval-gate + living-docs; граф ролей; рекурсія деталей; двоетапний A3; full-effective-merge як вихід; B9/B10.
- **Шар 5 — Write + Guardrails (наявні clio-тули):** `create-page`/`update-page`/`sync-pages` (diff-only, conflict-guard), `create-page-business-rules`/`create-entity-business-rules`, `create-related-page-addon`, `validate-page`. Ніколи в product-пакет; declarative-first; без `compile` (лише C#).

## 3. Шар 2 — деталі
### 3.1 Merge Engine (pure; у тулі `get-effective-classic-schema`)
Вхід: упорядкований (base→top за `SysPackage.HierarchyLevel` — див. §4/F1) список розпарсених шарів + `seedLayers` (parent-template skeleton, F2).
Алгоритм: seed → merge non-diff секцій по ключу (attributes/details/rules/businessRules; масиви заміщуються; methods → стек override з `callParent`; tombstone `removed`/`enabled:false`) → replay `diff` (insert/merge/move/remove по `name`; **missing-target → `warnings` + `unresolvedParents`**, не тихий skip) → finalize (tombstones геть, таби за `order`, метод=top-of-stack). Порядок шарів **не** топосортиться в рушії — він приходить уже впорядкований від `list-schema-layers` (HierarchyLevel — авторитетна топо-глибина стенду); рушій лише валідує (`warnings`).
Вихід: `EffectiveClassicPage` + **provenance** (звідки кожен елемент, `isClientEditable`).
Edge-cases: дві системи правил (numeric `businessRules` + legacy `rules`) — парсити обидві; `ruleKey` = ім'я або uId; аномалії зберігати вербатимно; numeric↔symbolic enums через decode-таблицю; tombstone базового елемента = B6-сигнал **лише якщо шар-видаляч client-editable**.

### 3.2 Graph Resolver (у тулі `resolve-migration-unit`; потрібен стенд)
entity/section → sections → edit pages (типізовані за `SysModuleEntity.TypeColumnUId`) → mini (`MiniPageSchemaUId`/`MiniPageModes`) → details (`details{}` сторінки + `SysDetail`) → Freedom-counterparts (Freedom-шаблон у `Parent` + конвенція імен). **Рекурсія деталей** із `visited`-set + cap глибини (self-ref деталь переюзовує набір батька).

### 3.3 Mapper (pure-модуль, без стенду)
`EffectiveClassicPage` (+ target/Freedom-контекст) → `FreedomChangeSet` (viewConfigDiff/viewModelConfigDiff/modelConfigDiff/pageBusinessRules/entityBusinessRules/handlerStubs/relatedPageBindings/resources) + `needsDecision[]`.
Детерміновані трансформи: поле→3 правки (control+attribute+dataSource); контейнери→Freedom-контейнери; деталь→«Expanded list» композит + dataSource(scope:viewElement)+isCollection+dependencies; декларативне правило→business-rule (+обов'язкове зворотне); імперативний метод→handler-заготовка. Reconcile-diff для A3 (base↔Freedom) теж тут.

**Деталь — за повним контрактом композита (урок PoC):** деталь будується з рецепта `get-component-info composite="Expanded list"` цілком (panel+grid+повний тулбар add/refresh/import-export/search + `filterAttributes` + `dependencies`), а не hand-rolled підмножиною; пропуск дії тулбара — лише за явним опт-аутом.

**Структурне збереження (обов'язкове; урок PoC):** цільовий контейнер визначається **роллю контейнера-джерела в Classic**, а НЕ «першим порожнім/зручним». Мапа: Classic `ProfileContainer`/ліва-панель→`SideAreaProfileContainer`; вкладка→`TabPanel`/`TabContainer` (та сама); `CONTROL_GROUP`→`ExpansionPanel`/`GridContainer`; `GRID_LAYOUT`→`GridContainer`; деталь-у-вкладці→«Expanded list» у відповідній вкладці. Зріз змінює лише КІЛЬКІСТЬ елементів, ніколи РОЗКЛАДКУ. (PoC-дефект: поля кинуто в першу вкладку scaffold замість профілю — mapper мусить мати крок container-role mapping.)
`needsDecision[]`: кастомні компоненти, нетривіальні методи, base↔Freedom розбіжності, неоднозначності, base-видалення від product-шару.

**Payload vs context (F9, урок повного прогону):** seed parent-template потрібен для резолву layout, але НЕ є payload. Кожен елемент тегається `fromTemplate` (provenance ⊆ seed-пакети); мігруємо лише елементи, яких торкнувся schema-шар сторінки — базові фреймворк-методи (300+ на BaseEntityPage), базові деталі/компоненти лишаються контекстом. `baseContextExcluded` рапортує відкинуте (прозоро). Це відповідає принципу 2 (переносимо base+customization СХЕМИ), але не тягне платформний template-ланцюг, бо його Freedom-аналог дає цільовий Freedom-шаблон.

### 3.4 Межа рушій/агент і дім модулів
Read (layers/graph зі стенду) — у `clio` (розширення його схема-тулів). Transform (mapper + reconcile-diff) — **окремий pure-модуль без залежності від Creatio** (ізольовано тестований). Спільна мова — нормалізована модель ([`normalized-model.md`](normalized-model.md)).

## 4. Валідовані основи (факти з тестового стенду `workbuild103_15688915_0726`)
- GetSchema по UId повертає повне тіло (перевірено; 62KB на CoreContracts/ContractPageV2).
- Merge на 9 шарах Contract: зірка-топологія (усі replacing → base row), порядок за `HierarchyLevel` (виміряно: 299<320<329<357<358<533<541<596<607, **строго без дублів**); правила Owner-filter + Parent-required-if-`Type.IsSlave` лежать у `WorkContractsProcess`.
- **F1-знахідка:** `SysPackageInDependency` **не** ESQ-ObjectSchema (сирі DAG-ребра не читаються); `useFullHierarchy=true` на GetSchema — **no-op** (тіло лишається власним diff шару). Тож платформа не композить, merge-рушій необхідний, а авторитетний сигнал порядку — `SysPackage.HierarchyLevel` (не проксі).
- Граф ролей: типізовані сторінки (`SysModuleEntity.TypeColumnUId`), mini (`MiniPageSchemaUId`), деталі (`details{}`+`SysDetail`), Freedom-counterpart (base `Parent`-шаблон).
- Editable-пакет: `Maintainer ∉ {Creatio,Terrasoft} AND InstallType=0`.
- Freedom write: 6-маркерний AMD, diff-only; поле=3 правки; деталь=config; правила=окремі артефакти.
- Каталог компонентів v8.3.4 (188 типів + композити) + шаблони сторінок.

## 5. План реалізації
Принципи: тонкий наскрізний зріз спершу; Contract як золотий еталон; «читання без запису» як рання демо-віха.

- **Ф0 Фундамент:** нормалізована модель + фікстури ([`normalized-model.md`](normalized-model.md), [`fixtures/`](fixtures/)).
- **Ф1 Read-примітиви (MCP):** `get-classic-schema`, `list-schema-layers`, `resolve-migration-unit`.
- **Ф2 Merge-рушій (pure):** + обгортка `get-effective-classic-schema`. Тест офлайн на фікстурах. ✅ **прототип готовий, golden 36/36** ([engine/](engine/)): SupportUnit + Contract(9 шарів) зливаються детерміновано, з provenance; те, що LLM рахував ~142k токенів, код робить миттєво. **F1** (порядок за HierarchyLevel + `warnings`) і **F2** (`seedLayers` + `unresolvedParents`) закриті.
- **Ф3 Mapper (pure):** ✅ **прототип готовий, golden 52/52** ([engine/mapper.mjs](engine/mapper.mjs)): **F3** — повне дерево вкладок/контейнерів (маршрут поля підйомом по предках; вкладка+grid емітяться раз і лише коли тримають поле); **F9** — payload лише зі schema-шарів (за походженням insert), base-template = layout-контекст. Лишаються reconcile-diff (A3/F4) → 🎯 демо-віха: показати ефективну Classic + чернетку Freedom **без запису**.
- **Ф4 Оркестрація (скіл):** ролі, рекурсія, A3.1/A3.2, full-merge, B9/B10, approval-gate, living-docs.
- **Ф5 Наскрізний пілот на стенді:** запис у клієнтський пакет + read-back + browser.
- **Ф6 Загартування + ширина.**
Критичний шлях: Ф0 → (Ф1 ∥ Ф2) → Ф3 → Ф4 → Ф5 → Ф6. MVP до демо = Ф0→Ф3 (без запису).

## 6. Сходинка кейсів
1. **`SupportUnitEmployeePage`** (SupportCalendar+SupportService, Customer, 2 шари) — сутність `SupportUnit`; 3 деталі; 2 правила (REQUIRED + FILTRATION); 1 метод (`setName`); Freedom немає → **A4**. Покриває B1–B5 + рекурсію + C1 на простому клієнтському прикладі. *Фікстури: [`fixtures/supportunitemployee/`](fixtures/supportunitemployee/).*
2. **`Contract`** — типізовані правила, глибока рекурсія, 9 шарів, A3-reconcile. Золотий складний еталон. *Фікстури: [`fixtures/contract/`](fixtures/contract/).*

## 7. Відкриті рішення / ризики
- ~~Порядок шарів брати з `SysPackageInDependency` (не з `HierarchyLevel`-проксі).~~ **ВИРІШЕНО (F1):** `SysPackageInDependency` не читається з ESQ; `HierarchyLevel` — це і є авторитетна топо-глибина стенду (виміряно: строго впорядковує шари). Порядок за HierarchyLevel + `warnings` на однаковий рівень.
- Freedom↔entity binding читати з тіла сторінки (не ESQ-колонка).
- Custom-компоненти й base-видалення від product-шару — завжди через людину.
- Provenance має нести layer+package+editable (для A3/B6); за потреби — індекс diff-операції для точних позицій.

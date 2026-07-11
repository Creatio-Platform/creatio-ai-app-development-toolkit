# Self-review — deep + architectural (3 perspectives)

Ран трьох незалежних рецензентів: (1) clio C#-тули, (2) Node engine+mapper, (3) архітектура. Нижче — знахідки, що **виправлено цим проходом**, і що **свідомо відкладено у фази** (з обґрунтуванням). Загальний вердикт рецензентів: центральна теза (детермінований рушій + судження агента) — вірна; прототип звучний; але найскладніші детерміновані шматки ще не добудовані, а golden-тести перевіряли лічбу, не точність.

## Виправлено цим проходом (+ верифіковано тестами)

| # | Знахідка | Сев. | Фікс | Перевірка |
|---|---|---|---|---|
| E1 | **Symbolic-enum правила тихо мискласифікувались** (legacy `rules{}` через Proxy → `RuleType["0"]=BINDPARAMETER`, `Property["0"]=Visible`): Contract губив 6+ FILTRATION-правил, REQUIRED→Visible | **BLOCKER** | Seed `BusinessRuleModule.enums` (RuleType/Property) у vm-пісочницю + guard `typeof===number`; symbolic→`needsDecision`, ніколи не «0» | Contract entityRules **1→9**; mapper golden 30/30 + symbolic-enum регрес-guard |
| E2 | **vm-пісочниця частково escapable** (`window`/`console` — host-об'єкти → `window.constructor.constructor("return process")` = RCE + витік env) | MAJOR (security) | `window`/`console` тепер `PROXY` — **але це ЧАСТКОВО**: `define` (host-функція) лишається досяжною через `define.constructor.constructor(...)` → повна ізоляція відкладена у **F8** (не блокер, поки вхід — офлайн-фікстури) | `window`/`console` `.constructor` → PROXY; `define`-вектор → F8 |
| E3 | Помилки парсингу: або тихо ковтались (втрата шару), або неспіймані (краш merge) | MAJOR | `runInNewContext` у try/catch; `error` на `ParsedLayer`; порожній факторі-fn обробляється | — |
| E4 | Умови/фільтри правил відкидались → декларативна трансляція «детермінована лише на словах» | MAJOR | Engine захоплює `conditions`/`baseAttributePatch`/`comparison`/`value`; mapper емітить `filter`+`conditions` у спеку правила | golden |
| M1 | **Дублікат імені Freedom-елемента** коли 2 classic-item на одну колонку (Contract `StartDate`) | MAJOR | Ім'я елемента = унікальне (dedupe `col`/`col_2`) + `needsDecision` | — |
| M2 | Невідмаплений контейнер тихо йшов у головну вкладку | MAJOR | Прапор `needsDecision:container` для будь-якого не-Profile/Header контейнера | — |
| A1 | clio: `ex.Message` віддавався **нередагованим** у `Error` на internal-catch (витік хоста/URI) | MAJOR (security) | Redaction `response.Error` у 3 тулах при `!Success` | 21 unit + 6 e2e |
| A2 | `resolve-migration-unit` порожній результат = success без діагностики | MAJOR | Явна нота «no section found ≠ nothing to migrate» | e2e |
| D1 | README перебільшував паритет («той самий ChangeSet») | minor (чесність) | Уточнено: структурно еквівалентний зрізу, не байт-у-байт (немає Name/повного тулбара) | — |

## F1–F3 закрито (цей прохід) + верифіковано тестами

| # | Знахідка | Що зроблено | Перевірка |
|---|---|---|---|
| F1 | **Порядок шарів** нічий (merge last-writer-wins, порядок вручну) | **Архітектурна знахідка:** `SysPackageInDependency` **не** ESQ-ObjectSchema на стенді (DAG-ребра не читаються), але `SysPackage.HierarchyLevel` — це **власна матеріалізована топо-глибина** пакета в DAG залежностей. Емпірично строго впорядковує шари схеми (Contract: 299<320<329<357<358<533<541<596<607 — **без дублів**). Тож правильний фікс — **не** топосорт нечитабельного DAG, а: (1) `list-schema-layers` сортує за HierarchyLevel (авторитет, не «проксі») + детермінований tiebreak за іменем пакета, (2) `warnings` на єдиний неоднозначний кейс (два шари з однаковим рівнем), (3) engine-guard: `warnings` коли `merge/move/remove` б'є по відсутньому item (кривий порядок АБО відсутній seed). Виправлено й **фіктивний порядок у власному golden-runner** (був ContractInOrder перед SalesContracts тощо). | clio 14/14 (ambiguity + реальний sort-тест); engine golden 29/29 |
| F2 | **Seed базового шаблону** відсутній → base-контейнери/вкладки з parent-template губились/фантомили | `mergeLayers(layers, {seedLayers})` — parent-template шари зливаються **першими**. Новий діагностик `unresolvedParents` дає **точний seed-список** (SupportUnit: `ProfileContainer,Tabs`; Contract: `Header,Tabs`). Додано офлайн-fixture `_base/BaseModulePageV2_skeleton.js` (реальні імена з діагностики). Після seed: `unresolvedParents→0`, база-вкладка `ESNTab` в ефективній сторінці, merge-warnings по базових елементах зникають, клієнтські вкладки лишаються. У проді seed-шари = **реальні тіла parent-template**, тягнуться через clio get-classic-schema по UId (Parent-chain з `baseTemplate`). | engine golden 29/29 (F2-assert + tombstone-consistency) |
| F3 | **Повне дерево контейнерів/вкладок** у mapper (було лише Profile/Header; решта → одна вкладка) | Engine віддає повне `items` (дерево layout). Mapper **піднімається по предках** кожного поля: Header/ProfileContainer→SideAreaProfileContainer; будь-який tab-предок→ця вкладка; інакше→fallback+`needsDecision`. Вкладку+її grid емітимо **раз і лише якщо вкладка тримає ≥1 поле** (тому SupportUnit, де всі 8 полів у профілі, лишається 8 інсертів — golden не ламається). Стара «catch-all GeneralInfoTabContainer» більше не збирає поля. | mapper golden 30/30 (F3-routing: Contract GeneralInfoTab-поля→GeneralInfoTabGrid, Header→profile, ≥2 контейнери) |

## Повний stand-прогін (Ф3-демо) + F9 (payload vs context)

Прогнали `SupportUnitEmployeePage` **повністю на реальному стенді** `workbuild103` по всіх стадіях: `resolve-migration-unit` → `list-schema-layers` (2 шари, обидва Customer/IT=1 → read-only, кейс **C2**) → `get-classic-schema` по UId → merge (з реальним parent-ланцюгом **BaseModulePageV2→BaseSectionPage→BasePageV2→BaseEntityPage**, 28 seed-шарів, 0 помилок парсингу) → map.

- Реальна сторінка значно багатша за curated-фікстуру: **6 табів, 4 деталі, 348 методів, 12 компонентів** (Timeline + charts). Повний seed → `unresolvedParents:0`, `warnings:0` (F2-механізм масштабується на реальний ланцюг). Усі 8 контролів типізовані з колонок сутності.
- **F9 (нова знахідка з повного прогону):** повний seed резолвить layout, але **забруднював payload** — 348 методів (базовий фреймворк BaseEntityPage/BasePageV2), 1 базова деталь (Samarasoft.Logging), 3 базові компоненти. Виправлено: кожен елемент тегається `fromTemplate` (provenance ⊆ seed-пакети); mapper бере в payload лише елементи, яких торкнувся **schema-шар** (SupportCalendar/SupportService), решта — layout-контекст. Результат: payload **1 метод (`setName`) / 3 деталі / 9 charts / 8 полів / 4 правила**; `baseContextExcluded` рапортує відкинуте (прозоро, не тихо). Верифіковано: жоден schema-torкнутий метод не позначений template (0 хибних виключень). Тонкі фікстури це не ловили — «повністю» зловило. Позитивно тестуємо виключення полів+правил+методів+деталей+компонентів; окремий guard F9×F3 (поле під базовою вкладкою НЕ синтезує новий `crt.Tab`, а йде в існуючу + `base-tab-placement`). Golden: mapper **30/30**.

## F3 fidelity build-out (layout+detail точність, за зауваженнями зі скрінів)

Після скрінів реальної Contract-сторінки закрито 4 прогалини Ф3 (golden: merge **36/36**, mapper **52/52**):
1. **Групи → ExpansionPanel.** Корінь: `itemType` губився для контейнерів через символьний `Terrasoft.controls.ViewItemType` (той самий клас, що E1). Фікс: засідив **ViewItemType** (лише підтверджені 0/2/15, без вгадування) → `itemType` резолвиться; mapper `resolveOwner` віддає ланцюг груп, `ensureGroup` будує **CONTROL_GROUP(15)→`crt.ExpansionPanel`** / **GRID_LAYOUT(0)→`crt.GridContainer`**, вкладено. На реальному Contract «Delivery» (`GeneralInfoTabGroupe00b109d`) тепер ExpansionPanel з полями всередині.
2. **Деталь → таб + порядок.** Engine приєднує кожну деталь до її diff-item (parent+order); mapper резолвить таб предками. 13/14 деталей Contract лягли у свої таби (1 flagged `detail-placement`).
3. **Editability деталі.** Прибрано хардкод тулбара `["add",…]`; `actions:"unresolved"` + `detail-editability` decision — view-vs-editable резолвиться з власного конфігу деталі (B2-рекурсія).
4. **Entity-filter повнота.** Динамічні/column-ref фільтри позначаються `complete:false` + `entity-filter` decision (не видаються за готові). На Contract лише `Owner` (статичний GUID) complete; 8 динамічних flagged.

## Page-level fidelity build-out (за скрінами реальної Contract-сторінки)

Скріни показали, що mapper покривав лише скелет (поля/таби/деталі), а реальна сторінка має більше. Закрито 5 page-moments (golden: merge **36/36**, mapper **52/52**):
1. **Тип розкладки — широкий хедер, не лівий острів.** Engine захоплює класичні layout-координати (`column/colSpan/row/rowSpan`, 24-col grid); mapper детектить «Header з >1 колонкою» → повноширинний header-grid (`HeaderContainer`), зберігаючи багатоколонковість (класична col 0-based → Freedom col+1), + `layout-type` decision. Вузький профіль (SupportUnit) лишається `SideAreaProfileContainer`.
2. **Штатні фічі = A3-заміна, не деталь.** Feature-catalog (Шар-3): `VisaDetailV2→Approvals`, `FileDetailV2→Attachments`, `ActivityDetailV2→Activities`, `EmailDetailV2→Emails` → окремий `standardFeatures[]` + `standard-feature` decision (exact crt-компонент — на стенді, не вигадуємо).
3. **Header/аналітичні віджети → Freedom-аналоги.** `ActionsDashboardModule→ActionDashboard`, `Dcm…→CaseStages`, `Timeline`, `Recommendations`, `Duplicates`, `ESNFeed→Feed` (за module-key і container-ім'ям) → `widgets[]` + `widget` decision; base-provided **позначені**, не дропнуті.
4. **Card actions / ACTIONS-меню (B7).** Відомі action-items (`Print/Process/View/Tag/ReloadData`) + `getActions` → `cardActions[]` + `card-action` decision (тіла — в getActions, imperative).
5. Усі — з `needsDecision`, де аналог/значення неоднозначні; жодних вигаданих `crt.*`-імен (урок E1).

На реальному Contract: HeaderContainer (Owner col 13 colSpan 12), 4 standard-features, 6 widgets, 5 card-actions, 10 справжніх кастомних деталей лишаються generic Expanded list.

## Generalization test on ProductPageV2 (unseen page) — 3 gaps found + fixed

Прогін конвеєра на `ProductPageV2` (9 шарів, не бачив раніше) пройшов без змін коду (0 parse-errors, `unresolvedParents:0`, `warnings:0`) — генералізація підтверджена. Звірка зі скріном хедера виявила 3 прогалини (golden: merge **36/36**, mapper **52/52**):
1. **MERGE-БАГ (коректність): `remove`+`move` не воскрешав елемент.** Класична ідіома «remove потім move = переставити» лишає елемент присутнім. Мій `move` не знімав `removed` → відображуване поле `IsArchive` («Inactive» чекбокс) тихо зникало. Фікс: `move` на tombstone-елементі знімає `removed` (воскрешає). Тепер IsArchive → `crt.Checkbox` присутній.
2. **Тултіпи не захоплювались.** Класика: `values.tip.content.bindTo = "Resources.Strings.XTip"`. Фікс: engine захоплює `tip`; mapper несе `values.tip.content` на Freedom-поле (Code→CodeTip, IsArchive→IsArchiveTip).
3. **Image/photo-компонент дропався.** `Photo` (generator `ImageCustomGeneratorV2…`, без bindTo) → mapper його викидав. Фікс: engine захоплює `generator`; mapper розпізнає image (generator ~image / ім'я Photo/Image/Logo) → `images[]` + `image` decision.

## Runtime-render vs static-schema: feature toggles + visibility (звірка Product зі скріном)

Звірка з живою Product-сторінкою: деякі блоки (`ProductCategoryBlockNew`, `PartnershipBlock`) є в мапінгу, але НЕ на сторінці; в інших блоках полів менше. Корінь — **сторінка це ОДИН runtime-стан** (feature-toggles + тип продукту + rules), а мапінг — **повна статична УНІЯ**. Виявлено `getIsFeatureEnabled('UseNewProductCatalogue'/'UseNewProductSelection')` — старий/новий блоки за фіче-флагом. Виправлено (golden: merge **39/39**, mapper **54/54**):
- **`visible` більше не хардкодиться `true`** — engine захоплює статичний `visible:false` / динамічний вираз; mapper віддає `visible:false` як є, а динамічний → `visible:true` + `visibility-rule` decision.
- **Feature toggles детектяться** (`eff.features` з тіл) → `feature-toggle` decision зі списком фіч; мапінг лишається повною унією блоків, а рішення «яку фіче-гілку мігрувати» — за людиною.
- **Чесний ліміт:** ЯКА фіча гейтить ЯКИЙ блок — у тілах методів (`getIsFeatureEnabled`+`setVisible`, imperative) → 20% судження (B5), статично не резолвиться. Тому mapper 1:1 не збігається з одним рендером — він дає унію + прапори.

Ще дві прогалини зі звірки Product (golden: merge **41/41**, mapper **56/56**):
- **Загублений ACTIONS-екшн.** Кастомна дія меню (`navigateToTaxesByCountriesLookup` / «Go to Taxes by countries lookup») будується імперативно в `getActions` → мій `cardActions` ловив лише статичні тулбар-кнопки. Тепер engine витягує `actionHints` (navigate*/goTo*) з тіл → `cardActions` + рішення їх включає (тіла — на ревʼю).
- **Каптіони не переносились** (тому деталі важко звірити за назвою). Engine захоплює `caption`-resource-key (таб/група/деталь); mapper використовує реальний ключ замість плейсхолдера і флагає `tab/group-caption` лише коли ключ синтезовано. *(Каптіони деталей — на схемі деталі, не на майстрі → чекають на B2-рекурсію.)*

## Відкладено у фази (архітектурне, дороге — не «швидкий фікс»)

| # | Знахідка | Чому відкладено | Фаза |
|---|---|---|---|
| F4 | **A3-reconcile** не реалізовано (лише build-шлях); Freedom-counterpart discovery нічия | Це окремий рушій (base↔Freedom + delta↔Freedom diff) | **Ф3/Ф4** |
| F5 | **Runtime-дім pure-модуля** + wiring у скіл (зараз запускається вручну `node`) | Потрібен versioned Node-CLI над JSON-контрактом (normalized model) | **Ф4** |
| F6 | Модель обіцяє більше, ніж є продюсерів: `states`, captions/локалізація, кнопки (B7), hidden-not-removed (B6), тіла методів (B5) | Дозбирати продюсери поетапно; поки позначити «Ф-later» | Ф2/Ф3 |
| F7 | clio: немає юніт-тестів на shaping (Fakes перекривають `TryXxx`); ESQ-DSL дубльовано; provenance — лише рядок-пакет | Потрібні тести з підставним `IApplicationClient` + консолідація на `SelectQueryHelper` | Ф1 доробка |
| F8 | **`node:vm` — НЕ security-межа** (`parseLayer`): конкретний вектор — `define` (host-функція в sandbox) досяжна з будь-якого тіла: `define.constructor.constructor("return process")()` → host-realm → RCE. window/console→PROXY та timeout НЕ закривають це. Для golden-фікстур ризик низький, але F2 `seedLayers` у проді тягне **реальні parent-template тіла зі стенду** (недовірений вхід). | Перед wiring продового fetch: неісполнюваний парсер (AST-екстракт `define(...)` літералу) або `isolated-vm`/короткоживучий child-process без host-функцій у scope; трактувати вхід `parseLayer` як untrusted; поки — гарантувати, що `seedLayers` лише з офлайн-джерела | **Ф5** (перед runtime-wiring) |

## Вердикт
Прототип рушія/mapper — **звучний, без тихої корупції правил** (E1) і тепер **із коректним порядком шарів (F1), seed бази (F2) і повним деревом вкладок/контейнерів (F3)**. Ключова архітектурна знахідка F1: платформа не композить схему на GetSchema (`useFullHierarchy` — no-op), а DAG-ребра не читаються з ESQ — тому авторитетний сигнал порядку це `HierarchyLevel`, і merge-рушій лишається необхідним. Golden підсилено: merge **36/36**, mapper **52/52**, clio **16/16**. Далі — F4 (A3-reconcile) і F5 (runtime-дім) перед скілом; тести варто ще розширити на A3 та справжній parent-template seed зі стенду.

## Рев'ю-раунд 2 (по коміту 2702d49) + F9 origin-refactor
Два незалежні рев'ю (creatio-code-review воркфлоу + вбудований /code-review) **зійшлися на Blocker**: `fromTemplate` (усі-провенанс за іменем пакета) — хибний сигнал для **структурної ідентичності вкладки**; базову вкладку майже завжди merge-ить схема-шар → `fromTemplate=false` → `ensureTab` синтезував **дублікат `crt.Tab`**. Виправлено фундаментально: **штампуємо походження на replay** (`templateOwned` = визначальний insert зі seed-шару; за списком, не іменем). Ідентичність вкладки й payload полів — по `templateOwned`; keyed-категорії (методи/правила/деталі/компоненти) — по `schemaTouched`. Це разом закрило: Blocker (дублікат вкладки), C6 (переміщене base-поле не тягнеться в payload), overlap-misattribution (name-collision зникла — warning прибрано). Плюс: C2 (merge ніс `contentType`), C3 (template-internal remove не тече в removal-рішення), C4 (`rule-target-missing` для правила на не-payload полі), C5 (`group-nesting` замість тихого flatten), vm-коментар чесний (F8 лишається), чистка мертвого коду (`CONTAINER`/`toContainer`/`external`/`detailItems`), спільний test-helper (`_testkit.mjs`), +2 clio test-пінги. Нові регрес-голдени під кожен фікс (B1 — саме поширений merge-кейс, який минулий фікс пропускав).

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

## Межа `non-BaseModulePageV2` + «зробити гучно» (звірка Case зі скрінами)

Прогін на `CasePageV2` (5 шарів, база **`BaseModulePageWithRightDetailContainer`**, не `BaseModulePageV2`) + звірка з живими скрінами виявили **межу застосовності** — не баг, а клас сторінок, який mapper покриває інакше. Складається з **трьох граней**:

1. **Нестандартний базовий шаблон** → нестандартні контейнери/layout (3 лівих острови `LeftContainer`, правий detail-контейнер, `OpenCasesTabs`-side-panel). Mapper зводить до одного `Tabs`.
2. **`LABEL`/`CONTAINER` мікро-віджети без прив'язки до колонки** (SLA-таймер: `SolutionCaptionContainer`→`SolutionMinutesCaption` на `getSolutionDateMinute`, `renderCaptionStyle` = «червоний нотіфікейшн»). `itemType` LABEL/CONTAINER не в підтвердженому `VIEW_ITEM_TYPE` → резолвиться `null` → mapper їх **тихо викидав**.
3. **UI з референсних AMD-модулів** (`define([...,"CasesEstimateLabel"], ["css!CasesEstimateLabel"])` → SLA-таймер + його **START/END-кнопки**). Юніт міграції — шари **самої сторінки**; за `define()`-залежностями в чужі view-модулі engine не заходив і навіть їх не бачив.

Межа прийнятна (авто-мігрувати bespoke SLA-таймер у Freedom сенсу нема). **Тихий drop — ні** (порушує «no silent caps»). Три фікси роблять пропуски **гучними** + латають реальну дірку захвату (golden: merge **46/46**, mapper **65/65**):

- **Захват `hint` (реальний баг, не межа).** `normalizeDiff` ловив лише `"tip"`; Classic поле-хелп майже завжди `"hint"` (інша властивість) → усі hint-тултіпи губились. Тепер `hint` захоплюється й проводиться на поле: `Resources.Strings.*` → Freedom-тултіп; hint на метод (динамічний) → `field-hint` decision. *(Тултіп «Service agreements» зі скріна — окремий випадок: його тексту немає в жодному шарі → джерело **опис колонки в EntitySchema**, поза юнітом; ловиться гранню-3-подібно, не hint-ом.)*
- **`unmapped-component` (грань 2 — гучно).** Будь-який живий client-айтем (не-template), під який mapper нічого не згенерував, тепер = рішення, а не зникнення. Структурні організатори (tab/CONTROL_GROUP/detail/grid — за `itemType` **і** конвенцією імен) виключено; флагається лише **корінь** кожного викинутого піддерева (SLA-таймер = 1 рішення «портуй блок», не 6 листків). Ловить і кастомні кнопки (`ResolvedButton`/`AssignToMeButton` → гайданс «wire as Freedom card action»). Case: **14 коренів**, Contract: **7** — усе, що раніше зникало тихо.
- **`referenced-module` (грань 3 — гучно).** `parseLayer` тепер захоплює `define([...])`-залежності; css-backed / UI-названі кастомні модулі (`CasesEstimateLabel`) → `referenced-module` decision + поле `referencedModules` у ChangeSet. Framework-утиліти (FormatUtils, BusinessRuleModule) відсіяно (високий сигнал, E1).

**Чесний висновок:** зі скріна (`3 острови / червоний нотіфікейшн / hint-тултіпи / лейблові розрахунки строків / START-END кнопки`) mapper початково ловив ≈нічого з цього — тепер усе **або мапиться, або гучно виноситься в `needsDecision`**. Багатопанельний layout (грань 1) і резолв caption-resource-ключів у текст лишаються відкладеними (косметика/окремий клас), *явно позначені*, не приховані.

## Ф4 — wiring скіла до движка + рев'ю-раунд 3 (`/creatio-code-review`)

**Контекст Ф4.** Виявлено, що движок (гілка `claude/…`) і **скіл** (`skills/classic-to-freedom-migration/`, remote `feature/…-skill`) розійшлися на двох гілках; скіл робив merge шарів **вручну (LLM)** — саме те, що движок замінює. Звели гілки, **перенесли движок у `skills/…/engine/`** (доставка: release-manifest ships лише `skills/`, не `.migration/`), додали CLI-вхід **`migrate.mjs`** (manifest → ефективна сторінка + ChangeSet + `needsDecision`), і **перевели Step 4 скіла** на детермінований шлях (`list-schema-layers` → `get-classic-schema` ×N → `migrate.mjs`) з ручним merge як **fallback**. `migrate.mjs` наскрізь на реальних Case/Contract/Product: 0 parse-errors.

**Рев'ю-раунд 3** (workflow `/creatio-code-review`, 5 лінз, high-effort, локальний self-review) — вердикт **request changes**, 8 findings. Виправлено **7**, один (#3) свідомо відкладено:

| # | Sev | Знахідка | Фікс |
|---|---|---|---|
| 1 | Major | `STRUCT_RX` за суфіксом імені міг **тихо глушити** контент з `itemType:null` (той самий silent-drop, який фікс мав прибрати) | Розбито на `HARD_SCAFFOLD` (грід/root-Tabs — завжди skip) vs `SOFT_STRUCT` (…Group/Tab — skip лише якщо **parent з дітьми**); childless struct-named контент сюрфаситься. Contract: `SaaSMetricsTab` був тихий → тепер видимий |
| 2 | Major | Engine-goldens — єдиний regression-gate, але **CI їх не ганяв** (`pr.yml` = pytest + version-check) | Додано CI-джобу `engine-goldens` (`npm test` → зламаний golden валить PR) |
| 3 | Major | Скіл направляє тіла зі стенду → `node:vm` (не sandbox) = local code-exec | **ВІДКЛАДЕНО = F8** (vm-ізоляція/AST-парсер). Попередження не додавали (рішення власника) |
| 4 | Major | CLI-обгортка `migrate.mjs` без тестів; кривий вхід → сирий stack | try/catch → чіткий stderr + exit 1 (missing file / bad JSON / empty layers); + goldens (entity-`?` fallback, spawn malformed) |
| 5 | Minor | `"Tag"`-regex сканував **весь** файл → шум | Заскоуплено на тіло `getActions` (`extractFnBody`, brace-match); + негативний golden. Case-екшини збережено |
| 6 | Minor | `UI_MODULE_RX` — незаякорена підстрока (`LabelHelper` хибно) | Заякорено на суфікс `…$`; + негативний golden. css-backed не зачеплено |
| 7 | Minor | Динамічний `hint` губився, якщо є `tip` | Decoupled: динамічний hint **завжди** → `field-hint`, навіть з tip; + golden |
| 8 | Minor | `scratch_*` (Classic-тіла зі стенду) не в `.gitignore` | Додано `scratch_*` |

Кожен фікс закрито **таргетованим golden'ом**. **Golden: merge 46→49, mapper 67→72.** Регресія на реальних Case/Contract/Product чиста (0 parse-errors; Case getActions-теги збережено). Позитив рев'ю: AC1–AC5 покрито+верифіковано; «solid prototype». Комміти: `b7e87ce` (код), `c0d3403` (CI+gitignore).

## Ф4 — перший реальний прогін скіла (Applicant) + review

Скіл прогнано наскрізь на реальній секції **Applicants** (`Applicant1Section`/`Applicant1Page`, база `HRApplicant`→`HRRequest`→`WorkHrBase`, Terrasoft-locked). **Флоу спрацював:** агент знайшов fork-тули (hidden, через `clio-run`), зробив `resolve-migration-unit`→`list-schema-layers`→`get-classic-schema`, **використав детермінований `migrate.mjs`** (не ручний merge), дотримав approval-gate, збудував Freedom-сторінку `UsrApplicantsFreedom_FormPage`. Перевірка плану + **збудованої сторінки** (get-page + скріни) дала **16 знахідок** (1 моя — #17 «hollow shell» — знято: правила/модель присутні, просто в окремому механізмі — **урок: не читати get-page ownBodySummary-лічильники як «нічого нема»**).

**Keystone — #1 (F2-seed):** агент **пропустив** seed parent-template → `unresolvedParents:[LeftModulesContainer,Tabs]`, ESNTab-warning, `container:12`; каскадом: профільні поля впали у fallback-таб (5 полів/1 острів замість 2 островів), `ProcessButton` (Run process) зник. Движок це **гучно підсвітив**, але агент сказав «ran cleanly» й проігнорував.

**Пріоритезований беклог (16):** 🔑#1 seed-каскад · **A** стандартні фічі/шаблони (#3 generic-first, #6 Activities≠Timeline, #7 Feed/Attachments template-provided, #16 Approvals=generic-grid) · **B** секція (#2 grid-колонки, #8 process-launch/section-actions) · **C** деталізація (#10 page-design-spec, #9b multi-island) · **D** built-page (#11 деталі дропаються вибірково: Email/Communication/Files + `Schema1Detail` unresolved-name, #12 профіль=каскад#1, #13 caption, #14 grid не 24-col, #15 назви деталей≠Classic) · дрібні (#4 lookup-тул, #5 caption-резолв).

**Виконано зараз (Фаза 1+2):**
- **#1** SKILL step 4: seed parent-template chain **обов'язковий** + **HARD GATE** (non-empty `warnings`/`unresolvedParents` ⇒ СТОП, дозасідь, не йди далі).
- **#6** `ActivityDetailV2→Activities (Tasks) related list`, «Timeline» прибрано; Timeline лишається окремим (`WIDGET_BY_MODULE`).
- **#6/#11** `matchFeature()` — суфікс-матч (`ApplicantEmailDetailV2`→`EmailDetailV2`), щоб prefix-варіанти не падали як generic (і не губились).
- **#7** `FileDetailV2` (+Feed) позначено `templateProvided` → «do NOT create, merge onto existing».
- **#14** структурні `GridContainer` емітяться з явним **24-col** `columns` (класичні `column/colSpan` рендеряться 1:1).
- **#15** resource-key caption деталі → `detail-caption` decision («resolve, don't invent»).
Кожен + golden. **Golden: merge 49/49, mapper 77/77.** Офлайн-регресія (Contract/Product/Case): 0 parse-err, усі GridContainer 24-col, Activities-лейбл без Timeline.

**Відкладено на верифікацію/наступні фази:** #11(i) точний резолв `Schema1Detail` + повний #15 (потребують реального detail-блоку Applicant — fork-тули, re-fetch); Фаза 3 (#3/#16/#8c/#10/#4 + `freedom-templates.md`); Фаза 4 (#2/#8b/#11-B2/#9b/#5/F8). **Наскрізна верифікація:** перепрогнати скіл на Applicant **із seed** (fork активний) — очікуємо: 2 острови з повними полями, ProcessButton, деталі нативні/недропнуті, grid не ламається.

## Ф4 — другий реальний прогін (Applicant, після Фази 1+2) + верифікація

Перепрогін на тій самій секції після оновлення плагіна до Фази 1+2. **Що фікс #1 дав (підтверджено ChangeSet-ом `batt78afe`):** агент **тепер сідить базу** й **HARD GATE пройдено** — `parseErrors:[]`, `warnings:0`, `unresolvedParents:[]` (було `[LeftModulesContainer,Tabs]`+ESN). Ще: **Emails розпізнано** (`Emails<-ApplicantEmailDetailV2`, suffix #6/#11 — не дропнуто), Attachments/Feed з шаблону (#7), **grids 24-col 3/3** (#14), дійшов до імплементації + **11 page-rules**.

**Але верифікація ізолювала справжні корені** (ChangeSet показав більше, ніж no-seed-прогін маскував):
- **#18 [Major, mapper]** — `PROFILE_CONTAINERS` не містив `LeftModulesContainer` → ланцюг `ContactContainer→LeftModulesContainer→root` не досягав profile-якоря → 12 профільних полів усе одно в `GeneralInfoTabContainer` (fallback), `container:12`. **Це і був справжній корінь «профіль не той»**, а не seed (seed уже ОК). Container-reason був ще й брехливий («ContactContainer is not defined», хоча він визначений).
- **#19 [Med, skill]** — seed = **ручний скелет** `_seed_BaseModulePageV2.js` (мав `PrintButton`, не мав `ProcessButton`) → gate пройдено «пусто», але `Run process` зник (`cardActions:PrintButton`).
- **#11 [detail]** — та сама деталь виходить **двічі** (`Schema1Detail`/`ApplicantFile`: `tab:null` + `tab:Tab67ea…`) — дедуп-баг; авто-ім'я `SchemaNDetail` сховало, що entity `*File` = **Attachments**.
- **#10 [skill]** — план без per-field «що і де» (юзер: «дуже поганий план»).

**Виконано зараз (Фаза 3, ця сесія):**
- **#18** `PROFILE_CONTAINERS += LeftModulesContainer`; `resolveOwner` тепер повертає `why` (`undefined-parent` vs `no-anchor`) → container-decision має **точну** причину; острівні wrapper'и `accountedFor` (не хибний unmapped); сплющення >1 острова → **одне** `profile-island`-рішення (чесний сигнал про #9b).
- **#19** SKILL step 4.1: seed **МУСИТЬ** бути реальним тілом `get-classic-schema`, **не** ручним скелетом; HARD GATE отримав ⚠ про «FALSE all-clear від скелета».
- **#11** mapper: **дедуп деталей** за (schema+entity+FK), лишаємо резолвлену вкладку; entity `*File` → **Attachments (templateProvided, inferred)**; авто-ім'я `SchemaNDetail` → гучне `detail-unresolved` («fetch schema first»). SKILL step 7: доданий **обов'язковий build-крок** «details/related lists/standard features — нічого не пропускати мовчки, інакше loud TODO/BLOCKED».
- **#10** SKILL step 5+6 + `page-design-spec.md`: per-page design-spec **обов'язковий** пункт плану, **populate з ChangeSet** (`viewConfigDiff`→field-рядок з контейнером+colSpan; `details`/`standardFeatures`/`cardActions`→рядки); план без нього неповний → не показувати на approval.
- Кожен + golden. **Golden: merge 49/49, mapper 86/86** (77→86, +9). Регресій нема.

**Лишається:** ProcessButton остаточно закриється, коли #19 змусить брати реальний base (fork re-fetch, наскрізний прогін); #9b (2 острови окремо), #16 (Approvals нативний), #8 (process-launch/section-actions), #2 (section grid), #5/#13 (caption-резолв), F8.

## Ф4 — третій прогін + перехід з прози на ДЕТЕРМІНОВАНИЙ вивід

Третій прогін (на `e9a45e8`, #10b активний): агент **додав** секцію «Design spec», але написав її **прозою** («Contact · Mobile phone (ro)…», «12/24 each») — без таблиці по кожному полю. Урок остаточний: **скільки не пиши інструкцій — агент переказує spec, а не емітить структуру.** Прозова інструкція тут принципово не тримає.

**Виконано (перехід на валідації/генерацію — merge 49/49, mapper 94/94):**
- **#10c design-spec ГЕНЕРУЄТЬСЯ рушієм.** Новий `engine/designspec.mjs` (`renderDesignSpec`) рендерить spec з ChangeSet: region map + **таблиця по кожному полю** (Classic col · компонент · PDS-атрибут · контейнер · col·colSpan · rule) + details/standard-features + card actions + rules + ⚠ decisions. `migrate.mjs` віддає `designSpec` у JSON і має режим `--spec` (чистий Markdown). SKILL (рядок 12, кроки 4.2/5/6, output-rules) + `page-design-spec.md`: **не писати руками — запустити `migrate.mjs --spec` і показати дослівно.** Агент не може переказати таблицю, яку не писав.
- **#19 seed-quality — МАШИННА валідація.** `mergeLayers` рахує `seedQuality.looksSkeletal` (seed є, але 0 методів / нема `getActions` = ручний скелет) і кидає `skeletal-seed` **warning** → існуючий HARD GATE (warnings порожні) блокує білд, доки не підтягнуть реальне тіло base через `get-classic-schema`. Це enforcement, не проза.

**Принцип на майбутнє:** де агент стабільно «недотягує» за інструкцією — переносити з прози в детермінований вивід рушія (генерувати артефакт) або в машинну перевірку (warning у gate), а не додавати ще тексту. Див. [[skill-dominant-vs-buried-instruction]].

## Ф4 — четвертий прогін: #9b (два острови) реалізовано

Прогін на `cc8c4bf` (генератор spec активний) підтвердив: spec тепер таблицею, поля другого острова (InternalRequest/Department/StaffUnit/Job) **захоплені**, `profile-island` decision є — АЛЕ region map показував їх **одним «Side profile»** (2 острови сплющені). Юзер (зі скріном classic — 2 окремі картки ліворуч) справедливо: «здається, другий острів не побачив». Це #9b, який був відкладений — потреба показана.

**Виконано (#9b — merge 49/49, mapper 96/96):**
- mapper: якщо в лівій зоні >1 **distinct island** (outermost group під profile-якорем), кожен острів будується як **окремий `crt.GridContainer`** під `SideAreaProfileContainer`, і поля роутяться у свій острів (не в один стек). Один острів лишається плоским (без зайвого wrapper, без nag). `profile-island` decision тепер описує спліт + просить підтвердити представлення лівої зони.
- designspec: region map показує `Side profile › ‹island›` — острови читаються окремо (Contact-острів vs Request-острів).
- goldens: 2-острови → поля у свої контейнери + контейнери під SideArea; 1 острів → плоско. (+2)

**Межа (чесно):** чи `SideAreaProfileContainer` приймає вкладені `GridContainer` як 2 картки — не звірено на стенді; тому це flagged decision, не мовчазне припущення. Якщо шаблон вимагає одну картку — merge (рішення в decision).

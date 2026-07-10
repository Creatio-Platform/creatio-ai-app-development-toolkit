# Self-review — deep + architectural (3 perspectives)

Ран трьох незалежних рецензентів: (1) clio C#-тули, (2) Node engine+mapper, (3) архітектура. Нижче — знахідки, що **виправлено цим проходом**, і що **свідомо відкладено у фази** (з обґрунтуванням). Загальний вердикт рецензентів: центральна теза (детермінований рушій + судження агента) — вірна; прототип звучний; але найскладніші детерміновані шматки ще не добудовані, а golden-тести перевіряли лічбу, не точність.

## Виправлено цим проходом (+ верифіковано тестами)

| # | Знахідка | Сев. | Фікс | Перевірка |
|---|---|---|---|---|
| E1 | **Symbolic-enum правила тихо мискласифікувались** (legacy `rules{}` через Proxy → `RuleType["0"]=BINDPARAMETER`, `Property["0"]=Visible`): Contract губив 6+ FILTRATION-правил, REQUIRED→Visible | **BLOCKER** | Seed `BusinessRuleModule.enums` (RuleType/Property) у vm-пісочницю + guard `typeof===number`; symbolic→`needsDecision`, ніколи не «0» | Contract entityRules **1→9**; mapper golden 14/14 + 2 регрес-guard |
| E2 | **vm-пісочниця escapable** (`window`/`console` — host-об'єкти → `window.constructor.constructor("return process")` = RCE + витік env) | MAJOR (security) | `window`/`console` тепер `PROXY` (host-realm недосяжний) | ланцюг `.constructor` → PROXY |
| E3 | Помилки парсингу: або тихо ковтались (втрата шару), або неспіймані (краш merge) | MAJOR | `runInNewContext` у try/catch; `error` на `ParsedLayer`; порожній факторі-fn обробляється | — |
| E4 | Умови/фільтри правил відкидались → декларативна трансляція «детермінована лише на словах» | MAJOR | Engine захоплює `conditions`/`baseAttributePatch`/`comparison`/`value`; mapper емітить `filter`+`conditions` у спеку правила | golden |
| M1 | **Дублікат імені Freedom-елемента** коли 2 classic-item на одну колонку (Contract `StartDate`) | MAJOR | Ім'я елемента = унікальне (dedupe `col`/`col_2`) + `needsDecision` | — |
| M2 | Невідмаплений контейнер тихо йшов у головну вкладку | MAJOR | Прапор `needsDecision:container` для будь-якого не-Profile/Header контейнера | — |
| A1 | clio: `ex.Message` віддавався **нередагованим** у `Error` на internal-catch (витік хоста/URI) | MAJOR (security) | Redaction `response.Error` у 3 тулах при `!Success` | 21 unit + 6 e2e |
| A2 | `resolve-migration-unit` порожній результат = success без діагностики | MAJOR | Явна нота «no section found ≠ nothing to migrate» | e2e |
| D1 | README перебільшував паритет («той самий ChangeSet») | minor (чесність) | Уточнено: структурно еквівалентний зрізу, не байт-у-байт (немає Name/повного тулбара) | — |

## Відкладено у фази (архітектурне, дороге — не «швидкий фікс»)

| # | Знахідка | Чому відкладено | Фаза |
|---|---|---|---|
| F1 | **Порядок шарів** нічий: merge = last-writer-wins, але топосорт із `SysPackageInDependency` не реалізовано (зараз порядок передається вручну) | Потрібен новий read-примітив (DAG залежностей) + Kahn-топосорт | **Ф1** (+тул) / Ф2 |
| F2 | **Seed базового шаблону** відсутній → base-поля/вкладки з parent-template (напр. `Name`, `ESNTab`) губляться або стають phantom | Потрібно вантажити parent-chain (BaseModulePageV2…) і сидити дерево | **Ф1/Ф2** |
| F3 | **Повне дерево контейнерів/вкладок** у mapper (зараз лише Profile/Header; решта → одна вкладка) | Потрібно нести `layout`+`layoutName`+tab-lineage і будувати TabPanel/Group/Grid | **Ф3** build-out |
| F4 | **A3-reconcile** не реалізовано (лише build-шлях); Freedom-counterpart discovery нічия | Це окремий рушій (base↔Freedom + delta↔Freedom diff) | **Ф3/Ф4** |
| F5 | **Runtime-дім pure-модуля** + wiring у скіл (зараз запускається вручну `node`) | Потрібен versioned Node-CLI над JSON-контрактом (normalized model) | **Ф4** |
| F6 | Модель обіцяє більше, ніж є продюсерів: `states`, captions/локалізація, кнопки (B7), hidden-not-removed (B6), тіла методів (B5) | Дозбирати продюсери поетапно; поки позначити «Ф-later» | Ф2/Ф3 |
| F7 | clio: немає юніт-тестів на shaping (Fakes перекривають `TryXxx`); ESQ-DSL дубльовано; provenance — лише рядок-пакет | Потрібні тести з підставним `IApplicationClient` + консолідація на `SelectQueryHelper` | Ф1 доробка |

## Вердикт
Прототип рушія/mapper — **звучний і тепер без тихої корупції правил** (E1 закрито, guard'нуто). clio-тули — ідіоматичні, з тестами (21+6), security-дірку прикрито (A1). Але **для повної точності на реальних стендах** ще потрібні F1 (порядок), F2 (seed бази) і F3 (дерево контейнерів) — без них merged-сторінка на багатошарових/табованих сторінках неповна. Це наступні пріоритети (Ф1/Ф3). Golden-тести підсилено (симв.-enum регрес-guard), але їх треба ще розширити на multi-tab та A3 перед масштабуванням.

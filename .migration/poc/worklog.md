# PoC Worklog — Classic → Freedom, наскрізний зріз

Стенд: `workbuild103_15688915_0726` · Пілот: `SupportUnitEmployeePage` (entity `SupportUnit`, пакет SupportCalendar, InstallType=1 → read-only)

## Побудовано на стенді
- **App `UsrSupportUnitPoC`** (create-app, useExistingEntitySchema=SupportUnit) → editable-пакет + секція + `UsrSupportUnitPoC_FormPage` (PageWithTabsFreedomTemplate).
- **Форма SupportUnit** (`UsrSupportUnitPoC_FormPage`): 5 полів (ParentSupportUnit, Contact, Calendar, SupportWorkingDayType, Active) + деталь `SupportSchedule` (Expanded list, scope через `modelConfig.dependencies` SupportUnit→PDS.Id) + кнопка **Add** → відкриває Freedom-сторінку деталі.
- **Entity-rule** `apply-static-filter` (SupportUnit.SupportWorkingDayType → IsAvailable=true) — `BusinessRule_22959cf`.
- **Рекурсія деталі:** App `UsrSchedulePoC` + **`UsrSchedulePoC_FormPage`** (SupportSchedule: Notes, Date, SupportWorkingDayType, IsAvailable) — міграція власної сторінки деталі `SupportSchedulePage` (BasePageV2) у Freedom. Add-кнопка гріда підв'язана через `crt.CreateRecordRequest{entityName:SupportSchedule, entityPageName:UsrSchedulePoC_FormPage, defaultValues:[SupportUnit=$Id]}`.

## Доведено (конвеєр)
read (GetSchema по UId) → merge (2 шари) → map → **write** (create-app scaffold + update-page diff/replace + create-entity-business-rules) → structural read-back. Поле = 3-частинне зв'язування; деталь = декларативний scope; рекурсія деталь→власна сторінка = робоча.

## Уроки (для архітектури/executor)
1. **create-app сторінки — статична форма body** (`SCHEMA_VIEW_MODEL_CONFIG` без `_DIFF`) → `append` падає; треба `replace` з повним тілом.
2. **Editable = InstallType=0, не Maintainer.** SupportCalendar=Customer, але InstallType=1 → створення схем заблоковано; пишемо в окремий editable-пакет.
3. **Page-rules = лише стан** (hide/show/editable/readonly/required). **FILTRATION lookup → entity-level `apply-static-filter`** (page-level відхиляє).
4. **Рекурсія деталі реальна:** деталь = грід + власні сторінки (edit/mini). SupportSchedule має `SupportSchedulePage` → мігровано у Freedom.
5. **Стійкість до збоїв сесії:** після DNS-блимання **forms-auth сесія clio протухла** → `create-page` (endpoint `schema.template.api`) і, ймовірно, `create-related-page-addon` блоковані, тоді як cliegate-виклики (create-app, get-schema-name-prefix) і core-save `update-page` працюють. **Обхід без forms-auth:** scaffold через `create-app`, поля через `update-page`, навігація деталі через **`entityPageName`** на кнопці add (замість related-page-addon). Executor має мати ці fallback-шляхи.
6. **Структурна відповідність — обов'язкова навіть для зрізу.**
   - **Корінна причина дефекту:** будував поверх `create-app` scaffold (порожній `GeneralInfoTabContainer` + `SideAreaProfileContainer` лише з Name) і поклав поля в перший порожній контейнер вкладки за зручністю, замість перенесення ролі контейнера з Classic. Mapper не мав кроку «container-role mapping» і дефолтнув на головну вкладку.
   - **Правило (обов'язкове в mapper):** цільовий контейнер визначається **роллю контейнера-джерела в Classic**, а не «першим порожнім». Таблиця:
     | Classic контейнер | Freedom-ціль |
     |---|---|
     | `ProfileContainer` / ліва панель полів | `SideAreaProfileContainer` (профіль) |
     | вкладка (`Tabs`/`*Tab`) | `TabPanel`/`TabContainer` (та сама вкладка) |
     | `CONTROL_GROUP` | `ExpansionPanel` / `GridContainer` (група) |
     | `GRID_LAYOUT` | `GridContainer` |
     | деталь у вкладці | «Expanded list» у відповідній вкладці |
   - **Ніколи** не дефолтити placement на «перший доступний контейнер». Зріз зменшує КІЛЬКІСТЬ елементів, але НЕ змінює РОЗКЛАДКУ. Виправлено на стенді (поля → `SideAreaProfileContainer`, деталь → вкладка «Schedule»).
7. **Аналіз ≠ обсяг зрізу.** Merge читає повне тіло → аналіз бачив усе (8 полів / 5 вкладок / 3 деталі / 9 KPI-віджетів / 4 правила / метод). Кнопки деталі («Generate/Edit schedule») живуть у схемі деталі (`SupportScheduleEmployeeDetail`), не в тілі сторінки → рекурсія має заходити і в схему кожної деталі (кнопки/методи/процеси), а не лише в її сторінку.
8. **Деталь — за ПОВНИМ контрактом композита «Expanded list»**, не hand-rolled підмножина. Спершу зробив лише кнопку Add — неправильно. Повний контракт (`get-component-info composite="Expanded list"`): `ExpansionPanel`(items+tools) → body `GridContainer`→`DataGrid`(items/activeRow/columns/features.rows.selection) + tools `GridContainer`→`FlexContainer(row)` → **add / refresh / settings-menu(export+import) / search**, плюс обв'язка: `dataSource(scope:viewElement)`, колекц. атрибут із `filterAttributes` для пошуку, `dependencies` для scope. Пропускати дію тулбара — лише за явним опт-аутом. Executor будує деталь із рецепта композита, а не збирає вручну.

## Page 2 — `EmployeeScore1Page` → Freedom (незалежна валідація)
App `UsrEmpScorePoC` + `UsrEmpScorePoC_FormPage` (entity `EmployeeScore`). Мета — перевірити підхід на іншому домені + закрити непокриті осі.
- **Профіль (SideAreaProfileContainer):** ScoreNumber(`crt.NumberInput`), Employee(ComboBox), ScoreDate(`crt.DateTimePicker` datetime), AccrualRule(ComboBox), Owner(ComboBox), ScoreType(ComboBox), MarketplaceApplication(ComboBox), ScoreBalance(NumberInput). Comment(`crt.Input` multiline) — у головній вкладці. Name прибрано (у класичному профілі його немає). Деталей немає.
- **Page-level business rules (нове!):** `AccrualRule` **make-required коли `ScoreType == a27461ca-…`** + зворотне **make-optional** інакше — `BusinessRule_da07ea6` / `BusinessRule_b264112`. Умова з класичного правила (BINDPARAMETER/REQUIRED/condition) перенесена 1:1.
- **Закрило осі:** нові типи контролів (NumberInput / DateTimePicker datetime / multiline); **page-level умовний state-rule** (на 1-й сторінці page-rule відхилявся — тут підтверджено робочим); правило «one-way → додати зворотне» застосовано на ділі.
- Пайплайн і всі 8 уроків повторно підтверджені на незалежному entity (create-app fallback, структурне розміщення, replace-form).

## Відкритий пункт
- **Runtime-рендер не підтверджено в браузері** — контрольована вкладка не автентифікована, а введення пароля агентом заборонено. Структурний read-back усе підтвердив (контейнери з `items:[]`/`tools:[]`, add-кнопка). Візуальну перевірку виконує людина в залогіненій сесії.

## Артефакти-сміття на стенді (прибрати після демо)
Apps `UsrSupportUnitPoC`, `UsrSchedulePoC`, `UsrEmpScorePoC` (+ їхні секції/listpages/details) — тимчасові PoC-застосунки.

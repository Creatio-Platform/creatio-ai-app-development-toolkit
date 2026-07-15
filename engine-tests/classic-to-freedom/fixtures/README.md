# Fixtures — golden Classic schema bodies

Детерміновані golden-входи для offline-тестів merge-рушія та mapper'а (без стенду). Кожен файл — власне
тіло одного шару (`define(...)`), не merged.

Провенанс (важливо):

- `supportunitemployee/` — **синтетичні**, написані вручну. Компактні тіла `SupportUnitEmployeePage`
  (сутність `SupportUnit`): base `SupportCalendar_base.js` (8 профільних полів, 3 таби, 3 деталі, 4
  правила, метод, дві base-tab merge-и) + override `SupportService.js` (один аналітичний віджет-модуль).
  Раніше тут лежали verbatim стенд-експорти з дампами модулів/`recordId`; їх замінено синтетикою.
- `contract/` — переважно **реальна СТРУКТУРА сторінки** `ContractPageV2` (сутність `Contract`), 9 шарів
  у справжньому порядку залежностей (F1). Це метадані стандартного об'єкта (не дані записів, майже без
  GUID-ів). Найцінніший еталон — стрес-тест мержу 9 шарів (типізовані правила, tombstone-и, orphan-групи).
  Два шари засанітизовано (`WorkSalesBase.js` → порожній non-asserted шар; `WorkContractsProcess.js` →
  обрізаний до ~6 asserted-оп-ів) для усунення дублювання.
- Базовий seed `_base/BaseModulePageV2_skeleton.js` — синтетичний мінімальний скелет parent-template.

`employeescore/` видалено — жоден раннер його не вантажив.

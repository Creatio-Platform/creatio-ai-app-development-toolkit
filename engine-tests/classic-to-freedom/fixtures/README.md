# Fixtures — golden Classic schema bodies

Детерміновані golden-входи для offline-тестів merge-рушія та mapper'а (без стенду). Кожен файл — власне
тіло одного шару (`define(...)`), не merged.

Провенанс (важливо):

- `supportunitemployee/` — **синтетичні**, написані вручну. Компактні тіла `SupportUnitEmployeePage`
  (сутність `SupportUnit`): base `SupportCalendar_base.js` (8 профільних полів, 3 таби, 3 деталі, 4
  правила, метод, дві base-tab merge-и) + override `SupportService.js` (один аналітичний віджет-модуль).
  Раніше тут лежали verbatim стенд-експорти з дампами модулів/`recordId`; їх замінено синтетикою.
- `contract/` — **реальні client-schema шари** сторінки `ContractPageV2` (сутність `Contract`) з продукту
  Creatio: це власні конфігураційні метадані Creatio, узяті з **цього ж публічного MIT-ліцензованого репо
  тулкіта**, і включають **справжні тіла методів** (`getActions`, `onEntityInitialized`,
  `getUpdateDetailOnSavedConfig` тощо — напр. `CoreContracts.js` ~902 рядки). 9 шарів у справжньому порядку
  залежностей (F1) — найцінніший еталон мержу (типізовані правила, tombstone-и, orphan-групи). Це метадані
  СТОРІНКИ стандартного об'єкта (client-schema), **не** дані записів/клієнтів. Два шари свідомо
  засанітизовано, щоб прибрати Sonar-дублювання: `WorkSalesBase.js` → порожній non-asserted шар;
  `WorkContractsProcess.js` → обрізаний до ~6 asserted-оп-ів. Решта шарів (зокрема `CoreContracts.js`)
  **навмисно лишені з реальними тілами** — саме цю точність golden і покликаний захищати.
- Базовий seed `_base/BaseModulePageV2_skeleton.js` — синтетичний мінімальний скелет parent-template.

`employeescore/` видалено — жоден раннер його не вантажив.

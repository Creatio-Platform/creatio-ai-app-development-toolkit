# Fixtures — golden Classic schema bodies

Реальні тіла Classic client-unit схем зі стенду `workbuild103_15688915_0726`, зчитані через `ClientUnitSchemaDesignerService.svc/GetSchema`. Використовуються як детерміновані golden-фікстури для offline-тестів merge-рушія та mapper'а (без стенду).

- `supportunitemployee/` — перший пілот. `SupportUnitEmployeePage`, сутність `SupportUnit`, 2 клієнтські шари (`SupportCalendar_base.js` base + `SupportService.js` override). 3 деталі, 2 правила (REQUIRED + FILTRATION), 1 метод. Кейс A4 (Freedom-аналога немає).
- `contract/` — складний еталон. 9 шарів `ContractPageV2` (сутність `Contract`). Типізовані правила, глибока рекурсія деталей, дві системи правил.

Кожен файл — власне тіло одного шару (`define(...)`), не merged. Merged-очікування описуються в `expected.md` поряд (додається на Фазі 2).

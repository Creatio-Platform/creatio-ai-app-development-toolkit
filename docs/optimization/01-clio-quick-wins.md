# 01 — Clio MCP Server: Quick Wins

> Historical design note. This document explains optimization ideas, not the executable MCP contract. Resolve live tool names, params, response shapes, and errors through `tool-contract-get`.

Нотатки про найшвидші зміни в clio MCP server, які можуть дати помітний виграш у latency без повного redesign.

## A1. Remove Post-Execution Delay

### Problem

Частина tool calls має штучну затримку після виконання. Для сесій із великою кількістю викликів це додає помітний fixed overhead.

### Optimization Goal

- прибрати або параметризувати post-exec delay
- перевірити, чи затримка реально потрібна для логування або синхронізації
- зменшити базову latency без зміни user-facing workflow

### Expected Effect

- нижчий per-call overhead
- коротші app-creation сесії без зміни orchestration logic

## A2. Replace Global Lock With Narrower Concurrency Control

### Problem

Глобальний lock серіалізує незалежні tool calls і не дає використовувати безпечний паралелізм навіть там, де він можливий.

### Optimization Goal

- звузити lock scope щонайменше до environment level
- окремо оцінити read/write separation для безпечних read-only flows
- не допустити змішування логів або shared mutable state між concurrent calls

### Expected Effect

- розблокування паралельних read flows
- кращий throughput для multi-step orchestration

## A5. Return Richer Mutation Evidence

### Problem

Після schema mutations клієнт часто змушений робити додатковий refresh, щоб отримати оновлений runtime state та використати його в наступних кроках.

### Optimization Goal

- збагачувати mutation responses достатнім runtime evidence
- зменшити кількість follow-up refresh calls у тих flows, де це безпечно
- залишити backward compatibility для існуючих клієнтів

### Expected Effect

- менше round trips після mutations
- швидший перехід до наступного orchestration step

## Validation Focus

- latency before/after для типових app-creation flows
- коректність log capture після прибирання затримок
- відсутність race conditions при звуженні lock scope
- достатність enriched evidence для клієнтів без обов’язкового extra refresh

## Notes

- Ці quick wins треба оцінювати разом із Python client optimization track і composite-tool proposals.
- Документ не повинен використовуватись як reference для MCP request або response shape.

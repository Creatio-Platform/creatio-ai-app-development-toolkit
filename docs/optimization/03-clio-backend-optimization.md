# 03 — Clio Backend Optimization

> Historical design note. This document records backend optimization directions and must not be used as the executable MCP contract reference.

Нотатки про server-side bottlenecks, які не вирішуються лише Python client tuning.

## Main Themes

### Reduce N+1 Metadata Loading

- скоротити кількість backend calls під час runtime context refresh
- віддавати достатній aggregated state за один logical refresh
- уникати повторного loading тих самих schema fragments між сусідніми operations

### Reuse Expensive Context

- мінімізувати повторне створення короткоживучих backend objects
- по можливості кешувати або повторно використовувати immutable metadata
- зменшити latency на large app contexts

### Keep Materialization Observable

- після mutation клієнт має бачити, що schema або binding справді матеріалізувався
- evidence model має дозволяти верифікувати успішний стан без зайвих round trips там, де це безпечно

## Expected Effect

- менше backend chatter під час `get-app-info`
- швидші multi-step entity flows
- менше залежності від follow-up discovery лише для того, щоб підтвердити щойно виконану mutation

## Risks

- агресивне кешування може приховати stale state
- richer backend aggregation не повинна ламати існуючих клієнтів
- оптимізації треба перевіряти на mixed flows: create, update, lookup seeding, page sync follow-up

## Notes

- Цей документ описує напрямки backend optimization, а не поточний wire contract.
- Актуальні tool params і response shapes мають читатися з clio MCP discovery під час виконання.

# MCP Performance Optimization — Overview

Результат аналізу сесії `84576484` (8m 11s, UsrTodoList) та аудиту коду clio MCP server + Python client.

## Критичні знахідки

| # | Проблема | Файл | Вплив |
|---|----------|------|-------|
| 1 | `Thread.Sleep(500)` після кожного tool call | `BaseTool.cs:64` | +7s на сесію |
| 2 | Global static lock серіалізує ВСІ tools | `BaseTool.cs:16,58` | паралелізм неможливий |
| 3 | N+1 entity loading в get-info | `ApplicationInfoService` | 13+ HTTP замість 4 |
| 4 | `call_tools_batch` — фейковий batch | `mcp_client.py:182` | послідовна ітерація |
| 5 | 28 Prompts + 4 Resources не використовуються | clio → Python client | missed capabilities |

## Плани (окремі документи)

| Документ | Трек | Зміст |
|----------|------|-------|
| [01-clio-quick-wins.md](01-clio-quick-wins.md) | Clio Server | Sleep, lock, enriched responses |
| [02-clio-composite-tools.md](02-clio-composite-tools.md) | Clio Server | schema-sync, page-sync composite tools |
| [03-clio-backend-optimization.md](03-clio-backend-optimization.md) | Clio Server | N+1 fix, HTTP batching, connection pooling |
| [04-python-client-improvements.md](04-python-client-improvements.md) | Python Client | Batch, parsing, buffering, single process |
| [05-mcp-protocol-features.md](05-mcp-protocol-features.md) | MCP Protocol | Resources, Prompts, Progress, Subscriptions |

## Оцінка впливу

| Scenario: UsrTodoList | Поточний | Після | Економія |
|-----------------------|----------|-------|----------|
| MCP execution (14 BaseTool + 3 AppTool calls) | ~37s | ~7.6s | **79%** |
| Повна сесія | 8m 11s | 3-5m | **40-60%** |

## Пріоритети

```
День 1:  01-clio-quick-wins.md (A1 + A2)     → -7s + parallelism
День 2-3: 02-clio-composite-tools.md (A6, A7)  → -13s
День 4:  04-python-client-improvements.md      → -4.5s
День 5:  03-clio-backend-optimization.md       → -4s
Тиждень 2: 05-mcp-protocol-features.md         → maintenance + UX
```

# MCP Performance Optimization — Overview

> Historical design notes only. These documents are not the executable MCP contract source of truth. For current tool names, parameters, response shapes, and errors, use `clio MCP` via `get-tool-contract`.

Result of analyzing session `84576484` (8m 11s, UsrTodoList) and an audit of the clio MCP server code and Python client.

## Critical Findings

| # | Issue | File | Impact |
|---|-------|------|--------|
| 1 | `Thread.Sleep(500)` after every tool call | `BaseTool.cs:64` | +7s per session |
| 2 | Global static lock serializes ALL tools | `BaseTool.cs:16,58` | parallelism impossible |
| 3 | N+1 entity loading in get-info | `ApplicationInfoService` | 13+ HTTP instead of 4 |
| 4 | `call_tools_batch` — fake batch | `mcp_client.py:263` | sequential iteration |
| 5 | 28 Prompts + 4 Resources unused | clio → Python client | missed capabilities |

## Plans (separate documents)

| Document | Track | Content |
|----------|-------|---------|
| [01-clio-quick-wins.md](01-clio-quick-wins.md) | Clio Server | Sleep, lock, enriched responses |
| [02-clio-composite-tools.md](02-clio-composite-tools.md) | Clio Server | sync-schemas, sync-pages composite tools |
| [03-clio-backend-optimization.md](03-clio-backend-optimization.md) | Clio Server | N+1 fix, HTTP batching, connection pooling |
| [04-python-client-improvements.md](04-python-client-improvements.md) | Python Client | Batch, parsing, buffering, single process |
| [05-mcp-protocol-features.md](05-mcp-protocol-features.md) | MCP Protocol | Resources, Prompts, Progress, Subscriptions |

## Impact Estimate

| Scenario: UsrTodoList | Current | After | Saved |
|-----------------------|---------|-------|-------|
| MCP execution (14 BaseTool + 3 AppTool calls) | ~37s | ~7.6s | **79%** |
| Full session | 8m 11s | 3-5m | **40-60%** |

## Priorities

```
Day 1:    01-clio-quick-wins.md (A1 + A2)     -> -7s + parallelism
Day 2-3:  02-clio-composite-tools.md (A6, A7) -> -13s
Day 4:    04-python-client-improvements.md    -> -4.5s
Day 5:    03-clio-backend-optimization.md     -> -4s
Week 2:   05-mcp-protocol-features.md         -> maintenance + UX
```

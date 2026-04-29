# 03 — Clio Backend Optimization

> Historical design note. This document records backend optimization directions and must not be used as the executable MCP contract reference.

Notes on server-side bottlenecks that cannot be resolved by Python client tuning alone.

## Main Themes

### Reduce N+1 Metadata Loading

- shrink the number of backend calls during runtime context refresh
- return sufficient aggregated state in a single logical refresh
- avoid repeated loading of the same schema fragments between adjacent operations

### Reuse Expensive Context

- minimize repeated creation of short-lived backend objects
- where possible, cache or reuse immutable metadata
- reduce latency on large app contexts

### Keep Materialization Observable

- after a mutation the client must see that the schema or binding was actually materialized
- the evidence model must allow verifying a successful state without extra round trips where it is safe

## Expected Effect

- less backend chatter during `get-app-info`
- faster multi-step entity flows
- less reliance on follow-up discovery solely to confirm a mutation that was just executed

## Risks

- aggressive caching may hide stale state
- richer backend aggregation must not break existing clients
- optimizations must be validated against mixed flows: create, update, lookup seeding, page sync follow-up

## Notes

- This document describes backend optimization directions, not the current wire contract.
- Current tool params and response shapes must be read from clio MCP discovery at execution time.

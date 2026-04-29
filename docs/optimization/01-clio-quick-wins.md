# 01 — Clio MCP Server: Quick Wins

> Historical design note. This document explains optimization ideas, not the executable MCP contract. Resolve live tool names, params, response shapes, and errors through `get-tool-contract`.

Notes on the fastest changes in clio MCP server that can yield a noticeable latency win without a full redesign.

## A1. Remove Post-Execution Delay

### Problem

Some tool calls have an artificial delay after execution. For sessions with many calls, this adds noticeable fixed overhead.

### Optimization Goal

- remove or parameterize the post-exec delay
- verify whether the delay is actually needed for logging or synchronization
- reduce baseline latency without changing the user-facing workflow

### Expected Effect

- lower per-call overhead
- shorter app-creation sessions without changes to orchestration logic

## A2. Replace Global Lock With Narrower Concurrency Control

### Problem

A global lock serializes independent tool calls and prevents safe parallelism even where it would be possible.

### Optimization Goal

- narrow lock scope to at least environment level
- separately evaluate read/write separation for safe read-only flows
- prevent mixing of logs or shared mutable state between concurrent calls

### Expected Effect

- unblocking parallel read flows
- better throughput for multi-step orchestration

## A5. Return Richer Mutation Evidence

### Problem

After schema mutations, the client is often forced to make an additional refresh to obtain updated runtime state and use it in subsequent steps.

### Optimization Goal

- enrich mutation responses with sufficient runtime evidence
- reduce the number of follow-up refresh calls in flows where it is safe to do so
- preserve backward compatibility for existing clients

### Expected Effect

- fewer round trips after mutations
- faster transition to the next orchestration step

## Validation Focus

- latency before/after for typical app-creation flows
- correctness of log capture after removing the delays
- absence of race conditions after narrowing lock scope
- sufficiency of enriched evidence for clients without a mandatory extra refresh

## Notes

- These quick wins should be evaluated together with the Python client optimization track and composite-tool proposals.
- This document must not be used as a reference for MCP request or response shape.

# 04 — Python Client Improvements

> Historical design note. This document describes client-side optimization ideas only. It is not a source of executable MCP contract truth.

Notes on how to reduce overhead in the Python wrapper and orchestration scripts.

## Main Themes

### Persistent MCP Session

- keep a single live clio MCP process instead of repeated startup for every call
- reuse initialize state and contract cache
- reduce fixed overhead on multi-step flows

### Fewer Shell Boundaries

- reduce the number of separate bash/powershell invocations
- consolidate sequential orchestration steps into fewer Python entrypoints
- reduce module import overhead and quoting-related fragility

### Better Wrapper Responsibilities

- keep the wrapper responsible for transport, bootstrap, cache, unknown-tool suggestions, and top-level metadata validation
- do not duplicate the nested tool contract locally
- return server errors as the primary source of truth for complex payload mismatches

### Better Progress And Evidence Handling

- make progress reporting convenient for agents
- preserve runtime evidence incrementally

## Expected Effect

- shorter end-to-end runs
- fewer flaky shell failures
- simpler wrapper code path
- lower chance of contract drift between the repo and clio MCP

## Notes

- When an exact tool shape is needed, the Python client must read it from live contract metadata, not from repo-local fallback maps.
- This document must not contain hard-coded request or response examples for clio MCP tools.

# 02 — Clio MCP Server: Composite Tools

> Historical design note. This document captures architectural motivation for composite tools. It is not the executable MCP contract source of truth.

Notes on composite tools as a way to remove orchestration overhead between many small MCP calls.

## Goal

Reduce the number of separate round trips in flows where the agent almost always executes a fixed sequence of related operations.

## A6. `sync-schemas`

### Motivation

New app flows typically perform several tightly-coupled entity mutations:

- create/discover main app shell
- add lookup entities
- seed lookup values
- extend the main entity with new business fields
- refresh runtime state

When these steps are broken into many atomic calls, transport, locking, and repeated-refresh costs quickly dominate over the actual useful work.

### Desired Characteristics

- one orchestration boundary for a related schema batch
- single responsibility for lookup-before-reference ordering
- fewer intermediate refresh steps
- sufficient per-operation evidence for the client to see what was actually materialized

### Design Constraints

- atomic tools must remain available as a compatibility path
- the composite flow must not become an alternative hand-written contract spec in repo docs
- the client side must continue to trust live contract discovery, not historical examples

## A7. `sync-pages`

### Motivation

Runtime page editing often includes:

- discover page
- read live body
- apply edits
- persist page
- verify result

When this is done through many separate write/save/dry-run calls, unnecessary network and process overhead accumulates.

### Desired Characteristics

- batch save for related pages in a single app flow
- built-in validation/verification evidence
- convenient fast path for FormPage + ListPage sync
- preservation of a fallback path for legacy single-page workflows

## Expected Effect

- fewer tool calls per app-creation run
- less transport overhead
- cleaner execution trace for agents
- less temptation to duplicate tool payload details in repo docs

## Risks

- composite tools must not hide real partial failures
- richer flows require a clear evidence model
- server/client rollout must preserve backward compatibility for existing atomic workflows

## Notes

- This document describes why composite tools are useful, not what their live payload should look like.
- Any current executable shape must be taken only from clio MCP discovery.

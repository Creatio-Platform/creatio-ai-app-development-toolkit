# 04 — Python Client Improvements

> Historical design note. This document describes client-side optimization ideas only. It is not a source of executable MCP contract truth.

Нотатки про те, як зменшити накладні витрати Python wrapper та orchestration scripts.

## Main Themes

### Persistent MCP Session

- тримати один живий clio MCP process замість repeated startup for every call
- повторно використовувати initialize state і contract cache
- зменшити fixed overhead на багатокрокових flows

### Fewer Shell Boundaries

- скоротити кількість окремих bash/powershell invocations
- зібрати послідовні orchestration steps у меншу кількість Python entrypoints
- зменшити module import overhead і quoting-related fragility

### Better Wrapper Responsibilities

- залишити wrapper відповідальним за transport, bootstrap, cache, unknown-tool suggestions і top-level metadata validation
- не дублювати nested tool contract локально
- повертати server errors як primary source of truth для складних payload mismatches

### Better Progress And Evidence Handling

- робити progress reporting зручним для агентів
- зберігати runtime evidence інкрементально

## Expected Effect

- коротші end-to-end runs
- менше flaky shell failures
- простіший wrapper code path
- менше шансів на contract drift між repo і clio MCP

## Notes

- Якщо потрібен точний tool shape, Python client має читати його з live contract metadata, а не з repo-local fallback maps.
- Цей документ не повинен містити hard-coded request або response examples для clio MCP tools.

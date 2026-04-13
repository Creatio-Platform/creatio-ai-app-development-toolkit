# 02 — Clio MCP Server: Composite Tools

> Historical design note. This document captures architectural motivation for composite tools. It is not the executable MCP contract source of truth.

Нотатки про composite tools як спосіб прибрати orchestration overhead між багатьма дрібними MCP calls.

## Goal

Зменшити кількість окремих round trips у flows, де агент майже завжди виконує фіксовану послідовність пов’язаних operations.

## A6. `sync-schemas`

### Motivation

Нові app flows зазвичай виконують кілька тісно пов’язаних entity mutations:

- create/discover main app shell
- add lookup entities
- seed lookup values
- extend the main entity with new business fields
- refresh runtime state

Коли ці кроки розбиті на багато atomic calls, витрати на transport, locking і repeated refresh швидко домінують над реальною корисною роботою.

### Desired Characteristics

- одна orchestration boundary для пов’язаного schema batch
- одна відповідальність за ordering lookup-before-reference
- менше проміжних refresh steps
- достатня per-operation evidence, щоб клієнт міг побачити, що реально матеріалізувалось

### Design Constraints

- atomic tools мають залишатися доступними як compatibility path
- composite flow не повинен ставати альтернативною hand-written contract spec у repo docs
- client side має далі довіряти live contract discovery, а не historical прикладам

## A7. `sync-pages`

### Motivation

Runtime page editing часто включає:

- discover page
- read live body
- apply edits
- persist page
- verify result

Коли це робиться багатьма окремими write/save/dry-run calls, виникає зайвий network і process overhead.

### Desired Characteristics

- batch save для пов’язаних сторінок одного app flow
- вбудована validation/verification evidence
- зручний fast path для FormPage + ListPage sync
- збереження fallback path для legacy single-page workflows

## Expected Effect

- менше tool calls на один app-creation run
- менше transport overhead
- чистіший execution trace для агентів
- менше спокуси дублювати tool payload details у repo docs

## Risks

- composite tools не повинні приховувати реальні partial failures
- richer flows потребують чіткої evidence model
- server/client rollout має зберегти backward compatibility для existing atomic workflows

## Notes

- Цей документ описує навіщо composite tools корисні, а не як саме має виглядати їхній live payload.
- Будь-який поточний executable shape треба брати тільки з clio MCP discovery.

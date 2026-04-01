# 05 — MCP Protocol Features

> Historical design note. This document records protocol-level opportunities and must not be used as a contract reference for live clio MCP tools.

Нотатки про MCP capabilities, які можуть покращити UX і зменшити дублювання knowledge між server і client.

## Main Themes

### Prompts And Resources As Live Guidance

- використовувати server-discovered prompts/resources як живе джерело execution guidance
- зменшити обсяг repo-local agent text, який дублює server-owned rules
- дати агентам актуальні підказки без ручного оновлення repo docs

### Progress Reporting

- підхоплювати protocol-level progress і передавати його в orchestration UX
- робити довгі operations зрозумілішими для агента і користувача

### Tool Metadata

- використовувати annotations і metadata для smarter retry policy, safety decisions і richer logging
- не дублювати ці правила в hand-written wrapper maps

### Resource And Subscription Flows

- оцінити, де protocol-level resources або subscriptions можуть прибрати зайві refresh calls
- покращити пост-mutation visibility без додаткового polling там, де server already knows state changed

## Expected Effect

- менше contract drift між repo docs і live server behavior
- краща explainability long-running tool calls
- cleaner wrapper logic
- зручніший path для agent guidance that evolves with clio itself

## Notes

- Цей документ описує adoption ideas, а не current prompt/resource catalog.
- Поточні prompts, resources, annotations і інші protocol surfaces мають читатися з live MCP discovery під час виконання.

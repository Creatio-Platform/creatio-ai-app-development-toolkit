# LangChain JS: Best Practices + Refactor Plan

## 1) Best Practices (на основі офіційних прикладів/гайдів LangChain JS)

1. Використовувати єдиний agent runtime (`createAgent`) замість змішування кількох підходів.
- Дає єдину модель виклику інструментів, middleware, streaming, memory.
- Для вашого кейсу це прибирає дублювання між `parseCreatioIntent` і `creatioSchemaAgent`.

2. Весь I/O робити строго типізованим через `zod` + structured output.
- `responseFormat`/structured output краще за парсинг JSON-рядків і regex.
- Це прямо зменшує крихкість у `parseAgentResponse`.

3. Будувати інструменти як thin adapters з чіткими контрактами.
- Інструмент повертає структуру, а не `JSON.stringify(...)` рядок.
- Валідація аргументів і стабільні помилки на вході/виході.

4. Додати middleware-шар для runtime рішень.
- `wrapModelCall` для вибору моделі за складністю задачі.
- Централізовані guardrails і політики перед/після виклику моделі.

5. Увімкнути streaming подій і traceability за замовчуванням.
- `agent.stream(...)` + уніфіковані події для UI.
- Це дає прозорість: які tool calls, які LLM кроки, де помилка.

6. Додати короткочасну памʼять/стан діалогу в checkpointer/store.
- Для multi-step сценаріїв (вибір шаблону) краще thread-based state, ніж локальний `Map` без зовнішнього сховища.

7. Ввести human-in-the-loop для ризикових операцій.
- Перед `create_new_schema` можна вимагати підтвердження в окремих режимах (prod/safe mode).

8. Уніфікувати обробку помилок на рівні domain/service.
- Не передавати «сирі» stack traces у API-відповіді.
- Повертати стабільний контракт: `code`, `message`, `details?`.

9. Чітко розділити orchestration і domain logic.
- Route/agent не повинні знати деталі Creatio transport.
- Окремий gateway/service інтерфейс для MCP/REST/embedded runtime.

10. Додати сценарні тести агентного флоу.
- Обовʼязкові e2e кейси: create with template, create -> ask template -> choose -> create, extend, unsupported.

## 2) Що зараз у проєкті варто переробити (цільово)

1. Непослідовний orchestration flow:
- `src/routes/creatioAgent.ts` одночасно робить intent parsing, branching і fallback на deepagent.
- Потрібен один orchestration pipeline.

2. Крихкий parsing:
- `src/routes/creatioAgent.ts` (`parseAgentResponse`) парсить markdown/json через regex + `JSON.parse`.
- Потрібно перейти на structured output contract.

3. Інструменти повертають рядки:
- `src/mcp/creatioMcpTools.ts` повертає `result.content[0].text`.
- Потрібен typed result adapter, щоб прибрати ручний JSON parsing у сервісах.

4. Domain/service напряму залежить від конкретного in-process MCP singleton:
- `src/services/creatioSchemaService.ts` привʼязаний до `getCreatioServer()`.
- Потрібен `SchemaCreationGateway` інтерфейс + реалізації.

5. Стан template selection лише in-memory:
- `src/services/templateSelectionStore.ts` не переживає restart і не масштабується горизонтально.
- Потрібен backing store (Redis/DB) + TTL + idempotency key.

6. Розпорошена валідація і error mapping:
- Частина в route, частина в сервісі, частина в MCP.
- Потрібен єдиний error taxonomy та validation layer.

## 3) План рефакторингу (поетапно)

### Phase 1: Contract-first стабілізація API (1-2 дні)
1. Додати єдині DTO/схеми для `CreateSchema`, `ExtendSchema`, `TemplateSelection`, `AgentResult`.
2. Прибрати regex/json fallback parsing; залишити лише structured output.
3. Ввести єдиний формат помилок (`code`, `message`, `meta`).

Definition of Done:
- `POST /agent/creatio` і `/agent/creatio/schema` повертають стабільні типізовані відповіді.
- Немає regex-парсингу LLM-відповідей.

### Phase 2: Tool/runtime abstraction (2-3 дні)
1. Ввести `SchemaCreationGateway` (interface) і адаптери (`mcp`, `rest`, `embedded-smoke` за потреби).
2. Перенести parsing MCP tool response у gateway adapter.
3. Винести mapping `schemaType <-> code` у shared module.

Definition of Done:
- `creatioSchemaService` працює лише через interface.
- Перемикання gateway через конфіг без змін orchestration коду.

### Phase 3: Єдиний agent orchestration (2-3 дні)
1. Замінити split-flow (`parseCreatioIntent` + deepagent fallback) на один `createAgent` flow.
2. Додати middleware: model routing, safety policy, unified telemetry hooks.
3. Додати streaming API подій агента для UI.

Definition of Done:
- Один pipeline для create/extend/get-info/not-supported.
- UI бачить кроки agent/tool/model у реальному часі.

### Phase 4: State, reliability, tests (2-3 дні)
1. Перенести `TemplateSelectionStore` у Redis/DB store з TTL.
2. Додати idempotency для create-операцій.
3. Додати integration/e2e тести критичних сценаріїв.

Definition of Done:
- Сервіс коректно переживає restart без втрати активних selection flow.
- Є автоматичні тести на ключові сценарії.

## 4) Пропонований target architecture

1. `src/agent/runtime/*`:
- єдиний `createAgent`, middleware, response schemas, streaming.

2. `src/domain/schema/*`:
- use cases (`createSchema`, `extendSchema`, `listTemplates`), error taxonomy.

3. `src/integrations/schema-creation/*`:
- gateway adapters (`mcp`, `rest`, `embed-smoke`), transport details.

4. `src/api/*`:
- тонкі route handlers, без бізнес-логіки.

## 5) Джерела

- LangChain JS Overview: https://docs.langchain.com/oss/javascript/langchain/overview
- Agents (createAgent, tools, middleware, memory, streaming): https://docs.langchain.com/oss/javascript/langchain/agents
- Structured output (responseFormat, schema-driven outputs): https://docs.langchain.com/oss/javascript/langchain/structured-output
- Tools (design of tools and schemas): https://docs.langchain.com/oss/javascript/langchain/tools
- Guardrails: https://docs.langchain.com/oss/javascript/langchain/guardrails
- Human-in-the-loop: https://docs.langchain.com/oss/javascript/langchain/human-in-the-loop
- Official examples directory (scope of review): https://github.com/langchain-ai/langchainjs/tree/main/examples

# Тестування Creatio MCP за допомогою MCP Inspector

> 💡 **Для програматичного тестування** (автоматизація, CI/CD) дивіться [`docs/mcp-testing-guide.md`](../docs/mcp-testing-guide.md)

MCP Inspector — офіційний візуальний інструмент для тестування MCP серверів. Він запускає веб-інтерфейс з формами, через який можна підключитись до MCP ендпоінту, переглянути доступні tools і виконати виклики без написання коду.

## Передумови

- **Node.js** >= 18 та **npx** (входить до Node.js)
- **Запущений Creatio** з MCP ендпоінтом (`<MCP_URL>`, отриманим від користувача під час планування)
- Перевірити що сервер відповідає:
  ```bash
  curl -s "<MCP_URL>" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  ```
  Якщо бачите відповідь з `event: message` — сервер працює.

## Крок 1: Запуск Inspector

Відкрийте термінал і виконайте команду з параметром `--url`:

```bash
npx @modelcontextprotocol/inspector --url "http://localhost:5001/mcp"
```

Або в tmux сесії для фонового запуску:
```bash
# Створити tmux сесію
tmux new -s mcp-inspector

# Запустити Inspector
npx @modelcontextprotocol/inspector --url "http://localhost:5001/mcp"

# Відключитись (Ctrl+B, потім D)
# Підключитись назад: tmux attach -t mcp-inspector
```

> ⚠️ **Важливо:** Параметр `--url` автоматично встановлює Transport Type на **Streamable HTTP**

Inspector виведе в консолі:
```
⚙️ Proxy server listening on <proxy-host>:<proxy-port>
🔑 Session token: abc123...
🚀 MCP Inspector is up and running at:
   <inspector-ui-url>/?MCP_PROXY_AUTH_TOKEN=abc123...
```

Inspector запустить два сервери:
- **Web UI** — URL буде виведений у консолі Inspector
- **Proxy** — URL буде виведений у консолі Inspector

> Можна змінити порти через змінні середовища:
> ```bash
> CLIENT_PORT=8080 SERVER_PORT=9090 npx @modelcontextprotocol/inspector --url "$MCP_URL"
> ```

## Крок 2: Відкрийте Inspector у браузері

Скопіюйте повну URL з консолі (з `?MCP_PROXY_AUTH_TOKEN=...`) і відкрийте у браузері.

Ви побачите інтерфейс MCP Inspector:

```
┌─────────────────────┐  ┌──────────────────────────────────────┐
│ Transport Type      │  │                                      │
│ [Streamable HTTP ▾] │  │  Connect to an MCP server to start   │
│                     │  │  inspecting                          │
│ URL                 │  │                                      │
│ [<MCP_URL>]               │                                      │
│                     │  │                                      │
│ Connection Type     │  │                                      │
│ [Via Proxy ▾]       │  │                                      │
│                     │  │                                      │
│ [▶ Connect]         │  │                                      │
│ ● Disconnected      │  │                                      │
└─────────────────────┘  └──────────────────────────────────────┘
```

Переконайтесь що:
1. **Transport Type** = `Streamable HTTP` (не STDIO, не SSE!)
2. **URL** = `http://localhost:5001/mcp`
3. **Connection Type** = `Via Proxy` (проксі обходить CORS)

## Крок 3: Налаштування автентифікації

⚠️ **КРИТИЧНО:** Creatio MCP endpoint вимагає HTTP Basic Auth!

1. Натисніть на **▶ Authentication** щоб розкрити секцію
2. В секції буде поле для додавання custom headers
3. Додайте заголовок:
   - **Header Name:** `Authorization`
   - **Header Value:** `Basic U3VwZXJ2aXNvcjpTdXBlcnZpc29y`
   
   > 💡 **Підказка:** `U3VwZXJ2aXNvcjpTdXBlcnZpc29y` = Base64 кодування `Supervisor:Supervisor`

4. Переконайтесь що header збережений

## Крок 4: Підключення до MCP сервера

Натисніть кнопку **Connect**.

Якщо підключення успішне, ви побачите:
- 🟢 **Connected** (замість ● Disconnected)
- Ім'я серверу: **Terrasoft.WebHost**
- Версію: **8.3.4.802** (або інша)
- Кнопки **Reconnect** / **Disconnect** замість Connect
- Вкладки вгорі: Resources, Prompts, **Tools**, Tasks, Apps, Ping тощо
- У History внизу: `1. initialize`, `2. logging/setLevel`

```
┌─────────────────────┐  ┌──────────────────────────────────────┐
│ ...                 │  │ Resources│Prompts│ Tools │Tasks│...  │
│ [⟳ Reconnect]       │  │                                      │
│ [⊗ Disconnect]      │  │  Tools              Select a tool    │
│ 🟢 Connected        │  │  [List Tools]       Select a tool    │
│                     │  │                     from the list to │
│ 🖥 Terrasoft.WebHost│  │                     view its details │
│ Version: 8.3.4.802  │  │                     and run it       │
└─────────────────────┘  └──────────────────────────────────────┘
```

## Крок 5: Перегляд доступних Tools

1. Переконайтесь що вкладка **Tools** активна (вгорі)
2. Натисніть кнопку **List Tools**
3. Зліва з'явиться список всіх доступних MCP інструментів:

| Tool | Опис |
|------|------|
| `entity.get_schema_info` | Отримати UId та деталі існуючої entity схеми за іменем |
| `entity.list_parents` | Список доступних батьківських схем для наслідування |
| `entity.create` | DB-first створення entity з колонками, повертає persisted snapshot |
| `entity.create_lookup` | DB-first створення lookup entity, повертає persisted snapshot |
| `entity.check_name` | Перевірка чи ім'я entity вільне |
| `entity.update` | DB-first оновлення entity через explicit operations |
| `application.create` | DB-first створення повного застосунку, повертає compact short context |
| `application.get_list` | Список існуючих applications для discovery перед update flow |
| `application.get_info` | Поточний compact application context з БД для існуючого application |
| `binding.get_columns` | Повертає колонки, UId та data value types для існуючої schema |
| `binding.create` | DB-first створює або оновлює binding, одразу інсталює дані, `outputPath` лишається опційним side effect |

```
┌─ Tools ──────────────────────┐  ┌─ Select a tool ────────────┐
│ [List Tools] [Clear]          │  │ Select a tool from the     │
│                               │  │ list to view its details   │
│ entity.get_schema_info      ›│  │ and run it                 │
│ entity.list_parents         ›│  │                            │
│ entity.create               ›│  │                            │
│ entity.create_lookup        ›│  │                            │
│ entity.check_name           ›│  │                            │
│ application.create          ›│  │                            │
│ application.get_list        ›│  │                            │
│ application.get_info        ›│  │                            │
│ binding.get_columns         ›│  │                            │
│ binding.create              ›│  │                            │
└───────────────────────────────┘  └────────────────────────────┘
```

4. У History внизу з'явиться запис `3. tools/list`

## Крок 6: Тестування entity.check_name

Найпростіший тест — перевірка унікальності імені entity:

1. У списку tools зліва натисніть на **entity.check_name**
2. Праворуч відкриється форма з:
   - Описом: "Checks if an entity schema name is unique (not already taken)"
   - Тегами: Read-only, Destructive, Idempotent, Open-world
   - Полем **name*** (обов'язкове)
   - Кнопками **Run Tool** та **Copy Input**
3. У полі **name** введіть: `Contact`
4. Натисніть **Run Tool**
5. Внизу форми з'явиться результат:

```
Tool Result: Success

{
  name: "Contact"
  isUnique: false      ← Contact існує, тому false
}
```

6. Тепер змініть **name** на `UsrTestEntity123` і натисніть **Run Tool** знову:

```
Tool Result: Success

{
  name: "UsrTestEntity123"
  isUnique: true       ← Такої entity немає, ім'я вільне
}
```

> 💡 В History внизу кожен виклик з'являється як `tools/call`. Клікніть ▶ щоб побачити повний JSON запит/відповідь.

## Крок 7: Тестування entity.create_lookup

Створення lookup entity (довідника):

1. У списку tools зліва натисніть на **entity.create_lookup**
2. Праворуч відкриється форма з полями:
   - **packageUId*** — GUID пакету
   - **name*** — ім'я entity
   - **caption*** — відображуване ім'я
   - **outputPath** — deprecated, ігнорується
3. Заповніть:
   - **packageUId**: `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`
   - **name**: `UsrTestLookup`
   - **caption**: `Test Lookup`
   - **outputPath**: _(залиште порожнім — параметр ігнорується)_
4. Натисніть **Run Tool**
5. Результат:

```
Tool Result: Success

{
  success: true
  packageUId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
  entity: {
    uId: "..."
    name: "UsrTestLookup"
    caption: "Test Lookup"
    parentSchemaName: "BaseLookup"
    columns: [...]
  }
}
```

## Крок 8: Тестування entity.create з колонками

Створення entity з кастомними колонками — повний тест:

1. У списку tools зліва натисніть на **entity.create**
2. Праворуч відкриється форма з полями:
   - **packageUId*** — GUID пакету
   - **name*** — ім'я entity
   - **caption*** — відображуване ім'я
   - **parentSchemaName** — батьківська схема
   - **columnsJson** — JSON масив визначень колонок
   - **outputPath** — deprecated, ігнорується
3. Заповніть:
   - **packageUId**: `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`
   - **name**: `UsrTestOrder`
   - **caption**: `Test Order`
   - **parentSchemaName**: `BaseEntity`
   - **columnsJson**:
     ```
     [{"name":"UsrTitle","caption":"Title","dataValueTypeName":"ShortText","isRequired":true},{"name":"UsrAmount","caption":"Amount","dataValueTypeName":"Float2"},{"name":"UsrDueDate","caption":"Due Date","dataValueTypeName":"Date"},{"name":"UsrContact","caption":"Contact","dataValueTypeName":"Lookup","referenceSchemaName":"Contact"}]
     ```
   - **outputPath**: _(залиште порожнім)_
4. Натисніть **Run Tool**
5. Результат — persisted entity snapshot з усіма колонками після save в БД.

> ⚠️ **columnsJson** — це рядок з JSON масивом. Вставляйте його в одну строку без переносів.

## Крок 9: Тестування entity.list_parents

Перегляд доступних батьківських схем:

1. Натисніть на **entity.list_parents** у списку
2. Форма не має параметрів — просто натисніть **Run Tool**
3. Побачите список parent schemas (BaseEntity, BaseLookup, тощо) з їх UId

## Крок 10: Тестування entity.get_schema_info

Отримання інформації про існуючу entity:

1. Натисніть на **entity.get_schema_info** у списку
2. У полі **name** введіть: `Contact`
3. Натисніть **Run Tool**
4. Побачите UId та деталі схеми Contact

## Крок 11: Тестування entity.update

1. Оберіть `entity.update`
2. Заповніть:
   - `entityUId`: GUID існуючої entity
   - `packageUId`: GUID пакету
   - `name`: існуюче ім'я entity
   - `caption`: поточний caption
   - `parentSchemaName`: поточний parent
   - `operationsJson`:
     ```json
     [{"operation":"addColumn","column":{"name":"UsrStatus","caption":"Status","referenceSchemaName":"UsrTestLookup"}}]
     ```
3. Натисніть **Run Tool**
4. Очікуваний результат:
   - `success=true`
   - `entity.columns` уже містить нову колонку
   - `appliedOperations` повертає виконані дії

---

## Крок 12: Тестування binding.get_columns

1. Оберіть `binding.get_columns`
2. У полі `schemaName` введіть `SysModule`
3. Натисніть **Run Tool**
4. Очікуваний результат:
   - JSON масив колонок
   - для кожної колонки є `name`, `uId`, `dataValueTypeName`

## Крок 13: Тестування binding.create

1. Оберіть `binding.create`
2. Заповніть:
   - `packageUId`: `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`
   - `schemaName`: `UsrTestLookup`
   - `bindingName`: `UsrTestLookup_Lookup`
   - `rowsJson`:
     ```json
     [[{"columnName":"Id","value":"<fresh-guid>"},{"columnName":"Name","value":"New"},{"columnName":"Description","value":""}]]
     ```
3. Опціонально можна вказати `outputPath`, якщо потрібні `descriptor.json`, `data.json` і `filter.json` на сервері.
4. Натисніть **Run Tool**
5. Очікуваний результат:
   - `{"success": true}`
   - binding створений або оновлений у БД
   - seed data одразу встановлені в target schema

## Крок 14: Тестування application.create (DB-first)

Цей tool створює застосунок у БД і повертає compact short context.

> 💡 **Підказка:** Параметр `iconId` необов'язковий — якщо не вказати, система автоматично обере випадкову іконку з `SysAppIcons`.

1. У списку tools натисніть **application.create**
2. Заповніть обов'язкові поля:
   - `name`: `Test App`
   - `code`: `UsrTestApp`
   - `templateCode`: `AppFreedomUI` (core розв'яже в v1 або v2 за feature flags)
   - `iconBackground`: `#1F5F8B`
   - `optionalTemplateDataJson`: `{"useExistingEntitySchema":false,"entitySchemaName":"","appSectionDescription":"","useAIContentGeneration":false}`
3. Опціонально можна вказати `iconId` якщо потрібна конкретна іконка
4. Натисніть **Run Tool**
5. Очікуваний результат:
   - у відповіді поле `content[0].text` містить JSON з `success=true`, `app`, `packages`
6. Типові помилки:
   - `{"success":false,"error":{"message":"iconId must be a valid GUID..."}}`
   - `{"success":false,"error":{"message":"Icon with id '...' was not found"}}`
   - `{"success":false,"error":{"message":"useAIContentGeneration=true is not supported..."}}`

---

## Панель History

Внизу екрану є панель **History** де записується кожен MCP запит:

```
4. tools/call        ▶
3. tools/list        ▶
2. logging/setLevel  ▶
1. initialize        ▶
```

Натисніть **▶** біля будь-якого запису щоб побачити повний JSON-RPC запит та відповідь. Це корисно для дебагу — можна побачити точні параметри що були відправлені та точну відповідь серверу.

---

## Розв'язання проблем

### "Authentication required" або "Streamable HTTP error: Error POSTing to endpoint"

**Причина:** MCP endpoint вимагає HTTP Basic Auth, але заголовок `Authorization` не налаштовано

**Рішення:** 
1. Розкрийте секцію **▶ Authentication** в UI Inspector
2. Додайте custom header:
   - Name: `Authorization`
   - Value: `Basic U3VwZXJ2aXNvcjpTdXBlcnZpc29y`
3. Натисніть **Connect** знову

> ⚠️ **Важливо:** CLI параметр `--header` НЕ працює через проксі. Налаштування потрібно робити через UI!

### "Connection Error - Did you add the proxy session token in Configuration?"

Inspector запущений без `--url` параметра або без auth токена.

**Рішення:** Перезапустіть Inspector з `--url`:
```bash
npx @modelcontextprotocol/inspector --url "$MCP_URL"
```
І відкрийте URL з токеном, який Inspector вивів у консолі.

### "Failed to fetch" (Connection Type = Direct)

CORS блокує прямий запит з браузера. Браузер не дозволяє cross-origin запити між origin Inspector UI та origin MCP endpoint.

**Рішення:** Змініть Connection Type на **Via Proxy**. Проксі-сервер Inspector (порт 6277) обходить CORS.

### "Cannot POST /register" (Via Proxy без токена)

Проксі-сервер очікує auth токен але не отримав його.

**Рішення:** Переконайтесь що URL в браузері містить `?MCP_PROXY_AUTH_TOKEN=...`. Скопіюйте повну URL з консолі Inspector.

### Connection refused

MCP сервер не запущений. Перевірте:
```bash
curl -s "<MCP_URL>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```

### Port 6277 is already in use

Попередній Inspector не був зупинений.

**Рішення:**
```bash
# Знайти та зупинити процес
lsof -i :6277 -t | xargs kill
# Перезапустити Inspector
npx @modelcontextprotocol/inspector --url "$MCP_URL"
```

### Inspector не показує tools після підключення

Натисніть кнопку **List Tools** у вкладці Tools. Якщо tools не з'являються, перевірте History — `initialize` має бути успішним.

## Порівняння з curl

| Аспект | MCP Inspector | curl |
|--------|--------------|------|
| Візуальність | ✅ Веб-інтерфейс з формами | ❌ Тільки CLI |
| Швидкість тестування | ✅ Клік → результат | ❌ Копіювати JSON |
| Session management | ✅ Автоматичний | ❌ Ручний (Mcp-Session-Id) |
| Перегляд tools | ✅ Автовиявлення | ❌ tools/list вручну |
| Автоматизація | ❌ Тільки інтерактивно | ✅ Скрипти |
| CI/CD | ❌ Не підходить | ✅ Підходить |

## Підсумок

MCP Inspector — найзручніший спосіб інтерактивно тестувати MCP tools. Він автоматично виконує handshake, показує параметри tools у вигляді форм, і відображає результати у читабельному форматі. Ідеальний для розробки та дебагу, але не замінює curl/скрипти для автоматизації.

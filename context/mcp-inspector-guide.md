# Тестування Creatio MCP за допомогою MCP Inspector

MCP Inspector — офіційний візуальний інструмент для тестування MCP серверів. Він запускає веб-інтерфейс з формами, через який можна підключитись до MCP ендпоінту, переглянути доступні tools і виконати виклики без написання коду.

## Передумови

- **Node.js** >= 18 та **npx** (входить до Node.js)
- **Запущений Creatio** з MCP ендпоінтом (наприклад `http://localhost:5001/mcp`)
- Перевірити що сервер відповідає:
  ```bash
  curl -s http://localhost:5001/mcp \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
  ```
  Якщо бачите відповідь з `event: message` — сервер працює.

## Крок 1: Запуск Inspector

Відкрийте термінал і виконайте команду з параметром `--url`:

```bash
npx @modelcontextprotocol/inspector --url http://localhost:5001/mcp
```

> ⚠️ **Важливо:** Запускайте саме з `--url`, а не без параметрів. Це автоматично:
> - Встановить Transport Type на **Streamable HTTP**
> - Підставить правильну URL адресу
> - Згенерує auth токен для проксі

Inspector виведе в консолі:
```
⚙️ Proxy server listening on localhost:6277
🔑 Session token: abc123...
🚀 MCP Inspector is up and running at:
   http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=abc123...
```

Inspector запустить два сервери:
- **Web UI** — `http://localhost:6274` (відкрийте у браузері)
- **Proxy** — `http://localhost:6277` (проксі-сервер що обходить CORS обмеження браузера)

> Можна змінити порти через змінні середовища:
> ```bash
> CLIENT_PORT=8080 SERVER_PORT=9090 npx @modelcontextprotocol/inspector --url http://localhost:5001/mcp
> ```

## Крок 2: Відкрийте Inspector у браузері

Скопіюйте повну URL з консолі (з `?MCP_PROXY_AUTH_TOKEN=...`) і відкрийте у браузері. Або просто відкрийте `http://localhost:6274` — браузер може відкритись автоматично.

Ви побачите інтерфейс MCP Inspector:

```
┌─────────────────────┐  ┌──────────────────────────────────────┐
│ Transport Type      │  │                                      │
│ [Streamable HTTP ▾] │  │  Connect to an MCP server to start   │
│                     │  │  inspecting                          │
│ URL                 │  │                                      │
│ [http://localhost:5001/mcp]│                                      │
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
2. **URL** = адреса вашого Creatio MCP ендпоінту (наприклад `http://localhost:5001/mcp`)
3. **Connection Type** = `Via Proxy` (проксі обходить CORS)

## Крок 3: Підключення до MCP сервера

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

## Крок 4: Перегляд доступних Tools

1. Переконайтесь що вкладка **Tools** активна (вгорі)
2. Натисніть кнопку **List Tools**
3. Зліва з'явиться список всіх доступних MCP інструментів:

| Tool | Опис |
|------|------|
| `entity.get_schema_info` | Отримати UId та деталі існуючої entity схеми за іменем |
| `entity.list_parents` | Список доступних батьківських схем для наслідування |
| `entity.create` | Створення entity з колонками, повертає файли у відповіді |
| `entity.create_lookup` | Створення lookup entity, повертає файли у відповіді |
| `entity.check_name` | Перевірка чи ім'я entity вільне |

```
┌─ Tools ──────────────────────┐  ┌─ Select a tool ────────────┐
│ [List Tools] [Clear]          │  │ Select a tool from the     │
│                               │  │ list to view its details   │
│ entity.get_schema_info      ›│  │ and run it                 │
│ entity.list_parents         ›│  │                            │
│ entity.create               ›│  │                            │
│ entity.create_lookup        ›│  │                            │
│ entity.check_name           ›│  │                            │
└───────────────────────────────┘  └────────────────────────────┘
```

4. У History внизу з'явиться запис `3. tools/list`

## Крок 5: Тестування entity.check_name

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

## Крок 6: Тестування entity.create_lookup

Створення lookup entity (довідника):

1. У списку tools зліва натисніть на **entity.create_lookup**
2. Праворуч відкриється форма з полями:
   - **packageUId*** — GUID пакету (обов'язкове)
   - **name*** — ім'я entity (обов'язкове, має починатись з `Usr`)
   - **caption*** — відображуване ім'я (обов'язкове)
   - **outputPath** — шлях для запису файлів на диск (необов'язкове)
3. Заповніть:
   - **packageUId**: `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`
   - **name**: `UsrTestLookup`
   - **caption**: `Test Lookup`
   - **outputPath**: _(залиште порожнім — файли повернуться тільки у відповіді)_
4. Натисніть **Run Tool**
5. Результат:

```
Tool Result: Success

{
  entityName: "UsrTestLookup"
  files: {
    descriptor: "{ \"Descriptor\": { \"UId\": \"...\", ... } }"
    metadata: "= MetaData.Schema.UId \"...\" ..."
    properties: "{ \"Properties\": { ... } }"
  }
}
```

> Кожне поле `files` містить повний вміст відповідного файлу: `descriptor.json`, `metadata.json`, `properties.json`.

## Крок 7: Тестування entity.create з колонками

Створення entity з кастомними колонками — повний тест:

1. У списку tools зліва натисніть на **entity.create**
2. Праворуч відкриється форма з полями:
   - **packageUId*** — GUID пакету
   - **name*** — ім'я entity
   - **caption*** — відображуване ім'я
   - **parentSchemaName** — батьківська схема (за замовчуванням BaseEntity)
   - **columnsJson** — JSON масив визначень колонок
   - **outputPath** — шлях для запису на диск (необов'язкове)
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
5. Результат — JSON з трьома файлами. У metadata будуть всі 4 колонки.

> ⚠️ **columnsJson** — це рядок з JSON масивом. Вставляйте його в одну строку без переносів.

## Крок 8: Тестування entity.list_parents

Перегляд доступних батьківських схем:

1. Натисніть на **entity.list_parents** у списку
2. Форма не має параметрів — просто натисніть **Run Tool**
3. Побачите список parent schemas (BaseEntity, BaseLookup, тощо) з їх UId

## Крок 9: Тестування entity.get_schema_info

Отримання інформації про існуючу entity:

1. Натисніть на **entity.get_schema_info** у списку
2. У полі **name** введіть: `Contact`
3. Натисніть **Run Tool**
4. Побачите UId та деталі схеми Contact

## Крок 10: Тестування з outputPath (запис на диск серверу)

Якщо хочете перевірити що файли також записуються на диск серверу:

1. Оберіть `entity.create_lookup`
2. Заповніть ті ж параметри + додайте **outputPath**: `/tmp/test-mcp/UsrTestLookup`
3. Натисніть **Run Tool**
4. Результат міститиме ті ж файли у відповіді + файли будуть записані на диск серверу
5. Перевірте на сервері:
   ```bash
   ls -la /tmp/test-mcp/UsrTestLookup/
   # descriptor.json  metadata.json  properties.json
   ```

> 💡 Якщо outputPath не вказано — файли повертаються ТІЛЬКИ у JSON відповіді, на диск нічого не пишеться.

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

### "Connection Error - Did you add the proxy session token in Configuration?"

Inspector запущений без `--url` параметра або без auth токена.

**Рішення:** Перезапустіть Inspector з `--url`:
```bash
npx @modelcontextprotocol/inspector --url http://localhost:5001/mcp
```
І відкрийте URL з токеном з консолі: `http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=...`

### "Failed to fetch" (Connection Type = Direct)

CORS блокує прямий запит з браузера. Браузер не дозволяє cross-origin запити з `localhost:6274` до `localhost:5001`.

**Рішення:** Змініть Connection Type на **Via Proxy**. Проксі-сервер Inspector (порт 6277) обходить CORS.

### "Cannot POST /register" (Via Proxy без токена)

Проксі-сервер очікує auth токен але не отримав його.

**Рішення:** Переконайтесь що URL в браузері містить `?MCP_PROXY_AUTH_TOKEN=...`. Скопіюйте повну URL з консолі Inspector.

### Connection refused

MCP сервер не запущений. Перевірте:
```bash
curl -s http://localhost:5001/mcp \
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
npx @modelcontextprotocol/inspector --url http://localhost:5001/mcp
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

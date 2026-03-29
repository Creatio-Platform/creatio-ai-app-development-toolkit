# 03 — Clio MCP Server: Backend Optimization

> Historical design note. Any example payloads or response shapes here are proposals, not the authoritative executable contract. Resolve the current contract through `tool-contract-get`.

Оптимізація HTTP комунікації clio → Creatio backend.

---

## A4. Fix N+1 в `application-get-info`

**Складність:** 1 день | **Вплив:** 13+ HTTP → 4 HTTP для типового app

### Проблема

`ApplicationInfoService` робить окремий HTTP запит до Creatio для КОЖНОЇ entity schema:

```
1× SelectQuery          → знайти application by code/id
1× GetApplicationPackages → отримати primary package
1× SelectQuery          → знайти ApplicationEntity записи (список entities)
N× EntitySchemaService.svc/GetSchema → окремий запит на КОЖНУ entity
```

Для app з 10 entities = 13 HTTP запитів.
Для app з 50 entities = 53 HTTP запитів.

### Рішення

**Варіант 1 (рекомендований): Batch entity schema request**

Замість N окремих `GetSchema` — один запит з масивом UId:

```csharp
// До:
foreach (var entity in entities) {
    var schema = entitySchemaService.GetSchema(entity.UId);
    // HTTP POST для кожної entity
}

// Після:
var schemas = entitySchemaService.GetSchemasBatch(
    entities.Select(e => e.UId).ToList()
);
// Один HTTP POST з масивом
```

Якщо `EntitySchemaService` не підтримує batch — використати DataService SelectQuery з фільтром:

```json
{
  "rootSchemaName": "SysSchema",
  "operationType": 0,
  "filters": {
    "filterType": 6,
    "items": {
      "UIdFilter": {
        "filterType": 4,
        "comparisonType": 7,
        "leftExpression": {"columnPath": "UId"},
        "rightExpressions": [
          {"parameter": {"value": "guid-1"}},
          {"parameter": {"value": "guid-2"}}
        ]
      }
    }
  }
}
```

**Варіант 2: Parallel HTTP requests**

Якщо batch API недоступний — виконувати N запитів паралельно через `Task.WhenAll`:

```csharp
var tasks = entities.Select(e =>
    Task.Run(() => entitySchemaService.GetSchema(e.UId))
).ToList();
var schemas = await Task.WhenAll(tasks);
```

З 10 entities × 200ms = 2s послідовно → 200ms паралельно.

---

## A3. Batch HTTP в EntitySchemaCreator

**Складність:** 2 дні | **Вплив:** 6-8 HTTP → 2-3 HTTP на create-entity-schema

### Проблема

`RemoteEntitySchemaCreator` робить 6-8 послідовних HTTP запитів для створення одної entity:

```
1. CreateNewSchema
2. GetAvailableParentSchemas  ← можна кешувати
3. AssignParentSchema
4. GetAvailableReferenceSchemas  ← можна кешувати
5. SaveSchema
6. SaveSchemaDbStructure
7. GetRuntimeEntitySchema
8. GetSchemaDesignItem  ← можна видалити якщо не потрібно
```

### Рішення

1. **Кешувати `GetAvailableParentSchemas`** — список батьківських схем рідко змінюється. Один раз на сесію.
2. **Кешувати `GetAvailableReferenceSchemas`** — аналогічно.
3. **Об'єднати `CreateNewSchema` + `AssignParentSchema` + `SaveSchema`** — якщо API дозволяє створити schema з parent в одному POST.
4. **Видалити `GetSchemaDesignItem`** — якщо result не використовується downstream.

Мінімальний результат: 6-8 HTTP → 3-4 HTTP.

---

## HTTP Connection Optimization

**Складність:** 4 години | **Вплив:** -50-100ms на кожний HTTP запит

### Проблема

clio не налаштовує HTTP connection pooling явно:
- Кожний `ExecutePostRequest` може створювати нове TCP з'єднання
- Немає HTTP Keep-Alive headers
- Немає `ServicePointManager` конфігурації
- TLS handshake повторюється (~50-100ms)

### Рішення

```csharp
// В BindingsModule або при створенні IApplicationClient:
var handler = new HttpClientHandler {
    MaxConnectionsPerServer = 10,
    UseProxy = false
};

var client = new HttpClient(handler) {
    DefaultRequestHeaders = {
        ConnectionClose = false  // Keep-Alive
    },
    Timeout = TimeSpan.FromSeconds(120)
};
```

Або через `ServicePointManager` (legacy .NET):
```csharp
ServicePointManager.DefaultConnectionLimit = 10;
ServicePointManager.Expect100Continue = false;
```

### Очікуваний ефект

Перший запит: без змін. Наступні запити до того ж host: -50-100ms (TCP reuse).
Для session з 20+ HTTP запитами до Creatio: ~1-2s економії.

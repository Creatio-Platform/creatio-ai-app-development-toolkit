# 05 — MCP Protocol: Extended Capabilities

> Historical design note. Any example payloads or response shapes here are proposals, not the authoritative executable contract. Resolve the current contract through `tool-contract-get`.

Використання можливостей MCP протоколу поза tools: Resources, Prompts, Subscriptions.

---

## Поточний стан

Clio MCP server **вже реалізує**:
- ✅ 45 Tools — активно використовуються
- ✅ 28 Prompts — НЕ використовуються Python client
- ✅ 4 Resources — НЕ використовуються Python client  
- ✅ Progress notifications — НЕ використовуються Python client
- ✅ Tool metadata (ReadOnly, Destructive, Idempotent) — НЕ використовуються

Python client (`mcp_client.py`) викликає тільки:
- `initialize`
- `tools/call`

---

## C1. MCP Resource для application context

**Складність:** 4 години | **Вплив:** bypass BaseTool lock/sleep, -1.5s

### Мотивація

`application-get-info` — read-only операція, але проходить через BaseTool з його:
- `Thread.Sleep(500)` 
- Global lock
- Full command resolution pipeline

MCP Resources обслуговуються напряму через resource handler — **без BaseTool overhead**.

### Реалізація (clio)

```csharp
[McpServerResourceType]
public class ApplicationContextResource(IApplicationInfoService infoService) {
    
    [McpServerResource(
        UriTemplate = "context://app/{environmentName}/{appCode}",
        Name = "Application Context",
        MimeType = "application/json")]
    [Description("Returns full application context with entities, columns, and pages")]
    public ResourceContents GetApplicationContext(
        string environmentName, string appCode) {
        
        var result = infoService.GetApplicationInfo(environmentName, null, appCode);
        var mapped = ApplicationToolResultMapper.Map(result);
        var json = JsonSerializer.Serialize(mapped, new JsonSerializerOptions {
            WriteIndented = false,
            PropertyNamingPolicy = JsonNamingPolicy.KebabCaseLower
        });
        return new TextResourceContents(json, "application/json");
    }
}
```

### Використання (Python client)

```python
# Замість:
r = call_mcp_tool('application-get-info', {
    'environment-name': 'local', 'app-code': 'UsrTodoList'
})

# Тепер:
context = client.read_resource('context://app/local/UsrTodoList')
```

### Переваги

1. **Без lock** — resources не проходять через BaseTool
2. **Без sleep** — немає Thread.Sleep(500)
3. **Кешування** — MCP протокол підтримує ETags для resources
4. **Семантика** — read-only доступ через read-only API

---

## C2. MCP Resource для entity schema

**Складність:** 4 години | **Вплив:** заміна get-columns tool call

### Реалізація

```csharp
[McpServerResource(
    UriTemplate = "schema://entity/{environmentName}/{schemaName}",
    Name = "Entity Schema")]
public ResourceContents GetEntitySchema(
    string environmentName, string schemaName) {
    
    var columns = bindingService.GetColumns(environmentName, schemaName);
    return new TextResourceContents(
        JsonSerializer.Serialize(columns), "application/json");
}
```

Використання:
```python
schema = client.read_resource('schema://entity/local/UsrTodoList')
```

---

## C3. Resource subscriptions для live context updates

**Складність:** 2 дні | **Вплив:** eliminates polling/refresh calls

### Ідея

Після мутації entity (create-lookup, update-entity-schema) clio надсилає notification що ресурс змінився:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/resources/updated",
  "params": {
    "uri": "context://app/local/UsrTodoList"
  }
}
```

Python client отримує notification і автоматично оновлює кешований контекст.

### Реалізація (clio)

В EntitySchemaTool, після успішної мутації:
```csharp
// Після успішного create-lookup або update-entity:
await server.SendNotificationAsync("notifications/resources/updated", new {
    uri = $"context://app/{envName}/{appCode}"
});
```

### Реалізація (Python client)

```python
class PersistentMcpClient:
    def __init__(self):
        self._resource_cache = {}
        self._resource_callbacks = {}
    
    def subscribe_resource(self, uri, callback):
        self._resource_callbacks[uri] = callback
    
    def _handle_notification(self, parsed):
        if parsed.get("method") == "notifications/resources/updated":
            uri = parsed["params"]["uri"]
            if uri in self._resource_cache:
                del self._resource_cache[uri]
            if uri in self._resource_callbacks:
                self._resource_callbacks[uri](uri)
```

---

## B5. Consume MCP Prompts

**Складність:** 4 години | **Вплив:** maintenance, менше помилок

### Мотивація

28 MCP Prompts вже існують в clio. Кожний prompt містить:
- Правильні назви параметрів
- Рекомендовані значення
- Обмеження та правила використання

Замість хардкоду цих правил в Python скриптах і agent md файлах — отримувати від серверу.

### Існуючі prompts в clio

| Prompt | Tool | Зміст |
|--------|------|-------|
| `create-entity-schema` | EntitySchema | Параметри, parent schema rules |
| `create-lookup` | EntitySchema | BaseLookup специфіка |
| `update-entity-schema` | EntitySchema | Operations format, column types |
| `create-data-binding-db` | DataBindingDb | Rows format, binding rules |
| `page-get` | PageGet | Schema name resolution |
| `page-update` | PageUpdate | Body format, dry-run usage |
| ... | ... | 22 інших |

### Реалізація (Python client)

```python
def list_prompts(self):
    return self._send_and_receive("prompts/list", {})

def get_prompt(self, name, arguments=None):
    return self._send_and_receive("prompts/get", {
        "name": name,
        "arguments": arguments or {}
    })
```

### Використання в workflow

```python
# Перед першим create-lookup:
guidance = client.get_prompt("create-lookup", {
    "environmentName": "local",
    "packageName": "UsrTodoList",
    "schemaName": "UsrTodoStatus"
})
# guidance.messages[0].content містить правила для LLM
```

### Переваги

1. **Single source of truth** — параметри визначаються в clio, не дублюються в agent інструкціях
2. **Auto-update** — коли clio оновлює tool, prompt оновлюється автоматично
3. **Менше 460 рядків** дублікатів в agent md файлах можна видалити
4. **LLM отримує актуальні інструкції** — навіть якщо agent md файли застаріли

---

## Зведена таблиця

| Feature | Clio | Python Client | Поточний стан | Після |
|---------|------|--------------|---------------|-------|
| Tools | 45 tools | `tools/call` | ✅ Використовується | ✅ |
| Resources | 4 resources | — | ❌ Не використовується | ✅ resources/read |
| Prompts | 28 prompts | — | ❌ Не використовується | ✅ prompts/get |
| Progress | start/stop tools | — | ❌ Не використовується | ✅ callback |
| Subscriptions | — | — | ❌ Не існує | ✅ notifications |
| Tool metadata | annotations | — | ❌ Ігнорується | ✅ retry strategy |

# MCP Testing Guide — Програматичне тестування

> 💡 **Для візуального UI-тестування** дивіться [`context/mcp-inspector-guide.md`](../context/mcp-inspector-guide.md) (MCP Inspector)

Цей документ описує **програматичне** тестування MCP tools через Python/curl для автоматизації та CI/CD.

## Ключові моменти

### 1. HTTP Basic Authentication
MCP endpoint вимагає HTTP Basic Auth:
```python
AUTH = ("Supervisor", "Supervisor")
requests.post(MCP_URL, auth=AUTH, ...)
```

### 2. Session Management
**КРИТИЧНО:** Після `initialize` сервер повертає `Mcp-Session-Id` в **headers**, НЕ в body!

```python
# ❌ WRONG
session_id = response.json()["result"]["sessionId"]

# ✅ CORRECT
session_id = response.headers.get("Mcp-Session-Id")
```

### 3. SSE Response Format
MCP повертає відповіді у форматі **Server-Sent Events** (Content-Type: `text/event-stream`):

```
event: message
data: {"result": {...}}
```

**Парсинг:**
```python
if "text/event-stream" in response.headers.get("Content-Type", ""):
    lines = response.text.strip().split("\n")
    for line in lines:
        if line.startswith("data: "):
            json_data = json.loads(line[6:])  # Skip "data: " prefix
            break
```

### 4. MCP Protocol Flow

#### Step 1: Initialize
```python
response = requests.post(
    "http://localhost:5001/mcp",
    auth=AUTH,
    headers={"Content-Type": "application/json"},
    json={
        "jsonrpc": "2.0",
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "test-client", "version": "1.0"}
        },
        "id": 1
    }
)

session_id = response.headers.get("Mcp-Session-Id")
```

#### Step 2: List Tools
```python
response = requests.post(
    "http://localhost:5001/mcp",
    auth=AUTH,
    headers={
        "Content-Type": "application/json",
        "Mcp-Session-Id": session_id  # ← REQUIRED!
    },
    json={
        "jsonrpc": "2.0",
        "method": "tools/list",
        "params": {},
        "id": 2
    }
)
```

#### Step 3: Call Tool
```python
response = requests.post(
    "http://localhost:5001/mcp",
    auth=AUTH,
    headers={
        "Content-Type": "application/json",
        "Mcp-Session-Id": session_id  # ← REQUIRED!
    },
    json={
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {
            "name": "application.create",
            "arguments": {
                "name": "My App",
                "code": "UsrMyApp",
                "description": "Test",
                "templateCode": "AppFreedomUIv2",
                "iconBackground": "#0052CC"
            }
        },
        "id": 3
    }
)
```

### 5. Tool Response Format
Інструменти повертають результат в `result.content[0].text` як JSON string:

```python
response_data = parse_sse(response)  # {"result": {"content": [...]}}
content = response_data["result"]["content"]
text = content[0]["text"]  # JSON string
result = json.loads(text)  # {"success": true, "app": {...}}
```

## Доступні інструменти

| Tool | Опис |
|------|------|
| `application.create` | Створення повного застосунку в БД |
| `application.get_list` | Список існуючих applications |
| `application.get_info` | Інфо про application з БД |
| `entity.get_schema_info` | UId та деталі існуючої entity схеми |
| `entity.create` | Створення entity з колонками |
| `entity.create_lookup` | Створення lookup entity |
| `entity.update` | Оновлення entity через операції |
| `entity.list_parents` | Список батьківських схем |
| `entity.check_name` | Перевірка унікальності імені |
| `binding.get_columns` | Колонки та UId для існуючої schema |
| `binding.create` | DB-first створення або оновлення binding records з негайною інсталяцією даних |

## Приклади тестових скриптів

### Базовий тест одного інструменту
Див. `test_application_create_fix.py`

### Повний набір тестів всіх інструментів
Див. `test_all_mcp_tools.py`

## Типові помилки

### HTTP 400 Bad Request
**Причина:** Не передано `Mcp-Session-Id` в headers після initialize

**Рішення:**
```python
headers = {
    "Content-Type": "application/json",
    "Mcp-Session-Id": session_id  # ← Додати цей header!
}
```

### "AUTH_REQUIRED" error
**Причина:** `RequestUserConnection` = null (McpAuthenticationMiddleware не спрацював)

**Рішення:** Перевірити Basic Auth credentials

### Actor System error "Failed to get context"
**Причина (ВИРІШЕНО):** `HttpContext.Items["CurrentWebOperationIdentityName"]` не встановлений

**Рішення:** Оновити до версії з виправленням в `McpAuthenticationMiddleware.cs` (lines 96-97)

## Порівняння з MCP Inspector

| Аспект | Програматичне (curl/Python) | MCP Inspector |
|--------|---------------------------|--------------|
| Візуальність | ❌ Тільки CLI | ✅ Веб-інтерфейс |
| Швидкість тестування | ❌ Писати код | ✅ Клік → результат |
| Автоматизація | ✅ Скрипти, CI/CD | ❌ Тільки інтерактивно |
| Дебаг | ✅ Повний контроль | ✅ History з JSON |
| Використання | Автотести, CI/CD, скрипти | Розробка, дебаг, demo |

## Дивіться також

- **[MCP Inspector Guide](../context/mcp-inspector-guide.md)** — візуальне тестування через веб-UI
- `test_application_create_fix.py` — приклад тесту application.create
- `test_all_mcp_tools.py` — тест всіх доступних інструментів

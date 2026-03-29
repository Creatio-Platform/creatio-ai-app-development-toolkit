# 01 — Clio MCP Server: Quick Wins

> Historical design note. Any example payloads or response shapes here are proposals, not the authoritative executable contract. Resolve the current contract through `tool-contract-get`.

Миттєві покращення швидкодії без зміни API.

---

## A1. Видалити `Thread.Sleep(500)` з BaseTool

**Складність:** 5 хвилин | **Вплив:** -7s на сесію (14 calls × 500ms)

### Проблема

`BaseTool.cs:64` — кожний tool call має примусову паузу 500ms після виконання:

```csharp
// BaseTool.cs, рядок 56-85
private protected virtual CommandExecutionResult InternalExecute(Command<T> command, T options) {
    int result = -1;
    lock (CommandExecutionLock) {
        // ...
        result = command.Execute(options);
        Thread.Sleep(500);  // ← 500ms ПІСЛЯ кожного виконання
        // ...
    }
}
```

**Зачеплені tools (27 класів через наслідування BaseTool):**
- EntitySchemaTool (create, create-lookup, update, get-properties)
- DataBindingDbTool (create, upsert, remove)
- DataBindingTool (create, add-row, remove-row)
- PageGetTool, PageUpdateTool, PageListTool
- ClearRedisTool, RestartTool, StartTool, StopTool
- CompileCreatioTool, FsmModeTool, та інші

**НЕ зачеплені (не наслідують BaseTool):**
- ApplicationGetListTool, ApplicationGetInfoTool, ApplicationCreateTool

Також є окремі sleep в:
- `CompileCreatioTool.cs:78` — `Thread.Sleep(500)`
- `AddItemModelTool.cs:73` — `Thread.Sleep(500)`

### Рішення

**Варіант 1 (рекомендований): Видалити повністю**

```csharp
private protected virtual CommandExecutionResult InternalExecute(Command<T> command, T options) {
    int result = -1;
    lock (CommandExecutionLock) {
        dbOperationLogContextAccessor?.ClearLastCompletedPath();
        bool previousPreserveMessages = logger.PreserveMessages;
        logger.PreserveMessages = true;
        try {
            result = command.Execute(options);
            CommandExecutionResult returnResult = new(
                result,
                [.. logger.LogMessages.ToList()],
                dbOperationLogContextAccessor?.LastCompletedPath);
            logger.ClearMessages();
            return returnResult;
        }
        catch (Exception e) {
            List<LogMessage> logMessages = [.. logger.LogMessages, new ErrorMessage(e.Message)];
            CommandExecutionResult returnResult = new(
                result,
                logMessages,
                dbOperationLogContextAccessor?.LastCompletedPath);
            logger.ClearMessages();
            return returnResult;
        }
        finally {
            logger.PreserveMessages = previousPreserveMessages;
        }
    }
}
```

Логи збираються через `logger.LogMessages` синхронно — sleep не потрібен для їх збору.

**Варіант 2 (safety net): Configurable через env var**

```csharp
result = command.Execute(options);
int delay = int.TryParse(
    Environment.GetEnvironmentVariable("CLIO_MCP_POST_EXEC_DELAY_MS"), out var d) ? d : 0;
if (delay > 0) Thread.Sleep(delay);
```

### Тестування

Запустити 50+ tool calls підряд через `mcp_client.py` і перевірити:
- Чи всі `logger.LogMessages` збираються коректно
- Чи `dbOperationLogContextAccessor?.LastCompletedPath` повертає правильне значення
- Чи відповіді MCP містять повні лог-повідомлення

### Ризики

- Sleep може бути workaround для race condition в async log writing.
  Мітигація: `logger.LogMessages` — синхронний виклик, race condition малоймовірний.

---

## A2. Per-environment lock замість global static lock

**Складність:** 2-4 години | **Вплив:** розблокує паралельне виконання tools

### Проблема

`BaseTool.cs:16,58` — один статичний lock на ВСІ tool-и:

```csharp
private static readonly object CommandExecutionLock = new();
// ...
lock (CommandExecutionLock) {
    // Тільки ОДИН tool може виконуватися одночасно
}
```

Навіть read-only tools (page-list, page-get) блокують write tools.
Навіть tools для РІЗНИХ environments блокують один одного.

### Рішення

**Мінімальний варіант: per-environment lock**

```csharp
private static readonly ConcurrentDictionary<string, object> _envLocks = new();

private static object GetLock(string envName) =>
    _envLocks.GetOrAdd(envName ?? "__default__", _ => new object());

private protected virtual CommandExecutionResult InternalExecute(Command<T> command, T options) {
    string envName = (options as EnvironmentOptions)?.Environment ?? "__default__";
    int result = -1;
    lock (GetLock(envName)) {
        // ... existing code without Thread.Sleep ...
    }
}
```

**Розширений варіант: reader-writer lock**

```csharp
private static readonly ConcurrentDictionary<string, ReaderWriterLockSlim> _envLocks = new();

// Read-only tools (page-get, page-list, get-info):
_envLocks[env].EnterReadLock();

// Write tools (create, update, delete):
_envLocks[env].EnterWriteLock();
```

Потребує маркування tools як read/write (вже існує через `[McpServerTool(ReadOnly = true/false)]`).

### Залежності

- `logger` (ILogger) — перевірити thread safety. Якщо `LogMessages` — не thread-safe list, потрібен `ConcurrentBag<LogMessage>` або per-execution logger instance.
- `dbOperationLogContextAccessor` — перевірити чи контекст scoped per-call чи shared.

### Тестування

- Запустити 2+ MCP clients до одного clio server з різними environments — переконатися що tools виконуються паралельно
- Запустити concurrent calls до одного environment — переконатися що lock працює коректно
- Перевірити що log messages не перемішуються між concurrent calls

### Ризики

- Logger може мати shared mutable state. Якщо так — виділити per-execution logger scope.
- Рекомендовано починати з per-environment (не per-tool) — це безпечніший крок.

---

## A5. Enriched responses для entity mutations

**Складність:** 1 день | **Вплив:** -3s (eliminates mandatory get-info after each mutation)

### Проблема

Після кожної entity мутації (create-lookup, update-entity-schema) клієнт ОБОВ'ЯЗКОВО робить `application-get-info` щоб отримати оновлений стан schema. Це +1 HTTP call (2-3s) після кожної мутації.

Поточна відповідь `create-lookup`:
```json
{"success": true}
```

### Рішення

Повертати оновлений стан entity в відповіді:

```json
{
  "success": true,
  "entity": {
    "u-id": "1f82a57a-fd9d-4de3-82eb-285d912e98cd",
    "name": "UsrTodoStatus",
    "caption": "Todo Status",
    "columns": [
      {"name": "Id", "data-value-type": "Guid"},
      {"name": "Name", "caption": "Name", "data-value-type": "MEDIUM_TEXT"},
      {"name": "Description", "caption": "Description", "data-value-type": "MEDIUM_TEXT"}
    ]
  }
}
```

Зміни в clio:
1. `EntitySchemaTool` — після `InternalExecute`, додати `GetRuntimeEntitySchema` і включити в response
2. Те саме для `CreateEntitySchemaCommand` response
3. Python client (`mcp_schema_sync.py`) — використовувати entity з response замість окремого get-info

### Зворотна сумісність

Нові поля додаються до існуючої response — старі клієнти ігнорують їх. Безпечно.

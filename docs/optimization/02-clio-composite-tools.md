# 02 — Clio MCP Server: Composite Tools

Нові tools що об'єднують кілька операцій в один MCP call.

---

## A6. Composite tool: `schema-sync`

**Складність:** 2-3 дні | **Вплив:** 5 calls → 1 call (-4.5s)

### Мотивація

Типовий schema sync для нового app:
```
1. create-lookup UsrTodoStatus        (500ms sleep + lock + 6-8 HTTP)
2. create-data-binding-db seed Status (500ms sleep + lock + N HTTP)
3. create-lookup UsrTodoPriority      (500ms sleep + lock + 6-8 HTTP)
4. create-data-binding-db seed Priority (500ms sleep + lock + N HTTP)
5. update-entity-schema UsrTodoList   (500ms sleep + lock + HTTP)
```

5 окремих MCP calls × (500ms sleep + lock acquisition + MCP overhead) = ~7.5s

### API Design

```csharp
[McpServerTool(Name = "schema-sync", ReadOnly = false, Destructive = true,
    Idempotent = false, OpenWorld = false)]
[Description("Executes a batch of schema operations in a single call: " +
    "create lookups, seed data, create entities, update entities.")]
public SchemaSyncResponse SchemaSync(
    [Required] SchemaSyncArgs args)
```

Input shape:
```json
{
  "environment-name": "local",
  "package-name": "UsrTodoList",
  "operations": [
    {
      "type": "create-lookup",
      "schema-name": "UsrTodoStatus",
      "title": "Todo Status",
      "parent-schema-name": "BaseLookup",
      "seed-rows": [
        {"values": {"Id": "guid-1", "Name": "New"}},
        {"values": {"Id": "guid-2", "Name": "In Progress"}},
        {"values": {"Id": "guid-3", "Name": "Done"}}
      ]
    },
    {
      "type": "create-lookup",
      "schema-name": "UsrTodoPriority",
      "title": "Todo Priority",
      "parent-schema-name": "BaseLookup",
      "seed-rows": [
        {"values": {"Name": "Low"}},
        {"values": {"Name": "Medium"}},
        {"values": {"Name": "High"}}
      ]
    },
    {
      "type": "update-entity",
      "schema-name": "UsrTodoList",
      "columns": [
        {"action": "add", "column-name": "UsrStatus", "data-value-type": "Lookup",
         "lookup-schema": "UsrTodoStatus", "required": true,
         "default-value": "guid-1", "default-value-source": "Const"},
        {"action": "add", "column-name": "UsrPriority", "data-value-type": "Lookup",
         "lookup-schema": "UsrTodoPriority"},
        {"action": "add", "column-name": "UsrDueDate", "data-value-type": "Date"},
        {"action": "add", "column-name": "UsrNotes", "data-value-type": "MAX_SIZE_TEXT"}
      ]
    }
  ]
}
```

Response shape:
```json
{
  "success": true,
  "results": [
    {"operation": "create-lookup", "schema-name": "UsrTodoStatus", "success": true,
     "entity": {"u-id": "...", "columns": [...]}},
    {"operation": "seed-data", "schema-name": "UsrTodoStatus", "success": true, "rows-created": 3},
    {"operation": "create-lookup", "schema-name": "UsrTodoPriority", "success": true,
     "entity": {"u-id": "...", "columns": [...]}},
    {"operation": "seed-data", "schema-name": "UsrTodoPriority", "success": true, "rows-created": 3},
    {"operation": "update-entity", "schema-name": "UsrTodoList", "success": true,
     "entity": {"u-id": "...", "columns": [...]}}
  ]
}
```

### Реалізація

```csharp
public class SchemaSyncTool {
    public SchemaSyncResponse SchemaSync(SchemaSyncArgs args) {
        var results = new List<SchemaSyncOperationResult>();
        
        foreach (var op in args.Operations) {
            try {
                var result = op.Type switch {
                    "create-lookup" => ExecuteCreateLookup(op, args),
                    "update-entity" => ExecuteUpdateEntity(op, args),
                    _ => throw new ArgumentException($"Unknown operation type: {op.Type}")
                };
                results.Add(result);
                
                if (op.SeedRows?.Any() == true) {
                    var seedResult = ExecuteSeedData(op, args);
                    results.Add(seedResult);
                }
            } catch (Exception ex) {
                results.Add(new SchemaSyncOperationResult {
                    Operation = op.Type, SchemaName = op.SchemaName,
                    Success = false, Error = ex.Message
                });
                break; // Stop on first failure — subsequent ops may depend on this one
            }
        }
        
        return new SchemaSyncResponse { Success = results.All(r => r.Success), Results = results };
    }
}
```

Ключова відмінність від серії окремих calls:
- **Один lock acquisition** замість 5
- **Нуль Thread.Sleep** між операціями (sleep тільки в кінці, якщо залишиться)
- **Один MCP round-trip** замість 5 (JSON-RPC overhead)
- **Shared DI context** — command resolution кешується

### Зворотна сумісність

Atomic tools (create-lookup, update-entity-schema, create-data-binding-db) залишаються для backward compatibility і для одиночних операцій.

---

## A7. Composite tool: `page-sync`

**Складність:** 1-2 дні | **Вплив:** 9 calls → 1 call (-8.7s)

### Мотивація

Типовий page sync для нового app (2 сторінки):
```
1. page-list (знайти сторінки)           — 500ms sleep + 1 HTTP
2. page-get FormPage                      — 500ms sleep + 2 HTTP
3. page-update FormPage (dry-run)         — 500ms sleep + 1 HTTP
4. page-update FormPage (save)            — 500ms sleep + 3 HTTP
5. page-get FormPage (verify)             — 500ms sleep + 2 HTTP
6. page-get ListPage                      — 500ms sleep + 2 HTTP
7. page-update ListPage (dry-run)         — 500ms sleep + 1 HTTP
8. page-update ListPage (save)            — 500ms sleep + 3 HTTP
9. page-get ListPage (verify)             — 500ms sleep + 2 HTTP
```

9 MCP calls × 500ms = 4.5s sleep + 17 HTTP requests + 9 lock acquisitions.

### API Design

```json
{
  "environment-name": "local",
  "package-name": "UsrTodoList",
  "pages": [
    {
      "schema-name": "UsrTodoList_FormPage",
      "body": "define(\"UsrTodoList_FormPage\", ...full page body...)"
    },
    {
      "schema-name": "UsrTodoList_ListPage",
      "body": "define(\"UsrTodoList_ListPage\", ...full page body...)"
    }
  ],
  "validate": true,
  "verify": true
}
```

Response:
```json
{
  "success": true,
  "pages": [
    {
      "schema-name": "UsrTodoList_FormPage",
      "success": true,
      "body-length": 3775,
      "validation": {"markers-ok": true, "js-syntax-ok": true}
    },
    {
      "schema-name": "UsrTodoList_ListPage",
      "success": true,
      "body-length": 2181,
      "validation": {"markers-ok": true, "js-syntax-ok": true}
    }
  ]
}
```

### Реалізація

Internally: list pages once → for each page: get → validate body → save → verify.

Ключові оптимізації:
- **page-list** виконується один раз
- **Validation** (маркери + JS syntax) виконується на клієнтській стороні clio без HTTP
- **Dry-run стає optional** — server-side validation замінює окремий dry-run call
- **Один lock** на весь batch

### Додаткова можливість: паралельний page sync

Якщо A2 (per-environment reader-writer lock) реалізований, page update для різних сторінок можна виконувати паралельно:

```csharp
var tasks = args.Pages.Select(page =>
    Task.Run(() => SyncSinglePage(page, envClient))
).ToList();
await Task.WhenAll(tasks);
```

Це зменшить час з суми всіх page update-ів до максимуму одного.

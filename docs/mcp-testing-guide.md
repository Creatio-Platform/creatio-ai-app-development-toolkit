# MCP Testing Guide — Програматичне тестування

> Для візуального UI-тестування дивіться [`context/mcp-inspector-guide.md`](../context/mcp-inspector-guide.md).

Цей документ описує програматичне тестування released clio MCP contract через `scripts/mcp_client.py`.

## Базові правила

- Підтримуваний runtime: released `clio` `8.0.2.37+`
- `CLIO_CMD` можна використовувати лише як override шляху до сумісного `clio`
- Виконання MCP іде через clio stdio, не через HTTP/SSE
- Для реальних викликів використовуйте `python3 scripts/mcp_client.py ...`
- Назви tools у dash-style: `application-create`, `application-get-list`, `application-get-info`, `schema-sync`, `page-sync`, `page-list`, `page-get`, `page-update`
- Аргументи entity/page tools у kebab-case

## Швидка перевірка середовища

```bash
clio ver
python3 scripts/mcp_client.py tools/list '{}' 30
python3 scripts/mcp_client.py application-get-list '{"environment-name":"local"}' 30
```

Очікування:
- `clio ver` повертає `8.0.2.37` або новіше
- `tools/list` повертає non-empty manifest
- `application-get-list` повертає `success: true`

## Типові виклики

### Отримати manifest tools

```bash
python3 scripts/mcp_client.py tools/list '{}' 30
```

### Отримати список applications

```bash
python3 scripts/mcp_client.py application-get-list '{"environment-name":"local"}' 30
```

### Отримати application context

```bash
python3 scripts/mcp_client.py application-get-info '{
  "environment-name":"local",
  "app-code":"UsrTodoList"
}' 30
```

### Батч schema sync

```bash
python3 scripts/mcp_client.py schema-sync '{
  "environment-name":"local",
  "package-name":"UsrTodoList",
  "operations":[
    {
      "type":"create-lookup",
      "schema-name":"UsrTodoStatus",
      "title":"Todo Status"
    },
    {
      "type":"update-entity",
      "schema-name":"UsrTodoList",
      "update-operations":[
        {
          "action":"add",
          "column-name":"UsrStatus",
          "type":"Lookup",
          "title":"Status",
          "reference-schema-name":"UsrTodoStatus"
        }
      ]
    }
  ]
}' 120
```

### Батч page sync

```bash
python3 scripts/mcp_client.py page-sync '{
  "environment-name":"local",
  "pages":[
    {
      "schema-name":"UsrTodoList_FormPage",
      "body":"define(...)"
    }
  ],
  "validate":true,
  "verify":true
}' 120
```

## Очікувані формати відповіді

### `application-get-list`

```json
{
  "success": true,
  "applications": [
    {
      "id": "7030c825-59bd-49c6-8a6b-5ff260687a87",
      "code": "UsrEvents",
      "name": "Events"
    }
  ]
}
```

### `application-get-info`

```json
{
  "success": true,
  "package-u-id": "597944b2-c71f-4cdb-9510-0216c1e214a6",
  "package-name": "UsrTodoList",
  "entities": [
    {
      "uId": "32ccd416-a6c7-4eeb-bae0-46403f18c457",
      "name": "UsrTodoList",
      "caption": "Todo"
    }
  ]
}
```

## Перевірки після schema/page sync

- Після `schema-sync` обов’язково викличте `application-get-info`
- Після `page-sync` перевірте, що всі page results мають `success: true`
- Якщо потрібна детальна перевірка сторінок, дочитайте сторінки через `page-get`
- Якщо `tools/list` не містить `schema-sync`, `page-sync` або `component-info`, вважайте встановлений `clio` несумісним

## Типові помилки

### Unsupported clio version

Причина:
- встановлено `clio` старіше за `8.0.2.37`

Рішення:
- оновити `clio`
- або вказати сумісний released binary через `CLIO_CMD`

### `tools/list` повертає помилку або порожній manifest

Причина:
- використовується несумісна версія `clio`
- `clio mcp-server` не запускається коректно

Рішення:
- перевірити `clio ver`
- перевірити `python3 scripts/mcp_client.py tools/list '{}' 30`

### Generic `An error occurred invoking ...`

Причина:
- неправильні назви параметрів
- старий payload contract

Рішення:
- перевірити dash-style tool name
- перевірити kebab-case аргументи
- для `update-entity-schema` передавати native list у `operations`
- для `page-update` передавати `dry-run`, а не `dryRun`

## Дивіться також

- [`context/mcp-application-tools-reference.md`](../context/mcp-application-tools-reference.md)
- [`context/mcp-inspector-guide.md`](../context/mcp-inspector-guide.md)

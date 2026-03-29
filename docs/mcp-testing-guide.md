# MCP Testing Guide — Програматичне тестування

> Для візуального UI-тестування дивіться [`context/mcp-inspector-guide.md`](../context/mcp-inspector-guide.md).

Цей документ описує програматичне тестування released clio MCP contract через `scripts/mcp_client.py`.
Executable contract визначається тільки `clio MCP` через `tool-contract-get`; цей документ описує спосіб перевірки, а не локальний API reference.

## Базові правила

- Підтримуваний runtime: released `clio` `8.0.2.37+`
- `CLIO_CMD` можна використовувати лише як override шляху до сумісного `clio`
- Виконання MCP іде через clio stdio, не через HTTP/SSE
- Для реальних викликів використовуйте `python3 scripts/mcp_client.py ...`
- Для JSON-heavy payloads використовуйте `--args-file` або `--args-stdin`, а не inline quoting
- Спочатку перевіряйте manifest через `tools/list`, а executable contract через `tool-contract-get`
- `application-create` лишається scalar-only; localization maps для captions не передаються сюди, а робляться окремими schema tools після створення app shell
- Canonical entity flow: `application-create -> schema-sync -> application-get-info`
- Canonical page flow: `page-list -> page-get -> page-sync -> page-get`
- `page-update` лишається тільки fallback path для single-page dry-run або legacy save

## Швидка перевірка середовища

```bash
clio ver
printf '{"environment-name":"local"}\n' > /tmp/application-get-list.args.json
python3 scripts/mcp_client.py tools/list '{}' 30
python3 scripts/mcp_client.py tool-contract-get '{}' 30
python3 scripts/mcp_client.py application-get-list --args-file /tmp/application-get-list.args.json --timeout 30
```

```powershell
@'{"environment-name":"local"}'@ | Set-Content -Path .\application-get-list.args.json
py -3 .\scripts\mcp_client.py tools/list '{}' 30
py -3 .\scripts\mcp_client.py tool-contract-get '{}' 30
py -3 .\scripts\mcp_client.py application-get-list --args-file .\application-get-list.args.json --timeout 30
```

Очікування:
- `clio ver` повертає `8.0.2.37` або новіше
- `tools/list` повертає non-empty manifest
- `tool-contract-get` повертає metadata хоча б для `application-create`, `schema-sync`, `page-sync`
- `application-get-list` повертає `success: true`

## Типові виклики

### Отримати manifest tools

```bash
python3 scripts/mcp_client.py tools/list '{}' 30
```

```powershell
py -3 .\scripts\mcp_client.py tools/list '{}' 30
```

### Отримати executable contract metadata

```bash
python3 scripts/mcp_client.py tool-contract-get '{}' 30
```

```powershell
py -3 .\scripts\mcp_client.py tool-contract-get '{}' 30
```

### Отримати список applications

```bash
printf '{"environment-name":"local"}\n' > /tmp/application-get-list.args.json
python3 scripts/mcp_client.py application-get-list --args-file /tmp/application-get-list.args.json --timeout 30
```

```powershell
@'{"environment-name":"local"}'@ | Set-Content -Path .\application-get-list.args.json
py -3 .\scripts\mcp_client.py application-get-list --args-file .\application-get-list.args.json --timeout 30
```

### Отримати application context

```bash
cat <<'EOF' > /tmp/application-get-info.args.json
{"environment-name":"local","app-code":"UsrTodoList"}
EOF
python3 scripts/mcp_client.py application-get-info --args-file /tmp/application-get-info.args.json --timeout 30
```

```powershell
@'{"environment-name":"local","app-code":"UsrTodoList"}'@ | Set-Content -Path .\application-get-info.args.json
py -3 .\scripts\mcp_client.py application-get-info --args-file .\application-get-info.args.json --timeout 30
```

### Батч schema sync

```bash
cat <<'EOF' > /tmp/schema-sync.args.json
{
  "environment-name":"local",
  "package-name":"UsrTodoList",
  "operations":[
    {
      "type":"create-lookup",
      "schema-name":"UsrTodoStatus",
      "title-localizations":{
        "en-US":"Todo Status"
      }
    },
    {
      "type":"update-entity",
      "schema-name":"UsrTodoList",
      "update-operations":[
        {
          "action":"add",
          "column-name":"UsrStatus",
          "type":"Lookup",
          "title-localizations":{
            "en-US":"Status"
          },
          "reference-schema-name":"UsrTodoStatus"
        }
      ]
    }
  ]
}
EOF
python3 scripts/mcp_client.py schema-sync --args-file /tmp/schema-sync.args.json --timeout 120
```

```powershell
@'
{
  "environment-name":"local",
  "package-name":"UsrTodoList",
  "operations":[
    {
      "type":"create-lookup",
      "schema-name":"UsrTodoStatus",
      "title-localizations":{
        "en-US":"Todo Status"
      }
    }
  ]
}
'@ | Set-Content -Path .\schema-sync.args.json
py -3 .\scripts\mcp_client.py schema-sync --args-file .\schema-sync.args.json --timeout 120
```

### Батч page sync

```bash
cat <<'EOF' > /tmp/page-sync.args.json
{
  "environment-name":"local",
  "pages":[
    {
      "schema-name":"UsrTodoList_FormPage",
      "body":"define(...)"
    }
  ],
  "validate":true,
  "verify":true
}
EOF
python3 scripts/mcp_client.py page-sync --args-file /tmp/page-sync.args.json --timeout 120
```

```powershell
@'
{
  "environment-name":"local",
  "pages":[
    {
      "schema-name":"UsrTodoList_FormPage",
      "body":"define(...)"
    }
  ],
  "validate":true,
  "verify":true
}
'@ | Set-Content -Path .\page-sync.args.json
py -3 .\scripts\mcp_client.py page-sync --args-file .\page-sync.args.json --timeout 120
```

## Перевірки після schema/page sync

- Після `schema-sync` обов’язково викличте `application-get-info`
- Не тримайте локальні hard-coded param/response expectations; якщо треба точний shape, дочитайте його через `tool-contract-get`
- Після `page-sync` перевірте, що всі page results мають `success: true`
- Якщо потрібна детальна перевірка сторінок, дочитайте сторінки через `page-get`
- Для локального helper path `page-sync` лишається preferred fast path, а `mcp_page_sync.py` робить fallback `page-get`, якщо server response не містить reusable verified body
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
- у PowerShell використати `py -3 .\scripts\mcp_client.py ...`

### Generic `An error occurred invoking ...`

Причина:
- неправильні назви параметрів
- старий payload contract

Рішення:
- перевірити dash-style tool name
- звірити exact params, aliases і validators через `tool-contract-get`

## Дивіться також

- [`context/mcp-inspector-guide.md`](../context/mcp-inspector-guide.md)

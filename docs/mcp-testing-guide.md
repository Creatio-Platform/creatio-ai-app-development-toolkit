# MCP Testing Guide — Bootstrap And Verification

> Для візуального UI-тестування дивіться [`context/mcp-inspector-guide.md`](../context/mcp-inspector-guide.md).

Цей документ описує, як перевіряти released clio MCP bootstrap і wrapper behavior через `scripts/mcp_client.py`.
Executable contract визначається тільки `clio MCP` через `tool-contract-get`; цей документ не дублює tool payload shape.

## Базові правила

- Підтримуваний runtime: released `clio` `8.0.2.37+`
- `CLIO_CMD` можна використовувати лише як override шляху до сумісного `clio`
- Виконання MCP іде через clio stdio, не через HTTP/SSE
- Для реальних викликів використовуйте `python3 scripts/mcp_client.py ...`
- Для JSON-heavy payloads використовуйте `--args-file` або `--args-stdin`, а не inline quoting
- Спочатку перевіряйте manifest через `tools/list`, а executable contract через `tool-contract-get`
- Canonical entity flow: `application-create -> schema-sync -> application-get-info`
- Canonical page flow: `page-list -> page-get -> page-sync -> page-get`
- `page-update` лишається тільки fallback path для single-page dry-run або legacy save
- Якщо потрібен точний tool shape, дочитуйте його в момент виконання через `tool-contract-get` і `docs://mcp/guides/app-modeling`

## Швидка перевірка середовища

```bash
clio ver
python3 scripts/mcp_client.py tools/list '{}' 30
python3 scripts/mcp_client.py tool-contract-get '{}' 30
```

```powershell
clio ver
py -3 .\scripts\mcp_client.py tools/list '{}' 30
py -3 .\scripts\mcp_client.py tool-contract-get '{}' 30
```

Очікування:

- `clio ver` повертає `8.0.2.37` або новіше
- `tools/list` повертає non-empty manifest
- `tool-contract-get` повертає non-empty metadata для доступних tools

## Generic Invocation Pattern

Для будь-якого non-bootstrap tool:

1. перевірити, що tool присутній у `tools/list`
2. отримати exact params, aliases, required fields, type expectations, response hints і rejected aliases через `tool-contract-get`
3. підготувати payload у `args.json` або через stdin
4. викликати `scripts/mcp_client.py <tool-name> --args-file ./args.json --timeout <seconds>`
5. якщо виклик змінює entity metadata, виконати подальшу перевірку через canonical refresh path

Приклади wrapper invocation pattern:

```bash
python3 scripts/mcp_client.py <tool-name> --args-file ./args.json --timeout 120
python3 scripts/mcp_client.py <tool-name> --args-stdin --timeout 120 < ./args.json
```

```powershell
py -3 .\scripts\mcp_client.py <tool-name> --args-file .\args.json --timeout 120
Get-Content .\args.json | py -3 .\scripts\mcp_client.py <tool-name> --args-stdin --timeout 120
```

## Wrapper Verification Focus

Перевіряйте локальний wrapper на такі властивості:

- `tools/list` і `tool-contract-get` працюють без попереднього contract cache
- non-bootstrap tools вимагають успішного `tool-contract-get`
- top-level metadata validation використовує лише live contract data:
  - `required`
  - `any-of`
  - declared field types
  - rejected aliases
- nested request shapes не вгадуються локально; помилки такого типу повертає сам clio MCP
- unknown tool names повертають suggestion list із live contract index

## Перевірки після mutation flows

- Після entity mutation flow виконайте canonical refresh через `application-get-info`
- Після page write flow повторно перевірте результат через `page-get`, якщо helper або server response не дає достатньої verification evidence
- Не тримайте локальні hard-coded param або response expectations; якщо потрібен точний shape, дочитайте його через `tool-contract-get`

## Типові помилки

### Unsupported clio version

Причина:

- встановлено `clio` старіше за `8.0.2.37`

Рішення:

- оновити `clio`
- або вказати сумісний released binary через `CLIO_CMD`

### `tool-contract-get` недоступний

Причина:

- wrapper не може отримати live metadata
- несумісна версія `clio`
- transport/bootstrap проблема

Рішення:

- перевірити `clio ver`
- перевірити `tools/list`
- окремо перевірити `tool-contract-get`
- не намагатися будувати non-bootstrap payload з repo docs

### Generic invocation error from clio

Причина:

- payload shape або nested fields не відповідають live contract
- wrapper більше не перевіряє складні nested rules локально

Рішення:

- звірити exact params, aliases, validators, prompt/resource guidance і tool-specific notes через `tool-contract-get`
- для app-modeling semantics дочитати `docs://mcp/guides/app-modeling`

## Дивіться також

- [`context/mcp-inspector-guide.md`](../context/mcp-inspector-guide.md)
- [`context/mcp-application-tools-reference.md`](../context/mcp-application-tools-reference.md)

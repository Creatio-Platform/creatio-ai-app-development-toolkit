# 04 — Python MCP Client Improvements

Оптимізація `scripts/mcp_client.py` та execution pipeline.

---

## B1. True parallel `call_tools_batch`

**Складність:** 4 години | **Вплив:** -1.5s + enables parallel (з A2)

### Проблема

`mcp_client.py:182-186` — batch виконує calls послідовно:

```python
def call_tools_batch(self, calls):
    results = []
    for tool_name, arguments, timeout in calls:
        results.append(self.call_tool(tool_name, arguments, timeout))
    return results
```

### Рішення: Client-side JSON-RPC pipelining

JSON-RPC 2.0 дозволяє відправити N запитів перед читанням відповідей:

```python
def call_tools_batch(self, calls):
    with self._lock:
        self._ensure_started()
        sent_ids = []
        for tool_name, arguments, timeout in calls:
            call_id = self._next_id
            self._next_id += 1
            msg = json.dumps({
                "jsonrpc": "2.0",
                "id": call_id,
                "method": "tools/call",
                "params": {"name": tool_name, "arguments": {"args": arguments}}
            })
            self._proc.stdin.write(msg + "\n")
            sent_ids.append(call_id)
        self._proc.stdin.flush()
        
        max_timeout = max(t for _, _, t in calls) if calls else 120
        return self._collect_responses(sent_ids, max_timeout)

def _collect_responses(self, target_ids, timeout):
    results = {}
    remaining = set(target_ids)
    deadline = time.time() + timeout
    while remaining and time.time() < deadline:
        line = self._proc.stdout.readline().strip()
        if not line:
            continue
        try:
            parsed = json.loads(line)
            msg_id = parsed.get("id")
            if msg_id in remaining:
                results[msg_id] = self._extract_result(parsed)
                remaining.discard(msg_id)
        except json.JSONDecodeError:
            continue
    return [results.get(cid) for cid in target_ids]
```

**Обмеження:** clio server обробляє запити послідовно (single-threaded stdio). Client-side pipelining економить serialization + lock overhead. Реальний паралелізм потребує A2.

---

## B2. Усунути подвійний JSON parsing

**Складність:** 30 хвилин | **Вплив:** -2-3ms на call

### Проблема

`_send_and_receive` парсить кожну лінію (json.loads), потім `_parse_tool_response` парсить text content ще раз.

### Рішення

```python
def _extract_result(self, parsed_response):
    """Extract tool result from already-parsed JSON-RPC response."""
    result = parsed_response.get("result", {})
    content = result.get("content", [])
    if content and content[0].get("type") == "text":
        text = content[0]["text"]
        try:
            data = json.loads(text)
            return {"success": data.get("success", True), "data": data, "raw": text}
        except json.JSONDecodeError:
            return {"success": False, "data": None, "raw": text}
    return {"success": False, "data": None, "raw": str(result)}
```

---

## B3. Buffered I/O для stdout

**Складність:** 30 хвилин | **Вплив:** -5-10ms для великих page bodies

### Рішення

```python
import io

def _ensure_started(self):
    if self._proc is None or self._proc.poll() is not None:
        self._proc = subprocess.Popen(
            self._cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True,
            bufsize=1  # Line buffered
        )
        # Wrap stdout з більшим буфером для великих responses:
        self._stdout = io.TextIOWrapper(
            io.BufferedReader(self._proc.stdout.buffer, buffer_size=65536),
            encoding='utf-8'
        )
```

---

## B8. `mcp_full_sync.py` як єдиний execution path

**Складність:** 1 день | **Вплив:** -3s bash overhead

### Проблема

Agent 4 запускає 6-8 окремих `bash` команд з inline Python:

```bash
# Call 1:
python3 -c "from mcp_client import call_mcp_tool; r = call_mcp_tool('application-create', ...); ..."

# Call 2:
python3 -c "from mcp_client import call_mcp_tool; r = call_mcp_tool('create-lookup', ...); ..."

# Call 3-8: ...
```

Кожний bash call: +300-500ms (Python startup + module import + connection init).

### Рішення

Один виклик `mcp_full_sync.py` з повним планом:

```bash
python3 scripts/mcp_full_sync.py \
  --env output/UsrTodoList/.creatio-env.json \
  --plan output/UsrTodoList/plan.md \
  --page-sync output/UsrTodoList/page-sync-plan.json \
  --result output/UsrTodoList/mcp-application-result.json
```

Один Python process, одна MCP connection (persistent), нуль bash overhead між кроками.

Зміни в `mcp_full_sync.py`:
1. Додати `--plan` argument parsing (витягти schema sync operations з plan.md)
2. Додати `--page-sync` для page sync plan
3. Виводити structured JSON progress на stdout для Agent 4 consumption
4. Записувати `mcp-application-result.json` інкрементально

---

## B6. Обробка progress notifications

**Складність:** 2 години | **Вплив:** UX improvement

### Рішення

В `_send_and_receive`, перехоплювати notification messages:

```python
def _send_and_receive(self, method, params, target_id):
    # ... send request ...
    while time.time() < deadline:
        line = self._proc.stdout.readline().strip()
        if not line:
            continue
        parsed = json.loads(line)
        if "method" in parsed:
            if parsed["method"] == "notifications/progress":
                progress = parsed.get("params", {})
                if self._progress_callback:
                    self._progress_callback(progress)
                continue
        if parsed.get("id") == target_id:
            return parsed
```

---

## B7. Tool metadata для retry стратегій

**Складність:** 2 години | **Вплив:** reliability

### Рішення

При `tools/list`, зберігати metadata кожного tool:

```python
def list_tools(self):
    response = self._send_and_receive("tools/list", {})
    self._tool_metadata = {}
    for tool in response.get("tools", []):
        annotations = tool.get("annotations", {})
        self._tool_metadata[tool["name"]] = {
            "readOnly": annotations.get("readOnly", False),
            "idempotent": annotations.get("idempotent", False),
            "destructive": annotations.get("destructive", False),
        }
    return response

def call_tool(self, tool_name, arguments, timeout=120):
    # ... existing code ...
    # On failure:
    meta = self._tool_metadata.get(tool_name, {})
    if meta.get("idempotent") and retry_count < 2:
        return self.call_tool(tool_name, arguments, timeout)  # Safe to retry
    if meta.get("destructive"):
        raise McpToolError(f"Destructive tool {tool_name} failed, not retrying")
```

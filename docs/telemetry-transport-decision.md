# Decision: two clio transports, on purpose

**Status:** accepted · **Scope:** `hooks/telemetry-routing.mjs`, `runtime/scripts/mcp_client.py` ·
**Raised in review of** ENG-92551 (PR #96)

## The observation

The toolkit now talks to clio's MCP server from two places, in two languages:

| | `runtime/scripts/mcp_client.py` | `hooks/telemetry-routing.mjs` |
| --- | --- | --- |
| Language | Python | Node |
| Lifetime | long-lived client, reused across calls | one detached call, never awaited |
| Waits for the answer | yes | **no** — a later hook invocation reads it from a file |
| Resolves the executable | `CLIO_CMD` | `CAADT_TELEMETRY_CLIO` |

Both resolve a configured command that may be a bare path containing spaces, and both had to be
fixed for it. That duplication is real, and it is the kind that drifts.

## Why they are not merged

**The languages are fixed by their hosts, not chosen.** A Claude Code / Cursor / Codex hook is a
command the host spawns per event, and it must start and finish in milliseconds. Node is already
required by the hosts' hook mechanism; Python is what the runtime scripts are written in. Sharing
code across that boundary means either shelling out from the hook into Python — paying a second
interpreter start on the very path whose whole point is to be cheap and non-blocking — or vendoring
one implementation into the other language, which is the same duplication with more machinery.

**They are not the same transport.** `mcp_client.py` is a request/response client: it waits, parses,
retries, and surfaces errors to the caller. The hook must do the opposite of waiting — it hands the
call off and lets a later invocation read the outcome from a file, because anything it awaits is time
the developer's own tool call spends blocked. A shared abstraction would have to be an abstraction
over "waits" and "does not wait", which is not one transport with two callers.

## What is shared instead

The **rule**, written down once here, plus a test on each side:

> A `CLIO_CMD` / `CAADT_TELEMETRY_CLIO` value that is a single path — spaces and all — is ONE token.
> A value whose first whitespace-separated token is itself runnable (`dotnet /path/to/clio.dll`) is a
> command plus arguments and is split. A path-shaped value that resolves to nothing is still reported
> whole, so the diagnostic names what the developer configured rather than a mangled fragment.

Covered by `tests/test_mcp_client.py::test_resolve_clio_cmd_*` on the Python side and
`tests/test_telemetry_routing_hook.py` on the hook side. **If that rule changes, it changes in three
places: here, and once in each implementation.** That is the cost this decision accepts.

## When to revisit

If a third caller appears, or if the hook ever needs to read a response inline, the argument above
stops holding and one transport becomes the cheaper option.

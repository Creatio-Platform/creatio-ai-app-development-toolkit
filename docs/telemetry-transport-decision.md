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

Only the narrower half of the rule, and it is smaller than it once read here. `mcp_client.py` alone
implements the full command-plus-arguments split:

> A `CLIO_CMD` value that is a single path — spaces and all — is ONE token. A value whose first
> whitespace-separated token is itself runnable (`dotnet /path/to/clio.dll`) is a command plus
> arguments and is split. A path-shaped value that resolves to nothing is still reported whole, so the
> diagnostic names what the developer configured rather than a mangled fragment.

The hook does **not** implement that split — `CAADT_TELEMETRY_CLIO` is always spawned as a single
executable (`spawn(CLIO, ['mcp-server'])`), whether it is a bare name or a path with spaces in it, and
there is no "command plus arguments" shape on that side at all. What the hook DOES share is only the
existence check: a value that looks like a path (`CLIO_IS_SAFE` in `hooks/telemetry-routing.mjs`) must
resolve to a real file, the same as `is_file()` in `mcp_client.py`; a bare name is left to PATH
resolution on both sides. That narrower half is covered by
`tests/test_mcp_client.py::test_resolve_clio_cmd_*` on the Python side and
`tests/test_telemetry_routing_hook.py` on the hook side. **If even that half changes, it changes in
three places: here, and once in each implementation.** The token-splitting half is Python-only and has
no hook-side equivalent to keep in sync.

## The floor's exactly-once contract

`workflow_started` is the denominator every reliability ratio in this system is computed against, so
it gets a stronger guarantee than a `session_usage` reading: at most one per session, and — best
effort, since the child is never awaited — at least one for any session that touched clio.

- **Concurrency primitive:** an exclusive file create (`wx` flag) per attempt,
  `{session}.claimed[-N]` for attempt `N`. Two hook processes racing for the same session collide on
  the same create and only one wins it; the loser does not retry that attempt.
- **Per-attempt, not per-session, files:** the request/outcome pair dispatch writes is named
  `{session}.{kind}-{nonce}-request` / `-outcome`, nonce-keyed per dispatch. A single shared pair per
  kind let a second (retried) dispatch truncate the file a still-running first child was reading or
  writing, so one child's answer could be read as the other's.
- **Outcome-bucket → retry mapping:** `recorded` and `unknown` are both terminal-success for the
  floor (an answer clio gave, even an unfamiliar one, is treated as delivered); `rejected` and a
  `'none'` claim older than `OUTCOME_GRACE_MS` are retryable, up to `FLOOR_ATTEMPT_LIMIT`; `pending`
  and a fresh `'none'` are left alone rather than retried, so a slow-but-eventually-answering clio is
  never raced against its own retry.
- **Durability trade-off accepted:** none of this survives a machine restart or a claim file lost to
  disk pressure — the guarantee is "at most once, best-effort at least once," not "exactly once,
  durably." A session that never gets a floor event leaves silence, not an error, on this design.

**Invariants this protocol assumes, stated once so a future change can check itself against them:**

1. A single filesystem, local to the machine. `wx`-exclusive create is atomic on the filesystems this
   runs on (NTFS, APFS, ext4, ...); it is not guaranteed atomic on NFS or other network mounts, so a
   telemetry home on one would degrade this from "exactly one winner" to "usually one winner."
2. A single machine. Nothing here coordinates across hosts — two machines sharing a telemetry home
   (e.g. over a synced folder) can both win a claim for the same session.
3. Marker files are visible to every hook process for a session, and to no process outside it — i.e.
   the state directory is neither shared across unrelated sessions in a way that lets one collide with
   another's nonce, nor private in a way that hides one hook invocation's writes from the next.
4. Cleanup is advisory, not correctness-bearing, on the floor path: `floorRetryable()` re-derives
   retry eligibility from the on-disk outcome file on every call, so deleting that file early (as the
   usage path safely does, because it has an independent durable record) forces the next call onto the
   slower grace-period path instead of failing outright. See the comment at the floor retry loop in
   `hooks/telemetry-routing.mjs`.

## When to revisit

If a third caller appears, or if the hook ever needs to read a response inline, the argument above
stops holding and one transport becomes the cheaper option.

**Tracked follow-up: the outcome parser guesses at clio's response shape.**

`readOutcome()`/`telemetryStatus()` guess at two response shapes clio might answer with —
`structuredContent.status` and a JSON blob inside a text content block — rather than checking against
a validated contract. `get-tool-contract` is this repo's normal answer to exactly this situation (see
`AGENTS.md`), but it is not available here: that mechanism is called BY an agent turn to discover
clio MCP tools before making a call, and this hook is not an agent turn — it is a standalone Node
process the host spawns on `PostToolUse`/`Stop`, with no MCP tool-calling context of its own, which
runs the clio binary directly over stdio instead. So this gap cannot be closed by calling
`get-tool-contract` from inside the hook; closing it needs either a schema clio ships and this hook
can validate against without a tool call, or a contract test run separately (e.g. in CI, gated on a
real clio binary) that fails the build the day clio's answer shape changes.

- **Owner:** whoever owns this hook file (`hooks/telemetry-routing.mjs`) at the time clio's telemetry
  tool contract changes, or CI flags a mismatch.
- **Trigger condition:** clio publishes a schema for `send-telemetry`'s response, OR a contract test
  against the real binary starts failing, OR the `OPAQUE_REPLY`-shaped `'unknown'` bucket in production
  telemetry grows large enough to suggest the guessed shapes no longer match reality.
- **Until then:** both guessed shapes are covered by test fixtures in
  `tests/test_telemetry_routing_hook.py`, but those fixtures are this repo's best guess, unverified
  against the live binary. An answer that parses as complete JSON-RPC but matches neither guessed shape
  lands in `'unknown'` (treated as delivered, not retried) rather than failing loudly — deliberately,
  since failing loudly would corrupt the floor's own denominator on every clio release this hook has
  not yet been updated for.

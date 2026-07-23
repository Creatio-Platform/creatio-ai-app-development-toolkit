#!/usr/bin/env python3
"""
clio MCP availability preflight (ENG-92985).

A deterministic, read-only gate the orchestrator runs *once, before the first clio
operation* when the host does NOT expose native clio MCP tools. It answers one
question with a machine-readable verdict and an exit code so the agent stops on a
structured signal instead of free-form reasoning (the failure mode in ENG-92985,
where the agent reasoned "this is a missing prerequisite" and then self-bootstrapped
.NET and drove everything through the stdio wrapper for ~2h anyway).

Three states — the agent decides State A itself; this script decides B vs C:

  A. native clio MCP tools ARE surfaced to the host  -> use them; do NOT run this
     script (it cannot observe the host tool registry, only clio itself).
  B. host has no native MCP transport, but clio is healthy over stdio             -> USABLE
     -> the stdio wrapper (runtime/scripts/mcp_client.py) is the SANCTIONED path,
        but only after the developer explicitly opts in. clio is not the blocker.
  C. clio cannot be resolved, or its MCP server does not respond                  -> BLOCKED
     -> stop and hand the developer a prerequisites blocker.

This script NEVER self-bootstraps: it does not install or download the .NET SDK,
does not change PowerShell ExecutionPolicy, and does not register environments.
Those are developer-owned prerequisite fixes. It is pure diagnosis.

Exit codes:
  0  USABLE   (State B)  — clio healthy; native transport absent -> opt-in wrapper
  3  BLOCKED  (State C)  — prerequisites blocker; stop, do not self-bootstrap
  2  argument/usage error (argparse default)

Output: a leading sentinel line ("PREFLIGHT: ..." / "BLOCKER: ...") followed by a
JSON object {state, reason, remedy, detail}. Use --json to print only the JSON.
"""
import argparse
import json
import os
import shutil
import sys
import threading
from pathlib import Path

# clio_mcp_preflight.py and mcp_client.py are siblings in runtime/scripts/.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import mcp_client  # noqa: E402  (path set above)

# Internal reason codes, asserted by the behavioral tests. The agent keys on the
# state/exit-code/sentinel contract (below), not these; keep them stable regardless.
REASON_HEALTHY = "clio-healthy"
REASON_NOT_RESOLVABLE = "clio-not-resolvable"
REASON_UNRESPONSIVE = "mcp-server-unresponsive"

STATE_USABLE = "usable"
STATE_BLOCKED = "blocked"

EXIT_USABLE = 0
EXIT_BLOCKED = 3

SENTINEL_USABLE = "PREFLIGHT: clio-mcp-usable"
SENTINEL_BLOCKED = "BLOCKER: clio-mcp-unavailable"

# Short by design: a healthy clio answers get-tool-contract in ~1-2s, so a dead or
# missing server is diagnosed in seconds — never the 664s/964s hangs of ENG-92985.
DEFAULT_PROBE_TIMEOUT = 20

# Hard wall-clock ceiling the watchdog adds on top of the probe timeout. The probe
# runs on a worker thread; if it overruns (a clio child that is alive but silent, or
# a blocking stdout read that never sees the deadline), the watchdog force-kills the
# child so a hung server can NEVER reproduce the ENG-92985 hang inside the gate.
PROBE_WATCHDOG_GRACE = 5

# `detail` echoes raw server/exception text into agent-visible output. Bound it so a
# verbose or hostile server response cannot flood agent context; it is diagnostic only.
MAX_DETAIL_CHARS = 800

_NO_SELF_BOOTSTRAP = (
    "Do NOT self-bootstrap: the agent must not install or download the .NET SDK, "
    "change PowerShell ExecutionPolicy, or silently register environments. These are "
    "developer-owned prerequisite fixes — stop and hand them to the developer."
)

_REMEDY_NOT_RESOLVABLE = (
    "clio MCP is unavailable: clio could not be resolved on this host.\n"
    "Developer-owned prerequisites (fix once, up front):\n"
    "  1. install .NET (the SDK/runtime clio requires): https://dotnet.microsoft.com/download\n"
    "  2. install clio: dotnet tool install clio -g\n"
    "     (already installed but not on PATH? add it to PATH or set CLIO_CMD instead of reinstalling)\n"
    "  3. register the target environment: clio reg-web-app\n"
    + _NO_SELF_BOOTSTRAP
)

_REMEDY_UNRESPONSIVE = (
    "clio MCP is unavailable: clio resolved but its MCP server did not respond "
    "(crash, hang, or transport error).\n"
    "  - verify clio runs: clio ver\n"
    "  - register/verify the target environment: clio reg-web-app / clio list-environments\n"
    "Treat a registered-but-unresponsive server as unavailable: this is ONE probe. Do not "
    "retry indefinitely and do not reach for the stdio wrapper to work around a dead server.\n"
    + _NO_SELF_BOOTSTRAP
)

_REMEDY_HEALTHY = (
    "clio is healthy over stdio (its MCP server answered get-tool-contract).\n"
    "If this host exposes native clio MCP tools, use them. If it does NOT (no native MCP "
    "transport), runtime/scripts/mcp_client.py is the SANCTIONED path — but run it only "
    "after the developer explicitly opts in. clio itself is not the blocker here."
)


class PreflightResult:
    """Small value object returned by :func:`classify`.

    Holds the verdict fields plus two derived accessors (``sentinel``, ``exit_code``)
    that map the state to the process-level contract. Only two states reach a result
    (``usable`` / ``blocked``); anything not ``usable`` maps to the blocked contract.
    """

    def __init__(self, state, reason, remedy, detail=""):
        self.state = state
        self.reason = reason
        self.remedy = remedy
        self.detail = detail

    @property
    def sentinel(self):
        return SENTINEL_USABLE if self.state == STATE_USABLE else SENTINEL_BLOCKED

    @property
    def exit_code(self):
        return EXIT_USABLE if self.state == STATE_USABLE else EXIT_BLOCKED

    def to_dict(self):
        return {
            "sentinel": self.sentinel,
            "state": self.state,
            "reason": self.reason,
            "remedy": self.remedy,
            "detail": self.detail,
        }


def _verify_clio_cmd_exists(parts):
    """Verify a CLIO_CMD-derived command actually resolves to a runnable target.

    `mcp_client._resolve_clio_cmd` trusts CLIO_CMD verbatim without checking the target
    exists, so a typo'd CLIO_CMD would otherwise surface later as a subprocess spawn
    failure classified as `mcp-server-unresponsive` (wrong remedy). Verifying here keeps
    the accurate `clio-not-resolvable` remedy — the real ENG-92985 root cause.
    """
    executable = parts[0]
    if shutil.which(executable) is None and not Path(executable).exists():
        raise RuntimeError(
            f"CLIO_CMD points at '{executable}', which is not runnable "
            "(not on PATH and not an existing file). Fix CLIO_CMD, add clio to PATH, or install clio."
        )
    for token in parts[1:]:
        if token.lower().endswith(".dll") and not Path(token).exists():
            raise RuntimeError(
                f"CLIO_CMD references '{token}', which does not exist. "
                "Point CLIO_CMD at a valid clio DLL."
            )


def _default_resolver():
    """Resolve the clio command (CLIO_CMD / clio on PATH); raises if unresolvable."""
    parts = mcp_client._resolve_clio_cmd()
    if os.environ.get("CLIO_CMD", "").strip():
        _verify_clio_cmd_exists(parts)
    return parts


def _force_kill_shared_client():
    """Terminate mcp_client's persistent clio child directly.

    ``PersistentMcpClient.close()`` acquires the client lock, but a hung probe still
    holds that lock inside its blocking read loop — so ``close()`` would deadlock the
    watchdog. Killing the process directly makes the stuck ``readline()`` return at
    once, letting the worker thread unwind. Best-effort and idempotent.
    """
    client = getattr(mcp_client, "_shared_client", None)
    proc = getattr(client, "_proc", None) if client is not None else None
    if proc is not None:
        try:
            proc.kill()
        except Exception:
            pass


def _default_prober(timeout):
    """Probe the clio MCP server (cheapest resident call) under a hard wall-clock watchdog.

    mcp_client's read loop only re-checks its deadline between blocking ``readline()``
    calls and never drains the child's stderr, so a clio child that starts but stays
    silent (or floods stderr past the OS pipe buffer) could hang far past ``timeout``.
    The probe therefore runs on a worker thread; if it overruns ``timeout`` +
    ``PROBE_WATCHDOG_GRACE`` the watchdog force-kills the child so the gate itself can
    never reproduce the ENG-92985 hang.
    """
    box = {}

    def run():
        try:
            box["result"] = mcp_client.call_mcp_tool("get-tool-contract", {}, timeout=timeout)
        except Exception as error:  # captured; re-raised on the calling thread below
            box["error"] = error

    worker = threading.Thread(target=run, name="clio-mcp-probe", daemon=True)
    worker.start()
    worker.join(timeout + PROBE_WATCHDOG_GRACE)
    if worker.is_alive():
        _force_kill_shared_client()
        raise TimeoutError(
            f"clio MCP probe exceeded {timeout + PROBE_WATCHDOG_GRACE}s "
            "(clio started but did not respond)"
        )
    if "error" in box:
        raise box["error"]
    return box.get("result")


def _probe_is_healthy(probe):
    """True only when the probe returned success AND a real payload.

    A healthy ``get-tool-contract`` returns ``{"success": true, "index": {...}}`` with a
    non-empty resident-tool index. Requiring real content (not merely a truthy
    ``success``) prevents green-lighting a server that answers but returns nothing usable.
    """
    if not (isinstance(probe, dict) and probe.get("success")):
        return False
    data = probe.get("data")
    if not isinstance(data, dict):
        return False
    if "index" in data or "tools" in data:
        return bool(data.get("index") or data.get("tools"))
    return len(data) > 0


def _truncate_detail(text):
    """Bound agent-visible diagnostic text so a verbose/hostile server can't flood context."""
    text = text or ""
    if len(text) > MAX_DETAIL_CHARS:
        return text[:MAX_DETAIL_CHARS] + "… [truncated]"
    return text


def classify(resolver=_default_resolver, prober=_default_prober, timeout=DEFAULT_PROBE_TIMEOUT):
    """Classify clio MCP availability into a :class:`PreflightResult`.

    ``resolver`` and ``prober`` are injectable so the decision logic is testable
    without a live clio: ``resolver()`` returns the clio argv (or raises), and
    ``prober(timeout)`` returns the ``mcp_client`` result dict. The prober is only
    called when the resolver succeeds, so a missing clio never triggers a probe
    that could hang.
    """
    try:
        resolver()
    except Exception as error:  # RuntimeError from _resolve_clio_cmd, or any resolver failure
        return PreflightResult(
            STATE_BLOCKED, REASON_NOT_RESOLVABLE, _REMEDY_NOT_RESOLVABLE, _truncate_detail(str(error))
        )

    try:
        probe = prober(timeout)
    except Exception as error:
        return PreflightResult(
            STATE_BLOCKED, REASON_UNRESPONSIVE, _REMEDY_UNRESPONSIVE, _truncate_detail(str(error))
        )

    if _probe_is_healthy(probe):
        return PreflightResult(STATE_USABLE, REASON_HEALTHY, _REMEDY_HEALTHY, "")
    detail = ""
    if isinstance(probe, dict):
        detail = str(probe.get("raw") or probe.get("data") or "")
    return PreflightResult(STATE_BLOCKED, REASON_UNRESPONSIVE, _REMEDY_UNRESPONSIVE, _truncate_detail(detail))


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    parser = argparse.ArgumentParser(
        prog="clio_mcp_preflight.py",
        description="clio MCP availability preflight (read-only; never self-bootstraps).",
    )
    parser.add_argument("--timeout", type=int, default=DEFAULT_PROBE_TIMEOUT,
                        help=f"probe timeout in seconds (default {DEFAULT_PROBE_TIMEOUT})")
    parser.add_argument("--json", action="store_true",
                        help="print only the JSON verdict (no leading sentinel line)")
    parsed = parser.parse_args(argv)
    if parsed.timeout <= 0:
        parser.error("--timeout must be a positive integer number of seconds")

    try:
        result = classify(timeout=parsed.timeout)
    finally:
        # Reap the persistent clio child deterministically (the gate is one-shot and
        # never calls close()); avoids an orphaned process / up-to-5s shutdown latency.
        _force_kill_shared_client()
    payload = json.dumps(result.to_dict(), indent=2)
    if parsed.json:
        print(payload)
    else:
        print(result.sentinel)
        print(payload)
    return result.exit_code


if __name__ == "__main__":
    sys.exit(main())

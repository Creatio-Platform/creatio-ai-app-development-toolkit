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
import sys
from pathlib import Path

# clio_mcp_preflight.py and mcp_client.py are siblings in runtime/scripts/.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import mcp_client  # noqa: E402  (path set above)

# Reason codes are part of the contract consumed by the agent — keep them stable.
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
    """Diagnosis carrier (data-only) returned by :func:`classify`."""

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


def _default_resolver():
    """Resolve the clio command (CLIO_CMD / clio on PATH); raises if neither is found."""
    return mcp_client._resolve_clio_cmd()


def _default_prober(timeout):
    """Probe the clio MCP server with the cheapest resident tool call."""
    return mcp_client.call_mcp_tool("get-tool-contract", {}, timeout=timeout)


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
        return PreflightResult(STATE_BLOCKED, REASON_NOT_RESOLVABLE, _REMEDY_NOT_RESOLVABLE, str(error))

    try:
        probe = prober(timeout)
    except Exception as error:
        return PreflightResult(STATE_BLOCKED, REASON_UNRESPONSIVE, _REMEDY_UNRESPONSIVE, str(error))

    if isinstance(probe, dict) and probe.get("success"):
        return PreflightResult(STATE_USABLE, REASON_HEALTHY, _REMEDY_HEALTHY, "")
    detail = ""
    if isinstance(probe, dict):
        detail = str(probe.get("raw") or probe.get("data") or "")
    return PreflightResult(STATE_BLOCKED, REASON_UNRESPONSIVE, _REMEDY_UNRESPONSIVE, detail)


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

    result = classify(timeout=parsed.timeout)
    payload = json.dumps(result.to_dict(), indent=2)
    if parsed.json:
        print(payload)
    else:
        print(result.sentinel)
        print(payload)
    return result.exit_code


if __name__ == "__main__":
    sys.exit(main())

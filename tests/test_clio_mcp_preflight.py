"""Behavioral tests for the ENG-92985 clio MCP availability preflight gate.

These assert the gate's *behavior* — classification, exit codes, sentinels, remedy
content, and the invariant that it never self-bootstraps — rather than the presence
of tokens in prose (that lexical coverage lives in test_default_contract_docs.py).
The clio resolver and MCP prober are injected, so nothing here starts a real clio
process or touches the network.
"""
import io
import os
import sys
import threading
import unittest
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "runtime" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import clio_mcp_preflight as pf  # noqa: E402  (path set above)
import mcp_client  # noqa: E402  (same runtime/scripts dir; used to patch the production seam)

_HEALTHY_PROBE = {"success": True, "data": {"index": {"get-tool-contract": {"resident": True}}}, "raw": "{}"}


class _SpyProber:
    """Records call count and the last timeout passed; returns/raises a canned outcome."""

    def __init__(self, result=None, exc=None):
        self.result = result
        self.exc = exc
        self.calls = 0
        self.last_timeout = None

    def __call__(self, timeout):
        self.calls += 1
        self.last_timeout = timeout
        if self.exc is not None:
            raise self.exc
        return self.result


def _raise_unresolvable():
    raise RuntimeError(
        ".NET SDK is not installed. Download it from: https://dotnet.microsoft.com/download"
    )


class ClioMcpPreflightBehaviorTests(unittest.TestCase):
    def test_state_c_when_clio_not_resolvable_blocks_without_probing(self):
        prober = _SpyProber(exc=AssertionError("prober must not run when clio is unresolvable"))
        result = pf.classify(resolver=_raise_unresolvable, prober=prober)
        self.assertEqual(result.state, pf.STATE_BLOCKED)
        self.assertEqual(result.reason, pf.REASON_NOT_RESOLVABLE)
        self.assertEqual(result.exit_code, pf.EXIT_BLOCKED)
        self.assertEqual(result.sentinel, pf.SENTINEL_BLOCKED)
        self.assertEqual(prober.calls, 0, "a missing clio must not trigger a probe that could hang")

    def test_state_c_remedy_lists_prerequisites_and_forbids_self_bootstrap(self):
        result = pf.classify(resolver=_raise_unresolvable, prober=_SpyProber(result={"success": True}))
        remedy = result.remedy.lower()
        # the three developer-owned prerequisites
        self.assertIn(".net", remedy)
        self.assertIn("dotnet tool install clio -g", remedy)
        self.assertIn("reg-web-app", remedy)
        # installed-but-not-on-PATH is called out (the real ENG-92985 root cause)
        self.assertIn("path", remedy)
        self.assertIn("clio_cmd", remedy)
        # the no-self-bootstrap invariant is stated in the blocker itself
        self.assertIn("do not", remedy)
        self.assertIn("executionpolicy", remedy)
        self.assertIn("silently register", remedy)

    def test_state_c_when_server_returns_failure(self):
        prober = _SpyProber(result={"success": False, "raw": "no matching response"})
        result = pf.classify(resolver=lambda: ["clio"], prober=prober)
        self.assertEqual(result.state, pf.STATE_BLOCKED)
        self.assertEqual(result.reason, pf.REASON_UNRESPONSIVE)
        self.assertEqual(result.exit_code, pf.EXIT_BLOCKED)
        self.assertIn("no matching response", result.detail)
        self.assertEqual(prober.calls, 1)

    def test_state_c_when_server_probe_raises(self):
        prober = _SpyProber(exc=TimeoutError("server hung"))
        result = pf.classify(resolver=lambda: ["clio"], prober=prober)
        self.assertEqual(result.state, pf.STATE_BLOCKED)
        self.assertEqual(result.reason, pf.REASON_UNRESPONSIVE)
        self.assertEqual(result.exit_code, pf.EXIT_BLOCKED)
        self.assertIn("server hung", result.detail)

    def test_state_b_when_clio_healthy(self):
        prober = _SpyProber(result=_HEALTHY_PROBE)
        result = pf.classify(resolver=lambda: ["clio"], prober=prober, timeout=9)
        self.assertEqual(result.state, pf.STATE_USABLE)
        self.assertEqual(result.reason, pf.REASON_HEALTHY)
        self.assertEqual(result.exit_code, pf.EXIT_USABLE)
        self.assertEqual(result.sentinel, pf.SENTINEL_USABLE)
        self.assertEqual(prober.calls, 1, "the healthy path must probe exactly once")
        self.assertEqual(prober.last_timeout, 9, "classify must forward its timeout to the prober")
        # State B is explicitly NOT a blocker: the wrapper is sanctioned, opt-in only
        self.assertIn("sanctioned", result.remedy.lower())
        self.assertIn("opts in", result.remedy.lower())

    def test_success_without_real_payload_is_not_healthy(self):
        # A truthy `success` with an empty/absent contract index must NOT be reported
        # usable — else the gate green-lights a server whose first real call would fail.
        for empty in ({"success": True}, {"success": True, "data": {}},
                      {"success": True, "data": {"index": {}}}, {"success": True, "data": "oops"}):
            result = pf.classify(resolver=lambda: ["clio"], prober=_SpyProber(result=empty))
            self.assertEqual(result.state, pf.STATE_BLOCKED, empty)
            self.assertEqual(result.reason, pf.REASON_UNRESPONSIVE, empty)

    def test_probe_timeout_is_bounded_and_short(self):
        # ENG-92985: a dead/missing server must be diagnosed in seconds, never the
        # 664s/964s hangs of the original session.
        self.assertLessEqual(pf.DEFAULT_PROBE_TIMEOUT, 30)

    def test_default_prober_watchdog_force_kills_a_hung_probe(self):
        # ENG-92985 core guarantee: even if mcp_client's read loop blocks past the
        # timeout (silent child / undrained stderr), the gate must not hang — the
        # watchdog force-kills the child and raises within the wall-clock bound.
        blocked = threading.Event()
        killed = {"called": False}
        orig_call, orig_grace, orig_kill = (
            mcp_client.call_mcp_tool, pf.PROBE_WATCHDOG_GRACE, pf._force_kill_shared_client)
        mcp_client.call_mcp_tool = lambda *a, **k: blocked.wait(10)  # never returns in time
        pf.PROBE_WATCHDOG_GRACE = 0
        pf._force_kill_shared_client = lambda: killed.__setitem__("called", True)
        try:
            with self.assertRaises(TimeoutError):
                pf._default_prober(0)
        finally:
            blocked.set()
            mcp_client.call_mcp_tool = orig_call
            pf.PROBE_WATCHDOG_GRACE = orig_grace
            pf._force_kill_shared_client = orig_kill
        self.assertTrue(killed["called"], "watchdog must force-kill the hung clio child")

    def test_default_seam_wires_to_mcp_client_and_forwards_timeout(self):
        # M2: the production defaults (_default_resolver/_default_prober) actually reach
        # mcp_client's real (private) symbols and forward the timeout — the one path the
        # injected-seam tests never exercise, and the one a mcp_client rename would break.
        seen = {}
        orig_resolve, orig_call = mcp_client._resolve_clio_cmd, mcp_client.call_mcp_tool
        removed_env = os.environ.pop("CLIO_CMD", None)
        mcp_client._resolve_clio_cmd = lambda: ["clio"]

        def fake_call(name, args, timeout=None):
            seen.update(name=name, args=args, timeout=timeout)
            return _HEALTHY_PROBE

        mcp_client.call_mcp_tool = fake_call
        try:
            result = pf.classify(timeout=7)  # real default resolver + prober
        finally:
            mcp_client._resolve_clio_cmd, mcp_client.call_mcp_tool = orig_resolve, orig_call
            if removed_env is not None:
                os.environ["CLIO_CMD"] = removed_env
        self.assertEqual(result.state, pf.STATE_USABLE)
        self.assertEqual(seen.get("name"), "get-tool-contract")
        self.assertEqual(seen.get("args"), {})
        self.assertEqual(seen.get("timeout"), 7)

    def test_default_resolver_runtime_error_maps_to_blocked(self):
        # M2 companion: a resolver RuntimeError through the real default maps to State C
        # and never reaches the prober.
        orig_resolve, orig_call = mcp_client._resolve_clio_cmd, mcp_client.call_mcp_tool
        removed_env = os.environ.pop("CLIO_CMD", None)

        def boom():
            raise RuntimeError(".NET SDK is not installed")

        mcp_client._resolve_clio_cmd = boom
        mcp_client.call_mcp_tool = lambda *a, **k: self.fail("prober must not run when clio is unresolvable")
        try:
            result = pf.classify()  # real defaults
        finally:
            mcp_client._resolve_clio_cmd, mcp_client.call_mcp_tool = orig_resolve, orig_call
            if removed_env is not None:
                os.environ["CLIO_CMD"] = removed_env
        self.assertEqual(result.state, pf.STATE_BLOCKED)
        self.assertEqual(result.reason, pf.REASON_NOT_RESOLVABLE)

    def test_main_rejects_non_positive_timeout(self):
        # #6: an unvalidated --timeout of 0 would silently become 120s in mcp_client;
        # negative would misclassify a healthy clio. argparse must reject it (exit 2).
        for bad in ("0", "-5"):
            with self.assertRaises(SystemExit) as ctx:
                pf.main(["--timeout", bad])
            self.assertEqual(ctx.exception.code, 2, bad)

    def test_main_returns_blocked_exit_code_and_prints_sentinel(self):
        blocked = pf.PreflightResult(pf.STATE_BLOCKED, pf.REASON_NOT_RESOLVABLE, "remedy text", "detail")
        original = pf.classify
        pf.classify = lambda **kwargs: blocked
        try:
            buffer = io.StringIO()
            with redirect_stdout(buffer):
                code = pf.main([])
            output = buffer.getvalue()
        finally:
            pf.classify = original
        self.assertEqual(code, pf.EXIT_BLOCKED)
        self.assertIn(pf.SENTINEL_BLOCKED, output)
        self.assertIn('"state": "blocked"', output)

    def test_main_json_flag_omits_sentinel_line(self):
        usable = pf.PreflightResult(pf.STATE_USABLE, pf.REASON_HEALTHY, "remedy text", "")
        original = pf.classify
        pf.classify = lambda **kwargs: usable
        try:
            buffer = io.StringIO()
            with redirect_stdout(buffer):
                code = pf.main(["--json"])
            output = buffer.getvalue()
        finally:
            pf.classify = original
        self.assertEqual(code, pf.EXIT_USABLE)
        # --json prints only the JSON payload; the sentinel still appears inside it,
        # but not as a standalone leading line.
        self.assertFalse(output.startswith(pf.SENTINEL_USABLE))
        self.assertIn('"state": "usable"', output)

    def test_exit_codes_are_distinct_and_non_overlapping_with_argparse(self):
        # argparse uses exit code 2 for usage errors; the verdict codes must not collide.
        self.assertNotIn(2, (pf.EXIT_USABLE, pf.EXIT_BLOCKED))
        self.assertNotEqual(pf.EXIT_USABLE, pf.EXIT_BLOCKED)


if __name__ == "__main__":
    unittest.main()

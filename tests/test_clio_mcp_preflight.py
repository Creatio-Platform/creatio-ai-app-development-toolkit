"""Behavioral tests for the ENG-92985 clio MCP availability preflight gate.

These assert the gate's *behavior* — classification, exit codes, sentinels, remedy
content, and the invariant that it never self-bootstraps — rather than the presence
of tokens in prose (that lexical coverage lives in test_default_contract_docs.py).
The clio resolver and MCP prober are injected, so nothing here starts a real clio
process or touches the network.
"""
import io
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "runtime" / "scripts"
sys.path.insert(0, str(SCRIPTS))

import clio_mcp_preflight as pf  # noqa: E402  (path set above)


class _SpyProber:
    """Records how many times it was called; returns/raises a canned outcome."""

    def __init__(self, result=None, exc=None):
        self.result = result
        self.exc = exc
        self.calls = 0

    def __call__(self, timeout):
        self.calls += 1
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
        prober = _SpyProber(result={"success": True, "data": {"tools": []}, "raw": "{}"})
        result = pf.classify(resolver=lambda: ["clio"], prober=prober)
        self.assertEqual(result.state, pf.STATE_USABLE)
        self.assertEqual(result.reason, pf.REASON_HEALTHY)
        self.assertEqual(result.exit_code, pf.EXIT_USABLE)
        self.assertEqual(result.sentinel, pf.SENTINEL_USABLE)
        # State B is explicitly NOT a blocker: the wrapper is sanctioned, opt-in only
        self.assertIn("sanctioned", result.remedy.lower())
        self.assertIn("opts in", result.remedy.lower())

    def test_probe_timeout_is_bounded_and_short(self):
        # ENG-92985: a dead/missing server must be diagnosed in seconds, never the
        # 664s/964s hangs of the original session.
        self.assertLessEqual(pf.DEFAULT_PROBE_TIMEOUT, 30)

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

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
from types import SimpleNamespace

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
        hung = SimpleNamespace(call_tool=lambda *a, **k: blocked.wait(10))  # never returns in time
        orig_get, orig_grace, orig_cap, orig_kill = (
            mcp_client._get_shared_client, pf.PROBE_WATCHDOG_GRACE,
            pf._INITIALIZE_CAP_SECONDS, pf._force_kill_shared_client)
        mcp_client._get_shared_client = lambda: hung
        pf.PROBE_WATCHDOG_GRACE = 0
        pf._INITIALIZE_CAP_SECONDS = 0  # shrink the window so this test is fast
        pf._force_kill_shared_client = lambda: killed.__setitem__("called", True)
        try:
            with self.assertRaises(TimeoutError):
                pf._default_prober(0)
        finally:
            blocked.set()
            mcp_client._get_shared_client = orig_get
            pf.PROBE_WATCHDOG_GRACE = orig_grace
            pf._INITIALIZE_CAP_SECONDS = orig_cap
            pf._force_kill_shared_client = orig_kill
        self.assertTrue(killed["called"], "watchdog must force-kill the hung clio child")

    def test_default_seam_wires_to_mcp_client_and_forwards_timeout(self):
        # M2: the production defaults (_default_resolver/_default_prober) actually reach
        # mcp_client's real (private) symbols and forward the timeout — the one path the
        # injected-seam tests never exercise, and the one a mcp_client rename would break.
        seen = {}
        orig_resolve, orig_get = mcp_client._resolve_clio_cmd, mcp_client._get_shared_client
        removed_env = os.environ.pop("CLIO_CMD", None)
        mcp_client._resolve_clio_cmd = lambda: ["clio"]

        def fake_call_tool(name, args, timeout=None):
            seen.update(name=name, args=args, timeout=timeout)
            return _HEALTHY_PROBE

        # The probe reaches mcp_client via the NON-retrying _get_shared_client().call_tool
        # path (not call_mcp_tool) — a mcp_client rename of either symbol breaks this.
        mcp_client._get_shared_client = lambda: SimpleNamespace(call_tool=fake_call_tool)
        try:
            result = pf.classify(timeout=7)  # real default resolver + prober
        finally:
            mcp_client._resolve_clio_cmd, mcp_client._get_shared_client = orig_resolve, orig_get
            if removed_env is not None:
                os.environ["CLIO_CMD"] = removed_env
        self.assertEqual(result.state, pf.STATE_USABLE)
        self.assertEqual(seen.get("name"), "get-tool-contract")
        self.assertEqual(seen.get("args"), {})
        self.assertEqual(seen.get("timeout"), 7)

    def test_default_resolver_runtime_error_maps_to_blocked(self):
        # M2 companion: a resolver RuntimeError through the real default maps to State C
        # and never reaches the prober.
        orig_resolve, orig_get = mcp_client._resolve_clio_cmd, mcp_client._get_shared_client
        removed_env = os.environ.pop("CLIO_CMD", None)

        def boom():
            raise RuntimeError(".NET SDK is not installed")

        mcp_client._resolve_clio_cmd = boom
        mcp_client._get_shared_client = lambda: self.fail("prober must not run when clio is unresolvable")
        try:
            result = pf.classify()  # real defaults
        finally:
            mcp_client._resolve_clio_cmd, mcp_client._get_shared_client = orig_resolve, orig_get
            if removed_env is not None:
                os.environ["CLIO_CMD"] = removed_env
        self.assertEqual(result.state, pf.STATE_BLOCKED)
        self.assertEqual(result.reason, pf.REASON_NOT_RESOLVABLE)

    def test_main_rejects_out_of_range_timeout(self):
        # #6 + PR#55 R3: 0 would silently become 120s in mcp_client; negative would
        # misclassify a healthy clio; an extreme value (> MAX_PROBE_TIMEOUT) would defeat
        # the "bounded, never hangs" invariant. argparse must reject all of them (exit 2).
        for bad in ("0", "-5", str(pf.MAX_PROBE_TIMEOUT + 1)):
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

    def test_probe_watchdog_window_covers_initialize_cap(self):
        # RC-2 (PR #55 review): the watchdog window must span mcp_client's cold-start
        # initialize cap PLUS the call timeout, so a slow-but-healthy cold start is never
        # force-killed (a window of just timeout+grace could fire mid-initialize).
        for timeout in (5, 20, 60):
            window = pf._probe_watchdog_window(timeout)
            # Pin the exact formula (== not >=) so dropping the grace term fails the test.
            self.assertEqual(
                window, pf._INITIALIZE_CAP_SECONDS + timeout + pf.PROBE_WATCHDOG_GRACE,
                "watchdog window must be initialize cap + call timeout + grace",
            )
        # PR #55 R3 (unguarded mirrored constant): the preflight's cap must stay bound to
        # mcp_client's real cap, or a change to one silently under/over-sizes the window.
        self.assertEqual(pf._INITIALIZE_CAP_SECONDS, mcp_client.INITIALIZE_TIMEOUT_CAP)

    def test_default_prober_returns_healthy_within_budget_without_killing(self):
        # RC-2: a probe that answers inside the window resolves to the healthy result and
        # never triggers the watchdog kill.
        orig_get, orig_kill = mcp_client._get_shared_client, pf._force_kill_shared_client
        killed = {"called": False}
        pf._force_kill_shared_client = lambda: killed.__setitem__("called", True)
        mcp_client._get_shared_client = lambda: SimpleNamespace(call_tool=lambda *a, **k: _HEALTHY_PROBE)
        try:
            result = pf._default_prober(5)
        finally:
            mcp_client._get_shared_client = orig_get
            pf._force_kill_shared_client = orig_kill
        self.assertEqual(result, _HEALTHY_PROBE)
        self.assertFalse(killed["called"], "a healthy in-budget probe must not be force-killed")

    def test_force_kill_delegates_to_sanctioned_mcp_client_api(self):
        # RC-1: the gate must NOT reach into mcp_client._shared_client._proc; it delegates
        # to the sanctioned lock-free mcp_client.force_kill_shared_client().
        orig = mcp_client.force_kill_shared_client
        called = {"n": 0}
        mcp_client.force_kill_shared_client = lambda: called.__setitem__("n", called["n"] + 1)
        try:
            pf._force_kill_shared_client()
        finally:
            mcp_client.force_kill_shared_client = orig
        self.assertEqual(called["n"], 1, "gate must call the sanctioned kill API")

    def test_mcp_client_force_kill_is_none_safe_and_kills_proc(self):
        # RC-1: the sanctioned API is a no-op when no shared client exists, and otherwise
        # captures the proc once and kills it (safe to call from a watchdog thread).
        orig = mcp_client._shared_client
        try:
            mcp_client._shared_client = None
            mcp_client.force_kill_shared_client()  # must not raise

            class _FakeProc:
                def __init__(self):
                    self.killed = 0

                def kill(self):
                    self.killed += 1

            class _FakeClient:
                pass

            fake = _FakeClient()
            proc = _FakeProc()
            fake._proc = proc
            mcp_client._shared_client = fake
            mcp_client.force_kill_shared_client()
            self.assertEqual(proc.killed, 1, "sanctioned API must kill the captured proc")
        finally:
            mcp_client._shared_client = orig

    def test_truncate_detail_scrubs_url_credentials(self):
        # RC-4 (PR #55 review): inline URL credentials in a clio error string must be
        # redacted before `detail` reaches console/JSON/CI logs.
        scrubbed = pf._truncate_detail(
            "cannot reach https://admin:s3cr3t@ts1-core-dev04:88/0/ServiceModel — timeout")
        self.assertNotIn("s3cr3t", scrubbed)
        self.assertIn("***:***@", scrubbed)
        self.assertIn("ts1-core-dev04", scrubbed)  # host preserved; only credentials redacted

    def test_truncate_detail_scrubs_connection_string_and_token_secrets(self):
        # PR #55 R2-2: redaction must also cover connection-string secrets, auth tokens,
        # and bare user:pass@host — not just scheme://user:pass@ URLs.
        cs = pf._truncate_detail("login failed: Server=db;Password=Sup3rSecret;Trusted=false")
        self.assertNotIn("Sup3rSecret", cs)
        self.assertIn("Password=***", cs)

        tok = pf._truncate_detail("401 (access_token=eyJhbGciExample; api_key=AKIAEXAMPLE)")
        self.assertNotIn("eyJhbGciExample", tok)
        self.assertNotIn("AKIAEXAMPLE", tok)
        self.assertIn("access_token=***", tok)
        self.assertIn("api_key=***", tok)

        bare = pf._truncate_detail("dsn user:p40ss@dbhost:5432 unreachable")
        self.assertNotIn("p40ss", bare)
        self.assertIn("***:***@dbhost", bare)

    def test_truncate_detail_scrubs_compound_and_header_secrets(self):
        # PR #55 R3: compound/prefixed keys (the \b gap), JSON colon form, and auth headers.
        for text, secret in (
            ("client_secret=abc123XYZ", "abc123XYZ"),
            ("refresh_token=eyJhbGciExample", "eyJhbGciExample"),
            ("db_password=hunter2", "hunter2"),
            ("UserPassword=SuperSecret1", "SuperSecret1"),
            ('{"password": "Sup3r"}', "Sup3r"),
            ("Authorization: Bearer eyJleak", "eyJleak"),
            ("X-Api-Key: AKIAsecretkey", "AKIAsecretkey"),
        ):
            scrubbed = pf._truncate_detail(text)
            self.assertNotIn(secret, scrubbed, text)
        # a benign field with none of the secret keywords must NOT be redacted
        self.assertEqual(pf._truncate_detail("count=5 content=hello status=ok"),
                         "count=5 content=hello status=ok")

    def test_classify_redacts_secret_in_resolver_and_probe_failure_detail(self):
        # PR #55 R3 (Alexandr + m-dymytrova): redaction must hold at the PUBLIC classify()
        # boundary, not only the private helper — a future refactor that bypassed
        # _truncate_detail on one branch would leak a credential into result.detail.
        leaky = RuntimeError("cannot reach https://admin:s3cr3t@ts1-core-dev04/api; Password=hunter2")
        resolver_result = pf.classify(resolver=lambda: (_ for _ in ()).throw(leaky),
                                      prober=lambda t: {"success": True})
        self.assertNotIn("s3cr3t", resolver_result.detail)
        self.assertNotIn("hunter2", resolver_result.detail)
        # and the unhealthy-probe branch (detail from probe raw)
        probe_result = pf.classify(resolver=lambda: ["clio"],
                                   prober=lambda t: {"success": False,
                                                     "raw": "401 Bearer eyJsecretjwt api_key=AKIA"})
        self.assertNotIn("eyJsecretjwt", probe_result.detail)
        self.assertNotIn("AKIA", probe_result.detail)

    def test_truncate_detail_bounds_length(self):
        # PR #55 R3: the flood-protection half of _truncate_detail (redact then cap at 800).
        result = pf._truncate_detail("x" * 1000)
        self.assertTrue(result.endswith("… [truncated]"))
        self.assertLessEqual(len(result), pf.MAX_DETAIL_CHARS + len("… [truncated]"))

    def test_probe_is_healthy_accepts_real_tools_and_index_shapes(self):
        # PR #55 R3: production get-tool-contract returns an `index`-keyed payload (verified
        # live), but _probe_is_healthy also accepts the `tools` shape — cover BOTH positives
        # and the empty-payload negative so a regression on either branch is caught.
        self.assertTrue(pf._probe_is_healthy({"success": True, "data": {"index": {"get-tool-contract": {}}}}))
        self.assertTrue(pf._probe_is_healthy({"success": True, "data": {"tools": [{"name": "get-tool-contract"}]}}))
        self.assertFalse(pf._probe_is_healthy({"success": True, "data": {"tools": []}}))
        self.assertFalse(pf._probe_is_healthy({"success": True, "data": {"index": {}}}))

    def test_classify_bad_clio_cmd_maps_to_not_resolvable_without_probing(self):
        # PR #55 R3 (m-dymytrova) + my own review: the CLIO_CMD verify branch — the fix for
        # the ENG-92985 root cause (installed-but-not-on-PATH / typo'd CLIO_CMD) — had ZERO
        # coverage. A bogus CLIO_CMD must classify clio-not-resolvable and never probe.
        orig_env = os.environ.get("CLIO_CMD")
        probed = {"called": False}

        def guard_prober(timeout):
            probed["called"] = True
            return {"success": True}

        try:
            os.environ["CLIO_CMD"] = "definitely-not-a-real-binary-xyz"
            result = pf.classify(prober=guard_prober)
            self.assertEqual(result.state, pf.STATE_BLOCKED)
            self.assertEqual(result.reason, pf.REASON_NOT_RESOLVABLE)
            self.assertFalse(probed["called"], "a bogus CLIO_CMD must not reach the prober")
        finally:
            if orig_env is None:
                os.environ.pop("CLIO_CMD", None)
            else:
                os.environ["CLIO_CMD"] = orig_env

    def test_classify_clio_cmd_missing_dll_maps_to_not_resolvable(self):
        # PR #55 R3: the separate `.dll` token check in _verify_clio_cmd_exists.
        orig_env = os.environ.get("CLIO_CMD")
        try:
            os.environ["CLIO_CMD"] = f"{sys.executable} C:/nope/clio.dll"
            result = pf.classify(prober=lambda t: {"success": True})
            self.assertEqual(result.state, pf.STATE_BLOCKED)
            self.assertEqual(result.reason, pf.REASON_NOT_RESOLVABLE)
        finally:
            if orig_env is None:
                os.environ.pop("CLIO_CMD", None)
            else:
                os.environ["CLIO_CMD"] = orig_env

    def test_default_resolver_accepts_runnable_clio_cmd(self):
        # PR #55 R3: guard against over-eager rejection — a real, runnable CLIO_CMD passes.
        orig_env = os.environ.get("CLIO_CMD")
        try:
            os.environ["CLIO_CMD"] = sys.executable  # a real file on every platform
            pf._default_resolver()  # must not raise
        finally:
            if orig_env is None:
                os.environ.pop("CLIO_CMD", None)
            else:
                os.environ["CLIO_CMD"] = orig_env


if __name__ == "__main__":
    unittest.main()

import glob
import json
import os
import shutil
import subprocess
import tempfile
import unittest
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / "hooks" / "telemetry-routing.mjs"
NODE = shutil.which("node")
# The floor event carries `workflow`, which only a clio that ships the stage vocabulary
# accepts — an older release rejects it as unsupported-fields. So the end-to-end check runs
# against an explicitly nominated binary rather than whatever `clio` happens to be on PATH,
# and stays skipped until that clio is the installed one.
CLIO = os.environ.get("CAADT_TEST_CLIO")

_TMP = tempfile.mkdtemp(prefix="caadt-hook-tests-")


def _base_env() -> dict:
    return {
        k: v
        for k, v in os.environ.items()
        if k not in {"TMPDIR", "TMP", "TEMP", "CLIO_TELEMETRY_HOME", "CLIO_HOME"}
    }


def run_hook(
    payload: dict,
    *,
    telemetry_home: str,
    clio: str = "caadt-no-such-clio",
    host: str | None = None,
):
    """Invoke the hook exactly as Claude Code does: JSON on stdin, JSON on stdout.

    `telemetry_home` redirects clio's telemetry storage, so a test controls the consent
    state and can never read or write the developer's real telemetry. `clio` defaults to a
    name that does not exist, which exercises the floor-emit failure path without spawning
    anything; the integration test below points it at the real binary.
    """
    return subprocess.run(
        [NODE, str(HOOK)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=60,
        # A fresh TMPDIR per suite isolates the once-per-session marker files, so tests
        # cannot leak state into each other or into a developer's machine.
        env={
            **_base_env(),
            "TMPDIR": _TMP,
            "TMP": _TMP,
            "TEMP": _TMP,
            "CLIO_TELEMETRY_HOME": telemetry_home,
            "CAADT_TELEMETRY_CLIO": clio,
            **({"CAADT_TELEMETRY_HOOK_HOST": host} if host else {}),
        },
    )


def write_transcript() -> str:
    """A minimal stand-in for the host's session transcript.

    Two assistant turns, so the test proves the counters are SUMMED across the session and
    the model is taken from the latest turn rather than the first. A trailing partial line
    mimics a live session mid-flush, which the hook must skip instead of failing on.
    """
    lines = [
        json.dumps({"message": {"model": "claude-opus-5", "usage": {
            "input_tokens": 10, "output_tokens": 3,
            "cache_read_input_tokens": 500, "cache_creation_input_tokens": 100}}}),
        json.dumps({"type": "user", "message": {"content": "no usage on user turns"}}),
        json.dumps({"message": {"model": "claude-opus-5", "usage": {
            "input_tokens": 20, "output_tokens": 4,
            "cache_read_input_tokens": 600, "cache_creation_input_tokens": 0}}}),
        '{"message": {"model": "claude-opus-5", "usage": {"input_tok',
    ]
    path = Path(tempfile.mkdtemp(prefix="caadt-hook-transcript-", dir=_TMP), "session.jsonl")
    path.write_text("\n".join(lines), encoding="utf-8")
    return str(path)


def telemetry_home(consent: str | None) -> str:
    """A throwaway clio telemetry home, optionally with a stored consent decision."""
    home = tempfile.mkdtemp(prefix="caadt-hook-home-", dir=_TMP)
    if consent is not None:
        Path(home, "consent.json").write_text(
            json.dumps({"telemetry_consent": consent}), encoding="utf-8"
        )
    return home


class TelemetryRoutingHookWiringTests(unittest.TestCase):
    """The hook must be shipped and registered, or it silently does nothing."""

    def test_hook_is_registered_in_the_claude_plugin_manifest(self):
        manifest = json.loads((ROOT / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))

        # PostToolUse, not PreToolUse: the floor event should mean the clio call actually
        # happened, and a hook that spawns a process must not sit in front of the tool it
        # is observing.
        entries = manifest["hooks"]["PostToolUse"]
        commands = [hook["command"] for entry in entries for hook in entry["hooks"]]
        self.assertTrue(
            any("telemetry-routing.mjs" in command for command in commands),
            "the telemetry-routing hook must be wired into PostToolUse",
        )
        # Matching clio's MCP tools specifically: a broader matcher would emit a floor event
        # in sessions that never touch Creatio.
        self.assertTrue(
            any("clio" in entry["matcher"] for entry in entries),
            "the hook must be scoped to clio MCP tool calls",
        )

    def test_hook_directory_ships_with_the_plugin(self):
        # Hooks live in the plugin manifest, so ${CLAUDE_PLUGIN_ROOT}/hooks must be part of
        # the released payload. Without this entry the manifest would point at a file that
        # does not exist on an installed plugin.
        manifest = json.loads((ROOT / ".release-manifest.json").read_text(encoding="utf-8"))

        self.assertIn("hooks", manifest["plugin_runtime"])
        self.assertTrue(HOOK.exists())


@unittest.skipIf(NODE is None, "node is not available")
class TelemetryRoutingHookBehaviorTests(unittest.TestCase):
    """The hook is the guaranteed floor; it must never be able to break a tool call."""

    def test_routes_once_on_the_first_clio_call(self):
        session = str(uuid.uuid4())

        first = run_hook(
            {"session_id": session, "tool_name": "mcp__clio__clio-run"},
            telemetry_home=telemetry_home("granted"),
        )

        self.assertEqual(first.returncode, 0)
        payload = json.loads(first.stdout)["hookSpecificOutput"]
        self.assertEqual(payload["hookEventName"], "PostToolUse")
        context = payload["additionalContext"]
        # The session id must be handed over: the agent's stages have to land in the same
        # telemetry session as the floor event, or the two cannot be joined.
        self.assertIn(session, context)
        # And the agent must be told TO open its own start under its real workflow. clio keys
        # session state by the (session_id, workflow) pair, so that start is not a duplicate of
        # the floor's `unattributed` one — it is what gives the run a beginning at all. Telling
        # the agent to skip it produced a real run recorded as a build with no start.
        self.assertIn("DO emit your own `workflow_started`", context)
        self.assertNotIn("do NOT emit workflow_started", context)
        for workflow in ("classic-to-freedom-migration", "branding", "app-maintenance"):
            self.assertIn(workflow, context)
        self.assertIn("EVERY workflow", context)
        self.assertIn("does NOT exempt", context)
        self.assertIn("no skill loaded", context)
        # It routes to the vocabulary instead of restating it. This file ships inside an
        # installed plugin, so a copied stage list would outlive the clio release that
        # corrected it — the reminder must name the article, not the stages.
        self.assertIn("get-guidance name=product-telemetry", context)
        self.assertIn("Do not spell a stage from memory", context)
        # The per-flow counter-example must survive; it is what stops the invented name.
        self.assertIn("migration_plan_approved", context)
        residue = context.replace("migration_plan_approved", "").replace(
            "DO emit your own `workflow_started`", ""
        )
        for stage in ("plan_approved", "workflow_completed", "changes_applied"):
            self.assertNotIn(stage, residue)

    def test_stays_silent_on_later_calls_in_the_same_session(self):
        # The floor is one event per session. Repeating it would inflate the session count
        # and turn the reminder into noise the model learns to skip.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")

        run_hook({"session_id": session, "tool_name": "mcp__clio__clio-run"}, telemetry_home=home)
        second = run_hook(
            {"session_id": session, "tool_name": "mcp__clio__update-page"}, telemetry_home=home
        )

        self.assertEqual(second.returncode, 0)
        self.assertEqual(second.stdout.strip(), "")

    def test_emits_nothing_at_all_without_stored_consent(self):
        # The decision is stored per installation, so a hook answering on the developer's
        # behalf would settle consent for every future session on the machine. Unknown and
        # denied are both silence — no event, no reminder, and above all no prompt.
        for consent in (None, "denied"):
            with self.subTest(consent=consent):
                result = run_hook(
                    {"session_id": str(uuid.uuid4()), "tool_name": "mcp__clio__clio-run"},
                    telemetry_home=telemetry_home(consent),
                )

                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout.strip(), "")

    def test_still_routes_when_the_floor_emit_fails(self):
        # `clio` missing or broken must not swallow the routing: if the floor could not be
        # recorded, the agent's own stages are the only telemetry left, so it needs the
        # instructions more than ever.
        result = run_hook(
            {"session_id": str(uuid.uuid4()), "tool_name": "mcp__clio__clio-run"},
            telemetry_home=telemetry_home("granted"),
            clio="caadt-definitely-not-a-real-binary",
        )

        self.assertEqual(result.returncode, 0)
        self.assertIn("get-guidance name=product-telemetry", result.stdout)

    def test_ignores_non_clio_tools(self):
        result = run_hook(
            {"session_id": str(uuid.uuid4()), "tool_name": "Bash"},
            telemetry_home=telemetry_home("granted"),
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "")

    def test_does_not_react_to_the_telemetry_tools_themselves(self):
        # Emitting a floor event in reaction to a telemetry call would recurse, and
        # reminding a session that is already sending telemetry is circular.
        result = run_hook(
            {"session_id": str(uuid.uuid4()), "tool_name": "mcp__clio__send-telemetry"},
            telemetry_home=telemetry_home("granted"),
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "")

    def test_does_nothing_without_a_session_id(self):
        # Without the host session id there is nothing to join the agent's stages to, and
        # the once-per-session guard has no key — emitting would risk one event per call.
        result = run_hook(
            {"tool_name": "mcp__clio__clio-run"}, telemetry_home=telemetry_home("granted")
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "")

    def test_shapes_the_routing_per_host_and_stays_silent_where_it_cannot_speak(self):
        # Only the routing text is host-specific; the floor event is a side effect and
        # therefore identical everywhere. Cursor's afterMCPExecution is documented as
        # informational — it reaches neither the user nor the agent — so emitting anything
        # there would be stdout the host cannot use, and an unknown host gets silence rather
        # than a guessed shape.
        cases = {
            "claude": lambda out: json.loads(out)["hookSpecificOutput"]["additionalContext"],
            "codex": lambda out: json.loads(out)["systemMessage"],
        }
        for host, extract in cases.items():
            with self.subTest(host=host):
                result = run_hook(
                    {"session_id": str(uuid.uuid4()), "tool_name": "mcp__clio__clio-run"},
                    telemetry_home=telemetry_home("granted"),
                    host=host,
                )

                self.assertEqual(result.returncode, 0)
                self.assertIn("get-guidance name=product-telemetry", extract(result.stdout))

        for host in ("cursor", "some-future-host"):
            with self.subTest(host=host):
                result = run_hook(
                    {"session_id": str(uuid.uuid4()), "tool_name": "mcp__clio__clio-run"},
                    telemetry_home=telemetry_home("granted"),
                    host=host,
                )

                self.assertEqual(result.returncode, 0)
                self.assertEqual(result.stdout.strip(), "")

    def test_never_fails_the_tool_call_on_malformed_input(self):
        result = subprocess.run(
            [NODE, str(HOOK)],
            input="not json at all",
            capture_output=True,
            text=True,
            timeout=30,
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "")


class CursorTelemetryHookWiringTests(unittest.TestCase):
    """Cursor is the one host whose hook config the installer can write itself."""

    def setUp(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "caadt_installer", ROOT / "installer" / "install.py"
        )
        self.installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.installer)

    def test_registers_the_floor_hook_on_after_mcp_execution(self):
        cursor_home = Path(tempfile.mkdtemp(prefix="caadt-cursor-", dir=_TMP))
        plugin_dir = cursor_home / "plugins" / "local" / "toolkit"

        self.installer.merge_cursor_telemetry_hook(cursor_home, plugin_dir)

        config = json.loads((cursor_home / "hooks.json").read_text(encoding="utf-8"))
        entries = config["hooks"]["afterMCPExecution"]
        self.assertEqual(len(entries), 1)
        self.assertIn("telemetry-routing.mjs", entries[0]["command"])
        # The host must be declared, or the hook would emit Claude-shaped stdout into a
        # host that cannot read it.
        self.assertEqual(entries[0]["env"]["CAADT_TELEMETRY_HOOK_HOST"], "cursor")

    def test_preserves_other_hooks_and_does_not_duplicate_itself(self):
        # A reinstall must not stack copies of our entry, and must never drop a hook the
        # developer added themselves.
        cursor_home = Path(tempfile.mkdtemp(prefix="caadt-cursor-", dir=_TMP))
        (cursor_home / "hooks.json").write_text(
            json.dumps({
                "version": 1,
                "hooks": {
                    "afterMCPExecution": [{"command": "node ./their-own-audit.js"}],
                    "beforeShellExecution": [{"command": "node ./their-guard.js"}],
                },
            }),
            encoding="utf-8",
        )

        self.installer.merge_cursor_telemetry_hook(cursor_home, cursor_home / "plugin")
        self.installer.merge_cursor_telemetry_hook(cursor_home, cursor_home / "plugin")

        config = json.loads((cursor_home / "hooks.json").read_text(encoding="utf-8"))
        commands = [entry["command"] for entry in config["hooks"]["afterMCPExecution"]]
        self.assertEqual(sum("telemetry-routing.mjs" in c for c in commands), 1)
        self.assertIn("node ./their-own-audit.js", commands)
        self.assertIn("beforeShellExecution", config["hooks"])

    def test_leaves_a_broken_hooks_file_untouched(self):
        # A hand-broken hooks.json is the developer's file. Replacing it with our single
        # entry would delete configuration we cannot read but they can still fix.
        cursor_home = Path(tempfile.mkdtemp(prefix="caadt-cursor-", dir=_TMP))
        broken = '{"hooks": {"afterMCPExecution": [  // trailing comment\n'
        (cursor_home / "hooks.json").write_text(broken, encoding="utf-8")

        self.installer.merge_cursor_telemetry_hook(cursor_home, cursor_home / "plugin")

        self.assertEqual((cursor_home / "hooks.json").read_text(encoding="utf-8"), broken)


@unittest.skipIf(NODE is None or CLIO is None, "node and clio are both required")
class TelemetryRoutingHookFloorEmissionTests(unittest.TestCase):
    """The floor is the whole point: it must actually reach clio, not just be described."""

    def test_records_an_unattributed_session_start_through_clio(self):
        # End to end against the real clio, writing into a throwaway telemetry home. This is
        # what makes the floor a floor rather than a comment: with a skill loaded the agent
        # reports the full funnel, but a skill-less run was measured reporting nothing, and
        # this event is what remains countable in that case.
        session = str(uuid.uuid4())
        home = telemetry_home("granted")

        result = run_hook(
            {
                "session_id": session,
                "tool_name": "mcp__clio__clio-run",
                "transcript_path": write_transcript(),
            },
            telemetry_home=home,
            clio=CLIO,
        )

        self.assertEqual(result.returncode, 0)
        events = glob.glob(os.path.join(home, "events", "*.json"))
        self.assertEqual(len(events), 1, f"expected exactly one floor event, got {events}")
        stored = json.loads(Path(events[0]).read_text(encoding="utf-8-sig"))
        attributes = {
            item["key"]: next(iter(item["value"].values())) for item in stored["attributes"]
        }
        self.assertEqual(stored["event_name"], "workflow_started")
        self.assertEqual(attributes["session_id"], session)
        # Model and the running token counters come from the host's own session transcript,
        # which the payload points at. They are a snapshot: this hook fires on the first clio
        # call, so the numbers are small by construction — the value is the series, not this
        # one reading.
        self.assertEqual(attributes["model"], "claude-opus-5")
        self.assertEqual(int(attributes["input_tokens"]), 30)
        self.assertEqual(int(attributes["output_tokens"]), 7)
        self.assertEqual(int(attributes["cached_input_tokens"]), 1200)
        # `unattributed` is reserved for exactly this: a hook sees a tool name, not a
        # workflow, so a real-looking value would be a guess presented as data — and an
        # omitted one would break the contract's own "always send workflow" rule.
        self.assertEqual(attributes["workflow"], "unattributed")


if __name__ == "__main__":
    unittest.main()

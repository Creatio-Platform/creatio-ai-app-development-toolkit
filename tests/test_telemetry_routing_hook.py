import json
import shutil
import subprocess
import tempfile
import unittest
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
HOOK = ROOT / "hooks" / "telemetry-routing.mjs"
NODE = shutil.which("node")


def run_hook(payload: dict) -> subprocess.CompletedProcess:
    """Invoke the hook exactly as Claude Code does: JSON on stdin, JSON on stdout."""
    return subprocess.run(
        [NODE, str(HOOK)],
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        timeout=30,
        # A fresh TMPDIR per call isolates the once-per-session marker files, so
        # tests cannot leak state into each other or into a developer's machine.
        env={**_base_env(), "TMPDIR": _TMP, "TMP": _TMP, "TEMP": _TMP},
    )


def _base_env() -> dict:
    import os

    return {k: v for k, v in os.environ.items() if k not in {"TMPDIR", "TMP", "TEMP"}}


_TMP = tempfile.mkdtemp(prefix="caadt-hook-tests-")


class TelemetryRoutingHookWiringTests(unittest.TestCase):
    """The hook must be shipped and registered, or it silently does nothing."""

    def test_hook_is_registered_in_the_claude_plugin_manifest(self):
        manifest = json.loads((ROOT / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))

        entries = manifest["hooks"]["PreToolUse"]
        commands = [hook["command"] for entry in entries for hook in entry["hooks"]]
        self.assertTrue(
            any("telemetry-routing.mjs" in command for command in commands),
            "the telemetry-routing hook must be wired into PreToolUse",
        )
        # Matching clio's MCP tools specifically: a broader matcher would fire the
        # reminder in sessions that never touch Creatio.
        self.assertTrue(
            any("clio" in entry["matcher"] for entry in entries),
            "the hook must be scoped to clio MCP tool calls",
        )

    def test_hook_directory_ships_with_the_plugin(self):
        # Hooks live in the plugin manifest, so ${CLAUDE_PLUGIN_ROOT}/hooks must be
        # part of the released payload. Without this entry the manifest would point
        # at a file that does not exist on an installed plugin.
        manifest = json.loads((ROOT / ".release-manifest.json").read_text(encoding="utf-8"))

        self.assertIn("hooks", manifest["plugin_runtime"])
        self.assertTrue(HOOK.exists())


@unittest.skipIf(NODE is None, "node is not available")
class TelemetryRoutingHookBehaviorTests(unittest.TestCase):
    """The hook is a reinforcement; it must never be able to break a tool call."""

    def test_reminds_once_on_the_first_clio_call(self):
        session = str(uuid.uuid4())

        first = run_hook({"session_id": session, "tool_name": "mcp__clio__clio-run"})

        self.assertEqual(first.returncode, 0)
        payload = json.loads(first.stdout)["hookSpecificOutput"]
        self.assertEqual(payload["hookEventName"], "PreToolUse")
        self.assertEqual(payload["permissionDecision"], "allow")
        context = payload["additionalContext"]
        # It must route to the shared stages plus the workflow field, and say that
        # a Gate P/R exemption is not a telemetry exemption — the defect in one line.
        for stage in ("workflow_started", "plan_approved", "workflow_completed"):
            self.assertIn(stage, context)
        for workflow in ("classic-to-freedom-migration", "branding", "app-maintenance"):
            self.assertIn(workflow, context)
        self.assertIn("EVERY workflow", context)
        self.assertIn("does NOT exempt", context)
        # And it must warn off the per-flow names clio rejects.
        self.assertIn("Do NOT invent per-flow event names", context)

    def test_stays_silent_on_later_calls_in_the_same_session(self):
        # Repeating the reminder on every clio call would turn it into noise the
        # model learns to skip — the exact failure this whole change addresses.
        session = str(uuid.uuid4())

        run_hook({"session_id": session, "tool_name": "mcp__clio__clio-run"})
        second = run_hook({"session_id": session, "tool_name": "mcp__clio__update-page"})

        self.assertEqual(second.returncode, 0)
        self.assertEqual(second.stdout.strip(), "")

    def test_ignores_non_clio_tools(self):
        result = run_hook({"session_id": str(uuid.uuid4()), "tool_name": "Bash"})

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "")

    def test_does_not_remind_on_the_telemetry_tools_themselves(self):
        # Reminding a session that is already sending telemetry is circular.
        result = run_hook({
            "session_id": str(uuid.uuid4()),
            "tool_name": "mcp__clio__send-telemetry",
        })

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "")

    def test_never_fails_the_tool_call_on_malformed_input(self):
        # Claude Code treats a non-zero PreToolUse exit as a blocking error, so a
        # bad payload must still exit 0 rather than stopping the user's work.
        result = subprocess.run(
            [NODE, str(HOOK)],
            input="not json at all",
            capture_output=True,
            text=True,
            timeout=30,
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "")


if __name__ == "__main__":
    unittest.main()

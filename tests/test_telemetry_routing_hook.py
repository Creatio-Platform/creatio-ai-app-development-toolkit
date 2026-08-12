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


def run_hook(payload: dict, *, telemetry_home: str, clio: str = "caadt-no-such-clio"):
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
        },
    )


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
        # And the agent must be told NOT to re-send the start. clio keeps the session start
        # in a map keyed by event name, so a second one overwrites the anchor and every
        # elapsed-time measurement in the session shifts with it.
        self.assertIn("do NOT emit workflow_started again", context)
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
            "do NOT emit workflow_started again", ""
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
            {"session_id": session, "tool_name": "mcp__clio__clio-run"},
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
        # `unattributed` is reserved for exactly this: a hook sees a tool name, not a
        # workflow, so a real-looking value would be a guess presented as data — and an
        # omitted one would break the contract's own "always send workflow" rule.
        self.assertEqual(attributes["workflow"], "unattributed")


if __name__ == "__main__":
    unittest.main()

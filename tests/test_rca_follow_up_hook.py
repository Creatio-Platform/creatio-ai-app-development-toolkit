"""The follow-up hook, modules/rca/hooks/rca-follow-up.mjs, run as Claude Code runs a UserPromptSubmit hook: node, the
event as JSON on stdin, the answer on stdout.

Once a conversation has run the RCA agent, the hook adds one line of context to every later message, sending it back to
the `rca-orchestration` skill. Before that, and in a conversation that never used the agent, it prints nothing. The
transcripts here are written the way Claude Code records them: one JSON entry per line.
"""

import json
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path


def _root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "modules" / "rca" / "hooks" / "rca-follow-up.mjs").is_file():
            return parent
    raise RuntimeError("no folder above this test holds modules/rca/hooks/rca-follow-up.mjs")


ROOT = _root()
HOOK = ROOT / "modules" / "rca" / "hooks" / "rca-follow-up.mjs"
NODE = shutil.which("node")
# Where the RCA agent is developed the hook file is kept in modules/rca/hooks; the toolkit carries it at its root.
HOOKS_FILE = ROOT / "hooks" / "hooks.json" if (ROOT / "hooks" / "hooks.json").is_file() else ROOT / "modules" / "rca" / "hooks" / "hooks.json"


def _user(text):
    return {"type": "user", "message": {"role": "user", "content": text}}


def _tool_use(name, tool_input):
    return {"type": "assistant", "message": {"role": "assistant", "content": [
        {"type": "tool_use", "id": "toolu_1", "name": name, "input": tool_input}]}}


def _tool_result(text):
    return {"type": "user", "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "toolu_1", "content": text}]}}


# What every conversation of the plugin carries whether or not the agent ran: the skill listing names the skill too.
LISTING = {"type": "attachment", "attachment": {"type": "skill_listing",
                                               "content": "- rca-orchestration: Orchestrate a Root-Cause Analysis"}}


class _Transcript:
    def __init__(self, entries):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "session.jsonl"
        self.path.write_text("".join(json.dumps(e, separators=(",", ":")) + "\n" for e in entries), encoding="utf-8")

    def __enter__(self):
        return str(self.path)

    def __exit__(self, *exc):
        self.dir.cleanup()


def _run(stdin):
    return subprocess.run([NODE, str(HOOK)], input=stdin, capture_output=True, text=True, timeout=30)


def _context(transcript_path):
    run = _run(json.dumps({"hook_event_name": "UserPromptSubmit", "prompt": "and the list page?",
                           "transcript_path": transcript_path}))
    if run.returncode != 0:
        raise AssertionError(f"the hook exited {run.returncode}: {run.stderr}")
    if not run.stdout.strip():
        return None
    return json.loads(run.stdout)["hookSpecificOutput"]["additionalContext"]


@unittest.skipUnless(NODE, "node is not on PATH")
class FollowUpHookTests(unittest.TestCase):
    def test_silent_without_a_transcript(self):
        for stdin in ("", "not json", json.dumps({"prompt": "x"}), json.dumps({"transcript_path": "/no/such/file"})):
            run = _run(stdin)
            self.assertEqual(run.returncode, 0, stdin)
            self.assertEqual(run.stdout, "", stdin)

    def test_silent_when_the_skill_is_only_listed(self):
        with _Transcript([LISTING, _user("write me a script")]) as path:
            self.assertIsNone(_context(path))

    def test_silent_when_another_skill_or_server_ran(self):
        with _Transcript([LISTING, _tool_use("Skill", {"skill": "some-plugin:app-creation"}),
                          _tool_use("mcp__plugin_some-toolkit_clio__clio-run", {})]) as path:
            self.assertIsNone(_context(path))

    def test_silent_when_the_markers_appear_only_inside_a_tool_output(self):
        quoted = ('<command-message>x:rca-orchestration</command-message> '
                  + json.dumps(_tool_use("mcp__plugin_x_rca-files__get_text_file_content", {})))
        with _Transcript([LISTING, _tool_result(quoted)]) as path:
            self.assertIsNone(_context(path))

    def test_speaks_after_the_skill_ran_with_any_prefix(self):
        for skill in ("rca-orchestration", "some-plugin:rca-orchestration", "creatio-ai-app-development-toolkit:rca-orchestration"):
            with _Transcript([LISTING, _tool_use("Skill", {"skill": skill})]) as path:
                self.assertIn("`rca-orchestration`", _context(path) or "", skill)

    def test_speaks_after_the_skill_was_typed_as_a_slash_command(self):
        command = ("<command-message>some-plugin:rca-orchestration</command-message>\n"
                   "<command-name>/some-plugin:rca-orchestration</command-name>\n<command-args>why</command-args>")
        with _Transcript([LISTING, _user(command)]) as path:
            self.assertIsNotNone(_context(path))

    def test_speaks_after_a_call_to_an_rca_server(self):
        for tool in ("mcp__plugin_creatio-ai-app-development-toolkit_rca-creatio-http__creatio_list_records",
                     "mcp__plugin_creatio-ai-app-development-toolkit_rca-files__get_text_file_content",
                     "mcp__rca-creatio-gateway__creatio_list_records"):
            with _Transcript([LISTING, _tool_use(tool, {"objectCode": "ConfActivityLog"})]) as path:
                self.assertIsNotNone(_context(path), tool)

    def test_a_long_transcript_without_the_agent_is_read_quickly(self):
        filler = _tool_result("x" * 4000)
        with _Transcript([LISTING] + [filler] * 12000) as path:  # about 50 MB
            started = time.monotonic()
            self.assertIsNone(_context(path))
            self.assertLess(time.monotonic() - started, 5.0, "every message of every conversation waits for this hook")

    def test_registered_for_every_message(self):
        hooks = json.loads(HOOKS_FILE.read_text(encoding="utf-8"))["hooks"].get("UserPromptSubmit", [])
        commands = [h.get("command", "") for entry in hooks for h in entry["hooks"]]
        self.assertTrue(any("${CLAUDE_PLUGIN_ROOT}/modules/rca/hooks/rca-follow-up.mjs" in c for c in commands),
                        f"{HOOKS_FILE} does not run the follow-up hook")


if __name__ == "__main__":
    unittest.main()

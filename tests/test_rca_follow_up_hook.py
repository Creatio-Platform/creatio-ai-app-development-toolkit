"""The follow-up hook, modules/rca/hooks/rca-follow-up.mjs, run as Claude Code runs a UserPromptSubmit hook: node, the
event as JSON on stdin, the answer on stdout.

Once a conversation has run the RCA agent, the hook adds one line of context to every later message, sending it back to
the `rca-orchestration` skill. Before that, and in a conversation that never used the agent, it prints nothing. The
transcripts here are written the way Claude Code records them: one compact JSON entry per line.
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
HOOK_COMMAND = "${CLAUDE_PLUGIN_ROOT}/modules/rca/hooks/rca-follow-up.mjs"
CHUNK = 1 << 20  # the hook reads the transcript in chunks of this size


def _compact(entry):
    return json.dumps(entry, separators=(",", ":"), ensure_ascii=False)


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
SLASH_COMMAND = ("<command-message>some-plugin:rca-orchestration</command-message>\n"
                 "<command-name>/some-plugin:rca-orchestration</command-name>\n<command-args>why</command-args>")


class _Transcript:
    def __init__(self, entries=None, text=None):
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "session.jsonl"
        if text is None:
            text = "".join(_compact(e) + "\n" for e in entries)
        self.path.write_text(text, encoding="utf-8", newline="\n")

    def __enter__(self):
        return str(self.path)

    def __exit__(self, *exc):
        self.dir.cleanup()


def _run(stdin):
    return subprocess.run([NODE, str(HOOK)], input=stdin, capture_output=True, text=True, encoding="utf-8", timeout=30)


def _context(transcript_path):
    run = _run(json.dumps({"hook_event_name": "UserPromptSubmit", "prompt": "and the list page?",
                           "transcript_path": transcript_path}))
    if run.returncode != 0:
        raise AssertionError(f"the hook exited {run.returncode}: {run.stderr}")
    if not run.stdout.strip():
        return None
    return json.loads(run.stdout)["hookSpecificOutput"]["additionalContext"]


def _filler_line(length):
    """One transcript line of exactly `length` bytes (newline included) that does not show the agent at work."""
    head = _compact(_tool_result(""))
    pad = length - len(head) - 1
    return _compact(_tool_result("x" * pad)) + "\n"


def _hook_commands(hooks):
    return [h.get("command", "") for entry in hooks.get("UserPromptSubmit", []) for h in entry.get("hooks", [])]


@unittest.skipUnless(NODE, "node is not on PATH")
class FollowUpHookTests(unittest.TestCase):
    def test_silent_without_a_transcript(self):
        for stdin in ("", "not json", json.dumps({"prompt": "x"}), json.dumps({"transcript_path": "/no/such/file"})):
            run = _run(stdin)
            self.assertEqual(run.returncode, 0, stdin)
            self.assertEqual(run.stdout, "", stdin)

    def test_an_error_of_its_own_is_reported_on_stderr(self):
        run = _run(json.dumps({"transcript_path": "/no/such/file"}))
        self.assertEqual((run.returncode, run.stdout), (0, ""))
        self.assertIn("rca-follow-up hook", run.stderr)

    def test_silent_when_the_skill_is_only_listed(self):
        with _Transcript([LISTING, _user("write me a script")]) as path:
            self.assertIsNone(_context(path))

    def test_silent_when_another_skill_or_server_ran(self):
        for tool in ("mcp__plugin_some-toolkit_clio__clio-run", "mcp__orca-mcp__run", "mcp__plugin_x_circa-tools__get",
                     "mcp__rca-unknown__read"):
            with _Transcript([LISTING, _tool_use("Skill", {"skill": "some-plugin:app-creation"}),
                              _tool_use(tool, {})]) as path:
                self.assertIsNone(_context(path), tool)

    def test_silent_when_the_markers_appear_only_inside_a_tool_output(self):
        quoted = "\n".join([
            SLASH_COMMAND,
            _compact(_tool_use("Skill", {"skill": "x:rca-orchestration"})),
            _compact(_tool_use("mcp__plugin_x_rca-files__get_text_file_content", {})),
            _compact(_user(SLASH_COMMAND)),
        ])
        with _Transcript([LISTING, _tool_result(quoted)]) as path:
            self.assertIsNone(_context(path))

    def test_speaks_after_the_skill_ran_with_any_prefix(self):
        for skill in ("rca-orchestration", "some-plugin:rca-orchestration", "creatio-ai-app-development-toolkit:rca-orchestration"):
            with _Transcript([LISTING, _tool_use("Skill", {"skill": skill})]) as path:
                self.assertIn("`rca-orchestration`", _context(path) or "", skill)

    def test_speaks_whatever_the_order_of_the_recorded_fields(self):
        part = {"input": {"args": "why", "command": "rca-orchestration"}, "name": "Skill", "id": "toolu_9", "type": "tool_use"}
        entry = {"message": {"content": [part], "role": "assistant"}, "type": "assistant"}
        with _Transcript([LISTING, entry]) as path:
            self.assertIsNotNone(_context(path))

    def test_speaks_after_the_skill_was_typed_as_a_slash_command(self):
        for content in (SLASH_COMMAND, [{"type": "text", "text": SLASH_COMMAND}],
                        "<command-name>/rca-orchestration</command-name>\n<command-args>why</command-args>"):
            with _Transcript([LISTING, _user(content)]) as path:
                self.assertIsNotNone(_context(path), content)

    def test_speaks_after_a_call_to_an_rca_server(self):
        for tool in ("mcp__plugin_creatio-ai-app-development-toolkit_rca-creatio-http__creatio_list_records",
                     "mcp__plugin_creatio-ai-app-development-toolkit_rca-files__get_text_file_content",
                     "mcp__plugin_rca-ai-agent_rca-creatio-gateway__creatio_list_records",
                     "mcp__rca-creatio-gateway__creatio_list_records"):
            with _Transcript([LISTING, _tool_use(tool, {"objectCode": "ConfActivityLog"})]) as path:
                self.assertIsNotNone(_context(path), tool)

    def test_speaks_when_the_sign_is_past_the_first_chunk(self):
        marker = _compact(_tool_use("Skill", {"skill": "rca-orchestration"})) + "\n"
        filler = _filler_line(4096) * (CHUNK // 4096 + 3)
        with _Transcript(text=_compact(LISTING) + "\n" + filler + marker) as path:
            self.assertIsNotNone(_context(path))

    def test_speaks_when_the_sign_straddles_a_chunk_boundary(self):
        marker = _compact(_tool_use("mcp__rca-creatio-gateway__creatio_list_records", {})) + "\n"
        for cut in (1, len(marker) // 3, len(marker) // 2, len(marker) - 2):
            filler = _filler_line(CHUNK - cut)  # the marker line starts `cut` bytes before the end of the first chunk
            with _Transcript(text=filler + marker) as path:
                self.assertIsNotNone(_context(path), f"marker cut {cut} bytes into its line")

    def test_a_long_transcript_without_the_agent_stays_cheap(self):
        # About 20 MB of lines that name the RCA tools without using them, so the hook has to parse them. Measured at
        # about 100 ms; the bound catches a scan that became an order of magnitude slower, not a slow machine, and stays
        # well under the 10 s timeout the hook is registered with.
        quoting = _tool_result("the agent may call mcp__rca-creatio-gateway__creatio_list_records " + "x" * 4000)
        with _Transcript([LISTING] + [quoting] * 5000) as path:
            started = time.monotonic()
            self.assertIsNone(_context(path))
            self.assertLess(time.monotonic() - started, 5.0, "every message of every conversation waits for this hook")

    def test_registered_for_every_message(self):
        # The hook file Claude Code loads: the plugin's root hooks/hooks.json when there is one, else the manifest.
        root_hooks = ROOT / "hooks" / "hooks.json"
        if root_hooks.is_file():
            loaded, hooks = root_hooks, json.loads(root_hooks.read_text(encoding="utf-8"))["hooks"]
        else:
            loaded = ROOT / ".claude-plugin" / "plugin.json"
            hooks = json.loads(loaded.read_text(encoding="utf-8")).get("hooks", {})
        self.assertTrue(any(HOOK_COMMAND in c for c in _hook_commands(hooks)), f"{loaded} does not run the follow-up hook")
        # Where the RCA agent is developed, modules/rca/hooks/hooks.json is the source the toolkit's hook file is copied from.
        source = ROOT / "modules" / "rca" / "hooks" / "hooks.json"
        if source.is_file():
            hooks = json.loads(source.read_text(encoding="utf-8"))["hooks"]
            self.assertTrue(any(HOOK_COMMAND in c for c in _hook_commands(hooks)), f"{source} does not run the follow-up hook")


if __name__ == "__main__":
    unittest.main()

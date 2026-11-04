"""The RCA agent's read-only contract: one list of read tools, applied on every host.

The "Allowed" list in skills/rca-safety-and-access/SKILL.md names the tools the agent may call. Codex applies it as
`enabled_tools` (modules/rca/mcp/codex.json), Copilot CLI as `tools` (modules/rca/mcp/copilot.json), and Claude Code
through a PreToolUse hook of the plugin (hooks/hooks.json, running modules/rca/hooks/rca-readonly-guard.mjs), which
reads codex.json's list. These tests keep the lists equal, check that the hook is registered, and run the hook on
sample tool names.
"""

import json
import re
import shutil
import subprocess
import unittest
from pathlib import Path


def _root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "modules" / "rca").is_dir() and (parent / "skills" / "rca-safety-and-access").is_dir():
            return parent
    raise RuntimeError("no folder above this test holds both modules/rca and skills/rca-safety-and-access")


ROOT = _root()
RCA = ROOT / "modules" / "rca"
SAFETY_SKILL = ROOT / "skills" / "rca-safety-and-access" / "SKILL.md"
GUARD = RCA / "hooks" / "rca-readonly-guard.mjs"
GUARD_HOOKS = RCA / "hooks" / "hooks.json"
SERVERS = ("rca-creatio-http", "rca-files")
PLUGIN_PREFIX = "mcp__plugin_creatio-ai-app-development-toolkit_"


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _servers(name: str) -> dict:
    return _load(RCA / "mcp" / name)["mcpServers"]


def _skill_allowed() -> set:
    text = SAFETY_SKILL.read_text(encoding="utf-8")
    section = re.search(r"^## Allowed[^\n]*\n(.*?)^## ", text, re.S | re.M)
    if section is None:
        raise AssertionError(f"{SAFETY_SKILL}: no '## Allowed' section")
    return set(re.findall(r"^- `([^`]+)`", section.group(1), re.M))


class ReadOnlyToolListsTests(unittest.TestCase):
    def test_codex_and_copilot_apply_the_skill_list(self):
        allowed = _skill_allowed()
        self.assertTrue(allowed, "the Allowed list of rca-safety-and-access is empty")
        codex, copilot = _servers("codex.json"), _servers("copilot.json")
        for server in SERVERS:
            with self.subTest(server=server):
                self.assertEqual(set(codex[server]["enabled_tools"]), set(copilot[server]["tools"]))
        listed = set().union(*(codex[server]["enabled_tools"] for server in SERVERS))
        self.assertEqual(listed, allowed, "the hosts' tool lists and the skill's Allowed list differ")

    def test_every_claude_server_is_guarded(self):
        self.assertLessEqual(set(_servers("claude.json")), set(SERVERS),
                             "a server in claude.json that the read-only guard does not cover")


class GuardRegistrationTests(unittest.TestCase):
    def _hooks_file(self) -> Path:
        # Where the plugin declares the RCA servers, Claude Code loads its hooks from hooks/hooks.json at the plugin's
        # root, beside the hooks in the manifest. Elsewhere the file is checked where it is kept, in modules/rca.
        manifest = _load(ROOT / ".claude-plugin" / "plugin.json")
        return ROOT / "hooks" / "hooks.json" if manifest.get("mcpServers") == "./modules/rca/mcp/claude.json" else GUARD_HOOKS

    def test_hook_entry_points_at_the_guard(self):
        hooks_file = self._hooks_file()
        self.assertTrue(hooks_file.is_file(), f"{hooks_file} is missing: Claude Code would run without the guard")
        entries = _load(hooks_file)["hooks"]["PreToolUse"]
        self.assertEqual(len(entries), 1)
        matcher = re.compile(entries[0]["matcher"])
        for server in SERVERS:
            self.assertTrue(matcher.fullmatch(f"{PLUGIN_PREFIX}{server}__any_tool"), server)
        self.assertFalse(matcher.fullmatch("mcp__clio__clio-run"))
        self.assertIn("${CLAUDE_PLUGIN_ROOT}/modules/rca/hooks/rca-readonly-guard.mjs", entries[0]["hooks"][0]["command"])


@unittest.skipUnless(shutil.which("node"), "node is not on PATH")
class GuardBehaviourTests(unittest.TestCase):
    def _decide(self, tool_name: str):
        run = subprocess.run(["node", str(GUARD)], input=json.dumps({"tool_name": tool_name}),
                             capture_output=True, text=True, timeout=30, check=True)
        if not run.stdout.strip():
            return None
        return json.loads(run.stdout)["hookSpecificOutput"]["permissionDecision"]

    def test_read_tools_go_on(self):
        codex = _servers("codex.json")
        for server in SERVERS:
            for tool in codex[server]["enabled_tools"]:
                with self.subTest(tool=tool):
                    self.assertIsNone(self._decide(f"{PLUGIN_PREFIX}{server}__{tool}"))

    def test_other_tools_of_the_rca_servers_are_denied(self):
        for name in (
            f"{PLUGIN_PREFIX}rca-creatio-http__creatio_create_record",
            f"{PLUGIN_PREFIX}rca-creatio-http__execute-process",
            f"{PLUGIN_PREFIX}rca-creatio-http__a_tool_added_later",
            f"{PLUGIN_PREFIX}rca-files__any_other_tool",
            "mcp__rca-creatio-http__creatio_update_record",
        ):
            with self.subTest(name=name):
                self.assertEqual(self._decide(name), "deny")

    def test_input_that_is_not_a_tool_call_is_denied(self):
        for stdin in ("not json", "{}", '{"tool_name": 5}'):
            with self.subTest(stdin=stdin):
                run = subprocess.run(["node", str(GUARD)], input=stdin, capture_output=True, text=True, timeout=30,
                                     check=True)
                self.assertEqual(json.loads(run.stdout)["hookSpecificOutput"]["permissionDecision"], "deny")

    def test_other_servers_are_left_alone(self):
        for name in ("mcp__clio__clio-run", f"{PLUGIN_PREFIX}clio__clio-run", "Bash"):
            with self.subTest(name=name):
                self.assertIsNone(self._decide(name))


if __name__ == "__main__":
    unittest.main()

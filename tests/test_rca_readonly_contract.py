"""The RCA agent's read-only contract: one list of read tools, applied on every host.

The "Allowed" list in skills/rca-safety-and-access/SKILL.md names the tools the agent may call. Codex applies it as
`enabled_tools` (modules/rca/mcp/codex.json), Copilot CLI as `tools` (modules/rca/mcp/copilot.json, which the toolkit's
root .mcp.json carries, since Copilot reads only that file), and Claude Code through a PreToolUse hook of the plugin
(hooks/hooks.json, running modules/rca/hooks/rca-readonly-guard.mjs), which reads codex.json's list. These tests keep
the host files equal where they must be, check that the hook is registered, run the hook on sample tool names, and
check that the toolkit's installer keeps the RCA servers away from Cursor, which has no allow-list.
"""

import importlib.util
import json
import re
import shutil
import subprocess
import tempfile
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
INSTALLER = ROOT / "installer" / "install.py"
SERVERS = ("rca-creatio-http", "rca-files")
HTTP, FILES = SERVERS
SCRIPT = "modules/rca/scripts/rca-files-mcp.mjs"
PLUGIN_PREFIX = "mcp__plugin_creatio-ai-app-development-toolkit_"
NODE = shutil.which("node")


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _servers(path: Path) -> dict:
    return _load(path)["mcpServers"]


def _host(name: str) -> dict:
    return _servers(RCA / "mcp" / name)


def _root_mcp() -> dict:
    path = ROOT / ".mcp.json"
    return _servers(path) if path.is_file() else {}


# The toolkit: its root .mcp.json carries the RCA servers. This test also runs where the RCA agent is developed, whose
# root .mcp.json does not; the cases about the toolkit's own files are skipped there.
IN_TOOLKIT = HTTP in _root_mcp()


def _rca(servers: dict) -> dict:
    return {name: config for name, config in servers.items() if name.startswith("rca-")}


def _skill_allowed() -> set:
    text = SAFETY_SKILL.read_text(encoding="utf-8")
    section = re.search(r"^## Allowed[^\n]*\n(.*?)^## ", text, re.S | re.M)
    if section is None:
        raise AssertionError(f"{SAFETY_SKILL}: no '## Allowed' section")
    return set(re.findall(r"^- `([^`]+)`", section.group(1), re.M))


def _variable(value: str) -> str:
    """The variable a header takes its value from: `${NAME}` (Claude Code, Copilot) or `NAME` (Codex)."""
    match = re.fullmatch(r"\$\{([^}]+)\}", value)
    return match.group(1) if match else value


def _host_files() -> dict:
    files = {"claude.json": _host("claude.json"), "codex.json": _host("codex.json"), "copilot.json": _host("copilot.json")}
    if IN_TOOLKIT:
        files[".mcp.json"] = _root_mcp()
    return files


class HostFilesTests(unittest.TestCase):
    def test_every_host_file_declares_the_same_rca_servers(self):
        for name, servers in _host_files().items():
            with self.subTest(file=name):
                self.assertEqual(set(_rca(servers)), set(SERVERS))
        self.assertEqual(set(_host("claude.json")), set(SERVERS), "claude.json declares a server the guard does not cover")

    def test_tool_lists_equal_the_skill_allowed_list(self):
        allowed = _skill_allowed()
        self.assertTrue(allowed, "the Allowed list of rca-safety-and-access is empty")
        codex = _host("codex.json")
        lists = {"copilot.json": _host("copilot.json")}
        if IN_TOOLKIT:
            lists[".mcp.json"] = _root_mcp()
        for server in SERVERS:
            for name, servers in lists.items():
                with self.subTest(server=server, file=name):
                    self.assertEqual(set(servers[server]["tools"]), set(codex[server]["enabled_tools"]))
        listed = set().union(*(codex[server]["enabled_tools"] for server in SERVERS))
        self.assertEqual(listed, allowed, "the hosts' tool lists and the skill's Allowed list differ")

    def test_headers_take_the_same_variables(self):
        expected = {name: _variable(value) for name, value in _host("codex.json")[HTTP]["env_http_headers"].items()}
        self.assertEqual(set(expected), {"X-Creatio-Base-Url", "X-Creatio-Client-Id"})
        for name, servers in _host_files().items():
            if name == "codex.json":
                continue
            with self.subTest(file=name):
                headers = servers[HTTP]["headers"]
                self.assertEqual({key: _variable(value) for key, value in headers.items()}, expected)

    def test_the_files_server_runs_the_same_script(self):
        for name, servers in _host_files().items():
            with self.subTest(file=name):
                server = servers[FILES]
                self.assertEqual(server["command"], "node")
                self.assertTrue(server["args"][-1].replace("\\", "/").endswith(SCRIPT), server["args"])
        self.assertLessEqual({"CREATIO_BASE_URL", "CREATIO_LOGIN", "CREATIO_PASSWORD"},
                             set(_host("codex.json")[FILES]["env_vars"]))

    @unittest.skipUnless(IN_TOOLKIT, "the toolkit's root .mcp.json is not here")
    def test_root_mcp_json_carries_the_copilot_servers_as_they_are(self):
        self.assertEqual(_rca(_root_mcp()), _host("copilot.json"))
        manifest = _load(ROOT / ".github" / "plugin" / "plugin.json")
        self.assertEqual(manifest["mcpServers"], "./.mcp.json")

    @unittest.skipUnless(IN_TOOLKIT, "the toolkit's plugin manifests are not here")
    def test_codex_gets_the_toolkit_clio(self):
        manifest = _load(ROOT / ".codex-plugin" / "plugin.json")
        self.assertEqual(manifest["mcpServers"], "./modules/rca/mcp/codex.json")
        self.assertEqual(_host("codex.json")["clio"], _root_mcp()["clio"])

    @unittest.skipUnless(IN_TOOLKIT, "the toolkit's plugin manifests are not here")
    def test_claude_code_gets_the_rca_servers(self):
        manifest = _load(ROOT / ".claude-plugin" / "plugin.json")
        self.assertEqual(manifest["mcpServers"], "./modules/rca/mcp/claude.json")


def _guard_entries() -> list:
    """The PreToolUse entries that run the guard. The plugin loads hooks/hooks.json at its root; where the RCA agent is
    developed the file is kept in modules/rca/hooks and copied to the toolkit's root."""
    hooks_file = ROOT / "hooks" / "hooks.json" if IN_TOOLKIT else RCA / "hooks" / "hooks.json"
    if not hooks_file.is_file():
        raise AssertionError(f"{hooks_file} is missing: Claude Code would run without the guard")
    return [entry for entry in _load(hooks_file)["hooks"].get("PreToolUse", [])
            if any("rca-readonly-guard.mjs" in hook.get("command", "") for hook in entry["hooks"])]


class GuardRegistrationTests(unittest.TestCase):
    def _entry(self) -> dict:
        entries = _guard_entries()
        self.assertEqual(len(entries), 1, "the guard is registered once")
        return entries[0]

    def test_the_hook_runs_the_guard_and_blocks_when_it_cannot_start(self):
        command = self._entry()["hooks"][0]["command"]
        self.assertIn("${CLAUDE_PLUGIN_ROOT}/modules/rca/hooks/rca-readonly-guard.mjs", command)
        self.assertTrue(command.rstrip().endswith("|| exit 2"), "without node the call would go on: exit 2 blocks it")

    def test_the_matcher_covers_the_rca_servers_only(self):
        matcher = re.compile(self._entry()["matcher"])
        for server in SERVERS:
            self.assertTrue(matcher.fullmatch(f"{PLUGIN_PREFIX}{server}__any_tool"), server)
        self.assertFalse(matcher.fullmatch("mcp__clio__clio-run"))


@unittest.skipUnless(NODE, "node is not on PATH")
class GuardBehaviourTests(unittest.TestCase):
    def _run(self, stdin: str, guard: Path = GUARD):
        run = subprocess.run([NODE, str(guard)], input=stdin, capture_output=True, text=True, timeout=30)
        self.assertEqual(run.returncode, 0, run.stderr)
        if not run.stdout.strip():
            return None
        return json.loads(run.stdout)["hookSpecificOutput"]["permissionDecision"]

    def _decide(self, tool_name: str, guard: Path = GUARD):
        return self._run(json.dumps({"tool_name": tool_name}), guard)

    def test_read_tools_go_on(self):
        codex = _host("codex.json")
        for server in SERVERS:
            for tool in codex[server]["enabled_tools"]:
                for prefix in (PLUGIN_PREFIX, "mcp__", "mcp__plugin_a_plugin_with_underscores_"):
                    with self.subTest(tool=tool, prefix=prefix):
                        self.assertIsNone(self._decide(f"{prefix}{server}__{tool}"))

    def test_other_tools_of_the_rca_servers_are_denied(self):
        for name in (
            f"{PLUGIN_PREFIX}{HTTP}__creatio_create_record",
            f"{PLUGIN_PREFIX}{HTTP}__execute-process",
            f"{PLUGIN_PREFIX}{HTTP}__a_tool_added_later",
            f"{PLUGIN_PREFIX}{FILES}__any_other_tool",
            f"mcp__{HTTP}__creatio_update_record",
        ):
            with self.subTest(name=name):
                self.assertEqual(self._decide(name), "deny")

    def test_a_name_the_matcher_sends_but_the_guard_cannot_read_is_denied(self):
        matcher = re.compile(_guard_entries()[0]["matcher"])
        for name in (f"mcp__other_{FILES}__get_text_file_content", f"mcp__x{HTTP}__creatio_get_record", f"mcp__{FILES}__"):
            with self.subTest(name=name):
                self.assertTrue(matcher.fullmatch(name), "the sample must be a name the hook sends to the guard")
                self.assertEqual(self._decide(name), "deny")

    def test_input_that_is_not_a_tool_call_is_denied(self):
        for stdin in ("not json", "{}", '{"tool_name": 5}'):
            with self.subTest(stdin=stdin):
                self.assertEqual(self._run(stdin), "deny")

    def test_a_list_that_cannot_be_read_denies_every_rca_tool(self):
        for codex in ("not json", '{"mcpServers": {"rca-files": {"enabled_tools": "get_text_file_content"}}}'):
            with self.subTest(codex=codex), tempfile.TemporaryDirectory() as temp:
                (Path(temp) / "hooks").mkdir()
                (Path(temp) / "mcp").mkdir()
                guard = Path(temp) / "hooks" / GUARD.name
                shutil.copyfile(GUARD, guard)
                (Path(temp) / "mcp" / "codex.json").write_text(codex, encoding="utf-8")
                self.assertEqual(self._decide(f"{PLUGIN_PREFIX}{FILES}__get_text_file_content", guard), "deny")

    def test_other_servers_are_left_alone(self):
        for name in ("mcp__clio__clio-run", f"{PLUGIN_PREFIX}clio__clio-run", "Bash"):
            with self.subTest(name=name):
                self.assertIsNone(self._decide(name))


@unittest.skipUnless(IN_TOOLKIT and INSTALLER.is_file(), "the toolkit's installer is not here")
class CursorInstallTests(unittest.TestCase):
    def test_the_installer_gives_cursor_no_rca_server(self):
        # Cursor has no allow-list or guard for the RCA servers, so neither file it reads servers from gets them:
        # its own mcp.json and the MCP file the installed plugin's Cursor manifest names.
        spec = importlib.util.spec_from_file_location("caadt_installer_for_rca", INSTALLER)
        installer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(installer)
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            installer.install_cursor(ROOT, home)
            plugin = home / ".cursor" / "plugins" / "local" / installer.PLUGIN_NAME
            manifest = json.loads((plugin / ".cursor-plugin" / "plugin.json").read_text(encoding="utf-8"))
            files = {
                "~/.cursor/mcp.json": _servers(home / ".cursor" / "mcp.json"),
                "the installed plugin's MCP file": _servers(plugin / manifest["mcpServers"]),
            }
        for name, servers in files.items():
            with self.subTest(name):
                self.assertIn("clio", servers)
                self.assertEqual(_rca(servers), {})


if __name__ == "__main__":
    unittest.main()

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
INSTALLER_PATH = ROOT / "installer/install.py"


def load_installer():
    spec = importlib.util.spec_from_file_location("adac_installer", INSTALLER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_required_references(installer, repo_root):
    for relative_path in installer.REQUIRED_REFERENCE_PATHS:
        path = repo_root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("reference\n", encoding="utf-8")


def write_release_manifest(repo_root, plugin_runtime=None):
    paths = plugin_runtime if plugin_runtime is not None else [
        "AGENTS.md",
        ".mcp.json",
        ".agents",
        ".claude-plugin",
        ".codex-plugin",
        ".cursor-plugin",
        ".github/plugin",
        "context",
        "rules",
        "runbooks",
        "runtime",
        "skills",
    ]
    manifest_path = repo_root / ".release-manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps({"plugin_runtime": paths, "release_extras": ["installer", "RELEASE-NOTES.md"]}) + "\n",
        encoding="utf-8",
    )


def write_minimal_plugin_checkout(repo_root):
    """Lay out the files the install_* functions read from the local checkout."""
    (repo_root / ".mcp.json").write_text(
        '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
        encoding="utf-8",
    )
    (repo_root / ".github" / "plugin").mkdir(parents=True, exist_ok=True)
    (repo_root / ".github" / "plugin" / "plugin.json").write_text(
        '{"name":"creatio-ai-app-development-toolkit","version":"0.1.0"}\n',
        encoding="utf-8",
    )
    skill_dir = repo_root / "skills" / "creatio-app-orchestrator"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: creatio-app-orchestrator\ndescription: test\n---\n",
        encoding="utf-8",
    )


class ConstantsTests(unittest.TestCase):
    def test_marketplace_git_url_is_hardcoded_ghe(self):
        installer = load_installer()
        self.assertEqual(
            installer.MARKETPLACE_GIT_URL,
            "https://creatio.ghe.com/engineering/ai-driven-app-creation.git",
        )

    def test_plugin_source_combines_plugin_and_marketplace(self):
        installer = load_installer()
        self.assertEqual(
            installer.PLUGIN_SOURCE,
            "creatio-ai-app-development-toolkit@creatio",
        )

    def test_install_py_does_not_expose_removed_helpers(self):
        installer = load_installer()
        for removed_name in (
            "DEFAULT_REPO_URL",
            "DEFAULT_INSTALL_ROOT",
            "clone_or_update_repo",
            "render_copilot_skill",
            "copy_mcp_config",
            "copy_plugin_runtime_surface_for_claude",
            "merge_claude_plugin_settings",
            "register_claude_known_marketplace",
            "register_claude_installed_plugin",
            "prune_directory_entries",
            "preflight_codex",
            "resolve_codex_command",
        ):
            self.assertFalse(
                hasattr(installer, removed_name),
                f"{removed_name} should have been removed",
            )


class DetectTargetsTests(unittest.TestCase):
    def test_detects_all_four_when_home_dirs_present(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            (home / ".codex").mkdir()
            (home / ".claude").mkdir()
            (home / ".cursor").mkdir()
            (home / ".copilot").mkdir()

            targets = installer.detect_targets(home)

        self.assertEqual({target["id"] for target in targets}, {"codex", "claude", "cursor", "copilot"})

    def test_skips_targets_without_home_dirs(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            targets = installer.detect_targets(Path(temp))
        self.assertEqual(targets, [])


class CliPreflightTests(unittest.TestCase):
    def test_preflight_claude_reports_missing_path(self):
        installer = load_installer()
        with patch("shutil.which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "claude was not found in PATH"):
                installer.preflight_claude()

    def test_preflight_copilot_reports_missing_path(self):
        installer = load_installer()
        with patch("shutil.which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "copilot was not found in PATH"):
                installer.preflight_copilot()

    def test_preflight_clio_reports_missing_path(self):
        installer = load_installer()
        with patch("shutil.which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "clio was not found in PATH"):
                installer.preflight_clio()

    def test_resolve_copilot_command_wraps_powershell_shim_on_windows(self):
        installer = load_installer()
        with patch.object(installer, "preflight_copilot", return_value=r"C:\nvm4w\nodejs\copilot.ps1"):
            command = installer.resolve_copilot_command()
        self.assertEqual(
            command,
            ["powershell", "-ExecutionPolicy", "Bypass", "-File", r"C:\nvm4w\nodejs\copilot.ps1"],
        )

    def test_resolve_claude_command_wraps_powershell_shim(self):
        installer = load_installer()
        with patch.object(installer, "preflight_claude", return_value=r"C:\tools\claude.ps1"):
            command = installer.resolve_claude_command()
        self.assertEqual(
            command,
            ["powershell", "-ExecutionPolicy", "Bypass", "-File", r"C:\tools\claude.ps1"],
        )

class RegisterRemoteMarketplaceTests(unittest.TestCase):
    def test_runs_marketplace_add_then_plugin_install(self):
        installer = load_installer()
        commands = []

        def fake_run(command, **_kwargs):
            commands.append(command)

        with patch.object(installer, "run_checked", side_effect=fake_run):
            installer.register_remote_marketplace_and_install_plugin(["claude"])

        self.assertEqual(
            commands,
            [
                ["claude", "plugin", "marketplace", "add", installer.MARKETPLACE_GIT_URL],
                ["claude", "plugin", "install", installer.PLUGIN_SOURCE],
            ],
        )

    def test_removes_and_re_adds_when_marketplace_already_registered(self):
        installer = load_installer()
        commands = []
        attempt = {"count": 0}

        def fake_run(command, **_kwargs):
            commands.append(command)
            if command[1:4] == ["plugin", "marketplace", "add"]:
                attempt["count"] += 1
                if attempt["count"] == 1:
                    raise RuntimeError(
                        'copilot plugin marketplace add failed: Marketplace "creatio" already registered'
                    )

        with patch.object(installer, "run_checked", side_effect=fake_run):
            installer.register_remote_marketplace_and_install_plugin(["copilot"])

        self.assertEqual(len(commands), 4)
        self.assertEqual(commands[0][1:4], ["plugin", "marketplace", "add"])
        self.assertEqual(commands[1][1:5], ["plugin", "marketplace", "remove", "creatio"])
        self.assertEqual(commands[2][1:4], ["plugin", "marketplace", "add"])
        self.assertEqual(commands[3][1:3], ["plugin", "install"])

    def test_tolerates_remove_failure_during_re_add(self):
        installer = load_installer()
        commands = []
        attempt = {"count": 0}

        def fake_run(command, **_kwargs):
            commands.append(command)
            if command[1:4] == ["plugin", "marketplace", "add"]:
                attempt["count"] += 1
                if attempt["count"] == 1:
                    raise RuntimeError('Marketplace "creatio" already registered')
            elif command[1:4] == ["plugin", "marketplace", "remove"]:
                raise RuntimeError("not found")

        with patch.object(installer, "run_checked", side_effect=fake_run), patch("builtins.print"):
            installer.register_remote_marketplace_and_install_plugin(["copilot"])

        self.assertEqual(len(commands), 4)
        self.assertEqual(commands[-1][1:3], ["plugin", "install"])

    def test_raises_for_unexpected_marketplace_add_error(self):
        installer = load_installer()

        def fake_run(command, **_kwargs):
            if command[1:4] == ["plugin", "marketplace", "add"]:
                raise RuntimeError("network unreachable")

        with patch.object(installer, "run_checked", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "network unreachable"):
                installer.register_remote_marketplace_and_install_plugin(["claude"])

    def test_ignores_unrelated_already_registered_error(self):
        installer = load_installer()

        def fake_run(command, **_kwargs):
            if command[1:4] == ["plugin", "marketplace", "add"]:
                raise RuntimeError('Plugin "other" already registered')

        with patch.object(installer, "run_checked", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "already registered"):
                installer.register_remote_marketplace_and_install_plugin(["claude"])


class InstallClaudeTests(unittest.TestCase):
    def test_shells_out_and_enables_auto_update(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            write_minimal_plugin_checkout(repo_root)
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)
            home = Path(temp) / "home"
            (home / ".claude").mkdir(parents=True)

            commands = []

            def fake_run(command, **_kwargs):
                commands.append(command)

            with patch.object(installer, "preflight_claude", return_value="claude"), patch.object(
                installer, "run_checked", side_effect=fake_run
            ):
                installer.install_claude(repo_root, home)

            self.assertEqual(
                commands,
                [
                    ["claude", "plugin", "marketplace", "add", installer.MARKETPLACE_GIT_URL],
                    ["claude", "plugin", "install", installer.PLUGIN_SOURCE],
                ],
            )

            settings = json.loads((home / ".claude" / "settings.json").read_text(encoding="utf-8"))
            entry = settings["extraKnownMarketplaces"]["creatio"]
            self.assertTrue(entry["autoUpdate"])
            self.assertNotIn("source", entry)
            # Claude reads its skill from the CLI-managed plugin, not ~/.agents/skills,
            # so the installer must not seed that cross-agent mirror for Claude.
            self.assertFalse((home / ".agents" / "skills").exists())

    def test_preserves_existing_settings_when_enabling_auto_update(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            write_minimal_plugin_checkout(repo_root)
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)
            home = Path(temp) / "home"
            claude_home = home / ".claude"
            claude_home.mkdir(parents=True)
            (claude_home / "settings.json").write_text(
                '{"enabledPlugins":{"existing@tools":true},"extraKnownMarketplaces":{"existing":{"source":{"source":"github","repo":"org/repo"}}}}\n',
                encoding="utf-8",
            )

            with patch.object(installer, "preflight_claude", return_value="claude"), patch.object(
                installer, "run_checked"
            ):
                installer.install_claude(repo_root, home)

            settings = json.loads((claude_home / "settings.json").read_text(encoding="utf-8"))
            self.assertTrue(settings["enabledPlugins"]["existing@tools"])
            self.assertEqual(settings["extraKnownMarketplaces"]["existing"]["source"]["repo"], "org/repo")
            self.assertTrue(settings["extraKnownMarketplaces"]["creatio"]["autoUpdate"])

    def test_rejects_checkout_without_required_references(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            with self.assertRaisesRegex(RuntimeError, "missing required reference files"):
                installer.install_claude(repo_root, Path(temp) / "home")


class EnableClaudeAutoUpdateTests(unittest.TestCase):
    def test_drops_stale_directory_source(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            settings_path = Path(temp) / "settings.json"
            settings_path.write_text(
                '{"extraKnownMarketplaces":{"creatio":{"source":{"source":"directory","path":"/old/path"}}}}\n',
                encoding="utf-8",
            )
            installer.enable_claude_marketplace_auto_update(settings_path)
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
        entry = settings["extraKnownMarketplaces"]["creatio"]
        self.assertNotIn("source", entry)
        self.assertTrue(entry["autoUpdate"])

    def test_preserves_cli_managed_source(self):
        installer = load_installer()
        cli_managed_source = {"source": "git", "url": installer.MARKETPLACE_GIT_URL, "ref": "main"}
        with tempfile.TemporaryDirectory() as temp:
            settings_path = Path(temp) / "settings.json"
            settings_path.write_text(
                json.dumps({"extraKnownMarketplaces": {"creatio": {"source": cli_managed_source}}}),
                encoding="utf-8",
            )
            installer.enable_claude_marketplace_auto_update(settings_path)
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
        entry = settings["extraKnownMarketplaces"]["creatio"]
        self.assertEqual(entry["source"], cli_managed_source)
        self.assertTrue(entry["autoUpdate"])

    def test_creates_settings_file_when_missing(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            settings_path = Path(temp) / "nested" / "settings.json"
            installer.enable_claude_marketplace_auto_update(settings_path)
            settings = json.loads(settings_path.read_text(encoding="utf-8"))
        entry = settings["extraKnownMarketplaces"]["creatio"]
        self.assertTrue(entry["autoUpdate"])
        self.assertNotIn("source", entry)

    def test_rejects_non_object_extra_marketplaces(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            settings_path = Path(temp) / "settings.json"
            settings_path.write_text('{"extraKnownMarketplaces":"not-a-dict"}\n', encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "extraKnownMarketplaces must be an object"):
                installer.enable_claude_marketplace_auto_update(settings_path)


class InstallCodexTests(unittest.TestCase):
    """Codex stays on the local file-copy install path — see docs/install.md."""

    def _write_codex_checkout(self, installer, repo_root):
        write_minimal_plugin_checkout(repo_root)
        (repo_root / ".codex-plugin").mkdir(exist_ok=True)
        (repo_root / ".codex-plugin" / "plugin.json").write_text(
            '{"name":"creatio-ai-app-development-toolkit","version":"0.1.0","skills":"./skills/","mcpServers":"./.mcp.json"}\n',
            encoding="utf-8",
        )
        (repo_root / ".agents" / "plugins").mkdir(parents=True, exist_ok=True)
        (repo_root / ".agents" / "plugins" / "marketplace.json").write_text(
            '{"name":"creatio","interface":{"displayName":"Creatio"},"plugins":[{"name":"creatio-ai-app-development-toolkit","version":"0.1.0","source":{"source":"local","path":"./"},"policy":{"installation":"AVAILABLE","authentication":"ON_INSTALL"},"category":"development"}]}\n',
            encoding="utf-8",
        )
        write_required_references(installer, repo_root)
        write_release_manifest(repo_root)

    def test_copies_plugin_runtime_and_registers_mcp_in_config_toml(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            self._write_codex_checkout(installer, repo_root)
            home = Path(temp) / "home"
            codex_home = home / ".codex"
            codex_home.mkdir(parents=True)
            (codex_home / "config.toml").write_text('model = "gpt-5.4"\n', encoding="utf-8")

            installer.install_codex(repo_root, home)

            marketplace_dir = codex_home / "plugins" / "marketplaces" / "creatio"
            cache_dir = (
                codex_home / "plugins" / "cache" / "creatio"
                / "creatio-ai-app-development-toolkit" / "0.1.0"
            )
            marketplace_plugin_dir = marketplace_dir / "plugins" / "creatio-ai-app-development-toolkit"
            self.assertTrue((marketplace_plugin_dir / ".codex-plugin" / "plugin.json").exists())
            self.assertTrue((marketplace_plugin_dir / ".mcp.json").exists())
            self.assertTrue((marketplace_dir / ".agents" / "plugins" / "marketplace.json").exists())
            self.assertTrue((cache_dir / ".codex-plugin" / "plugin.json").exists())
            self.assertFalse((marketplace_plugin_dir / "skills").exists())
            self.assertFalse((cache_dir / "skills").exists())
            self.assertFalse((home / ".agents" / "plugins" / "creatio-ai-app-development-toolkit").exists())
            self.assertFalse((home / ".agents" / "skills" / "creatio-app-orchestrator").exists())
            standalone_skill = codex_home / "skills" / "creatio-app-orchestrator" / "SKILL.md"
            self.assertTrue(standalone_skill.exists())
            skill_body = standalone_skill.read_text(encoding="utf-8")
            self.assertIn(f"Toolkit repository is installed at: `{cache_dir}`", skill_body)
            self.assertIn(
                f"The `clio` MCP server is registered in `{codex_home / 'config.toml'}`.",
                skill_body,
            )

            config_body = (codex_home / "config.toml").read_text(encoding="utf-8")
            self.assertIn('model = "gpt-5.4"', config_body)
            self.assertIn("[marketplaces.creatio]", config_body)
            self.assertIn('source_type = "local"', config_body)
            self.assertIn('[plugins."creatio-ai-app-development-toolkit@creatio"]', config_body)
            self.assertIn("enabled = true", config_body)
            self.assertIn("[mcp_servers.clio]", config_body)
            personal_marketplace = json.loads(
                (home / ".agents" / "plugins" / "marketplace.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                personal_marketplace["plugins"][0]["source"]["path"],
                "./plugins/creatio-ai-app-development-toolkit",
            )

    def test_preserves_existing_clio_mcp_server(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            self._write_codex_checkout(installer, repo_root)
            home = Path(temp) / "home"
            codex_home = home / ".codex"
            codex_home.mkdir(parents=True)
            (codex_home / "config.toml").write_text(
                '[mcp_servers.clio]\ncommand = "custom-clio"\nargs = ["custom"]\n',
                encoding="utf-8",
            )

            with patch("builtins.print") as printed:
                installer.install_codex(repo_root, home)

            config_body = (codex_home / "config.toml").read_text(encoding="utf-8")
            self.assertIn('command = "custom-clio"', config_body)
            self.assertNotIn('command = "clio"\nargs = ["mcp-server"]', config_body)
            printed.assert_called_once()

    def test_removes_legacy_disabled_skill_override(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            self._write_codex_checkout(installer, repo_root)
            home = Path(temp) / "home"
            codex_home = home / ".codex"
            codex_home.mkdir(parents=True)
            (codex_home / "config.toml").write_text(
                'model = "gpt-5.4"\n\n[[skills.config]]\nname = "creatio-ai-app-development-toolkit:creatio-app-orchestrator"\nenabled = false\n',
                encoding="utf-8",
            )

            installer.install_codex(repo_root, home)

            config_body = (codex_home / "config.toml").read_text(encoding="utf-8")
            self.assertNotIn("[[skills.config]]", config_body)
            self.assertNotIn('name = "creatio-ai-app-development-toolkit:creatio-app-orchestrator"', config_body)
            self.assertIn('[plugins."creatio-ai-app-development-toolkit@creatio"]', config_body)

    def test_rejects_checkout_without_required_references(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            with self.assertRaisesRegex(RuntimeError, "missing required reference files"):
                installer.install_codex(repo_root, Path(temp) / "home")

    def test_merge_personal_marketplace_fills_missing_display_name(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            source_dir = repo_root / ".agents" / "plugins"
            source_dir.mkdir(parents=True)
            (source_dir / "marketplace.json").write_text(
                '{"name":"creatio","interface":{"displayName":"Creatio"},"plugins":[{"name":"creatio-ai-app-development-toolkit","source":{"source":"local","path":"./"}}]}\n',
                encoding="utf-8",
            )
            home = Path(temp) / "home"
            target_dir = home / ".agents" / "plugins"
            target_dir.mkdir(parents=True)
            (target_dir / "marketplace.json").write_text(
                '{"name":"custom-marketplace","interface":{},"plugins":[]}\n',
                encoding="utf-8",
            )

            installer.merge_personal_marketplace_catalog(repo_root, home)
            merged = json.loads((target_dir / "marketplace.json").read_text(encoding="utf-8"))

        self.assertEqual(merged["name"], "custom-marketplace")
        self.assertEqual(merged["interface"]["displayName"], "Creatio")
        self.assertEqual(
            merged["plugins"][0]["source"]["path"],
            "./plugins/creatio-ai-app-development-toolkit",
        )


class InstallCopilotTests(unittest.TestCase):
    def test_shells_out_with_git_url(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            write_minimal_plugin_checkout(repo_root)
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)
            home = Path(temp) / "home"
            (home / ".copilot").mkdir(parents=True)

            commands = []

            def fake_run(command, **_kwargs):
                commands.append(command)

            with patch.object(installer, "preflight_copilot", return_value="copilot"), patch.object(
                installer, "run_checked", side_effect=fake_run
            ):
                installer.install_copilot(repo_root, home)

            self.assertEqual(
                commands,
                [
                    ["copilot", "plugin", "marketplace", "add", installer.MARKETPLACE_GIT_URL],
                    ["copilot", "plugin", "install", installer.PLUGIN_SOURCE],
                ],
            )

    def test_removes_and_re_adds_when_already_registered(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            write_minimal_plugin_checkout(repo_root)
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)

            commands = []
            attempt = {"count": 0}

            def fake_run(command, **_kwargs):
                commands.append(command)
                if command[1:4] == ["plugin", "marketplace", "add"]:
                    attempt["count"] += 1
                    if attempt["count"] == 1:
                        raise RuntimeError(
                            'copilot plugin marketplace add failed: Marketplace "creatio" already registered'
                        )

            with patch.object(installer, "preflight_copilot", return_value="copilot"), patch.object(
                installer, "run_checked", side_effect=fake_run
            ):
                installer.install_copilot(repo_root, Path(temp) / "home")

            self.assertEqual(len(commands), 4)
            self.assertEqual(
                commands[1][1:],
                ["plugin", "marketplace", "remove", "creatio", "--force"],
            )
            self.assertEqual(commands[-1][1:3], ["plugin", "install"])

    def test_rejects_checkout_without_required_references(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            with self.assertRaisesRegex(RuntimeError, "missing required reference files"):
                installer.install_copilot(repo_root, Path(temp) / "home")


class InstallCursorTests(unittest.TestCase):
    def test_merges_mcp_config_and_writes_rule(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            (repo_root / ".cursor-plugin").mkdir()
            (repo_root / ".cursor-plugin" / "plugin.json").write_text(
                '{"name":"creatio-ai-app-development-toolkit","version":"0.1.0"}\n',
                encoding="utf-8",
            )
            (repo_root / ".mcp.json").write_text(
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
                encoding="utf-8",
            )
            write_release_manifest(repo_root, plugin_runtime=[".mcp.json", ".cursor-plugin"])

            home = Path(temp) / "home"
            cursor_home = home / ".cursor"
            cursor_home.mkdir(parents=True)
            (cursor_home / "mcp.json").write_text(
                '{"mcpServers":{"other":{"command":"other","args":[]}}}\n',
                encoding="utf-8",
            )

            installer.install_cursor(repo_root, home)

            merged = json.loads((cursor_home / "mcp.json").read_text(encoding="utf-8"))
            self.assertIn("clio", merged["mcpServers"])
            self.assertIn("other", merged["mcpServers"])
            self.assertEqual(merged["mcpServers"]["clio"]["args"], ["mcp-server"])

            local_plugin_dir = (
                cursor_home / "plugins" / "local" / "creatio-ai-app-development-toolkit"
            )
            rule_path = cursor_home / "rules" / "creatio-app-orchestrator.mdc"
            self.assertTrue(rule_path.exists())
            rule_body = rule_path.read_text(encoding="utf-8")
            self.assertIn("Creatio App Orchestrator", rule_body)
            self.assertIn(str(local_plugin_dir), rule_body)
            self.assertNotIn(str(repo_root), rule_body)
            self.assertIn(str(cursor_home / "mcp.json"), rule_body)

            local_plugin_manifest = local_plugin_dir / ".cursor-plugin" / "plugin.json"
            self.assertTrue(local_plugin_manifest.exists())

    def test_rule_survives_source_deletion(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            (repo_root / ".cursor-plugin").mkdir()
            (repo_root / ".cursor-plugin" / "plugin.json").write_text(
                '{"name":"creatio-ai-app-development-toolkit","version":"0.1.0"}\n',
                encoding="utf-8",
            )
            (repo_root / ".mcp.json").write_text(
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
                encoding="utf-8",
            )
            write_release_manifest(repo_root, plugin_runtime=[".mcp.json", ".cursor-plugin"])

            home = Path(temp) / "home"
            cursor_home = home / ".cursor"
            cursor_home.mkdir(parents=True)

            installer.install_cursor(repo_root, home)

            rule_body = (cursor_home / "rules" / "creatio-app-orchestrator.mdc").read_text(encoding="utf-8")
            self.assertNotIn(str(repo_root), rule_body)


class McpConfigMergeTests(unittest.TestCase):
    def test_merge_mcp_config_preserves_existing_server_entries(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "repo"
            root.mkdir()
            (root / ".mcp.json").write_text(
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]},"adac":{"command":"adac"}}}\n',
                encoding="utf-8",
            )
            target = Path(temp) / "target" / "mcp.json"
            target.parent.mkdir()
            target.write_text(
                '{"mcpServers":{"clio":{"command":"custom-clio","args":["custom"]}}}\n',
                encoding="utf-8",
            )

            with patch("builtins.print") as printed:
                installer.merge_mcp_config(root, target)
            merged = json.loads(target.read_text(encoding="utf-8"))

        self.assertEqual(merged["mcpServers"]["clio"]["command"], "custom-clio")
        self.assertEqual(merged["mcpServers"]["adac"]["command"], "adac")
        printed.assert_called_once()

    def test_merge_mcp_config_accepts_utf8_bom_json(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "repo"
            root.mkdir()
            (root / ".mcp.json").write_text(
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
                encoding="utf-8",
            )
            target = Path(temp) / "target" / "mcp-config.json"
            target.parent.mkdir()
            target.write_text(
                '\ufeff{"mcpServers":{"existing":{"command":"existing"}}}\n',
                encoding="utf-8",
            )

            installer.merge_mcp_config(root, target)
            merged = json.loads(target.read_text(encoding="utf-8-sig"))

        self.assertEqual(merged["mcpServers"]["existing"]["command"], "existing")
        self.assertEqual(merged["mcpServers"]["clio"]["command"], "clio")


class InstallRoutingTests(unittest.TestCase):
    def test_install_for_targets_routes_to_copilot(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            write_minimal_plugin_checkout(repo_root)
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root, plugin_runtime=[".mcp.json"])
            home = Path(temp) / "home"
            copilot_home = home / ".copilot"
            copilot_home.mkdir(parents=True)

            targets = [{"id": "copilot", "name": "GitHub Copilot CLI", "home": copilot_home}]
            with patch.object(installer, "preflight_copilot", return_value="copilot"), patch.object(
                installer, "run_checked"
            ) as run_checked:
                installed = installer.install_for_targets(repo_root, targets)

            self.assertEqual(installed, ["copilot"])
            self.assertEqual(run_checked.call_count, 2)


class PluginVersionTests(unittest.TestCase):
    def test_plugin_version_rejects_invalid_semver(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            manifest_dir = repo_root / ".github" / "plugin"
            manifest_dir.mkdir(parents=True)
            (manifest_dir / "plugin.json").write_text(
                '{"name":"creatio-ai-app-development-toolkit","version":"latest"}\n',
                encoding="utf-8",
            )

            with self.assertRaisesRegex(RuntimeError, "valid semantic version"):
                installer.plugin_version(repo_root)


class RemoveTreeTests(unittest.TestCase):
    def test_wraps_permission_error_with_host_hint(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "busy"
            target.mkdir()
            with patch("shutil.rmtree", side_effect=PermissionError("busy")):
                with self.assertRaisesRegex(RuntimeError, "Close Cursor and retry"):
                    installer.remove_tree_if_exists(target, "Cursor")


class ResolveRepoRootTests(unittest.TestCase):
    def test_returns_current_checkout(self):
        installer = load_installer()
        with patch.object(installer, "current_checkout_root", return_value=ROOT):
            resolved = installer.resolve_repo_root()
        self.assertEqual(resolved, ROOT)

    def test_raises_outside_checkout(self):
        installer = load_installer()
        with patch.object(installer, "current_checkout_root", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "must be run from a plugin checkout"):
                installer.resolve_repo_root()


class ArgParseTests(unittest.TestCase):
    def test_only_exposes_target_flag(self):
        installer = load_installer()
        namespace = installer.parse_args([])
        self.assertIsNone(namespace.target)
        self.assertFalse(hasattr(namespace, "repo_url"))
        self.assertFalse(hasattr(namespace, "ref"))
        self.assertFalse(hasattr(namespace, "install_root"))


class LoadPluginRuntimePathsTests(unittest.TestCase):
    def test_reads_release_manifest(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            (repo_root / ".release-manifest.json").write_text(
                '{"plugin_runtime":["AGENTS.md",".mcp.json"],"release_extras":["installer"]}\n',
                encoding="utf-8",
            )
            paths = installer.load_plugin_runtime_paths(repo_root)
        self.assertEqual(paths, ["AGENTS.md", ".mcp.json"])

    def test_raises_when_manifest_missing(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            with self.assertRaisesRegex(RuntimeError, "release-manifest.json"):
                installer.load_plugin_runtime_paths(repo_root)


class SetupWizardManifestTests(unittest.TestCase):
    def test_maps_target_ids_and_writes_to_caadt_dir(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            (repo_root / ".github" / "plugin").mkdir(parents=True)
            (repo_root / ".github" / "plugin" / "plugin.json").write_text(
                '{"name":"creatio-ai-app-development-toolkit","version":"1.2.3"}\n',
                encoding="utf-8",
            )
            home = Path(temp) / "home"

            manifest_path = installer.write_setup_wizard_manifest(
                repo_root,
                ["claude", "codex"],
                home=home,
            )

            self.assertEqual(manifest_path, home / ".caadt" / "install-state.json")
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["version"], "1.2.3")
            self.assertIn("installedAt", payload)
            self.assertEqual(
                payload["agents"],
                [
                    {"id": "claude-code", "displayName": "Claude Code"},
                    {"id": "codex", "displayName": "Codex"},
                ],
            )

    def test_handles_empty_install_list(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            (repo_root / ".github" / "plugin").mkdir(parents=True)
            (repo_root / ".github" / "plugin" / "plugin.json").write_text(
                '{"name":"creatio-ai-app-development-toolkit","version":"0.0.1"}\n',
                encoding="utf-8",
            )
            home = Path(temp) / "home"

            manifest_path = installer.write_setup_wizard_manifest(repo_root, [], home=home)

            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["agents"], [])
            self.assertEqual(payload["version"], "0.0.1")

    def test_filters_unknown_target_ids(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            (repo_root / ".github" / "plugin").mkdir(parents=True)
            (repo_root / ".github" / "plugin" / "plugin.json").write_text(
                '{"name":"creatio-ai-app-development-toolkit","version":"1.2.3"}\n',
                encoding="utf-8",
            )
            home = Path(temp) / "home"

            manifest_path = installer.write_setup_wizard_manifest(
                repo_root,
                ["codex", "unknown-agent", "claude"],
                home=home,
            )

            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(
                payload["agents"],
                [
                    {"id": "codex", "displayName": "Codex"},
                    {"id": "claude-code", "displayName": "Claude Code"},
                ],
            )

    def test_manifest_is_opt_in(self):
        installer = load_installer()

        with patch.dict(os.environ, {installer.SETUP_WIZARD_MANIFEST_ENV_VAR: "1"}, clear=False):
            self.assertFalse(installer.should_write_setup_wizard_manifest({}))
        self.assertFalse(
            installer.should_write_setup_wizard_manifest(
                {installer.SETUP_WIZARD_MANIFEST_ENV_VAR: "0"}
            )
        )
        self.assertTrue(
            installer.should_write_setup_wizard_manifest(
                {installer.SETUP_WIZARD_MANIFEST_ENV_VAR: "1"}
            )
        )
        for value in ["true", "TRUE", "yes", "YES"]:
            with self.subTest(value=value):
                self.assertTrue(
                    installer.should_write_setup_wizard_manifest(
                        {installer.SETUP_WIZARD_MANIFEST_ENV_VAR: value}
                    )
                )


class MainTests(unittest.TestCase):
    def test_does_not_write_setup_wizard_manifest_by_default(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop(installer.SETUP_WIZARD_MANIFEST_ENV_VAR, None)
                with (
                    patch.object(installer, "preflight_clio"),
                    patch.object(installer, "resolve_repo_root", return_value=repo_root),
                    patch.object(installer, "detect_targets", return_value=[]),
                    patch.object(installer, "install_for_targets", return_value=["codex"]),
                    patch.object(installer, "write_setup_wizard_manifest") as write_manifest,
                ):
                    result = installer.main([])

            self.assertEqual(result, 0)
            write_manifest.assert_not_called()

    def test_writes_setup_wizard_manifest_when_requested(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            manifest_path = Path(temp) / "home" / ".caadt" / "install-state.json"
            with patch.dict(os.environ, {installer.SETUP_WIZARD_MANIFEST_ENV_VAR: "1"}, clear=False):
                with (
                    patch.object(installer, "preflight_clio"),
                    patch.object(installer, "resolve_repo_root", return_value=repo_root),
                    patch.object(installer, "detect_targets", return_value=[]),
                    patch.object(installer, "install_for_targets", return_value=["codex"]),
                    patch.object(installer, "write_setup_wizard_manifest", return_value=manifest_path) as write_manifest,
                ):
                    result = installer.main([])

            self.assertEqual(result, 0)
            write_manifest.assert_called_once_with(repo_root, ["codex"])

    def test_returns_error_when_preflight_fails_before_install(self):
        installer = load_installer()
        with patch.object(installer, "preflight_clio", side_effect=RuntimeError("boom")):
            result = installer.main([])

        self.assertEqual(result, 1)


if __name__ == "__main__":
    unittest.main()

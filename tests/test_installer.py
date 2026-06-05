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
    spec = importlib.util.spec_from_file_location("caadt_installer", INSTALLER_PATH)
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
    def test_marketplace_git_url_is_hardcoded(self):
        installer = load_installer()
        self.assertEqual(
            installer.MARKETPLACE_GIT_URL,
            "https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git",
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
            # ENG-90514 removed these along with the file-copy install path.
            "write_codex_marketplace_catalog",
            "merge_codex_marketplace_config",
            "merge_personal_marketplace_catalog",
            "render_codex_skill",
        ):
            self.assertFalse(
                hasattr(installer, removed_name),
                f"{removed_name} should have been removed",
            )


class DetectTargetsTests(unittest.TestCase):
    def test_detects_all_four_when_home_dirs_and_clis_present(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            (home / ".codex").mkdir()
            (home / ".claude").mkdir()
            (home / ".cursor").mkdir()
            (home / ".copilot").mkdir()

            with patch("shutil.which", side_effect=lambda name: f"/usr/bin/{name}"):
                targets = installer.detect_targets(home)

        self.assertEqual({target["id"] for target in targets}, {"codex", "claude", "cursor", "copilot"})

    def test_skips_targets_without_home_dirs(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            with patch("shutil.which", side_effect=lambda name: f"/usr/bin/{name}"):
                targets = installer.detect_targets(Path(temp))
        self.assertEqual(targets, [])

    def test_skips_cli_driven_targets_whose_binary_is_not_on_path(self):
        """A leftover ~/.copilot with no copilot binary must not be detected."""
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            (home / ".codex").mkdir()
            (home / ".claude").mkdir()
            (home / ".cursor").mkdir()
            (home / ".copilot").mkdir()

            # cursor has no binary requirement; the three CLI-driven ones do.
            with patch("shutil.which", return_value=None):
                targets = installer.detect_targets(home)

        self.assertEqual({target["id"] for target in targets}, {"cursor"})

    def test_detects_cursor_without_binary(self):
        """Cursor uses file-copy install — no CLI binary needed."""
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            (home / ".cursor").mkdir()

            with patch("shutil.which", return_value=None):
                targets = installer.detect_targets(home)

        self.assertEqual([t["id"] for t in targets], ["cursor"])


class CliPreflightTests(unittest.TestCase):
    def test_preflight_claude_reports_missing_path(self):
        installer = load_installer()
        with patch("shutil.which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "claude was not found in PATH"):
                installer.agent_cli.preflight_claude()

    def test_preflight_copilot_reports_missing_path(self):
        installer = load_installer()
        with patch("shutil.which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "copilot was not found in PATH"):
                installer.agent_cli.preflight_copilot()

    def test_preflight_clio_reports_missing_path(self):
        installer = load_installer()
        with patch("shutil.which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "clio was not found in PATH"):
                installer.preflight_clio()

    def test_preflight_codex_reports_missing_path(self):
        installer = load_installer()
        with patch("shutil.which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "codex was not found in PATH"):
                installer.agent_cli.preflight_codex()

    def test_resolve_copilot_command_wraps_powershell_shim_on_windows(self):
        installer = load_installer()
        with patch.object(installer.agent_cli, "preflight_copilot", return_value=r"C:\nvm4w\nodejs\copilot.ps1"):
            command = installer.resolve_copilot_command()
        self.assertEqual(
            command,
            ["powershell", "-ExecutionPolicy", "Bypass", "-File", r"C:\nvm4w\nodejs\copilot.ps1"],
        )

    def test_resolve_claude_command_wraps_powershell_shim(self):
        installer = load_installer()
        with patch.object(installer.agent_cli, "preflight_claude", return_value=r"C:\tools\claude.ps1"):
            command = installer.resolve_claude_command()
        self.assertEqual(
            command,
            ["powershell", "-ExecutionPolicy", "Bypass", "-File", r"C:\tools\claude.ps1"],
        )

    def test_resolve_codex_command_wraps_powershell_shim(self):
        installer = load_installer()
        with patch.object(installer.agent_cli, "preflight_codex", return_value=r"C:\tools\codex.ps1"):
            command = installer.resolve_codex_command()
        self.assertEqual(
            command,
            ["powershell", "-ExecutionPolicy", "Bypass", "-File", r"C:\tools\codex.ps1"],
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

    def test_codex_already_added_error_triggers_retry(self):
        installer = load_installer()
        commands = []
        attempt = {"count": 0}

        def fake_run(command, **_kwargs):
            commands.append(command)
            if command[1:4] == ["plugin", "marketplace", "add"]:
                attempt["count"] += 1
                if attempt["count"] == 1:
                    raise RuntimeError(
                        "Error: marketplace 'creatio' is already added from a different source"
                    )

        with patch.object(installer, "run_checked", side_effect=fake_run), patch("builtins.print"):
            installer.register_remote_marketplace_and_install_plugin(["codex"], install_verb="add")

        self.assertEqual(len(commands), 4)
        self.assertEqual(commands[1][1:5], ["plugin", "marketplace", "remove", "creatio"])
        self.assertEqual(commands[-1][1:4], ["plugin", "add", installer.PLUGIN_SOURCE])

    def test_pre_remove_marketplace_runs_remove_then_add_unconditionally(self):
        installer = load_installer()
        commands = []

        def fake_run(command, **_kwargs):
            commands.append(command)
            if command[1:4] == ["plugin", "marketplace", "remove"]:
                raise RuntimeError("Error: marketplace 'creatio' not found")

        with patch.object(installer, "run_checked", side_effect=fake_run), patch("builtins.print"):
            installer.register_remote_marketplace_and_install_plugin(
                ["codex"],
                marketplace_remove_flags=[],
                install_verb="add",
                pre_remove_marketplace=True,
            )

        self.assertEqual(
            commands,
            [
                ["codex", "plugin", "marketplace", "remove", "creatio"],
                ["codex", "plugin", "marketplace", "add", installer.MARKETPLACE_GIT_URL],
                ["codex", "plugin", "add", installer.PLUGIN_SOURCE],
            ],
        )

    def test_install_verb_changes_install_subcommand(self):
        installer = load_installer()
        commands = []

        with patch.object(installer, "run_checked", side_effect=lambda command, **_: commands.append(command)):
            installer.register_remote_marketplace_and_install_plugin(["codex"], install_verb="add")

        install_calls = [cmd for cmd in commands if cmd[1] == "plugin" and cmd[2] not in {"marketplace"}]
        self.assertEqual(install_calls, [["codex", "plugin", "add", installer.PLUGIN_SOURCE]])

    def test_pre_remove_marketplace_tolerates_codex_not_configured_or_installed(self):
        # Regression for 0.1.2 smoke-test finding: Codex CLI on Windows reports
        # the "no such marketplace" condition as
        #   `Error: marketplace `creatio` is not configured or installed`
        # — backticks around the name and "is not configured or installed"
        # wording. The original `_marketplace_not_found` patterns only matched
        # "not found" / "no marketplace named" variants and missed this one,
        # so install.py exited 1 on fresh machines instead of proceeding to
        # `marketplace add`.
        installer = load_installer()
        commands = []

        def fake_run(command, **_kwargs):
            commands.append(command)
            if command[1:4] == ["plugin", "marketplace", "remove"]:
                raise RuntimeError(
                    "Error: marketplace `creatio` is not configured or installed"
                )

        with patch.object(installer, "run_checked", side_effect=fake_run), patch("builtins.print"):
            installer.register_remote_marketplace_and_install_plugin(
                ["codex"],
                marketplace_remove_flags=[],
                install_verb="add",
                pre_remove_marketplace=True,
            )

        self.assertEqual(
            commands,
            [
                ["codex", "plugin", "marketplace", "remove", "creatio"],
                ["codex", "plugin", "marketplace", "add", installer.MARKETPLACE_GIT_URL],
                ["codex", "plugin", "add", installer.PLUGIN_SOURCE],
            ],
        )

    def test_pre_remove_marketplace_propagates_non_not_found_remove_failure(self):
        # Regression for PR #73 RC-1: swallowing every RuntimeError on the
        # pre-remove step would hide real failures (permissions, broken CLI,
        # I/O errors) behind a misleading downstream `marketplace add` error.
        installer = load_installer()
        commands = []

        def fake_run(command, **_kwargs):
            commands.append(command)
            if command[1:4] == ["plugin", "marketplace", "remove"]:
                raise RuntimeError("Error: permission denied while updating config.toml")

        with patch.object(installer, "run_checked", side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, "permission denied"):
                installer.register_remote_marketplace_and_install_plugin(
                    ["codex"],
                    marketplace_remove_flags=[],
                    install_verb="add",
                    pre_remove_marketplace=True,
                )

        self.assertEqual(commands, [["codex", "plugin", "marketplace", "remove", "creatio"]])


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

            with patch.object(installer.agent_cli, "preflight_claude", return_value="claude"), patch.object(
                installer, "run_checked", side_effect=fake_run
            ):
                installer.install_claude(repo_root, home)

            # `plugin marketplace remove` runs first so that a stale legacy
            # entry (directory-source with absolute installLocation) is wiped
            # before the git-source re-add — see install_claude docstring.
            self.assertEqual(
                commands,
                [
                    ["claude", "plugin", "marketplace", "remove", "creatio"],
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

    def test_install_claude_always_removes_marketplace_first_and_tolerates_not_found(self):
        # Regression for ENG-90475 comments 448799 (Windows) and 449177 (macOS):
        # users upgrading from the old file-copy install carry a directory-source
        # `creatio` marketplace whose absolute `installLocation` survives in
        # known_marketplaces.json. Claude CLI silently "updates in place" on a
        # re-add (no `already registered` error → no conflict-retry), and a
        # subsequent `plugin install` joins the staging temp dir with that
        # absolute path, producing the `temp_<ts>/<abs-legacy-path>` error in
        # `/plugins → Errors`. Asserting that `marketplace remove` always runs
        # first locks in the migration behavior that mirrors install_codex and
        # matches the manual workaround Vitalii verified on macOS.
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
                # Simulate the fresh-install case where the marketplace is not
                # yet registered: Claude CLI returns "not found" on remove.
                # install.py must tolerate this and proceed to add+install
                # rather than abort, otherwise first-time users on a clean
                # machine would never get past the pre-remove step.
                if command[1:4] == ["plugin", "marketplace", "remove"]:
                    raise RuntimeError("Error: marketplace 'creatio' not found")

            with patch.object(installer.agent_cli, "preflight_claude", return_value="claude"), patch.object(
                installer, "run_checked", side_effect=fake_run
            ), patch("builtins.print"):
                installer.install_claude(repo_root, home)

            self.assertEqual(commands[0][1:4], ["plugin", "marketplace", "remove"])
            self.assertEqual(commands[0][4], "creatio")
            self.assertEqual(
                [cmd[1:] for cmd in commands],
                [
                    ["plugin", "marketplace", "remove", "creatio"],
                    ["plugin", "marketplace", "add", installer.MARKETPLACE_GIT_URL],
                    ["plugin", "install", installer.PLUGIN_SOURCE],
                ],
            )

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

            with patch.object(installer.agent_cli, "preflight_claude", return_value="claude"), patch.object(
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


class RemoveTomlTableBlockTests(unittest.TestCase):
    def test_removes_block_when_header_has_trailing_comment(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            config_path = Path(temp) / "config.toml"
            config_path.write_text(
                "[marketplaces.creatio] # installed-by-caadt\n"
                'source_type = "local"\n'
                "\n"
                "[sandbox]\n"
                'network = "restricted"\n',
                encoding="utf-8",
            )

            installer._remove_toml_table_block(config_path, ("[marketplaces.creatio]",))

            body = config_path.read_text(encoding="utf-8")
            self.assertNotIn("[marketplaces.creatio]", body)
            self.assertIn("[sandbox]", body)
            self.assertIn('network = "restricted"', body)

    def test_preserves_multiline_array_in_sibling_table(self):
        # Regression: a generous next-header detector ("any line starting with [")
        # would treat the closing `]` of a multi-line array literal as a new
        # table header and leak the rest of the sibling block as orphans.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            config_path = Path(temp) / "config.toml"
            config_path.write_text(
                "[marketplaces.creatio]\n"
                'source_type = "local"\n'
                "\n"
                "[sandbox]\n"
                "writable_roots = [\n"
                '  "/tmp/a",\n'
                '  "/tmp/b",\n'
                "]\n"
                'network = "restricted"\n',
                encoding="utf-8",
            )

            installer._remove_toml_table_block(config_path, ("[marketplaces.creatio]",))

            body = config_path.read_text(encoding="utf-8")
            self.assertNotIn("[marketplaces.creatio]", body)
            self.assertIn("[sandbox]", body)
            self.assertIn('"/tmp/a"', body)
            self.assertIn('"/tmp/b"', body)
            self.assertIn('network = "restricted"', body)

    def test_preserves_inline_table_in_array_in_sibling_table(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            config_path = Path(temp) / "config.toml"
            config_path.write_text(
                '[plugins."creatio-ai-app-development-toolkit@creatio"]\n'
                "enabled = true\n"
                "\n"
                "[profiles]\n"
                "entries = [\n"
                '  { name = "a", value = 1 },\n'
                '  { name = "b", value = 2 },\n'
                "]\n",
                encoding="utf-8",
            )

            installer._remove_toml_table_block(
                config_path,
                ('[plugins."creatio-ai-app-development-toolkit@creatio"]',),
            )

            body = config_path.read_text(encoding="utf-8")
            self.assertNotIn("creatio-ai-app-development-toolkit@creatio", body)
            self.assertIn("[profiles]", body)
            self.assertIn('{ name = "a", value = 1 }', body)
            self.assertIn('{ name = "b", value = 2 }', body)

    def test_removes_double_bracket_array_of_tables_block(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            config_path = Path(temp) / "config.toml"
            config_path.write_text(
                "[[skills.config]]\n"
                'name = "creatio-ai-app-development-toolkit:creatio-app-orchestrator"\n'
                "enabled = false\n"
                "\n"
                "[other]\n"
                "x = 1\n",
                encoding="utf-8",
            )

            installer._remove_toml_table_block(config_path, ("[[skills.config]]",))

            body = config_path.read_text(encoding="utf-8")
            self.assertNotIn("[[skills.config]]", body)
            self.assertIn("[other]", body)
            self.assertIn("x = 1", body)

    def test_skill_config_override_preserves_sibling_multiline_array(self):
        # Same hazard as in _remove_toml_table_block: the end-of-block scan
        # in remove_codex_skill_config_override must not treat a `[` opening
        # a multi-line array as a new table header.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            config_path = Path(temp) / "config.toml"
            config_path.write_text(
                "[[skills.config]]\n"
                'name = "creatio-ai-app-development-toolkit:creatio-app-orchestrator"\n'
                "enabled = false\n"
                "\n"
                "[sandbox]\n"
                "writable_roots = [\n"
                '  "/tmp/a",\n'
                "]\n"
                'network = "restricted"\n',
                encoding="utf-8",
            )

            installer.remove_codex_skill_config_override(
                config_path,
                "creatio-ai-app-development-toolkit:creatio-app-orchestrator",
            )

            body = config_path.read_text(encoding="utf-8")
            self.assertNotIn("[[skills.config]]", body)
            self.assertIn("[sandbox]", body)
            self.assertIn('"/tmp/a"', body)
            self.assertIn('network = "restricted"', body)


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
    """ENG-90514: Codex installs via the remote marketplace, parity with Claude."""

    def test_shells_out_via_codex_cli_in_remove_add_install_order(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            write_minimal_plugin_checkout(repo_root)
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)
            home = Path(temp) / "home"
            (home / ".codex").mkdir(parents=True)

            commands = []

            def fake_run(command, **_kwargs):
                commands.append(command)

            with patch.object(installer.agent_cli, "preflight_codex", return_value="codex"), patch.object(
                installer, "run_checked", side_effect=fake_run
            ), patch.object(installer, "copy_plugin_runtime_surface") as copy_runtime:
                installer.install_codex(repo_root, home)

            self.assertEqual(
                commands,
                [
                    ["codex", "plugin", "marketplace", "remove", "creatio"],
                    ["codex", "plugin", "marketplace", "add", installer.MARKETPLACE_GIT_URL],
                    ["codex", "plugin", "add", installer.PLUGIN_SOURCE],
                ],
            )
            copy_runtime.assert_not_called()

    def test_tolerates_marketplace_remove_not_found(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            write_minimal_plugin_checkout(repo_root)
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)
            home = Path(temp) / "home"
            (home / ".codex").mkdir(parents=True)

            commands = []

            def fake_run(command, **_kwargs):
                commands.append(command)
                if command[1:4] == ["plugin", "marketplace", "remove"]:
                    raise RuntimeError("Error: marketplace 'creatio' not found")

            with patch.object(installer.agent_cli, "preflight_codex", return_value="codex"), patch.object(
                installer, "run_checked", side_effect=fake_run
            ), patch("builtins.print"):
                installer.install_codex(repo_root, home)

            self.assertEqual([cmd[1:4] for cmd in commands], [
                ["plugin", "marketplace", "remove"],
                ["plugin", "marketplace", "add"],
                ["plugin", "add", installer.PLUGIN_SOURCE],
            ])

    def test_cleans_up_legacy_file_copy_artifacts(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            write_minimal_plugin_checkout(repo_root)
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)
            home = Path(temp) / "home"
            codex_home = home / ".codex"
            legacy_marketplace_dir = codex_home / "plugins" / "marketplaces" / "creatio"
            legacy_cache_dir = codex_home / "plugins" / "cache" / "creatio"
            legacy_personal_plugin_dir = home / ".agents" / "plugins" / "creatio-ai-app-development-toolkit"
            legacy_skill_dir = codex_home / "skills" / "creatio-app-orchestrator"
            for directory in (
                legacy_marketplace_dir,
                legacy_cache_dir,
                legacy_personal_plugin_dir,
                legacy_skill_dir,
            ):
                directory.mkdir(parents=True)
                (directory / "marker").write_text("legacy\n", encoding="utf-8")

            with patch.object(installer.agent_cli, "preflight_codex", return_value="codex"), patch.object(
                installer, "run_checked"
            ):
                installer.install_codex(repo_root, home)

            self.assertFalse(legacy_marketplace_dir.exists())
            self.assertFalse(legacy_cache_dir.exists())
            self.assertFalse(legacy_personal_plugin_dir.exists())
            self.assertFalse(legacy_skill_dir.exists())

    def test_removes_legacy_config_toml_blocks_and_preserves_clio_mcp(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            write_minimal_plugin_checkout(repo_root)
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)
            home = Path(temp) / "home"
            codex_home = home / ".codex"
            codex_home.mkdir(parents=True)
            (codex_home / "config.toml").write_text(
                'model = "gpt-5.4"\n\n'
                "[marketplaces.creatio]\n"
                'last_updated = "installed-by-caadt"\n'
                'source_type = "local"\n'
                'source = "C:\\\\old\\\\path"\n\n'
                "[marketplaces.other]\n"
                'source_type = "git"\n\n'
                '[plugins."creatio-ai-app-development-toolkit@creatio"]\n'
                "enabled = true\n\n"
                '[plugins."other@other"]\n'
                "enabled = true\n\n"
                "[[skills.config]]\n"
                'name = "creatio-ai-app-development-toolkit:creatio-app-orchestrator"\n'
                "enabled = false\n\n"
                "[mcp_servers.clio]\n"
                'command = "custom-clio"\n'
                'args = ["custom"]\n',
                encoding="utf-8",
            )

            with patch.object(installer.agent_cli, "preflight_codex", return_value="codex"), patch.object(
                installer, "run_checked"
            ), patch("builtins.print"):
                installer.install_codex(repo_root, home)

            config_body = (codex_home / "config.toml").read_text(encoding="utf-8")
            self.assertIn('model = "gpt-5.4"', config_body)
            self.assertNotIn("[marketplaces.creatio]", config_body)
            self.assertIn("[marketplaces.other]", config_body)
            self.assertNotIn('[plugins."creatio-ai-app-development-toolkit@creatio"]', config_body)
            self.assertIn('[plugins."other@other"]', config_body)
            self.assertNotIn("[[skills.config]]", config_body)
            self.assertIn("[mcp_servers.clio]", config_body)
            self.assertIn('command = "custom-clio"', config_body)

    def test_merges_clio_mcp_when_absent(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            write_minimal_plugin_checkout(repo_root)
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)
            home = Path(temp) / "home"
            codex_home = home / ".codex"
            codex_home.mkdir(parents=True)
            (codex_home / "config.toml").write_text('model = "gpt-5.4"\n', encoding="utf-8")

            with patch.object(installer.agent_cli, "preflight_codex", return_value="codex"), patch.object(
                installer, "run_checked"
            ):
                installer.install_codex(repo_root, home)

            config_body = (codex_home / "config.toml").read_text(encoding="utf-8")
            self.assertIn('model = "gpt-5.4"', config_body)
            self.assertIn("[mcp_servers.clio]", config_body)
            self.assertIn('command = "clio"', config_body)

    def test_strips_creatio_entry_from_personal_marketplace_and_deletes_when_empty(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            write_minimal_plugin_checkout(repo_root)
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)
            home = Path(temp) / "home"
            codex_home = home / ".codex"
            codex_home.mkdir(parents=True)
            personal_catalog = home / ".agents" / "plugins" / "marketplace.json"
            personal_catalog.parent.mkdir(parents=True)
            personal_catalog.write_text(
                json.dumps(
                    {
                        "name": "creatio",
                        "interface": {"displayName": "Creatio"},
                        "plugins": [
                            {
                                "name": "creatio-ai-app-development-toolkit",
                                "version": "0.1.0",
                                "source": {
                                    "source": "local",
                                    "path": "./plugins/creatio-ai-app-development-toolkit",
                                },
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with patch.object(installer.agent_cli, "preflight_codex", return_value="codex"), patch.object(
                installer, "run_checked"
            ):
                installer.install_codex(repo_root, home)

            self.assertFalse(personal_catalog.exists())

    def test_preserves_personal_marketplace_when_user_added_entries(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            write_minimal_plugin_checkout(repo_root)
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)
            home = Path(temp) / "home"
            codex_home = home / ".codex"
            codex_home.mkdir(parents=True)
            personal_catalog = home / ".agents" / "plugins" / "marketplace.json"
            personal_catalog.parent.mkdir(parents=True)
            personal_catalog.write_text(
                json.dumps(
                    {
                        "name": "personal",
                        "interface": {"displayName": "Personal Marketplace"},
                        "plugins": [
                            {
                                "name": "creatio-ai-app-development-toolkit",
                                "source": {"source": "local", "path": "./plugins/x"},
                            },
                            {"name": "user-own-plugin", "source": {"source": "local", "path": "./y"}},
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with patch.object(installer.agent_cli, "preflight_codex", return_value="codex"), patch.object(
                installer, "run_checked"
            ):
                installer.install_codex(repo_root, home)

            catalog = json.loads(personal_catalog.read_text(encoding="utf-8"))
            plugin_names = [plugin["name"] for plugin in catalog["plugins"]]
            self.assertEqual(plugin_names, ["user-own-plugin"])

    def test_deletes_installer_managed_personal_marketplace_when_plugins_is_malformed(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            write_minimal_plugin_checkout(repo_root)
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)
            home = Path(temp) / "home"
            codex_home = home / ".codex"
            codex_home.mkdir(parents=True)
            personal_catalog = home / ".agents" / "plugins" / "marketplace.json"
            personal_catalog.parent.mkdir(parents=True)
            personal_catalog.write_text(
                json.dumps(
                    {
                        "name": "creatio",
                        "interface": {"displayName": "Creatio"},
                        "plugins": {"name": "creatio-ai-app-development-toolkit"},
                    }
                ),
                encoding="utf-8",
            )

            with patch.object(installer.agent_cli, "preflight_codex", return_value="codex"), patch.object(
                installer, "run_checked"
            ):
                installer.install_codex(repo_root, home)

            self.assertFalse(personal_catalog.exists())

    def test_rejects_user_managed_personal_marketplace_when_plugins_is_malformed(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            write_minimal_plugin_checkout(repo_root)
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)
            home = Path(temp) / "home"
            codex_home = home / ".codex"
            codex_home.mkdir(parents=True)
            personal_catalog = home / ".agents" / "plugins" / "marketplace.json"
            personal_catalog.parent.mkdir(parents=True)
            personal_catalog.write_text(
                json.dumps(
                    {
                        "name": "personal",
                        "interface": {"displayName": "Personal Marketplace"},
                        "plugins": {"name": "user-own-plugin"},
                    }
                ),
                encoding="utf-8",
            )

            with patch.object(installer.agent_cli, "preflight_codex", return_value="codex"), patch.object(
                installer, "run_checked"
            ), self.assertRaisesRegex(RuntimeError, "'plugins' must be a list"):
                installer.install_codex(repo_root, home)

    def test_rejects_checkout_without_required_references(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            with self.assertRaisesRegex(RuntimeError, "missing required reference files"):
                installer.install_codex(repo_root, Path(temp) / "home")


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

            with patch.object(installer.agent_cli, "preflight_copilot", return_value="copilot"), patch.object(
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

            with patch.object(installer.agent_cli, "preflight_copilot", return_value="copilot"), patch.object(
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
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]},"caadt":{"command":"caadt"}}}\n',
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
        self.assertEqual(merged["mcpServers"]["caadt"]["command"], "caadt")
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
            with patch.object(installer.agent_cli, "preflight_copilot", return_value="copilot"), patch.object(
                installer, "run_checked"
            ) as run_checked:
                installed, failed = installer.install_for_targets(repo_root, targets)

            self.assertEqual(installed, ["copilot"])
            self.assertEqual(failed, [])
            self.assertEqual(run_checked.call_count, 2)

    def test_install_for_targets_skips_failing_autodetected_target(self):
        """A leftover ~/.copilot with no `copilot` on PATH must not abort the run."""
        installer = load_installer()
        targets = [
            {"id": "copilot", "name": "GitHub Copilot CLI", "home": Path("/home/.copilot")},
            {"id": "cursor", "name": "Cursor", "home": Path("/home/.cursor")},
        ]
        with (
            patch.object(
                installer,
                "install_copilot",
                side_effect=RuntimeError("copilot was not found in PATH."),
            ),
            patch.object(installer, "install_cursor") as install_cursor,
        ):
            installed, failed = installer.install_for_targets(Path("/repo"), targets)

        self.assertEqual(installed, ["cursor"])
        self.assertEqual(failed, [("copilot", "copilot was not found in PATH.")])
        install_cursor.assert_called_once()

    def test_install_for_targets_reraises_when_explicit_target_fails(self):
        """`--target copilot` is an explicit request, so a failure must propagate."""
        installer = load_installer()
        targets = [{"id": "copilot", "name": "GitHub Copilot CLI", "home": Path("/home/.copilot")}]
        with patch.object(
            installer,
            "install_copilot",
            side_effect=RuntimeError("copilot was not found in PATH."),
        ):
            with self.assertRaisesRegex(RuntimeError, "copilot was not found in PATH"):
                installer.install_for_targets(Path("/repo"), targets, selected="copilot")


class JsonIoTests(unittest.TestCase):
    def test_write_json_overwrites_and_leaves_no_temp_file(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "nested" / "settings.json"
            installer.write_json(target, {"a": 1})
            installer.write_json(target, {"a": 2, "b": [1, 2]})

            self.assertEqual(json.loads(target.read_text(encoding="utf-8")), {"a": 2, "b": [1, 2]})
            siblings = [p.name for p in target.parent.iterdir()]
            self.assertEqual(siblings, ["settings.json"])

    def test_read_json_file_wraps_parse_error_as_runtime_error(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "settings.json"
            path.write_text('{"a": 1, // a comment\n}', encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "Could not parse JSON"):
                installer.read_json_file(path)

    def test_read_json_file_returns_empty_for_missing_file(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            self.assertEqual(installer.read_json_file(Path(temp) / "missing.json"), {})


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
                    patch.object(installer, "install_for_targets", return_value=(["codex"], [])),
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
                    patch.object(installer, "install_for_targets", return_value=(["codex"], [])),
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

    def test_returns_success_when_some_targets_install_and_others_skipped(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            with (
                patch.object(installer, "preflight_clio"),
                patch.object(installer, "resolve_repo_root", return_value=repo_root),
                patch.object(installer, "detect_targets", return_value=[]),
                patch.object(
                    installer,
                    "install_for_targets",
                    return_value=(["codex"], [("copilot", "copilot was not found in PATH.")]),
                ),
            ):
                result = installer.main([])

        self.assertEqual(result, 0)

    def test_returns_error_when_all_detected_targets_fail(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            with (
                patch.object(installer, "preflight_clio"),
                patch.object(installer, "resolve_repo_root", return_value=repo_root),
                patch.object(installer, "detect_targets", return_value=[]),
                patch.object(
                    installer,
                    "install_for_targets",
                    return_value=([], [("copilot", "copilot was not found in PATH.")]),
                ),
            ):
                result = installer.main([])

        self.assertEqual(result, 1)


if __name__ == "__main__":
    unittest.main()

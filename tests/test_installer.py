import importlib.util
import json
import os
import stat
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


def build_minimal_copilot_test_repo(installer, temp_root):
    """Build a minimal repo skeleton sufficient for ``install_copilot`` to run.

    Creates the standard sub-directories, required plugin/manifest files, and
    a minimal skill bundle. Returns the ``repo_root`` path. Callers can add
    their own test-specific fixtures (e.g. stale install artifacts) after.
    """
    repo_root = temp_root / "repo"
    for sub in (
        "tests",
        "installer",
        "docs",
        "runbooks",
        "context",
        "skills",
        "runtime",
        ".github/plugin",
        ".claude-plugin",
        ".codex-plugin",
        ".cursor-plugin",
        ".agents",
    ):
        (repo_root / sub).mkdir(parents=True, exist_ok=True)
    (repo_root / ".mcp.json").write_text(
        '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
        encoding="utf-8",
    )
    (repo_root / ".github" / "plugin" / "plugin.json").write_text(
        '{"name":"creatio-ai-app-development-toolkit","version":"0.1.0"}\n',
        encoding="utf-8",
    )
    for plugin_dir in (".claude-plugin", ".codex-plugin", ".cursor-plugin"):
        (repo_root / plugin_dir / "plugin.json").write_text(
            '{"name":"creatio-ai-app-development-toolkit"}\n', encoding="utf-8"
        )
    write_required_references(installer, repo_root)
    write_release_manifest(repo_root)
    skill_dir = repo_root / "skills" / "creatio-app-orchestrator"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: creatio-app-orchestrator\ndescription: test\n---\n",
        encoding="utf-8",
    )
    (skill_dir / "agents").mkdir()
    (skill_dir / "agents" / "openai.yaml").write_text(
        "display_name: test\n", encoding="utf-8"
    )
    return repo_root


class InstallerTests(unittest.TestCase):
    def test_detect_targets_uses_mocked_home_directories(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            home = Path(temp)
            (home / ".codex").mkdir()
            (home / ".claude").mkdir()
            (home / ".cursor").mkdir()
            (home / ".copilot").mkdir()

            with patch("shutil.which", return_value=None):
                targets = installer.detect_targets(home)

        self.assertEqual({target["id"] for target in targets}, {"codex", "claude", "cursor", "copilot"})

    def test_detect_targets_skips_copilot_when_directory_missing(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            targets = installer.detect_targets(Path(temp))

        self.assertNotIn("copilot", {target["id"] for target in targets})

    def test_install_copilot_registers_marketplace_installs_plugin_and_copies_runtime_surface(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = build_minimal_copilot_test_repo(installer, Path(temp))
            (repo_root / "tests" / "test_dev_only.py").write_text("dev\n", encoding="utf-8")
            (repo_root / "installer" / "install.py").write_text("dev\n", encoding="utf-8")
            (repo_root / "docs" / "install.md").write_text("dev\n", encoding="utf-8")
            commands = []

            def fake_run(command, **_kwargs):
                commands.append(command)

            with patch.object(installer, "preflight_copilot", return_value="copilot"), patch.object(
                installer, "run_checked", side_effect=fake_run
            ):
                installed_plugin_dir = (
                    Path(temp)
                    / "home"
                    / ".copilot"
                    / "installed-plugins"
                    / "creatio"
                    / "creatio-ai-app-development-toolkit"
                )
                installed_plugin_dir.mkdir(parents=True, exist_ok=True)
                (installed_plugin_dir / "stale.txt").write_text("old\n", encoding="utf-8")
                (installed_plugin_dir / "docs").mkdir()
                (installed_plugin_dir / "docs" / "old.md").write_text("old\n", encoding="utf-8")
                legacy_agents_plugin_dir = Path(temp) / "home" / ".agents" / "plugins" / "creatio-ai-app-development-toolkit"
                legacy_agents_plugin_dir.mkdir(parents=True, exist_ok=True)
                (legacy_agents_plugin_dir / "old.txt").write_text("old\n", encoding="utf-8")
                legacy_agents_skill_dir = Path(temp) / "home" / ".agents" / "skills" / "creatio-app-orchestrator"
                legacy_agents_skill_dir.mkdir(parents=True, exist_ok=True)
                (legacy_agents_skill_dir / "SKILL.md").write_text("old\n", encoding="utf-8")
                skill_target_dir = Path(temp) / "home" / ".copilot" / "skills" / "creatio-app-orchestrator"
                skill_target_dir.mkdir(parents=True, exist_ok=True)
                (skill_target_dir / "obsolete.md").write_text("old\n", encoding="utf-8")
                installer.install_copilot(repo_root, Path(temp) / "home")

            self.assertTrue((installed_plugin_dir / "runbooks").exists())
            self.assertTrue((installed_plugin_dir / "context").exists())
            self.assertFalse((installed_plugin_dir / "skills").exists())
            self.assertTrue((installed_plugin_dir / "runtime").exists())
            self.assertTrue((installed_plugin_dir / ".mcp.json").exists())
            self.assertTrue((installed_plugin_dir / ".codex-plugin" / "plugin.json").exists())
            self.assertFalse((installed_plugin_dir / "stale.txt").exists())
            self.assertFalse((installed_plugin_dir / "tests").exists())
            self.assertFalse((installed_plugin_dir / "installer").exists())
            self.assertFalse((installed_plugin_dir / "docs").exists())
            self.assertFalse(legacy_agents_plugin_dir.exists())
            self.assertFalse(legacy_agents_skill_dir.exists())
            self.assertTrue((skill_target_dir / "agents" / "openai.yaml").exists())
            self.assertFalse((skill_target_dir / "obsolete.md").exists())
            skill_body = (skill_target_dir / "SKILL.md").read_text(encoding="utf-8")
            self.assertIn(str(installed_plugin_dir), skill_body)
            self.assertIn(str(Path(temp) / "home" / ".copilot" / "mcp-config.json"), skill_body)
            self.assertNotIn(str(repo_root), skill_body)

        self.assertEqual(
            commands,
            [
                ["copilot", "plugin", "marketplace", "add", str(repo_root)],
                ["copilot", "plugin", "install", "creatio-ai-app-development-toolkit@creatio"],
            ],
        )

    def test_install_copilot_skill_references_resolve_to_installed_files(self):
        """Regression guard for the SKILL.md path-rewriting fix that closes
        ENG-89962 #18 (dangling SKILL.md references). The fix itself landed
        earlier in `installer/install.py`; this test prevents re-introduction.
        Asserts that every path referenced in the rendered SKILL.md Load Order
        resolves to a file that actually exists in the installed plugin layout
        (e.g., guards against the legacy ~/.agents/skills/<skill>/AGENTS.md
        not-found errors)."""
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = build_minimal_copilot_test_repo(installer, Path(temp))

            with patch.object(installer, "preflight_copilot", return_value="copilot"), patch.object(
                installer, "run_checked", side_effect=lambda *_a, **_k: None
            ):
                home = Path(temp) / "home"
                installer.install_copilot(repo_root, home)

            installed_plugin_dir = home / ".copilot" / "installed-plugins" / "creatio" / "creatio-ai-app-development-toolkit"
            skill_target_dir = home / ".copilot" / "skills" / "creatio-app-orchestrator"
            skill_body = (skill_target_dir / "SKILL.md").read_text(encoding="utf-8")

            self.assertTrue(
                installed_plugin_dir.exists(),
                f"installer did not create the plugin install dir: {installed_plugin_dir}",
            )

            missing = []
            for relative in installer.REQUIRED_REFERENCE_PATHS:
                referenced_path = installed_plugin_dir / relative
                if str(referenced_path) in skill_body and not referenced_path.exists():
                    missing.append(str(referenced_path))
            self.assertEqual(missing, [], f"SKILL.md references non-existent files: {missing}")

            for must_have_relative in (
                "AGENTS.md",
                "context/INDEX.md",
                "runbooks/01-environment-setup.md",
                "runbooks/02-requirements-gathering.md",
                "runtime/scripts/mcp_client.py",
                "runtime/scripts/workflow_validators.py",
            ):
                referenced = installed_plugin_dir / must_have_relative
                self.assertIn(str(referenced), skill_body)
                self.assertTrue(referenced.exists(), f"missing on disk: {referenced}")
            self.assertNotIn(str(repo_root), skill_body)

    def test_install_copilot_rejects_checkout_without_required_references(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            skill_dir = repo_root / "skills" / "creatio-app-orchestrator"
            skill_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(
                "---\nname: creatio-app-orchestrator\ndescription: test\n---\n",
                encoding="utf-8",
            )
            (repo_root / ".mcp.json").write_text(
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
                encoding="utf-8",
            )

            with self.assertRaisesRegex(RuntimeError, "missing required reference files"):
                installer.install_copilot(repo_root, Path(temp) / "home")

    def test_install_copilot_ignores_existing_marketplace_registration(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir(parents=True)
            (repo_root / ".mcp.json").write_text(
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
                encoding="utf-8",
            )
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)
            commands = []

            def fake_run(command, **_kwargs):
                commands.append(command)
                if command[:4] == ["copilot", "plugin", "marketplace", "add"]:
                    raise RuntimeError(
                        'copilot plugin marketplace add failed: Failed to add marketplace: Marketplace "creatio" already registered'
                    )

            with patch.object(installer, "preflight_copilot", return_value="copilot"), patch.object(
                installer, "run_checked", side_effect=fake_run
            ):
                installer.install_copilot(repo_root, Path(temp) / "home")

        self.assertEqual(
            commands,
            [
                ["copilot", "plugin", "marketplace", "add", str(repo_root)],
                ["copilot", "plugin", "install", "creatio-ai-app-development-toolkit@creatio"],
            ],
        )

    def test_install_copilot_raises_for_unexpected_marketplace_add_error(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir(parents=True)
            (repo_root / ".mcp.json").write_text(
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
                encoding="utf-8",
            )
            write_required_references(installer, repo_root)

            def fake_run(command, **_kwargs):
                if command[:4] == ["copilot", "plugin", "marketplace", "add"]:
                    raise RuntimeError("copilot plugin marketplace add failed: permission denied")

            with patch.object(installer, "preflight_copilot", return_value="copilot"), patch.object(
                installer, "run_checked", side_effect=fake_run
            ):
                with self.assertRaisesRegex(RuntimeError, "permission denied"):
                    installer.install_copilot(repo_root, Path(temp) / "home")

    def test_preflight_copilot_reports_missing_path(self):
        installer = load_installer()
        with patch("shutil.which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "copilot was not found in PATH"):
                installer.preflight_copilot()

    def test_resolve_copilot_command_wraps_powershell_shim_on_windows(self):
        installer = load_installer()
        with patch.object(installer, "preflight_copilot", return_value=r"C:\nvm4w\nodejs\copilot.ps1"):
            command = installer.resolve_copilot_command()

        self.assertEqual(
            command,
            ["powershell", "-ExecutionPolicy", "Bypass", "-File", r"C:\nvm4w\nodejs\copilot.ps1"],
        )

    def test_install_for_targets_routes_to_copilot(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir(parents=True)
            (repo_root / ".mcp.json").write_text(
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
                encoding="utf-8",
            )
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

    def test_install_cursor_merges_mcp_config_and_writes_rule(self):
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
                cursor_home
                / "plugins"
                / "local"
                / "creatio-ai-app-development-toolkit"
            )
            rule_path = cursor_home / "rules" / "creatio-app-orchestrator.mdc"
            self.assertTrue(rule_path.exists())
            rule_body = rule_path.read_text(encoding="utf-8")
            self.assertIn("description:", rule_body)
            self.assertIn("Creatio App Orchestrator", rule_body)
            self.assertIn(str(local_plugin_dir), rule_body)
            self.assertNotIn(str(repo_root), rule_body)
            self.assertIn(str(cursor_home / "mcp.json"), rule_body)

            local_plugin_manifest = local_plugin_dir / ".cursor-plugin" / "plugin.json"
            self.assertTrue(local_plugin_manifest.exists())
            self.assertFalse((local_plugin_dir / "tests").exists())
            self.assertFalse((local_plugin_dir / "installer").exists())

    def test_install_claude_registers_marketplace_and_copies_only_runtime_plugin_surface(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            (repo_root / "tests").mkdir(parents=True)
            (repo_root / "installer").mkdir()
            (repo_root / "docs").mkdir()
            (repo_root / "runbooks").mkdir()
            (repo_root / "context").mkdir()
            (repo_root / "skills").mkdir()
            (repo_root / "runtime").mkdir()
            (repo_root / ".claude-plugin").mkdir()
            (repo_root / ".mcp.json").write_text(
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
                encoding="utf-8",
            )
            (repo_root / ".claude-plugin" / "plugin.json").write_text(
                '{"name":"creatio-ai-app-development-toolkit","version":"0.1.0"}\n',
                encoding="utf-8",
            )
            (repo_root / "AGENTS.md").write_text("rules\n", encoding="utf-8")
            write_required_references(installer, repo_root)
            skill_dir = repo_root / "skills" / "creatio-app-orchestrator"
            skill_dir.mkdir(parents=True, exist_ok=True)
            (skill_dir / "SKILL.md").write_text(
                "---\nname: creatio-app-orchestrator\ndescription: test\n---\n",
                encoding="utf-8",
            )
            (repo_root / "tests" / "test_dev_only.py").write_text("dev\n", encoding="utf-8")
            (repo_root / "installer" / "install.py").write_text("dev\n", encoding="utf-8")
            (repo_root / "docs" / "install.md").write_text("dev\n", encoding="utf-8")
            write_release_manifest(repo_root)

            home = Path(temp) / "home"
            claude_home = home / ".claude"
            claude_home.mkdir(parents=True)
            (claude_home / "settings.json").write_text(
                '{"enabledPlugins":{"existing@tools":true},"extraKnownMarketplaces":{"existing":{"source":{"source":"github","repo":"org/repo"}}}}\n',
                encoding="utf-8",
            )
            (claude_home / "plugins").mkdir(parents=True)
            (claude_home / "plugins" / "installed_plugins.json").write_text(
                '{"version":2,"plugins":{"creatio-ai-app-development-toolkit@creatio":[]}}\n',
                encoding="utf-8",
            )

            installer.install_claude(repo_root, home)

            marketplace_dir = home / ".claude" / "plugins" / "marketplaces" / "creatio"
            cache_dir = (
                home
                / ".claude"
                / "plugins"
                / "cache"
                / "creatio"
                / "creatio-ai-app-development-toolkit"
                / "0.1.0"
            )
            self.assertTrue((marketplace_dir / "runbooks").exists())
            self.assertTrue((marketplace_dir / "context").exists())
            self.assertTrue((marketplace_dir / "skills").exists())
            self.assertTrue((marketplace_dir / "runtime").exists())
            self.assertTrue((marketplace_dir / ".mcp.json").exists())
            self.assertTrue((cache_dir / "skills").exists())
            self.assertFalse((marketplace_dir / "tests").exists())
            self.assertFalse((marketplace_dir / "installer").exists())
            self.assertFalse((marketplace_dir / "docs").exists())
            self.assertTrue((claude_home / "adac.mcp.json").exists())
            self.assertFalse((home / ".agents" / "skills" / "creatio-app-orchestrator" / "SKILL.md").exists())
            marketplace_skill = (marketplace_dir / "skills" / "creatio-app-orchestrator" / "SKILL.md").read_text(
                encoding="utf-8"
            )
            self.assertIn(f"Toolkit repository is installed at: `{marketplace_dir}`", marketplace_skill)
            self.assertIn(
                f"The `clio` MCP server is registered in `{claude_home / 'adac.mcp.json'}`.",
                marketplace_skill,
            )

            settings = json.loads((claude_home / "settings.json").read_text(encoding="utf-8"))
            self.assertTrue(settings["enabledPlugins"]["existing@tools"])
            self.assertTrue(settings["enabledPlugins"]["creatio-ai-app-development-toolkit@creatio"])
            self.assertEqual(settings["extraKnownMarketplaces"]["existing"]["source"]["repo"], "org/repo")
            self.assertEqual(
                settings["extraKnownMarketplaces"]["creatio"]["source"],
                {"source": "directory", "path": str(marketplace_dir)},
            )
            known_marketplaces = json.loads(
                (claude_home / "plugins" / "known_marketplaces.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                known_marketplaces["creatio"]["installLocation"],
                str(marketplace_dir),
            )
            self.assertIsInstance(known_marketplaces["creatio"]["lastUpdated"], str)
            installed_plugins = json.loads(
                (claude_home / "plugins" / "installed_plugins.json").read_text(encoding="utf-8")
            )
            plugin_key = "creatio-ai-app-development-toolkit@creatio"
            self.assertEqual(installed_plugins["version"], 2)
            self.assertEqual(
                installed_plugins["plugins"][plugin_key][0]["installPath"],
                str(cache_dir),
            )

    def test_register_claude_installed_plugin_ignores_non_dict_first_entry(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            target_path = Path(temp) / "installed_plugins.json"
            target_path.write_text(
                '{"version":2,"plugins":{"creatio-ai-app-development-toolkit@creatio":["broken"]}}\n',
                encoding="utf-8",
            )
            cache_dir = Path(temp) / "cache" / "creatio" / "creatio-ai-app-development-toolkit" / "0.1.0"

            installer.register_claude_installed_plugin(cache_dir, target_path, "0.1.0")
            installed = json.loads(target_path.read_text(encoding="utf-8"))

        plugin_entry = installed["plugins"]["creatio-ai-app-development-toolkit@creatio"][0]
        self.assertEqual(plugin_entry["installPath"], str(cache_dir))
        self.assertEqual(plugin_entry["version"], "0.1.0")

    def test_register_claude_installed_plugin_creates_registry_when_file_is_missing(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            target_path = Path(temp) / "installed_plugins.json"
            cache_dir = Path(temp) / "cache" / "creatio" / "creatio-ai-app-development-toolkit" / "0.1.0"

            installer.register_claude_installed_plugin(cache_dir, target_path, "0.1.0")
            installed = json.loads(target_path.read_text(encoding="utf-8"))

        plugin_entry = installed["plugins"]["creatio-ai-app-development-toolkit@creatio"][0]
        self.assertEqual(installed["version"], 2)
        self.assertEqual(plugin_entry["installPath"], str(cache_dir))
        self.assertEqual(plugin_entry["version"], "0.1.0")
        self.assertEqual(plugin_entry["scope"], "user")
        self.assertIsInstance(plugin_entry["installedAt"], str)
        self.assertIsInstance(plugin_entry["lastUpdated"], str)

    def test_register_claude_installed_plugin_rejects_unknown_registry_version(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            target_path = Path(temp) / "installed_plugins.json"
            target_path.write_text('{"version":1,"plugins":{"other@market":[]}}\n', encoding="utf-8")
            cache_dir = Path(temp) / "cache" / "creatio" / "creatio-ai-app-development-toolkit" / "0.1.0"

            with self.assertRaisesRegex(RuntimeError, "Expected version 2"):
                installer.register_claude_installed_plugin(cache_dir, target_path, "0.1.0")

    def test_preflight_clio_reports_missing_path(self):
        installer = load_installer()
        with patch("shutil.which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "clio was not found in PATH"):
                installer.preflight_clio()

    def test_copy_mcp_config_preserves_clio_server(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "repo"
            root.mkdir()
            (root / ".mcp.json").write_text(
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
                encoding="utf-8",
            )
            target = Path(temp) / "target" / ".mcp.json"

            installer.copy_mcp_config(root, target)
            copied = json.loads(target.read_text(encoding="utf-8"))

        self.assertEqual(copied["mcpServers"]["clio"]["args"], ["mcp-server"])

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

    def test_install_codex_copies_plugin_runtime_surface_and_registers_mcp_in_config_toml(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            skill_dir = repo_root / "skills" / "creatio-app-orchestrator"
            skill_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(
                "---\nname: creatio-app-orchestrator\ndescription: test\n---\n",
                encoding="utf-8",
            )
            (repo_root / ".mcp.json").write_text(
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
                encoding="utf-8",
            )
            (repo_root / ".codex-plugin").mkdir()
            (repo_root / ".codex-plugin" / "plugin.json").write_text(
                '{"name":"creatio-ai-app-development-toolkit","version":"0.1.0","skills":"./skills/","mcpServers":"./.mcp.json"}\n',
                encoding="utf-8",
            )
            (repo_root / ".agents" / "plugins").mkdir(parents=True)
            (repo_root / ".agents" / "plugins" / "marketplace.json").write_text(
                '{"name":"creatio","interface":{"displayName":"Creatio"},"plugins":[{"name":"creatio-ai-app-development-toolkit","version":"0.1.0","source":{"source":"local","path":"./"},"policy":{"installation":"AVAILABLE","authentication":"ON_INSTALL"},"category":"development"}]}\n',
                encoding="utf-8",
            )
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)
            home = Path(temp) / "home"
            codex_home = home / ".codex"
            codex_home.mkdir(parents=True)
            (codex_home / "config.toml").write_text('model = "gpt-5.4"\n', encoding="utf-8")
            personal_marketplace_dir = home / ".agents" / "plugins"
            personal_marketplace_dir.mkdir(parents=True)
            (personal_marketplace_dir / "marketplace.json").write_text(
                '{"name":"personal-marketplace","interface":{"displayName":"Personal Marketplace"},"plugins":[{"name":"creatio-ai-app-development-toolkit","version":"0.0.1","source":{"source":"local","path":"./"},"policy":{"installation":"AVAILABLE","authentication":"ON_INSTALL"},"category":"development"}]}\n',
                encoding="utf-8",
            )

            installer.install_codex(repo_root, home)

            marketplace_dir = codex_home / "plugins" / "marketplaces" / "creatio"
            cache_dir = (
                codex_home
                / "plugins"
                / "cache"
                / "creatio"
                / "creatio-ai-app-development-toolkit"
                / "0.1.0"
            )
            marketplace_plugin_dir = marketplace_dir / "plugins" / "creatio-ai-app-development-toolkit"
            self.assertTrue((marketplace_plugin_dir / "runbooks").exists())
            self.assertTrue((marketplace_plugin_dir / "context").exists())
            self.assertFalse((marketplace_plugin_dir / "skills").exists())
            self.assertTrue((marketplace_plugin_dir / ".mcp.json").exists())
            self.assertTrue((marketplace_plugin_dir / ".codex-plugin" / "plugin.json").exists())
            self.assertTrue((marketplace_dir / ".agents" / "plugins" / "marketplace.json").exists())
            self.assertFalse((marketplace_plugin_dir / "tests").exists())
            self.assertFalse((marketplace_plugin_dir / "installer").exists())
            self.assertTrue((cache_dir / "runbooks").exists())
            self.assertTrue((cache_dir / ".codex-plugin" / "plugin.json").exists())
            self.assertFalse((cache_dir / "skills").exists())
            self.assertFalse((home / ".agents" / "plugins" / "creatio-ai-app-development-toolkit").exists())
            self.assertFalse((home / ".agents" / "skills" / "creatio-app-orchestrator" / "SKILL.md").exists())
            standalone_skill = codex_home / "skills" / "creatio-app-orchestrator" / "SKILL.md"
            self.assertTrue(standalone_skill.exists())
            marketplace_skill = standalone_skill.read_text(
                encoding="utf-8"
            )
            self.assertIn(
                f"Toolkit repository is installed at: `{cache_dir}`",
                marketplace_skill,
            )
            self.assertIn(
                f"The `clio` MCP server is registered in `{codex_home / 'config.toml'}`.",
                marketplace_skill,
            )
            config_body = (codex_home / "config.toml").read_text(encoding="utf-8")
            self.assertIn('model = "gpt-5.4"', config_body)
            self.assertIn("[marketplaces.creatio]", config_body)
            self.assertIn('source_type = "local"', config_body)
            self.assertIn('[plugins."creatio-ai-app-development-toolkit@creatio"]', config_body)
            self.assertIn("enabled = true", config_body)
            self.assertIn("[mcp_servers.clio]", config_body)
            self.assertIn('command = "clio"', config_body)
            self.assertIn('args = ["mcp-server"]', config_body)
            personal_marketplace = json.loads(
                (home / ".agents" / "plugins" / "marketplace.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                personal_marketplace["plugins"][0]["name"],
                "creatio-ai-app-development-toolkit",
            )
            self.assertEqual(
                personal_marketplace["plugins"][0]["source"]["path"],
                "./",
            )
            codex_marketplace = json.loads(
                (marketplace_dir / ".agents" / "plugins" / "marketplace.json").read_text(encoding="utf-8")
            )
            self.assertEqual(codex_marketplace["plugins"][0]["source"]["path"], "./plugins/creatio-ai-app-development-toolkit")

    def test_merge_personal_marketplace_catalog_fills_missing_display_name_without_overwriting_name(self):
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

    def test_remove_tree_if_exists_wraps_permission_error_with_host_hint(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "busy"
            target.mkdir()
            with patch("shutil.rmtree", side_effect=PermissionError("busy")):
                with self.assertRaisesRegex(RuntimeError, "Close Claude Code and retry"):
                    installer.remove_tree_if_exists(target, "Claude Code")

    def test_install_codex_preserves_existing_clio_mcp_server(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            skill_dir = repo_root / "skills" / "creatio-app-orchestrator"
            skill_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(
                "---\nname: creatio-app-orchestrator\ndescription: test\n---\n",
                encoding="utf-8",
            )
            (repo_root / ".mcp.json").write_text(
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
                encoding="utf-8",
            )
            (repo_root / ".codex-plugin").mkdir()
            (repo_root / ".codex-plugin" / "plugin.json").write_text(
                '{"name":"creatio-ai-app-development-toolkit","version":"0.1.0","skills":"./skills/","mcpServers":"./.mcp.json"}\n',
                encoding="utf-8",
            )
            (repo_root / ".agents" / "plugins").mkdir(parents=True)
            (repo_root / ".agents" / "plugins" / "marketplace.json").write_text(
                '{"name":"creatio","interface":{"displayName":"Creatio"},"plugins":[{"name":"creatio-ai-app-development-toolkit","version":"0.1.0","source":{"source":"local","path":"./"},"policy":{"installation":"AVAILABLE","authentication":"ON_INSTALL"},"category":"development"}]}\n',
                encoding="utf-8",
            )
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)
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
            self.assertIn("[marketplaces.creatio]", config_body)
            self.assertIn('[plugins."creatio-ai-app-development-toolkit@creatio"]', config_body)
            printed.assert_called_once()

    def test_install_codex_removes_legacy_disabled_skill_override(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            skill_dir = repo_root / "skills" / "creatio-app-orchestrator"
            skill_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(
                "---\nname: creatio-app-orchestrator\ndescription: test\n---\n",
                encoding="utf-8",
            )
            (repo_root / ".mcp.json").write_text(
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
                encoding="utf-8",
            )
            (repo_root / ".codex-plugin").mkdir()
            (repo_root / ".codex-plugin" / "plugin.json").write_text(
                '{"name":"creatio-ai-app-development-toolkit","version":"0.1.0","skills":"./skills/","mcpServers":"./.mcp.json"}\n',
                encoding="utf-8",
            )
            (repo_root / ".agents" / "plugins").mkdir(parents=True)
            (repo_root / ".agents" / "plugins" / "marketplace.json").write_text(
                '{"name":"creatio","interface":{"displayName":"Creatio"},"plugins":[{"name":"creatio-ai-app-development-toolkit","version":"0.1.0","source":{"source":"local","path":"./"},"policy":{"installation":"AVAILABLE","authentication":"ON_INSTALL"},"category":"development"}]}\n',
                encoding="utf-8",
            )
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)
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

    def test_install_codex_rejects_checkout_without_required_references(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            skill_dir = repo_root / "skills" / "creatio-app-orchestrator"
            skill_dir.mkdir(parents=True)
            (skill_dir / "SKILL.md").write_text(
                "---\nname: creatio-app-orchestrator\ndescription: test\n---\n",
                encoding="utf-8",
            )
            (repo_root / ".mcp.json").write_text(
                '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
                encoding="utf-8",
            )

            with self.assertRaisesRegex(RuntimeError, "missing required reference files"):
                installer.install_codex(repo_root, Path(temp) / "home")

    def test_resolve_repo_root_returns_current_checkout(self):
        installer = load_installer()
        with patch.object(installer, "current_checkout_root", return_value=ROOT):
            resolved = installer.resolve_repo_root()
        self.assertEqual(resolved, ROOT)

    def test_resolve_repo_root_raises_outside_checkout(self):
        installer = load_installer()
        with patch.object(installer, "current_checkout_root", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "must be run from a plugin checkout"):
                installer.resolve_repo_root()

    def test_install_py_has_no_git_or_repo_url_constants(self):
        installer = load_installer()
        self.assertFalse(hasattr(installer, "DEFAULT_REPO_URL"))
        self.assertFalse(hasattr(installer, "DEFAULT_INSTALL_ROOT"))
        self.assertFalse(hasattr(installer, "clone_or_update_repo"))
        self.assertTrue(hasattr(installer, "render_codex_skill"))

    def test_parse_args_only_exposes_target_flag(self):
        installer = load_installer()
        namespace = installer.parse_args([])
        self.assertIsNone(namespace.target)
        self.assertFalse(hasattr(namespace, "repo_url"))
        self.assertFalse(hasattr(namespace, "ref"))
        self.assertFalse(hasattr(namespace, "install_root"))

    def test_load_plugin_runtime_paths_reads_release_manifest(self):
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

    def test_load_plugin_runtime_paths_raises_when_manifest_missing(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            with self.assertRaisesRegex(RuntimeError, "release-manifest.json"):
                installer.load_plugin_runtime_paths(repo_root)

    def test_install_cursor_rule_survives_source_deletion(self):
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

            shutil_module = __import__("shutil")
            shutil_module.rmtree(repo_root)
            self.assertFalse(repo_root.exists())

            for line in rule_body.splitlines():
                if "`" not in line:
                    continue
                for token in line.split("`"):
                    candidate = Path(token)
                    if not candidate.is_absolute():
                        continue
                    if candidate.is_relative_to(repo_root):
                        self.fail(
                            f"Cursor rule contains absolute path under deleted source: {token}"
                        )

    def test_prune_directory_entries_clears_readonly_flag(self):
        """Regression for ENG-89390: `copilot plugin install` leaves a .git tree
        with read-only pack objects under installed-plugins/. On Windows, default
        shutil.rmtree raises PermissionError on those files and aborts pruning
        mid-iteration, leaving disallowed entries (docs/, installer/, tests/, .git)
        behind and preventing the post-prune SKILL.md write."""
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            plugin_dir = Path(temp) / "installed-plugins" / "plugin"
            plugin_dir.mkdir(parents=True)

            # Allowed entry — must survive prune
            (plugin_dir / "AGENTS.md").write_text("keep me\n", encoding="utf-8")

            # Read-only directory mimicking git pack objects
            git_pack_dir = plugin_dir / ".git" / "objects" / "pack"
            git_pack_dir.mkdir(parents=True)
            pack_file = git_pack_dir / "pack-abc.pack"
            pack_file.write_bytes(b"binary pack data")
            os.chmod(pack_file, stat.S_IREAD)

            # Read-only top-level file that's also disallowed
            readonly_file = plugin_dir / ".gitattributes"
            readonly_file.write_text("* text=auto\n", encoding="utf-8")
            os.chmod(readonly_file, stat.S_IREAD)

            # A plain disallowed dir
            (plugin_dir / "docs").mkdir()
            (plugin_dir / "docs" / "index.md").write_text("doc\n", encoding="utf-8")

            try:
                installer.prune_directory_entries(plugin_dir, {"AGENTS.md"}, "test prune")

                self.assertTrue((plugin_dir / "AGENTS.md").exists())
                self.assertFalse((plugin_dir / ".git").exists())
                self.assertFalse((plugin_dir / ".gitattributes").exists())
                self.assertFalse((plugin_dir / "docs").exists())
            finally:
                # Best-effort cleanup if the test itself fails before pruning
                for path in plugin_dir.rglob("*"):
                    try:
                        os.chmod(path, stat.S_IWRITE)
                    except OSError:
                        pass


    def test_write_setup_wizard_manifest_maps_target_ids_and_writes_to_caadt_dir(self):
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
            self.assertTrue(manifest_path.exists())
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

    def test_write_setup_wizard_manifest_handles_empty_install_list(self):
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

    def test_write_setup_wizard_manifest_filters_unknown_target_ids(self):
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

    def test_setup_wizard_manifest_is_opt_in(self):
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

    def test_main_does_not_write_setup_wizard_manifest_by_default(self):
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

    def test_main_writes_setup_wizard_manifest_when_requested(self):
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

    def test_main_returns_error_when_preflight_fails_before_install(self):
        installer = load_installer()
        with patch.object(installer, "preflight_clio", side_effect=RuntimeError("boom")):
            result = installer.main([])

        self.assertEqual(result, 1)


if __name__ == "__main__":
    unittest.main()

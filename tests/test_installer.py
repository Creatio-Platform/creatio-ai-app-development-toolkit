import importlib.util
import json
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

    def test_install_copilot_copies_skills_and_merges_mcp_config(self):
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
            write_required_references(installer, repo_root)
            home = Path(temp) / "home"
            copilot_home = home / ".copilot"
            copilot_home.mkdir(parents=True)
            (copilot_home / "mcp-config.json").write_text(
                '{"mcpServers":{"other":{"command":"other","args":[]}}}\n',
                encoding="utf-8",
            )

            installer.install_copilot(repo_root, home)

            installed_skill = (
                copilot_home / "skills" / "creatio-app-orchestrator" / "SKILL.md"
            )
            self.assertTrue(installed_skill.exists())
            installed_skill_body = installed_skill.read_text(encoding="utf-8")
            self.assertIn(str(repo_root / "AGENTS.md"), installed_skill_body)
            self.assertIn(str(repo_root / "runbooks" / "02-requirements-gathering.md"), installed_skill_body)
            self.assertIn(str(repo_root / "runtime" / "scripts" / "workflow_validators.py"), installed_skill_body)
            self.assertIn(str(copilot_home / "mcp-config.json"), installed_skill_body)

            merged = json.loads((copilot_home / "mcp-config.json").read_text(encoding="utf-8"))
            self.assertIn("clio", merged["mcpServers"])
            self.assertIn("other", merged["mcpServers"])
            self.assertEqual(merged["mcpServers"]["clio"]["args"], ["mcp-server"])

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

    def test_install_copilot_preserves_existing_clio_mcp_server(self):
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
            write_required_references(installer, repo_root)
            home = Path(temp) / "home"
            copilot_home = home / ".copilot"
            copilot_home.mkdir(parents=True)
            (copilot_home / "mcp-config.json").write_text(
                '{"mcpServers":{"clio":{"command":"custom-clio","args":["custom"]}}}\n',
                encoding="utf-8",
            )

            with patch("builtins.print") as printed:
                installer.install_copilot(repo_root, home)

            merged = json.loads((copilot_home / "mcp-config.json").read_text(encoding="utf-8"))
            self.assertEqual(merged["mcpServers"]["clio"]["command"], "custom-clio")
            self.assertEqual(merged["mcpServers"]["clio"]["args"], ["custom"])
            printed.assert_called_once()

    def test_install_for_targets_routes_to_copilot(self):
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
            write_required_references(installer, repo_root)
            home = Path(temp) / "home"
            copilot_home = home / ".copilot"
            copilot_home.mkdir(parents=True)

            targets = [{"id": "copilot", "name": "GitHub Copilot CLI", "home": copilot_home}]
            installed = installer.install_for_targets(repo_root, targets)

            self.assertEqual(installed, ["copilot"])
            self.assertTrue((copilot_home / "skills" / "creatio-app-orchestrator" / "SKILL.md").exists())
            mcp_config = copilot_home / "mcp-config.json"
            self.assertTrue(mcp_config.exists())
            merged = json.loads(mcp_config.read_text(encoding="utf-8"))
            self.assertIn("clio", merged["mcpServers"])
            self.assertEqual(merged["mcpServers"]["clio"]["args"], ["mcp-server"])

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

            rule_path = cursor_home / "rules" / "creatio-app-orchestrator.mdc"
            self.assertTrue(rule_path.exists())
            rule_body = rule_path.read_text(encoding="utf-8")
            self.assertIn("description:", rule_body)
            self.assertIn("Creatio App Orchestrator", rule_body)
            self.assertIn(str(repo_root), rule_body)
            self.assertIn(str(cursor_home / "mcp.json"), rule_body)

            local_plugin_manifest = (
                cursor_home
                / "plugins"
                / "local"
                / "creatio-ai-app-development-toolkit"
                / ".cursor-plugin"
                / "plugin.json"
            )
            self.assertTrue(local_plugin_manifest.exists())
            self.assertFalse((local_plugin_manifest.parents[1] / "tests").exists())
            self.assertFalse((local_plugin_manifest.parents[1] / "installer").exists())

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
            (repo_root / ".claude-plugin" / "plugin.json").write_text("{}\n", encoding="utf-8")
            (repo_root / "AGENTS.md").write_text("rules\n", encoding="utf-8")
            (repo_root / "tests" / "test_dev_only.py").write_text("dev\n", encoding="utf-8")
            (repo_root / "installer" / "install.py").write_text("dev\n", encoding="utf-8")
            (repo_root / "docs" / "install.md").write_text("dev\n", encoding="utf-8")

            home = Path(temp) / "home"
            claude_home = home / ".claude"
            claude_home.mkdir(parents=True)
            (claude_home / "settings.json").write_text(
                '{"enabledPlugins":{"existing@tools":true},"extraKnownMarketplaces":{"existing":{"source":{"source":"github","repo":"org/repo"}}}}\n',
                encoding="utf-8",
            )

            installer.install_claude(repo_root, home)

            marketplace_dir = home / ".claude" / "plugins" / "marketplaces" / "creatio"
            self.assertTrue((marketplace_dir / "runbooks").exists())
            self.assertTrue((marketplace_dir / "context").exists())
            self.assertTrue((marketplace_dir / "skills").exists())
            self.assertTrue((marketplace_dir / "runtime").exists())
            self.assertTrue((marketplace_dir / ".mcp.json").exists())
            self.assertFalse((marketplace_dir / "tests").exists())
            self.assertFalse((marketplace_dir / "installer").exists())
            self.assertFalse((marketplace_dir / "docs").exists())
            self.assertTrue((claude_home / "adac.mcp.json").exists())

            settings = json.loads((claude_home / "settings.json").read_text(encoding="utf-8"))
            self.assertTrue(settings["enabledPlugins"]["existing@tools"])
            self.assertTrue(settings["enabledPlugins"]["creatio-ai-app-development-toolkit@creatio"])
            self.assertEqual(settings["extraKnownMarketplaces"]["existing"]["source"]["repo"], "org/repo")
            self.assertEqual(
                settings["extraKnownMarketplaces"]["creatio"]["source"],
                {"source": "directory", "path": str(marketplace_dir)},
            )

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

    def test_install_codex_copies_skills_and_registers_mcp_in_config_toml(self):
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
            write_required_references(installer, repo_root)
            home = Path(temp) / "home"
            codex_home = home / ".codex"
            codex_home.mkdir(parents=True)
            (codex_home / "config.toml").write_text('model = "gpt-5.4"\n', encoding="utf-8")

            installer.install_codex(repo_root, home)

            installed_skill = (
                home
                / ".codex"
                / "skills"
                / "creatio-app-orchestrator"
                / "SKILL.md"
            )
            self.assertTrue(
                installed_skill.exists()
            )
            installed_skill_body = installed_skill.read_text(encoding="utf-8")
            self.assertIn(str(repo_root / "AGENTS.md"), installed_skill_body)
            self.assertIn(str(repo_root / "runbooks" / "02-requirements-gathering.md"), installed_skill_body)
            self.assertIn(str(repo_root / "runtime" / "scripts" / "workflow_validators.py"), installed_skill_body)
            config_body = (codex_home / "config.toml").read_text(encoding="utf-8")
            self.assertIn('model = "gpt-5.4"', config_body)
            self.assertIn("[mcp_servers.clio]", config_body)
            self.assertIn('command = "clio"', config_body)
            self.assertIn('args = ["mcp-server"]', config_body)
            self.assertIn(str(codex_home / "config.toml"), installed_skill_body)
            self.assertFalse((home / ".agents" / "plugins" / "marketplace.json").exists())

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
            write_required_references(installer, repo_root)
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

    def test_clone_command_includes_optional_ref_checkout(self):
        installer = load_installer()
        commands = []

        def fake_run(command, **_kwargs):
            commands.append(command)

        with tempfile.TemporaryDirectory() as temp, patch.object(installer, "run_checked", side_effect=fake_run):
            installer.clone_or_update_repo(
                "https://creatio.ghe.com/engineering/ai-driven-app-creation.git",
                Path(temp) / "repo",
                ref="v0.1.0",
            )

        self.assertEqual(commands[0][:2], ["git", "clone"])
        self.assertEqual(commands[-1], ["git", "checkout", "v0.1.0"])

    def test_existing_checkout_without_ref_fast_forwards_worktree(self):
        installer = load_installer()
        commands = []

        def fake_run(command, **_kwargs):
            commands.append(command)

        with tempfile.TemporaryDirectory() as temp, patch.object(installer, "run_checked", side_effect=fake_run):
            repo = Path(temp) / "repo"
            (repo / ".git").mkdir(parents=True)

            installer.clone_or_update_repo(
                "https://creatio.ghe.com/engineering/ai-driven-app-creation.git",
                repo,
            )

        self.assertEqual(commands, [["git", "fetch", "--all", "--tags"], ["git", "pull", "--ff-only"]])

    def test_resolve_repo_root_prefers_current_checkout_without_ref(self):
        installer = load_installer()

        with patch.object(installer, "current_checkout_root", return_value=ROOT), patch.object(
            installer,
            "clone_or_update_repo",
            side_effect=AssertionError("clone should not run for local checkout installs"),
        ):
            resolved = installer.resolve_repo_root(
                "https://creatio.ghe.com/engineering/ai-driven-app-creation.git",
                None,
                None,
            )

        self.assertEqual(resolved, ROOT)

    def test_resolve_repo_root_uses_default_checkout_when_ref_is_requested(self):
        installer = load_installer()
        with patch.object(installer, "current_checkout_root", return_value=ROOT), patch.object(
            installer,
            "clone_or_update_repo",
            return_value=Path("resolved"),
        ) as clone:
            resolved = installer.resolve_repo_root(
                "https://creatio.ghe.com/engineering/ai-driven-app-creation.git",
                None,
                "v0.1.0",
            )

        self.assertEqual(resolved, Path("resolved"))
        clone.assert_called_once_with(
            "https://creatio.ghe.com/engineering/ai-driven-app-creation.git",
            installer.DEFAULT_INSTALL_ROOT,
            "v0.1.0",
        )


if __name__ == "__main__":
    unittest.main()

import importlib.util
import json
import os
import re
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
        ".agents",
        ".claude-plugin",
        ".github/plugin",
        "plugins",
    ]
    manifest_path = repo_root / ".release-manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps({"plugin_runtime": paths, "release_extras": ["installer", "RELEASE-NOTES.md"]}) + "\n",
        encoding="utf-8",
    )


# The plugin that ships `*.workflow.js` scripts and the generated manifest in the real tree.
WORKFLOW_PLUGIN_SKILLS = Path("plugins") / "creatio-migration" / "skills"


def bundled_skills_dir(source_root):
    """`plugins/creatio-migration/skills/` - where workflow-carrying skills live after the plugin split."""
    return source_root / WORKFLOW_PLUGIN_SKILLS


def write_bundled_workflow(source_root, skill_dir_name, script_stem, meta_name, body=""):
    """Write a `plugins/creatio-migration/skills/<skill>/<stem>.workflow.js` and its entry in the generated manifest.

    The manifest is what the installer reads: the script's own `meta.name` is still written so the
    fixture looks like the real artifact, but no consumer parses it any more (PR #147 review).
    """
    skill_dir = bundled_skills_dir(source_root) / skill_dir_name
    skill_dir.mkdir(parents=True, exist_ok=True)
    script = skill_dir / f"{script_stem}.workflow.js"
    script.write_text(
        f"export const meta = {{\n  name: '{meta_name}',\n}}\n{body}",
        encoding="utf-8",
    )
    add_workflow_manifest_entry(source_root, script, meta_name)
    return script


def add_workflow_manifest_entry(source_root, script, meta_name, phases=("Describe",), manifest_relative=None):
    """Append `{name, script, phases}` to the generated manifest (the plugin-split path by default)."""
    installer = load_installer()
    manifest_path = source_root / (manifest_relative or installer.WORKFLOW_MANIFEST_RELATIVE)
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest = (
        json.loads(manifest_path.read_text(encoding="utf-8"))
        if manifest_path.is_file()
        else {"workflows": []}
    )
    manifest["workflows"].append({
        "name": meta_name,
        "script": script.relative_to(source_root).as_posix(),
        "phases": list(phases),
    })
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def write_minimal_plugin_checkout(repo_root):
    """Lay out the files the install_* functions read from the local checkout: the plugin-split
    tree (root meta-plugin manifest, `plugins/creatio-core/.mcp.json`, skills under `plugins/*/skills/`)."""
    (repo_root / ".claude-plugin").mkdir(parents=True, exist_ok=True)
    (repo_root / ".claude-plugin" / "plugin.json").write_text(
        '{"name":"creatio-ai-app-development-toolkit","version":"0.1.0","dependencies":["creatio-core"]}\n',
        encoding="utf-8",
    )
    core = repo_root / "plugins" / "creatio-core"
    core.mkdir(parents=True, exist_ok=True)
    (core / ".mcp.json").write_text(
        '{"mcpServers":{"clio":{"command":"clio","args":["mcp-server"]}}}\n',
        encoding="utf-8",
    )
    (core / "hooks").mkdir(exist_ok=True)
    (core / "hooks" / "telemetry-routing.mjs").write_text("// hook\n", encoding="utf-8")
    (repo_root / ".github" / "plugin").mkdir(parents=True, exist_ok=True)
    (repo_root / ".github" / "plugin" / "plugin.json").write_text(
        '{"name":"creatio-ai-app-development-toolkit","version":"0.1.0"}\n',
        encoding="utf-8",
    )
    skill_dir = repo_root / "plugins" / "creatio-app-builder" / "skills" / "creatio-app-orchestrator"
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(
        "---\nname: creatio-app-orchestrator\ndescription: test\n---\n",
        encoding="utf-8",
    )


def write_legacy_single_plugin_tree(root):
    """A tree from BEFORE the plugin split - what a cached plugin version installed by 1.x looks
    like: root `.mcp.json`, root `skills/` with the manifest under `skills/_workflow-core/`."""
    (root / ".claude-plugin").mkdir(parents=True, exist_ok=True)
    (root / ".claude-plugin" / "plugin.json").write_text(
        '{"name":"creatio-ai-app-development-toolkit","version":"0.0.9"}\n', encoding="utf-8"
    )
    (root / ".mcp.json").write_text(
        '{"mcpServers":{"clio":{"command":"clio-legacy","args":["mcp-server"]}}}\n', encoding="utf-8"
    )
    skill_dir = root / "skills" / "legacy-skill"
    skill_dir.mkdir(parents=True, exist_ok=True)
    script = skill_dir / "legacy.workflow.js"
    script.write_text("export const meta = {\n  name: 'creatio-legacy',\n}\n", encoding="utf-8")
    installer = load_installer()
    add_workflow_manifest_entry(
        root, script, "creatio-legacy", manifest_relative=installer.LEGACY_WORKFLOW_MANIFEST_RELATIVE
    )
    return script


class PluginLayoutDetectionTests(unittest.TestCase):
    """The install-gating branches the plugin split added, each exercised on a tmp tree."""

    def test_is_plugin_checkout_accepts_the_plugin_split_tree_only(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            multi = Path(temp) / "multi"
            multi.mkdir()
            write_minimal_plugin_checkout(multi)
            self.assertTrue(installer.is_plugin_checkout(multi))

            # A pre-split tree is not installable by this version: every required reference lives
            # under plugins/, so admitting it here would only move the failure downstream.
            legacy = Path(temp) / "legacy"
            legacy.mkdir()
            write_legacy_single_plugin_tree(legacy)
            self.assertFalse(installer.is_plugin_checkout(legacy))

            # The root meta-plugin manifest is required...
            no_manifest = Path(temp) / "no-manifest"
            no_manifest.mkdir()
            write_minimal_plugin_checkout(no_manifest)
            (no_manifest / ".claude-plugin" / "plugin.json").unlink()
            self.assertFalse(installer.is_plugin_checkout(no_manifest))

            # ...and so is the core plugin's clio declaration.
            no_core_mcp = Path(temp) / "no-core-mcp"
            no_core_mcp.mkdir()
            write_minimal_plugin_checkout(no_core_mcp)
            (no_core_mcp / "plugins" / "creatio-core" / ".mcp.json").unlink()
            self.assertFalse(installer.is_plugin_checkout(no_core_mcp))

            self.assertFalse(installer.is_plugin_checkout(Path(temp) / "absent"))

    def test_mcp_config_path_prefers_the_core_plugin_copy(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_minimal_plugin_checkout(root)
            core_copy = root / installer.MCP_CONFIG_RELATIVE
            self.assertEqual(installer.mcp_config_path(root), core_copy)

            # A leftover root .mcp.json is superseded-layout debris: the core copy still wins.
            (root / ".mcp.json").write_text('{"mcpServers":{"clio":{"command":"stale"}}}\n', encoding="utf-8")
            self.assertEqual(installer.mcp_config_path(root), core_copy)
            self.assertEqual(installer.load_mcp_servers(root)["clio"]["command"], "clio")

            # Only a tree with no core copy at all falls back to the root file.
            core_copy.unlink()
            self.assertEqual(installer.mcp_config_path(root), root / ".mcp.json")
            self.assertEqual(installer.load_mcp_servers(root)["clio"]["command"], "stale")

            # Neither present: the path names the core location, and loading fails loudly.
            (root / ".mcp.json").unlink()
            self.assertEqual(installer.mcp_config_path(root), core_copy)
            with self.assertRaisesRegex(RuntimeError, "MCP config not found"):
                installer.load_mcp_servers(root)

    def test_workflow_manifest_names_falls_back_to_the_legacy_manifest_only_when_the_new_one_is_absent(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            write_legacy_single_plugin_tree(root)
            self.assertEqual(
                installer.workflow_manifest_names(root),
                {"skills/legacy-skill/legacy.workflow.js": "creatio-legacy"},
            )

            # Both present (a hybrid tree): the plugin-split manifest is authoritative.
            write_bundled_workflow(root, "new-skill", "new", "creatio-new")
            self.assertEqual(
                installer.workflow_manifest_names(root),
                {"plugins/creatio-migration/skills/new-skill/new.workflow.js": "creatio-new"},
            )

    def test_discover_workflow_scripts_unions_both_layouts_deduplicated_and_sorted(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            legacy_script = write_legacy_single_plugin_tree(root)
            new_b = write_bundled_workflow(root, "skill-b", "two", "creatio-two")
            new_a = write_bundled_workflow(root, "skill-a", "one", "creatio-one")
            # A second plugin shipping a script is discovered too (the glob is plugins/*/skills/*/).
            other = root / "plugins" / "creatio-other" / "skills" / "x"
            other.mkdir(parents=True)
            other_script = other / "z.workflow.js"
            other_script.write_text("export const meta = { name: 'creatio-z' }\n", encoding="utf-8")
            # Non-workflow files and nested files are not scripts.
            (other / "notes.js").write_text("", encoding="utf-8")
            (other / "deep").mkdir()
            (other / "deep" / "hidden.workflow.js").write_text("", encoding="utf-8")

            found = installer.discover_workflow_scripts(root)

            self.assertEqual(found, sorted({legacy_script, new_a, new_b, other_script}))
            self.assertEqual(len(found), len(set(found)))

    def test_discover_workflow_scripts_on_each_layout_alone(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            legacy = Path(temp) / "legacy"
            legacy.mkdir()
            legacy_script = write_legacy_single_plugin_tree(legacy)
            self.assertEqual(installer.discover_workflow_scripts(legacy), [legacy_script])

            multi = Path(temp) / "multi"
            multi.mkdir()
            script = write_bundled_workflow(multi, "skill-a", "one", "creatio-one")
            self.assertEqual(installer.discover_workflow_scripts(multi), [script])

            self.assertEqual(installer.discover_workflow_scripts(Path(temp) / "absent"), [])

    def test_a_legacy_cached_tree_still_provisions_its_workflows(self):
        # update.py mirrors workflows from a cached plugin version, which may predate the split.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "cache"
            root.mkdir()
            write_legacy_single_plugin_tree(root)
            claude_home = Path(temp) / ".claude"
            self.assertEqual(installer.provision_named_workflows(root, claude_home), ["creatio-legacy"])
            self.assertTrue((claude_home / "workflows" / "creatio-legacy.js").exists())

    def test_required_references_gate_fails_on_the_pre_split_tree(self):
        # The asymmetry is intentional and visible: a legacy tree is rejected before this gate by
        # is_plugin_checkout; if it ever reached the gate, it would still fail loudly, not pass.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            legacy = Path(temp)
            write_legacy_single_plugin_tree(legacy)
            with self.assertRaisesRegex(RuntimeError, "missing required reference files"):
                installer.ensure_required_references(legacy)


class RepoTruthTests(unittest.TestCase):
    """The installer's path constants against the real checkout - a typo in any of them would
    otherwise ship green (the fixtures write whatever the constants say) and fail for every user."""

    def test_required_references_exist_in_the_repository(self):
        installer = load_installer()
        installer.ensure_required_references(ROOT)
        for relative in installer.REQUIRED_REFERENCE_PATHS:
            self.assertTrue((ROOT / relative).is_file(), relative)

    def test_load_order_and_rule_paths_exist_in_the_repository(self):
        installer = load_installer()
        rendered = installer.render_load_order(ROOT) + installer.render_cursor_rule(
            ROOT, ROOT / installer.MCP_CONFIG_RELATIVE
        )
        for prefix in (str(ROOT) + "\\", str(ROOT) + "/", ROOT.as_posix() + "/"):
            rendered = rendered.replace(prefix, "")
        referenced = [
            ref for ref in re.findall(r"`([^`]+)`", rendered)
            if ("/" in ref or "\\" in ref) and "." in ref.replace("\\", "/").rsplit("/", 1)[-1]
        ]
        self.assertTrue(referenced)
        for ref in referenced:
            self.assertTrue((ROOT / ref.replace("\\", "/")).is_file(), ref)

    def test_layout_constants_resolve_in_the_repository(self):
        installer = load_installer()
        self.assertTrue(installer.is_plugin_checkout(ROOT))
        self.assertEqual(installer.mcp_config_path(ROOT), ROOT / installer.MCP_CONFIG_RELATIVE)
        self.assertTrue((ROOT / installer.MCP_CONFIG_RELATIVE).is_file())
        self.assertTrue((ROOT / installer.WORKFLOW_MANIFEST_RELATIVE).is_file())
        self.assertTrue((ROOT / installer.TELEMETRY_HOOK_RELATIVE).is_file())
        # The shipped release manifest carries the tree the constants point into.
        runtime_paths = installer.load_plugin_runtime_paths(ROOT)
        self.assertIn("plugins", runtime_paths)
        self.assertTrue(all((ROOT / p).exists() for p in runtime_paths), runtime_paths)
        # Every shipped workflow script is discovered and named by the shipped manifest.
        scripts = installer.discover_workflow_scripts(ROOT)
        self.assertTrue(scripts)
        names = installer.workflow_manifest_names(ROOT)
        for script in scripts:
            self.assertIn(script.relative_to(ROOT).as_posix(), names)


class CursorTelemetryHookPathTests(unittest.TestCase):
    def test_registered_hook_command_points_at_the_copied_file(self):
        # The plugin runtime surface is copied with its repo-relative paths, so the hook lands under
        # <local_plugin_dir>/plugins/creatio-core/hooks/. hooks.json must name that file, not a
        # <local_plugin_dir>/hooks/ path from before the split - a dangling command fails silently
        # on every clio call and the telemetry floor simply stops firing.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            write_minimal_plugin_checkout(repo_root)
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)
            home = Path(temp) / "home"
            cursor_home = home / ".cursor"
            cursor_home.mkdir(parents=True)

            with patch("builtins.print"):
                installer.install_cursor(repo_root, home)

            config = json.loads((cursor_home / "hooks.json").read_text(encoding="utf-8"))
            commands = [item["command"] for item in config["hooks"]["afterMCPExecution"]]
            self.assertEqual(len(commands), 1)
            match = re.fullmatch(r'node "(.+)"', commands[0])
            self.assertIsNotNone(match, commands[0])
            hook_path = Path(match.group(1))
            self.assertTrue(hook_path.is_file(), f"hooks.json names a file that was not installed: {hook_path}")
            local_plugin_dir = cursor_home / "plugins" / "local" / installer.PLUGIN_NAME
            self.assertEqual(hook_path, local_plugin_dir / installer.TELEMETRY_HOOK_RELATIVE)

    def test_hook_constant_and_core_manifest_name_the_same_file(self):
        # The Claude manifest registers ${CLAUDE_PLUGIN_ROOT}/hooks/telemetry-routing.mjs inside the
        # core plugin; the Cursor command must not drift from it.
        installer = load_installer()
        manifest = json.loads(
            (ROOT / "plugins" / "creatio-core" / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8")
        )
        claude_commands = {
            hook["command"] for entries in manifest["hooks"].values() for entry in entries for hook in entry["hooks"]
        }
        inside_core = installer.TELEMETRY_HOOK_RELATIVE.split("plugins/creatio-core/", 1)[1]
        self.assertEqual(claude_commands, {'node "${CLAUDE_PLUGIN_ROOT}/' + inside_core + '"'})


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
            # Dead since the file-copy skill install went, and it read the pre-split root `skills/`.
            "copy_skill_directories",
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

    def test_provisions_bundled_workflows_as_named_workflows(self):
        # The marketplace install cannot register a named workflow, so the
        # skills' `Workflow({ name: ... })` calls only resolve if install_claude
        # mirrors the bundled scripts into user scope.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            write_minimal_plugin_checkout(repo_root)
            write_required_references(installer, repo_root)
            write_release_manifest(repo_root)
            write_bundled_workflow(repo_root, "demo-skill", "demo", "creatio-demo-workflow")
            home = Path(temp) / "home"
            (home / ".claude").mkdir(parents=True)

            with patch.object(
                installer.agent_cli, "preflight_claude", return_value="claude"
            ), patch.object(installer, "run_checked"):
                installer.install_claude(repo_root, home)

            mirrored = home / ".claude" / "workflows" / "creatio-demo-workflow.js"
            self.assertTrue(mirrored.exists())
            # Byte-identical: the mirror is a copy, never a rewritten variant.
            self.assertEqual(
                mirrored.read_text(encoding="utf-8"),
                (bundled_skills_dir(repo_root) / "demo-skill" / "demo.workflow.js").read_text(
                    encoding="utf-8"
                ),
            )


class ProvisionNamedWorkflowsTests(unittest.TestCase):
    def test_names_the_mirror_after_meta_name_not_the_filename(self):
        # Resolution may key on either identity, so the two must agree — the
        # bundled filename (`<x>.workflow.js`) never does on its own.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            source_root = Path(temp) / "src"
            write_bundled_workflow(source_root, "a-skill", "build", "creatio-build-thing")
            claude_home = Path(temp) / "home" / ".claude"

            provisioned = installer.provision_named_workflows(source_root, claude_home)

            self.assertEqual(provisioned, ["creatio-build-thing"])
            self.assertTrue((claude_home / "workflows" / "creatio-build-thing.js").exists())
            self.assertFalse((claude_home / "workflows" / "build.js").exists())

    def test_refuses_a_meta_name_that_escapes_the_workflows_directory(self):
        # `pathlib` does not sanitise the right-hand side of `/`, and update.py re-runs this
        # provisioner over the marketplace cache unattended, so a traversing name would be an
        # arbitrary-file-write primitive running with the user's privileges.
        installer = load_installer()
        for meta_name in ("creatio-../../evil", "creatio-a/b", "..", "", "/tmp/evil", "evil"):
            with self.subTest(meta_name=meta_name), tempfile.TemporaryDirectory() as temp:
                source_root = Path(temp) / "src"
                write_bundled_workflow(source_root, "a-skill", "build", meta_name)
                claude_home = Path(temp) / "home" / ".claude"

                with self.assertRaises(RuntimeError):
                    installer.provision_named_workflows(source_root, claude_home)

                written = sorted(
                    path.relative_to(temp).as_posix()
                    for path in Path(temp).rglob("*.js")
                    if path.is_file()
                )
                self.assertEqual(
                    written,
                    ["src/plugins/creatio-migration/skills/a-skill/build.workflow.js"],
                    "nothing may be written outside the source tree for a rejected name",
                )

    def test_refuses_two_scripts_claiming_one_meta_name(self):
        # Named workflows share one flat user-scope directory, so the second copy would silently
        # replace the first while both were reported as provisioned.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            source_root = Path(temp) / "src"
            write_bundled_workflow(source_root, "skill-a", "one", "creatio-same")
            write_bundled_workflow(source_root, "skill-b", "two", "creatio-same")
            claude_home = Path(temp) / "home" / ".claude"

            with self.assertRaises(RuntimeError):
                installer.provision_named_workflows(source_root, claude_home)

    def test_reads_the_name_from_the_manifest_not_from_the_script_text(self):
        # PR #147 review — the identity comes from the generated manifest, so a line beginning
        # `name:` anywhere in the inlined prompt text or core modules cannot supply the destination
        # filename, and no JavaScript is parsed to find out. The script here declares one name in
        # its own `meta` and a decoy further down; only the manifest decides.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            source_root = Path(temp) / "src"
            skill_dir = bundled_skills_dir(source_root) / "a-skill"
            skill_dir.mkdir(parents=True)
            script = skill_dir / "build.workflow.js"
            script.write_text(
                "export const meta = {\n"
                "  // the host's own scope, with a `template ${literal}` and a /regex{/ in prose\n"
                "  name: 'creatio-ignored-by-the-consumer',\n"
                "}\n"
                "const agentSpec = {\n"
                "name: 'creatio-../../evil',\n"
                "}\n",
                encoding="utf-8",
            )
            add_workflow_manifest_entry(source_root, script, "creatio-real")
            claude_home = Path(temp) / "home" / ".claude"

            self.assertEqual(
                installer.provision_named_workflows(source_root, claude_home), ["creatio-real"]
            )
            self.assertTrue((claude_home / "workflows" / "creatio-real.js").exists())

    def test_a_tree_with_no_manifest_refuses_rather_than_falling_back_to_a_parser(self):
        # Fails CLOSED, with the remedy named. A fallback parser no test exercises would preserve
        # exactly the coupling the manifest replaced.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            source_root = Path(temp) / "src"
            skill_dir = bundled_skills_dir(source_root) / "a-skill"
            skill_dir.mkdir(parents=True)
            (skill_dir / "build.workflow.js").write_text(
                "export const meta = {\n  name: 'creatio-real',\n}\n", encoding="utf-8"
            )

            with self.assertRaisesRegex(RuntimeError, "carries no workflow manifest"):
                installer.provision_named_workflows(source_root, Path(temp) / ".claude")
            self.assertFalse((Path(temp) / ".claude" / "workflows").exists())

    def test_a_script_missing_from_the_manifest_refuses_and_names_it(self):
        # The drift gate in `scripts/build-workflows.mjs --check` is what stops this reaching a
        # release; the installer still refuses rather than guessing a name from the filename.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            source_root = Path(temp) / "src"
            write_bundled_workflow(source_root, "skill-a", "one", "creatio-one")
            unlisted = bundled_skills_dir(source_root) / "skill-b"
            unlisted.mkdir(parents=True)
            (unlisted / "two.workflow.js").write_text(
                "export const meta = {\n  name: 'creatio-two',\n}\n", encoding="utf-8"
            )

            with self.assertRaisesRegex(RuntimeError, "skills/skill-b/two.workflow.js"):
                installer.provision_named_workflows(source_root, Path(temp) / ".claude")

    def test_an_unreadable_manifest_refuses_rather_than_provisioning_part_of_the_tree(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            source_root = Path(temp) / "src"
            write_bundled_workflow(source_root, "skill-a", "one", "creatio-one")
            (source_root / installer.WORKFLOW_MANIFEST_RELATIVE).write_text(
                "{ not json", encoding="utf-8"
            )

            with self.assertRaisesRegex(RuntimeError, "could not be read as JSON"):
                installer.provision_named_workflows(source_root, Path(temp) / ".claude")

    def test_a_manifest_without_a_workflows_list_refuses(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            source_root = Path(temp) / "src"
            write_bundled_workflow(source_root, "skill-a", "one", "creatio-one")
            (source_root / installer.WORKFLOW_MANIFEST_RELATIVE).write_text(
                '{"generatedBy": "x"}\n', encoding="utf-8"
            )

            with self.assertRaisesRegex(RuntimeError, "no `workflows` list"):
                installer.provision_named_workflows(source_root, Path(temp) / ".claude")

    def test_a_manifest_entry_missing_name_or_script_refuses(self):
        installer = load_installer()
        for entry in ({"name": "creatio-one"}, {"script": "skills/a/b.workflow.js"}, "not-an-object"):
            with self.subTest(entry=entry), tempfile.TemporaryDirectory() as temp:
                source_root = Path(temp) / "src"
                write_bundled_workflow(source_root, "skill-a", "one", "creatio-one")
                (source_root / installer.WORKFLOW_MANIFEST_RELATIVE).write_text(
                    json.dumps({"workflows": [entry]}) + "\n", encoding="utf-8"
                )

                with self.assertRaises(RuntimeError):
                    installer.provision_named_workflows(source_root, Path(temp) / ".claude")

    def test_provisions_every_bundled_workflow(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            source_root = Path(temp) / "src"
            write_bundled_workflow(source_root, "skill-a", "one", "creatio-one")
            write_bundled_workflow(source_root, "skill-b", "two", "creatio-two")
            claude_home = Path(temp) / "home" / ".claude"

            self.assertEqual(
                installer.provision_named_workflows(source_root, claude_home),
                ["creatio-one", "creatio-two"],
            )

    def test_overwrites_a_stale_mirror(self):
        # The plugin auto-updates, so the mirror must be rewritten rather than
        # left in place — a stale copy runs an older args contract.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            source_root = Path(temp) / "src"
            write_bundled_workflow(source_root, "skill-a", "one", "creatio-one", body="// v2\n")
            claude_home = Path(temp) / "home" / ".claude"
            workflows_dir = claude_home / "workflows"
            workflows_dir.mkdir(parents=True)
            (workflows_dir / "creatio-one.js").write_text("// v1 stale\n", encoding="utf-8")

            installer.provision_named_workflows(source_root, claude_home)

            self.assertIn(
                "// v2", (workflows_dir / "creatio-one.js").read_text(encoding="utf-8")
            )

    def test_source_without_workflows_provisions_nothing(self):
        # Not every checkout or release the installer runs against bundles one;
        # that is not an error and must not create an empty workflows dir owner.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            source_root = Path(temp) / "src"
            (bundled_skills_dir(source_root) / "plain-skill").mkdir(parents=True)
            claude_home = Path(temp) / "home" / ".claude"

            self.assertEqual(installer.provision_named_workflows(source_root, claude_home), [])
            self.assertFalse((claude_home / "workflows").exists())

    def test_missing_skills_dir_provisions_nothing(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            self.assertEqual(
                installer.provision_named_workflows(Path(temp) / "src", Path(temp) / ".claude"),
                [],
            )

    def test_a_script_the_generator_never_declared_is_a_hard_error(self):
        # Was "a script with no `meta.name`". The identity no longer lives in the script, so the
        # equivalent failure is a script the generator's `TARGETS` table never declared.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            source_root = Path(temp) / "src"
            skill_dir = bundled_skills_dir(source_root) / "skill-a"
            skill_dir.mkdir(parents=True)
            (skill_dir / "broken.workflow.js").write_text(
                "export const meta = { description: 'no name' }\n", encoding="utf-8"
            )
            add_workflow_manifest_entry(
                source_root, skill_dir / "other.workflow.js", "creatio-other"
            )
            with self.assertRaisesRegex(RuntimeError, "has no entry in"):
                installer.provision_named_workflows(source_root, Path(temp) / ".claude")


class ShippedWorkflowScriptTests(unittest.TestCase):
    """The repository's own workflow scripts must be provisionable."""

    def test_every_shipped_workflow_declares_a_namespaced_meta_name(self):
        installer = load_installer()
        scripts = installer.discover_workflow_scripts(ROOT)
        self.assertTrue(scripts, "the repository ships no *.workflow.js")
        declared = installer.workflow_manifest_names(ROOT)
        for script in scripts:
            with self.subTest(script=script.name):
                name = declared[script.relative_to(ROOT).as_posix()]
                # ~/.claude/workflows/ is shared across every project and
                # plugin, and project scope wins a name collision.
                self.assertTrue(
                    name.startswith("creatio-"),
                    f"{script.name} declares meta.name {name!r}, which is not namespaced",
                )

    def test_skills_call_their_workflow_by_script_path_first(self):
        """`scriptPath` is the PRIMARY documented call form; `name:` is the exception.

        A name resolves only from `~/.claude/workflows/`, and on Claude Code
        nothing provisions that mirror: the plugin declares no hook, so neither
        `install.py` nor `update.py` runs on a marketplace install/update. A real
        run therefore spent a guaranteed-failing `name:` call before falling back.
        The bundled script is always present and version-matched, so it goes
        first — and a stale mirror (the normal state after a plugin-branch switch)
        resolves the right name to the wrong script, which is worse than a
        resolution error. `name:` stays documented for the installer-based
        targets, but it must not lead.
        """
        installer = load_installer()
        declared = installer.workflow_manifest_names(ROOT)
        for script in installer.discover_workflow_scripts(ROOT):
            with self.subTest(script=script.name):
                name = declared[script.relative_to(ROOT).as_posix()]
                skill_doc = (script.parent / "SKILL.md").read_text(encoding="utf-8")
                self.assertIn("scriptPath", skill_doc)
                self.assertIn(f'name: "{name}"', skill_doc)
                self.assertLess(
                    skill_doc.index("scriptPath"),
                    skill_doc.index(f'name: "{name}"'),
                    f"{script.parent.name}/SKILL.md documents name: before scriptPath — "
                    "the named form does not resolve on a marketplace-installed Claude Code",
                )


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
            self.assertIn("essentials", rule_body)
            self.assertRegex(rule_body, r"(?i)mobile")
            self.assertIn("## Analytics Context", rule_body)
            self.assertIn("`coding_agent`: Cursor", rule_body)
            self.assertIn("`plugin_version`:", rule_body)
            self.assertIn("Follow `plugins/creatio-core/context/product-telemetry.md`", rule_body)

            local_plugin_manifest = local_plugin_dir / ".cursor-plugin" / "plugin.json"
            self.assertTrue(local_plugin_manifest.exists())

    def test_analytics_context_falls_back_to_unknown_without_manifest(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            # No plugin manifest -> plugin_version() raises RuntimeError, which
            # render_analytics_context must swallow and default to "unknown" so
            # the Cursor rule render never fails mid-install.
            block = installer.render_analytics_context(repo_root, "Cursor")
            self.assertIn("`coding_agent`: Cursor", block)
            self.assertIn("`plugin_version`: unknown", block)

    def test_analytics_context_renders_resolved_plugin_version(self):
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            # plugin_version() reads .github/plugin / .claude-plugin /
            # .codex-plugin; with a valid manifest the resolved version is
            # interpolated into the plugin_version field.
            (repo_root / ".github" / "plugin").mkdir(parents=True)
            (repo_root / ".github" / "plugin" / "plugin.json").write_text(
                '{"name":"creatio-ai-app-development-toolkit","version":"0.1.0"}\n',
                encoding="utf-8",
            )
            block = installer.render_analytics_context(repo_root, "Cursor")
            self.assertIn("`plugin_version`: 0.1.0", block)

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
    def test_merge_cursor_telemetry_hook_keeps_unrelated_entries(self):
        # The developer's own hooks live in this file. A reinstall that replaced it with our single
        # entry would silently delete their work.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            cursor_home = Path(temp) / ".cursor"
            cursor_home.mkdir()
            (cursor_home / "hooks.json").write_text(
                json.dumps({
                    "version": 1,
                    "hooks": {
                        "afterMCPExecution": [{"command": "node ./their-own-audit.js"}],
                        "beforeShellExecution": [{"command": "node ./their-guard.js"}],
                    },
                }),
                encoding="utf-8",
            )

            installer.merge_cursor_telemetry_hook(cursor_home, Path(temp) / "plugin")

            config = json.loads((cursor_home / "hooks.json").read_text(encoding="utf-8"))
            after = config["hooks"]["afterMCPExecution"]
            self.assertEqual(len(after), 2)
            self.assertIn("their-own-audit.js", after[0]["command"])
            self.assertIn("telemetry-routing.mjs", after[1]["command"])
            self.assertEqual(after[1]["env"]["CAADT_TELEMETRY_HOOK_HOST"], "cursor")
            # An unrelated hook family must be untouched.
            self.assertEqual(
                config["hooks"]["beforeShellExecution"], [{"command": "node ./their-guard.js"}]
            )

    def test_merge_cursor_telemetry_hook_is_idempotent(self):
        # Installing twice is ordinary. A second entry would make the hook run — and the floor
        # event fire — twice per tool call.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            cursor_home = Path(temp) / ".cursor"
            cursor_home.mkdir()
            plugin_dir = Path(temp) / "plugin"

            installer.merge_cursor_telemetry_hook(cursor_home, plugin_dir)
            installer.merge_cursor_telemetry_hook(cursor_home, plugin_dir)

            config = json.loads((cursor_home / "hooks.json").read_text(encoding="utf-8"))
            entries = [
                item for item in config["hooks"]["afterMCPExecution"]
                if "telemetry-routing.mjs" in item["command"]
            ]
            self.assertEqual(len(entries), 1)

    def test_merge_cursor_telemetry_hook_leaves_a_broken_file_untouched(self):
        # A hand-broken hooks.json is the developer's file. Rewriting it with our single entry
        # would destroy whatever they were in the middle of editing.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            cursor_home = Path(temp) / ".cursor"
            cursor_home.mkdir()
            broken = '{"hooks": {"afterMCPExecution": [  <-- half-edited'
            (cursor_home / "hooks.json").write_text(broken, encoding="utf-8")

            installer.merge_cursor_telemetry_hook(cursor_home, Path(temp) / "plugin")

            self.assertEqual((cursor_home / "hooks.json").read_text(encoding="utf-8"), broken)

    def test_merge_cursor_telemetry_hook_leaves_a_wrong_shaped_file_untouched(self):
        # Valid JSON of an unexpected SHAPE — a bare list, null, or a string — parses without error,
        # so it reaches the shape guard rather than the JSONDecodeError branch above. Without that
        # guard, `config.setdefault("hooks", {})` on a non-dict raises AttributeError mid-install,
        # after two rule files have already been written. Also covers `afterMCPExecution` ITSELF
        # being the wrong shape (null, a number, a string, a dict) rather than one of its entries:
        # iterating a non-list there raises TypeError (null/number) or silently iterates
        # characters/keys and replaces the value with a corrupted list (string/dict) — the same
        # half-finished-or-corrupted install the container-level shape check exists to prevent.
        installer = load_installer()
        broken_shapes = (
            '[]', 'null', '"just a string"', '{"hooks": "not-a-dict"}',
            '{"hooks": {"afterMCPExecution": null}}',
            '{"hooks": {"afterMCPExecution": 7}}',
            '{"hooks": {"afterMCPExecution": "not-a-list"}}',
            '{"hooks": {"afterMCPExecution": {"command": "not-a-list-either"}}}',
        )
        for broken_shape in broken_shapes:
            with tempfile.TemporaryDirectory() as temp:
                cursor_home = Path(temp) / ".cursor"
                cursor_home.mkdir()
                (cursor_home / "hooks.json").write_text(broken_shape, encoding="utf-8")

                installer.merge_cursor_telemetry_hook(cursor_home, Path(temp) / "plugin")

                self.assertEqual(
                    (cursor_home / "hooks.json").read_text(encoding="utf-8"), broken_shape,
                    f"shape {broken_shape!r} must be left untouched, not raise or be rewritten",
                )

    def test_merge_cursor_telemetry_hook_preserves_a_non_dict_entry_in_after_mcp_execution(self):
        # A stray non-dict entry (left by a developer or another tool) must not make `item.get(...)`
        # raise — the entries filter is written to tolerate it rather than assume every element is a
        # hook definition.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            cursor_home = Path(temp) / ".cursor"
            cursor_home.mkdir()
            (cursor_home / "hooks.json").write_text(
                json.dumps({"hooks": {"afterMCPExecution": ["not-a-hook-object"]}}),
                encoding="utf-8",
            )

            installer.merge_cursor_telemetry_hook(cursor_home, Path(temp) / "plugin")

            config = json.loads((cursor_home / "hooks.json").read_text(encoding="utf-8"))
            after = config["hooks"]["afterMCPExecution"]
            self.assertIn("not-a-hook-object", after)
            self.assertTrue(any("telemetry-routing.mjs" in str(item.get("command", ""))
                                 for item in after if isinstance(item, dict)))

    def test_merge_cursor_telemetry_hook_returns_quietly_when_the_write_fails(self):
        # A read-only or locked hooks.json must not abort a Cursor install that has already written
        # two rule files — the write is wrapped in the same "leave it alone" contract as a read
        # failure.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            cursor_home = Path(temp) / ".cursor"
            cursor_home.mkdir()

            real_write_text = Path.write_text

            def raising_write_text(self, *args, **kwargs):
                if self.name == "hooks.json":
                    raise OSError("simulated read-only filesystem")
                return real_write_text(self, *args, **kwargs)

            with patch.object(Path, "write_text", raising_write_text):
                installer.merge_cursor_telemetry_hook(cursor_home, Path(temp) / "plugin")
            # No exception propagated — that is the entire contract being tested.

    def test_render_cursor_telemetry_rule_delegates_the_vocabulary(self):
        # Cursor has no hook that can reach the agent, so this always-applied rule is its only
        # routing channel — and it must point at the guidance article rather than copy the stages,
        # which would outlive the release that changed them.
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            rule = installer.render_cursor_telemetry_rule(Path(temp))

        self.assertIn("get-guidance name=product-telemetry", rule)
        self.assertIn("alwaysApply: true", rule)
        residue = rule.replace("migration_plan_approved", "")
        for stage in ("workflow_started", "plan_approved", "work_item_completed"):
            self.assertNotIn(stage, residue)

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
        mock_cursor = unittest.mock.MagicMock()
        with patch.dict(installer._INSTALLERS, {
            "copilot": unittest.mock.MagicMock(side_effect=RuntimeError("copilot was not found in PATH.")),
            "cursor": mock_cursor,
        }):
            installed, failed = installer.install_for_targets(Path("/repo"), targets)

        self.assertEqual(installed, ["cursor"])
        self.assertEqual(failed, [("copilot", "copilot was not found in PATH.")])
        mock_cursor.assert_called_once()

    def test_install_for_targets_reraises_when_explicit_target_fails(self):
        """`--target copilot` is an explicit request, so a failure must propagate."""
        installer = load_installer()
        targets = [{"id": "copilot", "name": "GitHub Copilot CLI", "home": Path("/home/.copilot")}]
        with patch.dict(installer._INSTALLERS, {
            "copilot": unittest.mock.MagicMock(side_effect=RuntimeError("copilot was not found in PATH.")),
        }):
            with self.assertRaisesRegex(RuntimeError, "copilot was not found in PATH"):
                installer.install_for_targets(Path("/repo"), targets, selected="copilot")

    def test_install_for_targets_skips_failing_autodetected_target_on_oserror(self):
        """A file-copy failure (locked/read-only file -> OSError) must also be isolated."""
        installer = load_installer()
        targets = [
            {"id": "cursor", "name": "Cursor", "home": Path("/home/.cursor")},
            {"id": "codex", "name": "Codex", "home": Path("/home/.codex")},
        ]
        mock_codex = unittest.mock.MagicMock()
        with patch.dict(installer._INSTALLERS, {
            "cursor": unittest.mock.MagicMock(side_effect=PermissionError("file is locked")),
            "codex": mock_codex,
        }):
            installed, failed = installer.install_for_targets(Path("/repo"), targets)

        self.assertEqual(installed, ["codex"])
        self.assertEqual(failed, [("cursor", "file is locked")])
        mock_codex.assert_called_once()

    def test_install_for_targets_raises_when_explicit_target_not_detected(self):
        """`--target copilot` when copilot was filtered out by detection must fail hard, not no-op."""
        installer = load_installer()
        # detect_targets dropped copilot (no binary on PATH); only cursor remains.
        targets = [{"id": "cursor", "name": "Cursor", "home": Path("/home/.cursor")}]
        with patch.dict(installer._INSTALLERS, {"cursor": unittest.mock.MagicMock()}):
            with self.assertRaisesRegex(RuntimeError, "requested target 'copilot' is not available"):
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

    def test_returns_error_when_explicit_target_not_detected(self):
        """`--target copilot` when copilot is not detected must exit non-zero, not a silent 0."""
        installer = load_installer()
        with tempfile.TemporaryDirectory() as temp:
            repo_root = Path(temp) / "repo"
            repo_root.mkdir()
            with (
                patch.object(installer, "preflight_clio"),
                patch.object(installer, "resolve_repo_root", return_value=repo_root),
                # copilot dropped by detection (no binary); cursor is present.
                patch.object(
                    installer,
                    "detect_targets",
                    return_value=[{"id": "cursor", "name": "Cursor", "home": Path("/home/.cursor")}],
                ),
            ):
                result = installer.main(["--target", "copilot"])

        self.assertEqual(result, 1)


if __name__ == "__main__":
    unittest.main()

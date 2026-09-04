"""Tests for installer/update.py — the self-fetching, delegate-to-install.py
manual update command.
"""
from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
UPDATE_PATH = ROOT / "installer" / "update.py"


def load_update():
    spec = importlib.util.spec_from_file_location("caadt_update", UPDATE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _make_release_zip(path: Path, version: str) -> None:
    base = f"creatio-ai-app-development-toolkit-{version}"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(f"{base}/installer/install.py", "# fake install\n")
        archive.writestr(
            f"{base}/.github/plugin/plugin.json", json.dumps({"version": version})
        )


# ---------------------------------------------------------------------------
# update.py — detection
# ---------------------------------------------------------------------------


class DetectTargetsTests(unittest.TestCase):
    def setUp(self):
        self.upd = load_update()
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_detects_present_agents(self):
        (self.home / ".codex").mkdir()
        (self.home / ".copilot").mkdir()
        ids = self.upd.detect_installed_target_ids(self.home)
        self.assertEqual(ids, ["codex", "copilot"])

    def test_claude_is_updateable(self):
        (self.home / ".claude").mkdir()
        self.assertEqual(self.upd.detect_installed_target_ids(self.home), ["claude"])

    def test_none_present(self):
        self.assertEqual(self.upd.detect_installed_target_ids(self.home), [])


# ---------------------------------------------------------------------------
# update.py — source acquisition
# ---------------------------------------------------------------------------


class AcquireSourceTests(unittest.TestCase):
    def setUp(self):
        self.upd = load_update()
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    def test_source_directory_used_directly(self):
        src = self.tmp / "checkout"
        (src / "installer").mkdir(parents=True)
        (src / "installer" / "install.py").write_text("# x\n", encoding="utf-8")
        (src / ".github" / "plugin").mkdir(parents=True)
        (src / ".github" / "plugin" / "plugin.json").write_text(
            json.dumps({"version": "9.9.9"}), encoding="utf-8"
        )
        work = self.tmp / "work"
        work.mkdir()
        root, version = self.upd.acquire_source(work, source=src)
        self.assertEqual(root, src)
        self.assertEqual(version, "9.9.9")

    def test_source_missing_installer_raises(self):
        src = self.tmp / "empty"
        src.mkdir()
        work = self.tmp / "work"
        work.mkdir()
        with self.assertRaises(RuntimeError):
            self.upd.acquire_source(work, source=src)

    def test_download_extracts_and_locates_root(self):
        work = self.tmp / "work"
        work.mkdir()

        def fake_download(dest):
            _make_release_zip(dest, "0.2.0")
            return "0.2.0"

        with patch.object(
            self.upd.version_check, "download_latest_release_zip", side_effect=fake_download
        ):
            root, version = self.upd.acquire_source(work)

        self.assertEqual(version, "0.2.0")
        self.assertTrue((root / "installer" / "install.py").exists())

    def test_download_failure_raises(self):
        work = self.tmp / "work"
        work.mkdir()
        with patch.object(
            self.upd.version_check, "download_latest_release_zip", return_value=None
        ):
            with self.assertRaises(RuntimeError):
                self.upd.acquire_source(work)

    def test_zip_slip_member_rejected(self):
        work = self.tmp / "work"
        work.mkdir()

        def fake_download(dest):
            with zipfile.ZipFile(dest, "w") as archive:
                # Path-traversal member that would escape the extraction root.
                archive.writestr("../evil.txt", "pwned")
            return "0.2.0"

        with patch.object(
            self.upd.version_check, "download_latest_release_zip", side_effect=fake_download
        ):
            with self.assertRaises(RuntimeError):
                self.upd.acquire_source(work)
        # Nothing escaped the work dir.
        self.assertFalse((self.tmp / "evil.txt").exists())


# ---------------------------------------------------------------------------
# update.py — native update command sequences
# ---------------------------------------------------------------------------


class NativeUpdateCommandsTests(unittest.TestCase):
    def setUp(self):
        self.upd = load_update()

    def _patch_resolvers(self):
        return (
            patch.object(self.upd.agent_cli, "resolve_claude_command", return_value=["claude"]),
            patch.object(self.upd.agent_cli, "resolve_codex_command", return_value=["codex"]),
            patch.object(self.upd.agent_cli, "resolve_copilot_command", return_value=["copilot"]),
        )

    def test_two_step_sequences_per_agent(self):
        r1, r2, r3 = self._patch_resolvers()
        with r1, r2, r3:
            self.assertEqual(
                self.upd.native_update_commands("claude"),
                [
                    ["claude", "plugin", "marketplace", "update", "creatio"],
                    ["claude", "plugin", "update", "creatio-ai-app-development-toolkit@creatio"],
                ],
            )
            # Codex has no `plugin update`: refresh the snapshot, then re-add.
            self.assertEqual(
                self.upd.native_update_commands("codex"),
                [
                    ["codex", "plugin", "marketplace", "upgrade", "creatio"],
                    ["codex", "plugin", "add", "creatio-ai-app-development-toolkit@creatio"],
                ],
            )
            self.assertEqual(
                self.upd.native_update_commands("copilot"),
                [
                    ["copilot", "plugin", "marketplace", "update", "creatio"],
                    ["copilot", "plugin", "update", "creatio-ai-app-development-toolkit@creatio"],
                ],
            )

    def test_unknown_or_copy_target_raises(self):
        with self.assertRaises(ValueError):
            self.upd.native_update_commands("cursor")


# ---------------------------------------------------------------------------
# update.py — update orchestration
# ---------------------------------------------------------------------------


class UpdateAgentsTests(unittest.TestCase):
    def setUp(self):
        self.upd = load_update()
        self._tmp = tempfile.TemporaryDirectory()
        self.fresh_root = Path(self._tmp.name)
        (self.fresh_root / "installer").mkdir()
        (self.fresh_root / "installer" / "install.py").write_text("# x\n", encoding="utf-8")
        # A Claude update re-mirrors the named workflows into <home>/.claude;
        # every claude case passes this so the run cannot touch the real home.
        self.home = self.fresh_root / "home"
        (self.home / ".claude").mkdir(parents=True)

    def tearDown(self):
        self._tmp.cleanup()

    def _ok(self, *a, **k):
        return subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr="")

    def _patch_resolvers(self):
        return (
            patch.object(self.upd.agent_cli, "resolve_claude_command", return_value=["claude"]),
            patch.object(self.upd.agent_cli, "resolve_codex_command", return_value=["codex"]),
            patch.object(self.upd.agent_cli, "resolve_copilot_command", return_value=["copilot"]),
        )

    def test_native_agent_runs_both_steps_in_order(self):
        calls = []

        def record(cmd, **kw):
            calls.append(cmd)
            return self._ok()

        r1, r2, r3 = self._patch_resolvers()
        with r1, r2, r3, patch.object(self.upd.subprocess, "run", side_effect=record):
            updated, failed = self.upd.update_agents(["claude"], silent=True, home=self.home)

        self.assertEqual((updated, failed), (["claude"], []))
        self.assertEqual(
            calls,
            [
                ["claude", "plugin", "marketplace", "update", "creatio"],
                ["claude", "plugin", "update", "creatio-ai-app-development-toolkit@creatio"],
            ],
        )

    def test_cursor_delegates_to_install_py_without_update_flag(self):
        calls = []

        def record(cmd, **kw):
            calls.append(cmd)
            return self._ok()

        with patch.object(self.upd.subprocess, "run", side_effect=record):
            updated, failed = self.upd.update_agents(
                ["cursor"], fresh_root=self.fresh_root, silent=True
            )

        self.assertEqual((updated, failed), (["cursor"], []))
        self.assertEqual(len(calls), 1)
        install_script = str(self.fresh_root / "installer" / "install.py")
        self.assertEqual(calls[0][1], install_script)
        self.assertEqual(calls[0][2], "--target")
        self.assertEqual(calls[0][3], "cursor")
        # Cursor's update IS a reinstall — no --update flag (install.py has none).
        self.assertNotIn("--update", calls[0])

    def test_cursor_without_source_is_failure(self):
        with patch.object(self.upd.subprocess, "run", side_effect=self._ok) as run:
            updated, failed = self.upd.update_agents(["cursor"], fresh_root=None, silent=True)
        self.assertEqual((updated, failed), ([], ["cursor"]))
        run.assert_not_called()

    def test_updates_exactly_the_targets_handed(self):
        # update_agents no longer filters: the caller scopes the list. Passing a
        # single id must update only that id (one agent × two native steps).
        r1, r2, r3 = self._patch_resolvers()
        with r1, r2, r3, patch.object(self.upd.subprocess, "run", side_effect=self._ok) as run:
            updated, _ = self.upd.update_agents(["copilot"], silent=True)
        self.assertEqual(updated, ["copilot"])
        self.assertEqual(run.call_count, 2)  # one agent × two steps

    def test_failed_step_recorded_and_other_agents_continue(self):
        def side(cmd, **kw):
            if cmd[0] == "codex" and "add" in cmd:
                return subprocess.CompletedProcess(args=[], returncode=1, stdout="", stderr="boom")
            return self._ok()

        r1, r2, r3 = self._patch_resolvers()
        with r1, r2, r3, patch.object(self.upd.subprocess, "run", side_effect=side):
            updated, failed = self.upd.update_agents(["codex", "copilot"], silent=True)
        self.assertEqual(updated, ["copilot"])
        self.assertEqual(failed, ["codex"])

    def test_step_passes_timeout_and_blocks_stdin(self):
        seen: dict = {}

        def record(cmd, **kw):
            seen.update(kw)
            return self._ok()

        r1, r2, r3 = self._patch_resolvers()
        with r1, r2, r3, patch.object(self.upd.subprocess, "run", side_effect=record):
            self.upd.update_agents(["codex"], silent=True)

        self.assertEqual(seen.get("timeout"), self.upd._STEP_TIMEOUT_SECONDS)
        self.assertEqual(seen.get("stdin"), subprocess.DEVNULL)

    def test_timeout_recorded_as_failure(self):
        def side(cmd, **kw):
            raise subprocess.TimeoutExpired(cmd=cmd, timeout=kw.get("timeout"))

        r1, r2, r3 = self._patch_resolvers()
        with r1, r2, r3, patch.object(self.upd.subprocess, "run", side_effect=side):
            updated, failed = self.upd.update_agents(["codex"], silent=True)
        self.assertEqual((updated, failed), ([], ["codex"]))

    def test_resolver_failure_recorded(self):
        # CLI not on PATH → resolve raises RuntimeError → that agent fails.
        with patch.object(
            self.upd.agent_cli, "resolve_claude_command", side_effect=RuntimeError("not in PATH")
        ):
            updated, failed = self.upd.update_agents(["claude"], silent=True, home=self.home)
        self.assertEqual((updated, failed), ([], ["claude"]))


class NamedWorkflowRefreshTests(unittest.TestCase):
    """`claude plugin update` never touches user scope, so the mirror in
    ~/.claude/workflows/ has to be rewritten from the updated plugin cache."""

    def setUp(self):
        self.upd = load_update()
        self._tmp = tempfile.TemporaryDirectory()
        self.home = Path(self._tmp.name)
        (self.home / ".claude").mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def _write_cached_plugin(self, version, meta_name, body=""):
        root = (
            self.home
            / ".claude"
            / "plugins"
            / "cache"
            / self.upd.agent_cli.MARKETPLACE_NAME
            / self.upd.agent_cli.PLUGIN_NAME
            / version
        )
        skill_dir = root / "skills" / "some-skill"
        skill_dir.mkdir(parents=True)
        (skill_dir / "some.workflow.js").write_text(
            f"export const meta = {{\n  name: '{meta_name}',\n}}\n{body}",
            encoding="utf-8",
        )
        # The identity the provisioner reads comes from the GENERATED manifest, not from the
        # script text (PR #147 review) - a cached tree without it is a separate, tested failure.
        manifest = root / "skills" / "_workflow-core" / "workflows.json"
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_text(
            json.dumps({
                "workflows": [{
                    "name": meta_name,
                    "script": "skills/some-skill/some.workflow.js",
                    "phases": ["Describe"],
                }]
            }, indent=2) + "\n",
            encoding="utf-8",
        )
        return root

    def test_picks_the_highest_cached_version_not_the_lexical_one(self):
        # Versions coexist in the cache; 10.0.0 must beat 9.0.0 despite sorting
        # lower as a string.
        self._write_cached_plugin("9.0.0", "creatio-x", body="// old\n")
        self._write_cached_plugin("10.0.0", "creatio-x", body="// new\n")

        self.assertEqual(self.upd.refresh_claude_named_workflows(self.home), ["creatio-x"])
        mirrored = self.home / ".claude" / "workflows" / "creatio-x.js"
        self.assertIn("// new", mirrored.read_text(encoding="utf-8"))

    def test_no_cached_plugin_leaves_the_previous_mirror_alone(self):
        workflows_dir = self.home / ".claude" / "workflows"
        workflows_dir.mkdir()
        (workflows_dir / "creatio-x.js").write_text("// kept\n", encoding="utf-8")

        self.assertEqual(self.upd.refresh_claude_named_workflows(self.home), [])
        self.assertEqual((workflows_dir / "creatio-x.js").read_text(encoding="utf-8"), "// kept\n")

    def test_a_broken_cached_script_never_fails_the_update(self):
        root = self._write_cached_plugin("1.0.0", "creatio-x")
        # A cached tree whose manifest does not declare the script it ships: the provisioner has no
        # name for it and refuses, which is the shape a partial or hand-edited cache produces now
        # that the identity is published rather than parsed out of the script.
        (root / "skills" / "_workflow-core" / "workflows.json").write_text(
            json.dumps({"workflows": []}) + "\n", encoding="utf-8"
        )
        # A RuntimeError from the provisioner never fails the update - the plugin update itself
        # succeeded and the scriptPath fallback still resolves in-tree - but it is the ONE signal an
        # unattended run gives an operator that the hardened provisioner refused a script, so the
        # warning is pinned here rather than left deletable with a green suite.
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            self.assertEqual(self.upd.refresh_claude_named_workflows(self.home), [])
        self.assertIn("WARNING: named workflows were not provisioned", stderr.getvalue())
        self.assertIn("skills/some-skill/some.workflow.js", stderr.getvalue())
        self.assertIn("workflows.json", stderr.getvalue())

    def test_a_runtime_without_a_provisioner_stays_silent(self):
        """The ImportError arm is deliberately quiet: a surface that ships no `installer/` is the
        documented, expected case, not a failure, and warning there would cry wolf on every update."""
        self._write_cached_plugin("1.0.0", "creatio-x")
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr), patch.dict(
            self.upd.sys.modules, {"install": None}
        ):
            self.assertEqual(self.upd.refresh_claude_named_workflows(self.home), [])
        self.assertEqual(stderr.getvalue(), "")

    def test_claude_update_refreshes_the_mirror(self):
        self._write_cached_plugin("1.0.0", "creatio-x")

        def ok(cmd, **kw):
            return subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr="")

        with patch.object(
            self.upd.agent_cli, "resolve_claude_command", return_value=["claude"]
        ), patch.object(self.upd.subprocess, "run", side_effect=ok):
            updated, failed = self.upd.update_agents(["claude"], silent=True, home=self.home)

        self.assertEqual((updated, failed), (["claude"], []))
        self.assertTrue((self.home / ".claude" / "workflows" / "creatio-x.js").exists())

    def test_a_non_claude_update_does_not_touch_user_scope(self):
        self._write_cached_plugin("1.0.0", "creatio-x")

        def ok(cmd, **kw):
            return subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr="")

        with patch.object(
            self.upd.agent_cli, "resolve_codex_command", return_value=["codex"]
        ), patch.object(self.upd.subprocess, "run", side_effect=ok):
            self.upd.update_agents(["codex"], silent=True, home=self.home)

        self.assertFalse((self.home / ".claude" / "workflows").exists())


# ---------------------------------------------------------------------------
# update.py — main orchestration
# ---------------------------------------------------------------------------


class UpdateMainTests(unittest.TestCase):
    def setUp(self):
        self.upd = load_update()

    def test_no_targets_skips_download(self):
        download = MagicMock()
        with (
            patch.object(self.upd, "detect_installed_target_ids", return_value=[]),
            patch.object(self.upd, "acquire_source", download),
            patch("builtins.print"),
        ):
            result = self.upd.main([])
        download.assert_not_called()
        self.assertEqual(result, 0)

    def test_target_not_installed_skips(self):
        with (
            patch.object(self.upd, "detect_installed_target_ids", return_value=["codex"]),
            patch.object(self.upd, "acquire_source") as acquire,
            patch("builtins.print"),
        ):
            result = self.upd.main(["--target", "cursor"])
        acquire.assert_not_called()
        self.assertEqual(result, 0)

    def test_native_only_skips_download(self):
        # No Cursor → no release source needed; report version via the light API.
        with (
            patch.object(self.upd, "detect_installed_target_ids", return_value=["codex", "claude", "copilot"]),
            patch.object(self.upd, "acquire_source") as acquire,
            patch.object(self.upd.version_check, "latest_release_version", return_value="0.2.0"),
            patch.object(self.upd, "update_agents", return_value=(["codex", "claude", "copilot"], [])),
            patch.object(self.upd.os, "chdir") as chdir,
            patch("builtins.print") as mock_print,
        ):
            result = self.upd.main([])

        self.assertEqual(result, 0)
        acquire.assert_not_called()
        chdir.assert_called_once()
        printed = " ".join(str(c.args[0]) for c in mock_print.call_args_list)
        # Reports the version updated *to*; no misleading "from" version.
        self.assertIn("to v0.2.0", printed)
        self.assertNotIn("->", printed)

    def test_cursor_triggers_download_and_passes_fresh_root(self):
        captured: dict = {}

        def fake_update_agents(target_ids, *, fresh_root=None, silent=False):
            captured["fresh_root"] = fresh_root
            return (list(target_ids), [])

        with (
            patch.object(self.upd, "detect_installed_target_ids", return_value=["cursor"]),
            patch.object(self.upd, "acquire_source", return_value=(Path("/fresh"), "0.2.0")) as acquire,
            patch.object(self.upd, "update_agents", side_effect=fake_update_agents),
            patch.object(self.upd.os, "chdir"),
            patch("builtins.print"),
        ):
            result = self.upd.main([])

        self.assertEqual(result, 0)
        acquire.assert_called_once()
        self.assertEqual(captured["fresh_root"], Path("/fresh"))

    def test_cursor_and_native_both_succeed_in_one_pass(self):
        # Positive mixed case: Cursor + a native agent installed, both succeed in
        # a single run — release source acquired once, native two-step runs, then
        # install.py reinstalls Cursor. update_agents is NOT mocked here, so the
        # real per-agent dispatch is exercised end to end.
        fresh_root = Path("/fresh")
        calls = []

        def record(cmd, **kw):
            calls.append(cmd)
            return subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr="")

        with (
            patch.object(self.upd, "detect_installed_target_ids", return_value=["claude", "cursor"]),
            patch.object(self.upd, "acquire_source", return_value=(fresh_root, "0.2.0")) as acquire,
            patch.object(self.upd.agent_cli, "resolve_claude_command", return_value=["claude"]),
            patch.object(self.upd.subprocess, "run", side_effect=record),
            patch.object(self.upd.os, "chdir"),
            # main() does not inject a home (production writes to the real one),
            # and update_agents is deliberately NOT mocked here — so stub the
            # refresh instead of letting the test touch ~/.claude/workflows.
            patch.object(self.upd, "refresh_claude_named_workflows", return_value=[]) as refresh,
            patch("builtins.print") as mock_print,
        ):
            result = self.upd.main([])

        self.assertEqual(result, 0)
        acquire.assert_called_once()
        # The named-workflow mirror is refreshed as part of the Claude update.
        refresh.assert_called_once()
        # Claude two-step + Cursor install.py reinstall = 3 subprocess calls.
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls[0], ["claude", "plugin", "marketplace", "update", "creatio"])
        self.assertEqual(
            calls[1],
            ["claude", "plugin", "update", "creatio-ai-app-development-toolkit@creatio"],
        )
        install_script = str(fresh_root / "installer" / "install.py")
        self.assertEqual(calls[2][1:], [install_script, "--target", "cursor"])
        printed = " ".join(str(c.args[0]) for c in mock_print.call_args_list)
        self.assertIn("Updated 2 agent(s) to v0.2.0", printed)
        self.assertIn("claude", printed)
        self.assertIn("cursor", printed)

    def test_cursor_source_failure_does_not_abort_native_agents(self):
        # Download fails, but native agents must still be attempted; main does
        # not early-return. update_agents (here mocked) receives fresh_root=None.
        captured: dict = {}

        def fake_update_agents(target_ids, *, fresh_root=None, silent=False):
            captured["fresh_root"] = fresh_root
            return (["codex"], ["cursor"])

        with (
            patch.object(self.upd, "detect_installed_target_ids", return_value=["codex", "cursor"]),
            patch.object(self.upd, "acquire_source", side_effect=RuntimeError("no net")),
            patch.object(self.upd.version_check, "latest_release_version", return_value="0.2.0"),
            patch.object(self.upd, "update_agents", side_effect=fake_update_agents),
            patch.object(self.upd.os, "chdir"),
            patch("builtins.print"),
        ):
            result = self.upd.main([])

        self.assertIsNone(captured["fresh_root"])
        self.assertEqual(result, 1)  # cursor failed

    def test_failed_target_returns_one(self):
        with (
            patch.object(self.upd, "detect_installed_target_ids", return_value=["codex"]),
            patch.object(self.upd.version_check, "latest_release_version", return_value="0.2.0"),
            patch.object(self.upd, "update_agents", return_value=([], ["codex"])),
            patch.object(self.upd.os, "chdir"),
            patch("builtins.print"),
        ):
            result = self.upd.main([])
        self.assertEqual(result, 1)

    def test_failure_prints_running_agent_hint(self):
        # A failure must surface the running-agent remediation hint: the raw CLI
        # error (e.g. a locked plugin file) rarely names the real cause.
        with (
            patch.object(self.upd, "detect_installed_target_ids", return_value=["codex"]),
            patch.object(self.upd.version_check, "latest_release_version", return_value="0.2.0"),
            patch.object(self.upd, "update_agents", return_value=([], ["codex"])),
            patch.object(self.upd.os, "chdir"),
            patch("builtins.print") as mock_print,
        ):
            self.upd.main([])
        printed = " ".join(str(c.args[0]) for c in mock_print.call_args_list)
        self.assertIn("A running agent can lock its plugin files", printed)

    def test_full_success_omits_running_agent_hint(self):
        # No failures → no remediation noise.
        with (
            patch.object(self.upd, "detect_installed_target_ids", return_value=["codex"]),
            patch.object(self.upd.version_check, "latest_release_version", return_value="0.2.0"),
            patch.object(self.upd, "update_agents", return_value=(["codex"], [])),
            patch.object(self.upd.os, "chdir"),
            patch("builtins.print") as mock_print,
        ):
            self.upd.main([])
        printed = " ".join(str(c.args[0]) for c in mock_print.call_args_list)
        self.assertNotIn("A running agent can lock", printed)

    def test_silent_failure_omits_running_agent_hint(self):
        # Silent mode is machine-readable for the setup wizard — no extra prose.
        with (
            patch.object(self.upd, "detect_installed_target_ids", return_value=["codex"]),
            patch.object(self.upd.version_check, "latest_release_version", return_value="0.2.0"),
            patch.object(self.upd, "update_agents", return_value=([], ["codex"])),
            patch.object(self.upd.os, "chdir"),
            patch("builtins.print") as mock_print,
        ):
            self.upd.main(["--silent"])
        printed = " ".join(str(c.args[0]) for c in mock_print.call_args_list)
        self.assertNotIn("A running agent can lock", printed)

    def test_silent_mode_skips_version_lookup(self):
        # `version` is only used for the display line, so --silent must not pay
        # for the latest_release_version() network round-trip.
        with (
            patch.object(self.upd, "detect_installed_target_ids", return_value=["codex"]),
            patch.object(self.upd.version_check, "latest_release_version") as latest,
            patch.object(self.upd, "update_agents", return_value=(["codex"], [])),
            patch.object(self.upd.os, "chdir"),
            patch("builtins.print"),
        ):
            result = self.upd.main(["--silent"])
        self.assertEqual(result, 0)
        latest.assert_not_called()

    def test_version_lookup_skipped_when_nothing_updated(self):
        # Only failures → no "Updated …" line → no need to resolve the version.
        with (
            patch.object(self.upd, "detect_installed_target_ids", return_value=["codex"]),
            patch.object(self.upd.version_check, "latest_release_version") as latest,
            patch.object(self.upd, "update_agents", return_value=([], ["codex"])),
            patch.object(self.upd.os, "chdir"),
            patch("builtins.print"),
        ):
            self.upd.main([])
        latest.assert_not_called()

    def test_target_flag_scopes_to_selected_agent(self):
        # main() is the single place --target scoping happens: only the selected
        # installed agent is updated even when others are present.
        calls = []

        def record(cmd, **kw):
            calls.append(cmd)
            return subprocess.CompletedProcess(args=[], returncode=0, stdout="", stderr="")

        with (
            patch.object(self.upd, "detect_installed_target_ids", return_value=["codex", "copilot"]),
            patch.object(self.upd.version_check, "latest_release_version", return_value="0.2.0"),
            patch.object(self.upd.agent_cli, "resolve_copilot_command", return_value=["copilot"]),
            patch.object(self.upd.subprocess, "run", side_effect=record),
            patch.object(self.upd.os, "chdir"),
            patch("builtins.print") as mock_print,
        ):
            result = self.upd.main(["--target", "copilot"])

        self.assertEqual(result, 0)
        # Only copilot's two native steps run; codex is untouched.
        self.assertEqual([c[0] for c in calls], ["copilot", "copilot"])
        printed = " ".join(str(c.args[0]) for c in mock_print.call_args_list)
        self.assertIn("Updated 1 agent(s)", printed)
        self.assertNotIn("codex", printed)

    def test_source_with_native_in_scope_warns(self):
        # --source only scopes Cursor; warn (don't silently ignore) when a native
        # agent is also in scope.
        with (
            patch.object(self.upd, "detect_installed_target_ids", return_value=["claude", "cursor"]),
            patch.object(self.upd, "acquire_source", return_value=(Path("/fresh"), "9.9.9")),
            patch.object(self.upd, "update_agents", return_value=(["claude", "cursor"], [])),
            patch.object(self.upd.os, "chdir"),
            patch("builtins.print") as mock_print,
        ):
            self.upd.main(["--source", "/somewhere"])
        printed = " ".join(str(c.args[0]) for c in mock_print.call_args_list)
        self.assertIn("WARNING: --source only applies to Cursor", printed)
        self.assertIn("claude", printed)

    def test_source_pinned_version_suffix_dropped_for_natives(self):
        # --source pins `version` to the source archive, but natives track their
        # marketplace to latest — so the "to vX" suffix must be dropped when a
        # native is among the updated agents.
        with (
            patch.object(self.upd, "detect_installed_target_ids", return_value=["claude", "cursor"]),
            patch.object(self.upd, "acquire_source", return_value=(Path("/fresh"), "9.9.9")),
            patch.object(self.upd, "update_agents", return_value=(["claude", "cursor"], [])),
            patch.object(self.upd.os, "chdir"),
            patch("builtins.print") as mock_print,
        ):
            self.upd.main(["--source", "/somewhere"])
        printed = " ".join(str(c.args[0]) for c in mock_print.call_args_list)
        self.assertIn("Updated 2 agent(s):", printed)  # no " to vX" suffix
        self.assertNotIn("to v9.9.9", printed)

    def test_source_cursor_only_keeps_version_suffix(self):
        # Cursor alone with --source: the source version is exactly what Cursor
        # got, so the suffix is accurate and must be shown.
        with (
            patch.object(self.upd, "detect_installed_target_ids", return_value=["cursor"]),
            patch.object(self.upd, "acquire_source", return_value=(Path("/fresh"), "9.9.9")),
            patch.object(self.upd, "update_agents", return_value=(["cursor"], [])),
            patch.object(self.upd.os, "chdir"),
            patch("builtins.print") as mock_print,
        ):
            self.upd.main(["--source", "/somewhere"])
        printed = " ".join(str(c.args[0]) for c in mock_print.call_args_list)
        self.assertIn("to v9.9.9", printed)

    def test_source_with_native_only_keeps_accurate_version_suffix(self):
        # --source but no Cursor: download is skipped, so nothing is source-pinned
        # (fresh_root stays None) and `version` is the marketplace-latest the
        # natives actually got — the suffix is accurate and must be shown.
        with (
            patch.object(self.upd, "detect_installed_target_ids", return_value=["claude"]),
            patch.object(self.upd, "acquire_source") as acquire,
            patch.object(self.upd.version_check, "latest_release_version", return_value="0.2.0"),
            patch.object(self.upd, "update_agents", return_value=(["claude"], [])),
            patch.object(self.upd.os, "chdir"),
            patch("builtins.print") as mock_print,
        ):
            self.upd.main(["--source", "/somewhere"])
        acquire.assert_not_called()  # no Cursor → no source acquisition
        printed = " ".join(str(c.args[0]) for c in mock_print.call_args_list)
        self.assertIn("to v0.2.0", printed)


if __name__ == "__main__":
    unittest.main()

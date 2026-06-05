"""Tests for installer/update.py — the self-fetching, delegate-to-install.py
manual update command.
"""
from __future__ import annotations

import importlib.util
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
            updated, failed = self.upd.update_agents(["claude"], silent=True)

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

    def test_selected_filters_targets(self):
        r1, r2, r3 = self._patch_resolvers()
        with r1, r2, r3, patch.object(self.upd.subprocess, "run", side_effect=self._ok) as run:
            updated, failed = self.upd.update_agents(
                ["codex", "copilot"], selected="copilot", silent=True
            )
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
            updated, failed = self.upd.update_agents(["claude"], silent=True)
        self.assertEqual((updated, failed), ([], ["claude"]))


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

        def fake_update_agents(target_ids, *, fresh_root=None, selected=None, silent=False):
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

    def test_cursor_source_failure_does_not_abort_native_agents(self):
        # Download fails, but native agents must still be attempted; main does
        # not early-return. update_agents (here mocked) receives fresh_root=None.
        captured: dict = {}

        def fake_update_agents(target_ids, *, fresh_root=None, selected=None, silent=False):
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


if __name__ == "__main__":
    unittest.main()

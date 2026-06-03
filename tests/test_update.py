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

    def test_detects_only_updateable_present_agents(self):
        (self.home / ".codex").mkdir()
        (self.home / ".copilot").mkdir()
        (self.home / ".claude").mkdir()  # present but never updated here
        ids = self.upd.detect_updateable_target_ids(self.home)
        self.assertEqual(ids, ["codex", "copilot"])

    def test_claude_is_never_updateable(self):
        (self.home / ".claude").mkdir()
        self.assertEqual(self.upd.detect_updateable_target_ids(self.home), [])

    def test_none_present(self):
        self.assertEqual(self.upd.detect_updateable_target_ids(self.home), [])


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
# update.py — delegation
# ---------------------------------------------------------------------------


class UpdateTargetsTests(unittest.TestCase):
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

    def _fail(self, *a, **k):
        return subprocess.CompletedProcess(args=[], returncode=1, stdout="", stderr="boom")

    def test_all_targets_delegate_to_install_py(self):
        calls = []

        def record(cmd, **kw):
            calls.append(cmd)
            return self._ok()

        with patch.object(self.upd.subprocess, "run", side_effect=record):
            updated, failed = self.upd.update_targets(
                self.fresh_root, ["codex", "copilot"], silent=True
            )

        self.assertEqual(updated, ["codex", "copilot"])
        self.assertEqual(failed, [])
        install_script = str(self.fresh_root / "installer" / "install.py")
        for cmd in calls:
            self.assertEqual(cmd[1], install_script)
            self.assertEqual(cmd[2], "--target")

    def test_selected_filters_targets(self):
        with patch.object(self.upd.subprocess, "run", side_effect=self._ok) as run:
            updated, failed = self.upd.update_targets(
                self.fresh_root, ["codex", "copilot"], selected="copilot", silent=True
            )
        self.assertEqual(updated, ["copilot"])
        self.assertEqual(run.call_count, 1)

    def test_failure_recorded(self):
        def side(cmd, **kw):
            return self._fail() if "codex" in cmd else self._ok()

        with patch.object(self.upd.subprocess, "run", side_effect=side):
            updated, failed = self.upd.update_targets(
                self.fresh_root, ["codex", "copilot"], silent=True
            )
        self.assertEqual(updated, ["copilot"])
        self.assertEqual(failed, ["codex"])

    def test_passes_timeout_and_blocks_stdin(self):
        seen: dict = {}

        def record(cmd, **kw):
            seen.update(kw)
            return self._ok()

        with patch.object(self.upd.subprocess, "run", side_effect=record):
            self.upd.update_targets(self.fresh_root, ["codex"], silent=True)

        self.assertEqual(seen.get("timeout"), self.upd._INSTALL_TIMEOUT_SECONDS)
        self.assertEqual(seen.get("stdin"), subprocess.DEVNULL)

    def test_timeout_recorded_as_failure(self):
        def side(cmd, **kw):
            if "codex" in cmd:
                raise subprocess.TimeoutExpired(cmd=cmd, timeout=kw.get("timeout"))
            return self._ok()

        with patch.object(self.upd.subprocess, "run", side_effect=side):
            updated, failed = self.upd.update_targets(
                self.fresh_root, ["codex", "copilot"], silent=True
            )
        self.assertEqual(updated, ["copilot"])
        self.assertEqual(failed, ["codex"])


# ---------------------------------------------------------------------------
# update.py — main orchestration
# ---------------------------------------------------------------------------


class UpdateMainTests(unittest.TestCase):
    def setUp(self):
        self.upd = load_update()

    def test_no_targets_skips_download(self):
        download = MagicMock()
        with (
            patch.object(self.upd, "detect_updateable_target_ids", return_value=[]),
            patch.object(self.upd, "acquire_source", download),
            patch("builtins.print"),
        ):
            result = self.upd.main([])
        download.assert_not_called()
        self.assertEqual(result, 0)

    def test_target_not_installed_skips(self):
        with (
            patch.object(self.upd, "detect_updateable_target_ids", return_value=["codex"]),
            patch.object(self.upd, "acquire_source") as acquire,
            patch("builtins.print"),
        ):
            result = self.upd.main(["--target", "cursor"])
        acquire.assert_not_called()
        self.assertEqual(result, 0)

    def test_happy_path_reports_target_version_and_chdirs(self):
        with (
            patch.object(self.upd, "detect_updateable_target_ids", return_value=["codex"]),
            patch.object(self.upd, "acquire_source", return_value=(Path("/fresh"), "0.2.0")),
            patch.object(self.upd, "update_targets", return_value=(["codex"], [])),
            patch.object(self.upd.os, "chdir") as chdir,
            patch("builtins.print") as mock_print,
        ):
            result = self.upd.main([])

        self.assertEqual(result, 0)
        chdir.assert_called_once()
        printed = " ".join(str(c.args[0]) for c in mock_print.call_args_list)
        # Reports the version updated *to*; no misleading "from" version.
        self.assertIn("to v0.2.0", printed)
        self.assertNotIn("->", printed)

    def test_acquire_failure_returns_one(self):
        with (
            patch.object(self.upd, "detect_updateable_target_ids", return_value=["codex"]),
            patch.object(self.upd.version_check, "installed_plugin_version", return_value="0.1.3"),
            patch.object(self.upd, "acquire_source", side_effect=RuntimeError("no net")),
            patch.object(self.upd.os, "chdir"),
            patch("builtins.print"),
        ):
            result = self.upd.main([])
        self.assertEqual(result, 1)

    def test_failed_target_returns_one(self):
        with (
            patch.object(self.upd, "detect_updateable_target_ids", return_value=["codex"]),
            patch.object(self.upd.version_check, "installed_plugin_version", return_value="0.1.3"),
            patch.object(self.upd, "acquire_source", return_value=(Path("/fresh"), "0.2.0")),
            patch.object(self.upd, "update_targets", return_value=([], ["codex"])),
            patch.object(self.upd.os, "chdir"),
            patch("builtins.print"),
        ):
            result = self.upd.main([])
        self.assertEqual(result, 1)


if __name__ == "__main__":
    unittest.main()

"""Tests for runtime/version_check.py — installed-version reader and the
release-zip self-fetch helper used by installer/update.py.
"""
from __future__ import annotations

import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_DIR = ROOT / "runtime"


def load_version_check():
    spec = importlib.util.spec_from_file_location(
        "version_check", RUNTIME_DIR / "version_check.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class _Resp(io.BytesIO):
    """A BytesIO that doubles as a urlopen context manager."""

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


# ---------------------------------------------------------------------------
# installed_plugin_version
# ---------------------------------------------------------------------------


class InstalledPluginVersionTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.plugin_root = Path(self._tmp.name)
        self.vc = load_version_check()

    def tearDown(self):
        self._tmp.cleanup()

    def _write_plugin_json(self, rel_path: str, version: str) -> None:
        path = self.plugin_root / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"name": "x", "version": version}), encoding="utf-8")

    def test_reads_github_plugin_json(self):
        self._write_plugin_json(".github/plugin/plugin.json", "0.2.0")
        self.assertEqual(self.vc.installed_plugin_version(self.plugin_root), "0.2.0")

    def test_falls_back_to_codex_plugin_json(self):
        self._write_plugin_json(".codex-plugin/plugin.json", "0.1.5")
        self.assertEqual(self.vc.installed_plugin_version(self.plugin_root), "0.1.5")

    def test_returns_none_when_no_manifest(self):
        self.assertIsNone(self.vc.installed_plugin_version(self.plugin_root))

    def test_returns_none_for_corrupt_json(self):
        path = self.plugin_root / ".github" / "plugin" / "plugin.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("not json", encoding="utf-8")
        self.assertIsNone(self.vc.installed_plugin_version(self.plugin_root))


# ---------------------------------------------------------------------------
# download_latest_release_zip (self-fetch)
# ---------------------------------------------------------------------------


class DownloadLatestReleaseZipTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.vc = load_version_check()

    def tearDown(self):
        self._tmp.cleanup()

    def test_returns_none_when_no_release(self):
        with patch.object(self.vc, "_fetch_release_json", return_value=None):
            self.assertIsNone(self.vc.download_latest_release_zip(self.tmp / "r.zip"))

    def test_returns_none_when_no_zip_asset(self):
        release = ({"tag_name": "0.2.0", "assets": [{"name": "notes.txt", "url": "u"}]}, None)
        with patch.object(self.vc, "_fetch_release_json", return_value=release):
            self.assertIsNone(self.vc.download_latest_release_zip(self.tmp / "r.zip"))

    def test_downloads_zip_and_returns_version(self):
        release = (
            {
                "tag_name": "v0.2.0",
                "assets": [
                    {
                        "name": "creatio-ai-app-development-toolkit-0.2.0.zip",
                        "url": "https://api.github.com/repos/x/releases/assets/9",
                    }
                ],
            },
            "gho_TOKEN",
        )
        captured: dict = {}

        def fake_urlopen(req, timeout=None):
            captured["headers"] = dict(req.headers)
            captured["url"] = req.full_url
            return _Resp(b"PKFAKEZIPBYTES")

        dest = self.tmp / "r.zip"
        with (
            patch.object(self.vc, "_fetch_release_json", return_value=release),
            patch("urllib.request.urlopen", side_effect=fake_urlopen),
        ):
            version = self.vc.download_latest_release_zip(dest)

        self.assertEqual(version, "0.2.0")
        self.assertEqual(dest.read_bytes(), b"PKFAKEZIPBYTES")
        self.assertEqual(captured["headers"].get("Accept"), "application/octet-stream")
        # TEMPORARY-PRIVATE-REPO-AUTH: token from the probe is forwarded here.
        self.assertEqual(captured["headers"].get("Authorization"), "Bearer gho_TOKEN")

    def test_no_token_header_for_public_asset(self):
        release = (
            {
                "tag_name": "0.2.0",
                "assets": [{"name": "x.zip", "url": "https://api.github.com/a"}],
            },
            None,
        )
        captured: dict = {}

        def fake_urlopen(req, timeout=None):
            captured["headers"] = dict(req.headers)
            return _Resp(b"PK")

        with (
            patch.object(self.vc, "_fetch_release_json", return_value=release),
            patch("urllib.request.urlopen", side_effect=fake_urlopen),
        ):
            self.vc.download_latest_release_zip(self.tmp / "r.zip")

        self.assertNotIn("Authorization", captured["headers"])

    def test_network_error_returns_none(self):
        release = (
            {"tag_name": "0.2.0", "assets": [{"name": "x.zip", "url": "https://api.github.com/a"}]},
            None,
        )
        with (
            patch.object(self.vc, "_fetch_release_json", return_value=release),
            patch("urllib.request.urlopen", side_effect=OSError("boom")),
        ):
            self.assertIsNone(self.vc.download_latest_release_zip(self.tmp / "r.zip"))


# ---------------------------------------------------------------------------
# TEMPORARY-PRIVATE-REPO-AUTH: _gh_auth_token (remove once repo is public)
# ---------------------------------------------------------------------------


class GhAuthTokenTests(unittest.TestCase):
    def setUp(self):
        self.vc = load_version_check()

    def test_token_sourced_from_gh_cli(self):
        import subprocess

        fake = subprocess.CompletedProcess(args=[], returncode=0, stdout="gho_TOKEN\n")
        with patch("subprocess.run", return_value=fake):
            self.assertEqual(self.vc._gh_auth_token(), "gho_TOKEN")

    def test_gh_cli_failure_returns_none(self):
        import subprocess

        fake = subprocess.CompletedProcess(args=[], returncode=1, stdout="")
        with patch("subprocess.run", return_value=fake):
            self.assertIsNone(self.vc._gh_auth_token())

    def test_gh_cli_missing_returns_none(self):
        with patch("subprocess.run", side_effect=FileNotFoundError):
            self.assertIsNone(self.vc._gh_auth_token())


if __name__ == "__main__":
    unittest.main()

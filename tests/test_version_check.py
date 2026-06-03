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
        release = {"tag_name": "0.2.0", "assets": [{"name": "notes.txt", "url": "u"}]}
        with patch.object(self.vc, "_fetch_release_json", return_value=release):
            self.assertIsNone(self.vc.download_latest_release_zip(self.tmp / "r.zip"))

    def test_downloads_zip_and_returns_version(self):
        release = {
            "tag_name": "v0.2.0",
            "assets": [
                {
                    "name": "creatio-ai-app-development-toolkit-0.2.0.zip",
                    "url": "https://api.github.com/repos/x/releases/assets/9",
                }
            ],
        }
        dest = self.tmp / "r.zip"
        with (
            patch.object(self.vc, "_fetch_release_json", return_value=release),
            patch.object(self.vc, "_open_asset_stream", return_value=_Resp(b"PKFAKEZIPBYTES")),
        ):
            version = self.vc.download_latest_release_zip(dest)

        self.assertEqual(version, "0.2.0")
        self.assertEqual(dest.read_bytes(), b"PKFAKEZIPBYTES")

    def test_selects_canonical_zip_by_name(self):
        # An unrelated zip listed first must not be picked over the canonical
        # `creatio-ai-app-development-toolkit-<version>.zip` asset.
        release = {
            "tag_name": "0.2.0",
            "assets": [
                {"name": "unrelated.zip", "url": "https://api.github.com/wrong"},
                {
                    "name": "creatio-ai-app-development-toolkit-0.2.0.zip",
                    "url": "https://api.github.com/right",
                },
            ],
        }
        captured: dict = {}

        def fake_open(asset_url):
            captured["url"] = asset_url
            return _Resp(b"PK")

        with (
            patch.object(self.vc, "_fetch_release_json", return_value=release),
            patch.object(self.vc, "_open_asset_stream", side_effect=fake_open),
        ):
            self.vc.download_latest_release_zip(self.tmp / "r.zip")

        self.assertEqual(captured["url"], "https://api.github.com/right")

    def test_network_error_returns_none(self):
        release = {"tag_name": "0.2.0", "assets": [{"name": "x.zip", "url": "https://api.github.com/a"}]}
        with (
            patch.object(self.vc, "_fetch_release_json", return_value=release),
            patch.object(self.vc, "_open_asset_stream", side_effect=OSError("boom")),
        ):
            self.assertIsNone(self.vc.download_latest_release_zip(self.tmp / "r.zip"))


# ---------------------------------------------------------------------------
# _open_asset_stream — unauthenticated public download
# ---------------------------------------------------------------------------


class OpenAssetStreamTests(unittest.TestCase):
    def setUp(self):
        self.vc = load_version_check()

    def test_no_authorization_header_sent(self):
        captured: dict = {}

        def fake_open(req, data=None, timeout=None):
            captured["headers"] = dict(req.headers)
            captured["url"] = req.full_url
            return _Resp(b"PK")

        with patch("urllib.request.OpenerDirector.open", side_effect=fake_open):
            self.vc._open_asset_stream("https://api.github.com/asset")

        self.assertNotIn("Authorization", captured["headers"])
        self.assertEqual(captured["headers"].get("Accept"), "application/octet-stream")


if __name__ == "__main__":
    unittest.main()

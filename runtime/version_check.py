#!/usr/bin/env python3
"""Release-asset download helpers used by `installer/update.py`.

Only two public helpers remain:
  - `installed_plugin_version()` reads the installed CAADT version from the
    nearest plugin manifest so update.py can report a before/after delta.
  - `download_latest_release_zip()` fetches the latest release zip asset from
    the public GitHub release so update.py can self-fetch from any checkout.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

_GITHUB_API = (
    "https://api.github.com/repos/Creatio-Platform/"
    "creatio-ai-app-development-toolkit/releases/latest"
)


def _fetch_release_json() -> dict[str, Any] | None:
    """Fetch the `releases/latest` JSON from the public GitHub repo.

    Returns the parsed release JSON on success, or None on any failure.
    Callers must handle None — a network/API failure must never break the
    update flow.
    """
    try:
        import urllib.error
        import urllib.request

        headers = {"User-Agent": "caadt-version-check/1"}
        req = urllib.request.Request(_GITHUB_API, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            if isinstance(body, dict) and body.get("tag_name"):
                return body
    except Exception:  # noqa: BLE001
        pass
    return None


def download_latest_release_zip(dest_path: Path) -> str | None:
    """Download the latest release's `.zip` asset to *dest_path*.

    Returns the downloaded release version (tag without a leading 'v') on
    success, or None on any failure (no release, no zip asset, network error).
    The caller must handle None gracefully — a failed download must never crash
    the update command.
    """
    release = _fetch_release_json()
    if release is None:
        return None

    tag = release.get("tag_name", "")
    version = tag.lstrip("v") if isinstance(tag, str) and tag else None
    if not version:
        return None

    assets = release.get("assets")
    if not isinstance(assets, list):
        return None
    zip_assets = [
        asset
        for asset in assets
        if isinstance(asset, dict)
        and isinstance(asset.get("name"), str)
        and asset["name"].endswith(".zip")
        and isinstance(asset.get("url"), str)
    ]
    if not zip_assets:
        return None
    asset_url = zip_assets[0]["url"]

    try:
        import urllib.error
        import urllib.request

        headers = {
            "User-Agent": "caadt-version-check/1",
            "Accept": "application/octet-stream",
        }
        req = urllib.request.Request(asset_url, headers=headers)
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(req, timeout=60) as resp, dest_path.open("wb") as out:
            shutil.copyfileobj(resp, out)
    except Exception:  # noqa: BLE001
        return None
    return version


def installed_plugin_version(plugin_root: Path) -> str | None:
    """Read the installed CAADT version from the nearest plugin manifest.

    Checks these manifests in order (first found wins):
      .github/plugin/plugin.json   — Copilot / shared marketplace
      .codex-plugin/plugin.json    — Codex
      .claude-plugin/plugin.json   — Claude Code (reference only)

    Returns None if no valid version string is found.
    """
    candidates = (
        plugin_root / ".github" / "plugin" / "plugin.json",
        plugin_root / ".codex-plugin" / "plugin.json",
        plugin_root / ".claude-plugin" / "plugin.json",
    )
    for path in candidates:
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            version = data.get("version")
            if isinstance(version, str) and version:
                return version
        except (json.JSONDecodeError, OSError):
            continue
    return None

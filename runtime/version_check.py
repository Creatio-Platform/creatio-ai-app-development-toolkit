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
from urllib.parse import urlsplit

_GITHUB_API = (
    "https://api.github.com/repos/Creatio-Platform/"
    "creatio-ai-app-development-toolkit/releases/latest"
)

_GITHUB_API_HOST = "api.github.com"


def _is_https_url(url: str, *, allowed_host: str | None = None) -> bool:
    """Return True only for an ``https://`` URL on an optional allowed host.

    Rejects any other scheme (notably ``file://``, ``ftp://``, ``data:``) so an
    attacker-controlled URL handed to ``urllib.request.urlopen`` cannot read
    local files or reach unexpected schemes.
    """
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        return False
    if allowed_host is not None and parts.hostname.lower() != allowed_host:
        return False
    return True


def _https_opener():
    """Build a urllib opener that can *only* speak HTTPS.

    Unlike the module-level ``urllib.request.urlopen`` (which wires up handlers
    for ``file://``, ``ftp://`` and friends), this director registers only the
    HTTPS and redirect handlers. Any non-HTTPS URL — including a ``file://`` URL
    smuggled in via an API response or a redirect to a downgraded ``http://``
    target — has no handler and raises instead of being fetched.
    """
    import urllib.request

    opener = urllib.request.OpenerDirector()
    opener.add_handler(urllib.request.HTTPSHandler())
    opener.add_handler(urllib.request.HTTPRedirectHandler())
    return opener


def _fetch_release_json() -> dict[str, Any] | None:
    """Fetch the `releases/latest` JSON from the public GitHub repo.

    Returns the release dict on success, or None on any failure. Callers must
    handle None — a network/API failure must never break the update flow.
    """
    try:
        import urllib.request

        if not _is_https_url(_GITHUB_API, allowed_host=_GITHUB_API_HOST):
            return None
        headers = {"User-Agent": "caadt-version-check/1"}
        req = urllib.request.Request(_GITHUB_API, headers=headers)
        with _https_opener().open(req, timeout=10) as resp:
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
    # Prefer the canonically named asset over GitHub's (unspecified) asset
    # ordering, so an unrelated `.zip` uploaded to a future release can't be
    # picked up by accident. Fall back to the first zip if the name differs.
    expected_name = f"creatio-ai-app-development-toolkit-{version}.zip"
    preferred = [asset for asset in zip_assets if asset["name"] == expected_name]
    asset_url = (preferred or zip_assets)[0]["url"]

    try:
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        with _open_asset_stream(asset_url) as resp, dest_path.open("wb") as out:
            shutil.copyfileobj(resp, out)
    except Exception:  # noqa: BLE001
        return None
    return version


def _open_asset_stream(asset_url: str):
    """Open a readable stream for a release asset.

    The GitHub asset API answers `Accept: application/octet-stream` with a 302
    to a presigned CDN URL on a different host; urllib follows it automatically.
    With the repo public there is no token to protect, so a plain `urlopen`
    suffices.
    """
    import urllib.request

    if not _is_https_url(asset_url):
        raise ValueError("Refusing to open non-HTTPS release asset URL")
    headers = {
        "User-Agent": "caadt-version-check/1",
        "Accept": "application/octet-stream",
    }
    req = urllib.request.Request(asset_url, headers=headers)
    return _https_opener().open(req, timeout=60)


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

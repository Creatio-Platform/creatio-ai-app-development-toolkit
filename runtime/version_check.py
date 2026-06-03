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


# >>> TEMPORARY-PRIVATE-REPO-AUTH (revert this whole block once the repo is public) >>>
# While the repo is private the GitHub release API returns 404 to
# unauthenticated callers. Source a token from the gh CLI so the updater can
# read the release JSON and download the asset. On a public repo this is a
# no-op: the unauthenticated request already works and the token just raises
# the rate limit. Delete this helper, drop the `token` plumbing in
# `_fetch_release_json` / `download_latest_release_zip`, and remove the
# matching tests to revert.
def _gh_auth_token() -> str | None:
    """Return a github.com token from the gh CLI, or None.

    Fails silently so a missing/unconfigured gh CLI never blocks the call.
    """
    try:
        import subprocess

        result = subprocess.run(
            ["gh", "auth", "token", "--hostname", "github.com"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            token = result.stdout.strip()
            return token or None
    except Exception:  # noqa: BLE001
        pass
    return None
# <<< TEMPORARY-PRIVATE-REPO-AUTH <<<


def _fetch_release_json() -> tuple[dict[str, Any], str | None] | None:
    """Fetch the `releases/latest` JSON from the GitHub repo.

    Returns `(release_json, token_used)` on success, or None on any failure.
    `token_used` is the bearer token that authorized the call (forwarded to the
    asset download from the same host), or None when the call succeeded
    unauthenticated. Callers must handle None — a network/API failure must
    never break the update flow.
    """
    try:
        import urllib.error
        import urllib.request

        # TEMPORARY-PRIVATE-REPO-AUTH: token is None once the repo is public.
        token = _gh_auth_token()
        headers = {"User-Agent": "caadt-version-check/1"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(_GITHUB_API, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            if isinstance(body, dict) and body.get("tag_name"):
                return body, token
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
    result = _fetch_release_json()
    if result is None:
        return None
    release, token = result

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
        with _open_asset_stream(asset_url, token) as resp, dest_path.open("wb") as out:
            shutil.copyfileobj(resp, out)
    except Exception:  # noqa: BLE001
        return None
    return version


def _open_asset_stream(asset_url: str, token: str | None):
    """Open a readable stream for a release asset without leaking the token.

    The GitHub asset API answers `Accept: application/octet-stream` with a 302
    to a presigned CDN URL on a *different* host. CPython's stdlib forwards all
    non-content headers across hosts on redirect (bpo-33661, still open), so an
    auto-followed redirect would replay the bearer token to the asset CDN
    (`objects.githubusercontent.com` / S3). We disable auto-follow and re-issue
    the request to the redirect target WITHOUT `Authorization` — the CDN
    authenticates via the query string and ignores the header anyway.
    """
    import urllib.error
    import urllib.request

    class _NoFollowRedirect(urllib.request.HTTPRedirectHandler):
        # Returning None surfaces the 30x as an HTTPError instead of following.
        def redirect_request(self, *args, **kwargs):
            return None

    base_headers = {
        "User-Agent": "caadt-version-check/1",
        "Accept": "application/octet-stream",
    }
    headers = dict(base_headers)
    # TEMPORARY-PRIVATE-REPO-AUTH: authenticate the initial API request only.
    # Remove the token plumbing once the repo is public.
    if token:
        headers["Authorization"] = f"Bearer {token}"

    opener = urllib.request.build_opener(_NoFollowRedirect)
    req = urllib.request.Request(asset_url, headers=headers)
    try:
        return opener.open(req, timeout=60)
    except urllib.error.HTTPError as err:
        location = err.headers.get("Location") if err.headers else None
        if err.code in (301, 302, 303, 307, 308) and location:
            # Follow once, WITHOUT Authorization, to the redirect target.
            follow = urllib.request.Request(location, headers=dict(base_headers))
            return urllib.request.urlopen(follow, timeout=60)
        raise


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

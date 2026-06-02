#!/usr/bin/env python3
"""Unified, self-fetching CAADT update command.

Manual update entrypoint. Each agent also has its own native plugin update
command (Codex `plugin marketplace upgrade`, Copilot `plugin update`, Claude
marketplace auto-update) — this script is the one-shot equivalent that updates
every detected agent in a single run, skipping Claude (its marketplace handles
itself).

How it works:
  1. Download the latest release zip (reusing runtime/version_check.py for the
     public GitHub release API) into a temp directory and extract it.
  2. For each detected, updateable agent, delegate to the *freshly downloaded*
     `installer/install.py --target <agent>`. install.py already encodes the
     correct per-agent mechanism:
        codex   — remote-marketplace CLI (`codex plugin marketplace add` + add)
        cursor  — local file-copy from the downloaded release
        copilot — remote-marketplace CLI (`copilot plugin install`)
     Delegating to the downloaded install.py means the update always runs the
     latest install logic against the latest source.

Because it downloads its own source, this command works from anywhere — a stale
checkout, an installed plugin directory, or a fresh clone. Run it from a plain
terminal *after* exiting your agent session: updating an agent rewrites the
plugin directory the running session holds, which can fail on Windows while the
session is live.

Usage:
  python installer/update.py
  python installer/update.py --target {codex,cursor,copilot}
  python installer/update.py --source <dir>   # use a local checkout/extract; skip download
  python installer/update.py --silent         # machine-readable; non-zero on failure
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

# Allow running as `python installer/update.py` from a checkout, an extracted
# release, or an installed plugin directory.
_INSTALLER_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _INSTALLER_DIR.parent
_RUNTIME_DIR = _REPO_ROOT / "runtime"

if str(_RUNTIME_DIR) not in sys.path:
    sys.path.insert(0, str(_RUNTIME_DIR))

import version_check  # noqa: E402

# -------------------------------------------------------------------------
# Constants
# -------------------------------------------------------------------------

# Claude is intentionally absent: it self-updates via the marketplace.
UPDATEABLE_TARGETS: tuple[str, ...] = ("codex", "cursor", "copilot")


# -------------------------------------------------------------------------
# Detection
# -------------------------------------------------------------------------


def detect_updateable_target_ids(home: Path | None = None) -> list[str]:
    """Return the updateable agents that are installed on this machine.

    Mirrors install.py's detect_targets() home-directory probe, minus Claude
    (which self-updates). Kept inline so the update command never depends on the
    possibly-stale install.py it sits next to.
    """
    home = home or Path.home()
    return [tid for tid in UPDATEABLE_TARGETS if (home / f".{tid}").exists()]


# -------------------------------------------------------------------------
# Source acquisition (download + extract, or local --source)
# -------------------------------------------------------------------------


def _find_extracted_root(base: Path) -> Path | None:
    """Locate the directory that holds installer/install.py inside *base*.

    The release zip nests everything under a single
    `creatio-ai-app-development-toolkit-<version>/` directory; a `--source`
    checkout may already be that directory.
    """
    if (base / "installer" / "install.py").exists():
        return base
    for child in sorted(base.iterdir()):
        if child.is_dir() and (child / "installer" / "install.py").exists():
            return child
    return None


def acquire_source(
    work_dir: Path,
    *,
    source: Path | None = None,
) -> tuple[Path, str]:
    """Return (fresh_root, version) for the source to update from.

    With --source, use the given local directory and read its plugin version.
    Otherwise download and extract the latest release into *work_dir*.

    Raises RuntimeError with an actionable message on any failure.
    """
    if source is not None:
        fresh_root = _find_extracted_root(source)
        if fresh_root is None:
            raise RuntimeError(
                f"--source {source} does not contain installer/install.py"
            )
        version = version_check.installed_plugin_version(fresh_root) or "unknown"
        return fresh_root, version

    zip_path = work_dir / "release.zip"
    version = version_check.download_latest_release_zip(zip_path)
    if not version:
        raise RuntimeError(
            "Could not download the latest CAADT release. Check your network "
            "connection and retry."
        )

    extract_dir = work_dir / "extracted"
    try:
        with zipfile.ZipFile(zip_path) as archive:
            archive.extractall(extract_dir)
    except (zipfile.BadZipFile, OSError) as error:
        raise RuntimeError(f"Downloaded release zip is not readable: {error}") from error

    fresh_root = _find_extracted_root(extract_dir)
    if fresh_root is None:
        raise RuntimeError(
            "Downloaded release is missing installer/install.py — release packaging may be broken."
        )
    return fresh_root, version


# -------------------------------------------------------------------------
# Core update logic
# -------------------------------------------------------------------------


def update_targets(
    fresh_root: Path,
    target_ids: list[str],
    *,
    selected: str | None = None,
    silent: bool = False,
) -> tuple[list[str], list[str]]:
    """Delegate each target to the freshly downloaded install.py --target <id>.

    Returns (updated, failed) lists of target IDs.
    """
    updated: list[str] = []
    failed: list[str] = []
    install_script = fresh_root / "installer" / "install.py"

    for target_id in target_ids:
        if selected and target_id != selected:
            continue
        command = [sys.executable, str(install_script), "--target", target_id]
        result = subprocess.run(command, text=True, capture_output=True)
        if result.returncode != 0:
            failed.append(target_id)
            if not silent:
                detail = (result.stderr or result.stdout or "").strip()
                print(f"ERROR updating {target_id}: {detail}", file=sys.stderr)
            continue
        updated.append(target_id)
        if not silent:
            print(f"Updated {target_id}.")

    return updated, failed


# -------------------------------------------------------------------------
# CLI
# -------------------------------------------------------------------------


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Update installed CAADT agents (Codex, Cursor, Copilot). "
            "Claude Code is skipped — it self-updates."
        )
    )
    parser.add_argument(
        "--target",
        choices=list(UPDATEABLE_TARGETS),
        help="Update only this agent.",
    )
    parser.add_argument(
        "--source",
        type=Path,
        help="Update from this local checkout/extract instead of downloading the latest release.",
    )
    parser.add_argument(
        "--silent",
        action="store_true",
        help="Suppress normal output; exit non-zero if any update fails.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)

    target_ids = detect_updateable_target_ids()
    if args.target and args.target not in target_ids:
        if not args.silent:
            print(f"{args.target} is not installed; nothing to update.")
        return 0
    if not target_ids:
        if not args.silent:
            print("No updatable agents detected (Codex, Cursor, GitHub Copilot CLI).")
        return 0

    before = version_check.installed_plugin_version(_REPO_ROOT)

    # Step out of any plugin directory before updating: delegating to install.py
    # rewrites the plugin tree this script may live in, which fails on Windows
    # if the process's working directory is inside the tree being replaced.
    try:
        os.chdir(Path.home())
    except OSError:
        pass

    work_dir = Path(tempfile.mkdtemp(prefix="caadt-update-"))
    try:
        try:
            fresh_root, version = acquire_source(work_dir, source=args.source)
        except RuntimeError as error:
            if not args.silent:
                print(f"ERROR: {error}", file=sys.stderr)
            return 1

        updated, failed = update_targets(
            fresh_root,
            target_ids,
            selected=args.target,
            silent=args.silent,
        )
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

    if not args.silent:
        if updated:
            delta = f"v{before} -> v{version}" if before else f"v{version}"
            print(f"\nUpdated {len(updated)} agent(s) ({delta}): {', '.join(updated)}")
            print("Start a new agent session to load the updated version.")
        if failed:
            print(f"Failed  {len(failed)} agent(s): {', '.join(failed)}", file=sys.stderr)

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

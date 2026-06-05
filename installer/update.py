#!/usr/bin/env python3
"""Unified CAADT update command.

Manual update entrypoint — the one-shot equivalent of updating every detected
agent in a single run. Distinct from install.py: this updates *already-installed*
plugins, it does not install or configure them.

How it works:
  - Agents with a native plugin-update command are updated in place via that
    command. Each is a two-step sequence — refresh the local marketplace catalog,
    then update/reinstall the plugin — because a bare update compares against the
    *cached* catalog and no-ops if it looks current:
        claude  — `claude plugin marketplace update`  + `claude plugin update`
        codex   — `codex plugin marketplace upgrade`   + `codex plugin add`
        copilot — `copilot plugin marketplace update`  + `copilot plugin update`
  - Cursor has no native update command, so it is the only agent that falls back
    to install.py: it is reinstalled (file-copy) from the latest release, which
    this command downloads on demand. Agents are updated from their own
    marketplace git, so the release zip is fetched *only* when Cursor is present.

update.py shares only `agent_cli` (plugin/marketplace identifiers + CLI
resolution) with install.py; its update logic is otherwise independent.

Run it from a plain terminal *after* exiting your agent session: updating an
agent rewrites the plugin directory the running session holds, which can fail on
Windows while the session is live.

Usage:
  python installer/update.py
  python installer/update.py --target {codex,claude,cursor,copilot}
  python installer/update.py --source <dir>   # reinstall Cursor from a local checkout/extract
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
# release, or an installed plugin directory. The installer dir holds agent_cli
# (shared with install.py); the runtime dir holds version_check.
_INSTALLER_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _INSTALLER_DIR.parent
_RUNTIME_DIR = _REPO_ROOT / "runtime"

for _dir in (_INSTALLER_DIR, _RUNTIME_DIR):
    if str(_dir) not in sys.path:
        sys.path.insert(0, str(_dir))

import agent_cli  # noqa: E402
import version_check  # noqa: E402

# -------------------------------------------------------------------------
# Constants
# -------------------------------------------------------------------------

# Agents with a native plugin-update command — updated in place, no download.
NATIVE_TARGETS: tuple[str, ...] = ("codex", "claude", "copilot")
# Agents with no native update command — reinstalled from the release source.
COPY_TARGETS: tuple[str, ...] = ("cursor",)
# Detection/reporting order across every agent we can update.
ALL_TARGETS: tuple[str, ...] = ("codex", "claude", "cursor", "copilot")

# Upper bound for a single CLI step. Each native step does its own network I/O
# (refreshing a remote marketplace, pulling a plugin), so without a cap a stalled
# socket or an interactive prompt would hang the updater with no exit code.
_STEP_TIMEOUT_SECONDS = 600

# The installer script delegated to for Cursor and used to locate the release root.
_INSTALL_SCRIPT_NAME = "install.py"


# -------------------------------------------------------------------------
# Detection
# -------------------------------------------------------------------------


def detect_installed_target_ids(home: Path | None = None) -> list[str]:
    """Return the agents that are installed on this machine.

    Mirrors install.py's detect_targets() home-directory probe. Kept inline so
    the update command never depends on install.py.
    """
    home = home or Path.home()
    return [tid for tid in ALL_TARGETS if (home / f".{tid}").exists()]


# -------------------------------------------------------------------------
# Native update commands (two-step: refresh catalog, then update plugin)
# -------------------------------------------------------------------------


def native_update_commands(target_id: str) -> list[list[str]]:
    """Return the ordered argv command-lists for a native agent's update.

    Step 1 refreshes the local marketplace catalog from its git source; step 2
    updates (Claude/Copilot) or reinstalls from the refreshed snapshot (Codex,
    which has no `plugin update`). The refresh is required: a bare update/add
    resolves the version from the *cached* catalog and skips if it already
    matches, so without it a moved `release` branch would never be picked up.
    """
    if target_id == "claude":
        cli = agent_cli.resolve_claude_command()
        return [
            [*cli, "plugin", "marketplace", "update", agent_cli.MARKETPLACE_NAME],
            [*cli, "plugin", "update", agent_cli.PLUGIN_SOURCE],
        ]
    if target_id == "codex":
        cli = agent_cli.resolve_codex_command()
        return [
            [*cli, "plugin", "marketplace", "upgrade", agent_cli.MARKETPLACE_NAME],
            [*cli, "plugin", "add", agent_cli.PLUGIN_SOURCE],
        ]
    if target_id == "copilot":
        cli = agent_cli.resolve_copilot_command()
        return [
            [*cli, "plugin", "marketplace", "update", agent_cli.MARKETPLACE_NAME],
            [*cli, "plugin", "update", agent_cli.PLUGIN_SOURCE],
        ]
    raise ValueError(f"{target_id!r} has no native update command")


def _run_step(command: list[str]) -> None:
    """Run one update step, raising RuntimeError on a non-zero exit.

    stdin=DEVNULL so a step can never block on an interactive prompt; timeout so
    a network stall can't hang forever (propagates as TimeoutExpired).
    """
    result = subprocess.run(
        command,
        text=True,
        capture_output=True,
        stdin=subprocess.DEVNULL,
        timeout=_STEP_TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"{' '.join(command)} failed: {detail}")


def _update_native(target_id: str) -> None:
    for command in native_update_commands(target_id):
        _run_step(command)


def _update_cursor(fresh_root: Path | None) -> None:
    """Reinstall Cursor (file-copy) from the downloaded release via install.py.

    Cursor's "update" is a fresh install from the latest source, so it reuses
    install.py — the only agent that does.
    """
    if fresh_root is None:
        raise RuntimeError(
            "could not obtain the release source needed to update Cursor"
        )
    install_script = fresh_root / "installer" / _INSTALL_SCRIPT_NAME
    _run_step([sys.executable, str(install_script), "--target", "cursor"])


def _update_one_agent(target_id: str, fresh_root: Path | None) -> str | None:
    """Update a single agent. Return None on success, or an error message string."""
    try:
        if target_id in COPY_TARGETS:
            _update_cursor(fresh_root)
        else:
            _update_native(target_id)
    except subprocess.TimeoutExpired:
        return f"timed out after {_STEP_TIMEOUT_SECONDS}s"
    except RuntimeError as error:
        return str(error)
    return None


def update_agents(
    target_ids: list[str],
    *,
    fresh_root: Path | None = None,
    selected: str | None = None,
    silent: bool = False,
) -> tuple[list[str], list[str]]:
    """Update each agent: native command in place, or Cursor file-copy reinstall.

    A failure on one agent is recorded and the rest continue. Returns
    (updated, failed) lists of target IDs.
    """
    updated: list[str] = []
    failed: list[str] = []

    for target_id in target_ids:
        if selected and target_id != selected:
            continue
        error = _update_one_agent(target_id, fresh_root)
        if error is None:
            updated.append(target_id)
            if not silent:
                print(f"Updated {target_id}.")
        else:
            failed.append(target_id)
            if not silent:
                print(f"ERROR updating {target_id}: {error}", file=sys.stderr)

    return updated, failed


# -------------------------------------------------------------------------
# Source acquisition (Cursor only: download + extract, or local --source)
# -------------------------------------------------------------------------


def _safe_extractall(archive: zipfile.ZipFile, dest: Path) -> None:
    """Extract *archive* into *dest*, rejecting path-traversal members.

    `ZipFile.extractall` has no zip-slip guard (and, unlike tarfile, no
    `filter=` option), so a crafted member like `../evil` could write outside
    *dest*. The release source is trusted, but this is cheap defense in depth.
    """
    dest_root = dest.resolve()
    for member in archive.namelist():
        target = (dest_root / member).resolve()
        if target != dest_root and dest_root not in target.parents:
            raise RuntimeError(f"Unsafe path in release zip: {member!r}")
    archive.extractall(dest)


def _find_extracted_root(base: Path) -> Path | None:
    """Locate the directory that holds installer/install.py inside *base*.

    The release zip nests everything under a single
    `creatio-ai-app-development-toolkit-<version>/` directory; a `--source`
    checkout may already be that directory.
    """
    if (base / "installer" / _INSTALL_SCRIPT_NAME).exists():
        return base
    for child in sorted(base.iterdir()):
        if child.is_dir() and (child / "installer" / _INSTALL_SCRIPT_NAME).exists():
            return child
    return None


def acquire_source(
    work_dir: Path,
    *,
    source: Path | None = None,
) -> tuple[Path, str]:
    """Return (fresh_root, version) for the source to reinstall Cursor from.

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
            _safe_extractall(archive, extract_dir)
    except (zipfile.BadZipFile, OSError) as error:
        raise RuntimeError(f"Downloaded release zip is not readable: {error}") from error

    fresh_root = _find_extracted_root(extract_dir)
    if fresh_root is None:
        raise RuntimeError(
            "Downloaded release is missing installer/install.py — release packaging may be broken."
        )
    return fresh_root, version


# -------------------------------------------------------------------------
# CLI
# -------------------------------------------------------------------------


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Update installed CAADT agents (Codex, Claude Code, Cursor, Copilot)."
    )
    parser.add_argument(
        "--target",
        choices=list(ALL_TARGETS),
        help="Update only this agent.",
    )
    parser.add_argument(
        "--source",
        type=Path,
        help="Reinstall Cursor from this local checkout/extract instead of downloading the latest release.",
    )
    parser.add_argument(
        "--silent",
        action="store_true",
        help="Suppress normal output; exit non-zero if any update fails.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)

    target_ids = detect_installed_target_ids()
    if args.target and args.target not in target_ids:
        if not args.silent:
            print(f"{args.target} is not installed; nothing to update.")
        return 0
    if not target_ids:
        if not args.silent:
            print("No installed agents detected (Codex, Claude Code, Cursor, GitHub Copilot CLI).")
        return 0

    # Step out of any plugin directory before updating: a Cursor reinstall
    # rewrites the plugin tree this script may live in, which fails on Windows if
    # the process's working directory is inside the tree being replaced.
    try:
        os.chdir(Path.home())
    except OSError:
        pass

    effective = [tid for tid in target_ids if not args.target or tid == args.target]
    need_source = any(tid in COPY_TARGETS for tid in effective)

    work_dir: Path | None = None
    fresh_root: Path | None = None
    version: str | None = None
    try:
        # Only Cursor needs the release source; native agents update from their
        # own marketplace git. Skip the download entirely when no Cursor.
        if need_source:
            work_dir = Path(tempfile.mkdtemp(prefix="caadt-update-"))
            try:
                fresh_root, version = acquire_source(work_dir, source=args.source)
            except RuntimeError as error:
                # Don't abort the whole run — native agents can still update;
                # Cursor will be reported as failed by update_agents.
                if not args.silent:
                    print(f"ERROR: {error}", file=sys.stderr)

        if version is None:
            version = version_check.latest_release_version()

        updated, failed = update_agents(
            target_ids,
            fresh_root=fresh_root,
            selected=args.target,
            silent=args.silent,
        )
    finally:
        if work_dir is not None:
            shutil.rmtree(work_dir, ignore_errors=True)

    if not args.silent:
        if updated:
            # Report the version we updated *to*. No "from" version: the installed
            # version differs per agent and isn't reliably readable here, so a
            # "vX -> vY" delta would be misleading.
            target = f" to v{version}" if version else ""
            print(f"\nUpdated {len(updated)} agent(s){target}: {', '.join(updated)}")
            print("Start a new agent session to load the updated version.")
        if failed:
            print(f"Failed  {len(failed)} agent(s): {', '.join(failed)}", file=sys.stderr)

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

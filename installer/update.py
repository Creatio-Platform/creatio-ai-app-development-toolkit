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
# Detection/reporting order across every agent we can update. Derived from the
# two groups above so a new agent added to NATIVE_TARGETS/COPY_TARGETS can never
# be silently dropped from detection.
ALL_TARGETS: tuple[str, ...] = NATIVE_TARGETS + COPY_TARGETS

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


def _version_sort_key(name: str) -> tuple[int, ...]:
    """Dotted-int sort key; a non-numeric segment sorts as 0."""
    return tuple(int(part) if part.isdigit() else 0 for part in name.split("."))


def latest_plugin_cache_root(home: Path | None = None) -> Path | None:
    """Newest installed plugin version dir, or None when nothing is cached.

    Claude keeps each installed plugin version at
    ``~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`` and several
    versions coexist, so the highest one is what the CLI just updated to.
    """
    home = home or Path.home()
    base = (
        home
        / ".claude"
        / "plugins"
        / "cache"
        / agent_cli.MARKETPLACE_NAME
        / agent_cli.PLUGIN_NAME
    )
    if not base.is_dir():
        return None
    versions = [entry for entry in base.iterdir() if entry.is_dir()]
    if not versions:
        return None
    return max(versions, key=lambda entry: _version_sort_key(entry.name))


def refresh_claude_named_workflows(home: Path | None = None) -> list[str]:
    """Re-mirror the updated plugin's workflow scripts into user scope.

    `~/.claude/workflows/` is user scope, so `claude plugin update` never
    touches it: without this the mirror keeps running the version that was
    current at install time against a newer skill. Sourced from the plugin cache
    rather than a downloaded release because a Claude-only update deliberately
    performs no download (``need_source`` is Cursor-only).

    Never fails the update: a missing cache or an unreadable script leaves the
    previous mirror in place, and both skills still document the `scriptPath`
    fallback that resolves inside the plugin tree.

    `install` is imported HERE, not at module scope: this script also runs from
    contexts that carry no sibling install.py (the plugin runtime surface ships
    `skills/`, `runtime/`, `context/`… while `installer/` is a release extra), and
    a missing provisioner must cost the mirror only — not every agent's update.
    """
    home = home or Path.home()
    cache_root = latest_plugin_cache_root(home)
    if cache_root is None:
        return []
    try:
        import install as install_module  # noqa: PLC0415  (deliberately lazy)

        return install_module.provision_named_workflows(cache_root, home / ".claude")
    except (ImportError, OSError, RuntimeError):
        return []


def _update_native(target_id: str, home: Path | None = None) -> None:
    for command in native_update_commands(target_id):
        _run_step(command)
    if target_id == "claude":
        refresh_claude_named_workflows(home)


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


def _update_one_agent(
    target_id: str, fresh_root: Path | None, home: Path | None = None
) -> str | None:
    """Update a single agent. Return None on success, or an error message string."""
    try:
        if target_id in COPY_TARGETS:
            _update_cursor(fresh_root)
        else:
            _update_native(target_id, home)
    except subprocess.TimeoutExpired:
        return f"timed out after {_STEP_TIMEOUT_SECONDS}s"
    except (RuntimeError, ValueError) as error:
        # ValueError surfaces an unknown native target (native_update_commands).
        # Unreachable while NATIVE_TARGETS/COPY_TARGETS stay in sync, but caught
        # here so a future drift records one failed agent instead of aborting the
        # whole batch — the entire point of this per-agent isolation.
        return str(error)
    return None


def update_agents(
    target_ids: list[str],
    *,
    fresh_root: Path | None = None,
    silent: bool = False,
    home: Path | None = None,
) -> tuple[list[str], list[str]]:
    """Update each agent: native command in place, or Cursor file-copy reinstall.

    Updates every id in *target_ids*; the caller is responsible for scoping that
    list (e.g. for --target). A failure on one agent is recorded and the rest
    continue. Returns (updated, failed) lists of target IDs.

    *home* overrides the home directory the Claude named-workflow refresh writes
    into; it exists so a test can exercise the update without touching the real
    ``~/.claude/workflows``.
    """
    updated: list[str] = []
    failed: list[str] = []

    for target_id in target_ids:
        error = _update_one_agent(target_id, fresh_root, home)
        if error is None:
            updated.append(target_id)
            if not silent:
                # NOTE: The setup wizard parses these two per-agent line formats
                # ("Updated <id>." / "ERROR updating <id>: <reason>") to render a
                # per-agent success/failure breakdown. Keep them in sync with
                # caadt-installer-service.ts#parseUpdateAgentResults in the
                # adac-setup-wizard repo if you change the wording.
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

    # --source only scopes Cursor's reinstall; native agents always track their
    # marketplace. Warn rather than silently ignore it, so a user who passed
    # --source expecting it to pin every agent isn't misled.
    if args.source is not None and not args.silent:
        native_in_scope = [tid for tid in effective if tid in NATIVE_TARGETS]
        if native_in_scope:
            print(
                f"WARNING: --source only applies to Cursor; "
                f"{', '.join(native_in_scope)} update from their marketplace to latest.",
                file=sys.stderr,
            )

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

        # `effective` is the single place the --target scope is applied;
        # update_agents updates exactly what it is handed.
        updated, failed = update_agents(
            effective,
            fresh_root=fresh_root,
            silent=args.silent,
        )
    finally:
        if work_dir is not None:
            shutil.rmtree(work_dir, ignore_errors=True)

    if not args.silent:
        if updated:
            # `version` is only ever used for this display line, so resolve the
            # fallback lazily here — this skips the latest_release_version()
            # network round-trip entirely in --silent runs and when nothing was
            # updated. (latest_release_version() returns None on any failure, so
            # this never raises.)
            if version is None:
                version = version_check.latest_release_version()
            # Report the version we updated *to*. No "from" version: the installed
            # version differs per agent and isn't reliably readable here, so a
            # "vX -> vY" delta would be misleading.
            #
            # The "to vX" suffix is only trustworthy when every updated agent
            # actually landed on `version`. `version` is the --source-pinned
            # value only when --source was given *and* a source was acquired
            # (fresh_root set); native agents ignore that source and track their
            # marketplace to *latest*, so the pinned version would misrepresent
            # them — drop the suffix only in that case. (Without --source,
            # `version` is the latest release, which is what natives get too.)
            version_is_source_pinned = args.source is not None and fresh_root is not None
            source_pinned_natives = version_is_source_pinned and any(
                tid in NATIVE_TARGETS for tid in updated
            )
            target = f" to v{version}" if version and not source_pinned_natives else ""
            print(f"\nUpdated {len(updated)} agent(s){target}: {', '.join(updated)}")
            print("Start a new agent session to load the updated version.")
        if failed:
            print(f"Failed  {len(failed)} agent(s): {', '.join(failed)}", file=sys.stderr)
            # A common, non-obvious cause is a still-running agent holding a lock
            # on its own plugin files (the raw CLI error rarely says so). Phrased
            # conditionally so it stays correct for network/timeout failures too.
            print(
                "A running agent can lock its plugin files and block the update. "
                "Close the agent(s) above and re-run this command.",
                file=sys.stderr,
            )

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Simple installer for the Creatio AI App Development Toolkit root plugin."""

from __future__ import annotations

import argparse
import functools
import json
import os
import re
import shutil
import stat
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_INSTALLER_DIR = Path(__file__).resolve().parent
if str(_INSTALLER_DIR) not in sys.path:
    sys.path.insert(0, str(_INSTALLER_DIR))

import agent_cli  # noqa: E402  (bound for test patch targets: installer.agent_cli.*)
from agent_cli import (  # noqa: E402
    MARKETPLACE_NAME,
    PLUGIN_NAME,
    PLUGIN_SOURCE,
    resolve_claude_command,
    resolve_codex_command,
    resolve_copilot_command,
)

MARKETPLACE_GIT_URL = "https://github.com/Creatio-Platform/creatio-ai-app-development-toolkit.git"
SKILL_NAME = "creatio-app-orchestrator"
NAMED_WORKFLOW_DIR_NAME = "workflows"
WORKFLOW_SCRIPT_SUFFIX = ".workflow.js"
WORKFLOW_META_NAME_PATTERN = re.compile(r"^\s*name:\s*['\"]([^'\"]+)['\"]", re.MULTILINE)
SEMVER_PATTERN = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
RELEASE_MANIFEST_FILENAME = ".release-manifest.json"
SETUP_WIZARD_MANIFEST_DIR = ".caadt"
SETUP_WIZARD_MANIFEST_FILENAME = "install-state.json"
SETUP_WIZARD_MANIFEST_ENV_VAR = "CAADT_SETUP_WIZARD_MANIFEST"
SETUP_WIZARD_AGENT_DISPLAY_NAMES = {
    "codex": ("codex", "Codex"),
    "claude": ("claude-code", "Claude Code"),
    "cursor": ("cursor", "Cursor"),
    "copilot": ("copilot", "GitHub Copilot CLI"),
}
REQUIRED_REFERENCE_PATHS = (
    "AGENTS.md",
    "context/product-telemetry.md",
    "context/INDEX.md",
    "context/business-checklist.md",
    "context/essentials.md",
    "context/naming-conventions.md",
    "context/clio-cli-reference.md",
    "context/model-discovery-evidence.md",
    "runbooks/01-environment-setup.md",
    "runbooks/02-requirements-gathering.md",
    "runbooks/03-app-implementation.md",
    "runtime/scripts/mcp_client.py",
    "runtime/scripts/workflow_validators.py",
)


@functools.lru_cache(maxsize=None)
def _load_plugin_runtime_paths_cached(manifest_path: Path) -> tuple[str, ...]:
    if not manifest_path.exists():
        raise RuntimeError(
            f"Plugin checkout is missing {RELEASE_MANIFEST_FILENAME} at {manifest_path}. "
            "This file is the canonical list of paths to install."
        )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    paths = manifest.get("plugin_runtime")
    if not isinstance(paths, list) or not all(isinstance(item, str) for item in paths):
        raise RuntimeError(
            f"{RELEASE_MANIFEST_FILENAME} must contain 'plugin_runtime' as an array of strings"
        )
    return tuple(paths)


def load_plugin_runtime_paths(repo_root: Path) -> list[str]:
    return list(_load_plugin_runtime_paths_cached(repo_root / RELEASE_MANIFEST_FILENAME))


def atomic_write_text(path: Path, content: str) -> None:
    """Write text via a sibling temp file + atomic replace.

    A crash or interruption mid-write cannot leave a truncated or corrupted
    target file: the original stays intact until os.replace swaps it in one step.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    try:
        tmp.write_text(content, encoding="utf-8")
        os.replace(tmp, path)
    finally:
        if tmp.exists():
            tmp.unlink()


def write_json(path: Path, data: Any) -> None:
    atomic_write_text(path, json.dumps(data, indent=2) + "\n")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def plugin_version(repo_root: Path) -> str:
    manifest_candidates = (
        repo_root / ".github" / "plugin" / "plugin.json",
        repo_root / ".claude-plugin" / "plugin.json",
        repo_root / ".codex-plugin" / "plugin.json",
    )
    for manifest_path in manifest_candidates:
        if not manifest_path.exists():
            continue
        manifest = read_json_file(manifest_path)
        version = manifest.get("version")
        if isinstance(version, str) and version and SEMVER_PATTERN.match(version):
            return version
    raise RuntimeError(
        "No plugin manifest with a valid semantic version was found in "
        ".github/plugin/plugin.json, .claude-plugin/plugin.json, or .codex-plugin/plugin.json"
    )


def read_json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"Could not parse JSON in {path}: {error}. "
            "Fix or remove the file (note: comments are not valid JSON) and retry."
        ) from error
    if not isinstance(data, dict):
        raise RuntimeError(f"Expected JSON object in {path}")
    return data


def toml_quote(value: str) -> str:
    return json.dumps(value)


def toml_string_array(values: list[str]) -> str:
    return "[" + ", ".join(toml_quote(value) for value in values) + "]"


def run_checked(command: list[str], **kwargs: Any) -> None:
    result = subprocess.run(command, text=True, capture_output=True, **kwargs)
    if result.returncode != 0:
        output = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"{' '.join(command)} failed: {output}")


def preflight_clio() -> str:
    clio = shutil.which("clio")
    if not clio:
        raise RuntimeError("clio was not found in PATH. Install clio or add it to PATH before installing CAADT.")
    return clio


def _clear_readonly_and_retry(func, path, _exc_info):
    """shutil.rmtree onerror callback: clear the read-only flag and retry.

    Required on Windows because `copilot plugin install` clones the marketplace
    into ~/.copilot/installed-plugins/, leaving git-packed objects (.git/objects/pack/*.idx/.pack)
    marked read-only. Default shutil.rmtree raises PermissionError on those files.
    """
    try:
        os.chmod(path, stat.S_IWRITE)
    except OSError:
        raise
    func(path)


def rmtree_force(path: Path) -> None:
    """Recursively remove path, clearing read-only flags as needed (Windows-safe)."""
    shutil.rmtree(path, onerror=_clear_readonly_and_retry)


def remove_tree_if_exists(path: Path, owner_name: str) -> None:
    if not path.exists():
        return
    try:
        rmtree_force(path)
    except PermissionError as error:
        raise RuntimeError(
            f"Could not replace {path} because it is currently in use. "
            f"Close {owner_name} and retry the installation."
        ) from error


def _marketplace_already_registered(error: RuntimeError) -> bool:
    error_text = str(error).lower()
    return (
        f'marketplace "{MARKETPLACE_NAME}" already registered' in error_text
        or f"marketplace '{MARKETPLACE_NAME}' is already added" in error_text
    )


def _marketplace_not_found(error: RuntimeError) -> bool:
    error_text = str(error).lower()
    return (
        f"marketplace '{MARKETPLACE_NAME}' not found" in error_text
        or f'marketplace "{MARKETPLACE_NAME}" not found' in error_text
        or f"no marketplace named '{MARKETPLACE_NAME}'" in error_text
        or f'no marketplace named "{MARKETPLACE_NAME}"' in error_text
        or f"marketplace `{MARKETPLACE_NAME}` is not configured or installed" in error_text
    )


def register_remote_marketplace_and_install_plugin(
    cli_command: list[str],
    marketplace_remove_flags: list[str] | None = None,
    install_verb: str = "install",
    pre_remove_marketplace: bool = False,
) -> None:
    """Register the remote marketplace and install the plugin via the host CLI.

    Used by Claude, Copilot, and Codex. Cursor stays on the local file-copy install.

    Tolerates re-runs:
    - Claude always runs `marketplace remove` first (`pre_remove_marketplace=True`)
      to migrate users off legacy directory-source entries from the file-copy era.
      Claude CLI's `plugin marketplace add` silently "updates in place" on a
      re-add instead of raising "already registered", so the conflict-driven
      retry branch below never fires for Claude — an unconditional remove is the
      only way to rebuild the entry cleanly (ENG-90475).
    - Copilot rejects re-add with "already registered" and keeps the old source;
      we remove first (with --force to detach installed plugins) on retry.
    - Codex rejects re-add with "already added from a different source"; we
      always run `marketplace remove` first (ignoring "not found") because
      Codex CLI also produces the conflict error on Windows path round-trips
      that the upstream cleanup did not normalize.

    `install_verb` is `"install"` for Claude/Copilot and `"add"` for Codex,
    matching each CLI's plugin-install subcommand name. `pre_remove_marketplace`
    converts the conflict-driven retry into an unconditional remove-then-add
    sequence — Claude and Codex both pass True so cleanup of legacy state is
    exhaustive.
    """
    marketplace_subcmd = [*cli_command, "plugin", "marketplace"]
    add_command = [*marketplace_subcmd, "add", MARKETPLACE_GIT_URL]
    install_command = [*cli_command, "plugin", install_verb, PLUGIN_SOURCE]
    remove_command = [*marketplace_subcmd, "remove", MARKETPLACE_NAME, *(marketplace_remove_flags or [])]

    if pre_remove_marketplace:
        try:
            run_checked(remove_command)
        except RuntimeError as remove_error:
            # Typical case on a fresh install: marketplace is not registered
            # yet, so `remove` exits non-zero. Swallow silently for that case
            # only — a noisy warning would alarm first-time users. Any other
            # failure (permission denied, broken CLI install, etc.) must
            # propagate so the user sees the real cause rather than a
            # downstream `marketplace add` error.
            if not _marketplace_not_found(remove_error):
                raise
        run_checked(add_command)
        run_checked(install_command)
        return

    # Conflict-driven retry path. Through install_codex, pre_remove_marketplace
    # is always True so this branch is unreachable for Codex in production; it
    # stays as a safety net (covered by unit tests) for future callers and for
    # Claude/Copilot's existing behavior.
    try:
        run_checked(add_command)
    except RuntimeError as error:
        if not _marketplace_already_registered(error):
            raise
        try:
            run_checked(remove_command)
        except RuntimeError as remove_error:
            print(f"Could not remove existing '{MARKETPLACE_NAME}' marketplace: {remove_error}")
        run_checked(add_command)
    run_checked(install_command)


def detect_targets(home: Path | None = None) -> list[dict[str, Any]]:
    """Detect locally installed coding agents to install into.

    For CLI-driven agents (Codex, Claude Code, GitHub Copilot CLI) the install
    works by driving the agent's own CLI. A home directory alone is not
    sufficient — the CLI binary must also be on PATH. A leftover ``~/.copilot``
    (or ``~/.codex`` / ``~/.claude``) whose binary is no longer on PATH is
    ignored: we have no mechanism to install into an agent we can't invoke.

    Cursor uses a file-copy install and requires no CLI binary.
    """
    home = home or Path.home()
    targets: list[dict[str, Any]] = []

    codex_home = home / ".codex"
    if codex_home.exists() and shutil.which("codex"):
        targets.append({"id": "codex", "name": "Codex", "home": codex_home})

    claude_home = home / ".claude"
    if claude_home.exists() and shutil.which("claude"):
        targets.append({"id": "claude", "name": "Claude Code", "home": claude_home})

    cursor_home = home / ".cursor"
    if cursor_home.exists():
        targets.append({"id": "cursor", "name": "Cursor", "home": cursor_home})

    copilot_home = home / ".copilot"
    if copilot_home.exists() and shutil.which("copilot"):
        targets.append({"id": "copilot", "name": "GitHub Copilot CLI", "home": copilot_home})

    return targets


def is_plugin_checkout(path: Path) -> bool:
    return (
        (path / ".claude-plugin" / "plugin.json").exists()
        and (path / ".mcp.json").exists()
        and (path / "skills").is_dir()
    )


def current_checkout_root() -> Path | None:
    script_path = Path(__file__).resolve()
    if script_path.name != "install.py" or script_path.parent.name != "installer":
        return None

    repo_root = script_path.parent.parent
    if is_plugin_checkout(repo_root):
        return repo_root
    return None


def resolve_repo_root() -> Path:
    checkout_root = current_checkout_root()
    if checkout_root is None:
        raise RuntimeError(
            "install.py must be run from a plugin checkout. "
            "Either clone the repository and run `python installer/install.py`, "
            "or extract a release zip and run `python <extracted-root>/installer/install.py`."
        )
    return checkout_root


def ensure_required_references(repo_root: Path) -> None:
    missing = [relative_path for relative_path in REQUIRED_REFERENCE_PATHS if not (repo_root / relative_path).exists()]
    if missing:
        raise RuntimeError(f"Plugin checkout is missing required reference files: {', '.join(missing)}")


def load_mcp_servers(repo_root: Path) -> dict[str, Any]:
    source = repo_root / ".mcp.json"
    if not source.exists():
        raise RuntimeError(f"MCP config not found: {source}")
    config = json.loads(source.read_text(encoding="utf-8"))
    servers = config.get("mcpServers") or config.get("mcp_servers") or config
    if not isinstance(servers, dict):
        raise RuntimeError(f"MCP config must contain a server map: {source}")
    return servers


def copy_skill_directories(repo_root: Path, target_skills_dir: Path) -> None:
    source_skills_dir = repo_root / "skills"
    if not source_skills_dir.exists():
        raise RuntimeError(f"Skills directory not found: {source_skills_dir}")

    target_skills_dir.mkdir(parents=True, exist_ok=True)
    for source_skill_dir in source_skills_dir.iterdir():
        if not source_skill_dir.is_dir() or not (source_skill_dir / "SKILL.md").exists():
            continue
        target_skill_dir = target_skills_dir / source_skill_dir.name
        if target_skill_dir.exists():
            shutil.rmtree(target_skill_dir)
        shutil.copytree(
            source_skill_dir,
            target_skill_dir,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )


def workflow_meta_name(script_path: Path) -> str:
    """Return the `meta.name` a bundled ``*.workflow.js`` declares.

    The name is read from the source instead of derived from the filename
    because the mirrored copy must agree with it: Claude Code resolves a named
    workflow from ``~/.claude/workflows/``, and which of the two identities it
    keys on (basename or ``meta.name``) is not part of any documented contract.
    Writing ``<meta.name>.js`` makes both agree, so resolution works either way.
    """
    text = script_path.read_text(encoding="utf-8")
    match = WORKFLOW_META_NAME_PATTERN.search(text)
    if not match:
        raise RuntimeError(
            f"Workflow script declares no `meta.name`, so it cannot be provisioned "
            f"as a named workflow: {script_path}"
        )
    return match.group(1)


def discover_workflow_scripts(source_root: Path) -> list[Path]:
    """Bundled ``skills/*/**.workflow.js`` scripts, sorted for a stable order."""
    skills_dir = source_root / "skills"
    if not skills_dir.is_dir():
        return []
    return sorted(skills_dir.glob(f"*/*{WORKFLOW_SCRIPT_SUFFIX}"))


def provision_named_workflows(source_root: Path, claude_home: Path) -> list[str]:
    """Mirror bundled workflow scripts into user scope as NAMED workflows.

    The marketplace ships skills, agents and MCP servers — it cannot register a
    named workflow, so a skill can otherwise only reach its own orchestration
    through `Workflow({ scriptPath })` with a hand-resolved absolute path into
    the versioned plugin cache. Copying each script to
    ``~/.claude/workflows/<meta.name>.js`` makes `Workflow({ name })` work
    instead, which is the same convention the `creatio-development` plugin uses.

    This is a MIRROR, not a second source: it is rewritten on every install and
    on every Claude update, because the plugin itself auto-updates and a stale
    user-scope copy would run an older `args` contract against a newer skill.
    That is also why both skills keep `scriptPath` documented as the fallback —
    the in-tree script is version-matched by construction, and user-scope
    discovery only happens at session start, so a freshly provisioned workflow
    is not resolvable by name until the next session.

    Returns the provisioned workflow names. A source tree without workflow
    scripts provisions nothing rather than failing — not every checkout or
    release the installer runs against bundles one.
    """
    scripts = discover_workflow_scripts(source_root)
    if not scripts:
        return []

    workflows_dir = claude_home / NAMED_WORKFLOW_DIR_NAME
    workflows_dir.mkdir(parents=True, exist_ok=True)
    provisioned: list[str] = []
    for script in scripts:
        name = workflow_meta_name(script)
        shutil.copyfile(script, workflows_dir / f"{name}.js")
        provisioned.append(name)
    return provisioned


def copy_plugin_runtime_surface(repo_root: Path, target_dir: Path) -> None:
    """Copy only the files needed by installed agent plugins."""
    target_dir.mkdir(parents=True, exist_ok=True)
    for relative_path in load_plugin_runtime_paths(repo_root):
        source = repo_root / relative_path
        if not source.exists():
            continue
        target = target_dir / relative_path
        if source.is_dir():
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(
                source,
                target,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
            )
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)


def merge_mcp_config(repo_root: Path, target_path: Path) -> None:
    """Merge mcpServers from the plugin's .mcp.json into a shared MCP config file."""
    source = repo_root / ".mcp.json"
    if not source.exists():
        raise RuntimeError(f"MCP config not found: {source}")

    incoming = json.loads(source.read_text(encoding="utf-8"))
    incoming_servers = incoming.get("mcpServers", {}) or {}

    if target_path.exists():
        existing = json.loads(target_path.read_text(encoding="utf-8-sig")) or {}
    else:
        existing = {}

    existing_servers = existing.get("mcpServers", {}) or {}
    for server_name, server_config in incoming_servers.items():
        if server_name in existing_servers:
            print(f"Skipped existing MCP server '{server_name}' in {target_path}")
            continue
        existing_servers[server_name] = server_config
    existing["mcpServers"] = existing_servers
    write_json(target_path, existing)


def codex_mcp_server_exists(config_text: str, server_name: str) -> bool:
    table_names = [
        f"[mcp_servers.{server_name}]",
        f"[mcp_servers.{toml_quote(server_name)}]",
    ]
    return any(table_name in config_text for table_name in table_names)


def merge_codex_mcp_config(repo_root: Path, target_path: Path) -> None:
    servers = load_mcp_servers(repo_root)
    clio = servers.get("clio")
    if not isinstance(clio, dict):
        raise RuntimeError("MCP config is missing the 'clio' server")
    command = clio.get("command")
    if not isinstance(command, str) or not command:
        raise RuntimeError("MCP config for 'clio' must define a command")
    args = clio.get("args", [])
    if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
        raise RuntimeError("MCP config for 'clio' args must be a string array")

    target_path.parent.mkdir(parents=True, exist_ok=True)
    existing = target_path.read_text(encoding="utf-8") if target_path.exists() else ""
    if codex_mcp_server_exists(existing, "clio"):
        print(f"Skipped existing Codex MCP server 'clio' in {target_path}")
        return

    block = (
        "\n"
        "# Added by CAADT installer.\n"
        "[mcp_servers.clio]\n"
        f"command = {toml_quote(command)}\n"
        f"args = {toml_string_array(args)}\n"
        "enabled = true\n"
    )
    separator = "" if not existing or existing.endswith("\n") else "\n"
    target_path.write_text(existing + separator + block, encoding="utf-8")


def remove_personal_marketplace_creatio_entry(catalog_path: Path, marketplace_name: str) -> None:
    """Strip the creatio shadow from ~/.agents/plugins/marketplace.json.

    The old file-copy install_codex wrote a personal-marketplace catalog at this
    path so Codex could resolve the local-path plugin source. Codex CLI prefers
    that file over the freshly-cloned git marketplace of the same name, which
    breaks `codex plugin add`. We strip the plugin entry; if no plugin entries
    remain and the catalog still self-identifies as the installer-managed
    `creatio` catalog (`name == marketplace_name`), the whole file is deleted —
    any top-level keys the user customized on the installer-managed catalog
    (e.g. `interface.displayName`) go with it. In practice this file was
    installer-managed end-to-end before ENG-90514, so that loss is acceptable;
    a user-curated catalog with a different `name` field always keeps its
    other plugins and metadata intact.
    """
    if not catalog_path.exists():
        return
    catalog = read_json_file(catalog_path)
    plugins = catalog.get("plugins")
    if not isinstance(plugins, list):
        if catalog.get("name") == marketplace_name:
            catalog_path.unlink()
            return
        raise RuntimeError(f"'plugins' must be a list in {catalog_path}")

    filtered = [
        plugin for plugin in plugins
        if not (isinstance(plugin, dict) and plugin.get("name") == PLUGIN_NAME)
    ]
    if filtered == plugins:
        return

    if not filtered and catalog.get("name") == marketplace_name:
        catalog_path.unlink()
        return

    catalog["plugins"] = filtered
    write_json(catalog_path, catalog)


def enable_claude_marketplace_auto_update(settings_path: Path) -> None:
    """Set autoUpdate=true on the Claude marketplace entry written by `claude plugin marketplace add`.

    Leaves the CLI-managed `source` field alone. If a stale `directory` source is found
    (left over from a previous local-install run), drop it so the CLI's git source wins.
    """
    settings = read_json_file(settings_path)
    extra = settings.setdefault("extraKnownMarketplaces", {})
    if not isinstance(extra, dict):
        raise RuntimeError(f"extraKnownMarketplaces must be an object in {settings_path}")
    entry = extra.get(MARKETPLACE_NAME)
    if not isinstance(entry, dict):
        entry = {}
    stale_source = entry.get("source")
    if isinstance(stale_source, dict) and stale_source.get("source") == "directory":
        entry.pop("source", None)
    entry["autoUpdate"] = True
    extra[MARKETPLACE_NAME] = entry
    write_json(settings_path, settings)


# TOML standard table headers: `[name]` and `[[name]]`. Names are dotted
# segments; each segment is either a bare key (ASCII letters/digits/_/-) or a
# quoted string. This regex matches the whole stripped line — it must be the
# only thing on the line, optionally followed by trailing whitespace or a
# comment. Used by both `_remove_toml_table_block` and
# `remove_codex_skill_config_override` to find the end of a removable block
# without false-matching on lines like a multi-line array's `[`.
_TOML_TABLE_HEADER_RE = re.compile(
    r'^(?P<header>\[{1,2}'                                 # opening [ or [[
    r'(?:[A-Za-z0-9_\-]+|"(?:[^"\\]|\\.)*"|\'[^\']*\')'    # first segment: bare | "double" | 'literal'
    r'(?:\.(?:[A-Za-z0-9_\-]+|"(?:[^"\\]|\\.)*"|\'[^\']*\'))*'  # .segment ...
    r'\]{1,2})'                                            # closing
    r'\s*(?:#.*)?$'                                        # trailing whitespace + optional comment
)


def _toml_table_header_marker(line: str) -> str | None:
    """Return the table header marker for a TOML header line, excluding comments."""
    match = _TOML_TABLE_HEADER_RE.match(line.strip())
    if not match:
        return None
    return match.group("header")


def remove_codex_skill_config_override(target_path: Path, skill_name: str) -> None:
    """Drop explicit Codex skill overrides for the CAADT skill."""
    if not target_path.exists():
        return

    lines = target_path.read_text(encoding="utf-8").splitlines(keepends=True)
    updated: list[str] = []
    index = 0
    changed = False
    while index < len(lines):
        if _toml_table_header_marker(lines[index]) != "[[skills.config]]":
            updated.append(lines[index])
            index += 1
            continue

        end = index + 1
        while end < len(lines) and not _TOML_TABLE_HEADER_RE.match(lines[end].strip()):
            end += 1
        block = lines[index:end]
        block_text = "".join(block)
        if f'name = "{skill_name}"' in block_text:
            changed = True
        else:
            updated.extend(block)
        index = end

    if changed:
        target_path.write_text("".join(updated), encoding="utf-8")


def _remove_toml_table_block(config_path: Path, table_markers: tuple[str, ...]) -> None:
    """Remove a top-level TOML table block whose header matches one of the markers.

    Block extends from the matching header line up to (but not including) the
    next line that is itself a valid TOML table header — not just any line
    starting with `[`. This matters because a multi-line array literal
    (`foo = [`, `  "x",`, `]`) or an inline-table-in-array value also begins
    a line with `[`, and the earlier heuristic would treat that as a new
    table and leak orphaned value lines into config.toml. Comments, blank
    lines, and scalar values inside the matched block are all dropped.
    """
    if not config_path.exists():
        return
    lines = config_path.read_text(encoding="utf-8").splitlines(keepends=True)
    updated: list[str] = []
    index = 0
    changed = False
    while index < len(lines):
        if _toml_table_header_marker(lines[index]) in table_markers:
            end = index + 1
            while end < len(lines) and not _TOML_TABLE_HEADER_RE.match(lines[end].strip()):
                end += 1
            changed = True
            index = end
            continue
        updated.append(lines[index])
        index += 1

    if changed:
        config_path.write_text("".join(updated), encoding="utf-8")


def remove_codex_marketplace_section(config_path: Path, marketplace_name: str) -> None:
    """Remove a legacy `[marketplaces.<name>]` block from Codex's config.toml.

    Old file-copy install_codex wrote this block pointing at a local-path
    marketplace dir. Leaving it in place blocks `codex plugin marketplace add`
    from registering the git source.
    """
    markers = (
        f"[marketplaces.{marketplace_name}]",
        f"[marketplaces.{toml_quote(marketplace_name)}]",
    )
    _remove_toml_table_block(config_path, markers)


def remove_codex_plugin_section(config_path: Path, plugin_name: str, marketplace_name: str) -> None:
    """Remove a legacy `[plugins."<plugin>@<marketplace>"]` block from config.toml.

    The old file-copy install_codex registered the plugin as
    `[plugins."creatio-ai-app-development-toolkit@creatio"]`. After migration
    the new install path is the only authoritative registration.
    """
    plugin_key = f"{plugin_name}@{marketplace_name}"
    markers = (f"[plugins.{toml_quote(plugin_key)}]",)
    _remove_toml_table_block(config_path, markers)


def repo_file(repo_root: Path, relative_path: str) -> str:
    # Render forward-slash paths so the agent load order stays consistent and
    # portable across hosts. Windows accepts forward slashes for reads, and the
    # rest of the toolkit references paths this way, so an absolute install path
    # like `D:/…/runbooks/03-app-implementation.md` reads the same everywhere.
    return (repo_root / relative_path).as_posix()


def render_analytics_context(repo_root: Path, coding_agent: str) -> str:
    """Static Analytics Context block for CAADT product telemetry.

    `plugin_version` resolves from the plugin manifest copied into the install
    surface; it falls back to "unknown" when no manifest is present so rendering
    never fails mid-install.
    """
    try:
        version = plugin_version(repo_root)
    except RuntimeError:
        version = "unknown"
    return (
        "## Analytics Context\n"
        "\n"
        "Use these values for CAADT product telemetry when calling clio telemetry tools:\n"
        "\n"
        f"- `coding_agent`: {coding_agent}\n"
        f"- `plugin_version`: {version}\n"
        "\n"
    )


def render_load_order(repo_root: Path) -> str:
    return (
        f"1. Read `{repo_file(repo_root, 'AGENTS.md')}` for the active orchestration contract.\n"
        f"2. Read `{repo_file(repo_root, 'context/product-telemetry.md')}` for telemetry consent, event checkpoints, and payload shape.\n"
        f"3. Read `{repo_file(repo_root, 'context/INDEX.md')}` to choose the smallest relevant reference set.\n"
        f"4. For environment setup, read `{repo_file(repo_root, 'runbooks/01-environment-setup.md')}`.\n"
        f"5. For requirements gathering, read `{repo_file(repo_root, 'runbooks/02-requirements-gathering.md')}`.\n"
        f"6. For post-Gate-R implementation and scaffolding (including the transient section-creation "
        f"failure playbook), read `{repo_file(repo_root, 'runbooks/03-app-implementation.md')}`.\n"
        f"7. For executable helper behavior, use `{repo_file(repo_root, 'runtime/scripts/mcp_client.py')}` "
        f"and `{repo_file(repo_root, 'runtime/scripts/workflow_validators.py')}`.\n"
    )


def render_cursor_rule(repo_root: Path, mcp_config_path: Path) -> str:
    """Build a Cursor .mdc rule body that points at the installed repo."""
    return (
        "---\n"
        "description: Use when creating Creatio app Business Plans, "
        "technical implementation handoffs, or applying the approved plan through clio MCP.\n"
        "alwaysApply: false\n"
        "---\n"
        "\n"
        f"# Creatio App Orchestrator\n"
        "\n"
        "Entrypoint for the Creatio AI App Development Toolkit (CAADT) workflow.\n"
        "\n"
        f"Toolkit repository is installed at: `{repo_root}`\n"
        "\n"
        "## Load Order\n"
        "\n"
        f"{render_load_order(repo_root)}"
        "\n"
        f"{render_analytics_context(repo_root, 'Cursor')}"
        "## Core Rules\n"
        "\n"
        "- Pages are separate for web and mobile: before any page edit, read `context/essentials.md` (Freedom UI — Mobile Pages) and target web, mobile, or both as the requirement needs. Required even in autonomous/pre-approved runs.\n"
        "- Keep the visible planning artifact in the BA-style Business Plan format defined by `AGENTS.md`.\n"
        "- Follow `context/product-telemetry.md` for CAADT product telemetry; use the Analytics Context values when calling clio telemetry tools.\n"
        "- Resolve executable clio MCP tool contracts through `get-tool-contract`; do not invent payload shapes.\n"
        f"- The `clio` MCP server is registered in `{mcp_config_path}`.\n"
    )


def install_codex(repo_root: Path, home: Path) -> None:
    """Install Codex via the remote marketplace (parity with install_claude).

    Migration cleanup runs first so users coming from the legacy file-copy install
    end up in the same state as a fresh install. The clio MCP block stays in
    `config.toml` because Codex CLI does not auto-promote plugin-bundled MCP
    declarations to user-level `[mcp_servers.*]` entries.
    """
    ensure_required_references(repo_root)
    codex_home = home / ".codex"

    # On-disk artifacts left by the old file-copy install_codex.
    remove_tree_if_exists(codex_home / "plugins" / "marketplaces" / MARKETPLACE_NAME, "Codex")
    remove_tree_if_exists(codex_home / "plugins" / "cache" / MARKETPLACE_NAME, "Codex")
    remove_tree_if_exists(home / ".agents" / "plugins" / PLUGIN_NAME, "Codex")
    remove_tree_if_exists(codex_home / "skills" / SKILL_NAME, "Codex")

    # Personal-marketplace catalog shadow (P5) — Codex CLI prefers this file
    # over the freshly-cloned git marketplace of the same name when it exists.
    remove_personal_marketplace_creatio_entry(
        home / ".agents" / "plugins" / "marketplace.json", MARKETPLACE_NAME
    )

    # config.toml leftovers from the file-copy install. Leave [mcp_servers.clio]
    # alone — merge_codex_mcp_config re-merges it below.
    config_path = codex_home / "config.toml"
    remove_codex_marketplace_section(config_path, MARKETPLACE_NAME)
    remove_codex_plugin_section(config_path, PLUGIN_NAME, MARKETPLACE_NAME)
    remove_codex_skill_config_override(config_path, f"{PLUGIN_NAME}:{SKILL_NAME}")

    register_remote_marketplace_and_install_plugin(
        resolve_codex_command(),
        marketplace_remove_flags=[],
        install_verb="add",
        pre_remove_marketplace=True,
    )

    merge_codex_mcp_config(repo_root, config_path)


def install_claude(repo_root: Path, home: Path) -> None:
    """Install Claude via the remote marketplace.

    `pre_remove_marketplace=True` is required to migrate users off legacy
    `directory`-source marketplace entries from the old file-copy install:
    Claude CLI's `plugin marketplace add` silently "updates in place" on a
    re-add instead of raising "already registered", so the conflict-driven
    retry path never fires. The legacy absolute `installLocation` survives
    in `known_marketplaces.json`, and a later `plugin install` joins the
    staging `temp_<ts>` dir with that absolute path, producing the
    `Marketplace file not found at .../temp_<ts>/<abs-legacy-path>` error
    surfaced in `/plugins → Errors` (ENG-90475 comments 448799, 449177;
    upstream anthropics/claude-code#36245). An unconditional remove-then-add
    rebuilds the entry cleanly on every run and makes migration idempotent.
    """
    ensure_required_references(repo_root)
    claude_home = home / ".claude"
    claude_command = resolve_claude_command()
    register_remote_marketplace_and_install_plugin(
        claude_command,
        pre_remove_marketplace=True,
    )
    enable_claude_marketplace_auto_update(claude_home / "settings.json")
    # Named workflows are user scope, not plugin scope — the marketplace install
    # above cannot register them, so mirror them here (see
    # provision_named_workflows). Claude-only: no other agent reads this dir.
    provision_named_workflows(repo_root, claude_home)


def install_cursor(repo_root: Path, home: Path) -> None:
    cursor_home = home / ".cursor"
    local_plugin_dir = cursor_home / "plugins" / "local" / PLUGIN_NAME
    remove_tree_if_exists(local_plugin_dir, "Cursor")
    copy_plugin_runtime_surface(repo_root, local_plugin_dir)
    mcp_config_path = cursor_home / "mcp.json"
    merge_mcp_config(repo_root, mcp_config_path)
    rules_dir = cursor_home / "rules"
    rules_dir.mkdir(parents=True, exist_ok=True)
    rule_path = rules_dir / f"{SKILL_NAME}.mdc"
    rule_path.write_text(render_cursor_rule(local_plugin_dir, mcp_config_path), encoding="utf-8")


def install_copilot(repo_root: Path, home: Path) -> None:
    ensure_required_references(repo_root)
    remove_tree_if_exists(home / ".agents" / "plugins" / PLUGIN_NAME, "GitHub Copilot CLI")
    remove_tree_if_exists(home / ".agents" / "skills" / SKILL_NAME, "GitHub Copilot CLI")
    # Legacy file-copy installs rendered a standalone skill with machine-specific
    # absolute paths into ~/.copilot/skills/. The native marketplace install loads
    # the skill from the registered plugin cache_path (~/.copilot/installed-plugins),
    # so this copy is an orphan that shadows the maintained source on stale machines.
    remove_tree_if_exists(home / ".copilot" / "skills" / SKILL_NAME, "GitHub Copilot CLI")
    copilot_command = resolve_copilot_command()
    register_remote_marketplace_and_install_plugin(
        copilot_command,
        marketplace_remove_flags=["--force"],
    )


def write_setup_wizard_manifest(
    repo_root: Path,
    installed_target_ids: list[str],
    home: Path | None = None,
) -> Path:
    """Write the handoff manifest that the CAADT Setup Wizard reads on success.

    The wizard opts into this handoff with CAADT_SETUP_WIZARD_MANIFEST=1,
    reads ~/.caadt/install-state.json to learn which coding agents install.py
    registered with, then deletes the file. The manifest is a one-shot
    handoff, not persistent state.
    """
    home = home or Path.home()
    manifest_dir = home / SETUP_WIZARD_MANIFEST_DIR
    manifest_path = manifest_dir / SETUP_WIZARD_MANIFEST_FILENAME

    agents = []
    for target_id in installed_target_ids:
        mapping = SETUP_WIZARD_AGENT_DISPLAY_NAMES.get(target_id)
        if mapping is None:
            continue
        manifest_id, display_name = mapping
        agents.append({"id": manifest_id, "displayName": display_name})

    payload: dict[str, Any] = {
        "version": plugin_version(repo_root),
        "installedAt": now_iso(),
        "agents": agents,
    }
    write_json(manifest_path, payload)
    return manifest_path


def should_write_setup_wizard_manifest(env: dict[str, str] | None = None) -> bool:
    env = os.environ if env is None else env
    value = env.get(SETUP_WIZARD_MANIFEST_ENV_VAR, "")
    return value.strip().lower() in {"1", "true", "yes"}


_INSTALLERS: dict[str, Any] = {
    "codex": install_codex,
    "claude": install_claude,
    "cursor": install_cursor,
    "copilot": install_copilot,
}


def _install_one(repo_root: Path, target: dict[str, Any]) -> bool:
    """Dispatch to the per-agent installer. Returns False for unknown target ids."""
    installer_fn = _INSTALLERS.get(target["id"])
    if installer_fn is None:
        # detect_targets only ever emits ids present in _INSTALLERS, so this is
        # defensive. Warn rather than silently drop, otherwise a future agent
        # added to detection but not to _INSTALLERS would vanish without trace.
        print(f"WARNING: no installer registered for target {target['id']!r}", file=sys.stderr)
        return False
    home = target["home"].parent
    installer_fn(repo_root, home)
    return True


def install_for_targets(
    repo_root: Path, targets: list[dict[str, Any]], selected: str | None = None
) -> tuple[list[str], list[tuple[str, str]]]:
    """Install the plugin into each target, isolating per-target failures.

    Returns ``(installed_ids, failed)`` where ``failed`` is a list of
    ``(target_id, error_message)`` tuples for auto-detected targets whose
    install raised.

    Targets are auto-detected by the presence of their agent home directory
    (``~/.codex``, ``~/.claude``, ``~/.cursor``, ``~/.copilot``), but every
    target except Cursor installs by driving that agent's own CLI, which must
    be on PATH. A leftover home directory whose CLI is gone (e.g. ``~/.copilot``
    surviving an ``npm uninstall -g`` or a PATH change) therefore raises during
    install. Cursor and the CLI-driven agents also touch the filesystem
    (copying the plugin surface, rewriting MCP config), which can raise
    ``OSError``/``PermissionError`` on locked or read-only files. Either failure
    on an auto-detected target is isolated: it is recorded in ``failed``, a
    warning is printed, and the remaining targets still install. One
    un-installable optional agent must not abort the whole run.

    When a single target is explicitly requested via ``selected`` (the
    ``--target`` flag), a failure is re-raised so the run exits non-zero — the
    user asked for exactly that agent, so silently skipping it would be wrong.
    An explicitly requested target that was never detected (its home directory
    or CLI is missing, so ``detect_targets`` dropped it) is likewise a hard
    error: the run raises rather than reporting a misleading success.
    """
    installed: list[str] = []
    failed: list[tuple[str, str]] = []
    for target in targets:
        if selected and target["id"] != selected:
            continue
        try:
            if not _install_one(repo_root, target):
                continue
        except (RuntimeError, OSError) as error:
            if selected:
                raise  # explicit --target: fail hard
            print(f"WARNING: skipping {target['name']} — {error}", file=sys.stderr)
            failed.append((target["id"], str(error)))
            continue
        installed.append(target["id"])
    if selected and not installed and not failed:
        # Explicit --target for an agent that detect_targets did not return
        # (home dir absent, or the agent's CLI is not on PATH). The user asked
        # for exactly this agent; exiting 0 here would be a misleading success.
        raise RuntimeError(
            f"requested target {selected!r} is not available "
            "(home directory missing, or its CLI is not on PATH)"
        )
    return installed, failed


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Install Creatio AI App Development Toolkit plugin.")
    parser.add_argument(
        "--target",
        choices=["codex", "claude", "cursor", "copilot"],
        help="Install only one target.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    installed: list[str] = []
    failed: list[tuple[str, str]] = []
    manifest_path: Path | None = None
    try:
        preflight_clio()
        repo_root = resolve_repo_root()
        targets = detect_targets()
        installed, failed = install_for_targets(repo_root, targets, args.target)
        manifest_path = (
            write_setup_wizard_manifest(repo_root, installed)
            if should_write_setup_wizard_manifest()
            else None
        )
    except RuntimeError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    if installed:
        print(f"Installed {PLUGIN_NAME} for: {', '.join(installed)}")
    elif failed:
        # Every detected target failed (e.g. leftover agent home directories
        # whose CLIs are no longer on PATH). Report non-zero so the wizard
        # surfaces the failure instead of a misleading "nothing to do" success.
        print("No coding agents were installed; all detected targets failed.", file=sys.stderr)
    else:
        print("No supported local coding agents were detected.")

    if failed:
        # Per-target reasons were already printed as WARNING lines inside
        # install_for_targets; this is just the consolidated summary.
        skipped = ", ".join(target_id for target_id, _ in failed)
        print(f"Skipped (install failed): {skipped}", file=sys.stderr)

    if manifest_path is not None:
        print(f"Wrote setup wizard manifest: {manifest_path}")

    return 0 if installed or not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Simple installer for the Creatio AI App Development Toolkit root plugin."""

from __future__ import annotations

import argparse
import copy
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


PLUGIN_NAME = "creatio-ai-app-development-toolkit"
MARKETPLACE_NAME = "creatio"
SKILL_NAME = "creatio-app-orchestrator"
SEMVER_PATTERN = re.compile(r"^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$")
RELEASE_MANIFEST_FILENAME = ".release-manifest.json"
REQUIRED_REFERENCE_PATHS = (
    "AGENTS.md",
    "context/INDEX.md",
    "context/business-checklist.md",
    "context/essentials.md",
    "context/naming-conventions.md",
    "context/clio-cli-reference.md",
    "context/model-discovery-evidence.md",
    "runbooks/01-environment-setup.md",
    "runbooks/02-requirements-gathering.md",
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


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


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
    data = json.loads(path.read_text(encoding="utf-8-sig"))
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
        raise RuntimeError("clio was not found in PATH. Install clio or add it to PATH before installing ADAC.")
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


def preflight_copilot() -> str:
    copilot = shutil.which("copilot")
    if not copilot:
        raise RuntimeError(
            "copilot was not found in PATH. Install GitHub Copilot CLI or add it to PATH before installing ADAC."
        )
    return copilot


def resolve_copilot_command() -> list[str]:
    copilot = preflight_copilot()
    copilot_path = Path(copilot)
    if copilot_path.suffix.lower() == ".ps1":
        return ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(copilot_path)]
    return [copilot]


def detect_targets(home: Path | None = None) -> list[dict[str, Any]]:
    home = home or Path.home()
    targets: list[dict[str, Any]] = []

    codex_home = home / ".codex"
    if codex_home.exists():
        targets.append({"id": "codex", "name": "Codex", "home": codex_home})

    claude_home = home / ".claude"
    if claude_home.exists():
        targets.append({"id": "claude", "name": "Claude Code", "home": claude_home})

    cursor_home = home / ".cursor"
    if cursor_home.exists():
        targets.append({"id": "cursor", "name": "Cursor", "home": cursor_home})

    copilot_home = home / ".copilot"
    if copilot_home.exists():
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


def copy_mcp_config(repo_root: Path, target_path: Path) -> None:
    source = repo_root / ".mcp.json"
    if not source.exists():
        raise RuntimeError(f"MCP config not found: {source}")
    target_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target_path)


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


def prune_directory_entries(target_dir: Path, allowed_names: set[str], label: str | None = None) -> None:
    """Remove top-level entries that are not part of the managed installation surface."""
    if not target_dir.exists():
        return
    for entry in target_dir.iterdir():
        if entry.name in allowed_names:
            continue
        if label:
            print(f"Pruned {entry} from {label}")
        if entry.is_dir():
            rmtree_force(entry)
        else:
            try:
                entry.unlink()
            except PermissionError:
                # Read-only file (e.g. from a git clone on Windows)
                os.chmod(entry, stat.S_IWRITE)
                entry.unlink()


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
        "# Added by ADAC installer.\n"
        "[mcp_servers.clio]\n"
        f"command = {toml_quote(command)}\n"
        f"args = {toml_string_array(args)}\n"
        "enabled = true\n"
    )
    separator = "" if not existing or existing.endswith("\n") else "\n"
    target_path.write_text(existing + separator + block, encoding="utf-8")


def merge_personal_marketplace_catalog(repo_root: Path, home: Path) -> None:
    target_path = home / ".agents" / "plugins" / "marketplace.json"
    source_path = repo_root / ".agents" / "plugins" / "marketplace.json"
    if not source_path.exists():
        return

    existing = read_json_file(target_path)
    source = read_json_file(source_path)

    plugins = existing.setdefault("plugins", [])
    if not isinstance(plugins, list):
        raise RuntimeError(f"plugins must be an array in {target_path}")
    existing_by_name = {
        plugin.get("name"): plugin
        for plugin in plugins
        if isinstance(plugin, dict) and isinstance(plugin.get("name"), str)
    }

    for plugin in source.get("plugins", []):
        if not isinstance(plugin, dict):
            continue
        plugin_name = plugin.get("name")
        if not isinstance(plugin_name, str):
            continue
        # Home-local Codex marketplaces expect plugin paths under ~/.agents/plugins/<plugin-name>.
        plugin_copy = copy.deepcopy(plugin)
        source_config = plugin_copy.get("source")
        if isinstance(source_config, dict) and source_config.get("source") == "local":
            source_config["path"] = f"./plugins/{plugin_name}"
        if plugin_name in existing_by_name:
            existing_plugin = existing_by_name[plugin_name]
            existing_plugin.clear()
            existing_plugin.update(plugin_copy)
        else:
            plugins.append(plugin_copy)
            existing_by_name[plugin_name] = plugin_copy

    if not isinstance(existing.get("name"), str) or not existing["name"].strip():
        existing["name"] = source.get("name") or "personal-marketplace"
    existing_interface = existing.get("interface")
    if not isinstance(existing_interface, dict):
        existing["interface"] = source.get("interface") or {"displayName": "Personal Marketplace"}
    elif not isinstance(existing_interface.get("displayName"), str) or not existing_interface["displayName"].strip():
        source_interface = source.get("interface")
        if isinstance(source_interface, dict) and isinstance(source_interface.get("displayName"), str):
            existing_interface["displayName"] = source_interface["displayName"]

    write_json(target_path, existing)


def write_codex_marketplace_catalog(repo_root: Path, marketplace_root: Path) -> None:
    source_path = repo_root / ".agents" / "plugins" / "marketplace.json"
    if not source_path.exists():
        return

    source = read_json_file(source_path)
    plugins = source.get("plugins", [])
    if not isinstance(plugins, list):
        raise RuntimeError(f"plugins must be an array in {source_path}")

    catalog_plugins = []
    for plugin in plugins:
        if not isinstance(plugin, dict):
            continue
        plugin_name = plugin.get("name")
        if not isinstance(plugin_name, str) or not plugin_name:
            continue
        plugin_copy = copy.deepcopy(plugin)
        source_config = plugin_copy.get("source")
        if isinstance(source_config, dict) and source_config.get("source") == "local":
            source_config["path"] = f"./plugins/{plugin_name}"
        catalog_plugins.append(plugin_copy)

    catalog = {
        "name": source.get("name") or MARKETPLACE_NAME,
        "interface": source.get("interface") or {"displayName": MARKETPLACE_NAME.title()},
        "plugins": catalog_plugins,
    }
    write_json(marketplace_root / ".agents" / "plugins" / "marketplace.json", catalog)


def merge_codex_marketplace_config(
    marketplace_name: str,
    marketplace_dir: Path,
    plugin_name: str,
    target_path: Path,
) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    existing = target_path.read_text(encoding="utf-8") if target_path.exists() else ""

    marketplace_marker = f"[marketplaces.{marketplace_name}]"
    if marketplace_marker not in existing:
        source_path = str(marketplace_dir.resolve())
        if sys.platform.startswith("win"):
            source_path = "\\\\?\\" + source_path
        block = (
            "\n"
            f"{marketplace_marker}\n"
            'last_updated = "installed-by-adac"\n'
            'source_type = "local"\n'
            f"source = {toml_quote(source_path)}\n"
        )
        separator = "" if not existing or existing.endswith("\n") else "\n"
        existing = existing + separator + block

    plugin_key = f'{plugin_name}@{marketplace_name}'
    plugin_marker = f'[plugins.{toml_quote(plugin_key)}]'
    if plugin_marker not in existing:
        block = (
            "\n"
            f"{plugin_marker}\n"
            "enabled = true\n"
        )
        separator = "" if not existing or existing.endswith("\n") else "\n"
        existing = existing + separator + block

    target_path.write_text(existing, encoding="utf-8")


def merge_claude_plugin_settings(marketplace_dir: Path, target_path: Path) -> None:
    settings = read_json_file(target_path)
    extra_marketplaces = settings.setdefault("extraKnownMarketplaces", {})
    if not isinstance(extra_marketplaces, dict):
        raise RuntimeError(f"extraKnownMarketplaces must be an object in {target_path}")
    extra_marketplaces[MARKETPLACE_NAME] = {
        "source": {
            "source": "directory",
            "path": str(marketplace_dir),
        }
    }

    enabled_plugins = settings.setdefault("enabledPlugins", {})
    if not isinstance(enabled_plugins, dict):
        raise RuntimeError(f"enabledPlugins must be an object in {target_path}")
    enabled_plugins[f"{PLUGIN_NAME}@{MARKETPLACE_NAME}"] = True
    write_json(target_path, settings)


def register_claude_known_marketplace(marketplace_dir: Path, target_path: Path) -> None:
    known = read_json_file(target_path)
    known[MARKETPLACE_NAME] = {
        "source": {
            "source": "directory",
            "path": str(marketplace_dir),
        },
        "installLocation": str(marketplace_dir),
        "lastUpdated": now_iso(),
    }
    write_json(target_path, known)


def register_claude_installed_plugin(cache_dir: Path, target_path: Path, version: str) -> None:
    installed = read_json_file(target_path)
    plugin_key = f"{PLUGIN_NAME}@{MARKETPLACE_NAME}"

    installed_version = installed.get("version")
    if installed and installed_version is not None and installed_version != 2:
        raise RuntimeError(
            f"Unsupported Claude installed_plugins.json version in {target_path}: {installed_version!r}. "
            "Expected version 2."
        )
    if installed_version != 2:
        installed = {"version": 2, "plugins": {}}

    plugins = installed.setdefault("plugins", {})
    existing_entries = plugins.get(plugin_key, [])
    installed_at = now_iso()
    if existing_entries and isinstance(existing_entries, list) and len(existing_entries) > 0:
        first_entry = existing_entries[0]
        if isinstance(first_entry, dict):
            installed_at = first_entry.get("installedAt", installed_at)

    plugins[plugin_key] = [
        {
            "scope": "user",
            "installPath": str(cache_dir),
            "version": version,
            "installedAt": installed_at,
            "lastUpdated": now_iso(),
        }
    ]
    write_json(target_path, installed)


def repo_file(repo_root: Path, relative_path: str) -> Path:
    return repo_root / relative_path


def render_load_order(repo_root: Path) -> str:
    return (
        f"1. Read `{repo_file(repo_root, 'AGENTS.md')}` for the active orchestration contract.\n"
        f"2. Read `{repo_file(repo_root, 'context/INDEX.md')}` to choose the smallest relevant reference set.\n"
        f"3. For environment setup, read `{repo_file(repo_root, 'runbooks/01-environment-setup.md')}`.\n"
        f"4. For requirements gathering, read `{repo_file(repo_root, 'runbooks/02-requirements-gathering.md')}`.\n"
        f"5. For executable helper behavior, use `{repo_file(repo_root, 'runtime/scripts/mcp_client.py')}` "
        f"and `{repo_file(repo_root, 'runtime/scripts/workflow_validators.py')}`.\n"
    )


def _render_skill_body(repo_root: Path, mcp_config_path: Path) -> str:
    """Shared skill body for Codex and Copilot targets."""
    return (
        "---\n"
        f"name: {SKILL_NAME}\n"
        "description: Use when creating Creatio app Business Plans, "
        "technical implementation handoffs, or applying the approved plan through clio MCP.\n"
        "---\n"
        "\n"
        "# Creatio App Orchestrator\n"
        "\n"
        "Use this skill as the entrypoint for ADAC workflows.\n"
        "\n"
        f"Toolkit repository is installed at: `{repo_root}`\n"
        "\n"
        "## Load Order\n"
        "\n"
        f"{render_load_order(repo_root)}"
        "\n"
        "## Core Rules\n"
        "\n"
        "- Keep the visible planning artifact in the BA-style Business Plan format defined by `AGENTS.md`.\n"
        "- Resolve executable clio MCP tool contracts through `get-tool-contract`; do not invent payload shapes.\n"
        "- Use `context/business-checklist.md`, `context/essentials.md`, `context/naming-conventions.md`, "
        "`context/clio-cli-reference.md`, and `context/model-discovery-evidence.md` as the canonical repository references.\n"
        f"- The `clio` MCP server is registered in `{mcp_config_path}`.\n"
    )


def render_copilot_skill(repo_root: Path, mcp_config_path: Path) -> str:
    """Build the installed Copilot CLI skill against the self-contained installed plugin."""
    return _render_skill_body(repo_root, mcp_config_path)


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
        "Entrypoint for the Creatio AI App Development Toolkit (ADAC) workflow.\n"
        "\n"
        f"Toolkit repository is installed at: `{repo_root}`\n"
        "\n"
        "## Load Order\n"
        "\n"
        f"{render_load_order(repo_root)}"
        "\n"
        "## Core Rules\n"
        "\n"
        "- Keep the visible planning artifact in the BA-style Business Plan format defined by `AGENTS.md`.\n"
        "- Resolve executable clio MCP tool contracts through `get-tool-contract`; do not invent payload shapes.\n"
        f"- The `clio` MCP server is registered in `{mcp_config_path}`.\n"
    )


def install_codex(repo_root: Path, home: Path) -> None:
    ensure_required_references(repo_root)
    version = plugin_version(repo_root)
    codex_home = home / ".codex"
    agents_plugin_dir = home / ".agents" / "plugins" / PLUGIN_NAME
    agents_skills_dir = home / ".agents" / "skills"
    marketplace_dir = codex_home / "plugins" / "marketplaces" / MARKETPLACE_NAME
    marketplace_plugin_dir = marketplace_dir / "plugins" / PLUGIN_NAME
    cache_dir = codex_home / "plugins" / "cache" / MARKETPLACE_NAME / PLUGIN_NAME / version
    standalone_skill_dir = codex_home / "skills" / SKILL_NAME
    remove_tree_if_exists(marketplace_dir, "Codex")
    remove_tree_if_exists(cache_dir, "Codex")
    remove_tree_if_exists(agents_plugin_dir, "Codex")
    remove_tree_if_exists(standalone_skill_dir, "Codex")
    copy_plugin_runtime_surface(repo_root, marketplace_plugin_dir)
    write_codex_marketplace_catalog(repo_root, marketplace_dir)
    copy_plugin_runtime_surface(repo_root, cache_dir)
    copy_plugin_runtime_surface(repo_root, agents_plugin_dir)
    copy_skill_directories(repo_root, agents_skills_dir)
    mcp_config_path = codex_home / "config.toml"
    merge_codex_mcp_config(repo_root, mcp_config_path)
    merge_codex_marketplace_config(MARKETPLACE_NAME, marketplace_dir, PLUGIN_NAME, mcp_config_path)
    merge_personal_marketplace_catalog(repo_root, home)


def install_claude(repo_root: Path, home: Path) -> None:
    ensure_required_references(repo_root)
    version = plugin_version(repo_root)
    claude_home = home / ".claude"
    marketplace_dir = claude_home / "plugins" / "marketplaces" / MARKETPLACE_NAME
    cache_dir = claude_home / "plugins" / "cache" / MARKETPLACE_NAME / PLUGIN_NAME / version
    remove_tree_if_exists(marketplace_dir, "Claude Code")
    remove_tree_if_exists(cache_dir, "Claude Code")
    copy_plugin_runtime_surface(repo_root, marketplace_dir)
    copy_plugin_runtime_surface(repo_root, cache_dir)
    copy_skill_directories(repo_root, home / ".agents" / "skills")
    copy_mcp_config(repo_root, claude_home / "adac.mcp.json")
    merge_claude_plugin_settings(marketplace_dir, claude_home / "settings.json")
    register_claude_known_marketplace(
        marketplace_dir,
        claude_home / "plugins" / "known_marketplaces.json",
    )
    register_claude_installed_plugin(
        cache_dir,
        claude_home / "plugins" / "installed_plugins.json",
        version,
    )


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
    copilot_home = home / ".copilot"
    installed_plugin_dir = copilot_home / "installed-plugins" / MARKETPLACE_NAME / PLUGIN_NAME
    skill_source_dir = repo_root / "skills" / SKILL_NAME
    skill_target_dir = copilot_home / "skills" / SKILL_NAME
    copilot_command = resolve_copilot_command()
    plugin_source = f"{PLUGIN_NAME}@{MARKETPLACE_NAME}"
    try:
        run_checked([*copilot_command, "plugin", "marketplace", "add", str(repo_root)], cwd=repo_root)
    except RuntimeError as error:
        if f'Marketplace "{MARKETPLACE_NAME}" already registered' not in str(error):
            raise
    run_checked([*copilot_command, "plugin", "install", plugin_source], cwd=repo_root)
    plugin_runtime_paths = load_plugin_runtime_paths(repo_root)
    copy_plugin_runtime_surface(repo_root, installed_plugin_dir)
    prune_directory_entries(
        installed_plugin_dir,
        {Path(relative_path).parts[0] for relative_path in plugin_runtime_paths},
        "GitHub Copilot CLI plugin runtime",
    )

    skill_target_dir.mkdir(parents=True, exist_ok=True)
    agents_source_dir = skill_source_dir / "agents"
    if agents_source_dir.exists():
        agents_target_dir = skill_target_dir / "agents"
        if agents_target_dir.exists():
            shutil.rmtree(agents_target_dir)
        shutil.copytree(
            agents_source_dir,
            agents_target_dir,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
    skill_body = render_copilot_skill(installed_plugin_dir, copilot_home / "mcp-config.json")
    (skill_target_dir / "SKILL.md").write_text(skill_body, encoding="utf-8")
    allowed_skill_entries = {"SKILL.md"}
    if agents_source_dir.exists():
        allowed_skill_entries.add("agents")
    prune_directory_entries(skill_target_dir, allowed_skill_entries, "GitHub Copilot CLI skill")


def install_for_targets(repo_root: Path, targets: list[dict[str, Any]], selected: str | None = None) -> list[str]:
    installed = []
    for target in targets:
        if selected and target["id"] != selected:
            continue
        home = target["home"].parent if target["id"] in {"codex", "claude", "cursor", "copilot"} else target["home"]
        if target["id"] == "codex":
            install_codex(repo_root, home)
        elif target["id"] == "claude":
            install_claude(repo_root, home)
        elif target["id"] == "cursor":
            install_cursor(repo_root, home)
        elif target["id"] == "copilot":
            install_copilot(repo_root, home)
        installed.append(target["id"])
    return installed


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
    try:
        preflight_clio()
        repo_root = resolve_repo_root()
        targets = detect_targets()
        installed = install_for_targets(repo_root, targets, args.target)
    except RuntimeError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    if installed:
        print(f"Installed {PLUGIN_NAME} for: {', '.join(installed)}")
    else:
        print("No supported local coding agents were detected.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

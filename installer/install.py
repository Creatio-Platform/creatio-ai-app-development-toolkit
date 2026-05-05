#!/usr/bin/env python3
"""Simple installer for the Creatio AI App Development Toolkit root plugin."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


DEFAULT_REPO_URL = "https://creatio.ghe.com/engineering/ai-driven-app-creation.git"
DEFAULT_INSTALL_ROOT = Path.home() / ".creatio-ai-app-development-toolkit" / "repo"
PLUGIN_NAME = "creatio-ai-app-development-toolkit"
SKILL_NAME = "creatio-app-orchestrator"
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


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


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

    return targets


def clone_or_update_repo(repo_url: str, destination: Path, ref: str | None = None) -> Path:
    if (destination / ".git").exists():
        run_checked(["git", "fetch", "--all", "--tags"], cwd=destination)
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        run_checked(["git", "clone", repo_url, str(destination)])

    if ref:
        run_checked(["git", "checkout", ref], cwd=destination)

    return destination


def is_plugin_checkout(path: Path) -> bool:
    return (path / "plugin.json").exists() and (path / ".mcp.json").exists() and (path / "skills").is_dir()


def current_checkout_root() -> Path | None:
    script_path = Path(__file__).resolve()
    if script_path.name != "install.py" or script_path.parent.name != "installer":
        return None

    repo_root = script_path.parent.parent
    if is_plugin_checkout(repo_root):
        return repo_root
    return None


def resolve_repo_root(repo_url: str, install_root: Path | None, ref: str | None = None) -> Path:
    if install_root is None and ref is None:
        checkout_root = current_checkout_root()
        if checkout_root:
            return checkout_root

    return clone_or_update_repo(repo_url, install_root or DEFAULT_INSTALL_ROOT, ref)


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


def merge_mcp_config(repo_root: Path, target_path: Path) -> None:
    """Merge mcpServers from the plugin's .mcp.json into a shared MCP config file."""
    source = repo_root / ".mcp.json"
    if not source.exists():
        raise RuntimeError(f"MCP config not found: {source}")

    incoming = json.loads(source.read_text(encoding="utf-8"))
    incoming_servers = incoming.get("mcpServers", {}) or {}

    if target_path.exists():
        existing = json.loads(target_path.read_text(encoding="utf-8")) or {}
    else:
        existing = {}

    existing_servers = existing.get("mcpServers", {}) or {}
    existing_servers.update(incoming_servers)
    existing["mcpServers"] = existing_servers
    write_json(target_path, existing)


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


def render_codex_skill(repo_root: Path, mcp_config_path: Path) -> str:
    """Build the installed Codex skill with absolute paths back to the plugin checkout."""
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


def render_cursor_rule(repo_root: Path) -> str:
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
        "- The `clio` MCP server is registered in `~/.cursor/mcp.json`.\n"
    )


def install_codex(repo_root: Path, home: Path) -> None:
    ensure_required_references(repo_root)
    target_skills_dir = home / ".codex" / "skills"
    copy_skill_directories(repo_root, target_skills_dir)
    mcp_config_path = home / ".codex" / "adac.mcp.json"
    (target_skills_dir / SKILL_NAME / "SKILL.md").write_text(
        render_codex_skill(repo_root, mcp_config_path),
        encoding="utf-8",
    )
    copy_mcp_config(repo_root, mcp_config_path)


def install_claude(repo_root: Path, home: Path) -> None:
    marketplace_dir = home / ".claude" / "plugins" / "marketplaces" / PLUGIN_NAME
    if marketplace_dir.exists():
        shutil.rmtree(marketplace_dir)
    shutil.copytree(repo_root, marketplace_dir, ignore=shutil.ignore_patterns(".git"))
    copy_mcp_config(repo_root, home / ".claude" / "adac.mcp.json")


def install_cursor(repo_root: Path, home: Path) -> None:
    cursor_home = home / ".cursor"
    local_plugin_dir = cursor_home / "plugins" / "local" / PLUGIN_NAME
    if local_plugin_dir.exists():
        shutil.rmtree(local_plugin_dir)
    shutil.copytree(
        repo_root,
        local_plugin_dir,
        ignore=shutil.ignore_patterns(".git", "__pycache__", "*.pyc"),
    )
    merge_mcp_config(repo_root, cursor_home / "mcp.json")
    rules_dir = cursor_home / "rules"
    rules_dir.mkdir(parents=True, exist_ok=True)
    rule_path = rules_dir / f"{SKILL_NAME}.mdc"
    rule_path.write_text(render_cursor_rule(repo_root), encoding="utf-8")


def install_copilot(repo_root: Path) -> None:
    raise RuntimeError(
        "GitHub Copilot CLI plugin installation is not supported by this v1 installer yet. "
        f"Use the root plugin manifest at {repo_root / 'plugin.json'} for manual configuration."
    )


def install_for_targets(repo_root: Path, targets: list[dict[str, Any]], selected: str | None = None) -> list[str]:
    installed = []
    for target in targets:
        if selected and target["id"] != selected:
            continue
        home = target["home"].parent if target["id"] in {"codex", "claude", "cursor"} else target["home"]
        if target["id"] == "codex":
            install_codex(repo_root, home)
        elif target["id"] == "claude":
            install_claude(repo_root, home)
        elif target["id"] == "cursor":
            install_cursor(repo_root, home)
        elif target["id"] == "copilot":
            install_copilot(repo_root)
        installed.append(target["id"])
    return installed


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Install Creatio AI App Development Toolkit plugin.")
    parser.add_argument("--repo-url", default=DEFAULT_REPO_URL)
    parser.add_argument("--ref", help="Git tag, branch, or commit to checkout before installing.")
    parser.add_argument("--target", choices=["codex", "claude", "cursor"], help="Install only one target.")
    parser.add_argument(
        "--install-root",
        type=Path,
        default=None,
        help="Local checkout directory for the toolkit repository. Defaults to the current checkout when run from one.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        preflight_clio()
        repo_root = resolve_repo_root(args.repo_url, args.install_root, args.ref)
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

#!/usr/bin/env python3
"""Shared agent-CLI primitives for the CAADT installer and updater.

This is the one thing install.py and update.py legitimately share: the plugin /
marketplace identifiers and how to locate and invoke each agent's CLI. Keeping
them here lets update.py own its update logic independently of install.py while
guaranteeing both agree on the marketplace and plugin names.
"""
from __future__ import annotations

import shutil
from pathlib import Path

PLUGIN_NAME = "creatio-ai-app-development-toolkit"
MARKETPLACE_NAME = "creatio"
PLUGIN_SOURCE = f"{PLUGIN_NAME}@{MARKETPLACE_NAME}"


def preflight_copilot() -> str:
    copilot = shutil.which("copilot")
    if not copilot:
        raise RuntimeError(
            "copilot was not found in PATH. Install GitHub Copilot CLI or add it to PATH before installing CAADT."
        )
    return copilot


def preflight_claude() -> str:
    claude = shutil.which("claude")
    if not claude:
        raise RuntimeError(
            "claude was not found in PATH. Install Claude Code or add it to PATH before installing CAADT."
        )
    return claude


def preflight_codex() -> str:
    codex = shutil.which("codex")
    if not codex:
        raise RuntimeError(
            "codex was not found in PATH. Install Codex CLI or add it to PATH before installing CAADT."
        )
    return codex


def _resolve_cli_command(cli_path: str) -> list[str]:
    path = Path(cli_path)
    if path.suffix.lower() == ".ps1":
        return ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(path)]
    return [cli_path]


def resolve_copilot_command() -> list[str]:
    return _resolve_cli_command(preflight_copilot())


def resolve_claude_command() -> list[str]:
    return _resolve_cli_command(preflight_claude())


def resolve_codex_command() -> list[str]:
    return _resolve_cli_command(preflight_codex())

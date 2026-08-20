"""JSONL transcript parsing: usage, tool-use/result iteration, role detection.

Pure functions over a single Claude Code transcript line (a decoded JSON
object). Everything here is deterministic and side-effect free so it can be
unit-tested against tiny synthetic fixtures.
"""
from __future__ import annotations

import json
import re
from typing import Iterator, Optional


def iter_jsonl(path: str) -> Iterator[dict]:
    """Yield decoded objects from a JSONL file, skipping blank/garbage lines."""
    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except Exception:
                continue


def usage_of(obj: dict) -> Optional[dict]:
    """The token-usage block of a transcript object, if present."""
    usage = (obj.get("message") or {}).get("usage") or obj.get("usage")
    return usage if isinstance(usage, dict) else None


def cache_creation_ttl(usage: dict) -> tuple[int, int]:
    """(ephemeral_5m, ephemeral_1h) cache-write tokens from a usage block.

    Reads the per-TTL breakdown, NOT the summed ``cache_creation_input_tokens``
    which cannot tell a 5m write from a 1h write (R4).
    """
    breakdown = usage.get("cache_creation")
    if isinstance(breakdown, dict):
        return (
            breakdown.get("ephemeral_5m_input_tokens", 0) or 0,
            breakdown.get("ephemeral_1h_input_tokens", 0) or 0,
        )
    return (0, 0)


def message_text(obj: dict) -> str:
    """Concatenated text of a message (string content or text blocks)."""
    message = obj.get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            block.get("text", "")
            for block in content
            if isinstance(block, dict) and block.get("type") == "text"
        )
    return ""


# "You are the REFS step ...", "You are a BUILD agent ...",
# "You are the PREFLIGHT MERGE step ..." -> first word after the article is the
# canonical role. Folding "PREFLIGHT MERGE" onto "PREFLIGHT" keeps the role set
# to the enumerated R5 vocabulary.
_ROLE_RE = re.compile(r"You are (?:the |a |an )?([A-Za-z]+)")


def role_from_opening(text: str) -> Optional[str]:
    """Uppercase role name parsed from an agent's opening prompt, else None."""
    if not text:
        return None
    match = _ROLE_RE.match(text.strip())
    if match:
        return match.group(1).upper()
    return None


def opening_role(path: str) -> Optional[str]:
    """Role of a subagent transcript: parsed from its first user message."""
    for obj in iter_jsonl(path):
        message = obj.get("message") or {}
        if message.get("role") == "user":
            text = message_text(obj)
            if text.strip():
                return role_from_opening(text)
    return None


# Path fragment an offloaded tool-result points at, e.g.
# "... saved to C:\\...\\tool-results\\mcp-clio-clio-run-123.txt".
_OFFLOAD_RE = re.compile(r"tool-results[\\/]+([A-Za-z0-9._-]+\.txt)")


def offloaded_filename(text: str) -> Optional[str]:
    """Basename of the tool-results file an offloaded result references, if any."""
    match = _OFFLOAD_RE.search(text or "")
    return match.group(1) if match else None

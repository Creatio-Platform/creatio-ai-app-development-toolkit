#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path

EVENT_RE = re.compile(r"<sub>⏱️ (?P<time>[^<]+)</sub>\n\n### (?P<kind>[^\n]+)\n\n(?P<body>.*?)(?=\n---\n\n<sub>⏱️ |\Z)", re.S)
METADATA_RE = {
    "session_id": re.compile(r"\*\*Session ID:\*\*\s*`([^`]+)`"),
    "started": re.compile(r"\*\*Started:\*\*\s*([^\n]+?)\s{2,}$", re.M),
    "duration": re.compile(r"\*\*Duration:\*\*\s*([^\n]+?)\s{2,}$", re.M),
    "exported": re.compile(r"\*\*Exported:\*\*\s*([^\n]+?)\s*$", re.M),
}
SIGNALS = {
    "parameter_validation_failed": "Parameter validation failed",
    "json_decode_error": "JSONDecodeError",
    "body_required_empty": "body is required and must not be empty",
    "resources_must_be_string": "Parameter 'resources' must be a string, not dict",
    "cliogate_missing": "cliogate package version",
    "unknown_parameter_args": "Unknown parameter 'args'",
    "missing_template_code": "Missing required parameter 'template-code'",
}


def parse_metadata(text: str) -> dict[str, str | None]:
    result: dict[str, str | None] = {}
    for key, pattern in METADATA_RE.items():
        match = pattern.search(text)
        result[key] = match.group(1).strip() if match else None
    return result


def first_non_empty_line(text: str) -> str:
    for line in text.splitlines():
        stripped = line.strip()
        if stripped:
            return stripped
    return ""


def extract_title(body: str) -> str | None:
    match = re.search(r"\*\*(.*?)\*\*", body, re.S)
    if not match:
        return None
    return " ".join(match.group(1).split())


def parse_events(text: str) -> list[dict[str, str | None]]:
    events = []
    for match in EVENT_RE.finditer(text):
        body = match.group("body")
        events.append(
            {
                "time": match.group("time").strip(),
                "kind": match.group("kind").strip(),
                "title": extract_title(body),
                "first_line": first_non_empty_line(body),
                "body": body,
            }
        )
    return events


def summarize(log_path: Path) -> dict[str, object]:
    text = log_path.read_text()
    events = parse_events(text)
    kind_counts = Counter(event["kind"] for event in events)
    tool_type_counts = Counter()
    tool_titles = []
    signal_events: dict[str, list[dict[str, str]]] = {name: [] for name in SIGNALS}
    for event in events:
        kind = str(event["kind"])
        body = str(event["body"])
        if kind.startswith("✅ "):
            tool_match = re.search(r"`([^`]+)`", kind)
            tool_type = tool_match.group(1) if tool_match else kind
            tool_type_counts[tool_type] += 1
            tool_titles.append(
                {
                    "time": str(event["time"]),
                    "tool": tool_type,
                    "title": str(event["title"] or event["first_line"]),
                }
            )
        for signal_name, needle in SIGNALS.items():
            if needle in body:
                signal_events[signal_name].append(
                    {
                        "time": str(event["time"]),
                        "kind": kind,
                        "title": str(event["title"] or event["first_line"]),
                    }
                )
    timeline = [
        {
            "time": str(event["time"]),
            "kind": str(event["kind"]),
            "title": str(event["title"] or event["first_line"]),
        }
        for event in events
    ]
    return {
        "log_path": str(log_path),
        "metadata": parse_metadata(text),
        "counts": {
            "events": len(events),
            "tool_calls": sum(tool_type_counts.values()),
            "reasoning_blocks": kind_counts.get("💭 Reasoning", 0),
            "copilot_messages": kind_counts.get("💬 Copilot", 0),
            "notifications": kind_counts.get("ℹ️ Notification", 0),
            "tool_types": dict(tool_type_counts),
            "event_kinds": dict(kind_counts),
        },
        "signals": {
            name: {
                "incident_count": len(items),
                "events": items,
            }
            for name, items in signal_events.items()
            if items
        },
        "tool_titles": tool_titles,
        "timeline": timeline,
    }


def render_text(summary: dict[str, object], titles_limit: int) -> str:
    metadata = summary["metadata"]
    counts = summary["counts"]
    signals = summary["signals"]
    tool_titles = summary["tool_titles"]
    timeline = summary["timeline"]
    lines = [
        f"Log: {summary['log_path']}",
        f"Session ID: {metadata.get('session_id') or 'n/a'}",
        f"Started: {metadata.get('started') or 'n/a'}",
        f"Duration: {metadata.get('duration') or 'n/a'}",
        f"Exported: {metadata.get('exported') or 'n/a'}",
        "",
        "Counts:",
        f"- Events: {counts['events']}",
        f"- Tool calls: {counts['tool_calls']}",
        f"- Reasoning blocks: {counts['reasoning_blocks']}",
        f"- Copilot messages: {counts['copilot_messages']}",
        f"- Notifications: {counts['notifications']}",
        f"- Tool types: {json.dumps(counts['tool_types'], ensure_ascii=False, sort_keys=True)}",
    ]
    if signals:
        lines.append("")
        lines.append("Incident signals:")
        for name, payload in signals.items():
            lines.append(f"- {name}: {payload['incident_count']}")
    if tool_titles:
        lines.append("")
        lines.append(f"Executed tool titles (first {titles_limit}):")
        for item in tool_titles[:titles_limit]:
            lines.append(f"- {item['time']} | {item['tool']} | {item['title']}")
    if timeline:
        lines.append("")
        lines.append("Timeline sample:")
        for item in timeline[: min(12, len(timeline))]:
            lines.append(f"- {item['time']} | {item['kind']} | {item['title']}")
        if len(timeline) > 12:
            lines.append("- ...")
            for item in timeline[max(12, len(timeline) - 12) :]:
                lines.append(f"- {item['time']} | {item['kind']} | {item['title']}")
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Analyze exported ADAC-style session logs.")
    parser.add_argument("log_path", type=Path, help="Absolute path to the raw session log markdown file.")
    parser.add_argument("--format", choices=("json", "text"), default="json")
    parser.add_argument("--titles-limit", type=int, default=20)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    summary = summarize(args.log_path)
    if args.format == "text":
        print(render_text(summary, args.titles_limit))
        return 0
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

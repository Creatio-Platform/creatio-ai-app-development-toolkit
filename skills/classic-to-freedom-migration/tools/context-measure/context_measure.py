#!/usr/bin/env python3
"""Measure what a migration run carries in context: skill files, clio MCP results, sub-agent start-up.

Input is a `/share-session` export directory: the driver transcript `<session-id>.jsonl` (or
`transcript.jsonl`) and a `<session-id>/` folder whose `subagents/` and `workflows/` hold one
`agent-*.jsonl` per sub-agent. Token cost in money terms is the cost-counter tool's job; this tool
answers where the context comes from, so two runs of the same migration can be compared.

One API message is split across several JSONL records that repeat the same `usage` block, so every
context figure here is counted once per `message.id`, never once per record.
"""
import argparse
import glob
import json
import os
import re
import sys
from collections import Counter, defaultdict

SKILL = "classic-to-freedom-migration"
SKILL_FILE_RE = re.compile(SKILL + r"/((?:references|docs)/[\w.-]+\.md|engine/README\.md|SKILL\.md)")
BRIEF_RE = re.compile(r"(reference-cache-brief|build-scaffolding|build-page|build-dashboards|judge-brief|read-back-brief)\.md")
CLIO_SERVER_RE = re.compile(r"^mcp__[^_]*clio[^_]*__")
RUN_TOOLS = ("clio-run", "clio-run-destructive")


def records(path):
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue


def text_of(content):
    """The text a tool_result or user record carries, whatever shape the host stored it in."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(c.get("text", "") if isinstance(c, dict) else str(c) for c in content)
    return json.dumps(content)


def clio_name(tool_name, tool_input):
    """`None` for a non-clio tool; otherwise the clio command, with `clio-run` unwrapped."""
    if not CLIO_SERVER_RE.match(tool_name):
        return None
    name = CLIO_SERVER_RE.sub("", tool_name)
    if name in RUN_TOOLS:
        name = str(tool_input.get("command"))
    if name == "get-guidance":
        args = tool_input.get("args") or tool_input
        name += ":" + str(args.get("name"))
    return name


def clio_args(tool_input):
    return tool_input.get("args", tool_input) if isinstance(tool_input, dict) else {}


def parse(path):
    """One transcript → its API messages, tool calls with result sizes, and skill-file reads."""
    msgs, order = {}, []
    calls = {}
    reads = []
    prompt = None
    skill_loads = []
    for rec in records(path):
        msg = rec.get("message") or {}
        if rec.get("type") == "user":
            content = msg.get("content")
            if prompt is None:
                prompt = text_of(content)
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and c.get("type") == "tool_result" and c.get("tool_use_id") in calls:
                        calls[c["tool_use_id"]]["result"] = text_of(c.get("content"))
            body = text_of(content)
            head = body[:600]
            if "Base directory for this skill" in head and SKILL in head:
                skill_loads.append((len(order), len(body)))
        if rec.get("type") != "assistant":
            continue
        mid = msg.get("id") or rec.get("uuid")
        if mid not in msgs:
            u = msg.get("usage") or {}
            msgs[mid] = u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
            order.append(mid)
        for c in msg.get("content") or []:
            if not isinstance(c, dict) or c.get("type") != "tool_use":
                continue
            inp = c.get("input") or {}
            calls[c["id"]] = {"name": c["name"], "input": inp, "at": len(order) - 1, "result": ""}
            blob = json.dumps(inp)
            for m in set(SKILL_FILE_RE.findall(blob)):
                reads.append((len(order) - 1, c["name"], m))
    ctx = [msgs[m] for m in order]
    return {"path": path, "ctx": ctx, "calls": calls, "reads": reads, "prompt": prompt or "", "skill_loads": skill_loads}


def build_start(run):
    """Index of the first `--start` of a build task: the point where the plan phase ends."""
    for call in sorted(run["calls"].values(), key=lambda c: c["at"]):
        if call["name"] == "Bash" and re.search(r"migrate\.mjs.*--start\b", call["input"].get("command", "")):
            return call["at"]
    return None


def agent_kind(prompt):
    m = BRIEF_RE.search(prompt)
    if m:
        return m.group(1)
    if "classic-ui-expert" in prompt or "Workflow harness" in prompt:
        return "workflow"
    return "other"


def section_shares(name, result):
    """Which top-level parts of a big clio response hold its size."""
    try:
        data = json.loads(result)
    except (json.JSONDecodeError, TypeError):
        return {}
    if not isinstance(data, dict):
        return {}
    out = Counter()
    if name in ("get-component-info", "get-request-info"):
        def walk(o):
            if isinstance(o, dict):
                for k, v in o.items():
                    if k in ("documentation", "typeDefinitions", "inputs", "outputs", "example"):
                        out[k] += len(json.dumps(v))
                    elif isinstance(v, (dict, list)):
                        walk(v)
                    else:
                        out["other"] += len(json.dumps(v))
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(data)
    elif name in ("get-page", "update-page"):
        summary = (data.get("page") or {}).get("ownBodySummary") or {}
        ops = len(json.dumps(summary.get("viewConfigDiffOps", [])))
        out["viewConfigDiffOps"] += ops
        out["other"] += max(len(result) - ops, 0)
    elif name == "get-tool-contract":
        for tool in data.get("tools") or []:
            for k, v in tool.items():
                out[k] += len(json.dumps(v))
    elif name == "validate-page":
        warnings = (data.get("validation") or data).get("warnings") or []
        templates = Counter(re.sub(r"'[^']*'", "X", w if isinstance(w, str) else json.dumps(w))[:80] for w in warnings)
        top = templates.most_common(1)
        out["warnings"] += len(warnings)
        if top:
            out["most-repeated-warning: " + top[0][0]] += top[0][1]
    return out


def find_main(export_dir):
    cands = [p for p in glob.glob(os.path.join(export_dir, "*.jsonl"))
             if os.path.isdir(os.path.splitext(p)[0]) or os.path.basename(p) == "transcript.jsonl"]
    if not cands:
        sys.exit(f"no driver transcript in {export_dir}: pass --main")
    return max(cands, key=os.path.getsize)


def measure(export_dir, main_path=None):
    main_path = main_path or find_main(export_dir)
    session_dir = os.path.splitext(main_path)[0]
    if not os.path.isdir(session_dir):
        session_dir = export_dir
    main = parse(main_path)
    subs = [parse(p) for p in sorted(glob.glob(os.path.join(session_dir, "**", "agent-*.jsonl"), recursive=True))]

    split = build_start(main)
    ctx = main["ctx"]
    report = {
        "main": {
            "transcript": os.path.basename(main_path),
            "api_messages": len(ctx),
            "context_first": ctx[0] if ctx else 0,
            "context_peak": max(ctx) if ctx else 0,
            "context_sum": sum(ctx),
            "skill_body_loads": [{"at_message": i, "chars": n} for i, n in main["skill_loads"]],
            "build_start_at_message": split,
            "context_at_build_start": ctx[split] if split is not None and split < len(ctx) else None,
            "context_sum_plan": sum(ctx[:split]) if split is not None else None,
            "context_sum_build": sum(ctx[split:]) if split is not None else None,
        },
        "subagents_context_sum": sum(sum(s["ctx"]) for s in subs),
        "skill_file_reads": [],
        "subagents": [],
        "clio": [],
        "clio_breakdown": {},
    }
    for who, run in [("main", main)] + [(os.path.basename(s["path"]), s) for s in subs]:
        seen = set()
        for at, tool, f in run["reads"]:
            if (tool, f) not in seen:
                seen.add((tool, f))
                report["skill_file_reads"].append({"reader": who, "at_message": at, "tool": tool, "file": f})
    for s in subs:
        skills = sorted({c["input"].get("skill", "") for c in s["calls"].values() if c["name"] == "Skill"})
        files = {f for _, _, f in s["reads"]}
        report["subagents"].append({
            "agent": os.path.basename(s["path"]),
            "kind": agent_kind(s["prompt"]),
            "api_messages": len(s["ctx"]),
            "context_first": s["ctx"][0] if s["ctx"] else 0,
            "context_peak": max(s["ctx"]) if s["ctx"] else 0,
            "prompt_chars": len(s["prompt"]),
            "skills": skills,
            "loaded_migration_skill_body": bool(s["skill_loads"]),
            "touched_skill_md": "SKILL.md" in files,
            "touched_orchestrate_build": "references/orchestrate-build.md" in files,
        })

    size, count, peak, where, repeats = Counter(), Counter(), Counter(), defaultdict(set), Counter()
    shares = defaultdict(Counter)
    for who, run in [("main", main)] + [("sub", s) for s in subs]:
        asked = Counter()
        for call in run["calls"].values():
            name = clio_name(call["name"], call["input"])
            if name is None:
                continue
            key = name + (" [output-file]" if "output-file" in json.dumps(call["input"]) else "")
            n = len(call["result"])
            size[key] += n
            count[key] += 1
            peak[key] = max(peak[key], n)
            where[key].add(who)
            asked[(key, json.dumps(clio_args(call["input"]), sort_keys=True))] += 1
            shares[name].update(section_shares(name, call["result"]))
        for (key, _), n in asked.items():
            repeats[key] += n - 1
    for key, n in size.most_common():
        report["clio"].append({"tool": key, "chars": n, "calls": count[key], "max": peak[key],
                               "where": sorted(where[key]), "same_args_repeated_in_one_context": repeats[key]})
    report["clio_total_chars"] = sum(size.values())
    report["clio_breakdown"] = {k: dict(v.most_common()) for k, v in shares.items() if v}
    return report


def fmt(n):
    return "—" if n is None else f"{n:,}"


def markdown(r):
    m = r["main"]
    out = ["## Driver session", "",
           f"- transcript `{m['transcript']}`: {m['api_messages']} API messages; context first {fmt(m['context_first'])},"
           f" peak {fmt(m['context_peak'])}, summed over messages {fmt(m['context_sum'])}"]
    for load in m["skill_body_loads"]:
        out.append(f"- skill body loaded at message {load['at_message']}: {load['chars']:,} chars")
    if m["build_start_at_message"] is not None:
        out.append(f"- first build `--start` at message {m['build_start_at_message']}: context {fmt(m['context_at_build_start'])};"
                   f" summed plan {fmt(m['context_sum_plan'])}, build {fmt(m['context_sum_build'])}")
    out.append(f"- sub-agents, summed over their messages: {fmt(r['subagents_context_sum'])}")
    out += ["", "## Skill files read", "", "| reader | message | tool | file |", "| --- | --- | --- | --- |"]
    out += [f"| {x['reader']} | {x['at_message']} | {x['tool']} | `{x['file']}` |" for x in r["skill_file_reads"]]
    out += ["", "## Sub-agents", "",
            "| agent | kind | messages | context first | peak | skills | skill body | SKILL.md | orchestrate-build |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for s in r["subagents"]:
        skills = ", ".join(x.split(":")[-1] for x in s["skills"]) or "—"
        out.append(f"| {s['agent']} | {s['kind']} | {s['api_messages']} | {fmt(s['context_first'])} | {fmt(s['context_peak'])} |"
                   f" {skills} | {'yes' if s['loaded_migration_skill_body'] else 'no'} |"
                   f" {'yes' if s['touched_skill_md'] else 'no'} | {'yes' if s['touched_orchestrate_build'] else 'no'} |")
    out += ["", f"## clio MCP results — {r['clio_total_chars']:,} chars", "",
            "| tool | chars | calls | max | where | same args repeated |", "| --- | --- | --- | --- | --- | --- |"]
    out += [f"| {c['tool']} | {c['chars']:,} | {c['calls']} | {c['max']:,} | {','.join(c['where'])} | {c['same_args_repeated_in_one_context']} |"
            for c in r["clio"]]
    out += ["", "## What the big clio responses are made of", ""]
    for name, parts in r["clio_breakdown"].items():
        out.append(f"- `{name}`: " + ", ".join(f"{k} {v:,}" for k, v in parts.items()))
    return "\n".join(out) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("export_dir")
    ap.add_argument("--main", help="driver transcript, when the export holds more than one *.jsonl")
    ap.add_argument("--format", choices=("md", "json"), default="md")
    a = ap.parse_args()
    r = measure(a.export_dir, a.main)
    sys.stdout.write(json.dumps(r, indent=1) + "\n" if a.format == "json" else markdown(r))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path


def parse_args():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("-r", action="store_true", dest="raw")
    parser.add_argument("-n", action="store_true", dest="null_input")
    parser.add_argument("--arg", action="append", nargs=2, default=[])
    parser.add_argument("--argjson", action="append", nargs=2, default=[])
    parser.add_argument("filter", nargs="?")
    parser.add_argument("file", nargs="?")
    parser.add_argument("-h", "--help", action="store_true")
    return parser.parse_known_args()


def empty_if_none(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def read_json(path: str):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def eval_path(expr: str, data):
    expr = expr.strip()
    if " // empty" in expr:
        lhs = expr.split(" // empty", 1)[0].strip()
        value = eval_path(lhs, data)
        return "" if value in (None, "", []) else value
    if expr == ".":
        return data
    if not expr.startswith("."):
        raise ValueError(f"Unsupported filter: {expr}")
    current = data
    parts = [part for part in expr.lstrip(".").split(".") if part]
    for part in parts:
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def build_planning_state(args):
    args_map = {name: value for name, value in args.arg}
    args_map.update({name: json.loads(value) for name, value in args.argjson})
    return {
        "planningApproved": True,
        "appName": args_map["appName"],
        "approvedBy": args_map["approvedBy"],
        "approvedAtUtc": args_map["approvedAtUtc"],
        "approvalSource": "natural-language",
        "routingMode": args_map["routingMode"],
        "environmentInputsDeferred": args_map["environmentInputsDeferred"],
        "understandingText": args_map["understandingText"],
        "confirmationText": args_map["confirmationText"],
        "technicalInputs": {
            "creatioUrl": args_map["creatioUrl"],
        },
    }


def main():
    args, unknown = parse_args()
    if args.help or unknown:
        sys.stderr.write("Unsupported jq invocation for local shim.\n")
        return 2

    if args.null_input:
        result = build_planning_state(args)
        sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    if not args.filter or not args.file:
        sys.stderr.write("Unsupported jq invocation for local shim.\n")
        return 2

    data = read_json(args.file)
    result = eval_path(args.filter, data)
    if args.raw:
        sys.stdout.write(empty_if_none(result))
    else:
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

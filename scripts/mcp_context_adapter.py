#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

try:
    from scripts.mcp_result_document import ContextError, normalize_column, normalize_result_document
except ImportError:
    from mcp_result_document import ContextError, normalize_column, normalize_result_document


def load_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, payload):
    Path(path).write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")


def build_parser():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    normalize_parser = subparsers.add_parser("normalize")
    normalize_parser.add_argument("input_path")
    normalize_parser.add_argument("output_path", nargs="?")
    return parser


def run_normalize(input_path, output_path=None):
    source_path = Path(input_path)
    target_path = Path(output_path) if output_path else source_path
    payload = load_json(source_path)
    normalized = normalize_result_document(payload)
    write_json(target_path, normalized)
    return str(target_path)


def main():
    parser = build_parser()
    args = parser.parse_args()
    if args.command == "normalize":
        print(run_normalize(args.input_path, args.output_path))


if __name__ == "__main__":
    main()

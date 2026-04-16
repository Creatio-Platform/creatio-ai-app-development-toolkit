#!/usr/bin/env python3
import argparse
import json
import re
from pathlib import Path

try:
    from scripts.mcp_client import call_mcp_tool
except ImportError:
    from mcp_client import call_mcp_tool


def write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def read_json(path: Path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def read_requirement_summary(summary=None, summary_file=None):
    if summary_file:
        return Path(summary_file).read_text(encoding="utf-8").strip()
    if summary:
        return summary.strip()
    raise ValueError("Provide --requirement-summary or --requirement-summary-file")


def normalize_lookup_matches(rows):
    normalized = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        schema_name = row.get("schema-name") or row.get("schemaName") or row.get("name")
        value = row.get("value") or row.get("caption") or row.get("description")
        if not schema_name and not value:
            continue
        score = row.get("score")
        try:
            score = float(score) if score is not None else None
        except (TypeError, ValueError):
            score = None
        normalized.append(
            {
                "schemaName": schema_name or "",
                "value": value or "",
                "score": score,
            }
        )
    return normalized


def normalize_table_matches(rows):
    normalized = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        schema_name = row.get("schema-name") or row.get("schemaName") or row.get("name")
        if not schema_name:
            continue
        normalized.append(
            {
                "schemaName": schema_name,
                "caption": row.get("caption") or "",
                "description": row.get("description") or "",
                "score": row.get("score"),
            }
        )
    return normalized


def sanitize_schema_name(value):
    parts = re.findall(r"[A-Za-z0-9]+", value or "")
    return "".join(part[:1].upper() + part[1:] for part in parts if part)


def pick_top_schema_candidate(context_payload, table_matches, lookup_matches):
    context_tables = normalize_table_matches((context_payload or {}).get("similar-tables"))
    if context_tables:
        return {"schemaName": context_tables[0]["schemaName"], "source": "dataforge-context"}
    if table_matches:
        return {"schemaName": table_matches[0]["schemaName"], "source": "dataforge-find-tables"}
    if lookup_matches:
        return {"schemaName": lookup_matches[0]["schemaName"], "source": "dataforge-find-lookups"}
    return None


def run_discover(
    *,
    environment_name,
    app_name,
    requirement_summary,
    candidate_terms,
    lookup_hints,
    output_path,
):
    output_path = Path(output_path)
    payload = {
        "appName": app_name,
        "environmentName": environment_name,
        "requirements": {"summary": requirement_summary},
        "candidateTerms": list(candidate_terms or []),
        "lookupHints": list(lookup_hints or []),
        "calls": [],
        "dataforgeAvailability": "ready",
        "status": {},
        "initialDiscovery": {},
        "context": {"executed": False, "trigger": None},
        "schemaConfirmation": {"executed": False, "tool": None, "schemaName": None},
        "concepts": [],
    }

    def call_tool(tool_name, arguments, timeout=120):
        payload["calls"].append(tool_name)
        return call_mcp_tool(tool_name, arguments, timeout)

    status_result = call_tool("dataforge-status", {"environment-name": environment_name}, 60)
    status_data = status_result.get("data") or {}
    payload["status"] = status_data
    if not status_result.get("success") or status_data.get("status") != "Ready":
        payload["dataforgeAvailability"] = "unavailable"
        write_json(output_path, payload)
        return output_path

    table_result = call_tool(
        "dataforge-find-tables",
        {"environment-name": environment_name, "query": candidate_terms[0] if candidate_terms else requirement_summary},
        60,
    )
    table_matches = normalize_table_matches((table_result.get("data") or {}).get("tables"))

    lookup_query = lookup_hints[0] if lookup_hints else requirement_summary
    lookup_result = call_tool(
        "dataforge-find-lookups",
        {"environment-name": environment_name, "query": lookup_query},
        60,
    )
    lookup_matches = normalize_lookup_matches((lookup_result.get("data") or {}).get("lookups"))

    payload["initialDiscovery"] = {
        "tables": table_matches,
        "lookups": lookup_matches,
    }

    context_trigger = None
    if table_matches:
        context_trigger = "dataforge-find-tables"
    elif lookup_matches:
        context_trigger = "dataforge-find-lookups"

    context_data = {}
    if context_trigger:
        context_result = call_tool(
            "dataforge-context",
            {
                "environment-name": environment_name,
                "candidate-terms": list(candidate_terms or []),
                "lookup-hints": list(lookup_hints or []),
                "requirement-summary": requirement_summary,
            },
            90,
        )
        context_data = context_result.get("data") or {}
        payload["context"] = {
            "executed": True,
            "trigger": context_trigger,
            "topSchemaCandidate": pick_top_schema_candidate(context_data, table_matches, lookup_matches),
            "similarTables": normalize_table_matches(context_data.get("similar-tables")),
            "similarLookups": normalize_lookup_matches(context_data.get("similar-lookups")),
        }

    top_candidate = pick_top_schema_candidate(context_data, table_matches, lookup_matches)
    if top_candidate and top_candidate.get("schemaName"):
        schema_name = top_candidate["schemaName"]
        schema_result = call_tool(
            "get-entity-schema-properties",
            {"environment-name": environment_name, "schema-name": schema_name},
            60,
        )
        payload["schemaConfirmation"] = {
            "executed": True,
            "tool": "get-entity-schema-properties",
            "schemaName": schema_name,
            "result": schema_result.get("data") or {},
        }

    concept_name = candidate_terms[0] if candidate_terms else "Discovered Concept"
    payload["concepts"] = [
        {
            "businessConcept": concept_name,
            "candidateTerms": list(candidate_terms or []),
            "lookupHints": list(lookup_hints or []),
            "initialDiscovery": {
                "triggeredBy": [tool for tool in ("dataforge-find-tables", "dataforge-find-lookups") if tool in payload["calls"]],
                "topTableCandidates": table_matches,
                "topLookupCandidates": lookup_matches,
            },
            "context": dict(payload["context"]),
            "schemaConfirmation": dict(payload["schemaConfirmation"]),
        }
    ]
    write_json(output_path, payload)
    return output_path


def build_discovery_evidence(concept):
    tools = []
    initial = concept.get("initialDiscovery") or {}
    triggered_by = initial.get("triggeredBy") or []
    for tool_name in triggered_by:
        if tool_name not in tools:
            tools.append(tool_name)
    context = concept.get("context") or {}
    if context.get("executed") and "dataforge-context" not in tools:
        tools.append("dataforge-context")
    schema_confirmation = concept.get("schemaConfirmation") or {}
    if schema_confirmation.get("executed"):
        tool_name = schema_confirmation.get("tool")
        if tool_name and tool_name not in tools:
            tools.append(tool_name)
    return ", ".join(tools) if tools else "dataforge-find-tables"


def build_candidate_fit_summary(concept):
    context = concept.get("context") or {}
    candidate = (context.get("topSchemaCandidate") or {}).get("schemaName")
    if candidate:
        return f"{candidate} is the strongest reusable candidate surfaced by live discovery."
    lookups = ((concept.get("initialDiscovery") or {}).get("topLookupCandidates") or [])
    if lookups:
        return f"{lookups[0].get('schemaName')} is the strongest lookup candidate surfaced by live discovery."
    return "No strong reusable candidate surfaced during the initial discovery pass."


def build_required_capabilities(concept, discovery_payload):
    summary = ((discovery_payload.get("requirements") or {}).get("summary") or "").strip()
    if summary:
        return summary
    return f"Technical capabilities required for {concept.get('businessConcept', 'the approved concept')}."


def build_mismatch_evidence(concept):
    context = concept.get("context") or {}
    candidate = (context.get("topSchemaCandidate") or {}).get("schemaName")
    if candidate:
        return f"No stronger candidate provided a better match than {candidate}; reuse remains the default until explicit rejection evidence is recorded."
    return "no suitable candidate found after dataforge-find-tables and dataforge-find-lookups"


def choose_action(concept):
    candidate = ((concept.get("context") or {}).get("topSchemaCandidate") or {}).get("schemaName")
    return "reuse" if candidate else "create"


def choose_schema(concept):
    candidate = ((concept.get("context") or {}).get("topSchemaCandidate") or {}).get("schemaName")
    if candidate:
        return candidate
    return f"Usr{sanitize_schema_name(concept.get('businessConcept', 'Record'))}"


def render_model_decisions(discovery_payload):
    lines = ["## Model Decisions", ""]
    concepts = discovery_payload.get("concepts") or []
    for concept in concepts:
        business_concept = concept.get("businessConcept") or "Discovered Concept"
        chosen_action = choose_action(concept)
        chosen_schema = choose_schema(concept)
        candidate_schema = ((concept.get("context") or {}).get("topSchemaCandidate") or {}).get("schemaName")
        rejected_candidates = "none" if chosen_action == "reuse" and candidate_schema else "no suitable candidate found"
        rationale = (
            f"Live discovery surfaced {candidate_schema} as the strongest reusable candidate."
            if candidate_schema
            else "Initial discovery did not surface a strong reusable candidate."
        )
        lines.extend(
            [
                f"- business-concept: {business_concept}",
                f"  candidates-considered: {candidate_schema or 'no suitable candidate found'}",
                f"  chosen-action: {chosen_action}",
                f"  chosen-schema: {chosen_schema}",
                "  tradeoff-escalation: none",
                f"  rationale: {rationale}",
                f"  rejected-candidates: {rejected_candidates}",
                f"  candidate-fit-summary: {build_candidate_fit_summary(concept)}",
                f"  required-capabilities: {build_required_capabilities(concept, discovery_payload)}",
                f"  mismatch-evidence: {build_mismatch_evidence(concept)}",
                f"  discovery-evidence: {build_discovery_evidence(concept)}",
                "",
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


def run_render_model_decisions(discovery_path, output_path):
    discovery_payload = read_json(discovery_path)
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(render_model_decisions(discovery_payload), encoding="utf-8")
    return output_path


def build_parser():
    parser = argparse.ArgumentParser(prog="model_discovery_runner.py")
    subparsers = parser.add_subparsers(dest="command", required=True)

    discover_parser = subparsers.add_parser("discover")
    discover_parser.add_argument("--env", required=True, dest="environment_name")
    discover_parser.add_argument("--app", required=True, dest="app_name")
    discover_parser.add_argument("--requirement-summary")
    discover_parser.add_argument("--requirement-summary-file")
    discover_parser.add_argument("--candidate-term", action="append", dest="candidate_terms", default=[])
    discover_parser.add_argument("--lookup-hint", action="append", dest="lookup_hints", default=[])
    discover_parser.add_argument("--output", required=True)

    render_parser = subparsers.add_parser("render-model-decisions")
    render_parser.add_argument("--discovery", required=True)
    render_parser.add_argument("--output", required=True)
    return parser


def main(argv=None):
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "discover":
        requirement_summary = read_requirement_summary(args.requirement_summary, args.requirement_summary_file)
        run_discover(
            environment_name=args.environment_name,
            app_name=args.app_name,
            requirement_summary=requirement_summary,
            candidate_terms=args.candidate_terms,
            lookup_hints=args.lookup_hints,
            output_path=args.output,
        )
        return 0
    if args.command == "render-model-decisions":
        run_render_model_decisions(args.discovery, args.output)
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

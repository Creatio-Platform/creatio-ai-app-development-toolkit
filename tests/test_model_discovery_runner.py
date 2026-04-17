import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
import uuid
import shutil


ROOT = Path(__file__).resolve().parents[1]
TEST_TMP_ROOT = ROOT / ".tmp-tests"
TEST_TMP_ROOT.mkdir(parents=True, exist_ok=True)
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


from scripts import model_discovery_runner


def write_json(path: Path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


class TempDir:
    def __enter__(self):
        self.path = TEST_TMP_ROOT / f"model-discovery-{uuid.uuid4().hex}"
        self.path.mkdir(parents=True, exist_ok=False)
        return self.path

    def __exit__(self, exc_type, exc_val, exc_tb):
        shutil.rmtree(self.path, ignore_errors=True)


class ModelDiscoveryRunnerTests(unittest.TestCase):
    def test_discover_marks_dataforge_unavailable_when_status_is_not_ready(self):
        with TempDir() as tmp:
            output_path = tmp / "model-discovery.json"

            def fake_call(tool_name, arguments, timeout=120):
                self.assertEqual(tool_name, "dataforge-status")
                self.assertEqual(arguments["environment-name"], "env1")
                return {
                    "success": True,
                    "data": {
                        "success": True,
                        "status": "Maintenance",
                    },
                    "raw": "{}",
                }

            with patch("scripts.model_discovery_runner.call_mcp_tool", side_effect=fake_call):
                result = model_discovery_runner.run_discover(
                    environment_name="env1",
                    app_name="UsrTestApp",
                    requirement_summary="Support app",
                    candidate_terms=["Case"],
                    lookup_hints=["case status"],
                    output_path=output_path,
                )

            self.assertEqual(result, output_path)
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["dataforgeAvailability"], "unavailable")
            self.assertEqual(payload["status"]["status"], "Maintenance")
            self.assertEqual(payload["calls"], ["dataforge-status"])
            self.assertFalse(payload["context"]["executed"])

    def test_discover_calls_dataforge_context_immediately_after_first_non_empty_lookup_hit(self):
        with TempDir() as tmp:
            output_path = tmp / "model-discovery.json"
            observed_calls = []

            def fake_call(tool_name, arguments, timeout=120):
                observed_calls.append((tool_name, arguments))
                if tool_name == "dataforge-status":
                    return {"success": True, "data": {"success": True, "status": "Ready"}, "raw": "{}"}
                if tool_name == "dataforge-find-tables":
                    return {"success": True, "data": {"success": True, "tables": []}, "raw": "{}"}
                if tool_name == "dataforge-find-lookups":
                    return {
                        "success": True,
                        "data": {
                            "success": True,
                            "lookups": [
                                {"schema-name": "CaseStatus", "value": "In progress", "score": 0.98},
                            ],
                        },
                        "raw": "{}",
                    }
                if tool_name == "dataforge-context":
                    self.assertEqual(arguments["candidate-terms"], ["Case"])
                    self.assertEqual(arguments["lookup-hints"], ["case status"])
                    return {
                        "success": True,
                        "data": {
                            "success": True,
                            "similar-tables": [
                                {"name": "Case", "caption": "", "description": "Tracks support cases."}
                            ],
                            "similar-lookups": [
                                {"schema-name": "CaseStatus", "value": "In progress", "score": 0.98}
                            ],
                        },
                        "raw": "{}",
                    }
                if tool_name == "get-entity-schema-properties":
                    self.assertEqual(arguments["schema-name"], "Case")
                    return {
                        "success": True,
                        "data": {"success": True, "schema": {"name": "Case"}},
                        "raw": "{}",
                    }
                raise AssertionError(f"Unexpected tool call: {tool_name}")

            with patch("scripts.model_discovery_runner.call_mcp_tool", side_effect=fake_call):
                model_discovery_runner.run_discover(
                    environment_name="env1",
                    app_name="UsrTestApp",
                    requirement_summary="Support app",
                    candidate_terms=["Case"],
                    lookup_hints=["case status"],
                    output_path=output_path,
                )

            self.assertEqual(
                [name for name, _ in observed_calls],
                [
                    "dataforge-status",
                    "dataforge-find-tables",
                    "dataforge-find-lookups",
                    "dataforge-context",
                    "get-entity-schema-properties",
                ],
            )
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["context"]["trigger"], "dataforge-find-lookups")
            self.assertEqual(payload["schemaConfirmation"]["tool"], "get-entity-schema-properties")

    def test_normalize_lookup_matches_uses_schema_name_value_and_score(self):
        normalized = model_discovery_runner.normalize_lookup_matches(
            [
                {"schema-name": "CaseStatus", "value": "In progress", "score": 0.98},
                {"schema-name": "CasePriority", "value": "High", "score": "0.80"},
            ]
        )

        self.assertEqual(
            normalized,
            [
                {"schemaName": "CaseStatus", "value": "In progress", "score": 0.98},
                {"schemaName": "CasePriority", "value": "High", "score": 0.8},
            ],
        )

    def test_render_model_decisions_emits_validator_safe_discovery_evidence(self):
        with TempDir() as tmp:
            discovery_path = tmp / "model-discovery.json"
            output_path = tmp / "model-decisions.md"
            write_json(
                discovery_path,
                {
                    "appName": "UsrSupportCases",
                    "dataforgeAvailability": "ready",
                    "requirements": {"summary": "Support cases"},
                    "calls": [
                        "dataforge-status",
                        "dataforge-find-tables",
                        "dataforge-context",
                        "get-entity-schema-properties",
                    ],
                    "concepts": [
                        {
                            "businessConcept": "Support Case",
                            "candidateTerms": ["Case"],
                            "lookupHints": ["case status"],
                            "initialDiscovery": {
                                "triggeredBy": ["dataforge-find-tables"],
                                "topTableCandidates": [
                                    {"schemaName": "Case", "caption": "", "description": "Tracks support cases."}
                                ],
                                "topLookupCandidates": [],
                            },
                            "context": {
                                "executed": True,
                                "trigger": "dataforge-find-tables",
                                "topSchemaCandidate": {"schemaName": "Case"},
                            },
                            "schemaConfirmation": {
                                "executed": True,
                                "tool": "get-entity-schema-properties",
                                "schemaName": "Case",
                            },
                        }
                    ],
                },
            )

            result = model_discovery_runner.run_render_model_decisions(discovery_path, output_path)

            self.assertEqual(result, output_path)
            content = output_path.read_text(encoding="utf-8")
            self.assertIn("## Model Decisions", content)
            self.assertIn("discovery-evidence: dataforge-find-tables, dataforge-context, get-entity-schema-properties", content)
            self.assertIn("candidate-fit-summary:", content)
            self.assertIn("required-capabilities:", content)
            self.assertIn("mismatch-evidence:", content)
            self.assertNotIn("[None] None", content)


if __name__ == "__main__":
    unittest.main()

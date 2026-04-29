import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from workflow_validators import validate_requirements_doc, WorkflowError


VALID_DOC = """# TestApp - Requirements

## 1. Business Outcome

Provide a shared task registry.

- Core problem: tasks are scattered.
- Success signal: team tracks work in one place.
- Assumptions: MVP uses a single workflow.

## 2. Roles and Permissions

- Team member: creates and updates tasks

## 3. Object Model

### 3.1 Main entity: Task

Title: Task
Code: `UsrTask`
Entity role: `main`
Primary display field: `Name`
Description: Central work item.
Purpose: Central work item.

| Title | Code | Description | Data type | Required | Default |
| --- | --- | --- | --- | --- | --- |
| Name | `Name` | Task title | Short text | Yes | - |
| Status | `UsrStatusId` | Lifecycle state | Lookup | Yes | New |

Minimum to create:
- Name
- Status

### 3.2 Lookups

- Title: Status; Code: `UsrTaskStatus`; Allowed values: New, Active, Done

### 3.3 Relationships

- Source entity: Task; Target entity: Status; Cardinality: N:1; Required child-side link: required; Business rationale: each task must have a status.

## 4. Lifecycle and Statuses

Tasks move through New, Active, and Done.

## 5. Business Logic

- Name and Status are required to create a task.

## 6. UX Expectations

- default list columns: Name, Status
- default filters: Status
- main form groups: Main information

## 7. Edge Cases and Exceptions

- Done tasks are excluded from active views.
"""


class TestValidateRequirementsDocSections(unittest.TestCase):
    def test_valid_doc_passes(self):
        result = validate_requirements_doc(VALID_DOC)
        self.assertIsNone(result)

    def test_missing_section_2_roles_and_permissions(self):
        doc = VALID_DOC.replace("## 2. Roles and Permissions", "## 2. Team Roles")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("## 2. Roles and Permissions", str(ctx.exception))

    def test_missing_section_1_business_outcome(self):
        doc = VALID_DOC.replace("## 1. Business Outcome", "## 1. Overview")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("## 1. Business Outcome", str(ctx.exception))

    def test_missing_section_3_object_model(self):
        doc = VALID_DOC.replace("## 3. Object Model", "## 3. Data Model")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("## 3. Object Model", str(ctx.exception))

    def test_missing_section_4_lifecycle(self):
        doc = VALID_DOC.replace("## 4. Lifecycle and Statuses", "## 4. State Machine")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("## 4. Lifecycle and Statuses", str(ctx.exception))

    def test_missing_section_5_business_logic(self):
        doc = VALID_DOC.replace("## 5. Business Logic", "## 5. Rules")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("## 5. Business Logic", str(ctx.exception))

    def test_missing_section_6_ux(self):
        doc = VALID_DOC.replace("## 6. UX Expectations", "## 6. User Interface")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("## 6. UX Expectations", str(ctx.exception))

    def test_missing_section_7_edge_cases(self):
        doc = VALID_DOC.replace("## 7. Edge Cases and Exceptions", "## 7. Notes")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("## 7. Edge Cases and Exceptions", str(ctx.exception))


class TestValidateRequirementsDocTables(unittest.TestCase):
    def test_missing_field_table_in_entity_block(self):
        doc = VALID_DOC.replace(
            "| Title | Code | Description | Data type | Required | Default |\n"
            "| --- | --- | --- | --- | --- | --- |\n"
            "| Name | `Name` | Task title | Short text | Yes | - |\n"
            "| Status | `UsrStatusId` | Lifecycle state | Lookup | Yes | New |\n",
            ""
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("field table", str(ctx.exception).lower())

    def test_table_outside_section_3_rejected(self):
        doc = VALID_DOC.replace(
            "- Name and Status are required to create a task.",
            "- Name and Status are required to create a task.\n\n"
            "| Rule | When |\n| --- | --- |\n| Validate name | Always |"
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("only in section 3", str(ctx.exception))


class TestValidateRequirementsDocMarkers(unittest.TestCase):
    def test_missing_minimum_to_create_marker(self):
        doc = VALID_DOC.replace("Minimum to create:", "Required fields:")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("Minimum to create:", str(ctx.exception))

    def test_missing_default_list_columns_marker(self):
        doc = VALID_DOC.replace("- default list columns:", "- list columns:")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("default list columns:", str(ctx.exception))

    def test_missing_default_filters_marker(self):
        doc = VALID_DOC.replace("- default filters:", "- filters:")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("default filters:", str(ctx.exception))

    def test_missing_main_form_groups_marker(self):
        doc = VALID_DOC.replace("- main form groups:", "- form sections:")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("main form groups:", str(ctx.exception))


class TestValidateRequirementsDocEntityMetadata(unittest.TestCase):
    def test_missing_entity_role_marker(self):
        doc = VALID_DOC.replace("Entity role: `main`", "")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("Entity role:", str(ctx.exception))

    def test_missing_title_line_in_entity(self):
        doc = VALID_DOC.replace("Title: Task\n", "").replace("- Title: Status;", "- Status;")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("Title:", str(ctx.exception))

    def test_missing_title_heading(self):
        doc = VALID_DOC.replace("# TestApp - Requirements", "# TestApp Notes")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("title must match", str(ctx.exception))

    def test_obsolete_section_6_rejected(self):
        doc = VALID_DOC + "\n## 6. Implementation-shaping decisions and assumptions\n\nNone.\n"
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("obsolete section 6", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()

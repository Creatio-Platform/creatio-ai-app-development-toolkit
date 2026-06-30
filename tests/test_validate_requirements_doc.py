import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime.scripts.workflow_validators import validate_requirements_doc, WorkflowError


VALID_DOC = """# TestApp - Requirements

## 1. Business Outcome

Provide a shared task registry.

- Core problem: tasks are scattered.
- Success signal: team tracks work in one place.
- Assumptions: MVP uses a single workflow.

## 2. Roles and Permissions

- Team member: creates and updates tasks

## 3. Object Model

### 3.1 Section object: Task

**Title:** Task
**Code:** `UsrTask`
**Primary display field:** `Name`
**Description:** Central work item.

| Title | Code | Description | Data type | Required | Default |
| --- | --- | --- | --- | --- | --- |
| Name | `Name` | Task title | Short text | Yes | - |
| Status | `UsrStatusId` | Lifecycle state | Lookup | Yes | New |

Minimum to create:
- Name
- Status

### 3.2 Lookups

- Title: Status; Code: `UsrTaskStatus`; Allowed values: New, Active, Done

## 4. Lifecycle and Statuses

Tasks move through New, Active, and Done.

## 5. Business Logic

- Name and Status are required to create a task.

## 6. UX Expectations

- list columns: Name, Status
- list filters: Status
- form groups: Main information

## 7. Edge Cases and Exceptions

- Done tasks are excluded from active views.
"""


class TestValidateRequirementsDocSections(unittest.TestCase):
    def test_valid_doc_passes(self):
        validate_requirements_doc(VALID_DOC)  # must not raise

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


class TestValidateRequirementsDocMarkers(unittest.TestCase):
    def test_missing_minimum_to_create_marker(self):
        doc = VALID_DOC.replace("Minimum to create:", "Required fields:")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("Minimum to create:", str(ctx.exception))

    def test_missing_list_columns_marker(self):
        doc = VALID_DOC.replace("- list columns:", "- columns:")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("list columns:", str(ctx.exception))

    def test_retired_default_list_columns_label_is_rejected(self):
        # The retired `default list columns:` label ends with `list columns:`, so a
        # plain substring check would let an un-migrated doc pass silently.
        doc = VALID_DOC.replace("- list columns: Name, Status", "- default list columns: Name, Status")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("default list", str(ctx.exception).lower())

    def test_retired_default_list_filters_label_is_rejected(self):
        doc = VALID_DOC.replace("- list filters: Status", "- default list filters: Status")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("default list", str(ctx.exception).lower())

    def test_list_filters_carrier_resolves(self):
        # filters branch of UX_CARRIER_RE: a filter title present in the object
        # model must resolve to a carrier and pass.
        doc = VALID_DOC.replace("- list filters: Status", "- list filters: Status, Name")
        validate_requirements_doc(doc)  # must not raise

    def test_list_filters_title_without_carrier_is_rejected(self):
        # Complementary negative for the filters branch: a filter title with no
        # carrier in section 3 must be rejected (guards against the branch silently
        # never running).
        doc = VALID_DOC.replace("- list filters: Status", "- list filters: Nonexistent")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("Nonexistent", str(ctx.exception))


class TestValidateRequirementsDocObjectMetadata(unittest.TestCase):
    def test_missing_title_line_in_entity(self):
        doc = VALID_DOC.replace("**Title:** Task\n", "").replace("- Title: Status;", "- Status;")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("Title:", str(ctx.exception))

    def test_missing_description_marker(self):
        doc = VALID_DOC.replace("**Description:** Central work item.\n", "")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("Description:", str(ctx.exception))

    def test_missing_title_heading(self):
        doc = VALID_DOC.replace("# TestApp - Requirements", "# TestApp Notes")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("title must match", str(ctx.exception))

    def test_missing_code_marker(self):
        # `Code:` appears in both the object block and the lookup row, and the
        # object block extends through the Lookups subsection, so drop both.
        doc = VALID_DOC.replace("**Code:** `UsrTask`\n", "").replace("Code: `UsrTaskStatus`", "`UsrTaskStatus`")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("Code:", str(ctx.exception))

    def test_missing_primary_display_field_marker(self):
        doc = VALID_DOC.replace("**Primary display field:** `Name`\n", "")
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("Primary display field:", str(ctx.exception))

    def test_object_role_and_purpose_are_optional(self):
        # `Object role:` / `Purpose:` were dropped from the required metadata
        # markers; VALID_DOC carries neither, and their absence must not fail.
        self.assertNotIn("Object role:", VALID_DOC)
        self.assertNotIn("Purpose:", VALID_DOC)
        validate_requirements_doc(VALID_DOC)  # must not raise


class TestValidateRequirementsDocRelatedListInline(unittest.TestCase):
    @staticmethod
    def _doc_with_related_list(*extra_lines):
        anchor = "- form groups: Main information\n"
        assert anchor in VALID_DOC, "fixture anchor missing from VALID_DOC"
        block = "\n\n- Related list Subtasks\n  - list columns: Name, Status\n" + "".join(
            f"  {line}\n" for line in extra_lines
        )
        return VALID_DOC.replace(anchor, anchor + block)

    def test_inline_related_list_rejects_each_page_or_form_label(self):
        for label in (
            "form fields: Name, Status",
            "form groups: Main",
            "add page: mini page (Name)",
            "edit page: full record page",
        ):
            with self.subTest(label=label):
                doc = self._doc_with_related_list("add/edit: inline in the list", label)
                with self.assertRaises(WorkflowError) as ctx:
                    validate_requirements_doc(doc)
                self.assertIn("inline related list", str(ctx.exception))

    def test_digit_named_related_list_surface_is_not_a_false_conflict(self):
        # A surface NAME may start with a digit (e.g. "360 Reviews"). It must be
        # detected as its own surface so an adjacent inline list does not absorb
        # its page/form labels and raise a false conflict.
        doc = VALID_DOC.replace(
            "- form groups: Main information\n",
            "- form groups: Main information\n\n"
            "- Related list Subtasks\n  - list columns: Name, Status\n  - add/edit: inline in the list\n\n"
            "- Related list 360 Reviews\n  - list columns: Name, Status\n"
            "  - add page: mini page (Name)\n  - edit page: full record page\n  - form fields: Name, Status\n",
        )
        validate_requirements_doc(doc)  # must not raise (two distinct surfaces)

    def test_inline_related_list_without_page_labels_passes(self):
        doc = self._doc_with_related_list("add/edit: inline in the list")
        validate_requirements_doc(doc)  # must not raise

    def test_default_mini_page_related_list_passes(self):
        doc = self._doc_with_related_list(
            "add page: mini page (Name, Status)",
            "edit page: full record page",
            "form fields: Name, Status",
        )
        validate_requirements_doc(doc)  # must not raise

    def test_inline_related_list_then_section_with_form_labels_passes(self):
        # Regression: a trailing Section's page/form labels must NOT fold into
        # the preceding inline related list's block.
        doc = VALID_DOC.replace(
            "- form groups: Main information\n",
            "- form groups: Main information\n\n"
            "- Related list Subtasks\n  - list columns: Name, Status\n  - add/edit: inline in the list\n\n"
            "- Section Reports\n  - list columns: Name\n  - form groups: Overview\n",
        )
        validate_requirements_doc(doc)  # must not raise

    def test_backticked_bold_related_list_heading_is_detected(self):
        # The §6 contract renders a surface as `- **`Related list <name>`**`. The
        # heading regex must match that form, otherwise the inline conflict check
        # silently becomes a no-op on contract-conforming plans.
        doc = VALID_DOC.replace(
            "- form groups: Main information\n",
            "- form groups: Main information\n\n"
            "- **`Related list Subtasks`**\n  - list columns: Name, Status\n"
            "  - add/edit: inline in the list\n  - form groups: Main\n",
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("inline related list", str(ctx.exception))

    def test_cyrillic_named_related_list_surface_is_detected(self):
        # The code comment at the surface regex claims non-Latin (Cyrillic) names
        # are supported; pin it — a Cyrillic-named surface must still be detected
        # so its own inline/page-label conflict fires.
        doc = VALID_DOC.replace(
            "- form groups: Main information\n",
            "- form groups: Main information\n\n"
            "- Related list Підрядники\n  - list columns: Name, Status\n"
            "  - add/edit: inline in the list\n  - add page: mini page (Name)\n",
        )
        with self.assertRaises(WorkflowError) as ctx:
            validate_requirements_doc(doc)
        self.assertIn("inline related list", str(ctx.exception))

    def test_inline_related_list_then_bare_section_object_bullets_pass(self):
        # A heading-less surface (the section object, or the "single full page"
        # option) is described with bare top-level `form groups:` bullets. Those
        # must NOT be absorbed into a preceding inline related list's block, which
        # would raise a false conflict.
        doc = VALID_DOC.replace(
            "- form groups: Main information\n",
            "- Related list Subtasks\n  - list columns: Name, Status\n"
            "  - add/edit: inline in the list\n"
            "- form groups: Main information\n",
        )
        validate_requirements_doc(doc)  # must not raise


if __name__ == "__main__":
    unittest.main()

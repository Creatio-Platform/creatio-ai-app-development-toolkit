import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.page_body_edit import (
    add_form_fields,
    add_list_columns,
    detect_vm_marker,
    find_max_row_index,
    replace_marker_content,
    validate_body_structure,
)
from scripts.page_body_tools import extract_attribute_paths, parse_marker_json

FIXTURES = ROOT / "tests" / "fixtures"


FORM_PAGE_BODY = """define("UsrTest_FormPage", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, function/**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/ {
\treturn {
\t\tviewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[
\t\t\t{
\t\t\t\t"operation": "insert",
\t\t\t\t"name": "Name",
\t\t\t\t"values": {
\t\t\t\t\t"layoutConfig": {
\t\t\t\t\t\t"column": 1,
\t\t\t\t\t\t"row": 1,
\t\t\t\t\t\t"colSpan": 1,
\t\t\t\t\t\t"rowSpan": 1
\t\t\t\t\t},
\t\t\t\t\t"type": "crt.Input",
\t\t\t\t\t"control": "$Name"
\t\t\t\t},
\t\t\t\t"parentName": "SideAreaProfileContainer",
\t\t\t\t"propertyName": "items",
\t\t\t\t"index": 0
\t\t\t},
\t\t\t{
\t\t\t\t"operation": "merge",
\t\t\t\t"name": "Feed",
\t\t\t\t"values": {
\t\t\t\t\t"type": "crt.Feed",
\t\t\t\t\t"dataSourceName": "PDS"
\t\t\t\t},
\t\t\t\t"parentName": "FeedTabContainer",
\t\t\t\t"propertyName": "items",
\t\t\t\t"index": 0
\t\t\t}
\t\t]/**SCHEMA_VIEW_CONFIG_DIFF*/,
\t\tviewModelConfig: /**SCHEMA_VIEW_MODEL_CONFIG*/{
\t\t\t"attributes": {
\t\t\t\t"Name": {
\t\t\t\t\t"modelConfig": {
\t\t\t\t\t\t"path": "PDS.Name"
\t\t\t\t\t}
\t\t\t\t},
\t\t\t\t"Id": {
\t\t\t\t\t"modelConfig": {
\t\t\t\t\t\t"path": "PDS.Id"
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
\t\t}/**SCHEMA_VIEW_MODEL_CONFIG*/,
\t\tmodelConfig: /**SCHEMA_MODEL_CONFIG*/{
\t\t\t"dataSources": {
\t\t\t\t"PDS": {
\t\t\t\t\t"type": "crt.EntityDataSource",
\t\t\t\t\t"config": {
\t\t\t\t\t\t"entitySchemaName": "UsrTest"
\t\t\t\t\t}
\t\t\t\t}
\t\t\t}
\t\t}/**SCHEMA_MODEL_CONFIG*/,
\t\thandlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
\t\tconverters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/,
\t\tvalidators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/
\t};
});"""


LIST_PAGE_BODY = """define("UsrTest_ListPage", /**SCHEMA_DEPS*/[]/**SCHEMA_DEPS*/, function/**SCHEMA_ARGS*/()/**SCHEMA_ARGS*/ {
\treturn {
\t\tviewConfigDiff: /**SCHEMA_VIEW_CONFIG_DIFF*/[
\t\t\t{
\t\t\t\t"operation": "merge",
\t\t\t\t"name": "DataTable",
\t\t\t\t"values": {
\t\t\t\t\t"columns": [
\t\t\t\t\t\t{
\t\t\t\t\t\t\t"id": "aaa-bbb",
\t\t\t\t\t\t\t"code": "PDS_Name",
\t\t\t\t\t\t\t"caption": "#ResourceString(PDS_Name)#",
\t\t\t\t\t\t\t"dataValueType": 1
\t\t\t\t\t\t},
\t\t\t\t\t]
\t\t\t\t}
\t\t\t}
\t\t]/**SCHEMA_VIEW_CONFIG_DIFF*/,
\t\tviewModelConfigDiff: /**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/[
\t\t\t{
\t\t\t\t"operation": "merge",
\t\t\t\t"path": [
\t\t\t\t\t"attributes",
\t\t\t\t\t"Items",
\t\t\t\t\t"viewModelConfig",
\t\t\t\t\t"attributes"
\t\t\t\t],
\t\t\t\t"values": {
\t\t\t\t\t"PDS_Name": {
\t\t\t\t\t\t"modelConfig": {
\t\t\t\t\t\t\t"path": "PDS.Name"
\t\t\t\t\t\t}
\t\t\t\t\t},
\t\t\t\t}
\t\t\t}
\t\t]/**SCHEMA_VIEW_MODEL_CONFIG_DIFF*/,
\t\tmodelConfigDiff: /**SCHEMA_MODEL_CONFIG_DIFF*/[
\t\t\t{
\t\t\t\t"operation": "merge",
\t\t\t\t"path": ["dataSources", "PDS", "config"],
\t\t\t\t"values": {
\t\t\t\t\t"entitySchemaName": "UsrTest"
\t\t\t\t}
\t\t\t}
\t\t]/**SCHEMA_MODEL_CONFIG_DIFF*/,
\t\thandlers: /**SCHEMA_HANDLERS*/[]/**SCHEMA_HANDLERS*/,
\t\tconverters: /**SCHEMA_CONVERTERS*/{}/**SCHEMA_CONVERTERS*/,
\t\tvalidators: /**SCHEMA_VALIDATORS*/{}/**SCHEMA_VALIDATORS*/
\t};
});"""


class TestValidateBodyStructure(unittest.TestCase):
    def test_valid_form_page(self):
        result = validate_body_structure(FORM_PAGE_BODY)
        self.assertTrue(result["valid"])
        self.assertEqual(result["errors"], [])

    def test_valid_list_page(self):
        result = validate_body_structure(LIST_PAGE_BODY)
        self.assertTrue(result["valid"])
        self.assertEqual(result["errors"], [])

    def test_missing_marker_detected(self):
        broken = FORM_PAGE_BODY.replace("/**SCHEMA_HANDLERS*/", "")
        result = validate_body_structure(broken)
        self.assertFalse(result["valid"])
        self.assertTrue(any("SCHEMA_HANDLERS" in e for e in result["errors"]))


class TestDetectVmMarker(unittest.TestCase):
    def test_detects_object_variant(self):
        self.assertEqual(detect_vm_marker(FORM_PAGE_BODY), "SCHEMA_VIEW_MODEL_CONFIG")

    def test_detects_diff_variant(self):
        self.assertEqual(detect_vm_marker(LIST_PAGE_BODY), "SCHEMA_VIEW_MODEL_CONFIG_DIFF")


class TestAddFormFields(unittest.TestCase):
    def test_adds_fields_to_form_page(self):
        fields = [
            {"name": "UsrStatus", "type": "crt.ComboBox", "path": "PDS.UsrStatus"},
            {"name": "UsrDueDate", "type": "crt.DateTimePicker", "path": "PDS.UsrDueDate", "pickerType": "date"},
        ]
        result = add_form_fields(FORM_PAGE_BODY, fields)
        validation = validate_body_structure(result)
        self.assertTrue(validation["valid"], f"Validation errors: {validation['errors']}")
        view_config = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        insert_names = [op["name"] for op in view_config if op.get("operation") == "insert"]
        self.assertIn("UsrStatus", insert_names)
        self.assertIn("UsrDueDate", insert_names)
        status_insert = next(op for op in view_config if op.get("name") == "UsrStatus")
        self.assertEqual(status_insert["values"]["type"], "crt.ComboBox")
        self.assertEqual(status_insert["values"]["control"], "$UsrStatus")
        self.assertEqual(status_insert["parentName"], "SideAreaProfileContainer")
        self.assertEqual(status_insert["values"]["layoutConfig"]["row"], 2)
        due_insert = next(op for op in view_config if op.get("name") == "UsrDueDate")
        self.assertEqual(due_insert["values"]["type"], "crt.DateTimePicker")
        self.assertEqual(due_insert["values"]["pickerType"], "date")
        self.assertEqual(due_insert["values"]["layoutConfig"]["row"], 3)

    def test_adds_attributes_to_view_model_config_object(self):
        fields = [
            {"name": "UsrStatus", "type": "crt.ComboBox", "path": "PDS.UsrStatus"},
        ]
        result = add_form_fields(FORM_PAGE_BODY, fields)
        attr_paths = extract_attribute_paths(result)
        self.assertEqual(attr_paths["UsrStatus"], "PDS.UsrStatus")
        self.assertEqual(attr_paths["Name"], "PDS.Name")

    def test_skips_existing_fields(self):
        fields = [
            {"name": "Name", "type": "crt.Input", "path": "PDS.Name"},
            {"name": "UsrNew", "type": "crt.Input", "path": "PDS.UsrNew"},
        ]
        result = add_form_fields(FORM_PAGE_BODY, fields)
        view_config = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        name_inserts = [op for op in view_config if op.get("name") == "Name" and op.get("operation") == "insert"]
        self.assertEqual(len(name_inserts), 1)
        usr_inserts = [op for op in view_config if op.get("name") == "UsrNew"]
        self.assertEqual(len(usr_inserts), 1)

    def test_multiline_input_field(self):
        fields = [
            {"name": "UsrDescription", "type": "crt.Input", "path": "PDS.UsrDescription", "multiline": True},
        ]
        result = add_form_fields(FORM_PAGE_BODY, fields)
        view_config = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        desc_insert = next(op for op in view_config if op.get("name") == "UsrDescription")
        self.assertTrue(desc_insert["values"]["multiline"])

    def test_preserves_non_insert_operations(self):
        fields = [
            {"name": "UsrField", "type": "crt.Input", "path": "PDS.UsrField"},
        ]
        result = add_form_fields(FORM_PAGE_BODY, fields)
        view_config = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        feed_ops = [op for op in view_config if op.get("name") == "Feed"]
        self.assertEqual(len(feed_ops), 1)
        self.assertEqual(feed_ops[0]["operation"], "merge")


class TestAddListColumns(unittest.TestCase):
    def test_adds_columns_to_list_page(self):
        columns = [
            {"code": "PDS_UsrStatus", "dataValueType": 10, "width": 144},
            {"code": "PDS_UsrDueDate", "dataValueType": 8, "width": 144},
        ]
        result = add_list_columns(LIST_PAGE_BODY, columns)
        validation = validate_body_structure(result)
        self.assertTrue(validation["valid"], f"Validation errors: {validation['errors']}")
        view_config = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        dt_op = next(op for op in view_config if op.get("name") == "DataTable")
        col_codes = [c["code"] for c in dt_op["values"]["columns"]]
        self.assertIn("PDS_Name", col_codes)
        self.assertIn("PDS_UsrStatus", col_codes)
        self.assertIn("PDS_UsrDueDate", col_codes)

    def test_adds_attributes_to_view_model_config_diff(self):
        columns = [
            {"code": "PDS_UsrStatus", "dataValueType": 10},
        ]
        result = add_list_columns(LIST_PAGE_BODY, columns)
        vm_data = parse_marker_json(result, "SCHEMA_VIEW_MODEL_CONFIG_DIFF")
        merge_op = next(op for op in vm_data if "attributes" in (op.get("path") or []))
        self.assertIn("PDS_UsrStatus", merge_op["values"])
        self.assertEqual(merge_op["values"]["PDS_UsrStatus"]["modelConfig"]["path"], "PDS.UsrStatus")

    def test_skips_existing_columns(self):
        columns = [
            {"code": "PDS_Name", "dataValueType": 1},
            {"code": "PDS_UsrNew", "dataValueType": 10},
        ]
        result = add_list_columns(LIST_PAGE_BODY, columns)
        view_config = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        dt_op = next(op for op in view_config if op.get("name") == "DataTable")
        name_cols = [c for c in dt_op["values"]["columns"] if c["code"] == "PDS_Name"]
        self.assertEqual(len(name_cols), 1)
        new_cols = [c for c in dt_op["values"]["columns"] if c["code"] == "PDS_UsrNew"]
        self.assertEqual(len(new_cols), 1)

    def test_handles_trailing_commas_in_columns(self):
        result = add_list_columns(LIST_PAGE_BODY, [{"code": "PDS_UsrField", "dataValueType": 1}])
        validation = validate_body_structure(result)
        self.assertTrue(validation["valid"])


class TestRoundTrip(unittest.TestCase):
    def test_form_page_round_trip(self):
        fields = [
            {"name": "UsrStatus", "type": "crt.ComboBox", "path": "PDS.UsrStatus"},
            {"name": "UsrPriority", "type": "crt.ComboBox", "path": "PDS.UsrPriority"},
            {"name": "UsrDueDate", "type": "crt.DateTimePicker", "path": "PDS.UsrDueDate"},
            {"name": "UsrDescription", "type": "crt.Input", "path": "PDS.UsrDescription", "multiline": True},
        ]
        result = add_form_fields(FORM_PAGE_BODY, fields)
        view_config_1 = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        result2 = add_form_fields(result, fields)
        view_config_2 = parse_marker_json(result2, "SCHEMA_VIEW_CONFIG_DIFF")
        self.assertEqual(len(view_config_1), len(view_config_2))

    def test_list_page_round_trip(self):
        columns = [
            {"code": "PDS_UsrStatus", "dataValueType": 10},
            {"code": "PDS_UsrPriority", "dataValueType": 10},
        ]
        result = add_list_columns(LIST_PAGE_BODY, columns)
        view_config_1 = parse_marker_json(result, "SCHEMA_VIEW_CONFIG_DIFF")
        result2 = add_list_columns(result, columns)
        view_config_2 = parse_marker_json(result2, "SCHEMA_VIEW_CONFIG_DIFF")
        dt1 = next(op for op in view_config_1 if op.get("name") == "DataTable")
        dt2 = next(op for op in view_config_2 if op.get("name") == "DataTable")
        self.assertEqual(len(dt1["values"]["columns"]), len(dt2["values"]["columns"]))


class TestLiveFixture(unittest.TestCase):
    def test_add_fields_to_live_fixture(self):
        fixture_path = FIXTURES / "test1_form_page_live.js"
        if not fixture_path.exists():
            self.skipTest("Live fixture not available")
        body = fixture_path.read_text(encoding="utf-8")
        fields = [
            {"name": "UsrNewField", "type": "crt.Input", "path": "PDS.UsrNewField"},
        ]
        result = add_form_fields(body, fields)
        validation = validate_body_structure(result)
        self.assertTrue(validation["valid"], f"Validation errors: {validation['errors']}")
        attr_paths = extract_attribute_paths(result)
        self.assertEqual(attr_paths["UsrNewField"], "PDS.UsrNewField")
        self.assertEqual(attr_paths["Name"], "PDS.Name")


if __name__ == "__main__":
    unittest.main()

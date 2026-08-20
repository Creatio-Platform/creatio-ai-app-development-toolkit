"""Unit tests for transcript parsing helpers."""
import unittest

import parsing


class RoleExtractionTest(unittest.TestCase):
    def test_a_build_agent(self):
        self.assertEqual(parsing.role_from_opening("You are a BUILD agent of a run."), "BUILD")

    def test_the_refs_step(self):
        self.assertEqual(parsing.role_from_opening("You are the REFS step of a run."), "REFS")

    def test_persistence_lowercased_prompt_uppercased_role(self):
        self.assertEqual(
            parsing.role_from_opening("You are the persistence step of a run."), "PERSISTENCE"
        )

    def test_compound_role_folds_to_first_word(self):
        # "PREFLIGHT MERGE step" folds onto the enumerated PREFLIGHT role.
        self.assertEqual(
            parsing.role_from_opening("You are the PREFLIGHT MERGE step of a run."), "PREFLIGHT"
        )

    def test_judge_followed_by_of(self):
        self.assertEqual(
            parsing.role_from_opening("You are the JUDGE of a Freedom build run."), "JUDGE"
        )

    def test_unrecognised_opening_is_none(self):
        self.assertIsNone(parsing.role_from_opening("Please summarise the following."))


class UsageTest(unittest.TestCase):
    def test_usage_from_message(self):
        obj = {"message": {"usage": {"input_tokens": 5}}}
        self.assertEqual(parsing.usage_of(obj)["input_tokens"], 5)

    def test_usage_top_level(self):
        obj = {"usage": {"output_tokens": 7}}
        self.assertEqual(parsing.usage_of(obj)["output_tokens"], 7)

    def test_no_usage(self):
        self.assertIsNone(parsing.usage_of({"message": {}}))

    def test_ttl_breakdown(self):
        usage = {"cache_creation": {"ephemeral_5m_input_tokens": 80,
                                    "ephemeral_1h_input_tokens": 20}}
        self.assertEqual(parsing.cache_creation_ttl(usage), (80, 20))

    def test_ttl_absent_is_zero(self):
        self.assertEqual(parsing.cache_creation_ttl({"cache_creation_input_tokens": 100}), (0, 0))


class OffloadRefTest(unittest.TestCase):
    def test_windows_path(self):
        text = r"Output too large. saved to C:\x\y\tool-results\mcp-clio-clio-run-1.txt"
        self.assertEqual(parsing.offloaded_filename(text), "mcp-clio-clio-run-1.txt")

    def test_posix_path(self):
        text = "saved to /home/u/tool-results/b0ix2h4s7.txt for later"
        self.assertEqual(parsing.offloaded_filename(text), "b0ix2h4s7.txt")

    def test_no_reference(self):
        self.assertIsNone(parsing.offloaded_filename("ordinary inline result"))


if __name__ == "__main__":
    unittest.main()

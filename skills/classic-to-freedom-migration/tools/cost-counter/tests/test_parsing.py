"""Unit tests for transcript parsing helpers."""
import json
import os
import shutil
import tempfile
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


class FirstTimestampTest(unittest.TestCase):
    """A bare subagent has no run file, so its transcript's first timestamp is
    the only thing that can place its stage in execution order -- and it is
    written ISO-8601 while a workflow's ``startTime`` is epoch-ms."""

    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="cc-parsing-")

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def _write(self, records):
        path = os.path.join(self.dir, "t.jsonl")
        with open(path, "w", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record) + "\n")
        return path

    def test_iso_utc_stamp_converts_to_epoch_ms(self):
        path = self._write([{"timestamp": "1970-01-01T00:00:01.500Z"}])
        self.assertEqual(parsing.first_timestamp_ms(path), 1500.0)

    def test_the_first_stamp_wins_not_the_last(self):
        path = self._write([
            {"type": "user", "timestamp": "1970-01-01T00:00:01.000Z"},
            {"type": "assistant", "timestamp": "1970-01-01T00:01:00.000Z"},
        ])
        self.assertEqual(parsing.first_timestamp_ms(path), 1000.0)

    def test_a_naive_stamp_is_read_as_utc(self):
        # Not local time: the workflow startTime it is compared against is epoch
        # ms, so a local-time reading would shift the stage by the UTC offset.
        path = self._write([{"timestamp": "1970-01-01T00:00:02"}])
        self.assertEqual(parsing.first_timestamp_ms(path), 2000.0)

    def test_a_malformed_stamp_is_skipped_not_fatal(self):
        path = self._write([
            {"timestamp": "not-a-date"},
            {"timestamp": ""},
            {"timestamp": 12345},
            {"timestamp": "1970-01-01T00:00:03.000Z"},
        ])
        self.assertEqual(parsing.first_timestamp_ms(path), 3000.0)

    def test_no_timestamp_anywhere_is_none(self):
        # The caller sorts such a stage last rather than guessing a position.
        path = self._write([{"message": {"role": "user", "content": "hi"}}])
        self.assertIsNone(parsing.first_timestamp_ms(path))


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

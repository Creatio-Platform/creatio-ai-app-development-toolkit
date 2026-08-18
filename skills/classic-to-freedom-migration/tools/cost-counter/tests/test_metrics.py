"""Unit tests for the weighted-cost metric (T1 -> R4, T2 -> R3)."""
import unittest

import metrics


class TtlWeightTest(unittest.TestCase):
    """T1: effective cache-write weight = (tok5m*1.25 + tok1h*2.0)/(tok5m+tok1h)."""

    def test_blend_of_two_buckets(self):
        w = metrics.effective_cache_write_weight(80, 20)
        self.assertAlmostEqual(w, (80 * 1.25 + 20 * 2.0) / 100)

    def test_reproduces_baseline_split(self):
        # The Applicant baseline: 21.29M @5m, 4.70M @1h -> w = 1.39.
        w = metrics.effective_cache_write_weight(21_286_807, 4_703_517)
        self.assertAlmostEqual(w, 1.386, places=3)

    def test_all_5m_is_the_5m_rate(self):
        self.assertAlmostEqual(metrics.effective_cache_write_weight(1000, 0), 1.25)

    def test_all_1h_is_the_1h_rate(self):
        self.assertAlmostEqual(metrics.effective_cache_write_weight(0, 1000), 2.0)

    def test_no_volume_is_zero(self):
        self.assertEqual(metrics.effective_cache_write_weight(0, 0), 0.0)


class WeightedCostTest(unittest.TestCase):
    """T2: cost = input + w*cache_write + 0.1*cache_read + 5*output."""

    def test_formula(self):
        cost = metrics.weighted_cost(
            input_tokens=100, cache_write=200, cache_read=1000, output=10,
            cache_write_weight=1.5,
        )
        self.assertAlmostEqual(cost, 100 + 1.5 * 200 + 0.1 * 1000 + 5 * 10)

    def test_cache_read_is_cheaper_than_input(self):
        only_read = metrics.weighted_cost(0, 0, 1000, 0, 1.4)
        only_input = metrics.weighted_cost(1000, 0, 0, 0, 1.4)
        self.assertLess(only_read, only_input)

    def test_output_is_the_most_expensive_measure(self):
        n = 1000
        out = metrics.weighted_cost(0, 0, 0, n, 1.4)
        self.assertEqual(out, 5 * n)
        self.assertGreater(out, metrics.weighted_cost(n, 0, 0, 0, 1.4))

    def test_config_is_printed_not_hidden(self):
        lines = metrics.CostConfig().as_lines(effective_w=1.39)
        blob = "\n".join(lines)
        # The weights that drive the number must appear as configuration text.
        self.assertIn("0.10", blob)   # cache_read
        self.assertIn("5.00", blob)   # output
        self.assertIn("1.25", blob)   # cache_write 5m
        self.assertIn("2.00", blob)   # cache_write 1h
        self.assertIn("1.39", blob)   # effective w for this run


if __name__ == "__main__":
    unittest.main()

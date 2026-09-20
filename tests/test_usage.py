import io
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

from jevsim import usage
from jevsim.models import Jev


class UsageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.file = Path(self.temp.name) / "usage.json"
        self.patcher = patch("jevsim.usage.path", return_value=self.file)
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        self.temp.cleanup()

    def test_counts_inflight_reported_tokens_and_exact_price(self):
        key = usage.begin()
        self.assertEqual(usage.summary()["in_flight"], 1)
        response = {"model": "jev-1.13.0", "usage": {"input_tokens": 1000, "output_tokens": 240}}
        usage.finish(key, response)
        usage.finish(key, response)  # Duplicate notifications cannot double-charge.
        result = usage.summary()
        self.assertEqual(result["requests"], 1)
        self.assertEqual(result["responses"], 1)
        self.assertEqual(result["input_tokens"], 1000)
        self.assertEqual(result["output_tokens"], 240)
        self.assertEqual(result["estimated_cost_usd"], .000042)
        self.assertEqual(result["in_flight"], 0)
        self.assertTrue(self.file.exists())

    def test_missing_unknown_failed_and_restarted_calls_are_explicit(self):
        usage.finish(usage.begin(), {"model": "jev-1.13.0"})
        usage.finish(usage.begin(), {"model": "future-model", "usage": {"input_tokens": 10, "output_tokens": 2}})
        usage.finish(usage.begin(), failed=True)
        usage.begin()
        usage.recover()
        result = usage.summary()
        self.assertEqual(result["requests"], 4)
        self.assertEqual(result["failed"], 2)
        self.assertEqual(result["unreported_requests"], 3)
        self.assertEqual(result["unpriced_requests"], 4)
        self.assertEqual(result["input_tokens"], 10)
        self.assertEqual(result["in_flight"], 0)
        self.assertEqual(result["estimated_cost_usd"], 0)

    def test_http_response_is_metered_before_decision_validation(self):
        raw = {"model": "jev-1.13.0", "usage": {"input_tokens": 100, "output_tokens": 20},
               "answers": {"action": {"probabilities": {"A": .1, "B": .1}}}}
        with patch("urllib.request.OpenerDirector.open", return_value=io.BytesIO(json.dumps(raw).encode())):
            with self.assertRaises(ValueError):
                Jev(api_key="never-log-this", track_usage=True).decide({}, {"A": "A", "B": "B"}, "Pick")
        self.assertEqual(usage.summary()["input_tokens"], 100)
        self.assertEqual(usage.summary()["responses"], 1)
        self.assertNotIn("never-log-this", self.file.read_text())

    def test_untracked_policy_and_rejected_budget_do_not_charge(self):
        policy = Jev(api_key="test", track_usage=True, max_requests=0)
        with self.assertRaises(RuntimeError):
            policy.request({})
        self.assertEqual(usage.summary()["requests"], 0)
        self.assertFalse(self.file.exists())

    def test_concurrent_calls_preserve_totals(self):
        def run(_):
            usage.finish(usage.begin(), {"model": "jev-1.13.0", "usage": {"input_tokens": 11, "output_tokens": 3}})
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(run, range(40)))
        result = usage.summary()
        self.assertEqual(result["requests"], 40)
        self.assertEqual(result["responses"], 40)
        self.assertEqual(result["input_tokens"], 440)
        self.assertEqual(result["output_tokens"], 120)


if __name__ == "__main__":
    unittest.main()

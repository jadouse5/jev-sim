import io
import json
import os
import stat
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from jevsim import Simulation
from jevsim.environments import Warehouse
from jevsim.models import DemoPolicy
from jevsim.server import Handler, JOBS, JOBS_LOCK, RunCancelled, execute, make_policy
from jevsim.settings import load_settings, save_settings


class LiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.env_patch = patch.dict(os.environ, {}, clear=True)
        self.env_patch.start()
        self.cwd_patch = patch("jevsim.settings.Path.cwd", return_value=self.directory)
        self.cwd_patch.start()

    def tearDown(self):
        self.cwd_patch.stop()
        self.env_patch.stop()
        self.temp.cleanup()

    def configure(self):
        return save_settings({"api_key": "secret-test-fixture", "model": "jev-latest", "max_requests": 100})

    def handler(self):
        handler = object.__new__(Handler)
        handler.wfile = io.BytesIO()
        handler.send_headers = Mock()
        return handler

    def provider_response(self, request, **kwargs):
        payload = json.loads(request.data)
        actions = payload["questions"]["action"]["criteria"]
        action = "WAIT" if "WAIT" in actions else next(iter(actions))
        return io.BytesIO(json.dumps({"model": "jev-fixture", "answers": {"action": {
            "probabilities": {a: float(a == action) for a in actions}, "confidence": 1.0}},
            "usage": {"input_tokens": 25}}).encode())

    def test_save_private_file_without_leaking_key(self):
        path = self.directory / ".env"
        path.write_text('# Existing settings\nKEEP_ME="preserved"\nTYPESAFE_MODEL=old\nTYPESAFE_MODEL=duplicate\n')
        settings = self.configure()
        self.assertTrue(settings.public()["configured"])
        self.assertNotIn("secret-test-fixture", json.dumps(settings.public()))
        self.assertNotIn("secret-test-fixture", repr(settings))
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        self.assertIn('KEEP_ME="preserved"', path.read_text())
        self.assertEqual(path.read_text().count("TYPESAFE_MODEL="), 1)
        save_settings({"api_key": "", "model": "jev-preview", "max_requests": 50})
        self.assertEqual(load_settings().api_key, "secret-test-fixture")
        self.assertEqual(load_settings().model, "jev-preview")

    def test_env_example_style_reload_and_precedence(self):
        os.environ["TYPESAFE_API_KEY"] = "process-key"
        self.assertEqual(load_settings().source, "process environment")
        path = self.directory / ".env"
        path.write_text("TYPESAFE_API_KEY='file-key'\nTYPESAFE_MODEL=jev-preview # comment\nJEV_SIM_MAX_REQUESTS=30\n")
        self.assertEqual(load_settings().api_key, "file-key")
        self.assertEqual(load_settings().model, "jev-preview")
        self.assertEqual(load_settings().max_requests, 30)
        path.write_text("TYPESAFE_API_KEY=your-typesafe-api-key\n")
        self.assertFalse(load_settings().public()["configured"])

    def test_injection_and_symlink_are_rejected(self):
        with self.assertRaises(ValueError):
            save_settings({"api_key": "secret\nEXTRA=value"})
        with self.assertRaises(ValueError):
            save_settings({"api_key": "valid", "model": "jev\nOTHER=secret"})
        with self.assertRaises(ValueError):
            save_settings({"api_key": "valid", "max_requests": True})
        target = self.directory / "other"
        target.write_text("KEEP=1\n")
        (self.directory / ".env").symlink_to(target)
        with self.assertRaises(ValueError):
            self.configure()
        self.assertEqual(target.read_text(), "KEEP=1\n")

    def test_missing_key_never_falls_back_to_demo(self):
        with self.assertRaisesRegex(ValueError, "Connect Jev first"):
            execute("/api/run", {"episodes": 1})
        result = execute("/api/run", {"episodes": 1, "policy": "demo"})
        self.assertEqual(result["policy"], "demo-policy-v1")

    def test_real_adapter_streams_before_and_after_provider_response(self):
        self.configure()
        handler = self.handler()
        def respond(request, **kwargs):
            # The client receives status before a provider call finishes.
            sent = handler.wfile.getvalue().decode()
            self.assertIn('"type": "inference"', sent)
            self.assertNotIn('"type": "result"', sent)
            self.assertEqual(request.full_url, "https://api.typesafe.ai/v1/systemone")
            self.assertEqual(request.get_header("Authorization"), "Bearer secret-test-fixture")
            return self.provider_response(request)
        with patch("urllib.request.OpenerDirector.open", side_effect=respond) as network:
            handler.stream("/api/run", {"run_id": "test-live-run", "episodes": 2, "max_steps": 2})
        events = [json.loads(line) for line in handler.wfile.getvalue().splitlines()]
        self.assertEqual(network.call_count, 4)  # No invisible post-run exploration calls.
        self.assertEqual(len([e for e in events if e["type"] == "step"]), 4)
        self.assertEqual(events[-1]["type"], "result")
        self.assertEqual(events[-1]["result"]["policy"], "jev-latest")
        self.assertEqual(events[-1]["result"]["trajectories"][0]["steps"][0]["metadata"]["model"], "jev-fixture")
        self.assertNotIn(b"secret-test-fixture", handler.wfile.getvalue())
        self.assertNotIn("test-live-run", JOBS)

    def test_cancel_in_flight_stops_before_next_api_call(self):
        self.configure()
        handler = self.handler()
        def respond(request, **kwargs):
            with JOBS_LOCK:
                JOBS["cancel-test-run"].set()
            return self.provider_response(request)
        with patch("urllib.request.OpenerDirector.open", side_effect=respond) as network:
            handler.stream("/api/run", {"run_id": "cancel-test-run", "episodes": 20})
        events = [json.loads(line) for line in handler.wfile.getvalue().splitlines()]
        self.assertEqual(network.call_count, 1)
        self.assertEqual(events[-1]["type"], "cancelled")
        self.assertNotIn("cancel-test-run", JOBS)

    def test_budget_error_is_explicit_and_partial_progress_survives(self):
        self.configure()
        handler = self.handler()
        with patch("urllib.request.OpenerDirector.open", side_effect=self.provider_response) as network:
            handler.stream("/api/run", {"run_id": "budget-test-run", "episodes": 3, "max_requests": 1})
        events = [json.loads(line) for line in handler.wfile.getvalue().splitlines()]
        self.assertEqual(network.call_count, 1)
        self.assertIn("step", [event["type"] for event in events])
        self.assertEqual(events[-1]["type"], "error")
        self.assertIn("budget exhausted", events[-1]["error"])

    def test_all_operations_use_selected_real_policy(self):
        self.configure()
        trace = Simulation(Warehouse(), DemoPolicy()).episode(42, max_steps=2)
        for route, data in (("/api/explore", {"depth": 1}),
                            ("/api/fuzz", {"scenarios": 1, "episodes": 1, "max_steps": 1}),
                            ("/api/counterfactual", {"trace": trace.to_dict(), "step": 0, "episodes": 1, "max_steps": 1})):
            with self.subTest(route=route):
                events = []
                with patch("urllib.request.OpenerDirector.open", side_effect=self.provider_response) as network:
                    execute(route, data, events.append)
                self.assertGreater(network.call_count, 0)
                self.assertIn("inference_complete", [event["type"] for event in events])

    def test_hooks_do_not_change_simulation_results(self):
        simulation = Simulation(Warehouse(), DemoPolicy())
        events = []
        before = simulation.run(20, seed=7)
        after = simulation.run(20, seed=7, on_event=events.append)
        self.assertEqual([t.to_dict() for t in before.trajectories], [t.to_dict() for t in after.trajectories])
        self.assertEqual(len([event for event in events if event["type"] == "episode"]), 20)


if __name__ == "__main__":
    unittest.main()

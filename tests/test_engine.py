import copy
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from jevsim import Decision, Simulation, Transition
from jevsim.analysis.counterfactual import counterfactual
from jevsim.analysis.failures import fuzz
from jevsim.analysis.results import wilson
from jevsim.core.contracts import validated_transitions
from jevsim.core.trajectory import Trajectory
from jevsim.environments import Warehouse, catalog, make_environment
from jevsim.models import DemoPolicy, FunctionPolicy, HTTPPolicy, Jev
from jevsim.server import execute


class CoinWorld:
    name = "coin"
    title = "Coin"

    def reset(self, seed=0):
        return {"step": 0}

    def actions(self, state):
        return {"RISK": "Flip coin", "SAFE": "Safe return"}

    def objective(self):
        return "Win"

    def transitions(self, state, action):
        if action == "SAFE":
            return [Transition({"step": 1}, outcome="safe_return", reward=1)]
        return [Transition({"step": 1}, 0.25, 10, "success"),
                Transition({"step": 1}, 0.75, -10, "failure")]


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.env = CoinWorld()
        self.policy = FunctionPolicy(lambda *_: {"RISK": 0.6, "SAFE": 0.4})
        self.sim = Simulation(self.env, self.policy)

    def test_probability_contract_rejects_invalid_distributions(self):
        for probabilities in ({}, {"RISK": 1}, {"RISK": -0.1, "SAFE": 1.1},
                              {"RISK": float("nan"), "SAFE": 0}, {"RISK": 2, "SAFE": 1},
                              {"RISK": True, "SAFE": False}, {"RISK": float("inf"), "SAFE": 0}):
            with self.subTest(probabilities=probabilities), self.assertRaises(ValueError):
                Decision(probabilities).validate(["RISK", "SAFE"])
        self.assertEqual(Decision({"RISK": .5, "SAFE": .5}).entropy, 1)

    def test_seeded_runs_are_reproducible(self):
        a = Simulation(Warehouse(), DemoPolicy()).run(100, seed=9)
        b = Simulation(Warehouse(), DemoPolicy()).run(100, seed=9)
        self.assertEqual([t.to_dict() for t in a.trajectories], [t.to_dict() for t in b.trajectories])
        c = Simulation(Warehouse(), DemoPolicy()).run(100, seed=10)
        self.assertNotEqual(a.trajectories[0].to_dict(), c.trajectories[0].to_dict())

    def test_monte_carlo_matches_exact_probability(self):
        result = self.sim.run(10000, seed=7).to_dict(0)
        self.assertAlmostEqual(result["outcomes"]["success"]["rate"], .15, delta=.015)
        self.assertAlmostEqual(result["outcomes"]["failure"]["rate"], .45, delta=.02)
        self.assertAlmostEqual(result["outcomes"]["safe_return"]["rate"], .4, delta=.02)

    def test_replay_takes_argmax_but_environment_still_stochastic(self):
        result = self.sim.run(200, mode="replay")
        self.assertTrue(all(t.steps[0]["action"] == "RISK" for t in result.trajectories))
        self.assertEqual({t.outcome for t in result.trajectories}, {"success", "failure"})
        self.assertIsNone(result.to_dict(0)["outcomes"]["success"]["interval"])

    def test_branch_multiplies_policy_and_transition_probabilities(self):
        tree = self.sim.explore(depth=1, branches=2)
        self.assertAlmostEqual(tree["outcome_mass"]["success"], .15)
        self.assertAlmostEqual(tree["outcome_mass"]["failure"], .45)
        self.assertAlmostEqual(tree["outcome_mass"]["safe_return"], .4)
        self.assertAlmostEqual(tree["total_mass"], 1)
        self.assertEqual(tree["pruned_mass"], 0)
        self.assertEqual(tree["frontier_mass"], 0)

    def test_branch_caps_conserve_probability_mass(self):
        for branches in (1, 2, 3):
            for max_nodes in (1, 2, 3, 10, 100):
                for depth in (0, 1, 3, 6):
                    tree = Simulation(Warehouse(), DemoPolicy()).explore(depth=depth, branches=branches, max_nodes=max_nodes)
                    self.assertAlmostEqual(tree["total_mass"], 1, places=10)
                    self.assertLessEqual(len(tree["nodes"]), max_nodes)
                    self.assertTrue(all(n["mass"] >= 0 for n in tree["nodes"]))

    def test_pruning_does_not_renormalize(self):
        tree = self.sim.explore(depth=1, branches=1)
        self.assertAlmostEqual(tree["pruned_mass"], .4)
        self.assertAlmostEqual(tree["outcome_mass"]["success"], .15)

    def test_intervention_uses_recorded_state(self):
        trace = self.sim.episode(42)
        result = counterfactual(self.sim, trace, 0, episodes=2000)
        safe = next(a for a in result["alternatives"] if a["action"] == "SAFE")
        risk = next(a for a in result["alternatives"] if a["action"] == "RISK")
        self.assertEqual(safe["outcomes"]["safe_return"]["rate"], 1)
        self.assertAlmostEqual(risk["outcomes"]["success"]["rate"], .25, delta=.04)
        self.assertEqual(result["state"], trace.initial_state)
        with self.assertRaises(ValueError):
            counterfactual(self.sim, trace, 50)

    def test_trace_round_trip(self):
        trace = Simulation(Warehouse(battery=58), DemoPolicy()).episode(8)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "trace.json"
            trace.save(path)
            loaded = Trajectory.load(path)
        self.assertEqual(loaded.to_dict(), trace.to_dict())
        self.assertEqual(loaded.config["battery"], 58)

    def test_environments_do_not_mutate_state_and_have_valid_transitions(self):
        for item in catalog():
            env = make_environment(item["id"])
            state = env.reset(42)
            before = copy.deepcopy(state)
            for action in env.actions(state):
                validated_transitions(env, state, action)
                self.assertEqual(state, before)
            result = Simulation(env, DemoPolicy()).run(30, max_steps=20)
            self.assertEqual(len(result.trajectories), 30)

    def test_fuzz_reproducible_findings(self):
        a = fuzz("support", DemoPolicy(), scenarios=12, episodes=5, seed=123)
        b = fuzz("support", DemoPolicy(), scenarios=12, episodes=5, seed=123)
        self.assertEqual(a, b)
        self.assertGreater(a["failure_scenarios"], 0)
        f = a["findings"][0]
        result = Simulation(make_environment("support", f["config"]), DemoPolicy()).run(f["episodes"], seed=f["seed"]).to_dict(0)
        self.assertEqual(f["failures"], result["outcomes"]["failure"]["count"] + result["outcomes"]["critical_failure"]["count"])

    def test_timeout_and_invalid_arguments(self):
        result = Simulation(Warehouse(), FunctionPolicy(lambda *_: "WAIT")).run(1, max_steps=1)
        self.assertEqual(result.trajectories[0].outcome, "timeout")
        for kwargs in ({"episodes": 0}, {"max_steps": 0}, {"mode": "wrong"}):
            with self.assertRaises(ValueError):
                self.sim.run(**kwargs)
        with self.assertRaises(ValueError):
            Warehouse(battery=200)
        with self.assertRaises(ValueError):
            Warehouse(unknown=1)

    def test_wilson_handles_boundary_proportions(self):
        lower, upper = wilson(0, 100)
        self.assertAlmostEqual(lower, 0)
        self.assertGreater(upper, 0)
        self.assertLess(upper, .05)
        lower, upper = wilson(100, 100)
        self.assertGreater(lower, .95)
        self.assertAlmostEqual(upper, 1)

    def test_api_validation_and_output(self):
        result = execute("/api/run", {"episodes": 20, "environment": "support", "policy": "demo"})
        self.assertEqual(result["episodes"], 20)
        self.assertEqual(result["tree"]["kind"], "recorded_trace")
        for data in ({"episodes": 10001}, {"episodes": True}, {"max_steps": -1}, {"environment": "missing"}, []):
            with self.assertRaises(ValueError):
                execute("/api/run", data)

    def test_jev_request_contract_and_metadata(self):
        jev = Jev(api_key="test-key")
        response = {"model": "jev-test-version", "answers": {"action": {"probabilities": {"RISK": .7, "SAFE": .3}, "confidence": .4}}, "usage": {"input_tokens": 50}}
        with patch.object(jev, "request", return_value=response) as request:
            decision = jev.decide({"step": 0}, self.env.actions({}), "Win")
            payload = request.call_args.args[0]
            self.assertEqual(payload["questions"]["action"]["type"], "choice")
            self.assertEqual(set(payload["questions"]["action"]["criteria"]), {"RISK", "SAFE"})
            self.assertEqual(decision.metadata["model"], "jev-test-version")
            self.assertEqual(decision.confidence, .4)

    def test_http_budget_stops_before_network(self):
        policy = HTTPPolicy("http://localhost:8000/decide", max_requests=0)
        with self.assertRaisesRegex(RuntimeError, "budget exhausted"):
            policy.decide({}, {"A": "Action"}, "test")


if __name__ == "__main__":
    unittest.main()

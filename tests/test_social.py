import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from jevsim import social
from jevsim.models import DemoPolicy, Jev
from jevsim.models.http import jev_choice
from jevsim.core.contracts import Decision
from jevsim.server import RunCancelled


class SocialTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root_patch = patch("jevsim.social.root", return_value=Path(self.temp.name))
        self.root_patch.start()
        self.events = []

    def tearDown(self):
        self.root_patch.stop()
        self.temp.cleanup()

    def generate(self, count=4, policy=None):
        return social.generate({**social.PRESETS[0], "count": count}, policy or DemoPolicy(), self.events.append)

    def provider(self, request, **kwargs):
        payload = json.loads(request.data)
        answers = {}
        for key, question in payload["questions"].items():
            self.assertEqual(question["type"], "choice")
            options = question["criteria"]
            choice = "ASK_PEERS" if key == "action" else next(iter(options))
            answers[key] = {"probabilities": {k: float(k == choice) for k in options}, "confidence": 1}
        return io.BytesIO(json.dumps({"model": "jev-test", "answers": answers}).encode())

    def test_real_adapter_batches_typed_traits_and_records_exact_input(self):
        with patch("urllib.request.OpenerDirector.open", side_effect=self.provider) as request:
            policy = Jev(api_key="test-secret", max_requests=8)
            world = self.generate(policy=policy)
            self.assertEqual(request.call_count, 4)
            self.assertEqual(len(world["people"][0]["generation"]["traits"]), 4)
            result = social.simulate({"world_id": world["id"], "rounds": 1}, policy, self.events.append)
            self.assertEqual(request.call_count, 8)
            self.assertEqual(result["round"], 1)
            for decision in result["decisions"]:
                self.assertEqual(decision["action"], "ASK_PEERS")
                self.assertEqual(decision["model"], "jev-test")
                self.assertIn("observed_peers", decision["input"])
                self.assertEqual(set(decision["probabilities"]), set(social.ACTIONS))
            self.assertNotIn("test-secret", json.dumps(result))

    def rounded_provider(self, request, **kwargs):
        payload = json.loads(request.data)
        answers = {}
        for key, question in payload["questions"].items():
            keys = list(question["criteria"])
            weights = {3: [.6, .29, .1], 4: [.6, .19, .1, .1], 5: [.6, .19, .1, .09, .01]}[len(keys)]
            answers[key] = {"probabilities": dict(zip(keys, weights)), "confidence": .75}
        return io.BytesIO(json.dumps({"model": "jev-rounded-fixture", "answers": answers}).encode())

    def test_rounded_provider_supports_generation_run_and_interview(self):
        with patch("urllib.request.OpenerDirector.open", side_effect=self.rounded_provider):
            policy = Jev(api_key="rounding-test-secret", max_requests=9)
            world = self.generate(policy=policy)
            world = social.simulate({"world_id": world["id"], "rounds": 1}, policy, self.events.append)
            result = social.interview({"world_id": world["id"], "person_id": "p0", "question": "Would you support this?"}, policy, self.events.append)
        self.assertEqual(world["round"], 1)
        self.assertEqual(policy.requests, 9)
        for decision in world["decisions"]:
            self.assertAlmostEqual(sum(decision["probabilities"].values()), 1)
            self.assertAlmostEqual(decision["provider_probability_total"], .99)
            self.assertTrue(decision["probabilities_normalized"])
        self.assertTrue(result["answer"]["probabilities_normalized"])
        requests = [e for e in self.events if e["type"] == "inference"]
        responses = [e for e in self.events if e["type"] == "inference_complete"]
        self.assertEqual(len(requests), 9)
        self.assertEqual({e["request_id"] for e in requests}, {e["request_id"] for e in responses})
        self.assertIn("state", requests[0]["request"])
        self.assertTrue(responses[0]["answers"]["priority"]["probabilities_normalized"])
        self.assertNotIn("rounding-test-secret", json.dumps(self.events))
        self.assertNotIn("Authorization", json.dumps(self.events))

    def test_rounding_is_bounded_and_does_not_relax_engine_contract(self):
        for probabilities in ({"a": .6, "b": .39}, {"a": .6, "b": .41}):
            result = jev_choice({"probabilities": probabilities}, ["a", "b"])
            self.assertAlmostEqual(sum(result.probabilities.values()), 1)
            self.assertEqual(result.metadata["provider_probabilities"], probabilities)
            with self.assertRaises(ValueError):
                Decision(probabilities).validate(["a", "b"])
        invalid = [{"a": .5, "b": .4}, {"a": 0, "b": 0}, {"a": -0.1, "b": 1},
                   {"a": True, "b": 0}, {"a": float("nan"), "b": 1},
                   {"a": float("inf"), "b": 0}, {"a": 1.01, "b": 0}, {"a": 1}]
        for values in invalid:
            with self.subTest(values=values), self.assertRaises(ValueError):
                jev_choice({"probabilities": values}, ["a", "b"])

    def test_environment_lab_uses_same_rounding_adapter(self):
        with patch("urllib.request.OpenerDirector.open", side_effect=self.rounded_provider):
            decision = Jev(api_key="test").decide({}, social.ACTIONS, "Respond")
        self.assertAlmostEqual(sum(decision.probabilities.values()), 1)
        self.assertTrue(decision.metadata["probabilities_normalized"])

    def test_failed_request_is_streamed_without_credentials(self):
        with patch("urllib.request.OpenerDirector.open", side_effect=RuntimeError("Provider rate limit reached")):
            with self.assertRaisesRegex(RuntimeError, "rate limit"):
                self.generate(policy=Jev(api_key="private-fixture"))
        failure = next(e for e in self.events if e["type"] == "inference_error")
        request = next(e for e in self.events if e["type"] == "inference")
        self.assertEqual(failure["request_id"], request["request_id"])
        self.assertEqual(failure["api_calls"], 1)
        self.assertNotIn("private-fixture", json.dumps(self.events))

    def test_generated_graph_is_connected_and_seeded(self):
        a, b = self.generate(), self.generate()
        self.assertEqual(a["people"], b["people"])
        self.assertEqual(a["edges"], b["edges"])
        reached = {a["people"][0]["id"]}
        for _ in a["people"]:
            for e in a["edges"]:
                if reached.intersection(e.values()):
                    reached.update(e.values())
        self.assertEqual(reached, {p["id"] for p in a["people"]})

    def test_large_cast_and_repeated_additions_have_unique_identities(self):
        world = self.generate(count=30)
        world = social.add_people({"world_id": world["id"], "count": 35}, DemoPolicy(), self.events.append)
        world = social.add_people({"world_id": world["id"], "count": 2}, DemoPolicy(), self.events.append)
        self.assertEqual(len(world["people"]), 67)
        self.assertEqual(len({p["id"] for p in world["people"]}), 67)
        self.assertEqual(len({p["name"] for p in world["people"]}), 67)
        self.assertEqual(len(world["snapshots"][0]["people"]), 30)
        self.assertLess(len(world["edges"]), 67 * 5)
        ids = {p["id"] for p in world["people"]}
        self.assertTrue(all(set(e.values()) <= ids for e in world["edges"]))

    def test_addition_keeps_history_and_forks_use_correct_population(self):
        world = self.generate()
        world = social.simulate({"world_id": world["id"], "rounds": 1}, DemoPolicy(), self.events.append)
        snapshots, decisions = copy.deepcopy(world["snapshots"]), copy.deepcopy(world["decisions"])
        world = social.add_people({"world_id": world["id"], "count": 2}, DemoPolicy(), self.events.append)
        self.assertEqual(world["snapshots"], snapshots)
        self.assertEqual(world["decisions"], decisions)
        before = social.fork({"world_id": world["id"], "round": 0})
        after = social.fork({"world_id": world["id"], "round": 1})
        self.assertEqual(len(before["people"]), 4)
        self.assertEqual(len(after["people"]), 6)
        self.assertTrue(all(set(e.values()) <= {p["id"] for p in before["people"]} for e in before["edges"]))
        world = social.simulate({"world_id": world["id"], "rounds": 1}, DemoPolicy(), self.events.append)
        self.assertEqual(len(world["decisions"]), 10)
        self.assertEqual(len(world["snapshots"][-1]["people"]), 6)

    def test_cancelled_addition_keeps_every_completed_new_person(self):
        world = self.generate()
        def emit(event):
            if event["type"] == "person_added":
                raise RunCancelled()
        with self.assertRaises(RunCancelled):
            social.add_people({"world_id": world["id"], "count": 5}, DemoPolicy(), emit)
        saved = social.read(world["id"])
        self.assertEqual(len(saved["people"]), 5)
        self.assertNotIn(world["id"], social.ACTIVE)
        self.assertTrue(saved["complete_cast"])

    def test_cannot_expand_while_world_is_running(self):
        world = self.generate()
        social.ACTIVE.add(world["id"])
        try:
            with self.assertRaisesRegex(ValueError, "current operation"):
                social.add_people({"world_id": world["id"], "count": 1}, DemoPolicy(), self.events.append)
        finally:
            social.ACTIVE.discard(world["id"])

    def test_rounds_are_synchronous_and_resume_reproducibly(self):
        a, b = self.generate(), self.generate()
        a = social.simulate({"world_id": a["id"], "rounds": 3}, DemoPolicy(), self.events.append)
        for _ in range(3):
            b = social.simulate({"world_id": b["id"], "rounds": 1}, DemoPolicy(), self.events.append)
        self.assertEqual(a["decisions"], b["decisions"])
        for d in a["decisions"]:
            before = a["snapshots"][d["round"] - 1]["people"]
            for peer in d["input"]["observed_peers"]:
                self.assertEqual(peer["stance_value"], next(p["stance"] for p in before if p["id"] == peer["id"]))

    def test_injected_event_during_round_survives_commit_and_arrives_next_round(self):
        world = self.generate()
        injected = []
        def emit(event):
            if event["type"] == "social_decision" and not injected:
                injected.append(social.inject({"world_id": world["id"], "text": "A delivery subsidy is announced."}))
        result = social.simulate({"world_id": world["id"], "rounds": 2}, DemoPolicy(), emit)
        self.assertEqual(result["events"][0]["round"], 2)
        for d in result["decisions"]:
            self.assertEqual(bool(d["input"]["events"]), d["round"] == 2)

    def test_cancellation_discards_unfinished_round_and_releases_world(self):
        world = self.generate()
        def emit(event):
            if event["type"] == "social_decision":
                raise RunCancelled()
        with self.assertRaises(RunCancelled):
            social.simulate({"world_id": world["id"], "rounds": 1}, DemoPolicy(), emit)
        self.assertEqual(social.read(world["id"])["round"], 0)
        self.assertEqual(social.read(world["id"])["decisions"], [])
        self.assertNotIn(world["id"], social.ACTIVE)

    def test_budget_keeps_completed_rounds_without_extra_calls(self):
        world = self.generate()
        with patch("urllib.request.OpenerDirector.open", side_effect=self.provider) as request:
            with self.assertRaisesRegex(RuntimeError, "budget exhausted"):
                social.simulate({"world_id": world["id"], "rounds": 3}, Jev(api_key="fixture", max_requests=5), self.events.append)
            self.assertEqual(request.call_count, 5)
        saved = social.read(world["id"])
        self.assertEqual(saved["round"], 1)
        self.assertEqual(len(saved["decisions"]), 4)

    def test_fork_restores_memory_and_forces_only_one_decision(self):
        world = self.generate()
        world = social.simulate({"world_id": world["id"], "rounds": 3}, DemoPolicy(), self.events.append)
        fork = social.fork({"world_id": world["id"], "round": 1, "person_id": "p0", "action": "OPPOSE", "text": "New evidence."})
        self.assertEqual(fork["people"], world["snapshots"][1]["people"])
        self.assertEqual(len(fork["decisions"]), 4)
        fork = social.simulate({"world_id": fork["id"], "rounds": 2}, DemoPolicy(), self.events.append)
        forced = [d for d in fork["decisions"] if d["forced"]]
        self.assertEqual([(d["person_id"], d["round"], d["action"]) for d in forced], [("p0", 2, "OPPOSE")])
        self.assertEqual(social.read(world["id"])["decisions"], world["decisions"])

    def test_partial_cast_cannot_run(self):
        def emit(event):
            if event["type"] == "persona":
                raise RunCancelled()
        with self.assertRaises(RunCancelled):
            social.generate({**social.PRESETS[0], "count": 4}, DemoPolicy(), emit)
        world = social.listing()[0]
        with self.assertRaisesRegex(ValueError, "incomplete"):
            social.simulate({"world_id": world["id"]}, DemoPolicy(), self.events.append)

    def test_saved_partial_cast_can_be_run_by_explicit_choice(self):
        world = self.generate()
        world["complete_cast"] = False
        world["edges"] = []
        world["snapshots"] = []
        original_people = copy.deepcopy(world["people"])
        social.save(world)
        with self.assertRaisesRegex(ValueError, "incomplete"):
            social.simulate({"world_id": world["id"], "rounds": 1}, DemoPolicy(), self.events.append)
        result = social.simulate({"world_id": world["id"], "rounds": 1, "use_generated_cast": True}, DemoPolicy(), self.events.append)
        self.assertTrue(result["complete_cast"])
        self.assertTrue(result["recovered_partial_cast"])
        self.assertEqual(result["snapshots"][0]["people"], original_people)
        self.assertEqual(len(result["decisions"]), 4)
        self.assertTrue(result["edges"])

    def test_edit_persists_and_completed_history_is_immutable(self):
        world = self.generate()
        edited = social.edit_person({"world_id": world["id"], "person_id": "p0", "goal": "Keep my shop accessible"})
        self.assertEqual(edited["snapshots"][0]["people"][0]["goal"], "Keep my shop accessible")
        social.simulate({"world_id": world["id"], "rounds": 1}, DemoPolicy(), self.events.append)
        with self.assertRaises(ValueError):
            social.edit_person({"world_id": world["id"], "person_id": "p0", "name": "Changed"})

    def test_interview_uses_memory_without_mutating_world(self):
        world = self.generate()
        before = social.read(world["id"])
        result = social.interview({"world_id": world["id"], "person_id": "p0", "question": "Would you support it?"}, DemoPolicy(), self.events.append)
        self.assertIn(result["answer"]["choice"], {"YES", "NO", "UNSURE"})
        self.assertEqual(social.read(world["id"]), before)

    def test_validation_rejects_path_traversal_and_invalid_roles(self):
        for value in ("../../.env", "", None, "x" * 32):
            with self.assertRaises(ValueError):
                social.read(value)
        with self.assertRaises(ValueError):
            social.generate({**social.PRESETS[0], "count": True}, DemoPolicy(), self.events.append)
        with self.assertRaises(ValueError):
            social.generate({**social.PRESETS[0], "roles": []}, DemoPolicy(), self.events.append)


if __name__ == "__main__":
    unittest.main()

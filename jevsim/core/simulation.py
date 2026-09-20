from __future__ import annotations

import copy
import random
import time

from .contracts import Environment, Policy, State, validated_transitions
from .trajectory import Trajectory
from ..analysis.results import Results


class Simulation:
    def __init__(self, environment: Environment, policy: Policy):
        self.environment = environment
        self.policy = policy

    def episode(self, seed: int, max_steps: int = 40, mode: str = "monte_carlo",
                initial_state: State | None = None, first_action: str | None = None,
                episode: int = 0, on_event=None) -> Trajectory:
        if mode not in ("monte_carlo", "replay"):
            raise ValueError("Mode must be monte_carlo or replay")
        if max_steps < 1:
            raise ValueError("max_steps must be positive")
        rng = random.Random(seed)
        state = copy.deepcopy(initial_state if initial_state is not None else self.environment.reset(seed))
        trace = Trajectory(episode, seed, self.environment.name, self.policy.name, copy.deepcopy(state),
                           config=copy.deepcopy(getattr(self.environment, "config", {})))
        if on_event:
            on_event({"type": "episode_start", "episode": episode, "state": copy.deepcopy(state)})
        for index in range(max_steps):
            actions = self.environment.actions(state)
            decision = self.policy.decide(copy.deepcopy(state), actions, self.environment.objective()).validate(list(actions))
            # Consume one action draw even when intervening, coupling environment
            # randomness across counterfactual actions with the same seed.
            selected = decision.select(rng, mode)
            action = first_action if index == 0 and first_action is not None else selected
            options = validated_transitions(self.environment, state, action)
            transition = rng.choices(options, weights=[t.probability for t in options], k=1)[0]
            trace.steps.append({"index": index, "state": copy.deepcopy(state), "action": action,
                                "probabilities": dict(decision.probabilities), "confidence": decision.confidence,
                                "entropy": decision.entropy, "next_state": copy.deepcopy(transition.state),
                                "reward": transition.reward, "event": transition.event,
                                "transition_probability": transition.probability,
                                "outcome": transition.outcome, "intervention": index == 0 and first_action is not None,
                                "metadata": copy.deepcopy(decision.metadata)})
            trace.total_reward += transition.reward
            state = copy.deepcopy(transition.state)
            if on_event:
                on_event({"type": "step", "episode": episode, "step": copy.deepcopy(trace.steps[-1])})
            if transition.outcome:
                trace.outcome = transition.outcome
                break
        return trace

    def run(self, episodes: int = 1000, max_steps: int = 40, seed: int = 42,
            mode: str = "monte_carlo", initial_state: State | None = None,
            first_action: str | None = None, on_event=None) -> Results:
        if episodes < 1:
            raise ValueError("episodes must be positive")
        start = time.perf_counter()
        traces = []
        counts = {}
        for i in range(episodes):
            trace = self.episode(seed + i, max_steps, mode, initial_state, first_action, i, on_event)
            traces.append(trace)
            counts[trace.outcome] = counts.get(trace.outcome, 0) + 1
            if on_event:
                on_event({"type": "episode", "completed": i + 1, "total": episodes,
                          "outcome": trace.outcome, "outcomes": dict(counts), "elapsed": time.perf_counter() - start})
        return Results(traces, time.perf_counter() - start, mode, seed)

    def explore(self, **kwargs) -> dict:
        from .branching import explore
        return explore(self.environment, self.policy, **kwargs)

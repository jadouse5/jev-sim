from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from typing import Any, Protocol

State = dict[str, Any]


def distribution(values: dict[str, float], allowed: list[str] | None = None) -> dict[str, float]:
    """Validate probabilities. Never silently discard actions or repair bad output."""
    if not values or (allowed is not None and set(values) != set(allowed)):
        raise ValueError("Policy must return a probability for every legal action, and no others")
    if any(isinstance(p, bool) or not isinstance(p, (int, float)) or not math.isfinite(p) or p < 0 for p in values.values()):
        raise ValueError("Probabilities must be finite, nonnegative numbers")
    total = sum(values.values())
    if not math.isclose(total, 1.0, abs_tol=1e-6):
        raise ValueError(f"Probabilities must sum to 1 (got {total})")
    return {key: value / total for key, value in values.items()}


@dataclass
class Decision:
    probabilities: dict[str, float]
    confidence: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def validate(self, actions: list[str]) -> Decision:
        self.probabilities = distribution(self.probabilities, actions)
        if self.confidence is not None and (not math.isfinite(self.confidence) or not 0 <= self.confidence <= 1):
            raise ValueError("Confidence must be in [0, 1]")
        return self

    @property
    def entropy(self) -> float:
        return -sum(p * math.log2(p) for p in self.probabilities.values() if p > 0)

    def select(self, rng: random.Random, mode: str) -> str:
        if mode == "replay":
            return max(self.probabilities, key=self.probabilities.get)
        return rng.choices(list(self.probabilities), weights=list(self.probabilities.values()), k=1)[0]


@dataclass
class Transition:
    state: State
    probability: float = 1.0
    reward: float = 0.0
    outcome: str | None = None
    event: str = ""


class Environment(Protocol):
    """State includes all history needed to make transitions Markovian.

    Methods must not mutate input state. Explicit transition probabilities let
    branching account for environment randomness as well as policy randomness.
    """
    name: str
    title: str

    def reset(self, seed: int = 0) -> State: ...
    def actions(self, state: State) -> dict[str, str]: ...
    def transitions(self, state: State, action: str) -> list[Transition]: ...
    def objective(self) -> str: ...


class Policy(Protocol):
    name: str

    def decide(self, state: State, actions: dict[str, str], objective: str) -> Decision: ...


def validated_transitions(env: Environment, state: State, action: str) -> list[Transition]:
    if action not in env.actions(state):
        raise ValueError(f"Illegal action: {action}")
    transitions = env.transitions(state, action)
    distribution({str(i): t.probability for i, t in enumerate(transitions)})
    if any(not math.isfinite(t.reward) for t in transitions):
        raise ValueError("Transition rewards must be finite")
    return transitions

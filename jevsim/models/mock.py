from __future__ import annotations

from typing import Callable

from ..core.contracts import Decision


class FunctionPolicy:
    """Adapt a pure Python function returning an action or probability mapping."""
    def __init__(self, function: Callable, name: str = "python-policy"):
        self.function = function
        self.name = name

    def decide(self, state, actions, objective):
        output = self.function(state, actions, objective)
        if isinstance(output, Decision):
            return output
        if isinstance(output, str):
            if output not in actions:
                raise ValueError(f"Policy returned illegal action: {output}")
            output = {a: float(a == output) for a in actions}
        return Decision(output)


class DemoPolicy:
    """Deliberately imperfect, hand-authored probabilities. No model inference."""
    name = "demo-policy-v1"

    def decide(self, state, actions, objective):
        s = state
        weights = {a: 1.0 for a in actions}
        kind = s.get("kind")
        if kind == "warehouse":
            weights.update(MOVE=62 if not s["obstacle"] else 21, REROUTE=12 if not s["obstacle"] else 43,
                           WAIT=3 if not s["obstacle"] else 18, RETURN=2)
            if not s["carrying"]:
                weights["PICK"] = 140
            if s["battery"] < 12 + s["distance"] * 6:
                weights["RETURN"] = 70
            if s["battery"] < 18:
                weights["RETURN"] = 150
        elif kind == "gridworld":
            weights.update(RIGHT=45 if s["x"] < 4 else 2, DOWN=45 if s["y"] < 4 else 2, LEFT=2, UP=2)
            if (s["x"] + 1, s["y"]) in ((2, 1), (2, 3)):
                weights["RIGHT"] = 6
            if (s["x"], s["y"] + 1) in ((2, 1), (2, 3)):
                weights["DOWN"] = 6
        elif kind == "support":
            eligible = s["refund_age"] <= 30 and s["previous_refunds"] < 2
            weights.update(REFUND=65 if eligible and s["verified"] else 26 if s["refund_age"] <= 33 else 5,
                           ESCALATE=20 if eligible else 40, ASK_INFO=8 if s["verified"] else 55, CLOSE=4)
        elif kind == "npc-town":
            weights.update(SOCIALIZE=65 if s["energy"] > 25 else 10,
                           REST=80 if s["energy"] < 40 and s["food"] else 5,
                           WORK=50 if s["coins"] < 2 else 7, TRADE=65 if s["food"] < 1 else 5)
        elif kind == "incident":
            weights.update(INVESTIGATE=6 if s["diagnosed"] else 58,
                           RESTART=70 if s["diagnosed"] else 22, ESCALATE=50 if s["health"] < 25 else 10, IGNORE=5)
        total = sum(weights.values())
        return Decision({a: v / total for a, v in weights.items()}, metadata={"source": "hand-authored demo policy"})

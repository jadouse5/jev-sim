from __future__ import annotations

import random
from dataclasses import replace

from ..core.contracts import State, Transition


class Scenario:
    name = ""
    title = ""
    description = ""
    parameters: dict = {}

    def __init__(self, **config):
        unknown = config.keys() - self.parameters.keys()
        if unknown:
            raise ValueError(f"Unknown parameters: {', '.join(sorted(unknown))}")
        self.config = {k: v["default"] for k, v in self.parameters.items()}
        for key, value in config.items():
            spec = self.parameters[key]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not spec["min"] <= value <= spec["max"]:
                raise ValueError(f"{key} must be between {spec['min']} and {spec['max']}")
            if spec.get("integer") and int(value) != value:
                raise ValueError(f"{key} must be an integer")
            self.config[key] = value

    def objective(self):
        return self.description


class Warehouse(Scenario):
    name = "warehouse"
    title = "Warehouse robot"
    description = "Deliver a fragile parcel to dispatch. Avoid collisions and battery depletion; return safely if necessary."
    parameters = {
        "battery": {"label": "Starting battery", "min": 10, "max": 100, "default": 72, "unit": "%", "integer": True},
        "obstacle_rate": {"label": "Aisle congestion", "min": 0, "max": 0.8, "default": 0.22, "unit": ""},
        "fragility": {"label": "Payload fragility", "min": 0, "max": 1, "default": 0.35, "unit": ""},
    }

    def reset(self, seed=0):
        return {"kind": self.name, "position": 0, "distance": 7, "battery": self.config["battery"],
                "obstacle": True, "carrying": False, "tick": 0, **{k: self.config[k] for k in ("obstacle_rate", "fragility")}}

    def actions(self, state):
        actions = {"MOVE": "Advance one aisle; a blocked aisle risks a collision",
                   "REROUTE": "Take a safe detour past one aisle, costing extra battery",
                   "WAIT": "Wait for an obstacle to clear, using a little battery",
                   "RETURN": "Return to the charging station and terminate safely"}
        if not state["carrying"]:
            actions["PICK"] = "Pick up the fragile parcel at the current position"
        return actions

    def transitions(self, state, action):
        s = dict(state, tick=state["tick"] + 1)
        if action == "RETURN":
            good = s["battery"] >= 3 + s["position"] * 3
            return [Transition(s, reward=8 if good else -80, outcome="safe_return" if good else "critical_failure",
                               event="Returned to charging station" if good else "Battery depleted on return")]
        cost = {"MOVE": 6, "REROUTE": 10, "WAIT": 2, "PICK": 3}[action]
        s["battery"] = max(0, s["battery"] - cost)
        if s["battery"] == 0:
            return [Transition(s, reward=-100, outcome="critical_failure", event="Battery depleted")]
        if action == "PICK":
            s["carrying"] = True
        if action in ("MOVE", "REROUTE"):
            s["position"] += 1
            s["distance"] -= 1
        risk = (0.06 + s["fragility"] * 0.35) if action == "MOVE" and state["obstacle"] else 0
        if s["distance"] <= 0:
            good = s["carrying"]
            normal = [Transition(s, reward=100 if good else -30, outcome="success" if good else "failure",
                                 event="Parcel delivered to dispatch" if good else "Arrived without the parcel")]
        else:
            event = {"MOVE": "Advanced one aisle", "REROUTE": "Detour completed", "WAIT": "Waited for traffic", "PICK": "Parcel secured"}[action]
            rate = s["obstacle_rate"] * (0.4 if action == "WAIT" else 1)
            normal = [Transition(dict(s, obstacle=False), 1 - rate, -cost / 10, event=event),
                      Transition(dict(s, obstacle=True), rate, -cost / 10, event=event + "; aisle blocked")]
        result = [replace(t, probability=t.probability * (1 - risk)) for t in normal]
        if risk:
            result.append(Transition(s, risk, -60, "failure", "Collision damaged the payload"))
        return result


class GridWorld(Scenario):
    name = "gridworld"
    title = "Grid world"
    description = "Reach the beacon at (4, 4) on a 5×5 grid. Avoid hazard cells (2, 1) and (2, 3)."
    parameters = {"slip": {"label": "Movement slip", "min": 0, "max": 0.5, "default": 0.12, "unit": ""}}

    def reset(self, seed=0):
        return {"kind": self.name, "x": 0, "y": 0, "goal_x": 4, "goal_y": 4, "slip": self.config["slip"], "tick": 0}

    def actions(self, state):
        return {"RIGHT": "Move east", "DOWN": "Move south", "LEFT": "Move west", "UP": "Move north"}

    def transitions(self, state, action):
        movements = {"RIGHT": (1, 0), "DOWN": (0, 1), "LEFT": (-1, 0), "UP": (0, -1)}
        dx, dy = movements[action]
        s = dict(state, x=max(0, min(4, state["x"] + dx)), y=max(0, min(4, state["y"] + dy)), tick=state["tick"] + 1)
        outcome = "success" if (s["x"], s["y"]) == (4, 4) else "failure" if (s["x"], s["y"]) in ((2, 1), (2, 3)) else None
        return [Transition(s, 1 - state["slip"], 30 if outcome == "success" else -20 if outcome else -1, outcome, "Entered hazard" if outcome == "failure" else "Moved toward beacon"),
                Transition(dict(state, tick=state["tick"] + 1), state["slip"], -1, event="Movement slipped; remained in place")]


class Support(Scenario):
    name = "support"
    title = "Customer support"
    description = "Resolve the ticket. Refund only verified orders no older than 30 days with fewer than 2 previous refunds. Escalate exceptions."
    parameters = {
        "refund_age": {"label": "Order age", "min": 1, "max": 60, "default": 31, "unit": "days", "integer": True},
        "sentiment": {"label": "Customer frustration", "min": 0, "max": 1, "default": 0.7, "unit": ""},
        "previous_refunds": {"label": "Previous refunds", "min": 0, "max": 5, "default": 2, "unit": "", "integer": True},
    }

    def reset(self, seed=0):
        return {"kind": self.name, **self.config, "verified": False, "tick": 0}

    def actions(self, state):
        return {"REFUND": "Issue a refund if eligible and verified", "ESCALATE": "Route exception to a human", "ASK_INFO": "Verify order details", "CLOSE": "Close without refund"}

    def transitions(self, state, action):
        s = dict(state, tick=state["tick"] + 1)
        if action == "ASK_INFO":
            s.update(verified=True, sentiment=min(1, s["sentiment"] + 0.08))
            risk = 0.03 + max(0, s["sentiment"] - 0.7) * 0.35
            return [Transition(s, 1 - risk, -1, event="Order details verified"), Transition(s, risk, -25, "failure", "Customer abandoned conversation")]
        if action == "ESCALATE":
            return [Transition(s, reward=8, outcome="safe_return", event="Ticket routed to a human specialist")]
        good = (s["verified"] and s["refund_age"] <= 30 and s["previous_refunds"] < 2) if action == "REFUND" else s["sentiment"] < 0.3
        return [Transition(s, reward=30 if good else -40, outcome="success" if good else "failure",
                           event="Ticket resolved" if good else "Resolution violated refund policy or customer needs")]


class NPCTown(Scenario):
    name = "npc-town"
    title = "NPC town"
    description = "Build community trust to 85 while managing a resident's energy and food. Rest, work, trade, and socialize."
    parameters = {"energy": {"label": "Initial energy", "min": 10, "max": 100, "default": 65, "unit": "%", "integer": True},
                  "trust": {"label": "Community trust", "min": 10, "max": 70, "default": 40, "unit": "%", "integer": True}}

    def reset(self, seed=0):
        return {"kind": self.name, **self.config, "food": 3, "coins": 2, "tick": 0}

    def actions(self, state):
        return {"SOCIALIZE": "Build trust, spending energy", "WORK": "Earn coins, spending energy", "TRADE": "Buy food for 2 coins", "REST": "Recover energy by eating food"}

    def transitions(self, state, action):
        s = dict(state, tick=state["tick"] + 1)
        if action == "SOCIALIZE":
            s.update(energy=s["energy"] - 13, trust=min(100, s["trust"] + 12))
        elif action == "WORK":
            s.update(energy=s["energy"] - 17, coins=s["coins"] + 3)
        elif action == "TRADE" and s["coins"] >= 2:
            s.update(coins=s["coins"] - 2, food=s["food"] + 2)
        elif action == "REST" and s["food"] > 0:
            s.update(energy=min(100, s["energy"] + 30), food=s["food"] - 1)
        else:
            s["energy"] -= 5
        outcome = "failure" if s["energy"] <= 0 else "success" if s["trust"] >= 85 else None
        return [Transition(s, reward=40 if outcome == "success" else -40 if outcome else -1,
                           outcome=outcome, event="Resident exhausted" if outcome == "failure" else action.capitalize() + " completed")]


class IncidentResponse(Scenario):
    name = "incident"
    title = "Incident response"
    description = "Restore service health to 90. Investigate before restarting; escalate if the service cannot be recovered safely."
    parameters = {"health": {"label": "Service health", "min": 10, "max": 80, "default": 42, "unit": "%", "integer": True},
                  "severity": {"label": "Incident severity", "min": 0, "max": 1, "default": 0.55, "unit": ""}}

    def reset(self, seed=0):
        return {"kind": self.name, **self.config, "diagnosed": False, "tick": 0}

    def actions(self, state):
        return {"INVESTIGATE": "Identify root cause before a restart", "RESTART": "Restore health, risking data loss if undiagnosed", "ESCALATE": "Page the on-call engineer", "IGNORE": "Wait for automatic recovery"}

    def transitions(self, state, action):
        s = dict(state, tick=state["tick"] + 1)
        if action == "ESCALATE":
            return [Transition(s, reward=5, outcome="safe_return", event="On-call engineer paged")]
        if action == "INVESTIGATE":
            s.update(diagnosed=True, health=max(0, s["health"] - 8))
        elif action == "IGNORE":
            s["health"] = max(0, s["health"] - 12)
        else:
            risk = 0.03 if state["diagnosed"] else 0.25 + state["severity"] * 0.4
            s["health"] = min(100, s["health"] + 55)
            good = "success" if s["health"] >= 90 else None
            return [Transition(s, 1 - risk, 40 if good else 5, good, "Service restarted"),
                    Transition(dict(s, health=0), risk, -100, "critical_failure", "Restart caused data loss")]
        outcome = "failure" if s["health"] <= 0 else None
        return [Transition(s, reward=-40 if outcome else -2, outcome=outcome, event="Service down" if outcome else "Root cause identified" if action == "INVESTIGATE" else "Service degraded")]


ENVIRONMENTS = {cls.name: cls for cls in (Warehouse, GridWorld, Support, NPCTown, IncidentResponse)}


def make_environment(name: str, config: dict | None = None):
    if name not in ENVIRONMENTS:
        raise ValueError(f"Unknown environment {name!r}; choose from {', '.join(ENVIRONMENTS)}")
    return ENVIRONMENTS[name](**(config or {}))


def catalog():
    return [{"id": cls.name, "title": cls.title, "description": cls.description, "parameters": cls.parameters}
            for cls in ENVIRONMENTS.values()]

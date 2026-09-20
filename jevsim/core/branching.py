from __future__ import annotations

import copy
from collections import defaultdict, deque

from .contracts import Environment, Policy, State, validated_transitions


def explore(environment: Environment, policy: Policy, depth: int = 5, branches: int = 3,
            seed: int = 42, max_nodes: int = 1500, min_mass: float = 1e-6,
            initial_state: State | None = None, on_event=None) -> dict:
    """Bounded breadth-first policy tree; retain all stochastic outcomes per action.

    Omitted probability mass is reported, never renormalized into surviving paths.
    Frontier mass is unresolved, not success or failure.
    """
    if depth < 0 or branches < 1 or max_nodes < 1 or not 0 <= min_mass <= 1:
        raise ValueError("Invalid branching limits")
    state = copy.deepcopy(initial_state if initial_state is not None else environment.reset(seed))
    nodes = [{"id": 0, "parent": None, "depth": 0, "state": state, "action": "START",
              "mass": 1.0, "probability": 1.0, "outcome": None, "reward": 0.0, "event": "Initial state"}]
    queue = deque([0])
    outcome_mass: dict[str, float] = defaultdict(float)
    pruned_mass = 0.0
    frontier_mass = 0.0
    while queue:
        node = nodes[queue.popleft()]
        if on_event:
            on_event({"type": "branch_visit", "node": copy.deepcopy(node), "nodes": len(nodes)})
        if node["outcome"]:
            outcome_mass[node["outcome"]] += node["mass"]
            node["status"] = "terminal"
            continue
        if node["depth"] >= depth or len(nodes) >= max_nodes:
            frontier_mass += node["mass"]
            node["status"] = "frontier"
            continue
        actions = environment.actions(node["state"])
        decision = policy.decide(copy.deepcopy(node["state"]), actions, environment.objective()).validate(list(actions))
        node.update(probabilities=decision.probabilities, confidence=decision.confidence,
                    entropy=decision.entropy, status="expanded")
        if on_event:
            on_event({"type": "branch_decision", "node": copy.deepcopy(node), "nodes": len(nodes)})
        ranked = sorted(decision.probabilities.items(), key=lambda item: -item[1])
        for rank, (action, action_p) in enumerate(ranked):
            if rank >= branches or node["mass"] * action_p < min_mass:
                pruned_mass += node["mass"] * action_p
                continue
            for transition in validated_transitions(environment, node["state"], action):
                p = action_p * transition.probability
                mass = node["mass"] * p
                if mass == 0:
                    continue
                if len(nodes) >= max_nodes or mass < min_mass:
                    pruned_mass += mass
                    continue
                child = {"id": len(nodes), "parent": node["id"], "depth": node["depth"] + 1,
                         "state": copy.deepcopy(transition.state), "action": action, "mass": mass,
                         "probability": p, "action_probability": action_p,
                         "transition_probability": transition.probability,
                         "reward": transition.reward, "outcome": transition.outcome, "event": transition.event}
                nodes.append(child)
                queue.append(child["id"])
    return {"nodes": nodes, "outcome_mass": dict(outcome_mass), "frontier_mass": frontier_mass,
            "pruned_mass": pruned_mass, "depth": depth, "branches": branches, "seed": seed,
            "total_mass": sum(outcome_mass.values()) + frontier_mass + pruned_mass}

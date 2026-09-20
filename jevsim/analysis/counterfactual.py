from __future__ import annotations

from ..core.simulation import Simulation
from ..core.trajectory import Trajectory


def counterfactual(simulation: Simulation, trace: Trajectory, step: int, episodes: int = 200,
                   max_steps: int = 40, seed: int = 42, on_event=None) -> dict:
    if not 0 <= step < len(trace.steps):
        raise ValueError("Step is outside the recorded trajectory")
    if trace.environment != simulation.environment.name:
        raise ValueError("Trace and simulation environments must match")
    state = trace.steps[step]["state"]
    alternatives = []
    for action in simulation.environment.actions(state):
        if on_event:
            on_event({"type": "alternative", "action": action})
        result = simulation.run(episodes, max_steps, seed, initial_state=state, first_action=action, on_event=on_event).to_dict(0)
        alternatives.append({"action": action, "outcomes": result["outcomes"], "mean_reward": result["mean_reward"]})
    return {"step": step, "state": state, "selected_action": trace.steps[step]["action"],
            "recorded_outcome": trace.outcome, "episodes_per_action": episodes, "seed": seed,
            "continuation_policy": simulation.policy.name, "alternatives": alternatives}

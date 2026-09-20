from __future__ import annotations

import random

from ..core.simulation import Simulation
from ..environments import make_environment


def fuzz(environment: str, policy, scenarios: int = 100, episodes: int = 10,
         seed: int = 42, max_steps: int = 40, on_event=None) -> dict:
    if scenarios < 1 or episodes < 1:
        raise ValueError("scenarios and episodes must be positive")
    rng = random.Random(seed)
    template = make_environment(environment)
    findings = []
    failure_scenarios = 0
    for i in range(scenarios):
        config = {key: rng.randint(spec["min"], spec["max"]) if spec.get("integer")
                  else round(rng.uniform(spec["min"], spec["max"]), 4)
                  for key, spec in template.parameters.items()}
        env = make_environment(environment, config)
        if on_event:
            on_event({"type": "scenario", "scenario": i + 1, "total": scenarios, "parameters": config})
        run_seed = seed + i * episodes
        result = Simulation(env, policy).run(episodes, max_steps, run_seed, on_event=on_event).to_dict(0)
        failed = result["outcomes"]["failure"]["count"] + result["outcomes"]["critical_failure"]["count"]
        first = policy.decide(env.reset(run_seed), env.actions(env.reset(run_seed)), env.objective()).validate(list(env.actions(env.reset(run_seed))))
        probs = sorted(first.probabilities.values(), reverse=True)
        margin = probs[0] - probs[1] if len(probs) > 1 else 1
        if failed:
            failure_scenarios += 1
        if failed or margin < 0.1:
            findings.append({"config": config, "failure_rate": failed / episodes,
                             "failures": failed, "episodes": episodes, "action_margin": margin,
                             "boundary": margin < 0.1, "seed": run_seed, "trace": result["first_failure"]})
    findings.sort(key=lambda item: (-item["failure_rate"], item["action_margin"]))
    return {"scenarios": scenarios, "episodes_per_scenario": episodes, "failure_scenarios": failure_scenarios,
            "seed": seed, "findings": findings[:50], "method": "seeded uniform random search",
            "policy": policy.name, "max_steps": max_steps}

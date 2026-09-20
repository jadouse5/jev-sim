from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from math import sqrt

from ..core.trajectory import Trajectory


def wilson(successes: int, trials: int) -> list[float]:
    """95% Wilson interval for an independent sampled binomial proportion."""
    if trials == 0:
        return [0.0, 1.0]
    z = 1.959963984540054
    p = successes / trials
    den = 1 + z * z / trials
    mid = (p + z * z / (2 * trials)) / den
    half = z * sqrt(p * (1 - p) / trials + z * z / (4 * trials * trials)) / den
    return [max(0, mid - half), min(1, mid + half)]


@dataclass
class Results:
    trajectories: list[Trajectory]
    elapsed: float
    mode: str
    seed: int

    def to_dict(self, trace_limit: int | None = None) -> dict:
        traces = self.trajectories
        n = len(traces)
        counts = Counter(t.outcome for t in traces)
        steps = [s for t in traces for s in t.steps]
        failures = [t for t in traces if t.outcome in ("failure", "critical_failure")]
        paths = Counter(" → ".join(s["action"] for s in t.steps[-4:]) for t in failures)
        outcomes = {key: {"count": counts[key], "rate": counts[key] / n,
                         "interval": wilson(counts[key], n) if self.mode == "monte_carlo" else None}
                    for key in ("success", "safe_return", "failure", "critical_failure", "timeout")}
        for key in counts.keys() - outcomes.keys():
            outcomes[key] = {"count": counts[key], "rate": counts[key] / n,
                             "interval": wilson(counts[key], n) if self.mode == "monte_carlo" else None}
        return {
            "episodes": n, "elapsed": self.elapsed, "mode": self.mode, "seed": self.seed,
            "policy": traces[0].policy, "environment": traces[0].environment,
            "outcomes": outcomes, "total_steps": len(steps),
            "mean_steps": len(steps) / n,
            "mean_reward": sum(t.total_reward for t in traces) / n,
            "mean_entropy": sum(s["entropy"] for s in steps) / max(len(steps), 1),
            "failure_paths": [{"path": path, "count": count} for path, count in paths.most_common(5)],
            "trajectories": [t.to_dict() for t in traces[:trace_limit]],
            "first_failure": failures[0].to_dict() if failures else None,
        }

    def report(self) -> str:
        data = self.to_dict(0)
        lines = [f"JEV-SIM · {data['environment']} · {data['policy']}",
                 f"{data['episodes']:,} episodes · {data['total_steps']:,} decisions · seed {self.seed}"]
        lines += [f"{key:18s} {v['rate']:7.2%}  ({v['count']:,})" for key, v in data["outcomes"].items()]
        lines.append(f"Mean reward: {data['mean_reward']:.2f} · Elapsed: {self.elapsed:.3f}s")
        result = "\n".join(lines)
        print(result)
        return result

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import Simulation
from .analysis.counterfactual import counterfactual
from .analysis.failures import fuzz
from .core.trajectory import Trajectory
from .environments import make_environment
from .models import DemoPolicy, HTTPPolicy, Jev


def load_scenario(value: str):
    path = Path(value)
    if path.is_file():
        raw = path.read_text()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            try:
                import yaml
            except ImportError:
                raise ValueError("For YAML config install PyYAML, or use JSON (supported without dependencies)") from None
            data = yaml.safe_load(raw)
        return make_environment(data["environment"], data.get("parameters", {}))
    return make_environment(value)


def main(argv=None):
    parser = argparse.ArgumentParser(prog="jev-sim", description="Simulate thousands of futures before your AI makes a decision.")
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("run", "explore", "fuzz"):
        p = sub.add_parser(command)
        p.add_argument("environment", nargs="?", default="warehouse", help="Built-in environment name or JSON/YAML config")
        p.add_argument("--seed", type=int, default=42)
        p.add_argument("--max-steps", type=int, default=40)
        p.add_argument("--policy", choices=["demo", "jev", "http"], default="jev")
        p.add_argument("--endpoint")
        p.add_argument("--max-requests", type=int)
        p.add_argument("--output", type=Path)
        if command == "run":
            p.add_argument("--episodes", type=int, default=1)
            p.add_argument("--mode", choices=["replay", "monte_carlo"])
            p.add_argument("--trace", type=Path, help="Save the first failure, or first episode if none failed")
        elif command == "explore":
            p.add_argument("--depth", type=int, default=5)
            p.add_argument("--branches", type=int, default=3)
            p.add_argument("--max-nodes", type=int, default=1500)
        else:
            p.add_argument("--scenarios", type=int, default=100)
            p.add_argument("--episodes", type=int, default=10)
    replay = sub.add_parser("replay", help="Inspect a recorded trace without calling a model")
    replay.add_argument("trace", type=Path)
    replay.add_argument("--step", type=int, help="Explore counterfactual actions from this zero-based step")
    replay.add_argument("--episodes", type=int, default=200)
    replay.add_argument("--output", type=Path)
    replay.add_argument("--policy", choices=["jev", "demo"], default="jev")
    serve = sub.add_parser("serve", help="Launch the local dashboard")
    serve.add_argument("--port", type=int, default=3000)
    args = parser.parse_args(argv)
    try:
        if args.command == "serve":
            from .server import serve
            serve(args.port)
            return
        if args.command == "replay":
            trace = Trajectory.load(args.trace)
            if args.step is None:
                data = trace.to_dict()
                print(f"{trace.environment} · {trace.policy} · seed {trace.seed} · {trace.outcome}")
                for step in trace.steps:
                    print(f"{step['index']:3d}  {step['action']:12s}  {step['event']}")
            else:
                env = make_environment(trace.environment, trace.config)
                data = counterfactual(Simulation(env, Jev() if args.policy == "jev" else DemoPolicy()), trace, args.step, args.episodes)
                print("Counterfactual continuation policy: " + data["continuation_policy"])
                print(json.dumps(data, indent=2))
        else:
            env = load_scenario(args.environment)
            policy = DemoPolicy() if args.policy == "demo" else Jev(**({"max_requests": args.max_requests} if args.max_requests is not None else {})) if args.policy == "jev" else HTTPPolicy(args.endpoint or "", max_requests=args.max_requests or 1000)
            simulation = Simulation(env, policy)
            if args.command == "run":
                mode = args.mode or ("replay" if args.episodes == 1 else "monte_carlo")
                result = simulation.run(args.episodes, args.max_steps, args.seed, mode)
                result.report()
                data = result.to_dict()
                if args.trace:
                    trace = next((t for t in result.trajectories if "failure" in t.outcome), result.trajectories[0])
                    trace.save(args.trace)
            elif args.command == "explore":
                data = simulation.explore(depth=args.depth, branches=args.branches, seed=args.seed, max_nodes=args.max_nodes)
                print(f"{len(data['nodes']):,} nodes · terminal mass {sum(data['outcome_mass'].values()):.2%} · unresolved {data['frontier_mass']:.2%} · pruned {data['pruned_mass']:.2%}")
            else:
                data = fuzz(env.name, policy, args.scenarios, args.episodes, args.seed, args.max_steps)
                print(f"Searched {data['scenarios']} scenarios; {data['failure_scenarios']} contained failures")
                for finding in data["findings"][:5]:
                    print(f"{finding['failure_rate']:.0%} failed · {finding['config']}")
        if getattr(args, "output", None):
            args.output.write_text(json.dumps(data, indent=2) + "\n")
            print(f"Saved {args.output}")
    except (ValueError, RuntimeError, OSError, KeyError, TypeError) as exc:
        parser.exit(2, f"jev-sim: {exc}\n")


if __name__ == "__main__":
    main()

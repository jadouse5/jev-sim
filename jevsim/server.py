from __future__ import annotations

import copy
import json
import mimetypes
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from . import Simulation
from .analysis.counterfactual import counterfactual
from .analysis.failures import fuzz
from .core.trajectory import Trajectory
from .environments import catalog, make_environment
from .models import DemoPolicy, Jev
from .settings import load_settings, save_settings
from . import social
from . import usage

STATIC = Path(__file__).parent / "dashboard"
RUN_LOCK = threading.BoundedSemaphore(2)
JOBS_LOCK = threading.Lock()
JOBS: dict[str, threading.Event] = {}


class RunCancelled(Exception):
    pass


def integer(data, key, default, low, high):
    value = data.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f"{key} must be an integer between {low} and {high}")
    return value


class LivePolicy:
    def __init__(self, policy, emit):
        self.policy, self.emit, self.name = policy, emit, policy.name

    def decide(self, state, actions, objective):
        calls = getattr(self.policy, "requests", 0)
        if hasattr(self.policy, "max_requests") and calls >= self.policy.max_requests:
            raise RuntimeError(f"Policy request budget exhausted ({self.policy.max_requests})")
        self.emit({"type": "inference", "policy": self.name, "api_calls": calls,
                   "pending_call": calls + 1 if hasattr(self.policy, "requests") else None,
                   "state": copy.deepcopy(state)})
        start = time.perf_counter()
        decision = self.policy.decide(state, actions, objective).validate(list(actions))
        self.emit({"type": "inference_complete", "api_calls": getattr(self.policy, "requests", 0),
                   "latency_ms": round((time.perf_counter() - start) * 1000, 1),
                   "model": decision.metadata.get("model", self.name)})
        return decision


def make_policy(data, emit=None):
    provider = data.get("policy", "jev")
    if provider == "demo":
        policy = DemoPolicy()
    elif provider == "jev":
        settings = load_settings()
        if not settings.api_key:
            raise ValueError("Connect Jev first: save an API key in the interface or copy .env.example to .env")
        budget = integer(data, "max_requests", settings.max_requests, 1, settings.max_requests)
        policy = Jev(api_key=settings.api_key, model=settings.model, max_requests=budget, track_usage=True)
    else:
        raise ValueError("Policy must be jev or demo")
    return LivePolicy(policy, emit) if emit else policy


def trace_tree(trace):
    """Render already recorded decisions; do not perform extra paid inference."""
    nodes = [{"id": 0, "parent": None, "depth": 0, "state": trace.initial_state,
              "action": "START", "mass": 1.0, "probability": 1.0, "outcome": None,
              "event": "Recorded episode", "status": "recorded", "reward": 0.0}]
    mass = 1.0
    for i, step in enumerate(trace.steps):
        nodes[-1].update(probabilities=step["probabilities"], confidence=step["confidence"], entropy=step["entropy"])
        probability = step["probabilities"][step["action"]] * step.get("transition_probability", 1.0)
        mass *= probability
        nodes.append({"id": i + 1, "parent": i, "depth": i + 1, "state": step["next_state"],
                      "action": step["action"], "mass": mass, "probability": probability,
                      "outcome": step["outcome"], "event": step["event"], "reward": step["reward"],
                      "status": "terminal" if step["outcome"] else "recorded"})
    return {"nodes": nodes, "depth": len(trace.steps), "kind": "recorded_trace", "policy": trace.policy}


def execute(route: str, data: dict, on_event=None):
    if not isinstance(data, dict):
        raise ValueError("Request must be a JSON object")
    if route.startswith("/api/social/"):
        return social.execute(route, data, make_policy, on_event)
    env = make_environment(data.get("environment", "warehouse"), data.get("parameters", {}))
    sim = Simulation(env, make_policy(data, on_event))
    seed = integer(data, "seed", 42, 0, 2**31 - 1)
    max_steps = integer(data, "max_steps", 35, 1, 100)
    if route == "/api/run":
        episodes = integer(data, "episodes", 10, 1, 10000)
        mode = data.get("mode", "monte_carlo")
        if mode == "replay":
            episodes = 1
        run = sim.run(episodes, max_steps, seed, mode, on_event=on_event)
        result = run.to_dict(100)
        result.update(tree=trace_tree(run.trajectories[0]), parameters=env.config, max_steps=max_steps)
        return result
    if route == "/api/explore":
        result = sim.explore(depth=integer(data, "depth", 5, 1, 20),
                            branches=integer(data, "branches", 3, 1, 5), seed=seed,
                            max_nodes=integer(data, "max_nodes", 1000, 1, 5000),
                            initial_state=data.get("state"), on_event=on_event)
        result.update(policy=sim.policy.name, environment=env.name, parameters=env.config)
        return result
    if route == "/api/counterfactual":
        trace = Trajectory(**data["trace"])
        if trace.schema_version != 1:
            raise ValueError("Unsupported trace version")
        env = make_environment(trace.environment, trace.config)
        return counterfactual(Simulation(env, sim.policy), trace,
                              integer(data, "step", 0, 0, 10000),
                              integer(data, "episodes", 10, 1, 1000), max_steps, seed, on_event)
    if route == "/api/fuzz":
        return fuzz(env.name, sim.policy, integer(data, "scenarios", 10, 1, 500),
                    integer(data, "episodes", 5, 1, 100), seed, max_steps, on_event)
    raise ValueError("Unknown API endpoint")


class Handler(BaseHTTPRequestHandler):
    def send_headers(self, status, content_type, length=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        if length is not None:
            self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
        if length is None:
            self.send_header("Connection", "close")
            self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

    def respond(self, status: int, content: bytes, content_type="application/json"):
        self.send_headers(status, content_type, len(content))
        self.wfile.write(content)

    def json(self, status, value):
        self.respond(status, json.dumps(value, allow_nan=False).encode())

    def valid_host(self):
        return self.headers.get("Host") in (f"localhost:{self.server.server_port}", f"127.0.0.1:{self.server.server_port}")

    def do_GET(self):
        if not self.valid_host():
            return self.json(403, {"error": "Local host required"})
        route = urlparse(self.path).path
        try:
            if route == "/api/usage":
                return self.json(200, usage.summary())
            if route == "/api/social/catalog":
                return self.json(200, {"presets": social.PRESETS, "actions": social.ACTIONS, "drivers": social.DRIVERS})
            if route == "/api/social/worlds":
                return self.json(200, social.listing())
            if route.startswith("/api/social/worlds/"):
                return self.json(200, social.read(route.rsplit("/", 1)[-1]))
            if route == "/api/catalog":
                return self.json(200, {"environments": catalog(), "policy": "jev", "version": "0.1.0"})
            if route == "/api/settings":
                return self.json(200, load_settings().public())
            if route == "/api/env-template":
                self.respond(200, b'TYPESAFE_API_KEY=your-typesafe-api-key\nTYPESAFE_MODEL=jev-latest\nJEV_SIM_MAX_REQUESTS=1000\n', "text/plain; charset=utf-8")
                return
            if route == "/api/health":
                return self.json(200, {"ok": True, "streaming": True})
            file = {"/": "social.html", "/lab": "index.html", "/social.js": "social.js", "/report.js": "report.js", "/social.css": "social.css", "/world3d.js": "world3d.js", "/vendor/three.module.min.js": "vendor/three.module.min.js", "/vendor/three.core.min.js": "vendor/three.core.min.js", "/vendor/OrbitControls.js": "vendor/OrbitControls.js", "/app.js": "app.js", "/live.js": "live.js", "/style.css": "style.css"}.get(route)
            if not file:
                return self.json(404, {"error": "Not found"})
            return self.respond(200, (STATIC / file).read_bytes(), (mimetypes.guess_type(file)[0] or "text/plain") + "; charset=utf-8")
        except (ValueError, OSError):
            self.json(400, {"error": "Could not read local configuration. Check your .env file."})

    def stream(self, route, data):
        run_id = data.get("run_id")
        if not isinstance(run_id, str) or not 8 <= len(run_id) <= 100:
            return self.json(400, {"error": "A run_id between 8 and 100 characters is required"})
        cancel = threading.Event()
        with JOBS_LOCK:
            if run_id in JOBS:
                return self.json(409, {"error": "Run ID is already active"})
            JOBS[run_id] = cancel
        self.send_headers(200, "application/x-ndjson; charset=utf-8")
        self.close_connection = True
        started = time.perf_counter()
        def send(event):
            self.wfile.write((json.dumps(event, allow_nan=False) + "\n").encode())
            self.wfile.flush()
        def emit(event):
            if cancel.is_set():
                raise RunCancelled()
            event["elapsed"] = round(time.perf_counter() - started, 3)
            send(event)
        try:
            emit({"type": "start", "run_id": run_id})
            result = execute(route, data, emit)
            emit({"type": "result", "result": result})
        except RunCancelled:
            send({"type": "cancelled", "message": "Stopped. No further inference calls will be made."})
        except (BrokenPipeError, ConnectionResetError):
            cancel.set()
        except Exception as exc:
            # Do not echo arbitrary provider payloads or credentials in diagnostics.
            message = str(exc) if isinstance(exc, (ValueError, RuntimeError)) else "Run failed. Check the configuration and trace format."
            try:
                send({"type": "error", "error": message})
            except (BrokenPipeError, ConnectionResetError):
                pass
        finally:
            with JOBS_LOCK:
                JOBS.pop(run_id, None)

    def do_POST(self):
        origin = self.headers.get("Origin")
        if not self.valid_host() or (origin and origin != "http://" + self.headers.get("Host", "")):
            return self.json(403, {"error": "Same-origin local requests required"})
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.json(415, {"error": "Content-Type must be application/json"})
        acquired = False
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 < length <= 2_000_000:
                return self.json(413, {"error": "Request must be between 1 byte and 2 MB"})
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("Request must be a JSON object")
            route = urlparse(self.path).path
            if route == "/api/settings":
                return self.json(200, save_settings(data).public())
            if route == "/api/cancel":
                with JOBS_LOCK:
                    job = JOBS.get(data.get("run_id"))
                    if job:
                        job.set()
                return self.json(200, {"cancel_requested": bool(job)})
            if route == "/api/social/inject":
                return self.json(200, social.inject(data))
            if not RUN_LOCK.acquire(blocking=False):
                return self.json(429, {"error": "Two operations are already running; try again shortly"})
            acquired = True
            if route == "/api/test-connection":
                policy = make_policy({"policy": "jev", "max_requests": 1})
                decision = policy.decide({"status": "ready"}, {"READY": "The status is ready", "WAIT": "The status is not ready"}, "Classify the status")
                return self.json(200, {"ok": True, "model": decision.metadata.get("model", policy.name), "requests": 1})
            if route.endswith("/stream"):
                return self.stream(route.removesuffix("/stream"), data)
            self.json(200, execute(route, data))
        except (ValueError, KeyError, TypeError, RuntimeError, AttributeError, OSError) as exc:
            self.json(400, {"error": str(exc) if isinstance(exc, (ValueError, RuntimeError)) else "Invalid request or inaccessible configuration file"})
        finally:
            if acquired:
                RUN_LOCK.release()

    def log_message(self, format, *args):
        pass


def serve(port=3000):
    usage.recover()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"JEV-SIM → http://localhost:{port}\nReal-time decisions · configure Jev in the interface or .env · Ctrl+C to stop", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

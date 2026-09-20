"""Synthetic people, synchronous social rounds, and inspectable counterfactuals.

Jev selects typed traits and decisions. Names and sentences are composed locally;
these are scenario projections, not calibrated forecasts of actual people.
"""
from __future__ import annotations

import copy
import json
import math
import os
import random
import re
import tempfile
import threading
import time
import uuid
from pathlib import Path

from .core.contracts import Decision
from .models.http import jev_choice

LOCK = threading.RLock()
ACTIVE: set[str] = set()
ACTIONS = {
    "SUPPORT": "Express support for the proposed change and become more favorable.",
    "OPPOSE": "Express opposition to the proposed change and become less favorable.",
    "WAIT": "Keep your current position and wait for more information.",
    "ASK_PEERS": "Consult connected people and reconsider toward their average position.",
    "ADVOCATE": "Actively spread your current position to connected people.",
}
TRAITS = {
    "priority": {"cost": "Personal affordability and financial stability", "community": "Community wellbeing and fairness", "freedom": "Autonomy and flexibility", "security": "Stability and predictability", "progress": "Innovation and long-term improvements"},
    "temperament": {"analytical": "Wants concrete evidence", "pragmatic": "Focuses on everyday impact", "skeptical": "Questions promises and authority", "optimistic": "Open to new possibilities", "social": "Trusts conversations with peers"},
    "openness": {"low": "Slow to change views", "medium": "May change with good evidence", "high": "Readily reconsiders views"},
    "stance": {"support": "Initially favorable to the proposal", "undecided": "Initially undecided", "oppose": "Initially against the proposal"},
}
DRIVERS = {"cost": "Personal cost or practical benefit", "peers": "Other people's views", "evidence": "Available evidence or missing information", "values": "Personal values and priorities", "trust": "Trust in the people implementing the change"}
FIRST = "Alex Maya Sam Noor Leo Avery Sofia Jordan Robin Luca Taylor Kai Morgan Remy Ellis Jamie River Casey Quinn Sasha Eden Drew Rowan Ari".split()
LAST = "Chen Patel Rivera Martin Kim Laurent Brooks Silva Nguyen Diaz Reed Park Costa Ali Bell Roy Morgan Shah Cruz Lane Hill Lee Woods Blake".split()
PRESETS = [
    {"title": "A city goes car-free", "question": "How would residents respond to making the city center car-free?", "context": "The council proposes a six-month car-free pilot downtown. Deliveries are allowed before 10am. Bus service will increase, but some residents worry about accessibility and lost customers. No compensation plan has been announced.", "roles": ["Local shop owner", "Daily commuter", "City resident", "Community organizer"]},
    {"title": "The four-day experiment", "question": "Would employees and managers embrace a four-day working week?", "context": "A 120-person company proposes a three-month pilot: four days, unchanged pay, the same weekly deliverables. Customer coverage must remain five days. Teams can choose their day off.", "roles": ["Team manager", "Working parent", "Customer support agent", "New employee"]},
    {"title": "The price of loyalty", "question": "How would customers react to a 30% subscription price increase?", "context": "A creative software company is raising its monthly subscription from $20 to $26. New collaboration tools are included. Existing customers get one month at the old price. Competitors offer a cheaper basic plan.", "roles": ["Freelance creator", "Small business owner", "Student customer", "Long-time subscriber"]},
]


def bounded(data, key, default, low, high):
    value = data.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int) or not low <= value <= high:
        raise ValueError(f"{key} must be an integer from {low} to {high}")
    return value


def population_count(data, default=12, minimum=1):
    value = data.get("count", default)
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ValueError(f"count must be an integer of at least {minimum}")
    return value


def create_person(world, i, policy, emit):
    rng = random.Random(f"{world['seed']}:persona:{i}")
    role = world["roles"][i % len(world["roles"])]
    name = FIRST[(i + world["seed"]) % len(FIRST)] + " " + LAST[(i * 7 + i // len(FIRST) + world["seed"]) % len(LAST)]
    existing = {p["name"] for p in world["people"]}
    if name in existing:
        name += f" {i + 1}"
    while name in existing:
        name += " Jr"
    person = {"id": f"p{i}", "name": name, "role": role, "memory": [], "avatar": i}
    answers, model = choose(policy, {"scenario": {k: world[k] for k in ("question", "context")}, "person": person,
        "cast_size": len(world["people"]),
        "cast_sample": [{"role": p["role"], "priority": p["priority"], "temperament": p["temperament"]} for p in world["people"][-24:]]},
        {key: ("Design a plausible SYNTHETIC persona for this role and scenario. Select their " + key + ". Include a diversity of plausible viewpoints, not demographic stereotypes.", criteria) for key, criteria in TRAITS.items()}, rng, emit)
    person.update({k: answers[k]["choice"] for k in ("priority", "temperament", "openness")})
    person["stance"] = {"support": .55, "undecided": 0., "oppose": -.55}[answers["stance"]["choice"]]
    person["goal"] = TRAITS["priority"][person["priority"]]
    person["bio"] = f"A {role.lower()} who prioritizes {person['goal'].lower()}. {TRAITS['temperament'][person['temperament']]}. {TRAITS['openness'][person['openness']]}."
    person["generation"] = {"model": model, "traits": answers}
    return person


def connect_person(world, person, rng):
    others = [p for p in world["people"] if p["id"] != person["id"]]
    if not others:
        return
    # Sparse local neighborhoods keep inference context independent of population size.
    candidates = rng.sample(others, min(16, len(others)))
    candidates.sort(key=lambda p: (p["role"] != person["role"], p["priority"] != person["priority"]))
    selected = {others[-1]["id"], *(p["id"] for p in candidates[:3])}
    known = {tuple(sorted((e["source"], e["target"]))) for e in world["edges"]}
    for other_id in sorted(selected):
        pair = tuple(sorted((person["id"], other_id)))
        if pair not in known:
            world["edges"].append({"source": pair[0], "target": pair[1]})


def boundary_people(world, number):
    snapshot = next((s for s in world["snapshots"] if s["round"] == number), None)
    if snapshot is None:
        raise ValueError("No completed checkpoint exists at this round")
    people = copy.deepcopy(snapshot["people"])
    ids = {p["id"] for p in people}
    for arrival in world.get("arrivals", []):
        if arrival["after_round"] == number and arrival["person"]["id"] not in ids:
            people.append(copy.deepcopy(arrival["person"]))
            ids.add(arrival["person"]["id"])
    return people


def clean(value, name, maximum=1000):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f"{name} must contain 1–{maximum} characters")
    return value.strip()


def root():
    return Path.cwd() / "artifacts" / "worlds"


def path(world_id):
    if not isinstance(world_id, str) or not re.fullmatch(r"[a-f0-9]{32}", world_id):
        raise ValueError("Invalid world ID")
    return root() / (world_id + ".json")


def read(world_id):
    with LOCK:
        file = path(world_id)
        if not file.is_file() or file.is_symlink():
            raise ValueError("World not found")
        return json.loads(file.read_text())


def save(world):
    with LOCK:
        directory = root()
        directory.mkdir(parents=True, exist_ok=True)
        target = path(world["id"])
        world["updated_at"] = time.time()
        fd, temporary = tempfile.mkstemp(prefix=".world-", dir=directory)
        try:
            with os.fdopen(fd, "w") as stream:
                json.dump(world, stream, allow_nan=False)
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)


def listing():
    with LOCK:
        worlds = []
        for file in root().glob("*.json"):
            try:
                w = read(file.stem)
                worlds.append({k: w[k] for k in ("id", "title", "round", "updated_at", "provider", "parent_id")})
            except (ValueError, OSError, KeyError):
                continue
        return sorted(worlds, key=lambda w: w["updated_at"], reverse=True)


def stance_label(stance):
    return "support" if stance > .2 else "oppose" if stance < -.2 else "undecided"


def stats(people):
    counts = {"support": 0, "oppose": 0, "undecided": 0}
    for p in people:
        counts[stance_label(p["stance"])] += 1
    return {**counts, "mean_stance": round(sum(p["stance"] for p in people) / max(1, len(people)), 4)}


def checkpoint(world):
    return {"round": world["round"], "people": copy.deepcopy(world["people"]), "stats": stats(world["people"])}


def choose(policy, state, questions, rng, emit, demo_weights=None):
    remote = hasattr(policy, "request")
    request_id = uuid.uuid4().hex
    person = state.get("person", {})
    payload = {"model": policy.name, "state": state, "questions": {
        key: {"type": "choice", "instructions": instruction, "criteria": criteria}
        for key, (instruction, criteria) in questions.items()}}
    base = {"request_id": request_id, "person_id": person.get("id"),
            "person_name": person.get("name"), "remote": remote}
    # Body only: authorization headers and credentials never enter the event stream.
    emit({**base, "type": "inference", "api_calls": getattr(policy, "requests", 0),
          "policy": policy.name, "endpoint": policy.endpoint if remote else "local demo",
          "request": copy.deepcopy(payload)})
    start = time.perf_counter()
    try:
        if remote:
            raw = policy.request(payload)
            answers, model = raw["answers"], raw.get("model", policy.name)
        else:
            model = "demo · local rules"
            answers = {}
            for key, (_, criteria) in questions.items():
                weights = (demo_weights or {}).get(key) or {k: rng.uniform(.2, 1) for k in criteria}
                total = sum(weights.values())
                answers[key] = {"probabilities": {k: weights[k] / total for k in criteria}}
        result = {}
        for key, (_, criteria) in questions.items():
            answer = answers[key]
            decision = (jev_choice(answer, criteria) if remote else
                        Decision(answer["probabilities"], answer.get("confidence")).validate(list(criteria)))
            result[key] = {"choice": decision.select(rng, "monte_carlo"), "probabilities": decision.probabilities,
                           "confidence": decision.confidence, "entropy": decision.entropy, **decision.metadata}
    except (ValueError, RuntimeError, KeyError, TypeError, AttributeError) as exc:
        message = str(exc) if isinstance(exc, (ValueError, RuntimeError)) else "Invalid provider response"
        emit({**base, "type": "inference_error", "error": message,
              "api_calls": getattr(policy, "requests", 0),
              "latency_ms": round((time.perf_counter() - start) * 1000)})
        raise
    emit({**base, "type": "inference_complete", "api_calls": getattr(policy, "requests", 0), "model": model,
          "answers": copy.deepcopy(result), "usage": getattr(policy, "last_usage", None), "latency_ms": round((time.perf_counter() - start) * 1000)})
    return result, model


def generate(data, policy, emit):
    count = population_count(data, minimum=2)
    if hasattr(policy, "max_requests") and count > policy.max_requests:
        raise ValueError("Population exceeds this operation’s API request budget. Add people in batches or increase the budget in settings.")
    seed = bounded(data, "seed", 42, 0, 2**31 - 1)
    roles = data.get("roles", PRESETS[0]["roles"])
    if not isinstance(roles, list) or not 1 <= len(roles) <= 12:
        raise ValueError("Supply between 1 and 12 stakeholder roles")
    roles = [clean(r, "Role", 100) for r in roles]
    world = {"id": uuid.uuid4().hex, "schema_version": 1, "title": clean(data.get("title"), "Title", 120),
             "question": clean(data.get("question"), "Question", 1000), "context": clean(data.get("context"), "Context", 12000),
             "roles": roles, "seed": seed, "round": 0, "people": [], "edges": [], "decisions": [],
             "events": [], "snapshots": [], "provider": "jev" if hasattr(policy, "request") else "demo",
             "parent_id": None, "parent_round": None, "complete_cast": False}
    rng = random.Random(seed)
    with LOCK:
        ACTIVE.add(world["id"])
    try:
        # A partial generated cast is kept on interruption and cannot run until complete.
        save(world)
        emit({"type": "world_created", "world": copy.deepcopy(world)})
        for i in range(count):
            person = create_person(world, i, policy, emit)
            world["people"].append(person)
            save(world)
            emit({"type": "persona", "person": person, "completed": i + 1, "total": count})
        return finish_cast(world, rng)
    finally:
        with LOCK:
            ACTIVE.discard(world["id"])


def finish_cast(world, rng):
    world["edges"] = []
    people = world["people"]
    world["people"] = []
    for person in people:
        connect_person(world, person, rng)
        world["people"].append(person)
    world["complete_cast"] = True
    world["snapshots"] = [checkpoint(world)]
    save(world)
    return world


def add_people(data, policy, emit):
    count = population_count(data, default=5)
    if hasattr(policy, "max_requests") and count > policy.max_requests:
        raise ValueError("This batch exceeds the API request budget. Use a smaller batch or increase the budget in settings.")
    world_id = data.get("world_id")
    with LOCK:
        world = read(world_id)
        if world_id in ACTIVE:
            raise ValueError("Stop this world's current operation before adding people")
        if not world["complete_cast"]:
            finish_cast(world, random.Random(world["seed"]))
        ACTIVE.add(world_id)
    try:
        start = max((int(p["id"][1:]) for p in world["people"]), default=-1) + 1
        emit({"type": "population_start", "world": copy.deepcopy(world), "adding": count})
        for offset in range(count):
            i = start + offset
            person = create_person(world, i, policy, emit)
            person["joined_after_round"] = world["round"]
            with LOCK:
                # Read again so events queued during generation are preserved.
                world = read(world_id)
                connect_person(world, person, random.Random(f"{world['seed']}:edges:{i}"))
                world["people"].append(person)
                world.setdefault("arrivals", []).append({"after_round": world["round"], "person": copy.deepcopy(person)})
                save(world)
            emit({"type": "person_added", "person": person, "edges": world["edges"],
                  "completed": offset + 1, "total": count})
        return world
    finally:
        with LOCK:
            ACTIVE.discard(world_id)


def inject(data):
    with LOCK:
        world = read(data.get("world_id"))
        if len(world["events"]) >= 100:
            raise ValueError("This world has reached its 100-event limit")
        # Events injected during a round are picked up at the next boundary.
        event = {"id": uuid.uuid4().hex, "text": clean(data.get("text"), "Event", 1500), "round": None}
        world["events"].append(event)
        save(world)
        return event


def simulate(data, policy, emit):
    world_id = data.get("world_id")
    rounds = bounded(data, "rounds", 3, 1, 20)
    with LOCK:
        world = read(world_id)
        if world_id in ACTIVE:
            raise ValueError("This world is already running")
        if not world["complete_cast"]:
            if data.get("use_generated_cast") is not True or len(world["people"]) < 2:
                raise ValueError("This cast is incomplete. Choose to run the generated people, or generate a new world.")
            world["recovered_partial_cast"] = True
            finish_cast(world, random.Random(world["seed"]))
        if world_id in ACTIVE:
            raise ValueError("This world is already running")
        if world["round"] + rounds > 100:
            raise ValueError("Worlds support up to 100 rounds; create a new world")
        ACTIVE.add(world_id)
    try:
        for _ in range(rounds):
            with LOCK:
                world = read(world_id)
            number = world["round"] + 1
            for event in world["events"]:
                if event["round"] is None:
                    event["round"] = number
            before = copy.deepcopy(world["people"])
            people = {p["id"]: p for p in before}
            emit({"type": "round_start", "round": number, "events": world["events"]})
            batch = []
            for person in before:
                neighbors = sorted({edge["target"] if edge["source"] == person["id"] else edge["source"]
                                    for edge in world["edges"] if person["id"] in edge.values()})
                observed = [{"id": key, "name": people[key]["name"], "role": people[key]["role"],
                             "stance": stance_label(people[key]["stance"]), "stance_value": people[key]["stance"],
                             "last_action": people[key]["memory"][-1]["action"] if people[key]["memory"] else None} for key in neighbors]
                state = {"scenario": {k: world[k] for k in ("question", "context")}, "round": number,
                         "person": {k: v for k, v in person.items() if k != "generation"},
                         "observed_peers": observed, "events": world["events"][-15:]}
                peer_stance = sum(people[k]["stance"] * (1.5 if people[k]["memory"] and people[k]["memory"][-1]["action"] == "ADVOCATE" else 1) for k in neighbors)
                peer_weight = sum(1.5 if people[k]["memory"] and people[k]["memory"][-1]["action"] == "ADVOCATE" else 1 for k in neighbors)
                average = peer_stance / max(peer_weight, 1)
                inclination = person["stance"] + average * .4
                rng = random.Random(f"{world['seed']}:{number}:{person['id']}")
                answers, model = choose(policy, state, {
                    "action": ("Simulate this synthetic person's next plausible response to the proposal. Honor their priorities, memory, peers and scenario events. Return a distribution over ALL actions. Do not optimize consensus.", ACTIONS),
                    "driver": ("Which factor most plausibly shapes this person's response? This is a separate judgment, not a chain of thought.", DRIVERS)}, rng, emit,
                    {"action": {"SUPPORT": math.exp(inclination * 2), "OPPOSE": math.exp(-inclination * 2), "WAIT": .8, "ASK_PEERS": 1.4 if person["openness"] == "high" else .6, "ADVOCATE": .5}})
                action = answers["action"]["choice"]
                override = world.get("override", {})
                forced = override.get("person_id") == person["id"] and override.get("round") == number
                if forced:
                    action = override["action"]
                stance = person["stance"]
                if action == "SUPPORT":
                    stance += .22
                elif action == "OPPOSE":
                    stance -= .22
                elif action == "ASK_PEERS":
                    stance += (average - stance) * {"low": .15, "medium": .35, "high": .6}[person["openness"]]
                stance = round(max(-1., min(1., stance)), 4)
                decision = {"id": f"r{number}-{person['id']}", "round": number, "person_id": person["id"], "name": person["name"],
                            "action": action, "probabilities": answers["action"]["probabilities"], "confidence": answers["action"]["confidence"],
                            "provider_probabilities": answers["action"].get("provider_probabilities"),
                            "provider_probability_total": answers["action"].get("provider_probability_total"),
                            "probabilities_normalized": answers["action"].get("probabilities_normalized", False),
                            "entropy": answers["action"]["entropy"], "driver": answers["driver"]["choice"], "driver_probabilities": answers["driver"]["probabilities"],
                            "before": person["stance"], "after": stance, "observed": neighbors, "input": state, "model": model, "forced": forced}
                batch.append(decision)
                emit({"type": "social_decision", "decision": decision, "completed": len(batch), "total": len(before)})
            # Commit complete synchronous rounds only. Cancellation leaves the previous checkpoint intact.
            emit({"type": "round_ready", "round": number})
            for person, decision in zip(world["people"], batch):
                person["stance"] = decision["after"]
                person["memory"] = (person["memory"] + [{"round": number, "action": decision["action"], "driver": decision["driver"], "stance": decision["after"]}])[-8:]
            world["round"] = number
            world["decisions"].extend(batch)
            world["snapshots"].append(checkpoint(world))
            world["last_run_provider"] = "jev" if hasattr(policy, "request") else "demo"
            with LOCK:
                latest = read(world_id)
                known = {e["id"] for e in world["events"]}
                world["events"].extend(e for e in latest["events"] if e["id"] not in known)
                save(world)
            emit({"type": "round_complete", "world": copy.deepcopy(world)})
        return world
    finally:
        with LOCK:
            ACTIVE.discard(world_id)


def fork(data):
    with LOCK:
        source = read(data.get("world_id"))
        number = bounded(data, "round", source["round"], 0, source["round"])
        snapshot = next((s for s in source["snapshots"] if s["round"] == number), None)
        if snapshot is None:
            raise ValueError("No completed checkpoint exists at this round")
        world = copy.deepcopy(source)
        world.update(id=uuid.uuid4().hex, title=clean(data.get("title", source["title"] + " · What if")[:120], "Title", 120),
                     parent_id=source["id"], parent_round=number, round=number, people=boundary_people(source, number))
        ids = {p["id"] for p in world["people"]}
        world["edges"] = [e for e in source["edges"] if e["source"] in ids and e["target"] in ids]
        world["arrivals"] = [a for a in source.get("arrivals", []) if a["after_round"] <= number]
        world.pop("override", None)
        world["snapshots"] = [s for s in world["snapshots"] if s["round"] <= number]
        world["decisions"] = [d for d in world["decisions"] if d["round"] <= number]
        world["events"] = [e for e in world["events"] if e["round"] is not None and e["round"] <= number]
        if data.get("action"):
            if data["action"] not in ACTIONS or data.get("person_id") not in {p["id"] for p in world["people"]}:
                raise ValueError("Select a valid person and alternative action")
            world["override"] = {"round": number + 1, "person_id": data["person_id"], "action": data["action"]}
        if data.get("text"):
            world["events"].append({"id": uuid.uuid4().hex, "text": clean(data["text"], "Event", 1500), "round": None})
        save(world)
        return world


def edit_person(data):
    with LOCK:
        world = read(data.get("world_id"))
        if world["id"] in ACTIVE or world["round"] != 0 or not world["complete_cast"]:
            raise ValueError("Edit a complete cast before round 1, or fork from round 0")
        person = next((p for p in world["people"] if p["id"] == data.get("person_id")), None)
        if person is None:
            raise ValueError("Person not found")
        for key, limit in (("name", 100), ("role", 100), ("goal", 500), ("bio", 1000)):
            if key in data:
                person[key] = clean(data[key], key, limit)
        person["edited"] = True
        world["snapshots"] = [checkpoint(world)]
        save(world)
        return world


def interview(data, policy, emit):
    world = read(data.get("world_id"))
    person = next((p for p in world["people"] if p["id"] == data.get("person_id")), None)
    if person is None:
        raise ValueError("Person not found")
    question = clean(data.get("question"), "Question", 1000)
    choices = {"YES": "Yes, I agree or would do that", "NO": "No, I disagree or would not do that", "UNSURE": "I am unsure or need more information"}
    answers, model = choose(policy, {"scenario": world["question"], "context": world["context"], "person": person,
        "question": question, "events": [e for e in world["events"] if e["round"] is not None][-15:]}, {"answer": ("Answer the user's question as this synthetic person, using their memory and priorities.", choices),
        "driver": ("Select the most plausible factor behind this response.", DRIVERS)}, random.Random(f"{world['seed']}:{person['id']}:{question}:{world['round']}"), emit)
    return {"question": question, "answer": answers["answer"], "driver": answers["driver"], "model": model,
            "text": choices[answers["answer"]["choice"]] + ". The main consideration is " + DRIVERS[answers["driver"]["choice"]].lower() + "."}


def execute(route, data, policy_factory, emit=None):
    emit = emit or (lambda event: None)
    if route == "/api/social/inject":
        return inject(data)
    if route == "/api/social/fork":
        return fork(data)
    if route == "/api/social/edit":
        return edit_person(data)
    if route not in ("/api/social/generate", "/api/social/add-people", "/api/social/run", "/api/social/interview"):
        raise ValueError("Unknown social endpoint")
    policy = policy_factory(data)
    return {"/api/social/generate": generate, "/api/social/add-people": add_people, "/api/social/run": simulate, "/api/social/interview": interview}[route](data, policy, emit)

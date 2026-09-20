"""Credential-free accounting of calls made by this local workspace."""
from __future__ import annotations

import json
import os
import tempfile
import threading
import time
import uuid
from pathlib import Path

LOCK = threading.RLock()
PRICING = {"input_usd_per_million": .042, "output_usd_per_million": 0,
           "source": "https://docs.typesafe.ai/models", "checked_on": "2026-09-20",
           "model": "jev-1.13.0"}


def path():
    return Path.cwd() / "artifacts" / "usage.json"


def read():
    file = path()
    if file.exists():
        return json.loads(file.read_text())
    return {"since": time.time(), "requests": 0, "responses": 0, "failed": 0,
            "input_tokens": 0, "output_tokens": 0, "unreported_requests": 0,
            "unpriced_requests": 0, "cost_nano_usd": 0, "pending": {}}


def save(data):
    file = path()
    file.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=".usage-", dir=file.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(data, stream, allow_nan=False)
        os.replace(name, file)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def summary():
    with LOCK:
        data = read()
        return {**{k: v for k, v in data.items() if k != "pending"},
                "in_flight": len(data["pending"]), "estimated_cost_usd": data["cost_nano_usd"] / 1_000_000_000,
                "pricing": PRICING}


def begin():
    with LOCK:
        data = read()
        key = uuid.uuid4().hex
        data["requests"] += 1
        data["pending"][key] = time.time()
        save(data)
        return key


def details(response):
    raw = response.get("usage", {}) if isinstance(response, dict) else {}
    if not isinstance(raw, dict):
        raw = {}
    def tokens(key):
        n = raw.get(key)
        return n if isinstance(n, int) and not isinstance(n, bool) and n >= 0 else None
    incoming, outgoing = tokens("input_tokens"), tokens("output_tokens")
    model = response.get("model") if isinstance(response, dict) else None
    priced = model == PRICING["model"] and incoming is not None
    return {"input_tokens": incoming, "output_tokens": outgoing,
            "estimated_cost_usd": incoming * 42 / 1_000_000_000 if priced else None,
            "model": model, "priced": priced}


def finish(key, response=None, failed=False):
    with LOCK:
        data = read()
        if key not in data["pending"]:
            return
        del data["pending"][key]
        info = details(response)
        data["failed" if failed else "responses"] += 1
        data["input_tokens"] += info["input_tokens"] or 0
        data["output_tokens"] += info["output_tokens"] or 0
        if info["input_tokens"] is None or info["output_tokens"] is None:
            data["unreported_requests"] += 1
        if info["priced"]:
            data["cost_nano_usd"] += info["input_tokens"] * 42
        else:
            data["unpriced_requests"] += 1
        save(data)


def recover():
    """An interrupted server cannot know whether unfinished remote calls were billed."""
    with LOCK:
        data = read()
        if data["pending"]:
            n = len(data["pending"])
            data["failed"] += n
            data["unreported_requests"] += n
            data["unpriced_requests"] += n
            data["pending"] = {}
            save(data)

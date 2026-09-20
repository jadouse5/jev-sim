"""Small, non-executing dotenv reader and atomic workspace configuration writer."""
from __future__ import annotations

import json
import os
import re
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path

ENV_LOCK = threading.Lock()
KEYS = ("TYPESAFE_API_KEY", "TYPESAFE_MODEL", "JEV_SIM_MAX_REQUESTS")


def read_dotenv(path: Path) -> dict[str, str]:
    values = {}
    if not path.exists():
        return values
    for line in path.read_text().splitlines():
        match = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$", line)
        if not match:
            continue
        key, value = match.groups()
        if value.startswith('"'):
            try:
                value, _ = json.JSONDecoder().raw_decode(value)
            except ValueError:
                raise ValueError(f"Invalid quoted value for {key} in .env") from None
        elif value.startswith("'"):
            end = value.find("'", 1)
            if end == -1:
                raise ValueError(f"Invalid quoted value for {key} in .env")
            value = value[1:end]
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].strip()
        values[key] = value
    return values


@dataclass
class Settings:
    api_key: str = field(default="", repr=False)
    model: str = "jev-latest"
    max_requests: int = 1000
    source: str = "not configured"
    env_path: Path = field(default_factory=lambda: Path.cwd() / ".env")

    def public(self):
        return {"configured": bool(self.api_key), "model": self.model,
                "max_requests": self.max_requests, "source": self.source,
                "env_file": str(self.env_path), "provider": "TypeSafe Jev"}


def load_settings(directory: Path | None = None) -> Settings:
    path = (directory or Path.cwd()) / ".env"
    local = read_dotenv(path)
    # Explicit local configuration wins, so saving in the UI takes effect immediately.
    def value(key, default=""):
        return local.get(key, os.environ.get(key, default))
    key = value("TYPESAFE_API_KEY").strip()
    if key in ("your-typesafe-api-key", "sk-..."):
        key = ""
    try:
        budget = int(value("JEV_SIM_MAX_REQUESTS", "1000"))
    except ValueError:
        raise ValueError("JEV_SIM_MAX_REQUESTS must be an integer") from None
    model = value("TYPESAFE_MODEL", "jev-latest")
    validate_settings(key, model, budget, allow_empty=True)
    return Settings(key, model, budget, ".env" if local.get("TYPESAFE_API_KEY") and key else "process environment" if key else "not configured", path)


def validate_settings(key, model, budget, allow_empty=False):
    if not isinstance(key, str) or (not key and not allow_empty) or len(key) > 4096 or any(c.isspace() or ord(c) < 32 for c in key):
        raise ValueError("Enter a valid API key without whitespace")
    if not isinstance(model, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_./:-]{0,127}", model):
        raise ValueError("Enter a valid model identifier")
    if isinstance(budget, bool) or not isinstance(budget, int) or not 1 <= budget <= 100000:
        raise ValueError("Request budget must be between 1 and 100000")


def save_settings(data: dict, directory: Path | None = None) -> Settings:
    with ENV_LOCK:
        current = load_settings(directory)
        key = data.get("api_key", "") or current.api_key
        model = data.get("model", current.model)
        budget = data.get("max_requests", current.max_requests)
        validate_settings(key, model, budget)
        path = current.env_path
        if path.is_symlink():
            raise ValueError("Refusing to replace a symbolic-link .env file")
        updates = dict(zip(KEYS, (key, model, str(budget))))
        original = path.read_text().splitlines() if path.exists() else ["# Jev-Sim local credentials. Do not commit this file."]
        lines, written = [], set()
        for line in original:
            match = re.match(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=", line)
            name = match.group(1) if match else None
            if name in updates:
                if name not in written:
                    lines.append(f"{name}={json.dumps(updates[name])}")
                    written.add(name)
            else:
                lines.append(line)
        lines += [f"{name}={json.dumps(value)}" for name, value in updates.items() if name not in written]
        fd, temporary = tempfile.mkstemp(prefix=".jev-env-", dir=path.parent)
        try:
            with os.fdopen(fd, "w") as file:
                os.fchmod(file.fileno(), 0o600)
                file.write("\n".join(lines) + "\n")
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return load_settings(directory)

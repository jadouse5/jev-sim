from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class Trajectory:
    episode: int
    seed: int
    environment: str
    policy: str
    initial_state: dict[str, Any]
    steps: list[dict[str, Any]] = field(default_factory=list)
    outcome: str = "timeout"
    total_reward: float = 0.0
    config: dict[str, Any] = field(default_factory=dict)
    schema_version: int = 1

    def to_dict(self) -> dict:
        return asdict(self)

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.to_dict(), indent=2) + "\n")

    @classmethod
    def load(cls, path: str | Path) -> Trajectory:
        data = json.loads(Path(path).read_text())
        if data.get("schema_version") != 1:
            raise ValueError("Unsupported trace schema; expected version 1")
        return cls(**data)

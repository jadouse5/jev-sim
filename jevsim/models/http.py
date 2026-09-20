from __future__ import annotations

import json
import math
import urllib.error
import urllib.request

from ..core.contracts import Decision
from ..settings import load_settings
from .. import usage


def jev_choice(answer, actions, metadata=None):
    """Adapt small provider rounding discrepancies without weakening the engine.

    Allow at most half a percentage point per option, capped at 2.5 points.
    Preserve the provider values alongside the normalized sampling distribution.
    Missing options, invalid values, and larger discrepancies still fail.
    """
    values = answer.get("probabilities")
    if not isinstance(values, dict) or not values or set(values) != set(actions):
        raise ValueError("Jev must return a probability for every legal action, and no others")
    if any(isinstance(p, bool) or not isinstance(p, (int, float)) or
           not math.isfinite(p) or not 0 <= p <= 1 for p in values.values()):
        raise ValueError("Jev probabilities must be finite numbers in [0, 1]")
    total = math.fsum(values.values())
    tolerance = min(.025, .005 * len(values))
    if total <= 0 or abs(total - 1) > tolerance + 1e-9:
        raise ValueError(f"Jev probability total {total:g} is outside the supported rounding tolerance")
    details = dict(metadata or {})
    details.update(provider_probabilities=dict(values), provider_probability_total=total,
                   probabilities_normalized=not math.isclose(total, 1, rel_tol=0, abs_tol=1e-6))
    return Decision({key: value / total for key, value in values.items()},
                    answer.get("confidence"), details).validate(list(actions))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("Policy endpoint redirect refused")


class HTTPPolicy:
    """JSON policy endpoint: {state, actions, objective} → {probabilities, confidence?}.

    A request budget prevents accidental unbounded paid inference. No retries or
    silent fallback: endpoint errors fail the run. Credentials stay server-side.
    """
    def __init__(self, endpoint: str, api_key: str | None = None, name: str = "http-policy",
                 timeout: float = 20, max_requests: int = 1000, track_usage: bool = False):
        if not endpoint.startswith(("http://", "https://")):
            raise ValueError("Endpoint must use HTTP or HTTPS")
        if api_key and not endpoint.startswith("https://") and not endpoint.startswith(("http://127.0.0.1:", "http://localhost:")):
            raise ValueError("Remote authenticated endpoints must use HTTPS")
        self.endpoint, self.api_key, self.name = endpoint, api_key, name
        self.timeout, self.max_requests, self.requests = timeout, max_requests, 0
        self.track_usage, self.last_usage = track_usage, None

    def request(self, payload):
        if self.requests >= self.max_requests:
            raise RuntimeError(f"Policy request budget exhausted ({self.max_requests})")
        self.requests += 1
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = "Bearer " + self.api_key
        request = urllib.request.Request(self.endpoint, json.dumps(payload).encode(), headers)
        receipt = usage.begin() if self.track_usage else None
        result, failed = None, True
        try:
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=self.timeout) as response:
                result = json.load(response)
                failed = False
                self.last_usage = usage.details(result)
                return result
        except urllib.error.HTTPError as exc:
            detail = {401: "API key was rejected", 403: "API key lacks access", 429: "Provider rate limit reached; retry later"}.get(exc.code, "Provider request failed")
            raise RuntimeError(f"{detail} (HTTP {exc.code})") from None
        except urllib.error.URLError as exc:
            raise RuntimeError("Policy endpoint unavailable; check your connection") from None
        except (TimeoutError, OSError):
            raise RuntimeError("Policy request timed out or connection was interrupted") from None
        finally:
            if receipt:
                usage.finish(receipt, result, failed)

    def decide(self, state, actions, objective):
        result = self.request({"state": state, "actions": actions, "objective": objective})
        return Decision(result["probabilities"], result.get("confidence")).validate(list(actions))


class Jev(HTTPPolicy):
    """TypeSafe Choice adapter. Contract: docs.typesafe.ai/primitives/choice."""
    def __init__(self, api_key: str | None = None, model: str | None = None, **kwargs):
        settings = load_settings()
        key = api_key or settings.api_key
        if not key:
            raise ValueError("Set TYPESAFE_API_KEY before using the Jev policy")
        kwargs.setdefault("max_requests", settings.max_requests)
        super().__init__("https://api.typesafe.ai/v1/systemone", key, model or settings.model, **kwargs)

    def decide(self, state, actions, objective):
        result = self.request({"model": self.name, "state": state, "questions": {"action": {
            "type": "choice", "instructions": "Select the next action. Objective: " + objective,
            "criteria": actions}}})
        answer = result["answers"]["action"]
        return jev_choice(answer, actions, {"model": result.get("model"), "usage": result.get("usage", {})})


class LocalJev(HTTPPolicy):
    """Local model exposed through the documented generic HTTP policy contract."""
    def __init__(self, endpoint="http://127.0.0.1:8000/decide", **kwargs):
        super().__init__(endpoint, name="local-policy", **kwargs)

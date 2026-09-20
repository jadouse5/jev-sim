# Contributing

Jev-Sim is an early preview. Bug reports, reproducible examples, environment adapters, and focused pull requests are welcome.

## Develop locally

Use Python 3.10+ and Node 20+ for checks. The app itself has no runtime dependencies or frontend build step.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
python -m jevsim serve --port 3007
```

Choose **Demo · local rules** for development without an API key. Live Jev operations use your credentials and can incur charges. Never commit `.env`, credentials, saved worlds, traces, reports, or usage files. Generated data belongs in the ignored `artifacts/` directory.

## Check a change

```sh
python3 -m unittest discover -s tests -v
node --test tests/test_report.cjs
node --check jevsim/dashboard/app.js
node --check jevsim/dashboard/live.js
node --check jevsim/dashboard/social.js
node --input-type=module --check < jevsim/dashboard/world3d.js
```

The automated suite uses local fixtures and does not need paid API calls. For UI changes, also check the affected controls in a WebGL 2 browser and at a narrow viewport. Include the issue addressed and relevant validation in your pull request.

Keep simulated outcomes clearly distinguished from real-world forecasts. Preserve raw provider probabilities, explicit demo labeling, request budgets, cancellation behavior, and completed history. New features should not make paid calls without an explicit user action.

## Report a problem

Include your operating system, Python/browser versions, reproduction steps, expected behavior, and a sanitized error. Reproduce with a small synthetic scenario where possible. Remove API keys and private context from logs, screenshots, and exported worlds before sharing them. Do not post credentials or sensitive security details in a public issue.

Contributions are distributed under the project's MIT license. Preserve third-party license notices when modifying bundled dependencies.

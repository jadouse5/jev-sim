# Validation

## Automated checks

- 50 Python tests cover the simulation engine, branching, provider contracts, probability normalization, streaming, cancellation, private configuration, social history, population growth, and usage accounting.
- Six Node tests cover conclusion reports, matched populations, new arrivals, incomplete rounds, tied outcomes, and safe standalone exports.
- Dashboard JavaScript syntax checks pass.
- The GitHub workflow template targets Python 3.10–3.13 and Node 20; it is not active until installed under `.github/workflows/`. The automated tests use fixtures and do not require an API key.

## Packaging

A clean source copy builds and installs as a wheel. The installed CLI completes offline demo runs. All 14 dashboard assets and the project license are included; credentials and generated artifacts are excluded.

## Browser validation

The studio has been exercised for persona generation, live decisions, character selection, probability inspection, growing populations, timeline replay, parallel worlds, printable reports, and persistent usage tracking. The expanded city was checked for district navigation, overhead map, cutaway interiors, fullscreen selection, and a narrow mobile layout. Provider integration was exercised separately from the automated fixture suite.

Published illustrations use synthetic scenarios. The city image contains application-rendered scenery, not credentials, account identifiers, private documents, or usage counters. Local screenshots, generated worlds, reports, usage records, and detailed session logs are excluded from the public source.

## Release scope

This is an early local preview, not an internet-hosted multi-user service. Simulation outcomes are exploratory; validation here describes software functionality, not prediction accuracy. A bounded credential scan is part of release preparation, not a comprehensive security audit.

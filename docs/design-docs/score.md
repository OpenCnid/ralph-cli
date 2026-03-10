# score — Domain Overview

## Purpose

`ralph score` measures the fitness of the current repository state and produces
a number between 0.0 and 1.0. It is used as both a standalone diagnostic command
and as an integral part of the `ralph run` build loop, which uses the score to
detect regressions and auto-revert changes that lower fitness below a configured
threshold.

## Usage

```bash
ralph score                # Run scorer, print score + metrics
ralph score --history [N]  # Show last N scored iterations (default 20)
ralph score --trend [N]    # Sparkline + best/worst summary (default 20)
ralph score --compare      # Current score vs last recorded with threshold
ralph score --json         # Structured JSON output for tooling
```

## Config

```yaml
scoring:
  script: score.sh            # Optional: explicit path to score script
  regression-threshold: 0.02  # Score drop that triggers revert in run loop
  default-weights:
    tests: 0.6                # Test-rate weight in default scorer
    coverage: 0.4             # Coverage weight in default scorer
```

When no script is configured, auto-discovery checks `score.sh`, `score.ts`,
then `score.py` in the repo root. If none are found, the built-in default
scorer runs using test results and coverage data.

## Architecture

```
src/commands/score/
  index.ts           — CLI entry point, output formatting, standalone invocation
  scorer.ts          — Script discovery, spawning, timeout, output parsing
  default-scorer.ts  — Built-in scorer (test rate + coverage)
  results.ts         — Append-only TSV log (.ralph/results.tsv)
  trend.ts           — Trend computation and Unicode sparkline rendering
  types.ts           — ScoreResult, ResultEntry, ScoreContext interfaces
```

Imports: `config/loader`, `utils/output`. Imported by `commands/run` for run
loop integration.

## Design Decisions

**Pluggable scorer with a safe built-in default.** Custom score scripts let teams
define fitness in terms of their own benchmarks, lint quotas, or quality signals.
The default scorer covers the common case (test pass rate + coverage) without
requiring any project-specific configuration.

**Gradient signal guides the agent.** Rather than a binary pass/fail, the 0.0–1.0
score gives the run loop a gradient to optimize. Score context is injected into
each build prompt so the agent can see what changed and adjust its approach.

**Append-only history for reliable trends.** `.ralph/results.tsv` is never
truncated. Historical scores survive regressions, making trend data trustworthy
over the full lifetime of a project.

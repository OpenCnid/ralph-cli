# score — Detailed Design

## Purpose

The `score` domain provides gradient-based fitness scoring for the `ralph run`
build loop and a standalone `ralph score` CLI. It measures how "fit" the current
repository state is (0.0–1.0), enabling the run loop to auto-revert changes that
lower fitness below a configured threshold and to provide agents with score
context on each iteration.

## Usage

```bash
ralph score                 # Run scorer, print score + metrics
ralph score --history [N]   # Show last N scored iterations (default 20)
ralph score --trend [N]     # Sparkline + best/worst summary (default 20)
ralph score --compare       # Current score vs last recorded (with threshold)
ralph score --json          # Structured JSON output
```

## Config

```yaml
scoring:
  script: score.sh            # Explicit script path (overrides auto-discover)
  regression-threshold: 0.02  # Drop size that triggers auto-revert
  default-weights:
    tests: 0.6                # Test-rate weight (built-in scorer)
    coverage: 0.4             # Coverage weight (built-in scorer)
```

Auto-discovery order when `script` is not set: `score.sh` → `score.ts` (via
`npx tsx`) → `score.py` (via `python3`) → built-in default scorer.

## Architecture

### Files

| File | Responsibility |
|------|----------------|
| `index.ts` | CLI wiring, standalone scorer invocation, history/trend/compare output |
| `scorer.ts` | Script discovery, process spawning, output parsing, EACCES fallback |
| `default-scorer.ts` | Built-in scorer — test rate from stdout + coverage from JSON |
| `results.ts` | Append-only TSV log at `.ralph/results.tsv` |
| `trend.ts` | `computeTrend()` and `renderSparkline()` (8-block Unicode sparkline) |
| `types.ts` | `ScoreResult`, `ResultEntry`, `ScoreContext` type definitions |

### Score script protocol

The runner spawns the script with `RALPH_ITERATION` and `RALPH_COMMIT` env vars.
The script must write one line to stdout:

```
<score>\t<key>=<value> <key>=<value> ...
```

- `<score>` — float in `[0.0, 1.0]`; any other value is rejected and treated as
  no score
- `<key>=<value>` — optional space-separated metrics surfaced in history output

### Run loop integration

When fitness scoring is enabled in `ralph run`:

1. Pre-iteration: current score recorded as baseline.
2. Agent runs and commits changes.
3. Post-iteration: scorer runs again; delta = new − baseline.
4. If `delta < −threshold`: changes are reverted (`git checkout HEAD~1`) and the
   agent is given a `{score_context}` block explaining the regression.
5. `ScoreContext` is injected into the next prompt so the agent knows its score,
   the delta, and which metrics changed.

## Design Decisions

**Pluggable scripts enable domain-specific fitness.** Teams with performance
benchmarks, linting quotas, or custom quality metrics can plug in a score script
without modifying ralph. The default scorer handles the common case (tests +
coverage) without requiring any extra setup.

**Append-only TSV log survives regressions.** `.ralph/results.tsv` is only ever
appended to, never truncated. This preserves history even through periods of
poor fitness, making trend data trustworthy.

**Threshold-based revert avoids noise sensitivity.** A regression-threshold of
0.02 (2%) gives agents room for transient score dips during refactoring. Teams
can set it to 0 for strict monotonicity or raise it for noisy scorers.

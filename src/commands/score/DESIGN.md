# score — Design Reference

## Purpose

`ralph score` measures the fitness of the current repository state as a number
between 0.0 and 1.0. The score is consumed both by the standalone CLI command
and by the `ralph run` build loop, which uses it to detect regressions and
auto-revert changes that lower the score below a configured threshold.

## Usage

```bash
ralph score                 # Run scorer, print score + metrics
ralph score --history [N]   # Show last N scored iterations (default 20)
ralph score --trend [N]     # Sparkline + best/worst summary (default 20)
ralph score --compare       # Current score vs last recorded, with threshold
ralph score --json          # JSON output: score, source, metrics, timestamp
```

## Config

```yaml
scoring:
  script: score.sh          # Optional: explicit path to score script
  regression-threshold: 0.02  # Score drop that triggers revert (default 0.02)
  default-weights:
    tests: 0.6              # Weight for test pass rate in built-in scorer
    coverage: 0.4           # Weight for coverage in built-in scorer
```

When `scoring.script` is not set, the domain auto-discovers `score.sh`,
`score.ts`, or `score.py` in the repo root, then falls back to the default
scorer if none are found.

## Architecture

| File | Responsibility |
|------|----------------|
| `index.ts` | CLI entry point — flags, standalone scorer invocation, output |
| `scorer.ts` | Script discovery and execution (spawn, timeout, output parse) |
| `default-scorer.ts` | Built-in scorer — test rate from stdout + coverage from JSON |
| `results.ts` | TSV results log — `appendResult()`, `readResults()` |
| `trend.ts` | `computeTrend()` and `renderSparkline()` for `--trend` output |
| `types.ts` | `ScoreResult`, `ResultEntry`, `ScoreContext` interfaces |

**Score script protocol:** the script writes `<score>\t<metrics>` to stdout,
where `<score>` is a float in `[0.0, 1.0]` and `<metrics>` is an optional
space-separated list of `key=value` pairs. Environment variables
`RALPH_ITERATION` and `RALPH_COMMIT` are provided by the runner.

Layer position: `commands/score` → `config` (loadConfig), `utils/output`.

## Design Decisions

**Pluggable scripts with a safe default.** Score scripts let teams define domain-
specific fitness signals (pass rate, performance benchmarks, custom lint counts).
The built-in scorer handles the common case (tests + coverage) without requiring
any project-specific code.

**TSV results log is append-only.** `.ralph/results.tsv` grows with each scored
iteration. Append-only ensures historical data is never silently lost during
regressions, and TSV is grep-friendly without any parsing library.

**Auto-revert is opt-in via threshold.** The `regression-threshold` (default 0.02)
controls how sensitive the run loop is. Teams can raise it for noisy scores or
lower it to zero for strict monotonicity. A threshold rather than a binary
pass/fail gives agents headroom for temporary score dips mid-refactor.

# grade — Design Reference

## Purpose

Quality scoring command. Evaluates each architectural domain across five dimensions
(coverage, docs, staleness, complexity, architecture) and outputs a letter grade.
Tracks trends across runs via `.ralph/grade-history.json`.

## Usage

```bash
ralph grade              # Full graded report
ralph grade --ci         # Fail build if grade below threshold
ralph grade --json       # JSON output for tooling integration
```

## Config

```yaml
quality:
  coverage: 70           # Minimum coverage % for an A on the coverage dimension
  thresholds:
    overall: C           # --ci pass threshold (letter grade)
```

## Architecture

| File | Responsibility |
|------|----------------|
| `src/commands/grade/index.ts` | Entry point, report formatting, --ci logic |
| `src/commands/grade/scorers.ts` | Dimension scoring functions, domain aggregation |
| `src/commands/grade/trends.ts` | Grade history persistence and delta computation |

**Dimension scoring summary:**

| Dimension | Source data | Perfect score condition |
|-----------|-------------|------------------------|
| Coverage | `coverage/lcov.info` | ≥ configured threshold |
| Docs | 3 file existence checks per domain | All 3 present |
| Staleness | `git log` last-modified date | Committed within 90 days |
| Complexity | Average file line count | All files under size limit |
| Architecture | `ralph lint` violation count | Zero violations |

## Design Decisions

**Per-domain scoring enables targeted improvement.** Each domain gets its own
grade, so teams can see which areas need attention rather than averaging everything
into one number that hides problems.

**History is stored locally, not in git.** `.ralph/grade-history.json` is excluded
from version control by default. Teams that want trend history across the whole team
can choose to commit it; local storage avoids polluting git for teams that don't.

**Docs dimension checks three paths.** A domain can document itself via an inline
`DESIGN.md`, a top-level `docs/design-docs/{name}.md`, or a subdirectory
`docs/design-docs/{name}/DESIGN.md`. Multiple paths give teams layout flexibility
without sacrificing the scoring signal.

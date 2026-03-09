# grade — Domain Overview

## Purpose

`ralph grade` scores the repository across five quality dimensions and produces a
letter grade (A–F) per architectural domain and an overall project grade. It is the
primary signal of long-term project health.

## Usage

```bash
ralph grade              # Interactive report with letter grades and trends
ralph grade --ci         # Non-zero exit if any grade is below the configured threshold
ralph grade --json       # Structured JSON output for dashboards or scripts
ralph grade --domain src/commands/lint  # Scope to one domain
```

## Config

```yaml
quality:
  coverage: 70          # Target coverage % (0–100)
  thresholds:
    overall: C          # Minimum letter grade for --ci to pass
```

Coverage path defaults to `coverage/lcov.info`. Override with
`quality.coverage-path` if your tool writes elsewhere.

## Architecture

```
src/commands/grade/
  index.ts       — CLI wiring, output formatting, --ci threshold check
  scorers.ts     — Five dimension scorers + per-domain aggregation logic
  trends.ts      — History read/write (.ralph/grade-history.json) + delta calc
```

Domains to score are read from `config.architecture.domains`. Each domain is
scored independently; the overall grade is the weighted average of all domains.

Layer position: `commands/grade` → `config` (loadConfig), `utils/output`.
Shells out to `ralph lint` for architecture violation counts.

## Design Decisions

**Equal dimension weights keep the model auditable.** Coverage, docs, staleness,
complexity, and architecture each contribute 20% of the domain score. Unequal
weighting would require documentation and create arguments; equal weighting is
transparent and easy to reason about.

**Trend history is append-only.** `.ralph/grade-history.json` grows with every
run. Trends are computed from the most recent prior entry. Append-only ensures
historical scores are never lost when a project temporarily regresses.

**--ci is the pipeline integration point.** Exit codes make grade actionable in
CI/CD without extra scripting. The default threshold (C) is permissive enough for
new adopters while still catching serious decay.

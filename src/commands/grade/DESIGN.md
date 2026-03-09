# grade — Design Reference

## Purpose

Repository quality scoring across five dimensions: test coverage, documentation,
staleness, complexity, and architecture. Outputs a letter grade (A–F) per domain and
an overall project score, with optional trend comparison to the previous run.

## Usage

```bash
ralph grade              # Full report with letter grades
ralph grade --ci         # Exit 1 if any domain is below threshold (default: C)
ralph grade --json       # Machine-readable JSON output
ralph grade --domain src/commands/lint  # Single domain
```

## Config

```yaml
quality:
  coverage: 70          # Minimum coverage % for full score
  thresholds:
    overall: C          # Minimum grade for --ci to pass
    docs: B             # Per-dimension override (optional)
```

## Architecture

| File | Responsibility |
|------|----------------|
| `src/commands/grade/index.ts` | CLI entry, orchestrate scoring, format output |
| `src/commands/grade/scorers.ts` | Five dimension scorers, per-domain aggregation |
| `src/commands/grade/trends.ts` | Load/save `.ralph/grade-history.json`, compute deltas |

**Scoring dimensions:**

1. **Coverage** — reads `coverage/lcov.info` (or configured path); percent lines covered
2. **Docs** — checks for `DESIGN.md`, `docs/design-docs/{name}.md`, `docs/design-docs/{name}/DESIGN.md`
3. **Staleness** — compares last git commit date of domain files against threshold (default 90d)
4. **Complexity** — average file length across domain; penalises files over size limit
5. **Architecture** — counts lint violations (dependency-direction, domain-isolation) in domain

Layer position: `commands/grade` → imports from `config`, `utils/output`, and shells out to `ralph lint` for architecture checks.

## Design Decisions

**Five independent dimensions, one grade.** Each dimension produces a 0–100 score.
They are averaged with equal weight to produce the domain grade. Equal weighting was
chosen to keep the model simple and auditable — no hidden multipliers.

**Trends stored as append-only JSON.** Grade history is written to
`.ralph/grade-history.json` after every run. The trend display reads the most recent
prior entry and computes deltas. Append-only means history is never lost on a
re-score.

**--ci exits non-zero on threshold breach.** CI mode makes the grade actionable in
pipelines without requiring extra scripting. The threshold defaults to C (passing)
so new projects can adopt ralph without immediately failing builds.

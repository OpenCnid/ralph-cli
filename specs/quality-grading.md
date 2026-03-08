# Quality Grading

`ralph grade` scores each domain and architectural layer in the project, tracking quality trends over time.

## Job

When a codebase is continuously modified by AI agents, quality can degrade invisibly — no single change is bad enough to catch, but the accumulation creates problems. The developer needs a way to see, at a glance, which parts of the codebase are healthy and which are degrading.

## How It Works

### Grading Dimensions

Each domain/layer is scored on:

- **Test coverage** — percentage of code covered by tests (pulled from existing coverage tools)
- **Documentation** — does this domain have a design doc? Is it current?
- **Architecture compliance** — how many `ralph lint` violations exist in this domain?
- **File health** — average file size, number of oversized files
- **Staleness** — how recently was this code meaningfully changed vs how old is it?

Each dimension gets a letter grade (A-F) or a numeric score. The composite grade for a domain is the lowest individual dimension (weakest link).

### Output

`ralph grade` updates `docs/QUALITY_SCORE.md` with a table:

```markdown
# Quality Grades

Last updated: 2026-03-07

| Domain | Tests | Docs | Architecture | File Health | Overall |
|--------|-------|------|-------------|-------------|---------|
| auth   | A     | B    | A           | A           | B       |
| billing| C     | F    | A           | B           | F       |
| ui     | B     | B    | C           | D           | D       |

## Trends

- billing/docs: F (was D last week) — design doc deleted, not replaced
- ui/architecture: C → C (stable) — 3 cross-domain imports persist
- auth: stable A/B across all dimensions

## Action Items

- [ ] billing: Write design doc (blocks grade improvement)
- [ ] ui: Resolve 3 cross-domain import violations
- [ ] ui: Split routes.ts (847 lines) into domain-specific files
```

### Trend Tracking

Each run of `ralph grade` appends a snapshot to `.ralph/grade-history.jsonl`. This enables:

- Week-over-week trend comparisons
- Detection of sustained degradation (3+ consecutive drops)
- Celebration of sustained improvement

### Behavior

- `ralph grade` — scores all domains, updates quality.md
- `ralph grade auth` — scores a specific domain
- `ralph grade --ci` — exits non-zero if any domain is below a configured minimum grade
- `ralph grade --trend` — shows trend for last N snapshots

## Acceptance Criteria

- `ralph grade` produces a valid QUALITY_SCORE.md with per-domain scores
- Scores reflect actual project state (test coverage from real tools, lint violations from `ralph lint`)
- Trend tracking detects degradation over 3+ consecutive runs
- Quality.md is human-readable and agent-readable
- `ralph grade --ci` can enforce minimum quality gates in CI
- Grading works without any external tool integrations (architecture compliance and file health are self-contained); test coverage integration is optional and degrades gracefully when unavailable

## Out of Scope

- Running tests (ralph reads coverage reports, doesn't generate them)
- Fixing quality issues (that's the agent's job — ralph just reports)
- Performance benchmarking
- Security scoring

# ralph-cli

CLI tool that prepares and maintains repositories for AI agent development.

AI coding agents generate code fast but create entropy — duplicated patterns, drifting architecture, stale docs, inconsistent conventions. ralph-cli gives you the scaffolding and guardrails to manage that entropy so your codebase stays navigable as agents iterate on it.

## Quick Start

```bash
npm install -g ralph-cli
```

Initialize a project:

```bash
cd your-project
ralph init --defaults
```

```
ℹ Detected: typescript
✓ Created: AGENTS.md
✓ Created: ARCHITECTURE.md
✓ Created: docs/DESIGN.md
✓ Created: docs/RELIABILITY.md
✓ Created: docs/SECURITY.md
✓ Created: docs/PLANS.md
✓ Created: docs/QUALITY_SCORE.md
✓ Created: docs/design-docs/index.md
✓ Created: docs/design-docs/core-beliefs.md
✓ Created: docs/product-specs/index.md
✓ Created: docs/exec-plans/index.md
✓ Created: docs/exec-plans/tech-debt-tracker.md
✓ Created: docs/generated/.gitkeep
✓ Created: docs/references/.gitkeep
✓ Created: .ralph/config.yml
✓ Created: .ralph/rules/.gitkeep

ℹ Done: 16 created, 0 skipped
```

This gives you:

```
AGENTS.md                         # Entry point for agents — how to build, test, navigate
ARCHITECTURE.md                   # Domain map, layer dependencies, structural rules
docs/
├── DESIGN.md                     # Design philosophy and patterns
├── RELIABILITY.md                # Error handling, observability
├── SECURITY.md                   # Auth, data handling, boundaries
├── PLANS.md                      # Active and upcoming plans
├── QUALITY_SCORE.md              # Quality grades per domain
├── design-docs/
│   ├── index.md                  # Catalog of design docs
│   ├── core-beliefs.md           # Operating principles for agents
│   └── patterns/                 # Code pattern docs (via ralph promote)
├── exec-plans/
│   ├── active/                   # Plans being worked on
│   ├── completed/                # Finished plans (archived)
│   └── tech-debt-tracker.md      # Known debt, prioritized
├── product-specs/
│   └── index.md                  # One spec per topic
├── generated/                    # Auto-generated docs
└── references/                   # LLM-friendly external docs
.ralph/
├── config.yml                    # Project config and rule definitions
└── rules/                        # Custom architectural rules
```

`AGENTS.md` is the front door. Any agent reading it can orient itself in your project within two minutes — where to find things, how to build and test, what the rules are.

## Commands

| Command | What it does |
|---------|--------------|
| `ralph init` | Scaffold agent-optimized project structure |
| `ralph lint` | Enforce architectural rules (layer deps, file size, naming, domain isolation) |
| `ralph grade` | Score project quality across 5 dimensions |
| `ralph gc` | Detect drift from golden principles |
| `ralph doctor` | Diagnose repo readiness for AI agents |
| `ralph run` | Autonomous build loop with staged validation and adversarial testing |
| `ralph score` | Fitness scoring with calibration tracking |
| `ralph review` | Agent-powered code review with intent verification |
| `ralph heal` | Automated self-repair from diagnostics |
| `ralph plan` | Manage execution plans with decision logs and tech debt tracking |
| `ralph promote` | Escalate preferences through the enforcement ladder |
| `ralph ref` | Manage external reference docs for agent context |
| `ralph hooks` | Git hooks integration (pre-commit lint on staged files) |
| `ralph ci` | Generate CI configs (GitHub Actions, GitLab CI) |

## The Escalation Ladder

This is ralph's core idea, borrowed from [OpenAI's approach to harness engineering](https://openai.com/index/building-an-agent-that-can-use-any-api/): taste enforcement follows a natural progression from weak to strong.

```
Review comment → Documentation → Lint rule → Code pattern
   (weakest)                                    (strongest)
```

Each level is more enforceable but more rigid. Most feedback starts as a review comment. `ralph promote` helps you move it up the ladder so the same correction never needs to be given twice.

### Example: "Always validate API responses"

**Step 1 — Promote to documentation:**

```bash
ralph promote doc "Always validate API responses with schema validation, never access fields directly"
```

This appends the principle to `docs/design-docs/core-beliefs.md`. Agents can discover it, but might not.

**Step 2 — Promote to lint rule:**

```bash
ralph promote lint "no-unvalidated-api-access" \
  --description "API responses must be validated before field access" \
  --pattern "fetch|axios|got" \
  --require "schema|validate|parse" \
  --fix "Wrap the API call result in a schema validation function before accessing fields"
```

This creates `.ralph/rules/no-unvalidated-api-access.yml`. Now `ralph lint` catches it mechanically — agents must fix it to pass CI.

**Step 3 — Promote to code pattern:**

```bash
ralph promote pattern "validated-api-call" \
  --description "A wrapper that validates API responses at the boundary"
```

This creates a design doc describing the desired pattern. The agent implements the actual utility — now the wrong thing is structurally hard to do.

**Track what's been promoted:**

```bash
ralph promote list
```

```
Taste Rules:
  ✓ validate-api-responses    lint   (.ralph/rules/no-unvalidated-api-access.yml)
  ✓ result-type-errors        doc    (docs/design-docs/core-beliefs.md, line 14)
  ○ structured-logging        lint   (.ralph/rules/structured-logging.yml) — 12 violation(s) remaining
```

## Quality Grading

`ralph grade` scores your project on 5 dimensions:

| Dimension | What it measures |
|-----------|-----------------|
| Tests | Coverage percentage (lcov, Cobertura XML, Go profiles) |
| Docs | Documentation completeness and freshness |
| Architecture | Layer violations, domain isolation, file organization |
| File Health | File sizes, count of oversized files |
| Staleness | Median days since last meaningful change |

Grades are A–F per dimension, per domain (when configured). History is tracked in `.ralph/grade-history.jsonl` with trend detection — sustained degradation across 3+ snapshots triggers warnings.

```bash
ralph grade
```

```bash
ralph grade --trend    # Show historical trends with temporal context
```

## Drift Detection

`ralph gc` scans for entropy accumulating in the codebase:

- **Principle violations** — Code that contradicts documented beliefs (empty catch blocks, untyped data, console.log in production paths)
- **Pattern inconsistency** — Same problem solved 4 different ways across the codebase
- **Stale documentation** — Docs referencing files or APIs that no longer exist
- **Dead code** — Exports with no importers, orphaned test files

Each item includes what was found, which principle it violates, and a concrete fix an agent can follow.

```bash
ralph gc                          # Full scan, updates .ralph/gc-report.md
ralph gc --severity critical      # High-severity only
ralph gc --category dead-code     # Filter by category
ralph gc --fix-descriptions       # Generate .ralph/gc-fix-descriptions.md work list
ralph gc --json                   # Structured output for CI/agents
```

Drift is tracked across runs. Items that persist across multiple scans are flagged as persistent — rising drift count means entropy is outpacing cleanup.

## Autonomous Build Loop

`ralph run` orchestrates AI agents in an iterative build loop — plan a task, implement it, validate, score, and repeat:

```bash
ralph run plan              # Agent creates IMPLEMENTATION_PLAN.md from specs
ralph run                   # Build loop: implement → validate → score → next task
ralph run --dry-run         # Show prompts and stage pipeline without executing
ralph run --max 10          # Limit to 10 iterations
ralph run --verbose         # Show full agent output
```

The build loop includes fitness scoring (test pass rate, coverage), regression detection with automatic revert, and stall detection when agents stop making progress.

### Staged Validation

Validation runs as a configurable multi-stage pipeline instead of a single pass/fail:

```yaml
run:
  validation:
    stages:
      - name: unit
        command: npm test
        required: true
        timeout: 120
      - name: typecheck
        command: npx tsc --noEmit
        required: true
      - name: integration
        command: npm run test:integration
        required: true
        run-after: unit
        timeout: 180
      - name: e2e
        command: npm run test:e2e
        required: false     # informational — doesn't block
        run-after: integration
```

When a stage fails, the agent gets targeted feedback — "unit tests passed but integration broke" instead of just "validation failed." Stages support dependencies (`run-after`), per-stage timeouts, and required vs. informational modes.

### Adversarial Testing

After each successful build iteration, ralph can spawn a second agent to break the first agent's code:

```yaml
run:
  adversarial:
    enabled: true
    budget: 5               # max test cases per iteration
    timeout: 300             # seconds
    diagnostic-branch: true  # preserve failing tests for debugging
```

The adversary writes edge-case tests targeting boundary conditions, error paths, and race conditions the builder likely missed. It's mechanically constrained — file restriction enforcement prevents it from modifying implementation code, and a test deletion guard prevents it from removing existing tests. If the adversary finds a bug, the iteration is reverted and the failing tests are pushed to a diagnostic branch for inspection.

### Calibration Tracking

Track whether ralph's validation is actually catching bugs or just rubber-stamping:

```bash
ralph score --calibration
```

```
Calibration (last 30 iterations):
  Pass rate:       97%  (threshold: 95%)
  Discard rate:     3%
  Score volatility: 0.012
  Stall frequency: 10%

  ⚠ Trust drift: high pass rate + low discard rate
  Consider: add adversarial testing, increase test coverage requirements
```

Calibration is also shown automatically at the end of each `ralph run` session.

### Intent Verification

`ralph review --intent` cross-references code changes against the spec's stated motivation, not just its requirements:

```bash
ralph review --intent        # Review with motivation cross-referencing
```

This catches implementations that satisfy the letter of the spec but miss its purpose. `ralph doctor` also checks that spec files include `## Motivation` sections.

### Approach Divergence

`ralph gc --temporal` tracks how coding patterns evolve across iterations:

```bash
ralph gc --temporal          # Show pattern evolution timeline
ralph gc --temporal --last 5 # Last 5 snapshots only
```

Detects when the dominant approach to error handling, exports, or null-checking shifts unexpectedly — a signal that an agent changed its coding style without being asked to.

## Configuration

`ralph init` generates `.ralph/config.yml` with sensible defaults:

```yaml
project:
  name: "my-project"
  language: typescript

architecture:
  layers:
    - types
    - config
    - data
    - service
    - ui
  direction: forward-only
  rules:
    max-lines: 500
    naming:
      schemas: "*Schema"
      types: "*Type"

quality:
  minimum-grade: D

gc:
  consistency-threshold: 60
  exclude:
    - node_modules
    - dist

doctor:
  minimum-score: 7
```

Layers define dependency direction — `types` can't import from `service`, but `service` can import from `types`. The `direction: forward-only` setting enforces this top-to-bottom flow.

## Custom Rules

### YAML rules

Create `.ralph/rules/no-console-log.yml`:

```yaml
name: no-console-log
description: Use structured logging instead of console.log
severity: error
match:
  pattern: 'console\.log'
fix: "Replace console.log with the project's logger (e.g., logger.info())"
```

This rule is automatically picked up by `ralph lint` — no config wiring needed.

### Script rules

Create `.ralph/rules/check-imports.js` for complex checks that regex can't express:

```javascript
// Receives { projectRoot, files } on stdin, outputs { name, violations } as JSON
import { readFileSync } from 'fs';

const input = JSON.parse(readFileSync('/dev/stdin', 'utf-8'));
const violations = [];

// ... your analysis logic ...

console.log(JSON.stringify({
  name: 'check-imports',
  violations
}));
```

Scripts run with a 30-second timeout and must output structured JSON with `name` and `violations` (each violation has `file`, `line`, `what`, `rule`, `fix`, `severity`).

## CI Integration

Install git hooks:

```bash
ralph hooks install    # Pre-commit: lint staged files only
```

Generate CI configs:

```bash
ralph ci generate github    # .github/workflows/ralph.yml
ralph ci generate gitlab    # .gitlab-ci.yml
```

Generated configs include caching for faster ralph-cli installation. In CI environments, ralph auto-detects standard CI variables (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, etc.) and applies any `ci:` config overrides automatically.

## References

`ralph ref` manages LLM-friendly documentation for external libraries your project depends on:

```bash
ralph ref add https://docs.astro.build/llms.txt        # Fetches and stores as -llms.txt
ralph ref add ./local-api-docs.md                       # Local markdown gets -llms.md suffix
ralph ref update                                        # Re-fetch all remote references
ralph ref discover                                      # Scan package.json/pyproject.toml/go.mod for available llms.txt files
```

References live in `docs/references/` where agents can find them — curated external context instead of hallucinated API details.

## Philosophy

**Agent-optimized repos.** The structure ralph creates isn't for humans to browse — it's for AI agents to navigate. `AGENTS.md` is a table of contents, not documentation. Lint errors include fix instructions, not just violation descriptions. Every output is designed to be consumed by an agent and acted on without additional context.

**LLM-agnostic.** Zero references to specific AI providers or models anywhere — in source, templates, or generated files. ralph works with Codex, Claude Code, Aider, Cursor, Copilot, or whatever comes next.

**Minimal dependencies.** Three runtime dependencies: `commander`, `yaml`, `picocolors`. Everything else is Node.js stdlib.

**Inspired by OpenAI's harness engineering.** The scaffolding structure, escalation ladder, and drift detection concepts come from how OpenAI manages codebases that AI agents build and maintain.

## Contributing

Contributions are welcome.

```bash
git clone https://github.com/OpenCnid/ralph-cli.git
cd ralph-cli
npm install
npm run build
npm test           # 1051 tests across 42 files
```

The project uses TypeScript (strict mode, ESM), vitest for tests, and eslint for linting. See `AGENTS.md` for architecture details and development conventions.

## License

MIT

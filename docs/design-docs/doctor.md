# doctor — Domain Overview

## Purpose

`ralph doctor` audits repository health across four categories: structure,
content, backpressure, and operational. It is the baseline check — confirming
the project has the files, docs, and config an AI agent needs to work safely.

## Usage

```bash
ralph doctor              # Full health report with pass/fail per check
ralph doctor --ci         # Non-zero exit if any check fails
ralph doctor --fix        # Apply automated fixes where available
ralph doctor --json       # Structured JSON for dashboards or CI
```

## Config

```yaml
paths:
  agents-md: AGENTS.md             # Location of agent context file
  architecture-md: ARCHITECTURE.md # Location of architecture document
  specs: docs/product-specs        # Product specs directory
  design-docs: docs/design-docs    # Design docs directory
```

## Architecture

```
src/commands/doctor/
  index.ts    — CLI entry, run checks, aggregate score, format output
  checks.ts   — Four check categories; each returns Check[] with fix hints
```

Checks are pure functions given `(projectRoot, config)`. They do not write
files (except when `--fix` is active). Layer position: `commands/doctor` →
`config` (loadConfig, findProjectRoot), `utils/output`.

## Design Decisions

**Four named categories map to four kinds of debt.** Structure checks missing
files; content checks quality of file contents; backpressure checks freshness;
operational checks runtime correctness. Named categories let teams triage by
type rather than sorting by severity.

**Fix suggestions are strings, not side effects.** Each check carries an
optional `fix` string. Automated fixes (creating missing files, trimming
AGENTS.md) are applied by `--fix`. Fixes requiring human judgment are described
but not applied. This keeps automated mode predictable and auditable.

**Score out of 10 is a lagging indicator.** Doctor is meant to detect
regressions, not celebrate improvements. A 10/10 means nothing is broken; a
9/10 means one category has a failure that needs attention today.

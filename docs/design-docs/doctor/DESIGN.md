# doctor — Design Reference

## Purpose

Repository health auditing across four check categories: structure, content,
backpressure, and operational. Outputs a 10-point score and actionable fix
suggestions, with optional `--fix` mode to apply automated repairs.

## Usage

```bash
ralph doctor              # Full health report (10-point score)
ralph doctor --ci         # Exit 1 if any check fails
ralph doctor --fix        # Apply automated fixes where available
ralph doctor --json       # Machine-readable JSON output
```

## Config

```yaml
paths:
  agents-md: AGENTS.md             # Path to agent context file
  architecture-md: ARCHITECTURE.md # Path to architecture document
  specs: docs/product-specs        # Product specs directory
  design-docs: docs/design-docs    # Design doc directory
```

## Architecture

| File | Responsibility |
|------|----------------|
| `src/commands/doctor/index.ts` | CLI entry, run checks, format output, --fix dispatch |
| `src/commands/doctor/checks.ts` | Four check categories, returns `Check[]` with fix hints |

**Check categories:**

1. **Structure** — AGENTS.md exists (≤100 lines), ARCHITECTURE.md exists, docs/ dirs present
2. **Content** — ARCHITECTURE.md has domain table, AGENTS.md has commands section, specs non-empty
3. **Backpressure** — AGENTS.md freshness, spec file sizes within limits
4. **Operational** — `.ralph/config.yml` parseable, lint reports zero errors

Layer position: `commands/doctor` → `config`, `utils/output`. Shells out via
`execSync` for git history and lint checks.

## Design Decisions

**Checks return fix strings, not actions.** Each `Check` carries an optional
`fix` string (a human-readable instruction or CLI command). The `--fix` flag
applies automated repairs; complex repairs are described for the developer.
This avoids silent mutations in automated workflows.

**10-point score as a quality dashboard.** Doctor outputs a score out of 10.
Per-check detail is shown for actionability; the total score is the headline
metric for CI badges and trend tracking.

**--ci gates on zero failures.** Doctor checks are foundational — missing
files and broken configs are not tolerable in a healthy repository. CI mode
exits non-zero if any single check fails, not on a threshold.

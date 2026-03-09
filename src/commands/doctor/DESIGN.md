# doctor — Design Reference

## Purpose

Repository health auditing across four check categories: structure, content,
backpressure, and operational. Outputs a pass/fail score and actionable fix
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

All paths default to ralph's conventional locations. Override only when the
project uses a non-standard layout.

## Architecture

| File | Responsibility |
|------|----------------|
| `src/commands/doctor/index.ts` | CLI entry, run checks, format output, --fix dispatch |
| `src/commands/doctor/checks.ts` | Four check categories, returns `Check[]` with fix suggestions |

**Check categories:**

1. **Structure** — AGENTS.md exists and under 100 lines, ARCHITECTURE.md exists, docs/ dirs present
2. **Content** — ARCHITECTURE.md has domain table, AGENTS.md has commands section, specs non-empty
3. **Backpressure** — AGENTS.md is current (git-modified within threshold), spec file sizes reasonable
4. **Operational** — `.ralph/config.yml` exists and parses, lint passes with zero errors

Layer position: `commands/doctor` → imports from `config`, `utils/output`. Shells out via `execSync` for git and lint checks.

## Design Decisions

**Checks return fix strings, not actions.** Each `Check` carries an optional
`fix` string (human-readable instruction or CLI command). The `--fix` flag
applies automated repairs where possible; complex repairs are described but left
to the developer. This avoids silent mutations in automated mode.

**10-point score as a quality dashboard.** Doctor outputs a score out of 10
(one point per check category group). A pass/fail per-check display gives
actionable detail while the total score provides a single headline metric for
dashboards and trend tracking.

**--ci gates on zero failures.** CI mode exits non-zero if any check fails,
not just below a threshold. Doctor checks are foundational (missing files,
broken config); partial compliance is not acceptable in a healthy repository.

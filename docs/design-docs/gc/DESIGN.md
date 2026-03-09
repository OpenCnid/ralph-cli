# gc — Design Reference

## Purpose

Garbage collection command. Detects four categories of architectural drift —
principle violations, dead code, stale documentation, and pattern inconsistencies —
and tracks resolution history so recurring problems are visible.

## Usage

```bash
ralph gc                 # Full report
ralph gc --ci            # Non-zero exit on any findings
ralph gc --category principles   # One category only
```

## Config

```yaml
gc:
  exclude:
    - vitest.config.ts   # Exempt specific files from dead-code scanning
  anti-patterns:
    - .ralph/gc-patterns/
```

Custom anti-pattern YAML files: `name`, `pattern` (regex), `keywords`, `description`,
`severity` (low/medium/high), `fix` (string), optional `autofix.replace`.

## Architecture

| File | Responsibility |
|------|----------------|
| `src/commands/gc/index.ts` | CLI wiring, category filter, output formatting |
| `src/commands/gc/scanners.ts` | Four category scanners returning `GcItem[]` |
| `src/commands/gc/history.ts` | History persistence and first-seen / resolved tracking |

**Scanner responsibilities:**

| Category | What it checks |
|----------|---------------|
| `principles` | Code violating patterns stated in `core-beliefs.md` |
| `dead-code` | Files and exports with no importers (excluding gc.exclude list) |
| `stale-docs` | Docs not updated relative to their domain's last code change |
| `patterns` | Anti-patterns from built-in + custom YAML rules |

## Design Decisions

**History enables trend detection.** Each `GcItem` is keyed by a stable hash. The
history file records first-seen and resolved dates. A resolved item that reappears
is flagged as recurring — a signal of a systemic problem rather than a one-off.

**YAML rules keep extension accessible.** The patterns scanner accepts YAML files
from `.ralph/gc-patterns/`. No TypeScript knowledge required to add project-specific
drift detectors. The `autofix.replace` field enables safe automated fixes.

**Category filter preserves usefulness at scale.** In large codebases a full gc scan
may produce hundreds of items. The `--category` flag lets teams run targeted scans
(e.g. `ralph gc --category dead-code`) in CI without being overwhelmed by unrelated
categories.

# Drift Detection

`ralph gc` (garbage collection) scans the codebase against golden principles and flags entropy that has accumulated over time.

## Job

When AI agents generate code at high throughput, they replicate patterns that already exist — including suboptimal ones. Without periodic cleanup, bad patterns compound silently. The developer needs an automated system that detects pattern drift and generates targeted cleanup tasks, so entropy is managed continuously rather than in painful bursts.

## How It Works

### What It Scans For

**Golden principle violations** — Compares code against rules defined in `docs/design-docs/core-beliefs.md` and domain docs (`docs/RELIABILITY.md`, `docs/SECURITY.md`, etc.):

```
DRIFT: src/api/payments.ts probes response data without validation
  Principle: "Validate data at boundaries — don't probe shapes YOLO-style"
  Occurrences: 3 (lines 45, 89, 134)
  Suggested fix: Add schema validation using the project's validation library
```

**Pattern inconsistency** — Detects when the same problem is solved different ways across the codebase:

```
DRIFT: 4 different error handling patterns found across service layer
  - try/catch with console.log (3 files)
  - try/catch with custom logger (8 files)
  - .catch() with swallowed error (2 files)
  - Result type pattern (12 files)
  Dominant pattern: Result type (48%)
  Suggested fix: Migrate non-dominant patterns to Result type
```

**Stale documentation** — Flags docs that reference code structures, files, or APIs that no longer exist:

```
DRIFT: docs/design/auth-flow.md references AuthController
  File src/controllers/AuthController.ts was deleted 14 days ago
  Suggested fix: Update auth-flow.md to reflect current auth implementation
```

**Dead or orphaned code** — Detects exports with no importers, test files with no corresponding source:

```
DRIFT: src/utils/formatCurrency.ts has 0 importers
  Last imported: removed in commit abc123 (2026-02-28)
  Suggested fix: Delete if no longer needed, or document why it's retained
```

### Output Modes

- `ralph gc` — prints drift report to stdout, updates `.ralph/gc-report.md`
- `ralph gc --json` — structured output for CI or agent consumption
- `ralph gc --fix-descriptions` — generates a markdown file with one fix task per drift item, suitable for feeding into an agent as a work list
- `ralph gc --severity critical` — only report high-severity drift

### Severity Levels

- **Critical** — principle violation that affects correctness or security (unvalidated data, swallowed errors)
- **Warning** — pattern inconsistency or stale docs that cause confusion
- **Info** — minor housekeeping (orphaned files, naming inconsistencies)

### Scheduling

ralph gc is designed to run on a cadence — daily or weekly. Each run produces a snapshot. The trend of drift count over time is a health metric: rising drift means the codebase is accumulating entropy faster than it's being cleaned up.

## Acceptance Criteria

- `ralph gc` detects at least 3 categories of drift: principle violations, pattern inconsistency, and stale documentation
- Every drift item includes what was found, which principle it violates, and a concrete suggested fix
- Output is detailed enough that an agent can resolve the drift item without additional context
- `ralph gc` runs in under 30 seconds on a 10,000-file repository
- Drift items are deduplicated across runs (same issue doesn't produce duplicate reports)
- Severity levels accurately reflect impact (principle violations > pattern inconsistency > housekeeping)
- `ralph gc --fix-descriptions` produces a work list that can be fed directly to any agent CLI

## Out of Scope

- Automatically fixing drift (ralph reports, agents fix)
- Dependency vulnerability scanning (use npm audit, pip audit, etc.)
- Performance regression detection
- Git history analysis beyond basic "when was this last changed"

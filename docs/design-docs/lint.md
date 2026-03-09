# lint — Domain Overview

## Purpose

`ralph lint` enforces architectural constraints across the codebase. It runs five
built-in structural rules and any project-specific custom rules, producing actionable
violation reports. With `--fix` it applies safe auto-corrections automatically.

## Usage

```bash
ralph lint                        # Lint all source files
ralph lint src/                   # Lint a specific path
ralph lint --fix                  # Auto-fix where possible, report the rest
ralph lint --rule file-size       # Run a single rule
ralph lint --json                 # Structured JSON output for CI tooling
```

Exit code 0 = no errors; 1 = at least one error-severity violation.

## Config

```yaml
architecture:
  layers: [config, commands, utils]
  domains:
    - name: myfeature
      path: src/commands/myfeature
  rules:
    max-lines: 300
    naming:
      schemas:
        - pattern: '^[a-z][a-z0-9-]*$'
          targets: [file]
    direction: forward-only
  cross-cutting: [utils]
```

Custom rules: place `.yml` or `.js` files in `.ralph/rules/`.

## Architecture

```
src/commands/lint/
  index.ts         — CLI entry: config, rule construction, file collection, output
  engine.ts        — runRules(), formatViolation(), formatJson()
  files.ts         — collectFiles() with exclude-glob filtering
  imports.ts       — import graph extraction for dependency rules
  rules/
    dependency-direction.ts   — layer ordering (forward-only / strict)
    domain-isolation.ts       — cross-domain import prevention
    file-size.ts              — max-lines threshold enforcement
    naming-convention.ts      — file name regex validation (supports --fix)
    file-organization.ts      — domain directory membership
    custom-rules.ts           — YAML pattern rules + JS script rules loader
```

The `grade` command imports `engine.ts` and rule factories to score domains without
running the full lint CLI.

## Design Decisions

**Rule factory pattern.** Rules are created by `create*Rule(config)` factories
returning `{ name, check, autofix? }`. No class hierarchy — just plain objects. The
optional `autofix` field means auto-fix capability is declared per rule, not assumed.

**Auto-fix is conservative.** Only `naming-convention` (rename via known pattern) and
custom YAML rules (regex replace) implement `autofix`. Rules whose fixes require
understanding intent — dependency direction, domain isolation, file organization —
report only. Preventing accidental code corruption takes priority over convenience.

**Custom rules without forking.** YAML rules cover pattern-match violations with
optional regex replacement. JS scripts cover arbitrary logic via a simple
`check(files, context)` contract. Both formats are discovered from `.ralph/rules/`
at runtime, so projects can extend lint without modifying ralph-cli itself.

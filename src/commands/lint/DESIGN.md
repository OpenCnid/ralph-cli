# lint — Design Notes

## Purpose

Enforces architectural rules across source files. Reports violations (and optionally
auto-fixes them) for five built-in rules plus any project-specific custom rules
defined in `.ralph/rules/`.

## Usage

```bash
ralph lint                      # Lint all source files
ralph lint src/commands/run     # Lint a specific directory
ralph lint --fix                # Apply auto-fixes, then report remaining violations
ralph lint --rule naming-convention  # Run a single rule
ralph lint --json               # Machine-readable JSON output
```

## Config

Relevant `.ralph/config.yml` sections:

```yaml
architecture:
  layers: [config, commands, utils]
  domains:
    - name: lint
      path: src/commands/lint
  rules:
    max-lines: 300
    naming:
      schemas:
        - pattern: '^[a-z][a-z0-9-]*$'
          targets: [file]
    direction: forward-only
  cross-cutting: [utils]
gc:
  exclude: [vitest.config.ts, '**/*.test.ts']
```

## Architecture

```
src/commands/lint/
  index.ts               — entry point: load config, build rules, collect files, report
  engine.ts              — rule runner, violation formatter, JSON serialiser
  files.ts               — file collection with exclude glob support
  imports.ts             — static import graph parser (used by dependency rules)
  rules/
    dependency-direction.ts   — enforces layer ordering (forward-only or strict)
    domain-isolation.ts       — prevents cross-domain imports outside cross-cutting
    file-size.ts              — flags files exceeding max-lines threshold
    naming-convention.ts      — validates file names against regex patterns; supports --fix
    file-organization.ts      — ensures files live in their declared domain directory
    custom-rules.ts           — loads YAML rules and JS scripts from .ralph/rules/
```

Layer position: `commands` layer. Imports `config` (loadConfig) and `utils` (output).
The `grade` command reuses `engine.ts` and individual rule factories for per-domain
scoring.

## Design Decisions

**Rule factory pattern.** Each built-in rule is created by a `create*Rule()` factory
that takes config parameters and returns a `LintRule` object (`{ name, check, autofix? }`).
This makes rules independently testable and composable without a class hierarchy.

**Auto-fix is opt-in and rule-local.** Only rules that can safely transform files
implement the optional `autofix` function. Rules where fixes require human judgment
(dependency direction, domain isolation, file organization) report only. This
prevents silent corruption of the codebase.

**Custom rules via YAML and JS.** Project teams can add rules without forking ralph.
YAML rules define pattern matching with optional `autofix.replace`. JS scripts export
a `check(files, context)` function for arbitrary logic. Both are discovered
automatically from `.ralph/rules/`.

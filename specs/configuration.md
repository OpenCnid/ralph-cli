# Configuration

`.ralph/config.yml` defines per-project settings that control how all ralph-cli commands behave.

## Job

Different projects have different structures, tech stacks, and architectural rules. The developer needs a single configuration file that tells ralph-cli what kind of project this is, what rules apply, and how to integrate with existing tooling — without ralph-cli making assumptions that don't fit.

## Config Structure

```yaml
# .ralph/config.yml

project:
  name: "my-project"
  description: "A brief description for AGENTS.md generation"
  language: typescript        # typescript | javascript | python | go | rust | multi
  framework: nextjs           # optional — helps ralph make smarter defaults

# Which agent runner the developer uses (informational, not a dependency)
runner:
  cli: codex                  # codex | claude | amp | aider | cursor | other
  # ralph-cli never invokes this directly — it's metadata for documentation

# Architectural rules
architecture:
  # Layer ordering (dependency direction: earlier layers cannot import later ones)
  layers:
    - types
    - config
    - data
    - service
    - runtime
    - ui

  # Domain boundaries
  domains:
    - name: auth
      path: src/domain/auth
    - name: billing
      path: src/domain/billing

  # Cross-cutting concerns allowed to be imported by any layer
  cross-cutting:
    - src/providers
    - src/shared

  # File constraints
  files:
    max-lines: 500
    naming:
      schemas: "*Schema"
      types: "*Type"

# Quality grading configuration
quality:
  # Minimum grade to pass CI
  minimum-grade: C
  
  # Where to find test coverage reports (optional)
  coverage:
    tool: vitest               # vitest | jest | pytest | go-test | none
    report-path: coverage/lcov.info

# Drift detection configuration
gc:
  # How strict is pattern consistency checking
  consistency-threshold: 60   # percentage — flag when dominant pattern is below this
  
  # Directories to exclude from scanning
  exclude:
    - node_modules
    - dist
    - .next
    - coverage

# Doctor configuration
doctor:
  # Minimum score to pass CI
  minimum-score: 7
  
  # Custom checks (paths to additional check scripts)
  custom-checks: []

# Paths (override defaults if project structure differs)
paths:
  agents-md: AGENTS.md
  architecture-md: ARCHITECTURE.md
  docs: docs
  specs: docs/product-specs
  plans: docs/exec-plans
  design-docs: docs/design-docs
  references: docs/references
  generated: docs/generated
  quality: docs/QUALITY_SCORE.md

# References configuration
references:
  max-total-kb: 200
  warn-single-file-kb: 80
```

## Behavior

### Defaults

ralph-cli ships with sensible defaults for every setting. A project can run with just:

```yaml
# .ralph/config.yml
project:
  name: "my-project"
  language: typescript
```

Everything else defaults:
- Layers default to `[types, config, data, service, ui]`
- Max file lines defaults to 500
- Minimum grade defaults to D
- Coverage tool defaults to none
- Standard paths apply

### Validation

- `ralph config validate` — checks config syntax and reports errors
- On every ralph command, config is validated first. Invalid config = immediate error with fix instructions.
- Unknown keys produce warnings, not errors (forward compatibility)

### Generation

- `ralph init` generates a starter config based on detected project structure
- Detects language from package.json, pyproject.toml, go.mod, Cargo.toml
- Detects framework from dependencies
- Detects existing test runner and linter

### Environment-Specific Overrides

Config supports environment overrides for CI vs local:

```yaml
# Base config applies everywhere

ci:
  quality:
    minimum-grade: B           # Stricter in CI than local
  doctor:
    minimum-score: 8
```

## Acceptance Criteria

- `.ralph/config.yml` is the single source of configuration for all ralph-cli commands
- Config parsing is fast (under 100ms)
- Missing config file doesn't crash — ralph uses defaults and warns
- Invalid config produces clear error messages with fix suggestions
- `ralph init` generates a valid config that reflects the actual project structure
- All paths in config are relative to project root
- Config is YAML — human-readable and agent-editable
- Every config option has a documented default
- Adding a new language or framework doesn't require config schema changes (extensible)

## Out of Scope

- Global user-level configuration (ralph-cli is project-scoped only)
- Remote configuration or config servers
- Config inheritance across repos
- Secrets or credentials (use environment variables or secret managers)

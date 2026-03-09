# promote — Domain Overview

## Purpose

`ralph promote` escalates informal taste rules into enforced project standards.
It manages four tiers of enforcement: documentation beliefs, lint rules,
code patterns, and a combined list view.

## Usage

```bash
ralph promote doc "Prefer immutable data structures"
ralph promote doc "..." --to architecture.md        # Append to a custom doc
ralph promote lint no-eval --pattern 'eval\(' --fix 'Avoid eval; use JSON.parse'
ralph promote pattern singleton --description "Controlled single-instance access"
ralph promote list                                   # View all promoted rules
```

## Config

```yaml
paths:
  design-docs: docs/design-docs   # Where doc and pattern promotions are written
  docs: docs                      # Used as base for custom --to targets
```

## Architecture

```
src/commands/promote/
  index.ts  — Four exported functions for each subcommand plus helpers
```

Calls `commands/lint` to count violations for the `list` subcommand. Writes to
`config.paths['design-docs']` and `.ralph/rules/`. Layer position: thin command
layer over `fs`, `config`, and `lint/engine`.

## Design Decisions

**Escalation ladder reflects real adoption paths.** Teams naturally start with
informal agreement before codifying rules. The four tiers (doc → lint → pattern
→ list) model this progression, giving teams a natural ramp from "we believe"
to "the machine enforces it".

**`promote lint` always generates YAML, never JavaScript.** YAML rules are
human-readable, diffable, and support autofix strings. JavaScript rules are
reserved for logic that cannot be expressed as a regex match — `promote` targets
the common case where a pattern match is sufficient.

**`list` is observational, not destructive.** Running `promote list` never
modifies any file. It runs lint in read-only mode to count violations and
prints a status summary. This makes it safe to call frequently (e.g., in CI
dashboards or from `ralph grade`).

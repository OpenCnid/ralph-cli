# promote — Design

## Purpose

`ralph promote` moves taste rules up the escalation ladder: from informal
review comments to documented principles, enforced lint rules, and reusable
code patterns. Each tier is more authoritative and harder to ignore than the
last.

## Usage

```bash
ralph promote doc "Prefer composition over inheritance"   # Append to core-beliefs.md
ralph promote lint no-console --pattern 'console\.' --fix 'Use output utilities'
ralph promote pattern retry-with-backoff --description "Exponential backoff for retries"
ralph promote list                                        # Show all promoted rules
```

## Config

No dedicated config section. Promotes write to paths configured in:

```yaml
paths:
  design-docs: docs/design-docs  # Target for doc promotions and patterns
  docs: docs                     # Fallback for custom --to targets
```

## Architecture

```
src/commands/promote/
  index.ts  — promoteDocCommand, promoteLintCommand, promotePatternCommand,
               promoteListCommand; all self-contained in one file
```

Layer position: `commands/promote` → `commands/lint` (runs lint to count
violations), `config` (loadConfig), `utils/output`, `utils/fs`.

## Design Decisions

**Four subcommands map to four rungs of enforcement.** `doc` adds a belief to
`core-beliefs.md` (lowest friction). `lint` creates a machine-checked YAML
rule in `.ralph/rules/`. `pattern` creates a `design-docs/patterns/` document
(reusable reference). `list` provides a single view across all rungs so teams
can see what has been promoted and how effective each rule is.

**Lint list shows live violation counts.** `promote list` runs lint against the
codebase to count remaining violations per custom rule. A `✓` marker means the
rule is satisfied; `○` means violations remain. This gives instant feedback on
rule adoption without needing to run `ralph lint` separately.

**Append-only doc entries prevent merge conflicts.** Principle entries are
appended to `core-beliefs.md` with a datestamp. Chronological ordering keeps
history intact and makes entries conflict-free in concurrent-development
scenarios.

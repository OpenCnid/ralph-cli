# gc — Design Reference

## Purpose

Garbage collection command. Scans the codebase for four categories of architectural
drift: principle violations, dead code, stale documentation, and pattern
inconsistencies. Produces a prioritised report with fix suggestions and tracks
resolved items over time.

## Usage

```bash
ralph gc                 # Full drift report
ralph gc --ci            # Exit 1 if any items found
ralph gc --category dead-code   # Scope to one category
ralph gc --json          # Structured JSON output
```

## Config

```yaml
gc:
  exclude:
    - vitest.config.ts   # Files to skip (e.g. config files never imported)
  anti-patterns:         # Path to custom anti-pattern files
    - .ralph/gc-patterns/
```

Custom anti-patterns live in `.ralph/gc-patterns/*.yml`. Each file defines a
`pattern`, `keywords`, `description`, `severity`, and `fix` suggestion.

## Architecture

| File | Responsibility |
|------|----------------|
| `src/commands/gc/index.ts` | CLI entry, aggregate results, format output |
| `src/commands/gc/scanners.ts` | Four category scanners (principles, dead code, stale docs, patterns) |
| `src/commands/gc/history.ts` | Load/save `.ralph/gc-history.json`, resolved-item tracking |

**Four drift categories:**

1. **Principles** — Code patterns that contradict `docs/design-docs/core-beliefs.md`
2. **Dead code** — Files and exports with no detected importers
3. **Stale docs** — Documentation files not updated in > 90 days relative to their domain
4. **Patterns** — Inconsistencies in coding style detected via configurable anti-pattern rules

Layer position: `commands/gc` → `config`, `utils/output`. Reads source files and
git history directly; no subprocess invocations.

## Design Decisions

**Categories, not severity levels.** Items are grouped by drift category rather than
a single severity ranking. This lets teams resolve a whole category at once (e.g.
"fix all dead code today") rather than triaging an undifferentiated list.

**Custom anti-patterns via YAML.** Teams extend the pattern scanner without writing
code. YAML rules support `autofix.replace` for simple string substitutions, enabling
`ralph gc --fix` to resolve pattern items automatically.

**History tracks resolved items.** `.ralph/gc-history.json` records when each item
was first seen and when it was resolved. This surfaces recurring drift — items that
keep coming back signal a systemic problem, not a one-time cleanup.

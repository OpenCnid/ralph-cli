# gc — Domain Overview

## Purpose

`ralph gc` scans the codebase for architectural drift across four categories:
principle violations, dead code, stale documentation, and coding pattern
inconsistencies. It is the maintenance complement to `ralph grade` — where grade
measures quality over time, gc finds specific things to fix now.

## Usage

```bash
ralph gc                          # Full drift report across all categories
ralph gc --ci                     # Non-zero exit if any items found
ralph gc --category dead-code     # Single category scan
ralph gc --json                   # JSON for CI dashboards or scripts
```

## Config

```yaml
gc:
  exclude:
    - vitest.config.ts            # Skip specific files (e.g. config-only files)
  anti-patterns:
    - .ralph/gc-patterns/         # Directory of custom YAML anti-pattern rules
```

## Architecture

```
src/commands/gc/
  index.ts       — CLI entry point, result aggregation, output formatting
  scanners.ts    — One scanner per category; returns GcItem[] per category
  history.ts     — Drift history read/write (.ralph/gc-history.json)
```

Drift history is stored in `.ralph/gc-history.json`. Each item records its first
seen date and, when resolved, the resolution date. This enables trend reporting.

Layer position: `commands/gc` → `config` (loadConfig, findProjectRoot), `utils/output`.

## Design Decisions

**Four named categories rather than a severity queue.** Grouping by category
(principles, dead code, stale docs, patterns) lets contributors focus on one type of
work at a time. Mixed severity lists create triage overhead; category lists create
natural work batches.

**YAML anti-patterns extend the scanner without code.** Custom drift rules are YAML
files in `.ralph/gc-patterns/`. They support optional `autofix.replace` entries so
`ralph gc --fix` can resolve pattern items automatically. This keeps extension
accessible to teams without TypeScript skills.

**Exclusions over suppression comments.** Files that are legitimately never imported
(config files, vitest setup) are excluded via `.ralph/config.yml` rather than inline
suppression comments. Exclusions are visible and auditable in one place; suppression
comments scatter justifications across the codebase.

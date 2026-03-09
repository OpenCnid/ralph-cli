# Architecture — ralph-cli

## Overview

ralph-cli is a CLI tool that scaffolds and maintains agent-optimized repositories. It has 10 commands, each self-contained in its own directory under `src/commands/`.

## Directory Map

```
src/
├── cli.ts              — Entry point, commander router
├── config/             — Config system (schema, loader, validator, defaults)
│   ├── schema.ts       — TypeScript types for .ralph/config.yml
│   ├── loader.ts       — Find, parse, and merge config (walks up directories)
│   ├── validate.ts     — Config validation with typed error reporting
│   └── defaults.ts     — Default config values
├── utils/              — Shared utilities
│   ├── fs.ts           — ensureDir, safeReadFile, safeWriteFile
│   ├── output.ts       — Colored console output (success, warn, error, info, heading)
│   └── prompt.ts       — TTY prompts with non-interactive fallback
└── commands/
    ├── init/           — Repo scaffolding (detect existing, fill gaps)
    ├── lint/           — Architectural enforcement
    │   ├── engine.ts   — Rule framework (built-in + custom YAML/JS)
    │   ├── imports.ts  — Import statement parser
    │   ├── files.ts    — File collector for lint targets
    │   └── rules/      — Built-in lint rules (5 rules)
    ├── grade/          — Quality grading (5 dimensions, per-domain, trends)
    ├── gc/             — Drift detection (4 categories, dedup, trends)
    ├── doctor/         — Repo diagnostics (structure/content/backpressure/ops)
    ├── plan/           — Execution plan management
    ├── promote/        — Taste escalation (doc → lint → pattern)
    ├── ref/            — Reference management (external docs)
    ├── hooks/          — Git hooks (pre-commit on staged files)
    ├── ci/             — CI config generation (GitHub Actions, GitLab CI)
    ├── run/            — Autonomous build loop
    │   ├── index.ts    — Loop orchestration (runCommand entry point)
    │   ├── agent.ts    — Agent spawn, timeout, resolveAgent, presets
    │   ├── prompts.ts  — Template engine (plan/build built-in + custom)
    │   ├── detect.ts   — Auto-detect test/typecheck/task completion
    │   ├── progress.ts — Checkpoint I/O, banners, iteration display
    │   └── types.ts    — RunMode, RunOptions, AgentResult types
    └── config-validate.ts — Standalone config validation command
```

## Layers

Dependencies flow top-to-bottom only. Each layer may import from layers above it.

1. **config** — `src/config/` — Schema types, defaults, loader, validator. No imports from commands or utils.
2. **utils** — `src/utils/` — File system helpers, colored output, prompts. Imports from config (for types). Never imports from commands.
3. **commands** — `src/commands/*/` — Each command is self-contained. Imports from config and utils. Never imports from other commands (with documented exceptions below).
4. **cli** — `src/cli.ts` — Entry point. Imports and registers all commands.

## Domains

| Domain | Path | Responsibility |
|--------|------|----------------|
| config | `src/config` | Config schema, loading, validation, defaults |
| init | `src/commands/init` | Repo scaffolding and gap detection |
| lint | `src/commands/lint` | Architectural rule enforcement and autofix |
| grade | `src/commands/grade` | Quality scoring across 5 dimensions |
| gc | `src/commands/gc` | Drift detection and trend tracking |
| doctor | `src/commands/doctor` | Repo health diagnostics |
| plan | `src/commands/plan` | Execution plan lifecycle |
| promote | `src/commands/promote` | Taste escalation ladder |
| ref | `src/commands/ref` | External reference management |
| hooks | `src/commands/hooks` | Git hook generation |
| ci | `src/commands/ci` | CI pipeline generation |
| run | `src/commands/run` | Autonomous build loop (agent spawn, prompts, progress) |

## Cross-Cutting Concerns

- `src/utils/` — Importable by any layer. Provides file I/O, colored output, and prompts.

## Cross-Command Exceptions

Two intentional cross-command imports exist:

1. **doctor → init** — `doctor --fix` calls init's scaffolding to repair missing structure.
2. **promote → lint engine** — `promote` imports the lint engine to count violations when tracking escalation.

These are documented exceptions, not violations.

## Dependency Rules

- No circular dependencies between domains
- Each layer imports only from layers above it
- Cross-cutting concerns (`src/utils/`) are exempt from layer restrictions
- File size limit: 500 lines per file
- All output goes through `src/utils/output.ts` (no raw `console.log` in commands)

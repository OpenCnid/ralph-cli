# Architecture — ralph-cli

## Overview

ralph-cli is a CLI tool that scaffolds and maintains agent-optimized repositories. It has 14 commands, each self-contained in its own directory under `src/commands/`.

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
    │   ├── index.ts        — gcCommand entry point, temporal view wiring
    │   ├── scanners.ts     — Pattern scanners and collectPatternData
    │   ├── history.ts      — GC trend history I/O
    │   ├── fingerprint.ts      — Snapshot computation, divergence detection, pattern history I/O, temporal view
    │   └── fingerprint.test.ts — Unit tests for all fingerprint functions
    ├── doctor/         — Repo diagnostics (structure/content/backpressure/ops)
    ├── plan/           — Execution plan management
    ├── promote/        — Taste escalation (doc → lint → pattern)
    ├── ref/            — Reference management (external docs)
    ├── hooks/          — Git hooks (pre-commit on staged files)
    ├── ci/             — CI config generation (GitHub Actions, GitLab CI)
    ├── run/            — Autonomous build loop
    │   ├── index.ts        — Loop orchestration (runCommand entry point)
    │   ├── agent.ts        — Agent spawn, timeout, resolveAgent, presets
    │   ├── prompts.ts      — Template engine (plan/build/adversarial built-in + custom)
    │   ├── detect.ts       — Auto-detect test/typecheck/task completion
    │   ├── progress.ts     — Checkpoint I/O, banners, iteration display
    │   ├── types.ts        — RunMode, RunOptions, AgentResult, AdversarialResult types
    │   ├── adversarial.ts  — Adversarial test-generation pass (file restriction, deletion guard, diagnostic branch)
    │   └── adversarial.test.ts — Unit tests for adversarial pass orchestration
    ├── review/         — Agent-powered code review
    │   ├── index.ts    — reviewCommand entry point
    │   ├── context.ts  — Diff extraction and context assembly
    │   ├── prompts.ts  — Review prompt template engine
    │   └── types.ts    — ReviewOptions, ReviewContext types
    ├── heal/           — Automated self-repair
    │   ├── index.ts    — healCommand entry point
    │   ├── diagnostics.ts — Diagnostic execution and issue parsing
    │   ├── prompts.ts  — Heal prompt template engine
    │   └── types.ts    — HealOptions, DiagnosticResult, HealContext types
    ├── score/          — Fitness scoring (run loop + standalone CLI)
    │   ├── index.ts    — scoreCommand entry point, history/trend/compare
    │   ├── scorer.ts   — Score script discovery and execution
    │   ├── default-scorer.ts — Built-in test+coverage scorer
    │   ├── results.ts  — TSV results log (append + read)
    │   ├── trend.ts    — Trend computation and sparkline rendering
    │   ├── types.ts    — ScoreResult, ResultEntry, ScoreContext
    │   ├── calibration.ts  — Calibration metrics, trust drift detection, report formatting
    │   └── calibration.test.ts — Unit tests for calibration module
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
| review | `src/commands/review` | Agent-powered code review (diff extraction, context assembly, prompt) |
| heal | `src/commands/heal` | Automated self-repair (diagnostics, prompt, agent-driven fixes) |
| score | `src/commands/score` | Fitness scoring (script execution, default scorer, results log, trend) |

## Cross-Cutting Concerns

- `src/utils/` — Importable by any layer. Provides file I/O, colored output, and prompts.

## Cross-Command Exceptions

Six intentional cross-command imports exist:

1. **doctor → init** — `doctor --fix` calls init's scaffolding to repair missing structure.
2. **promote → lint engine** — `promote` imports the lint engine to count violations when tracking escalation.
3. **review → run/agent** — `review/index.ts` reuses `resolveAgent` and `spawnAgent` from `run/agent.ts` to avoid duplicating agent resolution logic.
4. **heal → run/agent + run/detect** — `heal/index.ts` reuses agent resolution/spawn and validation command detection from the `run` domain.
5. **run → score** — `run/index.ts` imports `discoverScorer`, `runScorer`, `runDefaultScorer`, `appendResult`, and `buildScoreContext` from the `score` domain to integrate fitness scoring into the build loop. `run/progress.ts` additionally imports `computeCalibration`, `detectTrustDrift`, and `CalibrationThresholds` from `score/calibration.ts` and `readResults` from `score/results.ts` to display calibration summaries in the final run summary.
6. **run → gc/fingerprint** — `run/index.ts` imports `computeAndRecordDivergence` from `gc/fingerprint.ts` to record pattern snapshots and detect approach divergence after each passing build iteration. `run/scoring.ts` imports the `DivergenceItem` type from `gc/fingerprint.ts` to format divergence context for the next iteration's prompt.

Intra-domain import patterns in the `run` domain:
- `adversarial.ts` imports `spawnAgentWithTimeout` from `run/timeout.ts` (agent execution with deadline)
- `adversarial.ts` imports `revertToBaseline` from `run/git.ts` (baseline restoration on adversarial failure)

These are documented exceptions, not violations.

## Dependency Rules

- No circular dependencies between domains
- Each layer imports only from layers above it
- Cross-cutting concerns (`src/utils/`) are exempt from layer restrictions
- File size limit: 500 lines per file
- All output goes through `src/utils/output.ts` (no raw `console.log` in commands)

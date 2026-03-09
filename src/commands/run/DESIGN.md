# Run — Design

## Purpose

`ralph run` spawns a configurable coding agent in a loop, generating prompts
per iteration, committing changes, and halting when the task is complete or a
limit is reached. Supports plan mode (produce IMPLEMENTATION_PLAN.md) and build
mode (implement tasks one by one).

## Usage

```bash
# Build mode (default) — implement next unchecked task
ralph run

# Plan mode — produce or refresh IMPLEMENTATION_PLAN.md
ralph run plan

# Dry run — print prompt without spawning agent
ralph run --dry-run

# Resume a previous session
ralph run --resume

# Options
ralph run --max 5 --agent claude --model claude-opus-4-6 --no-commit --verbose
```

## Config

```yaml
run:
  agent:
    cli: claude          # Agent CLI binary name
    args: [--print]      # Extra arguments passed to the agent
    timeout: 600000      # Per-iteration timeout in ms (default 10 min)
  plan-agent: null       # Override agent for plan mode only
  build-agent: null      # Override agent for build mode only
  loop:
    max-iterations: 20   # Stop after N iterations (0 = unlimited)
    stall-threshold: 3   # Halt after N no-change iterations
  git:
    commit-prefix: "ralph:"
    auto-commit: true
    auto-push: false
  prompts:
    plan: null           # Custom plan prompt file path (null = built-in)
    build: null          # Custom build prompt file path (null = built-in)
  validation:
    test-command: null   # Override auto-detected test command
    typecheck-command: null
```

## Architecture

```
src/commands/run/
  index.ts      — runCommand(): orchestrates the full loop
  agent.ts      — spawnAgent(), resolveAgent(), AGENT_PRESETS
  detect.ts     — detectTestCommand(), detectTypecheckCommand(), detectCompletedTask()
  progress.ts   — Checkpoint I/O, printBanner/Summary functions
  prompts.ts    — generatePrompt(), PLAN_TEMPLATE, BUILD_TEMPLATE
  types.ts      — RunMode, RunOptions, AgentResult
```

Layer: **commands**. Imports from `config/` and `utils/`. No cross-domain imports.

## Design Decisions

**Agent abstraction.** The agent is referenced by CLI name only. No provider
names appear in code. This allows swapping agents without code changes.

**Checkpoint persistence.** `.ralph/run-checkpoint.json` survives crashes and
allows `--resume`. The loop always starts from a known state.

**Auto-detection before config override.** Test/typecheck commands are detected
from project files (package.json, go.mod, etc.) and can be overridden in config.
This works out of the box for standard project layouts.

**Plan-mode completion via diff.** The loop detects plan completion by comparing
IMPLEMENTATION_PLAN.md before and after each iteration — if the file stops
changing, the plan phase is done. No agent protocol required.

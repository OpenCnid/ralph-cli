# Run Domain

## Purpose

`ralph run` is an autonomous build loop that spawns a coding agent repeatedly,
feeds it a context-rich prompt each iteration, commits any changes, and halts
when the task is complete or a stop condition is met. It bridges ralph's quality
tooling with any agent CLI.

## Usage

```bash
# Build mode — implement the next unchecked task
ralph run

# Plan mode — generate or refresh IMPLEMENTATION_PLAN.md
ralph run plan

# Dry run — print the prompt without spawning anything
ralph run --dry-run

# Resume a previous interrupted session
ralph run --resume

# All options
ralph run [plan|build] [--max N] [--agent <cli>] [--model <model>]
                       [--dry-run] [--no-commit] [--no-push]
                       [--resume] [--verbose]
```

## Config

```yaml
run:
  agent:
    cli: claude
    args: [--print]
    timeout: 600000
  loop:
    max-iterations: 20
    stall-threshold: 3
  git:
    commit-prefix: "ralph:"
    auto-commit: true
    auto-push: false
  prompts:
    plan: null    # path to custom plan template
    build: null   # path to custom build template
```

## Architecture

```
src/commands/run/
  index.ts      — Main loop, signal handlers, git operations
  agent.ts      — Process spawning, timeout, 4-tier agent resolution
  detect.ts     — Auto-detect test/typecheck commands, completed tasks
  progress.ts   — Checkpoint persistence, banner/summary output
  prompts.ts    — Template substitution, built-in plan/build templates
  types.ts      — RunMode, RunOptions, AgentResult
```

Imports: `config/loader`, `utils/output`. No imports from other command domains.

## Design Decisions

**LLM-agnostic by design.** Agent is referenced by CLI name only. No AI provider
names appear anywhere in the code or templates. The loop works with any agent
that accepts a prompt on stdin.

**Checkpoint for resilience.** `.ralph/run-checkpoint.json` is written after
each iteration. `--resume` reads it to continue where the loop stopped. Version
field guards against format changes.

**Auto-detection reduces config.** Test and typecheck commands are detected from
project files automatically. Config overrides exist but are rarely needed.

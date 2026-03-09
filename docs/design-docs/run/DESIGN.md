# Run — Detailed Design

## Purpose

`ralph run` orchestrates a coding agent in a feedback loop: generate prompt →
spawn agent → detect completed task → commit → repeat. Two modes: **plan**
(produce IMPLEMENTATION_PLAN.md) and **build** (implement tasks one by one).

## Usage

```bash
ralph run               # build mode, default config
ralph run plan          # plan mode
ralph run --dry-run     # print prompt, do not spawn agent
ralph run --resume      # continue from checkpoint
```

## Config

All `run.*` fields in `.ralph/config.yml`. Key sub-objects:

- `run.agent` — CLI name, extra args, timeout
- `run.plan-agent` / `run.build-agent` — phase-specific agent overrides
- `run.loop` — max-iterations, stall-threshold
- `run.git` — commit-prefix, auto-commit, auto-push
- `run.prompts` — custom template file paths (null = built-in)
- `run.validation` — test/typecheck command overrides

## Architecture

### Files

| File | Responsibility |
|------|----------------|
| `index.ts` | `runCommand()` — full loop, git ops, signal handling |
| `agent.ts` | `spawnAgent()`, `resolveAgent()`, `AGENT_PRESETS` |
| `detect.ts` | `detectTestCommand()`, `detectTypecheckCommand()`, `detectCompletedTask()` |
| `progress.ts` | `loadCheckpoint()`, `saveCheckpoint()`, print functions |
| `prompts.ts` | `generatePrompt()`, `PLAN_TEMPLATE`, `BUILD_TEMPLATE` |
| `types.ts` | `RunMode`, `RunOptions`, `AgentResult` |

### Loop flow

```
runCommand(mode, options)
  ├─ loadConfig() → validate → merge defaults
  ├─ resolveAgent() — 4-tier: CLI flag > phase > default > preset
  ├─ loadCheckpoint() — resume or start fresh
  ├─ pre-flight checks (specs dir, plan file, dirty tree)
  └─ while iterations < max:
       ├─ generatePrompt(mode, config)
       ├─ spawnAgent(agentConfig, prompt)  ← stdin pipe, timeout
       ├─ detectCompletedTask(planBefore)  ← diff IMPLEMENTATION_PLAN.md
       ├─ git add -A && git commit         ← if auto-commit + changes
       ├─ saveCheckpoint()
       ├─ stall check (N no-change iterations)
       └─ plan-mode completion check (plan unchanged)
```

### Agent resolution (4-tier)

1. `--agent` CLI flag (highest priority)
2. `run.plan-agent` / `run.build-agent` (phase-specific)
3. `run.agent` (default agent)
4. Preset args for known CLIs (lowest priority)

## Design Decisions

**Stdin-based prompting.** Prompt text is piped to the agent via stdin, not as
a CLI argument. This avoids shell quoting issues for long prompts.

**Stall detection.** If the agent makes no file changes for `stall-threshold`
consecutive iterations, the loop halts automatically (or prompts in TTY). This
prevents infinite loops on stuck agents.

**Plan completion via diff.** Plan mode ends when IMPLEMENTATION_PLAN.md stops
changing between iterations — a reliable signal that the agent has finished
without requiring any special exit protocol.

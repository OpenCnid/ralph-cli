# Heal — Detailed Design

## Purpose

`ralph heal` is the maintenance counterpart to `ralph run` and `ralph review`.
Instead of implementing product tasks or reviewing diffs, it repairs quality
regressions surfaced by ralph itself. The command is optimized for narrow,
repeatable repo cleanup work.

## Usage

```bash
ralph heal
ralph heal --only doctor,gc
ralph heal --skip lint
ralph heal --dry-run
ralph heal --no-commit
```

Typical flow:

1. Run diagnostics and count issues.
2. Print a summary of actionable failures.
3. Generate a heal prompt with the failing command output.
4. Spawn the configured agent.
5. Re-run diagnostics and report whether anything remains.

## Config

Relevant `.ralph/config.yml` keys:

- `heal.agent` — optional agent override; null falls back to `run.agent`
- `heal.commands` — enabled diagnostics in default execution order
- `heal.auto-commit` — whether to create a repair commit automatically
- `heal.commit-prefix` — prefix for the generated commit message

Validation commands are not configured under `heal.*`. They come from the
shared detection logic in `run/detect.ts` so `heal` and `run` validate the repo
the same way.

## Architecture

### Files

| File | Responsibility |
|------|----------------|
| `index.ts` | `healCommand()` orchestration and git integration |
| `diagnostics.ts` | command execution, issue parsing, filter handling |
| `prompts.ts` | `HEAL_TEMPLATE` and `generateHealPrompt()` |
| `types.ts` | option and context types |

### Flow

```
healCommand(options)
  ├─ loadConfig()
  ├─ runDiagnostics() with --only / --skip
  ├─ filter out diagnostics that failed to execute
  ├─ generateHealPrompt()
  ├─ resolveAgent() and spawnAgent()
  ├─ optionally git add/commit
  └─ runDiagnostics() again for verification
```

Shared imports from the `run` domain are documented exceptions in
`ARCHITECTURE.md`, not accidental coupling.

## Design Decisions

**Shared validation pipeline.** `heal` uses `detectTestCommand()`,
`detectTypecheckCommand()`, and `composeValidateCommand()` from `run/detect.ts`.
That avoids drift between build validation and repair validation.

**Auto-commit is conditional.** The command commits only when auto-commit is
enabled, `--no-commit` is absent, the repo is a git worktree, and files changed.
This keeps non-git directories and review workflows safe.

**Diagnostics are prompt material, not a protocol.** The prompt includes raw
per-command sections instead of a structured JSON contract. That keeps the
repair loop aligned with the human-readable CLI output users already rely on.

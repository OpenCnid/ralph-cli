# Heal — Design

## Purpose

`ralph heal` closes the loop between detection and repair. It runs ralph's own
diagnostic commands, turns failing output into a structured prompt, spawns a
coding agent, and verifies the repo again after the fix attempt.

The command is intentionally narrow. It does not debug arbitrary product bugs or
lower quality bars. Its job is to repair issues that ralph can already describe:
doctor failures, grade regressions, drift items, and lint violations.

## Usage

```bash
# Run the full heal pass
ralph heal

# Limit the pass to a subset of diagnostics
ralph heal --only doctor,gc

# Skip a slow diagnostic
ralph heal --skip grade

# Print the generated prompt without spawning an agent
ralph heal --dry-run

# Review changes manually after the agent runs
ralph heal --no-commit
```

## Config

```yaml
heal:
  agent: null                 # null = inherit from run.agent
  commands: [doctor, grade, gc, lint]
  auto-commit: true
  commit-prefix: "ralph: heal"
```

`heal.agent` is optional. When absent, the command reuses the `run` domain's
agent resolution logic and presets. `heal.commands` controls which diagnostics
are eligible before CLI-level `--only` and `--skip` filtering is applied.

## Architecture

```
src/commands/heal/
  index.ts        — Orchestrates diagnostics, prompt generation, agent run, verify
  diagnostics.ts  — Runs doctor/grade/gc/lint and parses issue counts
  prompts.ts      — Builds the heal-specific prompt template
  types.ts        — HealOptions, DiagnosticResult, HealContext
```

Cross-command imports are deliberate:
- `run/agent.ts` provides shared agent resolution and process spawning.
- `run/detect.ts` provides test/typecheck detection and validate-command composition.

## Design Decisions

**Single-pass repair.** v0.4 runs one heal cycle, then verifies. If issues
remain, the command reports them instead of looping forever. That keeps the
behavior predictable and makes failures visible.

**Diagnostics stay dumb.** `diagnostics.ts` only counts issues from text output.
The command does not interpret domain-specific failures beyond lightweight line
parsing. Repair quality depends on the diagnostic output and repo docs.

**Verification is mandatory.** A successful agent exit code is not enough.
`heal` always reruns diagnostics after the agent finishes so the final result is
based on actual repo state, not on what the agent claimed to fix.

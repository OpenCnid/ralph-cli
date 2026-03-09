# Heal Domain

## Purpose

`ralph heal` automates self-repair for repository quality issues. It collects
output from `ralph doctor`, `ralph grade --ci`, `ralph gc`, and `ralph lint`,
builds one prompt from the failing diagnostics, and asks a coding agent to make
the smallest safe changes that restore repo health.

The domain focuses on repo hygiene and structural correctness. It is not a test
debugger or a general-purpose autonomous build loop.

## Usage

```bash
ralph heal
ralph heal --only doctor
ralph heal --skip grade
ralph heal --dry-run
ralph heal --agent codex --model o4-mini --verbose
```

`--only` and `--skip` are comma-separated filters. If the same command appears
in both lists, `--skip` wins. `--dry-run` prints the exact prompt instead of
spawning an agent, which is useful when adjusting repo docs or diagnostics.

## Config

```yaml
heal:
  agent: null
  commands:
    - doctor
    - grade
    - gc
    - lint
  auto-commit: true
  commit-prefix: "ralph: heal"
```

The default command order matches the repo's built-in quality checks. Auto-commit
is enabled by default so scheduled repair runs can land focused cleanup commits.

## Architecture

The domain has four files:

- `index.ts` runs the full command flow: diagnostics, summary, prompt, agent,
  optional commit, then verification.
- `diagnostics.ts` executes commands and converts plain-text output into issue counts.
- `prompts.ts` produces the heal template and the per-command diagnostic sections.
- `types.ts` defines the command options and data passed between modules.

The domain intentionally depends on `run/agent.ts` and `run/detect.ts`. That
keeps agent spawning and validation command composition consistent across
autonomous commands.

## Design Decisions

**Priority is explicit.** The prompt tells the agent to resolve issues in this
order: doctor, lint, gc, grade. Structural and architectural fixes come first
because they often remove downstream scoring noise.

**Command failures are skipped, not fatal.** If one diagnostic cannot execute,
`heal` warns and continues with the remaining diagnostics. A broken tool should
not block unrelated repairs.

**Prompt content is repo-derived.** The command does not ship hidden repair
logic. It forwards the repo's own diagnostics and validation command so the
repair agent is guided by the same rules a human would use.

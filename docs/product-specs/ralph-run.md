# Spec: `ralph run` — Autonomous Build Loop

**Version:** 0.2.0
**Status:** Draft
**Date:** 2026-03-08

---

## Overview

`ralph run` brings the autonomous build loop inside ralph-cli. Today, the loop is an external bash script (`loop.sh`) that hardcodes Claude Code as the execution agent. This spec makes the agent pluggable, the prompts generated, and the entire lifecycle managed by one tool.

**One sentence:** `ralph run` generates prompts, spawns a configurable coding agent one task at a time, commits after each iteration, and loops until done.

### Design Philosophy

**The loop is dumb. The repo is smart.**

The intelligence lives in the **prompts** and the **codebase** — tests, linters, ralph's own commands. The agent validates its own work by running the tools the prompt tells it to run. There is no orchestration layer wrapping the agent. No independent validation. No quality gates outside the agent's own execution.

This follows the Huntley methodology ("Let Ralph Ralph") and the OpenAI harness engineering approach: backpressure is **mechanical** (baked into the repo via tests, linters, and ralph commands in AGENTS.md), not **orchestrated** (an external process re-checking the agent's work).

The agent runs `ralph doctor --ci`, `ralph grade --ci`, and the project's test suite because the **prompt tells it to**. If it skips validation, that's a prompt problem — fix the prompt, not the loop. If it commits broken code, add better tests. If it drifts architecturally, add a lint rule.

**Fix the environment, not the loop.**

---

## Jobs To Be Done

1. **As a developer, I want to run the full Ralph Loop with one command** so I don't need to set up `loop.sh`, prompt files, and agent configs separately.

2. **As a developer using Codex (or any other agent), I want ralph to work with my agent** so I'm not locked into Claude Code.

3. **As a developer, I want to switch between planning and building modes** without swapping prompt files manually.

4. **As a developer, I want visibility into loop progress** (iteration count, duration, commits) without reading raw logs.

---

## Non-Goals

- **Parallel loops.** v0.2 is single-threaded. Parallel domain loops are a future concern.
- **Remote execution.** The agent runs locally. No cloud orchestration.
- **Agent-specific output parsing.** ralph treats agent output as opaque.
- **Replacing IMPLEMENTATION_PLAN.md.** The plan file remains the shared state contract. ralph doesn't maintain it — the agent does.
- **Interactive steering mid-iteration.** Ctrl+C stops the iteration. Steering happens between iterations via config/prompt/plan edits.
- **Post-iteration validation (oracle).** The agent validates its own work. The loop does not independently re-check.
- **Interactive/PTY agent mode.** v0.2 supports print mode only (stdin→stdout). PTY-based agents (e.g., amp) are v0.3 scope.

---

## Architecture

### New Domain

```
src/commands/run/
├── index.ts          — Command entry point, iteration loop, signal handling
├── agent.ts          — Agent abstraction (spawn, pipe prompt, wait) — print mode only
├── prompts.ts        — Prompt template engine (plan + build)
├── detect.ts         — Auto-detection (test commands, typecheck, source paths) + task completion detection
├── progress.ts       — Iteration tracking, checkpoint, display
└── types.ts          — RunConfig types
```

**Layer:** `commands` (same as all other commands)
**Imports from:** `config` (read `.ralph/config.yml`), `utils` (output, fs, prompt)
**Imports from other commands:** None.
**Integration:** `RunConfig` is added to the central `RalphConfig` interface. `loadConfig()` returns it under `config.run`. `config/validator.ts` updated to validate all `run.*` fields. Schema version bump if applicable.

### Config Schema Addition

New top-level section in `.ralph/config.yml`:

```yaml
# Minimal — everything else uses defaults
run:
  agent:
    cli: "claude"
```

```yaml
# Full config with all options
run:
  # Default agent — used when phase-specific agent isn't set
  agent:
    cli: "claude"                    # Agent CLI binary name
    args: ["--print", "--dangerously-skip-permissions", "--model", "sonnet"]
    timeout: 1800                    # Per-iteration timeout in seconds (default: 30 min)

  # Phase-specific agent overrides (optional — falls back to default agent)
  plan-agent: null                   # Agent config for planning iterations
  build-agent: null                  # Agent config for build iterations

  prompts:
    plan: null                       # null = use built-in template. Path = custom.
    build: null                      # null = use built-in template. Path = custom.

  loop:
    max-iterations: 0                # 0 = unlimited
    stall-threshold: 3               # Halt after N consecutive no-change iterations (0 = disabled)

  validation:
    test-command: null               # null = auto-detect. Injected into {test_command}
    typecheck-command: null          # null = auto-detect. Injected into {typecheck_command}

  git:
    auto-commit: true                # Commit after each iteration
    auto-push: false                 # Push after each commit
    commit-prefix: "ralph:"         # Prefix for commit messages
    branch: null                     # null = current branch
```

### Defaults Table

If `run` is absent entirely from config, all defaults apply (equivalent to the `claude` preset).

| Field | Default |
|-------|---------|
| `agent.cli` | `"claude"` |
| `agent.args` | From preset (see Agent Presets) |
| `agent.timeout` | `1800` (30 min) |
| `plan-agent` | `null` (falls back to `agent`) |
| `build-agent` | `null` (falls back to `agent`) |
| `prompts.plan` | `null` (built-in template) |
| `prompts.build` | `null` (built-in template) |
| `loop.max-iterations` | `0` (unlimited) |
| `loop.stall-threshold` | `3` |
| `validation.test-command` | `null` (auto-detect) |
| `validation.typecheck-command` | `null` (auto-detect) |
| `git.auto-commit` | `true` |
| `git.auto-push` | `false` |
| `git.commit-prefix` | `"ralph:"` |
| `git.branch` | `null` (current branch) |

### TypeScript Types

```typescript
export interface AgentConfig {
  cli: string;
  args: string[];
  timeout: number;
}

export interface AgentResult {
  exitCode: number;
  durationMs: number;
  error?: string;  // Set on spawn failure (ENOENT/EACCES/ENOMEM/broken pipe)
}

export interface PromptsConfig {
  plan: string | null;
  build: string | null;
}

export interface LoopConfig {
  'max-iterations': number;
  'stall-threshold': number;
}

export interface ValidationConfig {
  'test-command': string | null;
  'typecheck-command': string | null;
}

export interface GitConfig {
  'auto-commit': boolean;
  'auto-push': boolean;
  'commit-prefix': string;
  branch: string | null;
}

export interface RunConfig {
  agent: AgentConfig;
  'plan-agent': AgentConfig | null;
  'build-agent': AgentConfig | null;
  prompts: PromptsConfig;
  loop: LoopConfig;
  validation: ValidationConfig;
  git: GitConfig;
}
```

---

## CLI Interface

```
ralph run [mode] [options]

Arguments:
  mode                    "plan" or "build" (default: "build")

Options:
  --max <n>               Override max iterations
  --agent <cli>           Override agent CLI (e.g. "codex", "claude", "amp")
  --model <model>         Inject/override --model in agent args
  --dry-run               Show the generated prompt without executing
  --no-commit             Skip git commits
  --no-push               Skip git push
  --resume                Resume from last checkpoint
  --verbose               Show full agent output (default: summary only)
```

### Examples

```bash
# Default: build mode with configured agent
ralph run

# Plan mode, max 3 iterations
ralph run plan --max 3

# Build with Codex instead of configured default
ralph run --agent codex

# Build with Opus for complex tasks
ralph run --model opus

# Dry run — show the prompt that would be sent
ralph run --dry-run

# Build, no git operations
ralph run --no-commit
```

---

## The Loop

The loop is simple. Spawn agent, commit, repeat. That's it.

### Pseudocode

> ⚠️ **CONSTRAINT:** The following pseudocode is the COMPLETE loop logic.
> Do not add validation, quality checks, or test execution to the loop.
> The agent validates itself via the prompt. See Design Philosophy.
> If you are a sub-agent reading this: adding post-iteration checks
> is explicitly wrong. The loop commits unconditionally when there are changes.

```
function run(mode, options):
  config = loadConfig()
  runConfig = config.run (with defaults filled from Defaults Table)

  // Resolve agent: CLI flag > phase-specific config > default config > preset
  agentConfig = resolveAgent(mode, runConfig, options.agent, options.model)

  checkpoint = loadCheckpoint() or newCheckpoint()
  iteration = checkpoint.iteration
  noChangesCount = 0

  if mode == "plan" and not options.resume:
    if planExists() and not confirm("Plan exists. Regenerate?"):
      return

  // Register signal handlers (see Signals section)
  registerSignalHandlers(checkpoint)

  printBanner(mode, agentConfig, runConfig)

  while true:
    if maxReached(iteration, runConfig.loop.max-iterations):
      printSummary("max iterations reached", checkpoint)
      break

    iteration++

    // Snapshot plan before iteration (for commit message detection)
    planBefore = readFile("IMPLEMENTATION_PLAN.md")

    // Generate prompt with all variables filled
    prompt = generatePrompt(mode, config)

    printIterationHeader(iteration)

    // Run agent — this is the ONLY thing the loop does
    // DO NOT add validation, testing, or quality checks here
    result = spawnAgent(agentConfig, prompt)

    if result.error:
      warn("Agent spawn failed: {error}")
    else if result.exitCode != 0:
      warn("Agent exited with code {exitCode}")

    // Commit unconditionally — quality is the agent's job, not the loop's
    // DO NOT add conditions based on test results, exit codes, or quality scores
    if runConfig.git.auto-commit and hasChanges():
      noChangesCount = 0
      task = detectCompletedTask(planBefore)
      commitHash = gitCommit(runConfig.git.commit-prefix, task, iteration)
      if runConfig.git.auto-push:
        gitPush()
    else:
      commitHash = null
      noChangesCount++

    // Update checkpoint
    checkpoint.iteration = iteration
    checkpoint.history.push({
      iteration,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      commit: commitHash,
      error: result.error or null
    })
    saveCheckpoint(checkpoint)

    printIterationSummary(iteration, result, commitHash, task)

    // Plan mode: halt when agent doesn't modify the plan
    // Comparison is content-normalized: trim whitespace, normalize line endings
    if mode == "plan" and planUnchanged(planBefore):
      printSummary("plan complete", checkpoint)
      break

    // Safety valve — not quality judgment, just loop sanity
    stallThreshold = runConfig.loop.stall-threshold
    if stallThreshold > 0 and noChangesCount >= stallThreshold:
      if isTTY():
        warn("{noChangesCount} iterations with no changes. Continue? [y/N]")
        if not confirm(): break
        noChangesCount = 0
      else:
        printSummary("stalled — no changes in {noChangesCount} iterations", checkpoint)
        break
```

### Signals

| Signal | Behavior |
|--------|----------|
| `SIGINT` | Kill agent process, save checkpoint, print summary, exit 0 |
| `SIGTERM` | Same as SIGINT |
| Double `SIGINT` within 2s | Force kill agent, no checkpoint save, exit 1 |

### What the Loop Does

1. Generates a prompt with project-specific variables filled in
2. Spawns the agent with that prompt
3. Waits for the agent to exit
4. Commits whatever the agent changed
5. Repeats

### What the Loop Does NOT Do

- Run tests
- Check quality scores
- Validate the agent's work
- Decide whether to commit based on outcomes
- Revert changes

All of that is the agent's job, driven by the prompt.

The loop has one safety valve: stall detection (consecutive iterations with no file changes). This is not quality judgment — it's a watchdog timer. The loop doesn't judge *what* changed, only whether *anything* changed.

---

## Prompt Engine (`prompts.ts`)

### Built-in Templates

ralph-cli ships with two embedded prompt templates (plan + build) based on the Huntley methodology. Stored as string constants in `prompts.ts`.

### Template Variables

| Variable | Source |
|----------|--------|
| `{project_path}` | Detected project root |
| `{project_name}` | `config.project.name` |
| `{src_path}` | Auto-detected from config or conventional paths |
| `{specs_path}` | `config.paths.specs` |
| `{date}` | Current ISO date |
| `{test_command}` | From config or auto-detected |
| `{typecheck_command}` | From config or auto-detected |
| `{validate_command}` | Composed (see below) |
| `{skip_tasks}` | From checkpoint on `--resume`, otherwise empty |
| `{language}` | `config.project.language` |
| `{framework}` | `config.project.framework` (if set) |

### `{validate_command}` — The Backpressure

This is where validation lives. The prompt tells the agent to run this command. **Composed at runtime** from config and auto-detection:

**Composition logic:**

1. Start with empty command list
2. If `{test_command}` detected/configured → append
3. If `{typecheck_command}` detected/configured → append
4. Always append `ralph doctor --ci` (ralph is installed if you're running `ralph run`)
5. Always append `ralph grade --ci`
6. Join with ` && `

If any component isn't detected, it's omitted from the chain.

The agent sees this in the build prompt as the validation step. The prompt instructs: "Run validation. If it fails, fix the issue before exiting." Backpressure is in the prompt, not the loop.

> **Example output** for a TypeScript project (composed at runtime — do not hardcode):
> ```
> npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci
> ```

### Custom Templates

If `run.prompts.plan` or `run.prompts.build` points to a file path, that file is used instead of the built-in. Same variable substitution applies.

### Delivery

All agents in v0.2 use print mode. The prompt is piped to stdin:

```
echo "${prompt}" | {cli} {args}
```

Interactive/PTY delivery is deferred to v0.3.

---

## Agent Abstraction (`agent.ts`)

### Spawn Contract

```typescript
function spawnAgent(config: AgentConfig, prompt: string): Promise<AgentResult>;
```

`AgentResult` is defined in types.ts (see TypeScript Types above). On spawn failure (ENOENT/EACCES/ENOMEM/broken pipe), return `{ exitCode: 1, durationMs: 0, error: "<message>" }`. Treat as a failed iteration — the loop continues.

### Print Mode

All agents in v0.2 use print mode (stdin→stdout).

Spawned with `child_process.spawn`. Prompt piped to stdin. stdout/stderr streamed if `--verbose`, otherwise suppressed (default display: iteration number, duration, exit code, commit hash). Timeout via `AbortController`.

### Agent Resolution Order

1. **CLI flag** — `--agent codex` overrides everything
2. **Phase-specific config** — `plan-agent` or `build-agent` (based on CLI argument)
3. **Default config** — `agent`
4. **Preset defaults** — filled in based on resolved CLI name

**Rule: config `args` FULLY REPLACES preset `args`. No merge.** If you want preset args, don't set `args` in config. Only unset fields fall back to the preset.

### Agent Resolution — Worked Example

```
Given:
  CLI flags: --agent claude --model opus
  Config plan-agent: null
  Config build-agent: { cli: "codex", args: ["--quiet"], timeout: 2400 }
  Config agent: { cli: "claude", args: ["--print", "--model", "sonnet"] }
  Preset claude: { args: ["--print", "--dangerously-skip-permissions", "--model", "sonnet"] }
  Preset codex: { args: ["--model", "o3", "--approval-mode", "full-auto", "--quiet"] }

For `ralph run plan`:
  1. CLI --agent "claude" → cli = "claude"              (tier 1 wins)
  2. plan-agent is null → skip                          (tier 2 empty)
  3. Config agent has args → use config args             (tier 3, FULL REPLACE of preset)
     → args = ["--print", "--model", "sonnet"]
  4. --model opus → scan args for "--model", replace next value
     → args = ["--print", "--model", "opus"]
  5. Result: { cli: "claude", args: ["--print", "--model", "opus"], timeout: 1800 }

For `ralph run` (build, no --agent flag):
  1. No --agent flag → skip                             (tier 1 empty)
  2. build-agent exists → use it                        (tier 2 wins)
     → { cli: "codex", args: ["--quiet"], timeout: 2400 }
  3. args set in config → FULL REPLACE of codex preset
     → args = ["--quiet"]
  4. --model opus → scan args, no "--model" found → append
     → args = ["--quiet", "--model", "opus"]
  5. Result: { cli: "codex", args: ["--quiet", "--model", "opus"], timeout: 2400 }

For `ralph run` (build, no --agent flag, no build-agent in config):
  1. No --agent flag → skip                             (tier 1 empty)
  2. build-agent is null → skip                         (tier 2 empty)
  3. Config agent → { cli: "claude", args: ["--print", "--model", "sonnet"] }  (tier 3)
  4. No --model flag → no injection
  5. Result: { cli: "claude", args: ["--print", "--model", "sonnet"], timeout: 1800 }
```

### `--model` Injection

Applied after agent resolution, before spawning:

1. Scan `args` array for `"--model"`
2. If found at index `i`: replace `args[i+1]` with new value
3. If found as `"--model=*"`: replace entire element with `"--model={value}"`
4. If not found: append `["--model", value]`
5. If the agent doesn't support `--model`: warn, inject anyway (agent ignores unknown flags)

### Agent Presets

```typescript
const AGENT_PRESETS: Record<string, Partial<AgentConfig>> = {
  claude: {
    args: ['--print', '--dangerously-skip-permissions', '--model', 'sonnet', '--verbose'],
  },
  codex: {
    args: ['--model', 'o3', '--approval-mode', 'full-auto', '--quiet'],
  },
  aider: {
    args: ['--yes', '--message'],
  },
};
```

Unknown CLI names use raw args with no preset defaults.

### Typical Multi-Agent Setup

```yaml
run:
  plan-agent:
    cli: "claude"
    args: ["--print", "--dangerously-skip-permissions", "--model", "opus"]
    timeout: 2400

  build-agent:
    cli: "codex"
    args: ["--model", "o3", "--approval-mode", "full-auto", "--quiet"]
    timeout: 1800
```

Opus thinks, Codex builds. `ralph run plan` → Claude/Opus. `ralph run` → Codex.

---

## Auto-Detection (`detect.ts`)

### Test Command

First match wins:

1. `run.validation.test-command` in config
2. `package.json` → `scripts.test` → `npm test`
3. `Makefile` → target `test` → `make test`
4. `pyproject.toml` → `pytest`
5. `go.mod` → `go test ./...`
6. `Cargo.toml` → `cargo test`
7. Fallback: omit from `{validate_command}`

### Typecheck Command

1. `run.validation.typecheck-command` in config
2. `tsconfig.json` → `npx tsc --noEmit`
3. `mypy.ini` or `pyproject.toml[tool.mypy]` → `mypy .`
4. `go.mod` → `go vet ./...`
5. Fallback: omit from `{validate_command}`

### Source Path

1. Config `architecture.domains` → union of domain paths
2. `src/` → `app/` → `lib/` → `.`

---

## Checkpoint (`progress.ts`)

Lightweight. Just iteration tracking for `--resume` and the final summary.

```json
{
  "version": 1,
  "phase": "build",
  "startedAt": "2026-03-08T22:00:00Z",
  "iteration": 5,
  "history": [
    {
      "iteration": 1,
      "durationMs": 342000,
      "exitCode": 0,
      "commit": "abc1234"
    }
  ]
}
```

Stored at `.ralph/run-checkpoint.json`.

---

## Display

### Output Modes

- **Default (summary):** Each iteration shows: iteration number, duration, exit code, commit hash (if any). Agent stdout/stderr is suppressed.
- **`--verbose`:** Pipe agent stdout/stderr directly to the terminal in real-time.

### Banner

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ralph run v0.2.0
Phase:   build
Agent:   codex (print)
Branch:  feature/auth
Max:     20 iterations
Stall:   3 consecutive no-change
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Iteration

```
──── Iteration 3 ── 4m 23s ─────────────
📋 Task: Implement user auth module
📝 Commit: abc1234
─────────────────────────────────────────
```

### Final

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ralph run complete

Iterations:  8
Duration:    47m 12s
Commits:     8 (abc1234..def5678)
Stopped:     max iterations reached
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Commit Message & Task Detection (`detect.ts`)

The loop snapshots `IMPLEMENTATION_PLAN.md` before each iteration and diffs after.

### `detectCompletedTask(planBefore: string): string | null`

Simple string comparison. **No markdown parsing.**

1. Read current `IMPLEMENTATION_PLAN.md` as `planAfter`
2. Diff `planBefore` vs `planAfter` line-by-line
3. Find the first line where:
   - `[ ]` became `[x]` (case-insensitive), OR
   - Line gained a `✅` prefix or suffix that wasn't there before
4. Strip the checkbox/emoji, trim whitespace → return as task description
5. No match → return `null`

### Commit Message Format

- Task detected: `"ralph: Implement user auth module"`
- No task detected: `"ralph: iteration 3"`
- Plan mode: `"ralph: plan iteration 1"`

---

## Edge Cases

### Agent Not Installed

```
Error: Agent CLI "codex" not found in PATH.
Install it or update run.agent.cli in .ralph/config.yml.
```

Exit 1. No silent fallback.

### No Specs

- **Plan mode:** Error. "No specs found in {path}. Write specs first."
- **Build mode:** Warning. "No specs found. Agent will work from IMPLEMENTATION_PLAN.md only."

### No Plan (Build Mode)

Prompt to run plan mode first. In non-interactive environments (no TTY), skip prompt and continue.

### Agent Timeout

Kill process. Don't commit. Continue to next iteration (fresh context). Log the timeout in checkpoint history.

### Dirty Working Tree

Warn and prompt to continue. In non-interactive environments (no TTY), continue with warning. Skip prompt entirely with `--no-commit`.

### Plan Mode Completion

Halt when agent exits without modifying IMPLEMENTATION_PLAN.md. Comparison is **content-normalized**: trim trailing whitespace, normalize line endings (`\r\n` → `\n`). Compares task/checkbox count rather than raw byte equality to avoid false positives from cosmetic reformatting.

### Nothing to Commit

Agent exited but no files changed. Skip commit, increment stall counter, continue to next iteration.

### `--resume` with Phase Mismatch

If checkpoint `phase` ≠ requested phase (e.g., checkpoint saved during `plan` but user runs `ralph run` with `--resume`):
- **Interactive:** Warn and prompt: "Checkpoint is from a plan run. Resume as plan, or start fresh build? [plan/fresh]"
- **Non-interactive (no TTY):** Error and exit. Use `--resume --force` to override (discards checkpoint, starts fresh).

### Checkpoint Version Mismatch

Unknown or future checkpoint version → delete checkpoint, warn "Incompatible checkpoint format (version {n}), starting fresh.", begin new run.

### Agent Spawn Failure

ENOENT (not installed) is caught before the loop starts. Other spawn errors (EACCES, ENOMEM, broken pipe, unexpected signal) → record in `AgentResult.error`, treat as failed iteration, continue loop.

---

## Test Strategy

### Unit Tests

| Area | Tests |
|------|-------|
| `prompts.ts` | Template variable substitution, `{validate_command}` composition, custom templates, missing variables |
| `agent.ts` | Print mode spawn, timeout, exit codes, spawn failure (ENOENT/EACCES), `--model` injection (scan/replace/append/`=` form) |
| `detect.ts` | Test command detection (TS, Python, Go, Rust, Makefile), typecheck detection, source path detection, `detectCompletedTask` (checkbox transition, ✅ detection, no match, whitespace-only changes) |
| `progress.ts` | Banner formatting, iteration summary, final summary, checkpoint read/write/resume, checkpoint version mismatch |
| `types.ts` | Config defaults, preset full-replace (not merge), agent resolution across all 4 tiers, CLI option overrides |

### Integration Tests

| Scenario | What it Tests |
|----------|---------------|
| Full build cycle (mock agent) | Loop lifecycle, commit per iteration, checkpoint |
| Plan mode completion | Halt when plan unchanged (content-normalized) |
| Agent timeout | Timeout enforcement, recovery, continue to next iteration |
| `--resume` | Iteration continuity from checkpoint |
| `--resume` phase mismatch | Warn when checkpoint phase ≠ requested phase |
| Custom prompts | File-based template + variable substitution |
| Auto-detection | Cross-language command detection |
| Multi-agent resolution | plan-agent vs build-agent vs default vs CLI override (all 4 tiers) |
| `--dry-run` | Prompt displayed, nothing executed |
| No changes / stall | Skip commit, stall counter, halt after threshold |
| Signal handling | SIGINT saves checkpoint and exits cleanly |

### Mock Agent

Mock script that reads stdin, modifies files predictably, exits with configurable code. Supports: normal exit, timeout simulation, no-change exit, spawn failure simulation. No real agent CLIs needed in CI.

---

## Migration from `loop.sh`

| Before (loop.sh) | After (ralph run) |
|------|-------|
| Hardcoded `claude` CLI | Configurable via config + per-phase overrides |
| Hardcoded `--model opus` for everything | Different agents/models per phase |
| Manual prompt file management | Built-in templates with auto-substitution |
| No progress tracking | Checkpoint + summary display |
| 40 lines of bash | `ralph run` — one command |

### What Stays the Same

- One task per iteration
- Fresh context each iteration
- IMPLEMENTATION_PLAN.md as shared state
- AGENTS.md as operational guide
- Specs as requirements source
- Git commit per iteration
- **The loop is dumb, the repo is smart**

---

## Dependencies

**New runtime dependencies:** None. Uses `node:child_process`.
**New dev dependencies:** None.
**Optional:** Agent CLIs installed separately (not bundled).

---

## Config Validation

- `run.agent.cli` — non-empty string
- `run.agent.args` — array of strings (or omitted for preset defaults)
- `run.agent.timeout` — positive integer
- `run.plan-agent` / `run.build-agent` — null or valid AgentConfig
- `run.loop.max-iterations` — non-negative integer
- `run.loop.stall-threshold` — non-negative integer
- `run.git.commit-prefix` — non-empty string
- `run.prompts.plan` / `run.prompts.build` — null or existing file path (validate-time: warning if missing; runtime: error with clear message)

---

## Open Questions

1. **Should `ralph run` detect the plan is complete before starting?** Could save one wasted iteration by checking upfront.

2. **Should agent presets be extensible via config?** Probably v0.3.

3. **Should `{validate_command}` include `ralph gc`?** Currently omitted (too noisy). Could be opt-in.

## Resolved Questions

- **`node-pty` / interactive mode?** → Deferred to v0.3. Print mode covers all current agents.
- **How does `--model` injection work?** → Scan-and-replace in args array. See `--model` Injection section.
- **Preset merge vs replace?** → Full replace. See Agent Resolution — Worked Example.
- **What does `detectCompletedTask()` do?** → Simple line-by-line diff. See Commit Message & Task Detection section.
- **Signal handling?** → SIGINT kills agent, saves checkpoint, exits. See Signals section.
- **Stall detection?** → Safety valve after N consecutive no-change iterations. Not oracle logic.

---

## Acceptance Criteria

1. `ralph run` spawns the configured agent in print mode, passes a generated prompt via stdin, waits, and commits
2. `ralph run plan` uses planning template; `ralph run` uses build template
3. Mock agent exercises print mode. Manual verification checklist for 3+ real agents (Claude Code, Codex, aider) in TESTING.md
4. `plan-agent` and `build-agent` allow different agents per phase
5. Built-in templates produce equivalent output to current `PROMPT_plan.md` / `PROMPT_build.md`
6. `{validate_command}` composes test + typecheck + `ralph doctor --ci` + `ralph grade --ci` (runtime composition, not hardcoded)
7. Custom templates load from file paths with variable substitution
8. The loop does NOT validate independently — the agent validates itself via the prompt
9. Checkpoint file persists between runs and supports `--resume` (including phase mismatch handling)
10. `ralph run --dry-run` shows the generated prompt without executing
11. `ralph run --agent codex` overrides the configured agent; `--model opus` injects/overrides model in args
12. Auto-detection works for TypeScript, Python, Go, and Rust projects
13. `ralph config validate` validates all `run.*` fields
14. All existing tests pass (zero regressions)
15. Test coverage for all unit and integration scenarios listed in Test Strategy. Branch coverage ≥80% for new files
16. Stall detection halts the loop after N consecutive no-change iterations (configurable, default 3)
17. SIGINT saves checkpoint and exits cleanly

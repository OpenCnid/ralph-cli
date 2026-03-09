# Review — Detailed Design

## Purpose

`ralph review` is an agent-powered code review command. It resolves a diff
scope, extracts the diff from git, assembles project context, builds a
structured prompt, and delegates review to a configurable agent CLI. Designed
to catch architectural drift, spec violations, logic errors, and missing tests.

## Usage

```bash
ralph review                    # staged changes, default config
ralph review HEAD               # last commit
ralph review abc..def           # explicit range
ralph review --dry-run          # print prompt only
ralph review --diff-only        # skip architecture/spec context
ralph review --format json      # structured output for CI
```

## Config

All `review.*` fields in `.ralph/config.yml`:

- `review.agent` — agent override (null = inherit `run.agent`)
- `review.scope` — default scope: staged / working / commit / range
- `review.context` — include-specs, include-architecture, diff-context lines, max-diff-lines
- `review.output` — format (text/markdown/json), file path, severity-threshold

## Architecture

### Files

| File | Responsibility |
|------|----------------|
| `index.ts` | `reviewCommand()` — full orchestration: config → scope → diff → context → prompt → agent → format |
| `context.ts` | `resolveScope()`, `extractDiff()`, `findRelevantSpecs()`, `assembleContext()` |
| `prompts.ts` | `generateReviewPrompt()`, `REVIEW_TEMPLATE` |
| `types.ts` | `ReviewOptions`, `ReviewContext` |

### Request flow

```
reviewCommand(target, options)
  ├─ loadConfig()
  ├─ resolveScope(target, scopeFlag, configScope)  → gitArgs + scopeLabel
  ├─ extractDiff(gitArgs, contextLines)            → diff + stat + changedFiles
  ├─ assembleContext(config, diff, ...)            → ReviewContext
  │    ├─ load ARCHITECTURE.md
  │    ├─ findRelevantSpecs(changedFiles, specsDir)
  │    └─ extract rules from AGENTS.md
  ├─ generateReviewPrompt(context, { diffOnly })   → prompt string
  ├─ [--dry-run] print prompt, exit
  ├─ resolveReviewAgent(config, cliAgent, cliModel) → AgentConfig
  ├─ spawnAgent(agentConfig, prompt, { capture })  → AgentResult
  └─ format output (text/markdown/json) → stdout or file
```

### Scope resolution

| Target / Scope flag | Result |
|---------------------|--------|
| `abc..def` (target) | `git diff abc..def` |
| `HEAD` or SHA | `git diff SHA~1..SHA` |
| `--scope staged` | `git diff --cached` |
| `--scope working` | `git diff` |
| `--scope commit` | `git diff HEAD~1..HEAD` |
| `--scope range` (no target) | Error |

### Spec matching

Changed file paths → domain names → fuzzy match against spec filenames.
Up to 3 specs included. Exact name match scores 3; substring match scores 1.

## Design Decisions

**Agent inherited from `run`.** `review.agent` defaults to null, which falls
back to `run.agent`. Teams with `run` already configured get review working
immediately. Override only when a different agent is preferred for review.

**Capture mode for agent output.** Unlike `run` (which streams agent output),
`review` captures the agent's stdout for formatting. `--verbose` still streams
to stderr for debugging.

**Diff truncation with warning.** Large diffs are truncated at `max-diff-lines`
and a warning is emitted. The review may be incomplete but will not crash or
produce an oversized prompt.

**`--diff-only` for speed.** Omitting architecture and spec context reduces
prompt size and latency for quick sanity checks where full context is not needed.

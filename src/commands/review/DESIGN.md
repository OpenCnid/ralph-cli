# Review — Design

## Purpose

`ralph review` feeds code changes to a configurable coding agent for semantic
review — architectural drift, logic errors, spec violations, and missing tests.
It extracts a diff, assembles context from ARCHITECTURE.md and relevant specs,
and pipes a structured prompt to the agent.

## Usage

```bash
# Review staged changes (default)
ralph review

# Review a specific commit
ralph review HEAD
ralph review abc1234

# Review a range
ralph review abc..def

# Dry run — print prompt without spawning agent
ralph review --dry-run

# Options
ralph review --scope working --format markdown --output review.md
ralph review HEAD --agent claude --model claude-opus-4-6 --diff-only
```

## Config

```yaml
review:
  agent: null              # Override agent (null = inherit from run.agent)
  scope: staged            # Default scope: staged/working/commit/range
  context:
    include-specs: true    # Auto-include relevant spec files
    include-architecture: true  # Include ARCHITECTURE.md
    include-diff-context: 5     # Context lines in diff (--unified=N)
    max-diff-lines: 2000        # Truncate diff at this many lines
  output:
    format: text           # text / markdown / json
    file: null             # Write output to file (null = stdout)
    severity-threshold: info    # Minimum severity to report
```

## Architecture

```
src/commands/review/
  index.ts     — reviewCommand(): orchestrates scope → diff → context → prompt → agent
  context.ts   — resolveScope(), extractDiff(), findRelevantSpecs(), assembleContext()
  prompts.ts   — generateReviewPrompt(), REVIEW_TEMPLATE
  types.ts     — ReviewOptions, ReviewContext
```

**Cross-domain import:** `index.ts` imports `spawnAgent`, `injectModel`, and
`AGENT_PRESETS` from `../run/agent.ts`. This is a documented exception — the
agent abstraction is shared between `run` and `review`.

Layer: **commands**. Imports from `config/`, `utils/`, and `run/agent.ts`.

## Design Decisions

**Agent reuse from `run`.** Rather than duplicating process-spawning logic,
`review` imports the agent abstraction from `run/agent.ts`. The agent resolution
falls back to `run.agent` when `review.agent` is null.

**Context assembly is opt-out.** Architecture and specs are included by default.
`--diff-only` excludes them for fast reviews when context is not needed.

**Scope as first-class concept.** Six scope modes (staged, working, commit, SHA,
range) are resolved uniformly to git args. The scope label is included in all
output formats.

**Output formats for automation.** Text (pass-through), markdown (adds header),
and JSON (structured) allow review output to feed into CI pipelines or PRs.

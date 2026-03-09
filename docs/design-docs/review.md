# Review Domain

## Purpose

`ralph review` performs agent-powered code review. It extracts a diff from git,
assembles project context (architecture, specs, rules), generates a structured
prompt, and feeds it to a configurable agent CLI. Output can be text, markdown,
or JSON — written to stdout or a file.

## Usage

```bash
# Review staged changes (default)
ralph review

# Review a specific commit
ralph review HEAD
ralph review <sha>

# Review a commit range
ralph review main..feature-branch

# Dry run — show the prompt that would be sent to the agent
ralph review --dry-run

# All options
ralph review [target] [--scope staged|working|commit|range]
             [--agent <cli>] [--model <model>]
             [--format text|markdown|json] [--output <path>]
             [--dry-run] [--verbose] [--diff-only]
```

## Config

```yaml
review:
  agent: null                      # null = inherit run.agent
  scope: staged                    # default scope when no target given
  context:
    include-specs: true
    include-architecture: true
    include-diff-context: 5        # --unified=N passed to git diff
    max-diff-lines: 2000
  output:
    format: text                   # text | markdown | json
    file: null                     # write to file instead of stdout
    severity-threshold: info
```

## Architecture

```
src/commands/review/
  index.ts     — reviewCommand(): load config → scope → diff → context → prompt → agent → format → output
  context.ts   — resolveScope(), extractDiff(), findRelevantSpecs(), assembleContext()
  prompts.ts   — generateReviewPrompt(), REVIEW_TEMPLATE (6-section template)
  types.ts     — ReviewOptions, ReviewContext
```

Agent spawning is handled by `src/commands/run/agent.ts` (shared module).
Agent resolution: CLI flag > `review.agent` > `run.agent` > preset.

## Design Decisions

**Shared agent abstraction.** `review` reuses `spawnAgent` and `resolveAgent`
logic from the `run` domain. This avoids duplicating process lifecycle and
timeout handling, and keeps agent configuration consistent.

**Context-first prompting.** By default, ARCHITECTURE.md and relevant spec
files are included in the prompt so the agent can catch architectural and spec
violations — not just syntactic issues.

**Fuzzy spec matching.** Changed file paths are decomposed into domain names
and matched against spec filenames. Up to 3 relevant specs are included,
keeping prompt size bounded.

**Multiple output formats.** Text is the default (agent output verbatim).
Markdown adds a review header for PR comments. JSON enables CI pipeline
integration and programmatic processing.

# Spec: `ralph review` — Agent-Powered Code Review

**Version:** 0.3.0
**Status:** Draft
**Date:** 2026-03-09

---

## Overview

`ralph review` feeds code changes to a configurable coding agent for semantic review. It fills the gap between mechanical checks (`ralph lint`, `ralph grade`, `ralph gc`) and human review — catching architectural drift, logic errors, spec violations, and quality issues that linters can't see.

**One sentence:** `ralph review` sends a diff + project context to a coding agent and returns structured feedback (approve, request changes, or flag concerns).

### Design Philosophy

Same as `ralph run`: **the loop is dumb, the repo is smart.**

The review command generates a prompt containing the diff, relevant architecture docs, and the spec. The agent does the thinking. ralph doesn't parse or validate the agent's review — it presents the output. Quality comes from the prompt and the project's documentation, not from ralph's orchestration.

---

## Jobs To Be Done

1. **As a developer using `ralph run`, I want automated review of each iteration's changes** so I catch issues without manually reading every commit.

2. **As a developer, I want to review a PR or commit range against my project's architecture and specs** so I get feedback grounded in my project's actual rules, not generic advice.

3. **As a team running agent-to-agent workflows, I want review output in a structured format** so it can be consumed by other tools (CI, PR comments, the next iteration's prompt).

---

## Non-Goals

- **Replacing human review entirely.** This is a first pass, not a final judgment.
- **Auto-fixing issues found in review.** That's `ralph heal` territory. Review reports; fix is a separate step.
- **Interactive review sessions.** v0.3 is one-shot: send diff, get feedback. Interactive (multi-turn review conversation) is v0.4.
- **PR platform integration.** No GitHub/GitLab API calls in v0.3. Output goes to stdout/file. CI integration and PR comment posting is future scope.

---

## Architecture

### New Domain

```
src/commands/review/
├── index.ts          — Command entry point
├── context.ts        — Diff extraction, file gathering, context assembly
├── prompts.ts        — Review prompt template
└── types.ts          — ReviewConfig types
```

**Layer:** `commands` (same as all other commands)
**Imports from:** `config` (read config), `utils` (output, fs), `commands/run/agent` (agent spawning + resolution — reuse, don't duplicate)
**Imports from other commands:** `run/agent.ts` (spawnAgent, resolveAgent, AGENT_PRESETS)

### Config Schema Addition

New top-level section in `.ralph/config.yml`:

```yaml
# Minimal — uses defaults
review:
  agent: null          # null = use run.agent. Separate agent config if desired.

# Full config
review:
  agent:
    cli: "claude"
    args: ["--print", "--dangerously-skip-permissions", "--model", "opus"]
    timeout: 600      # 10 min default (reviews are faster than builds)
  
  scope: "staged"     # What to review: "staged", "commit", "range", "working"
  context:
    include-specs: true       # Include relevant specs in prompt
    include-architecture: true # Include ARCHITECTURE.md in prompt
    include-diff-context: 5   # Lines of context around changes
    max-diff-lines: 2000      # Truncate diffs beyond this (with warning)
  
  output:
    format: "text"       # "text", "json", "markdown"
    file: null           # null = stdout. Path = write to file.
    severity-threshold: "info"  # "info", "warn", "error" — filter output
```

### Defaults Table

| Field | Default |
|-------|---------|
| `review.agent` | `null` (falls back to `run.agent`, then preset) |
| `review.scope` | `"staged"` |
| `review.context.include-specs` | `true` |
| `review.context.include-architecture` | `true` |
| `review.context.include-diff-context` | `5` |
| `review.context.max-diff-lines` | `2000` |
| `review.output.format` | `"text"` |
| `review.output.file` | `null` (stdout) |
| `review.output.severity-threshold` | `"info"` |

### TypeScript Types

```typescript
export interface ReviewContextConfig {
  'include-specs': boolean;
  'include-architecture': boolean;
  'include-diff-context': number;
  'max-diff-lines': number;
}

export interface ReviewOutputConfig {
  format: 'text' | 'json' | 'markdown';
  file: string | null;
  'severity-threshold': 'info' | 'warn' | 'error';
}

export interface ReviewConfig {
  agent: AgentConfig | null;
  scope: 'staged' | 'commit' | 'range' | 'working';
  context: ReviewContextConfig;
  output: ReviewOutputConfig;
}
```

---

## CLI Interface

```
ralph review [target] [options]

Arguments:
  target                  What to review (default: staged changes)
                          Accepts: "staged", "working", a commit SHA, or a range "abc..def"

Options:
  --scope <scope>         Override scope: "staged", "commit", "range", "working"
  --agent <cli>           Override agent CLI
  --model <model>         Override model
  --format <fmt>          Output format: "text", "json", "markdown" (default: "text")
  --output <path>         Write review to file instead of stdout
  --dry-run               Show the prompt that would be sent without executing
  --verbose               Show full agent output
  --diff-only             Include only the diff in the prompt (skip specs/architecture)
```

### Examples

```bash
# Review staged changes (default)
ralph review

# Review the last commit
ralph review HEAD

# Review a commit range
ralph review abc123..def456

# Review working tree changes (unstaged)
ralph review --scope working

# Review with Opus for thorough analysis
ralph review --model opus

# Output as JSON for CI consumption
ralph review HEAD --format json --output review.json

# Dry run — see what the prompt looks like
ralph review --dry-run

# Quick review — just the diff, no project context
ralph review --diff-only
```

---

## Diff Extraction (`context.ts`)

### Scope Resolution

The `target` argument and `--scope` flag determine what diff to extract:

| Input | Git Command |
|-------|-------------|
| (no target, scope=staged) | `git diff --cached` |
| (no target, scope=working) | `git diff` |
| `HEAD` or a single SHA | `git diff {sha}~1..{sha}` |
| `abc..def` | `git diff abc..def` |
| `--scope commit` (no target) | `git diff HEAD~1..HEAD` |
| `--scope range` (no target) | Error: "Specify a range like abc..def" |

### Context Assembly

The review prompt includes (in order):

1. **Project context** (if not `--diff-only`):
   - `ARCHITECTURE.md` content (if `include-architecture` is true)
   - Relevant spec files from `config.paths.specs` (if `include-specs` is true) — files whose names match changed directories/domains
   - `AGENTS.md` critical rules section (if present)

2. **The diff** itself:
   - Generated via `git diff` with `--unified={include-diff-context}` lines of context
   - If diff exceeds `max-diff-lines`, truncate and warn: "Diff truncated at {n} lines. Review may be incomplete."
   - Include list of changed files with stats (`git diff --stat`)

3. **Review instructions** (from the prompt template)

### Relevant Spec Detection

Simple heuristic — no deep analysis:

1. Get list of changed files from diff
2. Extract directory names (first path component under `src/` or project root)
3. Match against spec filenames in `config.paths.specs` (fuzzy: `auth` matches `auth.md`, `authentication.md`, `user-auth.md`)
4. Include matched specs in context (up to 3 most relevant)

---

## Prompt Template (`prompts.ts`)

```
You are reviewing code changes for {project_name}.

## Project Architecture
{architecture_content}

## Relevant Specifications
{specs_content}

## Project Rules
{rules_content}

## Changes to Review

### Files Changed
{diff_stat}

### Diff
{diff_content}

## Review Instructions

Analyze the changes above and provide a code review. For each issue found:

1. **Severity**: error (must fix), warn (should fix), info (suggestion)
2. **File and line**: Where the issue is
3. **Description**: What's wrong and why
4. **Suggestion**: How to fix it

Focus on:
- Architectural violations (layer rules, domain boundaries, import direction)
- Spec compliance (do the changes match what was specified?)
- Logic errors and edge cases
- Missing tests for new behavior
- Breaking changes to public APIs
- Security concerns

Do NOT flag:
- Style preferences (formatting, naming that passes lint)
- Minor refactoring opportunities unless they affect correctness
- TODOs or incomplete features that are explicitly documented as such

If the changes look correct, say so briefly. Don't manufacture issues.

End with a summary: APPROVE, REQUEST_CHANGES, or CONCERNS (non-blocking observations).
```

### Template Variables

| Variable | Source |
|----------|--------|
| `{project_name}` | `config.project.name` |
| `{architecture_content}` | Contents of ARCHITECTURE.md (or empty) |
| `{specs_content}` | Contents of matched spec files (or empty) |
| `{rules_content}` | Critical rules from AGENTS.md (or empty) |
| `{diff_stat}` | Output of `git diff --stat` |
| `{diff_content}` | The actual diff |

---

## Agent Reuse

`ralph review` reuses the agent abstraction from `ralph run`:

- **Agent resolution:** Same 4-tier pattern. `review.agent` config is checked first. If null, falls back to `run.agent`, then preset.
- **Spawn:** Same `spawnAgent()` function. Prompt piped to stdin, output captured.
- **Presets:** Same `AGENT_PRESETS`. Review may want different defaults (e.g., Opus for deeper analysis), configured via `review.agent`.

Import directly from `../run/agent.js` — this is a documented cross-command exception (like doctor→init).

---

## Output Formats

### Text (default)
Agent output passed through directly to stdout. Human-readable.

### Markdown
Agent output wrapped with a header:
```markdown
# Code Review — {project_name}
**Date:** {date}
**Scope:** {scope_description}
**Files:** {file_count} changed

---

{agent_output}
```

### JSON
```json
{
  "project": "ralph-cli",
  "date": "2026-03-09",
  "scope": "HEAD~1..HEAD",
  "files": ["src/commands/run/index.ts", "src/commands/run/agent.ts"],
  "review": "<agent output as string>",
  "model": "opus",
  "durationMs": 45000
}
```

---

## Integration with `ralph run` (Future)

Not in v0.3.0 scope, but the design anticipates:

```yaml
run:
  review: true  # Run ralph review after each iteration (v0.4)
```

When enabled, after each build iteration:
1. `ralph review HEAD` on the just-committed changes
2. If review says REQUEST_CHANGES, feed the review output into the next iteration's prompt via `{skip_tasks}` or a new `{review_feedback}` variable
3. If APPROVE, continue normally

This creates the build → review → fix cycle without changing the loop's core simplicity.

---

## Edge Cases

### No Changes
"Nothing to review. Stage changes with `git add` or specify a commit."

### Not a Git Repository
"Not a git repository. `ralph review` requires git."

### Agent Not Installed
Same as `ralph run`: "Agent CLI \"x\" not found in PATH."

### Empty Diff
"Diff is empty for the specified range."

### Huge Diff (>2000 lines)
Truncate and warn. Agent may miss context from truncated portions. Suggest reviewing in smaller chunks.

### Binary Files in Diff
Skip binary files, note them: "Skipped N binary file(s)."

---

## Test Strategy

### Unit Tests

| Area | Tests |
|------|-------|
| `context.ts` | Scope resolution (all 6 cases), spec matching (exact, fuzzy, no match), diff truncation, diff stat parsing, binary file skipping |
| `prompts.ts` | Template variable substitution, --diff-only excludes context, all variables present |
| `types.ts` | Type compilation only |

### Integration Tests

| Scenario | What it Tests |
|----------|---------------|
| Review staged changes | Default scope, context assembly, agent receives prompt |
| Review a commit | SHA parsing, `git diff sha~1..sha` |
| Review a range | Range parsing, `git diff abc..def` |
| `--dry-run` | Prompt printed, no agent spawned |
| `--format json` | JSON output structure |
| `--diff-only` | No specs/architecture in prompt |
| No changes to review | Appropriate error message |
| Large diff truncation | Truncation at max-diff-lines, warning emitted |

### Mock Agent
Same pattern as `ralph run` tests — mock `spawnAgent`, verify prompt content and output handling.

---

## Config Validation

- `review.agent` — null or valid AgentConfig
- `review.scope` — one of: "staged", "commit", "range", "working"
- `review.context.include-diff-context` — non-negative integer
- `review.context.max-diff-lines` — positive integer
- `review.output.format` — one of: "text", "json", "markdown"
- `review.output.file` — null or string
- `review.output.severity-threshold` — one of: "info", "warn", "error"

---

## Dependencies

**New runtime dependencies:** None. Uses `node:child_process` (git commands) and reuses `run/agent.ts`.
**New dev dependencies:** None.
**Cross-command import:** `run/agent.ts` (spawnAgent, resolveAgent, AGENT_PRESETS) — documented exception in ARCHITECTURE.md.

---

## Acceptance Criteria

1. `ralph review` sends staged changes + project context to the configured agent and prints the response
2. `ralph review HEAD` reviews the last commit
3. `ralph review abc..def` reviews a commit range
4. `--dry-run` shows the prompt without executing
5. `--format json` outputs structured JSON with review content, metadata
6. `--diff-only` sends only the diff (no specs/architecture)
7. Relevant specs are automatically detected from changed file paths
8. Diff truncation at configurable line limit with warning
9. Agent resolution reuses `run/agent.ts` (no duplication)
10. `ralph config validate` validates all `review.*` fields
11. All existing tests pass (zero regressions)
12. Unit + integration tests for all scenarios listed in Test Strategy
13. ARCHITECTURE.md updated with `review` domain and cross-command exception

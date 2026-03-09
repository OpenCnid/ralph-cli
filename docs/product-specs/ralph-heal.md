# Spec: `ralph heal` — Self-Repair from ralph's Own Output

**Version:** 0.4.0
**Status:** Draft
**Date:** 2026-03-09

---

## Overview

`ralph heal` closes the loop between detection and resolution. Today, `ralph doctor`, `ralph grade`, and `ralph gc` report problems — a human reads the output and decides what to do. `ralph heal` removes the human from that loop: it runs the diagnostic commands, parses their output into actionable tasks, generates a fix prompt, and spawns an agent to resolve everything.

**One sentence:** `ralph heal` runs ralph's own diagnostics, feeds failures to a coding agent, and commits the fixes — automated self-repair.

### Design Philosophy

Same principle: **the loop is dumb, the repo is smart.**

`ralph heal` doesn't understand what a "lint violation" or a "grade failure" means. It runs commands, captures output, and hands it to an agent with instructions to fix everything. The agent uses the diagnostic output + project context to determine what to do. Quality of the fix depends on the quality of ralph's diagnostic messages and the project's documentation.

**Fix the environment, not the heal command.**

---

## Jobs To Be Done

1. **As a developer, I want ralph to fix its own reported issues** so I don't manually interpret doctor/grade/gc output and write fixes myself.

2. **As a team running scheduled maintenance, I want automated repair** so drift and quality regressions are caught and fixed without human intervention.

3. **As a `ralph run` user, I want a post-loop cleanup step** that fixes any remaining issues the build loop didn't catch.

---

## Non-Goals

- **Fixing arbitrary bugs.** `ralph heal` only fixes issues reported by ralph's own commands (doctor, grade, gc, lint). It doesn't debug application logic.
- **Running tests and fixing test failures.** That's the build agent's job. `ralph heal` fixes structural/quality issues, not functional bugs.
- **Multi-iteration healing loops.** v0.4 runs one healing pass. If issues remain after the fix, report them — don't loop. (Looping is v0.5 scope.)
- **Modifying ralph's own config to make issues disappear.** The agent should fix the code/docs, not lower the bar.

---

## Architecture

### New Domain

```
src/commands/heal/
├── index.ts          — Command entry point, orchestration
├── diagnostics.ts    — Run doctor/grade/gc/lint, parse output
├── prompts.ts        — Heal prompt template
└── types.ts          — HealConfig types
```

**Layer:** `commands`
**Imports from:** `config`, `utils`, `commands/run/agent` (reuse spawnAgent/resolveAgent)
**Cross-command imports:** `run/agent.ts` — documented exception (same as review)

### Config Schema Addition

```yaml
# Minimal
heal:
  agent: null         # null = use run.agent

# Full config
heal:
  agent:
    cli: "claude"
    args: ["--print", "--dangerously-skip-permissions", "--model", "sonnet"]
    timeout: 1200     # 20 min default

  commands:           # Which diagnostics to run
    doctor: true
    grade: true
    gc: true
    lint: true

  auto-commit: true   # Commit fixes automatically
  commit-prefix: "ralph-heal:"
```

### Defaults Table

| Field | Default |
|-------|---------|
| `heal.agent` | `null` (falls back to `run.agent`, then preset) |
| `heal.commands.doctor` | `true` |
| `heal.commands.grade` | `true` |
| `heal.commands.gc` | `true` |
| `heal.commands.lint` | `true` |
| `heal.auto-commit` | `true` |
| `heal.commit-prefix` | `"ralph-heal:"` |

### TypeScript Types

```typescript
export interface HealCommandsConfig {
  doctor: boolean;
  grade: boolean;
  gc: boolean;
  lint: boolean;
}

export interface HealConfig {
  agent: AgentConfig | null;
  commands: HealCommandsConfig;
  'auto-commit': boolean;
  'commit-prefix': string;
}
```

---

## CLI Interface

```
ralph heal [options]

Options:
  --agent <cli>           Override agent CLI
  --model <model>         Override model
  --only <cmds>           Only run specific diagnostics (comma-separated: "doctor,gc")
  --skip <cmds>           Skip specific diagnostics (comma-separated: "grade,lint")
  --dry-run               Show diagnostic output and generated prompt without executing
  --no-commit             Skip git commit after fixes
  --verbose               Show full agent output
```

### Examples

```bash
# Run all diagnostics, fix everything
ralph heal

# Only fix doctor and gc issues
ralph heal --only doctor,gc

# Skip grade (slow on large projects)
ralph heal --skip grade

# See what would be fixed without executing
ralph heal --dry-run

# Fix but don't commit (review changes manually)
ralph heal --no-commit

# Use Opus for complex fixes
ralph heal --model opus
```

---

## Diagnostics (`diagnostics.ts`)

### Command Execution

Run each enabled diagnostic command and capture output:

```typescript
interface DiagnosticResult {
  command: string;           // "doctor", "grade", "gc", "lint"
  exitCode: number;
  output: string;            // Full stdout
  issueCount: number;        // Parsed count of issues found
  issues: string[];          // Individual issue descriptions
}
```

### Commands Run

| Command | How to Run | What "issues" means |
|---------|-----------|---------------------|
| `ralph doctor` | `ralph doctor 2>&1` | Score < 10/10 — each failing check is an issue |
| `ralph grade --ci` | `ralph grade --ci 2>&1` | Any domain below minimum grade — each failing domain is an issue |
| `ralph gc` | `ralph gc 2>&1` | Any drift items found — each item is an issue |
| `ralph lint` | `ralph lint 2>&1` | Any violations found — each violation is an issue |

### Output Parsing

Simple line-based parsing — no structured output needed:

- **doctor:** Lines starting with `✗` are failures. Count them.
- **grade:** Lines containing `Overall grade F` or `Overall grade D` (below minimum). Extract domain name and grade.
- **gc:** Lines starting with `⚠` are drift items. Count them.
- **lint:** Lines starting with `✗` or containing `violation` are issues. Count them.

If a command exits 0 with no issues, skip it in the prompt — nothing to fix.

### Aggregation

After running all diagnostics:
- If total issues = 0: "All clear — nothing to heal." Exit 0.
- If total issues > 0: Generate prompt with all diagnostic output and spawn agent.

---

## Prompt Template (`prompts.ts`)

```
You are fixing issues found by ralph's diagnostic tools in {project_name}.

## Project Context
- Project path: {project_path}
- Language: {language}

## Architecture
{architecture_content}

## Issues Found

The following diagnostic commands reported issues that need to be fixed.

{diagnostic_output}

## Fix Instructions

For each issue reported above:

1. Read the diagnostic output carefully — it tells you what's wrong and often suggests a fix
2. Make the minimal change needed to resolve the issue
3. Do NOT lower quality bars or modify ralph config to suppress issues
4. Do NOT refactor unrelated code
5. Run the failing command after your fix to verify it passes

After fixing all issues, run the full validation:
```
{validate_command}
```

If a fix for one issue would conflict with another, prioritize in this order:
1. doctor issues (structural — affects everything else)
2. lint issues (architectural — prevents drift)
3. gc issues (cleanup — cosmetic but compounds)
4. grade issues (scoring — often resolved by fixing the above)

Commit message: "{commit_prefix} fix {issue_count} issue(s) from {command_list}"
```

### Template Variables

| Variable | Source |
|----------|--------|
| `{project_name}` | `config.project.name` |
| `{project_path}` | `process.cwd()` |
| `{language}` | `config.project.language` |
| `{architecture_content}` | Contents of ARCHITECTURE.md |
| `{diagnostic_output}` | Aggregated output from all failing diagnostics |
| `{validate_command}` | Composed from detect.ts (same as ralph run) |
| `{commit_prefix}` | `config.heal.commit-prefix` |
| `{issue_count}` | Total issues found |
| `{command_list}` | Comma-separated list of commands that found issues |

---

## Command Flow (`index.ts`)

```
function heal(options):
  config = loadConfig()

  // 1. Run diagnostics
  printBanner("Scanning for issues...")
  results = runDiagnostics(config, options)

  // 2. Check if anything needs fixing
  totalIssues = sum(results.map(r => r.issueCount))
  if totalIssues == 0:
    success("All clear — nothing to heal.")
    return

  // 3. Show summary
  printDiagnosticSummary(results)

  // 4. Dry run — show prompt and exit
  if options.dryRun:
    prompt = generateHealPrompt(results, config)
    print(prompt)
    return

  // 5. Resolve agent and spawn
  agent = resolveAgent("build", runConfig, options.agent, options.model)
  prompt = generateHealPrompt(results, config)
  printStatus("Spawning agent to fix {totalIssues} issue(s)...")
  result = spawnAgent(agent, prompt, { verbose: options.verbose })

  // 6. Report result
  if result.error:
    warn("Agent failed: {error}")
  else if result.exitCode != 0:
    warn("Agent exited with code {exitCode}")
  else:
    success("Agent completed in {formatDuration(result.durationMs)}")

  // 7. Commit if configured
  if config.heal.auto-commit and not options.noCommit and hasChanges():
    commitHash = gitCommit(config.heal.commit-prefix, totalIssues, results)
    success("Committed: {commitHash}")
    
  // 8. Re-run diagnostics to verify
  printStatus("Verifying fixes...")
  verifyResults = runDiagnostics(config, options)
  remainingIssues = sum(verifyResults.map(r => r.issueCount))
  if remainingIssues == 0:
    success("All issues resolved!")
  else:
    warn("{remainingIssues} issue(s) remain after healing. Manual review needed.")
```

---

## Display

### Banner
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ralph heal v0.4.0
Scanning for issues...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Diagnostic Summary
```
📋 Issues found:
  doctor:  2 failing checks
  grade:   3 domains below minimum
  gc:      0 drift items
  lint:    1 violation
  Total:   6 issues

Spawning agent to fix 6 issue(s)...
```

### Result
```
✅ Agent completed in 3m 12s
📝 Committed: abc1234

Verifying fixes...
✅ All issues resolved!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Edge Cases

### All Diagnostics Pass
"All clear — nothing to heal." Exit 0.

### Agent Fails to Fix Everything
Re-run diagnostics after agent completes. Report remaining issues with count. Don't retry — that's v0.5.

### No Git Repository
Warning but continue — diagnostics can still run, agent can still fix. Skip commit.

### Agent Not Installed
Same as `ralph run`: error and exit.

### Diagnostic Command Not Found
If `ralph doctor` itself fails (shouldn't happen since we're ralph), warn and skip that diagnostic.

### `--only` and `--skip` Overlap
If a command is in both `--only` and `--skip`, skip wins.

---

## Test Strategy

### Unit Tests

| Area | Tests |
|------|-------|
| `diagnostics.ts` | Parse doctor output (passing, failing), parse grade output (all grades), parse gc output (clean, drift), parse lint output (clean, violations), command filtering (--only, --skip) |
| `prompts.ts` | Template variable substitution, diagnostic output formatting, empty diagnostics handling |
| `types.ts` | Type compilation only |

### Integration Tests

| Scenario | What it Tests |
|----------|---------------|
| All diagnostics pass | "All clear" message, no agent spawned |
| Doctor failures only | Only doctor output in prompt, correct issue count |
| Multiple diagnostics fail | All outputs combined, priority ordering |
| `--dry-run` | Prompt printed, no agent spawned |
| `--only doctor,gc` | Only those two commands run |
| `--skip grade` | Grade skipped, others run |
| `--no-commit` | Agent runs but no git commit |
| Agent fixes all issues | Verification pass succeeds |
| Agent fixes some issues | Remaining count reported |

### Mock Pattern
Mock `child_process.execSync` for diagnostic commands (return captured output strings). Mock `spawnAgent` for the fix agent. Same patterns as `ralph run` and `ralph review` tests.

---

## Config Validation

- `heal.agent` — null or valid AgentConfig
- `heal.commands.doctor` — boolean
- `heal.commands.grade` — boolean
- `heal.commands.gc` — boolean
- `heal.commands.lint` — boolean
- `heal.auto-commit` — boolean
- `heal.commit-prefix` — non-empty string

---

## Dependencies

**New runtime dependencies:** None.
**Cross-command imports:** `run/agent.ts` (spawnAgent, resolveAgent), `run/detect.ts` (composeValidateCommand), `run/progress.ts` (formatDuration)

---

## Acceptance Criteria

1. `ralph heal` runs doctor, grade, gc, and lint — reports issue count
2. If issues found, spawns agent with diagnostic output + project context
3. After agent completes, re-runs diagnostics to verify fixes
4. `--dry-run` shows diagnostic output and prompt without executing
5. `--only doctor,gc` runs only those diagnostics
6. `--skip grade` excludes grade from the scan
7. `--no-commit` skips git commit
8. "All clear" when no issues found
9. Reports remaining issues if agent doesn't fix everything
10. Agent resolution reuses `run/agent.ts`
11. `ralph config validate` validates all `heal.*` fields
12. All existing tests pass (zero regressions)
13. Unit + integration tests for all scenarios
14. ARCHITECTURE.md updated with `heal` domain

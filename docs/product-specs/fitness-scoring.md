# Fitness Scoring

`ralph score` measures project quality beyond pass/fail, enabling gradient-based iteration decisions during `ralph run`.

## Problem Statement

Ralph's build loop treats iteration outcomes as binary: the agent either produced changes or it didn't. Tests run inside the agent's sandbox — ralph never validates independently. This creates two blind spots:

1. **Silent degradation.** A codebase can pass all tests while quality erodes — coverage dropping, bundle growing, complexity creeping. Each change is fine in isolation; the trend is invisible.

2. **No direction.** Without a gradient, the loop can't distinguish "this iteration improved things" from "this iteration technically didn't break anything." Hill-climbing requires a slope.

The developer needs a fitness function: a single numeric score per iteration that enables ralph to keep improvements, discard regressions, and give agents feedback about *why* their work was reverted.

## Design Principles

1. **Pluggable over prescriptive.** The default scorer works out of the box; custom `score.sh` can measure anything. Ralph scores, it doesn't opine on what to score.

2. **Gradient, not gate.** The score is a relative signal (better/worse than last iteration), not an absolute threshold. A score of 0.4 isn't "bad" — it's a baseline to improve from.

3. **Revert is cheap, regressions are expensive.** Auto-reverting a mediocre iteration costs one loop cycle. Keeping a regression and building on it compounds across every future iteration.

4. **Safety net, not straitjacket.** Timeouts and reverts are generous defaults that protect against runaways. They're not tight constraints meant to force scoping discipline.

5. **Backward-compatible.** Projects without score scripts, coverage tools, or scoring config work exactly as before. Scoring is additive, never required.

## Architecture

### File Locations

```
src/commands/score/
├── index.ts          # ralph score command entry point + CLI registration
├── types.ts          # ScoreResult, ResultEntry, ScoreContext types
├── scorer.ts         # Score script discovery, execution, output parsing
├── default-scorer.ts # Built-in scorer (test count + coverage)
├── results.ts        # results.tsv read/write/append
├── trend.ts          # Trend computation and ASCII sparkline rendering
├── score.test.ts     # Unit tests
└── cli.test.ts       # CLI integration tests

src/commands/run/
├── scoring.ts        # Scoring integration for the run loop (new file)
├── timeout.ts        # Iteration timeout management (new file)
├── validation.ts     # Post-agent validation runner (new file)
└── lock.ts           # Run lock management (new file)
```

### Dependencies

- **score → config**: reads `scoring.*` and `quality.coverage.*` from `RalphConfig`
- **run/scoring → score/scorer**: calls score execution from within the run loop
- **run/scoring → score/results**: appends iteration results to `.ralph/results.tsv`
- **run/validation → config**: reads existing `validation.test-command` and `validation.typecheck-command`
- **run/timeout → run/agent**: wraps the existing `spawnAgent()` call with a timer
- **run/lock → run/index**: acquired at run start, released on exit
- **score → grade** (loose, optional): `ralph grade` *may* read `results.tsv` for context, but has no hard dependency

No new external npm dependencies. Uses `child_process` for script execution, `fs` for results.tsv.

### Config Schema Extensions

Added to `schema.ts`:

```typescript
export interface ScoringConfig {
  script: string | null;             // path to score script; null = auto-detect
  'regression-threshold': number;    // max allowed absolute score drop per iteration before revert
  'cumulative-threshold': number;    // max allowed total drop from run's best score before revert
  'auto-revert': boolean;            // whether to revert regressions (scoring still runs if false)
  'default-weights': {
    tests: number;                   // weight for test pass rate (0.0–1.0)
    coverage: number;                // weight for coverage rate (0.0–1.0)
  };
}
```

Added to `LoopConfig` (existing interface in `schema.ts`):

```typescript
export interface LoopConfig {
  'max-iterations': number;          // existing
  'stall-threshold': number;         // existing
  'iteration-timeout': number;       // NEW — seconds, 0 = no limit
}
```

Added to `RalphConfig`:

```typescript
export interface RalphConfig {
  // ... existing fields ...
  scoring?: ScoringConfig | undefined;
}
```

Corresponding partial types added to `RawRalphConfig` for YAML parsing (all fields optional except none — `ScoringConfig` is entirely optional at the top level).

**Config validation rules** (enforced in config loader):
- `regression-threshold` must be in range 0.0–1.0
- `cumulative-threshold` must be in range 0.0–1.0
- `iteration-timeout` must be non-negative integer
- `default-weights.tests + default-weights.coverage` must equal 1.0 (within tolerance 0.001)

### Config Defaults

Added to `defaults.ts`:

```typescript
export const DEFAULT_SCORING: ScoringConfig = {
  script: null,
  'regression-threshold': 0.02,
  'cumulative-threshold': 0.10,
  'auto-revert': true,
  'default-weights': {
    tests: 0.6,
    coverage: 0.4,
  },
};

// DEFAULT_LOOP updated:
const DEFAULT_LOOP: LoopConfig = {
  'max-iterations': 0,
  'stall-threshold': 3,
  'iteration-timeout': 900,   // 15 minutes
};
```

## Features

### F-FS01: Score Script Execution

Ralph discovers and executes a project-specific score script to measure iteration quality.

**Discovery order** — checked sequentially, **return immediately on first match** (do NOT check remaining options):

1. If `scoring.script` config is non-null → use that path (error if file missing)
2. If `score.sh` exists at repo root → use it
3. If `score.ts` exists at repo root → execute via `npx tsx score.ts`
4. If `score.py` exists at repo root → execute via `python3 score.py`
5. No script found at any path → fall back to default scorer (F-FS02)

Implementation: a simple `if/else if` chain with `existsSync()` checks. Do not collect all matches.

If the discovered script exists but is not executable (`EACCES` on spawn), log a warning and fall back to the default scorer.

**Execution:**

- CWD: project root (same as `ralph run`)
- Environment variables set by ralph:
  - `RALPH_ITERATION`: current 1-indexed iteration number (string)
  - `RALPH_COMMIT`: short hash of HEAD at time of scoring (after any ralph commit)
- Timeout: 60 seconds (hardcoded). Score scripts must be fast — they run every iteration.
- Exit code 0: success — parse stdout for score
- Exit code non-zero: scoring failure — log warning, iteration proceeds without a score

**Output format** — stdout, first line only:

```
<score>\t<key=value key=value ...>
```

- `score`: float, 0.0 to 1.0 inclusive (higher is better)
- Key=value pairs: space-separated, no spaces within values
- Additional stdout lines are ignored
- Stderr is ignored (available for script debugging)

**Validation of output:**

| Condition | Behavior |
|-----------|----------|
| Score outside 0.0–1.0 | Scoring error, logged, iteration proceeds unscored |
| Empty stdout | Scoring error, logged, iteration proceeds unscored |
| No tab separator | Treat entire line as score, metrics empty |
| Non-numeric score | Scoring error, logged, iteration proceeds unscored |
| Score script not found and no fallback | Default scorer runs (F-FS02) |

### F-FS02: Default Scorer

When no score script exists, ralph computes a score from available signals.

**Inputs:**

- **Test results**: parsed from validation command stdout (see F-FS06 for capture details)
- **Coverage**: read from `quality.coverage.report-path` config value (JSON format — looks for `statements.pct` or `lines.pct` or `total.statements.pct` fields)

**Test count extraction patterns** — these are **JavaScript RegExp patterns** applied to the full stdout string. Use `RegExp.exec()` or `.match()`, not string `.includes()`. First match wins:

```javascript
/(\d+)\s+passed/                  // vitest, jest default
/Tests:\s+(\d+)\s+passed/         // jest verbose
/(\d+)\s+passing/                 // mocha
/(\d+)\s+tests?\s+passed/         // generic
/passed:\s*(\d+)/i                // TAP-style
```

Total test count patterns (for computing pass rate when failures exist):

```javascript
/(\d+)\s+failed/                  // failure count
/Tests:\s+\d+\s+passed,\s+(\d+)\s+failed/  // jest verbose
```

Pass rate = passed / (passed + failed). If no failure pattern matches, assume all tests passed (rate = 1.0).

**Computation:**

```
test_rate     = tests_passing / tests_total       (omitted if no test data parsed)
coverage_rate = coverage_pct / 100                (omitted if no coverage data)

If both available:
  score = test_rate * weights.tests + coverage_rate * weights.coverage

If only test data available:
  score = test_rate                              (weight 1.0, coverage ignored)

If only coverage data available:
  score = coverage_rate                          (weight 1.0, tests ignored)

If neither available:
  score = null (no score — iteration proceeds as unscored pass)
```

When only one signal is available, that signal gets the full weight (1.0). This avoids penalizing projects that don't have coverage configured. The configured weights only apply when both signals are present. A project with no test runner and no coverage tool produces no score — it does NOT default to 1.0.

**Config weight validation:** `default-weights.tests + default-weights.coverage` must equal 1.0. Config validation rejects values that don't sum to 1.0 (within float tolerance of 0.001).

**Test count tracking:** The default scorer always includes `test_count=<N>` and `test_total=<N>` in its metrics output (alongside `test_rate` and `coverage`). These are informational — they don't affect the score — but they enable test count monitoring in `{score_context}` (F-FS07) and `ralph score --history`.

### F-FS03: Results Log

Every `ralph run` iteration appends exactly one row to `.ralph/results.tsv`.

**Schema:**

```tsv
commit	iteration	status	score	delta	duration_s	metrics	description
```

| Column | Type | Source | Description |
|--------|------|--------|-------------|
| `commit` | string | `git log -1 --format=%h HEAD` | Short hash of HEAD after iteration (regardless of who committed) |
| `iteration` | integer | Run loop counter | 1-indexed iteration number |
| `status` | enum | Scoring pipeline | One of: `pass`, `fail`, `timeout`, `discard` |
| `score` | float or `—` | Score script / default scorer | Iteration score, dash if unavailable |
| `delta` | signed float or `—` | Computed | `new_score - last_pass_score`, dash if no comparison possible |
| `duration_s` | integer | Wall clock | Seconds from agent spawn to iteration completion |
| `metrics` | string | Score script output | Key=value pairs, or `—` if no metrics |
| `description` | string | `git log -1 --format=%s HEAD` | First line of commit message captured BEFORE any revert. For `pass`: HEAD after commit. For `fail`/`timeout`/`discard`: HEAD before revert (the iteration's work, not the baseline). Truncated to 72 chars. If no new commit exists (no changes), value is `—`. |

**Status definitions:**

- `pass` — iteration completed, validation passed (or not configured), score at or above baseline (or no scoring, or unscored). An **unscored pass** has score `—` and delta `—` — this happens when no score script exists, default scorer has no signals, or scoring failed. No regression check is performed for unscored iterations.
- `fail` — validation command exited non-zero; changes reverted to baseline
- `timeout` — iteration exceeded `iteration-timeout`; agent killed, changes reverted to baseline
- `discard` — validation passed but score regressed beyond threshold; changes reverted to baseline

**File behavior:**

- Created with a header row on first append if the file does not exist. Exact header:
  `commit\titeration\tstatus\tscore\tdelta\tduration_s\tmetrics\tdescription`
- Append-only during a `ralph run` session
- Tab characters in description or metrics values are replaced with spaces before writing
- Metrics string is sanitized: control characters (except space) replaced with spaces, total length capped at 200 characters (truncated with `…`)
- Lives in `.ralph/` which is gitignored by `ralph init` (not committed)
- If the file is deleted mid-run, it is recreated with a header on the next append. Previous history is lost. No crash.

### F-FS04: Regression Detection & Auto-Revert

After scoring, ralph compares the new score against the previous passing score. If it regressed beyond the threshold, the iteration is reverted.

**Flow:**

```
Agent exits
  → record new HEAD as "iteration_head"
  → count new commits: git rev-list --count baseline..iteration_head
  → run validation (F-FS06)
    → fail? → revert to baseline → log "fail" → next iteration
  → if uncommitted changes exist:
    → if auto-commit enabled: gitCommit() with standard prefix
    → if auto-commit disabled AND agent didn't commit either: skip scoring for this
      iteration (no commit to score against), log "pass" (unscored), continue
  → run score script (F-FS01 / F-FS02)
    → no score? → log "pass" (unscored) → next iteration
  → find last "pass" entry in results.tsv with a non-null score
    → none found? → this is baseline → log "pass" → next iteration
  → compute delta = new_score - last_pass_score
  → delta < -threshold AND no keep signal?
    → revert to baseline → log "discard"
  → otherwise → log "pass"
```

**Revert procedure:**

1. Remove stale git locks: `rm -f .git/index.lock .git/refs/heads/*.lock` — prevents revert failure if the agent was killed mid-git-operation (e.g., SIGTERM during `git commit`)
2. `git reset --hard <baseline_commit>` — restores all tracked files to pre-iteration state
3. Compute new untracked files: diff the current `git ls-files --others --exclude-standard` against the pre-agent snapshot (captured before agent spawned)
4. Delete only files that are NEW since the agent ran — files that were untracked before the agent are preserved
5. This is safer than `git clean -fd` which would destroy pre-existing untracked files the user may want

**Baseline commit:** Captured via `git rev-parse HEAD` immediately before the agent spawns. This is the commit the loop returns to on any revert.

**Threshold behavior:** The `regression-threshold` is an **absolute delta**, not a percentage. A threshold of 0.02 means: if the score dropped by more than 0.02 points (e.g., 0.87 → 0.84 = delta of -0.03, exceeds threshold), revert. For low-scoring projects (score ~0.1), 0.02 is a ~20% relative drop — adjust the threshold to match your project's score range.

**Boundary case:** A delta of exactly `-threshold` (e.g., -0.02 when threshold is 0.02) does NOT trigger revert. Revert fires when `delta < -threshold` (strictly less than).

**Cumulative regression check:** In addition to the per-iteration regression check, ralph tracks the run's **best passing score** (highest score among all `pass` entries in the current run). After computing the per-iteration delta, also compute: `cumulative_delta = current_score - best_score`. If `cumulative_delta < -cumulative_threshold` (default 0.10), revert with status `discard` and append `[cumulative regression]` to description. This catches slow-bleed degradation where each step is within per-iteration threshold but the total drift is unacceptable.

The cumulative check runs *after* the per-iteration check passes. So a score that fails the per-iteration check is reverted for per-iteration regression, not cumulative. Only scores that pass per-iteration but fail cumulative get the `[cumulative regression]` annotation.

**Keep signal — the `.ralph/keep` file:**

The agent (or the developer) can create `.ralph/keep` to signal "don't revert this iteration even if score regressed."

- **Timing guard:** Before spawning the agent, snapshot whether `.ralph/keep` exists (`keepExistedBeforeAgent = existsSync('.ralph/keep')`). After scoring, only honor `.ralph/keep` if `keepExistedBeforeAgent` was true OR the file was not created during the agent's execution window. If the file was created during the agent phase (didn't exist before, exists after), it is treated as agent-created: log a warning ("`.ralph/keep` created during agent execution — ignored"), delete the file, and proceed with normal regression logic.
- If `.ralph/keep` is honored → skip revert, log status `pass`, append `[kept: <reason or "no reason">]` to description
- Keep file contents are read as UTF-8, truncated to 100 characters for the log entry
- Ralph deletes `.ralph/keep` after processing so it doesn't carry over
- If `.ralph/keep` exists from a previous crashed run and `keepExistedBeforeAgent` is true, it is consumed on the next iteration
- **CRITICAL: This mechanism MUST NOT appear in agent prompts or score context templates (F-FS07).** It exists for human override only. Do not reference `.ralph/keep` in `BUILD_TEMPLATE`, `PLAN_TEMPLATE`, or any `{score_context}` output. Developers who want agents to use it can add it to their project's AGENTS.md independently.

**Baseline recalibration:** After 3 consecutive discards (status `discard` with no intervening `pass`), the baseline recalibrates. The new baseline is the **highest score among the 3 discarded iterations**. This prevents the loop from being stuck against a poisoned (anomalously high) baseline. On recalibration: log `[baseline recalibrated from X to Y]` in the next iteration's description. The consecutive discard counter resets. The cumulative best-score also resets to the recalibrated value.

**Consecutive discards:** Each revert returns to the same baseline commit. The stall-threshold mechanism (existing, checks for no-changes iterations) handles the case where the loop can't make progress. After enough discards with no successful passes, the agent won't have new commits → `noChangesCount` increments → stall halt triggers.

### F-FS05: Iteration Timeout

Each `ralph run` iteration has a wall-clock time limit.

**Configuration:**

```yaml
run:
  loop:
    iteration-timeout: 900  # seconds; 0 = no limit; default: 900 (15 min)
```

**Behavior:**

1. Timer starts when `spawnAgent()` is called
2. At timeout: send `SIGTERM` to the agent process
3. Wait 10 seconds for graceful shutdown
4. If still running: send `SIGKILL`
5. Revert to baseline (same procedure as F-FS04 revert)
6. Append row to results.tsv with status `timeout`
7. Next iteration starts from clean baseline

**Implementation:** `run/timeout.ts` exports a wrapper around `spawnAgent()` that returns an augmented `AgentResult` with `timedOut: boolean`. The existing `AgentResult` type gains this field:

```typescript
export interface AgentResult {
  exitCode: number;
  durationMs: number;
  error?: string | undefined;
  output?: string | undefined;
  timedOut: boolean;              // NEW
}
```

**Timeout of 0:** Disables the feature entirely. No timer is set.

**Scope:** The iteration timeout covers the **agent phase only** (from `spawnAgent()` to agent exit). Validation commands (F-FS06) and score scripts (F-FS01) have their own independent timeouts (120s and 60s respectively, both hardcoded). The total worst-case wall-clock time per iteration is: `iteration-timeout + 240s (two validation commands) + 60s (score script) = iteration-timeout + 300s`. This is intentional — validation and scoring are ralph's own processes with known timeouts, while the agent is an external process with unpredictable behavior.

### F-FS06: Post-Agent Validation

Ralph independently validates the agent's work before scoring. This activates the existing `validation.test-command` and `validation.typecheck-command` config fields, which are currently defined in the schema but unused by the run loop.

**Configuration (existing fields, already in schema):**

```yaml
run:
  validation:
    test-command: "npm test"
    typecheck-command: "npx tsc --noEmit"
```

**Flow (inserted into run loop after agent exits, before scoring):**

1. Agent exits → changes detected (new commits or uncommitted changes)
2. Run `validation.test-command` (if non-null) → capture exit code AND stdout
3. Exit non-zero → revert to baseline → log status `fail` → next iteration
4. Run `validation.typecheck-command` (if non-null) → capture exit code
5. Exit non-zero → revert to baseline → log status `fail` → next iteration
6. Both pass (or both null) → proceed to scoring

**Stdout capture:** The test command's stdout is saved and passed to the default scorer (F-FS02) for test count extraction. It is NOT saved to disk — it's an in-memory string passed between functions.

**Validation timeout:** Each validation command has a 120-second timeout (hardcoded, independent of the score script timeout and iteration timeout). If validation hangs beyond 120s, the command is killed and treated as a validation failure (revert + `fail` status).

**When no validation is configured:** Both fields are null by default. When null, validation is skipped and scoring proceeds directly. This preserves backward compatibility — the current "trust the agent" behavior is unchanged unless the developer configures validation.

### F-FS07: Score Context in Agent Prompts

The run loop's `generatePrompt()` includes scoring context so agents know their score and can react to reverts.

**Prompt injection point:** A new template variable `{score_context}` is added to `BUILD_TEMPLATE`, placed immediately after the `## Validation` section and before `## Your Task`. In custom prompt templates, `{score_context}` is available as a variable and resolves to empty string if unused. The variable is populated by `run/scoring.ts` based on the previous iteration's result.

**Template contract header** (added to BUILD_TEMPLATE per F025 prevention pattern):
```html
<!-- Template Placeholder Contract
Placeholders: {project_name}, {date}, {language}, {framework}, {project_path}, {src_path}, {specs_path}, {validate_command}, {test_command}, {typecheck_command}, {skip_tasks}, {score_context}
Contract version: 1
Consumers: src/commands/run/prompts.ts, src/commands/run/scoring.ts
-->
```

**Context templates by previous status:**

After a `pass` iteration (with score):
```
## Score Context
Current project score: {score} (previous: {prev_score}, delta: {delta})
Metrics: {metrics}
Regressions beyond {threshold} will be auto-reverted.
```

**Test count monitoring:** If the previous iteration's metrics include `test_count` and the count increased by more than 100% compared to the iteration before it, append to the score context:
```
⚠ Test count increased significantly ({prev_count} → {new_count}). Ensure new tests exercise real behavior.
```
This is informational — it doesn't block or revert, but surfaces the signal.

After a `discard` iteration:
```
## Score Context
⚠ Previous iteration was DISCARDED due to score regression ({prev_score} → {new_score}, delta: {delta}).
Metrics that changed: {changed_metrics}
The codebase has been reverted to the last good state. Try a different approach.
```

After a `timeout` iteration:
```
## Score Context
⚠ Previous iteration TIMED OUT after {timeout}s and was reverted.
Scope your changes more tightly.
```

After a `fail` iteration:
```
## Score Context
⚠ Previous iteration FAILED validation and was reverted.
Ensure all tests pass and typecheck succeeds.
```

**When no scores exist yet** (first iteration or no previous scored iteration): `{score_context}` resolves to empty string. No scoring context added.

### F-FS08: `ralph score` Command

Standalone command to run scoring and view history outside of `ralph run`.

**CLI registration:** Added to `src/cli.ts` command router alongside existing commands.

```bash
ralph score                    # Run score script, print current score + metrics
ralph score --history [N]      # Show last N entries from results.tsv (default: 20)
ralph score --trend [N]        # ASCII sparkline of last N scores (default: 20)
ralph score --compare          # Compare current score vs last recorded in results.tsv
ralph score --json             # Output current score as JSON (for scripting)

# Related run flags:
ralph run --baseline-score 0.85  # Override first-iteration baseline (see below)
```

**`ralph score` (no flags) output:**

```
Score: 0.871 (custom: score.sh)
  test_count:  52
  coverage:    87.1%
  bundle_kb:   138.4
```

If using default scorer:
```
Score: 0.871 (default: tests=0.6 coverage=0.4)
  test_rate:   1.000 (52/52)
  coverage:    74.2%
```

**`ralph score --trend` output:**

ASCII sparkline using 8 Unicode block characters. Algorithm: for each score in the window, compute `index = Math.floor((score - min) / (max - min) * 7)` clamped to 0–7, then index into the array `['▁','▂','▃','▄','▅','▆','▇','█']`. When min equals max (all scores identical), use `▅` for all.

```
Score trend (last 10 iterations):
  ▃▅▆▅▇▇█▇▇█  0.72 → 0.87 (+0.15)
  Best: 0.89 (iteration 8)  Worst: 0.72 (iteration 1)
```

**`ralph score --compare` output** (useful after manual changes between `ralph run` sessions — runs score.sh now and compares against the last results.tsv entry):

```
Current: 0.871    Last recorded: 0.823    Delta: +0.048 ✓
```

If regression exceeds threshold:
```
Current: 0.804    Last recorded: 0.871    Delta: -0.067 ✗ (exceeds threshold 0.02)
```

**`ralph score --json` output:**

```json
{
  "score": 0.871,
  "source": "score.sh",
  "metrics": { "test_count": "52", "coverage": "87.1", "bundle_kb": "138.4" },
  "timestamp": "2026-03-09T12:34:56Z"
}
```

**Exit codes:** `ralph score` exits 0 on success, 1 if scoring fails (no script, parse error, etc.).

**`--baseline-score <float>` (run flag):** When provided to `ralph run`, overrides the first-iteration baseline. The first iteration is still scored normally, but regression detection compares against the provided value instead of establishing a new baseline from the first score. This prevents baseline poisoning from flaky tests or non-deterministic coverage. The value must be 0.0–1.0. Stored in checkpoint so it persists across resume.

### F-FS09: Simplification Mode

An opt-in iteration mode for `ralph run` where agents focus on removing code while maintaining quality.

```bash
ralph run --simplify [--max N]
```

**Prompt modification:** When `--simplify` is active, the build prompt preamble is replaced with:

```
SIMPLIFICATION ITERATION — Your goal: reduce code while maintaining quality.

Rules:
- Remove dead code, redundant abstractions, unnecessary complexity
- Tests must still pass
- Score must not decrease (current: {score})
- Do NOT add new features
- Deleting code that maintains the score is a success
- Improving the score by deleting code is an excellent success

Current metrics: {metrics}
```

**Constraints:**

- Cannot be combined with `--mode plan` or `--no-score` → exit with error if combined with either
- Uses the same scoring, revert, and timeout infrastructure as normal iterations
- If score drops → auto-revert (same threshold as normal)
- The simplification preamble replaces the build prompt's "Your Task" section, not appends to it
- `--simplify` without any existing score: the first iteration establishes a baseline (scored, never reverted), subsequent iterations enforce score maintenance

### F-FS10: `--no-score` Flag

Skip scoring entirely during a `ralph run` session.

```bash
ralph run --no-score [--max N]
```

**Behavior:**

- Validation still runs (if configured) — `--no-score` skips scoring, not validation
- No score script execution
- No regression detection or auto-revert based on score
- No score context in prompts
- Timeout still applies (it's independent of scoring)
- Cannot be combined with `--simplify` (simplification requires scoring to enforce score maintenance; exit with error if both specified)
- Useful for quick debugging iterations where scoring overhead isn't wanted
- **Results.tsv entries are still written for `fail` and `timeout` statuses** — the score, delta, and metrics columns are `—`, but the audit trail of failures and timeouts is preserved. Only `pass` and `discard` entries are suppressed (since those depend on scoring).

### F-FS11: Run Lock

Prevents concurrent `ralph run` sessions on the same repository from corrupting shared state (results.tsv, git history, checkpoints).

**Implementation:** `src/commands/run/lock.ts` exports three functions:

```typescript
export function acquireLock(): void;    // throws on conflict
export function releaseLock(): void;    // idempotent
export function isLockHeld(): boolean;  // for diagnostics
```

**Lock file:** `.ralph/run.lock` containing JSON: `{ "pid": <number>, "startedAt": "<ISO>" }`.

**Acquisition flow:**
1. `mkdir -p .ralph` (ensure directory exists)
2. Attempt `writeFileSync('.ralph/run.lock', content, { flag: 'wx' })` (exclusive create)
3. If `EEXIST`: read existing lock, parse PID
   - Check if alive: `process.kill(pid, 0)` (wrapped in try/catch — `ESRCH` = dead)
   - If alive: throw `Error("Another ralph run is active (PID ${pid}, started ${startedAt})")`
   - If dead: `unlinkSync('.ralph/run.lock')`, retry step 2
4. Register cleanup: `process.on('exit', releaseLock)`

**`--force` flag:** Added to `ralph run`. When set, `acquireLock()` deletes any existing lockfile before attempting exclusive create. Useful when a previous run crashed and left a stale lock with a recycled PID.

**Note:** The lock is advisory — it prevents accidental concurrent runs, not malicious ones. This is sufficient for the use case (developer running ralph in two terminals).

## Integration Points

### Run Lock

Before entering the main loop, `runCommand()` acquires a run lock via `run/lock.ts`:

1. Attempt to create `.ralph/run.lock` with exclusive flag (`wx`). File contains: `{ "pid": <process.pid>, "startedAt": "<ISO timestamp>" }\n`
2. If file exists: read PID from file. Check if process is alive via `process.kill(pid, 0)` (signal 0 = existence check).
   - If alive: exit with error `"Another ralph run is active (PID ${pid}, started ${startedAt}). Use --force to override."`
   - If dead: stale lock. Delete and re-create.
3. Register cleanup on `process.on('exit')` to delete the lockfile. Also on SIGINT/SIGTERM handlers (before the existing `onStop` logic).
4. `--force` flag: if provided, delete any existing lockfile without PID check and re-create.

The lock module exports: `acquireLock(): void` (throws on conflict), `releaseLock(): void`, `isLockHeld(): boolean`.

### Post-Scoring Dirty Check

After the score script exits (in the scoring step of the run loop), ralph checks for side effects:

1. Run `git status --porcelain` and compare against the pre-scoring state (captured just before scoring)
2. If new dirty files appeared (modified tracked files or new untracked files that weren't there before scoring):
   - Log warning: `"Score script modified working tree — restoring (files: <list>)"`
   - Restore tracked files: `git checkout -- .`
   - Remove new untracked files (same diff approach as the revert procedure — only remove files new since pre-scoring snapshot)
3. This runs regardless of whether scoring succeeded or failed
4. The check does NOT run for the default scorer (it's pure computation with no subprocesses that could modify files)

### Run Loop Modification

The existing `runCommand()` in `src/commands/run/index.ts` gains new steps. **Preserve all existing behavior** — signal handling (`SIGINT`/`SIGTERM` with `stopping` flag), checkpoint saving, TTY confirmation prompts, and stall detection remain unchanged. The new steps are inserted into the existing loop body, not a replacement. The modified loop:

```
pre-loop:
  → acquire run lock (F-FS11)

loop start
  → capture baseline: git rev-parse HEAD
  → capture pre-agent untracked files: git ls-files --others --exclude-standard
  → snapshot .ralph/keep existence (keepExistedBeforeAgent)
  → start timeout timer (if iteration-timeout > 0)
  → spawn agent (wrapped with timeout)
    → if timed out: rm -f .git/index.lock, revert to baseline, log "timeout", continue loop
  → detect changes: hasChanges() OR (git rev-parse HEAD != baseline)
    → no changes: increment noChangesCount, save checkpoint, stall check, continue
  → run validation commands (F-FS06)
    → test-command fails: revert to baseline, log "fail", continue
    → typecheck-command fails: revert to baseline, log "fail", continue
  → if auto-commit AND hasChanges(): gitCommit()
  → run scoring (unless --no-score)
    → capture pre-scoring git status
    → score obtained:
      → post-scoring dirty check: restore if score script modified working tree
      → if first scored iteration AND no --baseline-score: record as baseline, log "pass"
      → if --baseline-score set AND no prior pass: use provided baseline for comparison
      → compare against last pass score (per-iteration regression check)
        → regression beyond threshold AND no valid keep signal?
          → revert to baseline → log "discard"
          → increment consecutive discard counter
          → if 3 consecutive discards: recalibrate baseline to best discarded score
        → pass? → reset consecutive discard counter
      → cumulative regression check: compare against run's best score
        → best_score - current_score > cumulative-threshold?
          → revert to baseline → log "discard [cumulative regression]"
      → check .ralph/keep: only honor if keepExistedBeforeAgent was true
        → agent-created keep: warn, delete, proceed with normal regression logic
    → no score obtained: log "pass" (unscored)
  → log "pass" with score
  → update run's best score if this score exceeds it
  → gitPush() (if configured)
  → inject score context into next prompt vars (including test count monitoring)
  → save checkpoint
  → stall check
loop end

post-loop:
  → release run lock
```

### Checkpoint Extension

```typescript
interface Checkpoint {
  // ... existing fields ...
  lastScore?: number | null;           // score from last "pass" iteration
  lastScoredIteration?: number | null; // iteration number of last scored "pass"
  bestScore?: number | null;           // highest score in this run (for cumulative check)
  consecutiveDiscards?: number;        // count of consecutive discard statuses
  baselineScore?: number | null;       // explicit baseline from --baseline-score flag
}
```

**Backward compatibility:** All new checkpoint fields are optional with `undefined` default. When loading a checkpoint from a prior version (missing these fields), they default to their initial values: `null` for scores, `0` for consecutiveDiscards. No migration step needed — the checkpoint reader treats missing fields as absent.

### Changes Detection

The current loop uses `hasChanges()` (checks `git status --porcelain`). With scoring, we also need to detect agent commits (where `hasChanges()` returns false but the agent committed). The new check:

```typescript
const hasNewWork = hasChanges() || (currentHead !== baselineCommit);
```

This catches both uncommitted changes AND agent-made commits.

## Acceptance Criteria

### F-FS01: Score Script Execution
- AC-01: `ralph score` discovers and runs `score.sh` at repo root when no config override
- AC-02: Discovery follows defined priority order and short-circuits on first match
- AC-03: Score script receives `RALPH_ITERATION` and `RALPH_COMMIT` env vars
- AC-04: Score outside 0.0–1.0 is rejected; iteration proceeds unscored with warning
- AC-05: Non-zero exit from score script logs warning; iteration proceeds unscored
- AC-06: Score script killed after 60s; iteration proceeds unscored with warning
- AC-07: Non-executable script file logs warning and falls back to default scorer

### F-FS02: Default Scorer
- AC-08: Default scorer activates when no score script exists
- AC-09: Test pass rate parsed from validation stdout using defined regex patterns
- AC-10: Coverage parsed from JSON report at configured path
- AC-11: Single signal available → that signal gets full weight (1.0)
- AC-12: Both signals missing → score is null, iteration proceeds unscored
- AC-13: Config validation rejects weights that don't sum to 1.0

### F-FS03: Results Log
- AC-14: `.ralph/results.tsv` created with header on first append
- AC-15: Every `ralph run` iteration appends exactly one row
- AC-16: All columns populated per schema; tabs in values replaced with spaces
- AC-17: Description sourced from `git log -1 --format=%s HEAD`, truncated to 72 chars
- AC-18: File survives deletion mid-run (recreated on next append)

### F-FS04: Regression Detection & Auto-Revert
- AC-19: Regression beyond threshold triggers revert to baseline commit
- AC-20: Revert cleans only NEW untracked files (pre-agent untracked files preserved)
- AC-21: `.ralph/keep` prevents revert; file deleted after processing; reason logged
- AC-22: First scored iteration recorded as baseline, never reverted
- AC-23: Multi-commit iterations fully reverted (all commits since baseline)
- AC-24: `discard` status with regression details logged in results.tsv
- AC-25: Delta exactly at `-threshold` does NOT trigger revert (strictly less than)

### F-FS05: Iteration Timeout
- AC-26: Agent process receives SIGTERM after configured timeout seconds
- AC-27: SIGKILL sent 10s after SIGTERM if process still alive
- AC-28: Changes reverted to baseline on timeout
- AC-29: `iteration-timeout: 0` disables timeout entirely
- AC-30: Status `timeout` logged in results.tsv

### F-FS06: Post-Agent Validation
- AC-31: Validation commands run after agent exits, before scoring
- AC-32: Non-zero exit triggers revert to baseline and `fail` status
- AC-33: Test command stdout captured in memory for default scorer consumption
- AC-34: Null validation config → validation skipped, proceeds to scoring

### F-FS07: Score Context in Prompts
- AC-35: `pass` with score → next prompt includes score, delta, metrics
- AC-36: `discard` → next prompt includes regression details and "try different approach"
- AC-37: `timeout` → next prompt includes duration and "scope tightly"
- AC-38: `fail` → next prompt includes "ensure tests pass"
- AC-39: First iteration → no scoring context in prompt

### F-FS08: `ralph score` Command
- AC-40: `ralph score` runs score script and prints result with metrics and source
- AC-41: `--history N` shows last N results.tsv entries (default 20)
- AC-42: `--trend N` shows ASCII sparkline with min/max/delta summary
- AC-43: `--compare` shows current score vs last recorded with pass/fail indicator
- AC-44: `--json` outputs parseable JSON with score, source, metrics, timestamp

### F-FS09: Simplification Mode
- AC-45: `ralph run --simplify` replaces build prompt with simplification preamble
- AC-46: Errors if combined with `--mode plan`
- AC-47: Uses standard scoring/revert/timeout (no special treatment)
- AC-48: First simplification iteration establishes baseline, not reverted

### F-FS10: `--no-score` Flag
- AC-49: `--no-score` skips scoring but still writes results.tsv for `fail` and `timeout`
- AC-50: Validation and timeout still active when `--no-score` is set

### F-FS11: Run Lock
- AC-54: `.ralph/run.lock` prevents concurrent `ralph run` instances
- AC-55: Stale lockfile (dead PID) is detected and overwritten
- AC-56: Lock released on normal exit, SIGINT, and SIGTERM
- AC-57: `--force` flag overrides existing lock without PID check

### Cross-cutting
- AC-51: Projects without scoring config behave exactly as before (no run loop change)
- AC-52: All new config fields have defaults in `defaults.ts`
- AC-53: Config validation rejects: threshold outside 0.0–1.0, negative timeout, weights not summing to 1.0, cumulative-threshold outside 0.0–1.0

### Hardening
- AC-58: Default scorer includes `test_count` and `test_total` in metrics output
- AC-59: `{score_context}` flags test count jumps >100% as suspicious
- AC-60: After 3 consecutive discards, baseline recalibrates to best discarded score
- AC-61: Recalibration logged in results.tsv description
- AC-62: Cumulative regression check fires when `best_score - current_score > cumulative-threshold`
- AC-63: `.git/index.lock` removed before every `git reset --hard`
- AC-64: `.ralph/keep` only honored if it existed before agent spawn
- AC-65: Agent-created `.ralph/keep` ignored and deleted with warning
- AC-66: Post-scoring `git status` detects and restores score script side effects
- AC-67: Metrics string sanitized: tabs replaced, length capped at 200, control chars removed
- AC-68: `--baseline-score <float>` overrides first-iteration baseline
- AC-69: `--baseline-score` stored in checkpoint for resume persistence
- AC-70: Cumulative threshold configurable via `scoring.cumulative-threshold`
- AC-71: Checkpoint loads missing scoring fields as null/0 (backward compat)

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Score script exists but is not executable | Warning logged, falls back to default scorer |
| Score of exactly 0.0 | Valid. Recorded as baseline. |
| Score script outputs empty stdout | Scoring error. Iteration proceeds unscored. |
| Consecutive discards (3 reverts to same baseline) | After 3rd discard, baseline recalibrates to best discarded score. Loop continues with relaxed baseline. |
| results.tsv deleted mid-run | Recreated with header on next append. No crash. |
| Agent makes 0 commits but leaves uncommitted changes | Ralph commits (if auto-commit), then scores. Normal flow. |
| Agent makes 5 commits in one iteration | All 5 reverted on regression/fail/timeout (reset to baseline). |
| `--simplify` with no existing score | First iteration establishes baseline. Not reverted. |
| Score script takes >60s | Killed. Warning logged. Iteration proceeds unscored. |
| `.ralph/keep` exists from a previous crashed run | Honored if `keepExistedBeforeAgent` is true (pre-existing). Consumed, then deleted. |
| Agent creates `.ralph/keep` during iteration | Ignored for revert decision, deleted with warning |
| `validation.test-command` is null | Validation skipped. Scoring still runs. |
| Delta exactly at negative threshold | NOT reverted. Strictly less than required. |
| Agent exits non-zero but made valid changes | Changes are still validated/scored. Agent exit code logged as warning (existing behavior). |
| Custom score script AND default scorer config | Custom script takes priority. Default weights config is ignored. |
| `--no-score` combined with `--simplify` | Error: simplification requires scoring to enforce score maintenance. |
| Two `ralph run` in same repo | Second run exits with error: "Another run active (PID N)" |
| Lockfile exists but PID dead | Stale lock deleted, new run proceeds |
| `--force` with active lock | Lock overridden, previous run may corrupt if still active |
| 3 consecutive discards then pass | Baseline recalibrated after 3rd discard; 4th iteration uses recalibrated baseline |
| Cumulative drop of 0.11 over 8 iterations (each <0.02) | Reverted at iteration where cumulative threshold (0.10) exceeded |
| `--baseline-score 0.5` with first iteration scoring 0.9 | Score logged as 0.9, regression check uses 0.5 as comparison — no revert |
| Score script creates temp files | Post-scoring dirty check restores working tree, logs warning |
| `.git/index.lock` exists from crashed agent | Removed before revert proceeds |
| `--no-score` with validation failure | results.tsv entry written with status `fail`, score `—` |
| Checkpoint from pre-scoring version loaded | Missing scoring fields default to null/0; no crash |

## Out of Scope

- Running benchmarks or performance tests (score.sh can invoke them; ralph doesn't orchestrate them)
- Comparing scores across different projects (scores are project-local)
- Machine learning on score history (results.tsv is for human/agent analysis)
- Automatic threshold tuning (the developer sets it based on project needs)
- Multi-objective optimization (score is a single float; combine in score.sh however you want)
- Parallel iteration evaluation (iterations are sequential; parallel requires branching strategies)
- `ralph run --simplify` as automatic periodic behavior (always opt-in, never auto-triggered)
- Validation command selection/detection (developer configures `test-command` explicitly)

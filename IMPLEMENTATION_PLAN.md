# Implementation Plan — Trust Calibration Phase 2

Spec: `docs/product-specs/adversarial-generation.md`
Date: 2026-03-13

## Pre-flight

- Regression baseline: **868 tests passing**, typecheck **clean** (0 errors)
- Phase 1 sentinel confirmed: `src/commands/run/stages.ts` ✓
- Phase 2 sentinel absent: `src/commands/run/adversarial.ts` ✗ → target phase

---

## Schema & Config

- [x] Add `AdversarialConfig` to `src/config/schema.ts`; add `adversarial` field to `RunConfig` and raw shape to `RawRalphConfig.run`; add `DEFAULT_ADVERSARIAL` to `src/config/defaults.ts` and wire into `DEFAULT_RUN`; add `'adversarial'` to `KNOWN_RUN_KEYS` in `src/config/validate.ts` and add `validateAdversarialConfig()` (budget > 0, timeout > 0, test-patterns non-empty, unknown-key warnings).
  Satisfies: AC-1 (opt-in default: `enabled: false`), AC-9 (budget field), AC-10 (timeout field), AC-11 (skip-on-simplify field), AC-14 (agent/model fields), AC-15 (validated alongside git config).
  Three-file schema triad exception (schema.ts + defaults.ts + validate.ts).

  `AdversarialConfig` fields:
  - `enabled: boolean` — default: `false`
  - `agent: string | null` — default: `null` (inherit from run.agent)
  - `model: string | null` — default: `null`
  - `budget: number` — default: `5`
  - `timeout: number` — default: `300` (seconds)
  - `diagnostic-branch: boolean` — default: `true`
  - `test-patterns: string[]` — default: `["**/*.test.{ts,js,tsx,jsx}", "**/*.spec.{ts,js,tsx,jsx}", "**/test_*.py", "**/*_test.py", "**/*_test.go"]`
  - `restricted-patterns: string[]` — default: `["IMPLEMENTATION_PLAN.md", ".ralph/**", "package.json", "tsconfig.json"]`
  - `skip-on-simplify: boolean` — default: `true`

  Verify: `npx tsc --noEmit` clean; `npm test` still 868 passing.

---

## Types

- [x] Add `AdversarialResult` type and `AdversarialOutcome` to `src/commands/run/types.ts`; add `'adversarial-fail'` to `ResultEntry['status']` union in `src/commands/score/types.ts`; add `adversarialResult` field to `ScoreContext` in `src/commands/score/types.ts`; add `'adversarial-fail'` to `ScoreContext['previousStatus']` union.
  Satisfies: AC-6 (revert status type), AC-7 (diagnostic branch in score context), AC-8 (score context after adversarial failure), AC-13 (adversarial-fail in results TSV).

  `AdversarialResult` shape:
  ```typescript
  export type AdversarialOutcome = 'pass' | 'fail' | 'skip';
  export interface AdversarialResult {
    outcome: AdversarialOutcome;
    testFilesAdded: string[];      // files written by adversary (empty on skip/fail)
    failedTests: string[];         // test names that failed (empty unless outcome='fail')
    diagnosticBranch: string | null; // branch name (null unless outcome='fail' with diagnostic-branch:true)
    testCountBefore: number | null;
    testCountAfter: number | null;
    skipReason?: string | undefined; // 'auto-commit disabled' | 'simplify mode' | 'timeout' | 'spawn failed' | 'no tests written'
  }
  ```

  `ScoreContext` additions:
  ```typescript
  adversarialResult?: AdversarialResult | null | undefined;
  ```

  Note: `score/results.ts` requires NO code change — `appendResult()` writes `entry.status` as a raw string without a runtime guard. Adding `adversarial-fail` to the TypeScript union is sufficient for compile-time and runtime correctness.
  Note: `score/trend.ts` filters by `e.score !== null` only — already resilient to unknown status values.
  Note: `run/progress.ts` `printIterationSummary` does not use status — no change needed.

  Verify: `npx tsc --noEmit` clean after this task.

---

## Core Implementation

- [x] Add `generateAdversarialPrompt()` to `src/commands/run/prompts.ts`.
  Satisfies: AC-2 (prompt includes builder diff, spec, existing tests, stage results), AC-9 (budget in prompt), AC-12 (callable from dry-run with placeholder values).

  Function signature:
  ```typescript
  export function generateAdversarialPrompt(opts: {
    builderDiff: string;
    specContent: string;
    existingTests: string;
    stageResults: string | null;
    budget: number;
    testCommand: string;
  }): string
  ```
  Returns the adversary prompt template from the spec with all `{placeholder}` values substituted. Include all 9 numbered rules from the spec's Adversary Prompt section.
  Verify: unit test calls function and checks output contains the configured budget number and constraint rule text.

- [x] Create `src/commands/run/adversarial.ts` — implement `enforceFileRestriction()` and `enforceTestDeletionGuard()`.
  Satisfies: AC-3 (file restriction: reverts non-test and restricted files), AC-4 (test deletion guard: aborts if count drops or test file deleted).

  Exports:
  - `interface TestSnapshot { testFiles: string[]; testCount: number | null; }`
  - `function enforceFileRestriction(config: AdversarialConfig): { reverted: string[] }`:
    1. `git diff --name-only HEAD` → changed files
    2. Revert files NOT matching `test-patterns` OR matching `restricted-patterns` via `git checkout HEAD -- {file}`
    3. `git ls-files --others --exclude-standard` → untracked new files; delete those NOT matching test-patterns
    4. Return `{ reverted: string[] }` (list of reverted/removed paths); log warning if non-empty
  - `function enforceTestDeletionGuard(config: AdversarialConfig, snapshot: TestSnapshot, newTestOutput: string): { abort: boolean; reason: string }`:
    1. Check no file from `snapshot.testFiles` was deleted (via `existsSync`)
    2. Parse test count from `newTestOutput`; if decreased vs `snapshot.testCount`: abort
    3. Return `{ abort: false, reason: '' }` on pass

  Use micromatch or manual glob check for test-pattern matching (since the project has no glob dep, use `minimatch` if available or implement a simple pattern check matching the `**/*.test.{ts,js}` patterns used in the project).

  Verify: unit tests mock `execSync`/`existsSync`; non-test file reverted; test file kept; guard aborts on deleted file; guard aborts on count decrease; guard passes on added tests.

- [x] Add `pushDiagnosticBranch()` to `src/commands/run/adversarial.ts`.
  Satisfies: AC-7 (push failing tests to `ralph/adversarial/{iteration}` before reverting).

  ```typescript
  function pushDiagnosticBranch(iteration: number, failureCount: number, diagnosticEnabled: boolean): string | null
  ```
  - If `!diagnosticEnabled`: return `null`
  - Branch name: `ralph/adversarial/${iteration}`
  - `git checkout -b {branch}` (from current HEAD = commit A + adversary test files)
  - `git add -A && git commit -m "ralph: adversarial tests (iteration ${n}, ${m} failures)"`
  - `git checkout -` to return to original branch
  - Return branch name on success; return `null` on error (fail-open, log warning)

  Verify: unit test mocks git commands; branch created with correct name; no branch when `diagnosticEnabled: false`.

- [x] Add `runAdversarialPass()` orchestrator to `src/commands/run/adversarial.ts`.
  Satisfies: AC-2 (spawn adversary), AC-5 (commit passing tests as commit B), AC-6 (revert on failure), AC-10 (timeout → skip, fail-open), AC-11 (simplify skip), AC-14 (agent independence), AC-15 (auto-commit=false → skip), AC-16 (no tests written → no-op).

  ```typescript
  export async function runAdversarialPass(opts: {
    config: AdversarialConfig;
    runConfig: RunConfig;
    iteration: number;
    baselineCommit: string;
    originalBranch: string;
    preBuilderUntracked: string[];
    stageResults: string | null;
    isSimplify: boolean;
    effectiveAutoCommit: boolean;
    verbose?: boolean | undefined;
  }): Promise<AdversarialResult>
  ```

  Internal flow:
  1. Skip guard: `!effectiveAutoCommit` → skip('auto-commit disabled'); `isSimplify && config['skip-on-simplify']` → skip('simplify mode')
  2. Capture `TestSnapshot` (list test files matching test-patterns; last test count from validation)
  3. Generate adversary prompt: `git diff HEAD~1 HEAD` for builderDiff; read IMPLEMENTATION_PLAN.md (first 2000 chars) for specContent; concatenate test file contents (up to 4000 chars) for existingTests
  4. Resolve adversary agent: if `config.agent !== null` build AgentConfig from config fields; else inherit `runConfig.agent` (optionally override model if `config.model !== null`)
  5. `spawnAgentWithTimeout(adversaryAgentConfig, prompt, config.timeout, { verbose })` (import from `./timeout.js`)
  6. On timeout/spawn failure (`result.timedOut` or `result.error`): return skip result (fail-open, builder commit A preserved)
  7. `enforceFileRestriction(config)` — revert non-test/restricted files
  8. `enforceTestDeletionGuard(config, snapshot, testOutput)` — if `guard.abort`: revert adversary changes (`git checkout HEAD -- .`), return skip result with guard reason
  9. Check if any test files changed: `git diff --name-only HEAD` filtered to test-patterns; if empty: return skip('no tests written')
  10. Run `config['test-command']` (or first test-type stage command); parse pass/fail; collect failing test names from output
  11a. All pass: `git add -A && git commit -m "ralph: adversarial tests (iteration ${n})"` → return `{ outcome: 'pass', testFilesAdded, ... }`
  11b. Any fail: call `pushDiagnosticBranch()`; call `revertToBaseline(baselineCommit, originalBranch, preBuilderUntracked)` (import from `./index.js`... see note); return `{ outcome: 'fail', failedTests, diagnosticBranch, ... }`

  Note on `revertToBaseline` import: this function is currently unexported in `run/index.ts`. Extract it to a new `src/commands/run/git.ts` helper OR export it from `run/index.ts`. Preferred: export from `run/index.ts` (minimal change). If that creates circular imports, move to `run/git.ts`.

  Verify: unit tests mock `spawnAgentWithTimeout`, `execSync`, `existsSync`; all 6 outcome paths tested.

---

## Score Context

- [ ] Add `'adversarial-fail'` branch to `buildScoreContext()` in `src/commands/run/scoring.ts`; update `ScoreContext['previousStatus']` union reference in `scoring.ts` to accept the new value (type already updated in score/types.ts task above).
  Satisfies: AC-8 (score context after failure names tests and branch), AC-2 (pass context includes adversarial test count).

  New `adversarial-fail` branch in `buildScoreContext()`:
  ```typescript
  if (previousStatus === 'adversarial-fail') {
    const r = ctx.adversarialResult;
    const count = r?.failedTests.length ?? 0;
    const failedList = (r?.failedTests ?? []).map(t => `  - test: "${t}"`).join('\n');
    const branch = r?.diagnosticBranch ?? null;
    return (
      `## Score Context\n` +
      `⚠ Previous iteration passed validation but was REVERTED by adversarial testing.\n` +
      `The adversary found ${count} edge case(s) that broke the implementation.\n` +
      (failedList ? `Failed tests:\n${failedList}\n` : '') +
      (branch ? `Diagnostic branch: ${branch}\n` : '') +
      `Fix these edge cases in your implementation. The adversarial tests will run again.`
    );
  }
  ```

  Update the `'pass'` branch: after the existing pass context string, append adversarial context line when `ctx.adversarialResult` is present:
  - `outcome === 'pass'`: `\nAdversarial testing passed: ${n} edge-case tests added and passing.`
  - `outcome === 'skip'`: `\nAdversarial testing: skipped (${skipReason}).`

  Verify: unit tests for all three adversarial variants; existing pass/fail/timeout/discard branches unchanged.

---

## Integration

- [ ] Wire adversarial pass into `src/commands/run/index.ts` (between auto-commit and scoring); update dry-run to print adversarial prompt.
  Satisfies: AC-2, AC-5, AC-6, AC-11, AC-12, AC-13, AC-15.

  First: extract `revertToBaseline` as an export from `run/index.ts` (or move to `run/git.ts`) so `adversarial.ts` can import it without circular dependency. If moving to `run/git.ts`, update the existing call sites in `run/index.ts`.

  In the build mode branch, after the auto-commit block (after `description = captureGitDescription()` update at ~line 589) and before `if (options.noScore !== true)`:
  ```typescript
  let adversarialResult: AdversarialResult | null = null;
  if (runConfig.adversarial?.enabled === true) {
    adversarialResult = await runAdversarialPass({
      config: runConfig.adversarial,
      runConfig,
      iteration,
      baselineCommit,
      originalBranch,
      preBuilderUntracked: preAgentUntracked,
      stageResults: stageResultsStr ?? null,
      isSimplify: options.simplify === true,
      effectiveAutoCommit,
      verbose: options.verbose,
    });

    if (adversarialResult.outcome === 'fail') {
      // runAdversarialPass already reverted to baseline
      const headAfterRevert = captureShortHead();
      appendResult({
        commit: headAfterRevert,
        iteration,
        status: 'adversarial-fail',
        score: null,
        delta: null,
        durationS,
        metrics: '—',
        description: `${description} [adversary found ${adversarialResult.failedTests.length} bug(s)]`,
      });
      scoreContext = buildScoreContext({
        previousStatus: 'adversarial-fail',
        previousScore: checkpoint.lastScore ?? null,
        currentScore: null,
        delta: null,
        metrics: '—',
        changedMetrics: '—',
        timeoutSeconds: iterationTimeoutSecs,
        regressionThreshold,
        previousTestCount: adversarialResult.testCountBefore,
        currentTestCount: adversarialResult.testCountAfter,
        failedStage: null,
        stageResults: null,
        adversarialResult,
      });
      checkpoint.iteration = iteration;
      checkpoint.history.push({
        iteration,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        commit: null,
        error: result.error ?? null,
      });
      saveCheckpoint(checkpoint);
      printIterationSummary(iteration, result, null, null);
      continue;
    }

    if (adversarialResult.outcome === 'pass') {
      description += ` [+${adversarialResult.testFilesAdded.length} adversarial tests]`;
      commitHash = captureShortHead(); // reflect commit B
    }
    // outcome === 'skip': no change to description or commitHash
  }
  ```

  Pass `adversarialResult` into every `buildScoreContext()` call that follows (existing pass/discard/no-score paths) so the score context can include adversarial pass/skip notes.

  For dry-run: after the existing validation stage printout, if `config.run?.adversarial?.enabled === true`, call `generateAdversarialPrompt()` with placeholder values and print it. Guard with `adversarial.enabled` check so dry-run output is unchanged when adversarial is disabled.

  Verify: `npx tsc --noEmit` clean; `npm test` ≥ 868 passing.

- [ ] Update `ARCHITECTURE.md` with new run-domain files.
  Add `adversarial.ts` and `adversarial.test.ts` to the run domain file listing. Document that `adversarial.ts` imports `spawnAgentWithTimeout` from `run/timeout.ts` and `revertToBaseline` from `run/index.ts` (or `run/git.ts` if extracted) — both are existing intra-domain patterns.

---

## Tests

- [ ] Write unit tests in `src/commands/run/adversarial.test.ts`.
  Satisfies verification of: AC-3, AC-4, AC-5, AC-6, AC-7, AC-10, AC-14, AC-15, AC-16.

  Mock: `spawnAgentWithTimeout` (from `./timeout.js`), `execSync` (from `node:child_process`), `existsSync`/`readdirSync` (from `node:fs`).

  Tests:
  - `enforceFileRestriction`: adversary changes `src/foo.ts` + `src/foo.test.ts` → `src/foo.ts` reverted, test file kept (AC-3)
  - `enforceFileRestriction`: adversary changes `IMPLEMENTATION_PLAN.md` → reverted (AC-3 restricted patterns)
  - `enforceFileRestriction`: adversary changes `.ralph/config.yml` → reverted (AC-3 restricted patterns)
  - `enforceFileRestriction`: adversary changes only `src/foo.test.ts` → no reverts, warning not emitted
  - `enforceTestDeletionGuard`: snapshot has `foo.test.ts`, file deleted → `{ abort: true }`, warning logged (AC-4)
  - `enforceTestDeletionGuard`: test count decreased 10→8 → `{ abort: true }`, warning logged (AC-4)
  - `enforceTestDeletionGuard`: test count increased 10→13 → `{ abort: false }` (AC-4 guard passes)
  - `pushDiagnosticBranch`: `diagnostic-branch: true` → git commands called, branch name returned (AC-7)
  - `pushDiagnosticBranch`: `diagnostic-branch: false` → returns null, no git branch commands (AC-7)
  - `runAdversarialPass`: passing tests → `outcome: 'pass'`, commit B created, testFilesAdded non-empty (AC-5)
  - `runAdversarialPass`: failing tests → `outcome: 'fail'`, diagnostic branch created, reverted to baseline (AC-6, AC-7)
  - `runAdversarialPass`: agent timeout → `outcome: 'skip'`, skipReason includes 'timeout', builder commit preserved (AC-10)
  - `runAdversarialPass`: spawn failure → `outcome: 'skip'`, builder commit preserved (fail-open)
  - `runAdversarialPass`: no test file changes after adversary runs → `outcome: 'skip'`, skipReason 'no tests written' (AC-16)
  - `runAdversarialPass`: `effectiveAutoCommit: false` → `outcome: 'skip'`, warning logged (AC-15)
  - `runAdversarialPass`: different `config.agent` and `config.model` → adversary agent config uses those values, not runConfig.agent (AC-14)

- [ ] Add scoring unit tests for adversarial context to `src/commands/run/scoring.test.ts`.
  Satisfies: AC-8.
  - `buildScoreContext` with `previousStatus: 'adversarial-fail'` + 2 failed tests + diagnosticBranch: output contains both test names and branch name
  - `buildScoreContext` with `previousStatus: 'pass'` + `adversarialResult.outcome: 'pass'` + 3 testFilesAdded: output contains `+3 adversarial tests`
  - `buildScoreContext` with `previousStatus: 'pass'` + `adversarialResult.outcome: 'skip'` + skipReason: output contains `skipped`
  - `buildScoreContext` with `previousStatus: 'pass'` + no `adversarialResult`: output unchanged from pre-Phase-2 (regression guard)

- [ ] Add config validation tests for adversarial config to existing validate/config test files.
  Satisfies: AC-1, AC-9, AC-10.
  - Default config: `config.run.adversarial.enabled === false`
  - `budget: 0` → validation error
  - `timeout: -1` → validation error
  - `test-patterns: []` → validation error
  - Unknown key in adversarial config → warning

- [ ] Add prompt unit test for `generateAdversarialPrompt()`.
  Satisfies: AC-9 (budget in prompt), AC-12 (prompt structure).
  - Output contains the configured budget value
  - Output contains `builderDiff` content
  - Output contains all 9 rule constraint items
  - Output contains `stageResults` when provided; excludes it when null

---

## Backward Compatibility

- [ ] Verify backward compatibility with adversarial disabled.
  Run: `npm test && npx tsc --noEmit`
  Confirm test count ≥ 868; typecheck clean.
  Confirm: with no `adversarial:` key in config, `runConfig.adversarial?.enabled` is `false` (from `DEFAULT_ADVERSARIAL`), the `if (runConfig.adversarial?.enabled === true)` guard in `run/index.ts` never executes, and all existing behavior is identical.
  Satisfies: spec Success Criterion 2.

---

## Verification

- [ ] Run full validation and verify all Phase 2 acceptance criteria.
  ```
  npm test && npx tsc --noEmit && ralph doctor --ci && ralph grade --ci
  ```

  Cross-check each AC from `docs/product-specs/adversarial-generation.md`:
  - AC-1: Opt-in default — `DEFAULT_ADVERSARIAL.enabled === false`; run loop with no adversarial config produces zero adversarial-pass executions
  - AC-2: Adversarial pass on validation success — unit test: pass spawns agent after auto-commit with correct prompt
  - AC-3: File restriction enforcement — unit tests for `enforceFileRestriction()` pass; non-test files reverted, restricted files reverted
  - AC-4: Test deletion guard — unit tests for `enforceTestDeletionGuard()` pass; F020 prevention confirmed
  - AC-5: Passing adversarial tests committed — unit test: outcome='pass', commit B created with only test files
  - AC-6: Failing adversarial tests trigger full revert — unit test: outcome='fail', baseline restored
  - AC-7: Diagnostic branch on failure — unit test: branch `ralph/adversarial/{n}` created; no branch when `diagnostic-branch: false`
  - AC-8: Score context includes adversarial results — scoring tests: failed test names and branch reference present in context
  - AC-9: Budget enforcement — prompt unit test: budget value appears in adversary prompt
  - AC-10: Timeout (fail-open) — unit test: timeout → skip, builder commit preserved
  - AC-11: Simplify mode skip — unit test: `isSimplify=true` + `skip-on-simplify: true` → outcome='skip'
  - AC-12: Dry run shows adversarial prompt — dry-run test: adversarial prompt in output when enabled
  - AC-13: Results tracking — `appendResult({ status: 'adversarial-fail' })` compiles (TypeScript); description includes `[adversary found N bug(s)]`
  - AC-14: Agent independence — unit test: `config.agent: 'amp'` → adversary uses amp, not runConfig.agent
  - AC-15: Auto-commit requirement — unit test: `effectiveAutoCommit: false` → skip + warning
  - AC-16: No-op on empty output — unit test: no test changes → outcome='skip', builder commit preserved

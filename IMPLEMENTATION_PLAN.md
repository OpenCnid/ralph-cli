# Implementation Plan — Trust Calibration Phase 2

Spec: `docs/product-specs/adversarial-generation.md`
Date: 2026-03-13

## Pre-flight
- Regression baseline: 868 tests passing, typecheck clean (0 errors)

---

## Schema & Config (T1–T3)

- [ ] Add `AdversarialConfig` type to `src/config/schema.ts`; add `adversarial` field to `RunConfig` and `RawRalphConfig`
  Add `AdversarialConfig` interface with fields: `enabled: boolean`, `agent: string | null`,
  `model: string | null`, `budget: number`, `timeout: number`, `diagnostic-branch: boolean`,
  `test-patterns: string[]`, `restricted-patterns: string[]`, `skip-on-simplify: boolean`.
  Add `adversarial?: AdversarialConfig | undefined` to `RunConfig`.
  Add `adversarial?: Partial<AdversarialConfig>` to `RawRalphConfig.run` partial block.
  Satisfies: AC-1 (opt-in default), AC-9 (budget config), AC-10 (timeout config),
  AC-11 (skip-on-simplify), AC-14 (agent independence), AC-15 (auto-commit requirement).
  Verify: `npx tsc --noEmit` clean after change.

- [ ] Add `DEFAULT_ADVERSARIAL` to `src/config/defaults.ts`; wire into `DEFAULT_RUN`
  Add `export const DEFAULT_ADVERSARIAL: AdversarialConfig = { enabled: false, agent: null,
  model: null, budget: 5, timeout: 300, 'diagnostic-branch': true, 'test-patterns': [...],
  'restricted-patterns': [...], 'skip-on-simplify': true }` matching spec config section defaults.
  Add `adversarial: DEFAULT_ADVERSARIAL` to `DEFAULT_RUN`.
  Verify: `npx tsc --noEmit` clean. Unit test: load default config, verify `adversarial.enabled === false` (AC-1).

- [ ] Add adversarial config validation to `src/config/validate.ts`
  Add `'adversarial'` to `KNOWN_RUN_KEYS` constant (line 19). Add `KNOWN_ADVERSARIAL_KEYS` constant.
  Add `validateAdversarialConfig()` function called from the `run` block.
  Rules: `budget` must be a positive integer, `timeout` must be a positive integer,
  `test-patterns` must be a non-empty string array, `restricted-patterns` must be a string array,
  `agent`/`model` must be null or non-empty string, `enabled`/`diagnostic-branch`/`skip-on-simplify`
  must be boolean.
  Verify: config validation tests pass (existing + new). `npm test` green.

---

## Results Type (T4–T5)

- [ ] Add `adversarial-fail` to `ResultEntry.status` union and `ScoreContext.previousStatus` union in `src/commands/score/types.ts`
  Change `ResultEntry.status` from `'pass' | 'fail' | 'timeout' | 'discard'` to
  `'pass' | 'fail' | 'timeout' | 'discard' | 'adversarial-fail'`.
  Change `ScoreContext.previousStatus` to include `'adversarial-fail'`.
  Also add optional `adversarialResult` field to `ScoreContext` for the adversarial failure details:
  `adversarialResult?: { failedTests: Array<{name: string; file: string}>; diagnosticBranch: string | null } | undefined`.
  Satisfies: AC-13 (results tracking).
  Verify: `npx tsc --noEmit` clean.

- [ ] Update `appendResult()` in `src/commands/score/results.ts` to accept `adversarial-fail` status; verify `readResults()` is unaffected
  `appendResult()` uses `entry.status` as a string directly — once the type is updated in T4,
  TypeScript will accept `adversarial-fail`. Verify no runtime changes needed.
  `readResults()` casts to `ResultEntry['status']` at line 79 — no change needed since the union now includes the new value.
  Add a unit test: verify `appendResult()` with `status: 'adversarial-fail'` writes correct TSV row.
  Satisfies: AC-13.
  Verify: `npm test` green.

---

## Adversarial Prompt (T6)

- [ ] Add `generateAdversarialPrompt()` to `src/commands/run/prompts.ts`
  Add `ADVERSARIAL_TEMPLATE` constant (the prompt template from the spec verbatim).
  Add function `generateAdversarialPrompt(options: { builderDiff: string; specContent: string; existingTests: string; stageResults: string | null; budget: number; testCommand: string }): string`
  that applies variables to the template.
  For `--dry-run`, `generateAdversarialPrompt` will be called with placeholder values.
  Satisfies: AC-9 (budget in prompt), AC-12 (dry run shows adversarial prompt).
  Verify: unit test — generated prompt contains budget number, builder diff, spec content.
  `npm test` green.

---

## Core Adversarial Module (T7–T9)

- [ ] Create `src/commands/run/adversarial.ts` with `enforceFileRestriction()` and `enforceTestDeletionGuard()`; add `AdversarialResult` to `src/commands/run/types.ts`
  In `run/types.ts`, add:
  ```
  export interface AdversarialResult {
    status: 'pass' | 'fail' | 'skip';
    testsAdded: number;
    failedTests: Array<{ name: string; file: string }>;
    diagnosticBranch: string | null;
    skipReason?: string | undefined;
  }
  ```
  Create `adversarial.ts` with two exported functions:
  - `enforceFileRestriction(testPatterns: string[], restrictedPatterns: string[]): { reverted: string[] }`
    Uses `git diff --name-only HEAD` to find changed files. Reverts non-test, non-restricted files via
    `git checkout HEAD -- {file}`. Removes untracked non-test files. Logs warning if any reverted.
  - `enforceTestDeletionGuard(preSnapshot: string[], preCount: number, testCommand: string): { aborted: boolean; currentCount: number }`
    Checks no files from snapshot were deleted. Runs test command, parses count.
    If count decreased: returns `{ aborted: true }`. Logs warning if aborted.
  Imports from: `config/schema.js`, `utils/output.js` (no new cross-domain imports).
  Uses `execSync` from `node:child_process`, `existsSync` from `node:fs`.
  Satisfies: AC-3 (file restriction enforcement), AC-4 (test deletion guard).
  Verify: `npx tsc --noEmit` clean.

- [ ] Add `pushDiagnosticBranch()` to `src/commands/run/adversarial.ts`
  Function: `pushDiagnosticBranch(iteration: number, failureCount: number, enabled: boolean): string | null`
  If `enabled` is false, returns null immediately (no branch created).
  Otherwise: creates branch `ralph/adversarial/{iteration}` from current HEAD,
  commits adversary test files with message
  `ralph: adversarial tests (iteration {n}, {m} failures)`,
  switches back to original branch.
  Returns branch name on success, null on failure (fail-open).
  Satisfies: AC-7 (diagnostic branch on failure).
  Verify: unit test — with `enabled: false`, no branch created; with `enabled: true`, branch exists.

- [ ] Add `runAdversarialPass()` orchestrator to `src/commands/run/adversarial.ts`
  Function: `runAdversarialPass(options: AdversarialPassOptions): Promise<AdversarialResult>`
  where `AdversarialPassOptions` contains: `config: AdversarialConfig`, `autoCommit: boolean`,
  `simplify: boolean`, `iteration: number`, `runConfig: RunConfig`, `agentOverride: string | undefined`,
  `modelOverride: string | undefined`, `verbose: boolean | undefined`.

  Orchestration (per spec workflow steps 4–11):
  4. If `autoCommit` is false: return `{ status: 'skip', skipReason: 'auto-commit disabled', ... }` + warn (AC-15)
  5. If `config.enabled` is false: return skip
  6. If `simplify && config['skip-on-simplify']`: return skip (AC-11)
  7. Capture pre-adversary state: list test files matching patterns, count tests from last validation output
  8. Call `generateAdversarialPrompt()` with builder diff (from `git diff HEAD^`)
  9. Resolve adversary agent: use `config.agent`/`config.model` or inherit from `runConfig.agent` (AC-14)
  10. Spawn adversary with `config.timeout` (fail-open on timeout/spawn failure — AC-10)
  11. Call `enforceFileRestriction()`
  12. Call `enforceTestDeletionGuard()` — abort + return skip if triggered (AC-4)
  13. Run test command, capture results
  14a. All pass: git add + commit test files as commit B, return `{ status: 'pass', testsAdded: N, ... }` (AC-5)
  14b. Any fail: call `pushDiagnosticBranch()`, revert adversary changes, return `{ status: 'fail', failedTests: [...], diagnosticBranch }` (AC-6, AC-7)
  14c. No test files written (empty result): return `{ status: 'skip', skipReason: 'no tests written', ... }` (AC-16)
  On agent spawn failure or timeout: return `{ status: 'skip', skipReason: 'agent spawn failed/timeout', ... }` (AC-10)
  Satisfies: AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-10, AC-11, AC-14, AC-15, AC-16.
  Verify: `npx tsc --noEmit` clean. Unit tests (from T13) will verify each branch.

---

## Score Context (T10)

- [ ] Add `adversarial-fail` score context variant to `src/commands/run/scoring.ts`
  In `buildScoreContext()`, add handling for `previousStatus === 'adversarial-fail'`:
  ```
  ## Score Context
  ⚠ Previous iteration passed validation but was REVERTED by adversarial testing.
  The adversary found {n} edge case(s) that broke the implementation.
  Failed tests:
    - test: "{name}" (file: {file})
    ...
  Diagnostic branch: {branch}
  Fix these edge cases in your implementation. The adversarial tests will run again.
  ```
  Uses `ctx.adversarialResult` field added in T4.
  Also update the `pass` variant in `buildScoreContext()` to show adversarial test count when
  `ctx.adversarialResult?.status === 'pass'`:
  `Adversarial testing passed: {n} edge-case tests added and passing.`
  And add a skip variant line:
  `Adversarial testing: skipped ({reason}).`
  Satisfies: AC-8 (score context includes adversarial results).
  Verify: unit test — `buildScoreContext` with `previousStatus: 'adversarial-fail'` includes test names and branch. `npm test` green.

---

## Integration (T11–T12)

- [ ] Wire adversarial pass into `src/commands/run/index.ts` (between auto-commit and scoring)
  Import `runAdversarialPass` from `./adversarial.js`.
  After the auto-commit block (after line ~590), before the scoring block (before `if (options.noScore !== true)`),
  insert the adversarial pass:
  ```
  const adversarialResult = await runAdversarialPass({ config: runConfig.adversarial!, autoCommit: effectiveAutoCommit, simplify: options.simplify ?? false, iteration, runConfig, agentOverride: options.agent, modelOverride: options.model, verbose: options.verbose });
  if (adversarialResult.status === 'fail') {
    revertToBaseline(baselineCommit, originalBranch, preAgentUntracked);
    const headAfterRevert = captureShortHead();
    appendResult({ commit: headAfterRevert, iteration, status: 'adversarial-fail', score: null, delta: null, durationS, metrics: '—', description: description + ` [adversary found ${adversarialResult.failedTests.length} bug(s)]` });
    scoreContext = buildScoreContext({ previousStatus: 'adversarial-fail', ..., adversarialResult: { failedTests: adversarialResult.failedTests, diagnosticBranch: adversarialResult.diagnosticBranch } });
    // checkpoint + continue
    continue;
  }
  // On pass: update description to include adversarial test count
  if (adversarialResult.status === 'pass' && adversarialResult.testsAdded > 0) {
    description += ` [+${adversarialResult.testsAdded} adversarial tests]`;
  }
  ```
  Also pass `adversarialResult` through to `buildScoreContext` for pass/skip variants.
  Satisfies: AC-2 (adversarial pass triggered after auto-commit), AC-6 (full revert on failure),
  AC-8 (score context), AC-13 (results logging).
  Verify: `npx tsc --noEmit` clean.

- [ ] Update `--dry-run` in `src/commands/run/index.ts` to print adversarial prompt when enabled
  After the existing dry-run prompt output (around line 301), check if `runConfig.adversarial?.enabled`:
  If true, call `generateAdversarialPrompt()` with placeholder values and print it with
  `output.info('\nAdversarial prompt (template):')` + `output.plain(adversarialPrompt)`.
  Satisfies: AC-12 (dry run shows adversarial prompt).
  Verify: unit test — `--dry-run` with adversarial enabled produces adversarial prompt in output.

- [ ] Update `ARCHITECTURE.md` with new adversarial.ts file in the run domain listing
  Add `adversarial.ts  — Adversarial pass (file restriction, test deletion guard, diagnostic branch, orchestrator)`
  to the run domain in the directory map.
  No new cross-command exceptions (adversarial.ts imports only from config/, utils/, and run/ siblings).

---

## Tests (T13–T14)

- [ ] Write unit tests in `src/commands/run/adversarial.test.ts`
  Tests (per spec Test Plan):
  - `enforceFileRestriction()`: mock `git diff` with test + non-test files → non-test reverted, test kept
  - `enforceFileRestriction()`: restricted patterns (IMPLEMENTATION_PLAN.md, .ralph/) → reverted
  - `enforceFileRestriction()`: only test file changes → no reverts, no warning
  - `enforceTestDeletionGuard()`: deleted test file → abort + warning (AC-4)
  - `enforceTestDeletionGuard()`: decreased test count → abort + warning (AC-4)
  - `enforceTestDeletionGuard()`: added tests only → pass
  - `pushDiagnosticBranch()`: `diagnostic-branch: false` → no branch created (AC-7)
  - `pushDiagnosticBranch()`: `diagnostic-branch: true` → branch created with correct name (AC-7)
  - `runAdversarialPass()`: passing tests → returns pass result, test files preserved (AC-5)
  - `runAdversarialPass()`: failing tests → returns fail result, diagnostic branch created (AC-6, AC-7)
  - `runAdversarialPass()`: agent timeout → returns skip result, builder work preserved (AC-10)
  - `runAdversarialPass()`: agent spawn failure → returns skip result, builder work preserved (AC-10)
  - `runAdversarialPass()`: no test changes → returns skip result (AC-16)
  - `runAdversarialPass()`: auto-commit off → returns skip result with warning (AC-15)
  Also: scoring tests for `buildScoreContext()` with `previousStatus: 'adversarial-fail'` (AC-8)
  Also: config default test — `adversarial.enabled === false` (AC-1)
  Also: config validation tests — budget < 1 rejected, timeout < 1 rejected, empty test-patterns rejected
  Also: `generateAdversarialPrompt()` includes budget number in output (AC-9)
  Also: `generateAdversarialPrompt()` includes stage results when available
  Verify: `npm test` green, test count increases from 868 baseline.

- [ ] Write integration test for adversarial pass scenarios in run loop tests
  In the existing run loop test file (or a new file if it would exceed 500 lines):
  - Full loop: adversarial disabled → identical behavior to pre-adversarial baseline (AC-1, backward-compat)
  - Full loop: adversarial enabled, auto-commit off → warning logged, adversarial skipped (AC-15)
  - Full loop: adversarial enabled, passing tests → tests committed as separate commit (AC-5)
  - Full loop: adversarial enabled, failing tests → full revert to pre-builder baseline (AC-6)
  Verify: `npm test` green.

---

## Backward Compatibility

- [ ] Verify backward compatibility: run full validation with no `adversarial:` config
  Run `npm test && npx tsc --noEmit`.
  Confirm test count ≥ 868 (baseline) and pass rate 100%.
  Confirm typecheck clean.
  Confirm that with `adversarial.enabled: false` (default), no adversarial code path executes in the run loop.
  Compare against regression baseline: 868 tests, 0 typecheck errors.
  Satisfies: Success Criteria #2 (backward compatibility).

---

## Verification

- [ ] Run full validation and verify all Phase 2 acceptance criteria
  Run: `npm test && npx tsc --noEmit`
  Cross-check each AC:
  - AC-1: Opt-in default — unit test: default config has `adversarial.enabled === false`; no adversarial code path in run loop when disabled
  - AC-2: Adversarial pass on validation success — integration test: adversarial enabled, adversary spawned after auto-commit
  - AC-3: File restriction enforcement — unit test: non-test file changes reverted; restricted patterns reverted
  - AC-4: Test deletion guard — unit test: deleted test file → adversarial pass aborted; test count decrease → aborted
  - AC-5: Passing adversarial tests committed — integration test: commit B exists with only test files
  - AC-6: Failing tests trigger full revert — integration test: HEAD matches pre-builder baseline after adversarial failure
  - AC-7: Diagnostic branch on failure — unit test: branch `ralph/adversarial/{n}` created with failing tests when `diagnostic-branch: true`
  - AC-8: Score context includes adversarial results — unit test: `buildScoreContext` output contains test names + branch reference on adversarial-fail
  - AC-9: Budget enforcement — unit test: generated prompt contains configured budget number
  - AC-10: Timeout (fail-open) — unit test: agent timeout → builder's commit preserved, skip result returned
  - AC-11: Simplify mode skip — unit test: `simplify: true` with `skip-on-simplify: true` → adversarial pass skipped
  - AC-12: Dry run shows adversarial prompt — unit test: `--dry-run` with adversarial enabled outputs adversarial prompt template
  - AC-13: Results tracking — unit test: `appendResult()` with `adversarial-fail` writes correct TSV row; description includes `[+N adversarial tests]` on pass
  - AC-14: Agent independence — unit test: `adversarial.agent` config produces correct `resolveAgent` result
  - AC-15: Auto-commit requirement — unit test: auto-commit off + adversarial enabled → warning + skip
  - AC-16: No-op on empty adversary output — unit test: no test file changes → builder commit preserved, no revert

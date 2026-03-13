# Implementation Plan — Trust Calibration Phase 1

Spec: `docs/product-specs/staged-validation.md`
Date: 2026-03-13

## Pre-flight
- [x] No pre-existing validation failures
- Regression baseline: 832 tests passing (36 files), typecheck clean

---

## Schema & Config (F-SV01)

- [x] Add `ValidationStage` to `src/config/schema.ts` and stage validation to `src/config/validate.ts`
  - In `schema.ts`: Add `ValidationStage` interface with fields `name: string`, `command: string`,
    `required: boolean`, `'run-after'?: string | undefined`, `timeout?: number | undefined`.
    Extend `ValidationConfig` with `stages?: ValidationStage[] | undefined`.
    Extend `RawRalphConfig.run.validation` Partial with `stages?: ValidationStage[]`.
  - In `validate.ts`: Add `'stages'` to `KNOWN_RUN_VALIDATION_KEYS`. Add `validateStages()` function
    called when `validation['stages']` is present: verify it is an array; each element has
    `name` (non-empty string), `command` (non-empty string), `required` (boolean); optional
    `run-after` is a string; optional `timeout` is a positive integer. Validate: no duplicate
    `name` values (error), every `run-after` value references an existing stage name (error),
    no circular `run-after` chains (error), empty array `stages: []` is valid (no error).
  - Satisfies: F-SV01, AC-11 (empty stages), config validation tests

---

## Core Implementation

- [x] Create `src/commands/run/stages.ts` — stage type definitions, default synthesis, pipeline executor
  - Export `StageResult` interface: `{ name: string; passed: boolean; exitCode: number;
    output: string; durationMs: number; skipped: boolean }`.
  - Export `synthesizeDefaultStages(testCmd: string | null, typecheckCmd: string | null): ValidationStage[]`:
    returns 0–2 stages from the given commands; `test` stage first (required, 120s timeout),
    `typecheck` stage second (required, 120s timeout); omits stage when its command is null.
  - Export `executeStages(stages: ValidationStage[], cwd?: string): { passed: boolean; stages: StageResult[]; failedStage: string | null; testOutput: string }`:
    runs stages sequentially; for each stage checks `run-after` dependency (skip if predecessor
    failed or was skipped — transitive); executes via `spawnSync('sh', ['-c', cmd], { timeout: N * 1000,
    encoding: 'utf-8' })`; captures stdout+stderr combined; records `durationMs`; stage fails
    if `status !== 0 || signal !== null` or timeout (mark `exitCode: -1`, output includes
    `"timed out after Ns"`); required failure halts pipeline; non-required failure continues;
    sets `testOutput` from stage named `"test"` or `"unit"`, else first stage output, else `""`.
    Returns `{ passed: all required stages passed, stages: StageResult[], failedStage: name of
    first required failed stage or null, testOutput }`.
  - Imports: `spawnSync` from `node:child_process`; `ValidationStage` from `../../config/schema.js`.
    No cross-command imports.
  - Satisfies: F-SV02, F-SV03, AC-1, AC-2, AC-3, AC-4, AC-5, AC-10

---

## Score Types (prerequisite for F-SV04 and F-SV05)

- [x] Update `src/commands/score/types.ts` — add stage fields to `ScoreContext` and `ResultEntry`
  - Add to `ScoreContext`: `failedStage: string | null` and `stageResults: string | null`.
    (`stageResults` is a compact string like `"unit:pass,typecheck:pass,integration:fail"` or null.)
  - Add to `ResultEntry`: `stages?: string | undefined`.
  - Satisfies: F-SV04 (type prereq), F-SV05 (type prereq)

---

## Score Context Enrichment (F-SV04)

- [ ] Update `src/commands/run/scoring.ts` — stage-aware fail message in `buildScoreContext()`
  - In the `previousStatus === 'fail'` branch: if `ctx.stageResults` is non-null and contains
    2+ comma-separated entries, produce stage-aware message:
    `"⚠ Previous iteration FAILED validation at stage \"{failedStage}\" and was reverted.\n"` +
    `"Stage results: {formatted}\nFix the {failedStage} failures. ..."`.
    Format `stageResults` string into `"unit ✓ | typecheck ✓ | integration ✗ (exit 1) | e2e ⊘"`:
    parse `name:status` pairs; `pass` → `✓`, `fail` → `✗`, `skip` → `⊘`. Include exit code
    for failed stages when available (from stageResults; if not available, omit).
    When `stageResults` is null or has < 2 entries, fall back to current v0.5 generic message.
  - All other `buildScoreContext` branches are unchanged.
  - Satisfies: F-SV04, AC-6

---

## Results TSV Enrichment (F-SV05)

- [ ] Update `src/commands/score/results.ts` — add `stages` as 9th TSV column
  - Update `HEADER` constant: append `\tstages` (9th column).
  - Update `appendResult()`: write `entry.stages ?? '—'` as 9th column in the row array.
  - Update `readResults()`: after parsing `description` (which currently joins remaining columns
    with `\t`), parse a fixed 9th column `stages` separately. The current destructure uses
    `...descParts` to capture remaining — change to use fixed column positions:
    `const [commit, iterStr, status, scoreStr, deltaStr, durationStr, metrics, description, stages] = cols`
    so `stages` is the 9th column (index 8), and description is the 8th (index 7). Update returned
    object to include `stages: stages && stages !== '—' ? stages : undefined`.
    Old 8-column rows have `stages === undefined` — parsed correctly.
  - Satisfies: F-SV05, AC-7

---

## Refactor validation.ts (F-SV03 integration)

- [ ] Refactor `src/commands/run/validation.ts` to use the stage pipeline executor
  - Update `ValidationResult` interface: add `stages: StageResult[]` and
    `failedStage: string | null`. Keep `passed` and `testOutput` for backward compat.
  - Import `synthesizeDefaultStages`, `executeStages`, `StageResult` from `./stages.js`.
  - Refactor `runValidation(config)`:
    - If `config.validation.stages` is defined and non-empty, call `executeStages(config.validation.stages)`.
    - Else (no stages or `stages: []`), call `synthesizeDefaultStages(testCmd, typecheckCmd)` then
      `executeStages(synthesized)`.
    - Return `{ passed, testOutput, stages, failedStage }` from `executeStages` result.
  - The flat `spawnSync` logic is replaced by `executeStages` — do NOT preserve the old flat logic
    as a separate code path. The synthesized-stages path through `executeStages` handles it.
  - Satisfies: F-SV03 (integration), AC-1 (default synthesis parity), AC-2, AC-8

---

## Update detect.ts (F-SV06 prereq)

- [ ] Update `src/commands/run/detect.ts` — stage-aware `composeValidateCommand()`
  - Change `composeValidateCommand()` signature to:
    `composeValidateCommand(testCmd: string | null, typecheckCmd: string | null, stages?: ValidationStage[]): string`
  - When `stages` is defined and non-empty: return command chain of stage commands only
    (`stage.command` joined with ` && `). Do NOT append `ralph doctor --ci` or `ralph grade --ci`.
  - When `stages` is undefined or empty: existing behavior unchanged (appends doctor + grade).
  - Import `ValidationStage` from `../../config/schema.js`.
  - Existing call sites in `prompts.ts` that don't pass `stages` continue to work (optional param).
  - Satisfies: F-SV06 (detect side), AC-9 (partial)

---

## Update prompts.ts — stage-aware validate command

- [ ] Update `src/commands/run/prompts.ts` to pass stages to `composeValidateCommand()`
  - In `buildVariables()`, after deriving `testCmd` and `typecheckCmd`, pass
    `config.run?.validation?.stages` as the third argument to `composeValidateCommand()`.
  - This ensures `{validate_command}` in the agent's build prompt reflects explicit stages when
    configured, per the spec's prompt integration requirement.
  - Satisfies: F-SV06 (prompt integration)

---

## Run Loop Wiring + Dry Run Display (F-SV07 + F-SV06)

- [ ] Wire `ValidationResult.stages`/`failedStage` into `run/index.ts` and add dry-run stage display
  - **Dry run (F-SV06):** In the `dryRun === true` block (line ~295): after `output.plain(prompt)`,
    read `config.run?.validation` stages. If explicit stages are configured, print a stage pipeline
    summary table: stage name, command, required flag, timeout. If no stages, print the flat
    validate command. Use `output.plain()` / `output.info()`.
  - **Validation failure path (lines ~509–547):** After `runValidation()`, compute
    `stageResultsStr`: map `validationResult.stages` to `"name:pass|fail|skip"` pairs joined with `,`;
    if `validationResult.stages` is empty, `stageResultsStr = null`.
    Pass `failedStage: validationResult.failedStage, stageResults: stageResultsStr` to
    `buildScoreContext()` at line ~524. Pass `stages: stageResultsStr ?? undefined` to
    `appendResult()` at line ~513.
  - **All other `buildScoreContext` call sites** (lines ~426, ~701, ~771, ~836, ~878, ~933):
    add `failedStage: null, stageResults: null` to the context object (required by updated type).
  - Changes are surgical — only the 7 `buildScoreContext` call sites and the 1 validation `appendResult`
    call need updating. Other `appendResult` calls don't need `stages` (optional field).
  - Satisfies: F-SV06 (dry run display), F-SV07, AC-9

---

## Tests

- [ ] Create `src/commands/run/stages.test.ts` — unit tests for stage executor and default synthesis
  - `synthesizeDefaultStages()`: both commands present → 2 stages with correct name/required/timeout;
    one null → 1 stage; both null → 0 stages.
  - `executeStages([])`: returns `{ passed: true, stages: [], failedStage: null, testOutput: '' }`.
  - `executeStages(stages)` all pass → `{ passed: true, failedStage: null }`.
  - Required stage fails → early termination, `failedStage` set, subsequent stages absent from results.
  - Non-required stage fails → pipeline continues, overall `passed: true`.
  - `run-after` on failed stage → stage skipped with `skipped: true, passed: false`.
  - `run-after` on skipped stage → also skipped (transitive).
  - Stage timeout → `passed: false`, `exitCode: -1`, output contains `"timed out after"`.
  - `testOutput` sourced from `"test"` stage first, `"unit"` stage second, first stage as fallback.
  - Mock `spawnSync` in this test file.
  - Satisfies: F-SV02 unit tests, F-SV03 unit tests, AC-1–AC-5, AC-10

- [ ] Update `src/commands/run/validation.test.ts` — adapt existing assertions for new fields
  - The existing `toEqual({ passed: true, testOutput: '' })` assertions check exact equality and
    will fail once `ValidationResult` gains `stages` and `failedStage`. Update each such assertion
    to use `expect.objectContaining({ passed: ..., testOutput: ... })` for the v0.5 behavioral
    checks. Behavioral results (`passed`, `testOutput`) must match v0.5 exactly — this is what
    AC-8 verifies. No behavioral test logic changes.
  - Satisfies: AC-8 (backward compat verification)

- [ ] Add tests to `src/commands/run/scoring.test.ts` — stage-aware score context
  - `buildScoreContext()` with `failedStage: 'integration'` and `stageResults: 'unit:pass,typecheck:pass,integration:fail'`
    → output contains `'FAILED validation at stage "integration"'` and `'unit ✓'` and `'integration ✗'`.
  - `buildScoreContext()` with `failedStage: null, stageResults: null` → v0.5 generic message
    (`'FAILED validation'` without stage detail).
  - `buildScoreContext()` with single-entry `stageResults: 'test:fail'` → generic message (< 2 stages).
  - Satisfies: F-SV04 tests, AC-6

- [ ] Add tests to `src/commands/score/results.test.ts` — 9th column TSV handling
  - `appendResult()` with `stages: 'unit:pass,integration:fail'` → written row has 9 tab-separated
    columns, 9th is `'unit:pass,integration:fail'`.
  - `appendResult()` without `stages` → written row has `'—'` as 9th column.
  - `readResults()` parsing 8-column TSV → `stages` field is `undefined`.
  - `readResults()` parsing 9-column TSV → `stages` field populated correctly.
  - Header written by `appendResult` on file creation includes `stages` as 9th column.
  - Satisfies: F-SV05 tests, AC-7

- [ ] Add config validation tests for stages in `src/config/validate.test.ts`
  - Duplicate stage names → `errors` contains message about duplicate names.
  - `run-after` referencing nonexistent stage → error.
  - Circular `run-after` (A → B → A) → error.
  - `stages: []` → no error (valid).
  - Valid stages array with all optional fields → no errors.
  - Satisfies: F-SV01 validation tests

---

## Backward Compatibility

- [ ] Verify backward compatibility
  - Run `npm test` with the full test suite. Confirm 832+ tests pass.
  - Run `npx tsc --noEmit`. Confirm clean.
  - Manually confirm: with no `stages:` config and `test-command: "npm test"` +
    `typecheck-command: "npx tsc --noEmit"`, `runValidation()` returns `passed` and `testOutput`
    values identical to v0.5. Verify via the updated `validation.test.ts` assertions.
  - Compare test count against pre-flight baseline (832). New tests should increase this number.
  - Satisfies: AC-8

---

## Verification

- [ ] Run full validation and verify all Phase 1 acceptance criteria

  Run: `npm test && npx tsc --noEmit`

  Cross-check each AC:
  - AC-1: Default stage synthesis — given `test-command` + `typecheck-command` with no `stages:`,
    `runValidation()` returns 2 stages (`test`, `typecheck`), both required, 120s timeout.
    Verify via `stages.test.ts` and `validation.test.ts`.
  - AC-2: Custom stage pipeline — given explicit `stages:` config, stages execute in declared order
    respecting `required`, `run-after`, `timeout`. Verify via `stages.test.ts`.
  - AC-3: Dependency skipping — `unit` fails → `integration` (run-after: unit) is skipped with
    `skipped: true`. Verify via `stages.test.ts`.
  - AC-4: Early termination — required stage fails → subsequent stages not executed, `failedStage`
    is set. Verify via `stages.test.ts`.
  - AC-5: Non-required failure — `required: false` stage fails → pipeline continues, `passed: true`.
    Verify via `stages.test.ts`.
  - AC-6: Score context stage detail — `buildScoreContext()` with 2+ stages produces stage-aware
    failure message with symbols. Verify via `scoring.test.ts` additions.
  - AC-7: Results TSV enrichment — `appendResult()` writes 9th column; `readResults()` handles
    8-column and 9-column rows. Verify via `results.test.ts` additions.
  - AC-8: Backward compatibility — all pre-existing `validation.test.ts` behavioral checks pass.
    Test count ≥ 832. Typecheck clean.
  - AC-9: Dry run stage display — `ralph run --dry-run` with explicit stages prints stage table;
    with no stages prints flat validate command. Verify manually.
  - AC-10: Stage timeout — timed-out stage has `exitCode: -1`, output contains `"timed out after"`.
    Verify via `stages.test.ts`.
  - AC-11: Empty stages array — `stages: []` in config triggers default synthesis. Verify via
    `stages.test.ts` (empty input) and config validation test.

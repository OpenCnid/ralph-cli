# Spec: Staged Validation

**Version:** 0.6.0
**Status:** Hardened Draft
**Date:** 2026-03-13
**Roadmap:** Trust Calibration Phase 1
**Revision:** R1 — pre-implementation hardening (see `staged-validation-revision-analysis.md`)

---

## Problem Statement

Ralph's validation pipeline is flat. `runValidation()` runs two commands sequentially: `test-command` and `typecheck-command`. The result is binary — pass or fail. The run loop knows *that* validation failed but not *where*.

This creates three quantifiable problems:

1. **Blind composition failures.** Unit tests pass, integration tests break. Ralph can't distinguish the two. The agent receives "validation failed" with no signal about which command broke. In projects with both unit and integration tests, this wastes 1-2 iterations per failure as the agent guesses what to fix. At 3-5 minutes per iteration, that's 6-10 minutes of wasted compute per validation failure.

2. **Coarse score context.** The score context in build prompts says "Previous iteration FAILED validation and was reverted." (`scoring.ts:78`). Not "Previous iteration passed unit tests but failed integration tests." The agent has no signal to scope its fix, leading to shotgun debugging.

3. **No stage-level metrics.** Calibration tracking (Phase 3) needs per-stage pass/fail data for trust analysis. The only granularity available today is iteration-level pass/fail — too coarse for per-command reliability measurement.

**Root cause:** `runValidation()` returns `{ passed: boolean, testOutput: string }` — a single boolean for the entire pipeline. `buildScoreContext()` has no per-stage data to report. The fix requires decomposing validation into named stages with individual results.

**Note on doctor/grade:** `composeValidateCommand()` in `detect.ts` appends `ralph doctor --ci && ralph grade --ci` to the validate command shown in prompts. However, `runValidation()` does NOT execute doctor/grade — the agent runs them as part of its workflow, and the run loop validates only test + typecheck. This is intentional: doctor and grade are quality tools, not validation gates. Staged validation preserves this distinction.

---

## Definitions

- **Stage:** A named shell command executed as one step in the validation pipeline. Has an exit code, captured output, duration, and pass/fail status.
- **Stage pipeline:** The ordered list of stages executed by `runValidation()`. Stages run sequentially in declared order.
- **Required stage:** A stage where failure halts the pipeline and triggers revert. `required: true` in config.
- **Informational stage:** A stage where failure is recorded but does not halt the pipeline or trigger revert. `required: false` in config.
- **Default stages:** The stages synthesized automatically when no explicit `stages:` config exists. Matches v0.5 behavior: `test` (from `test-command`) and `typecheck` (from `typecheck-command`).
- **Stage dependency:** A `run-after` relationship where a stage only executes if the named prerequisite stage passed. Only single-predecessor dependencies are supported in v0.6.

---

## Design Principles

1. **Backward compatibility first.** Projects with no `stages:` config must produce identical results to v0.5. Zero behavioral changes for existing users.
2. **Fail fast, report precisely.** Stop on the first required failure. Report exactly which stage failed and which passed.
3. **No hidden behavioral changes.** Default stages are `test` and `typecheck` only — matching what `runValidation()` actually executes in v0.5. Doctor/grade are NOT added as default stages.
4. **Simple types, rich context.** The `StageResult` captures everything. No separate "detailed" vs. "summary" result types.

---

## Design

### Validation Stages

Replace the two sequential commands in `runValidation()` with an ordered list of named stages. Each stage has:

- **name** — identifier used in score context, results, and logging
- **command** — shell command to run
- **required** — if `true`, stage failure halts pipeline and triggers revert. If `false`, failure is recorded but doesn't block
- **run-after** — optional single dependency. Stage only runs if the named prerequisite passed. Only one predecessor is supported; for multi-dependency, chain stages linearly.
- **timeout** — per-stage timeout in seconds. Default: 120. Timed-out stages are marked as failed (not skipped).

### Default Stages

When no explicit `stages:` config exists, Ralph synthesizes stages from existing config:

| Stage | Command | Required | Source |
|-------|---------|----------|--------|
| `test` | Auto-detected or `validation.test-command` | `true` | `detect.ts` |
| `typecheck` | Auto-detected or `validation.typecheck-command` | `true` | `detect.ts` |

This preserves backward compatibility: projects with no `stages:` config get identical behavior to v0.5. If `test-command` is null (no test command detected), the `test` stage is omitted. Same for `typecheck`.

Doctor and grade are NOT default stages. They remain in the prompt's validate command string for the agent to run. The run loop does not execute them as validation gates.

### Config Extension

```yaml
validation:
  test-command: npm test           # existing (unchanged)
  typecheck-command: npx tsc --noEmit  # existing (unchanged)
  stages:                          # NEW: explicit stage pipeline
    - name: unit
      command: npm test
      required: true
      timeout: 120
    - name: typecheck
      command: npx tsc --noEmit
      required: true
      timeout: 60
    - name: integration
      command: npm run test:integration
      required: true
      run-after: unit
      timeout: 180
    - name: e2e
      command: npm run test:e2e
      required: false              # informational — doesn't block
      run-after: integration
      timeout: 300
```

When `stages:` is present, `test-command` and `typecheck-command` are ignored. The stage pipeline replaces them entirely.

When `stages:` is an empty array (`stages: []`), treat it as "no stages configured" and fall back to default synthesis from `test-command`/`typecheck-command`.

### Stage Execution

Stages run in declared order. For each stage:

1. Check `run-after` dependency — skip (with `skipped: true`) if prerequisite failed or was skipped
2. Execute command via `spawnSync('sh', ['-c', command])` with per-stage timeout (default: 120 seconds)
3. Capture exit code, stdout, and stderr (combined)
4. Record result: `{ name, passed, exitCode, output, durationMs, skipped }`
5. If `required: true` and stage failed (exit code ≠ 0 or timeout) — stop pipeline, mark validation as failed
6. If `required: false` and stage failed — record failure, continue to next stage

### Validation Result Type

```typescript
interface StageResult {
  name: string;
  passed: boolean;
  exitCode: number;
  output: string;       // captured stdout+stderr, always populated
  durationMs: number;
  skipped: boolean;      // true if run-after dependency failed/skipped
}

interface ValidationResult {
  passed: boolean;           // all required stages passed
  stages: StageResult[];     // per-stage results, empty array for v0.5-compat (no stages)
  failedStage: string | null; // name of first required stage that failed, null if all passed
  testOutput: string;        // backward-compat: output from stage named "test" or "unit";
                             // if neither exists, output from first stage;
                             // if no stages ran, empty string
}
```

The `stages` field is always present. For default-synthesized stages, it contains the 1-2 stages that ran. For non-staged configs (both commands null), it is an empty array and `passed` is `true` — matching v0.5 "skip validation" behavior.

### Score Context Enhancement

The build prompt's `{score_context}` section gets stage-level detail when stages are available.

**Current (v0.5) — unchanged when no stages ran:**
```
⚠ Previous iteration FAILED validation and was reverted.
Ensure all tests pass and typecheck succeeds.
```

**New (v0.6) — when stages are available:**
```
⚠ Previous iteration FAILED validation at stage "integration" and was reverted.
Stage results: unit ✓ | typecheck ✓ | integration ✗ (exit 1) | e2e ⊘
Fix the integration test failures. Unit tests and typecheck are passing — do not change them.
```

Where `✓` = passed, `✗` = failed (with exit code), `⊘` = skipped (dependency not met).

When there is only one stage or no stages, fall back to the v0.5 generic message. Stage detail is only shown when `stages.length >= 2`.

**ScoreContext type change:**

```typescript
// In score/types.ts — add to existing ScoreContext:
interface ScoreContext {
  // ... existing fields unchanged ...
  failedStage: string | null;     // NEW: name of failed stage, null if passed or no stages
  stageResults: string | null;    // NEW: "unit:pass,typecheck:pass,integration:fail" or null
}
```

### Prompt Integration

`composeValidateCommand()` behavior:
- **No explicit stages:** Unchanged. Returns `test && typecheck && doctor --ci && grade --ci`.
- **Explicit stages:** Returns a command chain of stage commands: `npm test && npx tsc --noEmit && npm run test:integration`. Does NOT include doctor/grade (user opted into custom pipeline).

The prompt templates use `{validate_command}` which calls `composeValidateCommand()`. No template changes needed.

### Results Enrichment

`results.tsv` gains an optional 9th column `stages` recording the stage pipeline result:

```
commit	iteration	status	score	delta	duration_s	metrics	description	stages
a1b2c3d	5	fail	—	—	45	—	implement auth	unit:pass,typecheck:pass,integration:fail
```

Format: `name:status` pairs, comma-separated. Status values: `pass`, `fail`, `skip`.

Existing results without a `stages` column continue to parse correctly — `readResults()` treats missing 9th column as undefined.

---

## Architecture

### Changed Files

| File | Change |
|------|--------|
| `src/config/schema.ts` | Add `ValidationStage` interface. Extend `ValidationConfig` with optional `stages: ValidationStage[]`. Extend `RawRalphConfig` validation section with `stages`. |
| `src/config/defaults.ts` | No change needed — stages default is `undefined` (synthesized at runtime). |
| `src/config/validate.ts` | Add validation for `stages` config: unique names, valid `run-after` references, no circular deps. |
| `src/commands/run/validation.ts` | Refactor `runValidation()` to detect stages config → if present, run stage pipeline; if absent, run current flat logic. **Do not create a parallel function.** |
| `src/commands/run/detect.ts` | Update `composeValidateCommand()` to accept optional stages array. Add `synthesizeDefaultStages()` function. |
| `src/commands/run/scoring.ts` | Update `buildScoreContext()` to accept and render `failedStage` and `stageResults`. |
| `src/commands/run/index.ts` | Wire `StageResult[]` from `ValidationResult` into score context and results logging. ~30 lines of changes. |
| `src/commands/score/results.ts` | Add optional 9th column (`stages`) to TSV write. Update `readResults()` to handle missing column. |
| `src/commands/score/types.ts` | Add `failedStage` and `stageResults` to `ScoreContext`. Add optional `stages` to `ResultEntry`. |

### New Files

| File | Responsibility |
|------|----------------|
| `src/commands/run/stages.ts` | `executeStages()`: stage pipeline executor, dependency resolution, result aggregation, `synthesizeDefaultStages()`. |
| `src/commands/run/stages.test.ts` | Unit tests for stage execution, dependency resolution, timeout, early termination, default synthesis. |

### Layer Rules

- `stages.ts` is in the `run` domain. Imports from `config/` and `utils/` only.
- No new cross-command imports.
- `stages.ts` exports `executeStages()` and `synthesizeDefaultStages()`, consumed by `validation.ts`.

### Migration

No data migration needed. The change is additive:
- `ValidationResult` gains fields — existing destructuring `{ passed, testOutput }` still works
- `ResultEntry` gains optional field — existing TSV files parse correctly (9th column is missing = undefined)
- `ScoreContext` gains fields — callers must pass them (all callers are in `run/index.ts`, updated in this spec)

---

## Features

### F-SV01: Stage Config Schema
**Goal:** Define the `ValidationStage` type and extend `ValidationConfig` to accept an optional `stages` array.
**One-time.**
**Procedure:** Add types to `schema.ts`, add raw config parsing in `RawRalphConfig`, add validation in `validate.ts` (unique names, valid `run-after` references, no cycles).
**Edge cases:** Empty `stages: []` → treated as no-stages, fall back to defaults. Duplicate stage names → validation error. `run-after` referencing nonexistent stage → validation error. `run-after` creating a cycle → validation error.
**Delegation safety:** Low risk — type definitions only, no runtime behavior.
**Success criteria:**
- ⚙️ `ValidationStage` interface exists with `name`, `command`, `required`, `run-after?`, `timeout?` fields
- ⚙️ `ValidationConfig` has optional `stages` field
- ⚙️ Config validation rejects duplicate names, invalid `run-after`, cycles
- ⚙️ Config validation accepts `stages: []` as valid (treated as no-stages)

### F-SV02: Default Stage Synthesis
**Goal:** When no `stages:` config exists, synthesize 0-2 stages from `test-command` and `typecheck-command`.
**One-time.**
**Procedure:** Add `synthesizeDefaultStages()` to `stages.ts`. Called by `runValidation()` when `config.validation.stages` is undefined or empty.
**Edge cases:** Both commands null → 0 stages, validation passes immediately. One command null → 1 stage. Both present → 2 stages.
**Delegation safety:** Medium risk — must match v0.5 behavior exactly.
**Success criteria:**
- ✅ Given `test-command: "npm test"` and `typecheck-command: "npx tsc --noEmit"` with no `stages:`, synthesizes 2 stages: `test` (required, 120s timeout) and `typecheck` (required, 120s timeout)
- ✅ Given both commands null with no `stages:`, synthesizes 0 stages and `runValidation()` returns `{ passed: true, testOutput: '', stages: [], failedStage: null }`
- 📏 v0.5 backward-compat: `ValidationResult.passed` and `testOutput` are identical to v0.5 for all non-staged configs

### F-SV03: Stage Pipeline Executor
**Goal:** Execute stages in order with dependency checking, timeout enforcement, and early termination on required failures.
**One-time.**
**Procedure:** Add `executeStages()` to `stages.ts`. Refactor `runValidation()` to call it. Preserve current flat logic as the code path for synthesized default stages.
**Edge cases:**
- Stage with `run-after` dependency on a failed stage → skipped with `skipped: true`
- Stage with `run-after` dependency on a skipped stage → also skipped
- Required stage fails → all subsequent stages not executed
- Non-required stage fails → pipeline continues
- Stage timeout → treated as failure (exit code -1, output includes "timed out after Xs")
- All stages pass → `ValidationResult.passed = true`
**Delegation safety:** High risk — core validation logic. Must not break existing test suites.
**Success criteria:**
- ✅ Stages execute in declared order
- ✅ `run-after` dependency on failed stage → skip
- ✅ `run-after` dependency on skipped stage → skip (transitive)
- ✅ Required failure → early termination
- ✅ Non-required failure → continue
- ✅ Timeout → failed with descriptive output
- ⚙️ Each stage captured: `{ name, passed, exitCode, output, durationMs, skipped }`

### F-SV04: Score Context Enrichment
**Goal:** When validation fails with stage data, `buildScoreContext()` names the failed stage and shows per-stage results.
**One-time.**
**Procedure:** Add `failedStage` and `stageResults` to `ScoreContext`. Update `buildScoreContext()` `fail` branch to use them when available.
**Edge cases:**
- `stageResults` is null (no stages, v0.5-compat) → fall back to generic "FAILED validation" message
- `stageResults` present but only 1 stage → generic message (stage detail not useful with 1 stage)
- `stageResults` present with 2+ stages → stage-aware message
**Delegation safety:** Medium risk — prompt content changes affect agent behavior.
**Success criteria:**
- ✅ `buildScoreContext()` with `failedStage="integration"` and `stageResults="unit:pass,typecheck:pass,integration:fail"` produces output containing "FAILED validation at stage \"integration\"" and "unit ✓ | typecheck ✓ | integration ✗"
- ✅ `buildScoreContext()` with `failedStage=null` and `stageResults=null` produces v0.5 generic message
- 📏 Agent given stage-aware context scopes its fix to the failed stage (manual verification)

### F-SV05: Results TSV Enrichment
**Goal:** `appendResult()` writes optional `stages` column. `readResults()` handles missing column.
**One-time.**
**Procedure:** Add optional `stages` to `ResultEntry`. Update `appendResult()` to write 9th column. Update `readResults()` to parse optional 9th column. Update TSV header.
**Edge cases:**
- Old TSV files with 8 columns → `stages` field is undefined in parsed result
- New writes with no stage data → `stages` column is empty or "—"
**Delegation safety:** Low risk — additive column, backward-compat parsing.
**Success criteria:**
- ⚙️ `appendResult()` with `stages: "unit:pass,integration:fail"` writes 9-column row
- ⚙️ `readResults()` parses 8-column (old) and 9-column (new) rows correctly
- ⚙️ TSV header includes `stages` as 9th column

### F-SV06: Dry Run Stage Display
**Goal:** `ralph run --dry-run` prints the stage pipeline that would execute.
**One-time.**
**Procedure:** In `runCommand()` dry-run path, after printing prompt, print stage pipeline summary.
**Edge cases:** No stages configured → print "Validation: test-command && typecheck-command (flat, no stages)". Explicit stages → print table of stages with name, command, required, timeout.
**Delegation safety:** Low risk — display only, no side effects.
**Success criteria:**
- ✅ `ralph run --dry-run` with explicit stages prints stage names, commands, required status, and timeouts
- ✅ `ralph run --dry-run` with no stages prints current flat validate command

### F-SV07: Run Loop Wiring
**Goal:** Wire `ValidationResult.stages` and `failedStage` from `runValidation()` into `buildScoreContext()` and `appendResult()` in the run loop.
**One-time.**
**Procedure:** In `run/index.ts`, after `runValidation()` call: extract `stageResults` string from `StageResult[]`, pass `failedStage` and `stageResults` to score context, pass `stages` string to `appendResult()`.
**Edge cases:** `ValidationResult.stages` is empty → pass null for `failedStage` and `stageResults`
**Delegation safety:** Medium risk — touching the 1051-line `index.ts`. Changes must be minimal and surgical.
**Success criteria:**
- ⚙️ Score context for failed validation includes `failedStage` and `stageResults` when available
- ⚙️ Results TSV includes `stages` column when stage data is available
- 📏 Run loop behavior unchanged for non-staged configs (backward compat)

---

## Implementation Sequence

| Order | Feature | Depends On | Estimated Effort |
|-------|---------|------------|-----------------|
| 1 | F-SV01: Stage Config Schema | — | Small (types + validation) |
| 2 | F-SV02: Default Stage Synthesis | F-SV01 | Small (1 function + tests) |
| 3 | F-SV03: Stage Pipeline Executor | F-SV01, F-SV02 | Medium (core logic + tests) |
| 4 | F-SV04: Score Context Enrichment | F-SV01 (types only) | Small (1 function update + tests) |
| 5 | F-SV05: Results TSV Enrichment | F-SV01 (types only) | Small (2 function updates + tests) |
| 6 | F-SV06: Dry Run Stage Display | F-SV02, F-SV03 | Small (display logic) |
| 7 | F-SV07: Run Loop Wiring | F-SV03, F-SV04, F-SV05 | Medium (surgical edits to index.ts) |

F-SV04 and F-SV05 can be implemented in parallel after F-SV01. F-SV07 is the integration step that ties everything together.

---

## Feature Tracker

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| F-SV01 | Stage Config Schema | ❌ | Types + validation |
| F-SV02 | Default Stage Synthesis | ❌ | Depends on F-SV01 |
| F-SV03 | Stage Pipeline Executor | ❌ | Core implementation |
| F-SV04 | Score Context Enrichment | ❌ | Can parallel with F-SV05 |
| F-SV05 | Results TSV Enrichment | ❌ | Can parallel with F-SV04 |
| F-SV06 | Dry Run Stage Display | ❌ | Depends on F-SV02, F-SV03 |
| F-SV07 | Run Loop Wiring | ❌ | Integration step, last |

---

## Acceptance Criteria

### AC-1: Default stage synthesis
Given a project with `validation.test-command: "npm test"` and `validation.typecheck-command: "npx tsc --noEmit"` and no `stages:` config, `runValidation()` produces a `ValidationResult` with 2 stages: `test` (required, 120s timeout) and `typecheck` (required, 120s timeout). `passed` and `testOutput` match v0.5 output.

### AC-2: Custom stage pipeline
Given a config with explicit `stages:` array, `runValidation()` executes stages in declared order and respects `required`, `run-after`, and `timeout` settings.

### AC-3: Dependency skipping
Given stages `[unit, integration]` where integration has `run-after: unit`, if unit fails then integration is skipped with `skipped: true` and `passed: false`.

### AC-4: Early termination
Given stages `[unit, typecheck, doctor]` where unit is `required: true` and fails, typecheck and doctor are not executed. `ValidationResult.failedStage` is `"unit"`.

### AC-5: Non-required stage failure
Given a stage with `required: false` that fails, validation overall still passes (assuming all required stages pass). The failed stage appears in `stages` with `passed: false`.

### AC-6: Score context includes stage detail
When validation fails with 2+ stages, `buildScoreContext()` produces a string that names the failed stage and shows per-stage pass/fail status with symbols (✓/✗/⊘). When `stageResults` is null, produces v0.5 generic message.

### AC-7: Results TSV enrichment
`appendResult()` accepts an optional `stages` string and writes it as the 9th TSV column. `readResults()` parses both 8-column (old) and 9-column (new) rows without error. Missing `stages` column is undefined in the parsed result.

### AC-8: Backward compatibility (regression criterion)
Projects with no `stages:` config and existing `test-command`/`typecheck-command` settings produce identical validation behavior to v0.5. **Verification:** Run the existing `validation.test.ts` test suite without modification — all tests must pass. Additionally, `ValidationResult.passed` and `testOutput` values match v0.5 for all existing test cases.

### AC-9: Dry run shows stages
`ralph run --dry-run` prints the stage pipeline that would execute, including synthesized defaults. With no stages config, prints the current flat validate command.

### AC-10: Stage timeout
Each stage respects a per-stage timeout (default 120 seconds, configurable via `timeout` field in stage config). Timed-out stages are marked as failed with `exitCode: -1` and output containing "timed out after {N}s".

### AC-11: Empty stages array
Given `stages: []` in config, `runValidation()` falls back to default stage synthesis from `test-command`/`typecheck-command`. Does not error.

---

## Compatibility Notes

**For consumers of `runValidation()` (run/index.ts):**
- `ValidationResult` adds 2 fields: `stages: StageResult[]` and `failedStage: string | null`
- Existing destructuring `{ passed, testOutput }` continues to work
- New fields must be wired into `buildScoreContext()` and `appendResult()` calls

**For consumers of results.tsv (custom scripts):**
- New 9th column `stages` appended to each row
- Old TSV files (8 columns) parse correctly — missing column is treated as absent
- TSV header adds `stages` as final column

**For consumers of `ScoreContext` (scoring.ts, prompts.ts):**
- 2 new fields: `failedStage: string | null` and `stageResults: string | null`
- All `buildScoreContext()` call sites (in `run/index.ts`) must pass these fields

**For custom prompt templates:**
- `{validate_command}` continues to work — no template changes required
- With explicit stages, `{validate_command}` returns command chain of stage commands (excludes doctor/grade)
- Without explicit stages, `{validate_command}` returns v0.5 composed command (includes doctor/grade)

---

## Non-Goals

- **Parallel stage execution.** Stages run sequentially. Parallelism adds complexity without clear value when stages often depend on prior stages.
- **Stage-level scoring.** Stages produce pass/fail. The score comes from the scorer (unchanged). Stages inform the score *context*, not the score itself.
- **Custom stage types.** Stages are shell commands. No built-in stage types beyond command execution.
- **Multi-predecessor dependencies.** `run-after` accepts exactly one stage name. For multi-dependency, chain stages linearly (A → B → C, where C depends on both A and B by depending on B which depends on A).

---

## Test Plan

### Unit Tests (stages.test.ts)

- `synthesizeDefaultStages()`: both commands present → 2 stages; one null → 1 stage; both null → 0 stages
- `executeStages()`: all pass → `passed: true`, `failedStage: null`
- `executeStages()`: required stage fails → early termination, `failedStage` set, subsequent stages not in results
- `executeStages()`: non-required stage fails → pipeline continues, `passed: true`
- `executeStages()`: `run-after` on failed stage → skipped
- `executeStages()`: `run-after` on skipped stage → also skipped (transitive)
- `executeStages()`: stage timeout → `passed: false`, `exitCode: -1`, output contains timeout message
- `executeStages()`: empty stages array → `{ passed: true, stages: [], failedStage: null, testOutput: '' }`

### Unit Tests (scoring.test.ts additions)

- `buildScoreContext()` with `failedStage` and `stageResults` → stage-aware output
- `buildScoreContext()` with `stageResults: null` → v0.5 generic output
- `buildScoreContext()` with 1 stage in `stageResults` → generic output (stage detail not shown for single stage)

### Unit Tests (results.test.ts additions)

- `appendResult()` with `stages` string → 9-column row
- `appendResult()` without `stages` → 8-column row (backward compat)
- `readResults()` parsing 8-column file → `stages` is undefined
- `readResults()` parsing 9-column file → `stages` populated

### Unit Tests (validation.test.ts verification)

- All existing tests pass unchanged (AC-8 regression criterion)

### Integration Tests

- Full run loop with staged validation: fail at stage 2, verify revert, verify score context mentions stage name
- Full run loop with no `stages:` config: verify identical behavior to v0.5

### Config Validation Tests

- Duplicate stage names → error
- `run-after` referencing nonexistent stage → error
- Circular `run-after` → error
- `stages: []` → no error, falls back to defaults

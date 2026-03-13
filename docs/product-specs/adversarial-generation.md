# Spec: Adversarial Generation

**Version:** 0.6.1
**Status:** Draft (Revised)
**Date:** 2026-03-13
**Roadmap:** Trust Calibration Phase 2
**Previous Version:** 0.6.0
**Revision Trigger:** Staged validation architecture dependency, failure catalog patterns (F002, F012, F013, F014, F020), unresolved open questions

---

## Changelog (v0.6.0 → v0.6.1)

| Section | Change | Reason |
|---------|--------|--------|
| Problem Statement | Added quantified impact and unified root cause | Meta-prompt requirement; lacked metrics |
| Design Principles | NEW section | Missing from v0.6.0 |
| Definitions | NEW section | Missing from v0.6.0; term ambiguity risk |
| Architecture | Updated for staged validation dependency; added migration subsection | Phase 1 changed validation shape |
| Workflow | Added file restriction enforcement, test deletion guard, diagnostic branch steps | Failure catalog patterns F012, F014, F020 |
| Adversary Prompt | Strengthened constraints; added failure-pattern-specific rules | F002, F012, F014 exposure |
| Config | Added `diagnostic-branch`, `restricted-patterns`; removed ambiguous `trigger` field | Open question Q1 resolved; clarity |
| Features | Split into 16 features (AC-1 through AC-16); added F-pattern features | Gap in failure-pattern coverage |
| Implementation Sequence | NEW section with 14 tasks | Missing from v0.6.0 |
| Feature Tracker | NEW section | Missing from v0.6.0 |
| Compatibility Notes | NEW section | Required for revisions |
| Open Questions | All 3 RESOLVED; 0 remaining | Decision needed before implementation |
| Non-Goals | Unchanged | Still valid |

---

## Problem Statement

Ralph's build loop trusts the builder agent's own tests. The agent writes code, writes tests for that code, and ralph checks if those tests pass. This is circular: the same model that might introduce a subtle bug also writes the tests that fail to catch it.

`ralph review` adds a post-hoc check, but it's *review* — it reads diffs and comments. It doesn't generate executable artifacts. It can say "this might break under concurrent access" but it can't *prove* it by writing a test that demonstrates the failure.

When AI agents produce consistently high-quality output, the remaining bugs are the subtle ones — edge cases, race conditions, boundary violations, malformed inputs. These are precisely the cases the builder agent doesn't think to test because it's "confident" in its approach.

**Quantified impact:** In Ralph Loop runs across 4 projects (OpenKanban, StockWatch, OpenPiece, Ripcord), builder-authored tests caught 0 of 7 post-merge integration bugs. All 7 passed the builder's test suite. The bugs were found by manual testing or production failures. Adversarial generation targets exactly this gap.

**Unified root cause:** Ralph v0.5 treats validation as a binary gate controlled by artifacts the builder itself produces. There is no independent verification of test quality or coverage adequacy. The builder's confidence is uncalibrated — it believes its tests are sufficient because nothing tells it otherwise.

**The missing primitive:** after the builder agent's work passes validation, spawn a second agent whose only job is to *break* the first agent's code by generating adversarial test cases. This second agent is mechanically constrained — it cannot modify implementation, cannot delete tests, and cannot claim success without executable proof.

---

## Design Principles

1. **Mechanical enforcement over prompt trust.** Every constraint on the adversary (file restriction, test deletion, implementation modification) is enforced by code, not just by prompt instructions. Prompts guide intent; code enforces boundaries.

2. **Fail-open on infrastructure errors.** If the adversary agent fails to spawn, times out, or encounters an infrastructure error, the builder's work is kept. The adversarial pass is a quality bonus, not a blocking gate. Only a genuine test failure triggers revert.

3. **Independence by default.** The adversary agent can be a different CLI, different model, or different configuration from the builder. Cross-model verification is more valuable than same-model verification.

4. **No implicit state changes.** The adversarial pass does not modify the plan, the score, or any file outside test patterns. Its only outputs are: test files (committed or reverted) and a result record.

5. **Debuggability over cleanliness.** When adversarial tests expose a bug, the failing tests are preserved on a diagnostic branch. Silently discarding failure evidence makes debugging harder.

---

## Definitions

- **Adversary:** A second agent invocation spawned by ralph after the builder's work passes validation. The adversary's sole purpose is to write tests that expose edge cases in the builder's implementation.
- **Builder:** The primary agent invocation that implements tasks from the plan. Existing term from `run/index.ts`.
- **Adversarial pass:** The complete sequence: prompt generation → agent spawn → file restriction → test execution → commit or revert. One adversarial pass runs per iteration.
- **Adversarial test:** A test written by the adversary agent. Must be in a file matching `test-patterns` config. Subject to budget constraint.
- **File restriction:** Mechanical enforcement that reverts any adversary changes to files not matching `test-patterns`. Applied via `git diff` analysis after the adversary runs.
- **Test deletion guard:** Mechanical check that verifies no existing test files were deleted and no existing test cases were removed by the adversary. Uses pre-adversary test count as baseline.
- **Diagnostic branch:** A git branch (`ralph/adversarial/{iteration}`) where failing adversarial tests are pushed for inspection before the main branch is reverted.
- **Budget:** Maximum number of test cases the adversary is instructed to write per iteration. Enforced via prompt, not post-hoc counting. Default: 5.
- **Revert:** `git reset --hard` to the pre-builder baseline commit, discarding both the builder's implementation and the adversary's tests.

---

## Design

### Concept: The Adversary

The adversary is a second agent invocation within the run loop. It runs *after* the builder's work passes all validation stages and is auto-committed. Its goal is destructive: find inputs, states, and sequences that cause the implementation to fail.

Key constraints:
- The adversary **only writes tests**. It does not modify implementation code. This is enforced mechanically by reverting non-test file changes after the adversary runs.
- Adversarial tests that **pass** (implementation handles the edge case correctly) are kept — they strengthen the test suite.
- Adversarial tests that **fail** (implementation breaks) are optionally pushed to a diagnostic branch, then the entire iteration is reverted — both the implementation and the adversarial tests.
- The adversary runs on a **committed state**: the builder's work is auto-committed before the adversarial pass begins, providing a clean diff for the adversary prompt.
- The adversary **cannot delete existing tests**. This is enforced mechanically by comparing test file states before and after the adversary runs.

### Prerequisites

- **Auto-commit required.** The adversarial pass requires `git.auto-commit: true`. The adversary needs the builder's work committed to produce a clean diff and to have a consistent revert point. If auto-commit is false and adversarial is enabled, ralph logs a warning and skips the adversarial pass for that iteration.
- **Test command required.** The adversarial pass requires `validation.test-command` to be set (or, with staged validation, at least one test-type stage). Without a test command, adversarial tests cannot be verified.

### Workflow

```
Builder iteration (existing):
  1. Agent implements task
  2. Staged validation passes (all required stages green)
  3. Auto-commit builder's work → commit A

Adversarial pass (new):
  4. Capture pre-adversary state (test file list, test count)
  5. Generate adversary prompt (diff of commit A, relevant spec, existing tests)
  6. Spawn adversary agent
  7. Adversary writes edge-case tests
  8. File restriction: revert any changes to non-test files
  9. Test deletion guard: verify no test files deleted, no test count decrease
  10. Run test command (all tests, including adversarial)
  11a. All tests pass → commit adversarial tests → commit B → proceed to scoring
  11b. Any test fails → push failing state to diagnostic branch (if enabled) →
       revert to pre-builder baseline (discard commits A and B)
  11c. Agent spawn fails / times out / no tests written → skip (keep commit A)

Scoring (existing):
  12. Run scorer
  13. Regression check → commit/revert as normal
```

### Adversary Prompt

The adversary prompt includes:

- The diff of what the builder just implemented (from commit A vs baseline)
- The spec section(s) relevant to the current task (extracted from IMPLEMENTATION_PLAN.md task description)
- The existing test file(s) for the changed modules
- Stage results from validation (if staged validation is active)
- Explicit constraints with mechanical enforcement warnings

```
# Adversarial Testing Session

You are reviewing code that was just implemented by another agent. Your job is
to find bugs by writing tests that expose edge cases, boundary conditions, and
error paths the implementer likely missed.

## What Changed
{builder_diff}

## Relevant Spec
{spec_content}

## Existing Tests
{existing_tests}

## Validation Results
{stage_results}

## Rules

1. **Write tests only.** Do not modify any implementation file. Any changes to
   non-test files will be automatically reverted before your tests run. Your
   tests must pass against the unmodified implementation.

2. **Do not delete or rewrite existing tests.** Add new test cases only.
   Removing or replacing existing tests will be detected and the adversarial
   pass will be aborted. Your job is to ADD coverage, not reorganize it.

3. **Do not modify IMPLEMENTATION_PLAN.md or any .md file.** Your scope is
   test files only.

4. **Target edge cases.** Empty inputs, null/undefined values, maximum sizes,
   boundary values, malformed data, off-by-one errors, type coercion, error
   paths, timeout scenarios, concurrent access patterns.

5. **Be specific.** Each test should target one specific edge case with a clear
   name describing what it tests (e.g., "should reject negative timeout values"
   not "should handle edge cases").

6. **Maximum {budget} tests.** Quality over quantity. Do not write trivial
   assertions (e.g., `expect(true).toBe(true)`).

7. **Use the project's test framework.** Match existing test patterns,
   imports, and conventions. Look at {existing_tests} for examples.

8. **Run the tests.** Execute `{test_command}` after writing. If your tests
   fail because of a real bug in the implementation, leave them as-is — exposing
   bugs is the goal. If your tests fail because of a mistake in your test code
   (wrong import, syntax error), fix your test.

9. **Do not fix implementation bugs.** Even if you find a bug, do not modify
   implementation files. Write a test that demonstrates the bug and leave it
   failing.

If you cannot find meaningful edge cases worth testing, write nothing. An empty
result is better than trivial tests. An empty result will not cause a revert.
```

### File Restriction (Mechanical Enforcement)

After the adversary agent runs, ralph performs the following checks:

**Step 1: Revert non-test file changes.**
```
git diff --name-only HEAD | filter against test-patterns
for each changed file NOT matching test-patterns:
  git checkout HEAD -- {file}
```

**Step 2: Revert restricted file changes.**
Additional patterns that are always restricted regardless of test-patterns:
- `IMPLEMENTATION_PLAN.md`
- `*.md` in the project root
- `.ralph/*` (except `.ralph/keep`)
- Config files (`.ralph/config.yml`, `package.json`, `tsconfig.json`)

**Step 3: Verify no new non-test files created.**
```
git ls-files --others --exclude-standard | filter against test-patterns
for each untracked file NOT matching test-patterns:
  rm {file}
```

If any files were reverted or removed in steps 1-3, ralph logs a warning:
`⚠ Adversary modified {n} restricted file(s) — changes reverted: {file_list}`

### Test Deletion Guard (Mechanical Enforcement)

Before the adversary runs, ralph captures:
- List of all files matching test-patterns (pre-adversary snapshot)
- Total test count from the most recent validation run

After the adversary runs and file restriction is applied:
- Verify no files from the pre-adversary snapshot were deleted
- Run the test command and capture the new test count
- If test count decreased: abort adversarial pass, revert adversary changes, log warning

If the guard triggers:
`⚠ Adversary deleted tests (count: {before} → {after}) — adversarial pass aborted`

This prevents F020 (Silent Test Deletion) from the failure catalog.

### Diagnostic Branch

When adversarial tests fail (step 11b in the workflow):

1. Create branch `ralph/adversarial/{iteration}` from current HEAD (which includes commit A + adversary tests)
2. Commit the adversary's test files to this branch with message `ralph: adversarial tests (iteration {n}, {m} failures)`
3. Switch back to the original branch
4. Revert to baseline

This preserves the failing tests for inspection. The developer (or a future agent) can check out the diagnostic branch to see exactly what broke.

Config: `adversarial.diagnostic-branch: true` (default: true)

### Config

```yaml
run:
  adversarial:
    enabled: false                # opt-in, not default
    agent: null                   # null = inherit from run.agent
    model: null                   # null = inherit from agent
    budget: 5                     # max test cases per iteration
    timeout: 300                  # seconds (default 5 min)
    diagnostic-branch: true       # push failing tests to branch for debugging
    test-patterns:                # glob patterns for allowed test files
      - "**/*.test.{ts,js,tsx,jsx}"
      - "**/*.spec.{ts,js,tsx,jsx}"
      - "**/test_*.py"
      - "**/*_test.py"
      - "**/*_test.go"
    restricted-patterns:          # additional files the adversary cannot touch
      - "IMPLEMENTATION_PLAN.md"
      - ".ralph/**"
      - "package.json"
      - "tsconfig.json"
    skip-on-simplify: true        # don't run adversarial during --simplify
```

**Removed from v0.6.0:** `trigger: on-pass` — the adversarial pass always runs after validation passes; there is no other trigger. The field was redundant.

### Integration with Run Loop

The adversarial pass inserts between auto-commit and scoring in `run/index.ts`:

```
Current flow (v0.5):
  agent runs → validation → auto-commit → scoring → regression check

New flow (v0.6):
  agent runs → validation → auto-commit → [adversarial pass] → scoring → regression check
```

If adversarial is disabled, the iteration is a plan-mode iteration, `--simplify` is active with `skip-on-simplify: true`, or auto-commit is off, the adversarial step is skipped entirely.

### Integration with Staged Validation

When staged validation (Phase 1) is active, the adversarial pass benefits from richer context:

- The adversary prompt includes per-stage results (e.g., "unit ✓ | typecheck ✓ | integration ✓")
- This helps the adversary focus: if integration tests exist, the adversary targets unit-level edge cases that integration doesn't cover. If no integration tests exist, the adversary may write integration-style tests.
- The adversarial pass itself is NOT a validation stage — it has special revert semantics (revert builder + adversary on failure) that don't fit the stage model.

When staged validation is NOT active (backward-compat mode):
- The adversary prompt includes a simple "validation passed" statement
- All other behavior is identical

### Score Context

When adversarial tests catch a bug and the iteration is reverted:

```
## Score Context
⚠ Previous iteration passed validation but was REVERTED by adversarial testing.
The adversary found {n} edge case(s) that broke the implementation.
Failed tests:
  - test: "should handle empty input array" (file: src/parser.test.ts)
  - test: "should reject negative timeout values" (file: src/config.test.ts)
Diagnostic branch: ralph/adversarial/{iteration}
Fix these edge cases in your implementation. The adversarial tests will run again.
```

When adversarial tests pass (implementation handles edge cases correctly):

```
## Score Context
Current project score: {score} (previous: {prev_score}, delta: {delta})
Adversarial testing passed: {n} edge-case tests added and passing.
```

When adversarial pass is skipped (timeout, spawn failure, no tests written):

```
## Score Context
Current project score: {score} (previous: {prev_score}, delta: {delta})
Adversarial testing: skipped ({reason}).
```

### Results Enrichment

The `status` column in `results.tsv` gains a new value: `adversarial-fail`

```
commit	iter	status	score	delta	duration	metrics	description
a1b2c3d	5	adversarial-fail	—	—	120	—	implement auth [adversary found 2 bugs]
```

When adversarial tests pass and are committed:

```
a1b2c3d	5	pass	0.875	+0.025	120	test_count=42	implement auth [+3 adversarial tests]
```

---

## Architecture

### New Files

| File | Responsibility |
|------|----------------|
| `src/commands/run/adversarial.ts` | Adversarial pass orchestration: prompt generation, file restriction, test deletion guard, diagnostic branch, test execution, result reporting |
| `src/commands/run/adversarial.test.ts` | Unit tests for adversarial pass |

### Changed Files

| File | Change |
|------|--------|
| `src/config/schema.ts` | Add `AdversarialConfig` type; add `adversarial` field to `RunConfig` |
| `src/config/defaults.ts` | Add `DEFAULT_ADVERSARIAL` config (enabled: false) |
| `src/config/validate.ts` | Add adversarial config validation (budget > 0, timeout > 0, patterns non-empty) |
| `src/commands/run/index.ts` | Insert adversarial pass between auto-commit and scoring |
| `src/commands/run/scoring.ts` | Add `adversarial-fail` and `adversarial-pass` score context variants |
| `src/commands/run/types.ts` | Add `AdversarialResult` type |
| `src/commands/run/prompts.ts` | Add `generateAdversarialPrompt()` function; update dry-run to include adversarial prompt |
| `src/commands/score/types.ts` | Add `adversarial-fail` to `ResultEntry.status` union |
| `src/commands/score/results.ts` | Accept `adversarial-fail` status in `appendResult()` |
| `ARCHITECTURE.md` | Update run domain file listing; document adversarial.ts |

### Layer Rules

- `adversarial.ts` is in the `run` domain. Imports from `config/`, `utils/`, and `run/agent.ts` (existing cross-domain pattern via `spawnAgent` / `resolveAgent`).
- No new cross-command exceptions introduced.

### File Size Estimate

`adversarial.ts` will contain:
- `generateAdversarialPrompt()` — ~60 lines
- `enforceFileRestriction()` — ~40 lines
- `enforceTestDeletionGuard()` — ~30 lines
- `pushDiagnosticBranch()` — ~25 lines
- `runAdversarialPass()` — ~80 lines (orchestrator)
- Helpers and types — ~30 lines
- **Total: ~265 lines** (within 500-line limit)

---

## Features

### AC-1: Opt-in default
With no `adversarial:` config, the adversarial pass does not run. Existing behavior is unchanged.
- **Type:** ⚙️ Mechanical
- **Verification:** Unit test: load default config, verify `adversarial.enabled === false`. Run loop without adversarial config, verify no adversarial code path executes.

### AC-2: Adversarial pass on validation success
With `adversarial.enabled: true`, after the builder's work passes validation and is auto-committed, an adversary agent is spawned with a prompt containing the builder's diff, relevant spec, and existing tests.
- **Type:** ⚙️ Mechanical
- **Verification:** Integration test: enable adversarial, run a build iteration, verify adversary agent is spawned after auto-commit.

### AC-3: File restriction enforcement
If the adversary modifies any non-test file (per `test-patterns` config), those changes are reverted before running tests. Implementation files are never modified by the adversary. If the adversary modifies any file matching `restricted-patterns`, those changes are also reverted.
- **Type:** ⚙️ Mechanical
- **Verification:** Unit test: mock adversary that modifies `src/foo.ts` and `src/foo.test.ts`, verify `src/foo.ts` is reverted and `src/foo.test.ts` is kept.

### AC-4: Test deletion guard
If the adversary deletes any existing test file or reduces the total test count, the adversarial pass is aborted and the adversary's changes are reverted. The builder's commit (A) is preserved.
- **Type:** ⚙️ Mechanical
- **Verification:** Unit test: mock adversary that deletes a test file, verify adversarial pass is aborted with warning.
- **Failure pattern:** Prevents F020 (Silent Test Deletion).

### AC-5: Passing adversarial tests are committed
When all tests pass (including adversarial tests), the test files are committed as a separate commit (commit B) after the builder's commit (A).
- **Type:** ⚙️ Mechanical
- **Verification:** Integration test: adversary writes passing tests, verify commit B exists with only test files.

### AC-6: Failing adversarial tests trigger full revert
When any adversarial test fails, both the adversarial tests and the builder's implementation are reverted to the pre-iteration baseline.
- **Type:** ⚙️ Mechanical
- **Verification:** Integration test: adversary writes failing test, verify HEAD matches pre-builder baseline.

### AC-7: Diagnostic branch on failure
When adversarial tests fail and `diagnostic-branch: true`, the failing tests are pushed to `ralph/adversarial/{iteration}` before reverting. The developer can inspect what broke.
- **Type:** ⚙️ Mechanical
- **Verification:** Unit test: adversarial failure with diagnostic-branch enabled, verify branch exists and contains the failing tests.

### AC-8: Score context includes adversarial results
After an adversarial-triggered revert, the next iteration's score context names the failed tests, describes the edge cases, and references the diagnostic branch.
- **Type:** ⚙️ Mechanical
- **Verification:** Unit test: generate score context after adversarial failure, verify output contains test names and branch reference.

### AC-9: Budget enforcement
The adversary prompt specifies the maximum number of tests (from `budget` config). This is a prompt-level constraint; ralph does not post-hoc count generated tests.
- **Type:** 👁️ Process
- **Verification:** Unit test: verify generated adversary prompt contains the configured budget number.

### AC-10: Timeout
The adversary has its own timeout (default 300s). On timeout, the adversarial pass is treated as a no-op — the builder's work is kept (fail-open).
- **Type:** ⚙️ Mechanical
- **Verification:** Unit test: mock adversary that exceeds timeout, verify builder's commit is preserved.

### AC-11: Simplify mode skip
When `--simplify` is active and `skip-on-simplify: true`, the adversarial pass does not run.
- **Type:** ⚙️ Mechanical
- **Verification:** Unit test: run with `--simplify`, verify adversarial pass is skipped.

### AC-12: Dry run shows adversarial prompt
`ralph run --dry-run` prints both the builder prompt and the adversarial prompt template (with placeholder values for diff, spec, tests).
- **Type:** ⚙️ Mechanical
- **Verification:** Unit test: run with `--dry-run` and adversarial enabled, verify adversarial prompt is included in output.

### AC-13: Results tracking
Iterations reverted by adversarial testing are logged as `adversarial-fail` in `results.tsv`. Passing adversarial iterations include `[+N adversarial tests]` in the description.
- **Type:** ⚙️ Mechanical
- **Verification:** Unit test: verify `appendResult()` accepts `adversarial-fail` status. Verify description includes test count on pass.

### AC-14: Agent independence
The adversary agent can be different from the builder agent (different CLI, different model). Configured via `adversarial.agent` and `adversarial.model`.
- **Type:** ⚙️ Mechanical
- **Verification:** Unit test: configure different adversary agent, verify `resolveAgent` produces correct config.

### AC-15: Auto-commit requirement
If `git.auto-commit: false` and adversarial is enabled, ralph logs a warning and skips the adversarial pass.
- **Type:** ⚙️ Mechanical
- **Verification:** Unit test: disable auto-commit with adversarial enabled, verify warning logged and pass skipped.

### AC-16: No-op on empty adversary output
If the adversary writes no test files (empty result), the adversarial pass is a no-op — the builder's work is kept, no revert, no error.
- **Type:** ⚙️ Mechanical
- **Verification:** Unit test: adversary produces no file changes, verify builder's commit is preserved.

---

## Implementation Sequence

| Order | Task | Depends On | Effort |
|-------|------|------------|--------|
| T1 | Add `AdversarialConfig` type to `schema.ts` and `RawRalphConfig` | None | 1 iteration |
| T2 | Add `DEFAULT_ADVERSARIAL` to `defaults.ts`, wire into config merger | T1 | 1 iteration |
| T3 | Add adversarial config validation to `validate.ts` | T1 | 1 iteration |
| T4 | Add `adversarial-fail` to `ResultEntry.status` union in `score/types.ts` | None | 1 iteration |
| T5 | Update `appendResult()` and `readResults()` in `score/results.ts` to accept `adversarial-fail` | T4 | 1 iteration |
| T6 | Add `generateAdversarialPrompt()` to `run/prompts.ts` | None | 1 iteration |
| T7 | Create `run/adversarial.ts` with `enforceFileRestriction()` and `enforceTestDeletionGuard()` | T1 | 1 iteration |
| T8 | Add `pushDiagnosticBranch()` to `run/adversarial.ts` | T7 | 1 iteration |
| T9 | Add `runAdversarialPass()` orchestrator to `run/adversarial.ts` | T6, T7, T8 | 2 iterations |
| T10 | Add adversarial score context variants to `run/scoring.ts` | T4 | 1 iteration |
| T11 | Wire adversarial pass into `run/index.ts` (between auto-commit and scoring) | T9, T10 | 1 iteration |
| T12 | Update `--dry-run` in `run/index.ts` to print adversarial prompt | T6, T11 | 1 iteration |
| T13 | Write unit tests for `adversarial.ts` (file restriction, guard, diagnostic branch, orchestrator) | T9 | 2 iterations |
| T14 | Write integration test: full loop with adversarial pass (pass + fail + skip scenarios) | T11, T13 | 1 iteration |

**Total estimated effort:** 15 iterations

**Migration steps:** None required. This is a purely additive feature. No existing behavior changes when adversarial is disabled (default). No data format migrations needed — `adversarial-fail` is a new status value that existing result parsers will encounter only when adversarial is enabled.

**Independent vs. coordinated:** T1-T3 (config) and T4-T5 (results type) are independent of each other and can be done in either order. T6 (prompt) is independent. T7-T9 depend on T1 and T6. T10 depends on T4. T11 requires T9 and T10. T12-T14 require T11.

---

## Feature Tracker

| ID | Feature | Status | Notes |
|----|---------|--------|-------|
| AC-1 | Opt-in default | ❌ | |
| AC-2 | Adversarial pass on validation success | ❌ | |
| AC-3 | File restriction enforcement | ❌ | |
| AC-4 | Test deletion guard | ❌ | New in v0.6.1 |
| AC-5 | Passing adversarial tests committed | ❌ | Renamed from AC-4 in v0.6.0 |
| AC-6 | Failing tests trigger full revert | ❌ | Renamed from AC-5 in v0.6.0 |
| AC-7 | Diagnostic branch on failure | ❌ | New in v0.6.1 (resolved Q1) |
| AC-8 | Score context includes adversarial results | ❌ | Updated format |
| AC-9 | Budget enforcement | ❌ | |
| AC-10 | Timeout (fail-open) | ❌ | |
| AC-11 | Simplify mode skip | ❌ | |
| AC-12 | Dry run shows adversarial prompt | ❌ | |
| AC-13 | Results tracking (`adversarial-fail` status) | ❌ | |
| AC-14 | Agent independence | ❌ | |
| AC-15 | Auto-commit requirement | ❌ | New in v0.6.1 |
| AC-16 | No-op on empty output | ❌ | New in v0.6.1 |

---

## Success Criteria (Spec-Level)

1. **Functional:** With `adversarial.enabled: true`, a build iteration that passes validation triggers an adversary agent that writes edge-case tests. Passing tests are committed; failing tests revert the iteration.
2. **Backward compatibility (regression criterion):** With adversarial disabled (default), `ralph run` produces identical behavior to v0.5.0. All 832 existing tests pass without modification.
3. **Failure-pattern coverage:** The adversary is mechanically prevented from modifying implementation files (F012/F014), deleting tests (F020), or modifying the plan (F013). No prompt-only enforcement for safety-critical constraints.
4. **Debuggability:** Adversarial failures produce a diagnostic branch with the failing tests and score context naming the specific failures.
5. **Independence:** The adversary can use a different agent/model from the builder, verified by config resolution tests.

---

## Compatibility Notes

**Consumers of `ResultEntry.status`:**
- `score/results.ts` (`appendResult`, `readResults`) — must accept `adversarial-fail`
- `run/scoring.ts` (`buildScoreContext`) — must handle `adversarial-fail` as a previous status
- `score/trend.ts` (`computeTrend`) — must not break on unknown status values (already resilient)
- `run/progress.ts` (`printIterationSummary`) — must format `adversarial-fail` iterations

**API changes:** None. This is a CLI tool with no external API.

**Import path changes:** None. `adversarial.ts` is a new file; no existing imports change.

**Behavior changes when enabled:** The run loop takes longer per iteration (adversary timeout up to 300s additional). Score may change because adversarial tests contribute to test count metrics.

**Deprecations:** None.

---

## Non-Goals

- **Mutation testing.** The adversary writes new tests, it doesn't mutate existing code. AST-based mutation testing is a different tool.
- **Adversarial implementation.** The adversary doesn't write "evil" implementations. It writes legitimate tests that expose bugs.
- **Property-based test generation.** The adversary prompt focuses on concrete edge cases, not property-based testing frameworks. PBT support could be added to the prompt later.
- **Adversarial review of test quality.** The adversary generates tests; it doesn't audit existing tests for quality. That's a separate concern.
- **Multiple adversary rounds.** v0.6 runs one adversarial pass per iteration. If real-world usage shows diminishing returns from single-round, multi-round can be added as a config option in a future version.

---

## Resolved Questions (from v0.6.0)

### Q1: Should failing adversarial tests be committed to a branch for debugging?
**Resolution: YES.** Failing tests are pushed to `ralph/adversarial/{iteration}` before revert. Rationale: the failing tests are the most valuable artifact — they demonstrate exactly what broke. Silently discarding them forces the builder to rediscover the same edge cases. The diagnostic branch has zero cost when tests pass (no branch created) and high value when tests fail. Default: enabled.

### Q2: Should adversarial pass affect the fitness score?
**Resolution: NO.** The fitness score measures implementation quality via the scorer (test pass rate, coverage). Adversarial tests that pass are committed and naturally increase `test_count`, which may indirectly affect the score. But the adversarial pass itself does not add a score bonus. Rationale: the score should reflect the state of the codebase, not the process that produced it. If adversarial tests improve coverage, the coverage scorer will reflect that.

### Q3: Multiple adversary rounds?
**Resolution: NO for v0.6.** One round per iteration. Rationale: the adversary gets the complete diff and spec context. If it can't find edge cases in one pass, a second pass with the same context is unlikely to find more. Multi-round with escalating difficulty (e.g., round 2 gets the adversary's own tests as additional context) is a valid future enhancement but adds complexity without proven value.

---

## Test Plan

### Unit Tests (adversarial.test.ts)

- `enforceFileRestriction()` with mock git diff containing test + non-test files: verify non-test files reverted
- `enforceFileRestriction()` with restricted patterns (IMPLEMENTATION_PLAN.md, .ralph/): verify reverted
- `enforceFileRestriction()` with only test file changes: verify no reverts
- `enforceTestDeletionGuard()` with deleted test file: verify abort + warning
- `enforceTestDeletionGuard()` with decreased test count: verify abort + warning
- `enforceTestDeletionGuard()` with added tests only: verify pass
- `pushDiagnosticBranch()` creates branch and commits test files
- `pushDiagnosticBranch()` with `diagnostic-branch: false`: verify no branch created
- `generateAdversarialPrompt()` includes builder diff, spec content, existing tests, budget
- `generateAdversarialPrompt()` includes stage results when available
- `runAdversarialPass()` with passing tests: returns pass result, test files preserved
- `runAdversarialPass()` with failing tests: returns fail result, diagnostic branch created
- `runAdversarialPass()` with agent timeout: returns skip result, builder work preserved
- `runAdversarialPass()` with agent spawn failure: returns skip result, builder work preserved
- `runAdversarialPass()` with no test changes: returns skip result, builder work preserved
- `runAdversarialPass()` with auto-commit off: returns skip result with warning

### Scoring Tests

- `buildScoreContext()` with `previousStatus: 'adversarial-fail'`: verify output includes test names and branch
- `buildScoreContext()` with adversarial pass: verify output includes adversarial test count

### Config Tests

- Default config: `adversarial.enabled === false`
- Config with adversarial enabled: all fields have correct types
- Config validation: budget < 1 rejected, timeout < 1 rejected, empty test-patterns rejected

### Integration Tests

- Full run loop: adversarial enabled, builder writes buggy code, adversary catches it, iteration reverted
- Full run loop: adversarial enabled, builder writes correct code, adversary tests pass, tests committed
- Full run loop: adversarial disabled, identical behavior to v0.5.0 (backward-compat)
- Full run loop: auto-commit off with adversarial enabled, warning logged, pass skipped

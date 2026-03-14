# Implementation Plan — Score Domain Coverage Improvement

Spec: Dogfood test — improve score domain test coverage (currently 66%, grade C)
Date: 2026-03-13

## Pre-flight
- Regression baseline: 1051 tests passing, typecheck clean

## Task 1: Add unit tests for `src/commands/score/scorer.ts`

- [ ] Create `src/commands/score/scorer.test.ts` with tests for `discoverScorer()` and `runScorer()`
  - `discoverScorer()` with custom script path → returns script path
  - `discoverScorer()` with null script → returns null
  - `runScorer()` with valid script → parses JSON output as ScoreResult
  - `runScorer()` with script that exits non-zero → returns null
  - `runScorer()` with script that outputs invalid JSON → returns null
  - `runScorer()` with timeout → returns null
  Verify: tests pass, coverage for scorer.ts increases

## Task 2: Add unit tests for `src/commands/score/default-scorer.ts`

- [ ] Create `src/commands/score/default-scorer.test.ts` with tests for `runDefaultScorer()`
  - Given test output with "X passed" → extracts test count
  - Given coverage data with statement percentages → computes weighted score
  - Given no test output → returns score 0
  - Given test output but no coverage → returns score based on test weight only
  - Boundary: 0 tests passed → score 0
  - Boundary: coverage at 100% → max coverage contribution
  Verify: tests pass, coverage for default-scorer.ts increases

## Verification

- [ ] Run `npm test && npx tsc --noEmit`
  Confirm test count > 1051, typecheck clean.
  Run `ralph grade --ci` and check if score domain grade improved from C.

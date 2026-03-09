# Fitness Scoring Spec Hardening — Round 2 Report

**Date:** 2026-03-09
**Spec:** `docs/product-specs/fitness-scoring.md` (1020 lines, 11 features, 77 ACs)
**Codebase:** 685 tests, v0.4.0, branch `feature/fitness-scoring`
**Analyst:** OpenClaw (Opus)

---

## Executive Summary

Round 1 hardening (applied at spec creation in `e8abd33`) was **remarkably thorough** — it addressed 15 of the 21 issues identified during deep analysis. Round 2's primary contribution was **deduplication and cleanup** of the previous hardening pass, which had introduced duplicate sections (type definitions, RunOptions, auto-revert behavior, coverage JSON parsing). After cleanup, 6 genuinely new additions remain from round 2.

## Phase 1: Structural Integrity

**Mapped references:** All 12 new files in the spec have clear locations. No dangling references. No circular dependencies. Import chains verified.

**Already addressed by round 1:**
- Type definitions for `ScoreResult`, `ResultEntry`, `ScoreContext` ✓
- `RunOptions` extension with new CLI flags ✓
- `generatePrompt()` signature update for `{score_context}` ✓
- `buildScoreContext()` export from `run/scoring.ts` ✓

## Phase 2: Contradiction Hunting

**Already addressed by round 1:**
- `AgentConfig.timeout` vs `LoopConfig.iteration-timeout` interaction ✓ (wrapper overrides inner timeout)
- Cumulative check notation unified to `best_score - current_score > threshold` ✓
- No-changes iterations exempted from AC-15 ("every iteration") ✓
- Plan mode exemption from scoring/validation/timeout ✓
- `auto-revert: false` status specified as `pass` with annotation ✓

**Round 2 cleanup:** The previous hardening pass added a second "auto-revert: false" section under Config Schema that duplicated the F-FS04 behavioral spec. Replaced with cross-reference.

## Phase 3: Agent-as-Adversary

**Already addressed by round 1:**
- Description capture before revert (step 0 in revert procedure) ✓
- Branch switching detection and restoration (step 2) ✓
- Baseline commit stored in checkpoint for resume correctness ✓
- Checkpoint authoritative over results.tsv for scoring state ✓
- `RALPH_ITERATION` set to `"0"` for standalone `ralph score` ✓
- Simplification preamble scope clarified ("everything from ## Your Task through EOF") ✓
- Test count 0→N monitoring guard (skip when previous is 0) ✓
- Post-scoring dirty check includes HEAD comparison (detects score script commits) ✓
- `regression-threshold: 1.0` edge case documented ✓
- Coverage JSON field lookup priority specified (sequential, first match) ✓
- Flag combinations: `--no-score` + `--baseline-score` → error ✓

## Phase 4: Runtime Failure Simulation

All 7 scenarios traced through successfully against the hardened pseudocode:
1. First run ever ✓
2. Resume after crash (checkpoint.baselineCommit handles this) ✓
3. Score oscillation (cumulative threshold catches drift) ✓
4. Zero to hero (default scorer produces null → first score becomes baseline) ✓
5. Score script returns 1.0 every time (delta always 0, no regression) ✓
6. Validation passes but scoring hangs (60s timeout, unscored pass) ✓
7. Agent commits to wrong branch (revert step 2 restores original branch) ✓

## Phase 5: Round 2 Fixes Applied

### Genuinely New (6 items)

#### R2-01: Duplicate type definitions removed
- **Type:** structural cleanup
- **Severity:** high (agent confusion)
- **Problem:** The previous hardening pass added a second `### Type Definitions` block with slightly different field names (`source: 'custom'` vs `'script'`, `prevStatus` vs `previousStatus`). An agent seeing two conflicting definitions would coin-flip.
- **Fix:** Removed the duplicate block. The round 1 version (with `source: 'script'`, richer `ScoreContext` including `previousTestCount`/`currentTestCount`) is authoritative.

#### R2-02: Duplicate RunOptions section removed
- **Type:** structural cleanup
- **Severity:** high (agent confusion)
- **Problem:** Two `RunOptions` extensions existed — one abbreviated (4 fields, no existing fields shown) and one complete (all 12 fields).
- **Fix:** Removed the abbreviated version. The complete version under Config Schema is authoritative.

#### R2-03: Duplicate auto-revert behavior removed
- **Type:** structural cleanup
- **Severity:** medium
- **Problem:** `auto-revert: false` behavior was specified both under Config Schema Extensions AND under F-FS04. The Config Schema version was less detailed.
- **Fix:** Replaced Config Schema version with cross-reference: "See F-FS04 for full `auto-revert: false` behavioral specification."

#### R2-04: Duplicate coverage JSON parsing removed
- **Type:** structural cleanup
- **Severity:** medium
- **Problem:** Coverage JSON field lookup was specified twice — once in the Inputs section (round 1, more detailed with 4 fields and optional chaining example) and again after the pass rate section (round 2 addition, 3 fields).
- **Fix:** Removed the second instance. The Inputs section version is authoritative.

#### R2-05: `--no-score` + `--baseline-score` error in F-FS10
- **Type:** coverage gap
- **Severity:** medium
- **Problem:** The flag combination was caught in AC-53 and the pseudocode but not explicitly stated in F-FS10's bullet list. An agent implementing F-FS10 in isolation might miss it.
- **Fix:** Added explicit bullet to F-FS10: "Cannot be combined with `--baseline-score`..."
- **Note:** On closer inspection, this was also present in round 1 at the pseudocode and AC level. The F-FS10 bullet makes it visible at the feature level too.

#### R2-06: Score Context Injection cross-reference
- **Type:** structural cleanup
- **Severity:** low
- **Problem:** A standalone "Score Context Injection" subsection restated what F-FS07's "Prompt Integration" section already specified.
- **Fix:** Removed; the information lives in F-FS07.

### Previously Addressed by Round 1 (15 items confirmed)

| ID | Issue | Round 1 Location |
|----|-------|-----------------|
| Timeout interaction | `AgentConfig.timeout` override | F-FS05 "Interaction" section |
| Score context API | `generatePrompt()` + `buildScoreContext()` | F-FS07 "Prompt Integration" |
| Plan mode exemption | Skip scoring in plan mode | Run Loop "Plan mode exemption" |
| Branch switching | Revert step 2 branch verify | F-FS04 Revert Procedure |
| Baseline in checkpoint | `baselineCommit` field | Checkpoint Extension |
| Checkpoint authority | `lastScore`/`bestScore` from checkpoint | Checkpoint "authoritative" paragraph |
| No-changes vs AC-15 | AC-15 amended | Acceptance Criteria |
| Description capture | Revert step 0 | F-FS04 Revert Procedure |
| `RALPH_ITERATION` standalone | Set to `"0"` | F-FS01 Execution |
| Cumulative notation | Unified to `best_score - current_score >` | F-FS04 + AC-62 |
| Test count 0→N | Skip when previous is 0 | F-FS07 Edge case |
| Post-scoring commits | HEAD comparison | Post-Scoring Dirty Check |
| `threshold: 1.0` | Edge case row | Edge Cases table |
| Coverage JSON priority | Sequential with short-circuit | F-FS02 Inputs |
| Flag combos | `--no-score` + `--baseline-score` etc. | Pseudocode + AC-53 |

---

## Final Metrics

| Metric | Value |
|--------|-------|
| Spec lines (final) | 1,020 |
| Features | 11 |
| Acceptance criteria | 77 (71 original + 6 hardening) |
| Edge case rows | 31 |
| Round 2 fixes applied | 6 (4 cleanup, 1 coverage gap, 1 cross-ref) |
| Issues already addressed | 15 / 21 (71%) |
| Remaining open issues | 0 |

**Verdict:** The spec is ready for `ralph run plan`. Round 1 hardening was exceptionally thorough. Round 2's primary value was removing duplicate content that would have confused a build agent.

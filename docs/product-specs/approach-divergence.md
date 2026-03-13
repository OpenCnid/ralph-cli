# Spec: Approach Divergence Detection

**Version:** 1.0.0
**Status:** Ready for Implementation
**Date:** 2026-03-13
**Previous Version:** 0.8.0 (Draft)
**Roadmap:** Trust Calibration Phase 5

---

## Changelog (v0.8.0 → v1.0.0)

| Section | Change |
|---------|--------|
| Problem Statement | Added revision trigger with quantified findings |
| Design Principles | New section (4 principles) |
| Definitions | New section (7 terms) — "file count" semantics explicit |
| Architecture | Full data flow diagram, canonical source map, file-level changes with risk ratings, migration assessment |
| Features | Rewritten as 8 features with IDs (F-AD01–F-AD08), 28 success criteria, edge cases, delegation safety |
| Design (removed) | Absorbed into Architecture + Features — the old monolithic design section was too flat |
| Acceptance Criteria (removed) | Replaced by per-feature success criteria (SC-01 through SC-28) + spec-level criteria |
| Config | Promoted from design subsection to full feature (F-AD08) with validation rules |
| Implementation Sequence | New section — dependency-ordered, 9 tasks |
| Feature Tracker | New section — 8 features, all ❌ |
| Success Criteria (spec-level) | New section — 5 rollup criteria including regression and backward compat |
| Compatibility Notes | New section — consumer impact analysis |
| Non-Goals | Added "Occurrence counting" (clarifies file-count-only semantics) |
| Test Plan | Expanded with specific test cases per function |

**Key fixes from audit:**
1. `scanPatternInconsistency()` returns `DriftItem[]`, not raw pattern data → Added F-AD01 (scanner refactor)
2. `run/index.ts` at 1,051 lines (2× limit) → Integration logic extracted to `gc/fingerprint.ts` helper
3. "Fingerprint" naming collision with gc cross-run dedup → Terminology clarified ("pattern snapshot" user-facing, "fingerprint" in code)
4. Missing config validation, backward compat, and cross-domain documentation → Added as features and criteria
5. No implementation sequence or feature tracker → Added both

---

## Problem Statement

Ralph's `gc` command scans for pattern inconsistency *spatially* — it detects when different parts of the codebase use different patterns for the same concern (try-catch in one file, .catch() in another). But it doesn't track patterns *temporally*.

Temporal divergence: the agent solves the same type of problem a different way than it did in a previous iteration. Unit tests pass. Lint passes. The score doesn't drop. But the unexplained change in approach indicates one of three problems:

1. **Silent context loss.** The agent forgot how it solved this before and invented a new approach. In a multi-iteration loop, each iteration starts fresh — there's no guarantee of pattern continuity.
2. **Subtle regression.** The new approach works for the current task but breaks an assumption that other code depends on.
3. **Drift toward inconsistency.** Over 20 iterations, the codebase accumulates 4 different error-handling patterns. Each one is correct. The composition is a mess.

`ralph gc` catches the end state (pattern inconsistency). This feature catches the *moment of divergence* — when it happens, during the iteration, before it accumulates.

**Revision trigger:** Audit of the v0.8.0 draft against the actual codebase revealed 5 implementation blockers:

- `scanPatternInconsistency()` returns `DriftItem[]` (processed results), not the raw pattern data the spec assumed was accessible. The internal `patterns` map (the data fingerprinting needs) is scoped to the function and not exported.
- `run/index.ts` is 1,051 lines — 2× the project's 500-line file limit. Adding integration code there is not viable without extraction.
- The term "fingerprint" is already used in `gc/index.ts` line 66 for cross-run item deduplication (`itemKeys`), creating naming confusion with "pattern fingerprints."
- No implementation sequence, feature tracker, config validation, or cross-domain documentation existed in the draft.
- Acceptance criteria lacked concrete verification steps and didn't address scanner refactoring risk.

---

## Design Principles

1. **Non-destructive observation.** Divergence detection is informational. It never triggers a revert, blocks a commit, or changes the score.
2. **Reuse over reimplementation.** Pattern data comes from the existing scanner infrastructure. No duplicate scanning logic (F012 prevention).
3. **Minimal footprint.** One new file in `gc/`, one helper in `run/scoring.ts`, config additions with defaults. No new dependencies.
4. **Safe refactoring.** Extracting scanner internals must preserve all existing behavior. Existing `gc` tests must continue passing unchanged (F013/F018 prevention).

---

## Definitions

- **Pattern category:** A class of coding decisions tracked by `scanPatternInconsistency()`. Currently three: `error-handling`, `export-style`, `null-checking`. Each has two or more variants.
- **Pattern variant:** A specific approach within a category. Examples: `try-catch` and `.catch()` are variants of `error-handling`. `named-export` and `default-export` are variants of `export-style`.
- **File count:** The number of non-test source files (after applying `config.gc.exclude`) that contain at least one occurrence of a pattern variant. This is boolean per-file: a file with 10 try-catch blocks counts as 1. A file using both try-catch and .catch() adds 1 to each variant's count.
- **Pattern snapshot:** A JSON object recording the file count for every variant in every category at a specific build iteration. Called `PatternFingerprint` in code for brevity.
- **Divergence:** A difference between two consecutive pattern snapshots that exceeds configured thresholds. Three types: `new-pattern` (a variant appeared that was previously absent), `dominant-shift` (the most-used variant in a category changed), `proportion-change` (a variant's share of the category shifted by more than the threshold).
- **Pattern history:** An append-only JSONL file (`.ralph/pattern-history.jsonl`) storing one pattern snapshot per passing build iteration.
- **Temporal view:** The `--temporal` output mode for `ralph gc` that displays pattern changes across iterations.

---

## Architecture

### Data Flow

```
Build iteration passes validation and scoring
    │
    ▼
collectPatternData()          ← gc/scanners.ts (refactored export)
    │
    ▼
computeFingerprint()          ← gc/fingerprint.ts
    │
    ├──► appendPatternHistory()   ← gc/fingerprint.ts → .ralph/pattern-history.jsonl
    │
    ▼
detectDivergence()            ← gc/fingerprint.ts (compare vs previous snapshot)
    │
    ▼
formatDivergenceContext()     ← run/scoring.ts (format for prompt injection)
    │
    ▼
buildScoreContext()           ← run/scoring.ts ({score_context} in next iteration's prompt)
```

### Canonical Source Map

| Concern | File | Function | Notes |
|---------|------|----------|-------|
| Raw pattern data collection | `gc/scanners.ts` | `collectPatternData()` | Refactored from `scanPatternInconsistency` internals |
| Spatial pattern analysis | `gc/scanners.ts` | `scanPatternInconsistency()` | Existing — now calls `collectPatternData` internally |
| Snapshot computation | `gc/fingerprint.ts` | `computeFingerprint()` | New |
| Divergence detection | `gc/fingerprint.ts` | `detectDivergence()` | New |
| Pattern history I/O | `gc/fingerprint.ts` | `loadPatternHistory()`, `appendPatternHistory()` | New |
| Run loop helper | `gc/fingerprint.ts` | `computeAndRecordDivergence()` | New — single call site from `run/index.ts` |
| Temporal CLI output | `gc/fingerprint.ts` | `formatTemporalView()` | New |
| Score context formatting | `run/scoring.ts` | `formatDivergenceContext()` | New helper |
| Score context assembly | `run/scoring.ts` | `buildScoreContext()` | Extended — appends divergence info |
| Config schema | `config/schema.ts` | `DivergenceConfig` type | New |
| Config defaults | `config/defaults.ts` | `DEFAULT_DIVERGENCE` | New |
| Config validation | `config/validate.ts` | divergence field checks | New |
| CLI flag registration | `gc/index.ts` | `--temporal`, `--last` options | New |

### New Files

| File | Responsibility | Est. Lines |
|------|----------------|-----------|
| `src/commands/gc/fingerprint.ts` | Snapshot computation, divergence detection, pattern history I/O, temporal view formatting, run loop helper | ~200 |
| `src/commands/gc/fingerprint.test.ts` | Unit tests for all fingerprint functions | ~280 |

### Changed Files

| File | Change | Risk |
|------|--------|------|
| `src/commands/gc/scanners.ts` | Extract `collectPatternData()` from `scanPatternInconsistency()` internals. Export `PatternData` type. No behavior change to existing function. | LOW |
| `src/commands/gc/index.ts` | Add `temporal?: boolean` and `last?: number` to `GcOptions`. When `--temporal`, call `formatTemporalView` and return early. | LOW |
| `src/config/schema.ts` | Add `DivergenceConfig` type. Add optional `divergence?: DivergenceConfig` to `GcConfig`. Add to `RawRalphConfig`. | LOW |
| `src/config/defaults.ts` | Add `DEFAULT_DIVERGENCE`. Update `DEFAULT_GC` to include `divergence`. | LOW |
| `src/config/validate.ts` | Add validation for `gc.divergence` fields (threshold ranges, types). | LOW |
| `src/commands/score/types.ts` | Add `divergenceInfo?: string \| undefined` to `ScoreContext`. | LOW |
| `src/commands/run/scoring.ts` | Add `formatDivergenceContext()`. Extend `buildScoreContext()` to append `divergenceInfo` when present. | MEDIUM |
| `src/commands/run/index.ts` | After passing scored iteration, call `computeAndRecordDivergence()` (~8 lines). Pass `divergenceInfo` to score context. | LOW |
| `ARCHITECTURE.md` | Add cross-domain exception: `run → gc/fingerprint`. | LOW |

### Layer Rules

- `gc/fingerprint.ts` is in the `gc` domain. Imports from `config/schema.ts` (types) and `gc/scanners.ts` (same domain) only.
- `gc/index.ts` imports from `gc/fingerprint.ts` — same domain, not a cross-domain import.
- `run/index.ts` imports `computeAndRecordDivergence` from `gc/fingerprint.ts` — **new cross-domain exception**. Follows the existing pattern: `run → score` is already a documented exception in ARCHITECTURE.md.
- `run/scoring.ts` imports the `DivergenceItem` type from `gc/fingerprint.ts` — same cross-domain exception.

### Migration

No migration needed. All changes are additive:
- New config fields are optional with defaults (existing configs load without change)
- New JSONL file is created on first use (no pre-existing file to migrate)
- No existing file formats change
- No existing function signatures change (only new optional fields in types)
- No existing APIs change behavior

---

## Features

### F-AD01: Scanner Data Extraction

**Goal:** Expose the raw pattern data computed inside `scanPatternInconsistency()` so fingerprinting can reuse it without duplicating scanning logic.

**One-time.**

**Procedure:**
1. In `gc/scanners.ts`, define and export a new type:
   ```typescript
   export type PatternData = Record<string, Map<string, { files: string[] }>>;
   ```
2. Extract the pattern collection loop (lines that build the `patterns` map, from `const patterns` through the `for (const file of files)` block) into a new exported function:
   ```typescript
   export function collectPatternData(projectRoot: string, config: RalphConfig): PatternData
   ```
3. Modify `scanPatternInconsistency()` to call `collectPatternData()` internally, then process the result into `DriftItem[]` exactly as before.
4. Verify all existing gc tests pass without modification.

**Edge cases:**
- No source files (empty project): returns empty maps for all 3 categories
- All files excluded: same as no source files
- File read errors: silently skipped (existing behavior preserved)

**Delegation safety:**
- ⚠ A sub-agent might create a new scanning function instead of extracting from the existing one (F012). SC-01 prevents this by requiring grep verification.
- ⚠ A sub-agent might change `scanPatternInconsistency()` behavior while refactoring (F013/F018). SC-02 prevents this by requiring zero test changes.

**Success criteria:**
- ✅ **SC-01 (Immediate):** `collectPatternData` is the sole source of pattern data in the `gc` domain. `scanPatternInconsistency` calls it. `computeFingerprint` (F-AD02) calls it. Verified: `grep -rn "content.includes('try {')" src/commands/gc/` matches only `scanners.ts`, and `grep -rn "collectPatternData" src/commands/gc/` shows it called from both `scanners.ts` and `fingerprint.ts`.
- ✅ **SC-02 (Immediate):** All existing gc tests pass without modification. `git diff src/commands/gc/gc.test.ts` shows zero changes.
- ⚙️ **SC-03 (Mechanical):** `collectPatternData` is exported from `gc/scanners.ts`. Verified: `import { collectPatternData } from './scanners.js'` compiles in `gc/fingerprint.ts`.

---

### F-AD02: Pattern Snapshot Computation

**Goal:** After each passing build iteration, compute a pattern snapshot capturing file counts per variant per category.

**Ongoing (runs every iteration).**

**Procedure:**
1. In `gc/fingerprint.ts`, define:
   ```typescript
   export interface PatternFingerprint {
     iteration: number;
     commit: string;
     timestamp: string;  // ISO 8601
     patterns: Record<string, Record<string, number>>;  // category → variant → file count
   }
   ```
2. Implement:
   ```typescript
   export function computeFingerprint(
     patternData: PatternData,
     iteration: number,
     commit: string,
   ): PatternFingerprint
   ```
3. For each category in `patternData`, for each variant in that category, the count is the length of the variant's `files` array.

**Edge cases:**
- Category with zero variants (no files matched any pattern): category key present with empty object `{}`
- Single variant in category: stored normally (baseline for future comparison)
- `patternData` is empty (all categories have empty maps): all categories have empty objects

**Delegation safety:** Low risk — pure computation, no side effects.

**Success criteria:**
- ✅ **SC-04 (Immediate):** Given a project with 10 files using try-catch and 3 using .catch(), `computeFingerprint()` returns `{ patterns: { "error-handling": { "try-catch": 10, ".catch()": 3 }, ... } }`.
- ✅ **SC-05 (Immediate):** Given a project with no source files, `computeFingerprint()` returns pattern maps with empty objects for each category (not null, not error).

---

### F-AD03: Pattern History Storage

**Goal:** Persist pattern snapshots in an append-only JSONL file for temporal analysis.

**Ongoing.**

**Procedure:**
1. In `gc/fingerprint.ts`:
   ```typescript
   export function appendPatternHistory(projectRoot: string, entry: PatternFingerprint): void
   export function loadPatternHistory(projectRoot: string): PatternFingerprint[]
   ```
2. File location: `<projectRoot>/.ralph/pattern-history.jsonl`
3. One JSON object per line, one line per passing iteration
4. `appendPatternHistory` creates `.ralph/` if missing, creates the file if missing
5. `loadPatternHistory` returns `[]` for missing or empty files, skips corrupt JSON lines

**Edge cases:**
- `.ralph/` directory missing: `appendPatternHistory` creates it
- `pattern-history.jsonl` missing: created on first append; `loadPatternHistory` returns `[]`
- `pattern-history.jsonl` empty: `loadPatternHistory` returns `[]`
- Corrupt JSON lines (e.g., truncated write): skipped silently, valid lines returned (same pattern as `gc/history.ts` `loadHistory`)
- File system error on append: warn via `output.warn()` but do not throw (must not crash the run loop)

**Delegation safety:** Low risk — follows the established JSONL I/O pattern from `gc/history.ts`.

**Success criteria:**
- ✅ **SC-06 (Immediate):** After calling `appendPatternHistory()`, the file ends with a valid JSON line matching the entry's content.
- ✅ **SC-07 (Immediate):** `loadPatternHistory()` on a file with 3 valid lines and 1 corrupt line returns exactly 3 entries.
- ✅ **SC-08 (Immediate):** `loadPatternHistory()` on a missing file returns `[]` without throwing.

---

### F-AD04: Divergence Detection

**Goal:** Compare two consecutive pattern snapshots and flag meaningful changes.

**Ongoing.**

**Procedure:**
1. In `gc/fingerprint.ts`:
   ```typescript
   export interface DivergenceItem {
     category: string;       // e.g., "error-handling"
     type: 'new-pattern' | 'dominant-shift' | 'proportion-change';
     variant: string;        // the variant that triggered the divergence
     detail: string;         // human-readable description
   }

   export function detectDivergence(
     current: PatternFingerprint,
     previous: PatternFingerprint,
     config: DivergenceConfig,
   ): DivergenceItem[]
   ```
2. Detection rules (evaluated per category):
   - **new-pattern:** A variant has count > 0 in `current` and count === 0 (or absent) in `previous`, AND its count in `current` ≥ `config['new-pattern-threshold']` (default: 1).
   - **dominant-shift:** The variant with the highest file count changed between snapshots. Ties are broken alphabetically by variant name. A shift between previously-tied variants is still flagged.
   - **proportion-change:** For any variant, `|current_share - previous_share| > config['proportion-change-threshold']` (default: 0.20). Share is calculated as `variant_count / sum_of_all_variant_counts_in_that_category`. Both `current_share` and `previous_share` use their respective totals.

**Edge cases:**
- No previous snapshot (`previous` is null/undefined): return empty array (no divergence detectable). First iteration.
- Category present in current but absent in previous: treat all variants with count > 0 as `new-pattern`
- Category present in previous but absent in current: ignore (files were deleted, not a pattern choice)
- Tied dominance: alphabetical tiebreaker. If variant A was dominant (via tiebreaker) and variant B becomes dominant (by count), that's a `dominant-shift`.
- Category total is 0 in either snapshot: skip proportion calculation for that category (avoid division by zero)
- Threshold of 0 for proportion-change: disabled (no proportion changes flagged) — `> 0.0` is always true for any non-zero change, but a threshold of exactly 0 means "flag nothing" because the comparison is strict `>`.

**Delegation safety:**
- ⚠ Proportion math must use **absolute** change in share, not relative change. The formula is `|new_share - old_share|`, not `|(new_share - old_share) / old_share|`.

**Success criteria:**
- ✅ **SC-09 (Immediate):** Given previous `{ "error-handling": { "try-catch": 10 } }` and current `{ "error-handling": { "try-catch": 8, ".catch()": 3 } }`, returns a `DivergenceItem` with type `new-pattern`, variant `.catch()`.
- ✅ **SC-10 (Immediate):** Given previous `{ "export-style": { "named-export": 20, "default-export": 5 } }` and current `{ "export-style": { "named-export": 10, "default-export": 15 } }`, returns a `DivergenceItem` with type `dominant-shift`.
- ✅ **SC-11 (Immediate):** Given `=== null` share going from 0.90 to 0.60 (0.30 absolute change > 0.20 threshold), returns a `DivergenceItem` with type `proportion-change`.
- ✅ **SC-12 (Immediate):** Given a category with total 0 files in either snapshot, no `proportion-change` is reported (no division by zero).
- ✅ **SC-13 (Immediate):** Given null/undefined as `previous`, returns empty array.

---

### F-AD05: Score Context Integration

**Goal:** When divergence is detected, include it in the next iteration's `{score_context}` as informational guidance.

**Ongoing.**

**Coupled with F-AD06.** These two features must be implemented in sequence without pausing between them — F-AD05 creates the formatting, F-AD06 wires it into the loop. One without the other is dead code.

**Procedure:**
1. Add `divergenceInfo?: string | undefined` to `ScoreContext` in `score/types.ts`
2. Add `formatDivergenceContext(items: DivergenceItem[]): string | undefined` in `run/scoring.ts`:
   - Returns `undefined` when items is empty
   - Format:
     ```
     ℹ Approach divergence detected:
       error-handling: ".catch()" appeared for the first time (3 files)
       Previously 100% try-catch. Now 73% try-catch, 27% .catch().
       If intentional, consider promoting to a lint rule to enforce consistency.
     ```
3. Extend `buildScoreContext()`: when `ctx.divergenceInfo` is a non-empty string, append it after the metrics line with a blank line separator
4. The `ℹ` prefix signals informational observation. **Never use `⚠` for divergence.** Divergence does not affect score, delta, or revert logic.

**Edge cases:**
- No divergence items: `formatDivergenceContext` returns `undefined`, `buildScoreContext` output is identical to current behavior
- Multiple divergence items across categories: all listed, one block per category
- Single divergence item: one-line summary
- `buildScoreContext` called with `previousStatus: null` (first iteration): `divergenceInfo` is ignored (function already returns empty string for first iteration)

**Delegation safety:**
- ⚠ A sub-agent must not make divergence info trigger a revert or affect the score. SC-17 (process criterion) and SC-16 (mechanical check) guard this.

**Success criteria:**
- ✅ **SC-14 (Immediate):** When `divergenceInfo` is provided, `buildScoreContext()` output includes "ℹ Approach divergence detected:" followed by the item descriptions.
- ✅ **SC-15 (Immediate):** When `divergenceInfo` is undefined or empty, `buildScoreContext()` output is byte-identical to the pre-revision output for the same inputs.
- ✅ **SC-16 (Immediate):** `grep -n "⚠" src/commands/gc/fingerprint.ts src/commands/run/scoring.ts` shows zero matches in divergence-related code blocks. Only "ℹ" is used.
- 👁️ **SC-17 (Process):** Code review verifies that no code path uses divergence detection results to trigger a revert, modify a score value, or block a commit.

---

### F-AD06: Run Loop Integration

**Goal:** Wire fingerprint computation and divergence detection into the build loop after each passing iteration.

**Ongoing.**

**Coupled with F-AD05.** Implement immediately after F-AD05.

**Procedure:**
1. In `gc/fingerprint.ts`, implement a top-level helper:
   ```typescript
   export function computeAndRecordDivergence(
     projectRoot: string,
     config: RalphConfig,
     iteration: number,
     commit: string,
   ): string | undefined
   ```
   This function:
   a. Checks `config.gc.divergence?.enabled` — returns `undefined` if false
   b. Calls `collectPatternData(projectRoot, config)`
   c. Calls `computeFingerprint(patternData, iteration, commit)`
   d. Calls `loadPatternHistory(projectRoot)` and takes the last entry
   e. If a previous entry exists, calls `detectDivergence(current, previous, config.gc.divergence)`
   f. Calls `appendPatternHistory(projectRoot, currentFingerprint)`
   g. If divergence items exist, calls `formatDivergenceContext(items)` (imported from `run/scoring.ts`) and returns the result. Otherwise returns `undefined`.

   Wait — there's a circular import issue. `formatDivergenceContext` is in `run/scoring.ts`, but `computeAndRecordDivergence` is in `gc/fingerprint.ts`. The gc domain shouldn't import from run domain.

   **Fix:** Move `formatDivergenceContext` to `gc/fingerprint.ts` instead. It's a pure formatting function for divergence items — it belongs with the divergence types. `run/scoring.ts` only needs the string result.

   Actually, let me reconsider the architecture. The cleanest approach:
   - `gc/fingerprint.ts` exports `computeAndRecordDivergence()` which returns `DivergenceItem[]` (not the formatted string)
   - `run/scoring.ts` has `formatDivergenceContext()` which takes `DivergenceItem[]` and returns a string
   - `run/index.ts` calls `computeAndRecordDivergence()`, then passes the result to `formatDivergenceContext()`, then passes the formatted string into `buildScoreContext()` via the `divergenceInfo` field

   This way gc/fingerprint.ts doesn't import from run, and run/scoring.ts only imports the DivergenceItem type from gc/fingerprint.ts (same as the existing run → score cross-domain pattern).

   Let me update this.

2. In `run/index.ts`, after a passing iteration's score is recorded (after `appendResult()` and before constructing the next iteration's `scoreContext`), add:
   ```typescript
   // Pattern divergence detection (informational)
   let divergenceInfo: string | undefined;
   try {
     const divergenceItems = computeAndRecordDivergence(projectRoot, config, iteration, commitHash);
     if (divergenceItems.length > 0) {
       divergenceInfo = formatDivergenceContext(divergenceItems);
     }
   } catch { /* fingerprint failure must not crash run loop */ }
   ```
3. Pass `divergenceInfo` to the `buildScoreContext()` call for the next iteration

**Edge cases:**
- First iteration: `computeAndRecordDivergence` returns empty array, no `divergenceInfo`
- `gc.divergence.enabled: false` or `gc.divergence` missing (defaults to enabled): when disabled, returns empty array immediately
- `collectPatternData` throws: caught in run/index.ts try/catch, run loop continues
- Config has no `gc.divergence` section: defaults apply (enabled: true)

**Delegation safety:**
- ⚠ Addition to `run/index.ts` must be ≤10 lines (excluding imports) to avoid worsening the file size issue. All logic is in helper functions.
- ⚠ The helper must be called AFTER scoring is complete — after `appendResult()` and before constructing the next `scoreContext`. Not before scoring, not during scoring.

**Success criteria:**
- ⚙️ **SC-18 (Mechanical):** After a passing build iteration, `.ralph/pattern-history.jsonl` contains a new entry with the correct iteration number and commit hash.
- ⚙️ **SC-19 (Mechanical):** When `gc.divergence.enabled` is false, `.ralph/pattern-history.jsonl` is not created or modified.
- ✅ **SC-20 (Immediate):** If `computeAndRecordDivergence` throws, the build loop continues normally — the iteration is still logged as pass and the next iteration runs.
- ✅ **SC-21 (Immediate):** `run/index.ts` adds ≤10 lines for this feature (excluding import statements). Measured by `git diff --stat src/commands/run/index.ts`.

---

### F-AD07: Temporal CLI View

**Goal:** `ralph gc --temporal` displays pattern changes across recent iterations for human review.

**One-time.**

**Procedure:**
1. Add `temporal?: boolean` and `last?: number` to `GcOptions` in `gc/index.ts`
2. When `--temporal` is passed, load pattern history and call:
   ```typescript
   export function formatTemporalView(
     history: PatternFingerprint[],
     last: number,
   ): string
   ```
3. Default `last` value: 10. Configurable via `--last N` CLI flag.
4. Output format (text mode):
   ```
   Pattern History (last 10 iterations)
   ──────────────────────────────────────

   error-handling:
     iter 1-8:  try-catch (100%)
     iter 9:    try-catch (73%), .catch() (27%)  ← divergence
     iter 10:   try-catch (70%), .catch() (30%)

   export-style:
     iter 1-10: named-export (93%), default-export (7%)  — stable
   ```
5. When `--temporal` and `--json` are both passed, output pattern history as a JSON array of `PatternFingerprint` objects (last N entries).
6. Return after printing — do not run the normal gc scan (no drift items, no gc-report.md update, no gc-history.jsonl append).

**Edge cases:**
- No pattern history file: print "No pattern history found. Run `ralph run build` to start tracking."
- Empty history file: same message
- Fewer iterations than `--last N`: show all available
- Single iteration: show baseline snapshot only, no divergence annotations
- `--temporal` with `--category` or `--severity`: `--temporal` takes precedence, other filters are ignored (temporal view has its own format)

**Delegation safety:** Low risk — read-only, display-only.

**Success criteria:**
- ✅ **SC-22 (Immediate):** Given a history with 10 entries where iteration 9 introduced a new pattern, `formatTemporalView` output contains "← divergence" on the iteration 9 line.
- ✅ **SC-23 (Immediate):** Given empty/missing history, output is the guidance message (not an error, not a stack trace).
- ✅ **SC-24 (Immediate):** `--temporal` does not write to `gc-report.md` or `gc-history.jsonl`. Verified: file modification timestamps are unchanged after the command.

---

### F-AD08: Configuration

**Goal:** Add configurable thresholds for divergence detection with safe defaults.

**One-time.**

**Procedure:**
1. New type in `config/schema.ts`:
   ```typescript
   export interface DivergenceConfig {
     enabled: boolean;
     'new-pattern-threshold': number;
     'proportion-change-threshold': number;
   }
   ```
2. Update `GcConfig`:
   ```typescript
   export interface GcConfig {
     'consistency-threshold': number;
     exclude: string[];
     divergence?: DivergenceConfig | undefined;
   }
   ```
3. Add to `RawRalphConfig` under `gc`:
   ```typescript
   divergence?: Partial<{
     enabled: boolean;
     'new-pattern-threshold': number;
     'proportion-change-threshold': number;
   }>;
   ```
4. Defaults in `defaults.ts`:
   ```typescript
   export const DEFAULT_DIVERGENCE: DivergenceConfig = {
     enabled: true,
     'new-pattern-threshold': 1,
     'proportion-change-threshold': 0.20,
   };
   ```
5. Update `DEFAULT_GC` to include `divergence: DEFAULT_DIVERGENCE`
6. Validation in `validate.ts`:
   - `enabled` must be boolean (when present)
   - `new-pattern-threshold` must be integer ≥ 1
   - `proportion-change-threshold` must be number in range (0.0, 1.0) exclusive

**Edge cases:**
- Config file has no `gc.divergence` section: defaults apply, feature is enabled
- Config file has `gc: { divergence: { enabled: false } }`: feature disabled, other fields use defaults
- Config file has partial `gc.divergence` (only `enabled`): missing fields filled from defaults
- Existing config files with no `divergence` key: backward compatible, loader merges with defaults

**Delegation safety:** Low risk — follows existing config patterns exactly.

**Success criteria:**
- ✅ **SC-25 (Immediate):** A config file with no `gc.divergence` section loads without error. `config.gc.divergence.enabled === true` and thresholds match defaults.
- ✅ **SC-26 (Immediate):** `gc: { divergence: { enabled: false } }` loads with `config.gc.divergence.enabled === false`.
- ✅ **SC-27 (Immediate):** `gc: { divergence: { 'new-pattern-threshold': 0 } }` fails validation with a message containing "new-pattern-threshold" and "≥ 1".
- ✅ **SC-28 (Immediate):** `gc: { divergence: { 'proportion-change-threshold': 1.5 } }` fails validation with a message containing "proportion-change-threshold" and range.

---

## Implementation Sequence

Dependency-ordered. Each row is one iteration of the Ralph build loop.

| # | Feature | Depends On | Effort | Notes |
|---|---------|-----------|--------|-------|
| 1 | F-AD08: Config schema, defaults, validation | — | Small | Foundation — needed by all other features |
| 2 | F-AD01: Extract `collectPatternData()` | — | Small | Can run in parallel with task 1 (no dependency) |
| 3 | F-AD02: `computeFingerprint()` | F-AD01, F-AD08 | Small | Needs PatternData type and DivergenceConfig |
| 4 | F-AD03: Pattern history I/O | F-AD02 | Small | Needs PatternFingerprint type |
| 5 | F-AD04: `detectDivergence()` | F-AD02, F-AD08 | Medium | Core detection logic |
| 6 | F-AD07: `ralph gc --temporal` | F-AD03, F-AD04 | Medium | CLI view — uses history + detection |
| 7 | F-AD05: Score context extension | F-AD04 | Small | Formatting + ScoreContext type change |
| 8 | F-AD06: Run loop integration | F-AD01–F-AD05, F-AD08 | Medium | Wires everything together |
| 9 | ARCHITECTURE.md update | F-AD06 | Tiny | Document cross-domain exception |

**Coupled pair:** Tasks 7 and 8 (F-AD05 + F-AD06) should be implemented in immediate sequence. F-AD05 without F-AD06 is dead code; F-AD06 without F-AD05 has no way to format divergence for the prompt.

---

## Feature Tracker

| ID | Feature | Status | SC Count |
|----|---------|--------|----------|
| F-AD01 | Scanner Data Extraction | ❌ | 3 (SC-01–SC-03) |
| F-AD02 | Pattern Snapshot Computation | ❌ | 2 (SC-04–SC-05) |
| F-AD03 | Pattern History Storage | ❌ | 3 (SC-06–SC-08) |
| F-AD04 | Divergence Detection | ❌ | 5 (SC-09–SC-13) |
| F-AD05 | Score Context Integration | ❌ | 4 (SC-14–SC-17) |
| F-AD06 | Run Loop Integration | ❌ | 4 (SC-18–SC-21) |
| F-AD07 | Temporal CLI View | ❌ | 3 (SC-22–SC-24) |
| F-AD08 | Configuration | ❌ | 4 (SC-25–SC-28) |

**Total:** 8 features, 28 success criteria, 0 completed

---

## Success Criteria (spec-level)

1. **Regression:** All 832 existing tests pass. F-AD01 modifies `scanners.ts` internals but `gc.test.ts` requires zero changes (`git diff` = empty).
2. **Feature completeness:** All 28 feature-level success criteria (SC-01 through SC-28) pass.
3. **Performance:** `computeFingerprint()` completes in <500ms for a project with 1,000 source files. Measured in test via `Date.now()` timing wrapper.
4. **Existing behavior preservation:** `ralph gc` (without `--temporal`) produces identical output before and after this change for any project with no pattern history file.
5. **Backward compatibility:** An existing `.ralph/config.yml` with no `gc.divergence` section loads without warnings or errors. Verified by running `ralph config-validate` against the ralph-cli project's own config.

---

## Compatibility Notes

**Consumers who need to be aware:**

1. **`ScoreContext` type users** (`run/scoring.ts`, `run/index.ts`): New optional field `divergenceInfo`. Existing code that constructs `ScoreContext` without this field continues to compile and work (TypeScript optional field).
2. **Config consumers** (`config/loader.ts`): New optional `gc.divergence` section. The loader's existing deep-merge logic handles missing sections by applying defaults.
3. **`scanPatternInconsistency()` callers** (`gc/index.ts`): Return type and behavior are unchanged. Internal refactoring is transparent to callers.
4. **ARCHITECTURE.md readers**: New cross-domain exception (run → gc/fingerprint) documented alongside the existing 5 exceptions.

**No breaking changes.** All additions are backward-compatible.

---

## Non-Goals

- **Automatic divergence correction.** Divergence is flagged, not fixed. The agent or developer decides whether the change is intentional.
- **AST-level pattern analysis.** Pattern detection uses the same regex-based scanners as `ralph gc`. AST parsing would be more accurate but adds dependency weight.
- **Cross-project pattern comparison.** Divergence is tracked within a single project, not across projects.
- **New pattern categories.** This spec ships with the existing 3 categories (`error-handling`, `export-style`, `null-checking`). Adding new categories is a future config extension, not a code change.
- **Occurrence counting.** Counts are per-file (boolean presence), not per-occurrence within a file. A file with 10 try-catch blocks counts as 1 file using try-catch. This is consistent with how `scanPatternInconsistency()` already works.

---

## Test Plan

### Unit Tests — `gc/fingerprint.test.ts`

**collectPatternData (via integration with computeFingerprint):**
- Project with mixed patterns → correct file counts per variant
- Project with no source files → empty pattern maps
- Excluded directories are respected

**computeFingerprint:**
- Multiple patterns across categories → correct `PatternFingerprint` structure
- Single variant in one category → single entry with correct count
- No patterns detected → empty objects per category
- `iteration`, `commit`, `timestamp` fields populated correctly

**loadPatternHistory / appendPatternHistory:**
- Append to missing file → file created with one entry
- Append to existing file → entry added at end, previous entries preserved
- Load from missing file → returns `[]`
- Load from file with 3 valid lines and 1 corrupt line → returns 3 entries
- Load from empty file → returns `[]`

**detectDivergence:**
- New pattern: previous has only `try-catch`, current adds `.catch()` → `new-pattern` item
- New pattern below threshold: `new-pattern-threshold: 3`, new pattern has 2 files → no item
- Dominant shift: `named-export` was dominant, `default-export` becomes dominant → `dominant-shift` item
- Proportion change above threshold: share changes 0.30 with threshold 0.20 → `proportion-change` item
- Proportion change below threshold: share changes 0.10 with threshold 0.20 → no item
- No previous (null/undefined) → empty array
- Category total 0 in current → no `proportion-change` (no division by zero)
- Category total 0 in previous → no `proportion-change`
- Tied dominance with alphabetical tiebreaker → correct behavior

**formatTemporalView:**
- History with 10 entries, divergence at iteration 9 → "← divergence" annotation
- Empty history → guidance message
- Single entry → baseline only
- `last` parameter respected (show last N only)

**computeAndRecordDivergence:**
- Normal case → appends to history, returns items
- Disabled config → returns empty array, no file written
- Missing config (defaults) → proceeds with defaults

### Unit Tests — `run/scoring.test.ts` (extended)

**formatDivergenceContext:**
- One divergence item → formatted "ℹ" string
- Multiple items → all listed
- Empty items → returns `undefined`

**buildScoreContext (extended):**
- `divergenceInfo` present → info block appended after metrics
- `divergenceInfo` undefined → output identical to existing (byte comparison)

### Integration Tests

- Run loop: passing build → `pattern-history.jsonl` has new entry
- Run loop: second passing build introduces new pattern → score context includes divergence info
- `ralph gc --temporal` with history → formatted output
- `ralph gc --temporal` without history → guidance message
- `ralph gc --temporal --json` → JSON array output
- Config with `gc.divergence.enabled: false` → no `pattern-history.jsonl` created
- Config with no `gc.divergence` → defaults apply, fingerprinting works
